import { describe, expect, it } from 'vitest'
import { buildNodes } from './nodes.js'
import { createEmptyModel, type Column, type ProjectModel, type Table } from '@erdd/core'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string): Column {
  return { id, tableId, logicalName: id, physicalName: id, type: 'VARCHAR(10)',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
    order: 0, comment: null, domainId: null, custom: {} }
}
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['T1'] = tbl('T1')
  m.tables['T2'] = tbl('T2')
  m.columns['C1'] = col('C1', 'T1')
  m.columns['C2'] = col('C2', 'T2')
  return m
}

describe('buildNodes — 컬럼 선택 전달', () => {
  // 불변식: 컬럼 선택은 한 테이블에만 존재한다. buildNodes는 selectedIds가 정확히 그 테이블
  // 하나만 가리킬 때만 selectedColumnIds를 실어야 하고, 나머지(다른 테이블·미선택·다중 선택)
  // 노드에는 빈 배열을 실어야 한다.
  it('선택된 테이블 하나에만 selectedColumnIds를 싣는다', () => {
    const nodes = buildNodes(model(), 'physical', ['T1'], [], undefined, undefined,
      { selectedColumnIds: ['C1'] })
    const t1 = nodes.find((n) => n.id === 'T1')!
    const t2 = nodes.find((n) => n.id === 'T2')!
    expect(t1.data.selectedColumnIds).toEqual(['C1'])
    expect(t2.data.selectedColumnIds).toEqual([])
  })

  it('테이블이 선택되지 않았으면 모든 노드가 빈 배열을 받는다', () => {
    const nodes = buildNodes(model(), 'physical', [], [], undefined, undefined,
      { selectedColumnIds: ['C1'] })
    for (const n of nodes) expect(n.data.selectedColumnIds).toEqual([])
  })

  it('테이블이 여러 개 선택됐으면(다중 선택) 어느 노드도 selectedColumnIds를 받지 않는다', () => {
    const nodes = buildNodes(model(), 'physical', ['T1', 'T2'], [], undefined, undefined,
      { selectedColumnIds: ['C1'] })
    for (const n of nodes) expect(n.data.selectedColumnIds).toEqual([])
  })
})

describe('buildNodes — React Flow 선택 플래그', () => {
  /*
   * `data.selected`는 TableNode가 선택 링을 그리는 데 쓰고, 최상위 `selected`는 **React Flow 자신의**
   * 선택 상태다. canvas.tsx는 store가 바뀔 때마다 노드 배열을 통째로 교체하므로(setNodes(derived)),
   * 최상위 플래그를 store 기준으로 세우지 않으면 재구성이 React Flow의 선택을 지운다 —
   * 선택이라는 같은 사실이 store와 React Flow 두 곳에 따로 살아 어긋난다. 여기서는 store를
   * 단일 진실 원본으로 두고 React Flow가 그것을 비추게 한다.
   */
  it('선택된 테이블만 최상위 selected가 true다', () => {
    const nodes = buildNodes(model(), 'physical', ['T2'], [])
    expect(nodes.find((n) => n.id === 'T1')!.selected).toBe(false)
    expect(nodes.find((n) => n.id === 'T2')!.selected).toBe(true)
  })

  it('다중 선택이면 선택된 테이블 전부가 true다', () => {
    const nodes = buildNodes(model(), 'physical', ['T1', 'T2'], [])
    for (const n of nodes) expect(n.selected).toBe(true)
  })
})
