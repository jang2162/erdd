import type { ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, ENTITY_KINDS, type Op } from './op.js'
import { deepEqual } from './equal.js'

/**
 * base → target으로 가는 op 배치.
 * 순서 보장: create는 ENTITY_KINDS(부모 우선) 순, update는 그 다음, delete는 역순(자식 우선)
 * — applyOps(base, diffModels(base, target))가 무결성 검사를 항상 통과하도록.
 * 전제: target은 무결성이 유효한 모델이어야 한다(validateModelIntegrity(target) === []).
 * 예외: base에만 있고 target에는 없는 속성 때문에 deepEqual이 다르다고 판단해도,
 * target 기준으로 실제 변경된 속성이 없으면 update op를 만들지 않는다(그 결과 base의
 * 값이 그대로 보존된다) — 값 없는 update op로 인한 persistOps 실패를 막기 위해서다.
 * 반환하는 op의 payload(data/changes의 from·to)는 base·target 엔티티의 참조를 그대로
 * 공유한다(딥클론하지 않음) — 호출 측은 base와 target을 이후 불변 값으로 다뤄야 한다.
 */
export function diffModels(base: ProjectModel, target: ProjectModel): Op[] {
  const creates: Op[] = []
  const updates: Op[] = []
  const deletes: Op[] = []

  for (const kind of ENTITY_KINDS) {
    const baseCol = base[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>
    const targetCol = target[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>

    for (const [id, entity] of Object.entries(targetCol)) {
      if (!Object.hasOwn(baseCol, id)) {
        creates.push({ action: 'create', entity: kind, entityId: id, data: entity })
      } else {
        const existing = baseCol[id]!
        if (!deepEqual(existing, entity)) {
          const changes: Record<string, { from: unknown; to: unknown }> = {}
          for (const prop of Object.keys(entity)) {
            if (!deepEqual(existing[prop], entity[prop])) {
              changes[prop] = { from: existing[prop], to: entity[prop] }
            }
          }
          // base에만 있는 속성(구 스냅샷의 table에 custom 키가 없는 경우) 때문에 deepEqual은
          // 다르다고 보지만 target 기준 변경점은 없을 수 있다. 이때 빈 changes를 내보내면
          // persistOps가 값 없는 UPDATE를 실행해 실패한다 → 그런 op는 만들지 않는다.
          if (Object.keys(changes).length > 0) {
            updates.push({ action: 'update', entity: kind, entityId: id, changes })
          }
        }
      }
    }

    for (const [id, entity] of Object.entries(baseCol)) {
      if (!Object.hasOwn(targetCol, id)) {
        deletes.push({ action: 'delete', entity: kind, entityId: id, before: entity })
      }
    }
  }

  deletes.reverse()
  return [...creates, ...updates, ...deletes]
}
