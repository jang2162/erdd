import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  planPromote, RESOURCE_KIND_LABEL,
  type LibraryItem, type PromoteEntry, type PromotePlan, type PromoteStatus,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { overLimitMessage } from './resource-decisions.js'
import {
  danglingDomain, initialSelection, promoteSummary, setAllForStatus,
} from './promote-selection.js'
import type { LibraryRow } from './resource-panel.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EMPTY_PLAN: PromotePlan = { libraryId: '', entries: [], syncedCount: 0, linkedItemIds: {} }

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
      </span>
      {entry.targetVersion !== null && (
        <span className="text-xs text-muted-foreground">
          v{entry.targetVersion} → v{entry.targetVersion + 1}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/**
 * "조직으로 승격" 탭 — 프로젝트 사전을 라이브러리로 올린다.
 *
 * 서버가 모델을 바꾸므로 낙관적 반영을 하지 않는다. 성공하면 model.get으로 되맞추되
 * setLoaded가 아니라 resync를 쓴다 — 승격은 사전만 건드리므로 그룹 뷰에서 튕기면 안 된다.
 */
export function ResourcePromoteTab({
  projectId, library,
}: { projectId: string; library: LibraryRow }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const model = useEditorStore((s) => s.model)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const items = useQuery(trpc.resource.items.list.queryOptions({ libraryId: library.id }))
  const plan = useMemo(
    () => (items.data ? planPromote(model, library.id, items.data as LibraryItem[]) : EMPTY_PLAN),
    [model, library.id, items.data],
  )
  useEffect(() => { setSelected(initialSelection(plan)) }, [plan])

  const promote = useMutation(trpc.resource.promote.mutationOptions({
    onSuccess: async (result) => {
      const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
      if (useEditorStore.getState().loadedProjectId === projectId) {
        useEditorStore.getState().resync(fresh.model, fresh.seq)
      }
      await queryClient.invalidateQueries({
        queryKey: trpc.resource.items.list.queryKey({ libraryId: library.id }),
      })
      await queryClient.invalidateQueries({
        queryKey: trpc.resource.library.listForProject.queryKey({ projectId }),
      })
      toast.success(promoteSummary(result))
    },
    onError: (err) => toast.error(err.message),
  }))

  const onPromote = () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0) return
    const message = overLimitMessage(entries.length)
    if (message !== null) { toast.error(message); return }
    promote.mutate({
      projectId,
      libraryId: library.id,
      entries: entries.map((entry) => ({
        entityId: entry.entityId,
        expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId,
        expectedTargetVersion: entry.targetVersion,
      })),
    })
  }

  if (items.isError) return <p role="alert" className="text-destructive">{items.error.message}</p>

  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = plan.entries.filter((entry) => entry.status === status)
        return (
          <section key={status} className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{title} ({rows.length})</h4>
              {rows.length > 0 && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost"
                    onClick={() => setSelected((prev) => setAllForStatus(prev, plan, status, true))}>
                    모두 선택
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => setSelected((prev) => setAllForStatus(prev, plan, status, false))}>
                    모두 해제
                  </Button>
                </span>
              )}
            </div>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
            <ul className="grid gap-1">
              {rows.map((entry) => (
                <li key={entry.entityId}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" aria-label={`${entry.name} 선택`}
                      checked={selected.has(entry.entityId)}
                      onChange={(e) => {
                        const on = e.target.checked
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (on) next.add(entry.entityId)
                          else next.delete(entry.entityId)
                          return next
                        })
                      }} />
                    <EntryLabel entry={entry} />
                  </label>
                  {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
                    <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <section className="grid gap-1 text-xs text-muted-foreground">
        <h4 className="text-sm font-semibold text-foreground">유지</h4>
        <span>이미 이 라이브러리와 같은 항목 {plan.syncedCount}건</span>
      </section>

      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <span className="text-xs text-muted-foreground">올릴 항목 {selected.size}건</span>
        <Button type="button" disabled={selected.size === 0 || promote.isPending} onClick={onPromote}>
          승격
        </Button>
      </div>
    </>
  )
}
