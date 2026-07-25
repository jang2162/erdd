# Phase 1 M7 — 스냅샷·Revision 이력 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 시점 프로젝트 모델 전체를 이름·설명과 함께 스냅샷으로 고정하고(생성·열람·삭제), 스냅샷 시점으로 복원하며(diff 기반, 그 자체가 되돌릴 수 있는 Revision), Revision 자동 이력을 시간순 화면으로 열람한다.

**Architecture:** 02-architecture의 "복원 = diff(스냅샷↔현재) → op 배치를 일반 mutation 파이프라인에 제출" 설계를 구현한다. 이를 위해 M3의 mutation 파이프라인(락·로드·권위기록·적용·영속·Revision)을 `services/mutation.ts`의 `runMutation`으로 **추출**하고, `model.mutate`와 새 `snapshot.restore`가 **동일 경로**를 공유한다(상태 변경은 이 파이프라인 밖에서 절대 일어나지 않는다는 규율 유지). 스냅샷은 `snapshots(project_id, name, description, revision_seq, model jsonb)`에 전체 직렬화로 저장한다(리플레이 없음). Revision 이력은 이미 있는 `revision.list`를 화면으로 소비한다.

**Tech Stack:** Fastify + tRPC + Drizzle + PostgreSQL, @erdd/core(`diffModels`), React 19 + Zustand.

## Global Constraints

- 데이터 상태 변경은 **오직** `runMutation` 파이프라인을 지난다. 복원도 예외 없이 이 경로로(diff→ops→apply→persist→Revision). 복원 Revision의 `source='system'`, summary=`스냅샷 복원: <이름>`.
- `runMutation` 추출은 **동작 보존**이다. `model.mutate`의 관측 가능한 동작(락 직렬화·권위 재기록·무결성 검사 실패 시 BAD_REQUEST·seq 발급·Revision 1건)이 리팩터 전과 동일해야 한다.
- 스냅샷 `model`은 `loadProjectModel`로 로드한 전체 `ProjectModel`을 그대로 저장(repeatable read 트랜잭션으로 model+seq 일관 스냅). 복원 시 `diffModels(currentModel, snapshotModel)`로 현재→스냅샷 op를 도출.
- 권한: 스냅샷 생성=`edit`(Editor+), 목록·열람=`view`, 복원·삭제=`manage`(Admin). `requireProjectAccess(db, projectId, userId, 'view'|'edit'|'manage')` 사용.
- 스냅샷/복원 후 클라이언트는 서버 상태를 재수화(복원은 새 seq를 만들므로 model.get 재조회).
- 마이그레이션은 `drizzle-kit generate`로 생성해 커밋한다(적용은 배포/스모크 시 `db:migrate`).
- diff/변경분 정의서, 스냅샷↔스냅샷 비교, 실시간 협업은 Phase 3(범위 밖). 스냅샷의 캔버스 읽기전용 렌더도 이번 범위 밖(열람=메타데이터+테이블 목록).
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖

- 스냅샷 diff·변경분 정의서(Phase 3), 스냅샷을 캔버스에 읽기전용으로 여는 뷰, 이력 항목의 op 상세 뷰(요약만), 이미지 내보내기(M8).

---

## File Structure

**server (신규):**
- `apps/server/src/services/mutation.ts` — `runMutation`(+ `summarizeOps`·`withAuthoritativeHistory`·`currentSeq` 이동).
- `apps/server/src/routers/snapshot.ts` — create/list/get/delete/restore.
- `apps/server/drizzle/0003_*.sql` — `db:generate` 산출(자동 이름).

**server (수정):**
- `apps/server/src/db/schema.ts` — `snapshots` 테이블.
- `apps/server/src/routers/model.ts` — mutate를 `runMutation`으로 재배선(summarizeOps 등 이동).
- `apps/server/src/router.ts` — `snapshot` 라우터 등록.

**web (신규):**
- `apps/web/src/editor/version-dialog.tsx` — "버전" 다이얼로그(스냅샷/이력 토글 + 스냅샷 섹션).
- `apps/web/src/editor/history-view.tsx` — 이력 섹션(다이얼로그 내부).
- 테스트: `version-dialog.test.tsx`.

**web (수정):**
- `apps/web/src/pages/project.tsx` — 헤더 "버전" 버튼.
- `apps/web/src/lib/trpc` 사용(기존).

---

## Task 1: 서버 mutation 파이프라인 추출(동작 보존)

**Files:**
- Create: `apps/server/src/services/mutation.ts`
- Modify: `apps/server/src/routers/model.ts`

**Interfaces:**
- Produces:
  ```ts
  type MutationTx = Parameters<typeof loadProjectModel>[0]
  export function summarizeOps(ops: readonly Op[]): string
  export async function currentSeq(tx: MutationTx, projectId: string): Promise<number>
  export async function runMutation(tx: MutationTx, args: {
    projectId: string
    actorUserId: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]
    summary?: string
  }): Promise<{ seq: number }>   // ops가 비면 현재 seq 반환(Revision 미기록)
  ```

### 설계 (읽고 시작)

- `runMutation`은 **트랜잭션 콜백 안에서** 호출된다(호출부가 `ctx.db.transaction(tx => runMutation(tx, ...))`). 내부: `SELECT id FROM projects WHERE id=? FOR UPDATE`(락·존재 확인) → `loadProjectModel` → `deriveOps(model)` → 빈 배열이면 현재 seq 반환(no-op) → `withAuthoritativeHistory` → `applyOps`(실패 시 `OpApplyError` throw) → `persistOps` → seq+1 → `revisions` insert.
- `applyOps`의 `OpApplyError`는 `runMutation`이 그대로 throw하고, **각 라우터 호출부가** 트랜잭션 바깥 try/catch에서 `BAD_REQUEST`로 매핑한다(기존 model.mutate가 tx 안에서 매핑하던 것과 롤백·응답 코드 관점에서 등가).
- `summarizeOps`·`withAuthoritativeHistory`·`currentSeq`를 model.ts에서 mutation.ts로 옮긴다. model.ts는 필요한 것을 import한다.
- `model.mutate`는 `parseOps`(+ OpParseError→BAD_REQUEST)를 그대로 라우터에 두고, 파이프라인만 `runMutation`에 위임한다(deriveOps=`() => ops`).

### Steps

- [ ] **Step 1: mutation.ts 생성** — model.ts의 파이프라인 로직 이동

```ts
import { desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { applyOps, COLLECTION_BY_KIND, type EntityKind, type Op, type ProjectModel } from '@erdd/core'
import { revisions } from '../db/schema.js'
import { loadProjectModel, persistOps } from './model-store.js'

type MutationTx = Parameters<typeof loadProjectModel>[0]

const KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계',
  index: '인덱스', note: '메모', tableGroup: '그룹',
}
const ACTION_LABEL = { create: '생성', update: '수정', delete: '삭제' } as const

export function summarizeOps(ops: readonly Op[]): string {
  const first = ops[0]!
  const head = `${KIND_LABEL[first.entity]} ${ACTION_LABEL[first.action]}`
  return ops.length === 1 ? head : `${head} 외 ${ops.length - 1}건`
}

/** update.from / delete.before를 서버의 현재 값으로 재기록한다(Revision 로그의 정확성 보장). */
function withAuthoritativeHistory(model: ProjectModel, ops: readonly Op[]): Op[] {
  return ops.map((op) => {
    const collection = model[COLLECTION_BY_KIND[op.entity]] as Record<string, Record<string, unknown>>
    const current = Object.hasOwn(collection, op.entityId) ? collection[op.entityId] : undefined
    if (op.action === 'update' && current) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const [prop, change] of Object.entries(op.changes)) {
        changes[prop] = { from: current[prop], to: change.to }
      }
      return { ...op, changes }
    }
    if (op.action === 'delete' && current) return { ...op, before: current }
    return op
  })
}

export async function currentSeq(tx: MutationTx, projectId: string): Promise<number> {
  const rows = await tx.select({ seq: revisions.seq }).from(revisions)
    .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
  return rows[0]?.seq ?? 0
}

/**
 * 단일 변경 경로. 트랜잭션 콜백 안에서 호출한다.
 * deriveOps가 빈 배열을 반환하면(변경 없음) Revision 없이 현재 seq를 반환한다.
 * applyOps의 OpApplyError는 그대로 throw하므로 호출부가 BAD_REQUEST로 매핑한다.
 */
export async function runMutation(
  tx: MutationTx,
  args: {
    projectId: string
    actorUserId: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]
    summary?: string
  },
): Promise<{ seq: number }> {
  const locked = await tx.execute(sql`SELECT id FROM projects WHERE id = ${args.projectId} FOR UPDATE`)
  if (locked.rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  }
  const model = await loadProjectModel(tx, args.projectId)
  const ops = args.deriveOps(model)
  const seqNow = await currentSeq(tx, args.projectId)
  if (ops.length === 0) return { seq: seqNow }
  const authoritative = withAuthoritativeHistory(model, ops)
  applyOps(model, authoritative) // OpApplyError → 호출부가 매핑
  await persistOps(tx, args.projectId, authoritative)
  const seq = seqNow + 1
  await tx.insert(revisions).values({
    id: uuidv7(),
    projectId: args.projectId,
    seq,
    actorUserId: args.actorUserId,
    source: args.source,
    ops: authoritative,
    summary: args.summary ?? summarizeOps(authoritative),
  })
  return { seq }
}
```

- [ ] **Step 2: model.ts 재배선** — 파이프라인 로직 제거, `runMutation` 위임

`model.ts`에서 `summarizeOps`·`withAuthoritativeHistory`·`currentSeq`·`KIND_LABEL`·`ACTION_LABEL` 정의를 제거하고 `mutation.ts`에서 import. `get`은 `currentSeq`를 mutation.ts에서 가져와 그대로 사용. `mutate`를 아래로 교체:

```ts
import { OpApplyError, OpParseError, parseOps, type Op } from '@erdd/core'
import { currentSeq, runMutation } from '../services/mutation.js'
// ... get은 currentSeq import만 바뀌고 로직 동일 ...

  mutate: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      ops: z.array(z.unknown()).min(1).max(500),
      summary: z.string().min(1).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
      let ops: Op[]
      try {
        ops = parseOps(input.ops)
      } catch (err) {
        if (err instanceof OpParseError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
      try {
        return await ctx.db.transaction((tx) => runMutation(tx, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          source: 'web',
          deriveOps: () => ops,
          summary: input.summary,
        }))
      } catch (err) {
        if (err instanceof OpApplyError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
    }),
```

`get`은 로직 변경 없이 `currentSeq` import만 mutation.ts로 바꾼다(기존 `loadProjectModel`+`currentSeq`를 repeatable read 트랜잭션으로 감싼 그대로).

- [ ] **Step 3: 검증** — `pnpm --filter @erdd/server typecheck` 클린. `pnpm --filter @erdd/server test`(DB 없으면 skip 유지, 회귀 없음). `pnpm --filter @erdd/web typecheck`(AppRouter 타입 변화 없음 — mutate 시그니처 동일).

- [ ] **Step 4: 커밋**

```bash
git add apps/server/src/services/mutation.ts apps/server/src/routers/model.ts
git commit -m "refactor(server): mutation 파이프라인을 runMutation 서비스로 추출(동작 보존)"
```

---

## Task 2: 스냅샷 테이블·라우터(생성·목록·열람·삭제·복원)

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/router.ts`
- Create: `apps/server/src/routers/snapshot.ts`, `apps/server/drizzle/0003_*.sql`(생성물)

**Interfaces (tRPC):**
- `snapshot.create({ projectId, name, description? })` → `{ id }` (edit)
- `snapshot.list({ projectId })` → `{ items: Array<{ id, name, description, revisionSeq, createdAt }> }` (view; model 제외)
- `snapshot.get({ projectId, snapshotId })` → `{ id, name, description, revisionSeq, createdAt, model }` (view)
- `snapshot.delete({ projectId, snapshotId })` → `{ ok: true }` (manage)
- `snapshot.restore({ projectId, snapshotId })` → `{ seq }` (manage)

### Steps

- [ ] **Step 1: schema.ts에 snapshots 테이블**

```ts
import type { Dialect, Op, ProjectModel } from '@erdd/core' // ProjectModel 추가
// ... 기존 테이블들 아래에:
export const snapshots = pgTable('snapshots', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  revisionSeq: integer('revision_seq').notNull(),
  model: jsonb('model').$type<ProjectModel>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: 마이그레이션 생성** — `pnpm --filter @erdd/server db:generate` → `drizzle/0003_*.sql` 생성 확인(snapshots CREATE TABLE 포함).

- [ ] **Step 3: snapshot.ts 라우터**

```ts
import { and, desc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { diffModels, OpApplyError } from '@erdd/core'
import { snapshots } from '../db/schema.js'
import { loadProjectModel } from '../services/model-store.js'
import { currentSeq, runMutation } from '../services/mutation.js'
import { requireProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

export const snapshotRouter = router({
  create: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(100),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
      const { model, seq } = await ctx.db.transaction(
        async (tx) => ({
          model: await loadProjectModel(tx, input.projectId),
          seq: await currentSeq(tx, input.projectId),
        }),
        { isolationLevel: 'repeatable read' },
      )
      const id = uuidv7()
      await ctx.db.insert(snapshots).values({
        id, projectId: input.projectId, name: input.name,
        description: input.description ?? '', revisionSeq: seq, model,
      })
      return { id }
    }),

  list: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const items = await ctx.db
        .select({
          id: snapshots.id, name: snapshots.name, description: snapshots.description,
          revisionSeq: snapshots.revisionSeq, createdAt: snapshots.createdAt,
        })
        .from(snapshots)
        .where(eq(snapshots.projectId, input.projectId))
        .orderBy(desc(snapshots.createdAt))
      return { items }
    }),

  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), snapshotId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const snap = (await ctx.db.select().from(snapshots)
        .where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId))))[0]
      if (!snap) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
      return snap
    }),

  delete: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), snapshotId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      await ctx.db.delete(snapshots)
        .where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId)))
      return { ok: true as const }
    }),

  restore: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), snapshotId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      const snap = (await ctx.db.select().from(snapshots)
        .where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId))))[0]
      if (!snap) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
      try {
        return await ctx.db.transaction((tx) => runMutation(tx, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          source: 'system',
          deriveOps: (current) => diffModels(current, snap.model),
          summary: `스냅샷 복원: ${snap.name}`,
        }))
      } catch (err) {
        if (err instanceof OpApplyError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
    }),
})
```

- [ ] **Step 4: router.ts 등록** — `import { snapshotRouter } from './routers/snapshot.js'` + `snapshot: snapshotRouter` 추가.

- [ ] **Step 5: 검증·커밋** — `pnpm --filter @erdd/server typecheck && pnpm --filter @erdd/web typecheck` 클린.

```bash
git add apps/server/src/db/schema.ts apps/server/src/routers/snapshot.ts apps/server/src/router.ts apps/server/drizzle
git commit -m "feat(server): 스냅샷 테이블·라우터 — 생성·목록·열람·삭제·복원(diff 파이프라인)"
```

---

## Task 3: 웹 버전 다이얼로그 — 스냅샷 섹션

**Files:**
- Create: `apps/web/src/editor/version-dialog.tsx`, `apps/web/src/editor/version-dialog.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: tRPC `snapshot.create/list/get/delete/restore`, `model.get`(복원 후 재수화), store `setLoaded`; shadcn `Dialog`.

### 설계 (읽고 시작)

- 헤더 "버전" 버튼 → 다이얼로그. 내부 상단에 토글 버튼 두 개(스냅샷 | 이력) — 로컬 state. Task 3은 **스냅샷 섹션**만, 이력 섹션은 Task 4(placeholder 자리만 둔다).
- 스냅샷 섹션:
  - 상단: 이름 입력 + "스냅샷 만들기" 버튼 → `snapshot.create` → 목록 무효화(`queryClient.invalidateQueries` for `snapshot.list`).
  - 목록: `snapshot.list` — 각 항목 이름·설명·`revisionSeq`·생성일 + "복원"·"삭제" 버튼. 항목 클릭 시 `snapshot.get`으로 테이블 개수·목록 요약을 펼쳐 보여준다(열람).
  - 복원: 확인(`window.confirm` 또는 인라인 확인) 후 `snapshot.restore` → 성공 시 `queryClient.fetchQuery(model.get)`로 새 상태를 받아 `setLoaded(model, seq, projectId)`로 에디터 재수화 + 다이얼로그 닫기 + 토스트.
  - 삭제: 확인 후 `snapshot.delete` → 목록 무효화.
- tRPC 훅은 `useTRPC()` + `@tanstack/react-query`(프로젝트의 기존 패턴 — org-detail/project 페이지 참고).

### Steps

- [ ] **Step 1: version-dialog.tsx** — 다이얼로그 + 스냅샷 섹션(생성/목록/열람/복원/삭제). 이력 토글은 자리만(빈 div 또는 "준비 중" — Task 4가 채움).
- [ ] **Step 2: project.tsx 헤더에 "버전" 버튼** — `{loaded && <VersionDialog projectId={projectId} />}`.
- [ ] **Step 3: version-dialog.test.tsx** — tRPC 목(기존 web 테스트의 `mockTrpcFetch` 패턴) 사용. 최소 2개: (a) 다이얼로그 열면 `snapshot.list` 결과가 렌더된다(목 1건), (b) "스냅샷 만들기" 클릭 시 `snapshot.create`가 호출되고 목록이 다시 조회된다(목 호출 assert). 복원 후 재수화까지는 목이 복잡하면 (a)(b)로 충분.
- [ ] **Step 4: 웹 테스트·타입체크·커밋**

```bash
git add apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx apps/web/src/pages/project.tsx
git commit -m "feat(web): 버전 다이얼로그 — 스냅샷 생성·열람·복원·삭제"
```

---

## Task 4: 웹 이력 섹션

**Files:**
- Create: `apps/web/src/editor/history-view.tsx`
- Modify: `apps/web/src/editor/version-dialog.tsx`(이력 토글에 연결), `apps/web/src/editor/version-dialog.test.tsx`(테스트 1개 추가)

**Interfaces:**
- Consumes: tRPC `revision.list({ projectId, cursor?, limit? })` → `{ items: [{ seq, summary, source, ops, createdAt, actorName }], nextCursor }`.

### 설계 (읽고 시작)

- 이력 섹션: `revision.list`를 시간순(최신 우선)으로 목록 렌더. 각 항목: seq, summary, actorName, source 배지(web/cli/system), 생성일. 페이지네이션은 "더 보기" 버튼(`nextCursor`가 있으면) 또는 첫 50건만(Phase 1 간소화 — nextCursor 있으면 "더 보기"). op 상세는 이번 범위 밖(요약만).
- `source` 배지: system(복원 등)은 구분되는 색.

### Steps

- [ ] **Step 1: history-view.tsx** — `revision.list` 목록 + "더 보기"(선택).
- [ ] **Step 2: version-dialog.tsx의 이력 토글에 `<HistoryView projectId={...} />` 연결.**
- [ ] **Step 3: version-dialog.test.tsx에 이력 테스트 1개** — 이력 토글 클릭 시 `revision.list` 결과(목 1건: summary·actorName)가 렌더된다.
- [ ] **Step 4: 웹 테스트·타입체크·커밋**

```bash
git add apps/web/src/editor/history-view.tsx apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx
git commit -m "feat(web): Revision 이력 화면 — 시간순 목록·작업자·유형 배지"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- `model.mutate`의 동작이 리팩터 전과 동일하다(락 직렬화·권위 재기록·무결성 실패 시 BAD_REQUEST·Revision 1건). 복원·mutate가 동일 `runMutation` 경로를 공유한다.
- 스냅샷 생성 시 현재 모델 전체 + 현재 seq가 저장된다. 목록/열람이 동작한다.
- 복원 시 `diffModels(현재, 스냅샷)` op가 일반 파이프라인으로 제출되어 프로젝트가 스냅샷 상태로 돌아가고, `source='system'` Revision 1건이 기록되며, 복원 자체를 다시 되돌릴 수 있다(undo 스택이 아니라 이력/재복원으로).
- 복원 후 에디터가 서버 상태로 재수화된다(새로고침 없이 반영).
- 스냅샷 삭제가 동작한다. 권한: 생성=Editor+, 복원·삭제=Admin.
- 이력 화면이 Revision을 시간순으로 보여준다(작업자·요약·source).
- 마이그레이션이 생성·커밋되고 스모크에서 적용된다.
- 전체 테스트(core+server+web) 통과, 타입체크 클린. (server 통합 테스트는 DB 게이팅으로 skip될 수 있음 — 컨트롤러 브라우저 스모크로 복원 end-to-end 확인.)

## 이월(후속)

스냅샷 diff·변경분 정의서(Phase 3), 스냅샷 캔버스 읽기전용 뷰, 이력 op 상세, 이력 필터(작업자/유형), 저정보 이동 배치 묶음(디바운스는 클라이언트 후속).
