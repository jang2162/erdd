import { describe, expect, it } from 'vitest'
import type { Op } from './op.js'
import {
  PEER_PALETTE, parseClientMessage, parseServerMessage, peerColor,
  type ServerMessage,
} from './realtime-protocol.js'

const UID = '018f6b0e-0000-7000-8000-0000000000c1'
const NOTE_OP: Op = {
  action: 'create', entity: 'note', entityId: UID,
  data: { id: UID, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
}

describe('parseServerMessage', () => {
  it('ops 메시지를 왕복한다', () => {
    const msg: ServerMessage = {
      type: 'ops', seq: 7, ops: [NOTE_OP],
      actorUserId: 'u1', actorName: '오너',
    }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg)
  })

  it('presence 메시지를 왕복한다(selection null 포함)', () => {
    const msg: ServerMessage = {
      type: 'presence',
      peers: [
        { userId: 'u1', name: '오너', selection: { kind: 'table', id: 't1' } },
        { userId: 'u2', name: '동료', selection: null },
      ],
    }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg)
  })

  it('ready 메시지를 왕복한다', () => {
    const msg: ServerMessage = { type: 'ready', seq: 0, peers: [] }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg)
  })

  it('op 하나라도 형식이 틀리면 null(전체 거절)', () => {
    const bad = { type: 'ops', seq: 1, actorUserId: 'u1', actorName: 'n', ops: [
      NOTE_OP, { action: 'create', entity: 'note', entityId: 'not-a-uuid', data: {} },
    ] }
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull()
  })

  it('JSON이 아니거나 알 수 없는 type이면 null', () => {
    expect(parseServerMessage('{{{')).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'hello' }))).toBeNull()
  })

  it('seq가 정수가 아니면 null', () => {
    const bad = { type: 'ops', seq: 1.5, ops: [NOTE_OP], actorUserId: 'u1', actorName: 'n' }
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull()
  })

  it('peer의 selection.kind가 목록 밖이면 null', () => {
    const bad = { type: 'presence', peers: [{ userId: 'u', name: 'n', selection: { kind: 'column', id: 'c' } }] }
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull()
  })
})

describe('parseClientMessage', () => {
  it('selection을 왕복한다', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selection: { kind: 'note', id: 'n1' } })))
      .toEqual({ type: 'selection', selection: { kind: 'note', id: 'n1' } })
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selection: null })))
      .toEqual({ type: 'selection', selection: null })
  })

  it('알 수 없는 type이나 형식 오류는 null', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ops' }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selection: { kind: 'table' } }))).toBeNull()
  })
})

describe('peerColor', () => {
  it('같은 userId면 항상 같은 색이고 팔레트 안의 값이다', () => {
    const a = peerColor('018f6b0e-0000-7000-8000-0000000000aa')
    expect(peerColor('018f6b0e-0000-7000-8000-0000000000aa')).toBe(a)
    expect(PEER_PALETTE).toContain(a)
  })

  it('빈 문자열도 팔레트 안의 색을 낸다', () => {
    expect(PEER_PALETTE).toContain(peerColor(''))
  })
})
