import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { AccessTokensCard } from './settings-tokens.js'

function renderCard(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <AccessTokensCard />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AccessTokensCard', () => {
  it('목록을 보여주고 사용 이력이 없으면 그렇게 표시한다', async () => {
    renderCard({
      'auth.tokens.list': () => ({ data: [
        { id: 'a', name: '노트북', createdAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null },
      ] }),
    })
    expect(await screen.findByText('노트북')).toBeDefined()
    expect(screen.getByText('사용 안 함')).toBeDefined()
  })

  it('발급하면 평문을 한 번 보여주고 다시 볼 수 없다고 알린다', async () => {
    const create = vi.fn(() => ({ data: { token: 'erdd_pat_SECRET' } }))
    renderCard({ 'auth.tokens.list': () => ({ data: [] }), 'auth.tokens.create': create })
    await userEvent.type(await screen.findByLabelText('토큰 이름'), 'CI')
    await userEvent.click(screen.getByRole('button', { name: '발급' }))
    expect(await screen.findByText('erdd_pat_SECRET')).toBeDefined()
    expect(screen.getByText(/다시 볼 수 없습니다/)).toBeDefined()
    expect(create).toHaveBeenCalled()
  })

  it('이름이 비면 발급 버튼이 비활성이다', async () => {
    renderCard({ 'auth.tokens.list': () => ({ data: [] }) })
    const btn = await screen.findByRole('button', { name: '발급' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('폐기는 두 번 눌러야 실행된다', async () => {
    const revoke = vi.fn(() => ({ data: { ok: true } }))
    renderCard({
      'auth.tokens.list': () => ({ data: [
        { id: 'a', name: '노트북', createdAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null },
      ] }),
      'auth.tokens.revoke': revoke,
    })
    await userEvent.click(await screen.findByRole('button', { name: '폐기' }))
    // 첫 클릭은 확인 단계일 뿐 — 아직 호출되면 안 된다.
    expect(revoke).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: '정말 폐기' }))
    expect(revoke).toHaveBeenCalled()
  })
})
