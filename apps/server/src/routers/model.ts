import { desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  applyOps, COLLECTION_BY_KIND, OpApplyError, OpParseError, parseOps,
  type EntityKind, type Op, type ProjectModel,
} from '@erdd/core'
import { projects, revisions } from '../db/schema.js'
import { loadProjectModel, persistOps } from '../services/model-store.js'
import { requireProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

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

async function currentSeq(db: Parameters<typeof loadProjectModel>[0], projectId: string) {
  const rows = await db.select({ seq: revisions.seq }).from(revisions)
    .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
  return rows[0]?.seq ?? 0
}

export const modelRouter = router({
  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const model = await loadProjectModel(ctx.db, input.projectId)
      const seq = await currentSeq(ctx.db, input.projectId)
      return { model, seq }
    }),

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
        if (err instanceof OpParseError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
      }

      return ctx.db.transaction(async (tx) => {
        // 프로젝트별 mutation 직렬화 — 같은 프로젝트의 동시 mutate는 여기서 대기한다.
        await tx.execute(sql`SELECT id FROM projects WHERE id = ${input.projectId} FOR UPDATE`)
        const exists = await tx.select({ id: projects.id }).from(projects)
          .where(eq(projects.id, input.projectId))
        if (exists.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
        }

        const model = await loadProjectModel(tx, input.projectId)
        const authoritative = withAuthoritativeHistory(model, ops)

        try {
          applyOps(model, authoritative)
        } catch (err) {
          if (err instanceof OpApplyError) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
          }
          throw err
        }

        await persistOps(tx, input.projectId, authoritative)
        const seq = (await currentSeq(tx, input.projectId)) + 1
        await tx.insert(revisions).values({
          id: uuidv7(),
          projectId: input.projectId,
          seq,
          actorUserId: ctx.user.id,
          source: 'web',
          ops: authoritative,
          summary: input.summary ?? summarizeOps(authoritative),
        })
        return { seq }
      })
    }),
})
