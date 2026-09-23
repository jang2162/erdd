import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PromoteEntry, PromoteStatus } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { initialSelection, promoteSummary, setAllForStatus } from '@/lib/promote-selection'
import { PromoteEntryList } from '@/components/promote-entry-list'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type RequestStatus = 'pending' | 'resolved' | 'rejected' | 'cancelled'

/**
 * 상태 필터. cancelled까지 넣는 것은 의도다 — 요청자가 스스로 닫은 것이라 승인자가 할 일은
 * 없지만, 대기 목록에서 사라진 요청의 행방을 확인할 유일한 자리다.
 */
const STATUS_OPTIONS: { value: RequestStatus; label: string; empty: string }[] = [
  { value: 'pending', label: '대기 중', empty: '대기 중인 요청이 없습니다.' },
  { value: 'resolved', label: '승인됨', empty: '승인된 요청이 없습니다.' },
  { value: 'rejected', label: '반려됨', empty: '반려된 요청이 없습니다.' },
  { value: 'cancelled', label: '취소됨', empty: '취소된 요청이 없습니다.' },
]

/**
 * 항목 칸 문구. 승인만 "실제로 올라간 수"를 셀 값이 있다 — 반려는 approvedEntityIds가 빈
 * 배열이고 취소는 null이라, 둘 다 `0/N건 승격`으로 쓰면 "0건 승격됨"으로 잘못 읽힌다.
 */
function itemCountLabel(
  status: RequestStatus, row: { itemCount: number; approvedEntityIds: string[] | null },
): string {
  if (status !== 'resolved') return `${row.itemCount}건`
  return `${(row.approvedEntityIds ?? []).length}/${row.itemCount}건 승격`
}

/**
 * 요청 검토 다이얼로그.
 *
 * 계획은 서버가 **지금** 계산해 내려준 것이다(조직 화면에는 프로젝트 모델 store가 없다).
 * 성공해도 resync를 부르지 않는다 — 그 프로젝트를 열고 있는 사용자에게는 승격 op가
 * 실시간 채널로 전파된다.
 */
function ReviewDialog({
  requestId, projectName, orgId, onClose,
}: { requestId: string; projectName: string; orgId: string; onClose: () => void }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState('')

  const detail = useQuery(trpc.promotion.get.queryOptions({ requestId }))
  const entries: PromoteEntry[] = detail.data?.entries ?? []
  const unavailable = detail.data?.unavailable ?? []

  useEffect(() => {
    // 기본 선택 규칙은 승격 탭과 같다 — name-match만 사람이 확인하도록 꺼 둔다.
    // 의존성이 entries가 아니라 detail.data인 것은 의도다. entries는 `?? []`라 매 렌더 새
    // 배열이고, [entries]로 두면 setSelected가 다시 렌더를 부르는 무한 루프가 된다.
    setSelected(initialSelection(entries))
  }, [detail.data])

  const resolve = useMutation(trpc.promotion.resolve.mutationOptions({
    onSuccess: async (result) => {
      // status를 빼고 지운다 — 처리 후에는 대기 목록과 처리됨 목록이 **둘 다** 낡는다.
      await queryClient.invalidateQueries({
        queryKey: trpc.promotion.listForOrg.queryKey(),
      })
      await queryClient.invalidateQueries({ queryKey: trpc.promotion.pendingCount.queryKey() })
      // 승격은 같은 화면의 라이브러리 관리 목록도 낡게 만든다 — QueryClient가
      // refetchOnWindowFocus:false라 자동 회복 트리거가 없어 여기서 직접 지운다.
      // 항목 수는 library.list가 들고 있으므로 items.list만으로는 부족하다(삭제 확인창이
      // "항목 0개도 함께 삭제됩니다"라고 거짓을 말하게 된다).
      const resolvedLibraryId = detail.data?.request.libraryId
      if (resolvedLibraryId !== undefined) {
        await queryClient.invalidateQueries({
          queryKey: trpc.resource.items.list.queryKey({ libraryId: resolvedLibraryId }),
        })
      }
      await queryClient.invalidateQueries({
        queryKey: trpc.resource.library.list.queryKey({ scope: 'org', orgId }),
      })
      toast.success(result.status === 'rejected' ? '요청을 반려했습니다' : promoteSummary(result))
      onClose()
    },
    onError: (err) => toast.error(err.message),
  }))

  const submit = () => resolve.mutate({
    requestId,
    approve: entries
      .filter((entry) => selected.has(entry.entityId))
      .map((entry) => ({
        entityId: entry.entityId,
        expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId,
        expectedTargetVersion: entry.targetVersion,
      })),
    note,
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          {/* 프로젝트명은 목록 행이 이미 갖고 있다 — 계획 조회 전에도 어느 요청인지 보인다. */}
          <DialogTitle>승격 요청 검토 — {projectName}</DialogTitle>
        </DialogHeader>
        {detail.isError && (
          <p role="alert" className="text-destructive">{detail.error.message}</p>
        )}
        <div className="grid max-h-[60vh] content-start gap-4 overflow-y-auto">
          {(detail.data?.request.note ?? '') !== '' && (
            <p className="text-sm text-muted-foreground">
              요청 메모: {detail.data!.request.note}
            </p>
          )}
          {unavailable.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {unavailable.length}건은 이미 반영됐거나 삭제되어 처리할 수 없습니다.
            </p>
          )}
          {detail.isPending && (
            <p className="text-sm text-muted-foreground">계획을 계산하는 중입니다…</p>
          )}
          {/* 목록의 빈 상태와 같은 규율 — 로딩·오류 중에는 "없다"고 말하지 않는다. */}
          {entries.length === 0 && !detail.isPending && !detail.isError && (
            <p className="text-sm text-muted-foreground">처리할 항목이 없습니다.</p>
          )}
          <PromoteEntryList
            audience="approve"
            entries={entries}
            selected={selected}
            onToggle={(entityId, on) => setSelected((prev) => {
              const next = new Set(prev)
              if (on) next.add(entityId)
              else next.delete(entityId)
              return next
            })}
            onSetAll={(status: PromoteStatus, on) => setSelected((prev) =>
              setAllForStatus(prev, entries, status, on))}
          />
        </div>
        <div className="grid gap-2 border-t pt-2">
          <Input placeholder="처리 메모 (선택)" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end">
            {/*
              계획을 아직 못 봤거나 조회가 실패한 상태에서는 누를 수 없다. 그때는 selected가
              비어 라벨이 "반려"인데, 그대로 누르면 빈 approve가 나가 서버가 요청을 rejected로
              닫아 버린다 — 승인자가 내용을 한 번도 보지 못한 채 되돌릴 수 없게 닫는 셈이다.
            */}
            <Button type="button"
              disabled={resolve.isPending || detail.isPending || detail.isError}
              onClick={submit}>
              {selected.size === 0 ? '반려' : `${selected.size}건 승격`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 조직 화면의 승격 요청 승인 목록. Org Owner/Admin에게만 보인다. */
export function PromotionRequestsSection({
  orgId, canManage,
}: { orgId: string; canManage: boolean }) {
  const trpc = useTRPC()
  // 프로젝트명까지 들고 간다 — 검토 다이얼로그가 계획 조회를 기다리는 동안에도 제목이 비지 않는다.
  const [reviewing, setReviewing] = useState<{ id: string; projectName: string } | null>(null)
  // 기본은 대기 목록이고 상태를 골라 이력을 본다(설계 §6.3). 이 화면이 아니면 승인자가 남긴
  // 처리 메모(resolutionNote)를 읽을 자리가 없다 — 저장만 되고 아무도 못 보는 값이 된다.
  // 반려에도 같은 칸에 사유가 저장되므로 'resolved'만 열면 정작 사유가 필요한 쪽이 가려진다.
  const [status, setStatus] = useState<RequestStatus>('pending')
  const isPendingView = status === 'pending'
  const list = useQuery({
    ...trpc.promotion.listForOrg.queryOptions({ orgId, status }),
    enabled: canManage,
  })

  if (!canManage) return null

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">승격 요청</h2>
        <div className="flex gap-1" role="group" aria-label="상태 필터">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <Button key={value} size="sm" aria-pressed={status === value}
              variant={status === value ? 'secondary' : 'ghost'}
              onClick={() => setStatus(value)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      {list.isError && <p role="alert" className="text-destructive">{list.error.message}</p>}
      {!list.isError && !list.isPending && (list.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          {STATUS_OPTIONS.find((o) => o.value === status)!.empty}
        </p>
      )}
      {(list.data ?? []).length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>프로젝트</TableHead>
                <TableHead>라이브러리</TableHead>
                <TableHead>요청자</TableHead>
                <TableHead>항목</TableHead>
                <TableHead>{isPendingView ? '메모' : '처리 메모'}</TableHead>
                <TableHead className="text-right">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.projectName}</TableCell>
                  <TableCell>{row.libraryName}</TableCell>
                  <TableCell>{row.requesterName}</TableCell>
                  <TableCell>{itemCountLabel(status, row)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {isPendingView ? row.note : row.resolutionNote}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* 검토는 아직 열려 있는 요청에만 — 처리된 행은 읽기 전용 이력이다. */}
                    {isPendingView && (
                      <Button variant="outline" size="sm"
                        onClick={() => setReviewing({ id: row.id, projectName: row.projectName })}>
                        검토
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {reviewing !== null && (
        <ReviewDialog
          requestId={reviewing.id} projectName={reviewing.projectName}
          orgId={orgId} onClose={() => setReviewing(null)}
        />
      )}
    </section>
  )
}
