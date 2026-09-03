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
  TEXT: { kind: 'TEXT' },
  // 정수 3종은 `unsigned` 가 **필수**다 — 이 리터럴이 타입 검사에 걸려야 정상이다(설계 §4.3).
  SMALLINT: { kind: 'SMALLINT', unsigned: false }, INT: { kind: 'INT', unsigned: false },
  BIGINT: { kind: 'BIGINT', unsigned: false }, FLOAT: { kind: 'FLOAT' }, DOUBLE: { kind: 'DOUBLE' },
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

/**
 * 부호 없음(설계 §4.4~4.5)과 정수 표시폭(§9 ①).
 *
 * ⚠️ `splitSqlType` 은 **접미를 이름에서 떼어내야** 방언별 전용 분기가 계속 맞는다 —
 * `tinyint unsigned` 의 이름이 `TINYINT UNSIGNED` 로 남으면 `fromMysql` 의 `TINYINT` 분기를
 * 못 타 `unknown-type` 으로 떨어진다(오늘은 파서가 접미를 잘라 우연히 살아 있다).
 */
describe('fromDialectType — 부호 없음 접미', () => {
  const from = (t: string, d: Dialect) => {
    const r = fromDialectType(t, d)
    return r.ok ? { canonical: r.canonical, dropped: r.unsignedDropped } : { canonical: `RAW:${r.raw}` }
  }

  it('정수 3종의 접미를 읽는다', () => {
    expect(from('int unsigned', 'mysql')).toEqual({ canonical: 'INT UNSIGNED', dropped: false })
    expect(from('smallint unsigned', 'mysql')).toEqual({ canonical: 'SMALLINT UNSIGNED', dropped: false })
    expect(from('bigint unsigned', 'mysql')).toEqual({ canonical: 'BIGINT UNSIGNED', dropped: false })
  })
  it('네 방언 모두 같게 읽는다 — 읽는 시점의 방언으로 모델 값을 깎지 않는다(§4.6)', () => {
    for (const d of DIALECTS) {
      expect(from('INT UNSIGNED', d)).toEqual({ canonical: 'INT UNSIGNED', dropped: false })
    }
  })
  it('⚠️ tinyint unsigned 회귀 — 이름이 TINYINT 로 남아 mysql 분기를 탄다', () => {
    expect(from('tinyint unsigned', 'mysql')).toEqual({ canonical: 'SMALLINT UNSIGNED', dropped: false })
  })
  it('허용 집합 밖은 부호 없음만 떨어뜨리고 그 사실을 싣는다', () => {
    expect(from('tinyint(1) unsigned', 'mysql')).toEqual({ canonical: 'BOOLEAN', dropped: true })
    expect(from('decimal(10,2) unsigned', 'mysql')).toEqual({ canonical: 'DECIMAL(10,2)', dropped: true })
    expect(from('double unsigned', 'mysql')).toEqual({ canonical: 'DOUBLE', dropped: true })
  })
  it('ZEROFILL 은 삼키고 버린다 — UNSIGNED 를 함의하지 않는다(§10.5)', () => {
    expect(from('int zerofill', 'mysql')).toEqual({ canonical: 'INT', dropped: false })
    expect(from('int unsigned zerofill', 'mysql')).toEqual({ canonical: 'INT UNSIGNED', dropped: false })
  })
  it('기존 분해가 그대로다', () => {
    expect(from('NVARCHAR(MAX)', 'mssql')).toEqual({ canonical: 'TEXT', dropped: false })
    expect(from('double precision', 'postgresql')).toEqual({ canonical: 'DOUBLE', dropped: false })
    expect(from('timestamp with time zone', 'postgresql')).toEqual({ canonical: 'TIMESTAMPTZ', dropped: false })
    expect(from('number(10,2)', 'oracle')).toEqual({ canonical: 'DECIMAL(10,2)', dropped: false })
  })
})

/** MySQL 5.7 의 `mysqldump`·`SHOW CREATE TABLE` 이 내는 표준 모양(설계 §9 ①·§3.4 가). */
describe('fromDialectType — 정수 표시폭', () => {
  const canon = (t: string, d: Dialect) => {
    const r = fromDialectType(t, d)
    return r.ok ? r.canonical : `RAW:${r.raw}`
  }

  it('mysql 의 표시폭은 무시한다', () => {
    expect(canon('int(11)', 'mysql')).toBe('INT')
    expect(canon('bigint(20)', 'mysql')).toBe('BIGINT')
    expect(canon('smallint(5)', 'mysql')).toBe('SMALLINT')
    expect(canon('int(10) unsigned', 'mysql')).toBe('INT UNSIGNED')
    expect(canon('bigint(20) unsigned', 'mysql')).toBe('BIGINT UNSIGNED')
  })
  it('tinyint(1)·tinyint(3) 의 기존 분기는 그대로다', () => {
    expect(canon('tinyint(1)', 'mysql')).toBe('BOOLEAN')
    expect(canon('tinyint(3)', 'mysql')).toBe('SMALLINT')
  })
  it('표시폭은 mysql 전용이다 — 다른 방언에서 정수에 괄호가 오면 원문을 보존한다', () => {
    expect(canon('int(11)', 'postgresql')).toBe('RAW:int(11)')
    expect(canon('int(11)', 'mssql')).toBe('RAW:int(11)')
  })
})

describe('toDialectType — 부호 없음', () => {
  const conv2 = (t: string, d: Dialect) => {
    const p = parseLogicalType(t)
    if (!p.ok) throw new Error('parse fail')
    return toDialectType(p.type, d)
  }
  it('mysql 만 접미를 낸다 — 나머지는 기본 타입이고 CHECK 가 의미를 나른다(§4.5)', () => {
    expect(conv2('INT UNSIGNED', 'mysql')).toBe('INT UNSIGNED')
    expect(conv2('BIGINT UNSIGNED', 'mysql')).toBe('BIGINT UNSIGNED')
    expect(conv2('SMALLINT UNSIGNED', 'mysql')).toBe('SMALLINT UNSIGNED')
    expect(conv2('INT UNSIGNED', 'postgresql')).toBe('integer')
    expect(conv2('INT UNSIGNED', 'mssql')).toBe('INT')
    expect(conv2('INT UNSIGNED', 'oracle')).toBe('NUMBER(10)')
  })
})

describe('resolveColumnType — 부호 없음 상한 경고(§4.5 표)', () => {
  const warn = (t: string, d: Dialect) => resolveColumnType(t, d).warning
  it('mysql 은 경고가 없다', () => {
    for (const t of ['SMALLINT UNSIGNED', 'INT UNSIGNED', 'BIGINT UNSIGNED']) {
      expect(warn(t, 'mysql')).toBeUndefined()
    }
  })
  it('postgresql·mssql 은 정수 3종 모두 경고한다', () => {
    for (const d of ['postgresql', 'mssql'] as const) {
      for (const t of ['SMALLINT UNSIGNED', 'INT UNSIGNED', 'BIGINT UNSIGNED']) {
        expect(warn(t, d)).toMatch(/CHECK/)
      }
    }
  })
  it('oracle 은 BIGINT UNSIGNED 만 경고한다 — NUMBER(5)·NUMBER(10) 은 상한이 넉넉하다', () => {
    expect(warn('SMALLINT UNSIGNED', 'oracle')).toBeUndefined()
    expect(warn('INT UNSIGNED', 'oracle')).toBeUndefined()
    expect(warn('BIGINT UNSIGNED', 'oracle')).toMatch(/CHECK/)
  })
  it('부호 있는 정수는 경고가 없다', () => {
    for (const d of DIALECTS) expect(warn('INT', d)).toBeUndefined()
  })
})
