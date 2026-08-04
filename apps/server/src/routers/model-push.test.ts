import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { createEmptyModel, diffModels } from '@erdd/core'
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

  it('expectedSeq가 어긋나면 CONFLICT이고 모델이 변하지 않는다', async () => {
    const token = await issueToken(app, editorSession, 'cli')
    const ops = diffModels(createEmptyModel(), withUuidIds(buildSampleModel()))
    const res = await postWithToken(app, 'model.push', token, { projectId, expectedSeq: 7, ops })
    expect(res.json().error.data.code).toBe('CONFLICT')

    const after = (await get(app, 'model.get', editorSession, { projectId })).json().result.data
    expect(Object.keys(after.model.tables)).toHaveLength(0)
    expect(after.seq).toBe(0)
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
