import { describe, expect, it } from 'vitest'
import { quoteIdentifier } from './identifier.js'

describe('quoteIdentifier', () => {
  it('안전한 이름은 인용하지 않는다', () => {
    expect(quoteIdentifier('MBR_TBL', 'postgresql')).toBe('MBR_TBL')
    expect(quoteIdentifier('order_no', 'mysql')).toBe('order_no')
  })
  it('예약어는 방언별로 인용한다', () => {
    expect(quoteIdentifier('ORDER', 'postgresql')).toBe('"ORDER"')
    expect(quoteIdentifier('ORDER', 'oracle')).toBe('"ORDER"')
    expect(quoteIdentifier('ORDER', 'mysql')).toBe('`ORDER`')
    expect(quoteIdentifier('ORDER', 'mssql')).toBe('[ORDER]')
  })
  it('예약어 판별은 대소문자를 무시한다', () => {
    expect(quoteIdentifier('user', 'postgresql')).toBe('"user"')
  })
  it('네 방언 모두에서 비예약인 흔한 컬럼명은 인용하지 않는다', () => {
    // TYPE/VALUE/STATUS/NAME은 네 방언 모두 비예약(Oracle 포함)
    for (const name of ['TYPE', 'VALUE', 'STATUS', 'NAME']) {
      for (const d of ['postgresql', 'mysql', 'oracle', 'mssql'] as const) {
        expect(quoteIdentifier(name, d)).toBe(name)
      }
    }
  })
  it('방언별로만 예약인 단어는 해당 방언에서만 인용한다(EXTRA)', () => {
    // DATE/NUMBER/LEVEL/COMMENT는 Oracle에서만 예약(다른 방언은 비예약)
    expect(quoteIdentifier('DATE', 'oracle')).toBe('"DATE"')
    expect(quoteIdentifier('DATE', 'postgresql')).toBe('DATE')
    expect(quoteIdentifier('NUMBER', 'oracle')).toBe('"NUMBER"')
    expect(quoteIdentifier('NUMBER', 'mysql')).toBe('NUMBER')
    expect(quoteIdentifier('COMMENT', 'oracle')).toBe('"COMMENT"')
    expect(quoteIdentifier('COMMENT', 'postgresql')).toBe('COMMENT')
    // LIMIT은 PostgreSQL·MySQL 예약, MSSQL에선 비예약
    expect(quoteIdentifier('LIMIT', 'postgresql')).toBe('"LIMIT"')
    expect(quoteIdentifier('LIMIT', 'mysql')).toBe('`LIMIT`')
    expect(quoteIdentifier('LIMIT', 'mssql')).toBe('LIMIT')
    // LAG/LEAD는 MySQL 윈도우함수 예약(8.0.2+), PostgreSQL에선 비예약
    expect(quoteIdentifier('LAG', 'mysql')).toBe('`LAG`')
    expect(quoteIdentifier('LEAD', 'mysql')).toBe('`LEAD`')
    expect(quoteIdentifier('LEAD', 'postgresql')).toBe('LEAD')
    // IDENTITY는 MSSQL EXTRA, PostgreSQL에선 비예약
    expect(quoteIdentifier('IDENTITY', 'mssql')).toBe('[IDENTITY]')
    expect(quoteIdentifier('IDENTITY', 'postgresql')).toBe('IDENTITY')
  })
  it('안전패턴 위반(특수문자/공백/숫자시작)은 인용한다', () => {
    expect(quoteIdentifier('USER-LOG', 'postgresql')).toBe('"USER-LOG"')
    expect(quoteIdentifier('1TBL', 'mysql')).toBe('`1TBL`')
  })
  it('내부 인용부호는 이스케이프한다', () => {
    expect(quoteIdentifier('a"b', 'postgresql')).toBe('"a""b"')
    expect(quoteIdentifier('a`b', 'mysql')).toBe('`a``b`')
    expect(quoteIdentifier('a]b', 'mssql')).toBe('[a]]b]')
  })
})
