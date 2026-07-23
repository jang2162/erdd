import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@erdd/server/src/router.js'

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/trpc' })],
})
