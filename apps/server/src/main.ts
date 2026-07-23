import { buildServer } from './server.js'
import { ensureBootstrapAdmin } from './services/accounts.js'

const app = buildServer({ databaseUrl: process.env.DATABASE_URL })
const port = Number(process.env.PORT ?? 3000)

async function start() {
  if (app.db) await ensureBootstrapAdmin(app.db)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`ERDD server listening on :${port}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0))
  })
}
