/** 한 테이블의 저장값(부분) + 그룹 배정. p=물리 부분, l=논리 부분, g=그룹 이름(속할 때만).
 * 키를 짧게 두어 머릿말이 길어지지 않게 한다. */
export type NameMetaEntry = { p: string; l: string; g?: string }

/**
 * 그룹 속성. a=별칭, c=색, n=코멘트. 빈 값은 키를 생략해 머릿말을 짧게 유지한다.
 * ⚠️ name 은 **직렬화하지 않는다** — JSON 의 그룹 키가 곧 원문 이름이고, 파서가 키를 대문자로
 * 색인하면서 원문 키를 여기에 담는다(그래야 그룹을 만들 때 이름이 대문자로 뭉개지지 않는다).
 */
export type NameMetaGroup = { name: string; a?: string; c?: string; n?: string }

/**
 * 머릿말이 나르는 것 전부. 최상위가 `t`(테이블) · `g`(그룹) 두 구획으로 갈린다.
 * ⚠️ **직렬화는 이름을 원문 그대로 적고, 조회 키는 대문자다**(설계 3.1). 대문자로 적어 두면
 * lower_snake 프로젝트의 머릿말이 실제 이름과 달라 보인다 — 파싱할 때 대문자로 다시 색인한다.
 */
export type NameMeta = {
  /** 조합된 물리명(대문자 색인) → 부분 + 그룹 이름 */
  tables: Record<string, NameMetaEntry>
  /** 그룹 이름(대문자 색인) → 속성 */
  groups: Record<string, NameMetaGroup>
}

const MARKER_V2 = 'erdd:v2'
const MARKER_V1 = 'erdd:v1'

/**
 * 머릿말 한 줄. 실을 것이 없으면 null 이다(설계 D4 — 템플릿도 그룹도 안 쓰는 프로젝트의
 * 산출물이 한 글자도 안 바뀌게 하는 안전장치다).
 *
 * ⚠️ 반드시 **한 줄**이어야 한다. JSON.stringify 는 줄바꿈을 내지 않으므로 그대로 안전하다.
 */
export function serializeNameMeta(meta: NameMeta, prefix: '--' | '//'): string | null {
  if (Object.keys(meta.tables).length === 0 && Object.keys(meta.groups).length === 0) return null
  // 그룹은 **원문 이름을 키로** 적는다 — name 을 값에 중복해 싣지 않는다(설계 3.1).
  const g: Record<string, Omit<NameMetaGroup, 'name'>> = {}
  for (const item of Object.values(meta.groups)) {
    const { name, ...rest } = item
    g[name] = rest
  }
  return `${prefix} ${MARKER_V2} ${JSON.stringify({ t: meta.tables, g })}`
}

/**
 * 원문 **머리**에서 메타를 읽는다. v2 와 v1 을 모두 읽는다 — 이미 내보낸 v1 덤프가 그대로
 * 살아야 하기 때문이다.
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
    const v2 = afterMarker(body, MARKER_V2)
    if (v2 !== null) return toV2(v2)
    const v1 = afterMarker(body, MARKER_V1)
    if (v1 !== null) return toV1(v1)
    continue                                      // 사람이 쓴 다른 주석은 지나친다
  }
  return null
}

/**
 * 마커 바로 뒤가 공백(또는 끝)일 때만 그 버전으로 본다.
 * ⚠️ 이 경계 검사가 없으면 `erdd:v11` 이 `erdd:v1` 로 읽힌다.
 */
function afterMarker(body: string, marker: string): string | null {
  if (!body.startsWith(marker)) return null
  const rest = body.slice(marker.length)
  if (rest !== '' && !/^\s/.test(rest)) return null
  return rest.trim()
}

function tryJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** v1 은 최상위가 곧 테이블 맵이었다. 그룹은 없다. */
function toV1(json: string): NameMeta | null {
  const v = tryJson(json)
  if (!isPlain(v)) return null
  const tables = readTables(v)
  return tables === null ? null : { tables, groups: {} }
}

/** 형태가 맞는 것만 받아들인다. dbml-note.ts 의 tryParseCustom 과 같은 방어다. */
function toV2(json: string): NameMeta | null {
  const v = tryJson(json)
  if (!isPlain(v)) return null
  if (!isPlain(v['t'])) return null
  const tables = readTables(v['t'])
  if (tables === null) return null
  const rawGroups = v['g']
  if (rawGroups !== undefined && !isPlain(rawGroups)) return null
  const groups: Record<string, NameMetaGroup> = {}
  for (const [k, e] of Object.entries(rawGroups ?? {})) {
    if (!isPlain(e)) return null
    const item: NameMetaGroup = { name: k }
    for (const f of ['a', 'c', 'n'] as const) {
      const x = e[f]
      if (x === undefined) continue
      if (typeof x !== 'string') return null
      item[f] = x
    }
    groups[k.trim().toUpperCase()] = item
  }
  return { tables, groups }
}

function readTables(v: Record<string, unknown>): Record<string, NameMetaEntry> | null {
  const out: Record<string, NameMetaEntry> = {}
  for (const [k, e] of Object.entries(v)) {
    if (!isPlain(e)) return null
    const { p, l, g } = e
    if (typeof p !== 'string' || typeof l !== 'string') return null
    if (g !== undefined && typeof g !== 'string') return null
    out[k.trim().toUpperCase()] = g === undefined ? { p, l } : { p, l, g }
  }
  return out
}
