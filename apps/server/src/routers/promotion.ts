import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  MAX_LIBRARY_FILE_ITEMS, OpApplyError, diffModels, planPromote, type ProjectModel,
} from '@erdd/core'
import { members, projects, promotionRequests, resourceLibraries, users } from '../db/schema.js'
import { loadProjectModel } from '../services/model-store.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
import { requireProjectAccess } from '../services/perm.js'
import {
  emptyOutcome, loadLibraryItems, runPromoteInTx, type PromoteOutcome,
} from '../services/promote.js'
import {
  requireLibraryRead, requireLibraryWrite, requireScopeWrite,
} from '../services/resource-library.js'
import { apiProcedure, authedProcedure, router } from '../trpc.js'
import type { Db } from '../db/client.js'

/** 요청 행 하나. 없으면 NOT_FOUND. */
async function loadRequest(db: Db, requestId: string) {
  const row = (
    await db.select().from(promotionRequests).where(eq(promotionRequests.id, requestId))
  )[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다' })
  return row
}

/** 요청 시점이 아니라 **지금**의 계획을 계산한다(§2.1 — 요청은 포인터만 담는다). */
async function planFor(db: Db, projectId: string, libraryId: string) {
  const model = await loadProjectModel(db, projectId)
  const items = await loadLibraryItems(db, libraryId)
  return planPromote(model, libraryId, items)
}

export const promotionRouter = router({
  /**
   * 승격 요청 생성. 계획에 실제로 있는 entityId만 저장한다 — 검증 없이 받으면 아무 uuid나
   * 요청에 들어가고 승인 화면이 그것을 전부 unavailable로 띄운다.
   */
  // CLI(erdd dict)가 토큰으로 부른다 — guides/cli.md 「액세스 토큰 인증」.
  create: apiProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      libraryId: z.string().uuid(),
      // 요청은 엔티티 id 목록을 저장할 뿐이고 승인은 서버가 한 트랜잭션으로 반영하므로 모델 op 상한
      // (MAX_OPS_PER_MUTATION)과 무관하다. 나누지 않는다 — 요청을 쪼개면 승인자가 같은 요청을 여러 번
      // 검토한다. 상한은 라이브러리 파일 상한과 같은 공유 상수다(guides/shared-resources.md 「요청·승인 큐」).
      entityIds: z.array(z.string().uuid()).min(1).max(MAX_LIBRARY_FILE_ITEMS),
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

      const plan = await planFor(ctx.db, input.projectId, input.libraryId)
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
  // CLI(erdd dict)가 토큰으로 부른다 — guides/cli.md 「액세스 토큰 인증」.
  listForProject: apiProcedure
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
      // 싼 사전 거르기 — 권위 있는 판정은 아래 UPDATE의 status 조건이다.
      if (request.status !== 'pending') {
        throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
      }
      // where에 status='pending'을 함께 건다. 이것이 없으면 위 읽기와 이 쓰기 사이에 resolve가
      // 끼어들었을 때 그 승인 결과(status·resolvedBy·approvedEntityIds)를 통째로 덮어써,
      // 라이브러리에는 항목이 올라갔는데 요청 행은 "취소됨"인 자기모순 상태가 된다.
      const cancelled = await ctx.db.update(promotionRequests).set({
        // 취소도 처리의 일종이라 같은 칸을 쓴다 — resolvedBy는 취소자다.
        status: 'cancelled', resolvedBy: ctx.user.id, resolvedAt: new Date(), updatedAt: new Date(),
      }).where(and(
        eq(promotionRequests.id, input.requestId),
        eq(promotionRequests.status, 'pending'),
      )).returning({ id: promotionRequests.id })
      if (cancelled.length === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: '이미 처리된 요청입니다' })
      }
      return { ok: true as const }
    }),

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
      })).max(MAX_LIBRARY_FILE_ITEMS),
      note: z.string().max(500).default(''),
    }))
    .mutation(async ({ ctx, input }) => {
      const request = await loadRequest(ctx.db, input.requestId)
      await requireLibraryWrite(ctx.db, request.libraryId, ctx.user)
      // 이 게이트는 다중 방어다 — 거부로 도달할 수 있는 호출자를 구성할 수 없다.
      // 위 requireLibraryWrite가 org 라이브러리에 대해 그 조직의 owner/admin을 요구하고,
      // create가 library.orgId === project.orgId를 강제하며 전역 라이브러리 요청은 400으로
      // 막으므로, 여기 닿은 사용자는 그 프로젝트 조직의 owner/admin이고 canEdit도 참이다.
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
          // 실제 승격 건수(outcome.inserted+updated)는 쓸 수 없다 — summary는 문자열 값이라
          // 이 호출 시점에 확정되는데 outcome은 prepare 훅이 돈 뒤에야 채워진다. 호출 시점에
          // 아는 값으로 적는다: 요청 전체와 승인자가 고른 건수다(실제 승격은 skip으로 더 적을 수 있다).
          summary: `승격 요청 승인 — 요청 ${request.entityIds.length}건 중 ${input.approve.length}건 승인`,
        })
        return { status: 'resolved' as const, seq, ...outcome }
      } catch (err) {
        if (err instanceof OpApplyError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
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
})
