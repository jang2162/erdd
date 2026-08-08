import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'
import { LinkDeadError } from './services/one-time-token.js'

/**
 * 오류 응답에 `linkDead`를 **항상** 싣는다 — 일회용 링크 화면(초대 수락·비밀번호 재설정)이
 * "폼을 지워도 되는가"를 판정하는 값이다(설계 §6.1).
 *
 * 코드로는 갈릴 수 없다: zod 입력 검증 실패도 `BAD_REQUEST`이고(같은 토큰으로 다시 부르면
 * 200이다 — 링크는 살아 있다) 그것까지 종료성으로 보면 살아 있는 링크가 죽은 것으로 표시된다.
 * 그래서 `LinkDeadError`로 던진 것만 `true`다.
 *
 * **필드를 조건부로 넣지 않고 항상 넣는 것이 의도다.** 없을 수도 있는 필드면 화면이 `undefined`를
 * 만나 "모르겠다"를 스스로 해석해야 하고, 클라이언트 타입도 optional로 흐려진다.
 */
const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: { ...shape.data, linkDead: error instanceof LinkDeadError },
  }),
})

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
