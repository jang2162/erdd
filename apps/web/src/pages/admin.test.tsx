import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { AdminPage } from './admin.js'

const USERS = [
  { id: 'u1', email: 'admin@test.dev', name: '관리자', role: 'admin', isActive: true, createdAt: '2026-07-24T00:00:00Z' },
  { id: 'u2', email: 'user@test.dev', name: '사용자', role: 'user', isActive: false, createdAt: '2026-07-24T00:00:00Z' },
]

function renderAdmin(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/admin', Component: AdminPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/admin']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AdminPage', () => {
  it('lists accounts with role and status badges', async () => {
    renderAdmin({ 'admin.users.list': () => ({ data: USERS }) })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    expect(screen.getByText('비활성')).toBeDefined()
    expect(screen.getAllByText('관리자').length).toBeGreaterThan(0)
  })

  it('creates an account through the dialog', async () => {
    const created = vi.fn(() => ({ data: { id: 'u3', email: 'new@test.dev' } }))
    renderAdmin({
      'admin.users.list': () => ({ data: USERS }),
      'admin.users.create': created,
    })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await userEvent.type(screen.getByLabelText('이메일'), 'new@test.dev')
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('초기 비밀번호'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(created).toHaveBeenCalled())
  })
})
