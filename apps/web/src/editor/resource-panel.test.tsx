import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { createEmptyModel, type ProjectModel, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [{ id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 2 }]
const ITEMS = [
  { id: 's1', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } },
  { id: 's2', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', description: null } },
]
// model.mutate의 op 상한(500)과 같은 값. 이보다 많은 신규 항목을 만들어 가드를 넘긴다.
const MANY_ITEMS = Array.from({ length: 501 }, (_, i) => ({
  id: `s${i}`, kind: 'word', version: 1,
  payload: { logicalName: `단어${i}`, abbreviation: `W${i}`, description: null },
}))

const mutate = vi.fn()
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function renderPanel(handlers: Parameters<typeof mockTrpcFetch>[0], model: ProjectModel) {
  mockTrpcFetch(handlers)
  useEditorStore.getState().setLoaded(model, 0, PROJECT_ID)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ResourcePanel projectId={PROJECT_ID} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

async function openLibrary() {
  await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
  await userEvent.click(await screen.findByRole('button', { name: /표준 사전/ }))
}

beforeEach(() => { mutate.mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourcePanel', () => {
  it('최초 가져오기는 전 항목이 "신규 추가"로 뜬다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    expect(await screen.findByText('신규 추가 (2)')).toBeDefined()
    expect(screen.getByText('회원')).toBeDefined()
  })

  it('적용하면 mutate를 한 번 호출한다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    const next = producer(createEmptyModel()) as ProjectModel
    expect(Object.keys(next.words)).toHaveLength(2)
  })

  it('처리 대상이 500건을 넘으면 mutate를 호출하지 않고 토스트로 막는다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: MANY_ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (501)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('처리할 것이 없으면 적용 버튼이 비활성', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    const forked2: Word = {
      id: 'w2', logicalName: '주문', abbreviation: 'ORD', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's2', sourceVersion: 1,
        base: { logicalName: '주문', abbreviation: 'ORD', description: null },
      },
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, { ...createEmptyModel(), words: { w1: forked, w2: forked2 } })
    await openLibrary()
    await waitFor(() => expect(screen.getByRole('button', { name: '적용' }))
      .toHaveProperty('disabled', true))
    expect(screen.getByText(/최신 상태 2건/)).toBeDefined()
  })

  it('충돌은 3상태 라디오로 뜨고 일괄 버튼이 모두를 바꾼다', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{ ...ITEMS[0]!, version: 2, payload: { logicalName: '회원', abbreviation: 'MEMBER', description: null } }],
      }),
    }, { ...createEmptyModel(), words: { w1: forked } })
    await openLibrary()
    expect(await screen.findByText('충돌 (1)')).toBeDefined()
    expect(screen.getByRole('radio', { name: '회원 보류' })).toHaveProperty('checked', true)
    await userEvent.click(screen.getByRole('button', { name: '모두 원본 반영' }))
    expect(screen.getByRole('radio', { name: '회원 원본 반영' })).toHaveProperty('checked', true)
  })

  it('충돌에 "모두 프로젝트 유지"를 적용하면 내용은 그대로, origin.sourceVersion만 올라간다', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forked } }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{ ...ITEMS[0]!, version: 2, payload: { logicalName: '회원', abbreviation: 'MEMBER', description: null } }],
      }),
    }, model)
    await openLibrary()
    expect(await screen.findByText('충돌 (1)')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: '모두 프로젝트 유지' }))
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    const next = producer(model) as ProjectModel
    expect(next.words.w1!.logicalName).toBe('회원')
    expect(next.words.w1!.abbreviation).toBe('MB')
    expect(next.words.w1!.origin?.sourceVersion).toBe(2)
  })

  it('충돌에 "모두 원본 반영"을 적용하면 내용이 원본 값으로 바뀐다', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forked } }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{ ...ITEMS[0]!, version: 2, payload: { logicalName: '회원', abbreviation: 'MEMBER', description: null } }],
      }),
    }, model)
    await openLibrary()
    expect(await screen.findByText('충돌 (1)')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: '모두 원본 반영' }))
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    const next = producer(model) as ProjectModel
    expect(next.words.w1!.logicalName).toBe('회원')
    expect(next.words.w1!.abbreviation).toBe('MEMBER')
    expect(next.words.w1!.origin?.sourceVersion).toBe(2)
  })

  it('이름이 겹치는 신규는 기본 미선택이고 배지가 붙는다', async () => {
    const local: Word = {
      id: 'w9', logicalName: '회원', abbreviation: 'MEM', description: null, origin: null,
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [ITEMS[0]!] }),
    }, { ...createEmptyModel(), words: { w9: local } })
    await openLibrary()
    await screen.findByText('신규 추가 (1)')
    expect(screen.getByRole('checkbox', { name: /회원/ })).toHaveProperty('checked', false)
    expect(screen.getByText('이름 중복')).toBeDefined()
  })
})
