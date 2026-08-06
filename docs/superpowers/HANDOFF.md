# ERDD 작업 인계 문서 (새 세션 시작점)

**최종 갱신:** 2026-08-06 / **main HEAD:** `b127175` / **마이그레이션:** 0011까지(승격 요청 큐에서 `promotion_requests` 추가 — CLI push 멱등성 사이클은 마이그레이션 없음)

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

| **Phase 4 #1 DDL 역설계** | 손으로 쓴 좁은 파서(`CREATE TABLE`/`ALTER TABLE ADD CONSTRAINT`/`CREATE INDEX`/`COMMENT ON`)로 기존 DDL을 파싱해 미리보기 후 모델에 적용. 논리명은 코멘트→사전→물리명 순으로 복원, 왕복이 깨지는 5건은 테스트 상수로 고정. **마이그레이션 없음** |
| **Phase 4 #2 CLI 트랙 A** | 개인 액세스 토큰(`access_tokens` 테이블, `erdd_pat_` 접두 평문 + SHA-256 저장, 만료 없이 폐기만), 조직·프로젝트 역할에서 그대로 파생되는 권한(새 축 아님) + 토큰 노출 프로시저 5개 allowlist(`apiProcedure`), 파일 포맷(`packages/core/src/file-format.ts` — plain object만 다루고 YAML은 모름), 신규 패키지 `packages/cli`(`@erdd/cli`, 바이너리 `erdd`)의 읽기 명령 `init`/`pull`/`status`/`validate`, 마이그 0010 |
| **Phase 4 #3 CLI 트랙 B** | 파일 3-way 병합 core 순수 함수(`packages/core/src/file-merge.ts` — `FILE_FIELDS`/`FILE_INVISIBLE_FIELDS`·`fileVisibleModel`·`mergeModels`·`applyMerge`·`pruneDangling`·`gridPositions`), 신규 프로시저 `model.push`(토큰 allowlist 6번째, 필수 `expectedSeq`를 프로젝트 행 락 안에서 검증해 경합 차단, `model.mutate`는 세션 전용 유지), CLI `push`(필드 단위 자동 병합·충돌 시 블록형 출력+exit 1·삭제 확인 프롬프트·성공 후 암묵적 pull로 신규 id 채움)·`diff`(항상 3-way 계획 미리보기, `--base` 없음)·`skill install`(`.claude/skills/erdd/SKILL.md` 동봉, `--dir`/`--force`). **마이그레이션 없음** |

| **공용 리소스 승격** | fork의 반대 방향 — 프로젝트 사전 4종을 조직/전역 라이브러리로 올린다. core 순수 함수 `resource-promote.ts`(`planPromote` 3상태 분류 / `applyPromotePlan` write+`origin` 갱신), `runMutation`의 트랜잭션 내 선행 훅 `prepare`로 라이브러리 쓰기와 모델 op를 한 트랜잭션에 묶는 신규 프로시저 `resource.promote`(권한 3중·라이브러리 항목 `FOR UPDATE`·기대치 불일치 skip), `listForProject`의 `canWrite`, 공용 리소스 다이얼로그를 탭 2개로 분리 + "조직으로 승격" 탭. **마이그레이션 없음** ([설계](specs/2026-08-04-resource-promotion-design.md)) |
| **승격 요청·승인 큐** | 라이브러리 쓰기 권한이 없는 Editor의 요청 경로. `promotion_requests`(op 로그 밖, 마이그 0011)는 **엔티티 포인터만** 담고 승인 시 `planPromote`를 재계산한다. `resource.promote`의 트랜잭션 본문을 `services/promote.ts`(`runPromoteInTx`·`loadLibraryItems`)로 추출해 승인이 같은 엔진을 타고, 요청 행 종결이 같은 `prepare` 훅에 들어가 함께 롤백된다. 프로시저 7개(`create`/`listForProject`/`cancel`/`listForOrg`/`get`/`pendingCount`/`resolve`), 승격 탭의 요청 모드, 조직 화면 승인 목록·검토 다이얼로그, 헤더·홈 배지 ([설계](specs/2026-08-04-promotion-request-queue-design.md)) |
| **CLI push 멱등성** | 커밋 후 응답이 유실돼도 다음 push가 사본을 만들지 않게 한다. `filesToModel`이 신규 id를 발급하는 자리(`idOf`)에서 그 id를 입력 트리의 복사본에 되써 **`assignedTree`를 함께 내고**, CLI `push`가 `confirmDeletes` 뒤·`model.push` 직전에 **id가 늘어난 파일만 원래 경로에** 기록한다(`commands/reserve-ids.ts`). 다음 push는 `model.get`으로 서버를 다시 읽어 계획을 새로 만들므로 신규 id만 안정되면 세 결말(커밋+응답유실 / 미커밋 / 커밋+`syncDown` 실패)이 전부 수렴한다. **서버 변경·마이그레이션 없음** ([설계](specs/2026-08-05-cli-push-idempotency-design.md)) |

> **Phase 2 완료.** #4·#5는 병렬 worktree 2개로 동시에 진행해 순서대로 병합했다(머지 커밋 `1012e9d`, `d580028`).
> **Phase 3 완료.** 스냅샷 diff → 실시간 동시편집 순으로 각각 별도 사이클로 진행했다(머지 커밋 `9dbdeef`).
> **Phase 4 완료.** DDL 역설계 → CLI 트랙 A(읽기) → CLI 트랙 B(`push`·3-way 병합·`diff`·에이전트 스킬) 순으로 마쳤다.

### 테스트 기준선 (이 상태에서 전부 그린이어야 정상)

```
core 463 · cli 138 · web 382 · server 143 (erdd_test) · typecheck EXIT=0
```

루트 `pnpm verify`는 `packages/core` 뒤·`apps/web` 앞에 `pnpm -C packages/cli test`를 끼워 넣어
네 스위트를 함께 돈다. 승격 요청 큐 사이클에서 web +20 · server +19가 붙었다(core·cli는 무변경).
그중 상당수는 **구분력 확인이 드러낸 커버리지 구멍을 메운 것**이다 — 조직 경계(테넌트 격리), 승인
쓰기 권한, 요청 범위, `PromoteEntryList` 배선, 배지가 앱 셸에 꽂혀 있다는 사실.

CLI push 멱등성 사이클에서 **core +10 · cli +24**가 붙었다(web·server는 무변경 —
`git diff --stat main..HEAD -- apps/`가 빈 출력이다). 위 `web 382 · server 143`은 이번 사이클이
올린 값이 아니라 **직전 사이클 막바지 커밋(`feb54df`·`5c81dd1`)이 올려 놓고 이 문서에 반영되지 않은
채 남아 있던 값**이다 — 기준선이 낡으면 "내 사이클이 올린 수"를 계산할 수 없으니 사이클 끝마다
네 수를 전부 실측해 갱신한다.

⚠️ **`pnpm -s -r typecheck`의 출력만 보고 판정하지 말 것.** `-s`가 자식 출력을 삼켜서, 타입 오류가
있어도 **출력이 0바이트이고 종료코드만 1**이다. 실시간 사이클에서 이 함정 때문에 구현자·태스크
리뷰어·최종 리뷰어가 전원 "typecheck clean"으로 오판했고, 암묵적 any 3건이 그대로 main에 머지됐다
(다음 사이클 구현자가 패키지별로 돌려보고 발견). **종료코드로 판정하거나 패키지별로 돌린다:**

```bash
pnpm -r typecheck; echo "EXIT=$?"      # EXIT=0이어야 통과
pnpm -s -C apps/server typecheck        # 또는 패키지별 — 오류가 그대로 보인다
pnpm -s -C apps/web typecheck
pnpm -s -C packages/core typecheck
pnpm -s -C packages/cli typecheck
```

파이프(`| tail`)를 붙이면 `$?`가 tail의 종료코드가 되어 또 오판한다. 리뷰어에게 typecheck를
시킬 때도 이 주의를 프롬프트에 넣어라.

가장 확실한 방법은 루트의 `pnpm verify` 하나로 돌리는 것이다(typecheck + 4개 스위트 —
`packages/core`·`packages/cli`·`apps/web`·`apps/server` — 를 `&&`로 묶어 어느 하나라도 실패하면
비정상 종료한다). 서버 스위트는 DB env가 필요하므로 `set -a && . ./.env && set +a && pnpm verify`로
실행한다.

### 다음 작업

**Phase 4 + 공용 리소스 승격 + 요청·승인 큐 완료 — 다음 후보** (→ `docs/90-roadmap.md`)

로드맵의 Phase 1~4가 모두 완료됐고, 공용 리소스의 반대 방향(승격)과 그 위의 요청·승인 큐까지 채웠다. 정해진 다음 Phase는 없다. 후보는 (a) 6절 이월 항목 정리, (b) `docs/90-roadmap.md` "추후 검토" 목록 중 조직 내부 도구로서 가치가 큰 것. 과금은 여전히 최우선이 아니다 — 조직 내에서 쓸 수 있는 도구 완성이 우선.

값이 큰 순서로 추린 것:

1. **셀프 가입·초대 메일·비밀번호 재설정** — 지금은 관리자가 계정을 직접 만들어야 해 실배포 마찰이 가장 크다. **승격 요청 큐의 알림도 여기에 얹힌다**(현재는 폴링 배지뿐). 메일 인프라 선택이 선행 결정이다.
2. 실제 DB 접속 스키마 스캔(DDL 역설계의 다음 단계 — 기존 모델과의 병합·재동기화가 딸려 온다), 프로젝트당 복수 스키마, MCP 서버, Excel 양식 템플릿.

> 여기 있던 **CLI push의 비멱등 쓰기**는 CLI push 멱등성 사이클에서 해소됐고(위 완료 표), **`cancel`의
> read-then-write**는 그보다 앞선 `feb54df`(조건부 UPDATE + `rowCount === 0` → CONFLICT)에서 이미
> 해소돼 있었다. 후자는 고쳐진 뒤에도 이 목록과 6절에 남아 있었다 — **고친 사이클에서 이월 목록을
> 함께 지우지 않으면 다음 세션이 끝난 일을 후보로 고른다.**

무엇을 고르든 착수 전에 brainstorming 스킬로 사용자와 우선순위·load-bearing 결정을 먼저 확정한다(5절 "작업 방식" 참조).

## 2. 읽을 문서 (순서)

0. **`CLAUDE.md`**(저장소 루트, `AGENTS.md`가 같은 파일을 가리킨다) — 반드시 지켜야 할 작업 규칙:
   메모리 기능 금지, git(최상위 체크아웃·스테이징·커밋 메시지), 워크트리 생성·포트·격리 DB, Orca
   오케스트레이션 우선. Claude Code 세션에 자동 로드되지만, **재사용할 결정을 기록할 때 목적지를
   정하려면 직접 읽어라.**
1. **이 문서** — 현재 상태·불변식·환경·워크플로
2. `docs/90-roadmap.md` — 단계별 범위(무엇이 어느 Phase인지)
3. 작업할 영역의 기획 문서 — `docs/13-naming.md`(명명), `docs/14-domain.md`(도메인/타입), `docs/15-custom-fields.md`(커스텀 항목), `docs/17-import-export.md`(내보내기/Excel), `docs/01-concepts.md`(공용 리소스 fork 패턴), `docs/11-collaboration.md`(버전/협업), `docs/02-architecture.md`(데이터 계층 원칙)
4. 직전 sub-project의 설계·계획(패턴 참고용) — `docs/superpowers/specs/2026-07-28-phase3-snapshot-diff-design.md`와 `plans/2026-07-28-phase3-snapshot-diff.md`
5. `docs/91-checklist.md` — 착수 전 결정 사항 추적(Phase 1~4 전 항목 확정 완료. 다음 Phase 착수 시 이 문서에 새 항목을 추가한다)

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
- `diffModels`(`diff.ts`) → `Op[]`. **적용용**이고 FK 안전 순서로 정렬된다. 스냅샷 복원·CLI push(`applyMerge` 결과 위에서 호출)가 의존하는 불가침 함수다.
- `diffModelsForDisplay`(`model-diff.ts`) → `ModelDiff`. **표시용**이고 사람이 읽는 순서로 정렬, 이름 해석, 배치 좌표 제외, 참조형 속성(id) → 이름 변환을 한다.
- `model-diff.ts`의 **`KIND_ORDER`가 사실상 7번째 엔티티 등록처**다(이 배열을 순회해 diff를 만든다). 누락하면 그 종류가 정의서에서 조용히 빠진다 — 완전성 테스트가 `ENTITY_KINDS`와 대조해 잡는다. `FIELD_LABEL`도 함께 채워야 한다(누락 시 필드명 원문이 노출될 뿐 테스트는 통과한다).
- **판정과 표시를 분리한다**: 변경 감지는 원시 값(`formatValue`)으로만 하고, 이름 해석(`formatFieldValue`)은 표시에만 쓴다. 판정이 이름 기준이 되면 도메인 이름만 바꿔도 그 도메인을 쓰는 컬럼이 전부 "변경"으로 잡힌다.

### 3.2b 공용 리소스(전역·조직 라이브러리)
- `resource_libraries` / `resource_items`는 **op 로그 밖의 일반 테이블**이다(프로젝트 모델이 아님). 프로젝트로 fork된 결과만 op 엔티티가 된다.
- 모델 4종(`domain`/`word`/`term`/`customField`)의 `origin` = `{ libraryId, sourceId, sourceVersion, base }`. **`base`는 가져온 시점에 프로젝트 공간으로 투영해 써넣은 payload**라, `payloadOf(현재) ≠ base` 하나로 "프로젝트가 고쳤는지"가 판정되고 3-way 병합 전체가 core 순수 함수(`resource-sync.ts`)로 닫힌다. 버전 이력 테이블이 없다.
- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → Revision 1건, undo 1회로 원복.
- 원본에서 삭제된 항목은 프로젝트에 그대로 둔다(삭제 제안 없음 — 프로젝트 독립성 원칙).

**반대 방향(승격, `resource-promote.ts` + `resource.promote`)** — 가져오기와 대칭이지만 규칙이 셋 더 있다.

- **`origin.base`는 승격에서도 "가져오기 직후"와 같아야 한다.** 라이브러리에 쓴 payload를 **다시 프로젝트 공간으로 투영한 값**을 넣는다(프로젝트의 현재 payload를 그대로 넣으면 안 된다). 정상 케이스는 왕복이 항등이라 곧바로 동기 상태가 되고, **도메인을 빼고 올린 용어**는 `base.domainId=null ≠ 현재값`이라 "프로젝트가 고침"으로 잡혀 나중에 `auto-update`가 도메인 연결을 조용히 지우는 사고가 구조적으로 막힌다. core 테스트가 양방향으로 고정한다.
- **승격은 프로젝트 엔티티의 `origin`만 바꾼다.** 그래서 op는 전부 `origin` 1필드 update이고 선택 항목 수 = op 수다. undo는 `origin`만 되돌리며 **라이브러리에 쓴 항목은 남는다**(op 로그 밖이라 구조적으로 그렇다).
- **판정 순서가 DB 행 순서에 의존하면 안 된다.** `loadProjectModel`의 `SELECT`에는 `ORDER BY`가 없어서, 동명 항목이 둘일 때 클라와 서버가 서로 다른 쪽에 `name-match`를 주면 양쪽 다 `plan-changed`로 건너뛰어 **영원히 수렴하지 않는다.** `planPromote`가 엔티티를 **id 오름차순으로 정렬한 뒤** 선점을 판정해 막는다 — 새 선점 규칙을 넣을 때 이 정렬을 지워선 안 된다.
- 클라는 payload를 보내지 않는다. `{entityId, expectedStatus, expectedTargetItemId, expectedTargetVersion}`만 보내고 서버가 락 안에서 계획을 재계산해 어긋난 항목만 건너뛴다(`missing`/`plan-changed`). **`expectedTargetVersion`이 없으면** 다이얼로그를 연 사이 남이 고친 원본을 낡은 미리보기 기준으로 덮어쓴다.

**요청·승인 큐(`promotion_requests` + `promotion.*`)** — 위 승격 위에 얹힌 층이라 규칙이 셋 더 있다.

- **승격의 유일한 엔진은 `services/promote.ts`의 `runPromoteInTx`다.** `resource.promote`(직접 승격)와
  `promotion.resolve`(요청 승인)가 이것을 공유한다. 세 번째 승격 경로를 만들면 반드시 이 함수를 거쳐야
  하고, **`prepare` 훅 밖에서 부르면** 프로젝트 행 락 밖에서 라이브러리를 쓰게 된다. 라이브러리 항목
  조회도 같은 파일의 `loadLibraryItems` 하나뿐이어야 한다 — 요청 시점(`promotion.create`)과 승인
  시점(`runPromoteInTx`)이 **같은 값을 계산해야 하고**, `orderBy(asc(createdAt))`가 `planPromote`의
  동명 선점 순서를 정하므로 한쪽만 바뀌면 판정이 갈린다.
- **요청 행은 엔티티 포인터(`entityIds`)만 담는다.** payload를 동결하면 `origin.base` 규칙(3.2b 첫
  항목)을 요청 시점 기준으로 다시 유도해야 하고, 그 사이 엔티티가 삭제되면 `origin`을 쓸 대상이 없어지며,
  요청 행이 모델과 별개의 진실 원본이 된다. 승인 화면은 `promotion.get`이 **지금** 계산한 계획을 쓰고,
  요청 당시 있었으나 계획에서 사라진 항목은 `unavailable`로 분리한다.
- **`promotion_requests`에 `orgId` 컬럼을 두지 않는다.** 조직 단위 조회는 `resource_libraries.orgId`
  조인으로 얻는다 — `create`가 `library.orgId === project.orgId`를 강제하므로 두 경로가 같은 값을
  가리키고, 컬럼을 따로 두면 그 둘이 어긋날 자리가 생긴다. **조직 경계는 테스트로 잠겨 있다**(외부인이
  소유한 조직에 pending 요청을 심는 `seedForeignPendingRequest` 픽스처) — 이 픽스처를 지우면
  `listForOrg`의 행 필터와 `pendingCount`의 조인 조건이 동시에 무방비가 된다.

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

- **모델을 바꾸는 모든 경로는 `mutateAndPublish`를 거친다**(`apps/server/src/services/mutate-publish.ts`). `runMutation`을 직접 부르면 커밋은 되지만 **실시간 채널로 전파되지 않는다.** 호출처는 `model.mutate`·`snapshot.restore`·CLI `model.push`(Phase 4 트랙 B) 셋이다. 발행은 `db.transaction()`이 resolve된 **뒤**에만 일어나야 한다 — 콜백 안에서 발행하면 롤백된 op가 채널로 나간다(drizzle의 `transaction()`은 `commit`을 await한 뒤에만 resolve하므로 현재 구조에선 구조적으로 불가능).
- **`store.seq`에는 의미가 하나여야 한다.** 이 사이클의 Critical 결함이 여기서 나왔다: `use-model.ts`의 `submit()`이 서버 응답 seq로 `setSeq`하고, `use-realtime.ts`는 그 값을 "내가 적용한 마지막 seq"로 읽었다. 두 의미가 갈리면, 내 mutation이 서버 락에 대기하는 동안 커밋된 **남의 op가 "에코"로 오인돼 영구 유실**된다(seq 불연속도 안 잡혀 자가 치유도 발동 안 함). 현재는 `submit()`이 `seq !== seqBefore + 1`이면 `model.get`으로 통째 resync해서 막는다. **seq에 새 writer를 추가하려면 이 불변식을 먼저 확인하라.**
- **소켓 핸들러에서 `await` 앞에 close 리스너를 걸어라.** `hub.subscribe()` 직후·`await` 이전에 `socket.on('close', ...)`를 등록하지 않으면, 인증(DB 왕복 3회)이나 `currentSeq` 대기 중 끊긴 소켓이 허브에 **영구 유령 항목**을 남긴다 — 다른 참여자에게 유령 아바타·잔상 하이라이트가 서버 재시작 전까지 남고 하트비트 타이머도 누수된다.
- **재접속 시 클라이언트 상태를 다시 알려야 한다.** 서버 `Entry`는 `selection: null`로 새로 시작하는데, 선택 발신 effect는 "값이 바뀔 때만" 보낸다. `socket.onopen`에서 현재 선택을 무조건 재발신하지 않으면 재접속 후 하이라이트가 사라진 채로 남는다. presence는 서버→클라 방향만 전체 스냅샷이고 클라→서버는 델타라 이 비대칭이 생긴다.
- **인증 실패 close(4401/4403)는 재접속 백오프에서 제외한다** — 안 그러면 무한 루프다.
- **수신 op는 기존 `serializeMutation` 체인에 태운다**(`use-model.ts`에서 export). 별도 직렬화를 만들면 내 낙관적 mutation과 교차한다.
- `resync`는 `setLoaded`와 다르다 — **`activeGroupView`를 보존**한다(남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다). 선택은 대상이 사라졌을 때만 해제한다. **서버가 모델을 바꾸는 경로**(스냅샷 복원·승격)는 성공 후 `model.get`으로 되맞추는데, 모델 전체가 바뀌는 복원은 `setLoaded`, 사전만 건드리는 승격은 `resync`가 맞다.
- **모델 밖 테이블을 같은 트랜잭션에서 써야 하면 `runMutation`의 `prepare(tx, model)` 훅을 쓴다**(승격이 라이브러리 항목을 이렇게 쓴다). 프로젝트 행 락 획득·모델 로드 뒤, `deriveOps` 앞에 돌아 권위 모델을 손에 쥔 채 쓰고 여기서 던지면 모델 변경과 함께 롤백된다. **훅 없이 `runMutation`을 직접 부르면** 네 번째 직접 호출자가 생겨 브로드캐스트를 손으로 발행해야 하고, 그 순간 이 절의 첫 불변식이 깨진다.
- dev에서 **React StrictMode가 effect를 2회 실행**해 소켓이 잠시 2개 생기고 presence 프레임이 중복된다. 프로덕션 빌드에는 없다 — dev 로그에서 중복 프레임을 보고 버그로 오인하지 말 것.
- 허브는 **인메모리 단일 인스턴스** 전제다. 다중 인스턴스로 가면 Redis pub/sub 브리지가 필요하다(설계상 예정된 확장점, 현재 범위 밖). `publishOps`/`peers`가 동기 API라 그때 시그니처를 async로 바꿔야 한다.

### 3.7 액세스 토큰 인증 (Phase 4 CLI 트랙 A)

> **새 tRPC 프로시저의 기본은 `authedProcedure`(세션 전용)다.** 액세스 토큰으로 호출 가능하게 하려면 `apiProcedure`로 명시적으로 열어야 하고, 그 목록은 CLI가 실제로 쓰는 것으로 한정한다. 기본이 거부이므로 프로시저를 추가해도 토큰에 저절로 열리지 않는다.

### 3.8 CLI push의 낙관적 동시성 (Phase 4 CLI 트랙 B)

- **`runMutation`의 `deriveOps`가 `(model, seq)`를 받는다**(`apps/server/src/services/mutation.ts`, 예전엔 `model`만). `currentSeq` 조회를 `deriveOps` 호출 **위로** 끌어올려, `model.push`의 `expectedSeq` 비교가 프로젝트 행 `FOR UPDATE` 락 안에서 이뤄지는 유일한 지점이 됐다 — **이 지점이 CLI push의 유일한 경합 방어선**이다(락 밖에서 seq를 읽으면 읽기와 커밋 사이에 남이 끼어들 여지가 생긴다). 기존 호출자 `model.mutate`·`snapshot.restore`는 두 번째 인자를 무시해 무영향이고 `mutateAndPublish`도 시그니처를 그대로 통과시킨다. **이번 브랜치에서 두 번째 호출자가 생긴 기존 함수**(5절의 최종 리뷰 질문)로 `runMutation`/`mutateAndPublish`와 `filesToModel`(`opts.newId` 주입)이 해당한다.
- **`FILE_FIELDS`/`FILE_INVISIBLE_FIELDS`(`packages/core/src/file-merge.ts`)는 3.2절과는 별개의 체크리스트다.** 3.2절의 6곳(+ `model-diff.ts`의 `KIND_ORDER`)은 **새 op 엔티티 종류**를 등록하는 곳이고, 이건 **이미 등록된 엔티티에 필드를 추가**할 때 그 필드를 파일에 보이는 것(`FILE_FIELDS`)인지 안 보이는 것(`FILE_INVISIBLE_FIELDS`)인지 분류하는 곳이다 — 서로 다른 유지보수 범주라 하나로 이어 세면 안 된다. 분류하지 않으면 `file-merge.test.ts`의 분류 완전성 테스트가 깨진다(zod shape과 실제 필드 집합을 대조해 자동으로 잡는다 — `model-diff.ts`의 `KIND_ORDER` 완전성 테스트와 같은 선례).

### 3.9 CLI push의 신규 id 고정 (멱등성)

- **`filesToModel`은 `newId`를 받으면 입력 트리의 `structuredClone` 위에서 파싱하고, 발급한 id를 그
  복사본에 되써 `assignedTree`로 낸다**(`newId`가 없으면 복사도 `assignedTree`도 없다 — `pull`·
  `validate`는 큰 트리를 다루므로 복사 비용을 지면 안 된다). **되쓰는 자리는 발급 자리(`idOf`)
  하나뿐이다** — 별도 `assignMissingIds` 순회를 두면 9곳(`groups`·`domains`·`words`·`terms`·
  `customFields`·`table`·`columns`·`indexes`·`relations`) 중 한쪽만 고쳐질 때 조용히 빈 자리가 생기고,
  그 자리가 정확히 "매번 새 id를 받는" 자리라 원래 버그가 부분적으로 되살아난다. 새 파일 종류가 붙어도
  `idOf`를 지나기만 하면 저절로 따라온다.
- **완전성은 두 단언으로 잠겨 있다: "채운 트리를 다시 파싱하면 임시 id가 0건"과 "두 모델의 id 집합이
  같다".** 후자가 없으면 **파일에 쓰는 id와 op가 서버로 나르는 id가 갈려도 아무 테스트가 안 잡는다** —
  실제로 그 상태였다(되쓰기를 `r['id'] = newId()`로 바꿔 둘을 완전히 다르게 만들어도 당시 core 459개가
  전부 통과했다. `126e24d`가 잠갔다). 그런 구현이면 다음 push가 파일의 id를 서버에서 못 찾아 원래 버그
  그대로 사본을 만든다.
- **`push`는 `confirmDeletes` 뒤·`model.push` 앞에서만 `reserveIds`를 부른다.** 앞에 두면 삭제 확인에서
  **취소한 사용자의 파일이 바뀌고**, 뒤에 두면 응답 유실 시 id가 안 남아 사이클 전체가 무의미해진다.
  그리고 **`reserveIds`의 호출처가 `push.ts` 하나인 것이 `erdd diff`가 파일을 건드리지 않는다는 보장**
  이다(계획 미리보기가 파일을 쓰지 않는 것은 계약이다) — 두 번째 호출처를 만들 때 이 보장이 먼저 깨진다.
- **`reserveIds`는 `writeTree`를 쓰지 않는다.** 그 함수의 삭제·개명 패스가 돌면 `tableFileName`이
  파일명을 물리명으로 정규화해 **사용자가 만든 파일과 갈리고**, 같은 테이블이 두 파일에 남아 다음
  push가 `idOf`의 id 중복 검사에 걸려 아예 막힌다. 기록은 **사용자가 만든 원래 경로에** 한다 —
  push가 성공하면 `syncDown`이 어차피 정규 파일명으로 재작성하고 옛 파일을 지운다.
- **`filesToModel`은 공유 객체 참조(YAML anchor/alias)를 `WeakSet`으로 감지해 `ok:false`로 세운다.**
  alias는 배열의 두 원소를 **같은 객체 하나**로 파싱하고 `structuredClone`이 그 공유를 보존하므로,
  감지가 없으면 두 엔티티가 한 id를 받아 **조용히 하나로 합쳐진 채 `ok:true`가 나간다**(실측: 컬럼
  2개 → 1개). **이 검사는 `newId` 유무와 무관해야 한다** — 발급 id를 `firstUse`에 등록해 두 번째 방문이
  explicit으로 읽게 하는 판별은 되쓰기가 있는 push 갈래에서만 성립해서, 같은 파일을 `push`는 거절하고
  `validate`는 `ok:true`로 통과시켰다. push의 파일 오류 문구가 "erdd validate로 확인하세요"라고 바로 그
  명령을 가리키므로, **지시를 따른 사용자·에이전트가 "문제 없음"을 받고 막히는** 형태였다(`14b9125`).
  참조 동일성은 id와 무관하게 직접 보이므로 두 갈래가 같은 판정을 낸다. 공유 참조를 끊는 재귀 복사는
  채택하지 않았다 — `yaml.stringify`가 공유를 다시 anchor/alias로 내보내므로, 참조를 끊으면
  `reserveIds`가 사용자의 alias 파일을 전개형으로 덮어써 조용한 데이터 손실이 조용한 파일 파괴로 바뀐다.

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
# 워크트리에서는 포트·DB를 트랙별로 바꾼다: 서버 PORT + web ERDD_SERVER_PORT(같은 값) + vite --port
# (할당표는 CLAUDE.md "워크트리 규칙". vite 프록시 타깃이 ERDD_SERVER_PORT로 파라미터화돼 있어,
#  안 주면 워크트리의 web이 조용히 최상위 서버 3000에 붙는다)

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
**SPA 라우트는 `/p/<projectId>`(프로젝트 에디터)와 `/org/<orgId>`다** — `/projects/<id>`로 가면 "페이지를 찾을 수 없습니다"가 뜬다. 배선 확인은 `/trpc/auth.me?batch=1&input=%7B%7D`로 프로브한다(**401 = DB 정상 + 로그아웃 상태, 412 = DB 미배선**). 서버 `/`와 맨 `/trpc`는 설계상 404다.

스모크에서 매번 물리는 것들:
- **vite가 IPv6 `[::1]`에만 바인딩**돼 Chrome이 접속을 못 한다(curl은 `localhost`를 `::1`로 풀어 200이라 서버 문제로 오인하기 쉽다). **`pnpm ... dev -- --host 127.0.0.1`은 인자가 전달되지 않는다** — `cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort`로 바이너리를 직접 실행해야 먹는다(루트 `node_modules/.bin/vite`는 없다).
- **좀비 dev 프로세스가 구 코드를 조용히 서빙한다.** `tsx watch` 부모는 세션을 넘어 살아남고, 반대로 `pkill -f "tsx src/main.ts"` / `pkill -f vite`는 **부모만** 죽여 `node` 자식이 포트를 쥔 채 남는다. 어느 쪽이든 새로 띄운 서버가 `EADDRINUSE`로 죽고(vite는 `--strictPort`) 몇 시간 전 코드와 계속 대화하게 된다 — 증상은 API의 "No procedure found on path …"와 최신 변경이 빠진 UI다(실시간 스모크에서 이틀 전 코드를 물고 있었다). **띄우기 전에 항상 `lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`으로 확인해 나온 PID를 `kill -9`** 하고, 새 서버가 최신인지 `/trpc/<이번에 추가한 프로시저>`가 404가 아니라 401을 주는 것으로 확증한다. vite는 `rm -rf apps/web/node_modules/.vite` 후 캐시버스팅 쿼리를 붙여 로드한다. 스모크 중에는 watch 없이 `./node_modules/.bin/tsx src/main.ts`로 띄우는 편이 안정적이다.
- **테스트가 DB를 TRUNCATE한다**(`testing/db.ts`의 `resetDb`). 서버 스위트뿐 아니라 **루트 `pnpm verify`도 dev DB `erdd`를 비운다** — `.env`의 `DATABASE_URL`이 dev DB를 가리키기 때문이다. 테스트를 돌린 뒤 스모크하려면 계정·조직·프로젝트를 다시 시드해야 한다. 부트스트랩 관리자는 `ADMIN_EMAIL`/`ADMIN_PASSWORD`를 export하고 서버를 띄우면 `ensureBootstrapAdmin`이 자동 생성하고, 나머지는 node 스크립트에서 `fetch`로 tRPC를 때리는 게 빠르다: `auth.login` → `org.create` → `admin.users.create` → `org.members.add`(`memberId`를 반환한다) → `project.create`(`dialects` 필요) → Viewer용 `project.members.add`. **호출 사이에 `getSetCookie()`의 `erdd_session` 쿠키를 이어서 넘겨야 한다.**
- **React 제어 인풋에 브라우저 도구로 타이핑하지 마라.** `computer:type`은 느리고 한글에서 불안정하다. `javascript_tool`로 네이티브 setter를 쓴다 — `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta, text)` 후 `ta.dispatchEvent(new Event('input',{bubbles:true}))`. 미리보기가 갱신되면 React가 받은 것이다. 다이얼로그를 먼저 열어 엘리먼트 존재를 확인한다 — `navigate` 후 stale 해진 엘리먼트 참조는 클릭이 조용히 no-op이 된다.
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
   - ⚠️ **워크트리에서 시작하는 작업이므로 워커는 Orca 터미널로 띄운다.** Orca 환경이면 구현자·리뷰어를 Agent 도구가 아니라 Orca 터미널 워커로 띄우는 것이 규칙이다 — **병렬 여부는 따지지 않는다**(`CLAUDE.md` "워크트리 작업은 Orca 세션으로 한다 (병렬 여부 무관)"). SDD의 루프(구현 → 리뷰 → 수정 → 재리뷰)는 그대로 두고 워커를 띄우는 수단만 바꾸는 것이다.
   - ⚠️ **워커 하나를 띄우는 단계는 5개다 — "제출 확인"을 빼먹지 마라.** ① `terminal create` → ② `terminal wait --for tui-idle` → ③ 그 핸들로 브리프 주입(`worker-start --terminal <handle>`) → ④ **`terminal read` 로 제출 확인**(입력창에 브리프가 텍스트로 남아 있으면 `terminal send --text "" --enter` 후 다시 read) → ⑤ `check --wait`. 주입 API의 성공 응답은 **전송까지만** 보증하고 제출은 보증하지 않으며, 미제출은 `check --wait` 가 15분 `timedOut` 을 낼 때까지 드러나지 않는다. **④ 없이 ⑤로 넘어가지 않는다** — 태스크마다 워커를 새로 띄우는 SDD에서는 이 누락이 사이클당 여러 번 발생할 수 있다(명령·근거는 `CLAUDE.md` 같은 절).
     - **실측(CLI push 멱등성 사이클): 긴 한국어 멀티라인 브리프는 ①②를 분리하지 않으면 사실상 항상 미제출이다.** `worker-start` 를 `--terminal` 없이 불러 터미널 생성과 주입을 한 번에 시킨 워커는 **4개 중 4개가 미제출**이었고, 터미널을 먼저 만들어 `tui-idle` 까지 기다린 뒤 주입한 워커는 **4개 중 4개가 자동 제출**됐다. `CLAUDE.md` 는 "타이밍에 달려 있어 될 때도 있고 안 될 때도 있다"고 적었지만, 브리프가 길면 확률 문제가 아니다.
     - ⚠️ **셸 변수는 `orca` 호출 사이에 살아남지 않는다**(작업 디렉터리는 유지된다). 워크트리 id 같은 긴 값을 변수에 담아 다음 호출에서 쓰면 **빈 문자열이 들어가 `worker-start` 가 조용히 실패한다**(응답의 `stage` 가 `null` 로 온다 — 오류가 아니라 빈 성공처럼 보인다). 파일에 적어 두고 `$(cat …)` 로 읽어라.
5. 전체 스위트 체크포인트 → 최종 whole-branch 리뷰 → 수정 → **컨트롤러 브라우저 스모크**(실 앱+실 DB) → main 머지, 브랜치 삭제
   - ⚠️ **태스크별 리뷰가 전부 clean이어도 최종 리뷰는 반드시 하라.** 실시간 sub-project에서 7태스크가 모두 Critical/Important 0건이었는데 최종 리뷰가 Critical 1건 + Important 2건을 잡았다. 셋 다 **태스크 경계를 가로지르는** 결함이라 스코프가 좁은 게이트로는 구조적으로 볼 수 없다.
   - 최종 리뷰 프롬프트에 이 한 줄을 넣으면 그런 결함이 바로 드러난다: **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라."** 실제로 Critical(`setSeq`가 두 가지 의미를 갖게 된 것)이 이 질문 하나로 잡힌다. **CLI push 멱등성 사이클에서도 또 값을 했다** — 해당 함수 둘(`canonical`·`filesToModel`)에서 각각 실제 불변식 충돌이 나왔고, 그중 하나(`validate`와 `push`의 판정이 갈려 push가 가리키는 명령이 "문제 없음"을 주던 것 — 3.9절)는 **태스크별 리뷰 3라운드가 전부 놓친 것**이다.
   - **수정의 구분력은 컨트롤러가 직접 실증하라** — 각 파일을 수정 전 버전으로 되돌려 새 테스트가 *실제로 실패*하는지 확인한다(`git show <base>:<path> > /tmp/x && cp /tmp/x <path>` → 테스트 → `git checkout -- <path>`). 실시간 사이클에서 리뷰 에이전트가 되돌린 파일을 남긴 채 스톨해서 컨트롤러가 복구해야 했다 — 되돌리기를 서브에이전트에게 시키면 워킹트리 오염을 각오할 것.

**커밋·git·워크트리 규칙은 `CLAUDE.md`(저장소 루트)에 있다** — `git add -A` 금지(경로 명시 스테이징),
최상위 체크아웃 규칙, 커밋 메시지 형식, 워크트리 위치·포트·격리 DB, 메모리 기능 금지, 응답 한국어.
규칙이 바뀌면 **그 파일 한 곳만** 고친다(여기에 사본을 두지 않는다).

**서브에이전트 프롬프트에 반드시 넣을 세 문장.** ERDD의 지배적 결함군은 틀린 코드가 아니라 **아무것도
붙잡아 두지 않는 맞는 코드**다 — CLI 트랙 B 사이클에서 Important 지적의 절반가량이 "방어 대상 코드를
지우거나 뒤집어도 통과하는 테스트"였고, CLI push 멱등성 사이클에서는 **그 사이클의 존재 이유인 계약
자체가 무테스트**였다(되쓰기를 "파일에 적는 id ≠ op가 나르는 id"로 바꿔도 core 459개 전부 통과 —
3.9절). 다음 세 지시가 그것을 드러낸다:

1. **구현자에게:** "브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크
   산출물도 고치지 마라 — **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가
   한다.**" (사이클당 계획 결함 ~10건이 이걸로 드러났고, 그중 몇은 통과하면서 아무것도 검증하지 않던
   테스트였다)
2. **구현자에게, 수정 건마다:** "그 수정이 구분력이 있는지 확인하라 — 프로덕션 변경을 되돌려 테스트가
   실패하는지 보고 복구하라. **실패하지 않으면 덮지 말고 그렇다고 보고하라.**" 부정적 결과를 보고해도
   된다는 명시적 허용이 정직한 보고를 만든다.
3. **수정 워커에게:** "**리뷰 보고서의 제안도 검증되지 않은 주장이다** — 그대로 통과한다고 가정하지
   말고 실측한 뒤, 어긋나면 다른 방법을 쓰고 근거를 보고하라." CLI push 멱등성 사이클에서 리뷰어가
   "raw 비교로 바꾸면 그 테스트가 실효를 갖는다"고 제안했는데 실측상 거짓이었고(`assignedTree`는 신규
   0건이어도 항상 존재하고 재작성 결과가 바이트까지 같다), 수정 워커가 그것을 발견해 다른 방법으로
   구분력을 만들었다. 이 문장이 없으면 리뷰어의 잘못된 처방이 그대로 커밋된다.

리뷰어에게는 "품질을 봐라"가 아니라 **그 태스크의 구체적 load-bearing 리스크**를 지목해 주고, 구현자의
보고는 **미검증 주장**임을 알린다.

**"기존 동작을 없애는" 사이클은 착수 시점에 그 동작을 서술하는 주석·문서를 grep해 목록을 만들어라.**
CLI push 멱등성 사이클의 결함은 거의 전부 두 종류였다 — (i) 위의 "아무것도 붙잡아 두지 않는 맞는
코드", (ii) **변경이 기존 서술을 거짓으로 만드는 것**(주석 5곳, 그 사이클 설계 §2.4·§3.3의 자기모순,
이 문서의 낡은 이월 항목). 이 사이클은 없애는 대상이 바로 그 서술들이 설명하던 동작("push는 매번
새 id를 발급한다")이었으므로 (ii)는 성격상 필연이었다. 리뷰가 하나씩 주워 담는 것보다 착수 시점에
목록을 만들어 태스크에 배분하는 편이 싸다.

**서브에이전트 한도:** 한 세션에서 200개까지. 명명 체계 세션은 Task 6에서 한도에 도달해 이후는 컨트롤러가 직접 구현+자기리뷰로 마쳤다. 커스텀 항목 세션(7태스크+최종리뷰+수정)은 한도 안에서 전 과정을 서브에이전트 구현+리뷰로 마쳤다(약 17개 서브에이전트 사용). 서브에이전트 리뷰를 계속 쓰려면 `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`을 올린다.

### 병렬 트랙(worktree 2개)으로 돌릴 때

Phase 2 #4·#5를 worktree 2개로 동시에 진행했다. 잘 돌아갔고, 다음이 필수였다.

> 워크트리 **생성·위치·포트·정리** 규칙과 Orca 오케스트레이션 우선 규칙은 `CLAUDE.md`에 있다. 여기에는
> 그 위에서 실제로 든 비용과 트랙 운영 노하우만 남긴다.

- **트랙별 격리 DB**를 미리 만들어 준다(`erdd_dev_a`/`erdd_test_a`, `erdd_dev_b`/`erdd_test_b`). 공유 `erdd_test`를 두 트랙이 함께 쓰면 서로의 데이터를 지운다.
- **base는 반드시 로컬 `main`으로 명시**한다(`git worktree add -b feat/<작업명> .worktrees/feat-<작업명> main`). 생략하면 진행 중인 주 트랙 위에 얹히고, `origin/main`을 쓰면 뒤처진 옛 커밋을 잡는다(실제로 42커밋 뒤처진 상태였다 — 당시 Orca 기본값이 `origin/main`이었다).
- 각 워커에게 **`main` 체크아웃·머지 금지**를 명시한다(같은 저장소의 다른 워크트리가 `main`을 잡고 있으면 git이 거부한다). 워커는 구현+테스트+최종 리뷰까지, 병합·문서 갱신은 컨트롤러가 한다.
- **브라우저 스모크는 컨트롤러가 병합 후 최상위에서 한다.** 워크트리에서도 격리 포트(`PORT`+`ERDD_SERVER_PORT`+`--port`)로 띄울 수는 있지만, 확인해야 할 것은 병합된 결과이고 Claude 확장이 붙은 Chrome 프로필도 하나뿐이다.
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
- `duplicate-physical-table`이 `rules` 게이트 안에 있음(컬럼 중복은 항상 계산 — 스키마 정확성 경고라 항상 계산이 더 일관적)
- `reserved` 경고가 `rules` truthiness에 결합(`dialects`만 줘도 무효)
- core에 `NamingRulesSchema`(zod) export → server `project.ts`의 손-미러 제거
- `apps/server/src/testing/db.ts` `TEST_TABLES`에 `model_domains/model_words/model_terms/snapshots` 명시(현재는 TRUNCATE CASCADE로 무해)
- `dict-panel.tsx`의 `wordUsage` 렌더마다 재계산 → memo
- 자동생성 패널의 미등록 단어 인라인 등록(현재는 사전 화면 "미등록 단어" 탭으로 갈음)

**용어 전파 (용어 수정 시 사용처 일괄 반영 — 구현 완료, 잔여 한계)**
- **저장 클릭과 반영 클릭 사이에 남이 같은 대상을 고치면 그 변경은 건너뛴다**(`applyTermPropagation`이 `c.before` 일치를 확인). 건너뛴 항목을 사용자에게 알리지 않아, 확인 다이얼로그가 "N곳에 반영"이라 했는데 실제로는 N보다 적게 반영될 수 있다
- 저장~반영 사이에 **용어 자체가 원격 삭제**되면 `updateTerm`은 no-op인데 사용처 반영은 그대로 진행된다(존재하지 않는 용어의 물리명으로 개명됨). 확률은 낮고 undo 1회로 복구된다
- **논리명만 바꾸면 기존 `term-mismatch` 경고가 남는다** — "실제로 바뀐 필드만 전파"가 설계 결정이라 사양대로 맞는 동작이지만, 확인 다이얼로그 문구는 "일괄 반영"으로 읽혀 경고가 다 사라질 것처럼 보인다
- 물리명이 아직 생성되지 않은(빈 문자열) 엔티티는 확인 목록에서 `MBR.`처럼 어색하게 보인다(정상적인 전파 대상은 맞다 — 표시만의 문제)
- 사용처가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 서버가 raw zod 메시지로 거절한다(사전 업로드 경로에는 있는 클라 가드가 여기엔 없음). 단일 용어로는 현실적으로 도달 불가
- 용어 **추가** 시 기존 동명 엔티티로의 전파 미지원, 모델 검사 화면에서 `term-mismatch` 일괄 해소 진입점 없음, 전파 대상 개별 선택(체크박스) 없음(현재는 전체 반영/전체 유지 2택)
- `apps/server`에 `@types/ws`가 없어 `ws.ts`의 핸들러 인자를 `unknown`/`number`로 손수 주석했다. `@types/ws`를 devDependency로 넣으면 `RawData`로 추론된다(현재 깨진 것은 없음)

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

**공용 리소스 승격 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-resource-promotion-design.md) §9)**
- ~~요청·승인 큐 없음~~ → **해소됨**(승격 요청 큐 사이클, 마이그 0011). 아래 "승격 요청 큐" 항목 참조
- **전역 fork 항목을 조직으로 승격하면 전역 재동기화 목록에 그 원본이 `added`로 다시 뜬다**(`nameClash`가 붙어 기본 미선택이라 중복 생성은 막히지만 매번 남는다). "무시" 상태를 기록할 자리가 모델에 없다
- **undo는 `origin`만 되돌린다** — 라이브러리에 쓴 항목은 남는다(관리 화면에서 삭제해야 한다)
- `FOR UPDATE`는 **기존 행만** 잠근다 — 서로 다른 프로젝트가 동시에 승격하면 같은 이름의 항목이 2개 생길 수 있다(`resource_items`에 `(library_id, kind, name)` 유니크 제약 없음). 데드락 경로도 이론상 존재한다(승격은 항목→라이브러리 순, `library.remove`는 반대)
- 동명 판정이 **표시 이름 완전일치**다(공백·대소문자 정규화, 동의어 매칭 없음). 대상에 동명이 여럿이면 `createdAt` 첫 항목을 고르고 사용자가 지목할 수 없다
- 프로젝트에서 지운 항목이 원본에서 사라지지는 않는다(반대 방향의 보수적 정책과 대칭)
- `parsePayload` 실패가 400으로 매핑된다(서버측 결함인데 클라 입력 오류로 보인다), `entries`에 같은 `entityId`가 중복되면 조용히 흡수된다
- 승격 진행 중에도 체크박스·일괄 버튼이 활성(제출 버튼만 비활성), 탭을 전환하면 재동기화 탭의 진행 중 선택이 초기화된다
- `EntryLabel`이 재동기화 탭과 승격 탭에 거의 동일하게 중복, `resource-panel.tsx`의 `as LibraryRow[]` 캐스트가 서버/클라 shape 드리프트를 컴파일에서 놓친다
- `planResync`는 아직 정렬 없는 순회를 쓴다(라이브러리 항목 순서에 의존해 현재는 무해하나 `planPromote`와 같은 부류의 잠재 발산)

**승격 요청 큐 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-promotion-request-queue-design.md) §9)**
- **알림이 폴링 배지뿐이다.** 승인자가 로그인해 있지 않으면 모른다. 메일 발송은 인프라 선택이 선행 결정이라 별도 사이클(로드맵 "추후 검토"의 초대·비밀번호 재설정 메일과 함께 다루는 것이 자연스럽다)
- **배지는 `bare` 라우트(에디터)에는 뜨지 않는다.** 실제 도달 범위는 "`AppShell`을 쓰는 화면"이라 **프로젝트 오너가 에디터에 오래 머무는 동안에는 대기 요청을 못 본다.** 승인 동선이 홈·조직 화면이라 치명적이진 않으나 설계 §1.1의 "어느 화면에 있든 보인다"와 실제가 다르다
- **요청자는 자기 요청의 반려 사유를 볼 수 없다.** 조직 승인 화면에는 상태 필터(대기/승인/반려/취소)가 있어 `resolutionNote`를 읽을 수 있지만, 프로젝트 승격 탭의 요청 목록은 `pending` 고정이다. 서버 `listForProject`는 `status`를 지원하므로 막힌 것은 UI뿐이다
- **동시성은 결정적으로 테스트할 수 있다 — 다만 경합의 종류마다 기법이 다르다.** 두 `resolve`를 `Promise.all`로 쏘면 `runMutation`의 프로젝트 행 `FOR UPDATE`가 직렬화해 단언이 대칭이 된다(statusCode 정렬 `[200,409]`, 항목 1건 — flaky하지 않다). **그러나 `cancel` vs `resolve`에는 그 방법이 통하지 않았다** — 경합 창이 좁아 `Promise.all`로는 조건부 `where`를 지워도 통과했다. 그래서 그쪽 테스트(`promotion.test.ts`)는 요청 행을 밖에서 `FOR UPDATE`로 잠가 한쪽 UPDATE를 붙들어 두는 형태이고(4절의 실시간 사이클 기법과 같다), `5c81dd1`이 여기에 **`pg_locks`로 실제 대기를 확인하는 헬퍼**(`waitForLockWaiter` — `locktype='transactionid' AND NOT granted`)를 넣어 "락을 실제로 기다렸다"를 단언한다. 고정 `sleep`이면 경합이 성립하지 않은 채 조용히 통과할 수 있다 — **경합 테스트는 경합이 일어났다는 것 자체를 관측해야 한다**
- `cancel`의 read-then-write(라이브러리에는 항목이 올라갔는데 요청은 "취소됨"으로 남던 것)는 `feb54df`가 조건부 UPDATE(`and(eq(id), eq(status,'pending'))` + `rowCount === 0` → CONFLICT)로 **해소했다**
- **원자성은 `promotion` 전용 테스트가 아니라 `mutate-publish.test.ts`가 잠근다.** 보장의 소재가 `promotion`이 아니라 `mutateAndPublish`의 `prepare` 훅이고, `apps/server/src/services/mutate-publish.test.ts`의 "prepare가 쓴 행은 모델 변경과 한 트랜잭션이다"가 일반적으로 잠근다 — `resolve`의 라이브러리 쓰기와 요청 행 종결은 같은 훅 한 몸이라 그 보장을 상속한다. **`promotion` 전용 원자성 테스트는 불필요하고, `promotion_requests`가 프로젝트·라이브러리 양쪽 cascade라 만들면 오히려 가짜 통과가 되기 쉽다**(실패를 주입하려 지우면 요청 행도 함께 사라진다)
- **`loadLibraryItems`의 `orderBy(asc(createdAt))`가 어떤 서버 테스트로도 잠겨 있지 않다** — 이 정렬은 `planPromote`의 동명 선점 순서를 정하므로 조용히 바뀌면 승격 대상이 달라진다. core의 순서 결정성 테스트는 `planPromote` 함수의 성질만 보고 서버가 먹이는 순서는 검증하지 않는다. **검증 불가능한 것이 아니라 이번 범위 밖이었다** — 동명 항목 둘을 `createdAt` 명시로 직접 insert한 뒤 `promotion.get`의 `entries[0].targetItemId`가 오래된 쪽인지 보면 `asc`→`desc` 뒤집기를 확실히 잡는다. 자리는 `resource-promote.test.ts`이고 이 사이클 이전부터 있던 공백이다
- **`pendingCount`의 다중 조직 집계가 미검증이다** — `byOrg`가 2원소 이상인 경로가 한 번도 실행되지 않는다. 덮으려면 오너가 소유한 세 번째 조직 + 정렬 안정화(`orgId` 정렬 또는 `expect.arrayContaining`)가 필요하다
- **생성 후 요청을 편집할 수 없다**(항목을 더하거나 빼려면 취소하고 다시 만든다), **pending 요청이 만료되지 않는다**, **요청 시점의 상태를 저장하지 않아** 승인 화면이 "요청 당시 이랬는데 지금 이렇다"를 보여줄 수 없다, **요청자에게 결과가 푸시되지 않는다**(프로젝트 승격 탭을 열어야 안다)
- **`resolve`가 0건 승격을 포함해 `resolved`로 남긴다** — 승인자가 골랐으나 전부 `skipped`된 경우도 `resolved`이고 `approvedEntityIds`가 빈 배열인 것으로만 구분된다
- **`summary`에 실제 승격 건수를 넣을 수 없다** — `summary`는 string이라 `mutateAndPublish` 호출 시점에 확정되는데 `outcome`은 `prepare` 훅이 돈 뒤에야 채워진다. 현재는 호출 시점에 아는 값("요청 N건 중 M건 승인")을 쓴다
- 코드 정리 여지: `mutateAndPublish` 스캐폴딩이 `routers/resource.ts`와 `promotion.ts`에 축자 중복(배선이라 값이 갈리지는 않는다), `resolve`가 88줄 단일 함수, 승인 권한 규칙이 `requireScopeWrite`와 `pendingCount`의 `inArray`에 따로 표현(`ORG_WRITE_ROLES` 공유 상수 권장), `promotion.get`이 요청 행을 통째로 스프레드, `org-detail.tsx`의 `canManage` 식 중복, 요청 경로의 op 상한 가드·요청 메모(`note`)·대기 목록의 `libraryId` 필터·목록의 `isError` 알림·`resolve`의 `onError` 토스트가 미검증

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

**권한 (역할 기반 읽기 전용 — 구현 완료, 잔여 한계)**
- 읽기 전용 판정은 `project.get` 응답에 의존한다. 다른 사용자가 내 역할을 낮춰도 **내 화면은 새로고침 전까지 편집 가능 상태로 남는다**(실시간으로 권한 변경을 밀어주지 않는다). 서버가 막으므로 데이터는 안전하고, 편집 시도가 토스트로 거절된다
- Org Owner/Admin은 프로젝트 멤버가 아니어도 항상 `canEdit`·`canManage`가 참이다(`perm.ts`의 기존 정책 그대로)
- presence에서 Viewer와 Editor를 구분해 표시하지 않는다
- `domain-edit-dialog`·`custom-field-edit-dialog`, 그리고 `dict-panel.tsx`의 `WordEditDialog`·`TermEditDialog`에는 권한 분기가 없다. 부모 패널이 여는 추가·수정 버튼을 숨겨 도달 불가이기 때문이다 — 나중에 다른 곳에서 이 다이얼로그들을 렌더하면 가드를 추가해야 한다(`useSubmit` 가드가 저장은 막는다)
- **프로젝트 전환 시 권한이 fail-closed로 초기화되지 않는다.** `reset()`은 프로덕션에서 호출되지 않고 `setLoaded`도 권한을 건드리지 않으므로, 프로젝트 A→B 전환 시 `project.get(B)`가 도착할 때까지 A의 권한이 남는다. 실제 위험은 낮다 — `httpBatchLink`가 `model.get`/`project.get`을 한 요청으로 묶어 사실상 동시에 도착한다. 남는 창은 `project.get`만 에러일 때뿐이고 그때는 fail-open이 된다(서버가 막으므로 데이터는 안전, 대신 FORBIDDEN 바운스가 발생). 고친다면 `useModelLoader`에서 `projectId` 변경 시 초기화해야 하며, **`setLoaded` 안에 넣으면 안 된다** — mutation 실패 롤백이 같은 함수를 쓰므로 Editor가 잠긴다.
- **`project-settings.tsx:109`의 역할 조합식이 이제 중복이다.** `p.myOrgRole === 'owner' || … || p.myRole === 'admin'`은 오늘 `perm.ts`와 정확히 일치하지만, 같은 응답에 이제 `canManage`가 실려 온다. "클라가 역할 조합식을 재현하지 않는다"는 제약을 지키려면 한 줄 교체가 자연스럽다(설계가 이 파일을 범위 밖으로 뒀으므로 이월).
- **잔여 커버리지 구멍:** `toolbar.tsx`의 Cmd+Z 가드(리포 전체에 키보드 단축키 테스트가 0건), `group-panel.tsx`의 색상 입력 `disabled`(같은 성격의 `note-panel`만 검증됨), `relationship-panel.tsx`의 관계명 `readOnly`·컬럼 매핑 select `disabled`, `resource-panel.tsx`의 충돌 라디오 숨김(테스트 픽스처에 충돌 항목이 없어 미도달), `ghost-node.tsx`의 `isConnectable` 배선(`ghost-nodes.ts`가 이미 `connectable:false`라 실질 no-op).

**DDL 역설계 (구현 완료, 잔여 한계)**
- **가져온 컬럼의 도메인이 비어 있다.** 내보내기가 도메인을 타입으로 풀어 쓰므로 DDL에 도메인의 흔적이 없다. 타입만 채우고 `domainId`는 `null`이다 — 도메인 자동 매칭은 후속
- **왕복이 깨지는 조합이 5건 있다**(`JSON`→oracle/mssql, `DATE`·`TIME`→oracle, `UUID`→mysql). 내보내기 매핑이 단사가 아니어서 생기는 성질이고 `dialect.test.ts`의 `ROUND_TRIP_LOSSES`에 상수로 고정돼 있다. `toDialectType`을 고치면 이 목록도 함께 봐야 한다
- **Oracle `TIMESTAMP`는 의도적으로 `DATETIME`으로 읽는다.** 우리 매핑상 `TIME`으로 읽으면 왕복이 살아나지만 실무 Oracle DDL의 `TIMESTAMP`는 거의 항상 일시다
- 기존 테이블과의 **병합·재동기화가 없다** — 이름이 겹치면 건너뛴다. 운영 DB가 바뀐 뒤 다시 가져오는 시나리오는 미지원
- `CHECK` 제약을 도메인 허용값으로 변환하지 않는다(건너뛰고 경고)
- 파서는 `CREATE TABLE`·`ALTER TABLE ADD CONSTRAINT`·`CREATE INDEX`·`COMMENT ON`만 안다. 뷰·프로시저·트리거·시퀀스는 건너뛴다
- **인덱스 컬럼의 정렬 방향(`ASC`/`DESC`)이 유실된다.** 파서의 `identifierList`가 방향 토큰을 버려 계획 타입에 자리가 없고, 적용 시 전부 `'asc'`로 고정된다
- **관계 카디널리티가 항상 `1:N`이다.** 자식 FK 컬럼에 `UNIQUE`가 걸린 1:1 관계도 `1:N`으로 저장된다. 계획 단계가 UNIQUE 제약을 관계 판정에 쓰지 않기 때문이다
- **컬럼 인라인 `UNIQUE`(`ID INT UNIQUE`)를 파싱하지 않는다.** `ParsedColumn`에 자리가 없다. `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE`와 테이블 제약 `UNIQUE (...)`는 유니크 인덱스로 정상 합류한다
- **`0개 테이블 만들기` 버튼이 눌러도 반응이 없다.** 만들 것이 0개여도 버튼이 활성이고, 눌러도 다이얼로그가 닫히지 않으며 토스트도 없다. 기능적으로는 안전(빈 Revision이 생기지 않고 모델도 불변)하나 사용자에게는 먹통으로 보인다 — 비활성화하거나 안내 후 닫는 편이 낫다
- **MSSQL 코멘트는 왕복하지 않는다.** 내보내기가 `EXEC sys.sp_addextendedproperty`로 내는데 그 문장 형태는 파싱 범위 밖이다. 구조는 왕복하고 논리명만 물리명으로 떨어지며 경고가 남는다. 이 동작은 테스트로 고정돼 있어 나중에 `sp_addextendedproperty` 파싱을 구현하면 그 테스트가 깨져 재검토를 강제한다

**CLI 트랙 A (구현 완료, 잔여 한계)**
- `erdd.config.yaml`의 방언·명명 규칙은 pull 시점 사본이다. 서버에서 바꾸면 다음 pull 전까지 로컬 `validate` 결과가 서버와 다를 수 있다
- 파일에 `notes`·배치 좌표·`origin`을 담지 않는다. 트랙 B의 `push`는 "파일에 없는 것은 서버에서 건드리지 않는다"를 계약으로 지켰다(`applyMerge`가 서버 값을 그대로 통과시킨다 — 아래 "CLI 트랙 B" 이월 참조)
- 토큰에 만료가 없다. 폐기만 가능하다
- npm 공개 배포 파이프라인이 없다
- **인덱스 컬럼 방향을 `"MBR_NM DESC"` 한 문자열로 적는다.** 물리명이 정확히 `' ASC'`/`' DESC'`로 끝나면 되읽기가 모호하다. 사용자 판단으로 현행 유지했고, 기존 `ddl-parse.ts:209`도 리포 전역으로 같은 가정을 쓴다
- **`pull`의 네 단계 쓰기는 원자적이지 않다.** 중단되면 base가 트리보다 오래된 상태로 남아 다음 `status`가 오탐한다. 순서를 뒤집으면 낡은 트리를 **숨기게** 되어 더 나쁘므로 "시끄럽게 틀리는" 쪽을 의도적으로 골랐다(`pull.ts`에 주석 있음). `pull --yes` 재실행으로 수렴한다
- **`validateModelIntegrity`는 CLI `validate` 경로에서 죽은 코드다.** `filesToModel`이 파싱 단계에서 참조 실패를 전부 잡고 키===id를 보장하므로 `ok:true`인 모델에서는 8개 검사가 구조적으로 도달 불가하다. `filesToModel`이 느슨해질 때의 방어망으로 남겨 뒀다
- **`tokensEqual`(`apps/server/src/auth/token.ts`)은 호출처가 없다.** 인증이 `tokenHash` unique 인덱스 조회 한 방이라 상수시간 비교를 쓸 자리가 없다
- **`context.ts`의 `lastUsedAt` UPDATE가 인증 경로 안에 있다.** 이 쓰기가 실패하면 유효한 토큰도 인증 실패가 된다. 현재 단일 `pg.Pool`이라 실사용 리스크는 낮으나 리드 레플리카 도입 시 재검토 대상
- **토큰 발급 화면의 "복사" 버튼이 `navigator.clipboard` 결과를 확인하지 않는다.** 비-HTTPS 환경에서 복사되지 않아도 성공 토스트가 뜬다
- **CLI의 깨진 YAML·손상된 JSON이 `CliError`로 감싸이지 않고** 원본 예외가 새어 `run()`이 `NETWORK`로 감싼다(파일 파싱 실패에 `NETWORK`는 의미상 부정확)
- **`erdd/tables/` 아래에 `.yaml`로 끝나는 디렉터리가 있으면** `writeTree`가 `EISDIR`로 실패하고 최상위 파일 정리까지 건너뛴다

**CLI 트랙 B (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-cli-push-design.md) §9)**
- 배열 안 원소 단위 병합 없음 — `index.columns` 한 원소만 달라도 필드 전체가 충돌한다
- 충돌의 대화형 해소 없음 — `erdd pull`로 서버 변경을 받은 뒤 파일에서 손으로 정리한다
- 한 push가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 거부한다. 대규모 최초 push(300테이블+)는 청크가 필요한데 "단일 Revision = undo 1회" 계약과 상충하므로 별도 설계 대상이다
- `push`가 `notes`·좌표·`origin`을 절대 건드리지 않는다 — 파일에서 메모를 관리할 수 없다(트랙 A 이월과 동일한 제약)
- `--json` 실패 응답이 `{error:{code,message}}`와 `{ok:false,conflicts:[…]}` 두 형태다. 충돌은 오류가 아니라 **계획 결과**라 후자를 쓴다(exit 1은 동일)
- `expectedSeq` 재시도는 1회다. 매우 활발한 프로젝트에서는 반복 실패할 수 있다
- ~~**`push`는 비멱등 쓰기다** — 커밋 후 응답이 유실되면 다음 push가 조용히 사본을 만든다~~ → **해소됨**(CLI push 멱등성 사이클, → [설계](specs/2026-08-05-cli-push-idempotency-design.md)). `filesToModel`이 신규 id를 채운 트리를 함께 내고 `push`가 전송 직전 그것을 **원래 파일 경로에** 기록한다(3.9절). 서버 변경·마이그레이션 없음
- `skill install`은 Claude Code 형식만 낸다(`AGENTS.md`는 범위 밖)

**CLI push 멱등성 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-05-cli-push-idempotency-design.md) §9)**
- **서버는 여전히 멱등이 아니다.** 같은 요청을 그대로 두 번 보내면 리비전이 둘 생긴다. CLI는 재전송을 하지 않으므로 이 경로를 만들지 않지만, 다른 클라이언트가 `model.push`를 직접 쓰면 가능하다. 막으려면 `revisions.request_id`(마이그레이션)가 필요하다
- **기록된 id는 회수되지 않는다.** push가 영영 실패하고 사용자가 그 항목을 파일에 남겨 두면 서버가 모르는 id가 계속 있고 `status`가 계속 "로컬 변경"이라고 말한다(맞는 표시이나 지우는 길이 없다)
- **push가 실패해도 기록 대상 파일이 한 번 재작성된다** — YAML 재직렬화라 주석·서식이 사라진다. 트리는 원래 pull마다 재작성되므로 새로운 종류의 손실은 아니지만, **실패 경로에서도 일어나는 것은 이번에 생긴 동작**이다. `id`가 매핑 맨 뒤에 붙는 것(`modelToFiles`는 맨 앞)도 push가 성공하면 `syncDown`이 정규화한다
- **던져서 끝나는 경로의 봉투에는 `reservedFiles`가 없다.** `push.ts`가 직접 만드는 두 봉투(conflicts · op 상한 초과)에는 실었지만, `throw err`로 `run()`이 만드는 봉투 — 서버 거절(UNAUTHORIZED·FORBIDDEN·NOT_FOUND·VALIDATION)과 **CONFLICT 2회** — 는 그대로다. 둘 다 재시도 뒤에 닿을 수 있고 그때 워킹트리는 이미 재작성돼 있다. `CliError`에 `details`가 생겼으므로 수단은 이미 있다
- **`reserveIds`의 `rel in local` 가드와 `mkdir`은 프로덕션에서 도달하지 않는다.** `assigned`는 `localTree`의 `structuredClone`이라 키 집합이 항상 같다(실측: 가드를 지워도 cli 전부 통과 — `canonical(undefined)`가 `undefined`라 우연히 같은 결과가 난다). `reserve-ids.test.ts`는 그 갈래를 검증하는데 `tree.ts` 주석은 "닿지 않는다"고 적어 둘이 다른 이야기를 한다 — 방어 코드로 남기는 것 자체는 타당하나 어느 쪽이 사실인지 한 번 정리해야 한다
- **id를 나르지 않는 공유 참조는 검사에 걸리지 않는다.** `idOf`를 지나지 않는 자리(두 도메인이 같은 `dialectTypes` 매핑을 alias로 공유하는 것 등)는 합쳐질 id가 없어 3.9절 검사의 대상이 아니고, 그 파일이 기록 대상이 되면 `stringifyYaml`이 `&a1`/`*a1` 같은 **생성된 이름**으로 anchor를 다시 쓴다(이름이 바뀌는 것은 주석·서식 손실과 별개다)
- **전송 실패 시 자동 재시도는 없다** — 사용자가 다시 실행해야 한다(exit 1 유지). 보고 문구가 "다시 push하면 중복 없이 수렴합니다"로 바뀌었고, 그 문장이 이제 참이다

---

## 7. 새 세션 시작 프롬프트 (복사해서 사용)

```
ERDD 프로젝트를 이어서 작업한다. 먼저 CLAUDE.md(반드시 지킬 작업 규칙)와
docs/superpowers/HANDOFF.md(현재 상태·아키텍처 불변식·환경·작업 방식)를 순서대로 읽어라.

CLAUDE.md의 규칙은 예외 없이 지킨다 — 특히 메모리 기능에 프로젝트 지식을 저장하지 않는 것
(알게 된 것은 문서에 쓰고 커밋한다), 최상위에서 브랜치를 갈아타지 않는 것,
커밋은 경로를 명시해 스테이징하는 것.

다음 작업: <6절 이월 항목 정리 | docs/90-roadmap.md "추후 검토" 항목 중 하나>를 고른다.
로드맵의 Phase 1~4(DDL 역설계, CLI 트랙 A·B)가 모두 끝나 정해진 다음 Phase가 없다 —
착수 전 브레인스토밍으로 범위를 사용자와 먼저 확정해라. HANDOFF.md의 "작업 방식"대로
brainstorming(설계 결정 확인) → spec → plan → SDD 구현/리뷰 → 최종 리뷰 → 브라우저 스모크 → main 머지
순서로 가라.
```

> 마지막 문단에 실제로 고를 것을 채운다. 예: "셀프 가입·초대 메일을 붙인다(승격 요청 알림도 여기에 얹힌다)" / "실제 DB 접속 스키마 스캔을 붙인다" / "6절 이월 항목을 정리한다".
