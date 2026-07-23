import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LoginPage } from './login.js'

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([
    { path: '/login', Component: LoginPage },
    { path: '/', Component: () => <p>홈 도착</p> },
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/login']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  it('logs in and navigates home', async () => {
    mockTrpcFetch({
      'auth.login': () => ({ data: { id: 'u1', email: 'a@b.dev', name: '사용자', role: 'user' } }),
    })
    renderLogin()
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.dev')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByText('홈 도착')).toBeDefined())
  })

  it('shows the server error message on failure', async () => {
    mockTrpcFetch({
      'auth.login': () => ({ error: { code: -32001, message: '이메일 또는 비밀번호가 올바르지 않습니다' } }),
    })
    renderLogin()
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.dev')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-pass')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() =>
      expect(screen.getByText('이메일 또는 비밀번호가 올바르지 않습니다')).toBeDefined(),
    )
  })
})
