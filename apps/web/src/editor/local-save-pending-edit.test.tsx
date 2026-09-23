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

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

/**
 * 로컬 서버를 흉내 낸다 — **`model.mutate` 는 한 틱 늦게 반영되고, 저장은 그 순간 서버가 가진
 * 편집만 쓴다.** 실제 브라우저에서 두 요청이 같은 밀리초에 나가 저장이 먼저 처리된 것을 재현한다.
 * 반환하는 `saved` 는 저장 시점에 서버에 반영돼 있던 mutate 본문들이다.
 */
function mockLocalServer() {
  const applied: string[] = []
  const saved: string[][] = []
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === LOCAL_SAVE_PATH) {
      saved.push([...applied])
      return new Response(JSON.stringify({ ok: true, seq: 1, written: ['erdd/tables/T.yaml'], deleted: [] }))
    }
    if (u.includes('model.mutate')) {
      await new Promise((r) => setTimeout(r, 20))
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
  render(<><LocalSaveControls /><EditPanel projectId={PROJECT_ID} /></>, { wrapper: w })
}

function setup() {
  const saved = mockLocalServer()
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
