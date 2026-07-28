import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { members, organizations } from '../db/schema.js'

const url = process.env.DATABASE_URL

const WORD = { logicalName: '회원', abbreviation: 'MBR', description: null }

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: token } })
}

describe.skipIf(!url)('resource', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetDb(app.pgPool!) })

  it('전역 라이브러리는 서비스 관리자만 만들 수 있다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    const adminToken = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const userToken = await loginAs(app, 'user@t.dev', 'pw-123456')

    const denied = await post(app, 'resource.library.create', userToken, { scope: 'global', name: '표준' })
    expect(denied.statusCode).toBe(403)

    const created = await post(app, 'resource.library.create', adminToken, { scope: 'global', name: '표준' })
    expect(created.statusCode).toBe(200)

    // 전역 라이브러리는 아무 인증 사용자나 읽을 수 있다
    const listed = await get(app, 'resource.library.list', userToken, { scope: 'global' })
    expect(listed.statusCode).toBe(200)
    const data = listed.json().result.data
    expect(data).toHaveLength(1)
    expect(data[0].itemCount).toBe(0)
  })

  it('조직 라이브러리는 Owner/Admin만 쓰고, 멤버는 읽기만, 외부인은 못 읽는다', async () => {
    const owner = await createAccount(app.db!, { email: 'owner@t.dev', name: 'O', password: 'pw-123456', role: 'user' })
    const memberUser = await createAccount(app.db!, { email: 'mem@t.dev', name: 'M', password: 'pw-123456', role: 'user' })
    await createAccount(app.db!, { email: 'out@t.dev', name: 'X', password: 'pw-123456', role: 'user' })
    const orgId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '팀', kind: 'team' })
    await app.db!.insert(members).values([
      { id: uuidv7(), orgId, userId: owner.id, role: 'owner' },
      { id: uuidv7(), orgId, userId: memberUser.id, role: 'member' },
    ])
    const ownerToken = await loginAs(app, 'owner@t.dev', 'pw-123456')
    const memberToken = await loginAs(app, 'mem@t.dev', 'pw-123456')
    const outsiderToken = await loginAs(app, 'out@t.dev', 'pw-123456')

    expect((await post(app, 'resource.library.create', memberToken, {
      scope: 'org', orgId, name: '조직표준',
    })).statusCode).toBe(403)
    const created = await post(app, 'resource.library.create', ownerToken, {
      scope: 'org', orgId, name: '조직표준',
    })
    expect(created.statusCode).toBe(200)

    expect((await get(app, 'resource.library.list', memberToken, { scope: 'org', orgId })).statusCode).toBe(200)
    expect((await get(app, 'resource.library.list', outsiderToken, { scope: 'org', orgId })).statusCode).toBe(403)
  })

  it('payload가 스키마에 안 맞으면 400', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const token = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await post(app, 'resource.library.create', token, { scope: 'global', name: '표준' })).json().result.data
    const bad = await post(app, 'resource.items.create', token, {
      libraryId: lib.id, kind: 'word', payload: { logicalName: '회원' },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('항목 수정은 payload가 실제로 달라졌을 때만 version을 올린다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const token = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await post(app, 'resource.library.create', token, { scope: 'global', name: '표준' })).json().result.data
    const item = (await post(app, 'resource.items.create', token, {
      libraryId: lib.id, kind: 'word', payload: WORD,
    })).json().result.data
    expect(item.version).toBe(1)

    const same = await post(app, 'resource.items.update', token, { itemId: item.id, payload: WORD })
    expect(same.json().result.data.version).toBe(1)

    const changed = await post(app, 'resource.items.update', token, {
      itemId: item.id, payload: { ...WORD, abbreviation: 'MEMBER' },
    })
    expect(changed.json().result.data.version).toBe(2)
  })

  it('라이브러리를 지우면 항목도 함께 사라진다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const token = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await post(app, 'resource.library.create', token, { scope: 'global', name: '표준' })).json().result.data
    await post(app, 'resource.items.create', token, { libraryId: lib.id, kind: 'word', payload: WORD })
    await post(app, 'resource.library.remove', token, { libraryId: lib.id })
    const rows = await app.pgPool!.query('SELECT count(*)::int AS n FROM resource_items')
    expect(rows.rows[0].n).toBe(0)
  })
})
