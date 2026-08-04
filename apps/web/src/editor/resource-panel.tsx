import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Library } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { ResourceResyncTab } from './resource-resync-tab.js'
import { ResourcePromoteTab } from './resource-promote-tab.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

export type LibraryRow = {
  id: string
  scope: 'global' | 'org'
  orgId: string | null
  name: string
  description: string
  itemCount: number
  canWrite: boolean
}

type Tab = 'resync' | 'promote'

/**
 * 헤더의 "공용 리소스". 두 방향을 탭으로 나눈다.
 * - 가져오기: 라이브러리 → 프로젝트(최초 가져오기 = 전 항목이 신규인 재동기화)
 * - 조직으로 승격: 프로젝트 → 라이브러리(쓰기 권한이 있는 라이브러리에만)
 */
export function ResourcePanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC()
  const canEdit = useEditorStore((s) => s.canEdit)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('resync')
  const [libraryId, setLibraryId] = useState<string | null>(null)

  const libraries = useQuery(trpc.resource.library.listForProject.queryOptions({ projectId }))
  const rows = (libraries.data ?? []) as LibraryRow[]
  const visible = tab === 'promote' ? rows.filter((row) => row.canWrite) : rows
  const library = visible.find((row) => row.id === libraryId) ?? null
  const canPromote = canEdit && rows.some((row) => row.canWrite)

  // 탭을 옮길 때 그 탭에서 못 쓰는 라이브러리 선택은 버린다.
  const switchTab = (next: Tab) => {
    setTab(next)
    if (next === 'promote' && libraryId !== null
      && !rows.some((row) => row.id === libraryId && row.canWrite)) {
      setLibraryId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Library /> 공용 리소스</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>공용 리소스</DialogTitle></DialogHeader>
        {canPromote && (
          <div role="tablist" aria-label="공용 리소스 방향" className="flex gap-1 border-b pb-2">
            {([['resync', '가져오기'], ['promote', '조직으로 승격']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value}
                className={`rounded px-2 py-1 text-sm ${tab === value ? 'bg-muted font-semibold' : ''}`}
                onClick={() => switchTab(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="grid content-start gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">라이브러리</h4>
            {libraries.isError && (
              <p role="alert" className="text-destructive">{libraries.error.message}</p>
            )}
            {!libraries.isError && !libraries.isPending && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">사용할 수 있는 라이브러리가 없습니다</p>
            )}
            {visible.map((lib) => (
              <button key={lib.id} type="button"
                className={`rounded border px-2 py-1.5 text-left text-sm ${libraryId === lib.id ? 'border-primary' : ''}`}
                onClick={() => setLibraryId(lib.id)}>
                <span className="block">{lib.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {lib.scope === 'global' ? '전역' : '조직'} · 항목 {lib.itemCount}개
                </span>
              </button>
            ))}
          </div>

          <div className="grid max-h-[60vh] content-start gap-4 overflow-y-auto">
            {library === null && (
              <p className="text-sm text-muted-foreground">
                {tab === 'resync'
                  ? '라이브러리를 선택하면 가져올 항목과 갱신 내역을 보여줍니다.'
                  : '올릴 라이브러리를 선택하면 승격할 항목을 보여줍니다.'}
              </p>
            )}
            {library !== null && tab === 'resync' && (
              <ResourceResyncTab projectId={projectId} library={library} />
            )}
            {library !== null && tab === 'promote' && (
              <ResourcePromoteTab projectId={projectId} library={library} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
