import type { Node } from '@xyflow/react'
import type { ProjectModel, Warning } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'
import type { PeerMarks } from './peer-marks.js'

export type NodeView = { kind: 'full' } | { kind: 'group'; groupId: string }

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: string[], warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
  columnSelection: {
    selectedColumnIds?: string[]
    onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  } = {},
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
    return {
      id: table.id,
      type: 'table',
      position,
      data: {
        table,
        columns: tableCols,
        viewMode,
        selected: selectedIds.includes(table.id),
        tableWarnings,
        columnWarnings,
        peers: peerMarks.get(table.id),
        // 불변식: 컬럼 선택은 한 테이블에만 존재한다 — 선택된 테이블이 정확히 이 노드일 때만 싣는다.
        selectedColumnIds: selectedIds.length === 1 && selectedIds[0] === table.id
          ? columnSelection.selectedColumnIds
          : [],
        onColumnClick: columnSelection.onColumnClick,
      },
    }
  })
}
