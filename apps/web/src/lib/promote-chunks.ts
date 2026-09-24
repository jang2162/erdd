import { MAX_OPS_PER_MUTATION, type PromoteEntry, type PromoteStatus } from '@erdd/core'
import { formatCount } from '@/lib/format'

export type PromoteRequestEntry = {
  entityId: string
  expectedStatus: PromoteStatus
  expectedTargetItemId: string | null
  expectedTargetVersion: number | null
}

export type PromoteRunResult = {
  outcome: { inserted: number; updated: number; skipped: unknown[] }
  /** 성공한 조각 수. */
  done: number
  total: number
  /** 성공이면 null. */
  error: unknown
}

/** 화면이 본 계획 → 서버가 락 안에서 대조할 기대치(guides/shared-resources.md 「승격」). payload 는 보내지 않는다. */
export function toPromoteRequest(entry: PromoteEntry): PromoteRequestEntry {
  return {
    entityId: entry.entityId,
    expectedStatus: entry.status,
    expectedTargetItemId: entry.targetItemId,
    expectedTargetVersion: entry.targetVersion,
  }
}

/**
 * 선택을 `resource.promote` 의 입력 상한(MAX_OPS_PER_MUTATION)씩 잘라 **차례로** 보낸다.
 * 자르는 순서는 받은 순서 그대로다 — 호출자는 계획 항목 순서(도메인 → 단어 → 용어 → 커스텀)를 넘긴다. 그래야
 * 용어 조각을 서버가 락 안에서 다시 계획할 때 앞 조각에서 올라간 도메인을 본다.
 * 실패한 조각에서 멈추고 그때까지의 합을 돌려준다(던지지 않는다) — 앞 조각은 이미 서버에 반영돼 있다.
 * `onProgress` 는 조각이 둘 이상일 때만 부른다 — 보내기 전 (0, n), 조각이 끝날 때마다 (i, n).
 */
export async function promoteInChunks(
  entries: readonly PromoteRequestEntry[],
  send: (chunk: PromoteRequestEntry[]) => Promise<{ inserted: number; updated: number; skipped: readonly unknown[] }>,
  onProgress?: (done: number, total: number) => void,
): Promise<PromoteRunResult> {
  const chunks: PromoteRequestEntry[][] = []
  for (let start = 0; start < entries.length; start += MAX_OPS_PER_MUTATION) {
    chunks.push(entries.slice(start, start + MAX_OPS_PER_MUTATION))
  }
  const total = chunks.length
  const outcome = { inserted: 0, updated: 0, skipped: [] as unknown[] }
  // 진행 표시는 화면 일이다 — 콜백이 던져도 남은 조각을 보내지 않거나 실패로 갈리지 않게 삼킨다.
  const report = (n: number) => {
    if (total <= 1) return
    try { onProgress?.(n, total) } catch { /* 진행 표시 실패는 승격을 좌우하지 않는다 */ }
  }
  report(0)
  for (let i = 0; i < total; i++) {
    try {
      const r = await send(chunks[i]!)
      outcome.inserted += r.inserted
      outcome.updated += r.updated
      outcome.skipped.push(...r.skipped)
    } catch (error) {
      return { outcome, done: i, total, error }
    }
    report(i + 1)
  }
  return { outcome, done: total, total, error: null }
}

/** 실패 토스트. 첫 조각 실패는 오류 문구 그대로, 중간 실패는 몇 건이 올라갔는지 말한다. */
export function promoteFailureMessage(requested: number, run: PromoteRunResult): string {
  const message = run.error instanceof Error ? run.error.message : '승격하지 못했습니다'
  if (run.done === 0) return message
  return `${formatCount(requested)}건 중 ${formatCount(run.outcome.inserted + run.outcome.updated)}건 승격했습니다 — ${message}`
}
