import { describe, expect, it } from 'vitest'
import { buildServer } from './server.js'

describe('server', () => {
  it('health.ping returns ok', async () => {
    const app = buildServer()
    const res = await app.inject({ method: 'GET', url: '/trpc/health.ping' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ ok: true })
    await app.close()
  })

  it('logicalType.parse canonicalizes input via core', async () => {
    const app = buildServer()
    const input = encodeURIComponent(JSON.stringify('varchar2(100)'))
    const res = await app.inject({ method: 'GET', url: `/trpc/logicalType.parse?input=${input}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ ok: true, canonical: 'VARCHAR(100)' })
    await app.close()
  })
})
