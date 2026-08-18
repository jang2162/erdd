# 덤프 머릿말 메타정보 왕복 복원 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내보낸 DDL·DBML 머리에 부분 이름을 적은 주석 한 줄을 실어, 되읽을 때 접두가 물리명에 박히지 않게 한다.

**Architecture:** 메타 직렬화/파싱 모듈 하나를 DDL·DBML 이 공유하고 주석 접두만 갈린다. `ParsedDbml` 이 `ParsedDdl` 을 상속하고 `planDdlImport` 가 두 포맷 공용 플래너라, **타입 한 곳·플래너 한 곳만 배선하면 둘 다 닫힌다.**

**Tech Stack:** TypeScript · vitest

**Spec:** `docs/superpowers/specs/2026-08-18-name-meta-roundtrip-design.md`

## Global Constraints

- **server·web·CLI 는 손대지 않는다.** 이 사이클은 `packages/core` 안에서 끝난다.
- **컬럼·템플릿·그룹 별칭 복원은 범위 밖이다**(설계 D2·6절).
- **예외를 던지지 마라.** 깨진 메타는 전부 `null` 로 떨어뜨린다(설계 D6).
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...` 을 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 771 · cli 145 · web 935 · server 209 · typecheck EXIT=0`.
- **typecheck 는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라.** 서버 테스트가 필요하면 격리 DB 를 명시한다:
  `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_e' …`
  `20 passed | 174 skipped` 로 끝나면 **미실행**이다.
- **작업 디렉터리는 워크트리다.**

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/name-meta.ts` | 머릿말 직렬화 · 파싱 | **신설** |
| `packages/core/src/name-meta.test.ts` | 위 | **신설** |
| `packages/core/src/ddl-parse.ts` | `ParsedDdl.nameMeta` + `parseDdl` 이 원문 머리를 읽는다 | 수정 |
| `packages/core/src/dbml-parse.ts` | `parseDbml` 이 원문 머리를 읽는다 | 수정 |
| `packages/core/src/ddl.ts` | 머릿말 한 줄 앞에 붙이기 | 수정 |
| `packages/core/src/dbml.ts` | 〃 (접두 `//`) | 수정 |
| `packages/core/src/ddl-import.ts` | 부분 복원 — **공용 플래너라 한 자리** | 수정 |
| `packages/core/src/index.ts` | 재export | 수정 |
| 문서 3종 | | 수정 |

### ⚠️ 착수 전에 알아야 할 사실 (조사 완료 — 다시 조사하지 마라)

1. **`ParsedDbml = ParsedDdl & { groups; customValues; databaseType }`**(`dbml-parse.ts:14`).
   `ParsedDdl` 에 필드를 더하면 **`ParsedDbml` 이 자동으로 갖는다.**
2. **`planDdlImport(model, parsed: ImportInput, dialect, rules)`** 는 DDL·DBML 공용이다
   (`ImportInput = ParsedDdl & Partial<Pick<ParsedDbml, 'groups' | 'customValues'>>`).
   **부분 복원 배선은 한 자리뿐이다.**
3. **`parseDdl(ddl: string): ParsedDdl`** 이다 — **dialect 인자가 없다**(`ddl-parse.ts:638`).
   설계 3.2 에 `parseDdl(text, dialect)` 로 적혀 있는데 그것은 오기다. 실제 시그니처를 따라라.
4. **두 파서 모두 파싱 전에 주석을 걷어낸다** — `ddl-parse.ts` 의 `splitStatements`,
   `dbml-parse.ts:504` 의 `stripComments`(`//` 와 `/* */` 를 공백으로 치환, `:85-88`).
   그래서 머릿말은 **파싱 전에 원문에서** 읽어야 한다.
5. **`exactOptionalPropertyTypes` 는 꺼져 있다**(`tsconfig.base.json` 에 `strict`·
   `noUncheckedIndexedAccess` 만). 그래서 옵셔널 필드에 `?? undefined` 를 넣어도 된다.
6. **관대한 JSON 파싱 선례가 있다** — `dbml-note.ts:55-72` 의 `tryParseCustom`. 같은 방어를 쓴다.
7. **설계 D2 고정 테스트는 `ddl-import.test.ts:538-548`** 이다. Task 4 가 그것을 둘로 가른다.

---

## Task 1: 메타 모듈

**Files:**
- Create: `packages/core/src/name-meta.ts` · `packages/core/src/name-meta.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NameMetaEntry = { p: string; l: string }
  export type NameMeta = Record<string, NameMetaEntry>
  export function serializeNameMeta(meta: NameMeta, prefix: '--' | '//'): string | null
  export function parseNameMeta(raw: string): NameMeta | null
  ```

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/name-meta.test.ts` 신설.

```ts
import { describe, expect, it } from 'vitest'
import { parseNameMeta, serializeNameMeta, type NameMeta } from './name-meta.js'

const META: NameMeta = { TB_MBR_ORD: { p: 'ORD', l: '주문' } }

describe('serializeNameMeta', () => {
  it('한 줄로 낸다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line.startsWith('-- erdd:v1 ')).toBe(true)
    expect(line).not.toContain('\n')            // ⚠️ 줄바꿈이 들어가면 주석이 아닌 줄이 생긴다
  })

  it('접두만 갈린다', () => {
    expect(serializeNameMeta(META, '//')!.startsWith('// erdd:v1 ')).toBe(true)
  })

  // ⚠️ 설계 D4 — 실을 것이 없으면 머릿말을 아예 내지 않는다.
  it('빈 메타는 null 이다', () => {
    expect(serializeNameMeta({}, '--')).toBeNull()
  })
})

describe('parseNameMeta', () => {
  it('직렬화한 것을 되읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '--')!)).toEqual(META)
  })

  it('DBML 접두도 읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '//')!)).toEqual(META)
  })

  it('조회 키는 대문자로 정규화한다', () => {
    expect(parseNameMeta('-- erdd:v1 {"tb_mbr_ord":{"p":"ORD","l":"주문"}}'))
      .toEqual({ TB_MBR_ORD: { p: 'ORD', l: '주문' } })
  })

  it('앞선 다른 주석과 빈 줄은 지나친다', () => {
    const raw = ['', '-- 사람이 쓴 주석', '', serializeNameMeta(META, '--')!, 'CREATE TABLE X ();']
      .join('\n')
    expect(parseNameMeta(raw)).toEqual(META)
  })

  // ⚠️ 이 태스크의 급소(설계 3.2) — 첫 비주석 줄이 나오면 멈춘다.
  it('첫 문장 뒤의 마커는 줍지 않는다', () => {
    const raw = ['CREATE TABLE X ();', serializeNameMeta(META, '--')!].join('\n')
    expect(parseNameMeta(raw)).toBeNull()
  })

  it('마커가 없으면 null 이다', () => {
    expect(parseNameMeta('CREATE TABLE X ();')).toBeNull()
    expect(parseNameMeta('')).toBeNull()
  })

  // ⚠️ 설계 D6 — 깨진 입력은 전부 null. 예외를 던지지 않는다.
  it('깨진 JSON 은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"')).toBeNull()
  })

  it('모르는 버전은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v2 {"TB":{"p":"ORD","l":"주문"}}')).toBeNull()
  })

  it('형태가 다른 값은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"}}')).toBeNull()          // l 없음
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":1,"l":"주문"}}')).toBeNull()   // 문자열 아님
    expect(parseNameMeta('-- erdd:v1 ["ORD"]')).toBeNull()                     // 배열
    expect(parseNameMeta('-- erdd:v1 null')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-meta.test.ts
```
기대: 모듈이 없어 전 케이스 FAIL.

- [ ] **Step 3: 구현한다**

`packages/core/src/name-meta.ts` 신설:

```ts
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
```

`index.ts` 에 재export 를 더한다:
```ts
export { serializeNameMeta, parseNameMeta } from './name-meta.js'
export type { NameMeta, NameMetaEntry } from './name-meta.js'
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-meta.test.ts
pnpm -C packages/core test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 신규 케이스 PASS, `EXIT=0`, **기존 스위트 전부 그대로**(아직 아무도 이 모듈을 안 쓴다).

- [ ] **Step 5: 「첫 비주석 줄에서 멈춘다」가 잠기는지 실증한다**

`parseNameMeta` 의 `if (!s.startsWith('--') && !s.startsWith('//')) return null` 을 `continue` 로 바꾼다
(= 파일 전체를 훑게 만든다).

⚠️ **`git diff` 로 바뀐 줄을 눈으로 확인한 뒤** 돌려라.
```bash
git diff packages/core/src/name-meta.ts
pnpm -C packages/core exec vitest run src/name-meta.test.ts -t '첫 문장 뒤의 마커'
```
기대: **FAIL** — `null` 이어야 할 자리에 `META` 가 나온다. 되돌리고 초록을 확인한 뒤
**양쪽 결과와 측정 범위를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/name-meta.ts packages/core/src/name-meta.test.ts packages/core/src/index.ts && \
git commit -m "feat(core): 덤프 머릿말 메타 직렬화·파싱 모듈을 더한다

조합된 물리명 → 부분 매핑을 주석 한 줄로 싣고 되읽는다. 파싱은 파일 머리에서만
훑고 첫 비주석 줄에서 멈춘다 — 중간에 섞인 마커를 줍지 않는다. 깨진 입력은 전부
null 로 떨어뜨리고 예외를 던지지 않는다. 실을 것이 없으면 머릿말 자체를 안 낸다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 2: 파서가 머릿말을 읽는다

**Files:**
- Modify: `packages/core/src/ddl-parse.ts:23-29`(`ParsedDdl`) · `:638-639`(`parseDdl`)
- Modify: `packages/core/src/dbml-parse.ts:503-507`(`parseDbml`)
- Test: `packages/core/src/ddl-parse.test.ts` · `packages/core/src/dbml-parse.test.ts`

**Interfaces:**
- Consumes: `parseNameMeta(raw)` (Task 1)
- Produces: `ParsedDdl.nameMeta?: NameMeta` — **`ParsedDbml` 이 상속해서 자동으로 갖는다**

- [ ] **Step 1: 실패 테스트를 쓴다**

`ddl-parse.test.ts` 에 추가한다(그 파일의 기존 import·헬퍼를 먼저 읽어라).

```ts
describe('머릿말 메타', () => {
  it('머릿말이 있으면 nameMeta 를 싣는다', () => {
    const ddl = [
      '-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL);',
    ].join('\n')
    const parsed = parseDdl(ddl)
    expect(parsed.nameMeta).toEqual({ TB_MBR_ORD: { p: 'ORD', l: '주문' } })
    expect(parsed.tables).toHaveLength(1)          // ⚠️ 머릿말이 파싱을 방해하지 않는다
  })

  it('머릿말이 없으면 nameMeta 가 undefined 다', () => {
    expect(parseDdl('CREATE TABLE X (ID BIGINT NOT NULL);').nameMeta).toBeUndefined()
  })
})
```

`dbml-parse.test.ts` 에 추가한다.

```ts
describe('머릿말 메타', () => {
  it('머릿말이 있으면 nameMeta 를 싣는다', () => {
    const src = [
      '// erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}',
      'Table "TB_MBR_ORD" {',
      '  "ID" bigint [pk]',
      '}',
    ].join('\n')
    const parsed = parseDbml(src)
    expect(parsed.nameMeta).toEqual({ TB_MBR_ORD: { p: 'ORD', l: '주문' } })
    expect(parsed.tables).toHaveLength(1)          // ⚠️ stripComments 가 머릿말을 지워도 테이블은 읽힌다
  })

  it('머릿말이 없으면 nameMeta 가 undefined 다', () => {
    expect(parseDbml('Table "X" {\n  "ID" bigint [pk]\n}').nameMeta).toBeUndefined()
  })
})
```
⚠️ 두 테스트의 **DBML/DDL 본문 문법은 그 파일의 기존 케이스를 보고 맞춰라**(컬럼 타입 표기·따옴표 관례).

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl-parse.test.ts src/dbml-parse.test.ts
```
기대: `nameMeta` 가 없어 TS 오류 또는 `undefined` 로 FAIL.

- [ ] **Step 3: 구현한다**

`ddl-parse.ts` 의 `ParsedDdl` 에 옵셔널 필드를 더한다:

```ts
export type ParsedDdl = {
  tables: ParsedTable[]
  constraints: ParsedConstraint[]
  indexes: ParsedIndex[]
  comments: ParsedComment[]
  skipped: SkippedStatement[]
  /**
   * 덤프 머릿말이 실어 온 「조합된 이름 → 부분」. 없으면 undefined.
   * ⚠️ 옵셔널이라 기존 테스트의 ParsedDdl 리터럴이 안 깨진다.
   */
  nameMeta?: NameMeta
}
```

`parseDdl` 의 첫 줄에서 원문을 읽는다(**`splitStatements` 가 주석을 걷어내기 전이어야 한다**):

```ts
export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = {
    tables: [], constraints: [], indexes: [], comments: [], skipped: [],
    nameMeta: parseNameMeta(ddl) ?? undefined,
  }
```

`dbml-parse.ts` 의 `parseDbml` 도 같은 형태로 — `stripComments(text)` **전에** 원문을 읽는다:

```ts
export function parseDbml(text: string): ParsedDbml {
  const nameMeta = parseNameMeta(text) ?? undefined
  const s = stripComments(text)
  const out: Out = {
    tables: [], constraints: [], indexes: [], comments: [], skipped: [],
    groups: [], customValues: [], databaseType: null, headerColors: new Map(),
    nameMeta,
    …
```
⚠️ `Out` 타입이 `ParsedDbml` 을 확장하는 로컬 타입이면 필드가 자동으로 붙는다. 반환 시 `nameMeta` 가
빠지지 않는지 확인해라(반환부가 필드를 하나씩 나열하면 거기에도 더한다).

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl-parse.test.ts src/dbml-parse.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: `EXIT=0`, **기존 스위트 전부 그대로**(아직 아무도 `nameMeta` 를 읽지 않는다).

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/ddl-parse.ts packages/core/src/ddl-parse.test.ts \
        packages/core/src/dbml-parse.ts packages/core/src/dbml-parse.test.ts && \
git commit -m "feat(core): 두 파서가 원문 머리에서 메타를 읽는다

두 파서 모두 파싱 전에 주석을 걷어내므로 머릿말은 그 전에 원문에서 읽어야 한다.
ParsedDbml 이 ParsedDdl 을 상속하므로 필드는 한 곳만 더하면 된다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: 내보내기가 머릿말을 붙인다

**Files:**
- Modify: `packages/core/src/ddl.ts:244-249`(`generateDdl` 조립부) · `packages/core/src/dbml.ts:196-211`(`generateDbml`)
- Test: `packages/core/src/ddl.test.ts` · `packages/core/src/dbml.test.ts`

**Interfaces:**
- Consumes: `serializeNameMeta(meta, prefix)` (Task 1) · `composeTablePhysicalName`·`composeTableLogicalName`

⚠️ **설계 D4 를 「다른 항목만 싣는다」로 구현한다.** 각 테이블에 대해 조합 물리명이 부분과 같고 조합
논리명도 부분과 같으면 **그 항목을 넣지 않는다.** 템플릿이 하나도 안 걸리면 자연히 빈 맵이 되어
`serializeNameMeta` 가 `null` 을 돌려주고 **머릿말이 아예 안 나간다.** 「템플릿이 비었는가」를 따로
검사하지 마라 — 이쪽이 더 정확하다(템플릿이 `{물리명}` 이라 결과가 같은 테이블도 걸러진다).

- [ ] **Step 1: 실패 테스트를 쓴다**

`ddl.test.ts` 에 추가한다. 그 파일에는 `generateDdlRaw` 심이 이미 있다 — **새 심을 만들지 마라.**

```ts
describe('머릿말 메타', () => {
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })

  it('템플릿이 걸리면 첫 줄에 머릿말이 나온다', () => {
    const sql = generateDdlRaw(m(), 'postgresql', { kind: 'all' }, tpl('TB_{그룹별칭}_{물리명}'))
    const first = sql.split('\n')[0]!
    expect(first.startsWith('-- erdd:v1 ')).toBe(true)
    const meta = parseNameMeta(sql)!
    expect(meta['TB_MBR_MBR']).toEqual({ p: 'MBR', l: '회원' })
  })

  // ⚠️ 설계 D4 — 이것이 기존 산출물 무변경을 보장한다.
  it('템플릿이 없으면 머릿말이 없다', () => {
    const sql = generateDdlRaw(m(), 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES)
    expect(sql.startsWith('--')).toBe(false)
    expect(parseNameMeta(sql)).toBeNull()
  })

  // ⚠️ 조합해도 결과가 같은 테이블은 실을 것이 없다.
  it('조합 결과가 부분과 같으면 머릿말이 없다', () => {
    const sql = generateDdlRaw(m(), 'postgresql', { kind: 'all' }, tpl('{물리명}'))
    expect(parseNameMeta(sql)).toBeNull()
  })

  it('내보내기에서 제외된 테이블은 메타에 없다', () => {
    const x = m()
    x.tables['t9'] = { ...x.tables['t2']!, id: 't9', physicalName: 'NOCOL' }   // 컬럼이 없다
    const sql = generateDdlRaw(x, 'postgresql', { kind: 'all' }, tpl('TB_{그룹별칭}_{물리명}'))
    expect(Object.keys(parseNameMeta(sql)!)).not.toContain('TB_MBR_NOCOL')
  })
})
```

`dbml.test.ts` 에 추가한다(`generateDbmlRaw` 심이 이미 있다).

```ts
describe('머릿말 메타', () => {
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })

  it('템플릿이 걸리면 첫 줄에 // 머릿말이 나온다', () => {
    const out = generateDbmlRaw(
      m(), 'postgresql', { kind: 'all' }, {}, tpl('TB_{그룹별칭}_{물리명}'))
    expect(out.split('\n')[0]!.startsWith('// erdd:v1 ')).toBe(true)
  })

  // ⚠️ 머릿말은 Project 블록보다 **앞**이어야 파싱이 줍는다(설계 3.4).
  it('머릿말이 Project 블록보다 앞에 온다', () => {
    const out = generateDbmlRaw(
      m(), 'postgresql', { kind: 'all' }, { projectName: '회원 시스템' },
      tpl('TB_{그룹별칭}_{물리명}'))
    expect(out.indexOf('// erdd:v1')).toBeLessThan(out.indexOf('Project '))
    expect(parseNameMeta(out)).not.toBeNull()
  })

  it('템플릿이 없으면 머릿말이 없다', () => {
    expect(parseNameMeta(generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES)))
      .toBeNull()
  })
})
```

⚠️ 두 테스트 파일에 **`parseNameMeta` import 를 더해야 한다**(`./name-meta.js`). 단언을 문자열
비교가 아니라 파싱으로 하는 이유는 JSON 키 순서에 기대지 않기 위해서다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl.test.ts src/dbml.test.ts -t '머릿말 메타'
```
기대: 머릿말이 없어 FAIL.

- [ ] **Step 3: 구현한다**

두 파일에 같은 형태의 헬퍼를 각자 둔다(내보내는 테이블 목록이 서로 다르므로 공유하지 않는다):

```ts
/**
 * 내보내는 테이블 중 **조합 결과가 부분과 다른 것만** 메타에 싣는다(설계 D4).
 * 템플릿이 하나도 안 걸리면 빈 맵이 되어 머릿말이 아예 안 나간다 — 기존 산출물이 한 글자도
 * 안 바뀌게 하는 안전장치다.
 */
function buildNameMeta(model: ProjectModel, tables: Table[], rules: NamingRules): NameMeta {
  const meta: NameMeta = {}
  for (const t of tables) {
    const p = composeTablePhysicalName(t, model, rules)
    const l = composeTableLogicalName(t, model, rules)
    if (p === t.physicalName && l === t.logicalName) continue
    meta[p] = { p: t.physicalName, l: t.logicalName }
  }
  return meta
}
```

`generateDdl` 의 반환부(`ddl.ts:249`):
```ts
  const header = serializeNameMeta(buildNameMeta(model, tables, rules), '--')
  const body = [createBlocks.join('\n\n'), fk, index, comment]
    .filter((s) => s.trim() !== '').join('\n\n')
  return header === null ? body : `${header}\n${body}`
```

`generateDbml` 의 반환부(`dbml.ts:211`):
```ts
  const header = serializeNameMeta(buildNameMeta(model, tables, rules), '//')
  const body = blocks.join('\n\n')
  return header === null ? body : `${header}\n${body}`
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
⚠️ **기존 테스트가 하나도 깨지면 안 된다.** `ddl.test.ts:27` 은 `generateDdl(...)` 결과를 **문자열
전체로 `toBe`** 비교한다 — 템플릿이 없는 그 케이스에 머릿말이 붙으면 즉시 깨진다. 깨졌다면 D4 구현이
틀린 것이다.

- [ ] **Step 5: D4 가 진짜 잠기는지 실증한다**

`buildNameMeta` 의 `if (p === t.physicalName && l === t.logicalName) continue` 한 줄을 지운다
(= 템플릿이 없어도 전 테이블을 싣게 만든다).

```bash
git diff packages/core/src/ddl.ts                  # 그 줄이 사라진 것을 눈으로 본다
pnpm -C packages/core exec vitest run src/ddl.test.ts
```
기대: **FAIL** — 「템플릿이 없으면 머릿말이 없다」와 함께 **`ddl.test.ts:27` 의 전체 문자열 비교**가
깨진다. 되돌리고 초록을 확인한 뒤 **양쪽 결과와 측정 범위를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts \
        packages/core/src/dbml.ts packages/core/src/dbml.test.ts && \
git commit -m "feat(core): 내보내기가 부분 이름을 머릿말로 싣는다

조합 결과가 부분과 다른 테이블만 싣는다 — 템플릿이 하나도 안 걸리면 빈 맵이 되어
머릿말이 아예 안 나가고 기존 산출물이 한 글자도 안 바뀐다. DBML 은 머릿말을 Project
블록보다 앞에 둬야 파싱이 줍는다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: 가져오기가 부분을 복원한다 — 이 사이클의 급소

**Files:**
- Modify: `packages/core/src/ddl-import.ts:200-210` 부근(`tables.push({ physicalName: t.name, … })`)
- Test: `packages/core/src/ddl-import.test.ts:538-548`(**D2 고정 테스트를 둘로 가른다**)

**Interfaces:**
- Consumes: `ParsedDdl.nameMeta` (Task 2) · 머릿말이 붙은 산출물 (Task 3)

⚠️ **`planDdlImport` 는 DDL·DBML 공용 플래너다. 여기 한 번 배선하면 두 포맷이 함께 닫힌다.**

- [ ] **Step 1: D2 고정 테스트를 둘로 가르고 새 케이스를 쓴다**

`ddl-import.test.ts:538-548` 의 기존 케이스를 **아래 두 개로 교체한다.** 기존 주석(「설계 D2 를
고정하는 테스트다」)도 새 사실에 맞게 바꾼다.

```ts
  // ⚠️ 물리명 사이클의 D2(왕복이 깨진 채로 둔다)를 **뒤집은 자리**다. 역분해는 여전히 하지 않는다 —
  // 내보낼 때 머릿말에 부분을 적어 두고 읽을 때 그대로 쓴다.
  it('머릿말이 있으면 부분이 복원된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
  })

  // ⚠️ 남의 DDL(머릿말 없음)은 지금까지의 동작 그대로다 — 통째로 부분이 된다.
  it('머릿말이 없으면 조합된 이름이 통째로 부분이 된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
      .split('\n').filter((l) => !l.startsWith('-- erdd:')).join('\n')   // 머릿말만 떼어낸다
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort())
      .toEqual(['TB_MBR_MBR', 'TB_MBR_MBR_GRD'])
  })

  it('두 번 왕복해도 접두가 겹치지 않는다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const once = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const back = planDdlImport(createEmptyModel(), parseDdl(once), 'postgresql', DEFAULT_NAMING_RULES)
    expect(back.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
    expect(once).not.toContain('TB_MBR_TB_MBR_')
  })

  // ⚠️ 설계 D5 — 논리명은 메타가 코멘트를 이기고, 설명은 코멘트에서 온다.
  it('논리명은 메타가 이기고 설명은 코멘트에서 온다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    const rules = {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{물리명}',
      tableLogicalTemplate: '{그룹명}_{논리명}',
    }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    const mbr = imported.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.logicalName).toBe('회원')                 // 'SALES_회원' 이 아니다
    expect(mbr.comment).toBe('서비스 가입 회원')          // 설명은 코멘트에서 그대로
  })

  // ⚠️ 설계 D6 — 사용자가 DDL 의 이름을 손으로 고치면 키가 안 맞아 현행 동작으로 떨어진다.
  it('메타 키가 실제 이름과 안 맞으면 현행 동작으로 떨어진다', () => {
    const ddl = [
      '-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}',
      'CREATE TABLE TB_MBR_ORDER (ID BIGINT NOT NULL);',
    ].join('\n')
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables[0]!.physicalName).toBe('TB_MBR_ORDER')
  })
```

DBML 왕복도 한 짝 더한다(`ddl-import.test.ts` 나 `dbml-roundtrip.test.ts` 중 그 파일 관례에 맞는 쪽).

```ts
  it('DBML 도 머릿말로 부분이 복원된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const dbml = generateDbmlRaw(m, 'postgresql', { kind: 'all' }, {}, rules)
    const imported = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
  })
```
  // ⚠️ 설계 §4 가 요구한 나머지 한 짝 — DBML 도 머릿말이 없으면 옛 동작이다.
  it('DBML 도 머릿말이 없으면 조합된 이름이 통째로 부분이 된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const dbml = generateDbmlRaw(m, 'postgresql', { kind: 'all' }, {}, rules)
      .split('\n').filter((l) => !l.startsWith('// erdd:')).join('\n')
    const imported = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort())
      .toEqual(['TB_MBR_MBR', 'TB_MBR_MBR_GRD'])
  })
```
⚠️ `generateDdlRaw`·`generateDbmlRaw`·`parseDbml` import 가 그 파일에 없으면 더한다. `buildSampleModel`
의 t2 코멘트가 `'서비스 가입 회원'` 인 것은 확인된 사실이지만 **그 파일의 기존 케이스로 한 번 더 맞춰라.**

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl-import.test.ts
```
기대: 부분 복원·D5 케이스가 FAIL(조합 이름이 그대로 나온다). 「머릿말이 없으면」과 「키가 안 맞으면」
두 케이스는 **이미 통과한다** — 현행 동작을 지키는 회귀 방어라서다. **그 사실을 보고에 적어라.**

- [ ] **Step 3: 구현한다**

`ddl-import.ts` 의 테이블 변환부에서 메타를 먼저 꺼내고 두 자리에 쓴다:

```ts
  for (const t of alive.values()) {
    const pkCols = new Set((pkOf.get(upper(t.name)) ?? []).map(upper))
    const named = resolveName(t.name, tableComment.get(upper(t.name)), t.name)
    // 머릿말이 실어 온 부분. 없거나 키가 안 맞으면 undefined 라 현행 동작으로 떨어진다(설계 D6).
    const meta = parsed.nameMeta?.[upper(t.name)]
    …
    tables.push({
      physicalName: meta?.p ?? t.name,
      // ⚠️ 논리명은 메타가 코멘트를 이긴다(설계 D5) — 코멘트에는 **조합된** 논리명이 들어 있다.
      // 설명(' - ' 뒤)은 코멘트에서 그대로 가져온다.
      logicalName: meta?.l ?? named.logicalName,
      comment: named.comment,
      columns, indexes: [],
      custom: resolveCustom(customIndex.get(upper(t.name)), 'table', t.name),
    })
```

⚠️ **`colMapByTable`·`tableByUpper` 등 다른 색인은 `t.name`(DDL 원문 이름) 기준 그대로 둔다** —
인덱스·관계가 DDL 원문 표기로 테이블을 찾기 때문이다. 부분 이름으로 바꾸면 그 해소가 깨진다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl-import.test.ts src/dbml-roundtrip.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
⚠️ **`dbml-roundtrip.test.ts` 가 깨지면 안 된다** — 그 픽스처는 템플릿이 없어 머릿말이 안 나가고
메타도 없다. 깨졌다면 색인을 부분 이름으로 바꿔 관계·인덱스 해소를 망가뜨린 것이다.

- [ ] **Step 5: 부분 복원과 D5 가 각각 잠기는지 실증한다**

**(a) 부분 복원** — `physicalName: meta?.p ?? t.name` 을 `t.name` 으로 되돌린다.
```bash
git diff packages/core/src/ddl-import.ts
pnpm -C packages/core exec vitest run src/ddl-import.test.ts
```
기대: **FAIL** — 「머릿말이 있으면 부분이 복원된다」·「두 번 왕복해도」·「DBML 도」가 빨개진다.

**(b) D5** — `logicalName: meta?.l ?? named.logicalName` 을 `named.logicalName` 으로 되돌린다.
```bash
git diff packages/core/src/ddl-import.ts
pnpm -C packages/core exec vitest run src/ddl-import.test.ts -t '논리명은 메타가 이기고'
```
기대: **FAIL** — `'회원'` 자리에 `'SALES_회원'` 이 나온다.

둘 다 되돌리고 초록을 확인한 뒤 **네 결과와 측정 범위를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl-import.ts packages/core/src/ddl-import.test.ts && \
git commit -m "feat(core): 머릿말이 있으면 가져오기가 부분을 복원한다

물리명 사이클의 D2(왕복이 깨진 채로 둔다)를 뒤집는다. 역분해는 여전히 하지 않는다 —
내보낼 때 적어 둔 부분을 그대로 읽는다. 남의 DDL 처럼 머릿말이 없으면 지금까지의
동작 그대로다. 논리명은 메타가 코멘트를 이긴다 — 코멘트에는 조합된 논리명이 들어
있고 설명만 코멘트에서 가져온다. planDdlImport 가 공용 플래너라 DBML 도 함께 닫힌다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: 문서와 최종 검증

**Files:**
- Modify: `docs/13-naming.md` · `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 문서를 쓴다**

`docs/13-naming.md` — 「왕복」 절을 더한다: 내보낸 파일을 되읽으면 부분이 복원된다는 것, **조건은
머릿말 주석이 함께 있는 것**, 템플릿을 안 쓰면 머릿말이 아예 안 나간다는 것.

`docs/manual/user-guide.md` — ⚠️ **기존 왕복 주의를 갱신한다.** 지금은 「내보낸 DDL 을 다시 가져오면
`TB_MBR_TB_MBR_ORD` 가 됩니다 — 접두를 손으로 지우세요」로 적혀 있다. 새 사실로 바꾸고 **두 가지 예외**를
함께 적는다:
- 파일 첫 줄의 `-- erdd:v1 …` 주석을 지우면 옛 동작이 된다
- `CREATE TABLE` 한 문장만 잘라 붙이면 머릿말이 없어 옛 동작이 된다

`docs/superpowers/HANDOFF.md`:
- 머리말의 **최종 갱신 · main HEAD** 갱신
- 완료 표에 이 사이클 추가
- 테스트 기준선을 **실측값**으로 갱신
- 3절 불변식에 추가:
  > **내보낸 산출물의 첫 줄 주석(`erdd:v1`)은 가져오기 계약의 일부다.** 지우면 왕복이 옛 동작으로
  > 돌아간다. 새 내보내기 포맷을 추가하면 머릿말도 함께 실어야 왕복이 닫힌다.
- 6절 이월에서 **「역설계 역분해」를 해소 처리**하고, 남는 것을 적는다:
  - 템플릿·그룹 별칭 복원(설계 D2 로 배제)
  - 머릿말 없는 조각 붙여넣기(설계 D1 이 수용한 대가)
  - 컬럼 물리명 템플릿

- [ ] **Step 2: 최종 검증**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -C apps/web test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_e' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
🔥 `. ./.env` 금지. 서버가 `20 passed | 174 skipped` 면 미실행이다.
각 스위트의 **실측 통과 수를 보고에 적는다**(기준선 `core 771 · cli 145 · web 935 · server 209` 대비).

- [ ] **Step 3: 커밋**

```bash
git add docs/13-naming.md docs/manual/user-guide.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 머릿말 메타로 왕복이 닫힌 것을 문서에 넣는다

사용자 매뉴얼의 왕복 주의가 옛 동작을 설명하고 있어 갱신한다. 머릿말을 지우거나
문장만 잘라 붙이면 옛 동작이 된다는 두 예외를 함께 적었다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 컨트롤러가 돈다)

1. 템플릿을 걸고 DDL 내보내기 — **첫 줄에 `-- erdd:v1 {…}`** 이 있는지, 부분 이름이 맞는지.
2. 그 DDL 을 그대로 **DDL·DBML 가져오기**에 넣고 미리보기의 물리명이 **부분(`ORD`)** 인지.
3. 첫 줄을 지우고 다시 가져와 **조합 이름(`TB_MBR_ORD`)** 이 되는지 — 옛 동작 폴백.
4. **템플릿을 지우고 내보내면 머릿말이 없는지**(설계 D4).
5. DBML 내보내기 첫 줄이 `// erdd:v1 …` 이고 **`Project` 블록보다 앞**인지.
6. 논리명 템플릿까지 걸고 가져오면 논리명이 **부분**으로 들어오는지(설계 D5).
