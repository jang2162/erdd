# Phase 2 — 도메인과 타입 표준화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방언 중립 도메인으로 컬럼 타입을 표준화하고, 도메인 수정이 사용 컬럼 전체에 라이브 반영되게 한다.

**Architecture:** 도메인을 7번째 op 엔티티로 추가(op 엔진·diff·integrity·model-store가 `ENTITY_KINDS` 기반이라 규칙적 확장). 컬럼은 `domainId`만 저장하고 타입은 도메인에서 라이브 해석. 새 런타임 의존성 없음.

**Tech Stack:** TypeScript, zod, Drizzle/PostgreSQL, React 19, vitest.

**설계:** docs/superpowers/specs/2026-07-25-phase2-domain-design.md

## Global Constraints

- `packages/core`는 IO·런타임 의존성 free. 새 의존성 금지.
- 새 엔티티 `domain`은 여섯 곳에 일관 등록: core `ENTITY_KINDS`·`ENTITY_SCHEMAS`·`COLLECTION_BY_KIND`·`applyOps` 초기 spread, core `integrity.ts`(union+collections), server `TABLE_BY_KIND`.
- 컬럼 `domainId`는 존재하는 도메인을 가리켜야 함(integrity). 도메인 삭제는 사용 컬럼 0개일 때만.
- `ColumnSchema.domainId = z.string().nullable().default(null)` — 옛 스냅샷/리비전(도메인 이전) 하위호환.
- `generateDdl(model, dialect, scope): string` 시그니처 불변. 라이브 해석: `domainId != null`이면 컬럼 `type`을 DDL·표시에서 읽지 않음.
- 마이그레이션 append-only(0004 신규). dev(erdd)·test(erdd_test) 모두 migrate.
- 커밋은 명시 파일만 스테이징. UI 카피 한국어. producer 진입 전 이벤트 값 즉시 캡처.
- 테스트: `pnpm --filter @erdd/core|@erdd/web exec vitest run <path>`, 서버는 `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run`, 전체 `pnpm -r typecheck`.

## 확인된 기존 인터페이스

- op 엔진(`op.ts`): `ENTITY_KINDS`, `ENTITY_SCHEMAS`, `COLLECTION_BY_KIND`, `applyOps` 초기 next spread. `diff.ts`는 `ENTITY_KINDS` 순회(자동 포함). `integrity.ts`는 자체 union + `collections` 배열.
- `resolveColumnType(rawType, dialect): { sql; warning? }`, `toDialectType`, `parseLogicalType`(core `dialect.ts`/`logical-type.ts`).
- `ddl.ts` `columnLine(col, dialect)` → `resolveColumnType(col.type, dialect).sql`; 정수판정 `isIntegerType(col.type)`; `esc()`; `quoteIdentifier`.
- server `model-store.ts`: `TABLE_BY_KIND`, `loadProjectModel`(엔티티별 매핑), `persistOps`(`{...op.data, projectId}` insert).
- web 컬럼 편집: `edit-panel.tsx` + `column-edits.ts`(producer 헬퍼). 뮤테이션 `useModelMutation`.
- 마이그레이션 생성: `pnpm --filter @erdd/server exec drizzle-kit generate`(drizzle.config.ts).

---

## Task 1: core 도메인 엔티티 + domainId 필드(플러밍, 동작 없음)

**목표:** 도메인 엔티티와 컬럼 `domainId`를 스키마/op/integrity에 추가하고, 전 패키지 구성 지점을 `domainId: null`로 보완해 스위트를 그린으로 유지한다. 아직 UI·해석·DDL 동작은 없다.

**Files:**
- Modify: `packages/core/src/model.ts`, `packages/core/src/op.ts`, `packages/core/src/integrity.ts`, `packages/core/src/index.ts`
- Modify (typecheck-driven): core 픽스처/테스트의 Column 구성 지점(`packages/core/src/testing/fixtures.ts`, `packages/core/src/ddl.test.ts`, 기타 tsc가 지목하는 곳), `apps/web/src/editor/column-edits.ts` 및 web의 Column 리터럴, `apps/server/src/services/model-store.ts`(column 매핑에 `domainId: null` 임시)
- Test: `packages/core/src/op.test.ts`, `packages/core/src/integrity.test.ts`(있으면), 신규 케이스

**Interfaces produced:** `Domain`, `DomainSchema`, `ProjectModel.domains`, `Column.domainId`.

- [ ] **Step 1: 실패 테스트** — `packages/core/src/op.test.ts`에 도메인 왕복 케이스 추가

```ts
it('domain 엔티티를 create/update/delete로 왕복한다', () => {
  const m = createEmptyModel()
  const d = { id: 'd1', name: '금액', category: '숫자', logicalType: 'DECIMAL(15)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null }
  const created = applyOps(m, [{ action: 'create', entity: 'domain', entityId: 'd1', data: d }])
  expect(created.domains['d1']!.name).toBe('금액')
  const updated = applyOps(created, [{ action: 'update', entity: 'domain', entityId: 'd1',
    changes: { name: { from: '금액', to: '통화금액' } } }])
  expect(updated.domains['d1']!.name).toBe('통화금액')
  const deleted = applyOps(updated, [{ action: 'delete', entity: 'domain', entityId: 'd1', before: d }])
  expect(deleted.domains['d1']).toBeUndefined()
})

it('컬럼이 존재하지 않는 도메인을 가리키면 무결성 위반', () => {
  const m = createEmptyModel()
  m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
  expect(() => applyOps(m, [{ action: 'create', entity: 'column', entityId: 'c', data: {
    id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
    domainId: 'missing' } }])).toThrow()
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core exec vitest run src/op.test.ts` → FAIL(`domain` 미등록/무결성 미검사).

- [ ] **Step 3: `model.ts`**

`ColumnSchema`에 필드 추가(기존 필드 뒤):
```ts
  domainId: z.string().nullable().default(null),
```
DomainSchema + ProjectModel + createEmptyModel:
```ts
export const DomainSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  logicalType: z.string(),
  dialectTypes: z.strictObject({
    postgresql: z.string().nullable(),
    mysql: z.string().nullable(),
    oracle: z.string().nullable(),
    mssql: z.string().nullable(),
  }),
  defaultValue: z.string().nullable(),
  allowedValues: z.array(z.string()),
  description: z.string().nullable(),
})
export type Domain = z.infer<typeof DomainSchema>
```
`ProjectModelSchema`에 `domains: z.record(z.string(), DomainSchema),` 추가. `createEmptyModel`에 `domains: {},` 추가.

- [ ] **Step 4: `op.ts`** — `'domain'` 등록

```ts
export const ENTITY_KINDS = ['tableGroup', 'table', 'column', 'relationship', 'index', 'note', 'domain'] as const
```
`ENTITY_SCHEMAS`에 `domain: DomainSchema`, `COLLECTION_BY_KIND`에 `domain: 'domains'`, `applyOps` 초기 next에 `domains: { ...model.domains },`. import에 `DomainSchema` 추가.

> 순서 주의: `ENTITY_KINDS`에서 `domain`을 마지막에 두면 create는 마지막, delete는 처음(역순)에 처리된다. 컬럼이 도메인을 참조하므로 삭제 시 컬럼 먼저, 도메인 나중이 자연스러우나, 도메인 삭제는 사용 컬럼 0개일 때만이라 순서 무관. 마지막 배치로 둔다.

- [ ] **Step 5: `integrity.ts`**

`IntegrityIssue['entity']` 유니언에 `| 'domain'` 추가. `collections` 배열에 `{ entity: 'domain', record: model.domains },` 추가. 컬럼 domainId 참조 검사 추가(기존 table.groupId 검사 근처 패턴):
```ts
for (const column of Object.values(model.columns)) {
  if (column.domainId !== null && !Object.hasOwn(model.domains, column.domainId)) {
    issues.push({ entity: 'column', entityId: column.id,
      message: `존재하지 않는 도메인 참조: ${column.domainId}` })
  }
}
```

- [ ] **Step 6: `index.ts`** — export 추가

```ts
export { DomainSchema, type Domain } from './model.js' // 기존 model export 라인에 병합
```

- [ ] **Step 7: 통과 확인 + 전 패키지 구성 지점 보완**

Run: `pnpm --filter @erdd/core exec vitest run src/op.test.ts` → PASS.
Run: `pnpm -r typecheck` → Column 리터럴에 `domainId` 누락한 곳이 tsc 에러로 나열됨. 각 지점에 `domainId: null` 추가:
- core: `testing/fixtures.ts`의 컬럼, `ddl.test.ts`의 `col()` 헬퍼 반환에 `domainId: null` 등.
- web: `apps/web/src/editor/column-edits.ts`의 `addColumn`이 만드는 컬럼에 `domainId: null`, 기타 web 테스트의 Column 리터럴.
- server: `apps/server/src/services/model-store.ts` `loadProjectModel`의 column 매핑에 `domainId: null`(임시 — Task 3에서 실제 컬럼으로 교체).
`pnpm -r typecheck` 클린까지 반복.

- [ ] **Step 8: 전체 스위트 확인**

Run: `pnpm --filter @erdd/core exec vitest run` / `pnpm --filter @erdd/web exec vitest run` / `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run`
Expected: 모두 PASS(동작 변화 없음 — domains 비어있고 domainId 항상 null).

- [ ] **Step 9: Commit**
```bash
git add packages/core/src/model.ts packages/core/src/op.ts packages/core/src/integrity.ts packages/core/src/index.ts packages/core/src/testing/fixtures.ts packages/core/src/ddl.test.ts packages/core/src/op.test.ts apps/web/src/editor/column-edits.ts apps/server/src/services/model-store.ts
# tsc가 지목한 추가 파일이 있으면 함께 스테이징
git commit -m "feat(core): 도메인 엔티티·컬럼 domainId 플러밍(동작 없음, 하위호환 default null)"
```

---

## Task 2: core 타입 해석 (`domain-resolve.ts`)

**Files:** Create `packages/core/src/domain-resolve.ts` + `domain-resolve.test.ts`. Modify `packages/core/src/index.ts`.

**Interfaces produced:** `resolveColumn(column, model, dialect): ResolvedColumn`.

- [ ] **Step 1: 실패 테스트** — `packages/core/src/domain-resolve.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { resolveColumn } from './domain-resolve.js'

function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
  return m
}
const col = (over = {}) => ({ id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A',
  type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
  order: 0, comment: null, domainId: null, ...over })

describe('resolveColumn', () => {
  it('직접입력 컬럼은 타입을 그대로 변환', () => {
    const m = base(); m.columns['c'] = col({ type: 'VARCHAR(10)' })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('varchar(10)')
  })
  it('도메인 컬럼은 방언 오버라이드 우선, 없으면 논리타입 변환', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '금액', category: null, logicalType: 'DECIMAL(15)',
      dialectTypes: { postgresql: 'numeric(15)', mysql: null, oracle: null, mssql: null },
      defaultValue: '0', allowedValues: [], description: null }
    m.columns['c'] = col({ domainId: 'd', defaultValue: null })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('numeric(15)')
    expect(resolveColumn(m.columns['c']!, m, 'mysql').sql).toBe('DECIMAL(15)') // 논리타입 변환
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').defaultValue).toBe('0') // 도메인 기본값
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').logicalType).toBe('DECIMAL(15)')
  })
  it('컬럼 defaultValue가 도메인보다 우선', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null }
    m.columns['c'] = col({ domainId: 'd', type: 'INT', defaultValue: "'Y'" })
    const r = resolveColumn(m.columns['c']!, m, 'postgresql')
    expect(r.defaultValue).toBe("'Y'")
    expect(r.checkValues).toEqual(['Y', 'N'])
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core exec vitest run src/domain-resolve.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `packages/core/src/domain-resolve.ts` (설계 문서의 `resolveColumn` 전체 반영)

```ts
import type { Column, ProjectModel } from './model.js'
import { resolveColumnType, type Dialect } from './dialect.js'

export type ResolvedColumn = {
  sql: string
  logicalType: string
  warning?: string
  checkValues?: string[]
  defaultValue: string | null
}

export function resolveColumn(column: Column, model: ProjectModel, dialect: Dialect): ResolvedColumn {
  if (column.domainId) {
    const d = model.domains[column.domainId]
    if (d) {
      const override = d.dialectTypes[dialect]
      let sql: string
      let warning: string | undefined
      if (override && override.trim() !== '') {
        sql = override
      } else {
        const r = resolveColumnType(d.logicalType, dialect)
        sql = r.sql
        warning = r.warning
      }
      const defaultValue = column.defaultValue !== null && column.defaultValue !== ''
        ? column.defaultValue : d.defaultValue
      return {
        sql, logicalType: d.logicalType, warning,
        checkValues: d.allowedValues.length ? d.allowedValues : undefined, defaultValue,
      }
    }
  }
  const r = resolveColumnType(column.type, dialect)
  return { sql: r.sql, logicalType: column.type, warning: r.warning, defaultValue: column.defaultValue }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/core exec vitest run src/domain-resolve.test.ts` → PASS.

- [ ] **Step 5: export** — `index.ts`에 `export { resolveColumn, type ResolvedColumn } from './domain-resolve.js'`.

- [ ] **Step 6: typecheck + Commit**
```bash
pnpm --filter @erdd/core typecheck
git add packages/core/src/domain-resolve.ts packages/core/src/domain-resolve.test.ts packages/core/src/index.ts
git commit -m "feat(core): 도메인 컬럼 타입 해석 resolveColumn(방언 오버라이드·CHECK·기본값 우선순위)"
```

---

## Task 3: server 스키마 + 마이그레이션 0004 + model-store

**Files:** Modify `apps/server/src/db/schema.ts`, `apps/server/src/services/model-store.ts`. Create `apps/server/drizzle/0004_*.sql`(생성). Test: `apps/server/src/services/model-store.test.ts`(있으면) 또는 신규.

- [ ] **Step 1: `schema.ts`** — `modelDomains` 테이블 + `modelColumns.domainId`

`modelColumns` 정의에 추가(마지막 필드 뒤):
```ts
  domainId: uuid('domain_id').references(() => modelDomains.id),
```
`modelColumns` 위 또는 아래에 신규 테이블:
```ts
export const modelDomains = pgTable('model_domains', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  logicalType: text('logical_type').notNull(),
  dialectTypes: jsonb('dialect_types')
    .$type<{ postgresql: string | null; mysql: string | null; oracle: string | null; mssql: string | null }>().notNull(),
  defaultValue: text('default_value'),
  allowedValues: jsonb('allowed_values').$type<string[]>().notNull(),
  description: text('description'),
})
```
> `modelColumns`가 `modelDomains`를 참조하므로 `modelDomains`를 `modelColumns`보다 먼저 선언하거나, drizzle의 lazy `() =>` 참조로 순서 무관하게 둔다(위 `references(() => modelDomains.id)`는 lazy라 순서 무관).

- [ ] **Step 2: 마이그레이션 0004 생성**

Run: `pnpm --filter @erdd/server exec drizzle-kit generate`
Expected: `apps/server/drizzle/0004_*.sql` 생성(model_domains CREATE + model_columns ADD COLUMN domain_id + FK). 내용 확인.

- [ ] **Step 3: dev·test DB 마이그레이션**
```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd' pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec drizzle-kit migrate
```
Expected: 0004 적용.

- [ ] **Step 4: `model-store.ts`**

- `TABLE_BY_KIND`에 `domain: modelDomains,` 추가. import에 `modelDomains` 추가.
- `loadProjectModel`: 도메인 로드 쿼리 + 매핑 추가, column 매핑의 `domainId: null`(Task 1 임시)을 `domainId: r.domainId`로 교체.
```ts
const domainRows = await db.select().from(modelDomains).where(eq(modelDomains.projectId, projectId))
// ... return 객체에:
domains: keyed(domainRows.map((r): Domain => ({
  id: r.id, name: r.name, category: r.category, logicalType: r.logicalType,
  dialectTypes: r.dialectTypes, defaultValue: r.defaultValue,
  allowedValues: r.allowedValues, description: r.description,
}))),
```
import에 `Domain` 타입, `modelDomains` 추가.

- [ ] **Step 5: 서버 테스트(erdd_test)** — 도메인 왕복

`model-store.test.ts`(기존 패턴 따름)에 케이스 추가: 도메인 create op → persistOps → loadProjectModel에 도메인·컬럼 domainId 반영. (기존 테스트 헬퍼로 projectId 준비.)

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/services/model-store.test.ts`
Expected: PASS.

- [ ] **Step 6: 전체 서버 스위트 + typecheck + Commit**
```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm --filter @erdd/server typecheck
git add apps/server/src/db/schema.ts apps/server/src/services/model-store.ts apps/server/drizzle/0004_*.sql apps/server/drizzle/meta apps/server/src/services/model-store.test.ts
git commit -m "feat(server): model_domains 테이블·컬럼 domain_id·마이그레이션 0004·model-store 매핑"
```

---

## Task 4: DDL 통합 (`ddl.ts`)

**Files:** Modify `packages/core/src/ddl.ts`, `packages/core/src/ddl.test.ts`.

- [ ] **Step 1: 실패 테스트** — `ddl.test.ts`에 도메인 컬럼 케이스

기존 `tbl`/`col` 헬퍼 사용. 도메인 있는 모델을 만들어:
```ts
it('도메인 컬럼은 방언 타입·CHECK·기본값을 반영한다', () => {
  const m = createEmptyModel()
  m.tables['t'] = tbl('t', 'FLAGS')
  m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null }
  m.columns['c'] = col('c', 't', 'USE_YN', 'INT', { order: 0, domainId: 'd' }) // type INT은 무시(잠금)
  const pg = generateDdl(m, 'postgresql')
  expect(pg).toContain('USE_YN char(1)')          // 도메인 논리타입 변환
  expect(pg).toContain("DEFAULT 'N'")              // 도메인 기본값
  expect(pg).toContain("CHECK (USE_YN IN ('Y', 'N'))") // 허용값
})
```
(`col` 헬퍼가 `domainId`를 `over`로 받도록 Task 1에서 이미 `domainId: null` 기본 포함.)

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core exec vitest run src/ddl.test.ts` → FAIL(도메인 무시하고 INT 출력).

- [ ] **Step 3: `ddl.ts` — `columnLine`이 model+resolveColumn 사용**

import에 `import { resolveColumn } from './domain-resolve.js'`.
`columnLine` 시그니처를 `columnLine(model, col, dialect)`로 변경, 본문:
```ts
function columnLine(model: ProjectModel, col: Column, dialect: Dialect): string {
  const r = resolveColumn(col, model, dialect)
  const parts = [quoteIdentifier(col.physicalName, dialect), r.sql]
  const auto = col.autoIncrement && col.isPk && isIntegerType(r.logicalType)
  if (auto) parts.push(autoIncrementToken(dialect))
  if (!col.nullable) parts.push('NOT NULL')
  if (!auto && r.defaultValue !== null && r.defaultValue !== '') parts.push(`DEFAULT ${r.defaultValue}`)
  if (r.checkValues && r.checkValues.length > 0) {
    const list = r.checkValues.map((v) => `'${esc(v)}'`).join(', ')
    parts.push(`CHECK (${quoteIdentifier(col.physicalName, dialect)} IN (${list}))`)
  }
  if (dialect === 'mysql') {
    const text = commentText(col.logicalName, col.physicalName, col.comment)
    if (text !== null) parts.push(`COMMENT '${esc(text)}'`)
  }
  return `  ${parts.join(' ')}`
}
```
`createTableBlock`의 호출부를 `cols.map((c) => columnLine(model, c, dialect))`로 수정.

> `isIntegerType`가 이제 `r.logicalType`(도메인 컬럼=도메인 논리타입)을 받는다 — dormant `col.type` 아님.

- [ ] **Step 4: 통과 확인 + 회귀** — `pnpm --filter @erdd/core exec vitest run src/ddl.test.ts` → PASS(도메인 케이스 + 기존 직접입력 스냅샷 불변).

- [ ] **Step 5: typecheck + Commit**
```bash
pnpm --filter @erdd/core typecheck
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts
git commit -m "feat(core): DDL 도메인 컬럼 해석(방언타입·CHECK·기본값·자동증가 논리타입 판정)"
```

---

## Task 5: 에디터 도메인 관리 (web)

**Files:** Create `apps/web/src/editor/domain-edits.ts` + `domain-edits.test.ts`, `apps/web/src/editor/domain-panel.tsx`, `apps/web/src/editor/domain-edit-dialog.tsx`. Modify 헤더/진입 지점(예: `apps/web/src/editor/toolbar.tsx` 또는 프로젝트 헤더 — 기존 "내보내기/버전" 버튼 옆에 "도메인" 버튼).

**Interfaces produced:** `createDomain/updateDomain/removeDomain/usageOf`(producer 헬퍼).

- [ ] **Step 1: 실패 테스트** — `domain-edits.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { createDomain, updateDomain, removeDomain, usageOf } from './domain-edits.js'

const dom = (id: string, over = {}) => ({ id, name: '금액', category: null, logicalType: 'DECIMAL(15)',
  dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
  defaultValue: null, allowedValues: [], description: null, ...over })

describe('domain-edits', () => {
  it('createDomain/updateDomain', () => {
    let m = createEmptyModel()
    m = createDomain(m, dom('d1'))
    expect(m.domains['d1']!.name).toBe('금액')
    m = updateDomain(m, 'd1', { name: '통화' })
    expect(m.domains['d1']!.name).toBe('통화')
  })
  it('사용 중 도메인 삭제는 막고, 미사용은 삭제', () => {
    let m = createEmptyModel()
    m = createDomain(m, dom('d1'))
    m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
    m.columns['c'] = { id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: 'd1' }
    expect(usageOf(m, 'd1').map((c) => c.id)).toEqual(['c'])
    expect(() => removeDomain(m, 'd1')).toThrow()
    m.columns['c']!.domainId = null
    expect(removeDomain(m, 'd1').domains['d1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web exec vitest run src/editor/domain-edits.test.ts` → FAIL.

- [ ] **Step 3: `domain-edits.ts`** (기존 model-edits 패턴)

```ts
import { type Domain, type ProjectModel, type Column } from '@erdd/core'

export function createDomain(model: ProjectModel, domain: Domain): ProjectModel {
  return { ...model, domains: { ...model.domains, [domain.id]: domain } }
}
export function updateDomain(model: ProjectModel, id: string, patch: Partial<Omit<Domain, 'id'>>): ProjectModel {
  const cur = model.domains[id]
  if (!cur) return model
  return { ...model, domains: { ...model.domains, [id]: { ...cur, ...patch } } }
}
export function usageOf(model: ProjectModel, domainId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.domainId === domainId)
}
export function removeDomain(model: ProjectModel, id: string): ProjectModel {
  if (usageOf(model, id).length > 0) throw new Error('사용 중인 도메인은 삭제할 수 없습니다')
  const next = { ...model.domains }
  delete next[id]
  return { ...model, domains: next }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/web exec vitest run src/editor/domain-edits.test.ts` → PASS.

- [ ] **Step 5: `domain-panel.tsx` / `domain-edit-dialog.tsx`** (기존 `group-panel.tsx`·`export-dialog.tsx` 패턴 미러)

- 목록 패널: 분류별 도메인 목록, "도메인 추가" 버튼, 각 항목 편집/삭제. 삭제는 `usageOf` 있으면 비활성 + 사용처 수 표시.
- 편집 다이얼로그: 이름·분류·논리타입(Input)·방언별 물리타입 4칸(선택)·기본값·허용값(쉼표/칩)·설명. 저장 시:
  - 신규: `void mutate((m) => createDomain(m, { id: newId(), ...eager }), { summary: '도메인 추가' })`.
  - 수정: 영향 컬럼 수 = `usageOf(model, id).length`. >0이면 "N개 컬럼에 영향을 줍니다" 확인 후 `void mutate((m) => updateDomain(m, id, eagerPatch), { summary: '도메인 수정' })`.
  - **모든 입력값은 producer 진입 전 const로 즉시 캡처**(lazy `e.target.value` 금지).
- 진입: 프로젝트 헤더의 "내보내기/버전" 옆에 "도메인" 버튼(Dialog trigger) 또는 좌측 사이드바 탭. 기존 헤더 컴포넌트에 버튼 추가.

- [ ] **Step 6: 컴포넌트 스모크 테스트(선택) + typecheck**

`domain-panel.test.tsx`로 목록 렌더·삭제 가드 비활성 확인(기존 group-panel.test.tsx 패턴). 라이브 편집 UX는 최종 컨트롤러 브라우저 스모크로 검증.
Run: `pnpm --filter @erdd/web exec vitest run src/editor/domain-edits.test.ts src/editor/domain-panel.test.tsx` / `pnpm --filter @erdd/web typecheck`.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/editor/domain-edits.ts apps/web/src/editor/domain-edits.test.ts apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-edit-dialog.tsx <진입 버튼 파일> <domain-panel.test.tsx 있으면>
git commit -m "feat(web): 도메인 관리 화면(목록·편집·일괄반영 확인·삭제 가드)"
```

---

## Task 6: 컬럼 도메인 지정 + 타입 잠금 (web `edit-panel.tsx`)

**Files:** Modify `apps/web/src/editor/column-edits.ts`, `apps/web/src/editor/edit-panel.tsx`. Test: `column-edits.test.ts`, `edit-panel.test.tsx`.

**Interfaces produced:** `setColumnDomain(model, columnId, domainId)`, `clearColumnDomain(model, columnId)`.

- [ ] **Step 1: 실패 테스트** — `column-edits.test.ts`에 추가

```ts
it('setColumnDomain은 domainId를 설정하고, clearColumnDomain은 해제하며 해석 논리타입을 type에 복사', () => {
  let m = createEmptyModel()
  m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null }
  m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
  m.columns['c'] = { id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: null }
  m = setColumnDomain(m, 'c', 'd')
  expect(m.columns['c']!.domainId).toBe('d')
  m = clearColumnDomain(m, 'c')
  expect(m.columns['c']!.domainId).toBeNull()
  expect(m.columns['c']!.type).toBe('CHAR(1)') // 해석 논리타입 복사
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web exec vitest run src/editor/column-edits.test.ts` → FAIL.

- [ ] **Step 3: `column-edits.ts`**

```ts
import { resolveColumn } from '@erdd/core' // 기존 import에 병합
// ...
export function setColumnDomain(model: ProjectModel, columnId: string, domainId: string): ProjectModel {
  const c = model.columns[columnId]
  if (!c) return model
  return { ...model, columns: { ...model.columns, [columnId]: { ...c, domainId } } }
}
export function clearColumnDomain(model: ProjectModel, columnId: string): ProjectModel {
  const c = model.columns[columnId]
  if (!c || c.domainId === null) return model
  // 해제 시 해석된 논리타입을 type에 복사(직접입력 전환). 방언 무관하게 논리타입만 필요하므로 임의 방언 사용.
  const logicalType = resolveColumn(c, model, 'postgresql').logicalType
  return { ...model, columns: { ...model.columns, [columnId]: { ...c, domainId: null, type: logicalType } } }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/web exec vitest run src/editor/column-edits.test.ts` → PASS.

- [ ] **Step 5: `edit-panel.tsx` — 도메인 드롭다운 + 타입 잠금**

- 컬럼 편집 영역에 도메인 `<select>`(옵션: "없음" + `Object.values(model.domains)`). 값은 `column.domainId ?? ''`.
- onChange: 값 즉시 캡처. 빈 값 → `void mutate((m) => clearColumnDomain(m, id), { summary: '도메인 해제' })`. 도메인 id → `void mutate((m) => setColumnDomain(m, id, domainId), { summary: '도메인 지정' })`.
- 타입 입력란: `column.domainId`가 있으면 `disabled`(도메인 논리타입/방언 표시), 없으면 기존 직접입력.
- 기존 타입 입력 onChange/onBlur 로직은 domainId 없을 때만 활성.

- [ ] **Step 6: `edit-panel.test.tsx`** — 지정 시 타입란 잠금·해제 동작 렌더 테스트(기존 패턴).

Run: `pnpm --filter @erdd/web exec vitest run src/editor/column-edits.test.ts src/editor/edit-panel.test.tsx` / `pnpm --filter @erdd/web typecheck`.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/editor/column-edits.ts apps/web/src/editor/column-edits.test.ts apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx
git commit -m "feat(web): 컬럼 도메인 지정·타입란 잠금(해제 시 논리타입 복사)"
```

---

## 완료 후

- 전체 스위트: `pnpm --filter @erdd/core exec vitest run`, `pnpm --filter @erdd/web exec vitest run`, `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run`, `pnpm -r typecheck` — 모두 그린.
- 컨트롤러 브라우저 스모크: 도메인 생성 → 컬럼에 지정(타입란 잠금) → DDL 내보내기에 방언 타입·CHECK 반영 → 도메인 수정 시 영향 확인·라이브 반영 → 삭제 가드.
- fable 전체 브랜치 리뷰(merge-base..HEAD) → main 머지.

## Self-Review 메모

- `domainId`는 `.default(null)`로 옛 스냅샷/리비전 하위호환(런타임 파싱), TS 구성 지점은 Task 1에서 typecheck-driven 보완.
- 새 엔티티 `domain` 등록 6곳(core 4 + integrity + server TABLE_BY_KIND) 일관.
- 자동증가 정수판정은 `resolved.logicalType` 기준(도메인 컬럼 dormant type 아님).
- 마이그레이션 0004는 dev·test 양쪽 migrate 필수(서버 테스트 게이트).
- 라이브 해석이라 "일괄 반영"은 도메인 update op 1건 + 사전 영향 확인 다이얼로그.
