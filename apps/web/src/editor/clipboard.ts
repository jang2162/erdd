import type { ProjectModel } from '@erdd/core'

/** 클립보드 형식 버전. 형식을 바꾸면 올리고, 모르는 버전은 조용히 무시된다. */
const CLIPBOARD_VERSION = 1

export type ClipboardColumn = {
  logicalName: string
  physicalName: string
  type: string
  isPk: boolean
  autoIncrement: boolean
  nullable: boolean
  defaultValue: string | null
  comment: string | null
  /** 도메인은 id가 아니라 이름으로 싣는다 — 다른 프로젝트에서 id는 무의미하다. */
  domainName: string | null
  /** 키가 customField의 **이름**이다(id가 아니다). */
  custom: Record<string, string>
}

export type ClipboardIndex = {
  name: string
  unique: boolean
  /** 컬럼도 id가 아니라 물리명으로 참조한다. */
  columns: { columnPhysicalName: string; direction: 'asc' | 'desc' }[]
}

export type ClipboardTable = {
  logicalName: string
  physicalName: string
  comment: string | null
  position: { x: number; y: number }
  custom: Record<string, string>
  columns: ClipboardColumn[]
  indexes: ClipboardIndex[]
}

export type ClipboardPayload =
  | { __erdd: 1; v: number; kind: 'tables'; tables: ClipboardTable[] }
  | { __erdd: 1; v: number; kind: 'columns'; columns: ClipboardColumn[] }

/** customField id → 이름. 값 맵의 키를 이름으로 바꿀 때 쓴다. */
function customFieldNames(model: ProjectModel): Map<string, string> {
  return new Map(Object.values(model.customFields).map((f) => [f.id, f.name]))
}

function toClipboardColumn(model: ProjectModel, columnId: string, names: Map<string, string>): ClipboardColumn | null {
  const c = model.columns[columnId]
  if (!c) return null
  const custom: Record<string, string> = {}
  for (const [fieldId, value] of Object.entries(c.custom)) {
    const name = names.get(fieldId)
    if (name !== undefined) custom[name] = value   // dangling 키는 버린다
  }
  return {
    logicalName: c.logicalName,
    physicalName: c.physicalName,
    type: c.type,
    isPk: c.isPk,
    autoIncrement: c.autoIncrement,
    nullable: c.nullable,
    defaultValue: c.defaultValue,
    comment: c.comment,
    domainName: c.domainId === null ? null : (model.domains[c.domainId]?.name ?? null),
    custom,
  }
}

export function serializeTables(model: ProjectModel, tableIds: readonly string[]): ClipboardPayload {
  const names = customFieldNames(model)
  const tables: ClipboardTable[] = []
  for (const tableId of tableIds) {
    const t = model.tables[tableId]
    if (!t) continue
    const cols = Object.values(model.columns)
      .filter((c) => c.tableId === tableId)
      .sort((a, b) => a.order - b.order)
    const byId = new Map(cols.map((c) => [c.id, c]))
    const custom: Record<string, string> = {}
    for (const [fieldId, value] of Object.entries(t.custom)) {
      const name = names.get(fieldId)
      if (name !== undefined) custom[name] = value
    }
    tables.push({
      logicalName: t.logicalName,
      physicalName: t.physicalName,
      comment: t.comment,
      position: { ...t.position },
      custom,
      columns: cols.map((c) => toClipboardColumn(model, c.id, names)).filter((c): c is ClipboardColumn => c !== null),
      indexes: Object.values(model.indexes)
        .filter((ix) => ix.tableId === tableId)
        .map((ix) => ({
          name: ix.name,
          unique: ix.unique,
          // 이 테이블에 없는 컬럼을 가리키는 항목은 버린다(붙여넣을 곳이 없다).
          columns: ix.columns
            .map((c) => {
              const col = byId.get(c.columnId)
              return col ? { columnPhysicalName: col.physicalName, direction: c.direction } : null
            })
            .filter((c): c is { columnPhysicalName: string; direction: 'asc' | 'desc' } => c !== null),
        })),
    })
  }
  return { __erdd: 1, v: CLIPBOARD_VERSION, kind: 'tables', tables }
}

export function serializeColumns(model: ProjectModel, columnIds: readonly string[]): ClipboardPayload {
  const names = customFieldNames(model)
  const ordered = columnIds
    .map((id) => model.columns[id])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .sort((a, b) => a.order - b.order)
  return {
    __erdd: 1, v: CLIPBOARD_VERSION, kind: 'columns',
    columns: ordered
      .map((c) => toClipboardColumn(model, c.id, names))
      .filter((c): c is ClipboardColumn => c !== null),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 클립보드 텍스트를 페이로드로 읽는다. 이 앱이 쓴 것이 아니면 null.
 * 다른 앱에서 복사한 텍스트를 캔버스에 붙여넣는 것은 정상적인 오작동이므로 오류를 내지 않는다.
 */
export function parseClipboard(text: string): ClipboardPayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw['__erdd'] !== 1) return null
  if (raw['v'] !== CLIPBOARD_VERSION) return null
  if (raw['kind'] === 'tables' && Array.isArray(raw['tables'])) {
    return raw as unknown as ClipboardPayload
  }
  if (raw['kind'] === 'columns' && Array.isArray(raw['columns'])) {
    return raw as unknown as ClipboardPayload
  }
  return null
}

/**
 * used와 충돌하지 않는 이름을 만든다. 충돌이 없으면 base 그대로.
 * 「주문」→「주문_사본」→「주문_사본2」, 「ORD」→「ORD_COPY」→「ORD_COPY2」.
 * ⚠️ 물리명 길이 제한을 넘길 수 있다 — 자르지 않는다(too-long 경고가 잡는다, 설계 §3.5).
 */
export function uniqueName(base: string, used: Set<string>, suffix: string): string {
  if (!used.has(base)) return base
  const first = `${base}${suffix}`
  if (!used.has(first)) return first
  let n = 2
  while (used.has(`${base}${suffix}${n}`)) n++
  return `${base}${suffix}${n}`
}
