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
import { AdminPage } from './admin.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const USERS = [
  { id: 'u1', email: 'admin@test.dev', name: '관리자', role: 'admin', isActive: true, createdAt: '2026-07-24T00:00:00Z' },
  { id: 'u2', email: 'user@test.dev', name: '사용자', role: 'user', isActive: false, createdAt: '2026-07-24T00:00:00Z' },
]

const FUTURE = '2099-06-15T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'

/** 관리자 초대는 `orgId`가 null인 초대다 — 조직 초대와 다른 목록이다(설계 §5.4). */
const INVITATIONS = [
  { id: 'i1', email: 'pending@test.dev', userRole: 'user', expiresAt: FUTURE, usedAt: null, createdAt: PAST },
  { id: 'i2', email: 'used@test.dev', userRole: 'admin', expiresAt: FUTURE, usedAt: PAST, createdAt: PAST },
  { id: 'i3', email: 'expired@test.dev', userRole: 'user', expiresAt: PAST, usedAt: null, createdAt: PAST },
]

function renderAdmin(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch({
    'admin.users.list': () => ({ data: USERS }),
    'admin.invitations.list': () => ({ data: [] }),
    ...handlers,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/admin', Component: AdminPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/admin']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

/**
 * **비밀번호를 받는 입력이 화면 어디에도 없다**(설계 §3.1). 세 갈래로 본다 — `type="password"`
 * 입력, 라벨이 비밀번호를 가리키는 입력, `autocomplete`가 `-password`로 끝나는 입력.
 * 옛 폼(`초기 비밀번호`)은 평문 `type` 없는 Input이었으므로 첫 갈래만 보면 그것을 되살려도
 * 잡히지 않는다.
 *
 * 라벨 갈래는 문구를 넓게 본다 — `비밀번호`만 보면 라벨을 `초기 암호`로 바꾼 같은 입력이 그대로
 * 통과했다(실측). 라벨은 자유 문구라 완전히 봉인할 수는 없고, 이것은 흔한 표기를 덮는 저비용
 * 보강이다. `autocomplete` 갈래가 라벨과 무관한 두 번째 축이다 — 브라우저 자동완성을 받으려면
 * 무슨 라벨을 붙이든 `new-password`/`current-password`를 써야 한다.
 *
 * `selector`로 폼 컨트롤에 한정하는 것이 의도다 — 재설정 다이얼로그는 제목이
 * "비밀번호 재설정 링크"라 `aria-labelledby`로 다이얼로그 자체가 이름에 걸린다.
 */
function expectNoPasswordField() {
  expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
  expect(screen.queryAllByLabelText(/비밀번호|암호|password|pw/i, { selector: 'input, textarea' }))
    .toHaveLength(0)
  expect(document.querySelectorAll('input[autocomplete$="-password"]')).toHaveLength(0)
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

describe('AdminPage', () => {
  it('lists accounts with role and status badges', async () => {
    renderAdmin({ 'admin.users.list': () => ({ data: USERS }) })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    expect(screen.getByText('비활성')).toBeDefined()
    expect(screen.getAllByText('관리자').length).toBeGreaterThan(0)
  })

  it('계정 초대가 링크를 내고 지금만 볼 수 있다고 알린다', async () => {
    const invite = vi.fn((_input: unknown) => ({
      data: { id: 'i9', token: 'erdd_inv_new', expiresAt: FUTURE },
    }))
    renderAdmin({ 'admin.users.invite': invite })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '계정 초대' }))
    await userEvent.type(screen.getByLabelText('이메일'), 'new@test.dev')
    // 서비스 역할은 초대 행이 들고 간다(설계 §5.4) — 화면이 고른 값이 실제로 실려야 한다.
    // 기본값만 단언하면 이 Select가 죽어도 통과한다(실측: onValueChange를 비워도 통과했다).
    expect(screen.getByLabelText('역할')).toHaveTextContent('일반') // 기본은 일반 사용자다
    await chooseOption(screen.getByLabelText('역할'), '관리자')
    await userEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }))
    await waitFor(() => expect(invite).toHaveBeenCalled())
    expect(invite.mock.calls[0]![0]).toEqual({ email: 'new@test.dev', role: 'admin' })
    // 평문 토큰은 이 응답에서만 나온다. 목록을 다시 불러도 없다 — 잃으면 재발급이다.
    expect(await screen.findByText(/\/invite\/erdd_inv_new/)).toBeDefined()
    expect(screen.getByText(/지금만/)).toBeDefined()
    expect(screen.getByText(/까지 유효/)).toBeDefined()
    // 링크는 이 이메일에 묶여 있다 — 엉뚱한 사람에게 주면 그가 남의 이메일로 계정을 갖는다.
    // 발급 성공은 입력을 비우므로 상자가 말하지 않으면 수신자가 화면에서 사라진다.
    expect(screen.getByText('new@test.dev')).toBeDefined()
  })

  it('관리자 화면에는 비밀번호 입력란이 하나도 없다', async () => {
    renderAdmin({})
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    expectNoPasswordField()

    await userEvent.click(screen.getByRole('button', { name: '계정 초대' }))
    expect(await screen.findByRole('dialog')).toBeDefined()
    expectNoPasswordField()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(screen.getAllByRole('button', { name: '비밀번호 재설정 링크' })[0]!)
    expect(await screen.findByRole('dialog')).toBeDefined()
    expectNoPasswordField()
  })

  it('재설정은 링크만 내고 비밀번호가 바뀌었다고 말하지 않는다', async () => {
    const resetLink = vi.fn((_input: unknown) => ({
      data: { id: 'r1', token: 'erdd_rst_new', expiresAt: FUTURE },
    }))
    renderAdmin({ 'admin.users.resetLink': resetLink })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    await userEvent.click(screen.getAllByRole('button', { name: '비밀번호 재설정 링크' })[0]!)
    await userEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    await waitFor(() => expect(resetLink).toHaveBeenCalled())
    expect(resetLink.mock.calls[0]![0]).toEqual({ userId: 'u1' })
    expect(await screen.findByText(/\/reset\/erdd_rst_new/)).toBeDefined()
    // 재설정은 24시간짜리다 — 초대(7일)보다 훨씬 짧고 목록 화면도 없어서, 이 상자가 말하지
    // 않으면 기한을 확인할 자리가 어디에도 없다.
    expect(screen.getByText(/까지 유효/)).toBeDefined()
    /*
     * 발급은 링크를 만들 뿐이다. 비밀번호는 사용자가 그 링크를 열어 정해야 바뀐다 —
     * 화면이 "바꿨다"고 말하면 거짓이고, 관리자는 전달을 그만둔다.
     *
     * 그 성질을 잡는 것은 **아래 두 줄**이다. 거짓 문구를 정규식으로 나열해 막으려던 줄은
     * 지웠다 — 실측으로 '비밀번호가 변경되었습니다.'가 그대로 통과했다. 거짓말의 표현은
     * 무한하므로 리터럴 나열은 봉인이 아니고, 남겨 두면 "잡고 있다"는 인상만 준다.
     * 성공 토스트 부재는 이 화면이 성공을 선언하는 유일한 수단을 막고, 안내문 존재는
     * "아직 안 바뀌었고 사용자가 열어야 한다"는 정확한 문장이 실제로 화면에 있음을 잠근다.
     */
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
    expect(screen.getByText(/링크를 열어/)).toBeDefined()
  })

  it('관리자 초대 목록을 상태와 함께 보여주고 대기 중인 것만 취소한다', async () => {
    const revoke = vi.fn((_input: unknown) => ({ data: { ok: true } }))
    renderAdmin({
      'admin.invitations.list': () => ({ data: INVITATIONS }),
      'admin.invitations.revoke': revoke,
    })
    const pending = (await screen.findByText('pending@test.dev')).closest('tr')!
    const used = screen.getByText('used@test.dev').closest('tr')!
    const expired = screen.getByText('expired@test.dev').closest('tr')!
    expect(within(used).getByText('사용됨')).toBeDefined()
    expect(within(expired).getByText('만료됨')).toBeDefined()
    expect(within(pending).getByText('대기 중')).toBeDefined()
    // 이미 소비됐거나 기한이 지난 초대에는 취소가 없다 — 서버도 조건부 UPDATE로 거절한다.
    expect(within(used).queryByRole('button', { name: '취소' })).toBeNull()
    expect(within(expired).queryByRole('button', { name: '취소' })).toBeNull()

    await userEvent.click(within(pending).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke.mock.calls[0]![0]).toEqual({ id: 'i1' })
  })
})
