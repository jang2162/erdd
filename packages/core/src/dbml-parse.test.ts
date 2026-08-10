import { describe, expect, it } from 'vitest'
import { parseDbml } from './dbml-parse.js'

describe('parseDbml — Table', () => {
  it('컬럼과 설정을 읽는다', () => {
    const p = parseDbml(`
Table "MBR" [note: '회원 - 회원 기본정보'] {
  "MBR_NO" bigint [pk, increment, note: '회원번호']
  "MBR_NM" varchar(100) [not null, note: '회원명']
  "STTS" varchar(2) [default: '01']
}`)
    expect(p.tables).toHaveLength(1)
    expect(p.tables[0]!.name).toBe('MBR')
    expect(p.tables[0]!.columns[0]).toMatchObject({
      name: 'MBR_NO', rawType: 'bigint', inlinePk: true, autoIncrement: true, notNull: false,
    })
    expect(p.tables[0]!.columns[1]).toMatchObject({ name: 'MBR_NM', notNull: true })
    expect(p.tables[0]!.columns[2]!.defaultValue).toBe("'01'")
    expect(p.comments).toContainEqual({ table: 'MBR', column: null, text: '회원 - 회원 기본정보' })
    expect(p.comments).toContainEqual({ table: 'MBR', column: 'MBR_NO', text: '회원번호' })
  })

  it('따옴표 없는 식별자와 별칭을 읽는다', () => {
    const p = parseDbml('Table users as U {\n  id int [pk]\n}')
    expect(p.tables[0]!.name).toBe('users')
    expect(p.tables[0]!.columns[0]!.name).toBe('id')
  })

  it('주석을 무시한다', () => {
    const p = parseDbml(`
// 줄 주석
/* 블록
   주석 */
Table "MBR" {
  "MBR_NO" bigint [pk] // 꼬리 주석
}`)
    expect(p.tables).toHaveLength(1)
    expect(p.tables[0]!.columns).toHaveLength(1)
  })

  it('문자열 안의 주석 기호는 주석이 아니다', () => {
    const p = parseDbml("Table \"T\" {\n  \"C\" int [note: 'a // b']\n}")
    expect(p.comments[0]!.text).toBe('a // b')
  })

  it('트리플 쿼트 note 를 읽는다', () => {
    const p = parseDbml("Table \"T\" {\n  \"C\" int [note: '''두\n줄''']\n}")
    expect(p.comments[0]!.text).toBe('두\n줄')
  })

  it('컬럼 unique 설정을 UNIQUE 제약으로 낸다', () => {
    const p = parseDbml('Table "T" {\n  "C" int [unique]\n}')
    expect(p.constraints).toContainEqual({ kind: 'unique', table: 'T', name: null, columns: ['C'] })
  })

  it('primary key 를 pk 와 같게 읽는다', () => {
    const p = parseDbml('Table "T" {\n  "C" int [primary key]\n}')
    expect(p.tables[0]!.columns[0]!.inlinePk).toBe(true)
  })

  it('Project 의 database_type 을 읽는다', () => {
    const p = parseDbml("Project \"P\" {\n  database_type: 'Oracle'\n}")
    expect(p.databaseType).toBe('Oracle')
  })

  it('모르는 최상위 블록은 건너뛰고 경고한다', () => {
    const p = parseDbml('Enum status {\n  a\n  b\n}\nTable "T" {\n  "C" int\n}')
    expect(p.tables).toHaveLength(1)
    expect(p.skipped.map((s) => s.keyword)).toContain('Enum')
  })

  it('닫히지 않은 블록에서 죽지 않는다', () => {
    expect(() => parseDbml('Table "T" {\n  "C" int')).not.toThrow()
  })
})

describe('dbmlDefaultToRaw', () => {
  it('DBML 값 표현을 모델 원문으로 되돌린다', async () => {
    const { dbmlDefaultToRaw } = await import('./dbml-parse.js')
    expect(dbmlDefaultToRaw("'ACTIVE'")).toBe("'ACTIVE'")
    expect(dbmlDefaultToRaw('0')).toBe('0')
    expect(dbmlDefaultToRaw('true')).toBe('TRUE')
    expect(dbmlDefaultToRaw('null')).toBe('NULL')
    expect(dbmlDefaultToRaw('`now()`')).toBe('now()')
  })
})
