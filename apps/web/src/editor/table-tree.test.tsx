import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('범위는 정렬 배열이 아니라 그룹 단위 순서를 따른다', async () => {
    // MBR_A(t3)는 정렬상 MBR과 MBR_GRD **사이**지만 미분류라 그룹 멤버 뒤에 놓인다.
    // 범위 기준이 그룹을 무시한 정렬 배열이면 t3가 [MBR..MBR_GRD] 안에 끼어 들어온다.
    // (그룹 뷰 스코핑을 잠그는 테스트가 아니다 — 양 끝점이 모두 화면에 있는 정상 경로에서는
    //  스코프된 그룹의 멤버가 무스코핑 순서에서도 연속 구간이라 스코핑이 결과를 바꿀 수 없다.
    //  스코핑은 **앵커가 화면 밖일 때**만 일하고, 그것은 아래 두 테스트가 잠근다.)
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'MBR_A', '회원주소', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('그룹 뷰에서 앵커가 화면 밖 미분류면 범위에 끌려 들어오지 않는다', async () => {
    // 그룹 뷰 스코핑이 **실제로** 일하는 유일한 경로: 앵커(여기서는 주 선택)가 화면 밖이다.
    // orderedIds의 `showUnassigned` 가드가 빠지면 화면에 보이지도 않는 ORD가 범위에 들어온다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().enterGroupView('g1')
    useEditorStore.getState().selectTables(['t3'])   // 캔버스가 고른, 그룹 뷰 밖의 미분류 테이블
    renderTree()
    expect(screen.queryByText('ORD')).toBeNull()     // 화면에 없다는 전제를 먼저 잠근다
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    // 가드가 없으면 ['t1', 't3'] — 화면 밖 t3가 딸려 온다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
    expect(useEditorStore.getState().focusTableId).toBe('t1')
  })

  it('그룹 뷰에서 앵커가 다른 그룹이면 범위에 끌려 들어오지 않는다', async () => {
    // 같은 경로의 다른 장치: orderedIds가 visibleGroups가 아니라 groups를 순회하면
    // 화면에 없는 g2 멤버가 범위의 시작점이 되어 통째로 딸려 온다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문관리', color: '#111', comment: null },
    }
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', 'g2') }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().enterGroupView('g1')
    useEditorStore.getState().selectTables(['t3'])   // 캔버스가 고른, g2 소속 테이블
    renderTree()
    expect(screen.queryByText('ORD')).toBeNull()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    // groups를 순회하면 ['t3', 't2', 't1'] — 그룹 이름 정렬상 g2(주문관리)가 g1(회원관리)보다 앞이다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })

  it('범위는 그룹에서 미분류까지 이어진다', async () => {
    // orderedIds의 미분류 꼬리가 없으면 ORD가 범위 기준에서 빠져 범위가 무너지고
    // 단일 선택(focus)으로 떨어진다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('ORD'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1', 't3'])
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

/**
 * 앵커 = **범위의 시작점**. 주 선택(선택 배열의 마지막 원소)과 같은 것으로 취급하면,
 * 범위를 아래로 넓힐 때 마지막 원소가 "내가 클릭한 것"이 아니라 범위의 아래쪽 끝이 되어
 * 앵커가 범위를 따라 내려간다 — 위로는 되고 아래로는 안 되는 비대칭이 생긴다.
 */
describe('TableTree Shift 앵커', () => {
  /** 표시 순서를 MBR(t2) → MBR_A(t3) → MBR_GRD(t1)로 만든다(셋 다 g1). */
  const threeInGroup = () => {
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'MBR_A', '회원주소', 'g1') }
    return model
  }

  it('아래로 한 칸씩 넓혀도 앵커는 처음 클릭한 곳에 남는다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(threeInGroup(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_A'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't3'])
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    // 앵커가 마지막 원소(t3)로 끌려갔다면 t2가 조용히 빠져 ['t3', 't1']이 된다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't3', 't1'])
  })

  it('위로 한 칸씩 넓히면 아래 방향과 대칭인 결과를 낸다', async () => {
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(threeInGroup(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_A'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t3', 't1'])
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't3', 't1'])
  })

  it('앵커가 화면에서 사라지면 주 선택으로 폴백한다', async () => {
    // 미분류 ORD를 클릭해 앵커로 만든 뒤 그룹 뷰로 들어가면 앵커가 화면 밖이 된다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('ORD'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t3'])
    act(() => {
      useEditorStore.getState().enterGroupView('g1')
      useEditorStore.getState().selectTables(['t2'])   // 캔버스가 MBR을 골랐다
    })
    expect(screen.queryByText('ORD')).toBeNull()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    // 폴백이 없으면 앵커도 주 선택도 못 써서 단일 선택 ['t1']로 떨어진다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('선택이 통째로 갈아치워지면 앵커는 새 선택에 자리를 내준다', async () => {
    // Task 5가 캔버스 선택을 store로 밀어넣는다. 앵커가 화면에는 남아 있어도 더 이상
    // 선택의 일부가 아니면 "내가 잡아 둔 범위의 시작점"이 아니다.
    const user = userEvent.setup()
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))                       // 앵커 = t2
    act(() => { useEditorStore.getState().selectTables(['t1']) })   // 캔버스가 MBR_GRD를 골랐다
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('ORD'))
    await user.keyboard('{/Shift}')
    // 앵커 t2가 그대로 살아 있으면 ['t2', 't1', 't3']가 된다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1', 't3'])
  })

  it('Cmd+클릭은 앵커를 그 자리로 옮긴다', async () => {
    // Finder·VS Code와 같다 — Cmd로 하나 집으면 다음 Shift 범위는 거기서 시작한다.
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(threeInGroup(), 1, PROJECT_ID)
    renderTree()
    await user.click(screen.getByText('MBR'))
    await user.keyboard('{Meta>}')
    await user.click(screen.getByText('MBR_A'))
    await user.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't3'])
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('MBR_GRD'))
    await user.keyboard('{/Shift}')
    // 앵커가 MBR(t2)에 남아 있었다면 ['t2', 't3', 't1']이 된다.
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t3', 't1'])
  })
})
