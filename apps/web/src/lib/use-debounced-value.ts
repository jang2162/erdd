import { useEffect, useState } from 'react'

/** 값이 `delayMs` 동안 바뀌지 않으면 그 값을 낸다. 처음 값은 곧바로 낸다(마운트 때 한 박자 늦지 않게). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
