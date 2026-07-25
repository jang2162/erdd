import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createEmptyModel, diffModels, type Domain } from '@erdd/core'
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

  it('persists domain create/update/delete ops with column.domainId roundtrip', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const domainId = uuidv7()
    const domain: Domain = {
      id: domainId, name: '금액', category: '금융', logicalType: 'DECIMAL',
      dialectTypes: {
        postgresql: 'NUMERIC(15,2)', mysql: 'DECIMAL(15,2)', oracle: 'NUMBER(15,2)', mssql: 'DECIMAL(15,2)',
      },
      defaultValue: '0', allowedValues: [], description: '금액 도메인',
    }
    const columnId = Object.keys(base.columns)[0]!

    // 도메인 생성 + 컬럼에 매핑
    await persistOps(app.db!, projectId, [
      { action: 'create', entity: 'domain', entityId: domainId, data: domain },
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { domainId: { from: null, to: domainId } },
      },
    ])
    let loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.domains[domainId]).toEqual(domain)
    expect(loaded.columns[columnId]!.domainId).toBe(domainId)

    // 도메인 필드 갱신
    const updatedDomain: Domain = { ...domain, name: '금액(개정)', allowedValues: ['0', '100'] }
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'domain', entityId: domainId,
        changes: {
          name: { from: domain.name, to: updatedDomain.name },
          allowedValues: { from: domain.allowedValues, to: updatedDomain.allowedValues },
        },
      },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.domains[domainId]).toEqual(updatedDomain)

    // 참조 해제 후 도메인 삭제
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { domainId: { from: domainId, to: null } },
      },
      { action: 'delete', entity: 'domain', entityId: domainId, before: updatedDomain },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.domains[domainId]).toBeUndefined()
    expect(loaded.columns[columnId]!.domainId).toBeNull()
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
