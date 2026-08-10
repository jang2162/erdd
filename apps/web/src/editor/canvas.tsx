import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { toast } from 'sonner'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { buildPeerMarks } from './peer-marks.js'
import { buildEdges, planConnection } from './edges.js'
import { TableNode } from './table-node.js'
import { NoteNode, type NoteNodeData } from './note-node.js'
import { GroupNode } from './group-node.js'
import { buildGroupNodes } from './group-nodes.js'
import { GhostNode } from './ghost-node.js'
import { buildGhostNodes } from './ghost-nodes.js'
import { RelationshipEdge, RelationshipMarkers } from './relationship-edge.js'
import { useModelMutation } from './use-model.js'
import { moveTable, moveTableGroupPosition } from './model-edits.js'
import { moveNote } from './note-edits.js'
import { newId } from './uid.js'
import { computeWarnings, createRelationshipFromParentPk } from '@erdd/core'

const nodeTypes = { table: TableNode, note: NoteNode, group: GroupNode, ghost: GhostNode }
const edgeTypes = { relationship: RelationshipEdge }

const groupIdOf = (nodeId: string) => nodeId.slice('group:'.length)

export function Canvas({ projectId, selfUserId }: { projectId: string; selfUserId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const selectedIds = useMemo(() => new Set(selectedTableIds), [selectedTableIds])
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const selectNote = useEditorStore((s) => s.selectNote)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const rf = useReactFlow()
  // 그룹 드래그 시작 시점의 그룹 노드 위치 + 소속 테이블 위치 스냅샷(전체 뷰에서만 사용).
  const dragOrigin = useRef<{ groupNodeStart: XYPosition; members: Map<string, XYPosition> } | null>(null)

  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  const warnings = useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])
  const peers = useEditorStore((s) => s.peers)
  const peerMarks = useMemo(() => buildPeerMarks(peers, selfUserId), [peers, selfUserId])

  // 유효 뷰: 활성 그룹이 삭제됐으면(그룹 뷰 도중 삭제) 전체 뷰로 폴백한다.
  const view = activeGroupView && model.tableGroups[activeGroupView]
    ? { kind: 'group' as const, groupId: activeGroupView }
    : { kind: 'full' as const }

  const derived = useMemo(() => {
    const tableNodes = buildNodes(model, viewMode, selectedIds, warnings, view, peerMarks)
    if (view.kind === 'group') {
      // 그룹 뷰: 색상 영역·메모 노드는 숨긴다. 관계로 이어진 외부 테이블은 고스트로 보여준다.
      const ghostNodes = buildGhostNodes(model, view.groupId)
      return [...ghostNodes, ...tableNodes]
    }
    const groupNodes = buildGroupNodes(model, selectedGroupId, canEdit)
    const noteNodes: Node[] = Object.values(model.notes).map((note) => ({
      id: note.id, type: 'note', position: note.position,
      data: {
        note, selected: note.id === selectedNoteId, peers: peerMarks.get(note.id),
      } satisfies NoteNodeData,
    }))
    return [...groupNodes, ...tableNodes, ...noteNodes]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 객체는 매 렌더 새로 만들어지므로 kind/groupId로 분해해 넣는다.
  }, [model, viewMode, selectedIds, selectedNoteId, selectedGroupId, canEdit, warnings, peerMarks, view.kind, view.kind === 'group' ? view.groupId : null])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derived)

  // 스토어(구조/보기 모드/선택)가 바뀌면 노드를 재구성한다.
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

  const edges = useMemo<Edge[]>(() => {
    const built = view.kind === 'group'
      ? buildEdges(model, new Set([
          ...Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id),
          ...buildGhostNodes(model, view.groupId).map((g) => g.data.table.id),
        ]), peerMarks)
      : buildEdges(model, undefined, peerMarks)
    return selectedRelId ? built.map((e) => (e.id === selectedRelId ? { ...e, selected: true } : e)) : built
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 객체는 매 렌더 새로 만들어지므로 kind/groupId로 분해해 넣는다.
  }, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId, peerMarks])

  // 트리에서 발행한 포커스 신호를 소비해 해당 테이블로 이동한다.
  useEffect(() => {
    if (!focusTableId) return
    const node = rf.getNode(focusTableId)
    if (node) rf.setCenter(node.position.x + 120, node.position.y + 60, { zoom: 1, duration: 400 })
    consumeFocus()
  }, [focusTableId, rf, consumeFocus])

  /**
   * ReactFlow → store 로 흐르는 **유일한 창구**. 단일 클릭·Cmd+클릭 토글·박스 선택·팬 클릭 해제가
   * 전부 ReactFlow 내부 선택을 거쳐 `select` 변경으로 여기 도착한다(`triggerNodeChanges` 한 갈래).
   *
   * ⚠️ **`onSelectionChange` 를 쓰지 않는다.** 노드를 prop 으로 통제하면 `triggerNodeChanges` 가
   * 내부 lookup 을 갱신하지 않고 `onNodesChange` 만 부르므로, `onSelectionChange` 는 사실상
   * **우리가 넘긴 nodes prop 의 메아리**이고 그것도 렌더 한 틱 뒤에 온다. 늦은 스냅샷을 store 에
   * 되쓰면 store→nodes 푸시와 서로를 덮어 진동한다(실측: 메모 클릭 한 번에 선택이 [] ↔ ['t1'] 을
   * 무한 반복해 React 가 "Maximum update depth exceeded" 로 끊었다). `onNodesChange` 의 select
   * 변경은 사용자가 조작한 그 틱에 **델타로** 도착해 늦지도 어긋나지도 않는다.
   *
   * 노드 배열에는 그룹·메모·고스트가 섞여 있다(그룹·고스트는 `selectable: false` 라 안 오지만
   * **메모는 온다**) — 모델의 테이블인지로 걸러야 메모 클릭이 테이블 선택으로 둔갑하지 않는다.
   */
  const onNodesChangeWithSelection = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes)
    const s = useEditorStore.getState()
    let next = s.selectedTableIds
    for (const c of changes) {
      if (c.type !== 'select' || !Object.hasOwn(s.model.tables, c.id)) continue
      const has = next.includes(c.id)
      // 새로 고른 것은 **뒤에 붙인다** — "마지막 원소 = 주 선택" 규약을 캔버스도 지킨다.
      if (c.selected && !has) next = [...next, c.id]
      else if (!c.selected && has) next = next.filter((id) => id !== c.id)
    }
    // 델타가 선택을 바꾸지 않았으면 아무것도 하지 않는다 — 같은 값을 다시 쓰면 새 배열이 되어
    // 이 값을 구독하는 화면이 남의 편집마다 리렌더되고, 같은 클릭의 메모·관계 선택도 지워진다.
    if (next !== s.selectedTableIds) s.selectTables(next)
  }, [onNodesChange])

  const onConnect = (conn: Connection) => {
    const plan = planConnection(model, conn, newId)
    if (!plan.ok) {
      if (plan.reason === 'no-parent-pk') toast.error('부모 테이블에 기본 키가 없습니다')
      return
    }
    void mutate(
      (m) => createRelationshipFromParentPk(m, {
        relationshipId: plan.relationshipId,
        parentTableId: plan.parentTableId,
        childTableId: plan.childTableId,
        newColumnIds: plan.newColumnIds,
      }),
      { summary: '관계 생성' },
    )
    selectRelationship(plan.relationshipId)
  }

  return (
    <div className="relative flex-1 min-w-0">
      <RelationshipMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        // 위치는 모델 상태라 드래그가 곧 모델 변경이다. 읽기 전용에서는 아예 못 잡게 막는다.
        // 팬·줌·선택은 뷰 상태라 그대로 둔다.
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        deleteKeyCode={canEdit ? 'Backspace' : null}
        onNodesChange={onNodesChangeWithSelection}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          if (node.type === 'ghost') return
          if (node.type === 'group') { select(null); return } // 빈 영역 클릭 = 선택 해제(라벨은 stopPropagation으로 별도 처리)
          if (node.type === 'note') selectNote(node.id)
          // 테이블 선택은 onNodesChangeWithSelection 한 곳에서만 처리한다 — 창구가 둘이면
          // Cmd+클릭 한 번에 ReactFlow 내부 토글과 우리 토글이 겹쳐 서로를 되돌린다.
        }}
        onEdgeClick={(_, edge) => selectRelationship(edge.id)}
        onPaneClick={() => select(null)}
        onNodeDragStart={(_, node) => {
          if (node.type !== 'group') return
          const gid = groupIdOf(node.id)
          const members = new Map<string, XYPosition>()
          for (const t of Object.values(model.tables)) if (t.groupId === gid) members.set(t.id, { ...t.position })
          dragOrigin.current = { groupNodeStart: { ...node.position }, members }
        }}
        onNodeDrag={(_, node) => {
          if (node.type !== 'group' || !dragOrigin.current) return
          const o = dragOrigin.current
          const dx = node.position.x - o.groupNodeStart.x
          const dy = node.position.y - o.groupNodeStart.y
          setNodes((ns) => ns.map((n) =>
            o.members.has(n.id) ? { ...n, position: { x: o.members.get(n.id)!.x + dx, y: o.members.get(n.id)!.y + dy } } : n))
        }}
        onNodeDragStop={(_, node, dragged) => {
          if (node.type === 'group') {
            const o = dragOrigin.current
            dragOrigin.current = null
            if (!o) return
            const dx = node.position.x - o.groupNodeStart.x
            const dy = node.position.y - o.groupNodeStart.y
            if (dx === 0 && dy === 0) return
            void mutate((m) => {
              let next = m
              for (const [id, pos] of o.members) next = moveTable(next, id, { x: pos.x + dx, y: pos.y + dy })
              return next
            }, { summary: '그룹 이동' })
            return
          }
          void mutate(
            (m) => dragged.reduce((acc, n) => {
              if (n.type === 'group' || n.type === 'ghost') return acc
              if (view.kind === 'group' && n.type === 'table') return moveTableGroupPosition(acc, n.id, n.position)
              if (n.type === 'note') return moveNote(acc, n.id, n.position)
              return moveTable(acc, n.id, n.position)
            }, m),
            { summary: '이동' },
          )
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
