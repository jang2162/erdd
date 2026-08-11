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

  it('같은 kind·id 중복은 첫 등장만 남기고 순서를 보존한다', () => {
    const dup = {
      type: 'selection',
      selections: [
        { kind: 'table', id: 't1' }, { kind: 'note', id: 'n1' },
        { kind: 'table', id: 't1' }, { kind: 'table', id: 't1' },
      ],
    }
    expect(parseClientMessage(JSON.stringify(dup))?.selections)
      .toEqual([{ kind: 'table', id: 't1' }, { kind: 'note', id: 'n1' }])
  })

  it('id가 같아도 kind가 다르면 서로 다른 선택이다', () => {
    const msg = { type: 'selection', selections: [{ kind: 'table', id: 'x' }, { kind: 'group', id: 'x' }] }
    expect(parseClientMessage(JSON.stringify(msg))?.selections)
      .toEqual([{ kind: 'table', id: 'x' }, { kind: 'group', id: 'x' }])
  })

  it('중복 제거를 절단보다 먼저 한다 — 중복이 상한을 소진해 실제 선택을 잃지 않는다', () => {
    // 같은 id 40개 + 서로 다른 id 30개. 절단이 먼저면 앞 50개(중복 40 + 고유 10)만 남아
    // 고유 선택 20개가 사라진다. 중복 제거가 먼저여야 31개가 온전히 남는다.
    const flood = Array.from({ length: 40 }, () => ({ kind: 'table' as const, id: 'dup' }))
    const unique = Array.from({ length: 30 }, (_, i) => ({ kind: 'table' as const, id: `u${i}` }))
    const parsed = parseClientMessage(JSON.stringify({ type: 'selection', selections: [...flood, ...unique] }))
    expect(parsed?.selections).toHaveLength(31)
    expect(parsed?.selections.at(-1)).toEqual({ kind: 'table', id: 'u29' })
  })

  it('presence의 peer 선택도 중복이 제거된다 — 같은 참여자 마크가 여러 번 붙지 않는다', () => {
    const dup = {
      type: 'presence',
      peers: [{ userId: 'u9', name: '아홉', selections: [
        { kind: 'table', id: 't1' }, { kind: 'table', id: 't1' }, { kind: 'table', id: 't1' },
      ] }],
    }
    const parsed = parseServerMessage(JSON.stringify(dup))
    expect(parsed?.type === 'presence' ? parsed.peers[0]?.selections : undefined)
      .toEqual([{ kind: 'table', id: 't1' }])
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

  it('presence의 peer에 selections 필드가 없으면 프레임 전체를 거절한다', () => {
    // 옛 서버가 보내는 단건 `selection` 프레임이 "모두 선택 없음"으로 조용히 통과하면 안 된다.
    expect(parseServerMessage(JSON.stringify({ type: 'presence', peers: [{ userId: 'u1', name: '갑' }] }))).toBeNull()
    const legacy = { type: 'presence', peers: [{ userId: 'u1', name: '갑', selection: { kind: 'table', id: 't1' } }] }
    expect(parseServerMessage(JSON.stringify(legacy))).toBeNull()
  })

  it('ready의 peer에 selections 필드가 없어도 프레임 전체를 거절한다', () => {
    const bad = { type: 'ready', seq: 0, peers: [{ userId: 'u1', name: '갑' }] }
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull()
  })

  it('peer의 selections가 배열이 아니면 거절한다(presence·ready 양쪽)', () => {
    for (const selections of [{}, 'table', 3, null] as const) {
      const peers = [{ userId: 'u1', name: '갑', selections }]
      expect(parseServerMessage(JSON.stringify({ type: 'presence', peers }))).toBeNull()
      expect(parseServerMessage(JSON.stringify({ type: 'ready', seq: 0, peers }))).toBeNull()
    }
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
