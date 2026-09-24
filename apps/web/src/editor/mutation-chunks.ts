import { formatCount } from '@/lib/format'

/** 서버 `model.mutate` 의 summary 상한(zod `max(200)`). 조각 번호를 붙여도 넘지 않게 원래 요약을 자른다. */
export const SUMMARY_MAX_LENGTH = 200
/** 요약 없이 나눠 보낼 때의 이름 — 이력에서 조각들을 한 묶음으로 알아보게 한다. */
export const CHUNKED_SUMMARY_FALLBACK = '대량 편집'

/** 순서를 그대로 두고 size 씩 자른다. 순서가 정확성 조건이다(guides/data-layer.md 「한 요청의 op 상한은 …」). */
export function chunkOps<T>(ops: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('size 는 1 이상이어야 합니다')
  const out: T[][] = []
  for (let start = 0; start < ops.length; start += size) out.push(ops.slice(start, start + size))
  return out
}

/** `〈원래 요약〉 (i/n)`. 조각이 하나면 원래 요약 그대로다. */
export function chunkSummary(summary: string | undefined, index: number, total: number): string | undefined {
  if (total <= 1) return summary
  const suffix = ` (${formatCount(index)}/${formatCount(total)})`
  const base = summary ?? CHUNKED_SUMMARY_FALLBACK
  return `${base.slice(0, SUMMARY_MAX_LENGTH - suffix.length)}${suffix}`
}

/**
 * 실패 토스트 문구. 첫 조각의 실패는 지금의 단일 실패와 같은 문구이고, 중간 실패만 몇 묶음이 들어갔는지 말한다
 * — 앞 조각은 서버에 남아 있으므로 사용자가 그 사실을 알아야 한다.
 */
export function chunkFailureMessage(done: number, total: number, message: string): string {
  if (done === 0 || done >= total) return message
  return `${formatCount(total)}개 묶음 중 ${formatCount(done)}개를 적용했고 나머지는 적용하지 못했습니다 — ${message}`
}
