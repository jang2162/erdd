import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { LOCAL_SAVE_PATH } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { EditPanel } from './edit-panel.js'
import { LocalSaveControls } from './local-save-controls.js'
import { useEditorShortcuts } from './use-shortcuts.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

/**
 * 로컬 서버를 흉내 낸다 — **`model.mutate` 는 한 틱 늦게 반영되고, 저장은 그 순간 서버가 가진
 * 편집만 쓴다.** 실제 브라우저에서 두 요청이 같은 밀리초에 나가 저장이 먼저 처리된 것을 재현한다.
 * 반환하는 `saved` 는 저장 시점에 서버에 반영돼 있던 mutate 본문들이다.
 */
function mockLocalServer(opts: { rejectMutate?: boolean } = {}) {
  const applied: string[] = []
  const saved: string[][] = []
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === LOCAL_SAVE_PATH) {
      saved.push([...applied])
      return new Response(JSON.stringify({ ok: true, seq: 1, written: ['erdd/tables/T.yaml'], deleted: [] }))
    }
    if (u.includes('model.get')) {
      // 거절 뒤 useSubmit 이 서버 상태로 되맞추는 재조회다.
      return new Response(JSON.stringify([{ result: { data: { model: buildSampleModel(), seq: 1 } } }]), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (u.includes('model.mutate')) {
      await new Promise((r) => setTimeout(r, 20))
      if (opts.rejectMutate) {
        return new Response(JSON.stringify([{ error: {
          code: -32600, message: '거절됐다', data: { code: 'BAD_REQUEST', httpStatus: 400 },
        } }]), { headers: { 'content-type': 'application/json' } })
      }
      applied.push(String(init?.body))
      return new Response(JSON.stringify([{ result: { data: { seq: 1 + applied.length } } }]), {
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${u}`)
  }))
  return saved
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(
    <><LocalSaveControls /><EditPanel projectId={PROJECT_ID} /><Shortcuts /></>, { wrapper: w },
  )
}

/** 캔버스의 단축키 훅 — 저장 뒤 포커스가 입력란을 떠나면 Backspace 가 선택 테이블을 지운다. */
function Shortcuts() {
  useEditorShortcuts({ projectId: PROJECT_ID })
  return null
}

function setup(opts: { rejectMutate?: boolean } = {}) {
  const saved = mockLocalServer(opts)
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
  // 앞선 편집이 있어 「저장」 버튼이 켜져 있는 상태 — 증상이 드러나는 조건이다.
  useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
  useEditorStore.getState().select('t1')
  renderEditor()
  return saved
}

const pressCmdS = (target: Element) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

/**
 * 입력란은 **blur 에서 커밋한다.** 저장이 그 커밋을 일으키지 않거나(Cmd+S 는 포커스를 옮기지
 * 않는다), 일으켜도 그 편집이 서버에 반영되기를 기다리지 않으면(헤더 클릭은 mousedown 에서
 * blur 하지만 mutate 와 저장 POST 가 동시에 나간다) **방금 친 값이 빠진 채 저장되고 성공 토스트가
 * 뜬다.**
 */
describe('저장은 편집 중인 입력을 먼저 반영한다', () => {
  it('타입 입력란에서 곧바로 Cmd+S', async () => {
    const saved = setup()
    const input = screen.getAllByLabelText('타입')[0] as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'VARCHAR(77)')
    pressCmdS(input)
    await waitFor(() => { expect(saved.length).toBe(1) })
    expect(saved[0]!.join()).toContain('VARCHAR(77)')
  })

  it('물리명 입력란(NamePair — 커밋이 한 틱 늦다)에서 곧바로 Cmd+S', async () => {
    const saved = setup()
    const input = screen.getByLabelText('테이블 물리명') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'GRADE_X')
    pressCmdS(input)
    await waitFor(() => { expect(saved.length).toBe(1) })
    expect(saved[0]!.join()).toContain('GRADE_X')
  })

  it('타입 입력란에서 곧바로 헤더 「저장」 클릭', async () => {
    const saved = setup()
    const input = screen.getAllByLabelText('타입')[0] as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'VARCHAR(99)')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => { expect(saved.length).toBe(1) })
    expect(saved[0]!.join()).toContain('VARCHAR(99)')
  })
})

/**
 * 저장이 blur 로 커밋을 일으키면 포커스가 body 로 떨어진다(`CommitInput` 은 커밋 뒤 `key` 가 바뀌어
 * 리마운트된다). 그러면 단축키 가드(`isTypingTarget`)가 풀려 **이어 친 Backspace 가 선택 테이블을
 * 확인 없이 지운다.** 저장은 원래 칸으로 포커스를 되돌려야 한다.
 */
describe('Cmd+S 뒤 포커스는 원래 칸에 남는다', () => {
  it('타입 입력란(커밋으로 리마운트된다) — Backspace 가 테이블을 지우지 않는다', async () => {
    const saved = setup()
    const input = screen.getAllByLabelText('타입')[0] as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'VARCHAR(77)')
    pressCmdS(input)
    await waitFor(() => { expect(saved.length).toBe(1) })
    const now = screen.getAllByLabelText('타입')[0] as HTMLInputElement
    expect(document.activeElement).toBe(now)
    expect(now.value).toBe('VARCHAR(77)')
    await userEvent.keyboard('{Backspace}')
    expect(useEditorStore.getState().model.tables['t1']).toBeDefined()
    expect(now.value).toBe('VARCHAR(77')
  })

  /**
   * 헤더 버튼은 누르면 포커스를 가져가고, 저장 중 `disabled` 가 되면서 그 포커스를 body 로 떨군다.
   * 버튼이 mousedown 에서 포커스를 가져가지 않아야 저장이 Cmd+S 와 같은 길(blur → 대기 → 복원)을 탄다.
   */
  it('헤더 「저장」 클릭도 — 포커스가 타입 칸에 남고 Backspace 가 테이블을 지우지 않는다', async () => {
    const saved = setup()
    const input = screen.getAllByLabelText('타입')[0] as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'VARCHAR(99)')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => { expect(saved.length).toBe(1) })
    await waitFor(() => { expect(useEditorStore.getState().localSave.saving).toBe(false) })
    expect(document.activeElement).toBe(screen.getAllByLabelText('타입')[0])
    await userEvent.keyboard('{Backspace}')
    expect(useEditorStore.getState().model.tables['t1']).toBeDefined()
  })

  it('테이블 물리명(NamePair) — 같은 요소로 돌아온다', async () => {
    const saved = setup()
    const input = screen.getByLabelText('테이블 물리명') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'GRADE_X')
    pressCmdS(input)
    await waitFor(() => { expect(saved.length).toBe(1) })
    expect(document.activeElement).toBe(screen.getByLabelText('테이블 물리명'))
    await userEvent.keyboard('{Backspace}')
    expect(useEditorStore.getState().model.tables['t1']).toBeDefined()
  })
})

/**
 * 방금 커밋이 서버에서 거절되면 모델은 옛 값으로 되맞춰지지만 `CommitInput` 은 `key` 가 그대로라
 * **거절된 값이 입력란에 남는다.** 그 상태로 저장하고 「저장했습니다」를 띄우면 이 파일이 막으려는
 * 증상(친 값이 빠진 채 성공 토스트) 그대로다.
 */
it('저장 전에 반영하던 편집이 거절되면 저장하지 않는다', async () => {
  const saved = setup({ rejectMutate: true })
  const input = screen.getAllByLabelText('타입')[0] as HTMLInputElement
  await userEvent.clear(input)
  await userEvent.type(input, 'VARCHAR(77)')
  pressCmdS(input)
  await waitFor(() => { expect(useEditorStore.getState().localSave.saving).toBe(false) })
  await new Promise((r) => setTimeout(r, 50))
  expect(saved).toEqual([])
})
