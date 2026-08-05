import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { RequireAuth } from '@/components/require-auth'
import { HomePage } from './home.js'

function renderHome(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{
    path: '/',
    Component: () => <RequireAuth><HomePage /></RequireAuth>,
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

describe('HomePage', () => {
  it('lists organizations with the personal org labeled and pinned first', async () => {
    renderHome({
      'auth.me': () => ({
        data: { id: 'u1', email: 'test@example.com', name: '사용자', role: 'user' },
      }),
      'org.list': () => ({
        data: [
          { id: 'o2', name: '팀A', kind: 'team', role: 'owner' },
          { id: 'o1', name: '사용자의 공간', kind: 'personal', role: 'owner' },
        ],
      }),
      'promotion.pendingCount': () => ({ data: { total: 0, byOrg: [] } }),
    })
    await waitFor(() => expect(screen.getByText('팀A')).toBeDefined())
    expect(screen.getByText('개인 공간')).toBeDefined()
    const cards = screen.getAllByRole('link')
    expect(cards[0]?.textContent).toContain('사용자의 공간')
  })

  it('대기 요청이 있는 조직 카드에 건수를 보여준다', async () => {
    renderHome({
      'auth.me': () => ({ data: { id: 'u1', name: '나', email: 'me@t.dev', role: 'user' } }),
      'org.list': () => ({ data: [{ id: 'o1', name: '팀', kind: 'team', role: 'owner' }] }),
      'promotion.pendingCount': () => ({ data: { total: 2, byOrg: [{ orgId: 'o1', count: 2 }] } }),
    })
    expect(await screen.findByText('승격 요청 2건')).toBeTruthy()
  })
})
