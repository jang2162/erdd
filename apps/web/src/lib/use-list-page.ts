import { useCallback, useMemo, useState } from 'react'
import { PAGE_SIZE, filterAndPage } from './paginate'

/**
 * 검색어·페이지 상태 + 그 결과 한 페이지. 검색어를 바꾸면 1쪽으로 돌아간다.
 * `fields` 는 모듈 수준 상수 함수로 넘긴다 — 매 렌더 새 함수면 메모가 매번 깨진다.
 */
export function useListPage<T>(
  rows: readonly T[],
  fields: (row: T) => readonly (string | null | undefined)[],
  size: number = PAGE_SIZE,
) {
  const [query, setQueryState] = useState('')
  const [page, setPage] = useState(1)
  const view = useMemo(() => filterAndPage(rows, query, fields, page, size), [rows, query, fields, page, size])
  // 행이 줄어 보이는 쪽이 당겨지면 저장된 쪽도 그 쪽으로 맞춘다 — 두지 않으면 행이 다시 늘 때 화면이
  // 사용자가 떠난 옛 쪽으로 되돌아간다. 렌더 중 상태 맞추기라 당겨진 화면이 한 번도 커밋되지 않는다.
  if (view.page !== page) setPage(view.page)
  const setQuery = useCallback((q: string) => { setQueryState(q); setPage(1) }, [])
  return { query, setQuery, setPage, view }
}
