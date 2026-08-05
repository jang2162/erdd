import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { planPromote, type LibraryItem, type PromotePlan } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { overLimitMessage } from './resource-decisions.js'
import { initialSelection, promoteSummary, setAllForStatus } from '@/lib/promote-selection'
import type { LibraryRow } from './resource-panel.js'
import { PromoteEntryList } from '@/components/promote-entry-list'
import { Button } from '@/components/ui/button'

const EMPTY_PLAN: PromotePlan = { libraryId: '', entries: [], syncedCount: 0, linkedItemIds: {} }

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
  useEffect(() => { setSelected(initialSelection(plan.entries)) }, [plan])

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
      <PromoteEntryList
        entries={plan.entries}
        selected={selected}
        syncedCount={plan.syncedCount}
        onToggle={(entityId, on) => setSelected((prev) => {
          const next = new Set(prev)
          if (on) next.add(entityId)
          else next.delete(entityId)
          return next
        })}
        onSetAll={(status, on) => setSelected((prev) => setAllForStatus(prev, plan.entries, status, on))}
      />

      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <span className="text-xs text-muted-foreground">올릴 항목 {selected.size}건</span>
        <Button type="button" disabled={selected.size === 0 || promote.isPending} onClick={onPromote}>
          승격
        </Button>
      </div>
    </>
  )
}
