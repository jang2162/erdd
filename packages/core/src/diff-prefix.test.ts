// packages/core/src/diff-prefix.test.ts
import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from './op.js'
import { diffModels } from './diff.js'
import { validateModelIntegrity } from './integrity.js'
import { MAX_OPS_PER_MUTATION } from './op-guard.js'
import {
  createEmptyModel, type Column, type Domain, type IndexDef, type ProjectModel, type Relationship,
  type Table, type TableGroup, type Term,
} from './model.js'
import { buildSampleModel } from './testing/fixtures.js'

/**
 * 웹은 5,000 op 를 넘는 편집을 `diffModels` 가 낸 순서 그대로 잘라 조각마다 따로 서버에 보낸다
 * (guides/data-layer.md 「한 요청의 op 상한은 …」). 서버는 조각 하나를 독립된 mutation 으로 적용하므로
 * **모든 조각 경계의 중간 상태가 무결해야 한다.** 여기서 그것을 잠근다.
 */

const pad = (prefix: string, i: number) => `${prefix}-${String(i).padStart(6, '0')}`

function group(id: string): TableGroup {
  return { id, name: id, color: '#4A90D9', comment: null, alias: '' }
}
function domain(id: string): Domain {
  return {
    id, name: id, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}
function term(id: string, domainId: string | null): Term {
  return { id, logicalName: id, physicalName: id.toUpperCase(), domainId, description: null, origin: null }
}
function table(id: string, groupId: string | null): Table {
  return {
    id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
}
function column(id: string, tableId: string, order: number, domainId: string | null): Column {
  return {
    id, tableId, logicalName: id, physicalName: id.toUpperCase(), type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order, comment: null, domainId, custom: {},
  }
}
function relationship(id: string, parentTableId: string, childTableId: string, childColumnId: string, parentColumnId: string): Relationship {
  return {
    id, parentTableId, childTableId, columnMappings: [{ childColumnId, parentColumnId }],
    cardinality: '1:N', identifying: false, name: null,
  }
}
function index(id: string, tableId: string, columnId: string): IndexDef {
  return { id, tableId, name: id.toUpperCase(), columns: [{ columnId, direction: 'asc' }], unique: false }
}

/** ops 를 size 씩 잘라 차례로 적용한다 — 웹의 나눠 보내기와 같은 자름. 조각마다 무결성을 본다. */
function applyInChunks(base: ProjectModel, ops: readonly Op[], size: number): ProjectModel {
  let model = base
  for (let start = 0; start < ops.length; start += size) {
    // applyOps 는 끝에서 무결성을 검사하고 어기면 OpApplyError 를 던진다 — 던지면 그 조각 경계가 깨진 것이다.
    model = applyOps(model, ops.slice(start, start + size))
    expect(validateModelIntegrity(model), `op[${start}..${start + size - 1}] 까지 적용한 상태`).toEqual([])
  }
  return model
}

/** 모든 접두사(op 하나씩)를 본다. O(n²) 이라 작은 픽스처에만 쓴다. */
function expectEveryPrefixValid(base: ProjectModel, ops: readonly Op[]): ProjectModel {
  let model = base
  ops.forEach((op, i) => {
    model = applyOps(model, [op])
    expect(validateModelIntegrity(model), `op[${i}] ${op.action} ${op.entity} ${op.entityId} 까지`).toEqual([])
  })
  return model
}

/** 갱신·추가·삭제가 섞이고 참조가 서로 걸린 작은 두 모델. */
function mixedPair(): { before: ProjectModel; after: ProjectModel } {
  const before = createEmptyModel()
  before.tableGroups.g1 = group('g1')
  before.domains.dOld = domain('dOld')
  before.terms.tm1 = term('tm1', 'dOld')
  before.tables.t1 = table('t1', 'g1')
  before.tables.t2 = table('t2', 'g1')
  before.columns.c1 = column('c1', 't1', 0, 'dOld')
  before.columns.c2 = column('c2', 't2', 0, null)
  before.relationships.r1 = relationship('r1', 't1', 't2', 'c2', 'c1')
  before.indexes.i1 = index('i1', 't2', 'c2')

  const after = createEmptyModel()
  after.tableGroups.g2 = group('g2')                       // g1 삭제, g2 추가
  after.domains.dNew = domain('dNew')                      // dOld 삭제, dNew 추가
  after.terms.tm1 = term('tm1', 'dNew')                    // 갱신: 삭제될 도메인 → 새 도메인
  after.tables.t1 = table('t1', 'g2')                      // 갱신: 삭제될 그룹 → 새 그룹
  after.columns.c1 = column('c1', 't1', 0, 'dNew')         // 갱신: 도메인 이동
  after.tables.t3 = table('t3', 'g2')                      // t2(와 c2·r1·i1) 삭제, t3 추가
  after.columns.c3 = column('c3', 't3', 0, 'dNew')
  after.relationships.r2 = relationship('r2', 't1', 't3', 'c3', 'c1')
  after.indexes.i2 = index('i2', 't3', 'c3')
  return { before, after }
}

describe('diffModels — 모든 접두사 무결성(나눠 보내기의 정확성 조건)', () => {
  it('픽스처 자체가 무결하다', () => {
    const { before, after } = mixedPair()
    expect(validateModelIntegrity(before)).toEqual([])
    expect(validateModelIntegrity(after)).toEqual([])
  })

  it('갱신·추가·삭제가 섞인 diff 의 모든 접두사가 무결하다 — 양방향(적용과 실행 취소)', () => {
    const { before, after } = mixedPair()
    expect(expectEveryPrefixValid(before, diffModels(before, after))).toEqual(after)
    expect(expectEveryPrefixValid(after, diffModels(after, before))).toEqual(before)
  })

  it('모든 종류가 든 샘플 모델을 통째로 만들고 지우는 diff 의 모든 접두사가 무결하다', () => {
    const sample = buildSampleModel()
    const empty = createEmptyModel()
    expectEveryPrefixValid(empty, diffModels(empty, sample))
    expectEveryPrefixValid(sample, diffModels(sample, empty))
  })

  it('도메인 추가와 그것을 가리키는 용어·컬럼 추가 사이에 5,000 경계가 와도 조각마다 무결하다', () => {
    const base = createEmptyModel()
    const target = createEmptyModel()
    target.tableGroups.g1 = group('g1')
    // 그룹 1 + 도메인 4,999 = 첫 조각 5,000 — 첫 조각은 마지막 도메인에서 끝나고,
    // 둘째 조각은 그 도메인을 가리키는 용어로 시작한다.
    const DOMAINS = MAX_OPS_PER_MUTATION - 1
    for (let i = 0; i < DOMAINS; i++) target.domains[pad('d', i)] = domain(pad('d', i))
    const last = pad('d', DOMAINS - 1)
    for (let i = 0; i < 10; i++) target.terms[pad('tm', i)] = term(pad('tm', i), last)
    target.tables.t1 = table('t1', 'g1')
    target.tables.t2 = table('t2', 'g1')
    target.columns.c1 = column('c1', 't1', 0, last)
    target.columns.c2 = column('c2', 't2', 0, last)
    target.relationships.r1 = relationship('r1', 't1', 't2', 'c2', 'c1')
    target.indexes.i1 = index('i1', 't2', 'c2')
    expect(validateModelIntegrity(target)).toEqual([])

    const ops = diffModels(base, target)
    // 픽스처가 겨눈 경계가 실제로 참조 사이에 오는지부터 본다 — 아니면 이 테스트는 아무것도 잠그지 않는다.
    expect(ops[MAX_OPS_PER_MUTATION - 1]).toMatchObject({ action: 'create', entity: 'domain', entityId: last })
    expect(ops[MAX_OPS_PER_MUTATION]).toMatchObject({ action: 'create', entity: 'term' })
    expect(applyInChunks(base, ops, MAX_OPS_PER_MUTATION)).toEqual(target)

    // 역방향(실행 취소): 자식(인덱스·관계·컬럼·테이블·용어)이 앞 조각, 도메인·그룹이 뒤 조각에 걸친다.
    expect(applyInChunks(target, diffModels(target, base), MAX_OPS_PER_MUTATION)).toEqual(base)
  })

  it('테이블 삭제와 그 테이블을 가리키는 관계 삭제 사이에 5,000 경계가 와도 조각마다 무결하다', () => {
    const base = createEmptyModel()
    base.tables.t1 = table('t1', null)
    base.tables.t2 = table('t2', null)
    base.columns.c1 = column('c1', 't1', 0, null)
    base.columns.c2 = column('c2', 't2', 0, null)
    for (let i = 0; i < MAX_OPS_PER_MUTATION; i++) {
      base.relationships[pad('r', i)] = relationship(pad('r', i), 't1', 't2', 'c2', 'c1')
    }
    expect(validateModelIntegrity(base)).toEqual([])
    const target = createEmptyModel()

    const ops = diffModels(base, target)
    // 관계 삭제 5,000 이 첫 조각을 채우고, 둘째 조각이 그 관계들이 가리키던 컬럼·테이블 삭제로 시작한다.
    expect(ops[MAX_OPS_PER_MUTATION - 1]).toMatchObject({ action: 'delete', entity: 'relationship' })
    expect(ops[MAX_OPS_PER_MUTATION]).toMatchObject({ action: 'delete', entity: 'column' })
    expect(applyInChunks(base, ops, MAX_OPS_PER_MUTATION)).toEqual(target)

    // 역방향(실행 취소 = 다시 만들기): 테이블·컬럼이 앞 조각, 관계가 두 조각에 걸친다.
    expect(applyInChunks(target, diffModels(target, base), MAX_OPS_PER_MUTATION)).toEqual(base)
  })
})
