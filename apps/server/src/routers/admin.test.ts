import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { organizations, users } from '../db/schema.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

describe.skipIf(!url)('admin.users', () => {
  let app: FastifyInstance
  let adminToken: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'admin@test.dev', name: '관리자', password: 'admin-pass-1', role: 'admin',
    })
    adminToken = await loginAs(app, 'admin@test.dev', 'admin-pass-1')
  })

  it('create makes a user with a personal org; duplicate email conflicts', async () => {
    const res = await post(app, 'admin.users.create', adminToken, {
      email: 'u1@test.dev', name: '사용자1', initialPassword: 'password-1',
    })
    expect(res.statusCode).toBe(200)
    await loginAs(app, 'u1@test.dev', 'password-1')
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(2) // 관리자 개인 조직 + 신규 개인 조직

    const dup = await post(app, 'admin.users.create', adminToken, {
      email: 'u1@test.dev', name: '중복', initialPassword: 'password-1',
    })
    expect(dup.statusCode).toBe(409)
  })

  it('rejects non-admin callers with 403', async () => {
    await createAccount(app.db!, {
      email: 'u2@test.dev', name: '일반', password: 'password-2', role: 'user',
    })
    const token = await loginAs(app, 'u2@test.dev', 'password-2')
    const res = await app.inject({
      method: 'GET', url: '/trpc/admin.users.list', cookies: { erdd_session: token },
    })
    expect(res.statusCode).toBe(403)
  })

  it('resetPassword replaces the password and kills sessions', async () => {
    await createAccount(app.db!, {
      email: 'u3@test.dev', name: '사용자3', password: 'password-3', role: 'user',
    })
    const userToken = await loginAs(app, 'u3@test.dev', 'password-3')
    const target = (await app.db!.select().from(users).where(eq(users.email, 'u3@test.dev')))[0]!
    const res = await post(app, 'admin.users.resetPassword', adminToken, {
      userId: target.id, newPassword: 'password-x',
    })
    expect(res.statusCode).toBe(200)
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: userToken },
    })
    expect(me.statusCode).toBe(401) // 세션 무효화됨
    await loginAs(app, 'u3@test.dev', 'password-x')
  })

  it('setActive(false) blocks login and self-deactivation is rejected', async () => {
    await createAccount(app.db!, {
      email: 'u4@test.dev', name: '사용자4', password: 'password-4', role: 'user',
    })
    const target = (await app.db!.select().from(users).where(eq(users.email, 'u4@test.dev')))[0]!
    const res = await post(app, 'admin.users.setActive', adminToken, {
      userId: target.id, isActive: false,
    })
    expect(res.statusCode).toBe(200)
    await expect(loginAs(app, 'u4@test.dev', 'password-4')).rejects.toThrow()

    const admin = (await app.db!.select().from(users).where(eq(users.email, 'admin@test.dev')))[0]!
    const self = await post(app, 'admin.users.setActive', adminToken, {
      userId: admin.id, isActive: false,
    })
    expect(self.statusCode).toBe(400)
  })
})
