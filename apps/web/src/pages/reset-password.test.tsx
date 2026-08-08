import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { TRANSIENT_FAILURE_MESSAGE } from '@/lib/link-error'
import { ResetPasswordPage } from './reset-password.js'

const TOKEN = 'erdd_rst_TESTTOKEN'

/**
 * zod 입력 검증 실패의 실제 응답 모양(실측 2026-08-08: `auth.resetPassword`에 7자 비밀번호를
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
  '      "newPassword"',
  '    ],',
  '    "message": "Too small: expected string to have >=8 characters"',
  '  }',
  ']',
].join('\n')

function renderReset(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  const fetchMock = mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([
    { path: '/reset/:token', Component: ResetPasswordPage },
    { path: '/login', Component: () => <p>로그인 화면</p> },
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={[`/reset/${TOKEN}`]} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResetPasswordPage', () => {
  it('shows the new-password form without asking the server first', () => {
    const fetchMock = renderReset({})
    expect(screen.getByLabelText('새 비밀번호')).toBeDefined()
    // 재설정에는 peek이 없다 — 토큰의 생사는 제출해야 알 수 있다.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the token and typed password to resetPassword verbatim', async () => {
    const reset = vi.fn(() => ({ data: { ok: true } }))
    renderReset({ 'auth.resetPassword': reset })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({ token: TOKEN, newPassword: 'password-1' }),
    )
  })

  it('never renders the typed password as visible text', async () => {
    renderReset({})
    const password = screen.getByLabelText('새 비밀번호')
    await userEvent.type(password, 'password-1')
    expect(password.getAttribute('type')).toBe('password')
    expect(document.body.textContent).not.toContain('password-1')
  })

  it('refuses to submit when the two passwords differ', async () => {
    const reset = vi.fn(() => ({ data: { ok: true } }))
    renderReset({ 'auth.resetPassword': reset })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-2')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('비밀번호가 서로 다릅니다')).toBeDefined())
    expect(reset).not.toHaveBeenCalled()
  })

  it('goes to /login after a successful reset', async () => {
    renderReset({ 'auth.resetPassword': () => ({ data: { ok: true } }) })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('로그인 화면')).toBeDefined())
  })

  it('shows the reason and hides the form for a dead token', async () => {
    renderReset({
      'auth.resetPassword': () => ({
        error: { code: -32600, message: '이미 사용된 링크입니다', linkDead: true },
      }),
    })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('이미 사용된 링크입니다')).toBeDefined())
    expect(screen.getByText(/관리자에게/)).toBeDefined()
    expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
    // **초대와 갈리는 경계다.** 소비된 재설정 링크는 다시 받을 수 있다 — 계정이 있으므로
    // 관리자가 `admin.users.resetLink`로 새 링크를 낸다(실측 2026-08-09: 200). 그래서 여기는
    // "관리자에게 문의"가 참이고, 로그인을 가리키면 안 된다(비밀번호를 모르는 사람이다).
    expect(screen.queryByRole('link', { name: '로그인' })).toBeNull()
  })

  // 폼을 지우는 판정은 "오류가 있는가"가 아니라 "다시 제출해도 결과가 같은가"다. 네트워크가
  // 끊긴 것뿐이면 토큰은 아직 살아 있다 — 여기서 폼을 지우면 살아 있는 링크가 죽은 것으로 보이고
  // 회복 경로가 새로고침뿐이 된다.
  it('keeps the form and offers a retry when the network drops', async () => {
    renderReset({ 'auth.resetPassword': () => ({ offline: true }) })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    // 죽은 링크 안내가 아니어야 한다 — 새 링크를 요청할 이유가 없다.
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect(screen.getByRole('button', { name: '비밀번호 설정' })).toBeDefined()
    expect((screen.getByLabelText('새 비밀번호') as HTMLInputElement).value).toBe('password-1')
  })

  /*
   * **입력 검증 실패는 링크를 죽이지 않는다.** zod 실패도 `BAD_REQUEST`로 오므로 코드로
   * 종료성을 판정하면 이것이 종료성으로 오분류된다 — 살아 있는 토큰이 죽은 것으로 표시되고,
   * 폼과 입력이 사라지며, 사유 자리에 zod issue JSON이 그대로 노출된다.
   *
   * 여기서 폼의 `minLength`를 뚫지 않고 서버 응답만 zod 실패로 두는 것이 의도다 — 시험 대상은
   * HTML 검증이 아니라 **서버가 그 오류를 냈을 때 화면이 무엇을 하는가**다. HTML 검증은 방어층
   * 하나일 뿐이고 자동채움·검증 우회·향후 필드 추가·서버 스키마 강화가 그 층을 뚫는다.
   */
  it('keeps the form when the server rejects the input (zod), not the link', async () => {
    renderReset({
      'auth.resetPassword': () => ({ error: { code: -32600, message: ZOD_INPUT_FAILURE } }),
    })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    // 죽은 링크 안내가 아니어야 한다 — 토큰은 아직 살아 있다.
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect((screen.getByLabelText('새 비밀번호') as HTMLInputElement).value).toBe('password-1')
    // zod issue JSON이 사용자에게 노출되지 않아야 한다.
    expect(document.body.textContent).not.toContain('too_small')
  })

  // 5xx도 같다. `data`가 없는 네트워크 오류만 통과시키는 판정으로는 이것이 잡히지 않는다.
  it('keeps the form when the server answers 500', async () => {
    renderReset({
      'auth.resetPassword': () => ({ error: { code: -32603, message: 'Internal server error' } }),
    })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    expect(screen.queryByText(/관리자에게/)).toBeNull()
    expect(screen.getByLabelText('새 비밀번호')).toBeDefined()
  })

  it('resubmits after a transient failure and goes to /login', async () => {
    const reset = vi.fn()
      .mockReturnValueOnce({ offline: true })
      .mockReturnValue({ data: { ok: true } })
    renderReset({ 'auth.resetPassword': reset })
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText(TRANSIENT_FAILURE_MESSAGE)).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))
    await waitFor(() => expect(screen.getByText('로그인 화면')).toBeDefined())
    expect(reset).toHaveBeenCalledTimes(2)
  })
})
