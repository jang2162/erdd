import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GhostNodeData } from './ghost-nodes.js'

/**
 * 외부 참조 테이블 — 헤더만·반투명. 클릭 시 해당 그룹 뷰(미분류면 전체 뷰)로 이동.
 * TableNode와 같은 좌/우 핸들('l'/'r')을 둔다 — 그래야 그룹↔외부 관계 엣지가
 * 이 노드에 연결되어 렌더된다(엣지는 sourceHandle/targetHandle 'l'/'r'을 지정).
 */
export function GhostNode({ data }: NodeProps) {
  const { table, targetGroupId } = data as unknown as GhostNodeData
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)
  const go = () => (targetGroupId ? enterGroupView(targetGroupId) : exitGroupView())
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
      className="min-w-40 cursor-pointer rounded-lg border border-dashed bg-card/50 px-3 py-2 text-left opacity-70 hover:opacity-100"
      title="외부 참조 — 클릭해 이동"
    >
      <Handle id="l" type="source" position={Position.Left}
        className="!h-2 !w-2 !border !border-muted-foreground/40 !bg-background" />
      <Handle id="r" type="source" position={Position.Right}
        className="!h-2 !w-2 !border !border-muted-foreground/40 !bg-background" />
      <span className="font-mono text-sm font-medium text-muted-foreground">{table.physicalName}</span>
    </div>
  )
}
