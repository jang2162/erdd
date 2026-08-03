import { describe, expect, it } from 'vitest'
import { generatePhysicalName, decomposeByWords, restoreLogicalName, DEFAULT_NAMING_RULES } from './naming.js'
import type { Term, Word } from './model.js'
const words = {
  w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
  w2: { id:'w2', logicalName:'상태', abbreviation:'STAT', englishName:null, description:null, origin:null },
  w3: { id:'w3', logicalName:'코드', abbreviation:'CD', englishName:null, description:null, origin:null },
}
describe('generatePhysicalName', () => {
  it('용어 완전일치 우선', () => {
    const terms = { t1: { id:'t1', logicalName:'회원상태코드', physicalName:'MBR_ST_CD', domainId:'d1', description:null, origin:null } }
    const r = generatePhysicalName('회원상태코드', words, terms, DEFAULT_NAMING_RULES)
    expect(r.physicalName).toBe('MBR_ST_CD'); expect(r.termId).toBe('t1'); expect(r.domainId).toBe('d1'); expect(r.unknownWords).toEqual([])
  })
  it('최장일치 분해조합', () => {
    const r = generatePhysicalName('회원상태코드', words, {}, DEFAULT_NAMING_RULES)
    expect(r.physicalName).toBe('MBR_STAT_CD'); expect(r.unknownWords).toEqual([])
  })
  it('미등록 단어는 unknownWords로', () => {
    const r = generatePhysicalName('회원쿠폰', words, {}, DEFAULT_NAMING_RULES)
    expect(r.unknownWords).toContain('쿠폰')
  })
  it('lower_snake·구분자 없음', () => {
    expect(generatePhysicalName('회원상태', words, {}, { case:'lower_snake', separator:'_', maxLengthBytes:30 }).physicalName).toBe('mbr_stat')
    expect(generatePhysicalName('회원상태', words, {}, { case:'UPPER_SNAKE', separator:'', maxLengthBytes:30 }).physicalName).toBe('MBRSTAT')
  })
})

describe('decomposeByWords', () => {
  it('최장일치로 논리명을 단어 세그먼트로 나눈다', () => {
    const segs = decomposeByWords('회원상태코드', words)
    expect(segs.map((s) => s.text)).toEqual(['회원', '상태', '코드'])
    expect(segs.map((s) => s.word?.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('사전에 없는 구간은 연속으로 모아 word: null 세그먼트 하나가 된다', () => {
    const segs = decomposeByWords('회원쿠폰번호', words)
    expect(segs.map((s) => s.text)).toEqual(['회원', '쿠폰번호'])
    expect(segs.map((s) => s.word === null)).toEqual([false, true])
  })

  it('앞뒤 공백을 제거하고 분해한다', () => {
    expect(decomposeByWords('  회원  ', words).map((s) => s.text)).toEqual(['회원'])
  })

  it('빈 논리명이나 빈 사전은 빈 배열/미매칭 한 조각을 낸다', () => {
    expect(decomposeByWords('', words)).toEqual([])
    expect(decomposeByWords('회원', {})).toEqual([{ text: '회원', word: null }])
  })

  it('세그먼트 text를 이어붙이면 원본 논리명이 복원된다', () => {
    expect(decomposeByWords('회원쿠폰번호', words).map((s) => s.text).join('')).toBe('회원쿠폰번호')
  })
})

const word = (id: string, logicalName: string, abbreviation: string): Word => ({
  id, logicalName, abbreviation, englishName: null, description: null, origin: null,
})
const term = (id: string, logicalName: string, physicalName: string): Term => ({
  id, logicalName, physicalName, domainId: null, description: null, origin: null,
})

const WORDS: Record<string, Word> = {
  w1: word('w1', '회원', 'MBR'),
  w2: word('w2', '번호', 'NO'),
  w3: word('w3', '주문', 'ORD'),
}
const TERMS: Record<string, Term> = {
  t1: term('t1', '회원식별번호', 'MBR_ID'),
}

describe('restoreLogicalName', () => {
  it('용어 물리명이 통째로 일치하면 단어 분해보다 우선한다', () => {
    expect(restoreLogicalName('MBR_ID', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원식별번호' })
  })

  it('모든 토큰이 매칭되면 논리명을 이어붙인다', () => {
    expect(restoreLogicalName('MBR_NO', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원번호' })
  })

  it('한 토큰이라도 실패하면 논리명을 만들지 않고 미매칭 토큰을 돌려준다', () => {
    expect(restoreLogicalName('MBR_NO_SEQ', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, unknownTokens: ['SEQ'] })
  })

  it('대소문자를 무시하고 매칭한다', () => {
    expect(restoreLogicalName('mbr_no', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원번호' })
  })

  it('구분자가 없는 규칙에서는 최장일치로 쪼갠다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, separator: '' as const }
    expect(restoreLogicalName('MBRNO', WORDS, TERMS, rules))
      .toEqual({ ok: true, logicalName: '회원번호' })
    expect(restoreLogicalName('MBRXNO', WORDS, TERMS, rules))
      .toEqual({ ok: false, unknownTokens: ['X'] })
  })

  it('빈 사전에서는 언제나 실패한다', () => {
    expect(restoreLogicalName('MBR_NO', {}, {}, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, unknownTokens: ['MBR', 'NO'] })
  })

  it('왕복 — generatePhysicalName이 만든 물리명을 원래 논리명으로 되돌린다', () => {
    for (const logical of ['회원번호', '주문번호', '회원식별번호']) {
      const gen = generatePhysicalName(logical, WORDS, TERMS, DEFAULT_NAMING_RULES)
      expect(gen.unknownWords, `${logical} 은 사전으로 완전히 분해돼야 한다`).toEqual([])
      expect(restoreLogicalName(gen.physicalName, WORDS, TERMS, DEFAULT_NAMING_RULES))
        .toEqual({ ok: true, logicalName: logical })
    }
  })
})
