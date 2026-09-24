import { describe, expect, it } from 'vitest'
import { chunkFailureMessage, chunkOps, chunkSummary } from './mutation-chunks'

describe('chunkOps', () => {
  it('순서를 그대로 두고 size 씩 자른다', () => {
    expect(chunkOps([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkOps([1, 2], 5)).toEqual([[1, 2]])
  })
})

describe('chunkSummary', () => {
  it('조각이 하나면 원래 요약 그대로다(없으면 없음)', () => {
    expect(chunkSummary('메모 추가', 1, 1)).toBe('메모 추가')
    expect(chunkSummary(undefined, 1, 1)).toBeUndefined()
  })
  it('조각 번호를 붙이고, 요약이 없으면 「대량 편집」으로 묶어 알아보게 한다', () => {
    expect(chunkSummary('메모 추가', 2, 4)).toBe('메모 추가 (2/4)')
    expect(chunkSummary(undefined, 2, 3)).toBe('대량 편집 (2/3)')
  })
  it('요약이 길어도 조각 번호를 붙인 결과가 서버 상한 200자를 넘지 않는다', () => {
    const s = chunkSummary('가'.repeat(200), 1, 12)!
    expect(s).toHaveLength(200)
    expect(s.endsWith(' (1/12)')).toBe(true)
  })
})

describe('chunkFailureMessage', () => {
  it('첫 조각 실패와 전부 끝난 뒤의 실패는 원래 문구 그대로다', () => {
    expect(chunkFailureMessage(0, 4, '거절됨')).toBe('거절됨')
    expect(chunkFailureMessage(4, 4, '거절됨')).toBe('거절됨')
  })
  it('중간 실패는 몇 묶음을 적용했는지 말한다', () => {
    expect(chunkFailureMessage(2, 4, '거절됨')).toBe('4개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 거절됨')
  })
})
