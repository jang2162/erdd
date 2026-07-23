import { createTRPCContext } from '@trpc/tanstack-react-query'
import type { AppRouter } from '@erdd/server/src/router.js'

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()
