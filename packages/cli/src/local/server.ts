import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { LOCAL_PROJECT_ID, readConfig } from '../config.js'
import { FileStore, type StoreState } from './store.js'
import { createLocalRouter, type LocalContext } from './router.js'
import { watchProject } from './watch.js'

/** load() 결과가 실제로 달라졌는지 비교하는 서명. ok 상태의 판정 근거(model/failures)만 담는다. */
const stateSignature = (state: StoreState): string =>
  state.ok ? JSON.stringify(state.model) : JSON.stringify(state.failures)

export type LocalServer = { url: string; close: () => Promise<void> }

/** 워크스페이스 안에서 실행될 때의 web 빌드 산출물 위치. */
const defaultWebDist = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../../apps/web/dist',
)

export async function startLocalServer(opts: {
  cwd: string
  port: number
  host?: string
  webDist?: string
}): Promise<LocalServer> {
  const { cwd, port } = opts
  // 인증이 없는 서버다. LAN 노출은 옵션으로도 열지 않는다(설계 D8).
  const host = opts.host ?? '127.0.0.1'
  const webDist = opts.webDist ?? defaultWebDist

  const config = await readConfig(cwd)
  const projectId = config.projectId ?? LOCAL_PROJECT_ID
  const store = new FileStore(cwd)
  await store.load()

  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const router = createLocalRouter()

  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router,
      createContext: (_o: CreateFastifyContextOptions): LocalContext =>
        ({ store, cwd, projectId, config }),
    },
  })

  // ── SSE: 외부 파일 변경을 브라우저에 알린다 ──
  const clients = new Set<{ write: (s: string) => void; end: () => void }>()
  app.get('/local/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    // writeHead 만으로는 헤더가 소켓에 나가지 않는다 — Node 는 첫 write()/end() 까지 버퍼링한다.
    // 그때까지 기다리면 클라이언트의 fetch() 가 응답을 받지 못해 그대로 멈춘다.
    reply.raw.flushHeaders()
    const client = { write: (s: string) => reply.raw.write(s), end: () => reply.raw.end() }
    clients.add(client)
    req.raw.on('close', () => { clients.delete(client) })
  })
  // 파일이 깨져 편집이 잠긴 상태도 같은 채널로 알린다 — 브라우저가 배너를 띄우고 편집을 막는다.
  const broadcast = () => {
    const payload = store.state.ok
      ? { type: 'reload' as const }
      : { type: 'blocked' as const, failures: store.state.failures }
    for (const c of clients) c.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // fs.watch 등록 직전에 생긴 변경(예: 프로젝트 디렉터리 생성)을 macOS 재귀 감시가 등록
  // 직후 뒤늦게 한 번 더 흘려보내는 경우가 있다 — 그 이벤트로 다시 읽어도 내용은 이미 알던
  // 것과 같다. 실제로 달라진 것이 없으면 거른다(안 거르면 아무 이유 없이 브라우저가 리로드된다).
  let lastSignature = stateSignature(store.state)

  const watcher = watchProject(cwd, () => {
    void (async () => {
      await store.load()
      const signature = stateSignature(store.state)
      const changed = signature !== lastSignature
      lastSignature = signature
      // 방금 읽은 디스크가 우리가 마지막으로 쓴 그것이면 자기 쓰기다 — 브라우저를 흔들 이유가 없다.
      // 로드가 실패했으면 isSelfWrite 는 언제나 false 라 blocked 가 반드시 나간다.
      if (store.isSelfWrite) return
      if (!changed) return
      broadcast()
    })()
  })

  // ── 정적 서빙 ──
  app.get('/', (_req, reply) => reply.redirect(`/p/${projectId}`, 302))
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url === '/trpc' || req.url.startsWith('/trpc/')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  await app.listen({ port, host })
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    url: `http://${host}:${actualPort}`,
    close: async () => {
      watcher.close()
      // 열린 SSE 응답을 끝내지 않으면 app.close()가 그 연결이 스스로 끊기길 기다리며 멈춘다.
      for (const c of clients) c.end()
      clients.clear()
      await store.flush()
      await app.close()
    },
  }
}
