import type { IndexDef, ProjectModel } from './model.js'

export function createIndex(
  model: ProjectModel,
  args: { id: string; tableId: string; name: string; unique?: boolean; columns?: IndexDef['columns'] },
): ProjectModel {
  if (!model.tables[args.tableId]) return model
  if (Object.hasOwn(model.indexes, args.id)) return model
  const index: IndexDef = {
    id: args.id, tableId: args.tableId, name: args.name,
    unique: args.unique ?? false, columns: args.columns ?? [],
  }
  return { ...model, indexes: { ...model.indexes, [args.id]: index } }
}

export function updateIndex(
  model: ProjectModel, id: string,
  patch: Partial<Pick<IndexDef, 'name' | 'unique' | 'columns'>>,
): ProjectModel {
  const index = model.indexes[id]
  if (!index) return model
  return { ...model, indexes: { ...model.indexes, [id]: { ...index, ...patch } } }
}

export function removeIndex(model: ProjectModel, id: string): ProjectModel {
  if (!Object.hasOwn(model.indexes, id)) return model
  const indexes = { ...model.indexes }
  delete indexes[id]
  return { ...model, indexes }
}
