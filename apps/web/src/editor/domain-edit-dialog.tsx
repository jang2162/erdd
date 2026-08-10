import { useState } from 'react'
import { DIALECTS, type Dialect, type Domain } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { createDomain, updateDomain, usageOf } from './domain-edits.js'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldLabel } from '@/components/field-label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type DialectText = Record<Dialect, string>

const EMPTY_DIALECT_TEXT: DialectText = { postgresql: '', mysql: '', oracle: '', mssql: '' }

function toDialectText(domain: Domain | null): DialectText {
  if (!domain) return EMPTY_DIALECT_TEXT
  return {
    postgresql: domain.dialectTypes.postgresql ?? '',
    mysql: domain.dialectTypes.mysql ?? '',
    oracle: domain.dialectTypes.oracle ?? '',
    mssql: domain.dialectTypes.mssql ?? '',
  }
}

/**
 * "도메인" 패널의 추가/수정 폼.
 * 신규는 확인 없이 단일 `createDomain` mutation. 수정은 라이브 해석(resolveColumn)이라
 * 영향받는 컬럼 수(usageOf)가 있으면 확인 후 단일 `updateDomain` mutation으로 반영한다(별도 적용 액션 없음).
 * 모든 입력값은 컨트롤드 state로 즉시 캡처되고, 저장 시 그 state에서 뽑은 const만 producer에 넘긴다
 * (producer 안에서 이벤트 값을 lazy read하지 않는다).
 */
export function DomainEditDialog({
  projectId, domain, open, onOpenChange,
}: {
  projectId: string
  domain: Domain | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)

  const [name, setName] = useState(domain?.name ?? '')
  const [category, setCategory] = useState(domain?.category ?? '')
  const [logicalType, setLogicalType] = useState(domain?.logicalType ?? '')
  const [dialectTypes, setDialectTypes] = useState<DialectText>(toDialectText(domain))
  const [defaultValue, setDefaultValue] = useState(domain?.defaultValue ?? '')
  const [allowedValuesText, setAllowedValuesText] = useState(domain?.allowedValues.join(', ') ?? '')
  const [description, setDescription] = useState(domain?.description ?? '')

  const nameInvalid = name.trim() === ''
  const logicalTypeInvalid = logicalType.trim() === ''

  const onSave = () => {
    // producer 진입 전 즉시 캡처(state는 이미 각 onChange에서 캡처됐으므로, 여기서는 그 state를
    // 정규화한 const만 만든다 — producer 클로저 안에서 입력 상태를 다시 읽지 않는다).
    const trimmedName = name.trim()
    if (trimmedName === '') return
    const trimmedLogicalType = logicalType.trim()
    if (trimmedLogicalType === '') return
    const trimmedCategory = category.trim()
    const nextDialectTypes = {
      postgresql: dialectTypes.postgresql.trim() === '' ? null : dialectTypes.postgresql.trim(),
      mysql: dialectTypes.mysql.trim() === '' ? null : dialectTypes.mysql.trim(),
      oracle: dialectTypes.oracle.trim() === '' ? null : dialectTypes.oracle.trim(),
      mssql: dialectTypes.mssql.trim() === '' ? null : dialectTypes.mssql.trim(),
    }
    const trimmedDefaultValue = defaultValue.trim()
    const nextAllowedValues = allowedValuesText.split(',').map((v) => v.trim()).filter((v) => v !== '')
    const trimmedDescription = description.trim()

    if (domain === null) {
      const id = newId()
      void mutate((m) => createDomain(m, {
        id,
        name: trimmedName,
        category: trimmedCategory === '' ? null : trimmedCategory,
        logicalType: trimmedLogicalType,
        dialectTypes: nextDialectTypes,
        defaultValue: trimmedDefaultValue === '' ? null : trimmedDefaultValue,
        allowedValues: nextAllowedValues,
        description: trimmedDescription === '' ? null : trimmedDescription,
        origin: null,
      }), { summary: '도메인 추가' })
      onOpenChange(false)
      return
    }

    const domainId = domain.id
    const affected = usageOf(model, domainId).length
    if (affected > 0 && !window.confirm(`${affected}개 컬럼에 영향을 줍니다. 계속할까요?`)) return
    void mutate((m) => updateDomain(m, domainId, {
      name: trimmedName,
      category: trimmedCategory === '' ? null : trimmedCategory,
      logicalType: trimmedLogicalType,
      dialectTypes: nextDialectTypes,
      defaultValue: trimmedDefaultValue === '' ? null : trimmedDefaultValue,
      allowedValues: nextAllowedValues,
      description: trimmedDescription === '' ? null : trimmedDescription,
    }), { summary: '도메인 수정' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{domain === null ? '도메인 추가' : '도메인 수정'}</DialogTitle></DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto">
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-name" required>이름</FieldLabel>
            <Input id="dom-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-category">분류</FieldLabel>
            <Input
              id="dom-category" value={category} placeholder="예: 금액, 상태코드"
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-logical-type" required>논리 타입</FieldLabel>
            <Input
              id="dom-logical-type" className="font-mono" value={logicalType} placeholder="예: DECIMAL(15)"
              onChange={(e) => setLogicalType(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">방언별 물리 타입 (선택)</span>
            <div className="grid grid-cols-2 gap-2">
              {DIALECTS.map((d) => (
                <div key={d} className="grid gap-1">
                  <Label htmlFor={`dom-dialect-${d}`} className="text-xs text-muted-foreground">
                    {DIALECT_LABEL[d]}
                  </Label>
                  <Input
                    id={`dom-dialect-${d}`} className="font-mono" value={dialectTypes[d]}
                    onChange={(e) => {
                      const v = e.target.value
                      setDialectTypes((prev) => ({ ...prev, [d]: v }))
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-default">기본값</FieldLabel>
            <Input id="dom-default" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-allowed">허용값 (쉼표로 구분)</FieldLabel>
            <Input
              id="dom-allowed" value={allowedValuesText} placeholder="예: ACTIVE, INACTIVE"
              onChange={(e) => setAllowedValuesText(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="dom-description">설명</FieldLabel>
            <textarea
              id="dom-description" className="min-h-16 rounded-md border bg-background p-2 text-sm"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={nameInvalid || logicalTypeInvalid} onClick={onSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
