import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { DIALECTS } from '@erdd/core'
import { members, projectMembers, projects, users } from '../db/schema.js'
import { getOrgMember, getProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

const dialectSchema = z.array(z.enum(DIALECTS)).min(1)

async function requireAccess(
  db: Parameters<typeof getProjectAccess>[0], projectId: string, userId: string,
  level: 'view' | 'manage',
) {
  const access = await getProjectAccess(db, projectId, userId)
  if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  const allowed = level === 'view' ? access.canView : access.canManage
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 접근 권한이 없습니다' })
  return access
}

export const projectRouter = router({
  create: authedProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().default(''),
      dialects: dialectSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
      if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 생성 권한이 없습니다' })
      }
      return ctx.db.transaction(async (tx) => {
        const project = (
          await tx.insert(projects).values({
            id: uuidv7(), orgId: input.orgId, name: input.name,
            description: input.description, dialects: input.dialects,
          }).returning()
        )[0]!
        await tx.insert(projectMembers).values({
          id: uuidv7(), projectId: project.id, memberId: me.id, role: 'admin',
        })
        return project
      })
    }),

  list: authedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
      if (!me) throw new TRPCError({ code: 'FORBIDDEN', message: '조직 멤버가 아닙니다' })
      if (me.role === 'owner' || me.role === 'admin') {
        return ctx.db.select().from(projects)
          .where(eq(projects.orgId, input.orgId)).orderBy(projects.createdAt)
      }
      return ctx.db.select({
        id: projects.id, orgId: projects.orgId, name: projects.name,
        description: projects.description, dialects: projects.dialects,
        createdAt: projects.createdAt,
      })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projectMembers.memberId, me.id), eq(projects.orgId, input.orgId)))
        .orderBy(projects.createdAt)
    }),

  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = await requireAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      return {
        ...access.project,
        myRole: access.projectRole ?? null,
        myOrgRole: access.orgRole ?? null,
      }
    }),

  update: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      dialects: dialectSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      const { projectId, ...patch } = input
      if (Object.keys(patch).length === 0) return { ok: true as const }
      await ctx.db.update(projects).set(patch).where(eq(projects.id, projectId))
      return { ok: true as const }
    }),

  delete: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      await ctx.db.delete(projects).where(eq(projects.id, input.projectId))
      return { ok: true as const }
    }),

  members: router({
    list: authedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireAccess(ctx.db, input.projectId, ctx.user.id, 'view')
        return ctx.db.select({
          id: projectMembers.id, role: projectMembers.role,
          memberId: members.id, email: users.email, name: users.name,
        })
          .from(projectMembers)
          .innerJoin(members, eq(projectMembers.memberId, members.id))
          .innerJoin(users, eq(members.userId, users.id))
          .where(eq(projectMembers.projectId, input.projectId))
          .orderBy(projectMembers.createdAt)
      }),

    add: authedProcedure
      .input(z.object({
        projectId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(['admin', 'editor', 'viewer']),
      }))
      .mutation(async ({ ctx, input }) => {
        const access = await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
        const orgMember = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, access.project.orgId)))
        )[0]
        if (!orgMember) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '조직 멤버를 찾을 수 없습니다' })
        }
        const existing = (
          await ctx.db.select().from(projectMembers)
            .where(and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.memberId, input.memberId),
            ))
        )[0]
        if (existing) throw new TRPCError({ code: 'CONFLICT', message: '이미 프로젝트 멤버입니다' })
        await ctx.db.insert(projectMembers).values({
          id: uuidv7(), projectId: input.projectId, memberId: input.memberId, role: input.role,
        })
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ projectId: z.string().uuid(), projectMemberId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
        await ctx.db.delete(projectMembers).where(and(
          eq(projectMembers.id, input.projectMemberId),
          eq(projectMembers.projectId, input.projectId),
        ))
        return { ok: true as const }
      }),
  }),
})
