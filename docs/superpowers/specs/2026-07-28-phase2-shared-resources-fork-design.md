# Phase 2 — 공용 리소스 fork/재동기화 설계 (Shared Resources: 전역·조직 리소스 → 프로젝트 복사 후 수동 재동기화)

**작성일:** 2026-07-28
**상태:** 승인됨 (brainstorming 5문항 모두 권장안 채택)
**원 기획:** [docs/01-concepts.md](../../01-concepts.md) "공용 리소스 패턴: 복사(fork) + 재동기화"

## 목표

서비스 전역·조직 단위의 **공용 리소스 라이브러리**(단어·용어·도메인 사전 + 커스텀 항목 템플릿)를 만들고, 프로젝트가 그것을 **복사(fork)**해 자유롭게 쓰다가, 원본이 갱신되면 **수동 재동기화**로 신규 추가·자동 갱신·충돌을 항목별로 처리할 수 있게 한다. 프로젝트 독립성은 항상 보장한다 — 원본이 어떻게 바뀌든 사용자가 적용하기 전에는 프로젝트 모델이 변하지 않는다.

**범위 밖(후속):** 프로젝트→조직 리소스 승격(반대 방향), 행안부 표준 사전 실데이터 소싱, 500 op를 넘는 대량 사전의 청크 적용, Excel 업로드 연계.

## 핵심 결정 (사용자 확정)

- **원본 참조는 op 엔티티 필드 `origin`.** `domain`/`word`/`term`/`customField` 각각에 `origin: { sourceId, sourceVersion, base } | null`을 추가한다. 별도 링크 테이블이 아니다 — 링크가 op 로그 밖에 있으면 undo·스냅샷 복원에서 모델과 어긋나고(드리프트), 엔티티 삭제와 링크 삭제를 이중 관리해야 한다. 필드로 두면 fork·재동기화가 **평범한 모델 뮤테이션**이 되어 Revision 1건·undo 1회·스냅샷 복원이 공짜로 따라온다.
- **`base` = 가져온 시점에 프로젝트에 써넣은 payload(프로젝트 공간).** 원본 항목의 버전 이력 테이블을 만들지 않는다. `base`가 3-way 병합의 기준점이라 병합 계산 전체가 `packages/core`의 순수 함수로 닫힌다.
- **전역·조직 두 계층을 모두 만든다.** 테이블 하나에 `scope`('global'|'org') 컬럼을 두고, 관리 UI는 같은 컴포넌트를 `/admin`(서비스 관리자)과 `/org/:orgId`(Org Owner/Admin) 두 곳에 붙인다. 로직은 동일하고 권한 판정만 다르다.
- **재동기화 UI는 프로젝트 헤더의 "공용 리소스" 통합 화면 하나.** 라이브러리 선택 → 계획 미리보기(신규 추가 / 자동 갱신 / 충돌 / 유지) → 적용. **최초 가져오기는 "전 항목이 신규인 재동기화"**라 코드 경로가 하나뿐이다.
- **충돌은 항목별 3상태 라디오(보류 / 프로젝트 유지 / 원본 반영, 기본 보류) + 일괄 버튼.** "프로젝트 유지"는 내용을 그대로 두고 `origin`만 원본 현재값으로 갱신해 "검토했고 거절했다"를 기록한다 → 다음 재동기화에 다시 뜨지 않고, 원본이 **또** 바뀌면 다시 충돌로 뜬다. "보류"는 아무것도 기록하지 않아 다음에 다시 뜬다.
- **전역 예시 시드만 넣고 실데이터는 이월.** 전역 라이브러리가 0개일 때만 부팅 시 "표준 사전(예시)" 1개를 만든다(`ensureBootstrapAdmin`과 같은 패턴). 행안부 실데이터의 출처·라이선스·갱신 주기는 `docs/91-checklist.md`의 미결 항목으로 남긴다.
- **프로젝트→조직 승격은 다음 sub-project로 이월.** 요청·승인 상태 머신이 붙는 별도 기능이다.

## 아키텍처 / 방침

- **라이브러리는 프로젝트 모델 밖**이다(op 로그 대상 아님). 서버 테이블 2개(`resource_libraries`, `resource_items`)와 전용 라우터로 관리한다. 라이브러리를 고쳐도 어떤 프로젝트의 Revision도 생기지 않는다.
- **fork·재동기화에 새 뮤테이션 엔드포인트를 만들지 않는다.** 웹이 라이브러리 항목을 조회 → core가 계획 계산 → 사용자가 결정 → producer가 다음 모델 생성 → `diffModels` → 기존 `model.mutate`. 서버는 평소와 똑같은 op 배치를 받는다.
- **병합 엔진은 core 순수 함수.** `planResync`(분류)와 `applyResyncPlan`(적용)이 IO·난수 없이 동작한다. id 생성기는 주입한다(core는 uuidv7 비의존 유지).
- `ENTITY_KINDS` 순서·엔티티 종류는 바뀌지 않는다(새 op 엔티티 없음). `domain`이 `term`보다 앞이라 도메인·용어를 함께 fork해도 create 순서가 안전하다.
- 새 런타임 의존성 없음. DDL 생성에는 영향 없음.

## 전역 제약 (Global Constraints)

- `packages/core`는 IO·런타임 의존성 free. 새 의존성 금지.
- **새 op 엔티티는 없다.** 기존 4종에 필드만 추가하므로 HANDOFF 3.2의 "6곳 등록"은 해당 없고, 3.3의 **엔티티 필드 추가 규칙**이 적용된다: `origin`은 `.nullable().default(null)`, `: Domain`/`: Word`/`: Term`/`: CustomField`/`: ProjectModel` 리터럴(fixtures, `model-store.ts` 반환)에는 `z.infer` 출력 타입상 키가 **필수**이므로 typecheck-driven으로 전부 채운다.
- **옛 스냅샷 회귀**: `origin` 필드가 없는 옛 스냅샷을 복원할 때 `diffModels`가 빈 `changes`의 update op를 만들지 않아야 한다(이미 `diff.ts`에 방어가 있음 — 고정 테스트를 이 필드로도 남긴다).
- **`origin.sourceId`는 참조 무결성 검사 대상이 아니다.** 라이브러리 항목이 삭제돼도 프로젝트 사본은 그대로 살아 있어야 한다(프로젝트 독립성). `integrity.ts`에 검사를 추가하지 않는다.
- 임시 가드가 필요하면 plain `Error`가 아니라 `OpApplyError`를 throw.
- 마이그레이션 append-only(**0007**). 이 워크트리에서는 격리 DB(`erdd_dev_a`/`erdd_test_a`)에만 적용한다. 공유 `erdd`/`erdd_test` 적용과 번호 조율은 병합 시점에 코디네이터가 한다.
- `model.mutate`의 `ops` 상한(500)은 **바꾸지 않는다**. 적용 대상이 500건을 넘으면 UI가 사전에 막고 나눠 선택하도록 안내한다.
- 이벤트 값은 producer 진입 전에 캡처. UI 카피 한국어.
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외.

## 확인된 기존 인터페이스

- `ProjectModel`(core) 10종 컬렉션. `DomainSchema`/`WordSchema`/`TermSchema`/`CustomFieldSchema`는 모두 `z.strictObject`.
- `deepEqual(a, b)`(core `equal.ts`) — JSON-safe 구조 비교. 재동기화 판정에 그대로 쓴다.
- `diffModels(base, target)` — create는 `ENTITY_KINDS` 정순, delete는 역순. target 기준 변경점이 없으면 update op를 만들지 않는다.
- `useModelMutation(projectId)` → `mutate(producer, { summary })`, `newId()`(web `editor/uid.ts`).
- 서버: `getOrgMember(db, orgId, userId)`, `requireProjectAccess(db, projectId, userId, level)`, `adminProcedure`/`authedProcedure`(`trpc.ts`), `appRouter`(`router.ts`), 부팅 훅 `main.ts` → `ensureBootstrapAdmin(app.db)`.
- 웹: 헤더 진입 버튼 4개(`pages/project.tsx:41-45`), 다이얼로그형 관리 화면 패턴(`custom-field-panel.tsx`), 항목 편집 폼 패턴(`custom-field-edit-dialog.tsx`, `domain-edit-dialog.tsx`), 관리 페이지 패턴(`pages/admin.tsx`, `pages/org-detail.tsx`).

## 파일 구조

**core (`packages/core/src/`)**

| 파일 | 책임 |
|---|---|
| `model.ts` (수정) | `OriginSchema`, 4종 엔티티에 `origin` |
| `resource.ts` (신규) | `RESOURCE_KINDS`, payload 스키마·투영(`resourcePayloadOf`), 컬렉션 매핑 |
| `resource-sync.ts` (신규) | `planResync` / `applyResyncPlan` |
| `index.ts` (수정) | 신규 export |
| `testing/fixtures.ts` (수정) | `origin: null` 채우기 |

**server (`apps/server/src/`)**

| 파일 | 책임 |
|---|---|
| `db/schema.ts` (수정) | `resourceLibraries`, `resourceItems` + 4개 모델 테이블에 `origin jsonb` |
| `drizzle/0007_*.sql` (신규) | 마이그레이션 |
| `services/model-store.ts` (수정) | `loadProjectModel`의 `origin` 매핑 |
| `services/resource-library.ts` (신규) | 권한 헬퍼 + 예시 시드 `ensureStarterGlobalLibrary` |
| `routers/resource.ts` (신규) | 라이브러리·항목 CRUD |
| `router.ts` / `main.ts` (수정) | 라우터 등록 / 시드 훅 |

**web (`apps/web/src/`)**

| 파일 | 책임 |
|---|---|
| `editor/resource-panel.tsx` (신규) | 프로젝트 "공용 리소스" 다이얼로그(계획·결정·적용) |
| `editor/resource-decisions.ts` (신규) | 결정 상태 초기화·일괄 조작 순수 헬퍼 |
| `components/resource-library-manager.tsx` (신규) | 라이브러리 목록·CRUD·항목 목록(전역/조직 공용) |
| `components/resource-item-form.tsx` (신규) | 종류별 항목 편집 폼 4종 |
| `pages/admin.tsx` / `pages/org-detail.tsx` (수정) | 관리 컴포넌트 배선 |
| `pages/project.tsx` (수정) | 헤더 5번째 진입 버튼 |

---

## 항목 1: core 데이터 모델 (`origin`) + 리소스 종류 정의

```ts
// model.ts
export const OriginSchema = z.strictObject({
  libraryId: z.string(),                             // 어느 라이브러리에서 왔는지
  sourceId: z.string(),                              // 라이브러리 항목 id
  sourceVersion: z.number().int(),                   // 가져온(또는 마지막으로 처리한) 시점의 원본 버전
  base: z.record(z.string(), z.unknown()),           // 그 시점 원본 payload를 프로젝트 공간으로 리맵한 값
})
export type Origin = z.infer<typeof OriginSchema>
```

- **`libraryId`가 필요한 이유**: 재동기화 계획은 라이브러리 하나를 대상으로 계산한다. `libraryId`가 없으면 "라이브러리 A에서 온 항목"과 "라이브러리 B에서 왔는데 지금 목록에 없는 항목"을 구분할 수 없어, B의 항목이 전부 "원본에서 삭제됨"으로 잘못 집계된다.

- `DomainSchema`·`WordSchema`·`TermSchema`·`CustomFieldSchema`에 `origin: OriginSchema.nullable().default(null)` 추가.
- `base`가 **프로젝트 공간**인 것이 핵심이다. `term.domainId`는 라이브러리에서는 라이브러리 항목 id지만 프로젝트에서는 프로젝트 도메인 id다. `base`를 프로젝트 공간으로 저장해야 "프로젝트가 고쳤는가"를 `deepEqual(payloadOf(entity), origin.base)` 한 줄로 판정할 수 있다.

```ts
// resource.ts
export const RESOURCE_KINDS = ['domain', 'word', 'term', 'customField'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export const RESOURCE_COLLECTION_BY_KIND = {
  domain: 'domains', word: 'words', term: 'terms', customField: 'customFields',
} as const satisfies Record<ResourceKind, keyof ProjectModel>

/** 라이브러리 항목 payload 스키마 — 엔티티에서 id·origin(+ customField의 order)을 뺀 형태. */
export const RESOURCE_PAYLOAD_SCHEMAS: Record<ResourceKind, z.ZodType>

/** 엔티티 → payload 투영(비교·저장 공용). customField는 order도 뺀다. */
export function resourcePayloadOf(kind: ResourceKind, entity: object): Record<string, unknown>

/** payload에서 표시용 이름을 뽑는다(domain/customField는 name, word/term은 logicalName). */
export function resourceDisplayName(kind: ResourceKind, payload: Record<string, unknown>): string
```

- **`customField.order`는 payload에서 제외한다.** 순서는 프로젝트의 표시 관심사다. 포함하면 사용자가 패널에서 순서만 바꿔도 "프로젝트 수정"으로 잡혀 엉뚱한 충돌이 난다. 추가 시에는 프로젝트에서 같은 target 최대+1을 부여하고, 재동기화는 순서를 건드리지 않는다.
- `RESOURCE_PAYLOAD_SCHEMAS`는 `XxxSchema.omit({ id: true, origin: true })`로 파생한다(zod의 `.omit`이 `strictObject`에서 기대대로 동작하는지 구현 시 확인하고, 안 되면 스키마를 명시적으로 재정의한다 — 어느 쪽이든 "엔티티 필드와 1:1"을 고정하는 테스트를 둔다).

**테스트**: `origin` 생략 파싱 → `null`(옛 op 페이로드·옛 스냅샷), `origin` 왕복 update op, `origin`이 있는 엔티티와 없는 엔티티 사이 `diffModels`가 빈 `changes` update를 만들지 않음, `resourcePayloadOf`가 id·origin(+customField order)을 뺀 나머지와 정확히 일치, `RESOURCE_PAYLOAD_SCHEMAS`가 엔티티 스키마 키 집합과 1:1.

## 항목 2: core 병합 엔진 (`resource-sync.ts`)

```ts
export type LibraryItem = {
  id: string
  kind: ResourceKind
  payload: Record<string, unknown>   // 라이브러리 공간(term.domainId = 라이브러리 항목 id)
  version: number
}

export type ResyncStatus = 'added' | 'auto-update' | 'conflict'

export type ResyncEntry = {
  kind: ResourceKind
  sourceId: string
  name: string
  status: ResyncStatus
  version: number                          // 원본 현재 버전
  fromVersion: number | null               // 프로젝트가 들고 있는 버전(added면 null)
  projectEntityId: string | null           // added면 null
  sourcePayload: Record<string, unknown>   // 라이브러리 공간 원본 payload(적용 시 재투영용)
  nextPayload: Record<string, unknown>     // 계획 시점 색인으로 투영한 프로젝트 공간 payload(표시용)
  changedFields: string[]                  // base 대비 원본이 바꾼 필드(표시용, added면 [])
  nameClash: boolean                       // added인데 같은 종류에 같은 이름이 이미 있음
}

export type ResyncPlan = {
  libraryId: string
  entries: ResyncEntry[]
  keptLocal: number       // origin이 없는(프로젝트 자체 추가) 항목 수
  keptDetached: number    // 이 라이브러리에서 왔으나 원본 항목이 사라진 항목 수
  keptSynced: number      // 이 라이브러리에서 왔고 원본과 버전이 같은 항목 수
}

export function planResync(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): ResyncPlan

export type ResyncDecision = 'apply' | 'keep' | 'defer'
export function applyResyncPlan(
  model: ProjectModel,
  plan: ResyncPlan,
  decisions: Readonly<Record<string, ResyncDecision>>,   // key = sourceId, 없으면 'defer'
  newId: () => string,
): ProjectModel
```

**분류 규칙**

| 원본 버전 vs `origin.sourceVersion` | 프로젝트 수정(`payloadOf(entity) ≠ origin.base`) | 결과 |
|---|---|---|
| origin 없음(프로젝트에 사본 없음) | — | `added` |
| 같음 | 무관 | 목록에 없음(`keptSynced`) |
| 다름 | 아니오 | `auto-update` |
| 다름 | 예 | `conflict` |

- **"원본이 바뀌었다"의 판정은 오직 버전 비교**다(`item.version !== origin.sourceVersion`). payload 비교로 판정하면 참조 리맵 결과가 나중에 달라졌을 때(예: 나중에 도메인을 추가로 fork) 원본이 그대로인데도 변경으로 잡힌다.
- **`keptDetached`**: `origin.libraryId`가 이 라이브러리인데 `origin.sourceId`가 항목 목록에 없는 경우. 삭제 제안을 하지 않고 카운트만 노출한다.
- **`keptLocal`**: `origin === null`인 프로젝트 자체 항목. 재동기화가 절대 건드리지 않는다.
- **다른 라이브러리에서 온 항목**(`origin.libraryId !== libraryId`)은 계획에서 완전히 제외한다 — 어느 카운트에도 넣지 않는다.
- `nextPayload`는 계획 시점의 색인으로 투영한 값이라, 같은 배치에서 도메인이 함께 추가되는 경우의 `term.domainId`가 확정되지 않는다. 그래서 `applyResyncPlan`은 `nextPayload`를 쓰지 않고 `sourcePayload`를 **적용 시점 색인(기존 + 이번에 발급한 id)으로 다시 투영**한다.
- `changedFields`는 `nextPayload`와 `origin.base`를 필드별 `deepEqual`로 비교해 만든다.
- `nameClash`는 `added` 항목의 표시 이름이 같은 종류의 기존 프로젝트 항목과 같을 때 true. 기본 미선택으로 노출해 중복 단어·용어가 조용히 생기는 것을 막는다(현재 `warnings.ts`에는 단어·용어 중복 경고가 없다).

**적용 규칙** (`applyResyncPlan`)

1. `apply`로 선택된 `added` 항목에 **먼저 id를 전부 발급**하고, `sourceId → 프로젝트 엔티티 id` 색인을 만든다(기존 엔티티의 `origin.sourceId` + 이번에 발급한 것).
2. 그 색인으로 각 항목의 라이브러리 공간 payload를 프로젝트 공간으로 리맵한다(`term.domainId`; 색인에 없으면 `null`).
3. 결정별 동작 — 어느 경우든 `origin = { libraryId, sourceId, sourceVersion: item.version, base: 투영된 payload }`로 갱신한다:
   - `added` + `apply` → 엔티티 생성(`customField`는 같은 target 최대 order+1 부여)
   - `auto-update` / `conflict` + `apply` → 엔티티 내용을 `nextPayload`로 교체(`customField.order`는 현재 값 유지)
   - `conflict` + `keep` → **엔티티 내용은 그대로**, `origin`만 갱신
   - `defer`(기본) → 아무것도 하지 않음
4. `keep`이 `base`를 "프로젝트의 현재 값"이 아니라 **원본의 현재 값**으로 두는 것이 중요하다. 그래야 다음 재동기화에서도 "프로젝트 수정됨"이 유지되어, 원본이 또 바뀌었을 때 자동 갱신이 아니라 다시 **충돌**로 잡힌다(사용자의 로컬 수정이 조용히 덮이지 않는다).

`applyResyncPlan`은 입력 모델을 변경하지 않고 새 모델을 반환한다.

**테스트**: 4분류 각각, `keptLocal`/`keptDetached`/`keptSynced` 카운트, `nameClash`, `changedFields`, 도메인+용어를 함께 추가할 때 `term.domainId`가 새 프로젝트 도메인 id로 리맵됨, 도메인을 빼고 용어만 추가하면 `domainId === null`, `customField` 추가 시 order = 기존 최대+1이고 자동 갱신은 order를 보존, `apply`/`keep`/`defer` 각각의 결과, **`keep` 후 재계획하면 목록에 없고 원본을 또 바꾸면 다시 `conflict`**, `applyResyncPlan` 결과가 `validateModelIntegrity` 통과 + `diffModels`가 정상 op 배치를 냄.

## 항목 3: server 스키마 + 마이그레이션 0007

```ts
export const resourceLibraries = pgTable('resource_libraries', {
  id: uuid('id').primaryKey(),
  scope: text('scope', { enum: ['global', 'org'] }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }), // scope='org'일 때만
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const resourceItems = pgTable('resource_items', {
  id: uuid('id').primaryKey(),
  libraryId: uuid('library_id').notNull()
    .references(() => resourceLibraries.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['domain', 'word', 'term', 'customField'] }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp(...).notNull().defaultNow(),
  updatedAt: timestamp(...).notNull().defaultNow(),
})
```

- `model_domains` / `model_words` / `model_terms` / `model_custom_fields`에 `origin: jsonb('origin').$type<Origin>()`(nullable) 추가.
- `model-store.ts`의 해당 4종 매핑에 `origin: r.origin ?? null`.
- `scope`/`orgId` 정합성(전역이면 `orgId` null, 조직이면 non-null)은 라우터에서 강제한다(부분 CHECK 제약은 drizzle-kit 생성 SQL 밖이라 도입하지 않는다).
- `testing/helpers.ts`의 `withUuidIds`는 `origin`을 **건드리지 않는다**(`origin.libraryId`/`sourceId`는 라이브러리 id 공간). `origin`을 쓰는 서버 테스트는 실제 UUID를 직접 지정한다 — 이 계약을 주석으로 남긴다.
- `testing/db.ts`의 `TEST_TABLES`에 `resource_items`·`resource_libraries`를 **반드시** 추가한다. 전역 라이브러리는 `org_id`가 null이라 `organizations` TRUNCATE CASCADE로 지워지지 않아, 빠뜨리면 시드 라이브러리가 테스트 간에 남아 격리가 깨진다. 같은 김에 이월 항목이던 `model_domains`·`model_words`·`model_terms`·`model_custom_fields`·`snapshots`도 명시한다.

**테스트(erdd_test_a)**: `origin` 왕복 persist(create/update/delete), `origin`이 있는 도메인·용어·단어·커스텀 항목을 **단일 배치**로 persist(스냅샷 복원 회귀 가드), 라이브러리 삭제 시 항목 CASCADE, 조직 삭제 시 조직 라이브러리 CASCADE.

## 항목 4: server 라우터 `resource`

```
resource.library.list({ orgId?: string })          // orgId 없으면 전역만
resource.library.listForProject({ projectId })     // 전역 + 해당 프로젝트 소속 조직
resource.library.create({ scope, orgId?, name, description })
resource.library.update({ libraryId, name?, description? })
resource.library.remove({ libraryId })
resource.items.list({ libraryId })
resource.items.create({ libraryId, kind, payload })
resource.items.update({ itemId, payload })         // version += 1
resource.items.remove({ itemId })
```

**권한**

| 동작 | 전역 라이브러리 | 조직 라이브러리 |
|---|---|---|
| 읽기(list/items.list) | 인증 사용자 전체 | 해당 조직 멤버 |
| 쓰기(create/update/remove) | `user.role === 'admin'` | Org Owner/Admin |

- `listForProject`는 `requireProjectAccess(..., 'view')`로 게이트한다(프로젝트 조회 권한이 있으면 그 프로젝트가 쓸 수 있는 라이브러리 목록을 본다).
- `items.create/update`는 payload를 `RESOURCE_PAYLOAD_SCHEMAS[kind]`로 검증한다. 실패 시 `BAD_REQUEST`.
- `items.update`는 payload가 실제로 달라졌을 때만 `version += 1`하고 `updatedAt`을 갱신한다(같은 값 저장이 전 프로젝트에 재동기화 알림을 뿌리지 않도록).
- 라이브러리 목록에는 `itemCount`를 함께 돌려준다(목록 화면용).
- fork·재동기화 전용 엔드포인트는 **없다** — 적용은 기존 `model.mutate`가 받는다.

**테스트(erdd_test_a)**: 권한 매트릭스(비관리자 쓰기 403, 타 조직 멤버 읽기 403, 전역 읽기는 아무 사용자나 200), payload 검증 실패 400, `items.update`의 version 증가/무변경 시 미증가, `listForProject`가 전역 + 소속 조직 것만 돌려줌, 라이브러리 삭제 CASCADE.

## 항목 5: server 예시 시드

```ts
// services/resource-library.ts
export async function ensureStarterGlobalLibrary(db: Db): Promise<void>
```

- 전역 라이브러리가 **0개일 때만** "표준 사전(예시)" 1개와 항목을 만든다(단어 6·용어 3·도메인 3·커스텀 항목 2 정도). 용어 항목의 `payload.domainId`는 같은 배치에서 만든 **도메인 항목 id**를 가리켜, fork 시 참조 리맵 경로가 실제로 검증되게 한다.
- `main.ts`에서 `ensureBootstrapAdmin` 다음에 호출한다. 실데이터가 아님을 이름·설명에 명시한다("행안부 표준 사전 실데이터는 별도 소싱 예정").

**테스트(erdd_test_a)**: 두 번 호출해도 라이브러리가 1개(멱등), 이미 전역 라이브러리가 있으면 아무것도 만들지 않음, 만들어진 용어 항목의 `domainId`가 같은 라이브러리의 도메인 항목을 가리킴.

## 항목 6: web 라이브러리 관리 컴포넌트

```tsx
<ResourceLibraryManager scope="global" canManage={boolean} />
<ResourceLibraryManager scope="org" orgId={string} canManage={boolean} />
```

- 라이브러리 목록(이름·설명·항목 수) + 만들기/이름·설명 수정/삭제(확인 후, "항목 N개도 함께 삭제됩니다").
- 라이브러리 선택 → 항목 목록을 종류별 섹션(도메인/단어/용어/커스텀 항목)으로 표시, 각 항목에 편집·삭제.
- `canManage=false`면 읽기 전용(조직 Member가 조직 리소스를 볼 수는 있게).
- `/admin` 하단에 "전역 공용 리소스" 섹션, `/org/:orgId` 하단에 "조직 공용 리소스" 섹션으로 배선한다(개인 조직도 포함 — 본인이 Owner라 관리 가능).

**테스트**: 목록 렌더, 만들기/삭제 확인 카피, `canManage=false`면 편집 컨트롤 없음, 라이브러리 선택 시 항목 목록 로드.

## 항목 7: web 항목 편집 폼

```tsx
<ResourceItemForm kind={ResourceKind} payload={Record<string, unknown> | null}
  domainItems={LibraryItem[]}    // term의 도메인 선택지(같은 라이브러리의 domain 항목)
  onSubmit={(payload) => void} />
```

- 종류별 필드: `word`(논리명·약어·설명) / `term`(논리명·물리명·도메인 선택·설명) / `domain`(이름·분류·논리 타입·4방언 물리 타입·기본값·허용값·설명) / `customField`(이름·대상·타입·선택지·필수·기본값 — `order` 없음).
- `domain`·`customField` 폼의 필드 구성과 검증은 기존 `domain-edit-dialog.tsx`·`custom-field-edit-dialog.tsx`와 동일한 규칙을 따른다(선택지 0개인 select 금지, 선택지 밖 기본값 금지, boolean에 자유 텍스트 기본값 금지).
- 제출 payload는 `RESOURCE_PAYLOAD_SCHEMAS`를 통과하는 형태여야 한다(서버가 재검증).

**테스트**: 4종 각각의 렌더·제출 payload 형태, `term`의 도메인 선택이 라이브러리 항목 id를 담음, `customField` 자기모순 정의 저장 차단.

## 항목 8: web 프로젝트 "공용 리소스" 패널

- `pages/project.tsx` 헤더 5번째 버튼 "공용 리소스" → 다이얼로그.
- 좌측: `resource.library.listForProject` 결과를 전역/조직 섹션으로. 선택하면 우측에 계획.
- 우측 계획 4구역:
  - **신규 추가(N)** — 체크박스(기본 선택, `nameClash`는 미선택 + "이름 중복" 배지), 구역 "모두 선택/해제"
  - **자동 갱신(N)** — 체크박스(기본 선택) + 변경 필드 요약(`v2 → v4`, 바뀐 필드명)
  - **충돌(N)** — 항목별 3상태 라디오(보류/프로젝트 유지/원본 반영, 기본 보류) + "모두 원본 반영"/"모두 프로젝트 유지" 일괄 버튼 + 원본값↔현재값 비교 표시
  - **유지** — `keptSynced`/`keptLocal`/`keptDetached` 카운트만(동작 없음, "원본에서 삭제된 항목 N건"은 안내 문구로)
- 결정 상태 초기화·일괄 조작은 `resource-decisions.ts`의 순수 함수로 분리해 테스트한다.
- [적용] → `mutate((m) => applyResyncPlan(m, plan, decisions, newId), { summary: \`공용 리소스 재동기화 — ${library.name}\` })`. 처리 대상이 없으면 버튼 비활성.
- **500건 가드**: `defer`가 아닌 결정 수가 500을 넘으면 적용 전에 토스트로 막고 나눠 선택하도록 안내한다.
- 적용 후 계획을 다시 계산해 화면을 갱신한다(같은 다이얼로그에서 결과 확인).

**테스트**: 계획 4구역 렌더, `nameClash` 기본 미선택, 일괄 버튼이 충돌 결정을 한 번에 바꿈, 적용 시 `mutate`가 기대한 producer로 1회 호출, 처리 대상 0이면 비활성, 500 초과 가드.

## 실행

하나의 계획으로 SDD. 순서: 1 core 모델 → 2 core 엔진 → 3 서버 스키마+마이그 0007 → 4 서버 라우터 → 5 시드 → 6 라이브러리 관리 UI → 7 항목 폼 → 8 프로젝트 패널.

기준선(core 146 · web 159 · server 52[erdd_test_a] · `pnpm -r typecheck` 0 errors)에서 시작해 태스크마다 그린 유지. 전체 스위트 체크포인트 → whole-branch 리뷰. **브라우저 스모크와 main 병합은 이 트랙 밖**(코디네이터 담당).

## 범위 밖 (후속)

- **프로젝트 → 조직 리소스 승격**(반대 방향, 조직 관리자 승인) → 다음 sub-project.
- **행안부 표준 사전 실데이터 소싱** — 출처·라이선스·갱신 주기 확인 필요. `docs/91-checklist.md`의 미결 항목으로 유지.
- **500 op 초과 대량 사전의 청크 적용** — 현재는 UI가 사전에 막는다. Excel 업로드로 대량 사전이 실제로 들어오는 시점에 함께 설계한다.
- **라이브러리 항목의 변경 이력·되돌리기** — 항목은 최신 payload와 version만 보관한다.
- 라이브러리 Excel 업로드/내보내기 → Excel 사이클.
- 단어·용어 중복 경고(`warnings.ts`) — 이번에는 fork 시점의 `nameClash` 표시로만 다룬다.
