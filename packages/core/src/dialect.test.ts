import { describe, expect, it } from 'vitest'
import { DIALECTS, fromDialectType, toDialectType, resolveColumnType } from './dialect.js'
import type { Dialect } from './dialect.js'
import { parseLogicalType } from './logical-type.js'
import type { LogicalType, LogicalTypeKind } from './logical-type.js'

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
    expect(conv('CHAR(1)', 'postgresql')).toBe('char(1)')
    expect(conv('CHAR(1)', 'mysql')).toBe('CHAR(1)')
    expect(conv('CHAR(1)', 'oracle')).toBe('CHAR(1)')
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

/** 왕복이 깨지는 조합. 설계 문서 §2의 표와 1:1 대응한다. */
const ROUND_TRIP_LOSSES: Array<{ kind: LogicalTypeKind; dialect: Dialect; readBack: LogicalTypeKind }> = [
  { kind: 'JSON', dialect: 'oracle', readBack: 'TEXT' },
  { kind: 'DATE', dialect: 'oracle', readBack: 'DATETIME' },
  { kind: 'TIME', dialect: 'oracle', readBack: 'DATETIME' },
  { kind: 'JSON', dialect: 'mssql', readBack: 'TEXT' },
  { kind: 'UUID', dialect: 'mysql', readBack: 'CHAR' },
]

const SAMPLE: Record<LogicalTypeKind, LogicalType> = {
  CHAR: { kind: 'CHAR', length: 10 },
  VARCHAR: { kind: 'VARCHAR', length: 100 },
  DECIMAL: { kind: 'DECIMAL', precision: 12, scale: 3 },
  TEXT: { kind: 'TEXT' }, SMALLINT: { kind: 'SMALLINT' }, INT: { kind: 'INT' },
  BIGINT: { kind: 'BIGINT' }, FLOAT: { kind: 'FLOAT' }, DOUBLE: { kind: 'DOUBLE' },
  BOOLEAN: { kind: 'BOOLEAN' }, DATE: { kind: 'DATE' }, TIME: { kind: 'TIME' },
  DATETIME: { kind: 'DATETIME' }, TIMESTAMPTZ: { kind: 'TIMESTAMPTZ' },
  BLOB: { kind: 'BLOB' }, JSON: { kind: 'JSON' }, UUID: { kind: 'UUID' },
}

describe('fromDialectType', () => {
  it('손실 목록에 없는 조합은 전부 왕복하고, 목록에 있는 조합은 반드시 깨진다', () => {
    const key = (k: string, d: string) => `${k}/${d}`
    const losses = new Map(ROUND_TRIP_LOSSES.map((l) => [key(l.kind, l.dialect), l.readBack]))
    for (const dialect of DIALECTS) {
      for (const kind of Object.keys(SAMPLE) as LogicalTypeKind[]) {
        const original = SAMPLE[kind]
        const sql = toDialectType(original, dialect)
        const back = fromDialectType(sql, dialect)
        expect(back.ok, `${kind}/${dialect} → ${sql} 를 읽지 못했다`).toBe(true)
        if (!back.ok) continue
        const expected = losses.get(key(kind, dialect))
        if (expected === undefined) {
          expect(back.type, `${kind}/${dialect} → ${sql} 는 왕복해야 한다`).toEqual(original)
        } else {
          expect(back.type.kind, `${kind}/${dialect} → ${sql}`).toBe(expected)
          expect(back.type, `${kind}/${dialect} 는 손실 목록에 있으므로 왕복하면 안 된다`)
            .not.toEqual(original)
        }
      }
    }
  })

  it('oracle NUMBER를 정밀도로 갈라 읽고 DECIMAL을 대안으로 남긴다', () => {
    expect(fromDialectType('NUMBER(1)', 'oracle')).toMatchObject({ type: { kind: 'BOOLEAN' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(5)', 'oracle')).toMatchObject({ type: { kind: 'SMALLINT' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(10)', 'oracle')).toMatchObject({ type: { kind: 'INT' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(19)', 'oracle')).toMatchObject({ type: { kind: 'BIGINT' }, alternatives: ['DECIMAL'] })
    // 위 넷에 없는 정밀도는 모호하지 않다.
    expect(fromDialectType('NUMBER(7)', 'oracle')).toMatchObject({
      type: { kind: 'DECIMAL', precision: 7, scale: 0 }, alternatives: [],
    })
    // scale이 있으면 정수 후보가 아니다 — NUMBER(10,0)이 INT로 읽히면 안 된다.
    expect(fromDialectType('NUMBER(10,0)', 'oracle')).toMatchObject({
      type: { kind: 'DECIMAL', precision: 10, scale: 0 }, alternatives: [],
    })
  })

  it('모호한 조합에 대안을 남긴다', () => {
    expect(fromDialectType('CLOB', 'oracle')).toMatchObject({ type: { kind: 'TEXT' }, alternatives: ['JSON'] })
    expect(fromDialectType('DATE', 'oracle')).toMatchObject({ type: { kind: 'DATETIME' }, alternatives: ['DATE'] })
    expect(fromDialectType('TIMESTAMP', 'oracle')).toMatchObject({ type: { kind: 'DATETIME' }, alternatives: ['TIME'] })
    expect(fromDialectType('NVARCHAR(MAX)', 'mssql')).toMatchObject({ type: { kind: 'TEXT' }, alternatives: ['JSON'] })
    expect(fromDialectType('TINYINT(1)', 'mysql')).toMatchObject({ type: { kind: 'BOOLEAN' }, alternatives: ['SMALLINT'] })
    expect(fromDialectType('CHAR(36)', 'mysql')).toMatchObject({
      type: { kind: 'CHAR', length: 36 }, alternatives: ['UUID'],
    })
  })

  it('자동증가 축약 타입을 정수로 읽는다', () => {
    expect(fromDialectType('serial', 'postgresql')).toMatchObject({ type: { kind: 'INT' } })
    expect(fromDialectType('bigserial', 'postgresql')).toMatchObject({ type: { kind: 'BIGINT' } })
  })

  it('모르는 타입은 원문을 보존한다', () => {
    expect(fromDialectType('GEOMETRY', 'mysql')).toEqual({ ok: false, raw: 'GEOMETRY' })
    expect(fromDialectType('NUMBER', 'oracle')).toEqual({ ok: false, raw: 'NUMBER' })
  })

  it('대소문자와 공백에 관대하다', () => {
    expect(fromDialectType('  varchar( 50 )  ', 'postgresql')).toMatchObject({
      type: { kind: 'VARCHAR', length: 50 },
    })
    expect(fromDialectType('timestamp with time zone', 'postgresql')).toMatchObject({
      type: { kind: 'TIMESTAMPTZ' },
    })
  })
})
