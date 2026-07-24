import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
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
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => { await result.current((m) => m) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useEditorStore.getState().seq).toBe(1)
  })

  it('rolls back to the server model on mutation error', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 5, '018f6b0e-0000-7000-8000-0000000000aa')
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
})
