import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { RequireAuth, useIsLocal } from './require-auth'

function Probe() {
  return <span>{useIsLocal() ? '로컬' : '서버'}</span>
}

function renderProbe(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{
    path: '/',
    Component: () => <RequireAuth><Probe /></RequireAuth>,
  }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useIsLocal', () => {
  it('mode 가 local 이면 참이다', async () => {
    renderProbe({
      'auth.me': () => ({
        data: { id: 'u1', email: 'local@erdd', name: '로컬', role: 'user', mode: 'local' },
      }),
    })
    expect(await screen.findByText('로컬')).toBeInTheDocument()
  })

  it('mode 가 server 면 거짓이다', async () => {
    renderProbe({
      'auth.me': () => ({
        data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode: 'server' },
      }),
    })
    expect(await screen.findByText('서버')).toBeInTheDocument()
  })
})
