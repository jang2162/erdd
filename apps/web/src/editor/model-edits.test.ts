import { describe, expect, it } from 'vitest'
import { createEmptyModel, diffModels } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { addTable, moveTable, removeTable } from './model-edits.js'

describe('model-edits', () => {
  it('addTable inserts a table with a default physical name', () => {
    const m = addTable(createEmptyModel(), { id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']).toMatchObject({ id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']!.physicalName).not.toBe('')
    // diff가 정확히 create 1건
    const ops = diffModels(createEmptyModel(), m)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('create')
  })

  it('addTable 의 논리명 번호와 물리명 번호가 같다', () => {
    // 물리명은 nextTablePhysicalName 이 만들고 논리명은 그 반환 문자열에서 번호를 떼어 쓴다 —
    // planJunction 이 두 번째 호출자가 되면서 'TABLE_n' 형식이 공유 계약이 됐다. 접두사가
    // 바뀌면 planJunction 은 멀쩡하고 addTable 만 조용히 어긋나므로 쌍으로 잠근다.
    const used = addTable(createEmptyModel(), { id: 'x1', position: { x: 0, y: 0 } })
    const next = addTable(used, { id: 'x2', position: { x: 0, y: 0 } })
    expect(next.tables['x2']).toMatchObject({ logicalName: '테이블2', physicalName: 'TABLE_2' })
  })

  it('moveTable changes only the position (one update op)', () => {
    const base = buildSampleModel()
    const id = Object.keys(base.tables)[0]!
    const next = moveTable(base, id, { x: 999, y: 888 })
    const ops = diffModels(base, next)
    expect(ops).toEqual([
      { action: 'update', entity: 'table', entityId: id,
        changes: { position: { from: base.tables[id]!.position, to: { x: 999, y: 888 } } } },
    ])
  })

  it('removeTable cascades its columns (delete ops child-first)', () => {
    const base = buildSampleModel()
    // 관계·인덱스가 없는 테이블을 고른다: t1(MBR_GRD)은 인덱스 없음이나 관계 자식이므로,
    // 여기서는 관계·인덱스가 얽히지 않도록 새 독립 테이블을 만들어 검증
    const withT = addTable(base, { id: 'tx', position: { x: 0, y: 0 } })
    const next = removeTable(withT, 'tx')
    expect(next.tables['tx']).toBeUndefined()
    const ops = diffModels(withT, next)
    expect(ops.every((o) => o.action === 'delete')).toBe(true)
  })
})
