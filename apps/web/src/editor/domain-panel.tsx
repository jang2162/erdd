import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { type Domain } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { removeDomain, usageOf } from './domain-edits.js'
import { DomainEditDialog } from './domain-edit-dialog.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const UNCATEGORIZED = '미분류'
/** 검색 칸 — 서버 `items.page` 의 도메인 검색과 같다(이름). */
const DOMAIN_FIELDS = (d: Domain) => [d.name]

function groupByCategory(domains: readonly Domain[]): [string, Domain[]][] {
  const map = new Map<string, Domain[]>()
  for (const d of domains) {
    const key = d.category ?? UNCATEGORIZED
    const list = map.get(key)
    if (list) list.push(d)
    else map.set(key, [d])
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * 헤더의 "도메인": 공통 컬럼 도메인(타입·기본값·허용값 재사용 단위)의 목록·추가·편집·삭제.
 *
 * 열림 상태는 제어형이다 — 트리거는 `header-tools.tsx`가 렌더한다(설계 D5).
 * 목록은 분류 → 이름 순으로 편 뒤 거르고 50건씩 자른다. 묶음 제목은 그 쪽에 나온 분류만 그린다.
 */
export function DomainPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [editing, setEditing] = useState<Domain | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const ordered = useMemo(
    () => groupByCategory(Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name)))
      .flatMap(([, items]) => items),
    [model.domains])
  const list = useListPage(ordered, DOMAIN_FIELDS)
  const groups = groupByCategory(list.view.rows)

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (d: Domain) => { setEditing(d); setEditorOpen(true) }
  const onRemove = (id: string) => { void mutate((m) => removeDomain(m, id), { summary: '도메인 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>도메인</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">공통 컬럼 타입·기본값·허용값을 재사용 단위로 관리합니다</p>
            {canEdit && <Button size="sm" onClick={onAdd}><Plus /> 도메인 추가</Button>}
          </div>
          {ordered.length > 0 && (
            <Input aria-label="도메인 검색" placeholder="이름 검색" value={list.query}
              onChange={(e) => list.setQuery(e.target.value)} />
          )}
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {ordered.length === 0 && <p className="text-sm text-muted-foreground">아직 도메인이 없습니다</p>}
            {ordered.length > 0 && list.view.total === 0 && (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
            )}
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
                          {usage > 0 && <span className="text-xs text-muted-foreground">사용처 {formatCount(usage)}개</span>}
                          {canEdit && (
                            <>
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
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <Pagination label="도메인" page={list.view.page} pageCount={list.view.pageCount}
            total={list.view.total} onPageChange={list.setPage} />
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
