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
