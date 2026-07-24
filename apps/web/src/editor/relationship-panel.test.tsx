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
import { RelationshipPanel } from './relationship-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<RelationshipPanel projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('RelationshipPanel', () => {
  it('renders the delete button and identifying checkbox for the selected relationship', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()
    expect(screen.getByRole('button', { name: '관계 삭제' })).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: /식별 관계/ }) as HTMLInputElement
    expect(checkbox).toBeInTheDocument()
    expect(checkbox.checked).toBe(false)
  })

  it('deletes the relationship and clears selection when the delete button is clicked', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '관계 삭제' }))
    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })
})
