import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { DEFAULT_NAMING_RULES, LOCAL_PROJECT_ID, createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from '@/editor/store'
import { routes } from './routes.js'

/**
 * **실제 라우트 표를 그대로 렌더한다.** 페이지 컴포넌트를 직접 스텁에 꽂으면
 * `routes.tsx`가 그 페이지를 `Protected`로 감싸도 테스트는 그대로 통과한다 —
 * 그러면 "비보호"를 검증하지 않는 테스트가 된다. 이 파일만 라우트 표를 소비한다.
 */
function renderAt(path: string, handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch({
    // 로그인하지 않은 방문자다. 라우트가 보호돼 있다면 여기서 /login으로 튕긴다.
    'auth.me': () => ({ error: { code: -32001, message: '로그인이 필요합니다' } }),
    ...handlers,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('routes', () => {
  it('opens /invite/:token without a session', async () => {
    renderAt('/invite/erdd_inv_TESTTOKEN', {
      'invitation.peek': () => ({ data: { email: 'new@test.dev', orgName: null, orgRole: null } }),
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    expect(screen.queryByRole('button', { name: '로그인' })).toBeNull()
  })

  it('opens /reset/:token without a session', async () => {
    renderAt('/reset/erdd_rst_TESTTOKEN', {})
    await waitFor(() => expect(screen.getByLabelText('새 비밀번호')).toBeDefined())
    expect(screen.queryByRole('button', { name: '로그인' })).toBeNull()
  })

  // 대조군이다. 이것이 통과해야 위 둘의 "로그인 없이 열린다"가 의미를 가진다 —
  // 보호된 라우트는 같은 조건에서 페이지를 내주지 않는다.
  it('still guards an ordinary route so the check above means something', async () => {
    renderAt('/settings', {})
    await waitFor(() => expect(screen.queryByText('불러오는 중…')).toBeNull())
    expect(screen.queryByText('비밀번호 변경')).toBeNull()
  })

  // 서버 쪽 `/` 리다이렉트(Task 8)는 주소창으로 들어올 때만 걸린다 — AppShell의 브랜드 링크는
  // react-router가 클라이언트에서 처리해 서버에 닿지 않으므로, 이 라우트 분기가 없으면
  // 로컬 모드에서 홈 화면(HomePage)이 뜬다. HomePage에는 「설정」 링크가 없다.
  it('로컬 모드에서 / 는 프로젝트로 리다이렉트한다', async () => {
    renderAt('/', {
      'auth.me': () => ({
        data: { id: 'u1', email: 'local@erdd', name: '로컬', role: 'user', mode: 'local' },
      }),
      'project.get': () => ({
        data: {
          id: LOCAL_PROJECT_ID, orgId: 'local', name: '로컬 프로젝트', description: '',
          dialects: ['postgresql'], createdAt: '2026-01-01T00:00:00.000Z',
          namingRules: DEFAULT_NAMING_RULES, myRole: 'admin', myOrgRole: 'owner',
          canEdit: true, canManage: true,
        },
      }),
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
    })
    expect(await screen.findByRole('link', { name: /설정/ })).toBeInTheDocument()
  })
})
