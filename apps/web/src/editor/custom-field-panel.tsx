import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { customFieldsFor, customFieldUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { moveCustomField, removeCustomField } from './custom-field-edits.js'
import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const TARGET_TITLE = { table: '테이블 항목', column: '컬럼 항목' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const
const TARGETS = ['table', 'column'] as const
/** 검색 칸 — 서버 `items.page` 의 커스텀 항목 검색과 같다(이름). */
const FIELD_FIELDS = (f: CustomField) => [f.name]

/**
 * 헤더의 "커스텀 항목": 테이블/컬럼에 붙는 조직·프로젝트 고유 메타 항목의 정의를 관리한다.
 *
 * 목록은 테이블 항목 → 컬럼 항목(각각 표시 순서) 순으로 편 뒤 거르고 50건씩 자른다. 대상 제목은 그 쪽에 나온
 * 대상만 그린다. **순서 버튼은 검색 중 잠긴다** — 걸러진 목록에서 「위로」는 사용자가 보는 이웃이 아니라 숨은
 * 이웃과 자리를 바꾼다. 첫·끝 판정도 쪽이 아니라 그 대상 전체 기준이다.
 */
export function CustomFieldPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const byTarget = useMemo(() => ({
    table: customFieldsFor(model, 'table'),
    column: customFieldsFor(model, 'column'),
  }), [model])
  const ordered = useMemo(() => [...byTarget.table, ...byTarget.column], [byTarget])
  /** id → 그 대상 전체에서의 자리. 첫·끝 판정이 쪽에 흔들리지 않게 한다. */
  const position = useMemo(() => {
    const out = new Map<string, { index: number; count: number }>()
    for (const target of TARGETS) {
      byTarget[target].forEach((f, index) => out.set(f.id, { index, count: byTarget[target].length }))
    }
    return out
  }, [byTarget])
  const list = useListPage(ordered, FIELD_FIELDS)
  const listRef = useRef<HTMLDivElement>(null)
  const searching = list.query.trim() !== ''

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (f: CustomField) => { setEditing(f); setEditorOpen(true) }
  const onMove = (id: string, dir: -1 | 1) => {
    void mutate((m) => moveCustomField(m, id, dir), { summary: '커스텀 항목 순서 변경' })
  }
  const onRemove = (f: CustomField) => {
    const used = customFieldUsageCount(model, f.id)
    const message = used > 0
      ? `"${f.name}"을(를) 삭제하면 입력된 값 ${formatCount(used)}건도 함께 삭제됩니다. 계속할까요?`
      : `"${f.name}"을(를) 삭제할까요?`
    if (!window.confirm(message)) return
    const fieldId = f.id
    void mutate((m) => removeCustomField(m, fieldId), { summary: '커스텀 항목 삭제' })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>커스텀 항목</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              테이블·컬럼에 프로젝트 고유의 관리 항목을 정의합니다
            </p>
            {canEdit && <Button size="sm" onClick={onAdd}><Plus /> 항목 추가</Button>}
          </div>
          {ordered.length > 0 && (
            <Input aria-label="커스텀 항목 검색" placeholder="이름 검색" value={list.query}
              onChange={(e) => list.setQuery(e.target.value)} />
          )}
          <div ref={listRef} className="grid max-h-96 gap-4 overflow-y-auto">
            {searching && list.view.total === 0 && (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
            )}
            {TARGETS.map((target) => {
              const fields = list.view.rows.filter((f) => f.target === target)
              // 그 쪽에 나온 대상만 그린다. 대상 자체가 비어 있으면(검색 중이 아닐 때) 빈 안내를 남긴다.
              const empty = !searching && byTarget[target].length === 0
              if (fields.length === 0 && !empty) return null
              return (
                <div key={target} className="grid gap-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">
                    {TARGET_TITLE[target]}
                  </h4>
                  {empty && (
                    <p className="text-sm text-muted-foreground">아직 항목이 없습니다</p>
                  )}
                  <ul className="grid gap-2">
                    {fields.map((f) => {
                      const used = customFieldUsageCount(model, f.id)
                      const pos = position.get(f.id) ?? { index: 0, count: 1 }
                      return (
                        <li key={f.id}
                          className="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div className="grid gap-0.5">
                            <span className="font-medium">
                              {f.name}{f.required && <span className="text-destructive"> *</span>}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {TYPE_LABEL[f.type]}
                              {f.type === 'select' && f.options.length > 0 && ` · ${f.options.join(' / ')}`}
                              {f.defaultValue !== null && ` · 기본값 ${f.defaultValue}`}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {used > 0 && (
                              <span className="mr-1 text-xs text-muted-foreground">값 {formatCount(used)}건</span>
                            )}
                            {canEdit && (
                              <>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 위로`} disabled={searching || pos.index === 0}
                                  onClick={() => onMove(f.id, -1)}>
                                  <ChevronUp className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 아래로`} disabled={searching || pos.index === pos.count - 1}
                                  onClick={() => onMove(f.id, 1)}>
                                  <ChevronDown className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 편집`} onClick={() => onEdit(f)}>
                                  <Pencil className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7 text-destructive"
                                  aria-label={`${f.name} 삭제`} onClick={() => onRemove(f)}>
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
              )
            })}
          </div>
          <Pagination label="커스텀 항목" page={list.view.page} pageCount={list.view.pageCount}
            total={list.view.total} onPageChange={list.setPage} listRef={listRef} />
        </DialogContent>
      </Dialog>
      {editorOpen && (
        <CustomFieldEditDialog
          key={editing?.id ?? 'new'} projectId={projectId} field={editing}
          open={editorOpen} onOpenChange={setEditorOpen}
        />
      )}
    </>
  )
}
