import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import {
  createRelationshipFromParentPk, remapRelationshipChildColumn,
  setRelationshipIdentifying, deleteRelationship, deleteTableCascade, deleteColumnCascade,
  junctionTableName, resolveManyToMany,
} from './relationship.js'
import type { Column, ProjectModel, Table } from './model.js'
import { createEmptyModel } from './model.js'

function tbl(id: string, physicalName: string): Table {
  return { id, logicalName: id, physicalName, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
    domainId: null, custom: {}, ...over }
}

// 부모 USERS(PK id), 자식 ORDERS(컬럼 없음)
function baseModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = tbl('P', 'USERS')
  m.tables['C'] = tbl('C', 'ORDERS')
  m.columns['P_ID'] = col('P_ID', 'P', 'ID', { isPk: true, nullable: false, order: 0, type: 'BIGINT' })
  return m
}

describe('createRelationshipFromParentPk', () => {
  it('부모 PK를 자식에 FK 컬럼으로 생성하고 관계를 만든다', () => {
    const next = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const fk = next.columns['FK1']!
    expect(fk.tableId).toBe('C')
    expect(fk.physicalName).toBe('ID')       // 부모 물리명 복제
    expect(fk.type).toBe('BIGINT')            // 타입 복제
    expect(fk.nullable).toBe(false)           // NOT NULL 기본
    expect(fk.isPk).toBe(false)               // 비식별 기본
    const rel = next.relationships['R']!
    expect(rel.parentTableId).toBe('P')
    expect(rel.childTableId).toBe('C')
    expect(rel.columnMappings).toEqual([{ childColumnId: 'FK1', parentColumnId: 'P_ID' }])
    expect(rel.cardinality).toBe('1:N')
    expect(rel.identifying).toBe(false)
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('자식에 물리명이 이미 있으면 _2 접미를 붙인다', () => {
    const m = baseModel()
    m.columns['EXIST'] = col('EXIST', 'C', 'ID', { order: 0 })  // 이미 ID 존재
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    expect(next.columns['FK1']!.physicalName).toBe('ID_2')
  })

  it('복합 PK면 컬럼을 모두 생성하고 매핑한다', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1', 'FK2'],
    })
    expect(next.relationships['R']!.columnMappings).toHaveLength(2)
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('식별 관계면 FK 컬럼이 자식 PK가 된다', () => {
    const next = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'], identifying: true,
    })
    expect(next.columns['FK1']!.isPk).toBe(true)
    expect(next.relationships['R']!.identifying).toBe(true)
  })

  it('newColumnIds가 부족하면 throw', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    expect(() => createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })).toThrow()
  })

  it('부모에 PK가 없으면 관계를 만들지 않고 그대로 반환한다', () => {
    const m = baseModel()
    m.columns['P_ID']!.isPk = false
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeUndefined()
  })
})

describe('setRelationshipIdentifying', () => {
  it('true면 FK 컬럼이 PK가 되고 false면 해제된다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const on = setRelationshipIdentifying(created, 'R', true)
    expect(on.columns['FK1']!.isPk).toBe(true)
    expect(on.relationships['R']!.identifying).toBe(true)
    const off = setRelationshipIdentifying(on, 'R', false)
    expect(off.columns['FK1']!.isPk).toBe(false)
    expect(off.relationships['R']!.identifying).toBe(false)
    expect(validateModelIntegrity(off)).toEqual([])
  })
})

describe('remapRelationshipChildColumn', () => {
  it('자동생성 FK를 기존 컬럼으로 교체하고 자동생성 컬럼은 삭제한다', () => {
    const m = baseModel()
    m.columns['USER_REF'] = col('USER_REF', 'C', 'USER_REF', { type: 'BIGINT', order: 0 })
    const created = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = remapRelationshipChildColumn(created, {
      relationshipId: 'R', parentColumnId: 'P_ID', newChildColumnId: 'USER_REF',
    })
    expect(next.relationships['R']!.columnMappings).toEqual([
      { childColumnId: 'USER_REF', parentColumnId: 'P_ID' },
    ])
    expect(next.columns['FK1']).toBeUndefined()  // 이전 자동생성 컬럼 삭제
    expect(next.columns['USER_REF']).toBeDefined()
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('식별 관계를 기존 컬럼으로 재매핑하면 그 컬럼이 PK가 된다', () => {
    const m = baseModel()
    m.columns['USER_REF'] = col('USER_REF', 'C', 'USER_REF', { type: 'BIGINT', order: 0, isPk: false })
    const created = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'], identifying: true,
    })
    const next = remapRelationshipChildColumn(created, {
      relationshipId: 'R', parentColumnId: 'P_ID', newChildColumnId: 'USER_REF',
    })
    expect(next.columns['USER_REF']!.isPk).toBe(true)
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('이전 자식 컬럼이 다른 관계에서 쓰이면 삭제하지 않는다', () => {
    const m = baseModel()
    m.tables['P2'] = tbl('P2', 'ROLES')
    m.columns['P2_ID'] = col('P2_ID', 'P2', 'RID', { isPk: true, nullable: false, order: 0, type: 'BIGINT' })
    m.columns['SHARED'] = col('SHARED', 'C', 'SHARED', { type: 'BIGINT', order: 0 })
    m.columns['OTHER'] = col('OTHER', 'C', 'OTHER', { type: 'BIGINT', order: 1 })
    m.relationships['R1'] = { id: 'R1', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'SHARED', parentColumnId: 'P_ID' }],
      cardinality: '1:N', identifying: false, name: null }
    m.relationships['R2'] = { id: 'R2', parentTableId: 'P2', childTableId: 'C',
      columnMappings: [{ childColumnId: 'SHARED', parentColumnId: 'P2_ID' }],
      cardinality: '1:N', identifying: false, name: null }
    const next = remapRelationshipChildColumn(m, {
      relationshipId: 'R1', parentColumnId: 'P_ID', newChildColumnId: 'OTHER',
    })
    expect(next.columns['SHARED']).toBeDefined()
    expect(next.relationships['R1']!.columnMappings).toEqual([{ childColumnId: 'OTHER', parentColumnId: 'P_ID' }])
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteRelationship', () => {
  it('관계를 지우되 자식 FK 컬럼은 일반 컬럼으로 남긴다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteRelationship(created, 'R')
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeDefined()   // 컬럼 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteTableCascade', () => {
  it('부모 삭제 시 관계는 지우고 자식 FK 컬럼은 보존한다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteTableCascade(created, 'P')
    expect(next.tables['P']).toBeUndefined()
    expect(next.columns['P_ID']).toBeUndefined()  // 부모 소속 컬럼 삭제
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeDefined()     // 자식 FK 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('자식 삭제 시 관계와 자식 컬럼이 함께 삭제된다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteTableCascade(created, 'C')
    expect(next.tables['C']).toBeUndefined()
    expect(next.columns['FK1']).toBeUndefined()
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['P_ID']).toBeDefined()    // 부모 컬럼 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteColumnCascade', () => {
  it('매핑에 쓰인 컬럼 삭제 시 매핑에서 제거하고 매핑이 비면 관계도 삭제한다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteColumnCascade(created, 'FK1')
    expect(next.columns['FK1']).toBeUndefined()
    expect(next.relationships['R']).toBeUndefined()  // 매핑이 비어 관계 삭제
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('복합 매핑에서 한 컬럼만 지우면 관계는 유지되고 매핑만 축소된다', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    const created = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1', 'FK2'],
    })
    const next = deleteColumnCascade(created, 'FK1')
    expect(next.relationships['R']).toBeDefined()
    expect(next.relationships['R']!.columnMappings).toHaveLength(1)
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('junctionTableName', () => {
  it('두 논리명을 구분자 없이 이어붙인다', () => {
    const p = { ...tbl('P', 'ORDERS'), logicalName: '주문' }
    const c = { ...tbl('C', 'PRODUCTS'), logicalName: '상품' }
    expect(junctionTableName(p, c)).toBe('주문상품')
  })
})

// 부모 주문(PK ORDER_ID) → 자식 상품(PK PRODUCT_ID), non-identifying 관계 r1.
// createRelationshipFromParentPk가 자식에 FK 컬럼 'fk1'(physicalName 'ORDER_ID')을 만든다.
function m2mBase(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { ...tbl('P', 'ORDERS'), logicalName: '주문', position: { x: 0, y: 0 } }
  m.tables['C'] = { ...tbl('C', 'PRODUCTS'), logicalName: '상품', position: { x: 100, y: 50 } }
  m.columns['P_PK'] = col('P_PK', 'P', 'ORDER_ID', { isPk: true, nullable: false, order: 0 })
  m.columns['C_PK'] = col('C_PK', 'C', 'PRODUCT_ID', { isPk: true, nullable: false, order: 0 })
  return createRelationshipFromParentPk(m, {
    relationshipId: 'r1', parentTableId: 'P', childTableId: 'C', newColumnIds: ['fk1'],
  })
}

const JUNCTION = {
  id: 'J', logicalName: '주문상품', physicalName: 'ORD_PRD',
  position: { x: 50, y: 25 }, groupId: null, groupPosition: null,
}
const ARGS = {
  relationshipId: 'r1',
  junction: JUNCTION,
  a: { relationshipId: 'ra', newColumnIds: ['ja1'] },
  b: { relationshipId: 'rb', newColumnIds: ['jb1'] },
}

describe('resolveManyToMany', () => {
  it('교차 테이블을 만들고 두 FK를 복합 PK로 둔다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)

    expect(out.tables['J']?.logicalName).toBe('주문상품')
    expect(out.tables['J']?.physicalName).toBe('ORD_PRD')

    const jCols = Object.values(out.columns).filter((c) => c.tableId === 'J')
    expect(jCols.map((c) => c.id).sort()).toEqual(['ja1', 'jb1'])
    expect(jCols.every((c) => c.isPk)).toBe(true)
    // 부모 PK의 물리명을 그대로 가져온다
    expect(jCols.map((c) => c.physicalName).sort()).toEqual(['ORDER_ID', 'PRODUCT_ID'])
  })

  it('원본 관계와 그 FK 컬럼을 없앤다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)
    expect(out.relationships['r1']).toBeUndefined()
    expect(out.columns['fk1']).toBeUndefined()
  })

  it('새 관계 둘은 각 부모에서 교차 테이블로 가는 식별 1:N 이다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)

    expect(out.relationships['ra']).toMatchObject({
      parentTableId: 'P', childTableId: 'J', cardinality: '1:N', identifying: true,
    })
    expect(out.relationships['rb']).toMatchObject({
      parentTableId: 'C', childTableId: 'J', cardinality: '1:N', identifying: true,
    })
    expect(out.relationships['ra']?.columnMappings).toEqual([{ childColumnId: 'ja1', parentColumnId: 'P_PK' }])
    expect(out.relationships['rb']?.columnMappings).toEqual([{ childColumnId: 'jb1', parentColumnId: 'C_PK' }])
  })

  it('결과 모델의 참조 무결성이 유지된다', () => {
    expect(validateModelIntegrity(resolveManyToMany(m2mBase(), ARGS))).toEqual([])
  })

  it('존재하지 않는 관계면 아무것도 하지 않는다', () => {
    const m = m2mBase()
    expect(resolveManyToMany(m, { ...ARGS, relationshipId: 'nope' })).toEqual(m)
  })

  it('식별 관계면 아무것도 하지 않는다', () => {
    const m = setRelationshipIdentifying(m2mBase(), 'r1', true)
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('부모에 PK가 없으면 아무것도 하지 않는다', () => {
    const base = m2mBase()
    // 부모 P의 PK를 비-PK로 바꾼다(컬럼을 지우면 관계까지 사라져 다른 가드에 걸린다)
    const m = {
      ...base,
      columns: { ...base.columns, P_PK: { ...base.columns['P_PK']!, isPk: false } },
    }
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('FK 컬럼이 자식의 유일한 PK면 아무것도 하지 않는다', () => {
    // identifying:false 인데 FK 의 isPk 가 true 인 불일치 상태 — 모델이 둘을 묶지 않는다.
    // 삭제 '전' 개수로 세면 통과해 버리고, FK 를 지운 뒤 두 번째 관계 생성이 조용히
    // no-op 이 되어 교차 테이블과 관계 하나만 남는다(설계 3.4).
    const base = m2mBase()
    const { C_PK, ...rest } = base.columns
    const m = { ...base, columns: { ...rest, fk1: { ...base.columns['fk1']!, isPk: true } } }
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('삭제량이 자식 PK 수를 넘어도 no-op 이다', () => {
    // 매핑이 자식 밖 컬럼(P_PK = 부모의 PK)을 가리키는 무결성 위반 모델이다 —
    // remapRelationshipChildColumn 이 자식 테이블 밖 컬럼을 거부하므로 공개 함수로는 도달할
    // 수 없지만, 설계 4.2 의 no-op 규약이 막으려는 것은 경합으로 뒤늦게 도착한 mutation 이고
    // 그 mutation 은 web 의 planJunction 을 거치지 않는다. dedup 으로는 막지 못하는(중복이
    // 없다) 경우라 '<= 0' 이중 방어를 단독으로 잠근다 — '=== 0' 이면 1 - 2 = -1 이 비교를
    // 빠져나가 교차 테이블과 관계 하나만 남는 부분 상태가 된다.
    // (web edges.test.ts 의 '삭제량이 자식 PK 수를 넘어도 no-pk 로 막는다' 와 대칭이다.)
    const base = m2mBase()
    const m = {
      ...base,
      relationships: {
        ...base.relationships,
        r1: { ...base.relationships['r1']!, columnMappings: [
          { childColumnId: 'P_PK', parentColumnId: 'P_PK' },
          { childColumnId: 'C_PK', parentColumnId: 'P_PK' },
        ] },
      },
    }
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('원본 FK 컬럼을 쓰던 인덱스를 정리한다', () => {
    const base = m2mBase()
    const m = {
      ...base,
      indexes: {
        ix_only: { id: 'ix_only', tableId: 'C', name: 'IX_ONLY', unique: false,
          columns: [{ columnId: 'fk1', direction: 'asc' as const }] },
        ix_mixed: { id: 'ix_mixed', tableId: 'C', name: 'IX_MIXED', unique: false,
          columns: [{ columnId: 'fk1', direction: 'asc' as const },
                    { columnId: 'C_PK', direction: 'asc' as const }] },
      },
    }
    const out = resolveManyToMany(m, ARGS)
    expect(out.indexes['ix_only']).toBeUndefined() // 컬럼이 0개가 되면 인덱스도 사라진다
    expect(out.indexes['ix_mixed']?.columns).toEqual([{ columnId: 'C_PK', direction: 'asc' }])
  })

  it('자기참조 관계에서도 FK 물리명이 충돌하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['S'] = { ...tbl('S', 'EMP'), logicalName: '사원' }
    m.columns['S_PK'] = col('S_PK', 'S', 'EMP_NO', { isPk: true, nullable: false, order: 0 })
    const withRel = createRelationshipFromParentPk(m, {
      relationshipId: 'r1', parentTableId: 'S', childTableId: 'S', newColumnIds: ['fk1'],
    })
    const out = resolveManyToMany(withRel, ARGS)
    const jCols = Object.values(out.columns).filter((c) => c.tableId === 'J').sort((a, b) => a.order - b.order)
    expect(jCols.map((c) => c.physicalName)).toEqual(['EMP_NO', 'EMP_NO_2'])
  })

  it('부모 PK 컬럼을 자식 PK 컬럼보다 먼저 넣는다', () => {
    // 교차 테이블 컬럼의 order 는 그대로 DDL 의 PRIMARY KEY (…) 순서가 된다.
    // 설계 4.2 는 부모(7번) → 자식(8번) 순서를 명시한다.
    const out = resolveManyToMany(m2mBase(), ARGS)
    const jCols = Object.values(out.columns)
      .filter((c) => c.tableId === 'J')
      .sort((a, b) => a.order - b.order)
    expect(jCols.map((c) => c.physicalName)).toEqual(['ORDER_ID', 'PRODUCT_ID'])
  })

  it('교차 테이블의 좌표·그룹을 JunctionSpec 그대로 둔다', () => {
    const base = m2mBase()
    // groupId 를 실제 그룹으로 두어야 무결성 검사를 통과한다(integrity.ts:41).
    const m = {
      ...base,
      tableGroups: { g1: { id: 'g1', name: '주문영역', color: '#e0e0e0', comment: null, alias: '' } },
    }
    const out = resolveManyToMany(m, {
      ...ARGS,
      junction: { ...JUNCTION, groupId: 'g1', groupPosition: { x: 7, y: 9 } },
    })
    expect(out.tables['J']?.position).toEqual({ x: 50, y: 25 })
    expect(out.tables['J']?.groupId).toBe('g1')
    expect(out.tables['J']?.groupPosition).toEqual({ x: 7, y: 9 })
    expect(validateModelIntegrity(out)).toEqual([])
  })
})

// 주문(PK ORD_NO) →(1:N) 주문상세(PK DTL_SEQ + FK ORD_NO) →(1:N) 배송.
// r1 은 identifying:false 인데 자동 생성 FK 'fk1' 의 isPk 만 true 인 불일치 상태다 —
// 편집 패널의 PK 체크박스나 DDL 역설계로 실제로 도달한다.
function m2mDownstreamBase(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { ...tbl('P', 'ORD'), logicalName: '주문' }
  m.tables['C'] = { ...tbl('C', 'ORD_DTL'), logicalName: '주문상세' }
  m.tables['G'] = { ...tbl('G', 'DLV'), logicalName: '배송' }
  m.columns['P_PK'] = col('P_PK', 'P', 'ORD_NO', { isPk: true, nullable: false, order: 0 })
  m.columns['C_PK'] = col('C_PK', 'C', 'DTL_SEQ', { isPk: true, nullable: false, order: 0 })
  const withR1 = createRelationshipFromParentPk(m, {
    relationshipId: 'r1', parentTableId: 'P', childTableId: 'C', newColumnIds: ['fk1'],
  })
  const pkFk = {
    ...withR1,
    columns: { ...withR1.columns, fk1: { ...withR1.columns['fk1']!, isPk: true } },
  }
  // 손자 관계는 자식의 PK 2개(DTL_SEQ · ORD_NO)를 모두 부모 컬럼으로 가져간다.
  return createRelationshipFromParentPk(pkFk, {
    relationshipId: 'r2', parentTableId: 'C', childTableId: 'G', newColumnIds: ['gfk1', 'gfk2'],
  })
}

describe('resolveManyToMany — 하위 관계가 FK 컬럼을 참조', () => {
  it('지울 FK 컬럼을 부모로 삼는 다른 관계가 있으면 아무것도 하지 않는다', () => {
    const m = m2mDownstreamBase()
    // identifying 가드에 먼저 걸리면 이 케이스를 검증하지 못한다 — false 인 것을 못 박는다.
    expect(m.relationships['r1']?.identifying).toBe(false)
    expect(m.columns['fk1']?.isPk).toBe(true)
    expect(m.relationships['r2']?.columnMappings)
      .toEqual([{ childColumnId: 'gfk1', parentColumnId: 'C_PK' },
                { childColumnId: 'gfk2', parentColumnId: 'fk1' }])

    // 가드가 없으면 fk1 이 사라지면서 r2 의 매핑이 조용히 1개로 줄고, 배송.ORD_NO 가
    // 아무도 참조하지 않는 고아 컬럼으로 남는다 — 무결성 검사도 경고도 잡지 못한다(설계 3.3).
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })
})

// 부모 주문(복합 PK ORDER_ID·TENANT_ID) → 자식 상품(PK PRODUCT_ID), non-identifying 관계 r1.
// FK 컬럼이 2개('fk1'·'fk2')라 삭제 루프가 여러 번 도는 유일한 경로다.
function m2mCompositeBase(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { ...tbl('P', 'ORDERS'), logicalName: '주문' }
  m.tables['C'] = { ...tbl('C', 'PRODUCTS'), logicalName: '상품' }
  m.columns['P_PK1'] = col('P_PK1', 'P', 'ORDER_ID', { isPk: true, nullable: false, order: 0 })
  m.columns['P_PK2'] = col('P_PK2', 'P', 'TENANT_ID', { isPk: true, nullable: false, order: 1 })
  m.columns['C_PK'] = col('C_PK', 'C', 'PRODUCT_ID', { isPk: true, nullable: false, order: 0 })
  return createRelationshipFromParentPk(m, {
    relationshipId: 'r1', parentTableId: 'P', childTableId: 'C', newColumnIds: ['fk1', 'fk2'],
  })
}

const ARGS_COMPOSITE = {
  ...ARGS,
  a: { relationshipId: 'ra', newColumnIds: ['ja1', 'ja2'] },
  b: { relationshipId: 'rb', newColumnIds: ['jb1'] },
}

describe('resolveManyToMany — 복합 PK 부모', () => {
  it('FK 컬럼을 모두 지우고 교차 테이블의 PK 를 3컬럼으로 만든다', () => {
    const out = resolveManyToMany(m2mCompositeBase(), ARGS_COMPOSITE)

    expect(out.columns['fk1']).toBeUndefined()
    expect(out.columns['fk2']).toBeUndefined()

    const jCols = Object.values(out.columns)
      .filter((c) => c.tableId === 'J')
      .sort((a, b) => a.order - b.order)
    expect(jCols.map((c) => c.physicalName)).toEqual(['ORDER_ID', 'TENANT_ID', 'PRODUCT_ID'])
    expect(jCols.every((c) => c.isPk)).toBe(true)
    expect(validateModelIntegrity(out)).toEqual([])
  })

  it('같은 컬럼이 두 번 매핑돼 있어도 부분 상태를 만들지 않는다', () => {
    // 중복 매핑은 합성이 아니다 — 공개 함수 remapRelationshipChildColumn 으로 만들어진다.
    // 중복을 세면 droppedPk 가 실제보다 커져 pkCount - droppedPk 가 음수가 되고,
    // '=== 0' 비교를 빠져나가 교차 테이블과 관계 하나만 생긴다(설계 3.4 가 막으려던 상태).
    const dup = remapRelationshipChildColumn(m2mCompositeBase(), {
      relationshipId: 'r1', parentColumnId: 'P_PK2', newChildColumnId: 'fk1',
    })
    expect(dup.relationships['r1']?.columnMappings)
      .toEqual([{ childColumnId: 'fk1', parentColumnId: 'P_PK1' },
                { childColumnId: 'fk1', parentColumnId: 'P_PK2' }])

    // fk1 을 자식의 유일한 PK 로 만든다 — 지우면 자식 PK 가 0개가 된다.
    const { C_PK, ...rest } = dup.columns
    const m = { ...dup, columns: { ...rest, fk1: { ...dup.columns['fk1']!, isPk: true } } }

    expect(resolveManyToMany(m, ARGS_COMPOSITE)).toEqual(m)
  })

  it('중복 매핑이라도 자식에 PK 가 남으면 정상적으로 푼다', () => {
    // 위 테스트의 반대편(거짓 음성) — 중복을 세면 droppedPk 가 실제 삭제량보다 커져
    // 풀 수 있는 모델이 조용히 no-op 이 된다. 위 테스트는 <= 0 이중 방어만으로도
    // 통과하므로 dedup 자체를 잠그는 것은 이쪽이다.
    const dup = remapRelationshipChildColumn(m2mCompositeBase(), {
      relationshipId: 'r1', parentColumnId: 'P_PK2', newChildColumnId: 'fk1',
    })
    // C_PK 는 남긴다 — fk1 을 지워도 자식 PK 가 1개 남는다.
    const m = { ...dup, columns: { ...dup.columns, fk1: { ...dup.columns['fk1']!, isPk: true } } }

    const out = resolveManyToMany(m, ARGS_COMPOSITE)
    expect(out.tables['J']).toBeDefined()
    expect(out.relationships['ra']).toBeDefined()
    expect(out.relationships['rb']).toBeDefined() // 중복을 세면 여기가 undefined 가 된다
    expect(out.columns['fk1']).toBeUndefined()
    expect(validateModelIntegrity(out)).toEqual([])
  })
})
