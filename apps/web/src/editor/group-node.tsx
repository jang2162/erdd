import type { NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GroupNodeData } from './group-nodes.js'

/** 테이블 뒤 반투명 색상 영역. 빈 영역은 드래그(그룹 이동)/클릭(선택 해제), 라벨만 클릭 가능(그룹 선택). */
export function GroupNode({ data }: NodeProps) {
  const { group, selected } = data as unknown as GroupNodeData
  const selectGroup = useEditorStore((s) => s.selectGroup)
  return (
    <div
      className="relative size-full rounded-xl border-2"
      style={{
        borderColor: group.color,
        background: `${group.color}14`,
        borderStyle: selected ? 'solid' : 'dashed',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          selectGroup(group.id)
        }}
        className="absolute left-0 -top-6 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
        style={{ background: group.color }}
      >
        {group.name}
      </button>
    </div>
  )
}
