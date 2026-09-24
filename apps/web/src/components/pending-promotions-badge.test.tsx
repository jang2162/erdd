import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { MemoryRouter } from 'react-router'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { PendingPromotionsBadge } from './pending-promotions-badge'

function renderBadge(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <PendingPromotionsBadge />
        </TRPCProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PendingPromotionsBadge', () => {
  it('대기 건수가 0이면 아무것도 렌더하지 않는다', async () => {
    const pendingCount = vi.fn(() => ({ data: { total: 0, byOrg: [] } }))
    renderBadge({ 'promotion.pendingCount': pendingCount })
    // 조회가 실제로 끝난 뒤에 확인한다 — 바로 단언하면 아직 응답 전이라 무엇이든 통과한다.
    await vi.waitFor(() => expect(pendingCount).toHaveBeenCalled())
    await new Promise((done) => { setTimeout(done, 20) })
    expect(screen.queryByRole('link', { name: /승격 요청/ })).toBeNull()
  })

  it('조직이 하나면 그 조직 화면으로 가는 링크를 낸다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({
      data: { total: 3, byOrg: [{ orgId: 'o1', count: 3 }] },
    }) })
    const link = await screen.findByRole('link', { name: /승격 요청 3건/ })
    expect(link.getAttribute('href')).toBe('/org/o1')
  })

  it('조직이 여럿이면 홈으로 보낸다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({
      data: { total: 5, byOrg: [{ orgId: 'o1', count: 3 }, { orgId: 'o2', count: 2 }] },
    }) })
    const link = await screen.findByRole('link', { name: /승격 요청 5건/ })
    expect(link.getAttribute('href')).toBe('/')
  })

  it('대기 건수를 천 단위로 끊는다', async () => {
    renderBadge({ 'promotion.pendingCount': () => ({
      data: { total: 1234, byOrg: [{ orgId: 'o1', count: 1234 }] },
    }) })
    const link = await screen.findByRole('link', { name: '승격 요청 1,234건 검토' })
    expect(link.textContent).toContain('승격 요청 1,234건')
  })
})
