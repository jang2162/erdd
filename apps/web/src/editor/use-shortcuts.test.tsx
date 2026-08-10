import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { serializeColumns } from './clipboard.js'
import { useEditorShortcuts } from './use-shortcuts.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function Harness() {
  useEditorShortcuts({ projectId: PROJECT_ID })
  return <input aria-label="텍스트" />
}

// 실제 렌더에는 trpc provider가 필요하다 — edit-panel.test.tsx의 renderPanel과 같은 wrapper다.
// useModelMutation → useTRPC가 컨텍스트를 요구하므로 wrapper 없이 렌더하면 훅이 던진다.
function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  return render(<Harness />, { wrapper: w })
}

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset()
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  useEditorStore.getState().reset()
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('useEditorShortcuts', () => {
  it('테이블을 선택하고 Cmd+C를 누르면 클립보드에 tables 페이로드가 쓰인다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.__erdd).toBe(1)
    expect(payload.kind).toBe('tables')
  })

  it('컬럼이 선택돼 있으면 columns 페이로드가 쓰인다', async () => {
    useEditorStore.getState().selectColumn('t2', 'c2', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('columns')
    expect(payload.columns).toHaveLength(1)
  })

  // ⚠️ 이 가드가 회귀하면 텍스트를 치는 중 Delete가 테이블을 지운다. 유일한 방어선이다.
  it('입력란에 포커스가 있으면 아무 동작도 하지 않는다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    const input = document.querySelector('input')!
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).not.toHaveBeenCalled()
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  // ⚠️ 붙여넣기 쪽 가드. 입력란에 붙여넣은 텍스트가 모델 변경으로 새면 안 된다.
  it('입력란에 포커스가 있으면 붙여넣기가 모델을 바꾸지 않는다', async () => {
    const payload = serializeColumns(buildSampleModel(), ['c2'])
    useEditorStore.getState().select('t1')
    renderHarness()
    const input = document.querySelector('input')!
    input.focus()
    const before = Object.keys(useEditorStore.getState().model.columns).length
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => JSON.stringify(payload) } })
    input.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(before)
    expect(e.defaultPrevented).toBe(false)
  })

  it('Delete는 선택된 테이블을 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']).toBeUndefined())
  })

  it('컬럼이 선택돼 있으면 Delete가 컬럼만 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.columns['c3']).toBeUndefined())
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  it('paste 이벤트로 컬럼을 붙여넣는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const payload = serializeColumns(buildSampleModel(), ['c2'])
    useEditorStore.getState().select('t1')
    renderHarness()
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', {
      value: { getData: () => JSON.stringify(payload) },
    })
    document.dispatchEvent(e)
    await waitFor(() => {
      const cols = Object.values(useEditorStore.getState().model.columns).filter((c) => c.tableId === 't1')
      expect(cols).toHaveLength(2)
    })
  })

  it('__erdd가 아닌 텍스트를 붙여넣으면 아무 일도 없다', async () => {
    useEditorStore.getState().select('t1')
    renderHarness()
    const before = Object.keys(useEditorStore.getState().model.columns).length
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '그냥 텍스트' } })
    document.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(before)
    // 남의 텍스트는 브라우저 기본 동작에 그대로 넘긴다 — preventDefault를 부르지 않는다.
    // (모델이 안 바뀐 것만 보면 `if (!payload) return`을 지워도 단언은 통과한다. 그때 나는
    //  것은 null 역참조 예외뿐이라 "테스트 실패"가 아니라 "unhandled error"로 새므로,
    //  이 단언이 그 계약을 단언 수준에서 붙잡는다.)
    expect(e.defaultPrevented).toBe(false)
  })

  it('읽기 전용이면 X·V·Delete가 무시되고 C만 동작한다', async () => {
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })
})
