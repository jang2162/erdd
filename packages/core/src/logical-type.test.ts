import { describe, expect, it } from 'vitest'
import { parseLogicalType } from './logical-type.js'

const canon = (s: string) => { const r = parseLogicalType(s); return r.ok ? r.canonical : `RAW:${r.raw}` }

describe('parseLogicalType — 17종·별칭·정규화', () => {
  it('파라미터 없는 타입', () => {
    for (const t of ['TEXT', 'SMALLINT', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'BOOLEAN',
      'DATE', 'TIME', 'DATETIME', 'TIMESTAMPTZ', 'BLOB', 'JSON', 'UUID']) {
      expect(canon(t.toLowerCase())).toBe(t)
    }
  })
  it('길이 타입', () => {
    expect(canon('char(1)')).toBe('CHAR(1)')
    expect(canon('varchar(255)')).toBe('VARCHAR(255)')
  })
  it('DECIMAL scale 기본 0', () => {
    expect(canon('decimal(15)')).toBe('DECIMAL(15,0)')
    expect(canon('DECIMAL(18,2)')).toBe('DECIMAL(18,2)')
  })
  it('별칭 정규화', () => {
    expect(canon('integer')).toBe('INT')
    expect(canon('varchar2(100)')).toBe('VARCHAR(100)')
    expect(canon('numeric(10,2)')).toBe('DECIMAL(10,2)')
    expect(canon('number(5)')).toBe('DECIMAL(5,0)')
    expect(canon('timestamp')).toBe('DATETIME')
    expect(canon('bool')).toBe('BOOLEAN')
    expect(canon('double precision')).toBe('DOUBLE')
  })
  it('CHAR/VARCHAR 길이 누락은 실패', () => {
    expect(canon('varchar')).toBe('RAW:varchar')
    expect(canon('char')).toBe('RAW:char')
  })
  it('파라미터 없는 타입에 괄호가 오면 실패(원문 보존)', () => {
    expect(canon('int(11)')).toBe('RAW:int(11)')
  })
  it('미지의 벤더 타입은 원문 보존', () => {
    expect(canon('geometry')).toBe('RAW:geometry')
    expect(canon('')).toBe('RAW:')
  })
})
