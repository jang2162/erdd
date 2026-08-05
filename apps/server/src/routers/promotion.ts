import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { MAX_OPS_PER_MUTATION, planPromote } from '@erdd/core'
import { members, projects, promotionRequests, resourceLibraries, users } from '../db/schema.js'
import { loadProjectModel } from '../services/model-store.js'
import { requireProjectAccess } from '../services/perm.js'
import { loadLibraryItems } from '../services/promote.js'
import {
  requireLibraryRead, requireLibraryWrite, requireScopeWrite,
} from '../services/resource-library.js'
import { authedProcedure, router } from '../trpc.js'
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
})
