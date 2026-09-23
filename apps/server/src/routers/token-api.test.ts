import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel } from '@erdd/core'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('CLI 사전 동기화가 토큰으로 부르는 프로시저', () => {
  let app: FastifyInstance
  let session: string
  let token: string
  let orgId: string
  let projectId: string
  let libraryId: string

  const sPost = (path: string, input: unknown) => app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
  const tGet = (path: string, input: unknown) => app.inject({
    method: 'GET', url: `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
    headers: { authorization: `Bearer ${token}` },
  })
  const tPost = (path: string, input: unknown) => app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(input),
  })

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    session = await loginAs(app, 'o@t.dev', 'password-o')
    token = (await sPost('auth.tokens.create', { name: 'cli' })).json().result.data.token
    orgId = (await sPost('org.create', { name: '팀' })).json().result.data.id
    projectId = (await sPost('project.create', { orgId, name: 'P', dialects: ['postgresql'] })).json().result.data.id
    libraryId = (await sPost('resource.library.create', { scope: 'org', orgId, name: '조직 표준' })).json().result.data.id
  })

  async function seedWord(): Promise<string> {
    const id = uuidv7()
    const next: ProjectModel = {
      ...createEmptyModel(),
      words: { [id]: { id, logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null } },
    }
    const res = await sPost('model.mutate', { projectId, ops: diffModels(createEmptyModel(), next), summary: '단어' })
    expect(res.statusCode).toBe(200)
    return id
  }

  it('project.create 를 토큰으로 부르고 명명 규칙·테이블 옵션을 함께 저장한다', async () => {
    const namingRules = {
      case: 'lower_snake', separator: '_', logicalSeparator: '_', maxLengthBytes: 64,
      tablePhysicalTemplate: '', tableLogicalTemplate: '',
    }
    const tableOptions = { postgresql: '', mysql: 'ENGINE=InnoDB', oracle: '', mssql: '' }
    const res = await tPost('project.create', { orgId, name: 'CLI', dialects: ['mysql'], namingRules, tableOptions })
    expect(res.statusCode).toBe(200)
    const created = res.json().result.data as { id: string }
    const got = (await tGet('project.get', { projectId: created.id })).json().result.data
    expect(got).toMatchObject({ dialects: ['mysql'], namingRules, tableOptions })
  })

  it('라이브러리 목록·항목을 토큰으로 읽는다', async () => {
    const libs = await tGet('resource.library.listForProject', { projectId })
    expect(libs.statusCode).toBe(200)
    expect(libs.json().result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: libraryId, canWrite: true })]))
    expect((await tGet('resource.items.list', { libraryId })).statusCode).toBe(200)
  })

  it('토큰으로 승격하면 Revision source 가 cli 다', async () => {
    const wordId = await seedWord()
    const res = await tPost('resource.promote', {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    })
    expect(res.statusCode).toBe(200)
    const [latest] = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(latest!.source).toBe('cli')
  })

  it('세션으로 승격하면 여전히 source 가 web 이다', async () => {
    const wordId = await seedWord()
    await sPost('resource.promote', {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    })
    const [latest] = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(latest!.source).toBe('web')
  })

  it('승격 요청을 토큰으로 만들고 목록을 읽는다', async () => {
    const wordId = await seedWord()
    const created = await tPost('promotion.create', { projectId, libraryId, entityIds: [wordId], note: 'CLI 요청' })
    expect(created.statusCode).toBe(200)
    const list = await tGet('promotion.listForProject', { projectId })
    expect(list.statusCode).toBe(200)
    expect(list.json().result.data).toEqual([expect.objectContaining({ note: 'CLI 요청', status: 'pending' })])
  })

  it('목록 밖의 프로시저는 여전히 토큰을 거절한다', async () => {
    expect((await tPost('resource.library.create', { scope: 'org', orgId, name: 'X' })).statusCode).toBe(401)
    expect((await tPost('resource.items.create', { libraryId, kind: 'word', payload: {} })).statusCode).toBe(401)
    expect((await tGet('resource.library.list', { scope: 'org', orgId })).statusCode).toBe(401)
  })
})
