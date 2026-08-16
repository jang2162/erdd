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
import { createWord } from './dict-edits.js'
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
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    expect(screen.getByLabelText('이름')).toHaveValue('회원관리')
    expect(screen.getByRole('button', { name: '그룹 삭제' })).toBeInTheDocument()
    expect(screen.getByText('소속 테이블 2개')).toBeInTheDocument()
  })

  it('deletes the group and clears selection when the delete button is clicked', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '그룹 삭제' }))
    await waitFor(() => expect(useEditorStore.getState().model.tableGroups['g1']).toBeUndefined())
    expect(useEditorStore.getState().selectedGroupId).toBeNull()
  })

  it('편집 권한이 없으면 삭제 버튼이 사라지고 이름 입력이 잠긴다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectGroup('g1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '그룹 삭제' })).toBeNull()
    const nameInput = screen.getByLabelText('이름')
    expect(nameInput).toHaveValue('회원관리')
    expect(nameInput).toHaveAttribute('readonly')
    expect(screen.getByLabelText('설명')).toHaveAttribute('readonly')
    // "이 그룹 뷰 열기"는 모델을 바꾸지 않으므로 권한과 무관하게 남아 있어야 한다.
    expect(screen.getByRole('button', { name: '이 그룹 뷰 열기' })).toBeInTheDocument()
  })

  it('별칭을 입력하면 blur 로 커밋된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    const input = screen.getByLabelText('별칭') as HTMLInputElement
    await userEvent.type(input, 'MBR')
    await userEvent.tab()
    await waitFor(() =>
      expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('MBR'))
  })

  // ⚠️ 설계 D3 — 타이핑 중에 규칙을 강제한다.
  it('한글·특수문자는 입력되지 않고 소문자는 대문자가 된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    const input = screen.getByLabelText('별칭') as HTMLInputElement
    await userEvent.type(input, 'mbr-회원_1!')
    expect(input.value).toBe('MBR_1')
  })

  it('이름으로 채우기가 사전으로 별칭을 만든다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    // 픽스처 그룹 이름은 '회원관리' — 사전에 두 단어를 넣어 MBR_MGMT 가 나오게 한다.
    m = createWord(m, { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null })
    m = createWord(m, { id: 'w2', logicalName: '관리', abbreviation: 'MGMT', englishName: null, description: null, origin: null })
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '이름으로 별칭 채우기' }))
    await waitFor(() =>
      expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('MBR_MGMT'))
  })

  it('사전에 없으면 토스트를 내고 별칭을 바꾸지 않는다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '' as never)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)   // 사전 비어 있음
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '이름으로 별칭 채우기' }))
    expect(spy).toHaveBeenCalled()
    expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('')
  })

  it('읽기 전용이면 별칭이 readOnly 이고 채우기 버튼이 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    expect(screen.getByLabelText('별칭')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '이름으로 별칭 채우기' })).not.toBeInTheDocument()
  })
})
