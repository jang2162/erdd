import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { SnapshotDiff } from './snapshot-diff.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'
const SNAP_ID = '018f6b0e-0000-7000-8000-0000000000b1'

function renderDiff(onNavigate = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<SnapshotDiff projectId={PROJECT_ID} onNavigate={onNavigate} />, { wrapper: w })
}

/** 스냅샷 1개(= 현재 모델에서 컬럼 하나를 지운 상태)를 돌려주는 tRPC 스텁. */
function mockSnapshot(model: unknown) {
  mockTrpcFetch({
    'snapshot.list': () => ({ data: { items: [{
      id: SNAP_ID, name: 'v1.0', description: '', revisionSeq: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
    }] } }),
    'snapshot.get': () => ({ data: {
      id: SNAP_ID, name: 'v1.0', description: '', revisionSeq: 1,
      createdAt: '2026-07-01T00:00:00.000Z', model,
    } }),
  })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('SnapshotDiff', () => {
  it('스냅샷이 없으면 안내만 보여준다', async () => {
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [] } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/스냅샷이 없습니다/)).toBeInTheDocument()
  })

  it('기준 스냅샷과 현재를 비교해 변경 목록과 요약을 보여준다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    delete snapModel.columns['c3']            // 스냅샷에는 없던 컬럼 → 현재에서 '추가'
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/추가 1/)).toBeInTheDocument()
    expect(screen.getByText('MBR.MBR_NM')).toBeInTheDocument()
  })

  it('차이가 없으면 안내를 보여준다', async () => {
    mockSnapshot(structuredClone(buildSampleModel()))
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/차이가 없습니다/)).toBeInTheDocument()
  })

  it('테이블·컬럼 항목을 클릭하면 해당 테이블을 선택하고 onNavigate를 부른다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    delete snapModel.columns['c3']
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    const onNavigate = vi.fn()
    renderDiff(onNavigate)
    await userEvent.click(await screen.findByText('MBR.MBR_NM'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableId).toBe('t2'))
    expect(onNavigate).toHaveBeenCalled()
  })

  it('사전 항목은 캔버스에 대응 객체가 없어 클릭 버튼이 아니다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    const current = structuredClone(buildSampleModel())
    current.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(current, 1, PROJECT_ID)
    renderDiff()
    const item = await screen.findByText('회원')
    expect(item.closest('button')).toBeNull()
  })
})
