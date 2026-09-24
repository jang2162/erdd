import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useListPage } from './use-list-page'

type Row = { name: string }
const FIELDS = (r: Row) => [r.name]
const ROWS: Row[] = Array.from({ length: 120 }, (_, i) => ({ name: `n${i}` }))

describe('useListPage', () => {
  it('검색어를 바꾸면 1쪽으로 돌아간다', () => {
    const { result } = renderHook(() => useListPage(ROWS, FIELDS))
    act(() => result.current.setPage(3))
    expect(result.current.view.page).toBe(3)
    act(() => result.current.setQuery('n1'))
    expect(result.current.query).toBe('n1')
    expect(result.current.view.page).toBe(1)
    expect(result.current.view.total).toBe(31)   // n1, n10..n19, n100..n119
  })
  it('행이 줄어 쪽이 당겨진 뒤 행이 다시 늘어도 당겨진 쪽에 머문다', () => {
    const { result, rerender } = renderHook(({ rows }) => useListPage(rows, FIELDS), { initialProps: { rows: ROWS } })
    act(() => result.current.setPage(3))
    rerender({ rows: ROWS.slice(0, 60) })   // 두 쪽 — 3쪽이 2쪽으로 당겨진다
    expect(result.current.view.page).toBe(2)
    rerender({ rows: ROWS })
    expect(result.current.view.page).toBe(2)
  })
  it('검색 결과가 여러 쪽이어도 1쪽으로 돌아간다 — 페이지 당김에 기대지 않는다', () => {
    // 결과가 한 쪽뿐이면 filterAndPage 의 당김이 3쪽을 1쪽으로 끌어내려 리셋이 빠져도 드러나지 않는다.
    const { result } = renderHook(() => useListPage(ROWS, FIELDS))
    act(() => result.current.setPage(3))
    act(() => result.current.setQuery('n'))
    expect(result.current.view).toMatchObject({ total: 120, pageCount: 3, page: 1 })
  })
})
