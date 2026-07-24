import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { revisions, users } from '../db/schema.js'
import { requireProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

export const revisionRouter = router({
  list: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const where = input.cursor === undefined
        ? eq(revisions.projectId, input.projectId)
        : and(eq(revisions.projectId, input.projectId), lt(revisions.seq, input.cursor))
      const items = await ctx.db
        .select({
          seq: revisions.seq,
          summary: revisions.summary,
          source: revisions.source,
          ops: revisions.ops,
          createdAt: revisions.createdAt,
          actorName: users.name,
        })
        .from(revisions)
        .innerJoin(users, eq(revisions.actorUserId, users.id))
        .where(where)
        .orderBy(desc(revisions.seq))
        .limit(input.limit)
      const nextCursor = items.length === input.limit ? items.at(-1)!.seq : null
      return { items, nextCursor }
    }),
})
