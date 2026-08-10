import { OpParseError, parseOps } from './op-guard.js'
import type { Op } from './op.js'

export type PeerSelectionKind = 'table' | 'relationship' | 'note' | 'group'
export const PEER_SELECTION_KINDS = ['table', 'relationship', 'note', 'group'] as const

export type PeerSelection = { kind: PeerSelectionKind; id: string }

/** 한 참여자가 브로드캐스트할 수 있는 선택 개수 상한. 초과분은 서버가 잘라낸다(payload 방어). */
export const MAX_PEER_SELECTIONS = 50

export type Peer = { userId: string; name: string; selections: PeerSelection[] }

export type ServerMessage =
  | { type: 'ready'; seq: number; peers: Peer[] }
  | { type: 'ops'; seq: number; ops: Op[]; actorUserId: string; actorName: string }
  | { type: 'presence'; peers: Peer[] }

export type ClientMessage = { type: 'selection'; selections: PeerSelection[] }

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

/** 반환 undefined = 형식 오류. */
function parseOneSelection(v: unknown): PeerSelection | undefined {
  if (!isRecord(v)) return undefined
  const { kind, id } = v
  if (typeof kind !== 'string' || !(PEER_SELECTION_KINDS as readonly string[]).includes(kind)) return undefined
  if (typeof id !== 'string' || id === '') return undefined
  return { kind: kind as PeerSelectionKind, id }
}

/**
 * 반환 undefined = 형식 오류. 빈 배열은 "선택 없음"이라 유효하다.
 * 상한 초과는 **거절이 아니라 절단**이다 — 신뢰할 수 없는 입력의 payload를 막되,
 * 정상 사용자가 많이 골랐다는 이유로 선택 전체를 잃지는 않게 한다.
 *
 * 중복(`kind`+`id`가 같음)은 첫 등장만 남긴다 — 단건 `selection` 시절 구조적으로 불가능했던
 * 상태라 소비처가 대비하지 않는다(같은 참여자 마크가 N개 붙어 React key가 중복된다).
 * **절단보다 먼저** 제거한다: 그러지 않으면 같은 id 50개가 상한을 소진해 실제 선택이 잘려 나간다.
 * 방어는 여기 한 곳에만 둔다 — 소비처(`buildPeerMarks` 등)에 같은 가드를 겹쳐 두면
 * 어느 한쪽이 사라져도 테스트가 잡지 못한다.
 */
function parseSelections(v: unknown): PeerSelection[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PeerSelection[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    const one = parseOneSelection(raw)
    if (one === undefined) return undefined
    // kind는 고정 목록이라 ':'를 담지 않는다 — 키가 모호해지지 않는다.
    const key = `${one.kind}:${one.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(one)
  }
  return out.length > MAX_PEER_SELECTIONS ? out.slice(0, MAX_PEER_SELECTIONS) : out
}

function parsePeers(v: unknown): Peer[] | null {
  if (!Array.isArray(v)) return null
  const out: Peer[] = []
  for (const raw of v) {
    if (!isRecord(raw)) return null
    if (typeof raw.userId !== 'string' || typeof raw.name !== 'string') return null
    const selections = parseSelections(raw.selections)
    if (selections === undefined) return null
    out.push({ userId: raw.userId, name: raw.name, selections })
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
  const selections = parseSelections(value.selections)
  if (selections === undefined) return null
  return { type: 'selection', selections }
}
