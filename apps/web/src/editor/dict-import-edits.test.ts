import { describe, expect, it } from 'vitest'
import { createEmptyModel, planDictImport, type ProjectModel, type RawSheet } from '@erdd/core'
import { applyDictImport } from './dict-import-edits.js'

let counter = 0
const fakeId = () => `new-${++counter}`

const wordSheet = (rows: string[][]): RawSheet => ({
  key: 'words', headers: ['논리명', '약어', '영문명', '설명'], rows,
})
const termSheet = (rows: string[][]): RawSheet => ({
  key: 'terms', headers: ['용어', '구성 단어', '물리명', '기본 도메인', '설명'], rows,
})
const domainSheet = (rows: string[][]): RawSheet => ({
  key: 'domains',
  headers: ['이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명'],
  rows,
})

function modelWithExisting(): ProjectModel {
  return {
    ...createEmptyModel(),
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null },
    },
    domains: {
      d1: {
        id: 'd1', name: '금액', category: null, logicalType: 'INT',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null,
      },
    },
    columns: {
      c1: {
        id: 'c1', tableId: 't1', logicalName: '금액', physicalName: 'AMT', type: 'INT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
        comment: null, domainId: 'd1', custom: {},
      },
    },
  }
}

describe('applyDictImport', () => {
  it('신규 항목을 주입받은 id로 만든다', () => {
    counter = 0
    const plan = planDictImport([wordSheet([['주문', 'ORD', 'ORDER', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.words)).toEqual([
      { id: 'new-1', logicalName: '주문', abbreviation: 'ORD', englishName: 'ORDER', description: null },
    ])
  })

  it('skip 모드는 기존 항목을 건드리지 않는다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([wordSheet([['회원', 'MBR', 'MEMBER', '']])], base)
    const m = applyDictImport(base, plan, 'skip', fakeId)
    expect(m.words['w1']!.abbreviation).toBe('MB')
    expect(Object.keys(m.words)).toEqual(['w1'])
  })

  it('overwrite 모드는 기존 id를 유지한 채 값을 갱신한다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([wordSheet([['회원', 'MBR', 'MEMBER', '']])], base)
    const m = applyDictImport(base, plan, 'overwrite', fakeId)
    expect(Object.keys(m.words)).toEqual(['w1'])
    expect(m.words['w1']).toEqual({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null,
    })
  })

  it('도메인 덮어쓰기가 id를 유지해 컬럼의 domainId 참조가 살아남는다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport(
      [domainSheet([['금액', '통화', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])], base,
    )
    const m = applyDictImport(base, plan, 'overwrite', fakeId)
    expect(Object.keys(m.domains)).toEqual(['d1'])
    expect(m.domains['d1']!.logicalType).toBe('DECIMAL(15,2)')
    expect(m.columns['c1']!.domainId).toBe('d1')
  })

  it('용어의 기본 도메인을 기존 도메인 이름으로 해석한다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '금액', '']])], base)
    const m = applyDictImport(base, plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBe('d1')
  })

  it('같은 파일에서 새로 만들어진 도메인도 용어가 참조한다', () => {
    counter = 0
    const plan = planDictImport([
      termSheet([['회원번호', '', 'MBR_NO', '신규도메인', '']]),
      domainSheet([['신규도메인', '', 'CHAR(2)', '', '', '', '', '', '', '']]),
    ], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    const domainId = Object.values(m.domains)[0]!.id
    expect(Object.values(m.terms)[0]!.domainId).toBe(domainId)
  })

  it('해석할 수 없는 기본 도메인은 null이 된다', () => {
    counter = 0
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '없음', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBeNull()
  })

  it('기본 도메인이 비면 null이다', () => {
    counter = 0
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBeNull()
  })
})
