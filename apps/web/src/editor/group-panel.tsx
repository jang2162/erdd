import { useEffect, useState } from 'react'
import { ArrowUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateGroup, deleteGroup, generatePhysicalName } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ALIAS_RE = /[^A-Z0-9_]/g
/** 별칭은 물리 식별자다 — 타이핑 중에 규칙을 강제한다(설계 D3). */
function normalizeAlias(v: string): string {
  return v.toUpperCase().replace(ALIAS_RE, '')
}

export function GroupPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const groupId = useEditorStore((s) => s.selectedGroupId)!
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)
  const group = model.tableGroups[groupId]
  // ⚠️ 훅은 조기 반환 앞에 와야 한다 — group 이 없을 수 있어 옵셔널로 읽는다.
  const groupAlias = group?.alias ?? ''
  const [alias, setAlias] = useState(groupAlias)
  // 모델 값이 바뀌면(자동 생성·실시간·undo) 입력을 맞춘다.
  useEffect(() => { setAlias(groupAlias) }, [groupAlias])
  if (!group) return null

  const memberCount = Object.values(model.tables).filter((t) => t.groupId === groupId).length

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">그룹</h3>
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="그룹 삭제"
            onClick={() => { selectGroup(null); void mutate((m) => deleteGroup(m, groupId), { summary: '그룹 삭제' }) }}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">소속 테이블 {memberCount}개</p>
      <Button size="sm" variant="outline" className="mb-4 w-full" onClick={() => enterGroupView(groupId)}>
        이 그룹 뷰 열기
      </Button>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="grp-name">이름</Label>
          <Input id="grp-name" defaultValue={group.name} key={group.name} readOnly={!canEdit}
            onBlur={(e) => { const name = e.target.value; if (name !== group.name && name.trim() !== '') void mutate((m) => updateGroup(m, groupId, { name })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-alias">별칭</Label>
          <div className="relative">
            <Input
              id="grp-alias" aria-label="별칭" className="pr-9 font-mono"
              value={alias} readOnly={!canEdit}
              onChange={(e) => setAlias(normalizeAlias(e.target.value))}
              onBlur={() => {
                if (alias !== group.alias) void mutate((m) => updateGroup(m, groupId, { alias }),
                  { summary: '그룹 별칭 변경' })
              }}
            />
            {canEdit && (
              <Button
                type="button" size="icon" variant="ghost"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                aria-label="이름으로 별칭 채우기"
                // 포커스를 뺏지 않는다 — 직전 사이클이 계측으로 확정한 효용이다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const gen = generatePhysicalName(group.name, model.words, model.terms, namingRules)
                  if (!gen.physicalName) {
                    toast.error(gen.unknownWords.length > 0
                      ? `사전에 없는 단어: ${gen.unknownWords.join(', ')}`
                      : '그룹 이름이 비어 있어 별칭을 만들 수 없습니다')
                    return
                  }
                  const next = normalizeAlias(gen.physicalName)
                  setAlias(next)
                  if (next !== group.alias) void mutate((m) => updateGroup(m, groupId, { alias: next }),
                    { summary: '그룹 별칭 생성' })
                }}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-color">색상</Label>
          {/* color input은 readOnly가 동작하지 않아(브라우저가 무시) disabled로 잠근다. */}
          <input id="grp-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={group.color} key={group.color} disabled={!canEdit}
            onBlur={(e) => { const color = e.target.value; if (color !== group.color) void mutate((m) => updateGroup(m, groupId, { color })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-comment">설명</Label>
          <Input id="grp-comment" defaultValue={group.comment ?? ''} key={group.comment ?? ''} readOnly={!canEdit}
            onBlur={(e) => { const v = e.target.value.trim() === '' ? null : e.target.value; if (v !== group.comment) void mutate((m) => updateGroup(m, groupId, { comment: v })) }} />
        </div>
      </div>
    </aside>
  )
}
