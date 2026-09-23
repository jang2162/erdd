import type pg from 'pg'

/**
 * 다른 커넥션이 **이 커넥션(`client`)의** 행 락을 기다리기 시작할 때까지 기다린다.
 *
 * `pg_locks`의 `locktype='transactionid'`, `granted=false`는 클러스터 전역이라 다른 트랙의
 * test DB(같은 Postgres 인스턴스의 erdd_test_b 등)에서 생긴 대기도 센다 — 병렬 트랙이 동시에
 * 경합 테스트를 돌리면 남의 대기를 보고 일찍 돌아와 구분력을 잃는다(락 전에 읽는 회귀 구현도
 * 통과할 수 있다). `pg_blocking_pids(pid)`로 **이 커넥션의 backend pid 를 실제로 기다리는
 * 백엔드**만 센다.
 */
export async function waitForLockWaiter(client: pg.PoolClient): Promise<void> {
  // vitest 기본 타임아웃(5초)보다 앞서 끝나야 아래 진단 메시지가 보인다.
  const deadline = Date.now() + 3_000
  for (;;) {
    const { rows } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))',
    )
    if (rows[0]!.n > 0) return
    if (Date.now() > deadline) {
      throw new Error('락을 기다리는 커넥션이 나타나지 않았다 — 경합이 재현되지 않았다')
    }
    await new Promise((done) => { setTimeout(done, 25) })
  }
}
