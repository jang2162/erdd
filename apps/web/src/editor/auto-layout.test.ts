import { describe, expect, it } from 'vitest'
import { computeAutoLayout, type LayoutNode, type LayoutEdge } from './auto-layout.js'

const N = (id: string): LayoutNode => ({ id, width: 200, height: 100 })
function overlaps(a: {x:number;y:number}, b: {x:number;y:number}, w=200, h=100): boolean {
  return Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h
}

describe('computeAutoLayout', () => {
  it('부모→자식은 자식이 아래 레이어에 배치된다(TB)', () => {
    const pos = computeAutoLayout([N('p'), N('c')], [{ source: 'p', target: 'c' }])
    expect(pos.get('c')!.y).toBeGreaterThan(pos.get('p')!.y)
  })
  it('노드들이 서로 겹치지 않는다', () => {
    const nodes = ['a','b','c','d'].map(N)
    const edges: LayoutEdge[] = [{source:'a',target:'b'},{source:'a',target:'c'},{source:'b',target:'d'}]
    const pos = computeAutoLayout(nodes, edges)
    const ids = nodes.map(n => n.id)
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++)
      expect(overlaps(pos.get(ids[i]!)!, pos.get(ids[j]!)!)).toBe(false)
  })
  it('순환 그래프도 모든 노드 좌표를 반환한다(무한루프 없음)', () => {
    const pos = computeAutoLayout([N('a'),N('b')], [{source:'a',target:'b'},{source:'b',target:'a'}])
    expect(pos.has('a')).toBe(true)
    expect(pos.has('b')).toBe(true)
  })
  it('자기 참조 엣지를 무시하고 처리한다', () => {
    const pos = computeAutoLayout([N('a')], [{source:'a',target:'a'}])
    expect(pos.get('a')).toBeDefined()
  })
})
