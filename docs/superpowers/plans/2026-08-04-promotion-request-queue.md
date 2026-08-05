# 공용 리소스 승격 요청·승인 큐 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라이브러리 쓰기 권한이 없는 Project Editor가 승격을 **요청**하고, Org Owner/Admin이 조직 화면에서 항목 단위로 **승인·반려**할 수 있게 한다.

**Architecture:** `promotion_requests` 테이블(op 로그 밖) 하나를 추가하고, 요청은 **엔티티 포인터만** 담는다. 승인은 새 경로가 아니라 `resource.promote`의 트랜잭션 본문을 `services/promote.ts`로 추출해 공유하며, 요청 행 종결을 같은 `prepare` 훅에 넣어 승격 실패 시 함께 롤백되게 한다. 알림은 폴링 배지까지다(새 인프라 없음).

**Tech Stack:** TypeScript · Fastify + tRPC · drizzle-orm/Postgres · React + TanStack Query + zustand · vitest

**설계 문서:** [`docs/superpowers/specs/2026-08-04-promotion-request-queue-design.md`](../specs/2026-08-04-promotion-request-queue-design.md) — 절 번호(§)는 전부 이 문서를 가리킨다.

## Global Constraints

- **응답·커밋 메시지·주석·문서는 한국어.** 커밋 메시지 말미에 트레일러 2줄(`Co-Authored-By:` / `Claude-Session:`)을 붙인다.
- **`git add -A` / `git add .` / `git commit -a` 금지.** 커밋할 경로를 명시하고, `add`와 `commit`을 한 명령(`&&`)으로 붙인다. `.idea/*`와 루트 `.env`는 절대 커밋하지 않는다.
- **`packages/core`는 이번 사이클에서 변경하지 않는다.** core 스위트(453건)가 무수정으로 그린이어야 한다.
- **모델을 바꾸는 모든 경로는 `mutateAndPublish`를 거친다**(HANDOFF 3.6). `runMutation`을 직접 부르지 않는다.
- **새 tRPC 프로시저의 기본은 `authedProcedure`**(세션 전용). 이번 사이클의 프로시저는 하나도 `apiProcedure`(CLI 토큰)로 열지 않는다(HANDOFF 3.7).
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`의 출력만 보면 안 된다(`-s`가 자식 출력을 삼켜 오류가 있어도 0바이트 + 종료코드 1). `pnpm -r typecheck; echo "EXIT=$?"` 또는 패키지별로 돌린다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 것이 되어 또 오판한다.
- **테스트 기준선(착수 시점):** core 453 · cli 114 · web 358 · server 122 · typecheck EXIT=0.
- **작업 위치는 워크트리다.** 최상위(`/Users/jang2162/IdeaProjects/ERDD`)에서 브랜치를 갈아타지 않는다. 서버 `PORT=3001`, web `ERDD_SERVER_PORT=3001` + `--port 5174`, DB `erdd_dev_a` / `erdd_test_a`.

### 구현자에게 (모든 태스크에 적용)

1. **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크 산출물도 고치지 마라 — 단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
2. **수정 건마다 그 수정이 구분력이 있는지 확인하라** — 프로덕션 변경을 되돌려 테스트가 실패하는지 보고 복구하라. **실패하지 않으면 덮지 말고 그렇다고 보고하라.**

---

## 파일 구조

**server**

| 파일 | 책임 |
|---|---|
| `src/services/resource-library.ts` (수정) | `parsePayload`를 여기로 옮겨 `resource.ts`·`promote.ts`가 공유 |
| `src/services/promote.ts` (신규) | `runPromoteInTx` — 승격 트랜잭션 본문. `resource.promote`와 `promotion.resolve`의 유일한 승격 엔진 |
| `src/db/schema.ts` (수정) | `promotionRequests` |
| `drizzle/0011_*.sql` (신규) | 마이그레이션 |
| `src/routers/promotion.ts` (신규) | 7개 프로시저 |
| `src/routers/resource.ts` (수정) | `promote`가 추출 함수를 쓰도록(동작 불변) |
| `src/router.ts` (수정) | `promotion` 등록 |
| `src/testing/db.ts` (수정) | `TEST_TABLES` |

**web**

| 파일 | 책임 |
|---|---|
| `src/lib/promote-selection.ts` (이동) | 선택 상태 순수 헬퍼 — 조직 화면도 쓰므로 `editor/`에서 나온다 |
| `src/components/promote-entry-list.tsx` (신규) | 3구역 목록 렌더. **에디터 store를 import하지 않는다**(계획을 props로 받는다) |
| `src/editor/resource-promote-tab.tsx` (수정) | 승격/요청 두 모드 |
| `src/editor/resource-panel.tsx` (수정) | 탭 가시성·라이브러리 목록 조건 |
| `src/components/promotion-requests-section.tsx` (신규) | 조직 화면 승인 목록 + 검토 다이얼로그 |
| `src/components/pending-promotions-badge.tsx` (신규) | 헤더 배지 |
| `src/components/app-shell.tsx` · `src/pages/org-detail.tsx` · `src/pages/home.tsx` (수정) | 삽입 지점 |

---

## Task 0: 워크트리 준비 (컨트롤러가 직접 수행)

- [ ] **Step 1: 워크트리 생성 — base는 반드시 로컬 `main`**

```bash
cd /Users/jang2162/IdeaProjects/ERDD
git worktree list                      # 같은 작업의 워크트리가 이미 있는지 확인
git worktree add -b feat/promotion-queue .worktrees/feat-promotion-queue main
```

- [ ] **Step 2: 의존성 설치 (post-checkout 훅은 새 워크트리에서 안 돌 수 있다)**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue && pnpm install
```

- [ ] **Step 3: 격리 DB 생성 + 0010까지 마이그레이션**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue
docker exec erdd-db-1 psql -U postgres -c "CREATE DATABASE erdd_dev_a"
docker exec erdd-db-1 psql -U postgres -c "CREATE DATABASE erdd_test_a"
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a'  pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec drizzle-kit migrate
```

- [ ] **Step 4: 기준선 확인 — 착수 전 전부 그린이어야 한다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```

Expected: core 453 · web 358 · server 122 pass · EXIT=0

> 이후 모든 태스크의 서버 테스트는 `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a'`를 앞에 붙여 실행한다.

---

## Task 1: 승격 트랜잭션 본문 추출 (동작 불변 리팩터링)

**목적:** `promotion.resolve`가 두 번째 호출자가 되기 전에 `resource.promote`의 본문을 함수로 뽑는다. **새 동작이 하나도 없어야 한다** — 기존 `resource-promote.test.ts`가 무수정으로 통과하는 것이 이 태스크의 합격 조건이다.

**Files:**
- Create: `apps/server/src/services/promote.ts`
- Modify: `apps/server/src/services/resource-library.ts` (`parsePayload` 이동), `apps/server/src/routers/resource.ts`
- Test: 기존 `apps/server/src/routers/resource-promote.test.ts` (수정 없음)

**Interfaces:**
- Consumes: `@erdd/core`의 `planPromote`/`applyPromotePlan`/`LibraryItem`/`ProjectModel`/`PromoteStatus`, `services/mutation.ts`의 `runMutation`(타입 추출용)
- Produces: `runPromoteInTx(tx, args) => Promise<ProjectModel>`, `emptyOutcome() => PromoteOutcome`, 타입 `PromoteRequestEntry` / `PromoteOutcome`. **Task 4가 이 셋을 그대로 쓴다.** `parsePayload(kind, payload)`가 `services/resource-library.ts`로 이동.

- [ ] **Step 1: `parsePayload`를 `services/resource-library.ts`로 옮긴다**

`apps/server/src/routers/resource.ts`의 아래 함수를 **잘라내어** `apps/server/src/services/resource-library.ts`의 `loadLibrary` 위에 붙이고 `export`를 붙인다. `resource.ts`에서는 import로 바꾼다.

```ts
// services/resource-library.ts 에 추가
import { RESOURCE_PAYLOAD_SCHEMAS, type ResourceKind } from '@erdd/core'

/** 라이브러리에 저장할 payload를 종류별 스키마로 검증한다. */
export function parsePayload(kind: ResourceKind, payload: unknown): Record<string, unknown> {
  const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(payload)
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `항목 형식 오류 — ${parsed.error.message}` })
  }
  return parsed.data as Record<string, unknown>
}
```

`routers/resource.ts`의 import를 고친다.

```ts
import {
  parsePayload, requireLibraryRead, requireLibraryWrite, requireScopeRead, requireScopeWrite,
} from '../services/resource-library.js'
```

`resource.ts`에서 더는 쓰지 않게 된 `RESOURCE_PAYLOAD_SCHEMAS`·`ResourceKind` import를 정리한다(`KindEnum`이 `RESOURCE_KINDS`를 계속 쓰므로 그것은 남긴다).

- [ ] **Step 2: `services/promote.ts` 생성**

```ts
import { asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import {
  applyPromotePlan, planPromote,
  type LibraryItem, type ProjectModel, type PromoteStatus,
} from '@erdd/core'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { parsePayload } from './resource-library.js'
import type { runMutation } from './mutation.js'

type MutationTx = Parameters<typeof runMutation>[0]

/** 클라(또는 승인자)가 화면에서 본 계획. 서버는 락 안에서 재계산해 이 기대치와 대조한다. */
export type PromoteRequestEntry = {
  entityId: string
  expectedStatus: PromoteStatus
  expectedTargetItemId: string | null
  expectedTargetVersion: number | null
}

export type PromoteOutcome = {
  inserted: number
  updated: number
  skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[]
}

export function emptyOutcome(): PromoteOutcome {
  return { inserted: 0, updated: 0, skipped: [] }
}

/**
 * 승격의 트랜잭션 본문 — runMutation의 prepare 훅 안에서 돈다.
 *
 * 라이브러리 항목을 FOR UPDATE로 잠그고 그 값으로 계획을 재계산해, 기대치와 일치하는 항목만
 * 쓴다. 이 락이 보장하는 것은 "이미 존재하는 항목에 대한 갱신을 직렬화하고, 계획이 잠근 행의
 * 값과 항상 일치한다"까지다(동시 INSERT는 막지 않는다 — 승격 설계 §9).
 *
 * 호출자는 두 곳이다: resource.promote(직접 승격)와 promotion.resolve(요청 승인).
 * 반환한 nextModel을 호출부의 deriveOps가 diffModels에 넣는다.
 */
export async function runPromoteInTx(
  tx: MutationTx,
  args: {
    libraryId: string
    model: ProjectModel
    entries: readonly PromoteRequestEntry[]
    /** 호출부가 소유하는 집계 객체 — 여기에 채운다. */
    outcome: PromoteOutcome
  },
): Promise<ProjectModel> {
  const items = await tx
    .select({
      id: resourceItems.id, kind: resourceItems.kind,
      payload: resourceItems.payload, version: resourceItems.version,
    })
    .from(resourceItems)
    .where(eq(resourceItems.libraryId, args.libraryId))
    .orderBy(asc(resourceItems.createdAt))
    .for('update')
  const plan = planPromote(args.model, args.libraryId, items as LibraryItem[])
  const byEntity = new Map(plan.entries.map((entry) => [entry.entityId, entry]))

  const selected = new Set<string>()
  for (const req of args.entries) {
    const entry = byEntity.get(req.entityId)
    if (!entry) {
      args.outcome.skipped.push({ entityId: req.entityId, reason: 'missing' })
      continue
    }
    if (entry.status !== req.expectedStatus
      || entry.targetItemId !== req.expectedTargetItemId
      || entry.targetVersion !== req.expectedTargetVersion) {
      // targetVersion까지 대조해야 한다 — 상태·대상 id가 같아도 그 사이 다른 사람이 대상
      // 항목을 고쳤으면(버전만 바뀜) 화면의 미리보기가 이미 낡은 것이라 최신 편집을 덮어쓴다.
      args.outcome.skipped.push({ entityId: req.entityId, reason: 'plan-changed' })
      continue
    }
    selected.add(req.entityId)
  }

  const applied = applyPromotePlan(args.model, plan, selected, uuidv7)
  for (const write of applied.writes) {
    const payload = parsePayload(write.kind, write.payload)
    if (write.mode === 'insert') {
      await tx.insert(resourceItems).values({
        id: write.itemId, libraryId: args.libraryId,
        kind: write.kind, payload, version: write.version,
      })
      args.outcome.inserted += 1
    } else {
      await tx.update(resourceItems)
        .set({ payload, version: write.version, updatedAt: new Date() })
        .where(eq(resourceItems.id, write.itemId))
      args.outcome.updated += 1
    }
  }
  if (applied.writes.length > 0) {
    await tx.update(resourceLibraries).set({ updatedAt: new Date() })
      .where(eq(resourceLibraries.id, args.libraryId))
  }
  return applied.nextModel
}
```

- [ ] **Step 3: `routers/resource.ts`의 `promote`가 추출 함수를 쓰게 한다**

`promote` 프로시저의 본문에서 `outcome` 선언과 `prepare` 콜백을 아래로 교체한다. **JSDoc 주석 블록은 그대로 두되**, 락·경합에 관한 상세 설명은 `services/promote.ts`로 옮겼으므로 "본문은 `runPromoteInTx`에 있다"는 한 줄을 덧붙인다.

```ts
      const outcome = emptyOutcome()
      const state: { next: ProjectModel | null } = { next: null }

      try {
        const { seq } = await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'web',
          prepare: async (tx, model) => {
            state.next = await runPromoteInTx(tx, {
              libraryId: input.libraryId, model, entries: input.entries, outcome,
            })
          },
          deriveOps: (model) => (state.next ? diffModels(model, state.next) : []),
          summary: `공용 리소스 승격 — ${library.name}`,
        })
        return { seq, ...outcome }
      } catch (err) {
```

import를 추가하고, 더는 쓰지 않는 것(`applyPromotePlan`·`planPromote`·`LibraryItem`·`uuidv7`이 다른 프로시저에서도 안 쓰이면)을 정리한다. **`uuidv7`은 `library.create`/`items.create`가 계속 쓰므로 남는다.**

```ts
import { emptyOutcome, runPromoteInTx } from '../services/promote.js'
```

- [ ] **Step 4: 기존 승격 테스트가 무수정으로 통과하는지 확인 — 이 태스크의 합격 조건**

Run:
```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/resource-promote.test.ts src/routers/resource.test.ts
```
Expected: PASS (승격·리소스 스위트 전부). 실패하면 추출이 동작을 바꾼 것이므로 **테스트를 고치지 말고 추출을 고친다.**

- [ ] **Step 5: 전체 서버 스위트 + typecheck**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: server 122 pass · EXIT=0

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/services/promote.ts apps/server/src/services/resource-library.ts apps/server/src/routers/resource.ts && git commit -m "$(cat <<'EOF'
refactor(server): 승격 트랜잭션 본문을 services/promote.ts로 추출한다

요청 승인이 두 번째 호출자가 되기 전에 뽑는다. 동작은 그대로이고 기존 승격 스위트가
회귀 그물이다. parsePayload도 두 곳이 쓰게 되어 services/resource-library.ts로 옮겼다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 2: `promotion_requests` 스키마 + 요청 생성·조회·취소

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/testing/db.ts`, `apps/server/src/router.ts`
- Create: `apps/server/drizzle/0011_*.sql` (generate), `apps/server/src/routers/promotion.ts`, `apps/server/src/routers/promotion.test.ts`

**Interfaces:**
- Consumes: Task 1의 없음(독립). `services/perm.ts`의 `requireProjectAccess`, `services/resource-library.ts`의 `requireLibraryRead`, `services/model-store.ts`의 `loadProjectModel`, core의 `planPromote`
- Produces: 테이블 `promotionRequests`, 프로시저 `promotion.create` / `promotion.listForProject` / `promotion.cancel`. **Task 3·4가 이 테이블과 라우터 파일을 이어 쓴다.**

- [ ] **Step 1: 스키마 추가**

`apps/server/src/db/schema.ts` 맨 끝(`resourceItems` 뒤)에 추가한다.

```ts
/**
 * 승격 요청 큐 — op 로그 밖의 일반 테이블이다(resource_libraries와 같은 계층).
 *
 * 요청은 **엔티티 포인터만** 담는다. payload를 동결하지 않으므로 승인 시점에 planPromote를
 * 다시 돌려 최신 값으로 승격한다. orgId 비정규화 컬럼을 두지 않는 것은 의도다 —
 * 조직 단위 조회는 resource_libraries.orgId 조인으로 얻고, 요청 생성이
 * library.orgId === project.orgId를 강제하므로 두 경로가 같은 값을 가리킨다.
 */
export const promotionRequests = pgTable('promotion_requests', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  libraryId: uuid('library_id').notNull()
    .references(() => resourceLibraries.id, { onDelete: 'cascade' }),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 프로젝트 엔티티 id 묶음. */
  entityIds: jsonb('entity_ids').$type<string[]>().notNull(),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['pending', 'resolved', 'rejected', 'cancelled'] })
    .notNull().default('pending'),
  /** 처리자(승인·반려) 또는 취소자. */
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note').notNull().default(''),
  /** 실제로 승격된 엔티티 id(부분 승인의 결과). pending이면 null. */
  approvedEntityIds: jsonb('approved_entity_ids').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ix_promotion_requests_library_status').on(t.libraryId, t.status),
  index('ix_promotion_requests_project').on(t.projectId),
])
```

- [ ] **Step 2: 마이그레이션 생성 + 두 DB에 적용**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue
pnpm --filter @erdd/server exec drizzle-kit generate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a'  pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec drizzle-kit migrate
```
Expected: `apps/server/drizzle/0011_*.sql`이 생기고 두 DB에 적용된다. 생성된 SQL을 열어 `CREATE TABLE promotion_requests`와 인덱스 2개만 들어 있는지 확인한다(다른 테이블 변경이 섞여 있으면 보고).

- [ ] **Step 3: `TEST_TABLES`에 추가**

`apps/server/src/testing/db.ts`의 배열 맨 앞에 넣는다(`projects`보다 앞 — `TRUNCATE … CASCADE`라 없어도 지워지지만 명시가 관례다).

```ts
export const TEST_TABLES = [
  'promotion_requests',
  'revisions', 'snapshots',
```

- [ ] **Step 4: 실패하는 테스트를 먼저 쓴다**

`apps/server/src/routers/promotion.test.ts` 생성. **`resource-promote.test.ts`의 헤더·헬퍼를 그대로 따른다**(같은 `post`/`get`/`seedWord` 패턴).

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel } from '@erdd/core'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, session: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, session: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: session } })
}

/** 프로젝트에 단어 하나를 만들고 그 id를 돌려준다. */
async function seedWord(
  app: FastifyInstance, session: string, projectId: string,
  logicalName: string, abbreviation: string,
): Promise<string> {
  const id = uuidv7()
  const next: ProjectModel = {
    ...createEmptyModel(),
    words: { [id]: { id, logicalName, abbreviation, englishName: null, description: null, origin: null } },
  }
  const res = await post(app, 'model.mutate', session, {
    projectId, ops: diffModels(createEmptyModel(), next), summary: '단어 추가',
  })
  expect(res.statusCode).toBe(200)
  return id
}

describe.skipIf(!url)('promotion', () => {
  let app: FastifyInstance
  let ownerSession: string      // Org Owner — 라이브러리 쓰기 권한 있음(승인자)
  let editorSession: string     // Org Member + Project Editor — 요청자
  let orgId: string
  let projectId: string
  let libraryId: string
  let globalLibraryId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'e@t.dev', name: '에디터', password: 'password-e', role: 'user' })
    ownerSession = await loginAs(app, 'o@t.dev', 'password-o')
    editorSession = await loginAs(app, 'e@t.dev', 'password-e')
    orgId = (await post(app, 'org.create', ownerSession, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', ownerSession, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'e@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'e@t.dev')!.id, role: 'editor',
    })
    libraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId, name: '조직 표준',
    })).json().result.data.id
    // 부팅 시드가 만드는 전역 라이브러리를 집어 온다(ensureStarterGlobalLibrary).
    const libs = (await get(app, 'resource.library.listForProject', ownerSession, { projectId }))
      .json().result.data as Array<{ id: string; scope: string }>
    globalLibraryId = libs.find((l) => l.scope === 'global')!.id
  })

  it('Editor가 조직 라이브러리로 승격을 요청한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const res = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId], note: '조직 표준으로 올려 주세요',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ requested: 1, dropped: [] })

    const list = await get(app, 'promotion.listForProject', editorSession, { projectId })
    const rows = list.json().result.data as Array<{
      id: string; status: string; entityIds: string[]; note: string; requesterName: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'pending', entityIds: [wordId], note: '조직 표준으로 올려 주세요', requesterName: '에디터',
    })
  })

  it('계획에 없는 entityId는 dropped로 걸러내고, 전부 걸러지면 거절한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const ghost = uuidv7()
    const ok = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId, ghost],
    })
    expect(ok.json().result.data).toMatchObject({ requested: 1, dropped: [ghost] })

    const bad = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [uuidv7()],
    })
    expect(bad.statusCode).toBe(400)
  })

  it('전역 라이브러리로는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const res = await post(app, 'promotion.create', editorSession, {
      projectId, libraryId: globalLibraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(400)
  })

  it('다른 조직의 라이브러리로는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const otherOrgId = (await post(app, 'org.create', ownerSession, { name: '남의 팀' }))
      .json().result.data.id
    const otherLibraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId: otherOrgId, name: '남의 표준',
    })).json().result.data.id
    const res = await post(app, 'promotion.create', ownerSession, {
      projectId, libraryId: otherLibraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(403)
  })

  it('Viewer는 요청할 수 없다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await createAccount(app.db!, { email: 'v@t.dev', name: '뷰어', password: 'password-v', role: 'user' })
    const viewerSession = await loginAs(app, 'v@t.dev', 'password-v')
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'v@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'v@t.dev')!.id, role: 'viewer',
    })
    const res = await post(app, 'promotion.create', viewerSession, {
      projectId, libraryId, entityIds: [wordId],
    })
    expect(res.statusCode).toBe(403)
  })

  it('요청자는 자기 요청을 취소할 수 있고, 취소된 요청은 다시 취소되지 않는다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const first = await post(app, 'promotion.cancel', editorSession, { requestId })
    expect(first.statusCode).toBe(200)
    const second = await post(app, 'promotion.cancel', editorSession, { requestId })
    expect(second.statusCode).toBe(409)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string }>
    expect(rows[0]!.status).toBe('cancelled')
  })
})
```

- [ ] **Step 5: 테스트가 실패하는 것을 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: FAIL — `No procedure found on path "promotion.create"` (404). 라우터가 아직 없다.

- [ ] **Step 6: `routers/promotion.ts` 생성 (이 태스크 범위: create / listForProject / cancel)**

```ts
import { TRPCError } from '@trpc/server'
import { and, asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { MAX_OPS_PER_MUTATION, planPromote, type LibraryItem } from '@erdd/core'
import { promotionRequests, resourceItems, users } from '../db/schema.js'
import { loadProjectModel } from '../services/model-store.js'
import { requireProjectAccess } from '../services/perm.js'
import { requireLibraryRead } from '../services/resource-library.js'
import { authedProcedure, router } from '../trpc.js'
import type { Db } from '../db/client.js'

/** 요청 행 + 조인 이름. 없으면 NOT_FOUND. */
async function loadRequest(db: Db, requestId: string) {
  const row = (
    await db.select().from(promotionRequests).where(eq(promotionRequests.id, requestId))
  )[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다' })
  return row
}

export const promotionRouter = router({
  /**
   * 승격 요청 생성. 계획에 실제로 있는 entityId만 저장한다 — 검증 없이 받으면 아무 uuid나
   * 요청에 들어가고 승인 화면이 그것을 전부 unavailable로 띄운다.
   */
  create: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      libraryId: z.string().uuid(),
      entityIds: z.array(z.string().uuid()).min(1).max(MAX_OPS_PER_MUTATION),
      note: z.string().max(500).default(''),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
      const library = await requireLibraryRead(ctx.db, input.libraryId, ctx.user)
      if (library.scope !== 'org') {
        throw new TRPCError({
          code: 'BAD_REQUEST', message: '전역 라이브러리로는 승격을 요청할 수 없습니다',
        })
      }
      if (library.orgId !== access.project.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '이 프로젝트의 조직 라이브러리가 아닙니다' })
      }

      const model = await loadProjectModel(ctx.db, input.projectId)
      const items = await ctx.db
        .select({
          id: resourceItems.id, kind: resourceItems.kind,
          payload: resourceItems.payload, version: resourceItems.version,
        })
        .from(resourceItems)
        .where(eq(resourceItems.libraryId, input.libraryId))
        .orderBy(asc(resourceItems.createdAt))
      const plan = planPromote(model, input.libraryId, items as LibraryItem[])
      const valid = new Set(plan.entries.map((entry) => entry.entityId))
      const entityIds = input.entityIds.filter((id) => valid.has(id))
      const dropped = input.entityIds.filter((id) => !valid.has(id))
      if (entityIds.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '승격할 수 있는 항목이 없습니다. 이미 반영됐거나 삭제된 항목입니다.',
        })
      }

      const id = uuidv7()
      await ctx.db.insert(promotionRequests).values({
        id, projectId: input.projectId, libraryId: input.libraryId,
        requesterId: ctx.user.id, entityIds, note: input.note,
      })
      return { id, requested: entityIds.length, dropped }
    }),

  /**
   * 이 프로젝트의 요청 목록(요청자가 결과를 확인하는 자리).
   * entityIds를 그대로 실어, 모델을 들고 있는 승격 탭이 항목 이름을 직접 해석하게 한다.
   */
  listForProject: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      status: z.enum(['pending', 'resolved', 'rejected', 'cancelled']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      return ctx.db
        .select({
          id: promotionRequests.id, libraryId: promotionRequests.libraryId,
          entityIds: promotionRequests.entityIds, note: promotionRequests.note,
          status: promotionRequests.status, createdAt: promotionRequests.createdAt,
          resolvedAt: promotionRequests.resolvedAt,
          resolutionNote: promotionRequests.resolutionNote,
          approvedEntityIds: promotionRequests.approvedEntityIds,
          requesterId: promotionRequests.requesterId, requesterName: users.name,
        })
        .from(promotionRequests)
        .innerJoin(users, eq(users.id, promotionRequests.requesterId))
        .where(input.status === undefined
          ? eq(promotionRequests.projectId, input.projectId)
          : and(
            eq(promotionRequests.projectId, input.projectId),
            eq(promotionRequests.status, input.status),
          ))
        .orderBy(asc(promotionRequests.createdAt))
    }),

  /** 요청자 본인 또는 프로젝트 manage 권한자가 취소한다. */
  cancel: authedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const request = await loadRequest(ctx.db, input.requestId)
      if (request.requesterId !== ctx.user.id) {
        await requireProjectAccess(ctx.db, request.projectId, ctx.user.id, 'manage')
      } else {
        await requireProjectAccess(ctx.db, request.projectId, ctx.user.id, 'view')
      }
      if (request.status !== 'pending') {
        throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
      }
      await ctx.db.update(promotionRequests).set({
        // 취소도 처리의 일종이라 같은 칸을 쓴다 — resolvedBy는 취소자다.
        status: 'cancelled', resolvedBy: ctx.user.id, resolvedAt: new Date(), updatedAt: new Date(),
      }).where(eq(promotionRequests.id, input.requestId))
      return { ok: true as const }
    }),
})
```

> `projects`·`resourceLibraries`·`members` 테이블은 이 태스크에서 쓰지 않는다(Task 3의 `listForOrg`·`pendingCount`가 쓴다). import에 미리 넣지 마라.

- [ ] **Step 7: 라우터 등록**

`apps/server/src/router.ts`에 추가한다.

```ts
import { promotionRouter } from './routers/promotion.js'
// …
  resource: resourceRouter,
  promotion: promotionRouter,
```

- [ ] **Step 8: 테스트 통과 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: PASS (6건)

- [ ] **Step 9: 전체 서버 스위트 + typecheck**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 128 pass (122 + 6) · EXIT=0

- [ ] **Step 10: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle apps/server/src/testing/db.ts apps/server/src/routers/promotion.ts apps/server/src/routers/promotion.test.ts apps/server/src/router.ts && git commit -m "$(cat <<'EOF'
feat(server): 승격 요청 테이블과 생성·조회·취소 프로시저

요청은 엔티티 포인터만 담는다(payload 동결 없음). 생성 시 planPromote로 검증해 계획에
없는 id는 dropped로 걸러내고, 전부 걸러지면 거절한다. 대상은 이 프로젝트 조직의
라이브러리로 한정한다 — 전역은 400, 남의 조직은 403이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 3: 승인자 읽기 경로 — `listForOrg` / `get` / `pendingCount`

**Files:**
- Modify: `apps/server/src/routers/promotion.ts`, `apps/server/src/routers/promotion.test.ts`

**Interfaces:**
- Consumes: Task 2의 `promotionRequests` 테이블·`loadRequest` 헬퍼, `services/resource-library.ts`의 `requireScopeWrite`/`requireLibraryWrite`
- Produces: `promotion.listForOrg({orgId, status?})` / `promotion.get({requestId}) => {request, entries, unavailable}` / `promotion.pendingCount() => {total, byOrg}`. **Task 7·8이 이 셋을 부른다.**

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`promotion.test.ts`의 `describe` 안, Task 2 테스트들 뒤에 추가한다.

```ts
  it('조직 승인 목록은 Org Owner/Admin만 볼 수 있다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })

    const denied = await get(app, 'promotion.listForOrg', editorSession, { orgId })
    expect(denied.statusCode).toBe(403)

    const allowed = await get(app, 'promotion.listForOrg', ownerSession, { orgId })
    expect(allowed.statusCode).toBe(200)
    const rows = allowed.json().result.data as Array<{
      projectName: string; requesterName: string; itemCount: number; libraryName: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      projectName: 'P', requesterName: '에디터', itemCount: 1, libraryName: '조직 표준',
    })
  })

  it('get이 지금 계산한 계획을 내려주고, 그새 승격된 항목은 unavailable로 뺀다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const otherId = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId, otherId],
    })).json().result.data.id

    // 요청과 승인 사이에 Owner가 wordId를 직접 승격해 버린다.
    const direct = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{
        entityId: wordId, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
    expect(direct.statusCode).toBe(200)

    const res = await get(app, 'promotion.get', ownerSession, { requestId })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data as {
      entries: Array<{ entityId: string; status: string; name: string }>
      unavailable: string[]
      request: { note: string; projectName: string }
    }
    expect(data.unavailable).toEqual([wordId])
    expect(data.entries.map((e) => e.entityId)).toEqual([otherId])
    expect(data.entries[0]).toMatchObject({ status: 'new', name: '주문' })
  })

  it('get은 라이브러리 쓰기 권한이 있어야 한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const res = await get(app, 'promotion.get', editorSession, { requestId })
    expect(res.statusCode).toBe(403)
  })

  it('pendingCount는 내가 Owner/Admin인 조직의 것만 센다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds: [wordId] })

    const forOwner = await get(app, 'promotion.pendingCount', ownerSession)
    expect(forOwner.json().result.data).toMatchObject({
      total: 1, byOrg: [{ orgId, count: 1 }],
    })

    // 에디터는 같은 조직의 Member라 셀 것이 없다.
    const forEditor = await get(app, 'promotion.pendingCount', editorSession)
    expect(forEditor.json().result.data).toMatchObject({ total: 0, byOrg: [] })
  })
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: 새 4건 FAIL (`No procedure found on path "promotion.listForOrg"` 등), 기존 6건 PASS

- [ ] **Step 3: import 보강**

`routers/promotion.ts`의 import를 아래로 늘린다. `resourceItems`·`LibraryItem`은 **넣지 않는다** — Step 4의 `planFor`가 `loadLibraryItems`를 부르므로 이 파일이 항목 테이블을 직접 만지지 않는다.

```ts
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { MAX_OPS_PER_MUTATION, planPromote } from '@erdd/core'
import { members, projects, promotionRequests, resourceLibraries, users } from '../db/schema.js'
import { loadLibraryItems } from '../services/promote.js'
import { requireLibraryRead, requireLibraryWrite, requireScopeWrite } from '../services/resource-library.js'
```

- [ ] **Step 4: 계획 재계산 헬퍼를 추가한다**

`loadRequest` 아래에 넣는다. `create`도 같은 일을 하므로 **`create`의 계획 계산 부분을 이 헬퍼로 바꾼다**(중복 제거).

> **Task 2 수정 라운드 결과를 반드시 반영할 것.** 라이브러리 항목 조회는 이미
> `services/promote.ts`의 **`loadLibraryItems(dbOrTx, libraryId)`** 로 일원화돼 있다(커밋 `5109c50`).
> 여기서 조회를 다시 쓰지 마라 — 그 헬퍼를 부른다. `as LibraryItem[]` 캐스트도 넣지 마라(제거됐고
> 반환 타입이 이미 호환된다). 이 조회가 두 곳으로 갈리면 "요청 시점 판정 = 승인 시점 판정" 불변식이
> 깨지고, `orderBy(asc(createdAt))`가 `planPromote`의 동명 선점 순서를 정하므로 판정이 갈린다.

```ts
/** 요청 시점이 아니라 **지금**의 계획을 계산한다(§2.1 — 요청은 포인터만 담는다). */
async function planFor(db: Db, projectId: string, libraryId: string) {
  const model = await loadProjectModel(db, projectId)
  const items = await loadLibraryItems(db, libraryId)
  return planPromote(model, libraryId, items)
}
```

import에 `import { loadLibraryItems } from '../services/promote.js'`를 더한다.

`create` 안의 계획 계산 부분을 `const plan = await planFor(ctx.db, input.projectId, input.libraryId)` 한 줄로 바꾼다. 그 결과 `promotion.ts`에서 `resourceItems` import가 필요 없어지면 지운다(`asc`는 `listForProject`의 `orderBy`가 계속 쓴다).

- [ ] **Step 5: 세 프로시저 추가**

`cancel` 뒤에 넣는다.

```ts
  /**
   * 조직의 승인 목록 — 요약만 낸다. 계획은 계산하지 않는다(목록에 N건이면 N개 프로젝트
   * 모델을 로드하게 된다). 오래된 순으로 정렬해 묵은 요청이 위로 온다.
   */
  listForOrg: authedProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      status: z.enum(['pending', 'resolved', 'rejected', 'cancelled']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await requireScopeWrite(ctx.db, 'org', input.orgId, ctx.user)
      const rows = await ctx.db
        .select({
          id: promotionRequests.id, projectId: promotionRequests.projectId,
          projectName: projects.name,
          libraryId: promotionRequests.libraryId, libraryName: resourceLibraries.name,
          requesterName: users.name, note: promotionRequests.note,
          entityIds: promotionRequests.entityIds, status: promotionRequests.status,
          createdAt: promotionRequests.createdAt, resolvedAt: promotionRequests.resolvedAt,
          resolutionNote: promotionRequests.resolutionNote,
          approvedEntityIds: promotionRequests.approvedEntityIds,
        })
        .from(promotionRequests)
        .innerJoin(resourceLibraries, eq(resourceLibraries.id, promotionRequests.libraryId))
        .innerJoin(projects, eq(projects.id, promotionRequests.projectId))
        .innerJoin(users, eq(users.id, promotionRequests.requesterId))
        .where(and(
          eq(resourceLibraries.orgId, input.orgId),
          eq(promotionRequests.status, input.status ?? 'pending'),
        ))
        .orderBy(asc(promotionRequests.createdAt))
      return rows.map((row) => ({ ...row, itemCount: row.entityIds.length }))
    }),

  /**
   * 요청 상세 + **지금** 계산한 계획.
   *
   * 계획 계산이 서버로 오는 유일한 지점이다 — 승격 탭은 에디터 store의 모델로 클라에서
   * 계산하지만 조직 화면에는 프로젝트 모델이 없다. 모델 전체를 내려보내는 대신 서버가
   * 계산해 PromoteEntry[]만 보낸다.
   */
  get: authedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await loadRequest(ctx.db, input.requestId)
      await requireLibraryWrite(ctx.db, request.libraryId, ctx.user)

      const project = (
        await ctx.db.select({ name: projects.name })
          .from(projects).where(eq(projects.id, request.projectId))
      )[0]
      const requester = (
        await ctx.db.select({ name: users.name })
          .from(users).where(eq(users.id, request.requesterId))
      )[0]

      const plan = await planFor(ctx.db, request.projectId, request.libraryId)
      const byEntity = new Map(plan.entries.map((entry) => [entry.entityId, entry]))
      const entries = request.entityIds
        .map((id) => byEntity.get(id))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      const unavailable = request.entityIds.filter((id) => !byEntity.has(id))

      return {
        request: {
          ...request,
          projectName: project?.name ?? '', requesterName: requester?.name ?? '',
        },
        entries,
        unavailable,
      }
    }),

  /**
   * 헤더·홈 배지용 집계. 권한이 조인 조건에 들어가 있어 내가 승인할 수 있는 것만 세어진다.
   */
  pendingCount: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ orgId: resourceLibraries.orgId, count: count() })
      .from(promotionRequests)
      .innerJoin(resourceLibraries, eq(resourceLibraries.id, promotionRequests.libraryId))
      .innerJoin(members, and(
        eq(members.orgId, resourceLibraries.orgId),
        eq(members.userId, ctx.user.id),
        inArray(members.role, ['owner', 'admin']),
      ))
      .where(eq(promotionRequests.status, 'pending'))
      .groupBy(resourceLibraries.orgId)
    const byOrg = rows
      .filter((row): row is typeof row & { orgId: string } => row.orgId !== null)
      .map((row) => ({ orgId: row.orgId, count: Number(row.count) }))
    return { total: byOrg.reduce((sum, row) => sum + row.count, 0), byOrg }
  }),
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: PASS (10건)

- [ ] **Step 7: 전체 서버 스위트 + typecheck**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 132 pass · EXIT=0

- [ ] **Step 8: 커밋**

```bash
git add apps/server/src/routers/promotion.ts apps/server/src/routers/promotion.test.ts && git commit -m "$(cat <<'EOF'
feat(server): 승인자 읽기 경로 — 조직 목록·요청 상세·대기 건수

get이 요청 시점이 아니라 지금의 계획을 계산해 내려준다. 그새 승격됐거나 삭제된 항목은
unavailable로 분리한다. 목록은 요약만 낸다 — 계획을 계산하면 목록 한 번에 N개 프로젝트
모델을 로드하게 된다. pendingCount는 권한을 조인 조건에 넣어 내가 승인할 수 있는 것만 센다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 4: `promotion.resolve` — 승인·반려

**목적:** 이 사이클의 심장. 승격은 Task 1의 `runPromoteInTx`를 그대로 타고, 요청 행 종결이 **같은 트랜잭션**에 들어가 승격 실패 시 함께 롤백된다.

**Files:**
- Modify: `apps/server/src/routers/promotion.ts`, `apps/server/src/routers/promotion.test.ts`

**Interfaces:**
- Consumes: Task 1의 `runPromoteInTx`/`emptyOutcome`/`PromoteOutcome`, Task 2의 `loadRequest`, `services/mutate-publish.ts`의 `mutateAndPublish`
- Produces: `promotion.resolve({requestId, approve, note}) => {status, seq, inserted, updated, skipped}`. **Task 7이 부른다.**

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`promotion.test.ts`에 추가한다. `resourceItems`·`drizzle-orm`을 import에 더한다(파일 상단).

```ts
import { eq } from 'drizzle-orm'
import { resourceItems } from '../db/schema.js'
```

```ts
  it('승인하면 라이브러리에 쓰이고 요청이 resolved가 된다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: plan.entries.map((e) => ({
        entityId: e.entityId, expectedStatus: e.status,
        expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
      })),
      note: '좋습니다',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({
      status: 'resolved', inserted: 1, updated: 0, skipped: [],
    })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(1)
    expect(items[0]!.payload).toMatchObject({ logicalName: '회원', abbreviation: 'MBR' })

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{
        status: string; approvedEntityIds: string[] | null; resolutionNote: string
      }>
    expect(rows[0]).toMatchObject({
      status: 'resolved', approvedEntityIds: [wordId], resolutionNote: '좋습니다',
    })
  })

  it('부분 승인 — 고르지 않은 항목은 올라가지 않고 요청은 한 번에 닫힌다', async () => {
    const a = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const b = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [a, b],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const only = plan.entries.find((e) => e.entityId === a)!

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: only.entityId, expectedStatus: only.status,
        expectedTargetItemId: only.targetItemId, expectedTargetVersion: only.targetVersion,
      }],
    })
    expect(res.json().result.data).toMatchObject({ status: 'resolved', inserted: 1 })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(1)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; approvedEntityIds: string[] | null }>
    expect(rows[0]).toMatchObject({ status: 'resolved', approvedEntityIds: [a] })
  })

  it('반려는 모델을 건드리지 않는다 — Revision이 생기지 않고 seq가 그대로다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const before = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId, approve: [], note: '아직 이릅니다',
    })
    expect(res.json().result.data).toMatchObject({
      status: 'rejected', seq: null, inserted: 0, updated: 0,
    })

    const after = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    expect(after).toBe(before)
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string; resolutionNote: string }>
    expect(rows[0]).toMatchObject({ status: 'rejected', resolutionNote: '아직 이릅니다' })
  })

  it('두 번째 처리는 CONFLICT다 — 요청은 한 번만 닫힌다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id

    const first = await post(app, 'promotion.resolve', ownerSession, { requestId, approve: [] })
    expect(first.statusCode).toBe(200)
    const second = await post(app, 'promotion.resolve', ownerSession, { requestId, approve: [] })
    expect(second.statusCode).toBe(409)
  })

  it('요청에 없는 항목은 승인 목록에 넣을 수 없다', async () => {
    const a = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const b = await seedWord(app, editorSession, projectId, '주문', 'ORD')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [a],
    })).json().result.data.id

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: b, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
    expect(res.statusCode).toBe(400)

    // 거절됐으므로 요청은 그대로 pending이고 라이브러리도 비어 있다.
    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ status: string }>
    expect(rows[0]!.status).toBe('pending')
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)
  })

  it('기대치가 낡은 항목은 skip되고 approvedEntityIds에서 빠진다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const entry = plan.entries[0]!

    // 그 사이 Owner가 직접 승격해 상태가 new에서 벗어난다.
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{
        entityId: wordId, expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })

    const res = await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: entry.entityId, expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId, expectedTargetVersion: entry.targetVersion,
      }],
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data as {
      status: string; inserted: number; skipped: Array<{ entityId: string; reason: string }>
    }
    // 승인자의 의사는 승인이었으므로 resolved다(§3.1). 실제 승격은 0건이다.
    expect(data.status).toBe('resolved')
    expect(data.inserted).toBe(0)
    expect(data.skipped).toEqual([{ entityId: wordId, reason: 'missing' }])

    const rows = (await get(app, 'promotion.listForProject', editorSession, { projectId }))
      .json().result.data as Array<{ approvedEntityIds: string[] | null }>
    expect(rows[0]!.approvedEntityIds).toEqual([])
  })
```

> **구현자 주의:** 마지막 테스트의 `skipped` 이유가 `missing`인지 `plan-changed`인지는 직접 승격 후 그 단어가 계획에서 **빠지는지**(동기 상태 → 목록 제외 → `missing`) 아니면 **상태가 바뀌는지**에 달렸다. 승격 직후에는 `origin.base`가 현재 payload와 같아져 "값이 같음"으로 목록에서 빠지므로 `missing`이 맞다(승격 설계 §3.1의 표 마지막 행). **실제 결과가 `plan-changed`이면 단언을 정정하고 관찰한 출력과 함께 보고하라 — 프로덕션을 기대값에 맞추지 마라.**

- [ ] **Step 2: 테스트 실패 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: 새 6건 FAIL (`No procedure found on path "promotion.resolve"`), 기존 10건 PASS

- [ ] **Step 3: import 보강**

```ts
import { OpApplyError, diffModels, type ProjectModel } from '@erdd/core'
import { mutateAndPublish } from '../services/mutate-publish.js'
import { emptyOutcome, runPromoteInTx, type PromoteOutcome } from '../services/promote.js'
```

> **`cancel`의 패턴을 복사하지 마라.** Task 2 리뷰가 `cancel`을 read-then-write로 지적했다(Minor M-1):
> 락 없이 `status`를 읽어 확인한 뒤 `where(eq(id))`로만 갱신한다. `resolve`는 그러면 안 된다 — 아래
> 구현처럼 **요청 행을 `FOR UPDATE`로 잠근 뒤** 확인한다. `cancel` 자체를 고치는 것은 이 태스크 범위
> 밖이다(deferred minor로 기록돼 있다).

- [ ] **Step 4: `resolve` 구현**

`pendingCount` 앞에 넣는다.

```ts
  /**
   * 승인·반려 한 입구.
   *
   * approve가 비면 반려다 — 모델을 건드리지 않으므로 mutateAndPublish를 아예 타지 않고
   * Revision도 생기지 않는다(seq는 null).
   *
   * 승인이면 prepare 훅 안에서 (1) 요청 행을 FOR UPDATE로 잠가 pending인지 확인하고
   * (2) 요청 범위 밖 항목을 거르고 (3) resource.promote와 **같은 함수**로 승격한 뒤
   * (4) 요청 행을 종결한다. 넷이 한 트랜잭션이라 승격이 실패하면 요청도 pending으로 남는다.
   *
   * 락 순서는 projects → promotion_requests → resource_items → resource_libraries다.
   * runMutation이 프로젝트 행을 먼저 잠그므로 이미 처리된 요청이어도 프로젝트 락을 잡은
   * 뒤에야 알게 된다 — 트랜잭션 밖에서 status를 한 번 싸게 걸러 두되, 권위 있는 판정은
   * 락 안의 확인이다.
   */
  resolve: authedProcedure
    .input(z.object({
      requestId: z.string().uuid(),
      approve: z.array(z.object({
        entityId: z.string().uuid(),
        expectedStatus: z.enum(['new', 'update', 'name-match']),
        expectedTargetItemId: z.string().uuid().nullable(),
        expectedTargetVersion: z.number().int().nullable(),
      })).max(MAX_OPS_PER_MUTATION),
      note: z.string().max(500).default(''),
    }))
    .mutation(async ({ ctx, input }) => {
      const request = await loadRequest(ctx.db, input.requestId)
      await requireLibraryWrite(ctx.db, request.libraryId, ctx.user)
      // 승인자가 Org Owner/Admin이면 perm.ts의 canEdit가 항상 참이라 구조적으로 통과한다.
      // 새 권한 축을 만들지 않으려고 기존 게이트를 그대로 쓴다.
      await requireProjectAccess(ctx.db, request.projectId, ctx.user.id, 'edit')
      // 싼 사전 거르기 — 권위 있는 판정은 트랜잭션 안에 있다.
      if (request.status !== 'pending') {
        throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
      }
      const allowed = new Set(request.entityIds)
      if (input.approve.some((entry) => !allowed.has(entry.entityId))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '요청에 없는 항목은 승인할 수 없습니다' })
      }

      if (input.approve.length === 0) {
        await ctx.db.transaction(async (tx) => {
          const locked = (
            await tx.select().from(promotionRequests)
              .where(eq(promotionRequests.id, input.requestId)).for('update')
          )[0]
          if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다' })
          if (locked.status !== 'pending') {
            throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
          }
          await tx.update(promotionRequests).set({
            status: 'rejected', resolvedBy: ctx.user.id, resolvedAt: new Date(),
            resolutionNote: input.note, approvedEntityIds: [], updatedAt: new Date(),
          }).where(eq(promotionRequests.id, input.requestId))
        })
        return {
          status: 'rejected' as const,
          seq: null, inserted: 0, updated: 0,
          skipped: [] as PromoteOutcome['skipped'],
        }
      }

      const outcome = emptyOutcome()
      const state: { next: ProjectModel | null } = { next: null }
      try {
        const { seq } = await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: request.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'web',
          prepare: async (tx, model) => {
            const locked = (
              await tx.select().from(promotionRequests)
                .where(eq(promotionRequests.id, input.requestId)).for('update')
            )[0]
            if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다' })
            if (locked.status !== 'pending') {
              throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
            }
            state.next = await runPromoteInTx(tx, {
              libraryId: request.libraryId, model, entries: input.approve, outcome,
            })
            const skipped = new Set(outcome.skipped.map((s) => s.entityId))
            await tx.update(promotionRequests).set({
              status: 'resolved', resolvedBy: ctx.user.id, resolvedAt: new Date(),
              resolutionNote: input.note, updatedAt: new Date(),
              // 승인한 것이 아니라 **실제로 올라간 것**이다.
              approvedEntityIds: input.approve
                .map((entry) => entry.entityId)
                .filter((id) => !skipped.has(id)),
            }).where(eq(promotionRequests.id, input.requestId))
          },
          deriveOps: (model) => (state.next ? diffModels(model, state.next) : []),
          summary: `승격 요청 승인 — ${request.entityIds.length}건 검토`,
        })
        return { status: 'resolved' as const, seq, ...outcome }
      } catch (err) {
        if (err instanceof OpApplyError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
      }
    }),
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' \
  pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts
```
Expected: PASS (16건)

- [ ] **Step 6: 락 안 확인이 승격보다 앞선다는 것을 고정한다**

> **계획 작성 시 확인한 것(구현자는 그대로 따르면 된다):** 원자성("승격이 실패하면 요청도 pending으로 롤백된다")을 **직접 실증하는 테스트는 이 스키마에서 만들 수 없다.** `promotion_requests`는 `projectId`·`libraryId` 양쪽에 `onDelete: 'cascade'`가 걸려 있어, 실패를 주입하려고 프로젝트나 라이브러리를 지우면 **요청 행도 함께 사라져** 잔존을 관찰할 수 없다. 승격 도중(라이브러리 쓰기 성공 후, 커밋 전)에 실패를 넣을 자연스러운 지점도 없다 — `origin` 1필드 update뿐이라 `persistOps`가 FK로 깨지지 않는다.
>
> 원자성 자체는 `resolve`의 라이브러리 쓰기와 요청 행 종결이 **단일 `prepare` 훅 안**에 있다는 코드 구조로 보장된다. 실증 테스트가 없다는 사실은 Task 9에서 설계 §9 이월에 남긴다. **가짜로 통과하는 테스트를 만들지 마라.**

대신 관찰 가능한 것을 고정한다 — **락 안의 status 확인이 승격보다 앞서므로, 이미 처리된 요청은 라이브러리에 아무것도 쓰지 않는다.**

```ts
  it('이미 처리된 요청을 다시 승인해도 라이브러리에 아무것도 쓰이지 않는다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const approve = plan.entries.map((e) => ({
      entityId: e.entityId, expectedStatus: e.status,
      expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
    }))

    // 먼저 반려해 요청을 닫는다.
    expect((await post(app, 'promotion.resolve', ownerSession, {
      requestId, approve: [],
    })).statusCode).toBe(200)

    // 닫힌 요청에 대한 승인은 CONFLICT이고, 라이브러리는 그대로 비어 있어야 한다.
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(409)
    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))
    expect(items).toHaveLength(0)
  })
```

> **이 테스트가 지키는 것을 정확히 알아 두라.** 이것은 "닫힌 요청은 라이브러리를 건드리지 않는다"는 **사용자 관찰 가능한 계약** 테스트이지, 락 안 확인만을 겨냥한 구분력 테스트가 아니다. 방어선이 둘(트랜잭션 밖 사전 확인 + 락 안 확인)이라 어느 하나를 지워도 통과한다 — 그것은 결함이 아니라 이중 방어의 성질이다.
>
> **구분력 확인(필수):** `resolve`의 사전 확인과 락 안 확인을 **둘 다** 지우고 돌려라. 그러면 실패해야 한다(닫힌 요청이 다시 승격된다). 실패하지 않으면 이 테스트는 아무것도 붙잡지 못하는 것이므로 **덮지 말고 그렇다고 보고하라.**

- [ ] **Step 7: 실시간 브로드캐스트 테스트를 추가한다**

`resource-promote.test.ts`에 이미 선례가 있다. 그 파일에서 WebSocket 검증 패턴을 찾아 같은 방식으로 쓴다(`ServerMessage` import가 그 파일 상단에 있다).

```ts
  it('승인이 origin update op를 실시간 채널로 발행한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id
    const plan = (await get(app, 'promotion.get', ownerSession, { requestId }))
      .json().result.data as {
        entries: Array<{
          entityId: string; status: string
          targetItemId: string | null; targetVersion: number | null
        }>
      }
    const entry = plan.entries[0]!

    // resource-promote.test.ts의 '승격이 실시간 채널로 발행된다'와 같은 셋업이다.
    const received: ServerMessage[] = []
    app.hub.subscribe(projectId, {
      userId: 'observer', name: '구독자',
      send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) },
    })
    received.length = 0

    await post(app, 'promotion.resolve', ownerSession, {
      requestId,
      approve: [{
        entityId: entry.entityId, expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId, expectedTargetVersion: entry.targetVersion,
      }],
    })

    const opsMsg = received.find((m) => m.type === 'ops')
    expect(opsMsg).toBeDefined()
  })
```

파일 상단 import에 `ServerMessage`를 더한다.

```ts
import { createEmptyModel, diffModels, type ProjectModel, type ServerMessage } from '@erdd/core'
```

- [ ] **Step 8: 전체 서버 스위트 + typecheck**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 모두 pass · EXIT=0

- [ ] **Step 9: 커밋**

```bash
git add apps/server/src/routers/promotion.ts apps/server/src/routers/promotion.test.ts && git commit -m "$(cat <<'EOF'
feat(server): 승격 요청 승인·반려

승인은 resource.promote와 같은 runPromoteInTx를 타고, 요청 행 종결이 같은 prepare 훅에
들어가 승격이 실패하면 함께 롤백된다. 요청 행을 FOR UPDATE로 잠그고 pending을 확인해
두 관리자의 동시 승인을 막는다. approvedEntityIds는 승인한 것이 아니라 실제로 올라간
것이다(skipped 제외). 반려는 모델을 건드리지 않아 Revision이 생기지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 5: 목록 컴포넌트 추출 (동작 불변 리팩터링)

**목적:** 조직 화면이 쓸 수 있도록 3구역 목록을 에디터 밖으로 뺀다. **새 동작이 없어야 한다** — 기존 `resource-promote-tab.test.tsx`가 무수정으로 통과하는 것이 합격 조건이다.

**Files:**
- Move: `apps/web/src/editor/promote-selection.ts` → `apps/web/src/lib/promote-selection.ts` (테스트 파일이 있으면 함께)
- Create: `apps/web/src/components/promote-entry-list.tsx`
- Modify: `apps/web/src/editor/resource-promote-tab.tsx`
- Test: 기존 `apps/web/src/editor/resource-promote-tab.test.tsx` (수정 없음)

**Interfaces:**
- Consumes: core의 `PromoteEntry`/`PromotePlan`/`PromoteStatus`/`RESOURCE_KIND_LABEL`
- Produces: `<PromoteEntryList entries selected onToggle onSetAll syncedCount? />`. **Task 7이 이 컴포넌트를 조직 화면에서 렌더한다 — 그래서 에디터 store를 import해서는 안 된다.**

- [ ] **Step 1: `promote-selection.ts`를 `lib/`로 옮기고 `PromotePlan` 의존을 끊는다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue
git mv apps/web/src/editor/promote-selection.ts apps/web/src/lib/promote-selection.ts
git mv apps/web/src/editor/promote-selection.test.ts apps/web/src/lib/promote-selection.test.ts
```

**`initialSelection`과 `setAllForStatus`는 `plan.entries`만 읽는다**(계획 작성 시 확인함). 조직 화면은 서버에서 `PromoteEntry[]`만 받고 `PromotePlan` 전체가 없으므로, 지금 시그니처를 배열로 좁힌다 — 그러지 않으면 Task 7이 `{libraryId:'', syncedCount:0, linkedItemIds:{}}` 같은 더미로 감싸야 한다.

```ts
import type { PromoteEntry, PromoteStatus } from '@erdd/core'

/** 기본 선택: 신규·원본 갱신은 켜고, 동명 발견은 사람이 확인해야 하므로 끈다. */
export function initialSelection(entries: readonly PromoteEntry[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) {
    if (entry.status !== 'name-match') out.add(entry.entityId)
  }
  return out
}

/** 특정 상태의 항목 전부를 한 번에 켜거나 끈다(구역 일괄 버튼). */
export function setAllForStatus(
  selected: ReadonlySet<string>, entries: readonly PromoteEntry[],
  status: PromoteStatus, on: boolean,
): Set<string> {
  const out = new Set(selected)
  for (const entry of entries) {
    if (entry.status !== status) continue
    if (on) out.add(entry.entityId)
    else out.delete(entry.entityId)
  }
  return out
}
```

`danglingDomain`·`promoteSummary`는 그대로 둔다(`PromotePlan`을 받지 않는다). `PromotePlan` import를 지운다.

`resource-promote-tab.tsx`의 import와 호출부를 고친다.

```ts
import {
  danglingDomain, initialSelection, promoteSummary, setAllForStatus,
} from '@/lib/promote-selection'
// …
  useEffect(() => { setSelected(initialSelection(plan.entries)) }, [plan])
```

**`promote-selection.test.ts`는 인자를 `plan` → `plan.entries`로 고쳐야 한다.** 이는 시그니처를 좁힌 데 따른 정당한 수정이다 — 이 태스크의 "무수정 통과" 합격 조건은 **`resource-promote-tab.test.tsx`(렌더 동작)**에 대한 것이지 이 단위 테스트가 아니다.

- [ ] **Step 2: `components/promote-entry-list.tsx` 생성**

`resource-promote-tab.tsx`의 `EntryLabel`·`SECTIONS`와 3구역 렌더 JSX를 **잘라내어** 옮긴다.

```tsx
import { RESOURCE_KIND_LABEL, type PromoteEntry, type PromoteStatus } from '@erdd/core'
import { danglingDomain } from '@/lib/promote-selection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
      </span>
      {entry.targetVersion !== null && (
        <span className="text-xs text-muted-foreground">
          v{entry.targetVersion} → v{entry.targetVersion + 1}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/**
 * 승격 계획의 3구역 목록. 승격 탭(프로젝트)과 승인 다이얼로그(조직)가 함께 쓴다.
 *
 * **에디터 store를 참조하지 않는다** — 조직 화면에는 프로젝트 모델 store가 없고,
 * 계획은 거기서 서버가 계산해 내려준다.
 */
export function PromoteEntryList({
  entries, selected, onToggle, onSetAll, syncedCount,
}: {
  entries: readonly PromoteEntry[]
  selected: ReadonlySet<string>
  onToggle: (entityId: string, on: boolean) => void
  onSetAll: (status: PromoteStatus, on: boolean) => void
  /** 승격 탭에서만 넘긴다(승인 화면에는 의미가 없다). */
  syncedCount?: number
}) {
  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = entries.filter((entry) => entry.status === status)
        return (
          <section key={status} className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{title} ({rows.length})</h4>
              {rows.length > 0 && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onSetAll(status, true)}>
                    모두 선택
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onSetAll(status, false)}>
                    모두 해제
                  </Button>
                </span>
              )}
            </div>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
            <ul className="grid gap-1">
              {rows.map((entry) => (
                <li key={entry.entityId}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" aria-label={`${entry.name} 선택`}
                      checked={selected.has(entry.entityId)}
                      onChange={(e) => onToggle(entry.entityId, e.target.checked)} />
                    <EntryLabel entry={entry} />
                  </label>
                  {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
                    <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {syncedCount !== undefined && (
        <section className="grid gap-1 text-xs text-muted-foreground">
          <h4 className="text-sm font-semibold text-foreground">유지</h4>
          <span>이미 이 라이브러리와 같은 항목 {syncedCount}건</span>
        </section>
      )}
    </>
  )
}
```

- [ ] **Step 3: `resource-promote-tab.tsx`가 컴포넌트를 쓰게 한다**

`EntryLabel`·`SECTIONS` 선언을 지우고, 반환 JSX의 3구역 + "유지" 섹션을 아래 한 덩어리로 교체한다. 하단 버튼 줄은 그대로 둔다.

```tsx
      <PromoteEntryList
        entries={plan.entries}
        selected={selected}
        syncedCount={plan.syncedCount}
        onToggle={(entityId, on) => setSelected((prev) => {
          const next = new Set(prev)
          if (on) next.add(entityId)
          else next.delete(entityId)
          return next
        })}
        onSetAll={(status, on) => setSelected((prev) => setAllForStatus(prev, plan.entries, status, on))}
      />
```

import를 더한다. 더는 쓰지 않는 `RESOURCE_KIND_LABEL`·`Badge`·`danglingDomain`·`PromoteEntry`·`PromoteStatus` import를 정리한다(`initialSelection`·`promoteSummary`·`setAllForStatus`는 남는다).

```tsx
import { PromoteEntryList } from '@/components/promote-entry-list'
```

- [ ] **Step 4: 기존 웹 테스트가 무수정으로 통과하는지 확인 — 이 태스크의 합격 조건**

```bash
pnpm --filter @erdd/web exec vitest run src/editor/resource-promote-tab.test.tsx
```
Expected: PASS. 실패하면 추출이 렌더 결과를 바꾼 것이므로 **테스트를 고치지 말고 추출을 고친다.**

- [ ] **Step 5: 전체 웹 스위트 + typecheck**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: web 358 pass · EXIT=0

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/lib/promote-selection.ts apps/web/src/lib/promote-selection.test.ts apps/web/src/components/promote-entry-list.tsx apps/web/src/editor/resource-promote-tab.tsx && git commit -m "$(cat <<'EOF'
refactor(web): 승격 계획 목록을 공용 컴포넌트로 추출한다

조직 화면의 승인 다이얼로그가 같은 목록을 쓴다. 그래서 이 컴포넌트는 에디터 store를
참조하지 않고 계획을 props로 받는다. 선택 헬퍼도 editor/에서 lib/으로 옮겼다.
기존 승격 탭 테스트가 무수정으로 통과하는 것이 회귀 그물이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

> `git mv`가 원본 삭제를 이미 스테이징했으므로 위 목록에 옛 경로를 적지 않는다. 명령이 실패하면 `git status`로 실제 경로를 확인해 그 목록으로 다시 스테이징하라.

---

## Task 6: 승격 탭 요청 모드

**Files:**
- Modify: `apps/web/src/editor/resource-promote-tab.tsx`, `apps/web/src/editor/resource-panel.tsx`
- Test: `apps/web/src/editor/resource-promote-tab.test.tsx` (확장)

**Interfaces:**
- Consumes: Task 2의 `promotion.create`/`listForProject`/`cancel`, Task 5의 `PromoteEntryList`
- Produces: 없음(화면)

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`resource-promote-tab.test.tsx`에 추가한다. 기존 `LIBS` 상수는 `l2`가 `canWrite: true`이므로, **요청 모드용 상수를 따로 만든다.**

```tsx
const LIBS_NO_WRITE = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 0, canWrite: false },
  { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: false },
]

it('쓰기 권한이 없으면 승격 탭이 요청 모드로 열린다', async () => {
  const w = word('w1', '회원', 'MBR')
  // mockTrpcFetch의 Handler는 (input: unknown)을 받는다. 인자를 선언하지 않으면 mock.calls[0]이
  // 빈 튜플로 추론돼 [0] 접근이 TS2493으로 깨진다 — vitest는 통과시키고 typecheck만 잡는다.
  const create = vi.fn((_input: unknown) => ({ data: { id: 'r1', requested: 1, dropped: [] } }))
  renderPanel({
    'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
    'resource.items.list': () => ({ data: [] }),
    'promotion.listForProject': () => ({ data: [] }),
    'promotion.create': create,
  }, { ...createEmptyModel(), words: { w1: w } })

  await openPromoteTab()
  expect(await screen.findByRole('button', { name: /승격 요청/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^승격$/ })).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: /승격 요청/ }))
  await waitFor(() => expect(create).toHaveBeenCalled())
  expect(create.mock.calls[0]![0]).toMatchObject({
    projectId: PROJECT_ID, libraryId: 'l2', entityIds: ['w1'],
  })
})

it('요청 성공 후 모델을 되맞추지 않는다 — 서버가 모델을 바꾸지 않았다', async () => {
  const w = word('w1', '회원', 'MBR')
  const modelGet = vi.fn((_input: unknown) => ({ data: { model: createEmptyModel(), seq: 9 } }))
  renderPanel({
    'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
    'resource.items.list': () => ({ data: [] }),
    'promotion.listForProject': () => ({ data: [] }),
    'promotion.create': () => ({ data: { id: 'r1', requested: 1, dropped: [] } }),
    'model.get': modelGet,
  }, { ...createEmptyModel(), words: { w1: w } })

  await openPromoteTab()
  await userEvent.click(await screen.findByRole('button', { name: /승격 요청/ }))
  await waitFor(() => expect(toast.success).toHaveBeenCalled())
  expect(modelGet).not.toHaveBeenCalled()
})

it('쓰기 권한이 없어도 조직 라이브러리가 있으면 승격 탭이 보인다', async () => {
  renderPanel({
    'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
    'resource.items.list': () => ({ data: [] }),
    'promotion.listForProject': () => ({ data: [] }),
  }, createEmptyModel())

  await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
  expect(await screen.findByRole('tab', { name: '조직으로 승격' })).toBeTruthy()
})

it('대기 중인 요청이 목록에 보이고 취소할 수 있다', async () => {
  const cancel = vi.fn((_input: unknown) => ({ data: { ok: true } }))
  renderPanel({
    'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
    'resource.items.list': () => ({ data: [] }),
    'promotion.listForProject': () => ({ data: [{
      id: 'r1', libraryId: 'l2', entityIds: ['w1'], note: '올려 주세요',
      status: 'pending', createdAt: '2026-08-04T00:00:00.000Z', resolvedAt: null,
      resolutionNote: '', approvedEntityIds: null, requesterId: 'u1', requesterName: '에디터',
    }] }),
    'promotion.cancel': cancel,
  }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })

  await openPromoteTab()
  expect(await screen.findByText(/올려 주세요/)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /요청 취소/ }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith({ requestId: 'r1' }))
})
```

> **구현자 주의:** `openPromoteTab()`은 `조직 표준` 버튼을 클릭한다. 요청 모드에서도 그 라이브러리가 목록에 보여야 하므로 Step 3의 `visible` 조건이 맞아야 이 헬퍼가 통과한다. 또 **기존 테스트가 쓰는 `LIBS`(l2가 `canWrite: true`)는 그대로 두어 승격 모드 경로가 계속 검증되게 한다.**

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/editor/resource-promote-tab.test.tsx
```
Expected: 새 4건 FAIL, 기존 통과

- [ ] **Step 3: `resource-panel.tsx`의 가시성·목록 조건**

```tsx
  const libraries = useQuery(trpc.resource.library.listForProject.queryOptions({ projectId }))
  const rows = (libraries.data ?? []) as LibraryRow[]
  // 승격 탭에는 쓸 수 있는 라이브러리(직접 승격)와 이 조직의 라이브러리(요청)가 보인다.
  // 전역은 쓰기 권한이 있을 때만 — 요청 대상이 아니다.
  const visible = tab === 'promote'
    ? rows.filter((row) => row.canWrite || row.scope === 'org')
    : rows
  const library = visible.find((row) => row.id === libraryId) ?? null
  const canPromote = canEdit && rows.some((row) => row.canWrite || row.scope === 'org')

  const switchTab = (next: Tab) => {
    setTab(next)
    if (next === 'promote' && libraryId !== null
      && !rows.some((row) => row.id === libraryId && (row.canWrite || row.scope === 'org'))) {
      setLibraryId(null)
    }
  }
```

- [ ] **Step 4: `resource-promote-tab.tsx`에 요청 모드를 넣는다**

`promote` mutation 아래에 추가한다.

```tsx
  const [note, setNote] = useState('')
  const requests = useQuery(trpc.promotion.listForProject.queryOptions({
    projectId, status: 'pending',
  }))
  const invalidateRequests = () => queryClient.invalidateQueries({
    queryKey: trpc.promotion.listForProject.queryKey({ projectId, status: 'pending' }),
  })

  const request = useMutation(trpc.promotion.create.mutationOptions({
    onSuccess: async (result) => {
      // 서버가 모델을 바꾸지 않았다 — resync도 model.get도 하지 않는다.
      await invalidateRequests()
      setNote('')
      toast.success(result.dropped.length === 0
        ? `${result.requested}건을 승격 요청했습니다`
        : `${result.requested}건을 요청했습니다 — ${result.dropped.length}건은 이미 반영됐거나 삭제되어 빠졌습니다`)
    },
    onError: (err) => toast.error(err.message),
  }))

  const cancel = useMutation(trpc.promotion.cancel.mutationOptions({
    onSuccess: async () => { await invalidateRequests(); toast.success('요청을 취소했습니다') },
    onError: (err) => toast.error(err.message),
  }))

  const onRequest = () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0) return
    const message = overLimitMessage(entries.length)
    if (message !== null) { toast.error(message); return }
    request.mutate({
      projectId, libraryId: library.id,
      entityIds: entries.map((entry) => entry.entityId),
      note,
    })
  }
```

반환 JSX에서 pending 목록을 목록 위에 넣는다.

```tsx
      {(requests.data ?? []).filter((row) => row.libraryId === library.id).length > 0 && (
        <section className="grid gap-1 rounded border bg-muted/40 p-2">
          <h4 className="text-sm font-semibold">대기 중인 요청</h4>
          <ul className="grid gap-1">
            {(requests.data ?? [])
              .filter((row) => row.libraryId === library.id)
              .map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {row.requesterName} · {row.entityIds.length}건
                    {row.note !== '' && ` · ${row.note}`}
                  </span>
                  <Button size="sm" variant="ghost" disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ requestId: row.id })}>
                    요청 취소
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}
```

하단 버튼 줄을 모드로 가른다.

```tsx
      <div className="grid gap-2 border-t pt-2">
        {!library.canWrite && (
          <Input placeholder="요청 메모 (선택)" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)} />
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">올릴 항목 {selected.size}건</span>
          {library.canWrite ? (
            <Button type="button" disabled={selected.size === 0 || promote.isPending} onClick={onPromote}>
              승격
            </Button>
          ) : (
            <Button type="button" disabled={selected.size === 0 || request.isPending} onClick={onRequest}>
              승격 요청
            </Button>
          )}
        </div>
      </div>
```

`Input` import를 더한다: `import { Input } from '@/components/ui/input'`

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/editor/resource-promote-tab.test.tsx
```
Expected: PASS (기존 + 새 4건)

- [ ] **Step 6: 전체 웹 스위트 + typecheck**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 362 pass · EXIT=0

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/resource-promote-tab.tsx apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-promote-tab.test.tsx && git commit -m "$(cat <<'EOF'
feat(web): 승격 탭에 요청 모드를 넣는다

쓰기 권한이 없으면 같은 3구역 목록에서 고른 뒤 "승격 요청"으로 올린다. 탭 가시성이
canWrite 라이브러리 유무에서 조직 라이브러리 유무로 완화돼, 이전에는 탭 자체를 못 보던
Editor가 들어올 수 있다. 요청은 서버가 모델을 바꾸지 않으므로 resync도 model.get도 하지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 7: 조직 화면 승인 섹션

**Files:**
- Create: `apps/web/src/components/promotion-requests-section.tsx`, `apps/web/src/components/promotion-requests-section.test.tsx`
- Create: `apps/web/src/components/promote-entry-list.test.tsx` (아래 Step 0)
- Modify: `apps/web/src/pages/org-detail.tsx`

- [ ] **Step 0: `PromoteEntryList` 의 미검증 배선을 먼저 잠근다**

Task 5 리뷰가 남긴 것: 구역 일괄 버튼(`onSetAll`)과 "유지" 섹션(`syncedCount`)이 **어느 렌더 테스트로도 잠기지 않는다.** Task 5 시점에는 선재 공백이라 Minor였지만, 이 태스크에서 이 컴포넌트가 **두 화면이 공유하는 추상**이 되므로 배선이 깨지면 양쪽이 동시에 조용히 망가진다. 컴포넌트가 store 비의존이라 에디터 픽스처 없이 순수 렌더로 테스트할 수 있다 — 추출이 만들어 준 이점이다.

`apps/web/src/components/promote-entry-list.test.tsx`에 3건:

```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PromoteEntry } from '@erdd/core'
import { PromoteEntryList } from './promote-entry-list'

const ENTRY: PromoteEntry = {
  kind: 'word', entityId: 'w1', name: '회원', status: 'new',
  targetItemId: null, targetVersion: null, payload: {}, changedFields: [], domainRef: null,
}

afterEach(cleanup)

describe('PromoteEntryList', () => {
  it('구역 일괄 버튼이 onSetAll을 그 구역의 상태로 부른다', async () => {
    const onSetAll = vi.fn()
    render(
      <PromoteEntryList entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={onSetAll} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '모두 선택' }))
    expect(onSetAll).toHaveBeenCalledWith('new', true)
    await userEvent.click(screen.getByRole('button', { name: '모두 해제' }))
    expect(onSetAll).toHaveBeenCalledWith('new', false)
  })

  it('syncedCount를 주면 유지 섹션을 보여준다', () => {
    render(
      <PromoteEntryList entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={vi.fn()} syncedCount={3} />,
    )
    expect(screen.getByText(/이미 이 라이브러리와 같은 항목 3건/)).toBeTruthy()
  })

  it('syncedCount를 주지 않으면 유지 섹션이 없다', () => {
    render(
      <PromoteEntryList entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={vi.fn()} />,
    )
    expect(screen.queryByText(/유지/)).toBeNull()
  })
})
```

> **구현자 주의:** `ENTRY`의 필드는 core의 `PromoteEntry` 타입에서 확인하고 맞춰라. 세 번째 테스트의 `syncedCount` 미전달 분기는 **Task 5의 추출이 새로 만든 것**이라 특히 값이 있다. 각 테스트가 구분력이 있는지 확인하라 — `onSetAll` 호출 제거, `syncedCount` 가드 반전으로 실제 실패하는지.

이 셋을 먼저 통과시킨 뒤 아래 Step 1로 간다.

**Interfaces:**
- Consumes: Task 3의 `promotion.listForOrg`/`get`, Task 4의 `promotion.resolve`, Task 5의 `PromoteEntryList`, `@/lib/promote-selection`의 `initialSelection`/`setAllForStatus`
- Produces: `<PromotionRequestsSection orgId canManage />`

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

```tsx
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { PromotionRequestsSection } from './promotion-requests-section'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const ORG_ID = 'o1'
const ROW = {
  id: 'r1', projectId: 'p1', projectName: '회원 시스템',
  libraryId: 'l2', libraryName: '조직 표준', requesterName: '에디터',
  note: '올려 주세요', entityIds: ['w1', 'w2'], itemCount: 2,
  status: 'pending', createdAt: '2026-08-04T00:00:00.000Z',
  resolvedAt: null, resolutionNote: '', approvedEntityIds: null,
}
const ENTRY = {
  kind: 'word', entityId: 'w1', name: '회원', status: 'new',
  targetItemId: null, targetVersion: null, payload: {}, changedFields: [], domainRef: null,
}

function renderSection(handlers: Parameters<typeof mockTrpcFetch>[0], canManage = true) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <PromotionRequestsSection orgId={ORG_ID} canManage={canManage} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PromotionRequestsSection', () => {
  it('관리 권한이 없으면 아무것도 렌더하지 않는다', () => {
    renderSection({ 'promotion.listForOrg': () => ({ data: [ROW] }) }, false)
    expect(screen.queryByText(/승격 요청/)).toBeNull()
  })

  it('대기 요청을 목록에 보여준다', async () => {
    renderSection({ 'promotion.listForOrg': () => ({ data: [ROW] }) })
    expect(await screen.findByText(/회원 시스템/)).toBeTruthy()
    expect(screen.getByText(/에디터/)).toBeTruthy()
    expect(screen.getByText(/올려 주세요/)).toBeTruthy()
  })

  it('검토를 열면 지금 계산된 계획과 unavailable을 보여준다', async () => {
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: ['w2'],
      } }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    expect(await screen.findByLabelText('회원 선택')).toBeTruthy()
    expect(screen.getByText(/1건은 이미 반영됐거나 삭제되어 처리할 수 없습니다/)).toBeTruthy()
  })

  it('선택한 항목만 승인한다', async () => {
    // mockTrpcFetch의 Handler는 (input: unknown)을 받는다. 인자를 선언하지 않으면
    // mock.calls[0]이 빈 튜플로 추론돼 [0] 접근이 TS2493으로 깨진다(vitest는 통과시킨다).
    const resolve = vi.fn((_input: unknown) => ({ data: {
      status: 'resolved', seq: 5, inserted: 1, updated: 0, skipped: [],
    } }))
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': resolve,
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    await screen.findByLabelText('회원 선택')
    await userEvent.click(screen.getByRole('button', { name: /1건 승격/ }))
    await waitFor(() => expect(resolve).toHaveBeenCalled())
    expect(resolve.mock.calls[0]![0]).toMatchObject({
      requestId: 'r1',
      approve: [{
        entityId: 'w1', expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
  })

  it('선택을 모두 풀면 버튼이 반려로 바뀌고 빈 approve를 보낸다', async () => {
    // mockTrpcFetch의 Handler는 (input: unknown)을 받는다. 인자를 선언하지 않으면
    // mock.calls[0]이 빈 튜플로 추론돼 [0] 접근이 TS2493으로 깨진다(vitest는 통과시킨다).
    const resolve = vi.fn((_input: unknown) => ({ data: {
      status: 'rejected', seq: null, inserted: 0, updated: 0, skipped: [],
    } }))
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': resolve,
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    await userEvent.click(await screen.findByLabelText('회원 선택'))   // 기본 선택을 해제
    await userEvent.click(screen.getByRole('button', { name: '반려' }))
    await waitFor(() => expect(resolve).toHaveBeenCalled())
    expect(resolve.mock.calls[0]![0]).toMatchObject({ requestId: 'r1', approve: [] })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/components/promotion-requests-section.test.tsx
```
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 컴포넌트 구현**

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PromoteEntry, PromoteStatus } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { initialSelection, setAllForStatus } from '@/lib/promote-selection'
import { PromoteEntryList } from '@/components/promote-entry-list'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * 요청 검토 다이얼로그.
 *
 * 계획은 서버가 **지금** 계산해 내려준 것이다(조직 화면에는 프로젝트 모델 store가 없다).
 * 성공해도 resync를 부르지 않는다 — 그 프로젝트를 열고 있는 사용자에게는 승격 op가
 * 실시간 채널로 전파된다.
 */
function ReviewDialog({
  requestId, orgId, onClose,
}: { requestId: string; orgId: string; onClose: () => void }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState('')

  const detail = useQuery(trpc.promotion.get.queryOptions({ requestId }))
  const entries: PromoteEntry[] = detail.data?.entries ?? []
  const unavailable = detail.data?.unavailable ?? []

  useEffect(() => {
    // 기본 선택 규칙은 승격 탭과 같다 — name-match만 사람이 확인하도록 꺼 둔다.
    setSelected(initialSelection(entries))
  }, [detail.data])

  const resolve = useMutation(trpc.promotion.resolve.mutationOptions({
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: trpc.promotion.listForOrg.queryKey({ orgId, status: 'pending' }),
      })
      await queryClient.invalidateQueries({ queryKey: trpc.promotion.pendingCount.queryKey() })
      toast.success(result.status === 'rejected'
        ? '요청을 반려했습니다'
        : `추가 ${result.inserted}건 · 갱신 ${result.updated}건을 올렸습니다`
          + (result.skipped.length > 0
            ? ` — ${result.skipped.length}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
            : ''))
      onClose()
    },
    onError: (err) => toast.error(err.message),
  }))

  const submit = () => resolve.mutate({
    requestId,
    approve: entries
      .filter((entry) => selected.has(entry.entityId))
      .map((entry) => ({
        entityId: entry.entityId,
        expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId,
        expectedTargetVersion: entry.targetVersion,
      })),
    note,
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            승격 요청 검토 — {detail.data?.request.projectName ?? ''}
          </DialogTitle>
        </DialogHeader>
        {detail.isError && (
          <p role="alert" className="text-destructive">{detail.error.message}</p>
        )}
        <div className="grid max-h-[60vh] content-start gap-4 overflow-y-auto">
          {(detail.data?.request.note ?? '') !== '' && (
            <p className="text-sm text-muted-foreground">
              요청 메모: {detail.data!.request.note}
            </p>
          )}
          {unavailable.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {unavailable.length}건은 이미 반영됐거나 삭제되어 처리할 수 없습니다.
            </p>
          )}
          {entries.length === 0 && !detail.isPending && (
            <p className="text-sm text-muted-foreground">처리할 항목이 없습니다.</p>
          )}
          <PromoteEntryList
            entries={entries}
            selected={selected}
            onToggle={(entityId, on) => setSelected((prev) => {
              const next = new Set(prev)
              if (on) next.add(entityId)
              else next.delete(entityId)
              return next
            })}
            onSetAll={(status: PromoteStatus, on) => setSelected((prev) =>
              setAllForStatus(prev, entries, status, on))}
          />
        </div>
        <div className="grid gap-2 border-t pt-2">
          <Input placeholder="처리 메모 (선택)" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end">
            <Button type="button" disabled={resolve.isPending} onClick={submit}>
              {selected.size === 0 ? '반려' : `${selected.size}건 승격`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 조직 화면의 승격 요청 승인 목록. Org Owner/Admin에게만 보인다. */
export function PromotionRequestsSection({
  orgId, canManage,
}: { orgId: string; canManage: boolean }) {
  const trpc = useTRPC()
  const [reviewing, setReviewing] = useState<string | null>(null)
  const list = useQuery({
    ...trpc.promotion.listForOrg.queryOptions({ orgId, status: 'pending' }),
    enabled: canManage,
  })

  if (!canManage) return null

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">승격 요청</h2>
      {list.isError && <p role="alert" className="text-destructive">{list.error.message}</p>}
      {!list.isError && !list.isPending && (list.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">대기 중인 요청이 없습니다.</p>
      )}
      {(list.data ?? []).length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>프로젝트</TableHead>
                <TableHead>라이브러리</TableHead>
                <TableHead>요청자</TableHead>
                <TableHead>항목</TableHead>
                <TableHead>메모</TableHead>
                <TableHead className="text-right">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.projectName}</TableCell>
                  <TableCell>{row.libraryName}</TableCell>
                  <TableCell>{row.requesterName}</TableCell>
                  <TableCell>{row.itemCount}건</TableCell>
                  <TableCell className="text-muted-foreground">{row.note}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setReviewing(row.id)}>
                      검토
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {reviewing !== null && (
        <ReviewDialog requestId={reviewing} orgId={orgId} onClose={() => setReviewing(null)} />
      )}
    </section>
  )
}
```

> **구현자 주의:** `initialSelection`/`setAllForStatus`는 Task 5에서 이미 `readonly PromoteEntry[]`를 받도록 좁혀졌다. `PromotePlan`을 요구하면 Task 5가 덜 된 것이므로 **여기서 더미 객체로 감싸지 말고** Task 5 산출물을 확인해 보고하라.

- [ ] **Step 4: 조직 화면에 삽입**

`org-detail.tsx`의 `ResourceLibraryManager` 위에 넣는다.

```tsx
      {org && (
        <PromotionRequestsSection
          orgId={orgId}
          canManage={org.role === 'owner' || org.role === 'admin'}
        />
      )}
```

import: `import { PromotionRequestsSection } from '@/components/promotion-requests-section'`

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/components/promotion-requests-section.test.tsx
```
Expected: PASS (5건)

- [ ] **Step 6: 전체 웹 스위트 + typecheck**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 370 pass · EXIT=0 (362 + Step 0의 3건 + 섹션 5건)

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/components/promote-entry-list.test.tsx apps/web/src/components/promotion-requests-section.tsx apps/web/src/components/promotion-requests-section.test.tsx apps/web/src/pages/org-detail.tsx && git commit -m "$(cat <<'EOF'
feat(web): 조직 화면의 승격 요청 승인 목록

검토 다이얼로그는 서버가 지금 계산해 내려준 계획을 렌더한다 — 조직 화면에는 프로젝트
모델 store가 없다. 이미 반영됐거나 삭제된 항목은 unavailable로 따로 안내하고, 선택을
모두 풀면 버튼이 반려로 바뀐다. 성공해도 resync를 부르지 않는다(그 프로젝트를 열고 있는
사용자에게는 실시간 채널로 전파된다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 8: 대기 건수 배지

**목적:** §1.1대로 **큐를 성립시키는 전제**다. 이것이 없으면 직전 설계가 큐를 거부한 근거("아무도 안 보는 채 쌓인다")가 그대로 성립한다.

**Files:**
- Create: `apps/web/src/components/pending-promotions-badge.tsx`, `apps/web/src/components/pending-promotions-badge.test.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`, `apps/web/src/pages/home.tsx`, `apps/web/src/pages/home.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `promotion.pendingCount`
- Produces: `<PendingPromotionsBadge />`

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { MemoryRouter } from 'react-router'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { PendingPromotionsBadge } from './pending-promotions-badge'

function renderBadge(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <PendingPromotionsBadge />
        </TRPCProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PendingPromotionsBadge', () => {
  it('대기 건수가 0이면 아무것도 렌더하지 않는다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({ data: { total: 0, byOrg: [] } }) })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: /승격 요청/ })).toBeNull()
  })

  it('조직이 하나면 그 조직 화면으로 가는 링크를 낸다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({
      data: { total: 3, byOrg: [{ orgId: 'o1', count: 3 }] },
    }) })
    const link = await screen.findByRole('link', { name: /승격 요청 3건/ })
    expect(link.getAttribute('href')).toBe('/org/o1')
  })

  it('조직이 여럿이면 홈으로 보낸다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({
      data: { total: 5, byOrg: [{ orgId: 'o1', count: 3 }, { orgId: 'o2', count: 2 }] },
    }) })
    const link = await screen.findByRole('link', { name: /승격 요청 5건/ })
    expect(link.getAttribute('href')).toBe('/')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/components/pending-promotions-badge.test.tsx
```
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 컴포넌트 구현**

```tsx
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'

/**
 * 헤더의 대기 건수 배지.
 *
 * 이 도구에는 메일·푸시 인프라가 없어, 이 배지가 승인자에게 요청이 닿는 유일한 경로다
 * (설계 §1.1 — 배지가 없으면 요청이 아무도 안 보는 채 쌓인다). 전송은 tRPC 폴링이라
 * 새 인프라가 붙지 않는다.
 */
export function PendingPromotionsBadge() {
  const trpc = useTRPC()
  const pending = useQuery({
    ...trpc.promotion.pendingCount.queryOptions(),
    refetchInterval: 60_000,
  })
  const total = pending.data?.total ?? 0
  if (total === 0) return null

  const byOrg = pending.data?.byOrg ?? []
  const to = byOrg.length === 1 ? `/org/${byOrg[0]!.orgId}` : '/'

  return (
    <Link to={to} aria-label={`승격 요청 ${total}건 검토`}>
      <Badge variant="secondary" className="gap-1">
        <Inbox className="size-3.5" />
        승격 요청 {total}건
      </Badge>
    </Link>
  )
}
```

- [ ] **Step 4: 앱 셸에 삽입**

```tsx
import { PendingPromotionsBadge } from '@/components/pending-promotions-badge'
// …
          <div className="flex items-center gap-3">
            <PendingPromotionsBadge />
            {userMenu}
          </div>
```

기존의 `{userMenu}` 한 줄을 위 덩어리로 교체한다.

- [ ] **Step 5: 홈 조직 카드에 조직별 건수**

`home.tsx`의 `HomePage`에 쿼리를 더하고 카드에 배지를 넣는다.

```tsx
  const pending = useQuery(trpc.promotion.pendingCount.queryOptions())
  const pendingByOrg = new Map(
    (pending.data?.byOrg ?? []).map((row) => [row.orgId, row.count]),
  )
```

카드의 `{org.kind === 'personal' && <Badge variant="secondary">개인 공간</Badge>}` 뒤에 넣는다.

```tsx
                {(pendingByOrg.get(org.id) ?? 0) > 0 && (
                  <Badge variant="outline">승격 요청 {pendingByOrg.get(org.id)}건</Badge>
                )}
```

- [ ] **Step 6: 홈 테스트를 확장한다**

`home.test.tsx`의 기존 핸들러에 `promotion.pendingCount`를 더해야 한다(없으면 `no handler` 오류가 난다). **기존 테스트를 먼저 열어 핸들러 셋을 확인하고 전부에 추가하라.** 그리고 새 테스트 1건:

```tsx
  it('대기 요청이 있는 조직 카드에 건수를 보여준다', async () => {
    mockTrpcFetch({
      'auth.me': () => ({ data: { id: 'u1', name: '나', email: 'me@t.dev', role: 'user' } }),
      'org.list': () => ({ data: [{ id: 'o1', name: '팀', kind: 'team', role: 'owner' }] }),
      'promotion.pendingCount': () => ({ data: { total: 2, byOrg: [{ orgId: 'o1', count: 2 }] } }),
    })
    // … 기존 테스트와 같은 렌더 헬퍼 사용
    expect(await screen.findByText('승격 요청 2건')).toBeTruthy()
  })
```

> **구현자 주의:** `home.test.tsx`의 실제 렌더 헬퍼·핸들러 이름은 파일을 열어 확인하라. 위 `auth.me`/`org.list` 형태가 실제와 다르면 **실제에 맞추고 그 사실을 보고하라.**

- [ ] **Step 7: 테스트 통과 확인**

```bash
pnpm --filter @erdd/web exec vitest run src/components/pending-promotions-badge.test.tsx src/pages/home.test.tsx
```
Expected: PASS

- [ ] **Step 8: 전체 웹 스위트 + typecheck**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 371 pass · EXIT=0

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/components/pending-promotions-badge.tsx apps/web/src/components/pending-promotions-badge.test.tsx apps/web/src/components/app-shell.tsx apps/web/src/pages/home.tsx apps/web/src/pages/home.test.tsx && git commit -m "$(cat <<'EOF'
feat(web): 대기 중인 승격 요청 건수 배지

메일·푸시가 없는 이 도구에서 승인자에게 요청이 닿는 유일한 경로다 — 직전 설계가 큐를
거부한 근거를 무효화하는 부분이라 장식이 아니다. 헤더에 총계, 홈 조직 카드에 조직별
건수를 띄운다. 전송은 tRPC 폴링이라 새 인프라가 붙지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## Task 9: 문서 갱신 (컨트롤러가 직접 수행)

**Files:**
- Modify: `docs/01-concepts.md`, `docs/90-roadmap.md`, `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: `01-concepts.md` 4항을 고친다**

현재 문장("…요청·승인 큐는 두지 않는다.")을 아래로 바꾼다.

```
4. **승격(반대 방향)** — 프로젝트에서 다듬은 항목을 조직(또는 전역) 리소스로 올린다. 라이브러리에 쓰기 권한이 있는 사람(조직은 Org Owner/Admin, 전역은 서비스 관리자)은 프로젝트 화면에서 직접 승격한다. 권한이 없는 Editor는 **승격을 요청**하고, Org Owner/Admin이 조직 화면에서 항목 단위로 승인·반려한다(요청은 항목 묶음이며 한 번 처리하면 닫힌다). 승격하면 그 항목의 상류가 대상 라이브러리로 바뀐다(항목당 상류는 항상 하나다).
```

- [ ] **Step 2: `90-roadmap.md` Phase 2 항목에 요청 큐를 더한다**

공용 리소스 줄의 링크 목록에 `[요청 큐 설계](superpowers/specs/2026-08-04-promotion-request-queue-design.md)`를 추가한다.

- [ ] **Step 3: `HANDOFF.md` 갱신**

1. 헤더의 **최종 갱신 / main HEAD / 마이그레이션**(0011까지)
2. 1절 완료 표에 행 추가:
   ```
   | **승격 요청·승인 큐** | 라이브러리 쓰기 권한이 없는 Editor의 요청 경로. `promotion_requests`(op 로그 밖, 마이그 0011), 요청은 **엔티티 포인터만** 담고 승인 시 `planPromote`를 재계산한다. `resource.promote`의 트랜잭션 본문을 `services/promote.ts`(`runPromoteInTx`)로 추출해 승인이 같은 엔진을 타고, 요청 행 종결이 같은 `prepare` 훅에 들어가 함께 롤백된다. 조직 화면 승인 목록 + 헤더·홈 배지 ([설계](specs/2026-08-04-promotion-request-queue-design.md)) |
   ```
3. 테스트 기준선을 실제 측정값으로 갱신
4. **3.2b 절에 불변식 3개 추가:**
   - 승격의 유일한 엔진은 `runPromoteInTx`다. 세 번째 승격 경로를 만들면 이 함수를 거쳐야 하고, `prepare` 훅 밖에서 부르면 프로젝트 락 밖에서 라이브러리를 쓰게 된다
   - 요청은 포인터만 담는다. 요청 행에 payload를 넣으면 `origin.base` 규칙(§3.3)을 요청 시점 기준으로 다시 유도해야 하고, 요청 행이 모델과 별개의 진실 원본이 된다
   - `promotion_requests`에 `orgId` 컬럼을 두지 않는다(`resource_libraries.orgId` 조인). 생성이 `library.orgId === project.orgId`를 강제하므로 두 경로가 같은 값을 가리킨다
5. 6절 이월에서 **"요청·승인 큐 없음"을 제거**하고, 설계 §9의 새 한계를 "승격 요청 큐" 항목으로 추가. **여기에 한 줄을 더한다:**
   - **원자성(승격 실패 시 요청 행 롤백)을 실증하는 테스트가 없다.** `promotion_requests`가 `projectId`·`libraryId` 양쪽으로 cascade라 실패를 주입하려 프로젝트나 라이브러리를 지우면 요청 행도 함께 사라지고, `origin` 1필드 update뿐이라 `persistOps`를 깨뜨릴 자연스러운 지점도 없다. 보장은 "라이브러리 쓰기와 요청 종결이 단일 `prepare` 훅 안에 있다"는 코드 구조에서 온다 — **`resolve`를 두 트랜잭션으로 쪼개는 변경은 이 테스트 공백 때문에 조용히 통과한다.**
6. 7절 새 세션 프롬프트의 "다음 작업" 예시 갱신

- [ ] **Step 4: 커밋**

```bash
git add docs/01-concepts.md docs/90-roadmap.md docs/superpowers/HANDOFF.md && git commit -m "$(cat <<'EOF'
docs: 승격 요청·승인 큐를 기획·인계 문서에 반영한다

01-concepts 4항의 "요청·승인 큐는 두지 않는다"를 권한이 없으면 요청하는 흐름으로 고치고,
HANDOFF 3.2b에 새 불변식 3개(승격 엔진 단일화, 요청은 포인터만, orgId 비정규화 금지)를
남긴다. 6절 이월에서 "요청·승인 큐 없음"을 뺀다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)"
```

---

## 최종 체크포인트 (컨트롤러)

- [ ] **전체 스위트 — 루트 `pnpm verify`로 한 번에**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-promotion-queue
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm verify
```
Expected: typecheck EXIT=0 + core 453 · cli 114 · web 371 · server 129 (실제 수는 측정값으로 갱신)

- [ ] **최종 whole-branch 리뷰** — 프롬프트에 반드시 이 문장을 넣는다:
  > **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라."**
  >
  > 이번 사이클의 정답 후보: `runPromoteInTx`(`resource.promote` / `promotion.resolve`), `parsePayload`(`items.create`·`items.update` / `runPromoteInTx`), `mutateAndPublish`의 `prepare` 훅(승격 / 승인), `PromoteEntryList`(승격 탭 / 승인 다이얼로그), `initialSelection`·`setAllForStatus`(같은 두 곳).
  >
  > typecheck 주의(`-s`가 출력을 삼킨다)도 프롬프트에 함께 넣는다.

- [ ] **수정의 구분력을 컨트롤러가 직접 실증** — 각 파일을 수정 전 버전으로 되돌려 새 테스트가 실제로 실패하는지 확인한다.
  ```bash
  git show <base>:<path> > /tmp/x && cp /tmp/x <path>   # 테스트 → git checkout -- <path>
  ```
  되돌리기를 서브에이전트에게 시키면 워킹트리가 오염될 수 있다(실시간 사이클 전례).

- [ ] **브라우저 스모크** — 병합 후 최상위에서 컨트롤러가 수행
  - 띄우기 전 `lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`으로 좀비 프로세스를 확인해 `kill -9`
  - `127.0.0.1`로 접속(`localhost`는 IPv6로 풀린다), vite는 `cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort`
  - 새 프로시저가 붙었는지 `/trpc/promotion.pendingCount`가 404가 아니라 401을 주는 것으로 확증
  - 시나리오: Editor 계정으로 프로젝트에서 단어 2개 요청 → Owner 계정으로 조직 화면 배지 확인 → 검토 다이얼로그에서 1건만 승인 → 프로젝트에서 origin이 붙었는지, 라이브러리에 1건만 올라갔는지 확인

- [ ] **main 머지 + 브랜치·워크트리 정리**
  ```bash
  cd /Users/jang2162/IdeaProjects/ERDD
  git merge --no-ff feat/promotion-queue
  git worktree remove .worktrees/feat-promotion-queue
  git branch -d feat/promotion-queue
  ```
  머지 후 dev DB(`erdd`)에 마이그레이션 0011을 적용한다.

---

## 자체 검토 결과

**설계 대비 커버리지** — 설계의 절별로 대응 태스크를 확인했다.

| 설계 | 태스크 |
|---|---|
| §2.1 포인터 모델 | Task 2 (스키마 `entityIds`), Task 3 (`get`의 재계산) |
| §2.2 배지 | Task 8 |
| §2.3 조직 라이브러리만 | Task 2 (전역 400 / 남의 조직 403 테스트) |
| §2.4 묶음·1회 처리 | Task 4 (부분 승인 · CONFLICT 테스트) |
| §2.5 중복 허용 | 제약을 두지 않음 — Task 2 스키마에 유니크 인덱스 없음 |
| §3.1 상태 4종 | Task 2 (`cancelled`), Task 4 (`resolved`/`rejected`) |
| §3.2 `unavailable` | Task 3 (`get`), Task 7 (표시) |
| §3.3 같은 엔진 | Task 1 (추출), Task 4 (재사용) |
| §5.1 `runPromoteInTx` | Task 1 |
| §5.2 테이블 | Task 2 |
| §5.3 7개 프로시저 | Task 2 (3개) · Task 3 (3개) · Task 4 (1개) |
| §6.1 요청 모드 | Task 6 |
| §6.2 컴포넌트 추출 | Task 5 |
| §6.3 조직 섹션 | Task 7 |
| §6.4 배지 | Task 8 |
| §8 테스트 | Task 2·3·4(server) · 5·6·7·8(web) |

**계획 작성 중 코드로 확인해 확정한 것** (HANDOFF 5절: "계획에 쓴 테스트 기대값이 계획의 가장 약한 고리다"):

| 확인한 것 | 결과 | 계획에 반영 |
|---|---|---|
| 실시간 브로드캐스트 검증 선례 | `resource-promote.test.ts:310`에 `app.hub.subscribe(projectId, {userId, name, send})` 패턴 존재 | Task 4 Step 7을 골격이 아니라 **완성된 코드**로 채움 |
| `initialSelection`/`setAllForStatus`가 읽는 필드 | `plan.entries` **뿐** | Task 5에서 시그니처를 `readonly PromoteEntry[]`로 좁히고, Task 7의 더미 감싸기를 제거 |
| `promote-selection.test.ts` 존재 | 존재함 | Task 5의 `git mv`를 조건부에서 확정으로 |
| 원자성 테스트 실현 가능성 | **불가능** — `promotion_requests`가 `projectId`·`libraryId` 양쪽 cascade라 실패 주입 시 요청 행이 함께 사라진다 | Task 4 Step 6을 "락 안 확인이 승격보다 앞선다"로 교체하고, Task 9에서 이 공백을 이월에 명시 |

**의도적으로 구현자 판단에 넘긴 것:** Task 4 Step 1의 `skipped` 이유(`missing` vs `plan-changed`), Task 8 Step 6의 `home.test.tsx` 기존 핸들러 형태. 둘 다 실제 실행 결과로만 확정되며, **어긋나면 단언을 정정하고 보고하라**고 명시했다 — 이 리포에서 반복된 결함군이 "통과하지만 아무것도 검증하지 않는 테스트"이기 때문이다(HANDOFF 5절). 가짜 통과보다 부정적 보고가 낫다.

**타입 일관성** — `PromoteRequestEntry`(Task 1) → `promotion.resolve`의 `approve` 원소(Task 4) → 승인 다이얼로그가 만드는 객체(Task 7)가 같은 4필드(`entityId` / `expectedStatus` / `expectedTargetItemId` / `expectedTargetVersion`)로 이어진다. `PromoteEntryList`의 props(Task 5)를 Task 7이 그대로 쓴다.
