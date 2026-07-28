import pg from 'pg'

export const TEST_TABLES = [
  'revisions', 'snapshots',
  'model_columns', 'model_indexes', 'model_relationships', 'model_notes',
  'model_tables', 'model_table_groups',
  'model_terms', 'model_words', 'model_domains', 'model_custom_fields',
  'resource_items', 'resource_libraries',
  'project_members', 'projects', 'members', 'organizations', 'sessions', 'users',
] as const

/** 통합 테스트용 초기화 — 전 테이블 TRUNCATE. */
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${TEST_TABLES.join(', ')} CASCADE`)
}
