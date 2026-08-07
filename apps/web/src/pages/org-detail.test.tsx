import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { OrgDetailPage } from './org-detail.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const ORG_ID = 'o1'
const FUTURE = '2099-06-15T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'

/** 조직 초대는 `orgId`가 있는 초대다 — 관리자 초대(`admin.invitations`)와 다른 목록이다. */
const INVITATIONS = [
  { id: 'inv1', email: 'pending@test.dev', orgRole: 'member', expiresAt: FUTURE, usedAt: null, createdAt: PAST },
  { id: 'inv2', email: 'used@test.dev', orgRole: 'admin', expiresAt: FUTURE, usedAt: PAST, createdAt: PAST },
]

function renderOrg(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  role: 'owner' | 'admin' | 'member' = 'owner',
) {
  mockTrpcFetch({
    'org.list': () => ({ data: [{ id: ORG_ID, name: '팀 조직', kind: 'team', role }] }),
    'project.list': () => ({ data: [] }),
    'org.members.list': () => ({ data: [] }),
    'promotion.listForOrg': () => ({ data: [] }),
    'resource.library.list': () => ({ data: [] }),
    'invitation.listForOrg': () => ({ data: [] }),
    ...handlers,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/org/:orgId', Component: OrgDetailPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={[`/org/${ORG_ID}`]} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OrgDetailPage 초대 섹션', () => {
  it('초대를 만들면 링크가 뜨고 지금만 볼 수 있다고 알린다', async () => {
    const create = vi.fn((_input: unknown) => ({ data: { id: 'inv9', token: 'erdd_inv_org' } }))
    renderOrg({ 'invitation.create': create })
    await userEvent.type(await screen.findByLabelText('초대할 이메일'), 'new@test.dev')
    await userEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    // 조직 역할은 이 폼이 정하고, 서비스 역할은 서버가 항상 'user'로 고정한다.
    expect(create.mock.calls[0]![0]).toEqual({
      orgId: ORG_ID, email: 'new@test.dev', orgRole: 'member',
    })
    // 평문 토큰은 이 응답에서만 나온다. 목록을 다시 불러도 없다 — 잃으면 재발급이다.
    expect(await screen.findByText(/\/invite\/erdd_inv_org/)).toBeDefined()
    expect(screen.getByText(/지금만/)).toBeDefined()
  })

  it('대기 중인 초대를 만료 시각과 함께 보여주고 대기 중인 것만 취소한다', async () => {
    const revoke = vi.fn((_input: unknown) => ({ data: { ok: true } }))
    renderOrg({
      'invitation.listForOrg': () => ({ data: INVITATIONS }),
      'invitation.revoke': revoke,
    })
    const pending = (await screen.findByText('pending@test.dev')).closest('tr')!
    const used = screen.getByText('used@test.dev').closest('tr')!
    expect(within(pending).getByText('대기 중')).toBeDefined()
    expect(within(pending).getByText(/2099/)).toBeDefined()
    expect(within(used).getByText('사용됨')).toBeDefined()
    // 이미 소비된 초대에는 취소가 없다 — 서버도 조건부 UPDATE로 거절한다.
    expect(within(used).queryByRole('button', { name: '취소' })).toBeNull()

    await userEvent.click(within(pending).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke.mock.calls[0]![0]).toEqual({ orgId: ORG_ID, id: 'inv1' })
  })

  it('매니저가 아닌 멤버에게는 초대 섹션이 보이지도 조회되지도 않는다', async () => {
    const listForOrg = vi.fn(() => ({ data: INVITATIONS }))
    renderOrg({ 'invitation.listForOrg': listForOrg }, 'member')
    // 멤버 섹션은 보이므로 화면 자체는 렌더된 상태다.
    expect(await screen.findByRole('heading', { name: '멤버' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '초대' })).toBeNull()
    expect(screen.queryByLabelText('초대할 이메일')).toBeNull()
    // 렌더를 막는 것만으로는 부족하다 — 권한 없는 사용자의 조회 자체가 나가면 안 된다.
    // react-query는 마운트 뒤 비동기로 요청을 띄우므로 바로 단언하면 무엇이든 통과한다.
    await new Promise((done) => { setTimeout(done, 50) })
    expect(listForOrg).not.toHaveBeenCalled()
  })
})
