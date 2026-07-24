import { describe, expect, it } from 'vitest'
import { computeWarnings } from './warnings.js'
import type { Column, ProjectModel, Relationship, Table } from './model.js'
import { createEmptyModel } from './model.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, ...over }
}

describe('computeWarnings', () => {
  it('같은 테이블 물리명 중복을 각 컬럼마다 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { order: 0 })
    m.columns['B'] = col('B', 'T', 'NAME', { order: 1 })
    m.columns['C'] = col('C', 'T', 'CODE', { order: 2 })
    const w = computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')
    expect(w.map((x) => x.entityId).sort()).toEqual(['A', 'B'])
  })

  it('다른 테이블의 같은 물리명은 경고하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['T1'] = tbl('T1'); m.tables['T2'] = tbl('T2')
    m.columns['A'] = col('A', 'T1', 'ID'); m.columns['B'] = col('B', 'T2', 'ID')
    expect(computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')).toEqual([])
  })

  it('관계 매핑의 타입 불일치를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['PC'] = col('PC', 'P', 'ID', { type: 'BIGINT', isPk: true })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'VARCHAR(20)' })
    const rel: Relationship = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'PC' }],
      cardinality: '1:N', identifying: false, name: null }
    m.relationships['R'] = rel
    const w = computeWarnings(m).filter((x) => x.kind === 'type-mismatch')
    expect(w).toHaveLength(1)
    expect(w[0]!.entityId).toBe('R')
  })

  it('부모 PK 수와 매핑 수가 다르면 매핑 불완전을 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['P1'] = col('P1', 'P', 'ID', { isPk: true, type: 'BIGINT' })
    m.columns['P2'] = col('P2', 'P', 'TENANT', { isPk: true, type: 'BIGINT' })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'BIGINT' })
    m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'P1' }],
      cardinality: '1:N', identifying: false, name: null }
    const w = computeWarnings(m).filter((x) => x.kind === 'incomplete-mapping')
    expect(w).toHaveLength(1)
  })

  it('경고가 없으면 빈 배열', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'ID')
    expect(computeWarnings(m)).toEqual([])
  })
})
