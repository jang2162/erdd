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

  it('reload 를 받으면 모델을 다시 가져와 resync 한다(setLoaded 가 아니다)', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    // 그룹 뷰는 resync 만 살려 둔다 — setLoaded 는 null 로 튕긴다(use-model.ts 의 주석 참조).
    // 이 값이 살아남는지가 구현이 setLoaded 로 뒤바뀌는 회귀를 잡는 유일한 각도다.
    useEditorStore.getState().enterGroupView('g1')
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 5 } }),
    })
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'reload' })
    // 심어 둔 seq(1)와 다른 값(5)을 정확히 단언한다 — toBeGreaterThan(0)은 seq:1을 미리 심어
    // 두면 즉시 참이 되어 resync가 실제로 불렸는지 가르지 못한다.
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBe(5)
    })
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
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

  it('reload 재조회가 진행 중일 때 도착한 blocked 를 늦게 끝난 reload 가 덮어쓰지 않는다', async () => {
    // 경합 재현: reload 의 재조회(await 구간)가 아직 안 끝난 사이 파일이 다시 깨져 blocked 가
    // 온다. 두 emit 을 await 없이 연달아 호출해 reload 의 serializeMutation 이 아직 스케줄만
    // 된 채(fetchQuery 가 진행되기 전) blocked 가 동기로 먼저 처리되게 한다.
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 5 } }),
    })
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'reload' })
    FakeEventSource.last!.emit({ type: 'blocked', failures: [{ path: 'x', message: 'y' }] })
    // reload 의 재조회는 끝나 seq 는 갱신되지만(모델은 낡지 않았다는 뜻), 그 사이 도착한
    // blocked 가 더 최신 판단이므로 늦게 끝난 reload 가 잠금을 풀면 안 된다.
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBe(5)
    })
    expect(useEditorStore.getState().blocked).not.toBeNull()
    expect(useEditorStore.getState().canEdit).toBe(false)
  })
})

describe('useLocalWatch — status', () => {
  it('status 를 받아 store 에 반영한다', async () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'status', dirty: true, external: false })
    await waitFor(() => {
      expect(useEditorStore.getState().localSave.dirty).toBe(true)
    })
  })

  it('external 도 함께 반영한다', async () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    FakeEventSource.last!.emit({ type: 'status', dirty: true, external: true })
    await waitFor(() => {
      expect(useEditorStore.getState().localSave.external).toBe(true)
    })
  })

  /** 설치본의 웹 번들은 CLI 버전과 따로 움직인다 — 모르는 이벤트에 죽으면 안 된다. */
  it('모르는 이벤트는 조용히 무시한다', () => {
    renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
    expect(() => FakeEventSource.last!.emit({ type: '미래의것' })).not.toThrow()
    expect(useEditorStore.getState().localSave.dirty).toBe(false)
  })
})
