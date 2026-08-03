# DDL 역설계(가져오기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DDL 텍스트를 붙여넣으면 파싱해 테이블·컬럼·PK·FK·인덱스를 만들고, 코멘트와 사전으로 논리명을 복원한다.

**Architecture:** `core`에 손으로 쓴 좁은 파서와 순수 계획 함수를 두고, `web`에 적용 producer와 다이얼로그를 둔다. 역함수(`fromDialectType`·`restoreLogicalName`)는 각자의 정함수 옆에 둬서 매핑을 고칠 때 양쪽이 같이 눈에 들어오게 한다. 기존 Excel 사전 업로드와 동일한 3단 구조다.

**Tech Stack:** TypeScript, vitest (core), React 19 + zustand + @xyflow/react + @testing-library (web)

**설계 문서:** [docs/superpowers/specs/2026-08-03-ddl-reverse-engineering-design.md](../specs/2026-08-03-ddl-reverse-engineering-design.md)

## Global Constraints

- **`packages/core`에 새 런타임 의존성을 넣지 않는다.** 현재 의존성은 `zod` 하나뿐이고 그 상태를 유지한다. 파서는 손으로 쓴다.
- **`dialect.ts`의 `toDialectType`·`FIXED` 매핑을 바꾸지 않는다.** 역함수를 추가만 한다. 정함수를 고치면 기존 내보내기가 바뀐다.
- 불가침: `packages/core/src/diff.ts` · `op.ts`(`ENTITY_KINDS`·`applyOps`) · `integrity.ts` · `model.ts`, `apps/server/src/services/perm.ts`.
- **서버·마이그레이션 변경 없음.** 가져오기는 기존 `model.mutate` 경로를 그대로 쓴다.
- 가져오기 전체가 **단일 mutation**이다(Revision 1건).
- 진입점·적용은 `canEdit` 게이트를 받는다. 컴포넌트는 `useEditorStore((s) => s.canEdit)`로 읽고, 테스트는 `@/testing/editor-store`의 `grantEditPermission()`으로 권한을 준다(`setLoaded(...)` 바로 다음 줄이 관행).
- 파싱·계획 함수는 **순수 함수**다(입력 → 값, IO·스토어 접근 없음).
- UI 카피는 한국어. 툴바 버튼 문구는 정확히 `가져오기`.
- 이벤트 값은 producer 진입 **전에** 캡처한다(`serializeMutation`이 producer를 마이크로태스크로 미루므로 지연 읽기는 스테일 값을 잡는다).
- 커밋은 명시 파일만(`git add .` / `git add -A` / `git add -u` 금지), `.idea/*`·`.env` 제외. 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
  ```

## 검증 명령

```bash
set -a && . ./.env && set +a && pnpm verify; echo "EXIT=$?"
```

⚠️ **`pnpm -s -r typecheck`의 출력만 보고 판정하지 말 것.** `-s`가 자식 출력을 삼켜서 타입 오류가 있어도 **출력이 0바이트이고 종료코드만 1**이다. 반드시 `EXIT=0`을 확인한다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 종료코드가 되어 또 오판한다.

패키지별 빠른 실행: `pnpm -C packages/core exec vitest run <패턴>` · `pnpm -C apps/web exec vitest run <패턴>`
(`pnpm -C <pkg> test -- <패턴>`의 `-- <패턴>`은 이 리포에서 필터로 먹지 않아 전체가 돈다.)

**기준선(시작 시점):** core 271 · web 322 · server 90 · typecheck 0

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `packages/core/src/dialect.ts` | 수정 | `fromDialectType` — `toDialectType`의 역함수 |
| `packages/core/src/naming.ts` | 수정 | `restoreLogicalName` — `generatePhysicalName`의 역함수 |
| `packages/core/src/ddl-parse.ts` | 생성 | DDL 텍스트 → 구조. 방언 감지 포함. 의미 해석 없음 |
| `packages/core/src/ddl-import.ts` | 생성 | `planDdlImport` — 파싱 결과 + 모델 + 사전 → 계획·경고·충돌 |
| `packages/core/src/index.ts` | 수정 | 신규 심볼 export |
| `apps/web/src/editor/ddl-import-edits.ts` | 생성 | 계획 → 다음 모델(자동 배치 포함) |
| `apps/web/src/editor/ddl-import-dialog.tsx` | 생성 | 붙여넣기·파일 → 미리보기 → 적용 |
| `apps/web/src/pages/project.tsx` | 수정 | 툴바에 `가져오기` 배치 |
| `docs/91-checklist.md`, `docs/90-roadmap.md`, `docs/superpowers/HANDOFF.md` | 수정 | 완료 반영 |

---

### Task 1: `fromDialectType` — 방언 타입 → 논리 타입

**Files:**
- Modify: `packages/core/src/dialect.ts` (`toDialectType` 바로 아래에 추가)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/dialect.test.ts`

**Interfaces:**
- Produces: `fromDialectType(sqlType: string, dialect: Dialect): FromDialectResult`
- Produces: `type FromDialectResult = { ok: true; type: LogicalType; canonical: string; alternatives: LogicalTypeKind[] } | { ok: false; raw: string }`

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/dialect.test.ts` 끝에 추가한다. 상단 import에 `fromDialectType`, `DIALECTS`, 타입들을 더한다:

```ts
import { DIALECTS, fromDialectType, toDialectType } from './dialect.js'
import type { LogicalType, LogicalTypeKind } from './logical-type.js'

/** 왕복이 깨지는 조합. 설계 문서 §2의 표와 1:1 대응한다. */
const ROUND_TRIP_LOSSES: Array<{ kind: LogicalTypeKind; dialect: Dialect; readBack: LogicalTypeKind }> = [
  { kind: 'JSON', dialect: 'oracle', readBack: 'TEXT' },
  { kind: 'DATE', dialect: 'oracle', readBack: 'DATETIME' },
  { kind: 'TIME', dialect: 'oracle', readBack: 'DATETIME' },
  { kind: 'JSON', dialect: 'mssql', readBack: 'TEXT' },
  { kind: 'UUID', dialect: 'mysql', readBack: 'CHAR' },
]

const SAMPLE: Record<LogicalTypeKind, LogicalType> = {
  CHAR: { kind: 'CHAR', length: 10 },
  VARCHAR: { kind: 'VARCHAR', length: 100 },
  DECIMAL: { kind: 'DECIMAL', precision: 12, scale: 3 },
  TEXT: { kind: 'TEXT' }, SMALLINT: { kind: 'SMALLINT' }, INT: { kind: 'INT' },
  BIGINT: { kind: 'BIGINT' }, FLOAT: { kind: 'FLOAT' }, DOUBLE: { kind: 'DOUBLE' },
  BOOLEAN: { kind: 'BOOLEAN' }, DATE: { kind: 'DATE' }, TIME: { kind: 'TIME' },
  DATETIME: { kind: 'DATETIME' }, TIMESTAMPTZ: { kind: 'TIMESTAMPTZ' },
  BLOB: { kind: 'BLOB' }, JSON: { kind: 'JSON' }, UUID: { kind: 'UUID' },
}

describe('fromDialectType', () => {
  it('손실 목록에 없는 조합은 전부 왕복하고, 목록에 있는 조합은 반드시 깨진다', () => {
    const key = (k: string, d: string) => `${k}/${d}`
    const losses = new Map(ROUND_TRIP_LOSSES.map((l) => [key(l.kind, l.dialect), l.readBack]))
    for (const dialect of DIALECTS) {
      for (const kind of Object.keys(SAMPLE) as LogicalTypeKind[]) {
        const original = SAMPLE[kind]
        const sql = toDialectType(original, dialect)
        const back = fromDialectType(sql, dialect)
        expect(back.ok, `${kind}/${dialect} → ${sql} 를 읽지 못했다`).toBe(true)
        if (!back.ok) continue
        const expected = losses.get(key(kind, dialect))
        if (expected === undefined) {
          expect(back.type, `${kind}/${dialect} → ${sql} 는 왕복해야 한다`).toEqual(original)
        } else {
          expect(back.type.kind, `${kind}/${dialect} → ${sql}`).toBe(expected)
          expect(back.type, `${kind}/${dialect} 는 손실 목록에 있으므로 왕복하면 안 된다`)
            .not.toEqual(original)
        }
      }
    }
  })

  it('oracle NUMBER를 정밀도로 갈라 읽고 DECIMAL을 대안으로 남긴다', () => {
    expect(fromDialectType('NUMBER(1)', 'oracle')).toMatchObject({ type: { kind: 'BOOLEAN' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(5)', 'oracle')).toMatchObject({ type: { kind: 'SMALLINT' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(10)', 'oracle')).toMatchObject({ type: { kind: 'INT' }, alternatives: ['DECIMAL'] })
    expect(fromDialectType('NUMBER(19)', 'oracle')).toMatchObject({ type: { kind: 'BIGINT' }, alternatives: ['DECIMAL'] })
    // 위 넷에 없는 정밀도는 모호하지 않다.
    expect(fromDialectType('NUMBER(7)', 'oracle')).toMatchObject({
      type: { kind: 'DECIMAL', precision: 7, scale: 0 }, alternatives: [],
    })
    // scale이 있으면 정수 후보가 아니다 — NUMBER(10,0)이 INT로 읽히면 안 된다.
    expect(fromDialectType('NUMBER(10,0)', 'oracle')).toMatchObject({
      type: { kind: 'DECIMAL', precision: 10, scale: 0 }, alternatives: [],
    })
  })

  it('모호한 조합에 대안을 남긴다', () => {
    expect(fromDialectType('CLOB', 'oracle')).toMatchObject({ type: { kind: 'TEXT' }, alternatives: ['JSON'] })
    expect(fromDialectType('DATE', 'oracle')).toMatchObject({ type: { kind: 'DATETIME' }, alternatives: ['DATE'] })
    expect(fromDialectType('TIMESTAMP', 'oracle')).toMatchObject({ type: { kind: 'DATETIME' }, alternatives: ['TIME'] })
    expect(fromDialectType('NVARCHAR(MAX)', 'mssql')).toMatchObject({ type: { kind: 'TEXT' }, alternatives: ['JSON'] })
    expect(fromDialectType('TINYINT(1)', 'mysql')).toMatchObject({ type: { kind: 'BOOLEAN' }, alternatives: ['SMALLINT'] })
    expect(fromDialectType('CHAR(36)', 'mysql')).toMatchObject({
      type: { kind: 'CHAR', length: 36 }, alternatives: ['UUID'],
    })
  })

  it('자동증가 축약 타입을 정수로 읽는다', () => {
    expect(fromDialectType('serial', 'postgresql')).toMatchObject({ type: { kind: 'INT' } })
    expect(fromDialectType('bigserial', 'postgresql')).toMatchObject({ type: { kind: 'BIGINT' } })
  })

  it('모르는 타입은 원문을 보존한다', () => {
    expect(fromDialectType('GEOMETRY', 'mysql')).toEqual({ ok: false, raw: 'GEOMETRY' })
    expect(fromDialectType('NUMBER', 'oracle')).toEqual({ ok: false, raw: 'NUMBER' })
  })

  it('대소문자와 공백에 관대하다', () => {
    expect(fromDialectType('  varchar( 50 )  ', 'postgresql')).toMatchObject({
      type: { kind: 'VARCHAR', length: 50 },
    })
    expect(fromDialectType('timestamp with time zone', 'postgresql')).toMatchObject({
      type: { kind: 'TIMESTAMPTZ' },
    })
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run dialect
```

Expected: FAIL — `fromDialectType is not a function`(또는 import 오류)

- [ ] **Step 3: `fromDialectType`을 구현한다**

`packages/core/src/dialect.ts`의 `toDialectType` 바로 아래(`ORACLE_WARN` 위)에 넣는다:

```ts
export type FromDialectResult =
  | { ok: true; type: LogicalType; canonical: string; alternatives: LogicalTypeKind[] }
  | { ok: false; raw: string }

type SqlTypeParts = { name: string; p1: number | null; p2: number | null; isMax: boolean }

/** 'NVARCHAR(MAX)'·'NUMBER(10,2)'·'double precision'을 이름과 파라미터로 가른다. */
function splitSqlType(sqlType: string): SqlTypeParts | null {
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:,\s*(\d+)\s*)?\))?$/i
    .exec(sqlType.trim())
  if (!m) return null
  const isMax = (m[2] ?? '').toUpperCase() === 'MAX'
  return {
    name: m[1]!.toUpperCase().replace(/\s+/g, ' '),
    p1: m[2] === undefined || isMax ? null : Number(m[2]),
    p2: m[3] === undefined ? null : Number(m[3]),
    isMax,
  }
}

const fixed = (
  kind: Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL'>,
  alternatives: LogicalTypeKind[] = [],
): FromDialectResult => ({ ok: true, type: { kind } as LogicalType, canonical: kind, alternatives })

const sized = (
  kind: 'CHAR' | 'VARCHAR', length: number, alternatives: LogicalTypeKind[] = [],
): FromDialectResult => ({ ok: true, type: { kind, length }, canonical: `${kind}(${length})`, alternatives })

const decimal = (precision: number, scale: number): FromDialectResult => ({
  ok: true, type: { kind: 'DECIMAL', precision, scale },
  canonical: `DECIMAL(${precision},${scale})`, alternatives: [],
})

// 방언별 특수 규칙. null을 돌려주면 아래의 parseLogicalType 공통 경로로 넘어간다.
function fromOracle(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'NUMBER': {
      if (t.p1 === null) return null                       // 무정밀도 NUMBER → 원문 보존
      if (t.p2 !== null) return decimal(t.p1, t.p2)         // scale이 있으면 정수 후보가 아니다
      if (t.p1 === 1) return fixed('BOOLEAN', ['DECIMAL'])
      if (t.p1 === 5) return fixed('SMALLINT', ['DECIMAL'])
      if (t.p1 === 10) return fixed('INT', ['DECIMAL'])
      if (t.p1 === 19) return fixed('BIGINT', ['DECIMAL'])
      return decimal(t.p1, 0)
    }
    // Oracle DATE는 시각을 포함한다 → DATETIME이 더 정확하다.
    case 'DATE': return fixed('DATETIME', ['DATE'])
    // 우리 매핑에서는 TIME만 TIMESTAMP로 나가지만, 실무 Oracle DDL의 TIMESTAMP는
    // 거의 항상 일시다. 실무 정확성을 택하고 TIME의 왕복을 포기한다(설계 §2).
    case 'TIMESTAMP': return fixed('DATETIME', ['TIME'])
    case 'TIMESTAMP WITH TIME ZONE': return fixed('TIMESTAMPTZ')
    case 'CLOB': case 'NCLOB': return fixed('TEXT', ['JSON'])
    case 'BINARY_FLOAT': return fixed('FLOAT')
    case 'BINARY_DOUBLE': return fixed('DOUBLE')
    case 'RAW': return t.p1 === 16 ? fixed('UUID', ['BLOB']) : fixed('BLOB')
    default: return null
  }
}

function fromMysql(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'TINYINT': return t.p1 === 1 ? fixed('BOOLEAN', ['SMALLINT']) : fixed('SMALLINT')
    case 'CHAR': return t.p1 === 36 ? sized('CHAR', 36, ['UUID']) : null
    case 'LONGTEXT': case 'MEDIUMTEXT': case 'TINYTEXT': return fixed('TEXT')
    case 'LONGBLOB': case 'MEDIUMBLOB': case 'TINYBLOB': return fixed('BLOB')
    case 'TIMESTAMP': return fixed('TIMESTAMPTZ', ['DATETIME'])
    default: return null
  }
}

function fromMssql(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'NVARCHAR': case 'VARCHAR':
      return t.isMax ? fixed('TEXT', ['JSON']) : (t.p1 === null ? null : sized('VARCHAR', t.p1))
    case 'NCHAR': return t.p1 === null ? null : sized('CHAR', t.p1)
    case 'VARBINARY': case 'IMAGE': return fixed('BLOB')
    case 'BIT': return fixed('BOOLEAN')
    case 'DATETIME': case 'DATETIME2': case 'SMALLDATETIME': return fixed('DATETIME')
    case 'DATETIMEOFFSET': return fixed('TIMESTAMPTZ')
    case 'UNIQUEIDENTIFIER': return fixed('UUID')
    case 'REAL': return fixed('FLOAT')
    // 우리 매핑에서 DOUBLE → mssql FLOAT, FLOAT → mssql REAL이다.
    case 'FLOAT': return fixed('DOUBLE', ['FLOAT'])
    case 'MONEY': case 'SMALLMONEY': return decimal(19, 4)
    default: return null
  }
}

function fromPostgres(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'JSONB': case 'JSON': return fixed('JSON')
    case 'BYTEA': return fixed('BLOB')
    case 'TIMESTAMPTZ': case 'TIMESTAMP WITH TIME ZONE': return fixed('TIMESTAMPTZ')
    case 'TIMESTAMP WITHOUT TIME ZONE': return fixed('DATETIME')
    case 'SERIAL': return fixed('INT')
    case 'BIGSERIAL': return fixed('BIGINT')
    case 'SMALLSERIAL': return fixed('SMALLINT')
    case 'REAL': return fixed('FLOAT')
    case 'CHARACTER VARYING': return t.p1 === null ? fixed('TEXT') : sized('VARCHAR', t.p1)
    default: return null
  }
}

/**
 * toDialectType의 역함수. alternatives가 비어 있지 않으면 모호하게 해석한 것이다.
 * ⚠️ toDialectType·FIXED를 고치면 이 함수도 함께 고쳐야 한다 — 그래서 같은 파일에 둔다.
 */
export function fromDialectType(sqlType: string, dialect: Dialect): FromDialectResult {
  const raw = sqlType.trim()
  const parts = splitSqlType(raw)
  if (parts) {
    const special =
      dialect === 'oracle' ? fromOracle(parts)
      : dialect === 'mysql' ? fromMysql(parts)
      : dialect === 'mssql' ? fromMssql(parts)
      : fromPostgres(parts)
    if (special) return special
  }
  // 공통 경로: VARCHAR2·INTEGER·NUMERIC·BOOL 같은 별칭은 parseLogicalType이 이미 안다.
  const parsed = parseLogicalType(raw)
  if (!parsed.ok) return { ok: false, raw }
  return { ok: true, type: parsed.type, canonical: parsed.canonical, alternatives: [] }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run dialect
```

Expected: PASS

- [ ] **Step 5: core index에 export를 더한다**

`packages/core/src/index.ts`에서 `dialect.js` export 줄을 찾아 `fromDialectType`과 `FromDialectResult`를 더한다. 기존 줄의 형태를 그대로 따르되 값과 타입을 분리한다(`export { … } from` / `export type { … } from`).

- [ ] **Step 6: 역검증 — 손실 목록이 실제로 구분력이 있는지 확인한다**

`ROUND_TRIP_LOSSES`에서 `{ kind: 'DATE', dialect: 'oracle', readBack: 'DATETIME' }` 한 줄을 임시로 지우고 테스트를 돌린다.

```bash
pnpm -C packages/core exec vitest run dialect
```

Expected: FAIL — `DATE/oracle → DATE 는 왕복해야 한다`. 확인 후 되돌린다.

이어서 `fromOracle`의 `case 'CLOB'`을 `fixed('JSON', ['TEXT'])`로 바꿔 돌린다.

Expected: FAIL — `TEXT/oracle`이 왕복하지 못하고, `JSON/oracle`은 손실 목록에 있는데 왕복해버린다(양쪽 다 잡혀야 한다). 확인 후 되돌린다.

두 결과를 보고서에 적는다.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/dialect.ts packages/core/src/dialect.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): 방언 타입 → 논리 타입 역매핑

toDialectType의 역함수를 같은 파일에 둔다. 매핑이 단사가 아니므로 모호한
조합은 보수적 기본값을 고르고 대안을 alternatives에 남긴다.

왕복 테스트는 손실 목록(5건)에 없는 조합이 깨질 때뿐 아니라 목록에 있는
조합이 오히려 왕복할 때도 실패시켜, 매핑 변경이 어느 방향이든 드러나게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 2: `restoreLogicalName` — 물리명 → 논리명

**Files:**
- Modify: `packages/core/src/naming.ts` (`generatePhysicalName` 바로 아래에 추가)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Produces: `restoreLogicalName(physicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules): RestoreLogicalResult`
- Produces: `type RestoreLogicalResult = { ok: true; logicalName: string } | { ok: false; unknownTokens: string[] }`

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/naming.test.ts` 끝에 추가한다. 파일에 이미 있는 픽스처(단어·용어 만드는 헬퍼)가 있으면 그것을 쓰고, 없으면 아래처럼 만든다:

```ts
import { DEFAULT_NAMING_RULES, generatePhysicalName, restoreLogicalName } from './naming.js'
import type { Term, Word } from './model.js'

const word = (id: string, logicalName: string, abbreviation: string): Word => ({
  id, logicalName, abbreviation, englishName: null, description: null, origin: null,
})
const term = (id: string, logicalName: string, physicalName: string): Term => ({
  id, logicalName, physicalName, domainId: null, description: null, origin: null,
})

const WORDS: Record<string, Word> = {
  w1: word('w1', '회원', 'MBR'),
  w2: word('w2', '번호', 'NO'),
  w3: word('w3', '주문', 'ORD'),
}
const TERMS: Record<string, Term> = {
  t1: term('t1', '회원식별번호', 'MBR_ID'),
}

describe('restoreLogicalName', () => {
  it('용어 물리명이 통째로 일치하면 단어 분해보다 우선한다', () => {
    expect(restoreLogicalName('MBR_ID', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원식별번호' })
  })

  it('모든 토큰이 매칭되면 논리명을 이어붙인다', () => {
    expect(restoreLogicalName('MBR_NO', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원번호' })
  })

  it('한 토큰이라도 실패하면 논리명을 만들지 않고 미매칭 토큰을 돌려준다', () => {
    expect(restoreLogicalName('MBR_NO_SEQ', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, unknownTokens: ['SEQ'] })
  })

  it('대소문자를 무시하고 매칭한다', () => {
    expect(restoreLogicalName('mbr_no', WORDS, TERMS, DEFAULT_NAMING_RULES))
      .toEqual({ ok: true, logicalName: '회원번호' })
  })

  it('구분자가 없는 규칙에서는 최장일치로 쪼갠다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, separator: '' as const }
    expect(restoreLogicalName('MBRNO', WORDS, TERMS, rules))
      .toEqual({ ok: true, logicalName: '회원번호' })
    expect(restoreLogicalName('MBRXNO', WORDS, TERMS, rules))
      .toEqual({ ok: false, unknownTokens: ['X'] })
  })

  it('빈 사전에서는 언제나 실패한다', () => {
    expect(restoreLogicalName('MBR_NO', {}, {}, DEFAULT_NAMING_RULES))
      .toEqual({ ok: false, unknownTokens: ['MBR', 'NO'] })
  })

  it('왕복 — generatePhysicalName이 만든 물리명을 원래 논리명으로 되돌린다', () => {
    for (const logical of ['회원번호', '주문번호', '회원식별번호']) {
      const gen = generatePhysicalName(logical, WORDS, TERMS, DEFAULT_NAMING_RULES)
      expect(gen.unknownWords, `${logical} 은 사전으로 완전히 분해돼야 한다`).toEqual([])
      expect(restoreLogicalName(gen.physicalName, WORDS, TERMS, DEFAULT_NAMING_RULES))
        .toEqual({ ok: true, logicalName: logical })
    }
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run naming
```

Expected: FAIL — `restoreLogicalName is not a function`

- [ ] **Step 3: `restoreLogicalName`을 구현한다**

`packages/core/src/naming.ts`의 `generatePhysicalName` 바로 아래에 넣는다:

```ts
export type RestoreLogicalResult =
  | { ok: true; logicalName: string }
  | { ok: false; unknownTokens: string[] }

/** 약어(대문자) → 단어. 같은 약어를 가진 단어가 여럿이면 id가 작은 쪽으로 결정론적으로 고른다. */
function abbreviationIndex(words: Record<string, Word>): Map<string, Word> {
  const index = new Map<string, Word>()
  for (const w of Object.values(words).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = w.abbreviation.trim().toUpperCase()
    if (key !== '' && !index.has(key)) index.set(key, w)
  }
  return index
}

/**
 * generatePhysicalName의 역함수. 모든 토큰이 매칭될 때만 ok:true.
 * ⚠️ generatePhysicalName의 분해 규칙을 고치면 이 함수도 함께 고쳐야 한다 — 그래서 같은 파일에 둔다.
 */
export function restoreLogicalName(
  physicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): RestoreLogicalResult {
  const name = physicalName.trim()
  if (name === '') return { ok: false, unknownTokens: [] }

  // 1) 용어 물리명 완전일치 — generatePhysicalName의 1단계와 대칭
  const upper = name.toUpperCase()
  const term = Object.values(terms).find((t) => t.physicalName.trim().toUpperCase() === upper)
  if (term) return { ok: true, logicalName: term.logicalName }

  const index = abbreviationIndex(words)

  // 2-a) 구분자가 있으면 쪼개서 토큰별로 정확히 맞춘다
  if (rules.separator !== '') {
    const tokens = name.split(rules.separator).filter((t) => t !== '')
    if (tokens.length === 0) return { ok: false, unknownTokens: [] }
    const unknownTokens = tokens.filter((t) => !index.has(t.toUpperCase()))
    if (unknownTokens.length > 0) return { ok: false, unknownTokens }
    return { ok: true, logicalName: tokens.map((t) => index.get(t.toUpperCase())!.logicalName).join('') }
  }

  // 2-b) 구분자가 없으면 최장일치 그리디 — decomposeByWords의 약어판
  const byLen = [...index.entries()].sort((a, b) => b[0].length - a[0].length)
  const parts: string[] = []
  const unknownTokens: string[] = []
  let i = 0
  let pending = ''
  while (i < upper.length) {
    const hit = byLen.find(([abbr]) => upper.startsWith(abbr, i))
    if (hit) {
      if (pending) { unknownTokens.push(pending); pending = '' }
      parts.push(hit[1].logicalName)
      i += hit[0].length
    } else {
      pending += upper[i]!; i += 1
    }
  }
  if (pending) unknownTokens.push(pending)
  if (unknownTokens.length > 0) return { ok: false, unknownTokens }
  return { ok: true, logicalName: parts.join('') }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run naming
```

Expected: PASS

- [ ] **Step 5: core index에 export를 더한다**

`packages/core/src/index.ts`의 `naming.js` export 줄에 `restoreLogicalName`(값)과 `RestoreLogicalResult`(타입)를 더한다.

- [ ] **Step 6: 역검증**

`restoreLogicalName`의 용어 완전일치 블록(1단계) 세 줄을 임시로 주석 처리하고 돌린다.

```bash
pnpm -C packages/core exec vitest run naming
```

Expected: FAIL — `'MBR_ID'`가 `회원식별번호` 대신 실패하거나 다른 값이 된다. 확인 후 되돌리고 결과를 보고서에 적는다.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): 물리명 → 논리명 역매칭

generatePhysicalName의 역함수를 같은 파일에 둔다. 용어 완전일치를 먼저 보고,
아니면 명명 규칙으로 토큰을 나눠 단어 약어와 맞춘다. 모든 토큰이 매칭될
때만 논리명을 제안해 한글·영문이 섞인 반쪽짜리 논리명을 만들지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 3: 파서 기반 — 주석 제거·문장 분리·식별자·방언 감지

이 태스크는 파서의 뼈대만 만든다. `CREATE TABLE` 본문 해석은 Task 4, 나머지 문장은 Task 5다.

**Files:**
- Create: `packages/core/src/ddl-parse.ts`
- Create: `packages/core/src/ddl-parse.test.ts`

**Interfaces:**
- Produces: 아래 타입 전부와 `detectDialect(ddl: string): Dialect | null`, `parseDdl(ddl: string): ParsedDdl`
- Produces(내부, Task 4·5가 쓴다): `splitStatements(ddl: string): RawStatement[]`, `unquoteIdentifier(raw: string): string`

- [ ] **Step 1: 타입과 실패 테스트를 쓴다**

`packages/core/src/ddl-parse.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { detectDialect, parseDdl, splitStatements, unquoteIdentifier } from './ddl-parse.js'

describe('splitStatements', () => {
  it('세미콜론으로 나누고 각 문장의 시작 줄 번호를 남긴다', () => {
    const s = splitStatements('CREATE TABLE A (X INT);\nCREATE TABLE B (Y INT);')
    expect(s).toHaveLength(2)
    expect(s[0]!.line).toBe(1)
    expect(s[1]!.line).toBe(2)
  })

  it('줄 주석과 블록 주석을 제거하되 줄 번호는 유지한다', () => {
    const s = splitStatements('-- 머리말\n/* 블록\n   주석 */\nCREATE TABLE A (X INT);')
    expect(s).toHaveLength(1)
    expect(s[0]!.text).toContain('CREATE TABLE A')
    expect(s[0]!.line).toBe(4)
  })

  it('문자열 리터럴 안의 세미콜론·주석 기호로 나누지 않는다', () => {
    const s = splitStatements("COMMENT ON TABLE A IS 'a;b -- c';\nCREATE TABLE B (Y INT);")
    expect(s).toHaveLength(2)
    expect(s[0]!.text).toContain("'a;b -- c'")
  })

  it('문자열 안의 작은따옴표 이스케이프를 문자열의 일부로 본다', () => {
    const s = splitStatements("COMMENT ON TABLE A IS 'it''s; ok';\nCREATE TABLE B (Y INT);")
    expect(s).toHaveLength(2)
  })

  it('Oracle 스크립트의 / 구분자로도 나눈다', () => {
    const s = splitStatements('CREATE TABLE A (X INT)\n/\nCREATE TABLE B (Y INT)\n/')
    expect(s).toHaveLength(2)
  })

  it('빈 문장을 버린다', () => {
    expect(splitStatements(';;\n  \n;')).toEqual([])
  })
})

describe('unquoteIdentifier', () => {
  it('방언별 따옴표를 벗긴다', () => {
    expect(unquoteIdentifier('"MBR"')).toBe('MBR')
    expect(unquoteIdentifier('`MBR`')).toBe('MBR')
    expect(unquoteIdentifier('[MBR]')).toBe('MBR')
    expect(unquoteIdentifier('MBR')).toBe('MBR')
  })

  it('스키마 접두사를 떼고 마지막 조각만 남긴다', () => {
    expect(unquoteIdentifier('public.MBR')).toBe('MBR')
    expect(unquoteIdentifier('"public"."MBR"')).toBe('MBR')
    expect(unquoteIdentifier('[dbo].[MBR]')).toBe('MBR')
    expect(unquoteIdentifier('SCOTT.MBR')).toBe('MBR')
  })

  it('따옴표 안의 점은 구분자가 아니다', () => {
    expect(unquoteIdentifier('"a.b"')).toBe('a.b')
  })

  it('이스케이프된 따옴표를 되돌린다', () => {
    expect(unquoteIdentifier('"a""b"')).toBe('a"b')
  })
})

describe('detectDialect', () => {
  it('특징 토큰으로 방언을 맞힌다', () => {
    expect(detectDialect('CREATE TABLE `a` (id INT AUTO_INCREMENT);')).toBe('mysql')
    expect(detectDialect('CREATE TABLE a (id NUMBER(10), nm VARCHAR2(10), memo CLOB);')).toBe('oracle')
    expect(detectDialect('CREATE TABLE [a] ([id] INT IDENTITY(1,1), nm NVARCHAR(10));')).toBe('mssql')
    expect(detectDialect('CREATE TABLE a (id serial, doc jsonb, at timestamptz);')).toBe('postgresql')
  })

  it('근거가 없으면 null을 준다', () => {
    expect(detectDialect('CREATE TABLE a (id INT, nm VARCHAR(10));')).toBeNull()
  })
})

describe('parseDdl', () => {
  it('인식하지 못한 문장을 skipped에 키워드·줄 번호와 함께 남긴다', () => {
    const r = parseDdl('GRANT SELECT ON a TO b;\nCREATE SEQUENCE s;')
    expect(r.skipped.map((s) => s.keyword)).toEqual(['GRANT', 'CREATE SEQUENCE'])
    expect(r.skipped[0]!.line).toBe(1)
    expect(r.skipped[1]!.line).toBe(2)
    expect(r.skipped[0]!.excerpt).toContain('GRANT SELECT')
  })

  it('빈 입력에서 빈 결과를 준다', () => {
    expect(parseDdl('')).toEqual({
      tables: [], constraints: [], indexes: [], comments: [], skipped: [],
    })
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 3: 타입과 뼈대를 만든다**

`packages/core/src/ddl-parse.ts` 생성:

```ts
import type { Dialect } from './dialect.js'

export type ParsedColumn = {
  name: string
  rawType: string              // 원문 그대로. 예: 'NUMBER(10)', 'VARCHAR2(100)'
  notNull: boolean
  defaultValue: string | null
  autoIncrement: boolean
  inlinePk: boolean
  comment: string | null       // MySQL 인라인 COMMENT
}
export type ParsedTable = { name: string; columns: ParsedColumn[] }
export type ParsedConstraint =
  | { kind: 'pk'; table: string; columns: string[] }
  | { kind: 'unique'; table: string; name: string | null; columns: string[] }
  | { kind: 'fk'; table: string; name: string | null; columns: string[]
      refTable: string; refColumns: string[] }
export type ParsedIndex = { table: string; name: string; columns: string[]; unique: boolean }
export type ParsedComment = { table: string; column: string | null; text: string }
export type SkippedStatement = { keyword: string; line: number; excerpt: string }

export type ParsedDdl = {
  tables: ParsedTable[]
  constraints: ParsedConstraint[]
  indexes: ParsedIndex[]
  comments: ParsedComment[]
  skipped: SkippedStatement[]
}

/** 주석을 걷어낸 한 문장과 원문에서의 시작 줄 번호(1-based). */
export type RawStatement = { text: string; line: number }
```

이어서 `splitStatements`를 넣는다. **문자 단위 상태 기계**로 쓴다(정규식으로는 문자열 리터럴 안의 세미콜론을 못 피한다):

```ts
/**
 * 주석을 제거하고 문장을 나눈다. 문자열 리터럴('…', 이스케이프 '')과 따옴표 식별자
 * ("…", `…`, […]) 안에서는 어떤 구분자·주석 기호도 해석하지 않는다.
 * 줄 번호는 원문 기준이므로 주석을 지워도 어긋나지 않는다.
 */
export function splitStatements(ddl: string): RawStatement[] {
  const out: RawStatement[] = []
  let buf = ''
  let line = 1
  let startLine = 1
  let started = false

  const flush = () => {
    const text = buf.trim()
    if (text !== '') out.push({ text, line: startLine })
    buf = ''
    started = false
  }

  for (let i = 0; i < ddl.length; i++) {
    const c = ddl[i]!
    const next = ddl[i + 1]

    if (c === '\n') { line += 1; buf += c; continue }

    // 줄 주석
    if (c === '-' && next === '-') {
      while (i < ddl.length && ddl[i] !== '\n') i++
      i--
      continue
    }
    // 블록 주석
    if (c === '/' && next === '*') {
      i += 2
      while (i < ddl.length && !(ddl[i] === '*' && ddl[i + 1] === '/')) {
        if (ddl[i] === '\n') line += 1
        i++
      }
      i += 1
      continue
    }
    // 문자열 리터럴 — '' 이스케이프 포함
    if (c === "'") {
      if (!started) { startLine = line; started = true }
      buf += c
      i++
      while (i < ddl.length) {
        if (ddl[i] === "'" && ddl[i + 1] === "'") { buf += "''"; i += 2; continue }
        if (ddl[i] === "'") { buf += "'"; break }
        if (ddl[i] === '\n') line += 1
        buf += ddl[i]!
        i++
      }
      continue
    }
    // 따옴표 식별자 — 내용은 그대로 실어 보낸다(해제는 unquoteIdentifier가 한다)
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      if (!started) { startLine = line; started = true }
      buf += c
      i++
      while (i < ddl.length) {
        if (ddl[i] === close && ddl[i + 1] === close) { buf += close + close; i += 2; continue }
        if (ddl[i] === close) { buf += close; break }
        if (ddl[i] === '\n') line += 1
        buf += ddl[i]!
        i++
      }
      continue
    }
    // 구분자
    if (c === ';') { flush(); continue }
    // Oracle 스크립트의 / — 줄에 그것만 있을 때만 구분자다
    if (c === '/' && /(^|\n)[ \t]*$/.test(buf.slice(-40)) && /^[ \t]*(\n|$)/.test(ddl.slice(i + 1))) {
      flush(); continue
    }

    if (!started && c.trim() !== '') { startLine = line; started = true }
    buf += c
  }
  flush()
  return out
}
```

그리고 `unquoteIdentifier`:

```ts
/** 스키마 접두사를 떼고 따옴표를 벗긴다. 따옴표 안의 점은 구분자가 아니다. */
export function unquoteIdentifier(raw: string): string {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < raw.length) {
        if (raw[i] === close && raw[i + 1] === close) { cur += close; i += 2; continue }
        if (raw[i] === close) break
        cur += raw[i]!
        i++
      }
      continue
    }
    if (c === '.') { parts.push(cur); cur = ''; continue }
    cur += c
  }
  parts.push(cur)
  return parts[parts.length - 1]!.trim()
}
```

`detectDialect`는 특징 토큰 점수제:

```ts
const SIGNATURES: Array<{ dialect: Dialect; pattern: RegExp; weight: number }> = [
  { dialect: 'mysql', pattern: /\bAUTO_INCREMENT\b/i, weight: 3 },
  { dialect: 'mysql', pattern: /`/, weight: 2 },
  { dialect: 'mysql', pattern: /\bENGINE\s*=/i, weight: 2 },
  { dialect: 'mysql', pattern: /\b(LONGTEXT|LONGBLOB|TINYINT)\b/i, weight: 2 },
  { dialect: 'oracle', pattern: /\bVARCHAR2\b/i, weight: 3 },
  { dialect: 'oracle', pattern: /\bNUMBER\s*\(/i, weight: 2 },
  { dialect: 'oracle', pattern: /\b(CLOB|NCLOB|BINARY_DOUBLE|BINARY_FLOAT)\b/i, weight: 2 },
  { dialect: 'mssql', pattern: /\bIDENTITY\s*\(/i, weight: 3 },
  { dialect: 'mssql', pattern: /\[[A-Za-z_]/, weight: 2 },
  { dialect: 'mssql', pattern: /\b(NVARCHAR|UNIQUEIDENTIFIER|DATETIME2|DATETIMEOFFSET)\b/i, weight: 2 },
  { dialect: 'postgresql', pattern: /\b(BIGSERIAL|SMALLSERIAL|SERIAL)\b/i, weight: 3 },
  { dialect: 'postgresql', pattern: /\b(JSONB|TIMESTAMPTZ|BYTEA)\b/i, weight: 3 },
]

/** 특징 토큰 점수제. 1등이 없거나 동점이면 null(사용자가 고른다). */
export function detectDialect(ddl: string): Dialect | null {
  const score: Record<Dialect, number> = { postgresql: 0, mysql: 0, oracle: 0, mssql: 0 }
  for (const s of SIGNATURES) if (s.pattern.test(ddl)) score[s.dialect] += s.weight
  const ranked = (Object.entries(score) as Array<[Dialect, number]>)
    .sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top || top[1] === 0) return null
  if (second && second[1] === top[1]) return null
  return top[0]
}
```

마지막으로 `parseDdl`의 뼈대. 이 태스크에서는 **모든 문장을 skipped로 보낸다**. Task 4·5가 분기를 채운다:

```ts
/** 문장 앞머리에서 skipped에 남길 키워드를 뽑는다. */
function statementKeyword(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().toUpperCase()
  const two = /^(CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX|SEQUENCE|VIEW|TRIGGER|PROCEDURE|FUNCTION)|ALTER\s+TABLE|COMMENT\s+ON)\b/
    .exec(t)
  if (two) return two[1]!.replace(/\s+/g, ' ')
  return (/^[A-Z_]+/.exec(t)?.[0]) ?? '?'
}

export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = { tables: [], constraints: [], indexes: [], comments: [], skipped: [] }
  for (const stmt of splitStatements(ddl)) {
    // Task 4·5가 여기에 분기를 채운다.
    result.skipped.push({
      keyword: statementKeyword(stmt.text),
      line: stmt.line,
      excerpt: stmt.text.replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return result
}
```

**`parseDdl`은 방언 인자를 받지 않는다.** 따옴표 세 종류(`"` `` ` `` `[`)를 모두 처리하고 자동증가 패턴도 한꺼번에 보므로 파싱 자체는 방언과 무관하다. 방언이 필요한 곳은 타입 매핑뿐이고 그것은 `planDdlImport`에서 일어난다. 방언 감지는 별도 함수(`detectDialect`)다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/ddl-parse.ts packages/core/src/ddl-parse.test.ts
git commit -m "$(cat <<'EOF'
feat(core): DDL 파서 뼈대 — 주석·문장 분리·식별자·방언 감지

문자 단위 상태 기계로 주석을 걷고 문장을 나눈다. 문자열 리터럴과 따옴표
식별자 안에서는 구분자를 해석하지 않는다(정규식으로는 못 피하는 지점).
줄 번호는 원문 기준으로 유지해 건너뛴 문장을 사용자가 찾을 수 있게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 4: `CREATE TABLE` 파싱

**Files:**
- Modify: `packages/core/src/ddl-parse.ts`
- Test: `packages/core/src/ddl-parse.test.ts`

**Interfaces:**
- Consumes: `splitStatements`, `unquoteIdentifier`, `ParsedTable`·`ParsedColumn`·`ParsedConstraint`(Task 3)
- Produces: `parseDdl`이 `CREATE TABLE`을 `tables`와 `constraints`로 채운다

- [ ] **Step 1: 실패 테스트를 쓴다**

`ddl-parse.test.ts`에 추가:

```ts
describe('parseDdl — CREATE TABLE', () => {
  it('컬럼의 타입·NOT NULL·DEFAULT를 읽는다', () => {
    const r = parseDdl(`
      CREATE TABLE MBR (
        MBR_NO bigint NOT NULL,
        MBR_NM varchar(100),
        REG_DT timestamp DEFAULT now(),
        PRIMARY KEY (MBR_NO)
      );`)
    expect(r.tables).toHaveLength(1)
    const t = r.tables[0]!
    expect(t.name).toBe('MBR')
    expect(t.columns.map((c) => c.name)).toEqual(['MBR_NO', 'MBR_NM', 'REG_DT'])
    expect(t.columns[0]).toMatchObject({ rawType: 'bigint', notNull: true, defaultValue: null })
    expect(t.columns[1]).toMatchObject({ rawType: 'varchar(100)', notNull: false })
    expect(t.columns[2]!.defaultValue).toBe('now()')
    expect(r.constraints).toContainEqual({ kind: 'pk', table: 'MBR', columns: ['MBR_NO'] })
  })

  it('인라인 PRIMARY KEY를 컬럼에 표시한다', () => {
    const r = parseDdl('CREATE TABLE A (ID bigint PRIMARY KEY, NM varchar(10));')
    expect(r.tables[0]!.columns[0]!.inlinePk).toBe(true)
    expect(r.tables[0]!.columns[1]!.inlinePk).toBe(false)
  })

  it('방언별 자동증가를 인식한다', () => {
    expect(parseDdl('CREATE TABLE A (ID INT AUTO_INCREMENT);')
      .tables[0]!.columns[0]!.autoIncrement).toBe(true)
    expect(parseDdl('CREATE TABLE A (ID INT IDENTITY(1,1));')
      .tables[0]!.columns[0]!.autoIncrement).toBe(true)
    expect(parseDdl('CREATE TABLE A (ID bigint GENERATED BY DEFAULT AS IDENTITY);')
      .tables[0]!.columns[0]!.autoIncrement).toBe(true)
    expect(parseDdl('CREATE TABLE A (ID serial);')
      .tables[0]!.columns[0]!.autoIncrement).toBe(true)
  })

  it('테이블 수준 UNIQUE·FOREIGN KEY를 제약으로 뽑는다', () => {
    const r = parseDdl(`
      CREATE TABLE ORD (
        ORD_NO bigint NOT NULL,
        MBR_NO bigint NOT NULL,
        CONSTRAINT PK_ORD PRIMARY KEY (ORD_NO),
        CONSTRAINT UX_ORD_01 UNIQUE (MBR_NO, ORD_NO),
        CONSTRAINT FK_ORD_MBR FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
      );`)
    expect(r.constraints).toContainEqual({ kind: 'pk', table: 'ORD', columns: ['ORD_NO'] })
    expect(r.constraints).toContainEqual({
      kind: 'unique', table: 'ORD', name: 'UX_ORD_01', columns: ['MBR_NO', 'ORD_NO'],
    })
    expect(r.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: 'FK_ORD_MBR',
      columns: ['MBR_NO'], refTable: 'MBR', refColumns: ['MBR_NO'],
    })
  })

  it('인라인 REFERENCES를 FK 제약으로 만든다', () => {
    const r = parseDdl('CREATE TABLE ORD (MBR_NO bigint REFERENCES MBR (MBR_NO));')
    expect(r.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: null,
      columns: ['MBR_NO'], refTable: 'MBR', refColumns: ['MBR_NO'],
    })
  })

  it('따옴표 식별자와 스키마 접두사를 벗긴다', () => {
    const r = parseDdl('CREATE TABLE "public"."MBR" ("MBR NO" bigint);')
    expect(r.tables[0]!.name).toBe('MBR')
    expect(r.tables[0]!.columns[0]!.name).toBe('MBR NO')
  })

  it('MySQL 인라인 COMMENT를 컬럼에 담는다', () => {
    const r = parseDdl("CREATE TABLE A (ID INT COMMENT '회원번호 - 식별자') ENGINE=InnoDB;")
    expect(r.tables[0]!.columns[0]!.comment).toBe('회원번호 - 식별자')
  })

  it('CHECK 제약을 건너뛰고 경고한다', () => {
    const r = parseDdl("CREATE TABLE A (ST varchar(2), CHECK (ST IN ('01','02')));")
    expect(r.tables[0]!.columns.map((c) => c.name)).toEqual(['ST'])
    expect(r.skipped.some((s) => s.keyword === 'CHECK')).toBe(true)
  })

  it('컬럼 타입의 괄호 안 쉼표에 속지 않는다', () => {
    const r = parseDdl('CREATE TABLE A (AMT numeric(12,3), NM varchar(10));')
    expect(r.tables[0]!.columns.map((c) => c.rawType)).toEqual(['numeric(12,3)', 'varchar(10)'])
  })

  it('꼬리 절(테이블스페이스·ENGINE·파티션)을 건너뛴다', () => {
    const r = parseDdl('CREATE TABLE A (ID INT) TABLESPACE users;')
    expect(r.tables[0]!.columns.map((c) => c.name)).toEqual(['ID'])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: FAIL — `r.tables`가 비어 있다(모든 문장이 skipped로 간다)

- [ ] **Step 3: `CREATE TABLE` 분기를 구현한다**

`ddl-parse.ts`에 다음을 더하고 `parseDdl`의 루프에서 `CREATE TABLE`이면 이 경로로 보낸다.

핵심 도구 — **괄호 깊이를 세며 최상위 쉼표로 나누는 분할기**. 타입의 `numeric(12,3)`과 제약의 `(A, B)`를 구분하려면 이것이 필요하다:

```ts
/** 괄호 깊이 0의 쉼표로만 나눈다. 문자열 리터럴·따옴표 식별자 안은 건너뛴다. */
function splitTopLevel(body: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      cur += c; i++
      while (i < body.length) {
        if (body[i] === close && body[i + 1] === close) { cur += close + close; i += 2; continue }
        cur += body[i]!
        if (body[i] === close) break
        i++
      }
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** '(A, B)' 같은 괄호 목록을 식별자 배열로. */
function identifierList(inner: string): string[] {
  return splitTopLevel(inner).map((s) => unquoteIdentifier(s.replace(/\s+(ASC|DESC)$/i, '').trim()))
}

/** 문자열의 첫 최상위 괄호 쌍의 내용과 그 뒤 꼬리를 돌려준다. */
function firstParenGroup(text: string): { inner: string; tail: string } | null {
  const start = text.indexOf('(')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < text.length && text[i] !== close) i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return { inner: text.slice(start + 1, i), tail: text.slice(i + 1) }
    }
  }
  return null
}
```

컬럼 한 줄 파싱. **타입은 이름 다음의 토큰 하나 + 뒤따르는 괄호**로 잡고, 나머지는 속성 키워드로 훑는다:

```ts
const AUTO_INCREMENT_PATTERNS = [
  /\bAUTO_INCREMENT\b/i,                   // mysql
  /\bIDENTITY\b/i,                         // mssql, oracle
  /\bGENERATED\s+(BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY\b/i,
]
const SERIAL_TYPES = /^(SERIAL|BIGSERIAL|SMALLSERIAL)$/i

function parseColumnDef(def: string): ParsedColumn | null {
  const nameMatch = /^\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s*(.*)$/s
    .exec(def)
  if (!nameMatch) return null
  const name = unquoteIdentifier(nameMatch[1]!)
  const rest = nameMatch[2]!.trim()
  if (rest === '') return null

  // 타입 = 첫 토큰(공백 허용 조합 포함) + 선택적 괄호
  const typeMatch = /^((?:DOUBLE\s+PRECISION|CHARACTER\s+VARYING|TIMESTAMP\s+WITH(?:OUT)?\s+TIME\s+ZONE|[A-Za-z_][\w$]*)\s*(?:\([^)]*\))?)/i
    .exec(rest)
  if (!typeMatch) return null
  const rawType = typeMatch[1]!.replace(/\s+/g, ' ').trim()
  const attrs = rest.slice(typeMatch[0].length)

  const defaultMatch = /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|COMMENT|COLLATE|CHECK)\b|$)/is
    .exec(attrs)
  const commentMatch = /\bCOMMENT\s+'((?:[^']|'')*)'/is.exec(attrs)

  return {
    name,
    rawType,
    notNull: /\bNOT\s+NULL\b/i.test(attrs) || /\bPRIMARY\s+KEY\b/i.test(attrs),
    defaultValue: defaultMatch ? defaultMatch[1]!.trim() : null,
    autoIncrement: AUTO_INCREMENT_PATTERNS.some((p) => p.test(attrs)) || SERIAL_TYPES.test(rawType),
    inlinePk: /\bPRIMARY\s+KEY\b/i.test(attrs),
    comment: commentMatch ? commentMatch[1]!.replace(/''/g, "'") : null,
  }
}
```

`CREATE TABLE` 전체:

```ts
const CREATE_TABLE_RE = /^CREATE\s+(?:GLOBAL\s+TEMPORARY\s+|TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s*(?=\()/is

function parseCreateTable(
  stmt: RawStatement, out: ParsedDdl,
): boolean {
  const head = CREATE_TABLE_RE.exec(stmt.text)
  if (!head) return false
  const group = firstParenGroup(stmt.text)
  if (!group) return false
  const table = unquoteIdentifier(head[1]!.trim())
  const columns: ParsedColumn[] = []

  for (const item of splitTopLevel(group.inner)) {
    const named = /^CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s+(.*)$/is
      .exec(item)
    const constraintName = named ? unquoteIdentifier(named[1]!) : null
    const body = named ? named[2]!.trim() : item

    if (/^PRIMARY\s+KEY\b/i.test(body)) {
      const g = firstParenGroup(body)
      if (g) out.constraints.push({ kind: 'pk', table, columns: identifierList(g.inner) })
      continue
    }
    if (/^UNIQUE\b/i.test(body)) {
      const g = firstParenGroup(body)
      if (g) out.constraints.push({ kind: 'unique', table, name: constraintName, columns: identifierList(g.inner) })
      continue
    }
    if (/^FOREIGN\s+KEY\b/i.test(body)) {
      const cols = firstParenGroup(body)
      if (!cols) continue
      const ref = /REFERENCES\s+(.+?)\s*(\(|$)/is.exec(cols.tail)
      const refCols = firstParenGroup(cols.tail)
      if (!ref) continue
      out.constraints.push({
        kind: 'fk', table, name: constraintName,
        columns: identifierList(cols.inner),
        refTable: unquoteIdentifier(ref[1]!.trim()),
        refColumns: refCols ? identifierList(refCols.inner) : [],
      })
      continue
    }
    if (/^CHECK\b/i.test(body)) {
      out.skipped.push({ keyword: 'CHECK', line: stmt.line, excerpt: item.replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }

    const col = parseColumnDef(item)
    if (!col) {
      out.skipped.push({ keyword: '?', line: stmt.line, excerpt: item.replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }
    columns.push(col)
    if (col.inlinePk) out.constraints.push({ kind: 'pk', table, columns: [col.name] })

    // 인라인 REFERENCES
    // 컬럼 정의 한 줄에 REFERENCES는 많아야 하나다. 따옴표 식별자 때문에
    // 물리명 길이로 자르면 어긋나므로 줄 전체에서 찾는다.
    const inlineRef = /\bREFERENCES\s+(.+?)\s*\(([^)]*)\)/is.exec(item)
    if (inlineRef) {
      out.constraints.push({
        kind: 'fk', table, name: null, columns: [col.name],
        refTable: unquoteIdentifier(inlineRef[1]!.trim()),
        refColumns: identifierList(inlineRef[2]!),
      })
    }
  }

  out.tables.push({ name: table, columns })
  return true
}
```

`parseDdl`의 루프를 다음으로 바꾼다:

```ts
export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = { tables: [], constraints: [], indexes: [], comments: [], skipped: [] }
  for (const stmt of splitStatements(ddl)) {
    if (parseCreateTable(stmt, result)) continue
    // Task 5가 ALTER TABLE·CREATE INDEX·COMMENT ON 분기를 여기에 더한다.
    result.skipped.push({
      keyword: statementKeyword(stmt.text),
      line: stmt.line,
      excerpt: stmt.text.replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return result
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/ddl-parse.ts packages/core/src/ddl-parse.test.ts
git commit -m "$(cat <<'EOF'
feat(core): CREATE TABLE 파싱

괄호 깊이를 세는 최상위 분할기로 컬럼 정의와 테이블 제약을 가른다. 타입의
numeric(12,3)과 제약의 (A, B)를 같은 규칙으로 안전하게 구분한다.
인라인 PK·REFERENCES, 방언별 자동증가, MySQL 인라인 COMMENT를 읽고
CHECK는 건너뛰어 경고에 남긴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 5: `ALTER TABLE` · `CREATE INDEX` · `COMMENT ON` 파싱

**Files:**
- Modify: `packages/core/src/ddl-parse.ts`
- Test: `packages/core/src/ddl-parse.test.ts`

**Interfaces:**
- Consumes: Task 3·4의 도구 전부
- Produces: `parseDdl`이 `constraints`·`indexes`·`comments`를 완성한다

- [ ] **Step 1: 실패 테스트를 쓴다**

`ddl-parse.test.ts`에 추가:

```ts
describe('parseDdl — 나머지 문장', () => {
  it('ALTER TABLE ADD CONSTRAINT로 분리된 PK·UNIQUE·FK를 잡는다', () => {
    const r = parseDdl(`
      ALTER TABLE MBR ADD CONSTRAINT PK_MBR PRIMARY KEY (MBR_NO);
      ALTER TABLE ORD ADD CONSTRAINT UX_ORD UNIQUE (ORD_NM);
      ALTER TABLE ORD ADD CONSTRAINT FK_ORD_MBR FOREIGN KEY (MBR_NO)
        REFERENCES MBR (MBR_NO) ON DELETE CASCADE;`)
    expect(r.constraints).toContainEqual({ kind: 'pk', table: 'MBR', columns: ['MBR_NO'] })
    expect(r.constraints).toContainEqual({ kind: 'unique', table: 'ORD', name: 'UX_ORD', columns: ['ORD_NM'] })
    expect(r.constraints).toContainEqual({
      kind: 'fk', table: 'ORD', name: 'FK_ORD_MBR',
      columns: ['MBR_NO'], refTable: 'MBR', refColumns: ['MBR_NO'],
    })
  })

  it('CREATE INDEX와 CREATE UNIQUE INDEX를 구분해 잡는다', () => {
    const r = parseDdl(`
      CREATE INDEX IX_MBR_01 ON MBR (MBR_NM);
      CREATE UNIQUE INDEX UX_MBR_01 ON "public"."MBR" (MBR_NM DESC, REG_DT);`)
    expect(r.indexes).toContainEqual({ table: 'MBR', name: 'IX_MBR_01', columns: ['MBR_NM'], unique: false })
    expect(r.indexes).toContainEqual({
      table: 'MBR', name: 'UX_MBR_01', columns: ['MBR_NM', 'REG_DT'], unique: true,
    })
  })

  it('COMMENT ON TABLE·COLUMN을 잡고 이스케이프를 되돌린다', () => {
    const r = parseDdl(`
      COMMENT ON TABLE MBR IS '회원';
      COMMENT ON COLUMN MBR.MBR_NO IS '회원번호 - it''s';`)
    expect(r.comments).toContainEqual({ table: 'MBR', column: null, text: '회원' })
    expect(r.comments).toContainEqual({ table: 'MBR', column: 'MBR_NO', text: "회원번호 - it's" })
  })

  it('ALTER TABLE의 인식 못 하는 형태는 건너뛴다', () => {
    const r = parseDdl('ALTER TABLE MBR ENABLE ROW MOVEMENT;')
    expect(r.constraints).toEqual([])
    expect(r.skipped.some((s) => s.keyword === 'ALTER TABLE')).toBe(true)
  })

  it('트리거·시퀀스·뷰·권한을 건너뛴다', () => {
    const r = parseDdl(`
      CREATE SEQUENCE SEQ_MBR START WITH 1;
      CREATE VIEW V_MBR AS SELECT * FROM MBR;
      GRANT SELECT ON MBR TO APP;`)
    expect(r.skipped.map((s) => s.keyword)).toEqual(['CREATE SEQUENCE', 'CREATE VIEW', 'GRANT'])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: FAIL — `constraints`·`indexes`·`comments`가 비어 있다

- [ ] **Step 3: 세 분기를 구현한다**

`ddl-parse.ts`에 추가:

```ts
const ALTER_ADD_RE = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(.+?)\s+ADD\s+(?:CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s+)?(.*)$/is

function parseAlterTable(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = ALTER_ADD_RE.exec(stmt.text)
  if (!m) return false
  const table = unquoteIdentifier(m[1]!.trim())
  const name = m[2] ? unquoteIdentifier(m[2]) : null
  const body = m[3]!.trim()

  if (/^PRIMARY\s+KEY\b/i.test(body)) {
    const g = firstParenGroup(body)
    if (!g) return false
    out.constraints.push({ kind: 'pk', table, columns: identifierList(g.inner) })
    return true
  }
  if (/^UNIQUE\b/i.test(body)) {
    const g = firstParenGroup(body)
    if (!g) return false
    out.constraints.push({ kind: 'unique', table, name, columns: identifierList(g.inner) })
    return true
  }
  if (/^FOREIGN\s+KEY\b/i.test(body)) {
    const cols = firstParenGroup(body)
    if (!cols) return false
    const ref = /REFERENCES\s+(.+?)\s*(\(|$)/is.exec(cols.tail)
    const refCols = firstParenGroup(cols.tail)
    if (!ref) return false
    out.constraints.push({
      kind: 'fk', table, name,
      columns: identifierList(cols.inner),
      refTable: unquoteIdentifier(ref[1]!.trim()),
      refColumns: refCols ? identifierList(refCols.inner) : [],
    })
    return true
  }
  return false   // CHECK·그 밖의 ADD는 skipped로 간다
}

const CREATE_INDEX_RE = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s+ON\s+(.+?)\s*(?=\()/is

function parseCreateIndex(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = CREATE_INDEX_RE.exec(stmt.text)
  if (!m) return false
  // m[0]은 lookahead로 끝나므로 여기서부터가 컬럼 목록의 여는 괄호다.
  const group = firstParenGroup(stmt.text.slice(m[0].length))
  if (!group) return false
  out.indexes.push({
    table: unquoteIdentifier(m[3]!.trim()),
    name: unquoteIdentifier(m[2]!.trim()),
    columns: identifierList(group.inner),
    unique: m[1] !== undefined,
  })
  return true
}

const COMMENT_ON_RE = /^COMMENT\s+ON\s+(TABLE|COLUMN)\s+(.+?)\s+IS\s+'((?:[^']|'')*)'/is

function parseCommentOn(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = COMMENT_ON_RE.exec(stmt.text)
  if (!m) return false
  const text = m[3]!.replace(/''/g, "'")
  const target = m[2]!.trim()
  if (m[1]!.toUpperCase() === 'TABLE') {
    out.comments.push({ table: unquoteIdentifier(target), column: null, text })
    return true
  }
  // COLUMN은 마지막 조각이 컬럼, 그 앞이 테이블이다.
  const parts = splitQualified(target)
  if (parts.length < 2) return false
  out.comments.push({
    table: parts[parts.length - 2]!, column: parts[parts.length - 1]!, text,
  })
  return true
}

/** 'a.b.c'를 따옴표를 존중하며 조각으로 나눈다(unquoteIdentifier의 다중 조각판). */
function splitQualified(raw: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < raw.length) {
        if (raw[i] === close && raw[i + 1] === close) { cur += close; i += 2; continue }
        if (raw[i] === close) break
        cur += raw[i]!; i++
      }
      continue
    }
    if (c === '.') { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  parts.push(cur.trim())
  return parts.filter((p) => p !== '')
}
```

`parseDdl`의 루프를 완성한다(`void dialect`를 지운다):

```ts
export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = { tables: [], constraints: [], indexes: [], comments: [], skipped: [] }
  for (const stmt of splitStatements(ddl)) {
    if (parseCreateTable(stmt, result)) continue
    if (parseAlterTable(stmt, result)) continue
    if (parseCreateIndex(stmt, result)) continue
    if (parseCommentOn(stmt, result)) continue
    result.skipped.push({
      keyword: statementKeyword(stmt.text),
      line: stmt.line,
      excerpt: stmt.text.replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return result
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run ddl-parse
```

Expected: PASS

- [ ] **Step 5: 전체 core 확인**

```bash
pnpm -C packages/core exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```

Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl-parse.ts packages/core/src/ddl-parse.test.ts
git commit -m "$(cat <<'EOF'
feat(core): ALTER TABLE·CREATE INDEX·COMMENT ON 파싱

분리된 제약, 인덱스, 코멘트를 읽어 파서를 완성한다. 인식하지 못한 문장은
키워드·줄 번호·발췌와 함께 skipped에 남겨 사용자가 무엇이 빠졌는지
찾을 수 있게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 6: `planDdlImport` — 계획·경고·충돌

**Files:**
- Create: `packages/core/src/ddl-import.ts`
- Create: `packages/core/src/ddl-import.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ParsedDdl`(Task 3~5), `fromDialectType`(Task 1), `restoreLogicalName`(Task 2)
- Produces: `planDdlImport(model: ProjectModel, parsed: ParsedDdl, dialect: Dialect, rules: NamingRules): DdlImportPlan`와 아래 타입 전부

**설계 문서 §5·§6의 규칙이 이 태스크의 사양이다.** 논리명은 코멘트 → 사전 → 물리명 순, 이름 충돌은 건너뛰기, PK와 컬럼이 정확히 같은 유니크 인덱스는 조용히 제외.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/ddl-import.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { parseDdl } from './ddl-parse.js'
import { planDdlImport } from './ddl-import.js'
import type { ProjectModel, Word } from './model.js'

const plan = (ddl: string, model: ProjectModel = createEmptyModel(), dialect: Dialect = 'postgresql') =>
  planDdlImport(model, parseDdl(ddl), dialect, DEFAULT_NAMING_RULES)

describe('planDdlImport', () => {
  it('테이블·컬럼·PK·관계·인덱스를 계획으로 만든다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
      CREATE TABLE ORD (
        ORD_NO bigint NOT NULL, MBR_NO bigint NOT NULL,
        PRIMARY KEY (ORD_NO),
        FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
      );
      CREATE INDEX IX_MBR_01 ON MBR (MBR_NM);`)
    expect(p.tables.map((t) => t.physicalName)).toEqual(['MBR', 'ORD'])
    expect(p.tables[0]!.columns[0]).toMatchObject({
      physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, nullable: false,
    })
    expect(p.tables[0]!.columns[1]).toMatchObject({ physicalName: 'MBR_NM', type: 'VARCHAR(100)', nullable: true })
    expect(p.tables[0]!.indexes).toEqual([{ name: 'IX_MBR_01', columnPhysicalNames: ['MBR_NM'], unique: false }])
    expect(p.relationships).toEqual([{
      childPhysicalName: 'ORD', parentPhysicalName: 'MBR',
      columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }], identifying: false,
    }])
  })

  it('자식의 FK 컬럼이 전부 자식 PK면 식별 관계다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE TABLE MBR_ROLE (
        MBR_NO bigint, ROLE_CD varchar(10),
        PRIMARY KEY (MBR_NO, ROLE_CD),
        FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
      );`)
    expect(p.relationships[0]!.identifying).toBe(true)
  })

  it('코멘트를 논리명으로 쓰고 첫 구분자에서 한 번만 쪼갠다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      COMMENT ON TABLE MBR IS '회원';
      COMMENT ON COLUMN MBR.MBR_NO IS '회원번호 - 앞 - 뒤';`)
    expect(p.tables[0]!.logicalName).toBe('회원')
    expect(p.tables[0]!.columns[0]).toMatchObject({ logicalName: '회원번호', comment: '앞 - 뒤' })
    expect(p.warnings.filter((w) => w.kind === 'unknown-word')).toEqual([])
  })

  it('구분자가 없는 코멘트는 전체가 논리명이고 설명은 null이다', () => {
    const p = plan("CREATE TABLE MBR (MBR_NO bigint);\nCOMMENT ON COLUMN MBR.MBR_NO IS '회원번호';")
    expect(p.tables[0]!.columns[0]).toMatchObject({ logicalName: '회원번호', comment: null })
  })

  it('코멘트가 없으면 사전으로 역매칭한다', () => {
    const words: Record<string, Word> = {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null },
      w2: { id: 'w2', logicalName: '번호', abbreviation: 'NO', englishName: null, description: null, origin: null },
    }
    const model = { ...createEmptyModel(), words }
    const p = plan('CREATE TABLE MBR (MBR_NO bigint);', model)
    expect(p.tables[0]!.columns[0]!.logicalName).toBe('회원번호')
  })

  it('코멘트도 사전도 없으면 물리명을 논리명으로 두고 경고한다', () => {
    const p = plan('CREATE TABLE MBR (MBR_NO bigint);')
    expect(p.tables[0]!.columns[0]!.logicalName).toBe('MBR_NO')
    expect(p.warnings.some((w) => w.kind === 'unknown-word' && w.target === 'MBR.MBR_NO')).toBe(true)
  })

  it('이름이 겹치는 테이블을 건너뛰고 그 테이블을 참조하는 FK도 뺀다', () => {
    const model = createEmptyModel()
    model.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      CREATE TABLE ORD (MBR_NO bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO));`, model)
    expect(p.skippedTables).toEqual(['MBR'])
    expect(p.tables.map((t) => t.physicalName)).toEqual(['ORD'])
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'table-conflict' && w.target === 'MBR')).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk')).toBe(true)
  })

  it('참조 대상이 없는 FK를 경고한다', () => {
    const p = plan('CREATE TABLE ORD (X bigint, FOREIGN KEY (X) REFERENCES NOPE (X));')
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk' && w.target === 'ORD')).toBe(true)
  })

  it('PK와 컬럼이 정확히 같은 유니크 인덱스는 만들지도 경고하지도 않는다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE UNIQUE INDEX PK_MBR ON MBR (MBR_NO);`)
    expect(p.tables[0]!.indexes).toEqual([])
    // 사전이 비어 unknown-word 경고는 나온다. 인덱스에 대한 경고만 없어야 한다.
    expect(p.warnings.some((w) => w.target.includes('PK_MBR'))).toBe(false)
  })

  it('PK와 겹치지만 일치하지 않는 유니크 인덱스는 만든다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, MBR_NM varchar(10), PRIMARY KEY (MBR_NO));
      CREATE UNIQUE INDEX UX_MBR ON MBR (MBR_NO, MBR_NM);`)
    expect(p.tables[0]!.indexes).toHaveLength(1)
  })

  it('모호한 타입과 인식 실패를 각각 경고한다', () => {
    const p = plan('CREATE TABLE A (C1 CLOB, C2 GEOMETRY);', createEmptyModel())
    expect(p.tables[0]!.columns[0]).toMatchObject({ type: 'TEXT' })
    expect(p.tables[0]!.columns[1]).toMatchObject({ type: 'GEOMETRY' })   // 원문 보존
    expect(p.warnings.some((w) => w.kind === 'ambiguous-type' && w.target === 'A.C1')).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'unknown-type' && w.target === 'A.C2')).toBe(true)
  })

  it('건너뛴 문장을 경고로 옮긴다', () => {
    const p = plan('GRANT SELECT ON A TO B;')
    expect(p.warnings.some((w) => w.kind === 'skipped-statement' && w.target === '1행')).toBe(true)
  })

  it('opCountEstimate가 실제 만들 엔티티 수와 맞는다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, MBR_NM varchar(10), PRIMARY KEY (MBR_NO));
      CREATE INDEX IX ON MBR (MBR_NM);`)
    // 테이블 1 + 컬럼 2 + 인덱스 1 + 관계 0
    expect(p.opCountEstimate).toBe(4)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C packages/core exec vitest run ddl-import
```

Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 3: `planDdlImport`를 구현한다**

`packages/core/src/ddl-import.ts` 생성. 타입은 설계 문서의 인터페이스 절과 동일하다:

```ts
import { fromDialectType, type Dialect } from './dialect.js'
import type { ProjectModel } from './model.js'
import { restoreLogicalName, type NamingRules } from './naming.js'
import type { ParsedDdl } from './ddl-parse.js'

export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word'
      | 'table-conflict' | 'unresolved-fk' | 'skipped-statement'
  target: string
  message: string
}
export type DdlImportColumn = {
  physicalName: string; logicalName: string; type: string
  isPk: boolean; nullable: boolean; autoIncrement: boolean
  defaultValue: string | null; comment: string | null
}
export type DdlImportTable = {
  physicalName: string; logicalName: string
  columns: DdlImportColumn[]
  indexes: Array<{ name: string; columnPhysicalNames: string[]; unique: boolean }>
}
export type DdlImportRelationship = {
  childPhysicalName: string; parentPhysicalName: string
  columnPairs: Array<{ child: string; parent: string }>
  identifying: boolean
}
export type DdlImportPlan = {
  tables: DdlImportTable[]
  relationships: DdlImportRelationship[]
  skippedTables: string[]
  warnings: DdlImportWarning[]
  opCountEstimate: number
}

/** commentText의 역 — 첫 ' - '에서 한 번만 쪼갠다. */
function splitComment(text: string): { logicalName: string; comment: string | null } {
  const i = text.indexOf(' - ')
  if (i < 0) return { logicalName: text.trim(), comment: null }
  return { logicalName: text.slice(0, i).trim(), comment: text.slice(i + 3).trim() || null }
}
```

이어서 `planDdlImport`를 구현한다:

```ts
const upper = (s: string) => s.trim().toUpperCase()
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set(a.map(upper)).size === new Set([...a, ...b].map(upper)).size

export function planDdlImport(
  model: ProjectModel, parsed: ParsedDdl, dialect: Dialect, rules: NamingRules,
): DdlImportPlan {
  const warnings: DdlImportWarning[] = []

  // 1) 이름 충돌 판정 — 살아남은 테이블만 alive에 남는다
  const existing = new Set(Object.values(model.tables).map((t) => upper(t.physicalName)))
  const skippedTables: string[] = []
  const alive = new Map<string, ParsedTable>()
  for (const t of parsed.tables) {
    if (existing.has(upper(t.name))) {
      skippedTables.push(t.name)
      warnings.push({ kind: 'table-conflict', target: t.name, message: '같은 이름의 테이블이 이미 있어 건너뜁니다' })
      continue
    }
    alive.set(upper(t.name), t)
  }

  // 2) 제약 색인 — PK는 먼저 나온 것을 쓴다(인라인 + 테이블 수준 중복 방지)
  const pkOf = new Map<string, string[]>()
  const fks: Array<Extract<ParsedConstraint, { kind: 'fk' }>> = []
  for (const c of parsed.constraints) {
    if (c.kind === 'pk') { if (!pkOf.has(upper(c.table))) pkOf.set(upper(c.table), c.columns) }
    else if (c.kind === 'fk') fks.push(c)
  }

  // 3) 코멘트 색인
  const tableComment = new Map<string, string>()
  const columnComment = new Map<string, string>()
  for (const c of parsed.comments) {
    if (c.column === null) tableComment.set(upper(c.table), c.text)
    else columnComment.set(`${upper(c.table)}.${upper(c.column)}`, c.text)
  }

  /** 코멘트 → 사전 → 물리명. target은 경고에 쓸 이름이다. */
  const resolveName = (
    physicalName: string, comment: string | undefined, target: string,
  ): { logicalName: string; comment: string | null } => {
    if (comment !== undefined && comment.trim() !== '') return splitComment(comment)
    const restored = restoreLogicalName(physicalName, model.words, model.terms, rules)
    if (restored.ok) return { logicalName: restored.logicalName, comment: null }
    warnings.push({
      kind: 'unknown-word', target,
      message: `논리명을 복원하지 못했습니다 — 사전에 없는 단어: ${restored.unknownTokens.join(', ')}`,
    })
    return { logicalName: physicalName, comment: null }
  }

  // 4) 테이블·컬럼 변환
  const tables: DdlImportTable[] = []
  for (const t of alive.values()) {
    const pkCols = new Set((pkOf.get(upper(t.name)) ?? []).map(upper))
    const named = resolveName(t.name, tableComment.get(upper(t.name)), t.name)
    const columns: DdlImportColumn[] = t.columns.map((c) => {
      const target = `${t.name}.${c.name}`
      const mapped = fromDialectType(c.rawType, dialect)
      let type: string
      if (!mapped.ok) {
        type = mapped.raw
        warnings.push({ kind: 'unknown-type', target, message: `${mapped.raw}를 알지 못해 타입을 그대로 두었습니다` })
      } else {
        type = mapped.canonical
        if (mapped.alternatives.length > 0) {
          warnings.push({
            kind: 'ambiguous-type', target,
            message: `${c.rawType}을 ${mapped.canonical}로 읽었습니다 (${mapped.alternatives.join(', ')}일 수 있습니다)`,
          })
        }
      }
      const isPk = pkCols.has(upper(c.name)) || c.inlinePk
      const colNamed = resolveName(c.name, columnComment.get(`${upper(t.name)}.${upper(c.name)}`), target)
      return {
        physicalName: c.name, logicalName: colNamed.logicalName, type,
        isPk, nullable: !c.notNull && !isPk, autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue, comment: colNamed.comment ?? c.comment,
      }
    })

    // 5) 인덱스 — PK와 컬럼이 정확히 같은 유니크 인덱스는 조용히 제외
    const pkList = pkOf.get(upper(t.name)) ?? []
    const indexes = parsed.indexes
      .filter((ix) => upper(ix.table) === upper(t.name))
      .filter((ix) => !(ix.unique && pkList.length > 0 && sameSet(ix.columns, pkList)))
      .map((ix) => ({ name: ix.name, columnPhysicalNames: ix.columns, unique: ix.unique }))

    tables.push({ physicalName: t.name, logicalName: named.logicalName, columns, indexes })
  }

  // 6) 관계 — 자식·부모가 둘 다 살아 있을 때만
  const relationships: DdlImportRelationship[] = []
  for (const fk of fks) {
    const child = alive.get(upper(fk.table))
    const parent = alive.get(upper(fk.refTable))
    if (!child || !parent || fk.columns.length !== fk.refColumns.length) {
      warnings.push({
        kind: 'unresolved-fk', target: fk.table,
        message: `참조 대상 ${fk.refTable}을 찾지 못해 관계를 만들지 않았습니다`,
      })
      continue
    }
    const childPk = pkOf.get(upper(fk.table)) ?? []
    relationships.push({
      childPhysicalName: child.name, parentPhysicalName: parent.name,
      columnPairs: fk.columns.map((c, i) => ({ child: c, parent: fk.refColumns[i]! })),
      identifying: childPk.length > 0 && sameSet(fk.columns, childPk),
    })
  }

  // 7) 건너뛴 문장
  for (const s of parsed.skipped) {
    warnings.push({
      kind: 'skipped-statement', target: `${s.line}행`,
      message: `${s.keyword} 구문을 건너뛰었습니다`,
    })
  }

  const opCountEstimate =
    tables.length
    + tables.reduce((n, t) => n + t.columns.length + t.indexes.length, 0)
    + relationships.length

  return { tables, relationships, skippedTables, warnings, opCountEstimate }
}
```

구현 순서 요약(위 코드의 주석 번호와 일치한다):

1. **충돌 판정** — `model.tables`의 물리명 집합(대소문자 무시)과 겹치는 파싱 테이블을 `skippedTables`에 넣고 `table-conflict` 경고를 만든다. 살아남은 테이블 이름 집합을 `alive`로 둔다.
2. **제약 색인** — `parsed.constraints`를 테이블별 PK 컬럼 집합, unique 목록, fk 목록으로 모은다. 같은 테이블에 PK가 여러 번 오면(인라인 + 테이블 수준) 합집합이 아니라 **먼저 나온 것**을 쓴다.
3. **컬럼 변환** — 각 컬럼에 대해
   - `fromDialectType(rawType, dialect)`; `ok:false`면 `type = raw`, `unknown-type` 경고. `alternatives`가 비어 있지 않으면 `ambiguous-type` 경고(메시지에 고른 것과 대안을 함께 적는다).
   - 논리명: 해당 컬럼의 `ParsedComment`가 있으면 `splitComment`, 없으면 `restoreLogicalName`, 그것도 실패하면 물리명 + `unknown-word` 경고.
   - `isPk` = PK 컬럼 집합에 포함. `nullable` = `!notNull && !isPk`.
4. **인덱스** — `parsed.indexes` 중 살아남은 테이블 것만. `unique`이고 컬럼 집합이 그 테이블 PK와 **정확히 같으면**(순서 무시) 제외하고 경고도 남기지 않는다.
5. **관계** — `fk` 제약 중 자식·부모가 **둘 다 `alive`**인 것만 만든다. 아니면 `unresolved-fk` 경고. `identifying`은 자식의 FK 컬럼 집합이 자식 PK 집합과 같을 때 `true`.
6. **건너뛴 문장** — `parsed.skipped`를 `skipped-statement` 경고로 옮긴다. `target`은 `` `${line}행` ``.
7. **op 추정** — `tables.length + 모든 컬럼 수 + 모든 인덱스 수 + relationships.length`.

경고 메시지는 한국어 완성 문장으로 쓴다. 예:
- `ambiguous-type`: `` `CLOB을 TEXT로 읽었습니다 (JSON일 수 있습니다)` ``
- `unknown-type`: `` `GEOMETRY를 알지 못해 타입을 그대로 두었습니다` ``
- `unknown-word`: `` `논리명을 복원하지 못했습니다 — 사전에 없는 단어: SEQ` ``
- `table-conflict`: `` `같은 이름의 테이블이 이미 있어 건너뜁니다` ``
- `unresolved-fk`: `` `참조 대상 MBR을 찾지 못해 관계를 만들지 않았습니다` ``
- `skipped-statement`: `` `CHECK 구문을 건너뛰었습니다` ``

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run ddl-import
```

Expected: PASS

- [ ] **Step 5: core 왕복 테스트를 추가한다**

`ddl-import.test.ts`에 추가한다. **픽스처는 도메인을 쓰지 않는 컬럼만 담는다**(설계 §2 — 내보내기가 도메인을 타입으로 풀어 쓰므로 DDL에 도메인 흔적이 없고, 가져오기는 `domainId`를 비운다):

```ts
import { generateDdl } from './ddl.js'
import { DIALECTS } from './dialect.js'

/** 도메인·허용값을 쓰지 않는 왕복 픽스처. */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order: 1, comment: '표시용 이름', domainId: null, custom: {},
  }
  return m
}

describe('왕복 — 내보낸 DDL을 다시 읽으면 같은 계획이 나온다', () => {
  for (const dialect of DIALECTS) {
    it(`${dialect}`, () => {
      const model = roundTripModel()
      const ddl = generateDdl(model, dialect)
      const p = planDdlImport(createEmptyModel(), parseDdl(ddl), dialect, DEFAULT_NAMING_RULES)

      expect(p.tables).toHaveLength(1)
      const t = p.tables[0]!
      expect(t.physicalName).toBe('MBR')
      expect(t.logicalName).toBe('회원')
      expect(t.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
      expect(t.columns[0]).toMatchObject({
        logicalName: '회원번호', type: 'BIGINT', isPk: true, nullable: false,
      })
      expect(t.columns[1]).toMatchObject({
        logicalName: '회원명', type: 'VARCHAR(100)', isPk: false, nullable: true,
        comment: '표시용 이름',
      })
    })
  }
})
```

- [ ] **Step 6: 왕복 테스트 통과 확인**

```bash
pnpm -C packages/core exec vitest run ddl-import
```

Expected: PASS (4방언 전부)

깨지면 **원인을 파서·계획 어느 쪽인지 밝혀 보고서에 적어라.** 위 픽스처의 두 타입(`BIGINT`·`VARCHAR(100)`)은 설계 §2의 손실 5건에 해당하지 않으므로 4방언 모두 왕복해야 한다.

- [ ] **Step 7: core index에 export를 더한다**

`packages/core/src/index.ts`에 `ddl-parse.js`와 `ddl-import.js`의 공개 심볼을 더한다(값과 타입을 분리해 기존 줄의 형태를 따른다).

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/ddl-import.ts packages/core/src/ddl-import.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): DDL 가져오기 계획 산출

파싱 결과와 현재 모델·사전으로 만들 것과 경고를 계산한다. 논리명은
코멘트 → 사전 → 물리명 순으로 복원하고, 이름이 겹치는 테이블과 그것을
참조하는 FK는 건너뛴다. PK와 컬럼이 같은 유니크 인덱스는 조용히 제외한다.

4방언 왕복 테스트로 내보내기와의 대칭을 고정한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 7: `applyDdlImport` — 계획을 모델에 적용

**Files:**
- Create: `apps/web/src/editor/ddl-import-edits.ts`
- Create: `apps/web/src/editor/ddl-import-edits.test.ts`

**Interfaces:**
- Consumes: `DdlImportPlan`(Task 6), `computeAutoLayout`(`./auto-layout.js`)
- Produces: `applyDdlImport(model: ProjectModel, plan: DdlImportPlan, newId: () => string): ProjectModel`

`newId`를 인자로 받는 것은 `applyDictImport(model, plan, mode, newId)`와 같은 관례다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/ddl-import-edits.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, parseDdl, planDdlImport, DEFAULT_NAMING_RULES } from '@erdd/core'
import { applyDdlImport } from './ddl-import-edits.js'

let seq = 0
const newId = () => `id-${++seq}`

const build = (ddl: string) => {
  seq = 0
  const model = createEmptyModel()
  const plan = planDdlImport(model, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
  return { before: model, after: applyDdlImport(model, plan, newId), plan }
}

const DDL = `
  CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
  CREATE TABLE ORD (
    ORD_NO bigint NOT NULL, MBR_NO bigint NOT NULL,
    PRIMARY KEY (ORD_NO),
    FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
  );
  CREATE INDEX IX_MBR_01 ON MBR (MBR_NM);`

describe('applyDdlImport', () => {
  it('테이블·컬럼·인덱스·관계를 만든다', () => {
    const { after } = build(DDL)
    expect(Object.values(after.tables).map((t) => t.physicalName).sort()).toEqual(['MBR', 'ORD'])
    expect(Object.values(after.columns)).toHaveLength(4)
    expect(Object.values(after.indexes)).toHaveLength(1)
    expect(Object.values(after.relationships)).toHaveLength(1)
  })

  it('PK·NOT NULL·컬럼 순서를 보존한다', () => {
    const { after } = build(DDL)
    const mbr = Object.values(after.tables).find((t) => t.physicalName === 'MBR')!
    const cols = Object.values(after.columns)
      .filter((c) => c.tableId === mbr.id).sort((a, b) => a.order - b.order)
    expect(cols.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
    expect(cols[0]).toMatchObject({ isPk: true, nullable: false, order: 0 })
    expect(cols[1]).toMatchObject({ isPk: false, nullable: true, order: 1 })
  })

  it('모든 테이블에 좌표를 배정하고 겹치지 않게 둔다', () => {
    const { after } = build(DDL)
    const positions = Object.values(after.tables).map((t) => `${t.position.x},${t.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
    for (const t of Object.values(after.tables)) {
      expect(Number.isFinite(t.position.x)).toBe(true)
      expect(Number.isFinite(t.position.y)).toBe(true)
    }
  })

  it('기존 테이블 아래쪽에 배치한다', () => {
    seq = 0
    const model = createEmptyModel()
    model.tables['old'] = {
      id: 'old', logicalName: '기존', physicalName: 'OLD', comment: null,
      groupId: null, position: { x: 0, y: 500 }, groupPosition: null, custom: {},
    }
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    const after = applyDdlImport(model, plan, newId)
    for (const t of Object.values(after.tables)) {
      if (t.id === 'old') continue
      expect(t.position.y).toBeGreaterThan(500)
    }
  })

  it('기존 모델을 제자리에서 바꾸지 않는다', () => {
    const { before, after } = build(DDL)
    expect(Object.keys(before.tables)).toHaveLength(0)
    expect(after).not.toBe(before)
  })

  it('빈 계획이면 모델이 그대로다', () => {
    seq = 0
    const model = createEmptyModel()
    const plan = planDdlImport(model, parseDdl(''), 'postgresql', DEFAULT_NAMING_RULES)
    expect(applyDdlImport(model, plan, newId)).toEqual(model)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web exec vitest run ddl-import-edits
```

Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 3: `applyDdlImport`를 구현한다**

`apps/web/src/editor/ddl-import-edits.ts` 생성. 구현 순서:

1. 계획의 테이블마다 `newId()`로 id를 발급하고 물리명 → id 맵을 만든다.
2. 컬럼도 마찬가지로 발급하고 `${테이블물리명}.${컬럼물리명}` → id 맵을 만든다. `order`는 계획의 배열 순서를 쓴다.
3. 인덱스는 `columnPhysicalNames`를 컬럼 id로 해석해 만든다.
4. 관계는 자식·부모 테이블 id와 컬럼 id 쌍으로 만든다. 모델의 `Relationship` 형태는 `packages/core/src/model.ts`의 `RelationshipSchema`를 따른다 — 필드 이름과 필수 여부를 그 파일에서 확인해 채운다.
5. **자동 배치** — `computeAutoLayout`을 다음처럼 부른다:

```ts
import { computeAutoLayout } from './auto-layout.js'

const NODE_WIDTH = 260
const rowHeight = (columnCount: number) => 40 + columnCount * 28

const layoutNodes = plan.tables.map((t) => ({
  id: t.physicalName, width: NODE_WIDTH, height: rowHeight(t.columns.length),
}))
const layoutEdges = plan.relationships.map((r) => ({
  source: r.parentPhysicalName, target: r.childPhysicalName,
}))
const layout = computeAutoLayout(layoutNodes, layoutEdges)

// 기존 테이블과 겹치지 않게 아래로 민다.
const existingMaxY = Object.values(model.tables)
  .reduce((max, t) => Math.max(max, t.position.y), Number.NEGATIVE_INFINITY)
const offsetY = Number.isFinite(existingMaxY) ? existingMaxY + 200 : 0
```

각 테이블의 `position`은 `layout.get(physicalName)`에 `offsetY`를 더한 값이고, 맵에 없으면 `{ x: 0, y: offsetY }`로 둔다.
`groupId`는 `null`, `groupPosition`은 `null`, `custom`은 `{}`다.

6. 새 객체를 만들어 돌려준다 — `{ ...model, tables: {...}, columns: {...}, indexes: {...}, relationships: {...} }`. **입력 모델의 컬렉션을 제자리에서 바꾸지 않는다.**

`computeAutoLayout`의 시그니처는 `computeAutoLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts?)` → `Map<string, { x: number; y: number }>`다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C apps/web exec vitest run ddl-import-edits
```

Expected: PASS

- [ ] **Step 5: 모델 수준 왕복 테스트를 추가한다**

`ddl-import-edits.test.ts`에 추가한다. 이것이 설계 §2가 말한 전 구간 왕복이다:

```ts
import { generateDdl } from '@erdd/core'

it('왕복 — 내보낸 DDL을 다시 가져오면 같은 모델이 나온다(id·좌표 제외)', () => {
  seq = 0
  const original = createEmptyModel()
  original.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  original.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  original.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }

  const ddl = generateDdl(original)
  const empty = createEmptyModel()
  const plan = planDdlImport(empty, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
  const restored = applyDdlImport(empty, plan, newId)

  const shape = (m: typeof original) => ({
    tables: Object.values(m.tables)
      .map((t) => ({ logicalName: t.logicalName, physicalName: t.physicalName, comment: t.comment }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
    columns: Object.values(m.columns)
      .map((c) => ({
        logicalName: c.logicalName, physicalName: c.physicalName, type: c.type,
        isPk: c.isPk, nullable: c.nullable, autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue, comment: c.comment, order: c.order,
      }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
  })

  expect(shape(restored)).toEqual(shape(original))
})
```

- [ ] **Step 6: 왕복 통과 확인**

```bash
pnpm -C apps/web exec vitest run ddl-import-edits
```

Expected: PASS. 깨지면 파서·계획·적용 중 어디인지 밝혀 보고서에 적어라.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/ddl-import-edits.ts apps/web/src/editor/ddl-import-edits.test.ts
git commit -m "$(cat <<'EOF'
feat(web): DDL 가져오기 계획을 모델에 적용

계획을 순수 producer로 모델에 반영하고 computeAutoLayout으로 좌표를 준다.
렌더 전이라 실측 크기가 없으므로 컬럼 수 기반 높이 추정을 쓰고, 기존
테이블이 있으면 그 아래로 밀어 겹치지 않게 한다.

전 구간 왕복 테스트(내보내기 → 파싱 → 계획 → 적용)를 추가한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 8: 가져오기 다이얼로그와 툴바 진입점

**Files:**
- Create: `apps/web/src/editor/ddl-import-dialog.tsx`
- Create: `apps/web/src/editor/ddl-import-dialog.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: `parseDdl`·`detectDialect`·`planDdlImport`(core), `applyDdlImport`(Task 7), `useModelMutation`(`./use-model.js`), `useEditorStore`
- Produces: `<DdlImportDialog projectId={projectId} />`

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/ddl-import-dialog.test.tsx` 생성. 렌더 래퍼는 같은 디렉터리의 `export-dialog.test.tsx`를 그대로 따른다 — **추측하지 말고 그 파일을 열어 확인해라.**

```ts
const DDL = `
CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
COMMENT ON TABLE MBR IS '회원';`

describe('DdlImportDialog', () => {
  it('DDL을 붙여넣으면 미리보기에 개수가 뜬다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(DDL)
    expect(await screen.findByText(/테이블 1개/)).toBeInTheDocument()
    expect(screen.getByText(/컬럼 2개/)).toBeInTheDocument()
  })

  it('건너뛴 구문을 경고로 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste('GRANT SELECT ON A TO B;')
    expect(await screen.findByText(/건너뛰었습니다/)).toBeInTheDocument()
  })

  it('적용하면 단일 mutation이 나간다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(DDL)
    await userEvent.click(await screen.findByRole('button', { name: /만들기$/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
  })

  it('방언을 수동으로 바꾸면 파싱 결과가 갱신된다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste('CREATE TABLE A (C1 CLOB);')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '방언' }))
    expect(await screen.findByText(/TEXT로 읽었습니다/)).toBeInTheDocument()
  })

  it('op 한도를 넘으면 적용을 막고 안내한다', async () => {
    const many = Array.from({ length: 2600 }, (_, i) => `CREATE TABLE T${i} (C1 INT, C2 INT);`).join('\n')
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(many)
    expect(await screen.findByText(/나눠/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /만들기$/ })).toBeDisabled()
  })

  it('편집 권한이 없으면 진입점이 없다', () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderDialog()
    expect(screen.queryByRole('button', { name: '가져오기' })).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web exec vitest run ddl-import-dialog
```

Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 3: 다이얼로그를 만든다**

`apps/web/src/editor/ddl-import-dialog.tsx` 생성. 구조는 `export-dialog.tsx`를 본뜬다(같은 `Dialog` 컴포넌트·같은 툴바 버튼 모양).

동작:

```tsx
const canEdit = useEditorStore((s) => s.canEdit)
const model = useEditorStore((s) => s.model)
const namingRules = useEditorStore((s) => s.namingRules)
const mutate = useModelMutation(projectId)

const [text, setText] = useState('')
const [manualDialect, setManualDialect] = useState<Dialect | null>(null)

const detected = useMemo(() => detectDialect(text), [text])
const dialect = manualDialect ?? detected ?? 'postgresql'
const plan = useMemo(
  () => (text.trim() === '' ? null : planDdlImport(model, parseDdl(text), dialect, namingRules)),
  [text, dialect, model, namingRules],
)
const overLimit = plan !== null && plan.opCountEstimate > MAX_OPS_PER_MUTATION
```

- `canEdit`이 false면 **아무것도 렌더하지 않는다**(`if (!canEdit) return null`).
- 방언 select의 접근명은 `방언`, 옵션에 자동 감지 결과를 표시한다.
- DDL 입력 textarea의 접근명은 `DDL`.
- 미리보기: `테이블 N개 · 컬럼 N개 · 관계 N개 · 인덱스 N개`, `건너뜀 N개`(있을 때만), 경고 목록.
- 적용 버튼 문구는 `` `${plan.tables.length}개 테이블 만들기` `` — 진입점 버튼(`가져오기`)과 접근명이 겹치지 않아야 `getByRole`이 모호해지지 않는다. `overLimit`이면 `disabled`.
- op 한도 안내 문구: `` `한 번에 가져올 수 있는 양을 넘었습니다. DDL을 나눠 올려주세요.` ``
- 적용:

```tsx
const onApply = async () => {
  if (plan === null || overLimit) return
  const captured = plan                       // producer 진입 전에 캡처한다
  const r = await mutate((m) => applyDdlImport(m, captured, newId), { summary: 'DDL 가져오기' })
  if (r === 'applied') { setOpen(false); setText('') }
}
```

`newId`는 `./uid.js`에서 가져온다.

- [ ] **Step 4: 툴바에 배치한다**

`apps/web/src/pages/project.tsx`에서 `<ExportDialog />` 바로 **앞**에 넣는다:

```tsx
{loaded && <DdlImportDialog projectId={projectId} />}
{loaded && <ExportDialog />}
```

import를 파일 상단의 다른 editor import들과 같은 자리에 추가한다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm -C apps/web exec vitest run ddl-import-dialog
```

Expected: PASS

- [ ] **Step 6: 전체 검증**

```bash
set -a && . ./.env && set +a && pnpm verify; echo "EXIT=$?"
```

Expected: `EXIT=0`

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/ddl-import-dialog.tsx apps/web/src/editor/ddl-import-dialog.test.tsx \
  apps/web/src/pages/project.tsx
git commit -m "$(cat <<'EOF'
feat(web): DDL 가져오기 다이얼로그

붙여넣기 → 즉시 파싱 → 미리보기 → 적용. 파싱이 순수 함수라 서버 왕복 없이
입력이 바뀔 때마다 결과가 갱신된다. 방언은 자동 감지하되 언제나 수동으로
덮을 수 있다. op 한도를 넘으면 적용을 막고 나눠 올리도록 안내한다.

진입점은 canEdit 게이트를 받아 Viewer에게는 보이지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 9: 문서 갱신

**Files:**
- Modify: `docs/91-checklist.md`
- Modify: `docs/90-roadmap.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 체크리스트의 DDL 항목을 완료로 바꾼다**

`docs/91-checklist.md`의 "Phase 4 착수 전"에서 다음 줄을

```markdown
- [ ] **DDL 역설계 범위** — 지원 방언별 파싱 범위와 한계, 파서 라이브러리 선택
```

다음으로 바꾼다:

```markdown
- [x] **DDL 역설계 범위** — 손으로 쓴 좁은 파서(파서 라이브러리 미도입, `packages/core`의 무의존 원칙 유지). 범위는 "우리 내보내기의 왕복 + 실무 구문" — `CREATE TABLE`(인라인 PK·REFERENCES·자동증가·MySQL 인라인 COMMENT), `ALTER TABLE ADD CONSTRAINT`, `CREATE [UNIQUE] INDEX`, `COMMENT ON`. `CHECK`·파티션·트리거·시퀀스·권한은 건너뛰고 경고. 타입 역매핑은 보수적 기본값 + 대안 경고이며 **왕복이 깨지는 5건**을 테스트에 상수로 고정했다. 논리명은 코멘트 → 사전 → 물리명 순 → [설계](superpowers/specs/2026-08-03-ddl-reverse-engineering-design.md)
```

- [ ] **Step 2: 로드맵 Phase 4를 갱신한다**

`docs/90-roadmap.md`의 Phase 4에서 `DDL 가져오기(역설계)` 줄에 완료 표시와 설계 링크를 단다. 남은 것은 CLI임을 한 줄로 밝힌다.

- [ ] **Step 3: HANDOFF를 갱신한다**

"다음 작업"을 **Phase 4의 나머지 절반인 CLI**로 바꾼다. 착수 전 확정이 필요한 것이 `docs/91-checklist.md`의 **CLI 상세**와 **에이전트 스킬 문서** 둘임을 밝히고, 기존 경고를 그대로 유지한다:

> ⚠️ **CLI push는 세 번째 모델 변경 경로가 된다.** 반드시 `mutateAndPublish`를 거쳐야 한다 — `runMutation`을 직접 부르면 그 변경이 실시간 채널로 전파되지 않는다.

테스트 기준선을 실제 값으로 갱신한다. **서버 테스트는 DB env가 필요하므로 반드시 `.env`를 실어라** — 안 실으면 서버 스위트가 통째로 skip되면서 통과처럼 보인다:

```bash
set -a && . ./.env && set +a && pnpm verify 2>&1 | grep -E "Tests +[0-9]+ passed"
```

§6 이월 항목에 다음 블록을 추가한다(기존 항목은 지우지 않는다):

```markdown
**DDL 역설계 (구현 완료, 잔여 한계)**
- **가져온 컬럼의 도메인이 비어 있다.** 내보내기가 도메인을 타입으로 풀어 쓰므로 DDL에 도메인의 흔적이 없다. 타입만 채우고 `domainId`는 `null`이다 — 도메인 자동 매칭은 후속
- **왕복이 깨지는 조합이 5건 있다**(`JSON`→oracle/mssql, `DATE`·`TIME`→oracle, `UUID`→mysql). 내보내기 매핑이 단사가 아니어서 생기는 성질이고 `dialect.test.ts`의 `ROUND_TRIP_LOSSES`에 상수로 고정돼 있다. `toDialectType`을 고치면 이 목록도 함께 봐야 한다
- **Oracle `TIMESTAMP`는 의도적으로 `DATETIME`으로 읽는다.** 우리 매핑상 `TIME`으로 읽으면 왕복이 살아나지만 실무 Oracle DDL의 `TIMESTAMP`는 거의 항상 일시다
- 기존 테이블과의 **병합·재동기화가 없다** — 이름이 겹치면 건너뛴다. 운영 DB가 바뀐 뒤 다시 가져오는 시나리오는 미지원
- `CHECK` 제약을 도메인 허용값으로 변환하지 않는다(건너뛰고 경고)
- 파서는 `CREATE TABLE`·`ALTER TABLE ADD CONSTRAINT`·`CREATE INDEX`·`COMMENT ON`만 안다. 뷰·프로시저·트리거·시퀀스는 건너뛴다
```

- [ ] **Step 4: 커밋**

```bash
git add docs/91-checklist.md docs/90-roadmap.md docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs: DDL 역설계 완료 반영

체크리스트의 "DDL 역설계 범위" 항목을 결정 내용과 함께 완료 처리하고,
다음 작업을 Phase 4의 나머지 절반인 CLI로 넘긴다. 잔여 한계(도메인 미매칭,
왕복 손실 5건, 병합 미지원)를 HANDOFF 이월에 기록.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

## 브라우저 스모크 (구현 완료 후)

환경 기동은 HANDOFF 4절을 따른다. 서버 테스트가 모든 테이블을 TRUNCATE하므로 `pnpm verify` 뒤에는 **재시드가 필요하다.**

1. 빈 프로젝트에서 툴바 `가져오기`를 연다
2. PostgreSQL DDL(테이블 2개 + FK + 인덱스 + `COMMENT ON`)을 붙여넣는다 → 방언이 자동 감지되고 미리보기에 개수·경고가 뜬다
3. 적용 → 캔버스에 테이블이 뜨고 **겹치지 않게 배치**돼 있으며 관계선이 그려진다
4. **논리명이 코멘트에서 복원됐는지** 확인한다(좌측 트리와 편집 패널)
5. **되돌리기 한 번**으로 가져온 것이 통째로 사라진다(Revision 1건)
6. 같은 DDL을 다시 가져온다 → 전부 "건너뜀"으로 표시되고 적용해도 아무것도 늘지 않는다
7. `CHECK`·`CREATE SEQUENCE`·`GRANT`가 섞인 DDL → 경고에 줄 번호와 함께 나열된다
8. Oracle DDL(`VARCHAR2`·`NUMBER(10)`·`CLOB`)을 붙여넣는다 → 방언이 oracle로 감지되고 `CLOB`에 모호성 경고가 뜬다
9. **Viewer로 로그인하면 툴바에 `가져오기`가 없다**
10. 내보내기 → 그 결과를 다시 가져오기 → 원래와 같은 테이블·컬럼·논리명이 나온다(전 구간 왕복을 사람 눈으로 확인)
