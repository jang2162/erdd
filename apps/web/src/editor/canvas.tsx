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
import { useEditorShortcuts } from './use-shortcuts.js'
import { moveTable, moveTableGroupPosition } from './model-edits.js'
import { moveNote } from './note-edits.js'
import { newId } from './uid.js'
import { computeWarnings, createRelationshipFromParentPk } from '@erdd/core'

const nodeTypes = { table: TableNode, note: NoteNode, group: GroupNode, ghost: GhostNode }
const edgeTypes = { relationship: RelationshipEdge }

const groupIdOf = (nodeId: string) => nodeId.slice('group:'.length)

/** 순서를 무시한 id 집합 비교. 선택은 집합이지 목록이 아니다. */
const sameIdSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function Canvas({ projectId, selfUserId }: { projectId: string; selfUserId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedIds = useEditorStore((s) => s.selectedTableIds)
  const selectedColumnIds = useEditorStore((s) => s.selectedColumnIds)
  const selectColumn = useEditorStore((s) => s.selectColumn)
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const selectTables = useEditorStore((s) => s.selectTables)
  const toggleTable = useEditorStore((s) => s.toggleTable)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const selectNote = useEditorStore((s) => s.selectNote)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  // 복사·잘라내기·붙여넣기·삭제 단축키. 삭제 경로는 React Flow가 아니라 이 훅이 소유한다.
  useEditorShortcuts({ projectId })
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

  const onColumnClick = useCallback(
    (columnId: string, mode: 'replace' | 'toggle' | 'range') => {
      const col = model.columns[columnId]
      if (col) selectColumn(col.tableId, columnId, mode)
    },
    [model.columns, selectColumn],
  )

  /*
   * 선택의 소유권을 나눈다 — **노드 클릭은 store, 박스 선택은 React Flow**.
   *
   * store가 단일 진실 원본이고 buildNodes가 그것을 React Flow 노드의 최상위 `selected`로 되비춘다
   * (아래 setNodes(derived) effect). 그런데 React Flow도 선택 상태를 자기 nodeLookup에 따로 들고
   * 있고, 노드를 클릭하면 우리 onNodeClick보다 **먼저** 그것을 **직접 변형한다**
   * (NodeWrapper.onSelectNodeHandler → handleNodeClick → getSelectionChanges(..., mutateItem=true).
   * 스토어 기본값 nodeDragThreshold=1이라 이 분기가 click에서 돈다). 변형이 먼저라 onNodesChange로
   * 오는 통지를 걸러도 소용이 없다 — 실측으로 확인했다.
   *
   * 그래서 onSelectionChange를 **무조건** 받으면 안 된다. 받으면 미러링(store→React Flow)과
   * 통지(React Flow→store)가 한 커밋씩 어긋난 값을 서로에게 되먹여 **무한 루프**가 된다
   * ("Maximum update depth exceeded" — 실측했다. toggleTable이 store에 대한 *상대* 연산이라
   * 덮어쓸 때마다 값이 뒤집혀 수렴하지 않는다).
   *
   * 해법: React Flow가 스스로 알려주는 **박스 선택 제스처 구간에서만** 통지를 받는다.
   * onSelectionStart/End는 사용자 선택 상자에만 대응하는 신호라 추측이 필요 없다. 노드 클릭이
   * 만든 변경은 이 구간 밖이므로 무시되고, 곧바로 미러링이 React Flow를 store에 맞춰 되돌린다.
   *
   * ⚠️ 다만 **닫는 신호는 보장되지 않는다.** React Flow의 Pane은 onPointerCancel에서 포인터 캡처
   * 해제와 auto-pan 정리만 하고 onSelectionEnd를 부르지 않는다. pointercancel은 터치·펜 제스처가
   * 가로채일 때, 그리고 **캡처 대상 DOM 노드가 제거될 때** 난다 — 테이블 위에서 Shift+드래그를
   * 시작했는데 그 사이 남의 실시간 op가 그 테이블을 지우면 그렇다. 게이트가 열린 채 래치되면
   * 다음 선택 변경이 되먹임 루프를 되살려 캔버스 전체가 죽는다.
   * 그래서 아래 래퍼의 onClickCapture에서 한 번 더 닫는다(자리 선정 근거는 그쪽 주석).
   */
  const boxSelecting = useRef(false)

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    if (!boxSelecting.current) return
    // 캔버스에는 테이블 말고 group·note·ghost 노드도 있다. store 선택에 들어갈 수 있는 것은
    // 테이블뿐이고, 고스트는 **원본 테이블 id를 그대로** 쓰므로 id로는 구별되지 않는다 — type으로 건다.
    const ids = selected.filter((n) => n.type === 'table').map((n) => n.id)
    // 집합이 실제로 달라졌을 때만 쓴다. 같은 선택에 다시 쓰면 selectTables가 CLEARED_SELECTION을
    // 거치므로 딸린 컬럼 선택이 조용히 지워진다.
    if (sameIdSet(ids, useEditorStore.getState().selectedTableIds)) return
    selectTables(ids)
  }, [selectTables])

  const derived = useMemo(() => {
    const tableNodes = buildNodes(
      model, viewMode, selectedIds, warnings, view, peerMarks, { selectedColumnIds, onColumnClick })
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
  }, [model, viewMode, selectedIds, selectedColumnIds, onColumnClick, selectedNoteId, selectedGroupId, canEdit, warnings, peerMarks, view.kind, view.kind === 'group' ? view.groupId : null])
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
    <div
      className="relative flex-1 min-w-0"
      /*
       * 선택 상자 게이트의 안전장치: 클릭이 들어오면 무조건 닫는다(위 boxSelecting 주석의 ⚠️).
       * 클릭 시점에는 상자 제스처가 이미 끝나 있다 — 브라우저는 pointerup 뒤에 click을 내고,
       * React Flow도 그 pointerup에서 onSelectionEnd를 부른다. 그러니 여기서 닫는 것은 정상
       * 흐름을 건드리지 않고, 잘린 제스처가 남긴 래치만 푼다.
       *
       * **왜 pointercancel 리스너가 아니라 여기인가:** 래치의 가장 현실적인 원인이 "캡처 대상
       * DOM 노드 제거"인데, 분리된 노드에서 난 이벤트는 위로 전파되지 않아 pointercancel을
       * 우리가 받지 못한다. 방어는 신호가 오는 곳이 아니라 **소비 지점 앞**에 있어야 한다.
       * **왜 onNodeClick/onPaneClick이 아니라 래퍼의 캡처인가:** 한 자리로 노드·pane·엣지·
       * 컬럼 행·미니맵 클릭을 전부 덮고, 캡처 단계라 stopPropagation(컬럼 행이 부른다)에도
       * 건너뛰이지 않으며, React Flow가 자기 선택을 만지기 전에 먼저 돈다.
       */
      onClickCapture={() => { boxSelecting.current = false }}
    >
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
        // 삭제는 useEditorShortcuts가 전담한다. 두 삭제 경로가 공존하면 컬럼 선택 상태에서
        // 어느 쪽이 이기는지가 렌더 순서에 달린다 — React Flow 자체 삭제는 끈다.
        deleteKeyCode={null}
        onNodesChange={onNodesChange as (c: NodeChange[]) => void}
        onConnect={onConnect}
        // 선택 상자(Shift+빈 곳 드래그) 구간에서만 React Flow의 선택 통지를 받는다(위 주석).
        onSelectionStart={() => { boxSelecting.current = true }}
        onSelectionEnd={() => { boxSelecting.current = false }}
        onSelectionChange={onSelectionChange}
        onNodeClick={(event, node) => {
          if (node.type === 'ghost') return
          if (node.type === 'group') { select(null); return } // 빈 영역 클릭 = 선택 해제(라벨은 stopPropagation으로 별도 처리)
          if (node.type === 'note') { selectNote(node.id); return }
          // Cmd/Ctrl+클릭 = 다중 선택 토글. 이 분기가 없으면 selectedTableIds가 2개 이상이 되는
          // 사용자 경로가 캔버스에 없다(붙여넣기 말고는 도달할 수 없었다).
          if (event.metaKey || event.ctrlKey) toggleTable(node.id)
          else select(node.id)
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
