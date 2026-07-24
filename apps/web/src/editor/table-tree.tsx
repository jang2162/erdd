import { useState } from 'react'
import { useEditorStore } from './store.js'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function TableTree() {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const focus = useEditorStore((s) => s.focus)
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const tables = Object.values(model.tables)
    .filter((t) =>
      query === '' ||
      t.physicalName.toLowerCase().includes(query) ||
      t.logicalName.toLowerCase().includes(query),
    )
    .sort((a, b) => a.physicalName.localeCompare(b.physicalName))

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="border-b p-2">
        <Input placeholder="테이블 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {tables.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => focus(t.id)}
              className={cn(
                'flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent',
                t.id === selectedTableId && 'bg-accent',
              )}
            >
              <span className="font-mono text-xs font-medium">{t.physicalName}</span>
              <span className="text-xs text-muted-foreground">{t.logicalName}</span>
            </button>
          </li>
        ))}
        {tables.length === 0 && (
          <li className="p-3 text-center text-xs text-muted-foreground">
            {Object.keys(model.tables).length === 0 ? '테이블을 추가해 설계를 시작하세요.' : '검색 결과가 없습니다.'}
          </li>
        )}
      </ul>
    </aside>
  )
}
