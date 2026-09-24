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
  const setQuery = useCallback((q: string) => { setQueryState(q); setPage(1) }, [])
  return { query, setQuery, setPage, view }
}
