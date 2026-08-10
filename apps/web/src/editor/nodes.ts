import type { Node } from '@xyflow/react'
import type { ProjectModel, Warning } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'
import type { PeerMarks } from './peer-marks.js'

export type NodeView = { kind: 'full' } | { kind: 'group'; groupId: string }

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: ReadonlySet<string>, warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
): Node<TableNodeData>[] {
  const tables = Object.values(model.tables).filter(
    (t) => view.kind === 'full' || t.groupId === view.groupId,
  )
  return tables.map((table) => {
    const tableCols = Object.values(model.columns).filter((c) => c.tableId === table.id)
    const colIds = new Set(tableCols.map((c) => c.id))
    const relIds = new Set(Object.values(model.relationships)
      .filter((r) => r.parentTableId === table.id || r.childTableId === table.id).map((r) => r.id))
    const tableWarnings = warnings.filter((w) =>
      (w.scope === 'table' && w.entityId === table.id)
      || (w.scope === 'column' && w.tableId === table.id)
      || (w.scope === 'relationship' && relIds.has(w.entityId)))
    const columnWarnings: Record<string, Warning[]> = {}
    for (const w of warnings) {
      if (w.scope === 'column' && colIds.has(w.entityId)) {
        (columnWarnings[w.entityId] ??= []).push(w)
      }
    }
    const position = view.kind === 'group' ? (table.groupPosition ?? table.position) : table.position
    const isSelected = selectedIds.has(table.id)
    return {
      id: table.id,
      type: 'table',
      position,
      // ReactFlow 내부 선택과 store를 맞춘다 — 박스 선택이 이 값을 읽고 쓴다.
      selected: isSelected,
      data: {
        table,
        columns: tableCols,
        viewMode,
        selected: isSelected,
        tableWarnings,
        columnWarnings,
        peers: peerMarks.get(table.id),
      },
    }
  })
}
