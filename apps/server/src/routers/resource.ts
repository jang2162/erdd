import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, isNull, or, type SQL } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  deepEqual, diffModels, MAX_OPS_PER_MUTATION, OpApplyError,
  RESOURCE_KINDS, type ProjectModel,
} from '@erdd/core'
import type { Db } from '../db/client.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { requireProjectAccess } from '../services/perm.js'
import {
  parsePayload, requireLibraryRead, requireLibraryWrite, requireScopeRead, requireScopeWrite,
} from '../services/resource-library.js'
import { emptyOutcome, runPromoteInTx } from '../services/promote.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
import { authedProcedure, router } from '../trpc.js'

const KindEnum = z.enum(RESOURCE_KINDS)

/** 라이브러리 목록 + 항목 수. where 조건은 호출부가 만든다. */
async function listWithCounts(db: Db, where: SQL | undefined) {
  const rows = await db
    .select({
      id: resourceLibraries.id, scope: resourceLibraries.scope, orgId: resourceLibraries.orgId,
      name: resourceLibraries.name, description: resourceLibraries.description,
      updatedAt: resourceLibraries.updatedAt, itemCount: count(resourceItems.id),
    })
    .from(resourceLibraries)
    .leftJoin(resourceItems, eq(resourceItems.libraryId, resourceLibraries.id))
    .where(where)
    .groupBy(resourceLibraries.id)
    .orderBy(asc(resourceLibraries.createdAt))
  return rows
}

export const resourceRouter = router({
  library: router({
    list: authedProcedure
      .input(z.object({ scope: z.enum(['global', 'org']), orgId: z.string().uuid().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.scope === 'org' && !input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
        }
        await requireScopeRead(ctx.db, input.scope, input.orgId ?? null, ctx.user)
        const where = input.scope === 'global'
          ? eq(resourceLibraries.scope, 'global')
          : and(eq(resourceLibraries.scope, 'org'), eq(resourceLibraries.orgId, input.orgId!))
        return listWithCounts(ctx.db, where)
      }),

    listForProject: authedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
        const rows = await listWithCounts(ctx.db, or(
          and(eq(resourceLibraries.scope, 'global'), isNull(resourceLibraries.orgId)),
          eq(resourceLibraries.orgId, access.project.orgId),
        ))
        // 클라가 역할 조합식을 재현하지 않도록 쓰기 가능 여부를 서버가 판정해 싣는다.
        // 목록의 조직 라이브러리는 전부 이 프로젝트의 조직 것이다.
        const isServiceAdmin = ctx.user.role === 'admin'
        const isOrgManager = access.orgRole === 'owner' || access.orgRole === 'admin'
        return rows.map((row) => ({
          ...row,
          canWrite: row.scope === 'global' ? isServiceAdmin : isOrgManager,
        }))
      }),

    create: authedProcedure
      .input(z.object({
        scope: z.enum(['global', 'org']),
        orgId: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).default(''),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.scope === 'org' && !input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
        }
        await requireScopeWrite(ctx.db, input.scope, input.orgId ?? null, ctx.user)
        return (await ctx.db.insert(resourceLibraries).values({
          id: uuidv7(), scope: input.scope,
          orgId: input.scope === 'org' ? input.orgId! : null,
          name: input.name, description: input.description,
        }).returning())[0]!
      }),

    update: authedProcedure
      .input(z.object({
        libraryId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        await ctx.db.update(resourceLibraries)
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            updatedAt: new Date(),
          })
          .where(eq(resourceLibraries.id, input.libraryId))
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ libraryId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        await ctx.db.delete(resourceLibraries).where(eq(resourceLibraries.id, input.libraryId))
        return { ok: true as const }
      }),
  }),

  items: router({
    list: authedProcedure
      .input(z.object({ libraryId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireLibraryRead(ctx.db, input.libraryId, ctx.user)
        return ctx.db
          .select({
            id: resourceItems.id, kind: resourceItems.kind,
            payload: resourceItems.payload, version: resourceItems.version,
          })
          .from(resourceItems)
          .where(eq(resourceItems.libraryId, input.libraryId))
          .orderBy(asc(resourceItems.createdAt))
      }),

    create: authedProcedure
      .input(z.object({
        libraryId: z.string().uuid(), kind: KindEnum, payload: z.unknown(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        const payload = parsePayload(input.kind, input.payload)
        const row = (await ctx.db.insert(resourceItems).values({
          id: uuidv7(), libraryId: input.libraryId, kind: input.kind, payload, version: 1,
        }).returning())[0]!
        await ctx.db.update(resourceLibraries).set({ updatedAt: new Date() })
          .where(eq(resourceLibraries.id, input.libraryId))
        return row
      }),

    update: authedProcedure
      .input(z.object({ itemId: z.string().uuid(), payload: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        const item = (
          await ctx.db.select().from(resourceItems).where(eq(resourceItems.id, input.itemId))
        )[0]
        if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '항목을 찾을 수 없습니다' })
        await requireLibraryWrite(ctx.db, item.libraryId, ctx.user)
        const payload = parsePayload(item.kind, input.payload)
        // 같은 값 저장이 전 프로젝트에 재동기화 알림을 뿌리지 않도록 실제 변경일 때만 올린다.
        if (deepEqual(item.payload, payload)) return { ok: true as const, version: item.version }
        const version = item.version + 1
        await ctx.db.update(resourceItems).set({ payload, version, updatedAt: new Date() })
          .where(eq(resourceItems.id, input.itemId))
        await ctx.db.update(resourceLibraries).set({ updatedAt: new Date() })
          .where(eq(resourceLibraries.id, item.libraryId))
        return { ok: true as const, version }
      }),

    remove: authedProcedure
      .input(z.object({ itemId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const item = (
          await ctx.db.select().from(resourceItems).where(eq(resourceItems.id, input.itemId))
        )[0]
        if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '항목을 찾을 수 없습니다' })
        await requireLibraryWrite(ctx.db, item.libraryId, ctx.user)
        await ctx.db.delete(resourceItems).where(eq(resourceItems.id, input.itemId))
        return { ok: true as const }
      }),
  }),

  /**
   * 프로젝트 사전 항목을 라이브러리로 올린다(fork의 반대 방향).
   *
   * 라이브러리 쓰기와 프로젝트 origin 갱신이 한 트랜잭션이다 — runMutation의 prepare 훅이
   * 프로젝트 행 락 안에서 돌고, 라이브러리 항목은 FOR UPDATE로 잠근 뒤 그 값으로 계획을
   * 세운다. 이 락이 보장하는 것은 "이미 존재하는 항목에 대한 갱신을 직렬화하고, 계획이 잠근
   * 행의 값과 항상 일치한다"까지다 — 두 가지 한계가 있다.
   * (1) READ COMMITTED에서 FOR UPDATE는 기존 행만 잠그고 INSERT는 막지 않으므로, 서로 다른
   *     두 프로젝트가 동시에 같은 라이브러리로 같은 이름의 신규 항목을 승격하면 동명 항목이
   *     두 개 생길 수 있다(버전 경합이 아니라 동시 삽입 경합).
   * (2) 데드락 경로가 원리상 없지는 않다 — 이 프로시저는 (라이브러리 항목 행들 →
   *     resourceLibraries.updatedAt 갱신) 순서로 잠그는데, library.remove는 반대로
   *     (resourceLibraries 행 → cascade로 지워지는 항목 행들) 순서로 잠근다. 두 트랜잭션이
   *     맞물리면 Postgres가 40P01로 한쪽을 중단시키며 끝난다 — 데이터 훼손은 없고
   *     재시도하면 된다. 드물고(같은 라이브러리를 지우는 동시에 승격) 안전하게 실패한다.
   *
   * payload는 클라에서 받지 않는다. 서버가 트랜잭션 안에서 모델을 다시 읽어 계획을
   * 재계산하고, 클라가 본 상태(상태·대상 항목·대상 버전)와 다른 항목만 건너뛴다.
   *
   * 본문은 `runPromoteInTx`에 있다.
   */
  promote: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      libraryId: z.string().uuid(),
      entries: z.array(z.object({
        entityId: z.string().uuid(),
        expectedStatus: z.enum(['new', 'update', 'name-match']),
        expectedTargetItemId: z.string().uuid().nullable(),
        expectedTargetVersion: z.number().int().nullable(),
      })).min(1).max(MAX_OPS_PER_MUTATION),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
      const library = await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
      // 전역은 서비스 관리자만 requireLibraryWrite를 통과한다. 조직은 반드시 이 프로젝트의
      // 조직이어야 한다 — 없으면 두 조직에 속한 사용자가 남의 조직으로 사전을 흘릴 수 있다.
      if (library.scope === 'org' && library.orgId !== access.project.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '이 프로젝트의 조직 라이브러리가 아닙니다' })
      }

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
        if (err instanceof OpApplyError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
      }
    }),
})
