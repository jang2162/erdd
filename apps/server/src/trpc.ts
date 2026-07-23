import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const dbProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.db) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DB가 구성되지 않았습니다' })
  return next({ ctx: { ...ctx, db: ctx.db } })
})

export const authedProcedure = dbProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '관리자 권한이 필요합니다' })
  return next()
})
