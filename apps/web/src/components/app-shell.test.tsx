import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { MemoryRouter } from 'react-router'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { AppShell } from './app-shell'

function renderShell(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <AppShell userMenu={<span>내 메뉴</span>} isLocal={false}>
            <p>본문</p>
          </AppShell>
        </TRPCProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AppShell', () => {
  it('대기 요청이 있으면 어느 화면에 있든 헤더에 배지가 보인다', async () => {
    // 요구사항은 "배지 컴포넌트가 있다"가 아니라 "승인자가 어느 화면에 있든 보인다"이다 —
    // 배선이 빠지면 큐는 그대로 남되 아무도 보지 않는 상태로 되돌아간다(설계 §1.1).
    renderShell({
      'promotion.pendingCount': () => ({
        data: { total: 3, byOrg: [{ orgId: 'o1', count: 3 }] },
      }),
    })
    const link = await screen.findByRole('link', { name: /승격 요청 3건/ })
    expect(link.getAttribute('href')).toBe('/org/o1')
    // 셸의 원래 역할도 함께 지킨다 — 배지를 넣느라 본문·사용자 메뉴가 밀려나면 안 된다.
    expect(screen.getByText('본문')).toBeTruthy()
    expect(screen.getByText('내 메뉴')).toBeTruthy()
  })

  it('대기 요청이 없으면 헤더가 그대로다', async () => {
    const pendingCount = vi.fn(() => ({ data: { total: 0, byOrg: [] } }))
    renderShell({ 'promotion.pendingCount': pendingCount })
    // 조회가 끝난 뒤에 확인한다 — 바로 단언하면 아직 응답 전이라 무엇이든 통과한다.
    await vi.waitFor(() => expect(pendingCount).toHaveBeenCalled())
    await new Promise((done) => { setTimeout(done, 20) })
    expect(screen.queryByRole('link', { name: /승격 요청/ })).toBeNull()
    expect(screen.getByText('내 메뉴')).toBeTruthy()
  })
})
