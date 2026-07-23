import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../auth/password.js'
import { createAccount } from '../services/accounts.js'
import { adminProcedure, router } from '../trpc.js'

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; cause?: { code?: unknown } }
  return e.code === '23505' || e.cause?.code === '23505'
}

export const adminRouter = router({
  users: router({
    list: adminProcedure.query(({ ctx }) =>
      ctx.db.select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, createdAt: users.createdAt,
      }).from(users).orderBy(users.createdAt),
    ),

    create: adminProcedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(1),
        initialPassword: z.string().min(8),
        role: z.enum(['admin', 'user']).default('user'),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createAccount(ctx.db, {
            email: input.email, name: input.name,
            password: input.initialPassword, role: input.role,
          })
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new TRPCError({ code: 'CONFLICT', message: '이미 등록된 이메일입니다' })
          }
          throw err
        }
      }),

    resetPassword: adminProcedure
      .input(z.object({ userId: z.string().uuid(), newPassword: z.string().min(8) }))
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.db.update(users)
          .set({ passwordHash: await hashPassword(input.newPassword) })
          .where(eq(users.id, input.userId))
          .returning({ id: users.id })
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId))
        return { ok: true as const }
      }),

    setActive: adminProcedure
      .input(z.object({ userId: z.string().uuid(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id && !input.isActive) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '자기 자신은 비활성화할 수 없습니다' })
        }
        const updated = await ctx.db.update(users)
          .set({ isActive: input.isActive })
          .where(eq(users.id, input.userId))
          .returning({ id: users.id })
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        if (!input.isActive) {
          await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId))
        }
        return { ok: true as const }
      }),
  }),
})
