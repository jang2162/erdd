import type pg from 'pg'

/**
 * 다른 커넥션이 이 트랜잭션의 행 락을 기다리기 시작할 때까지 기다린다.
 *
 * 행 락 대기는 pg_locks에 `locktype='transactionid'`, `granted=false`로 나타난다(잠근 쪽의
 * xid를 기다린다). 서버 테스트는 fileParallelism:false라 이 시점에 다른 대기자가 없다.
 */
export async function waitForLockWaiter(client: pg.PoolClient): Promise<void> {
  // vitest 기본 타임아웃(5초)보다 앞서 끝나야 아래 진단 메시지가 보인다.
  const deadline = Date.now() + 3_000
  for (;;) {
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'",
    )
    if (rows[0]!.n > 0) return
    if (Date.now() > deadline) {
      throw new Error('락을 기다리는 커넥션이 나타나지 않았다 — 경합이 재현되지 않았다')
    }
    await new Promise((done) => { setTimeout(done, 25) })
  }
}
