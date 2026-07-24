import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeChange,
} from '@xyflow/react'
import { toast } from 'sonner'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { buildEdges } from './edges.js'
import { TableNode, type TableNodeData } from './table-node.js'
import { RelationshipEdge, RelationshipMarkers } from './relationship-edge.js'
import { useModelMutation } from './use-model.js'
import { moveTable } from './model-edits.js'
import { newId } from './uid.js'
import { createRelationshipFromParentPk } from '@erdd/core'

const nodeTypes = { table: TableNode }
const edgeTypes = { relationship: RelationshipEdge }

export function Canvas({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const mutate = useModelMutation(projectId)
  const rf = useReactFlow()

  const derived = useMemo(
    () => buildNodes(model, viewMode, selectedId),
    [model, viewMode, selectedId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>(derived)

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
    if (!conn.source || !conn.target || conn.source === conn.target) return
    const parentTableId = conn.target // 부모
    const childTableId = conn.source // 자식
    const pkCount = Object.values(model.columns)
      .filter((c) => c.tableId === parentTableId && c.isPk).length
    if (pkCount === 0) {
      toast.error('부모 테이블에 기본 키가 없습니다')
      return
    }
    const relationshipId = newId()
    const newColumnIds = Array.from({ length: pkCount }, () => newId())
    void mutate(
      (m) => createRelationshipFromParentPk(m, { relationshipId, parentTableId, childTableId, newColumnIds }),
      { summary: '관계 생성' },
    )
    selectRelationship(relationshipId)
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
        onNodeClick={(_, node) => select(node.id)}
        onEdgeClick={(_, edge) => selectRelationship(edge.id)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, __, dragged) =>
          void mutate(
            (m) => dragged.reduce((acc, n) => moveTable(acc, n.id, { x: n.position.x, y: n.position.y }), m),
            { summary: '테이블 이동' },
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
