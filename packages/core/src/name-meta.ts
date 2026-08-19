import type { NamingRules } from './naming.js'
import type { ProjectModel, Table } from './model.js'
import { composeTableLogicalName, composeTablePhysicalName } from './name-template.js'

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

/**
 * 머릿말에 실을 것을 고른다.
 *
 * ⚠️ **싣는 기준이 둘이다** — 조합 결과가 부분과 다르거나(템플릿), 그룹에 속하거나.
 * 직전 사이클은 앞엣것만 봤고 그래서 「템플릿을 안 쓰는 프로젝트의 산출물이 한 글자도 안 바뀐다」를
 * 보장했다. 그룹은 템플릿과 무관하므로 그 보장을 그대로 두면 그룹만 쓰는 프로젝트에 기능이 닿지
 * 않는다(설계 D4). 보장은 **「그룹도 템플릿도 안 쓰는 프로젝트」**로 좁아졌다.
 *
 * ⚠️ ddl.ts · dbml.ts 가 **같은 몸통을 복제**하고 있었다. 내보내는 테이블 목록은 인자로 받으므로
 * 공유하지 못할 이유가 없다 — 그룹 수집이 붙으며 커져 한 자리로 합쳤다.
 *
 * ⚠️ **빌드는 그룹 키를 원문 그대로 쓴다**(대문자 색인은 파싱만 한다). 직렬화가 `item.name` 을
 * 키로 쓰므로 어느 쪽이든 JSON 에는 원문 이름이 나간다.
 */
export function buildNameMeta(
  model: ProjectModel, tables: Table[], rules: NamingRules,
): NameMeta {
  const meta: NameMeta = { tables: {}, groups: {} }
  for (const t of tables) {
    const p = composeTablePhysicalName(t, model, rules)
    const l = composeTableLogicalName(t, model, rules)
    const group = t.groupId === null ? undefined : model.tableGroups[t.groupId]
    if (p === t.physicalName && l === t.logicalName && group === undefined) continue
    meta.tables[p] = group === undefined
      ? { p: t.physicalName, l: t.logicalName }
      : { p: t.physicalName, l: t.logicalName, g: group.name }
    if (group === undefined || meta.groups[group.name] !== undefined) continue
    const item: NameMetaGroup = { name: group.name }
    if (group.alias !== '') item.a = group.alias
    if (group.color !== '') item.c = group.color
    if (group.comment !== null && group.comment !== '') item.n = group.comment
    meta.groups[group.name] = item
  }
  return meta
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
 *
 * ⚠️ **이 검사가 실제로 갈라 내는 것은 공백 없이 JSON 이 붙은 입력뿐이다** — `-- erdd:v1{…}`.
 * `erdd:v11` 은 검사가 없어도 남는 문자열이 `1 {…}` 라 `JSON.parse` 가 대신 막는다(독립 리뷰가
 * 실증했다 — 검사를 지워도 스위트가 전부 초록이었고, 판별력 있는 입력은 공백 없는 쪽뿐이다).
 * 그래서 잠금 테스트도 그 입력을 쓴다.
 *
 * ⚠️ 이것은 **옛 v1 파서보다 엄격해진 동작 변경**이다(옛 파서는 `-- erdd:v1{…}` 를 읽었다).
 * ERDD 가 낸 덤프는 늘 공백을 넣으므로 실사용 영향은 없다.
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
