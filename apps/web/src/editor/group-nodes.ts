import type { Node } from '@xyflow/react'
import type { ProjectModel, TableGroup } from '@erdd/core'
import { GROUP_PAD, tableBounds } from './group-move.js'

export type GroupNodeData = { group: TableGroup; selected: boolean }

export function buildGroupNodes(
  model: ProjectModel, selectedGroupId: string | null, canEdit: boolean,
): Node<GroupNodeData>[] {
  const nodes: Node<GroupNodeData>[] = []
  for (const group of Object.values(model.tableGroups)) {
    const members = Object.values(model.tables).filter((t) => t.groupId === group.id)
    const b = tableBounds(model, members)
    if (b === null) continue
    nodes.push({
      id: `group:${group.id}`,
      type: 'group',
      position: { x: b.minX - GROUP_PAD, y: b.minY - GROUP_PAD },
      width: b.maxX - b.minX + GROUP_PAD * 2,
      height: b.maxY - b.minY + GROUP_PAD * 2,
      selectable: false,
      draggable: canEdit,
      zIndex: 0,
      data: { group, selected: group.id === selectedGroupId },
    })
  }
  return nodes
}
