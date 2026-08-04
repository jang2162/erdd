import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel, type ServerMessage } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs, withUuidIds } from '../testing/helpers.js'
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
function postWithToken(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(input),
  })
}
async function issueToken(app: FastifyInstance, session: string, name: string): Promise<string> {
  const res = await post(app, 'auth.tokens.create', session, { name })
  return res.json().result.data.token as string
}

describe.skipIf(!url)('model.push', () => {
  let app: FastifyInstance
  let editorSession: string
  let viewerSession: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'v@t.dev', name: '뷰어', password: 'password-v', role: 'user' })
    editorSession = await loginAs(app, 'o@t.dev', 'password-o')
    viewerSession = await loginAs(app, 'v@t.dev', 'password-v')
    const orgId = (await post(app, 'org.create', editorSession, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', editorSession, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', editorSession, { orgId, email: 'v@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', editorSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', editorSession, {
      projectId, memberId: members.find((m) => m.email === 'v@t.dev')!.id, role: 'viewer',
    })
  })

  it('expectedSeq가 맞으면 반영하고 Revision을 source=cli로 남긴다', async () => {
    const token = await issueToken(app, editorSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    const res = await postWithToken(app, 'model.push', token, {
      projectId, expectedSeq: 0, ops, summary: 'CLI push (테이블 2건)',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.seq).toBe(1)

    const [rev] = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(rev!.source).toBe('cli')
    expect(rev!.summary).toBe('CLI push (테이블 2건)')
  })

  it('반영이 실시간 채널로 발행된다 — 구독 중인 연결이 ops를 받는다', async () => {
    // 이 브랜치가 가장 강하게 못 박은 계약: 모든 모델 변경은 mutateAndPublish를 거친다.
    // runMutation을 직접 부르면 DB는 멀쩡히 커밋되고 테스트도 전부 그린인데 웹에 열어 둔
    // 화면만 조용히 낡는다 — 라우터에서 실제로 발행되는지를 보는 테스트가 하나는 있어야 한다.
    const token = await issueToken(app, editorSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    const received: ServerMessage[] = []
    const handle = app.hub.subscribe(projectId, {
      userId: 'observer', name: '구독자',
      send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) },
    })
    // 다른 프로젝트 구독자에게는 가지 않아야 한다(허브 단위가 아니라 채널 단위 발행인지).
    const otherReceived: ServerMessage[] = []
    const otherHandle = app.hub.subscribe(uuidv7(), {
      userId: 'other', name: '남',
      send: (text: string) => { otherReceived.push(JSON.parse(text) as ServerMessage) },
    })
    try {
      const res = await postWithToken(app, 'model.push', token, {
        projectId, expectedSeq: 0, ops, summary: 'CLI push',
      })
      expect(res.statusCode).toBe(200)

      const frame = received.find((m) => m.type === 'ops')
      expect(frame).toBeDefined()
      expect(frame).toMatchObject({ type: 'ops', seq: 1, actorName: '오너' })
      expect(frame!.ops).toEqual(ops)
      expect(otherReceived.filter((m) => m.type === 'ops')).toEqual([])
    } finally {
      handle.close()
      otherHandle.close()
    }
  })

  it('expectedSeq가 어긋나면 CONFLICT이고 이미 반영된 상태가 살아남는다', async () => {
    const token = await issueToken(app, editorSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    expect((await postWithToken(app, 'model.push', token, {
      projectId, expectedSeq: 0, ops, summary: '첫 반영',
    })).statusCode).toBe(200)
    const before = (await get(app, 'model.get', editorSession, { projectId })).json().result.data
    expect(before.seq).toBe(1)
    expect(Object.keys(before.model.tables)).toHaveLength(2)

    // 빈 프로젝트에 CONFLICT를 내면 "롤백됐다"와 "애초에 아무것도 없었다"를 구분할 수 없다.
    // 이미 상태가 있는 위에, 그 상태를 전부 지우는 ops를 낡은 expectedSeq로 보낸다 —
    // 락 안에서 던지지 않고 op를 적용한 뒤 던지는 회귀라면 여기서 모델이 비어 버린다.
    const wipe = diffModels(before.model as ProjectModel, createEmptyModel())
    expect(wipe.length).toBeGreaterThan(0)
    const res = await postWithToken(app, 'model.push', token, {
      projectId, expectedSeq: 0, ops: wipe,
    })
    expect(res.json().error.data.code).toBe('CONFLICT')

    const after = (await get(app, 'model.get', editorSession, { projectId })).json().result.data
    expect(after.seq).toBe(1)                    // 리비전이 전진하지 않았다
    expect(after.model).toEqual(before.model)    // 첫 리비전의 데이터가 그대로다
  })

  it('토큰으로 model.push는 되지만 model.mutate는 거부된다', async () => {
    const token = await issueToken(app, editorSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    expect((await postWithToken(app, 'model.push', token, { projectId, expectedSeq: 0, ops })).statusCode).toBe(200)
    const denied = await postWithToken(app, 'model.mutate', token, { projectId, ops })
    expect(denied.json().error.data.code).toBe('UNAUTHORIZED')
  })

  it('Viewer 토큰은 FORBIDDEN이다', async () => {
    const token = await issueToken(app, viewerSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    const res = await postWithToken(app, 'model.push', token, { projectId, expectedSeq: 0, ops })
    expect(res.json().error.data.code).toBe('FORBIDDEN')
  })

  it('세션 쿠키로도 호출할 수 있다', async () => {
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    const res = await post(app, 'model.push', editorSession, { projectId, expectedSeq: 0, ops })
    expect(res.statusCode).toBe(200)
  })
})
