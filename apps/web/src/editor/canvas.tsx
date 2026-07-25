import { useEffect, useMemo, useRef } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { toast } from 'sonner'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
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

export function Canvas({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const selectNote = useEditorStore((s) => s.selectNote)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const mutate = useModelMutation(projectId)
  const rf = useReactFlow()
  // 그룹 드래그 시작 시점의 그룹 노드 위치 + 소속 테이블 위치 스냅샷(전체 뷰에서만 사용).
  const dragOrigin = useRef<{ groupNodeStart: XYPosition; members: Map<string, XYPosition> } | null>(null)

  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  const warnings = useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])

  // 유효 뷰: 활성 그룹이 삭제됐으면(그룹 뷰 도중 삭제) 전체 뷰로 폴백한다.
  const view = activeGroupView && model.tableGroups[activeGroupView]
    ? { kind: 'group' as const, groupId: activeGroupView }
    : { kind: 'full' as const }

  const derived = useMemo(() => {
    const tableNodes = buildNodes(model, viewMode, selectedId, warnings, view)
    if (view.kind === 'group') {
      // 그룹 뷰: 색상 영역·메모 노드는 숨긴다. 관계로 이어진 외부 테이블은 고스트로 보여준다.
      const ghostNodes = buildGhostNodes(model, view.groupId)
      return [...ghostNodes, ...tableNodes]
    }
    const groupNodes = buildGroupNodes(model, selectedGroupId)
    const noteNodes: Node[] = Object.values(model.notes).map((note) => ({
      id: note.id, type: 'note', position: note.position,
      data: { note, selected: note.id === selectedNoteId } satisfies NoteNodeData,
    }))
    return [...groupNodes, ...tableNodes, ...noteNodes]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 객체는 매 렌더 새로 만들어지므로 kind/groupId로 분해해 넣는다.
  }, [model, viewMode, selectedId, selectedNoteId, selectedGroupId, warnings, view.kind, view.kind === 'group' ? view.groupId : null])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derived)

  // 스토어(구조/보기 모드/선택)가 바뀌면 노드를 재구성한다.
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

  const edges = useMemo<Edge[]>(() => {
    const built = view.kind === 'group'
      ? buildEdges(model, new Set([
          ...Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id),
          ...buildGhostNodes(model, view.groupId).map((g) => g.data.table.id),
        ]))
      : buildEdges(model)
    return selectedRelId ? built.map((e) => (e.id === selectedRelId ? { ...e, selected: true } : e)) : built
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 객체는 매 렌더 새로 만들어지므로 kind/groupId로 분해해 넣는다.
  }, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId])

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
    <div className="relative flex-1 min-w-0">
      <RelationshipMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange as (c: NodeChange[]) => void}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          if (node.type === 'ghost') return
          if (node.type === 'group') { select(null); return } // 빈 영역 클릭 = 선택 해제(라벨은 stopPropagation으로 별도 처리)
          if (node.type === 'note') selectNote(node.id)
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
