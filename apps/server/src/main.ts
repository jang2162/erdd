import { buildServer } from './server.js'

const app = buildServer()
const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`ERDD server listening on :${port}`)
})
