import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'

const url = process.env.DATABASE_URL

type Kind = 'domain' | 'word' | 'term' | 'customField'
type SeedRow = { kind: Kind; payload: Record<string, unknown> }
type PageItem = { id: string; kind: Kind; payload: Record<string, unknown>; version: number }

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string | null, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({
    method: 'GET', url: `/trpc/${path}${qs}`,
    ...(token === null ? {} : { cookies: { erdd_session: token } }),
  })
}

const word = (logicalName: string, abbreviation: string, englishName: string | null = null): SeedRow =>
  ({ kind: 'word', payload: { logicalName, abbreviation, englishName, description: null } })
const term = (logicalName: string, physicalName: string, description: string | null = null): SeedRow =>
  ({ kind: 'term', payload: { logicalName, physicalName, domainId: null, description } })
const domain = (name: string): SeedRow => ({
  kind: 'domain',
  payload: {
    name, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  },
})
const customField = (name: string): SeedRow => ({
  kind: 'customField',
  payload: { name, target: 'column', type: 'text', options: [], required: false, defaultValue: null },
})

/** 라이브러리 하나와 항목을 DB 에 바로 넣는다(권한 검사 밖 — 조회만 시험한다). id 는 넣은 순서대로다. */
async function seedLibrary(
  app: FastifyInstance, rows: SeedRow[],
  owner: { scope: 'global' } | { scope: 'org'; orgId: string } = { scope: 'global' },
): Promise<{ libraryId: string; ids: string[] }> {
  const libraryId = uuidv7()
  await app.db!.insert(resourceLibraries).values({
    id: libraryId, scope: owner.scope, orgId: owner.scope === 'org' ? owner.orgId : null,
    name: '표준', description: '',
  })
  const ids = rows.map(() => uuidv7())
  if (rows.length > 0) {
    await app.db!.insert(resourceItems).values(rows.map((row, i) => ({
      id: ids[i]!, libraryId, kind: row.kind, payload: row.payload, version: 1,
    })))
  }
  return { libraryId, ids }
}

async function page(
  app: FastifyInstance, token: string, input: Record<string, unknown>,
): Promise<{ status: number; items: PageItem[]; total: number }> {
  const res = await get(app, 'resource.items.page', token, input)
  if (res.statusCode !== 200) return { status: res.statusCode, items: [], total: -1 }
  const data = res.json().result.data as { items: PageItem[]; total: number }
  return { status: 200, items: data.items, total: data.total }
}
const names = (items: PageItem[]) =>
  items.map((i) => String(i.payload.logicalName ?? i.payload.name))

describe.skipIf(!url)('resource.items.page', () => {
  let app: FastifyInstance
  let token: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'u@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    token = await loginAs(app, 'u@t.dev', 'pw-123456')
  })

  it('한 종류만 논리명 오름차순으로 돌려주고 total 은 그 종류의 전체 건수다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('order', 'ORD'), word('alpha', 'ALP'), term('member_no', 'MBR_NO'), word('mike', 'MK'),
    ])
    const r = await page(app, token, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(r.status).toBe(200)
    expect(names(r.items)).toEqual(['alpha', 'mike', 'order'])
    expect(r.items.every((i) => i.kind === 'word' && i.version === 1)).toBe(true)
    expect(r.total).toBe(3)
  })

  it('정렬은 DB 로캘이 아니라 코드 포인트 순이다 — 한글은 가나다순, 영문 대문자가 소문자보다 앞', async () => {
    // en_US.utf8(glibc) 기본 정렬이면 「apple, Zeta, 가, 값, 국, 나, 가감, 가격」 — 한글이 글자 수 먼저로 늘어선다.
    const { libraryId } = await seedLibrary(app, ['나', 'Zeta', '가격', 'apple', '값', '가', '국', '가감']
      .map((n, i) => word(n, `W${i}`)))
    expect(names((await page(app, token, { libraryId, kind: 'word', offset: 0, limit: 50 })).items))
      .toEqual(['Zeta', 'apple', '가', '가감', '가격', '값', '국', '나'])
  })

  it('도메인·커스텀 항목은 name 으로 정렬한다', async () => {
    const { libraryId } = await seedLibrary(app, [
      domain('zeta'), domain('beta'), customField('yankee'), customField('bravo'),
    ])
    expect(names((await page(app, token, { libraryId, kind: 'domain', offset: 0, limit: 50 })).items))
      .toEqual(['beta', 'zeta'])
    expect(names((await page(app, token, { libraryId, kind: 'customField', offset: 0, limit: 50 })).items))
      .toEqual(['bravo', 'yankee'])
  })

  it('단어는 논리명·약어·영문명, 용어는 논리명·물리명으로 대소문자 없이 찾고 total 도 그 조건을 따른다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('member', 'MBR', 'Member Info'), word('order', 'ORD'), word('memo', 'MEMO'),
      term('member_no', 'MBR_NO'), term('order_no', 'ORD_NO', 'member stuff'),
    ])
    const byAbbr = await page(app, token, { libraryId, kind: 'word', query: 'mbr', offset: 0, limit: 50 })
    expect(names(byAbbr.items)).toEqual(['member'])
    expect(byAbbr.total).toBe(1)
    expect(names((await page(app, token, { libraryId, kind: 'word', query: 'INFO', offset: 0, limit: 50 })).items))
      .toEqual(['member'])
    expect(names((await page(app, token, { libraryId, kind: 'term', query: 'mbr', offset: 0, limit: 50 })).items))
      .toEqual(['member_no'])
    // 설명은 검색 필드가 아니다.
    const byDescription = await page(app, token, { libraryId, kind: 'term', query: 'stuff', offset: 0, limit: 50 })
    expect(byDescription.items).toEqual([])
    expect(byDescription.total).toBe(0)
  })

  it('검색어의 % _ \\ 는 글자 그대로 찾는다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('rate100%', 'R1'), word('rate1000', 'R2'), word('a_b', 'AB'), word('axb', 'AXB'),
      word('c\\d', 'CD1'), word('cd', 'CD2'),
    ])
    const q = async (query: string) =>
      names((await page(app, token, { libraryId, kind: 'word', query, offset: 0, limit: 50 })).items)
    expect(await q('100%')).toEqual(['rate100%'])
    expect(await q('_')).toEqual(['a_b'])
    expect(await q('\\')).toEqual(['c\\d'])
  })

  it('검색어가 공백뿐이면 거르지 않는다', async () => {
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A'), word('bravo', 'B')])
    const r = await page(app, token, { libraryId, kind: 'word', query: '   ', offset: 0, limit: 50 })
    expect(r.total).toBe(2)
  })

  it('같은 이름이 여럿이어도 페이지를 넘기며 겹치거나 빠지지 않는다 — 동률은 id 로 깬다', async () => {
    const rows = [word('alpha', 'A'), ...Array.from({ length: 7 }, () => word('same', 'S')), word('zulu', 'Z')]
    const { libraryId, ids } = await seedLibrary(app, rows)
    const seen: string[] = []
    for (const offset of [0, 4, 8]) {
      const r = await page(app, token, { libraryId, kind: 'word', offset, limit: 4 })
      expect(r.total).toBe(9)
      seen.push(...r.items.map((i) => i.id))
    }
    const sameIds = ids.slice(1, 8).sort()
    expect(seen).toEqual([ids[0], ...sameIds, ids[8]])
  })

  it('볼 수 없는 조직 라이브러리는 items.list 와 똑같이 거절한다', async () => {
    await createAccount(app.db!, { email: 'o@t.dev', name: 'O', password: 'pw-123456', role: 'user' })
    const ownerToken = await loginAs(app, 'o@t.dev', 'pw-123456')
    const orgId = (await post(app, 'org.create', ownerToken, { name: '팀' })).json().result.data.id as string
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A')], { scope: 'org', orgId })

    const outsider = await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(outsider.statusCode).toBe(403)
    expect((await get(app, 'resource.items.list', token, { libraryId })).statusCode).toBe(403)

    const member = await page(app, ownerToken, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(member.status).toBe(200)
    expect(member.total).toBe(1)
  })

  it('limit 은 1..200 이고 세션 없이는 부를 수 없다', async () => {
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A')])
    expect((await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 201 })).statusCode).toBe(400)
    expect((await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 0 })).statusCode).toBe(400)
    expect((await page(app, token, { libraryId, kind: 'word', offset: 0, limit: 200 })).status).toBe(200)
    expect((await get(app, 'resource.items.page', null, { libraryId, kind: 'word', offset: 0, limit: 50 })).statusCode).toBe(401)
  })
})

describe.skipIf(!url)('library.list·listForProject — countsByKind', () => {
  let app: FastifyInstance
  let token: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'u@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    token = await loginAs(app, 'u@t.dev', 'pw-123456')
  })

  type Row = { id: string; itemCount: number; countsByKind: Record<Kind, number> }
  const sum = (c: Record<Kind, number>) => c.domain + c.word + c.term + c.customField

  it('종류별 개수를 싣고 그 합이 itemCount 와 같다 — 빈 라이브러리는 전부 0', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('a', 'A'), word('b', 'B'), term('c', 'C'), domain('d'),
    ])
    const empty = await seedLibrary(app, [])
    const rows = (await get(app, 'resource.library.list', token, { scope: 'global' })).json().result.data as Row[]
    const full = rows.find((r) => r.id === libraryId)!
    expect(full.countsByKind).toEqual({ domain: 1, word: 2, term: 1, customField: 0 })
    expect(sum(full.countsByKind)).toBe(full.itemCount)
    const blank = rows.find((r) => r.id === empty.libraryId)!
    expect(blank.countsByKind).toEqual({ domain: 0, word: 0, term: 0, customField: 0 })
    expect(blank.itemCount).toBe(0)
  })

  it('listForProject 도 같은 공통 조회라 countsByKind 를 싣는다', async () => {
    const { libraryId } = await seedLibrary(app, [customField('x'), customField('y'), word('a', 'A')])
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id as string
    const projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id as string
    const rows = (await get(app, 'resource.library.listForProject', token, { projectId })).json().result.data as Row[]
    const row = rows.find((r) => r.id === libraryId)!
    expect(row.countsByKind).toEqual({ domain: 0, word: 1, term: 0, customField: 2 })
    expect(sum(row.countsByKind)).toBe(row.itemCount)
  })
})

describe.skipIf(!url)('resource_items 인덱스', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  it('(library_id, kind) 복합 인덱스가 있고 library_id 단일 인덱스는 없다', async () => {
    const { rows } = await app.pgPool!.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'resource_items'",
    )
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))
    expect(byName.has('ix_resource_items_library_id')).toBe(false)
    expect(byName.get('ix_resource_items_library_kind')).toMatch(/\(library_id, kind\)/)
  })
})
