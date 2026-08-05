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
}

function renderSection(handlers: Parameters<typeof mockTrpcFetch>[0], canManage = true) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <PromotionRequestsSection orgId={ORG_ID} canManage={canManage} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PromotionRequestsSection', () => {
  it('관리 권한이 없으면 아무것도 렌더하지 않는다', () => {
    renderSection({ 'promotion.listForOrg': () => ({ data: [ROW] }) }, false)
    expect(screen.queryByText(/승격 요청/)).toBeNull()
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
    renderSection({
      'promotion.listForOrg': () => ({ data: [ROW] }),
      'promotion.get': () => ({ data: {
        request: { ...ROW, projectName: '회원 시스템', requesterName: '에디터' },
        entries: [ENTRY], unavailable: [],
      } }),
      'promotion.resolve': resolve,
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
})
