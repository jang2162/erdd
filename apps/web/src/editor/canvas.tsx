import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeChange,
} from '@xyflow/react'
import { toast } from 'sonner'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { buildEdges, planConnection } from './edges.js'
import { TableNode } from './table-node.js'
import { NoteNode, type NoteNodeData } from './note-node.js'
import { RelationshipEdge, RelationshipMarkers } from './relationship-edge.js'
import { useModelMutation } from './use-model.js'
import { moveTable } from './model-edits.js'
import { moveNote } from './note-edits.js'
import { newId } from './uid.js'
import { createRelationshipFromParentPk } from '@erdd/core'

const nodeTypes = { table: TableNode, note: NoteNode }
const edgeTypes = { relationship: RelationshipEdge }

export function Canvas({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const selectNote = useEditorStore((s) => s.selectNote)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const mutate = useModelMutation(projectId)
  const rf = useReactFlow()

  const derived = useMemo(() => {
    const tableNodes = buildNodes(model, viewMode, selectedId)
    const noteNodes: Node[] = Object.values(model.notes).map((note) => ({
      id: note.id, type: 'note', position: note.position,
      data: { note, selected: note.id === selectedNoteId } satisfies NoteNodeData,
    }))
    return [...tableNodes, ...noteNodes]
  }, [model, viewMode, selectedId, selectedNoteId])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derived)

  // 스토어(구조/보기 모드/선택)가 바뀌면 노드를 재구성한다.
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

  const edges = useMemo<Edge[]>(() => {
    const built = buildEdges(model)
    return selectedRelId ? built.map((e) => (e.id === selectedRelId ? { ...e, selected: true } : e)) : built
  }, [model, selectedRelId])

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
        onNodeClick={(_, node) => (node.type === 'note' ? selectNote(node.id) : select(node.id))}
        onEdgeClick={(_, edge) => selectRelationship(edge.id)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, __, dragged) =>
          void mutate(
            (m) => dragged.reduce(
              (acc, n) => (n.type === 'note' ? moveNote(acc, n.id, n.position) : moveTable(acc, n.id, n.position)),
              m,
            ),
            { summary: '이동' },
          )}
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
