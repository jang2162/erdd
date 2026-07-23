import { describe, expect, it } from 'vitest'
import { applyOps, OpApplyError, type Op } from './op.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('applyOps', () => {
  it('applies create/update/delete and does not mutate the input model', () => {
    const base = buildSampleModel()
    const frozen = JSON.parse(JSON.stringify(base))
    const ops: Op[] = [
      {
        action: 'create', entity: 'note', entityId: 'n2',
        data: { id: 'n2', content: '새 메모', position: { x: 1, y: 2 }, color: '#FFFFFF' },
      },
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' } },
      },
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
    ]
    const next = applyOps(base, ops)
    expect(next.notes.n2?.content).toBe('새 메모')
    expect(next.columns.c3?.logicalName).toBe('고객명')
    expect(next.indexes.i1).toBeUndefined()
    expect(base).toEqual(frozen) // 입력 불변
  })

  it('rejects creating an entity whose id already exists', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n1',
      data: { id: 'n1', content: 'dup', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects create when data.id does not match entityId', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n2',
      data: { id: 'n9', content: 'x', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects update of a missing entity and update of the id property', () => {
    const base = buildSampleModel()
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 'missing', changes: { comment: { from: null, to: 'x' } } },
      ]),
    ).toThrow(OpApplyError)
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 't1', changes: { id: { from: 't1', to: 't9' } } },
      ]),
    ).toThrow(OpApplyError)
  })

  it('rejects update that produces a schema-invalid entity', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'update', entity: 'column', entityId: 'c3',
      changes: { order: { from: 1, to: 1.5 } }, // order는 정수여야 함
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects a batch that breaks referential integrity', () => {
    const base = buildSampleModel()
    // 컬럼·관계·인덱스를 남긴 채 테이블만 삭제 → 무결성 위반
    const op: Op = { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('accepts a full cascade delete batch', () => {
    const base = buildSampleModel()
    const ops: Op[] = [
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'relationship', entityId: 'r1', before: base.relationships.r1 },
      { action: 'delete', entity: 'column', entityId: 'c2', before: base.columns.c2 },
      { action: 'delete', entity: 'column', entityId: 'c3', before: base.columns.c3 },
      { action: 'delete', entity: 'column', entityId: 'c4', before: base.columns.c4 },
      { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 },
    ]
    const next = applyOps(base, ops)
    expect(next.tables.t2).toBeUndefined()
    expect(Object.keys(next.columns)).toEqual(['c1'])
  })
})
