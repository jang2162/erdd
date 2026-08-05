import type { PromoteEntry, PromoteStatus } from '@erdd/core'

/** 기본 선택: 신규·원본 갱신은 켜고, 동명 발견은 사람이 확인해야 하므로 끈다. */
export function initialSelection(entries: readonly PromoteEntry[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) {
    if (entry.status !== 'name-match') out.add(entry.entityId)
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

/**
 * 이 용어를 지금 올리면 도메인 연결이 비는가.
 * 도메인이 이미 라이브러리에 있거나 같은 배치에서 함께 올라가면 연결된다.
 */
export function danglingDomain(entry: PromoteEntry, selected: ReadonlySet<string>): boolean {
  const ref = entry.domainRef
  if (!ref || ref.targetItemId !== null) return false
  return !selected.has(ref.entityId)
}

export function promoteSummary(
  result: { inserted: number; updated: number; skipped: readonly unknown[] },
): string {
  const head = `추가 ${result.inserted}건 · 갱신 ${result.updated}건을 올렸습니다`
  return result.skipped.length === 0
    ? head
    : `${head} — ${result.skipped.length}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
}
