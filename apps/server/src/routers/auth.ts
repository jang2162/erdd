import { randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { sessions, users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { SESSION_COOKIE } from '../context.js'
import { authedProcedure, dbProcedure, router } from '../trpc.js'

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export const authRouter = router({
  login: dbProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = (await ctx.db.select().from(users).where(eq(users.email, input.email)))[0]
      const ok = user && user.isActive && (await verifyPassword(input.password, user.passwordHash))
      if (!ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await ctx.db.insert(sessions).values({ id: token, userId: user.id, expiresAt })
      ctx.res.setCookie(SESSION_COOKIE, token, {
        path: '/', httpOnly: true, sameSite: 'lax', expires: expiresAt,
        secure: process.env.NODE_ENV === 'production',
      })
      return { id: user.id, email: user.email, name: user.name, role: user.role }
    }),

  logout: dbProcedure.mutation(async ({ ctx }) => {
    const token = ctx.req.cookies[SESSION_COOKIE]
    if (token) await ctx.db.delete(sessions).where(eq(sessions.id, token))
    ctx.res.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true as const }
  }),

  me: authedProcedure.query(({ ctx }) => ctx.user),

  changePassword: authedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const user = (await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)))[0]
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '현재 비밀번호가 올바르지 않습니다' })
      }
      await ctx.db.update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, user.id))
      const token = ctx.req.cookies[SESSION_COOKIE]
      if (token) {
        await ctx.db.delete(sessions)
          .where(and(eq(sessions.userId, user.id), ne(sessions.id, token)))
      }
      return { ok: true as const }
    }),
})
