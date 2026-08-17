import type { ProjectModel, Term } from './model.js'
import {
  decomposeByWords, generatePhysicalName, stripLogicalSeparator, type NamingRules,
} from './naming.js'
import { isReservedWord } from './identifier.js'
import type { Dialect } from './dialect.js'
import { customFieldsFor, resolveCustomValue } from './custom-field.js'
import { composeTablePhysicalName } from './name-template.js'

export type Warning = {
  kind:
    | 'duplicate-physical'
    | 'type-mismatch'
    | 'incomplete-mapping'
    | 'unknown-word'
    | 'term-mismatch'
    | 'too-long'
    | 'reserved'
    | 'duplicate-physical-table'
    | 'custom-required'
    | 'required-empty'
    | 'missing-logical-separator'
  scope: 'table' | 'column' | 'relationship'
  entityId: string
  tableId?: string
  message: string
  severity?: 'warning' | 'error'
}

/**
 * terms에서 논리명이 정확히 일치하는 Term을 찾는다(naming.ts의 용어 완전일치 규칙과 동일).
 * 양쪽에서 구분자를 벗겨 비교한다 — generatePhysicalName 의 1단계와 같은 정책이어야 한다(설계 D4).
 */
function findMatchingTerm(
  logicalName: string, terms: Record<string, Term>, rules: NamingRules,
): Term | undefined {
  const bare = stripLogicalSeparator(logicalName.trim(), rules)
  return Object.values(terms).find(
    (t) => stripLogicalSeparator(t.logicalName.trim(), rules) === bare)
}

export function computeWarnings(
  model: ProjectModel, rules?: NamingRules, dialects?: Dialect[],
): Warning[] {
  const warnings: Warning[] = []

  // 1) 같은 테이블 물리명 중복
  const byTable = new Map<string, Map<string, string[]>>() // tableId → physicalName → columnIds
  for (const c of Object.values(model.columns)) {
    if (c.physicalName === '') continue
    let names = byTable.get(c.tableId)
    if (!names) { names = new Map(); byTable.set(c.tableId, names) }
    const ids = names.get(c.physicalName) ?? []
    ids.push(c.id)
    names.set(c.physicalName, ids)
  }
  for (const [tableId, names] of byTable) {
    for (const [physicalName, ids] of names) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical', scope: 'column', entityId: id, tableId,
          message: `물리명 "${physicalName}"이(가) 같은 테이블에서 중복됩니다`,
          severity: 'error',
        })
      }
    }
  }

  // 2), 3) 관계 타입 불일치 / 매핑 불완전
  for (const rel of Object.values(model.relationships)) {
    const parentPkCount = Object.values(model.columns).filter(
      (c) => c.tableId === rel.parentTableId && c.isPk,
    ).length
    if (parentPkCount !== rel.columnMappings.length) {
      warnings.push({
        kind: 'incomplete-mapping', scope: 'relationship', entityId: rel.id,
        message: '부모 기본 키와 매핑 수가 일치하지 않습니다',
      })
    }
    for (const m of rel.columnMappings) {
      const child = model.columns[m.childColumnId]
      const parent = model.columns[m.parentColumnId]
      if (child && parent && child.type !== parent.type) {
        warnings.push({
          kind: 'type-mismatch', scope: 'relationship', entityId: rel.id,
          message: `참조 컬럼 타입이 다릅니다 (${parent.type} ↔ ${child.type})`,
        })
        break // 관계당 1건
      }
    }
  }

  // 4) 명명 경고 — rules가 주어질 때만 계산(무인자 호출 시 하위호환 유지)
  if (rules) {
    const checkNamingEntity = (
      scope: 'table' | 'column', entityId: string, tableId: string | undefined,
      logicalName: string, physicalName: string,
      // ⚠️ 길이·예약어만 최종 이름 기준이다. 용어 비교는 사용자가 입력하는 부분과 해야 한다.
      finalName: string = physicalName,
    ) => {
      const logical = logicalName.trim()
      if (logical !== '') {
        const gen = generatePhysicalName(logical, model.words, model.terms, rules)
        if (gen.unknownWords.length > 0) {
          warnings.push({
            kind: 'unknown-word', scope, entityId, tableId,
            message: `등록되지 않은 단어가 있습니다: ${gen.unknownWords.join(', ')}`,
          })
        }
        const term = findMatchingTerm(logical, model.terms, rules)
        if (term && term.physicalName !== physicalName) {
          warnings.push({
            kind: 'term-mismatch', scope, entityId, tableId,
            message: `용어 "${term.logicalName}"의 표준 물리명은 "${term.physicalName}"입니다(현재 "${physicalName}")`,
          })
        }
        // 구분자가 의미를 갖는 것은 단어가 둘 이상일 때뿐이다 — 단일 단어에까지 붙이면
        // 경고가 노이즈가 되어 신호가 죽는다(설계 3.5).
        if (rules.logicalSeparator !== '' && !logical.includes(rules.logicalSeparator)) {
          // ⚠️ 같은 논리명을 **두 번 분해하지 않는다.** 위 generatePhysicalName 이 2단계를
          // 탔다면 그 세그먼트가 그대로 온다. 용어 완전일치로 끝난 경우에만 없으므로 그때만
          // 직접 분해한다(그 갈래에서도 경고 판정은 논리명 자체를 보는 것이라 그대로여야 한다).
          const segments = gen.segments ?? decomposeByWords(logical, model.words, rules)
          if (segments.length >= 2) {
            warnings.push({
              kind: 'missing-logical-separator', scope, entityId, tableId,
              message: `논리명 "${logical}"에 단어 구분자(${rules.logicalSeparator})가 없습니다`
                + ` — "${segments.map((s) => s.text).join(rules.logicalSeparator)}"`,
            })
          }
        }
      }
      if (new TextEncoder().encode(finalName).length > rules.maxLengthBytes) {
        warnings.push({
          kind: 'too-long', scope, entityId, tableId,
          message: `물리명 "${finalName}"이(가) 최대 길이(${rules.maxLengthBytes}바이트)를 초과합니다`,
        })
      }
      if (dialects?.some((d) => isReservedWord(finalName, d))) {
        warnings.push({
          kind: 'reserved', scope, entityId, tableId,
          message: `물리명 "${finalName}"은(는) 예약어입니다`,
        })
      }
    }

    for (const t of Object.values(model.tables)) {
      checkNamingEntity('table', t.id, undefined, t.logicalName, t.physicalName,
        composeTablePhysicalName(t, model, rules))
    }
    for (const c of Object.values(model.columns)) {
      checkNamingEntity('column', c.id, c.tableId, c.logicalName, c.physicalName)
    }

    // 테이블 물리명 간 중복(테이블 간)
    // 실제 DB 에서 충돌하는 것은 최종 이름이다 — 다른 그룹의 같은 부분 이름은 충돌이 아니다(설계 D3).
    const tableNames = new Map<string, string[]>() // 조합된 최종 이름 → tableIds
    for (const t of Object.values(model.tables)) {
      const finalName = composeTablePhysicalName(t, model, rules)
      if (finalName === '') continue
      const ids = tableNames.get(finalName) ?? []
      ids.push(t.id)
      tableNames.set(finalName, ids)
    }
    for (const [finalName, ids] of tableNames) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical-table', scope: 'table', entityId: id,
          severity: 'error',
          message: `테이블 물리명 "${finalName}"이(가) 중복됩니다`,
        })
      }
    }
  }

  // 5) 표준 필드 필수 미입력 — 명명 규칙과 무관한 완결성 경고이므로 rules 게이트 밖에서 계산한다.
  const requiredEmpty = (
    scope: 'table' | 'column', entityId: string, tableId: string | undefined,
    label: string, value: string,
  ) => {
    if (value.trim() !== '') return
    warnings.push({
      kind: 'required-empty', scope, entityId, tableId,
      message: `필수 항목 "${label}"이(가) 비어 있습니다`,
    })
  }
  for (const t of Object.values(model.tables)) {
    requiredEmpty('table', t.id, undefined, '논리명', t.logicalName)
    requiredEmpty('table', t.id, undefined, '물리명', t.physicalName)
  }
  for (const c of Object.values(model.columns)) {
    requiredEmpty('column', c.id, c.tableId, '논리명', c.logicalName)
    requiredEmpty('column', c.id, c.tableId, '물리명', c.physicalName)
    requiredEmpty('column', c.id, c.tableId, '타입', c.type)
  }

  // 6) 커스텀 항목 필수 미입력 — 명명 규칙과 무관하므로 rules 게이트 밖에서 계산한다.
  const tableFields = customFieldsFor(model, 'table')
  const columnFields = customFieldsFor(model, 'column')
  const checkRequired = (
    scope: 'table' | 'column', entityId: string, tableId: string | undefined,
    entity: { custom: Record<string, string> }, fields: typeof tableFields,
  ) => {
    for (const field of fields) {
      // boolean은 체크박스라 "미입력"이 없다 → 필수 검사 대상 아님
      if (!field.required || field.type === 'boolean') continue
      if (resolveCustomValue(entity, field) !== '') continue
      warnings.push({
        kind: 'custom-required', scope, entityId, tableId,
        message: `필수 항목 "${field.name}"이(가) 비어 있습니다`,
      })
    }
  }
  if (tableFields.length > 0) {
    for (const t of Object.values(model.tables)) checkRequired('table', t.id, undefined, t, tableFields)
  }
  if (columnFields.length > 0) {
    for (const c of Object.values(model.columns)) checkRequired('column', c.id, c.tableId, c, columnFields)
  }

  return warnings
}
