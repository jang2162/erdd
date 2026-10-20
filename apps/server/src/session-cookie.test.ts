import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED } from '@erdd/core'
import { DEFAULT_PORT, sessionCookieName } from './context.js'
import { buildServer } from './server.js'
import { resetDb } from './testing/db.js'
import { createAccount } from './services/accounts.js'

const url = process.env.DATABASE_URL

describe('sessionCookieName', () => {
  it('기본 포트와 포트를 모를 때는 erdd_session 이다 — 운영 배포의 기존 세션을 살린다', () => {
    expect(sessionCookieName()).toBe('erdd_session')
    expect(sessionCookieName(DEFAULT_PORT)).toBe('erdd_session')
  })

  it('그 밖의 포트는 이름에 포트를 붙인다 — 포트만 다른 두 서버가 서로의 세션을 덮지 않는다', () => {
    expect(sessionCookieName(3001)).toBe('erdd_session_3001')
    expect(sessionCookieName(3002)).not.toBe(sessionCookieName(3001))
  })
})

/** 소켓을 열고 닫힘 코드를 기다린다. 열린 채로 남으면(인증 통과) null. */
async function closeCodeOf(app: FastifyInstance, path: string, cookie: string) {
  let resolveClose: (code: number | null) => void = () => {}
  const closed = new Promise<number | null>((r) => (resolveClose = r))
  const socket = await app.injectWS(
    path,
    { headers: { cookie } },
    {
      onInit: (ws) => ws.on('close', (code: number) => resolveClose(code)),
    },
  )
  const timer = setTimeout(() => resolveClose(null), 2000)
  const code = await closed
  clearTimeout(timer)
  socket.terminate()
  return code
}

describe.skipIf(!url)('기본이 아닌 포트의 서버는 포트 붙은 쿠키 이름만 읽는다', () => {
  const PORT = 3002
  const NAME = `erdd_session_${PORT}`
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildServer({ databaseUrl: url, port: PORT })
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'u1@test.dev',
      name: '사용자1',
      password: 'password-1',
      role: 'user',
    })
  })

  async function login(): Promise<{ name: string; value: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/trpc/auth.login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'u1@test.dev', password: 'password-1' }),
    })
    expect(res.statusCode).toBe(200)
    const cookie = res.cookies.find((c) => c.name.startsWith('erdd_session'))
    if (!cookie) throw new Error('세션 쿠키 없음')
    return cookie
  }

  it('로그인은 포트 붙은 이름으로 쿠키를 심는다', async () => {
    expect((await login()).name).toBe(NAME)
  })

  it('auth.me 는 포트 붙은 이름만 세션으로 읽는다 — 기본 이름으로 보내면 401', async () => {
    const { value } = await login()
    const me = (cookies: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/trpc/auth.me', cookies })
    expect((await me({ [NAME]: value })).statusCode).toBe(200)
    expect((await me({ erdd_session: value })).statusCode).toBe(401)
  })

  it('logout 은 포트 붙은 이름의 쿠키를 지운다', async () => {
    const { value } = await login()
    const res = await app.inject({
      method: 'POST',
      url: '/trpc/auth.logout',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
      cookies: { [NAME]: value },
    })
    expect(res.statusCode).toBe(200)
    const cleared = res.cookies.find((c) => c.name === NAME)
    expect(cleared?.value).toBe('')
  })

  it('/ws 도 같은 이름을 읽는다 — 기본 이름이면 미인증으로 닫힌다', async () => {
    const { value } = await login()
    // 없는 프로젝트라 인증을 통과하면 FORBIDDEN, 쿠키를 못 읽으면 UNAUTHORIZED 로 닫힌다.
    const path = `/ws?projectId=${uuidv7()}`
    expect(await closeCodeOf(app, path, `${NAME}=${value}`)).toBe(WS_CLOSE_FORBIDDEN)
    expect(await closeCodeOf(app, path, `erdd_session=${value}`)).toBe(WS_CLOSE_UNAUTHORIZED)
  })
})
