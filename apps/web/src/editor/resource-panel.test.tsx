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
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 2, canWrite: false },
]
const ITEMS = [
  { id: 's1', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } },
  { id: 's2', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', description: null } },
]

const mutate = vi.fn()
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function renderPanel(
  handlers: Parameters<typeof mockTrpcFetch>[0], model: ProjectModel,
  perms: { canEdit: boolean; canManage: boolean } = { canEdit: true, canManage: true },
) {
  mockTrpcFetch(handlers)
  useEditorStore.getState().setLoaded(model, 0, PROJECT_ID)
  grantEditPermission(perms)
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

  it('처리할 것이 없으면 적용 버튼이 비활성', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    const forked2: Word = {
      id: 'w2', logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null,
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
      id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null,
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

  it('충돌 항목은 프로젝트 현재값과 원본값을 나란히 보여준다', async () => {
    // "프로젝트 유지"는 이 변경을 검토·거절했다고 영구 기록해 다시 띄우지 않는다 —
    // 값을 못 본 채 고르면 원본 개선을 영원히 놓친다. 프로젝트는 MB, 원본은 MEMBER인
    // 케이스라 abbreviation 필드에 두 값이 모두 화면에 보여야 한다.
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null,
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
    expect(screen.getByText('MB')).toBeDefined()
    expect(screen.getByText('MEMBER')).toBeDefined()
  })

  it('충돌에 "모두 프로젝트 유지"를 적용하면 내용은 그대로, origin.sourceVersion만 올라간다', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null,
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
      id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null,
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
      id: 'w9', logicalName: '회원', abbreviation: 'MEM', englishName: null, description: null, origin: null,
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

  it('항목 조회 실패는 알림으로 뜨고 신규 추가 등 4구역은 렌더하지 않는다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ error: { code: -32004, message: '항목을 불러오지 못했습니다' } }),
    }, createEmptyModel())
    await openLibrary()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('항목을 불러오지 못했습니다'))
    expect(screen.queryByText(/신규 추가/)).toBeNull()
    expect(screen.queryByText(/자동 갱신/)).toBeNull()
    expect(screen.queryByText(/충돌/)).toBeNull()
    expect(screen.queryByText(/최신 상태/)).toBeNull()
  })

  it('편집 권한이 없으면 공용 리소스를 열람만 할 수 있다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel(), { canEdit: false, canManage: false })
    await openLibrary()

    expect(await screen.findByText('신규 추가 (2)')).toBeDefined()
    expect(screen.getByText('회원')).toBeDefined()
    // 선택·일괄·적용 액션은 전부 없다.
    expect(screen.queryByRole('checkbox', { name: /회원/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '모두 선택' })).toBeNull()
    expect(screen.queryByRole('button', { name: '모두 해제' })).toBeNull()
    expect(screen.queryByRole('button', { name: '적용' })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('쓰기 가능한 라이브러리가 없으면 승격 탭이 없다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
    expect(screen.queryByRole('tab', { name: '조직으로 승격' })).toBeNull()
  })
})
