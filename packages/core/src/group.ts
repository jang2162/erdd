import type { ProjectModel, TableGroup } from './model.js'

export function createGroup(
  model: ProjectModel,
  args: { id: string; name: string; color: string; comment?: string | null },
): ProjectModel {
  if (Object.hasOwn(model.tableGroups, args.id)) return model
  const group: TableGroup = {
    id: args.id, name: args.name, color: args.color, comment: args.comment ?? null, alias: '',
  }
  return { ...model, tableGroups: { ...model.tableGroups, [args.id]: group } }
}

export function updateGroup(
  model: ProjectModel, id: string,
  patch: Partial<Pick<TableGroup, 'name' | 'color' | 'comment' | 'alias'>>,
): ProjectModel {
  const group = model.tableGroups[id]
  if (!group) return model
  return { ...model, tableGroups: { ...model.tableGroups, [id]: { ...group, ...patch } } }
}

export function setTableGroup(
  model: ProjectModel, tableId: string, groupId: string | null,
): ProjectModel {
  const table = model.tables[tableId]
  if (!table) return model
  if (groupId !== null && !Object.hasOwn(model.tableGroups, groupId)) return model
  if (table.groupId === groupId) return model
  return { ...model, tables: { ...model.tables, [tableId]: { ...table, groupId } } }
}

export function deleteGroup(model: ProjectModel, id: string): ProjectModel {
  if (!Object.hasOwn(model.tableGroups, id)) return model
  const tableGroups = { ...model.tableGroups }
  delete tableGroups[id]
  // 멤버 테이블은 보존하되 미배정으로 되돌린다.
  const tables = { ...model.tables }
  for (const [tid, t] of Object.entries(model.tables)) {
    if (t.groupId === id) tables[tid] = { ...t, groupId: null }
  }
  return { ...model, tableGroups, tables }
}
