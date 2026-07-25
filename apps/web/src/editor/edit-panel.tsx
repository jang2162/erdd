import { useMemo } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import {
  computeWarnings, generatePhysicalName, setTableGroup, type Column, type Domain, type Warning,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { updateTable } from './model-edits.js'
import {
  addColumn, clearColumnDomain, removeColumn, reorderColumn, setColumnDomain, updateColumn,
} from './column-edits.js'
import { createTerm } from './dict-edits.js'
import { RelationshipPanel } from './relationship-panel.js'
import { NotePanel } from './note-panel.js'
import { GroupPanel } from './group-panel.js'
import { IndexSection } from './index-section.js'
import { WarningBadge } from './warning-badge.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** blur 시 값이 바뀌었으면 producer로 커밋하는 제어 인풋. */
function CommitInput(props: {
  id?: string; label?: string; value: string; mono?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <Input
      id={props.id}
      aria-label={props.label ? props.label : undefined}
      defaultValue={props.value}
      key={props.value}
      className={props.mono ? 'font-mono' : undefined}
      onBlur={(e) => {
        if (e.target.value !== props.value) props.onCommit(e.target.value)
      }}
    />
  )
}

export function EditPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const selectedRelationshipId = useEditorStore((s) => s.selectedRelationshipId)
  const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const mutate = useModelMutation(projectId)
  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  const table = selectedTableId ? model.tables[selectedTableId] : undefined
  const warnings = useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])

  if (selectedRelationshipId) return <RelationshipPanel projectId={projectId} />

  if (selectedNoteId) return <NotePanel projectId={projectId} />

  if (selectedGroupId) return <GroupPanel projectId={projectId} />

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
        <div className="grid gap-1.5">
          <Label htmlFor="tbl-logical">논리명</Label>
          <CommitInput id="tbl-logical" value={table.logicalName}
            onCommit={(v) => {
              const logical = v
              void mutate((m) => {
                let next = updateTable(m, tid, { logicalName: logical })
                const cur = next.tables[tid]
                if (cur && cur.physicalName.trim() === '' && logical.trim() !== '') {
                  const gen = generatePhysicalName(logical, next.words, next.terms, namingRules)
                  if (gen.physicalName) next = updateTable(next, tid, { physicalName: gen.physicalName })
                }
                return next
              }, { summary: '논리명 변경' })
            }} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="tbl-physical">테이블 물리명</Label>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
              onClick={() => {
                const logical = table.logicalName
                void mutate((m) => {
                  const gen = generatePhysicalName(logical, m.words, m.terms, namingRules)
                  return gen.physicalName ? updateTable(m, tid, { physicalName: gen.physicalName }) : m
                }, { summary: '물리명 재생성' })
              }}>재생성</Button>
          </div>
          <CommitInput id="tbl-physical" value={table.physicalName} mono
            onCommit={(v) => void mutate((m) => updateTable(m, tid, { physicalName: v }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tbl-group">소속 그룹</Label>
          <select id="tbl-group" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={table.groupId ?? ''}
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
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold">컬럼</h3>
        <Button size="sm" variant="outline"
          onClick={() => void mutate((m) => addColumn(m, tid, { id: newId() }), { summary: '컬럼 추가' })}>
          <Plus /> 컬럼 추가
        </Button>
      </div>

      <ul className="mt-2 grid gap-3">
        {columns.map((c, i) => (
          <ColumnRow
            key={c.id} column={c} isFirst={i === 0} isLast={i === columns.length - 1}
            domains={Object.values(model.domains)}
            warnings={warnings.filter((w) => w.scope === 'column' && w.entityId === c.id)}
            onPatch={(patch) => void mutate((m) => updateColumn(m, c.id, patch))}
            onRemove={() => void mutate((m) => removeColumn(m, c.id), { summary: '컬럼 삭제' })}
            onMove={(dir) => void mutate((m) => reorderColumn(m, c.id, dir))}
            onLogicalName={(v) => {
              const logical = v
              void mutate((m) => {
                let next = updateColumn(m, c.id, { logicalName: logical })
                const cur = next.columns[c.id]
                if (cur && cur.physicalName.trim() === '' && logical.trim() !== '') {
                  const gen = generatePhysicalName(logical, next.words, next.terms, namingRules)
                  if (gen.physicalName) next = updateColumn(next, c.id, { physicalName: gen.physicalName })
                  if (gen.domainId && cur.domainId === null) next = setColumnDomain(next, c.id, gen.domainId)
                }
                return next
              }, { summary: '논리명 변경' })
            }}
            onRegenerate={() => {
              const logical = c.logicalName
              void mutate((m) => {
                const gen = generatePhysicalName(logical, m.words, m.terms, namingRules)
                return gen.physicalName ? updateColumn(m, c.id, { physicalName: gen.physicalName }) : m
              }, { summary: '물리명 재생성' })
            }}
            onRegisterTerm={() => {
              const logicalName = c.logicalName
              const physicalName = c.physicalName
              const domainId = c.domainId
              if (logicalName.trim() === '' || physicalName.trim() === '') return
              void mutate(
                (m) => createTerm(m, { id: newId(), logicalName, physicalName, domainId, description: null }),
                { summary: '용어 등록' },
              )
            }}
            onDomainChange={(domainId) => {
              if (domainId === '') {
                void mutate((m) => clearColumnDomain(m, c.id), { summary: '도메인 해제' })
              } else {
                void mutate((m) => setColumnDomain(m, c.id, domainId), { summary: '도메인 지정' })
              }
            }}
          />
        ))}
        {columns.length === 0 && <li className="text-xs text-muted-foreground">컬럼이 없습니다.</li>}
      </ul>

      <IndexSection projectId={projectId} tableId={tid} />
    </aside>
  )
}

function ColumnRow(props: {
  column: Column; isFirst: boolean; isLast: boolean; warnings: Warning[]; domains: Domain[]
  onPatch: (patch: Partial<Omit<Column, 'id' | 'tableId'>>) => void
  onRemove: () => void; onMove: (dir: -1 | 1) => void
  onDomainChange: (domainId: string) => void
  onLogicalName: (value: string) => void
  onRegenerate: () => void
  onRegisterTerm: () => void
}) {
  const { column: c } = props
  const locked = c.domainId !== null
  const domain = locked ? props.domains.find((d) => d.id === c.domainId) : undefined
  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <CommitInput label="논리명" value={c.logicalName} onCommit={props.onLogicalName} />
          <CommitInput label="물리명" value={c.physicalName} mono onCommit={(v) => props.onPatch({ physicalName: v })} />
        </div>
        <WarningBadge warnings={props.warnings} className="shrink-0" />
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
          aria-label="물리명 재생성" onClick={props.onRegenerate}>재생성</Button>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
          aria-label="용어로 등록" onClick={props.onRegisterTerm}>용어 등록</Button>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`col-domain-${c.id}`}>도메인</Label>
        <select id={`col-domain-${c.id}`}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={c.domainId ?? ''}
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
        <CommitInput label="타입" value={c.type} mono onCommit={(v) => props.onPatch({ type: v })} />
      )}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={c.isPk} onChange={(e) => props.onPatch({ isPk: e.target.checked })} /> PK
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!c.nullable} onChange={(e) => props.onPatch({ nullable: !e.target.checked })} /> NN
        </label>
        <span className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" className="size-6" disabled={props.isFirst}
            aria-label="위로" onClick={() => props.onMove(-1)}><ChevronUp className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-6" disabled={props.isLast}
            aria-label="아래로" onClick={() => props.onMove(1)}><ChevronDown className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-6 text-destructive"
            aria-label="컬럼 삭제" onClick={props.onRemove}><Trash2 className="size-3" /></Button>
        </span>
      </div>
    </li>
  )
}
