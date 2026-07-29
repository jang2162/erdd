# Phase 3 — 실시간 동시편집 설계

**작성일:** 2026-07-29
**상태:** 승인됨 (사용자 "진행해")
**원 기획:** [docs/11-collaboration.md](../../11-collaboration.md) "실시간 동시편집" 절, [docs/02-architecture.md](../../02-architecture.md) "실시간 협업 (Phase 3)"
**해소하는 체크리스트 항목:** [docs/91-checklist.md](../../91-checklist.md) "실시간 프로토콜 상세 — 채널 인증, 재수화 한계 기준, presence 메시지 설계"

## 목표

같은 프로젝트를 연 사용자들이 서로의 변경을 즉시 보고, 누가 무엇을 보고 있는지 알 수 있게 한다. 구체적으로:

1. 적용에 성공한 op 배치를 프로젝트 채널로 브로드캐스트하고, 다른 클라이언트가 로컬 모델에 반영한다.
2. 참여자 아바타와 선택 하이라이트(presence)를 표시한다.
3. 같은 속성 동시 수정은 last-write-wins으로 수렴하고, 밀린 쪽에 알린다.

**범위 밖:** Redis pub/sub 다중 인스턴스 확장(문서상 "스케일아웃 필요 시점"의 과제), 마우스 커서 위치 추적, 오프라인 편집 큐, 텍스트 필드 문자 단위 병합(CRDT/OT).

## 핵심 결정 (사용자 확정)

- **전송 계층은 WebSocket**(`@fastify/websocket`). `docs/02-architecture.md`가 전제한 방식이고, presence는 클라이언트→서버 방향이 필요해 SSE 단방향으로는 경로가 둘로 갈라진다. 폴링은 presence 하이라이트를 사실상 불가능하게 한다.
- **수신 op는 기존 `serializeMutation` 직렬화 체인에 태워 순차 적용한다.** 내 mutation이 in-flight인 동안 남의 op가 끼어들어 낙관적 상태와 경합하는 것을 구조적으로 막는다.
- **재수화는 항상 전체 리로드.** `seq` 간극이 생기면 크기와 무관하게 `model.get`으로 통째로 받는다. "마지막 수신 seq 이후 revisions 재전송" 경로는 만들지 않는다.
- **presence 범위는 아바타 + 선택 하이라이트** 둘 다. `docs/11-collaboration.md` 명세 그대로.

## 아키텍처 / 방침

| 계층 | 파일 | 책임 |
|---|---|---|
| core | `realtime-protocol.ts` (신규) | 서버↔클라이언트 메시지 타입과 zod 스키마, `peerColor(userId)`. 양쪽이 같은 정의를 쓴다 |
| server | `services/realtime.ts` (신규) | 프로젝트별 채널 허브(순수 레지스트리). 소켓이 아니라 `send(text)` 함수만 안다 |
| server | `ws.ts` (신규) | `/ws` 라우트 등록, 업그레이드 인증, 수신 `selection` 처리, 하트비트 |
| server | `services/mutation.ts` (수정) | `runMutation`이 적용된 `ops`도 반환 |
| server | `services/mutate-publish.ts` (신규) | 트랜잭션 실행 + **커밋 후** 브로드캐스트. `runMutation` 호출처가 공유 |
| web | `editor/use-realtime.ts` (신규) | 소켓 수명주기, 수신 적용, 재접속, presence 상태 |
| web | `editor/presence.tsx` (신규) | 참여자 아바타 바 |
| web | `editor/store.ts` · `nodes.ts` · `table-node.tsx` · `canvas.tsx` (수정) | peer 선택 하이라이트 배선 |
| web | `vite.config.ts` (수정) | `/ws` 프록시(`ws: true`) |

### 브로드캐스트 지점을 한 곳으로 모으는 이유

지금 `runMutation` 호출처는 `model.mutate`와 `snapshot.restore` 두 곳이고, Phase 4에서 CLI push가 세 번째가 된다. 각 라우터가 개별적으로 브로드캐스트하면 "새 호출처에서 깜빡"이 필연적인 실패 모드다. 대신:

```ts
// services/mutate-publish.ts
export async function mutateAndPublish(
  db: Db, hub: RealtimeHub,
  args: { projectId: string; actorUserId: string; actorName: string
          source: 'web' | 'cli' | 'system'
          deriveOps: (model: ProjectModel) => Op[]; summary?: string },
): Promise<{ seq: number }>
```

트랜잭션을 열어 `runMutation`을 돌리고, **트랜잭션이 커밋으로 resolve된 뒤에** `hub.publish()`를 호출한다. 롤백된 op를 뿌리는 일이 구조적으로 불가능해진다. `ops`가 0건이면(= 실질 변경 없음) 발행하지 않는다.

`runMutation`은 지금 `{ seq }`만 반환하므로 `{ seq, ops }`로 넓힌다. 기존 반환값을 좁히지 않는 순수 확장이라 호출처 회귀가 없다.

### 브로드캐스트 순서 역전

`runMutation`이 프로젝트 행에 `FOR UPDATE` 락을 걸므로 한 프로젝트의 mutation은 직렬화되고 커밋 순서 = seq 순서다. 다만 커밋 후 `publish()`가 실행되는 시점은 Node 마이크로태스크 스케줄에 달려 있어, 거의 동시에 끝난 두 트랜잭션의 발행 순서가 이론상 뒤집힐 수 있다. **이 경우 클라이언트가 seq 불연속을 보고 전체 리로드로 자가 치유한다** — 별도 시퀀싱 버퍼를 두지 않는다.

## 인증

업그레이드 시점에 요청의 `erdd_session` 쿠키를 읽어 `sessions` → `users` 조회(= `createContext`와 동일한 판정), 이어서 `requireProjectAccess(db, projectId, userId, 'view')`.

- 세션 없음/만료 → close code **4401**
- 프로젝트 접근 권한 없음/없는 프로젝트 → close code **4403**

별도 티켓 발급은 두지 않는다. same-origin WebSocket 업그레이드는 쿠키를 그대로 싣고, tRPC와 동일한 신뢰 경계다.

**Viewer도 접속·수신·presence 표시가 된다.** 편집 차단은 기존 `model.mutate`의 `'edit'` 게이트가 이미 담당하므로 소켓 계층에서 중복 판정하지 않는다.

## 프로토콜

`packages/core/src/realtime-protocol.ts`에 타입과 zod 스키마를 두고 서버·클라이언트가 공유한다.

### 서버 → 클라이언트

```ts
type ServerMessage =
  | { type: 'ready'; seq: number; peers: Peer[] }
  | { type: 'ops'; seq: number; ops: Op[]; actorUserId: string; actorName: string }
  | { type: 'presence'; peers: Peer[] }

type Peer = {
  userId: string
  name: string
  selection: PeerSelection | null   // null = 아무것도 선택 안 함
}

type PeerSelection = { kind: 'table' | 'relationship' | 'note' | 'group'; id: string }
```

- `ready`는 접속 직후 1회. 클라이언트는 `ready.seq`가 자기 `seq`와 다르면 즉시 전체 리로드한다(= 재접속 재수화).
- `presence`는 참여자 목록 **전체**를 보낸다. 동시 접속 인원이 조직 내 도구 규모(한 자릿수~십수 명)라 델타 프로토콜의 복잡도가 이득보다 크다.
- 같은 사용자가 탭 두 개를 열면 소켓이 둘이지만 `peers`에는 `userId` 기준 1건으로 합친다(가장 최근 selection 사용). 자기 자신도 목록에 포함되며, 표시 여부는 클라이언트가 결정한다.

### 클라이언트 → 서버

```ts
type ClientMessage = { type: 'selection'; selection: PeerSelection | null }
```

서버는 파싱 실패 시 메시지를 무시한다(소켓을 끊지 않는다). 하트비트는 `ws`의 ping/pong을 쓴다(30초 주기, 2회 연속 무응답 시 서버가 소켓 종료).

### 사용자 색상

서버가 배정하지 않는다. `peerColor(userId)`가 8색 팔레트에서 결정론적으로 고른다(userId 문자열 해시 → 인덱스). 모든 클라이언트가 같은 색을 계산하고, 재접속·새로고침에도 색이 유지된다. 팔레트는 기존 `group-palette.ts`와 별개로 두되 같은 톤을 쓴다.

## 클라이언트 수신 적용

`use-realtime.ts`가 소켓을 열고, 수신 메시지 처리를 **기존 `serializeMutation` 체인에 태운다**. 체인 안에서만 모델을 읽고 쓰므로 로컬 mutation과 절대 교차하지 않는다.

```
수신 'ops' →
  loadedProjectId !== projectId ?           → 무시
  msg.seq === store.seq + 1 ?               → applyOps(model, msg.ops) + setSeq(msg.seq)
  msg.seq <= store.seq ?                    → 무시(내가 방금 보낸 변경의 에코 또는 중복)
  그 외(간극)                                → model.get 전체 리로드
```

`ready.seq !== store.seq`도 마지막 분기와 같은 전체 리로드다.

**내 변경의 에코 처리:** 서버는 발신자를 구분하지 않고 채널 전체에 뿌린다. 내 mutation이 성공하면 `setSeq(seq)`가 먼저 반영되므로 되돌아온 메시지는 `msg.seq <= store.seq`에 걸려 무시된다. 발신자 소켓을 제외하는 방식은 쓰지 않는다 — 같은 사용자의 다른 탭이 갱신을 못 받게 되기 때문이다.

**재접속:** `onclose` 후 지수 백오프(1s → 2s → 4s → 8s, 상한 8s)로 재연결한다. 연결되면 `ready`가 오고, seq가 어긋나 있으면 전체 리로드가 일어난다. 탭이 백그라운드로 오래 있다 돌아온 경우도 같은 경로다. 단 **인증 실패 close(4401/4403)는 재시도하지 않는다** — 백오프가 무한 루프가 된다.

**접속 URL과 수명:** 서버와 동일 오리진이므로 `new URL('/ws?projectId=…', location.href)`의 스킴만 `http→ws`/`https→wss`로 바꿔 쓴다. 소켓은 프로젝트 단위로 열고 닫는다 — `projectId`가 바뀌면 기존 소켓을 닫고 새로 연다(에디터 언마운트 시에도 닫는다).

## presence UI

- **아바타 바**: 캔버스 좌상단에 참여자 이니셜 원(사용자 색 배경). 본인은 목록에서 제외한다(자기 아바타는 정보가 없다). 마우스오버 시 이름 툴팁. 3명 초과면 `+N`으로 접는다.
- **선택 하이라이트**: 다른 사용자가 선택 중인 테이블·관계·노트에 해당 사용자 색 테두리와 이름 라벨. `buildNodes(...)`에 `peerMarks: Map<entityId, PeerMark[]>`를 넘겨 `TableNodeData.peers`로 전달하고, `TableNode`가 로컬 `selected`의 `ring-2 ring-primary`와 구분되는 외곽선을 그린다. 관계는 `relationship-edge.tsx`, 노트는 `note-node.tsx`가 같은 방식.
- **발신**: 로컬 선택이 바뀔 때마다 `selection` 메시지를 보내되 **100ms 스로틀**을 건다. 그룹 선택은 그룹 뷰에서만 의미가 있으므로 `kind: 'group'`으로 그대로 보내고, 표시 여부는 뷰 모드에 따라 클라이언트가 판단한다.

## 충돌 정책

`docs/11-collaboration.md`의 정책을 현재 구조에 매핑한다. **새 충돌 해소 엔진은 만들지 않는다** — op의 `changes`가 이미 속성 단위이고 서버 도착 순서가 곧 승자이므로 LWW는 자동으로 성립한다. 필요한 건 "밀린 쪽 알림"뿐이다.

| 상황 | 처리 |
|---|---|
| 같은 속성 동시 수정 | 서버 도착 순서대로 적용(LWW). 수신 update가 **내가 현재 선택 중인 엔티티**를 건드리면 `다른 사용자가 이 항목을 수정했습니다` 토스트 |
| 삭제 vs 수정 (내가 수정 쪽) | 수신 delete가 내 선택 대상을 지우면 선택 해제 + `다른 사용자가 이 항목을 삭제했습니다` 토스트 |
| 삭제된 대상을 내가 수정 시도 | 서버가 400(`OpApplyError`)으로 거절 → **기존 실패 경로**(토스트 + `model.get` 복구)가 그대로 "삭제 우선"을 만족. 새 코드 없음 |

토스트는 수신 op 배치당 최대 1건으로 제한한다(대량 op 배치에서 토스트가 쏟아지지 않게).

## 전역 제약 (Global Constraints)

- `packages/core`는 IO·런타임 의존성 free. `realtime-protocol.ts`는 타입 + zod 스키마 + 순수 함수만 둔다. `ws`를 import하지 않는다.
- **`diffModels`(diff.ts) · `ENTITY_KINDS` · `applyOps` · `persistOps`는 건드리지 않는다.** 이번 작업은 op 엔진·스키마 변경이 없다 — **새 마이그레이션 없음**.
- `runMutation`의 반환 타입은 **넓히기만** 한다(`{ seq }` → `{ seq, ops }`). 기존 필드·시맨틱 변경 금지.
- 새 런타임 의존성은 `@fastify/websocket` 하나만 추가한다(서버 전용). 웹은 브라우저 내장 `WebSocket`을 쓴다 — 클라이언트 라이브러리 추가 금지.
- 소켓 인증 실패는 예외를 던지지 않고 **close code로 알린다**(4401/4403). 서버 프로세스가 죽지 않아야 한다.
- 허브는 **인메모리 단일 인스턴스** 전제. Redis 확장 훅을 미리 만들지 않는다(YAGNI).
- UI 카피는 한국어.
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지 한국어 + 트레일러 2줄.

## 테스트 전략

**core** — 프로토콜 zod 스키마의 왕복(직렬화→파싱)과 잘못된 페이로드 거절, `peerColor`의 결정성·팔레트 범위.

**server** — 허브를 소켓 없이 단위 테스트한다(`send` 스텁 주입): 채널 격리(프로젝트 A의 발행이 B 구독자에게 안 감), 구독 해제 후 미수신, 같은 userId 다중 소켓의 peers 병합, 발행 실패 소켓이 다른 구독자를 막지 않음. `mutateAndPublish`는 **커밋 후에만** 발행하는지(트랜잭션 롤백 시 미발행), op 0건일 때 미발행을 실제 DB 트랜잭션으로 검증한다. 인증은 `app.inject`로 WS 업그레이드를 태우기 어려우므로 **인증 판정 함수를 소켓에서 분리해** 순수 함수로 테스트한다(쿠키 없음 → 4401, 권한 없음 → 4403, 정상 → user).

**web** — `use-realtime`의 seq 분기 4종(연속 적용 / 과거 무시 / 간극 리로드 / `ready` 불일치 리로드)을 가짜 WebSocket으로 검증한다. 충돌 토스트 2종(선택 중 엔티티 수정·삭제). presence 아바타 렌더와 `buildNodes`의 `peerMarks` 전달. 재접속 백오프는 타이머 목으로 1회 재시도까지만 확인한다.

**dev 환경** — `vite.config.ts`에 `'/ws': { target: 'ws://localhost:3000', ws: true }` 추가. 현재 `/trpc`만 프록시되고 `ws: true`가 없어 dev에서 소켓이 연결되지 않는다.

## 열린 항목 (이번 범위 밖, 기록만)

- 다중 인스턴스 배포 시 Redis pub/sub 브리지 — 허브 인터페이스가 `publish/subscribe`라 나중에 구현체만 갈아끼우면 된다.
- 편집 중인 텍스트 입력의 문자 단위 병합 — 현재는 필드 확정(blur/enter) 단위 LWW.
- presence에 "편집 중" 상태(선택과 구분) 표시 — 선택 하이라이트로 충분한지 실사용 후 판단.
