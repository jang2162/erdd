import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel, DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { removeTable } from './model-edits.js'
import { useEditorStore } from './store.js'
import { useModelLoader, useModelMutation } from './use-model.js'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

const NOTE = {
  id: '018f6b0e-0000-7000-8000-000000000001',
  content: '메모', position: { x: 0, y: 0 }, color: '#fff',
}

afterEach(() => {
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('useModelMutation', () => {
  it('derives ops via diffModels, optimistically updates the store, and reconciles seq', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 3, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    const captured: unknown[] = []
    mockTrpcFetch({
      'model.mutate': (input) => { captured.push(input); return { data: { seq: 4 } } },
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    expect(useEditorStore.getState().model.notes[NOTE.id]).toBeDefined()
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(4))
    const sent = captured[0] as { ops: unknown[] }
    expect(sent.ops).toHaveLength(1)
  })

  it('is a no-op when the producer changes nothing', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    let outcome: string | undefined
    await act(async () => { outcome = await result.current((m) => m) })
    expect(outcome).toBe('noop')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useEditorStore.getState().seq).toBe(1)
  })

  it('resyncs from the server when the returned seq skips ahead (concurrent commit interleaved)', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 3, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    const NOTE_B = { ...NOTE, id: '018f6b0e-0000-7000-8000-000000000002', content: '남의 메모' }
    const freshModel = { ...createEmptyModel(), notes: { [NOTE_B.id]: NOTE_B } }
    mockTrpcFetch({
      // seqBefore(3)+1=4를 기대하지만 5가 온다 → 내 mutation이 락을 기다리는 동안
      // 다른 사용자의 revision이 끼어들었다는 뜻.
      'model.mutate': () => ({ data: { seq: 5 } }),
      'model.get': () => ({ data: { model: freshModel, seq: 5 } }),
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(5))
    // resync가 호출됐다면 서버가 돌려준 최신 모델로 통째 교체된다 — 내가 낙관적으로 넣었던
    // NOTE는 사라지고 NOTE_B만 남는다. setSeq(seq)만 호출하는 회귀 버전이면 model.get을
    // 아예 부르지 않아 낙관적으로 넣은 NOTE가 그대로 남고 NOTE_B는 존재하지 않는다.
    expect(useEditorStore.getState().model.notes[NOTE.id]).toBeUndefined()
    expect(useEditorStore.getState().model.notes[NOTE_B.id]).toBeDefined()
  })

  it('rolls back to the server model on mutation error', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 5, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    mockTrpcFetch({
      'model.mutate': () => ({ error: { code: -32600, message: '무결성 위반' } }),
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 5 } }),
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    await waitFor(() => expect(useEditorStore.getState().model.notes[NOTE.id]).toBeUndefined())
  })

  it('모델에서 사라진 테이블은 선택에서도 빠진다 — 살아남은 선택은 그대로 둔다', async () => {
    // 로컬 편집이 모델을 바꾸는 지점은 useSubmit의 낙관적 setModel 한 곳뿐이다(grep 확인).
    // 거기서 걷어내지 않으면 툴바 삭제·undo·DDL 임포트가 저마다 선택을 정리해야 하고,
    // 실제로 툴바는 select(null)로 **통째 비우는** 방식이라 3개 중 1개만 지워도 셋 다 풀린다.
    // 선택을 비우는 것이 아니라 **사라진 것만** 걷어내는지를 겨눈다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectTables(['t1', 't2'])
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => { await result.current((m) => removeTable(m, 't1')) })
    expect(useEditorStore.getState().model.tables.t1).toBeUndefined()
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
  })

  it('서버가 거절하면 죽은 선택을 걷어내고 되맞춘다 — 그룹 뷰·참여자는 살려 둔다', async () => {
    // 실시간 협업의 실제 경로: A가 t1·t2를 고르고 t1을 편집 → 그 사이 B가 t1을 삭제 →
    // 서버가 `op[0] update table t1: 존재하지 않음`으로 거절 → A는 서버 상태로 되감는다.
    // 되감기를 setLoaded로 하면 **모델에 없는 t1이 선택에 남아** BulkPanel 헤더가 "2개 선택됨"인데
    // 목록은 1개가 되고, 존재하지 않는 테이블의 선택이 presence로 계속 나간다(설계 §4의 구멍).
    // 되감기는 "같은 프로젝트를 서버 상태로 되맞추는 것"이므로 seq 간극 경로와 같은 resync여야 한다 —
    // 편집이 거절됐다고 그룹 뷰에서 튕기거나 남들의 하이라이트가 사라지면 안 된다(HANDOFF 3.6).
    const PID = '018f6b0e-0000-7000-8000-0000000000aa'
    useEditorStore.getState().setLoaded(buildSampleModel(), 5, PID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')       // 선택보다 먼저 — 그룹 뷰 진입은 선택을 비운다
    useEditorStore.getState().setPeers([{ userId: 'u2', name: '동료', selections: [] }])
    useEditorStore.getState().selectTables(['t1', 't2'])
    mockTrpcFetch({
      'model.mutate': () => ({ error: { code: -32600, message: 'op[0] update table t1: 존재하지 않음' } }),
      // 서버에는 이미 t1이 없다(B가 지웠다).
      'model.get': () => ({ data: { model: removeTable(buildSampleModel(), 't1'), seq: 6 } }),
    })
    const { result } = renderHook(() => useModelMutation(PID), { wrapper: wrapper() })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })

    await waitFor(() => expect(useEditorStore.getState().model.tables['t1']).toBeUndefined())
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])   // 죽은 t1만 빠진다
    expect(useEditorStore.getState().activeGroupView).toBe('g1')         // setLoaded면 null로 튕긴다
    expect(useEditorStore.getState().peers).toHaveLength(1)              // setLoaded면 통째로 비워진다
  })

  it('편집 권한이 없으면 서버로 보내지도, 모델을 바꾸지도 않는다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 3, '018f6b0e-0000-7000-8000-0000000000aa')
    // grantEditPermission을 부르지 않는다 — store 기본값 canEdit=false 그대로 검증한다.
    const captured: unknown[] = []
    mockTrpcFetch({
      'model.mutate': (input) => { captured.push(input); return { data: { seq: 4 } } },
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    expect(outcome).toBe('error')
    expect(captured).toHaveLength(0)                          // 서버 왕복 없음
    expect(useEditorStore.getState().model.notes).toEqual({})  // 낙관적 적용 없음
  })
})

describe('useModelLoader', () => {
  it('reloads the store when the projectId changes (regression: stale store on project switch)', async () => {
    const oldProjectId = 'aaaaaaaa-0000-7000-8000-000000000001'
    const newProjectId = 'bbbbbbbb-0000-7000-8000-000000000002'
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, oldProjectId)

    const modelWithNote = { ...createEmptyModel(), notes: { [NOTE.id]: NOTE } }
    mockTrpcFetch({
      'model.get': () => ({ data: { model: modelWithNote, seq: 7 } }),
    })

    renderHook(() => useModelLoader(newProjectId), { wrapper: wrapper() })

    await waitFor(() => {
      expect(useEditorStore.getState().loadedProjectId).toBe(newProjectId)
      expect(useEditorStore.getState().model.notes[NOTE.id]).toBeDefined()
    })
  })

  it('프로젝트를 바꾸면 이전 프로젝트의 선택이 넘어오지 않는다', async () => {
    // 프로덕션에 store.reset() 호출부가 한 군데도 없다(테스트에만 있다) — 프로젝트 전환은
    // useModelLoader의 setLoaded 하나로만 이뤄진다. 거기서 비우지 않으면 이전 프로젝트의 선택
    // 배열이 그대로 넘어와, 새 프로젝트를 열자마자 BulkPanel이 "2개 테이블 선택됨 + 빈 목록"으로
    // 뜨고 존재하지 않는 테이블의 선택이 presence로 나간다.
    const oldProjectId = 'aaaaaaaa-0000-7000-8000-000000000003'
    const newProjectId = 'bbbbbbbb-0000-7000-8000-000000000004'
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, oldProjectId)
    useEditorStore.getState().selectTables(['t1', 't2'])
    mockTrpcFetch({ 'model.get': () => ({ data: { model: createEmptyModel(), seq: 7 } }) })

    renderHook(() => useModelLoader(newProjectId), { wrapper: wrapper() })

    await waitFor(() => expect(useEditorStore.getState().loadedProjectId).toBe(newProjectId))
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('project.get의 판정 결과를 store에 싣는다', async () => {
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
      'project.get': () => ({
        data: {
          name: '회원 시스템',
          namingRules: DEFAULT_NAMING_RULES,
          tableOptions: DEFAULT_TABLE_OPTIONS,
          dialects: ['postgresql'],
          canEdit: true,
          canManage: false,
        },
      }),
    })
    renderHook(() => useModelLoader('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await waitFor(() => {
      expect(useEditorStore.getState().canEdit).toBe(true)
    })
    expect(useEditorStore.getState().canManage).toBe(false)
    expect(useEditorStore.getState().dialects).toEqual(['postgresql'])
    expect(useEditorStore.getState().projectName).toBe('회원 시스템')
  })
})
