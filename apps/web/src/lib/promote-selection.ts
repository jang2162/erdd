import type { PromoteEntry, PromoteStatus } from '@erdd/core'
import { formatCount } from '@/lib/format'

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

/**
 * 계획이 다시 계산됐을 때(모델 변경·계획 재조회) 사용자가 정한 선택을 잇는다. 같은 엔티티(`entityId`)가 같은
 * 상태·같은 대상 항목·같은 `sourceBehind` 로 남아 있으면 그 선택을 두고, 새로 생겼거나 상태가 바뀐 항목은 기본
 * 선택(`initialSelection`)을 받는다 — 상태가 바뀌면 사용자가 본 선택지 자체가 달라진다.
 * 다른 라이브러리의 계획에는 쓰지 않는다(엔티티 id 가 같아도 다른 결정이다) — 호출자가 가린다.
 */
export function carrySelection(
  prevEntries: readonly PromoteEntry[], prev: ReadonlySet<string>, next: readonly PromoteEntry[],
): Set<string> {
  const out = initialSelection(next)
  const before = new Map(prevEntries.map((entry) => [entry.entityId, entry]))
  for (const entry of next) {
    const old = before.get(entry.entityId)
    if (old === undefined) continue
    if (old.status !== entry.status || old.targetItemId !== entry.targetItemId
      || old.sourceBehind !== entry.sourceBehind) continue
    if (prev.has(entry.entityId)) out.add(entry.entityId)
    else out.delete(entry.entityId)
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
 * 승격 결과 토스트. 나눠 부른 승격(`chunkCount` ≥ 2)의 건너뜀은 뒤 조각이 앞 조각이 이미 원하는 상태로 만든
 * 항목일 수 있다 — 앞 조각이 도메인을 링크하면 그 도메인을 가리키는 뒤 조각의 용어가 서버 재계산에서 최신이
 * 되어 빠진다. 「그 사이 상태가 바뀌었다」만 말하면 아무도 안 바꿨는데 실패로 읽히므로 문구를 넓힌다.
 */
export function promoteSummary(
  result: { inserted: number; updated: number; skipped: readonly unknown[] },
  chunkCount = 1,
): string {
  const head = `추가 ${formatCount(result.inserted)}건 · 갱신 ${formatCount(result.updated)}건을 올렸습니다`
  if (result.skipped.length === 0) return head
  const skipped = formatCount(result.skipped.length)
  return chunkCount > 1
    ? `${head} — ${skipped}건은 이미 반영됐거나 그 사이 상태가 바뀌어 건너뛰었습니다`
    : `${head} — ${skipped}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
}
