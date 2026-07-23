/** JSON-safe 값(객체/배열/원시/null)의 구조적 동등 비교. undefined·함수·Date는 전제 밖. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const arrA = a as unknown[]
    const arrB = b as unknown[]
    return arrA.length === arrB.length && arrA.every((v, i) => deepEqual(v, arrB[i]))
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)
  return (
    keysA.length === keysB.length &&
    keysA.every((k) => Object.prototype.hasOwnProperty.call(objB, k) && deepEqual(objA[k], objB[k]))
  )
}
