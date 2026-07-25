import type { NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GhostNodeData } from './ghost-nodes.js'

/** 외부 참조 테이블 — 헤더만·반투명. 클릭 시 해당 그룹 뷰(미분류면 전체 뷰)로 이동. */
export function GhostNode({ data }: NodeProps) {
  const { table, targetGroupId } = data as unknown as GhostNodeData
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)
  return (
    <button
      type="button"
      onClick={() => (targetGroupId ? enterGroupView(targetGroupId) : exitGroupView())}
      className="min-w-40 rounded-lg border border-dashed bg-card/50 px-3 py-2 text-left opacity-70 hover:opacity-100"
      title="외부 참조 — 클릭해 이동"
    >
      <span className="font-mono text-sm font-medium text-muted-foreground">{table.physicalName}</span>
    </button>
  )
}
