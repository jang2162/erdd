import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import {
  parseClientMessage, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, type ServerMessage,
} from '@erdd/core'
import { SESSION_COOKIE } from './context.js'
import type { Db } from './db/client.js'
import { sessions, users } from './db/schema.js'
import { currentSeq } from './services/mutation.js'
import { getProjectAccess } from './services/perm.js'
import type { RealtimeHub } from './services/realtime.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ping 간격. 2회 연속 pong이 없으면 소켓을 끊는다. */
const HEARTBEAT_MS = 30_000
const MAX_MISSED_PONGS = 2

export type SocketAuth =
  | { ok: true; userId: string; name: string }
  | { ok: false; code: number }

/**
 * 소켓 업그레이드 인증. 예외를 던지지 않고 close code로 결과를 알린다
 * (핸들러에서 던지면 프로세스 로그만 더럽히고 클라이언트는 이유를 모른다).
 * 판정 기준은 tRPC의 createContext + requireProjectAccess('view')와 동일하다.
 */
export async function authorizeSocket(
  db: Db, token: string | undefined, projectId: string | undefined,
): Promise<SocketAuth> {
  if (!token) return { ok: false, code: WS_CLOSE_UNAUTHORIZED }
  // UUID가 아닌 projectId를 그대로 넘기면 postgres가 타입 오류를 던진다 — 먼저 거른다.
  if (!projectId || !UUID_RE.test(projectId)) return { ok: false, code: WS_CLOSE_FORBIDDEN }

  const rows = await db
    .select({
      id: users.id, name: users.name, isActive: users.isActive, expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
  const row = rows[0]
  if (!row || !row.isActive || row.expiresAt <= new Date()) {
    return { ok: false, code: WS_CLOSE_UNAUTHORIZED }
  }

  const access = await getProjectAccess(db, projectId, row.id)
  if (!access?.canView) return { ok: false, code: WS_CLOSE_FORBIDDEN }
  return { ok: true, userId: row.id, name: row.name }
}

/**
 * `/ws?projectId=<uuid>` 라우트. 편집 권한은 여기서 판정하지 않는다 —
 * Viewer도 수신·presence는 되고, 편집 차단은 model.mutate의 'edit' 게이트가 담당한다.
 */
export function wsPlugin(hub: RealtimeHub, db: Db | null) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/ws', { websocket: true }, async (socket, req) => {
      if (!db) {
        socket.close(WS_CLOSE_UNAUTHORIZED)
        return
      }
      const projectId = (req.query as { projectId?: string }).projectId
      // 중복 쿼리 파라미터(?projectId=a&projectId=b)는 배열이 되어 string이 아니다 — UUID
      // 검사가 toString() 강제변환으로 안전하게 거르긴 하지만, 타입을 정직하게 좁혀둔다.
      if (typeof projectId !== 'string') {
        socket.close(WS_CLOSE_FORBIDDEN)
        return
      }
      const auth = await authorizeSocket(db, req.cookies[SESSION_COOKIE], projectId)
      if (!auth.ok) {
        socket.close(auth.code)
        return
      }
      // authorizeSocket이 여러 DB 왕복을 거치는 동안 클라이언트가 이미 연결을 끊었을 수 있다.
      // 이 경우 구독하면 아무도 정리하지 않는 유령 항목이 남는다.
      if (socket.readyState !== socket.OPEN) return

      const handle = hub.subscribe(projectId, {
        userId: auth.userId,
        name: auth.name,
        send: (text) => socket.send(text),
      })
      let heartbeat: NodeJS.Timeout | undefined
      // subscribe 직후, await 없이 곧바로 close 리스너를 건다 — 그 사이에 close 이벤트가
      // 끼어들 마이크로태스크 틈이 없어야 유령 항목이 남지 않는다.
      socket.on('close', () => {
        if (heartbeat) clearInterval(heartbeat)
        handle.close()
      })

      let missed = 0
      try {
        const seq = await currentSeq(db, projectId)
        socket.send(JSON.stringify({ type: 'ready', seq, peers: hub.peers(projectId) } satisfies ServerMessage))
      } catch {
        // ready 준비 중 DB 실패 — close 리스너는 이미 걸려 있으니 close()가 정리를 보장한다.
        socket.close(1011)
        return
      }

      // ws의 타입이 apps/server에서 직접 해석되지 않아(전이 의존성) 핸들러 인자가 추론되지 않는다 — 명시한다.
      socket.on('message', (raw: unknown) => {
        const msg = parseClientMessage(String(raw))
        if (msg) handle.setSelection(msg.selection) // 형식 오류는 무시(소켓을 끊지 않는다)
      })

      heartbeat = setInterval(() => {
        if (missed >= MAX_MISSED_PONGS) {
          socket.terminate()
          return
        }
        missed += 1
        socket.ping()
      }, HEARTBEAT_MS)
      // 열린 소켓의 타이머가 프로세스·테스트 종료를 붙잡지 않게 한다.
      heartbeat.unref()
      socket.on('pong', () => { missed = 0 })
    })
  }
}
