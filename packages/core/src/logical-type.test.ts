import { describe, expect, it } from 'vitest'
import { parseLogicalType } from './logical-type.js'

describe('parseLogicalType', () => {
  it('parses INT and canonicalizes case', () => {
    expect(parseLogicalType('int')).toEqual({ ok: true, type: { kind: 'INT' }, canonical: 'INT' })
  })

  it('accepts INTEGER as alias of INT', () => {
    expect(parseLogicalType('INTEGER')).toMatchObject({ ok: true, canonical: 'INT' })
  })

  it('parses VARCHAR(n) and VARCHAR2 alias', () => {
    expect(parseLogicalType('varchar2(100)')).toEqual({
      ok: true,
      type: { kind: 'VARCHAR', length: 100 },
      canonical: 'VARCHAR(100)',
    })
  })

  it('rejects VARCHAR without length (length is required)', () => {
    expect(parseLogicalType('VARCHAR')).toEqual({ ok: false, raw: 'VARCHAR' })
  })

  it('parses DECIMAL(p,s) with scale defaulting to 0, NUMBER/NUMERIC aliases', () => {
    expect(parseLogicalType('NUMBER(15)')).toEqual({
      ok: true,
      type: { kind: 'DECIMAL', precision: 15, scale: 0 },
      canonical: 'DECIMAL(15,0)',
    })
  })

  it('returns ok:false with raw text for unknown types', () => {
    expect(parseLogicalType('geometry(Point,4326)')).toEqual({
      ok: false,
      raw: 'geometry(Point,4326)',
    })
  })

  it('accepts NUMERIC as alias of DECIMAL', () => {
    expect(parseLogicalType('NUMERIC(10,2)')).toMatchObject({ ok: true, canonical: 'DECIMAL(10,2)' })
  })

  it('parses DECIMAL directly', () => {
    expect(parseLogicalType('DECIMAL(8,3)')).toEqual({
      ok: true,
      type: { kind: 'DECIMAL', precision: 8, scale: 3 },
      canonical: 'DECIMAL(8,3)',
    })
  })
})
