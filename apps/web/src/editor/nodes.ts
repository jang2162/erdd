import type { Node } from '@xyflow/react'
import type { ProjectModel, Warning } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'
import type { PeerMarks } from './peer-marks.js'
import { buildAnchors, type AnchorIndex } from './anchors.js'

export type NodeView = { kind: 'full' } | { kind: 'group'; groupId: string }

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: ReadonlySet<string>, warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
  columnSelection: {
    selectedColumnIds?: readonly string[]
    onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  } = {},
  // 기본값을 undefined 가 아니라 **자기 계산**으로 둔다 — 인자를 빠뜨려도 결과가 옳다.
  // undefined 였다면 배선 누락이 "전부 중앙으로 조용히 폴백"으로 나타나 눈에 띄지 않는다.
  anchors: AnchorIndex = buildAnchors(model),
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
      // React Flow **자신의** 선택 플래그도 store 기준으로 세운다. canvas.tsx는 store가 바뀔 때마다
      // 노드 배열을 `derived`로 통째로 교체하므로, 여기서 세우지 않으면 재구성이 React Flow의
      // 선택을 지운다 — 선택이라는 같은 사실이 두 곳에 따로 살아 어긋난다. store를 단일 진실
      // 원본으로 두고 React Flow는 그것을 비추기만 한다. 박스 선택도 이 값을 읽고 쓴다.
      // (아래 data.selected는 TableNode가 선택 링을 그리는 데 쓰는 별개 값이다.)
      selected: isSelected,
      data: {
        table,
        columns: tableCols,
        viewMode,
        selected: isSelected,
        tableWarnings,
        columnWarnings,
        peers: peerMarks.get(table.id),
        // 불변식: 컬럼 선택은 한 테이블에만 존재한다 — 선택된 테이블이 정확히 이 노드일 때만 싣는다.
        // (집합의 크기가 1이고 이 테이블을 담고 있다 = 그 유일한 원소가 이 테이블이다.)
        selectedColumnIds: selectedIds.size === 1 && isSelected
          ? columnSelection.selectedColumnIds
          : [],
        onColumnClick: columnSelection.onColumnClick,
        anchors: anchors.byTable.get(table.id) ?? [],
      },
    }
  })
}
