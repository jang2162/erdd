import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useLocalSave } from './use-local-save.js'

const OK = { ok: true, seq: 1, written: ['erdd/tables/MBR.yaml'], deleted: [] }

/** `status` 를 주면 그 코드로 응답한다 — 200 이 아니면 훅이 오류로 다뤄야 한다. */
function mockPost(result: unknown = OK, status = 200): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return Promise.resolve({
      ok: status >= 200 && status < 300, status, json: () => Promise.resolve(result),
    } as Response)
  }))
  return calls
}

// ⚠️ `cleanup()` 이 없으면 앞선 테스트가 마운트한 훅의 keydown 리스너가 document 에 남아
// 「언마운트하면 리스너를 뗀다」가 남의 리스너를 재게 된다.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('useLocalSave', () => {
  it('save 는 POST /local/save 를 부른다', async () => {
    const calls = mockPost()
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    expect(calls).toEqual([`POST ${LOCAL_SAVE_PATH}`])
  })

  it('discard·keep 도 각자의 경로를 POST 한다', async () => {
    const calls = mockPost({ ok: true })
    const { result } = renderHook(() => useLocalSave())
    await result.current.discard()
    await result.current.keep()
    expect(calls).toEqual([`POST ${LOCAL_DISCARD_PATH}`, `POST ${LOCAL_KEEP_PATH}`])
  })

  it('저장에 성공하면 미저장 표시가 내려간다', async () => {
    mockPost()
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    expect(useEditorStore.getState().localSave.dirty).toBe(false)
  })

  /**
   * ⚠️ 저장을 가장 누르고 싶은 순간이 **편집 패널 입력란에 타이핑하던 중**이다.
   * `use-shortcuts.ts` 는 `isTypingTarget`/`isDialogOpen` 에서 먼저 물러나므로 거기 넣을 수 없다.
   */
  it('Cmd+S 는 입력란 안에서도 저장을 부르고 기본 동작을 막는다', async () => {
    const calls = mockPost()
    renderHook(() => useLocalSave())

    const input = document.createElement('input')
    document.body.appendChild(input)
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    await waitFor(() => { expect(calls).toEqual([`POST ${LOCAL_SAVE_PATH}`]) })
    input.remove()
  })

  it('Ctrl+S 도 같다', async () => {
    const calls = mockPost()
    renderHook(() => useLocalSave())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }))
    await waitFor(() => { expect(calls.length).toBe(1) })
  })

  it('수식키 없는 s 는 저장하지 않는다', async () => {
    const calls = mockPost()
    renderHook(() => useLocalSave())
    const e = new KeyboardEvent('keydown', { key: 's', cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(calls).toEqual([])
  })

  /**
   * 서버 모드에서는 이 훅이 **마운트되지 않으므로** 브라우저의 「페이지 저장」이 그대로 뜬다.
   * 언마운트가 리스너를 확실히 떼는지가 그 성질을 받치는 자리다.
   */
  it('언마운트하면 리스너를 뗀다', () => {
    const calls = mockPost()
    const { unmount } = renderHook(() => useLocalSave())
    unmount()
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(calls).toEqual([])
  })

  it('저장이 external 로 거절되면 배너 상태가 선다', async () => {
    mockPost({ ok: false, reason: 'external', message: '밖에서 바뀌었습니다' })
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    await waitFor(() => {
      expect(useEditorStore.getState().localSave).toMatchObject({ dirty: true, external: true })
    })
  })

  it('blocked 거절은 배너를 세우지 않는다 — 이미 손상 배너가 떠 있다', async () => {
    mockPost({ ok: false, reason: 'blocked', message: '파일을 읽을 수 없습니다' })
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    expect(useEditorStore.getState().localSave).toMatchObject({ dirty: true, external: false })
  })

  /**
   * 🔥 **HTTP 오류는 `LocalSaveResult` 가 약속하지 않는 세 번째 결과다.** `store.save()` 는
   * 디스크 가득참·권한 오류에서 예외를 내고 그것은 500 이 된다. 상태 코드를 보지 않으면
   * `r.ok === undefined` 라 거절 갈래로 떨어져 **참이던 `external` 을 거짓으로 덮고** 배너를
   * 지운다 — 사용자는 충돌이 해소된 줄 안다.
   */
  it('HTTP 오류가 배너 상태를 덮지 않는다', async () => {
    mockPost({ error: 'Internal Server Error' }, 500)
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    expect(useEditorStore.getState().localSave).toMatchObject({ dirty: true, external: true })
  })

  it('저장 중에는 두 번째 요청을 보내지 않는다', async () => {
    const calls = mockPost()
    const { result } = renderHook(() => useLocalSave())
    useEditorStore.getState().setSaving(true)
    await result.current.save()
    expect(calls).toEqual([])
  })
})
