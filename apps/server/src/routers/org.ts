import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { members, organizations, users } from '../db/schema.js'
import { getOrgMember } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

async function requireOrgManager(
  db: Parameters<typeof getOrgMember>[0], orgId: string, userId: string,
) {
  const me = await getOrgMember(db, orgId, userId)
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 관리 권한이 없습니다' })
  }
  return me
}

async function countOwners(db: Parameters<typeof getOrgMember>[0], orgId: string) {
  const rows = await db.select({ id: members.id })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.role, 'owner')))
  return rows.length
}

export const orgRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const org = (
          await tx.insert(organizations)
            .values({ id: uuidv7(), name: input.name, kind: 'team' })
            .returning()
        )[0]!
        await tx.insert(members)
          .values({ id: uuidv7(), orgId: org.id, userId: ctx.user.id, role: 'owner' })
        return org
      }),
    ),

  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: organizations.id, name: organizations.name,
        kind: organizations.kind, role: members.role,
      })
      .from(members)
      .innerJoin(organizations, eq(members.orgId, organizations.id))
      .where(eq(members.userId, ctx.user.id))
      .orderBy(organizations.createdAt),
  ),

  members: router({
    list: authedProcedure
      .input(z.object({ orgId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
        if (!me) throw new TRPCError({ code: 'FORBIDDEN', message: '조직 멤버가 아닙니다' })
        return ctx.db
          .select({
            id: members.id, role: members.role,
            userId: users.id, email: users.email, name: users.name,
          })
          .from(members)
          .innerJoin(users, eq(members.userId, users.id))
          .where(eq(members.orgId, input.orgId))
          .orderBy(members.createdAt)
      }),

    add: authedProcedure
      .input(z.object({
        orgId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['admin', 'member']),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const org = (
          await ctx.db.select().from(organizations).where(eq(organizations.id, input.orgId))
        )[0]
        if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: '조직을 찾을 수 없습니다' })
        if (org.kind === 'personal') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '개인 조직에는 멤버를 추가할 수 없습니다' })
        }
        const user = (
          await ctx.db.select().from(users)
            .where(and(eq(users.email, input.email), eq(users.isActive, true)))
        )[0]
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '해당 이메일의 사용자가 없습니다' })
        const existing = await getOrgMember(ctx.db, input.orgId, user.id)
        if (existing) throw new TRPCError({ code: 'CONFLICT', message: '이미 조직 멤버입니다' })
        const created = (
          await ctx.db.insert(members)
            .values({ id: uuidv7(), orgId: input.orgId, userId: user.id, role: input.role })
            .returning()
        )[0]!
        return created
      }),

    setRole: authedProcedure
      .input(z.object({
        orgId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(['owner', 'admin', 'member']),
      }))
      .mutation(async ({ ctx, input }) => {
        const me = await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const target = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, input.orgId)))
        )[0]
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '멤버를 찾을 수 없습니다' })
        if ((target.role === 'owner' || input.role === 'owner') && me.role !== 'owner') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner 역할 변경은 Owner만 가능합니다' })
        }
        if (target.role === 'owner' && input.role !== 'owner' &&
            (await countOwners(ctx.db, input.orgId)) <= 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '마지막 Owner는 강등할 수 없습니다' })
        }
        await ctx.db.update(members).set({ role: input.role }).where(eq(members.id, target.id))
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ orgId: z.string().uuid(), memberId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const me = await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const target = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, input.orgId)))
        )[0]
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '멤버를 찾을 수 없습니다' })
        if (target.role === 'owner') {
          if (me.role !== 'owner') {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner 제거는 Owner만 가능합니다' })
          }
          if ((await countOwners(ctx.db, input.orgId)) <= 1) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '마지막 Owner는 제거할 수 없습니다' })
          }
        }
        await ctx.db.delete(members).where(eq(members.id, target.id))
        return { ok: true as const }
      }),
  }),
})
