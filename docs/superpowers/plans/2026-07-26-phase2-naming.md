# Phase 2 — 명명 체계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단어–용어–도메인 3단 체계로 논리명↔물리명 일관 관리: 물리명 자동생성, 미등록/불일치/길이/예약어/중복 경고.

**Architecture:** 단어/용어를 도메인에 이은 op 엔티티로 추가. 물리명 자동생성·경고는 core 순수 함수. 경고는 **기존 `computeWarnings`(warnings.ts)를 확장**해 기존 배지/패널 표면 재사용. 명명 규칙은 프로젝트 설정(버전 아님). 새 의존성 없음.

**설계:** docs/superpowers/specs/2026-07-26-phase2-naming-design.md

## Global Constraints

- core IO·의존성 free. 새 의존성 금지.
- 새 엔티티 `word`,`term` 6곳 일관 등록(core 4 + integrity + server TABLE_BY_KIND). **ENTITY_KINDS에서 term은 domain 뒤**(term.domainId→domain FK 순서): `['tableGroup','domain','word','term','table','column','relationship','index','note']`.
- `term.domainId` integrity 참조 검사. 단어/용어 자체 삭제는 참조 가드 없음(컬럼이 id 미참조).
- ProjectModelSchema words/terms `.default({})`(하위호환). 명명 규칙 `projects.namingRules` jsonb(버전 아님, 마이그 0005).
- 기존 `computeWarnings(model)` 호출부 하위호환: 시그니처를 `computeWarnings(model, rules?, dialects?)`로 확장하되 인자 없으면 기존 동작(명명 경고 없음).
- 커밋 명시 파일만. UI 카피 한국어. producer 진입 전 이벤트 값 즉시 캡처.
- 테스트: core/web `pnpm --filter @erdd/core|@erdd/web exec vitest run <path>`; server `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run`; 전체 `pnpm -r typecheck`.

## 확인된 기존 인터페이스

- op 엔진 `op.ts`(ENTITY_KINDS 등 4곳), `diff.ts`(ENTITY_KINDS 순회), `integrity.ts`(union+collections), `applyOps` spread.
- `warnings.ts`: `Warning = { kind, scope:'column'|'relationship', entityId, tableId?, message }`, `computeWarnings(model): Warning[]`. 호출부: `canvas.tsx:47`, `edit-panel.tsx:47`, `relationship-panel.tsx:17`. `buildNodes(model, viewMode, selectedId, warnings)`(nodes.ts)가 scope/entityId로 tableWarnings/columnWarnings 분배 → `WarningBadge`.
- `identifier.ts`: 방언별 예약어 세트(내부 RESERVED), `quoteIdentifier`. → `isReservedWord(name, dialect)` export 추가.
- `projects` 테이블 `dialects jsonb`. `routers/project.ts` `project.get`/`project.update`. model-store `TABLE_BY_KIND`/`loadProjectModel`.
- edit-panel 논리/물리명 `CommitInput`(onCommit→mutate). 도메인 관리 `domain-panel.tsx`/`domain-edits.ts`, 컬럼 도메인 `setColumnDomain`(column-edits.ts). store `select(tableId)`(컬럼 단독 select 없음 → 컬럼은 소속 테이블 select).
- 마이그 생성 `pnpm --filter @erdd/server exec drizzle-kit generate`.

---

## Task 1: core 단어/용어 op 엔티티

**Files:** `packages/core/src/model.ts`, `op.ts`, `integrity.ts`, `index.ts` (+ typecheck-driven: fixtures/model-store column 매핑은 이미 domainId 처리됨 — words/terms는 신규 컬렉션이라 `.default({})`로 기존 리터럴 영향 없음).

**Interfaces produced:** `Word`,`WordSchema`,`Term`,`TermSchema`, `ProjectModel.words/terms`.

- [ ] **Step 1: 실패 테스트** `op.test.ts`
```ts
it('word/term 엔티티를 왕복하고, term은 존재하는 도메인만 참조한다', () => {
  const m = createEmptyModel()
  const w = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null }
  const created = applyOps(m, [{ action: 'create', entity: 'word', entityId: 'w1', data: w }])
  expect(created.words['w1']!.abbreviation).toBe('MBR')
  // term with missing domain → 무결성 위반
  expect(() => applyOps(created, [{ action: 'create', entity: 'term', entityId: 't1', data: {
    id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: 'nope', description: null } }])).toThrow()
  // term with null domain OK
  const wt = applyOps(created, [{ action: 'create', entity: 'term', entityId: 't1', data: {
    id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: null, description: null } }])
  expect(wt.terms['t1']!.physicalName).toBe('MBR_NO')
})
it('words/terms 생략된 옛 모델도 파싱된다(.default)', () => {
  // applyOps 초기 spread가 model.words 없이도 동작하는지 — createEmptyModel엔 있으나 옛 스냅샷 방어
  const legacy = { ...createEmptyModel() } as Record<string, unknown>
  delete legacy.words; delete legacy.terms
  const out = applyOps(legacy as ReturnType<typeof createEmptyModel>, [])
  expect(out.words).toEqual({}); expect(out.terms).toEqual({})
})
```

- [ ] **Step 2: 실패 확인** `pnpm --filter @erdd/core exec vitest run src/op.test.ts` → FAIL.

- [ ] **Step 3: `model.ts`** — WordSchema/TermSchema(설계 문서 그대로), `ProjectModelSchema`에 `words: z.record(z.string(), WordSchema).default({})`, `terms: z.record(z.string(), TermSchema).default({})`, `createEmptyModel`에 `words:{}, terms:{}`.
  - **주의:** `applyOps`(op.ts) 초기 next 객체에 `words: { ...model.words }, terms: { ...model.terms }` 추가 시 옛 모델(words 없음) 방어를 위해 `{ ...(model.words ?? {}) }` 사용.

- [ ] **Step 4: `op.ts`** — `ENTITY_KINDS = ['tableGroup','domain','word','term','table','column','relationship','index','note']`. SCHEMAS에 word/term, COLLECTION `word:'words', term:'terms'`, applyOps spread(위 주의). import Word/TermSchema.

- [ ] **Step 5: `integrity.ts`** — union에 `'word'|'term'`, collections에 words/terms, `term.domainId` 참조 검사(null skip).

- [ ] **Step 6: `index.ts`** — WordSchema/Word/TermSchema/Term export.

- [ ] **Step 7: 통과 + 전 스위트/타입(typecheck-driven 보완)** — `pnpm --filter @erdd/core exec vitest run` 통과 후 `pnpm -r typecheck`.
  - **주의:** `words/terms`에 `.default({})`를 줘도 `z.infer`(출력 타입)은 words/terms를 **필수**로 포함한다 → `: ProjectModel`로 타입된 리터럴/반환은 전부 words/terms가 있어야 한다. tsc가 지목하는 모든 지점에 `words: {}, terms: {}` 추가: core `testing/fixtures.ts`(buildSampleModel 등), server `model-store.ts` `loadProjectModel` 반환(임시 — Task 4서 실로드로 교체), 기타 ProjectModel 리터럴. `pnpm -r typecheck` 클린까지 반복. (`createEmptyModel()` 기반 구성은 이미 words/terms 포함되어 무영향.)

- [ ] **Step 8: Commit** `git add packages/core/src/model.ts packages/core/src/op.ts packages/core/src/integrity.ts packages/core/src/index.ts packages/core/src/op.test.ts [+ 임시 수정 파일]` → `feat(core): 단어/용어 op 엔티티(term→domain FK 순서·하위호환 default)`

---

## Task 2: core 물리명 자동생성 (`naming.ts`)

**Files:** Create `packages/core/src/naming.ts` + `naming.test.ts`. Modify `index.ts`.

- [ ] **Step 1: 실패 테스트** `naming.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { generatePhysicalName, DEFAULT_NAMING_RULES } from './naming.js'
const words = {
  w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', description:null },
  w2: { id:'w2', logicalName:'상태', abbreviation:'STAT', description:null },
  w3: { id:'w3', logicalName:'코드', abbreviation:'CD', description:null },
}
describe('generatePhysicalName', () => {
  it('용어 완전일치 우선', () => {
    const terms = { t1: { id:'t1', logicalName:'회원상태코드', physicalName:'MBR_ST_CD', domainId:'d1', description:null } }
    const r = generatePhysicalName('회원상태코드', words, terms, DEFAULT_NAMING_RULES)
    expect(r.physicalName).toBe('MBR_ST_CD'); expect(r.termId).toBe('t1'); expect(r.domainId).toBe('d1'); expect(r.unknownWords).toEqual([])
  })
  it('최장일치 분해조합', () => {
    const r = generatePhysicalName('회원상태코드', words, {}, DEFAULT_NAMING_RULES)
    expect(r.physicalName).toBe('MBR_STAT_CD'); expect(r.unknownWords).toEqual([])
  })
  it('미등록 단어는 unknownWords로', () => {
    const r = generatePhysicalName('회원쿠폰', words, {}, DEFAULT_NAMING_RULES)
    expect(r.unknownWords).toContain('쿠폰')
  })
  it('lower_snake·구분자 없음', () => {
    expect(generatePhysicalName('회원상태', words, {}, { case:'lower_snake', separator:'_', maxLengthBytes:30 }).physicalName).toBe('mbr_stat')
    expect(generatePhysicalName('회원상태', words, {}, { case:'UPPER_SNAKE', separator:'', maxLengthBytes:30 }).physicalName).toBe('MBRSTAT')
  })
})
```

- [ ] **Step 2: 실패 확인** → FAIL(모듈 없음).

- [ ] **Step 3: 구현** `naming.ts`
```ts
import type { Word, Term } from './model.js'

export type NamingRules = { case: 'UPPER_SNAKE' | 'lower_snake'; separator: '_' | ''; maxLengthBytes: number }
export const DEFAULT_NAMING_RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }
export type GenResult = { physicalName: string; unknownWords: string[]; termId?: string; domainId?: string | null }

export function generatePhysicalName(
  logicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): GenResult {
  const name = logicalName.trim()
  // 1) 용어 완전일치
  const term = Object.values(terms).find((t) => t.logicalName.trim() === name)
  if (term) return { physicalName: term.physicalName, unknownWords: [], termId: term.id, domainId: term.domainId }
  // 2) 최장일치 분해조합
  const byLen = Object.values(words).slice().sort((a, b) => b.logicalName.length - a.logicalName.length)
  const parts: string[] = []
  const unknownWords: string[] = []
  let i = 0
  let pending = ''
  while (i < name.length) {
    const match = byLen.find((w) => w.logicalName.length > 0 && name.startsWith(w.logicalName, i))
    if (match) {
      if (pending) { unknownWords.push(pending); pending = '' }
      parts.push(match.abbreviation)
      i += match.logicalName.length
    } else {
      pending += name[i]!; i += 1
    }
  }
  if (pending) unknownWords.push(pending)
  const joined = parts.join(rules.separator)
  const physicalName = rules.case === 'lower_snake' ? joined.toLowerCase() : joined.toUpperCase()
  return { physicalName, unknownWords }
}
```

- [ ] **Step 4: 통과 확인** → PASS.
- [ ] **Step 5: export** `index.ts`에 `generatePhysicalName`,`DEFAULT_NAMING_RULES`,`type NamingRules`,`type GenResult`.
- [ ] **Step 6: typecheck + Commit** `feat(core): 물리명 자동생성(용어일치·최장일치 분해·케이스/구분자)`

---

## Task 3: core 명명 경고 확장 (`warnings.ts` + `identifier.ts`)

**Files:** `packages/core/src/identifier.ts`(isReservedWord export), `warnings.ts`(+naming), `warnings.test.ts`, `index.ts`.

- [ ] **Step 1: `identifier.ts`에 `isReservedWord` 추가·export**
```ts
export function isReservedWord(name: string, dialect: Dialect): boolean {
  return RESERVED[dialect].has(name.toLowerCase())
}
```
(quoteIdentifier와 같은 RESERVED 재사용. index.ts export.)

- [ ] **Step 2: 실패 테스트** `warnings.test.ts` — 명명 경고 케이스
```ts
import { generatePhysicalName } from './naming.js' // 참고
it('명명 경고: 미등록 단어·용어불일치·길이초과·예약어·테이블물리명중복', () => {
  const m = createEmptyModel()
  // 테이블 ORDER(예약어) + 물리명 30바이트 초과 컬럼 + 미등록 단어 논리명 등 구성(기존 fixtures 스타일)
  // words/terms 세팅
  const rules = { case:'UPPER_SNAKE', separator:'_', maxLengthBytes: 5 } as const
  const ws = computeWarnings(m, rules, ['postgresql'])
  const kinds = new Set(ws.map((w) => w.kind))
  expect(kinds.has('reserved')).toBe(true)
  expect(kinds.has('too-long')).toBe(true)
  // rules/dialects 없이 호출하면 명명 경고 없음(기존 동작)
  expect(computeWarnings(m).every((w) => !['reserved','too-long','unknown-word','term-mismatch'].includes(w.kind))).toBe(true)
})
```
(구체 모델은 기존 `warnings.test.ts` 스타일로 구성.)

- [ ] **Step 3: 실패 확인** → FAIL.

- [ ] **Step 4: `warnings.ts` 확장**
- `Warning.kind` 유니언에 `'unknown-word'|'term-mismatch'|'too-long'|'reserved'|'duplicate-physical-table'` 추가. `scope`에 `'table'` 추가. 선택적 `severity?: 'warning'|'error'` 추가(기본 warning; duplicate는 error).
- `computeWarnings(model, rules?, dialects?)`로 시그니처 확장. 기존 로직 유지. `rules`가 있으면 아래 명명 경고 추가:
  - 테이블·컬럼(논리명 non-empty)마다 `generatePhysicalName(logicalName, model.words, model.terms, rules)`의 `unknownWords` 있으면 `unknown-word`(scope table/column).
  - `terms`에 논리명 일치 Term이 있는데 물리명이 다르면 `term-mismatch`.
  - `new TextEncoder().encode(physicalName).length > rules.maxLengthBytes`면 `too-long`.
  - `dialects?.some(d => isReservedWord(physicalName, d))`면 `reserved`.
  - 테이블 물리명 테이블 간 중복 → `duplicate-physical-table`(scope table, severity error). (컬럼-내-테이블 중복은 기존 로직 유지.)
- import: `generatePhysicalName`(naming.js), `isReservedWord`,`type Dialect`(dialect.js/identifier.js).

- [ ] **Step 5: 통과 확인 + 기존 호출부 회귀** `pnpm --filter @erdd/core exec vitest run` (기존 warnings 테스트 불변) / `pnpm --filter @erdd/web typecheck`(computeWarnings 시그니처 확장이 기존 호출부 `computeWarnings(model)`와 호환 — 인자 optional).

- [ ] **Step 6: Commit** `feat(core): computeWarnings에 명명 경고 확장(미등록/불일치/길이/예약어/테이블중복)`

---

## Task 4: server 스키마 + 마이그레이션 0005 + 명명 규칙 API

**Files:** `apps/server/src/db/schema.ts`, `drizzle/0005_*.sql`, `services/model-store.ts`, `routers/project.ts`, project 라우터 테스트.

- [ ] **Step 1: `schema.ts`**
```ts
export const modelWords = pgTable('model_words', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  description: text('description'),
})
export const modelTerms = pgTable('model_terms', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  domainId: uuid('domain_id').references(() => modelDomains.id),
  description: text('description'),
})
```
`projects`에 `namingRules: jsonb('naming_rules').$type<NamingRules>().notNull().default({ case:'UPPER_SNAKE', separator:'_', maxLengthBytes:30 })` 추가. (`NamingRules`는 `@erdd/core` import.)

- [ ] **Step 2: 마이그 0005 생성** `pnpm --filter @erdd/server exec drizzle-kit generate` → `0005_*.sql`(model_words, model_terms, projects.naming_rules) 확인.

- [ ] **Step 3: dev·test migrate**
```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd' pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec drizzle-kit migrate
```

- [ ] **Step 4: `model-store.ts`** — `TABLE_BY_KIND`에 `word: modelWords, term: modelTerms`. `loadProjectModel`에 words/terms 로드+매핑(Task 1의 임시 `words:{},terms:{}`를 실로드로 교체). import Word/Term/modelWords/modelTerms.

- [ ] **Step 5: `routers/project.ts`** — `project.get` 반환에 `namingRules`(행 값, null이면 DEFAULT_NAMING_RULES 보충). `project.update` input에 `namingRules: z.object({...}).optional()` 추가, set에 반영.

- [ ] **Step 6: 서버 테스트(erdd_test)** — word/term 왕복+term.domainId FK, namingRules 저장·기본값, **단일 배치(domain+term+참조컬럼) FK 안전**(스냅샷 복원 회귀 가드, sub-project #1 패턴).
Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run` / `pnpm --filter @erdd/server typecheck`.

- [ ] **Step 7: Commit** `git add apps/server/src/db/schema.ts apps/server/src/services/model-store.ts apps/server/src/routers/project.ts apps/server/drizzle/0005_*.sql apps/server/drizzle/meta [+테스트]` → `feat(server): model_words/model_terms·명명규칙·마이그0005·model-store`

---

## Task 5: web 사전 관리 (`dict-edits.ts` + `dict-panel.tsx`)

**Files:** Create `apps/web/src/editor/dict-edits.ts`+test, `dict-panel.tsx`(+선택 test). Modify `apps/web/src/pages/project.tsx`(헤더 "사전" 진입).

- [ ] **Step 1: 실패 테스트** `dict-edits.test.ts` — producer 헬퍼
```ts
// createWord/updateWord/removeWord, createTerm/updateTerm/removeTerm, wordUsage/termUsage, unregisteredWords
```
(도메인 domain-edits 패턴. wordUsage/termUsage = 논리명이 그 단어/용어를 포함/일치하는 테이블·컬럼 역참조. unregisteredWords = 모델 전체 논리명의 generatePhysicalName unknownWords 집계 dedupe.)

- [ ] **Step 2: 실패 확인** → FAIL.

- [ ] **Step 3: `dict-edits.ts`** — producer 헬퍼(도메인 패턴):
```ts
export function createWord(model, word) { return { ...model, words: { ...model.words, [word.id]: word } } }
export function updateWord(model, id, patch) { /* ... */ }
export function removeWord(model, id) { const n={...model.words}; delete n[id]; return {...model, words:n} } // 가드 없음
// term 동형. wordUsage(model, wordId): 논리명 분해에 그 단어가 쓰인 table/column. termUsage(model, termId): 논리명이 term.logicalName과 일치하는 table/column.
// unregisteredWords(model, rules): 전 논리명 generatePhysicalName().unknownWords 합집합.
```

- [ ] **Step 4: 통과 확인** → PASS.

- [ ] **Step 5: `dict-panel.tsx`** — 단어·용어 탭 목록·CRUD(편집 다이얼로그), 사용처, 미등록 단어 모아보기(일괄 등록: 후보를 단어로 createWord). 도메인 관리(`domain-panel.tsx`) 미러. `project.tsx` 헤더에 "사전" 버튼(도메인 버튼 옆). 이벤트 값 즉시 캡처. namingRules는 project 데이터에서(Task 6에서 store 로드 — 이번엔 미등록 모아보기에 필요하면 DEFAULT_NAMING_RULES 폴백, 또는 Task 6 이후 실규칙).

- [ ] **Step 6: web 스위트 + typecheck + Commit** `feat(web): 단어/용어 사전 관리 화면(CRUD·사용처·미등록 모아보기)`

---

## Task 6: web 자동생성 통합 + 클라 명명 데이터 로드 (`edit-panel.tsx`, store, project.tsx)

**Files:** `apps/web/src/editor/store.ts`(namingRules/dialects 필드), `apps/web/src/pages/project.tsx`(project.get로 로드→store), `edit-panel.tsx`(자동생성).

- [ ] **Step 1: store에 명명 데이터** — `store.ts`에 `namingRules: NamingRules`(기본 DEFAULT_NAMING_RULES), `dialects: Dialect[]`([]) + setter(예: `setProjectConfig(rules, dialects)`), `setLoaded`/reset에 포함. project.tsx가 `project.get` 결과로 `setProjectConfig` 호출(로드 시).

- [ ] **Step 2: 실패 테스트** `edit-panel.test.tsx` — 논리명 commit 시 빈 물리명 자동채움, 비어있지 않으면 불변.

- [ ] **Step 3: 자동생성 배선** `edit-panel.tsx`
- 테이블/컬럼 논리명 `CommitInput` onCommit: 값 즉시 캡처 → producer에서 `updateTable/updateColumn(logicalName)` + 물리명이 현재 비어 있으면 `generatePhysicalName(logical, m.words, m.terms, rules)`로 physicalName도 설정(같은 producer). 컬럼이고 용어일치 domainId 제안 시 도메인 미지정이면 함께 setColumnDomain.
- "물리명 재생성" 버튼(현 논리명으로 재생성·덮어씀). "용어로 등록"(createTerm from 논리↔물리↔(컬럼)domainId). 미등록 단어 인라인 "단어 등록"(createWord, abbreviation 입력).
- rules는 store에서. 이벤트 값 즉시 캡처.

- [ ] **Step 4: 통과 + web 스위트 + typecheck + Commit** `feat(web): 논리명→물리명 자동생성 통합(용어 등록·단어 등록·재생성)`

---

## Task 7: web 명명 경고 노출 + 명명 검사 화면

**Files:** `apps/web/src/editor/canvas.tsx`·`edit-panel.tsx`(computeWarnings에 rules/dialects 전달), `naming-check.tsx`(+test), `project.tsx`(진입).

- [ ] **Step 1: 경고 배선** — `canvas.tsx:47`·`edit-panel.tsx:47`의 `computeWarnings(model)`를 `computeWarnings(model, namingRules, dialects)`(store에서)로 변경. 기존 배지/패널이 명명 경고(unknown-word/term-mismatch/too-long/reserved/duplicate-table)를 자동 렌더. `nodes.ts` buildNodes가 scope 'table' 경고도 테이블 배지에 포함하도록 `w.scope==='table' && w.entityId===table.id` 분배 추가(현재 column/relationship만 분배할 수 있음 — 확인·보강).

- [ ] **Step 2: 실패 테스트** `naming-check.test.tsx` — 경고 목록 렌더, 항목 클릭 시 `select(tableId)` 호출.

- [ ] **Step 3: `naming-check.tsx`** — 헤더 진입(또는 사전 화면 탭). `computeWarnings(model, namingRules, dialects)` 전체를 kind/severity별 그룹 목록. 각 항목 클릭 → 컬럼이면 소속 테이블 `select`, 테이블이면 `select`. 미등록 단어 항목은 인라인 단어 등록 유도. `project.tsx` 헤더 진입 버튼.

- [ ] **Step 4: 통과 + 전체 web 스위트 + typecheck + Commit** `feat(web): 명명 경고 배지 배선·명명 검사 화면`

---

## 완료 후

- 전체 스위트: core / web / server(erdd_test) / `pnpm -r typecheck` 그린.
- 컨트롤러 브라우저 스모크: 단어 등록 → 컬럼 논리명 입력 시 물리명 자동생성 → 미등록 단어 경고 배지 → 용어 등록 → 명명 검사 화면 → 명명 규칙 변경(길이/케이스) 반영.
- fable 전체 브랜치 리뷰(merge-base..HEAD) → main 머지.

## Self-Review 메모

- ENTITY_KINDS: term은 domain 뒤(FK 순서), word는 domain 뒤/table 앞. 스냅샷 복원 단일 배치 FK 안전.
- 새 컬렉션 words/terms는 `.default({})` + applyOps spread `?? {}`로 옛 모델 방어. 스냅샷 복원은 이미 `{...createEmptyModel(),...snap.model}` 정규화(sub-project #1).
- `computeWarnings(model, rules?, dialects?)` 하위호환(기존 3 호출부 무인자 유지, 명명 경고는 rules 전달 시만).
- 명명 규칙·dialects는 프로젝트 설정 → 클라 store 로드(Task 6 Step 1)가 자동생성(Task 6)·경고 배선(Task 7)의 공통 전제.
- 단어/용어 삭제는 참조 가드 없음(컬럼이 id 미참조, 물리명 문자열만 생성).
