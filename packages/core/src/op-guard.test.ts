import { describe, expect, it } from 'vitest'
import { OpParseError, parseOps } from './op-guard.js'

const UUID = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e6f'

describe('parseOps', () => {
  it('accepts a valid mixed batch and returns typed ops', () => {
    const ops = parseOps([
      { action: 'create', entity: 'note', entityId: UUID, data: { id: UUID } },
      { action: 'update', entity: 'column', entityId: UUID, changes: { logicalName: { from: 'a', to: 'b' } } },
      { action: 'delete', entity: 'table', entityId: UUID, before: null },
    ])
    expect(ops).toHaveLength(3)
    expect(ops[0]!.action).toBe('create')
  })

  it('rejects non-array input and empty batches', () => {
    expect(() => parseOps('nope')).toThrow(OpParseError)
    expect(() => parseOps([])).toThrow(OpParseError)
  })

  it('rejects unknown action/entity and non-uuid entityId', () => {
    expect(() => parseOps([{ action: 'upsert', entity: 'note', entityId: UUID, data: {} }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'create', entity: 'widget', entityId: UUID, data: {} }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'create', entity: 'note', entityId: 't1', data: {} }]))
      .toThrow(OpParseError)
  })

  it('rejects structurally broken ops with the op index in the message', () => {
    expect(() =>
      parseOps([
        { action: 'create', entity: 'note', entityId: UUID, data: {} },
        { action: 'update', entity: 'note', entityId: UUID, changes: { x: { to: 1 } } },
      ]),
    ).toThrow(/op\[1\]/)
    expect(() => parseOps([{ action: 'delete', entity: 'note', entityId: UUID }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'update', entity: 'note', entityId: UUID, changes: {} }]))
      .toThrow(OpParseError)
  })

  it('rejects dangerous property names in changes', () => {
    expect(() =>
      parseOps([{
        action: 'update', entity: 'note', entityId: UUID,
        changes: JSON.parse('{"__proto__": {"from": 1, "to": 2}}'),
      }]),
    ).toThrow(OpParseError)
  })
})
