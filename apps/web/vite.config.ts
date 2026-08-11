import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 워크트리를 병렬로 돌릴 때 서버 포트를 트랙마다 달리 잡는다(→ CLAUDE.md "워크트리").
// 하드코딩이면 워크트리의 web dev가 조용히 최상위 서버(3000)에 붙는다.
const serverPort = process.env.ERDD_SERVER_PORT ?? '3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    // 기본값을 비우면 vite가 IPv6 `[::1]`에만 바인딩돼 Chrome이 접속을 못 한다
    // (curl은 `localhost`를 `::1`로 풀어 200이라 서버 문제로 오인하기 쉽다).
    host: process.env.ERDD_WEB_HOST ?? '127.0.0.1',
    // 서버 포트와 같은 이유로 파라미터화한다 — 워크트리를 병렬로 돌릴 때 트랙마다 달리 잡는다.
    port: Number(process.env.ERDD_WEB_PORT ?? 5173),
    // 포트가 물려 있으면 조용히 옆 포트로 도망가지 않고 죽는다(= 남의 dev 서버를 보고 있을 일이 없다).
    strictPort: true,
    proxy: {
      '/trpc': `http://localhost:${serverPort}`,
      // ws: true가 없으면 dev에서 소켓 업그레이드가 프록시되지 않아 실시간이 아예 안 붙는다.
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
})
