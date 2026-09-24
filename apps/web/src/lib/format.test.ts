import { describe, expect, it } from 'vitest'
import { formatCount, formatProgress } from './format'

describe('formatCount', () => {
  it('천 단위 구분자를 붙인다', () => {
    expect(formatCount(16565)).toBe('16,565')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_000_000)).toBe('1,000,000')
  })
})

describe('formatProgress', () => {
  it('「적용 중… 완료 / 전체」를 천 단위로 쓴다', () => {
    expect(formatProgress(2, 4)).toBe('적용 중… 2 / 4')
    expect(formatProgress(1000, 1200)).toBe('적용 중… 1,000 / 1,200')
  })
})
