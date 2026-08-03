import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { accessTokens } from '../db/schema.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('access tokens', () => {
  let app: FastifyInstance
  let session: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'u1@test.dev', name: '사용자1', password: 'password-1', role: 'user',
    })
    session = await loginAs(app, 'u1@test.dev', 'password-1')
  })

  async function issue(name = '노트북'): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/trpc/auth.tokens.create',
      cookies: { erdd_session: session },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name }),
    })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.token as string
  }

  it('발급하면 평문을 한 번 돌려주고 목록에는 평문이 없다', async () => {
    const plain = await issue()
    expect(plain.startsWith('erdd_pat_')).toBe(true)
    const list = await app.inject({
      method: 'GET', url: '/trpc/auth.tokens.list', cookies: { erdd_session: session },
    })
    const items = list.json().result.data as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: '노트북', lastUsedAt: null })
    expect(JSON.stringify(items)).not.toContain(plain)
  })

  it('토큰으로 allowlist 프로시저를 호출할 수 있다', async () => {
    const plain = await issue()
    const res = await app.inject({
      method: 'GET', url: '/trpc/auth.me', headers: { authorization: `Bearer ${plain}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ email: 'u1@test.dev' })
  })

  it('토큰으로 세션 전용 프로시저를 호출하면 401이다', async () => {
    const plain = await issue()
    const res = await app.inject({
      method: 'POST', url: '/trpc/auth.changePassword',
      headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: 'password-1', newPassword: 'password-2' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('토큰으로 토큰을 발급할 수 없다', async () => {
    const plain = await issue()
    const res = await app.inject({
      method: 'POST', url: '/trpc/auth.tokens.create',
      headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: '두번째' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('폐기된 토큰과 없는 토큰은 401이다', async () => {
    const plain = await issue()
    const row = (await app.db!.select().from(accessTokens))[0]!
    await app.inject({
      method: 'POST', url: '/trpc/auth.tokens.revoke',
      cookies: { erdd_session: session },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ id: row.id }),
    })
    const revoked = await app.inject({
      method: 'GET', url: '/trpc/auth.me', headers: { authorization: `Bearer ${plain}` },
    })
    expect(revoked.statusCode).toBe(401)
    const bogus = await app.inject({
      method: 'GET', url: '/trpc/auth.me', headers: { authorization: 'Bearer erdd_pat_nope' },
    })
    expect(bogus.statusCode).toBe(401)
  })

  it('인증에 성공하면 lastUsedAt이 채워진다', async () => {
    const plain = await issue()
    await app.inject({ method: 'GET', url: '/trpc/auth.me', headers: { authorization: `Bearer ${plain}` } })
    const rows = await app.db!.select().from(accessTokens)
    expect(rows[0]!.lastUsedAt).not.toBeNull()
  })

  it('기존 쿠키 경로는 그대로 동작한다', async () => {
    const res = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: session },
    })
    expect(res.statusCode).toBe(200)
    const cp = await app.inject({
      method: 'POST', url: '/trpc/auth.changePassword',
      cookies: { erdd_session: session },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: 'password-1', newPassword: 'password-2' }),
    })
    expect(cp.statusCode).toBe(200)
  })

  it('폐기된 토큰은 목록에 나오지 않는다', async () => {
    await issue('첫번째')
    const row = (await app.db!.select().from(accessTokens).where(eq(accessTokens.name, '첫번째')))[0]!
    await app.inject({
      method: 'POST', url: '/trpc/auth.tokens.revoke',
      cookies: { erdd_session: session },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ id: row.id }),
    })
    const list = await app.inject({
      method: 'GET', url: '/trpc/auth.tokens.list', cookies: { erdd_session: session },
    })
    expect(list.json().result.data).toEqual([])
  })
})
