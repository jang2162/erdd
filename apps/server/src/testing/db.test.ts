import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { TEST_TABLES } from './db.js'
import { createTestApp } from './helpers.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('TEST_TABLES', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  // 새 테이블을 만들고 이 목록에 넣지 않으면 그 테이블만 테스트 간에 살아남아
  // 다음 스위트를 조용히 오염시킨다. 그것을 여기서 잡는다.
  // drizzle 마이그레이션 메타는 drizzle 스키마에 있으므로 public 필터만으로 충분하다.
  it('DB의 모든 테이블을 덮는다', async () => {
    const res = await app.pgPool!.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `)
    const actual = res.rows.map((r) => r.table_name)
    expect(actual.filter((t) => !(TEST_TABLES as readonly string[]).includes(t))).toEqual([])
  })
})
