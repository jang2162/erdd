import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
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

describe.skipIf(!url)('project', () => {
  let app: FastifyInstance
  let ownerToken: string
  let memberToken: string
  let orgId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@test.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'm@test.dev', name: '멤버', password: 'password-m', role: 'user' })
    ownerToken = await loginAs(app, 'o@test.dev', 'password-o')
    memberToken = await loginAs(app, 'm@test.dev', 'password-m')
    orgId = (await post(app, 'org.create', ownerToken, { name: '팀A' })).json().result.data.id
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'm@test.dev', role: 'member' })
  })

  async function createProject(): Promise<string> {
    const res = await post(app, 'project.create', ownerToken, {
      orgId, name: '주문시스템', dialects: ['postgresql'],
    })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.id as string
  }

  it('org owner creates a project and sees it; plain member sees none until added', async () => {
    const projectId = await createProject()
    const ownerList = (await get(app, 'project.list', ownerToken, { orgId })).json().result.data
    expect(ownerList).toHaveLength(1)

    const memberList = (await get(app, 'project.list', memberToken, { orgId })).json().result.data
    expect(memberList).toHaveLength(0)

    const denied = await get(app, 'project.get', memberToken, { projectId })
    expect(denied.statusCode).toBe(403)
  })

  it('plain org member cannot create a project', async () => {
    const res = await post(app, 'project.create', memberToken, {
      orgId, name: 'X', dialects: ['mysql'],
    })
    expect(res.statusCode).toBe(403)
  })

  it('project member with viewer role can read but not update', async () => {
    const projectId = await createProject()
    const orgMembers = (await get(app, 'org.members.list', ownerToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const m = orgMembers.find((x) => x.email === 'm@test.dev')!

    await post(app, 'project.members.add', ownerToken, {
      projectId, memberId: m.id, role: 'viewer',
    })
    const got = await get(app, 'project.get', memberToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.myRole).toBe('viewer')

    const upd = await post(app, 'project.update', memberToken, { projectId, name: '변경' })
    expect(upd.statusCode).toBe(403)
  })

  it('update validates dialects and delete removes the project', async () => {
    const projectId = await createProject()
    const badDialect = await post(app, 'project.update', ownerToken, {
      projectId, dialects: ['nosql'],
    })
    expect(badDialect.statusCode).toBe(400)

    const upd = await post(app, 'project.update', ownerToken, {
      projectId, name: '주문시스템v2', dialects: ['postgresql', 'oracle'],
    })
    expect(upd.statusCode).toBe(200)

    const del = await post(app, 'project.delete', ownerToken, { projectId })
    expect(del.statusCode).toBe(200)
    const list = (await get(app, 'project.list', ownerToken, { orgId })).json().result.data
    expect(list).toHaveLength(0)
  })
})
