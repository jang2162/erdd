import { describe, expect, it } from 'vitest'
import { toDialectType, resolveColumnType } from './dialect.js'
import { parseLogicalType } from './logical-type.js'

const conv = (t: string, d: Parameters<typeof resolveColumnType>[1]) => {
  const p = parseLogicalType(t)
  if (!p.ok) throw new Error('parse fail')
  return toDialectType(p.type, d)
}

describe('toDialectType', () => {
  it('문자열 타입', () => {
    expect(conv('VARCHAR(100)', 'postgresql')).toBe('varchar(100)')
    expect(conv('VARCHAR(100)', 'oracle')).toBe('VARCHAR2(100)')
    expect(conv('VARCHAR(100)', 'mssql')).toBe('NVARCHAR(100)')
    expect(conv('CHAR(1)', 'mssql')).toBe('NCHAR(1)')
    expect(conv('TEXT', 'oracle')).toBe('CLOB')
    expect(conv('TEXT', 'mssql')).toBe('NVARCHAR(MAX)')
  })
  it('정수/실수', () => {
    expect(conv('INT', 'oracle')).toBe('NUMBER(10)')
    expect(conv('BIGINT', 'oracle')).toBe('NUMBER(19)')
    expect(conv('DECIMAL(15,2)', 'postgresql')).toBe('numeric(15,2)')
    expect(conv('DECIMAL(15,2)', 'oracle')).toBe('NUMBER(15,2)')
    expect(conv('DOUBLE', 'postgresql')).toBe('double precision')
    expect(conv('BOOLEAN', 'mysql')).toBe('TINYINT(1)')
    expect(conv('BOOLEAN', 'oracle')).toBe('NUMBER(1)')
  })
  it('일시/기타', () => {
    expect(conv('DATETIME', 'postgresql')).toBe('timestamp')
    expect(conv('DATETIME', 'oracle')).toBe('DATE')
    expect(conv('TIMESTAMPTZ', 'oracle')).toBe('TIMESTAMP WITH TIME ZONE')
    expect(conv('UUID', 'postgresql')).toBe('uuid')
    expect(conv('UUID', 'oracle')).toBe('RAW(16)')
    expect(conv('JSON', 'postgresql')).toBe('jsonb')
  })
})

describe('resolveColumnType', () => {
  it('파싱 성공은 방언 타입', () => {
    expect(resolveColumnType('varchar(50)', 'postgresql')).toEqual({ sql: 'varchar(50)' })
  })
  it('파싱 실패는 원문 그대로', () => {
    expect(resolveColumnType('geometry', 'postgresql')).toEqual({ sql: 'geometry' })
  })
  it('Oracle TIME은 TIMESTAMP + 경고', () => {
    const r = resolveColumnType('TIME', 'oracle')
    expect(r.sql).toBe('TIMESTAMP')
    expect(r.warning).toBeTruthy()
  })
})
