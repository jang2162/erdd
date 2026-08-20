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

/** SSE 로 내보낼 페이로드. 정상이면 reload, 파일이 깨져 편집이 잠겼으면 blocked. */
const eventPayload = (state: StoreState) =>
  state.ok ? { type: 'reload' as const } : { type: 'blocked' as const, failures: state.failures }

export type LocalServer = { url: string; close: () => Promise<void> }

/** 워크스페이스 안에서 실행될 때의 web 빌드 산출물 위치. */
const defaultWebDist = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../../apps/web/dist',
)

export async function startLocalServer(opts: {
  cwd: string
  port: number
  webDist?: string
}): Promise<LocalServer> {
  const { cwd, port } = opts
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
  const broadcast = () => {
    const payload = eventPayload(store.state)
    for (const c of clients) c.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
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
    // 접속 시점의 현재 상태를 한 번 보낸다 — 이미 blocked 인 상태로 늦게 접속한 탭도
    // 재저장 없이 즉시 옳은 상태가 된다(그 전에는 알 다른 경로가 없다).
    client.write(`data: ${JSON.stringify(eventPayload(store.state))}\n\n`)
  })

  // fs.watch 등록 직전에 생긴 변경(예: 프로젝트 디렉터리 생성)을 macOS 재귀 감시가 등록
  // 직후 뒤늦게 한 번 더 흘려보내는 경우가 있다 — 그 이벤트로 다시 읽어도 모델은 이미 알던
  // 것과 같다. 실제로 달라진 것이 없으면 거른다(안 거르면 아무 이유 없이 브라우저가 리로드된다).
  let lastModelSignature = stateSignature(store.state)
  let configSignature = JSON.stringify(config)

  const watcher = watchProject(cwd, () => {
    void (async () => {
      // 로컬 모드에는 방언·명명 규칙 편집 UI 가 없다 — erdd.config.yaml 을 직접 고치는 것이
      // 유일한 방법이고, 그 변경이 project.get 에 반영돼야 한다. ctx 가 들고 있는 것과 같은
      // 객체를 제자리에서 갱신해야 다음 요청이 새 값을 본다(project.update 뒤와 같은 이유로
      // 새 객체를 만들어 갈아끼우면 안 된다).
      let configChanged = false
      try {
        const nextConfig = await readConfig(cwd)
        const nextSignature = JSON.stringify(nextConfig)
        if (nextSignature !== configSignature) {
          configSignature = nextSignature
          Object.assign(config, nextConfig)
          configChanged = true
        }
      } catch (err) {
        // config 가 깨졌다고 서버가 죽으면 안 된다 — 기존 값을 유지하고 경고만 남긴다.
        console.warn('[local server] erdd.config.yaml 을 다시 읽지 못했습니다:', err)
      }

      await store.load()
      const state = store.state
      const modelSignature = stateSignature(state)
      const modelChanged = modelSignature !== lastModelSignature
      lastModelSignature = modelSignature

      // blocked(파일 손상)는 위의 "달라진 것 없으면 거른다" 필터를 타지 않는다 — 그 필터는
      // 기동 창의 메아리만 막으려던 것이지, 이미 잠긴 상태의 재발화까지 삼키면 그 사이
      // 접속한 탭이 blocked 를 영영 못 받는다.
      if (!state.ok) { broadcast(); return }
      // config 만 바뀐 경우도 모델 서명은 그대로라 위 modelChanged 필터에 걸리지 않는다 —
      // 자기 쓰기 판정과 무관하게(그 판정은 모델/레이아웃 서명만 본다) 여기서 직접 내보낸다.
      if (configChanged) { broadcast(); return }
      // 방금 읽은 디스크가 우리가 마지막으로 쓴 그것이면 자기 쓰기다 — 브라우저를 흔들 이유가 없다.
      if (store.isSelfWrite) return
      if (modelChanged) broadcast()
    })().catch((err) => { console.warn('[local server] 감시 처리 중 오류:', err) })
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

  // 인증이 없는 서버다. LAN 노출은 옵션으로도 열지 않는다(설계 D8) — host 를 받는 자리를
  // 아예 두지 않는다.
  try {
    await app.listen({ port, host: '127.0.0.1' })
  } catch (err) {
    watcher.close()
    throw err
  }
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: async () => {
      watcher.close()
      // 열린 SSE 응답을 끝내지 않으면 app.close() 가 그 연결이 스스로 끊기길 기다리며 멈춘다.
      for (const c of clients) c.end()
      clients.clear()
      await store.flush()
      await app.close()
    },
  }
}
