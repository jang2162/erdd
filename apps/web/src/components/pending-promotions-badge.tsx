import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

/**
 * 헤더의 대기 건수 배지.
 *
 * 이 도구에는 메일·푸시 인프라가 없어, 이 배지가 승인자에게 요청이 닿는 유일한 경로다
 * (설계 §1.1 — 배지가 없으면 요청이 아무도 안 보는 채 쌓인다). 전송은 tRPC 폴링이라
 * 새 인프라가 붙지 않는다.
 */
export function PendingPromotionsBadge() {
  const trpc = useTRPC()
  const pending = useQuery({
    ...trpc.promotion.pendingCount.queryOptions(),
    refetchInterval: 60_000,
  })
  const total = pending.data?.total ?? 0
  if (total === 0) return null

  const byOrg = pending.data?.byOrg ?? []
  const to = byOrg.length === 1 ? `/org/${byOrg[0]!.orgId}` : '/'

  return (
    <Link to={to} aria-label={`승격 요청 ${formatCount(total)}건 검토`}>
      <Badge variant="secondary" className="gap-1">
        <Inbox className="size-3.5" />
        승격 요청 {formatCount(total)}건
      </Badge>
    </Link>
  )
}
