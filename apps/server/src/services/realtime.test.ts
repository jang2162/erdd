import { describe, expect, it } from 'vitest'
import type { Op, ServerMessage } from '@erdd/core'
import { RealtimeHub } from './realtime.js'

const UID = '018f6b0e-0000-7000-8000-0000000000c1'
const NOTE_OP: Op = {
  action: 'create', entity: 'note', entityId: UID,
  data: { id: UID, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
}

/** 수신 프레임을 모으는 가짜 연결. */
function conn(userId: string, name: string) {
  const received: ServerMessage[] = []
  return {
    received,
    hub: { userId, name, send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) } },
  }
}
const opsMessages = (received: ServerMessage[]) => received.filter((m) => m.type === 'ops')
const lastPresence = (received: ServerMessage[]) =>
  [...received].reverse().find((m) => m.type === 'presence')

describe('RealtimeHub', () => {
  it('같은 프로젝트 구독자에게만 op를 전파한다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const b = conn('u2', '을')
    hub.subscribe('p1', a.hub)
    hub.subscribe('p2', b.hub)

    hub.publishOps('p1', { seq: 3, ops: [NOTE_OP], actorUserId: 'u9', actorName: '작성자' })

    expect(opsMessages(a.received)).toEqual([
      { type: 'ops', seq: 3, ops: [NOTE_OP], actorUserId: 'u9', actorName: '작성자' },
    ])
    expect(opsMessages(b.received)).toEqual([])
  })

  it('close한 연결은 더 이상 받지 않고 채널이 비면 정리된다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const handle = hub.subscribe('p1', a.hub)
    expect(hub.connectionCount('p1')).toBe(1)

    handle.close()
    expect(hub.connectionCount('p1')).toBe(0)
    hub.publishOps('p1', { seq: 1, ops: [NOTE_OP], actorUserId: 'u9', actorName: '작성자' })
    expect(opsMessages(a.received)).toEqual([])
  })

  it('같은 사용자의 소켓 2개는 peers에서 1건으로 합쳐지고 가장 최근 selections를 쓴다', () => {
    const hub = new RealtimeHub()
    const a1 = conn('u1', '갑')
    const a2 = conn('u1', '갑')
    const h1 = hub.subscribe('p1', a1.hub)
    const h2 = hub.subscribe('p1', a2.hub)

    h1.setSelections([{ kind: 'table', id: 't1' }])
    h2.setSelections([{ kind: 'note', id: 'n1' }])

    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selections: [{ kind: 'note', id: 'n1' }] }])

    h1.setSelections([{ kind: 'table', id: 't2' }])
    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selections: [{ kind: 'table', id: 't2' }] }])
  })

  it('peers 순서는 참가 순서를 따른다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const b = conn('u2', '을')
    hub.subscribe('p1', a.hub)
    const hb = hub.subscribe('p1', b.hub)
    hb.setSelections([{ kind: 'table', id: 't1' }])   // 최근 활동은 을이지만 순서는 갑이 먼저
    expect(hub.peers('p1').map((p) => p.userId)).toEqual(['u1', 'u2'])
  })

  it('구독·선택·해제 때마다 presence를 전파한다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const ha = hub.subscribe('p1', a.hub)
    expect(lastPresence(a.received)?.peers).toEqual([{ userId: 'u1', name: '갑', selections: [] }])

    const b = conn('u2', '을')
    const hb = hub.subscribe('p1', b.hub)
    expect(lastPresence(a.received)?.peers.map((p) => p.userId)).toEqual(['u1', 'u2'])

    hb.setSelections([{ kind: 'table', id: 't1' }])
    expect(lastPresence(a.received)?.peers[1]?.selections).toEqual([{ kind: 'table', id: 't1' }])

    hb.close()
    expect(lastPresence(a.received)?.peers.map((p) => p.userId)).toEqual(['u1'])
  })

  it('한 소켓의 send가 던져도 나머지 구독자는 전부 받는다', () => {
    const hub = new RealtimeHub()
    const dead = { userId: 'u0', name: '끊김', send: () => { throw new Error('socket closed') } }
    const alive = conn('u1', '갑')
    hub.subscribe('p1', dead)
    hub.subscribe('p1', alive.hub)

    expect(() => hub.publishOps('p1', {
      seq: 1, ops: [NOTE_OP], actorUserId: 'u9', actorName: '작성자',
    })).not.toThrow()
    expect(opsMessages(alive.received)).toHaveLength(1)
  })

  it('구독자가 없는 프로젝트에 발행해도 던지지 않는다', () => {
    const hub = new RealtimeHub()
    expect(() => hub.publishOps('none', {
      seq: 1, ops: [NOTE_OP], actorUserId: 'u9', actorName: '작성자',
    })).not.toThrow()
    expect(hub.peers('none')).toEqual([])
  })

  it('여러 건을 고르면 그대로 N건이 전파된다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    hub.subscribe('p1', a.hub)
    const b = conn('u2', '을')
    const hb = hub.subscribe('p1', b.hub)

    hb.setSelections([{ kind: 'table', id: 't1' }, { kind: 'table', id: 't2' }, { kind: 'table', id: 't3' }])

    const peers = lastPresence(a.received)?.peers ?? []
    expect(peers.find((p) => p.userId === b.hub.userId)?.selections).toHaveLength(3)
  })
})
