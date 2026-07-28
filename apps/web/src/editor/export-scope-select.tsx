import type { ExportScope } from '@erdd/core'
import { useEditorStore } from './store.js'
import { Button } from '@/components/ui/button'

/**
 * DDL·Excel 내보내기가 공유하는 범위 선택기.
 * 그룹 뷰로 전환하지 않아도 드롭다운에서 아무 그룹이나 골라 내보낼 수 있다.
 * ExportScope의 { kind: 'tables' }는 이 UI에서 만들지 않는다.
 */
export function ExportScopeSelect(
  { value, onChange }: { value: ExportScope; onChange: (s: ExportScope) => void },
) {
  const model = useEditorStore((s) => s.model)
  const groups = Object.values(model.tableGroups).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">범위</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm"
          variant={value.kind === 'all' ? 'default' : 'outline'}
          onClick={() => onChange({ kind: 'all' })}
        >
          전체
        </Button>
        {groups.length > 0 && (
          <select
            aria-label="그룹 선택"
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
            value={value.kind === 'group' ? value.groupId : ''}
            onChange={(e) => {
              const id = e.target.value
              onChange(id === '' ? { kind: 'all' } : { kind: 'group', groupId: id })
            }}
          >
            <option value="">그룹 선택…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}
