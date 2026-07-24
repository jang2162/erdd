import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { SettingsPage } from './settings.js'

function renderSettings(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/settings', Component: SettingsPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/settings']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsPage', () => {
  it('blocks submit when the confirmation does not match', async () => {
    const change = vi.fn(() => ({ data: { ok: true } }))
    renderSettings({ 'auth.changePassword': change })
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-2')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-x')
    await userEvent.click(screen.getByRole('button', { name: '변경 사항 저장' }))
    expect(await screen.findByText('새 비밀번호가 서로 다릅니다')).toBeDefined()
    expect(change).not.toHaveBeenCalled()
  })

  it('submits when valid', async () => {
    const change = vi.fn(() => ({ data: { ok: true } }))
    renderSettings({ 'auth.changePassword': change })
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-2')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-2')
    await userEvent.click(screen.getByRole('button', { name: '변경 사항 저장' }))
    await waitFor(() => expect(change).toHaveBeenCalled())
  })
})
