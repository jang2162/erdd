/** 한 테이블의 저장값(부분). p=물리 부분, l=논리 부분. 키를 짧게 두어 머릿말이 길어지지 않게 한다. */
export type NameMetaEntry = { p: string; l: string }

/**
 * 조합된 물리명 → 부분.
 * ⚠️ **직렬화는 조합 이름을 원문 그대로 적고, 조회 키는 대문자다**(설계 3.1). 대문자로 적어 두면
 * lower_snake 프로젝트의 머릿말이 실제 이름과 달라 보인다 — 파싱할 때 대문자로 다시 색인한다.
 */
export type NameMeta = Record<string, NameMetaEntry>

const MARKER = 'erdd:v1'

/**
 * 머릿말 한 줄. 실을 것이 없으면 null 이다(설계 D4 — 템플릿을 안 쓰는 프로젝트의 산출물이
 * 한 글자도 안 바뀌게 하는 안전장치다).
 *
 * ⚠️ 반드시 **한 줄**이어야 한다. JSON.stringify 는 줄바꿈을 내지 않으므로 그대로 안전하다.
 */
export function serializeNameMeta(meta: NameMeta, prefix: '--' | '//'): string | null {
  if (Object.keys(meta).length === 0) return null
  return `${prefix} ${MARKER} ${JSON.stringify(meta)}`
}

/**
 * 원문 **머리**에서 메타를 읽는다.
 *
 * ⚠️ **첫 비주석·비공백 줄이 나오면 멈춘다**(설계 3.2). 중간에 섞인 마커를 줍지 않고 스캔 비용이
 * 상수다. 없거나 깨졌으면 null — **예외를 던지지 않는다**(설계 D6).
 */
export function parseNameMeta(raw: string): NameMeta | null {
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (s === '') continue
    // 주석이 아니면 본문이 시작된 것이다 — 여기서 멈춘다.
    if (!s.startsWith('--') && !s.startsWith('//')) return null
    const body = s.slice(2).trim()
    if (!body.startsWith(MARKER)) continue        // 사람이 쓴 다른 주석은 지나친다
    return toNameMeta(body.slice(MARKER.length).trim())
  }
  return null
}

/** 형태가 맞는 것만 받아들인다. dbml-note.ts 의 tryParseCustom 과 같은 방어다. */
function toNameMeta(json: string): NameMeta | null {
  let v: unknown
  try {
    v = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: NameMeta = {}
  for (const [k, e] of Object.entries(v)) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return null
    const { p, l } = e as Record<string, unknown>
    if (typeof p !== 'string' || typeof l !== 'string') return null
    out[k.trim().toUpperCase()] = { p, l }
  }
  return out
}
