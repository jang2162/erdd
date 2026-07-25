import { useMemo } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { computeWarnings, setTableGroup, type Column, type Warning } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { updateTable } from './model-edits.js'
import { addColumn, removeColumn, reorderColumn, updateColumn } from './column-edits.js'
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
  const table = selectedTableId ? model.tables[selectedTableId] : undefined
  const warnings = useMemo(() => computeWarnings(model), [model])

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
            onCommit={(v) => void mutate((m) => updateTable(m, tid, { logicalName: v }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tbl-physical">테이블 물리명</Label>
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
            warnings={warnings.filter((w) => w.scope === 'column' && w.entityId === c.id)}
            onPatch={(patch) => void mutate((m) => updateColumn(m, c.id, patch))}
            onRemove={() => void mutate((m) => removeColumn(m, c.id), { summary: '컬럼 삭제' })}
            onMove={(dir) => void mutate((m) => reorderColumn(m, c.id, dir))}
          />
        ))}
        {columns.length === 0 && <li className="text-xs text-muted-foreground">컬럼이 없습니다.</li>}
      </ul>

      <IndexSection projectId={projectId} tableId={tid} />
    </aside>
  )
}

function ColumnRow(props: {
  column: Column; isFirst: boolean; isLast: boolean; warnings: Warning[]
  onPatch: (patch: Partial<Omit<Column, 'id' | 'tableId'>>) => void
  onRemove: () => void; onMove: (dir: -1 | 1) => void
}) {
  const { column: c } = props
  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <CommitInput label="논리명" value={c.logicalName} onCommit={(v) => props.onPatch({ logicalName: v })} />
          <CommitInput label="물리명" value={c.physicalName} mono onCommit={(v) => props.onPatch({ physicalName: v })} />
        </div>
        <WarningBadge warnings={props.warnings} className="shrink-0" />
      </div>
      <CommitInput label="타입" value={c.type} mono onCommit={(v) => props.onPatch({ type: v })} />
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
