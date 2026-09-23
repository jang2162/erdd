import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { projectSchema } from './projection.js'

const SETTINGS = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }

describe('projectSchema', () => {
  it('샘플 모델을 DDL 내보내기와 같은 이름·코멘트로 투영한다', () => {
    expect(projectSchema(buildSampleModel(), SETTINGS)).toEqual({
      tables: {
        t1: { id: 't1', name: 'MBR_GRD', comment: '회원등급', columnIds: ['c1'], primaryKey: ['c1'] },
        t2: {
          id: 't2', name: 'MBR', comment: '회원 - 서비스 가입 회원',
          columnIds: ['c2', 'c3', 'c4'], primaryKey: ['c2'],
        },
      },
      columns: {
        c1: { id: 'c1', tableId: 't1', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
        c2: { id: 'c2', tableId: 't2', name: 'MBR_NO', type: 'BIGINT', dialectTypes: {}, nullable: false, default: null, increment: true, comment: '회원번호', check: [] },
        c3: { id: 'c3', tableId: 't2', name: 'MBR_NM', type: 'VARCHAR(100)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '회원명', check: [] },
        c4: { id: 'c4', tableId: 't2', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
      },
      indexes: {
        i1: { id: 'i1', tableId: 't2', name: 'UX_MBR_01', columns: [{ columnId: 'c3', direction: 'asc' }], unique: true },
      },
      foreignKeys: {
        r1: {
          id: 'r1', name: 'FK_MBR_MBR_GRD', childTableId: 't2', childColumnIds: ['c4'],
          parentTableId: 't1', parentColumnIds: ['c1'], cardinality: '1:N', uniqueName: null,
        },
      },
    })
  })

  it('도메인을 쓰는 컬럼은 도메인의 타입·기본값·허용값과, 프로젝트 방언에 있는 오버라이드만 싣는다', () => {
    const m = buildSampleModel()
    m.domains['d1'] = {
      id: 'd1', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: 'BOOLEAN', mysql: '  ', oracle: null, mssql: 'BIT' },
      defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null, origin: null,
    }
    m.columns['c3'] = { ...m.columns['c3']!, domainId: 'd1' }
    const p = projectSchema(m, { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql', 'mysql'] })
    // mysql 은 공백뿐이라 빠지고, mssql 은 프로젝트 방언이 아니라 빠진다.
    expect(p.columns['c3']).toMatchObject({
      type: 'CHAR(1)', dialectTypes: { postgresql: 'BOOLEAN' }, default: "'N'", check: ['Y', 'N'],
    })
  })

  it('자동증가는 PK 이고 정수일 때만 켜지고, 그때 기본값은 싣지 않는다', () => {
    const m = buildSampleModel()
    m.columns['c2'] = { ...m.columns['c2']!, defaultValue: '0' }
    m.columns['c3'] = { ...m.columns['c3']!, autoIncrement: true }   // PK 가 아니다
    const p = projectSchema(m, SETTINGS)
    expect(p.columns['c2']).toMatchObject({ increment: true, default: null })
    expect(p.columns['c3']).toMatchObject({ increment: false })
  })

  it('명명 템플릿을 거친 실제 물리명을 쓰고 FK 이름도 그것을 따른다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{물리명}' }
    const p = projectSchema(buildSampleModel(), { rules, dialects: ['postgresql'] })
    expect(p.tables['t2']!.name).toBe('TB_MBR')
    expect(p.foreignKeys['r1']!.name).toBe('FK_TB_MBR_TB_MBR_GRD')
  })

  it('컬럼이 없거나 물리명이 빈 테이블은 빠지고, 거기 걸린 FK·인덱스도 빠진다', () => {
    const m = buildSampleModel()
    m.columns = Object.fromEntries(Object.entries(m.columns).filter(([, c]) => c.tableId !== 't1'))
    const p = projectSchema(m, SETTINGS)
    expect(Object.keys(p.tables)).toEqual(['t2'])
    expect(p.foreignKeys).toEqual({})

    const m2 = buildSampleModel()
    m2.tables['t2'] = { ...m2.tables['t2']!, physicalName: '' }
    const p2 = projectSchema(m2, SETTINGS)
    expect(Object.keys(p2.tables)).toEqual(['t1'])
    expect(p2.indexes).toEqual({})
    expect(p2.foreignKeys).toEqual({})
  })
})
