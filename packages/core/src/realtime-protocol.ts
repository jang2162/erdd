import { OpParseError, parseOps } from './op-guard.js'
import type { Op } from './op.js'

export type PeerSelectionKind = 'table' | 'relationship' | 'note' | 'group'
export const PEER_SELECTION_KINDS = ['table', 'relationship', 'note', 'group'] as const

export type PeerSelection = { kind: PeerSelectionKind; id: string }
export type Peer = { userId: string; name: string; selection: PeerSelection | null }

export type ServerMessage =
  | { type: 'ready'; seq: number; peers: Peer[] }
  | { type: 'ops'; seq: number; ops: Op[]; actorUserId: string; actorName: string }
  | { type: 'presence'; peers: Peer[] }

export type ClientMessage = { type: 'selection'; selection: PeerSelection | null }

/** 소켓 인증 실패 close code. 4401=미인증, 4403=권한 없음. 4000~4999는 애플리케이션 예약 범위. */
export const WS_CLOSE_UNAUTHORIZED = 4401
export const WS_CLOSE_FORBIDDEN = 4403

/**
 * presence 전용 팔레트. 그룹 색(web의 GROUP_PALETTE)과 일부러 다른 계열을 쓴다 —
 * 그룹 배경 위에 참여자 테두리가 겹치는데 같은 색이면 구분이 안 된다.
 */
export const PEER_PALETTE = [
  '#2563EB', '#DB2777', '#059669', '#D97706',
  '#7C3AED', '#0891B2', '#DC2626', '#65A30D',
] as const

/** userId → 색. 서버가 배정하지 않고 모든 클라이언트가 같은 값을 계산한다(재접속에도 색 유지). */
export function peerColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PEER_PALETTE[h % PEER_PALETTE.length]!
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 반환 undefined = 형식 오류(null과 구분해야 하므로 sentinel을 쓴다). */
function parseSelection(v: unknown): PeerSelection | null | undefined {
  if (v === null || v === undefined) return null
  if (!isRecord(v)) return undefined
  const { kind, id } = v
  if (typeof kind !== 'string' || !(PEER_SELECTION_KINDS as readonly string[]).includes(kind)) return undefined
  if (typeof id !== 'string' || id === '') return undefined
  return { kind: kind as PeerSelectionKind, id }
}

function parsePeers(v: unknown): Peer[] | null {
  if (!Array.isArray(v)) return null
  const out: Peer[] = []
  for (const raw of v) {
    if (!isRecord(raw)) return null
    if (typeof raw.userId !== 'string' || typeof raw.name !== 'string') return null
    const selection = parseSelection(raw.selection)
    if (selection === undefined) return null
    out.push({ userId: raw.userId, name: raw.name, selection })
  }
  return out
}

/** 신뢰할 수 없는 소켓 프레임을 검증한다. 실패는 null — 호출부는 무시할 뿐 소켓을 끊지 않는다. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!isRecord(value)) return null

  if (value.type === 'presence') {
    const peers = parsePeers(value.peers)
    return peers === null ? null : { type: 'presence', peers }
  }
  if (value.type === 'ready') {
    if (!Number.isInteger(value.seq)) return null
    const peers = parsePeers(value.peers)
    return peers === null ? null : { type: 'ready', seq: value.seq as number, peers }
  }
  if (value.type === 'ops') {
    if (!Number.isInteger(value.seq)) return null
    if (typeof value.actorUserId !== 'string' || typeof value.actorName !== 'string') return null
    let ops: Op[]
    try {
      ops = parseOps(value.ops)
    } catch (err) {
      if (err instanceof OpParseError) return null
      throw err
    }
    return {
      type: 'ops', seq: value.seq as number, ops,
      actorUserId: value.actorUserId, actorName: value.actorName,
    }
  }
  return null
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!isRecord(value) || value.type !== 'selection') return null
  const selection = parseSelection(value.selection)
  if (selection === undefined) return null
  return { type: 'selection', selection }
}
