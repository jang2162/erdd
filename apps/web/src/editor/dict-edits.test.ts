import { describe, expect, it } from 'vitest'
import { createEmptyModel, DEFAULT_NAMING_RULES, type NamingRules, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import {
  createWord, updateWord, removeWord,
  createTerm, updateTerm, removeTerm,
  buildUsageIndex, wordUsage, termUsage, unregisteredWords, unregisteredAbbreviations,
  planTermPropagation, applyTermPropagation,
  canRegisterWord, canRegisterTerm,
} from './dict-edits.js'

const word = (id: string, over = {}) => (
  { id, logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null, origin: null, ...over }
)
const term = (id: string, over = {}) => (
  { id, logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: null, origin: null, ...over }
)
const table = (id: string, logicalName: string) => (
  { id, logicalName, physicalName: '', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
)
const column = (id: string, tableId: string, logicalName: string) => ({
  id, tableId, logicalName, physicalName: '', type: 'INT',
  isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: null,
  custom: {},
})

describe('dict-edits', () => {
  it('createWord/updateWord/removeWord', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1'))
    expect(m.words['w1']!.abbreviation).toBe('ORD')
    m = updateWord(m, 'w1', { abbreviation: 'ORDER' })
    expect(m.words['w1']!.abbreviation).toBe('ORDER')
    m = removeWord(m, 'w1')
    expect(m.words['w1']).toBeUndefined()
  })

  it('removeWord는 가드 없이 사용 중이어도 삭제된다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1'))
    m.tables['t'] = table('t', '주문')
    expect(wordUsage(m, 'w1', DEFAULT_NAMING_RULES)).toHaveLength(1)
    m = removeWord(m, 'w1')
    expect(m.words['w1']).toBeUndefined()
  })

  it('createTerm/updateTerm/removeTerm', () => {
    let m = createEmptyModel()
    m = createTerm(m, term('t1'))
    expect(m.terms['t1']!.physicalName).toBe('ORD_NO')
    m = updateTerm(m, 't1', { physicalName: 'ORDER_NO' })
    expect(m.terms['t1']!.physicalName).toBe('ORDER_NO')
    m = removeTerm(m, 't1')
    expect(m.terms['t1']).toBeUndefined()
  })

  it('removeTerm은 가드 없이 사용 중이어도 삭제된다', () => {
    let m = createEmptyModel()
    m = createTerm(m, term('t1'))
    m.tables['t'] = table('t', '주문번호')
    expect(termUsage(m, 't1')).toHaveLength(1)
    m = removeTerm(m, 't1')
    expect(m.terms['t1']).toBeUndefined()
  })

  it('wordUsage: 논리명 분해에 그 단어가 쓰인 테이블/컬럼을 반환한다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '주문', abbreviation: 'ORD' }))
    m = createWord(m, word('w2', { logicalName: '번호', abbreviation: 'NO' }))
    m.tables['t'] = table('t', '주문번호')
    m.columns['c'] = column('c', 't', '고객명')

    const usageW1 = wordUsage(m, 'w1', DEFAULT_NAMING_RULES)
    expect(usageW1).toHaveLength(1)
    expect(usageW1[0]).toEqual({ kind: 'table', entity: m.tables['t'] })

    const usageW2 = wordUsage(m, 'w2', DEFAULT_NAMING_RULES)
    expect(usageW2).toHaveLength(1)
    expect(usageW2[0]).toEqual({ kind: 'table', entity: m.tables['t'] })
  })

  it('wordUsage: 컬럼도 대상이 되고, 관련 없는 단어는 빈 배열을 반환한다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '번호', abbreviation: 'NO' }))
    m = createWord(m, word('unused', { logicalName: '쿠폰', abbreviation: 'CPN' }))
    m.tables['t'] = table('t', '주문')
    m.columns['c'] = column('c', 't', '주문번호')

    const usage = wordUsage(m, 'w1', DEFAULT_NAMING_RULES)
    expect(usage).toEqual([{ kind: 'column', entity: m.columns['c'] }])
    expect(wordUsage(m, 'unused', DEFAULT_NAMING_RULES)).toEqual([])
  })

  it('wordUsage: 완전일치 용어가 있으면 그 논리명은 단어 분해를 거치지 않는다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '주문', abbreviation: 'ORD' }))
    m = createTerm(m, term('term1', { logicalName: '주문번호', physicalName: 'ORD_NO' }))
    m.tables['t'] = table('t', '주문번호')

    expect(wordUsage(m, 'w1', DEFAULT_NAMING_RULES)).toEqual([])
  })

  it('termUsage: 논리명이 term.logicalName과 일치하는 table/column을 반환한다', () => {
    let m = createEmptyModel()
    m = createTerm(m, term('term1', { logicalName: '주문번호', physicalName: 'ORD_NO' }))
    m.tables['t'] = table('t', '주문번호')
    m.columns['c'] = column('c', 't', '고객명')

    expect(termUsage(m, 'term1')).toEqual([{ kind: 'table', entity: m.tables['t'] }])
    expect(termUsage(m, 'nope')).toEqual([])
  })

  it('unregisteredWords: 전 테이블·컬럼 논리명 분해의 unknownWords 합집합을 dedupe해 반환한다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '주문', abbreviation: 'ORD' }))
    m.tables['t'] = table('t', '주문상태')
    m.columns['c'] = column('c', 't', '주문상태')

    expect(unregisteredWords(m, DEFAULT_NAMING_RULES)).toEqual(['상태'])
  })

  it('unregisteredWords: 미등록 단어가 없으면 빈 배열', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '주문', abbreviation: 'ORD' }))
    m.tables['t'] = table('t', '주문')

    expect(unregisteredWords(m, DEFAULT_NAMING_RULES)).toEqual([])
  })
})

describe('unregisteredAbbreviations', () => {
  const rules = DEFAULT_NAMING_RULES

  it('사전에 없는 약어만 모은다', () => {
    let m = buildSampleModel()
    m = { ...m, words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } } }
    // 픽스처: t1=MBR_GRD, t2=MBR, c1=GRD_CD, c2=MBR_NO, c3=MBR_NM, c4=GRD_CD
    const out = unregisteredAbbreviations(m, rules)
    expect(out).not.toContain('MBR')          // 사전에 있다
    expect(out).toContain('GRD')
    expect(out).toContain('CD')
    expect(out).toContain('NO')
    expect(out).toContain('NM')
  })

  it('중복을 제거한다', () => {
    const out = unregisteredAbbreviations(buildSampleModel(), rules)
    expect(out.length).toBe(new Set(out).size)
  })

  // ⚠️ 없으면 "전부 모은다"는 구현도 위를 통과한다.
  it('모든 약어가 사전에 있으면 빈 배열이다', () => {
    let m = buildSampleModel()
    m = { ...m, words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null },
      w2: { id: 'w2', logicalName: '등급', abbreviation: 'GRD', englishName: null, description: null, origin: null },
      w3: { id: 'w3', logicalName: '코드', abbreviation: 'CD', englishName: null, description: null, origin: null },
      w4: { id: 'w4', logicalName: '번호', abbreviation: 'NO', englishName: null, description: null, origin: null },
      w5: { id: 'w5', logicalName: '명', abbreviation: 'NM', englishName: null, description: null, origin: null },
    } }
    expect(unregisteredAbbreviations(m, rules)).toEqual([])
  })
})

/**
 * 전파 테스트용 모델: 용어 '주문번호'(ORD_NO)를 테이블 1개·컬럼 2개가 쓰고 있다.
 * 기존 table()/column() 헬퍼는 physicalName이 ''이라 스프레드로 덮어쓴다.
 */
function propagationModel() {
  let m = createEmptyModel()
  m = createTerm(m, term('tm1'))                     // 주문번호 / ORD_NO / domainId null
  m = {
    ...m,
    domains: {
      d1: {
        id: 'd1', name: '번호', category: null, logicalType: 'BIGINT',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      },
      d2: {
        id: 'd2', name: '코드', category: null, logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      },
    },
    tables: {
      t1: { ...table('t1', '주문번호'), physicalName: 'ORD_NO' },   // 용어와 논리명이 같은 테이블
      t2: { ...table('t2', '주문'), physicalName: 'ORD' },          // 무관한 테이블(컬럼 소속용)
    },
    columns: {
      c1: { ...column('c1', 't2', '주문번호'), physicalName: 'ORD_NO' },
      c2: { ...column('c2', 't2', '주문번호'), physicalName: 'OLD_NO', domainId: 'd2' },
      c3: { ...column('c3', 't2', '주문일자'), physicalName: 'ORD_DT' },  // 무관한 컬럼
    },
  }
  return m
}

describe('planTermPropagation / applyTermPropagation', () => {
  it('물리명만 바뀌면 물리명만 전파하고 논리명은 건드리지 않는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    // t1·c1·c2 모두 물리명이 ORDER_NO와 다르므로 대상, c3는 논리명이 달라 제외
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2', 't1'])
    expect(plan.entries.every((e) => e.changes.every((c) => c.field === 'physicalName'))).toBe(true)

    const next = applyTermPropagation(m, plan)
    expect(next.tables.t1!.physicalName).toBe('ORDER_NO')
    expect(next.tables.t1!.logicalName).toBe('주문번호')      // 논리명 불변
    expect(next.columns.c1!.physicalName).toBe('ORDER_NO')
    expect(next.columns.c2!.physicalName).toBe('ORDER_NO')
    expect(next.columns.c3!.physicalName).toBe('ORD_DT')      // 무관한 컬럼 불변
  })

  it('논리명이 바뀌면 수정 전 논리명 기준으로 사용처를 찾는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { logicalName: '주문식별번호' })
    // 수정 후 논리명('주문식별번호')으로 찾는 구현이면 매칭이 0건이 되어 이 단언이 실패한다.
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2', 't1'])

    const next = applyTermPropagation(m, plan)
    expect(next.tables.t1!.logicalName).toBe('주문식별번호')
    expect(next.columns.c1!.logicalName).toBe('주문식별번호')
    expect(next.columns.c3!.logicalName).toBe('주문일자')
  })

  it('테이블과 컬럼이 모두 대상에 들어간다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    expect(plan.entries.filter((e) => e.kind === 'table')).toHaveLength(1)
    expect(plan.entries.filter((e) => e.kind === 'column')).toHaveLength(2)
  })

  it('라벨은 수정 전 물리명 기준이고 컬럼은 소속 테이블을 앞에 붙인다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    const byId = Object.fromEntries(plan.entries.map((e) => [e.entityId, e.label]))
    expect(byId.t1).toBe('ORD_NO')
    expect(byId.c1).toBe('ORD.ORD_NO')
    expect(byId.c2).toBe('ORD.OLD_NO')
  })

  it('domainId가 null로 바뀌면 전파하지 않는다(컬럼 도메인 보존)', () => {
    let m = propagationModel()
    m = updateTerm(m, 'tm1', { domainId: 'd1' })        // 용어에 도메인이 있는 상태에서
    const plan = planTermPropagation(m, 'tm1', { domainId: null })
    expect(plan.entries).toEqual([])

    const next = applyTermPropagation(m, plan)
    expect(next.columns.c2!.domainId).toBe('d2')        // 기존 도메인 그대로
  })

  it('domainId가 null→값 / 값→다른 값이면 컬럼에만 전파한다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { domainId: 'd1' })
    // c1(null→d1)·c2(d2→d1)는 대상, t1은 테이블이라 domainId 필드가 없어 변경 없음 → 제외
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2'])
    expect(plan.entries.every((e) => e.changes.every((c) => c.field === 'domainId'))).toBe(true)

    const next = applyTermPropagation(m, plan)
    expect(next.columns.c1!.domainId).toBe('d1')
    expect(next.columns.c2!.domainId).toBe('d1')
  })

  it('바뀐 필드가 없으면 빈 계획이다(값이 같은 키가 patch에 있어도)', () => {
    const m = propagationModel()
    // 폼은 항상 모든 필드를 채워 보낸다 — 값이 같으면 전파 대상이 아니어야 한다.
    const plan = planTermPropagation(m, 'tm1', {
      logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: '설명만 바꿈',
    })
    expect(plan.entries).toEqual([])
  })

  it('사용처가 없거나 이미 값이 일치하는 엔티티는 계획에서 빠진다', () => {
    const m = propagationModel()
    // 사용처 없음
    let m2 = createTerm(m, term('tm2', { logicalName: '배송지', physicalName: 'DLV_ADDR' }))
    expect(planTermPropagation(m2, 'tm2', { physicalName: 'SHIP_ADDR' }).entries).toEqual([])
    // c1은 이미 ORD_NO라 물리명 변경 없음 → t1도 ORD_NO라 제외, c2(OLD_NO)만 남는다
    m2 = { ...m, tables: { ...m.tables, t1: { ...m.tables.t1!, physicalName: 'ORD_NO' } } }
    // 용어 자체의 물리명을 먼저 다른 값으로 바꿔둬야 이어지는 patch가 "실제 변경"이 된다
    // (그렇지 않으면 patch 값이 용어의 현재 값과 같아 애초에 변경으로 인식되지 않는다).
    m2 = updateTerm(m2, 'tm1', { physicalName: 'TEMP_NO' })
    const plan = planTermPropagation(m2, 'tm1', { physicalName: 'ORD_NO' })
    expect(plan.entries.map((e) => e.entityId)).toEqual(['c2'])
  })

  it('applyTermPropagation은 입력 모델을 변형하지 않는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    const before = JSON.stringify(m)
    const next = applyTermPropagation(m, plan)
    // 제자리 변형 회귀가 나면 diffModels(current, next)가 참조 동일을 보고 전파 op를 만들지 않는다.
    expect(JSON.stringify(m)).toBe(before)
    expect(next.columns.c2!.physicalName).toBe('ORDER_NO')   // 반환값에는 반영돼 있다
  })

  it('계획을 세운 뒤 남이 그 필드를 고쳤으면 덮어쓰지 않는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    // 계획 수립 후 원격에서 c1의 물리명이 다른 값으로 바뀐 상황
    const remote = {
      ...m,
      columns: { ...m.columns, c1: { ...m.columns.c1!, physicalName: 'JOIN_DT' } },
    }
    const next = applyTermPropagation(remote, plan)
    expect(next.columns.c1!.physicalName).toBe('JOIN_DT')      // 남의 변경 보존
    expect(next.columns.c2!.physicalName).toBe('ORDER_NO')     // 나머지는 정상 반영
  })
})

describe('canRegisterWord', () => {
  const base = (): ProjectModel => ({
    ...createEmptyModel(),
    words: {
      w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    },
  })

  it('정상 등록', () => {
    expect(canRegisterWord(base(), { logicalName: '주문', abbreviation: 'ORD' }))
      .toEqual({ ok: true, abbrClash: false })
  })

  it('같은 논리명이 이미 있으면 막는다', () => {
    expect(canRegisterWord(base(), { logicalName: '회원', abbreviation: 'MEM' }))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  it('앞뒤 공백을 무시하고 중복을 판정한다', () => {
    expect(canRegisterWord(base(), { logicalName: ' 회원 ', abbreviation: 'MEM' }).ok).toBe(false)
  })

  it('약어가 겹치면 막지는 않고 표식만 세운다', () => {
    expect(canRegisterWord(base(), { logicalName: '멤버', abbreviation: 'mbr' }))
      .toEqual({ ok: true, abbrClash: true })
  })

  it('어느 한쪽이 비면 막는다', () => {
    expect(canRegisterWord(base(), { logicalName: '', abbreviation: 'X' }))
      .toEqual({ ok: false, reason: 'empty' })
    expect(canRegisterWord(base(), { logicalName: '주문', abbreviation: '  ' }))
      .toEqual({ ok: false, reason: 'empty' })
  })
})

describe('usesWord 의 용어 완전일치 판정', () => {
  // ⚠️ matchesTermExactly 가 평문 비교면, 용어로 끝나야 할 논리명이 표기 차이로 분해까지 내려가
  // 「사용처」가 과다 계산된다. generatePhysicalName 은 매칭하는데 이 함수만 못 하는 어긋남이다.
  const model = (logicalName: string): ProjectModel => ({
    ...createEmptyModel(),
    words: {
      w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
      w2: { id:'w2', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
    },
    // 용어 저장값에는 구분자가 없다(공용 라이브러리에서 내려온 모양).
    terms: {
      t1: { id:'t1', logicalName:'회원번호', physicalName:'MBR_NO', domainId:null, description:null, origin:null },
    },
    tables: {
      t: { id:'t', logicalName, physicalName:'MBR_NO', comment:null, groupId:null,
           position:{x:0,y:0}, groupPosition:null, custom:{} },
    },
  })

  it('구분자가 든 논리명도 용어로 끝나므로 단어를 쓰지 않는다', () => {
    expect(wordUsage(model('회원_번호'), 'w1', DEFAULT_NAMING_RULES)).toEqual([])
    // 표기가 다를 뿐 같은 모델이다 — 구분자 없는 쪽과 결과가 같아야 한다.
    expect(wordUsage(model('회원번호'), 'w1', DEFAULT_NAMING_RULES)).toEqual([])
  })

  // 대조군 — 구분자를 끈 규칙에서는 표기가 다르면 용어에 닿지 못해 분해로 내려간다(옛 세계).
  it('구분자를 끈 규칙에서는 표기가 다르면 분해로 내려간다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(wordUsage(model('회원번호'), 'w1', rules)).toEqual([])
    expect(wordUsage(model('회원_번호'), 'w1', rules)).toHaveLength(1)
  })
})

describe('canRegisterTerm', () => {
  const base = (): ProjectModel => ({
    ...createEmptyModel(),
    terms: {
      t1: { id:'t1', logicalName:'회원번호', physicalName:'MBR_NO', domainId:null, description:null, origin:null },
    },
  })

  it('정상 등록', () => {
    expect(canRegisterTerm(base(), { logicalName: '주문번호', physicalName: 'ORD_NO' }, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true })
  })

  it('같은 논리명이 이미 있으면 막는다', () => {
    expect(canRegisterTerm(base(), { logicalName: '회원번호', physicalName: 'MEMBER_NO' }, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  it('어느 한쪽이 비면 막는다', () => {
    expect(canRegisterTerm(base(), { logicalName: '주문번호', physicalName: '' }, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, reason: 'empty' })
  })

  // ⚠️ 중복 판정이 평문이면 `회원_번호` 가 통과해 같은 bare 이름의 용어가 둘 생긴다 —
  // generatePhysicalName 의 find 가 모델 순서로 하나를 골라 나머지는 유령이 된다(설계 D4).
  it('구분자 표기만 다른 용어는 중복으로 막는다', () => {
    expect(canRegisterTerm(base(), { logicalName: '회원_번호', physicalName: 'MBR_NO2' }, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  // 대조군 — 구분자를 끈 규칙에서는 표기가 다르면 다른 이름이다(옛 세계).
  it('구분자를 끈 규칙에서는 표기가 다르면 등록된다', () => {
    expect(canRegisterTerm(
      base(), { logicalName: '회원_번호', physicalName: 'MBR_NO2' },
      { ...DEFAULT_NAMING_RULES, logicalSeparator: '' },
    )).toEqual({ ok: true })
  })
})

describe('buildUsageIndex — 목록의 사용 수는 삭제·수정 경고와 같은 수를 말한다', () => {
  /**
   * 두 판정이 갈리는 모양을 전부 넣는다: 구분자가 든 용어(단어 분해 건너뜀 판정만 벗겨 비교), 공백뿐인 용어
   * (termUsage 는 빈 논리명과 맞춘다), 같은 단어가 두 번 든 이름(한 번만 센다), 앞뒤 공백, 빈 논리명.
   */
  function usageFixture(): ProjectModel {
    let m = buildSampleModel()   // t1 회원등급 · t2 회원, c1·c4 등급코드 · c2 회원번호 · c3 회원명
    const words: [string, string, string][] = [
      ['w1', '회원', 'MBR'], ['w2', '번호', 'NO'], ['w3', '등급', 'GRD'], ['w4', '코드', 'CD'], ['w5', '명', 'NM'],
      ['w6', '주문', 'ORD'],
    ]
    for (const [id, logicalName, abbreviation] of words) {
      m = createWord(m, { id, logicalName, abbreviation, englishName: null, description: null, origin: null })
    }
    const terms: [string, string, string][] = [
      ['tm1', '등급코드', 'GRD_CD'], ['tm2', '회원_번호', 'MBR_NO'], ['tm3', '없는용어', 'NONE'], ['tm4', '  ', 'BLANK'],
    ]
    for (const [id, logicalName, physicalName] of terms) {
      m = createTerm(m, { id, logicalName, physicalName, domainId: null, description: null, origin: null })
    }
    const tables = { ...m.tables, t3: { ...m.tables.t1!, id: 't3', logicalName: '회원_등급', physicalName: 'MBR_GRD2' } }
    const columns = {
      ...m.columns,
      c5: { ...m.columns.c3!, id: 'c5', tableId: 't3', logicalName: ' 회원회원 ', physicalName: 'MBR_MBR' },
      c6: { ...m.columns.c3!, id: 'c6', tableId: 't3', logicalName: '', physicalName: 'EMPTY' },
      c7: { ...m.columns.c3!, id: 'c7', tableId: 't3', logicalName: '회원번호', physicalName: 'MBR_NO' },
    }
    return { ...m, tables, columns }
  }

  /**
   * 명명 규칙의 까다로운 갈래를 더 얹는다(guides/naming.md 「논리명 구분자」·「테이블 최종 이름」).
   * - 여러 단어로 분해되는 이름: 구분자 split(`회원_주문_번호`) · 그리디 폴백(`회원주문번호`) · 섞임(`회원_주문번호`)
   * - 같은 단어가 두 번: `회원_회원`, 앞뒤·겹 구분자(`_회원__주문_`)
   * - 용어와 단어가 겹치는 이름: 단어 `주문` 과 같은 이름의 용어 tm5 → `주문` 테이블은 단어 사용처에서 빠진다
   * - 같은 논리명의 용어 둘(tm6·tm7) → 둘 다 사용처를 받는다
   * - 용어 쪽에 구분자가 없고 엔티티 쪽에 있는 이름(`주문_코드` vs 용어 `주문코드`)
   * - 구분자뿐인 이름(`_`) → 벗기면 빈 이름이라 공백 용어와 구분자 비교로 맞는다(평문 비교로는 안 맞는다)
   * - 동명 단어 둘(w7·w8 `상태`) → 분해는 앞엣것만 잡는다, 빈 논리명 단어(w9)
   * - 사전에 없는 구간이 낀 이름(`회원XYZ번호`), 영문 단어(`ID`)
   * - 그룹 별칭·형식 템플릿이 걸린 테이블(`g1`, 별칭 MBR) — 색인은 조합 이름이 아니라 부분을 본다
   */
  function trickyFixture(): ProjectModel {
    let m = usageFixture()
    const words: [string, string, string][] = [
      ['w7', '상태', 'STAT'], ['w8', '상태', 'STS'], ['w9', '', 'EMPTYWORD'], ['w10', 'ID', 'ID'],
    ]
    for (const [id, logicalName, abbreviation] of words) {
      m = createWord(m, { id, logicalName, abbreviation, englishName: null, description: null, origin: null })
    }
    const terms: [string, string, string][] = [
      ['tm5', '주문', 'ORD_TERM'], ['tm6', '주문상태', 'ORD_STAT'], ['tm7', '주문상태', 'ORD_STS'], ['tm8', '주문코드', 'ORD_CD'],
    ]
    for (const [id, logicalName, physicalName] of terms) {
      m = createTerm(m, { id, logicalName, physicalName, domainId: null, description: null, origin: null })
    }
    const base = m.tables.t1!
    const tables = {
      ...m.tables,
      t4: { ...base, id: 't4', logicalName: '주문', physicalName: 'ORD', groupId: 'g1' },
      t5: { ...base, id: 't5', logicalName: '회원_주문_번호', physicalName: 'MBR_ORD_NO', groupId: null },
    }
    const col = m.columns.c3!
    const extra: [string, string][] = [
      ['c8', '회원주문번호'], ['c9', '회원_주문번호'], ['c10', '회원_회원'], ['c11', '_회원__주문_'],
      ['c12', '주문_코드'], ['c13', '_'], ['c14', '주문상태'], ['c15', '상태'], ['c16', '회원XYZ번호'],
      ['c17', '회원ID'], ['c18', '주문_상태'], ['c19', '  주문  '],
    ]
    const columns = { ...m.columns }
    for (const [id, logicalName] of extra) columns[id] = { ...col, id, tableId: 't5', logicalName, physicalName: '' }
    const tableGroups = { ...m.tableGroups, g1: { ...m.tableGroups.g1!, alias: 'MBR' } }
    return { ...m, tables, columns, tableGroups }
  }

  const RULES: [string, NamingRules][] = [
    ['기본 규칙(논리명 구분자 _)', DEFAULT_NAMING_RULES],
    ['논리명 구분자 없음', { ...DEFAULT_NAMING_RULES, logicalSeparator: '' }],
    ['형식 템플릿이 걸린 규칙', {
      ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}', tableLogicalTemplate: '{그룹명}_{논리명}',
    }],
  ]
  const FIXTURES: [string, () => ProjectModel][] = [['기본 픽스처', usageFixture], ['까다로운 픽스처', trickyFixture]]
  for (const [fixtureLabel, fixture] of FIXTURES) {
    for (const [label, rules] of RULES) {
      it(`${fixtureLabel} · ${label}: 모든 단어·용어 id 에서 wordUsage·termUsage 와 같은 값이다`, () => {
        const m = fixture()
        const index = buildUsageIndex(m, rules)
        expect([...index.words.keys()].sort()).toEqual(Object.keys(m.words).sort())
        expect([...index.terms.keys()].sort()).toEqual(Object.keys(m.terms).sort())
        for (const id of Object.keys(m.words)) expect(index.words.get(id), `단어 ${id}`).toEqual(wordUsage(m, id, rules))
        for (const id of Object.keys(m.terms)) expect(index.terms.get(id), `용어 ${id}`).toEqual(termUsage(m, id))
      })
    }
  }

  it('픽스처가 갈림길을 실제로 밟는다 — 용어 완전일치 컬럼은 단어 사용처에서 빠지고, 빈 용어는 빈 논리명과 맞는다', () => {
    const m = usageFixture()
    const index = buildUsageIndex(m, DEFAULT_NAMING_RULES)
    // c2·c7(회원번호)은 tm2(회원_번호)와 구분자를 벗겨 같으므로 단어 분해를 건너뛴다 — 회원 단어의 사용처가 아니다.
    const memberUsers = index.words.get('w1')!.map((u) => u.entity.id)
    expect(memberUsers).not.toContain('c2')
    expect(memberUsers).toContain('c5')
    expect(memberUsers.filter((id) => id === 'c5')).toHaveLength(1)
    // termUsage 는 평문 비교라 tm2(회원_번호)는 회원번호 컬럼과 맞지 않는다.
    expect(index.terms.get('tm2')).toEqual([])
    expect(index.terms.get('tm4')!.map((u) => u.entity.id)).toEqual(['c6'])
  })

  it('까다로운 픽스처도 갈림길을 실제로 밟는다 — 두 규칙에서 결과가 갈리고, 겹치는 용어·동명 단어가 각자 값을 낸다', () => {
    const m = trickyFixture()
    const withSep = buildUsageIndex(m, DEFAULT_NAMING_RULES)
    const noSep = buildUsageIndex(m, { ...DEFAULT_NAMING_RULES, logicalSeparator: '' })
    const ids = (index: typeof withSep, kind: 'words' | 'terms', id: string) => index[kind].get(id)!.map((u) => u.entity.id)
    // 용어 tm5(주문)와 이름이 같은 t4·c19 는 단어 주문의 사용처가 아니고, 용어 쪽은 평문 trim 으로 둘 다 잡는다.
    expect(ids(withSep, 'words', 'w6')).not.toContain('t4')
    expect(ids(withSep, 'terms', 'tm5')).toEqual(['t4', 'c19'])
    // 같은 논리명의 용어 둘은 둘 다 사용처를 받는다.
    expect(ids(withSep, 'terms', 'tm6')).toEqual(['c14'])
    expect(ids(withSep, 'terms', 'tm7')).toEqual(['c14'])
    // 동명 단어는 분해가 앞엣것만 잡는다.
    expect(ids(withSep, 'words', 'w7')).toContain('c15')
    expect(ids(withSep, 'words', 'w8')).toEqual([])
    // 주문_코드(c12)는 구분자를 벗기면 용어 tm8(주문코드)과 같아 단어 분해를 건너뛴다 — 구분자 없는 규칙에서는
    // 벗기지 않으므로 분해로 내려가 주문 단어의 사용처가 된다(두 규칙에서 실제로 갈린다).
    expect(ids(withSep, 'words', 'w6')).not.toContain('c12')
    expect(ids(noSep, 'words', 'w6')).toContain('c12')
    // 구분자뿐인 이름(c13 `_`)은 벗기면 빈 이름이라 공백 용어와 같다 — 평문 termUsage 는 맞추지 않는다.
    expect(ids(withSep, 'terms', 'tm4')).not.toContain('c13')
    // 여러 단어 분해: split·그리디·섞임 모두 회원·주문·번호를 잡는다.
    for (const id of ['t5', 'c8', 'c9']) {
      expect(ids(withSep, 'words', 'w1'), id).toContain(id)
      expect(ids(withSep, 'words', 'w2'), id).toContain(id)
    }
  })
})
