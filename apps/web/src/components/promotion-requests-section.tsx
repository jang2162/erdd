import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PromoteEntry, PromoteStatus } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { initialSelection, setAllForStatus } from '@/lib/promote-selection'
import { PromoteEntryList } from '@/components/promote-entry-list'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * 요청 검토 다이얼로그.
 *
 * 계획은 서버가 **지금** 계산해 내려준 것이다(조직 화면에는 프로젝트 모델 store가 없다).
 * 성공해도 resync를 부르지 않는다 — 그 프로젝트를 열고 있는 사용자에게는 승격 op가
 * 실시간 채널로 전파된다.
 */
function ReviewDialog({
  requestId, orgId, onClose,
}: { requestId: string; orgId: string; onClose: () => void }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState('')

  const detail = useQuery(trpc.promotion.get.queryOptions({ requestId }))
  const entries: PromoteEntry[] = detail.data?.entries ?? []
  const unavailable = detail.data?.unavailable ?? []

  useEffect(() => {
    // 기본 선택 규칙은 승격 탭과 같다 — name-match만 사람이 확인하도록 꺼 둔다.
    setSelected(initialSelection(entries))
  }, [detail.data])

  const resolve = useMutation(trpc.promotion.resolve.mutationOptions({
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: trpc.promotion.listForOrg.queryKey({ orgId, status: 'pending' }),
      })
      await queryClient.invalidateQueries({ queryKey: trpc.promotion.pendingCount.queryKey() })
      toast.success(result.status === 'rejected'
        ? '요청을 반려했습니다'
        : `추가 ${result.inserted}건 · 갱신 ${result.updated}건을 올렸습니다`
          + (result.skipped.length > 0
            ? ` — ${result.skipped.length}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
            : ''))
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
          <DialogTitle>
            승격 요청 검토 — {detail.data?.request.projectName ?? ''}
          </DialogTitle>
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
          {entries.length === 0 && !detail.isPending && (
            <p className="text-sm text-muted-foreground">처리할 항목이 없습니다.</p>
          )}
          <PromoteEntryList
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
            <Button type="button" disabled={resolve.isPending} onClick={submit}>
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
  const [reviewing, setReviewing] = useState<string | null>(null)
  const list = useQuery({
    ...trpc.promotion.listForOrg.queryOptions({ orgId, status: 'pending' }),
    enabled: canManage,
  })

  if (!canManage) return null

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">승격 요청</h2>
      {list.isError && <p role="alert" className="text-destructive">{list.error.message}</p>}
      {!list.isError && !list.isPending && (list.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">대기 중인 요청이 없습니다.</p>
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
                <TableHead>메모</TableHead>
                <TableHead className="text-right">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.projectName}</TableCell>
                  <TableCell>{row.libraryName}</TableCell>
                  <TableCell>{row.requesterName}</TableCell>
                  <TableCell>{row.itemCount}건</TableCell>
                  <TableCell className="text-muted-foreground">{row.note}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setReviewing(row.id)}>
                      검토
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {reviewing !== null && (
        <ReviewDialog requestId={reviewing} orgId={orgId} onClose={() => setReviewing(null)} />
      )}
    </section>
  )
}
