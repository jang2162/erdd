import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { createEmptyModel, type Domain, type ProjectModel, type Term, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { settle } from '@/testing/settle'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 0, canWrite: false },
  { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: true },
]
// 요청 모드용 — 조직 라이브러리에도 쓰기 권한이 없다(Project Editor의 시야).
const LIBS_NO_WRITE = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 0, canWrite: false },
  { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: false },
]

function word(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
function domain(id: string, name: string): Domain {
  return {
    id, name, category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}
function term(id: string, logicalName: string, domainId: string | null): Term {
  return { id, logicalName, physicalName: 'X', domainId, description: null, origin: null }
}

vi.mock('./use-model.js', () => ({ useModelMutation: () => vi.fn() }))
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

async function openPromoteTab() {
  await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
  await userEvent.click(await screen.findByRole('button', { name: /조직 표준/ }))
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourcePromoteTab', () => {
  it('쓰기 가능한 라이브러리만 목록에 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
    expect(screen.queryByRole('button', { name: /표준 사전/ })).toBeNull()
    expect(screen.getByRole('button', { name: /조직 표준/ })).toBeDefined()
  })

  it('라이브러리를 바꾸면 구역의 검색어와 쪽이 처음으로 돌아간다', async () => {
    const words = Object.fromEntries(Array.from({ length: 60 }, (_, i) => {
      const n = String(i).padStart(3, '0')
      return [`w${n}`, word(`w${n}`, `단어${n}`, `W${n}`)]
    }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: [
        ...LIBS, { id: 'l3', scope: 'org', orgId: 'o1', name: '부서 사전', description: '', itemCount: 0, canWrite: true },
      ] }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words })
    await openPromoteTab()
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

  const manyWords = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
    const id = String(i).padStart(3, '0')
    return [`w${id}`, word(`w${id}`, `단어${id}`, `W${id}`)]
  }))

  it('모델이 바뀌어 계획이 다시 계산돼도 3쪽에서 해제한 체크가 유지되고, 새 항목만 기본 선택된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: manyWords(120) })
    await openPromoteTab()
    await screen.findByText('신규 추가 (120)')
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    await userEvent.click(section.getByRole('checkbox', { name: '단어105 선택' }))
    expect(screen.getByText('올릴 항목 119건')).toBeInTheDocument()
    act(() => {
      useEditorStore.setState((s) => ({ model: { ...s.model, words: { ...s.model.words, w999: word('w999', '단어999', 'W999') } } }))
    })
    expect(await screen.findByText('신규 추가 (121)')).toBeInTheDocument()
    expect(section.getByRole('checkbox', { name: '단어105 선택' })).not.toBeChecked()
    expect(section.getByRole('checkbox', { name: '단어106 선택' })).toBeChecked()
    expect(screen.getByText('올릴 항목 120건')).toBeInTheDocument()
  })

  it('다른 라이브러리로 옮겼다 돌아오면 선택은 처음부터다 — 같은 엔티티라도 다른 라이브러리의 결정을 잇지 않는다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: [
        ...LIBS, { id: 'l3', scope: 'org', orgId: 'o1', name: '부서 사전', description: '', itemCount: 0, canWrite: true },
      ] }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: manyWords(3) })
    await openPromoteTab()
    await screen.findByText('신규 추가 (3)')
    await userEvent.click(screen.getByRole('checkbox', { name: '단어000 선택' }))
    await userEvent.click(screen.getByRole('button', { name: /부서 사전/ }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '단어000 선택' })).toBeChecked())
    await userEvent.click(screen.getByRole('checkbox', { name: '단어001 선택' }))
    expect(screen.getByText('올릴 항목 2건')).toBeInTheDocument()
    // 조직 표준의 항목은 이미 캐시에 있어 계획이 곧바로(빈 계획을 거치지 않고) 다시 계산된다.
    await userEvent.click(screen.getByRole('button', { name: /조직 표준/ }))
    await waitFor(() => expect(screen.getByText('올릴 항목 3건')).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: '단어000 선택' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '단어001 선택' })).toBeChecked()
  })

  it('프로젝트 자체 항목이 "신규 추가"로 뜨고 기본 선택된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('신규 추가 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', true)
  })

  it('동명 항목은 "동명 발견"으로 뜨고 기본 미선택이다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{
          id: 's1', kind: 'word', version: 1,
          payload: { logicalName: '회원', abbreviation: 'MEMBER', englishName: null, description: null },
        }],
      }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('동명 발견 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', false)
  })

  /**
   * 링크된 항목의 payload 가 달라도 원본이 마지막 가져오기 이후 앞섰으면 그 차이는 남이 고친 것이다.
   * 기본 선택하면 승격 한 번에 남이 고친 원본이 이 프로젝트의 옛 값으로 되돌아간다.
   */
  it('원본이 더 새로운 원본 갱신 항목은 기본 미선택이고 배지를 달며, 직접 체크하면 선택된다', async () => {
    const BEHIND = '원본이 더 새롭습니다 — 먼저 가져오기(재동기화)로 받으세요'
    const base = { logicalName: '고객', abbreviation: 'CSTMR', englishName: null, description: null }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [
          // 고객: 이 프로젝트가 v2 로 받은 뒤 남이 CSTM v3 으로 고쳤다.
          { id: 's1', kind: 'word', version: 3, payload: { ...base, abbreviation: 'CSTM' } },
          // 거래처: v2 그대로이고 이 프로젝트가 고쳤다 → 평범한 원본 갱신.
          { id: 's2', kind: 'word', version: 2, payload: { ...base, logicalName: '거래처' } },
        ],
      }),
    }, {
      ...createEmptyModel(),
      words: {
        w1: { id: 'w1', ...base, origin: { libraryId: 'l2', sourceId: 's1', sourceVersion: 2, base } },
        w2: {
          id: 'w2', ...base, logicalName: '거래처', abbreviation: 'CLNT',
          origin: { libraryId: 'l2', sourceId: 's2', sourceVersion: 2, base: { ...base, logicalName: '거래처' } },
        },
      },
    })
    await openPromoteTab()
    expect(await screen.findByText('원본 갱신 (2)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '고객 선택' })).toHaveProperty('checked', false)
    expect(screen.getByRole('checkbox', { name: '거래처 선택' })).toHaveProperty('checked', true)
    expect(screen.getAllByText(BEHIND)).toHaveLength(1)
    expect(screen.getByText(BEHIND).closest('li')!.textContent).toContain('고객')
    expect(screen.queryByText(/요청자가 받은 버전보다 새롭습니다/)).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: '고객 선택' }))
    expect(screen.getByRole('checkbox', { name: '고객 선택' })).toHaveProperty('checked', true)
  })

  it('도메인을 함께 선택하면 "도메인 연결 비움" 경고가 사라진다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, {
      ...createEmptyModel(),
      domains: { d1: domain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'd1') },
    })
    await openPromoteTab()
    await screen.findByText('신규 추가 (2)')
    // 기본은 둘 다 선택 상태라 경고가 없다 → 도메인을 빼면 경고가 뜬다
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    expect(await screen.findByText('도메인 연결 비움')).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    await waitFor(() => expect(screen.queryByText('도메인 연결 비움')).toBeNull())
  })

  it('승격하면 서버 결과를 알리고 그룹 뷰를 유지한 채 모델을 되맞춘다', async () => {
    const promoted = vi.fn(() => ({ data: { seq: 1, inserted: 1, updated: 0, skipped: [] } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    useEditorStore.getState().enterGroupView('g1')
    await openPromoteTab()
    await screen.findByText('신규 추가 (1)')
    await userEvent.click(screen.getByRole('button', { name: '승격' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('추가 1건 · 갱신 0건을 올렸습니다'))
    expect(promoted).toHaveBeenCalledTimes(1)
    // resync를 썼으므로 그룹 뷰가 살아 있다(setLoaded면 null로 튕긴다)
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
    expect(useEditorStore.getState().seq).toBe(1)
  })

  it('편집 권한이 없으면 쓰기 가능한 라이브러리가 있어도 승격 탭이 없다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } }, { canEdit: false, canManage: false })
    // 라이브러리 조회가 끝난 뒤에 단언한다 — 전에는 트리거 클릭의 await가 이 시간을 벌어 줬다.
    await settle()
    expect(screen.queryByRole('tab', { name: '조직으로 승격' })).toBeNull()
  })

  it('쓰기 권한이 없으면 승격 탭이 요청 모드로 열린다', async () => {
    const w = word('w1', '회원', 'MBR')
    // 인자를 선언해야 mock.calls[0]이 빈 튜플이 아니라 [unknown]이 되어 입력을 검사할 수 있다.
    const create = vi.fn((_input: unknown) => ({ data: { id: 'r1', requested: 1, dropped: [] } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
      'resource.items.list': () => ({ data: [] }),
      'promotion.listForProject': () => ({ data: [] }),
      'promotion.create': create,
    }, { ...createEmptyModel(), words: { w1: w } })

    await openPromoteTab()
    expect(await screen.findByRole('button', { name: /승격 요청/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^승격$/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /승격 요청/ }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID, libraryId: 'l2', entityIds: ['w1'],
    })
  })

  it('요청 성공 후 모델을 되맞추지 않는다 — 서버가 모델을 바꾸지 않았다', async () => {
    const w = word('w1', '회원', 'MBR')
    const modelGet = vi.fn(() => ({ data: { model: createEmptyModel(), seq: 9 } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
      'resource.items.list': () => ({ data: [] }),
      'promotion.listForProject': () => ({ data: [] }),
      'promotion.create': () => ({ data: { id: 'r1', requested: 1, dropped: [] } }),
      'model.get': modelGet,
    }, { ...createEmptyModel(), words: { w1: w } })

    await openPromoteTab()
    await userEvent.click(await screen.findByRole('button', { name: /승격 요청/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(modelGet).not.toHaveBeenCalled()
  })

  it('쓰기 권한이 없어도 조직 라이브러리가 있으면 승격 탭이 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
      'resource.items.list': () => ({ data: [] }),
      'promotion.listForProject': () => ({ data: [] }),
    }, createEmptyModel())

    expect(await screen.findByRole('tab', { name: '조직으로 승격' })).toBeTruthy()
  })

  it('대기 중인 요청이 목록에 보이고 취소할 수 있다', async () => {
    const cancel = vi.fn(() => ({ data: { ok: true } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS_NO_WRITE }),
      'resource.items.list': () => ({ data: [] }),
      'promotion.listForProject': () => ({ data: [{
        id: 'r1', libraryId: 'l2', entityIds: ['w1'], note: '올려 주세요',
        status: 'pending', createdAt: '2026-08-04T00:00:00.000Z', resolvedAt: null,
        resolutionNote: '', approvedEntityIds: null, requesterId: 'u1', requesterName: '에디터',
      }] }),
      'promotion.cancel': cancel,
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })

    await openPromoteTab()
    expect(await screen.findByText(/올려 주세요/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /요청 취소/ }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ requestId: 'r1' }))
  })

  /**
   * 도메인 하나 + 단어 n 개 — 계획 항목 순서는 도메인 → 단어다. 같은 종류 안에서 planPromote 는 이름순이므로
   * 논리명을 id 와 같은 폭으로 채워 이름순 = id 순으로 맞춘다(채우지 않으면 `단어999` 가 맨 끝이 된다).
   */
  function bigModel(n: number): ProjectModel {
    const words: Record<string, Word> = {}
    for (let i = 0; i < n; i++) {
      const pad = String(i).padStart(5, '0')
      words[`w${pad}`] = word(`w${pad}`, `단어${pad}`, `W${i}`)
    }
    return { ...createEmptyModel(), domains: { d0: domain('d0', '금액') }, words }
  }

  it('5,000건을 넘는 승격은 계획 순서 그대로 나눠 부르고 결과를 토스트 하나로 합친다 — 도중에 진행을 보인다', async () => {
    let release!: () => void
    const promoted = vi.fn((input: unknown) => {
      const n = (input as { entries: unknown[] }).entries.length
      const reply = { data: { seq: 1, inserted: n, updated: 0, skipped: [] } }
      return promoted.mock.calls.length === 1
        ? reply
        : new Promise<typeof reply>((resolve) => { release = () => resolve(reply) })
    })
    const model = bigModel(5000)
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model, seq: 3 } }),
    }, model)
    await openPromoteTab()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '승격' }))
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' })).toBeDisabled()
    release()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('추가 5,001건 · 갱신 0건을 올렸습니다'))
    expect(promoted).toHaveBeenCalledTimes(2)
    const chunks = promoted.mock.calls.map(([input]) => (input as { entries: { entityId: string }[] }).entries)
    expect(chunks.map((c) => c.length)).toEqual([5000, 1])
    expect(chunks[0]![0]!.entityId).toBe('d0')                   // 도메인이 앞 조각
    expect(chunks[1]![0]!.entityId).toBe('w04999')
  }, 30000)

  it('나눠 부른 승격에서 뒤 조각의 건너뜀은 「이미 반영됐거나」로 알린다 — 앞 조각이 이미 원하는 상태로 만든 항목일 수 있다', async () => {
    const promoted = vi.fn((input: unknown) => {
      const n = (input as { entries: unknown[] }).entries.length
      return promoted.mock.calls.length === 1
        ? { data: { seq: 1, inserted: n, updated: 0, skipped: [] } }
        : { data: { seq: 2, inserted: 0, updated: 0, skipped: [{ entityId: 'w05000', reason: 'missing' }] } }
    })
    const model = bigModel(5000)
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model, seq: 3 } }),
    }, model)
    await openPromoteTab()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '승격' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      '추가 5,000건 · 갱신 0건을 올렸습니다 — 1건은 이미 반영됐거나 그 사이 상태가 바뀌어 건너뛰었습니다',
    ))
    expect(promoted).toHaveBeenCalledTimes(2)
  }, 30000)

  it('중간 조각이 실패하면 몇 건 올렸는지 알리고 계획을 다시 불러온다', async () => {
    const promoted = vi.fn((input: unknown) => (promoted.mock.calls.length === 1
      ? { data: { seq: 1, inserted: (input as { entries: unknown[] }).entries.length, updated: 0, skipped: [] } }
      : { error: { code: -32600, message: '거절' } }))
    const modelGet = vi.fn(() => ({ data: { model: bigModel(5000), seq: 3 } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': modelGet,
    }, bigModel(5000))
    await openPromoteTab()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '승격' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('5,001건 중 5,000건 승격했습니다 — 거절'))
    expect(modelGet).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  }, 30000)
})
