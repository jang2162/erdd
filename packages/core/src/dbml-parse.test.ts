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

describe('parseDbml — Ref', () => {
  it('> 는 왼쪽이 자식이다', () => {
    const p = parseDbml('Ref: "ORD"."MBR_NO" > "MBR"."MBR_NO"')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })

  it('< 는 방향을 뒤집어 정규화한다', () => {
    const p = parseDbml('Ref: "MBR"."MBR_NO" < "ORD"."MBR_NO"')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })

  it('- 는 oneToOne 이고 UNIQUE 제약을 만들지 않는다', () => {
    const p = parseDbml('Ref: "ORD"."MBR_NO" - "MBR"."MBR_NO"')
    expect(p.constraints.find((c) => c.kind === 'fk')).toMatchObject({ oneToOne: true })
    expect(p.constraints.filter((c) => c.kind === 'unique')).toEqual([])
  })

  it('이름 있는 Ref 의 이름을 보존한다', () => {
    const p = parseDbml('Ref "FK_ORD_MBR": "ORD"."MBR_NO" > "MBR"."MBR_NO"')
    expect(p.constraints[0]).toMatchObject({ name: 'FK_ORD_MBR' })
  })

  it('합성 FK 를 읽는다', () => {
    const p = parseDbml('Ref: "A".("X", "Y") > "B".("P", "Q")')
    expect(p.constraints[0]).toMatchObject({ columns: ['X', 'Y'], refColumns: ['P', 'Q'] })
  })

  it('블록형 Ref 를 읽는다', () => {
    const p = parseDbml('Ref {\n  "ORD"."MBR_NO" > "MBR"."MBR_NO"\n}')
    expect(p.constraints).toHaveLength(1)
  })

  it('인라인 ref 를 같은 제약으로 편다', () => {
    const p = parseDbml('Table "ORD" {\n  "MBR_NO" bigint [ref: > "MBR"."MBR_NO"]\n}')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })
})

describe('parseDbml — indexes·TableGroup', () => {
  it('indexes 블록을 읽는다', () => {
    const p = parseDbml(`
Table "MBR" {
  "A" int
  "B" int

  indexes {
    ("A", "B") [name: 'IX_MBR_01']
    ("A") [unique, name: 'UX_MBR_A']
  }
}`)
    expect(p.indexes).toEqual([
      { table: 'MBR', name: 'IX_MBR_01', columns: ['A', 'B'], unique: false },
      { table: 'MBR', name: 'UX_MBR_A', columns: ['A'], unique: true },
    ])
  })

  it('이름 없는 인덱스에 이름을 지어 준다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n\n  indexes {\n    ("A")\n  }\n}')
    expect(p.indexes[0]!.name).toBe('IX_MBR_1')
  })

  it('indexes 의 pk 는 PK 제약으로 낸다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n  "B" int\n\n  indexes {\n    ("A", "B") [pk]\n  }\n}')
    expect(p.constraints).toContainEqual({ kind: 'pk', table: 'MBR', columns: ['A', 'B'] })
    expect(p.indexes).toEqual([])
  })

  it('TableGroup 을 읽는다', () => {
    const p = parseDbml('TableGroup "회원 관리" [color: #0E7A6C] {\n  "MBR"\n  "ORD"\n}')
    expect(p.groups).toEqual([{ name: '회원 관리', color: '#0E7A6C', tables: ['MBR', 'ORD'] }])
  })

  it('color 가 없으면 소속 테이블의 headercolor 로 떨어진다', () => {
    const p = parseDbml(`
Table "MBR" [headercolor: #123456] {
  "A" int
}
TableGroup "회원" {
  "MBR"
}`)
    expect(p.groups[0]!.color).toBe('#123456')
  })

  it('color 도 headercolor 도 없으면 null 이다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n}\nTableGroup "회원" {\n  "MBR"\n}')
    expect(p.groups[0]!.color).toBeNull()
  })

  it('note 의 JSON 꼬리를 customValues 로 낸다', () => {
    const p = parseDbml(`
Table "MBR" [note: '회원 - 설명 {"보안등급":"2"}'] {
  "A" int [note: '컬럼 {"개인정보":"Y"}']
}`)
    expect(p.customValues).toContainEqual({ table: 'MBR', column: null, values: { 보안등급: '2' } })
    expect(p.customValues).toContainEqual({ table: 'MBR', column: 'A', values: { 개인정보: 'Y' } })
    expect(p.comments).toContainEqual({ table: 'MBR', column: null, text: '회원 - 설명' })
  })
})

describe('parseDbml — PK 정규화', () => {
  it('컬럼 설정 [pk] 를 테이블 수준 pk 제약으로도 낸다', () => {
    const p = parseDbml('Table "T" {\n  "A" int [pk]\n}')
    expect(p.constraints).toContainEqual({ kind: 'pk', table: 'T', columns: ['A'] })
    expect(p.tables[0]!.columns[0]!.inlinePk).toBe(true)   // inlinePk 도 그대로 둔다
  })

  it('인라인 [pk] 와 indexes 의 [pk] 가 둘 다 있으면 문서 순서대로 낸다(먼저 나온 것이 이긴다)', () => {
    const p = parseDbml(
      'Table "T" {\n  "A" int [pk]\n  "B" int\n\n  indexes {\n    ("A", "B") [pk]\n  }\n}',
    )
    expect(p.constraints.filter((c) => c.kind === 'pk')).toEqual([
      { kind: 'pk', table: 'T', columns: ['A'] },          // 인라인이 먼저
      { kind: 'pk', table: 'T', columns: ['A', 'B'] },      // indexes 블록이 뒤
    ])
  })
})
