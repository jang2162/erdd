import { describe, expect, it } from 'vitest'
import { applyOps } from './op.js'
import { deepEqual } from './equal.js'
import { diffModels } from './diff.js'
import { buildSampleModel } from './testing/fixtures.js'
import { createEmptyModel } from './model.js'

describe('deepEqual', () => {
  it('compares JSON-safe values structurally', () => {
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('diffModels', () => {
  it('returns [] for identical models', () => {
    expect(diffModels(buildSampleModel(), buildSampleModel())).toEqual([])
  })

  it('emits update ops with per-property from/to', () => {
    const base = buildSampleModel()
    const target = buildSampleModel()
    target.columns.c3!.logicalName = '고객명'
    target.columns.c3!.order = 9
    const ops = diffModels(base, target)
    expect(ops).toEqual([
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: {
          logicalName: { from: '회원명', to: '고객명' },
          order: { from: 1, to: 9 },
        },
      },
    ])
  })

  it('orders creates parent-first and deletes child-first (round-trip both ways)', () => {
    const empty = createEmptyModel()
    const full = buildSampleModel()

    const createOps = diffModels(empty, full)
    const kinds = createOps.map((o) => `${o.action}:${o.entity}`)
    // create: tableGroup → table → column → relationship → index → note 순서
    expect(kinds.indexOf('create:table')).toBeGreaterThan(kinds.indexOf('create:tableGroup'))
    expect(kinds.indexOf('create:column')).toBeGreaterThan(kinds.lastIndexOf('create:table'))
    expect(kinds.indexOf('create:relationship')).toBeGreaterThan(kinds.lastIndexOf('create:column'))
    expect(applyOps(empty, createOps)).toEqual(full)

    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
  })

  it('orders domain creates before referencing column creates, and column deletes before domain deletes (FK ordering regression)', () => {
    // model_columns.domain_id → model_domains.id는 NOT DEFERRABLE FK다. 단일 배치 안에서
    // domain이 column보다 뒤에 생성되거나 앞에 삭제되면 즉시 FK 위반이 난다.
    const empty = createEmptyModel()
    const target = buildSampleModel()
    const domainId = 'dm1'
    target.domains[domainId] = {
      id: domainId, name: '금액', category: null, logicalType: 'DECIMAL',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    target.columns.c1!.domainId = domainId

    const createOps = diffModels(empty, target)
    const createDomainIdx = createOps.findIndex(
      (o) => o.action === 'create' && o.entity === 'domain' && o.entityId === domainId,
    )
    const createColumnIdx = createOps.findIndex(
      (o) => o.action === 'create' && o.entity === 'column' && o.entityId === 'c1',
    )
    expect(createDomainIdx).toBeGreaterThanOrEqual(0)
    expect(createColumnIdx).toBeGreaterThanOrEqual(0)
    expect(createDomainIdx).toBeLessThan(createColumnIdx)
    expect(applyOps(empty, createOps)).toEqual(target)

    const deleteOps = diffModels(target, empty)
    const deleteDomainIdx = deleteOps.findIndex(
      (o) => o.action === 'delete' && o.entity === 'domain' && o.entityId === domainId,
    )
    const deleteColumnIdx = deleteOps.findIndex(
      (o) => o.action === 'delete' && o.entity === 'column' && o.entityId === 'c1',
    )
    expect(deleteDomainIdx).toBeGreaterThanOrEqual(0)
    expect(deleteColumnIdx).toBeGreaterThanOrEqual(0)
    expect(deleteColumnIdx).toBeLessThan(deleteDomainIdx)
    expect(applyOps(target, deleteOps)).toEqual(empty)
  })

  it('round-trips a mixed change set: apply(base, diff(base,target)) equals target', () => {
    const base = buildSampleModel()
    const target = buildSampleModel()
    // 수정
    target.tables.t2!.comment = '변경된 설명'
    // 삭제 (인덱스)
    delete target.indexes.i1
    // 추가 (메모)
    target.notes.n2 = { id: 'n2', content: '추가', position: { x: 5, y: 5 }, color: '#EEE' }
    const ops = diffModels(base, target)
    expect(applyOps(base, ops)).toEqual(target)
  })

  it('orders customField creates before table/column creates and deletes after them', () => {
    const empty = createEmptyModel()
    const target = buildSampleModel()
    target.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, order: 0, origin: null,
    }
    target.columns.c1!.custom = { f1: 'true' }

    const createOps = diffModels(empty, target)
    const kinds = createOps.map((o) => `${o.action}:${o.entity}`)
    expect(kinds.indexOf('create:customField')).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf('create:table')).toBeGreaterThan(kinds.indexOf('create:customField'))
    expect(applyOps(empty, createOps)).toEqual(target)

    const deleteOps = diffModels(target, empty)
    const dkinds = deleteOps.map((o) => `${o.action}:${o.entity}`)
    expect(dkinds.lastIndexOf('delete:column')).toBeLessThan(dkinds.indexOf('delete:customField'))
    expect(applyOps(target, deleteOps)).toEqual(empty)
  })

  it('does not emit an update op when the target entity merely lacks a property the base has', () => {
    // 구 스냅샷 복원 회귀 가드: 스냅샷 jsonb의 table에는 custom 키가 없고 현재 모델에는 있다.
    // 이때 changes가 빈 객체인 update op가 나가면 persistOps가 값 없는 UPDATE를 실행해 터진다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    const legacyTable = { ...target.tables.t1! } as Record<string, unknown>
    delete legacyTable.custom
    target.tables.t1 = legacyTable as unknown as NonNullable<typeof base.tables.t1>

    const ops = diffModels(base, target)
    expect(ops.filter((o) => o.action === 'update')).toEqual([])
  })

  it('does not emit an update op when the target domain merely lacks origin a base has (legacy snapshot regression)', () => {
    // origin은 이번 sub-project에서 domain/word/term/customField에 새로 추가된 필드다.
    // HANDOFF 3.3: 새 필드를 추가할 때는 "구 스냅샷에 필드 없음" 케이스를 회귀 테스트로 남긴다.
    // 위 table.custom 테스트와 같은 패턴 — origin이 생기기 전 스냅샷의 jsonb에는 도메인에
    // origin 키가 아예 없고, 현재 모델(base)에는 있다. 이때도 값 없는 update op가 나가면
    // 옛 스냅샷 복원이 500으로 터진다.
    const base = buildSampleModel()
    base.domains['dm1'] = {
      id: 'dm1', name: '금액', category: null, logicalType: 'DECIMAL',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    const target = structuredClone(base)
    const legacyDomain = { ...target.domains.dm1! } as Record<string, unknown>
    delete legacyDomain.origin
    target.domains.dm1 = legacyDomain as unknown as NonNullable<typeof base.domains.dm1>

    const ops = diffModels(base, target)
    expect(ops.filter((o) => o.action === 'update')).toEqual([])
  })

  it('does not emit an update op when the target group merely lacks alias (legacy snapshot regression)', () => {
    // alias는 이번 sub-project에서 tableGroup에 새로 추가된 필드다.
    // HANDOFF 3.3: 새 필드를 추가할 때는 "구 스냅샷에 필드 없음" 케이스를 회귀 테스트로 남긴다.
    // alias가 생기기 전 스냅샷의 jsonb에는 그룹에 alias 키가 아예 없고 현재 모델(base)에는 있다.
    // 이때 값 없는 update op가 나가면 옛 스냅샷 복원이 500으로 터진다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    const legacyGroup = { ...target.tableGroups.g1! } as Record<string, unknown>
    delete legacyGroup.alias
    target.tableGroups.g1 = legacyGroup as unknown as NonNullable<typeof base.tableGroups.g1>

    const ops = diffModels(base, target)
    expect(ops.filter((o) => o.action === 'update')).toEqual([])
  })
})
