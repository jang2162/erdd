import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, useNodesState, useReactFlow, type Node, type NodeChange,
} from '@xyflow/react'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { TableNode, type TableNodeData } from './table-node.js'
import { useModelMutation } from './use-model.js'
import { moveTable } from './model-edits.js'

const nodeTypes = { table: TableNode }

export function Canvas({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)
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

  // 트리에서 발행한 포커스 신호를 소비해 해당 테이블로 이동한다.
  useEffect(() => {
    if (!focusTableId) return
    const node = rf.getNode(focusTableId)
    if (node) rf.setCenter(node.position.x + 120, node.position.y + 60, { zoom: 1, duration: 400 })
    consumeFocus()
  }, [focusTableId, rf, consumeFocus])

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange as (c: NodeChange[]) => void}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      onNodeDragStop={(_, node) =>
        void mutate((m) => moveTable(m, node.id, { x: node.position.x, y: node.position.y }),
          { summary: '테이블 이동' })}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <MiniMap pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
