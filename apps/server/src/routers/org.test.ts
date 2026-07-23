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

describe.skipIf(!url)('org', () => {
  let app: FastifyInstance
  let ownerToken: string
  let plainToken: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@test.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'p@test.dev', name: '일반', password: 'password-p', role: 'user' })
    ownerToken = await loginAs(app, 'o@test.dev', 'password-o')
    plainToken = await loginAs(app, 'p@test.dev', 'password-p')
  })

  async function createTeam(): Promise<string> {
    const res = await post(app, 'org.create', ownerToken, { name: '팀A' })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.id as string
  }

  it('create team org and list shows personal + team with roles', async () => {
    await createTeam()
    const res = await get(app, 'org.list', ownerToken)
    const orgs = res.json().result.data as Array<{ kind: string; role: string }>
    expect(orgs).toHaveLength(2)
    expect(orgs.map((o) => o.kind).sort()).toEqual(['personal', 'team'])
    expect(orgs.every((o) => o.role === 'owner')).toBe(true)
  })

  it('adds a member by email; personal org rejects member add', async () => {
    const orgId = await createTeam()
    const add = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'p@test.dev', role: 'member',
    })
    expect(add.statusCode).toBe(200)

    const list = await get(app, 'org.list', plainToken)
    expect((list.json().result.data as unknown[]).length).toBe(2) // 개인 + 팀A

    const personal = (await get(app, 'org.list', ownerToken)).json().result.data
      .find((o: { kind: string }) => o.kind === 'personal')
    const bad = await post(app, 'org.members.add', ownerToken, {
      orgId: personal.id, email: 'p@test.dev', role: 'member',
    })
    expect(bad.statusCode).toBe(403)
  })

  it('plain member cannot add members; unknown email is 404; duplicate is 409', async () => {
    const orgId = await createTeam()
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'p@test.dev', role: 'member' })

    const forbidden = await post(app, 'org.members.add', plainToken, {
      orgId, email: 'o@test.dev', role: 'member',
    })
    expect(forbidden.statusCode).toBe(403)

    const notFound = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'ghost@test.dev', role: 'member',
    })
    expect(notFound.statusCode).toBe(404)

    const dup = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'p@test.dev', role: 'member',
    })
    expect(dup.statusCode).toBe(409)
  })

  it('protects the last owner from demotion and removal', async () => {
    const orgId = await createTeam()
    const membersRes = await get(app, 'org.members.list', ownerToken, { orgId })
    const ownerMember = (membersRes.json().result.data as Array<{ id: string; role: string }>)
      .find((m) => m.role === 'owner')!

    const demote = await post(app, 'org.members.setRole', ownerToken, {
      orgId, memberId: ownerMember.id, role: 'member',
    })
    expect(demote.statusCode).toBe(400)

    const remove = await post(app, 'org.members.remove', ownerToken, {
      orgId, memberId: ownerMember.id,
    })
    expect(remove.statusCode).toBe(400)
  })

  it('org admin (non-owner) cannot grant owner role', async () => {
    const orgId = await createTeam()
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'p@test.dev', role: 'admin' })
    const orgMembers = (await get(app, 'org.members.list', ownerToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const p = orgMembers.find((m) => m.email === 'p@test.dev')!

    const res = await post(app, 'org.members.setRole', plainToken, {
      orgId, memberId: p.id, role: 'owner',
    })
    expect(res.statusCode).toBe(403)
  })
})
