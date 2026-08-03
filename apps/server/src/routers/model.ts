import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { MAX_OPS_PER_MUTATION, OpApplyError, OpParseError, parseOps, type Op } from '@erdd/core'
import { currentSeq } from '../services/mutation.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
import { loadProjectModel } from '../services/model-store.js'
import { requireProjectAccess } from '../services/perm.js'
import { apiProcedure, authedProcedure, router } from '../trpc.js'

export const modelRouter = router({
  get: apiProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const { model, seq } = await ctx.db.transaction(
        async (tx) => ({
          model: await loadProjectModel(tx, input.projectId),
          seq: await currentSeq(tx, input.projectId),
        }),
        { isolationLevel: 'repeatable read' },
      )
      return { model, seq }
    }),

  mutate: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      ops: z.array(z.unknown()).min(1).max(MAX_OPS_PER_MUTATION),
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
        return await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'web',
          deriveOps: () => ops,
          summary: input.summary,
        })
      } catch (err) {
        if (err instanceof OpApplyError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
    }),
})
