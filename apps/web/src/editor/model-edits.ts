import { deleteTableCascade, type Position, type ProjectModel, type Table } from '@erdd/core'

/** 사용 중이지 않은 가장 작은 TABLE_n. 논리명이 정해지기 전의 임시 물리명이다. */
export function nextTablePhysicalName(model: ProjectModel): string {
  const used = new Set(Object.values(model.tables).map((t) => t.physicalName))
  let n = 1
  while (used.has(`TABLE_${n}`)) n++
  return `TABLE_${n}`
}

/** 새 테이블(컬럼 없음). 물리명은 임시 기본값 — 편집 패널에서 바꾼다. */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const physicalName = nextTablePhysicalName(model)
  const n = physicalName.slice('TABLE_'.length)
  const table: Table = {
    id, logicalName: `테이블${n}`, physicalName,
    comment: null, groupId: null, position, groupPosition: null, custom: {},
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}

export function moveTable(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, position } } }
}

export function moveTableGroupPosition(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, groupPosition: position } } }
}

export function updateTable(
  model: ProjectModel, id: string,
  patch: Partial<Pick<Table, 'logicalName' | 'physicalName' | 'comment'>>,
): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, ...patch } } }
}

/** 테이블과 그 소속 컬럼·인덱스·관계를 제거한다. */
export function removeTable(model: ProjectModel, id: string): ProjectModel {
  return deleteTableCascade(model, id)
}
