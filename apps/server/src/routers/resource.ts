import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, isNull, or, type SQL } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { deepEqual, RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, type ResourceKind } from '@erdd/core'
import type { Db } from '../db/client.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { requireProjectAccess } from '../services/perm.js'
import {
  requireLibraryRead, requireLibraryWrite, requireScopeRead, requireScopeWrite,
} from '../services/resource-library.js'
import { authedProcedure, router } from '../trpc.js'

const KindEnum = z.enum(RESOURCE_KINDS)

function parsePayload(kind: ResourceKind, payload: unknown): Record<string, unknown> {
  const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(payload)
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `항목 형식 오류 — ${parsed.error.message}` })
  }
  return parsed.data as Record<string, unknown>
}

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
        return listWithCounts(ctx.db, or(
          and(eq(resourceLibraries.scope, 'global'), isNull(resourceLibraries.orgId)),
          eq(resourceLibraries.orgId, access.project.orgId),
        ))
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
})
