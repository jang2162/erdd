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
  { id: 'inv3', email: 'expired@test.dev', orgRole: 'member', expiresAt: PAST, usedAt: null, createdAt: PAST },
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

/** Radix Select는 트리거를 눌러 열고 옵션을 눌러 고른다 — 네이티브 `select`가 아니다. */
async function chooseOption(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OrgDetailPage 초대 섹션', () => {
  it('초대를 만들면 링크가 뜨고 지금만 볼 수 있다고 알린다', async () => {
    const create = vi.fn((_input: unknown) => (
      { data: { id: 'inv9', token: 'erdd_inv_org', expiresAt: FUTURE } }
    ))
    renderOrg({ 'invitation.create': create })
    await userEvent.type(await screen.findByLabelText('초대할 이메일'), 'new@test.dev')
    // 조직 역할은 이 폼이 정한다 — 화면이 고른 값이 실제로 실려야 한다. 기본값만 단언하면
    // 이 Select가 죽어도 통과한다(실측: onValueChange를 비워도 통과했다).
    expect(screen.getByLabelText('초대 역할')).toHaveTextContent('Member') // 기본은 Member다
    await chooseOption(screen.getByLabelText('초대 역할'), 'Admin')
    await userEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    // 서비스 역할은 서버가 항상 'user'로 고정한다 — 조직 초대로 관리자가 되지 않는다.
    expect(create.mock.calls[0]![0]).toEqual({
      orgId: ORG_ID, email: 'new@test.dev', orgRole: 'admin',
    })
    // 평문 토큰은 이 응답에서만 나온다. 목록을 다시 불러도 없다 — 잃으면 재발급이다.
    expect(await screen.findByText(/\/invite\/erdd_inv_org/)).toBeDefined()
    expect(screen.getByText(/지금만/)).toBeDefined()
    // 만료도 함께 말한다 — 링크를 전달하는 사람이 "언제까지 유효한지"를 말할 수 있어야 하고,
    // 관리자 초대·재설정 상자가 이미 말하므로 같은 7일 성질을 화면 두 곳이 다르게 말하면 안 된다.
    expect(screen.getByText(/2099.*까지 유효합니다/)).toBeDefined()
    // 링크는 이 이메일에 묶여 있다 — 엉뚱한 사람에게 주면 그가 남의 이메일로 계정을 갖는다.
    // 발급 성공은 입력을 비우므로 상자가 말하지 않으면 수신자가 화면에서 사라진다.
    expect(screen.getByText('new@test.dev')).toBeDefined()

    // 이 상자는 다이얼로그가 아니라 섹션 안에 있다 — 닫을 자리가 없으면 죽은 뒤에도 남는다.
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByText(/\/invite\/erdd_inv_org/)).toBeNull()
  })

  /**
   * 취소하면 그 초대의 링크는 죽는다. 상자가 남아 있으면 "지금만 볼 수 있습니다"를 달고 못 쓰는
   * 링크가 화면에 서 있게 되고, 관리자는 그것을 전달한다.
   */
  it('초대를 취소하면 발급 상자가 사라진다', async () => {
    const create = vi.fn((_input: unknown) => (
      { data: { id: 'inv9', token: 'erdd_inv_org', expiresAt: FUTURE } }
    ))
    const revoke = vi.fn((_input: unknown) => ({ data: { ok: true } }))
    renderOrg({
      'invitation.create': create,
      'invitation.listForOrg': () => ({ data: INVITATIONS }),
      'invitation.revoke': revoke,
    })
    await userEvent.type(await screen.findByLabelText('초대할 이메일'), 'new@test.dev')
    await userEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }))
    expect(await screen.findByText(/\/invite\/erdd_inv_org/)).toBeDefined()

    const pending = screen.getByText('pending@test.dev').closest('tr')!
    await userEvent.click(within(pending).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(revoke).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/\/invite\/erdd_inv_org/)).toBeNull())
  })

  /**
   * 취소는 **아직 소비되지 않은 초대 전부**에 있어야 한다 — '만료됨'으로 보이는 것까지다.
   * 만료 판정은 클라이언트 시계(`Date.now()`) 기준이라, 시계가 앞서 있으면 아직 살아 있는
   * 초대가 만료로 보인다. 그 행에서 취소 버튼을 지우면 **그 초대를 죽일 방법이 없어진다** —
   * 화면 어디에도 다른 취소 수단이 없다. 헛되게 눌린 취소의 대가는 그보다 작다: 서버가
   * 조건부 UPDATE(`usedAt IS NULL`)라 이미 사용된 것은 되살리지도 덮어쓰지도 않는다.
   */
  it('초대를 상태와 함께 보여주고 소비되지 않은 것은 만료로 보여도 취소할 수 있다', async () => {
    const revoke = vi.fn((_input: unknown) => ({ data: { ok: true } }))
    renderOrg({
      'invitation.listForOrg': () => ({ data: INVITATIONS }),
      'invitation.revoke': revoke,
    })
    const pending = (await screen.findByText('pending@test.dev')).closest('tr')!
    const used = screen.getByText('used@test.dev').closest('tr')!
    const expired = screen.getByText('expired@test.dev').closest('tr')!
    expect(within(pending).getByText('대기 중')).toBeDefined()
    expect(within(pending).getByText(/2099/)).toBeDefined()
    expect(within(used).getByText('사용됨')).toBeDefined()
    expect(within(expired).getByText('만료됨')).toBeDefined()
    // 이미 소비된 초대에는 취소가 없다 — 되돌릴 것이 없고 서버도 거절한다. 이 판정은 서버가
    // 보낸 usedAt이라 클라이언트 시계와 무관하다.
    expect(within(used).queryByRole('button', { name: '취소' })).toBeNull()

    await userEvent.click(within(expired).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke.mock.calls[0]![0]).toEqual({ orgId: ORG_ID, id: 'inv3' })

    await userEvent.click(within(pending).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2))
    expect(revoke.mock.calls[1]![0]).toEqual({ orgId: ORG_ID, id: 'inv1' })
  })

  it('매니저가 아닌 멤버에게는 초대 섹션이 보이지도 조회되지도 않는다', async () => {
    const listForOrg = vi.fn(() => ({ data: INVITATIONS }))
    const membersList = vi.fn(() => ({ data: [] }))
    renderOrg({ 'invitation.listForOrg': listForOrg, 'org.members.list': membersList }, 'member')
    // 멤버 섹션은 보이므로 화면 자체는 렌더된 상태다.
    expect(await screen.findByRole('heading', { name: '멤버' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '초대' })).toBeNull()
    expect(screen.queryByLabelText('초대할 이메일')).toBeNull()
    /*
     * 렌더를 막는 것만으로는 부족하다 — 권한 없는 사용자의 조회 자체가 나가면 안 된다.
     * react-query는 마운트 뒤 비동기로 요청을 띄우므로 바로 단언하면 무엇이든 통과한다.
     *
     * 기다리는 신호로 **시간이 아니라 같은 화면의 다른 조회**를 쓴다. 고정 sleep은 오차가
     * 항상 거짓 통과 방향이다 — CI가 느려 요청이 늦게 나가면 조용히 통과한다. 멤버 목록은
     * 초대 목록과 같은 마운트 사이클에서 뜨므로, 그것이 나갔다면 초대 조회도 (켜져 있었다면)
     * 이미 나갔어야 한다.
     */
    await waitFor(() => expect(membersList).toHaveBeenCalled())
    expect(listForOrg).not.toHaveBeenCalled()
  })
})
