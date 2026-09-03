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

/**
 * 부호 없음은 **논리 타입의 1급 속성**이다(설계 D1). 정수 3종만 열고, 표기는 대문자 접미
 * `<KIND> UNSIGNED` 하나다. `parseLogicalType` 은 **모델 표기용이라 엄격하다** — 방언 원문
 * (`int(10) unsigned`·`tinyint unsigned`)을 관대하게 받는 것은 `splitSqlType` 의 일이다.
 */
describe('parseLogicalType — 부호 없음 접미', () => {
  const parsed = (s: string) => parseLogicalType(s)

  it('정수 3종은 UNSIGNED 접미를 받는다', () => {
    expect(parsed('INT UNSIGNED')).toEqual({
      ok: true, type: { kind: 'INT', unsigned: true }, canonical: 'INT UNSIGNED',
    })
    expect(canon('smallint unsigned')).toBe('SMALLINT UNSIGNED')
    expect(canon('bigint unsigned')).toBe('BIGINT UNSIGNED')
  })
  it('대소문자·공백을 정규화한다', () => {
    expect(canon('int unsigned')).toBe('INT UNSIGNED')
    expect(canon('INT   UNSIGNED')).toBe('INT UNSIGNED')
    expect(canon('  int   unsigned  ')).toBe('INT UNSIGNED')
  })
  it('별칭 해석은 접미 제거 뒤에 온다', () => {
    expect(canon('integer unsigned')).toBe('INT UNSIGNED')
  })
  it('부호 있는 정수는 unsigned:false 이고 canonical 이 바뀌지 않는다', () => {
    expect(parsed('INT')).toEqual({ ok: true, type: { kind: 'INT', unsigned: false }, canonical: 'INT' })
    expect(canon('bigint')).toBe('BIGINT')
  })
  it('전치 표기와 접미 단독은 실패한다', () => {
    expect(canon('UNSIGNED INT')).toBe('RAW:UNSIGNED INT')
    expect(canon('UNSIGNED')).toBe('RAW:UNSIGNED')
  })
  it('허용 집합 밖의 타입에는 붙지 않는다(설계 §4.2)', () => {
    expect(canon('decimal unsigned')).toBe('RAW:decimal unsigned')
    expect(canon('double unsigned')).toBe('RAW:double unsigned')
    expect(canon('boolean unsigned')).toBe('RAW:boolean unsigned')
    expect(canon('DECIMAL(10,2) UNSIGNED')).toBe('RAW:DECIMAL(10,2) UNSIGNED')
  })
  it('기존 표기는 변화가 없다', () => {
    expect(canon('VARCHAR(50)')).toBe('VARCHAR(50)')
    expect(canon('DOUBLE PRECISION')).toBe('DOUBLE')
  })
})
