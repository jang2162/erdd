import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import type { DbOrTx } from '../db/client.js'
import { invitations, members, organizations, users } from '../db/schema.js'
import { hashToken } from '../auth/token.js'
import { createAccount, normalizeEmail } from '../services/accounts.js'
import { assertLive, issueToken, tokenExpiry } from '../services/one-time-token.js'
import { requireOrgManager } from '../services/perm.js'
import { authedProcedure, dbProcedure, router } from '../trpc.js'

/**
 * 토큰으로 살아 있는 초대를 찾는다. **없는 토큰과 기한이 지난 토큰을 같은 문구로 거절한다** —
 * 문구가 갈리면 임의 토큰을 던져 "그 초대가 존재하는가"를 물을 수 있게 된다(존재 오라클).
 */
async function findLiveInvitation(db: DbOrTx, token: string) {
  const row = (
    await db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token)))
  )[0]
  if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: '기한이 지난 링크입니다' })
  assertLive(row)
  return row
}

export const invitationRouter = router({
  create: authedProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      email: z.string().email(),
      orgRole: z.enum(['admin', 'member']),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
      const org = (
        await ctx.db.select().from(organizations).where(eq(organizations.id, input.orgId))
      )[0]
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: '조직을 찾을 수 없습니다' })
      if (org.kind === 'personal') {
        throw new TRPCError({ code: 'FORBIDDEN', message: '개인 조직에는 초대를 만들 수 없습니다' })
      }
      const email = normalizeEmail(input.email)
      const existing = (
        await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email))
      )[0]
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT', message: '이미 가입한 사용자입니다 — 멤버 추가를 쓰세요',
        })
      }
      const { plain, hash } = issueToken('invitation')
      const id = uuidv7()
      await ctx.db.transaction(async (tx) => {
        // 재발급은 이전 링크를 죽인다. 두 링크가 동시에 살아 있으면 첫 것이 어디로 갔는지
        // 아무도 모른다.
        await tx.update(invitations)
          .set({ expiresAt: new Date() })
          .where(and(
            eq(invitations.email, email),
            eq(invitations.orgId, input.orgId),
            isNull(invitations.usedAt),
          ))
        await tx.insert(invitations).values({
          id, email, orgId: input.orgId, orgRole: input.orgRole,
          // 서비스 역할은 조직 관리자가 정하지 않는다 — 조직 초대로 admin이 생기면 안 된다.
          userRole: 'user',
          tokenHash: hash, expiresAt: tokenExpiry('invitation'), createdBy: ctx.user.id,
        })
      })
      // 평문은 여기서만 나간다. 이후 조회할 방법은 없다 — 잃으면 재발급이다.
      return { id, token: plain }
    }),

  listForOrg: authedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
      // tokenHash는 select에 넣지 않는다 — 해시도 목록으로 나갈 이유가 없다.
      return ctx.db
        .select({
          id: invitations.id, email: invitations.email, orgRole: invitations.orgRole,
          expiresAt: invitations.expiresAt, usedAt: invitations.usedAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.orgId, input.orgId))
        .orderBy(invitations.createdAt)
    }),

  revoke: authedProcedure
    .input(z.object({ orgId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
      // 조건부 UPDATE다 — 이미 사용된 초대를 되살리거나 덮어쓰지 않고,
      // 다른 조직의 초대도 건드리지 못한다.
      const revoked = await ctx.db.update(invitations)
        .set({ expiresAt: new Date() })
        .where(and(
          eq(invitations.id, input.id),
          eq(invitations.orgId, input.orgId),
          isNull(invitations.usedAt),
        ))
        .returning({ id: invitations.id })
      if (revoked.length === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: '이미 사용되었거나 없는 초대입니다' })
      }
      return { ok: true as const }
    }),

  /**
   * 공개(세션 불필요). 유효한 토큰이 유일한 자격이고, 토큰은 해시로만 조회되어 열거할 수 없다.
   * query가 아니라 mutation인 것은 의도다 — query면 토큰이 URL 쿼리스트링에 실려
   * 접근 로그·리퍼러에 남는다.
   */
  peek: dbProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await findLiveInvitation(ctx.db, input.token)
      const org = inv.orgId === null ? undefined : (
        await ctx.db.select({ name: organizations.name })
          .from(organizations).where(eq(organizations.id, inv.orgId))
      )[0]
      // userRole은 내보내지 않는다 — 수락자가 알 이유가 없고 화면에도 쓰지 않는다.
      return { email: inv.email, orgName: org?.name ?? null, orgRole: inv.orgRole }
    }),

  /**
   * 공개(세션 불필요). 계정·개인조직·조직합류·초대소비가 **한 트랜잭션**이다 —
   * 중간에 끊기면 계정은 생겼는데 조직에 못 들어간 상태가 되고, 초대가 소비됐다면 복구 경로가 없다.
   */
  accept: dbProcedure
    .input(z.object({
      token: z.string(),
      name: z.string().min(1),
      password: z.string().min(8),
    }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const inv = await findLiveInvitation(tx, input.token)
        // 초대를 만든 뒤 수락 전에 그 이메일이 가입할 수 있다. 그때 초대는 소비되지 않고 남는다.
        const existing = (
          await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.email))
        )[0]
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: '이미 가입한 이메일입니다' })
        }
        // 서비스 역할은 초대 행이 정한다 — 입력으로 올릴 수 없다.
        const user = await createAccount(tx, {
          email: inv.email, name: input.name, password: input.password, role: inv.userRole,
        })
        if (inv.orgId !== null) {
          await tx.insert(members).values({
            id: uuidv7(), orgId: inv.orgId, userId: user.id,
            // orgId가 있으면 orgRole도 함께 저장된다(create가 둘을 같이 쓴다).
            // 그래도 비어 있다면 가장 낮은 권한으로 떨어뜨린다.
            role: inv.orgRole ?? 'member',
          })
        }
        const used = await tx.update(invitations)
          .set({ usedAt: new Date() })
          .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt)))
          .returning({ id: invitations.id })
        // 같은 토큰으로 동시에 들어온 두 요청 중 하나만 소비한다.
        if (used.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 사용된 링크입니다' })
        }
        return { ok: true as const, email: user.email }
      }),
    ),
})
