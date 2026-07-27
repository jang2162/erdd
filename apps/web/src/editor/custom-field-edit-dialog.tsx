import { useState } from 'react'
import { customFieldUsageCount, customOptionUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { createCustomField, updateCustomField } from './custom-field-edits.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const TARGET_LABEL = { table: '테이블', column: '컬럼' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

/**
 * "커스텀 항목" 패널의 추가/수정 폼.
 * 타입·대상은 생성 시에만 고를 수 있다(변경 불허 — 삭제 후 재생성).
 * 불리언은 체크박스라 "미입력"이 없으므로 필수 옵션을 잠근다.
 * 모든 입력은 컨트롤드 state로 즉시 캡처되고, 저장 시 그 state에서 뽑은 const만 producer에 넘긴다.
 */
export function CustomFieldEditDialog({
  projectId, field, open, onOpenChange,
}: {
  projectId: string
  field: CustomField | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)

  const [name, setName] = useState(field?.name ?? '')
  const [target, setTarget] = useState<CustomField['target']>(field?.target ?? 'column')
  const [type, setType] = useState<CustomField['type']>(field?.type ?? 'text')
  const [required, setRequired] = useState(field?.required ?? false)
  const [defaultValue, setDefaultValue] = useState(field?.defaultValue ?? '')
  const [optionsText, setOptionsText] = useState(field?.options.join(', ') ?? '')

  const isEdit = field !== null
  const nameInvalid = name.trim() === ''
  const requiredLocked = type === 'boolean'

  const onSave = () => {
    const trimmedName = name.trim()
    if (trimmedName === '') return
    const nextOptions = type === 'select'
      ? optionsText.split(',').map((v) => v.trim()).filter((v) => v !== '')
      : []
    const trimmedDefault = defaultValue.trim()
    const nextRequired = requiredLocked ? false : required

    if (!isEdit) {
      const id = newId()
      void mutate((m) => createCustomField(m, {
        id,
        name: trimmedName,
        target,
        type,
        options: nextOptions,
        required: nextRequired,
        defaultValue: trimmedDefault === '' ? null : trimmedDefault,
      }), { summary: '커스텀 항목 추가' })
      onOpenChange(false)
      return
    }

    // 선택지를 지우면 그 값을 쓰던 엔티티가 생긴다 — 값은 유지되지만 사용자에게 알린다.
    const fieldId = field.id
    const removed = field.options.filter((o) => !nextOptions.includes(o))
    const affected = removed.reduce((sum, o) => sum + customOptionUsageCount(model, fieldId, o), 0)
    if (affected > 0
      && !window.confirm(`삭제하는 선택지를 ${affected}곳에서 사용 중입니다. 값은 유지됩니다. 계속할까요?`)) {
      return
    }
    void mutate((m) => updateCustomField(m, fieldId, {
      name: trimmedName,
      options: nextOptions,
      required: nextRequired,
      defaultValue: trimmedDefault === '' ? null : trimmedDefault,
    }), { summary: '커스텀 항목 수정' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '커스텀 항목 수정' : '커스텀 항목 추가'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-name">이름</Label>
            <Input id="cf-name" value={name} placeholder="예: 개인정보여부"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-target">적용 대상</Label>
              <select id="cf-target" disabled={isEdit} value={target}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                onChange={(e) => setTarget(e.target.value as CustomField['target'])}>
                {(['table', 'column'] as const).map((t) => (
                  <option key={t} value={t}>{TARGET_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-type">타입</Label>
              <select id="cf-type" disabled={isEdit} value={type}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                onChange={(e) => setType(e.target.value as CustomField['type'])}>
                {(['text', 'boolean', 'select'] as const).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              타입과 적용 대상은 변경할 수 없습니다. 바꾸려면 삭제 후 다시 만드세요.
            </p>
          )}
          {type === 'select' && (
            <div className="grid gap-1.5">
              <Label htmlFor="cf-options">선택지 (쉼표로 구분)</Label>
              <Input id="cf-options" value={optionsText} placeholder="예: 없음, AES256, SHA256"
                onChange={(e) => setOptionsText(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="cf-default">기본값</Label>
            <Input id="cf-default" value={defaultValue}
              placeholder={type === 'boolean' ? 'true 또는 false' : '값을 입력하지 않은 항목에 쓰입니다'}
              onChange={(e) => setDefaultValue(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input id="cf-required" type="checkbox" aria-label="필수"
              checked={required && !requiredLocked} disabled={requiredLocked}
              onChange={(e) => setRequired(e.target.checked)} />
            필수 (미입력 시 경고)
          </label>
          {requiredLocked && (
            <p className="text-xs text-muted-foreground">
              불리언은 항상 값이 있으므로 필수로 지정할 수 없습니다.
            </p>
          )}
          {isEdit && customFieldUsageCount(model, field.id) > 0 && (
            <p className="text-xs text-muted-foreground">
              현재 {customFieldUsageCount(model, field.id)}곳에서 값을 사용 중입니다.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={nameInvalid} onClick={onSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
