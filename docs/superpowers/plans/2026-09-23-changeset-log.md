# 변경 기록(changeset) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 모드에서 스키마 수정 내역을 DB 중립 텍스트(`erdd/changes/*.erddc`)로 보관하고, CLI·웹에서 미기록 변경을 보고 기록을 만들 수 있게 한다.

**Architecture:** core 가 순수 함수 다섯 겹을 갖는다 — 모델 → 스키마 투영(`projectSchema`), 투영 두 개 → 문장(`diffProjection`), 문장 ↔ 텍스트(`formatChangeset`·`parseChangeset`), 텍스트 → 투영(`replay`), 그리고 그것을 묶는 상태·생성(`planChanges`·`composeChangeset`). 기준선은 기록 파일 전부를 재생해 얻고, 새 기록은 쓰기 전에 재생 결과가 현재와 같은지 자기검증한다. CLI 는 파일 입출력과 `erdd changes` 명령, 로컬 서버는 `/local/changes`·`/local/changes/create`, 웹은 「버전」 다이얼로그의 「변경 기록」 탭을 더한다.

**Tech Stack:** TypeScript(strict, `noUncheckedIndexedAccess`), vitest, Fastify(로컬 서버), React + TanStack Query(웹).

**Spec:** `docs/superpowers/specs/2026-09-23-changeset-log-design.md` — 이 계획은 spec 을 근거로 한다. 실행자는 둘 다 읽는다.

## Global Constraints

- 작업 위치: 워크트리 `.worktrees/feat-changeset-log`, 브랜치 `feat/changeset-log`, 기준 브랜치 로컬 `main`
  (`git worktree add -b feat/changeset-log .worktrees/feat-changeset-log main`). 워크트리 안에서 `pnpm install` 을 직접 실행한다.
- 커밋 메시지는 한국어, 말미에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. 커밋할 파일은 경로로 명시한다(`git add <경로들> && git commit -m … -- <경로들>` 을 한 명령으로). `git add -A`·`commit -a` 금지.
- 🔥 `.env` 를 로드해 `pnpm verify` 를 돌리지 않는다. 이 계획은 서버 앱(`apps/server`)을 건드리지 않으므로 core·cli·web 테스트와 타입체크만 돌린다.
- `pnpm -s -r typecheck` 는 오류가 있어도 출력이 비고 종료코드만 1 이다 — 항상 `; echo "exit=$?"` 로 종료코드를 본다.
- 정렬은 **코드 단위 사전순**(`compareCodeUnits`)만 쓴다. `localeCompare` 금지 — 실행 환경마다 기록 순서가 달라진다.
- 코드 주석이 규칙을 가리킬 때는 **`docs/guides/changeset-format.md` 의 절 제목**을 쓴다(`파일:줄번호` 금지). 절 제목은 Task 11 에서 확정하는 것과 같다: 「기록 대상 — 스키마 투영」「파일 이름과 재생 순서」「문법」「문장 순서」「`after` 는 최종 순서의 바로 앞 컬럼이다」「재생은 `@id` 로 대상을 찾는다」「경합은 경고다」「생성 시 자기검증」「기록을 만들 수 없는 경우」「기록 파일은 고치지 않는다」「알려진 한계」.
- `diffModels`(`diff.ts`)·`diffModelsForDisplay`(`model-diff.ts`)는 **건드리지 않는다.**
- `ddl.ts` 리팩터는 동작 불변이다 — 기존 `ddl.test.ts` 가 **수정 없이** 통과해야 한다.
- 병행 트랙 `feat/cli-dict-sync` 와 겹치는 파일(`packages/cli/src/main.ts`, `packages/cli/skill/SKILL.md`, `docs/manual/cli-guide.md`, `CLAUDE.md`)은 **기존 서술을 옮기거나 재배치하지 말고 추가만** 한다.
- 사용자에게 보이는 문구는 이 계획에 적힌 것을 그대로 쓴다(매뉴얼이 인용한다).
- 서브에이전트·워커에게 줄 지시(`docs/guides/worktree-workflow.md` 「서브에이전트·워커 프롬프트에 반드시 넣을 세 문장」): 브리프 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고 **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고**한다. 수정 건마다 프로덕션 변경을 되돌려 테스트가 실패하는지(구분력) 확인하고, 실패하지 않으면 그렇다고 보고한다.

## Review Focus

spec 이 암시하지만 기능 테스트가 직접 치지 않는, 사람이 실제로 부딪칠 가능성이 큰 다섯 가지. 각 줄의 테스트는 해당 태스크에 들어 있다.

1. **git 이 CRLF·BOM 을 붙여 체크아웃한 기록 파일**(Windows `core.autocrlf`) — 파서가 그대로 읽어야 한다 → Task 4 「CRLF·BOM·들여쓰기가 달라도 읽는다」.
2. **이미 공유된 중간 기록을 누군가 지운 경우** — 뒤 기록의 재생이 없는 `@id` 에서 멈추고 **그 파일·줄**을 알려야 한다(조용히 틀린 기준선을 만들면 안 된다) → Task 6 「중간 기록이 지워지면 뒤 기록의 파일·줄에서 멈춘다」.
3. **`erdd/changes/` 에 `.erddc` 가 아닌 파일**(`README.md`, `.gitkeep`) — 무시해야 한다 → Task 7 「`.erddc` 가 아닌 파일은 읽지 않는다」.
4. **파일명에 쓸 수 없는 문자가 든 이름**(`../`, `:`, `*`) — 기록 파일이 `erdd/changes/` 밖으로 나가거나 쓰기가 실패하면 안 된다 → Task 7 「위험한 이름도 erdd/changes 안의 안전한 파일명이 된다」.
5. **큰 스키마**(테이블 200 × 컬럼 20)와 기록 수십 건 — 상태 계산이 매 요청 재생이므로 느려지면 탭·CLI 가 멈춘 것처럼 보인다 → Task 6 「큰 스키마와 기록 30건도 2초 안에 상태를 낸다」.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/core/src/ddl.ts` (수정) | `exportableTables`·`relationshipConstraintNames`·`effectiveAutoIncrement` export. `generateDdl`·`fkStatements`·`columnLine` 이 이것을 쓴다 |
| `packages/core/src/changeset/types.ts` | 투영·문장·헤더·오류 타입, `CHANGESET_FORMAT`, `emptyProjection`, `compareCodeUnits` |
| `packages/core/src/changeset/projection.ts` | `projectSchema(model, settings)` |
| `packages/core/src/changeset/diff.ts` | `diffProjection(base, target)`, `longestCommonSubsequence` |
| `packages/core/src/changeset/syntax.ts` | 값 표기(`fmt*`)와 파서 커서(`Cursor`, `ParseFailure`) — 직렬화·파서가 공유 |
| `packages/core/src/changeset/format.ts` | `formatChangeset`, `formatStatements`, `CHANGESET_BANNER` |
| `packages/core/src/changeset/parse.ts` | `parseChangeset` |
| `packages/core/src/changeset/replay.ts` | `applyChangeset`, `replay`, `ReplayFailure` |
| `packages/core/src/changeset/plan.ts` | `planChanges`, `composeChangeset`, 파일명 규칙, `formatChangeIssue` |
| `packages/core/src/local-protocol.ts` (수정) | `LOCAL_CHANGES_PATH`·`LOCAL_CHANGES_CREATE_PATH`·응답 타입·거절 문구 |
| `packages/core/src/index.ts` (수정) | 공개 export |
| `packages/cli/src/local/changes.ts` | `erdd/changes/` 읽기·쓰기, 상태 변환 |
| `packages/cli/src/commands/changes.ts` | `erdd changes` 명령 |
| `packages/cli/src/main.ts` (수정) | 명령 분기·도움말 |
| `packages/cli/src/local/server.ts` (수정) | 두 엔드포인트 |
| `apps/web/src/editor/use-local-changes.ts` | 조회·생성 훅 |
| `apps/web/src/editor/changes-section.tsx` | 「변경 기록」 탭 본문 |
| `apps/web/src/editor/version-dialog.tsx` (수정) | 탭 추가(로컬 모드만) |
| `apps/web/src/editor/use-local-watch.ts` (수정) | 로컬 이벤트마다 변경 기록 조회 무효화 |
| `packages/cli/skill/SKILL.md` (수정) | 에이전트용 절 |
| `docs/guides/changeset-format.md` (신설) | 문법·재생 규칙의 정본 |
| `docs/manual/local-guide.md`·`cli-guide.md`·`user-guide.md`, `docs/ops/known-issues.md`, `CLAUDE.md` (수정) | 사용자 문서·목차 |

---

### Task 1: `ddl.ts` 의 판정·이름 함수를 export 한다

변경 기록 투영이 DDL 내보내기와 **같은 함수**로 「어느 테이블이 나가는가」「FK·UNIQUE 제약 이름」「실제 자동증가」를 판정해야 한다. 지금은 셋 다 `ddl.ts` 안의 비공개 식이다.

**Files:**
- Modify: `packages/core/src/ddl.ts`
- Test: `packages/core/src/ddl.test.ts` (끝에 describe 하나 추가)

**Interfaces:**
- Produces:
  - `exportableTables(model: ProjectModel, scope: DdlScope, rules: NamingRules): Table[]`
  - `effectiveAutoIncrement(col: Column, logicalType: string): boolean`
  - `type ConstraintNames = { fk: string; unique: string | null }`
  - `relationshipConstraintNames(model: ProjectModel, selectedIds: Set<string>, rules: NamingRules): Map<string, ConstraintNames>`
  - 기존 export `tableColumns`, `commentText` 는 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/ddl.test.ts` 맨 끝에 추가:

```ts
import {
  effectiveAutoIncrement, exportableTables, relationshipConstraintNames,
} from './ddl.js'

describe('변경 기록이 공유하는 판정·이름 함수', () => {
  it('relationshipConstraintNames 는 generateDdl 과 같은 이름을 낸다 — 충돌 접미사와 1:1 UNIQUE 까지', () => {
    const m = buildSampleModel()
    // 같은 두 테이블 사이에 이름 없는 관계를 하나 더 — FK_MBR_MBR_GRD 가 겹쳐 _2 가 붙는다.
    m.relationships['r2'] = {
      id: 'r2', parentTableId: 't1', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
      cardinality: '1:1', identifying: false, name: null,
    }
    const names = relationshipConstraintNames(m, new Set(['t1', 't2']), DEFAULT_NAMING_RULES)
    expect(names.get('r1')).toEqual({ fk: 'FK_MBR_MBR_GRD', unique: null })
    expect(names.get('r2')).toEqual({ fk: 'FK_MBR_MBR_GRD_2', unique: 'UQ_MBR_GRD_CD' })
    const ddl = generateDdl(m, 'postgresql')
    expect(ddl).toContain('ADD CONSTRAINT FK_MBR_MBR_GRD_2 FOREIGN KEY')
    expect(ddl).toContain('ADD CONSTRAINT UQ_MBR_GRD_CD UNIQUE')
  })

  it('relationshipConstraintNames 는 선택되지 않은 테이블의 관계를 빼고 이름을 매긴다', () => {
    const names = relationshipConstraintNames(buildSampleModel(), new Set(['t2']), DEFAULT_NAMING_RULES)
    expect(names.size).toBe(0)
  })

  it('exportableTables 는 컬럼이 없거나 물리명이 빈 테이블을 뺀다 — generateDdl 과 같은 판정', () => {
    const m = buildSampleModel()
    m.tables['t3'] = {
      id: 't3', logicalName: '빈', physicalName: 'EMPTY_TB', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['t1'] = { ...m.tables['t1']!, physicalName: '' }
    expect(exportableTables(m, { kind: 'all' }, DEFAULT_NAMING_RULES).map((t) => t.id)).toEqual(['t2'])
  })

  it('effectiveAutoIncrement 는 PK 이고 정수 타입일 때만 참이다', () => {
    const m = buildSampleModel()
    expect(effectiveAutoIncrement(m.columns['c2']!, 'BIGINT')).toBe(true)
    expect(effectiveAutoIncrement({ ...m.columns['c2']!, isPk: false }, 'BIGINT')).toBe(false)
    expect(effectiveAutoIncrement(m.columns['c2']!, 'VARCHAR(10)')).toBe(false)
    expect(effectiveAutoIncrement({ ...m.columns['c2']!, autoIncrement: false }, 'BIGINT')).toBe(false)
  })
})
```

(`buildSampleModel`·`DEFAULT_NAMING_RULES`·`generateDdl` 심은 파일 머리에 이미 import 돼 있다. 새 import 줄은 파일 머리의 기존 `./ddl.js` import 옆에 둔다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts`
Expected: FAIL — `relationshipConstraintNames is not a function`(또는 export 없음).

- [ ] **Step 3: 구현한다** — `packages/core/src/ddl.ts`:

(a) `isIntegerType` 아래에 추가:

```ts
/**
 * 실제로 나가는 자동증가인가 — PK 이고 정수 타입일 때만. DDL 의 컬럼 줄과 변경 기록 투영이
 * 같은 판정을 쓴다(한쪽만 바꾸면 기록과 내보내기가 다른 컬럼을 자동증가라고 말한다).
 */
export function effectiveAutoIncrement(col: Column, logicalType: string): boolean {
  return col.autoIncrement && col.isPk && isIntegerType(logicalType)
}
```

(b) `columnLine` 안의 `const auto = col.autoIncrement && col.isPk && isIntegerType(r.logicalType)` 를
`const auto = effectiveAutoIncrement(col, r.logicalType)` 로 바꾼다.

(c) `hasEmptyPhysicalName` 아래에 추가:

```ts
/**
 * DDL 로 낼 수 있는 테이블 — 컬럼이 있고 물리명이 비지 않았다. `generateDdl` 과 변경 기록의
 * 스키마 투영이 같은 판정을 쓴다(guide 「기록 대상 — 스키마 투영」).
 */
export function exportableTables(model: ProjectModel, scope: DdlScope, rules: NamingRules): Table[] {
  return selectTables(model, scope, rules).filter(
    (t) => tableColumns(model, t.id).length > 0 && !hasEmptyPhysicalName(model, t, rules),
  )
}
```

(d) `fkStatements` 를 통째로 다음 두 함수로 바꾼다:

```ts
export type ConstraintNames = { fk: string; unique: string | null }

/**
 * 관계 → FK 제약 이름(1:1 이면 UNIQUE 제약 이름도). **순회 순서가 충돌 접미사(_2, _3…)를 정하므로**
 * DDL 과 변경 기록이 이 함수 하나를 써야 같은 이름이 나온다. 유일성은 원문 기준으로 추적하고
 * 인용은 출력하는 쪽이 한다.
 */
export function relationshipConstraintNames(
  model: ProjectModel, selectedIds: Set<string>, rules: NamingRules,
): Map<string, ConstraintNames> {
  const used = new Set<string>()
  const out = new Map<string, ConstraintNames>()
  for (const rel of selectedRelationships(model, selectedIds)) {
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    if (!parent || !child) continue
    const childName = composeTablePhysicalName(child, model, rules)
    const parentName = composeTablePhysicalName(parent, model, rules)
    const fk = uniqueConstraintName(fkBaseName(rel, childName, parentName), used)
    let unique: string | null = null
    if (rel.cardinality === '1:1') {
      const rawChildCols = rel.columnMappings.map((m) => model.columns[m.childColumnId]?.physicalName ?? '')
      unique = uniqueConstraintName(`UQ_${childName}_${rawChildCols.join('_')}`, used)
    }
    out.set(rel.id, { fk, unique })
  }
  return out
}

function fkStatements(
  model: ProjectModel, selectedIds: Set<string>, dialect: Dialect, rules: NamingRules,
): string[] {
  const compose = (t: Table) => composeTablePhysicalName(t, model, rules)
  const names = relationshipConstraintNames(model, selectedIds, rules)
  const statements: string[] = []
  const q = (s: string) => quoteIdentifier(s, dialect)
  for (const rel of selectedRelationships(model, selectedIds)) {
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    const n = names.get(rel.id)
    if (!parent || !child || n === undefined) continue
    const childCols = rel.columnMappings.map((m) => q(model.columns[m.childColumnId]?.physicalName ?? ''))
    const parentCols = rel.columnMappings.map((m) => q(model.columns[m.parentColumnId]?.physicalName ?? ''))
    statements.push(
      `ALTER TABLE ${q(compose(child))} ADD CONSTRAINT ${q(n.fk)} FOREIGN KEY (${childCols.join(', ')}) REFERENCES ${q(compose(parent))} (${parentCols.join(', ')});`,
    )
    if (n.unique !== null) {
      statements.push(`ALTER TABLE ${q(compose(child))} ADD CONSTRAINT ${q(n.unique)} UNIQUE (${childCols.join(', ')});`)
    }
  }
  return statements
}
```

(e) `generateDdl` 첫 줄의 `selectTables(...).filter(...)` 식을 `const tables = exportableTables(model, scope, rules)` 로 바꾼다.

- [ ] **Step 4: 통과와 무회귀를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts src/dbml.test.ts src/dbml-roundtrip.test.ts; echo "exit=$?"`
Expected: PASS, `exit=0`. 기존 케이스는 한 줄도 고치지 않았다.

Run: `pnpm -C packages/core typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts && git commit -m "refactor(core): DDL 의 테이블 판정·제약 이름·자동증가 판정을 공유 함수로 꺼낸다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/ddl.ts packages/core/src/ddl.test.ts
```

---

### Task 2: 투영 타입과 `projectSchema`

**Files:**
- Create: `packages/core/src/changeset/types.ts`
- Create: `packages/core/src/changeset/projection.ts`
- Test: `packages/core/src/changeset/projection.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `exportableTables`, `relationshipConstraintNames`, `effectiveAutoIncrement`, 기존 `tableColumns`, `commentText`(`ddl.ts`), `resolveColumn`(`domain-resolve.ts`), `composeTablePhysicalName`·`composeTableLogicalName`(`name-template.ts`).
- Produces (`types.ts` 전체 — 뒤 태스크가 전부 이 이름을 쓴다):

```ts
export const CHANGESET_FORMAT = 1
export function compareCodeUnits(a: string, b: string): number
export type DialectTypes = Partial<Record<Dialect, string>>
export type ProjColumn = { id; tableId; name; type; dialectTypes: DialectTypes; nullable: boolean; default: string | null; increment: boolean; comment: string | null; check: string[] }
export type ProjTable = { id; name; comment: string | null; columnIds: string[]; primaryKey: string[] }
export type ProjIndex = { id; tableId; name; columns: { columnId: string; direction: 'asc' | 'desc' }[]; unique: boolean }
export type ProjForeignKey = { id; name; childTableId; childColumnIds: string[]; parentTableId; parentColumnIds: string[]; cardinality: '1:1' | '1:N'; uniqueName: string | null }
export type SchemaProjection = { tables: Record<string, ProjTable>; columns: Record<string, ProjColumn>; indexes: Record<string, ProjIndex>; foreignKeys: Record<string, ProjForeignKey> }
export function emptyProjection(): SchemaProjection
export type ColumnDef = Omit<ProjColumn, 'tableId'>
export type IndexDef, ForeignKeyDef, TableDef, ColumnChange, AlterAction, Statement, ChangesetHeader, Changeset, ChangeIssue
```

- `projection.ts`: `type ProjectionSettings = { rules: NamingRules; dialects: readonly Dialect[] }`, `projectSchema(model: ProjectModel, settings: ProjectionSettings): SchemaProjection`.

- [ ] **Step 1: `types.ts` 를 만든다** (타입만이라 테스트는 Step 2 가 함께 잠근다):

```ts
import type { Dialect } from '../dialect.js'

/** 이 ERDD 가 쓰고 읽는 기록 형식 번호. 더 큰 번호의 기록은 파서가 거절한다. */
export const CHANGESET_FORMAT = 1

/**
 * 코드 단위 사전순. **`localeCompare` 를 쓰지 않는다** — 실행 환경의 로캘에 따라 순서가 달라져
 * 같은 모델에서 다른 기록이 나오고, 재생 순서(파일명 순)도 흔들린다.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export type DialectTypes = Partial<Record<Dialect, string>>

// ── 스키마 투영 — guide 「기록 대상 — 스키마 투영」 ──

export type ProjColumn = {
  id: string
  tableId: string
  name: string
  /** 유효 논리 타입(도메인을 거친 값). DB 중립이다. */
  type: string
  /** 도메인의 방언별 타입 중 프로젝트 방언에 있는 것만. 없으면 빈 객체. */
  dialectTypes: DialectTypes
  nullable: boolean
  /** 원문 기본값. 자동증가 컬럼이면 null(DDL 도 DEFAULT 를 내지 않는다). */
  default: string | null
  increment: boolean
  /** DDL 이 내는 코멘트 텍스트(`commentText`). */
  comment: string | null
  /** 허용값(CHECK IN). 없으면 빈 배열. */
  check: string[]
}

export type ProjTable = {
  id: string
  /** 명명 템플릿을 거친 실제 물리명. */
  name: string
  comment: string | null
  /** 컬럼 순서. 정수 order 가 아니라 id 목록이다 — guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」. */
  columnIds: string[]
  /** PK 컬럼 id — 컬럼 순서대로(DDL 의 PRIMARY KEY 절과 같은 순서). */
  primaryKey: string[]
}

export type ProjIndex = {
  id: string
  tableId: string
  name: string
  columns: { columnId: string; direction: 'asc' | 'desc' }[]
  unique: boolean
}

export type ProjForeignKey = {
  id: string
  name: string
  childTableId: string
  childColumnIds: string[]
  parentTableId: string
  parentColumnIds: string[]
  cardinality: '1:1' | '1:N'
  /** 1:1 이면 DDL 이 함께 내는 UNIQUE 제약 이름. */
  uniqueName: string | null
}

export type SchemaProjection = {
  tables: Record<string, ProjTable>
  columns: Record<string, ProjColumn>
  indexes: Record<string, ProjIndex>
  foreignKeys: Record<string, ProjForeignKey>
}

export function emptyProjection(): SchemaProjection {
  return { tables: {}, columns: {}, indexes: {}, foreignKeys: {} }
}

// ── 문장 — 이름으로 쓴 정의. 대상은 `id` 로 찾는다(guide 「재생은 `@id` 로 대상을 찾는다」) ──

export type ColumnDef = Omit<ProjColumn, 'tableId'>

export type IndexDef = {
  id: string
  name: string
  table: string
  columns: { name: string; direction: 'asc' | 'desc' }[]
  unique: boolean
}

export type ForeignKeyDef = {
  id: string
  name: string
  child: string
  childColumns: string[]
  parent: string
  parentColumns: string[]
  cardinality: '1:1' | '1:N'
  uniqueName: string | null
}

export type TableDef = {
  id: string
  name: string
  comment: string | null
  columns: ColumnDef[]
  /** PK 컬럼 이름. */
  primaryKey: string[]
  /** drop table 만 싣는다(되돌리기용). create table 은 언제나 빈 배열 — 인덱스는 add index 로 따로 나간다. */
  indexes: IndexDef[]
}

/** `position` 의 값은 최종 순서에서 바로 앞 컬럼의 이름, null 은 맨 앞. */
export type ColumnChange =
  | { field: 'type'; from: string; to: string }
  | { field: 'dialects'; from: DialectTypes; to: DialectTypes }
  | { field: 'nullable'; from: boolean; to: boolean }
  | { field: 'default'; from: string | null; to: string | null }
  | { field: 'increment'; from: boolean; to: boolean }
  | { field: 'comment'; from: string | null; to: string | null }
  | { field: 'check'; from: string[]; to: string[] }
  | { field: 'position'; from: string | null; to: string | null }

/** `line` 은 파서가 채운다(오류·경고 위치). 직렬화는 보지 않는다. */
export type AlterAction = (
  | { kind: 'dropColumn'; column: ColumnDef }
  | { kind: 'renameColumn'; id: string; from: string; to: string }
  | { kind: 'addColumn'; column: ColumnDef; after: string | null }
  | { kind: 'modifyColumn'; id: string; name: string; changes: ColumnChange[] }
  | { kind: 'primaryKey'; from: string[]; to: string[] }
  | { kind: 'tableComment'; from: string | null; to: string | null }
) & { line?: number }

export type Statement = (
  | { kind: 'dropForeignKey'; fk: ForeignKeyDef }
  | { kind: 'dropIndex'; index: IndexDef }
  | { kind: 'renameIndex'; id: string; table: string; from: string; to: string }
  | { kind: 'dropTable'; table: TableDef }
  | { kind: 'renameTable'; id: string; from: string; to: string }
  | { kind: 'createTable'; table: TableDef }
  | { kind: 'alterTable'; id: string; name: string; actions: AlterAction[] }
  | { kind: 'addIndex'; index: IndexDef }
  | { kind: 'addForeignKey'; fk: ForeignKeyDef }
) & { line?: number }

export type ChangesetHeader = { format: number; name: string; created: string; baseline: boolean }
export type Changeset = { header: ChangesetHeader; statements: Statement[] }

/** 오류·경고의 위치. 파일도 줄도 없으면 모델 쪽 문제다. */
export type ChangeIssue = { file: string | null; line: number | null; message: string }
```

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `packages/core/src/changeset/projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { projectSchema } from './projection.js'

const SETTINGS = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }

describe('projectSchema', () => {
  it('샘플 모델을 DDL 내보내기와 같은 이름·코멘트로 투영한다', () => {
    expect(projectSchema(buildSampleModel(), SETTINGS)).toEqual({
      tables: {
        t1: { id: 't1', name: 'MBR_GRD', comment: '회원등급', columnIds: ['c1'], primaryKey: ['c1'] },
        t2: {
          id: 't2', name: 'MBR', comment: '회원 - 서비스 가입 회원',
          columnIds: ['c2', 'c3', 'c4'], primaryKey: ['c2'],
        },
      },
      columns: {
        c1: { id: 'c1', tableId: 't1', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
        c2: { id: 'c2', tableId: 't2', name: 'MBR_NO', type: 'BIGINT', dialectTypes: {}, nullable: false, default: null, increment: true, comment: '회원번호', check: [] },
        c3: { id: 'c3', tableId: 't2', name: 'MBR_NM', type: 'VARCHAR(100)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '회원명', check: [] },
        c4: { id: 'c4', tableId: 't2', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
      },
      indexes: {
        i1: { id: 'i1', tableId: 't2', name: 'UX_MBR_01', columns: [{ columnId: 'c3', direction: 'asc' }], unique: true },
      },
      foreignKeys: {
        r1: {
          id: 'r1', name: 'FK_MBR_MBR_GRD', childTableId: 't2', childColumnIds: ['c4'],
          parentTableId: 't1', parentColumnIds: ['c1'], cardinality: '1:N', uniqueName: null,
        },
      },
    })
  })

  it('도메인을 쓰는 컬럼은 도메인의 타입·기본값·허용값과, 프로젝트 방언에 있는 오버라이드만 싣는다', () => {
    const m = buildSampleModel()
    m.domains['d1'] = {
      id: 'd1', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: 'BOOLEAN', mysql: '  ', oracle: null, mssql: 'BIT' },
      defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null, origin: null,
    }
    m.columns['c3'] = { ...m.columns['c3']!, domainId: 'd1' }
    const p = projectSchema(m, { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql', 'mysql'] })
    // mysql 은 공백뿐이라 빠지고, mssql 은 프로젝트 방언이 아니라 빠진다.
    expect(p.columns['c3']).toMatchObject({
      type: 'CHAR(1)', dialectTypes: { postgresql: 'BOOLEAN' }, default: "'N'", check: ['Y', 'N'],
    })
  })

  it('자동증가는 PK 이고 정수일 때만 켜지고, 그때 기본값은 싣지 않는다', () => {
    const m = buildSampleModel()
    m.columns['c2'] = { ...m.columns['c2']!, defaultValue: '0' }
    m.columns['c3'] = { ...m.columns['c3']!, autoIncrement: true }   // PK 가 아니다
    const p = projectSchema(m, SETTINGS)
    expect(p.columns['c2']).toMatchObject({ increment: true, default: null })
    expect(p.columns['c3']).toMatchObject({ increment: false })
  })

  it('명명 템플릿을 거친 실제 물리명을 쓰고 FK 이름도 그것을 따른다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{물리명}' }
    const p = projectSchema(buildSampleModel(), { rules, dialects: ['postgresql'] })
    expect(p.tables['t2']!.name).toBe('TB_MBR')
    expect(p.foreignKeys['r1']!.name).toBe('FK_TB_MBR_TB_MBR_GRD')
  })

  it('컬럼이 없거나 물리명이 빈 테이블은 빠지고, 거기 걸린 FK·인덱스도 빠진다', () => {
    const m = buildSampleModel()
    m.columns = Object.fromEntries(Object.entries(m.columns).filter(([, c]) => c.tableId !== 't1'))
    const p = projectSchema(m, SETTINGS)
    expect(Object.keys(p.tables)).toEqual(['t2'])
    expect(p.foreignKeys).toEqual({})

    const m2 = buildSampleModel()
    m2.tables['t2'] = { ...m2.tables['t2']!, physicalName: '' }
    const p2 = projectSchema(m2, SETTINGS)
    expect(Object.keys(p2.tables)).toEqual(['t1'])
    expect(p2.indexes).toEqual({})
    expect(p2.foreignKeys).toEqual({})
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/projection.test.ts`
Expected: FAIL — `Cannot find module './projection.js'`.

- [ ] **Step 4: 구현한다** — `packages/core/src/changeset/projection.ts`:

```ts
import {
  commentText, effectiveAutoIncrement, exportableTables, relationshipConstraintNames, tableColumns,
} from '../ddl.js'
import type { Dialect } from '../dialect.js'
import { resolveColumn } from '../domain-resolve.js'
import type { Column, ProjectModel } from '../model.js'
import { composeTableLogicalName, composeTablePhysicalName } from '../name-template.js'
import type { NamingRules } from '../naming.js'
import { emptyProjection, type DialectTypes, type ProjColumn, type SchemaProjection } from './types.js'

export type ProjectionSettings = { rules: NamingRules; dialects: readonly Dialect[] }

/**
 * 모델 → 스키마 투영. 기록·재생·비교는 모두 이 모양 위에서만 일어난다
 * (guide 「기록 대상 — 스키마 투영」).
 *
 * ⚠️ **DDL 내보내기와 같은 함수로 판정·이름을 만든다** — 나가는 테이블(`exportableTables`), 물리명
 * (`composeTablePhysicalName`), FK·UNIQUE 이름(`relationshipConstraintNames`), 코멘트
 * (`commentText`), 자동증가(`effectiveAutoIncrement`). 사본을 두면 기록과 내보내기가 조용히 다른
 * 이름을 말한다.
 */
export function projectSchema(model: ProjectModel, settings: ProjectionSettings): SchemaProjection {
  const out = emptyProjection()
  const tables = exportableTables(model, { kind: 'all' }, settings.rules)
  const selected = new Set(tables.map((t) => t.id))

  for (const t of tables) {
    const name = composeTablePhysicalName(t, model, settings.rules)
    const cols = tableColumns(model, t.id)
    out.tables[t.id] = {
      id: t.id,
      name,
      comment: commentText(composeTableLogicalName(t, model, settings.rules), name, t.comment),
      columnIds: cols.map((c) => c.id),
      primaryKey: cols.filter((c) => c.isPk).map((c) => c.id),
    }
    for (const c of cols) out.columns[c.id] = projectColumn(c, model, settings.dialects)
  }

  for (const ix of Object.values(model.indexes)) {
    if (!selected.has(ix.tableId)) continue
    out.indexes[ix.id] = {
      id: ix.id, tableId: ix.tableId, name: ix.name,
      columns: ix.columns.map((c) => ({ columnId: c.columnId, direction: c.direction })),
      unique: ix.unique,
    }
  }

  const names = relationshipConstraintNames(model, selected, settings.rules)
  for (const rel of Object.values(model.relationships)) {
    const n = names.get(rel.id)
    if (n === undefined) continue
    out.foreignKeys[rel.id] = {
      id: rel.id,
      name: n.fk,
      childTableId: rel.childTableId,
      childColumnIds: rel.columnMappings.map((m) => m.childColumnId),
      parentTableId: rel.parentTableId,
      parentColumnIds: rel.columnMappings.map((m) => m.parentColumnId),
      cardinality: rel.cardinality,
      uniqueName: n.unique,
    }
  }
  return out
}

function projectColumn(c: Column, model: ProjectModel, dialects: readonly Dialect[]): ProjColumn {
  // resolveColumn 의 논리 타입·기본값·허용값은 방언과 무관하다 — 방언 인자는 물리 타입(sql)만 바꾸고,
  // 물리 타입은 기록에 싣지 않는다(DB 중립). 방언별 타입은 아래에서 도메인 오버라이드만 따로 싣는다.
  const r = resolveColumn(c, model, 'postgresql')
  const domain = c.domainId === null ? undefined : model.domains[c.domainId]
  const dialectTypes: DialectTypes = {}
  if (domain !== undefined) {
    for (const d of dialects) {
      const v = domain.dialectTypes[d]?.trim() ?? ''
      if (v !== '') dialectTypes[d] = v
    }
  }
  const increment = effectiveAutoIncrement(c, r.logicalType)
  return {
    id: c.id,
    tableId: c.tableId,
    name: c.physicalName,
    type: r.logicalType,
    dialectTypes,
    nullable: c.nullable,
    // DDL 은 자동증가 컬럼에 DEFAULT 를 내지 않는다 — 같은 판정.
    default: increment || r.defaultValue === null || r.defaultValue === '' ? null : r.defaultValue,
    increment,
    comment: commentText(c.logicalName, c.physicalName, c.comment),
    check: r.checkValues ?? [],
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/projection.test.ts; pnpm -C packages/core typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/changeset/types.ts packages/core/src/changeset/projection.ts packages/core/src/changeset/projection.test.ts && git commit -m "feat(core): 변경 기록의 스키마 투영 — DDL 내보내기와 같은 판정·이름으로 모델을 자른다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/changeset/types.ts packages/core/src/changeset/projection.ts packages/core/src/changeset/projection.test.ts
```

---

### Task 3: `diffProjection` — 투영 두 개의 차이를 문장으로

**Files:**
- Create: `packages/core/src/changeset/diff.ts`
- Test: `packages/core/src/changeset/diff.test.ts`

**Interfaces:**
- Consumes: Task 2 의 타입 전부, `deepEqual`(`../equal.js`).
- Produces:
  - `type DiffProjectionResult = { ok: true; statements: Statement[] } | { ok: false; message: string }`
  - `diffProjection(base: SchemaProjection, target: SchemaProjection): DiffProjectionResult`
  - `longestCommonSubsequence(a: readonly string[], b: readonly string[]): string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/changeset/diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { deleteTableCascade } from '../relationship.js'
import type { Column, ProjectModel } from '../model.js'
import { projectSchema } from './projection.js'
import { diffProjection, longestCommonSubsequence } from './diff.js'
import { emptyProjection, type Statement } from './types.js'

const S = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const proj = (m: ProjectModel) => projectSchema(m, S)
function diff(a: ProjectModel, b: ProjectModel): Statement[] {
  const r = diffProjection(proj(a), proj(b))
  if (!r.ok) throw new Error(r.message)
  return r.statements
}
const kinds = (st: Statement[]) => st.map((s) => s.kind)
const col = (over: Partial<Column> & Pick<Column, 'id' | 'tableId' | 'physicalName' | 'order'>): Column => ({
  logicalName: '', type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
  defaultValue: null, comment: null, domainId: null, custom: {}, ...over,
})

describe('diffProjection', () => {
  it('같으면 빈 목록이다', () => {
    expect(diff(buildSampleModel(), buildSampleModel())).toEqual([])
  })

  it('빈 투영에서는 테이블 생성(이름순) → 인덱스 → FK 다', () => {
    const r = diffProjection(emptyProjection(), proj(buildSampleModel()))
    if (!r.ok) throw new Error(r.message)
    expect(kinds(r.statements)).toEqual(['createTable', 'createTable', 'addIndex', 'addForeignKey'])
    expect(r.statements[0]).toEqual({
      kind: 'createTable',
      table: {
        id: 't2', name: 'MBR', comment: '회원 - 서비스 가입 회원',
        columns: [
          { id: 'c2', name: 'MBR_NO', type: 'BIGINT', dialectTypes: {}, nullable: false, default: null, increment: true, comment: '회원번호', check: [] },
          { id: 'c3', name: 'MBR_NM', type: 'VARCHAR(100)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '회원명', check: [] },
          { id: 'c4', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
        ],
        primaryKey: ['MBR_NO'],
        indexes: [],
      },
    })
  })

  it('컬럼 이름 변경은 rename 한 줄이다 — DROP+ADD 가 아니고, 그 컬럼을 쓰는 인덱스도 건드리지 않는다', () => {
    const b = buildSampleModel()
    b.columns['c3'] = { ...b.columns['c3']!, physicalName: 'MBR_NAME' }
    expect(diff(buildSampleModel(), b)).toEqual([
      { kind: 'alterTable', id: 't2', name: 'MBR', actions: [{ kind: 'renameColumn', id: 'c3', from: 'MBR_NM', to: 'MBR_NAME' }] },
    ])
  })

  it('컬럼 하나를 중간에 끼우면 add column 한 줄만 나온다 — 뒤쪽 컬럼의 position 변경이 없다', () => {
    const b = buildSampleModel()
    b.columns['c5'] = col({ id: 'c5', tableId: 't2', physicalName: 'MBR_EMAIL', logicalName: '이메일', type: 'VARCHAR(200)', order: 1 })
    b.columns['c3'] = { ...b.columns['c3']!, order: 2 }
    b.columns['c4'] = { ...b.columns['c4']!, order: 3 }
    expect(diff(buildSampleModel(), b)).toEqual([{
      kind: 'alterTable', id: 't2', name: 'MBR',
      actions: [{
        kind: 'addColumn', after: 'MBR_NO',
        column: { id: 'c5', name: 'MBR_EMAIL', type: 'VARCHAR(200)', dialectTypes: {}, nullable: true, default: null, increment: false, comment: '이메일', check: [] },
      }],
    }])
  })

  it('컬럼을 옮기면 옮긴 컬럼 하나의 position 만 나온다', () => {
    const b = buildSampleModel()
    b.columns['c4'] = { ...b.columns['c4']!, order: -1 }   // 맨 앞으로
    expect(diff(buildSampleModel(), b)).toEqual([{
      kind: 'alterTable', id: 't2', name: 'MBR',
      actions: [{ kind: 'modifyColumn', id: 'c4', name: 'GRD_CD', changes: [{ field: 'position', from: 'MBR_NM', to: null }] }],
    }])
  })

  it('도메인 타입 변경은 그 도메인을 쓰는 컬럼마다 modify 로 펼쳐진다', () => {
    const withDomain = (logicalType: string) => {
      const m = buildSampleModel()
      m.domains['d1'] = {
        id: 'd1', name: '명', category: null, logicalType,
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      }
      m.columns['c1'] = { ...m.columns['c1']!, domainId: 'd1' }
      m.columns['c3'] = { ...m.columns['c3']!, domainId: 'd1' }
      return m
    }
    const st = diff(withDomain('VARCHAR(100)'), withDomain('VARCHAR(200)'))
    expect(st.map((s) => s.kind === 'alterTable' ? [s.name, s.actions] : null)).toEqual([
      ['MBR', [{ kind: 'modifyColumn', id: 'c3', name: 'MBR_NM', changes: [{ field: 'type', from: 'VARCHAR(100)', to: 'VARCHAR(200)' }] }]],
      ['MBR_GRD', [{ kind: 'modifyColumn', id: 'c1', name: 'GRD_CD', changes: [{ field: 'type', from: 'VARCHAR(100)', to: 'VARCHAR(200)' }] }]],
    ])
  })

  it('문장 순서가 고정이다 — FK 삭제 → 인덱스 삭제 → 테이블 삭제 → 개명 → 생성 → 변경 → 인덱스 추가 → FK 추가', () => {
    const a = buildSampleModel()
    a.tables['t3'] = { id: 't3', logicalName: '', physicalName: 'TMP', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    a.columns['c9'] = col({ id: 'c9', tableId: 't3', physicalName: 'TMP_NO', order: 0 })
    let b: ProjectModel = structuredClone(a)
    b = deleteTableCascade(b, 't3')
    delete b.relationships['r1']
    b.relationships['r2'] = {
      id: 'r2', parentTableId: 't1', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }], cardinality: '1:1', identifying: false, name: null,
    }
    delete b.indexes['i1']
    b.indexes['i2'] = { id: 'i2', tableId: 't2', name: 'IX_MBR_02', columns: [{ columnId: 'c4', direction: 'desc' }], unique: false }
    b.tables['t1'] = { ...b.tables['t1']!, physicalName: 'GRD' }
    b.tables['t4'] = { id: 't4', logicalName: '', physicalName: 'NEW_TB', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    b.columns['c8'] = col({ id: 'c8', tableId: 't4', physicalName: 'NEW_NO', order: 0 })
    b.columns['c3'] = { ...b.columns['c3']!, physicalName: 'MBR_NAME' }
    const st = diff(a, b)
    expect(kinds(st)).toEqual([
      'dropForeignKey', 'dropIndex', 'dropTable', 'renameTable', 'createTable', 'alterTable', 'addIndex', 'addForeignKey',
    ])
    // 1:1 FK 는 DDL 이 함께 내는 UNIQUE 이름을 싣는다.
    expect(st[7]).toMatchObject({ kind: 'addForeignKey', fk: { name: 'FK_MBR_GRD', cardinality: '1:1', uniqueName: 'UQ_MBR_GRD_CD', child: 'MBR', parent: 'GRD' } })
    // 인덱스 삭제는 옛 이름, 추가는 새 이름으로 쓴다.
    expect(st[1]).toMatchObject({ kind: 'dropIndex', index: { name: 'UX_MBR_01', columns: [{ name: 'MBR_NM', direction: 'asc' }] } })
  })

  it('drop table 은 삭제 직전의 정의 전부를 싣고, 그 테이블의 인덱스는 따로 drop index 하지 않는다', () => {
    const b = deleteTableCascade(buildSampleModel(), 't2')
    const st = diff(buildSampleModel(), b)
    expect(kinds(st)).toEqual(['dropForeignKey', 'dropTable'])
    expect(st[1]).toMatchObject({
      kind: 'dropTable',
      table: {
        id: 't2', name: 'MBR', primaryKey: ['MBR_NO'],
        indexes: [{ id: 'i1', name: 'UX_MBR_01', table: 'MBR', columns: [{ name: 'MBR_NM', direction: 'asc' }], unique: true }],
      },
    })
    if (st[1]?.kind === 'dropTable') expect(st[1].table.columns.map((c) => c.name)).toEqual(['MBR_NO', 'MBR_NM', 'GRD_CD'])
  })

  it('지운 컬럼과 같은 이름으로 새 컬럼을 만들면 drop 이 add 보다 먼저다', () => {
    const b = buildSampleModel()
    delete b.columns['c3']
    delete b.indexes['i1']
    b.columns['c9'] = col({ id: 'c9', tableId: 't2', physicalName: 'MBR_NM', order: 1 })
    const st = diff(buildSampleModel(), b)
    const alter = st.find((s) => s.kind === 'alterTable')
    expect(alter?.kind === 'alterTable' ? alter.actions.map((x) => x.kind) : null).toEqual(['dropColumn', 'addColumn'])
  })

  it('PK 변경은 primary key 한 줄이다', () => {
    const b = buildSampleModel()
    b.columns['c3'] = { ...b.columns['c3']!, isPk: true }
    const st = diff(buildSampleModel(), b)
    expect(st).toEqual([{ kind: 'alterTable', id: 't2', name: 'MBR', actions: [{ kind: 'primaryKey', from: ['MBR_NO'], to: ['MBR_NO', 'MBR_NM'] }] }])
  })

  it('같은 물리명의 테이블·컬럼, 다른 테이블로 옮긴 컬럼은 거절한다', () => {
    const dupTable = buildSampleModel()
    dupTable.tables['t1'] = { ...dupTable.tables['t1']!, physicalName: 'MBR' }
    const r1 = diffProjection(proj(buildSampleModel()), proj(dupTable))
    expect(r1).toMatchObject({ ok: false })
    if (!r1.ok) expect(r1.message).toContain('같은 물리명의 테이블')

    const dupColumn = buildSampleModel()
    dupColumn.columns['c3'] = { ...dupColumn.columns['c3']!, physicalName: 'MBR_NO' }
    const r2 = diffProjection(proj(buildSampleModel()), proj(dupColumn))
    if (r2.ok) throw new Error('거절해야 한다')
    expect(r2.message).toContain('같은 물리명의 컬럼')

    const moved = buildSampleModel()
    moved.columns['c3'] = { ...moved.columns['c3']!, tableId: 't1', order: 5 }
    delete moved.indexes['i1']
    const r3 = diffProjection(proj(buildSampleModel()), proj(moved))
    if (r3.ok) throw new Error('거절해야 한다')
    expect(r3.message).toContain('다른 테이블')
  })
})

describe('longestCommonSubsequence', () => {
  it('최장 공통 부분열을 순서대로 돌려준다', () => {
    expect(longestCommonSubsequence(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'])).toHaveLength(3)
    expect(longestCommonSubsequence(['x', 'a', 'b'], ['a', 'b', 'x'])).toEqual(['a', 'b'])
    expect(longestCommonSubsequence([], ['a'])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/diff.test.ts`
Expected: FAIL — `Cannot find module './diff.js'`.

- [ ] **Step 3: 구현한다** — `packages/core/src/changeset/diff.ts`:

```ts
import { deepEqual } from '../equal.js'
import {
  compareCodeUnits,
  type AlterAction, type ColumnChange, type ColumnDef, type ForeignKeyDef, type IndexDef,
  type ProjColumn, type ProjForeignKey, type ProjIndex, type ProjTable, type SchemaProjection,
  type Statement, type TableDef,
} from './types.js'

export type DiffProjectionResult =
  | { ok: true; statements: Statement[] }
  | { ok: false; message: string }

/**
 * 기준선 → 현재의 차이를 기록 문장으로 낸다. 순서는 guide 「문장 순서」 그대로다 — 위에서 아래로
 * SQL 로 옮겨 써도 의존성이 맞는다.
 *
 * ⚠️ 모델 diff(`diffModels`·`diffModelsForDisplay`)와 섞지 마라. 저 둘은 모델 전체가 대상이고
 * 용도가 고정돼 있다. 이 함수는 스키마 투영만 본다.
 */
export function diffProjection(base: SchemaProjection, target: SchemaProjection): DiffProjectionResult {
  const refusal = refusalOf(base, target)
  if (refusal !== null) return { ok: false, message: refusal }
  const out: Statement[] = []

  // 1. FK 삭제 — 내용이 바뀐 FK 도 지웠다가 8번에서 다시 만든다(대부분의 DB 가 FK 를 고치지 못한다).
  for (const fk of sortedForeignKeys(base)) {
    const next = target.foreignKeys[fk.id]
    if (next === undefined || !deepEqual(fk, next)) out.push({ kind: 'dropForeignKey', fk: foreignKeyDef(base, fk) })
  }
  // 2. 인덱스 삭제·개명 — 사라지는 테이블의 인덱스는 3번 drop table 블록이 싣는다.
  for (const ix of sortedIndexes(base)) {
    if (target.tables[ix.tableId] === undefined) continue
    const next = target.indexes[ix.id]
    if (next === undefined || !sameIndexContent(ix, next)) {
      out.push({ kind: 'dropIndex', index: indexDef(base, ix) })
    } else if (next.name !== ix.name) {
      out.push({ kind: 'renameIndex', id: ix.id, table: base.tables[ix.tableId]!.name, from: ix.name, to: next.name })
    }
  }
  // 3. 테이블 삭제 — 개명·생성보다 먼저여야 「지운 테이블의 이름」을 곧바로 쓸 수 있다.
  for (const t of sortedTables(base)) {
    if (target.tables[t.id] === undefined) out.push({ kind: 'dropTable', table: tableDef(base, t, true) })
  }
  // 4. 테이블 개명
  for (const t of sortedTables(base)) {
    const next = target.tables[t.id]
    if (next !== undefined && next.name !== t.name) out.push({ kind: 'renameTable', id: t.id, from: t.name, to: next.name })
  }
  // 5. 테이블 생성
  for (const t of sortedTables(target)) {
    if (base.tables[t.id] === undefined) out.push({ kind: 'createTable', table: tableDef(target, t, false) })
  }
  // 6. 테이블 변경
  for (const t of sortedTables(target)) {
    const prev = base.tables[t.id]
    if (prev === undefined) continue
    const actions = alterActions(base, target, prev, t)
    if (actions.length > 0) out.push({ kind: 'alterTable', id: t.id, name: t.name, actions })
  }
  // 7. 인덱스 추가
  for (const ix of sortedIndexes(target)) {
    const prev = base.indexes[ix.id]
    if (prev === undefined || !sameIndexContent(prev, ix)) out.push({ kind: 'addIndex', index: indexDef(target, ix) })
  }
  // 8. FK 추가
  for (const fk of sortedForeignKeys(target)) {
    const prev = base.foreignKeys[fk.id]
    if (prev === undefined || !deepEqual(prev, fk)) out.push({ kind: 'addForeignKey', fk: foreignKeyDef(target, fk) })
  }
  return { ok: true, statements: out }
}

/**
 * 기록을 만들 수 없는 상태(guide 「기록을 만들 수 없는 경우」). 재생이 FK·인덱스·PK·`after` 를
 * **이름으로** 풀기 때문에 같은 이름이 둘이면 어느 쪽인지 정할 수 없다. 컬럼의 소속 이동은
 * 문장으로 표현할 자리가 없다(drop 과 add 가 다른 테이블 블록에 흩어져 순서를 보장할 수 없다).
 */
function refusalOf(base: SchemaProjection, target: SchemaProjection): string | null {
  const tableNames = new Set<string>()
  for (const t of Object.values(target.tables)) {
    if (tableNames.has(t.name)) return `같은 물리명의 테이블이 둘 있습니다: ${t.name} — 이름을 고친 뒤 기록하세요`
    tableNames.add(t.name)
    const columnNames = new Set<string>()
    for (const id of t.columnIds) {
      const c = target.columns[id]!
      if (columnNames.has(c.name)) return `${t.name} 테이블에 같은 물리명의 컬럼이 둘 있습니다: ${c.name} — 이름을 고친 뒤 기록하세요`
      columnNames.add(c.name)
    }
  }
  for (const c of Object.values(target.columns)) {
    const prev = base.columns[c.id]
    if (prev !== undefined && prev.tableId !== c.tableId) {
      const from = base.tables[prev.tableId]?.name ?? prev.tableId
      const to = target.tables[c.tableId]?.name ?? c.tableId
      return `컬럼 ${from}.${prev.name} 이(가) 다른 테이블(${to})로 옮겨졌습니다 — 옮긴 컬럼은 id 를 지워 새 컬럼으로 만드세요`
    }
  }
  return null
}

function alterActions(base: SchemaProjection, target: SchemaProjection, prev: ProjTable, next: ProjTable): AlterAction[] {
  const actions: AlterAction[] = []
  const inNext = new Set(next.columnIds)
  const inPrev = new Set(prev.columnIds)
  const nameNow = (id: string) => target.columns[id]?.name ?? base.columns[id]!.name

  for (const id of prev.columnIds) {
    if (!inNext.has(id)) actions.push({ kind: 'dropColumn', column: columnDef(base.columns[id]!) })
  }
  for (const id of next.columnIds) {
    if (!inPrev.has(id)) continue
    const a = base.columns[id]!
    const b = target.columns[id]!
    if (a.name !== b.name) actions.push({ kind: 'renameColumn', id, from: a.name, to: b.name })
  }
  // 옮겨진 컬럼 = 양쪽에 다 있지만 최장 공통 부분열에 들지 못한 것(guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」).
  const stable = new Set(longestCommonSubsequence(
    prev.columnIds.filter((id) => inNext.has(id)),
    next.columnIds.filter((id) => inPrev.has(id)),
  ))
  const predecessor = (list: readonly string[], i: number): string | null => (i <= 0 ? null : nameNow(list[i - 1]!))
  next.columnIds.forEach((id, i) => {
    if (!inPrev.has(id)) actions.push({ kind: 'addColumn', column: columnDef(target.columns[id]!), after: predecessor(next.columnIds, i) })
  })
  next.columnIds.forEach((id, i) => {
    if (!inPrev.has(id)) return
    const changes = columnChanges(base.columns[id]!, target.columns[id]!)
    if (!stable.has(id)) {
      changes.push({ field: 'position', from: predecessor(prev.columnIds, prev.columnIds.indexOf(id)), to: predecessor(next.columnIds, i) })
    }
    if (changes.length > 0) actions.push({ kind: 'modifyColumn', id, name: target.columns[id]!.name, changes })
  })
  // 지운 PK 컬럼은 drop column 이 PK 에서도 뺀다 — 비교는 그 뒤의 상태와 한다.
  const prevPk = prev.primaryKey.filter((id) => inNext.has(id))
  if (!deepEqual(prevPk, next.primaryKey)) {
    actions.push({ kind: 'primaryKey', from: prevPk.map(nameNow), to: next.primaryKey.map(nameNow) })
  }
  if (prev.comment !== next.comment) actions.push({ kind: 'tableComment', from: prev.comment, to: next.comment })
  return actions
}

function columnChanges(a: ProjColumn, b: ProjColumn): ColumnChange[] {
  const out: ColumnChange[] = []
  if (a.type !== b.type) out.push({ field: 'type', from: a.type, to: b.type })
  if (!deepEqual(a.dialectTypes, b.dialectTypes)) out.push({ field: 'dialects', from: { ...a.dialectTypes }, to: { ...b.dialectTypes } })
  if (a.nullable !== b.nullable) out.push({ field: 'nullable', from: a.nullable, to: b.nullable })
  if (a.default !== b.default) out.push({ field: 'default', from: a.default, to: b.default })
  if (a.increment !== b.increment) out.push({ field: 'increment', from: a.increment, to: b.increment })
  if (a.comment !== b.comment) out.push({ field: 'comment', from: a.comment, to: b.comment })
  if (!deepEqual(a.check, b.check)) out.push({ field: 'check', from: [...a.check], to: [...b.check] })
  return out
}

/** 최장 공통 부분열. 한 테이블의 컬럼 수 정도라 O(n·m) 로 충분하다. */
export function longestCommonSubsequence(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(a[i]!); i += 1; j += 1 }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1
    else j += 1
  }
  return out
}

const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
  compareCodeUnits(a.name, b.name) || compareCodeUnits(a.id, b.id)

function sortedTables(p: SchemaProjection): ProjTable[] {
  return Object.values(p.tables).sort(byName)
}
function sortedIndexes(p: SchemaProjection): ProjIndex[] {
  return Object.values(p.indexes).sort((a, b) =>
    compareCodeUnits(p.tables[a.tableId]?.name ?? '', p.tables[b.tableId]?.name ?? '') || byName(a, b))
}
function sortedForeignKeys(p: SchemaProjection): ProjForeignKey[] {
  return Object.values(p.foreignKeys).sort(byName)
}
function sameIndexContent(a: ProjIndex, b: ProjIndex): boolean {
  return a.tableId === b.tableId && a.unique === b.unique && deepEqual(a.columns, b.columns)
}

function columnDef(c: ProjColumn): ColumnDef {
  return {
    id: c.id, name: c.name, type: c.type, dialectTypes: { ...c.dialectTypes }, nullable: c.nullable,
    default: c.default, increment: c.increment, comment: c.comment, check: [...c.check],
  }
}
const columnName = (p: SchemaProjection, id: string) => p.columns[id]?.name ?? id
const tableName = (p: SchemaProjection, id: string) => p.tables[id]?.name ?? id

function indexDef(p: SchemaProjection, ix: ProjIndex): IndexDef {
  return {
    id: ix.id, name: ix.name, table: tableName(p, ix.tableId),
    columns: ix.columns.map((c) => ({ name: columnName(p, c.columnId), direction: c.direction })),
    unique: ix.unique,
  }
}
function foreignKeyDef(p: SchemaProjection, fk: ProjForeignKey): ForeignKeyDef {
  return {
    id: fk.id, name: fk.name,
    child: tableName(p, fk.childTableId), childColumns: fk.childColumnIds.map((id) => columnName(p, id)),
    parent: tableName(p, fk.parentTableId), parentColumns: fk.parentColumnIds.map((id) => columnName(p, id)),
    cardinality: fk.cardinality, uniqueName: fk.uniqueName,
  }
}
function tableDef(p: SchemaProjection, t: ProjTable, withIndexes: boolean): TableDef {
  return {
    id: t.id, name: t.name, comment: t.comment,
    columns: t.columnIds.map((id) => columnDef(p.columns[id]!)),
    primaryKey: t.primaryKey.map((id) => columnName(p, id)),
    indexes: withIndexes ? sortedIndexes(p).filter((ix) => ix.tableId === t.id).map((ix) => indexDef(p, ix)) : [],
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/diff.test.ts; pnpm -C packages/core typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: 구분력을 확인한다** — `alterActions` 의 `if (!stable.has(id))` 를 `if (true)` 로 바꾸면 「중간에 끼우면 add 한 줄」 테스트가 실패해야 한다. 확인 후 되돌린다. `refusalOf` 의 소속 이동 검사를 지우면 「다른 테이블」 단언이 실패해야 한다. 확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/changeset/diff.ts packages/core/src/changeset/diff.test.ts && git commit -m "feat(core): 스키마 투영의 차이를 SQL 로 옮기기 안전한 순서의 문장으로 낸다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/changeset/diff.ts packages/core/src/changeset/diff.test.ts
```

---

### Task 4: 표기 규칙·직렬화·파서

**Files:**
- Create: `packages/core/src/changeset/syntax.ts`
- Create: `packages/core/src/changeset/format.ts`
- Create: `packages/core/src/changeset/parse.ts`
- Test: `packages/core/src/changeset/format.test.ts`, `packages/core/src/changeset/parse.test.ts`

**Interfaces:**
- Consumes: Task 2 의 타입.
- Produces:
  - `syntax.ts`: `fmtIdent`, `fmtType`, `fmtString`, `fmtRaw`, `fmtIdentList`, `fmtNullableString`, `fmtFieldValue(field: ColumnChange['field'], value: unknown): string`, `class ParseFailure extends Error { line: number }`, `class Cursor`.
  - `format.ts`: `CHANGESET_BANNER: string`, `formatStatements(statements: readonly Statement[]): string`, `formatChangeset(cs: Changeset): string`.
  - `parse.ts`: `type ParseChangesetResult = { ok: true; changeset: Changeset } | { ok: false; line: number; message: string }`, `parseChangeset(text: string): ParseChangesetResult`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/changeset/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CHANGESET_BANNER, formatChangeset } from './format.js'
import { fmtIdent, fmtRaw, fmtString, fmtType } from './syntax.js'
import type { Changeset } from './types.js'

/** 줄 끝 꼬리표 규칙: 64열에 맞추고, 본문이 길면 두 칸 띄운다. */
const tag = (text: string, id: string) => `${text.padEnd(Math.max(64, text.length + 2))}@${id}`

describe('값 표기', () => {
  it('식별자는 안전하면 그대로, 아니면 큰따옴표 — 값 자리 키워드와 같은 이름도 감싼다', () => {
    expect(fmtIdent('MBR_NO')).toBe('MBR_NO')
    expect(fmtIdent('주문 상세')).toBe('"주문 상세"')
    expect(fmtIdent('first')).toBe('"first"')
    expect(fmtIdent('none')).toBe('"none"')
    expect(fmtIdent('FIRST')).toBe('FIRST')
    expect(fmtIdent('a"b')).toBe('"a\\"b"')
  })
  it('타입은 이름 + 괄호 하나까지 그대로, 공백이 있으면 큰따옴표', () => {
    expect(fmtType('VARCHAR(10)')).toBe('VARCHAR(10)')
    expect(fmtType('DECIMAL(10, 2)')).toBe('DECIMAL(10, 2)')
    expect(fmtType('INT UNSIGNED')).toBe('"INT UNSIGNED"')
  })
  it('문자열·기본값은 \\ 와 따옴표·줄바꿈만 이스케이프한다', () => {
    expect(fmtString("a'b\nc\\")).toBe("'a\\'b\\nc\\\\'")
    expect(fmtRaw("it's `x`")).toBe("`it's \\`x\\``")
  })
})

describe('formatChangeset', () => {
  it('머릿말 → 빈 줄 → 문장. 블록 앞뒤에만 빈 줄을 두고 줄 끝에 @id 를 단다', () => {
    const cs: Changeset = {
      header: { format: 1, name: '회원 등급 추가', created: '2026-09-23T04:12:00Z', baseline: false },
      statements: [
        { kind: 'dropIndex', index: { id: 'i9', name: 'IX_OLD', table: 'MBR', columns: [{ name: 'MBR_NM', direction: 'asc' }], unique: false } },
        { kind: 'renameTable', id: 't9', from: 'ORD_DTL', to: 'ORD_ITEM' },
        {
          kind: 'alterTable', id: 't2', name: 'MBR', actions: [
            {
              kind: 'addColumn', after: 'MBR_NM',
              column: { id: 'c5', name: 'GRD_CD', type: 'VARCHAR(10)', dialectTypes: {}, nullable: true, default: null, increment: false, comment: '등급코드', check: [] },
            },
            { kind: 'modifyColumn', id: 'c3', name: 'MBR_NM', changes: [{ field: 'type', from: 'VARCHAR(50)', to: 'VARCHAR(100)' }, { field: 'nullable', from: true, to: false }] },
            { kind: 'primaryKey', from: ['MBR_NO'], to: ['MBR_NO', 'GRD_CD'] },
          ],
        },
        { kind: 'addForeignKey', fk: { id: 'r1', name: 'FK_MBR_GRD', child: 'MBR', childColumns: ['GRD_CD'], parent: 'GRD', parentColumns: ['GRD_CD'], cardinality: '1:1', uniqueName: 'UQ_MBR_GRD_CD' } },
      ],
    }
    expect(formatChangeset(cs)).toBe([
      CHANGESET_BANNER,
      "changeset '회원 등급 추가' {",
      '  format: 1',
      "  created: '2026-09-23T04:12:00Z'",
      '}',
      '',
      tag('drop index IX_OLD on MBR (MBR_NM asc)', 'i9'),
      tag('rename table ORD_DTL -> ORD_ITEM', 't9'),
      '',
      tag('alter table MBR {', 't2'),
      tag("  add column GRD_CD VARCHAR(10) [null, comment: '등급코드', after: MBR_NM]", 'c5'),
      tag('  modify column MBR_NM {', 'c3'),
      '    type: VARCHAR(50) -> VARCHAR(100)',
      '    nullable: yes -> no',
      '  }',
      '  primary key: (MBR_NO) -> (MBR_NO, GRD_CD)',
      '}',
      '',
      tag('add foreign key FK_MBR_GRD MBR(GRD_CD) -> GRD(GRD_CD) [1:1, unique: UQ_MBR_GRD_CD]', 'r1'),
      '',
    ].join('\n'))
  })

  it('baseline 이면 머릿말에 baseline: true 를 싣고, 문장이 없으면 머릿말만 낸다', () => {
    const text = formatChangeset({ header: { format: 1, name: 'x', created: '2026-01-01T00:00:00Z', baseline: true }, statements: [] })
    expect(text).toBe(`${CHANGESET_BANNER}\nchangeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n  baseline: true\n}\n`)
  })
})
```

`packages/core/src/changeset/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import type { Changeset, ColumnDef } from './types.js'

const col = (id: string, name: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id, name, type: 'VARCHAR(10)', dialectTypes: {}, nullable: true, default: null,
  increment: false, comment: null, check: [], ...extra,
})

/** 문법이 표현하는 모든 문장·동작·값을 한 번씩 지나가는 기록. */
const ALL: Changeset = {
  header: { format: 1, name: "이름에 '따옴표'", created: '2026-09-23T04:12:00Z', baseline: true },
  statements: [
    { kind: 'dropForeignKey', fk: { id: 'r1', name: 'FK_A', child: 'ORD', childColumns: ['MBR_NO'], parent: 'MBR', parentColumns: ['MBR_NO'], cardinality: '1:1', uniqueName: 'UQ_ORD_MBR_NO' } },
    { kind: 'dropIndex', index: { id: 'i1', name: 'IX_A', table: 'ORD', columns: [{ name: 'A', direction: 'asc' }, { name: 'B', direction: 'desc' }], unique: true } },
    { kind: 'renameIndex', id: 'i2', table: 'ORD', from: 'IX_B', to: 'IX_C' },
    {
      kind: 'dropTable', table: {
        id: 't1', name: '주문 상세', comment: '줄\n바꿈',
        columns: [col('c1', 'first', { nullable: false, increment: true, type: 'BIGINT' })],
        primaryKey: ['first'],
        indexes: [{ id: 'i3', name: 'IX_D', table: '주문 상세', columns: [{ name: 'first', direction: 'desc' }], unique: false }],
      },
    },
    { kind: 'renameTable', id: 't2', from: 'OLD', to: 'NEW' },
    {
      kind: 'createTable', table: {
        id: 't3', name: 'T3', comment: null,
        columns: [
          col('c2', 'A', { type: 'INT UNSIGNED', default: "it's `x`\\", check: ['Y', 'N'], dialectTypes: { postgresql: 'TEXT', mssql: 'NVARCHAR(10)' }, comment: 'c' }),
          col('c3', 'none', { type: 'DECIMAL(10, 2)' }),
        ],
        primaryKey: [], indexes: [],
      },
    },
    {
      kind: 'alterTable', id: 't4', name: 'MBR', actions: [
        { kind: 'dropColumn', column: col('c4', 'X') },
        { kind: 'renameColumn', id: 'c5', from: 'A', to: 'B' },
        { kind: 'addColumn', column: col('c6', 'C'), after: null },
        { kind: 'addColumn', column: col('c7', 'D'), after: 'first' },
        {
          kind: 'modifyColumn', id: 'c8', name: 'E', changes: [
            { field: 'type', from: 'VARCHAR(1)', to: 'DECIMAL(10, 2)' },
            { field: 'dialects', from: {}, to: { mysql: 'TEXT' } },
            { field: 'nullable', from: true, to: false },
            { field: 'default', from: null, to: "'a'" },
            { field: 'increment', from: false, to: true },
            { field: 'comment', from: 'x', to: null },
            { field: 'check', from: [], to: ['1'] },
            { field: 'position', from: 'A', to: null },
          ],
        },
        { kind: 'primaryKey', from: [], to: ['B', 'C'] },
        { kind: 'tableComment', from: null, to: "회원 '기본'" },
      ],
    },
    { kind: 'addIndex', index: { id: 'i4', name: 'IX_E', table: 'MBR', columns: [{ name: 'B', direction: 'asc' }], unique: false } },
    { kind: 'addForeignKey', fk: { id: 'r2', name: 'FK_B', child: 'MBR', childColumns: ['B', 'C'], parent: 'NEW', parentColumns: ['X', 'Y'], cardinality: '1:N', uniqueName: null } },
  ],
}

/** 파서가 붙이는 줄 번호를 걷어 원본과 비교한다. */
const stripLines = <T>(v: T): T => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'line' ? undefined : x))) as T

describe('parseChangeset', () => {
  it('직렬화한 것을 그대로 되읽는다 — 모든 문장·동작·값', () => {
    const r = parseChangeset(formatChangeset(ALL))
    if (!r.ok) throw new Error(`${r.line}: ${r.message}`)
    expect(stripLines(r.changeset)).toEqual(ALL)
  })

  it('문장과 동작에 원본의 줄 번호를 붙인다', () => {
    const text = formatChangeset(ALL)
    const r = parseChangeset(text)
    if (!r.ok) throw new Error(r.message)
    const lines = text.split('\n')
    const alter = r.changeset.statements.find((s) => s.kind === 'alterTable')!
    expect(lines[alter.line! - 1]).toContain('alter table MBR {')
    if (alter.kind === 'alterTable') expect(lines[alter.actions[1]!.line! - 1]).toContain('rename column A -> B')
  })

  it('CRLF·BOM·들여쓰기가 달라도 읽는다', () => {
    const text = `﻿${formatChangeset(ALL)}`.replace(/\n/g, '\r\n').replace(/\r\n {2}column/g, '\r\n\tcolumn')
    const r = parseChangeset(text)
    if (!r.ok) throw new Error(`${r.line}: ${r.message}`)
    expect(stripLines(r.changeset)).toEqual(ALL)
  })

  it('머릿말이 없으면 1행에서 멈춘다', () => {
    expect(parseChangeset('')).toMatchObject({ ok: false, line: 1 })
    expect(parseChangeset('rename table A -> B  @t1\n')).toMatchObject({ ok: false, line: 1 })
  })

  it('모르는 문장·빠진 @id·더 새 format·닫히지 않은 문자열은 그 줄에서 멈춘다', () => {
    const head = "changeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n}\n"
    expect(parseChangeset(`${head}truncate table A  @t1\n`)).toMatchObject({ ok: false, line: 5 })
    expect(parseChangeset(`${head}rename table A -> B\n`)).toMatchObject({ ok: false, line: 5 })
    const future = parseChangeset("changeset 'x' {\n  format: 2\n  created: 'x'\n}\n")
    expect(future).toMatchObject({ ok: false })
    if (!future.ok) expect(future.message).toContain('CLI 를 올리세요')
    expect(parseChangeset(`${head}alter table A {  @t1\n  comment: 'a -> 'b'\n}\n`)).toMatchObject({ ok: false, line: 6 })
  })

  it('// 주석 줄과 빈 줄은 건너뛴다', () => {
    const r = parseChangeset("// 머리 주석\n\nchangeset 'x' {\n  format: 1\n  created: 'c'\n}\n// 문장 사이 주석\nrename table A -> B  @t1\n")
    if (!r.ok) throw new Error(r.message)
    expect(r.changeset.statements).toEqual([{ kind: 'renameTable', id: 't1', from: 'A', to: 'B', line: 8 }])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/format.test.ts src/changeset/parse.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `syntax.ts` 를 구현한다**

```ts
import { DIALECTS, type Dialect } from '../dialect.js'
import type { ColumnChange, DialectTypes } from './types.js'

// ── 값 표기 — guide 「문법」. 직렬화와 파서가 이 파일 하나를 공유한다 ──

const BARE_IDENT = /^[A-Za-z_][A-Za-z0-9_$#]*$/
const BARE_TYPE = /^[A-Za-z][A-Za-z0-9_]*(\([^()"\n\r]*\))?$/
/** 값 자리의 키워드. 같은 이름의 식별자는 큰따옴표로 감싸 키워드와 갈라진다. */
const VALUE_KEYWORDS = new Set(['first', 'none'])

function escape(s: string, quote: '"' | "'" | '`'): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${quote}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else out += ch
  }
  return out
}

export const fmtIdent = (s: string): string =>
  BARE_IDENT.test(s) && !VALUE_KEYWORDS.has(s) ? s : `"${escape(s, '"')}"`
export const fmtType = (s: string): string => (BARE_TYPE.test(s) ? s : `"${escape(s, '"')}"`)
export const fmtString = (s: string): string => `'${escape(s, "'")}'`
export const fmtRaw = (s: string): string => `\`${escape(s, '`')}\``
const fmtBool = (b: boolean): string => (b ? 'yes' : 'no')
export const fmtNullableString = (s: string | null): string => (s === null ? 'none' : fmtString(s))
const fmtDefault = (s: string | null): string => (s === null ? 'none' : fmtRaw(s))
export const fmtIdentList = (names: readonly string[]): string =>
  names.length === 0 ? 'none' : `(${names.map(fmtIdent).join(', ')})`
export const fmtCheckList = (values: readonly string[]): string =>
  values.length === 0 ? 'none' : `(${values.map(fmtString).join(', ')})`
function fmtDialects(d: DialectTypes): string {
  const parts = DIALECTS.flatMap((k) => (d[k] === undefined ? [] : [`${k}: ${fmtType(d[k])}`]))
  return parts.length === 0 ? 'none' : `(${parts.join(', ')})`
}
const fmtPosition = (after: string | null): string => (after === null ? 'first' : `after ${fmtIdent(after)}`)

/** modify column 의 이전·이후 값. 경합 경고도 이 표기로 현재 값을 보여 준다. */
export function fmtFieldValue(field: ColumnChange['field'], v: unknown): string {
  switch (field) {
    case 'type': return fmtType(v as string)
    case 'dialects': return fmtDialects(v as DialectTypes)
    case 'nullable':
    case 'increment': return fmtBool(v as boolean)
    case 'default': return fmtDefault(v as string | null)
    case 'comment': return fmtNullableString(v as string | null)
    case 'check': return fmtCheckList(v as string[])
    case 'position': return fmtPosition(v as string | null)
  }
}

// ── 파서 커서 — 한 줄 안을 읽는다 ──

export class ParseFailure extends Error {
  constructor(readonly line: number, message: string) {
    super(message)
    this.name = 'ParseFailure'
  }
}

const IDENT_CHAR = /[A-Za-z0-9_$#]/

export class Cursor {
  #pos = 0
  constructor(readonly text: string, readonly line: number) {}

  fail(message: string): never { throw new ParseFailure(this.line, message) }

  #ws(): void {
    while (this.#pos < this.text.length && (this.text[this.#pos] === ' ' || this.text[this.#pos] === '\t')) this.#pos += 1
  }
  #rest(): string { return this.text.slice(this.#pos) }
  #near(): string {
    const r = this.#rest().trim()
    return r === '' ? '줄 끝' : `'${r.slice(0, 24)}'`
  }

  atEnd(): boolean { this.#ws(); return this.#pos >= this.text.length }
  end(): void { if (!this.atEnd()) this.fail(`줄 끝이어야 하는데 ${this.#near()} 이(가) 있습니다`) }

  /** 단어 경계까지 맞는 키워드. 공백으로 나뉜 여러 단어(`not null`, `drop foreign key`)도 받는다. */
  tryWord(word: string): boolean {
    this.#ws()
    let pos = this.#pos
    for (const [i, part] of word.split(' ').entries()) {
      if (i > 0) {
        const m = /^[ \t]+/.exec(this.text.slice(pos))
        if (m === null) return false
        pos += m[0].length
      }
      if (!this.text.startsWith(part, pos)) return false
      pos += part.length
    }
    const next = this.text[pos]
    if (next !== undefined && IDENT_CHAR.test(next)) return false
    this.#pos = pos
    return true
  }
  word(word: string): void {
    if (!this.tryWord(word)) this.fail(`'${word}' 이(가) 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  trySymbol(sym: string): boolean {
    this.#ws()
    if (!this.text.startsWith(sym, this.#pos)) return false
    this.#pos += sym.length
    return true
  }
  symbol(sym: string): void {
    if (!this.trySymbol(sym)) this.fail(`'${sym}' 이(가) 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }

  #quoted(quote: '"' | "'" | '`', what: string): string {
    let out = ''
    let i = this.#pos + 1
    for (;;) {
      const ch = this.text[i]
      if (ch === undefined) this.fail(`${what}의 닫는 ${quote} 가 없습니다`)
      if (ch === quote) { this.#pos = i + 1; return out }
      if (ch === '\\') {
        const nx = this.text[i + 1]
        if (nx === 'n') out += '\n'
        else if (nx === 'r') out += '\r'
        else if (nx === '\\' || nx === quote) out += nx
        else this.fail(`${what} 안의 알 수 없는 이스케이프입니다: \\${nx ?? ''}`)
        i += 2
        continue
      }
      out += ch
      i += 1
    }
  }

  ident(): string {
    this.#ws()
    if (this.text[this.#pos] === '"') return this.#quoted('"', '이름')
    const m = /^[A-Za-z_][A-Za-z0-9_$#]*/.exec(this.#rest())
    if (m === null) this.fail(`이름이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return m[0]
  }
  type(): string {
    this.#ws()
    if (this.text[this.#pos] === '"') return this.#quoted('"', '타입')
    const m = /^[A-Za-z][A-Za-z0-9_]*(\([^()"\n\r]*\))?/.exec(this.#rest())
    if (m === null) this.fail(`타입이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return m[0]
  }
  string(): string {
    this.#ws()
    if (this.text[this.#pos] !== "'") this.fail(`'…' 문자열이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    return this.#quoted("'", '문자열')
  }
  raw(): string {
    this.#ws()
    if (this.text[this.#pos] !== '`') this.fail(`\`…\` 기본값이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    return this.#quoted('`', '기본값')
  }
  integer(): number {
    this.#ws()
    const m = /^\d+/.exec(this.#rest())
    if (m === null) this.fail(`숫자가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return Number(m[0])
  }

  bool(): boolean {
    if (this.tryWord('yes')) return true
    if (this.tryWord('no')) return false
    return this.fail(`yes 또는 no 가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  trueFalse(): boolean {
    if (this.tryWord('true')) return true
    if (this.tryWord('false')) return false
    return this.fail(`true 또는 false 가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  nullableString(): string | null { return this.tryWord('none') ? null : this.string() }
  defaultValue(): string | null { return this.tryWord('none') ? null : this.raw() }
  identList(): string[] {
    if (this.tryWord('none')) return []
    this.symbol('(')
    const out = [this.ident()]
    while (this.trySymbol(',')) out.push(this.ident())
    this.symbol(')')
    return out
  }
  checkList(): string[] {
    if (this.tryWord('none')) return []
    this.symbol('(')
    const out = [this.string()]
    while (this.trySymbol(',')) out.push(this.string())
    this.symbol(')')
    return out
  }
  tryDialect(): Dialect | null {
    for (const d of DIALECTS) if (this.tryWord(d)) return d
    return null
  }
  dialects(): DialectTypes {
    if (this.tryWord('none')) return {}
    this.symbol('(')
    const out: DialectTypes = {}
    do {
      const d = this.tryDialect()
      if (d === null) this.fail(`방언 이름(${DIALECTS.join('·')})이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
      this.symbol(':')
      out[d] = this.type()
    } while (this.trySymbol(','))
    this.symbol(')')
    return out
  }
  position(): string | null {
    if (this.tryWord('first')) return null
    this.word('after')
    return this.ident()
  }
}
```

- [ ] **Step 4: `format.ts` 를 구현한다**

```ts
import { DIALECTS } from '../dialect.js'
import type { AlterAction, Changeset, ColumnDef, ForeignKeyDef, IndexDef, Statement, TableDef } from './types.js'
import {
  fmtCheckList, fmtFieldValue, fmtIdent, fmtIdentList, fmtNullableString, fmtRaw, fmtString, fmtType,
} from './syntax.js'

/** 모든 기록 파일의 첫 줄. 사람이 파일을 처음 열었을 때 무엇인지 알게 한다. */
export const CHANGESET_BANNER = '// ERDD 변경 기록 — 이 파일을 보고 마이그레이션을 직접 작성한다. 만든 뒤에는 고치지 않는다'

const TAG_COLUMN = 64

/** 줄 끝 `@id` 꼬리표. 사람이 건너뛰기 쉽게 같은 열에 맞춘다(guide 「재생은 `@id` 로 대상을 찾는다」). */
function tagged(text: string, id: string): string {
  return `${text.padEnd(Math.max(TAG_COLUMN, text.length + 2))}@${id}`
}

function columnAttrs(c: ColumnDef, after?: string | null): string {
  const parts = [c.nullable ? 'null' : 'not null']
  if (c.increment) parts.push('increment')
  if (c.default !== null) parts.push(`default: ${fmtRaw(c.default)}`)
  if (c.comment !== null) parts.push(`comment: ${fmtString(c.comment)}`)
  if (c.check.length > 0) parts.push(`check: ${fmtCheckList(c.check)}`)
  for (const d of DIALECTS) {
    const v = c.dialectTypes[d]
    if (v !== undefined) parts.push(`${d}: ${fmtType(v)}`)
  }
  if (after !== undefined) parts.push(after === null ? 'first' : `after: ${fmtIdent(after)}`)
  return `[${parts.join(', ')}]`
}
const columnLine = (c: ColumnDef, after?: string | null) =>
  `${fmtIdent(c.name)} ${fmtType(c.type)} ${columnAttrs(c, after)}`
const indexColumns = (ix: IndexDef) =>
  `(${ix.columns.map((c) => `${fmtIdent(c.name)} ${c.direction}`).join(', ')})`
const uniqueTail = (ix: IndexDef) => (ix.unique ? ' [unique]' : '')
const indexLine = (ix: IndexDef) => `${fmtIdent(ix.name)} on ${fmtIdent(ix.table)} ${indexColumns(ix)}${uniqueTail(ix)}`
function fkLine(fk: ForeignKeyDef): string {
  const child = `${fmtIdent(fk.child)}(${fk.childColumns.map(fmtIdent).join(', ')})`
  const parent = `${fmtIdent(fk.parent)}(${fk.parentColumns.map(fmtIdent).join(', ')})`
  const unique = fk.uniqueName === null ? '' : `, unique: ${fmtIdent(fk.uniqueName)}`
  return `${fmtIdent(fk.name)} ${child} -> ${parent} [${fk.cardinality}${unique}]`
}

function tableBlock(verb: 'create' | 'drop', t: TableDef): string[] {
  const comment = t.comment === null ? '' : ` [comment: ${fmtString(t.comment)}]`
  const lines = [tagged(`${verb} table ${fmtIdent(t.name)}${comment} {`, t.id)]
  for (const c of t.columns) lines.push(tagged(`  column ${columnLine(c)}`, c.id))
  if (t.primaryKey.length > 0) lines.push(`  primary key ${fmtIdentList(t.primaryKey)}`)
  for (const ix of t.indexes) lines.push(tagged(`  index ${fmtIdent(ix.name)} ${indexColumns(ix)}${uniqueTail(ix)}`, ix.id))
  lines.push('}')
  return lines
}

function alterLines(a: AlterAction): string[] {
  switch (a.kind) {
    case 'dropColumn': return [tagged(`  drop column ${columnLine(a.column)}`, a.column.id)]
    case 'renameColumn': return [tagged(`  rename column ${fmtIdent(a.from)} -> ${fmtIdent(a.to)}`, a.id)]
    case 'addColumn': return [tagged(`  add column ${columnLine(a.column, a.after)}`, a.column.id)]
    case 'modifyColumn': return [
      tagged(`  modify column ${fmtIdent(a.name)} {`, a.id),
      ...a.changes.map((ch) => `    ${ch.field}: ${fmtFieldValue(ch.field, ch.from)} -> ${fmtFieldValue(ch.field, ch.to)}`),
      '  }',
    ]
    case 'primaryKey': return [`  primary key: ${fmtIdentList(a.from)} -> ${fmtIdentList(a.to)}`]
    case 'tableComment': return [`  comment: ${fmtNullableString(a.from)} -> ${fmtNullableString(a.to)}`]
  }
}

function statementLines(s: Statement): string[] {
  switch (s.kind) {
    case 'dropForeignKey': return [tagged(`drop foreign key ${fkLine(s.fk)}`, s.fk.id)]
    case 'dropIndex': return [tagged(`drop index ${indexLine(s.index)}`, s.index.id)]
    case 'renameIndex': return [tagged(`rename index ${fmtIdent(s.from)} -> ${fmtIdent(s.to)} on ${fmtIdent(s.table)}`, s.id)]
    case 'dropTable': return tableBlock('drop', s.table)
    case 'renameTable': return [tagged(`rename table ${fmtIdent(s.from)} -> ${fmtIdent(s.to)}`, s.id)]
    case 'createTable': return tableBlock('create', s.table)
    case 'alterTable': return [tagged(`alter table ${fmtIdent(s.name)} {`, s.id), ...s.actions.flatMap(alterLines), '}']
    case 'addIndex': return [tagged(`add index ${indexLine(s.index)}`, s.index.id)]
    case 'addForeignKey': return [tagged(`add foreign key ${fkLine(s.fk)}`, s.fk.id)]
  }
}

const isBlock = (s: Statement) => s.kind === 'dropTable' || s.kind === 'createTable' || s.kind === 'alterTable'

/** 문장만(머릿말 없이). 웹·CLI 의 「미기록 변경」 미리보기가 이것을 보여 준다. */
export function formatStatements(statements: readonly Statement[]): string {
  const out: string[] = []
  let prevBlock = false
  for (const [i, s] of statements.entries()) {
    const block = isBlock(s)
    if (i > 0 && (block || prevBlock)) out.push('')
    out.push(...statementLines(s))
    prevBlock = block
  }
  return out.join('\n')
}

export function formatChangeset(cs: Changeset): string {
  const h = cs.header
  const head = [
    CHANGESET_BANNER,
    `changeset ${fmtString(h.name)} {`,
    `  format: ${h.format}`,
    `  created: ${fmtString(h.created)}`,
    ...(h.baseline ? ['  baseline: true'] : []),
    '}',
  ]
  const body = formatStatements(cs.statements)
  return `${head.join('\n')}\n${body === '' ? '' : `\n${body}\n`}`
}
```

- [ ] **Step 5: `parse.ts` 를 구현한다**

```ts
import {
  CHANGESET_FORMAT,
  type AlterAction, type Changeset, type ChangesetHeader, type ColumnChange, type ColumnDef,
  type DialectTypes, type ForeignKeyDef, type IndexDef, type Statement, type TableDef,
} from './types.js'
import { Cursor, ParseFailure } from './syntax.js'

export type ParseChangesetResult =
  | { ok: true; changeset: Changeset }
  | { ok: false; line: number; message: string }

type Line = { no: number; text: string }

/**
 * 줄 끝 `@id`. **꼬리표를 싣는 줄에서만** 떼어 낸다 — 값(코멘트 등) 안의 `@` 를 꼬리표로 오인하지
 * 않게. id 문자 집합을 좁혀 두는 것도 같은 이유다(`'…@x'` 의 따옴표가 꼬리표에 섞이지 않는다).
 */
const ID_TAG = /[ \t]+@([A-Za-z0-9_.:-]+)[ \t]*$/

const FIELDS = ['type', 'dialects', 'nullable', 'default', 'increment', 'comment', 'check', 'position'] as const

export function parseChangeset(text: string): ParseChangesetResult {
  const lines: Line[] = text.replace(/^﻿/, '').split('\n')
    .map((t, i) => ({ no: i + 1, text: t.replace(/\r$/, '') }))
    .filter((l) => {
      const s = l.text.trim()
      return s !== '' && !s.startsWith('//')
    })
  try {
    return { ok: true, changeset: new Parser(lines).parse() }
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, line: err.line, message: err.message }
    throw err
  }
}

class Parser {
  #i = 0
  constructor(readonly lines: Line[]) {}

  #next(what: string): Line {
    const l = this.lines[this.#i]
    if (l === undefined) {
      const last = this.lines[this.lines.length - 1]?.no ?? 1
      throw new ParseFailure(last, `${what} 이(가) 와야 하는데 파일이 끝났습니다`)
    }
    this.#i += 1
    return l
  }
  #tagged(l: Line): { c: Cursor; id: string } {
    const m = ID_TAG.exec(l.text)
    if (m === null) throw new ParseFailure(l.no, '줄 끝에 @id 가 없습니다')
    return { c: new Cursor(l.text.slice(0, m.index), l.no), id: m[1]! }
  }
  #isClose(l: Line): boolean { return l.text.trim() === '}' }

  parse(): Changeset {
    const header = this.#header()
    const statements: Statement[] = []
    while (this.#i < this.lines.length) statements.push(this.#statement(this.#next('문장')))
    return { header, statements }
  }

  #header(): ChangesetHeader {
    const first = this.#next("changeset '<이름>' {")
    const c = new Cursor(first.text, first.no)
    c.word('changeset')
    const name = c.string()
    c.symbol('{')
    c.end()
    let format: number | null = null
    let created: string | null = null
    let baseline = false
    for (;;) {
      const l = this.#next('}')
      if (this.#isClose(l)) break
      const k = new Cursor(l.text, l.no)
      if (k.tryWord('format')) { k.symbol(':'); format = k.integer() }
      else if (k.tryWord('created')) { k.symbol(':'); created = k.string() }
      else if (k.tryWord('baseline')) { k.symbol(':'); baseline = k.trueFalse() }
      else k.fail('알 수 없는 머릿말 항목입니다 — format·created·baseline 만 쓸 수 있습니다')
      k.end()
    }
    if (format === null) throw new ParseFailure(first.no, '머릿말에 format 이 없습니다')
    if (format > CHANGESET_FORMAT) {
      throw new ParseFailure(first.no, `format ${format} 은(는) 이 ERDD 가 모르는 형식입니다 — 더 새 ERDD 로 만든 기록입니다. CLI 를 올리세요`)
    }
    if (created === null) throw new ParseFailure(first.no, '머릿말에 created 가 없습니다')
    return { format, name, created, baseline }
  }

  #statement(l: Line): Statement {
    const head = l.text.trimStart()
    const starts = (p: string) => head.startsWith(`${p} `)
    const line = l.no
    if (starts('drop foreign key') || starts('add foreign key')) {
      const drop = starts('drop foreign key')
      const { c, id } = this.#tagged(l)
      c.word(drop ? 'drop foreign key' : 'add foreign key')
      const fk = this.#foreignKey(c, id)
      c.end()
      return drop ? { kind: 'dropForeignKey', fk, line } : { kind: 'addForeignKey', fk, line }
    }
    if (starts('drop index') || starts('add index')) {
      const drop = starts('drop index')
      const { c, id } = this.#tagged(l)
      c.word(drop ? 'drop index' : 'add index')
      const index = this.#index(c, id)
      c.end()
      return drop ? { kind: 'dropIndex', index, line } : { kind: 'addIndex', index, line }
    }
    if (starts('rename index')) {
      const { c, id } = this.#tagged(l)
      c.word('rename index')
      const from = c.ident()
      c.symbol('->')
      const to = c.ident()
      c.word('on')
      const table = c.ident()
      c.end()
      return { kind: 'renameIndex', id, table, from, to, line }
    }
    if (starts('drop table')) return { kind: 'dropTable', table: this.#tableBlock(l, 'drop'), line }
    if (starts('create table')) return { kind: 'createTable', table: this.#tableBlock(l, 'create'), line }
    if (starts('rename table')) {
      const { c, id } = this.#tagged(l)
      c.word('rename table')
      const from = c.ident()
      c.symbol('->')
      const to = c.ident()
      c.end()
      return { kind: 'renameTable', id, from, to, line }
    }
    if (starts('alter table')) return this.#alter(l)
    throw new ParseFailure(line, `알 수 없는 문장입니다: '${head.slice(0, 30)}'`)
  }

  #parenIdents(c: Cursor): string[] {
    c.symbol('(')
    const out = [c.ident()]
    while (c.trySymbol(',')) out.push(c.ident())
    c.symbol(')')
    return out
  }

  #foreignKey(c: Cursor, id: string): ForeignKeyDef {
    const name = c.ident()
    const child = c.ident()
    const childColumns = this.#parenIdents(c)
    c.symbol('->')
    const parent = c.ident()
    const parentColumns = this.#parenIdents(c)
    if (childColumns.length !== parentColumns.length) c.fail('자식 컬럼과 부모 컬럼의 개수가 다릅니다')
    c.symbol('[')
    let cardinality: '1:1' | '1:N'
    if (c.trySymbol('1:1')) cardinality = '1:1'
    else { c.symbol('1:N'); cardinality = '1:N' }
    let uniqueName: string | null = null
    if (c.trySymbol(',')) { c.word('unique'); c.symbol(':'); uniqueName = c.ident() }
    c.symbol(']')
    return { id, name, child, childColumns, parent, parentColumns, cardinality, uniqueName }
  }

  #indexColumns(c: Cursor): IndexDef['columns'] {
    c.symbol('(')
    const out: IndexDef['columns'] = []
    do {
      const name = c.ident()
      let direction: 'asc' | 'desc'
      if (c.tryWord('asc')) direction = 'asc'
      else { c.word('desc'); direction = 'desc' }
      out.push({ name, direction })
    } while (c.trySymbol(','))
    c.symbol(')')
    return out
  }
  #uniqueTail(c: Cursor): boolean {
    if (!c.trySymbol('[')) return false
    c.word('unique')
    c.symbol(']')
    return true
  }
  #index(c: Cursor, id: string): IndexDef {
    const name = c.ident()
    c.word('on')
    const table = c.ident()
    const columns = this.#indexColumns(c)
    return { id, name, table, columns, unique: this.#uniqueTail(c) }
  }

  #columnDef(c: Cursor, id: string, allowAfter: boolean): { column: ColumnDef; after: string | null } {
    const name = c.ident()
    const type = c.type()
    let nullable: boolean | null = null
    let increment = false
    let dflt: string | null = null
    let comment: string | null = null
    let check: string[] = []
    const dialectTypes: DialectTypes = {}
    let after: string | null | undefined
    c.symbol('[')
    do {
      if (c.tryWord('not null')) nullable = false
      else if (c.tryWord('null')) nullable = true
      else if (c.tryWord('increment')) increment = true
      else if (c.tryWord('default')) { c.symbol(':'); dflt = c.raw() }
      else if (c.tryWord('comment')) { c.symbol(':'); comment = c.string() }
      else if (c.tryWord('check')) { c.symbol(':'); check = c.checkList() }
      else if (allowAfter && c.tryWord('after')) { c.symbol(':'); after = c.ident() }
      else if (allowAfter && c.tryWord('first')) after = null
      else {
        const d = c.tryDialect()
        if (d === null) c.fail('알 수 없는 컬럼 속성입니다')
        c.symbol(':')
        dialectTypes[d] = c.type()
      }
    } while (c.trySymbol(','))
    c.symbol(']')
    if (nullable === null) c.fail('null 또는 not null 이 와야 합니다')
    if (allowAfter && after === undefined) c.fail('add column 에는 after: <컬럼> 또는 first 가 와야 합니다')
    return {
      column: { id, name, type, dialectTypes, nullable, default: dflt, increment, comment, check },
      after: after ?? null,
    }
  }

  #tableBlock(l: Line, verb: 'create' | 'drop'): TableDef {
    const { c, id } = this.#tagged(l)
    c.word(`${verb} table`)
    const name = c.ident()
    let comment: string | null = null
    if (c.trySymbol('[')) { c.word('comment'); c.symbol(':'); comment = c.string(); c.symbol(']') }
    c.symbol('{')
    c.end()
    const columns: ColumnDef[] = []
    let primaryKey: string[] = []
    const indexes: IndexDef[] = []
    for (;;) {
      const inner = this.#next('}')
      if (this.#isClose(inner)) break
      const t = inner.text.trimStart()
      if (t.startsWith('column ')) {
        const { c: x, id: cid } = this.#tagged(inner)
        x.word('column')
        columns.push(this.#columnDef(x, cid, false).column)
        x.end()
      } else if (t.startsWith('primary key')) {
        const x = new Cursor(inner.text, inner.no)
        x.word('primary key')
        primaryKey = x.identList()
        x.end()
      } else if (verb === 'drop' && t.startsWith('index ')) {
        const { c: x, id: xid } = this.#tagged(inner)
        x.word('index')
        const ixName = x.ident()
        const ixColumns = this.#indexColumns(x)
        const unique = this.#uniqueTail(x)
        x.end()
        indexes.push({ id: xid, name: ixName, table: name, columns: ixColumns, unique })
      } else {
        throw new ParseFailure(inner.no, `${verb} table 블록에 올 수 없는 줄입니다`)
      }
    }
    return { id, name, comment, columns, primaryKey, indexes }
  }

  #alter(l: Line): Statement {
    const { c, id } = this.#tagged(l)
    c.word('alter table')
    const name = c.ident()
    c.symbol('{')
    c.end()
    const actions: AlterAction[] = []
    for (;;) {
      const a = this.#next('}')
      if (this.#isClose(a)) break
      const t = a.text.trimStart()
      const line = a.no
      if (t.startsWith('drop column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('drop column')
        const { column } = this.#columnDef(x, cid, false)
        x.end()
        actions.push({ kind: 'dropColumn', column, line })
      } else if (t.startsWith('rename column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('rename column')
        const from = x.ident()
        x.symbol('->')
        const to = x.ident()
        x.end()
        actions.push({ kind: 'renameColumn', id: cid, from, to, line })
      } else if (t.startsWith('add column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('add column')
        const { column, after } = this.#columnDef(x, cid, true)
        x.end()
        actions.push({ kind: 'addColumn', column, after, line })
      } else if (t.startsWith('modify column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('modify column')
        const colName = x.ident()
        x.symbol('{')
        x.end()
        actions.push({ kind: 'modifyColumn', id: cid, name: colName, changes: this.#changes(line), line })
      } else if (t.startsWith('primary key')) {
        const x = new Cursor(a.text, line)
        x.word('primary key')
        x.symbol(':')
        const from = x.identList()
        x.symbol('->')
        const to = x.identList()
        x.end()
        actions.push({ kind: 'primaryKey', from, to, line })
      } else if (t.startsWith('comment')) {
        const x = new Cursor(a.text, line)
        x.word('comment')
        x.symbol(':')
        const from = x.nullableString()
        x.symbol('->')
        const to = x.nullableString()
        x.end()
        actions.push({ kind: 'tableComment', from, to, line })
      } else {
        throw new ParseFailure(line, 'alter table 블록에 올 수 없는 줄입니다')
      }
    }
    return { kind: 'alterTable', id, name, actions, line: l.no }
  }

  #changes(openLine: number): ColumnChange[] {
    const changes: ColumnChange[] = []
    for (;;) {
      const l = this.#next('}')
      if (this.#isClose(l)) break
      const c = new Cursor(l.text, l.no)
      const field = c.ident()
      if (!(FIELDS as readonly string[]).includes(field)) c.fail(`modify column 에 올 수 없는 항목입니다: ${field}`)
      c.symbol(':')
      const from = readFieldValue(field as ColumnChange['field'], c)
      c.symbol('->')
      const to = readFieldValue(field as ColumnChange['field'], c)
      c.end()
      // field 와 값의 짝은 readFieldValue 가 보장한다 — 유니온을 손으로 좁히는 대신 한 번 단언한다.
      changes.push({ field, from, to } as ColumnChange)
    }
    if (changes.length === 0) throw new ParseFailure(openLine, 'modify column 블록이 비었습니다')
    return changes
  }
}

function readFieldValue(field: ColumnChange['field'], c: Cursor): unknown {
  switch (field) {
    case 'type': return c.type()
    case 'dialects': return c.dialects()
    case 'nullable':
    case 'increment': return c.bool()
    case 'default': return c.defaultValue()
    case 'comment': return c.nullableString()
    case 'check': return c.checkList()
    case 'position': return c.position()
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/format.test.ts src/changeset/parse.test.ts; pnpm -C packages/core typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 7: 구분력을 확인한다** (각각 확인 후 되돌린다)
  - `parseChangeset` 의 BOM 제거(`.replace(/^﻿/, '')`)를 지우면 「CRLF·BOM·들여쓰기」 테스트가 실패해야 한다.
  - `fmtIdent` 의 `!VALUE_KEYWORDS.has(s)` 조건을 지우면 왕복 테스트가 실패해야 한다(ALL 의 `first`·`none` 컬럼이 키워드로 읽힌다).
  - `formatStatements` 의 빈 줄 규칙을 바꾸면(`if (i > 0)` 로) 골든 테스트가 실패해야 한다.

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/changeset/syntax.ts packages/core/src/changeset/format.ts packages/core/src/changeset/parse.ts packages/core/src/changeset/format.test.ts packages/core/src/changeset/parse.test.ts && git commit -m "feat(core): 변경 기록 문법의 직렬화와 파서 — 줄 끝 @id, 값 표기 규칙 공유

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/changeset/syntax.ts packages/core/src/changeset/format.ts packages/core/src/changeset/parse.ts packages/core/src/changeset/format.test.ts packages/core/src/changeset/parse.test.ts
```

---

### Task 5: 재생 — `applyChangeset`·`replay`, 그리고 왕복 속성 테스트

**Files:**
- Create: `packages/core/src/changeset/replay.ts`
- Test: `packages/core/src/changeset/replay.test.ts`, `packages/core/src/changeset/roundtrip.test.ts`

**Interfaces:**
- Consumes: Task 2 타입, Task 3 `diffProjection`, Task 4 `formatChangeset`·`parseChangeset`·`fmtFieldValue`·`fmtIdentList`·`fmtNullableString`.
- Produces:
  - `class ReplayFailure extends Error { line: number | null }`
  - `type ReplayWarning = { line: number | null; message: string }`
  - `type ChangesetRecord = { file: string; changeset: Changeset }`
  - `type ReplayResult = { projection: SchemaProjection; warnings: ChangeIssue[]; error: ChangeIssue | null }`
  - `applyChangeset(p: SchemaProjection, cs: Changeset): ReplayWarning[]` — `p` 를 제자리에서 바꾼다. 실패하면 `ReplayFailure` 를 던진다.
  - `replay(records: readonly ChangesetRecord[]): ReplayResult` — 파일명 코드 단위 사전순으로 재생한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/changeset/replay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import type { Column, ProjectModel } from '../model.js'
import { projectSchema } from './projection.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { applyChangeset, replay } from './replay.js'
import { emptyProjection, type Changeset, type SchemaProjection } from './types.js'

const S = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const proj = (m: ProjectModel) => projectSchema(m, S)

/** a → b 의 기록을 직렬화했다가 되읽는다(실제 파일과 같은 길을 지나게). */
function changesetOf(a: SchemaProjection, b: ProjectModel, name = 'x'): Changeset {
  const r = diffProjection(a, proj(b))
  if (!r.ok) throw new Error(r.message)
  const parsed = parseChangeset(formatChangeset({ header: { format: 1, name, created: '2026-09-23T00:00:00Z', baseline: false }, statements: r.statements }))
  if (!parsed.ok) throw new Error(`${parsed.line}: ${parsed.message}`)
  return parsed.changeset
}
const withColumn = (m: ProjectModel, id: string, patch: Partial<Column>): ProjectModel => {
  const next = structuredClone(m)
  next.columns[id] = { ...next.columns[id]!, ...patch }
  return next
}
const HEAD = "changeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n}\n"

describe('replay', () => {
  it('빈 투영에서 샘플까지 재생하면 샘플의 투영이 된다', () => {
    const r = replay([{ file: 'a', changeset: changesetOf(emptyProjection(), buildSampleModel()) }])
    expect(r.error).toBeNull()
    expect(r.projection).toEqual(proj(buildSampleModel()))
  })

  it('넘긴 순서가 아니라 파일명 순으로 재생한다', () => {
    const base = buildSampleModel()
    const next = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const r0 = changesetOf(emptyProjection(), base)
    const r1 = changesetOf(proj(base), next)
    const r = replay([{ file: 'b', changeset: r1 }, { file: 'a', changeset: r0 }])
    expect(r.error).toBeNull()
    expect(r.projection).toEqual(proj(next))
  })

  it('같은 속성을 두 기록이 다른 전제로 바꾸면 경고하고, 뒤 기록의 이후 값으로 계속한다', () => {
    const base = buildSampleModel()
    const a = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const b = withColumn(base, 'c3', { type: 'VARCHAR(300)' })
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), a) },
      { file: '3', changeset: changesetOf(proj(base), b) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ file: '3', message: 'MBR.MBR_NM type 의 이전 값이 VARCHAR(100) 이(가) 아니라 VARCHAR(200) 입니다' })
    expect(r.warnings[0]!.line).toEqual(expect.any(Number))
    expect(r.projection.columns['c3']!.type).toBe('VARCHAR(300)')
  })

  it('개명과 수정이 다른 기록에서 교차해도 @id 로 정확히 재생한다', () => {
    const base = buildSampleModel()
    const renamed = withColumn(base, 'c3', { physicalName: 'MBR_NAME' })
    const nullable = withColumn(base, 'c3', { nullable: true })
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), renamed) },
      { file: '3', changeset: changesetOf(proj(base), nullable) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toEqual([])
    expect(r.projection.columns['c3']).toMatchObject({ name: 'MBR_NAME', nullable: true })
  })

  it('두 컬럼의 이름을 맞바꿔도 재생 결과가 같다', () => {
    const base = buildSampleModel()
    const swapped = withColumn(withColumn(base, 'c3', { physicalName: 'GRD_CD' }), 'c4', { physicalName: 'MBR_NM' })
    const p = proj(base)
    expect(applyChangeset(p, changesetOf(proj(base), swapped))).toEqual([])
    expect(p).toEqual(proj(swapped))
  })

  it('after 는 최종 순서의 바로 앞 컬럼이다 — 추가·이동 문장의 순서를 뒤집어도 결과가 같다', () => {
    const base = buildSampleModel()
    const next = structuredClone(base)
    next.columns['c9'] = { ...next.columns['c3']!, id: 'c9', physicalName: 'NEW_A', order: -2 }
    next.columns['c4'] = { ...next.columns['c4']!, order: -1 }
    next.columns['c8'] = { ...next.columns['c3']!, id: 'c8', physicalName: 'NEW_B', order: 9 }
    delete next.indexes['i1']
    const cs = changesetOf(proj(base), next)
    const reversed = structuredClone(cs)
    for (const s of reversed.statements) {
      if (s.kind !== 'alterTable') continue
      const drops = s.actions.filter((a) => a.kind === 'dropColumn' || a.kind === 'renameColumn')
      const rest = s.actions.filter((a) => a.kind !== 'dropColumn' && a.kind !== 'renameColumn')
      s.actions = [...drops, ...rest.reverse()]
    }
    const p1 = proj(base)
    const p2 = proj(base)
    applyChangeset(p1, cs)
    applyChangeset(p2, reversed)
    expect(p1.tables['t2']!.columnIds).toEqual(['c9', 'c4', 'c2', 'c3', 'c8'])
    expect(p2.tables['t2']!.columnIds).toEqual(['c9', 'c4', 'c2', 'c3', 'c8'])
  })

  it('없는 @id 를 고치면 그 파일·줄에서 멈춘다', () => {
    const bad = parseChangeset(`${HEAD}alter table MBR {  @t404\n  rename column A -> B  @c404\n}\n`)
    if (!bad.ok) throw new Error(bad.message)
    const r = replay([{ file: 'bad.erddc', changeset: bad.changeset }])
    expect(r.error).toMatchObject({ file: 'bad.erddc', line: 5 })
    expect(r.error!.message).toContain('@t404')
  })

  it('이미 있는 테이블을 또 만들면 멈춘다', () => {
    const cs = changesetOf(emptyProjection(), buildSampleModel())
    const r = replay([{ file: '1', changeset: cs }, { file: '2', changeset: cs }])
    expect(r.error).toMatchObject({ file: '2' })
    expect(r.error!.message).toContain('이미 있습니다')
  })

  it('after 가 없는 컬럼을 가리키면 멈춘다', () => {
    const p = proj(buildSampleModel())
    const bad = parseChangeset(`${HEAD}alter table MBR {  @t2\n  add column X INT [null, after: NOPE]  @c77\n}\n`)
    if (!bad.ok) throw new Error(bad.message)
    expect(() => applyChangeset(p, bad.changeset)).toThrow('NOPE')
  })
})
```

`packages/core/src/changeset/roundtrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Column, type ProjectModel } from '../model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from '../naming.js'
import { deleteColumnCascade, deleteRelationship, deleteTableCascade } from '../relationship.js'
import { projectSchema } from './projection.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { applyChangeset } from './replay.js'
import { CHANGESET_FORMAT, emptyProjection } from './types.js'

/**
 * 왕복 불변식 — 재생이 기준선의 유일한 원천이므로(guide 「재생은 `@id` 로 대상을 찾는다」)
 * 「a → b 기록을 직렬화·파싱해 a 에 적용하면 b 가 된다」가 깨지면 모든 기준선이 조용히 틀린다.
 * 무작위 편집을 시드 고정으로 돌린다.
 */

type State = { model: ProjectModel; rules: NamingRules }
const DIALECTS = ['postgresql', 'mysql'] as const

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const TYPES = ['VARCHAR(10)', 'VARCHAR(20)', 'BIGINT', 'INT UNSIGNED', 'DECIMAL(10, 2)', 'CHAR(1)']
const DEFAULTS = [null, "'Y'", 'CURRENT_TIMESTAMP', "it's `x`\\n"]
const COMMENTS = [null, '설명', "따옴표'와\n줄바꿈"]

function initial(): ProjectModel {
  const m = createEmptyModel()
  m.domains['d1'] = {
    id: 'd1', name: '코드', category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
  return m
}

function mutate(state: State, rand: () => number, counter: { n: number }): State {
  let m: ProjectModel = structuredClone(state.model)
  let rules = state.rules
  const pick = <T,>(xs: readonly T[]): T | undefined => (xs.length === 0 ? undefined : xs[Math.floor(rand() * xs.length)])
  const fresh = (p: string) => { counter.n += 1; return `${p}${counter.n}` }
  const tables = () => Object.values(m.tables)
  const cols = (tid: string) => Object.values(m.columns).filter((c) => c.tableId === tid).sort((a, b) => a.order - b.order)
  const renumber = (list: Column[]) => list.forEach((c, i) => { m.columns[c.id] = { ...m.columns[c.id]!, order: i } })
  const newColumn = (tid: string): Column => ({
    id: fresh('c'), tableId: tid, logicalName: '', physicalName: fresh('COL_'), type: pick(TYPES)!,
    isPk: false, autoIncrement: false, nullable: rand() < 0.5, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  })

  switch (Math.floor(rand() * 15)) {
    case 0: {
      const id = fresh('t')
      m.tables[id] = { id, logicalName: '', physicalName: fresh('TB_'), comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
      const n = 1 + Math.floor(rand() * 3)
      for (let i = 0; i < n; i += 1) {
        const c = { ...newColumn(id), order: i }
        if (i === 0) Object.assign(c, { isPk: true, type: 'BIGINT', nullable: false, autoIncrement: rand() < 0.5 })
        m.columns[c.id] = c
      }
      break
    }
    case 1: { const t = pick(tables()); if (t) m = deleteTableCascade(m, t.id); break }
    case 2: { const t = pick(tables()); if (t) m.tables[t.id] = { ...t, physicalName: fresh('RN_') }; break }
    case 3: {
      const t = pick(tables())
      if (t) {
        const list = cols(t.id)
        const c = newColumn(t.id)
        m.columns[c.id] = c
        list.splice(Math.floor(rand() * (list.length + 1)), 0, c)
        renumber(list)
      }
      break
    }
    case 4: { const c = pick(Object.values(m.columns)); if (c) m = deleteColumnCascade(m, c.id); break }
    case 5: { const c = pick(Object.values(m.columns)); if (c) m.columns[c.id] = { ...c, physicalName: fresh('RC_') }; break }
    case 6: {
      const c = pick(Object.values(m.columns))
      if (c) {
        const next = { ...c }
        switch (Math.floor(rand() * 7)) {
          case 0: next.type = pick(TYPES)!; break
          case 1: next.nullable = !c.nullable; break
          case 2: next.defaultValue = pick(DEFAULTS)!; break
          case 3: next.comment = pick(COMMENTS)!; break
          case 4: next.isPk = !c.isPk; break
          case 5: next.autoIncrement = !c.autoIncrement; break
          case 6: next.domainId = c.domainId === null ? 'd1' : null; break
        }
        m.columns[c.id] = next
      }
      break
    }
    case 7: {
      const t = pick(tables())
      if (t) {
        const list = cols(t.id)
        if (list.length > 1) {
          const [moved] = list.splice(Math.floor(rand() * list.length), 1)
          list.splice(Math.floor(rand() * (list.length + 1)), 0, moved!)
          renumber(list)
        }
      }
      break
    }
    case 8: {
      const t = pick(tables())
      const list = t ? cols(t.id) : []
      if (t && list.length > 0) {
        const chosen = list.filter(() => rand() < 0.6)
        const id = fresh('i')
        m.indexes[id] = {
          id, tableId: t.id, name: fresh('IX_'),
          columns: (chosen.length > 0 ? chosen : [list[0]!]).map((c) => ({ columnId: c.id, direction: rand() < 0.5 ? 'asc' as const : 'desc' as const })),
          unique: rand() < 0.5,
        }
      }
      break
    }
    case 9: {
      const ix = pick(Object.values(m.indexes))
      if (ix) {
        const r = rand()
        if (r < 0.33) delete m.indexes[ix.id]
        else if (r < 0.66) m.indexes[ix.id] = { ...ix, name: fresh('IX_') }
        else m.indexes[ix.id] = { ...ix, unique: !ix.unique }
      }
      break
    }
    case 10: {
      const child = pick(tables())
      const parent = pick(tables())
      const cc = child ? pick(cols(child.id)) : undefined
      const pc = parent ? pick(cols(parent.id)) : undefined
      if (child && parent && cc && pc) {
        const id = fresh('r')
        m.relationships[id] = {
          id, parentTableId: parent.id, childTableId: child.id,
          columnMappings: [{ childColumnId: cc.id, parentColumnId: pc.id }],
          cardinality: rand() < 0.5 ? '1:1' : '1:N', identifying: false, name: rand() < 0.5 ? null : fresh('FK_'),
        }
      }
      break
    }
    case 11: { const r = pick(Object.values(m.relationships)); if (r) m = deleteRelationship(m, r.id); break }
    case 12: {
      const d = m.domains['d1']!
      m.domains['d1'] = {
        ...d, logicalType: pick(TYPES)!,
        dialectTypes: { ...d.dialectTypes, postgresql: rand() < 0.5 ? null : 'TEXT' },
        allowedValues: rand() < 0.5 ? [] : ['Y', 'N'], defaultValue: pick(DEFAULTS)!,
      }
      break
    }
    case 13: { rules = { ...rules, tablePhysicalTemplate: rules.tablePhysicalTemplate === '' ? 'X_{물리명}' : '' }; break }
    case 14: {
      const t = pick(tables())
      if (t) m.tables[t.id] = { ...t, comment: pick(COMMENTS)!, logicalName: pick(['', '회원', '주문 상세'])! }
      break
    }
  }
  return { model: m, rules }
}

describe('왕복 불변식 — 기록을 쌓아 재생하면 매 시점의 투영이 된다', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('시드 %i', (seed) => {
    const rand = rng(seed)
    const counter = { n: 0 }
    let state: State = { model: initial(), rules: DEFAULT_NAMING_RULES }
    const replayed = emptyProjection()
    for (let step = 0; step < 60; step += 1) {
      let next = state
      const edits = 1 + Math.floor(rand() * 4)
      for (let e = 0; e < edits; e += 1) next = mutate(next, rand, counter)
      const a = projectSchema(state.model, { rules: state.rules, dialects: DIALECTS })
      const b = projectSchema(next.model, { rules: next.rules, dialects: DIALECTS })
      const d = diffProjection(a, b)
      if (!d.ok) throw new Error(`시드 ${seed} 단계 ${step}: ${d.message}`)
      const text = formatChangeset({ header: { format: CHANGESET_FORMAT, name: `s${step}`, created: '2026-09-23T00:00:00Z', baseline: false }, statements: d.statements })
      const parsed = parseChangeset(text)
      if (!parsed.ok) throw new Error(`시드 ${seed} 단계 ${step} ${parsed.line}행: ${parsed.message}\n${text}`)
      expect(applyChangeset(replayed, parsed.changeset)).toEqual([])
      expect(replayed).toEqual(b)
      state = next
    }
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/replay.test.ts src/changeset/roundtrip.test.ts`
Expected: FAIL — `Cannot find module './replay.js'`.

- [ ] **Step 3: 구현한다** — `packages/core/src/changeset/replay.ts`:

```ts
import { deepEqual } from '../equal.js'
import {
  compareCodeUnits, emptyProjection,
  type AlterAction, type ChangeIssue, type Changeset, type ColumnChange, type ColumnDef,
  type ProjColumn, type ProjTable, type SchemaProjection, type Statement,
} from './types.js'
import { fmtFieldValue, fmtIdentList, fmtNullableString } from './syntax.js'

export class ReplayFailure extends Error {
  constructor(readonly line: number | null, message: string) {
    super(message)
    this.name = 'ReplayFailure'
  }
}

export type ReplayWarning = { line: number | null; message: string }
export type ChangesetRecord = { file: string; changeset: Changeset }
export type ReplayResult = { projection: SchemaProjection; warnings: ChangeIssue[]; error: ChangeIssue | null }

type Fail = (message: string) => never
type Warn = (message: string) => void

/**
 * 기록 전부를 **파일명 순**으로 빈 투영에 재생한다 — 이것이 기준선의 유일한 원천이다
 * (guide 「재생은 `@id` 로 대상을 찾는다」). 첫 실패에서 멈추고 그 파일·줄을 돌려준다.
 */
export function replay(records: readonly ChangesetRecord[]): ReplayResult {
  const projection = emptyProjection()
  const warnings: ChangeIssue[] = []
  for (const r of [...records].sort((a, b) => compareCodeUnits(a.file, b.file))) {
    try {
      for (const w of applyChangeset(projection, r.changeset)) warnings.push({ file: r.file, line: w.line, message: w.message })
    } catch (err) {
      if (err instanceof ReplayFailure) return { projection, warnings, error: { file: r.file, line: err.line, message: err.message } }
      throw err
    }
  }
  return { projection, warnings, error: null }
}

/** 기록 하나를 `p` 에 제자리 적용한다. 대상은 `@id` 로 찾고, FK·인덱스·PK·after 의 참조만 이름으로 푼다. */
export function applyChangeset(p: SchemaProjection, cs: Changeset): ReplayWarning[] {
  const warnings: ReplayWarning[] = []
  for (const s of cs.statements) applyStatement(p, s, warnings)
  return warnings
}

function applyStatement(p: SchemaProjection, s: Statement, warnings: ReplayWarning[]): void {
  const line = s.line ?? null
  const fail: Fail = (m) => { throw new ReplayFailure(line, m) }
  const warn: Warn = (m) => { warnings.push({ line, message: m }) }
  switch (s.kind) {
    case 'dropForeignKey': {
      if (p.foreignKeys[s.fk.id] === undefined) fail(`지울 FK @${s.fk.id}(${s.fk.name}) 이(가) 없습니다`)
      delete p.foreignKeys[s.fk.id]
      return
    }
    case 'dropIndex': {
      if (p.indexes[s.index.id] === undefined) fail(`지울 인덱스 @${s.index.id}(${s.index.name}) 이(가) 없습니다`)
      delete p.indexes[s.index.id]
      return
    }
    case 'renameIndex': {
      const ix = p.indexes[s.id] ?? fail(`이름을 바꿀 인덱스 @${s.id}(${s.from}) 이(가) 없습니다`)
      if (ix.name !== s.from) warn(`인덱스 이름의 이전 값이 ${s.from} 이(가) 아니라 ${ix.name} 입니다`)
      ix.name = s.to
      return
    }
    case 'dropTable': {
      const t = p.tables[s.table.id] ?? fail(`지울 테이블 @${s.table.id}(${s.table.name}) 이(가) 없습니다`)
      for (const cid of t.columnIds) delete p.columns[cid]
      for (const ix of Object.values(p.indexes)) if (ix.tableId === t.id) delete p.indexes[ix.id]
      for (const fk of Object.values(p.foreignKeys)) {
        if (fk.childTableId !== t.id && fk.parentTableId !== t.id) continue
        delete p.foreignKeys[fk.id]
        warn(`${t.name} 테이블과 함께 FK ${fk.name} 도 지웠습니다 — 앞선 기록이 그 FK 를 지우지 않았습니다`)
      }
      delete p.tables[t.id]
      return
    }
    case 'renameTable': {
      const t = p.tables[s.id] ?? fail(`이름을 바꿀 테이블 @${s.id}(${s.from}) 이(가) 없습니다`)
      if (t.name !== s.from) warn(`테이블 이름의 이전 값이 ${s.from} 이(가) 아니라 ${t.name} 입니다`)
      t.name = s.to
      return
    }
    case 'createTable': {
      if (p.tables[s.table.id] !== undefined) fail(`만들 테이블 @${s.table.id}(${s.table.name}) 이(가) 이미 있습니다`)
      const t: ProjTable = { id: s.table.id, name: s.table.name, comment: s.table.comment, columnIds: [], primaryKey: [] }
      p.tables[t.id] = t
      for (const c of s.table.columns) {
        addColumnEntity(p, t.id, c, fail)
        t.columnIds.push(c.id)
      }
      t.primaryKey = s.table.primaryKey.map((n) => columnIdByName(p, t, n, fail))
      return
    }
    case 'alterTable': applyAlter(p, s, warnings); return
    case 'addIndex': {
      if (p.indexes[s.index.id] !== undefined) fail(`만들 인덱스 @${s.index.id}(${s.index.name}) 이(가) 이미 있습니다`)
      const t = tableByName(p, s.index.table, fail)
      p.indexes[s.index.id] = {
        id: s.index.id, tableId: t.id, name: s.index.name,
        columns: s.index.columns.map((c) => ({ columnId: columnIdByName(p, t, c.name, fail), direction: c.direction })),
        unique: s.index.unique,
      }
      return
    }
    case 'addForeignKey': {
      if (p.foreignKeys[s.fk.id] !== undefined) fail(`만들 FK @${s.fk.id}(${s.fk.name}) 이(가) 이미 있습니다`)
      const child = tableByName(p, s.fk.child, fail)
      const parent = tableByName(p, s.fk.parent, fail)
      p.foreignKeys[s.fk.id] = {
        id: s.fk.id, name: s.fk.name,
        childTableId: child.id, childColumnIds: s.fk.childColumns.map((n) => columnIdByName(p, child, n, fail)),
        parentTableId: parent.id, parentColumnIds: s.fk.parentColumns.map((n) => columnIdByName(p, parent, n, fail)),
        cardinality: s.fk.cardinality, uniqueName: s.fk.uniqueName,
      }
      return
    }
  }
}

function applyAlter(p: SchemaProjection, s: Extract<Statement, { kind: 'alterTable' }>, warnings: ReplayWarning[]): void {
  const headLine = s.line ?? null
  const t = p.tables[s.id] ?? (() => { throw new ReplayFailure(headLine, `고칠 테이블 @${s.id}(${s.name}) 이(가) 없습니다`) })()
  if (t.name !== s.name) warnings.push({ line: headLine, message: `테이블 이름이 ${s.name} 이(가) 아니라 ${t.name} 입니다` })
  const placed: { id: string; after: string | null }[] = []
  for (const a of s.actions) applyAction(p, t, a, placed, warnings, headLine)
  if (placed.length > 0) {
    t.columnIds = resolveOrder(p, t, placed, (m) => { throw new ReplayFailure(headLine, m) })
  }
}

function applyAction(
  p: SchemaProjection, t: ProjTable, a: AlterAction,
  placed: { id: string; after: string | null }[], warnings: ReplayWarning[], headLine: number | null,
): void {
  const line = a.line ?? headLine
  const fail: Fail = (m) => { throw new ReplayFailure(line, m) }
  const warn: Warn = (m) => { warnings.push({ line, message: m }) }
  switch (a.kind) {
    case 'dropColumn': {
      const col = columnOf(p, t, a.column.id, a.column.name, fail)
      delete p.columns[col.id]
      t.columnIds = t.columnIds.filter((id) => id !== col.id)
      t.primaryKey = t.primaryKey.filter((id) => id !== col.id)
      return
    }
    case 'renameColumn': {
      const col = columnOf(p, t, a.id, a.from, fail)
      if (col.name !== a.from) warn(`${t.name}.${a.from} 컬럼 이름의 이전 값이 ${a.from} 이(가) 아니라 ${col.name} 입니다`)
      col.name = a.to
      return
    }
    case 'addColumn': {
      addColumnEntity(p, t.id, a.column, fail)
      placed.push({ id: a.column.id, after: a.after })
      return
    }
    case 'modifyColumn': {
      const col = columnOf(p, t, a.id, a.name, fail)
      for (const ch of a.changes) {
        // position 의 이전 값은 참고용이다 — 경합 판정에 쓰지 않는다(guide 「경합은 경고다」).
        if (ch.field === 'position') { placed.push({ id: col.id, after: ch.to }); continue }
        const cur = currentValue(col, ch.field)
        if (!deepEqual(cur, ch.from)) {
          warn(`${t.name}.${col.name} ${ch.field} 의 이전 값이 ${fmtFieldValue(ch.field, ch.from)} 이(가) 아니라 ${fmtFieldValue(ch.field, cur)} 입니다`)
        }
        setValue(col, ch)
      }
      return
    }
    case 'primaryKey': {
      const cur = t.primaryKey.map((id) => p.columns[id]?.name ?? id)
      if (!deepEqual(cur, a.from)) warn(`${t.name} 기본 키의 이전 값이 ${fmtIdentList(a.from)} 이(가) 아니라 ${fmtIdentList(cur)} 입니다`)
      t.primaryKey = a.to.map((n) => columnIdByName(p, t, n, fail))
      return
    }
    case 'tableComment': {
      if (t.comment !== a.from) warn(`${t.name} 테이블 코멘트의 이전 값이 ${fmtNullableString(a.from)} 이(가) 아니라 ${fmtNullableString(t.comment)} 입니다`)
      t.comment = a.to
      return
    }
  }
}

type ValueField = Exclude<ColumnChange['field'], 'position'>

function currentValue(c: ProjColumn, field: ValueField): unknown {
  switch (field) {
    case 'type': return c.type
    case 'dialects': return c.dialectTypes
    case 'nullable': return c.nullable
    case 'default': return c.default
    case 'increment': return c.increment
    case 'comment': return c.comment
    case 'check': return c.check
  }
}

function setValue(c: ProjColumn, ch: Exclude<ColumnChange, { field: 'position' }>): void {
  switch (ch.field) {
    case 'type': c.type = ch.to; return
    case 'dialects': c.dialectTypes = { ...ch.to }; return
    case 'nullable': c.nullable = ch.to; return
    case 'default': c.default = ch.to; return
    case 'increment': c.increment = ch.to; return
    case 'comment': c.comment = ch.to; return
    case 'check': c.check = [...ch.to]; return
  }
}

/**
 * 블록 끝에서 한 번에 순서를 정한다(guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」).
 * 추가·이동한 컬럼(placed)을 뺀 나머지는 제자리를 지키고, placed 는 「바로 앞 컬럼」 사슬로
 * 매달린다. 한 자리를 두 컬럼이 가리키거나 사슬이 닫히면 멈춘다.
 */
function resolveOrder(p: SchemaProjection, t: ProjTable, placed: { id: string; after: string | null }[], fail: Fail): string[] {
  const placedIds = new Set(placed.map((x) => x.id))
  const byName = new Map<string, string>()
  for (const c of Object.values(p.columns)) {
    if (c.tableId !== t.id) continue
    if (byName.has(c.name)) fail(`${t.name} 테이블에 ${c.name} 컬럼이 둘 이상입니다`)
    byName.set(c.name, c.id)
  }
  const FIRST = '\u0000first'
  const children = new Map<string, string>()
  for (const x of placed) {
    const key = x.after === null ? FIRST : (byName.get(x.after) ?? fail(`${t.name} 테이블에 ${x.after} 컬럼이 없습니다(after)`))
    if (children.has(key)) fail(`${t.name} 테이블에서 두 컬럼이 같은 자리(${x.after ?? 'first'})를 가리킵니다`)
    children.set(key, x.id)
  }
  const order: string[] = []
  const chain = (from: string) => {
    let key = from
    for (;;) {
      const next = children.get(key)
      if (next === undefined) return
      children.delete(key)
      order.push(next)
      key = next
    }
  }
  chain(FIRST)
  for (const id of t.columnIds) {
    if (placedIds.has(id)) continue
    order.push(id)
    chain(id)
  }
  if (children.size > 0) fail(`${t.name} 테이블의 컬럼 순서를 정할 수 없습니다 — after 가 서로를 가리킵니다`)
  return order
}

function addColumnEntity(p: SchemaProjection, tableId: string, def: ColumnDef, fail: Fail): void {
  if (p.columns[def.id] !== undefined) fail(`만들 컬럼 @${def.id}(${def.name}) 이(가) 이미 있습니다`)
  p.columns[def.id] = { ...def, tableId, dialectTypes: { ...def.dialectTypes }, check: [...def.check] }
}

function columnOf(p: SchemaProjection, t: ProjTable, id: string, name: string, fail: Fail): ProjColumn {
  const col = p.columns[id]
  if (col === undefined || col.tableId !== t.id) fail(`${t.name} 테이블에 컬럼 @${id}(${name}) 이(가) 없습니다`)
  return col
}

function tableByName(p: SchemaProjection, name: string, fail: Fail): ProjTable {
  const found = Object.values(p.tables).filter((t) => t.name === name)
  if (found.length === 0) fail(`테이블 ${name} 이(가) 없습니다`)
  if (found.length > 1) fail(`같은 이름의 테이블이 둘 이상입니다: ${name}`)
  return found[0]!
}

/** 추가만 되고 아직 순서가 정해지지 않은 컬럼도 찾는다(columnIds 가 아니라 소속으로 본다). */
function columnIdByName(p: SchemaProjection, t: ProjTable, name: string, fail: Fail): string {
  const found = Object.values(p.columns).filter((c) => c.tableId === t.id && c.name === name)
  if (found.length === 0) fail(`${t.name} 테이블에 ${name} 컬럼이 없습니다`)
  if (found.length > 1) fail(`${t.name} 테이블에 ${name} 컬럼이 둘 이상입니다`)
  return found[0]!.id
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/; pnpm -C packages/core typecheck; echo "exit=$?"`
Expected: PASS(시드 8개 포함), `exit=0`. 왕복 테스트가 실패하면 **실패한 시드·단계·기록 텍스트를 그대로 보고**한다 — 기대값을 고치지 않는다.

- [ ] **Step 5: 구분력을 확인한다** (각각 확인 후 되돌린다)
  - `applyAction` 의 `columnOf(p, t, a.id, …)` 를 이름으로 찾도록 바꾸면(`columnIdByName(p, t, a.from, fail)`) 「개명과 수정이 교차」 테스트가 실패해야 한다.
  - `resolveOrder` 호출을 지우면 왕복 테스트와 「after 는 최종 순서」 테스트가 실패해야 한다.
  - 경합 경고 `warn(...)` 줄을 지우면 「경고하고 … 계속한다」 테스트가 실패해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/changeset/replay.ts packages/core/src/changeset/replay.test.ts packages/core/src/changeset/roundtrip.test.ts && git commit -m "feat(core): 변경 기록 재생 — @id 로 대상을 찾고 경합은 경고한다. 왕복 속성 테스트

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/changeset/replay.ts packages/core/src/changeset/replay.test.ts packages/core/src/changeset/roundtrip.test.ts
```

---

### Task 6: 상태·생성·파일명 — `plan.ts`, core 공개, 로컬 프로토콜 타입

**Files:**
- Create: `packages/core/src/changeset/plan.ts`
- Modify: `packages/core/src/local-protocol.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/changeset/plan.test.ts`

**Interfaces:**
- Consumes: Task 2~5 전부, `isNewId`·`NEW_ID_PREFIX`(`../file-format.js`).
- Produces (`plan.ts`):
  - `CHANGESET_EXT = '.erddc'`
  - `type ChangesetSource = { file: string; text: string }`
  - `type ChangeRecordSummary = { file: string; name: string; created: string; baseline: boolean; statementCount: number; text: string }`
  - `type ChangesPlan = { records: ChangeRecordSummary[]; warnings: ChangeIssue[]; error: ChangeIssue | null; pending: Statement[] | null; target: SchemaProjection | null }`
  - `type PlanInput = { sources: readonly ChangesetSource[]; model: ProjectModel; settings: ProjectionSettings }`
  - `planChanges(input: PlanInput): ChangesPlan`
  - `type ComposeOptions = { name: string; created: string; baseline: boolean }`
  - `type ComposeFailureReason = 'name' | 'invalid' | 'empty' | 'baseline'`
  - `type ComposeResult = { ok: true; text: string; statementCount: number } | { ok: false; reason: ComposeFailureReason; message: string }`
  - `composeChangeset(plan: ChangesPlan, input: PlanInput, opts: ComposeOptions): ComposeResult`
  - `changesetStamp(now: Date, existingFiles: readonly string[]): string` — `YYYYMMDDHHmmss`(UTC)
  - `stampToIso(stamp: string): string`
  - `changesetFileName(stamp: string, name: string): string`
  - `formatChangeIssue(issue: ChangeIssue): string`
- Produces (`local-protocol.ts`): `LOCAL_CHANGES_PATH`, `LOCAL_CHANGES_CREATE_PATH`, `LOCAL_CHANGES_UNSAVED_MESSAGE`, `type LocalChangesStatus`, `type LocalChangesCreateResult`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/changeset/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { createEmptyModel, type Column, type ProjectModel } from '../model.js'
import {
  changesetFileName, changesetStamp, composeChangeset, formatChangeIssue, planChanges, stampToIso,
  type ChangesetSource,
} from './plan.js'

const SETTINGS = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const input = (sources: ChangesetSource[], model: ProjectModel) => ({ sources, model, settings: SETTINGS })
const withColumn = (m: ProjectModel, id: string, patch: Partial<Column>): ProjectModel => {
  const next = structuredClone(m)
  next.columns[id] = { ...next.columns[id]!, ...patch }
  return next
}

/** sources 위에 model 까지의 기록 하나를 만든다. */
function record(sources: ChangesetSource[], model: ProjectModel, file: string, name = file): ChangesetSource {
  const i = input(sources, model)
  const r = composeChangeset(planChanges(i), i, { name, created: '2026-09-23T00:00:00Z', baseline: false })
  if (!r.ok) throw new Error(r.message)
  return { file, text: r.text }
}

describe('planChanges', () => {
  it('기록이 없으면 스키마 전체가 미기록이다', () => {
    const plan = planChanges(input([], buildSampleModel()))
    expect(plan.error).toBeNull()
    expect(plan.records).toEqual([])
    expect(plan.pending?.map((s) => s.kind)).toEqual(['createTable', 'createTable', 'addIndex', 'addForeignKey'])
  })

  it('기록을 만든 뒤에는 미기록이 없고, 목록에 이름·문장 수가 보인다', () => {
    const r0 = record([], buildSampleModel(), 'erdd/changes/20260101000000_초기.erddc', '초기')
    const plan = planChanges(input([r0], buildSampleModel()))
    expect(plan.pending).toEqual([])
    expect(plan.records).toEqual([{ file: r0.file, name: '초기', created: '2026-09-23T00:00:00Z', baseline: false, statementCount: 4, text: r0.text }])
  })

  it('겹치지 않는 두 브랜치의 기록을 합치면 미기록이 0 이다 — 중복 기록이 없다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const a = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const b = structuredClone(base)
    b.tables['t1'] = { ...b.tables['t1']!, physicalName: 'GRD' }
    const ra = record([r0], a, '2_a')
    const rb = record([r0], b, '3_b')
    const merged = structuredClone(a)
    merged.tables['t1'] = { ...merged.tables['t1']!, physicalName: 'GRD' }
    const plan = planChanges(input([r0, ra, rb], merged))
    expect(plan.error).toBeNull()
    expect(plan.warnings).toEqual([])
    expect(plan.pending).toEqual([])
  })

  it('같은 속성을 두 브랜치가 바꾸면 경고한다 — 병합 결과가 뒤 기록과 같으면 미기록은 없다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const ra = record([r0], withColumn(base, 'c3', { type: 'VARCHAR(200)' }), '2_a')
    const rb = record([r0], withColumn(base, 'c3', { type: 'VARCHAR(300)' }), '3_b')
    const plan = planChanges(input([r0, ra, rb], withColumn(base, 'c3', { type: 'VARCHAR(300)' })))
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]!.file).toBe('3_b')
    expect(plan.pending).toEqual([])
  })

  it('중간 기록이 지워지면 뒤 기록의 파일·줄에서 멈춘다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const next = structuredClone(base)
    next.columns['c9'] = { ...next.columns['c3']!, id: 'c9', physicalName: 'ADDED', order: 9 }
    const r1 = record([r0], next, '2_add')
    const r2 = record([r0, r1], withColumn(next, 'c9', { nullable: true }), '3_modify')
    const plan = planChanges(input([r0, r2], withColumn(next, 'c9', { nullable: true })))
    expect(plan.pending).toBeNull()
    expect(plan.error).toMatchObject({ file: '3_modify', line: expect.any(Number) })
    expect(plan.error!.message).toContain('@c9')
  })

  it('기록 파일이 깨졌으면 그 파일·줄을 알린다', () => {
    const plan = planChanges(input([{ file: 'x.erddc', text: "changeset 'x' {\n  format: 1\n" }], buildSampleModel()))
    expect(plan.error).toMatchObject({ file: 'x.erddc' })
    expect(plan.pending).toBeNull()
  })

  it('id 가 없는 항목(파일에서 새로 만든 것)이 있으면 멈춘다', () => {
    const m = buildSampleModel()
    m.tables['new:erdd/tables/X.yaml#table[0]'] = { ...m.tables['t1']!, id: 'new:erdd/tables/X.yaml#table[0]', physicalName: 'X' }
    const plan = planChanges(input([], m))
    expect(plan.error?.message).toContain('erdd serve')
    expect(plan.error?.message).toContain('erdd/tables/X.yaml')
  })

  it('큰 스키마와 기록 30건도 2초 안에 상태를 낸다', () => {
    const m = createEmptyModel()
    for (let t = 0; t < 200; t += 1) {
      m.tables[`t${t}`] = { id: `t${t}`, logicalName: '', physicalName: `TB_${t}`, comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
      for (let c = 0; c < 20; c += 1) {
        m.columns[`t${t}c${c}`] = { id: `t${t}c${c}`, tableId: `t${t}`, logicalName: '', physicalName: `COL_${c}`, type: 'VARCHAR(10)', isPk: c === 0, autoIncrement: false, nullable: c !== 0, defaultValue: null, order: c, comment: null, domainId: null, custom: {} }
      }
    }
    const sources: ChangesetSource[] = [record([], m, 'r000')]
    let cur = m
    for (let i = 1; i <= 29; i += 1) {
      cur = withColumn(cur, `t${i}c1`, { type: `VARCHAR(${20 + i})` })
      sources.push(record(sources, cur, `r${String(i).padStart(3, '0')}`))
    }
    const started = performance.now()
    const plan = planChanges(input(sources, cur))
    expect(performance.now() - started).toBeLessThan(2000)
    expect(plan.pending).toEqual([])
  }, 60_000)
})

describe('composeChangeset', () => {
  it('미기록이 없으면 empty, 이름이 비면 name, 기록이 있는데 baseline 이면 baseline 으로 거절한다', () => {
    const m = buildSampleModel()
    const r0 = record([], m, '1')
    const done = input([r0], m)
    expect(composeChangeset(planChanges(done), done, { name: 'x', created: 'c', baseline: false })).toMatchObject({ ok: false, reason: 'empty', message: '기록할 변경이 없습니다' })
    const fresh = input([], m)
    expect(composeChangeset(planChanges(fresh), fresh, { name: '  ', created: 'c', baseline: false })).toMatchObject({ ok: false, reason: 'name' })
    const more = input([r0], withColumn(m, 'c3', { nullable: true }))
    expect(composeChangeset(planChanges(more), more, { name: 'x', created: 'c', baseline: true })).toMatchObject({ ok: false, reason: 'baseline' })
  })

  it('첫 기록은 baseline 으로 만들 수 있고 머릿말에 실린다', () => {
    const fresh = input([], buildSampleModel())
    const r = composeChangeset(planChanges(fresh), fresh, { name: '운영 DB', created: '2026-09-23T00:00:00Z', baseline: true })
    if (!r.ok) throw new Error(r.message)
    expect(r.text).toContain('  baseline: true')
    expect(r.statementCount).toBe(4)
  })

  it('자기검증 — 재생 결과가 현재 투영과 다르면 파일을 만들지 않는다', () => {
    const fresh = input([], buildSampleModel())
    const plan = planChanges(fresh)
    // 재생 결과와 어긋나는 현재(target)를 흉내 낸다 — 직렬화·재생 버그가 있을 때와 같은 상황이다.
    plan.target!.columns['c3']!.type = 'TAMPERED'
    const r = composeChangeset(plan, fresh, { name: 'x', created: 'c', baseline: false })
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
  })
})

describe('파일명 규칙', () => {
  it('시각은 max(지금, 마지막 기록 + 1초) 다', () => {
    const now = new Date('2026-09-23T04:12:00.500Z')
    expect(changesetStamp(now, [])).toBe('20260923041200')
    expect(changesetStamp(now, ['erdd/changes/20260923041200_a.erddc'])).toBe('20260923041201')
    expect(changesetStamp(now, ['erdd/changes/29990101000000_future.erddc', 'README.md'])).toBe('29990101000001')
  })
  it('시각을 ISO 로 바꾼다', () => {
    expect(stampToIso('20260923041200')).toBe('2026-09-23T04:12:00Z')
  })
  it('이름에서 파일명에 쓸 수 없는 문자를 빼고 공백은 - 로 바꾼다', () => {
    expect(changesetFileName('20260923041200', '회원 등급 추가')).toBe('20260923041200_회원-등급-추가.erddc')
    expect(changesetFileName('20260923041200', '../a/b: c*?')).toBe('20260923041200_ab-c.erddc')
    expect(changesetFileName('20260923041200', ' ./ ')).toBe('20260923041200_changes.erddc')
  })
  it('오류 위치는 「파일 줄행: 메시지」', () => {
    expect(formatChangeIssue({ file: 'a.erddc', line: 3, message: 'm' })).toBe('a.erddc 3행: m')
    expect(formatChangeIssue({ file: null, line: null, message: 'm' })).toBe('m')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/changeset/plan.test.ts`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: 구현한다** — `packages/core/src/changeset/plan.ts`:

```ts
import { deepEqual } from '../equal.js'
import { NEW_ID_PREFIX, isNewId } from '../file-format.js'
import type { ProjectModel } from '../model.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { projectSchema, type ProjectionSettings } from './projection.js'
import { replay, type ChangesetRecord } from './replay.js'
import {
  CHANGESET_FORMAT, compareCodeUnits,
  type ChangeIssue, type SchemaProjection, type Statement,
} from './types.js'

export const CHANGESET_EXT = '.erddc'

export type ChangesetSource = { file: string; text: string }
export type ChangeRecordSummary = {
  file: string; name: string; created: string; baseline: boolean; statementCount: number; text: string
}
export type ChangesPlan = {
  /** 재생 순서(오래된 것부터). */
  records: ChangeRecordSummary[]
  warnings: ChangeIssue[]
  error: ChangeIssue | null
  /** 오류가 있으면 null — 기준선을 모르는 채 차이를 내면 거짓 기록이다. */
  pending: Statement[] | null
  target: SchemaProjection | null
}
export type PlanInput = { sources: readonly ChangesetSource[]; model: ProjectModel; settings: ProjectionSettings }

/**
 * 변경 기록 상태: 기록 전부를 파싱·재생해 기준선을 얻고, 현재 모델의 투영과 비교한다.
 * 첫 오류에서 멈춘다(guide 「기록을 만들 수 없는 경우」).
 */
export function planChanges(input: PlanInput): ChangesPlan {
  const records: ChangeRecordSummary[] = []
  const parsed: ChangesetRecord[] = []
  const stop = (error: ChangeIssue, warnings: ChangeIssue[] = []): ChangesPlan =>
    ({ records, warnings, error, pending: null, target: null })

  for (const src of [...input.sources].sort((a, b) => compareCodeUnits(a.file, b.file))) {
    const r = parseChangeset(src.text)
    if (!r.ok) return stop({ file: src.file, line: r.line, message: r.message })
    parsed.push({ file: src.file, changeset: r.changeset })
    const h = r.changeset.header
    records.push({
      file: src.file, name: h.name, created: h.created, baseline: h.baseline,
      statementCount: r.changeset.statements.length, text: src.text,
    })
  }
  const replayed = replay(parsed)
  if (replayed.error !== null) return stop(replayed.error, replayed.warnings)

  const missing = firstMissingId(input.model)
  if (missing !== null) {
    return stop({ file: null, line: null, message: `id 가 없는 항목이 있습니다(${missing}) — erdd serve 로 열어 id 를 채운 뒤 다시 하세요` }, replayed.warnings)
  }
  const target = projectSchema(input.model, input.settings)
  const diff = diffProjection(replayed.projection, target)
  if (!diff.ok) return stop({ file: null, line: null, message: diff.message }, replayed.warnings)
  return { records, warnings: replayed.warnings, error: null, pending: diff.statements, target }
}

/** 파일에서 id 없이 새로 만든 항목은 `new:<경로>#<종류>[<순번>]` 임시 id 를 받는다 — 그 위치를 알린다. */
function firstMissingId(model: ProjectModel): string | null {
  for (const coll of [model.tables, model.columns, model.relationships, model.indexes]) {
    for (const id of Object.keys(coll)) if (isNewId(id)) return id.slice(NEW_ID_PREFIX.length)
  }
  return null
}

export type ComposeOptions = { name: string; created: string; baseline: boolean }
export type ComposeFailureReason = 'name' | 'invalid' | 'empty' | 'baseline'
export type ComposeResult =
  | { ok: true; text: string; statementCount: number }
  | { ok: false; reason: ComposeFailureReason; message: string }

/** 자기검증에서 새 기록이 기존 기록 전부 뒤에 재생되게 하는 파일명. */
const LAST_FILE = '￿'
const SELF_CHECK_MESSAGE =
  '내부 오류 — 기록을 재생한 결과가 현재 모델과 달라 기록을 만들지 않았습니다. 이 메시지와 함께 알려 주세요'

/**
 * 미기록 변경으로 새 기록 텍스트를 만든다. **쓰기 전에** 기존 기록 + 새 기록을 재생해 현재 투영과
 * 같은지 확인한다(guide 「생성 시 자기검증」) — 직렬화·파서·재생 버그가 저장소에 거짓 기록으로
 * 들어가는 것을 막는 유일한 안전망이다.
 */
export function composeChangeset(plan: ChangesPlan, input: PlanInput, opts: ComposeOptions): ComposeResult {
  const name = opts.name.trim()
  if (name === '') return { ok: false, reason: 'name', message: '변경 기록의 이름을 입력하세요' }
  if (plan.error !== null || plan.pending === null || plan.target === null) {
    return { ok: false, reason: 'invalid', message: plan.error?.message ?? '변경 기록 상태를 계산하지 못했습니다' }
  }
  if (plan.pending.length === 0) return { ok: false, reason: 'empty', message: '기록할 변경이 없습니다' }
  if (opts.baseline && input.sources.length > 0) {
    return { ok: false, reason: 'baseline', message: '--baseline 은 첫 변경 기록에만 쓸 수 있습니다 — 이미 기록이 있습니다' }
  }
  const text = formatChangeset({
    header: { format: CHANGESET_FORMAT, name, created: opts.created, baseline: opts.baseline },
    statements: plan.pending,
  })

  const again = parseChangeset(text)
  if (!again.ok) return { ok: false, reason: 'invalid', message: SELF_CHECK_MESSAGE }
  const records: ChangesetRecord[] = []
  for (const src of input.sources) {
    const r = parseChangeset(src.text)
    if (r.ok) records.push({ file: src.file, changeset: r.changeset })
  }
  records.push({ file: LAST_FILE, changeset: again.changeset })
  const check = replay(records)
  if (check.error !== null || !deepEqual(check.projection, plan.target)) {
    return { ok: false, reason: 'invalid', message: SELF_CHECK_MESSAGE }
  }
  return { ok: true, text, statementCount: plan.pending.length }
}

// ── 파일 이름 — guide 「파일 이름과 재생 순서」 ──

const STAMP = /^(\d{14})_/

function timeToStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}
function stampToTime(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))
}

/**
 * 새 기록의 시각 = max(지금, 마지막 기록 + 1초). 새 기록이 **언제나 마지막에 재생**되게 한다 —
 * 시계가 어긋난 브랜치의 기록이 미래 시각을 들고 와도 그 앞에 끼어들지 않는다.
 */
export function changesetStamp(now: Date, existingFiles: readonly string[]): string {
  let t = Math.floor(now.getTime() / 1000) * 1000
  for (const f of existingFiles) {
    const m = STAMP.exec(f.slice(f.lastIndexOf('/') + 1))
    if (m === null) continue
    const prev = stampToTime(m[1]!)
    if (!Number.isNaN(prev) && prev >= t) t = prev + 1000
  }
  return timeToStamp(t)
}

export function stampToIso(stamp: string): string {
  return new Date(stampToTime(stamp)).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function changesetFileName(stamp: string, name: string): string {
  const slug = name.normalize('NFC').trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return `${stamp}_${slug === '' ? 'changes' : slug}${CHANGESET_EXT}`
}

export function formatChangeIssue(issue: ChangeIssue): string {
  const where = [issue.file, issue.line === null ? null : `${issue.line}행`].filter((x) => x !== null).join(' ')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}
```

- [ ] **Step 4: 로컬 프로토콜 타입을 더한다** — `packages/core/src/local-protocol.ts`:

(a) 파일 머리 import 에 추가:

```ts
import type { ChangeIssue } from './changeset/types.js'
import type { ChangeRecordSummary, ComposeFailureReason } from './changeset/plan.js'
```

(b) `LOCAL_KEEP_PATH` 아래에 추가:

```ts
/** 변경 기록 상태(POST — 로컬 전용 라우트는 전부 POST 다). */
export const LOCAL_CHANGES_PATH = '/local/changes'
/** 변경 기록 생성. 본문 JSON `{ name, baseline? }`. */
export const LOCAL_CHANGES_CREATE_PATH = '/local/changes/create'

/** 미저장 편집이 있을 때 서버 거절과 웹 안내가 같은 문구를 쓴다. */
export const LOCAL_CHANGES_UNSAVED_MESSAGE = '저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 변경 기록을 만드세요'

export type LocalChangesStatus = {
  records: ChangeRecordSummary[]
  /** 오류가 있으면 null. `text` 는 문장만(머릿말 없이). */
  pending: { text: string; count: number } | null
  warnings: ChangeIssue[]
  error: ChangeIssue | null
  unsaved: boolean
}

export type LocalChangesCreateResult =
  | { ok: true; file: string; statementCount: number }
  | { ok: false; reason: 'unsaved' | 'blocked' | ComposeFailureReason; message: string }
```

- [ ] **Step 5: core 공개 export** — `packages/core/src/index.ts` 끝에 추가하고, 기존 `local-protocol.js` export 두 줄을 다음으로 **바꾼다**(기존 이름은 그대로 두고 새 이름을 더한다):

```ts
export {
  LOCAL_EVENTS_PATH, LOCAL_SAVE_PATH, LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, parseLocalEvent,
  LOCAL_CHANGES_PATH, LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_UNSAVED_MESSAGE,
} from './local-protocol.js'
export type {
  LocalEvent, LocalLoadFailure, LocalSaveResult, LocalChangesStatus, LocalChangesCreateResult,
} from './local-protocol.js'
export { projectSchema } from './changeset/projection.js'
export type { ProjectionSettings } from './changeset/projection.js'
export { diffProjection, longestCommonSubsequence } from './changeset/diff.js'
export type { DiffProjectionResult } from './changeset/diff.js'
export { formatChangeset, formatStatements, CHANGESET_BANNER } from './changeset/format.js'
export { parseChangeset } from './changeset/parse.js'
export type { ParseChangesetResult } from './changeset/parse.js'
export { applyChangeset, replay, ReplayFailure } from './changeset/replay.js'
export type { ChangesetRecord, ReplayResult, ReplayWarning } from './changeset/replay.js'
export {
  planChanges, composeChangeset, changesetStamp, changesetFileName, stampToIso, formatChangeIssue,
  CHANGESET_EXT,
} from './changeset/plan.js'
export type {
  ChangesetSource, ChangeRecordSummary, ChangesPlan, PlanInput, ComposeOptions, ComposeResult,
  ComposeFailureReason,
} from './changeset/plan.js'
export { CHANGESET_FORMAT, emptyProjection, compareCodeUnits } from './changeset/types.js'
export type {
  SchemaProjection, ProjTable, ProjColumn, ProjIndex, ProjForeignKey, DialectTypes, ColumnDef,
  IndexDef as ChangesetIndexDef, ForeignKeyDef, TableDef, ColumnChange, AlterAction, Statement,
  Changeset, ChangesetHeader, ChangeIssue,
} from './changeset/types.js'
```

(`IndexDef` 는 `model.ts` 에 같은 이름이 이미 export 돼 있어 `ChangesetIndexDef` 로 내보낸다.)

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm -C packages/core test; pnpm -C packages/core typecheck; echo "exit=$?"`
Expected: 전체 PASS, `exit=0`.

- [ ] **Step 7: 구분력을 확인한다** — `composeChangeset` 의 `!deepEqual(check.projection, plan.target)` 조건을 지우면 「자기검증」 테스트가 실패해야 한다. 확인 후 되돌린다.

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/changeset/plan.ts packages/core/src/changeset/plan.test.ts packages/core/src/local-protocol.ts packages/core/src/index.ts && git commit -m "feat(core): 변경 기록 상태·생성(자기검증)·파일명 규칙과 로컬 채널 타입

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/core/src/changeset/plan.ts packages/core/src/changeset/plan.test.ts packages/core/src/local-protocol.ts packages/core/src/index.ts
```

---

### Task 7: CLI 파일 입출력 — `packages/cli/src/local/changes.ts`

**Files:**
- Create: `packages/cli/src/local/changes.ts`
- Test: `packages/cli/src/local/changes.test.ts`

**Interfaces:**
- Consumes: Task 6 의 `planChanges`·`composeChangeset`·`changesetStamp`·`changesetFileName`·`stampToIso`·`formatStatements`·`CHANGESET_EXT` 와 타입들(`@erdd/core`), `ErddConfig`(`../config.js`).
- Produces:
  - `CHANGES_DIR = 'erdd/changes'`
  - `type ChangesContext = { cwd: string; model: ProjectModel; config: Pick<ErddConfig, 'namingRules' | 'dialects'> }`
  - `readChangeSources(cwd: string): Promise<ChangesetSource[]>`
  - `loadChangesPlan(ctx: ChangesContext): Promise<{ plan: ChangesPlan; input: PlanInput }>`
  - `toLocalStatus(plan: ChangesPlan, unsaved: boolean): LocalChangesStatus`
  - `writeChange(ctx: ChangesContext, opts: { name: string; baseline: boolean; now?: Date }): Promise<LocalChangesCreateResult>`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/cli/src/local/changes.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { modelToFiles, parseChangeset, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { CHANGES_DIR, loadChangesPlan, readChangeSources, toLocalStatus, writeChange } from './changes.js'

const CONFIG = { namingRules: { ...TEST_CONFIG.namingRules }, dialects: [...TEST_CONFIG.dialects] }
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-changes-')) })
const ctx = (model: ProjectModel = buildSampleModel()) => ({ cwd: dir, model, config: CONFIG })

describe('readChangeSources', () => {
  it('디렉터리가 없으면 빈 목록이다', async () => {
    expect(await readChangeSources(dir)).toEqual([])
  })
  it('`.erddc` 가 아닌 파일은 읽지 않고, 파일명 순으로 돌려준다', async () => {
    await mkdir(join(dir, CHANGES_DIR), { recursive: true })
    await writeFile(join(dir, CHANGES_DIR, 'b.erddc'), 'B', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, 'a.erddc'), 'A', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, 'README.md'), '#', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, '.gitkeep'), '', 'utf8')
    expect(await readChangeSources(dir)).toEqual([
      { file: 'erdd/changes/a.erddc', text: 'A' },
      { file: 'erdd/changes/b.erddc', text: 'B' },
    ])
  })
})

describe('writeChange', () => {
  it('erdd/changes/<시각>_<이름>.erddc 를 쓰고, 다시 만들면 기록할 변경이 없다고 거절한다', async () => {
    const r = await writeChange(ctx(), { name: '초기 스키마', baseline: false, now: new Date('2026-09-23T04:12:00Z') })
    expect(r).toEqual({ ok: true, file: 'erdd/changes/20260923041200_초기-스키마.erddc', statementCount: 4 })
    const parsed = parseChangeset(await readFile(join(dir, 'erdd/changes/20260923041200_초기-스키마.erddc'), 'utf8'))
    expect(parsed).toMatchObject({ ok: true, changeset: { header: { name: '초기 스키마', created: '2026-09-23T04:12:00Z' } } })
    expect(await writeChange(ctx(), { name: '또', baseline: false })).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('미래 시각의 기록이 있어도 새 기록은 그 뒤 시각을 받는다', async () => {
    await writeChange(ctx(), { name: 'a', baseline: false, now: new Date('2999-01-01T00:00:00Z') })
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    const r = await writeChange(ctx(m), { name: 'b', baseline: false, now: new Date('2026-01-01T00:00:00Z') })
    expect(r).toMatchObject({ ok: true, file: 'erdd/changes/29990101000001_b.erddc' })
  })

  it('위험한 이름도 erdd/changes 안의 안전한 파일명이 된다', async () => {
    const r = await writeChange(ctx(), { name: '../a/b: c*?', baseline: false, now: new Date('2026-09-23T04:12:00Z') })
    expect(r).toMatchObject({ ok: true, file: 'erdd/changes/20260923041200_ab-c.erddc' })
    expect(await readdir(join(dir, CHANGES_DIR))).toEqual(['20260923041200_ab-c.erddc'])
  })

  it('트리 로더는 erdd/changes 를 모델 파일로 읽지 않는다', async () => {
    await writeTree(dir, modelToFiles(buildSampleModel()).tree)
    await writeChange(ctx(), { name: 'x', baseline: false })
    expect(Object.keys(await readTree(dir)).some((k) => k.startsWith('erdd/changes'))).toBe(false)
  })
})

describe('toLocalStatus', () => {
  it('미기록 문장을 머릿말 없는 텍스트와 개수로 싣는다', async () => {
    const { plan } = await loadChangesPlan(ctx())
    const s = toLocalStatus(plan, true)
    expect(s).toMatchObject({ records: [], warnings: [], error: null, unsaved: true, pending: { count: 4 } })
    expect(s.pending!.text).toContain('create table MBR ')
    expect(s.pending!.text).not.toContain('changeset ')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/changes.test.ts`
Expected: FAIL — `Cannot find module './changes.js'`.

- [ ] **Step 3: 구현한다** — `packages/cli/src/local/changes.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CHANGESET_EXT, changesetFileName, changesetStamp, composeChangeset, formatStatements, planChanges,
  stampToIso,
  type ChangesetSource, type ChangesPlan, type LocalChangesCreateResult, type LocalChangesStatus,
  type PlanInput, type ProjectModel,
} from '@erdd/core'
import type { ErddConfig } from '../config.js'

/**
 * 변경 기록 디렉터리. `erdd/` 아래라 커밋 대상이다. 트리 로더(`readTree`)는 `TOP_LEVEL_FILES` 와
 * `tables/` 만 읽으므로 여기를 모델로 오인하지 않는다.
 */
export const CHANGES_DIR = 'erdd/changes'

export type ChangesContext = {
  cwd: string
  model: ProjectModel
  config: Pick<ErddConfig, 'namingRules' | 'dialects'>
}

/** `.erddc` 만, 파일명 코드 단위 사전순으로. `README.md`·`.gitkeep` 같은 것은 건너뛴다. */
export async function readChangeSources(cwd: string): Promise<ChangesetSource[]> {
  let names: string[]
  try {
    names = await readdir(join(cwd, CHANGES_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const files = names.filter((n) => n.endsWith(CHANGESET_EXT)).sort()
  return Promise.all(files.map(async (n) => ({
    file: `${CHANGES_DIR}/${n}`,
    text: await readFile(join(cwd, CHANGES_DIR, n), 'utf8'),
  })))
}

export async function loadChangesPlan(ctx: ChangesContext): Promise<{ plan: ChangesPlan; input: PlanInput }> {
  const input: PlanInput = {
    sources: await readChangeSources(ctx.cwd),
    model: ctx.model,
    settings: { rules: ctx.config.namingRules, dialects: ctx.config.dialects },
  }
  return { plan: planChanges(input), input }
}

export function toLocalStatus(plan: ChangesPlan, unsaved: boolean): LocalChangesStatus {
  return {
    records: plan.records,
    pending: plan.pending === null ? null : { text: formatStatements(plan.pending), count: plan.pending.length },
    warnings: plan.warnings,
    error: plan.error,
    unsaved,
  }
}

/**
 * 새 기록을 쓴다. 판정·자기검증은 core 의 `composeChangeset` 이 하고 여기는 파일만 다룬다.
 * `wx` — 같은 이름이 이미 있으면(두 곳에서 동시에 만든 경우) 덮어쓰지 않고 실패한다.
 */
export async function writeChange(
  ctx: ChangesContext, opts: { name: string; baseline: boolean; now?: Date },
): Promise<LocalChangesCreateResult> {
  const { plan, input } = await loadChangesPlan(ctx)
  const stamp = changesetStamp(opts.now ?? new Date(), input.sources.map((s) => s.file))
  const composed = composeChangeset(plan, input, { name: opts.name, created: stampToIso(stamp), baseline: opts.baseline })
  if (!composed.ok) return composed
  const fileName = changesetFileName(stamp, opts.name)
  await mkdir(join(ctx.cwd, CHANGES_DIR), { recursive: true })
  await writeFile(join(ctx.cwd, CHANGES_DIR, fileName), composed.text, { encoding: 'utf8', flag: 'wx' })
  return { ok: true, file: `${CHANGES_DIR}/${fileName}`, statementCount: composed.statementCount }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/changes.test.ts; pnpm -C packages/cli typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/changes.ts packages/cli/src/local/changes.test.ts && git commit -m "feat(cli): erdd/changes 기록 파일 읽기·쓰기

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/cli/src/local/changes.ts packages/cli/src/local/changes.test.ts
```

---

### Task 8: `erdd changes` 명령

**Files:**
- Create: `packages/cli/src/commands/changes.ts`
- Modify: `packages/cli/src/main.ts` (추가만)
- Test: `packages/cli/src/commands/changes.test.ts`

**Interfaces:**
- Consumes: Task 7 전부, `readConfig`, `filesToModel`, `readTree`, `hasDraft`·`UNSAVED_NOTICE`, `emit`·`note`·`CliError`, `run`·`CommandCtx`, `formatChangeIssue`.
- Produces: `type ChangesCtx = CommandCtx & { sub: 'status' | 'new'; name?: string; baseline: boolean; check: boolean }`, `changes(ctx: ChangesCtx): Promise<number>`.

사람용 출력 문구(매뉴얼이 인용한다 — 그대로 쓴다):
- 첫 줄 `변경 기록 N건 (erdd/changes/)`
- 경고 `⚠️ 기록 간 경합 — <위치>: <메시지>`
- 오류 `오류: <위치>: <메시지>`
- 미기록 없음 `미기록 변경 없음`
- 미기록 있음 `미기록 변경 N문장 — erdd changes new <이름> 으로 기록합니다` + 빈 줄 + 두 칸 들여 쓴 본문
- 생성 `기록했습니다: <파일> (문장 N개)`
- `--check` 실패(stderr) `미기록 변경이 있습니다 — erdd changes new <이름> 으로 기록하세요`
- 서버 연결 프로젝트 `변경 기록은 로컬 모드 전용입니다 — 서버에 연결된 프로젝트에서는 쓸 수 없습니다`
- 미저장 편집에서 new `저장하지 않은 편집이 있습니다. 먼저 erdd serve 화면에서 저장한 뒤 변경 기록을 만드세요`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/cli/src/commands/changes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelToFiles, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { writeTree } from '../tree.js'
import { main } from '../main.js'
import { changes } from './changes.js'

let dir: string
let out: string[]
let err: string[]
const LOCAL_CONFIG = {
  ...TEST_CONFIG, serverUrl: null, projectId: null,
  dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules },
}
const base = { json: false, yes: false, strict: false } as const
const status = (extra: Partial<{ json: boolean; check: boolean }> = {}) =>
  changes({ cwd: dir, ...base, sub: 'status', baseline: false, check: false, ...extra })
const create = (name: string, baseline = false) =>
  changes({ cwd: dir, ...base, sub: 'new', name, baseline, check: false })
const seed = (m: ProjectModel) => writeTree(dir, modelToFiles(m).tree)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-changes-cmd-'))
  out = []
  err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, LOCAL_CONFIG)
  await seed(buildSampleModel())
})
afterEach(() => vi.restoreAllMocks())

describe('erdd changes', () => {
  it('기록이 없으면 스키마 전체가 미기록으로 보인다', async () => {
    expect(await status()).toBe(0)
    const text = out.join('')
    expect(text).toContain('변경 기록 0건 (erdd/changes/)')
    expect(text).toContain('미기록 변경 4문장 — erdd changes new <이름> 으로 기록합니다')
    expect(text).toContain('  create table MBR ')
  })

  it('new 로 기록하면 미기록이 없어진다', async () => {
    expect(await create('초기')).toBe(0)
    expect(out.join('')).toMatch(/기록했습니다: erdd\/changes\/\d{14}_초기\.erddc \(문장 4개\)/)
    out = []
    expect(await status()).toBe(0)
    expect(out.join('')).toContain('변경 기록 1건 (erdd/changes/)')
    expect(out.join('')).toContain('미기록 변경 없음')
  })

  it('--check 는 미기록이 있을 때만 1 이다', async () => {
    await create('초기')
    expect(await status({ check: true })).toBe(0)
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    await seed(m)
    expect(await status({ check: true })).toBe(1)
    expect(err.join('')).toContain('미기록 변경이 있습니다 — erdd changes new <이름> 으로 기록하세요')
  })

  it('--json 은 LocalChangesStatus 모양이다', async () => {
    expect(await status({ json: true })).toBe(0)
    const payload = JSON.parse(out.join('')) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['error', 'pending', 'records', 'unsaved', 'warnings'])
    expect(payload['pending']).toMatchObject({ count: 4 })
  })

  it('서버에 연결된 프로젝트에서는 멈춘다', async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, serverUrl: TEST_CONFIG.serverUrl, projectId: TEST_CONFIG.projectId })
    expect(await status()).toBe(1)
    expect(err.join('')).toContain('변경 기록은 로컬 모드 전용입니다')
  })

  it('미저장 편집이 있으면 new 를 거절한다', async () => {
    await mkdir(join(dir, '.erdd'), { recursive: true })
    await writeFile(join(dir, '.erdd/draft.json'), '{}', 'utf8')
    expect(await create('초기')).toBe(1)
    expect(err.join('')).toContain('저장하지 않은 편집이 있습니다. 먼저 erdd serve 화면에서 저장한 뒤 변경 기록을 만드세요')
    await expect(readdir(join(dir, 'erdd/changes'))).rejects.toThrow()
  })

  it('--baseline 은 첫 기록에만 쓸 수 있다', async () => {
    expect(await create('운영', true)).toBe(0)
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    await seed(m)
    expect(await create('또', true)).toBe(1)
    expect(err.join('')).toContain('--baseline 은 첫 변경 기록에만')
  })

  it('깨진 기록 파일은 파일·줄과 함께 1 로 멈춘다', async () => {
    await mkdir(join(dir, 'erdd/changes'), { recursive: true })
    await writeFile(join(dir, 'erdd/changes/20260101000000_x.erddc'), "changeset 'x' {\n  format: 1\n  created: 'c'\n}\nbogus  @t1\n", 'utf8')
    expect(await status()).toBe(1)
    expect(out.join('')).toContain('오류: erdd/changes/20260101000000_x.erddc 5행:')
  })
})

describe('main 의 changes 분기', () => {
  it('new 에 이름이 없거나 모르는 하위 명령이면 사용법 오류(2)다', async () => {
    expect(await main(['changes', 'new'], dir)).toBe(2)
    expect(await main(['changes', 'new', '--baseline'], dir)).toBe(2)
    expect(await main(['changes', 'bogus'], dir)).toBe(2)
    expect(await main(['changes', '--baseline'], dir)).toBe(2)
  })
  it('changes 는 상태, changes new <이름> 은 생성으로 간다', async () => {
    expect(await main(['changes'], dir)).toBe(0)
    expect(await main(['changes', 'new', '초기'], dir)).toBe(0)
    expect(await main(['changes', '--check'], dir)).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/commands/changes.test.ts`
Expected: FAIL — `Cannot find module './changes.js'`.

- [ ] **Step 3: 명령을 구현한다** — `packages/cli/src/commands/changes.ts`:

```ts
import { filesToModel, formatChangeIssue, type LocalChangesStatus } from '@erdd/core'
import { readConfig } from '../config.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
import { CHANGES_DIR, loadChangesPlan, toLocalStatus, writeChange } from '../local/changes.js'
import { CliError, emit, note } from '../output.js'
import { readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

export type ChangesCtx = CommandCtx & {
  sub: 'status' | 'new'
  name?: string
  baseline: boolean
  check: boolean
}

const LOCAL_ONLY = '변경 기록은 로컬 모드 전용입니다 — 서버에 연결된 프로젝트에서는 쓸 수 없습니다'
const UNSAVED_REFUSAL = '저장하지 않은 편집이 있습니다. 먼저 erdd serve 화면에서 저장한 뒤 변경 기록을 만드세요'

function humanStatus(s: LocalChangesStatus): string {
  const lines = [`변경 기록 ${s.records.length}건 (${CHANGES_DIR}/)`]
  for (const w of s.warnings) lines.push(`⚠️ 기록 간 경합 — ${formatChangeIssue(w)}`)
  if (s.error !== null) {
    lines.push(`오류: ${formatChangeIssue(s.error)}`)
  } else if (s.pending === null || s.pending.count === 0) {
    lines.push('미기록 변경 없음')
  } else {
    lines.push(
      `미기록 변경 ${s.pending.count}문장 — erdd changes new <이름> 으로 기록합니다`,
      '',
      ...s.pending.text.split('\n').map((l) => (l === '' ? '' : `  ${l}`)),
    )
  }
  if (s.unsaved) lines.push(UNSAVED_NOTICE)
  return lines.join('\n')
}

/**
 * `erdd changes` — 변경 기록 상태·생성(guide 「변경 기록 — `.erddc` 문법과 재생 규칙」).
 * 로컬 모드 전용이다. 보는 모델은 **디스크의 `erdd/`** 다(미저장 편집은 포함하지 않는다).
 */
export function changes(ctx: ChangesCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    if (config.serverUrl !== null || config.projectId !== null) throw new CliError('VALIDATION', LOCAL_ONLY)
    const unsaved = await hasDraft(ctx.cwd)
    const files = filesToModel(await readTree(ctx.cwd))
    if (!files.ok) {
      // validate·export 와 같은 봉투다 — 같은 파일 오류를 명령마다 다른 모양으로 말하지 않는다.
      emit(
        ctx.json,
        [`파싱 오류 ${files.issues.length}건`, ...files.issues.map((i) => `  ${i.path}: ${i.message}`)].join('\n'),
        { ok: false, parseErrors: files.issues, integrityIssues: [], warnings: [] },
      )
      return 1
    }
    const cctx = { cwd: ctx.cwd, model: files.model, config }

    if (ctx.sub === 'new') {
      if (unsaved) throw new CliError('VALIDATION', UNSAVED_REFUSAL)
      const r = await writeChange(cctx, { name: ctx.name ?? '', baseline: ctx.baseline })
      if (!r.ok) throw new CliError('VALIDATION', r.message, { reason: r.reason })
      emit(ctx.json, `기록했습니다: ${r.file} (문장 ${r.statementCount}개)`, r)
      return 0
    }

    const { plan } = await loadChangesPlan(cctx)
    const s = toLocalStatus(plan, unsaved)
    emit(ctx.json, humanStatus(s), s)
    if (s.error !== null) return 1
    if (ctx.check && s.pending !== null && s.pending.count > 0) {
      note('미기록 변경이 있습니다 — erdd changes new <이름> 으로 기록하세요')
      return 1
    }
    return 0
  })
}
```

- [ ] **Step 4: `main.ts` 에 분기를 **추가만** 한다**

(a) import 목록 끝(`import { validate } …` 다음)에 `import { changes } from './commands/changes.js'` 를 더한다.

(b) `USAGE` 의 명령 목록 마지막 줄(`skill install …`) 다음에 두 줄을 더한다:

```
  changes      변경 기록 상태 — 미기록 변경 미리보기(로컬 모드 전용)
  changes new <이름> 미기록 변경을 erdd/changes/ 에 기록한다
```

(c) `USAGE` 의 옵션 목록 `--help` 줄 **바로 앞**에 두 줄을 더한다:

```
  --check               changes 전용 — 미기록 변경이 있으면 종료 코드 1
  --baseline            changes new 전용 — 첫 기록을 「이미 DB 에 있음」으로 표시
```

(d) `switch (command)` 의 `default:` **바로 앞**에 추가:

```ts
    case 'changes': {
      const sub = argv[1]
      if (sub === 'new') {
        const name = argv[2]
        if (name === undefined || name.startsWith('-')) {
          return usageError(json, '사용법: erdd changes new <이름> [--baseline]')
        }
        return changes({ ...ctx, sub: 'new', name, baseline: argv.includes('--baseline'), check: false })
      }
      if (sub !== undefined && !sub.startsWith('-')) return usageError(json, `알 수 없는 하위 명령: changes ${sub}`)
      if (argv.includes('--baseline')) return usageError(json, '--baseline 은 changes new 전용입니다')
      return changes({ ...ctx, sub: 'status', baseline: false, check: argv.includes('--check') })
    }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/commands/changes.test.ts src/main.test.ts; pnpm -C packages/cli typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`. `main.test.ts` 에 USAGE 전문을 스냅숏으로 잠근 케이스가 있어 실패하면, 그 기대값에 위 네 줄을 더한다(프로덕션을 되돌리지 않는다) — 그렇게 했다고 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/cli/src/commands/changes.ts packages/cli/src/commands/changes.test.ts packages/cli/src/main.ts && git commit -m "feat(cli): erdd changes — 미기록 변경 상태·기록 생성·--check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/cli/src/commands/changes.ts packages/cli/src/commands/changes.test.ts packages/cli/src/main.ts
```

(`main.test.ts` 를 고쳤다면 경로에 함께 넣는다.)

---

### Task 9: 로컬 서버 엔드포인트

**Files:**
- Modify: `packages/cli/src/local/server.ts`
- Test: `packages/cli/src/local/server.test.ts` (describe 하나 추가)

**Interfaces:**
- Consumes: Task 7 의 `loadChangesPlan`·`toLocalStatus`·`writeChange`, Task 6 의 `LOCAL_CHANGES_PATH`·`LOCAL_CHANGES_CREATE_PATH`·`LOCAL_CHANGES_UNSAVED_MESSAGE`·`LocalChangesStatus`·`LocalChangesCreateResult`.
- Produces: `POST /local/changes` → `LocalChangesStatus`, `POST /local/changes/create` (JSON `{ name: string; baseline?: boolean }`) → `LocalChangesCreateResult`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/cli/src/local/server.test.ts` 끝에 추가(머리 import 에 `LOCAL_CHANGES_PATH, LOCAL_CHANGES_CREATE_PATH, createEmptyModel, modelToFiles` 를 `@erdd/core` 에서, `writeTree` 를 `'../tree.js'` 에서 더한다):

```ts
describe('변경 기록 엔드포인트', () => {
  const T = '018f6b0e-0000-7000-8000-0000000000c1'
  const C1 = '018f6b0e-0000-7000-8000-0000000000c2'

  async function projectWithTable(): Promise<string> {
    const cwd = await project()
    const m = createEmptyModel()
    m.tables[T] = { id: T, logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    m.columns[C1] = { id: C1, tableId: T, logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null, domainId: null, custom: {} }
    await writeTree(cwd, modelToFiles(m).tree)
    return cwd
  }

  async function postJson(url: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return res.json()
  }

  it('상태는 미기록을 보여 주고, 생성하면 파일이 생기고 미기록이 사라진다', async () => {
    const cwd = await projectWithTable()
    const s = await start(cwd)
    expect(await postJson(s.url, LOCAL_CHANGES_PATH)).toMatchObject({ records: [], error: null, unsaved: false, pending: { count: 1 } })
    const created = await postJson(s.url, LOCAL_CHANGES_CREATE_PATH, { name: '초기' }) as { ok: boolean; file: string }
    expect(created).toMatchObject({ ok: true, statementCount: 1 })
    expect(await readdir(join(cwd, 'erdd/changes'))).toEqual([created.file.slice('erdd/changes/'.length)])
    expect(await postJson(s.url, LOCAL_CHANGES_PATH)).toMatchObject({ pending: { count: 0 } })
  }, 10_000)

  it('미저장 편집이 있으면 생성을 거절한다', async () => {
    const cwd = await projectWithTable()
    const s = await start(cwd)
    await mutate(s.url, [{ action: 'update', entity: 'table', entityId: T, changes: { logicalName: { from: '회원', to: '멤버' } } }])
    expect(await postJson(s.url, LOCAL_CHANGES_CREATE_PATH, { name: '초기' })).toEqual({
      ok: false, reason: 'unsaved', message: '저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 변경 기록을 만드세요',
    })
    expect(await postJson(s.url, LOCAL_CHANGES_PATH)).toMatchObject({ unsaved: true })
  }, 10_000)

  it('기록 파일을 써도 브라우저에 reload 를 보내지 않는다', async () => {
    const cwd = await projectWithTable()
    const s = await start(cwd)
    const res = await fetch(`${s.url}${LOCAL_EVENTS_PATH}`)
    const reader = res.body!.getReader()
    const messages: string[] = []
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        messages.push(new TextDecoder().decode(value))
      }
    })()
    await sleep(300)
    messages.length = 0
    await postJson(s.url, LOCAL_CHANGES_CREATE_PATH, { name: '초기' })
    await sleep(800)
    expect(messages.join('')).not.toContain('"type":"reload"')
    await reader.cancel()
  }, 10_000)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/server.test.ts -t "변경 기록 엔드포인트"`
Expected: FAIL — 404 응답의 JSON 이 기대 모양과 다르다.

- [ ] **Step 3: 구현한다** — `packages/cli/src/local/server.ts`:

(a) `@erdd/core` import 에 `LOCAL_CHANGES_PATH, LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_UNSAVED_MESSAGE, type LocalChangesCreateResult, type LocalChangesStatus` 를 더하고, `import { loadChangesPlan, toLocalStatus, writeChange } from './changes.js'` 를 더한다.

(b) `app.post(LOCAL_KEEP_PATH, …)` 블록 **바로 뒤**에 추가:

```ts
  /**
   * 변경 기록(guide 「변경 기록 — `.erddc` 문법과 재생 규칙」). 상태는 **화면 모델 기준**이다 —
   * 미저장 편집이 있으면 미리보기에 포함되고 `unsaved` 가 켜진다. 생성은 저장된 상태에서만 한다
   * (스냅샷과 같은 규칙 — 파일 어디에도 없는 상태를 가리키는 기록이 생기면 안 된다).
   * ⚠️ `dirty` 가 아니라 `unsaved` 를 본다 — 스냅샷 생성 가드와 같은 이유(디바운스 창).
   */
  const BLOCKED_MESSAGE = '파일이 깨져 편집이 잠겨 있습니다 — 파일을 고친 뒤 다시 하세요'
  app.post(LOCAL_CHANGES_PATH, async (): Promise<LocalChangesStatus> => {
    const state = store.state
    if (!state.ok) {
      return { records: [], pending: null, warnings: [], error: { file: null, line: null, message: BLOCKED_MESSAGE }, unsaved: store.unsaved }
    }
    const { plan } = await loadChangesPlan({ cwd, model: state.model, config })
    return toLocalStatus(plan, store.unsaved)
  })
  app.post<{ Body: unknown }>(LOCAL_CHANGES_CREATE_PATH, async (req): Promise<LocalChangesCreateResult> => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const name = typeof body['name'] === 'string' ? body['name'] : ''
    const baseline = body['baseline'] === true
    const state = store.state
    if (!state.ok) return { ok: false, reason: 'blocked', message: BLOCKED_MESSAGE }
    if (store.unsaved) return { ok: false, reason: 'unsaved', message: LOCAL_CHANGES_UNSAVED_MESSAGE }
    return writeChange({ cwd, model: state.model, config }, { name, baseline })
  })
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/server.test.ts; pnpm -C packages/cli typecheck; echo "exit=$?"`
Expected: 전체 PASS(기존 케이스 포함), `exit=0`.

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/server.ts packages/cli/src/local/server.test.ts && git commit -m "feat(cli): 로컬 서버에 변경 기록 상태·생성 엔드포인트

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- packages/cli/src/local/server.ts packages/cli/src/local/server.test.ts
```

---

### Task 10: 웹 「변경 기록」 탭

**Files:**
- Create: `apps/web/src/editor/use-local-changes.ts`
- Create: `apps/web/src/editor/changes-section.tsx`
- Modify: `apps/web/src/editor/version-dialog.tsx`, `apps/web/src/editor/use-local-watch.ts`
- Test: `apps/web/src/editor/changes-section.test.tsx`, `apps/web/src/editor/version-dialog.test.tsx`(케이스 추가), `apps/web/src/editor/use-local-watch.test.tsx`(케이스 추가)

**Interfaces:**
- Consumes: `LOCAL_CHANGES_PATH`·`LOCAL_CHANGES_CREATE_PATH`·`LOCAL_CHANGES_UNSAVED_MESSAGE`·`formatChangeIssue`·`LocalChangesStatus`·`LocalChangesCreateResult`·`ChangeRecordSummary`(`@erdd/core`).
- Produces: `LOCAL_CHANGES_QUERY_KEY`, `useLocalChanges()`, `useCreateLocalChange()`, `ChangesSection()`.

화면 문구(매뉴얼이 인용한다): 탭 「변경 기록」, 소제목 「미기록 변경」, 「기록할 변경이 없습니다」, 입력 라벨 「이름」(placeholder 「예: 회원 등급 추가」), 버튼 「변경 기록 만들기」, 「아직 변경 기록이 없습니다」, 배지 「기준선」, 경고 「⚠️ 기록 간 경합 — …」, 오류 「오류: …」, 토스트 「변경 기록을 만들었습니다: <파일>」.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/web/src/editor/changes-section.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_PATH,
  type LocalChangesCreateResult, type LocalChangesStatus,
} from '@erdd/core'
import { ChangesSection } from './changes-section.js'

const EMPTY: LocalChangesStatus = { records: [], pending: { text: '', count: 0 }, warnings: [], error: null, unsaved: false }
const PENDING: LocalChangesStatus = { ...EMPTY, pending: { text: 'create table MBR {  @t1\n}', count: 1 } }

function stubLocal(statuses: LocalChangesStatus[], create?: (body: unknown) => LocalChangesCreateResult) {
  let i = 0
  const calls: { path: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url), 'http://localhost').pathname
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
    calls.push({ path, body })
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === LOCAL_CHANGES_PATH) return json(statuses[Math.min(i++, statuses.length - 1)])
    if (path === LOCAL_CHANGES_CREATE_PATH && create) return json(create(body))
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  render(<ChangesSection />, { wrapper })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ChangesSection', () => {
  it('미기록 변경을 미리 보여 주고, 이름을 넣어 만들면 생성 요청 뒤 다시 읽는다', async () => {
    const calls = stubLocal([PENDING, EMPTY], () => ({ ok: true, file: 'erdd/changes/20260923041200_x.erddc', statementCount: 1 }))
    renderSection()
    expect(await screen.findByLabelText('미기록 변경 미리보기')).toHaveTextContent('create table MBR')
    const button = screen.getByRole('button', { name: '변경 기록 만들기' })
    expect(button).toBeDisabled()                       // 이름이 비었다
    await userEvent.type(screen.getByLabelText('이름'), '회원 등급 추가')
    await userEvent.click(button)
    await waitFor(() => { expect(calls.some((c) => c.path === LOCAL_CHANGES_CREATE_PATH)).toBe(true) })
    expect(calls.find((c) => c.path === LOCAL_CHANGES_CREATE_PATH)!.body).toEqual({ name: '회원 등급 추가' })
    expect(await screen.findByText('기록할 변경이 없습니다')).toBeInTheDocument()
  })

  it('미저장 편집이 있으면 안내하고 버튼을 잠근다', async () => {
    stubLocal([{ ...PENDING, unsaved: true }])
    renderSection()
    expect(await screen.findByText('저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 변경 기록을 만드세요')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('이름'), 'x')
    expect(screen.getByRole('button', { name: '변경 기록 만들기' })).toBeDisabled()
  })

  it('재생 오류와 경합 경고를 위치와 함께 보여 주고, 오류면 잠근다', async () => {
    stubLocal([{
      ...EMPTY, pending: null,
      error: { file: 'erdd/changes/b.erddc', line: 5, message: '없습니다' },
      warnings: [{ file: 'erdd/changes/a.erddc', line: 3, message: '이전 값이' }],
    }])
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent('오류: erdd/changes/b.erddc 5행: 없습니다')
    expect(screen.getByText('⚠️ 기록 간 경합 — erdd/changes/a.erddc 3행: 이전 값이')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('이름'), 'x')
    expect(screen.getByRole('button', { name: '변경 기록 만들기' })).toBeDisabled()
  })

  it('기록 목록은 최신순이고, 누르면 본문을 펼친다', async () => {
    stubLocal([{
      ...EMPTY,
      records: [
        { file: 'erdd/changes/1_a.erddc', name: '초기', created: '2026-09-01T00:00:00Z', baseline: true, statementCount: 4, text: '본문-초기' },
        { file: 'erdd/changes/2_b.erddc', name: '등급 추가', created: '2026-09-02T00:00:00Z', baseline: false, statementCount: 1, text: '본문-등급' },
      ],
    }])
    renderSection()
    const rows = await screen.findAllByRole('button', { expanded: false })
    expect(rows[0]).toHaveTextContent('등급 추가')
    expect(rows[1]).toHaveTextContent('초기')
    expect(rows[1]).toHaveTextContent('기준선')
    await userEvent.click(rows[0]!)
    expect(screen.getByText('본문-등급')).toBeInTheDocument()
  })
})
```

`apps/web/src/editor/version-dialog.test.tsx` 의 `describe('VersionDialog', …)` 안에 추가:

```tsx
  it('로컬 모드에서만 「변경 기록」 탭이 보인다', async () => {
    renderDialog({
      'auth.me': () => ({ data: { id: 'u1', email: 'local@erdd', name: '로컬', role: 'user', mode: 'local' } }),
      'snapshot.list': () => ({ data: { items: [] } }),
    })
    expect(await screen.findByRole('button', { name: '변경 기록' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이력' })).toBeNull()
  })

  it('서버 모드에는 「변경 기록」 탭이 없다', async () => {
    renderDialog({ 'snapshot.list': () => ({ data: { items: [] } }) })
    expect(await screen.findByRole('button', { name: '이력' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '변경 기록' })).toBeNull()
  })
```

`apps/web/src/editor/use-local-watch.test.tsx` 의 describe 안에 추가(머리 import 에 `import { LOCAL_CHANGES_QUERY_KEY } from './use-local-changes.js'`):

```tsx
  it('로컬 이벤트마다 변경 기록 조회를 무효화한다', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
    const w = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
      </QueryClientProvider>
    )
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: w })
    FakeEventSource.last!.emit({ type: 'status', dirty: false, external: false })
    expect(spy).toHaveBeenCalledWith({ queryKey: LOCAL_CHANGES_QUERY_KEY })
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/changes-section.test.tsx src/editor/version-dialog.test.tsx src/editor/use-local-watch.test.tsx`
Expected: FAIL — `./changes-section.js`·`./use-local-changes.js` 없음.

- [ ] **Step 3: 훅을 구현한다** — `apps/web/src/editor/use-local-changes.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_PATH,
  type LocalChangesCreateResult, type LocalChangesStatus,
} from '@erdd/core'

/** `use-local-watch.ts` 가 로컬 이벤트마다 이 키를 무효화한다. */
export const LOCAL_CHANGES_QUERY_KEY = ['local-changes'] as const

/**
 * tRPC 밖 로컬 전용 채널이다(`local-protocol.ts`). **상태 코드를 본다** — 500·403 을 그대로
 * 캐스트하면 약속하지 않은 모양이 화면으로 샌다(`use-local-save.ts` 와 같은 이유).
 */
async function postJson(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`요청이 실패했습니다 (HTTP ${res.status})`)
  return res.json()
}

export function useLocalChanges() {
  return useQuery({
    queryKey: LOCAL_CHANGES_QUERY_KEY,
    queryFn: async () => await postJson(LOCAL_CHANGES_PATH) as LocalChangesStatus,
  })
}

export function useCreateLocalChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => await postJson(LOCAL_CHANGES_CREATE_PATH, input) as LocalChangesCreateResult,
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: LOCAL_CHANGES_QUERY_KEY }) },
  })
}
```

- [ ] **Step 4: 탭 본문을 구현한다** — `apps/web/src/editor/changes-section.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { LOCAL_CHANGES_UNSAVED_MESSAGE, formatChangeIssue, type ChangeRecordSummary } from '@erdd/core'
import { formatCreatedAt } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateLocalChange, useLocalChanges } from './use-local-changes.js'

function RecordRow({ record }: { record: ChangeRecordSummary }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border p-3">
      <button
        type="button" className="grid w-full gap-0.5 text-left" aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-medium">
          {record.name}
          {record.baseline && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">기준선</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatCreatedAt(record.created)} · 문장 {record.statementCount}개 · {record.file}
        </span>
      </button>
      {expanded && <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs">{record.text}</pre>}
    </div>
  )
}

/**
 * 「버전」 → 「변경 기록」 탭(로컬 모드 전용). 미기록 변경 미리보기는 **화면 모델 기준**이고
 * (미저장 편집 포함), 만들기는 저장된 상태에서만 된다. 규칙은 guide 「변경 기록 — `.erddc` 문법과
 * 재생 규칙」.
 */
export function ChangesSection() {
  const status = useLocalChanges()
  const create = useCreateLocalChange()
  const [name, setName] = useState('')
  const data = status.data
  const pendingCount = data?.pending?.count ?? 0
  const locked = data === undefined || data.error !== null || data.unsaved || pendingCount === 0

  const onCreate = async () => {
    try {
      const r = await create.mutateAsync({ name: name.trim() })
      if (r.ok) {
        toast.success(`변경 기록을 만들었습니다: ${r.file}`)
        setName('')
      } else {
        toast.error(r.message)
      }
    } catch {
      toast.error('변경 기록을 만들지 못했습니다')
    }
  }

  return (
    <div className="grid gap-4">
      {status.isError && <p role="alert" className="text-sm text-destructive">변경 기록을 읽지 못했습니다</p>}
      {data?.error && <p role="alert" className="text-sm text-destructive">오류: {formatChangeIssue(data.error)}</p>}
      {data?.warnings.map((w, i) => (
        <p key={i} className="text-sm text-amber-700 dark:text-amber-400">⚠️ 기록 간 경합 — {formatChangeIssue(w)}</p>
      ))}
      {data?.unsaved && <p className="text-sm text-muted-foreground">{LOCAL_CHANGES_UNSAVED_MESSAGE}</p>}

      <div className="grid gap-2">
        <p className="text-sm font-medium">미기록 변경</p>
        {data?.pending && pendingCount === 0 && (
          <p className="text-sm text-muted-foreground">기록할 변경이 없습니다</p>
        )}
        {data?.pending && pendingCount > 0 && (
          <pre aria-label="미기록 변경 미리보기" className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs">
            {data.pending.text}
          </pre>
        )}
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="change-name">이름</Label>
            <Input
              id="change-name" value={name} placeholder="예: 회원 등급 추가"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            type="button" disabled={locked || create.isPending || name.trim() === ''}
            onClick={() => { void onCreate() }}
          >
            변경 기록 만들기
          </Button>
        </div>
      </div>

      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {data?.records.length === 0 && <p className="text-sm text-muted-foreground">아직 변경 기록이 없습니다</p>}
        {[...(data?.records ?? [])].reverse().map((r) => <RecordRow key={r.file} record={r} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 다이얼로그와 감시 훅을 고친다**

`apps/web/src/editor/version-dialog.tsx`:
- `type Section = 'snapshot' | 'history' | 'diff'` → `type Section = 'snapshot' | 'history' | 'diff' | 'changes'`
- import 에 `import { ChangesSection } from './changes-section.js'`
- 「비교」 버튼 **다음**에 추가:

```tsx
          {isLocal && (
            <Button
              type="button" size="sm" variant={section === 'changes' ? 'default' : 'outline'}
              onClick={() => setSection('changes')}
            >
              변경 기록
            </Button>
          )}
```

- `SnapshotDiff` 렌더 줄 **다음**에 `{isLocal && section === 'changes' && <ChangesSection />}` 를 더한다.
- `VersionDialog` 의 JSDoc 첫 줄을 「헤더의 "버전": 스냅샷·이력·비교, 로컬 모드에서는 변경 기록까지 섹션을 토글로 오간다.」로 고친다.

`apps/web/src/editor/use-local-watch.ts`:
- import 에 `import { LOCAL_CHANGES_QUERY_KEY } from './use-local-changes.js'`
- `if (payload === null) return` **다음 줄**에 추가:

```ts
      // 저장·재읽기·잠김은 변경 기록의 미리보기·목록을 바꾼다. 조회 중인 탭이 없으면 무효화는 비용이 없다.
      void queryClient.invalidateQueries({ queryKey: LOCAL_CHANGES_QUERY_KEY })
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/; pnpm -C apps/web typecheck; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/use-local-changes.ts apps/web/src/editor/changes-section.tsx apps/web/src/editor/changes-section.test.tsx apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx apps/web/src/editor/use-local-watch.ts apps/web/src/editor/use-local-watch.test.tsx && git commit -m "feat(web): 로컬 모드 「버전」 다이얼로그에 「변경 기록」 탭

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- apps/web/src/editor/use-local-changes.ts apps/web/src/editor/changes-section.tsx apps/web/src/editor/changes-section.test.tsx apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx apps/web/src/editor/use-local-watch.ts apps/web/src/editor/use-local-watch.test.tsx
```

---

### Task 11: SKILL.md 와 문서

**Files:**
- Create: `docs/guides/changeset-format.md`
- Modify: `packages/cli/skill/SKILL.md`, `docs/manual/local-guide.md`, `docs/manual/cli-guide.md`, `docs/manual/user-guide.md`, `docs/ops/known-issues.md`, `CLAUDE.md`

문서 규약(`docs/guides/doc-conventions.md`): 연대기 금지, `파일:줄번호` 인용 금지, 같은 규칙을 두 곳에 쓰지 않는다 — 매뉴얼은 사용법만 쓰고 규칙은 guide 를 가리킨다.

- [ ] **Step 1: 정본 guide 를 만든다** — `docs/guides/changeset-format.md` 전문:

````markdown
# 변경 기록 — `.erddc` 문법과 재생 규칙

`erdd/changes/*.erddc` 는 스키마 수정 내역을 DB·마이그레이션 도구에 묶이지 않는 텍스트로 남긴다.
**ERDD 는 SQL 을 만들지 않는다** — 각 프로젝트가 이 기록을 보고 자기 도구로 마이그레이션을 쓴다.
사용법은 [로컬 모드 매뉴얼](../manual/local-guide.md) 「5.6 변경 기록」 이다. 이 문서는 **규칙과
어기면 무엇이 조용히 깨지는가**를 갖는다. 로컬 모드 전용이다.

- 기준선은 **기록 파일 전부를 파일명 순으로 재생한 결과**다. 따로 저장한 사본이 없다.
- 미기록 변경 = 기준선 ↔ 현재 모델의 스키마 투영 차이.
- 새 기록은 쓰기 **전에** 재생해 현재와 같아지는지 확인한다.

코드: `packages/core/src/changeset/`(투영·차이·문법·재생·상태), `packages/cli/src/local/changes.ts`
(파일), `packages/cli/src/commands/changes.ts`(`erdd changes`).

---

## 기록 대상 — 스키마 투영

| 대상 | 싣는 것 | 싣지 않는 것 |
|---|---|---|
| 테이블 | 명명 템플릿을 거친 **실제 물리명**, 코멘트, PK | 그룹·배치·커스텀 항목 |
| 컬럼 | 물리명, **유효 논리 타입**(도메인을 거친 값), 도메인의 방언별 타입 중 프로젝트 방언에 있는 것, NULL 허용, 기본값 원문, 자동증가, 코멘트, 허용값, 순서 | 커스텀 항목, 도메인 참조 자체 |
| FK | DDL 과 같은 제약 이름, 자식·부모 컬럼, 카디널리티, 1:1 의 UNIQUE 이름 | 식별/비식별 |
| 인덱스 | 이름, 컬럼과 정렬 방향, UNIQUE | |

- **판정과 이름은 DDL 내보내기와 같은 함수로 만든다** — `exportableTables`(컬럼이 없거나 물리명이 빈
  테이블은 빠진다), `composeTablePhysicalName`, `relationshipConstraintNames`, `commentText`,
  `effectiveAutoIncrement`. ⚠️ 사본 함수를 두면 기록과 내보내기가 **조용히 다른 이름**을 말하고,
  기록을 보고 쓴 마이그레이션이 내보내기 DDL 로 만든 DB 와 어긋난다.
- 도메인·명명 템플릿 변경은 영향받는 컬럼·테이블 각각의 변경으로 펼쳐진다.
- 테이블 옵션(`tableOptions`)은 싣지 않는다(「알려진 한계」).

## 파일 이름과 재생 순서

`erdd/changes/<YYYYMMDDHHmmss>_<슬러그>.erddc` — 앞 14자리는 UTC 시각이고, **파일명 전체의 코드 단위
사전순이 재생 순서다.** 새 기록의 시각은 `max(지금, 마지막 기록 + 1초)` 다.

- ⚠️ 시각을 그냥 「지금」으로 두면, 시계가 앞선 브랜치의 기록이 합쳐진 뒤 새 기록이 그 **앞**에
  재생되어 기준선이 틀린다.
- ⚠️ 정렬에 `localeCompare` 를 쓰면 실행 환경마다 순서가 달라진다. `compareCodeUnits` 만 쓴다.
- `.erddc` 가 아닌 파일은 읽지 않는다. 트리 로더(`readTree`)는 `erdd/changes/` 를 모델로 읽지 않는다.

## 문법

```
// ERDD 변경 기록 — 이 파일을 보고 마이그레이션을 직접 작성한다. 만든 뒤에는 고치지 않는다
changeset '회원 등급 추가' {
  format: 1
  created: '2026-09-23T04:12:00Z'
}

drop foreign key FK_ORD_OLD ORD(OLD_NO) -> OLD(OLD_NO) [1:N]    @<id>
drop index IX_MBR_OLD on MBR (MBR_NM asc)                       @<id>
rename index IX_A -> IX_B on MBR                                @<id>

drop table TMP_LOG [comment: '임시'] {                          @<id>
  column LOG_NO BIGINT [not null, increment]                    @<id>
  primary key (LOG_NO)
  index IX_TMP_LOG_01 (LOG_NO desc)                             @<id>
}

rename table ORD_DTL -> ORD_ITEM                                @<id>

create table MBR_GRD [comment: '회원등급'] {                    @<id>
  column GRD_CD VARCHAR(10) [not null, comment: '등급코드']      @<id>
  column USE_YN CHAR(1) [not null, default: `'Y'`, check: ('Y', 'N')]  @<id>
  primary key (GRD_CD)
}

alter table MBR {                                               @<id>
  drop column OLD_FLAG CHAR(1) [not null, default: `'N'`]       @<id>
  rename column TEL_NO -> MBL_TEL_NO                            @<id>
  add column GRD_CD VARCHAR(10) [null, after: MBR_NM]           @<id>
  modify column MBR_NM {                                        @<id>
    type: VARCHAR(50) -> VARCHAR(100)
    nullable: yes -> no
  }
  primary key: (MBR_NO) -> (MBR_NO, SITE_CD)
  comment: '회원' -> '회원 기본'
}

add index IX_MBR_01 on MBR (MBR_NM asc, GRD_CD desc) [unique]   @<id>
add foreign key FK_MBR_MBR_GRD MBR(GRD_CD) -> MBR_GRD(GRD_CD) [1:1, unique: UQ_MBR_GRD_CD]  @<id>
```

- **머릿말:** `format`(필수), `created`(필수), `baseline: true`(선택 — 이미 DB 에 있는 스키마의 첫
  기록. 재생에는 영향이 없다). `format` 이 이 ERDD 가 아는 것보다 크면 파서가 멈춘다.
- **컬럼 속성**(`[...]`): `null`/`not null`(언제나), `increment`, `default: `원문``, `comment: '…'`,
  `check: ('…', …)`, 방언 타입(`postgresql: TEXT`), `after: X`/`first`(add column 만).
- **modify column 필드:** `type`, `dialects`(`(postgresql: TEXT)`/`none`), `nullable`(`yes`/`no`),
  `default`, `increment`, `comment`, `check`, `position`(`after X`/`first`). 값이 없으면 `none`.
- **표기:** 식별자는 `[A-Za-z_][A-Za-z0-9_$#]*` 면 그대로, 아니면 큰따옴표. 값 자리 키워드와 같은
  `first`·`none` 도 큰따옴표. 타입은 이름 + 괄호 하나까지 그대로, 공백이 있으면(`"INT UNSIGNED"`)
  큰따옴표. 문자열은 작은따옴표, 기본값은 백틱이고 둘 다 `\`·따옴표·줄바꿈만 `\\`·`\'`(`` \` ``)·`\n`
  으로 이스케이프한다. `//` 줄 주석과 빈 줄은 무시한다. CRLF·BOM 을 받는다.
- **변경은 `이전 -> 이후`**, 삭제는 **삭제 직전의 정의 전부**를 싣는다 — 되돌리기 마이그레이션에
  필요한 정보가 기록에 다 있다.
- 인덱스·FK 의 내용 변경은 `drop` + `add` 다. 이름만 바뀐 인덱스는 `rename index`.

## 문장 순서

1. `drop foreign key` 2. `drop index`·`rename index` 3. `drop table` 4. `rename table`
5. `create table` 6. `alter table`(블록 안: `drop column` → `rename column` → `add column` →
   `modify column` → `primary key` → `comment`) 7. `add index` 8. `add foreign key`

같은 순번 안에서는 테이블 물리명 → 컬럼 순서 → 이름의 코드 단위 사전순이다. **위에서 아래로 SQL 로
옮기면 의존성이 맞는다.** 이름은 그 문장 시점의 이름이다(`alter table` 머리는 개명 뒤 이름,
`rename index … on T` 의 `T` 는 개명 전 이름).

- ⚠️ 삭제를 개명·추가 뒤로 옮기면 「지운 컬럼과 같은 이름의 새 컬럼」·「지운 테이블 이름으로 개명」이
  SQL 에서 이름 충돌을 낸다.

## `after` 는 최종 순서의 바로 앞 컬럼이다

`add column … [after: X]` 와 `position: … -> after X` 는 **이 기록이 끝난 뒤의 최종 순서에서 바로 앞
컬럼이 X** 라는 뜻이다. 재생은 `alter table` 블록 끝에서 한 번에 순서를 정한다. 순서 비교는 컬럼
`id` 목록의 최장 공통 부분열로 하므로, 컬럼 하나를 끼우면 `add` 한 줄만 나오고 뒤 컬럼들은 움직이지
않는다.

- ⚠️ 문장 시점 의미로 바꾸면, 아직 옮기지 않은 컬럼 뒤에 붙인 추가가 그 컬럼이 옮겨 간 뒤 엉뚱한
  자리에 남는다 — 재생 결과가 현재와 달라 자기검증이 기록 생성을 막는다.

## 재생은 `@id` 로 대상을 찾는다

줄 끝 `@<id>` 는 모델의 엔티티 id 다. 재생은 고치고 지울 대상을 **이름이 아니라 `@id` 로** 찾는다.
FK·인덱스·PK·`after` 의 참조만 그 시점의 이름으로 푼다.

- ⚠️ 이름으로 찾으면 브랜치 A 의 `X→Y` 개명과 브랜치 B 의 `X` 수정이 합쳐질 때 오류가 나거나,
  같은 이름으로 새로 만든 컬럼에 **조용히 잘못 적용**된다.
- `@id` 는 꼬리표를 싣는 줄에서만 떼어 낸다 — 값 안의 `@` 를 꼬리표로 오인하지 않는다.

## 경합은 경고다

`rename`·`modify`·`primary key`·`comment` 를 재생할 때 `이전` 값이 그 시점 기준선과 다르면 두 기록이
같은 속성을 서로 다른 전제로 바꾼 것이다. **경고하고 `이후` 값으로 계속한다.** 최종 차이는 미기록
변경으로 드러나고, 그것을 새 기록으로 만드는 것이 정리 방법이다. `position` 의 이전 값은 참고용이라
경합 판정에 쓰지 않는다.

## 생성 시 자기검증

새 기록 텍스트를 만든 뒤 쓰기 **전에**, 기존 기록 + 새 기록을 파싱·재생한 결과가 현재 투영과 같은지
확인한다. 다르면 파일을 쓰지 않는다(「내부 오류 — 기록을 재생한 결과가 현재 모델과 달라 …」).

- ⚠️ 이 검사를 빼면 직렬화·파서·재생의 버그가 **영구히 틀린 기준선**으로 저장소에 들어간다 —
  이후 모든 미기록 변경이 거짓이 된다. 왕복 불변식은 `roundtrip.test.ts` 의 속성 테스트가 잠근다.

## 기록을 만들 수 없는 경우

| 경우 | 이유 |
|---|---|
| 기록 파일이 깨졌거나 재생이 실패했다 | 기준선을 모르는 채 차이를 내면 거짓 기록이다 |
| 파일에 `id` 없는 항목이 있다 | `@id` 를 쓸 수 없다 — `erdd serve` 가 채운다 |
| 미저장 편집이 있다 | 파일 어디에도 없는 상태를 가리키는 기록이 생긴다(스냅샷과 같은 규칙) |
| 같은 물리명의 테이블이 둘, 한 테이블에 같은 물리명의 컬럼이 둘 | 재생이 참조를 이름으로 풀기 때문이다. DB 에도 만들 수 없다 |
| 컬럼이 다른 테이블로 옮겨졌다 | 표현할 문장이 없다 — id 를 지워 새 컬럼으로 만든다 |
| 서버에 연결된 프로젝트 | 로컬 모드 전용이다 |
| 미기록 변경이 없다 | 빈 기록을 만들지 않는다 |
| `--baseline` 인데 기록이 이미 있다 | baseline 은 첫 기록만의 표시다 |

## 기록 파일은 고치지 않는다

기록은 기준선의 원천이라 한 글자를 고치면 그 뒤 모든 기준선이 바뀐다. 잘못 만들었고 **아직 공유하지
않았다면 파일을 지우고 다시 만든다** — 지우면 그 변경이 미기록으로 돌아온다. 공유한 기록을 지우면
뒤 기록의 재생이 그 파일·줄에서 멈춘다.

## 알려진 한계

- **테이블 옵션**(`tableOptions`)을 기록하지 않는다.
- **파생 FK 이름**(`name` 이 빈 관계)은 다른 FK 가 늘어 충돌 접미사가 바뀌면 이름 변경(`drop`+`add`)
  으로 기록된다 — 내보내기 DDL 의 이름과 맞추려는 선택이다.
- **두 컬럼(테이블)의 이름 맞바꾸기**는 `rename` 두 줄로 나온다. SQL 에서는 임시 이름을 거쳐야 한다.
- 모델은 그대로이고 기록 파일만 늘어난 `git pull` 은 웹 탭에 이벤트가 없다 — 탭을 다시 열어야 보인다.
- 서버 모드에는 없다.
````

- [ ] **Step 2: SKILL.md 에 절을 추가한다** — `packages/cli/skill/SKILL.md` 의 `## 하지 말 것` **바로 앞**에 삽입(기존 줄은 건드리지 않는다):

```markdown
## 변경 기록 — 마이그레이션을 쓸 때 (로컬 모드)

로컬 모드 프로젝트는 스키마 수정 내역을 `erdd/changes/*.erddc` 에 남긴다. ERDD 는 SQL 을 만들지 않는다 —
**마이그레이션은 이 기록을 보고 이 프로젝트의 도구(Flyway·Liquibase·ORM 등)와 DB 문법으로 직접 쓴다.**

- 스키마(`erdd/tables/*.yaml`·도메인·명명 규칙)를 고쳤으면 `erdd changes` 로 미기록 변경을 보고
  `erdd changes new <이름>` 으로 기록한다. 기록 하나가 마이그레이션 하나다.
- 마이그레이션을 쓸 때는 아직 옮기지 않은 기록 파일을 **위에서 아래로** 옮긴다 — 문장 순서가 이미
  SQL 로 안전한 순서다. 줄 끝 `@…` 꼬리표는 옮기지 않는다. `baseline: true` 인 기록은 이미 DB 에
  있는 것이므로 건너뛴다.
- `after: X` 는 이 기록이 끝난 뒤 최종 순서에서 바로 앞 컬럼이다. 컬럼 순서를 지원하지 않는 DB 면 무시한다.
- 삭제 문장에는 삭제 직전 정의가, 변경에는 `이전 -> 이후` 가 있다 — 되돌리기(down) 마이그레이션도 이것으로 쓴다.
- `rename column A -> B` 와 `rename column B -> A` 가 함께 있으면 맞바꾸기다 — 임시 이름을 거친다.
- **기록 파일을 고치지 않는다.** 잘못 만들었고 아직 공유(push)하지 않았다면 파일을 지우고 다시 만든다.
- `erdd changes --check` 는 미기록 변경이 있으면 종료 코드 `1` 이다(CI 용). 서버 연결 프로젝트에서는
  `erdd changes` 가 종료 코드 `1` 로 멈춘다.
```

- [ ] **Step 3: 로컬 모드 매뉴얼** — `docs/manual/local-guide.md`:

(a) 4.2 표의 `[14. 버전]` 행 오른쪽 칸 끝에 `. 「변경 기록」 탭은 **로컬 모드에만** 있다 → [5.6](#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역)` 을 더한다.

(b) 5.1 의 디렉터리 그림에서 `└─ snapshots/` 줄 **앞**에 `├─ changes/               # 변경 기록 → 5.6` 를 더한다.

(c) `### 5.5 DDL·DBML 로 주고받기` 절이 끝나는 곳(`## 6. 스냅샷` 바로 앞 `---` 앞)에 새 절을 넣는다:

````markdown
### 5.6 변경 기록 — 마이그레이션을 쓰기 위한 수정 내역

**무엇** — 테이블·컬럼·관계·인덱스를 고친 내역을 DB·도구에 묶이지 않는 텍스트로 `erdd/changes/` 에
남긴다. **ERDD 는 SQL 을 만들지 않는다.** 각 프로젝트가 이 기록을 보고 자기 도구(Flyway·Liquibase·
ORM 마이그레이션 등)와 자기 DB 문법으로 마이그레이션을 쓴다. 기록 하나가 마이그레이션 하나다.

**어디서** — 에디터 헤더의 **「버전」 → 「변경 기록」** 탭, 또는 터미널의 `erdd changes`.

**어떻게**

1. 편집하고 **「저장」** 한다(미저장 편집이 있으면 기록을 만들 수 없다).
2. 「변경 기록」 탭 위쪽의 **「미기록 변경」** 에 만들어질 기록이 미리 보인다.
3. 「이름」(예: 「회원 등급 추가」)을 넣고 **「변경 기록 만들기」**. `erdd/changes/<시각>_<이름>.erddc`
   가 생긴다.
4. 기록 파일을 커밋하고, 그 파일을 보고 마이그레이션을 쓴다. 마이그레이션 파일 이름이나 주석에 기록
   파일명을 적어 두면 어디까지 옮겼는지 알기 쉽다.

터미널에서는:

```bash
erdd changes                       # 미기록 변경 미리보기
erdd changes new "회원 등급 추가"   # 기록 만들기
erdd changes --check               # 미기록 변경이 있으면 종료 코드 1 (CI)
```

기록은 이렇게 생겼다 — 위에서 아래로 옮기면 SQL 의존성이 맞는 순서다. 줄 끝 `@…` 는 ERDD 가 대상을
찾는 꼬리표라 옮기지 않는다.

```
alter table MBR {                                               @01a0…
  rename column TEL_NO -> MBL_TEL_NO                            @01a0…
  add column GRD_CD VARCHAR(10) [null, after: MBR_NM]           @01a0…
  modify column MBR_NM {                                        @01a0…
    type: VARCHAR(50) -> VARCHAR(100)
    nullable: yes -> no
  }
}
```

문법 전체와 규칙은 [변경 기록 문법](../guides/changeset-format.md) 에 있다.

**이미 운영 중인 DB 에 도입할 때** — 첫 기록은 스키마 전체의 `create` 가 된다. 터미널에서
`erdd changes new "운영 DB" --baseline` 으로 만들면 「이미 DB 에 있다, 마이그레이션 불필요」 표시
(`baseline: true`)가 붙는다.

**브랜치** — 두 브랜치가 각자 기록을 만들어도 파일명이 달라 git 충돌 없이 합쳐진다. 합친 뒤
`erdd changes` 가 「미기록 변경 없음」이면 정상이다. 두 기록이 같은 컬럼의 같은 속성을 다르게 바꿨으면
「⚠️ 기록 간 경합」 경고가 뜬다 — 각 브랜치의 마이그레이션이 다른 전제로 쓰였다는 뜻이니 확인하고,
남은 차이는 새 기록으로 만든다.

⚠️ **기록 파일을 고치지 않는다.** 잘못 만들었고 아직 공유하지 않았다면 **파일을 지우고 다시 만든다**
— 지우면 그 변경이 미기록으로 돌아온다. 공유한 기록을 지우면 뒤 기록에서 오류가 난다.

**기록을 만들 수 없는 경우** — 미저장 편집이 있을 때, 기록 파일이 깨졌을 때(파일·줄이 표시된다),
같은 물리명의 테이블(또는 한 테이블 안에 같은 물리명의 컬럼)이 둘일 때, 컬럼을 다른 테이블로 옮겼을
때(옮긴 컬럼은 `id` 를 지워 새 컬럼으로 만든다), 기록할 변경이 없을 때.
````

(d) 8절 문제 해결 표에 한 행을 더한다:

```markdown
| `변경 기록은 로컬 모드 전용입니다 …` | 서버에 연결된 프로젝트에서 `erdd changes` 를 돌렸다 | 서버 모드에는 변경 기록이 없다 |
```

- [ ] **Step 4: CLI 매뉴얼** — `docs/manual/cli-guide.md`(추가만):

(a) 도움말 인용(`erdd --help` 출력을 인용한 코드 블록)이 있으면 **실제 출력**으로 다시 뜬다:
`pnpm -C packages/cli exec tsx src/main.ts --help 2>&1` 의 출력을 그대로 붙인다.

(b) `### 6.10 \`erdd import <파일>\`` 절 끝(`## 7. 동기화와 충돌` 바로 앞)에 새 절:

````markdown
### 6.11 `erdd changes`

로컬 모드 전용. 스키마 수정 내역(변경 기록)을 `erdd/changes/` 에 남긴다. 무엇이고 어떻게 쓰는지는
[로컬 모드 매뉴얼 5.6](local-guide.md#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역), 문법은
[변경 기록 문법](../guides/changeset-format.md).

```
erdd changes [--check] [--json]
erdd changes new <이름> [--baseline] [--json]
```

| 형태 | 하는 일 | 종료 코드 |
|---|---|---|
| `erdd changes` | 기록 수·경합 경고·미기록 변경 미리보기 | `0`, 기록이 깨졌으면 `1` |
| `erdd changes --check` | 위와 같고, 미기록 변경이 있으면 실패 | 미기록이 있으면 `1` |
| `erdd changes new <이름>` | 미기록 변경을 `erdd/changes/<시각>_<이름>.erddc` 로 기록 | `0`, 거절이면 `1` |
| `… --baseline` | 첫 기록에 「이미 DB 에 있음」 표시 | 기록이 이미 있으면 `1` |

(여기에 실제 출력 셋을 붙인다 — Step 4 (c))

- 보는 것은 **디스크의 `erdd/`** 다. 미저장 편집은 포함하지 않고, 있으면 `new` 가 거절한다.
- `--json` 은 `{ records, pending, warnings, error, unsaved }`(상태) / `{ ok, file, statementCount }`
  (생성)이다. 거절은 오류 봉투에 `reason`(`name`·`empty`·`baseline`·`invalid`)이 실린다.
- 서버에 연결된 프로젝트에서는 `변경 기록은 로컬 모드 전용입니다 …` 로 멈춘다(`1`).
````

(c) 실제 출력을 뜬다 — 스크래치 디렉터리에서:

`W` 는 워크트리 절대 경로다(`/Users/…/ERDD/.worktrees/feat-changeset-log`). `erdd` 는 설치본이 아니라
워크트리 소스로 부른다:

```bash
W=<워크트리 절대 경로>
erdd() { "$W/packages/cli/node_modules/.bin/tsx" "$W/packages/cli/src/main.ts" "$@"; }
S=$(mktemp -d) && cd "$S" && erdd init --local \
  && mkdir -p erdd/tables && cat > erdd/tables/MBR.yaml <<'YAML'
id: 018f6b0e-0000-7000-8000-000000000001
name: MBR
logicalName: 회원
columns:
  - id: 018f6b0e-0000-7000-8000-000000000002
    name: MBR_NO
    logicalName: 회원번호
    type: BIGINT
    pk: true
    nullable: false
YAML
```

그 디렉터리에서 `erdd changes`, `erdd changes new "초기 스키마"`, (`MBR.yaml` 의 `columns` 에
`- { id: 018f6b0e-0000-7000-8000-000000000003, name: MBR_NM, logicalName: 회원명, type: VARCHAR(100) }` 를
더한 뒤) `erdd changes` 를 차례로 돌려 **출력을 그대로** (b) 의 표 아래에 `$ erdd …` 줄을 앞세운 코드
블록 셋으로 붙인다. 시각이 들어간 파일명도 실제 값 그대로 둔다.

(d) `## 11. 문제 해결` 표에 `docs/manual/local-guide.md` Step 3 (d) 와 같은 행을 더한다.

- [ ] **Step 5: 사용자 매뉴얼** — `docs/manual/user-guide.md` 14절 머리의 로컬 모드 인용 블록 끝에
` 로컬 모드에는 「변경 기록」 탭이 더 있다(→ [로컬 모드 매뉴얼 5.6](./local-guide.md#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역)).` 를 더한다.

- [ ] **Step 6: known-issues 와 CLAUDE.md**

`docs/ops/known-issues.md` 의 「범위 밖으로 미룬 제품 결정」에 해당하는 절(없으면 「기획에 있으나 구현되지 않은 것」 앞에 `## 변경 기록` 절을 새로)에 추가:

```markdown
## 변경 기록 — 미룬 것

- **서버 모드의 변경 기록.** 문법·재생 엔진은 core 에 있어 재사용할 수 있다. 서버에는 기록을 둘
  테이블·프로시저·권한·실시간 전파가 새로 필요하다.
- **테이블 옵션 기록.** `tableOptions`(MySQL ENGINE 등)는 기록에 싣지 않는다.
  ([../guides/changeset-format.md](../guides/changeset-format.md) 「알려진 한계」)
```

`CLAUDE.md` 의 「필수 참조 문서」 목록에서 **`실시간 채널` 항목 바로 앞**에 한 항목을 추가:

```markdown
- **변경 기록(`erdd/changes/`, `packages/core/src/changeset/`)을 건드릴 때 →
  [docs/guides/changeset-format.md](docs/guides/changeset-format.md)**
  (투영이 DDL 과 같은 함수를 쓰는 이유, 문장 순서, `after` 의 뜻, `@id` 재생, 생성 시 자기검증)
```

- [ ] **Step 7: 링크를 확인한다**

Run: `grep -n "56-변경-기록--마이그레이션을-쓰기-위한-수정-내역" docs/manual/*.md; grep -n "^### 5.6" docs/manual/local-guide.md`
Expected: 앵커를 가리키는 줄들과 제목 한 줄. 제목이 `### 5.6 변경 기록 — 마이그레이션을 쓰기 위한 수정 내역` 이면 GitHub 앵커는 `#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역` 이다(마침표·`—` 가 빠지고 공백이 `-`).

- [ ] **Step 8: 커밋**

```bash
git add docs/guides/changeset-format.md packages/cli/skill/SKILL.md docs/manual/local-guide.md docs/manual/cli-guide.md docs/manual/user-guide.md docs/ops/known-issues.md CLAUDE.md && git commit -m "docs: 변경 기록 문법 정본과 매뉴얼·스킬 반영

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- docs/guides/changeset-format.md packages/cli/skill/SKILL.md docs/manual/local-guide.md docs/manual/cli-guide.md docs/manual/user-guide.md docs/ops/known-issues.md CLAUDE.md
```

---

### Task 12: 전체 체크포인트·최종 리뷰·스모크

- [ ] **Step 1: 전체 스위트** (워크트리 루트, `.env` 를 로드하지 않는다)

Run: `pnpm -r typecheck; echo "exit=$?"` → `exit=0`
Run: `pnpm -C packages/core test && pnpm -C packages/cli test && pnpm -C apps/web test; echo "exit=$?"` → `exit=0`

- [ ] **Step 2: 최종 whole-branch 리뷰** — 리뷰어를 띄운다(`docs/guides/worktree-workflow.md` 「최종 리뷰는 태스크별 리뷰가 전부 clean 이어도 반드시 한다」). 프롬프트에 반드시 넣는다:
  > 「이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의
  > 불변식을 재유도하라.」 (대상: `exportableTables`·`relationshipConstraintNames`·`effectiveAutoIncrement`
  > ← `generateDdl`/`projectSchema`, `resolveColumn` ← `ddl.ts`/`projection.ts`)

  그리고 spec 의 4.5 오류 표와 guide 「기록을 만들 수 없는 경우」 표가 코드의 거절 경로와 한 줄씩 대응하는지 대조하게 한다.

- [ ] **Step 3: 스모크(실 앱)** — `docs/guides/setup.md` 「브라우저 스모크 준비」를 따른다. 스크래치 디렉터리에 `erdd init --local` → `erdd serve --no-open --port <빈 포트>` → 브라우저로 열어:
  1. 테이블 하나(컬럼 둘)를 만들고 저장 → 「버전」 → 「변경 기록」 탭에 미리보기가 보인다.
  2. 이름을 넣고 「변경 기록 만들기」 → 토스트와 목록 항목, `erdd/changes/` 에 파일.
  3. 컬럼을 중간에 하나 끼우고 저장 → 미리보기에 `add column … [after: …]` 한 줄.
  4. 편집만 하고 저장하지 않은 상태 → 안내 문구와 잠긴 버튼.
  5. 터미널에서 `erdd changes --check` → 미기록이 있으면 `1`, 기록 뒤 `0`.
  6. git 브랜치 둘에서 각각 다른 컬럼을 고쳐 기록하고 합친 뒤 `erdd changes` → 「미기록 변경 없음」.

- [ ] **Step 4: 계획서 정리** — main 병합 후 이 계획서(`docs/superpowers/plans/2026-09-23-changeset-log.md`)를 지운다(`CLAUDE.md` 「문서를 새로 만들 때」).
