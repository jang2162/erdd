import { randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { accessTokens, sessions, users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { generateToken, hashToken } from '../auth/token.js'
import { normalizeEmail } from '../services/accounts.js'
import { SESSION_COOKIE } from '../context.js'
import { apiProcedure, authedProcedure, dbProcedure, router } from '../trpc.js'

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

// 계정 미존재/비활성 시에도 항상 scrypt 검증을 수행해 타이밍으로 계정 존재 여부가
// 누출되지 않도록 한다(top-level await, ESM에서 허용).
const DUMMY_HASH = await hashPassword('erdd-timing-dummy')

export const authRouter = router({
  login: dbProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = (
        await ctx.db.select().from(users).where(eq(users.email, normalizeEmail(input.email)))
      )[0]
      const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH)
      const ok = user !== undefined && user.isActive && valid
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

  me: apiProcedure.query(({ ctx }) => ctx.user),

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

  tokens: router({
    list: authedProcedure.query(async ({ ctx }) =>
      ctx.db
        .select({
          id: accessTokens.id, name: accessTokens.name,
          createdAt: accessTokens.createdAt, lastUsedAt: accessTokens.lastUsedAt,
        })
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, ctx.user.id), isNull(accessTokens.revokedAt)))
        .orderBy(accessTokens.createdAt),
    ),

    create: authedProcedure
      .input(z.object({ name: z.string().min(1).max(50) }))
      .mutation(async ({ ctx, input }) => {
        const plain = generateToken()
        await ctx.db.insert(accessTokens).values({
          id: uuidv7(), userId: ctx.user.id, name: input.name, tokenHash: hashToken(plain),
        })
        // 평문은 여기서만 나간다. 이후 조회할 방법은 없다.
        return { token: plain }
      }),

    revoke: authedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(accessTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(accessTokens.id, input.id), eq(accessTokens.userId, ctx.user.id)))
        return { ok: true as const }
      }),
  }),
})
