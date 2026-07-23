import { buildServer } from './server.js'

const app = buildServer()
const port = Number(process.env.PORT ?? 3000)

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`ERDD server listening on :${port}`)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0))
  })
}
