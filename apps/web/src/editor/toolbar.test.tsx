import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { Toolbar } from './toolbar.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

// Toolbar는 이미지 좌표 변환을 위해 useReactFlow를 쓰므로 React Flow 컨텍스트가 필요하다.
function renderToolbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<Toolbar projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('Toolbar', () => {
  it('그룹 뷰에서 "테이블 추가"로 만든 테이블을 활성 그룹에 배정한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: /테이블 추가/ }))

    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      const added = Object.values(tables).find((t) => t.id !== 't1' && t.id !== 't2')
      expect(added).toBeDefined()
      expect(added?.groupId).toBe('g1')
    })
  })

  it('그룹 뷰에서는 "메모" 버튼이 비활성화된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderToolbar()

    expect(screen.getByRole('button', { name: /메모/ })).toBeDisabled()
  })

  it('전체 뷰에서는 "메모" 버튼이 활성화된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.getByRole('button', { name: /메모/ })).toBeEnabled()
  })

  it('편집 권한이 없으면 편집 버튼 대신 읽기 전용 배지를 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderToolbar()

    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /테이블 추가/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /메모/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /자동 정렬/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '실행 취소' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 실행' })).toBeNull()
  })

  it('편집 권한이 있으면 읽기 전용 배지가 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.queryByText('읽기 전용')).toBeNull()
    expect(screen.getByRole('button', { name: /테이블 추가/ })).toBeInTheDocument()
  })
})
