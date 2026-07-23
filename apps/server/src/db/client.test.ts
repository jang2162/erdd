import { describe, expect, it } from 'vitest'
import { createDb } from './client.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('db client', () => {
  it('connects and runs a query', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query('select 1 as one')
    expect(res.rows[0].one).toBe(1)
    await pool.end()
  })
})
