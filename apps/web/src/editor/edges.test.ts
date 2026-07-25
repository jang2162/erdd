import { describe, expect, it } from 'vitest'
import { buildEdges, planConnection } from './edges.js'
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

describe('buildEdges 핸들 휴리스틱', () => {
  it('자식이 부모 오른쪽이면 source=l,target=r', () => {
    const edges = buildEdges(model()) // model(): C.x(400) >= P.x(0)
    expect(edges[0]!.sourceHandle).toBe('l')
    expect(edges[0]!.targetHandle).toBe('r')
  })
  it('참조 테이블이 없어도 throw하지 않는다', () => {
    const m = createEmptyModel()
    m.relationships['R'] = { id: 'R', parentTableId: 'GONE', childTableId: 'ALSO_GONE', columnMappings: [], cardinality: '1:N', identifying: false, name: null }
    expect(() => buildEdges(m)).not.toThrow()
    expect(buildEdges(m)).toHaveLength(1)
  })
  it('visibleTableIds가 주어지면 양 끝이 모두 포함된 엣지만 반환한다', () => {
    const m = model() // P(부모)·C(자식) 관계 R 하나
    expect(buildEdges(m, new Set(['P', 'C']))).toHaveLength(1)
    expect(buildEdges(m, new Set(['C']))).toHaveLength(0)     // 부모 미포함 → 제외
    expect(buildEdges(m, new Set())).toHaveLength(0)
  })
})

describe('planConnection', () => {
  const gen = () => { let n = 0; return () => `id${++n}` }
  it('source=자식, target=부모로 매핑하고 부모 PK 수만큼 컬럼 id를 만든다', () => {
    const m = model() // P(부모)·C(자식). model()의 P에는 기본적으로 PK 컬럼이 없으므로 여기서 추가.
    m.columns['PPK'] = { id: 'PPK', tableId: 'P', logicalName: 'PPK', physicalName: 'ID', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null }
    const plan = planConnection(m, { source: 'C', target: 'P' }, gen())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.parentTableId).toBe('P')
      expect(plan.childTableId).toBe('C')
      expect(plan.newColumnIds).toHaveLength(1)
    }
  })
  it('자기 연결은 거부한다', () => {
    expect(planConnection(model(), { source: 'A', target: 'A' }, gen())).toEqual({ ok: false, reason: 'self' })
  })
  it('source/target 누락은 invalid', () => {
    expect(planConnection(model(), { source: null, target: 'P' }, gen())).toEqual({ ok: false, reason: 'invalid' })
  })
  it('부모 PK가 없으면 no-parent-pk', () => {
    const plan = planConnection(model(), { source: 'C', target: 'P' }, gen()) // model()의 P에 PK 없음
    expect(plan).toEqual({ ok: false, reason: 'no-parent-pk' })
  })
  it('복합 PK면 컬럼 id를 그 수만큼 만든다', () => {
    const m = model()
    m.columns['PPK1'] = { id: 'PPK1', tableId: 'P', logicalName: 'a', physicalName: 'A', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null }
    m.columns['PPK2'] = { id: 'PPK2', tableId: 'P', logicalName: 'b', physicalName: 'B', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 1, comment: null }
    const plan = planConnection(m, { source: 'C', target: 'P' }, gen())
    if (plan.ok) expect(plan.newColumnIds).toHaveLength(2)
    else throw new Error('expected ok')
  })
})
