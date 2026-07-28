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

/**
 * 표시 순서 — FK 안전 순서(ENTITY_KINDS)가 아니라 사람이 읽는 순서다.
 * 스키마(테이블→컬럼→관계→인덱스→그룹) 다음에 사전 자산, 마지막이 메모.
 */
const KIND_ORDER: readonly EntityKind[] = [
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
        const b = formatValue(before[field])
        const a = formatValue(entity[field])
        if (b === a) continue
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
