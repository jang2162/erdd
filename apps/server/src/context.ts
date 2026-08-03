import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
// @fastify/cookie의 FastifyRequest/FastifyReply 앰비언트 타입 확장(cookies/setCookie/clearCookie)을
// 이 파일을 타입 전용으로 가져오는 모든 프로그램(apps/web 크로스 패키지 typecheck 포함)에 적용하기 위한 타입 전용 임포트.
import type {} from '@fastify/cookie'
import type { Db } from './db/client.js'
import type { RealtimeHub } from './services/realtime.js'
import { accessTokens, sessions, users } from './db/schema.js'
import { hashToken } from './auth/token.js'

export const SESSION_COOKIE = 'erdd_session'

export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'user' }
export type AuthKind = 'session' | 'token'

export async function createContext({
  req, res, db, hub,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
  hub: RealtimeHub
}) {
  let user: SessionUser | null = null
  let authKind: AuthKind | null = null

  const cookie = req.cookies[SESSION_COOKIE]
  if (db && cookie) {
    const rows = await db
      .select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, cookie))
    const row = rows[0]
    if (row && row.isActive && row.expiresAt > new Date()) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role }
      authKind = 'session'
    }
  }

  // 쿠키로 인증되지 않았을 때만 Bearer 토큰을 본다.
  if (db && user === null) {
    const header = req.headers['authorization']
    const plain = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : null
    if (plain) {
      // 해시를 인덱스로 조회하므로 상수시간 비교가 따로 필요 없다 —
      // DB가 돌려준 행이 곧 일치를 뜻한다.
      const rows = await db
        .select({
          tokenId: accessTokens.id, revokedAt: accessTokens.revokedAt,
          id: users.id, email: users.email, name: users.name,
          role: users.role, isActive: users.isActive,
        })
        .from(accessTokens)
        .innerJoin(users, eq(accessTokens.userId, users.id))
        .where(eq(accessTokens.tokenHash, hashToken(plain)))
      const row = rows[0]
      if (row && row.isActive && row.revokedAt === null) {
        user = { id: row.id, email: row.email, name: row.name, role: row.role }
        authKind = 'token'
        await db.update(accessTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(accessTokens.id, row.tokenId))
      }
    }
  }

  return { db, user, authKind, req, res, hub }
}
export type Context = Awaited<ReturnType<typeof createContext>>
