import { describe, expect, it } from 'vitest'
import type { Peer } from '@erdd/core'
import { peerColor } from '@erdd/core'
import { buildPeerMarks } from './peer-marks.js'

const peers: Peer[] = [
  { userId: 'me', name: '나', selection: { kind: 'table', id: 't1' } },
  { userId: 'u2', name: '둘', selection: { kind: 'table', id: 't1' } },
  { userId: 'u3', name: '셋', selection: { kind: 'note', id: 'n1' } },
  { userId: 'u4', name: '넷', selection: null },
]

describe('buildPeerMarks', () => {
  it('내 선택은 제외하고 엔티티별로 모은다', () => {
    const marks = buildPeerMarks(peers, 'me')
    expect(marks.get('t1')).toEqual([{ userId: 'u2', name: '둘', color: peerColor('u2') }])
    expect(marks.get('n1')).toEqual([{ userId: 'u3', name: '셋', color: peerColor('u3') }])
  })

  it('같은 대상을 여러 명이 보면 모두 담긴다', () => {
    const marks = buildPeerMarks(peers, 'nobody')
    expect(marks.get('t1')?.map((m) => m.userId)).toEqual(['me', 'u2'])
  })

  it('선택이 없는 참여자는 어떤 키도 만들지 않는다', () => {
    const marks = buildPeerMarks(peers, 'me')
    expect([...marks.keys()].sort()).toEqual(['n1', 't1'])
  })
})
