import { commentText } from './ddl.js'

/**
 * DBML note 문자열을 만든다. 형태는 `논리명 - 설명 {"항목":"값"}` 이고 앞부분 규칙은
 * DDL 코멘트(commentText)와 **완전히 같다** — 커스텀 항목 JSON 꼬리만 DBML 고유다.
 * 값이 빈 문자열인 항목은 미입력이므로(resolveCustomValue 의 판정과 같다) 싣지 않는다.
 */
export function buildDbmlNote(
  logicalName: string, physicalName: string, comment: string | null,
  custom: Record<string, string>,
): string | null {
  const entries = Object.entries(custom).filter(([, v]) => v !== '')
  const head = commentText(logicalName, physicalName, comment)
  if (entries.length === 0) return head
  const tail = JSON.stringify(Object.fromEntries(entries))
  // head 가 null 인 것은 "논리명==물리명 + 설명 없음"이다. 이때도 커스텀은 실어야 하므로
  // 논리명을 앞에 둔다(가져오기가 논리명 자리를 그대로 읽는다).
  return head === null ? `${logicalName} ${tail}`.trim() : `${head} ${tail}`
}

/**
 * buildDbmlNote 의 역. `{` 위치를 **앞에서부터 훑어 끝까지가 JSON 으로 파싱되는 첫 지점**을
 * 꼬리로 떼어낸다(모든 값이 문자열일 때만). 어느 위치도 성공하지 않으면 통째로 설명에 남긴다 —
 * 사람이 손으로 쓴 `{}` 가 섞인 note 를 깨뜨리지 않기 위해서다.
 *
 * 처음에는 "마지막 `{` 부터"였는데(설계 §3), 그 규칙은 **커스텀 값 안의 `{`** 를 못 지켰다 —
 * 값의 `{` 가 마지막이 되어 파싱이 실패하고 꼬리 전체가 설명·논리명으로 조용히 샜다(리뷰 M-3).
 * 값은 사용자 자유 입력이라 `{` 가 들어올 자리가 설명보다 좁지 않다. 앞에서부터 훑으면
 * 설명 속 `{중괄호}` 에서는 파싱이 실패해 그대로 넘어가므로 두 요구가 함께 성립한다.
 */
export function splitDbmlNote(
  text: string,
): { logicalName: string; comment: string | null; custom: Record<string, string> } {
  let head = text
  let custom: Record<string, string> = {}
  if (text.trimEnd().endsWith('}')) {
    for (let open = text.indexOf('{'); open >= 0; open = text.indexOf('{', open + 1)) {
      const parsed = tryParseCustom(text.slice(open).trim())
      if (parsed === null) continue
      custom = parsed
      head = text.slice(0, open)
      break
    }
  }
  const trimmed = head.trim()
  const i = trimmed.indexOf(' - ')
  if (i < 0) return { logicalName: trimmed, comment: null, custom }
  return {
    logicalName: trimmed.slice(0, i).trim(),
    comment: trimmed.slice(i + 3).trim() || null,
    custom,
  }
}

function tryParseCustom(s: string): Record<string, string> | null {
  let v: unknown
  try {
    v = JSON.parse(s)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string') return null
    out[k] = val
  }
  return out
}
