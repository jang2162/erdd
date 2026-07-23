import pg from 'pg'

export const TEST_TABLES = [
  'project_members', 'projects', 'members', 'organizations', 'sessions', 'users',
] as const

/** 통합 테스트용 초기화 — 전 테이블 TRUNCATE. */
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${TEST_TABLES.join(', ')} CASCADE`)
}
