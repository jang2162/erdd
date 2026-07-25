import { useState } from 'react'
import { Database, Pencil, Plus, Trash2 } from 'lucide-react'
import { type Domain } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { removeDomain, usageOf } from './domain-edits.js'
import { DomainEditDialog } from './domain-edit-dialog.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

const UNCATEGORIZED = '미분류'

function groupByCategory(domains: Domain[]): [string, Domain[]][] {
  const map = new Map<string, Domain[]>()
  for (const d of domains) {
    const key = d.category ?? UNCATEGORIZED
    const list = map.get(key)
    if (list) list.push(d)
    else map.set(key, [d])
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** 헤더의 "도메인": 공통 컬럼 도메인(타입·기본값·허용값 재사용 단위)의 목록·추가·편집·삭제. */
export function DomainPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Domain | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const domains = Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name))
  const groups = groupByCategory(domains)

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (d: Domain) => { setEditing(d); setEditorOpen(true) }
  const onRemove = (id: string) => { void mutate((m) => removeDomain(m, id), { summary: '도메인 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm"><Database /> 도메인</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>도메인</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">공통 컬럼 타입·기본값·허용값을 재사용 단위로 관리합니다</p>
            <Button size="sm" onClick={onAdd}><Plus /> 도메인 추가</Button>
          </div>
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {domains.length === 0 && <p className="text-sm text-muted-foreground">아직 도메인이 없습니다</p>}
            {groups.map(([category, items]) => (
              <div key={category} className="grid gap-2">
                <h4 className="text-xs font-semibold text-muted-foreground">{category}</h4>
                <ul className="grid gap-2">
                  {items.map((d) => {
                    const usage = usageOf(model, d.id).length
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                        <div className="grid gap-0.5">
                          <span className="font-medium">{d.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{d.logicalType}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {usage > 0 && <span className="text-xs text-muted-foreground">사용처 {usage}개</span>}
                          <Button
                            size="icon" variant="ghost" className="size-7" aria-label={`${d.name} 편집`}
                            onClick={() => onEdit(d)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="size-7 text-destructive"
                            aria-label={`${d.name} 삭제`} disabled={usage > 0}
                            onClick={() => onRemove(d.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {editorOpen && (
        <DomainEditDialog
          key={editing?.id ?? 'new'} projectId={projectId} domain={editing}
          open={editorOpen} onOpenChange={setEditorOpen}
        />
      )}
    </>
  )
}
