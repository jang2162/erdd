import { describe, expect, it } from 'vitest'
import type { Op } from './op.js'
import {
  MAX_PEER_SELECTIONS, PEER_PALETTE, parseClientMessage, parseServerMessage, peerColor,
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

  it('presence 메시지를 왕복한다(빈 selections 포함)', () => {
    const msg: ServerMessage = {
      type: 'presence',
      peers: [
        { userId: 'u1', name: '오너', selections: [{ kind: 'table', id: 't1' }] },
        { userId: 'u2', name: '동료', selections: [] },
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

  it('peer의 selections 원소 kind가 목록 밖이면 null', () => {
    const bad = { type: 'presence', peers: [{ userId: 'u', name: 'n', selections: [{ kind: 'column', id: 'c' }] }] }
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull()
  })
})

describe('parseClientMessage', () => {
  it('selections를 왕복한다', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selections: [{ kind: 'note', id: 'n1' }] })))
      .toEqual({ type: 'selection', selections: [{ kind: 'note', id: 'n1' }] })
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selections: [] })))
      .toEqual({ type: 'selection', selections: [] })
  })

  it('알 수 없는 type이나 형식 오류는 null', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ops' }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: 'selection', selections: [{ kind: 'table' }] }))).toBeNull()
  })
})

describe('parseSelections (다중 선택)', () => {
  it('빈 배열은 유효하다 — 선택 없음을 뜻한다', () => {
    const raw = JSON.stringify({ type: 'selection', selections: [] })
    expect(parseClientMessage(raw)).toEqual({ type: 'selection', selections: [] })
  })

  it('selections 필드가 아예 없으면 형식 오류다(빈 배열과 구분한다)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'selection' }))).toBeNull()
  })

  it('여러 건을 순서 그대로 왕복한다', () => {
    const msg = {
      type: 'selection' as const,
      selections: [
        { kind: 'table' as const, id: 't1' },
        { kind: 'table' as const, id: 't2' },
        { kind: 'note' as const, id: 'n1' },
      ],
    }
    expect(parseClientMessage(JSON.stringify(msg))).toEqual(msg)
  })

  it('원소 하나라도 형식이 틀리면 전체를 거절한다', () => {
    const bad = { type: 'selection', selections: [{ kind: 'table', id: 't1' }, { kind: 'nope', id: 'x' }] }
    expect(parseClientMessage(JSON.stringify(bad))).toBeNull()
  })

  it('MAX_PEER_SELECTIONS를 넘으면 앞에서부터 잘라낸다(거절이 아니다)', () => {
    const many = Array.from({ length: MAX_PEER_SELECTIONS + 5 }, (_, i) => ({ kind: 'table' as const, id: `t${i}` }))
    const parsed = parseClientMessage(JSON.stringify({ type: 'selection', selections: many }))
    expect(parsed?.selections).toHaveLength(MAX_PEER_SELECTIONS)
    expect(parsed?.selections.at(-1)).toEqual({ kind: 'table', id: `t${MAX_PEER_SELECTIONS - 1}` })
  })

  it('presence의 peer도 selections 배열을 왕복한다', () => {
    const msg: ServerMessage = {
      type: 'presence',
      peers: [
        { userId: 'u1', name: '오너', selections: [{ kind: 'table', id: 't1' }, { kind: 'table', id: 't2' }] },
        { userId: 'u2', name: '동료', selections: [] },
      ],
    }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg)
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
