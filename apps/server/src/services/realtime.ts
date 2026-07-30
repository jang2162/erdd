import type { Op, Peer, PeerSelection, ServerMessage } from '@erdd/core'

export type HubConnection = {
  userId: string
  name: string
  /** 프레임 1건 전송. 끊긴 소켓이면 던져도 된다 — 허브가 삼킨다. */
  send: (text: string) => void
}

export type HubHandle = {
  setSelection: (selection: PeerSelection | null) => void
  close: () => void
}

type Entry = {
  conn: HubConnection
  selection: PeerSelection | null
  /** 참가 순번 — peers 표시 순서(사용자별 최솟값). */
  joinRank: number
  /** 마지막 selection 갱신 순번 — 같은 사용자의 소켓 중 어느 selection을 쓸지 결정. */
  selRank: number
}

/**
 * 프로젝트별 실시간 채널. 인메모리 단일 인스턴스 전제다.
 * 소켓 구현을 모른다(send 함수만 안다) — 그래서 소켓 없이 단위 테스트할 수 있다.
 */
export class RealtimeHub {
  #channels = new Map<string, Set<Entry>>()
  #rank = 0

  subscribe(projectId: string, conn: HubConnection): HubHandle {
    this.#rank += 1
    const entry: Entry = { conn, selection: null, joinRank: this.#rank, selRank: this.#rank }
    let set = this.#channels.get(projectId)
    if (!set) {
      set = new Set<Entry>()
      this.#channels.set(projectId, set)
    }
    set.add(entry)
    this.#broadcastPresence(projectId)

    let closed = false
    return {
      setSelection: (selection) => {
        if (closed) return
        this.#rank += 1
        entry.selection = selection
        entry.selRank = this.#rank
        this.#broadcastPresence(projectId)
      },
      close: () => {
        if (closed) return
        closed = true
        const current = this.#channels.get(projectId)
        if (!current) return
        current.delete(entry)
        if (current.size === 0) this.#channels.delete(projectId)
        this.#broadcastPresence(projectId)
      },
    }
  }

  publishOps(
    projectId: string,
    payload: { seq: number; ops: Op[]; actorUserId: string; actorName: string },
  ): void {
    this.#send(projectId, { type: 'ops', ...payload })
  }

  /** 사용자 단위로 합친 참여자 목록. 표시 순서는 참가 순, selection은 가장 최근 갱신본. */
  peers(projectId: string): Peer[] {
    const set = this.#channels.get(projectId)
    if (!set) return []
    const byUser = new Map<string, { peer: Peer; joinRank: number; selRank: number }>()
    for (const entry of set) {
      const prev = byUser.get(entry.conn.userId)
      if (!prev) {
        byUser.set(entry.conn.userId, {
          peer: { userId: entry.conn.userId, name: entry.conn.name, selection: entry.selection },
          joinRank: entry.joinRank,
          selRank: entry.selRank,
        })
        continue
      }
      if (entry.selRank > prev.selRank) {
        prev.peer.selection = entry.selection
        prev.selRank = entry.selRank
      }
      if (entry.joinRank < prev.joinRank) prev.joinRank = entry.joinRank
    }
    return [...byUser.values()].sort((a, b) => a.joinRank - b.joinRank).map((v) => v.peer)
  }

  connectionCount(projectId: string): number {
    return this.#channels.get(projectId)?.size ?? 0
  }

  #broadcastPresence(projectId: string): void {
    this.#send(projectId, { type: 'presence', peers: this.peers(projectId) })
  }

  #send(projectId: string, msg: ServerMessage): void {
    const set = this.#channels.get(projectId)
    if (!set || set.size === 0) return
    const text = JSON.stringify(msg)
    for (const entry of set) {
      // 끊긴 소켓 하나가 나머지 구독자 전파를 막으면 안 된다.
      try { entry.conn.send(text) } catch { /* 무시 — 정리는 소켓 close 핸들러가 한다 */ }
    }
  }
}
