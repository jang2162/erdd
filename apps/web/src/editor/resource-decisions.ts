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

/**
 * 계획이 다시 계산됐을 때(모델 변경·항목 재조회) 사용자가 정한 결정을 잇는다. 같은 원본 항목(`sourceId`)이
 * 같은 상태·같은 이름 중복 여부로 남아 있으면 그 결정을 두고, 새로 생겼거나 상태가 바뀐 항목은 기본 결정을
 * 받는다 — 상태가 바뀌면 사용자가 본 선택지 자체가 달라진다(예: 자동 갱신 → 충돌). 이름 중복이 새로 생긴
 * 신규도 기본(보류)으로 돌린다 — 이어 쓰면 중복 단어·용어가 조용히 생긴다.
 * 라이브러리가 바뀌었으면(`libraryId`) 잇지 않는다. 계획에서 빠진 항목의 결정은 버린다.
 */
export function carryDecisions(prevPlan: ResyncPlan | null, prev: Decisions, next: ResyncPlan): Decisions {
  const out = initialDecisions(next)
  if (prevPlan === null || prevPlan.libraryId !== next.libraryId) return out
  const before = new Map(prevPlan.entries.map((entry) => [entry.sourceId, entry]))
  for (const entry of next.entries) {
    const old = before.get(entry.sourceId)
    const kept = prev[entry.sourceId]
    if (old === undefined || kept === undefined) continue
    if (old.status === entry.status && old.nameClash === entry.nameClash) out[entry.sourceId] = kept
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

/** 실제로 적용될(= defer가 아닌) 항목 수. 적용 버튼 활성 판정과 처리 대상 표시에 쓴다. */
export function countActive(decisions: Decisions): number {
  return Object.values(decisions).filter((d) => d !== 'defer').length
}
