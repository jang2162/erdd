import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { ResetPasswordPage } from './reset-password.js'

const TOKEN = 'erdd_rst_TESTTOKEN'

function renderReset(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  const fetchMock = mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([
    { path: '/reset/:token', Component: ResetPasswordPage },
    { path: '/login', Component: () => <p>로그인 화면</p> },
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={[`/reset/${TOKEN}`]} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResetPasswordPage', () => {
  it('shows the new-password form without asking the server first', () => {
    const fetchMock = renderReset({})
    expect(screen.getByLabelText('새 비밀번호')).toBeDefined()
    // 재설정에는 peek이 없다 — 토큰의 생사는 제출해야 알 수 있다.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the token and typed password to resetPassword verbatim', async () => {
    const reset = vi.fn(() => ({ data: { ok: true } }))
    renderReset({ 'auth.resetPassword': reset })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({ token: TOKEN, newPassword: 'password-1' }),
    )
  })

  it('never renders the typed password as visible text', async () => {
    renderReset({})
    const password = screen.getByLabelText('새 비밀번호')
    await userEvent.type(password, 'password-1')
    expect(password.getAttribute('type')).toBe('password')
    expect(document.body.textContent).not.toContain('password-1')
  })

  it('refuses to submit when the two passwords differ', async () => {
    const reset = vi.fn(() => ({ data: { ok: true } }))
    renderReset({ 'auth.resetPassword': reset })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-2')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('비밀번호가 서로 다릅니다')).toBeDefined())
    expect(reset).not.toHaveBeenCalled()
  })

  it('goes to /login after a successful reset', async () => {
    renderReset({ 'auth.resetPassword': () => ({ data: { ok: true } }) })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('로그인 화면')).toBeDefined())
  })

  it('shows the reason and hides the form for a dead token', async () => {
    renderReset({
      'auth.resetPassword': () => ({ error: { code: -32600, message: '이미 사용된 링크입니다' } }),
    })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('이미 사용된 링크입니다')).toBeDefined())
    expect(screen.getByText(/관리자에게/)).toBeDefined()
    expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
  })
})
