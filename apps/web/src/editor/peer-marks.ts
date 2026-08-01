import { peerColor, type Peer } from '@erdd/core'

export type PeerMark = { userId: string; name: string; color: string }
/** key = 선택된 엔티티 id(테이블·관계·메모·그룹). */
export type PeerMarks = Map<string, PeerMark[]>

/** 참여자 목록을 캔버스가 바로 쓸 수 있는 엔티티별 표시 마크로 뒤집는다. */
export function buildPeerMarks(peers: readonly Peer[], selfUserId: string): PeerMarks {
  const marks: PeerMarks = new Map()
  for (const p of peers) {
    if (p.userId === selfUserId || p.selection === null) continue
    const list = marks.get(p.selection.id)
    const mark: PeerMark = { userId: p.userId, name: p.name, color: peerColor(p.userId) }
    if (list) list.push(mark)
    else marks.set(p.selection.id, [mark])
  }
  return marks
}
