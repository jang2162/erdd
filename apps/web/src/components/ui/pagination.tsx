import { Button } from '@/components/ui/button'
import { formatCount } from '@/lib/format'

/** 「이전 · 3 / 263 · 다음」과 전체 건수. 한 쪽뿐이면 아무것도 그리지 않는다. */
export function Pagination({ page, pageCount, total, onPageChange, label = '목록' }: {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  /** 한 화면에 여러 개가 있을 때 탐색 영역 이름을 가른다(`${label} 페이지`). */
  label?: string
}) {
  if (pageCount <= 1) return null
  return (
    <nav aria-label={`${label} 페이지`} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>전체 {formatCount(total)}건</span>
      <span className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}>이전</Button>
        <span>{formatCount(page)} / {formatCount(pageCount)}</span>
        <Button type="button" size="sm" variant="outline" disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}>다음</Button>
      </span>
    </nav>
  )
}
