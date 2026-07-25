import { describe, expect, it } from 'vitest'
import { applyOps, OpApplyError, type Op } from './op.js'
import { createEmptyModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('applyOps', () => {
  it('applies create/update/delete and does not mutate the input model', () => {
    const base = buildSampleModel()
    const frozen = JSON.parse(JSON.stringify(base))
    const ops: Op[] = [
      {
        action: 'create', entity: 'note', entityId: 'n2',
        data: { id: 'n2', content: '새 메모', position: { x: 1, y: 2 }, color: '#FFFFFF' },
      },
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' } },
      },
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
    ]
    const next = applyOps(base, ops)
    expect(next.notes.n2?.content).toBe('새 메모')
    expect(next.columns.c3?.logicalName).toBe('고객명')
    expect(next.indexes.i1).toBeUndefined()
    expect(base).toEqual(frozen) // 입력 불변
  })

  it('rejects creating an entity whose id already exists', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n1',
      data: { id: 'n1', content: 'dup', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects create when data.id does not match entityId', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n2',
      data: { id: 'n9', content: 'x', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects update of a missing entity and update of the id property', () => {
    const base = buildSampleModel()
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 'missing', changes: { comment: { from: null, to: 'x' } } },
      ]),
    ).toThrow(OpApplyError)
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 't1', changes: { id: { from: 't1', to: 't9' } } },
      ]),
    ).toThrow(OpApplyError)
  })

  it('rejects update that produces a schema-invalid entity', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'update', entity: 'column', entityId: 'c3',
      changes: { order: { from: 1, to: 1.5 } }, // order는 정수여야 함
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects a batch that breaks referential integrity', () => {
    const base = buildSampleModel()
    // 컬럼·관계·인덱스를 남긴 채 테이블만 삭제 → 무결성 위반
    const op: Op = { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('accepts a full cascade delete batch', () => {
    const base = buildSampleModel()
    const ops: Op[] = [
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'relationship', entityId: 'r1', before: base.relationships.r1 },
      { action: 'delete', entity: 'column', entityId: 'c2', before: base.columns.c2 },
      { action: 'delete', entity: 'column', entityId: 'c3', before: base.columns.c3 },
      { action: 'delete', entity: 'column', entityId: 'c4', before: base.columns.c4 },
      { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 },
    ]
    const next = applyOps(base, ops)
    expect(next.tables.t2).toBeUndefined()
    expect(Object.keys(next.columns)).toEqual(['c1'])
  })

  it('rejects deleting a missing entity', () => {
    const base = buildSampleModel()
    expect(() =>
      applyOps(base, [{ action: 'delete', entity: 'note', entityId: 'missing', before: null }]),
    ).toThrow(OpApplyError)
  })

  it('treats prototype property names as ordinary ids', () => {
    const base = buildSampleModel()
    const data = { id: 'constructor', content: 'x', position: { x: 0, y: 0 }, color: '#fff' }
    const next = applyOps(base, [{ action: 'create', entity: 'note', entityId: 'constructor', data }])
    expect(next.notes['constructor']?.content).toBe('x')
    expect(() =>
      applyOps(base, [{ action: 'delete', entity: 'note', entityId: 'toString', before: null }]),
    ).toThrow(OpApplyError)
  })

  it('rejects __proto__ as an entityId on create', () => {
    const base = buildSampleModel()
    const data = { id: '__proto__', content: 'x', position: { x: 0, y: 0 }, color: '#fff' }
    expect(() =>
      applyOps(base, [{ action: 'create', entity: 'note', entityId: '__proto__', data }]),
    ).toThrow(OpApplyError)
  })

  it('applies an update with empty changes as a no-op and rejects unknown properties', () => {
    const base = buildSampleModel()
    const next = applyOps(base, [{ action: 'update', entity: 'note', entityId: 'n1', changes: {} }])
    expect(next).toEqual(base)
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'note', entityId: 'n1', changes: { nope: { from: null, to: 1 } } },
      ]),
    ).toThrow(OpApplyError)
  })

  it('domain 엔티티를 create/update/delete로 왕복한다', () => {
    const m = createEmptyModel()
    const d = { id: 'd1', name: '금액', category: '숫자', logicalType: 'DECIMAL(15)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null }
    const created = applyOps(m, [{ action: 'create', entity: 'domain', entityId: 'd1', data: d }])
    expect(created.domains['d1']!.name).toBe('금액')
    const updated = applyOps(created, [{ action: 'update', entity: 'domain', entityId: 'd1',
      changes: { name: { from: '금액', to: '통화금액' } } }])
    expect(updated.domains['d1']!.name).toBe('통화금액')
    const deleted = applyOps(updated, [{ action: 'delete', entity: 'domain', entityId: 'd1', before: d }])
    expect(deleted.domains['d1']).toBeUndefined()
  })

  it('컬럼 create 시 domainId를 생략해도 통과하며 null로 채워진다(구 리비전 하위호환)', () => {
    const base = buildSampleModel()
    const data = {
      id: 'c5', tableId: 't2', logicalName: '비고', physicalName: 'RMK',
      type: 'VARCHAR(200)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 3, comment: null,
      // domainId 의도적으로 생략 — domainId 필드가 없던 구 리비전 op 페이로드를 흉내
    }
    const next = applyOps(base, [{ action: 'create', entity: 'column', entityId: 'c5', data }])
    expect(next.columns.c5?.domainId).toBeNull()
  })

  it('컬럼이 존재하지 않는 도메인을 가리키면 무결성 위반', () => {
    const m = createEmptyModel()
    m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
    expect(() => applyOps(m, [{ action: 'create', entity: 'column', entityId: 'c', data: {
      id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT', isPk: false,
      autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
      domainId: 'missing' } }])).toThrow()
  })

  it('word/term 엔티티를 왕복하고, term은 존재하는 도메인만 참조한다', () => {
    const m = createEmptyModel()
    const w = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null }
    const created = applyOps(m, [{ action: 'create', entity: 'word', entityId: 'w1', data: w }])
    expect(created.words['w1']!.abbreviation).toBe('MBR')
    // term with missing domain → 무결성 위반
    expect(() => applyOps(created, [{ action: 'create', entity: 'term', entityId: 't1', data: {
      id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: 'nope', description: null } }])).toThrow()
    // term with null domain OK
    const wt = applyOps(created, [{ action: 'create', entity: 'term', entityId: 't1', data: {
      id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: null, description: null } }])
    expect(wt.terms['t1']!.physicalName).toBe('MBR_NO')
  })
  it('words/terms 생략된 옛 모델도 파싱된다(.default)', () => {
    // applyOps 초기 spread가 model.words 없이도 동작하는지 — createEmptyModel엔 있으나 옛 스냅샷 방어
    const legacy = { ...createEmptyModel() } as Record<string, unknown>
    delete legacy.words; delete legacy.terms
    const out = applyOps(legacy as ReturnType<typeof createEmptyModel>, [])
    expect(out.words).toEqual({}); expect(out.terms).toEqual({})
  })
})
