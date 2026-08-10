# 좌측 사이드바 다중 선택·드래그 그룹 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**설계:** `docs/superpowers/specs/2026-08-10-sidebar-multiselect-dnd-design.md`

**Goal:** 좌측 사이드바를 읽기 전용 탐색기에서 조작 표면으로 바꾼다 — 여러 테이블을 골라 드래그로
그룹을 옮기고, 캔버스에서 끌어와 사이드바 그룹에 떨어뜨리고, 선택한 것을 한 번에 지운다.

**Architecture:** 선택 상태는 `store.selectedTableIds: readonly string[]` 하나이고 사이드바·캔버스가 공유한다
(마지막 원소 = 주 선택). 드래그는 소스가 둘(사이드바 pointer / ReactFlow 노드 드래그)이지만 "화면 좌표
→ 드롭 타깃" 판정은 `dropTargetOf` 한 함수로 수렴한다. 그룹을 옮기면 `planGroupMove`가 좌표를 다시
계산해 `groupId` 변경과 같은 producer 안에서 적용한다(Revision 1건). 실시간 presence 프로토콜은
`selections` 배열로 넓힌다.

**Tech Stack:** React 19 · zustand · @xyflow/react(ReactFlow) · vitest + @testing-library/react ·
tRPC 11 · Fastify(ws)

## Global Constraints

- **응답·주석·커밋 메시지·문서는 한국어로 쓴다**(`CLAUDE.md`).
- **모델 스키마를 바꾸지 않는다** — 새 op 엔티티도, 엔티티 필드 추가도, 마이그레이션도 없다. core의
  `model.ts`·`op.ts`를 건드리면 범위를 넘은 것이다.
- **`packages/core`는 IO·런타임 의존성 free**다. 렌더 상수(`EST_W` 등)에 기대는 계산은 web에 둔다.
- **`pnpm -s -r typecheck`의 출력만 보고 판정하지 마라.** `-s`가 자식 출력을 삼켜 타입 오류가 있어도
  출력이 0바이트이고 종료코드만 1이다. `pnpm -r typecheck; echo "EXIT=$?"`로 **종료코드를 확인**하거나
  패키지별로 돌린다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 것이 되어 또 오판한다.
- **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크 산출물도 고치지
  마라 — 단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
- **수정 건마다 구분력을 확인하라** — 프로덕션 변경을 되돌려 테스트가 *실제로 실패*하는지 보고 복구한다
  (`git checkout -- <path>` → `git status`로 clean 확인). **실패하지 않으면 덮지 말고 그렇다고 보고하라.**
  ⚠️ 아직 커밋되지 않은 **신규 파일**에는 `git checkout --`이 통하지 않는다(untracked라 복구할 원본이
  index에 없다). 그런 파일은 변조 전 내용을 스크래치에 복사해 두고 편집으로 되돌린 뒤 diff로 확인한다.
- **커밋은 경로를 명시한다.** `git add -A`/`git commit -a` 금지. `git add <경로들> && git commit ...`을
  **한 명령으로** 붙인다(스테이징과 커밋 사이에 틈을 두면 병렬 작업이 내 파일을 가져간다).
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```

## 실행 환경

워크트리 `.worktrees/feat-sidebar-multiselect`(브랜치 `feat/sidebar-multiselect`)에서 작업한다.
**컨트롤러가 워크트리 생성·`pnpm install`·격리 DB 마이그레이션까지 마쳐 둔다** — 워커는 바로 태스크를
시작한다.

⚠️ **이 저장소에 병렬 트랙이 둘 더 돌고 있다**(`feat-canvas-clipboard`, `feat-physical-first-naming`).
포트나 DB가 겹치면 먼저 뜬 쪽만 살고 나머지는 조용히 죽거나 **남의 서버에 붙는다.** 아래 C 슬롯을
그대로 쓴다.

| 항목 | 값 |
|---|---|
| server | `PORT=3003` |
| web | `ERDD_SERVER_PORT=3003` · `vite --port 5176` |
| dev DB | `erdd_dev_c` |
| test DB | `erdd_test_c` |

⚠️ **`main`을 체크아웃하거나 머지하지 마라.** 같은 저장소의 다른 워크트리가 물고 있으면 git이 거부한다.
병합은 컨트롤러가 한다.

테스트 명령:

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```

**현재 기준선(이 상태에서 전부 그린이어야 정상):** core 510 · cli 138 · web 450 · server 194 · typecheck EXIT=0

## 파일 구조

**신규**

| 파일 | 책임 |
|---|---|
| `apps/web/src/editor/group-move.ts` | `tableBounds` · `planGroupMove` — 좌표 재배치 순수 계산 |
| `apps/web/src/editor/drop-target.ts` | `dropTargetOf(el)` · `dropTargetAt(x, y)` — DOM → 드롭 타깃 |
| `apps/web/src/editor/drag-store.ts` | 드래그 중 상태(끌리는 id · 현재 타깃). 에디터 store와 분리 |
| `apps/web/src/editor/bulk-panel.tsx` | 일괄 작업 패널 + 삭제 확인 다이얼로그 |

**변경** — `realtime-protocol.ts`(core) · `services/realtime.ts`·`ws.ts`(server) ·
`store.ts`·`nodes.ts`·`group-nodes.ts`·`table-tree.tsx`·`canvas.tsx`·`edit-panel.tsx`·`toolbar.tsx`·
`peer-marks.ts`·`use-realtime.ts`(web)

---

## Task 1: 실시간 presence 프로토콜을 배열로 넓힌다

프로토콜·서버·웹 배선을 **한 태스크로 묶는다.** core 타입만 바꾸면 서버와 웹이 동시에 타입 에러가 나
중간 상태가 컴파일되지 않기 때문이다. **이 태스크는 동작을 바꾸지 않는다** — 아직 다중 선택이 없으므로
배열의 길이는 항상 0 또는 1이다.

**Files:**
- Modify: `packages/core/src/realtime-protocol.ts`
- Modify: `packages/core/src/realtime-protocol.test.ts`
- Modify: `apps/server/src/services/realtime.ts`
- Modify: `apps/server/src/services/realtime.test.ts:51-88`
- Modify: `apps/server/src/ws.ts:105`
- Modify: `apps/server/src/ws.test.ts:140`
- Modify: `apps/web/src/editor/peer-marks.ts`
- Modify: `apps/web/src/editor/peer-marks.test.ts`
- Modify: `apps/web/src/editor/use-realtime.ts:148,178,184`
- Modify: `apps/web/src/editor/use-realtime.test.tsx:190,200,203,248,259,278`

**Interfaces:**
- Produces:
  - `MAX_PEER_SELECTIONS = 50` (core)
  - `type Peer = { userId: string; name: string; selections: PeerSelection[] }`
  - `type ClientMessage = { type: 'selection'; selections: PeerSelection[] }`
  - `HubHandle.setSelections(selections: PeerSelection[]): void` (server)
- Consumes: 없음(첫 태스크)

- [ ] **Step 1: core 실패 테스트를 쓴다**

`packages/core/src/realtime-protocol.test.ts` 끝에 추가:

```ts
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
```

같은 파일 상단 import에 `MAX_PEER_SELECTIONS`를 추가한다:

```ts
import {
  MAX_PEER_SELECTIONS, PEER_PALETTE, parseClientMessage, parseServerMessage, peerColor,
  type ServerMessage,
} from './realtime-protocol.js'
```

기존 테스트 중 `selection` 필드를 쓰는 것을 함께 고친다. `presence 메시지를 왕복한다(selection null
포함)` 케이스(파일 상단, 약 24행)를 다음으로 바꾼다:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/realtime-protocol.test.ts`
Expected: FAIL — `MAX_PEER_SELECTIONS`가 export되지 않아 import 에러, 그리고 `selections` 필드를
파서가 모른다.

- [ ] **Step 3: core 프로토콜을 고친다**

`packages/core/src/realtime-protocol.ts`에서 `PeerSelection`·`PEER_SELECTION_KINDS`는 **그대로 두고**
아래를 바꾼다.

```ts
/** 한 참여자가 브로드캐스트할 수 있는 선택 개수 상한. 초과분은 서버가 잘라낸다(payload 방어). */
export const MAX_PEER_SELECTIONS = 50

export type Peer = { userId: string; name: string; selections: PeerSelection[] }

export type ServerMessage =
  | { type: 'ready'; seq: number; peers: Peer[] }
  | { type: 'ops'; seq: number; ops: Op[]; actorUserId: string; actorName: string }
  | { type: 'presence'; peers: Peer[] }

export type ClientMessage = { type: 'selection'; selections: PeerSelection[] }
```

`parseSelection`을 다음 둘로 교체한다(기존 `parseSelection`은 지운다 — `null` 갈래가 프로토콜에서
사라졌다):

```ts
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
 */
function parseSelections(v: unknown): PeerSelection[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PeerSelection[] = []
  for (const raw of v) {
    const one = parseOneSelection(raw)
    if (one === undefined) return undefined
    out.push(one)
  }
  return out.length > MAX_PEER_SELECTIONS ? out.slice(0, MAX_PEER_SELECTIONS) : out
}
```

`parsePeers`의 selection 처리를 바꾼다:

```ts
    const selections = parseSelections(raw.selections)
    if (selections === undefined) return null
    out.push({ userId: raw.userId, name: raw.name, selections })
```

`parseClientMessage`의 마지막 세 줄을 바꾼다:

```ts
  const selections = parseSelections(value.selections)
  if (selections === undefined) return null
  return { type: 'selection', selections }
```

- [ ] **Step 4: core 테스트 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run`
Expected: PASS — 새 6건 포함 전부. (기준선 481 → 487)

- [ ] **Step 5: 서버 허브를 고친다**

`apps/server/src/services/realtime.ts`:

```ts
export type HubHandle = {
  setSelections: (selections: PeerSelection[]) => void
  close: () => void
}

type Entry = {
  conn: HubConnection
  selections: PeerSelection[]
  /** 참가 순번 — peers 표시 순서(사용자별 최솟값). */
  joinRank: number
  /** 마지막 selection 갱신 순번 — 같은 사용자의 소켓 중 어느 selections를 쓸지 결정. */
  selRank: number
}
```

`subscribe` 안:

```ts
    const entry: Entry = { conn, selections: [], joinRank: this.#rank, selRank: this.#rank }
```

```ts
      setSelections: (selections) => {
        if (closed) return
        this.#rank += 1
        entry.selections = selections
        entry.selRank = this.#rank
        this.#broadcastPresence(projectId)
      },
```

`peers()` 안의 두 자리:

```ts
          peer: { userId: entry.conn.userId, name: entry.conn.name, selections: entry.selections },
```
```ts
      if (entry.selRank > prev.selRank) {
        prev.peer.selections = entry.selections
        prev.selRank = entry.selRank
      }
```

`apps/server/src/ws.ts:105`:

```ts
        if (msg) handle.setSelections(msg.selections) // 형식 오류는 무시(소켓을 끊지 않는다)
```

- [ ] **Step 6: 서버 테스트를 고치고 다중 건 케이스를 더한다**

`apps/server/src/services/realtime.test.ts`에서 `setSelection(` 호출을 전부 `setSelections([...])`로,
단언의 `selection:` 를 `selections:` 배열로 바꾼다. 51행 케이스는 이렇게 된다:

```ts
  it('같은 사용자의 소켓 2개는 peers에서 1건으로 합쳐지고 가장 최근 selections를 쓴다', () => {
    // ... 기존 구독 코드 그대로 ...
    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selections: [{ kind: 'note', id: 'n1' }] }])
    // ... 두 번째 소켓이 갱신한 뒤 ...
    expect(hub.peers('p1')).toEqual([{ userId: 'u1', name: '갑', selections: [{ kind: 'table', id: 't2' }] }])
  })
```

81행의 `selection: null`은 `selections: []`로, 88행의 단언은 다음으로 바꾼다:

```ts
    expect(lastPresence(a.received)?.peers[1]?.selections).toEqual([{ kind: 'table', id: 't1' }])
```

그리고 다중 건이 그대로 전파되는 것을 잠그는 테스트를 추가한다(파일 끝, 기존 `describe` 안):

```ts
  it('여러 건을 고르면 그대로 N건이 전파된다', () => {
    const hub = new RealtimeHub()
    const a = collect()
    hub.subscribe('p1', a.conn)
    const b = collect()
    const hb = hub.subscribe('p1', b.conn)

    hb.setSelections([{ kind: 'table', id: 't1' }, { kind: 'table', id: 't2' }, { kind: 'table', id: 't3' }])

    const peers = lastPresence(a.received)?.peers ?? []
    expect(peers.find((p) => p.userId === b.conn.userId)?.selections).toHaveLength(3)
  })
```

> ⚠️ `collect()`·`lastPresence()`는 이 파일에 이미 있는 헬퍼다. 시그니처가 위와 다르면 **파일의 실제
> 헬퍼에 맞춰 호출을 고치고, 무엇이 달랐는지 보고하라.**

`apps/server/src/ws.test.ts:140`의 `selection: null` → `selections: []`.

- [ ] **Step 7: 서버 테스트 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' pnpm --filter @erdd/server exec vitest run`
Expected: PASS. **`20 passed | 174 skipped`가 나오면 DB env가 안 들어간 것이다** — 194건이 도는지
수를 확인하라(새 1건 포함 195).

- [ ] **Step 8: 웹 배선을 고친다**

`apps/web/src/editor/peer-marks.ts` — peer마다 `selections`를 순회한다:

```ts
/** 참여자 목록을 캔버스가 바로 쓸 수 있는 엔티티별 표시 마크로 뒤집는다. */
export function buildPeerMarks(peers: readonly Peer[], selfUserId: string): PeerMarks {
  const marks: PeerMarks = new Map()
  for (const p of peers) {
    if (p.userId === selfUserId) continue
    const mark: PeerMark = { userId: p.userId, name: p.name, color: peerColor(p.userId) }
    for (const sel of p.selections) {
      const list = marks.get(sel.id)
      if (list) list.push(mark)
      else marks.set(sel.id, [mark])
    }
  }
  return marks
}
```

`apps/web/src/editor/use-realtime.ts` — `selectionOf`를 `selectionsOf`로 바꾼다. **이 태스크에서는
store가 아직 단일 선택이므로 길이 0 또는 1이다**(다중화는 Task 2):

```ts
/** 스토어 선택 상태를 프로토콜의 selections 배열로 좁힌다. */
function selectionsOf(s: SelectionSource): PeerSelection[] {
  if (s.selectedTableId !== null) return [{ kind: 'table', id: s.selectedTableId }]
  if (s.selectedRelationshipId !== null) return [{ kind: 'relationship', id: s.selectedRelationshipId }]
  if (s.selectedNoteId !== null) return [{ kind: 'note', id: s.selectedNoteId }]
  if (s.selectedGroupId !== null) return [{ kind: 'group', id: s.selectedGroupId }]
  return []
}
```

호출부 3곳(148·178·184행)을 바꾼다:

```ts
        const msg: ClientMessage = { type: 'selection', selections: selectionsOf(useEditorStore.getState()) }
```
```ts
    let last = JSON.stringify(selectionsOf(useEditorStore.getState()))
```
```ts
      const msg: ClientMessage = { type: 'selection', selections: selectionsOf(useEditorStore.getState()) }
```

그리고 `subscribe` 콜백 안의 `selectionOf(s)`도 `selectionsOf(s)`로.

- [ ] **Step 9: 웹 테스트를 고친다**

`apps/web/src/editor/peer-marks.test.ts`의 픽스처:

```ts
const peers: Peer[] = [
  { userId: 'me', name: '나', selections: [{ kind: 'table', id: 't1' }] },
  { userId: 'u2', name: '둘', selections: [{ kind: 'table', id: 't1' }] },
  { userId: 'u3', name: '셋', selections: [{ kind: 'note', id: 'n1' }] },
  { userId: 'u4', name: '넷', selections: [] },
]
```

그리고 다중 건 케이스를 추가한다:

```ts
  it('한 참여자가 여러 개를 고르면 각 엔티티에 모두 마크가 붙는다', () => {
    const many: Peer[] = [
      { userId: 'u9', name: '아홉', selections: [{ kind: 'table', id: 't1' }, { kind: 'table', id: 't2' }] },
    ]
    const marks = buildPeerMarks(many, 'me')
    expect(marks.get('t1')?.map((m) => m.userId)).toEqual(['u9'])
    expect(marks.get('t2')?.map((m) => m.userId)).toEqual(['u9'])
  })
```

`apps/web/src/editor/use-realtime.test.tsx`의 6곳:
- 190행 `selection: null` → `selections: []`
- 200행 `selection: { kind: 'note', id: NOTE_A }` → `selections: [{ kind: 'note', id: NOTE_A }]`
- 203행 `peers[0]?.selection` → `peers[0]?.selections`, 기대값을 `[{ kind: 'note', id: NOTE_A }]`로
- 248·278행 `{ type: 'selection', selection: {...} }` → `{ type: 'selection', selections: [{...}] }`
- 259행 `{ type: 'selection', selection: null }` → `{ type: 'selection', selections: [] }`

- [ ] **Step 10: 웹 테스트와 typecheck를 확인한다**

Run:
```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: web PASS(451 — peer-marks +1), EXIT=0

- [ ] **Step 11: 구분력을 확인한다**

`MAX_PEER_SELECTIONS` 절단을 되돌려(`return out`으로 바꿔) core 테스트가 **실제로 실패**하는지 보고
복구한다. 실패하지 않으면 그렇다고 보고하라.

- [ ] **Step 12: 커밋**

```bash
git add packages/core/src/realtime-protocol.ts packages/core/src/realtime-protocol.test.ts \
  apps/server/src/services/realtime.ts apps/server/src/services/realtime.test.ts \
  apps/server/src/ws.ts apps/server/src/ws.test.ts \
  apps/web/src/editor/peer-marks.ts apps/web/src/editor/peer-marks.test.ts \
  apps/web/src/editor/use-realtime.ts apps/web/src/editor/use-realtime.test.tsx \
&& git commit -m "feat: 실시간 presence 선택을 배열로 넓힌다

Peer.selection(단건)을 selections(배열)로 바꾸고 상한 50을 두어 초과분을
서버가 잘라낸다. 이 커밋은 동작을 바꾸지 않는다 — 다중 선택이 아직 없어
배열 길이는 항상 0 또는 1이다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 2: store를 다중 선택으로 넓히고 기존 사용처를 주 선택으로 치환한다

**이 태스크도 동작을 바꾸지 않는다.** 상태의 모양만 바꾸고 모든 화면은 지금처럼 단일 선택으로 돈다.
다중 선택 제스처는 Task 4·5에서 얹는다.

**Files:**
- Modify: `apps/web/src/editor/store.ts`
- Modify: `apps/web/src/editor/store.test.ts`
- Modify: `apps/web/src/editor/canvas.tsx:33`
- Modify: `apps/web/src/editor/edit-panel.tsx:49,56`
- Modify: `apps/web/src/editor/table-tree.tsx:15,75,87`
- Modify: `apps/web/src/editor/toolbar.tsx:19,53,54,98`
- Modify: `apps/web/src/editor/use-realtime.ts:30,38,124`
- Modify: 단언을 쓰는 테스트 7곳 — `table-tree.test.tsx:55`, `snapshot-diff.test.tsx:77,94`,
  `naming-check.test.tsx:31,59`, `relationship-panel.test.tsx:86`, `undo-redo.test.tsx:32,44,56`,
  `group-view.test.tsx:20`, `use-realtime.test.tsx`(selectionImpact 호출부)

**Interfaces:**
- Consumes: Task 1의 `selectionsOf`
- Produces:
  - `EditorState.selectedTableIds: readonly string[]` (마지막 원소 = 주 선택)
  - `select(tableId: string | null): void` — 시그니처 **불변**
  - `toggleTable(tableId: string): void`
  - `selectTables(tableIds: readonly string[]): void`
  - `export const primaryTableId = (s: EditorState) => string | null`
  - `selectionImpact(model, ops, { tableIds: readonly string[]; relationshipId; noteId })`

- [ ] **Step 1: store 실패 테스트를 쓴다**

`apps/web/src/editor/store.test.ts` 끝에 추가:

```ts
describe('editor store 다중 선택', () => {
  it('select는 단일 선택으로 리셋한다(기존 동작)', () => {
    useEditorStore.getState().selectTables(['a', 'b'])
    useEditorStore.getState().select('c')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['c'])
  })

  it('select(null)은 선택을 비운다', () => {
    useEditorStore.getState().selectTables(['a'])
    useEditorStore.getState().select(null)
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('toggleTable은 없으면 뒤에 붙이고 있으면 뺀다 — 마지막 원소가 주 선택이다', () => {
    useEditorStore.getState().select('a')
    useEditorStore.getState().toggleTable('b')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['a', 'b'])
    expect(primaryTableId(useEditorStore.getState())).toBe('b')
    useEditorStore.getState().toggleTable('a')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['b'])
  })

  it('primaryTableId는 선택이 없으면 null이다', () => {
    expect(primaryTableId(useEditorStore.getState())).toBeNull()
  })

  it('selectTables는 비어 있지 않으면 다른 종류 선택을 해제한다', () => {
    useEditorStore.getState().selectNote('n1')
    useEditorStore.getState().selectTables(['a', 'b'])
    expect(useEditorStore.getState().selectedNoteId).toBeNull()
    expect(useEditorStore.getState().selectedTableIds).toEqual(['a', 'b'])
  })

  it('selectTables([])는 테이블만 비우고 메모·관계·그룹 선택은 건드리지 않는다', () => {
    // 캔버스에서 메모를 클릭하면 ReactFlow가 테이블을 해제하며 빈 배열을 쏘는데,
    // 그것이 같은 클릭의 selectNote를 지우면 안 된다(콜백 발화 순서에 기대지 않는다).
    useEditorStore.getState().selectNote('n1')
    useEditorStore.getState().selectTables([])
    expect(useEditorStore.getState().selectedNoteId).toBe('n1')
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('resync는 사라진 테이블만 선택에서 걷어낸다', () => {
    useEditorStore.getState().selectTables(['t1', 't2'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().resync(model, 5)
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
  })

  it('resync에서 아무것도 안 사라지면 배열 참조를 유지한다', () => {
    // 실시간 op는 초당 여러 번 온다. 매번 새 배열을 만들면 이 값을 구독하는
    // 컴포넌트가 남의 모든 편집마다 리렌더된다.
    useEditorStore.getState().selectTables(['t1', 't2'])
    const before = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().resync(buildSampleModel(), 6)
    expect(useEditorStore.getState().selectedTableIds).toBe(before)
  })

  it('resync로 선택이 전부 사라지면 빈 선택의 공유 참조를 쓴다', () => {
    // 빈 선택은 어느 경로로 도달하든 같은 배열 인스턴스여야 한다. resync만 새 빈 배열을
    // 만들면, 남이 내가 보던 테이블을 지울 때마다 "비었다"가 매번 다른 값이 된다.
    useEditorStore.getState().select(null)
    const empty = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().selectTables(['t1'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().resync(model, 7)
    expect(useEditorStore.getState().selectedTableIds).toBe(empty)
  })
})
```

파일 상단 import에 추가:

```ts
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { primaryTableId, useEditorStore } from './store.js'
```

> 픽스처 사실: `buildSampleModel()`의 테이블은 `t1`(MBR_GRD)·`t2`(MBR) 둘뿐이고 둘 다 `groupId: 'g1'`,
> 그룹은 `g1`(회원관리) 하나다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/store.test.ts`
Expected: FAIL — `primaryTableId`·`toggleTable`·`selectTables`가 없다.

- [ ] **Step 3: store를 고친다**

`apps/web/src/editor/store.ts`:

```ts
type EditorState = {
  // ... 다른 필드 그대로 ...
  /**
   * 선택된 테이블들. **마지막 원소가 주 선택**(상세 패널·포커스 대상)이다.
   * `readonly` 인 이유: 빈 선택은 모두 같은 배열 인스턴스(`NO_TABLES`)를 공유하므로
   * 제자리 변형은 전역 상수를 오염시킨다. 타입으로 막는다.
   */
  selectedTableIds: readonly string[]
  // ...
  select: (tableId: string | null) => void
  toggleTable: (tableId: string) => void
  selectTables: (tableIds: readonly string[]) => void
  // ...
}

/** 주 선택 = 마지막으로 고른 테이블. 이 규칙이 흩어지지 않게 셀렉터를 여기서만 정의한다. */
export const primaryTableId = (s: EditorState): string | null => s.selectedTableIds.at(-1) ?? null

/** 모든 "비운 상태"가 같은 배열 인스턴스를 공유한다 — 불필요한 리렌더를 막는다. 절대 변형하지 마라. */
const NO_TABLES: readonly string[] = []

const CLEARED_SELECTION = {
  selectedTableIds: NO_TABLES, selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}
```

초기값과 액션:

```ts
  selectedTableIds: NO_TABLES,
```

```ts
  select: (tableId) => set({ ...CLEARED_SELECTION, selectedTableIds: tableId === null ? NO_TABLES : [tableId] }),
  toggleTable: (tableId) => set((s) => {
    const next = s.selectedTableIds.includes(tableId)
      ? s.selectedTableIds.filter((id) => id !== tableId)
      : [...s.selectedTableIds, tableId]
    return { ...CLEARED_SELECTION, selectedTableIds: next.length === 0 ? NO_TABLES : next }
  }),
  // 빈 배열은 다른 종류 선택을 지우지 않는다 — 캔버스에서 메모를 클릭하면
  // ReactFlow가 테이블 해제로 빈 배열을 쏘는데, 그것이 같은 클릭의 selectNote를 지우면 안 된다.
  // 이미 비어 있는지 따로 보지 않는다 — zustand는 어떤 partial을 받든 새 루트 상태를 만들어
  // 리스너를 전부 호출하므로 `{}` 를 돌려줘도 리렌더가 줄지 않는다. 억제는 **같은 참조**가 한다.
  selectTables: (tableIds) => set(
    tableIds.length === 0
      ? { selectedTableIds: NO_TABLES }
      : { ...CLEARED_SELECTION, selectedTableIds: [...tableIds] }),
```

```ts
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableIds: [id] }),
```

`resync`의 테이블 갈래:

```ts
  resync: (model, seq) => set((s) => {
    const keep = (id: string | null, rec: Record<string, unknown>) =>
      (id !== null && Object.hasOwn(rec, id) ? id : null)
    // 전부 살아남았으면 **원래 배열 참조를 그대로** 반환한다(리렌더 억제).
    // 전부 사라졌으면 새 빈 배열이 아니라 **빈 선택의 공유 참조**(NO_TABLES)를 쓴다 —
    // "모든 빈 선택은 같은 인스턴스"라는 불변식이 이 경로에서만 깨지면 안 된다.
    const keptTables = s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id))
    return {
      model, seq, loaded: true, undoStack: [], redoStack: [],
      selectedTableIds: keptTables.length === s.selectedTableIds.length
        ? s.selectedTableIds
        : keptTables.length === 0 ? NO_TABLES : keptTables,
      selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
      selectedNoteId: keep(s.selectedNoteId, model.notes),
      selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
    }
  }),
```

`reset`의 스프레드는 `...CLEARED_SELECTION`이라 자동으로 따라온다.

- [ ] **Step 4: store 테스트 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/store.test.ts`
Expected: PASS (8건 추가)

- [ ] **Step 5: 프로덕션 사용처 5곳을 주 선택으로 치환한다**

동작이 바뀌면 안 된다. 전부 "주 선택 하나"를 읽는 것으로 그대로 옮긴다.

`canvas.tsx:33`:
```ts
  const selectedId = useEditorStore(primaryTableId)
```

`edit-panel.tsx:49`:
```ts
  const selectedTableId = useEditorStore(primaryTableId)
```

`table-tree.tsx:15`:
```ts
  const selectedTableId = useEditorStore(primaryTableId)
```

`toolbar.tsx:19`:
```ts
  const selectedTableId = useEditorStore(primaryTableId)
```

네 파일 모두 import에 `primaryTableId`를 추가한다(`import { primaryTableId, useEditorStore } from './store.js'`).

`use-realtime.ts` — `SelectionSource`와 `selectionsOf`, `selectionImpact`를 다중으로 넓힌다:

```ts
type SelectionSource = {
  selectedTableIds: readonly string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
}

/** 스토어 선택 상태를 프로토콜의 selections 배열로 좁힌다. 테이블은 여러 건일 수 있다. */
function selectionsOf(s: SelectionSource): PeerSelection[] {
  if (s.selectedTableIds.length > 0) {
    return s.selectedTableIds.map((id) => ({ kind: 'table' as const, id }))
  }
  if (s.selectedRelationshipId !== null) return [{ kind: 'relationship', id: s.selectedRelationshipId }]
  if (s.selectedNoteId !== null) return [{ kind: 'note', id: s.selectedNoteId }]
  if (s.selectedGroupId !== null) return [{ kind: 'group', id: s.selectedGroupId }]
  return []
}
```

```ts
export function selectionImpact(
  model: ProjectModel,
  ops: readonly Op[],
  selected: { tableIds: readonly string[]; relationshipId: string | null; noteId: string | null },
): SelectionImpact {
  const tableIds = new Set(selected.tableIds)
  const targets = new Set<string>(tableIds)
  if (selected.relationshipId !== null) targets.add(selected.relationshipId)
  if (selected.noteId !== null) targets.add(selected.noteId)
  if (targets.size === 0) return null
  let impact: SelectionImpact = null
  for (const op of ops) {
    if (targets.has(op.entityId)) {
      if (op.action === 'delete') return 'deleted'
      impact = 'changed'
      continue
    }
    if (tableIds.size > 0 && (op.entity === 'column' || op.entity === 'index')) {
      const owner = op.action === 'create'
        ? (op.data as { tableId?: unknown }).tableId
        : op.entity === 'column'
          ? model.columns[op.entityId]?.tableId
          : model.indexes[op.entityId]?.tableId
      if (typeof owner === 'string' && tableIds.has(owner)) impact = 'changed'
    }
  }
  return impact
}
```

124행의 호출부:
```ts
      const impact = selectionImpact(s.model, msg.ops, {
        tableIds: s.selectedTableIds,
        relationshipId: s.selectedRelationshipId,
        noteId: s.selectedNoteId,
      })
```

- [ ] **Step 6: 단언을 쓰는 테스트를 고친다**

`selectedTableId`를 단언하는 7파일을 `selectedTableIds`로 옮긴다. 패턴은 둘뿐이다.

```ts
// 전: expect(useEditorStore.getState().selectedTableId).toBe('t2')
expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])

// 전: expect(st.selectedTableId).toBeNull()
expect(st.selectedTableIds).toEqual([])
```

대상: `table-tree.test.tsx:55` · `snapshot-diff.test.tsx:77,94` · `naming-check.test.tsx:31,59` ·
`relationship-panel.test.tsx:86` · `undo-redo.test.tsx:32,44,56` · `group-view.test.tsx:20`.

`use-realtime.test.tsx`의 `selectionImpact` 호출부는 `none`과 인자 모양이 바뀐다:

```ts
const none = { tableIds: [] as string[], relationshipId: null, noteId: null }
// ...
expect(selectionImpact(m, [op], { ...none, tableIds: [NOTE_A] })).toBe('changed')
```

(121·136행이 `tableId: NOTE_A`를 쓰고 있다 — 둘 다 `tableIds: [NOTE_A]`로.)

그리고 다중 선택에서의 판정을 잠그는 테스트를 추가한다:

```ts
  it('선택이 여러 건이면 그중 하나만 걸려도 changed다', () => {
    const m = buildSampleModel()
    const op: Op = { action: 'update', entity: 'table', entityId: 't2', data: { logicalName: 'X' } }
    expect(selectionImpact(m, [op], { ...none, tableIds: ['t1', 't2'] })).toBe('changed')
  })

  it('선택이 여러 건이어도 삭제가 수정을 이긴다', () => {
    const m = buildSampleModel()
    const upd: Op = { action: 'update', entity: 'table', entityId: 't1', data: { logicalName: 'X' } }
    const del: Op = { action: 'delete', entity: 'table', entityId: 't2', data: {} }
    expect(selectionImpact(m, [upd, del], { ...none, tableIds: ['t1', 't2'] })).toBe('deleted')
  })
```

> ⚠️ 이 파일의 기존 op 헬퍼(`noteOp` 등)와 import를 확인하고 맞춰라. `Op` 리터럴의 `data` 모양이
> 파일의 다른 케이스와 다르면 **그 파일의 관례를 따르고 무엇이 달랐는지 보고하라.**

- [ ] **Step 7: 전체 웹 스위트와 typecheck를 확인한다**

Run:
```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: PASS · EXIT=0. 동작이 안 바뀌었으므로 **기존 테스트는 단언 형태만 바뀌고 전부 통과해야
한다.** 어느 하나라도 의미가 바뀌어 실패하면 멈추고 보고하라.

- [ ] **Step 8: 구분력을 확인한다**

두 가지를 실증한다. **되돌리기는 스크래치에 백업해 둔 사본을 복사해서 하라** — 커밋 전 변경에
`git checkout -- <경로>`를 쓰면 작업이 통째로 날아간다. 복구 후 `diff`로 동일함을 확인한다.

(a) `resync`의 테이블 갈래를 `selectedTableIds: keptTables` 한 줄로 되돌린다(항상 새 배열이 되고,
빈 선택도 공유 참조가 아니게 된다). resync의 참조 테스트 **두 건이 함께 실패**해야 한다 — 전부
살아남는 경우(`toBe(before)`)와 전부 사라지는 경우(`toBe(빈 선택의 공유 참조)`)다. 한쪽만 실패하면
멈추고 보고하라.

전부 사라지는 쪽은 이렇게 나온다(값이 아니라 **참조**가 다르다는 실패라 메시지가 헷갈린다):

```
AssertionError: expected [] to be [] // Object.is equality
```

(b) `primaryTableId`에 변형 호출을 임시로 끼워 넣어(`s.selectedTableIds.sort().at(-1)`) **web
typecheck가 실제로 막는지** 본다. `readonly string[]`가 아니면 이것이 EXIT=0으로 통과한다.

```bash
pnpm --filter @erdd/web exec tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=1` 과 `error TS2339: Property 'sort' does not exist on type 'readonly string[]'`.

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/store.test.ts \
  apps/web/src/editor/canvas.tsx apps/web/src/editor/edit-panel.tsx \
  apps/web/src/editor/table-tree.tsx apps/web/src/editor/toolbar.tsx \
  apps/web/src/editor/use-realtime.ts apps/web/src/editor/use-realtime.test.tsx \
  apps/web/src/editor/table-tree.test.tsx apps/web/src/editor/snapshot-diff.test.tsx \
  apps/web/src/editor/naming-check.test.tsx apps/web/src/editor/relationship-panel.test.tsx \
  apps/web/src/editor/undo-redo.test.tsx apps/web/src/editor/group-view.test.tsx \
&& git commit -m "feat: 에디터 선택 상태를 테이블 배열로 넓힌다

selectedTableId(단건)를 selectedTableIds(배열, 마지막이 주 선택)로 바꾸고
toggleTable·selectTables를 더한다. 기존 사용처는 primaryTableId 셀렉터로
치환해 동작은 그대로다 — 다중 선택 제스처는 다음 태스크에서 얹는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: `tableBounds` · `planGroupMove` (좌표 재배치 순수 함수)

아직 아무도 부르지 않는 순수 함수를 먼저 만든다. UI 없이 계산만 잠근다.

**Files:**
- Create: `apps/web/src/editor/group-move.ts`
- Create: `apps/web/src/editor/group-move.test.ts`
- Modify: `apps/web/src/editor/group-nodes.ts` (bbox 계산을 `tableBounds`로 교체)

**Interfaces:**
- Consumes: 없음(core의 `ProjectModel`·`Table`·`Position` 타입만)
- Produces:
  - `tableBounds(model: ProjectModel, tables: readonly Table[]): Bounds | null`
    (`type Bounds = { minX: number; minY: number; maxX: number; maxY: number }`)
  - `planGroupMove(model, tableIds: readonly string[], targetGroupId: string | null): { id: string; position: Position }[]`
  - `EST_W`·`estHeight`·`GROUP_PAD`는 이 파일에서 export한다(`group-nodes.ts`가 import)

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/group-move.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel, type Table } from '@erdd/core'
import { planGroupMove, tableBounds } from './group-move.js'

/** 컬럼 0개인 테이블. estHeight(0) = 44 + 1*28 = 72, 폭은 EST_W = 260. */
function tbl(id: string, groupId: string | null, x: number, y: number): Table {
  return {
    id, logicalName: id, physicalName: id.toUpperCase(), comment: null,
    groupId, position: { x, y }, groupPosition: null, custom: {},
  }
}

function modelWith(tables: Table[], groupIds: string[]): ProjectModel {
  const m = createEmptyModel()
  for (const g of groupIds) m.tableGroups[g] = { id: g, name: g, color: '#fff', comment: null }
  for (const t of tables) m.tables[t.id] = t
  return m
}

describe('tableBounds', () => {
  it('빈 목록이면 null이다', () => {
    expect(tableBounds(createEmptyModel(), [])).toBeNull()
  })

  it('컬럼 0개 테이블 하나의 bbox는 위치 + (260, 72)다', () => {
    const t = tbl('a', null, 100, 50)
    expect(tableBounds(modelWith([t], []), [t])).toEqual({ minX: 100, minY: 50, maxX: 360, maxY: 122 })
  })
})

describe('planGroupMove', () => {
  it('대상 그룹 오른쪽으로 옮기고 상대 배치를 보존한다', () => {
    // 대상 그룹 gB: (0,0) 한 개 → bbox maxX = 260
    // 이동 대상 a1(500,100)·a2(600,200) → 집합 minX=500, minY=100
    // delta.x = 260 + 60 - 500 = -180 · delta.y = 0 - 100 = -100
    const model = modelWith(
      [tbl('b1', 'gB', 0, 0), tbl('a1', 'gA', 500, 100), tbl('a2', 'gA', 600, 200)],
      ['gA', 'gB'],
    )
    const moves = planGroupMove(model, ['a1', 'a2'], 'gB')
    expect(moves).toEqual([
      { id: 'a1', position: { x: 320, y: 0 } },
      { id: 'a2', position: { x: 420, y: 100 } },
    ])
    // 상대 배치 보존: 이동 전 (100, 100) 차이가 그대로다.
    const [m1, m2] = moves
    expect(m2!.position.x - m1!.position.x).toBe(100)
    expect(m2!.position.y - m1!.position.y).toBe(100)
    // 대상 그룹 bbox 오른쪽에 있다.
    expect(m1!.position.x).toBeGreaterThan(260)
  })

  it('대상 그룹에 멤버가 없으면 좌표를 건드리지 않는다(기준으로 삼을 영역이 없다)', () => {
    const model = modelWith([tbl('a1', 'gA', 500, 100)], ['gA', 'gEmpty'])
    expect(planGroupMove(model, ['a1'], 'gEmpty')).toEqual([])
  })

  it('미분류로 옮기면 좌표를 건드리지 않는다', () => {
    const model = modelWith([tbl('b1', 'gB', 0, 0), tbl('a1', 'gA', 500, 100)], ['gA', 'gB'])
    expect(planGroupMove(model, ['a1'], null)).toEqual([])
  })

  it('이동 대상은 대상 그룹의 기준 bbox에서 제외한다', () => {
    // a1이 이미 gB 소속인 채로 들어와도(그룹 변경 후 모델을 잘못 넘긴 경우)
    // 자기 자신을 기준으로 삼지 않아야 한다.
    const model = modelWith([tbl('b1', 'gB', 0, 0), tbl('a1', 'gB', 500, 100)], ['gB'])
    const moves = planGroupMove(model, ['a1'], 'gB')
    expect(moves).toEqual([{ id: 'a1', position: { x: 320, y: 0 } }])
  })

  it('모델에 없는 id는 조용히 무시한다', () => {
    const model = modelWith([tbl('b1', 'gB', 0, 0)], ['gB'])
    expect(planGroupMove(model, ['없는id'], 'gB')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/group-move.test.ts`
Expected: FAIL — `group-move.js`가 없다.

- [ ] **Step 3: `group-move.ts`를 만든다**

```ts
import type { Position, ProjectModel, Table } from '@erdd/core'

/** 테이블 노드 폭 추정치. 실측 bbox가 없어 렌더 상수를 쓴다(group-nodes와 공유). */
export const EST_W = 260
/** 그룹 영역이 멤버 bbox 바깥으로 두는 여백. */
export const GROUP_PAD = 28
/** 대상 그룹과 새로 들어오는 테이블 사이 간격. */
const GAP = 60

export function estHeight(colCount: number): number {
  return 44 + Math.max(1, colCount) * 28
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** 테이블 목록이 차지하는 사각형. 빈 목록이면 null. */
export function tableBounds(model: ProjectModel, tables: readonly Table[]): Bounds | null {
  if (tables.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of tables) {
    const cols = Object.values(model.columns).filter((c) => c.tableId === t.id).length
    minX = Math.min(minX, t.position.x)
    minY = Math.min(minY, t.position.y)
    maxX = Math.max(maxX, t.position.x + EST_W)
    maxY = Math.max(maxY, t.position.y + estHeight(cols))
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 그룹을 옮긴 테이블들의 새 좌표. 상대 배치를 유지한 채 대상 그룹 영역 오른쪽으로 평행이동한다.
 *
 * 좌표를 건드리지 않는 두 경우는 **빈 배열**을 반환한다 — 대상이 미분류이거나, 대상 그룹에 기존
 * 멤버가 없을 때다. 기준으로 삼을 영역이 없는데 억지로 옮기면 결과가 예측 불가능해진다.
 *
 * ⚠️ `model`은 **그룹 변경 전** 모델이어야 한다. 변경 후 모델을 넘기면 이동 대상이 이미 대상 그룹의
 * 멤버라 자기 자신이 기준 bbox에 섞인다(그 경우에도 방어하지만, 호출자가 순서를 지켜야 한다).
 * 계산하는 것은 언제나 **전체 뷰 좌표(`position`)**다. 그룹 뷰에서 드롭해도 마찬가지다 — 그 테이블은
 * 다른 그룹 소속이 되어 현재 뷰에서 사라지므로, 재배치 결과는 전체 뷰로 나가야 보인다.
 */
export function planGroupMove(
  model: ProjectModel, tableIds: readonly string[], targetGroupId: string | null,
): { id: string; position: Position }[] {
  if (targetGroupId === null) return []
  const moving = tableIds.map((id) => model.tables[id]).filter((t): t is Table => t !== undefined)
  if (moving.length === 0) return []

  const movingIds = new Set(moving.map((t) => t.id))
  const anchors = Object.values(model.tables)
    .filter((t) => t.groupId === targetGroupId && !movingIds.has(t.id))
  const target = tableBounds(model, anchors)
  if (target === null) return []

  const src = tableBounds(model, moving)!
  const dx = target.maxX + GAP - src.minX
  const dy = target.minY - src.minY
  return moving.map((t) => ({ id: t.id, position: { x: t.position.x + dx, y: t.position.y + dy } }))
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/group-move.test.ts`
Expected: PASS (7건)

- [ ] **Step 5: `group-nodes.ts`가 같은 계산을 쓰게 한다**

중복된 bbox 로직을 지우고 `tableBounds`를 쓴다:

```ts
import type { Node } from '@xyflow/react'
import type { ProjectModel, TableGroup } from '@erdd/core'
import { GROUP_PAD, tableBounds } from './group-move.js'

export type GroupNodeData = { group: TableGroup; selected: boolean }

export function buildGroupNodes(
  model: ProjectModel, selectedGroupId: string | null, canEdit: boolean,
): Node<GroupNodeData>[] {
  const nodes: Node<GroupNodeData>[] = []
  for (const group of Object.values(model.tableGroups)) {
    const members = Object.values(model.tables).filter((t) => t.groupId === group.id)
    const b = tableBounds(model, members)
    if (b === null) continue
    nodes.push({
      id: `group:${group.id}`,
      type: 'group',
      position: { x: b.minX - GROUP_PAD, y: b.minY - GROUP_PAD },
      width: b.maxX - b.minX + GROUP_PAD * 2,
      height: b.maxY - b.minY + GROUP_PAD * 2,
      selectable: false,
      draggable: canEdit,
      zIndex: 0,
      data: { group, selected: group.id === selectedGroupId },
    })
  }
  return nodes
}
```

- [ ] **Step 6: 기존 group-nodes 테스트가 그대로 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/group-nodes.test.ts`
Expected: PASS — 리팩터이므로 값이 바뀌면 안 된다. 값이 달라지면 **멈추고 보고하라**(옛 코드와 새
`tableBounds`의 계산이 어디서 갈리는지가 중요한 정보다).

- [ ] **Step 7: 구분력을 확인한다**

`planGroupMove`의 `!movingIds.has(t.id)` 필터를 지우고 "이동 대상을 기준에서 제외한다" 테스트가
실패하는지 보고 복구한다.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/group-move.ts apps/web/src/editor/group-move.test.ts \
  apps/web/src/editor/group-nodes.ts \
&& git commit -m "feat: 그룹 이동 좌표 재배치 순수 함수

planGroupMove 는 상대 배치를 유지한 채 대상 그룹 오른쪽으로 평행이동한다.
미분류이거나 대상 그룹이 비어 있으면 좌표를 건드리지 않는다. bbox 계산을
tableBounds 로 뽑아 group-nodes 와 공유한다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: 사이드바 다중 선택 제스처

**Files:**
- Modify: `apps/web/src/editor/table-tree.tsx`
- Modify: `apps/web/src/editor/table-tree.test.tsx`

**Interfaces:**
- Consumes: `toggleTable`·`selectTables`·`primaryTableId` (Task 2)
- Produces: `TableItem`의 `onClick`이 `(e: ReactMouseEvent) => void`로 바뀐다(파일 내부)

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/table-tree.test.tsx`에 추가. 트리 정렬은 `physicalName.localeCompare`이므로
`buildSampleModel()`에서는 **MBR(t2) → MBR_GRD(t1)** 순으로 보인다.

```ts
  it('Cmd+클릭은 선택을 토글한다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])

    await userEvent.keyboard('{Meta>}')
    await userEvent.click(screen.getByText('MBR_GRD'))
    await userEvent.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('Cmd+클릭으로 이미 선택된 것을 다시 누르면 빠진다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()
    await userEvent.keyboard('{Meta>}')
    await userEvent.click(screen.getByText('MBR'))
    await userEvent.keyboard('{/Meta}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })

  it('Shift+클릭은 화면에 보이는 트리 순서로 범위를 잡는다', async () => {
    // 표시 순서: MBR(t2) → MBR_GRD(t1). 주 선택이 t2일 때 t1을 Shift+클릭하면 둘 다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByText('MBR_GRD'))
    await userEvent.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
  })

  it('검색으로 걸러진 항목은 Shift 범위에 들어가지 않는다', async () => {
    // 테이블 3개(MBR·MBR_GRD·ORD) 중 "MBR"로 걸러 둘만 보이게 한 뒤 범위를 잡는다.
    const model = buildSampleModel()
    model.tables = {
      ...model.tables,
      t3: {
        id: 't3', logicalName: '주문', physicalName: 'ORD', comment: null,
        groupId: 'g1', position: { x: 0, y: 400 }, groupPosition: null, custom: {},
      },
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    renderTree()
    await userEvent.type(screen.getByPlaceholderText('테이블 검색'), 'MBR')
    await userEvent.click(screen.getByText('MBR'))
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByText('MBR_GRD'))
    await userEvent.keyboard('{/Shift}')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2', 't1'])
    expect(useEditorStore.getState().selectedTableIds).not.toContain('t3')
  })

  it('수식키 없는 클릭은 단일 선택으로 되돌리고 캔버스 포커스를 요청한다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderTree()
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/table-tree.test.tsx`
Expected: FAIL — 수식키를 무시하고 항상 `focus()`를 부른다.

- [ ] **Step 3: `table-tree.tsx`를 고친다**

훅 부분에 추가:

```ts
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const primaryId = useEditorStore(primaryTableId)
  const toggleTable = useEditorStore((s) => s.toggleTable)
  const selectTables = useEditorStore((s) => s.selectTables)
```

(`selectedTableId` 지역 변수는 지우고 아래 `selected` 판정을 집합으로 바꾼다.)

`unassigned`/`visibleGroups` 계산 뒤에 표시 순서를 만든다:

```ts
  // Shift 범위 선택의 기준 = **화면에 보이는 순서**. 검색으로 걸러진 항목은 여기 없다.
  const orderedIds = [
    ...visibleGroups.flatMap((g) => allTables.filter((t) => t.groupId === g.id).map((t) => t.id)),
    ...(showUnassigned ? unassigned.map((t) => t.id) : []),
  ]
  const selectedIds = new Set(selectedTableIds)

  const onItemClick = (e: ReactMouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) { toggleTable(id); return }
    if (e.shiftKey && primaryId !== null) {
      const a = orderedIds.indexOf(primaryId)
      const b = orderedIds.indexOf(id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        selectTables(orderedIds.slice(lo, hi + 1))
        return
      }
    }
    focus(id)
  }
```

import에 추가:

```ts
import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { primaryTableId, useEditorStore } from './store.js'
```

두 곳의 `TableItem` 렌더를 바꾼다:

```tsx
{members.map((t) => (
  <TableItem key={t.id} t={t} selected={selectedIds.has(t.id)} onClick={(e) => onItemClick(e, t.id)} />
))}
```
```tsx
{unassigned.map((t) => (
  <TableItem key={t.id} t={t} selected={selectedIds.has(t.id)} onClick={(e) => onItemClick(e, t.id)} />
))}
```

`TableItem` 시그니처:

```tsx
function TableItem({ t, selected, onClick }: {
  t: { id: string; physicalName: string; logicalName: string }
  selected: boolean
  onClick: (e: ReactMouseEvent) => void
}) {
  return (
    <li>
      <button type="button" onClick={onClick}
        className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent', selected && 'bg-accent')}>
        <span className="font-mono text-xs font-medium">{t.physicalName}</span>
        <span className="text-xs text-muted-foreground">{t.logicalName}</span>
      </button>
    </li>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/table-tree.test.tsx`
Expected: PASS (기존 7건 + 새 5건)

- [ ] **Step 5: 구분력을 확인한다**

`orderedIds`를 `allTables.map((t) => t.id)`(검색·그룹 스코핑 무시)로 바꿔 "검색으로 걸러진 항목은
범위에 들어가지 않는다"가 실패하는지 보고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/table-tree.tsx apps/web/src/editor/table-tree.test.tsx \
&& git commit -m "feat: 사이드바 다중 선택 제스처

Cmd/Ctrl+클릭 토글, Shift+클릭 범위 선택을 더한다. 범위 기준은 정렬 배열이
아니라 **화면에 보이는 트리 순서**라, 검색으로 걸러졌거나 그룹 뷰 밖인
테이블은 범위에 끌려 들어오지 않는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: 캔버스 ↔ store 선택 동기화

**Files:**
- Modify: `apps/web/src/editor/nodes.ts`
- Modify: `apps/web/src/editor/canvas.tsx`
- Modify: `apps/web/src/editor/canvas.test.tsx`
- Modify: `apps/web/src/editor/nodes.test.ts`(있다면 — 없으면 만들지 않는다)

**Interfaces:**
- Consumes: `selectTables`(Task 2)
- Produces: `buildNodes(model, viewMode, selectedIds: ReadonlySet<string>, warnings, view?, peerMarks?)`

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/canvas.test.tsx`에 추가(파일의 `renderCanvas`·`lastProps` 헬퍼를 쓴다):

```ts
  it('store에 여러 테이블이 선택되면 해당 노드가 모두 selected로 넘어간다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t1', 't2'])
    await waitFor(() => {
      const nodes = lastProps().nodes as { id: string; type?: string; selected?: boolean }[]
      const tables = nodes.filter((n) => n.type === 'table')
      expect(tables.every((n) => n.selected)).toBe(true)
      expect(tables).toHaveLength(2)
    })
  })

  it('onSelectionChange가 같은 집합을 다시 알리면 store를 갱신하지 않는다', async () => {
    // 가드가 없으면 derived 재생성 → onSelectionChange → setState 무한 루프가 된다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    useEditorStore.getState().selectTables(['t1', 't2'])
    await waitFor(() => expect(lastProps().nodes).toBeDefined())
    const before = useEditorStore.getState().selectedTableIds

    const onSelectionChange = lastProps().onSelectionChange as (p: { nodes: { id: string; type: string }[] }) => void
    // 순서만 다른 같은 집합.
    onSelectionChange({ nodes: [{ id: 't2', type: 'table' }, { id: 't1', type: 'table' }] })
    expect(useEditorStore.getState().selectedTableIds).toBe(before)   // 참조까지 그대로
  })

  it('onSelectionChange는 테이블 노드만 본다(메모는 무시)', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    const onSelectionChange = lastProps().onSelectionChange as (p: { nodes: { id: string; type: string }[] }) => void
    onSelectionChange({ nodes: [{ id: 't1', type: 'table' }, { id: 'n1', type: 'note' }] })
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t1'])
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/canvas.test.tsx`
Expected: FAIL — `onSelectionChange`가 ReactFlow에 넘어가지 않고, 노드에 `selected` 속성이 없다.

- [ ] **Step 3: `nodes.ts`를 집합 기반으로 바꾼다**

```ts
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: ReadonlySet<string>, warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
): Node<TableNodeData>[] {
```

`return` 객체에서:

```ts
    const isSelected = selectedIds.has(table.id)
    return {
      id: table.id,
      type: 'table',
      position,
      // ReactFlow 내부 선택과 store를 맞춘다 — 박스 선택이 이 값을 읽고 쓴다.
      selected: isSelected,
      data: {
        table,
        columns: tableCols,
        viewMode,
        selected: isSelected,
        tableWarnings,
        columnWarnings,
        peers: peerMarks.get(table.id),
      },
    }
```

- [ ] **Step 4: `canvas.tsx`를 고친다**

훅 부분:

```ts
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const selectedIds = useMemo(() => new Set(selectedTableIds), [selectedTableIds])
```

(`const selectedId = useEditorStore(primaryTableId)` 줄은 지운다. **Task 2에서 넣은 `primaryTableId`
import도 이 파일에서는 쓰이지 않게 되므로 함께 지운다.** `select`는 `onPaneClick`·그룹 노드 클릭에서
계속 쓰므로 남긴다.)

`derived` useMemo에서 `buildNodes(model, viewMode, selectedIds, warnings, view, peerMarks)`로 바꾸고,
의존성 배열의 `selectedId`를 `selectedIds`로 교체한다.

`onNodeClick`에서 **테이블 분기를 없앤다**:

```tsx
        onNodeClick={(_, node) => {
          if (node.type === 'ghost') return
          if (node.type === 'group') { select(null); return } // 빈 영역 클릭 = 선택 해제
          if (node.type === 'note') selectNote(node.id)
          // 테이블 선택은 onSelectionChange 한 곳에서만 처리한다 — 창구가 둘이면
          // Cmd+클릭 한 번에 ReactFlow 내부 토글과 우리 토글이 겹쳐 서로를 되돌린다.
        }}
```

`onSelectionChange`를 더한다(`useCallback`으로 감싸 참조를 고정한다):

```tsx
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    const ids = sel.filter((n) => n.type === 'table').map((n) => n.id)
    const cur = useEditorStore.getState().selectedTableIds
    // 같은 집합이면 아무것도 하지 않는다 — 이 가드가 없으면
    // derived 재생성 → onSelectionChange → setState 의 무한 루프가 된다.
    if (ids.length === cur.length && ids.every((id) => cur.includes(id))) return
    useEditorStore.getState().selectTables(ids)
  }, [])
```

ReactFlow에 넘긴다:

```tsx
        onSelectionChange={onSelectionChange}
```

import에 `useCallback`을 추가한다.

- [ ] **Step 5: 통과를 확인하고, 기존 캔버스 테스트를 살핀다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/canvas.test.tsx`
Expected: PASS.

⚠️ 기존 "onNodeClick이 store 선택을 바꾼다" 계열 테스트가 깨질 수 있다. 그 테스트들은 ReactFlow
내장 키보드 선택(Enter)을 쓰므로 `onSelectionChange` 경로로도 같은 결과가 나야 한다. **깨지면
프로덕션을 기대값에 맞추지 말고, 무엇이 어떤 값으로 관찰됐는지와 원인 진단을 보고하라.**

- [ ] **Step 6: 전체 웹 스위트를 돌린다**

Run: `pnpm --filter @erdd/web exec vitest run`
Expected: PASS

- [ ] **Step 7: 구분력을 확인한다**

`onSelectionChange`의 루프 가드(`if (ids.length === cur.length && ...) return`)를 지우고 해당 테스트가
실패하는지 보고 복구한다. **무한 루프로 테스트가 멈추면 그 사실 자체가 관찰 결과다 — 그렇게 보고하라.**

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/nodes.ts apps/web/src/editor/canvas.tsx apps/web/src/editor/canvas.test.tsx \
&& git commit -m "feat: 캔버스 선택을 store 다중 선택과 동기화한다

buildNodes 가 선택 집합을 받아 노드의 selected 속성을 세우고, ReactFlow →
store 는 onSelectionChange 한 창구로만 흐른다(onNodeClick 의 테이블 분기 제거).
같은 집합이면 갱신하지 않는 가드가 재생성 루프를 막는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: 일괄 작업 패널 (그룹 이동 · 일괄 삭제)

**Files:**
- Create: `apps/web/src/editor/bulk-panel.tsx`
- Create: `apps/web/src/editor/bulk-panel.test.tsx`
- Modify: `apps/web/src/editor/model-edits.ts` (`clearTableGroupPosition` 추가)
- Modify: `apps/web/src/editor/model-edits.test.ts`
- Modify: `apps/web/src/editor/edit-panel.tsx` (2개 이상이면 `BulkPanel`로 분기)
- Modify: `apps/web/src/editor/toolbar.tsx` (삭제 버튼이 다중이면 같은 확인 경로)

**Interfaces:**
- Consumes: `planGroupMove`(Task 3) · `selectedTableIds`(Task 2)
- Produces:
  - `<BulkPanel projectId={string} />`
  - `<BulkDeleteDialog projectId ids open onOpenChange />` — 툴바와 공유하는 확인 다이얼로그
  - `applyGroupMove(mutate: Mutate, ids: readonly string[], targetGroupId: string | null): void`
    — 이 파일에서 export(툴바·사이드바 드래그·캔버스 드래그가 공유)
  - `countCascade(model, ids): { tables: number; columns: number; indexes: number; relationships: number }`

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/bulk-panel.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { BulkPanel, countCascade } from './bulk-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000dd'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<BulkPanel projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('countCascade', () => {
  it('테이블과 함께 사라지는 컬럼·인덱스·관계를 센다', () => {
    // buildSampleModel: t2(MBR)는 컬럼 3개(c2·c3·c4) · 인덱스 1개(i1) · 관계 1개(r1, t1↔t2)
    const m = buildSampleModel()
    expect(countCascade(m, ['t2'])).toEqual({ tables: 1, columns: 3, indexes: 1, relationships: 1 })
  })

  it('두 테이블이 같은 관계의 양끝이어도 관계는 한 번만 센다', () => {
    const m = buildSampleModel()
    expect(countCascade(m, ['t1', 't2']).relationships).toBe(1)
  })
})

describe('BulkPanel', () => {
  it('선택 개수와 목록을 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()
    expect(screen.getByText('2개 테이블 선택됨')).toBeInTheDocument()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
  })

  it('그룹 드롭다운으로 옮기면 op 배치 한 건으로 나간다(undo 1회)', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupId).toBe('g2')
      expect(tables['t2']?.groupId).toBe('g2')
    })
    expect(calls).toHaveLength(1)   // 단일 뮤테이션 = Revision 1건
  })

  it('그룹을 옮기면 그룹 뷰 좌표를 비운다 — 이전 그룹의 좌표는 새 그룹에서 의미가 없다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(model.tables['t1']?.groupPosition).not.toBeNull()
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupPosition).toBeNull()
      expect(tables['t2']?.groupPosition).toBeNull()
    })
  })

  it('일괄 삭제는 확인 다이얼로그를 거친다 — 취소하면 아무 op도 나가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    expect(screen.getByText(/테이블 2개와 관계 1개가 삭제됩니다/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(calls).toHaveLength(0)
    expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(2)
  })

  it('확인하면 선택한 테이블이 한 번에 지워진다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => {
      expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(0)
    })
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('읽기 전용이면 이동·삭제 컨트롤이 비활성이다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer.
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()
    expect(screen.getByLabelText('선택 테이블의 그룹')).toBeDisabled()
    expect(screen.getByRole('button', { name: '선택 테이블 삭제' })).toBeDisabled()
  })
})
```

> ⚠️ `mockTrpcFetch`의 콜백 시그니처를 `apps/web/src/testing/trpc-mock.ts`에서 확인하고 맞춰라.
> 위 코드는 `(input) => ({ data: ... })` 형태를 가정한다. 다르면 **파일의 실제 시그니처를 따르고
> 무엇이 달랐는지 보고하라.**

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/bulk-panel.test.tsx`
Expected: FAIL — `bulk-panel.js`가 없다.

- [ ] **Step 3: `clearTableGroupPosition`을 더한다**

`updateTable`의 patch 타입은 `Partial<Pick<Table, 'logicalName' | 'physicalName' | 'comment'>>`라
`groupPosition`을 받지 못한다. 그 좁은 계약을 넓히는 대신 `moveTableGroupPosition`과 대칭인 전용
함수를 만든다.

`apps/web/src/editor/model-edits.ts`에 추가:

```ts
/** 그룹이 바뀌면 이전 그룹 뷰 좌표는 의미가 없다 — 전체 뷰 좌표로 폴백하도록 비운다. */
export function clearTableGroupPosition(model: ProjectModel, id: string): ProjectModel {
  const table = model.tables[id]
  if (!table || table.groupPosition === null) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, groupPosition: null } } }
}
```

`apps/web/src/editor/model-edits.test.ts`에 추가:

```ts
describe('clearTableGroupPosition', () => {
  it('그룹 뷰 좌표를 null로 비운다', () => {
    const m = buildSampleModel()   // t1.groupPosition = { x: 10, y: 10 }
    expect(clearTableGroupPosition(m, 't1').tables['t1']?.groupPosition).toBeNull()
  })

  it('이미 null이면 모델 참조를 그대로 돌려준다', () => {
    const m = clearTableGroupPosition(buildSampleModel(), 't1')
    expect(clearTableGroupPosition(m, 't1')).toBe(m)
  })

  it('없는 id는 무시한다', () => {
    const m = buildSampleModel()
    expect(clearTableGroupPosition(m, '없는id')).toBe(m)
  })
})
```

> ⚠️ 이 파일의 기존 import·`describe` 관례를 확인해 맞춰라.

- [ ] **Step 4: `bulk-panel.tsx`를 만든다**

```tsx
import { useState } from 'react'
import { deleteTableCascade, setTableGroup, type ProjectModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { clearTableGroupPosition, moveTable } from './model-edits.js'
import { planGroupMove } from './group-move.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Mutate = ReturnType<typeof useModelMutation>

/** 삭제로 함께 사라지는 것들의 수. 관계는 양끝이 모두 선택돼 있어도 한 번만 센다. */
export function countCascade(model: ProjectModel, ids: readonly string[]): {
  tables: number; columns: number; indexes: number; relationships: number
} {
  const set = new Set(ids.filter((id) => Object.hasOwn(model.tables, id)))
  return {
    tables: set.size,
    columns: Object.values(model.columns).filter((c) => set.has(c.tableId)).length,
    indexes: Object.values(model.indexes).filter((ix) => set.has(ix.tableId)).length,
    relationships: Object.values(model.relationships)
      .filter((r) => set.has(r.parentTableId) || set.has(r.childTableId)).length,
  }
}

/**
 * 그룹 배정과 좌표 재배치를 **한 producer**에 담는다 — Revision 1건, undo 1회.
 *
 * ⚠️ `planGroupMove`에는 **그룹 변경 전** 모델(`m`)을 넘긴다. 변경 후 모델(`next`)을 넘기면 이동
 * 대상이 이미 대상 그룹 멤버라 자기 자신이 기준 bbox에 섞인다.
 *
 * ⚠️ `groupPosition`을 null로 되돌린다. 테이블은 좌표를 둘 갖는데(전체 뷰 `position`, 그룹 뷰 전용
 * `groupPosition`), 그룹이 바뀌면 이전 그룹 뷰에서 잡아 둔 좌표는 의미가 없다. null이면 `buildNodes`가
 * 전체 뷰 좌표로 폴백해 새 그룹의 그룹 뷰에서 자연스럽게 자리를 잡는다.
 */
export function applyGroupMove(
  mutate: Mutate, ids: readonly string[], targetGroupId: string | null,
): void {
  if (ids.length === 0) return
  void mutate((m) => {
    let next = m
    for (const id of ids) {
      next = setTableGroup(next, id, targetGroupId)
      next = clearTableGroupPosition(next, id)
    }
    for (const move of planGroupMove(m, ids, targetGroupId)) {
      next = moveTable(next, move.id, move.position)
    }
    return next
  }, { summary: `그룹 이동 (${ids.length}개)` })
}

/** 서버가 거절하기 전에 클라가 막는다(HANDOFF 3.2 — 낙관 반영 후 되돌려지는 것을 겪지 않게). */
const MAX_OPS = 5000

/**
 * 일괄 삭제 확인. **툴바와 일괄 패널이 함께 쓴다** — 복붙하면 문구·동작이 한쪽만 고쳐질 자리가 생긴다.
 */
export function BulkDeleteDialog({ projectId, ids, open, onOpenChange }: {
  projectId: string; ids: readonly string[]; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const select = useEditorStore((s) => s.select)
  const mutate = useModelMutation(projectId)
  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)
  const cascade = countCascade(model, ids)

  const onDelete = () => {
    const doomed = [...ids]
    select(null)
    onOpenChange(false)
    void mutate((m) => doomed.reduce((acc, id) => deleteTableCascade(acc, id), m),
      { summary: `테이블 삭제 (${doomed.length}개)` })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>선택한 테이블을 삭제할까요?</DialogTitle>
          <DialogDescription>
            테이블 {cascade.tables}개와 관계 {cascade.relationships}개가 삭제됩니다.
            컬럼 {cascade.columns}개와 인덱스 {cascade.indexes}개도 함께 사라집니다.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded border p-2">
          {tables.map((t) => (
            <li key={t.id} className="font-mono text-xs">{t.physicalName}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button variant="destructive" onClick={onDelete}>삭제</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BulkPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const ids = useEditorStore((s) => s.selectedTableIds)
  const mutate = useModelMutation(projectId)
  const [confirming, setConfirming] = useState(false)

  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)
  const cascade = countCascade(model, ids)
  const opCount = cascade.tables + cascade.columns + cascade.indexes + cascade.relationships
  const tooBig = opCount > MAX_OPS

  // 전원이 같은 그룹이면 그 값을 보여주고, 섞여 있으면 빈 값(= 안내 문구)을 보여준다.
  const groupIds = new Set(tables.map((t) => t.groupId))
  const commonGroup = groupIds.size === 1 ? [...groupIds][0] : undefined

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{ids.length}개 테이블 선택됨</h2>

      <ul className="mb-4 max-h-48 overflow-y-auto rounded border">
        {tables.map((t) => (
          <li key={t.id} className="flex items-baseline gap-2 px-2 py-1">
            <span className="font-mono text-xs font-medium">{t.physicalName}</span>
            <span className="truncate text-xs text-muted-foreground">{t.logicalName}</span>
          </li>
        ))}
      </ul>

      <div className="mb-4 grid gap-1.5">
        <Label htmlFor="bulk-group">소속 그룹</Label>
        <select id="bulk-group" aria-label="선택 테이블의 그룹"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={commonGroup === undefined ? '' : (commonGroup ?? '__none__')}
          disabled={!canEdit}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return
            applyGroupMove(mutate, ids, raw === '__none__' ? null : raw)
          }}>
          {commonGroup === undefined && <option value="">여러 그룹에 걸쳐 있음</option>}
          <option value="__none__">미분류</option>
          {Object.values(model.tableGroups).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <Button variant="destructive" className="w-full" disabled={!canEdit || tooBig}
        onClick={() => setConfirming(true)}>선택 테이블 삭제</Button>
      {tooBig && (
        <p className="mt-2 text-xs text-destructive">
          한 번에 지우기에 너무 많습니다({opCount}개 항목). 나눠서 삭제해 주세요.
        </p>
      )}

      <BulkDeleteDialog projectId={projectId} ids={ids} open={confirming} onOpenChange={setConfirming} />
    </aside>
  )
}
```

> ⚠️ `@/components/ui/dialog`의 실제 export 목록을 확인하고 맞춰라(`DialogDescription`이 없을 수
> 있다). 다르면 **있는 것만 쓰고 무엇이 달랐는지 보고하라.**

- [ ] **Step 5: `edit-panel.tsx`가 분기하게 한다**

`selectedGroupId` 분기 **아래**, `if (!table)` **위**에 넣는다:

```tsx
  if (selectedTableIds.length >= 2) return <BulkPanel projectId={projectId} />
```

훅에 추가:

```ts
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
```

import에 `import { BulkPanel } from './bulk-panel.js'`.

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/bulk-panel.test.tsx src/editor/edit-panel.test.tsx src/editor/model-edits.test.ts`
Expected: PASS

- [ ] **Step 7: 툴바 삭제 버튼을 다중 대응시킨다**

`toolbar.tsx`의 `onDelete`를 바꾼다. 선택이 1개면 지금처럼 즉시 삭제하고, 2개 이상이면 확인
다이얼로그를 띄운다.

```tsx
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  // ...
  const onDelete = () => {
    if (selectedTableIds.length === 0) return
    if (selectedTableIds.length >= 2) { setConfirmingBulk(true); return }
    const id = selectedTableIds[0]!
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }
```

버튼의 `disabled`를 `disabled={selectedTableIds.length === 0}`로 바꾸고, 컴포넌트 반환 JSX 끝(툴바
루트 요소 안)에 Step 4에서 만든 다이얼로그를 그대로 쓴다 — **복붙하지 말고 import한다.** 문구·연쇄
계산이 두 벌이 되면 한쪽만 고쳐질 자리가 생긴다.

```tsx
      <BulkDeleteDialog projectId={projectId} ids={selectedTableIds}
        open={confirmingBulk} onOpenChange={setConfirmingBulk} />
```

import에 추가:

```ts
import { useEffect, useState } from 'react'
import { BulkDeleteDialog } from './bulk-panel.js'
```

(`useState`가 이미 import돼 있지 않으면 추가한다 — 이 파일은 현재 `useEffect`만 쓴다.)

- [ ] **Step 8: 툴바 테스트를 더한다**

`apps/web/src/editor/toolbar.test.tsx`에 추가:

```tsx
  it('다중 선택에서 삭제를 누르면 확인 다이얼로그가 뜬다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderToolbar()
    await userEvent.click(screen.getByRole('button', { name: '테이블 삭제' }))
    expect(screen.getByText(/테이블 2개와 관계 1개가 삭제됩니다/)).toBeInTheDocument()
  })
```

> ⚠️ 이 파일의 렌더 헬퍼 이름과 삭제 버튼의 접근 이름을 실제 파일에서 확인해 맞춰라
> (`toolbar.tsx:98` 버튼의 텍스트가 무엇인지 직접 보고 쓴다).

- [ ] **Step 9: 전체 웹 스위트와 typecheck**

Run:
```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: PASS · EXIT=0

- [ ] **Step 10: 구분력을 확인한다**

둘을 각각 확인하고 복구한다.

1. `applyGroupMove`에서 `planGroupMove(m, ...)`를 `planGroupMove(next, ...)`로 바꿔(변경 **후** 모델)
   좌표 결과가 달라지는 것을 관찰한다. **현재 테스트가 그것을 잡지 못하면 그 사실을 보고하라** —
   그 경우 좌표를 단언하는 케이스를 `bulk-panel.test.tsx`에 추가해야 한다.
2. `clearTableGroupPosition(next, id)` 줄을 지우고 "그룹 뷰 좌표를 비운다" 테스트가 실패하는지 본다.

- [ ] **Step 11: 커밋**

```bash
git add apps/web/src/editor/bulk-panel.tsx apps/web/src/editor/bulk-panel.test.tsx \
  apps/web/src/editor/model-edits.ts apps/web/src/editor/model-edits.test.ts \
  apps/web/src/editor/edit-panel.tsx apps/web/src/editor/toolbar.tsx apps/web/src/editor/toolbar.test.tsx \
&& git commit -m "feat: 일괄 작업 패널(그룹 이동·일괄 삭제)

2개 이상 선택하면 편집 패널이 일괄 작업 패널로 바뀐다. 그룹 드롭다운은
드래그의 접근성 대체 경로이고, 삭제는 연쇄 삭제 규모를 보여주는 확인
다이얼로그를 거친다(툴바 삭제 버튼도 같은 다이얼로그를 공유). 그룹 배정과
좌표 재배치는 한 producer 라 undo 한 번으로 되돌아간다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 7: 드롭 타깃 · 드래그 상태 · 사이드바 내부 드래그

**Files:**
- Create: `apps/web/src/editor/drop-target.ts`
- Create: `apps/web/src/editor/drop-target.test.ts`
- Create: `apps/web/src/editor/drag-store.ts`
- Modify: `apps/web/src/editor/table-tree.tsx`
- Modify: `apps/web/src/editor/table-tree.test.tsx`

**Interfaces:**
- Consumes: `applyGroupMove`(Task 6) · `toggleTable`/`selectTables`(Task 2)
- Produces:
  - `type DropTarget = { groupId: string | null }`
  - `dropTargetOf(el: Element | null): DropTarget | null`
  - `dropTargetAt(x: number, y: number): DropTarget | null`
  - `dropAttrValue(groupId: string | null): string` — 마크업이 쓸 속성값
  - `useDragStore` — `{ tableIds: string[]; over: DropTarget | null; start(ids); moveOver(t); end() }`
  - 사이드바 그룹 블록의 DOM 계약: `data-drop-group="<groupId>"` 또는 `"unassigned"`

- [ ] **Step 1: 드롭 타깃 실패 테스트를 쓴다**

`apps/web/src/editor/drop-target.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { dropTargetOf } from './drop-target.js'

afterEach(() => { document.body.innerHTML = '' })

describe('dropTargetOf', () => {
  it('그룹 블록 안의 자손에서 그룹 id를 찾는다', () => {
    document.body.innerHTML = '<div data-drop-group="g1"><ul><li id="x">MBR</li></ul></div>'
    expect(dropTargetOf(document.getElementById('x'))).toEqual({ groupId: 'g1' })
  })

  it('unassigned는 groupId null로 푼다', () => {
    document.body.innerHTML = '<div data-drop-group="unassigned"><span id="y">t</span></div>'
    expect(dropTargetOf(document.getElementById('y'))).toEqual({ groupId: null })
  })

  it('타깃 밖이면 null이다', () => {
    document.body.innerHTML = '<div><span id="z">t</span></div>'
    expect(dropTargetOf(document.getElementById('z'))).toBeNull()
  })

  it('null 엘리먼트면 null이다', () => {
    expect(dropTargetOf(null)).toBeNull()
  })

  it('중첩되면 가장 가까운 타깃을 고른다', () => {
    document.body.innerHTML = '<div data-drop-group="g1"><div data-drop-group="g2"><i id="w"></i></div></div>'
    expect(dropTargetOf(document.getElementById('w'))).toEqual({ groupId: 'g2' })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/drop-target.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: `drop-target.ts`와 `drag-store.ts`를 만든다**

```ts
// apps/web/src/editor/drop-target.ts
/** groupId === null 은 "미분류"다. */
export type DropTarget = { groupId: string | null }

const ATTR = 'data-drop-group'
const UNASSIGNED = 'unassigned'

/**
 * DOM 엘리먼트에서 드롭 타깃을 읽는다. 좌표 조회와 분리해 둔 이유는 jsdom에 레이아웃이 없어
 * `elementFromPoint`가 항상 null이기 때문이다 — 판정 규칙은 이 함수로 테스트한다.
 */
export function dropTargetOf(el: Element | null): DropTarget | null {
  const host = el?.closest(`[${ATTR}]`)
  if (!host) return null
  const raw = host.getAttribute(ATTR)
  if (raw === null || raw === '') return null
  return { groupId: raw === UNASSIGNED ? null : raw }
}

/** 화면 좌표 → 드롭 타깃. 사이드바 드래그와 캔버스 드래그가 이 한 함수로 수렴한다. */
export function dropTargetAt(x: number, y: number): DropTarget | null {
  return dropTargetOf(document.elementFromPoint(x, y))
}

/** 사이드바 그룹 블록이 다는 속성값. */
export function dropAttrValue(groupId: string | null): string {
  return groupId ?? UNASSIGNED
}
```

```ts
// apps/web/src/editor/drag-store.ts
import { create } from 'zustand'
import type { DropTarget } from './drop-target.js'

/**
 * 드래그 중 상태. **에디터 store와 분리한다** — `over`는 pointermove마다 갱신되는데,
 * 에디터 store는 모델까지 들고 있어 구독자가 많다(캔버스 전체가 커서 움직임마다 리렌더된다).
 */
type DragState = {
  /** 끌고 있는 테이블. 빈 배열 = 드래그 중이 아님. */
  tableIds: string[]
  over: DropTarget | null
  start: (tableIds: readonly string[]) => void
  moveOver: (over: DropTarget | null) => void
  end: () => void
}

const IDLE = { tableIds: [] as string[], over: null }

export const useDragStore = create<DragState>((set) => ({
  ...IDLE,
  start: (tableIds) => set({ tableIds: [...tableIds], over: null }),
  moveOver: (over) => set((s) => (
    s.over?.groupId === over?.groupId && (s.over === null) === (over === null) ? {} : { over }
  )),
  end: () => set(IDLE),
}))
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/drop-target.test.ts`
Expected: PASS (5건)

- [ ] **Step 5: 사이드바에 드롭 타깃 마크업과 드래그 소스를 넣는다**

`table-tree.tsx`에서 그룹 블록과 미분류 블록에 속성을 단다. 그룹 블록:

```tsx
            <div key={g.id} className={cn('mb-1 rounded', dragOverGroupId === g.id && 'ring-2 ring-primary')}
              data-drop-group={dropAttrValue(g.id)}>
```

미분류 블록:

```tsx
          <div className={cn('mb-1 rounded', dragging && dragOver?.groupId === null && 'ring-2 ring-primary')}
            data-drop-group={dropAttrValue(null)}>
```

훅에 추가:

```ts
  const dragTableIds = useDragStore((s) => s.tableIds)
  const dragOver = useDragStore((s) => s.over)
  const dragStart = useDragStore((s) => s.start)
  const dragMoveOver = useDragStore((s) => s.moveOver)
  const dragEnd = useDragStore((s) => s.end)
  const dragging = dragTableIds.length > 0
  const dragOverGroupId = dragging ? dragOver?.groupId : undefined
```

**드래그 중에는 숨은 그룹을 다시 보여준다.** 두 계산을 고친다:

```ts
  // 드래그 중에는 그룹 뷰 스코핑을 풀어 모든 그룹을 드롭 타깃으로 노출한다.
  const scopedGroupId = !dragging && activeGroupView && model.tableGroups[activeGroupView]
    ? activeGroupView : null
```

그리고 그룹 렌더의 검색 필터 조기 반환을 바꾼다:

```tsx
              // 드래그 중이면 멤버가 걸리지 않는 그룹도 남긴다 — 그러지 않으면
              // 검색으로 찾은 테이블을 원하는 그룹에 놓을 수 없다.
              if (query !== '' && members.length === 0 && !dragging) return null
```

미분류 블록의 표시 조건도 드래그 중에는 항상 참이어야 한다:

```ts
  const showUnassigned = dragging || (!scopedGroupId && (unassigned.length > 0 || groups.length > 0))
```

포인터 드래그를 `TableItem`에 붙인다. 4px 임계 전에는 클릭으로 남고, 드롭 처리는 모델과 `mutate`를
쥔 부모(`TableTree`)가 콜백으로 받는다:

```tsx
function TableItem({ t, selected, onClick, onDragStart, onDrop }: {
  t: { id: string; physicalName: string; logicalName: string }
  selected: boolean
  onClick: (e: ReactMouseEvent) => void
  onDragStart: (id: string) => void
  onDrop: () => void
}) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  return (
    <li>
      <button type="button"
        // 드래그로 끝난 pointerup 뒤에는 click이 한 번 더 온다 — 선택이 튀지 않게 억제한다.
        onClick={(e) => { if (!dragging.current) onClick(e) }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          origin.current = { x: e.clientX, y: e.clientY }
          dragging.current = false
          // 캡처가 없으면 커서가 항목 밖으로 나가는 순간 pointermove가 끊긴다.
          if (typeof e.currentTarget.setPointerCapture === 'function') {
            e.currentTarget.setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={(e) => {
          const o = origin.current
          if (!o) return
          if (!dragging.current) {
            if (Math.abs(e.clientX - o.x) < 4 && Math.abs(e.clientY - o.y) < 4) return
            dragging.current = true
            onDragStart(t.id)
          }
          useDragStore.getState().moveOver(dropTargetAt(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          origin.current = null
          if (typeof e.currentTarget.hasPointerCapture === 'function'
            && e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          if (!dragging.current) return
          onDrop()
          // 뒤따라오는 click을 흘려보낸 뒤 억제를 푼다.
          setTimeout(() => { dragging.current = false }, 0)
        }}
        className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent', selected && 'bg-accent')}>
        <span className="font-mono text-xs font-medium">{t.physicalName}</span>
        <span className="text-xs text-muted-foreground">{t.logicalName}</span>
      </button>
    </li>
  )
}
```

두 곳의 `TableItem` 렌더에 새 props를 넘긴다(Task 4에서 쓴 `onClick`은 그대로):

```tsx
  onDragStart={onDragStartItem} onDrop={onDropItem}
```

`TableTree` 쪽 핸들러:

```ts
  // 잡은 항목이 선택에 있으면 선택 전체를, 아니면 그 항목 하나를 끈다(파일 탐색기 관례).
  const onDragStartItem = (id: string) => {
    if (!canEdit) return
    const ids = selectedIds.has(id) ? selectedTableIds : [id]
    if (!selectedIds.has(id)) selectTables([id])
    dragStart(ids)
  }

  const onDropItem = () => {
    const { tableIds, over } = useDragStore.getState()
    dragEnd()
    if (!canEdit || tableIds.length === 0 || over === null) return
    // 이미 그 그룹이면 아무 op도 내지 않는다.
    const changed = tableIds.filter((id) => model.tables[id]?.groupId !== over.groupId)
    if (changed.length === 0) return
    applyGroupMove(mutate, changed, over.groupId)
  }
```

import에 추가:

```ts
import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { applyGroupMove } from './bulk-panel.js'
import { useDragStore } from './drag-store.js'
import { dropAttrValue, dropTargetAt } from './drop-target.js'
```

- [ ] **Step 6: 사이드바 드래그 테스트를 쓴다**

`table-tree.test.tsx`에 추가. jsdom에는 레이아웃이 없어 `elementFromPoint`가 null을 주므로, **드롭
타깃 판정을 `dropTargetOf`로 밀어 넣는 대신 `useDragStore`를 직접 몰아 상태 전이를 검증한다.**

```tsx
  it('트리 항목을 끌어 그룹에 놓으면 그룹이 바뀌고 op 한 건이 나간다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderTree()

    const item = screen.getByText('MBR').closest('button')!
    fireEvent.pointerDown(item, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(item, { clientX: 40, clientY: 0, pointerId: 1 })
    // jsdom에는 레이아웃이 없어 elementFromPoint가 null이다 — 타깃을 직접 세운다.
    useDragStore.getState().moveOver({ groupId: 'g2' })
    fireEvent.pointerUp(item, { clientX: 40, clientY: 0, pointerId: 1 })

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    expect(calls).toHaveLength(1)
  })

  it('드래그 중에는 검색으로 숨은 그룹도 드롭 타깃으로 보인다', () => {
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    // g2에는 멤버가 없어 검색 중이면 숨는다.
    useDragStore.getState().start(['t2'])
    expect(screen.getByText('주문영역')).toBeInTheDocument()
  })

  it('읽기 전용이면 드래그해도 아무 op도 나가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다.
    renderTree()
    const item = screen.getByText('MBR').closest('button')!
    fireEvent.pointerDown(item, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(item, { clientX: 40, clientY: 0, pointerId: 1 })
    useDragStore.getState().moveOver({ groupId: 'g1' })
    fireEvent.pointerUp(item, { clientX: 40, clientY: 0, pointerId: 1 })
    expect(calls).toHaveLength(0)
  })
```

`afterEach`에 드래그 store 정리를 더한다:

```ts
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset(); useDragStore.getState().end() })
```

import에 `fireEvent`와 `useDragStore`를 더한다.

> ⚠️ jsdom에는 `setPointerCapture`/`hasPointerCapture`가 없을 수 있어 Step 5의 핸들러에 `typeof …
> === 'function'` 가드를 넣어 뒀다. **그 가드가 있는데도 포인터 이벤트가 핸들러에 닿지 않으면**
> (`fireEvent.pointerDown`이 무시되는 등) 억지로 우회하지 말고 **무엇이 어떤 값으로 관찰됐는지
> 보고하라** — 그 경우 이 세 테스트는 브라우저 스모크로 옮기는 것이 맞다.

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/table-tree.test.tsx`
Expected: PASS

- [ ] **Step 8: 구분력을 확인한다**

`onDropItem`의 `changed` 필터를 지우고(이미 같은 그룹이어도 mutate) "이미 그 그룹이면 op가 없다"를
검증하는 케이스를 추가해 실패시킨 뒤 복구한다. 그런 케이스가 없다면 **먼저 추가하라**:

```tsx
  it('같은 그룹에 놓으면 아무 op도 내지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTree()
    const item = screen.getByText('MBR').closest('button')!
    fireEvent.pointerDown(item, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(item, { clientX: 40, clientY: 0, pointerId: 1 })
    useDragStore.getState().moveOver({ groupId: 'g1' })   // t2는 이미 g1이다
    fireEvent.pointerUp(item, { clientX: 40, clientY: 0, pointerId: 1 })
    expect(calls).toHaveLength(0)
  })
```

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/editor/drop-target.ts apps/web/src/editor/drop-target.test.ts \
  apps/web/src/editor/drag-store.ts \
  apps/web/src/editor/table-tree.tsx apps/web/src/editor/table-tree.test.tsx \
&& git commit -m "feat: 사이드바 내부 드래그로 그룹 이동

좌표 → 드롭 타깃 판정을 dropTargetOf 한 함수로 모으고(캔버스 드래그가 다음
태스크에서 같은 함수를 쓴다), 드래그 상태는 에디터 store 와 분리한 작은
store 에 둔다. 드래그 중에는 검색·그룹 뷰로 숨은 그룹도 드롭 타깃으로
노출한다 — 그러지 않으면 찾은 테이블을 원하는 그룹에 놓을 수 없다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 8: 캔버스에서 사이드바 그룹으로 드롭

**Files:**
- Modify: `apps/web/src/editor/canvas.tsx`
- Modify: `apps/web/src/editor/canvas.test.tsx`

**Interfaces:**
- Consumes: `useDragStore`·`dropTargetAt`(Task 7) · `applyGroupMove`(Task 6)
- Produces: 없음(마지막 태스크)

- [ ] **Step 1: 실패 테스트를 쓴다**

`canvas.test.tsx`에 추가:

```tsx
  it('드롭 타깃 위에서 놓으면 위치 이동 대신 그룹 이동이 나간다', async () => {
    const calls: { summary?: string }[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input as { summary?: string }); return { data: { seq: 2 } } } })
    const model = buildSampleModel()
    model.tableGroups = {
      ...model.tableGroups,
      g2: { id: 'g2', name: '주문영역', color: '#000', comment: null },
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    const onNodeDragStop = lastProps().onNodeDragStop as (
      e: { clientX: number; clientY: number }, node: { id: string; type: string; position: { x: number; y: number } },
      dragged: { id: string; type: string; position: { x: number; y: number } }[],
    ) => void

    useDragStore.getState().start(['t2'])
    useDragStore.getState().moveOver({ groupId: 'g2' })   // jsdom엔 레이아웃이 없다
    onNodeDragStop(
      { clientX: 10, clientY: 10 },
      { id: 't2', type: 'table', position: { x: 999, y: 999 } },
      [{ id: 't2', type: 'table', position: { x: 999, y: 999 } }],
    )

    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g2'))
    // 드롭 지점의 좌표(999,999)는 버려지고 planGroupMove가 정한 자리로 간다.
    expect(useEditorStore.getState().model.tables['t2']?.position).not.toEqual({ x: 999, y: 999 })
  })

  it('드롭 타깃이 없으면 기존 위치 이동 경로 그대로다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()

    const onNodeDragStop = lastProps().onNodeDragStop as (
      e: unknown, node: { id: string; type: string; position: { x: number; y: number } },
      dragged: { id: string; type: string; position: { x: number; y: number } }[],
    ) => void

    onNodeDragStop({}, { id: 't2', type: 'table', position: { x: 50, y: 60 } },
      [{ id: 't2', type: 'table', position: { x: 50, y: 60 } }])

    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t2']?.position).toEqual({ x: 50, y: 60 })
    })
    expect(useEditorStore.getState().model.tables['t2']?.groupId).toBe('g1')  // 그대로
  })

  it('드롭 타깃 위에 있는 동안에는 autoPanOnNodeDrag를 끈다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderCanvas()
    expect(lastProps().autoPanOnNodeDrag).toBe(true)
    useDragStore.getState().start(['t2'])
    useDragStore.getState().moveOver({ groupId: 'g1' })
    await waitFor(() => expect(lastProps().autoPanOnNodeDrag).toBe(false))
  })
```

`afterEach`에 `useDragStore.getState().end()`를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/canvas.test.tsx`
Expected: FAIL — `onNodeDragStop`이 드롭 타깃을 모르고, `autoPanOnNodeDrag`를 넘기지 않는다.

- [ ] **Step 3: `canvas.tsx`에 드래그 소스 ②를 붙인다**

훅에 추가:

```ts
  const dragOver = useDragStore((s) => s.over)
```

`onNodeDragStart`에 테이블 갈래를 더한다(그룹 노드 갈래는 그대로 둔다):

```tsx
        onNodeDragStart={(_, node) => {
          if (node.type === 'table') {
            const ids = useEditorStore.getState().selectedTableIds
            useDragStore.getState().start(ids.includes(node.id) ? ids : [node.id])
            return
          }
          if (node.type !== 'group') return
          // ... 기존 그룹 드래그 스냅샷 코드 그대로 ...
        }}
```

`onNodeDrag`에 좌표 판정을 더한다(그룹 갈래 앞에 둔다):

```tsx
        onNodeDrag={(event, node) => {
          if (node.type === 'table') {
            useDragStore.getState().moveOver(dropTargetAt(event.clientX, event.clientY))
            return
          }
          if (node.type !== 'group' || !dragOrigin.current) return
          // ... 기존 그룹 드래그 이동 코드 그대로 ...
        }}
```

`onNodeDragStop`의 맨 앞에 분기를 넣는다:

```tsx
        onNodeDragStop={(_, node, dragged) => {
          const drop = useDragStore.getState().over
          useDragStore.getState().end()
          if (node.type === 'table' && drop !== null) {
            // 드롭 지점의 캔버스 좌표는 버린다 — 최종 자리는 planGroupMove가 정한다.
            setNodes(derived)
            const ids = dragged.filter((n) => n.type === 'table')
              .map((n) => n.id)
              .filter((id) => model.tables[id]?.groupId !== drop.groupId)
            if (ids.length > 0) applyGroupMove(mutate, ids, drop.groupId)
            return
          }
          if (node.type === 'group') {
            // ... 기존 그룹 이동 코드 그대로 ...
          }
          // ... 기존 위치 이동 코드 그대로 ...
        }}
```

ReactFlow props에 추가:

```tsx
        autoPanOnNodeDrag={dragOver === null}
```

import에 추가:

```ts
import { useDragStore } from './drag-store.js'
import { dropTargetAt } from './drop-target.js'
import { applyGroupMove } from './bulk-panel.js'
```

⚠️ `onNodeDragStop`은 **그룹 노드 드래그에서도 불린다.** 그룹 노드는 `node.type === 'group'`이라 위
분기에 들어가지 않지만, `useDragStore.getState().end()`를 맨 앞에서 부르는 것은 안전하다(그룹 드래그는
드래그 store를 쓰지 않는다).

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/canvas.test.tsx`
Expected: PASS

- [ ] **Step 5: 전체 스위트와 typecheck**

Run:
```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' pnpm --filter @erdd/server exec vitest run
pnpm -C packages/cli test
pnpm -r typecheck; echo "EXIT=$?"
```
Expected: 전부 PASS · EXIT=0. **cli는 이 사이클에서 한 줄도 바뀌지 않아야 한다** — 수가 138에서
변하면 범위를 넘은 것이다.

- [ ] **Step 6: 구분력을 확인한다**

`autoPanOnNodeDrag={dragOver === null}`을 `autoPanOnNodeDrag={true}`로 되돌려 해당 테스트가
실패하는지, `setNodes(derived)` 줄을 지워도 통과하는지 각각 확인하고 복구한다. **후자가 통과하면
"드롭 후 노드가 원위치로 돌아오는 것"은 이 스위트가 잡지 못한다는 뜻이다 — 그 사실을 보고하라**
(브라우저 스모크 5번이 그 자리를 덮는다).

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/canvas.tsx apps/web/src/editor/canvas.test.tsx \
&& git commit -m "feat: 캔버스에서 사이드바 그룹으로 드롭해 그룹 이동

ReactFlow 노드 드래그가 사이드바 위에서 끝나면 위치 이동 대신 그룹 이동으로
분기한다. 드롭 타깃 위에 있는 동안에는 autoPanOnNodeDrag 를 꺼 캔버스가
가장자리에서 계속 팬되는 것을 막는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 최종 검증

- [ ] **전체 스위트 체크포인트**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' pnpm verify
```

⚠️ **`. ./.env`로 환경을 읽어 오지 마라.** 최상위 `.env`의 `DATABASE_URL`은 공유 dev DB `erdd`를
가리키는데, **테스트가 그 DB를 TRUNCATE한다**(`testing/db.ts`의 `resetDb`). 그러면 최상위와 다른 두
워크트리에서 작업 중인 사람의 데이터가 함께 날아간다. 격리 DB를 명시적으로 준다.

기대 수(이 계획이 더하는 것): **core +6 · web +25 안팎 · server +1 · cli ±0**. 실제 수를 세어
`docs/superpowers/HANDOFF.md`의 기준선을 갱신할 수 있게 보고하라.

- [ ] **최종 whole-branch 리뷰**

리뷰 프롬프트에 반드시 넣을 질문:
> **이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의
> 불변식을 재유도하라.**

이 사이클의 후보는 `tableBounds`(`group-nodes`·`group-move`), `applyGroupMove`(`bulk-panel`·
`table-tree`·`canvas`), `selectTables`(사이드바·캔버스), `useDragStore.end`(사이드바·캔버스)다.

- [ ] **브라우저 스모크** (실 앱 + 실 DB, 대조군 포함)

1. 사이드바에서 Cmd+클릭으로 3개 선택 → **캔버스에서도 3개 하이라이트**되는지
2. 그중 하나를 잡아 다른 그룹 블록에 드롭 → 3개가 함께 이동하고 **상대 배치가 보존**되는지
3. `cmd+Z` 한 번으로 그룹과 좌표가 **동시에** 원복되는지
4. 캔버스에서 Shift 박스 선택 → 사이드바 그룹으로 드래그 → 같은 결과
5. 드래그 중 사이드바 가장자리에서 **캔버스가 팬되지 않는지**, 드롭 후 노드가 **원위치로 돌아오는지**
6. 두 번째 클라이언트에서 접속해 **다중 선택이 N개 그대로 하이라이트**되는지
7. 일괄 삭제 확인 다이얼로그 → 취소 시 무변경, 확인 시 Revision 1건
8. **대조군:** 그룹 뷰에 들어간 상태에서 캔버스 테이블을 사이드바의 **다른** 그룹으로 드롭 →
   그 테이블이 현재 뷰에서 사라지고, 전체 뷰로 나가면 새 그룹 옆에 있는지

⚠️ 스모크 전에 `lsof -nP -iTCP:3001 -iTCP:5174 -sTCP:LISTEN`으로 좀비 dev 프로세스를 확인하고
나온 PID를 `kill -9` 한다. 브라우저는 `127.0.0.1`로 접속한다.

- [ ] **문서 갱신** (컨트롤러가 병합 후 최상위에서)

- `docs/superpowers/HANDOFF.md` 1절 완료 표에 항목 추가, 테스트 기준선 4수 갱신, 6절에 잔여 한계
  (설계 11절) 이월
- `docs/manual/user-guide.md` — 사이드바·그룹 절에 다중 선택·드래그 그룹 이동을 반영한다.
  **화면 문구를 바꿨으므로 「」 인용이 어긋날 수 있다**(일괄 작업 패널의 「선택 테이블 삭제」 등)
