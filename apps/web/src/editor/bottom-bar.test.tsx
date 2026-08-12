import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { BottomBar } from './bottom-bar.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

// Toolbar·ZoomControls가 React Flow 컨텍스트를, Toolbar가 tRPC를 쓴다.
function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<BottomBar projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('BottomBar', () => {
  it('편집 권한이 있으면 편집 도구와 뷰 상태와 줌이 함께 보인다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderBar()

    expect(screen.getByRole('button', { name: /테이블 추가/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '뷰 전환' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '물리명' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '화면에 맞춤' })).toBeInTheDocument()
  })

  // store 기본값이 fail-closed(canEdit=false)라 grantEditPermission()을 부르지 않는 것이 핵심이다.
  it('읽기 전용이면 편집 도구가 없고 뷰 전환·표시 모드·줌은 남는다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderBar()

    expect(screen.queryByRole('button', { name: /테이블 추가/ })).not.toBeInTheDocument()
    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '뷰 전환' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '물리명' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '화면에 맞춤' })).toBeInTheDocument()
  })
})
