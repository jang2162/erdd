import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { useModelMutation, useUndoRedo } from './use-model.js'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => { act(() => useEditorStore.getState().reset()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('store 선택·히스토리', () => {
  it('select는 rel/note 선택을 해제한다', () => {
    const s = useEditorStore.getState()
    act(() => { s.selectRelationship('R'); s.select('T') })
    const st = useEditorStore.getState()
    expect(st.selectedTableId).toBe('T')
    expect(st.selectedRelationshipId).toBeNull()
  })

  it('selectRelationship는 table/note 선택을 해제한다', () => {
    act(() => {
      useEditorStore.getState().select('T')
      useEditorStore.getState().selectNote('N')
      useEditorStore.getState().selectRelationship('R')
    })
    const st = useEditorStore.getState()
    expect(st.selectedRelationshipId).toBe('R')
    expect(st.selectedTableId).toBeNull()
    expect(st.selectedNoteId).toBeNull()
  })

  it('selectNote는 table/relationship 선택을 해제한다', () => {
    act(() => {
      useEditorStore.getState().select('T')
      useEditorStore.getState().selectRelationship('R')
      useEditorStore.getState().selectNote('N')
    })
    const st = useEditorStore.getState()
    expect(st.selectedNoteId).toBe('N')
    expect(st.selectedTableId).toBeNull()
    expect(st.selectedRelationshipId).toBeNull()
  })

  it('recordEdit는 undo에 쌓고 redo를 비운다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })

  it('moveUndoToRedo는 맨 위 배치를 이동하고 반환한다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
    })
    let moved: unknown
    act(() => { moved = useEditorStore.getState().moveUndoToRedo() })
    expect(moved).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })

  it('setSeq는 역행하지 않는다', () => {
    act(() => { useEditorStore.getState().setSeq(5); useEditorStore.getState().setSeq(3) })
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('setLoaded는 히스토리를 초기화한다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
      useEditorStore.getState().setLoaded({ tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {}, domains: {}, words: {}, terms: {}, customFields: {} }, 1, 'p1')
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })
})

describe('useUndoRedo (훅 통합)', () => {
  it('서버 성공 후 undo가 undoStack의 배치를 redoStack으로 옮긴다', async () => {
    const projectId = '018f6b0e-0000-7000-8000-0000000000aa'
    const TABLE = {
      id: '018f6b0e-0000-7000-8000-000000000002',
      logicalName: '테이블', physicalName: 'table', comment: null, groupId: null,
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const model = { ...createEmptyModel(), tables: { [TABLE.id]: TABLE } }
    useEditorStore.getState().setLoaded(model, 3, projectId)
    grantEditPermission()
    useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: TABLE.id, data: TABLE }])

    mockTrpcFetch({
      'model.mutate': () => ({ data: { seq: 4 } }),
    })

    const { result } = renderHook(() => useUndoRedo(projectId), { wrapper: wrapper() })

    await act(async () => {
      await result.current.undo()
    })

    await waitFor(() => {
      expect(useEditorStore.getState().redoStack).toHaveLength(1)
      expect(useEditorStore.getState().undoStack).toHaveLength(0)
    })
  })

  it('undo 역적용이 불가하면 스택을 이동하지 않는다', async () => {
    // 현재 모델에 없는 테이블 생성 배치를 히스토리에 심으면 역적용(delete)이 throw → submit false.
    // setLoaded('p1')·grantEditPermission을 부르지 않으면 useSubmit의 프로젝트 전환 가드/편집
    // 권한 가드가 producer를 실행하기도 전에 먼저 'error'를 돌려줘, 이 테스트가 검증하려는
    // "역적용 자체가 실패한다"는 경로를 타지 않고도 통과해버린다.
    act(() => {
      useEditorStore.getState().setLoaded(createEmptyModel(), 1, 'p1')
      grantEditPermission()
      useEditorStore.getState().recordEdit([
        { action: 'create', entity: 'table', entityId: 'GHOST', data: {} },
      ])
    })
    const { result } = renderHook(() => useUndoRedo('p1'), { wrapper: wrapper() })
    await act(async () => { await result.current.undo() })
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })
})

describe('프로젝트 전환 가드', () => {
  it('loadedProjectId와 다른 프로젝트의 mutation은 무시한다', async () => {
    // B가 로드된 상태에서 A용 mutate 호출 → producer 실행 전에 bail, 모델·히스토리 불변.
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, 'project-B')
    grantEditPermission()
    const { result } = renderHook(() => useModelMutation('project-A'), { wrapper: wrapper() })
    await act(async () => {
      await result.current((m) => ({
        ...m,
        tables: { ...m.tables, X: {
          id: 'X', logicalName: 'x', physicalName: 'X', comment: null,
          groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
        } },
      }))
    })
    expect(useEditorStore.getState().model.tables.X).toBeUndefined()
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().loadedProjectId).toBe('project-B')
  })
})
