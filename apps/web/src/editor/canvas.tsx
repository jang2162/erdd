import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, useNodesState, type Node, type NodeChange,
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
  const mutate = useModelMutation(projectId)

  const derived = useMemo(
    () => buildNodes(model, viewMode, selectedId),
    [model, viewMode, selectedId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>(derived)

  // 스토어(구조/보기 모드/선택)가 바뀌면 노드를 재구성한다.
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

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
