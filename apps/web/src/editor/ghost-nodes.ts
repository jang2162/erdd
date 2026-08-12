import type { Node } from '@xyflow/react'
import type { ProjectModel, Table } from '@erdd/core'
import { buildAnchors, type Anchor, type AnchorIndex } from './anchors.js'

export type GhostNodeData = {
  table: Table
  targetGroupId: string | null
  /** 원본 테이블의 앵커 전체. 고스트에는 컬럼 행이 없어 전부 헤더 중앙에 겹쳐 렌더된다. */
  anchors: Anchor[]
}

export function buildGhostNodes(
  model: ProjectModel, groupId: string, anchors: AnchorIndex = buildAnchors(model),
): Node<GhostNodeData>[] {
  const memberIds = new Set(
    Object.values(model.tables).filter((t) => t.groupId === groupId).map((t) => t.id),
  )
  const externalIds = new Set<string>()
  for (const rel of Object.values(model.relationships)) {
    const pIn = memberIds.has(rel.parentTableId)
    const cIn = memberIds.has(rel.childTableId)
    if (pIn && !cIn) externalIds.add(rel.childTableId)
    if (cIn && !pIn) externalIds.add(rel.parentTableId)
  }
  const ghosts: Node<GhostNodeData>[] = []
  for (const id of externalIds) {
    const table = model.tables[id]
    if (!table) continue
    ghosts.push({
      // 노드 id는 원본 테이블 id를 그대로 쓴다. 그래야 buildEdges가 원본 id로 만든
      // 관계 엣지의 끝점이 이 고스트 노드로 해석되어 그룹↔외부 선이 렌더된다.
      id,
      type: 'ghost',
      position: table.position,
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
      data: { table, targetGroupId: table.groupId, anchors: anchors.byTable.get(id) ?? [] },
    })
  }
  return ghosts
}
