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
    const adminMember = await createAccount(app.db!, { email: 'orgadmin@t.dev', name: 'OA', password: 'pw-123456', role: 'user' })
    await createAccount(app.db!, { email: 'out@t.dev', name: 'X', password: 'pw-123456', role: 'user' })
    const orgId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '팀', kind: 'team' })
    await app.db!.insert(members).values([
      { id: uuidv7(), orgId, userId: owner.id, role: 'owner' },
      { id: uuidv7(), orgId, userId: memberUser.id, role: 'member' },
      { id: uuidv7(), orgId, userId: adminMember.id, role: 'admin' },
    ])
    const ownerToken = await loginAs(app, 'owner@t.dev', 'pw-123456')
    const memberToken = await loginAs(app, 'mem@t.dev', 'pw-123456')
    const orgAdminToken = await loginAs(app, 'orgadmin@t.dev', 'pw-123456')
    const outsiderToken = await loginAs(app, 'out@t.dev', 'pw-123456')

    expect((await post(app, 'resource.library.create', memberToken, {
      scope: 'org', orgId, name: '조직표준',
    })).statusCode).toBe(403)
    const created = await post(app, 'resource.library.create', ownerToken, {
      scope: 'org', orgId, name: '조직표준',
    })
    expect(created.statusCode).toBe(200)

    // 조직 role='admin' 멤버도 owner와 동등하게 조직 라이브러리를 만들 수 있어야 한다.
    const adminCreated = await post(app, 'resource.library.create', orgAdminToken, {
      scope: 'org', orgId, name: '조직표준2',
    })
    expect(adminCreated.statusCode).toBe(200)

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

  it('listForProject는 전역 + 프로젝트 소속 조직의 라이브러리만 반환하고, 타 조직 라이브러리는 새지 않는다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const ownerA = await createAccount(app.db!, { email: 'ownerA@t.dev', name: 'OA', password: 'pw-123456', role: 'user' })
    const ownerB = await createAccount(app.db!, { email: 'ownerB@t.dev', name: 'OB', password: 'pw-123456', role: 'user' })
    await createAccount(app.db!, { email: 'out@t.dev', name: 'X', password: 'pw-123456', role: 'user' })

    const adminToken = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const ownerAToken = await loginAs(app, 'ownerA@t.dev', 'pw-123456')
    const ownerBToken = await loginAs(app, 'ownerB@t.dev', 'pw-123456')
    const outsiderToken = await loginAs(app, 'out@t.dev', 'pw-123456')

    const orgAId = uuidv7()
    const orgBId = uuidv7()
    await app.db!.insert(organizations).values([
      { id: orgAId, name: '팀A', kind: 'team' },
      { id: orgBId, name: '팀B', kind: 'team' },
    ])
    await app.db!.insert(members).values([
      { id: uuidv7(), orgId: orgAId, userId: ownerA.id, role: 'owner' },
      { id: uuidv7(), orgId: orgBId, userId: ownerB.id, role: 'owner' },
    ])

    const globalLib = (await post(app, 'resource.library.create', adminToken, {
      scope: 'global', name: '전역',
    })).json().result.data
    const libA = (await post(app, 'resource.library.create', ownerAToken, {
      scope: 'org', orgId: orgAId, name: '팀A표준',
    })).json().result.data
    const libB = (await post(app, 'resource.library.create', ownerBToken, {
      scope: 'org', orgId: orgBId, name: '팀B표준',
    })).json().result.data

    const projectId = (await post(app, 'project.create', ownerAToken, {
      orgId: orgAId, name: '프로젝트A', dialects: ['postgresql'],
    })).json().result.data.id as string

    const listed = await get(app, 'resource.library.listForProject', ownerAToken, { projectId })
    expect(listed.statusCode).toBe(200)
    const ids = (listed.json().result.data as Array<{ id: string }>).map((r) => r.id)
    expect(ids.sort()).toEqual([globalLib.id, libA.id].sort())
    expect(ids).not.toContain(libB.id)

    const denied = await get(app, 'resource.library.listForProject', outsiderToken, { projectId })
    expect(denied.statusCode).toBe(403)
  })

  it('조직 라이브러리 항목은 조직 쓰기 권한이 없으면 수정·삭제가 거부되고, 외부인은 목록도 볼 수 없다', async () => {
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

    const lib = (await post(app, 'resource.library.create', ownerToken, {
      scope: 'org', orgId, name: '조직표준',
    })).json().result.data
    const item = (await post(app, 'resource.items.create', ownerToken, {
      libraryId: lib.id, kind: 'word', payload: WORD,
    })).json().result.data

    const memberUpdate = await post(app, 'resource.items.update', memberToken, {
      itemId: item.id, payload: { ...WORD, abbreviation: 'X' },
    })
    expect(memberUpdate.statusCode).toBe(403)

    const memberRemove = await post(app, 'resource.items.remove', memberToken, { itemId: item.id })
    expect(memberRemove.statusCode).toBe(403)

    const outsiderList = await get(app, 'resource.items.list', outsiderToken, { libraryId: lib.id })
    expect(outsiderList.statusCode).toBe(403)

    const memberList = await get(app, 'resource.items.list', memberToken, { libraryId: lib.id })
    expect(memberList.statusCode).toBe(200)
  })
})
