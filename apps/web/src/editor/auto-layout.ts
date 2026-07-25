import dagre from '@dagrejs/dagre'

export type LayoutNode = { id: string; width: number; height: number }
export type LayoutEdge = { source: string; target: string } // parent -> child (FK 참조 방향)

/** dagre 계층 배치. 반환 좌표는 React Flow 기준(노드 좌상단). */
export function computeAutoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { rankdir?: 'TB' | 'LR'; ranksep?: number; nodesep?: number } = {},
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: opts.rankdir ?? 'TB', ranksep: opts.ranksep ?? 80, nodesep: opts.nodesep ?? 60 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  for (const e of edges) if (e.source !== e.target) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const dn = g.node(n.id) // dagre는 중심 좌표 → 좌상단으로 변환
    out.set(n.id, { x: dn.x - n.width / 2, y: dn.y - n.height / 2 })
  }
  return out
}
