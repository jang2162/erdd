import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { parseLogicalType } from '@erdd/core'

const t = initTRPC.create()

export const appRouter = t.router({
  health: t.router({
    ping: t.procedure.query(() => ({ ok: true as const, version: '0.1.0' })),
  }),
  logicalType: t.router({
    parse: t.procedure.input(z.string()).query(({ input }) => parseLogicalType(input)),
  }),
})

export type AppRouter = typeof appRouter
