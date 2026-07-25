import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createDomain } from './domain-edits.js'
import { DomainPanel } from './domain-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<DomainPanel projectId={PROJECT_ID} />, { wrapper: w })
}

function loadModelWithDomains() {
  let m = buildSampleModel()
  m = createDomain(m, {
    id: 'd1', name: '금액', category: '통화', logicalType: 'DECIMAL(15)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  })
  m = createDomain(m, {
    id: 'd2', name: '상태코드', category: '코드', logicalType: 'CHAR(1)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: ['Y', 'N'], description: null,
  })
  m = { ...m, columns: { ...m.columns, c1: { ...m.columns['c1']!, domainId: 'd2' } } }
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('DomainPanel', () => {
  it('opens the dialog and lists domains grouped by category, with usage count shown', async () => {
    loadModelWithDomains()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /도메인/ }))
    expect(screen.getByText('금액')).toBeInTheDocument()
    expect(screen.getByText('상태코드')).toBeInTheDocument()
    expect(screen.getByText('사용처 1개')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '도메인 추가' })).toBeInTheDocument()
  })

  it('disables delete for a domain in use and enables it for an unused domain', async () => {
    loadModelWithDomains()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /도메인/ }))
    expect(screen.getByRole('button', { name: '상태코드 삭제' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '금액 삭제' })).toBeEnabled()
  })
})
