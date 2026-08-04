import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel, type ServerMessage } from '@erdd/core'
import { resourceItems } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
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

describe.skipIf(!url)('resource.promote', () => {
  let app: FastifyInstance
  let ownerSession: string
  let memberSession: string
  let orgId: string
  let projectId: string
  let libraryId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'm@t.dev', name: '멤버', password: 'password-m', role: 'user' })
    ownerSession = await loginAs(app, 'o@t.dev', 'password-o')
    memberSession = await loginAs(app, 'm@t.dev', 'password-m')
    orgId = (await post(app, 'org.create', ownerSession, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', ownerSession, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'm@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'm@t.dev')!.id, role: 'editor',
    })
    libraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId, name: '조직 표준',
    })).json().result.data.id
  })

  it('새 항목을 라이브러리에 만들고 프로젝트 항목에 origin을 붙인다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ inserted: 1, updated: 0, skipped: [] })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId)).orderBy(asc(resourceItems.createdAt))
    expect(items).toHaveLength(1)
    expect(items[0]!.version).toBe(1)
    expect(items[0]!.payload).toMatchObject({ logicalName: '회원', abbreviation: 'MBR' })

    const model = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data
      .model as ProjectModel
    expect(model.words[wordId]!.origin).toMatchObject({
      libraryId, sourceId: items[0]!.id, sourceVersion: 1,
    })
  })

  it('이미 링크된 항목을 고쳐 올리면 원본 버전이 오른다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const itemId = (await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId)))[0]!.id

    // 프로젝트에서 약어를 고친 뒤 다시 승격한다
    const before = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data
      .model as ProjectModel
    const after: ProjectModel = {
      ...before, words: { [wordId]: { ...before.words[wordId]!, abbreviation: 'MEM' } },
    }
    await post(app, 'model.mutate', ownerSession, {
      projectId, ops: diffModels(before, after), summary: '약어 수정',
    })
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'update', expectedTargetItemId: itemId }],
    })
    expect(res.json().result.data).toMatchObject({ inserted: 0, updated: 1, skipped: [] })

    const item = (await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.id, itemId)))[0]!
    expect(item.version).toBe(2)
    expect(item.payload).toMatchObject({ abbreviation: 'MEM' })
  })

  it('클라가 본 계획과 서버 재계산이 다르면 그 항목만 건너뛴다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      // 실제로는 new인데 update로 요청한다
      entries: [{ entityId: wordId, expectedStatus: 'update', expectedTargetItemId: uuidv7() }],
    })
    expect(res.json().result.data).toMatchObject({
      inserted: 0, updated: 0, skipped: [{ entityId: wordId, reason: 'plan-changed' }],
    })
    expect(await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))).toHaveLength(0)
  })

  it('계획에 없는 엔티티는 missing으로 건너뛰고 Revision을 만들지 않는다', async () => {
    const seqBefore = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: uuidv7(), expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const data = res.json().result.data
    expect(data.skipped).toEqual([{ entityId: expect.any(String), reason: 'missing' }])
    expect(data.seq).toBe(seqBefore)
  })

  it('프로젝트 편집 권한이 없으면 거절한다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const res = await post(app, 'resource.promote', outsider, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    // 프로젝트는 존재하므로 NOT_FOUND가 아니라 FORBIDDEN이다(getProjectAccess가 access를 돌려주고
    // canEdit이 false라 requireProjectAccess가 FORBIDDEN을 던진다).
    expect(res.statusCode).toBe(403)
  })

  it('조직 리소스 쓰기 권한이 없으면 거절한다 (Editor여도 Org Member면 못 올린다)', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', memberSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(403)
  })

  it('다른 조직의 라이브러리로는 올릴 수 없다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const otherOrgId = (await post(app, 'org.create', ownerSession, { name: '다른 팀' }))
      .json().result.data.id
    const otherLibraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId: otherOrgId, name: '남의 표준',
    })).json().result.data.id
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId: otherLibraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(403)
  })

  it('승격이 실시간 채널로 발행된다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const received: ServerMessage[] = []
    app.hub.subscribe(projectId, {
      userId: 'observer', name: '구독자',
      send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) },
    })
    received.length = 0
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const opsMsg = received.find((m) => m.type === 'ops')
    expect(opsMsg).toBeDefined()
  })
})
