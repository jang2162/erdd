import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { OneTimeLink } from './one-time-link.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

/** jsdom에는 `navigator.clipboard`가 없다 — 갈래마다 이 함수로 만들어 둔다. */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText === null ? undefined : { writeText: vi.fn(writeText) },
  })
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('OneTimeLink', () => {
  it('복사에 성공하면 성공을 알린다', async () => {
    stubClipboard(() => Promise.resolve())
    render(<OneTimeLink kind="invite" token="erdd_inv_x" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith('복사했습니다'))
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0])
      .toContain('/invite/erdd_inv_x')
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  /**
   * 클립보드는 secure context에서만 있다. 없는데 "복사했습니다"라고 말하면 관리자는 붙여넣기가
   * 될 것으로 믿고 상자를 닫는다 — 평문 토큰은 발급 응답에서만 나오므로 그 링크는 사라진다.
   */
  it('클립보드가 없으면 복사했다고 말하지 않고 다음 행동을 알린다', async () => {
    stubClipboard(null)
    render(<OneTimeLink kind="invite" token="erdd_inv_x" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled())
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toMatch(/직접 선택/)
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
    // 링크 자체는 그대로 보인다 — 직접 선택해 복사할 수 있어야 안내가 실행 가능하다.
    expect(screen.getByText(/\/invite\/erdd_inv_x/)).toBeDefined()
  })

  it('클립보드가 거절하면 복사했다고 말하지 않는다', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')))
    render(<OneTimeLink kind="reset" token="erdd_rst_x" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled())
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
  })

  it('수신자를 주면 상자 안에 보여주고, 안 주면 그 줄이 없다', () => {
    const { unmount } = render(
      <OneTimeLink kind="invite" token="erdd_inv_x" recipient="new@test.dev" />,
    )
    expect(screen.getByText('new@test.dev')).toBeDefined()
    unmount()

    render(<OneTimeLink kind="invite" token="erdd_inv_x" />)
    expect(screen.queryByText(/받는 사람/)).toBeNull()
  })

  it('onDismiss를 주면 닫기가 생기고 안 주면 없다', async () => {
    const onDismiss = vi.fn()
    const { unmount } = render(
      <OneTimeLink kind="invite" token="erdd_inv_x" onDismiss={onDismiss} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onDismiss).toHaveBeenCalled()
    unmount()

    render(<OneTimeLink kind="invite" token="erdd_inv_x" />)
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
  })
})
