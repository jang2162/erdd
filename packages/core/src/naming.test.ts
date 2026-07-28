import { describe, expect, it } from 'vitest'
import { generatePhysicalName, decomposeByWords, DEFAULT_NAMING_RULES } from './naming.js'
const words = {
  w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName: null, description:null },
  w2: { id:'w2', logicalName:'상태', abbreviation:'STAT', englishName: null, description:null },
  w3: { id:'w3', logicalName:'코드', abbreviation:'CD', englishName: null, description:null },
}
describe('generatePhysicalName', () => {
  it('용어 완전일치 우선', () => {
    const terms = { t1: { id:'t1', logicalName:'회원상태코드', physicalName:'MBR_ST_CD', domainId:'d1', description:null } }
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
