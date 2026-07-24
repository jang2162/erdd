import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createEmptyModel, diffModels } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { uuidv7 } from 'uuidv7'
import { organizations, projects } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, withUuidIds } from '../testing/helpers.js'
import { loadProjectModel, persistOps } from './model-store.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('model-store', () => {
  let app: FastifyInstance
  let projectId: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const orgId = uuidv7()
    projectId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '테스트', kind: 'team' })
    await app.db!.insert(projects).values({
      id: projectId, orgId, name: 'P', description: '', dialects: ['postgresql'],
    })
  })

  it('persists a creation batch and loads back the identical model', async () => {
    const target = withUuidIds(buildSampleModel())
    const ops = diffModels(createEmptyModel(), target)
    await persistOps(app.db!, projectId, ops)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(target)
  })

  it('applies update and delete ops to rows', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const next = structuredClone(base)
    const someColumnId = Object.keys(next.columns)[0]!
    next.columns[someColumnId]!.logicalName = '변경됨'
    const noteId = Object.keys(next.notes)[0]!
    delete next.notes[noteId]

    await persistOps(app.db!, projectId, diffModels(base, next))
    expect(await loadProjectModel(app.db!, projectId)).toEqual(next)
  })

  it('scopes by project — ops cannot touch another project rows', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const otherProject = uuidv7()
    const orgId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '다른', kind: 'team' })
    await app.db!.insert(projects).values({
      id: otherProject, orgId, name: 'Q', description: '', dialects: ['mysql'],
    })
    // 다른 프로젝트 스코프로 기존 노트를 삭제 시도 → 행이 남아 있어야 함
    const noteId = Object.keys(base.notes)[0]!
    await persistOps(app.db!, otherProject, [
      { action: 'delete', entity: 'note', entityId: noteId, before: null },
    ])
    const reloaded = await loadProjectModel(app.db!, projectId)
    expect(reloaded.notes[noteId]).toBeDefined()
  })
})
