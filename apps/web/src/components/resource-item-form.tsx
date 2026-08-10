import { useState } from 'react'
import { DIALECTS, type Dialect, type ResourceKind } from '@erdd/core'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/field-label'

export type DomainOption = { id: string; name: string }

const TARGET_LABEL = { table: '테이블', column: '컬럼' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

function str(payload: Record<string, unknown> | null, key: string): string {
  const value = payload?.[key]
  return typeof value === 'string' ? value : ''
}
function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
function selectClass(): string {
  return 'h-9 rounded-md border bg-background px-2 text-sm'
}

/**
 * 라이브러리 항목(단어·용어·도메인·커스텀 항목)의 추가/수정 폼.
 * 제출 payload는 core RESOURCE_PAYLOAD_SCHEMAS[kind]를 통과하는 형태다(서버가 재검증).
 * 모든 입력은 컨트롤드 state로 즉시 캡처하고, 저장 시 그 state에서 뽑은 값만 넘긴다.
 */
export function ResourceItemForm({
  kind, payload, domainOptions, onSubmit, onCancel,
}: {
  kind: ResourceKind
  payload: Record<string, unknown> | null
  domainOptions: DomainOption[]
  onSubmit: (payload: Record<string, unknown>) => void
  onCancel: () => void
}) {
  // 공통
  const [name, setName] = useState(
    kind === 'domain' || kind === 'customField' ? str(payload, 'name') : str(payload, 'logicalName'),
  )
  const [description, setDescription] = useState(str(payload, 'description'))
  // word
  const [abbreviation, setAbbreviation] = useState(str(payload, 'abbreviation'))
  // term
  const [physicalName, setPhysicalName] = useState(str(payload, 'physicalName'))
  const [domainId, setDomainId] = useState(str(payload, 'domainId'))
  // domain
  const [category, setCategory] = useState(str(payload, 'category'))
  const [logicalType, setLogicalType] = useState(str(payload, 'logicalType'))
  const [dialectTypes, setDialectTypes] = useState<Record<Dialect, string>>(() => {
    const source = (payload?.dialectTypes ?? {}) as Partial<Record<Dialect, string | null>>
    return {
      postgresql: source.postgresql ?? '', mysql: source.mysql ?? '',
      oracle: source.oracle ?? '', mssql: source.mssql ?? '',
    }
  })
  const [allowedValuesText, setAllowedValuesText] = useState(
    Array.isArray(payload?.allowedValues) ? (payload.allowedValues as string[]).join(', ') : '',
  )
  const [defaultValue, setDefaultValue] = useState(str(payload, 'defaultValue'))
  // customField
  const [target, setTarget] = useState<'table' | 'column'>(
    payload?.target === 'table' ? 'table' : 'column',
  )
  const [type, setType] = useState<'text' | 'boolean' | 'select'>(
    payload?.type === 'boolean' ? 'boolean' : payload?.type === 'select' ? 'select' : 'text',
  )
  const [optionsText, setOptionsText] = useState(
    Array.isArray(payload?.options) ? (payload.options as string[]).join(', ') : '',
  )
  const [required, setRequired] = useState(payload?.required === true)

  const parsedOptions = [...new Set(
    optionsText.split(',').map((v) => v.trim()).filter((v) => v !== ''),
  )]
  const parsedAllowed = [...new Set(
    allowedValuesText.split(',').map((v) => v.trim()).filter((v) => v !== ''),
  )]
  const trimmedDefault = defaultValue.trim()
  const requiredLocked = type === 'boolean'

  const nameInvalid = name.trim() === ''
  const logicalTypeInvalid = kind === 'domain' && logicalType.trim() === ''
  const physicalNameInvalid = kind === 'term' && physicalName.trim() === ''
  const abbreviationInvalid = kind === 'word' && abbreviation.trim() === ''
  const selectOptionsEmpty = kind === 'customField' && type === 'select' && parsedOptions.length === 0
  const selectDefaultInvalid = kind === 'customField' && type === 'select'
    && trimmedDefault !== '' && !parsedOptions.includes(trimmedDefault)
  const booleanDefaultInvalid = kind === 'customField' && type === 'boolean'
    && trimmedDefault !== '' && trimmedDefault !== 'true' && trimmedDefault !== 'false'
  const saveDisabled = nameInvalid || logicalTypeInvalid || physicalNameInvalid
    || abbreviationInvalid || selectOptionsEmpty || selectDefaultInvalid || booleanDefaultInvalid

  const onSave = () => {
    if (saveDisabled) return
    const trimmedName = name.trim()
    if (kind === 'word') {
      onSubmit({
        logicalName: trimmedName, abbreviation: abbreviation.trim(),
        description: nullable(description),
      })
      return
    }
    if (kind === 'term') {
      onSubmit({
        logicalName: trimmedName, physicalName: physicalName.trim(),
        domainId: domainId === '' ? null : domainId, description: nullable(description),
      })
      return
    }
    if (kind === 'domain') {
      onSubmit({
        name: trimmedName, category: nullable(category), logicalType: logicalType.trim(),
        dialectTypes: Object.fromEntries(
          DIALECTS.map((d) => [d, nullable(dialectTypes[d])]),
        ) as Record<Dialect, string | null>,
        defaultValue: nullable(defaultValue), allowedValues: parsedAllowed,
        description: nullable(description),
      })
      return
    }
    onSubmit({
      name: trimmedName, target, type,
      options: type === 'select' ? parsedOptions : [],
      required: requiredLocked ? false : required,
      defaultValue: nullable(defaultValue),
    })
  }

  const nameLabel = kind === 'domain' || kind === 'customField' ? '이름' : '논리명'

  return (
    <div className="grid gap-3">
      {kind === 'word' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="ri-abbr" required>물리 약어</FieldLabel>
          <Input id="ri-abbr" className="font-mono" value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)} />
        </div>
      )}

      {kind === 'term' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="ri-physical" required>물리명</FieldLabel>
          <Input id="ri-physical" className="font-mono" value={physicalName}
            onChange={(e) => setPhysicalName(e.target.value)} />
        </div>
      )}

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="ri-name" required>{nameLabel}</FieldLabel>
        <Input id="ri-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {kind === 'term' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="ri-domain">기본 도메인</FieldLabel>
          <select id="ri-domain" className={selectClass()} value={domainId}
            onChange={(e) => setDomainId(e.target.value)}>
            <option value="">선택 안 함</option>
            {domainOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {kind === 'domain' && (
        <>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="ri-category">분류</FieldLabel>
            <Input id="ri-category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="ri-logical-type" required>논리 타입</FieldLabel>
            <Input id="ri-logical-type" className="font-mono" value={logicalType}
              placeholder="예: VARCHAR(100)" onChange={(e) => setLogicalType(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DIALECTS.map((d) => (
              <div key={d} className="grid gap-1.5">
                <FieldLabel htmlFor={`ri-dialect-${d}`}>{DIALECT_LABEL[d]} 물리 타입</FieldLabel>
                <Input id={`ri-dialect-${d}`} className="font-mono" value={dialectTypes[d]}
                  onChange={(e) => {
                    const value = e.target.value
                    setDialectTypes((prev) => ({ ...prev, [d]: value }))
                  }} />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="ri-allowed">허용값 (쉼표로 구분)</FieldLabel>
            <Input id="ri-allowed" value={allowedValuesText}
              onChange={(e) => setAllowedValuesText(e.target.value)} />
          </div>
        </>
      )}

      {kind === 'customField' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="ri-target" required>적용 대상</FieldLabel>
              <select id="ri-target" className={selectClass()} value={target}
                onChange={(e) => setTarget(e.target.value as 'table' | 'column')}>
                {(['table', 'column'] as const).map((t) => (
                  <option key={t} value={t}>{TARGET_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="ri-type" required>타입</FieldLabel>
              <select id="ri-type" className={selectClass()} value={type}
                onChange={(e) => setType(e.target.value as 'text' | 'boolean' | 'select')}>
                {(['text', 'boolean', 'select'] as const).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          {type === 'select' && (
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="ri-options" required>선택지 (쉼표로 구분)</FieldLabel>
              <Input id="ri-options" value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)} />
              {selectOptionsEmpty && (
                <p className="text-xs text-destructive">선택형은 선택지를 하나 이상 입력해야 합니다</p>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label="필수" checked={required && !requiredLocked}
              disabled={requiredLocked} onChange={(e) => setRequired(e.target.checked)} />
            필수 (미입력 시 경고)
          </label>
        </>
      )}

      {kind !== 'word' && kind !== 'term' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="ri-default">기본값</FieldLabel>
          <Input id="ri-default" value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)} />
          {selectDefaultInvalid && (
            <p className="text-xs text-destructive">기본값은 선택지 중 하나여야 합니다</p>
          )}
          {booleanDefaultInvalid && (
            <p className="text-xs text-destructive">불리언 기본값은 true 또는 false여야 합니다</p>
          )}
        </div>
      )}

      {kind !== 'customField' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="ri-description">설명</FieldLabel>
          <Input id="ri-description" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="button" disabled={saveDisabled} onClick={onSave}>저장</Button>
      </div>
    </div>
  )
}
