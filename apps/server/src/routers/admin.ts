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
        const expiresAt = tokenExpiry('invitation')
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
            tokenHash: hash, expiresAt, createdBy: ctx.user.id,
          })
        })
        // 평문은 여기서만 나간다. 이후 조회할 방법은 없다 — 잃으면 재발급이다.
        // 만료 시각은 함께 준다 — 링크를 전달하는 관리자가 언제까지 유효한지 말할 수 있어야 한다.
        return { id, token: plain, expiresAt }
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
          await ctx.db.select({ id: users.id, isActive: users.isActive })
            .from(users).where(eq(users.id, input.userId))
        )[0]
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        // 비활성 계정에는 링크를 내지 않는다. 링크는 동작해 비밀번호를 실제로 바꾸지만 로그인은
        // isActive에서 막히므로, 관리자는 "재설정해 줬는데 왜 안 되지"를 겪고 원인이 어디에도
        // 나오지 않는다. 여기서 거절해야 다음 행동(활성화)이 화면에 보인다.
        if (!target.isActive) {
          throw new TRPCError({
            code: 'BAD_REQUEST', message: '비활성 계정입니다 — 먼저 활성화하세요',
          })
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

  /**
   * 관리자 초대(= `orgId`가 null인 초대) 전용 조회·취소.
   *
   * 조직 초대의 것(`invitation.listForOrg`·`invitation.revoke`)에 합치지 않는다 — **권한 축이
   * 다르다**(서비스 관리자 vs 그 조직의 매니저). 합치면 한 프로시저가 `orgId` 유무로 권한 판정을
   * 갈라야 하고, 그 분기는 "orgId를 빼면 관리자 검사로 넘어간다"가 되어 조직 매니저가 관리자
   * 초대를 건드릴 틈이 된다. 여기서는 두 프로시저 모두 자격이 하나(admin)다.
   */
  invitations: router({
    /** 평문 토큰도 해시도 나가지 않는다 — 링크를 잃으면 조회가 아니라 재발급이다. */
    list: adminProcedure.query(({ ctx }) =>
      ctx.db
        .select({
          id: invitations.id, email: invitations.email, userRole: invitations.userRole,
          expiresAt: invitations.expiresAt, usedAt: invitations.usedAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(isNull(invitations.orgId))
        .orderBy(invitations.createdAt),
    ),

    revoke: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // 조건부 UPDATE다 — 이미 사용된 초대를 되살리지 않고, 조직 초대(orgId 있음)도 건드리지
        // 못한다. 잘못된 주소로 나간 링크를 7일 내내 죽일 수 없으면 안 된다(설계 3.2 "취소: 가능").
        const revoked = await ctx.db.update(invitations)
          .set({ expiresAt: new Date() })
          .where(and(
            eq(invitations.id, input.id),
            isNull(invitations.orgId),
            isNull(invitations.usedAt),
          ))
          .returning({ id: invitations.id })
        if (revoked.length === 0) {
          throw new TRPCError({ code: 'CONFLICT', message: '이미 사용되었거나 없는 초대입니다' })
        }
        return { ok: true as const }
      }),
  }),
})
