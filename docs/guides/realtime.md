# 실시간 협업 — 브로드캐스트·seq·소켓

`/ws?projectId=` WebSocket 채널과 인메모리 `RealtimeHub`, 웹의 `useRealtime` 이다.
**여기 있는 것은 전부 실제로 물렸던 것들이다.**

---

## 모델을 바꾸는 모든 경로는 `mutateAndPublish` 를 거친다

`apps/server/src/services/mutate-publish.ts` 다. **`runMutation` 을 직접 부르면 커밋은 되지만
실시간 채널로 전파되지 않는다.**

- 호출처는 `model.mutate` · `snapshot.restore` · CLI 의 `model.push` 셋이다.
- **발행은 `db.transaction()` 이 resolve 된 뒤에만 일어나야 한다** — 콜백 안에서 발행하면 롤백된
  op 가 채널로 나간다. drizzle 의 `transaction()` 은 `commit` 을 await 한 뒤에만 resolve 하므로 현재
  구조에선 구조적으로 불가능하다.
- **모델 밖 테이블을 같은 트랜잭션에서 써야 하면 `runMutation` 의 `prepare(tx, model)` 훅을 쓴다**
  (승격이 라이브러리 항목을 이렇게 쓴다). 프로젝트 행 락 획득·모델 로드 뒤, `deriveOps` 앞에 돌아
  **권위 모델을 손에 쥔 채** 쓰고, 여기서 던지면 모델 변경과 함께 롤백된다.
  ⚠️ **훅 없이 `runMutation` 을 직접 부르면** 네 번째 직접 호출자가 생겨 브로드캐스트를 손으로
  발행해야 하고, **그 순간 이 절의 첫 불변식이 깨진다.**

## `store.seq` 에는 의미가 하나여야 한다

이 저장소의 Critical 결함이 여기서 나왔다 — `use-model.ts` 의 `submit()` 이 서버 응답 seq 로
`setSeq` 하고, `use-realtime.ts` 는 그 값을 「내가 적용한 마지막 seq」로 읽었다.
**두 의미가 갈리면, 내 mutation 이 서버 락에 대기하는 동안 커밋된 남의 op 가 「에코」로 오인돼
영구 유실된다**(seq 불연속도 안 잡혀 자가 치유도 발동하지 않는다).

현재는 `submit()` 이 `seq !== seqBefore + 1` 이면 `model.get` 으로 통째 resync 해서 막는다.
**seq 에 새 writer 를 추가하려면 이 불변식을 먼저 확인하라.**

## 소켓 핸들러에서 `await` 앞에 close 리스너를 걸어라

`hub.subscribe()` 직후·`await` 이전에 `socket.on('close', …)` 를 등록하지 않으면, 인증(DB 왕복 3회)
이나 `currentSeq` 대기 중 끊긴 소켓이 허브에 **영구 유령 항목**을 남긴다 — 다른 참여자에게 유령
아바타·잔상 하이라이트가 **서버 재시작 전까지** 남고 하트비트 타이머도 누수된다.

## 재접속 시 클라이언트 상태를 다시 알려야 한다

서버 `Entry` 는 `selection: null` 로 새로 시작하는데 선택 발신 effect 는 「값이 바뀔 때만」 보낸다.
`socket.onopen` 에서 현재 선택을 **무조건 재발신**하지 않으면 재접속 후 하이라이트가 사라진 채로
남는다. **presence 는 서버→클라 방향만 전체 스냅샷이고 클라→서버는 델타라 이 비대칭이 생긴다.**

## 그 밖의 계약

- **인증 실패 close(4401/4403)는 재접속 백오프에서 제외한다** — 안 그러면 무한 루프다.
- **수신 op 는 기존 `serializeMutation` 체인에 태운다**(`use-model.ts` 에서 export 한다).
  별도 직렬화를 만들면 내 낙관적 mutation 과 교차한다.
- **`resync` 는 `setLoaded` 와 다르다** — **`activeGroupView` 를 보존한다**(남이 편집할 때마다 그룹
  뷰에서 튕기면 못 쓴다). 선택은 대상이 사라졌을 때만 해제한다.
  **서버가 모델을 바꾸는 경로**(스냅샷 복원·승격)는 성공 후 `model.get` 으로 되맞추는데,
  **모델 전체가 바뀌는 복원은 `setLoaded`, 사전만 건드리는 승격은 `resync`** 가 맞다.
- **dev 에서 React StrictMode 가 effect 를 2회 실행**해 소켓이 잠시 2개 생기고 presence 프레임이
  중복된다. 프로덕션 빌드에는 없다 — **dev 로그에서 중복 프레임을 보고 버그로 오인하지 마라.**
- **허브는 인메모리 단일 인스턴스 전제다.**

---

## 알려진 한계

- **다중 인스턴스를 지원하지 않는다.** 스케일아웃하려면 Redis pub/sub 브리지가 필요하고, 그때
  `publishOps`/`peers` 를 async 로 바꿔야 한다(현재 동기 API 라 `mutateAndPublish` 가
  fire-and-forget 으로 부른다).
- **`actorUserId`/`actorName` 이 브로드캐스트되지만 클라가 안 쓴다** — 같은 사용자의 다른 탭에서 온
  변경에도 「다른 사용자가…」 토스트가 뜬다. `msg.actorUserId !== me.id` 로 게이트하거나
  `${actorName}님이…` 로 카피에 쓰면 둘 다 해소된다.
- **peer 이름 라벨이 테이블에만 있다.** 설계 산문은 관계·메모에도 약속했으나 구현은 테이블만이다
  (관계는 `EdgeLabelRenderer` 가 필요해 까다롭다). 산문을 고치든 라벨을 추가하든 정리가 필요하다.
- **`PresenceBar` 위치가 설계와 다르다.** 설계는 「캔버스 좌상단」, 구현은 헤더 우측 클러스터다.
  헤더 쪽이 더 나아 보이나 문서화되지 않은 드리프트다.
- **좌표 이동만으로도 「수정했습니다」 토스트가 뜬다**(`selectionImpact` 가 `position` 변경을 구분하지
  않는다). 남이 내가 선택한 테이블을 반복 드래그하면 토스트가 연달아 뜬다.
- **`MAX_PEER_SELECTIONS`(50) 절단이 조용하다** — 51개 이상 고르면 남에게 50개까지만 보이고 안내가 없다.
- **소켓 인바운드 rate limit 도 payload cap 도 없다**(`ws` 기본 `maxPayload` 100MiB).
  `selection` 프레임 1건이 채널 전체 presence 팬아웃을 유발하는데 **스로틀은 클라 측에만 있다.**
  `app.register(fastifyWebsocket, { options: { maxPayload: 64*1024 } })` 한 줄로 완화된다.
- **클라이언트 측 liveness 감지가 없다**(하트비트가 서버→클라 단방향이다). half-open 소켓이면 TCP 가
  포기할 때까지 조용히 아무것도 못 받는다. 복구 자체는 `ready.seq` 불일치로 정상 동작한다.
- **DB 조회 실패 시 앱 레벨 close code 가 아니라 1011 로 닫힌다**(인증 단계 실패는 4401/4403 이다).
- `PEER_SELECTION_KINDS`·`PeerSelectionKind`·`PEER_PALETTE` 가 core 밖에서 안 쓰이고,
  `RealtimeHub.connectionCount` 는 테스트 전용이다(공개 표면 정리 여지).
- **남이 그룹을 지우면 `selectedGroupId` 가 정리되지 않는다** — 자세한 것은
  [editor-state.md](editor-state.md) 「알려진 한계」.
