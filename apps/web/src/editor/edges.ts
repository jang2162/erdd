import type { Edge } from '@xyflow/react'
import type { ProjectModel } from '@erdd/core'

export type RelationshipEdgeData = {
  cardinality: '1:1' | '1:N'
  identifying: boolean
}

export function buildEdges(model: ProjectModel, visibleTableIds?: Set<string>): Edge[] {
  const edges: Edge[] = []
  for (const rel of Object.values(model.relationships)) {
    if (visibleTableIds && (!visibleTableIds.has(rel.parentTableId) || !visibleTableIds.has(rel.childTableId))) {
      continue
    }
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    // 자식이 부모보다 오른쪽이면 자식의 왼쪽 핸들 → 부모의 오른쪽 핸들.
    const childRight = !!parent && !!child && child.position.x >= parent.position.x
    edges.push({
      id: rel.id,
      source: rel.childTableId,
      target: rel.parentTableId,
      sourceHandle: childRight ? 'l' : 'r',
      targetHandle: childRight ? 'r' : 'l',
      type: 'relationship',
      data: { cardinality: rel.cardinality, identifying: rel.identifying },
    })
  }
  return edges
}

export type ConnectionPlan =
  | { ok: false; reason: 'invalid' | 'self' | 'no-parent-pk' }
  | { ok: true; parentTableId: string; childTableId: string; relationshipId: string; newColumnIds: string[] }

/**
 * 캔버스 드래그(자식→부모)를 관계 생성 계획으로 변환한다. 순수 함수(genId 주입).
 * source=자식, target=부모. 부모 PK가 없으면 no-parent-pk.
 */
export function planConnection(
  model: ProjectModel,
  conn: { source: string | null; target: string | null },
  genId: () => string,
): ConnectionPlan {
  if (!conn.source || !conn.target) return { ok: false, reason: 'invalid' }
  if (conn.source === conn.target) return { ok: false, reason: 'self' }
  const parentTableId = conn.target
  const childTableId = conn.source
  const pkCount = Object.values(model.columns).filter(
    (c) => c.tableId === parentTableId && c.isPk,
  ).length
  if (pkCount === 0) return { ok: false, reason: 'no-parent-pk' }
  return {
    ok: true,
    parentTableId,
    childTableId,
    relationshipId: genId(),
    newColumnIds: Array.from({ length: pkCount }, () => genId()),
  }
}
