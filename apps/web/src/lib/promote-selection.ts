import type { PromoteEntry, PromoteStatus } from '@erdd/core'

/**
 * 기본 선택: 신규·원본 갱신은 켜고, 동명 발견은 사람이 확인해야 하므로 끈다.
 * 원본이 마지막 가져오기 이후 앞선 원본 갱신(`sourceBehind`)도 끈다 — 그 차이는 남이 고친 것이라
 * 그대로 올리면 원본이 이 프로젝트의 옛 값으로 되돌아간다. 사람이 직접 켜는 것은 막지 않는다.
 */
export function initialSelection(entries: readonly PromoteEntry[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) {
    if (entry.status !== 'name-match' && !entry.sourceBehind) out.add(entry.entityId)
  }
  return out
}

/** 특정 상태의 항목 전부를 한 번에 켜거나 끈다(구역 일괄 버튼). */
export function setAllForStatus(
  selected: ReadonlySet<string>, entries: readonly PromoteEntry[],
  status: PromoteStatus, on: boolean,
): Set<string> {
  const out = new Set(selected)
  for (const entry of entries) {
    if (entry.status !== status) continue
    if (on) out.add(entry.entityId)
    else out.delete(entry.entityId)
  }
  return out
}

export function promoteSummary(
  result: { inserted: number; updated: number; skipped: readonly unknown[] },
): string {
  const head = `추가 ${result.inserted}건 · 갱신 ${result.updated}건을 올렸습니다`
  return result.skipped.length === 0
    ? head
    : `${head} — ${result.skipped.length}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
}
