import { AlertTriangle, KeyRound } from 'lucide-react'
import { Handle, Position } from '@xyflow/react'
import type { Column, Table, Warning } from '@erdd/core'
import { cn } from '@/lib/utils'
import type { ViewMode } from './store.js'
import { WarningBadge } from './warning-badge.js'
import type { PeerMark } from './peer-marks.js'
import type { Anchor } from './anchors.js'

export type TableNodeData = {
  table: Table
  columns: Column[]
  viewMode: ViewMode
  selected: boolean
  tableWarnings?: Warning[]
  columnWarnings?: Record<string, Warning[]>
  peers?: PeerMark[]
  selectedColumnIds?: readonly string[]
  onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  /** 이 테이블에서 관계선이 붙는 지점들. 단일은 컬럼 행에, 복합은 합성 행에 렌더된다. */
  anchors?: Anchor[]
}

function name(logical: string, physical: string, mode: ViewMode) {
  if (mode === 'logical') return logical
  if (mode === 'physical') return physical
  return null // mixed는 둘 다 표시
}

export function TableNode({
  data,
  isConnectable,
}: {
  data: TableNodeData
  /**
   * React Flow가 store의 `nodesConnectable`(및 노드별 `connectable` 오버라이드)로부터 계산해
   * 커스텀 노드에 주입하는 값. 캔버스를 통해 렌더될 때는 항상 전달되지만, 이 컴포넌트를 직접
   * 렌더하는 테스트 등에서는 생략될 수 있어 optional로 둔다 — 생략 시 `<Handle>` 자체의
   * 기본값(true, 연결 가능)을 그대로 따른다.
   */
  isConnectable?: boolean
}) {
  const { table, columns, viewMode, selected, tableWarnings = [], columnWarnings = {}, peers = [],
    selectedColumnIds = [], onColumnClick } = data
  const peerColorHex = peers[0]?.color
  const sorted = [...columns].sort((a, b) => a.order - b.order)
  const mixed = viewMode === 'mixed'

  return (
    <div
      className={cn(
        'min-w-48 overflow-hidden rounded-lg border bg-card shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
      // 로컬 선택(ring)과 구분되도록 peer는 바깥쪽 외곽선을 쓴다.
      style={peerColorHex ? { outline: `2px solid ${peerColorHex}`, outlineOffset: '2px' } : undefined}
    >
      <Handle id="l" type="source" position={Position.Left} isConnectable={isConnectable}
        className="!h-3 !w-3 !border !border-muted-foreground/50 !bg-background" />
      <Handle id="r" type="source" position={Position.Right} isConnectable={isConnectable}
        className="!h-3 !w-3 !border !border-muted-foreground/50 !bg-background" />
      {peers.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-0.5" style={{ background: peerColorHex }}>
          {peers.map((p) => (
            <span key={p.userId} className="text-[9px] font-semibold text-white">{p.name}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-b bg-secondary/60 px-3 py-2">
        {mixed ? (
          <div className="flex flex-1 items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-bold">{table.physicalName}</span>
            <span className="text-xs text-muted-foreground">{table.logicalName}</span>
          </div>
        ) : (
          <span className={cn('flex-1 text-sm font-bold', viewMode === 'physical' && 'font-mono')}>
            {name(table.logicalName, table.physicalName, viewMode)}
          </span>
        )}
        <WarningBadge warnings={tableWarnings} className="shrink-0" />
      </div>
      <ul className="divide-y">
        {sorted.map((c) => {
          const cWarnings = columnWarnings[c.id] ?? []
          return (
            <li
              key={c.id}
              role="button"
              tabIndex={0}
              aria-selected={selectedColumnIds.includes(c.id)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs',
                selectedColumnIds.includes(c.id) && 'bg-primary/10',
                onColumnClick && 'cursor-pointer',
              )}
              onClick={(e) => {
                if (!onColumnClick) return
                e.stopPropagation() // React Flow의 onNodeClick이 테이블 선택으로 덮어쓰는 것을 막는다
                const mode = e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'
                onColumnClick(c.id, mode)
              }}
            >
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
              {cWarnings.length > 0 && (
                <span
                  className="shrink-0"
                  title={cWarnings.map((w) => w.message).join('\n')}
                  aria-label={`컬럼 경고 ${cWarnings.length}건: ${cWarnings.map((w) => w.message).join('\n')}`}
                >
                  <AlertTriangle className="size-3 text-key" />
                </span>
              )}
            </li>
          )
        })}
        {sorted.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">컬럼 없음</li>
        )}
      </ul>
    </div>
  )
}
