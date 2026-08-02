import { resolveCustomValue, type CustomField, type Warning } from '@erdd/core'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 커스텀 항목 값 입력. 테이블 영역과 컬럼 행에서 함께 쓴다.
 * 미입력(키 없음)은 정의 기본값으로 해석해 보여주고, 값 커밋은 항상 문자열이다
 * (불리언은 'true'/'false'). 빈 문자열을 커밋하면 호출부가 키를 지워 미입력으로 되돌린다.
 */
export function CustomFieldsSection(props: {
  fields: CustomField[]
  values: Record<string, string>
  idPrefix: string
  warnings: Warning[]
  /** 편집 권한(store의 canEdit). 부모(edit-panel 등)가 prop으로 내려준다 — 이 컴포넌트는 store를 직접 읽지 않는다. */
  canEdit: boolean
  onChange: (fieldId: string, value: string) => void
}) {
  if (props.fields.length === 0) return null
  const entity = { custom: props.values }
  const hasRequiredWarning = props.warnings.some((w) => w.kind === 'custom-required')

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">커스텀 항목</span>
        {hasRequiredWarning && (
          <span className="rounded bg-key/15 px-1 text-[10px] font-medium text-key">필수</span>
        )}
      </div>
      {props.fields.map((f) => {
        const id = `${props.idPrefix}-${f.id}`
        const value = resolveCustomValue(entity, f)
        if (f.type === 'boolean') {
          return (
            <label key={f.id} className="flex items-center gap-2 text-sm">
              <input
                id={id} type="checkbox" aria-label={f.name} checked={value === 'true'} disabled={!props.canEdit}
                onChange={(e) => {
                  const next = e.target.checked ? 'true' : 'false'
                  props.onChange(f.id, next)
                }}
              />
              {f.name}
            </label>
          )
        }
        if (f.type === 'select') {
          // 정의에서 사라진 선택지를 값으로 갖고 있으면 비활성 옵션으로 남겨 값 유실을 막는다
          const orphan = value !== '' && !f.options.includes(value)
          return (
            <div key={f.id} className="grid gap-1.5">
              <Label htmlFor={id}>{f.name}{f.required && <span className="text-destructive"> *</span>}</Label>
              <select
                id={id} aria-label={f.name} value={value} disabled={!props.canEdit}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                onChange={(e) => {
                  const next = e.target.value
                  props.onChange(f.id, next)
                }}
              >
                <option value="">선택 안 함</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                {orphan && <option value={value} disabled>{value} (삭제된 선택지)</option>}
              </select>
            </div>
          )
        }
        return (
          <div key={f.id} className="grid gap-1.5">
            <Label htmlFor={id}>{f.name}{f.required && <span className="text-destructive"> *</span>}</Label>
            <Input
              id={id} aria-label={f.name} defaultValue={value} key={value} readOnly={!props.canEdit}
              onBlur={(e) => {
                const next = e.target.value
                if (next !== value) props.onChange(f.id, next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
