import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import {
  MAX_OPS_PER_MUTATION, createEmptyModel, type Domain, type Op, type ProjectModel,
} from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { serializeMutation, useModelMutation, useUndoRedo } from './use-model.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

const MAX = MAX_OPS_PER_MUTATION
const PID = '018f6b0e-0000-7000-8000-0000000000aa'
const OTHER = '018f6b0e-0000-7000-8000-0000000000bb'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

function withNotes(model: ProjectModel, n: number): ProjectModel {
  const notes = { ...model.notes }
  for (let i = 0; i < n; i++) {
    const id = `n${i}`
    notes[id] = { id, content: `메모${i}`, position: { x: 0, y: 0 }, color: '#fff' }
  }
  return { ...model, notes }
}

function domain(id: string): Domain {
  return {
    id, name: id, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}

type Sent = { projectId: string; ops: Op[]; summary?: string }

/**
 * model.mutate 스텁. 기본은 seq 를 1씩 올린다. `seqs` 를 주면 i번째 호출에 그 seq 를 돌려주고,
 * `fail` 번째 호출은 거절하며, `onCall` 은 응답 전에 부른다(그 사이의 사건을 흉내 낸다).
 */
function serverStub(opts: {
  seqs?: number[]; fail?: number; fresh?: ProjectModel; onCall?: (i: number) => void
} = {}) {
  const sent: Sent[] = []
  const freshCalls: number[] = []
  let seq = 1
  mockTrpcFetch({
    'model.mutate': (input) => {
      const i = sent.length
      sent.push(input as Sent)
      opts.onCall?.(i)
      if (opts.fail === i) return { error: { code: -32600, message: '거절됨' } }
      seq = opts.seqs?.[i] ?? seq + 1
      return { data: { seq } }
    },
    'model.get': () => {
      freshCalls.push(1)
      return { data: { model: opts.fresh ?? createEmptyModel(), seq: 99 } }
    },
  })
  return { sent, freshCalls }
}

function setup() {
  useEditorStore.getState().setLoaded(createEmptyModel(), 1, PID)
  grantEditPermission()
  return renderHook(
    () => ({ mutate: useModelMutation(PID), history: useUndoRedo(PID) }),
    { wrapper: wrapper() },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
  useEditorStore.getState().reset()
})

describe('useModelMutation — 5,000 op 를 넘는 편집은 나눠 보낸다', () => {
  it('5,000건 이하는 지금처럼 한 번에 보내고 요약에 번호를 붙이지 않으며 진행도 알리지 않는다', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    const progress = vi.fn()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, MAX), { summary: '메모 추가', onProgress: progress })
    })
    expect(outcome).toBe('applied')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.ops).toHaveLength(MAX)
    expect(sent[0]!.summary).toBe('메모 추가')
    expect(progress).not.toHaveBeenCalled()
    expect(useEditorStore.getState().seq).toBe(2)
  })

  it('넘으면 5,000씩 차례로 보내고 요약에 조각 번호를 붙이며, 실행 취소 기록은 전체 op 하나다', async () => {
    const { sent, freshCalls } = serverStub()
    const { result } = setup()
    const progress = vi.fn()
    await act(async () => {
      await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가', onProgress: progress })
    })
    expect(sent.map((s) => s.ops.length)).toEqual([MAX, MAX, 1])
    expect(sent.map((s) => s.summary)).toEqual(['메모 추가 (1/3)', '메모 추가 (2/3)', '메모 추가 (3/3)'])
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
    expect(freshCalls).toHaveLength(0)                  // seq 가 이어졌으므로 되맞추지 않는다
    expect(useEditorStore.getState().seq).toBe(4)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().undoStack[0]).toHaveLength(2 * MAX + 1)
  })

  it('진행 콜백이 던져도 적용은 그대로 끝까지 간다 — 낙관적 상태가 남거나 실패로 갈리지 않는다', async () => {
    const { sent, freshCalls } = serverStub()
    const { result } = setup()
    const progress = vi.fn(() => { throw new Error('boom') })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가', onProgress: progress })
    })
    expect(outcome).toBe('applied')
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
    expect(sent.map((s) => s.ops.length)).toEqual([MAX, 1])
    expect(freshCalls).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(MAX + 1)
    expect(useEditorStore.getState().seq).toBe(3)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('조각은 diffModels 순서 그대로다 — 부모(도메인)가 앞 조각, 그것을 가리키는 용어가 뒤 조각', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    await act(async () => {
      await result.current.mutate((m) => {
        const domains = { ...m.domains }
        for (let i = 0; i < MAX; i++) domains[`d${i}`] = domain(`d${i}`)
        return {
          ...m, domains,
          terms: { t1: { id: 't1', logicalName: '금액', physicalName: 'AMT', domainId: `d${MAX - 1}`, description: null, origin: null } },
        }
      }, { summary: '사전' })
    })
    expect(sent).toHaveLength(2)
    expect(sent[0]!.ops.every((op) => op.entity === 'domain')).toBe(true)
    expect(sent[1]!.ops).toEqual([expect.objectContaining({ action: 'create', entity: 'term', entityId: 't1' })])
  })

  it('실행 취소 한 번이 역연산 전부를 조각으로 보내고, 다시 실행도 그렇다', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    await act(async () => { await result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' }) })
    await act(async () => { await result.current.history.undo() })
    expect(sent.slice(2).map((s) => s.summary)).toEqual(['실행 취소 (1/2)', '실행 취소 (2/2)'])
    expect(sent.slice(2).flatMap((s) => s.ops).every((op) => op.action === 'delete')).toBe(true)
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(0)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
    await act(async () => { await result.current.history.redo() })
    expect(sent.slice(4).map((s) => s.summary)).toEqual(['다시 실행 (1/2)', '다시 실행 (2/2)'])
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(MAX + 1)
  })

  it('중간 조각이 실패하면 거기서 멈추고 서버 상태로 되맞추며 실행 취소 기록을 남기지 않는다', async () => {
    const fresh = withNotes(createEmptyModel(), 3)
    const { sent, freshCalls } = serverStub({ fail: 1, fresh })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('error')
    expect(sent).toHaveLength(2)                          // 셋째 조각은 보내지 않는다
    expect(toast.error).toHaveBeenCalledWith('3개 묶음 중 1개를 적용했고 나머지는 적용하지 못했습니다 — 거절됨')
    expect(freshCalls).toHaveLength(1)
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(3)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })

  it('첫 조각이 실패하면 지금의 단일 실패와 같은 문구로 알린다', async () => {
    const { sent } = serverStub({ fail: 0 })
    const { result } = setup()
    await act(async () => { await result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' }) })
    expect(sent).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('거절됨')
  })

  it('조각 사이에 남의 편집이 끼면 남은 조각을 끝까지 보낸 뒤 서버 모델로 되맞춘다', async () => {
    const fresh = withNotes(createEmptyModel(), 2 * MAX + 1)
    const { sent, freshCalls } = serverStub({ seqs: [2, 4, 5], fresh })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('applied')
    expect(sent).toHaveLength(3)
    expect(freshCalls).toHaveLength(1)
    expect(useEditorStore.getState().seq).toBe(99)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('조각 사이에 프로젝트를 떠나도 남은 조각은 끝까지 옛 프로젝트로 보내고, 새 프로젝트의 store 는 건드리지 않는다', async () => {
    const { sent, freshCalls } = serverStub({
      // 조각 사이에 이탈과 끼어든 revision 을 함께 흉내 낸다 — 간극이 있어도 새 프로젝트를 되맞추지 않는다.
      seqs: [2, 5, 6],
      onCall: (i) => { if (i === 0) useEditorStore.getState().setLoaded(createEmptyModel(), 7, OTHER) },
    })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('error')
    expect(sent.map((s) => [s.projectId, s.ops.length])).toEqual([[PID, MAX], [PID, MAX], [PID, 1]])
    expect(freshCalls).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
    const s = useEditorStore.getState()
    expect(s.loadedProjectId).toBe(OTHER)
    expect(s.model.notes).toEqual({})
    expect(s.seq).toBe(7)
    expect(s.undoStack).toHaveLength(0)
  })

  it('떠난 뒤 남은 조각이 실패하면 몇 묶음이 들어갔는지 알리되 새 프로젝트를 되맞추지 않는다', async () => {
    const { sent, freshCalls } = serverStub({
      fail: 2,
      onCall: (i) => { if (i === 0) useEditorStore.getState().setLoaded(createEmptyModel(), 7, OTHER) },
    })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('error')
    expect(sent.map((s) => s.projectId)).toEqual([PID, PID, PID])
    expect(toast.error).toHaveBeenCalledWith('3개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 거절됨')
    expect(freshCalls).toHaveLength(0)
    expect(useEditorStore.getState().seq).toBe(7)
    expect(useEditorStore.getState().model.notes).toEqual({})
  })

  it('조각을 보내는 동안 줄을 선 실시간 처리는 모든 조각 뒤에 돌고, 적용 중에 누른 실행 취소는 한 번에 전부 되돌린다', async () => {
    const order: string[] = []
    const { sent } = serverStub({
      onCall: (i) => {
        order.push(`chunk${i}`)
        // 첫 조각의 응답을 기다리는 사이 실시간 op 가 도착했다(use-realtime 은 같은 체인에 줄을 선다).
        if (i === 0) void serializeMutation(async () => { order.push('realtime') })
      },
    })
    const { result } = setup()
    await act(async () => {
      const applying = result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' })
      // 적용이 끝나기 전에 실행 취소를 누른다 — 체인에서 적용 바로 뒤, 실시간 처리 앞에 선다.
      void result.current.history.undo()
      await applying
    })
    await act(async () => { await serializeMutation(async () => undefined) })   // 체인을 비운다
    expect(order).toEqual(['chunk0', 'chunk1', 'chunk2', 'chunk3', 'realtime'])
    expect(sent.map((s) => s.summary)).toEqual(['메모 추가 (1/2)', '메모 추가 (2/2)', '실행 취소 (1/2)', '실행 취소 (2/2)'])
    expect(useEditorStore.getState().model.notes).toEqual({})
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })
})
