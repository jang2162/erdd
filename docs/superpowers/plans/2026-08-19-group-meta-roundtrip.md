# 머릿말로 그룹·별칭까지 왕복 복원 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내보낸 DDL·DBML 의 머릿말에 그룹 배정과 그룹 속성(별칭·색·코멘트)을 실어, 되읽을 때 그룹이 복원되고 그룹이 다른 같은 이름의 테이블이 더 이상 잘못 건너뛰어지지 않게 한다.

**Architecture:** 머릿말 형식을 `erdd:v2` 로 올려 최상위를 `t`(테이블) · `g`(그룹) 두 구획으로 나눈다. v1 은 계속 읽는다. `ddl.ts` · `dbml.ts` 에 복제돼 있던 머릿말 빌더를 `name-meta.ts` 로 합치고 그룹 수집을 더한다. 가져오기는 머릿말 그룹을 `DdlImportGroup[]` 에 합류시키고, 이름 충돌 판정 키를 **(그룹 이름, 만들어질 부분 이름)** 으로 넓힌다.

**Tech Stack:** TypeScript, vitest, zod (모델 스키마), React 19 (웹 한 줄만)

**Spec:** `docs/superpowers/specs/2026-08-19-group-meta-roundtrip-design.md`

## Global Constraints

- 응답·주석·커밋 메시지·문서는 **한국어**로 쓴다.
- **서버 변경 없음. 마이그레이션 없음. CLI 변경 없음.** 웹 프로덕션 변경은 `ddl-import-edits.ts` 한 줄뿐이다.
- 🔥 **`. ./.env` 로 테스트를 돌리지 마라.** 서버 스위트는 이 변경과 무관하다(`apps/server` 는 `ddl-import` 를 쓰지 않는다 — 전수 확인했다). DB 설정도 필요 없다. `pnpm typecheck` 만 전체로 돌린다.
- **`git add -A` · `git add .` · `git commit -a` 금지.** 경로를 명시해서 커밋하고, `git add <경로들> && git commit ...` 처럼 한 명령으로 붙인다.
- `.idea/*` · 루트 `.env` 는 커밋하지 않는다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c
  ```
- **기준선(작업 시작 시점):** core 805 · web 938 · typecheck EXIT=0.
- **파싱은 절대 예외를 던지지 않는다**(직전 설계 D6). 형태가 안 맞으면 전부 `null`.
- 머릿말은 **반드시 한 줄**이다. `JSON.stringify` 는 줄바꿈을 내지 않으므로 그대로 안전하다.

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `packages/core/src/name-meta.ts` | 머릿말 형식의 **단일 소유자** — 직렬화·파싱·**빌드** | Task 1·2 |
| `packages/core/src/ddl.ts` | DDL 생성. 머릿말 빌더를 **잃는다**(name-meta 로 이관) | Task 1·2 |
| `packages/core/src/dbml.ts` | DBML 생성. 위와 같음 | Task 1·2 |
| `packages/core/src/ddl-import.ts` | 계획 수립 — 그룹 합류 · 충돌 판정 · 경고 | Task 1·3·4·5 |
| `packages/core/src/index.ts` | 공개 표면 | Task 1·2 |
| `apps/web/src/editor/ddl-import-edits.ts` | 계획 적용 — 그룹 생성 시 별칭 | Task 3 |

⚠️ `packages/core/src/ddl-parse.ts` · `dbml-parse.ts` 는 `parseNameMeta` 를 호출만 하므로 **타입만 따라간다**(코드 변경 없음).

---

## ⚠️ 먼저 읽어라 — 이번 변경으로 **기존 테스트가 깨지는 자리 전수**

전부 미리 찾아 뒀다. 각 Task 가 자기 몫을 함께 고친다. **여기 없는 테스트가 빨개지면 멈추고 보고해라.**

| 위치 | 지금 | 왜 바뀌나 | Task |
|---|---|---|---|
| `name-meta.test.ts:4` `META` 상수 | `{ TB_MBR_ORD: {p,l} }` | 타입이 `{tables, groups}` 로 바뀐다 | 1 |
| `name-meta.test.ts:9,14` | `erdd:v1 ` 접두 단언 | 내보내기가 **v2** 를 낸다 | 1 |
| `name-meta.test.ts:60` 「모르는 버전은 null 이다」 | 픽스처가 `erdd:v2` | **v2 가 아는 버전이 된다** → `erdd:v9` 로 바꾼다 | 1 |
| `name-meta.test.ts:24,28,32,37,44,49,55,64-67` | v1 입력 → 값 | **그대로 통과해야 한다**(하위호환 잠금). 반환 **형태**만 `{tables, groups:{}}` 로 | 1 |
| `ddl-parse.test.ts:702` · `dbml-parse.test.ts:253` | `toEqual({ TB_MBR_ORD: {p,l} })` | 반환 형태만 | 1 |
| `ddl.test.ts:428` · `dbml.test.ts:391,399` | `erdd:v1` 접두 | v2 | 1 |
| `ddl.test.ts:430` · `ddl.test.ts:449` | `meta['TB_MBR_MBR']` · `Object.keys(parseNameMeta(sql)!)` | `.tables` 를 거쳐야 한다 | 1 |
| **`ddl.test.ts:434` 「템플릿이 없으면 머릿말이 없다」** | `m()` = `buildSampleModel()` 인데 **두 테이블이 `g1` 소속** | **D4 가 좁아져 이제 머릿말이 나온다** — 그룹 없는 모델로 바꿔야 한다 | 2 |
| **`ddl.test.ts:441` 「조합 결과가 부분과 같으면 머릿말이 없다」** | 같은 이유 | 같음 | 2 |
| **`dbml.test.ts:403` 「템플릿이 없으면 머릿말이 없다」** | 같은 이유 | 같음 | 2 |
| `ddl-import.ts:77` `parsed.nameMeta?.[upper(raw)]` | flat 접근 | `.tables[upper(raw)]` | 1 |

**그대로 초록이어야 하는 것(건드리지 마라 — 이것이 v1 하위호환의 잠금이다):**

- `ddl-import.test.ts:645` · `:673` · `:696` — v1 머릿말 입력. 특히 **`:696` 「다른 그룹의 두 테이블이 같은 부분으로 복원되면 뒤엣것이 빠진다」는 v1 이라 그룹 정보가 없으므로 뒤집히지 않는다.** Task 4 를 끝낸 뒤에도 초록이어야 한다.

---

## Task 1: 머릿말 형식을 `erdd:v2` 로 올린다 (하위호환 유지)

**Files:**
- Modify: `packages/core/src/name-meta.ts` (전면)
- Modify: `packages/core/src/index.ts:79-80`
- Modify: `packages/core/src/ddl.ts:242-252` (`buildNameMeta` 반환 형태만)
- Modify: `packages/core/src/dbml.ts:197-206` (같음)
- Modify: `packages/core/src/ddl-import.ts:77`
- Test: `packages/core/src/name-meta.test.ts`, `ddl-parse.test.ts`, `dbml-parse.test.ts`, `ddl.test.ts`, `dbml.test.ts`

**Interfaces:**
- Produces: `NameMetaEntry = { p: string; l: string; g?: string }` · `NameMetaGroup = { name: string; a?: string; c?: string; n?: string }` · `NameMeta = { tables: Record<string, NameMetaEntry>; groups: Record<string, NameMetaGroup> }` · `serializeNameMeta(meta: NameMeta, prefix: '--' | '//'): string | null` · `parseNameMeta(raw: string): NameMeta | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/name-meta.test.ts` 의 상단 상수와 기존 케이스를 새 형태로 바꾸고, v2 케이스를 더한다.

```ts
const META: NameMeta = {
  tables: { TB_MBR_ORD: { p: 'ORD', l: '주문', g: '회원관리' } },
  groups: { 회원관리: { name: '회원관리', a: 'MBR', c: '#4A90D9', n: '회원 도메인' } },
}

describe('serializeNameMeta', () => {
  it('한 줄로 낸다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line.startsWith('-- erdd:v2 ')).toBe(true)
    expect(line).not.toContain('\n')
  })

  it('접두만 갈린다', () => {
    expect(serializeNameMeta(META, '//')!.startsWith('// erdd:v2 ')).toBe(true)
  })

  // ⚠️ 그룹 키가 곧 원문 이름이다 — name 을 따로 싣지 않는다(설계 3.1).
  it('그룹 구획의 키가 원문 이름이고 name 키는 없다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line).toContain('"g":{"회원관리":{"a":"MBR","c":"#4A90D9","n":"회원 도메인"}}')
    expect(line).not.toContain('"name"')
  })

  it('테이블도 그룹도 없으면 null 이다', () => {
    expect(serializeNameMeta({ tables: {}, groups: {} }, '--')).toBeNull()
  })
})

describe('parseNameMeta — v2', () => {
  it('직렬화한 것을 되읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '--')!)).toEqual(META)
  })

  it('조회 키는 대문자로 정규화하고 원문 이름은 name 이 나른다', () => {
    const m = parseNameMeta('-- erdd:v2 {"t":{"tb_mbr_ord":{"p":"ORD","l":"주문","g":"sales"}},"g":{"sales":{"a":"SLS"}}}')!
    expect(m.tables['TB_MBR_ORD']).toEqual({ p: 'ORD', l: '주문', g: 'sales' })
    expect(m.groups['SALES']).toEqual({ name: 'sales', a: 'SLS' })
  })

  it('그룹 구획이 없어도 읽는다', () => {
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}}}'))
      .toEqual({ tables: { X: { p: 'A', l: '가' } }, groups: {} })
  })

  it('형태가 다르면 null 이다', () => {
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A"}}}')).toBeNull()             // l 없음
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가","g":1}}}')).toBeNull() // g 가 문자열 아님
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}},"g":{"G":"x"}}')).toBeNull() // 그룹 값이 객체 아님
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}},"g":{"G":{"a":1}}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v2 {"g":{}}')).toBeNull()                          // t 없음
  })
})

describe('parseNameMeta — v1 하위호환', () => {
  // ⚠️ 이미 내보낸 덤프가 그대로 살아야 한다. groups 는 빈 객체다.
  it('v1 머릿말을 읽으면 groups 가 비어 있다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}'))
      .toEqual({ tables: { TB_MBR_ORD: { p: 'ORD', l: '주문' } }, groups: {} })
  })

  it('v1 의 형태 검사는 그대로다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":1,"l":"주문"}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v1 ["ORD"]')).toBeNull()
    expect(parseNameMeta('-- erdd:v1 null')).toBeNull()
  })

  // ⚠️ 마커 뒤에 공백이 와야 그 버전이다 — 안 그러면 erdd:v11 이 v1 로 읽힌다.
  it('모르는 버전은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v9 {"t":{}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v11 {"TB":{"p":"ORD","l":"주문"}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v21 {"t":{"X":{"p":"A","l":"가"}}}')).toBeNull()
  })
})
```

⚠️ **기존 케이스 중 「DBML 접두도 읽는다」·「앞선 다른 주석과 빈 줄은 지나친다」·「첫 문장 뒤의 마커는 줍지 않는다」·「마커가 없으면 null 이다」·「깨진 JSON 은 null 이다」는 v1 입력 그대로 두고 단언 형태만 `{tables, groups:{}}` 로 맞춰라.** 그 케이스들이 지키는 것은 버전이 아니라 스캔 규칙이다.

- [ ] **Step 2: 빨간지 확인한다**

```bash
pnpm -C packages/core test src/name-meta.test.ts
```
기대: 컴파일 단계에서 `NameMeta` 형태 불일치로 실패한다.

- [ ] **Step 3: `name-meta.ts` 를 다시 쓴다**

```ts
/** 한 테이블의 저장값(부분) + 그룹 배정. g 는 그룹에 속할 때만 있다. */
export type NameMetaEntry = { p: string; l: string; g?: string }
/**
 * 그룹 속성. a=별칭, c=색, n=코멘트. 빈 값은 키를 생략해 머릿말을 짧게 유지한다.
 * ⚠️ name 은 **직렬화하지 않는다** — JSON 의 그룹 키가 곧 원문 이름이고, 파서가 키를 대문자로
 * 색인하면서 원문 키를 여기에 담는다(그래야 그룹을 만들 때 이름이 대문자로 뭉개지지 않는다).
 */
export type NameMetaGroup = { name: string; a?: string; c?: string; n?: string }

export type NameMeta = {
  /** 조합된 물리명(대문자 색인) → 부분 + 그룹 이름 */
  tables: Record<string, NameMetaEntry>
  /** 그룹 이름(대문자 색인) → 속성 */
  groups: Record<string, NameMetaGroup>
}

const MARKER_V2 = 'erdd:v2'
const MARKER_V1 = 'erdd:v1'

export function serializeNameMeta(meta: NameMeta, prefix: '--' | '//'): string | null {
  if (Object.keys(meta.tables).length === 0 && Object.keys(meta.groups).length === 0) return null
  const g: Record<string, Omit<NameMetaGroup, 'name'>> = {}
  for (const item of Object.values(meta.groups)) {
    const { name, ...rest } = item
    g[name] = rest
  }
  return `${prefix} ${MARKER_V2} ${JSON.stringify({ t: meta.tables, g })}`
}

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
    continue                                    // 사람이 쓴 다른 주석은 지나친다
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
```

- [ ] **Step 4: 호출부를 기계적으로 맞춘다 (아직 그룹은 안 싣는다)**

`packages/core/src/ddl.ts` 와 `dbml.ts` 의 `buildNameMeta` 는 **이 Task 에서는 형태만** 바꾼다. 그룹 수집은 Task 2 다.

```ts
function buildNameMeta(model: ProjectModel, tables: Table[], rules: NamingRules): NameMeta {
  const meta: NameMeta = { tables: {}, groups: {} }
  for (const t of tables) {
    const p = composeTablePhysicalName(t, model, rules)
    const l = composeTableLogicalName(t, model, rules)
    if (p === t.physicalName && l === t.logicalName) continue
    meta.tables[p] = { p: t.physicalName, l: t.logicalName }
  }
  return meta
}
```

`packages/core/src/ddl-import.ts:77`:

```ts
  const metaOf = (raw: string): NameMetaEntry | undefined => parsed.nameMeta?.tables[upper(raw)]
```

`packages/core/src/index.ts:80`:

```ts
export type { NameMeta, NameMetaEntry, NameMetaGroup } from './name-meta.js'
```

- [ ] **Step 5: 파서·생성 테스트의 단언 형태를 맞춘다**

`ddl-parse.test.ts:702`:
```ts
    expect(parsed.nameMeta).toEqual({ tables: { TB_MBR_ORD: { p: 'ORD', l: '주문' } }, groups: {} })
```
`dbml-parse.test.ts:253` 도 같은 형태로.

`ddl.test.ts:428-430`:
```ts
    expect(first.startsWith('-- erdd:v2 ')).toBe(true)
    const meta = parseNameMeta(sql)!
    expect(meta.tables['TB_MBR_MBR']).toEqual({ p: 'MBR', l: '회원' })
```
`ddl.test.ts:449`:
```ts
    expect(Object.keys(parseNameMeta(sql)!.tables)).not.toContain('TB_MBR_NOCOL')
```
`dbml.test.ts:391`: `'// erdd:v2 '` · `dbml.test.ts:399`: `out.indexOf('// erdd:v2')`

- [ ] **Step 6: 초록인지 확인한다**

```bash
pnpm -C packages/core test
pnpm typecheck
```
기대: **전부 초록.** `ddl.test.ts:434` · `:441` · `dbml.test.ts:403` 은 이 Task 에서는 D4 가 아직 안 넓어졌으므로 그대로 통과한다.

- [ ] **Step 7: 실증 — 하위호환이 진짜 잠겼는가**

`toV1` 호출을 지워(`const v1 = ...; if (v1 !== null) return toV1(v1)` 를 `return null` 로) v1 을 못 읽게 만들고 돌린다.

```bash
git diff packages/core/src/name-meta.ts     # ⚠️ 치환이 적용됐는지 눈으로 확인한 뒤에
pnpm -C packages/core test                  # 측정 범위: core 스위트 전체
```
기대: `name-meta.test.ts` 의 v1 케이스들과 `ddl-import.test.ts` 의 v1 머릿말 케이스 3건이 함께 빨개진다. **몇 건이 빨갰는지 측정 범위와 함께 기록한다.** 확인 뒤 `git checkout` 으로 되돌리고 `git diff` 가 빈 것을 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/name-meta.ts packages/core/src/name-meta.test.ts packages/core/src/index.ts packages/core/src/ddl.ts packages/core/src/dbml.ts packages/core/src/ddl-import.ts packages/core/src/ddl-parse.test.ts packages/core/src/dbml-parse.test.ts packages/core/src/ddl.test.ts packages/core/src/dbml.test.ts && git commit -m "feat(core): 머릿말 형식을 erdd:v2 로 올리고 v1 을 계속 읽는다

..."
```

---

## Task 2: 머릿말 빌더를 합치고 그룹을 싣는다 (D4 확대)

**Files:**
- Modify: `packages/core/src/name-meta.ts` (`buildNameMeta` 신설)
- Modify: `packages/core/src/ddl.ts` (지역 `buildNameMeta` 삭제, import 로 대체)
- Modify: `packages/core/src/dbml.ts` (같음)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/name-meta.test.ts`, `ddl.test.ts`, `dbml.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `NameMeta` · `NameMetaGroup`
- Produces: `buildNameMeta(model: ProjectModel, tables: Table[], rules: NamingRules): NameMeta`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/name-meta.test.ts` 끝에 붙인다.

```ts
describe('buildNameMeta', () => {
  // buildSampleModel 은 테이블 둘(MBR_GRD·MBR)이 모두 그룹 g1(회원관리) 소속이다.
  const grouped = (): ProjectModel => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR', comment: '회원 도메인' }
    return m
  }
  const tables = (m: ProjectModel) => Object.values(m.tables)

  // ⚠️ 설계 D4 가 좁아진 자리 — 템플릿이 없어도 그룹이 있으면 싣는다.
  it('조합 결과가 부분과 같아도 그룹에 속하면 싣는다', () => {
    const m = grouped()
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta.tables['MBR']).toEqual({ p: 'MBR', l: '회원', g: '회원관리' })
    expect(meta.groups['회원관리']).toEqual({ name: '회원관리', a: 'MBR', c: '#4A90D9', n: '회원 도메인' })
  })

  it('빈 별칭·빈 코멘트는 키를 생략한다', () => {
    const m = buildSampleModel()                       // alias '' · comment null
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta.groups['회원관리']).toEqual({ name: '회원관리', c: '#4A90D9' })
  })

  // ⚠️ 좁아진 보장 — 그룹도 템플릿도 없으면 여전히 빈 메타다.
  it('그룹도 템플릿도 없으면 빈 메타다', () => {
    const m = buildSampleModel()
    m.tables['t1'] = { ...m.tables['t1']!, groupId: null }
    m.tables['t2'] = { ...m.tables['t2']!, groupId: null }
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta).toEqual({ tables: {}, groups: {} })
    expect(serializeNameMeta(meta, '--')).toBeNull()
  })

  it('내보내는 목록에 없는 테이블의 그룹은 싣지 않는다', () => {
    const m = grouped()
    m.tableGroups['g2'] = { id: 'g2', name: '상품', color: '#111', comment: null, alias: 'PRD' }
    m.tables['t9'] = { ...m.tables['t2']!, id: 't9', physicalName: 'PRD', groupId: 'g2' }
    const meta = buildNameMeta(m, [m.tables['t1']!, m.tables['t2']!], DEFAULT_NAMING_RULES)
    expect(Object.keys(meta.groups)).toEqual(['회원관리'])
  })
})
```

`ddl.test.ts` 의 D4 케이스 둘을 **그룹 없는 모델**로 바꾸고, 그룹만 있는 경우를 새로 더한다.

```ts
  /** 그룹을 뗀 모델. D4 의 좁아진 보장(「그룹도 템플릿도 안 쓰는 프로젝트」)을 재는 자다. */
  function ungrouped(): ProjectModel {
    const x = m()
    x.tables['t1'] = { ...x.tables['t1']!, groupId: null }
    x.tables['t2'] = { ...x.tables['t2']!, groupId: null }
    return x
  }

  // ⚠️ 설계 D4(좁아짐) — 그룹도 템플릿도 없어야 기존 산출물 무변경이 보장된다.
  it('그룹도 템플릿도 없으면 머릿말이 없다', () => {
    const sql = generateDdlRaw(ungrouped(), 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES)
    expect(sql.startsWith('--')).toBe(false)
    expect(parseNameMeta(sql)).toBeNull()
  })

  it('그룹이 없으면 조합 결과가 부분과 같을 때 머릿말이 없다', () => {
    const sql = generateDdlRaw(ungrouped(), 'postgresql', { kind: 'all' }, tpl('{물리명}'))
    expect(parseNameMeta(sql)).toBeNull()
  })

  // ⚠️ 이번 사이클이 넓힌 자리 — 템플릿이 없어도 그룹이 있으면 머릿말이 나간다.
  it('템플릿이 없어도 그룹이 있으면 머릿말이 나온다', () => {
    const sql = generateDdlRaw(m(), 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES)
    expect(sql.split('\n')[0]!.startsWith('-- erdd:v2 ')).toBe(true)
    expect(parseNameMeta(sql)!.groups['회원관리']!.a).toBe('MBR')
  })
```

`dbml.test.ts:403` 도 같은 방식으로 바꾸고(`ungrouped()`), 그룹만 있는 경우 한 건을 더한다.

```ts
  it('그룹도 템플릿도 없으면 머릿말이 없다', () => {
    expect(parseNameMeta(generateDbmlRaw(ungrouped(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES)))
      .toBeNull()
  })

  it('템플릿이 없어도 그룹이 있으면 // 머릿말이 나온다', () => {
    const out = generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES)
    expect(out.split('\n')[0]!.startsWith('// erdd:v2 ')).toBe(true)
  })
```

- [ ] **Step 2: 빨간지 확인한다**

```bash
pnpm -C packages/core test src/name-meta.test.ts src/ddl.test.ts src/dbml.test.ts
```
기대: `buildNameMeta` 미정의로 실패 + D4 새 케이스들이 실패.

- [ ] **Step 3: `name-meta.ts` 에 빌더를 만든다**

```ts
import type { NamingRules } from './naming.js'
import type { ProjectModel, Table } from './model.js'
import { composeTableLogicalName, composeTablePhysicalName } from './name-template.js'

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
```

⚠️ **빌드는 그룹 키를 원문 그대로 쓴다**(파싱만 대문자로 색인한다). 직렬화가 `item.name` 을 키로 쓰므로 어느 쪽이든 JSON 은 원문이 나간다.

- [ ] **Step 4: `ddl.ts` · `dbml.ts` 의 지역 헬퍼를 지운다**

두 파일에서 `function buildNameMeta(...) {...}` 블록과 그 위 주석을 **삭제**하고 import 로 바꾼다.

```ts
import { buildNameMeta, serializeNameMeta } from './name-meta.js'
```

호출부(`ddl.ts:266` · `dbml.ts:227`)는 그대로다. `index.ts` 에 `buildNameMeta` 를 내보낸다.

```ts
export { serializeNameMeta, parseNameMeta, buildNameMeta } from './name-meta.js'
```

- [ ] **Step 5: 초록인지 확인한다**

```bash
pnpm -C packages/core test
pnpm typecheck
```
⚠️ 이 단계에서 **표에 없는 테스트가 빨개지면 멈추고 보고해라.** 특히 `excel-sheets.test.ts` 는 머릿말과 무관하므로 초록이어야 한다.

- [ ] **Step 6: 실증**

`buildNameMeta` 의 `&& group === undefined` 를 지워(= 직전 사이클의 좁은 기준으로 되돌려) 돌린다.

```bash
git diff packages/core/src/name-meta.ts
pnpm -C packages/core test                  # 측정 범위: core 스위트 전체
```
기대: 「조합 결과가 부분과 같아도 그룹에 속하면 싣는다」와 「템플릿이 없어도 그룹이 있으면 …」 계열이 빨개진다. 수치와 측정 범위를 기록하고 되돌린다.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/name-meta.ts packages/core/src/name-meta.test.ts packages/core/src/ddl.ts packages/core/src/dbml.ts packages/core/src/index.ts packages/core/src/ddl.test.ts packages/core/src/dbml.test.ts && git commit -m "feat(core): 머릿말이 그룹 배정과 속성을 싣는다

..."
```

---

## Task 3: 가져오기가 머릿말 그룹을 복원한다 (D7 병합 + 별칭)

**Files:**
- Modify: `packages/core/src/ddl-import.ts:38-40` (`DdlImportGroup` 에 `alias`), `:405-418` (그룹 수집)
- Modify: `apps/web/src/editor/ddl-import-edits.ts:50`
- Test: `packages/core/src/ddl-import.test.ts`, `apps/web/src/editor/ddl-import-edits.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `NameMeta.groups` · Task 2 의 `buildNameMeta`
- Produces: `DdlImportGroup = { name: string; color: string | null; comment: string | null; alias: string; tablePhysicalNames: string[]; existingId: string | null }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/ddl-import.test.ts` 에 새 describe 를 더한다.

```ts
describe('planDdlImport — 머릿말 그룹 복원', () => {
  /** 별칭·색·코멘트가 다 있는 그룹 하나에 테이블 둘이 든 모델. */
  const source = (): ProjectModel => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR', comment: '회원 도메인' }
    return m
  }

  it('DDL 왕복에서 그룹과 별칭이 살아난다', () => {
    const sql = generateDdlRaw(source(), 'postgresql', { kind: 'all' },
      { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    const p = planDdlImport(createEmptyModel(), parseDdl(sql), 'postgresql', DEFAULT_NAMING_RULES)

    expect(p.groups).toHaveLength(1)
    const g = p.groups[0]!
    expect(g.name).toBe('회원관리')
    expect(g.alias).toBe('MBR')
    expect(g.comment).toBe('회원 도메인')
    expect(g.color).toBe('#4A90D9')
    expect(new Set(g.tablePhysicalNames)).toEqual(new Set(['MBR', 'MBR_GRD']))
  })

  // ⚠️ D7 — 블록과 머릿말이 같은 그룹을 말하면 머릿말이 이긴다(별칭은 머릿말에만 있다).
  it('DBML 에서 블록과 머릿말이 겹치면 머릿말이 이긴다', () => {
    const dbml = [
      '// erdd:v2 {"t":{"MBR":{"p":"MBR","l":"회원","g":"회원관리"}},"g":{"회원관리":{"a":"MBR","c":"#4A90D9"}}}',
      'Table "MBR" {',
      '  "ID" bigint [pk]',
      '}',
      'TableGroup "회원관리" [color: #999999] {',
      '  MBR',
      '}',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]!.alias).toBe('MBR')
    expect(p.groups[0]!.color).toBe('#4A90D9')       // 블록의 #999999 가 아니다
  })

  // ⚠️ 남이 준 DBML 은 머릿말이 없다 — 블록만으로 지금처럼 동작한다.
  it('머릿말 없는 DBML 은 블록만으로 그룹을 만들고 별칭은 빈 문자열이다', () => {
    const dbml = [
      'Table "MBR" {',
      '  "ID" bigint [pk]',
      '}',
      'TableGroup "회원관리" [color: #999999] {',
      '  MBR',
      '}',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]!.color).toBe('#999999')
    expect(p.groups[0]!.alias).toBe('')
  })
})
```

`apps/web/src/editor/ddl-import-edits.test.ts` 에 1건:

```ts
  it('새로 만드는 그룹에 계획의 별칭을 꽂는다', () => {
    const plan: DdlImportPlan = {
      tables: [], relationships: [], skippedTables: [], warnings: [], opCountEstimate: 1,
      groups: [{
        name: '회원관리', color: '#4A90D9', comment: null, alias: 'MBR',
        tablePhysicalNames: [], existingId: null,
      }],
    }
    let n = 0
    const out = applyDdlImport(createEmptyModel(), plan, () => `id${++n}`)
    expect(Object.values(out.tableGroups)[0]!.alias).toBe('MBR')
  })
```

- [ ] **Step 2: 빨간지 확인한다**

```bash
pnpm -C packages/core test src/ddl-import.test.ts
pnpm -C apps/web test src/editor/ddl-import-edits.test.ts
```
기대: `alias` 필드 부재로 타입 실패 + 그룹이 안 만들어져 `p.groups` 가 비어 실패.

- [ ] **Step 3: `DdlImportGroup` 에 `alias` 를 더한다**

```ts
export type DdlImportGroup = {
  name: string; color: string | null; comment: string | null
  /** 그룹 별칭. 머릿말에만 실려 온다 — DBML 블록에는 자리가 없어 빈 문자열이다. */
  alias: string
  tablePhysicalNames: string[]; existingId: string | null
}
```

- [ ] **Step 4: 그룹 수집을 두 소스로 넓힌다**

`ddl-import.ts` 8번 절을 교체한다.

```ts
  // 8) 그룹. 소스가 둘이다 — 머릿말(모든 형식)과 DBML 의 TableGroup 블록.
  // ⚠️ 같은 이름이면 **머릿말이 이긴다**(설계 D7). 별칭은 머릿말에만 있고, 머릿말은 우리가 쓴 것이
  // 확실한 반면 블록은 사람이 손댔을 수 있다. 블록에만 있는 그룹은 그대로 살린다 — 남이 준 DBML 은
  // 머릿말이 없어 지금까지의 동작 그대로다.
  const groups: DdlImportGroup[] = []
  const groupIdByName = new Map(
    Object.values(model.tableGroups).map((g) => [upper(g.name), g.id]),
  )

  const headerMembers = new Map<string, { name: string; members: string[] }>()
  for (const [rawUpper, t] of tableByUpper) {
    const gn = metaOf(rawUpper)?.g
    if (gn === undefined || gn.trim() === '') continue
    const k = upper(gn)
    const e = headerMembers.get(k) ?? { name: gn, members: [] }
    e.members.push(t.physicalName)
    headerMembers.set(k, e)
  }
  for (const [k, e] of headerMembers) {
    const attrs = parsed.nameMeta?.groups[k]
    groups.push({
      name: attrs?.name ?? e.name,
      color: attrs?.c ?? null,
      comment: attrs?.n ?? null,
      alias: attrs?.a ?? '',
      tablePhysicalNames: e.members,
      existingId: groupIdByName.get(k) ?? null,
    })
  }

  for (const g of parsed.groups ?? []) {
    if (headerMembers.has(upper(g.name))) continue          // D7 — 머릿말이 이겼다
    const members = g.tables.filter((n) => tableByUpper.has(upper(n)))
      .map((n) => tableByUpper.get(upper(n))!.physicalName)
    if (members.length === 0) continue
    groups.push({
      name: g.name, color: g.color, comment: g.comment ?? null, alias: '',
      tablePhysicalNames: members,
      existingId: groupIdByName.get(upper(g.name)) ?? null,
    })
  }
```

⚠️ **`tableByUpper` 는 살아남은 테이블만 담는다** — 건너뛴 테이블이 그룹 멤버로 새지 않는다(기존 절의 `filter` 와 같은 보장을 구조로 얻는다).

- [ ] **Step 5: 웹 배선 한 줄**

`apps/web/src/editor/ddl-import-edits.ts:50`:

```ts
      tableGroups[groupId] = { id: groupId, name: g.name, color, comment: g.comment, alias: g.alias }
```

같은 파일 상단 주석(`:28-29`)에 한 줄 더한다: 기존 그룹을 쓰는 경로는 **별칭도** 안 덮어쓴다는 것.

- [ ] **Step 6: 초록인지 확인한다**

```bash
pnpm -C packages/core test
pnpm -C apps/web test
pnpm typecheck
```
⚠️ **`opCountEstimate` 를 단언하는 기존 테스트가 빨개질 수 있다** — DDL 왕복 케이스에 이제 새 그룹이 하나 생기기 때문이다. 빨개지면 값이 왜 올랐는지 주석에 적고 갱신해라. 그 밖에 표에 없는 것이 빨개지면 멈추고 보고해라.

- [ ] **Step 7: 실증**

`headerMembers` 를 채우는 루프의 `continue` 조건을 `if (true) continue` 로 바꿔 머릿말 그룹을 무시하게 한 뒤 돌린다.

```bash
git diff packages/core/src/ddl-import.ts
pnpm -C packages/core test src/ddl-import.test.ts    # 측정 범위: 파일 하나
```
기대: 「DDL 왕복에서 그룹과 별칭이 살아난다」·「블록과 머릿말이 겹치면 머릿말이 이긴다」가 빨개지고 **「머릿말 없는 DBML …」은 초록으로 남는다**(그쪽은 블록 경로다). 되돌린다.

- [ ] **Step 8: 커밋** (core 와 web 을 한 커밋으로 — 웹 한 줄은 core 없이 의미가 없다)

---

## Task 4: 충돌 판정이 그룹을 본다 (D6)

**Files:**
- Modify: `packages/core/src/ddl-import.ts:83-125`
- Test: `packages/core/src/ddl-import.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `NameMetaEntry.g`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
  // ⚠️ 설계 D6 — 원본에서 그룹이 갈라 정상 공존하던 두 ORD 는 둘 다 들어와야 한다.
  // 픽스처의 구분력은 **머릿말의 g** 에 있다. g 를 빼면 이 테스트는 옛 동작(뒤엣것 건너뜀)으로
  // 돌아가므로, 아래 v1 짝(기존 테스트)과 함께 봐야 의미가 성립한다.
  it('v2 머릿말이면 다른 그룹의 같은 부분 이름이 둘 다 들어온다', () => {
    const ddl = [
      '-- erdd:v2 {"t":{"TB_MBR_ORD":{"p":"ORD","l":"회원주문","g":"회원"},"TB_PRD_ORD":{"p":"ORD","l":"상품주문","g":"상품"}},"g":{"회원":{"a":"MBR"},"상품":{"a":"PRD"}}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
      'CREATE TABLE TB_PRD_ORD (ID BIGINT NOT NULL, QTY BIGINT, PRIMARY KEY (ID));',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)

    expect(p.tables.map((t) => t.physicalName)).toEqual(['ORD', 'ORD'])
    expect(p.tables.map((t) => t.logicalName)).toEqual(['회원주문', '상품주문'])
    expect(p.skippedTables).toEqual([])
    expect(p.warnings.filter((w) => w.kind === 'table-conflict')).toEqual([])
    expect(p.groups.map((g) => g.name).sort()).toEqual(['상품', '회원'])
  })

  it('같은 그룹의 같은 부분 이름은 여전히 뒤엣것을 건너뛴다', () => {
    const ddl = [
      '-- erdd:v2 {"t":{"TB_MBR_ORD":{"p":"ORD","l":"주문A","g":"회원"},"TB_MBR_ORD2":{"p":"ORD","l":"주문B","g":"회원"}},"g":{"회원":{"a":"MBR"}}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
      'CREATE TABLE TB_MBR_ORD2 (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.tables.map((t) => t.physicalName)).toEqual(['ORD'])
    expect(p.skippedTables).toEqual(['TB_MBR_ORD2'])
  })

  // ⚠️ 모델 쪽 비교도 같은 키다 — 한쪽만 넓히면 「DDL 안에서는 공존하는데 모델과는 부딪힌다」가 된다.
  it('모델의 기존 테이블과도 그룹까지 같아야 부딪힌다', () => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원', color: '#111', comment: null, alias: 'MBR' }
    m.tables['t1'] = {
      id: 't1', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const ddl = [
      '-- erdd:v2 {"t":{"TB_PRD_ORD":{"p":"ORD","l":"상품주문","g":"상품"}},"g":{"상품":{"a":"PRD"}}}',
      'CREATE TABLE TB_PRD_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
    ].join('\n')
    const p = planDdlImport(m, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.tables.map((t) => t.physicalName)).toEqual(['ORD'])   // 그룹이 달라 안 부딪힌다
    expect(p.skippedTables).toEqual([])
  })
```

- [ ] **Step 2: 빨간지 확인한다**

```bash
pnpm -C packages/core test src/ddl-import.test.ts
```
기대: 위 3건이 실패(지금은 부분 이름만 보므로 전부 건너뛴다).

- [ ] **Step 3: 키를 넓힌다**

```ts
  /**
   * 이름 충돌은 **(그룹, 만들어질 부분 이름)** 으로 본다(설계 D6).
   * ⚠️ 구분자가 NUL 인 이유: 그룹 이름은 사용자가 자유롭게 쓰는 문자열이라 `.` `_` 같은 흔한
   * 문자를 쓰면 서로 다른 짝이 같은 키가 된다(`A_B`+`C` 와 `A`+`B_C`). NUL 은 어느 이름에도
   * 들어갈 수 없다.
   * ⚠️ 그룹은 **머릿말에서만** 온다. 머릿말이 없으면 그룹 자리가 빈 문자열이라 옛 동작 그대로다 —
   * 그리고 그것이 맞다(옛 덤프에는 그룹이 안 적혀 있다).
   */
  const scopedKey = (group: string, name: string) => `${upper(group)}\u0000${upper(name)}`
  const groupNameById = new Map(Object.values(model.tableGroups).map((g) => [g.id, g.name]))
  const groupOf = (raw: string): string => metaOf(raw)?.g ?? ''

  const existing = new Set(Object.values(model.tables).map((t) => scopedKey(
    t.groupId === null ? '' : groupNameById.get(t.groupId) ?? '', t.physicalName)))
```

루프 안의 `madeKey` 를 바꾼다.

```ts
    const made = madeName(t.name)
    const madeKey = scopedKey(groupOf(t.name), made)
```

`claimed` 는 그대로 `Set<string>` 이고 담기는 값만 새 키다.

- [ ] **Step 4: 초록인지 확인한다**

```bash
pnpm -C packages/core test
pnpm -C apps/web test
pnpm typecheck
```
⚠️ **`ddl-import.test.ts:696` 「다른 그룹의 두 테이블이 같은 부분으로 복원되면 뒤엣것이 빠진다」가 그대로 초록이어야 한다.** 그 픽스처는 **v1** 이라 그룹 정보가 없다. 빨개지면 v1 하위호환이 깨진 것이므로 멈추고 보고해라.

- [ ] **Step 5: 실증**

`scopedKey` 를 `(_group, name) => upper(name)` 로 바꿔(그룹을 무시하게) 돌린다.

```bash
git diff packages/core/src/ddl-import.ts
pnpm -C packages/core test                  # 측정 범위: core 스위트 전체
```
기대: Step 1 의 3건 중 「둘 다 들어온다」·「모델의 기존 테이블과도 …」가 빨개지고, **v1 케이스와 「같은 그룹의 …」는 초록으로 남는다.** 수치와 측정 범위를 기록하고 되돌린다.

- [ ] **Step 6: 커밋**

---

## Task 5: 별칭이 다른 기존 그룹에 경고를 낸다 (D3)

**Files:**
- Modify: `packages/core/src/ddl-import.ts:8-14` (`kind` 추가), 8번 절
- Test: `packages/core/src/ddl-import.test.ts`
- 확인: `docs/superpowers/HANDOFF.md` 3.14 「새 `Warning['kind']` 를 추가할 때」 체크리스트

- [ ] **Step 1: 3.14 체크리스트를 읽는다**

```bash
sed -n '/^### 3.14/,/^### 3.15/p' docs/superpowers/HANDOFF.md
```
⚠️ **거기 적힌 등록처를 전부 확인하고, 해당하지 않으면 왜 아닌지 보고에 적어라.** `DdlImportWarning` 은 core 의 `Warning` 과 **다른 타입**이므로 일부 항목은 해당하지 않을 수 있다 — 넘겨짚지 말고 실제로 읽어서 판단해라.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

```ts
  /** 이름이 같은 그룹이 이미 있는 모델. 별칭만 다르게/색만 다르게 두 갈래로 쓴다. */
  const withGroup = (alias: string, color: string, comment: string | null): ProjectModel => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원', color, comment, alias }
    return m
  }
  const incoming = [
    '-- erdd:v2 {"t":{"TB_MBR_ORD":{"p":"ORD","l":"주문","g":"회원"}},"g":{"회원":{"a":"MBR","c":"#4A90D9","n":"회원 도메인"}}}',
    'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
  ].join('\n')

  it('별칭이 다르면 기존 값을 유지하고 경고한다', () => {
    const p = planDdlImport(withGroup('MB', '#4A90D9', '회원 도메인'), parseDdl(incoming),
      'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups[0]!.existingId).toBe('g1')
    expect(p.warnings).toContainEqual({
      kind: 'group-conflict', target: '회원',
      message: '머릿말의 별칭 MBR 과 기존 그룹의 별칭 MB 가 달라 기존 값을 유지합니다',
    })
  })

  // ⚠️ D3 의 반대편 — 색·코멘트는 갈려도 이름을 안 바꾸므로 조용히 유지한다.
  it('색·코멘트만 다르면 경고가 없다', () => {
    const p = planDdlImport(withGroup('MBR', '#999999', '다른 설명'), parseDdl(incoming),
      'postgresql', DEFAULT_NAMING_RULES)
    expect(p.warnings.filter((w) => w.kind === 'group-conflict')).toEqual([])
  })

  // ⚠️ 머릿말에 별칭이 없으면 「다르다」고 말할 근거가 없다 — 경고하지 않는다.
  it('머릿말에 별칭이 없으면 경고하지 않는다', () => {
    const noAlias = [
      '-- erdd:v2 {"t":{"TB_MBR_ORD":{"p":"ORD","l":"주문","g":"회원"}},"g":{"회원":{"c":"#4A90D9"}}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
    ].join('\n')
    const p = planDdlImport(withGroup('MB', '#4A90D9', null), parseDdl(noAlias),
      'postgresql', DEFAULT_NAMING_RULES)
    expect(p.warnings.filter((w) => w.kind === 'group-conflict')).toEqual([])
  })
```

- [ ] **Step 3: 빨간지 확인한다**

```bash
pnpm -C packages/core test src/ddl-import.test.ts
```
기대: `'group-conflict'` 가 `kind` 유니온에 없어 타입 실패 + 경고가 안 나 실패.

- [ ] **Step 4: 경고를 낸다**

```ts
export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word'
      | 'table-conflict' | 'unresolved-fk' | 'unresolved-index' | 'skipped-statement'
      | 'unknown-custom-field' | 'group-conflict'
  target: string
  message: string
}
```

머릿말 그룹을 `groups` 에 담는 루프 안에서:

```ts
    const existingId = groupIdByName.get(k) ?? null
    // ⚠️ 별칭에만 경고한다(설계 D3). 별칭은 {그룹별칭} 변수로 **물리명 조합에 들어가 최종 이름을
    // 바꾸므로** 조용히 갈리면 사용자가 보는 이름이 원본과 달라지는데 이유를 알 길이 없다.
    // 색·코멘트는 표시용이라 갈려도 이름이 안 바뀐다 — 전부 경고하면 시끄러워 진짜 신호가 묻힌다.
    // ⚠️ 머릿말에 별칭이 **있을 때만** 본다. 없으면 「다르다」고 말할 근거가 없다.
    const existingGroup = existingId === null ? undefined : model.tableGroups[existingId]
    const a = attrs?.a
    if (existingGroup !== undefined && a !== undefined && a !== existingGroup.alias) {
      warnings.push({
        kind: 'group-conflict', target: existingGroup.name,
        message: `머릿말의 별칭 ${a} 과 기존 그룹의 별칭 ${existingGroup.alias} 가 달라 기존 값을 유지합니다`,
      })
    }
```

- [ ] **Step 5: 초록인지 확인한다**

```bash
pnpm -C packages/core test && pnpm -C apps/web test && pnpm typecheck
```

- [ ] **Step 6: 실증**

경고 `push` 를 지우고 돌린다. 「별칭이 다르면 …」 한 건만 빨개지고 나머지 둘은 초록이어야 한다(그 둘은 **경고가 없음**을 단언하므로). 이어서 조건에서 `a !== undefined` 를 빼고 돌려 「머릿말에 별칭이 없으면 …」이 빨개지는지 본다. 각각 측정 범위와 함께 기록하고 되돌린다.

- [ ] **Step 7: 커밋**

---

## Task 6: 문서

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `docs/manual/user-guide.md`

- [ ] **Step 1: 매뉴얼의 머릿말 안내를 찾는다**

```bash
grep -n "erdd:v1\|머릿말" docs/manual/user-guide.md
```

- [ ] **Step 2: 매뉴얼을 고친다**

- `erdd:v1` → `erdd:v2` 로, 형식 설명에 **그룹·별칭이 함께 실린다**를 더한다.
- ⚠️ **새로 적을 것:** 그룹을 쓰면 템플릿이 없어도 DDL 첫 줄에 주석이 생긴다. 이미 내보낸 DDL 과 새로 내보낸 DDL 이 갈린다.
- 직전 사이클이 적어 둔 「머릿말 없는 조각 붙여넣기」 예외 문단은 **그대로 유효하다** — 그룹도 같이 못 살린다는 한 줄만 더한다.

- [ ] **Step 3: HANDOFF 를 고친다**

- **1절 완료 표**: 이번 사이클 한 줄.
- **테스트 기준선**: 실측값으로 갱신(작업 시작 기준선은 core 805 · web 938).
- **3.17 절**(`erdd:v1` 머릿말): v2 로 갱신. **v1 을 계속 읽는다**는 것과 **그 하위호환의 잠금이 `ddl-import.test.ts` 의 v1 케이스 3건**이라는 것을 적는다.
- **3.14 체크리스트**: `group-conflict` 를 추가하며 확인한 등록처를 반영(Task 5 Step 1 의 판단을 그대로 옮긴다).
- **6절 이월**: 「템플릿·그룹 별칭 복원」을 **절반 해소**로 갱신 — 그룹·별칭은 됐고 **템플릿은 남는다**. 새 이월로 「그룹 좌표(`groupPosition`) 는 복원하지 않는다」를 더한다.
- ⚠️ **직전 사이클이 6절에 적어 둔 「다른 그룹의 두 테이블이 같은 부분으로 되돌려져 뒤엣것이 빠진다」 설명을 갱신한다** — v2 머릿말에서는 더 이상 그렇지 않고, v1 덤프에서만 그렇다.

- [ ] **Step 4: 커밋**

---

## 자체 검토 결과 (계획 작성자가 확인한 것)

**1. 사양 커버리지**

| 사양 | Task |
|---|---|
| D1 그룹·별칭만, 템플릿 제외 | 2·3 (템플릿을 싣는 코드가 아예 없다) |
| D2 색·코멘트도 싣는다 | 2 Step 3 · 3 Step 1 |
| D3 별칭만 경고 | 5 |
| D4 그룹이 있으면 머릿말을 낸다 | 2 |
| D5 `erdd:v2` 두 구획 · v1 계속 읽기 | 1 |
| D6 충돌 키 확장 | 4 |
| D7 DBML 은 머릿말이 이긴다 | 3 |
| 3.1 메타 모듈 | 1 |
| 3.2 빌더 통합 | 2 |
| 3.3 가져오기 배선 (a)(b)(c)(d) | 3(a·b) · 4(c) · 5(d) |
| 3.4 적용 배선 | 3 Step 5 |
| 3.5 내보내기 배선 | 2 Step 4 |
| §4 테스트 1~19 | 1(1~6) · 2(7~10) · 3(11·17·18·19) · 4(12·13·14) · 5(15·16) |
| §5 문서 | 6 |

**2. 빠진 것을 하나 찾아 넣었다** — 사양 §4 의 테스트 10(「그룹도 템플릿도 없으면 산출물이 한 글자도 안 바뀐다」)은 "기존 것이 그대로 초록인지로 확인한다"고만 적혀 있었는데, **기존 테스트의 픽스처가 그룹을 갖고 있어 그대로 두면 빨개진다.** Task 2 가 그 픽스처를 그룹 없는 것으로 바꾸고 새 짝을 더한다.

**3. 타입 일관성** — `NameMeta`(Task 1) → `buildNameMeta`(Task 2) → `DdlImportGroup.alias`(Task 3) → `scopedKey`(Task 4) → `group-conflict`(Task 5) 가 서로 맞는지 확인했다. `attrs` 는 Task 3 에서 도입해 Task 5 가 그대로 쓴다.
