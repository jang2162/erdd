import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { appRouter } from './router.js'
import { createContext } from './context.js'
import { createDb, type Db } from './db/client.js'
import type pg from 'pg'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db | null
    pgPool: pg.Pool | null
  }
}

const webDist = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')

export function buildServer({ databaseUrl }: { databaseUrl?: string } = {}): FastifyInstance {
  // 기본 본문 한도 1 MiB로는 op 5000건(MAX_OPS_PER_MUTATION) 배치가 들어오지 못한다.
  // op 하나가 넉넉히 3 KB라고 봐도 16 MiB면 한도까지 꽉 채운 사전 일괄 등록이 통과한다.
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 })

  let db: Db | null = null
  let pool: pg.Pool | null = null
  if (databaseUrl) {
    const created = createDb(databaseUrl)
    db = created.db
    pool = created.pool
    app.addHook('onClose', async () => { await pool!.end() })
  }
  app.decorate('db', db)
  app.decorate('pgPool', pool)

  app.register(fastifyCookie)
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: ({ req, res }: CreateFastifyContextOptions) => createContext({ req, res, db }),
    },
  })

  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url === '/trpc' || req.url.startsWith('/trpc/')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }
  return app
}
