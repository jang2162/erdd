import { describe, expect, it } from 'vitest'
import type { ResyncPlan } from '@erdd/core'
import { countActive, initialDecisions, setAllForStatus } from './resource-decisions.js'

const entry = (
  sourceId: string, status: 'added' | 'auto-update' | 'conflict', nameClash = false,
) => ({
  kind: 'word' as const, sourceId, name: sourceId, status, version: 2,
  fromVersion: status === 'added' ? null : 1,
  projectEntityId: status === 'added' ? null : `e-${sourceId}`,
  sourcePayload: {}, nextPayload: {}, changedFields: [], nameClash,
})

const PLAN: ResyncPlan = {
  libraryId: 'lib', keptLocal: 0, keptSynced: 0, keptDetached: 0,
  entries: [
    entry('a1', 'added'), entry('a2', 'added', true),
    entry('u1', 'auto-update'), entry('c1', 'conflict'),
  ],
}

describe('initialDecisions', () => {
  it('신규·자동갱신은 apply, 이름 중복 신규와 충돌은 defer', () => {
    expect(initialDecisions(PLAN)).toEqual({
      a1: 'apply', a2: 'defer', u1: 'apply', c1: 'defer',
    })
  })
})

describe('setAllForStatus', () => {
  it('해당 상태의 항목만 한 번에 바꾼다', () => {
    const next = setAllForStatus(initialDecisions(PLAN), PLAN, 'conflict', 'apply')
    expect(next.c1).toBe('apply')
    expect(next.a1).toBe('apply')
    expect(next.a2).toBe('defer')
  })

  it('신규를 모두 해제한다 (이름 중복 포함)', () => {
    const next = setAllForStatus(initialDecisions(PLAN), PLAN, 'added', 'defer')
    expect(next.a1).toBe('defer')
    expect(next.a2).toBe('defer')
    expect(next.u1).toBe('apply')
  })
})

describe('countActive', () => {
  it('defer가 아닌 결정 수를 센다', () => {
    expect(countActive({ a: 'apply', b: 'keep', c: 'defer' })).toBe(2)
    expect(countActive({})).toBe(0)
  })
})
