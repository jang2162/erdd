# ERDD 작업 인계 문서 (새 세션 시작점)

**최종 갱신:** 2026-08-01 / **main HEAD:** `9dbdeef` / **마이그레이션:** 0009까지

새 세션에서 이 프로젝트를 이어받을 때 **이 문서를 먼저 읽고**, 아래 "읽을 문서" 순서를 따르면 된다. 이 문서는 매 sub-project 완료 시 갱신한다.

---

## 1. 현재 상태 요약

### 완료 (main에 머지됨)

| 단계 | 내용 |
|---|---|
| **Phase 1 (MVP)** M0~M9 | 계정/조직/프로젝트, GUI 에디터(테이블·컬럼·관계·인덱스·메모), 그룹핑(색상영역·그룹뷰·외부참조 고스트), 버전(Revision 이력·스냅샷·복원), 내보내기(DDL 4방언·이미지 PNG/SVG) |
| **Phase 1 이월 정리** M10 + 후속 | 그룹 영역 드래그, 자동 정렬(dagre), DDL 식별자 조건부 인용(방언별 예약어), 0컬럼 DDL 제외+경고 통합, 그룹 라벨 가림 해소, 중복 헬퍼 통합 |
| **Phase 2 #1 도메인** | 도메인 CRUD·컬럼 지정(라이브 해석·타입란 잠금)·일괄반영·삭제가드·DDL 통합(방언타입·CHECK·기본값), 마이그 0004 |
| **Phase 2 #2 명명 체계** | 단어/용어 op 엔티티, 물리명 자동생성(용어일치→최장일치 분해), 명명 경고 5종(기존 computeWarnings 확장), 사전 관리 화면, 자동생성 에디터 통합, 명명 검사 화면, 마이그 0005 |
| **Phase 2 #3 커스텀 항목** | 정의=10번째 op 엔티티 `customField`(도메인/사전과 동일 패턴), 값=`table.custom`/`column.custom`(문자열, 기본값 라이브 해석, dangling 키 관대). 필수 미입력 경고(`custom-required`), 정의 관리 화면, 편집 패널 인라인 값 입력(text/boolean/select), 검사 화면 표시명 "모델 검사"로 정리, 마이그 0006 |
| **Phase 2 #4 공용 리소스 fork** | 전역·조직 2계층 라이브러리(`resource_libraries`/`resource_items`, op 로그 밖), 모델 4종(domain/word/term/customField)에 `origin` 필드, 3-way 병합 엔진(core `resource-sync.ts` 순수 함수), 프로젝트 "공용 리소스" 통합 화면(가져오기=재동기화 같은 경로), 충돌 항목별 3상태 라디오, 전역 예시 시드, 마이그 0007·0008 |
| **Phase 2 #5 Excel 산출물/업로드** | 정의서 Excel 내보내기 5시트(테이블 목록·테이블정의서·단어사전·용어사전·도메인정의서, 커스텀 항목 컬럼 포함), Excel 사전 업로드(신규/중복/오류 미리보기 + 건너뛰기·덮어쓰기), 양식 다운로드, 범위 선택기 공용화(그룹 드롭다운), `Word.englishName` 추가, 마이그 0009 |

| **Phase 3 #1 스냅샷 diff** | 표시 전용 `diffModelsForDisplay`(core 순수 함수 — 기존 `diffModels`(Op[])는 불가침), 버전 다이얼로그 "비교" 섹션(기준/비교 각각 선택: 현재+스냅샷), 변경분 정의서 Excel(한 시트 flat, 1행 제목·2행 헤더), 배치 좌표 제외, 참조형 속성 이름 해석. **서버 변경·마이그레이션 없음** |
| **Phase 3 #2 실시간 동시편집** | `/ws?projectId=` WebSocket 채널(`@fastify/websocket`, 쿠키 인증·close code 4401/4403), 인메모리 `RealtimeHub`(프로젝트별 채널·같은 사용자 다중 소켓 병합), `mutateAndPublish`로 **커밋 후에만** op 브로드캐스트(모든 변경 경로의 유일한 진입점), 웹 `useRealtime`(seq 3분기: 연속 적용/과거 무시/간극 전체 리로드, 기존 `serializeMutation` 체인 재사용), presence 아바타 + 캔버스 선택 하이라이트, 충돌 토스트. **마이그레이션 없음** |

> **Phase 2 완료.** #4·#5는 병렬 worktree 2개로 동시에 진행해 순서대로 병합했다(머지 커밋 `1012e9d`, `d580028`).
> **Phase 3 완료.** 스냅샷 diff → 실시간 동시편집 순으로 각각 별도 사이클로 진행했다(머지 커밋 `9dbdeef`).

### 테스트 기준선 (이 상태에서 전부 그린이어야 정상)

```
core 271 · web 278 · server 88 (erdd_test) · pnpm -r typecheck → 0 errors
```

### 다음 작업

**권한 세분화 검토 → Phase 4(CLI·역설계)** (→ `docs/90-roadmap.md`, `docs/16-cli.md`)

Phase 1~3이 모두 main에 있다. 다음 후보는 (a) 권한 세분화(필요 시 그룹 단위 편집 권한 등), (b) Phase 4 CLI·DDL 역설계, (c) 6절 이월 항목 정리다. 과금은 "추후 검토"로 이동됨 — 최우선 목표는 조직 내에서 쓸 수 있는 도구 완성.

Phase 4 착수 전 `docs/91-checklist.md`의 **CLI 상세**(base 사본 저장 방식, push 충돌 출력 형식, `--json` 스키마, 패키지명 확정)·**에이전트 스킬 문서**·**DDL 역설계 범위** 확정이 필요하다.

> ⚠️ **CLI push는 세 번째 모델 변경 경로가 된다.** 반드시 `mutateAndPublish`(`apps/server/src/services/mutate-publish.ts`)를 거쳐야 한다 — `runMutation`을 직접 부르면 그 변경이 실시간 채널로 전파되지 않는다. 3.6절 참조.

## 2. 읽을 문서 (순서)

1. **이 문서** — 현재 상태·불변식·환경·워크플로
2. `docs/90-roadmap.md` — 단계별 범위(무엇이 어느 Phase인지)
3. 작업할 영역의 기획 문서 — `docs/13-naming.md`(명명), `docs/14-domain.md`(도메인/타입), `docs/15-custom-fields.md`(커스텀 항목), `docs/17-import-export.md`(내보내기/Excel), `docs/01-concepts.md`(공용 리소스 fork 패턴), `docs/11-collaboration.md`(버전/협업), `docs/02-architecture.md`(데이터 계층 원칙)
4. 직전 sub-project의 설계·계획(패턴 참고용) — `docs/superpowers/specs/2026-07-28-phase3-snapshot-diff-design.md`와 `plans/2026-07-28-phase3-snapshot-diff.md`
5. `docs/91-checklist.md` — 착수 전 결정 사항 추적(Phase 3 남은 항목 = 실시간 프로토콜 상세)

> `.superpowers/sdd/progress.md`(SDD 진행 원장)는 **git-ignored 스크래치**다. 세션이 바뀌면 신뢰하지 말고 이 문서 + `git log`를 기준으로 삼는다.

---

## 3. 아키텍처 불변식 (위반 시 실제 버그가 났던 것들)

### 3.1 데이터 계층
- **정규화 상태 테이블(source of truth) + append-only `revisions` op 로그.** 모든 모델 변경은 op(create/update/delete)로만. 단일 파이프라인 `runMutation`(`apps/server/src/services/mutation.ts`)이 프로젝트 행 `FOR UPDATE` 락으로 직렬화.
- **클라이언트는 producer + diff 패턴**: UI가 "다음 모델"을 만들고 `diffModels`가 op 배치를 도출 → 낙관적 `setModel` → 전역 `serializeMutation` 체인. `useModelMutation(projectId)` → `mutate(producer, { summary })`.
- id는 클라이언트 생성 UUIDv7(`newId()`).

### 3.2 새 op 엔티티를 추가할 때 (체크리스트)
현재 엔티티 10종: `tableGroup, domain, word, term, customField, table, column, relationship, index, note`

등록해야 하는 **6곳**:
1. `packages/core/src/op.ts` — `ENTITY_KINDS`
2. 같은 파일 — `ENTITY_SCHEMAS`
3. 같은 파일 — `COLLECTION_BY_KIND`
4. 같은 파일 — `applyOps` 초기 `next` spread (옛 모델 방어로 `{ ...(model.x ?? {}) }`)
5. `packages/core/src/integrity.ts` — `IntegrityIssue['entity']` union + `collections` 배열 (+ 참조 검사)
6. `apps/server/src/services/model-store.ts` — `TABLE_BY_KIND` + `loadProjectModel` 매핑

추가로 놓치기 쉬운 곳: `apps/server/src/services/mutation.ts`의 `KIND_LABEL`(없으면 요약이 `undefined 생성`), `apps/server/src/testing/helpers.ts`의 `withUuidIds`(fixture id 리매핑).

**⚠️ ENTITY_KINDS 순서는 정확성 제약이다.** `diffModels`는 creates를 이 배열 순서로, deletes를 역순으로 낸다. `persistOps`는 그 순서대로 SQL을 실행하고 FK는 NOT DEFERRABLE이다. → **참조 대상(부모)을 참조하는 쪽(자식)보다 앞에 둬야 한다.** 어겼을 때 스냅샷 복원(`diffModels(current, snap.model)` 단일 배치)이 FK 위반으로 500이 났다(도메인 sub-project에서 실제 발생). 새 참조 엔티티는 diff 순서 테스트(부모 create idx < 자식 create idx, 자식 delete idx < 부모 delete idx) + 실 DB 단일 배치 persist 테스트를 반드시 추가.

**⚠️ 임시 `persistOps` 가드는 `OpApplyError`로 throw.** 엔티티를 `ENTITY_KINDS`에 넣는 태스크와 서버 `TABLE_BY_KIND` 배선 태스크가 나뉘면 중간에 임시 가드를 넣게 되는데, plain `Error`면 라우터 catch(`OpApplyError`만 400)를 못 타 미제어 500이 된다(도메인·명명 두 번 재발). `@erdd/core`의 `OpApplyError`를 쓰고 "해당 op → 400" 회귀 테스트를 남긴다.

**⚠️ 한 뮤테이션의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이다**(`apps/server/src/routers/model.ts`, Fastify `bodyLimit`도 함께 올려 둠). 사전 일괄 등록처럼 "단일 뮤테이션 = Revision 1건 = undo 1회"를 지켜야 하는 기능은 이 천장에 걸린다 — 대량 배치를 만드는 UI는 **미리 막고 안내**한다(낙관적 반영 후 서버 거절로 되돌려지는 것을 사용자가 겪지 않도록). 원래 500이었는데 600단어 사전이 400으로 막혀 Excel 사이클에서 올렸다.

**⚠️ diff 함수가 두 개다. 용도를 섞지 마라.**
- `diffModels`(`diff.ts`) → `Op[]`. **적용용**이고 FK 안전 순서로 정렬된다. 스냅샷 복원·향후 CLI push가 의존하는 불가침 함수다.
- `diffModelsForDisplay`(`model-diff.ts`) → `ModelDiff`. **표시용**이고 사람이 읽는 순서로 정렬, 이름 해석, 배치 좌표 제외, 참조형 속성(id) → 이름 변환을 한다.
- `model-diff.ts`의 **`KIND_ORDER`가 사실상 7번째 엔티티 등록처**다(이 배열을 순회해 diff를 만든다). 누락하면 그 종류가 정의서에서 조용히 빠진다 — 완전성 테스트가 `ENTITY_KINDS`와 대조해 잡는다. `FIELD_LABEL`도 함께 채워야 한다(누락 시 필드명 원문이 노출될 뿐 테스트는 통과한다).
- **판정과 표시를 분리한다**: 변경 감지는 원시 값(`formatValue`)으로만 하고, 이름 해석(`formatFieldValue`)은 표시에만 쓴다. 판정이 이름 기준이 되면 도메인 이름만 바꿔도 그 도메인을 쓰는 컬럼이 전부 "변경"으로 잡힌다.

### 3.2b 공용 리소스(전역·조직 라이브러리)
- `resource_libraries` / `resource_items`는 **op 로그 밖의 일반 테이블**이다(프로젝트 모델이 아님). 프로젝트로 fork된 결과만 op 엔티티가 된다.
- 모델 4종(`domain`/`word`/`term`/`customField`)의 `origin` = `{ libraryId, sourceId, sourceVersion, base }`. **`base`는 가져온 시점에 프로젝트 공간으로 투영해 써넣은 payload**라, `payloadOf(현재) ≠ base` 하나로 "프로젝트가 고쳤는지"가 판정되고 3-way 병합 전체가 core 순수 함수(`resource-sync.ts`)로 닫힌다. 버전 이력 테이블이 없다.
- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → Revision 1건, undo 1회로 원복.
- 원본에서 삭제된 항목은 프로젝트에 그대로 둔다(삭제 제안 없음 — 프로젝트 독립성 원칙).

### 3.3 하위호환 (스냅샷·옛 리비전)
- 모델에 새 컬렉션을 추가하면 `ProjectModelSchema`에서 `.default({})`. 단, **`z.infer` 출력 타입은 필수**이므로 `: ProjectModel` 리터럴(fixtures, model-store 반환 등)에는 전부 키를 추가해야 한다(typecheck-driven으로 훑기).
- 엔티티에 새 필드를 추가하면 `.nullable().default(null)`(옛 op 페이로드 파싱).
- **스냅샷 복원은 정규화 필수**: `snapshot.ts` restore가 `diffModels(current, { ...createEmptyModel(), ...snap.model })`로 누락 컬렉션을 보충한다. 새 컬렉션을 추가해도 이 패턴 덕에 옛 스냅샷이 깨지지 않는다(제거하지 말 것). 단, 이 정규화는 **컬렉션 키만** 보충하고 **엔티티 필드**(예: `table.custom`)는 안 채운다 — 옛 스냅샷의 엔티티에 새 필드가 없으면 `diffModels`가 그 차이를 감지하되(커스텀 항목 sub-project에서 실제 발생), **빈 `changes`의 update op는 만들지 않는다**(`diff.ts`가 target 기준으로 실변경 없으면 op를 내보내지 않도록 방어). 새 엔티티 필드를 추가할 때는 이 케이스(구 스냅샷에 필드 없음)를 회귀 테스트로 남긴다.

### 3.4 웹 UI 재발 버그
- **이벤트 값은 producer 진입 전에 캡처.** `serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로, `mutate((m) => ... e.target.value ...)`처럼 lazy read하면 제어 인풋이 먼저 리셋되어 stale 값을 읽는다. 반드시 `const v = e.target.value` 후 producer에 넘긴다.
- 경고 표면은 이미 있다: `computeWarnings(model, rules?, dialects?)`(core `warnings.ts`) → `buildNodes`가 scope별로 분배 → `WarningBadge`. 새 경고 종류는 이 함수를 확장하면 배지·패널·명명 검사 화면에 자동 노출된다.
- 프로젝트 설정(방언·명명 규칙)은 버전 모델이 아니라 `projects` 행에 있고, `useModelLoader`가 `project.get`으로 조회해 store(`namingRules`, `dialects`)에 넣는다.

### 3.5 core 규칙
- `packages/core`는 **IO·런타임 의존성 free**(순수 도메인 로직). 레이아웃 계산용 dagre 같은 것은 `apps/web`에만. Excel의 `exceljs`도 `apps/web`에만 두고 **동적 `import()`로만** 쓴다(초기 번들 영향 없음) — 양식 정의·파싱 규칙 자체는 core의 순수 함수(`excel-sheets.ts` / `excel-import.ts`)다.
- DDL은 `generateDdl(model, dialect, scope)` 시그니처 불변, 경고는 `ddlWarnings(model, dialect, scope)`로 분리.
- **Excel 왕복 계약**: 내보내기 헤더 배열과 업로드 파서가 같은 상수를 공유해, 내보낸 파일을 그대로 다시 올릴 수 있다(단어·용어·도메인 3시트). 양식 다운로드도 같은 빌더를 쓴다. 유일한 예외는 용어사전의 `구성 단어`(파생값 — 업로드 시 무시).

---

### 3.6 실시간 협업 (Phase 3 #2에서 실제로 물린 것들)

- **모델을 바꾸는 모든 경로는 `mutateAndPublish`를 거친다**(`apps/server/src/services/mutate-publish.ts`). `runMutation`을 직접 부르면 커밋은 되지만 **실시간 채널로 전파되지 않는다.** 현재 호출처는 `model.mutate`·`snapshot.restore` 둘이고, Phase 4 CLI push가 셋째가 된다. 발행은 `db.transaction()`이 resolve된 **뒤**에만 일어나야 한다 — 콜백 안에서 발행하면 롤백된 op가 채널로 나간다(drizzle의 `transaction()`은 `commit`을 await한 뒤에만 resolve하므로 현재 구조에선 구조적으로 불가능).
- **`store.seq`에는 의미가 하나여야 한다.** 이 사이클의 Critical 결함이 여기서 나왔다: `use-model.ts`의 `submit()`이 서버 응답 seq로 `setSeq`하고, `use-realtime.ts`는 그 값을 "내가 적용한 마지막 seq"로 읽었다. 두 의미가 갈리면, 내 mutation이 서버 락에 대기하는 동안 커밋된 **남의 op가 "에코"로 오인돼 영구 유실**된다(seq 불연속도 안 잡혀 자가 치유도 발동 안 함). 현재는 `submit()`이 `seq !== seqBefore + 1`이면 `model.get`으로 통째 resync해서 막는다. **seq에 새 writer를 추가하려면 이 불변식을 먼저 확인하라.**
- **소켓 핸들러에서 `await` 앞에 close 리스너를 걸어라.** `hub.subscribe()` 직후·`await` 이전에 `socket.on('close', ...)`를 등록하지 않으면, 인증(DB 왕복 3회)이나 `currentSeq` 대기 중 끊긴 소켓이 허브에 **영구 유령 항목**을 남긴다 — 다른 참여자에게 유령 아바타·잔상 하이라이트가 서버 재시작 전까지 남고 하트비트 타이머도 누수된다.
- **재접속 시 클라이언트 상태를 다시 알려야 한다.** 서버 `Entry`는 `selection: null`로 새로 시작하는데, 선택 발신 effect는 "값이 바뀔 때만" 보낸다. `socket.onopen`에서 현재 선택을 무조건 재발신하지 않으면 재접속 후 하이라이트가 사라진 채로 남는다. presence는 서버→클라 방향만 전체 스냅샷이고 클라→서버는 델타라 이 비대칭이 생긴다.
- **인증 실패 close(4401/4403)는 재접속 백오프에서 제외한다** — 안 그러면 무한 루프다.
- **수신 op는 기존 `serializeMutation` 체인에 태운다**(`use-model.ts`에서 export). 별도 직렬화를 만들면 내 낙관적 mutation과 교차한다.
- `resync`는 `setLoaded`와 다르다 — **`activeGroupView`를 보존**한다(남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다). 선택은 대상이 사라졌을 때만 해제한다.
- dev에서 **React StrictMode가 effect를 2회 실행**해 소켓이 잠시 2개 생기고 presence 프레임이 중복된다. 프로덕션 빌드에는 없다 — dev 로그에서 중복 프레임을 보고 버그로 오인하지 말 것.
- 허브는 **인메모리 단일 인스턴스** 전제다. 다중 인스턴스로 가면 Redis pub/sub 브리지가 필요하다(설계상 예정된 확장점, 현재 범위 밖). `publishOps`/`peers`가 동기 API라 그때 시그니처를 async로 바꿔야 한다.

## 4. 개발 환경

```bash
# DB (docker) — 이미 떠 있는 경우가 많다
docker ps --filter name=erdd-db      # erdd-db-1, postgres:17, :5432
# dev DB=erdd, test DB=erdd_test (둘 다 0009까지 마이그레이션)
# 관리자 계정: admin@erdd.local / Passw0rd!erdd
# ADMIN_EMAIL/ADMIN_PASSWORD를 export하고 서버를 띄우면 없을 때 자동 생성된다(ensureBootstrapAdmin)

# ⚠️ dev 서버는 루트 .env를 자동 로드하지 않는다 → DATABASE_URL 없이 뜨면
#    ctx.db=null → 모든 tRPC가 412 → 화면에 "연결에 문제가 있습니다"
set -a; . ./.env; set +a; pnpm --parallel -r dev    # web :5173, server :3000

# 테스트
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck

# 마이그레이션 (스키마 변경 시)
pnpm --filter @erdd/server exec drizzle-kit generate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd'      pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec drizzle-kit migrate
```

브라우저 스모크: 브라우저는 항상 **`127.0.0.1`로 접속**한다(`localhost`는 IPv6로 풀릴 수 있다).

스모크에서 매번 물리는 것들:
- **vite가 IPv6 `[::1]`에만 바인딩**돼 Chrome이 접속을 못 한다(curl은 `localhost`를 `::1`로 풀어 200이라 서버 문제로 오인하기 쉽다). **`pnpm ... dev -- --host 127.0.0.1`은 인자가 전달되지 않는다** — `cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort`로 바이너리를 직접 실행해야 먹는다(루트 `node_modules/.bin/vite`는 없다).
- **`tsx watch` 부모가 세션을 넘어 살아남는다.** 자식만 kill하면 부모가 재기동하지 않아 **포트 3000을 잡은 채 구 코드를 서빙**한다(실시간 스모크에서 이틀 전 코드를 물고 있었다). `ps -eo pid,ppid,lstart,command | grep tsx`로 부모까지 확인해 둘 다 kill하고, 스모크 중에는 watch 없이 `./node_modules/.bin/tsx src/main.ts`로 띄우는 편이 안정적이다.
- **서버 테스트가 전 테이블을 TRUNCATE한다**(`testing/db.ts`의 `resetDb`). 테스트를 돌린 뒤 스모크하려면 계정·조직·프로젝트를 다시 시드해야 한다. 부트스트랩 관리자는 `ADMIN_EMAIL`/`ADMIN_PASSWORD`를 export하고 서버를 띄우면 자동 생성되고, 나머지는 tRPC를 curl로 때리는 게 빠르다(`admin.users.create` → `org.create` → `org.members.add` → `project.create` → `project.members.add`).
- `psql`이 PATH에 없다. DB를 직접 봐야 하면 `apps/server`에서 `node` 스크립트로 `pg`를 import한다(pnpm 엄격 모드라 리포 루트에서는 `pg`·`ws`가 해석되지 않는다).

**다중 사용자 스모크(실시간 등)**: 브라우저 2개를 띄우는 것보다 **연결된 Chrome 1개(A) + 헤드리스 WS 클라이언트(B)** 조합이 낫다. Claude 확장은 프로필 하나에만 있어서 새 프로필 창은 조작할 수 없고, 무엇보다 **경합 조건은 손으로 재현이 안 된다.** 실시간 사이클의 Critical 회귀 검증은 `SELECT ... FOR UPDATE`로 프로젝트 행 락을 12초 잡아 "B 먼저 커밋 / A는 대기 중" 순서를 강제해서 결정적으로 재현했다. 헤드리스 B는 `ws`를 pnpm 스토어 경로(`node_modules/.pnpm/ws@*/node_modules/ws`)에서 직접 import하면 된다.

---

## 5. 작업 방식 (이 프로젝트에서 굳어진 흐름)

sub-project 하나마다:

1. **brainstorming 스킬** — 기획 문서(`docs/*.md`) 읽고 설계 결정을 사용자와 확정(특히 load-bearing 결정 1~2개는 반드시 질문)
2. **spec 작성** → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 커밋
3. **writing-plans 스킬** → `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` 커밋 (태스크별 완결 코드·테스트·커밋 명령 포함)
   - ⚠️ **계획에 쓴 테스트 기대값은 계획의 가장 약한 고리다.** diff sub-project에서만 3건이 틀렸다: 설계가 정한 라벨 방향과 반대로 쓴 단언, 라이브러리 실제 동작(exceljs가 왕복 후 `autoFilter`를 범위 문자열로 역직렬화)과 어긋난 단언, 설계의 테스트 목록에서 3건 누락. **계획을 커밋하기 전에 (a) 설계 문서의 규칙·테스트 목록과 기계적으로 대조하고 (b) 픽스처의 실제 값을 열어 확인하라**(픽스처 값 오류도 1건 있었다).
   - 구현자에게는 "브리프 기대값이 실제와 어긋나면 이전 태스크 산출물을 고치지 말고 단언만 정정한 뒤 근거를 보고하라"고 명시하면 이 결함이 조기에 잡힌다.
4. 브랜치 생성(`feat/<topic>`), **subagent-driven-development**로 태스크별 구현 → 태스크별 리뷰 → 필요 시 수정 → 재리뷰
5. 전체 스위트 체크포인트 → 최종 whole-branch 리뷰 → 수정 → **컨트롤러 브라우저 스모크**(실 앱+실 DB) → main 머지, 브랜치 삭제
   - ⚠️ **태스크별 리뷰가 전부 clean이어도 최종 리뷰는 반드시 하라.** 실시간 sub-project에서 7태스크가 모두 Critical/Important 0건이었는데 최종 리뷰가 Critical 1건 + Important 2건을 잡았다. 셋 다 **태스크 경계를 가로지르는** 결함이라 스코프가 좁은 게이트로는 구조적으로 볼 수 없다.
   - 최종 리뷰 프롬프트에 이 한 줄을 넣으면 그런 결함이 바로 드러난다: **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라."** 실제로 Critical(`setSeq`가 두 가지 의미를 갖게 된 것)이 이 질문 하나로 잡힌다.
   - **수정의 구분력은 컨트롤러가 직접 실증하라** — 각 파일을 수정 전 버전으로 되돌려 새 테스트가 *실제로 실패*하는지 확인한다(`git show <base>:<path> > /tmp/x && cp /tmp/x <path>` → 테스트 → `git checkout -- <path>`). 실시간 사이클에서 리뷰 에이전트가 되돌린 파일을 남긴 채 스톨해서 컨트롤러가 복구해야 했다 — 되돌리기를 서브에이전트에게 시키면 워킹트리 오염을 각오할 것.

**커밋 규칙(사용자 지정, 반드시 준수)**
- `git add .` / `git add -A` **금지** — 명시 파일만 스테이징. `.idea/*` 변경과 루트 `.env`는 커밋하지 않는다(워킹트리에 항상 `.idea` 노이즈가 있음).
- 커밋 메시지는 한국어. 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- 응답은 한국어.

**서브에이전트 한도:** 한 세션에서 200개까지. 명명 체계 세션은 Task 6에서 한도에 도달해 이후는 컨트롤러가 직접 구현+자기리뷰로 마쳤다. 커스텀 항목 세션(7태스크+최종리뷰+수정)은 한도 안에서 전 과정을 서브에이전트 구현+리뷰로 마쳤다(약 17개 서브에이전트 사용). 서브에이전트 리뷰를 계속 쓰려면 `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`을 올린다.

### 병렬 트랙(worktree 2개)으로 돌릴 때

Phase 2 #4·#5를 Orca worktree 2개로 동시에 진행했다. 잘 돌아갔고, 다음이 필수였다:

- **트랙별 격리 DB**를 미리 만들어 준다(`erdd_dev_a`/`erdd_test_a`, `erdd_dev_b`/`erdd_test_b`). 공유 `erdd_test`를 두 트랙이 함께 쓰면 서로의 데이터를 지운다.
- **worktree base는 반드시 로컬 `main`으로 명시**한다(`--base-branch refs/heads/main`). `origin/main`이 뒤처져 있으면 Orca 기본값이 그 옛 커밋을 base로 잡는다(실제로 42커밋 뒤처진 상태였다).
- 각 워커에게 **`main` 체크아웃·머지·브라우저 스모크 금지**를 명시한다(같은 저장소의 다른 worktree가 `main`을 잡고 있어 git이 거부한다). 워커는 구현+테스트+최종 리뷰까지, 병합·스모크·문서 갱신은 컨트롤러가 한다.
- **`HANDOFF.md`·`91-checklist.md`는 어느 트랙도 건드리지 않게 한다** — 양쪽이 고치면 병합 충돌이 확정이다. 컨트롤러가 병합 후 일괄 갱신한다.
- **마이그레이션 번호는 반드시 충돌한다**(둘 다 0007을 만든다). 워커에겐 신경 쓰지 말고 각자 격리 DB에 적용하라고 하고, 병합 시 컨트롤러가 나중 트랙의 파일을 버리고 **병합된 스키마에서 `drizzle-kit generate`로 새 번호를 뽑는다**(스냅샷 손수정보다 안전).
- 병합 시 실제로 든 비용: 파일 충돌 11개 + 교차 타입/테스트 오류 20여 곳. 대부분 "두 트랙이 같은 엔티티에 각각 새 필드를 추가"해서 생긴 기계적 충돌이라, 양쪽 필드를 모두 살리면 된다. 다만 **의미 판단이 필요한 곳이 섞인다**(예: Excel 가져오기의 `draft`는 신규 생성용이라 `origin: null`이 맞지만, 부분 갱신용 `patch`에는 넣으면 안 된다 — 넣으면 업로드가 기존 항목의 fork 출처를 지운다).
- 새 런타임 의존성이 붙은 트랙을 병합하면 **`pnpm install`을 먼저** 해야 타입이 풀린다(안 하면 그 파일이 implicit any로 깨진다).

---

## 6. 이월 항목 (모두 non-blocking)

**Phase 1 잔여**
- 측정 bbox 기반 그룹 영역 크기 산정(현재는 추정치 EST_W/estHeight)
- 자동 정렬 방향 토글(TB/LR) — 현재 TB 고정
- `toolbar.tsx` `visibleTables`가 raw `activeGroupView` truthy만 판정(그룹 삭제 중 스테일 뷰에서 자동정렬 버튼 비활성) → canvas의 유효-뷰 계산과 통일
- C급 코스메틱

**도메인**
- `resolveColumn` 빈-오버라이드/dangling domainId 명시 테스트
- 도메인 삭제 summary 카피, `usageOf` 스냅샷 타이밍(단일 사용자 범위 밖)

**명명 체계**
- **용어 수정 시 사용 중 컬럼 일괄 반영 미구현** — Term의 물리명은 저장값이고 컬럼 물리명은 생성 시점 스냅샷이라, Term을 고쳐도 컬럼은 그대로이고 `term-mismatch` 경고만 뜬다. 도메인처럼 라이브가 아니므로 "N개 컬럼에 반영" UX가 별도로 필요(구현 시 Revision 1건). 기획 문서 `docs/13-naming.md`의 "용어 수정 시 변경 반영 여부 선택"이 이 부분.
- `duplicate-physical-table`이 `rules` 게이트 안에 있음(컬럼 중복은 항상 계산 — 스키마 정확성 경고라 항상 계산이 더 일관적)
- `reserved` 경고가 `rules` truthiness에 결합(`dialects`만 줘도 무효)
- core에 `NamingRulesSchema`(zod) export → server `project.ts`의 손-미러 제거
- `apps/server/src/testing/db.ts` `TEST_TABLES`에 `model_domains/model_words/model_terms/snapshots` 명시(현재는 TRUNCATE CASCADE로 무해)
- `dict-panel.tsx`의 `wordUsage` 렌더마다 재계산 → memo
- 자동생성 패널의 미등록 단어 인라인 등록(현재는 사전 화면 "미등록 단어" 탭으로 갈음)

**DDL/기타**
- 방언별 예약어 목록은 큐레이션 세트(전수 아님)
- 0컬럼 테이블은 DDL에서 제외 + 경고(정책 확정됨)

**커스텀 항목**
- 조직 표준 템플릿(→ 프로젝트로 가져오기)은 범위 밖(다음 fork sub-project에서 사전·도메인과 통합 설계)
- 커스텀 항목이 있는 상태에서 그 이전 스냅샷(값 없음)을 복원하는 회귀 테스트가 없음(관대 정책상 정의는 삭제되고 값은 dangling으로 남는 것이 의도된 동작 — 고정 테스트 추가 권장)
- 테이블 scope 값 커밋 경로(`setCustomValue(m,'table',...)`) 전용 통합 테스트 없음
- '필수' 배지가 섹션 단위라 여러 필수 항목이 있을 때 어떤 항목이 비었는지 안 보임
- boolean 필드에는 required 표식(*)이 없음(현재 UI로는 required:true인 boolean을 생성할 수 없어 도달 불가 — fork/임포트로 우회 생성되면 문제)
- `custom-fields-section.tsx`의 text 입력(blur 커밋)이 `edit-panel.tsx`의 `CommitInput`과 의미상 중복(공용 파일 추출 여지 — edit-panel에서 import하면 순환이라 별도 파일 필요)
- 자동 저장 금지 가드(정의 기본값 표시 중 blur해도 저장 안 됨) 고정 테스트 없음
- CLI `custom` 필드는 Phase 4로 이월(Excel 정의서 컬럼은 #5에서 구현됨)

**공용 리소스 fork (#4)**
- **프로젝트 → 조직 리소스 승격(반대 방향)** 미구현 — 기획(`01-concepts.md` 4항)에 있으나 이번 범위에서 제외
- **행안부 표준 사전 실데이터 미확보** — 현재는 전역 라이브러리가 비어 있을 때 부팅 시 "표준 사전(예시)" 소량(도메인 3·단어 6·용어 3·커스텀 항목 2)만 시드. `91-checklist`의 "표준 사전 데이터 소싱" 미결과 연결
- `resource-sync`: 같은 배치 내 동명 added 2건은 서로에 대해 `nameClash=false`(UI 자문용, 무결성 무관)
- `resource-sync`의 `as unknown as` 캐스트 4곳, `items.update/remove`가 권한검사 전 NOT_FOUND(존재 오라클 — uuidv7이라 열거 불가, snapshot.ts 관례와 동일)
- `library.update`가 서버에만 있고 UI 경로 없음. 라이브러리 remove 테스트 없음
- 충돌 라디오 `aria-label`에 종류 수식어 없음(동명 이종 항목이면 모호), 적용 성공 토스트 없음(선택이 전부 no-op이면 무반응)
- 패널 재오픈 시 라이브러리 목록 stale(`onOpenChange`에서 refetch 권장), `plan` 참조 변경 시 `useEffect`가 진행 중 선택을 리셋할 수 있음
- `ensureStarterGlobalLibrary`의 동시 부팅 경합(단일 인스턴스면 무해), `changedFields`에 `domainId`가 허위로 낄 수 있음(표시 전용)
- customField 로컬 순서변경·origin 왕복 회귀 테스트 없음(구조적으로 성립하나 미고정)

**Excel 산출물/업로드 (#5)**
- **"변경분 정의서" 시트 미구현** — 스냅샷 diff 기반이라 Phase 3의 diff 화면과 함께 설계(의도적으로 남긴 유일한 시트)
- **테이블·컬럼 커스텀 항목 "값"의 Excel 업로드 미지원**(내보내기만) — 테이블·컬럼 식별 규칙(물리명? id?)이 따로 필요해 별도 사이클
- **선택 테이블 범위 내보내기** — `ExportScope`의 `{kind:'tables'}`는 타입만 있고 UI 없음
- 도메인 허용값의 쉼표 왕복 한계(값 자체에 쉼표가 있으면 분리됨)
- 대량 업로드는 `MAX_OPS_PER_MUTATION`(5000)이 천장 — 초과 시 UI가 막고 파일 분할 안내(청크 적용 미구현)

**스냅샷 diff (Phase 3 #1)**
- 라벨 2차 정렬(같은 종류 안 `localeCompare`)·`labelOf`의 relationship/index/tableGroup/customField/term/note 분기 미테스트
- 키 누락의 역방향(base에만 있고 target 엔티티엔 없는 필드) 미테스트
- 비교 화면의 `normalize()`를 실증하는 테스트 없음(core가 컬렉션 기본값을 자체적으로 채워 크래시는 안 남)
- select 상호작용·다운로드 버튼 호출·relationship 클릭 분기 미테스트
- `useMemo`가 실효 없음 — `normalize`가 매 렌더 새 객체를 만들어 의존성 identity가 매번 바뀐다(소규모 모델이라 체감 없음)
- `type Side = 'current' | string`이 사실상 `string`(타입 안전성 없음, 실 id가 UUIDv7이라 충돌 불가)
- `snapshot-diff.tsx`가 `in` 연산자를 쓰는데 core는 `Object.hasOwn` 관례
- 참조 대상 이름이 우연히 같으면 `이전값 = 이후값`인 변경 행이 나온다(판정은 id 기준이라 의도된 동작이나 감리 문서에선 혼동 소지)
- **Revision 단위 diff 미지원**(현재는 스냅샷·현재 시점 단위). 이력 화면 확장은 별도
- diff에서 선택 항목만 되돌리는 "선택 복원" 미지원(스냅샷 전체 복원만)
- 배치 좌표 변경 이력 보기 없음(좌표는 diff에서 의도적으로 제외)

**실시간 동시편집 (Phase 3 #2)**
- **다중 인스턴스 미지원** — 허브가 인메모리 단일 인스턴스 전제. 스케일아웃 시 Redis pub/sub 브리지 필요하고, 그때 `publishOps`/`peers`를 async로 바꿔야 한다(현재 동기 API라 `mutateAndPublish`가 fire-and-forget으로 부른다)
- **`actorUserId`/`actorName`이 브로드캐스트되지만 클라가 안 쓴다** — 같은 사용자의 다른 탭에서 온 변경에도 "다른 사용자가…" 토스트가 뜬다. `msg.actorUserId !== me.id`로 게이트하거나 `${actorName}님이…`로 카피에 쓰면 둘 다 해소된다
- **peer 이름 라벨이 테이블에만 있다** — 설계·계획 산문은 관계·메모에도 이름 라벨을 약속했으나 구현은 테이블만(관계는 `EdgeLabelRenderer`가 필요해 까다롭다). 계획 산문을 고치든 라벨을 추가하든 정리 필요
- **`PresenceBar` 위치가 설계와 다름** — 설계는 "캔버스 좌상단", 구현은 헤더 우측 클러스터. 헤더 쪽이 더 나아 보이나 문서화되지 않은 드리프트
- 좌표 이동만으로도 "수정했습니다" 토스트가 뜬다(`selectionImpact`가 `position` 변경을 구분하지 않음) — 남이 내가 선택한 테이블을 반복 드래그하면 토스트가 연달아 뜬다
- 소켓 인바운드 rate limit·payload cap 없음(`ws` 기본 `maxPayload` 100MiB). `selection` 프레임 1건이 채널 전체 presence 팬아웃을 유발하는데 스로틀은 클라 측에만 있다. `app.register(fastifyWebsocket, { options: { maxPayload: 64*1024 } })` 한 줄로 완화 가능
- 클라이언트 측 liveness 감지 없음(하트비트가 서버→클라 단방향) — half-open 소켓이면 TCP가 포기할 때까지 조용히 아무것도 못 받는다. 복구 자체는 `ready.seq` 불일치로 정상 동작
- `PEER_SELECTION_KINDS`·`PeerSelectionKind`·`PEER_PALETTE`가 core 밖에서 안 쓰임, `RealtimeHub.connectionCount`는 테스트 전용(공개 표면 정리 여지)
- DB 조회 실패 시 앱 레벨 close code가 아니라 1011로 닫힌다(인증 단계 실패는 4401/4403). 리포에 eslint 설정이 아예 없어 `react-hooks/exhaustive-deps`가 안 돌고, `canvas.tsx`의 `eslint-disable` 주석도 실효가 없다

---

## 7. 새 세션 시작 프롬프트 (복사해서 사용)

```
ERDD 프로젝트를 이어서 작업한다. 먼저 docs/superpowers/HANDOFF.md를 읽고
현재 상태·아키텍처 불변식·환경·작업 방식을 파악해라.

작업 규칙:
- 응답은 한국어.
- 커밋은 명시 파일만 스테이징(git add . / -A 금지). .idea/* 와 .env 는 커밋하지 않는다.
- 커밋 메시지는 한국어 + Co-Authored-By/Claude-Session 트레일러 2줄.
- 임시 파일은 $CLAUDE_JOB_DIR/tmp 사용.

다음 작업: <권한 세분화 검토 | Phase 4 CLI·역설계 | 6절 이월 항목 정리> 중 하나를 진행한다.
Phase 4를 고른다면 착수 전 docs/91-checklist.md의 "CLI 상세"·"에이전트 스킬 문서"·
"DDL 역설계 범위"를 먼저 확정해라. HANDOFF.md의 "작업 방식"대로
brainstorming(설계 결정 확인) → spec → plan → SDD 구현/리뷰 → 최종 리뷰 → 브라우저 스모크 → main 머지
순서로 가라.
```

> 다른 것부터 하고 싶으면 마지막 문단만 바꾼다. 예: "6절 이월 항목을 정리한다" / "프로젝트→조직 리소스 승격(공용 리소스 반대 방향)을 구현한다" / "실시간 협업의 이월 항목(멀티 인스턴스·토스트 정교화)을 정리한다".
