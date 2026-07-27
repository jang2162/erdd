import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type Op } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs, withUuidIds } from '../testing/helpers.js'
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

describe.skipIf(!url)('model', () => {
  let app: FastifyInstance
  let editorToken: string
  let viewerToken: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'v@t.dev', name: '뷰어', password: 'password-v', role: 'user' })
    editorToken = await loginAs(app, 'o@t.dev', 'password-o')
    viewerToken = await loginAs(app, 'v@t.dev', 'password-v')
    const orgId = (await post(app, 'org.create', editorToken, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', editorToken, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', editorToken, { orgId, email: 'v@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', editorToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const v = members.find((m) => m.email === 'v@t.dev')!
    await post(app, 'project.members.add', editorToken, {
      projectId, memberId: v.id, role: 'viewer',
    })
  })

  it('mutates a creation batch and reads back the identical model with seq', async () => {
    const target = withUuidIds(buildSampleModel())
    const ops = diffModels(createEmptyModel(), target)
    const res = await post(app, 'model.mutate', editorToken, { projectId, ops })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.seq).toBe(1)

    const got = await get(app, 'model.get', viewerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.model).toEqual(JSON.parse(JSON.stringify(target)))
    expect(got.json().result.data.seq).toBe(1)
  })

  it('rewrites update.from and delete.before with authoritative values', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    const columnId = Object.keys(target.columns)[0]!
    const realName = target.columns[columnId]!.logicalName
    const ops: Op[] = [
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { logicalName: { from: '거짓말', to: '새이름' } },
      },
    ]
    const res = await post(app, 'model.mutate', editorToken, { projectId, ops, summary: '이름 변경' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.seq).toBe(2)

    // revisions 테이블 직접 조회(revision.list 라우트는 Task 5)
    const rows = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    const top = rows[0]!
    expect(top.seq).toBe(2)
    expect(top.summary).toBe('이름 변경')
    const firstOp = top.ops[0] as { changes: Record<string, { from: unknown }> }
    expect(firstOp.changes.logicalName!.from).toBe(realName) // 권위값으로 재기록됨
  })

  it('rejects an integrity-breaking batch with 400 and leaves state unchanged', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    const tableId = Object.values(target.tables)
      .find((t) => t.physicalName === 'MBR')!.id
    const res = await post(app, 'model.mutate', editorToken, {
      projectId,
      ops: [{ action: 'delete', entity: 'table', entityId: tableId, before: null }],
    })
    expect(res.statusCode).toBe(400)
    const got = (await get(app, 'model.get', editorToken, { projectId })).json().result.data
    expect(got.seq).toBe(1)
    expect(got.model.tables[tableId]).toBeDefined()
  })

  it('denies mutate to viewers (403) but allows get; denies get to non-members', async () => {
    const noteId = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e6f'
    const denied = await post(app, 'model.mutate', viewerToken, {
      projectId,
      ops: [{
        action: 'create', entity: 'note', entityId: noteId,
        data: { id: noteId, content: 'x', position: { x: 0, y: 0 }, color: '#fff' },
      }],
    })
    expect(denied.statusCode).toBe(403)

    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const got = await get(app, 'model.get', outsider, { projectId })
    expect([403, 404]).toContain(got.statusCode)
  })

  it('mutates a word/term creation batch via model.mutate and reads back the model (Task 4)', async () => {
    // Task 1은 model_words/model_terms 테이블이 없어 word/term op을 OpApplyError(400)로 막았다.
    // Task 4가 테이블·TABLE_BY_KIND를 갖췄으므로 이제 일반 create 경로로 200 성공해야 한다.
    const wordId = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e6f'
    const termId = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e70'
    const res = await post(app, 'model.mutate', editorToken, {
      projectId,
      ops: [
        {
          action: 'create', entity: 'word', entityId: wordId,
          data: { id: wordId, logicalName: '주문', abbreviation: 'ORD', description: null },
        },
        {
          action: 'create', entity: 'term', entityId: termId,
          data: {
            id: termId, logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: null,
          },
        },
      ],
    })
    expect(res.statusCode).toBe(200)

    const got = await get(app, 'model.get', editorToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.model.words[wordId]).toEqual({
      id: wordId, logicalName: '주문', abbreviation: 'ORD', description: null,
    })
    expect(got.json().result.data.model.terms[termId]).toEqual({
      id: termId, logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: null,
    })
  })

  it('rejects a customField op with 400 (임시 가드는 OpApplyError여야 한다)', async () => {
    const fieldId = uuidv7()
    const res = await post(app, 'model.mutate', editorToken, {
      projectId,
      ops: [{
        action: 'create', entity: 'customField', entityId: fieldId,
        data: {
          id: fieldId, name: '개인정보여부', target: 'column', type: 'boolean',
          options: [], required: false, defaultValue: null, order: 0,
        },
      }],
    })
    expect(res.statusCode).toBe(400)
  })
})
