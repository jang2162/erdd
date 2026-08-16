import { describe, expect, it } from 'vitest'
import {
  TableSchema, ColumnSchema, RelationshipSchema, IndexSchema, TableGroupSchema,
  DomainSchema, WordSchema, TermSchema, CustomFieldSchema, createEmptyModel,
} from './model.js'
import {
  FILE_FIELDS, FILE_INVISIBLE_FIELDS, MERGE_KINDS, fileVisibleModel, mergeModels, type MergeKind,
  applyMerge, gridPositions, pruneDangling,
} from './file-merge.js'
import { diffModels } from './diff.js'
import { validateModelIntegrity } from './integrity.js'
import type { ProjectModel } from './model.js'
import { fullModel } from './testing/fixtures.js'

/** zod 스키마에서 실제 키를 뽑는다 — 손으로 적은 목록은 드리프트한다. */
const SHAPE_BY_KIND: Record<MergeKind, { shape: object }> = {
  tableGroup: TableGroupSchema, domain: DomainSchema, word: WordSchema,
  term: TermSchema, customField: CustomFieldSchema, table: TableSchema,
  column: ColumnSchema, relationship: RelationshipSchema, index: IndexSchema,
}

describe('FILE_FIELDS 완전성', () => {
  it('note를 제외한 9종을 담는다', () => {
    expect([...MERGE_KINDS].sort()).toEqual(Object.keys(SHAPE_BY_KIND).sort())
    expect(MERGE_KINDS as readonly string[]).not.toContain('note')
  })

  it.each(MERGE_KINDS)('%s의 모든 필드가 가시/비가시 중 정확히 한쪽에 있다', (kind) => {
    const actual = Object.keys(SHAPE_BY_KIND[kind].shape).filter((k) => k !== 'id')
    const visible = Object.keys(FILE_FIELDS[kind])
    const invisible = [...FILE_INVISIBLE_FIELDS[kind]]
    // 한쪽에만 있으면 합집합의 길이가 actual과 같다. 양쪽에 있으면 중복이 생겨 길이가 어긋난다.
    expect([...visible, ...invisible].sort()).toEqual([...actual].sort())
    expect(visible.filter((v) => invisible.includes(v))).toEqual([])
  })
})

describe('fileVisibleModel', () => {
  it('메모·좌표·origin을 파일 공간 값으로 정규화한다', () => {
    const m = fullModel()
    m.domains['d1']!.origin = { libraryId: 'L1', sourceId: 'S1', sourceVersion: 3, base: {} }
    const v = fileVisibleModel(m)
    expect(v.notes).toEqual({})
    expect(v.tables['tb1']!.position).toEqual({ x: 0, y: 0 })
    expect(v.tables['tb1']!.groupPosition).toBeNull()
    expect(v.domains['d1']!.origin).toBeNull()
  })

  it('원본을 변형하지 않고 컬렉션도 새 객체로 만든다', () => {
    const m = fullModel()
    const v = fileVisibleModel(m)
    expect(m.notes['n1']).toBeDefined()
    expect(m.tables['tb1']!.position).toEqual({ x: 10, y: 20 })
    // 병합이 결과 컬렉션에서 delete를 하므로 원본과 같은 객체를 공유하면 서버 모델이 오염된다.
    expect(v.tables).not.toBe(m.tables)
    expect(v.columns).not.toBe(m.columns)
    expect(v.tableGroups).not.toBe(m.tableGroups)
  })
})

const clone = (m: ProjectModel): ProjectModel => JSON.parse(JSON.stringify(m)) as ProjectModel

/** 같은 뿌리에서 갈라진 base·local·server 셋. 전부 파일 가시 공간이다. */
function trio(): { base: ProjectModel; local: ProjectModel; server: ProjectModel } {
  const base = fileVisibleModel(fullModel())
  return { base, local: clone(base), server: clone(base) }
}

describe('mergeModels — 상태표', () => {
  it('서버만 추가한 것은 그대로 유지한다', () => {
    const { base, local, server } = trio()
    server.tableGroups['g2'] = { id: 'g2', name: '주문관리', color: '#fee', comment: null, alias: '' }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups['g2']).toBeDefined()
  })

  it('양쪽이 지웠으면 아무 일도 없다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    delete server.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('로컬만 지웠고 서버가 안 건드렸으면 삭제한다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('로컬이 지운 것을 서버가 고쳤으면 충돌이다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    server.indexes['ix2']!.name = 'IX_ORD_99'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'index', entityId: 'ix2', field: '*', reason: 'local-delete',
      local: null, changedFields: ['name'],
    })
  })

  it('로컬만 추가한 것은 생성한다', () => {
    const { base, local, server } = trio()
    local.tableGroups['g9'] = { id: 'g9', name: '정산', color: '#efe', comment: null, alias: '' }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups['g9']!.name).toBe('정산')
  })

  it('로컬이 고친 그룹 별칭을 채택한다', () => {
    // 픽스처의 base 별칭은 'MBR' 이다 — 그것과 다른 값으로 고쳐야 "로컬이 고쳤다"가 성립한다.
    const { base, local, server } = trio()
    const g = Object.keys(base.tableGroups)[0]!
    local.tableGroups[g] = { ...local.tableGroups[g]!, alias: 'MBRSHIP' }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups[g]!.alias).toBe('MBRSHIP')
  })

  it('양쪽이 별칭을 다르게 고치면 그 필드가 충돌이다', () => {
    const { base, local, server } = trio()
    const g = Object.keys(base.tableGroups)[0]!
    local.tableGroups[g] = { ...local.tableGroups[g]!, alias: 'MBRSHIP' }
    server.tableGroups[g] = { ...server.tableGroups[g]!, alias: 'MEM' }
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts.some((c) => c.field === 'alias')).toBe(true)
  })

  it('양쪽이 같은 id로 다르게 추가하면 필드마다 충돌이다', () => {
    const { base, local, server } = trio()
    local.tableGroups['g9'] = { id: 'g9', name: '정산', color: '#efe', comment: null, alias: '' }
    server.tableGroups['g9'] = { id: 'g9', name: '결제', color: '#efe', comment: null, alias: '' }
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'tableGroup', entityId: 'g9', field: 'name', reason: 'both-added',
      base: null, local: '정산', server: '결제',
    })
  })

  it('서버가 지운 것을 로컬이 안 건드렸으면 삭제를 수용한다', () => {
    const { base, local, server } = trio()
    delete server.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('서버가 지운 것을 로컬이 고쳤으면 충돌이다', () => {
    const { base, local, server } = trio()
    delete server.indexes['ix2']
    local.indexes['ix2']!.name = 'IX_ORD_99'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'index', entityId: 'ix2', field: '*', reason: 'server-delete',
      server: null, changedFields: ['name'],
    })
  })
})

describe('mergeModels — 필드 단위', () => {
  it('서로 다른 필드를 고치면 자동 병합한다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.comment = '이름 컬럼'
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.columns['c2']!.logicalName).toBe('회원 이름')
    expect(merged.columns['c2']!.comment).toBe('이름 컬럼')
  })

  it('같은 필드를 다르게 고치면 충돌이다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.logicalName = '회원성명'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual({
      path: 'erdd/tables/MBR.yaml',
      kind: 'column', entityId: 'c2', label: '컬럼 MBR.MBR_NM',
      field: 'logicalName', reason: 'field',
      base: '회원명', local: '회원 이름', server: '회원성명',
      changedFields: [],
    })
  })

  it('같은 필드를 같은 값으로 고치면 충돌이 아니다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.logicalName = '회원 이름'
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.columns['c2']!.logicalName).toBe('회원 이름')
  })

  it('참조형 필드는 각자의 모델 기준으로 이름을 풀고 YAML 키 이름으로 보고한다', () => {
    const { base, local, server } = trio()
    // d1을 서버에서만 개명한다 — local·server 둘 다 같은 id('d1')를 서버 모델로만 풀면
    // (버그: "항상 서버 모델로 해석") local 값이 우연히 base와 같아지는 일이 없도록
    // local의 d1과 서버의 d1이 서로 다른 이름을 갖게 만든다.
    server.domains['d1']!.name = '식별명'
    server.domains['d2'] = { ...server.domains['d1']!, id: 'd2', name: '식별번호' }
    local.columns['c1']!.domainId = 'd1'
    server.columns['c1']!.domainId = 'd2'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      field: 'domain', reason: 'field',
      base: null, local: '명', server: '식별번호',
    })
  })

  it('최상위 파일 엔티티의 path는 그 파일이다', () => {
    const { base, local, server } = trio()
    local.words['w1']!.abbreviation = 'MEM'
    server.words['w1']!.abbreviation = 'MB'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts[0]).toMatchObject({
      path: 'erdd/words.yaml', label: '단어 회원', field: 'abbreviation',
    })
  })

  it.each([
    ['tableGroup', 'groups.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.tableGroups['g1']!.name = '회원관리부'
      m.server.tableGroups['g1']!.name = '회원부'
    }] as const,
    ['domain', 'domains.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.domains['d1']!.name = '명칭'
      m.server.domains['d1']!.name = '식별명'
    }] as const,
    ['term', 'terms.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.terms['t1']!.physicalName = 'MBR_NO_L'
      m.server.terms['t1']!.physicalName = 'MBR_NO_S'
    }] as const,
    ['customField', 'custom-fields.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.customFields['cf1']!.name = '개인정보여부_L'
      m.server.customFields['cf1']!.name = '개인정보여부_S'
    }] as const,
  ])('최상위 파일 엔티티(%s)의 path는 %s다', (kind, file, mutate) => {
    const { base, local, server } = trio()
    mutate({ local, server })
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind, path: `erdd/${file}` })
  })

  it('관계 충돌의 path는 부모가 아니라 자식 테이블 파일이다', () => {
    const { base, local, server } = trio()
    // r1은 부모 tb1(MBR) → 자식 tb2(ORD). 관계는 자식 테이블 파일에만 적히므로
    // path는 ORD.yaml이어야 한다 — parentTableId로 잘못 짚으면 MBR.yaml이 나온다.
    local.relationships['r1']!.name = 'FK_LOCAL'
    server.relationships['r1']!.name = 'FK_SERVER'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'relationship', entityId: 'r1', field: 'name', reason: 'field',
      path: 'erdd/tables/ORD.yaml',
    })
  })
})

describe('gridPositions', () => {
  it('기존 테이블 bbox 아래에서 격자로 놓는다', () => {
    // fullModel의 테이블 좌표: (10,20) (30,40) (50,60) → minX=10, maxY=60
    const pos = gridPositions(fullModel(), 6)
    expect(pos).toEqual([
      { x: 10, y: 300 }, { x: 330, y: 300 }, { x: 650, y: 300 }, { x: 970, y: 300 },
      { x: 10, y: 540 }, { x: 330, y: 540 },
    ])
  })

  it('테이블이 하나도 없으면 원점부터 놓는다', () => {
    expect(gridPositions(createEmptyModel(), 2)).toEqual([{ x: 0, y: 0 }, { x: 320, y: 0 }])
  })
})

describe('applyMerge', () => {
  it('메모·좌표·origin을 서버 값 그대로 보존한다', () => {
    const server = fullModel()
    server.domains['d1']!.origin = { libraryId: 'L1', sourceId: 'S1', sourceVersion: 3, base: {} }
    const base = fileVisibleModel(server)
    const local = clone(base)
    local.columns['c2']!.logicalName = '회원 이름'

    const { merged } = mergeModels(base, local, fileVisibleModel(server))
    const { model } = applyMerge(server, merged)

    expect(model.notes['n1']).toEqual(server.notes['n1'])
    expect(model.tables['tb1']!.position).toEqual({ x: 10, y: 20 })
    expect(model.tables['tb1']!.groupPosition).toEqual({ x: 1, y: 2 })
    expect(model.domains['d1']!.origin).toEqual(server.domains['d1']!.origin)
    expect(model.columns['c2']!.logicalName).toBe('회원 이름')
  })

  it('diffModels가 좌표·메모 op를 만들지 않는다', () => {
    const server = fullModel()
    const base = fileVisibleModel(server)
    const local = clone(base)
    local.columns['c2']!.logicalName = '회원 이름'

    const { merged } = mergeModels(base, local, fileVisibleModel(server))
    const { model } = applyMerge(server, merged)
    const ops = diffModels(server, model)

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'column', action: 'update', entityId: 'c2' })
  })

  it('신규 테이블에만 격자 좌표를 준다', () => {
    const server = fullModel()
    const base = fileVisibleModel(server)
    const local = clone(base)
    local.tables['tb9'] = {
      id: 'tb9', logicalName: '결제', physicalName: 'PAY', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const { merged } = mergeModels(base, local, fileVisibleModel(server))
    const { model } = applyMerge(server, merged)
    expect(model.tables['tb9']!.position).toEqual({ x: 10, y: 300 })
    expect(model.tables['tb1']!.position).toEqual({ x: 10, y: 20 })
  })

  it('server 인자를 변형하지 않는다', () => {
    const server = fullModel()
    // pruneDangling이 지울 거리를 하나 만든다 — 스칼라 정리뿐 아니라
    // 엔티티 통째 삭제 경로도 server를 건드리지 않는지 확인한다.
    server.relationships['r9'] = {
      id: 'r9', parentTableId: 'tb1', childTableId: 'tb3',
      columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
      cardinality: '1:N', identifying: false, name: 'FK_EXTRA',
    }
    const before = clone(server)
    const base = fileVisibleModel(fullModel())     // r9 이전 시점
    const local = clone(base)
    delete local.tables['tb3']
    delete local.columns['c5']
    delete local.columns['c6']
    delete local.relationships['r2']

    const { merged } = mergeModels(base, local, fileVisibleModel(server))
    applyMerge(server, merged)

    expect(server).toEqual(before)
  })
})

describe('pruneDangling', () => {
  it('서버가 추가한 관계가 로컬이 지운 테이블을 가리키면 함께 지운다', () => {
    const server = fullModel()
    // 서버가 pull 이후 MBR_DTL → MBR 관계를 하나 더 추가했다.
    server.relationships['r9'] = {
      id: 'r9', parentTableId: 'tb1', childTableId: 'tb3',
      columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
      cardinality: '1:N', identifying: false, name: 'FK_EXTRA',
    }
    const base = fileVisibleModel(fullModel())     // r9 이전 시점
    const local = clone(base)
    // 로컬은 MBR_DTL 파일을 지웠다 — 그 테이블과 컬럼·관계가 전부 사라진다.
    delete local.tables['tb3']
    delete local.columns['c5']
    delete local.columns['c6']
    delete local.relationships['r2']

    const { merged, conflicts } = mergeModels(base, local, fileVisibleModel(server))
    expect(conflicts).toEqual([])
    const { model, pruned } = applyMerge(server, merged)

    expect(model.tables['tb3']).toBeUndefined()
    expect(model.relationships['r9']).toBeUndefined()   // 매달린 관계를 정리했다
    expect(pruned).toEqual([
      { kind: 'relationship', entityId: 'r9', label: '관계 FK_EXTRA', reason: '참조 대상이 삭제됨' },
    ])
    // 정리하지 않으면 여기서 FK 위반 op가 나간다.
    expect(diffModels(server, model).some((o) => o.entityId === 'r9' && o.action === 'delete')).toBe(true)
  })

  it('없는 컬럼을 가리키는 인덱스를 지운다', () => {
    const m = fullModel()
    delete m.columns['c2']            // ix1이 c2를 가리킨다
    const pruned = pruneDangling(m)
    expect(m.indexes['ix1']).toBeUndefined()
    expect(pruned.map((p) => p.entityId)).toContain('ix1')
  })

  it('컬럼이 다른 테이블로 옮겨가면(존재는 하지만 소속이 다르면) 인덱스를 지운다', () => {
    // c2는 여전히 존재한다 — 다만 tb1이 아니라 tb2 소속으로 파일이 옮겨졌다.
    // ix1(tableId: tb1)이 그 컬럼을 계속 가리키면 integrity.ts의 소유권 검사에 걸린다.
    const m = fullModel()
    m.columns['c2']!.tableId = 'tb2'
    const pruned = pruneDangling(m)
    expect(m.indexes['ix1']).toBeUndefined()
    // ix1 자신의 tableId(tb1)는 그대로다 — entityDisplayName이 테이블로 한정한다.
    expect(pruned).toContainEqual({
      kind: 'index', entityId: 'ix1', label: '인덱스 MBR.UX_MBR_01', reason: '참조 대상이 삭제됨',
    })
  })

  it('관계의 매핑 컬럼이 다른 테이블로 옮겨가면 관계를 지운다', () => {
    // r2는 childTableId: tb3(c5) → parentTableId: tb1(c1). c5는 오직 r2만 참조하므로
    // c5가 tb2로 옮겨가면(존재는 계속함) r2만 소유권 불일치로 걸린다.
    const m = fullModel()
    m.columns['c5']!.tableId = 'tb2'
    const pruned = pruneDangling(m)
    expect(m.relationships['r2']).toBeUndefined()
    // r2는 이름이 없다(name: null) — entityDisplayName은 raw id 대신 자식→부모로 보여준다.
    expect(pruned).toContainEqual({
      kind: 'relationship', entityId: 'r2', label: '관계 MBR_DTL→MBR', reason: '참조 대상이 삭제됨',
    })
  })

  it('매달린 스칼라 참조는 엔티티를 지우지 않고 null로 끊는다', () => {
    // 로컬이 테이블을 g1으로 옮겼는데 서버가 g1을 지운 상황. tables.group_id는 실제 FK라
    // (apps/server/src/db/schema.ts:92) 그대로 두면 반영이 FK 위반으로 터진다.
    const m = fullModel()
    delete m.tableGroups['g1']        // tb1·tb3이 g1을 가리킨다
    delete m.domains['d1']            // c2.domainId와 t1.domainId가 d1을 가리킨다
    const pruned = pruneDangling(m)

    expect(m.tables['tb1']!.groupId).toBeNull()
    expect(m.tables['tb3']!.groupId).toBeNull()
    expect(m.columns['c2']!.domainId).toBeNull()
    expect(m.terms['t1']!.domainId).toBeNull()
    // 엔티티 자체는 살아 있다 — 참조만 끊는다.
    expect(m.tables['tb1']).toBeDefined()
    expect(m.columns['c2']).toBeDefined()
    expect(pruned.map((p) => `${p.entityId}.${p.reason}`)).toEqual([
      'tb1.그룹이 삭제되어 참조를 해제함',
      'tb3.그룹이 삭제되어 참조를 해제함',
      'c2.도메인이 삭제되어 참조를 해제함',
      't1.도메인이 삭제되어 참조를 해제함',
    ])
  })

  it('Object.prototype에 있는 이름(constructor·toString…)을 가리키는 참조도 매달린 것으로 본다', () => {
    // 이 함수의 존재 이유가 validateModelIntegrity를 만족시키는 것이므로 두 곳이 같은
    // 판정(Object.hasOwn)을 써야 한다. `collection[id] !== undefined`는 프로토타입 체인에
    // 있는 이름에 대해 참이 되어, 무결성 검사는 "없는 참조"라고 하는데 정리는 건너뛴다.
    const m = fullModel()
    m.tables['tb1']!.groupId = 'hasOwnProperty'
    m.columns['c2']!.domainId = 'toLocaleString'
    m.terms['t1']!.domainId = 'isPrototypeOf'
    m.columns['cx'] = { ...m.columns['c1']!, id: 'cx', tableId: 'toString' }
    m.indexes['ixx'] = { id: 'ixx', tableId: 'constructor', name: 'IX_X', columns: [], unique: false }
    m.relationships['rx'] = {
      id: 'rx', parentTableId: 'valueOf', childTableId: 'tb1', columnMappings: [],
      cardinality: '1:N', identifying: false, name: null,
    }

    pruneDangling(m)

    expect(validateModelIntegrity(m)).toEqual([])
    expect(m.columns['cx']).toBeUndefined()
    expect(m.indexes['ixx']).toBeUndefined()
    expect(m.relationships['rx']).toBeUndefined()
    expect(m.tables['tb1']!.groupId).toBeNull()
    expect(m.columns['c2']!.domainId).toBeNull()
    expect(m.terms['t1']!.domainId).toBeNull()
  })
})
