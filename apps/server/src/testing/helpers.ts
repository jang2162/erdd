import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildServer({ databaseUrl: process.env.DATABASE_URL })
  await app.ready()
  return app
}

/** 로그인해 세션 쿠키 값을 반환한다. */
export async function loginAs(
  app: FastifyInstance, email: string, password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/trpc/auth.login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  const cookie = res.cookies.find((c) => c.name === 'erdd_session')
  if (!cookie) throw new Error('세션 쿠키 없음')
  return cookie.value
}
