import type { Column, IndexDef, ProjectModel } from '@erdd/core'
import { uniqueName, type ClipboardPayload } from './clipboard.js'

/** 테이블 하나를 붙여넣는 데 필요한 id 묶음. producer 밖에서 발급한다. */
export type PastedTableIds = {
  tableId: string
  columnIds: string[]
  indexIds: string[]
}

/**
 * 붙여넣기에 쓸 id를 미리 발급한다.
 * ⚠️ producer 안에서 newId()를 부르면 serializeMutation의 재실행에서 다른 id가 나온다.
 */
export function planPasteTableIds(payload: ClipboardPayload, newId: () => string): PastedTableIds[] {
  if (payload.kind !== 'tables') return []
  return payload.tables.map((t) => ({
    tableId: newId(),
    columnIds: t.columns.map(() => newId()),
    indexIds: t.indexes.map(() => newId()),
  }))
}

export function planPasteColumnIds(payload: ClipboardPayload, newId: () => string): string[] {
  if (payload.kind !== 'columns') return []
  return payload.columns.map(() => newId())
}

/** customField 이름 → id. 없는 이름은 버린다(다른 프로젝트에는 그 정의가 없다). */
function customByName(model: ProjectModel, custom: Record<string, string>): Record<string, string> {
  const idByName = new Map(Object.values(model.customFields).map((f) => [f.name, f.id]))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(custom)) {
    const id = idByName.get(name)
    if (id !== undefined) out[id] = value
  }
  return out
}

/** 도메인 이름 → id. 같은 이름이 없으면 null(타입 문자열은 복사본 값을 그대로 쓴다). */
function domainIdByName(model: ProjectModel, name: string | null): string | null {
  if (name === null) return null
  return Object.values(model.domains).find((d) => d.name === name)?.id ?? null
}

export function pasteTables(
  model: ProjectModel, payload: ClipboardPayload,
  { ids, offset }: { ids: PastedTableIds[]; offset: { x: number; y: number } },
): ProjectModel {
  if (payload.kind !== 'tables') return model

  const tables = { ...model.tables }
  const columns = { ...model.columns }
  const indexes = { ...model.indexes }

  // 개명 판정에 쓰는 사용 중 이름. 붙여넣는 도중에도 갱신해 자기들끼리 충돌하지 않게 한다.
  const usedTableLogical = new Set(Object.values(tables).map((t) => t.logicalName))
  const usedTablePhysical = new Set(Object.values(tables).map((t) => t.physicalName))
  const usedIndexNames = new Set(Object.values(indexes).map((ix) => ix.name))

  payload.tables.forEach((src, ti) => {
    const plan = ids[ti]
    if (!plan) return

    const logicalName = uniqueName(src.logicalName, usedTableLogical, '_사본')
    const physicalName = uniqueName(src.physicalName, usedTablePhysical, '_COPY')
    usedTableLogical.add(logicalName)
    usedTablePhysical.add(physicalName)

    tables[plan.tableId] = {
      id: plan.tableId,
      logicalName,
      physicalName,
      comment: src.comment,
      groupId: null,                       // 그룹은 붙여넣지 않는다(그룹 자체를 복사 대상에서 뺐다)
      position: { x: src.position.x + offset.x, y: src.position.y + offset.y },
      groupPosition: null,
      custom: customByName(model, src.custom),
    }

    // 새 테이블 안의 컬럼 물리명 → 새 컬럼 id. 인덱스 재연결에 쓴다.
    const columnIdByPhysical = new Map<string, string>()
    src.columns.forEach((c, ci) => {
      const columnId = plan.columnIds[ci]
      if (columnId === undefined) return
      const column: Column = {
        id: columnId,
        tableId: plan.tableId,
        logicalName: c.logicalName,
        physicalName: c.physicalName,
        type: c.type,
        isPk: c.isPk,
        autoIncrement: c.autoIncrement,
        nullable: c.nullable,
        defaultValue: c.defaultValue,
        order: ci,
        comment: c.comment,
        domainId: domainIdByName(model, c.domainName),
        custom: customByName(model, c.custom),
      }
      columns[columnId] = column
      columnIdByPhysical.set(c.physicalName, columnId)
    })

    src.indexes.forEach((ix, ii) => {
      const indexId = plan.indexIds[ii]
      if (indexId === undefined) return
      const cols = ix.columns
        .map((c) => {
          const columnId = columnIdByPhysical.get(c.columnPhysicalName)
          return columnId ? { columnId, direction: c.direction } : null
        })
        .filter((c): c is { columnId: string; direction: 'asc' | 'desc' } => c !== null)
      if (cols.length === 0) return        // 가리킬 컬럼이 없으면 인덱스를 만들지 않는다
      const name = uniqueName(ix.name, usedIndexNames, '_COPY')
      usedIndexNames.add(name)
      const index: IndexDef = { id: indexId, tableId: plan.tableId, name, columns: cols, unique: ix.unique }
      indexes[indexId] = index
    })
  })

  return { ...model, tables, columns, indexes }
}

export function pasteColumns(
  model: ProjectModel, payload: ClipboardPayload,
  { tableId, ids }: { tableId: string; ids: string[] },
): ProjectModel {
  if (payload.kind !== 'columns') return model
  if (!model.tables[tableId]) return model

  const siblings = Object.values(model.columns).filter((c) => c.tableId === tableId)
  // 개명 판정 범위는 **대상 테이블 안**이다(컬럼 물리명 중복 경고가 테이블 단위다).
  const usedLogical = new Set(siblings.map((c) => c.logicalName))
  const usedPhysical = new Set(siblings.map((c) => c.physicalName))
  let order = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.order)) + 1

  const columns = { ...model.columns }
  payload.columns.forEach((src, i) => {
    const id = ids[i]
    if (id === undefined) return
    const logicalName = uniqueName(src.logicalName, usedLogical, '_사본')
    const physicalName = uniqueName(src.physicalName, usedPhysical, '_COPY')
    usedLogical.add(logicalName)
    usedPhysical.add(physicalName)
    columns[id] = {
      id,
      tableId,
      logicalName,
      physicalName,
      type: src.type,
      // PK는 이어받지 않는다 — 대상 테이블의 키 구성이 조용히 바뀌면 관계 경고가 즉시 뜬다.
      isPk: false,
      autoIncrement: src.autoIncrement,
      nullable: src.nullable,
      defaultValue: src.defaultValue,
      order: order++,
      comment: src.comment,
      domainId: domainIdByName(model, src.domainName),
      custom: customByName(model, src.custom),
    }
  })
  return { ...model, columns }
}
