import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel } from '@erdd/core'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { PUBLIC_PATHS, procedureEntries } from '../testing/procedures.js'

const url = process.env.DATABASE_URL

/** 액세스 토큰으로 부를 수 있는 프로시저 전부(공개 표면 제외) — guides/cli.md 「액세스 토큰 인증」. */
const TOKEN_PATHS = [
  'auth.me', 'org.list', 'project.list', 'project.get', 'project.create',
  'model.get', 'model.push',
  'resource.library.listForProject', 'resource.items.list', 'resource.promote',
  'promotion.create', 'promotion.listForProject',
]

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

  it('project.create 에 부분 명명 규칙(logicalSeparator 누락)을 실으면 400 이고 프로젝트가 생기지 않는다', async () => {
    // 읽기용 NamingRulesSchema 로 바뀌면 누락 키에 기본값이 조용히 주입된다 — 쓰기는 strict 여야 한다.
    const namingRules = {
      case: 'lower_snake', separator: '_', maxLengthBytes: 64,
      tablePhysicalTemplate: '', tableLogicalTemplate: '',
    }
    const res = await tPost('project.create', { orgId, name: '부분', dialects: ['mysql'], namingRules })
    expect(res.statusCode).toBe(400)
    const list = (await tGet('project.list', { orgId })).json().result.data as Array<{ name: string }>
    expect(list.map((p) => p.name)).toEqual(['P'])
  })

  it('조직 member(비관리자)의 토큰으로 project.create 는 403 과 권한 문구다', async () => {
    // CLI init --create 가 이 코드·문구를 「프로젝트 생성 권한이 없습니다 — …」로 번역한다.
    // 핸들러가 authKind 로 분기하지 않아도 토큰 경로로 한 번 잠가 둔다.
    await createAccount(app.db!, { email: 'm@t.dev', name: '멤버', password: 'password-m', role: 'user' })
    expect((await sPost('org.members.add', { orgId, email: 'm@t.dev', role: 'member' })).statusCode).toBe(200)
    const memberSession = await loginAs(app, 'm@t.dev', 'password-m')
    const memberToken = (await app.inject({
      method: 'POST', url: '/trpc/auth.tokens.create', cookies: { erdd_session: memberSession },
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'cli' }),
    })).json().result.data.token as string
    const res = await app.inject({
      method: 'POST', url: '/trpc/project.create',
      headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ orgId, name: 'X', dialects: ['mysql'] }),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain('프로젝트 생성 권한이 없습니다')
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

  it('토큰으로 부를 수 있는 프로시저가 정확히 이 열둘(+공개 표면)이다', async () => {
    // 표본 몇 개로는 이웃 프로시저(promotion.resolve·project.delete 등)가 실수로 apiProcedure 가
    // 되어도 모른다. 라우터 전수를 돌아 토큰 표면을 잠근다 — 공개 표면 전수 테스트(admin.test.ts)와
    // 같은 방식이다. 입력은 비운다: 인증 미들웨어가 입력 파싱보다 먼저라 세션 전용은 401,
    // 토큰 허용은 400·200 이 된다. 공개 프로시저는 토큰(=로그인 사용자)에도 401 이 아니므로 빼고 비교한다.
    const reachable: string[] = []
    for (const [path, type] of procedureEntries()) {
      const res = type === 'query'
        ? await app.inject({ method: 'GET', url: `/trpc/${path}`, headers: { authorization: `Bearer ${token}` } })
        : await tPost(path, {})
      if (res.statusCode !== 401) reachable.push(path)
    }
    expect(reachable.filter((p) => !PUBLIC_PATHS.includes(p)).sort()).toEqual([...TOKEN_PATHS].sort())
  })
})
