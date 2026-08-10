import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import type { Table } from '@erdd/core'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { TableTree } from './table-tree.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderTree() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<TableTree projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('TableTree', () => {
  it('lists tables and filters by search (logical or physical)', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('테이블 검색'), '등급')
    expect(screen.queryByText('MBR')).not.toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
  })

  it('편집 권한이 없으면 그룹 추가 버튼을 숨긴다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderTree()

    expect(screen.queryByRole('button', { name: '그룹 추가' })).toBeNull()
    // 조회 기능은 그대로다.
    expect(screen.getByPlaceholderText('테이블 검색')).toBeInTheDocument()
  })

  it('selects and focuses a table on click', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })

  it('renders a group header with its name and a separate 미분류 section for unassigned tables', () => {
    const model = buildSampleModel()
    model.tables = { ...model.tables, t2: { ...model.tables.t2!, groupId: null } }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    expect(screen.getByText('회원관리')).toBeInTheDocument()
    expect(screen.getByText('미분류')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument() // still in the group
    expect(screen.getByText('MBR')).toBeInTheDocument() // now unassigned
  })

  it('그룹 뷰 활성 시 그 그룹만 스코핑해 표시한다', () => {
    const model = buildSampleModel()
    model.tables = { ...model.tables, t2: { ...model.tables.t2!, groupId: null } }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().enterGroupView('g1')
    renderTree()
    expect(screen.getByText('회원관리')).toBeInTheDocument()
    expect(screen.queryByText('미분류')).not.toBeInTheDocument() // 스코핑되어 숨김
  })

  it('creates a new group with a generated name/color and selects it via the add-group button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: '그룹 추가' }))
    await waitFor(() => {
      const groups = Object.values(useEditorStore.getState().model.tableGroups)
      expect(groups).toHaveLength(2)
    })
    const newGroup = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g1')!
    // 기존 그룹은 "회원관리"뿐이므로 미사용 최소 번호는 "그룹1".
    expect(newGroup.name).toBe('그룹1')
    expect(useEditorStore.getState().selectedGroupId).toBe(newGroup.id)
  })

  it('삭제 후 재추가 시 이름이 충돌하지 않는다(미사용 최소 번호)', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    // 그룹1·그룹2가 있는 상태에서 그룹1을 지운 모델 → 추가 시 새 이름은 "그룹1"이어야 한다.
    const model = buildSampleModel()
    model.tableGroups = {
      g2: { id: 'g2', name: '그룹2', color: '#000', comment: null },
    }
    model.tables = Object.fromEntries(
      Object.entries(model.tables).map(([id, t]) => [id, { ...t, groupId: null }]),
    )
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: '그룹 추가' }))
    await waitFor(() => {
      expect(Object.values(useEditorStore.getState().model.tableGroups)).toHaveLength(2)
    })
    const added = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g2')!
    expect(added.name).toBe('그룹1')
  })
})

/** 트리 정렬은 physicalName.localeCompare 이므로 표시 순서는 MBR(t2) → MBR_GRD(t1) 이다. */
function tbl(id: string, physicalName: string, logicalName: string, groupId: string | null): Table {
  return {
    id, logicalName, physicalName, comment: null,
    groupId, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
}

/**
 * 수식키를 누른 채 클릭하려면 **반드시 `userEvent.setup()` 인스턴스를 써야 한다.**
 * 직접 API(`userEvent.click`)는 호출마다 새 System을 만들어 `userEvent.keyboard('{Meta>}')`로
 * 눌러 둔 수식키가 다음 클릭에 실려 오지 않는다(user-event 14 `setupDirect`).
 */
describe('TableTree 다중 선택 제스처', () => {
  it('Cmd+클릭은 선택을 토글한다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])

    await user.keyboard('{Meta>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('Ctrl+클릭도 같은 토글이다(Windows·Linux 관례)', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Control>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Control}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('Cmd+클릭으로 이미 선택된 것을 다시 누르면 빠진다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()
    await user.keyboard('{Meta>}')
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })

  it('Shift+클릭은 화면에 보이는 트리 순서로 범위를 잡는다', async () => {
    // 표시 순서: MBR(t2) → MBR_GRD(t1). 주 선택이 t2일 때 t1을 Shift+클릭하면 둘 다.
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('Shift+클릭은 역방향(아래→위)도 표시 순서대로 채운다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{/Shift}')
    // anchor가 뒤쪽이어도 결과는 화면 순서 그대로다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('검색으로 걸러진 항목은 Shift 범위에 들어가지 않는다', async () => {
    // MBR_A(t3)는 정렬상 MBR과 MBR_GRD **사이**지만 논리명 검색 "회원"에 걸리지 않아 화면에 없다.
    // (물리명으로 거르면 사이에 낄 수 있는 이름은 전부 "MBR" 접두라 검색에도 걸린다 —
    //  구분력을 가지려면 논리명으로 걸러야 한다.)
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'MBR_A', '주문', 'g1') }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await user.type(screen.getByPlaceholderText('테이블 검색'), '회원')
    expect(screen.queryByText('MBR_A')).toBeNull()   // 화면에 없다는 전제를 먼저 잠근다
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
    expect(useEditorStore.getState().selectedTableIds).not.toContain('t3')
  })

  it('그룹 뷰 밖의 테이블은 Shift 범위에 들어가지 않는다', async () => {
    // MBR_A(t3)는 정렬상 MBR과 MBR_GRD **사이**지만 미분류라 g1 스코프 화면에 없다.
    // 범위 기준이 정렬 배열이면 t3가 끌려 들어온다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'MBR_A', '회원주소', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().enterGroupView('g1')
    renderTree()
    expect(screen.queryByText('MBR_A')).toBeNull()   // 화면에 없다는 전제를 먼저 잠근다
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('주 선택이 없으면 Shift+클릭은 단일 선택 + 포커스로 떨어진다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
    expect(useEditorStore.getState().focusTableId).toBe('t1')
  })

  it('수식키 없는 클릭은 단일 선택으로 되돌리고 캔버스 포커스를 요청한다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()
    await user.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })

  it('선택된 항목은 여러 개라도 전부 강조된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()
    for (const name of ['MBR', 'MBR_GRD']) {
      expect(screen.getByText(name).closest('button')).toHaveClass('bg-accent')
    }
  })

  it('편집 권한이 없어도 다중 선택은 된다 — 선택은 모델 변경이 아니라 뷰 상태다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderTree()
    expect(useEditorStore.getState().canEdit).toBe(false)
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Meta>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })
})
