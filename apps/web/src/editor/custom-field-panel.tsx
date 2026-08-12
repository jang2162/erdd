import { useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { customFieldsFor, customFieldUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { moveCustomField, removeCustomField } from './custom-field-edits.js'
import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const TARGET_TITLE = { table: '테이블 항목', column: '컬럼 항목' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

/** 헤더의 "커스텀 항목": 테이블/컬럼에 붙는 조직·프로젝트 고유 메타 항목의 정의를 관리한다. */
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

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (f: CustomField) => { setEditing(f); setEditorOpen(true) }
  const onMove = (id: string, dir: -1 | 1) => {
    void mutate((m) => moveCustomField(m, id, dir), { summary: '커스텀 항목 순서 변경' })
  }
  const onRemove = (f: CustomField) => {
    const used = customFieldUsageCount(model, f.id)
    const message = used > 0
      ? `"${f.name}"을(를) 삭제하면 입력된 값 ${used}건도 함께 삭제됩니다. 계속할까요?`
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
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {(['table', 'column'] as const).map((target) => {
              const fields = customFieldsFor(model, target)
              return (
                <div key={target} className="grid gap-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">
                    {TARGET_TITLE[target]}
                  </h4>
                  {fields.length === 0 && (
                    <p className="text-sm text-muted-foreground">아직 항목이 없습니다</p>
                  )}
                  <ul className="grid gap-2">
                    {fields.map((f, i) => {
                      const used = customFieldUsageCount(model, f.id)
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
                              <span className="mr-1 text-xs text-muted-foreground">값 {used}건</span>
                            )}
                            {canEdit && (
                              <>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 위로`} disabled={i === 0}
                                  onClick={() => onMove(f.id, -1)}>
                                  <ChevronUp className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 아래로`} disabled={i === fields.length - 1}
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
