import { z } from 'zod'
import { parseLogicalType } from '@erdd/core'
import { authRouter } from './routers/auth.js'
import { adminRouter } from './routers/admin.js'
import { orgRouter } from './routers/org.js'
import { invitationRouter } from './routers/invitation.js'
import { projectRouter } from './routers/project.js'
import { modelRouter } from './routers/model.js'
import { revisionRouter } from './routers/revision.js'
import { snapshotRouter } from './routers/snapshot.js'
import { resourceRouter } from './routers/resource.js'
import { promotionRouter } from './routers/promotion.js'
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
  invitation: invitationRouter,
  project: projectRouter,
  model: modelRouter,
  revision: revisionRouter,
  snapshot: snapshotRouter,
  resource: resourceRouter,
  promotion: promotionRouter,
})

export type AppRouter = typeof appRouter
