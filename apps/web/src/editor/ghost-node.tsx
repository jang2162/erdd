import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import { AnchorHandles } from './anchor-handles.js'
import type { GhostNodeData } from './ghost-nodes.js'

/**
 * 외부 참조 테이블 — 헤더만·반투명. 클릭 시 해당 그룹 뷰(미분류면 전체 뷰)로 이동.
 * TableNode와 같은 좌/우 핸들('l'/'r')을 둔다 — 그래야 그룹↔외부 관계 엣지가
 * 이 노드에 연결되어 렌더된다(엣지는 sourceHandle/targetHandle 'l'/'r'을 지정).
 */
export function GhostNode({ data, isConnectable }: NodeProps) {
  // `as unknown as` 가 컴파일러 방어를 지운 자리라 기본값이 유일한 방어다 — anchors 가
  // undefined 로 오면 아래 map 이 던져 고스트 하나가 아니라 **캔버스 전체가 죽는다.**
  // TableNode 도 같은 이유로 `anchors = []` 를 둔다(대칭).
  const { table, targetGroupId, anchors = [] } = data as unknown as GhostNodeData
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)
  const go = () => (targetGroupId ? enterGroupView(targetGroupId) : exitGroupView())
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
      className="relative min-w-40 cursor-pointer rounded-lg border border-dashed bg-card/50 px-3 py-2 text-left opacity-70 hover:opacity-100"
      title="외부 참조 — 클릭해 이동"
    >
      <Handle id="l" type="source" position={Position.Left} isConnectable={isConnectable}
        className="!h-2 !w-2 !border !border-muted-foreground/40 !bg-background" />
      <Handle id="r" type="source" position={Position.Right} isConnectable={isConnectable}
        className="!h-2 !w-2 !border !border-muted-foreground/40 !bg-background" />
      {/*
        컬럼 행이 없으므로 앵커 핸들이 전부 같은 자리(헤더 세로 중앙)에 겹친다. 그래도 렌더한다 —
        그래야 buildEdges 가 "상대가 고스트인가"를 몰라도 되고, 엣지는 언제나 앵커 키만 쓴다.
        결과 그림은 기존과 같다(헤더 중앙에서 선이 나간다).
      */}
      {anchors.map((a) => <AnchorHandles key={a.key} anchorKey={a.key} />)}
      <span className="font-mono text-sm font-medium text-muted-foreground">{table.physicalName}</span>
    </div>
  )
}
