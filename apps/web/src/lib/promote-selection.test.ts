import { describe, expect, it } from 'vitest'
import type { PromoteEntry } from '@erdd/core'
import {
  danglingDomain, initialSelection, promoteSummary, setAllForStatus,
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

describe('danglingDomain', () => {
  const term = entry({
    entityId: 't1', status: 'new', kind: 'term',
    domainRef: { entityId: 'd1', targetItemId: null },
  })

  it('도메인이 라이브러리에 없고 함께 선택되지도 않으면 연결이 빈다', () => {
    expect(danglingDomain(term, new Set(['t1']))).toBe(true)
  })

  it('도메인을 함께 선택하면 연결된다', () => {
    expect(danglingDomain(term, new Set(['t1', 'd1']))).toBe(false)
  })

  it('도메인이 이미 라이브러리에 있으면 선택과 무관하다', () => {
    const linked = entry({
      entityId: 't1', status: 'new', kind: 'term',
      domainRef: { entityId: 'd1', targetItemId: 'sd' },
    })
    expect(danglingDomain(linked, new Set(['t1']))).toBe(false)
  })

  it('도메인 참조가 없으면 false', () => {
    expect(danglingDomain(entry({ entityId: 'w1', status: 'new' }), new Set(['w1']))).toBe(false)
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
