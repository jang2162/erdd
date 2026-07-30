import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { parseClientMessage, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED } from '@erdd/core'
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
      if (projectId === undefined) {
        socket.close(WS_CLOSE_FORBIDDEN)
        return
      }
      const auth = await authorizeSocket(db, req.cookies[SESSION_COOKIE], projectId)
      if (!auth.ok) {
        socket.close(auth.code)
        return
      }

      const handle = hub.subscribe(projectId, {
        userId: auth.userId,
        name: auth.name,
        send: (text) => socket.send(text),
      })

      const seq = await currentSeq(db, projectId)
      socket.send(JSON.stringify({ type: 'ready', seq, peers: hub.peers(projectId) }))

      socket.on('message', (raw) => {
        const msg = parseClientMessage(String(raw))
        if (msg) handle.setSelection(msg.selection) // 형식 오류는 무시(소켓을 끊지 않는다)
      })

      let missed = 0
      const heartbeat: NodeJS.Timeout = setInterval(() => {
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

      socket.on('close', () => {
        clearInterval(heartbeat)
        handle.close()
      })
    })
  }
}
