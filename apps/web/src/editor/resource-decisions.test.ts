import { describe, expect, it } from 'vitest'
import type { ResyncPlan } from '@erdd/core'
import { carryDecisions, countActive, initialDecisions, setAllForStatus } from './resource-decisions.js'

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

describe('carryDecisions', () => {
  it('같은 항목이 같은 상태로 남으면 사용자 결정을 잇고, 새 항목만 기본값을 받는다', () => {
    const next: ResyncPlan = { ...PLAN, entries: [...PLAN.entries, entry('a3', 'added')] }
    const prev = { a1: 'defer', a2: 'apply', u1: 'defer', c1: 'keep' } as const
    expect(carryDecisions(PLAN, prev, next)).toEqual({
      a1: 'defer', a2: 'apply', u1: 'defer', c1: 'keep', a3: 'apply',
    })
  })

  it('상태가 바뀐 항목은 사용자 결정이 아니라 기본값을 받는다', () => {
    const next: ResyncPlan = { ...PLAN, entries: [entry('a1', 'added'), entry('u1', 'conflict')] }
    expect(carryDecisions(PLAN, { a1: 'defer', u1: 'apply' }, next)).toEqual({ a1: 'defer', u1: 'defer' })
  })

  it('이름 중복이 새로 생긴 신규는 사용자가 켰어도 기본(보류)으로 돌린다', () => {
    const next: ResyncPlan = { ...PLAN, entries: [entry('a1', 'added', true)] }
    expect(carryDecisions(PLAN, { a1: 'apply' }, next)).toEqual({ a1: 'defer' })
  })

  it('계획에서 빠진 항목의 결정은 버린다 — 처리 대상 건수에 남지 않는다', () => {
    const next: ResyncPlan = { ...PLAN, entries: [entry('a1', 'added')] }
    const out = carryDecisions(PLAN, { a1: 'defer', u1: 'apply', c1: 'keep' }, next)
    expect(out).toEqual({ a1: 'defer' })
    expect(countActive(out)).toBe(0)
  })

  it('라이브러리가 바뀌었거나 이전 계획이 없으면 잇지 않는다', () => {
    const prev = { a1: 'defer', u1: 'defer' } as const
    expect(carryDecisions({ ...PLAN, libraryId: 'other' }, prev, PLAN)).toEqual(initialDecisions(PLAN))
    expect(carryDecisions(null, prev, PLAN)).toEqual(initialDecisions(PLAN))
  })
})
