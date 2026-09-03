# Phase 2 — 도메인과 타입 표준화 설계 (Domain)

**작성일:** 2026-07-25
**상태:** 승인됨 (사용자 "이대로 진행해줘")
**원 기획:** docs/14-domain.md Phase 2 범위

## 목표

방언 중립 도메인으로 컬럼 타입을 한곳에서 표준화한다. 컬럼은 도메인을 참조하거나 직접 타입을 입력하며, 도메인 수정은 사용 중인 모든 컬럼에 **라이브로** 반영된다(별도 반영 액션 없이, 도메인 수정 op 1건이 Revision 1건). 공용 도메인 fork·Excel 산출물은 후속 sub-project로 분리한다.

## 핵심 결정 (사용자 확정)

- **라이브 해석**: 컬럼은 `domainId`만 저장하고, `domainId`가 있으면 타입은 항상 도메인에서 해석한다(컬럼 `type` 필드는 무시·잠금). 불일치 상태가 존재하지 않는다. 도메인 해제 시 해석된 논리타입을 컬럼 `type`에 복사해 직접입력으로 전환한다.
- 기본값 우선순위: 컬럼 `defaultValue`(있으면) → 도메인 `defaultValue`.
- 허용값(`allowedValues`) → DDL의 CHECK 제약.

## 아키텍처 / 방침

- 기존 패턴 준수: `packages/core`는 IO·의존성 free. 모델 변경은 op 엔진(applyOps/diffModels/invertOps)을 통해서만. 뮤테이션은 producer + diff 단일 뮤테이션.
- 도메인은 기존 6개 엔티티(tableGroup/table/column/relationship/index/note)에 이어 **7번째 엔티티 종류**로 추가한다. op 엔진·integrity·model-store가 모두 `ENTITY_KINDS` 기반이라 규칙적으로 확장된다.
- 새 런타임 의존성 없음.

## 전역 제약 (Global Constraints)

- `packages/core`는 IO·런타임 의존성 free 유지. 새 의존성 금지.
- 모델 변경은 op(create/update/delete)로만. 새 엔티티 `domain`은 `ENTITY_KINDS`·`ENTITY_SCHEMAS`·`COLLECTION_BY_KIND`·`applyOps`의 초기 spread·`TABLE_BY_KIND`(server) 여섯 곳에 일관 등록해야 한다.
- 컬럼 `domainId`는 존재하는 도메인을 가리켜야 한다(integrity). 도메인 삭제는 사용 컬럼 0개일 때만(캐스케이드 아님).
- `generateDdl(model, dialect, scope): string` 시그니처 불변.
- 라이브 해석: `domainId != null`이면 컬럼 `type`은 DDL·표시에서 읽지 않는다.
- 마이그레이션은 append-only(0004 신규). dev DB=erdd, test DB=erdd_test 모두 적용.
- 커밋은 명시 파일만 스테이징(`git add .`/`-A` 금지). `.idea/*`·`.env` 커밋 금지. UI 카피 한국어.

## 확인된 기존 인터페이스

- `ProjectModel`(core `model.ts`): `{ tables, columns, relationships, indexes, notes, tableGroups }` (모두 `Record<string, Entity>`). `createEmptyModel()`.
- `ColumnSchema`: `{ id, tableId, logicalName, physicalName, type, isPk, autoIncrement, nullable, defaultValue, order, comment }` (strictObject).
- op 엔진(core `op.ts`): `ENTITY_KINDS`, `ENTITY_SCHEMAS`, `COLLECTION_BY_KIND`, `applyOps`가 초기 `next` 객체를 엔티티별로 spread. `diffModels`(core `diff.ts`), `validateModelIntegrity`(core `integrity.ts`).
- 타입 변환(core `dialect.ts`): `resolveColumnType(rawType, dialect): { sql; warning? }`, `toDialectType(type, dialect)`, `parseLogicalType`.
- DDL(core `ddl.ts`): `columnLine(col, dialect)`가 `resolveColumnType(col.type, dialect).sql` 사용. 식별자 인용은 `quoteIdentifier`.
- server 상태 테이블(`db/schema.ts`): `modelTableGroups/modelTables/modelColumns/...`. `modelColumns`는 컬럼 속성과 1:1. `model-store.ts`의 `TABLE_BY_KIND`·`loadProjectModel`·`persistOps`가 엔티티별 매핑.
- 마이그레이션: `apps/server/drizzle/0000..0003_*.sql` + `meta/`. drizzle-kit generate로 0004 생성.

## 파일 구조

**core (`packages/core/src`)**
- `model.ts` 수정: `DomainSchema`, `ProjectModel.domains`, `createEmptyModel`, `ColumnSchema.domainId`.
- `op.ts` 수정: `'domain'` 엔티티 등록(4곳) + `applyOps` next spread.
- `integrity.ts` 수정: 컬럼 domainId 참조 검증.
- `domain-resolve.ts` 생성 + 테스트: `resolveColumn(column, model, dialect)`.
- `ddl.ts` 수정: `columnLine`이 `resolveColumn` 사용, CHECK/기본값 반영.
- `domain-edits.ts` 생성(선택, web 쪽 model-edits와 대칭) 또는 web에 위치 — 아래 참조.
- `index.ts` 수정: 새 export.

**server (`apps/server/src`)**
- `db/schema.ts` 수정: `modelDomains` 테이블 + `modelColumns.domainId`.
- `drizzle/0004_*.sql` 생성(drizzle-kit).
- `services/model-store.ts` 수정: `TABLE_BY_KIND.domain`, `loadProjectModel` domains 로드 + column domainId.

**web (`apps/web/src/editor`)**
- `domain-edits.ts` 생성: `createDomain/updateDomain/removeDomain`, `setColumnDomain/clearColumnDomain`(producer 헬퍼).
- `domain-panel.tsx` 생성: 도메인 관리 화면(목록·CRUD·사용처·삭제가드).
- `domain-edit-dialog.tsx` 생성: 도메인 편집(방언별 타입·허용값·기본값) + 일괄 반영 영향 확인.
- 컬럼 편집 패널 수정: 도메인 선택 드롭다운 + 타입란 잠금.

---

## 항목 1: core 데이터 모델 + op 엔티티

### `model.ts`

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

- `ProjectModelSchema`에 `domains: z.record(z.string(), DomainSchema)` 추가.
- `createEmptyModel`에 `domains: {}` 추가.
- `ColumnSchema`에 `domainId: z.string().nullable()` 추가.

**주의:** ColumnSchema는 strictObject라 `domainId` 추가 시 기존 컬럼 생성/파싱 경로 전부가 이 필드를 포함해야 한다(모델 픽스처·model-store 매핑·서버 상태). 기본값은 `null`.

### `op.ts`

- `ENTITY_KINDS`에 `'domain'` 추가.
- `ENTITY_SCHEMAS.domain = DomainSchema`.
- `COLLECTION_BY_KIND.domain = 'domains'`.
- `applyOps`의 초기 `next` 객체에 `domains: { ...model.domains }` 추가.

### `integrity.ts`

- 컬럼 `domainId`가 `null`이 아니면 `model.domains[domainId]`가 존재해야 함(없으면 issue).
- (도메인 삭제 가드는 UI/edit 헬퍼에서 처리하되, integrity는 dangling domainId를 잡는다 — 도메인 삭제 op가 사용 컬럼을 남기면 applyOps가 무결성 위반으로 거부.)

### 테스트
- applyOps로 domain create/update/delete 왕복.
- 컬럼이 삭제된 도메인을 가리키면 무결성 위반(도메인 delete op가 사용 컬럼 있을 때 거부).
- diffModels가 domains 변경을 op로 산출.

---

## 항목 2: core 타입 해석 (`domain-resolve.ts`)

```ts
import type { Column, ProjectModel } from './model.js'
import { resolveColumnType, toDialectType, type Dialect } from './dialect.js'
import { parseLogicalType } from './logical-type.js'

export type ResolvedColumn = {
  sql: string                 // 방언 물리 타입
  logicalType: string         // 유효 논리타입(도메인 컬럼=도메인.logicalType, 직접=col.type) — 자동증가 정수판정용
  warning?: string
  checkValues?: string[]      // allowedValues (도메인 컬럼만)
  defaultValue: string | null // 컬럼 우선 → 도메인
}

export function resolveColumn(column: Column, model: ProjectModel, dialect: Dialect): ResolvedColumn {
  if (column.domainId) {
    const d = model.domains[column.domainId]
    if (d) {
      const override = d.dialectTypes[dialect]
      let sql: string, warning: string | undefined
      if (override && override.trim() !== '') {
        sql = override
      } else {
        const r = resolveColumnType(d.logicalType, dialect)
        sql = r.sql; warning = r.warning
      }
      const defaultValue = column.defaultValue !== null && column.defaultValue !== ''
        ? column.defaultValue : d.defaultValue
      return {
        sql, logicalType: d.logicalType, warning,
        checkValues: d.allowedValues.length ? d.allowedValues : undefined, defaultValue,
      }
    }
    // dangling(무결성상 없어야 하나 방어)
  }
  const r = resolveColumnType(column.type, dialect)
  return { sql: r.sql, logicalType: column.type, warning: r.warning, defaultValue: column.defaultValue }
}
```

**자동증가 정수 판정:** DDL의 자동증가는 정수형 PK에서만 유효하므로, 도메인 컬럼의 판정은 dormant한 `col.type`가 아니라 `resolved.logicalType`(도메인 논리타입)으로 해야 한다. `columnLine`은 `isIntegerType(resolved.logicalType)`을 쓴다.

**허용값 CHECK 리터럴:** MVP는 `allowedValues`를 문자열 리터럴로 출력한다 — `CHECK (<col> IN ('Y', 'N'))`, 각 값은 `'${esc(v)}'`. 숫자 코드 도메인의 리터럴 정밀 처리는 범위 밖(문서화된 단순화).

### 테스트
- 도메인 방언 오버라이드 있으면 그 문자열, 없으면 logicalType 변환.
- 컬럼 defaultValue가 도메인 defaultValue보다 우선.
- allowedValues가 checkValues로 전달.
- 직접입력 컬럼은 기존 동작 동일.

---

## 항목 3: server 스키마 + 마이그레이션 + store

### `db/schema.ts`

```ts
export const modelDomains = pgTable('model_domains', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  logicalType: text('logical_type').notNull(),
  dialectTypes: jsonb('dialect_types')
    .$type<{ postgresql: string|null; mysql: string|null; oracle: string|null; mssql: string|null }>().notNull(),
  defaultValue: text('default_value'),
  allowedValues: jsonb('allowed_values').$type<string[]>().notNull(),
  description: text('description'),
})
```
- `modelColumns`에 `domainId: uuid('domain_id').references(() => modelDomains.id)` 추가.

### 마이그레이션 0004
`pnpm --filter @erdd/server exec drizzle-kit generate`로 생성. `model_domains` 테이블 + `model_columns.domain_id` 컬럼 추가. dev(erdd)·test(erdd_test) 모두 migrate.

### `model-store.ts`
- `TABLE_BY_KIND.domain = modelDomains`.
- `loadProjectModel`: domains 로드 + 매핑, column 매핑에 `domainId: r.domainId` 추가.

**주의:** `persistOps`의 create가 `{ ...op.data, projectId }`를 insert하므로, Domain의 필드명이 `model_domains` 컬럼명(camel↔drizzle 매핑)과 1:1이어야 한다. `dialectTypes`/`allowedValues`는 jsonb.

### 테스트 (server, erdd_test)
- 도메인 create/update/delete 왕복 후 loadProjectModel에 반영.
- column.domainId 라운드트립.

---

## 항목 4: DDL 통합 (`ddl.ts`)

`columnLine`을 `resolveColumn(col, model, dialect)` 기반으로 변경:
- `sql`로 타입 출력(도메인/직접 공통).
- `defaultValue`(해석된 우선순위)로 DEFAULT 절.
- `checkValues` 있으면 컬럼 CHECK: `CHECK (${quoteIdentifier(col.physicalName, dialect)} IN (${checkValues.map(quoteLiteral).join(', ')}))` — 문자열 리터럴은 `'...'` 이스케이프(기존 `esc`).
- 자동증가·NOT NULL 등 기존 로직 유지. 단 자동증가 정수 판정은 `isIntegerType(resolved.logicalType)`(도메인 컬럼은 도메인 논리타입)로 한다 — dormant한 `col.type` 아님.

`columnLine`이 이제 `model`을 알아야 하므로 시그니처를 `columnLine(model, col, dialect)`로 확장하고 `createTableBlock` 호출부 수정. `generateDdl` 시그니처는 불변.

### 테스트
- 도메인 컬럼이 방언별 타입으로 출력, CHECK/DEFAULT 반영.
- 컬럼 defaultValue가 도메인보다 우선.
- 직접입력 컬럼 기존 스냅샷 불변(회귀 없음).

---

## 항목 5: 에디터 도메인 관리 (web)

### `domain-edits.ts`
producer 헬퍼(기존 model-edits/table-index 패턴):
- `createDomain(model, { id, name, ... }): ProjectModel`
- `updateDomain(model, id, patch): ProjectModel`
- `removeDomain(model, id): ProjectModel` — 사용 컬럼 있으면 throw(가드).
- `usageOf(model, domainId): Column[]` — 사용처.

### `domain-panel.tsx` / `domain-edit-dialog.tsx`
- 도메인 관리 화면: 분류별 목록, 추가/편집/삭제. 진입은 프로젝트 헤더(내보내기·버전 옆) 또는 좌측 사이드바 탭.
- 편집 다이얼로그: 이름·분류·논리타입(관대한 파서 자동완성)·방언별 물리타입(선택)·기본값·허용값(칩 입력)·설명.
- **일괄 반영 영향 확인**: 편집 저장 시 `usageOf`로 영향 컬럼 수 계산 → "N개 컬럼에 영향" 확인 → producer로 `updateDomain` 단일 뮤테이션(summary '도메인 수정'). 라이브 해석이라 별도 반영 없음.
- 삭제: 사용처 있으면 비활성/경고.

### 테스트
- 도메인 CRUD 뮤테이션.
- 사용 중 도메인 삭제 가드.
- 편집 시 영향 컬럼 수 표시(이벤트 값 즉시 캡처 — lazy read 금지).

---

## 항목 6: 컬럼 도메인 지정 + 타입 잠금 (web 컬럼 편집 패널)

- 컬럼 편집 패널에 **도메인 드롭다운**(없음 + 도메인 목록).
- 도메인 지정 시: 타입 입력란 잠김(도메인 논리타입/방언 표시), producer로 `setColumnDomain(model, columnId, domainId)`(domainId 설정). summary '도메인 지정'.
- 해제 시: `clearColumnDomain(model, columnId)` — domainId=null, 해석된 논리타입을 컬럼 `type`에 복사(직접입력 복귀). summary '도메인 해제'.
- 캔버스 노드/패널에 도메인 컬럼임을 배지로 표시(선택).
- 이벤트 값 즉시 캡처(드롭다운 onChange의 value를 producer 진입 전 const로).

### 테스트
- 도메인 지정/해제 producer(해제 시 type 복사).
- 지정 시 타입란 잠금 렌더.

---

## 실행

하나의 구현 계획으로 묶어 subagent-driven-development로 태스크별 구현+리뷰. 순서:
1. core 모델 + op 엔티티 + integrity
2. core 타입 해석(`domain-resolve.ts`)
3. server 스키마 + 마이그레이션 0004 + model-store
4. DDL 통합
5. 에디터 도메인 관리(패널·편집·일괄반영·삭제가드)
6. 컬럼 도메인 지정 + 타입 잠금

각 태스크 독립 테스트 가능. 전체 스위트(core/server[erdd_test]/web) + typecheck 그린 유지. 마지막에 fable 전체 브랜치 리뷰 후 main 머지.

## 범위 밖 (후속 sub-project)

- 공용 도메인 세트(서비스 전역/조직) fork·재동기화 → 공용 리소스 fork 사이클.
- Excel 도메인정의서 내보내기/업로드 → Excel 사이클.
- 명명 체계(단어/용어)와 Term→기본도메인 연결 → 명명 sub-project(도메인 완료 후).
