# 공용 리소스 — 전역·조직 라이브러리, fork 와 승격

프로젝트 사전 4종(`domain`/`word`/`term`/`customField`)을 조직·전역 라이브러리와 주고받는 층이다.
**가져오기(fork)와 승격(promote)은 대칭이고, 그 위에 요청·승인 큐가 얹혀 있다.**

---

## 라이브러리는 op 로그 밖이다

- **`resource_libraries` / `resource_items` 는 op 로그 밖의 일반 테이블이다**(프로젝트 모델이 아니다).
  프로젝트로 fork 된 결과만 op 엔티티가 된다.
- 모델 4종의 `origin` 은 `{ libraryId, sourceId, sourceVersion, base }` 다.
  **`base` 는 가져온 시점에 프로젝트 공간으로 투영해 써넣은 payload** 라, `payloadOf(현재) ≠ base`
  하나로 「프로젝트가 고쳤는지」가 판정되고 **3-way 병합 전체가 core 순수 함수
  (`resource-sync.ts`)로 닫힌다.** 버전 이력 테이블이 없다.
- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → Revision 1건, undo 1회로 원복된다.
- **원본에서 삭제된 항목은 프로젝트에 그대로 둔다**(삭제 제안 없음 — 프로젝트 독립성 원칙).

---

## 승격 — 가져오기의 반대 방향

`resource-promote.ts`(`planPromote` 3상태 분류 / `applyPromotePlan` write + `origin` 갱신)와
프로시저 `resource.promote` 다. 가져오기와 대칭이지만 규칙이 셋 더 있다.

- **`origin.base` 는 승격에서도 「가져오기 직후」와 같아야 한다.** 라이브러리에 쓴 payload 를
  **다시 프로젝트 공간으로 투영한 값**을 넣는다(프로젝트의 현재 payload 를 그대로 넣으면 안 된다).
  정상 케이스는 왕복이 항등이라 곧바로 동기 상태가 되고, **도메인을 빼고 올린 용어**는
  `base.domainId = null ≠ 현재값` 이라 「프로젝트가 고침」으로 잡혀 나중에 자동 갱신이 도메인 연결을
  조용히 지우는 사고가 **구조적으로 막힌다.** core 테스트가 양방향으로 고정한다.
- **승격은 프로젝트 엔티티의 `origin` 만 바꾼다.** 그래서 op 는 전부 `origin` 1필드 update 이고
  선택 항목 수 = op 수다. **undo 는 `origin` 만 되돌리며 라이브러리에 쓴 항목은 남는다**
  (op 로그 밖이라 구조적으로 그렇다).
- **판정 순서가 DB 행 순서에 의존하면 안 된다.** `loadProjectModel` 의 `SELECT` 에는 `ORDER BY` 가
  없어서, 동명 항목이 둘일 때 클라와 서버가 서로 다른 쪽에 `name-match` 를 주면 양쪽 다
  `plan-changed` 로 건너뛰어 **영원히 수렴하지 않는다.** `planPromote` 가 엔티티를 **id 오름차순으로
  정렬한 뒤** 선점을 판정해 막는다 — **새 선점 규칙을 넣을 때 이 정렬을 지우지 마라.**
- **클라는 payload 를 보내지 않는다.** `{entityId, expectedStatus, expectedTargetItemId,
  expectedTargetVersion}` 만 보내고 서버가 락 안에서 계획을 재계산해 어긋난 항목만 건너뛴다
  (`missing`/`plan-changed`). **`expectedTargetVersion` 이 없으면** 다이얼로그를 연 사이 남이 고친
  원본을 낡은 미리보기 기준으로 덮어쓴다.

---

## 요청·승인 큐

`promotion_requests` + `promotion.*` 프로시저. 라이브러리 쓰기 권한이 없는 Editor 의 요청 경로다.

- **승격의 유일한 엔진은 `apps/server/src/services/promote.ts` 의 `runPromoteInTx` 다.**
  `resource.promote`(직접 승격)와 `promotion.resolve`(요청 승인)가 이것을 공유한다.
  세 번째 승격 경로를 만들면 반드시 이 함수를 거쳐야 하고, **`prepare` 훅 밖에서 부르면**
  프로젝트 행 락 밖에서 라이브러리를 쓰게 된다.
  - 라이브러리 항목 조회도 같은 파일의 `loadLibraryItems` 하나뿐이어야 한다 — 요청 시점
    (`promotion.create`)과 승인 시점(`runPromoteInTx`)이 **같은 값을 계산해야 하고**,
    그 함수의 `orderBy(asc(createdAt))` 가 `planPromote` 의 동명 선점 순서를 정하므로 한쪽만 바뀌면
    판정이 갈린다.
- **요청 행은 엔티티 포인터(`entityIds`)만 담는다.** payload 를 동결하면 `origin.base` 규칙을 요청
  시점 기준으로 다시 유도해야 하고, 그 사이 엔티티가 삭제되면 `origin` 을 쓸 대상이 없어지며,
  **요청 행이 모델과 별개의 진실 원본이 된다.** 승인 화면은 `promotion.get` 이 **지금** 계산한 계획을
  쓰고, 요청 당시 있었으나 계획에서 사라진 항목은 `unavailable` 로 분리한다.
- **`promotion_requests` 에 `orgId` 컬럼을 두지 않는다.** 조직 단위 조회는 `resource_libraries.orgId`
  조인으로 얻는다 — `create` 가 `library.orgId === project.orgId` 를 강제하므로 두 경로가 같은 값을
  가리키고, 컬럼을 따로 두면 그 둘이 어긋날 자리가 생긴다.
  ⚠️ **조직 경계는 테스트로 잠겨 있다**(외부인이 소유한 조직에 pending 요청을 심는
  `seedForeignPendingRequest` 픽스처). **이 픽스처를 지우면** `listForOrg` 의 행 필터와
  `pendingCount` 의 조인 조건이 **동시에 무방비가 된다.**
- **원자성은 `promotion` 전용 테스트가 아니라 `mutate-publish.test.ts` 가 잠근다.** 보장의 소재가
  `promotion` 이 아니라 `mutateAndPublish` 의 `prepare` 훅이고, 「prepare 가 쓴 행은 모델 변경과 한
  트랜잭션이다」가 일반적으로 잠근다. **`promotion` 전용 원자성 테스트는 불필요하고, 만들면 오히려
  가짜 통과가 되기 쉽다** — `promotion_requests` 가 프로젝트·라이브러리 양쪽 cascade 라 실패를
  주입하려 지우면 요청 행도 함께 사라진다.

### 경합 테스트는 경합이 일어났다는 것 자체를 관측해야 한다

**경합의 종류마다 기법이 다르다.** 두 `resolve` 를 `Promise.all` 로 쏘면 `runMutation` 의 프로젝트
행 `FOR UPDATE` 가 직렬화해 단언이 대칭이 된다(statusCode 정렬 `[200,409]`, 항목 1건 — flaky 하지
않다). **그러나 `cancel` vs `resolve` 에는 그 방법이 통하지 않는다** — 경합 창이 좁아 조건부 `where`
를 지워도 통과한다. 그쪽은 요청 행을 밖에서 `FOR UPDATE` 로 잠가 한쪽 UPDATE 를 붙들어 두는 형태이고,
**`pg_locks` 로 실제 대기를 확인하는 헬퍼**(`waitForLockWaiter` —
`locktype='transactionid' AND NOT granted`)가 「락을 실제로 기다렸다」를 단언한다.
**고정 `sleep` 이면 경합이 성립하지 않은 채 조용히 통과할 수 있다.**

---

## 알려진 한계

### fork(가져오기)

- **행안부 표준 사전 실데이터가 없다.** 전역 라이브러리가 비어 있을 때 부팅 시 「표준 사전(예시)」
  소량만 시드한다.
- `resource-sync` 에서 같은 배치 내 동명 added 2건은 서로에 대해 `nameClash=false` 다
  (UI 자문용이라 무결성과 무관하다).
- `resource-sync` 에 `as unknown as` 캐스트가 남아 있고, `items.update`/`remove` 가 권한검사 전에
  NOT_FOUND 를 낸다(존재 오라클 — uuidv7 이라 열거 불가, 스냅샷 관례와 동일).
- **`library.update` 가 서버에만 있고 UI 경로가 없다.** 라이브러리 remove 테스트도 없다.
- 충돌 라디오의 `aria-label` 에 종류 수식어가 없어 동명 이종 항목이면 모호하고, 적용 성공 토스트가
  없어 **선택이 전부 no-op 이면 화면이 무반응이다.**
- 패널을 다시 열면 라이브러리 목록이 stale 하다(`onOpenChange` 에서 refetch 할 자리다).
  `plan` 참조가 바뀌면 `useEffect` 가 진행 중 선택을 리셋할 수 있다.
- `ensureStarterGlobalLibrary` 에 동시 부팅 경합이 있다(단일 인스턴스면 무해).
  `changedFields` 에 `domainId` 가 허위로 낄 수 있다(표시 전용).
- customField 의 로컬 순서변경·`origin` 왕복 회귀 테스트가 없다(구조적으로 성립하나 미고정).

### 승격

- **전역 fork 항목을 조직으로 승격하면 전역 재동기화 목록에 그 원본이 `added` 로 다시 뜬다.**
  `nameClash` 가 붙어 기본 미선택이라 중복 생성은 막히지만 매번 남는다 — **「무시」 상태를 기록할
  자리가 모델에 없다.**
- **undo 는 `origin` 만 되돌린다** — 라이브러리에 쓴 항목은 남고 관리 화면에서 지워야 한다.
- **`FOR UPDATE` 는 기존 행만 잠근다.** 서로 다른 프로젝트가 동시에 승격하면 같은 이름의 항목이
  2개 생길 수 있다 — `resource_items` 에 `(library_id, kind, name)` 유니크 제약이 없다.
  데드락 경로도 이론상 존재한다(승격은 항목→라이브러리 순, `library.remove` 는 반대).
- **동명 판정이 표시 이름 완전일치다**(공백·대소문자 정규화, 동의어 매칭 없음). 대상에 동명이
  여럿이면 `createdAt` 첫 항목을 고르고 **사용자가 지목할 수 없다.**
- 프로젝트에서 지운 항목이 원본에서 사라지지는 않는다(반대 방향의 보수적 정책과 대칭).
- `parsePayload` 실패가 400 으로 매핑된다(서버측 결함인데 클라 입력 오류로 보인다).
  `entries` 에 같은 `entityId` 가 중복되면 조용히 흡수된다.
- 승격 진행 중에도 체크박스·일괄 버튼이 활성이다(제출 버튼만 비활성). 탭을 전환하면 재동기화 탭의
  진행 중 선택이 초기화된다.
- `EntryLabel` 이 재동기화 탭과 승격 탭에 거의 동일하게 중복이고, `resource-panel.tsx` 의
  `as LibraryRow[]` 캐스트가 서버/클라 shape 드리프트를 컴파일에서 놓친다.
- **`planResync` 는 아직 정렬 없는 순회를 쓴다.** 라이브러리 항목 순서에 의존해 현재는 무해하나
  `planPromote` 와 같은 부류의 잠재 발산이다.

### 요청·승인 큐

- **알림이 폴링 배지뿐이다.** 승인자가 로그인해 있지 않으면 모른다. 메일 발송이 선행 결정이다
  (→ [../ops/known-issues.md](../ops/known-issues.md)).
- **배지는 `bare` 라우트(에디터)에는 뜨지 않는다.** 실제 도달 범위가 「`AppShell` 을 쓰는 화면」이라
  **프로젝트 오너가 에디터에 오래 머무는 동안에는 대기 요청을 못 본다.** 승인 동선이 홈·조직 화면이라
  치명적이진 않으나 설계가 약속한 「어느 화면에 있든 보인다」와 실제가 다르다.
- **요청자는 자기 요청의 반려 사유를 볼 수 없다.** 조직 승인 화면에는 상태 필터가 있어
  `resolutionNote` 를 읽을 수 있지만 **프로젝트 승격 탭의 요청 목록은 `pending` 고정**이다.
  서버 `listForProject` 는 `status` 를 지원하므로 **막힌 것은 UI 뿐이다.**
- **`loadLibraryItems` 의 `orderBy(asc(createdAt))` 가 어떤 서버 테스트로도 잠겨 있지 않다.**
  이 정렬이 `planPromote` 의 동명 선점 순서를 정하므로 조용히 바뀌면 승격 대상이 달라진다.
  core 의 순서 결정성 테스트는 함수의 성질만 보고 서버가 먹이는 순서는 보지 않는다.
  **검증 불가능한 것이 아니다** — 동명 항목 둘을 `createdAt` 명시로 직접 insert 한 뒤
  `promotion.get` 의 `entries[0].targetItemId` 가 오래된 쪽인지 보면 `asc`→`desc` 뒤집기를 잡는다.
- **`pendingCount` 의 다중 조직 집계가 미검증이다** — `byOrg` 가 2원소 이상인 경로가 한 번도 실행되지
  않는다. 덮으려면 오너가 소유한 세 번째 조직 + 정렬 안정화가 필요하다.
- **생성 후 요청을 편집할 수 없고**(취소하고 다시 만든다), **pending 요청이 만료되지 않으며**,
  **요청 시점의 상태를 저장하지 않아** 승인 화면이 「요청 당시 이랬는데 지금 이렇다」를 보여줄 수 없다.
  **요청자에게 결과가 푸시되지 않는다**(프로젝트 승격 탭을 열어야 안다).
- **`resolve` 가 0건 승격도 `resolved` 로 남긴다** — 승인자가 골랐으나 전부 `skipped` 된 경우도
  `resolved` 이고 `approvedEntityIds` 가 빈 배열인 것으로만 구분된다.
- **`summary` 에 실제 승격 건수를 넣을 수 없다.** `summary` 는 문자열이라 `mutateAndPublish` 호출
  시점에 확정되는데 결과는 `prepare` 훅이 돈 뒤에야 채워진다. 지금은 호출 시점에 아는 값
  (「요청 N건 중 M건 승인」)을 쓴다.
- 코드 정리 여지: `mutateAndPublish` 스캐폴딩이 `routers/resource.ts` 와 `promotion.ts` 에 축자 중복
  (배선이라 값이 갈리지는 않는다), `resolve` 가 단일 긴 함수, 승인 권한 규칙이 `requireScopeWrite` 와
  `pendingCount` 의 `inArray` 에 따로 표현(공유 상수로 뽑을 자리), `promotion.get` 이 요청 행을 통째로
  스프레드, `org-detail.tsx` 의 `canManage` 식 중복. 요청 경로의 op 상한 가드·요청 메모·대기 목록의
  `libraryId` 필터·목록의 `isError` 알림·`resolve` 의 `onError` 토스트가 미검증이다.
