import { and, desc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { createEmptyModel, diffModels, OpApplyError } from '@erdd/core'
import { snapshots } from '../db/schema.js'
import { loadProjectModel } from '../services/model-store.js'
import { currentSeq } from '../services/mutation.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
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
      const snap = (await ctx.db.select({ id: snapshots.id }).from(snapshots)
        .where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId))))[0]
      if (!snap) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
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
        return await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'system',
          // snap.model은 과거 스키마 버전의 jsonb일 수 있어 마이그레이션(예: 0004 domains 도입)
          // 이전 스냅샷에는 신규 컬렉션 키가 아예 없을 수 있다. diffModels가
          // ENTITY_KINDS 전체를 순회하며 각 컬렉션에 Object.entries를 호출하므로,
          // 누락된 키를 빈 레코드로 보충해 정규화한 뒤 target으로 넘긴다.
          deriveOps: (current) => diffModels(current, { ...createEmptyModel(), ...snap.model }),
          summary: `스냅샷 복원: ${snap.name}`,
        })
      } catch (err) {
        if (err instanceof OpApplyError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
    }),
})
