import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { IndexSection } from './index-section.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderSection(tableId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<IndexSection projectId={PROJECT_ID} tableId={tableId} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('IndexSection', () => {
  it('renders an existing index name, UNIQUE state, and its member columns', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderSection('t2')

    const nameInput = screen.getByLabelText('인덱스명') as HTMLInputElement
    expect(nameInput.value).toBe('UX_MBR_01')
    expect(screen.getByRole('checkbox', { name: 'UNIQUE' })).toBeChecked()
    expect(screen.getByText('MBR_NM')).toBeInTheDocument()
  })

  it('creates an index on the table via the add button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderSection('t1')

    expect(screen.getByText('인덱스가 없습니다.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '인덱스 추가' }))

    await waitFor(() => {
      const indexes = Object.values(useEditorStore.getState().model.indexes).filter((ix) => ix.tableId === 't1')
      expect(indexes).toHaveLength(1)
      expect(indexes[0]!.name).toBe('IX_1')
    })
  })

  it('two rapid adds get distinct names (IX_1, IX_2), not a duplicate', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderSection('t1')

    const addButton = screen.getByRole('button', { name: '인덱스 추가' })
    // 재렌더 flush 없이 진짜 동시 호출을 재현한다. await userEvent 2회는 매 await마다
    // 첫 mutation이 반영돼 버그(렌더스코프 이름 산정)에서도 IX_2가 되어 회귀를 못 잡는다.
    await act(async () => {
      fireEvent.click(addButton)
      fireEvent.click(addButton)
    })

    await waitFor(() => {
      const names = Object.values(useEditorStore.getState().model.indexes)
        .filter((ix) => ix.tableId === 't1').map((ix) => ix.name).sort()
      expect(names).toEqual(['IX_1', 'IX_2'])
    })
  })

  it('toggles a member column direction between asc and desc', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderSection('t2')

    await userEvent.click(screen.getByRole('button', { name: 'ASC' }))

    await waitFor(() => {
      expect(useEditorStore.getState().model.indexes['i1']!.columns[0]!.direction).toBe('desc')
    })
  })

  it('편집 권한이 없으면 편집 버튼이 사라지고 입력이 잠기지만 값은 보인다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderSection('t2')

    expect(screen.queryByRole('button', { name: '인덱스 추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: '인덱스 삭제' })).toBeNull()
    expect(screen.queryByRole('button', { name: '위로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '아래로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '인덱스 컬럼 제거' })).toBeNull()

    const nameInput = screen.getByLabelText('인덱스명') as HTMLInputElement
    expect(nameInput.value).toBe('UX_MBR_01')
    expect(nameInput).toHaveAttribute('readonly')
    expect(screen.getByRole('checkbox', { name: 'UNIQUE' })).toBeDisabled()
    // ASC/DESC 토글은 값 표시를 겸하므로 숨기지 않고 disabled로만 잠근다.
    const dirButton = screen.getByRole('button', { name: 'ASC' })
    expect(dirButton).toBeInTheDocument()
    expect(dirButton).toBeDisabled()
    expect(screen.getByLabelText('인덱스 컬럼 추가')).toBeDisabled()
  })
})
