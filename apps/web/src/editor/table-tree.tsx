import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { createGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { nextGroupColor } from './group-palette.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TableTree({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const focus = useEditorStore((s) => s.focus)
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const mutate = useModelMutation(projectId)
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const match = (t: { physicalName: string; logicalName: string }) =>
    query === '' || t.physicalName.toLowerCase().includes(query) || t.logicalName.toLowerCase().includes(query)

  const allTables = Object.values(model.tables).filter(match)
    .sort((a, b) => a.physicalName.localeCompare(b.physicalName))
  const groups = Object.values(model.tableGroups).sort((a, b) => a.name.localeCompare(b.name))
  const unassigned = allTables.filter((t) => t.groupId === null || !model.tableGroups[t.groupId])

  // 유효 활성 그룹: 설정됐고 실제로 존재할 때만 스코핑한다(삭제된 경우 전체 뷰로 폴백 — canvas와 일치).
  const scopedGroupId = activeGroupView && model.tableGroups[activeGroupView] ? activeGroupView : null
  const visibleGroups = scopedGroupId ? groups.filter((g) => g.id === scopedGroupId) : groups
  const showUnassigned = !scopedGroupId && (unassigned.length > 0 || groups.length > 0)

  const onAddGroup = () => {
    const id = newId()
    // 개수 기반이 아니라 미사용 최소 번호를 찾는다(삭제 후 재추가 시 이름 충돌 방지).
    const usedNames = new Set(Object.values(model.tableGroups).map((g) => g.name))
    let n = 1
    while (usedNames.has(`그룹${n}`)) n++
    const usedColors = Object.values(model.tableGroups).map((g) => g.color)
    void mutate((m) => createGroup(m, { id, name: `그룹${n}`, color: nextGroupColor(usedColors) }), { summary: '그룹 추가' })
    selectGroup(id)
  }

  const totalTables = Object.keys(model.tables).length

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-1 border-b p-2">
        <Input placeholder="테이블 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="그룹 추가" onClick={onAddGroup}>
          <FolderPlus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visibleGroups.map((g) => {
          const members = allTables.filter((t) => t.groupId === g.id)
          if (query !== '' && members.length === 0) return null
          return (
            <div key={g.id} className="mb-1">
              <button type="button" onClick={() => selectGroup(g.id)}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent',
                  g.id === selectedGroupId && 'bg-accent',
                  g.id === scopedGroupId && 'ring-1 ring-inset ring-ring')}>
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.color }} />
                <span className="flex-1 truncate text-xs font-semibold">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">{members.length}</span>
              </button>
              <ul className="ml-3 border-l pl-1">
                {members.map((t) => <TableItem key={t.id} t={t} selected={t.id === selectedTableId} onClick={() => focus(t.id)} />)}
              </ul>
            </div>
          )
        })}

        {showUnassigned && (
          <div className="mb-1">
            {groups.length > 0 && (
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">미분류</div>
            )}
            <ul className={groups.length > 0 ? 'ml-3 border-l pl-1' : undefined}>
              {unassigned.map((t) => <TableItem key={t.id} t={t} selected={t.id === selectedTableId} onClick={() => focus(t.id)} />)}
            </ul>
          </div>
        )}

        {allTables.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {totalTables === 0 ? '테이블을 추가해 설계를 시작하세요.' : '검색 결과가 없습니다.'}
          </p>
        )}
      </div>
    </aside>
  )
}

function TableItem({ t, selected, onClick }: {
  t: { id: string; physicalName: string; logicalName: string }; selected: boolean; onClick: () => void
}) {
  return (
    <li>
      <button type="button" onClick={onClick}
        className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent', selected && 'bg-accent')}>
        <span className="font-mono text-xs font-medium">{t.physicalName}</span>
        <span className="text-xs text-muted-foreground">{t.logicalName}</span>
      </button>
    </li>
  )
}
