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
import { GroupPanel } from './group-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<GroupPanel projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('GroupPanel', () => {
  it('renders the group name, delete button, and member count for the selected group', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    expect(screen.getByLabelText('이름')).toHaveValue('회원관리')
    expect(screen.getByRole('button', { name: '그룹 삭제' })).toBeInTheDocument()
    expect(screen.getByText('소속 테이블 2개')).toBeInTheDocument()
  })

  it('deletes the group and clears selection when the delete button is clicked', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '그룹 삭제' }))
    await waitFor(() => expect(useEditorStore.getState().model.tableGroups['g1']).toBeUndefined())
    expect(useEditorStore.getState().selectedGroupId).toBeNull()
  })
})
