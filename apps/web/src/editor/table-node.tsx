import { KeyRound } from 'lucide-react'
import type { Column, Table } from '@erdd/core'
import { cn } from '@/lib/utils'
import type { ViewMode } from './store.js'

export type TableNodeData = {
  table: Table
  columns: Column[]
  viewMode: ViewMode
  selected: boolean
}

function name(logical: string, physical: string, mode: ViewMode) {
  if (mode === 'logical') return logical
  if (mode === 'physical') return physical
  return null // mixed는 둘 다 표시
}

export function TableNode({ data }: { data: TableNodeData }) {
  const { table, columns, viewMode, selected } = data
  const sorted = [...columns].sort((a, b) => a.order - b.order)
  const mixed = viewMode === 'mixed'

  return (
    <div
      className={cn(
        'min-w-48 overflow-hidden rounded-lg border bg-card shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="border-b bg-secondary/60 px-3 py-2">
        {mixed ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-bold">{table.physicalName}</span>
            <span className="text-xs text-muted-foreground">{table.logicalName}</span>
          </div>
        ) : (
          <span className={cn('text-sm font-bold', viewMode === 'physical' && 'font-mono')}>
            {name(table.logicalName, table.physicalName, viewMode)}
          </span>
        )}
      </div>
      <ul className="divide-y">
        {sorted.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="flex w-4 shrink-0 justify-center">
              {c.isPk && <KeyRound className="size-3 text-key" aria-label="기본 키" />}
            </span>
            {mixed ? (
              <span className="flex-1 truncate">
                <span className="font-mono">{c.physicalName}</span>{' '}
                <span className="text-muted-foreground">{c.logicalName}</span>
              </span>
            ) : (
              <span className={cn('flex-1 truncate', viewMode === 'physical' && 'font-mono')}>
                {name(c.logicalName, c.physicalName, viewMode)}
              </span>
            )}
            <span className="shrink-0 font-mono text-muted-foreground">{c.type}</span>
            {!c.nullable && <span className="shrink-0 text-[10px] text-muted-foreground">NN</span>}
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">컬럼 없음</li>
        )}
      </ul>
    </div>
  )
}
