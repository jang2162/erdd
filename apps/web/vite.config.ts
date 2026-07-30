import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      // ws: true가 없으면 dev에서 소켓 업그레이드가 프록시되지 않아 실시간이 아예 안 붙는다.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
