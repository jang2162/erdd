import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useLocalWatch } from './use-local-watch.js'
import { useEditorStore } from './store.js'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

/** EventSource 는 jsdom 에 없다 — 최소 스텁을 심는다. */
class FakeEventSource {
  static last: FakeEventSource | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false
  constructor(public url: string) { FakeEventSource.last = this }
  close() { this.closed = true }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.last = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('useLocalWatch', () => {
  it('enabled 가 false 면 구독하지 않는다', () => {
    renderHook(() => useLocalWatch(PROJECT_ID, false), { wrapper: wrapper() })
    expect(FakeEventSource.last).toBeNull()
  })

  it('enabled 면 /local/events 를 구독한다', () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    expect(FakeEventSource.last?.url).toContain('/local/events')
  })

  it('reload 를 받으면 모델을 다시 가져와 resync 한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 5 } }),
    })
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'reload' })
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBeGreaterThan(0)
    })
  })

  it('언마운트하면 소켓을 닫는다', () => {
    const { unmount } = renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    const es = FakeEventSource.last!
    unmount()
    expect(es.closed).toBe(true)
  })

  it('blocked 를 받으면 편집을 잠근다', async () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({
      type: 'blocked',
      failures: [{ path: 'erdd/tables/MBR.yaml', message: '파싱 실패' }],
    })
    await waitFor(() => {
      expect(useEditorStore.getState().blocked).toHaveLength(1)
      expect(useEditorStore.getState().canEdit).toBe(false)
    })
  })

  it('다시 reload 를 받으면 편집이 풀린다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 2 } }),
    })
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'blocked', failures: [{ path: 'x', message: 'y' }] })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(false))
    FakeEventSource.last!.emit({ type: 'reload' })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(true))
  })

  it('깨진 동안 project.get 이 다시 와도 편집이 열리지 않는다', async () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'blocked', failures: [{ path: 'x', message: 'y' }] })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(false))
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: true })
    expect(useEditorStore.getState().canEdit).toBe(false)
  })
})
