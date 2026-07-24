import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

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

function noteCreateOp() {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

describe.skipIf(!url)('revision', () => {
  let app: FastifyInstance
  let token: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    token = await loginAs(app, 'o@t.dev', 'password-o')
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
  })

  it('lists revisions newest-first with actor name and paginates by cursor', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await post(app, 'model.mutate', token, { projectId, ops: [noteCreateOp()] })
      expect(res.statusCode).toBe(200)
    }
    const page1 = (await get(app, 'revision.list', token, { projectId, limit: 2 }))
      .json().result.data
    expect(page1.items.map((r: { seq: number }) => r.seq)).toEqual([3, 2])
    expect(page1.items[0].actorName).toBe('오너')
    expect(page1.items[0].summary).toBe('메모 생성')
    expect(page1.nextCursor).toBe(2)

    const page2 = (await get(app, 'revision.list', token, {
      projectId, limit: 2, cursor: page1.nextCursor,
    })).json().result.data
    expect(page2.items.map((r: { seq: number }) => r.seq)).toEqual([1])
    expect(page2.nextCursor).toBeNull()
  })

  it('denies non-members', async () => {
    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const res = await get(app, 'revision.list', outsider, { projectId })
    expect([403, 404]).toContain(res.statusCode)
  })
})
