import { useEditorStore } from './store.js'

/** 헤더의 뷰 전환: 전체 뷰 ↔ 각 그룹 뷰. 그룹이 없으면 렌더 안 함. */
export function GroupViewSelect() {
  const groups = useEditorStore((s) => s.model.tableGroups)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)

  const list = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  if (list.length === 0) return null

  return (
    <select
      aria-label="뷰 전환"
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value={activeGroupView && groups[activeGroupView] ? activeGroupView : ''}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') exitGroupView()
        else enterGroupView(v)
      }}
    >
      <option value="">전체 뷰</option>
      {list.map((g) => <option key={g.id} value={g.id}>{g.name} 뷰</option>)}
    </select>
  )
}
