import { describe, expect, it } from 'vitest'
import {
  generatePhysicalName, decomposeByWords, restoreLogicalName, suggestCompletions, findTermByLogicalName,
  withLogicalSeparator, DEFAULT_NAMING_RULES, type NamingRules,
} from './naming.js'
import { computeWarnings } from './warnings.js'
import { createEmptyModel, type ProjectModel, type Term, type Word } from './model.js'

// 사전 파생 구조(용어 조회표·단어 그리디 후보·약어 색인)는 사전 레코드 객체당 한 번 만들어 재사용한다.
// 이 묶음은 그 재사용이 **답을 바꾸지 않는다**는 것만 잠근다 — 빠르기는 단언하지 않는다.

const word = (id: string, logicalName: string, abbreviation: string): Word =>
  ({ id, logicalName, abbreviation, englishName: null, description: null, origin: null })
const term = (id: string, logicalName: string, physicalName: string): Term =>
  ({ id, logicalName, physicalName, domainId: null, description: null, origin: null })

const SEP: NamingRules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '_', separator: '_' }
const NOSEP: NamingRules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '', separator: '' }

const words: Record<string, Word> = {
  w1: word('w1', '회원', 'MBR'),
  w2: word('w2', '번호', 'NO'),
  w3: word('w3', '회원번호', 'MNO'),
  w4: word('w4', '주문', 'ORD'),
  w5: word('w5', '상태', 'ST'),
  w6: word('w6', '상태코드', 'STCD'),
  w7: word('w7', '😀', 'EMJ'),
}
const terms: Record<string, Term> = {
  t1: term('t1', '주문_상태', 'ORD_STAT'),
  t2: term('t2', ' 회원주문 ', 'MBR_ORD'),
}

/** 캐시 없이 계산한 결과 — 매번 새 레코드를 넘기면 이전 구조를 쓸 수 없다. */
const fresh = <T>(r: Record<string, T>): Record<string, T> => ({ ...r })

describe('사전 파생 구조 재사용 — 결과는 캐시 없이 계산한 것과 같다', () => {
  const logicals = ['회원번호', '회원_번호', '주문상태', '주문_상태', '회원주문', '상태코드번호', '회원😀주문', '미등록회원', '', '  회원  ']
  const physicals = ['MBR_NO', 'mno', 'ORD_STAT', 'MBRNO', 'STCDNO', 'MBR_ZZ', 'EMJORD', '']

  for (const [label, rules] of [['구분자 _', SEP], ['구분자 없음', NOSEP]] as const) {
    it(`${label} — 같은 레코드로 두 번 불러도 새 레코드로 부른 것과 같다`, () => {
      for (const l of logicals) {
        const expected = generatePhysicalName(l, fresh(words), fresh(terms), rules)
        expect(generatePhysicalName(l, words, terms, rules)).toEqual(expected)
        expect(generatePhysicalName(l, words, terms, rules)).toEqual(expected)
        expect(decomposeByWords(l, words, rules)).toEqual(decomposeByWords(l, fresh(words), rules))
        expect(withLogicalSeparator(l, words, rules)).toBe(withLogicalSeparator(l, fresh(words), rules))
        expect(findTermByLogicalName(l, terms, rules)).toBe(findTermByLogicalName(l, fresh(terms), rules))
        for (const side of ['logical', 'physical'] as const) {
          expect(suggestCompletions(l, side, words, terms, rules))
            .toEqual(suggestCompletions(l, side, fresh(words), fresh(terms), rules))
        }
      }
      for (const p of physicals) {
        const expected = restoreLogicalName(p, fresh(words), fresh(terms), rules)
        expect(restoreLogicalName(p, words, terms, rules)).toEqual(expected)
        expect(restoreLogicalName(p, words, terms, rules)).toEqual(expected)
        for (let k = 1; k <= p.length; k += 1) {
          expect(suggestCompletions(p.slice(0, k), 'physical', words, terms, rules))
            .toEqual(suggestCompletions(p.slice(0, k), 'physical', fresh(words), fresh(terms), rules))
        }
      }
    })
  }

  it('computeWarnings — 같은 모델로 두 번 불러도 새 사전 레코드로 부른 것과 같다', () => {
    const m = modelWith(words, terms, ['회원번호', '주문상태', '회원주문', '상태코드번호', '미등록'])
    const expected = computeWarnings({ ...m, words: fresh(m.words), terms: fresh(m.terms) }, SEP)
    expect(expected.length).toBeGreaterThan(0)
    expect(computeWarnings(m, SEP)).toEqual(expected)
    expect(computeWarnings(m, SEP)).toEqual(expected)
  })
})

describe('사전 파생 구조 재사용 — 새 레코드를 넘기면 새 답이 나온다(낡은 구조를 쓰지 않는다)', () => {
  it('용어 추가 — 새 용어 레코드의 용어가 매칭된다', () => {
    const before = { ...terms }
    expect(generatePhysicalName('회원번호', words, before, NOSEP).termId).toBeUndefined()
    const after = { ...before, t9: term('t9', '회원번호', 'MEMBER_NO') }
    expect(generatePhysicalName('회원번호', words, after, NOSEP))
      .toMatchObject({ physicalName: 'MEMBER_NO', termId: 't9' })
    expect(restoreLogicalName('MEMBER_NO', words, after, SEP)).toEqual({ ok: true, logicalName: '회원번호' })
    expect(findTermByLogicalName('회원번호', after, NOSEP)?.id).toBe('t9')
  })

  it('용어 이름 변경 — 옛 이름은 더 이상 매칭되지 않고 새 이름이 매칭된다', () => {
    const before = { ...terms }
    expect(generatePhysicalName('주문상태', words, before, SEP).termId).toBe('t1')
    expect(restoreLogicalName('ORD_STAT', words, before, SEP)).toEqual({ ok: true, logicalName: '주문_상태' })
    const after = { ...before, t1: term('t1', '주문_단계', 'ORD_STEP') }
    expect(generatePhysicalName('주문상태', words, after, SEP).termId).toBeUndefined()
    expect(generatePhysicalName('주문단계', words, after, SEP).termId).toBe('t1')
    expect(restoreLogicalName('ORD_STAT', words, after, SEP).ok).toBe(false)
    expect(suggestCompletions('주문_', 'logical', words, after, SEP).items.map((c) => c.insert)).toContain('주문_단계')
    expect(suggestCompletions('주문_', 'logical', words, after, SEP).items.map((c) => c.insert)).not.toContain('주문_상태')
  })

  it('용어 삭제 — 지운 용어는 매칭되지 않는다', () => {
    const before = { ...terms }
    expect(findTermByLogicalName('회원주문', before, SEP)?.id).toBe('t2')
    const after = { ...before }
    delete after.t2
    expect(findTermByLogicalName('회원주문', after, SEP)).toBeUndefined()
    expect(generatePhysicalName('회원주문', words, after, SEP).physicalName).toBe('MBR_ORD')
    expect(generatePhysicalName('회원주문', words, after, SEP).termId).toBeUndefined()
    expect(restoreLogicalName('MBR_ORD', words, after, SEP)).toEqual({ ok: true, logicalName: '회원_주문' })
  })

  it('단어 추가·이름 변경·삭제 — 분해와 약어 복원이 새 단어 레코드를 따른다', () => {
    const before = { ...words }
    expect(generatePhysicalName('회원쿠폰', before, {}, SEP).unknownWords).toEqual(['쿠폰'])
    expect(restoreLogicalName('MBR_CPN', before, {}, SEP)).toEqual({ ok: false, unknownTokens: ['CPN'] })
    expect(restoreLogicalName('MBRCPN', before, {}, NOSEP)).toEqual({ ok: false, unknownTokens: ['CPN'] })
    const added = { ...before, w9: word('w9', '쿠폰', 'CPN') }
    expect(generatePhysicalName('회원쿠폰', added, {}, SEP)).toMatchObject({ physicalName: 'MBR_CPN', unknownWords: [] })
    expect(generatePhysicalName('회원_쿠폰', added, {}, SEP)).toMatchObject({ physicalName: 'MBR_CPN', unknownWords: [] })
    expect(restoreLogicalName('MBR_CPN', added, {}, SEP)).toEqual({ ok: true, logicalName: '회원_쿠폰' })
    expect(restoreLogicalName('MBRCPN', added, {}, NOSEP)).toEqual({ ok: true, logicalName: '회원쿠폰' })
    expect(suggestCompletions('회원_쿠', 'logical', added, {}, SEP).items.map((c) => c.insert)).toEqual(['쿠폰'])

    const renamed = { ...added, w9: word('w9', '할인권', 'CPN') }
    expect(generatePhysicalName('회원쿠폰', renamed, {}, SEP).unknownWords).toEqual(['쿠폰'])
    expect(restoreLogicalName('MBR_CPN', renamed, {}, SEP)).toEqual({ ok: true, logicalName: '회원_할인권' })
    const reabbr = { ...added, w9: word('w9', '쿠폰', 'COUPON') }
    expect(restoreLogicalName('MBR_CPN', reabbr, {}, SEP)).toEqual({ ok: false, unknownTokens: ['CPN'] })
    expect(restoreLogicalName('MBRCOUPON', reabbr, {}, NOSEP)).toEqual({ ok: true, logicalName: '회원쿠폰' })

    const removed: Record<string, Word> = { ...added }
    delete removed.w9
    expect(generatePhysicalName('회원쿠폰', removed, {}, SEP).unknownWords).toEqual(['쿠폰'])
    expect(restoreLogicalName('MBRCPN', removed, {}, NOSEP)).toEqual({ ok: false, unknownTokens: ['CPN'] })
  })

  it('computeWarnings — 새 사전 레코드를 담은 모델이면 경고가 새로 계산된다', () => {
    const m1 = modelWith(words, terms, ['회원쿠폰'])
    expect(computeWarnings(m1, SEP).map((w) => w.kind)).toContain('unknown-word')
    const m2 = { ...m1, words: { ...m1.words, w9: word('w9', '쿠폰', 'CPN') } }
    expect(computeWarnings(m2, SEP).map((w) => w.kind)).not.toContain('unknown-word')
    const m3 = { ...m2, terms: { ...m2.terms, t9: term('t9', '회원_쿠폰', 'MBR_COUPON') } }
    expect(computeWarnings(m3, SEP).filter((w) => w.kind === 'term-mismatch').map((w) => w.message))
      .toEqual(['용어 "회원_쿠폰"의 표준 물리명은 "MBR_COUPON"입니다(현재 "C0")'])
  })
})

describe('사전 파생 구조 재사용 — 규칙이 바뀌면 같은 레코드에서도 새 답이 나온다', () => {
  // 용어 저장값에 구분자가 들어 있으면 논리 구분자 규칙에 따라 bare 이름이 갈린다(설계 D4).
  const sepTerms = { t1: term('t1', '회원_번호', 'MEMBER_NO') }

  it('논리 구분자 — 같은 용어 레코드를 _ → 없음 → _ 순으로 불러도 규칙마다 답이 다르다', () => {
    expect(generatePhysicalName('회원번호', words, sepTerms, SEP).termId).toBe('t1')
    expect(generatePhysicalName('회원번호', words, sepTerms, NOSEP).termId).toBeUndefined()
    expect(generatePhysicalName('회원번호', words, sepTerms, NOSEP).physicalName).toBe('MNO')
    expect(generatePhysicalName('회원번호', words, sepTerms, SEP).termId).toBe('t1')
    expect(findTermByLogicalName('회원번호', sepTerms, NOSEP)).toBeUndefined()
    expect(findTermByLogicalName('회원_번호', sepTerms, NOSEP)?.id).toBe('t1')
  })

  it('논리 구분자 — 자동완성의 용어 후보도 규칙마다 다시 계산된다', () => {
    const insertsOf = (rules: NamingRules) =>
      suggestCompletions('회원번', 'logical', words, sepTerms, rules).items.filter((c) => c.kind === 'term').map((c) => c.insert)
    // 넣는 값은 사전 분해의 구분자 형식이다 — 사전에 '회원번호' 가 한 단어로 있어 구분자가 들어가지 않는다.
    expect(insertsOf(SEP)).toEqual(['회원번호'])
    expect(insertsOf(NOSEP)).toEqual([])
    expect(insertsOf(SEP)).toEqual(['회원번호'])
  })

  it('물리 구분자 — 같은 단어 레코드에서 쪼개기와 그리디가 규칙을 따른다', () => {
    expect(restoreLogicalName('MBR_NO', words, {}, SEP)).toEqual({ ok: true, logicalName: '회원_번호' })
    expect(restoreLogicalName('MBR_NO', words, {}, NOSEP)).toEqual({ ok: false, unknownTokens: ['_'] })
    expect(restoreLogicalName('MBRNO', words, {}, NOSEP)).toEqual({ ok: true, logicalName: '회원번호' })
    expect(restoreLogicalName('MBRNO', words, {}, SEP)).toEqual({ ok: false, unknownTokens: ['MBRNO'] })
  })

  it('형식 템플릿 — 같은 모델에서 테이블 최종 이름 기준 경고가 템플릿을 따른다', () => {
    const m = modelWith(words, terms, ['회원번호'])
    const longOf = (rules: NamingRules) =>
      computeWarnings(m, rules).filter((w) => w.kind === 'too-long').map((w) => w.message)
    const plain = { ...SEP, maxLengthBytes: 8 }
    const templated = { ...plain, tablePhysicalTemplate: 'TB_{물리명}_HIST' }
    expect(longOf(plain)).toEqual([])
    expect(longOf(templated)).toEqual(['물리명 "TB_T0_HIST"이(가) 최대 길이(8바이트)를 초과합니다'])
    expect(longOf(plain)).toEqual([])
  })
})

describe('사전 파생 구조 재사용 — 동률은 여전히 앞엣것이 이긴다', () => {
  it('구분자만 다른 같은 bare 용어가 둘이면 레코드 순서의 앞엣것이다', () => {
    const ab = { tA: term('tA', '회원_번호', 'A_NO'), tB: term('tB', '회원번호', 'B_NO') }
    const ba = { tB: ab.tB, tA: ab.tA }
    for (const name of ['회원번호', '회원_번호']) {
      expect(generatePhysicalName(name, words, ab, SEP).termId).toBe('tA')
      expect(generatePhysicalName(name, words, ba, SEP).termId).toBe('tB')
      expect(findTermByLogicalName(name, ab, SEP)?.id).toBe('tA')
    }
    const m = modelWith(words, ab, ['회원번호'])
    expect(computeWarnings(m, SEP).filter((w) => w.kind === 'term-mismatch').map((w) => w.message))
      .toEqual(['용어 "회원_번호"의 표준 물리명은 "A_NO"입니다(현재 "C0")'])
  })

  it('같은 물리명(대소문자·공백만 다름) 용어가 둘이면 앞엣것으로 복원한다', () => {
    const ab = { tA: term('tA', '회원번호', 'MBR_NO'), tB: term('tB', '회원식별번호', ' mbr_no ') }
    const ba = { tB: ab.tB, tA: ab.tA }
    expect(restoreLogicalName('Mbr_No', words, ab, NOSEP)).toEqual({ ok: true, logicalName: '회원번호' })
    expect(restoreLogicalName('Mbr_No', words, ba, NOSEP)).toEqual({ ok: true, logicalName: '회원식별번호' })
  })

  it('동명 단어는 구분자 쪼개기와 그리디 모두 앞엣것을 쓴다', () => {
    const ab = { wA: word('wA', '회원', 'MBR'), wB: word('wB', '회원', 'MEM'), wC: word('wC', '번호', 'NO') }
    const ba = { wB: ab.wB, wA: ab.wA, wC: ab.wC }
    for (const rules of [SEP, NOSEP]) {
      expect(generatePhysicalName('회원_번호', ab, {}, rules).physicalName.replace('_', '')).toBe('MBRNO')
      expect(generatePhysicalName('회원번호', ab, {}, rules).physicalName.replace('_', '')).toBe('MBRNO')
      expect(generatePhysicalName('회원번호', ba, {}, rules).physicalName.replace('_', '')).toBe('MEMNO')
    }
    // 자동완성의 「꼬리가 사전 단어인가」도 같은 조회표를 쓴다.
    expect(suggestCompletions('번호_회원', 'logical', ab, {}, SEP).query).toBe('')
  })

  it('그리디는 첫 글자가 같은 후보 중 가장 긴 것을, 같은 길이면 앞엣것을 고른다', () => {
    const ws = {
      wA: word('wA', '상태', 'ST'), wB: word('wB', '상태코드', 'STCD'), wC: word('wC', '상태코', 'X'),
      wD: word('wD', '코드', 'CD'), wE: word('wE', '상태', 'ST2'),
    }
    expect(decomposeByWords('상태코드상태', ws, NOSEP).map((s) => s.word?.id)).toEqual(['wB', 'wA'])
    expect(decomposeByWords('상태코상태', ws, NOSEP).map((s) => s.word?.id)).toEqual(['wC', 'wA'])
  })

  it('같은 약어는 id 가 작은 단어가 이기고, 약어 그리디는 가장 긴 약어를 고른다', () => {
    const ws = {
      w2: word('w2', '둘째', 'AB'), w1: word('w1', '첫째', ' ab '), w3: word('w3', '길게', 'ABC'),
      w4: word('w4', '씨', 'C'),
    }
    expect(restoreLogicalName('AB', ws, {}, NOSEP)).toEqual({ ok: true, logicalName: '첫째' })
    expect(restoreLogicalName('ABC', ws, {}, NOSEP)).toEqual({ ok: true, logicalName: '길게' })
    expect(restoreLogicalName('ABABC', ws, {}, NOSEP)).toEqual({ ok: true, logicalName: '첫째길게' })
    expect(suggestCompletions('ABCA', 'physical', ws, {}, NOSEP).query).toBe('A')
  })
})

/** 테이블 하나(물리명 T0)에 논리명마다 컬럼 하나(물리명 C0, C1, …)를 단 모델. */
function modelWith(ws: Record<string, Word>, ts: Record<string, Term>, columnLogicals: string[]): ProjectModel {
  const m = createEmptyModel()
  m.words = ws
  m.terms = ts
  m.tables.t0 = {
    id: 't0', logicalName: '', physicalName: 'T0', comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  columnLogicals.forEach((logicalName, i) => {
    m.columns[`c${i}`] = {
      id: `c${i}`, tableId: 't0', logicalName, physicalName: `C${i}`, type: 'BIGINT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: i,
      comment: null, domainId: null, custom: {},
    }
  })
  return m
}
