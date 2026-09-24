import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { formatCount } from '@/lib/format'

/** 「이전 · 3 / 263 · 다음」과 전체 건수. 한 쪽뿐이면 아무것도 그리지 않는다. */
export function Pagination({ page, pageCount, total, onPageChange, label = '목록', listRef }: {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  /** 한 화면에 여러 개가 있을 때 탐색 영역 이름을 가른다(`${label} 페이지`). */
  label?: string
  /**
   * 쪽을 넘길 때 처음을 보일 목록 — 스스로 스크롤하는 목록 상자이거나, 바깥 스크롤 영역 안에 놓인 목록 구역이다.
   * 주지 않으면 스크롤을 건드리지 않는다.
   */
  listRef?: RefObject<HTMLElement | null>
}) {
  if (pageCount <= 1) return null
  const go = (next: number) => {
    onPageChange(next)
    if (listRef?.current) showListStart(listRef.current)
  }
  return (
    <nav aria-label={`${label} 페이지`} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>전체 {formatCount(total)}건</span>
      <span className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={page <= 1}
          onClick={() => go(page - 1)}>이전</Button>
        <span>{formatCount(page)} / {formatCount(pageCount)}</span>
        <Button type="button" size="sm" variant="outline" disabled={page >= pageCount}
          onClick={() => go(page + 1)}>다음</Button>
      </span>
    </nav>
  )
}

/**
 * 쪽을 넘긴 뒤 목록의 처음을 보인다. 쪽이 바뀌어도 목록 요소는 그대로고 자식만 바뀌어 스크롤 위치가 남는다 —
 * 두지 않으면 끝까지 내려 「다음」을 누른 사람은 다음 쪽의 끝부분부터 보게 된다.
 * 목록이 스스로 스크롤하면 맨 위로 올리고, 바깥 스크롤 영역 안에 놓였으면 머리가 위로 벗어나 있을 때만 머리를
 * 영역 위에 맞춘다(이미 보이는 목록을 끌어올리지 않는다).
 */
function showListStart(list: HTMLElement) {
  list.scrollTop = 0
  for (let parent = list.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    if (list.getBoundingClientRect().top < parent.getBoundingClientRect().top) list.scrollIntoView({ block: 'start' })
    return
  }
}
