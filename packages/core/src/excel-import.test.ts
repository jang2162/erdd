import { describe, expect, it } from 'vitest'
import type { ProjectModel } from './model.js'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { DOMAIN_HEADERS, TERM_HEADERS, WORD_HEADERS } from './excel-sheets.js'
import { planDictImport, type RawSheet } from './excel-import.js'

const wordSheet = (rows: string[][]): RawSheet => ({ key: 'words', headers: [...WORD_HEADERS], rows })
const termSheet = (rows: string[][]): RawSheet => ({ key: 'terms', headers: [...TERM_HEADERS], rows })
const domainSheet = (rows: string[][]): RawSheet => ({ key: 'domains', headers: [...DOMAIN_HEADERS], rows })

function modelWith(): ProjectModel {
  return {
    ...createEmptyModel(),
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null },
    },
    domains: {
      d1: {
        id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null,
      },
    },
  }
}

describe('planDictImport — 단어', () => {
  it('신규 단어를 파싱한다', () => {
    const plan = planDictImport([wordSheet([['주문', 'ORD', 'ORDER', '주문 건']])], createEmptyModel())
    const draft = { logicalName: '주문', abbreviation: 'ORD', englishName: 'ORDER', description: '주문 건' }
    expect(plan.entries).toEqual([{ kind: 'word', row: 1, existingId: null, draft, patch: draft }])
    expect(plan.total).toEqual({ created: 1, duplicated: 0, errored: 0 })
  })

  it('빈 영문명·설명은 null이 된다', () => {
    const plan = planDictImport([wordSheet([['주문', 'ORD', '', '']])], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'word' && e.draft.englishName).toBeNull()
    expect(e.kind === 'word' && e.draft.description).toBeNull()
  })

  it('기존 단어와 논리명이 같으면 existingId가 잡힌다', () => {
    const plan = planDictImport([wordSheet([[' 회원 ', 'MBR', '', '']])], modelWith())
    expect(plan.entries[0]!.existingId).toBe('w1')
    expect(plan.total.duplicated).toBe(1)
  })

  it('논리명이 비면 error 이슈로 행을 건너뛴다', () => {
    const plan = planDictImport([wordSheet([['', 'ORD', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues).toEqual([
      { sheet: 'words', row: 1, level: 'error', message: '논리명이 비어 있습니다' },
    ])
    expect(plan.total.errored).toBe(1)
  })

  it('약어가 비어도 등록한다 (관대한 파싱)', () => {
    const plan = planDictImport([wordSheet([['주문', '', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues).toHaveLength(0)
  })

  it('모든 셀이 빈 행은 조용히 건너뛴다', () => {
    const plan = planDictImport([wordSheet([['', '', '', ''], ['주문', 'ORD', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]!.row).toBe(2)
    expect(plan.issues).toHaveLength(0)
  })

  it('같은 파일 안에서 논리명이 겹치면 뒤 행을 error로 건너뛴다', () => {
    const plan = planDictImport(
      [wordSheet([['주문', 'ORD', '', ''], ['주문', 'ORDR', '', '']])], createEmptyModel(),
    )
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues[0]).toMatchObject({ sheet: 'words', row: 2, level: 'error' })
    expect(plan.issues[0]!.message).toContain('1행')
  })

  it('헤더 순서가 달라도 이름으로 매칭하고 모르는 컬럼은 무시한다', () => {
    const sheet: RawSheet = {
      key: 'words', headers: ['비고', '약어', '논리명'], rows: [['메모', 'ORD', '주문']],
    }
    const plan = planDictImport([sheet], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'word' && e.draft).toMatchObject({ logicalName: '주문', abbreviation: 'ORD' })
  })

  it('키 헤더가 없으면 시트 전체를 건너뛰고 시트 단위 이슈를 남긴다', () => {
    const sheet: RawSheet = { key: 'words', headers: ['약어', '설명'], rows: [['ORD', 'x']] }
    const plan = planDictImport([sheet], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]).toMatchObject({ sheet: 'words', row: null, level: 'error' })
  })
})

describe('planDictImport — 도메인', () => {
  it('방언별 타입·허용값을 파싱한다', () => {
    const plan = planDictImport([domainSheet([
      ['등급코드', '코드', 'CHAR(2)', 'char(2)', '', '', '', "'01'", '01, 02 ,', '설명'],
    ])], createEmptyModel())
    const draft = {
      name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
      dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
      defaultValue: "'01'", allowedValues: ['01', '02'], description: '설명',
    }
    expect(plan.entries[0]).toEqual({ kind: 'domain', row: 1, existingId: null, draft, patch: draft })
  })

  it('허용값이 비면 빈 배열이다', () => {
    const plan = planDictImport([domainSheet([['코드', '', 'CHAR(2)', '', '', '', '', '', '', '']])], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'domain' && e.draft.allowedValues).toEqual([])
  })

  it('이름 또는 논리 타입이 비면 error로 건너뛴다', () => {
    const plan = planDictImport([domainSheet([
      ['', '', 'CHAR(2)', '', '', '', '', '', '', ''],
      ['코드', '', '', '', '', '', '', '', '', ''],
    ])], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues.map((i) => i.row)).toEqual([1, 2])
    expect(plan.issues[1]!.message).toContain('논리 타입')
  })

  it('기존 도메인과 이름이 같으면 existingId가 잡힌다', () => {
    const plan = planDictImport(
      [domainSheet([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])], modelWith(),
    )
    expect(plan.entries[0]!.existingId).toBe('d1')
  })

  it('도메인 시트의 파일 내 중복 메시지는 받침 있는 조사 "이"를 쓴다', () => {
    const plan = planDictImport([domainSheet([
      ['코드', '', 'CHAR(2)', '', '', '', '', '', '', ''],
      ['코드', '', 'CHAR(2)', '', '', '', '', '', '', ''],
    ])], createEmptyModel())
    expect(plan.issues[0]!.message).toBe('이름이 1행과 중복됩니다')
  })
})

describe('planDictImport — 용어', () => {
  it('구성 단어 컬럼은 무시하고 물리명·기본 도메인을 읽는다', () => {
    const plan = planDictImport(
      [termSheet([['회원번호', '아무거나', 'MBR_NO', '금액', '설명']])], modelWith(),
    )
    const draft = { logicalName: '회원번호', physicalName: 'MBR_NO', domainName: '금액', description: '설명' }
    expect(plan.entries[0]).toEqual({ kind: 'term', row: 1, existingId: null, draft, patch: draft })
    expect(plan.issues).toHaveLength(0)
  })

  it('물리명이 비면 단어 사전으로 자동 생성한다', () => {
    const plan = planDictImport(
      [termSheet([['회원', '', '', '', '']])], modelWith(), DEFAULT_NAMING_RULES,
    )
    const e = plan.entries[0]!
    expect(e.kind === 'term' && e.draft.physicalName).toBe('MBR')
  })

  it('물리명이 비고 rules가 없으면 error로 건너뛴다', () => {
    const plan = planDictImport([termSheet([['회원', '', '', '', '']])], modelWith())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]).toMatchObject({ sheet: 'terms', row: 1, level: 'error' })
  })

  it('물리명이 비고 단어 분해도 실패하면 error로 건너뛴다', () => {
    const plan = planDictImport(
      [termSheet([['미등록단어', '', '', '', '']])], createEmptyModel(), DEFAULT_NAMING_RULES,
    )
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]!.level).toBe('error')
  })

  it('찾을 수 없는 기본 도메인은 warning이고 행은 등록된다', () => {
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '없는도메인', '']])], modelWith())
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues[0]).toMatchObject({ sheet: 'terms', row: 1, level: 'warning' })
    expect(plan.total.errored).toBe(0)
  })

  it('같은 파일에서 새로 만들어지는 도메인은 warning을 내지 않는다', () => {
    const plan = planDictImport([
      termSheet([['회원번호', '', 'MBR_NO', '신규도메인', '']]),
      domainSheet([['신규도메인', '', 'CHAR(2)', '', '', '', '', '', '', '']]),
    ], createEmptyModel())
    expect(plan.issues).toHaveLength(0)
    expect(plan.entries).toHaveLength(2)
  })

  it('용어 시트의 키 누락 메시지는 받침 없는 조사 "가"를 쓴다', () => {
    const plan = planDictImport([termSheet([['', '', 'MBR_NO', '', '']])], createEmptyModel())
    expect(plan.issues[0]!.message).toBe('용어가 비어 있습니다')
  })

  it('찾을 수 없는 기본 도메인 경고는 받침에 맞는 목적격 조사를 쓴다', () => {
    const withJongseong = planDictImport([termSheet([['용어1', '', 'A', '없는도메인', '']])], createEmptyModel())
    expect(withJongseong.issues[0]!.message).toBe('기본 도메인 "없는도메인"을 찾을 수 없어 비웁니다')
    const withoutJongseong = planDictImport([termSheet([['용어2', '', 'A', '금리', '']])], createEmptyModel())
    expect(withoutJongseong.issues[0]!.message).toBe('기본 도메인 "금리"를 찾을 수 없어 비웁니다')
  })

  it('같은 파일의 단어만으로 물리명을 자동 생성한다 (모델 사전이 비어 있어도)', () => {
    const plan = planDictImport([
      wordSheet([['회원', 'MBR', '', ''], ['번호', 'NO', '', '']]),
      termSheet([['회원번호', '', '', '', '']]),
    ], createEmptyModel(), DEFAULT_NAMING_RULES)
    const term = plan.entries.find((e) => e.kind === 'term')!
    expect(term.kind === 'term' && term.draft.physicalName).toBe('MBR_NO')
    expect(plan.issues).toHaveLength(0)
  })

  it('논리명이 겹치면 파일의 단어가 기존 단어를 이긴다', () => {
    // modelWith()의 회원=MBR을 파일에서 MEM으로 다시 등록하면 자동 생성도 MEM을 쓴다.
    const plan = planDictImport([
      wordSheet([['회원', 'MEM', '', '']]),
      termSheet([['회원', '', '', '', '']]),
    ], modelWith(), DEFAULT_NAMING_RULES)
    const term = plan.entries.find((e) => e.kind === 'term')!
    expect(term.kind === 'term' && term.draft.physicalName).toBe('MEM')
  })
})

describe('planDictImport — 인식 컬럼과 부분 갱신값(patch)', () => {
  it('시트에 실제로 있는 알려진 컬럼만 recognizedColumns에 담는다', () => {
    const sheet: RawSheet = { key: 'words', headers: ['논리명', '약어', '비고'], rows: [['주문', 'ORD', 'x']] }
    const plan = planDictImport([sheet], createEmptyModel())
    expect(plan.recognizedColumns.words).toEqual(['논리명', '약어'])
    expect(plan.recognizedColumns.terms).toEqual([])
  })

  it('파생 컬럼 "구성 단어"는 인식 목록에 넣지 않는다', () => {
    const plan = planDictImport([termSheet([['회원번호', '회원, 번호', 'MBR_NO', '', '']])], createEmptyModel())
    expect(plan.recognizedColumns.terms).toEqual(['용어', '물리명', '기본 도메인', '설명'])
  })

  it('없는 컬럼은 patch에서 빠지고 draft에만 기본값으로 들어간다', () => {
    const sheet: RawSheet = { key: 'words', headers: ['논리명', '약어'], rows: [['주문', 'ORD']] }
    const e = planDictImport([sheet], createEmptyModel()).entries[0]!
    expect(e.patch).toEqual({ logicalName: '주문', abbreviation: 'ORD' })
    expect(e.draft).toEqual({
      logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null,
    })
  })

  it('컬럼이 있고 셀만 비면 patch에 null로 남는다 (빈 셀 ≠ 없는 컬럼)', () => {
    const e = planDictImport([wordSheet([['주문', 'ORD', '', '']])], createEmptyModel()).entries[0]!
    expect(e.patch).toEqual({
      logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null,
    })
  })

  it('도메인 방언 컬럼이 일부만 있으면 그 방언만 patch에 담는다', () => {
    const sheet: RawSheet = {
      key: 'domains', headers: ['이름', '논리 타입', 'PostgreSQL'], rows: [['코드', 'CHAR(2)', 'char(2)']],
    }
    const e = planDictImport([sheet], createEmptyModel()).entries[0]!
    expect(e.kind === 'domain' && e.patch.dialectTypes).toEqual({ postgresql: 'char(2)' })
    expect(e.kind === 'domain' && e.patch.allowedValues).toBeUndefined()
    expect(e.kind === 'domain' && e.draft.dialectTypes).toEqual({
      postgresql: 'char(2)', mysql: null, oracle: null, mssql: null,
    })
    expect(e.kind === 'domain' && e.draft.allowedValues).toEqual([])
  })

  it('물리명 컬럼이 없으면 자동 생성값은 draft에만 들어간다', () => {
    const sheet: RawSheet = { key: 'terms', headers: ['용어', '설명'], rows: [['회원', '설명']] }
    const e = planDictImport([sheet], modelWith(), DEFAULT_NAMING_RULES).entries[0]!
    expect(e.kind === 'term' && e.draft.physicalName).toBe('MBR')
    expect(e.kind === 'term' && 'physicalName' in e.patch).toBe(false)
  })
})

describe('planDictImport — 집계', () => {
  it('시트별·전체 건수를 집계한다', () => {
    const plan = planDictImport([
      wordSheet([['회원', 'MBR', '', ''], ['주문', 'ORD', '', ''], ['', '', '', 'x']]),
      domainSheet([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']]),
    ], modelWith())
    expect(plan.bySheet.words).toEqual({ created: 1, duplicated: 1, errored: 1 })
    expect(plan.bySheet.domains).toEqual({ created: 0, duplicated: 1, errored: 0 })
    expect(plan.bySheet.terms).toEqual({ created: 0, duplicated: 0, errored: 0 })
    expect(plan.total).toEqual({ created: 1, duplicated: 2, errored: 1 })
  })

  it('시트가 하나도 없으면 빈 계획을 낸다', () => {
    const plan = planDictImport([], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues).toHaveLength(0)
    expect(plan.total).toEqual({ created: 0, duplicated: 0, errored: 0 })
  })
})
