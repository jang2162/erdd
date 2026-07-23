import { describe, expect, it } from 'vitest'
import { ColumnSchema, TableSchema, createEmptyModel } from './model.js'

describe('model schemas', () => {
  it('createEmptyModel returns all six empty collections', () => {
    expect(createEmptyModel()).toEqual({
      tables: {},
      columns: {},
      relationships: {},
      indexes: {},
      notes: {},
      tableGroups: {},
    })
  })

  it('TableSchema accepts a complete table and rejects unknown keys', () => {
    const table = {
      id: 't1',
      logicalName: '회원',
      physicalName: 'MBR',
      comment: null,
      groupId: null,
      position: { x: 0, y: 0 },
      groupPosition: null,
    }
    expect(TableSchema.parse(table)).toEqual(table)
    expect(() => TableSchema.parse({ ...table, extra: 1 })).toThrow()
  })

  it('ColumnSchema rejects a column missing required fields', () => {
    expect(() => ColumnSchema.parse({ id: 'c1', tableId: 't1' })).toThrow()
  })
})
