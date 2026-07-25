import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { formatCreatedAt } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type RevisionSource = 'web' | 'cli' | 'system'

type RevisionItem = {
  seq: number
  summary: string
  source: RevisionSource
  ops: unknown
  createdAt: string | Date
  actorName: string
}

/** source 배지: system(복원 등 시스템 작업)은 key 색으로 구분한다. */
function SourceBadge({ source }: { source: RevisionSource }) {
  if (source === 'system') {
    return <Badge variant="outline" className="border-key/30 bg-key/15 text-key">system</Badge>
  }
  if (source === 'cli') {
    return <Badge variant="outline">cli</Badge>
  }
  return <Badge variant="secondary">web</Badge>
}

/**
 * "버전" 다이얼로그의 이력 섹션: Revision을 시간순(최신 우선)으로 나열한다.
 * `nextCursor`가 있으면 "더 보기" 버튼으로 다음 페이지를 이어붙인다(op 상세는 범위 밖 — 요약만).
 */
export function HistoryView({ projectId }: { projectId: string }) {
  const trpc = useTRPC()
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const [items, setItems] = useState<RevisionItem[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)

  const list = useQuery(trpc.revision.list.queryOptions({ projectId, cursor }))

  useEffect(() => {
    if (!list.data) return
    setItems((prev) => (cursor === undefined ? list.data.items : [...prev, ...list.data.items]))
    setNextCursor(list.data.nextCursor)
  }, [list.data, cursor])

  const onMore = () => {
    if (nextCursor !== null) setCursor(nextCursor)
  }

  return (
    <div className="grid max-h-96 gap-2 overflow-y-auto">
      {list.isError && <p role="alert" className="text-sm text-destructive">{list.error.message}</p>}
      {list.isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      )}
      {!list.isLoading && items.length === 0 && !list.isError && (
        <p className="text-sm text-muted-foreground">아직 이력이 없습니다</p>
      )}
      {items.map((item) => (
        <div key={item.seq} className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">#{item.seq} {item.summary}</span>
            <SourceBadge source={item.source} />
          </div>
          <span className="text-xs text-muted-foreground">
            {item.actorName} · {formatCreatedAt(item.createdAt)}
          </span>
        </div>
      ))}
      {nextCursor !== null && (
        <Button
          type="button" size="sm" variant="outline" className="justify-self-center"
          disabled={list.isFetching} onClick={onMore}
        >
          더 보기
        </Button>
      )}
    </div>
  )
}
