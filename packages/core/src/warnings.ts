import type { ProjectModel, Term } from './model.js'
import { generatePhysicalName, type NamingRules } from './naming.js'
import { isReservedWord } from './identifier.js'
import type { Dialect } from './dialect.js'
import { customFieldsFor, resolveCustomValue } from './custom-field.js'

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
  scope: 'table' | 'column' | 'relationship'
  entityId: string
  tableId?: string
  message: string
  severity?: 'warning' | 'error'
}

/** terms에서 논리명이 정확히 일치하는 Term을 찾는다(naming.ts의 용어 완전일치 규칙과 동일). */
function findMatchingTerm(logicalName: string, terms: Record<string, Term>): Term | undefined {
  const name = logicalName.trim()
  return Object.values(terms).find((t) => t.logicalName.trim() === name)
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
        const term = findMatchingTerm(logical, model.terms)
        if (term && term.physicalName !== physicalName) {
          warnings.push({
            kind: 'term-mismatch', scope, entityId, tableId,
            message: `용어 "${term.logicalName}"의 표준 물리명은 "${term.physicalName}"입니다(현재 "${physicalName}")`,
          })
        }
      }
      if (new TextEncoder().encode(physicalName).length > rules.maxLengthBytes) {
        warnings.push({
          kind: 'too-long', scope, entityId, tableId,
          message: `물리명 "${physicalName}"이(가) 최대 길이(${rules.maxLengthBytes}바이트)를 초과합니다`,
        })
      }
      if (dialects?.some((d) => isReservedWord(physicalName, d))) {
        warnings.push({
          kind: 'reserved', scope, entityId, tableId,
          message: `물리명 "${physicalName}"은(는) 예약어입니다`,
        })
      }
    }

    for (const t of Object.values(model.tables)) {
      checkNamingEntity('table', t.id, undefined, t.logicalName, t.physicalName)
    }
    for (const c of Object.values(model.columns)) {
      checkNamingEntity('column', c.id, c.tableId, c.logicalName, c.physicalName)
    }

    // 테이블 물리명 간 중복(테이블 간)
    const tableNames = new Map<string, string[]>() // physicalName → tableIds
    for (const t of Object.values(model.tables)) {
      if (t.physicalName === '') continue
      const ids = tableNames.get(t.physicalName) ?? []
      ids.push(t.id)
      tableNames.set(t.physicalName, ids)
    }
    for (const [physicalName, ids] of tableNames) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical-table', scope: 'table', entityId: id,
          severity: 'error',
          message: `테이블 물리명 "${physicalName}"이(가) 중복됩니다`,
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
