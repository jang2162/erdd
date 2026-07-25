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
