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
})
