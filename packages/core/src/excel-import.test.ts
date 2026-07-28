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
    expect(plan.entries).toEqual([{
      kind: 'word', row: 1, existingId: null,
      draft: { logicalName: '주문', abbreviation: 'ORD', englishName: 'ORDER', description: '주문 건' },
    }])
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
    expect(plan.entries[0]).toEqual({
      kind: 'domain', row: 1, existingId: null,
      draft: {
        name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
        defaultValue: "'01'", allowedValues: ['01', '02'], description: '설명',
      },
    })
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
})

describe('planDictImport — 용어', () => {
  it('구성 단어 컬럼은 무시하고 물리명·기본 도메인을 읽는다', () => {
    const plan = planDictImport(
      [termSheet([['회원번호', '아무거나', 'MBR_NO', '금액', '설명']])], modelWith(),
    )
    expect(plan.entries[0]).toEqual({
      kind: 'term', row: 1, existingId: null,
      draft: { logicalName: '회원번호', physicalName: 'MBR_NO', domainName: '금액', description: '설명' },
    })
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
