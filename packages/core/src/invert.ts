import type { Op } from './op.js'

/**
 * 단일 op의 역연산. update의 from/to를 교환하고, create↔delete를 서로 바꾼다.
 * 반환하는 op의 data/before는 입력 op의 data/before와 참조를 공유한다(딥클론하지 않음).
 */
export function invertOp(op: Op): Op {
  if (op.action === 'create') {
    return { action: 'delete', entity: op.entity, entityId: op.entityId, before: op.data }
  }
  if (op.action === 'delete') {
    return { action: 'create', entity: op.entity, entityId: op.entityId, data: op.before }
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [prop, change] of Object.entries(op.changes)) {
    changes[prop] = { from: change.to, to: change.from }
  }
  return { action: 'update', entity: op.entity, entityId: op.entityId, changes }
}

/** 배치의 역연산 — 역순으로 각 op을 역변환한다. */
export function invertOps(ops: readonly Op[]): Op[] {
  return [...ops].reverse().map(invertOp)
}
