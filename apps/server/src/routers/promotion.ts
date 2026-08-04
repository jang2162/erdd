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

/** 요청 행 하나. 없으면 NOT_FOUND. */
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
