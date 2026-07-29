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

  it('removed 컬럼이라도 소속 테이블이 현재 모델에 있으면 클릭 버튼이고 테이블을 선택한다', async () => {
    // 기본 뷰: 기준=스냅샷, 비교=현재. 스냅샷에는 있고 현재에서만 지운 컬럼(테이블은 살아있음)
    // → removed로 잡히지만 소속 테이블은 여전히 유효한 이동 대상이어야 한다.
    const snapModel = structuredClone(buildSampleModel())
    const current = structuredClone(buildSampleModel())
    delete current.columns['c3']
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(current, 1, PROJECT_ID)
    const onNavigate = vi.fn()
    renderDiff(onNavigate)
    const item = await screen.findByText('MBR.MBR_NM')
    expect(item.closest('button')).not.toBeNull()
    await userEvent.click(item)
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

  it('removed 테이블(현재 모델에 없음)은 클릭 버튼이 아니다', async () => {
    // 기본 뷰: 기준=스냅샷, 비교=현재. 스냅샷에만 있던 테이블은 '삭제'로 잡히는데,
    // 이동은 항상 현재 모델의 캔버스로 가므로 현재에 없는 대상은 버튼이면 안 된다.
    const snapModel = structuredClone(buildSampleModel())
    snapModel.tables['t9'] = {
      id: 't9', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    const item = await screen.findByText('ORD')
    expect(item.closest('button')).toBeNull()
  })

  it('스냅샷을 불러오지 못하면 에러를 보여주고 "차이가 없습니다"라고 하지 않는다', async () => {
    mockTrpcFetch({
      'snapshot.list': () => ({ data: { items: [{
        id: SNAP_ID, name: 'v1.0', description: '', revisionSeq: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
      }] } }),
      'snapshot.get': () => ({ error: { code: -32004, message: '스냅샷을 찾을 수 없습니다' } }),
    })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText('스냅샷을 불러오지 못했습니다')).toBeInTheDocument()
    expect(screen.queryByText('차이가 없습니다')).not.toBeInTheDocument()
  })

  it('기준과 비교로 같은 시점을 고르면 안내를 보여준다', async () => {
    mockSnapshot(structuredClone(buildSampleModel()))
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    const targetSelect = await screen.findByLabelText('비교')
    await userEvent.selectOptions(targetSelect, SNAP_ID)
    expect(await screen.findByText('같은 시점을 비교하고 있습니다')).toBeInTheDocument()
  })
})
