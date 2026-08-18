import { useEffect, useMemo, useRef, type Ref } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  composeTableLogicalName, composeTablePhysicalName, computeWarnings, customFieldsFor, generatePhysicalName, setTableGroup,
  type Column, type CustomField, type Domain, type ProjectModel, type Warning,
} from '@erdd/core'
import { primaryTableId, useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { updateTable } from './model-edits.js'
import {
  addColumn, clearColumnDomain, removeColumn, reorderColumn, setColumnDomain, updateColumn,
} from './column-edits.js'
import { canRegisterTerm, createTerm } from './dict-edits.js'
import { NamePair, type NameDraft, type NamePatch } from './name-pair.js'
import { setCustomValue } from './custom-field-edits.js'
import { BulkPanel } from './bulk-panel.js'
import { RelationshipPanel } from './relationship-panel.js'
import { NotePanel } from './note-panel.js'
import { GroupPanel } from './group-panel.js'
import { IndexSection } from './index-section.js'
import { WarningBadge } from './warning-badge.js'
import { CustomFieldsSection } from './custom-fields-section.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/field-label'
import { cn } from '@/lib/utils'

/** blur 시 값이 바뀌었으면 producer로 커밋하는 제어 인풋. */
function CommitInput(props: {
  id?: string; label?: string; value: string; mono?: boolean; readOnly?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <Input
      id={props.id}
      aria-label={props.label ? props.label : undefined}
      defaultValue={props.value}
      key={props.value}
      className={props.mono ? 'font-mono' : undefined}
      readOnly={props.readOnly}
      onBlur={(e) => {
        if (e.target.value !== props.value) props.onCommit(e.target.value)
      }}
    />
  )
}

export function EditPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const selectedTableId = useEditorStore(primaryTableId)
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const selectedColumnIds = useEditorStore((s) => s.selectedColumnIds)
  const selectedRelationshipId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const mutate = useModelMutation(projectId)
  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  const table = selectedTableIds.length === 1 ? model.tables[selectedTableIds[0]!] : undefined
  const warnings = useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])
  const tableFields = useMemo(() => customFieldsFor(model, 'table'), [model])
  const columnFields = useMemo(() => customFieldsFor(model, 'column'), [model])
  const selectedRowRef = useRef<HTMLLIElement | null>(null)
  const firstSelectedColumnId = selectedColumnIds[0]
  useEffect(() => {
    // block: 'nearest' — 이미 보이는 컬럼을 클릭했을 때 패널이 튀지 않아야 한다.
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [firstSelectedColumnId])

  if (selectedRelationshipId) return <RelationshipPanel projectId={projectId} />

  if (selectedNoteId) return <NotePanel projectId={projectId} />

  if (selectedGroupId) return <GroupPanel projectId={projectId} />

  // 상세 편집(컬럼 목록·논리명·커스텀 항목)은 다중 선택에서 의미가 모호하다 — 일괄 작업으로 바꾼다.
  // BulkPanel이 main의 「N개 선택됨」 안내를 흡수한다(개수 + 목록 + 그룹 이동 + 삭제).
  if (selectedTableIds.length >= 2) return <BulkPanel projectId={projectId} />

  if (!table) {
    return (
      <aside className="w-80 shrink-0 border-l bg-card p-4">
        <p className="text-sm text-muted-foreground">테이블을 선택하면 여기서 편집합니다.</p>
      </aside>
    )
  }

  const columns = Object.values(model.columns)
    .filter((c) => c.tableId === table.id)
    .sort((a, b) => a.order - b.order)
  const tid = table.id

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="grid gap-3">
        {/* key={tid} — 선택이 다른 테이블로 옮겨갈 때 draft 가 남지 않게 한다. */}
        <NamePair
          key={tid}
          projectId={projectId}
          logicalName={table.logicalName}
          physicalName={table.physicalName}
          idPrefix="tbl"
          physicalLabel="테이블 물리명"
          canEdit={canEdit}
          applyNames={(m, patch) => updateTable(m, tid, patch)}
        />
        {/* ⚠️ NamePair **밖**에 둔다 — NamePair 는 컬럼과 공유하는데 컬럼에는 템플릿이 없다.
            두 줄이 나란히 서므로 라벨로 구분한다(슬롯 prop 을 뚫는 것보다 싸다). */}
        {namingRules.tablePhysicalTemplate !== '' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-mono">물리 → {composeTablePhysicalName(table, model, namingRules)}</span>
          </p>
        )}
        {namingRules.tableLogicalTemplate !== '' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-mono">논리 → {composeTableLogicalName(table, model, namingRules)}</span>
          </p>
        )}
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="tbl-group">소속 그룹</FieldLabel>
          <select id="tbl-group" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={table.groupId ?? ''} disabled={!canEdit}
            onChange={(e) => {
              const groupId = e.target.value === '' ? null : e.target.value
              void mutate((m) => setTableGroup(m, tid, groupId), { summary: '그룹 배정' })
            }}>
            <option value="">미분류</option>
            {Object.values(model.tableGroups).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <CustomFieldsSection
          fields={tableFields} values={table.custom} idPrefix={`tbl-custom-${tid}`}
          warnings={warnings.filter((w) => w.scope === 'table' && w.entityId === tid)}
          canEdit={canEdit}
          onChange={(fieldId, value) => {
            void mutate((m) => setCustomValue(m, 'table', tid, fieldId, value),
              { summary: '커스텀 항목 값 변경' })
          }}
        />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold">컬럼</h3>
        {canEdit && (
          <Button size="sm" variant="outline"
            onClick={() => void mutate((m) => addColumn(m, tid, { id: newId() }), { summary: '컬럼 추가' })}>
            <Plus /> 컬럼 추가
          </Button>
        )}
      </div>

      <ul className="mt-2 grid gap-3">
        {columns.map((c, i) => {
          /**
           * 컬럼 이름 갱신 규칙. 대상별 규칙을 담는 자리이므로 「논리명이 용어와 완전일치하면
           * 도메인도 함께 채운다」가 여기에 있다.
           * ⚠️ **물리명이 비어 있던 경우에만** 돈다 — main 의 옛 동작이 그 가드 안에 있었고,
           * 가드를 없애 「항상」으로 넓히는 것은 설계·문서에 근거가 없는 제품 동작 변경이다
           * (HANDOFF 6절 이월). `m` 은 producer 진입 시점 모델이라 "변경 전 물리명"을 그대로 읽는다.
           */
          const applyNames = (m: ProjectModel, patch: NamePatch) => {
            const before = m.columns[c.id]
            const next = updateColumn(m, c.id, patch)
            const cur = next.columns[c.id]
            if (patch.logicalName === undefined || !before || !cur) return next
            if (before.physicalName.trim() !== '' || patch.logicalName.trim() === '') return next
            if (cur.domainId !== null) return next
            const gen = generatePhysicalName(patch.logicalName, next.words, next.terms, namingRules)
            return gen.domainId ? setColumnDomain(next, c.id, gen.domainId) : next
          }
          return (
          <ColumnRow
            key={c.id} column={c} isFirst={i === 0} isLast={i === columns.length - 1} canEdit={canEdit}
            domains={Object.values(model.domains)}
            selected={selectedColumnIds.includes(c.id)}
            rowRef={c.id === firstSelectedColumnId ? selectedRowRef : undefined}
            warnings={warnings.filter((w) => w.scope === 'column' && w.entityId === c.id)}
            onPatch={(patch) => void mutate((m) => updateColumn(m, c.id, patch))}
            onRemove={() => void mutate((m) => removeColumn(m, c.id), { summary: '컬럼 삭제' })}
            onMove={(dir) => void mutate((m) => reorderColumn(m, c.id, dir))}
            projectId={projectId}
            applyNames={applyNames}
            onRegisterTerm={(draft) => {
              // ⚠️ 아직 커밋되지 않은 draft 를 쓴다. 커밋값을 읽으면 「치고 바로 등록」에서 컬럼은
              // 새 이름으로, 용어는 옛 이름으로 갈라진다(설계 §3.2 가 지목한 "등록 버튼").
              const { logicalName, physicalName } = draft
              const domainId = c.domainId
              const id = newId()
              // 이름 확정과 용어 등록을 **한 producer** 로 묶는다 — 갈리면 Revision 2건에 내용도 어긋난다.
              void mutate((m) => {
                const patch: NamePatch = {}
                if (logicalName !== c.logicalName) patch.logicalName = logicalName
                if (physicalName !== c.physicalName) patch.physicalName = physicalName
                const next = Object.keys(patch).length > 0 ? applyNames(m, patch) : m
                return createTerm(
                  next, { id, logicalName, physicalName, domainId, description: null, origin: null },
                )
              }, { summary: '용어 등록' }).then((r) => {
                // useModelMutation 의 계약 — 완료 토스트는 applied 일 때만 낸다(거절·noop 은 아니다).
                if (r === 'applied') toast.success(`용어 「${logicalName}」을(를) 등록했습니다`)
              })
            }}
            onDomainChange={(domainId) => {
              if (domainId === '') {
                void mutate((m) => clearColumnDomain(m, c.id), { summary: '도메인 해제' })
              } else {
                void mutate((m) => setColumnDomain(m, c.id, domainId), { summary: '도메인 지정' })
              }
            }}
            customFields={columnFields}
            onCustomChange={(fieldId, value) => {
              void mutate((m) => setCustomValue(m, 'column', c.id, fieldId, value),
                { summary: '커스텀 항목 값 변경' })
            }}
          />
          )
        })}
        {columns.length === 0 && <li className="text-xs text-muted-foreground">컬럼이 없습니다.</li>}
      </ul>

      <IndexSection projectId={projectId} tableId={tid} />
    </aside>
  )
}

function ColumnRow(props: {
  column: Column; isFirst: boolean; isLast: boolean; warnings: Warning[]; domains: Domain[]
  canEdit: boolean
  selected: boolean
  rowRef?: Ref<HTMLLIElement>
  projectId: string
  onPatch: (patch: Partial<Omit<Column, 'id' | 'tableId'>>) => void
  onRemove: () => void; onMove: (dir: -1 | 1) => void
  onDomainChange: (domainId: string) => void
  applyNames: (m: ProjectModel, patch: NamePatch) => ProjectModel
  onRegisterTerm: (draft: NameDraft) => void
  customFields: CustomField[]
  onCustomChange: (fieldId: string, value: string) => void
}) {
  const { column: c, canEdit } = props
  const model = useEditorStore((s) => s.model)
  // 용어 중복 판정은 프로젝트 규칙으로 구분자를 벗겨 비교한다(설계 D4).
  const namingRules = useEditorStore((s) => s.namingRules)
  const locked = c.domainId !== null
  const domain = locked ? props.domains.find((d) => d.id === c.domainId) : undefined
  return (
    <li
      className={cn('relative grid gap-2 rounded-md border p-2', props.selected && 'ring-2 ring-primary')}
      aria-selected={props.selected}
      ref={props.rowRef}
    >
      {/*
        ⚠️ 배지를 NamePair 와 같은 flex row 에 두면 shrink-0 인 배지가 폭을 뺏어
        **경고가 있는 컬럼만 입력란이 좁아진다**(320px 사이드바에서 컬럼마다 폭이 들쭉날쭉해진다).
        직전 사이클 설계 3.7 의 「카드 우상단」 의도대로 띄운다. 물리명 라벨이 짧아 겹치지 않는다.
      */}
      <WarningBadge warnings={props.warnings} className="absolute top-2 right-2" />
      <NamePair
        projectId={props.projectId}
        logicalName={c.logicalName}
        physicalName={c.physicalName}
        idPrefix={`col-${c.id}`}
        physicalLabel="물리명"
        canEdit={canEdit}
        applyNames={props.applyNames}
        extra={canEdit ? (draft) => {
          // 판정도 draft 기준이다 — 커밋값으로 보면 방금 친 이름이 중복인데도 버튼이 활성이다.
          const termCheck = canRegisterTerm(model, draft, namingRules)
          return (
            <div>
              <Button
                size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                disabled={!termCheck.ok}
                title={termCheck.reason === 'duplicate'
                  ? '같은 논리명의 용어가 이미 있습니다'
                  : termCheck.reason === 'empty'
                    ? '논리명과 물리명이 모두 있어야 등록할 수 있습니다'
                    : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onRegisterTerm(draft)}
              >
                용어 등록
              </Button>
            </div>
          )
        } : undefined}
      />
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`col-domain-${c.id}`}>도메인</FieldLabel>
        <select id={`col-domain-${c.id}`}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={c.domainId ?? ''} disabled={!canEdit}
          onChange={(e) => {
            const domainId = e.target.value
            props.onDomainChange(domainId)
          }}>
          <option value="">없음</option>
          {props.domains.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      {locked ? (
        <Input aria-label="타입" className="font-mono" disabled readOnly
          value={domain ? `${domain.logicalType} (도메인: ${domain.name})` : c.type} />
      ) : (
        <CommitInput label="타입" value={c.type} mono readOnly={!canEdit} onCommit={(v) => props.onPatch({ type: v })} />
      )}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={c.isPk} disabled={!canEdit}
            onChange={(e) => props.onPatch({ isPk: e.target.checked })} /> PK
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!c.nullable} disabled={!canEdit}
            onChange={(e) => props.onPatch({ nullable: !e.target.checked })} /> NN
        </label>
        <span className="ml-auto flex gap-1">
          {canEdit && (
            <>
              <Button size="icon" variant="ghost" className="size-6" disabled={props.isFirst}
                aria-label="위로" onClick={() => props.onMove(-1)}><ChevronUp className="size-3" /></Button>
              <Button size="icon" variant="ghost" className="size-6" disabled={props.isLast}
                aria-label="아래로" onClick={() => props.onMove(1)}><ChevronDown className="size-3" /></Button>
              <Button size="icon" variant="ghost" className="size-6 text-destructive"
                aria-label="컬럼 삭제" onClick={props.onRemove}><Trash2 className="size-3" /></Button>
            </>
          )}
        </span>
      </div>
      <CustomFieldsSection
        fields={props.customFields} values={c.custom} idPrefix={`col-custom-${c.id}`}
        warnings={props.warnings.filter((w) => w.kind === 'custom-required')}
        canEdit={canEdit}
        onChange={props.onCustomChange}
      />
    </li>
  )
}
