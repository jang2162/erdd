import type { ResyncDecision, ResyncPlan, ResyncStatus } from '@erdd/core'

export type Decisions = Record<string, ResyncDecision>

/**
 * 기본 결정: 신규 추가·자동 갱신은 선택, 충돌은 보류.
 * 이름이 이미 있는 신규는 기본 미선택 — 중복 단어·용어가 조용히 생기지 않게 한다.
 */
export function initialDecisions(plan: ResyncPlan): Decisions {
  const out: Decisions = {}
  for (const entry of plan.entries) {
    out[entry.sourceId] = entry.status === 'conflict' || entry.nameClash ? 'defer' : 'apply'
  }
  return out
}

/** 특정 상태의 항목 전부를 한 결정으로 바꾼다(구역 일괄 버튼). */
export function setAllForStatus(
  decisions: Decisions, plan: ResyncPlan, status: ResyncStatus, decision: ResyncDecision,
): Decisions {
  const out = { ...decisions }
  for (const entry of plan.entries) {
    if (entry.status === status) out[entry.sourceId] = decision
  }
  return out
}

/** 실제로 적용될(= defer가 아닌) 항목 수. op 상한 가드와 버튼 활성 판정에 쓴다. */
export function countActive(decisions: Decisions): number {
  return Object.values(decisions).filter((d) => d !== 'defer').length
}
