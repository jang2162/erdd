import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from './op.js'
import { invertOp, invertOps } from './invert.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('invert', () => {
  it('inverts create to delete, delete to create, update by swapping', () => {
    const data = { id: 'n2', content: 'x', position: { x: 0, y: 0 }, color: '#fff' }
    expect(invertOp({ action: 'create', entity: 'note', entityId: 'n2', data })).toEqual({
      action: 'delete', entity: 'note', entityId: 'n2', before: data,
    })
    expect(invertOp({ action: 'delete', entity: 'note', entityId: 'n2', before: data })).toEqual({
      action: 'create', entity: 'note', entityId: 'n2', data,
    })
    expect(
      invertOp({
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' } },
      }),
    ).toEqual({
      action: 'update', entity: 'column', entityId: 'c3',
      changes: { logicalName: { from: '고객명', to: '회원명' } },
    })
  })

  it('round-trips: apply(apply(A, ops), invertOps(ops)) equals A', () => {
    const base = buildSampleModel()
    const ops: Op[] = [
      {
        action: 'create', entity: 'note', entityId: 'n2',
        data: { id: 'n2', content: '새 메모', position: { x: 1, y: 2 }, color: '#FFFFFF' },
      },
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' }, order: { from: 1, to: 5 } },
      },
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'note', entityId: 'n1', before: base.notes.n1 },
    ]
    const after = applyOps(base, ops)
    const restored = applyOps(after, invertOps(ops))
    expect(restored).toEqual(base)
  })

  it('invertOps reverses order so dependent creates/deletes round-trip', () => {
    const base = buildSampleModel()
    // 캐스케이드 삭제(자식 먼저) → 역변환은 생성이 부모 먼저여야 무결성 통과
    const ops: Op[] = [
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'relationship', entityId: 'r1', before: base.relationships.r1 },
      { action: 'delete', entity: 'column', entityId: 'c2', before: base.columns.c2 },
      { action: 'delete', entity: 'column', entityId: 'c3', before: base.columns.c3 },
      { action: 'delete', entity: 'column', entityId: 'c4', before: base.columns.c4 },
      { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 },
    ]
    const after = applyOps(base, ops)
    expect(applyOps(after, invertOps(ops))).toEqual(base)
  })
})
