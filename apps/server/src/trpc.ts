import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const dbProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.db) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DB가 구성되지 않았습니다' })
  return next({ ctx: { ...ctx, db: ctx.db } })
})

/**
 * 세션 또는 토큰. CLI가 쓰는 프로시저만 이것을 쓴다.
 * 새 프로시저의 기본은 authedProcedure(세션 전용)여야 한다 — fail-closed.
 */
export const apiProcedure = dbProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

/**
 * 세션 전용. 액세스 토큰으로는 호출할 수 없다 — 유출된 토큰 하나가 계정 관리·
 * 비밀번호 변경까지 장악하는 것을 막는다.
 */
export const authedProcedure = apiProcedure.use(({ ctx, next }) => {
  if (ctx.authKind !== 'session') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '이 작업은 액세스 토큰으로 할 수 없습니다' })
  }
  return next()
})

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '관리자 권한이 필요합니다' })
  return next()
})
