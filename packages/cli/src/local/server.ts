import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import {
  LOCAL_DISCARD_PATH, LOCAL_EVENTS_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, type LocalEvent,
  LOCAL_CHANGES_PATH, LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_UNSAVED_MESSAGE,
  type LocalChangesCreateResult, type LocalChangesStatus,
} from '@erdd/core'
import { LOCAL_PROJECT_ID, readConfig } from '../config.js'
import { note } from '../output.js'
import { FileStore, type StoreState } from './store.js'
import { createLocalRouter, type LocalContext } from './router.js'
import { watchProject } from './watch.js'
import { migrateSnapshots } from './snapshot-migrate.js'
import { SNAPSHOTS_DIR } from './snapshots.js'
import { loadChangesPlan, toLocalStatus, writeChange } from './changes.js'

/** SSE 로 내보낼 페이로드. 정상이면 reload, 파일이 깨져 편집이 잠겼으면 blocked. */
const eventPayload = (state: StoreState): LocalEvent =>
  state.ok ? { type: 'reload' } : { type: 'blocked', failures: state.failures }

/**
 * 미저장·외부 변경 표시. **모델을 나르지 않는다** — 드래그 중에 도착해도 화면이 튀지 않는다.
 * 이것이 다른 탭의 표시까지 함께 맞춰 주는 유일한 경로다.
 */
const statusPayload = (store: FileStore): LocalEvent =>
  ({ type: 'status', dirty: store.dirty, external: store.external })

export type LocalServer = { url: string; close: () => Promise<void> }

/**
 * web 빌드 산출물의 후보 경로. `from` 은 이 모듈이 놓인 디렉터리(= `<패키지 루트>/src/local/`).
 *
 * 후보가 둘인 이유는 **설치본과 저장소의 배치가 다르기 때문**이다.
 * - 저장소: 워크스페이스의 `apps/web/dist` 를 본다. 여기엔 `packages/cli/web` 이 없을 수도, 있을 수도 있다
 *   (빌드 산출물이라 커밋하지 않지만 `bundle:web` 을 한 번 돌리면 남는다).
 * - 게시된 패키지: 번들이 패키지 안에 동봉된다(`<패키지 루트>/web`, `scripts/bundle-web.mjs` 가 만든다).
 *   설치본에는 `apps/web` 자체가 없다.
 * 한쪽으로 고정하지 않고 **실제로 존재하는 첫 후보**를 고른다.
 *
 * **순서는 저장소 우선이다.** `bundle:web` 은 gitignore 된 `packages/cli/web/` 에 복사본을 남기는데,
 * 그것은 `git clean -fd` 로도 지워지지 않는다(`-x` 가 있어야 한다). 설치본을 먼저 보면 한 번 게시
 * 준비를 해 본 개발자는 그 뒤로 `apps/web` 을 아무리 다시 빌드해도 **계속 그 잔재를 본다** —
 * 실제로 표식 파일로 재현된 함정이다. 저장소를 먼저 보면 최신 빌드가 항상 이긴다.
 *
 * **설치본에서 저장소 후보가 잡히는 일은 없다.** 설치본의 `from` 은
 * `<소비처>/node_modules/@erdd/cli/src/local` 이라 저장소 후보는 `<소비처>/node_modules/apps/web/dist`
 * 로 풀린다 — `node_modules` **안**이다. 소비처 루트의 `apps/web/dist` 는 절대 닿지 않는다. 잡히려면
 * `node_modules` 바로 밑에 `apps` 라는 스코프 없는 패키지가 있고 그것이 `web/dist/` 를 동봉해야 하는데,
 * npm 의 `apps` 패키지에는 `web/` 이 없고, pnpm 소비처에서는 실제 위치가
 * `node_modules/.pnpm/@erdd+cli@<ver>/node_modules/@erdd/cli` 라 4단계 위가 cli 자신의 의존성 디렉터리다 —
 * 구조적으로 성립하지 않는다.
 */
export const webDistCandidates = (from: string): readonly string[] => [
  path.resolve(from, '../../../../apps/web/dist'), // 저장소 배치 — 항상 최신 빌드가 이긴다
  path.resolve(from, '../../web'),                 // 게시된 패키지 배치
]

/** 존재하는 첫 후보. 둘 다 없으면 undefined — 그때는 정적 서빙을 등록하지 않는다. */
export const resolveWebDist = (
  from: string = fileURLToPath(new URL('.', import.meta.url)),
): string | undefined => webDistCandidates(from).find((c) => existsSync(c))

export async function startLocalServer(opts: {
  cwd: string
  port: number
  webDist?: string
}): Promise<LocalServer> {
  const { cwd, port } = opts
  // 명시 override 가 최우선이다 — 있으면 후보 탐색을 아예 하지 않는다.
  const webDist = opts.webDist ?? resolveWebDist()

  // 옛 `.erdd/snapshots.json` 을 커밋 대상으로 한 번 옮긴다. `store.load()` **앞**에서 끝내야
  // 기동 직후의 첫 감시 이벤트가 조용하다(스냅샷 파일은 `readTree` 가 보지 않으므로 모델에는
  // 영향이 없다).
  const migrated = await migrateSnapshots(cwd)
  if (migrated !== null) {
    if (migrated.moved.length > 0) {
      note(`스냅샷 ${migrated.moved.length}개를 ${SNAPSHOTS_DIR}/ 로 옮겼습니다 — 이제 커밋 대상입니다. git add ${SNAPSHOTS_DIR}`)
    }
    for (const s of migrated.skipped) {
      note(`⚠️ 손상된 스냅샷을 옮기지 않았습니다: ${s.name || '(이름 없음)'} (${s.id})`)
    }
  }

  const config = await readConfig(cwd)
  const projectId = config.projectId ?? LOCAL_PROJECT_ID
  const store = new FileStore(cwd)
  await store.load()
  // 미저장 편집이 있으면 그것을 얹어 연다(설계 D1) — 첫 load 가 실패했으면 들고 있다가
  // 파일이 고쳐지는 순간 얹힌다.
  const corrupt = await store.adoptDraft()
  if (corrupt !== null) {
    note(`⚠️ 저장하지 않은 편집을 읽지 못해 파일 상태로 열었습니다. 원본은 ${corrupt.corruptBackupPath} 에 있습니다`)
  }

  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const router = createLocalRouter()

  // ── Host 검사: DNS 리바인딩 차단 ──
  // 127.0.0.1 바인딩(설계 D8)은 **네트워크 경로**만 막고 **브라우저 경유**는 못 막는다.
  // 공격자 도메인이 짧은 TTL 로 DNS 를 127.0.0.1 로 다시 풀면, 그 페이지는 브라우저가 보기에
  // 이 서버와 동일 출처가 되어 preflight 없이 GET·POST 를 보낸다 — 인증이 없으므로 모델 전문을
  // 읽고 `model.mutate`(= 파일 쓰기 프리미티브)까지 그대로 실행된다. 그때 오는 요청의 `Host` 는
  // **공격자 도메인**이므로, 우리가 실제로 듣고 있는 루프백 주소가 아니면 여기서 끊는다.
  // (평범한 크로스 오리진은 preflight 415 로 이미 막혀 있다 — 남은 구멍이 이것뿐이었다.)
  // 403: 인증으로 풀 수 있는 문제가 아니라 "이 주소로는 이 서버에 말을 걸 수 없다"이다.
  // `listen` 뒤에는 훅을 더 붙일 수 없어서(그리고 --port 0 이면 실제 포트를 그때야 안다)
  // 훅은 지금 붙이고, 허용 목록만 listen 뒤에 채운다.
  let allowedHosts: ReadonlySet<string> = new Set()
  app.addHook('onRequest', (req, reply, done) => {
    const host = req.headers.host
    if (host === undefined || !allowedHosts.has(host.toLowerCase())) {
      void reply.code(403).send({ error: '허용되지 않은 Host 헤더입니다' })
      return
    }
    // ── Origin 검사: CSRF 차단 ──
    // ⚠️ **Host 검사만으로는 부족하다.** 그것이 막는 것은 DNS 리바인딩(Host 가 공격자 도메인)
    // 뿐이고, 공격자 페이지가 `127.0.0.1:<포트>` 로 **직접** 보내는 요청의 Host 는 우리 것이라
    // 그대로 통과한다. tRPC 는 `application/json` 을 요구해 preflight 장벽이 서지만,
    // `/local/*` 는 본문도 content-type 도 없어 **simple request** 로 도달한다 — 남의 페이지
    // 한 줄(`fetch(…, {mode:'no-cors'})` 이나 `<form enctype="text/plain">`)로 미저장 편집이
    // 통째로 버려질 수 있다(실측: `Origin: https://evil…` 의 POST /local/discard → 200).
    //
    // 브라우저는 GET·HEAD 가 아닌 요청에 **언제나** `Origin` 을 붙이므로(동일 출처 포함) 그것이
    // 우리 것이 아니면 끊는다. `Origin` 이 없는 요청(curl·서버 간 호출)은 브라우저發이 아니므로
    // CSRF 가 성립하지 않는다 — 여기서 막지 않는다.
    const origin = req.headers.origin
    if (origin !== undefined) {
      let originHost: string | null = null
      try { originHost = new URL(origin).host.toLowerCase() } catch { originHost = null }
      if (originHost === null || !allowedHosts.has(originHost)) {
        void reply.code(403).send({ error: '허용되지 않은 Origin 입니다' })
        return
      }
    }
    done()
  })

  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router,
      createContext: (_o: CreateFastifyContextOptions): LocalContext =>
        ({ store, cwd, projectId, config }),
    },
  })

  // fs.watch 등록 직전에 생긴 변경(예: 프로젝트 디렉터리 생성)을 macOS 재귀 감시가 등록
  // 직후 뒤늦게 한 번 더 흘려보내는 경우가 있다 — 그 이벤트로 다시 읽어도 디스크는 이미 알던
  // 것과 같다. 실제로 달라진 것이 없으면 거른다(안 거르면 아무 이유 없이 브라우저가 리로드된다).
  //
  // ⚠️ **메모리 모델이 아니라 기준선(= 채택한 디스크)의 서명을 본다.** 모델로 판정하면 내
  // 편집도 「바뀌었다」가 되어 자기 편집을 되돌려 받고 드래그가 튄다. 기준선은 `#commitLoad` 가
  // **디스크를 실제로 채택했을 때만** 움직인다.
  let lastBaseSignature = store.baseSignature

  // ── SSE: 외부 파일 변경을 브라우저에 알린다 ──
  const clients = new Set<{ write: (s: string) => void; end: () => void }>()
  const send = (payload: LocalEvent) => {
    for (const c of clients) c.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
  const broadcast = () => { send(eventPayload(store.state)) }
  const broadcastStatus = () => { send(statusPayload(store)) }
  // 편집이 미저장 상태를 만들거나 없앨 때 다른 탭의 표시도 함께 맞춘다. **모델을 나르지
  // 않으므로** 편집 중인 탭이 이것을 받아도 화면이 튀지 않는다(reload 와 다른 점이다).
  store.onStatusChange(broadcastStatus)
  app.get(LOCAL_EVENTS_PATH, (req, reply) => {
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
    // 미저장·충돌 상태도 함께 보낸다 — 늦게 붙은 탭이 그것을 알 다른 경로가 없다.
    client.write(`data: ${JSON.stringify(statusPayload(store))}\n\n`)
  })

  /**
   * ── 로컬 전용 라우트 ──
   * tRPC 밖인 이유는 `local-protocol.ts` 의 주석과 같다 — 서버 라우터에 없는 프로시저를 만들면
   * `router.test.ts` 의 `LocalOnly` 잠금이 깨지고, 웹은 `AppRouter` 타입으로 클라이언트를 만들어
   * 그 이름을 부를 수조차 없다.
   *
   * ⚠️ **전부 POST 다.** GET 이면 공격자 페이지의 `<img src>` 한 줄로 저장·버리기가 불린다.
   * Host 검사(onRequest 훅)는 라우트 전체에 걸리므로 여기도 자동으로 그 아래 들어온다.
   *
   * **한자리에 모아 둔다** — 다음 사이클의 `POST /local/apply`(에이전트의 op 주입)가 여기 붙는다.
   */
  app.post(LOCAL_SAVE_PATH, async () => {
    const result = await store.save()
    // 모델은 그대로다 — reload 를 보내면 브라우저가 헛되이 다시 읽는다. 표시만 맞춘다.
    broadcastStatus()
    return result
  })
  app.post(LOCAL_DISCARD_PATH, async () => {
    await store.discard()
    // 모델이 디스크로 되돌아갔다 — 이때는 브라우저가 다시 읽어야 한다.
    lastBaseSignature = store.baseSignature
    broadcast()
    broadcastStatus()
    return { ok: true as const }
  })
  app.post(LOCAL_KEEP_PATH, async () => {
    await store.keep()
    broadcastStatus()
    return { ok: true as const }
  })

  /**
   * 변경 기록(guide 「변경 기록 — `.erddc` 문법과 재생 규칙」). 상태는 **화면 모델 기준**이다 —
   * 미저장 편집이 있으면 미리보기에 포함되고 `unsaved` 가 켜진다. 생성은 저장된 상태에서만 한다
   * (스냅샷과 같은 규칙 — 파일 어디에도 없는 상태를 가리키는 기록이 생기면 안 된다).
   * ⚠️ `dirty` 가 아니라 `unsaved` 를 본다 — 스냅샷 생성 가드와 같은 이유(디바운스 창).
   */
  const BLOCKED_MESSAGE = '파일이 깨져 편집이 잠겨 있습니다 — 파일을 고친 뒤 다시 하세요'
  app.post(LOCAL_CHANGES_PATH, async (): Promise<LocalChangesStatus> => {
    const state = store.state
    if (!state.ok) {
      return { records: [], pending: null, warnings: [], error: { file: null, line: null, message: BLOCKED_MESSAGE }, unsaved: store.unsaved }
    }
    const { plan } = await loadChangesPlan({ cwd, model: state.model, config })
    return toLocalStatus(plan, store.unsaved)
  })
  app.post<{ Body: unknown }>(LOCAL_CHANGES_CREATE_PATH, async (req): Promise<LocalChangesCreateResult> => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const name = typeof body['name'] === 'string' ? body['name'] : ''
    const baseline = body['baseline'] === true
    const state = store.state
    if (!state.ok) return { ok: false, reason: 'blocked', message: BLOCKED_MESSAGE }
    if (store.unsaved) return { ok: false, reason: 'unsaved', message: LOCAL_CHANGES_UNSAVED_MESSAGE }
    return writeChange({ cwd, model: state.model, config }, { name, baseline })
  })

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
      const adopted = store.baseSignature !== lastBaseSignature
      lastBaseSignature = store.baseSignature

      // blocked(파일 손상)는 위의 "달라진 것 없으면 거른다" 필터를 타지 않는다 — 그 필터는
      // 기동 창의 메아리만 막으려던 것이지, 이미 잠긴 상태의 재발화까지 삼키면 그 사이
      // 접속한 탭이 blocked 를 영영 못 받는다.
      if (!state.ok) { broadcast(); return }
      // config 만 바뀐 경우도 모델 서명은 그대로라 위 modelChanged 필터에 걸리지 않는다 —
      // 자기 쓰기 판정과 무관하게(그 판정은 모델/레이아웃 서명만 본다) 여기서 직접 내보낸다.
      if (configChanged) { broadcast(); return }
      // 미저장 편집이 있는데 밖이 바뀌었다 — 모델을 채택하지 않았으므로 reload 가 아니라
      // 배너를 띄우는 status 다(설계 D2).
      if (store.external) { broadcastStatus(); return }
      // 디스크를 실제로 채택했을 때만 브라우저가 다시 읽는다.
      if (adopted) broadcast()
    })().catch((err) => { console.warn('[local server] 감시 처리 중 오류:', err) })
  })

  // ── 정적 서빙 ──
  app.get('/', (_req, reply) => reply.redirect(`/p/${projectId}`, 302))
  if (webDist !== undefined && existsSync(webDist)) {
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
  const loopback = ['127.0.0.1', 'localhost', '[::1]']
  allowedHosts = new Set([
    ...loopback.map((h) => `${h}:${actualPort}`),
    // 80 포트에서는 브라우저가 Host 에서 포트를 생략한다.
    ...(actualPort === 80 ? loopback : []),
  ])

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
