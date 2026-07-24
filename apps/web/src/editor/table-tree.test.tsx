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

  it('selects and focuses a table on click', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableId).toBe('t2')
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

  it('creates a new group with a generated name/color and selects it via the add-group button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: '그룹 추가' }))
    await waitFor(() => {
      const groups = Object.values(useEditorStore.getState().model.tableGroups)
      expect(groups).toHaveLength(2)
    })
    const newGroup = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g1')!
    expect(newGroup.name).toBe('그룹2')
    expect(useEditorStore.getState().selectedGroupId).toBe(newGroup.id)
  })
})
