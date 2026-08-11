import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { modelOverOpCap } from '@/testing/fixtures'
import { useEditorStore } from './store.js'
import { Toolbar } from './toolbar.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

// Toolbar는 이미지 좌표 변환을 위해 useReactFlow를 쓰므로 React Flow 컨텍스트가 필요하다.
function renderToolbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<Toolbar projectId={PROJECT_ID} />, { wrapper: w })
}

/**
 * `model.mutate` **프로시저 호출 수**를 센다. fetch 호출 수가 아니다 — httpBatchLink는 같은 틱의
 * 호출을 `/trpc/model.mutate,model.mutate` 한 요청으로 묶을 수 있어서, fetch를 세면 mutation
 * 2건이 1건으로 보인다. mockTrpcFetch가 경로를 쪼개는 방식(`pathname` → `split(',')`)과 똑같이
 * 쪼개서 `model.mutate`만 센다. (use-shortcuts.test.tsx의 같은 헬퍼와 짝이다.)
 */
function countModelMutate(fetchMock: { mock: { calls: unknown[][] } }): number {
  return fetchMock.mock.calls.reduce((n, call) => {
    const path = new URL(String(call[0]), 'http://localhost').pathname.replace(/^\/trpc\//, '')
    return n + path.split(',').filter((p) => p === 'model.mutate').length
  }, 0)
}

/**
 * seq를 매번 올리는 model.mutate 목. 고정 seq를 쓰면 두 번째 mutation이
 * `seq !== seqBefore + 1` 분기로 새어 resync를 타므로 "단일 mutation인가" 단언이 무력해진다.
 */
function mockModelMutate() {
  let seq = 1
  return mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: ++seq } }) })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('Toolbar', () => {
  it('그룹 뷰에서 "테이블 추가"로 만든 테이블을 활성 그룹에 배정한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: /테이블 추가/ }))

    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      const added = Object.values(tables).find((t) => t.id !== 't1' && t.id !== 't2')
      expect(added).toBeDefined()
      expect(added?.groupId).toBe('g1')
    })
  })

  it('그룹 뷰에서는 "메모" 버튼이 비활성화된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
    renderToolbar()

    expect(screen.getByRole('button', { name: /메모/ })).toBeDisabled()
  })

  it('전체 뷰에서는 "메모" 버튼이 활성화된다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.getByRole('button', { name: /메모/ })).toBeEnabled()
  })

  it('편집 권한이 없으면 편집 버튼 대신 읽기 전용 배지를 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderToolbar()

    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /테이블 추가/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /메모/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /자동 정렬/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '실행 취소' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 실행' })).toBeNull()
  })

  it('편집 권한이 있으면 읽기 전용 배지가 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.queryByText('읽기 전용')).toBeNull()
    expect(screen.getByRole('button', { name: /테이블 추가/ })).toBeInTheDocument()
  })

  it('다중 선택에서 삭제를 누르면 확인 다이얼로그가 뜬다 — 바로 지우지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.getByText(/테이블 2개와 관계 1개가 삭제됩니다/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('다중 선택에서 확인하면 주 선택 하나가 아니라 선택 전체가 mutation 1건으로 지워진다', async () => {
    // 화면에 2개가 하이라이트된 상태에서 툴바 버튼만 주 선택 하나를 지우면
    // 사용자가 무엇이 지워질지 예측할 수 없다(설계 7절). 단축키 Delete도 같은 다이얼로그를
    // 거쳐 선택 전체를 지우므로, 툴바가 [0] 하나만 지우면 같은 "삭제"가 두 가지로 동작한다.
    // 여러 대상을 지워도 **Revision 1건 · undo 1회**여야 한다(canvas-clipboard 설계 §3.6).
    // 루프로 mutate를 여러 번 부르면 같은 "삭제"가 실행 취소 여러 번이 된다.
    const fetchMock = mockModelMutate()
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => {
      expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(0)
    })
    expect(countModelMutate(fetchMock)).toBe(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('툴바 경로도 op 상한 가드를 지난다 — 상한을 넘으면 삭제를 막는다', async () => {
    // 툴바는 일괄 패널과 **같은 다이얼로그**를 쓰므로 가드가 함께 걸린다. 이 케이스가 없으면
    // 누군가 툴바에 다이얼로그를 복제하거나 가드를 트리거 쪽으로 옮겨도 아무 테스트도 실패하지
    // 않는다 — 가드를 공유 다이얼로그에 둔 판단 자체가 회귀로부터 보호되지 않는다.
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(modelOverOpCap(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/한 번에 지우기에 너무 많습니다/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '삭제' })).toBeDisabled()
    expect(calls).toHaveLength(0)
    expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(2)
  })

  it('단일 선택 삭제는 다이얼로그 없이 즉시 지우고 선택이 비워진다', async () => {
    // 선택 정리는 툴바가 아니라 useSubmit의 pruneSelection이 한다 — 모든 로컬 쓰기 경로가
    // 같은 규칙을 타야 하기 때문이다(툴바만 통째로 비우면 다중 선택에서 남은 것까지 풀린다).
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t2'])
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t2']).toBeUndefined()
    })
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('선택이 없으면 삭제 버튼이 비활성이다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
  })
})
