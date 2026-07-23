import Fastify, { type FastifyInstance } from 'fastify'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './router.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter },
  })
  return app
}
