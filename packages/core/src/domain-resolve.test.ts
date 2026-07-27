import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { resolveColumn } from './domain-resolve.js'

function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
  return m
}
const col = (over = {}) => ({ id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A',
  type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
  order: 0, comment: null, domainId: null, custom: {}, ...over })

describe('resolveColumn', () => {
  it('직접입력 컬럼은 타입을 그대로 변환', () => {
    const m = base(); m.columns['c'] = col({ type: 'VARCHAR(10)' })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('varchar(10)')
  })
  it('도메인 컬럼은 방언 오버라이드 우선, 없으면 논리타입 변환', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '금액', category: null, logicalType: 'DECIMAL(15,0)',
      dialectTypes: { postgresql: 'numeric(15)', mysql: null, oracle: null, mssql: null },
      defaultValue: '0', allowedValues: [], description: null }
    m.columns['c'] = col({ domainId: 'd', defaultValue: null })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('numeric(15)')
    expect(resolveColumn(m.columns['c']!, m, 'mysql').sql).toBe('DECIMAL(15,0)') // 논리타입 변환
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').defaultValue).toBe('0') // 도메인 기본값
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').logicalType).toBe('DECIMAL(15,0)')
  })
  it('컬럼 defaultValue가 도메인보다 우선', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null }
    m.columns['c'] = col({ domainId: 'd', type: 'INT', defaultValue: "'Y'" })
    const r = resolveColumn(m.columns['c']!, m, 'postgresql')
    expect(r.defaultValue).toBe("'Y'")
    expect(r.checkValues).toEqual(['Y', 'N'])
  })
})
