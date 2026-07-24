import type { Node } from '@xyflow/react'
import type { ProjectModel, Warning } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null, warnings: Warning[],
): Node<TableNodeData>[] {
  return Object.values(model.tables).map((table) => {
    const tableCols = Object.values(model.columns).filter((c) => c.tableId === table.id)
    const colIds = new Set(tableCols.map((c) => c.id))
    const relIds = new Set(Object.values(model.relationships)
      .filter((r) => r.parentTableId === table.id || r.childTableId === table.id).map((r) => r.id))
    const tableWarnings = warnings.filter((w) =>
      (w.scope === 'column' && w.tableId === table.id) || (w.scope === 'relationship' && relIds.has(w.entityId)))
    const columnWarnings: Record<string, Warning[]> = {}
    for (const w of warnings) {
      if (w.scope === 'column' && colIds.has(w.entityId)) {
        (columnWarnings[w.entityId] ??= []).push(w)
      }
    }
    return {
      id: table.id,
      type: 'table',
      position: table.position,
      data: {
        table,
        columns: tableCols,
        viewMode,
        selected: table.id === selectedId,
        tableWarnings,
        columnWarnings,
      },
    }
  })
}
