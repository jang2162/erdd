import { z } from 'zod'
import { parseLogicalType } from '@erdd/core'
import { authRouter } from './routers/auth.js'
import { adminRouter } from './routers/admin.js'
import { orgRouter } from './routers/org.js'
import { projectRouter } from './routers/project.js'
import { modelRouter } from './routers/model.js'
import { publicProcedure, router } from './trpc.js'

export const appRouter = router({
  health: router({
    ping: publicProcedure.query(() => ({ ok: true as const, version: '0.1.0' })),
  }),
  logicalType: router({
    parse: publicProcedure.input(z.string()).query(({ input }) => parseLogicalType(input)),
  }),
  auth: authRouter,
  admin: adminRouter,
  org: orgRouter,
  project: projectRouter,
  model: modelRouter,
})

export type AppRouter = typeof appRouter
