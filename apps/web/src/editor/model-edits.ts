import type { Position, ProjectModel, Table } from '@erdd/core'

/** 새 테이블(컬럼 없음). 물리명은 임시 기본값 — 편집 패널에서 바꾼다. */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const n = Object.keys(model.tables).length + 1
  const table: Table = {
    id, logicalName: `테이블${n}`, physicalName: `TABLE_${n}`,
    comment: null, groupId: null, position, groupPosition: null,
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}

export function moveTable(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, position } } }
}

/** 테이블과 그 소속 컬럼·인덱스를 제거한다(관계는 M4b). */
export function removeTable(model: ProjectModel, id: string): ProjectModel {
  const columns = Object.fromEntries(
    Object.entries(model.columns).filter(([, c]) => c.tableId !== id),
  )
  const indexes = Object.fromEntries(
    Object.entries(model.indexes).filter(([, ix]) => ix.tableId !== id),
  )
  const tables = { ...model.tables }
  delete tables[id]
  return { ...model, tables, columns, indexes }
}
