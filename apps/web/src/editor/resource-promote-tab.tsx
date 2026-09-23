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
import { Input } from '@/components/ui/input'

const EMPTY_PLAN: PromotePlan = { libraryId: '', entries: [], syncedCount: 0, linkedItemIds: {} }

/**
 * "조직으로 승격" 탭 — 프로젝트 사전을 라이브러리로 올린다. 같은 3구역 목록에서 고르고
 * 라이브러리 쓰기 권한에 따라 두 모드로 갈린다.
 *
 * **승격**(canWrite): 서버가 모델을 바꾸므로 낙관적 반영을 하지 않는다. 성공하면 model.get으로
 * 되맞추되 setLoaded가 아니라 resync를 쓴다 — 승격은 사전만 건드리므로 그룹 뷰에서 튕기면 안 된다.
 *
 * **요청**(그 외): 서버가 요청 행만 남기고 모델은 건드리지 않는다. 그래서 resync도 model.get도
 * 하지 않고 대기 목록만 무효화한다.
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

  const [note, setNote] = useState('')
  const requests = useQuery(trpc.promotion.listForProject.queryOptions({
    projectId, status: 'pending',
  }))
  const invalidateRequests = () => queryClient.invalidateQueries({
    queryKey: trpc.promotion.listForProject.queryKey({ projectId, status: 'pending' }),
  })

  const request = useMutation(trpc.promotion.create.mutationOptions({
    onSuccess: async (result) => {
      // 서버가 모델을 바꾸지 않았다 — resync도 model.get도 하지 않는다.
      await invalidateRequests()
      setNote('')
      toast.success(result.dropped.length === 0
        ? `${result.requested}건을 승격 요청했습니다`
        : `${result.requested}건을 요청했습니다 — ${result.dropped.length}건은 이미 반영됐거나 삭제되어 빠졌습니다`)
    },
    onError: (err) => toast.error(err.message),
  }))

  const cancel = useMutation(trpc.promotion.cancel.mutationOptions({
    onSuccess: async () => { await invalidateRequests(); toast.success('요청을 취소했습니다') },
    onError: (err) => toast.error(err.message),
  }))

  const onRequest = () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0) return
    const message = overLimitMessage(entries.length)
    if (message !== null) { toast.error(message); return }
    request.mutate({
      projectId, libraryId: library.id,
      entityIds: entries.map((entry) => entry.entityId),
      note,
    })
  }

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
      {(requests.data ?? []).filter((row) => row.libraryId === library.id).length > 0 && (
        <section className="grid gap-1 rounded border bg-muted/40 p-2">
          <h4 className="text-sm font-semibold">대기 중인 요청</h4>
          <ul className="grid gap-1">
            {(requests.data ?? [])
              .filter((row) => row.libraryId === library.id)
              .map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {row.requesterName} · {row.entityIds.length}건
                    {row.note !== '' && ` · ${row.note}`}
                  </span>
                  <Button size="sm" variant="ghost" disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ requestId: row.id })}>
                    요청 취소
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <PromoteEntryList
        audience="promote"
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

      <div className="grid gap-2 border-t pt-2">
        {!library.canWrite && (
          <Input placeholder="요청 메모 (선택)" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)} />
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">올릴 항목 {selected.size}건</span>
          {library.canWrite ? (
            <Button type="button" disabled={selected.size === 0 || promote.isPending} onClick={onPromote}>
              승격
            </Button>
          ) : (
            <Button type="button" disabled={selected.size === 0 || request.isPending} onClick={onRequest}>
              승격 요청
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
