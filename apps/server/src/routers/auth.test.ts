import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount, ensureBootstrapAdmin } from '../services/accounts.js'
import { issueToken, tokenExpiry } from '../services/one-time-token.js'
import { organizations, passwordResetTokens, users } from '../db/schema.js'

const url = process.env.DATABASE_URL

/** 세션 쿠키 없이 호출한다 — resetPassword가 정말 공개인지 보려면 이것을 써야 한다. */
function postPublic(app: FastifyInstance, path: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

describe.skipIf(!url)('auth', () => {
  let app: FastifyInstance
  let userId: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const user = await createAccount(app.db!, {
      email: 'u1@test.dev', name: '사용자1', password: 'password-1', role: 'user',
    })
    userId = user.id
  })

  /**
   * 재설정 토큰을 DB에 직접 심는다 — 여기서는 소비 경로(auth.resetPassword)만 본다.
   * 발급 경로(admin.users.resetLink)가 낸 토큰이 실제로 여기에 먹히는지는 admin.test.ts가
   * 실제 토큰으로 확인한다.
   */
  async function seedResetToken(
    over: Partial<typeof passwordResetTokens.$inferInsert> = {},
  ): Promise<string> {
    const { plain, hash } = issueToken('reset')
    await app.db!.insert(passwordResetTokens).values({
      id: uuidv7(), userId, tokenHash: hash,
      expiresAt: tokenExpiry('reset'), createdBy: userId, ...over,
    })
    return plain
  }

  it('login sets a session cookie and me returns the user', async () => {
    const token = await loginAs(app, 'u1@test.dev', 'password-1')
    const res = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ email: 'u1@test.dev', role: 'user' })
  })

  it('rejects a wrong password with 401 and me without session with 401', async () => {
    const bad = await app.inject({
      method: 'POST', url: '/trpc/auth.login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'u1@test.dev', password: 'nope' }),
    })
    expect(bad.statusCode).toBe(401)
    const me = await app.inject({ method: 'GET', url: '/trpc/auth.me' })
    expect(me.statusCode).toBe(401)
  })

  it('changePassword invalidates the old password', async () => {
    const token = await loginAs(app, 'u1@test.dev', 'password-1')
    const res = await app.inject({
      method: 'POST', url: '/trpc/auth.changePassword',
      cookies: { erdd_session: token },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: 'password-1', newPassword: 'password-2' }),
    })
    expect(res.statusCode).toBe(200)
    await expect(loginAs(app, 'u1@test.dev', 'password-1')).rejects.toThrow()
    await loginAs(app, 'u1@test.dev', 'password-2')
  })

  it('createAccount creates a personal org; bootstrap admin is idempotent', async () => {
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(1)
    expect(orgs[0]).toMatchObject({ kind: 'personal' })

    process.env.ADMIN_EMAIL = 'admin@test.dev'
    process.env.ADMIN_PASSWORD = 'admin-pass-1'
    await ensureBootstrapAdmin(app.db!)
    await ensureBootstrapAdmin(app.db!)
    const token = await loginAs(app, 'admin@test.dev', 'admin-pass-1')
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: token },
    })
    expect(me.json().result.data).toMatchObject({ role: 'admin' })
    delete process.env.ADMIN_EMAIL
    delete process.env.ADMIN_PASSWORD
  })

  it('resetPassword가 세션 없이 비밀번호를 바꾸고 그 사용자의 세션을 전부 죽인다', async () => {
    // 세션 둘을 만든다 — "전부"를 보려면 하나로는 부족하다. 하나만 지우는 구현도 통과해 버린다.
    const s1 = await loginAs(app, 'u1@test.dev', 'password-1')
    const s2 = await loginAs(app, 'u1@test.dev', 'password-1')
    const token = await seedResetToken()

    // 쿠키 없이 통과한다 — 유효한 토큰이 유일한 자격이다.
    const res = await postPublic(app, 'auth.resetPassword', { token, newPassword: 'password-x' })
    expect(res.statusCode).toBe(200)

    for (const s of [s1, s2]) {
      const me = await app.inject({
        method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: s },
      })
      expect(me.statusCode).toBe(401)
    }
    await expect(loginAs(app, 'u1@test.dev', 'password-1')).rejects.toThrow()
    await loginAs(app, 'u1@test.dev', 'password-x')
  })

  it('사용된 재설정 토큰은 재사용되지 않는다', async () => {
    const token = await seedResetToken()
    expect((await postPublic(app, 'auth.resetPassword', {
      token, newPassword: 'password-x',
    })).statusCode).toBe(200)

    const again = await postPublic(app, 'auth.resetPassword', {
      token, newPassword: 'password-y',
    })
    expect(again.statusCode).toBe(400)
    // 두 번째 시도가 아무것도 바꾸지 못했음을 확인한다 — 링크를 주운 사람이 뒤늦게
    // 비밀번호를 덮어쓸 수 있으면 1회용이 아니다.
    await loginAs(app, 'u1@test.dev', 'password-x')
  })

  it('만료된·없는 재설정 토큰은 거부되고 비밀번호가 그대로다', async () => {
    const stale = await seedResetToken({ expiresAt: new Date(Date.now() - 1000) })
    expect((await postPublic(app, 'auth.resetPassword', {
      token: stale, newPassword: 'password-x',
    })).statusCode).toBe(400)

    // 없는 토큰도 같은 400이다 — 문구가 갈리면 임의 토큰을 던져 존재 여부를 물을 수 있다.
    expect((await postPublic(app, 'auth.resetPassword', {
      token: 'erdd_rst_nope', newPassword: 'password-x',
    })).statusCode).toBe(400)

    await loginAs(app, 'u1@test.dev', 'password-1')
  })

  it('resetPassword가 다른 사용자의 세션은 건드리지 않는다', async () => {
    await createAccount(app.db!, {
      email: 'u2@test.dev', name: '사용자2', password: 'password-2', role: 'user',
    })
    const otherSession = await loginAs(app, 'u2@test.dev', 'password-2')
    const token = await seedResetToken()
    expect((await postPublic(app, 'auth.resetPassword', {
      token, newPassword: 'password-x',
    })).statusCode).toBe(200)

    // userId 조건 없이 세션을 지우면 남까지 로그아웃된다.
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: otherSession },
    })
    expect(me.statusCode).toBe(200)
    await loginAs(app, 'u2@test.dev', 'password-2')
    expect((await app.db!.select().from(users).where(eq(users.email, 'u2@test.dev')))[0]!.name)
      .toBe('사용자2')
  })

  it('normalizes email case on create and login', async () => {
    await createAccount(app.db!, {
      email: 'Mixed@Case.Dev', name: '혼합', password: 'password-9', role: 'user',
    })
    await loginAs(app, 'mixed@case.dev', 'password-9') // 소문자로 로그인 성공
    await expect(
      createAccount(app.db!, { email: 'MIXED@CASE.DEV', name: '중복', password: 'password-9', role: 'user' }),
    ).rejects.toThrow() // 대소문자만 다른 중복은 unique 위반
  })
})
