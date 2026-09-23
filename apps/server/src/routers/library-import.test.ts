import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { waitForLockWaiter } from '../testing/locks.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL
const HEAD = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 파일 }\n'
const wordsFile = (...rows: string[]) => `${HEAD}words:\n${rows.map((r) => `  - ${r}`).join('\n')}\n`

describe.skipIf(!url)('resource.library.import', () => {
  let app: FastifyInstance
  let admin: string
  let user: string
  const post = (session: string, input: unknown) => app.inject({
    method: 'POST', url: '/trpc/resource.library.import', cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
  const items = (libraryId: string) =>
    app.db!.select().from(resourceItems).where(eq(resourceItems.libraryId, libraryId))
  const createGlobal = async (name = '표준') => (await app.inject({
    method: 'POST', url: '/trpc/resource.library.create', cookies: { erdd_session: admin },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ scope: 'global', name }),
  })).json().result.data.id as string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    admin = await loginAs(app, 'admin@t.dev', 'pw-123456')
    user = await loginAs(app, 'user@t.dev', 'pw-123456')
  })

  it('create 로 전역 라이브러리를 만들며 가져온다 — 관리자만', async () => {
    const input = { target: { create: { scope: 'global', name: '행안부' } }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') }
    expect((await post(user, input)).statusCode).toBe(403)
    const res = await post(admin, input)
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data
    expect(data).toMatchObject({ applied: true, summary: { counts: { add: 1 } } })
    expect(await items(data.libraryId)).toEqual([expect.objectContaining({ kind: 'word', version: 1 })])
  })

  it('다른 조직 orgId 로는 만들 수 없다', async () => {
    const orgId = uuidv7()
    const res = await post(user, { target: { create: { scope: 'org', orgId, name: 'x' } }, text: wordsFile('{ logicalName: 고객 }') })
    expect(res.statusCode).toBe(403)
  })

  it('dryRun 은 쓰지 않고 계획과 해시를 돌려준다', async () => {
    const libraryId = await createGlobal()
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), dryRun: true })
    expect(res.json().result.data).toMatchObject({ applied: false, summary: { counts: { add: 1 } }, stateHash: expect.any(String) })
    expect(await items(libraryId)).toEqual([])
  })

  it('갱신은 버전을 올리고, 같은 내용 재가져오기는 버전·updatedAt 을 건드리지 않는다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') })
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CSTMR }') })
    expect((await items(libraryId))[0]).toMatchObject({ version: 2 })
    const before = (await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId)))[0]!.updatedAt
    const again = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CSTMR }') })
    expect(again.json().result.data.summary.counts).toMatchObject({ unchanged: 1, update: 0 })
    expect((await items(libraryId))[0]).toMatchObject({ version: 2 })
    const after = (await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId)))[0]!.updatedAt
    expect(after.getTime()).toBe(before.getTime())
  })

  it('내보낸 파일을 그대로 다시 가져오면 바뀌는 것이 없다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }', '{ logicalName: 주문, abbreviation: ORD }') })
    const exported = (await app.inject({
      method: 'GET', url: `/trpc/resource.library.export?input=${encodeURIComponent(JSON.stringify({ libraryId }))}`,
      cookies: { erdd_session: admin },
    })).json().result.data.text
    const res = await post(admin, { target: { libraryId }, text: exported, prune: true })
    expect(res.json().result.data.summary.counts).toMatchObject({ unchanged: 2, add: 0, update: 0, remove: 0 })
  })

  it('미리보기 해시가 달라지면 409 로 거절하고 아무것도 쓰지 않는다', async () => {
    const libraryId = await createGlobal()
    const preview = (await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), dryRun: true })).json().result.data
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 주문 }') })   // 그 사이 남이 바꿈
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), expectedStateHash: preview.stateHash })
    expect(res.statusCode).toBe(409)
    expect((await items(libraryId)).map((i) => (i.payload as { logicalName: string }).logicalName)).toEqual(['주문'])
  })

  /**
   * 미리보기 해시가 맞으면 적용이 통과한다 — 위 409 테스트(불일치 → 거절)만으로는 「해시가 오면
   * 무조건 409」나 dryRun·적용 두 경로의 해시 계산이 갈라지는 결함을 잡지 못한다. id 오름차순과
   * 생성 순서를 일부러 어긋나게 심어 정렬 결정성도 함께 잠근다.
   */
  it('미리보기 해시가 일치하면 적용이 통과한다(변경 없음, 3개 이상, id·생성 순서 불일치)', async () => {
    const libraryId = await createGlobal()
    const idApple = '00000000-0000-4000-8000-000000000001'
    const idBanana = '00000000-0000-4000-8000-000000000002'
    const idOrange = '00000000-0000-4000-8000-000000000003'
    // 생성 순서(오렌지 → 사과 → 바나나)와 id 오름차순(사과 → 바나나 → 오렌지)을 일부러 어긋나게 한다.
    for (const [id, payload, offset] of [
      [idOrange, { logicalName: '오렌지', abbreviation: 'ORNG', englishName: null, description: null }, '3 seconds'],
      [idApple, { logicalName: '사과', abbreviation: 'APL', englishName: null, description: null }, '2 seconds'],
      [idBanana, { logicalName: '바나나', abbreviation: 'BNN', englishName: null, description: null }, '1 seconds'],
    ] as const) {
      await app.pgPool!.query(
        `INSERT INTO resource_items (id, library_id, kind, payload, version, created_at)
         VALUES ($1, $2, 'word', $3::jsonb, 1, now() - $4::interval)`,
        [id, libraryId, JSON.stringify(payload), offset],
      )
    }
    const text = `${HEAD}words:\n  - { logicalName: 사과, abbreviation: APL }\n  - { logicalName: 바나나, abbreviation: BNN }\n  - { logicalName: 오렌지, abbreviation: ORNG }\n`
    const preview = (await post(admin, { target: { libraryId }, text, dryRun: true })).json().result.data
    expect(preview.summary.counts).toMatchObject({ unchanged: 3, add: 0, update: 0, remove: 0 })
    const res = await post(admin, { target: { libraryId }, text, expectedStateHash: preview.stateHash })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data
    expect(data).toMatchObject({ applied: true, summary: { counts: { unchanged: 3, add: 0, update: 0, remove: 0 } } })
    const left = (await items(libraryId)).map((i) => ({
      id: i.id, version: i.version, abbreviation: (i.payload as { abbreviation: string }).abbreviation,
    })).sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(left).toEqual([
      { id: idApple, version: 1, abbreviation: 'APL' },
      { id: idBanana, version: 1, abbreviation: 'BNN' },
      { id: idOrange, version: 1, abbreviation: 'ORNG' },
    ])
  })

  it('파일 오류는 400 이고 위치를 담는다', async () => {
    const libraryId = await createGlobal()
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbrevation: X }') })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('words[0] (고객)')
  })

  /**
   * 🔥 가져오기는 전부 아니면 전무다. 실패 주입은 실제 DB 트리거로 한다 — 두 번째 항목 INSERT 에서
   * 예외를 던지면, 생성한 라이브러리와 첫 항목이 함께 롤백돼야 한다.
   */
  it('중간에 실패하면 라이브러리 생성까지 함께 롤백된다', async () => {
    const client = await app.pgPool!.connect()
    try {
      await client.query(`CREATE OR REPLACE FUNCTION erdd_test_fail() RETURNS trigger AS $$
        BEGIN IF NEW.payload->>'logicalName' = '__fail__' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
      await client.query('CREATE TRIGGER erdd_test_fail BEFORE INSERT ON resource_items FOR EACH ROW EXECUTE FUNCTION erdd_test_fail()')
      const res = await post(admin, {
        target: { create: { scope: 'global', name: '롤백' } },
        text: wordsFile('{ logicalName: 고객 }', '{ logicalName: __fail__ }'),
      })
      expect(res.statusCode).toBe(500)
      expect(await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.name, '롤백'))).toEqual([])
      expect(await app.db!.select().from(resourceItems)).toEqual([])
    } finally {
      await client.query('DROP TRIGGER IF EXISTS erdd_test_fail ON resource_items')
      await client.query('DROP FUNCTION IF EXISTS erdd_test_fail()')
      client.release()
    }
  })

  /**
   * 🔥 동시 가져오기가 동명 항목을 두 개 만들지 않는다 — 계획이 **라이브러리 행 락 안에서** 세워져야 한다.
   * 밖에서 라이브러리 행을 잠가 가져오기를 붙들어 두고(실제 대기를 pg_locks 로 확인), 그 사이 같은
   * 이름의 항목을 넣고 풀어 준다. 락 전에 항목을 읽는 구현이면 「추가」로 계산해 둘이 된다.
   */
  it('동시 가져오기가 동명 중복을 만들지 않는다', async () => {
    const libraryId = await createGlobal()
    const client = await app.pgPool!.connect()
    let res: Awaited<ReturnType<typeof post>>
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM resource_libraries WHERE id = $1 FOR UPDATE', [libraryId])
      const pending = post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') })
      await waitForLockWaiter(client)
      await client.query(
        `INSERT INTO resource_items (id, library_id, kind, payload, version) VALUES ($1, $2, 'word', $3::jsonb, 1)`,
        [uuidv7(), libraryId, JSON.stringify({ logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })],
      )
      await client.query('COMMIT')
      res = await pending
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.summary.counts).toMatchObject({ unchanged: 1, add: 0 })
    expect(await items(libraryId)).toHaveLength(1)
  })

  /**
   * 🔥 가져오기가 라이브러리 행만 잠그고 항목은 잠그지 않은 채 읽으면, 그 사이 items.update 가
   * 커밋한 값을 가져오기가 버전 조건 없이 덮어써 v2 가 두 값을 가리키게 된다. 밖에서 항목 행을
   * 잠가 가져오기를 붙들어 두고(실제 대기를 pg_locks 로 확인), 그 사이 항목을 v2 로 바꾸고 풀어
   * 준다 — 가져오기는 그 위에서 병합해 v3 으로 끝나야 한다(같은 버전 두 값이 생기면 안 된다).
   */
  it('가져오기가 항목도 잠가 동시 items.update 를 덮어쓰지 않는다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') })
    const itemId = (await items(libraryId))[0]!.id
    const client = await app.pgPool!.connect()
    let res: Awaited<ReturnType<typeof post>>
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM resource_items WHERE id = $1 FOR UPDATE', [itemId])
      const pending = post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CSTMR }') })
      await waitForLockWaiter(client)
      await client.query(
        'UPDATE resource_items SET version = 2, payload = $2::jsonb WHERE id = $1',
        [itemId, JSON.stringify({ logicalName: '고객', abbreviation: 'MID', englishName: null, description: null })],
      )
      await client.query('COMMIT')
      res = await pending
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
    expect(res.statusCode).toBe(200)
    const rows = await items(libraryId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: itemId, version: 3, payload: { logicalName: '고객', abbreviation: 'CSTMR' } })
  })

  it('prune 은 파일에 없는 항목을 지우되, 남는 용어가 가리키는 도메인은 남긴다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: `${HEAD}domains:\n  - { id: d, name: 금액, logicalType: DECIMAL }\n  - { name: 수량, logicalType: INT }\nterms:\n  - { logicalName: 합계, physicalName: SUM, domainId: d }\nwords:\n  - { logicalName: 고객 }\n` })
    const res = await post(admin, { target: { libraryId }, text: `${HEAD}domains: []\nwords: []\n`, prune: true })
    expect(res.json().result.data.summary.counts).toMatchObject({ remove: 3, removeBlocked: 1 })
    const left = (await items(libraryId)).map((i) => `${i.kind}:${String((i.payload as { name?: string; logicalName?: string }).name ?? (i.payload as { logicalName?: string }).logicalName)}`).sort()
    expect(left).toEqual(['domain:금액', 'term:합계'])
  })
})
