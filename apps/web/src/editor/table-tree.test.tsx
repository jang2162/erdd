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
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { TableTree } from './table-tree.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderTree() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<TableTree projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('TableTree', () => {
  it('lists tables and filters by search (logical or physical)', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('테이블 검색'), '등급')
    expect(screen.queryByText('MBR')).not.toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
  })

  it('편집 권한이 없으면 그룹 추가 버튼을 숨긴다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderTree()

    expect(screen.queryByRole('button', { name: '그룹 추가' })).toBeNull()
    // 조회 기능은 그대로다.
    expect(screen.getByPlaceholderText('테이블 검색')).toBeInTheDocument()
  })

  it('selects and focuses a table on click', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })

  it('renders a group header with its name and a separate 미분류 section for unassigned tables', () => {
    const model = buildSampleModel()
    model.tables = { ...model.tables, t2: { ...model.tables.t2!, groupId: null } }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    expect(screen.getByText('회원관리')).toBeInTheDocument()
    expect(screen.getByText('미분류')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument() // still in the group
    expect(screen.getByText('MBR')).toBeInTheDocument() // now unassigned
  })

  it('그룹 뷰 활성 시 그 그룹만 스코핑해 표시한다', () => {
    const model = buildSampleModel()
    model.tables = { ...model.tables, t2: { ...model.tables.t2!, groupId: null } }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().enterGroupView('g1')
    renderTree()
    expect(screen.getByText('회원관리')).toBeInTheDocument()
    expect(screen.queryByText('미분류')).not.toBeInTheDocument() // 스코핑되어 숨김
  })

  it('creates a new group with a generated name/color and selects it via the add-group button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: '그룹 추가' }))
    await waitFor(() => {
      const groups = Object.values(useEditorStore.getState().model.tableGroups)
      expect(groups).toHaveLength(2)
    })
    const newGroup = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g1')!
    // 기존 그룹은 "회원관리"뿐이므로 미사용 최소 번호는 "그룹1".
    expect(newGroup.name).toBe('그룹1')
    expect(useEditorStore.getState().selectedGroupId).toBe(newGroup.id)
  })

  it('삭제 후 재추가 시 이름이 충돌하지 않는다(미사용 최소 번호)', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    // 그룹1·그룹2가 있는 상태에서 그룹1을 지운 모델 → 추가 시 새 이름은 "그룹1"이어야 한다.
    const model = buildSampleModel()
    model.tableGroups = {
      g2: { id: 'g2', name: '그룹2', color: '#000', comment: null },
    }
    model.tables = Object.fromEntries(
      Object.entries(model.tables).map(([id, t]) => [id, { ...t, groupId: null }]),
    )
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: '그룹 추가' }))
    await waitFor(() => {
      expect(Object.values(useEditorStore.getState().model.tableGroups)).toHaveLength(2)
    })
    const added = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g2')!
    expect(added.name).toBe('그룹1')
  })
})
