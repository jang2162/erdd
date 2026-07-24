import type { Node } from '@xyflow/react'
import type { ProjectModel } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null,
): Node<TableNodeData>[] {
  return Object.values(model.tables).map((table) => ({
    id: table.id,
    type: 'table',
    position: table.position,
    data: {
      table,
      columns: Object.values(model.columns).filter((c) => c.tableId === table.id),
      viewMode,
      selected: table.id === selectedId,
    },
  }))
}
