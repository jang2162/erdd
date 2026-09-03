import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { DEFAULT_TABLE_OPTIONS } from '@erdd/core'
import type { ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { settle } from '@/testing/settle'
import { primaryTableId, useEditorStore } from './store.js'
import { useDragStore } from './drag-store.js'
import { reorderColumn } from './column-edits.js'
import { Canvas } from './canvas.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'
const SELF_USER_ID = '018f6b0e-0000-7000-8000-0000000000cc'

/*
 * `nodesDraggable`/`nodesConnectable`은 실제 렌더된 노드 클래스·핸들 DOM으로 관찰할 수 있다
 * (nodesConnectable은 TableNode/GhostNode가 isConnectable prop을 <Handle>에 전달하도록 고친
 * 뒤부터 — 이전에는 그 배선이 없어 핸들이 canEdit과 무관하게 항상 연결 가능했다. 아래
 * '핸들 수준 연결 가능 여부' 단언 참조).
 * 삭제는 더 이상 React Flow의 `deleteKeyCode`가 아니라 useEditorShortcuts가 전담한다 —
 * 그래서 `deleteKeyCode`는 권한과 무관하게 항상 null이고, "권한이 있으면 실제로 지워진다 /
 * 없으면 안 지워진다"는 Backspace를 눌러 모델·DOM 결과로 확인한다.
 * 그와 별개로 Canvas가 ReactFlow에 실제로 넘기는 리터럴 props도 캡처해 직접 단언한다
 * — 이는 "React Flow 자체가 그 값으로 무엇을 하는가"와 무관하게 "Canvas가 옳은 값을 넘겼는가"를
 * 독립적으로 검증하는 보강 신호다. 캡처 wrapper는 진짜 ReactFlow에 위임하므로 나머지 렌더·상호
 * 작용은 실제 그대로다(mock으로 인한 손실이 없다).
 */
const { capturedProps, updateNodeInternalsSpy } = vi.hoisted(() => ({
  capturedProps: [] as Record<string, unknown>[],
  // 앵커 핸들은 모델에 따라 붙고 떨어지므로 Canvas가 React Flow에 **재측정을 시켜야** 한다.
  // 그 호출은 DOM에 아무 흔적을 남기지 않아(jsdom은 좌표가 전부 0이다) 관찰할 길이 이 스파이뿐이다.
  // 훅은 매 렌더 같은 참조를 돌려줘야 한다 — Canvas가 이것을 effect deps에 넣으므로,
  // 렌더마다 새 함수를 주면 effect가 매번 다시 돌아 검사가 무의미해진다.
  updateNodeInternalsSpy: vi.fn(),
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: Parameters<typeof actual.ReactFlow>[0]) => {
      capturedProps.push(props as Record<string, unknown>)
      return <actual.ReactFlow {...props} />
    },
    // Canvas가 import하는 것만 바뀐다 — React Flow 내부는 자기 구현을 그대로 쓴다.
    useUpdateNodeInternals: () => updateNodeInternalsSpy,
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
 * React Flow **내부** 선택 플래그(top-level `node.selected`)를 내장 키보드 선택(Enter)으로 세운다.
 * 이 경로(NodeWrapper 자체의 onKeyDown)는 Canvas의 콜백을 거치지 않는 독립 경로라, 선택 배선이
 * 무엇에 기대는지와 무관하게 "React Flow가 노드를 선택된 것으로 알고 있다"만 만들어 낸다.
 *
 * 삭제 경로가 useEditorShortcuts(store 선택을 읽는다)로 옮겨진 지금 이것이 쓰이는 곳은
 * "React Flow가 노드를 선택된 것으로 알고 있어도 그것만으로는 지워지지 않는다"를 보이는 쪽이다.
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

/** React Flow가 자기 선택이 바뀔 때 부르는 콜백을 프로덕션 배선 그대로 두드린다. */
function fireSelectionChange(nodes: Node[]) {
  const handler = lastProps().onSelectionChange as
    | ((p: { nodes: Node[]; edges: Edge[] }) => void)
    | undefined
  if (!handler) throw new Error('Canvas가 ReactFlow에 onSelectionChange를 넘기지 않았다')
  act(() => { handler({ nodes, edges: [] }) })
}

/**
 * 선택 상자(Shift+빈 곳 드래그) 한 번. React Flow는 상자를 시작·종료할 때 onSelectionStart/End를,
 * 그 사이에 선택이 바뀔 때마다 onSelectionChange를 부른다 — 그 순서 그대로 두드린다.
 */
function fireBoxSelection(nodes: Node[]) {
  const p = lastProps()
  const start = p.onSelectionStart as ((e: unknown) => void) | undefined
  const end = p.onSelectionEnd as ((e: unknown) => void) | undefined
  if (!start || !end) throw new Error('Canvas가 ReactFlow에 onSelectionStart/End를 넘기지 않았다')
  act(() => { start({}) })
  fireSelectionChange(nodes)
  act(() => { end({}) })
}

/** 선택 상자를 시작만 하고 끝내지 않는다(pointercancel로 잘린 제스처). */
function fireBoxSelectionStart() {
  const start = lastProps().onSelectionStart as ((e: unknown) => void) | undefined
  if (!start) throw new Error('Canvas가 ReactFlow에 onSelectionStart를 넘기지 않았다')
  act(() => { start({}) })
}

/** onSelectionChange가 실어 보내는 모양의 최소 노드. 캔버스에는 테이블 말고도 여러 종류가 있다. */
function rfNode(id: string, type: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: {} }
}

function selectedNodeIds(): string[] {
  return (lastProps().nodes as Node[]).filter((n) => n.selected).map((n) => n.id)
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
    // 이 클릭은 store 선택(selectedTableIds=['t1'])까지 세워 둔다 — 삭제 단축키 훅이 읽는
    // 상태를 실제로 채워 놓아야 아래 "지워지지 않는다"가 공백이 아닌 검증이 된다.
    fireEvent.click(node)
    expect(node.querySelector('.ring-2')).not.toBeNull()

    // 노드를 선택한 뒤 Backspace를 눌러도 지워지지 않는다. 이제 이것을 보장하는 것은
    // deleteKeyCode가 아니라 useEditorShortcuts의 canEdit 가드다(deleteKeyCode는 권한과
    // 무관하게 항상 null이다). React Flow 내부 선택까지 세워 두고(selectViaKeyboard) 눌러도
    // 두 경로 어느 쪽으로도 삭제가 일어나지 않아야 한다.
    // 삭제 처리는 비동기(Promise 체인)라 "지워지지 않았다"를 확인하려면
    // waitFor(있음을 기대)로는 안 된다 — waitFor는 콜백이 처음 성공하는 즉시(t=0, 아직 삭제
    // 파이프라인이 돌기 전) 리턴해버려서 나중에 실제로 지워지더라도 통과해버리는 동어반복이
    // 된다. 그래서 삭제가 일어났다면 이미 끝났을 시간만큼 실제로 기다린 뒤 확인한다.
    selectViaKeyboard(node)
    pressBackspace()
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByTestId('rf__node-t1')).toBeInTheDocument()
  })

  it('편집 권한이 있으면 드래그·연결·삭제가 모두 허용된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    expect(lastProps().nodesDraggable).toBe(true)
    expect(lastProps().nodesConnectable).toBe(true)
    // deleteKeyCode는 권한과 무관하게 항상 null이다 — 삭제는 useEditorShortcuts가 전담한다
    // (두 삭제 경로가 공존하면 컬럼 선택 상태에서 어느 쪽이 이기는지가 렌더 순서에 달린다).
    // "편집 가능하면 삭제된다"는 아래 Backspace 대조군이 실제 삭제로 확인한다.
    expect(lastProps().deleteKeyCode).toBeNull()

    const node = screen.getByTestId('rf__node-t1')
    expect(node.className).toMatch(/(^|\s)draggable(\s|$)/)
    expect(node.className).toMatch(/(^|\s)nopan(\s|$)/)

    // 대조군: 편집 가능하면 그룹 노드도 draggable/nopan이 있다.
    const groupNode = screen.getByTestId('rf__node-group:g1')
    expect(groupNode.className).toMatch(/(^|\s)draggable(\s|$)/)
    expect(groupNode.className).toMatch(/(^|\s)nopan(\s|$)/)

    // 대조군: 편집 권한이 있으면 핸들도 실제로 연결 가능 상태(class="connectable")로 렌더된다.
    // 대상은 **연결용 중앙 핸들('l'/'r')뿐이다.** 컬럼 앵커 핸들('l:c:…' 등)은 관계선이 붙는
    // 자리를 표시하기만 하고 연결 대상이 아니어서(설계 D-3) 권한과 무관하게 connectable 이
    // 아니다 — 전부를 훑으면 그 설계를 위반해야만 통과하는 테스트가 된다.
    const handles = node.querySelectorAll(
      '.react-flow__handle[data-handleid="l"], .react-flow__handle[data-handleid="r"]')
    expect(handles.length).toBeGreaterThan(0)
    for (const h of handles) {
      expect(h.className).toMatch(/(^|\s)connectable(\s|$)/)
    }
    // 앵커 핸들은 반대로 연결 불가여야 한다 — 그래야 위 셀렉터 축소가 검사를 무르게 하지 않는다.
    for (const h of node.querySelectorAll('.react-flow__handle')) {
      const id = h.getAttribute('data-handleid') ?? ''
      if (id === 'l' || id === 'r') continue
      expect(h.className).not.toMatch(/(^|\s)connectable(\s|$)/)
    }

    // 대조군: 클릭으로도 여전히 선택(조회)된다.
    // 클릭은 onNodeClick을 통해 **store 선택**(selectedTableIds)을 바꾼다 — 삭제 단축키 훅이
    // 읽는 것이 바로 이 상태다(React Flow 내부 선택 플래그가 아니다).
    fireEvent.click(node)
    expect(node.querySelector('.ring-2')).not.toBeNull()

    // 대조군: 선택 후 Backspace를 누르면 실제로 캔버스에서 지워진다.
    // 삭제 경로는 React Flow 내장(deleteKeyCode)이 아니라 useEditorShortcuts다 — 훅이
    // store 선택을 읽어 removeTable mutation을 낸다. 낙관적 적용이 모델을 즉시 바꾸므로
    // 노드가 사라진다. mutation이 실제로 돌려면 trpc 응답이 필요하다.
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
    expect(primaryTableId(useEditorStore.getState())).toBe('t2')      // 주 선택([0])도 그대로
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

  it('새로 고른 테이블은 뒤에 붙는다 — 주 선택([0])은 먼저 고른 것이 지킨다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t2'])
    notifySelect({ type: 'select', id: 't1', selected: true })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
    expect(primaryTableId(useEditorStore.getState())).toBe('t2')
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
    expect(primaryTableId(useEditorStore.getState())).toBe('t1')   // 먼저 고른 것이 주 선택
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
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null, alias: '' },
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
    // "모델이 바뀌면 노드를 다시 만든다"는 effect가 돌지 않는다. onNodeDragStop이 노드 배열을
    // `derived`로 되돌리지 않으면 노드가 드롭 지점에 **영영** 남아 화면과 모델이 갈린다.
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

/**
 * 노드를 다시 만들 때 React Flow가 실측해 둔 `measured`를 이어 붙이는지 잠근다.
 *
 * 이어 붙이지 않으면 `adoptUserNodes`가 internals를 다시 만들면서 `parseHandles`가
 * **이전 `handleBounds`까지 버린다**(`!userNode.measured`면 undefined를 돌려준다). 그러면
 * NodeWrapper가 `visibility: hidden`으로 그리고, `getNodesInside`가 박스 밖 노드까지 전부 선택
 * 대상으로 고른다(`forceInitialRender`가 켜지는 갈래와, 크기가 0으로 떨어져
 * `overlappingArea(0) >= area(0)`이 참이 되는 갈래 **둘 다** — canvas.tsx의 `keepMeasured` 주석).
 * shift+드래그 박스 선택을 유지하는 내내 캔버스 전체가 깜박이던 진동이 이것이다.
 *
 * jsdom에는 ResizeObserver 측정이 없으므로 dimensions change를 직접 주입해 measured를 심는다
 * (`applyNodeChanges`의 `case 'dimensions'`가 `element.measured`를 세운다).
 *
 * ⚠️ **여기서 잠그는 것은 사용자 노드 배열의 `measured`까지다.** 그 결과 React Flow 내부의
 * `internals.handleBounds`가 실제로 살아남는지는 잠그지 못한다 — jsdom에는 레이아웃이 없어
 * `getBoundingClientRect`가 전부 0이라 핸들 측정 자체가 성립하지 않는다. 그 마지막 한 칸은
 * 브라우저 스모크가 덮는다.
 */
describe('Canvas — 노드 재구성이 measured를 버리지 않는다', () => {
  function measureNode(id: string, width: number, height: number) {
    act(() => {
      (lastProps().onNodesChange as (c: unknown[]) => void)(
        [{ type: 'dimensions', id, dimensions: { width, height } }])
    })
  }

  function nodeById(id: string) {
    return (lastProps().nodes as Node[]).find((n) => n.id === id)
  }

  it('선택이 바뀌어 노드를 다시 만들어도 이전 measured가 이어진다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    measureNode('t1', 240, 120)
    measureNode('t2', 260, 180)
    expect(nodeById('t1')?.measured).toEqual({ width: 240, height: 120 })

    act(() => { useEditorStore.getState().selectTables(['t2']) })

    // 재구성이 실제로 일어났다는 증거. 이것이 없으면 아래 measured 단언이 공허하다 —
    // `derived`가 다시 만들어지지 않았다면 measured는 당연히 그대로다.
    expect(nodeById('t2')?.selected).toBe(true)
    expect(nodeById('t1')?.measured).toEqual({ width: 240, height: 120 })
    expect(nodeById('t2')?.measured).toEqual({ width: 260, height: 180 })
  })

  it('드롭 후 노드를 원위치로 되돌릴 때도 measured가 이어진다', () => {
    // onNodeDragStop의 좌표 되돌리기도 노드 배열을 통째로 교체하는 자리다(canvas.tsx에서
    // `keepMeasured(prev, derived)`를 거치는 두 곳 중 하나). 여기서 measured가 빠지면 드롭할
    // 때마다 같은 깜박임이 난다.
    const tbl = (id: string, x: number, y: number) => ({ id, type: 'table', position: { x, y } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    measureNode('t2', 240, 120)
    act(() => {
      (lastProps().onNodesChange as (c: unknown[]) => void)(
        [{ type: 'position', id: 't2', position: { x: 999, y: 999 }, dragging: false }])
    })

    act(() => { (lastProps().onNodeDragStart as (e: unknown, n: unknown) => void)({}, tbl('t2', 300, 0)) })
    act(() => { useDragStore.getState().moveOver({ groupId: 'g1' }) })   // t2는 이미 g1이다(op 없음)
    act(() => {
      (lastProps().onNodeDragStop as (e: unknown, n: unknown, d: unknown[]) => void)(
        {}, tbl('t2', 999, 999), [tbl('t2', 999, 999)])
    })

    // 좌표가 되돌아왔다 = 노드 배열을 `derived`로 되돌리는 경로를 실제로 탔다는 증거.
    expect(nodeById('t2')?.position).toEqual({ x: 300, y: 0 })
    expect(nodeById('t2')?.measured).toEqual({ width: 240, height: 120 })
  })
})

describe('Canvas — 컬럼 클릭 선택', () => {
  // stopPropagation 회귀 검증: 컬럼 <li>의 onClick이 stopPropagation을 부르지 않으면 클릭이
  // 상위 노드로도 전파돼 React Flow가 그 노드를 선택하고, 그 `select` 델타가 창구를 통해
  // selectTables(['t2'])로 도착한다. selectTables는 CLEARED_SELECTION을 거치므로
  // selectedColumnIds가 조용히 지워진다 — stopPropagation이 빠지면 클릭 직후 []로 관찰된다.
  it('컬럼을 클릭하면 컬럼만 선택되고 테이블 전체 선택으로 덮이지 않는다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    // React Flow의 NodeWrapper는 첫 렌더에서 치수를 측정하기 전까지 visibility:hidden을
    // 준다(jsdom엔 실제 레이아웃이 없어 계속 hidden으로 남는다). getByRole은 접근성 트리에서
    // hidden 요소를 제외하므로 테이블 노드 안에서는 쓸 수 없다 — 기존 테스트들처럼 getByText로
    // 찾은 뒤 li로 거슬러 올라간다(fireEvent.click은 visibility와 무관하게 동작한다).
    const columnRow = screen.getByText('MBR_NO').closest('li')!
    fireEvent.click(columnRow)

    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().selectedColumnIds).toEqual(['c2'])
  })

  /*
   * 컬럼 불변식(`selectedTableIds.length !== 1` → 컬럼 선택은 빈 배열)을 **사용자 조작 경로**에서
   * 잠근다. store.test.ts가 액션 단위로 같은 것을 잠그지만, 그 상태에 도달할 캔버스 경로가
   * 실제로 불변식을 지키는지는 별개다 — 두 트랙이 각자 만든 선택 배선이 만나는 자리라 특히 그렇다.
   */
  it('컬럼을 고른 뒤 테이블을 더 고르면 컬럼 선택이 비워진다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    fireEvent.click(screen.getByText('MBR_NO').closest('li')!)
    expect(useEditorStore.getState().selectedColumnIds).toEqual(['c2'])

    // 수식키는 클릭 이벤트 플래그가 아니라 문서 레벨 키 트래커(useKeyPress)가 읽는다.
    // jsdom은 Mac이 아니므로 multiSelectionKeyCode 기본값은 'Control'이다.
    fireEvent.keyDown(document, { key: 'Control', code: 'ControlLeft' })
    fireEvent.click(screen.getByTestId('rf__node-t1'))
    fireEvent.keyUp(document, { key: 'Control', code: 'ControlLeft' })

    expect(useEditorStore.getState().selectedTableIds).toHaveLength(2)
    expect(useEditorStore.getState().selectedColumnIds).toEqual([])
  })
})

describe('Canvas — 앵커가 바뀌면 updateNodeInternals를 건다', () => {
  /*
   * 설계 5.5 의 배선. 앵커 핸들은 모델에 따라 붙고 떨어지는데 React Flow 는 그 변화를 **자동으로
   * 반영하지 않는다** — `parseHandles` 는 `measured` 가 있으면(우리는 `keepMeasured` 로 항상
   * 보존한다) 이전 `handleBounds` 를 그대로 물려주고, `updateNodeInternals` 는
   * `dimensionChanged || !handleBounds || force` 일 때만 다시 잰다. 그래서 Canvas 가 명시적으로
   * 불러야 하고, 그 호출은 DOM 에 흔적을 남기지 않으므로 이 스파이 없이는 배선이 통째로 사라져도
   * 아무 테스트가 빨개지지 않는다(실제로 리뷰 전까지 0건이었다).
   */
  function loadAndRender(model: ProjectModel) {
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    // 첫 렌더는 이전 서명이 비어 있어 앵커를 가진 테이블 전부가 대상이 된다(무해하다).
    // 이후 조작만 보려고 여기서 지운다.
    updateNodeInternalsSpy.mockClear()
  }

  /** 스파이가 받은 테이블 id 전부(호출이 여러 번이어도 합쳐서 본다). 순서에는 기대지 않는다. */
  function updatedTableIds() {
    return [...new Set(updateNodeInternalsSpy.mock.calls.flatMap((c) => c[0] as string[]))].sort()
  }

  it('관계를 지워 앵커가 사라지면 양쪽 테이블에 건다', () => {
    loadAndRender(buildSampleModel())

    const m = buildSampleModel()
    m.relationships = {}
    act(() => { useEditorStore.getState().setModel(m) })

    // r1(t1.c1 ← t2.c4)이 사라지면 두 테이블 모두 앵커가 0개가 된다.
    expect(updatedTableIds()).toEqual(['t1', 't2'])
  })

  it('관계를 더해 앵커가 늘면 그 테이블에 건다', () => {
    loadAndRender(buildSampleModel())

    const m = buildSampleModel()
    m.relationships['r2'] = {
      id: 'r2', parentTableId: 't1', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c3', parentColumnId: 'c1' }],
      cardinality: '1:N', identifying: false, name: null,
    }
    act(() => { useEditorStore.getState().setModel(m) })

    // t2 의 앵커가 [c:c4] → [c:c3, c:c4] 로 늘었다. t1 은 부모 컬럼이 같아 그대로다.
    expect(updatedTableIds()).toEqual(['t2'])
  })

  it('컬럼 순서를 바꾸면 앵커 키가 그대로여도 그 테이블에 건다', () => {
    /*
     * M-1 회귀. `reorderColumn` 은 두 컬럼의 order 만 맞바꾸므로 **앵커 키 집합이 변하지 않는다.**
     * 그런데 핸들의 y 는 그 행이 노드 안 몇 번째인가로 정해지고, 행 집합이 같아 노드 크기도
     * 안 변하니 ResizeObserver 도 뜨지 않는다. 여기서 재측정을 걸지 않으면 컬럼을 위아래로
     * 옮겼을 때 **선이 옛 행 높이에 남는다.**
     */
    loadAndRender(buildSampleModel())

    act(() => { useEditorStore.getState().setModel(reorderColumn(buildSampleModel(), 'c4', -1)) })

    expect(updatedTableIds()).toEqual(['t2'])
  })

  it('앵커도 컬럼 순서도 그대로면 아예 부르지 않는다', () => {
    // 설계 5.5 의 성능 요건 — 매 렌더 전부 부르면 그때마다 DOM 을 다시 재는 비용이 붙는다.
    // 모델 객체는 새것이라 memo·effect 는 실제로 다시 도는데, 서명이 같아 호출이 없어야 한다.
    loadAndRender(buildSampleModel())

    act(() => { useEditorStore.getState().setModel(buildSampleModel()) })

    expect(updateNodeInternalsSpy).not.toHaveBeenCalled()
  })
})

/*
 * B-2: 이름 템플릿 설계 D3 의 약속 — **캔버스 노드는 저장된 부분 이름을 그대로 보인다.**
 * 조합된 최종 이름은 산출물(DDL·DBML·Excel)과 편집 패널 미리보기만 쓴다.
 *
 * 여기는 실제 `Canvas` 를 그리므로 store → buildNodes → TableNode 배선 전체를 지난다 —
 * 그 사이 어느 자리에서 조합을 끼워 넣어도 여기가 빨개진다.
 *
 * ⚠️ 단언 둘이 한 짝이다. 「MBR 이 보인다」만 보면 템플릿이 안 걸린 픽스처에서도 초록이라
 * 구분력이 없다 — 「TB_SLS_MBR 이 없다」를 함께 봐야 조합을 쓰기 시작한 순간 빨개진다.
 */
describe('Canvas — 노드 이름', () => {
  it('노드는 조합된 최종 이름이 아니라 저장된 부분 이름을 보인다', () => {
    const model = buildSampleModel()
    model.tableGroups = { ...model.tableGroups, g1: { ...model.tableGroups.g1!, alias: 'SLS' } }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    useEditorStore.getState().setProjectConfig(
      {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}', tableLogicalTemplate: '',
      },
      ['postgresql'], null, DEFAULT_TABLE_OPTIONS,
    )
    renderCanvas()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.queryByText('TB_SLS_MBR')).not.toBeInTheDocument()
  })
})
