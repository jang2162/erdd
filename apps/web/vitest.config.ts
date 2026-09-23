import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { erddVersion } from './erdd-version'

export default defineConfig({
  plugins: [react()],
  define: { __ERDD_VERSION__: JSON.stringify(erddVersion()) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
})
