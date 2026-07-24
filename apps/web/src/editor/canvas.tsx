import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, useNodesState, type Node, type NodeChange,
} from '@xyflow/react'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { TableNode, type TableNodeData } from './table-node.js'

const nodeTypes = { table: TableNode }

export function Canvas() {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)

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
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <MiniMap pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
