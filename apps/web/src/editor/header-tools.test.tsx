import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { HeaderTools } from './header-tools.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function renderTools() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<HeaderTools projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('HeaderTools — 사전·리소스', () => {
  it('메뉴에서 「도메인」을 고르면 도메인 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))

    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()
  })

  it('한 번에 하나만 열린다 — 다른 것을 고르면 앞의 것이 닫힌다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))
    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '커스텀 항목' }))

    expect(await screen.findByRole('dialog', { name: '커스텀 항목' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '도메인' })).not.toBeInTheDocument()
  })
})
