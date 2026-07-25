import { deleteColumnCascade, type Column, type ProjectModel } from '@erdd/core'

function tableColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.tableId === tableId)
}

export function addColumn(
  model: ProjectModel, tableId: string, { id }: { id: string },
): ProjectModel {
  const siblings = tableColumns(model, tableId)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.order)) + 1
  const used = new Set(siblings.map((c) => c.physicalName))
  let n = 1
  while (used.has(`COL_${n}`)) n++
  const column: Column = {
    id, tableId, logicalName: `컬럼${n}`, physicalName: `COL_${n}`,
    type: 'VARCHAR(255)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order, comment: null, domainId: null,
  }
  return { ...model, columns: { ...model.columns, [id]: column } }
}

export function updateColumn(
  model: ProjectModel, id: string,
  patch: Partial<Omit<Column, 'id' | 'tableId'>>,
): ProjectModel {
  const column = model.columns[id]
  if (!column) return model
  return { ...model, columns: { ...model.columns, [id]: { ...column, ...patch } } }
}

export function removeColumn(model: ProjectModel, id: string): ProjectModel {
  return deleteColumnCascade(model, id)
}

/** 같은 테이블 내 인접 컬럼과 order를 교환한다. dir: -1 위로, +1 아래로. */
export function reorderColumn(model: ProjectModel, id: string, dir: -1 | 1): ProjectModel {
  const column = model.columns[id]
  if (!column) return model
  const siblings = tableColumns(model, column.tableId).sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((c) => c.id === id)
  const neighbor = siblings[idx + dir]
  if (!neighbor) return model
  return {
    ...model,
    columns: {
      ...model.columns,
      [column.id]: { ...column, order: neighbor.order },
      [neighbor.id]: { ...neighbor, order: column.order },
    },
  }
}
