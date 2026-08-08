import { randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { accessTokens, passwordResetTokens, sessions, users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { generateToken, hashToken } from '../auth/token.js'
import { normalizeEmail } from '../services/accounts.js'
import { LinkDeadError, assertLive } from '../services/one-time-token.js'
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

  /**
   * 공개(세션 불필요). 유효한 토큰이 유일한 자격이고, 토큰은 해시로만 조회되어 열거할 수 없다.
   * 비밀번호 교체 · 토큰 소비 · **그 사용자의 세션 전부 삭제**가 한 트랜잭션이다 —
   * 비밀번호만 바뀌고 세션이 남으면 링크를 주운 사람의 로그인 상태가 그대로 살아 있다.
   *
   * scrypt는 트랜잭션을 열기 **전에** 돌린다. 수십~수백 ms 동안 커넥션을 잡고 있지 않기 위해서다.
   */
  resetPassword: dbProcedure
    .input(z.object({ token: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.newPassword)
      return ctx.db.transaction(async (tx) => {
        const row = (
          await tx.select().from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, hashToken(input.token)))
        )[0]
        // 없는 토큰과 기한이 지난 토큰을 같은 문구로 거절한다 — 갈리면 임의 토큰을 던져
        // "그 링크가 존재하는가"를 물을 수 있게 된다(존재 오라클).
        if (!row) throw new LinkDeadError({ code: 'BAD_REQUEST', message: '기한이 지난 링크입니다' })
        assertLive(row)
        await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
        const used = await tx.update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(and(
            eq(passwordResetTokens.id, row.id),
            isNull(passwordResetTokens.usedAt),
          ))
          .returning({ id: passwordResetTokens.id })
        // 같은 토큰으로 동시에 들어온 두 요청 중 하나만 소비한다.
        if (used.length === 0) {
          throw new LinkDeadError({ code: 'BAD_REQUEST', message: '이미 사용된 링크입니다' })
        }
        await tx.delete(sessions).where(eq(sessions.userId, row.userId))
        return { ok: true as const }
      })
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
