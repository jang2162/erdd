import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createDomain } from './domain-edits.js'
import { createCustomField } from './custom-field-edits.js'
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
    grantEditPermission()
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
    grantEditPermission()
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
      defaultValue: null, allowedValues: [], description: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    expect((screen.getByLabelText('타입') as HTMLInputElement)).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText('도메인'), 'd1')

    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBe('d1'))
    const typeInput = screen.getByLabelText('타입') as HTMLInputElement
    expect(typeInput).toBeDisabled()
    expect(typeInput.value).toContain('DECIMAL(15)')
  })

  it('빈 물리명 컬럼은 논리명 입력 시 물리명이 자동 생성된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    const logicalInputs = screen.getAllByLabelText('논리명') // [0] 테이블, [1] 컬럼
    await userEvent.type(logicalInputs[1]!, '회원')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('MBR')
    })
  })

  it('물리명이 이미 있으면 논리명 입력이 물리명을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: 'KEEP_ME' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const logicalInputs = screen.getAllByLabelText('논리명')
    await userEvent.type(logicalInputs[1]!, '회원')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
    })
    expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('KEEP_ME')
  })

  it('clearing a domain unlocks the type input and copies the resolved logical type', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createDomain(m, {
      id: 'd2', name: '상태코드', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: ['Y', 'N'], description: null, origin: null,
    })
    m = { ...m, columns: { ...m.columns, c1: { ...m.columns['c1']!, domainId: 'd2' } } }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
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

  it('컬럼 커스텀 항목 체크박스가 모델의 custom 값을 바꾼다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    await userEvent.click(screen.getByLabelText('개인정보여부'))
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.custom).toEqual({ cf1: 'true' })
    })
  })

  it('테이블 대상 커스텀 항목은 테이블 영역에 기본값과 함께 렌더된다', () => {
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf2', name: '업무구분', target: 'table', type: 'text',
      options: [], required: false, defaultValue: '공통', origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    renderPanel()
    // 미입력이므로 정의 기본값이 라이브 해석돼 보인다
    expect(screen.getByLabelText('업무구분')).toHaveValue('공통')
  })

  it('편집 권한이 없으면 입력이 잠기고 편집 버튼이 사라진다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '컬럼 삭제' })).toBeNull()
    expect(screen.queryByRole('button', { name: '물리명 재생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '용어로 등록' })).toBeNull()
    expect(screen.queryByRole('button', { name: '재생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '컬럼 추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: '위로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '아래로' })).toBeNull()

    // 값은 그대로 보인다 (t1: 논리명 회원등급, 컬럼 c1 논리명 등급코드).
    const tableLogical = screen.getByDisplayValue('회원등급')
    expect(tableLogical).toHaveAttribute('readonly')
    const columnLogical = screen.getByDisplayValue('등급코드')
    expect(columnLogical).toHaveAttribute('readonly')

    expect(screen.getByLabelText('소속 그룹')).toBeDisabled()
    expect(screen.getByLabelText('도메인')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'PK' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'NN' })).toBeDisabled()
  })
})
