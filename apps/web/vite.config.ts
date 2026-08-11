import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 워크트리를 병렬로 돌릴 때 서버 포트를 트랙마다 달리 잡는다(→ CLAUDE.md "워크트리").
// 하드코딩이면 워크트리의 web dev가 조용히 최상위 서버(3000)에 붙는다.
const serverPort = process.env.ERDD_SERVER_PORT ?? '3000'

// 미설정·빈 값은 기본 5173. 값이 있는데 포트로 못 읽히면 조용히 5173으로 떨어지지 않고 죽인다 —
// 폴백하면 오타 하나로 워크트리의 web이 최상위 슬롯을 차지하고, 에러 메시지도 요청한 포트와 달라진다.
function webPort(): number {
  const raw = process.env.ERDD_WEB_PORT
  if (!raw) return 5173
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ERDD_WEB_PORT 가 올바른 포트 번호가 아닙니다: ${JSON.stringify(raw)}`)
  }
  return port
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    // 기본값을 비우면 vite가 IPv6 `[::1]`에만 바인딩돼 Chrome이 접속을 못 한다
    // (curl은 `localhost`를 `::1`로 풀어 200이라 서버 문제로 오인하기 쉽다).
    // `??`가 아니라 `||`인 이유: 빈 문자열(`ERDD_WEB_HOST=`)이 통과하면 그 함정이 그대로 되살아난다.
    host: process.env.ERDD_WEB_HOST || '127.0.0.1',
    // 서버 포트와 같은 이유로 파라미터화한다 — 워크트리를 병렬로 돌릴 때 트랙마다 달리 잡는다.
    port: webPort(),
    // 포트가 물려 있으면 조용히 옆 포트로 도망가지 않고 죽는다(= 남의 dev 서버를 보고 있을 일이 없다).
    strictPort: true,
    proxy: {
      '/trpc': `http://localhost:${serverPort}`,
      // ws: true가 없으면 dev에서 소켓 업그레이드가 프록시되지 않아 실시간이 아예 안 붙는다.
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
})
