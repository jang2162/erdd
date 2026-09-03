import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH } from '@erdd/core'
import { useEditorStore } from './store.js'
import { LocalSaveBanner, LocalSaveControls } from './local-save-controls.js'

function mockPost(result: unknown = { ok: true }): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return Promise.resolve({ json: () => Promise.resolve(result) } as Response)
  }))
  return calls
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

const setStatus = (dirty: boolean, external: boolean) =>
  useEditorStore.getState().setLocalSaveStatus({ dirty, external })

describe('LocalSaveControls', () => {
  it('미저장이면 표시가 뜨고 저장 버튼이 활성이다', () => {
    mockPost()
    setStatus(true, false)
    render(<LocalSaveControls />)
    expect(screen.getByText('미저장')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /저장$/ })).toBeEnabled()
  })

  it('저장할 것이 없으면 표시도 없고 버튼도 비활성이다', () => {
    mockPost()
    render(<LocalSaveControls />)
    expect(screen.queryByText('미저장')).toBeNull()
    expect(screen.getByRole('button', { name: /저장$/ })).toBeDisabled()
  })

  /**
   * 파일이 깨져 편집이 잠긴 동안에는 저장도 막힌다 — 성한 화면으로 깨진 파일을 덮어쓰면
   * 손으로 고치던 내용이 사라진다.
   */
  it('파일이 깨져 있으면 저장할 수 없다', () => {
    mockPost()
    setStatus(true, false)
    useEditorStore.getState().setBlocked([{ path: 'erdd/', message: '깨졌다' }])
    render(<LocalSaveControls />)
    expect(screen.getByRole('button', { name: /저장$/ })).toBeDisabled()
  })

  /** 「버릴 시도」가 피드백의 동기다 — 버리는 수단이 없으면 드래프트가 재시작을 넘어 살아남는다. */
  it('변경 버리기는 확인을 한 번 받고 나서야 요청을 보낸다', async () => {
    const user = userEvent.setup()
    const calls = mockPost()
    setStatus(true, false)
    render(<LocalSaveControls />)

    await user.click(screen.getByRole('button', { name: '저장 옵션' }))
    await user.click(await screen.findByRole('menuitem', { name: '변경 버리기' }))
    // 확인 전에는 아무것도 보내지 않는다.
    expect(calls).toEqual([])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('저장하지 않은 변경을 버릴까요?')
    await user.click(within(dialog).getByRole('button', { name: '변경 버리기' }))
    expect(calls).toEqual([`POST ${LOCAL_DISCARD_PATH}`])
  })
})

describe('LocalSaveBanner', () => {
  it('external 이 아니면 아무것도 그리지 않는다', () => {
    mockPost()
    const { container } = render(<LocalSaveBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * ⚠️ **배너 문구가 대가를 말해야 한다**(설계 §13 ①, 사용자 확정) — 「내 편집 유지」를 고르면
   * 저장할 때 화면의 내용이 파일을 덮어쓰고, 밖에서 추가된 파일도 지워진다.
   */
  it('external 이면 두 선택지와 그 대가를 보여 준다', () => {
    mockPost()
    setStatus(true, true)
    render(<LocalSaveBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('덮어씁니다')
    expect(screen.getByRole('button', { name: '내 편집 유지' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '파일 다시 읽기' })).toBeInTheDocument()
  })

  it('내 편집 유지는 확인 없이 곧바로 보낸다 — 잃는 것이 없다', async () => {
    const user = userEvent.setup()
    const calls = mockPost()
    setStatus(true, true)
    render(<LocalSaveBanner />)
    await user.click(screen.getByRole('button', { name: '내 편집 유지' }))
    expect(calls).toEqual([`POST ${LOCAL_KEEP_PATH}`])
  })

  it('파일 다시 읽기는 확인을 받는다 — 미저장 작업을 버리는 동작이다', async () => {
    const user = userEvent.setup()
    const calls = mockPost()
    setStatus(true, true)
    render(<LocalSaveBanner />)

    await user.click(screen.getByRole('button', { name: '파일 다시 읽기' }))
    expect(calls).toEqual([])

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '파일 다시 읽기' }))
    expect(calls).toEqual([`POST ${LOCAL_DISCARD_PATH}`])
  })
})
