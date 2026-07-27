import { describe, expect, it } from 'vitest'
import { createEmptyModel, DEFAULT_NAMING_RULES } from '@erdd/core'
import {
  createWord, updateWord, removeWord,
  createTerm, updateTerm, removeTerm,
  wordUsage, termUsage, unregisteredWords,
} from './dict-edits.js'

const word = (id: string, over = {}) => ({ id, logicalName: '주문', abbreviation: 'ORD', description: null, ...over })
const term = (id: string, over = {}) => (
  { id, logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: null, ...over }
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
    expect(wordUsage(m, 'w1')).toHaveLength(1)
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

    const usageW1 = wordUsage(m, 'w1')
    expect(usageW1).toHaveLength(1)
    expect(usageW1[0]).toEqual({ kind: 'table', entity: m.tables['t'] })

    const usageW2 = wordUsage(m, 'w2')
    expect(usageW2).toHaveLength(1)
    expect(usageW2[0]).toEqual({ kind: 'table', entity: m.tables['t'] })
  })

  it('wordUsage: 컬럼도 대상이 되고, 관련 없는 단어는 빈 배열을 반환한다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '번호', abbreviation: 'NO' }))
    m = createWord(m, word('unused', { logicalName: '쿠폰', abbreviation: 'CPN' }))
    m.tables['t'] = table('t', '주문')
    m.columns['c'] = column('c', 't', '주문번호')

    const usage = wordUsage(m, 'w1')
    expect(usage).toEqual([{ kind: 'column', entity: m.columns['c'] }])
    expect(wordUsage(m, 'unused')).toEqual([])
  })

  it('wordUsage: 완전일치 용어가 있으면 그 논리명은 단어 분해를 거치지 않는다', () => {
    let m = createEmptyModel()
    m = createWord(m, word('w1', { logicalName: '주문', abbreviation: 'ORD' }))
    m = createTerm(m, term('term1', { logicalName: '주문번호', physicalName: 'ORD_NO' }))
    m.tables['t'] = table('t', '주문번호')

    expect(wordUsage(m, 'w1')).toEqual([])
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
