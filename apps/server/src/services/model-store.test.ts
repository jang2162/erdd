import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  applyOps, createEmptyModel, diffModels, type CustomField, type Domain, type Term, type Word,
} from '@erdd/core'
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

  it('persists a single batch with domain + referencing column without FK violation (create and delete)', async () => {
    // model_columns.domain_id → model_domains.id는 NOT DEFERRABLE FK다. diffModels가 만드는
    // 단일 배치(예: 스냅샷 복원) 안에서 domain이 참조 column보다 먼저 생성/나중에 삭제되어야
    // persistOps가 행 단위 SQL을 실행하는 도중 FK 위반 없이 통과한다.
    const target = buildSampleModel()
    const domainId = 'dm1'
    target.domains[domainId] = {
      id: domainId, name: '금액', category: null, logicalType: 'DECIMAL',
      dialectTypes: {
        postgresql: null, mysql: null, oracle: null, mssql: null,
      },
      defaultValue: null, allowedValues: [], description: null,
    }
    target.columns.c1!.domainId = domainId
    const full = withUuidIds(target)
    const empty = createEmptyModel()

    // 생성: diffModels가 만든 실제 배치를 core로 먼저 검증한 뒤 서버에 단일 배치로 영속화
    const createOps = diffModels(empty, full)
    expect(applyOps(empty, createOps)).toEqual(full)
    await persistOps(app.db!, projectId, createOps)
    const loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded).toEqual(full)
    const [fullDomainId, fullDomain] = Object.entries(full.domains)[0]!
    expect(loaded.domains[fullDomainId]).toEqual(fullDomain)
    const referencingColumnId = Object.values(full.columns).find((c) => c.domainId !== null)!.id
    expect(loaded.columns[referencingColumnId]!.domainId).toBe(fullDomainId)

    // 삭제: 역순(자식 먼저) 단일 배치도 FK 위반 없이 통과해야 한다
    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
    await persistOps(app.db!, projectId, deleteOps)
    const reloaded = await loadProjectModel(app.db!, projectId)
    expect(reloaded).toEqual(empty)
  })

  it('persists a word/term creation batch (with term.domainId FK) and loads back the identical model', async () => {
    const raw = buildSampleModel()
    const domainId = 'dm1'
    raw.domains[domainId] = {
      id: domainId, name: '금액', category: null, logicalType: 'DECIMAL',
      dialectTypes: {
        postgresql: null, mysql: null, oracle: null, mssql: null,
      },
      defaultValue: null, allowedValues: [], description: null,
    }
    const word: Word = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null }
    raw.words[word.id] = word
    const term: Term = {
      id: 'tm1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId, description: '회원 식별자',
    }
    raw.terms[term.id] = term
    const target = withUuidIds(raw)

    const ops = diffModels(createEmptyModel(), target)
    await persistOps(app.db!, projectId, ops)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(target)
  })

  it('persists term create/update/delete ops with domainId FK roundtrip', async () => {
    const domainId = uuidv7()
    const domain: Domain = {
      id: domainId, name: '금액', category: '금융', logicalType: 'DECIMAL',
      dialectTypes: {
        postgresql: 'NUMERIC(15,2)', mysql: 'DECIMAL(15,2)', oracle: 'NUMBER(15,2)', mssql: 'DECIMAL(15,2)',
      },
      defaultValue: '0', allowedValues: [], description: '금액 도메인',
    }
    const termId = uuidv7()
    const term: Term = {
      id: termId, logicalName: '주문금액', physicalName: 'ORD_AMT', domainId, description: null,
    }

    // 도메인 + 도메인을 참조하는 용어 생성
    await persistOps(app.db!, projectId, [
      { action: 'create', entity: 'domain', entityId: domainId, data: domain },
      { action: 'create', entity: 'term', entityId: termId, data: term },
    ])
    let loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.terms[termId]).toEqual(term)

    // 용어 필드 갱신
    const updatedTerm: Term = { ...term, physicalName: 'ORD_AMT_V2', description: '주문 총액' }
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'term', entityId: termId,
        changes: {
          physicalName: { from: term.physicalName, to: updatedTerm.physicalName },
          description: { from: term.description, to: updatedTerm.description },
        },
      },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.terms[termId]).toEqual(updatedTerm)

    // 참조 해제 후 도메인 삭제, 용어 자체 삭제
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'term', entityId: termId,
        changes: { domainId: { from: domainId, to: null } },
      },
      { action: 'delete', entity: 'domain', entityId: domainId, before: domain },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.domains[domainId]).toBeUndefined()
    expect(loaded.terms[termId]!.domainId).toBeNull()

    await persistOps(app.db!, projectId, [
      { action: 'delete', entity: 'term', entityId: termId, before: { ...updatedTerm, domainId: null } },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.terms[termId]).toBeUndefined()
  })

  it('persists a single batch with domain + referencing term without FK violation (create and delete)', async () => {
    // model_terms.domain_id → model_domains.id도 NOT DEFERRABLE FK다. diffModels가 만드는
    // 단일 배치(예: 스냅샷 복원) 안에서 domain이 참조 term보다 먼저 생성/나중에 삭제되어야
    // persistOps가 행 단위 SQL을 실행하는 도중 FK 위반 없이 통과한다(ENTITY_KINDS에서
    // domain이 term보다 앞이라 안전 — 회귀 가드).
    const target = buildSampleModel()
    const domainId = 'dm1'
    target.domains[domainId] = {
      id: domainId, name: '금액', category: null, logicalType: 'DECIMAL',
      dialectTypes: {
        postgresql: null, mysql: null, oracle: null, mssql: null,
      },
      defaultValue: null, allowedValues: [], description: null,
    }
    target.terms.tm1 = {
      id: 'tm1', logicalName: '주문금액', physicalName: 'ORD_AMT', domainId, description: null,
    }
    const full = withUuidIds(target)
    const empty = createEmptyModel()

    // 생성: diffModels가 만든 실제 배치를 core로 먼저 검증한 뒤 서버에 단일 배치로 영속화
    const createOps = diffModels(empty, full)
    expect(applyOps(empty, createOps)).toEqual(full)
    await persistOps(app.db!, projectId, createOps)
    const loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded).toEqual(full)
    const [fullDomainId, fullDomain] = Object.entries(full.domains)[0]!
    expect(loaded.domains[fullDomainId]).toEqual(fullDomain)
    const referencingTermId = Object.values(full.terms).find((t) => t.domainId !== null)!.id
    expect(loaded.terms[referencingTermId]!.domainId).toBe(fullDomainId)

    // 삭제: 역순(자식 먼저) 단일 배치도 FK 위반 없이 통과해야 한다
    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
    await persistOps(app.db!, projectId, deleteOps)
    const reloaded = await loadProjectModel(app.db!, projectId)
    expect(reloaded).toEqual(empty)
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

  it('persists customField ops and table/column custom values roundtrip', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const fieldId = uuidv7()
    const field: CustomField = {
      id: fieldId, name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: 'N', order: 0,
    }
    const columnId = Object.keys(base.columns)[0]!

    await persistOps(app.db!, projectId, [
      { action: 'create', entity: 'customField', entityId: fieldId, data: field },
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { custom: { from: {}, to: { [fieldId]: 'Y' } } },
      },
    ])
    let loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toEqual(field)
    expect(loaded.columns[columnId]!.custom).toEqual({ [fieldId]: 'Y' })

    const updated: CustomField = { ...field, name: '개인정보', options: ['Y', 'N', 'X'], order: 2 }
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'customField', entityId: fieldId,
        changes: {
          name: { from: field.name, to: updated.name },
          options: { from: field.options, to: updated.options },
          order: { from: field.order, to: updated.order },
        },
      },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toEqual(updated)

    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { custom: { from: { [fieldId]: 'Y' }, to: {} } },
      },
      { action: 'delete', entity: 'customField', entityId: fieldId, before: updated },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toBeUndefined()
    expect(loaded.columns[columnId]!.custom).toEqual({})
  })

  it('persists a single batch with customField + table/column custom values (create and delete)', async () => {
    // 스냅샷 복원은 diffModels가 만든 단일 배치를 그대로 persist한다. customField가
    // table/column보다 먼저 생성되고 나중에 삭제되는지 실 DB로 확인하는 회귀 가드.
    const target = buildSampleModel()
    const fieldId = 'cf1'
    target.customFields[fieldId] = {
      id: fieldId, name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, order: 0,
    }
    target.columns.c1!.custom = { [fieldId]: 'true' }
    const full = withUuidIds(target)
    const empty = createEmptyModel()

    const createOps = diffModels(empty, full)
    expect(applyOps(empty, createOps)).toEqual(full)
    await persistOps(app.db!, projectId, createOps)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(full)

    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
    await persistOps(app.db!, projectId, deleteOps)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(empty)
  })
})
