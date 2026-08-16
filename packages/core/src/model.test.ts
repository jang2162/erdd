import { describe, expect, it } from 'vitest'
import {
  ColumnSchema, ProjectModelSchema, TableSchema, TableGroupSchema, createEmptyModel,
  DomainSchema, WordSchema, TermSchema, CustomFieldSchema,
} from './model.js'

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

describe('origin (공용 리소스 원본 참조)', () => {
  const domainPayload = {
    id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  }

  it('origin을 생략하면 null로 파싱된다 (옛 op 페이로드·옛 스냅샷)', () => {
    expect(DomainSchema.parse(domainPayload).origin).toBeNull()
    expect(WordSchema.parse({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
    }).origin).toBeNull()
    expect(TermSchema.parse({
      id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: null, description: null,
    }).origin).toBeNull()
    expect(CustomFieldSchema.parse({
      id: 'f1', name: '개인정보여부', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null, order: 0,
    }).origin).toBeNull()
  })

  it('origin을 그대로 왕복한다', () => {
    const origin = {
      libraryId: 'lib1', sourceId: 'src1', sourceVersion: 3,
      base: { name: '금액', category: null },
    }
    expect(DomainSchema.parse({ ...domainPayload, origin }).origin).toEqual(origin)
  })

  it('origin에 알 수 없는 키가 있으면 거부한다', () => {
    const bad = { libraryId: 'l', sourceId: 's', sourceVersion: 1, base: {}, extra: 1 }
    expect(DomainSchema.safeParse({ ...domainPayload, origin: bad }).success).toBe(false)
  })
})

describe('WordSchema englishName', () => {
  it('englishName이 없는 옛 페이로드는 null로 파싱된다 (구 리비전 하위호환)', () => {
    const legacyWord = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null }
    expect(WordSchema.parse(legacyWord).englishName).toBeNull()
  })

  it('englishName 값을 그대로 보존한다', () => {
    const word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null,
    }
    expect(WordSchema.parse(word)).toEqual({ ...word, origin: null })
  })
})

describe('TableGroupSchema alias', () => {
  it('alias 가 없는 옛 페이로드를 파싱하면 빈 문자열이 된다', () => {
    // 별칭은 nullable 이 아니라 빈 문자열 기본값이다(설계 3.1) — null 이면 소비처마다 `?? ''` 가 붙는다.
    const legacy = { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null }
    expect(TableGroupSchema.parse(legacy).alias).toBe('')
  })

  it('alias 값을 그대로 보존한다', () => {
    const group = { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null, alias: 'MBR' }
    expect(TableGroupSchema.parse(group)).toEqual(group)
  })
})
