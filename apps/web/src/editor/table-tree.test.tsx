import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { useDragStore } from './drag-store.js'
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

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset(); useDragStore.getState().end()
})

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

/**
 * 사이드바 내부 드래그. jsdom에는 레이아웃 엔진이 없어 `document.elementFromPoint`가 **아예 없다**
 * (test-setup이 null을 주는 스텁으로 채운다). 그래서 좌표로는 드롭 타깃을 찾을 수 없고,
 * 판정 규칙은 `drop-target.test.ts`가 잡고 여기서는 `useDragStore.moveOver`로 타깃을 직접 세운다.
 */
describe('TableTree 드래그 그룹 이동', () => {
  /** g1(회원관리)에 t1·t2, 그리고 멤버 없는 빈 그룹 하나를 더한 모델. */
  function withEmptyGroup(id: string, name: string) {
    const model = buildSampleModel()
    model.tableGroups = { ...model.tableGroups, [id]: { id, name, color: '#000', comment: null } }
    return model
  }

  /** 항목을 잡고 임계를 넘겨 끌기 시작한다. */
  function grab(name: string): HTMLElement {
    const item = screen.getByText(name).closest('button')!
    fireEvent.pointerDown(item, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(item, { clientX: 40, clientY: 0, pointerId: 1 })
    return item
  }

  /** 커서 아래 타깃을 세우고 손을 뗀다. */
  function dropOn(item: HTMLElement, groupId: string | null): void {
    act(() => { useDragStore.getState().moveOver({ groupId }) })
    fireEvent.pointerUp(item, { clientX: 40, clientY: 0, pointerId: 1 })
  }

  function countMutations(): unknown[] {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    return calls
  }

  /**
   * "op가 하나도 안 나갔다"를 단언하기 전에 나갈 것을 다 내보낸다.
   *
   * mutate는 직렬화 체인 → 낙관적 적용 → 배치 링크의 자체 스케줄러 → fetch 순으로 흐른다.
   * 태스크 한 틱만 밀면 fetch가 아직 안 나가서 **op가 실제로 나갔는데도 통과한다**
   * (실측: 한 틱 버전으로 같은 describe를 3회 돌려 1회 누수). 여러 틱 밀어 확정시킨다.
   */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => { setTimeout(r, 0) }) })
    }
  }

  /** mutate가 서버까지 나간 것을 기다린다 — 낙관적 적용보다 늦으므로 모델 단언과 따로 본다. */
  async function expectSent(calls: unknown[], n: number): Promise<void> {
    await waitFor(() => { expect(calls).toHaveLength(n) })
  }

  it('트리 항목을 끌어 다른 그룹에 놓으면 그룹이 바뀌고 op 한 건이 나간다', async () => {
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    dropOn(grab('MBR'), 'g2')

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    // 그룹 배정·좌표 재배치가 한 producer라 Revision도 한 건이다.
    await expectSent(calls, 1)
  })

  it('잡은 항목이 선택에 있으면 선택 전체가 함께 옮겨진다', async () => {
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()

    dropOn(grab('MBR'), 'g2')

    await waitFor(() => expect(useEditorStore.getState().model.tables['t1']?.groupId).toBe('g2'))
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2')
    await expectSent(calls, 1)
  })

  it('잡은 항목이 선택 밖이면 그것 하나만 끌리고 선택도 그것으로 바뀐다', async () => {
    // 파일 탐색기 관례. 끌고 있는 것과 강조된 것이 갈리면 무엇이 옮겨질지 알 수 없다.
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1'])
    renderTree()

    const item = grab('MBR')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    dropOn(item, 'g2')

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    expect(useEditorStore.getState().model.tables['t1']?.groupId).toBe('g1')
    await expectSent(calls, 1)
  })

  it('미분류에 놓으면 그룹에서 빠진다', async () => {
    const calls = countMutations()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    dropOn(grab('MBR'), null)

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBeNull())
    await expectSent(calls, 1)
  })

  it('같은 그룹에 놓으면 아무 op도 내지 않는다', async () => {
    // changed 필터가 없으면 좌표 재배치·groupPosition 초기화만으로 빈 뜻의 Revision이 하나 생긴다.
    const calls = countMutations()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    dropOn(grab('MBR'), 'g1')   // t2는 이미 g1이다

    await settle()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t2']?.position).toEqual({ x: 300, y: 0 })
  })

  it('드롭 타깃 밖에서 손을 떼면 아무 op도 내지 않는다', async () => {
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    const item = grab('MBR')   // elementFromPoint가 없으므로 over는 null인 채다
    expect(useDragStore.getState().over).toBeNull()
    fireEvent.pointerUp(item, { clientX: 40, clientY: 0, pointerId: 1 })

    await settle()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g1')
  })

  it('임계보다 적게 움직이면 드래그가 아니라 클릭이다', async () => {
    // 손떨림으로 그룹이 바뀌면 안 된다 — 임계 아래 이동은 클릭으로 남아 포커스를 요청한다.
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    const item = screen.getByText('MBR').closest('button')!
    fireEvent.pointerDown(item, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(item, { clientX: 3, clientY: 3, pointerId: 1 })
    act(() => { useDragStore.getState().moveOver({ groupId: 'g2' }) })
    fireEvent.pointerUp(item, { clientX: 3, clientY: 3, pointerId: 1 })
    fireEvent.click(item)

    await settle()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })

  it('드래그로 끝난 뒤 따라오는 click은 선택을 갈아치우지 않는다', async () => {
    // pointerup 뒤에 click이 한 번 더 온다. 그것이 흘러가면 방금 여러 개를 끌어 놓고도
    // 선택이 잡았던 항목 하나로 접힌다.
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()

    const item = grab('MBR')
    dropOn(item, 'g2')
    fireEvent.click(item)

    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1', 't2'])
    expect(useEditorStore.getState().focusTableId).toBeNull()
    // 이 드롭이 낸 mutate를 이 테스트 안에서 끝낸다 — 남기면 다음 테스트의 fetch 스텁에 실려
    // "op가 없어야 한다"를 거짓으로 깨뜨린다(실제로 겪었다).
    await expectSent(calls, 1)
  })

  it('읽기 전용이면 드래그가 시작되지도, op가 나가지도 않는다', async () => {
    const calls = countMutations()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderTree()

    const item = grab('MBR')
    // 드래그를 시작시키면 드롭 타깃 하이라이트가 켜졌다 아무 일도 없어, 못 하는 조작처럼 보인다.
    expect(useDragStore.getState().tableIds).toEqual([])
    dropOn(item, 'g2')

    await settle()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g1')
  })

  it('그룹 블록과 미분류 블록이 드롭 타깃 속성을 단다 — 멤버 목록까지 감싼다', () => {
    // Task 8의 캔버스 드래그가 좌표로 찾는 DOM 계약이다. 헤더만 타깃이면 조준이 너무 어렵다.
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()

    const group = document.querySelector('[data-drop-group="g1"]')
    expect(group).not.toBeNull()
    expect(group!.contains(screen.getByText('MBR_GRD'))).toBe(true)
    const none = document.querySelector('[data-drop-group="unassigned"]')
    expect(none).not.toBeNull()
    expect(none!.contains(screen.getByText('ORD'))).toBe(true)
  })

  it('드래그 중에는 검색으로 숨은 그룹도 드롭 타깃으로 보인다', async () => {
    // 검색으로 찾은 테이블을 원하는 그룹에 놓을 수 없으면 드래그가 반쪽이다(설계 5.5).
    const user = userEvent.setup()
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문영역'), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    await user.type(screen.getByPlaceholderText('테이블 검색'), '회원')
    expect(screen.queryByText('주문영역')).toBeNull()   // 멤버가 안 걸려 숨었다는 전제를 잠근다

    act(() => { useDragStore.getState().start(['t2']) })
    expect(screen.getByText('주문영역')).toBeInTheDocument()
  })

  it('드래그 중에는 그룹 뷰로 숨은 그룹도 드롭 타깃으로 보인다', () => {
    // 그룹 뷰에서 "이건 다른 그룹으로 보내야겠다"가 가장 자연스러운 동선인데 막혀 있으면 안 된다.
    useEditorStore.getState().setLoaded(withEmptyGroup('g2', '주문관리'), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderTree()

    expect(screen.queryByText('주문관리')).toBeNull()   // 스코핑으로 숨었다는 전제를 잠근다

    act(() => { useDragStore.getState().start(['t2']) })
    expect(screen.getByText('주문관리')).toBeInTheDocument()
  })

  it('드래그 중에는 그룹 뷰에서도 미분류가 드롭 타깃으로 보인다', () => {
    // 그룹 뷰 안에서 그룹 밖으로 빼내는 유일한 드래그 동선이다.
    const model = buildSampleModel()
    model.tables = { ...model.tables, t3: tbl('t3', 'ORD', '주문', null) }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderTree()

    expect(screen.queryByText('미분류')).toBeNull()

    act(() => { useDragStore.getState().start(['t2']) })
    expect(screen.getByText('미분류')).toBeInTheDocument()
    expect(document.querySelector('[data-drop-group="unassigned"]')).not.toBeNull()
  })
})
