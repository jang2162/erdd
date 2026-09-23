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
  CLI(`erdd dict pull`)는 같은 core 함수를 **로컬 파일 모델**에 돌리고 서버 모델은 건드리지 않는다
  ([cli.md](cli.md) 「공용 사전」).
- **원본에서 삭제된 항목은 프로젝트에 그대로 둔다**(삭제 제안 없음 — 프로젝트 독립성 원칙).
- **`planResync` 의 결과는 입력 순서와 무관하다.** 항목을 `(종류, 이름, sourceId)` 로 정렬하고 동률은
  `sourceId` 코드 단위 비교로 깬다 — 동명 원본 둘의 `adopt` 선착이 서버 행 순서에 흔들리지 않는다.
  동률 깨기에 `localeCompare` 를 쓰지 않는 것은 환경 로케일에 기대지 않기 위해서다.

### `adopt` — 이름이 같은 프로젝트 항목에 출처만 붙인다

로컬로 시작해 이미 자기 사전이 있는 프로젝트가 라이브러리에 합류하는 경로다(`ResyncDecision` 의
`'adopt'`, CLI `erdd dict pull --adopt`). 웹 가져오기 화면에는 없다.

- **내용은 그대로 두고 `origin` 만 붙인다. `base` 는 라이브러리 payload 를 투영한 값이다** — 승격의
  `origin.base` 규칙(아래)과 같다. 그래서 내용이 같으면 곧바로 동기 상태, 다르면(`--conflicts ours` 로
  연결한 경우) 「프로젝트가 고친 항목」이 되어 **원본이 바뀔 때 충돌로 알린다**(자동 갱신이 로컬 값을
  조용히 덮지 않는다). 프로젝트의 현재 payload 를 `base` 로 넣으면 그 보호가 사라진다.
- **대상은 `added` + `nameClash` 항목뿐이고, 이미 출처가 붙은 항목은 대상이 아니다**(`adoptTargetOf`).
  다른 라이브러리와의 링크를 조용히 갈아치우면 그쪽 재동기화가 영영 「원본에서 사라짐」으로 보인다.
  같은 종류·표시 이름(trim) 완전일치이고, 커스텀 항목은 `target` 도 같아야 한다(다르면 원본 반영이
  필드의 대상을 뒤집는다). 후보가 둘 이상이면 id 오름차순(코드 단위 비교) 첫 항목이다.
- **배치 배정은 `planAdoption` 한 곳이다** — 한 엔티티에 출처는 하나라 동명 원본 둘이 한 항목을
  노리면 선착 하나만 연결된다. `applyResyncPlan` 이 부르는 `adoptAssignments` 는 그 함수의 내용 판정
  없는 판(`sameContentOnly: false`)이고, 보고(CLI)도 같은 함수를 불러야 보고가 적용과 갈라지지 않는다.

### `adopt` 는 내용이 같을 때만 연결한다

**CLI `dict pull --adopt` 는 대상의 현재 내용이 원본의 투영값과 같을 때만 연결한다.** 다르면 연결하지
않고 다른 필드를 보고한다(`adoptDiffers`). 예외는 `--conflicts ours` 하나다.

- **왜** — 내용이 다른 채 연결하면 링크가 있고 payload ≠ 원본이라 `planPromote` 가 `update` 를, 버전이
  같아 `sourceBehind = false` 를 낸다. 연결 전에는 `name-match`(기본 제외)였던 항목이 **기본 선택되는 원본
  갱신**이 되어, 다음 `dict push --yes` 가 사용자가 한 번도 보지 않은 라이브러리 값을 이 프로젝트의 값으로
  덮는다. 쓰기 권한자는 승인 단계도 없다. 이것은 아래 「승격」의 규칙 — **덮어쓰기는 원본의 최신 값을
  보고 나서(`keep`) 한다** — 의 연장이다. `--conflicts ours` 는 로컬 값 유지에 명시적으로 동의한 것이라
  `keep` 과 같은 자리이고, 그 결과(다음 승격의 원본 갱신)가 의도다.
- **배정과 내용 판정은 `planAdoption` 의 한 루프다** — 대상 찾기·선착 → 내용 비교 → 배정 순이다. 둘을
  나누면 **내용이 달라 배정되지 않은 원본이 대상을 차지해** 뒤의 같은 이름·같은 내용 원본이 밀린다.
  배정되지 않은 adopt 를 `defer` 로 내린 결정으로 `applyResyncPlan` 을 부르면 같은 배정이 나온다 — 남은
  adopt 들의 대상은 서로 다르고, 각 대상은 여전히 `adoptTargetOf` 의 첫 후보다.
- **비교는 적용과 같은 색인으로 투영한 값과 한다** — 기존 출처, 같은 배치에서 추가(`apply`)될 항목(새 id
  자리표시), 앞서 배정한 adopt. 참조를 갖는 종류는 term(→ domain)뿐이고 `plan.entries` 는 종류 순이라
  용어를 볼 때 도메인 배정은 끝나 있다. 같은 배치에 새로 추가되는 도메인을 가리키는 원본 용어는 로컬
  용어와 다르다(로컬 용어가 그 새 id 를 가리킬 수 없다).
- **원본 용어의 도메인이 색인에 없으면(연결도 추가도 안 됨) 「다름」으로 본다.** 적용은 그 참조를
  `null` 로 투영하지만, 로컬 용어가 도메인 없음일 때 그것을 「같음」으로 보고 연결하면 승격 계획
  (라이브러리 공간 비교: 로컬 `null` vs 원본의 도메인)이 `update` 를 내 **원본 용어의 도메인 참조를
  `null` 로 덮는다** — 위와 같은 부류다. 그래서 도메인이 내용이 달라 연결되지 않으면 그 용어도 함께
  연결되지 않는다(`domainId` 가 다른 필드로 보인다).
- **규칙은 결정을 만드는 쪽에 있다.** `applyResyncPlan` 은 받은 `adopt` 를 조건 없이 적용한다 — core API 로는
  내용이 다른 adopt 도 유효하다(`--conflicts ours` 가 그 경로다). **새 adopt 소비처가 `planAdoption(…, { sameContentOnly: true })`
  를 거치지 않고 adopt 결정을 넘기면 이 결함이 되살아난다.**
- `resource-sync.test.ts` 의 `planAdoption — 내용이 같은 항목만 연결` 블록(「내용이 달라 배정되지 않은 원본은
  대상을 차지하지 않는다 …」, 「원본 용어의 도메인이 색인에 없으면(연결되지 않음) 로컬이 도메인 없음이어도
  다르다」, 「내용이 같아 연결한 항목은 이후 승격 계획에서 update 가 아니다(동기 상태)」)이 잠근다.

### 같은 원본이 두 번 — 출처 중복 충돌

**한 프로젝트에서 같은 `(kind, origin.libraryId, origin.sourceId)` 를 가진 엔티티는 하나여야 한다.**
둘이면 재동기화가 한쪽만 연결 대상으로 잡고(아래 「알려진 한계」) 다른 쪽은 영원히 옛 값으로 남는다.

- **CLI 가 이 상태를 만들 수 있다.** `dict pull` 은 로컬 파일 모델에서 새 항목에 **무작위 id** 를 준다. 같은
  원본을 서버 쪽이 먼저 받았으면(다른 사람의 `dict pull` + `push`, 웹 가져오기) 이쪽의 `push` 에서 3-way 가
  id 가 다른 둘을 각각 「로컬 추가」·「서버 전용 유지」로 보고 **둘 다 남긴다.** 무결성 검사도 통과한다.
  웹 가져오기만으로는 이 경로가 없다 — 서버 모델 하나에서 직렬화되고 기존 출처 색인을 본다.
- **그래서 `file-merge.ts` 의 `mergeModels` 가 병합 결과를 따로 보고 `duplicate-origin` 충돌을 세운다.** 필드
  병합은 id 단위라 이것을 볼 수 없다. 자리가 병합기인 것은 「누가 만들었나」를 판정할 base·로컬·서버 셋을
  다 아는 곳이 여기뿐이고, 충돌 타입·경로·보고 파이프라인과 `push`·`diff` 두 호출자가 함께 따라오기
  때문이다.
- **로컬이 만든 중복만 막는다** — 「로컬의 출처가 결과에 실렸고 base 의 출처와 다르다」. 서버에 이미 둘이
  있는 상태는 이 push 가 고칠 수 없으므로, 막으면 그 프로젝트의 **모든 push 가 영원히** 막힌다.
- **갈래가 둘이고 지울 것이 다르다.** 로컬이 **새로 추가한** 항목(base 에 없음)이면 경로는 사전 파일,
  필드는 `*` — 그 항목을 지운다. 로컬이 **기존 항목에 출처를 붙였으면** 경로는 `origins.yaml`, 필드는 출처
  — 출처 줄만 지워 연결을 푼다(항목을 지우면 서버의 기존 데이터가 지워진다). 사람용 문구와 `erdd pull` 을
  권하지 않는 이유는 [cli.md](cli.md) 「`origin` 은 파일이 진실인 일반 병합 필드다」.
- 원본 id 가 같아도 라이브러리가 다르면 중복이 아니다. `file-merge.test.ts` 의 `출처 중복` 블록과
  cli `push.test.ts` 「로컬이 추가한 항목이 서버 항목과 같은 공용 사전 원본을 가리키면 충돌로 막는다」가 잠근다.

---

## 승격 — 가져오기의 반대 방향

`resource-promote.ts`(`planPromote` 3상태 분류 / `applyPromotePlan` write + `origin` 갱신)와
프로시저 `resource.promote` 다. 가져오기와 대칭이지만 규칙이 셋 더 있다.

- **`origin.base` 는 승격에서도 「가져오기 직후」와 같아야 한다.** 라이브러리에 쓴 payload 를
  **다시 프로젝트 공간으로 투영한 값**을 넣는다(프로젝트의 현재 payload 를 그대로 넣으면 안 된다).
  정상 케이스는 왕복이 항등이라 곧바로 동기 상태가 되고, **도메인을 빼고 올린 용어**는
  `base.domainId = null ≠ 현재값` 이라 「프로젝트가 고침」으로 잡혀 나중에 자동 갱신이 도메인 연결을
  조용히 지우는 사고가 **구조적으로 막힌다.** core 테스트가 양방향으로 고정한다.
- **「도메인 연결 비움」 판정은 core `resource-promote.ts` 의 `danglingDomain` 한 곳이다.** 용어의
  `domainRef.targetItemId` 가 `null`(도메인이 라이브러리에 없음)이고 그 도메인이 이번 선택에 없으면, 승격된
  라이브러리 용어의 `domainId` 가 `null` 로 들어간다. 웹 승격 화면의 배지와 CLI `dict push` 의 행 표시·
  `danglingDomain` 이 같은 함수를 부른다 — **한쪽만 알리면 다른 쪽에서 조용히 빈다.** 판정 집합은 소비처의
  **최종 선택**이다(CLI 는 `--kind`·`--name`·원본 앞섬 제외·동명 제외 뒤). 두 소비처 모두 막지 않고
  알리기만 한다.
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
- **`sourceBehind` 인 항목은 기본 선택하지 않는다.** `planPromote` 의 `status` 는 payload 비교라
  「프로젝트가 고쳤다」와 「프로젝트가 가져온 뒤 **남이 원본을 고쳤다**」를 둘 다 `update` 로 낸다.
  뒤쪽을 올리면 남이 고친 원본이 이 프로젝트의 옛 값(요청 시점 값)으로 **조용히 되돌아간다** —
  `expectedTargetVersion` 은 계획 **이후**의 변경만 막으므로 이 경우를 잡지 못한다. 그래서
  `PromoteEntry.sourceBehind`(링크 항목이고 `origin.sourceVersion < targetVersion`)를 싣고, 소비처가
  기본 선택에서 뺀다 — 웹 `promote-selection.ts` 의 `initialSelection`(승격 탭·승인 다이얼로그 공통,
  배지는 `PromoteEntryList` 의 `audience` 로 화면별 문구), CLI `dict push`(`--name` 으로 지정해도 빼고
  `behind` 로 알린다). **새 소비처가 `status !== 'name-match'` 만으로 기본 선택을 만들면 이 결함이 되살아난다.**
  **덮어쓰기는 원본의 최신 값을 보고 나서 한다** — 정상 경로는 재동기화로 원본을 먼저 보는 것이고,
  「프로젝트 유지」(`keep`)가 `origin` 을 원본의 새 버전으로 올리므로 그 뒤에는 `sourceBehind` 가 풀리고
  의도한 덮어쓰기가 `update` 로 올라간다.
  - **`PromoteStatus` 에 새 값을 두지 않고 필드로 둔 이유** — 상태는 서버 계약이다. 클라가 보내는
    `expectedStatus`(`resource.promote`·`promotion.resolve` 입력 스키마의 enum)를 서버가 락 안에서 다시 계산한
    상태와 대조한다. 새 상태를 만들면 입력 스키마가 바뀌어 옛 클라이언트(새 서버 + 옛 CLI)가 거절되고, 사람이
    알고 체크한 덮어쓰기도 쓰기는 똑같은 `update`(`targetVersion + 1`)인데 다른 이름으로 보내야 한다. 표시·기본
    선택만의 신호라 계약 밖의 필드로 둔다 — 서버는 이 필드를 보지 않는다.

---

## 요청·승인 큐

`promotion_requests` + `promotion.*` 프로시저. 라이브러리 쓰기 권한이 없는 Editor 의 요청 경로다.

- **승격의 유일한 엔진은 `apps/server/src/services/promote.ts` 의 `runPromoteInTx` 다.**
  `resource.promote`(직접 승격)와 `promotion.resolve`(요청 승인)가 이것을 공유한다.
  세 번째 승격 경로를 만들면 반드시 이 함수를 거쳐야 하고, **`prepare` 훅 밖에서 부르면**
  프로젝트 행 락 밖에서 라이브러리를 쓰게 된다.
  - **CLI `erdd dict push` 는 세 번째 경로가 아니다.** 토큰으로 `resource.promote`(쓰기 권한) 또는
    `promotion.create`(없으면)를 부를 뿐이고 판정·쓰기는 서버가 락 안에서 다시 한다. CLI 에 payload 를
    받는 승격을 만들면 요청 행이 별도의 진실 원본이 되고 `origin.base` 를 다시 유도해야 한다(아래
    「요청 행은 엔티티 포인터만 담는다」).
  - 라이브러리 항목 조회도 같은 파일의 `loadLibraryItems` 하나뿐이어야 한다 — 요청 시점
    (`promotion.create`)과 승인 시점(`runPromoteInTx`), 그리고 CLI 가 계획을 세우는
    `resource.items.list` 가 **같은 값을 계산해야 하고**, 그 함수의 `(createdAt, id)` 오름차순이
    `planPromote` 의 동명 선점 순서를 정하므로 한쪽만 바뀌면 판정이 갈린다. 동률을 id 로 깨는 것은
    한 트랜잭션의 승격이 넣은 행의 `createdAt` 이 전부 같아서다. `token-api.test.ts` 의 두 테스트가
    createdAt 순과 동률 id 순을 잠근다.
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
- **`planPromote` 의 엔티티 id 정렬(`sortedResourceEntities`)은 아직 `localeCompare` 다.** 재동기화 쪽이 지키는
  「동률 깨기에 로케일을 쓰지 않는다」가 여기서 샌다. 동명 선점을 클라와 서버가 같은 규칙으로 판정해야 하는
  자리라, 로케일이 다른 두 환경에서 대소문자가 섞인 id 가 오면 판정이 갈릴 수 있다. 서버가 발급한 uuid
  (소문자 hex)만 있으면 순서가 같다. 고친다면 `resource-sync.ts` 의 후보 정렬과 같은 코드 단위 비교로 바꾸고
  잠금 테스트를 함께 둔다.
- **`FOR UPDATE` 는 기존 행만 잠근다.** 서로 다른 프로젝트가 동시에 승격하면 같은 이름의 항목이
  2개 생길 수 있다 — `resource_items` 에 `(library_id, kind, name)` 유니크 제약이 없다.
  데드락 경로도 이론상 존재한다(승격은 항목→라이브러리 순, `library.remove` 는 반대).
- **동명 판정이 표시 이름 완전일치다**(공백·대소문자 정규화, 동의어 매칭 없음). 대상에 동명이
  여럿이면 `(createdAt, id)` 첫 항목을 고르고 **사용자가 지목할 수 없다.**
- 프로젝트에서 지운 항목이 원본에서 사라지지는 않는다(반대 방향의 보수적 정책과 대칭).
- `parsePayload` 실패가 400 으로 매핑된다(서버측 결함인데 클라 입력 오류로 보인다).
  `entries` 에 같은 `entityId` 가 중복되면 조용히 흡수된다.
- 승격 진행 중에도 체크박스·일괄 버튼이 활성이다(제출 버튼만 비활성). 탭을 전환하면 재동기화 탭의
  진행 중 선택이 초기화된다.
- `EntryLabel` 이 재동기화 탭과 승격 탭에 거의 동일하게 중복이고, `resource-panel.tsx` 의
  `as LibraryRow[]` 캐스트가 서버/클라 shape 드리프트를 컴파일에서 놓친다.
- **재동기화에 남은 순서 의존은 모델 쪽 하나다.** 같은 `(kind, origin.sourceId)` 를 가진 엔티티가
  둘이면 `planResync` 가 모델 순회 순서상 마지막 것을 연결 대상으로 잡는다. 모델이 이미 비정상(출처
  중복)인 경우라 라이브러리 항목 순서 문제는 아니다. push 가 **로컬이 만든** 출처 중복을 충돌로 막으므로
  (위 「같은 원본이 두 번」) CLI 경로로는 새로 생기지 않지만, **이미 서버에 둘이 있는 상태는 막지도 알리지도
  않는다** — 그 push 가 고칠 수 없는 상태로 모든 push 를 막게 되어서다. 알리려면 자리는 `validate`(모델
  무결성 경고)이고, 정리는 한쪽의 출처를 떼는 것이다.

### 요청·승인 큐

- **알림이 폴링 배지뿐이다.** 승인자가 로그인해 있지 않으면 모른다. 메일 발송이 선행 결정이다
  (→ [../ops/known-issues.md](../ops/known-issues.md)).
- **배지는 `bare` 라우트(에디터)에는 뜨지 않는다.** 실제 도달 범위가 「`AppShell` 을 쓰는 화면」이라
  **프로젝트 오너가 에디터에 오래 머무는 동안에는 대기 요청을 못 본다.** 승인 동선이 홈·조직 화면이라
  치명적이진 않으나 설계가 약속한 「어느 화면에 있든 보인다」와 실제가 다르다.
- **웹에서는 요청자가 자기 요청의 반려 사유를 볼 수 없다.** 조직 승인 화면에는 상태 필터가 있어
  `resolutionNote` 를 읽을 수 있지만 **프로젝트 승격 탭의 요청 목록은 `pending` 고정**이다.
  서버 `listForProject` 는 `status` 를 지원하고 CLI `erdd dict requests` 는 처리 메모를 보이므로
  **막힌 것은 웹 UI 뿐이다.**
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
