# 데이터 계층 — op 로그·엔티티 등록·하위호환

모델 변경의 유일한 경로와, 새 엔티티·새 필드를 더할 때 등록해야 하는 자리를 갖는다.
**여기 있는 것은 어겼을 때 실제로 버그가 났던 것들이다.**

---

## 데이터 계층의 형태

- **정규화 상태 테이블(source of truth) + append-only `revisions` op 로그.** 모든 모델 변경은
  op(create/update/delete)로만 일어난다. 단일 파이프라인 `runMutation`
  (`apps/server/src/services/mutation.ts`)이 프로젝트 행 `FOR UPDATE` 락으로 직렬화한다.
- **클라이언트는 producer + diff 패턴이다.** UI 가 「다음 모델」을 만들고 `diffModels` 가 op 배치를
  도출 → 낙관적 `setModel` → 전역 `serializeMutation` 체인.
  `useModelMutation(projectId)` → `mutate(producer, { summary })`.
- id 는 클라이언트가 만드는 UUIDv7(`newId()`)이다.
- **실시간 전파까지 포함한 진입점은 `mutateAndPublish` 다** — [realtime.md](realtime.md) 첫 절.

### ⚠️ 한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이 나눠 보낸다

`apps/server/src/routers/model.ts` 가 `model.mutate`·`model.push` 의 `ops` 를 zod 로 이 값까지만 받고
Fastify `bodyLimit` 도 함께 올려 뒀다. 로컬 모드의 저장소(`packages/cli/src/local/store.ts`)도 같은 값으로
막는다. **상한은 요청 하나의 크기다** — 본문 크기·트랜잭션 시간·실시간 방송 크기를 예측 가능하게 둔다.

- **웹은 넘는 편집을 막지 않고 나눠 보낸다.** 자르는 곳은 모델 변경의 저수준 단일 경로(`use-model.ts` 의
  `useSubmit`) 한 곳이다 — 정상 편집·실행 취소·다시 실행이 모두 거기를 지나므로 소비처(재동기화 적용·Excel
  사전 가져오기·일괄 삭제·DDL 가져오기·용어 전파)는 나눔을 모르고 진행 콜백(`onProgress`)만 받는다.
  **소비처에 상한 가드를 다시 두지 마라** — 서버가 받아 줄 편집을 UI 가 헛되이 막는다.
- **「편집 1건 = 실행 취소 1회」는 그대로다. 「Revision 1건」은 5,000 op 이하에서만 참이다.** 나눠 보낸 편집은
  조각 수만큼 Revision 이 쌓이고 요약에 `(1/4)` 가 붙는다(`mutation-chunks.ts` 의 `chunkSummary` — 요약이
  없으면 「대량 편집」, 서버의 요약 상한 200자를 넘지 않게 원래 요약을 자른다). 실행 취소 기록은 전체 `Op[]`
  하나라 한 번 눌러 전부 되돌아가고, 그 역연산도 같은 경로로 나뉘어 간다.
- ⚠️ **조각 순서가 정확성 조건이다.** 서버는 조각 하나를 독립된 mutation 으로 적용하므로 각 조각까지 적용한
  중간 상태가 무결성을 만족해야 한다. `diffModels` 가 낸 순서 그대로 자르면 성립한다 — 추가는 부모 먼저,
  갱신이 그 뒤, 삭제는 자식 먼저라 모든 접두사가 무결하다(아래 「`ENTITY_KINDS` 순서는 정확성 제약이다」).
  `packages/core/src/diff-prefix.test.ts` 가 참조가 걸린 대량 diff 를 5,000 경계가 참조 사이에 오게 만들어
  잠근다. **자르기 전에 op 를 재정렬·필터하지 마라.**
- **중간 조각이 실패하면 원자적이지 않다.** 앞 조각은 서버에 남는다. 웹은 거기서 멈춰 서버 상태로
  되맞추고(`resync` — 실행 취소 기록이 비워진다) 「4개 묶음 중 2개를 적용했고 나머지는 적용하지
  못했습니다 — 〈오류〉」를 띄운다(`chunkFailureMessage`). 반쯤 들어간 편집을 실행 취소 1회로 기록하면 되돌릴
  op 가 서버 상태와 어긋난다. 첫 조각의 실패는 나누지 않은 편집의 실패와 같다. 조각 사이에 남의 편집이 끼면
  (응답 `seq` 간극) 남은 조각을 끝까지 보낸 뒤 `resync` 한다.
- **도중에 다른 프로젝트로 옮겨도 남은 조각은 끝까지 옛 프로젝트로 보낸다.** 나누지 않는 경로는 요청이 이미
  떠난 뒤라 서버가 편집 전체를 적용하므로, 멈추면 나눈 편집만 반쪽이 서버에 남고 이탈한 사용자는 진행 표시도
  못 본다. 옮긴 뒤로는 새 프로젝트의 store(모델·`seq`·실행 취소 기록·선택)를 건드리지 않는다 — 돌아와도
  마찬가지다(그 사이 새로 받은 상태 위에 이 편집의 `seq`·기록을 얹으면 어긋난다). 남은 조각이 실패하면
  `chunkFailureMessage` 토스트만 띄우고 되맞추지 않는다.
- 조각을 보내는 동안 내 다른 편집·실행 취소·실시간 수신은 모델 변경 체인(`serializeMutation`)에서 모든 조각
  뒤로 줄을 선다. 로컬 모드의 저장이 조각 사이에 끼지 않는 방어선은 [editor-state.md](editor-state.md)
  「저장은 편집 중인 입력을 먼저 반영한다(로컬 모드)」.
- CLI `push` 는 나눠 보내지 않는다 — [cli.md](cli.md) 「알려진 한계」의 「push·병합」.

### ⚠️ diff 함수가 두 개다. 용도를 섞지 마라

- **`diffModels`(`packages/core/src/diff.ts`) → `Op[]`.** **적용용**이고 FK 안전 순서로 정렬된다.
  스냅샷 복원·CLI push(`applyMerge` 결과 위에서 호출)가 의존하는 **불가침 함수**다.
- **`diffModelsForDisplay`(`packages/core/src/model-diff.ts`) → `ModelDiff`.** **표시용**이고 사람이
  읽는 순서로 정렬, 이름 해석, 배치 좌표 제외, 참조형 속성(id) → 이름 변환을 한다.
- **판정과 표시를 분리한다.** 변경 감지는 원시 값(`formatValue`)으로만 하고 이름 해석
  (`formatFieldValue`)은 표시에만 쓴다. 판정이 이름 기준이 되면 **도메인 이름만 바꿔도 그 도메인을
  쓰는 컬럼이 전부 「변경」으로 잡힌다.**

---

## 새 op 엔티티를 추가할 때 (체크리스트)

현재 엔티티 10종: `tableGroup, domain, word, term, customField, table, column, relationship, index, note`

등록해야 하는 **여섯 곳**:

1. `packages/core/src/op.ts` — `ENTITY_KINDS`
2. 같은 파일 — `ENTITY_SCHEMAS`
3. 같은 파일 — `COLLECTION_BY_KIND`
4. 같은 파일 — `applyOps` 초기 `next` spread (옛 모델 방어로 `{ ...(model.x ?? {}) }`)
5. `packages/core/src/integrity.ts` — `IntegrityIssue['entity']` union + `collections` 배열
   (+ 참조 검사)
6. `apps/server/src/services/model-store.ts` — `TABLE_BY_KIND` + `loadProjectModel` 매핑

**일곱 번째 등록처는 `model-diff.ts` 의 `KIND_ORDER` 다.** 그 배열을 순회해 표시용 diff 를 만들기
때문에 누락하면 **그 종류가 정의서에서 조용히 빠진다** — 완전성 테스트가 `ENTITY_KINDS` 와 대조해
잡는다. 같은 파일의 `FIELD_LABEL` 도 함께 채워야 한다(**누락해도 테스트는 통과하고** 필드명 원문이
화면에 노출될 뿐이다).

추가로 놓치기 쉬운 곳: `apps/server/src/services/mutation.ts` 의 `KIND_LABEL`(없으면 요약이
`undefined 생성` 이 된다), `apps/server/src/testing/helpers.ts` 의 `withUuidIds`(fixture id 리매핑).

### ⚠️ `ENTITY_KINDS` 순서는 정확성 제약이다

`diffModels` 는 creates 를 이 배열 순서로, deletes 를 역순으로 낸다. `persistOps` 는 그 순서대로
SQL 을 실행하고 **FK 는 NOT DEFERRABLE 이다.** → **참조 대상(부모)을 참조하는 쪽(자식)보다 앞에
둬야 한다.** 어겼을 때 스냅샷 복원(`diffModels(current, snap.model)` 단일 배치)이 FK 위반으로 500 이
났다. 새 참조 엔티티는 **diff 순서 테스트**(부모 create idx < 자식 create idx, 자식 delete idx <
부모 delete idx) + **실 DB 단일 배치 persist 테스트**를 반드시 추가한다.

### ⚠️ 임시 `persistOps` 가드는 `OpApplyError` 로 throw 한다

엔티티를 `ENTITY_KINDS` 에 넣는 태스크와 서버 `TABLE_BY_KIND` 배선 태스크가 나뉘면 중간에 임시
가드를 넣게 되는데, plain `Error` 면 라우터 catch(`OpApplyError` 만 400)를 못 타 **미제어 500** 이
된다(두 번 재발했다). `@erdd/core` 의 `OpApplyError` 를 쓰고 「해당 op → 400」 회귀 테스트를 남긴다.

---

## 이미 등록된 엔티티에 **필드**를 추가할 때

**엔티티 종류를 더하는 것과 다른 유지보수 범주다. 하나로 이어 세지 마라.**

- **`FILE_FIELDS` / `FILE_INVISIBLE_FIELDS`(`packages/core/src/file-merge.ts`)** — 그 필드를 CLI
  파일에 **보이는 것**인지 **안 보이는 것**인지 분류한다. 분류하지 않으면 `file-merge.test.ts` 의
  분류 완전성 테스트가 깨진다(zod shape 과 실제 필드 집합을 대조해 자동으로 잡는다).
- **`packages/core/src/file-format.ts` 의 쓰기·읽기** — 실제 YAML.
  ⚠️ **`FILE_FIELDS` 만 넣으면 완전성 게이트는 통과하는데 CLI 왕복이 성립하지 않는다.**
  - **필드를 별도 파일로 뺄 때는 `TOP_LEVEL_FILES` 에 등록한다** — 사전 4종의 `origin` 이 그렇게
    `erdd/origins.yaml`(`ORIGINS_FILE`)로 나가 있다. 등록하지 않으면 CLI `tree.ts` 의 `readTree` 가
    그 파일을 읽지 않고(`push`·`diff`·`status` 가 못 본다) `writeTree` 가 지울 대상에서도 빠지며,
    `dict pull` 의 쓰기 대상(`DICTIONARY_FILES`)에도 들지 않는다.
  - ⚠️ **새 파일은 `TOP_LEVEL_FILES` 의 끝에 붙인다.** `file-merge.ts` 가 앞 다섯
    (groups·words·terms·domains·custom-fields)을 **위치로 구조분해**해 엔티티 → 경로 표를 만든다.
    중간에 끼우면 타입 오류 없이 경로가 한 칸씩 밀려, 충돌·삭제 보고가 엉뚱한 파일을 가리킨다.
    `ORIGINS_FILE` 이 마지막 원소인 이유가 이것이다.
- **`model-diff.ts` 의 `FIELD_LABEL`** — ⚠️ **누락해도 테스트가 통과한다.** `IGNORED_FIELDS` 에
  없으면 표시용 diff 에는 잡히므로 폴백이 **영문 원문**을 낸다. 새는 곳 셋: 웹 스냅샷 비교 화면 ·
  변경분 Excel · CLI `erdd diff`. 라벨 단언 1건이면 잠긴다.
- 스키마(`packages/core/src/model.ts`), 그 엔티티의 생성·수정 함수, `db/schema.ts` + 마이그레이션,
  `model-store.ts` 의 `loadProjectModel` 매핑.
  ⚠️ **`loadProjectModel` 은 컬렉션을 전부 손으로 나열한다.** drizzle 이 행을 통째로 주기는 하지만
  `ProjectModel` 로 옮기는 것은 **손으로 적은 매핑**이라 자동으로 따라오지 않는다.

---

## 하위호환 (스냅샷·옛 리비전)

- **모델에 새 컬렉션을 추가하면 `ProjectModelSchema` 에서 `.default({})`.** 단 **`z.infer` 출력
  타입은 필수**이므로 `: ProjectModel` 리터럴(fixtures, model-store 반환 등)에는 전부 키를 추가해야
  한다(typecheck-driven 으로 훑는다).
- **엔티티에 새 필드를 추가하면 `.nullable().default(null)`**(옛 op 페이로드 파싱).
  예외가 하나 있다 — 그룹 별칭은 `null` 이 아니라 **빈 문자열**이고 DB 컬럼도
  `text NOT NULL DEFAULT ''` 다([naming.md](naming.md) 「그룹 별칭」 절).
- **스냅샷 복원은 정규화가 필수다.** `snapshot.ts` 의 restore 가
  `diffModels(current, { ...createEmptyModel(), ...snap.model })` 로 누락 컬렉션을 보충한다.
  새 컬렉션을 추가해도 이 패턴 덕에 옛 스냅샷이 깨지지 않는다 — **제거하지 마라.**
  - 단 이 정규화는 **컬렉션 키만** 보충하고 **엔티티 필드**는 안 채운다. 옛 스냅샷의 엔티티에 새
    필드가 없으면 `diffModels` 가 그 차이를 감지하되 **빈 `changes` 의 update op 는 만들지 않는다**
    (`diff.ts` 가 target 기준으로 실변경 없으면 op 를 내보내지 않도록 방어한다).
    **새 엔티티 필드를 추가할 때는 이 케이스(구 스냅샷에 필드 없음)를 회귀 테스트로 남겨라.**

---

## core 규칙

- **`packages/core` 는 IO·런타임 의존성 free 다**(순수 도메인 로직). 레이아웃 계산용 dagre 같은 것은
  `apps/web` 에만 둔다. Excel 의 `exceljs` 도 `apps/web` 에만 두고 **동적 `import()` 로만** 쓴다
  (초기 번들 영향 없음) — 양식 정의·파싱 규칙 자체는 core 의 순수 함수(`excel-sheets.ts` /
  `excel-import.ts`)다.
- DDL 은 `generateDdl(model, dialect, scope)` 시그니처가 불변이고, 경고는
  `ddlWarnings(model, dialect, scope)` 로 분리돼 있다.
- **Excel 왕복 계약:** 내보내기 헤더 배열과 업로드 파서가 같은 상수를 공유해, 내보낸 파일을 그대로
  다시 올릴 수 있다(단어·용어·도메인 3시트). 양식 다운로드도 같은 빌더를 쓴다. 유일한 예외는
  용어사전의 `구성 단어`(파생값 — 업로드 시 무시).

---

## 알려진 한계

### 모델·op

- **모델 밖 테이블을 같은 트랜잭션에서 써야 하면 `runMutation` 의 `prepare(tx, model)` 훅을 쓴다.**
  훅 없이 `runMutation` 을 직접 부르면 브로드캐스트를 손으로 발행해야 하고 그 순간
  [realtime.md](realtime.md) 첫 불변식이 깨진다. 자세한 것은 그 문서.
- **`loadProjectModel` 의 `SELECT` 에 `ORDER BY` 가 없다.** 행 순서에 의존하는 판정을 새로 만들면
  클라이언트와 서버가 서로 다른 결론을 낼 수 있다 — 승격이 그것을 겪어
  `planPromote` 가 **id 오름차순 정렬 뒤** 판정한다([shared-resources.md](shared-resources.md)).
- **모든 접두사 무결성은 컬럼의 소속 테이블을 바꾸는 update 에서는 성립하지 않는다.** `diffModels` 는 갱신을
  종류 순으로 내므로, 컬럼의 `tableId` 를 바꾸는 update 와 그 컬럼을 가리키는 관계·인덱스 update 사이에서
  자르면 중간 상태가 「매핑 컬럼이 없거나 소속 테이블이 다름」이 된다. 웹에는 컬럼을 다른 테이블로 옮기는
  편집이 없어 나눠 보내기가 이 모양을 만나지 않는다. 그런 편집을 만들면 조각 경계를 참조 단위로 조정해야
  한다(자리는 `use-model.ts` 의 `chunkOps` 호출).
- **나눠 보낸 편집의 Revision 은 이력 화면에서 묶여 보이지 않는다** — 요약의 `(1/4)` 로만 알아본다. 대량 편집의
  실시간 방송도 조각마다 한 번이라 다른 참여자의 화면은 조각 단위로 바뀐다.
- **나눠 보낸 편집의 중간 실패는 원자적이지 않다**(위 「한 요청의 op 상한은 …」). 되돌리려면 버전 화면에서 이전
  스냅샷으로 복원한다 — 조각 전체를 한 트랜잭션으로 묶으면 상한이 지키려던 트랜잭션 시간·방송 크기를 다시
  잃는다.
- **`applyOps` 는 사전과 무관한 op 에도 `words`/`terms` 레코드를 새로 복사한다.** 명명 파생 구조는 레코드
  객체를 키로 캐시하므로([naming.md](naming.md) 「분해 경로는 성능이 걸려 있다」) 원격 op·실행 취소마다 사전
  색인을 다시 만든다 — 대용량 사전에서 op 한 번에 경고 계산 10~15ms 가 더 든다(단어 3,280·용어 13,159·컬럼
  3,000 모델에서 `computeWarnings` 를 매번 새 `words`/`terms` 레코드로 불러 잰 값, jsdom·vitest).
  필요해지면 op 가 그 컬렉션을 실제로 건드릴 때만 복사(copy-on-write)하면 되는데, 그러면 `applyOps` 가 입력
  모델과 컬렉션을 공유하게 되므로 `validateModelIntegrity` 와 호출처의 가정을 함께 봐야 한다.

### 도메인

- `resolveColumn` 의 빈-오버라이드·dangling `domainId` 를 명시적으로 잠그는 테스트가 없다.
- 도메인 삭제 요약 문구와 `usageOf` 의 스냅샷 타이밍이 미검증이다(단일 사용자 범위 밖).

### 커스텀 항목

- **조직 표준 템플릿(→ 프로젝트로 가져오기)이 없다.** 사전·도메인과 통합 설계가 선행이다.
- 커스텀 항목이 있는 상태에서 **그 이전 스냅샷(값 없음)을 복원하는 회귀 테스트가 없다.**
  관대 정책상 정의는 삭제되고 값은 dangling 으로 남는 것이 의도된 동작이다 — 고정 테스트를 붙일 자리다.
- 테이블 scope 값 커밋 경로(`setCustomValue(m,'table',...)`) 전용 통합 테스트가 없고,
  **자동 저장 금지 가드**(정의 기본값 표시 중 blur 해도 저장 안 됨)의 고정 테스트도 없다.
- **「필수」 배지가 섹션 단위라 여러 필수 항목이 있을 때 어떤 항목이 비었는지 안 보인다.**
- **boolean 필드에는 required 표식(`*`)이 없다.** 현재 UI 로는 `required:true` 인 boolean 을 만들 수
  없어 도달 불가지만, fork·가져오기로 우회 생성되면 드러난다.
- `custom-fields-section.tsx` 의 text 입력(blur 커밋)이 `edit-panel.tsx` 의 `CommitInput` 과 의미상
  중복이다. 공용 파일 추출 여지가 있는데 `edit-panel` 에서 import 하면 순환이라 별도 파일이 필요하다.

### 초기 MVP 잔여

- 측정 bbox 기반 그룹 영역 크기 산정(현재는 추정치).
- 자동 정렬 방향 토글(TB/LR) — 현재 TB 고정.
- `toolbar.tsx` 의 `visibleTables` 가 raw `activeGroupView` truthy 만 판정한다(그룹 삭제 중 스테일
  뷰에서 자동정렬 버튼이 비활성). 캔버스의 유효-뷰 계산과 통일할 자리다.
