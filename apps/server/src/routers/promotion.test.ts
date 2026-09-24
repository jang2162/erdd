import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import {
  createEmptyModel, diffModels, MAX_LIBRARY_FILE_ITEMS, MAX_OPS_PER_MUTATION,
  type ProjectModel, type ServerMessage,
} from '@erdd/core'
import { resetDb } from '../testing/db.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { waitForLockWaiter } from '../testing/locks.js'
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

/**
 * 이 테스트의 오너·에디터와 아무 관계 없는 **다른 조직**에 대기 요청을 하나 만든다.
 *
 * 조직 경계를 잠그는 픽스처다 — 조직이 하나뿐인 DB에서는 listForOrg의 orgId 필터나
 * pendingCount의 멤버십 조인 조건을 통째로 지워도 결과가 같아 회귀가 잡히지 않는다.
 * 오너 계정을 따로 두어 ownerSession이 이 조직에 아무 권한도 갖지 않게 한다.
 */
async function seedForeignPendingRequest(app: FastifyInstance): Promise<void> {
  await createAccount(app.db!, { email: 'x@t.dev', name: '외부인', password: 'password-x', role: 'user' })
  const session = await loginAs(app, 'x@t.dev', 'password-x')
  const foreignOrgId = (await post(app, 'org.create', session, { name: '남의 팀' }))
    .json().result.data.id
  const foreignProjectId = (await post(app, 'project.create', session, {
    orgId: foreignOrgId, name: 'Q', dialects: ['postgresql'],
  })).json().result.data.id
  const foreignLibraryId = (await post(app, 'resource.library.create', session, {
    scope: 'org', orgId: foreignOrgId, name: '남의 표준',
  })).json().result.data.id
  const wordId = await seedWord(app, session, foreignProjectId, '상품', 'PRD')
  const res = await post(app, 'promotion.create', session, {
    projectId: foreignProjectId, libraryId: foreignLibraryId, entityIds: [wordId],
  })
  expect(res.statusCode).toBe(200)
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

  it('조직 승인 목록은 Org Owner/Admin만 볼 수 있고, 내 조직 것만 나온다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })
    // 오너가 아무 권한도 없는 다른 조직의 대기 요청 — 목록에 새어 나오면 안 된다.
    await seedForeignPendingRequest(app)

    const denied = await get(app, 'promotion.listForOrg', editorSession, { orgId })
    expect(denied.statusCode).toBe(403)

    const allowed = await get(app, 'promotion.listForOrg', ownerSession, { orgId })
    expect(allowed.statusCode).toBe(200)
    const rows = allowed.json().result.data as Array<{
      projectId: string; projectName: string; requesterName: string
      itemCount: number; libraryName: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.projectId).toBe(projectId)
    expect(rows[0]).toMatchObject({
      projectName: 'P', requesterName: '에디터', itemCount: 1, libraryName: '조직 표준',
    })
  })

  it('get이 지금 계산한 계획을 내려주고, 그새 승격된 항목은 unavailable로 뺀다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const otherId = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    // 요청에 넣지 않는 단어. 계획에는 남아 있으므로, entries가 계획 전체가 아니라
    // 요청에 담긴 것만 담는지 잠근다 — 아니면 승인자가 요청되지 않은 항목까지 보게 된다.
    await seedWord(app, editorSession, projectId, '상품', 'PRD')
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
      request: { note: string; projectName: string; requesterName: string }
    }
    expect(data.unavailable).toEqual([wordId])
    expect(data.entries.map((e) => e.entityId)).toEqual([otherId])
    expect(data.entries[0]).toMatchObject({ status: 'new', name: '주문' })
    expect(data.request).toMatchObject({ projectName: 'P', requesterName: '에디터' })
  })

  it('get은 라이브러리 쓰기 권한이 있어야 한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const res = await get(app, 'promotion.get', editorSession, { requestId })
    expect(res.statusCode).toBe(403)
  })

  it('resolve는 라이브러리 쓰기 권한이 있어야 한다 — 요청자는 자기 요청을 승인할 수 없다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    // 권한 검사가 승인/반려 분기보다 앞에 있으므로 반려 호출로도 게이트가 잠긴다.
    // Editor는 requireProjectAccess(edit)는 통과하지만 requireLibraryWrite에서 막혀야 한다.
    const res = await post(app, 'promotion.resolve', editorSession, { requestId, approve: [] })
    expect(res.statusCode).toBe(403)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string }>
    expect(rows[0]!.status).toBe('pending')
  })

  it('pendingCount는 내가 Owner/Admin인 조직의 것만 센다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })
    // 오너가 멤버가 아닌 조직의 대기 요청 — 멤버십 조인이 조직을 맞춰 보지 않으면 함께 세어진다.
    await seedForeignPendingRequest(app)

    const forOwner = await get(app, 'promotion.pendingCount', ownerSession)
    expect(forOwner.json().result.data).toMatchObject({
      total: 1, byOrg: [{ orgId, count: 1 }],
    })

    // 에디터는 같은 조직의 Member라 셀 것이 없다.
    const forEditor = await get(app, 'promotion.pendingCount', editorSession)
    expect(forEditor.json().result.data).toMatchObject({ total: 0, byOrg: [] })
  })

  it('승인하면 라이브러리에 쓰이고 요청이 resolved가 된다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: plan.entries.map((e) => ({
        entityId: e.entityId, expectedStatus: e.status,
        expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
      })),
      note: '좋습니다',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({
      status: 'resolved', inserted: 1, updated: 0, skipped: [],
    })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(1)
    expect(items[0]!.payload).toMatchObject({ logicalName: '회원', abbreviation: 'MBR' })

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{
        status: string; approvedEntityIds: string[] | null; resolutionNote: string
      }>
    expect(rows[0]).toMatchObject({
      status: 'resolved', approvedEntityIds: [wordId], resolutionNote: '좋습니다',
    })
  })

  it('부분 승인 — 고르지 않은 항목은 올라가지 않고 요청은 한 번에 닫힌다', async () => {
    const a = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const b = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [a, b],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const only = plan.entries.find((e) => e.entityId === a)!

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: only.entityId, expectedStatus: only.status,
        expectedTargetItemId: only.targetItemId, expectedTargetVersion: only.targetVersion,
      }],
    })
    expect(res.json().result.data).toMatchObject({ status: 'resolved', inserted: 1 })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(1)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; approvedEntityIds: string[] | null }>
    expect(rows[0]).toMatchObject({ status: 'resolved', approvedEntityIds: [a] })
  })

  it('반려는 모델을 건드리지 않는다 — Revision이 생기지 않고 seq가 그대로다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const before = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId, approve: [], note: '아직 이릅니다',
    })
    expect(res.json().result.data).toMatchObject({
      status: 'rejected', seq: null, inserted: 0, updated: 0,
    })

    const after = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    expect(after).toBe(before)
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; resolutionNote: string }>
    expect(rows[0]).toMatchObject({ status: 'rejected', resolutionNote: '아직 이릅니다' })
  })

  it('두 번째 처리는 CONFLICT다 — 요청은 한 번만 닫힌다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const first = await post(app, 'promotion.resolve', ownerSession, { requestId, approve: [] })
    expect(first.statusCode).toBe(200)
    const second = await post(app, 'promotion.resolve', ownerSession, { requestId, approve: [] })
    expect(second.statusCode).toBe(409)
  })

  it('요청에 없는 항목은 승인 목록에 넣을 수 없다', async () => {
    const a = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const b = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [a],
    })).json().result.data.id

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: b, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
    expect(res.statusCode).toBe(400)

    // 거절됐으므로 요청은 그대로 pending이고 라이브러리도 비어 있다.
    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string }>
    expect(rows[0]!.status).toBe('pending')
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)
  })

  it('기대치가 낡은 항목은 skip되고 approvedEntityIds에서 빠진다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const entry = plan.entries[0]!

    // 그 사이 Owner가 직접 승격해 상태가 new에서 벗어난다.
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{
        entityId: wordId, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: entry.entityId, expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId, expectedTargetVersion: entry.targetVersion,
      }],
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data as {
      status: string; inserted: number; skipped: Array<{ entityId: string; reason: string }>
    }
    // 승인자의 의사는 승인이었으므로 resolved다(§3.1). 실제 승격은 0건이다.
    expect(data.status).toBe('resolved')
    expect(data.inserted).toBe(0)
    expect(data.skipped).toEqual([{ entityId: wordId, reason: 'missing' }])

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ approvedEntityIds: string[] | null }>
    expect(rows[0]!.approvedEntityIds).toEqual([])
  })

  it('이미 처리된 요청을 다시 승인해도 라이브러리에 아무것도 쓰이지 않는다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const approve = plan.entries.map((e) => ({
      entityId: e.entityId, expectedStatus: e.status,
      expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
    }))

    // 먼저 반려해 요청을 닫는다.
    expect((await post(app, 'promotion.resolve', ownerSession, {
      requestId, approve: [],
    })).statusCode).toBe(200)

    // 닫힌 요청에 대한 승인은 CONFLICT이고, 라이브러리는 그대로 비어 있어야 한다.
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(409)
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)
  })

  it('승인이 origin update op를 실시간 채널로 발행한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const entry = plan.entries[0]!

    // resource-promote.test.ts의 '승격이 실시간 채널로 발행된다'와 같은 셋업이다.
    const received: ServerMessage[] = []
    app.hub.subscribe(projectId, {
      userId: 'observer', name: '구독자',
      send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) },
    })
    received.length = 0

    await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: entry.entityId, expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId, expectedTargetVersion: entry.targetVersion,
      }],
    })

    const opsMsg = received.find((m) => m.type === 'ops')
    expect(opsMsg).toBeDefined()
    // 어떤 op든 하나 나갔는지가 아니라, 그 단어의 origin이 채워졌는지를 본다.
    const originOp = opsMsg!.ops.find(
      (op) => op.action === 'update' && op.entity === 'word' && op.entityId === wordId,
    )
    expect(originOp).toBeDefined()
    expect(originOp!.action).toBe('update')
    const changes = (originOp as { changes: Record<string, { from: unknown; to: unknown }> }).changes
    expect(Object.keys(changes)).toEqual(['origin'])
    expect(changes.origin!.from).toBeNull()
    expect(changes.origin!.to).toMatchObject({ libraryId })
  })

  /**
   * 동시 처리 — 두 요청을 같은 시각에 쏘면 서로 다른 pg 커넥션을 잡고, runMutation의
   * `SELECT id FROM projects … FOR UPDATE`가 같은 프로젝트 행에서 직렬화한다.
   * 어느 쪽이 이기는지는 정하지 않고 **결과의 대칭성**만 단언하므로 flaky하지 않다.
   */
  it('두 승인이 동시에 들어와도 한 번만 승격된다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const approve = plan.entries.map((e) => ({
      entityId: e.entityId, expectedStatus: e.status,
      expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
    }))

    const [a, b] = await Promise.all([
      post(app, 'promotion.resolve', ownerSession, { requestId, approve }),
      post(app, 'promotion.resolve', ownerSession, { requestId, approve }),
    ])
    // 하나는 성공하고 하나는 락 안 pending 확인에 걸려 CONFLICT다.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])

    // 진 쪽이 두 번째 승격을 시도했다면 항목이 2개가 되거나 버전이 올라간다.
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(1)
    expect(items[0]!.version).toBe(1)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; approvedEntityIds: string[] | null }>
    expect(rows[0]).toMatchObject({ status: 'resolved', approvedEntityIds: [wordId] })
  })

  /**
   * cancel의 읽기와 쓰기 사이에 승인이 끼어드는 경합을 **결정적으로** 재현한다.
   *
   * `Promise.all`로 cancel과 resolve를 동시에 쏘는 형태로는 이 창이 너무 좁아 재현되지 않는다
   * (실제로 그 형태에서는 조건부 where를 되돌려도 테스트가 통과했다). 그래서 요청 행을 밖에서
   * FOR UPDATE로 잠가 cancel의 UPDATE를 붙들어 두고, 그 사이 승인 결과를 써넣은 뒤 풀어 준다.
   */
  it('cancel이 그 사이 기록된 승인 결과를 덮어쓰지 않는다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const client = await app.pgPool!.connect()
    let cancelRes: Awaited<ReturnType<typeof post>>
    try {
      await client.query('BEGIN')
      // 요청 행을 잠근다 — 이제 cancel의 UPDATE는 여기서 대기한다.
      await client.query('SELECT id FROM promotion_requests WHERE id = $1 FOR UPDATE', [requestId])

      // cancel은 사전 확인(pending)을 통과한 뒤 UPDATE에서 막힌다.
      const pendingCancel = post(app, 'promotion.cancel', editorSession, { requestId })
      // 고정 sleep으로 넘어가면 안 된다 — 느린 환경에서 cancel의 사전 확인이 아래 COMMIT
      // **뒤에** 도착하면 거기서 이미 409를 내고 UPDATE에 닿지 않는데, 두 경로가 같은 상태·
      // 같은 메시지를 내므로 마지막 단언이 그대로 성립한다(조용한 거짓 통과). cancel이 실제로
      // 이 트랜잭션의 락을 기다리는 것을 확인하고 진행하면 그 경우가 타임아웃 실패로 바뀐다.
      await waitForLockWaiter(client)

      // 그 사이 승인이 끝난 것처럼 요청 행을 종결한다(라이브러리 쓰기는 이 테스트의 관심이 아니다).
      await client.query(
        `UPDATE promotion_requests
           SET status = 'resolved', resolved_by = requester_id, resolved_at = now(),
               approved_entity_ids = $2::jsonb
         WHERE id = $1`,
        [requestId, JSON.stringify([wordId])],
      )
      await client.query('COMMIT')

      cancelRes = await pendingCancel
    } finally {
      // 위에서 무엇이든 던지면 BEGIN한 트랜잭션이 열린 채로 남는다. node-postgres 풀은
      // release 시 자동 롤백하지 않으므로, 요청 행 락을 쥔 커넥션이 앱 풀로 돌아가
      // 다음 beforeEach의 TRUNCATE(ACCESS EXCLUSIVE)가 거기 걸려 스위트가 멎는다.
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }

    // 깨어난 cancel은 status='pending' 조건에 걸려 0행을 갱신하고 CONFLICT를 낸다.
    expect(cancelRes.statusCode).toBe(409)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; approvedEntityIds: string[] | null }>
    // 승인 기록이 그대로 남아 있어야 한다 — 덮어쓰였다면 'cancelled'가 된다.
    expect(rows[0]).toMatchObject({ status: 'resolved', approvedEntityIds: [wordId] })
  })

  it('승격 요청은 5,000건을 넘는 entityIds 를 입력 검증에서 막지 않는다 — 계획에 없는 id 는 빠진다', async () => {
    // 요청은 id 목록을 저장할 뿐이라 모델 op 상한과 무관하다. 5,001건을 실제로 심지 않고, 유효한 1건과
    // 계획에 없는 5,000건을 섞어 「zod 가 받았는가」만 본다 — 받았으면 계획에 없는 것만 dropped 로 빠진다.
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const entityIds = [wordId, ...Array.from({ length: MAX_OPS_PER_MUTATION }, () => uuidv7())]
    const res = await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.requested).toBe(1)
    expect(res.json().result.data.dropped).toHaveLength(MAX_OPS_PER_MUTATION)
  })

  it(`승격 요청은 ${MAX_LIBRARY_FILE_ITEMS}건을 넘으면 거절한다`, async () => {
    const entityIds = Array.from({ length: MAX_LIBRARY_FILE_ITEMS + 1 }, () => uuidv7())
    const res = await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds })
    expect(res.statusCode).toBe(400)
  })

  it('승인도 5,000건을 넘는 approve 를 입력 검증에서 막지 않는다 — 요청에 없는 항목이라 핸들러가 거절한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id as string
    const approve = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, () => ({
      entityId: uuidv7(), expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
    }))
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(400)
    // 입력 검증(zod)에서 막혔다면 이 문구가 아니다 — 핸들러까지 들어갔다는 증거다.
    expect(res.json().error.message).toBe('요청에 없는 항목은 승인할 수 없습니다')
  })

  it(`승인은 ${MAX_LIBRARY_FILE_ITEMS}건을 넘는 approve 를 입력 검증에서 거절한다`, async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id as string
    const approve = Array.from({ length: MAX_LIBRARY_FILE_ITEMS + 1 }, () => ({
      entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
    }))
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).not.toBe('요청에 없는 항목은 승인할 수 없습니다')
  })
})
