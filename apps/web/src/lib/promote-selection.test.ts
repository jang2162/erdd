import { describe, expect, it } from 'vitest'
import type { PromoteEntry } from '@erdd/core'
import {
  initialSelection, promoteSummary, setAllForStatus,
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
