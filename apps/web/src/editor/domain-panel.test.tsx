import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
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

function loadModelWithDomains(grant = true) {
  let m = buildSampleModel()
  m = createDomain(m, {
    id: 'd1', name: '금액', category: '통화', logicalType: 'DECIMAL(15)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  })
  m = createDomain(m, {
    id: 'd2', name: '상태코드', category: '코드', logicalType: 'CHAR(1)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: ['Y', 'N'], description: null, origin: null,
  })
  m = { ...m, columns: { ...m.columns, c1: { ...m.columns['c1']!, domainId: 'd2' } } }
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
  if (grant) grantEditPermission()
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

  it('편집 권한이 없으면 도메인을 열람만 할 수 있다', async () => {
    loadModelWithDomains(false)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /도메인/ }))

    expect(screen.getByText('금액')).toBeInTheDocument()
    expect(screen.getByText('상태코드')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '도메인 추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: '금액 편집' })).toBeNull()
    expect(screen.queryByRole('button', { name: '금액 삭제' })).toBeNull()
  })

  it('도메인 추가 폼에서 필수 라벨(이름·논리 타입)에는 별표가 붙고 선택 라벨(분류·기본값·허용값·설명)에는 붙지 않는다', async () => {
    loadModelWithDomains()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /도메인/ }))
    await userEvent.click(screen.getByRole('button', { name: '도메인 추가' }))
    const labelText = (text: string) => screen.getByText(text).closest('label')?.textContent
    expect(labelText('이름')).toBe('이름*(필수)')
    expect(labelText('논리 타입')).toBe('논리 타입*(필수)')
    expect(labelText('분류')).toBe('분류')
    expect(labelText('기본값')).toBe('기본값')
    expect(labelText('허용값 (쉼표로 구분)')).toBe('허용값 (쉼표로 구분)')
    expect(labelText('설명')).toBe('설명')
  })
})
