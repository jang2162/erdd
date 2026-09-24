import { useRef, type ReactNode } from 'react'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'

/**
 * 재동기화·승격 화면의 한 구역 — 제목, 구역 일괄 버튼, 검색창, 50건 페이지.
 *
 * **선택 상태는 이 부품이 갖지 않는다.** 부모의 결정(`Decisions`)·선택(`selected`)이 구역 전체를 들고 있어
 * 쪽을 넘기거나 검색해도 체크가 남는다. 일괄 버튼(`actions`)도 보이는 쪽이 아니라 **구역 전체**에 적용된다 —
 * 그래서 검색 중이거나 쪽이 여럿이면 버튼 옆에 「구역 전체 N건에 적용」을 적어 오해를 막는다.
 */
export function PagedSection<T>({ title, rows, fields, renderRow, actions, children }: {
  title: string
  rows: readonly T[]
  /** 검색 대상 칸(논리명·물리명). 모듈 수준 상수 함수로 넘긴다. */
  fields: (row: T) => readonly (string | null | undefined)[]
  /** 행 하나 — `key` 를 단 `<li>` 를 돌려준다. */
  renderRow: (row: T) => ReactNode
  actions?: ReactNode
  /** 제목 아래 안내 문단. */
  children?: ReactNode
}) {
  const list = useListPage(rows, fields)
  const sectionRef = useRef<HTMLElement>(null)
  const { view } = list
  const searching = list.query.trim() !== ''
  return (
    <section ref={sectionRef} aria-label={title} className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title} ({formatCount(rows.length)})</h4>
        {actions !== undefined && rows.length > 0 && (
          <span className="flex items-center gap-1">
            {(searching || view.pageCount > 1) && (
              <span className="text-xs text-muted-foreground">구역 전체 {formatCount(rows.length)}건에 적용</span>
            )}
            {actions}
          </span>
        )}
      </div>
      {children}
      {rows.length > 0 && (
        <Input aria-label={`${title} 검색`} placeholder="논리명·물리명 검색" className="h-8"
          value={list.query} onChange={(e) => list.setQuery(e.target.value)} />
      )}
      {searching && view.total === 0 && (
        <p className="text-xs text-muted-foreground">검색 결과가 없습니다</p>
      )}
      <ul className="grid gap-1">{view.rows.map(renderRow)}</ul>
      <Pagination label={title} page={view.page} pageCount={view.pageCount} total={view.total}
        onPageChange={list.setPage} listRef={sectionRef} />
    </section>
  )
}
