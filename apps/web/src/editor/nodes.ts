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
      // React Flow **자신의** 선택 플래그도 store 기준으로 세운다. canvas.tsx는 store가 바뀔 때마다
      // 노드 배열을 통째로 교체하므로(setNodes(derived)), 여기서 세우지 않으면 재구성이 React Flow의
      // 선택을 지운다 — 선택이라는 같은 사실이 두 곳에 따로 살아 어긋난다. store를 단일 진실
      // 원본으로 두고 React Flow는 그것을 비추기만 한다. (아래 data.selected는 TableNode가
      // 선택 링을 그리는 데 쓰는 별개 값이다.)
      selected: selectedIds.includes(table.id),
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
