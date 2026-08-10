import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { Op, ProjectModel, ServerMessage } from '@erdd/core'
import { applyOps, createEmptyModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { selectionImpact, useRealtime, wsUrl } from './use-realtime.js'

const { toastInfo, toastError } = vi.hoisted(() => ({ toastInfo: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError, success: vi.fn() } }))

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'
const NOTE_A = '018f6b0e-0000-7000-8000-0000000000b1'
const NOTE_B = '018f6b0e-0000-7000-8000-0000000000b2'

function noteOp(id: string, content: string): Op {
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content, position: { x: 0, y: 0 }, color: '#fff' },
  }
}

/** 테스트가 프레임을 밀어넣을 수 있는 가짜 소켓. */
class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 1
  sent: string[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(text: string) { this.sent.push(text) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
  /** 서버가 프레임을 보낸 것처럼 만든다. */
  emit(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  /** 서버가 소켓을 특정 코드로 닫은 것처럼 만든다. */
  closeWith(code: number) { this.readyState = 3; this.onclose?.({ code }) }
}

function Probe({ projectId }: { projectId: string }) {
  useRealtime(projectId)
  return null
}

function renderHook(projectId = PROJECT_ID) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  return render(<Probe projectId={projectId} />, { wrapper: w })
}

/** 소켓이 열릴 때까지 기다린 뒤 마지막 인스턴스를 준다. */
async function socket(): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0))
  return FakeSocket.instances.at(-1)!
}

const modelWith = (...ids: string[]): ProjectModel => {
  const m = createEmptyModel()
  for (const id of ids) m.notes[id] = { id, content: id, position: { x: 0, y: 0 }, color: '#fff' }
  return m
}

/** 컬럼·그룹이 없는 테이블만 담은 모델. 테이블 delete op가 무결성 검사에 걸리지 않는다. */
const tablesModel = (...ids: string[]): ProjectModel => {
  const m = createEmptyModel()
  ids.forEach((id, i) => {
    m.tables[id] = {
      id, logicalName: id, physicalName: id.toUpperCase(), comment: null,
      groupId: null, position: { x: i * 300, y: 0 }, groupPosition: null, custom: {},
    }
  })
  return m
}

const deleteTableOp = (id: string): Op => ({ action: 'delete', entity: 'table', entityId: id, before: null })

beforeEach(() => {
  FakeSocket.instances = []
  toastInfo.mockClear()
  toastError.mockClear()
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('wsUrl', () => {
  it('http는 ws로, https는 wss로 바꾸고 projectId를 붙인다', () => {
    expect(wsUrl('p1', 'http://localhost:5173/p/p1')).toBe('ws://localhost:5173/ws?projectId=p1')
    expect(wsUrl('p1', 'https://erdd.example.com/p/p1')).toBe('wss://erdd.example.com/ws?projectId=p1')
  })
})

describe('selectionImpact', () => {
  const model = modelWith(NOTE_A)
  const none = { tableIds: [] as string[], relationshipId: null, noteId: null }

  it('선택이 없으면 null', () => {
    expect(selectionImpact(model, [noteOp(NOTE_B, 'x')], none)).toBeNull()
  })

  it('선택 대상이 수정되면 changed', () => {
    const op: Op = { action: 'update', entity: 'note', entityId: NOTE_A, changes: { content: { from: 'a', to: 'b' } } }
    expect(selectionImpact(model, [op], { ...none, noteId: NOTE_A })).toBe('changed')
  })

  it('선택 대상이 삭제되면 deleted가 changed를 이긴다', () => {
    const update: Op = { action: 'update', entity: 'note', entityId: NOTE_A, changes: { content: { from: 'a', to: 'b' } } }
    const del: Op = { action: 'delete', entity: 'note', entityId: NOTE_A, before: null }
    expect(selectionImpact(model, [update, del], { ...none, noteId: NOTE_A })).toBe('deleted')
  })

  it('선택한 테이블의 컬럼이 바뀌어도 changed', () => {
    const m = createEmptyModel()
    m.tables[NOTE_A] = {
      id: NOTE_A, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns[NOTE_B] = {
      id: NOTE_B, tableId: NOTE_A, logicalName: '이름', physicalName: 'NM',
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const op: Op = {
      action: 'update', entity: 'column', entityId: NOTE_B,
      changes: { logicalName: { from: '이름', to: '성명' } },
    }
    expect(selectionImpact(m, [op], { ...none, tableIds: [NOTE_A] })).toBe('changed')
  })

  it('다른 테이블의 컬럼이 바뀌면 null(오탐 방지)', () => {
    const m = createEmptyModel()
    m.columns[NOTE_B] = {
      id: NOTE_B, tableId: '018f6b0e-0000-7000-8000-0000000000ff',
      logicalName: '이름', physicalName: 'NM',
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const op: Op = {
      action: 'update', entity: 'column', entityId: NOTE_B,
      changes: { logicalName: { from: '이름', to: '성명' } },
    }
    expect(selectionImpact(m, [op], { ...none, tableIds: [NOTE_A] })).toBeNull()
  })

  it('선택이 여러 건이면 그중 하나만 걸려도 changed다', () => {
    const m = buildSampleModel()
    const op: Op = {
      action: 'update', entity: 'table', entityId: 't2',
      changes: { logicalName: { from: '회원', to: 'X' } },
    }
    expect(selectionImpact(m, [op], { ...none, tableIds: ['t1', 't2'] })).toBe('changed')
  })

  it('선택이 여러 건이어도 삭제가 수정을 이긴다', () => {
    const m = buildSampleModel()
    const upd: Op = {
      action: 'update', entity: 'table', entityId: 't1',
      changes: { logicalName: { from: '회원등급', to: 'X' } },
    }
    const del: Op = { action: 'delete', entity: 'table', entityId: 't2', before: null }
    expect(selectionImpact(m, [upd, del], { ...none, tableIds: ['t1', 't2'] })).toBe('deleted')
  })
})

describe('useRealtime 수신 적용', () => {
  beforeEach(() => {
    useEditorStore.getState().setLoaded(modelWith(NOTE_A), 5, PROJECT_ID)
    mockTrpcFetch({ 'model.get': () => ({ data: { model: modelWith(NOTE_A, NOTE_B), seq: 42 } }) })
  })

  it('seq가 연속이면 op를 로컬에 적용한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6, ops: [noteOp(NOTE_B, '남의 메모')],
      actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBe(6)
      expect(useEditorStore.getState().model.notes[NOTE_B]?.content).toBe('남의 메모')
    })
  })

  it('과거 seq(내 변경의 에코)는 무시한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 5, ops: [noteOp(NOTE_B, '에코')], actorUserId: 'u1', actorName: '나',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(useEditorStore.getState().seq).toBe(5)
    expect(useEditorStore.getState().model.notes[NOTE_B]).toBeUndefined()
  })

  it('seq에 간극이 있으면 model.get으로 통째 리로드하되 그룹 뷰는 유지한다', async () => {
    useEditorStore.getState().enterGroupView('g1')
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 9, ops: [noteOp(NOTE_B, '건너뜀')], actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(42))
    expect(useEditorStore.getState().model.notes[NOTE_B]).toBeDefined()
    // resync는 setLoaded와 달리 그룹 뷰를 날리지 않는다 — 남이 편집할 때마다 튕기면 못 쓴다.
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
  })

  it('ready의 seq가 내 seq와 다르면 리로드한다', async () => {
    renderHook()
    ;(await socket()).emit({ type: 'ready', seq: 11, peers: [] })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(42))
  })

  it('ready의 seq가 같으면 리로드하지 않고 peers만 반영한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ready', seq: 5,
      peers: [{ userId: 'u2', name: '동료', selections: [] }],
    })
    await waitFor(() => expect(useEditorStore.getState().peers).toHaveLength(1))
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('presence 메시지는 참여자 목록만 갱신한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'presence',
      peers: [{ userId: 'u2', name: '동료', selections: [{ kind: 'note', id: NOTE_A }] }],
    })
    await waitFor(() => {
      expect(useEditorStore.getState().peers[0]?.selections).toEqual([{ kind: 'note', id: NOTE_A }])
    })
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('인증 실패(4401)로 닫히면 재접속하지 않는다', async () => {
    renderHook()
    ;(await socket()).closeWith(4401)
    await new Promise((r) => setTimeout(r, 1200))
    expect(FakeSocket.instances).toHaveLength(1)
  })
})

describe('useRealtime 권한 무관 수신', () => {
  it('편집 권한이 없어도 수신 op는 그대로 적용된다', async () => {
    // Viewer도 실시간 수신·presence는 정상 동작해야 한다(Phase 3 실시간 설계 확정 사항).
    // 안전망 가드를 serializeMutation이나 이 훅에 넣으면 이 테스트가 실패한다.
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    // canEdit은 기본값 false 그대로 둔다.
    renderHook()
    const s = FakeSocket.instances[0]!
    s.onopen?.()
    s.emit({ type: 'ready', seq: 1, peers: [] })
    s.emit({
      type: 'ops', seq: 2, ops: [noteOp(NOTE_A, '남의 메모')],
      actorUserId: 'u-other', actorName: '남',
    })
    await waitFor(() => {
      expect(useEditorStore.getState().model.notes[NOTE_A]?.content).toBe('남의 메모')
    })
  })
})

describe('useRealtime 삭제 수신과 선택 정리', () => {
  // ⚠️ op의 entityId는 UUID여야 한다(core `op-guard`의 UUID_RE). 't1' 같은 짧은 id를 쓰면
  // parseServerMessage가 프레임을 통째로 버려 아무 일도 일어나지 않는다(조용히 통과하는 함정).
  const [TA, TB, TC] = [
    '018f6b0e-0000-7000-8000-0000000000c1',
    '018f6b0e-0000-7000-8000-0000000000c2',
    '018f6b0e-0000-7000-8000-0000000000c3',
  ]
  const THREE = [TA, TB, TC]
  /**
   * 이 describe의 "사건" — TB 삭제 1건. op 경로와 resync 경로가 **같은 사건**을 말한다는 것을
   * 주석이 아니라 코드로 강제한다: 서버 픽스처를 이 배치에서 유도하므로 대상을 TA로 바꾸면
   * 두 테스트가 함께 실패한다. 손으로 `tablesModel(TA, TC)`를 적어 두면 op 경로만 실패하고
   * resync는 그대로 통과해, 짝이 조용히 다른 사건을 말하게 된다.
   */
  const DELETE_BATCH: Op[] = [deleteTableOp(TB)]

  beforeEach(() => {
    useEditorStore.getState().setLoaded(tablesModel(...THREE), 5, PROJECT_ID)
    // seq 간극으로 리로드가 걸리면 그 사건이 적용된 서버 상태를 준다.
    mockTrpcFetch({
      'model.get': () => ({
        data: { model: applyOps(tablesModel(...THREE), DELETE_BATCH), seq: 42 },
      }),
    })
  })

  it('op 배치로 선택 중 하나만 삭제되면 나머지 선택은 유지된다', async () => {
    useEditorStore.getState().selectTables(THREE)
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6, ops: DELETE_BATCH, actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(6))
    expect(useEditorStore.getState().selectedTableIds).toEqual([TA, TC])
  })

  it('같은 삭제를 seq 간극(resync)으로 받아도 결과가 같다', async () => {
    // 도착 경로가 달라도 선택 상태는 같아야 한다. 이 둘이 갈리면 사용자에게는
    // "같은 일을 했는데 결과가 다르다"로 보인다.
    useEditorStore.getState().selectTables(THREE)
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 9, ops: DELETE_BATCH, actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(42))
    expect(useEditorStore.getState().selectedTableIds).toEqual([TA, TC])
  })

  it('선택이 전부 삭제되면 비워지고 기존 문구를 쓴다', async () => {
    useEditorStore.getState().selectTables([TB])
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6, ops: DELETE_BATCH, actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1))
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
    expect(toastInfo).toHaveBeenCalledWith('다른 사용자가 이 항목을 삭제했습니다')
  })

  it('일부만 삭제되면 남은 선택이 있다는 것을 문구로 알린다', async () => {
    // "이 항목을 삭제했습니다"는 선택이 통째로 사라졌다는 뜻으로 읽힌다 —
    // 3개 중 1개만 사라진 화면에서는 사실과 다르다.
    useEditorStore.getState().selectTables(THREE)
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6, ops: DELETE_BATCH, actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1))
    expect(toastInfo).toHaveBeenCalledWith('다른 사용자가 선택 항목 중 일부를 삭제했습니다')
  })

  it('선택 전체가 2건 이상이었으면 개수를 말한다', async () => {
    // 「이 항목을 삭제했습니다」는 하나가 사라졌다는 뜻으로 읽힌다. 일괄 삭제로 고른 3건이
    // 통째로 날아간 화면에서는 사실과 다르다.
    useEditorStore.getState().selectTables(THREE)
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6,
      ops: THREE.map(deleteTableOp),
      actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1))
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
    expect(toastInfo).toHaveBeenCalledWith('다른 사용자가 선택한 3개 항목을 삭제했습니다')
  })

  it('메모처럼 단건인 선택은 삭제되면 그대로 해제된다', async () => {
    useEditorStore.getState().setLoaded(modelWith(NOTE_A), 5, PROJECT_ID)
    useEditorStore.getState().selectNote(NOTE_A)
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6,
      ops: [{ action: 'delete', entity: 'note', entityId: NOTE_A, before: null }],
      actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(6))
    expect(useEditorStore.getState().selectedNoteId).toBeNull()
    expect(toastInfo).toHaveBeenCalledWith('다른 사용자가 이 항목을 삭제했습니다')
  })
})

describe('useRealtime selection 발신', () => {
  beforeEach(() => {
    useEditorStore.getState().setLoaded(modelWith(NOTE_A), 5, PROJECT_ID)
    mockTrpcFetch({ 'model.get': () => ({ data: { model: modelWith(NOTE_A), seq: 5 } }) })
  })

  it('로컬 선택이 바뀌면 selection 메시지를 보낸다', async () => {
    renderHook()
    const s = await socket()
    useEditorStore.getState().selectNote(NOTE_A)
    await waitFor(() => expect(s.sent).toHaveLength(1))
    expect(JSON.parse(s.sent[0]!)).toEqual({
      type: 'selection', selections: [{ kind: 'note', id: NOTE_A }],
    })
  })

  it('스로틀 창 안의 연속 변경은 마지막 값 1건으로 합쳐진다', async () => {
    renderHook()
    const s = await socket()
    useEditorStore.getState().select(NOTE_A)
    useEditorStore.getState().selectNote(NOTE_A)
    useEditorStore.getState().select(null)
    await waitFor(() => expect(s.sent).toHaveLength(1))
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: 'selection', selections: [] })
  })

  it('재접속하면 현재 선택 상태를 다시 보낸다', async () => {
    renderHook()
    useEditorStore.getState().selectNote(NOTE_A)
    const first = await socket()
    await waitFor(() => expect(first.sent.length).toBeGreaterThan(0))
    first.sent.length = 0 // 재접속 이후 프레임만 본다

    first.closeWith(1006) // 인증 실패가 아닌 임의 코드 — 재시도 대상
    await new Promise((r) => setTimeout(r, 1100)) // BACKOFF_MS[0]=1000 지나 재접속
    const second = await socket()
    expect(second).not.toBe(first)
    // FakeSocket은 실제 브라우저와 달리 open 이벤트를 자동 발화하지 않으므로 직접 트리거한다
    // (emit/closeWith와 같은 방식의 수동 트리거).
    second.onopen?.()
    await waitFor(() => expect(second.sent.length).toBeGreaterThan(0))
    expect(JSON.parse(second.sent[0]!)).toEqual({
      type: 'selection', selections: [{ kind: 'note', id: NOTE_A }],
    })
  })
})
