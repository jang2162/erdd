import { describe, expect, it } from 'vitest'
import type { Peer } from '@erdd/core'
import { peerColor } from '@erdd/core'
import { buildPeerMarks } from './peer-marks.js'

const peers: Peer[] = [
  { userId: 'me', name: '나', selections: [{ kind: 'table', id: 't1' }] },
  { userId: 'u2', name: '둘', selections: [{ kind: 'table', id: 't1' }] },
  { userId: 'u3', name: '셋', selections: [{ kind: 'note', id: 'n1' }] },
  { userId: 'u4', name: '넷', selections: [] },
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

  it('한 참여자가 여러 개를 고르면 각 엔티티에 모두 마크가 붙는다', () => {
    const many: Peer[] = [
      { userId: 'u9', name: '아홉', selections: [{ kind: 'table', id: 't1' }, { kind: 'table', id: 't2' }] },
    ]
    const marks = buildPeerMarks(many, 'me')
    expect(marks.get('t1')?.map((m) => m.userId)).toEqual(['u9'])
    expect(marks.get('t2')?.map((m) => m.userId)).toEqual(['u9'])
  })
})
