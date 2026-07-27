import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { createIndex, updateIndex, removeIndex } from './table-index.js'
import { createEmptyModel, type Column, type ProjectModel, type Table } from './model.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string): Column {
  return { id, tableId, logicalName: id, physicalName: id.toUpperCase(), type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: null,
    custom: {} }
}
function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['T'] = tbl('T')
  m.columns['C1'] = col('C1', 'T')
  m.columns['C2'] = col('C2', 'T')
  return m
}

describe('createIndex', () => {
  it('빈 컬럼·unique 기본 false로 인덱스를 만든다', () => {
    const next = createIndex(base(), { id: 'IX', tableId: 'T', name: 'IX_T_1' })
    expect(next.indexes['IX']).toMatchObject({ id: 'IX', tableId: 'T', name: 'IX_T_1', unique: false, columns: [] })
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('컬럼·unique 지정 생성 후 무결성 통과', () => {
    const next = createIndex(base(), {
      id: 'IX', tableId: 'T', name: 'UX_T', unique: true,
      columns: [{ columnId: 'C1', direction: 'asc' }, { columnId: 'C2', direction: 'desc' }],
    })
    expect(next.indexes['IX']!.unique).toBe(true)
    expect(next.indexes['IX']!.columns).toHaveLength(2)
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 테이블·중복 id는 no-op', () => {
    const m = base()
    expect(createIndex(m, { id: 'IX', tableId: 'NONE', name: 'x' })).toBe(m)
    const withIx = createIndex(m, { id: 'IX', tableId: 'T', name: 'a' })
    expect(createIndex(withIx, { id: 'IX', tableId: 'T', name: 'b' }).indexes['IX']!.name).toBe('a')
  })
})

describe('updateIndex', () => {
  it('이름·유니크·컬럼을 바꾼다', () => {
    const m = createIndex(base(), { id: 'IX', tableId: 'T', name: 'a' })
    const next = updateIndex(m, 'IX', { name: 'b', unique: true, columns: [{ columnId: 'C1', direction: 'desc' }] })
    expect(next.indexes['IX']).toMatchObject({ name: 'b', unique: true })
    expect(next.indexes['IX']!.columns).toEqual([{ columnId: 'C1', direction: 'desc' }])
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 인덱스는 no-op', () => {
    const m = base()
    expect(updateIndex(m, 'X', { name: 'y' })).toBe(m)
  })
})

describe('removeIndex', () => {
  it('인덱스를 지운다', () => {
    const m = createIndex(base(), { id: 'IX', tableId: 'T', name: 'a' })
    const next = removeIndex(m, 'IX')
    expect(next.indexes['IX']).toBeUndefined()
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 인덱스는 no-op', () => {
    const m = base()
    expect(removeIndex(m, 'X')).toBe(m)
  })
})
