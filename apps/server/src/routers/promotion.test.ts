import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel } from '@erdd/core'
import { resetDb } from '../testing/db.js'
import { resourceLibraries } from '../db/schema.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, session: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, session: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: session } })
}

/** 프로젝트에 단어 하나를 만들고 그 id를 돌려준다. */
async function seedWord(
  app: FastifyInstance, session: string, projectId: string,
  logicalName: string, abbreviation: string,
): Promise<string> {
  const id = uuidv7()
  const next: ProjectModel = {
    ...createEmptyModel(),
    words: { [id]: { id, logicalName, abbreviation, englishName: null, description: null, origin: null } },
  }
  const res = await post(app, 'model.mutate', session, {
    projectId, ops: diffModels(createEmptyModel(), next), summary: '단어 추가',
  })
  expect(res.statusCode).toBe(200)
  return id
}

describe.skipIf(!url)('promotion', () => {
  let app: FastifyInstance
  let ownerSession: string      // Org Owner — 라이브러리 쓰기 권한 있음(승인자)
  let editorSession: string     // Org Member + Project Editor — 요청자
  let orgId: string
  let projectId: string
  let libraryId: string
  let globalLibraryId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    // 전역 라이브러리 시드(ensureStarterGlobalLibrary)는 부팅에서만 돌고 createTestApp은 부르지
    // 않는다. resetDb가 resource_libraries를 비우기도 하므로 빈 전역 라이브러리를 직접 만든다 —
    // 이 테스트에 필요한 것은 "scope='global'인 라이브러리가 하나 있다"는 사실뿐이다.
    globalLibraryId = uuidv7()
    await app.db!.insert(resourceLibraries).values({
      id: globalLibraryId, scope: 'global', orgId: null, name: '표준 사전', description: '',
    })
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'e@t.dev', name: '에디터', password: 'password-e', role: 'user' })
    ownerSession = await loginAs(app, 'o@t.dev', 'password-o')
    editorSession = await loginAs(app, 'e@t.dev', 'password-e')
    orgId = (await post(app, 'org.create', ownerSession, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', ownerSession, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'e@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'e@t.dev')!.id, role: 'editor',
    })
    libraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId, name: '조직 표준',
    })).json().result.data.id
  })

  it('Editor가 조직 라이브러리로 승격을 요청한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const res = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId], note: '조직 표준으로 올려 주세요',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ requested: 1, dropped: [] })

    const list = await get(app, 'promotion.listForProject', editorSession, { projectId })
    const rows = list.json().result.data as Array<{
      id: string; status: string; entityIds: string[]; note: string; requesterName: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'pending', entityIds: [wordId], note: '조직 표준으로 올려 주세요', requesterName: '에디터',
    })
  })

  it('계획에 없는 entityId는 dropped로 걸러내고, 전부 걸러지면 거절한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const ghost = uuidv7()
    const ok = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId, ghost],
    })
    expect(ok.json().result.data).toMatchObject({ requested: 1, dropped: [ghost] })

    const bad = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [uuidv7()],
    })
    expect(bad.statusCode).toBe(400)
  })

  it('전역 라이브러리로는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const res = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId: globalLibraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(400)
  })

  it('다른 조직의 라이브러리로는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const otherOrgId = (await post(app, 'org.create', ownerSession, { name: '남의 팀' }))
      .json().result.data.id
    const otherLibraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId: otherOrgId, name: '남의 표준',
    })).json().result.data.id
    const res = await post(app, 'promotion.create', ownerSession, {
      projectId, libraryId: otherLibraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(403)
  })

  it('Viewer는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await createAccount(app.db!, { email: 'v@t.dev', name: '뷰어', password: 'password-v', role: 'user' })
    const viewerSession = await loginAs(app, 'v@t.dev', 'password-v')
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'v@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'v@t.dev')!.id, role: 'viewer',
    })
    const res = await post(app, 'promotion.create', viewerSession, {
      projectId, libraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(403)
  })

  it('요청자는 자기 요청을 취소할 수 있고, 취소된 요청은 다시 취소되지 않는다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const first = await post(app, 'promotion.cancel', editorSession, { requestId })
    expect(first.statusCode).toBe(200)
    const second = await post(app, 'promotion.cancel', editorSession, { requestId })
    expect(second.statusCode).toBe(409)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string }>
    expect(rows[0]!.status).toBe('cancelled')
  })

  it('조직 승인 목록은 Org Owner/Admin만 볼 수 있다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })

    const denied = await get(app, 'promotion.listForOrg', editorSession, { orgId })
    expect(denied.statusCode).toBe(403)

    const allowed = await get(app, 'promotion.listForOrg', ownerSession, { orgId })
    expect(allowed.statusCode).toBe(200)
    const rows = allowed.json().result.data as Array<{
      projectName: string; requesterName: string; itemCount: number; libraryName: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      projectName: 'P', requesterName: '에디터', itemCount: 1, libraryName: '조직 표준',
    })
  })

  it('get이 지금 계산한 계획을 내려주고, 그새 승격된 항목은 unavailable로 뺀다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const otherId = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId, otherId],
    })).json().result.data.id

    // 요청과 승인 사이에 Owner가 wordId를 직접 승격해 버린다.
    const direct = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{
        entityId: wordId, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
    expect(direct.statusCode).toBe(200)

    const res = await get(app, 'promotion.get', ownerSession, { requestId })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data as {
      entries: Array<{ entityId: string; status: string; name: string }>
      unavailable: string[]
      request: { note: string; projectName: string }
    }
    expect(data.unavailable).toEqual([wordId])
    expect(data.entries.map((e) => e.entityId)).toEqual([otherId])
    expect(data.entries[0]).toMatchObject({ status: 'new', name: '주문' })
  })

  it('get은 라이브러리 쓰기 권한이 있어야 한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const res = await get(app, 'promotion.get', editorSession, { requestId })
    expect(res.statusCode).toBe(403)
  })

  it('pendingCount는 내가 Owner/Admin인 조직의 것만 센다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })

    const forOwner = await get(app, 'promotion.pendingCount', ownerSession)
    expect(forOwner.json().result.data).toMatchObject({
      total: 1, byOrg: [{ orgId, count: 1 }],
    })

    // 에디터는 같은 조직의 Member라 셀 것이 없다.
    const forEditor = await get(app, 'promotion.pendingCount', editorSession)
    expect(forEditor.json().result.data).toMatchObject({ total: 0, byOrg: [] })
  })
})
