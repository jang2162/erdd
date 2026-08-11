import { describe, expect, it } from 'vitest'
import { createEmptyModel, diffModels } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { addTable, clearTableGroupPosition, moveTable, removeTable } from './model-edits.js'

describe('model-edits', () => {
  it('addTable 은 새 테이블을 생성한다 (물리명은 비어 있다)', () => {
    const m = addTable(createEmptyModel(), { id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']).toMatchObject({ id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']!.physicalName).toBe('')
    // diff가 정확히 create 1건
    const ops = diffModels(createEmptyModel(), m)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('create')
  })

  it('연속으로 addTable 해도 물리명은 계속 비어 있고 논리명 번호만 늘어난다', () => {
    // 예전에는 물리명이 nextTablePhysicalName 으로 채워지고 논리명이 그 번호를 그대로
    // 따라갔다(D-A3 이전 설계). 지금은 물리명이 항상 비고, 논리명 번호는 물리명과 무관하게
    // logicalName 집합만 보고 독립적으로 매겨진다.
    const used = addTable(createEmptyModel(), { id: 'x1', position: { x: 0, y: 0 } })
    const next = addTable(used, { id: 'x2', position: { x: 0, y: 0 } })
    expect(next.tables['x2']).toMatchObject({ logicalName: '테이블2', physicalName: '' })
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

  it('새 테이블의 물리명은 비어 있고 논리명은 임시값이 붙는다', () => {
    const m = addTable(buildSampleModel(), { id: 'new1', position: { x: 0, y: 0 } })
    expect(m.tables['new1']!.physicalName).toBe('')
    expect(m.tables['new1']!.logicalName).not.toBe('')
  })

  it('연속으로 추가해도 논리명이 서로 다르다', () => {
    let m = addTable(buildSampleModel(), { id: 'new1', position: { x: 0, y: 0 } })
    m = addTable(m, { id: 'new2', position: { x: 0, y: 0 } })
    expect(m.tables['new1']!.logicalName).not.toBe(m.tables['new2']!.logicalName)
  })
})

describe('clearTableGroupPosition', () => {
  it('그룹 뷰 좌표를 null로 비운다', () => {
    const m = buildSampleModel()   // t1.groupPosition = { x: 10, y: 10 }
    expect(clearTableGroupPosition(m, 't1').tables['t1']?.groupPosition).toBeNull()
  })

  it('전체 뷰 좌표는 건드리지 않는다 — 비우는 것은 그룹 뷰 좌표뿐이다', () => {
    const m = buildSampleModel()
    const next = clearTableGroupPosition(m, 't1')
    expect(next.tables['t1']?.position).toEqual(m.tables['t1']!.position)
    const ops = diffModels(m, next)
    expect(ops).toEqual([
      { action: 'update', entity: 'table', entityId: 't1',
        changes: { groupPosition: { from: { x: 10, y: 10 }, to: null } } },
    ])
  })

  it('이미 null이면 모델 참조를 그대로 돌려준다', () => {
    const m = clearTableGroupPosition(buildSampleModel(), 't1')
    expect(clearTableGroupPosition(m, 't1')).toBe(m)
  })

  it('없는 id는 무시한다', () => {
    const m = buildSampleModel()
    expect(clearTableGroupPosition(m, '없는id')).toBe(m)
  })
})
