import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
// @fastify/cookie의 FastifyRequest/FastifyReply 앰비언트 타입 확장(cookies/setCookie/clearCookie)을
// 이 파일을 타입 전용으로 가져오는 모든 프로그램(apps/web 크로스 패키지 typecheck 포함)에 적용하기 위한 타입 전용 임포트.
import type {} from '@fastify/cookie'
import type { Db } from './db/client.js'
import type { RealtimeHub } from './services/realtime.js'
import { sessions, users } from './db/schema.js'

export const SESSION_COOKIE = 'erdd_session'

export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'user' }

export async function createContext({
  req, res, db, hub,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
  hub: RealtimeHub
}) {
  let user: SessionUser | null = null
  const token = req.cookies[SESSION_COOKIE]
  if (db && token) {
    const rows = await db
      .select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, token))
    const row = rows[0]
    if (row && row.isActive && row.expiresAt > new Date()) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role }
    }
  }
  return { db, user, req, res, hub }
}
export type Context = Awaited<ReturnType<typeof createContext>>
