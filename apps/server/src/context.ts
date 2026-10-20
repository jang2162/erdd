import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
// @fastify/cookie의 FastifyRequest/FastifyReply 앰비언트 타입 확장(cookies/setCookie/clearCookie)을
// 이 파일을 타입 전용으로 가져오는 모든 프로그램(apps/web 크로스 패키지 typecheck 포함)에 적용하기 위한 타입 전용 임포트.
import type {} from '@fastify/cookie'
import type { Db } from './db/client.js'
import type { RealtimeHub } from './services/realtime.js'
import { accessTokens, sessions, users } from './db/schema.js'
import { hashToken } from './auth/token.js'

/** 서버가 `PORT` 없이 뜰 때 listen 하는 포트. */
export const DEFAULT_PORT = 3000

/**
 * 세션 쿠키 이름. 기본 포트(또는 포트를 모를 때)는 `erdd_session`, 그 밖의 포트는 `erdd_session_<포트>`.
 * ⚠️ 쿠키는 포트를 구분하지 않는다 — 같은 호스트(`127.0.0.1`)에서 포트만 다른 두 서버(워크트리 트랙)가
 * 같은 이름을 쓰면 한쪽 로그인이 다른 쪽 세션을 덮어 끊는다. 기본 포트를 `erdd_session` 으로 두는
 * 것은 운영 배포(컨테이너 안에서 늘 3000)의 기존 세션을 그대로 살리기 위해서다.
 */
export function sessionCookieName(port?: number): string {
  return port === undefined || port === DEFAULT_PORT ? 'erdd_session' : `erdd_session_${port}`
}

export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'user' }
export type AuthKind = 'session' | 'token'

export async function createContext({
  req,
  res,
  db,
  hub,
  sessionCookie,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
  hub: RealtimeHub
  sessionCookie: string
}) {
  let user: SessionUser | null = null
  let authKind: AuthKind | null = null

  const cookie = req.cookies[sessionCookie]
  if (db && cookie) {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        expiresAt: sessions.expiresAt,
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
    const plain =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : null
    if (plain) {
      // 해시를 인덱스로 조회하므로 상수시간 비교가 따로 필요 없다 —
      // DB가 돌려준 행이 곧 일치를 뜻한다.
      const rows = await db
        .select({
          tokenId: accessTokens.id,
          revokedAt: accessTokens.revokedAt,
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
        })
        .from(accessTokens)
        .innerJoin(users, eq(accessTokens.userId, users.id))
        .where(eq(accessTokens.tokenHash, hashToken(plain)))
      const row = rows[0]
      if (row && row.isActive && row.revokedAt === null) {
        user = { id: row.id, email: row.email, name: row.name, role: row.role }
        authKind = 'token'
        await db
          .update(accessTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(accessTokens.id, row.tokenId))
      }
    }
  }

  return { db, user, authKind, req, res, hub, sessionCookie }
}
export type Context = Awaited<ReturnType<typeof createContext>>
