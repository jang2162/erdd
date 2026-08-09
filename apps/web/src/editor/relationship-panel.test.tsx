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
    grantEditPermission()
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
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '관계 삭제' }))
    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })

  it('편집 권한이 없으면 삭제 버튼이 사라지고 컨트롤이 잠긴다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectRelationship('r1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '관계 삭제' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /식별 관계/ })).toBeDisabled()
    // 카디널리티 select는 <Label>이 htmlFor 없이 렌더돼 getByLabelText로 못 찾는다 — 첫 번째 combobox로 짚는다.
    expect(screen.getAllByRole('combobox')[0]).toBeDisabled()
  })

  it('교차 테이블로 풀면 원본 관계가 사라지고 교차 테이블이 생긴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '교차 테이블로 풀기' }))

    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    const m = useEditorStore.getState().model
    // 원본 FK 컬럼이 사라진다
    expect(m.columns['c4']).toBeUndefined()
    // 교차 테이블 1개 + 새 관계 2개
    const junction = Object.values(m.tables).find((t) => t.logicalName === '회원등급회원')
    expect(junction).toBeDefined()
    const jRels = Object.values(m.relationships).filter((r) => r.childTableId === junction!.id)
    expect(jRels).toHaveLength(2)
    expect(jRels.every((r) => r.identifying)).toBe(true)
    // 교차 테이블이 선택된다
    expect(useEditorStore.getState().selectedTableId).toBe(junction!.id)
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })

  it('식별 관계면 버튼이 잠기고 이유가 보인다', () => {
    const base = buildSampleModel()
    const m = { ...base, relationships: {
      ...base.relationships, r1: { ...base.relationships['r1']!, identifying: true },
    } }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()

    expect(screen.getByRole('button', { name: '교차 테이블로 풀기' })).toBeDisabled()
    expect(screen.getByText(/식별 관계는 풀 수 없습니다/)).toBeInTheDocument()
  })

  it('PK가 모자라면 버튼이 잠기고 이유가 보인다', () => {
    const base = buildSampleModel()
    // t2의 PK c2를 비-PK로, FK c4를 PK로 → FK를 지우면 t2의 PK가 0개가 된다(no-pk).
    const m = { ...base, columns: {
      ...base.columns,
      c2: { ...base.columns['c2']!, isPk: false },
      c4: { ...base.columns['c4']!, isPk: true },
    } }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()

    expect(screen.getByRole('button', { name: '교차 테이블로 풀기' })).toBeDisabled()
    expect(screen.getByText(/양쪽 테이블에 모두 기본 키가 있어야 합니다/)).toBeInTheDocument()
  })

  it('편집 권한이 없으면 교차 테이블 버튼이 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectRelationship('r1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '교차 테이블로 풀기' })).toBeNull()
  })
})
