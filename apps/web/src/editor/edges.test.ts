import { describe, expect, it } from 'vitest'
import { buildEdges } from './edges.js'
import type { ProjectModel } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { id: 'P', logicalName: 'P', physicalName: 'P', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
  m.tables['C'] = { id: 'C', logicalName: 'C', physicalName: 'C', comment: null, groupId: null, position: { x: 400, y: 0 }, groupPosition: null }
  m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C', columnMappings: [], cardinality: '1:N', identifying: false, name: null }
  return m
}

describe('buildEdges', () => {
  it('관계마다 엣지를 만들고 id는 관계 id다', () => {
    const edges = buildEdges(model())
    expect(edges).toHaveLength(1)
    expect(edges[0]!.id).toBe('R')
    expect(edges[0]!.type).toBe('relationship')
  })
  it('source=자식, target=부모', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.source).toBe('C')
    expect(edges[0]!.target).toBe('P')
  })
  it('엣지 data에 카디널리티·식별 여부를 담는다', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.data).toMatchObject({ cardinality: '1:N', identifying: false })
  })
})
