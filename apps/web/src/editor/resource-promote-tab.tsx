import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MAX_LIBRARY_FILE_ITEMS, planPromote, type LibraryItem, type PromotePlan } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { carrySelection, initialSelection, promoteSummary, setAllForStatus } from '@/lib/promote-selection'
import { formatCount, formatProgress } from '@/lib/format'
import { promoteFailureMessage, promoteInChunks, toPromoteRequest } from '@/lib/promote-chunks'
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
 * 선택이 5,000건을 넘으면 `promoteInChunks` 로 나눠 부른다.
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
  // 계획이 다시 계산되면(모델 변경·항목 재조회) 사용자가 정한 선택은 잇고 새 항목만 기본값을 받는다.
  // 라이브러리가 바뀌면 처음부터다 — 같은 엔티티라도 다른 라이브러리로 올리는 것은 다른 결정이다.
  const prevPlanRef = useRef<PromotePlan | null>(null)
  useEffect(() => {
    const prevPlan = prevPlanRef.current
    prevPlanRef.current = plan
    setSelected((prev) => (prevPlan !== null && prevPlan.libraryId === plan.libraryId
      ? carrySelection(prevPlan.entries, prev, plan.entries)
      : initialSelection(plan.entries)))
  }, [plan])

  // 조각마다 부르므로 onSuccess/onError 를 쓰지 않고 promoteInChunks 가 결과를 모은다.
  const promote = useMutation(trpc.resource.promote.mutationOptions())
  const [promoting, setPromoting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  /** 서버가 모델(origin)과 라이브러리를 바꿨다 — 서버 상태로 되맞추고 계획의 입력을 다시 받는다. */
  const refreshAfterPromote = async () => {
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
  }

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
        ? `${formatCount(result.requested)}건을 승격 요청했습니다`
        : `${formatCount(result.requested)}건을 요청했습니다 — ${formatCount(result.dropped.length)}건은 이미 반영됐거나 삭제되어 빠졌습니다`)
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
    // 요청은 나눠 부르지 않는다 — 서버 `promotion.create` 의 입력 상한을 넘기면 zod 원문 대신 여기서 막는다.
    if (entries.length > MAX_LIBRARY_FILE_ITEMS) {
      toast.error(`한 번에 요청할 수 있는 항목은 ${formatCount(MAX_LIBRARY_FILE_ITEMS)}건까지입니다. 나눠 선택해 주세요.`)
      return
    }
    request.mutate({
      projectId, libraryId: library.id,
      entityIds: entries.map((entry) => entry.entityId),
      note,
    })
  }

  /**
   * 선택을 5,000건씩 잘라 차례로 승격한다(서버 `resource.promote` 의 입력 상한은 그대로다). 결과는 합쳐 토스트
   * 하나로 보인다. 중간 실패면 앞 조각은 이미 올라갔으므로 몇 건인지 알리고 계획을 다시 불러온다. 첫 조각
   * 실패는 지금처럼 오류만 알린다(서버에 바뀐 것이 없다).
   */
  const onPromote = async () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0 || promoting) return
    setPromoting(true)
    try {
      const run = await promoteInChunks(
        entries.map(toPromoteRequest),
        (chunk) => promote.mutateAsync({ projectId, libraryId: library.id, entries: chunk }),
        (done, total) => setProgress({ done, total }),
      )
      if (run.done > 0) {
        try {
          await refreshAfterPromote()
        } catch {
          toast.error('서버 상태를 불러오지 못했습니다. 새로고침해 주세요.')
        }
      }
      if (run.error === null) toast.success(promoteSummary(run.outcome, run.total))
      else toast.error(promoteFailureMessage(entries.length, run))
    } finally {
      setPromoting(false)
      setProgress(null)
    }
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
                    {row.requesterName} · {formatCount(row.entityIds.length)}건
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

      {/* 구역의 검색어·쪽은 라이브러리마다 처음부터다 — key 로 라이브러리를 바꿀 때 목록 상태를 버린다. */}
      <PromoteEntryList
        key={library.id}
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
          <span className="text-xs text-muted-foreground">올릴 항목 {formatCount(selected.size)}건</span>
          {library.canWrite ? (
            <Button type="button" disabled={selected.size === 0 || promoting} onClick={() => { void onPromote() }}>
              {progress !== null ? formatProgress(progress.done, progress.total) : '승격'}
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
