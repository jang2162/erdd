import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './use-debounced-value'

afterEach(() => { vi.useRealTimers() })

describe('useDebouncedValue', () => {
  it('처음 값은 곧바로, 바뀐 값은 지연 뒤에 낸다 — 사이에 또 바뀌면 다시 센다', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: 'a' } })
    expect(result.current).toBe('a')
    rerender({ v: 'ab' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    rerender({ v: 'abc' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('abc')
  })
})
