import { describe, expect, it, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { InviteAcceptPage } from './invite-accept.js'

const TOKEN = 'erdd_inv_TESTTOKEN'
const PEEK_OK = { email: 'new@test.dev', orgName: '설계팀', orgRole: 'member' }

function renderInvite(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  opts: { strict?: boolean } = {},
) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([
    { path: '/invite/:token', Component: InviteAcceptPage },
    { path: '/login', Component: () => <p>로그인 화면</p> },
  ])
  const tree = (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={[`/invite/${TOKEN}`]} />
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InviteAcceptPage', () => {
  it('shows the invited email and org from peek', async () => {
    renderInvite({ 'invitation.peek': () => ({ data: PEEK_OK }) })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    expect(screen.getByText(/설계팀/)).toBeDefined()
  })

  // peek은 query가 아니라 mutation이다(설계 §3.5) — 마운트 시 이펙트로 부르므로 StrictMode의
  // 이펙트 2회 호출을 막지 않으면 POST가 두 번 나간다.
  it('peeks exactly once even under StrictMode', async () => {
    const peeked = vi.fn(() => ({ data: PEEK_OK }))
    renderInvite({ 'invitation.peek': peeked }, { strict: true })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    expect(peeked).toHaveBeenCalledTimes(1)
  })

  it('sends the typed name and password to accept verbatim', async () => {
    const accepted = vi.fn(() => ({ data: { ok: true, email: 'new@test.dev' } }))
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': accepted,
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() =>
      expect(accepted).toHaveBeenCalledWith({ token: TOKEN, name: '신규', password: 'password-1' }),
    )
  })

  it('never renders the typed password as visible text', async () => {
    renderInvite({ 'invitation.peek': () => ({ data: PEEK_OK }) })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    const password = screen.getByLabelText('비밀번호')
    await userEvent.type(password, 'password-1')
    expect(password.getAttribute('type')).toBe('password')
    expect(document.body.textContent).not.toContain('password-1')
  })

  it('refuses to submit when the two passwords differ', async () => {
    const accepted = vi.fn(() => ({ data: { ok: true, email: 'new@test.dev' } }))
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': accepted,
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-2')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText('비밀번호가 서로 다릅니다')).toBeDefined())
    expect(accepted).not.toHaveBeenCalled()
  })

  it('goes to /login after a successful accept', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': () => ({ data: { ok: true, email: 'new@test.dev' } }),
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText('로그인 화면')).toBeDefined())
  })

  it('shows the reason and hides the form for a dead token', async () => {
    renderInvite({
      'invitation.peek': () => ({ error: { code: -32600, message: '기한이 지난 링크입니다' } }),
    })
    await waitFor(() => expect(screen.getByText('기한이 지난 링크입니다')).toBeDefined())
    expect(screen.getByText(/관리자에게/)).toBeDefined()
    expect(screen.queryByLabelText('이름')).toBeNull()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
  })

  // peek과 accept 사이에 초대가 죽거나(취소·재발급) 그 이메일이 가입할 수 있다.
  it('shows the reason and hides the form when accept is rejected', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': () => ({ error: { code: -32600, message: '이미 가입한 이메일입니다' } }),
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText('이미 가입한 이메일입니다')).toBeDefined())
    expect(screen.getByText(/관리자에게/)).toBeDefined()
    expect(screen.queryByLabelText('이름')).toBeNull()
  })

  it('says nothing about an org when the invitation has none', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: { email: 'solo@test.dev', orgName: null, orgRole: null } }),
    })
    await waitFor(() => expect(screen.getByText('solo@test.dev')).toBeDefined())
    expect(screen.queryByText(/조직/)).toBeNull()
  })
})
