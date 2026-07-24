import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import {
  createRelationshipFromParentPk, remapRelationshipChildColumn,
  setRelationshipIdentifying, deleteRelationship, deleteTableCascade, deleteColumnCascade,
} from './relationship.js'
import type { Column, ProjectModel, Table } from './model.js'
import { createEmptyModel } from './model.js'

function tbl(id: string, physicalName: string): Table {
  return { id, logicalName: id, physicalName, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, ...over }
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
