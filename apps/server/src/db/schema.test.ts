import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client.js'
import { resetDb, TEST_TABLES } from '../testing/db.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('schema', () => {
  it('has all six tables migrated', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const names = res.rows.map((r) => r.table_name)
    for (const t of TEST_TABLES) expect(names).toContain(t)
    await pool.end()
  })

  it('users has role/is_active and no email_verified_at', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    )
    const cols = res.rows.map((r) => r.column_name)
    expect(cols).toContain('role')
    expect(cols).toContain('is_active')
    expect(cols).not.toContain('email_verified_at')
    await pool.end()
  })
})
