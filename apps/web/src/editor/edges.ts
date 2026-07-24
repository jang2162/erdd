import type { Edge } from '@xyflow/react'
import type { ProjectModel } from '@erdd/core'

export type RelationshipEdgeData = {
  cardinality: '1:1' | '1:N'
  identifying: boolean
}

export function buildEdges(model: ProjectModel): Edge[] {
  return Object.values(model.relationships).map((rel) => {
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    // 자식이 부모보다 오른쪽이면 자식의 왼쪽 핸들 → 부모의 오른쪽 핸들.
    const childRight = !!parent && !!child && child.position.x >= parent.position.x
    return {
      id: rel.id,
      source: rel.childTableId,
      target: rel.parentTableId,
      sourceHandle: childRight ? 'l' : 'r',
      targetHandle: childRight ? 'r' : 'l',
      type: 'relationship',
      data: { cardinality: rel.cardinality, identifying: rel.identifying },
    }
  })
}
