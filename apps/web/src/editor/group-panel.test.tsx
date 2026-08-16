import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

  // ⚠️ 아래 두 건은 「그룹을 갈아타도 별칭 입력이 앞 그룹 값을 들고 있다」를 잠근다.
  // 별칭 입력은 D3(타이핑 중 정규화) 때문에 제어 인풋이라, 다른 세 필드가 `key` 로 공짜로 얻는
  // 리셋이 없다. 동기화 트리거가 alias 문자열 하나뿐이면 **두 그룹의 별칭이 같을 때**
  // (신설 필드라 실사용에서는 거의 전부 '') effect 가 돌지 않아 앞 그룹 값이 남는다.
  // 그래서 두 그룹의 alias 는 반드시 둘 다 '' 여야 한다 — 값이 다르면 결함이 있어도 통과한다.
  function loadTwoGroups() {
    const m = buildSampleModel()
    m.tableGroups['g2'] = { id: 'g2', name: '주문관리', color: '#fee', comment: null, alias: '' }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
  }

  /**
   * 캔버스에서 다른 그룹을 클릭하는 동선을 그대로 재현한다 — blur(커밋 시작)와 selectGroup 이
   * **같은 클릭에서** 일어난다.
   * ⚠️ 둘 사이에 커밋 도착을 기다리면 결함이 가려진다 — g1.alias 가 먼저 'AAA' 가 되어
   * groupAlias 가 'AAA'→'' 로 바뀌고, 그러면 deps 가 alias 하나뿐이어도 effect 가 돈다.
   * 커밋은 serializeMutation 이 마이크로태스크로 지연 실행하므로 실사용에서는 늦게 도착한다.
   */
  async function typeAliasThenSwitchGroup(value: string) {
    const input = screen.getByLabelText('별칭')
    await userEvent.type(input, value)
    act(() => {
      input.blur()
      useEditorStore.getState().selectGroup('g2')
    })
    // ⚠️ 커밋이 도착한 뒤에 단언한다 — 안 그러면 타이밍에 따라 우연히 통과한다.
    await waitFor(() =>
      expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe(value))
  }

  it('그룹을 갈아타면 별칭 입력이 새 그룹 값으로 바뀐다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadTwoGroups()
    renderPanel()
    await typeAliasThenSwitchGroup('AAA')
    expect(screen.getByLabelText('별칭')).toHaveValue('')
  })

  it('갈아탄 뒤 별칭 칸을 스쳐 지나가도 새 그룹의 별칭이 바뀌지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadTwoGroups()
    renderPanel()
    await typeAliasThenSwitchGroup('AAA')

    await userEvent.click(screen.getByLabelText('별칭'))      // 값은 건드리지 않고 스쳐 지나간다
    await userEvent.tab()
    expect(useEditorStore.getState().model.tableGroups['g2']!.alias).toBe('')
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
