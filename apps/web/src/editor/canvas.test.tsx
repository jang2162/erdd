import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { settle } from '@/testing/settle'
import { primaryTableId, useEditorStore } from './store.js'
import { useDragStore } from './drag-store.js'
import { Canvas } from './canvas.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'
const SELF_USER_ID = '018f6b0e-0000-7000-8000-0000000000cc'

/*
 * `nodesDraggable`/`deleteKeyCode`/`nodesConnectable`은 모두 실제 렌더된 노드 클래스·키보드
 * 상호작용·핸들 DOM으로 관찰할 수 있다(nodesConnectable은 TableNode/GhostNode가 isConnectable
 * prop을 <Handle>에 전달하도록 고친 뒤부터 — 이전에는 그 배선이 없어 핸들이 canEdit과 무관하게
 * 항상 연결 가능했다. 아래 '핸들 수준 연결 가능 여부' 단언 참조).
 * 그와 별개로 Canvas가 ReactFlow에 실제로 넘기는 리터럴 props도 캡처해 세 가지를 직접 단언한다
 * — 이는 "React Flow 자체가 그 값으로 무엇을 하는가"와 무관하게 "Canvas가 옳은 값을 넘겼는가"를
 * 독립적으로 검증하는 보강 신호다. 캡처 wrapper는 진짜 ReactFlow에 위임하므로 나머지 렌더·상호
 * 작용은 실제 그대로다(mock으로 인한 손실이 없다).
 */
const { capturedProps } = vi.hoisted(() => ({ capturedProps: [] as Record<string, unknown>[] }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: Parameters<typeof actual.ReactFlow>[0]) => {
      capturedProps.push(props as Record<string, unknown>)
      return <actual.ReactFlow {...props} />
    },
  }
})

function renderCanvas() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  return render(<Canvas projectId={PROJECT_ID} selfUserId={SELF_USER_ID} />, { wrapper: w })
}

function lastProps() {
  const p = capturedProps.at(-1)
  if (!p) throw new Error('ReactFlow가 렌더되지 않았다')
  return p
}

/**
 * React Flow 내장 키보드 선택(Enter)으로 노드를 선택한다. 원래 마우스 클릭을 피한 이유는
 * 클릭이 Canvas의 onNodeClick으로 store 선택 상태(`selectedTableIds`, 당시 `selectedTableId`)를
 * 바꾸면 `derived`가 재계산되고 useEffect가 노드 배열을 다시 덮어써 React Flow 내부 선택
 * 플래그(top-level `node.selected`, 삭제 대상 판정에 쓰인다)를 지우는 렌더 경쟁이 있었기
 * 때문이다. **그 경쟁은 이제 없다** — `buildNodes`가 노드에 `selected`를 실어 보내므로 덮어써도
 * 플래그가 그대로 살아남는다(클릭으로 바꿔 돌려도 아래 삭제 단언이 통과하는 것을 확인했다).
 * 그래도 키보드 경로를 유지한다: onNodeClick을 거치지 않는 독립 경로라 선택 배선이 무엇에
 * 기대는지와 무관하게 "React Flow 내장 선택 → Backspace 삭제"만 겨눈다.
 * keyup을 반드시 같이 보내야 한다: keydown만 보내면 문서 레벨 useKeyPress 트래커들의
 * pressedKeys에 'Enter'가 눌린 채로 남아, 크기 비교(isMatchingKey)가 어긋나 이후 Backspace
 * 단일 키 조합을 더는 인식하지 못한다.
 */
function selectViaKeyboard(node: HTMLElement) {
  fireEvent.keyDown(node, { key: 'Enter', code: 'Enter' })
  fireEvent.keyUp(node, { key: 'Enter', code: 'Enter' })
}

function pressBackspace() {
  fireEvent.keyDown(document, { key: 'Backspace', code: 'Backspace' })
  fireEvent.keyUp(document, { key: 'Backspace', code: 'Backspace' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useEditorStore.getState().reset()
  useDragStore.getState().end()
  capturedProps.length = 0
})

describe('Canvas — 읽기 전용 잠금', () => {
  it('편집 권한이 없으면 드래그·연결·삭제를 막지만 조회는 그대로 된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer(canEdit=false) 상태.
    renderCanvas()

    // ReactFlow에 넘어간 리터럴 prop 3종이 모두 잠겨 있어야 한다.
    expect(lastProps().nodesDraggable).toBe(false)
    expect(lastProps().nodesConnectable).toBe(false)
    expect(lastProps().deleteKeyCode).toBeNull()

    // 조회는 된다: 테이블 노드·컬럼·메모가 렌더된다.
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('회원 도메인 메모')).toBeInTheDocument()

    // 노드 DOM 자체에도 draggable/nopan 클래스가 없다(위치 드래그 불가 — nodesDraggable=false).
    const node = screen.getByTestId('rf__node-t1')
    expect(node.className).not.toMatch(/(^|\s)draggable(\s|$)/)
    expect(node.className).not.toMatch(/(^|\s)nopan(\s|$)/)

    // 그룹(색상 영역) 노드는 buildGroupNodes가 draggable:true를 명시하므로 nodesDraggable=false여도
    // React Flow가 그 값을 그대로 존중해 계속 드래그 가능해지는 결함이 있었다(NodeWrapper의
    // isDraggable = node.draggable || (nodesDraggable && node.draggable === undefined) —
    // 노드가 draggable을 명시하면 캔버스 전역 nodesDraggable을 무시한다). 그룹 노드에도
    // draggable/nopan 클래스가 없어야 한다.
    const groupNode = screen.getByTestId('rf__node-group:g1')
    expect(groupNode.className).not.toMatch(/(^|\s)draggable(\s|$)/)
    expect(groupNode.className).not.toMatch(/(^|\s)nopan(\s|$)/)

    // 핸들 수준 연결 가능 여부: React Flow는 Handle의 isConnectable prop이 true일 때만
    // 'connectable' 클래스 토큰을 붙인다(HandleComponent가 cc()로 `{ connectable: isConnectable }`
    // 을 넣어 계산 — @xyflow/react dist/esm/index.mjs). 'connectablestart'/'connectableend'는
    // isConnectableStart/End(별개 prop, 항상 기본 true)에서 오므로 이름이 겹치지 않는 정확한
    // 토큰 매치가 필요하다. TableNode가 isConnectable을 <Handle>에 전달하지 않으면 이 값은
    // canEdit과 무관하게 항상 true로 남아 아래 두 단언 중 하나가 실패한다.
    const handles = node.querySelectorAll('.react-flow__handle')
    expect(handles.length).toBeGreaterThan(0)
    for (const h of handles) {
      expect(h.className).not.toMatch(/(^|\s)connectable(\s|$)/)
    }

    // 조회(선택)는 그대로 된다: 클릭하면 선택 링이 표시된다.
    fireEvent.click(node)
    expect(node.querySelector('.ring-2')).not.toBeNull()

    // 노드를 선택한 뒤 Backspace를 눌러도 deleteKeyCode가 null로 잠겨 있으니 지워지지 않는다.
    // React Flow의 삭제 처리는 비동기(Promise 체인)라 "지워지지 않았다"를 확인하려면
    // waitFor(있음을 기대)로는 안 된다 — waitFor는 콜백이 처음 성공하는 즉시(t=0, 아직 삭제
    // 파이프라인이 돌기 전) 리턴해버려서 나중에 실제로 지워지더라도 통과해버리는 동어반복이
    // 된다. 그래서 삭제가 일어났다면 이미 끝났을 시간만큼 실제로 기다린 뒤 확인한다.
    selectViaKeyboard(node)
    pressBackspace()
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByTestId('rf__node-t1')).toBeInTheDocument()
  })

  it('편집 권한이 있으면 드래그·연결·삭제가 모두 허용된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    expect(lastProps().nodesDraggable).toBe(true)
    expect(lastProps().nodesConnectable).toBe(true)
    expect(lastProps().deleteKeyCode).toBe('Backspace')

    const node = screen.getByTestId('rf__node-t1')
    expect(node.className).toMatch(/(^|\s)draggable(\s|$)/)
    expect(node.className).toMatch(/(^|\s)nopan(\s|$)/)

    // 대조군: 편집 가능하면 그룹 노드도 draggable/nopan이 있다.
    const groupNode = screen.getByTestId('rf__node-group:g1')
    expect(groupNode.className).toMatch(/(^|\s)draggable(\s|$)/)
    expect(groupNode.className).toMatch(/(^|\s)nopan(\s|$)/)

    // 대조군: 편집 권한이 있으면 핸들도 실제로 연결 가능 상태(class="connectable")로 렌더된다.
    const handles = node.querySelectorAll('.react-flow__handle')
    expect(handles.length).toBeGreaterThan(0)
    for (const h of handles) {
      expect(h.className).toMatch(/(^|\s)connectable(\s|$)/)
    }

    // 대조군: 클릭으로도 여전히 선택(조회)된다.
    fireEvent.click(node)
    expect(node.querySelector('.ring-2')).not.toBeNull()

    // 대조군: 선택 후 Backspace를 누르면 실제로 캔버스에서 지워진다
    // (React Flow 내장 선택+삭제 처리 — deleteKeyCode가 활성화돼 있어야만 동작한다).
    selectViaKeyboard(node)
    pressBackspace()
    await waitFor(() => {
      expect(screen.queryByTestId('rf__node-t1')).toBeNull()
    })
  })
})

/**
 * ReactFlow가 선택을 알리는 유일한 경로는 `onNodesChange`의 `select` 변경이다(노드를 prop으로
 * 통제하면 `onSelectionChange`는 우리가 넘긴 nodes prop의 메아리라 한 틱 늦다 — canvas.tsx 주석 참조).
 * 테스트도 같은 경로로 알린다.
 */
type SelectChange = { type: 'select'; id: string; selected: boolean }
const notifySelect = (...changes: SelectChange[]) =>
  (lastProps().onNodesChange as (c: SelectChange[]) => void)(changes)

describe('Canvas — store ↔ ReactFlow 선택 동기화', () => {
  it('store에 여러 테이블이 선택되면 해당 노드가 모두 selected로 넘어간다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t1', 't2'])
    await waitFor(() => {
      const nodes = lastProps().nodes as { id: string; type?: string; selected?: boolean }[]
      const tables = nodes.filter((n) => n.type === 'table')
      expect(tables.every((n) => n.selected)).toBe(true)
      expect(tables).toHaveLength(2)
    })
  })

  it('선택을 바꾸지 않는 알림은 store를 갱신하지 않는다 — 참조도 주 선택도 그대로다', async () => {
    // 가드가 없으면 같은 값을 다시 써서 배열 참조가 매번 새로 생기고(구독 화면이 헛리렌더),
    // selectTables가 CLEARED_SELECTION을 적용해 같은 클릭의 메모·관계 선택까지 지운다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t2', 't1'])
    await waitFor(() => expect(lastProps().nodes).toBeDefined())
    const before = useEditorStore.getState().selectedTableIds

    // 이미 선택된 것을 다시 "선택됨"으로, 선택 안 된 것을 다시 "해제됨"으로 알린다.
    notifySelect(
      { type: 'select', id: 't1', selected: true },
      { type: 'select', id: 't2', selected: true },
    )
    expect(useEditorStore.getState().selectedTableIds).toBe(before)   // 참조까지 그대로
    expect(primaryTableId(useEditorStore.getState())).toBe('t1')      // 주 선택도 그대로
  })

  it('선택 알림은 테이블 노드만 본다(메모는 무시)', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    notifySelect(
      { type: 'select', id: 't1', selected: true },
      { type: 'select', id: 'n1', selected: true },
    )
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })

  it('새로 고른 테이블은 뒤에 붙는다 — 마지막 원소가 주 선택이다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t2'])
    notifySelect({ type: 'select', id: 't1', selected: true })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
    expect(primaryTableId(useEditorStore.getState())).toBe('t1')
  })

  it('수식키+클릭은 선택을 토글한다 — 창구가 하나라 한 번 누르면 한 번만 뒤집힌다', () => {
    // 창구가 둘이면(onNodeClick 에도 토글이 남아 있으면) ReactFlow 내부 토글과 우리 토글이
    // 겹쳐 서로를 되돌려 아무 일도 안 일어난 것처럼 보인다.
    //
    // 수식키는 클릭 이벤트의 ctrlKey 플래그가 아니라 **문서 레벨 키 트래커**(useKeyPress)가
    // 읽으므로 keyDown/keyUp 을 따로 보낸다. userEvent 로 클릭하면 안 된다 — 그 포인터 이벤트가
    // jsdom 에서 d3-drag 의 nodrag 핸들러를 때려 "Cannot read properties of null (reading
    // 'document')" 로 죽는다(테스트는 통과하지만 uncaught exception 3건이 남는다).
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    // jsdom 은 Mac 이 아니므로 ReactFlow 의 multiSelectionKeyCode 기본값은 'Control' 이다.
    fireEvent.click(screen.getByTestId('rf__node-t1'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])

    fireEvent.keyDown(document, { key: 'Control', code: 'ControlLeft' })
    fireEvent.click(screen.getByTestId('rf__node-t2'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1', 't2'])
    expect(primaryTableId(useEditorStore.getState())).toBe('t2')   // 마지막에 고른 것이 주 선택
    fireEvent.click(screen.getByTestId('rf__node-t2'))             // 같은 것을 다시 → 빠진다
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
    fireEvent.keyUp(document, { key: 'Control', code: 'ControlLeft' })
  })

  /**
   * 메모 클릭에서 실제 발화 순서는 **델타가 먼저, `onNodeClick`이 나중**이다
   * (`onSelectNodeHandler`가 `handleNodeClick`을 부른 뒤 `onClick(event, node)`을 부른다).
   * 그래서 이 테스트가 잡는 것은 `onNodeClick`의 메모 분기 하나다 — 그것을 빼면 이 1건이 실패한다.
   *
   * ⚠️ **`selectTables([])`의 비대칭(빈 배열은 메모·관계·그룹 선택을 지우지 않는다)은 여기서
   * 잡히지 않는다.** 비대칭을 지워도 이 테스트는 통과한다(실증). 그 규약을 잠그는 것은
   * `store.test.ts`의 「selectTables([])는 테이블만 비우고 메모·관계·그룹 선택은 건드리지 않는다」
   * 한 건이다.
   *
   * 캔버스 쪽에서 "순서가 뒤집혀도 옳다"를 따로 잠그려던 테스트가 있었으나 **아무것도 붙잡지
   * 못해 지웠다.** `selectNote`가 이미 `selectedTableIds`를 비우므로, 뒤늦게 도착한 해제 델타는
   * 바꿀 것이 없어 루프 가드에 걸리고 `selectTables`를 **한 번도 부르지 않는다**(호출 횟수 0으로
   * 계측). 두 단언이 `selectNote` 하나만으로 이미 참이라 어떤 회귀에도 반응하지 않았다.
   */
  it('메모를 클릭하면 테이블 선택만 풀리고 메모 선택은 남는다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t1'])
    await waitFor(() => expect(lastProps().nodes).toBeDefined())

    fireEvent.click(screen.getByTestId('rf__node-n1'))

    await waitFor(() => {
      expect(useEditorStore.getState().selectedNoteId).toBe('n1')
      expect(useEditorStore.getState().selectedTableIds).toEqual([])
    })
  })
})

/**
 * 캔버스 → 사이드바 드롭(설계 5.4). 드래그 소스만 다르고 "좌표 → 드롭 타깃" 판정과 그룹 이동
 * 규칙은 사이드바와 같은 함수(`dropTargetAt`·`applyGroupMove`)로 수렴한다.
 *
 * ⚠️ **이 스위트는 `onNodeDrag*` 콜백을 직접 부른다.** jsdom에는 레이아웃이 없어 실제 포인터
 * 드래그를 재현할 수 없기 때문이다(userEvent의 포인터 이벤트는 d3-drag를 때려 uncaught 예외를
 * 낸다). 그래서 **ReactFlow가 그 콜백에 무엇을 넘기는지**(특히 `dragged` 배열의 실제 구성)는
 * 검증되지 않는다 — 자동 팬·노드 원위치 복귀의 시각적 결과와 함께 브라우저 스모크가 덮는다.
 */
describe('Canvas — 사이드바 그룹으로 드롭', () => {
  /** 샘플 모델 + 멤버가 있는 두 번째 그룹 g2. 멤버가 있어야 `planGroupMove`가 좌표를 계산한다. */
  function withGroupB() {
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    model.tables = {
      ...model.tables,
      t3: {
        id: 't3', logicalName: '주문', physicalName: 'ORD', comment: null,
        groupId: 'g2', position: { x: 1000, y: 500 }, groupPosition: null, custom: {},
      },
    }
    return model
  }

  type FakeNode = { id: string; type: string; position: { x: number; y: number } }
  const tbl = (id: string, x: number, y: number): FakeNode =>
    ({ id, type: 'table', position: { x, y } })

  function captureMutations(): { summary?: string }[] {
    const calls: { summary?: string }[] = []
    mockTrpcFetch({
      'model.mutate': (input) => { calls.push(input as { summary?: string }); return { data: { seq: 2 } } },
    })
    return calls
  }

  function dragStart(node: FakeNode | { id: string; type: string; position: { x: number; y: number } }) {
    act(() => {
      (lastProps().onNodeDragStart as (e: unknown, n: unknown) => void)({}, node)
    })
  }

  function dragMove(node: FakeNode | { id: string; type: string; position: { x: number; y: number } },
    clientX: number, clientY: number) {
    act(() => {
      (lastProps().onNodeDrag as (e: unknown, n: unknown) => void)({ clientX, clientY }, node)
    })
  }

  function dragStop(node: { id: string; type: string; position: { x: number; y: number } },
    dragged: { id: string; type: string; position: { x: number; y: number } }[]) {
    act(() => {
      (lastProps().onNodeDragStop as (e: unknown, n: unknown, d: unknown[]) => void)({}, node, dragged)
    })
  }

  /** 커서가 사이드바의 어느 그룹 블록 위에 있는 상태를 만든다(jsdom엔 레이아웃이 없다). */
  function hoverTarget(groupId: string | null) {
    act(() => { useDragStore.getState().moveOver({ groupId }) })
  }

  /** ReactFlow 내부 노드만 옮긴다 — 드래그로 노드가 화면에서 움직인 상태를 재현한다. */
  function moveNodeInternally(id: string, position: { x: number; y: number }) {
    act(() => {
      (lastProps().onNodesChange as (c: unknown[]) => void)(
        [{ type: 'position', id, position, dragging: false }])
    })
  }

  function nodePosition(id: string) {
    const nodes = lastProps().nodes as { id: string; position: { x: number; y: number } }[]
    return nodes.find((n) => n.id === id)?.position
  }

  it('드롭 타깃 위에서 놓으면 위치 이동 대신 그룹 이동이 나간다', async () => {
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(withGroupB(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    dragStart(tbl('t2', 300, 0))
    hoverTarget('g2')
    dragStop(tbl('t2', 999, 999), [tbl('t2', 999, 999)])

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    // 드롭 지점의 캔버스 좌표(999,999)는 버린다 — 최종 자리는 planGroupMove가 정한다.
    // g2의 기준 bbox = t3(1000,500) + (EST_W 260, estHeight(0) 72) → maxX 1260 · minY 500.
    // dx = 1260 + GAP 60 - 300 = 1020 · dy = 500 - 0 = 500.
    expect(useEditorStore.getState().model.tables['t2']?.position).toEqual({ x: 1320, y: 500 })
    // 그룹 뷰 전용 좌표는 새 그룹에서 의미가 없다(설계 6.1).
    expect(useEditorStore.getState().model.tables['t2']?.groupPosition).toBeNull()

    // 그룹 배정·groupPosition 초기화·좌표 재배치가 한 producer라 Revision도 undo도 한 건이다.
    await settle()
    expect(calls).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('드롭 타깃이 없으면 기존 위치 이동 경로 그대로다', async () => {
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    dragStart(tbl('t2', 300, 0))
    dragStop(tbl('t2', 50, 60), [tbl('t2', 50, 60)])

    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t2']?.position).toEqual({ x: 50, y: 60 })
    })
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g1')   // 그대로
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.summary).toBe('이동')
  })

  it('드롭 타깃 위에 있는 동안에는 autoPanOnNodeDrag를 끈다', async () => {
    // 기본값이 true라, 사이드바 쪽 가장자리에 커서를 대고 있으면 캔버스가 계속 팬되어
    // 다른 노드들이 화면 밖으로 밀려난다(설계 5.4).
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    expect(lastProps().autoPanOnNodeDrag).toBe(true)

    dragStart(tbl('t2', 300, 0))
    hoverTarget('g1')
    await waitFor(() => expect(lastProps().autoPanOnNodeDrag).toBe(false))

    // 타깃 밖으로 나오면 다시 켜진다 — 끈 채로 남으면 이후 드래그에서 팬이 영영 죽는다.
    act(() => { useDragStore.getState().moveOver(null) })
    await waitFor(() => expect(lastProps().autoPanOnNodeDrag).toBe(true))
  })

  it('노드를 잡으면 선택 전체를 캔버스 드래그로 시작한다 — 선택 밖이면 그것 하나다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    useEditorStore.getState().selectTables(['t1', 't2'])
    dragStart(tbl('t1', 0, 0))
    expect(useDragStore.getState().tableIds).toEqual(['t1', 't2'])
    // 커서 고스트는 사이드바 전용이다 — 캔버스는 ReactFlow가 노드를 실제로 끌고 다닌다.
    expect(useDragStore.getState().source).toBe('canvas')

    act(() => { useDragStore.getState().end() })
    useEditorStore.getState().selectTables(['t1'])
    dragStart(tbl('t2', 300, 0))
    expect(useDragStore.getState().tableIds).toEqual(['t2'])
  })

  it('노드를 끄는 동안 커서 좌표로 드롭 타깃을 세운다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    const block = document.createElement('div')
    block.setAttribute('data-drop-group', 'g1')
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(block)

    dragStart(tbl('t2', 300, 0))
    dragMove(tbl('t2', 310, 10), 7, 9)
    expect(useDragStore.getState().over).toEqual({ groupId: 'g1' })

    // 대조군: 그룹 노드 드래그는 같은 좌표에서도 드롭 타깃을 세우지 않는다 —
    // 그것은 "그룹 통째 이동"이라는 다른 조작이다(설계 5.4).
    act(() => { useDragStore.getState().end() })
    const groupNode = { id: 'group:g1', type: 'group', position: { x: 0, y: 0 } }
    dragStart(groupNode)
    dragMove({ ...groupNode, position: { x: 10, y: 10 } }, 7, 9)
    expect(useDragStore.getState().over).toBeNull()
  })

  it('터치 드래그도 좌표를 찾는다 — ReactFlow는 TouchEvent도 넘긴다', () => {
    // 이 콜백의 이벤트 타입은 `MouseEvent | TouchEvent`다. 터치에는 clientX/Y가 없고, 손을 떼는
    // 순간(touchend)에는 `touches`가 비고 `changedTouches`에만 남는다. 마우스 좌표만 읽으면
    // 태블릿에서 드롭 타깃이 영영 잡히지 않는다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    const block = document.createElement('div')
    block.setAttribute('data-drop-group', 'g1')
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(block)
    const onNodeDrag = () => lastProps().onNodeDrag as (e: unknown, n: unknown) => void

    dragStart(tbl('t2', 300, 0))
    act(() => {
      onNodeDrag()({ touches: [{ clientX: 11, clientY: 22 }], changedTouches: [] }, tbl('t2', 1, 1))
    })
    expect(spy).toHaveBeenLastCalledWith(11, 22)
    expect(useDragStore.getState().over).toEqual({ groupId: 'g1' })

    act(() => {
      onNodeDrag()({ touches: [], changedTouches: [{ clientX: 33, clientY: 44 }] }, tbl('t2', 1, 1))
    })
    expect(spy).toHaveBeenLastCalledWith(33, 44)

    // 좌표를 아예 못 구하면 "어떤 타깃 위도 아님"으로 떨어진다 — 마지막 타깃을 남겨 두면
    // 조준 지점을 모르는 채로 엉뚱한 그룹에 떨어진다.
    act(() => { onNodeDrag()({ touches: [], changedTouches: [] }, tbl('t2', 1, 1)) })
    expect(useDragStore.getState().over).toBeNull()
  })

  it('그룹 노드 드래그는 드롭 분기에 들어가지 않는다 — 그룹 통째 이동 그대로다', async () => {
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(withGroupB(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    const groupNode = { id: 'group:g1', type: 'group', position: { x: 0, y: 0 } }
    dragStart(groupNode)
    // 커서가 사이드바의 다른 그룹 위에 있는 상태를 만든다 — 가드가 없으면 여기서 새어 나간다.
    act(() => { useDragStore.getState().start(['t1', 't2'], 'canvas') })
    hoverTarget('g2')
    dragStop({ ...groupNode, position: { x: 40, y: 20 } }, [{ ...groupNode, position: { x: 40, y: 20 } }])

    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']?.position).toEqual({ x: 40, y: 20 })
    })
    expect(useEditorStore.getState().model.tables['t2']?.position).toEqual({ x: 340, y: 20 })
    expect(useEditorStore.getState().model.tables['t1']?.groupId).toBe('g1')   // 그룹은 안 바뀐다
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.summary).toBe('그룹 이동')   // 일괄 그룹 배정('그룹 이동 (N개)')이 아니다
  })

  it('테이블이 아닌 노드는 그룹 이동에 섞이지 않는다', async () => {
    // 고스트 노드는 **노드 id가 원본 테이블 id 그대로**다(ghost-nodes.ts의 주석) — 거르지 않으면
    // 다른 그룹에 있는 테이블이 함께 끌려온다. 메모는 애초에 그룹 멤버가 아니다.
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(withGroupB(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    dragStart(tbl('t2', 300, 0))
    hoverTarget('g2')
    dragStop(tbl('t2', 999, 999), [
      tbl('t2', 999, 999),
      { id: 't1', type: 'ghost', position: { x: 5, y: 5 } },
      { id: 'n1', type: 'note', position: { x: 5, y: 5 } },
    ])

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    expect(useEditorStore.getState().model.tables['t1']?.groupId).toBe('g1')
    expect(useEditorStore.getState().model.notes['n1']?.position).toEqual({ x: 600, y: 0 })
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.summary).toBe('그룹 이동 (1개)')
  })

  it('다중 선택 드래그는 선택 전체가 함께 옮겨지고 상대 배치가 보존된다', async () => {
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(withGroupB(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderCanvas()

    dragStart(tbl('t1', 0, 0))
    hoverTarget('g2')
    dragStop(tbl('t1', 900, 900), [tbl('t1', 900, 900), tbl('t2', 1200, 900)])

    await waitFor(() => expect(useEditorStore.getState().model.tables['t1']?.groupId).toBe('g2'))
    const tables = useEditorStore.getState().model.tables
    expect(tables['t2']?.groupId).toBe('g2')
    // 이동 전 (300, 0) 차이가 그대로다.
    expect(tables['t2']!.position.x - tables['t1']!.position.x).toBe(300)
    expect(tables['t2']!.position.y - tables['t1']!.position.y).toBe(0)
    await settle()
    expect(calls).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)   // undo 1회로 전부 원복된다
  })

  it('드롭이 아무것도 바꾸지 않아도 노드는 원위치로 돌아온다', async () => {
    // 같은 그룹에 놓으면 applyGroupMove가 op를 내지 않는다 → 모델이 그대로라 `derived`도 그대로고,
    // "모델이 바뀌면 노드를 다시 만든다"는 effect가 돌지 않는다. setNodes(derived)가 없으면 노드가
    // 드롭 지점에 **영영** 남아 화면과 모델이 갈린다.
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    moveNodeInternally('t2', { x: 999, y: 999 })
    expect(nodePosition('t2')).toEqual({ x: 999, y: 999 })

    dragStart(tbl('t2', 300, 0))
    hoverTarget('g1')                                   // t2는 이미 g1이다
    dragStop(tbl('t2', 999, 999), [tbl('t2', 999, 999)])

    expect(nodePosition('t2')).toEqual({ x: 300, y: 0 })
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('드롭 타깃이 그대로면 캔버스를 다시 그리지 않는다', () => {
    // 캔버스는 autoPanOnNodeDrag 때문에 드래그 store의 `over`를 구독한다. 타깃이 **바뀔 때만**
    // 리렌더돼야 커서 움직임마다 캔버스 전체가 다시 그려지는 것(설계 5.2)을 피한다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    dragStart(tbl('t2', 300, 0))
    const nodesBefore = lastProps().nodes

    const beforeEnter = capturedProps.length
    hoverTarget('g1')
    expect(capturedProps.length).toBeGreaterThan(beforeEnter)   // 진입은 리렌더한다(팬을 꺼야 한다)

    const afterEnter = capturedProps.length
    hoverTarget('g1')                                           // 같은 블록 위에서 계속 움직인다
    expect(capturedProps.length).toBe(afterEnter)               // 더는 안 그린다
    expect(lastProps().nodes).toBe(nodesBefore)                 // 노드 배열도 다시 만들지 않는다
  })

  it('읽기 전용이면 드롭해도 op가 나가지 않는다', async () => {
    // 권한 판정은 applyGroupMove 한 곳이다(bulk-panel.tsx) — 여기서 또 막으면 가드가 두 벌이 된다.
    const calls = captureMutations()
    useEditorStore.getState().setLoaded(withGroupB(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer(canEdit=false).
    renderCanvas()

    dragStart(tbl('t2', 300, 0))
    hoverTarget('g2')
    dragStop(tbl('t2', 999, 999), [tbl('t2', 999, 999)])

    await settle()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g1')
  })
})
