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
import { TRANSIENT_FAILURE_MESSAGE } from '@/lib/link-error'
import { InviteAcceptPage } from './invite-accept.js'

const TOKEN = 'erdd_inv_TESTTOKEN'
const PEEK_OK = { email: 'new@test.dev', orgName: '설계팀', orgRole: 'member' }

/**
 * zod 입력 검증 실패의 실제 응답 모양(실측 2026-08-08: `invitation.accept`에 7자 비밀번호를
 * 보내면 `BAD_REQUEST` + 이 JSON 배열 문자열이 오고, **같은 토큰으로 곧바로 다시 보내면
 * 200이다** — 토큰은 살아 있었다). `linkDead`는 붙지 않는다.
 */
const ZOD_INPUT_FAILURE = [
  '[',
  '  {',
  '    "origin": "string",',
  '    "code": "too_small",',
  '    "minimum": 8,',
  '    "path": [',
  '      "password"',
  '    ],',
  '    "message": "Too small: expected string to have >=8 characters"',
  '  }',
  ']',
].join('\n')

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
  return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree)
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
      'invitation.peek': () => ({
        error: { code: -32600, message: '기한이 지난 링크입니다', linkDead: true },
      }),
    })
    await waitFor(() => expect(screen.getByText('기한이 지난 링크입니다')).toBeDefined())
    expect(screen.getByText(/관리자에게/)).toBeDefined()
    expect(screen.queryByLabelText('이름')).toBeNull()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
  })

  /*
   * peek과 accept 사이에 초대가 죽거나(취소·재발급) 그 이메일이 가입할 수 있다.
   * 서버는 "이미 가입한 이메일"에 CONFLICT(-32009) + `linkDead`를 준다(`invitation.accept`).
   *
   * **다음 행동이 "새 링크"가 아니다.** 그 이메일로는 초대를 다시 만들 수 없다 —
   * `invitation.create`가 409로 거절한다(실측 2026-08-08: 같은 이메일의 관리자 초대와 조직
   * 초대가 함께 살아 있을 때 하나를 수락하면, 남은 링크의 accept는 409 "이미 가입한
   * 이메일입니다"이고 재발급 시도는 409 "이미 가입한 사용자입니다 — 멤버 추가를 쓰세요"다).
   * 그래서 "관리자에게 문의해 새 링크를 받으세요"는 **존재할 수 없는 다음 행동**이다.
   */
  it('points an already-registered email at login, not at a new link', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': () => ({
        error: { code: -32009, message: '이미 가입한 이메일입니다', linkDead: true },
      }),
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText('이미 가입한 이메일입니다')).toBeDefined())
    // 폼은 지운다 — 다시 제출해도 같은 결과다.
    expect(screen.queryByLabelText('이름')).toBeNull()
    // 불가능한 다음 행동을 안내하지 않는다.
    expect(screen.queryByText(/새 링크를 받으세요/)).toBeNull()
    const login = screen.getByRole('link', { name: '로그인' })
    expect(login.getAttribute('href')).toBe('/login')
  })

  /*
   * **입력 검증 실패는 링크를 죽이지 않는다.** zod 실패도 `BAD_REQUEST`로 오므로 코드로
   * 종료성을 판정하면 이것이 종료성으로 오분류된다 — 살아 있는 초대가 죽은 것으로 표시되고
   * 입력한 이름까지 사라지며, 사유 자리에 zod issue JSON이 노출된다.
   *
   * 폼의 `minLength`를 뚫지 않고 서버 응답만 zod 실패로 두는 것이 의도다 — 시험 대상은 HTML
   * 검증이 아니라 서버가 그 오류를 냈을 때 화면이 무엇을 하는가다.
   */
  it('keeps the form when the server rejects the input (zod), not the link', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: PEEK_OK }),
      'invitation.accept': () => ({ error: { code: -32600, message: ZOD_INPUT_FAILURE } }),
    })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('신규')
    expect(document.body.textContent).not.toContain('too_small')
  })

  it('says nothing about an org when the invitation has none', async () => {
    renderInvite({
      'invitation.peek': () => ({ data: { email: 'solo@test.dev', orgName: null, orgRole: null } }),
    })
    await waitFor(() => expect(screen.getByText('solo@test.dev')).toBeDefined())
    expect(screen.queryByText(/조직/)).toBeNull()
  })

  // peek이 네트워크로 실패한 것은 토큰이 죽었다는 뜻이 아니다. 여기서 죽은 링크 안내를 띄우면
  // 사용자는 헛되이 새 링크를 요청하고, 마운트 1회 가드 때문에 다시 시도할 길도 없다.
  it('offers a retry instead of a dead-link notice when peek fails transiently', async () => {
    renderInvite({ 'invitation.peek': () => ({ offline: true }) })
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeDefined()
  })

  it('peeks again when the retry button is pressed', async () => {
    const peeked = vi.fn()
      .mockReturnValueOnce({ offline: true })
      .mockReturnValue({ data: PEEK_OK })
    renderInvite({ 'invitation.peek': peeked })
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    expect(peeked).toHaveBeenCalledTimes(2)
  })

  // 최악의 변형이 여기 있다 — accept가 서버에서 커밋된 뒤 응답만 유실되면 계정은 만들어졌는데
  // 화면은 "링크가 죽었다"고 말한다. 폼과 입력한 이름을 유지하고 다시 제출할 수 있어야 한다.
  it('keeps the form and the typed name when accept fails transiently', async () => {
    const accepted = vi.fn()
      .mockReturnValueOnce({ offline: true })
      .mockReturnValue({ data: { ok: true, email: 'new@test.dev' } })
    renderInvite({ 'invitation.peek': () => ({ data: PEEK_OK }), 'invitation.accept': accepted })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('신규')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await waitFor(() => expect(screen.getByText('로그인 화면')).toBeDefined())
    expect(accepted).toHaveBeenCalledTimes(2)
  })

  // 비밀번호 관리자가 새 비밀번호를 어느 계정에 묶을지 알려면 username 필드가 폼 안에 있어야 한다.
  it('carries the invited email as a username field for password managers', async () => {
    const { container } = renderInvite({ 'invitation.peek': () => ({ data: PEEK_OK }) })
    await waitFor(() => expect(screen.getByText('new@test.dev')).toBeDefined())
    const username = container.querySelector<HTMLInputElement>('form input[autocomplete="username"]')
    expect(username?.value).toBe('new@test.dev')
  })
})
