import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
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
 * React Flow **내부** 선택 플래그(top-level `node.selected`)를 세운다. 내장 키보드 선택(Enter)
 * 경로(NodeWrapper 자체의 onKeyDown)는 Canvas의 onNodeClick을 거치지 않으므로, 클릭이 store
 * 선택을 바꿔 `derived` → useEffect가 노드 배열을 덮어쓰며 그 플래그를 지우는 렌더 경쟁을 피한다.
 * 삭제 경로가 useEditorShortcuts(store 선택을 읽는다)로 옮겨진 지금 이것이 쓰이는 곳은
 * 읽기 전용 테스트뿐이다 — "React Flow가 노드를 선택된 것으로 알고 있어도 지워지지 않는다"를
 * 함께 보이기 위해서다.
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
  useEditorStore.getState().reset()
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
    const handles = node.querySelectorAll('.react-flow__handle')
    expect(handles.length).toBeGreaterThan(0)
    for (const h of handles) {
      expect(h.className).toMatch(/(^|\s)connectable(\s|$)/)
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

describe('Canvas — 컬럼 클릭 선택', () => {
  // stopPropagation 회귀 검증: 컬럼 <li>의 onClick이 stopPropagation을 부르지 않으면 React
  // Flow가 클릭을 상위 노드로도 전파해 Canvas의 onNodeClick(select(tableId))이 같은 이벤트
  // 틱에서 뒤이어 실행되고, select는 CLEARED_SELECTION을 거쳐 selectedColumnIds를 비운다.
  // 즉 stopPropagation이 빠지면 클릭 직후 selectedColumnIds가 []로 관찰된다.
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
})

/*
 * 이 블록은 **사용자 조작에서 출발한다.** store 액션(selectTables·toggleTable)을 테스트가 직접
 * 부르지 않는다 — 그렇게 부르는 테스트는 store 계약만 잠그고, "그 상태에 도달할 사용자 경로가
 * 있는가"는 보지 못한다. 실제로 이 배선이 들어오기 전까지 toggleTable은 프로덕션 호출처가 0건,
 * selectTables는 테이블 붙여넣기 하나뿐이어서 캔버스에서 테이블 2개를 고르는 방법이 없었는데도
 * 다중 선택 테스트는 전부 통과하고 있었다.
 */
describe('Canvas — 테이블 다중 선택 (사용자 조작 경로)', () => {
  it('Cmd/Ctrl+클릭으로 두 번째 테이블을 더하면 store 선택이 2개가 된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    fireEvent.click(screen.getByTestId('rf__node-t1'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])

    // 수식 키를 무시하고 항상 select(node.id)로 덮으면 여기서 ['t2']가 된다.
    fireEvent.click(screen.getByTestId('rf__node-t2'), { metaKey: true })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1', 't2'])

    // ctrlKey(윈도우·리눅스)도 같은 경로여야 한다 — 이미 선택된 것을 다시 누르면 빠진다.
    fireEvent.click(screen.getByTestId('rf__node-t1'), { ctrlKey: true })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])

    // 수식 키 없는 클릭은 그대로 단일 선택으로 되돌린다.
    fireEvent.click(screen.getByTestId('rf__node-t1'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })

  it('store 선택이 React Flow 노드의 selected 플래그로 미러링된다', () => {
    // buildNodes가 최상위 selected를 세우지 않으면, store가 바뀔 때마다 도는 setNodes(derived)가
    // React Flow의 내부 선택을 지운다(선택이라는 같은 사실이 두 곳에 따로 살게 된다).
    // 그러면 Cmd+클릭으로 store에 2개를 담아도 캔버스는 하나만 선택된 것으로 그린다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    fireEvent.click(screen.getByTestId('rf__node-t1'))
    fireEvent.click(screen.getByTestId('rf__node-t2'), { metaKey: true })

    expect(selectedNodeIds()).toEqual(['t1', 't2'])
  })

  it('다중 선택이 되면 컬럼 선택이 비워진다 (불변식 — 사용자 경로에서도)', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    // 컬럼 클릭으로 t2 + c2를 선택해 둔다.
    fireEvent.click(screen.getByText('MBR_NO').closest('li')!)
    expect(useEditorStore.getState().selectedColumnIds).toEqual(['c2'])

    // Cmd+클릭으로 t1을 더하면 테이블이 2개가 되므로 컬럼 선택은 성립하지 않는다.
    fireEvent.click(screen.getByTestId('rf__node-t1'), { metaKey: true })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
    expect(useEditorStore.getState().selectedColumnIds).toEqual([])
  })

  it('박스 선택이 store를 갱신하고 group·note·ghost는 걸러낸다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    // 캔버스에는 테이블 말고도 그룹(색상 영역)·메모·고스트 노드가 함께 있고 상자에 함께 걸린다.
    // 고스트는 **원본 테이블 id를 그대로** 쓰므로(buildGhostNodes) id만 보면 테이블과 구별되지
    // 않는다 — 반드시 type으로 걸러야 한다.
    fireBoxSelection([
      rfNode('t2', 'table'),
      rfNode('t1', 'ghost'),
      rfNode('group:g1', 'group'),
      rfNode('n1', 'note'),
    ])

    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
  })

  it('박스 선택이 같은 집합을 실어와도 store를 다시 쓰지 않는다', () => {
    // 집합이 같은데도 selectTables를 부르면 selectTables가 CLEARED_SELECTION을 거치므로
    // 컬럼 선택이 조용히 지워진다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    fireEvent.click(screen.getByText('MBR_NO').closest('li')!)
    expect(useEditorStore.getState().selectedColumnIds).toEqual(['c2'])

    fireBoxSelection([rfNode('t2', 'table')])

    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().selectedColumnIds).toEqual(['c2'])
  })

  it('선택 상자 밖에서 온 React Flow 선택 통지는 무시한다', () => {
    /*
     * React Flow는 노드를 클릭하면 자기 nodeLookup의 selected를 **직접 변형한 뒤** 통지한다
     * (handleNodeClick → getSelectionChanges(..., mutateItem=true)). 그 통지를 그대로 받으면
     * store(우리 판단)와 React Flow(자기 판단)가 한 커밋씩 어긋난 값을 서로에게 되먹여
     * 무한 루프가 난다 — 실제로 "Maximum update depth exceeded"가 났다.
     * 그래서 통지는 **선택 상자 제스처 구간**에서만 받는다. 그 밖의 통지는 무시하고,
     * 미러링이 React Flow를 store에 맞춰 되돌린다.
     */
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    fireEvent.click(screen.getByTestId('rf__node-t1'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])

    // 상자 제스처(onSelectionStart) 없이 들어온 통지 — 받으면 안 된다.
    fireSelectionChange([rfNode('t1', 'table'), rfNode('t2', 'table')])
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])

    // 상자 제스처 안에서는 받는다 — 게이트가 열리지 않으면 박스 선택이 통째로 먹통이 된다.
    fireBoxSelection([rfNode('t1', 'table'), rfNode('t2', 'table')])
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1', 't2'])
  })
})
