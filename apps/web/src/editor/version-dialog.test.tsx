import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { VersionDialog } from './version-dialog.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

const SNAPSHOT_ITEM = {
  id: '018f6b0e-0000-7000-8000-0000000000bb',
  name: '배포 전 백업',
  description: '릴리즈 직전 상태',
  revisionSeq: 3,
  createdAt: '2026-07-20T00:00:00.000Z',
}

const REVISION_ITEM = {
  seq: 3,
  summary: '메모 생성',
  source: 'web',
  ops: [],
  createdAt: '2026-07-21T00:00:00.000Z',
  actorName: '오너',
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<VersionDialog projectId={PROJECT_ID} open onOpenChange={() => {}} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('VersionDialog', () => {
  it('opening the dialog renders the snapshot.list result', async () => {
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [SNAPSHOT_ITEM] } }) })
    renderDialog()
    expect(await screen.findByText('배포 전 백업')).toBeInTheDocument()
    expect(screen.getByText(/rev 3/)).toBeInTheDocument()
    expect(screen.getByText(/릴리즈 직전 상태/)).toBeInTheDocument()
  })

  it('creates a snapshot with the entered name and refreshes the list', async () => {
    grantEditPermission()
    const fetchMock = mockTrpcFetch({
      'snapshot.list': () => ({ data: { items: [] } }),
      'snapshot.create': (input) => {
        expect(input).toMatchObject({ projectId: PROJECT_ID, name: '새 스냅샷' })
        return { data: { id: 'new-snap' } }
      },
    })
    renderDialog()
    await screen.findByText('아직 스냅샷이 없습니다')
    await userEvent.type(screen.getByLabelText('이름'), '새 스냅샷')
    await userEvent.click(screen.getByRole('button', { name: '스냅샷 만들기' }))

    await waitFor(() => {
      const calledPaths = fetchMock.mock.calls.map(([url]) => String(url))
      expect(calledPaths.some((u) => u.includes('snapshot.create'))).toBe(true)
    })
    // create 성공 후 목록 무효화로 snapshot.list가 다시 호출된다.
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('snapshot.list'))
      expect(listCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('confirms and calls snapshot.restore when 복원 is clicked', async () => {
    grantEditPermission()
    vi.stubGlobal('confirm', vi.fn(() => true))
    const fetchMock = mockTrpcFetch({
      'snapshot.list': () => ({ data: { items: [SNAPSHOT_ITEM] } }),
      'snapshot.restore': (input) => {
        expect(input).toMatchObject({ projectId: PROJECT_ID, snapshotId: SNAPSHOT_ITEM.id })
        return { data: { seq: 4 } }
      },
      'model.get': () => ({ data: { model: { tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {} }, seq: 4 } }),
    })
    renderDialog()
    await screen.findByText('배포 전 백업')
    await userEvent.click(screen.getByRole('button', { name: '복원' }))

    await waitFor(() => {
      const calledPaths = fetchMock.mock.calls.map(([url]) => String(url))
      expect(calledPaths.some((u) => u.includes('snapshot.restore'))).toBe(true)
    })
    await waitFor(() => expect(useEditorStore.getState().loadedProjectId).toBe(PROJECT_ID))
    expect(useEditorStore.getState().seq).toBe(4)
  })

  it('switching to 이력 renders the revision.list result', async () => {
    mockTrpcFetch({
      'snapshot.list': () => ({ data: { items: [] } }),
      'revision.list': () => ({ data: { items: [REVISION_ITEM], nextCursor: null } }),
    })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '이력' }))
    expect(await screen.findByText(/메모 생성/)).toBeInTheDocument()
    expect(screen.getByText(/오너/)).toBeInTheDocument()
  })

  it('Viewer는 스냅샷을 만들 수도 복원할 수도 없다', async () => {
    // grantEditPermission을 부르지 않는다 — canEdit=false, canManage=false.
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [SNAPSHOT_ITEM] } }) })
    renderDialog()
    await screen.findByText('배포 전 백업')

    expect(screen.queryByRole('button', { name: '스냅샷 만들기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '복원' })).toBeNull()
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })

  it('Editor는 스냅샷을 만들 수 있지만 복원·삭제는 못 한다', async () => {
    grantEditPermission({ canEdit: true, canManage: false })
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [SNAPSHOT_ITEM] } }) })
    renderDialog()
    await screen.findByText('배포 전 백업')

    expect(screen.getByRole('button', { name: '스냅샷 만들기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '복원' })).toBeNull()
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })

  it('Project Admin은 복원·삭제까지 할 수 있다', async () => {
    grantEditPermission({ canEdit: true, canManage: true })
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [SNAPSHOT_ITEM] } }) })
    renderDialog()
    await screen.findByText('배포 전 백업')

    expect(screen.getByRole('button', { name: '스냅샷 만들기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '복원' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })
})
