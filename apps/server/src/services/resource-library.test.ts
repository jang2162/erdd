import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp } from '../testing/helpers.js'
import { ensureStarterGlobalLibrary } from './resource-library.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('ensureStarterGlobalLibrary', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetDb(app.pgPool!) })

  it('전역 라이브러리가 없으면 예시 1개를 만든다', async () => {
    await ensureStarterGlobalLibrary(app.db!)
    const libs = await app.db!.select().from(resourceLibraries)
    expect(libs).toHaveLength(1)
    expect(libs[0]!.scope).toBe('global')
    expect(libs[0]!.orgId).toBeNull()
    const items = await app.db!.select().from(resourceItems)
    expect(items.length).toBeGreaterThan(0)
    for (const kind of ['domain', 'word', 'term', 'customField'] as const) {
      expect(items.some((i) => i.kind === kind)).toBe(true)
    }
  })

  it('두 번 호출해도 하나만 남는다 (멱등)', async () => {
    await ensureStarterGlobalLibrary(app.db!)
    await ensureStarterGlobalLibrary(app.db!)
    expect(await app.db!.select().from(resourceLibraries)).toHaveLength(1)
  })

  it('이미 전역 라이브러리가 있으면 아무것도 만들지 않는다', async () => {
    await app.db!.insert(resourceLibraries)
      .values({ id: uuidv7(), scope: 'global', orgId: null, name: '기존', description: '' })
    await ensureStarterGlobalLibrary(app.db!)
    const libs = await app.db!.select().from(resourceLibraries)
    expect(libs).toHaveLength(1)
    expect(libs[0]!.name).toBe('기존')
  })

  it('용어 항목의 domainId가 같은 라이브러리의 도메인 항목을 가리킨다', async () => {
    await ensureStarterGlobalLibrary(app.db!)
    const lib = (await app.db!.select().from(resourceLibraries))[0]!
    const items = await app.db!.select().from(resourceItems).where(eq(resourceItems.libraryId, lib.id))
    const domainIds = new Set(items.filter((i) => i.kind === 'domain').map((i) => i.id))
    const linked = items.filter((i) => i.kind === 'term' && i.payload.domainId !== null)
    expect(linked.length).toBeGreaterThan(0)
    for (const term of linked) expect(domainIds.has(String(term.payload.domainId))).toBe(true)
  })
})
