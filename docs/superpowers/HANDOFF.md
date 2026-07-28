# ERDD 작업 인계 문서 (새 세션 시작점)

**최종 갱신:** 2026-07-28 / **main HEAD:** (머지 후 갱신) / **마이그레이션:** 0006까지

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

### 테스트 기준선 (이 상태에서 전부 그린이어야 정상)

```
core 146 · web 159 · server 52 (erdd_test) · pnpm -r typecheck → 0 errors
```

### 다음 작업 (Phase 2 남은 sub-project, 권장 순서)

1. **공용 리소스 fork/재동기화** — 서비스 전역·조직 표준 사전/도메인/커스텀 항목을 프로젝트로 fork 후 수동 재동기화(→ `docs/01-concepts.md` 공용 리소스 패턴). 사전·도메인·커스텀 항목이 이미 있으므로 세 종류를 하나의 fork 메커니즘으로 한꺼번에 설계.
2. **Excel 산출물/업로드** — 정의서 Excel 내보내기(커스텀 항목 컬럼 포함), 사전 Excel 업로드, 그룹 단위 내보내기(→ `docs/17-import-export.md`).

이후 Phase 3(실시간 협업), Phase 4(CLI·역설계·과금) — `docs/90-roadmap.md`.

---

## 2. 읽을 문서 (순서)

1. **이 문서** — 현재 상태·불변식·환경·워크플로
2. `docs/90-roadmap.md` — 단계별 범위(무엇이 어느 Phase인지)
3. 작업할 영역의 기획 문서 — `docs/13-naming.md`(명명), `docs/14-domain.md`(도메인/타입), `docs/15-custom-fields.md`(커스텀 항목), `docs/17-import-export.md`(내보내기/Excel), `docs/01-concepts.md`(공용 리소스 fork 패턴), `docs/11-collaboration.md`(버전/협업), `docs/02-architecture.md`(데이터 계층 원칙)
4. 직전 sub-project의 설계·계획(패턴 참고용) — `docs/superpowers/specs/2026-07-27-phase2-custom-fields-design.md`, `docs/superpowers/plans/2026-07-27-phase2-custom-fields.md`
5. `docs/91-checklist.md` — 착수 전 결정 사항 추적(Phase 2 남은 항목 확인)

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

### 3.3 하위호환 (스냅샷·옛 리비전)
- 모델에 새 컬렉션을 추가하면 `ProjectModelSchema`에서 `.default({})`. 단, **`z.infer` 출력 타입은 필수**이므로 `: ProjectModel` 리터럴(fixtures, model-store 반환 등)에는 전부 키를 추가해야 한다(typecheck-driven으로 훑기).
- 엔티티에 새 필드를 추가하면 `.nullable().default(null)`(옛 op 페이로드 파싱).
- **스냅샷 복원은 정규화 필수**: `snapshot.ts` restore가 `diffModels(current, { ...createEmptyModel(), ...snap.model })`로 누락 컬렉션을 보충한다. 새 컬렉션을 추가해도 이 패턴 덕에 옛 스냅샷이 깨지지 않는다(제거하지 말 것). 단, 이 정규화는 **컬렉션 키만** 보충하고 **엔티티 필드**(예: `table.custom`)는 안 채운다 — 옛 스냅샷의 엔티티에 새 필드가 없으면 `diffModels`가 그 차이를 감지하되(커스텀 항목 sub-project에서 실제 발생), **빈 `changes`의 update op는 만들지 않는다**(`diff.ts`가 target 기준으로 실변경 없으면 op를 내보내지 않도록 방어). 새 엔티티 필드를 추가할 때는 이 케이스(구 스냅샷에 필드 없음)를 회귀 테스트로 남긴다.

### 3.4 웹 UI 재발 버그
- **이벤트 값은 producer 진입 전에 캡처.** `serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로, `mutate((m) => ... e.target.value ...)`처럼 lazy read하면 제어 인풋이 먼저 리셋되어 stale 값을 읽는다. 반드시 `const v = e.target.value` 후 producer에 넘긴다.
- 경고 표면은 이미 있다: `computeWarnings(model, rules?, dialects?)`(core `warnings.ts`) → `buildNodes`가 scope별로 분배 → `WarningBadge`. 새 경고 종류는 이 함수를 확장하면 배지·패널·명명 검사 화면에 자동 노출된다.
- 프로젝트 설정(방언·명명 규칙)은 버전 모델이 아니라 `projects` 행에 있고, `useModelLoader`가 `project.get`으로 조회해 store(`namingRules`, `dialects`)에 넣는다.

### 3.5 core 규칙
- `packages/core`는 **IO·런타임 의존성 free**(순수 도메인 로직). 레이아웃 계산용 dagre 같은 것은 `apps/web`에만.
- DDL은 `generateDdl(model, dialect, scope)` 시그니처 불변, 경고는 `ddlWarnings(model, dialect, scope)`로 분리.

---

## 4. 개발 환경

```bash
# DB (docker) — 이미 떠 있는 경우가 많다
docker ps --filter name=erdd-db      # erdd-db-1, postgres:17, :5432
# dev DB=erdd, test DB=erdd_test (둘 다 0006까지 마이그레이션)
# 관리자 계정: admin@erdd.local / Passw0rd!erdd

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

브라우저 스모크: 기존 스크래치 프로젝트 `http://localhost:5173/p/019f9451-d164-7d8c-a2f0-b71b7b60d42d`(로그인 쿠키가 남아있는 편). **스모크로 만든 변경은 실행 취소(undo)로 원복**해 dev DB를 깨끗이 둔다.

---

## 5. 작업 방식 (이 프로젝트에서 굳어진 흐름)

sub-project 하나마다:

1. **brainstorming 스킬** — 기획 문서(`docs/*.md`) 읽고 설계 결정을 사용자와 확정(특히 load-bearing 결정 1~2개는 반드시 질문)
2. **spec 작성** → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 커밋
3. **writing-plans 스킬** → `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` 커밋 (태스크별 완결 코드·테스트·커밋 명령 포함)
4. 브랜치 생성(`feat/<topic>`), **subagent-driven-development**로 태스크별 구현 → 태스크별 리뷰 → 필요 시 수정 → 재리뷰
5. 전체 스위트 체크포인트 → **컨트롤러 브라우저 스모크**(실 앱+실 DB) → 최종 whole-branch 리뷰 → main 머지(fast-forward), 브랜치 삭제

**커밋 규칙(사용자 지정, 반드시 준수)**
- `git add .` / `git add -A` **금지** — 명시 파일만 스테이징. `.idea/*` 변경과 루트 `.env`는 커밋하지 않는다(워킹트리에 항상 `.idea` 노이즈가 있음).
- 커밋 메시지는 한국어. 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- 응답은 한국어.

**서브에이전트 한도:** 한 세션에서 200개까지. 명명 체계 세션은 Task 6에서 한도에 도달해 이후는 컨트롤러가 직접 구현+자기리뷰로 마쳤다. 커스텀 항목 세션(7태스크+최종리뷰+수정)은 한도 안에서 전 과정을 서브에이전트 구현+리뷰로 마쳤다(약 17개 서브에이전트 사용). 서브에이전트 리뷰를 계속 쓰려면 `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`을 올린다.

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
- Excel 산출물의 커스텀 컬럼, CLI `custom` 필드는 각각 Excel/Phase 4 사이클로 이월

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

다음 작업: Phase 2의 남은 sub-project 중 <공용 리소스 fork | Excel 산출물>을
진행한다. HANDOFF.md의 "작업 방식"대로 brainstorming(설계 결정 확인) → spec → plan →
SDD 구현/리뷰 → 브라우저 스모크 → main 머지 순서로 가라.
```

> 다른 것부터 하고 싶으면 마지막 문단만 바꾼다. 예: "6절 이월 항목 중 커스텀 항목 항목들을 정리한다" / "Phase 3 실시간 협업 설계를 시작한다".
