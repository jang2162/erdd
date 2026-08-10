import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import {
  parseServerMessage, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, type ServerMessage,
} from '@erdd/core'
import { resetDb } from './testing/db.js'
import { createTestApp, loginAs } from './testing/helpers.js'
import { createAccount } from './services/accounts.js'
import { authorizeSocket } from './ws.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

function noteCreateOp() {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

/**
 * injectWS로 접속하되 리스너를 onInit에서 먼저 붙인다 — 서버가 열리자마자 보내는 ready나
 * 즉시 close를 놓치면 테스트가 통과할 수 없는 조건에서 영원히 기다리게 된다.
 * 도착한 프레임을 버퍼에 쌓아두므로 next()를 나중에 불러도 안전하다.
 */
async function connect(app: FastifyInstance, path: string, cookie?: string) {
  const frames: ServerMessage[] = []
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  let closeCode: number | null = null
  const closeWaiters: ((code: number) => void)[] = []

  const socket = await app.injectWS(path, cookie ? { headers: { cookie } } : {}, {
    onInit: (ws) => {
      ws.on('message', (data: unknown) => {
        const msg = parseServerMessage(String(data))
        if (!msg) return
        frames.push(msg)
        const i = waiters.findIndex((w) => w.match(msg))
        if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg)
      })
      ws.on('close', (code: number) => {
        closeCode = code
        closeWaiters.splice(0).forEach((r) => r(code))
      })
    },
  })

  return {
    socket,
    next: (match: (m: ServerMessage) => boolean, timeoutMs = 3000) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const hit = frames.find(match)
        if (hit) { resolve(hit); return }
        waiters.push({ match, resolve })
        setTimeout(
          () => reject(new Error(`타임아웃 — 받은 프레임: ${JSON.stringify(frames)}`)),
          timeoutMs,
        )
      }),
    closed: () => new Promise<number>((resolve) => {
      if (closeCode !== null) { resolve(closeCode); return }
      closeWaiters.push(resolve)
    }),
  }
}

/** 조건이 참이 될 때까지 짧은 간격으로 폴링한다(비동기 정리 타이밍을 기다릴 때 씀). */
async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('타임아웃 — 조건이 충족되지 않았다')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe.skipIf(!url)('ws', () => {
  let app: FastifyInstance
  let token: string
  let projectId: string
  let userId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const account = await createAccount(app.db!, {
      email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user',
    })
    userId = account.id
    token = await loginAs(app, 'o@t.dev', 'password-o')
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
  })

  describe('authorizeSocket', () => {
    it('세션 쿠키가 없으면 4401', async () => {
      expect(await authorizeSocket(app.db!, undefined, projectId))
        .toEqual({ ok: false, code: WS_CLOSE_UNAUTHORIZED })
    })

    it('없는 세션 토큰이면 4401', async () => {
      expect(await authorizeSocket(app.db!, uuidv7(), projectId))
        .toEqual({ ok: false, code: WS_CLOSE_UNAUTHORIZED })
    })

    it('projectId가 UUID가 아니면 DB에 닿기 전에 4403', async () => {
      expect(await authorizeSocket(app.db!, token, 'not-a-uuid'))
        .toEqual({ ok: false, code: WS_CLOSE_FORBIDDEN })
    })

    it('멤버가 아닌 프로젝트면 4403', async () => {
      await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
      const outsider = await loginAs(app, 'x@t.dev', 'password-x')
      expect(await authorizeSocket(app.db!, outsider, projectId))
        .toEqual({ ok: false, code: WS_CLOSE_FORBIDDEN })
    })

    it('접근 권한이 있으면 사용자 정보를 반환한다', async () => {
      expect(await authorizeSocket(app.db!, token, projectId))
        .toEqual({ ok: true, userId, name: '오너' })
    })
  })

  describe('/ws', () => {
    it('접속하면 ready를 받고, 이후 mutation의 op를 브로드캐스트받는다', async () => {
      const c = await connect(app, `/ws?projectId=${projectId}`, `erdd_session=${token}`)
      const ready = await c.next((m) => m.type === 'ready')
      expect(ready).toEqual({
        type: 'ready', seq: 0,
        peers: [{ userId, name: '오너', selections: [] }],
      })

      const op = noteCreateOp()
      expect((await post(app, 'model.mutate', token, { projectId, ops: [op] })).statusCode).toBe(200)

      expect(await c.next((m) => m.type === 'ops')).toEqual({
        type: 'ops', seq: 1, ops: [op], actorUserId: userId, actorName: '오너',
      })
      c.socket.terminate()
    })

    it('인증 없이 접속하면 4401로 닫힌다', async () => {
      const c = await connect(app, `/ws?projectId=${projectId}`)
      expect(await c.closed()).toBe(WS_CLOSE_UNAUTHORIZED)
    })

    it('ready 준비 중 DB 조회가 실패하면 1011(정보성 코드)로 닫는다', async () => {
      const mutation = await import('./services/mutation.js')
      const spy = vi.spyOn(mutation, 'currentSeq').mockRejectedValueOnce(new Error('DB down'))
      const c = await connect(app, `/ws?projectId=${projectId}`, `erdd_session=${token}`)
      expect(await c.closed()).toBe(1011)
      spy.mockRestore()
    })

    it('구독 이후 대기 중인 비동기 작업(currentSeq) 도중 클라이언트가 끊겨도 허브에 유령 항목이 남지 않는다', async () => {
      // authorizeSocket 이후 hub.subscribe·close 리스너 등록까지는 끝났지만 currentSeq는
      // 아직 끝나지 않은 상태를 인위적으로 만든다 — 정리 순서(subscribe 직후 close 리스너를
      // 건다)가 지켜지는지 확인하는 것이 이 테스트의 핵심이다. 리스너가 currentSeq 완료 이후에야
      // 걸리는 회귀 버전이면 아래 두 번째 waitUntil이 타임아웃으로 실패한다.
      const mutation = await import('./services/mutation.js')
      let releasePending: (() => void) | undefined
      const spy = vi.spyOn(mutation, 'currentSeq').mockImplementationOnce(
        () => new Promise<number>((resolve) => { releasePending = () => resolve(0) }),
      )
      const c = await connect(app, `/ws?projectId=${projectId}`, `erdd_session=${token}`)
      await waitUntil(() => app.hub.connectionCount(projectId) === 1)
      c.socket.terminate() // currentSeq가 여전히 대기 중인 상태에서 클라이언트가 끊긴다
      await waitUntil(() => app.hub.connectionCount(projectId) === 0)
      expect(app.hub.connectionCount(projectId)).toBe(0)
      releasePending?.()
      spy.mockRestore()
    })
  })
})
