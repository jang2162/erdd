# Phase 3 실시간 동시편집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 프로젝트를 연 사용자들이 서로의 모델 변경을 즉시 보고, 참여자 아바타와 선택 하이라이트로 서로의 위치를 알 수 있게 한다.

**Architecture:** 서버가 `/ws` WebSocket 채널을 프로젝트 단위로 열고, 트랜잭션 **커밋 후**에만 적용된 op 배치를 브로드캐스트한다. 클라이언트는 수신 메시지를 기존 `serializeMutation` 직렬화 체인에 태워 순차 적용하고, `seq`가 연속이면 `applyOps`, 아니면 `model.get`으로 통째 리로드한다. presence(아바타·선택)는 영속화 없는 별도 메시지다.

**Tech Stack:** Fastify 5 + `@fastify/websocket`(신규), 브라우저 내장 `WebSocket`, zustand 5, React 19, vitest.

**설계 문서:** [docs/superpowers/specs/2026-07-29-phase3-realtime-collab-design.md](../specs/2026-07-29-phase3-realtime-collab-design.md)

## Global Constraints

- `packages/core`는 IO·런타임 의존성 free. `realtime-protocol.ts`는 타입 + 순수 파서 + 순수 함수만 둔다. **`ws`나 소켓 API를 import하지 않는다.**
- **불가침 파일**: `packages/core/src/diff.ts`, `packages/core/src/op.ts`(`ENTITY_KINDS`·`applyOps`), `packages/core/src/integrity.ts`, `packages/core/src/model.ts`. 이번 작업은 op 엔진·스키마 변경이 없다 — **새 마이그레이션 없음**(`apps/server/drizzle/`에 파일이 늘면 가정이 틀린 것).
- `runMutation`의 반환 타입은 **넓히기만** 한다(`{ seq }` → `{ seq, ops }`). 기존 필드·시맨틱 변경 금지.
- 새 런타임 의존성은 **`@fastify/websocket` 하나만**(서버 전용, Fastify 5 호환 버전). 웹은 브라우저 내장 `WebSocket`을 쓴다 — 클라이언트 WS 라이브러리 추가 금지. 서버 소켓 테스트는 `@fastify/websocket`이 제공하는 `app.injectWS()`를 쓴다(`ws`를 직접 의존성에 넣지 않는다).
- 소켓 인증 실패는 **예외를 던지지 않고 close code로 알린다**(4401 미인증 / 4403 권한 없음). 서버 프로세스가 죽으면 안 된다.
- 허브는 **인메모리 단일 인스턴스** 전제. Redis 확장 훅을 미리 만들지 않는다(YAGNI).
- UI 카피는 한국어.
- 커밋은 **명시 파일만** 스테이징(`git add .` / `-A` 금지). `.idea/*`·`.env`는 절대 커밋하지 않는다.
- 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
  ```
- **테스트 기준선: core 260 · web 253 · server 69 · typecheck 0.** 서버 테스트는 DB가 필요하다:
  ```bash
  cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test
  ```
  (env를 안 실으면 65개가 skip되고 "4 passed"로 보인다 — 통과로 착각하지 말 것.)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/core/src/realtime-protocol.ts` (신규) | 메시지 타입·순수 파서·`peerColor`. 서버와 웹이 같은 정의를 쓴다 |
| `apps/server/src/services/realtime.ts` (신규) | 프로젝트별 채널 허브. 소켓이 아니라 `send(text)` 함수만 안다 |
| `apps/server/src/services/mutate-publish.ts` (신규) | 트랜잭션 실행 + **커밋 후** 브로드캐스트. 모든 모델 변경 경로가 공유 |
| `apps/server/src/ws.ts` (신규) | `/ws` 라우트 플러그인 + 순수 인증 함수 `authorizeSocket` |
| `apps/server/src/services/mutation.ts` (수정) | `runMutation`이 적용된 `ops`도 반환 |
| `apps/server/src/context.ts`·`server.ts`·`routers/model.ts`·`routers/snapshot.ts` (수정) | 허브 주입·발행 경로 전환 |
| `apps/web/src/editor/use-realtime.ts` (신규) | 소켓 수명주기, 수신 적용, 재접속, 충돌 토스트, selection 발신 |
| `apps/web/src/editor/peer-marks.ts` (신규) | `Peer[]` → 엔티티별 표시 마크(순수) |
| `apps/web/src/editor/presence.tsx` (신규) | 참여자 아바타 바 |
| `apps/web/src/editor/store.ts` (수정) | `peers`·`setPeers`·`resync` |
| `apps/web/src/editor/use-model.ts` (수정) | `serializeMutation` export |
| `apps/web/src/editor/nodes.ts`·`table-node.tsx`·`note-node.tsx`·`edges.ts`·`relationship-edge.tsx`·`canvas.tsx` (수정) | peer 하이라이트 배선 |
| `apps/web/src/pages/project.tsx` (수정) | `useRealtime` 호출·아바타 바 배치 |
| `apps/web/vite.config.ts` (수정) | `/ws` 프록시(`ws: true`) |

---

## Task 1: core 실시간 프로토콜

**Files:**
- Create: `packages/core/src/realtime-protocol.ts`
- Test: `packages/core/src/realtime-protocol.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `parseOps`·`OpParseError` (`./op-guard.js`), `Op` (`./op.js`)
- Produces: 아래 시그니처 전부. Task 2·4(서버), Task 5·6·7(웹)이 여기서 import한다.
  ```ts
  type PeerSelectionKind = 'table' | 'relationship' | 'note' | 'group'
  type PeerSelection = { kind: PeerSelectionKind; id: string }
  type Peer = { userId: string; name: string; selection: PeerSelection | null }
  type ServerMessage =
    | { type: 'ready'; seq: number; peers: Peer[] }
    | { type: 'ops'; seq: number; ops: Op[]; actorUserId: string; actorName: string }
    | { type: 'presence'; peers: Peer[] }
  type ClientMessage = { type: 'selection'; selection: PeerSelection | null }
  const PEER_SELECTION_KINDS: readonly PeerSelectionKind[]
  const WS_CLOSE_UNAUTHORIZED = 4401
  const WS_CLOSE_FORBIDDEN = 4403
  const PEER_PALETTE: readonly string[]
  function peerColor(userId: string): string
  function parseServerMessage(raw: string): ServerMessage | null
  function parseClientMessage(raw: string): ClientMessage | null
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/realtime-protocol.test.ts` 신규 생성:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C packages/core test realtime-protocol`
Expected: FAIL — `Failed to resolve import "./realtime-protocol.js"`

- [ ] **Step 3: 구현한다**

`packages/core/src/realtime-protocol.ts` 신규 생성:

```ts
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
```

- [ ] **Step 4: index.ts에 export를 추가한다**

`packages/core/src/index.ts`의 `export { MAX_OPS_PER_MUTATION, OpParseError, parseOps } from './op-guard.js'` 바로 **아래**에 추가:

```ts
export {
  PEER_SELECTION_KINDS, PEER_PALETTE, WS_CLOSE_UNAUTHORIZED, WS_CLOSE_FORBIDDEN,
  peerColor, parseServerMessage, parseClientMessage,
} from './realtime-protocol.js'
export type {
  PeerSelectionKind, PeerSelection, Peer, ServerMessage, ClientMessage,
} from './realtime-protocol.js'
```

- [ ] **Step 5: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C packages/core test
pnpm -s -r typecheck
```
Expected: core 271 passed (260 + 11), typecheck 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/realtime-protocol.ts packages/core/src/realtime-protocol.test.ts packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): 실시간 프로토콜 메시지 타입·순수 파서·참여자 색상

서버/웹이 공유하는 ServerMessage·ClientMessage 정의와 신뢰 불가 프레임 검증.
파싱 실패는 null을 반환해 호출부가 소켓을 끊지 않고 무시할 수 있게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 2: 서버 실시간 허브

**Files:**
- Create: `apps/server/src/services/realtime.ts`
- Test: `apps/server/src/services/realtime.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Peer`·`PeerSelection`·`ServerMessage`·`Op` (from `@erdd/core`)
- Produces:
  ```ts
  type HubConnection = { userId: string; name: string; send: (text: string) => void }
  type HubHandle = { setSelection: (s: PeerSelection | null) => void; close: () => void }
  class RealtimeHub {
    subscribe(projectId: string, conn: HubConnection): HubHandle
    publishOps(projectId: string, payload: { seq: number; ops: Op[]; actorUserId: string; actorName: string }): void
    peers(projectId: string): Peer[]
    connectionCount(projectId: string): number
  }
  ```
  Task 3(`mutate-publish`)·Task 4(`ws.ts`)가 쓴다.

**이 파일은 DB를 쓰지 않는다.** 테스트도 `describe.skipIf`를 붙이지 않는다(env 없이도 항상 돌아야 한다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/services/realtime.test.ts` 신규 생성:

```ts
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

  it('같은 사용자의 소켓 2개는 peers에서 1건으로 합쳐지고 가장 최근 selection을 쓴다', () => {
    const hub = new RealtimeHub()
    const a1 = conn('u1', '갑')
    const a2 = conn('u1', '갑')
    const h1 = hub.subscribe('p1', a1.hub)
    const h2 = hub.subscribe('p1', a2.hub)

    h1.setSelection({ kind: 'table', id: 't1' })
    h2.setSelection({ kind: 'note', id: 'n1' })

    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selection: { kind: 'note', id: 'n1' } }])

    h1.setSelection({ kind: 'table', id: 't2' })
    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selection: { kind: 'table', id: 't2' } }])
  })

  it('peers 순서는 참가 순서를 따른다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const b = conn('u2', '을')
    hub.subscribe('p1', a.hub)
    const hb = hub.subscribe('p1', b.hub)
    hb.setSelection({ kind: 'table', id: 't1' })   // 최근 활동은 을이지만 순서는 갑이 먼저
    expect(hub.peers('p1').map((p) => p.userId)).toEqual(['u1', 'u2'])
  })

  it('구독·선택·해제 때마다 presence를 전파한다', () => {
    const hub = new RealtimeHub()
    const a = conn('u1', '갑')
    const ha = hub.subscribe('p1', a.hub)
    expect(lastPresence(a.received)?.peers).toEqual([{ userId: 'u1', name: '갑', selection: null }])

    const b = conn('u2', '을')
    const hb = hub.subscribe('p1', b.hub)
    expect(lastPresence(a.received)?.peers.map((p) => p.userId)).toEqual(['u1', 'u2'])

    hb.setSelection({ kind: 'table', id: 't1' })
    expect(lastPresence(a.received)?.peers[1]?.selection).toEqual({ kind: 'table', id: 't1' })

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
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C apps/server test realtime`
Expected: FAIL — `Failed to resolve import "./realtime.js"`

- [ ] **Step 3: 구현한다**

`apps/server/src/services/realtime.ts` 신규 생성:

```ts
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
```

- [ ] **Step 4: 테스트와 typecheck를 돌린다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test
pnpm -s -r typecheck
```
Expected: server 76 passed (69 + 7), typecheck 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/server/src/services/realtime.ts apps/server/src/services/realtime.test.ts
git commit -F - <<'EOF'
feat(server): 프로젝트별 실시간 채널 허브

소켓이 아니라 send 함수만 아는 인메모리 레지스트리. 구독·선택·해제마다
presence를 전파하고, 끊긴 소켓의 send 예외가 다른 구독자 전파를 막지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 3: 커밋 후 발행 단일 경로

**Files:**
- Create: `apps/server/src/services/mutate-publish.ts`
- Test: `apps/server/src/services/mutate-publish.test.ts`
- Modify: `apps/server/src/services/mutation.ts` (반환 타입 확장)
- Modify: `apps/server/src/context.ts` (hub 주입)
- Modify: `apps/server/src/server.ts` (hub 생성·decorate)
- Modify: `apps/server/src/routers/model.ts`, `apps/server/src/routers/snapshot.ts`

**Interfaces:**
- Consumes: Task 2의 `RealtimeHub`
- Produces:
  ```ts
  function mutateAndPublish(db: Db, hub: RealtimeHub, args: {
    projectId: string; actorUserId: string; actorName: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]; summary?: string
  }): Promise<{ seq: number }>
  ```
  `Context`에 `hub: RealtimeHub`가 추가되고, `FastifyInstance`에 `hub` 데코레이터가 생긴다(Task 4가 쓴다).

- [ ] **Step 1: `runMutation` 반환을 넓힌다**

`apps/server/src/services/mutation.ts`:

시그니처 줄을 바꾼다.
```ts
): Promise<{ seq: number }> {
```
→
```ts
): Promise<{ seq: number; ops: Op[] }> {
```

빈 배열 조기 반환을 바꾼다.
```ts
  if (ops.length === 0) return { seq: seqNow }
```
→
```ts
  if (ops.length === 0) return { seq: seqNow, ops: [] }
```

마지막 반환을 바꾼다.
```ts
  return { seq }
```
→
```ts
  return { seq, ops: authoritative }
```

독스트링에도 한 줄 추가한다 — `deriveOps가 빈 배열을 반환하면(변경 없음) Revision 없이 현재 seq를 반환한다.` 다음 줄에:
```
 * 반환하는 ops는 withAuthoritativeHistory를 거친 최종본이다(브로드캐스트가 이 값을 그대로 쓴다).
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/server/src/services/mutate-publish.test.ts` 신규 생성:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import type { Op } from '@erdd/core'
import { organizations, projects } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp } from '../testing/helpers.js'
import { createAccount } from './accounts.js'
import { RealtimeHub } from './realtime.js'
import { mutateAndPublish } from './mutate-publish.js'

const url = process.env.DATABASE_URL

function noteOp(): Op {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

describe.skipIf(!url)('mutateAndPublish', () => {
  let app: FastifyInstance
  let projectId: string
  let userId: string
  let hub: RealtimeHub
  let received: unknown[]

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const account = await createAccount(app.db!, {
      email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user',
    })
    userId = account.id
    const orgId = uuidv7()
    projectId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '테스트', kind: 'team' })
    await app.db!.insert(projects).values({
      id: projectId, orgId, name: 'P', description: '', dialects: ['postgresql'],
    })
    hub = new RealtimeHub()
    received = []
    hub.subscribe(projectId, { userId: 'watcher', name: '관찰자', send: (t) => received.push(JSON.parse(t)) })
    received.length = 0 // 구독 직후 presence 프레임은 관심 밖
  })

  it('성공하면 커밋된 seq·ops를 1회 발행한다', async () => {
    const op = noteOp()
    const { seq } = await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [op],
    })
    expect(seq).toBe(1)
    expect(received).toEqual([
      { type: 'ops', seq: 1, ops: [op], actorUserId: userId, actorName: '오너' },
    ])
  })

  it('변경이 없으면(op 0건) 발행하지 않는다', async () => {
    const { seq } = await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [],
    })
    expect(seq).toBe(0)
    expect(received).toEqual([])
  })

  it('트랜잭션이 롤백되면 발행하지 않는다', async () => {
    // 존재하지 않는 메모를 지우는 op → applyOps가 OpApplyError → 트랜잭션 롤백
    const ghost: Op = {
      action: 'delete', entity: 'note', entityId: uuidv7(), before: null,
    }
    await expect(mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [ghost],
    })).rejects.toThrow()
    expect(received).toEqual([])
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test mutate-publish`
Expected: FAIL — `Failed to resolve import "./mutate-publish.js"`

- [ ] **Step 4: `mutate-publish.ts`를 구현한다**

`apps/server/src/services/mutate-publish.ts` 신규 생성:

```ts
import type { Op, ProjectModel } from '@erdd/core'
import type { Db } from '../db/client.js'
import { runMutation } from './mutation.js'
import type { RealtimeHub } from './realtime.js'

/**
 * 모델 변경의 유일한 외부 진입점.
 *
 * 트랜잭션이 **커밋으로 resolve된 뒤에만** 브로드캐스트하므로 롤백된 op가 채널로 나가는 일이
 * 구조적으로 불가능하다. 새 변경 경로(예: Phase 4 CLI push)도 반드시 이 함수를 거쳐야 한다 —
 * 라우터마다 따로 발행하면 "새 호출처에서 브로드캐스트를 깜빡"이 필연이다.
 *
 * runMutation이 던지는 OpApplyError는 그대로 통과시킨다(호출부가 BAD_REQUEST로 매핑).
 */
export async function mutateAndPublish(
  db: Db,
  hub: RealtimeHub,
  args: {
    projectId: string
    actorUserId: string
    actorName: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]
    summary?: string
  },
): Promise<{ seq: number }> {
  const { seq, ops } = await db.transaction((tx) => runMutation(tx, {
    projectId: args.projectId,
    actorUserId: args.actorUserId,
    source: args.source,
    deriveOps: args.deriveOps,
    summary: args.summary,
  }))
  if (ops.length > 0) {
    hub.publishOps(args.projectId, {
      seq, ops, actorUserId: args.actorUserId, actorName: args.actorName,
    })
  }
  return { seq }
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test mutate-publish`
Expected: 3 passed

- [ ] **Step 6: 허브를 서버에 배선한다**

`apps/server/src/context.ts`:

import에 추가(파일 상단, `import { sessions, users } from './db/schema.js'` 위):
```ts
import type { RealtimeHub } from './services/realtime.js'
```

`createContext` 시그니처와 반환을 바꾼다.
```ts
export async function createContext({
  req, res, db,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
}) {
```
→
```ts
export async function createContext({
  req, res, db, hub,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
  hub: RealtimeHub
}) {
```
그리고 마지막 줄:
```ts
  return { db, user, req, res }
```
→
```ts
  return { db, user, req, res, hub }
```

`apps/server/src/server.ts`:

import 추가(`import { createDb, type Db } from './db/client.js'` 아래):
```ts
import { RealtimeHub } from './services/realtime.js'
```

`declare module 'fastify'` 블록에 한 줄 추가:
```ts
    hub: RealtimeHub
```

`app.decorate('pgPool', pool)` 아래에 추가:
```ts
  const hub = new RealtimeHub()
  app.decorate('hub', hub)
```

tRPC의 `createContext`를 바꾼다.
```ts
      createContext: ({ req, res }: CreateFastifyContextOptions) => createContext({ req, res, db }),
```
→
```ts
      createContext: ({ req, res }: CreateFastifyContextOptions) => createContext({ req, res, db, hub }),
```

- [ ] **Step 7: 두 라우터를 발행 경로로 옮긴다**

`apps/server/src/routers/model.ts`:

import 줄을 바꾼다.
```ts
import { currentSeq, runMutation } from '../services/mutation.js'
```
→
```ts
import { currentSeq } from '../services/mutation.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
```

`mutate` 프로시저의 try 블록을 바꾼다.
```ts
        return await ctx.db.transaction((tx) => runMutation(tx, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          source: 'web',
          deriveOps: () => ops,
          summary: input.summary,
        }))
```
→
```ts
        return await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'web',
          deriveOps: () => ops,
          summary: input.summary,
        })
```

`apps/server/src/routers/snapshot.ts`:

import 줄을 바꾼다.
```ts
import { currentSeq, runMutation } from '../services/mutation.js'
```
→
```ts
import { currentSeq } from '../services/mutation.js'
import { mutateAndPublish } from '../services/mutate-publish.js'
```

`restore` 프로시저의 try 블록을 바꾼다(주석 3줄은 그대로 옮긴다).
```ts
        return await ctx.db.transaction((tx) => runMutation(tx, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          source: 'system',
          // snap.model은 과거 스키마 버전의 jsonb일 수 있어 마이그레이션(예: 0004 domains 도입)
          // 이전 스냅샷에는 신규 컬렉션 키가 아예 없을 수 있다. diffModels가
          // ENTITY_KINDS 전체를 순회하며 각 컬렉션에 Object.entries를 호출하므로,
          // 누락된 키를 빈 레코드로 보충해 정규화한 뒤 target으로 넘긴다.
          deriveOps: (current) => diffModels(current, { ...createEmptyModel(), ...snap.model }),
          summary: `스냅샷 복원: ${snap.name}`,
        }))
```
→
```ts
        return await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'system',
          // snap.model은 과거 스키마 버전의 jsonb일 수 있어 마이그레이션(예: 0004 domains 도입)
          // 이전 스냅샷에는 신규 컬렉션 키가 아예 없을 수 있다. diffModels가
          // ENTITY_KINDS 전체를 순회하며 각 컬렉션에 Object.entries를 호출하므로,
          // 누락된 키를 빈 레코드로 보충해 정규화한 뒤 target으로 넘긴다.
          deriveOps: (current) => diffModels(current, { ...createEmptyModel(), ...snap.model }),
          summary: `스냅샷 복원: ${snap.name}`,
        })
```

- [ ] **Step 8: 전체 테스트와 typecheck를 돌린다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test
pnpm -s -r typecheck
```
Expected: server 79 passed (76 + 3), typecheck 출력 없음. **기존 69개가 하나도 깨지지 않아야 한다** — `runMutation` 반환 확장과 라우터 전환이 회귀 없이 끝났다는 증거다.

- [ ] **Step 9: 커밋**

```bash
git add apps/server/src/services/mutate-publish.ts apps/server/src/services/mutate-publish.test.ts \
  apps/server/src/services/mutation.ts apps/server/src/context.ts apps/server/src/server.ts \
  apps/server/src/routers/model.ts apps/server/src/routers/snapshot.ts
git commit -F - <<'EOF'
feat(server): 커밋 후 op 브로드캐스트 단일 경로

runMutation이 적용된 ops도 반환하고, mutateAndPublish가 트랜잭션 커밋 뒤에만
발행한다. 롤백된 op가 채널로 나가는 경로를 구조적으로 없앤다.
model.mutate·snapshot.restore를 이 경로로 옮겼다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 4: `/ws` 라우트와 채널 인증

**Files:**
- Create: `apps/server/src/ws.ts`
- Test: `apps/server/src/ws.test.ts`
- Modify: `apps/server/src/server.ts` (플러그인 등록)
- Modify: `apps/server/package.json` (`@fastify/websocket` 의존성)

**Interfaces:**
- Consumes: Task 1의 `parseClientMessage`·`WS_CLOSE_*`, Task 2의 `RealtimeHub`, `SESSION_COOKIE`(`./context.js`), `getProjectAccess`(`./services/perm.js`), `currentSeq`(`./services/mutation.js`)
- Produces:
  ```ts
  type SocketAuth = { ok: true; userId: string; name: string } | { ok: false; code: number }
  function authorizeSocket(db: Db, token: string | undefined, projectId: string | undefined): Promise<SocketAuth>
  function wsPlugin(hub: RealtimeHub, db: Db | null): (app: FastifyInstance) => Promise<void>
  ```

- [ ] **Step 1: 의존성을 추가한다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD && pnpm --filter @erdd/server add @fastify/websocket
```
설치 후 `apps/server/package.json`의 `dependencies`에 `@fastify/websocket`이 들어갔는지 확인한다. **Fastify 5와 호환되는 버전이어야 한다** — 설치 후 `pnpm -s -C apps/server test`가 플러그인 버전 오류 없이 돌면 확인된 것이다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/server/src/ws.test.ts` 신규 생성:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import {
  parseServerMessage, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, type ServerMessage,
} from '@erdd/core'
import { resetDb } from './testing/db.js'
import { createTestApp, loginAs } from './testing/helpers.js'
import { createAccount } from './services/accounts.js'
import { authorizeSocket } from './ws.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

function noteCreateOp() {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

/**
 * injectWS로 접속하되 리스너를 onInit에서 먼저 붙인다 — 서버가 열리자마자 보내는 ready나
 * 즉시 close를 놓치면 테스트가 통과할 수 없는 조건에서 영원히 기다리게 된다.
 * 도착한 프레임을 버퍼에 쌓아두므로 next()를 나중에 불러도 안전하다.
 */
async function connect(app: FastifyInstance, path: string, cookie?: string) {
  const frames: ServerMessage[] = []
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  let closeCode: number | null = null
  const closeWaiters: ((code: number) => void)[] = []

  const socket = await app.injectWS(path, cookie ? { headers: { cookie } } : {}, {
    onInit: (ws) => {
      ws.on('message', (data) => {
        const msg = parseServerMessage(String(data))
        if (!msg) return
        frames.push(msg)
        const i = waiters.findIndex((w) => w.match(msg))
        if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg)
      })
      ws.on('close', (code) => {
        closeCode = code
        closeWaiters.splice(0).forEach((r) => r(code))
      })
    },
  })

  return {
    socket,
    next: (match: (m: ServerMessage) => boolean, timeoutMs = 3000) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const hit = frames.find(match)
        if (hit) { resolve(hit); return }
        waiters.push({ match, resolve })
        setTimeout(
          () => reject(new Error(`타임아웃 — 받은 프레임: ${JSON.stringify(frames)}`)),
          timeoutMs,
        )
      }),
    closed: () => new Promise<number>((resolve) => {
      if (closeCode !== null) { resolve(closeCode); return }
      closeWaiters.push(resolve)
    }),
  }
}

describe.skipIf(!url)('ws', () => {
  let app: FastifyInstance
  let token: string
  let projectId: string
  let userId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const account = await createAccount(app.db!, {
      email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user',
    })
    userId = account.id
    token = await loginAs(app, 'o@t.dev', 'password-o')
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
  })

  describe('authorizeSocket', () => {
    it('세션 쿠키가 없으면 4401', async () => {
      expect(await authorizeSocket(app.db!, undefined, projectId))
        .toEqual({ ok: false, code: WS_CLOSE_UNAUTHORIZED })
    })

    it('없는 세션 토큰이면 4401', async () => {
      expect(await authorizeSocket(app.db!, uuidv7(), projectId))
        .toEqual({ ok: false, code: WS_CLOSE_UNAUTHORIZED })
    })

    it('projectId가 UUID가 아니면 DB에 닿기 전에 4403', async () => {
      expect(await authorizeSocket(app.db!, token, 'not-a-uuid'))
        .toEqual({ ok: false, code: WS_CLOSE_FORBIDDEN })
    })

    it('멤버가 아닌 프로젝트면 4403', async () => {
      await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
      const outsider = await loginAs(app, 'x@t.dev', 'password-x')
      expect(await authorizeSocket(app.db!, outsider, projectId))
        .toEqual({ ok: false, code: WS_CLOSE_FORBIDDEN })
    })

    it('접근 권한이 있으면 사용자 정보를 반환한다', async () => {
      expect(await authorizeSocket(app.db!, token, projectId))
        .toEqual({ ok: true, userId, name: '오너' })
    })
  })

  describe('/ws', () => {
    it('접속하면 ready를 받고, 이후 mutation의 op를 브로드캐스트받는다', async () => {
      const c = await connect(app, `/ws?projectId=${projectId}`, `erdd_session=${token}`)
      const ready = await c.next((m) => m.type === 'ready')
      expect(ready).toEqual({
        type: 'ready', seq: 0,
        peers: [{ userId, name: '오너', selection: null }],
      })

      const op = noteCreateOp()
      expect((await post(app, 'model.mutate', token, { projectId, ops: [op] })).statusCode).toBe(200)

      expect(await c.next((m) => m.type === 'ops')).toEqual({
        type: 'ops', seq: 1, ops: [op], actorUserId: userId, actorName: '오너',
      })
      c.socket.terminate()
    })

    it('인증 없이 접속하면 4401로 닫힌다', async () => {
      const c = await connect(app, `/ws?projectId=${projectId}`)
      expect(await c.closed()).toBe(WS_CLOSE_UNAUTHORIZED)
    })
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test ws`
Expected: FAIL — `Failed to resolve import "./ws.js"`

- [ ] **Step 4: 구현한다**

`apps/server/src/ws.ts` 신규 생성:

```ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { parseClientMessage, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED } from '@erdd/core'
import { SESSION_COOKIE } from './context.js'
import type { Db } from './db/client.js'
import { sessions, users } from './db/schema.js'
import { currentSeq } from './services/mutation.js'
import { getProjectAccess } from './services/perm.js'
import type { RealtimeHub } from './services/realtime.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ping 간격. 2회 연속 pong이 없으면 소켓을 끊는다. */
const HEARTBEAT_MS = 30_000
const MAX_MISSED_PONGS = 2

export type SocketAuth =
  | { ok: true; userId: string; name: string }
  | { ok: false; code: number }

/**
 * 소켓 업그레이드 인증. 예외를 던지지 않고 close code로 결과를 알린다
 * (핸들러에서 던지면 프로세스 로그만 더럽히고 클라이언트는 이유를 모른다).
 * 판정 기준은 tRPC의 createContext + requireProjectAccess('view')와 동일하다.
 */
export async function authorizeSocket(
  db: Db, token: string | undefined, projectId: string | undefined,
): Promise<SocketAuth> {
  if (!token) return { ok: false, code: WS_CLOSE_UNAUTHORIZED }
  // UUID가 아닌 projectId를 그대로 넘기면 postgres가 타입 오류를 던진다 — 먼저 거른다.
  if (!projectId || !UUID_RE.test(projectId)) return { ok: false, code: WS_CLOSE_FORBIDDEN }

  const rows = await db
    .select({
      id: users.id, name: users.name, isActive: users.isActive, expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
  const row = rows[0]
  if (!row || !row.isActive || row.expiresAt <= new Date()) {
    return { ok: false, code: WS_CLOSE_UNAUTHORIZED }
  }

  const access = await getProjectAccess(db, projectId, row.id)
  if (!access?.canView) return { ok: false, code: WS_CLOSE_FORBIDDEN }
  return { ok: true, userId: row.id, name: row.name }
}

/**
 * `/ws?projectId=<uuid>` 라우트. 편집 권한은 여기서 판정하지 않는다 —
 * Viewer도 수신·presence는 되고, 편집 차단은 model.mutate의 'edit' 게이트가 담당한다.
 */
export function wsPlugin(hub: RealtimeHub, db: Db | null) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/ws', { websocket: true }, async (socket, req) => {
      if (!db) {
        socket.close(WS_CLOSE_UNAUTHORIZED)
        return
      }
      const projectId = (req.query as { projectId?: string }).projectId
      if (projectId === undefined) {
        socket.close(WS_CLOSE_FORBIDDEN)
        return
      }
      const auth = await authorizeSocket(db, req.cookies[SESSION_COOKIE], projectId)
      if (!auth.ok) {
        socket.close(auth.code)
        return
      }

      const handle = hub.subscribe(projectId, {
        userId: auth.userId,
        name: auth.name,
        send: (text) => socket.send(text),
      })

      const seq = await currentSeq(db, projectId)
      socket.send(JSON.stringify({ type: 'ready', seq, peers: hub.peers(projectId) }))

      socket.on('message', (raw) => {
        const msg = parseClientMessage(String(raw))
        if (msg) handle.setSelection(msg.selection) // 형식 오류는 무시(소켓을 끊지 않는다)
      })

      let missed = 0
      const heartbeat: NodeJS.Timeout = setInterval(() => {
        if (missed >= MAX_MISSED_PONGS) {
          socket.terminate()
          return
        }
        missed += 1
        socket.ping()
      }, HEARTBEAT_MS)
      // 열린 소켓의 타이머가 프로세스·테스트 종료를 붙잡지 않게 한다.
      heartbeat.unref()
      socket.on('pong', () => { missed = 0 })

      socket.on('close', () => {
        clearInterval(heartbeat)
        handle.close()
      })
    })
  }
}
```

- [ ] **Step 5: 서버에 등록한다**

`apps/server/src/server.ts`:

import 추가(`import fastifyStatic from '@fastify/static'` 아래):
```ts
import fastifyWebsocket from '@fastify/websocket'
```
그리고 `import { RealtimeHub } from './services/realtime.js'` 아래:
```ts
import { wsPlugin } from './ws.js'
```

`app.register(fastifyCookie)` 아래, `app.register(fastifyTRPCPlugin, ...)` **위**에 추가:
```ts
  app.register(fastifyWebsocket)
  // 별도 register로 감싸야 fastifyWebsocket이 먼저 로드된 뒤 websocket 라우트가 등록된다.
  app.register(wsPlugin(hub, db))
```

- [ ] **Step 6: 테스트와 typecheck를 돌린다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD && set -a && . ./.env && set +a && pnpm -s -C apps/server test
pnpm -s -r typecheck
```
Expected: server 86 passed (79 + 7), typecheck 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/ws.ts apps/server/src/ws.test.ts apps/server/src/server.ts \
  apps/server/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(server): /ws 프로젝트 채널과 쿠키 기반 업그레이드 인증

erdd_session 쿠키로 세션·프로젝트 접근을 판정하고 실패는 close code(4401/4403)로
알린다. 접속 시 ready(seq·peers) 전송, selection 수신, 30초 하트비트.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 5: 웹 소켓 훅과 수신 적용

**Files:**
- Create: `apps/web/src/editor/use-realtime.ts`
- Test: `apps/web/src/editor/use-realtime.test.tsx`
- Modify: `apps/web/src/editor/store.ts` (`peers`·`setPeers`·`resync`)
- Modify: `apps/web/src/editor/use-model.ts` (`serializeMutation` export)
- Modify: `apps/web/vite.config.ts` (`/ws` 프록시)

**Interfaces:**
- Consumes: Task 1의 `parseServerMessage`·`Peer`·`ServerMessage`, 기존 `applyOps`·`serializeMutation`·`useEditorStore`
- Produces:
  ```ts
  function wsUrl(projectId: string, href: string): string
  type SelectionImpact = 'deleted' | 'changed' | null
  function selectionImpact(model: ProjectModel, ops: readonly Op[],
    selected: { tableId: string | null; relationshipId: string | null; noteId: string | null }): SelectionImpact
  function useRealtime(projectId: string): void
  ```
  스토어에 `peers: Peer[]`·`setPeers(peers)`·`resync(model, seq)`가 추가된다(Task 6·7이 `peers`를 읽는다).

- [ ] **Step 1: 스토어를 확장한다**

`apps/web/src/editor/store.ts`:

import에 `Peer`를 추가한다.
```ts
import {
  createEmptyModel, DEFAULT_NAMING_RULES, type Dialect, type NamingRules, type Op, type Peer,
  type ProjectModel,
} from '@erdd/core'
```

`EditorState`의 `redoStack: Op[][]` 아래에 추가:
```ts
  peers: Peer[]
```
그리고 액션 목록의 `setSeq: (seq: number) => void` 아래에 추가:
```ts
  setPeers: (peers: Peer[]) => void
  /** 서버 상태로 통째 되맞춘다(실시간 seq 간극·재접속). setLoaded와 달리 그룹 뷰를 유지한다. */
  resync: (model: ProjectModel, seq: number) => void
```

초기값 `redoStack: [],` 아래에 추가:
```ts
  peers: [],
```

`setLoaded`에 `peers: []`를 추가한다(프로젝트가 바뀌면 이전 참여자를 지워야 한다).
```ts
  setLoaded: (model, seq, projectId) =>
    set({
      model, seq, loaded: true, loadedProjectId: projectId,
      undoStack: [], redoStack: [], activeGroupView: null, peers: [],
    }),
```

`setSeq` 아래에 두 액션을 추가한다.
```ts
  setPeers: (peers) => set({ peers }),
  // undo 스택은 버린다(되돌리려는 op가 이미 사라진 대상을 가리킬 수 있다).
  // activeGroupView는 유지한다 — 남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다.
  // 선택은 대상이 아직 존재할 때만 남긴다.
  resync: (model, seq) => set((s) => {
    const keep = (id: string | null, rec: Record<string, unknown>) =>
      (id !== null && Object.hasOwn(rec, id) ? id : null)
    return {
      model, seq, loaded: true, undoStack: [], redoStack: [],
      selectedTableId: keep(s.selectedTableId, model.tables),
      selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
      selectedNoteId: keep(s.selectedNoteId, model.notes),
      selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
    }
  }),
```

`reset()`에도 `peers: []`를 추가한다.
```ts
  reset: () => set({
    model: createEmptyModel(), seq: 0, loaded: false, loadedProjectId: null,
    namingRules: DEFAULT_NAMING_RULES, dialects: [], peers: [],
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
```

- [ ] **Step 2: `serializeMutation`을 export한다**

`apps/web/src/editor/use-model.ts`의 다음 줄에 `export`를 붙인다.
```ts
function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
```
→
```ts
export function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
```
바로 위 주석 블록의 마지막에 한 문장을 덧붙인다.
```
// 실시간 수신 op도 같은 체인을 쓴다(use-realtime) — 내 mutation이 in-flight인 동안 남의 op가
// 끼어들어 낙관적 상태와 경합하는 것을 막는다.
```

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`apps/web/src/editor/use-realtime.test.tsx` 신규 생성:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { Op, ProjectModel, ServerMessage } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { selectionImpact, useRealtime, wsUrl } from './use-realtime.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'
const NOTE_A = '018f6b0e-0000-7000-8000-0000000000b1'
const NOTE_B = '018f6b0e-0000-7000-8000-0000000000b2'

function noteOp(id: string, content: string): Op {
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content, position: { x: 0, y: 0 }, color: '#fff' },
  }
}

/** 테스트가 프레임을 밀어넣을 수 있는 가짜 소켓. */
class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 1
  sent: string[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(text: string) { this.sent.push(text) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
  /** 서버가 프레임을 보낸 것처럼 만든다. */
  emit(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  /** 서버가 소켓을 특정 코드로 닫은 것처럼 만든다. */
  closeWith(code: number) { this.readyState = 3; this.onclose?.({ code }) }
}

function Probe({ projectId }: { projectId: string }) {
  useRealtime(projectId)
  return null
}

function renderHook(projectId = PROJECT_ID) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  return render(<Probe projectId={projectId} />, { wrapper: w })
}

/** 소켓이 열릴 때까지 기다린 뒤 마지막 인스턴스를 준다. */
async function socket(): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0))
  return FakeSocket.instances.at(-1)!
}

const modelWith = (...ids: string[]): ProjectModel => {
  const m = createEmptyModel()
  for (const id of ids) m.notes[id] = { id, content: id, position: { x: 0, y: 0 }, color: '#fff' }
  return m
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('wsUrl', () => {
  it('http는 ws로, https는 wss로 바꾸고 projectId를 붙인다', () => {
    expect(wsUrl('p1', 'http://localhost:5173/p/p1')).toBe('ws://localhost:5173/ws?projectId=p1')
    expect(wsUrl('p1', 'https://erdd.example.com/p/p1')).toBe('wss://erdd.example.com/ws?projectId=p1')
  })
})

describe('selectionImpact', () => {
  const model = modelWith(NOTE_A)
  const none = { tableId: null, relationshipId: null, noteId: null }

  it('선택이 없으면 null', () => {
    expect(selectionImpact(model, [noteOp(NOTE_B, 'x')], none)).toBeNull()
  })

  it('선택 대상이 수정되면 changed', () => {
    const op: Op = { action: 'update', entity: 'note', entityId: NOTE_A, changes: { content: { from: 'a', to: 'b' } } }
    expect(selectionImpact(model, [op], { ...none, noteId: NOTE_A })).toBe('changed')
  })

  it('선택 대상이 삭제되면 deleted가 changed를 이긴다', () => {
    const update: Op = { action: 'update', entity: 'note', entityId: NOTE_A, changes: { content: { from: 'a', to: 'b' } } }
    const del: Op = { action: 'delete', entity: 'note', entityId: NOTE_A, before: null }
    expect(selectionImpact(model, [update, del], { ...none, noteId: NOTE_A })).toBe('deleted')
  })

  it('선택한 테이블의 컬럼이 바뀌어도 changed', () => {
    const m = createEmptyModel()
    m.tables[NOTE_A] = {
      id: NOTE_A, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns[NOTE_B] = {
      id: NOTE_B, tableId: NOTE_A, logicalName: '이름', physicalName: 'NM',
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const op: Op = {
      action: 'update', entity: 'column', entityId: NOTE_B,
      changes: { logicalName: { from: '이름', to: '성명' } },
    }
    expect(selectionImpact(m, [op], { ...none, tableId: NOTE_A })).toBe('changed')
  })

  it('다른 테이블의 컬럼이 바뀌면 null(오탐 방지)', () => {
    const m = createEmptyModel()
    m.columns[NOTE_B] = {
      id: NOTE_B, tableId: '018f6b0e-0000-7000-8000-0000000000ff',
      logicalName: '이름', physicalName: 'NM',
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const op: Op = {
      action: 'update', entity: 'column', entityId: NOTE_B,
      changes: { logicalName: { from: '이름', to: '성명' } },
    }
    expect(selectionImpact(m, [op], { ...none, tableId: NOTE_A })).toBeNull()
  })
})

describe('useRealtime 수신 적용', () => {
  beforeEach(() => {
    useEditorStore.getState().setLoaded(modelWith(NOTE_A), 5, PROJECT_ID)
    mockTrpcFetch({ 'model.get': () => ({ data: { model: modelWith(NOTE_A, NOTE_B), seq: 42 } }) })
  })

  it('seq가 연속이면 op를 로컬에 적용한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 6, ops: [noteOp(NOTE_B, '남의 메모')],
      actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBe(6)
      expect(useEditorStore.getState().model.notes[NOTE_B]?.content).toBe('남의 메모')
    })
  })

  it('과거 seq(내 변경의 에코)는 무시한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 5, ops: [noteOp(NOTE_B, '에코')], actorUserId: 'u1', actorName: '나',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(useEditorStore.getState().seq).toBe(5)
    expect(useEditorStore.getState().model.notes[NOTE_B]).toBeUndefined()
  })

  it('seq에 간극이 있으면 model.get으로 통째 리로드하되 그룹 뷰는 유지한다', async () => {
    useEditorStore.getState().enterGroupView('g1')
    renderHook()
    ;(await socket()).emit({
      type: 'ops', seq: 9, ops: [noteOp(NOTE_B, '건너뜀')], actorUserId: 'u2', actorName: '동료',
    })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(42))
    expect(useEditorStore.getState().model.notes[NOTE_B]).toBeDefined()
    // resync는 setLoaded와 달리 그룹 뷰를 날리지 않는다 — 남이 편집할 때마다 튕기면 못 쓴다.
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
  })

  it('ready의 seq가 내 seq와 다르면 리로드한다', async () => {
    renderHook()
    ;(await socket()).emit({ type: 'ready', seq: 11, peers: [] })
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(42))
  })

  it('ready의 seq가 같으면 리로드하지 않고 peers만 반영한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'ready', seq: 5,
      peers: [{ userId: 'u2', name: '동료', selection: null }],
    })
    await waitFor(() => expect(useEditorStore.getState().peers).toHaveLength(1))
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('presence 메시지는 참여자 목록만 갱신한다', async () => {
    renderHook()
    ;(await socket()).emit({
      type: 'presence',
      peers: [{ userId: 'u2', name: '동료', selection: { kind: 'note', id: NOTE_A } }],
    })
    await waitFor(() => {
      expect(useEditorStore.getState().peers[0]?.selection).toEqual({ kind: 'note', id: NOTE_A })
    })
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('인증 실패(4401)로 닫히면 재접속하지 않는다', async () => {
    renderHook()
    ;(await socket()).closeWith(4401)
    await new Promise((r) => setTimeout(r, 1200))
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm -s -C apps/web test use-realtime`
Expected: FAIL — `Failed to resolve import "./use-realtime.js"`

- [ ] **Step 5: 구현한다**

`apps/web/src/editor/use-realtime.ts` 신규 생성:

```ts
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyOps, parseServerMessage,
  WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED,
  type Op, type ProjectModel, type ServerMessage,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { serializeMutation } from './use-model.js'

/** 인증 실패로 닫힌 소켓은 재시도하지 않는다 — 백오프가 무한 루프가 된다. */
const NO_RETRY_CODES = new Set<number>([WS_CLOSE_UNAUTHORIZED, WS_CLOSE_FORBIDDEN])
const BACKOFF_MS = [1000, 2000, 4000, 8000]

/** 서버와 같은 오리진의 소켓 주소. 스킴만 ws/wss로 바꾼다. */
export function wsUrl(projectId: string, href: string): string {
  const u = new URL('/ws', href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.searchParams.set('projectId', projectId)
  return u.toString()
}

export type SelectionImpact = 'deleted' | 'changed' | null

/**
 * 수신 op 배치가 내가 보고 있는 대상(테이블·관계·메모와 그 하위 컬럼·인덱스)을 건드렸는지.
 * 삭제가 수정을 이긴다 — "삭제됐다"가 사용자에게 더 중요한 사실이다.
 * 모델은 **적용 전** 상태여야 한다(삭제된 컬럼의 소속 테이블을 여기서 조회한다).
 */
export function selectionImpact(
  model: ProjectModel,
  ops: readonly Op[],
  selected: { tableId: string | null; relationshipId: string | null; noteId: string | null },
): SelectionImpact {
  const target = selected.tableId ?? selected.relationshipId ?? selected.noteId
  if (target === null) return null
  let impact: SelectionImpact = null
  for (const op of ops) {
    if (op.entityId === target) {
      if (op.action === 'delete') return 'deleted'
      impact = 'changed'
      continue
    }
    if (selected.tableId !== null && (op.entity === 'column' || op.entity === 'index')) {
      const owner = op.action === 'create'
        ? (op.data as { tableId?: unknown }).tableId
        : op.entity === 'column'
          ? model.columns[op.entityId]?.tableId
          : model.indexes[op.entityId]?.tableId
      if (owner === selected.tableId) impact = 'changed'
    }
  }
  return impact
}

/**
 * 프로젝트 실시간 채널에 붙는다. 모델이 로드된 뒤에만 연결하고, 프로젝트가 바뀌면 다시 연다.
 * 수신 처리는 전부 serializeMutation 체인 안에서 돈다 — 내 낙관적 mutation과 절대 교차하지 않는다.
 */
export function useRealtime(projectId: string): void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const ready = useEditorStore((s) => s.loaded && s.loadedProjectId === projectId)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!ready) return
    let disposed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const reload = async () => {
      try {
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        if (useEditorStore.getState().loadedProjectId === projectId) {
          useEditorStore.getState().resync(fresh.model, fresh.seq)
        }
      } catch {
        toast.error('서버 상태를 불러오지 못했습니다. 새로고침해 주세요.')
      }
    }

    const handle = (msg: ServerMessage) => serializeMutation(async () => {
      const s = useEditorStore.getState()
      if (s.loadedProjectId !== projectId) return

      if (msg.type === 'presence') { s.setPeers(msg.peers); return }
      if (msg.type === 'ready') {
        s.setPeers(msg.peers)
        if (msg.seq !== s.seq) await reload()
        return
      }
      if (msg.seq <= s.seq) return              // 내 변경의 에코이거나 중복
      if (msg.seq !== s.seq + 1) { await reload(); return }   // 간극 → 통째 리로드

      let next: ProjectModel
      try {
        next = applyOps(s.model, msg.ops)
      } catch {
        await reload()
        return
      }
      const impact = selectionImpact(s.model, msg.ops, {
        tableId: s.selectedTableId,
        relationshipId: s.selectedRelationshipId,
        noteId: s.selectedNoteId,
      })
      useEditorStore.getState().setModel(next)
      useEditorStore.getState().setSeq(msg.seq)
      // 배치당 최대 1건 — 대량 op에서 토스트가 쏟아지지 않게.
      if (impact === 'deleted') {
        useEditorStore.getState().select(null)
        toast.info('다른 사용자가 이 항목을 삭제했습니다')
      } else if (impact === 'changed') {
        toast.info('다른 사용자가 이 항목을 수정했습니다')
      }
    })

    const connect = () => {
      if (disposed) return
      const socket = new WebSocket(wsUrl(projectId, window.location.href))
      socketRef.current = socket
      socket.onopen = () => { attempt = 0 }
      socket.onmessage = (ev) => {
        const msg = parseServerMessage(String(ev.data))
        if (msg) void handle(msg)
      }
      socket.onclose = (ev) => {
        socketRef.current = null
        if (disposed || NO_RETRY_CODES.has(ev.code)) return
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
        attempt += 1
        timer = setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
      useEditorStore.getState().setPeers([])
    }
  }, [projectId, ready, queryClient, trpc])
}
```

- [ ] **Step 6: vite 프록시를 추가한다**

`apps/web/vite.config.ts`의 server 설정을 바꾼다.
```ts
  server: { proxy: { '/trpc': 'http://localhost:3000' } },
```
→
```ts
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      // ws: true가 없으면 dev에서 소켓 업그레이드가 프록시되지 않아 실시간이 아예 안 붙는다.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
```

- [ ] **Step 7: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C apps/web test
pnpm -s -r typecheck
```
Expected: web 266 passed (253 + 13), typecheck 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/use-realtime.ts apps/web/src/editor/use-realtime.test.tsx \
  apps/web/src/editor/store.ts apps/web/src/editor/use-model.ts apps/web/vite.config.ts
git commit -F - <<'EOF'
feat(web): 실시간 소켓 훅과 수신 op 적용

수신 메시지를 기존 serializeMutation 체인에 태워 낙관적 mutation과의 경합을 막고,
seq가 연속이면 applyOps·아니면 model.get으로 통째 리로드한다.
선택 중인 대상이 남에게 수정·삭제되면 배치당 1건 토스트로 알린다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 6: 참여자 아바타와 선택 발신

**Files:**
- Create: `apps/web/src/editor/presence.tsx`
- Test: `apps/web/src/editor/presence.test.tsx`
- Modify: `apps/web/src/editor/use-realtime.ts` (selection 발신 effect)
- Modify: `apps/web/src/editor/use-realtime.test.tsx` (발신 테스트 추가)
- Modify: `apps/web/src/pages/project.tsx` (`useRealtime` 호출·아바타 바 배치)

**Interfaces:**
- Consumes: Task 1의 `peerColor`·`PeerSelection`·`ClientMessage`, Task 5의 스토어 `peers`와 `useRealtime`
- Produces: `function PresenceBar({ selfUserId }: { selfUserId: string }): JSX.Element | null`

- [ ] **Step 1: 아바타 바의 실패하는 테스트를 쓴다**

`apps/web/src/editor/presence.test.tsx` 신규 생성:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Peer } from '@erdd/core'
import { peerColor } from '@erdd/core'
import { useEditorStore } from './store.js'
import { PresenceBar } from './presence.js'

const ME = 'u-me'
const peer = (userId: string, name: string): Peer => ({ userId, name, selection: null })

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('PresenceBar', () => {
  it('나 말고 아무도 없으면 아무것도 그리지 않는다', () => {
    useEditorStore.getState().setPeers([peer(ME, '나')])
    const { container } = render(<PresenceBar selfUserId={ME} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('다른 참여자의 이니셜을 사용자 색으로 보여준다', () => {
    useEditorStore.getState().setPeers([peer(ME, '나'), peer('u2', '김동료')])
    render(<PresenceBar selfUserId={ME} />)
    const avatar = screen.getByTitle('김동료')
    expect(avatar).toHaveTextContent('김')
    expect(avatar).toHaveStyle({ background: peerColor('u2') })
  })

  it('3명을 넘으면 나머지를 +N으로 접는다', () => {
    useEditorStore.getState().setPeers([
      peer(ME, '나'), peer('u2', '둘'), peer('u3', '셋'), peer('u4', '넷'), peer('u5', '다섯'),
    ])
    render(<PresenceBar selfUserId={ME} />)
    expect(screen.getByTitle('둘')).toBeInTheDocument()
    expect(screen.queryByTitle('다섯')).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C apps/web test presence`
Expected: FAIL — `Failed to resolve import "./presence.js"`

- [ ] **Step 3: 아바타 바를 구현한다**

`apps/web/src/editor/presence.tsx` 신규 생성:

```tsx
import { peerColor } from '@erdd/core'
import { useEditorStore } from './store.js'

const MAX_AVATARS = 3

/** 이름의 첫 글자(한글은 첫 음절, 영문은 첫 글자 대문자). */
function initialOf(name: string): string {
  const first = [...name][0] ?? '?'
  return first.toUpperCase()
}

/** 같은 프로젝트를 보고 있는 다른 사용자들. 자기 아바타는 정보가 없어 제외한다. */
export function PresenceBar({ selfUserId }: { selfUserId: string }) {
  const peers = useEditorStore((s) => s.peers)
  const others = peers.filter((p) => p.userId !== selfUserId)
  if (others.length === 0) return null

  const shown = others.slice(0, MAX_AVATARS)
  const rest = others.length - shown.length
  return (
    <div className="flex items-center gap-1" aria-label="함께 보는 사용자">
      {shown.map((p) => (
        <span
          key={p.userId}
          title={p.name}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: peerColor(p.userId) }}
        >
          {initialOf(p.name)}
        </span>
      ))}
      {rest > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: selection 발신의 실패하는 테스트를 추가한다**

`apps/web/src/editor/use-realtime.test.tsx`의 마지막 `describe` 뒤에 **최상위 형제로** 추가한다(기존 describe 안에 중첩하지 말 것):

```tsx
describe('useRealtime selection 발신', () => {
  beforeEach(() => {
    useEditorStore.getState().setLoaded(modelWith(NOTE_A), 5, PROJECT_ID)
    mockTrpcFetch({ 'model.get': () => ({ data: { model: modelWith(NOTE_A), seq: 5 } }) })
  })

  it('로컬 선택이 바뀌면 selection 메시지를 보낸다', async () => {
    renderHook()
    const s = await socket()
    useEditorStore.getState().selectNote(NOTE_A)
    await waitFor(() => expect(s.sent).toHaveLength(1))
    expect(JSON.parse(s.sent[0]!)).toEqual({
      type: 'selection', selection: { kind: 'note', id: NOTE_A },
    })
  })

  it('스로틀 창 안의 연속 변경은 마지막 값 1건으로 합쳐진다', async () => {
    renderHook()
    const s = await socket()
    useEditorStore.getState().select(NOTE_A)
    useEditorStore.getState().selectNote(NOTE_A)
    useEditorStore.getState().select(null)
    await waitFor(() => expect(s.sent).toHaveLength(1))
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: 'selection', selection: null })
  })
})
```

- [ ] **Step 5: 실패를 확인한다**

Run: `pnpm -s -C apps/web test use-realtime`
Expected: FAIL — `expected [] to have a length of 1` (발신 코드가 아직 없다)

- [ ] **Step 6: 발신 effect를 구현한다**

`apps/web/src/editor/use-realtime.ts`:

import에 타입을 추가한다.
```ts
import {
  applyOps, parseServerMessage,
  WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED,
  type ClientMessage, type Op, type PeerSelection, type ProjectModel, type ServerMessage,
} from '@erdd/core'
```

상수를 추가한다(`BACKOFF_MS` 아래).
```ts
/** 선택은 드래그·연속 클릭으로 잦게 바뀐다 — 마지막 값만 보낸다. */
const SELECTION_THROTTLE_MS = 100
```

`selectionImpact` 함수 위에 셀렉터를 추가한다.
```ts
type SelectionSource = {
  selectedTableId: string | null
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
}

/** 스토어 선택 상태를 프로토콜의 단일 selection으로 좁힌다(스토어가 이미 배타적으로 관리한다). */
function selectionOf(s: SelectionSource): PeerSelection | null {
  if (s.selectedTableId !== null) return { kind: 'table', id: s.selectedTableId }
  if (s.selectedRelationshipId !== null) return { kind: 'relationship', id: s.selectedRelationshipId }
  if (s.selectedNoteId !== null) return { kind: 'note', id: s.selectedNoteId }
  if (s.selectedGroupId !== null) return { kind: 'group', id: s.selectedGroupId }
  return null
}
```

`useRealtime` 안, 기존 `useEffect`의 **뒤**에 두 번째 effect를 추가한다.
```ts
  // 로컬 선택 → 서버. 소켓 수명주기와 독립이므로 별도 effect다(재접속 중이면 조용히 버린다).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = JSON.stringify(selectionOf(useEditorStore.getState()))

    const flush = () => {
      timer = undefined
      const socket = socketRef.current
      if (!socket || socket.readyState !== 1) return // 1 = OPEN
      const msg: ClientMessage = { type: 'selection', selection: selectionOf(useEditorStore.getState()) }
      socket.send(JSON.stringify(msg))
    }

    const unsubscribe = useEditorStore.subscribe((s) => {
      const current = JSON.stringify(selectionOf(s))
      if (current === last) return
      last = current
      if (timer === undefined) timer = setTimeout(flush, SELECTION_THROTTLE_MS)
    })

    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
```

- [ ] **Step 7: 프로젝트 화면에 배선한다**

`apps/web/src/pages/project.tsx`:

import을 추가한다(`import { useModelLoader } from '@/editor/use-model'` 아래).
```ts
import { useRealtime } from '@/editor/use-realtime'
import { PresenceBar } from '@/editor/presence'
```
그리고 `import { UserMenu } from '@/components/user-menu'` 아래:
```ts
import { useMe } from '@/components/require-auth'
```

컴포넌트 상단을 바꾼다.
```ts
  const { projectId = '' } = useParams()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)
```
→
```ts
  const { projectId = '' } = useParams()
  const me = useMe()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)
  useRealtime(projectId)
```

헤더 오른쪽 묶음의 첫 줄로 아바타 바를 넣는다.
```tsx
          <div className="flex items-center gap-2">
            {loaded && <GroupViewSelect />}
```
→
```tsx
          <div className="flex items-center gap-2">
            {loaded && <PresenceBar selfUserId={me.id} />}
            {loaded && <GroupViewSelect />}
```

- [ ] **Step 8: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C apps/web test
pnpm -s -r typecheck
```
Expected: web 271 passed (266 + 5), typecheck 출력 없음

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/editor/presence.tsx apps/web/src/editor/presence.test.tsx \
  apps/web/src/editor/use-realtime.ts apps/web/src/editor/use-realtime.test.tsx \
  apps/web/src/pages/project.tsx
git commit -F - <<'EOF'
feat(web): 참여자 아바타 바와 선택 상태 발신

헤더에 다른 참여자의 이니셜 아바타를 사용자 색으로 표시하고, 로컬 선택 변경을
100ms 스로틀로 서버에 보낸다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 7: 캔버스 peer 선택 하이라이트

**Files:**
- Create: `apps/web/src/editor/peer-marks.ts`
- Test: `apps/web/src/editor/peer-marks.test.ts`
- Modify: `apps/web/src/editor/nodes.ts`, `table-node.tsx`, `note-node.tsx`, `edges.ts`, `relationship-edge.tsx`, `canvas.tsx`
- Modify: `apps/web/src/editor/table-node.test.tsx` (하이라이트 렌더 테스트 추가)
- Modify: `apps/web/src/pages/project.tsx` (`selfUserId` 전달)

**Interfaces:**
- Consumes: Task 1의 `Peer`·`peerColor`, Task 5의 스토어 `peers`
- Produces:
  ```ts
  type PeerMark = { userId: string; name: string; color: string }
  type PeerMarks = Map<string, PeerMark[]>          // key = entityId
  function buildPeerMarks(peers: readonly Peer[], selfUserId: string): PeerMarks
  ```
  `buildNodes`·`buildEdges`가 마지막 선택 인자로 `PeerMarks`를 받고, `TableNodeData`·`NoteNodeData`·`RelationshipEdgeData`에 `peers?: PeerMark[]`가 생긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/peer-marks.test.ts` 신규 생성:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C apps/web test peer-marks`
Expected: FAIL — `Failed to resolve import "./peer-marks.js"`

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/peer-marks.ts` 신규 생성:

```ts
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
```

- [ ] **Step 4: 노드·엣지 데이터에 마크를 싣는다**

`apps/web/src/editor/nodes.ts`:

import을 추가한다.
```ts
import type { PeerMarks } from './peer-marks.js'
```

시그니처와 반환 data를 바꾼다.
```ts
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null, warnings: Warning[],
  view: NodeView = { kind: 'full' },
): Node<TableNodeData>[] {
```
→
```ts
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null, warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
): Node<TableNodeData>[] {
```
그리고 `data` 객체의 `columnWarnings,` 아래에 추가:
```ts
        peers: peerMarks.get(table.id),
```

`apps/web/src/editor/table-node.tsx`:

import을 추가한다.
```ts
import type { PeerMark } from './peer-marks.js'
```

`TableNodeData`에 필드를 추가한다.
```ts
  columnWarnings?: Record<string, Warning[]>
  peers?: PeerMark[]
```

구조분해와 렌더를 바꾼다.
```ts
  const { table, columns, viewMode, selected, tableWarnings = [], columnWarnings = {} } = data
```
→
```ts
  const { table, columns, viewMode, selected, tableWarnings = [], columnWarnings = {}, peers = [] } = data
  const peerColorHex = peers[0]?.color
```

바깥 `<div>`에 style만 더한다(**`overflow-hidden`은 유지한다** — 헤더 배경이 둥근 모서리를 넘어가면 안 된다).
```tsx
    <div
      className={cn(
        'min-w-48 overflow-hidden rounded-lg border bg-card shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
    >
```
→
```tsx
    <div
      className={cn(
        'min-w-48 overflow-hidden rounded-lg border bg-card shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
      // 로컬 선택(ring)과 구분되도록 peer는 바깥쪽 외곽선을 쓴다.
      style={peerColorHex ? { outline: `2px solid ${peerColorHex}`, outlineOffset: '2px' } : undefined}
    >
```
그리고 두 `<Handle .../>` **바로 다음**, 헤더 `<div className="flex items-center justify-between gap-2 border-b bg-secondary/60 px-3 py-2">` **앞**에 참여자 띠를 넣는다(카드 안이라 overflow 변경이 필요 없다).
```tsx
      {peers.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-0.5" style={{ background: peerColorHex }}>
          {peers.map((p) => (
            <span key={p.userId} className="text-[9px] font-semibold text-white">{p.name}</span>
          ))}
        </div>
      )}
```

`apps/web/src/editor/note-node.tsx` 전체를 바꾼다.
```tsx
import type { NodeProps } from '@xyflow/react'
import type { Note } from '@erdd/core'
import type { PeerMark } from './peer-marks.js'

export type NoteNodeData = { note: Note; selected: boolean; peers?: PeerMark[] }

export function NoteNode({ data }: NodeProps) {
  const { note, selected, peers = [] } = data as unknown as NoteNodeData
  const peerColorHex = peers[0]?.color
  return (
    <div
      className="min-h-16 min-w-40 max-w-64 rounded-md border p-2 text-xs shadow-sm"
      style={{
        background: note.color,
        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        outline: selected ? '2px solid var(--color-primary)' : peerColorHex ? `2px solid ${peerColorHex}` : undefined,
        outlineOffset: selected ? undefined : '2px',
      }}
    >
      <p className="whitespace-pre-wrap break-words text-foreground/90">{note.content}</p>
    </div>
  )
}
```

`apps/web/src/editor/edges.ts`:

import을 추가한다.
```ts
import type { PeerMark, PeerMarks } from './peer-marks.js'
```
타입과 시그니처를 바꾼다.
```ts
export type RelationshipEdgeData = {
  cardinality: '1:1' | '1:N'
  identifying: boolean
  peers?: PeerMark[]
}

export function buildEdges(
  model: ProjectModel, visibleTableIds?: Set<string>, peerMarks: PeerMarks = new Map(),
): Edge[] {
```
그리고 `edges.push({...})` 안의 `data` 줄을 바꾼다.
```ts
      data: { cardinality: rel.cardinality, identifying: rel.identifying },
```
→
```ts
      data: {
        cardinality: rel.cardinality, identifying: rel.identifying, peers: peerMarks.get(rel.id),
      },
```

`apps/web/src/editor/relationship-edge.tsx`의 `style`을 바꾼다.
```tsx
      style={{
        stroke: selected ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
```
→
```tsx
      style={{
        stroke: selected
          ? 'var(--color-primary)'
          : data?.peers?.[0]?.color ?? 'var(--color-muted-foreground)',
```
그리고 `strokeWidth`를 바꾼다.
```tsx
        strokeWidth: selected ? 2 : 1.5,
```
→
```tsx
        strokeWidth: selected || data?.peers?.length ? 2 : 1.5,
```

- [ ] **Step 5: 캔버스에 배선한다**

`apps/web/src/editor/canvas.tsx`:

import을 추가한다.
```ts
import { buildPeerMarks } from './peer-marks.js'
```

시그니처를 바꾼다.
```ts
export function Canvas({ projectId }: { projectId: string }) {
```
→
```ts
export function Canvas({ projectId, selfUserId }: { projectId: string; selfUserId: string }) {
```

`warnings` useMemo 아래에 추가한다.
```ts
  const peers = useEditorStore((s) => s.peers)
  const peerMarks = useMemo(() => buildPeerMarks(peers, selfUserId), [peers, selfUserId])
```

`derived` useMemo 안의 `buildNodes` 호출과 노트 노드 생성을 바꾼다.
```ts
    const tableNodes = buildNodes(model, viewMode, selectedId, warnings, view)
```
→
```ts
    const tableNodes = buildNodes(model, viewMode, selectedId, warnings, view, peerMarks)
```
```ts
      data: { note, selected: note.id === selectedNoteId } satisfies NoteNodeData,
```
→
```ts
      data: {
        note, selected: note.id === selectedNoteId, peers: peerMarks.get(note.id),
      } satisfies NoteNodeData,
```
그리고 이 useMemo의 의존성 배열 끝에 `peerMarks`를 추가한다.
```ts
  }, [model, viewMode, selectedId, selectedNoteId, selectedGroupId, warnings, view.kind, view.kind === 'group' ? view.groupId : null])
```
→
```ts
  }, [model, viewMode, selectedId, selectedNoteId, selectedGroupId, warnings, peerMarks, view.kind, view.kind === 'group' ? view.groupId : null])
```

`edges` useMemo의 두 `buildEdges` 호출에 `peerMarks`를 넘기고 의존성에도 추가한다.
```ts
      ? buildEdges(model, new Set([
          ...Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id),
          ...buildGhostNodes(model, view.groupId).map((g) => g.data.table.id),
        ]))
      : buildEdges(model)
```
→
```ts
      ? buildEdges(model, new Set([
          ...Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id),
          ...buildGhostNodes(model, view.groupId).map((g) => g.data.table.id),
        ]), peerMarks)
      : buildEdges(model, undefined, peerMarks)
```
```ts
  }, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId])
```
→
```ts
  }, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId, peerMarks])
```

`apps/web/src/pages/project.tsx`의 Canvas 호출을 바꾼다.
```tsx
                  <Canvas projectId={projectId} />
```
→
```tsx
                  <Canvas projectId={projectId} selfUserId={me.id} />
```

- [ ] **Step 6: 테이블 노드 하이라이트 테스트를 추가한다**

`apps/web/src/editor/table-node.test.tsx`에는 이미 `renderNode(data)` 헬퍼와 `DATA` 픽스처가 있다. 그것을 그대로 쓰고, 파일 마지막에 **최상위 형제 describe로** 추가한다(기존 `describe('TableNode', ...)` 안에 중첩하지 말 것):

```tsx
describe('peer 선택 하이라이트', () => {
  it('peer가 선택한 테이블에 참여자 이름 라벨을 그린다', () => {
    renderNode({
      ...DATA, viewMode: 'physical',
      peers: [{ userId: 'u2', name: '동료', color: '#DB2777' }],
    })
    expect(screen.getByText('동료')).toBeInTheDocument()
  })

  it('peer가 없으면 라벨을 그리지 않는다(회귀)', () => {
    renderNode({ ...DATA, viewMode: 'physical' })
    expect(screen.queryByText('동료')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 7: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C apps/web test
pnpm -s -r typecheck
```
Expected: web 276 passed (271 + 5), typecheck 출력 없음. **기존 `table-node.test.tsx`·`group-view.test.tsx`·`edges.test.ts`가 하나도 깨지지 않아야 한다** — 새 인자가 전부 선택적 기본값이라는 증거다.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/peer-marks.ts apps/web/src/editor/peer-marks.test.ts \
  apps/web/src/editor/nodes.ts apps/web/src/editor/table-node.tsx apps/web/src/editor/table-node.test.tsx \
  apps/web/src/editor/note-node.tsx apps/web/src/editor/edges.ts \
  apps/web/src/editor/relationship-edge.tsx apps/web/src/editor/canvas.tsx \
  apps/web/src/pages/project.tsx
git commit -F - <<'EOF'
feat(web): 캔버스 peer 선택 하이라이트

다른 참여자가 선택 중인 테이블·관계·메모에 사용자 색 외곽선과 이름 라벨을 그린다.
buildNodes/buildEdges의 새 인자는 기본값이 있어 기존 호출부는 그대로 동작한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## 완료 기준

- core 271 · web 276 · server 86 · typecheck 0 (증가분: core +11, web +23, server +17)
- `apps/server/drizzle/`에 새 마이그레이션 파일이 **없다**
- `git diff main --stat`에 `packages/core/src/diff.ts`·`op.ts`·`integrity.ts`·`model.ts`가 **없다**
- 새 런타임 의존성은 `@fastify/websocket` 하나뿐이다

## 브라우저 스모크 (구현 완료 후, 별도)

두 브라우저 프로필로 같은 프로젝트를 열고 확인한다:

1. A에서 테이블 이름을 바꾸면 B 캔버스에 즉시 반영된다
2. B 헤더에 A의 아바타가 뜨고, A가 선택한 테이블에 색 외곽선 + 이름 라벨이 보인다
3. B가 편집 중인 테이블을 A가 지우면 B에 삭제 토스트가 뜨고 선택이 풀린다
4. B의 서버를 잠깐 끊었다 붙이면(dev 서버 재시작) 자동 재접속되고 모델이 최신으로 맞춰진다
5. 새로고침 없이 A/B 모두 그룹 뷰를 유지한다(resync가 그룹 뷰를 날리지 않는다)
