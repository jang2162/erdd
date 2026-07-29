import type { ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, type EntityKind } from './op.js'

export type DiffChangeKind = 'added' | 'removed' | 'changed'

export type DiffFieldChange = {
  field: string
  label: string
  before: string
  after: string
}

export type DiffEntry = {
  kind: EntityKind
  changeKind: DiffChangeKind
  entityId: string
  /** 사람이 읽는 대상 이름. 'MBR' / 'MBR.MBR_NO' / '회원번호' */
  label: string
  /** 컬럼·인덱스·관계 → 화면에서 이 테이블을 선택해 이동한다. */
  parentTableId?: string
  /** changed일 때만 채운다. added/removed는 빈 배열. */
  fields: DiffFieldChange[]
}

export type ModelDiff = {
  entries: DiffEntry[]
  counts: { added: number; removed: number; changed: number }
}

/** Excel '구분' 컬럼과 화면 그룹 제목이 공유하는 종류 라벨. */
export const DIFF_KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계', index: '인덱스',
  tableGroup: '그룹', domain: '도메인', word: '단어', term: '용어',
  customField: '커스텀 항목', note: '메모',
}

/** Excel '변경유형' 컬럼과 화면의 변경 유형 라벨이 공유하는 상수. */
export const CHANGE_KIND_LABEL: Record<DiffChangeKind, string> = {
  added: '추가', removed: '삭제', changed: '변경',
}

/**
 * 표시 순서 — FK 안전 순서(ENTITY_KINDS)가 아니라 사람이 읽는 순서다.
 * 스키마(테이블→컬럼→관계→인덱스→그룹) 다음에 사전 자산, 마지막이 메모.
 * export된 이유는 테스트가 ENTITY_KINDS 전체를 담는지 완전성을 검증하기 위해서다
 * (11번째 op 엔티티가 여기 누락되면 그 종류 전체가 diff·정의서에서 조용히 빠진다).
 */
export const KIND_ORDER: readonly EntityKind[] = [
  'table', 'column', 'relationship', 'index', 'tableGroup',
  'domain', 'word', 'term', 'customField', 'note',
]

/**
 * 배치 좌표는 비교에서 뺀다 — 테이블을 옮기기만 해도 전 테이블이 '변경'으로
 * 잡히면 변경분 정의서가 무의미해진다.
 */
const IGNORED_FIELDS = new Set(['id', 'position', 'groupPosition'])

const FIELD_LABEL: Record<string, string> = {
  logicalName: '논리명', physicalName: '물리명', comment: '설명', description: '설명',
  name: '이름', groupId: '소속 그룹', tableId: '소속 테이블', type: '타입',
  isPk: '기본키', autoIncrement: '자동증가', nullable: 'NULL 허용',
  defaultValue: '기본값', order: '순번', domainId: '도메인', custom: '커스텀 항목',
  abbreviation: '약어', englishName: '영문명', logicalType: '논리 타입',
  dialectTypes: '방언별 타입', allowedValues: '허용값', category: '분류',
  color: '색상', content: '내용', unique: '유니크', columns: '구성 컬럼',
  parentTableId: '부모 테이블', childTableId: '자식 테이블', cardinality: '카디널리티',
  identifying: '식별 관계', columnMappings: '컬럼 매핑', target: '적용 대상',
  options: '선택지', required: '필수', origin: '원본 참조',
}

/** 값 하나를 셀 문자열로. 모든 표시 경로가 이 함수만 쓴다. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Y' : ''
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(formatValue).filter((s) => s !== '').join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => [k, formatValue(val)] as const)
      .filter(([, val]) => val !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${k}=${val}`)
      .join(', ')
  }
  return String(v)
}

/**
 * id 하나를 이름으로 바꾼다. 참조가 끊겼으면(dangling — 그 모델에 해당 id가 없음)
 * 원시 id를 그대로 남긴다. 정보를 숨기지 않는다.
 */
function resolveRefLabel<T>(
  id: unknown, collection: Record<string, T>, nameOf: (e: T) => string,
): string {
  if (id === null || id === undefined || id === '') return ''
  if (typeof id !== 'string') return formatValue(id)
  const e = collection[id]
  if (!e) return id
  const name = nameOf(e)
  return name === '' ? id : name
}

function refDomainName(model: ProjectModel, id: unknown): string {
  return resolveRefLabel(id, model.domains, (d) => d.name)
}
function refGroupName(model: ProjectModel, id: unknown): string {
  return resolveRefLabel(id, model.tableGroups, (g) => g.name)
}
function refTableName(model: ProjectModel, id: unknown): string {
  return resolveRefLabel(id, model.tables, (t) => t.physicalName || t.logicalName)
}
function refColumnName(model: ProjectModel, id: unknown): string {
  return resolveRefLabel(id, model.columns, (c) => c.physicalName || c.logicalName)
}

/** custom 값 맵(customFieldId → 값)을 항목 이름 기준 "이름=값" 나열로 바꾼다. */
function formatCustomField(value: unknown, model: ProjectModel): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return formatValue(value)
  return Object.entries(value as Record<string, unknown>)
    .map(([fieldId, v]) => [fieldId, formatValue(v)] as const)
    .filter(([, v]) => v !== '')
    .map(([fieldId, v]) => {
      const field = model.customFields[fieldId]
      return [field?.name || fieldId, v] as const
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, v]) => `${name}=${v}`)
    .join(', ')
}

/** 인덱스 구성 컬럼. 정의 순서를 그대로 보존한다(정렬하지 않음 — 인덱스는 순서가 의미 있다). */
function formatIndexColumns(value: unknown, model: ProjectModel): string {
  if (!Array.isArray(value)) return formatValue(value)
  return value
    .map((v) => {
      const item = v as { columnId?: unknown; direction?: unknown }
      const name = refColumnName(model, item.columnId)
      if (name === '') return formatValue(v)
      return typeof item.direction === 'string' ? `${name}(${item.direction})` : name
    })
    .join(', ')
}

/**
 * 관계의 컬럼 매핑. "부모 → 자식" 순으로 나열한다 — labelOf가 관계를
 * "부모물리명 → 자식물리명"으로 쓰는 것과 방향을 맞춘다.
 */
function formatColumnMappings(value: unknown, model: ProjectModel): string {
  if (!Array.isArray(value)) return formatValue(value)
  return value
    .map((v) => {
      const item = v as { childColumnId?: unknown; parentColumnId?: unknown }
      const child = refColumnName(model, item.childColumnId) || formatValue(item.childColumnId)
      const parent = refColumnName(model, item.parentColumnId) || formatValue(item.parentColumnId)
      return `${parent} → ${child}`
    })
    .join(', ')
}

/**
 * 필드 값을 셀 문자열로 — 표시 전용이다.
 * id를 값으로 갖는 속성(도메인·그룹·테이블·컬럼 참조)은 사람이 읽는 이름으로 바꾼다.
 * 실데이터 id는 UUIDv7이라 원문 그대로는 감사 문서로 쓸 수 없다. 참조가 끊겼으면
 * (dangling) 원시 값을 그대로 남긴다 — formatValue와 동일한 원칙이다.
 * 이 함수는 변경 판정에는 쓰지 않는다: diffModelsForDisplay는 formatValue(원시값)로
 * 판정한 뒤에만 이 함수로 표시 문자열을 만든다. 그래야 이름만 바뀌어도(예: 도메인
 * 개명) 값을 바꾸지 않은 엔티티가 '변경'으로 잘못 잡히는 일이 없다.
 */
function formatFieldValue(field: string, value: unknown, model: ProjectModel): string {
  switch (field) {
    case 'domainId': return refDomainName(model, value)
    case 'groupId': return refGroupName(model, value)
    case 'tableId':
    case 'parentTableId':
    case 'childTableId':
      return refTableName(model, value)
    case 'custom': return formatCustomField(value, model)
    case 'columns': return formatIndexColumns(value, model)
    case 'columnMappings': return formatColumnMappings(value, model)
    default: return formatValue(value)
  }
}

type Entity = Record<string, unknown> & { id: string }

function tableLabel(model: ProjectModel, tableId: string | undefined): string {
  if (!tableId) return ''
  const t = model.tables[tableId] as { physicalName?: string; logicalName?: string } | undefined
  return t?.physicalName || t?.logicalName || '?'
}

/**
 * 엔티티의 사람용 이름. 삭제는 base, 추가·변경은 target에서 해석한다 —
 * 삭제된 컬럼의 소속 테이블은 target에 없으므로 base를 봐야 한다.
 */
function labelOf(kind: EntityKind, e: Entity, model: ProjectModel): string {
  switch (kind) {
    case 'table':
      return String(e.physicalName || e.logicalName || '(이름 없음)')
    case 'column': {
      const owner = tableLabel(model, e.tableId as string | undefined)
      const own = String(e.physicalName || e.logicalName || '?')
      return owner ? `${owner}.${own}` : own
    }
    case 'index': {
      const owner = tableLabel(model, e.tableId as string | undefined)
      const own = String(e.name || '?')
      return owner ? `${owner}.${own}` : own
    }
    case 'relationship': {
      if (e.name) return String(e.name)
      const p = tableLabel(model, e.parentTableId as string | undefined)
      const c = tableLabel(model, e.childTableId as string | undefined)
      return `${p} → ${c}`
    }
    case 'note': {
      const head = String(e.content ?? '').slice(0, 20)
      return head === '' ? '메모' : `메모: ${head}`
    }
    case 'tableGroup':
    case 'domain':
    case 'customField':
      return String(e.name || '(이름 없음)')
    case 'word':
    case 'term':
      return String(e.logicalName || '(이름 없음)')
  }
}

function parentTableIdOf(kind: EntityKind, e: Entity): string | undefined {
  if (kind === 'column' || kind === 'index') return e.tableId as string | undefined
  if (kind === 'relationship') return e.childTableId as string | undefined
  return undefined
}

/** base·target 양쪽 키의 합집합에서 무시 속성을 뺀 비교 대상 속성. */
function comparableFields(a: Entity, b: Entity): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !IGNORED_FIELDS.has(k)).sort()
}

/**
 * 두 모델을 비교해 사람이 읽는 변경 목록을 만든다.
 * 적용용 op 배치가 필요하면 diffModels(diff.ts)를 쓴다 — 이 함수는 표시 전용이고
 * 정렬·이름 해석·좌표 제외가 다르다.
 */
export function diffModelsForDisplay(base: ProjectModel, target: ProjectModel): ModelDiff {
  const entries: DiffEntry[] = []

  for (const kind of KIND_ORDER) {
    const collection = COLLECTION_BY_KIND[kind]
    const baseCol = (base[collection] ?? {}) as Record<string, Entity>
    const targetCol = (target[collection] ?? {}) as Record<string, Entity>

    for (const [id, entity] of Object.entries(targetCol)) {
      const before = baseCol[id]
      if (!before) {
        entries.push({
          kind, changeKind: 'added', entityId: id,
          label: labelOf(kind, entity, target),
          parentTableId: parentTableIdOf(kind, entity),
          fields: [],
        })
        continue
      }
      const fields: DiffFieldChange[] = []
      for (const field of comparableFields(before, entity)) {
        // 판정은 원시 값(formatValue)으로 한다 — 참조 이름 해석은 표시 전용이라,
        // 이름만 바뀌고 참조 id가 그대로면 여기서 걸러져 '변경'으로 잡히지 않는다.
        const rawBefore = formatValue(before[field])
        const rawAfter = formatValue(entity[field])
        if (rawBefore === rawAfter) continue
        const b = formatFieldValue(field, before[field], base)
        const a = formatFieldValue(field, entity[field], target)
        fields.push({ field, label: FIELD_LABEL[field] ?? field, before: b, after: a })
      }
      if (fields.length === 0) continue
      entries.push({
        kind, changeKind: 'changed', entityId: id,
        label: labelOf(kind, entity, target),
        parentTableId: parentTableIdOf(kind, entity),
        fields,
      })
    }

    for (const [id, entity] of Object.entries(baseCol)) {
      if (Object.hasOwn(targetCol, id)) continue
      entries.push({
        kind, changeKind: 'removed', entityId: id,
        label: labelOf(kind, entity, base),
        parentTableId: parentTableIdOf(kind, entity),
        fields: [],
      })
    }
  }

  const order = new Map(KIND_ORDER.map((k, i) => [k, i]))
  entries.sort((x, y) =>
    (order.get(x.kind)! - order.get(y.kind)!) || x.label.localeCompare(y.label))

  return {
    entries,
    counts: {
      added: entries.filter((e) => e.changeKind === 'added').length,
      removed: entries.filter((e) => e.changeKind === 'removed').length,
      changed: entries.filter((e) => e.changeKind === 'changed').length,
    },
  }
}
