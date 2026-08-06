/**
 * Postgres unique 위반(SQLSTATE 23505)인지 판정한다.
 *
 * "먼저 조회해 보고 없으면 INSERT"는 조회와 INSERT 사이에 남이 끼어들 수 있어 경합에서 깨진다.
 * 최종 판정은 유니크 제약이 하고, 호출자는 그 예외를 500이 아니라 CONFLICT로 옮겨야 한다.
 * drizzle이 원인 예외를 `cause`로 감싸는 경우가 있어 양쪽을 본다.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; cause?: { code?: unknown } }
  return e.code === '23505' || e.cause?.code === '23505'
}
