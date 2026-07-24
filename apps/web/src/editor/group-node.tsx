import type { NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GroupNodeData } from './group-nodes.js'

/** 테이블 뒤 반투명 색상 영역. 컨테이너는 클릭 통과, 라벨만 클릭 가능(그룹 선택). */
export function GroupNode({ data }: NodeProps) {
  const { group, selected } = data as unknown as GroupNodeData
  const selectGroup = useEditorStore((s) => s.selectGroup)
  return (
    <div
      className="size-full rounded-xl border-2"
      style={{
        pointerEvents: 'none',
        borderColor: group.color,
        background: `${group.color}14`, // ~8% 불투명
        borderStyle: selected ? 'solid' : 'dashed',
      }}
    >
      <button
        type="button"
        onClick={() => selectGroup(group.id)}
        className="m-2 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
        style={{ pointerEvents: 'auto', background: group.color }}
      >
        {group.name}
      </button>
    </div>
  )
}
