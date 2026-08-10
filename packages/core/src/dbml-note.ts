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
 * buildDbmlNote 의 역. **마지막 `{` 부터 끝까지**를 JSON 으로 읽어 보고, 성공하고 모든 값이
 * 문자열일 때만 꼬리로 떼어낸다. 그 외에는 통째로 설명에 남긴다 — 사람이 손으로 쓴 `{}` 가
 * 섞인 note 를 깨뜨리지 않기 위해서다.
 */
export function splitDbmlNote(
  text: string,
): { logicalName: string; comment: string | null; custom: Record<string, string> } {
  let head = text
  let custom: Record<string, string> = {}
  const open = text.lastIndexOf('{')
  if (open >= 0 && text.trimEnd().endsWith('}')) {
    const parsed = tryParseCustom(text.slice(open).trim())
    if (parsed !== null) {
      custom = parsed
      head = text.slice(0, open)
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
