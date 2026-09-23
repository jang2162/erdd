import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { PromotionRequestsSection } from './promotion-requests-section'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const ORG_ID = 'o1'
const ROW = {
  id: 'r1', projectId: 'p1', projectName: '회원 시스템',
  libraryId: 'l2', libraryName: '조직 표준', requesterName: '에디터',
  note: '올려 주세요', entityIds: ['w1', 'w2'], itemCount: 2,
  status: 'pending', createdAt: '2026-08-04T00:00:00.000Z',
  resolvedAt: null, resolutionNote: '', approvedEntityIds: null,
}
const ENTRY = {
  kind: 'word', entityId: 'w1', name: '회원', status: 'new',
  targetItemId: null, targetVersion: null, payload: {}, changedFields: [], domainRef: null,
  sourceBehind: false,
}

/**
 * `stall`에 경로를 주면 그 요청만 영원히 pending으로 붙든다 — mockTrpcFetch는 즉시
 * 응답하므로 로딩 상태를 관찰하려면 fetch를 한 겹 더 감싸야 한다.
 */
function renderSection(
  handlers: Parameters<typeof mockTrpcFetch>[0], canManage = true,
  opts: { stall?: string } = {},
) {
  const base = mockTrpcFetch(handlers)
  if (opts.stall !== undefined) {
    const stalled = opts.stall
    vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => (
      String(url).includes(stalled) ? new Promise<Response>(() => {}) : base(url, init)
    ))
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <PromotionRequestsSection orgId={ORG_ID} canManage={canManage} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

/** 무효화된 queryKey들을 평평한 문자열로 — 키 내부 형태에 의존하지 않고 검사한다. */
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map(
    (call) => JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
  )
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PromotionRequestsSection', () => {
  it('관리 권한이 없으면 렌더도 조회도 하지 않는다', async () => {
    const listForOrg = vi.fn(() => ({ data: [ROW] }))
    renderSection({ 'promotion.listForOrg': listForOrg }, false)
    expect(screen.queryByText(/승격 요청/)).toBeNull()
    // 렌더를 막는 것만으로는 부족하다 — 권한 없는 사용자의 조회 자체가 나가면 안 된다.
    // react-query는 마운트 뒤 비동기로 요청을 띄우므로 바로 단언하면 무엇이든 통과한다.
    await new Promise((done) => { setTimeout(done, 50) })
    expect(listForOrg).not.toHaveBeenCalled()
  })

  it('대기 요청을 목록에 보여준다', async () => {
    renderSection({ 'promotion.listForOrg': () => ({ data: [ROW] }) })
    expect(await screen.findByText(/회원 시스템/)).toBeTruthy()
    expect(screen.getByText(/에디터/)).toBeTruthy()
    expect(screen.getByText(/올려 주세요/)).toBeTruthy()
  })

  it('검토를 열면 지금 계산된 계획과 unavailable을 보여준다', async () => {
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: ['w2'],
      } }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    expect(await screen.findByLabelText('회원 선택')).toBeTruthy()
    expect(screen.getByText(/1건은 이미 반영됐거나 삭제되어 처리할 수 없습니다/)).toBeTruthy()
  })

  it('선택한 항목만 승인한다', async () => {
    const resolve = vi.fn((_input: unknown) => ({ data: {
      status: 'resolved', seq: 5, inserted: 1, updated: 0, skipped: [],
    } }))
    const modelGet = vi.fn(() => ({ data: { model: null, seq: 9 } }))
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': resolve,
      'model.get': modelGet,
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    await screen.findByLabelText('회원 선택')
    await userEvent.click(screen.getByRole('button', { name: /1건 승격/ }))
    await waitFor(() => expect(resolve).toHaveBeenCalled())
    expect(resolve.mock.calls[0]![0]).toMatchObject({
      requestId: 'r1',
      approve: [{
        entityId: 'w1', expectedStatus: 'new',
        expectedTargetItemId: null, expectedTargetVersion: null,
      }],
    })
    // 조직 화면은 모델을 만지지 않는다 — 그 프로젝트를 열고 있는 사용자에게는
    // 승격 op가 실시간 채널로 전파된다(Task 6의 요청 경로와 같은 규약).
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(modelGet).not.toHaveBeenCalled()
  })

  it('승인 성공 후 같은 화면의 라이브러리 목록·항목 캐시를 무효화한다', async () => {
    // 같은 org-detail 화면의 ResourceLibraryManager가 두 쿼리를 들고 있다. QueryClient가
    // refetchOnWindowFocus:false라 자동 회복 트리거가 없어, 무효화를 빠뜨리면 화면이 낡은
    // "항목 0개"를 계속 보여 주고 삭제 확인창이 거짓을 말한다.
    const queryClient = renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': () => ({ data: {
        status: 'resolved', seq: 5, inserted: 1, updated: 0, skipped: [],
      } }),
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    await screen.findByLabelText('회원 선택')
    await userEvent.click(screen.getByRole('button', { name: /1건 승격/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())

    const keys = invalidatedKeys(invalidate)
    expect(keys.some((k) => k.includes('"items"') && k.includes('"l2"'))).toBe(true)
    expect(keys.some((k) => k.includes('"library"') && k.includes('"list"'))).toBe(true)
  })

  /** 상태별로 다른 행을 돌려주는 listForOrg 스텁 + 호출된 status 목록. */
  function statusAwareList() {
    return vi.fn((input: unknown) => {
      switch ((input as { status?: string } | undefined)?.status) {
        case 'resolved':
          return { data: [{
            ...ROW, id: 'r9', status: 'resolved',
            resolutionNote: '좋습니다 — 두 건만 올렸습니다',
            approvedEntityIds: ['w1'], resolvedAt: '2026-08-04T01:00:00.000Z',
          }] }
        case 'rejected':
          return { data: [{
            ...ROW, id: 'r8', status: 'rejected',
            resolutionNote: '아직 이릅니다 — 이름부터 합의해 주세요',
            approvedEntityIds: [], resolvedAt: '2026-08-04T02:00:00.000Z',
          }] }
        case 'cancelled':
          return { data: [{
            ...ROW, id: 'r7', status: 'cancelled', resolutionNote: '',
            approvedEntityIds: [], resolvedAt: '2026-08-04T03:00:00.000Z',
          }] }
        default:
          return { data: [ROW] }
      }
    })
  }
  const askedStatuses = (spy: { mock: { calls: unknown[][] } }): (string | undefined)[] =>
    spy.mock.calls.map((call) => (call[0] as { status?: string } | undefined)?.status)

  /** 상태 필터에서 한 상태를 고른다. */
  async function pickStatus(label: string) {
    await userEvent.click(screen.getByRole('button', { name: label }))
  }

  it('상태 필터로 승인 이력과 처리 메모를 읽을 수 있다', async () => {
    // 이 필터가 없으면 승인자가 남긴 resolutionNote를 어느 화면에서도 읽을 수 없다 —
    // 저장만 되고 아무도 못 보는 값이 된다(설계 §6.3).
    const listForOrg = statusAwareList()
    renderSection({ 'promotion.listForOrg': listForOrg })

    // 기본은 대기 목록이다.
    expect(await screen.findByText(/올려 주세요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '검토' })).toBeTruthy()

    await pickStatus('승인됨')

    expect(await screen.findByText(/좋습니다 — 두 건만 올렸습니다/)).toBeTruthy()
    expect(screen.getByText('1/2건 승격')).toBeTruthy()
    // 처리된 행은 읽기 전용 이력이라 검토 버튼이 없다.
    expect(screen.queryByRole('button', { name: '검토' })).toBeNull()

    // 서버에 실제로 다른 status로 물었는지 — 화면만 바꾸고 같은 목록을 보여 주면 안 된다.
    expect(askedStatuses(listForOrg)).toContain('pending')
    expect(askedStatuses(listForOrg)).toContain('resolved')
  })

  it('반려 사유를 읽을 수 있다 — I-4의 핵심 케이스다', async () => {
    // 승인자가 반려 사유를 적어 보내도 'resolved'만 열리면 정작 사유가 필요한 쪽이 가려진다.
    const listForOrg = statusAwareList()
    renderSection({ 'promotion.listForOrg': listForOrg })
    await screen.findByText(/올려 주세요/)

    await pickStatus('반려됨')

    expect(await screen.findByText(/아직 이릅니다 — 이름부터 합의해 주세요/)).toBeTruthy()
    expect(askedStatuses(listForOrg)).toContain('rejected')
    // 반려는 approvedEntityIds가 빈 배열이다 — "0건 승격"으로 읽히면 안 된다.
    expect(screen.queryByText(/0\/2건 승격/)).toBeNull()
    expect(screen.getByText('2건')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '검토' })).toBeNull()
  })

  it('취소된 요청도 확인할 수 있다 — 대기 목록에서 사라진 요청의 행방', async () => {
    const listForOrg = statusAwareList()
    renderSection({ 'promotion.listForOrg': listForOrg })
    await screen.findByText(/올려 주세요/)

    await pickStatus('취소됨')

    expect(await screen.findByText('2건')).toBeTruthy()
    expect(askedStatuses(listForOrg)).toContain('cancelled')
    expect(screen.queryByRole('button', { name: '검토' })).toBeNull()
  })

  it('선택을 모두 풀면 버튼이 반려로 바뀌고 빈 approve를 보낸다', async () => {
    const resolve = vi.fn((_input: unknown) => ({ data: {
      status: 'rejected', seq: null, inserted: 0, updated: 0, skipped: [],
    } }))
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': resolve,
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    await userEvent.click(await screen.findByLabelText('회원 선택'))   // 기본 선택을 해제
    await userEvent.click(screen.getByRole('button', { name: '반려' }))
    await waitFor(() => expect(resolve).toHaveBeenCalled())
    expect(resolve.mock.calls[0]![0]).toMatchObject({ requestId: 'r1', approve: [] })
  })

  it('계획을 아직 못 받았으면 반려 버튼이 비활성이다', async () => {
    // promotion.get을 영원히 붙들어 로딩 상태를 유지한다. 이때 selected가 비어 라벨은
    // '반려'인데, 누를 수 있으면 승인자가 내용을 보지 못한 채 요청을 닫아 버린다.
    const resolve = vi.fn((_input: unknown) => ({ data: {
      status: 'rejected', seq: null, inserted: 0, updated: 0, skipped: [],
    } }))
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.resolve': resolve,
    }, true, { stall: 'promotion.get' })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    expect(await screen.findByText(/계획을 계산하는 중입니다/)).toBeTruthy()
    // 로딩 중에 "처리할 항목이 없습니다"로 오인하게 두지 않는다.
    expect(screen.queryByText(/처리할 항목이 없습니다/)).toBeNull()
    expect(screen.getByRole('button', { name: '반려' })).toHaveProperty('disabled', true)
  })

  it('계획 조회가 실패하면 오류를 알리고 반려 버튼이 비활성이다', async () => {
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ error: { code: -32001, message: '승인 권한이 없습니다' } }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '검토' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '승인 권한이 없습니다')
    expect(screen.queryByText(/처리할 항목이 없습니다/)).toBeNull()
    expect(screen.getByRole('button', { name: '반려' })).toHaveProperty('disabled', true)
  })
})
