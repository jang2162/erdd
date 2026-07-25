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

describe.skipIf(!url)('snapshot', () => {
  let app: FastifyInstance
  let token: string
  let orgId: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    token = await loginAs(app, 'o@t.dev', 'password-o')
    orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
  })

  it('creates a snapshot of a project with tables and reads it back via list and get', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', token, { projectId, ops: diffModels(createEmptyModel(), target) })

    const created = await post(app, 'snapshot.create', token, {
      projectId, name: '스냅샷1', description: '설명',
    })
    expect(created.statusCode).toBe(200)
    const snapshotId = created.json().result.data.id as string

    const list = (await get(app, 'snapshot.list', token, { projectId })).json().result.data.items
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(snapshotId)
    expect(list[0].revisionSeq).toBe(1)

    const got = (await get(app, 'snapshot.get', token, { projectId, snapshotId })).json().result.data
    expect(got.model).toEqual(JSON.parse(JSON.stringify(target)))
    expect(Object.keys(got.model.tables)).toEqual(Object.keys(target.tables))
  })

  it('restores a project to the snapshot state, reverting a later rename', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', token, { projectId, ops: diffModels(createEmptyModel(), target) })

    const snapshotId = (await post(app, 'snapshot.create', token, {
      projectId, name: '복원지점',
    })).json().result.data.id as string

    const tableId = Object.keys(target.tables)[0]!
    const originalName = target.tables[tableId]!.physicalName
    const renamed = await post(app, 'model.mutate', token, {
      projectId,
      ops: [{
        action: 'update', entity: 'table', entityId: tableId,
        changes: { physicalName: { from: originalName, to: 'RENAMED_TBL' } },
      }],
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().result.data.seq).toBe(2)

    const restored = await post(app, 'snapshot.restore', token, { projectId, snapshotId })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().result.data.seq).toBe(3)

    const after = (await get(app, 'model.get', token, { projectId })).json().result.data
    expect(after.model).toEqual(JSON.parse(JSON.stringify(target)))
    expect(after.model.tables[tableId].physicalName).toBe(originalName)
    expect(Object.values(after.model.tables).some(
      (t) => (t as { physicalName: string }).physicalName === 'RENAMED_TBL',
    )).toBe(false)

    const rows = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(rows[0]!.seq).toBe(3)
    expect(rows[0]!.source).toBe('system')
    expect(rows[0]!.summary).toContain('복원지점')
  })

  it('404s get and restore for a snapshot scoped to a different project', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', token, { projectId, ops: diffModels(createEmptyModel(), target) })
    const snapshotId = (await post(app, 'snapshot.create', token, {
      projectId, name: '스냅샷',
    })).json().result.data.id as string

    const otherProjectId = (await post(app, 'project.create', token, {
      orgId, name: 'P2', dialects: ['postgresql'],
    })).json().result.data.id as string

    const got = await get(app, 'snapshot.get', token, { projectId: otherProjectId, snapshotId })
    expect(got.statusCode).toBe(404)

    const restored = await post(app, 'snapshot.restore', token, {
      projectId: otherProjectId, snapshotId,
    })
    expect(restored.statusCode).toBe(404)
  })

  it('404s delete for a snapshot scoped to a different project, and for a nonexistent snapshot', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', token, { projectId, ops: diffModels(createEmptyModel(), target) })
    const snapshotId = (await post(app, 'snapshot.create', token, {
      projectId, name: '스냅샷',
    })).json().result.data.id as string

    const otherProjectId = (await post(app, 'project.create', token, {
      orgId, name: 'P2', dialects: ['postgresql'],
    })).json().result.data.id as string

    const crossProjectDelete = await post(app, 'snapshot.delete', token, {
      projectId: otherProjectId, snapshotId,
    })
    expect(crossProjectDelete.statusCode).toBe(404)

    const nonexistentDelete = await post(app, 'snapshot.delete', token, {
      projectId, snapshotId: '00000000-0000-0000-0000-000000000000',
    })
    expect(nonexistentDelete.statusCode).toBe(404)
  })
})
