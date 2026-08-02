import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
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
 * React Flow 내장 키보드 선택(Enter)으로 노드를 선택한다. 마우스 클릭 대신 쓰는 이유: 클릭은
 * Canvas의 onNodeClick이 store 선택 상태(selectedTableId)를 바꾸고, 그 결과 `derived`가
 * 재계산되어 useEffect가 노드 배열을 다시 덮어써 React Flow 내부 선택 플래그(top-level
 * `node.selected`, 삭제 대상 판정에 쓰인다)를 지우는 별개의 렌더 경쟁이 있다 — 키보드 선택
 * 경로(NodeWrapper 자체의 onKeyDown)는 onNodeClick을 거치지 않아 그 경쟁을 피한다.
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
