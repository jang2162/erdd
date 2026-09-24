import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { createEmptyModel, type ProjectModel, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { settle } from '@/testing/settle'
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
        <ResourcePanel projectId={PROJECT_ID} open onOpenChange={() => {}} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

async function openLibrary() {
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
    // 행 이름 옆 물리명도 원본 약어(MEMBER)를 보이므로 비교 줄 하나로 좁혀 두 값을 본다.
    const diff = screen.getByText('abbreviation').closest('li')
    expect(diff?.textContent).toBe('abbreviation: 현재 MB → 원본 MEMBER')
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
    // 라이브러리 조회가 끝난 뒤에 단언한다 — 전에는 트리거 클릭의 await가 이 시간을 벌어 줬다.
    await settle()
    expect(screen.queryByRole('tab', { name: '조직으로 승격' })).toBeNull()
  })

  it('방향 탭의 트리거는 실제로 있는 탭 패널을 가리킨다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: [
        ...LIBS, { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: true },
      ] }),
      'resource.items.list': () => ({ data: ITEMS }),
      'promotion.listForProject': () => ({ data: [] }),
    }, createEmptyModel())
    const panelOf = (name: string) => {
      const trigger = screen.getByRole('tab', { name })
      const panel = screen.getByRole('tabpanel')
      expect(trigger).toHaveAttribute('aria-selected', 'true')
      expect(panel.id).not.toBe('')
      expect(trigger.getAttribute('aria-controls')).toBe(panel.id)
      return panel
    }
    await screen.findByRole('tab', { name: '가져오기' })
    expect(within(panelOf('가져오기')).getByRole('button', { name: /표준 사전/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '조직으로 승격' }))
    expect(within(panelOf('조직으로 승격')).getByRole('button', { name: /조직 표준/ })).toBeInTheDocument()
  })

  it('라이브러리 조회가 끝나기 전에는 "사용할 수 있는 라이브러리가 없습니다"가 뜨지 않는다', async () => {
    // rows는 libraries.data ?? []라 조회가 pending인 동안도 빈 배열이다 — isPending을
    // 함께 보지 않으면 결국 데이터가 차는 라이브러리 목록에서도 로딩 중 잠깐 빈 상태
    // 문구가 flash한다. fetch를 붙잡아 두고 pending 시점을 직접 확인한다.
    let resolveFetch: (res: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    useEditorStore.getState().setLoaded(createEmptyModel(), 0, PROJECT_ID)
    grantEditPermission({ canEdit: true, canManage: true })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
    render(
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <ResourcePanel projectId={PROJECT_ID} open onOpenChange={() => {}} />
        </TRPCProvider>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('사용할 수 있는 라이브러리가 없습니다')).toBeNull()

    resolveFetch(new Response(JSON.stringify([{ result: { data: [] } }]), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await waitFor(() =>
      expect(screen.getByText('사용할 수 있는 라이브러리가 없습니다')).toBeDefined())
  })

  const manyItems = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, kind: 'word', version: 1,
    payload: {
      logicalName: `단어${String(i).padStart(3, '0')}`, abbreviation: `W${String(i).padStart(3, '0')}`,
      englishName: null, description: null,
    },
  }))

  it('라이브러리 목록의 항목 수를 천 단위로 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: [{ ...LIBS[0], itemCount: 16565 }] }),
    }, createEmptyModel())
    expect(await screen.findByText(/항목 16,565개/)).toBeInTheDocument()
  })

  it('신규 추가는 50건씩 나뉘고, 행에 물리명(약어)이 보이며, 쪽을 넘겨도 선택이 남는다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(60) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (60)')
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    expect(section.getByText('W000')).toBeInTheDocument()
    await userEvent.click(section.getByRole('checkbox', { name: '단어000 선택' }))
    expect(section.getByRole('checkbox', { name: '단어000 선택' })).not.toBeChecked()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.queryByRole('checkbox', { name: '단어000 선택' })).toBeNull()
    expect(section.getByRole('checkbox', { name: '단어050 선택' })).toBeChecked()
    await userEvent.click(section.getByRole('button', { name: '이전' }))
    expect(section.getByRole('checkbox', { name: '단어000 선택' })).not.toBeChecked()
    expect(screen.getByText('처리 대상 59건')).toBeInTheDocument()
  })

  it('라이브러리를 바꾸면 구역의 검색어와 쪽이 처음으로 돌아간다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: [
        ...LIBS, { id: 'l2', scope: 'global', orgId: null, name: '부서 사전', description: '', itemCount: 60, canWrite: false },
      ] }),
      'resource.items.list': () => ({ data: manyItems(60) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (60)')
    const section = () => within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.type(section().getByRole('textbox', { name: '신규 추가 검색' }), '단어')
    await userEvent.click(section().getByRole('button', { name: '다음' }))
    expect(section().getByText('2 / 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /부서 사전/ }))
    await screen.findByText('신규 추가 (60)')
    expect(section().getByRole('textbox', { name: '신규 추가 검색' })).toHaveValue('')
    expect(section().getByText('1 / 2')).toBeInTheDocument()
  })

  it('검색 중 「모두 해제」는 보이는 행이 아니라 구역 전체에 적용된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(60) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (60)')
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), '단어05')
    expect(section.getAllByRole('checkbox')).toHaveLength(10)
    expect(section.getByText('구역 전체 60건에 적용')).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: '모두 해제' }))
    expect(screen.getByText('처리 대상 0건')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled()
  })

  it('5,000건을 넘는 선택도 막지 않고 적용한다 — 나눔은 저수준 경로가 한다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(5001) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(toast.error).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    expect(Object.keys((producer(createEmptyModel()) as ProjectModel).words)).toHaveLength(5001)
  }, 30000)

  it('나눠 적용하는 동안 적용 버튼이 잠기고 「적용 중… 1 / 2」를 보인다', async () => {
    let finish!: (r: string) => void
    mutate.mockImplementationOnce((_producer: unknown, opts: { onProgress?: (d: number, t: number) => void }) => {
      opts.onProgress?.(1, 2)
      return new Promise((resolve) => { finish = resolve })
    })
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' })).toBeDisabled()
    await act(async () => { finish('applied') })
    expect(await screen.findByRole('button', { name: '적용' })).toBeInTheDocument()
  })

  it('조각 적용이 실패로 끝나면 진행 표시가 걷히고 적용 버튼이 다시 열린다', async () => {
    mutate.mockImplementationOnce(async (_producer: unknown, opts: { onProgress?: (d: number, t: number) => void }) => {
      opts.onProgress?.(1, 2)
      return 'error'
    })
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '적용' })).toBeEnabled())
    expect(screen.queryByText(/적용 중…/)).toBeNull()
  })
})
