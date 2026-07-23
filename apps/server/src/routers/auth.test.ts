import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount, ensureBootstrapAdmin } from '../services/accounts.js'
import { organizations } from '../db/schema.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('auth', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'u1@test.dev', name: '사용자1', password: 'password-1', role: 'user',
    })
  })

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
})
