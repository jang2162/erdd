import { describe, expect, it } from 'vitest'
import { buildGroupNodes } from './group-nodes.js'
import { createEmptyModel, type ProjectModel, type Table } from '@erdd/core'

function tbl(id: string, x: number, y: number, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x, y }, groupPosition: null }
}
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['G1'] = { id: 'G1', name: '회원', color: '#0E7A6C', comment: null }
  m.tables['T1'] = tbl('T1', 0, 0, 'G1')
  m.tables['T2'] = tbl('T2', 400, 200, 'G1')
  m.tables['T3'] = tbl('T3', 1000, 0, null) // 미분류
  return m
}

describe('buildGroupNodes', () => {
  it('멤버가 있는 그룹마다 영역 노드를 만든다', () => {
    const nodes = buildGroupNodes(model(), null)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.id).toBe('group:G1')
    expect(nodes[0]!.type).toBe('group')
    expect(nodes[0]!.selectable).toBe(false)
    expect(nodes[0]!.draggable).toBe(true)
  })
  it('영역이 멤버 위치를 포함한다(좌상단은 최소 위치보다 작거나 같다)', () => {
    const n = buildGroupNodes(model(), null)[0]!
    expect(n.position.x).toBeLessThanOrEqual(0)
    expect(n.position.y).toBeLessThanOrEqual(0)
    expect(typeof n.width).toBe('number')
    expect(n.width!).toBeGreaterThan(400)
  })
  it('멤버가 없는 그룹은 노드를 만들지 않는다', () => {
    const m = createEmptyModel()
    m.tableGroups['G1'] = { id: 'G1', name: '빈그룹', color: '#000', comment: null }
    expect(buildGroupNodes(m, null)).toHaveLength(0)
  })
  it('selectedGroupId면 selected=true', () => {
    const n = buildGroupNodes(model(), 'G1')[0]!
    expect((n.data as { selected: boolean }).selected).toBe(true)
  })
})
