import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { invitations, passwordResetTokens, sessions, users } from '../db/schema.js'
import { normalizeEmail } from '../services/accounts.js'
import { issueToken, tokenExpiry } from '../services/one-time-token.js'
import { adminProcedure, router } from '../trpc.js'

export const adminRouter = router({
  users: router({
    list: adminProcedure.query(({ ctx }) =>
      ctx.db.select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, createdAt: users.createdAt,
      }).from(users).orderBy(users.createdAt),
    ),

    /**
     * 계정을 만들지 않고 **초대만** 만든다. 비밀번호는 본인이 수락 화면에서 정하므로
     * 관리자 손을 거치지 않는다.
     *
     * `orgId`는 null이다 — 사람을 시스템에 넣는 것과 조직에 넣는 것은 별개 행위이고,
     * 조직을 필수로 하면 "아직 소속이 정해지지 않은 사람"을 표현할 수 없다.
     * 서비스 역할은 초대 행에 담긴다 — 수락자가 스스로 admin이 될 수 있으면 안 된다.
     */
    invite: adminProcedure
      .input(z.object({
        email: z.string().email(),
        role: z.enum(['admin', 'user']).default('user'),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = normalizeEmail(input.email)
        const existing = (
          await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email))
        )[0]
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: '이미 등록된 이메일입니다' })
        }
        const { plain, hash } = issueToken('invitation')
        const id = uuidv7()
        await ctx.db.transaction(async (tx) => {
          // 재발급은 이전 링크를 죽인다. 두 링크가 동시에 살아 있으면 첫 것이 어디로 갔는지
          // 아무도 모른다. 조직 초대(orgId 있음)는 별개 묶음이라 건드리지 않는다.
          await tx.update(invitations)
            .set({ expiresAt: new Date() })
            .where(and(
              eq(invitations.email, email),
              isNull(invitations.orgId),
              isNull(invitations.usedAt),
            ))
          await tx.insert(invitations).values({
            id, email, orgId: null, orgRole: null, userRole: input.role,
            tokenHash: hash, expiresAt: tokenExpiry('invitation'), createdBy: ctx.user.id,
          })
        })
        // 평문은 여기서만 나간다. 이후 조회할 방법은 없다 — 잃으면 재발급이다.
        return { id, token: plain }
      }),

    /**
     * 비밀번호 재설정 **링크만** 발급한다. 비밀번호를 바꾸지 않고 **세션도 죽이지 않는다** —
     * 링크를 만들었을 뿐 비밀번호는 아직 그대로이고, 여기서 세션을 지우면 링크를 받지도 못한
     * 사용자가 이유도 모른 채 로그아웃된다. 세션 삭제는 auth.resetPassword 성공 시점이다.
     */
    resetLink: adminProcedure
      .input(z.object({ userId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const target = (
          await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, input.userId))
        )[0]
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        const { plain, hash } = issueToken('reset')
        const id = uuidv7()
        await ctx.db.transaction(async (tx) => {
          // 재발급은 그 사용자의 이전 미사용 토큰을 죽인다(초대와 같은 규칙).
          await tx.update(passwordResetTokens)
            .set({ expiresAt: new Date() })
            .where(and(
              eq(passwordResetTokens.userId, input.userId),
              isNull(passwordResetTokens.usedAt),
            ))
          await tx.insert(passwordResetTokens).values({
            id, userId: input.userId, tokenHash: hash,
            expiresAt: tokenExpiry('reset'), createdBy: ctx.user.id,
          })
        })
        return { id, token: plain }
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
