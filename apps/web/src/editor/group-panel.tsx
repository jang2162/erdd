import { Trash2 } from 'lucide-react'
import { updateGroup, deleteGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function GroupPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const groupId = useEditorStore((s) => s.selectedGroupId)!
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const mutate = useModelMutation(projectId)
  const group = model.tableGroups[groupId]
  if (!group) return null

  const memberCount = Object.values(model.tables).filter((t) => t.groupId === groupId).length

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">그룹</h3>
        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="그룹 삭제"
          onClick={() => { selectGroup(null); void mutate((m) => deleteGroup(m, groupId), { summary: '그룹 삭제' }) }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">소속 테이블 {memberCount}개</p>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="grp-name">이름</Label>
          <Input id="grp-name" defaultValue={group.name} key={group.name}
            onBlur={(e) => { const name = e.target.value; if (name !== group.name && name.trim() !== '') void mutate((m) => updateGroup(m, groupId, { name })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-color">색상</Label>
          <input id="grp-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={group.color} key={group.color}
            onBlur={(e) => { const color = e.target.value; if (color !== group.color) void mutate((m) => updateGroup(m, groupId, { color })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-comment">설명</Label>
          <Input id="grp-comment" defaultValue={group.comment ?? ''} key={group.comment ?? ''}
            onBlur={(e) => { const v = e.target.value.trim() === '' ? null : e.target.value; if (v !== group.comment) void mutate((m) => updateGroup(m, groupId, { comment: v })) }} />
        </div>
      </div>
    </aside>
  )
}
