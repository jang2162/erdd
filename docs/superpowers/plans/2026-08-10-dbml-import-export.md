# DBML 가져오기·내보내기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내보내기에 DBML 형식을, 가져오기에 DBML 파싱을 더한다(주 용도: dbdocs 문서 발행).

**Architecture:** DBML 전용 경로를 새로 파지 않는다. 파서(`parseDbml`)만 새로 쓰고 그 결과를 기존
`ParsedDdl` 형태(+ `groups`·`customValues`)로 내어 `planDdlImport` → `applyDdlImport`를 그대로 탄다.
내보내기(`generateDbml`)는 `generateDdl`과 같은 타입 해석(`resolveColumn`)·같은 테이블 선정 판정을
공유한다.

**Tech Stack:** TypeScript, zod, vitest, React 19 + zustand(웹). `packages/core`는 **IO·런타임
의존성 free**여야 하므로 `@dbml/core` 같은 외부 파서를 쓰지 않는다 — 손으로 쓴 좁은 파서다.

**설계 문서:** `docs/superpowers/specs/2026-08-10-dbml-import-export-design.md` (§ 참조는 이 문서를 가리킨다)

## Global Constraints

- **언어:** 응답·커밋 메시지·주석·문서는 한국어.
- **커밋:** `git add -A` 금지. 경로를 명시하고 `add`와 `commit`을 한 명령에 붙인다. 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o
  ```
- **`packages/core`는 순수 함수만.** IO·DOM·런타임 의존성 금지.
- **새 export는 `packages/core/src/index.ts`에 등록**해야 웹에서 `@erdd/core`로 보인다. 등록하지
  않으면 웹 태스크에서 import가 깨진다.
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`는 `-s`가 자식 출력을 삼켜 오류가
  있어도 0바이트 출력 + 종료코드 1이 된다. 파이프(`| tail`)를 붙이면 `$?`가 tail 것이 되어 또
  오판한다. 반드시 `pnpm -r typecheck; echo "EXIT=$?"` 또는 패키지별 `pnpm -s -C packages/core typecheck`.
- **테스트 실행:**
  - core: `pnpm -C packages/core exec vitest run <파일>`
  - web: `pnpm -C apps/web exec vitest run <파일>`
  - 전체: `pnpm verify` (서버 스위트는 DB env 필요: `set -a && . ./.env && set +a && pnpm verify`)
- **TDD.** 실패하는 테스트를 먼저 쓰고, 실패를 눈으로 확인한 뒤 구현한다.
- **한 태스크 = 한 커밋.** 태스크 끝에서 반드시 커밋한다.

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `packages/core/src/dbml-note.ts` | 신규 | note 문자열 조립·분해(논리명 - 설명 + JSON 꼬리). **내보내기와 가져오기가 같은 규칙을 쓰도록 한 곳에 둔다** |
| `packages/core/src/dbml.ts` | 신규 | `generateDbml` |
| `packages/core/src/dbml-parse.ts` | 신규 | `parseDbml` |
| `packages/core/src/ddl.ts` | 수정 | 공유 판정 4개 export, 경고 문구에서 "DDL" 제거 |
| `packages/core/src/ddl-parse.ts` | 수정 | `ParsedConstraint` fk에 `oneToOne?: boolean` 추가 |
| `packages/core/src/ddl-import.ts` | 수정 | `groups`·`customValues` 처리, 계획에 `cardinality`·`name`·`custom`·`groups` |
| `packages/core/src/index.ts` | 수정 | 신규 export 등록 |
| `apps/web/src/editor/ddl-import-edits.ts` | 수정 | 그룹 생성, 커스텀 값, 카디널리티·관계 이름 적용 |
| `apps/web/src/editor/export-dialog.tsx` | 수정 | DBML 섹션 |
| `apps/web/src/editor/ddl-import-dialog.tsx` | 수정 | 형식 토글 |
| `apps/web/src/editor/store.ts` | 수정 | `projectName` |
| `apps/web/src/editor/use-model.ts` | 수정 | `projectName` 싣기 |

---

### Task 1: `ddl.ts` 공유 판정 노출 + 경고 문구 중립화

`generateDbml`이 `generateDdl`과 **같은 테이블 선정 판정**을 쓰게 하려면 내부 함수를 꺼내야 한다.
판정이 갈리면 "DDL에는 있는데 DBML에는 없는 테이블"이 조용히 생긴다. 경고는 두 형식이 함께 쓰므로
문구에서 형식 이름을 뺀다.

**Files:**
- Modify: `packages/core/src/ddl.ts`
- Test: `packages/core/src/ddl.test.ts`

**Interfaces:**
- Produces: `export function selectTables(model: ProjectModel, scope: DdlScope): Table[]`,
  `export function tableColumns(model: ProjectModel, tableId: string): Column[]`,
  `export function hasEmptyPhysicalName(model: ProjectModel, table: Table): boolean`,
  `export function commentText(logicalName: string, physicalName: string, comment: string | null): string | null`

- [ ] **Step 1: 경고 문구를 고정하는 테스트를 고친다**

`packages/core/src/ddl.test.ts`에서 `DDL에서 제외됨` 을 기대하는 단언을 찾아 `내보내기에서 제외됨`
으로 바꾼다. 다음 명령으로 위치를 찾는다:

```bash
grep -rn "DDL에서 제외" packages/core/src apps/web/src docs/manual
```

`docs/manual/user-guide.md`에 이 문구가 「」로 인용돼 있으면 **Task 11에서** 함께 고친다(여기서는
코드만).

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts`
Expected: FAIL — 기대 문구가 `내보내기에서 제외됨`인데 구현은 아직 `DDL에서 제외됨`을 낸다.

- [ ] **Step 3: `ddl.ts`를 고친다**

네 함수 선언 앞에 `export`를 붙인다(`selectTables`, `tableColumns`, `hasEmptyPhysicalName`,
`commentText`). 그리고 `ddlWarnings`의 두 문구를 바꾼다:

```ts
if (tableColumns(model, t.id).length === 0) out.push(`${warningLabel(t)}: 컬럼이 없어 내보내기에서 제외됨`)
…
out.push(`${warningLabel(t)}: 물리명이 비어 있어 내보내기에서 제외됨`)
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts && git commit -m "refactor(core): DDL 내보내기의 테이블 선정 판정을 공유 가능하게 연다

generateDbml 이 같은 판정을 써야 한다 — 갈리면 DDL 에는 있는데 DBML 에는
없는 테이블이 조용히 생긴다. 경고 문구는 두 형식이 함께 쓰므로 형식 이름을 뺀다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 2: `dbml-note.ts` — note 조립·분해 (§3)

내보내기와 가져오기가 **같은 규칙**을 쓰도록 한 파일에 둔다. 나뉘면 한쪽만 고쳐져 왕복이 조용히
깨진다.

**Files:**
- Create: `packages/core/src/dbml-note.ts`
- Create: `packages/core/src/dbml-note.test.ts`

**Interfaces:**
- Consumes: `commentText`(Task 1에서 export됨)
- Produces:
  ```ts
  export function buildDbmlNote(
    logicalName: string, physicalName: string, comment: string | null,
    custom: Record<string, string>,
  ): string | null
  export function splitDbmlNote(
    text: string,
  ): { logicalName: string; comment: string | null; custom: Record<string, string> }
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// packages/core/src/dbml-note.test.ts
import { describe, expect, it } from 'vitest'
import { buildDbmlNote, splitDbmlNote } from './dbml-note.js'

describe('buildDbmlNote', () => {
  it('논리명·설명·커스텀을 한 줄로 합친다', () => {
    expect(buildDbmlNote('회원', 'MBR', '회원 기본정보', { 보안등급: '2' }))
      .toBe('회원 - 회원 기본정보 {"보안등급":"2"}')
  })

  it('커스텀이 없으면 꼬리를 붙이지 않는다', () => {
    expect(buildDbmlNote('회원', 'MBR', '회원 기본정보', {})).toBe('회원 - 회원 기본정보')
  })

  it('빈 문자열 값은 미입력이므로 내보내지 않는다', () => {
    expect(buildDbmlNote('회원', 'MBR', null, { 보안등급: '' })).toBe('회원')
  })

  it('논리명==물리명이고 설명·커스텀이 없으면 null 이다', () => {
    expect(buildDbmlNote('MBR', 'MBR', null, {})).toBeNull()
  })

  it('설명이 없고 커스텀만 있으면 논리명 뒤에 꼬리만 붙는다', () => {
    expect(buildDbmlNote('회원', 'MBR', null, { 보안등급: '2' })).toBe('회원 {"보안등급":"2"}')
  })
})

describe('splitDbmlNote', () => {
  it('buildDbmlNote 의 역이다', () => {
    expect(splitDbmlNote('회원 - 회원 기본정보 {"보안등급":"2"}')).toEqual({
      logicalName: '회원', comment: '회원 기본정보', custom: { 보안등급: '2' },
    })
  })

  it('꼬리가 없으면 커스텀은 빈 객체다', () => {
    expect(splitDbmlNote('회원 - 회원 기본정보')).toEqual({
      logicalName: '회원', comment: '회원 기본정보', custom: {},
    })
  })

  it('JSON 이 깨져 있으면 통째로 설명으로 둔다', () => {
    expect(splitDbmlNote('회원 - 상태 {깨진')).toEqual({
      logicalName: '회원', comment: '상태 {깨진', custom: {},
    })
  })

  it('값이 문자열이 아니면 커스텀으로 보지 않는다', () => {
    expect(splitDbmlNote('회원 - 설명 {"n":1}')).toEqual({
      logicalName: '회원', comment: '설명 {"n":1}', custom: {},
    })
  })

  it('설명 안에 중괄호가 있어도 마지막 것만 꼬리로 본다', () => {
    expect(splitDbmlNote('회원 - {코드} 설명 {"보안등급":"2"}')).toEqual({
      logicalName: '회원', comment: '{코드} 설명', custom: { 보안등급: '2' },
    })
  })

  it('논리명 없이 꼬리만 있으면 논리명이 빈 문자열이다', () => {
    expect(splitDbmlNote('{"보안등급":"2"}')).toEqual({
      logicalName: '', comment: null, custom: { 보안등급: '2' },
    })
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-note.test.ts`
Expected: FAIL — `Failed to resolve import "./dbml-note.js"`

- [ ] **Step 3: 구현한다**

```ts
// packages/core/src/dbml-note.ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-note.test.ts`
Expected: PASS (11건)

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/dbml-note.ts packages/core/src/dbml-note.test.ts && git commit -m "feat(core): DBML note 조립·분해를 한 파일에 둔다

내보내기와 가져오기가 같은 규칙을 써야 왕복이 성립한다. 나뉘면 한쪽만
고쳐져 조용히 깨진다. JSON 꼬리는 마지막 중괄호부터 읽어 보고 모든 값이
문자열일 때만 떼어낸다 — 사람이 쓴 중괄호를 깨뜨리지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 3: `generateDbml` — Project·Table·컬럼 (§4, §4.2)

**Files:**
- Create: `packages/core/src/dbml.ts`
- Create: `packages/core/src/dbml.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `selectTables`·`tableColumns`·`hasEmptyPhysicalName`(Task 1), `buildDbmlNote`(Task 2),
  `resolveColumn(col, model, dialect): { sql, logicalType, defaultValue, checkValues }`,
  `parseLogicalType`, `customFieldsFor(model, 'table'|'column')`
- Produces:
  ```ts
  export function generateDbml(
    model: ProjectModel, dialect: Dialect, scope?: ExportScope,
    opts?: { projectName?: string },
  ): string
  export const DBML_DATABASE_TYPE: Record<Dialect, string>
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// packages/core/src/dbml.test.ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { generateDbml } from './dbml.js'

function baseModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본정보',
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  return m
}

describe('generateDbml', () => {
  it('식별자를 큰따옴표로 감싸고 컬럼 설정을 낸다', () => {
    const out = generateDbml(baseModel(), 'postgresql')
    expect(out).toContain('Table "MBR" [note: \'회원 - 회원 기본정보\'] {')
    expect(out).toContain('"MBR_NO" bigint [pk, increment, note: \'회원번호\']')
    expect(out).toContain('"MBR_NM" varchar(100) [not null, note: \'회원명\']')
  })

  it('projectName 을 주면 Project 블록을 낸다', () => {
    const out = generateDbml(baseModel(), 'oracle', { kind: 'all' }, { projectName: '회원 관리' })
    expect(out.startsWith('Project "회원 관리" {\n  database_type: \'Oracle\'\n}')).toBe(true)
  })

  it('projectName 이 없으면 Project 블록을 내지 않는다', () => {
    expect(generateDbml(baseModel(), 'postgresql')).not.toContain('Project ')
  })

  it('0컬럼 테이블과 빈 물리명 테이블은 제외한다', () => {
    const m = baseModel()
    m.tables['t2'] = {
      id: 't2', logicalName: '빈테이블', physicalName: 'EMPTY', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['t3'] = {
      id: 't3', logicalName: '이름없음', physicalName: '', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '컬럼', physicalName: 'C', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {},
    }
    const out = generateDbml(m, 'postgresql')
    expect(out).not.toContain('EMPTY')
    expect(out).not.toContain('이름없음')
  })

  it('작은따옴표·개행이 든 설명을 안전하게 낸다', () => {
    const m = baseModel()
    m.tables['t1']!.comment = "it's\n두 줄"
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain("note: '''회원 - it's\n두 줄'''")
  })

  describe('default 표현', () => {
    const withDefault = (v: string) => {
      const m = baseModel()
      m.columns['c2']!.defaultValue = v
      return generateDbml(m, 'postgresql')
    }
    it('문자열 리터럴', () => expect(withDefault("'ACTIVE'")).toContain("default: 'ACTIVE'"))
    it('숫자', () => expect(withDefault('0')).toContain('default: 0'))
    it('불리언', () => expect(withDefault('TRUE')).toContain('default: true'))
    it('NULL', () => expect(withDefault('NULL')).toContain('default: null'))
    it('표현식은 백틱', () => expect(withDefault('now()')).toContain('default: `now()`'))
  })

  it('autoIncrement 는 PK 이고 정수일 때만 increment 로 낸다', () => {
    const m = baseModel()
    m.columns['c2']!.autoIncrement = true            // PK 가 아니다
    expect(generateDbml(m, 'postgresql')).not.toContain('"MBR_NM" varchar(100) [increment')
  })

  it('커스텀 항목 값을 note 꼬리로 낸다', () => {
    const m = baseModel()
    m.customFields['f1'] = {
      id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    m.tables['t1']!.custom = { f1: '2' }
    expect(generateDbml(m, 'postgresql')).toContain('{"보안등급":"2"}')
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml.test.ts`
Expected: FAIL — `Failed to resolve import "./dbml.js"`

- [ ] **Step 3: 구현한다**

```ts
// packages/core/src/dbml.ts
import type { Column, ProjectModel, Table } from './model.js'
import type { Dialect } from './dialect.js'
import { parseLogicalType } from './logical-type.js'
import { resolveColumn } from './domain-resolve.js'
import { customFieldsFor } from './custom-field.js'
import { buildDbmlNote } from './dbml-note.js'
import {
  selectTables, tableColumns, hasEmptyPhysicalName, type ExportScope,
} from './ddl.js'

/** dbdocs 가 읽는 값이다. 한국어 표시명(DIALECT_LABEL)을 쓰면 안 된다. */
export const DBML_DATABASE_TYPE: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL', oracle: 'Oracle', mssql: 'SQL Server',
}

const INT_KINDS = new Set(['SMALLINT', 'INT', 'BIGINT'])

function isIntegerType(type: string): boolean {
  const p = parseLogicalType(type)
  return p.ok && INT_KINDS.has(p.type.kind)
}

/** 식별자. 한글·예약어·숫자 시작이 전부 안전해지도록 항상 큰따옴표로 감싼다. */
export function quoteDbmlIdent(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 문자열. 개행이 있으면 트리플 쿼트를 쓴다(설명은 여러 줄일 수 있다). */
export function quoteDbmlString(s: string): string {
  if (s.includes('\n')) return `'''${s.replace(/'''/g, "\\'\\'\\'")}'''`
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** #RGB 를 #RRGGBB 로 편다. 그 외 형태는 그대로 둔다. */
export function normalizeHexColor(c: string): string {
  const m = /^#([0-9a-fA-F]{3})$/.exec(c.trim())
  if (!m) return c.trim()
  const [r, g, b] = m[1]!.split('')
  return `#${r}${r}${g}${g}${b}${b}`
}

/** 모델의 defaultValue 원문 → DBML 설정 값 (§4.2). 역은 dbml-parse 의 dbmlDefaultToRaw. */
export function rawDefaultToDbml(raw: string): string {
  const v = raw.trim()
  if (/^'.*'$/s.test(v)) return quoteDbmlString(v.slice(1, -1).replace(/''/g, "'"))
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^true$/i.test(v)) return 'true'
  if (/^false$/i.test(v)) return 'false'
  if (/^null$/i.test(v)) return 'null'
  return `\`${v.replace(/`/g, '\\`')}\``
}

function customOf(
  model: ProjectModel, entity: { custom: Record<string, string> }, target: 'table' | 'column',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of customFieldsFor(model, target)) {
    const v = entity.custom[f.id]
    if (v !== undefined && v !== '') out[f.name] = v
  }
  return out
}

function columnLine(model: ProjectModel, col: Column, dialect: Dialect, singlePk: boolean): string {
  const r = resolveColumn(col, model, dialect)
  const settings: string[] = []
  if (col.isPk && singlePk) settings.push('pk')
  if (col.autoIncrement && col.isPk && isIntegerType(r.logicalType)) settings.push('increment')
  if (!col.nullable) settings.push('not null')
  if (r.defaultValue !== null && r.defaultValue !== '') {
    settings.push(`default: ${rawDefaultToDbml(r.defaultValue)}`)
  }
  const note = buildDbmlNote(col.logicalName, col.physicalName, col.comment, customOf(model, col, 'column'))
  if (note !== null) settings.push(`note: ${quoteDbmlString(note)}`)
  const tail = settings.length > 0 ? ` [${settings.join(', ')}]` : ''
  return `  ${quoteDbmlIdent(col.physicalName)} ${r.sql}${tail}`
}

function tableBlock(model: ProjectModel, table: Table, dialect: Dialect): string {
  const cols = tableColumns(model, table.id)
  const pks = cols.filter((c) => c.isPk)
  const lines = cols.map((c) => columnLine(model, c, dialect, pks.length === 1))

  const settings: string[] = []
  const group = table.groupId === null ? undefined : model.tableGroups[table.groupId]
  if (group) settings.push(`headercolor: ${normalizeHexColor(group.color)}`)
  const note = buildDbmlNote(
    table.logicalName, table.physicalName, table.comment, customOf(model, table, 'table'),
  )
  if (note !== null) settings.push(`note: ${quoteDbmlString(note)}`)
  const head = settings.length > 0 ? ` [${settings.join(', ')}]` : ''

  return `Table ${quoteDbmlIdent(table.physicalName)}${head} {\n${lines.join('\n')}\n}`
}

export function generateDbml(
  model: ProjectModel, dialect: Dialect, scope: ExportScope = { kind: 'all' },
  opts?: { projectName?: string },
): string {
  const tables = selectTables(model, scope).filter(
    (t) => tableColumns(model, t.id).length > 0 && !hasEmptyPhysicalName(model, t),
  )
  const blocks: string[] = []
  if (opts?.projectName) {
    blocks.push(
      `Project ${quoteDbmlIdent(opts.projectName)} {\n  database_type: '${DBML_DATABASE_TYPE[dialect]}'\n}`,
    )
  }
  for (const t of tables) blocks.push(tableBlock(model, t, dialect))
  return blocks.join('\n\n')
}
```

`index.ts`에 등록한다:

```ts
export { generateDbml, DBML_DATABASE_TYPE } from './dbml.js'
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck**

Run: `pnpm -s -C packages/core typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/dbml.ts packages/core/src/dbml.test.ts packages/core/src/index.ts && git commit -m "feat(core): DBML 내보내기의 Project·Table·컬럼

타입 해석과 테이블 선정을 DDL 내보내기와 공유한다. 식별자는 항상 큰따옴표로
감싸 한글 물리명·예약어를 안전하게 하고, default 는 문자열·숫자·불리언·
NULL·표현식 다섯 형태로 갈라 낸다(가져오기가 정확히 역을 수행한다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 4: `generateDbml` — indexes·복합PK·TableGroup·Ref (§4, §4.3)

**Files:**
- Modify: `packages/core/src/dbml.ts`
- Modify: `packages/core/src/dbml.test.ts`

**Interfaces:**
- Consumes: Task 3의 `quoteDbmlIdent`·`quoteDbmlString`·`normalizeHexColor`
- Produces: `generateDbml` 출력에 `indexes` 블록 / `TableGroup` 블록 / `Ref` 줄이 포함된다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`dbml.test.ts` 아래에 덧붙인다:

```ts
function relModel(): ProjectModel {
  const m = baseModel()
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: null }
  m.tables['t1']!.groupId = 'g1'
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: false, name: null,
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  return m
}

describe('generateDbml — 인덱스·그룹·관계', () => {
  it('인덱스를 indexes 블록으로 내고 이름을 보존한다', () => {
    expect(generateDbml(relModel(), 'postgresql'))
      .toContain('  indexes {\n    ("MBR_NM") [name: \'IX_MBR_NM\']\n  }')
  })

  it('유니크 인덱스에 unique 설정을 붙인다', () => {
    const m = relModel()
    m.indexes['ix1']!.unique = true
    expect(generateDbml(m, 'postgresql')).toContain("[unique, name: 'IX_MBR_NM']")
  })

  it('복합 PK 는 indexes 블록의 pk 로 낸다', () => {
    const m = relModel()
    m.columns['c4']!.isPk = true
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain('("ORD_NO", "MBR_NO") [pk]')
    expect(out).not.toContain('"ORD_NO" bigint [pk')
  })

  it('그룹을 TableGroup 으로 내고 색을 6자리로 편다', () => {
    const m = relModel()
    m.tableGroups['g1']!.color = '#abc'
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain('TableGroup "회원 관리" [color: #aabbcc] {\n  "MBR"\n  "ORD"\n}')
  })

  it('이름 없는 관계는 익명 Ref 로 낸다', () => {
    expect(generateDbml(relModel(), 'postgresql'))
      .toContain('Ref: "ORD"."MBR_NO" > "MBR"."MBR_NO"')
  })

  it('이름 있는 관계만 이름을 붙인다', () => {
    const m = relModel()
    m.relationships['r1']!.name = 'FK_ORD_MBR'
    expect(generateDbml(m, 'postgresql'))
      .toContain('Ref "FK_ORD_MBR": "ORD"."MBR_NO" > "MBR"."MBR_NO"')
  })

  it('1:1 은 - 로 낸다', () => {
    const m = relModel()
    m.relationships['r1']!.cardinality = '1:1'
    expect(generateDbml(m, 'postgresql')).toContain('Ref: "ORD"."MBR_NO" - "MBR"."MBR_NO"')
  })

  it('합성 FK 는 괄호로 묶는다', () => {
    const m = relModel()
    m.relationships['r1']!.columnMappings = [
      { childColumnId: 'c4', parentColumnId: 'c1' },
      { childColumnId: 'c3', parentColumnId: 'c2' },
    ]
    expect(generateDbml(m, 'postgresql'))
      .toContain('Ref: "ORD".("MBR_NO", "ORD_NO") > "MBR".("MBR_NO", "MBR_NM")')
  })

  it('범위가 좁혀지면 TableGroup·Ref 도 함께 좁혀진다', () => {
    const m = relModel()
    const out = generateDbml(m, 'postgresql', { kind: 'tables', tableIds: ['t1'] })
    expect(out).not.toContain('Ref:')
    expect(out).toContain('TableGroup "회원 관리" [color: #0E7A6C] {\n  "MBR"\n}')
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml.test.ts`
Expected: FAIL — 새 9건이 실패한다.

- [ ] **Step 3: 구현한다**

`tableBlock`에 인덱스·복합 PK를 더하고, `generateDbml`에 그룹·관계 블록을 더한다.

```ts
function indexLines(model: ProjectModel, table: Table, cols: Column[]): string[] {
  const lines: string[] = []
  const pks = cols.filter((c) => c.isPk)
  if (pks.length > 1) {
    lines.push(`    (${pks.map((c) => quoteDbmlIdent(c.physicalName)).join(', ')}) [pk]`)
  }
  for (const ix of Object.values(model.indexes).filter((i) => i.tableId === table.id)) {
    const names = ix.columns
      .map((c) => model.columns[c.columnId]?.physicalName)
      .filter((n): n is string => n !== undefined && n !== '')
    if (names.length === 0) continue
    const settings = [ix.unique ? 'unique' : null, `name: ${quoteDbmlString(ix.name)}`]
      .filter((s): s is string => s !== null)
    lines.push(`    (${names.map(quoteDbmlIdent).join(', ')}) [${settings.join(', ')}]`)
  }
  return lines
}
```

`tableBlock` 안에서 `lines` 뒤에 붙인다:

```ts
  const ixLines = indexLines(model, table, cols)
  const body = ixLines.length > 0
    ? `${lines.join('\n')}\n\n  indexes {\n${ixLines.join('\n')}\n  }`
    : lines.join('\n')
  return `Table ${quoteDbmlIdent(table.physicalName)}${head} {\n${body}\n}`
```

그룹·관계 블록:

```ts
function groupBlocks(model: ProjectModel, tables: Table[]): string[] {
  const byGroup = new Map<string, Table[]>()
  for (const t of tables) {
    if (t.groupId === null) continue
    const list = byGroup.get(t.groupId) ?? []
    list.push(t)
    byGroup.set(t.groupId, list)
  }
  const out: string[] = []
  for (const [groupId, members] of byGroup) {
    const g = model.tableGroups[groupId]
    if (!g) continue
    const names = members.map((t) => `  ${quoteDbmlIdent(t.physicalName)}`).join('\n')
    const settings = [`color: ${normalizeHexColor(g.color)}`]
    if (g.comment) settings.push(`note: ${quoteDbmlString(g.comment)}`)
    out.push(`TableGroup ${quoteDbmlIdent(g.name)} [${settings.join(', ')}] {\n${names}\n}`)
  }
  return out
}

function refLines(model: ProjectModel, selectedIds: Set<string>): string[] {
  const out: string[] = []
  for (const rel of Object.values(model.relationships)) {
    if (!selectedIds.has(rel.parentTableId) || !selectedIds.has(rel.childTableId)) continue
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    if (!parent || !child) continue
    const childCols = rel.columnMappings.map((m) => model.columns[m.childColumnId]?.physicalName ?? '')
    const parentCols = rel.columnMappings.map((m) => model.columns[m.parentColumnId]?.physicalName ?? '')
    if (childCols.some((c) => c === '') || parentCols.some((c) => c === '')) continue
    // 이름은 rel.name 이 있을 때만 붙인다 — 폴백(FK_자식_부모)을 쓰면 되읽을 때
    // 원본에 없던 이름이 생겨 왕복이 깨진다(설계 §4.3).
    const label = rel.name && rel.name.trim() !== '' ? ` ${quoteDbmlIdent(rel.name)}` : ''
    const op = rel.cardinality === '1:1' ? '-' : '>'
    out.push(`Ref${label}: ${side(child.physicalName, childCols)} ${op} ${side(parent.physicalName, parentCols)}`)
  }
  return out
}

function side(table: string, cols: string[]): string {
  const inner = cols.map(quoteDbmlIdent)
  return cols.length === 1
    ? `${quoteDbmlIdent(table)}.${inner[0]}`
    : `${quoteDbmlIdent(table)}.(${inner.join(', ')})`
}
```

`generateDbml` 끝을 이렇게 바꾼다:

```ts
  for (const t of tables) blocks.push(tableBlock(model, t, dialect))
  const selectedIds = new Set(tables.map((t) => t.id))
  blocks.push(...groupBlocks(model, tables))
  blocks.push(...refLines(model, selectedIds))
  return blocks.join('\n\n')
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/dbml.ts packages/core/src/dbml.test.ts && git commit -m "feat(core): DBML 내보내기의 인덱스·복합PK·TableGroup·Ref

관계 이름은 rel.name 이 있을 때만 붙인다 — DDL 처럼 FK_자식_부모 폴백을
쓰면 되읽을 때 원본에 없던 이름이 생겨 왕복이 깨진다. 1:1 은 - 하나로
말하고 UNIQUE 를 동반시키지 않는다(없던 유니크 인덱스가 생긴다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 5: `parseDbml` — 렉싱·Table 블록·컬럼 (§5)

**Files:**
- Create: `packages/core/src/dbml-parse.ts`
- Create: `packages/core/src/dbml-parse.test.ts`
- Modify: `packages/core/src/ddl-parse.ts` (fk 변형에 `oneToOne?: boolean`)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `splitDbmlNote`(Task 2), `ParsedDdl`·`ParsedConstraint`(`ddl-parse.ts`)
- Produces:
  ```ts
  export type ParsedGroup = { name: string; color: string | null; tables: string[] }
  export type ParsedCustomValue = {
    table: string; column: string | null; values: Record<string, string>
  }
  export type ParsedDbml = ParsedDdl & {
    groups: ParsedGroup[]
    customValues: ParsedCustomValue[]
    databaseType: string | null
  }
  export function parseDbml(text: string): ParsedDbml
  export function dbmlDefaultToRaw(token: string): string
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// packages/core/src/dbml-parse.test.ts
import { describe, expect, it } from 'vitest'
import { parseDbml } from './dbml-parse.js'

describe('parseDbml — Table', () => {
  it('컬럼과 설정을 읽는다', () => {
    const p = parseDbml(`
Table "MBR" [note: '회원 - 회원 기본정보'] {
  "MBR_NO" bigint [pk, increment, note: '회원번호']
  "MBR_NM" varchar(100) [not null, note: '회원명']
  "STTS" varchar(2) [default: '01']
}`)
    expect(p.tables).toHaveLength(1)
    expect(p.tables[0]!.name).toBe('MBR')
    expect(p.tables[0]!.columns[0]).toMatchObject({
      name: 'MBR_NO', rawType: 'bigint', inlinePk: true, autoIncrement: true, notNull: false,
    })
    expect(p.tables[0]!.columns[1]).toMatchObject({ name: 'MBR_NM', notNull: true })
    expect(p.tables[0]!.columns[2]!.defaultValue).toBe("'01'")
    expect(p.comments).toContainEqual({ table: 'MBR', column: null, text: '회원 - 회원 기본정보' })
    expect(p.comments).toContainEqual({ table: 'MBR', column: 'MBR_NO', text: '회원번호' })
  })

  it('따옴표 없는 식별자와 별칭을 읽는다', () => {
    const p = parseDbml('Table users as U {\n  id int [pk]\n}')
    expect(p.tables[0]!.name).toBe('users')
    expect(p.tables[0]!.columns[0]!.name).toBe('id')
  })

  it('주석을 무시한다', () => {
    const p = parseDbml(`
// 줄 주석
/* 블록
   주석 */
Table "MBR" {
  "MBR_NO" bigint [pk] // 꼬리 주석
}`)
    expect(p.tables).toHaveLength(1)
    expect(p.tables[0]!.columns).toHaveLength(1)
  })

  it('문자열 안의 주석 기호는 주석이 아니다', () => {
    const p = parseDbml("Table \"T\" {\n  \"C\" int [note: 'a // b']\n}")
    expect(p.comments[0]!.text).toBe('a // b')
  })

  it('트리플 쿼트 note 를 읽는다', () => {
    const p = parseDbml("Table \"T\" {\n  \"C\" int [note: '''두\n줄''']\n}")
    expect(p.comments[0]!.text).toBe('두\n줄')
  })

  it('컬럼 unique 설정을 UNIQUE 제약으로 낸다', () => {
    const p = parseDbml('Table "T" {\n  "C" int [unique]\n}')
    expect(p.constraints).toContainEqual({ kind: 'unique', table: 'T', name: null, columns: ['C'] })
  })

  it('primary key 를 pk 와 같게 읽는다', () => {
    const p = parseDbml('Table "T" {\n  "C" int [primary key]\n}')
    expect(p.tables[0]!.columns[0]!.inlinePk).toBe(true)
  })

  it('Project 의 database_type 을 읽는다', () => {
    const p = parseDbml("Project \"P\" {\n  database_type: 'Oracle'\n}")
    expect(p.databaseType).toBe('Oracle')
  })

  it('모르는 최상위 블록은 건너뛰고 경고한다', () => {
    const p = parseDbml('Enum status {\n  a\n  b\n}\nTable "T" {\n  "C" int\n}')
    expect(p.tables).toHaveLength(1)
    expect(p.skipped.map((s) => s.keyword)).toContain('Enum')
  })

  it('닫히지 않은 블록에서 죽지 않는다', () => {
    expect(() => parseDbml('Table "T" {\n  "C" int')).not.toThrow()
  })
})

describe('dbmlDefaultToRaw', () => {
  it('DBML 값 표현을 모델 원문으로 되돌린다', async () => {
    const { dbmlDefaultToRaw } = await import('./dbml-parse.js')
    expect(dbmlDefaultToRaw("'ACTIVE'")).toBe("'ACTIVE'")
    expect(dbmlDefaultToRaw('0')).toBe('0')
    expect(dbmlDefaultToRaw('true')).toBe('TRUE')
    expect(dbmlDefaultToRaw('null')).toBe('NULL')
    expect(dbmlDefaultToRaw('`now()`')).toBe('now()')
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-parse.test.ts`
Expected: FAIL — `Failed to resolve import "./dbml-parse.js"`

- [ ] **Step 3: 구현한다**

`ddl-parse.ts`의 fk 변형에 옵셔널 필드를 더한다(DDL 파서는 채우지 않는다):

```ts
  | { kind: 'fk'; table: string; name: string | null; columns: string[]
      refTable: string; refColumns: string[]; oneToOne?: boolean }
```

`dbml-parse.ts`의 뼈대:

```ts
import type {
  ParsedColumn, ParsedComment, ParsedConstraint, ParsedDdl, ParsedIndex, ParsedTable,
  SkippedStatement,
} from './ddl-parse.js'
import { splitDbmlNote } from './dbml-note.js'

export type ParsedGroup = { name: string; color: string | null; tables: string[] }
export type ParsedCustomValue = {
  table: string; column: string | null; values: Record<string, string>
}
export type ParsedDbml = ParsedDdl & {
  groups: ParsedGroup[]
  customValues: ParsedCustomValue[]
  databaseType: string | null
}

/** DBML 설정 값 → 모델의 defaultValue 원문. rawDefaultToDbml 의 역(설계 §4.2). */
export function dbmlDefaultToRaw(token: string): string {
  const t = token.trim()
  if (t.startsWith('`') && t.endsWith('`') && t.length >= 2) return t.slice(1, -1)
  if (/^'''/.test(t)) return `'${t.slice(3, -3)}'`
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return `'${t.slice(1, -1).replace(/\\'/g, "''")}'`
  }
  if (/^true$/i.test(t)) return 'TRUE'
  if (/^false$/i.test(t)) return 'FALSE'
  if (/^null$/i.test(t)) return 'NULL'
  return t
}
```

**렉싱 방침 — 주석 제거를 먼저 한 번에 한다.** 문자열(`'…'`, `'''…'''`), 백틱(`` `…` ``), 큰따옴표
식별자 안에서는 주석 기호를 해석하지 않는다. `ddl-parse.ts`의 `splitStatements`와 같은 스캔 방식이다.
공백으로 치환해 **줄 번호를 보존**한다(경고에 줄 번호를 쓴다).

```ts
function stripComments(src: string): string {
  const s = src.replace(/\r\n?/g, '\n')
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === "'" || c === '"' || c === '`') {
      const triple = c === "'" && s.startsWith("'''", i)
      const close = triple ? "'''" : c
      const start = i
      i += triple ? 3 : 1
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue }
        if (s.startsWith(close, i)) { i += close.length - 1; break }
        i++
      }
      out += s.slice(start, i + 1)
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++ }
      out += '\n'
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      const stop = end < 0 ? s.length : end + 2
      for (; i < stop; i++) out += s[i] === '\n' ? '\n' : ' '
      i--
      continue
    }
    out += c
  }
  return out
}
```

**블록 스캐너.** 최상위에서 키워드를 읽고, `{`부터 균형이 맞는 `}`까지를 본문으로 잘라낸다
(문자열 안의 중괄호는 세지 않는다 — `stripComments`와 같은 문자열 건너뛰기를 재사용한다).
키워드가 `Table`/`Ref`/`TableGroup`/`Project`이면 각 파서로, 그 외(대소문자 무시 비교)면 `skipped`에
`{ keyword, line, excerpt }`를 넣는다. 본문 없이 한 줄로 끝나는 `Ref: …` 형태도 최상위에서 받는다.

**설정 파서.** `[a, b: 'c']` → `Map<string, string | true>`. 콤마 분리는 문자열·괄호 안을 건너뛴다.
키는 소문자로 정규화한다(`not null`, `primary key`는 공백을 하나로 줄여 비교).

**컬럼 줄.** `<식별자> <타입> [설정]` — 타입은 괄호를 포함할 수 있다(`varchar(100)`,
`decimal(10, 2)`). 설정에서:

| 설정 | 매핑 |
|---|---|
| `pk`, `primary key` | `inlinePk: true` |
| `not null` | `notNull: true` |
| `null` | `notNull: false` |
| `increment` | `autoIncrement: true` |
| `unique` | `constraints`에 `{ kind: 'unique', table, name: null, columns: [컬럼] }` |
| `default: X` | `defaultValue: dbmlDefaultToRaw(X)` |
| `note: '…'` | `splitDbmlNote`로 쪼개 `comments`(설명)와 `customValues`(JSON)로 |
| `ref: > T.C` | Task 6에서 처리 |

**테이블 설정.** `note:`는 컬럼과 같은 방식(`column: null`), `headercolor:`는 Task 6의 그룹 색
폴백에 쓰도록 테이블별로 보관한다.

`index.ts`에 등록한다:

```ts
export { parseDbml, dbmlDefaultToRaw } from './dbml-parse.js'
export type { ParsedDbml, ParsedGroup, ParsedCustomValue } from './dbml-parse.js'
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-parse.test.ts`
Expected: PASS

- [ ] **Step 5: 기존 DDL 테스트에 회귀가 없는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl-parse.test.ts src/ddl-import.test.ts`
Expected: PASS (`oneToOne?`은 옵셔널이라 기존 코드가 영향받지 않는다)

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/dbml-parse.ts packages/core/src/dbml-parse.test.ts packages/core/src/ddl-parse.ts packages/core/src/index.ts && git commit -m "feat(core): DBML 파서의 렉싱과 Table 블록

주석 제거는 문자열·백틱·따옴표 식별자를 건너뛰며 공백으로 치환해 줄 번호를
보존한다. 컬럼 설정을 ParsedDdl 어휘로 옮겨 담아 그 뒤 파이프라인을 그대로
탄다. ParsedConstraint 의 fk 에 oneToOne 옵셔널을 더했다(DDL 파서는 안 채운다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 6: `parseDbml` — Ref·indexes·TableGroup (§5)

**Files:**
- Modify: `packages/core/src/dbml-parse.ts`
- Modify: `packages/core/src/dbml-parse.test.ts`

**Interfaces:**
- Produces: `parseDbml`이 `constraints`(fk·pk)·`indexes`·`groups`를 채운다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('parseDbml — Ref', () => {
  it('> 는 왼쪽이 자식이다', () => {
    const p = parseDbml('Ref: "ORD"."MBR_NO" > "MBR"."MBR_NO"')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })

  it('< 는 방향을 뒤집어 정규화한다', () => {
    const p = parseDbml('Ref: "MBR"."MBR_NO" < "ORD"."MBR_NO"')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })

  it('- 는 oneToOne 이고 UNIQUE 제약을 만들지 않는다', () => {
    const p = parseDbml('Ref: "ORD"."MBR_NO" - "MBR"."MBR_NO"')
    expect(p.constraints.find((c) => c.kind === 'fk')).toMatchObject({ oneToOne: true })
    expect(p.constraints.filter((c) => c.kind === 'unique')).toEqual([])
  })

  it('이름 있는 Ref 의 이름을 보존한다', () => {
    const p = parseDbml('Ref "FK_ORD_MBR": "ORD"."MBR_NO" > "MBR"."MBR_NO"')
    expect(p.constraints[0]).toMatchObject({ name: 'FK_ORD_MBR' })
  })

  it('합성 FK 를 읽는다', () => {
    const p = parseDbml('Ref: "A".("X", "Y") > "B".("P", "Q")')
    expect(p.constraints[0]).toMatchObject({ columns: ['X', 'Y'], refColumns: ['P', 'Q'] })
  })

  it('블록형 Ref 를 읽는다', () => {
    const p = parseDbml('Ref {\n  "ORD"."MBR_NO" > "MBR"."MBR_NO"\n}')
    expect(p.constraints).toHaveLength(1)
  })

  it('인라인 ref 를 같은 제약으로 편다', () => {
    const p = parseDbml('Table "ORD" {\n  "MBR_NO" bigint [ref: > "MBR"."MBR_NO"]\n}')
    expect(p.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null, columns: ['MBR_NO'],
      refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: false,
    })
  })
})

describe('parseDbml — indexes·TableGroup', () => {
  it('indexes 블록을 읽는다', () => {
    const p = parseDbml(`
Table "MBR" {
  "A" int
  "B" int

  indexes {
    ("A", "B") [name: 'IX_MBR_01']
    ("A") [unique, name: 'UX_MBR_A']
  }
}`)
    expect(p.indexes).toEqual([
      { table: 'MBR', name: 'IX_MBR_01', columns: ['A', 'B'], unique: false },
      { table: 'MBR', name: 'UX_MBR_A', columns: ['A'], unique: true },
    ])
  })

  it('이름 없는 인덱스에 이름을 지어 준다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n\n  indexes {\n    ("A")\n  }\n}')
    expect(p.indexes[0]!.name).toBe('IX_MBR_1')
  })

  it('indexes 의 pk 는 PK 제약으로 낸다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n  "B" int\n\n  indexes {\n    ("A", "B") [pk]\n  }\n}')
    expect(p.constraints).toContainEqual({ kind: 'pk', table: 'MBR', columns: ['A', 'B'] })
    expect(p.indexes).toEqual([])
  })

  it('TableGroup 을 읽는다', () => {
    const p = parseDbml('TableGroup "회원 관리" [color: #0E7A6C] {\n  "MBR"\n  "ORD"\n}')
    expect(p.groups).toEqual([{ name: '회원 관리', color: '#0E7A6C', tables: ['MBR', 'ORD'] }])
  })

  it('color 가 없으면 소속 테이블의 headercolor 로 떨어진다', () => {
    const p = parseDbml(`
Table "MBR" [headercolor: #123456] {
  "A" int
}
TableGroup "회원" {
  "MBR"
}`)
    expect(p.groups[0]!.color).toBe('#123456')
  })

  it('color 도 headercolor 도 없으면 null 이다', () => {
    const p = parseDbml('Table "MBR" {\n  "A" int\n}\nTableGroup "회원" {\n  "MBR"\n}')
    expect(p.groups[0]!.color).toBeNull()
  })

  it('note 의 JSON 꼬리를 customValues 로 낸다', () => {
    const p = parseDbml(`
Table "MBR" [note: '회원 - 설명 {"보안등급":"2"}'] {
  "A" int [note: '컬럼 {"개인정보":"Y"}']
}`)
    expect(p.customValues).toContainEqual({ table: 'MBR', column: null, values: { 보안등급: '2' } })
    expect(p.customValues).toContainEqual({ table: 'MBR', column: 'A', values: { 개인정보: 'Y' } })
    expect(p.comments).toContainEqual({ table: 'MBR', column: null, text: '회원 - 설명' })
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-parse.test.ts`
Expected: FAIL — 새 15건이 실패한다.

- [ ] **Step 3: 구현한다**

- **Ref 파싱.** 한 줄 형태(`Ref [이름]: 좌 <op> 우`)와 블록 형태(`Ref { 좌 <op> 우 }`) 둘 다 같은
  줄 파서로 처리한다. 한쪽은 `테이블.컬럼` 또는 `테이블.(컬럼, 컬럼)`이다.
  - `>` → 왼쪽이 자식. `<` → 오른쪽이 자식(**뒤집는다**). `-` → 왼쪽이 자식 + `oneToOne: true`.
  - `<>`(many-to-many)는 우리 모델에 없다 → `skipped`에 `{ keyword: 'Ref(<>)' }`로 넣고 버린다.
  - `oneToOne`은 **항상 채운다**(`false`도 명시). 테스트가 `toContainEqual`로 정확히 비교한다.
  - UNIQUE 제약을 만들지 않는다(설계 §4.3).
- **인라인 `ref:`** — 컬럼 설정에서 만나면 같은 함수로 오른쪽만 파싱하고 왼쪽은 그 컬럼이다.
- **`indexes` 블록** — 각 줄은 `(a, b) [설정]` 또는 `a [설정]`. `[pk]`면 `ParsedConstraint(kind:'pk')`,
  아니면 `ParsedIndex`. 이름이 없으면 `IX_<테이블>_<n>`(테이블 안에서 1부터). 백틱 표현식 컬럼
  (`` (`id*2`) ``)은 컬럼으로 해소되지 않으므로 인덱스를 만들지 않고 `skipped`에 넣는다.
- **`TableGroup`** — 본문의 각 줄이 테이블 이름(따옴표 유무 무관). `[color: #xxx]`가 있으면 그것,
  없으면 **첫 소속 테이블의 `headercolor`**, 둘 다 없으면 `null`.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/dbml-parse.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/dbml-parse.ts packages/core/src/dbml-parse.test.ts && git commit -m "feat(core): DBML 파서의 Ref·indexes·TableGroup

Ref 는 항상 자식→부모 방향으로 정규화한다(< 는 뒤집는다). - 는 oneToOne 으로
표시만 하고 UNIQUE 를 만들지 않는다 — 만들면 되읽을 때 원본에 없던 유니크
인덱스가 생긴다. 그룹 색은 color → 첫 소속 테이블의 headercolor → null 순이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 7: `planDdlImport` 확장 — 그룹·커스텀·카디널리티·관계 이름 (§2.1, §5)

**Files:**
- Modify: `packages/core/src/ddl-import.ts`
- Modify: `packages/core/src/ddl-import.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ParsedGroup`·`ParsedCustomValue`(Task 5)
- Produces: `DdlImportPlan.groups`, `DdlImportTable.custom`, `DdlImportColumn.custom`,
  `DdlImportRelationship.cardinality`·`name`, 경고 종류 `unknown-custom-field`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`ddl-import.test.ts`에 덧붙인다:

```ts
describe('planDdlImport — DBML 확장 필드', () => {
  const parsedOf = (over: Partial<ParsedDbml>): ParsedDbml => ({
    tables: [{ name: 'MBR', columns: [{
      name: 'MBR_NO', rawType: 'bigint', notNull: true, defaultValue: null,
      autoIncrement: false, inlinePk: true, comment: null,
    }] }],
    constraints: [], indexes: [], comments: [], skipped: [],
    groups: [], customValues: [], databaseType: null,
    ...over,
  })

  it('그룹을 계획에 싣는다', () => {
    const p = planDdlImport(
      createEmptyModel(),
      parsedOf({ groups: [{ name: '회원 관리', color: '#0E7A6C', tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups).toEqual([{
      name: '회원 관리', color: '#0E7A6C', tablePhysicalNames: ['MBR'], existingId: null,
    }])
  })

  it('같은 이름의 그룹이 있으면 existingId 를 채운다', () => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#111', comment: null }
    const p = planDdlImport(
      m, parsedOf({ groups: [{ name: '회원 관리', color: '#0E7A6C', tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups[0]!.existingId).toBe('g1')
  })

  it('건너뛴 테이블은 그룹 목록에서도 빠진다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const p = planDdlImport(
      m, parsedOf({ groups: [{ name: '회원 관리', color: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups).toEqual([])
  })

  it('그룹 수가 opCountEstimate 에 더해진다', () => {
    const withGroup = planDdlImport(
      createEmptyModel(),
      parsedOf({ groups: [{ name: 'G', color: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    const without = planDdlImport(createEmptyModel(), parsedOf({}), 'postgresql', DEFAULT_NAMING_RULES)
    expect(withGroup.opCountEstimate).toBe(without.opCountEstimate + 1)
  })

  it('커스텀 값을 정의 id 키로 옮긴다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    const p = planDdlImport(
      m, parsedOf({ customValues: [{ table: 'MBR', column: null, values: { 보안등급: '2' } }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.tables[0]!.custom).toEqual({ f1: '2' })
  })

  it('정의를 못 찾은 키는 버리고 경고한다', () => {
    const p = planDdlImport(
      createEmptyModel(),
      parsedOf({ customValues: [{ table: 'MBR', column: null, values: { 없는항목: 'x' } }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.tables[0]!.custom).toEqual({})
    expect(p.warnings).toContainEqual({
      kind: 'unknown-custom-field', target: 'MBR',
      message: '커스텀 항목 정의가 없어 "없는항목" 값을 버렸습니다',
    })
  })

  it('oneToOne 인 FK 는 cardinality 1:1 이 된다', () => {
    const parsed = parsedOf({
      tables: [
        { name: 'MBR', columns: [{ name: 'MBR_NO', rawType: 'bigint', notNull: true,
          defaultValue: null, autoIncrement: false, inlinePk: true, comment: null }] },
        { name: 'ORD', columns: [{ name: 'MBR_NO', rawType: 'bigint', notNull: true,
          defaultValue: null, autoIncrement: false, inlinePk: false, comment: null }] },
      ],
      constraints: [{
        kind: 'fk', table: 'ORD', name: 'FK_ORD_MBR', columns: ['MBR_NO'],
        refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: true,
      }],
    })
    const p = planDdlImport(createEmptyModel(), parsed, 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.relationships[0]).toMatchObject({ cardinality: '1:1', name: 'FK_ORD_MBR' })
  })

  it('DDL 경로(확장 필드 없음)는 1:N·이름 null 이다', () => {
    const parsed: ParsedDdl = {
      tables: parsedOf({}).tables, constraints: [], indexes: [], comments: [], skipped: [],
    }
    const p = planDdlImport(createEmptyModel(), parsed, 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toEqual([])
    expect(p.tables[0]!.custom).toEqual({})
  })
})
```

파일 위쪽 import에 `ParsedDbml` 타입을 더한다:

```ts
import type { ParsedDbml } from './dbml-parse.js'
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl-import.test.ts`
Expected: FAIL — 새 8건이 실패한다.

- [ ] **Step 3: 구현한다**

`ddl-import.ts`에서:

```ts
export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word' | 'table-conflict'
      | 'unresolved-fk' | 'unresolved-index' | 'skipped-statement' | 'unknown-custom-field'
  target: string
  message: string
}

export type DdlImportGroup = {
  name: string; color: string | null; tablePhysicalNames: string[]; existingId: string | null
}

/** DBML 파서만 채우는 확장 필드. DDL 경로에서는 undefined 다. */
type ImportInput = ParsedDdl & Partial<Pick<ParsedDbml, 'groups' | 'customValues'>>

export function planDdlImport(
  model: ProjectModel, parsed: ImportInput, dialect: Dialect, rules: NamingRules,
): DdlImportPlan {
```

커스텀 값 색인(테이블·컬럼 각각, 대문자 키):

```ts
  // 커스텀 항목 정의는 이름으로 찾는다(문서에 UUID 를 노출하지 않으려고 이름을 키로 냈다).
  const fieldIdByName = new Map<string, string>()
  for (const f of Object.values(model.customFields)) fieldIdByName.set(`${f.target}:${f.name}`, f.id)

  const customIndex = new Map<string, Record<string, string>>()
  for (const cv of parsed.customValues ?? []) {
    const key = cv.column === null ? upper(cv.table) : `${upper(cv.table)}.${upper(cv.column)}`
    customIndex.set(key, cv.values)
  }

  const resolveCustom = (
    values: Record<string, string> | undefined, target: 'table' | 'column', warnTarget: string,
  ): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [name, v] of Object.entries(values ?? {})) {
      const id = fieldIdByName.get(`${target}:${name}`)
      if (id === undefined) {
        warnings.push({
          kind: 'unknown-custom-field', target: warnTarget,
          message: `커스텀 항목 정의가 없어 "${name}" 값을 버렸습니다`,
        })
        continue
      }
      out[id] = v
    }
    return out
  }
```

테이블·컬럼을 만드는 자리에서 `custom: resolveCustom(...)`을 채운다. 관계에는:

```ts
      cardinality: fk.oneToOne === true ? '1:1' : '1:N',
      name: fk.name,
```

**주의:** `name`은 DDL 경로에서도 파서가 채운다(`ALTER TABLE ADD CONSTRAINT <name>`). DDL에서
이름이 살아나면 우리 내보내기의 자동 생성 이름(`FK_자식_부모`)이 되읽을 때 들어와 왕복이 깨진다.
**그래서 `oneToOne`이 `undefined`인 fk(= DDL 파서 산출물)는 `name: null`로 둔다:**

```ts
      name: fk.oneToOne === undefined ? null : fk.name,
```

그룹 계획:

```ts
  const groups: DdlImportGroup[] = []
  const groupIdByName = new Map(
    Object.values(model.tableGroups).map((g) => [upper(g.name), g.id]),
  )
  for (const g of parsed.groups ?? []) {
    const members = g.tables.filter((n) => tableByUpper.has(upper(n)))
      .map((n) => tableByUpper.get(upper(n))!.physicalName)
    if (members.length === 0) continue
    groups.push({
      name: g.name, color: g.color, tablePhysicalNames: members,
      existingId: groupIdByName.get(upper(g.name)) ?? null,
    })
  }
```

`opCountEstimate`에 `groups.filter((g) => g.existingId === null).length`를 더하고 —
**주의: 기존 그룹에 넣는 경우에도 테이블의 `groupId` update op가 아니라 create op에 실려 나가므로
새 그룹만 센다.** 반환에 `groups`를 더한다.

`index.ts`에 `DdlImportGroup` 타입을 export한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl-import.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: typecheck**

Run: `pnpm -s -C packages/core typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl-import.ts packages/core/src/ddl-import.test.ts packages/core/src/index.ts && git commit -m "feat(core): 가져오기 계획에 그룹·커스텀 값·카디널리티·관계 이름

DBML 파서만 채우는 확장 필드를 옵셔널로 받아 DDL 경로의 동작을 바꾸지 않는다.
커스텀 항목은 이름으로 정의를 찾아 id 키로 옮기고, 정의가 없으면 버리고
경고한다 — 이름 키를 심으면 id 공간과 섞여 죽은 값이 된다. 관계 이름은
oneToOne 이 undefined 인 fk(=DDL 산출물)에서는 버린다(자동 생성 이름이
되읽힐 때 들어와 왕복이 깨진다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 8: core 왕복 테스트 (§7)

**Files:**
- Create: `packages/core/src/dbml-roundtrip.test.ts`

**Interfaces:**
- Consumes: `generateDbml`·`parseDbml`·`planDdlImport`

- [ ] **Step 1: 왕복 테스트를 쓴다**

```ts
// packages/core/src/dbml-roundtrip.test.ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { generateDbml } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { planDdlImport } from './ddl-import.js'

/**
 * 왕복 픽스처. PostgreSQL 로 돌린다 — 타입 매핑이 단사라 방언 충돌 5건
 * (2026-08-03-ddl-reverse-engineering-design.md §2)이 개입하지 않는다.
 * 도메인은 쓰지 않는다(설계 §7 — domainId 는 이 범위의 경계다).
 */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.customFields['f1'] = {
    id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.customFields['f2'] = {
    id: 'f2', name: '개인정보', target: 'column', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: null }
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: "it's 회원\n두 줄 설명",
    groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: null, custom: { f1: '2' },
  }
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['t3'] = {
    id: 't3', logicalName: '회원상세', physicalName: 'MBR_DTL', comment: null,
    groupId: null, position: { x: 600, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: "'익명'", order: 1, comment: '표시용 이름', domainId: null,
    custom: { f2: 'Y' },
  }
  // 복합 PK + 합성 FK
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.columns['c5'] = {
    id: 'c5', tableId: 't3', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  m.relationships['r1'] = {                       // 익명 1:N
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: true, name: null,
  }
  m.relationships['r2'] = {                       // 이름 있는 1:1
    id: 'r2', parentTableId: 't1', childTableId: 't3',
    columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: true, name: 'FK_MBR_DTL_MBR',
  }
  return m
}

describe('DBML 왕복 — 내보낸 것을 다시 읽으면 같은 계획이 나온다', () => {
  const model = roundTripModel()
  const dbml = generateDbml(model, 'postgresql', { kind: 'all' }, { projectName: '회원 시스템' })
  // 커스텀 항목 정의는 DBML 에 실리지 않으므로(설계 §1) 정의만 있는 빈 모델로 되읽는다.
  const target = createEmptyModel()
  target.customFields = model.customFields
  const plan = planDdlImport(target, parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)

  it('구조 경고가 없다', () => {
    expect(plan.warnings.filter(
      (w) => w.kind === 'unresolved-fk' || w.kind === 'unresolved-index'
          || w.kind === 'table-conflict' || w.kind === 'unknown-custom-field',
    )).toEqual([])
  })

  it('테이블·논리명·설명·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.logicalName).toBe('회원')
    expect(mbr.comment).toBe("it's 회원\n두 줄 설명")
    expect(mbr.custom).toEqual({ f1: '2' })
  })

  it('컬럼 타입·PK·기본값·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.columns[0]).toMatchObject({
      physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    })
    expect(mbr.columns[1]).toMatchObject({
      physicalName: 'MBR_NM', type: 'VARCHAR(100)', defaultValue: "'익명'",
      comment: '표시용 이름', custom: { f2: 'Y' },
    })
  })

  it('복합 PK 가 왕복한다', () => {
    const ord = plan.tables.find((t) => t.physicalName === 'ORD')!
    expect(ord.columns.filter((c) => c.isPk).map((c) => c.physicalName)).toEqual(['ORD_NO', 'MBR_NO'])
  })

  it('인덱스가 이름째 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.indexes).toEqual([{ name: 'IX_MBR_NM', columnPhysicalNames: ['MBR_NM'], unique: false }])
  })

  it('그룹이 색째 왕복한다', () => {
    expect(plan.groups).toEqual([{
      name: '회원 관리', color: '#0E7A6C',
      tablePhysicalNames: ['MBR', 'ORD'], existingId: null,
    }])
  })

  it('익명 관계는 익명으로, 이름 있는 관계는 이름째 왕복한다', () => {
    const anon = plan.relationships.find((r) => r.childPhysicalName === 'ORD')!
    expect(anon).toMatchObject({ cardinality: '1:N', name: null })
    const named = plan.relationships.find((r) => r.childPhysicalName === 'MBR_DTL')!
    expect(named).toMatchObject({ cardinality: '1:1', name: 'FK_MBR_DTL_MBR' })
  })

  it('1:1 이 유니크 인덱스를 만들지 않는다', () => {
    const dtl = plan.tables.find((t) => t.physicalName === 'MBR_DTL')!
    expect(dtl.indexes).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트를 돌린다**

Run: `pnpm -C packages/core exec vitest run src/dbml-roundtrip.test.ts`
Expected: 처음에는 몇 건 FAIL 할 수 있다. 실패하면 **테스트가 아니라 구현을 고친다** — 이 테스트가
설계 §7의 계약이다. 실패가 §7의 손실 4건(정렬 방향·`identifying`·`domainId`·좌표) 중 하나에
해당할 때만 예외로 인정하고, 그 경우 테스트에 주석으로 근거를 남긴다.

- [ ] **Step 3: 커밋**

```bash
git add packages/core/src/dbml-roundtrip.test.ts && git commit -m "test(core): DBML 왕복을 계획 수준에서 고정한다

PostgreSQL 로 돌려 방언 타입 충돌이 개입하지 않게 한다. 커스텀 값·그룹·
색상·복합 PK·합성 FK·1:1·익명 관계·작은따옴표와 개행이 든 설명을 한
픽스처에 모아 왕복시킨다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 9: 웹 — `applyDdlImport` 확장 + 모델 수준 왕복

**Files:**
- Modify: `apps/web/src/editor/ddl-import-edits.ts`
- Modify: `apps/web/src/editor/ddl-import-edits.test.ts`

**Interfaces:**
- Consumes: `DdlImportPlan.groups`·`custom`·`cardinality`·`name`(Task 7), `nextGroupColor`
  (`apps/web/src/editor/group-palette.ts`)
- Produces: `applyDdlImport(model, plan, newId)`가 그룹·커스텀·카디널리티·관계 이름을 반영한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`ddl-import-edits.test.ts`에 덧붙인다:

```ts
describe('applyDdlImport — DBML 확장', () => {
  const planWith = (over: Partial<DdlImportPlan>): DdlImportPlan => ({
    tables: [{
      physicalName: 'MBR', logicalName: '회원', comment: null, custom: {},
      columns: [{
        physicalName: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', isPk: true,
        nullable: false, autoIncrement: false, defaultValue: null, comment: null, custom: {},
      }],
      indexes: [],
    }],
    relationships: [], skippedTables: [], warnings: [], groups: [], opCountEstimate: 2,
    ...over,
  })

  it('새 그룹을 만들고 테이블을 넣는다', () => {
    const next = applyDdlImport(createEmptyModel(), planWith({
      groups: [{ name: '회원 관리', color: '#0E7A6C', tablePhysicalNames: ['MBR'], existingId: null }],
    }), mkNewId())
    const group = Object.values(next.tableGroups)[0]!
    expect(group).toMatchObject({ name: '회원 관리', color: '#0E7A6C' })
    expect(Object.values(next.tables)[0]!.groupId).toBe(group.id)
  })

  it('색이 null 이면 팔레트에서 고른다', () => {
    const next = applyDdlImport(createEmptyModel(), planWith({
      groups: [{ name: 'G', color: null, tablePhysicalNames: ['MBR'], existingId: null }],
    }), mkNewId())
    expect(Object.values(next.tableGroups)[0]!.color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('existingId 가 있으면 새로 만들지 않는다', () => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#111', comment: null }
    const next = applyDdlImport(m, planWith({
      groups: [{ name: '회원 관리', color: '#0E7A6C', tablePhysicalNames: ['MBR'], existingId: 'g1' }],
    }), mkNewId())
    expect(Object.keys(next.tableGroups)).toEqual(['g1'])
    expect(next.tableGroups['g1']!.color).toBe('#111')       // 기존 색을 덮어쓰지 않는다
    expect(Object.values(next.tables)[0]!.groupId).toBe('g1')
  })

  it('커스텀 값을 테이블·컬럼에 옮긴다', () => {
    const plan = planWith({})
    plan.tables[0]!.custom = { f1: '2' }
    plan.tables[0]!.columns[0]!.custom = { f2: 'Y' }
    const next = applyDdlImport(createEmptyModel(), plan, mkNewId())
    expect(Object.values(next.tables)[0]!.custom).toEqual({ f1: '2' })
    expect(Object.values(next.columns)[0]!.custom).toEqual({ f2: 'Y' })
  })

  it('카디널리티와 관계 이름을 계획대로 만든다', () => {
    const plan = planWith({
      relationships: [{
        childPhysicalName: 'MBR', parentPhysicalName: 'MBR',
        columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }],
        identifying: false, cardinality: '1:1', name: 'FK_X',
      }],
    })
    const next = applyDdlImport(createEmptyModel(), plan, mkNewId())
    expect(Object.values(next.relationships)[0]).toMatchObject({ cardinality: '1:1', name: 'FK_X' })
  })
})
```

`mkNewId`는 이 파일의 기존 헬퍼를 쓴다. 없으면 다음을 파일 위쪽에 둔다:

```ts
function mkNewId(): () => string {
  let n = 0
  return () => `id${++n}`
}
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ddl-import-edits.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`applyDdlImport`에서 그룹을 먼저 처리하고 테이블 생성 시 `groupId`·`custom`을 채운다:

```ts
  const tableGroups = { ...model.tableGroups }
  const groupIdByTable = new Map<string, string>()
  const usedColors = Object.values(model.tableGroups).map((g) => g.color)
  for (const g of plan.groups) {
    let groupId = g.existingId
    if (groupId === null) {
      groupId = newId()
      const color = g.color ?? nextGroupColor(usedColors)
      usedColors.push(color)
      tableGroups[groupId] = { id: groupId, name: g.name, color, comment: null }
    }
    for (const name of g.tablePhysicalNames) groupIdByTable.set(name, groupId)
  }
```

테이블 생성부에서 `groupId: groupIdByTable.get(t.physicalName) ?? null`, `custom: t.custom`.
컬럼 생성부에서 `custom: c.custom`. 관계 생성부에서 `cardinality: r.cardinality`, `name: r.name`.
반환 객체에 `tableGroups`를 더한다.

주석도 갱신한다 — 파일 상단 JSDoc의 "관계의 `cardinality`·`name`도 `DdlImportRelationship`에 없는
필드다"는 이제 사실이 아니다:

```
 * 관계의 `cardinality`·`name`은 계획이 정한다 — DDL 경로에서는 계획이 `'1:N'`·`null`을 주고,
 * DBML 경로에서는 `-` 연산자와 `Ref` 이름이 그대로 실려 온다.
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ddl-import-edits.test.ts`
Expected: PASS

- [ ] **Step 5: 모델 수준 왕복 테스트를 더한다**

같은 파일 끝에:

```ts
describe('DBML 왕복 — 모델까지', () => {
  it('내보낸 DBML 을 되읽으면 같은 모델이 나온다', () => {
    const model = roundTripModel()          // core 의 dbml-roundtrip.test.ts 와 같은 픽스처를 이 파일에 복제
    const dbml = generateDbml(model, 'postgresql')
    const target = createEmptyModel()
    target.customFields = model.customFields
    const plan = planDdlImport(target, parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    const next = applyDdlImport(target, plan, mkNewId())

    const byName = (m: ProjectModel) => Object.fromEntries(
      Object.values(m.tables).map((t) => [t.physicalName, {
        logicalName: t.logicalName, comment: t.comment, custom: t.custom,
        group: t.groupId === null ? null : m.tableGroups[t.groupId]!.name,
      }]),
    )
    expect(byName(next)).toEqual(byName(model))
    expect(Object.values(next.relationships).map((r) => ({
      cardinality: r.cardinality, name: r.name,
    })).sort()).toEqual(Object.values(model.relationships).map((r) => ({
      cardinality: r.cardinality, name: r.name,
    })).sort())
  })
})
```

Run: `pnpm -C apps/web exec vitest run src/editor/ddl-import-edits.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/ddl-import-edits.ts apps/web/src/editor/ddl-import-edits.test.ts && git commit -m "feat(web): 가져오기 적용이 그룹·커스텀·카디널리티·관계 이름을 반영한다

기존 그룹에 넣을 때는 그 그룹의 색을 덮어쓰지 않는다 — 가져오는 파일이
프로젝트의 기존 색 결정을 바꿔선 안 된다. 모델 수준 왕복 테스트를 더해
계획 수준(core)에서 못 보는 groupId·custom 배선을 잠근다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 10: 웹 — 내보내기 다이얼로그 DBML 섹션 + `projectName`

**Files:**
- Modify: `apps/web/src/editor/store.ts`
- Modify: `apps/web/src/editor/use-model.ts`
- Modify: `apps/web/src/editor/export-dialog.tsx`
- Modify: `apps/web/src/editor/export-dialog.test.tsx`

**Interfaces:**
- Consumes: `generateDbml`(Task 3·4), store의 `projectName`
- Produces: 내보내기 다이얼로그의 `DBML` 섹션

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`export-dialog.test.tsx`에 덧붙인다(이 파일의 기존 렌더 헬퍼를 그대로 쓴다):

```tsx
it('DBML 섹션에서 미리보기와 다운로드 이름을 낸다', async () => {
  // 기존 테스트가 쓰는 렌더 헬퍼로 다이얼로그를 열고
  await user.click(screen.getByRole('button', { name: 'DBML' }))
  expect(screen.getByLabelText('DBML 미리보기').textContent).toContain('Table "MBR"')
})
```

`store.test.ts`(없으면 `use-model.test.tsx`)에 `projectName`이 실리는지 확인하는 테스트를 더한다 —
`use-model.test.tsx`의 `'project.get의 판정 결과를 store에 싣는다'` 테스트에 `name`을 더하고
`expect(useEditorStore.getState().projectName).toBe(...)`를 붙인다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/export-dialog.test.tsx src/editor/use-model.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`store.ts`: 상태에 `projectName: string | null`(초기값 `null`)을 더하고, `setProjectConfig`의
시그니처에 이름을 더한다:

```ts
setProjectConfig: (namingRules: NamingRules, dialects: Dialect[], projectName: string | null) => void
```

`use-model.ts`: `setProjectConfig(projectQuery.data.namingRules, projectQuery.data.dialects, projectQuery.data.name)`.

`export-dialog.tsx`:

```tsx
type Section = 'ddl' | 'dbml' | 'image' | 'excel'
…
const projectName = useEditorStore((s) => s.projectName)
const dbml = useMemo(
  () => generateDbml(model, dialect, scope, { projectName: projectName ?? undefined }),
  [model, dialect, scope, projectName],
)
```

DDL 섹션 버튼 뒤에 `DBML` 버튼을 두고, 섹션 본문은 DDL과 같은 구조(방언 버튼·`ExportScopeSelect`·
미리보기·경고)에 다운로드만 다르게 한다:

```tsx
const onDownloadDbml = () => {
  const blob = new Blob([dbml], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `erdd_${dialect}.dbml`
  a.click()
  URL.revokeObjectURL(url)
}
```

미리보기 `<pre>`의 `aria-label`은 `"DBML 미리보기"`. 경고는 DDL과 같은 `warnings`를 쓴다.

**방언·범위 state는 DDL 섹션과 공유한다**(새 state를 만들지 않는다) — 형식을 오갈 때 선택이
유지되는 것이 자연스럽다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/export-dialog.test.tsx src/editor/use-model.test.tsx`
Expected: PASS

- [ ] **Step 5: typecheck**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0` (`setProjectConfig` 호출처가 더 있으면 여기서 드러난다 — 전부 고친다)

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/use-model.ts apps/web/src/editor/export-dialog.tsx apps/web/src/editor/export-dialog.test.tsx apps/web/src/editor/use-model.test.tsx && git commit -m "feat(web): 내보내기에 DBML 섹션을 더한다

방언·범위 state 는 DDL 섹션과 공유해 형식을 오가도 선택이 유지된다.
Project 블록에 쓸 프로젝트명은 project.get 이 이미 오고 있으므로 같은
자리에서 store 에 싣는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 11: 웹 — 가져오기 다이얼로그 형식 토글

**Files:**
- Modify: `apps/web/src/editor/ddl-import-dialog.tsx`
- Modify: `apps/web/src/editor/ddl-import-dialog.test.tsx`

**Interfaces:**
- Consumes: `parseDbml`·`DBML_DATABASE_TYPE`(Task 3·5), `planDdlImport`(Task 7)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

**textarea의 `aria-label`은 형식에 따라 `'DDL'` / `'DBML'`로 갈린다.** 기존 테스트 8곳이
`getByRole('textbox', { name: 'DDL' })`로 찾고 있으므로 라벨을 통째로 바꾸면 전부 깨진다 —
기본 형식이 DDL이라 기존 테스트는 그대로 통과한다.

```tsx
/** DBML 본문을 textarea에 넣는다. userEvent.type은 `{`·`[`를 특수 키로 해석하므로 쓰지 않는다. */
function typeSchema(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } })
}

it('DBML 을 고르면 DBML 파서로 미리보기를 만든다', async () => {
  // 기존 헬퍼로 다이얼로그를 연다
  await userEvent.click(screen.getByRole('button', { name: 'DBML' }))
  typeSchema(screen.getByRole('textbox', { name: 'DBML' }), 'Table "MBR" {\n  "MBR_NO" bigint [pk]\n}')
  expect(await screen.findByText(/테이블 1개/)).toBeInTheDocument()
})

it('DBML 의 database_type 으로 방언을 자동 감지한다', async () => {
  await userEvent.click(screen.getByRole('button', { name: 'DBML' }))
  typeSchema(screen.getByRole('textbox', { name: 'DBML' }), "Project \"P\" {\n  database_type: 'Oracle'\n}")
  expect((screen.getByLabelText('방언') as HTMLSelectElement).value).toBe('oracle')
})

it('DBML 은 그룹 수를 미리보기에 보인다', async () => {
  await userEvent.click(screen.getByRole('button', { name: 'DBML' }))
  typeSchema(
    screen.getByRole('textbox', { name: 'DBML' }),
    'Table "MBR" {\n  "A" int\n}\nTableGroup "회원" {\n  "MBR"\n}',
  )
  expect(await screen.findByText(/그룹 1개/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ddl-import-dialog.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

```tsx
type Format = 'ddl' | 'dbml'
const [format, setFormat] = useState<Format>('ddl')

const parsed = useMemo(
  () => (text.trim() === '' ? null : format === 'ddl' ? parseDdl(text) : parseDbml(text)),
  [text, format],
)
const detected = useMemo(() => {
  if (text.trim() === '') return null
  if (format === 'ddl') return detectDialect(text)
  const dt = (parsed as ParsedDbml | null)?.databaseType ?? null
  return dt === null ? null : dialectFromDatabaseType(dt)
}, [text, format, parsed])
const dialect = manualDialect ?? detected ?? 'postgresql'
const plan = useMemo(
  () => (parsed === null ? null : planDdlImport(model, parsed, dialect, namingRules)),
  [parsed, dialect, model, namingRules],
)
```

`dialectFromDatabaseType`은 `dbml-parse.ts`에 두고 export한다(파서 옆이 자연스럽다):

```ts
/** Project { database_type } 원문 → 방언. 모르면 null. */
export function dialectFromDatabaseType(s: string): Dialect | null {
  const v = s.trim().toLowerCase()
  if (v.startsWith('postgres')) return 'postgresql'
  if (v === 'mysql' || v === 'mariadb') return 'mysql'
  if (v === 'oracle') return 'oracle'
  if (v === 'sql server' || v === 'mssql' || v === 'sqlserver') return 'mssql'
  return null
}
```

**주의:** `format`을 바꾸면 `manualDialect`를 `null`로 되돌린다(형식마다 감지 결과가 다르다).

UI: 다이얼로그 제목을 「가져오기」로 바꾸고, `textarea`의 `aria-label`과 placeholder를 형식에 따라
갈린다(`aria-label={format === 'ddl' ? 'DDL' : 'DBML'}` — **`'스키마'` 같은 공통 라벨로 바꾸면
기존 테스트 8곳이 깨진다**). 형식 토글은 방언 위에 둔다:

```tsx
<div className="flex gap-2">
  <Button type="button" size="sm" variant={format === 'ddl' ? 'default' : 'outline'}
    onClick={() => { setFormat('ddl'); setManualDialect(null) }}>DDL</Button>
  <Button type="button" size="sm" variant={format === 'dbml' ? 'default' : 'outline'}
    onClick={() => { setFormat('dbml'); setManualDialect(null) }}>DBML</Button>
</div>
```

미리보기 문장에 그룹을 더한다:

```tsx
{plan.groups.length > 0 && ` · 그룹 ${plan.groups.length}개`}
```

`mutate`의 요약은 형식에 따라 `'DDL 가져오기'` / `'DBML 가져오기'`.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ddl-import-dialog.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/ddl-import-dialog.tsx apps/web/src/editor/ddl-import-dialog.test.tsx packages/core/src/dbml-parse.ts packages/core/src/index.ts && git commit -m "feat(web): 가져오기에 DBML 형식 토글을 더한다

형식에 따라 파서만 갈리고 방언 선택·미리보기·op 상한·적용은 그대로
공유한다. 형식을 바꾸면 수동 방언 선택을 되돌린다 — 형식마다 자동 감지
결과가 다르다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```

---

### Task 12: 전체 검증 + 문서 갱신

**Files:**
- Modify: `docs/17-import-export.md`
- Modify: `docs/manual/user-guide.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 전체 스위트를 돌린다**

```bash
set -a && . ./.env && set +a && pnpm verify; echo "EXIT=$?"
```

Expected: `EXIT=0`. 실패하면 고치고 다시 돌린다. **네 스위트의 통과 수를 적어 둔다**(HANDOFF
기준선 갱신에 쓴다).

- [ ] **Step 2: `docs/17-import-export.md`를 고친다**

"기능 상세"에 두 절을 더한다:

```markdown
### DBML 내보내기

- dbdocs·dbdiagram.io 가 읽는 DBML 을 낸다. 주 용도는 **dbdocs 문서 발행**이다.
- 출력 내용: `Project`(프로젝트명·방언), `Table`(그룹 색 headercolor, note 에 논리명·설명),
  컬럼 설정(`pk`/`increment`/`not null`/`default`/`note`), `indexes` 블록(복합 PK 포함),
  `TableGroup`(색상), `Ref`(1:N `>` / 1:1 `-`, 합성키, 관계 이름).
- 타입은 DDL 과 같은 방언 해석을 쓴다(도메인의 방언별 매핑 포함).
- 커스텀 항목 값은 note 끝에 JSON 으로 붙는다 — 예: `회원 - 회원 기본정보 {"보안등급":"2"}`.
- 도메인 허용값을 `enum` 으로 내지는 않는다(가져올 때 도메인으로 되돌릴 방법이 없다).

### DBML 가져오기

- DBML 텍스트를 붙여넣으면 DDL 가져오기와 같은 미리보기·경고·적용 경로를 탄다.
- `TableGroup` 은 그룹으로 만들고(같은 이름이 있으면 그것을 쓴다), note 의 JSON 꼬리는 커스텀
  항목 값으로 되읽는다. 정의가 없는 항목 이름은 버리고 경고한다.
- 방언은 `Project { database_type }` 으로 자동 감지하며 수동으로 덮을 수 있다.
```

"단계별 범위"에 한 줄을 더한다:

```markdown
- **Phase 4 이후**: DBML 내보내기·가져오기.
```

- [ ] **Step 3: `docs/manual/user-guide.md`를 고친다**

내보내기 절에 DBML 선택지를, 가져오기 절에 형식 토글을 적는다. **화면 문구는 「」로 인용하므로
실제 버튼 라벨(`DBML`, 「가져오기」)과 정확히 맞춘다.** Task 1에서 바꾼 경고 문구
(`내보내기에서 제외됨`)가 인용돼 있으면 함께 고친다:

```bash
grep -n "DDL에서 제외\|DDL 가져오기" docs/manual/user-guide.md
```

- [ ] **Step 4: `docs/superpowers/HANDOFF.md`를 고친다**

완료 표에 한 줄을 더한다(기존 항목들의 밀도를 따른다 — 무엇을 왜 그렇게 했는지):

```markdown
| **DBML 가져오기·내보내기** | dbdocs 문서 발행이 주 용도. **DBML 전용 경로를 만들지 않았다** — 파서(`dbml-parse.ts`)만 새로 쓰고 결과를 `ParsedDdl`(+`groups`·`customValues`) 형태로 내어 `planDdlImport`·`applyDdlImport`를 그대로 탄다. 내보내기(`dbml.ts`)는 `generateDdl`과 테이블 선정 판정·타입 해석을 공유한다(`ddl.ts`가 `selectTables`·`tableColumns`·`hasEmptyPhysicalName`·`commentText`를 export). 커스텀 항목은 note 의 JSON 꼬리로 싣고 **키는 정의 이름**이다(모델 키는 UUID). 왕복을 지키려고 **관계 이름에 `FK_자식_부모` 폴백을 쓰지 않고**(원본에 없던 이름이 생긴다) **1:1 에 UNIQUE 를 동반시키지 않는다**(없던 유니크 인덱스가 생긴다). **서버 변경·마이그레이션 없음** ([설계](specs/2026-08-10-dbml-import-export-design.md)) |
```

테스트 기준선 4수를 Step 1에서 적어 둔 실측값으로 갱신한다.

- [ ] **Step 5: 커밋**

```bash
git add docs/17-import-export.md docs/manual/user-guide.md docs/superpowers/HANDOFF.md && git commit -m "docs: DBML 가져오기·내보내기를 문서에 반영한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019bgqg8frU5MxwRWGd1mN1o"
```
