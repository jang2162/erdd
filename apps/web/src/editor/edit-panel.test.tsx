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
import { createDomain } from './domain-edits.js'
import { EditPanel } from './edit-panel.js'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<EditPanel projectId="018f6b0e-0000-7000-8000-0000000000aa" />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('EditPanel', () => {
  it('prompts to select a table when nothing is selected', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    renderPanel()
    expect(screen.getByText(/테이블을 선택/)).toBeInTheDocument()
  })

  it('edits the table physical name and sends a mutation', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('테이블 물리명') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER')
    await userEvent.tab() // blur → commit
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  it('adds a column via the add button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    renderPanel()
    const before = Object.values(useEditorStore.getState().model.columns)
      .filter((c) => c.tableId === 't1').length
    await userEvent.click(screen.getByRole('button', { name: '컬럼 추가' }))
    await waitFor(() => {
      const after = Object.values(useEditorStore.getState().model.columns)
        .filter((c) => c.tableId === 't1').length
      expect(after).toBe(before + 1)
    })
  })

  it('assigning a domain to a column locks the type input and shows the domain type', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createDomain(m, {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    expect((screen.getByLabelText('타입') as HTMLInputElement)).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText('도메인'), 'd1')

    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBe('d1'))
    const typeInput = screen.getByLabelText('타입') as HTMLInputElement
    expect(typeInput).toBeDisabled()
    expect(typeInput.value).toContain('DECIMAL(15)')
  })

  it('clearing a domain unlocks the type input and copies the resolved logical type', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createDomain(m, {
      id: 'd2', name: '상태코드', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: ['Y', 'N'], description: null,
    })
    m = { ...m, columns: { ...m.columns, c1: { ...m.columns['c1']!, domainId: 'd2' } } }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    renderPanel()
    expect(screen.getByLabelText('타입')).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('도메인'), '')

    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBeNull())
    expect(useEditorStore.getState().model.columns['c1']!.type).toBe('CHAR(1)')
    const typeInput = screen.getByLabelText('타입') as HTMLInputElement
    expect(typeInput).toBeEnabled()
    expect(typeInput.value).toBe('CHAR(1)')
  })
})
