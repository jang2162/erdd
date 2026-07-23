import type { ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, ENTITY_KINDS, type Op } from './op.js'
import { deepEqual } from './equal.js'

/**
 * base → target으로 가는 op 배치.
 * 순서 보장: create는 ENTITY_KINDS(부모 우선) 순, update는 그 다음, delete는 역순(자식 우선)
 * — applyOps(base, diffModels(base, target))가 무결성 검사를 항상 통과하도록.
 */
export function diffModels(base: ProjectModel, target: ProjectModel): Op[] {
  const creates: Op[] = []
  const updates: Op[] = []
  const deletes: Op[] = []

  for (const kind of ENTITY_KINDS) {
    const baseCol = base[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>
    const targetCol = target[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>

    for (const [id, entity] of Object.entries(targetCol)) {
      const existing = baseCol[id]
      if (!existing) {
        creates.push({ action: 'create', entity: kind, entityId: id, data: entity })
      } else if (!deepEqual(existing, entity)) {
        const changes: Record<string, { from: unknown; to: unknown }> = {}
        for (const prop of Object.keys(entity)) {
          if (!deepEqual(existing[prop], entity[prop])) {
            changes[prop] = { from: existing[prop], to: entity[prop] }
          }
        }
        updates.push({ action: 'update', entity: kind, entityId: id, changes })
      }
    }

    for (const [id, entity] of Object.entries(baseCol)) {
      if (!targetCol[id]) {
        deletes.push({ action: 'delete', entity: kind, entityId: id, before: entity })
      }
    }
  }

  deletes.reverse()
  return [...creates, ...updates, ...deletes]
}
