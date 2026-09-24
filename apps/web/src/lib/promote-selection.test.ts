import { describe, expect, it } from 'vitest'
import type { PromoteEntry } from '@erdd/core'
import {
  carrySelection, initialSelection, promoteSummary, setAllForStatus,
} from './promote-selection.js'

function entry(over: Partial<PromoteEntry> & Pick<PromoteEntry, 'entityId' | 'status'>): PromoteEntry {
  return {
    kind: 'word', name: '이름', targetItemId: null, targetVersion: null,
    payload: {}, changedFields: [], domainRef: null, sourceBehind: false, ...over,
  }
}
describe('initialSelection', () => {
  it('new·update는 선택하고 name-match는 보류한다', () => {
    const selected = initialSelection([
      entry({ entityId: 'a', status: 'new' }),
      entry({ entityId: 'b', status: 'update' }),
      entry({ entityId: 'c', status: 'name-match' }),
    ])
    expect([...selected].sort()).toEqual(['a', 'b'])
  })

  it('원본이 더 새로운 update는 선택하지 않는다 — 올리면 남이 고친 값이 되돌아간다', () => {
    const selected = initialSelection([
      entry({ entityId: 'a', status: 'update' }),
      entry({ entityId: 'b', status: 'update', sourceBehind: true }),
    ])
    expect([...selected]).toEqual(['a'])
  })
})

describe('setAllForStatus', () => {
  it('같은 상태의 항목만 켜고 끈다', () => {
    const entries = [
      entry({ entityId: 'a', status: 'new' }),
      entry({ entityId: 'c', status: 'name-match' }),
    ]
    const on = setAllForStatus(new Set<string>(), entries, 'name-match', true)
    expect([...on]).toEqual(['c'])
    const off = setAllForStatus(new Set(['a', 'c']), entries, 'new', false)
    expect([...off]).toEqual(['c'])
  })
})

describe('promoteSummary', () => {
  it('추가·갱신 건수를 알리고, 건너뛴 항목이 있으면 덧붙인다', () => {
    expect(promoteSummary({ inserted: 2, updated: 1, skipped: [] }))
      .toBe('추가 2건 · 갱신 1건을 올렸습니다')
    expect(promoteSummary({ inserted: 0, updated: 0, skipped: [{ entityId: 'a', reason: 'missing' }] }))
      .toBe('추가 0건 · 갱신 0건을 올렸습니다 — 1건은 그 사이 상태가 바뀌어 건너뛰었습니다')
  })
})

describe('carrySelection', () => {
  const before = [
    entry({ entityId: 'n1', status: 'new' }),
    entry({ entityId: 'n2', status: 'new' }),
    entry({ entityId: 'm1', status: 'name-match', targetItemId: 's1' }),
    entry({ entityId: 'u1', status: 'update', targetItemId: 's2' }),
  ]

  it('같은 항목이 같은 상태로 남으면 사용자 선택을 잇고, 새 항목만 기본 선택을 받는다', () => {
    const next = [...before, entry({ entityId: 'n3', status: 'new' })]
    // 사용자가 n1 을 끄고 m1 을 켰다.
    const out = carrySelection(before, new Set(['n2', 'm1', 'u1']), next)
    expect([...out].sort()).toEqual(['m1', 'n2', 'n3', 'u1'])
  })

  it('상태·대상 항목·sourceBehind 가 바뀐 항목은 기본 선택을 받는다', () => {
    const next = [
      entry({ entityId: 'n1', status: 'name-match', targetItemId: 's9' }),
      entry({ entityId: 'm1', status: 'name-match', targetItemId: 's3' }),
      entry({ entityId: 'u1', status: 'update', targetItemId: 's2', sourceBehind: true }),
    ]
    // n1(new→name-match) 을 사용자가 켜 뒀어도, m1 의 대상이 바뀌었어도, u1 이 원본보다 뒤처졌어도 기본값이다.
    const out = carrySelection(before, new Set(['n1', 'm1', 'u1']), next)
    expect([...out]).toEqual([])
  })

  it('계획에서 빠진 항목은 선택에서 빠진다 — 올릴 항목 건수에 남지 않는다', () => {
    const out = carrySelection(before, new Set(['n1', 'n2', 'u1']), [before[0]!])
    expect([...out]).toEqual(['n1'])
  })
})
