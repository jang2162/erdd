import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from '@/editor/store'
import { assignLocation } from '@/lib/browser-nav'
import { routes } from './routes.js'

// HomeOrEditor는 로컬 모드에서 project id 를 클라이언트로 계산하지 않는다(리뷰 I-3) — 로컬
// 서버가 실제로 여는 프로젝트(config.projectId ?? LOCAL_PROJECT_ID)를 웹은 알 방법이 없어,
// 전체 이동으로 `/`를 다시 요청해 서버의 판정을 태운다. window.location.assign 은 jsdom 에서
// 실제 이동을 일으키지 않으므로, "이동이 요청됐다"만 목으로 잠근다.
vi.mock('@/lib/browser-nav', () => ({ assignLocation: vi.fn() }))

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
  vi.mocked(assignLocation).mockClear()
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
  // react-router가 클라이언트에서 처리해 서버에 닿지 않는다. 그렇다고 클라이언트가 project id 를
  // 계산해서는 안 된다 — 로컬 서버가 실제로 여는 프로젝트는 `config.projectId ?? LOCAL_PROJECT_ID`
  // 라 연결형 설정에서는 상수와 다를 수 있다(리뷰 I-3). 그래서 전체 이동으로 `/`를 다시 요청해
  // 서버의 판정(server.ts:121)을 그대로 태운다.
  it('로컬 모드에서 / 는 project id 를 계산하지 않고 서버로 전체 이동한다', async () => {
    renderAt('/', {
      'auth.me': () => ({
        data: { id: 'u1', email: 'local@erdd', name: '로컬', role: 'user', mode: 'local' },
      }),
    })
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('/'))
  })

  // 대조군 — I-3 의 ⚠️("서버 모드 경로가 바뀌면 안 된다")를 직접 잠근다.
  it('서버 모드에서는 / 가 그대로 HomePage 다(전체 이동을 하지 않는다)', async () => {
    renderAt('/', {
      'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user' } }),
      'org.list': () => ({ data: [] }),
      'promotion.pendingCount': () => ({ data: { total: 0, byOrg: [] } }),
    })
    expect(await screen.findByRole('button', { name: '팀 조직 만들기' })).toBeInTheDocument()
    expect(assignLocation).not.toHaveBeenCalled()
  })

  // 리뷰 I-1 — 로컬 모드에서 실제로 닿는 비-bare 라우트(에디터 헤더의 「설정」에서 한 번의
  // 클릭)에 사용자 메뉴가 남아 있으면 「로그아웃」(auth.logout, 로컬 라우터에 없어 조용히
  // 실패)·「설정」(→ auth.tokens.list 를 부르는 화면)으로 데려간다. 승격 배지(app-shell.tsx)도
  // 같은 배선(ShellForCurrentUser → AppShell)이라 함께 잠근다(리뷰 M-3).
  it('로컬 모드의 /p/<id>/settings 에는 사용자 메뉴도 승격 배지도 없다', async () => {
    renderAt('/p/proj1/settings', {
      'auth.me': () => ({
        data: { id: 'u1', email: 'local@erdd', name: '로컬', role: 'user', mode: 'local' },
      }),
      'project.get': () => ({
        data: {
          id: 'proj1', orgId: 'local', name: '로컬 프로젝트', description: '',
          dialects: ['postgresql'], createdAt: '2026-01-01T00:00:00.000Z',
          namingRules: DEFAULT_NAMING_RULES, tableOptions: DEFAULT_TABLE_OPTIONS,
          myRole: 'admin', myOrgRole: 'owner',
          canEdit: true, canManage: false,
        },
      }),
      // ⚠️ 이 목이 없으면 배지 단언이 **죽은 단언**이다 — 건수가 0이라 게이트를 지워도
      // 배지가 렌더되지 않아 언제나 통과한다(리뷰 이월 항목). 0보다 큰 건수를 줘서,
      // `isLocal` 게이트가 사라지면 실제로 링크가 생겨 빨개지게 만든다.
      'promotion.pendingCount': () => ({ data: { total: 2, byOrg: [{ orgId: 'o1', count: 2 }] } }),
    })
    await screen.findByText('로컬 프로젝트')
    expect(screen.queryByRole('button', { name: '로컬' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /승격 요청/ })).not.toBeInTheDocument()
  })
})
