import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { serializeColumns, serializeTables } from './clipboard.js'
import { useEditorShortcuts } from './use-shortcuts.js'
import { BulkDeleteDialog } from './bulk-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

/**
 * 다이얼로그는 **실제 컴포넌트**(`@/components/ui/dialog`, Radix 기반)를 쓴다. `role="dialog"`를
 * 손으로 붙인 가짜 div로 시험하면 "실제 다이얼로그가 그 표식을 내는가"가 검증되지 않는다.
 * `<pre>`는 ExportDialog의 DDL 미리보기를 흉내낸 것이다 — 그 텍스트를 골라 Cmd+C 하는 것이
 * 이 가드가 지키려는 시나리오다.
 */
function Harness({ withDialog = false }: { withDialog?: boolean }) {
  // Canvas와 같은 구성이다 — 훅은 확인 대상만 돌려주고 다이얼로그는 호출부가 그린다.
  // 여기서 그리지 않으면 다중 삭제의 확인 경로가 테스트에서만 사라져 계약이 헐거워진다.
  const del = useEditorShortcuts({ projectId: PROJECT_ID })
  return (
    <>
      <BulkDeleteDialog
        projectId={PROJECT_ID}
        ids={del.confirmingIds}
        open={del.confirmingIds.length > 0}
        onOpenChange={(v) => { if (!v) del.closeConfirm() }}
      />
      <input aria-label="텍스트" />
      {withDialog && (
        <Dialog>
          <DialogTrigger>내보내기</DialogTrigger>
          <DialogContent>
            <DialogTitle>내보내기 설정</DialogTitle>
            <pre>CREATE TABLE MBR (...)</pre>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// 실제 렌더에는 trpc provider가 필요하다 — edit-panel.test.tsx의 renderPanel과 같은 wrapper다.
// useModelMutation → useTRPC가 컨텍스트를 요구하므로 wrapper 없이 렌더하면 훅이 던진다.
function renderHarness(props: { withDialog?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  return render(<Harness {...props} />, { wrapper: w })
}

/** 다이얼로그를 실제로 열고, 열렸음을 DOM 표식으로 확인한다. */
function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
}

/**
 * `model.mutate` **프로시저 호출 수**를 센다. fetch 호출 수가 아니다 — httpBatchLink는 같은 틱의
 * 호출을 `/trpc/model.mutate,model.mutate` 한 요청으로 묶을 수 있어서, fetch를 세면 mutation
 * 2건이 1건으로 보인다. mockTrpcFetch가 경로를 쪼개는 방식(`pathname` → `split(',')`)과 똑같이
 * 쪼개서 `model.mutate`만 센다.
 */
function countModelMutate(fetchMock: { mock: { calls: unknown[][] } }): number {
  return fetchMock.mock.calls.reduce((n, call) => {
    const path = new URL(String(call[0]), 'http://localhost').pathname.replace(/^\/trpc\//, '')
    return n + path.split(',').filter((p) => p === 'model.mutate').length
  }, 0)
}

/**
 * seq를 매번 올리는 model.mutate 목. 실제 서버는 revision마다 seq를 1씩 올린다.
 * 고정 seq를 쓰면 두 번째 mutation이 `seq !== seqBefore + 1` 분기(남의 revision이 끼어든 경우)로
 * 새어 resync를 타므로, "단일 mutation인가"를 undoStack으로 재는 단언이 무력해진다.
 */
function mockModelMutate() {
  let seq = 1
  return mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: ++seq } }) })
}

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset()
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  useEditorStore.getState().reset()
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('useEditorShortcuts', () => {
  it('테이블을 선택하고 Cmd+C를 누르면 클립보드에 tables 페이로드가 쓰인다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.__erdd).toBe(1)
    expect(payload.kind).toBe('tables')
  })

  it('컬럼이 선택돼 있으면 columns 페이로드가 쓰인다', async () => {
    useEditorStore.getState().selectColumn('t2', 'c2', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('columns')
    expect(payload.columns).toHaveLength(1)
  })

  // ⚠️ 이 가드가 회귀하면 텍스트를 치는 중 Delete가 테이블을 지운다. 유일한 방어선이다.
  it('입력란에 포커스가 있으면 아무 동작도 하지 않는다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    const input = document.querySelector('input')!
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).not.toHaveBeenCalled()
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  // ⚠️ 붙여넣기 쪽 가드. 입력란에 붙여넣은 텍스트가 모델 변경으로 새면 안 된다.
  it('입력란에 포커스가 있으면 붙여넣기가 모델을 바꾸지 않는다', async () => {
    const payload = serializeColumns(buildSampleModel(), ['c2'])
    useEditorStore.getState().select('t1')
    renderHarness()
    const input = document.querySelector('input')!
    input.focus()
    const before = Object.keys(useEditorStore.getState().model.columns).length
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => JSON.stringify(payload) } })
    input.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(before)
    expect(e.defaultPrevented).toBe(false)
  })

  it('Delete는 선택된 테이블을 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']).toBeUndefined())
  })

  it('컬럼이 선택돼 있으면 Delete가 컬럼만 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.columns['c3']).toBeUndefined())
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  // ⚠️ 컬럼을 지운 뒤 선택 잔재가 남으면 모델에 없는 컬럼 id가 selectedColumnIds에 남고,
  // 이어지는 Cmd+C가 `{"kind":"columns","columns":[]}` 빈 페이로드로 **시스템 클립보드를 덮는다**.
  // 사용자는 테이블을 복사한 줄 안다. 컬럼 선택만 비우고 보던 테이블 선택은 유지해야 한다.
  it('컬럼을 Delete하면 컬럼 선택만 비우고 테이블 선택은 유지한다', async () => {
    mockModelMutate()
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.columns['c3']).toBeUndefined())

    expect(useEditorStore.getState().selectedColumnIds).toEqual([])
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])

    // 잔재가 남았는지를 사용자가 실제로 겪는 결과로 확인한다 — 다음 Cmd+C가 무엇을 쓰는가.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('tables')
    expect(payload.tables).toHaveLength(1)
  })

  it('paste 이벤트로 컬럼을 붙여넣는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const payload = serializeColumns(buildSampleModel(), ['c2'])
    useEditorStore.getState().select('t1')
    renderHarness()
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', {
      value: { getData: () => JSON.stringify(payload) },
    })
    document.dispatchEvent(e)
    await waitFor(() => {
      const cols = Object.values(useEditorStore.getState().model.columns).filter((c) => c.tableId === 't1')
      expect(cols).toHaveLength(2)
    })
  })

  it('__erdd가 아닌 텍스트를 붙여넣으면 아무 일도 없다', async () => {
    useEditorStore.getState().select('t1')
    renderHarness()
    const before = Object.keys(useEditorStore.getState().model.columns).length
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '그냥 텍스트' } })
    document.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(before)
    // 남의 텍스트는 브라우저 기본 동작에 그대로 넘긴다 — preventDefault를 부르지 않는다.
    // (모델이 안 바뀐 것만 보면 `if (!payload) return`을 지워도 단언은 통과한다. 그때 나는
    //  것은 null 역참조 예외뿐이라 "테스트 실패"가 아니라 "unhandled error"로 새므로,
    //  이 단언이 그 계약을 단언 수준에서 붙잡는다.)
    expect(e.defaultPrevented).toBe(false)
  })

  // ⚠️ 설계 §3.7 (b): 다이얼로그가 열려 있으면 단축키는 전부 브라우저 기본 동작에 넘긴다.
  // project.tsx는 Canvas와 다이얼로그 8개를 상시 마운트하고 Radix Dialog는 임의 keydown을
  // 막지 않으므로, 이 가드가 없으면 아래 두 사고가 실제로 난다.
  it('다이얼로그가 열려 있으면 Cmd+C가 클립보드를 건드리지 않는다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness({ withDialog: true })
    openDialog()
    // 다이얼로그 안의 DDL 미리보기 텍스트를 골라 Cmd+C 하는 상황. 훅이 가로채면
    // 사용자가 복사하려던 DDL 대신 ERDD JSON이 클립보드에 덮인다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('다이얼로그가 열려 있으면 Delete가 선택된 테이블을 지우지 않는다', async () => {
    mockModelMutate()
    useEditorStore.getState().select('t2')
    renderHarness({ withDialog: true })
    openDialog()
    // 포커스가 입력란이 아니라 DialogContent·닫기 버튼에 있을 때다 — isTypingTarget으로는
    // 걸러지지 않으므로 다이얼로그 가드만이 모달 뒤의 테이블을 지킨다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  /*
   * 다중 삭제는 진입점이 몇 개든 확인을 거친다(사이드바 설계 §7) — 단축키도 예외가 아니다.
   * 실시간으로 남의 화면에도 즉시 반영되는 파괴적 동작이고, 잘못 선택한 채 누르는 것이 다중
   * 선택에서 훨씬 쉽다. 확인 뒤에는 §3.6대로 **Revision 1건 · undo 1회**여야 한다.
   */
  it('테이블 2개를 선택하고 Delete하면 바로 지우지 않고 확인을 요구한다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText(/테이블 2개와 관계 1개가 삭제됩니다/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t1']).toBeDefined()
  })

  it('확인하면 mutation 1건으로 둘 다 지워진다', async () => {
    const fetchMock = mockModelMutate()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']).toBeUndefined()
      expect(useEditorStore.getState().model.tables['t2']).toBeUndefined()
    })
    expect(countModelMutate(fetchMock)).toBe(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  /*
   * 단축키로 연 다이얼로그는 **키보드만으로** 빠져나갈 수 있어야 한다. 마우스를 쓰지 않고 Delete를
   * 누른 사용자가 확인 창에 갇히면 그 자체가 접근성 결함이다. Esc는 Radix Dialog가 처리하고,
   * 확인은 Tab으로 버튼에 닿아 Enter/Space로 누른다(파괴적 동작이라 삭제 버튼에 autoFocus를
   * 주지 않는다 — Delete 연타가 곧바로 삭제로 이어지면 확인 다이얼로그를 둔 뜻이 없어진다).
   */
  it('Esc로 취소된다 — 아무것도 지워지지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t1']).toBeDefined()
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  it('키보드만으로 확인할 수 있다 — 삭제 버튼에 포커스가 닿고 Enter가 먹는다', async () => {
    const fetchMock = mockModelMutate()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' })
    confirm.focus()
    expect(confirm).toHaveFocus()
    // 네이티브 <button>은 포커스된 상태의 Enter를 click으로 바꾼다(jsdom은 그 변환을 하지 않아
    // keyboard 이벤트만으로는 눌리지 않으므로, 포커스 가능성까지 확인한 뒤 click으로 잇는다).
    fireEvent.click(confirm)

    await waitFor(() => expect(useEditorStore.getState().model.tables['t1']).toBeUndefined())
    expect(countModelMutate(fetchMock)).toBe(1)
  })

  it('테이블 2개를 선택하고 Cmd+X하면 둘 다 복사되고 mutation 1건으로 지워진다', async () => {
    const fetchMock = mockModelMutate()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('tables')
    expect(payload.tables).toHaveLength(2)
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']).toBeUndefined()
      expect(useEditorStore.getState().model.tables['t2']).toBeUndefined()
    })
    expect(countModelMutate(fetchMock)).toBe(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('paste 이벤트로 테이블을 붙여넣으면 원본에서 밀린 위치에 놓이고 새 테이블이 선택된다', async () => {
    mockModelMutate()
    const payload = serializeTables(buildSampleModel(), ['t2'])   // t2.position = { x: 300, y: 0 }
    useEditorStore.getState().select(null)
    renderHarness()
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => JSON.stringify(payload) } })
    document.dispatchEvent(e)
    await waitFor(() => {
      expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(3)
    })
    const selected = useEditorStore.getState().selectedTableIds
    expect(selected).toHaveLength(1)
    const pasted = useEditorStore.getState().model.tables[selected[0]!]
    expect(pasted).toBeDefined()
    // PASTE_OFFSET만큼 밀린다 — 원본 위에 정확히 겹치면 붙여넣은 줄도 모른다.
    expect(pasted!.position).toEqual({ x: 340, y: 40 })
    expect(pasted!.id).not.toBe('t2')
  })

  // ⚠️ 네 갈래를 **전부** 눌러 본다. Cmd+X는 mutate보다 **먼저** writeText를 부르므로
  // useSubmit의 canEdit 가드(두 번째 방어선)로는 막히지 않는 유일한 부작용이다 —
  // 훅 자신의 가드가 빠지면 읽기 전용 사용자의 시스템 클립보드가 덮인다.
  it('읽기 전용이면 X·V·Delete가 무시되고 C만 동작한다', async () => {
    mockModelMutate()
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().select('t2')
    renderHarness()
    const columnsBefore = Object.keys(useEditorStore.getState().model.columns).length

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).not.toHaveBeenCalled()          // ← X의 유일한 방어선
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()

    const pasted = serializeColumns(buildSampleModel(), ['c2'])
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => JSON.stringify(pasted) } })
    document.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(columnsBefore)

    // C만 동작한다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })
})
