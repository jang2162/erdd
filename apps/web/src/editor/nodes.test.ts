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
