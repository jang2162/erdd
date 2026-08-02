import type { Node } from '@xyflow/react'
import type { ProjectModel, TableGroup } from '@erdd/core'

export type GroupNodeData = { group: TableGroup; selected: boolean }

const EST_W = 260
const PAD = 28

function estHeight(colCount: number): number {
  return 44 + Math.max(1, colCount) * 28
}

export function buildGroupNodes(
  model: ProjectModel, selectedGroupId: string | null, canEdit: boolean,
): Node<GroupNodeData>[] {
  const nodes: Node<GroupNodeData>[] = []
  for (const group of Object.values(model.tableGroups)) {
    const members = Object.values(model.tables).filter((t) => t.groupId === group.id)
    if (members.length === 0) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const t of members) {
      const cols = Object.values(model.columns).filter((c) => c.tableId === t.id).length
      minX = Math.min(minX, t.position.x)
      minY = Math.min(minY, t.position.y)
      maxX = Math.max(maxX, t.position.x + EST_W)
      maxY = Math.max(maxY, t.position.y + estHeight(cols))
    }
    nodes.push({
      id: `group:${group.id}`,
      type: 'group',
      position: { x: minX - PAD, y: minY - PAD },
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD * 2,
      selectable: false,
      draggable: canEdit,
      zIndex: 0,
      data: { group, selected: group.id === selectedGroupId },
    })
  }
  return nodes
}
