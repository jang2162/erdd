import { ENTITY_KINDS, type EntityKind, type Op } from './op.js'

export class OpParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpParseError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ['create', 'update', 'delete'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 신뢰할 수 없는 입력을 Op 배열로 검증한다. 의미 검증(스키마·무결성)은 applyOps의 몫. */
export function parseOps(value: unknown): Op[] {
  if (!Array.isArray(value)) throw new OpParseError('ops는 배열이어야 합니다')
  if (value.length === 0) throw new OpParseError('ops가 비어 있습니다')

  return value.map((raw, i): Op => {
    const label = `op[${i}]`
    if (!isRecord(raw)) throw new OpParseError(`${label}: 객체가 아닙니다`)
    const action = raw.action
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      throw new OpParseError(`${label}: 알 수 없는 action`)
    }
    const entity = raw.entity
    if (typeof entity !== 'string' || !(ENTITY_KINDS as readonly string[]).includes(entity)) {
      throw new OpParseError(`${label}: 알 수 없는 entity`)
    }
    const entityId = raw.entityId
    if (typeof entityId !== 'string' || !UUID_RE.test(entityId)) {
      throw new OpParseError(`${label}: entityId는 UUID여야 합니다`)
    }

    if (action === 'create') {
      if (!isRecord(raw.data)) throw new OpParseError(`${label}: create에는 data 객체가 필요합니다`)
      return { action: 'create' as const, entity: entity as EntityKind, entityId, data: raw.data }
    }
    if (action === 'delete') {
      if (!('before' in raw)) throw new OpParseError(`${label}: delete에는 before가 필요합니다`)
      return { action: 'delete' as const, entity: entity as EntityKind, entityId, before: raw.before }
    }
    const changes = raw.changes
    if (!isRecord(changes) || Object.keys(changes).length === 0) {
      throw new OpParseError(`${label}: update에는 비어 있지 않은 changes가 필요합니다`)
    }
    const parsed: Record<string, { from: unknown; to: unknown }> = Object.create(null)
    for (const [prop, change] of Object.entries(changes)) {
      if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') {
        throw new OpParseError(`${label}: 허용되지 않는 속성 이름(${prop})`)
      }
      if (!isRecord(change) || !('from' in change) || !('to' in change)) {
        throw new OpParseError(`${label}: changes.${prop}에는 from/to가 필요합니다`)
      }
      parsed[prop] = { from: change.from, to: change.to }
    }
    return { action: 'update' as const, entity: entity as EntityKind, entityId, changes: parsed }
  })
}
