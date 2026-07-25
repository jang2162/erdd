import type { Node } from '@xyflow/react'
import type { ProjectModel, Table } from '@erdd/core'

export type GhostNodeData = { table: Table; targetGroupId: string | null }

export function buildGhostNodes(model: ProjectModel, groupId: string): Node<GhostNodeData>[] {
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
      id: `ghost:${id}`,
      type: 'ghost',
      position: table.position,
      draggable: false,
      selectable: false,
      zIndex: 1,
      data: { table, targetGroupId: table.groupId },
    })
  }
  return ghosts
}
