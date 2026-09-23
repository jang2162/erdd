import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { createIndex, updateIndex, removeIndex, type IndexDef } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type IndexColumns = IndexDef['columns']

function nextIndexName(usedNames: Set<string>): string {
  let n = 1
  while (usedNames.has(`IX_${n}`)) n++
  return `IX_${n}`
}

export function IndexSection({ projectId, tableId }: { projectId: string; tableId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const indexes = Object.values(model.indexes).filter((ix) => ix.tableId === tableId)
  const tableColumns = Object.values(model.columns)
    .filter((c) => c.tableId === tableId).sort((a, b) => a.order - b.order)

  const onAdd = () => {
    const id = newId()
    void mutate((m) => createIndex(m, {
      id, tableId,
      name: nextIndexName(new Set(Object.values(m.indexes).map((ix) => ix.name))),
    }), { summary: '인덱스 추가' })
  }

  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold">인덱스</h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onAdd}><Plus /> 인덱스 추가</Button>
        )}
      </div>
      <ul className="mt-2 grid gap-3">
        {indexes.map((ix) => (
          <IndexRow
            key={ix.id} index={ix} canEdit={canEdit}
            columnName={(id) => model.columns[id]?.physicalName ?? '?'}
            availableColumns={tableColumns.filter((c) => !ix.columns.some((ic) => ic.columnId === c.id))}
            onPatch={(patch) => void mutate((m) => updateIndex(m, ix.id, patch), { summary: '인덱스 수정' })}
            onRemove={() => void mutate((m) => removeIndex(m, ix.id), { summary: '인덱스 삭제' })}
          />
        ))}
        {indexes.length === 0 && <li className="text-xs text-muted-foreground">인덱스가 없습니다.</li>}
      </ul>
    </>
  )
}

function IndexRow(props: {
  index: IndexDef
  canEdit: boolean
  columnName: (columnId: string) => string
  availableColumns: { id: string; physicalName: string }[]
  onPatch: (patch: Partial<Pick<IndexDef, 'name' | 'unique' | 'columns'>>) => void
  onRemove: () => void
}) {
  const { index: ix, canEdit } = props
  const cols = ix.columns

  const setColumns = (next: IndexColumns) => props.onPatch({ columns: next })
  const toggleDir = (i: number) =>
    setColumns(cols.map((c, j) => (j === i ? { ...c, direction: c.direction === 'asc' ? 'desc' : 'asc' } : c)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= cols.length) return
    const next = [...cols]; [next[i], next[j]] = [next[j]!, next[i]!]; setColumns(next)
  }
  const removeCol = (i: number) => setColumns(cols.filter((_, j) => j !== i))
  const addCol = (columnId: string) => setColumns([...cols, { columnId, direction: 'asc' }])

  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <Input id={`ix-${ix.id}-name`} aria-label="인덱스명" defaultValue={ix.name} key={ix.name} className="h-8 font-mono"
          readOnly={!canEdit}
          onBlur={(e) => { const v = e.target.value; if (v !== ix.name && v.trim() !== '') props.onPatch({ name: v }) }} />
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-7 shrink-0 text-destructive"
            aria-label="인덱스 삭제" onClick={props.onRemove}><Trash2 className="size-3" /></Button>
        )}
      </div>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={ix.unique} disabled={!canEdit}
          onChange={(e) => { const unique = e.target.checked; props.onPatch({ unique }) }} /> UNIQUE
      </label>
      <ul className="grid gap-1">
        {cols.map((c, i) => (
          <li key={c.columnId} className="flex items-center gap-1 text-xs">
            <span className="flex-1 truncate font-mono">{props.columnName(c.columnId)}</span>
            {/* 방향(ASC/DESC)은 값 표시를 겸하므로 숨기지 않고 disabled로만 잠근다. */}
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={!canEdit}
              onClick={() => toggleDir(i)}>{c.direction.toUpperCase()}</Button>
            {canEdit && (
              <>
                <Button size="icon" variant="ghost" className="size-6" disabled={i === 0}
                  aria-label="위로" onClick={() => move(i, -1)}><ChevronUp className="size-3" /></Button>
                <Button size="icon" variant="ghost" className="size-6" disabled={i === cols.length - 1}
                  aria-label="아래로" onClick={() => move(i, 1)}><ChevronDown className="size-3" /></Button>
                <Button size="icon" variant="ghost" className="size-6 text-destructive"
                  aria-label="인덱스 컬럼 제거" onClick={() => removeCol(i)}><Trash2 className="size-3" /></Button>
              </>
            )}
          </li>
        ))}
        {cols.length === 0 && <li className="text-[11px] text-muted-foreground">구성 컬럼 없음</li>}
      </ul>
      {props.availableColumns.length > 0 && (
        <select aria-label="인덱스 컬럼 추가" className="h-8 rounded border bg-background px-1 text-xs" value=""
          disabled={!canEdit}
          onChange={(e) => { const columnId = e.target.value; if (columnId) addCol(columnId) }}>
          <option value="">컬럼 추가…</option>
          {props.availableColumns.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
        </select>
      )}
    </li>
  )
}
