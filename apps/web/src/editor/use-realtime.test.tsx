import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { Op, ProjectModel, ServerMessage } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { selectionImpact, useRealtime, wsUrl } from './use-realtime.js'

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

beforeEach(() => {
  FakeSocket.instances = []
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
  const none = { tableId: null, relationshipId: null, noteId: null }

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
    expect(selectionImpact(m, [op], { ...none, tableId: NOTE_A })).toBe('changed')
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
    expect(selectionImpact(m, [op], { ...none, tableId: NOTE_A })).toBeNull()
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
      peers: [{ userId: 'u2', name: '동료', selection: null }],
    })
    await waitFor(() => expect(useEditorStore.getState().peers).toHaveLength(1))
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('presence 메시지는 참여자 목록만 갱신한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'presence',
      peers: [{ userId: 'u2', name: '동료', selection: { kind: 'note', id: NOTE_A } }],
    })
    await waitFor(() => {
      expect(useEditorStore.getState().peers[0]?.selection).toEqual({ kind: 'note', id: NOTE_A })
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
      type: 'selection', selection: { kind: 'note', id: NOTE_A },
    })
  })

  it('스로틀 창 안의 연속 변경은 마지막 값 1건으로 합쳐진다', async () => {
    renderHook()
    const s = await socket()
    useEditorStore.getState().select(NOTE_A)
    useEditorStore.getState().selectNote(NOTE_A)
    useEditorStore.getState().select(null)
    await waitFor(() => expect(s.sent).toHaveLength(1))
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: 'selection', selection: null })
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
      type: 'selection', selection: { kind: 'note', id: NOTE_A },
    })
  })
})
