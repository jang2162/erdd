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
  const app = Fastify({ logger: false })

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
