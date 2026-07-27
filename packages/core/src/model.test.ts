import { describe, expect, it } from 'vitest'
import { ColumnSchema, ProjectModelSchema, TableSchema, createEmptyModel } from './model.js'

describe('model schemas', () => {
  it('createEmptyModel returns all ten empty collections', () => {
    expect(createEmptyModel()).toEqual({
      tables: {},
      columns: {},
      relationships: {},
      indexes: {},
      notes: {},
      tableGroups: {},
      domains: {},
      words: {},
      terms: {},
      customFields: {},
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
    expect(TableSchema.parse(table)).toEqual({ ...table, custom: {} })
    expect(() => TableSchema.parse({ ...table, extra: 1 })).toThrow()
  })

  it('TableSchema/ColumnSchema default custom to {} when omitted (구 리비전 하위호환)', () => {
    const legacyTable = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null,
      // custom 의도적으로 생략 — custom 필드가 없던 구 리비전 데이터를 흉내
    }
    expect(TableSchema.parse(legacyTable).custom).toEqual({})

    const legacyColumn = {
      id: 'c1', tableId: 't1', logicalName: '이름', physicalName: 'NAME', type: 'varchar',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
      comment: null,
      // custom·domainId 의도적으로 생략
    }
    expect(ColumnSchema.parse(legacyColumn).custom).toEqual({})
  })

  it('ProjectModelSchema defaults customFields to {} when omitted (구 스냅샷 하위호환)', () => {
    const legacyModel = {
      tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
      tableGroups: {}, domains: {},
      // words/terms/customFields 생략
    }
    const parsed = ProjectModelSchema.parse(legacyModel)
    expect(parsed.customFields).toEqual({})
  })

  it('ColumnSchema rejects a column missing required fields', () => {
    expect(() => ColumnSchema.parse({ id: 'c1', tableId: 't1' })).toThrow()
  })

  it('ColumnSchema defaults domainId to null when omitted (구 리비전 하위호환)', () => {
    const legacyColumn = {
      id: 'c1',
      tableId: 't1',
      logicalName: '이름',
      physicalName: 'NAME',
      type: 'varchar',
      isPk: false,
      autoIncrement: false,
      nullable: true,
      defaultValue: null,
      order: 0,
      comment: null,
      // domainId 의도적으로 생략 — domainId 필드가 없던 구 리비전 데이터를 흉내
    }
    expect(ColumnSchema.parse(legacyColumn).domainId).toBeNull()
  })
})
