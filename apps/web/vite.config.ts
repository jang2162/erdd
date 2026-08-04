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
    proxy: {
      '/trpc': `http://localhost:${serverPort}`,
      // ws: true가 없으면 dev에서 소켓 업그레이드가 프록시되지 않아 실시간이 아예 안 붙는다.
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
})
