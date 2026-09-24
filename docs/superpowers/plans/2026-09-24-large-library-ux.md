# 대용량 라이브러리 조회·편집 개선과 5,000건 분할 적용 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 16,565건 규모의 공용 라이브러리를 관리 화면·에디터에서 탭·검색·페이지로 빠르게 보고, 5,000 op 를 넘는 모델 편집·승격을 막지 않고 조각으로 나눠 보내되 실행 취소는 한 번으로 되돌린다.

**Architecture:** 서버에 종류·검색·페이지 단위 조회 `resource.items.page` 와 종류별 개수 `countsByKind` 를 더하고, 관리 화면은 그것으로 조회 모달을 그린다. 에디터는 이미 메모리에 있는 모델을 클라이언트에서 거르고 자른다(`filterAndPage`). 5,000 op 초과 편집은 웹의 모델 변경 저수준 단일 경로(`use-model.ts` 의 `useSubmit`) 한 곳에서 `diffModels` 순서 그대로 잘라 차례로 보내므로 소비처 넷(재동기화·Excel 사전·일괄 삭제·DDL)은 나눔을 모른다. 승격은 클라이언트가 선택을 5,000건씩 잘라 `resource.promote` 를 차례로 부르고, 승격 요청·승인은 나누지 않고 입력 상한을 50,000 으로 올린다.

**Tech Stack:** pnpm 모노레포 — `packages/core`(순수 TS, vitest), `apps/server`(Fastify + tRPC 11 + drizzle 0.45 + Postgres 17, vitest), `apps/web`(React 19 + TanStack Query 5 + tRPC tanstack-react-query + radix-ui + vitest/jsdom), `packages/cli`(로컬 라우터).

**Spec:** `docs/superpowers/specs/2026-09-24-large-library-ux-design.md` — 이 계획은 그 설계만 구현한다. 실행자는 둘을 함께 읽는다.

---

## Global Constraints

모든 태스크의 요구사항에 이 절이 암묵적으로 포함된다. 값은 설계 문서에서 그대로 옮겼다.

- 응답·커밋 메시지·문서·화면 문구는 **한국어**다. 코드 식별자는 그대로 둔다.
- **목록 가상화를 넣지 않는다.** 페이지 방식이다. 페이지 크기는 **50**(`PAGE_SIZE`).
- `resource.items.list` 의 **형태를 바꾸지 않는다**(CLI `dict pull`·`dict push`·`library`, 재동기화·승격 계획이 전체 목록을 전제한다).
- 서버의 모델 입력 상한(`model.mutate`·`model.push` 의 `ops` 최대 `MAX_OPS_PER_MUTATION` = **5,000**)과 `resource.promote` 의 `entries` 상한(5,000)은 **그대로 둔다.**
- `resource.items.page` 입력: `{ libraryId: string; kind: ResourceKind; query?: string; offset: number; limit: number }`, **`limit` 1..200**. 출력: `{ items: { id; kind; payload; version }[]; total: number }`. **`apiProcedure` 로 열지 않는다(세션 전용).** 권한은 `items.list` 와 같은 `requireLibraryRead`.
- 검색: `query.trim()` 이 비면 거르지 않는다. 대소문자 무시 부분 일치(`ILIKE`, `%`·`_`·`\` 이스케이프). 필드 — 단어 `logicalName`·`abbreviation`·`englishName`, 용어 `logicalName`·`physicalName`, 도메인·커스텀 `name`. 정렬 — 논리명 칸(`logicalName`/`name`) 오름차순, 같으면 `id`.
- `library.list`·`library.listForProject` 에 `countsByKind: Record<ResourceKind, number>` 를 더하고 **`itemCount` 는 남긴다.**
- 인덱스: `resource_items (library_id, kind)` 복합 인덱스를 더하고 `ix_resource_items_library_id` 를 지운다. 식 인덱스는 넣지 않는다.
- 표시: core `resourceSecondaryName(kind, payload): string | null`(단어 `abbreviation`, 용어 `physicalName`, 나머지 `null`). 숫자는 `formatCount(n)`(`ko-KR` 천 단위, `16565 → "16,565"`).
- 관리 화면: 목록 행 `〈설명〉 · 항목 16,565개`, 행을 누르면 「라이브러리 조회 — 〈이름〉」 모달. 탭 「단어 (3,280)」·「용어 (13,159)」·「도메인 (126)」·「커스텀 항목 (0)」, 처음은 단어. 탭마다 검색창(**300ms 디바운스**)·표·페이지. 검색어를 바꾸면 1페이지, 탭별 검색어·페이지 유지. 끝 열 버전 `v3`, 관리 권한이면 편집·삭제·「추가」. 빈 결과 문구 「검색 결과가 없습니다」(검색 중) / 「항목이 없습니다」(빈 탭). 용어 폼·용어 표의 도메인은 `items.page({kind:'domain', limit:200})` 를 끝까지 받아 푼다.
- 나눠 보내기: 5,000 이하는 지금처럼 한 번. 넘으면 `diffModels` 순서 그대로 5,000씩 잘라 차례로. 요약 `〈원래 요약〉 (1/4)`. 낙관적 반영은 처음 한 번. 모두 성공하면 `recordEdit(ops)` 한 번. 진행 표시 「적용 중… 2 / 4」(조각이 둘 이상일 때만, `onProgress(done, total)`). 중간 실패 토스트 「4개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 〈오류〉」. 첫 조각 실패는 지금의 단일 실패와 같다. 조각 사이 seq 간극이면 끝까지 보낸 뒤 `resync`. 프로젝트를 떠나면 남은 조각을 보내지 않는다.
- 승격: 클라이언트가 계획 항목 순서(도메인 → 단어 → 용어 → 커스텀) 그대로 5,000건씩 잘라 차례로 부른다. 결과는 합쳐 토스트 하나. 중간 실패 「N건 중 M건 승격했습니다 — 〈오류〉」 뒤 계획을 다시 불러온다.
- 승격 요청·승인 입력 상한은 **50,000** = core `MAX_LIBRARY_FILE_ITEMS`(이미 있는 공유 상수를 그대로 쓴다).
- 걷는 문구 넷: `overLimitMessage`(「한 번에 5000건까지 적용할 수 있습니다…」), Excel 사전의 `tooManyOps`, 일괄 삭제의 `tooBig`(「한 번에 지우기에 너무 많습니다」), DDL 의 `overLimit`.
- 커밋은 **경로 지정 + add 한 명령** 형태만 쓴다: `git add <경로들> && git commit -m "…" -- <경로들>`. `git add -A`/`.`/`commit -a` 금지. 메시지 말미 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `.idea/*`·`.env` 는 커밋하지 않는다.
- 🔥 **`.env` 를 로드한 채 `pnpm verify` 를 돌리지 않는다**(개발 DB 가 통째로 비워진다). 서버 테스트는 늘 **격리 test DB 를 인라인으로** 준다.
- `pnpm -s -r typecheck` 는 오류가 있어도 출력이 비고 종료코드만 1 이다 — **`pnpm -r typecheck; echo "EXIT=$?"` 로 종료코드를 본다**(파이프 금지).

## Review Focus

설계가 요구하는 동작에 딸려 오지만 설계의 테스트 표가 직접 겨누지 않는, 사람이 가장 먼저 밟을 다섯 가지다. 각 줄의 테스트는 괄호의 태스크에 들어 있다.

1. **검색어에 `%`·`_`·`\`·`(`·`.` 가 들어간다** — 사람은 글자 그대로 찾기를 기대한다. 서버 `ILIKE` 는 이스케이프해야 하고(Task 3 「검색어의 % _ \ 는 글자 그대로 찾는다」), 에디터의 클라이언트 검색은 정규식이 아니라 `includes` 여야 한다(Task 6 「특수 문자는 글자 그대로 찾는다」).
2. **마지막 페이지의 마지막 항목을 지워 전체 건수가 줄어든다** — 빈 페이지에 갇히지 않고 남은 마지막 페이지로 물러나야 한다. 관리 모달(Task 7 「마지막 쪽의 마지막 항목을 지우면 남은 마지막 쪽으로 물러난다」)과 클라이언트 페이지(Task 6 「범위를 벗어난 페이지는 마지막 페이지로 당긴다」).
3. **조각 적용이 중간에 실패한다** — 저수준 경로가 멈추는 것(설계 표)과 별개로, 다이얼로그가 「적용 중…」에 갇히거나 버튼이 잠긴 채 남으면 안 된다(Task 11 「조각 적용이 실패로 끝나면 진행 표시가 걷히고 적용 버튼이 다시 열린다」).
4. **나눠 적용하는 도중 실시간 op 가 도착하고, 사용자가 곧바로 실행 취소를 누른다** — 실시간 처리는 모든 조각 뒤로 줄을 서고, 실행 취소는 한 번 눌러 전부 되돌아가야 한다(Task 8 「조각을 보내는 동안 줄을 선 실시간 처리는 모든 조각 뒤에 돈다…」).
5. **검색 중에 「모두 선택/해제」를 누른다** — 보이는 행이 아니라 구역 전체에 적용되고, 그렇다는 안내가 보여야 한다(Task 10 「검색 중 「모두 해제」는 보이는 행이 아니라 구역 전체에 적용된다」).

이 밖에 설계 표에 없는 경계로 **요약이 200자에 가까울 때 조각 번호를 붙여도 서버 상한(200자)을 넘지 않는다**를 Task 8 이 잠근다.

---

## 워커에게 — 매 태스크 공통 지시

이 절은 모든 태스크 브리프에 그대로 붙는다(`docs/guides/worktree-workflow.md` 「서브에이전트·워커 프롬프트에 반드시 넣을 세 문장」).

1. **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크 산출물도 고치지 마라 — 단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
2. **수정 건마다 그 수정이 구분력이 있는지 확인하라 — 프로덕션 변경을 되돌려 테스트가 실패하는지 보고 복구하라. 실패하지 않으면 덮지 말고 그렇다고 보고하라.** 보고에는 「구분력 있음/없음」이 아니라 **무엇을 되돌렸고, 어느 테스트가 어떤 값으로 실패(또는 통과)했는지, 원인이 무엇인지**를 적는다.
3. (수정 워커에게) **리뷰 보고서의 제안도 검증되지 않은 주장이다** — 그대로 통과한다고 가정하지 말고 실측한 뒤, 어긋나면 다른 방법을 쓰고 근거를 보고하라.

**구분력 실증은 반드시 커밋 뒤에 한다** — 순서는 **구현 → 테스트 초록 → 커밋 → 실증(프로덕션 파일을 일부러 되돌림) → `git checkout -- <path>` 로 복구 → `git status` clean**. 커밋 전에 `checkout` 하면 그 파일의 구현이 통째로 사라진다. ⚠️ **이번 태스크에서 새로 만든 파일은 `checkout` 으로 복구되지 않는다**(커밋 뒤에는 된다 — 커밋이 끝났으면 tracked 다). 커밋 전 실증은 금지다.

**테스트 「통과」를 보고하기 전에 실제 실행 개수를 본다.** vitest 요약의 `Tests  N passed` 의 N 이 0 이 아니어야 하고, 서버 스위트는 `skipped` 가 0 이어야 한다(`DATABASE_URL` 이 없으면 조용히 전건 skip 된다). 보고에 개수를 함께 적는다.

**작업 위치는 워크트리다.** 모든 명령은 `/Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-large-library-ux` 에서 돈다. 최상위 체크아웃에서 아무것도 쓰지 않는다. `main` 을 체크아웃·병합하지 않는다.

**이 계획의 test DB·포트(Task 0 이 정한다):** test DB `postgres://postgres:erdd@localhost:5432/erdd_test_a`, dev DB `erdd_dev_a`, server 3001, web 5174. Task 0 이 슬롯 B 를 골랐으면 전부 `_b`/3002/5175 로 바꿔 읽는다.

---

## 착수 시점 서술 목록 — 「기존 동작을 없애는」 서술

이 사이클은 「5,000건 사전 차단」과 「Revision 1건 = undo 1회」라는 기존 서술을 거짓으로 만든다. 계획 작성 시점에
`grep -rnE "Revision 1건|undo 1회|undo 한 번|5000건|5,000건|MAX_OPS_PER_MUTATION|실행 취소 1회|단일 뮤테이션|단일 mutation|mutation 1건" --exclude-dir=node_modules --exclude-dir=.worktrees --exclude-dir=superpowers --exclude-dir=dist .`
로 만든 목록과 배분이다(범위: 저장소 전체, `docs/superpowers/`·`node_modules`·`dist` 제외, 줄 단위). Task 0 이 같은 명령을 다시 돌려 목록이 그대로인지 확인한다.

| 자리 | 지금 말하는 것 | 배분 |
|---|---|---|
| `apps/web/src/editor/resource-decisions.ts`(`overLimitMessage`, `countActive` 주석) | 5,000 사전 차단 | Task 11 |
| `apps/web/src/editor/resource-resync-tab.tsx`(컴포넌트 주석 「Revision 1건·undo 1회」) | 단일 Revision | Task 11 |
| `apps/web/src/editor/dict-import-section.tsx`(`onImport` 주석, `tooManyOps`) | mutation 1건·차단 | Task 11 |
| `apps/web/src/editor/dict-import-edits.ts`(`applyDictImport` 주석) | Revision 1건 | Task 11 |
| `apps/web/src/editor/ddl-import-dialog.tsx`(컴포넌트 주석, `overLimit`, 설정 반영 주석) | Revision 1건·차단 | Task 11 |
| `apps/web/src/editor/bulk-panel.tsx`(`BulkDeleteDialog` 주석·`tooBig`) | 차단 | Task 11 |
| `apps/web/src/testing/fixtures.ts`(`modelOverOpCap` 주석) | 가드 픽스처 | Task 11 |
| `apps/web/src/editor/resource-promote-tab.tsx`(`overLimitMessage` 두 곳) | 차단 | Task 12 |
| 테스트: `resource-decisions.test.ts`·`resource-panel.test.tsx`·`resource-promote-tab.test.tsx`·`dict-import-section.test.tsx`·`bulk-panel.test.tsx`·`toolbar.test.tsx` 의 상한 단언 | 차단 | Task 11·12 |
| `packages/core/src/op-guard.ts`(`MAX_OPS_PER_MUTATION` 주석) | 「웹의 사전 가드」·「undo 1회로 되돌리기 위해 한 mutation」 | Task 15 |
| `packages/core/src/ddl-import.ts`(`tableOptions` 주석), `packages/cli/src/commands/import.ts`(같은 취지) | 「Revision 1건 = undo 1회」 규약 | Task 15 |
| `apps/web/src/editor/custom-field-edits.ts`(「단일 뮤테이션 = Revision 1건」), `dict-edits.ts`(`applyTermPropagation` 주석) | 대량이면 거짓이 될 수 있음 | Task 15 |
| `docs/guides/data-layer.md`, `docs/guides/shared-resources.md`, `docs/guides/cli.md`(「push·병합」), `docs/manual/user-guide.md`(9·10·11·13·16·19·20절), `docs/manual/cli-guide.md`(push 오류 표의 이유 칸) | 차단·단일 Revision | Task 15 |
| `apps/web/src/editor/name-pair.tsx`·`use-shortcuts.ts`·`bulk-panel.tsx`(그룹 이동 주석)·`testing/settle.ts`·그 밖의 테스트 이름 | 작은 편집의 「Revision 1건」 — 5,000 op 에 닿지 않아 **여전히 참** | 손대지 않는다(Task 15 가 분류 결과만 보고) |
| `apps/server/src/server.ts`(`bodyLimit` 주석) | 요청 하나의 크기 — **여전히 참** | 손대지 않는다 |
| `packages/cli/src/commands/push.ts`·`dict-push.ts`·`local/store.ts` 의 상한 | CLI·로컬 저장소의 요청 상한 — 설계 범위 밖, 동작 불변 | 손대지 않는다 |

---

## File Structure

| 파일 | 만들기/고치기 | 책임 |
|---|---|---|
| `packages/core/src/diff-prefix.test.ts` | 만들기 | `diffModels` 결과의 모든 접두사·5,000 조각 경계 무결성 잠금 |
| `packages/core/src/resource.ts`, `resource.test.ts`, `index.ts` | 고치기 | `resourceSecondaryName` |
| `apps/server/src/services/resource-library.ts` | 고치기 | `escapeLike`·`PAGE_SEARCH_FIELDS`·`loadLibraryItemPage` |
| `apps/server/src/routers/resource.ts` | 고치기 | `items.page`, `listWithCounts` 의 `countsByKind` |
| `apps/server/src/db/schema.ts`, `apps/server/drizzle/0015_resource_items_library_kind.sql`(+meta 둘) | 고치기/생성 | `(library_id, kind)` 인덱스 |
| `apps/server/src/routers/resource-browse.test.ts` | 만들기 | `items.page`·`countsByKind`·인덱스 |
| `apps/server/src/routers/promotion.ts`, `promotion.test.ts` | 고치기 | 요청·승인 상한 50,000 |
| `apps/web/src/lib/format.ts`(+test) | 고치기/만들기 | `formatCount`·`formatProgress` |
| `apps/web/src/lib/paginate.ts`(+test) | 만들기 | `PAGE_SIZE`·`matchesQuery`·`filterAndPage` |
| `apps/web/src/lib/use-list-page.ts`(+test) | 만들기 | 검색어·페이지 상태 훅 |
| `apps/web/src/lib/use-debounced-value.ts`(+test) | 만들기 | 디바운스 훅 |
| `apps/web/src/components/ui/tabs.tsx`(+test), `ui/pagination.tsx`(+test) | 만들기 | 공용 UI 부품 |
| `apps/web/src/lib/library-domains.ts`(+test) | 만들기 | 라이브러리 도메인 전체 받기(`items.page` 페이지 끝까지) |
| `apps/web/src/components/library-view-dialog.tsx`(+test) | 만들기 | 라이브러리 조회 모달 |
| `apps/web/src/components/resource-library-manager.tsx`(+test) | 고치기 | 목록 행 → 모달, `items.list` 제거 |
| `apps/web/src/components/library-import-dialog.tsx`(+test) | 고치기 | `items.list` 대신 도메인 조회 |
| `apps/web/src/components/promotion-requests-section.tsx` | 고치기 | 승인 뒤 `items.page` 무효화 |
| `apps/web/src/editor/mutation-chunks.ts`(+test) | 만들기 | 조각 자르기·요약 번호·실패 문구 |
| `apps/web/src/editor/use-model.ts`, `use-model-chunks.test.tsx` | 고치기/만들기 | 저수준 경로의 나눠 보내기 |
| `packages/cli/src/local/router.test.ts` | 고치기 | 로컬 모드가 조각을 차례로 받는지 확인 |
| `apps/web/src/components/paged-section.tsx`(+test) | 만들기 | 구역 검색·페이지(재동기화·승격 공용) |
| `apps/web/src/editor/resource-resync-tab.tsx`, `resource-panel.tsx`, `components/promote-entry-list.tsx` (+tests) | 고치기 | 구역 페이지, 물리명, Tabs, 개수 |
| `apps/web/src/editor/resource-decisions.ts`, `dict-import-section.tsx`, `dict-import-edits.ts`, `bulk-panel.tsx`, `ddl-import-dialog.tsx`, `testing/fixtures.ts` (+tests) | 고치기 | 5,000 차단 걷기·진행 표시 |
| `apps/web/src/lib/promote-chunks.ts`(+test), `lib/promote-selection.ts`, `editor/resource-promote-tab.tsx`(+test) | 만들기/고치기 | 승격 나눠 부르기 |
| `apps/web/src/editor/dict-edits.ts`, `dict-panel.tsx` (+tests) | 고치기 | `buildUsageIndex`, 사전 패널 탭·검색·페이지 |
| `apps/web/src/editor/domain-panel.tsx`, `custom-field-panel.tsx` (+tests) | 고치기 | 검색·페이지·순서 버튼 잠금 |
| `docs/guides/*`, `docs/manual/*`, 코드 주석 | 고치기 | Task 15 |

---

### Task 0: 워크트리 준비 (워커)

컨트롤러가 워크트리를 만든 뒤(`git worktree add -b feat/large-library-ux .worktrees/feat-large-library-ux main`) 워커가 이 태스크부터 한다. 커밋은 없다.

**Files:** 없음(저장소 밖 DB·워크트리 `.env` 만 만든다).

- [ ] **Step 1: 위치와 브랜치를 확인한다**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-large-library-ux
git status --short --branch
git log --oneline -3
git worktree list
```
기대: 첫 줄 `## feat/large-library-ux`, 최근 커밋에 설계 문서 커밋(`docs: 대용량 라이브러리 조회·편집 개선과 5,000건 분할 적용 설계를 적는다`)이 보인다. `git worktree list` 에 다른 트랙이 슬롯 A(`erdd_test_a`/3001)를 쓰고 있으면 슬롯 B 로 바꿔 이하 전부를 읽고 보고한다.

- [ ] **Step 2: 의존성을 설치한다**

```bash
pnpm install
```
기대: 종료코드 0.

- [ ] **Step 3: 격리 DB 를 만들고 마이그레이션을 적용한다(인라인 + 원시 호출 — `pnpm db:*` 금지)**

```bash
docker ps --filter name=erdd-db
docker exec -i erdd-db-1 createdb -U postgres erdd_dev_a
docker exec -i erdd-db-1 createdb -U postgres erdd_test_a
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a' pnpm -C apps/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec drizzle-kit migrate
```
기대: `createdb` 는 성공하거나 「already exists」만 낸다(다른 오류면 멈추고 보고). migrate 는 둘 다 성공.

- [ ] **Step 4: 워크트리 `.env` 를 dev DB 로 만든다(포트는 적지 않는다)**

```bash
cp /Users/jang2162/IdeaProjects/ERDD/.env .env
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd_dev_a#' .env
grep '^DATABASE_URL' .env
git status --short
```
기대: `DATABASE_URL=…/erdd_dev_a`. `git status` 에 `.env` 가 나오지 않는다(gitignore).

- [ ] **Step 5: 기준선 — 네 스위트와 typecheck 를 돌려 실행 개수를 적어 둔다**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/cli exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 전부 통과, 서버 `skipped` 0, `EXIT=0`. 스위트별 `Tests N passed` 를 보고에 적는다(이후 태스크가 이 수에서 늘어난 것을 확인한다).

- [ ] **Step 6: 착수 시점 서술 목록을 다시 센다**

```bash
grep -rnE "Revision 1건|undo 1회|undo 한 번|5000건|5,000건|MAX_OPS_PER_MUTATION|실행 취소 1회|단일 뮤테이션|단일 mutation|mutation 1건" --exclude-dir=node_modules --exclude-dir=.worktrees --exclude-dir=superpowers --exclude-dir=dist . | grep -v '^./.git/' | wc -l
```
기대: 계획 작성 시점과 같은 **104** 줄(같은 패턴을 `git grep -nE "…" -- . ':!docs/superpowers' | wc -l` 로 한 번 더 세어 둘이 같아야 한다 — 계획서 파일 자신은 `docs/superpowers/` 라 빠진다). 다르면 늘어난 줄을 보고한다(배분 표에 없는 자리가 생긴 것이다).

---

### Task 1: core — `diffModels` 모든 접두사 무결성 (가장 위험한 불변식을 먼저)

설계 5절 「조각 순서가 정확성 조건인 이유」의 불변식을 **구현보다 먼저** 테스트로 확인한다. 이 태스크는 프로덕션 코드를 바꾸지 않는다.

⚠️ **이 테스트가 실패하면 구현을 멈추고 보고한다**(설계의 지시). 실패한 픽스처·op 인덱스·`validateModelIntegrity` 메시지를 그대로 적는다. 테스트나 `diffModels` 를 고쳐 통과시키지 않는다.

참고: 이 불변식이 **일반적으로** 참이 아닌 모양이 하나 있다 — 컬럼의 `tableId` 를 바꾸는 update(갱신은 종류 순이라 컬럼 update 와 그 컬럼을 가리키는 관계·인덱스 update 사이에서 자르면 중간 상태가 깨진다). 웹에는 컬럼을 다른 테이블로 옮기는 편집이 없다(`apps/web/src/editor` 에 `tableId` 를 바꾸는 편집 함수가 없다 — 계획 작성 시 grep 확인). 아래 픽스처는 그 모양을 만들지 않는다. Task 15 가 이것을 `data-layer.md` 「알려진 한계」에 적는다.

**Files:**
- Create: `packages/core/src/diff-prefix.test.ts`

**Interfaces:**
- Consumes: `diffModels(base, target): Op[]`(`diff.ts`), `applyOps(model, ops)`(`op.ts` — 끝에서 무결성을 검사하고 어기면 `OpApplyError` 를 던진다), `validateModelIntegrity(model)`(`integrity.ts`), `MAX_OPS_PER_MUTATION`(`op-guard.ts`), `createEmptyModel`(`model.ts`), `buildSampleModel`(`testing/fixtures.ts`).
- Produces: 없음(잠금 테스트). Task 8 이 이 불변식에 기댄다.

- [ ] **Step 1: 테스트를 쓴다**

```ts
// packages/core/src/diff-prefix.test.ts
import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from './op.js'
import { diffModels } from './diff.js'
import { validateModelIntegrity } from './integrity.js'
import { MAX_OPS_PER_MUTATION } from './op-guard.js'
import {
  createEmptyModel, type Column, type Domain, type IndexDef, type ProjectModel, type Relationship,
  type Table, type TableGroup, type Term,
} from './model.js'
import { buildSampleModel } from './testing/fixtures.js'

/**
 * 웹은 5,000 op 를 넘는 편집을 `diffModels` 가 낸 순서 그대로 잘라 조각마다 따로 서버에 보낸다
 * (guides/data-layer.md 「한 요청의 op 상한은 …」). 서버는 조각 하나를 독립된 mutation 으로 적용하므로
 * **모든 조각 경계의 중간 상태가 무결해야 한다.** 여기서 그것을 잠근다.
 */

const pad = (prefix: string, i: number) => `${prefix}-${String(i).padStart(6, '0')}`

function group(id: string): TableGroup {
  return { id, name: id, color: '#4A90D9', comment: null, alias: '' }
}
function domain(id: string): Domain {
  return {
    id, name: id, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}
function term(id: string, domainId: string | null): Term {
  return { id, logicalName: id, physicalName: id.toUpperCase(), domainId, description: null, origin: null }
}
function table(id: string, groupId: string | null): Table {
  return {
    id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
}
function column(id: string, tableId: string, order: number, domainId: string | null): Column {
  return {
    id, tableId, logicalName: id, physicalName: id.toUpperCase(), type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order, comment: null, domainId, custom: {},
  }
}
function relationship(id: string, parentTableId: string, childTableId: string, childColumnId: string, parentColumnId: string): Relationship {
  return {
    id, parentTableId, childTableId, columnMappings: [{ childColumnId, parentColumnId }],
    cardinality: '1:N', identifying: false, name: null,
  }
}
function index(id: string, tableId: string, columnId: string): IndexDef {
  return { id, tableId, name: id.toUpperCase(), columns: [{ columnId, direction: 'asc' }], unique: false }
}

/** ops 를 size 씩 잘라 차례로 적용한다 — 웹의 나눠 보내기와 같은 자름. 조각마다 무결성을 본다. */
function applyInChunks(base: ProjectModel, ops: readonly Op[], size: number): ProjectModel {
  let model = base
  for (let start = 0; start < ops.length; start += size) {
    // applyOps 는 끝에서 무결성을 검사하고 어기면 OpApplyError 를 던진다 — 던지면 그 조각 경계가 깨진 것이다.
    model = applyOps(model, ops.slice(start, start + size))
    expect(validateModelIntegrity(model), `op[${start}..${start + size - 1}] 까지 적용한 상태`).toEqual([])
  }
  return model
}

/** 모든 접두사(op 하나씩)를 본다. O(n²) 이라 작은 픽스처에만 쓴다. */
function expectEveryPrefixValid(base: ProjectModel, ops: readonly Op[]): ProjectModel {
  let model = base
  ops.forEach((op, i) => {
    model = applyOps(model, [op])
    expect(validateModelIntegrity(model), `op[${i}] ${op.action} ${op.entity} ${op.entityId} 까지`).toEqual([])
  })
  return model
}

/** 갱신·추가·삭제가 섞이고 참조가 서로 걸린 작은 두 모델. */
function mixedPair(): { before: ProjectModel; after: ProjectModel } {
  const before = createEmptyModel()
  before.tableGroups.g1 = group('g1')
  before.domains.dOld = domain('dOld')
  before.terms.tm1 = term('tm1', 'dOld')
  before.tables.t1 = table('t1', 'g1')
  before.tables.t2 = table('t2', 'g1')
  before.columns.c1 = column('c1', 't1', 0, 'dOld')
  before.columns.c2 = column('c2', 't2', 0, null)
  before.relationships.r1 = relationship('r1', 't1', 't2', 'c2', 'c1')
  before.indexes.i1 = index('i1', 't2', 'c2')

  const after = createEmptyModel()
  after.tableGroups.g2 = group('g2')                       // g1 삭제, g2 추가
  after.domains.dNew = domain('dNew')                      // dOld 삭제, dNew 추가
  after.terms.tm1 = term('tm1', 'dNew')                    // 갱신: 삭제될 도메인 → 새 도메인
  after.tables.t1 = table('t1', 'g2')                      // 갱신: 삭제될 그룹 → 새 그룹
  after.columns.c1 = column('c1', 't1', 0, 'dNew')         // 갱신: 도메인 이동
  after.tables.t3 = table('t3', 'g2')                      // t2(와 c2·r1·i1) 삭제, t3 추가
  after.columns.c3 = column('c3', 't3', 0, 'dNew')
  after.relationships.r2 = relationship('r2', 't1', 't3', 'c3', 'c1')
  after.indexes.i2 = index('i2', 't3', 'c3')
  return { before, after }
}

describe('diffModels — 모든 접두사 무결성(나눠 보내기의 정확성 조건)', () => {
  it('픽스처 자체가 무결하다', () => {
    const { before, after } = mixedPair()
    expect(validateModelIntegrity(before)).toEqual([])
    expect(validateModelIntegrity(after)).toEqual([])
  })

  it('갱신·추가·삭제가 섞인 diff 의 모든 접두사가 무결하다 — 양방향(적용과 실행 취소)', () => {
    const { before, after } = mixedPair()
    expect(expectEveryPrefixValid(before, diffModels(before, after))).toEqual(after)
    expect(expectEveryPrefixValid(after, diffModels(after, before))).toEqual(before)
  })

  it('모든 종류가 든 샘플 모델을 통째로 만들고 지우는 diff 의 모든 접두사가 무결하다', () => {
    const sample = buildSampleModel()
    const empty = createEmptyModel()
    expectEveryPrefixValid(empty, diffModels(empty, sample))
    expectEveryPrefixValid(sample, diffModels(sample, empty))
  })

  it('도메인 추가와 그것을 가리키는 용어·컬럼 추가 사이에 5,000 경계가 와도 조각마다 무결하다', () => {
    const base = createEmptyModel()
    const target = createEmptyModel()
    target.tableGroups.g1 = group('g1')
    // 그룹 1 + 도메인 4,999 = 첫 조각 5,000 — 첫 조각은 마지막 도메인에서 끝나고,
    // 둘째 조각은 그 도메인을 가리키는 용어로 시작한다.
    const DOMAINS = MAX_OPS_PER_MUTATION - 1
    for (let i = 0; i < DOMAINS; i++) target.domains[pad('d', i)] = domain(pad('d', i))
    const last = pad('d', DOMAINS - 1)
    for (let i = 0; i < 10; i++) target.terms[pad('tm', i)] = term(pad('tm', i), last)
    target.tables.t1 = table('t1', 'g1')
    target.tables.t2 = table('t2', 'g1')
    target.columns.c1 = column('c1', 't1', 0, last)
    target.columns.c2 = column('c2', 't2', 0, last)
    target.relationships.r1 = relationship('r1', 't1', 't2', 'c2', 'c1')
    target.indexes.i1 = index('i1', 't2', 'c2')
    expect(validateModelIntegrity(target)).toEqual([])

    const ops = diffModels(base, target)
    // 픽스처가 겨눈 경계가 실제로 참조 사이에 오는지부터 본다 — 아니면 이 테스트는 아무것도 잠그지 않는다.
    expect(ops[MAX_OPS_PER_MUTATION - 1]).toMatchObject({ action: 'create', entity: 'domain', entityId: last })
    expect(ops[MAX_OPS_PER_MUTATION]).toMatchObject({ action: 'create', entity: 'term' })
    expect(applyInChunks(base, ops, MAX_OPS_PER_MUTATION)).toEqual(target)

    // 역방향(실행 취소): 자식(인덱스·관계·컬럼·테이블·용어)이 앞 조각, 도메인·그룹이 뒤 조각에 걸친다.
    expect(applyInChunks(target, diffModels(target, base), MAX_OPS_PER_MUTATION)).toEqual(base)
  })

  it('테이블 삭제와 그 테이블을 가리키는 관계 삭제 사이에 5,000 경계가 와도 조각마다 무결하다', () => {
    const base = createEmptyModel()
    base.tables.t1 = table('t1', null)
    base.tables.t2 = table('t2', null)
    base.columns.c1 = column('c1', 't1', 0, null)
    base.columns.c2 = column('c2', 't2', 0, null)
    for (let i = 0; i < MAX_OPS_PER_MUTATION; i++) {
      base.relationships[pad('r', i)] = relationship(pad('r', i), 't1', 't2', 'c2', 'c1')
    }
    expect(validateModelIntegrity(base)).toEqual([])
    const target = createEmptyModel()

    const ops = diffModels(base, target)
    // 관계 삭제 5,000 이 첫 조각을 채우고, 둘째 조각이 그 관계들이 가리키던 컬럼·테이블 삭제로 시작한다.
    expect(ops[MAX_OPS_PER_MUTATION - 1]).toMatchObject({ action: 'delete', entity: 'relationship' })
    expect(ops[MAX_OPS_PER_MUTATION]).toMatchObject({ action: 'delete', entity: 'column' })
    expect(applyInChunks(base, ops, MAX_OPS_PER_MUTATION)).toEqual(target)

    // 역방향(실행 취소 = 다시 만들기): 테이블·컬럼이 앞 조각, 관계가 두 조각에 걸친다.
    expect(applyInChunks(target, diffModels(target, base), MAX_OPS_PER_MUTATION)).toEqual(base)
  })
})
```

- [ ] **Step 2: 돌린다 — 이 태스크는 처음부터 통과가 기대값이다**

Run: `pnpm --filter @erdd/core exec vitest run src/diff-prefix.test.ts`
Expected: `Tests  5 passed`. **실패하면 여기서 멈추고 보고한다**(위 ⚠️). `toEqual(target)`·`toEqual(before)` 만 실패하고 무결성 단언은 통과했다면(예: zod 가 기본값을 채워 모양이 다름) 그것은 불변식 위반이 아니다 — 그 단언을 `Object.keys(…)` 비교로 정정하고 관찰을 보고한다(워커 지시 1).

- [ ] **Step 3: 커밋**

```bash
git add packages/core/src/diff-prefix.test.ts && git commit -m "test(core): diffModels 결과의 모든 접두사와 5,000 조각 경계가 무결함을 잠근다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/core/src/diff-prefix.test.ts
```

- [ ] **Step 4: 구분력 실증(커밋 뒤)**

`packages/core/src/diff.ts` 의 `deletes.reverse()` 한 줄을 지우고(삭제가 부모 먼저가 된다) 다시 돌린다.
Run: `pnpm --filter @erdd/core exec vitest run src/diff-prefix.test.ts`
Expected: 「테이블 삭제와 … 관계 삭제」·「모든 종류가 든 샘플 모델」 등이 `OpApplyError`(존재하지 않는 테이블 참조 등)로 FAIL. 복구:
```bash
git checkout -- packages/core/src/diff.ts && git status --short
```
기대: 출력 없음(clean). 관찰(어느 테스트가 어느 메시지로 실패했는지)을 보고한다.

---

### Task 2: core — `resourceSecondaryName`

**Files:**
- Modify: `packages/core/src/resource.ts`(`resourceDisplayName` 바로 아래에 추가), `packages/core/src/index.ts`(resource 재수출 블록)
- Test: `packages/core/src/resource.test.ts`

**Interfaces:**
- Produces: `resourceSecondaryName(kind: ResourceKind, payload: Record<string, unknown>): string | null` — 단어 `abbreviation`, 용어 `physicalName`, 도메인·커스텀 `null`. 값이 문자열이 아니면 `null`. `@erdd/core` 에서 export. Task 7·10·13 이 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `resource.test.ts` 의 import 에 `resourceSecondaryName` 을 더하고 파일 끝에 붙인다.

```ts
describe('resourceSecondaryName — 물리명 칸', () => {
  it('단어는 약어, 용어는 물리명이다', () => {
    expect(resourceSecondaryName('word', { logicalName: '회원', abbreviation: 'MBR' })).toBe('MBR')
    expect(resourceSecondaryName('term', { logicalName: '회원번호', physicalName: 'MBR_NO' })).toBe('MBR_NO')
  })

  it('도메인·커스텀 항목은 물리명 칸이 없다 — 같은 이름의 키가 있어도 null', () => {
    expect(resourceSecondaryName('domain', { name: '금액', physicalName: 'X' })).toBeNull()
    expect(resourceSecondaryName('customField', { name: '개인정보여부', abbreviation: 'X' })).toBeNull()
  })

  it('값이 없거나 문자열이 아니면 null 이다', () => {
    expect(resourceSecondaryName('word', { logicalName: '회원' })).toBeNull()
    expect(resourceSecondaryName('term', { physicalName: 3 })).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource.test.ts`
Expected: FAIL — `resourceSecondaryName` 이 export 되지 않았다(`is not a function` 또는 import 오류).

- [ ] **Step 3: 구현한다** — `resource.ts` 의 `resourceDisplayName` 아래:

```ts
/**
 * 목록·충돌 화면의 **물리명 칸**. 단어는 약어, 용어는 물리명이고 도메인·커스텀 항목은 없다(null).
 * 관리 모달·에디터 패널·재동기화·승격 행이 모두 이 함수로 두 번째 칸을 그린다 — 화면마다 payload 를
 * 따로 읽으면 한쪽만 바뀐다. 논리명 칸은 `resourceDisplayName` 이다.
 */
export function resourceSecondaryName(
  kind: ResourceKind, payload: Record<string, unknown>,
): string | null {
  const key = kind === 'word' ? 'abbreviation' : kind === 'term' ? 'physicalName' : null
  if (key === null) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}
```

`index.ts` 의 resource 블록을 이렇게 바꾼다:

```ts
export {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, RESOURCE_PAYLOAD_SCHEMAS,
  resourcePayloadOf, resourceDisplayName, resourceSecondaryName, resourceEntitiesOf,
} from './resource.js'
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource.test.ts` → PASS(개수 확인). 이어서 `pnpm -C packages/core typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/resource.ts packages/core/src/resource.test.ts packages/core/src/index.ts && git commit -m "feat(core): 공용 리소스 행의 물리명 칸 resourceSecondaryName 을 더한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/core/src/resource.ts packages/core/src/resource.test.ts packages/core/src/index.ts
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)** — `resource.ts` 에서 `kind === 'term' ? 'physicalName'` 을 `kind === 'term' ? 'logicalName'` 로 바꿔 돌린다. 기대: 「단어는 약어, 용어는 물리명이다」 FAIL(`'회원번호'` ≠ `'MBR_NO'`). `git checkout -- packages/core/src/resource.ts && git status --short` → clean.

---
### Task 3: server — `resource.items.page`

**Files:**
- Modify: `apps/server/src/services/resource-library.ts`(끝에 추가), `apps/server/src/routers/resource.ts`(`items` 라우터에 `page`)
- Create (test): `apps/server/src/routers/resource-browse.test.ts`

**Interfaces:**
- Consumes: `requireLibraryRead(db, libraryId, actor)`(같은 파일), `resourceItems`(`db/schema.ts`), `RESOURCE_KINDS`·`ResourceKind`(`@erdd/core`).
- Produces:
  - `escapeLike(text: string): string` — `\`·`%`·`_` 앞에 `\` 를 붙인다.
  - `PAGE_SEARCH_FIELDS: Record<ResourceKind, readonly string[]>`
  - `loadLibraryItemPage(db: Db, input: { libraryId: string; kind: ResourceKind; query?: string; offset: number; limit: number }): Promise<{ items: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]; total: number }>`
  - tRPC `resource.items.page`(`authedProcedure` query, 입력은 Global Constraints). Task 7 이 웹에서 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/server/src/routers/resource-browse.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'

const url = process.env.DATABASE_URL

type Kind = 'domain' | 'word' | 'term' | 'customField'
type SeedRow = { kind: Kind; payload: Record<string, unknown> }
type PageItem = { id: string; kind: Kind; payload: Record<string, unknown>; version: number }

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string | null, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({
    method: 'GET', url: `/trpc/${path}${qs}`,
    ...(token === null ? {} : { cookies: { erdd_session: token } }),
  })
}

const word = (logicalName: string, abbreviation: string, englishName: string | null = null): SeedRow =>
  ({ kind: 'word', payload: { logicalName, abbreviation, englishName, description: null } })
const term = (logicalName: string, physicalName: string, description: string | null = null): SeedRow =>
  ({ kind: 'term', payload: { logicalName, physicalName, domainId: null, description } })
const domain = (name: string): SeedRow => ({
  kind: 'domain',
  payload: {
    name, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  },
})
const customField = (name: string): SeedRow => ({
  kind: 'customField',
  payload: { name, target: 'column', type: 'text', options: [], required: false, defaultValue: null },
})

/** 라이브러리 하나와 항목을 DB 에 바로 넣는다(권한 검사 밖 — 조회만 시험한다). id 는 넣은 순서대로다. */
async function seedLibrary(
  app: FastifyInstance, rows: SeedRow[],
  owner: { scope: 'global' } | { scope: 'org'; orgId: string } = { scope: 'global' },
): Promise<{ libraryId: string; ids: string[] }> {
  const libraryId = uuidv7()
  await app.db!.insert(resourceLibraries).values({
    id: libraryId, scope: owner.scope, orgId: owner.scope === 'org' ? owner.orgId : null,
    name: '표준', description: '',
  })
  const ids = rows.map(() => uuidv7())
  if (rows.length > 0) {
    await app.db!.insert(resourceItems).values(rows.map((row, i) => ({
      id: ids[i]!, libraryId, kind: row.kind, payload: row.payload, version: 1,
    })))
  }
  return { libraryId, ids }
}

async function page(
  app: FastifyInstance, token: string, input: Record<string, unknown>,
): Promise<{ status: number; items: PageItem[]; total: number }> {
  const res = await get(app, 'resource.items.page', token, input)
  if (res.statusCode !== 200) return { status: res.statusCode, items: [], total: -1 }
  const data = res.json().result.data as { items: PageItem[]; total: number }
  return { status: 200, items: data.items, total: data.total }
}
const names = (items: PageItem[]) =>
  items.map((i) => String(i.payload.logicalName ?? i.payload.name))

describe.skipIf(!url)('resource.items.page', () => {
  let app: FastifyInstance
  let token: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'u@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    token = await loginAs(app, 'u@t.dev', 'pw-123456')
  })

  it('한 종류만 논리명 오름차순으로 돌려주고 total 은 그 종류의 전체 건수다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('order', 'ORD'), word('alpha', 'ALP'), term('member_no', 'MBR_NO'), word('mike', 'MK'),
    ])
    const r = await page(app, token, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(r.status).toBe(200)
    expect(names(r.items)).toEqual(['alpha', 'mike', 'order'])
    expect(r.items.every((i) => i.kind === 'word' && i.version === 1)).toBe(true)
    expect(r.total).toBe(3)
  })

  it('도메인·커스텀 항목은 name 으로 정렬한다', async () => {
    const { libraryId } = await seedLibrary(app, [
      domain('zeta'), domain('beta'), customField('yankee'), customField('bravo'),
    ])
    expect(names((await page(app, token, { libraryId, kind: 'domain', offset: 0, limit: 50 })).items))
      .toEqual(['beta', 'zeta'])
    expect(names((await page(app, token, { libraryId, kind: 'customField', offset: 0, limit: 50 })).items))
      .toEqual(['bravo', 'yankee'])
  })

  it('단어는 논리명·약어·영문명, 용어는 논리명·물리명으로 대소문자 없이 찾고 total 도 그 조건을 따른다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('member', 'MBR', 'Member Info'), word('order', 'ORD'), word('memo', 'MEMO'),
      term('member_no', 'MBR_NO'), term('order_no', 'ORD_NO', 'member stuff'),
    ])
    const byAbbr = await page(app, token, { libraryId, kind: 'word', query: 'mbr', offset: 0, limit: 50 })
    expect(names(byAbbr.items)).toEqual(['member'])
    expect(byAbbr.total).toBe(1)
    expect(names((await page(app, token, { libraryId, kind: 'word', query: 'INFO', offset: 0, limit: 50 })).items))
      .toEqual(['member'])
    expect(names((await page(app, token, { libraryId, kind: 'term', query: 'mbr', offset: 0, limit: 50 })).items))
      .toEqual(['member_no'])
    // 설명은 검색 필드가 아니다.
    const byDescription = await page(app, token, { libraryId, kind: 'term', query: 'stuff', offset: 0, limit: 50 })
    expect(byDescription.items).toEqual([])
    expect(byDescription.total).toBe(0)
  })

  it('검색어의 % _ \\ 는 글자 그대로 찾는다', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('rate100%', 'R1'), word('rate1000', 'R2'), word('a_b', 'AB'), word('axb', 'AXB'),
      word('c\\d', 'CD1'), word('cd', 'CD2'),
    ])
    const q = async (query: string) =>
      names((await page(app, token, { libraryId, kind: 'word', query, offset: 0, limit: 50 })).items)
    expect(await q('100%')).toEqual(['rate100%'])
    expect(await q('_')).toEqual(['a_b'])
    expect(await q('\\')).toEqual(['c\\d'])
  })

  it('검색어가 공백뿐이면 거르지 않는다', async () => {
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A'), word('bravo', 'B')])
    const r = await page(app, token, { libraryId, kind: 'word', query: '   ', offset: 0, limit: 50 })
    expect(r.total).toBe(2)
  })

  it('같은 이름이 여럿이어도 페이지를 넘기며 겹치거나 빠지지 않는다 — 동률은 id 로 깬다', async () => {
    const rows = [word('alpha', 'A'), ...Array.from({ length: 7 }, () => word('same', 'S')), word('zulu', 'Z')]
    const { libraryId, ids } = await seedLibrary(app, rows)
    const seen: string[] = []
    for (const offset of [0, 4, 8]) {
      const r = await page(app, token, { libraryId, kind: 'word', offset, limit: 4 })
      expect(r.total).toBe(9)
      seen.push(...r.items.map((i) => i.id))
    }
    const sameIds = ids.slice(1, 8).sort()
    expect(seen).toEqual([ids[0], ...sameIds, ids[8]])
  })

  it('볼 수 없는 조직 라이브러리는 items.list 와 똑같이 거절한다', async () => {
    await createAccount(app.db!, { email: 'o@t.dev', name: 'O', password: 'pw-123456', role: 'user' })
    const ownerToken = await loginAs(app, 'o@t.dev', 'pw-123456')
    const orgId = (await post(app, 'org.create', ownerToken, { name: '팀' })).json().result.data.id as string
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A')], { scope: 'org', orgId })

    const outsider = await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(outsider.statusCode).toBe(403)
    expect((await get(app, 'resource.items.list', token, { libraryId })).statusCode).toBe(403)

    const member = await page(app, ownerToken, { libraryId, kind: 'word', offset: 0, limit: 50 })
    expect(member.status).toBe(200)
    expect(member.total).toBe(1)
  })

  it('limit 은 1..200 이고 세션 없이는 부를 수 없다', async () => {
    const { libraryId } = await seedLibrary(app, [word('alpha', 'A')])
    expect((await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 201 })).statusCode).toBe(400)
    expect((await get(app, 'resource.items.page', token, { libraryId, kind: 'word', offset: 0, limit: 0 })).statusCode).toBe(400)
    expect((await page(app, token, { libraryId, kind: 'word', offset: 0, limit: 200 })).status).toBe(200)
    expect((await get(app, 'resource.items.page', null, { libraryId, kind: 'word', offset: 0, limit: 50 })).statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/resource-browse.test.ts`
Expected: FAIL — 대부분 404(`No procedure found on path "resource.items.page"`). `skipped` 가 0 인지 본다(0 이 아니면 `DATABASE_URL` 이 안 들어간 것이다).

- [ ] **Step 3: 서비스 함수를 쓴다** — `apps/server/src/services/resource-library.ts`

import 두 줄을 바꾼다:

```ts
import { and, asc, count, eq, or, sql, type SQL } from 'drizzle-orm'
import { RESOURCE_PAYLOAD_SCHEMAS, type ResourceKind } from '@erdd/core'
```

파일 끝에 더한다:

```ts
/** LIKE 패턴의 메타 문자(`\`·`%`·`_`)를 글자 그대로 찾게 한다. Postgres LIKE 의 기본 ESCAPE 가 `\` 다. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** 종류별 논리명 칸 — 정렬 키이고, core `resourceDisplayName` 이 읽는 키와 같다. */
const NAME_FIELD: Record<ResourceKind, string> = {
  domain: 'name', word: 'logicalName', term: 'logicalName', customField: 'name',
}

/**
 * 조회 모달의 검색 필드. 에디터 사전·도메인·커스텀 패널의 클라이언트 검색도 같은 필드를 쓴다
 * (guides/shared-resources.md 「관리 화면의 항목 조회」) — 한쪽만 바꾸면 같은 검색어가 화면마다 다르게 걸린다.
 */
export const PAGE_SEARCH_FIELDS: Record<ResourceKind, readonly string[]> = {
  word: ['logicalName', 'abbreviation', 'englishName'],
  term: ['logicalName', 'physicalName'],
  domain: ['name'],
  customField: ['name'],
}

/** payload 의 문자열 필드. 필드 이름은 위 두 상수에서만 오므로 raw 로 박아도 주입 경로가 없다. */
function payloadText(field: string): SQL {
  return sql`(${resourceItems.payload} ->> ${sql.raw(`'${field}'`)})`
}

/**
 * 관리 화면 조회 모달의 한 페이지 — 종류 하나, 검색어로 거른 뒤 논리명 칸 오름차순·동률 id 순.
 * 동률 깨기가 없으면 같은 이름이 많을 때 페이지를 넘기며 항목이 겹치거나 빠진다.
 * 이름이 jsonb 안에 있어 정렬·검색은 인덱스를 타지 않는다 — (library_id, kind) 인덱스로 좁힌 뒤 거른다.
 */
export async function loadLibraryItemPage(
  db: Db,
  input: { libraryId: string; kind: ResourceKind; query?: string; offset: number; limit: number },
): Promise<{
  items: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]
  total: number
}> {
  const q = input.query?.trim() ?? ''
  const pattern = `%${escapeLike(q)}%`
  const where = and(
    eq(resourceItems.libraryId, input.libraryId),
    eq(resourceItems.kind, input.kind),
    q === '' ? undefined : or(...PAGE_SEARCH_FIELDS[input.kind].map((f) => sql`${payloadText(f)} ILIKE ${pattern}`)),
  )
  const [items, totals] = await Promise.all([
    db.select({
      id: resourceItems.id, kind: resourceItems.kind,
      payload: resourceItems.payload, version: resourceItems.version,
    })
      .from(resourceItems)
      .where(where)
      .orderBy(asc(payloadText(NAME_FIELD[input.kind])), asc(resourceItems.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ total: count() }).from(resourceItems).where(where),
  ])
  return { items, total: totals[0]?.total ?? 0 }
}
```

- [ ] **Step 4: 라우터에 프로시저를 단다** — `apps/server/src/routers/resource.ts`

import 를 바꾼다:

```ts
import {
  loadLibraryItemPage, parsePayload, requireLibraryRead, requireLibraryWrite, requireScopeRead,
  requireScopeWrite,
} from '../services/resource-library.js'
```

`items: router({` 안, `list` 다음에 더한다:

```ts
    // 관리 화면 조회 모달 전용 — 세션만 받는다. 토큰 소비처가 없으므로 apiProcedure 로 열지 않는다
    // (guides/cli.md 「액세스 토큰 인증」 — 토큰에 여는 것은 명시적 opt-in).
    page: authedProcedure
      .input(z.object({
        libraryId: z.string().uuid(),
        kind: KindEnum,
        query: z.string().max(200).optional(),
        offset: z.number().int().min(0),
        limit: z.number().int().min(1).max(200),
      }))
      .query(async ({ ctx, input }) => {
        // items.list 와 같은 판정이다 — 한쪽만 고치면 볼 수 없는 라이브러리가 다른 경로로 샌다.
        await requireLibraryRead(ctx.db, input.libraryId, ctx.user)
        return loadLibraryItemPage(ctx.db, input)
      }),
```

- [ ] **Step 5: 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/resource-browse.test.ts src/routers/token-api.test.ts`
Expected: PASS, `skipped` 0. `token-api.test.ts` 의 「토큰으로 부를 수 있는 프로시저가 정확히 이 열다섯(+공개 표면)이다」가 통과해야 `items.page` 가 토큰 표면에 새지 않은 것이다. 이어서 `pnpm -C apps/server typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/services/resource-library.ts apps/server/src/routers/resource.ts apps/server/src/routers/resource-browse.test.ts && git commit -m "feat(server): 라이브러리 항목을 종류·검색어·페이지로 받는 resource.items.page 를 더한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/server/src/services/resource-library.ts apps/server/src/routers/resource.ts apps/server/src/routers/resource-browse.test.ts
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — 하나씩 되돌리고 각각 돌린 뒤 `git checkout -- <file>` 로 복구한다.
  1. `escapeLike` 본문을 `return text` 로 → 「검색어의 % _ \ 는 글자 그대로 찾는다」 FAIL 기대.
  2. `orderBy` 에서 `asc(resourceItems.id)` 를 지운다 → 「같은 이름이 여럿이어도…」 FAIL 기대(동률 순서가 비결정이라 **통과할 수도 있다** — 통과하면 몇 번 돌렸는지와 함께 그대로 보고한다).
  3. `page` 의 `requireLibraryRead` 줄을 지운다 → 「볼 수 없는 조직 라이브러리는…」 FAIL 기대.
  4. `PAGE_SEARCH_FIELDS.word` 에서 `'englishName'` 을 뺀다 → 검색 필드 테스트 FAIL 기대.
  복구 후 `git status --short` 가 비어야 한다.

---

### Task 4: server — `countsByKind` 와 `(library_id, kind)` 인덱스

**Files:**
- Modify: `apps/server/src/routers/resource.ts`(`listWithCounts`), `apps/server/src/db/schema.ts`(`resourceItems` 인덱스)
- Create: `apps/server/drizzle/0015_resource_items_library_kind.sql`, `apps/server/drizzle/meta/0015_snapshot.json`, `apps/server/drizzle/meta/_journal.json`(수정) — **생성기가 만든다. 손으로 쓰지 않는다.**
- Test: `apps/server/src/routers/resource-browse.test.ts`(describe 추가)

**Interfaces:**
- Produces: `library.list`·`library.listForProject` 행에 `countsByKind: { domain: number; word: number; term: number; customField: number }`(기존 `itemCount` 유지). Task 7 이 탭 제목에 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `resource-browse.test.ts` 끝에 더한다.

```ts
describe.skipIf(!url)('library.list·listForProject — countsByKind', () => {
  let app: FastifyInstance
  let token: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'u@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    token = await loginAs(app, 'u@t.dev', 'pw-123456')
  })

  type Row = { id: string; itemCount: number; countsByKind: Record<Kind, number> }
  const sum = (c: Record<Kind, number>) => c.domain + c.word + c.term + c.customField

  it('종류별 개수를 싣고 그 합이 itemCount 와 같다 — 빈 라이브러리는 전부 0', async () => {
    const { libraryId } = await seedLibrary(app, [
      word('a', 'A'), word('b', 'B'), term('c', 'C'), domain('d'),
    ])
    const empty = await seedLibrary(app, [])
    const rows = (await get(app, 'resource.library.list', token, { scope: 'global' })).json().result.data as Row[]
    const full = rows.find((r) => r.id === libraryId)!
    expect(full.countsByKind).toEqual({ domain: 1, word: 2, term: 1, customField: 0 })
    expect(sum(full.countsByKind)).toBe(full.itemCount)
    const blank = rows.find((r) => r.id === empty.libraryId)!
    expect(blank.countsByKind).toEqual({ domain: 0, word: 0, term: 0, customField: 0 })
    expect(blank.itemCount).toBe(0)
  })

  it('listForProject 도 같은 공통 조회라 countsByKind 를 싣는다', async () => {
    const { libraryId } = await seedLibrary(app, [customField('x'), customField('y'), word('a', 'A')])
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id as string
    const projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id as string
    const rows = (await get(app, 'resource.library.listForProject', token, { projectId })).json().result.data as Row[]
    const row = rows.find((r) => r.id === libraryId)!
    expect(row.countsByKind).toEqual({ domain: 0, word: 1, term: 0, customField: 2 })
    expect(sum(row.countsByKind)).toBe(row.itemCount)
  })
})

describe.skipIf(!url)('resource_items 인덱스', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  it('(library_id, kind) 복합 인덱스가 있고 library_id 단일 인덱스는 없다', async () => {
    const { rows } = await app.pgPool!.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'resource_items'",
    )
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))
    expect(byName.has('ix_resource_items_library_id')).toBe(false)
    expect(byName.get('ix_resource_items_library_kind')).toMatch(/\(library_id, kind\)/)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/resource-browse.test.ts`
Expected: 새 셋이 FAIL(`countsByKind` undefined, 인덱스 없음). Task 3 의 테스트는 PASS 그대로.

- [ ] **Step 3: `listWithCounts` 를 고친다** — `resource.ts`

import 에 `sql` 과 `ResourceKind` 를 더한다:

```ts
import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  deepEqual, diffModels, exportLibraryFile, MAX_OPS_PER_MUTATION, OpApplyError,
  RESOURCE_KINDS, type ProjectModel, type ResourceKind,
} from '@erdd/core'
```

`listWithCounts` 를 통째로 바꾼다:

```ts
/** 종류 하나의 항목 수. left join 이라 항목이 없는 라이브러리는 0 이다. */
function kindCount(kind: ResourceKind) {
  return sql<number>`count(${resourceItems.id}) filter (where ${resourceItems.kind} = ${kind})`.mapWith(Number)
}

/**
 * 라이브러리 목록 + 항목 수. where 조건은 호출부가 만든다.
 * `itemCount` 는 CLI(`dict list`·`library list`)가 쓰고, `countsByKind` 는 관리 화면 조회 모달의 탭 제목·빈 탭
 * 표시가 쓴다. 둘 다 같은 조인·같은 그룹에서 세므로 합이 어긋나지 않는다.
 */
async function listWithCounts(db: Db, where: SQL | undefined) {
  const rows = await db
    .select({
      id: resourceLibraries.id, scope: resourceLibraries.scope, orgId: resourceLibraries.orgId,
      name: resourceLibraries.name, description: resourceLibraries.description,
      updatedAt: resourceLibraries.updatedAt, itemCount: count(resourceItems.id),
      domainCount: kindCount('domain'), wordCount: kindCount('word'),
      termCount: kindCount('term'), customFieldCount: kindCount('customField'),
    })
    .from(resourceLibraries)
    .leftJoin(resourceItems, eq(resourceItems.libraryId, resourceLibraries.id))
    .where(where)
    .groupBy(resourceLibraries.id)
    .orderBy(asc(resourceLibraries.createdAt))
  return rows.map(({ domainCount, wordCount, termCount, customFieldCount, ...row }) => ({
    ...row,
    countsByKind: {
      domain: domainCount, word: wordCount, term: termCount, customField: customFieldCount,
    } satisfies Record<ResourceKind, number>,
  }))
}
```

- [ ] **Step 4: 인덱스를 바꾸고 마이그레이션을 생성한다** — `schema.ts` 의 `resourceItems` 마지막 줄:

```ts
}, (t) => [
  // 조회 모달이 (라이브러리, 종류)로 좁혀 페이지를 자른다. 기존 library_id 단일 인덱스는 이 인덱스의 앞 열과
  // 겹쳐 지웠다 — library_id 만으로 거르는 조회(items.list·loadLibraryItems)도 이 인덱스를 탄다.
  index('ix_resource_items_library_kind').on(t.libraryId, t.kind),
])
```

생성기를 돌린다(`.env` 없이 돈다 — `pnpm db:*` 대신 원시 호출):

```bash
pnpm -C apps/server exec drizzle-kit generate --name resource_items_library_kind
cat apps/server/drizzle/0015_resource_items_library_kind.sql
git status --short apps/server/drizzle
```
Expected: SQL 파일에 `DROP INDEX "ix_resource_items_library_id";` 와 `CREATE INDEX "ix_resource_items_library_kind" ON "resource_items" USING btree ("library_id","kind");` 두 문장. 변경 파일은 새 SQL·`meta/0015_snapshot.json`·`meta/_journal.json` 셋뿐이어야 한다(다른 테이블 문장이 섞이면 멈추고 보고 — 스키마와 스냅샷이 이미 어긋나 있던 것이다).

격리 DB 둘에 적용한다:

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a' pnpm -C apps/server exec drizzle-kit migrate
```

- [ ] **Step 5: 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/resource-browse.test.ts src/routers/resource.test.ts src/routers/token-api.test.ts`
Expected: PASS, `skipped` 0. `pnpm -C apps/server typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/routers/resource.ts apps/server/src/db/schema.ts apps/server/src/routers/resource-browse.test.ts apps/server/drizzle/0015_resource_items_library_kind.sql apps/server/drizzle/meta/0015_snapshot.json apps/server/drizzle/meta/_journal.json && git commit -m "feat(server): 라이브러리 목록에 종류별 개수를 싣고 resource_items 인덱스를 (library_id, kind) 로 바꾼다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/server/src/routers/resource.ts apps/server/src/db/schema.ts apps/server/src/routers/resource-browse.test.ts apps/server/drizzle/0015_resource_items_library_kind.sql apps/server/drizzle/meta/0015_snapshot.json apps/server/drizzle/meta/_journal.json
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — `kindCount` 의 `filter (where …)` 를 지워(`count(${resourceItems.id})` 만) 돌린다 → 「종류별 개수를 싣고…」 FAIL 기대(모든 칸이 전체 수). 복구 `git checkout -- apps/server/src/routers/resource.ts && git status --short`. 인덱스 테스트의 구분력은 마이그레이션을 되돌려야 보이므로 실증하지 않는다 — 「적용 전에는 FAIL 이었다」(Step 2 출력)를 근거로 보고한다.

---

### Task 5: server — 승격 요청·승인 입력 상한 50,000

**Files:**
- Modify: `apps/server/src/routers/promotion.ts`(`create`·`resolve` 입력)
- Test: `apps/server/src/routers/promotion.test.ts`(기존 describe 안에 추가)

**Interfaces:**
- Consumes: `MAX_LIBRARY_FILE_ITEMS`(`@erdd/core`, 값 50,000 — 라이브러리 파일 상한과 같은 공유 상수).
- Produces: `promotion.create` 의 `entityIds`, `promotion.resolve` 의 `approve` 상한이 `MAX_LIBRARY_FILE_ITEMS`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `promotion.test.ts` 의 import 를 바꾸고(`MAX_LIBRARY_FILE_ITEMS`·`MAX_OPS_PER_MUTATION` 추가) `describe.skipIf(!url)('promotion', …)` 안 끝에 더한다.

```ts
import {
  createEmptyModel, diffModels, MAX_LIBRARY_FILE_ITEMS, MAX_OPS_PER_MUTATION,
  type ProjectModel, type ServerMessage,
} from '@erdd/core'
```

```ts
  it('승격 요청은 5,000건을 넘는 entityIds 를 입력 검증에서 막지 않는다 — 계획에 없는 id 는 빠진다', async () => {
    // 요청은 id 목록을 저장할 뿐이라 모델 op 상한과 무관하다. 5,001건을 실제로 심지 않고, 유효한 1건과
    // 계획에 없는 5,000건을 섞어 「zod 가 받았는가」만 본다 — 받았으면 계획에 없는 것만 dropped 로 빠진다.
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const entityIds = [wordId, ...Array.from({ length: MAX_OPS_PER_MUTATION }, () => uuidv7())]
    const res = await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.requested).toBe(1)
    expect(res.json().result.data.dropped).toHaveLength(MAX_OPS_PER_MUTATION)
  })

  it(`승격 요청은 ${MAX_LIBRARY_FILE_ITEMS}건을 넘으면 거절한다`, async () => {
    const entityIds = Array.from({ length: MAX_LIBRARY_FILE_ITEMS + 1 }, () => uuidv7())
    const res = await post(app, 'promotion.create', editorSession, { projectId, libraryId, entityIds })
    expect(res.statusCode).toBe(400)
  })

  it('승인도 5,000건을 넘는 approve 를 입력 검증에서 막지 않는다 — 요청에 없는 항목이라 핸들러가 거절한다', async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id as string
    const approve = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, () => ({
      entityId: uuidv7(), expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
    }))
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(400)
    // 입력 검증(zod)에서 막혔다면 이 문구가 아니다 — 핸들러까지 들어갔다는 증거다.
    expect(res.json().error.message).toBe('요청에 없는 항목은 승인할 수 없습니다')
  })

  it(`승인은 ${MAX_LIBRARY_FILE_ITEMS}건을 넘는 approve 를 입력 검증에서 거절한다`, async () => {
    const wordId = await seedWord(app, editorSession, projectId, '회원', 'MBR')
    const requestId = (await post(app, 'promotion.create', editorSession, {
      projectId, libraryId, entityIds: [wordId],
    })).json().result.data.id as string
    const approve = Array.from({ length: MAX_LIBRARY_FILE_ITEMS + 1 }, () => ({
      entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
    }))
    const res = await post(app, 'promotion.resolve', ownerSession, { requestId, approve })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).not.toBe('요청에 없는 항목은 승인할 수 없습니다')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/promotion.test.ts`
Expected: 첫째·셋째가 FAIL(지금 상한 5,000 이라 400/zod 메시지). 둘째·넷째는 지금도 PASS 다(상한이 더 낮으므로) — 그대로 둔다.

- [ ] **Step 3: 상한을 바꾼다** — `promotion.ts`

import 의 `MAX_OPS_PER_MUTATION` 을 `MAX_LIBRARY_FILE_ITEMS` 로 바꾼다(파일 안에 `MAX_OPS_PER_MUTATION` 의 다른 쓰임이 없다 — `grep -n MAX_OPS_PER_MUTATION apps/server/src/routers/promotion.ts` 로 확인). `create` 입력:

```ts
      // 요청은 엔티티 id 목록을 저장할 뿐이고 승인은 서버가 한 트랜잭션으로 반영하므로 모델 op 상한
      // (MAX_OPS_PER_MUTATION)과 무관하다. 나누지 않는다 — 요청을 쪼개면 승인자가 같은 요청을 여러 번
      // 검토한다. 상한은 라이브러리 파일 상한과 같은 공유 상수다(guides/shared-resources.md 「요청·승인 큐」).
      entityIds: z.array(z.string().uuid()).min(1).max(MAX_LIBRARY_FILE_ITEMS),
```

`resolve` 입력의 `approve` 배열 끝:

```ts
      })).max(MAX_LIBRARY_FILE_ITEMS),
```

- [ ] **Step 4: 통과를 확인한다**

Run: 위와 같은 명령 → PASS(개수·`skipped` 0 확인). `pnpm -C apps/server typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 5: 커밋**

```bash
git add apps/server/src/routers/promotion.ts apps/server/src/routers/promotion.test.ts && git commit -m "feat(server): 승격 요청·승인의 항목 상한을 라이브러리 파일 상한(50,000)으로 올린다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/server/src/routers/promotion.ts apps/server/src/routers/promotion.test.ts
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)** — `create` 의 상한을 `.max(5000)` 으로 되돌려 돌린다 → 첫째 테스트 FAIL 기대. `resolve` 를 `.max(5000)` 으로 → 셋째 FAIL 기대. 각각 `git checkout -- apps/server/src/routers/promotion.ts`, 끝에 `git status --short` clean.

---
### Task 6: web — 공용 부품(숫자 표시·클라이언트 페이지·Tabs·Pagination·디바운스)

**Files:**
- Modify: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/paginate.ts`, `apps/web/src/lib/paginate.test.ts`, `apps/web/src/lib/use-list-page.ts`, `apps/web/src/lib/use-list-page.test.ts`, `apps/web/src/lib/use-debounced-value.ts`, `apps/web/src/lib/use-debounced-value.test.ts`, `apps/web/src/components/ui/tabs.tsx`, `apps/web/src/components/ui/tabs.test.tsx`, `apps/web/src/components/ui/pagination.tsx`, `apps/web/src/components/ui/pagination.test.tsx`

**Interfaces:**
- Produces:
  - `formatCount(n: number): string` — `ko-KR` 천 단위(`16565 → "16,565"`).
  - `formatProgress(done: number, total: number): string` — `적용 중… ${formatCount(done)} / ${formatCount(total)}`.
  - `PAGE_SIZE = 50`
  - `type PageResult<T> = { rows: T[]; total: number; page: number; pageCount: number }`
  - `matchesQuery(values: readonly (string | null | undefined)[], query: string): boolean`
  - `filterAndPage<T>(rows: readonly T[], query: string, fields: (row: T) => readonly (string | null | undefined)[], page: number, size?: number): PageResult<T>` — `page` 는 1부터, 범위를 벗어나면 `[1, pageCount]` 로 당긴다. `pageCount` 는 최소 1.
  - `useListPage<T>(rows: readonly T[], fields: (row: T) => readonly (string | null | undefined)[], size?: number): { query: string; setQuery: (q: string) => void; setPage: (p: number) => void; view: PageResult<T> }` — `setQuery` 는 페이지를 1로 되돌린다. **`fields` 는 모듈 수준 상수 함수로 넘긴다**(매 렌더 새 함수면 메모가 무의미해진다).
  - `useDebouncedValue<T>(value: T, delayMs: number): T`
  - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`(radix-ui `Tabs` 래퍼, ARIA tablist)
  - `Pagination({ page, pageCount, total, onPageChange, label? })` — 「이전 · 3 / 263 · 다음」 + `전체 N건`, `pageCount <= 1` 이면 아무것도 그리지 않는다. 버튼 이름은 「이전」·「다음」.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/web/src/lib/format.test.ts
import { describe, expect, it } from 'vitest'
import { formatCount, formatProgress } from './format'

describe('formatCount', () => {
  it('천 단위 구분자를 붙인다', () => {
    expect(formatCount(16565)).toBe('16,565')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_000_000)).toBe('1,000,000')
  })
})

describe('formatProgress', () => {
  it('「적용 중… 완료 / 전체」를 천 단위로 쓴다', () => {
    expect(formatProgress(2, 4)).toBe('적용 중… 2 / 4')
    expect(formatProgress(1000, 1200)).toBe('적용 중… 1,000 / 1,200')
  })
})
```

```ts
// apps/web/src/lib/paginate.test.ts
import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, filterAndPage, matchesQuery } from './paginate'

type Row = { name: string; code: string | null }
const FIELDS = (r: Row) => [r.name, r.code]
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ name: `이름${String(i).padStart(3, '0')}`, code: `C${i}` }))

describe('matchesQuery', () => {
  it('빈 검색어(공백만 포함)는 모두 맞는다', () => {
    expect(matchesQuery(['a'], '')).toBe(true)
    expect(matchesQuery(['a'], '   ')).toBe(true)
  })
  it('대소문자 없이 어느 칸이든 부분 일치하면 맞고, null 칸은 건너뛴다', () => {
    expect(matchesQuery(['회원', 'MBR'], 'mb')).toBe(true)
    expect(matchesQuery([null, 'Member Info'], ' INFO ')).toBe(true)
    expect(matchesQuery([null, undefined], 'x')).toBe(false)
  })
  it('특수 문자는 글자 그대로 찾는다 — 정규식이 아니다', () => {
    const hit = (values: string[], q: string) => values.filter((v) => matchesQuery([v], q))
    const values = ['100%', '1000', 'a_b', 'axb', 'f(x)', 'fx', 'a.b', 'acb']
    expect(hit(values, '%')).toEqual(['100%'])
    expect(hit(values, '_')).toEqual(['a_b'])
    expect(hit(values, '(')).toEqual(['f(x)'])
    expect(hit(values, '.')).toEqual(['a.b'])
  })
})

describe('filterAndPage', () => {
  it('거르지 않으면 한 페이지 50건이고 pageCount 는 올림이다', () => {
    const r = filterAndPage(rows(120), '', FIELDS, 1)
    expect(PAGE_SIZE).toBe(50)
    expect(r.rows).toHaveLength(50)
    expect(r.rows[0]!.name).toBe('이름000')
    expect(r).toMatchObject({ total: 120, page: 1, pageCount: 3 })
    expect(filterAndPage(rows(120), '', FIELDS, 3).rows.map((x) => x.name)).toEqual(
      rows(120).slice(100).map((x) => x.name))
  })
  it('검색은 걸러진 행 기준으로 total·pageCount 를 낸다', () => {
    const r = filterAndPage(rows(120), 'c11', FIELDS, 1)
    expect(r.rows.map((x) => x.code)).toEqual(['C11', 'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116', 'C117', 'C118', 'C119'])
    expect(r).toMatchObject({ total: 11, page: 1, pageCount: 1 })
  })
  it('범위를 벗어난 페이지는 마지막 페이지로 당긴다 — 지워서 전체가 줄어든 경우', () => {
    expect(filterAndPage(rows(60), '', FIELDS, 3)).toMatchObject({ page: 2, pageCount: 2 })
    expect(filterAndPage(rows(60), '', FIELDS, 3).rows).toHaveLength(10)
    // 51번째를 지워 50건이 되면 2쪽에 있던 사람은 1쪽을 본다(빈 쪽에 갇히지 않는다).
    expect(filterAndPage(rows(50), '', FIELDS, 2)).toMatchObject({ page: 1, pageCount: 1, total: 50 })
  })
  it('빈 목록은 1/1 쪽이고 0보다 작은 페이지는 1쪽이다', () => {
    expect(filterAndPage([], '', FIELDS, 1)).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 })
    expect(filterAndPage(rows(3), '', FIELDS, 0).page).toBe(1)
  })
})
```

```ts
// apps/web/src/lib/use-list-page.test.ts
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useListPage } from './use-list-page'

type Row = { name: string }
const FIELDS = (r: Row) => [r.name]
const ROWS: Row[] = Array.from({ length: 120 }, (_, i) => ({ name: `n${i}` }))

describe('useListPage', () => {
  it('검색어를 바꾸면 1쪽으로 돌아간다', () => {
    const { result } = renderHook(() => useListPage(ROWS, FIELDS))
    act(() => result.current.setPage(3))
    expect(result.current.view.page).toBe(3)
    act(() => result.current.setQuery('n1'))
    expect(result.current.query).toBe('n1')
    expect(result.current.view.page).toBe(1)
    expect(result.current.view.total).toBe(31)   // n1, n10..n19, n100..n119
  })
})
```

```ts
// apps/web/src/lib/use-debounced-value.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './use-debounced-value'

afterEach(() => { vi.useRealTimers() })

describe('useDebouncedValue', () => {
  it('처음 값은 곧바로, 바뀐 값은 지연 뒤에 낸다 — 사이에 또 바뀌면 다시 센다', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: 'a' } })
    expect(result.current).toBe('a')
    rerender({ v: 'ab' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    rerender({ v: 'abc' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('abc')
  })
})
```

```tsx
// apps/web/src/components/ui/tabs.test.tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(cleanup)

describe('Tabs', () => {
  it('tablist·tab·tabpanel 역할을 갖추고 누르면 바뀐다', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="종류">
          <TabsTrigger value="a">가</TabsTrigger>
          <TabsTrigger value="b">나</TabsTrigger>
        </TabsList>
        <TabsContent value="a">내용 가</TabsContent>
        <TabsContent value="b">내용 나</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole('tablist', { name: '종류' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '가' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('내용 가')
    await userEvent.click(screen.getByRole('tab', { name: '나' }))
    expect(screen.getByRole('tab', { name: '나' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('내용 나')
  })
})
```

```tsx
// apps/web/src/components/ui/pagination.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from './pagination'

afterEach(cleanup)

describe('Pagination', () => {
  it('한 쪽뿐이면 아무것도 그리지 않는다', () => {
    const { container } = render(<Pagination page={1} pageCount={1} total={30} onPageChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('「이전 · 3 / 263 · 다음」과 전체 건수를 천 단위로 보인다', () => {
    render(<Pagination page={3} pageCount={263} total={13159} onPageChange={vi.fn()} />)
    expect(screen.getByText('3 / 263')).toBeInTheDocument()
    expect(screen.getByText('전체 13,159건')).toBeInTheDocument()
  })
  it('첫 쪽에서는 이전이, 끝 쪽에서는 다음이 잠기고 누르면 이웃 쪽을 알린다', async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination page={1} pageCount={3} total={120} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    rerender(<Pagination page={3} pageCount={3} total={120} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/lib/format.test.ts src/lib/paginate.test.ts src/lib/use-list-page.test.ts src/lib/use-debounced-value.test.ts src/components/ui/tabs.test.tsx src/components/ui/pagination.test.tsx`
Expected: FAIL — 모듈·export 없음.

- [ ] **Step 3: 구현한다**

`apps/web/src/lib/format.ts` 끝에 더한다:

```ts
const COUNT_FORMAT = new Intl.NumberFormat('ko-KR')

/**
 * 항목 수·건수 표시. 천 단위 구분자를 붙인다(16565 → "16,565"). 관리 화면 목록, 삭제 확인 문구, 공용 리소스
 * 라이브러리 목록, 탭 제목의 개수, 페이지 표시, 적용 진행 표시, 토스트 요약이 모두 이것을 쓴다.
 */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n)
}

/** 나눠 적용하는 동안의 버튼·토스트 문구. `done` 은 끝난 조각 수다. */
export function formatProgress(done: number, total: number): string {
  return `적용 중… ${formatCount(done)} / ${formatCount(total)}`
}
```

```ts
// apps/web/src/lib/paginate.ts
/** 목록 한 페이지의 행 수 — 관리 화면 조회 모달과 에디터 패널이 함께 쓴다. */
export const PAGE_SIZE = 50

export type PageResult<T> = { rows: T[]; total: number; page: number; pageCount: number }

/**
 * 검색어가 값 가운데 하나에 부분 일치하는가. 앞뒤 공백을 걷고 대소문자를 무시한다.
 * **정규식이 아니다** — `%`·`_`·`(`·`.` 도 글자 그대로 찾는다(서버 `items.page` 의 이스케이프와 같은 뜻).
 */
export function matchesQuery(values: readonly (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return values.some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/**
 * 메모리에 있는 행을 거르고 한 페이지를 자른다(에디터 패널 공용). `page` 는 1부터이고, 지워서 전체가 줄어
 * 범위를 벗어나면 마지막 페이지로 당긴다 — 빈 페이지에 갇히지 않게 한다.
 */
export function filterAndPage<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => readonly (string | null | undefined)[],
  page: number,
  size: number = PAGE_SIZE,
): PageResult<T> {
  const filtered = query.trim() === '' ? rows : rows.filter((row) => matchesQuery(fields(row), query))
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (current - 1) * size
  return { rows: filtered.slice(start, start + size), total, page: current, pageCount }
}
```

```ts
// apps/web/src/lib/use-list-page.ts
import { useCallback, useMemo, useState } from 'react'
import { PAGE_SIZE, filterAndPage } from './paginate'

/**
 * 검색어·페이지 상태 + 그 결과 한 페이지. 검색어를 바꾸면 1쪽으로 돌아간다.
 * `fields` 는 모듈 수준 상수 함수로 넘긴다 — 매 렌더 새 함수면 메모가 매번 깨진다.
 */
export function useListPage<T>(
  rows: readonly T[],
  fields: (row: T) => readonly (string | null | undefined)[],
  size: number = PAGE_SIZE,
) {
  const [query, setQueryState] = useState('')
  const [page, setPage] = useState(1)
  const view = useMemo(() => filterAndPage(rows, query, fields, page, size), [rows, query, fields, page, size])
  const setQuery = useCallback((q: string) => { setQueryState(q); setPage(1) }, [])
  return { query, setQuery, setPage, view }
}
```

```ts
// apps/web/src/lib/use-debounced-value.ts
import { useEffect, useState } from 'react'

/** 값이 `delayMs` 동안 바뀌지 않으면 그 값을 낸다. 처음 값은 곧바로 낸다(마운트 때 한 박자 늦지 않게). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
```

```tsx
// apps/web/src/components/ui/tabs.tsx
"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

```tsx
// apps/web/src/components/ui/pagination.tsx
import { Button } from '@/components/ui/button'
import { formatCount } from '@/lib/format'

/** 「이전 · 3 / 263 · 다음」과 전체 건수. 한 쪽뿐이면 아무것도 그리지 않는다. */
export function Pagination({ page, pageCount, total, onPageChange, label = '목록' }: {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  /** 한 화면에 여러 개가 있을 때 탐색 영역 이름을 가른다(`${label} 페이지`). */
  label?: string
}) {
  if (pageCount <= 1) return null
  return (
    <nav aria-label={`${label} 페이지`} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>전체 {formatCount(total)}건</span>
      <span className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}>이전</Button>
        <span>{formatCount(page)} / {formatCount(pageCount)}</span>
        <Button type="button" size="sm" variant="outline" disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}>다음</Button>
      </span>
    </nav>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: Step 2 와 같은 명령 → PASS(개수 확인). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts apps/web/src/lib/paginate.ts apps/web/src/lib/paginate.test.ts apps/web/src/lib/use-list-page.ts apps/web/src/lib/use-list-page.test.ts apps/web/src/lib/use-debounced-value.ts apps/web/src/lib/use-debounced-value.test.ts apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/tabs.test.tsx apps/web/src/components/ui/pagination.tsx apps/web/src/components/ui/pagination.test.tsx && git commit -m "feat(web): 숫자 표시·클라이언트 페이지·Tabs·Pagination·디바운스 공용 부품을 더한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts apps/web/src/lib/paginate.ts apps/web/src/lib/paginate.test.ts apps/web/src/lib/use-list-page.ts apps/web/src/lib/use-list-page.test.ts apps/web/src/lib/use-debounced-value.ts apps/web/src/lib/use-debounced-value.test.ts apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/tabs.test.tsx apps/web/src/components/ui/pagination.tsx apps/web/src/components/ui/pagination.test.tsx
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 `git checkout -- <file>`:
  1. `matchesQuery` 의 `v.toLowerCase().includes(q)` 를 `new RegExp(q, 'i').test(v)` 로 → 「특수 문자는 글자 그대로 찾는다」 FAIL 기대.
  2. `filterAndPage` 의 `Math.min(…, pageCount)` 를 빼(`Math.max(1, Math.floor(page))`) → 「범위를 벗어난 페이지는…」 FAIL 기대.
  3. `useListPage` 의 `setQuery` 에서 `setPage(1)` 을 뺀다 → `use-list-page.test.ts` FAIL 기대.
  끝에 `git status --short` clean.

---

### Task 7: web — 라이브러리 조회 모달·관리 화면·가져오기 다이얼로그

**Files:**
- Create: `apps/web/src/lib/library-domains.ts`, `apps/web/src/lib/library-domains.test.ts`, `apps/web/src/components/library-view-dialog.tsx`, `apps/web/src/components/library-view-dialog.test.tsx`
- Modify: `apps/web/src/components/resource-library-manager.tsx`(전체 교체), `apps/web/src/components/resource-library-manager.test.tsx`(전체 교체), `apps/web/src/components/library-import-dialog.tsx`, `apps/web/src/components/library-import-dialog.test.tsx`(스텁 한 줄), `apps/web/src/components/promotion-requests-section.tsx`(승인 뒤 무효화)

**Interfaces:**
- Consumes: `resource.items.page`(Task 3), `countsByKind`(Task 4), `resourceSecondaryName`(Task 2), `formatCount`·`PAGE_SIZE`·`useDebouncedValue`·`Tabs*`·`Pagination`(Task 6), `ResourceItemForm`·`DomainOption`(기존 `components/resource-item-form.tsx`).
- Produces:
  - `DOMAIN_PAGE_LIMIT = 200`, `libraryDomainsQueryKey(libraryId: string): readonly ['library-domain-options', string]`, `fetchAllDomainOptions(fetchPage: (offset: number) => Promise<{ items: { id: string; payload: Record<string, unknown> }[]; total: number }>): Promise<DomainOption[]>`, `useLibraryDomains(libraryId: string | null, enabled: boolean)`(useQuery 결과).
  - `LibraryViewDialog({ library, canManage, onClose, onChanged })`, `type ItemRow = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }`, `type ViewedLibrary = { id: string; name: string; countsByKind: Record<ResourceKind, number> }`, `VIEW_KINDS = ['word', 'term', 'domain', 'customField']`.

**「가져오기 다이얼로그의 전체 항목 조회」 확인 결과(설계 3절의 지시):** `LibraryImportDialog` 의 `items.list` 조회는 **Excel 파일을 라이브러리 문서로 바꿀 때 대상 라이브러리의 도메인 이름 목록(`targetDomainNames`)** 에만 쓰인다. `dryRun` 응답이나 `countsByKind` 로는 이름을 대신할 수 없으므로, 관리 모달이 쓰는 도메인 전체 받기(`useLibraryDomains`)로 바꾼다 — 받는 양이 전체 항목에서 도메인(수백 건)으로 준다. 이 판단을 태스크 보고에 적는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/web/src/lib/library-domains.test.ts
import { describe, expect, it, vi } from 'vitest'
import { DOMAIN_PAGE_LIMIT, fetchAllDomainOptions } from './library-domains'

const domainItem = (i: number) => ({ id: `d${i}`, payload: { name: `도메인${i}` } })

describe('fetchAllDomainOptions', () => {
  it('total 에 닿을 때까지 200건씩 넘겨 받고 이름을 푼다', async () => {
    const all = Array.from({ length: 450 }, (_, i) => domainItem(i))
    const fetchPage = vi.fn(async (offset: number) => ({ items: all.slice(offset, offset + DOMAIN_PAGE_LIMIT), total: all.length }))
    const out = await fetchAllDomainOptions(fetchPage)
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 200, 400])
    expect(out).toHaveLength(450)
    expect(out[449]).toEqual({ id: 'd449', name: '도메인449' })
  })

  it('그 사이 지워져 페이지가 짧게 오면 거기서 멈춘다', async () => {
    const fetchPage = vi.fn(async (offset: number) => (offset === 0
      ? { items: Array.from({ length: 200 }, (_, i) => domainItem(i)), total: 400 }
      : { items: [domainItem(200)], total: 201 }))
    const out = await fetchAllDomainOptions(fetchPage)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(201)
  })
})
```

```tsx
// apps/web/src/components/library-view-dialog.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LibraryViewDialog, type ItemRow, type ViewedLibrary } from './library-view-dialog'

type PageInput = { libraryId: string; kind: string; query?: string; offset: number; limit: number }

/** 서버 items.page 흉내 — 종류로 거르고 payload 문자열 칸에서 찾는다. rows 는 부를 때마다 다시 읽는다(삭제 반영). */
function pageHandler(rows: () => ItemRow[]) {
  return vi.fn((input: unknown) => {
    const { kind, query, offset, limit } = input as PageInput
    const q = (query ?? '').trim().toLowerCase()
    const hit = rows().filter((r) => r.kind === kind
      && (q === '' || Object.values(r.payload).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))))
    return { data: { items: hit.slice(offset, offset + limit), total: hit.length } }
  })
}

const pad = (i: number) => String(i).padStart(3, '0')
const word = (i: number): ItemRow => ({
  id: `w${i}`, kind: 'word', version: 1,
  payload: { logicalName: `w${pad(i)}`, abbreviation: `A${pad(i)}`, englishName: null, description: null },
})
const words = (n: number) => Array.from({ length: n }, (_, i) => word(i))

const LIB: ViewedLibrary = {
  id: 'l1', name: '표준 사전', countsByKind: { word: 3280, term: 13159, domain: 126, customField: 0 },
}

function renderDialog(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  props: { canManage?: boolean } = {},
) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const onChanged = vi.fn(async () => undefined)
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <LibraryViewDialog library={LIB} canManage={props.canManage ?? true} onClose={() => {}} onChanged={onChanged} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return { queryClient, onChanged }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('LibraryViewDialog', () => {
  it('제목과 종류별 탭에 개수를 천 단위로 보이고 처음에는 단어 탭이다 — 행에 물리명 칸이 있다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    expect(screen.getByRole('dialog', { name: '라이브러리 조회 — 표준 사전' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '단어 (3,280)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '용어 (13,159)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '도메인 (126)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '커스텀 항목 (0)' })).toBeInTheDocument()
    expect(await screen.findByText('w000')).toBeInTheDocument()
    expect(screen.getByText('A000')).toBeInTheDocument()
  })

  it('다음 쪽은 offset 을 바꿔 부르고, 검색어를 바꾸면 1쪽부터 다시 부른다', async () => {
    const page = pageHandler(() => words(120))
    renderDialog({ 'resource.items.page': page })
    await screen.findByText('w000')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('w050')).toBeInTheDocument()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ kind: 'word', offset: 50, limit: 50 }))
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w11')
    await waitFor(() => expect(page).toHaveBeenCalledWith(expect.objectContaining({ query: 'w11', offset: 0 })))
    expect(await screen.findByText('w110')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()   // 10건 — 한 쪽이라 페이지 이동이 숨는다
  })

  it('탭을 옮겼다 돌아와도 그 탭의 검색어가 남는다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    await screen.findByText('w000')
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w00')
    await userEvent.click(screen.getByRole('tab', { name: '용어 (13,159)' }))
    expect(screen.getByRole('textbox', { name: '용어 검색' })).toHaveValue('')
    await userEvent.click(screen.getByRole('tab', { name: '단어 (3,280)' }))
    expect(screen.getByRole('textbox', { name: '단어 검색' })).toHaveValue('w00')
  })

  it('결과가 없으면 검색 중과 빈 탭을 구별해 알린다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    await screen.findByText('w000')
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'zzz')
    expect(await screen.findByText('검색 결과가 없습니다')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '커스텀 항목 (0)' }))
    expect(await screen.findByText('항목이 없습니다')).toBeInTheDocument()
  })

  it('관리 권한이 없으면 추가·편집·삭제 버튼이 없다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) }, { canManage: false })
    await screen.findByText('w000')
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'w000 편집' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'w000 삭제' })).toBeNull()
  })

  it('마지막 쪽의 마지막 항목을 지우면 남은 마지막 쪽으로 물러난다', async () => {
    let rows = words(51)
    const remove = vi.fn((input: unknown) => {
      rows = rows.filter((r) => r.id !== (input as { itemId: string }).itemId)
      return { data: { ok: true } }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onChanged } = renderDialog({ 'resource.items.page': pageHandler(() => rows), 'resource.items.remove': remove })
    await screen.findByText('w000')
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    await userEvent.click(await screen.findByRole('button', { name: 'w050 삭제' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ itemId: 'w50' }))
    expect(await screen.findByText('w000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
    expect(onChanged).toHaveBeenCalled()
  })

  it('용어 탭은 물리명과 도메인 이름을 보인다 — 도메인은 200건씩 끝까지 받아 id 를 푼다', async () => {
    const rows: ItemRow[] = [
      { id: 'd1', kind: 'domain', version: 1, payload: { name: '금액', category: null, logicalType: 'DECIMAL(15)' } },
      { id: 't1', kind: 'term', version: 2, payload: { logicalName: '판매금액', physicalName: 'SALE_AMT', domainId: 'd1', description: null } },
    ]
    const page = pageHandler(() => rows)
    renderDialog({ 'resource.items.page': page })
    await userEvent.click(screen.getByRole('tab', { name: '용어 (13,159)' }))
    expect(await screen.findByText('SALE_AMT')).toBeInTheDocument()
    expect(await screen.findByText('금액')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ kind: 'domain', offset: 0, limit: 200 }))
  })

  it('항목을 추가하면 그 라이브러리·종류로 만들고 항목 페이지와 목록 개수를 무효화한다', async () => {
    const create = vi.fn(() => ({ data: { id: 'w9' } }))
    const { queryClient, onChanged } = renderDialog({
      'resource.items.page': pageHandler(() => words(1)), 'resource.items.create': create,
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByText('w000')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await userEvent.type(screen.getByLabelText(/논리명/), '주문')
    await userEvent.type(screen.getByLabelText(/물리 약어/), 'ORD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      libraryId: 'l1', kind: 'word', payload: expect.objectContaining({ logicalName: '주문', abbreviation: 'ORD' }),
    }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown } | undefined)?.queryKey))
    expect(keys).toContain(JSON.stringify([['resource', 'items', 'page'], { input: { libraryId: 'l1' }, type: 'query' }]))
  })
})
```

`apps/web/src/components/resource-library-manager.test.tsx` 를 통째로 바꾼다:

```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { ResourceLibraryManager } from './resource-library-manager.js'

const COUNTS = { word: 3280, term: 13159, domain: 126, customField: 0 }
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전(예시)', description: '예시', itemCount: 16565, countsByKind: COUNTS },
]
const EMPTY_PAGE = () => ({ data: { items: [], total: 0 } })

function renderManager(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  props: { canManage?: boolean } = {},
) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ResourceLibraryManager scope="global" canManage={props.canManage ?? true} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ResourceLibraryManager', () => {
  it('목록 행에 설명과 항목 수를 천 단위로 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    expect(await screen.findByText('예시 · 항목 16,565개')).toBeInTheDocument()
  })

  it('행을 누르면 조회 모달이 열리고 items.list 는 부르지 않는다', async () => {
    const list = vi.fn(() => ({ data: [] }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': list,
      'resource.items.page': EMPTY_PAGE,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 16,565개/ }))
    expect(await screen.findByRole('dialog', { name: '라이브러리 조회 — 표준 사전(예시)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '단어 (3,280)' })).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('라이브러리를 만든다', async () => {
    const create = vi.fn(() => ({ data: { id: 'l2' } }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.library.create': create,
    })
    await screen.findByText('표준 사전(예시)')
    await userEvent.click(screen.getByRole('button', { name: '라이브러리 만들기' }))
    await userEvent.type(screen.getByLabelText('이름'), '새 사전')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global', name: '새 사전' })))
  })

  it('canManage=false면 편집 컨트롤이 없다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    await screen.findByText('표준 사전(예시)')
    expect(screen.queryByRole('button', { name: '라이브러리 만들기' })).toBeNull()
  })

  it('라이브러리 삭제 확인 문구의 항목 수도 천 단위다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    await userEvent.click(await screen.findByRole('button', { name: '표준 사전(예시) 삭제' }))
    expect(confirm).toHaveBeenCalledWith('"표준 사전(예시)"을(를) 삭제하면 항목 16,565개도 함께 삭제됩니다. 계속할까요?')
  })

  it('쓰기 권한이 없어도 내보내기 버튼이 보이고, 가져오기·파일에서 만들기는 관리자에게만 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    expect(await screen.findByRole('button', { name: '표준 사전(예시) 내보내기' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '표준 사전(예시) 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /파일에서 만들기/ })).toBeNull()
  })

  it('가져오기 완료는 가져온 라이브러리의 항목 페이지 쿼리만 무효화한다', async () => {
    const LIBS2 = [
      { id: 'a1', scope: 'global', orgId: null, name: '대상 A', description: '', itemCount: 1, countsByKind: { ...COUNTS, word: 1 } },
      { id: 'b1', scope: 'global', orgId: null, name: '다른 B', description: '', itemCount: 1, countsByKind: { ...COUNTS, word: 1 } },
    ]
    const importFn = vi.fn((input: unknown) => ({
      data: {
        libraryId: 'a1',
        applied: !(input as { dryRun: boolean }).dryRun,
        stateHash: 'h',
        summary: { counts: { add: 1, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0 }, warnings: [], entries: [] },
      },
    }))
    const queryClient = renderManager({
      'resource.library.list': () => ({ data: LIBS2 }),
      'resource.items.page': EMPTY_PAGE,
      'resource.library.import': importFn,
    })
    await screen.findByText('대상 A')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: '대상 A 가져오기' }))
    const file = new File(
      ['format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\n'], 'std.erdd-lib.yaml',
    )
    await userEvent.upload(await screen.findByLabelText('파일 선택'), file)
    await userEvent.click(await screen.findByRole('button', { name: '가져오기 실행' }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedPage = (libraryId: string) => invalidateSpy.mock.calls.some(([opts]) =>
      JSON.stringify((opts as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify([['resource', 'items', 'page'], { input: { libraryId }, type: 'query' }]))
    expect(invalidatedPage('a1')).toBe(true)
    expect(invalidatedPage('b1')).toBe(false)
  })
})
```

`apps/web/src/components/library-import-dialog.test.tsx` 의 스텁 한 줄(현재 `mockTrpcFetch({ 'resource.items.list': () => ({ data: [] }), ...handlers })`)을 이렇게 바꾼다:

```ts
  mockTrpcFetch({ 'resource.items.page': () => ({ data: { items: [], total: 0 } }), ...handlers })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/lib/library-domains.test.ts src/components/library-view-dialog.test.tsx src/components/resource-library-manager.test.tsx src/components/library-import-dialog.test.tsx`
Expected: 새 파일 둘은 모듈 없음으로 FAIL, 관리 화면 테스트는 「예시 · 항목 16,565개」·모달 테스트가 FAIL.

- [ ] **Step 3: `library-domains.ts` 를 쓴다**

```ts
// apps/web/src/lib/library-domains.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { resourceDisplayName } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import type { DomainOption } from '@/components/resource-item-form'

/** 도메인 전체를 받을 때의 페이지 크기 — `items.page` 의 limit 상한이다. */
export const DOMAIN_PAGE_LIMIT = 200

/** 라이브러리 도메인 전체 목록의 캐시 키. 항목을 추가·수정·삭제·가져오기한 뒤 `items.page` 와 함께 무효화한다. */
export function libraryDomainsQueryKey(libraryId: string) {
  return ['library-domain-options', libraryId] as const
}

/**
 * `items.page({ kind: 'domain' })` 를 페이지 끝까지 넘기며 도메인 전부를 모은다(도메인은 수백 건 수준).
 * 그 사이 지워져 짧은 페이지가 오면 거기서 멈춘다.
 */
export async function fetchAllDomainOptions(
  fetchPage: (offset: number) => Promise<{ items: { id: string; payload: Record<string, unknown> }[]; total: number }>,
): Promise<DomainOption[]> {
  const out: DomainOption[] = []
  for (let offset = 0; ; offset += DOMAIN_PAGE_LIMIT) {
    const page = await fetchPage(offset)
    for (const item of page.items) out.push({ id: item.id, name: resourceDisplayName('domain', item.payload) })
    if (page.items.length < DOMAIN_PAGE_LIMIT || offset + DOMAIN_PAGE_LIMIT >= page.total) return out
  }
}

/**
 * 라이브러리 도메인 전체 — 용어 폼의 도메인 선택지, 용어 표의 도메인 칸, Excel 가져오기의 도메인 이름 해석이 쓴다.
 * 항목 전체(`items.list`)를 받지 않는다.
 */
export function useLibraryDomains(libraryId: string | null, enabled: boolean) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: libraryDomainsQueryKey(libraryId ?? ''),
    queryFn: () => fetchAllDomainOptions((offset) => queryClient.fetchQuery(
      trpc.resource.items.page.queryOptions({
        libraryId: libraryId!, kind: 'domain', offset, limit: DOMAIN_PAGE_LIMIT,
      }),
    )),
    enabled: enabled && libraryId !== null,
  })
}
```

- [ ] **Step 4: `library-view-dialog.tsx` 를 쓴다**

```tsx
// apps/web/src/components/library-view-dialog.tsx
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  RESOURCE_KIND_LABEL, resourceDisplayName, resourceSecondaryName, type ResourceKind,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/paginate'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { libraryDomainsQueryKey, useLibraryDomains } from '@/lib/library-domains'
import { ResourceItemForm } from '@/components/resource-item-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type ItemRow = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }
export type ViewedLibrary = { id: string; name: string; countsByKind: Record<ResourceKind, number> }

/** 조회 모달의 탭 순서 — 처음 열면 단어다(RESOURCE_KINDS 의 도메인 우선 순서와 다르다). */
export const VIEW_KINDS = ['word', 'term', 'domain', 'customField'] as const satisfies readonly ResourceKind[]

const SEARCH_DEBOUNCE_MS = 300
type TabState = { query: string; page: number }
const INITIAL_TABS: Record<ResourceKind, TabState> = {
  word: { query: '', page: 1 }, term: { query: '', page: 1 },
  domain: { query: '', page: 1 }, customField: { query: '', page: 1 },
}
const TARGET_LABEL: Record<string, string> = { table: '테이블', column: '컬럼' }
const TYPE_LABEL: Record<string, string> = { text: '텍스트', boolean: '불리언', select: '선택형' }

const text = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/** 종류별 표 열(설계 1절의 표). 첫 칸은 논리명 칸, 둘째 칸은 단어·용어의 물리명 칸이다. */
function columnsOf(kind: ResourceKind): readonly string[] {
  switch (kind) {
    case 'word': return ['논리명', '물리명', '영문명']
    case 'term': return ['논리명', '물리명', '도메인']
    case 'domain': return ['이름', '분류', '논리 타입']
    case 'customField': return ['이름', '대상', '타입']
  }
}

function cellsOf(
  kind: ResourceKind, payload: Record<string, unknown>, domainName: (id: string | null) => string,
): string[] {
  const name = resourceDisplayName(kind, payload)
  switch (kind) {
    case 'word': return [name, resourceSecondaryName(kind, payload) ?? '', text(payload, 'englishName')]
    case 'term': return [
      name, resourceSecondaryName(kind, payload) ?? '',
      domainName(typeof payload.domainId === 'string' ? payload.domainId : null),
    ]
    case 'domain': return [name, text(payload, 'category'), text(payload, 'logicalType')]
    case 'customField': return [
      name, TARGET_LABEL[text(payload, 'target')] ?? '', TYPE_LABEL[text(payload, 'type')] ?? '',
    ]
  }
}

/**
 * 「라이브러리 조회 — 〈이름〉」 모달. 종류별 탭마다 검색·표·페이지이고 데이터는 `items.page` 로만 받는다
 * (`items.list` 는 이 화면에서 부르지 않는다 — 16,565건을 한 번에 받지 않기 위해서다).
 * 탭별 검색어·페이지는 여기(부모)가 들고 있어 탭을 옮겨도 남는다.
 */
export function LibraryViewDialog({ library, canManage, onClose, onChanged }: {
  library: ViewedLibrary
  canManage: boolean
  onClose: () => void
  /** 항목을 추가·수정·삭제한 뒤 — 호출부가 library.list(개수)를 무효화한다. */
  onChanged: () => Promise<unknown>
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ResourceKind>('word')
  const [tabs, setTabs] = useState(INITIAL_TABS)
  const [editing, setEditing] = useState<{ kind: ResourceKind; item: ItemRow | null } | null>(null)
  const domains = useLibraryDomains(library.id, kind === 'term' || editing?.kind === 'term')
  const domainNames = useMemo(() => new Map((domains.data ?? []).map((d) => [d.id, d.name])), [domains.data])
  const domainName = (id: string | null) => (id === null ? '' : domainNames.get(id) ?? '')

  const patchTab = (k: ResourceKind, patch: Partial<TabState>) =>
    setTabs((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }))

  // 추가·편집·삭제 뒤에는 항목 페이지·도메인 목록·라이브러리 목록(개수)을 함께 무효화한다 — 규칙은 하나다.
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.resource.items.page.queryKey({ libraryId: library.id }) }),
    queryClient.invalidateQueries({ queryKey: libraryDomainsQueryKey(library.id) }),
    onChanged(),
  ])
  const onError = (err: { message: string }) => toast.error(err.message)
  const createItem = useMutation(trpc.resource.items.create.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidate() }, onError,
  }))
  const updateItem = useMutation(trpc.resource.items.update.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidate() }, onError,
  }))
  const removeItem = useMutation(trpc.resource.items.remove.mutationOptions({
    onSuccess: async () => { await invalidate() }, onError,
  }))

  const onRemove = (item: ItemRow) => {
    const name = resourceDisplayName(item.kind, item.payload)
    if (!window.confirm(`"${name}"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.`)) return
    removeItem.mutate({ itemId: item.id })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>라이브러리 조회 — {library.name}</DialogTitle></DialogHeader>
        <Tabs value={kind} onValueChange={(v) => setKind(v as ResourceKind)}>
          <TabsList aria-label="항목 종류">
            {VIEW_KINDS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {RESOURCE_KIND_LABEL[k]} ({formatCount(library.countsByKind[k])})
              </TabsTrigger>
            ))}
          </TabsList>
          {VIEW_KINDS.map((k) => (
            <TabsContent key={k} value={k}>
              <KindTab
                libraryId={library.id} kind={k} state={tabs[k]} canManage={canManage}
                domainName={domainName}
                onQueryChange={(query) => patchTab(k, { query, page: 1 })}
                onPageChange={(page) => patchTab(k, { page })}
                onAdd={() => setEditing({ kind: k, item: null })}
                onEdit={(item) => setEditing({ kind: k, item })}
                onRemove={onRemove}
              />
            </TabsContent>
          ))}
        </Tabs>

        {editing && (
          <Dialog open onOpenChange={(open) => { if (!open) setEditing(null) }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {RESOURCE_KIND_LABEL[editing.kind]} {editing.item ? '수정' : '추가'}
                </DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto">
                <ResourceItemForm
                  key={editing.item?.id ?? `new-${editing.kind}`}
                  kind={editing.kind}
                  payload={editing.item?.payload ?? null}
                  domainOptions={domains.data ?? []}
                  onCancel={() => setEditing(null)}
                  onSubmit={(payload) => {
                    if (editing.item) updateItem.mutate({ itemId: editing.item.id, payload })
                    else createItem.mutate({ libraryId: library.id, kind: editing.kind, payload })
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 탭 하나 — 검색창(300ms 디바운스)·표·페이지. 탭을 바꾸면 다시 마운트되지만 상태는 부모가 들고 있다. */
function KindTab({
  libraryId, kind, state, canManage, domainName, onQueryChange, onPageChange, onAdd, onEdit, onRemove,
}: {
  libraryId: string
  kind: ResourceKind
  state: TabState
  canManage: boolean
  domainName: (id: string | null) => string
  onQueryChange: (query: string) => void
  onPageChange: (page: number) => void
  onAdd: () => void
  onEdit: (item: ItemRow) => void
  onRemove: (item: ItemRow) => void
}) {
  const trpc = useTRPC()
  const query = useDebouncedValue(state.query, SEARCH_DEBOUNCE_MS).trim()
  const result = useQuery({
    ...trpc.resource.items.page.queryOptions({
      libraryId, kind, ...(query === '' ? {} : { query }),
      offset: (state.page - 1) * PAGE_SIZE, limit: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })
  const total = result.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 마지막 쪽의 마지막 항목을 지우면 그 쪽이 빈다 — 남은 마지막 쪽으로 물러난다(빈 쪽에 갇히지 않게).
  useEffect(() => {
    if (result.data && result.data.items.length === 0 && result.data.total > 0 && state.page > pageCount) {
      onPageChange(pageCount)
    }
  }, [result.data, state.page, pageCount, onPageChange])

  const columns = columnsOf(kind)
  const label = RESOURCE_KIND_LABEL[kind]
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input aria-label={`${label} 검색`} placeholder="논리명·물리명 검색" value={state.query}
          onChange={(e) => onQueryChange(e.target.value)} />
        {canManage && (
          <Button type="button" size="sm" variant="outline" onClick={onAdd}><Plus /> 추가</Button>
        )}
      </div>
      {result.isError && <p role="alert" className="text-destructive">{result.error.message}</p>}
      {result.data && result.data.total === 0 && (
        <p className="text-sm text-muted-foreground">
          {query !== '' ? '검색 결과가 없습니다' : '항목이 없습니다'}
        </p>
      )}
      {result.data && result.data.items.length > 0 && (
        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                <TableHead>버전</TableHead>
                {canManage && <TableHead><span className="sr-only">작업</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((raw) => {
                const item = raw as ItemRow
                const cells = cellsOf(kind, item.payload, domainName)
                const name = cells[0]!
                return (
                  <TableRow key={item.id}>
                    {cells.map((cell, i) => (
                      <TableCell key={columns[i]}
                        className={i === 1 && (kind === 'word' || kind === 'term') ? 'font-mono text-xs' : undefined}>
                        {cell}
                      </TableCell>
                    ))}
                    <TableCell className="text-xs text-muted-foreground">v{item.version}</TableCell>
                    {canManage && (
                      <TableCell>
                        <span className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-6" aria-label={`${name} 편집`}
                            onClick={() => onEdit(item)}>
                            <Pencil className="size-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-6 text-destructive"
                            aria-label={`${name} 삭제`} onClick={() => onRemove(item)}>
                            <Trash2 className="size-3" />
                          </Button>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination label={label} page={Math.min(state.page, pageCount)} pageCount={pageCount} total={total}
        onPageChange={onPageChange} />
    </div>
  )
}
```

- [ ] **Step 5: 관리 화면을 바꾼다** — `apps/web/src/components/resource-library-manager.tsx` 를 통째로 바꾼다.

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { LIBRARY_FILE_EXTENSION } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { libraryDomainsQueryKey } from '@/lib/library-domains'
import { LibraryImportDialog, type LibraryImportTarget } from '@/components/library-import-dialog'
import { LibraryViewDialog } from '@/components/library-view-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 전역(/admin)·조직(/org/:orgId) 공용 리소스 라이브러리 관리 화면.
 * 데이터 모델과 로직은 두 스코프가 완전히 같고 권한 판정만 서버에서 갈린다.
 * 라이브러리 행을 누르면 조회 모달(`LibraryViewDialog`)이 열린다 — 항목은 그 모달이 페이지 단위로 받는다.
 */
export function ResourceLibraryManager({
  scope, orgId, canManage,
}: { scope: 'global' | 'org'; orgId?: string; canManage: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listInput = scope === 'global' ? { scope } : { scope, orgId: orgId! }
  const libraries = useQuery(trpc.resource.library.list.queryOptions(listInput))
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [importTarget, setImportTarget] = useState<LibraryImportTarget | null>(null)

  const invalidateLibraries = () =>
    queryClient.invalidateQueries({ queryKey: trpc.resource.library.list.queryKey(listInput) })
  const invalidateItems = (libraryId: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.resource.items.page.queryKey({ libraryId }) }),
    queryClient.invalidateQueries({ queryKey: libraryDomainsQueryKey(libraryId) }),
  ])
  const onError = (err: { message: string }) => toast.error(err.message)

  /** 배포 파일을 내려받는다 — 읽을 수 있으면 누구나(배포 목적). */
  const onExport = async (lib: { id: string; name: string }) => {
    try {
      const res = await queryClient.fetchQuery(trpc.resource.library.export.queryOptions({ libraryId: lib.id }))
      const url = URL.createObjectURL(new Blob([res.text], { type: 'application/yaml' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${lib.name.replace(/[\\/:*?"<>|]/g, '_')}${LIBRARY_FILE_EXTENSION}`
      a.click()
      URL.revokeObjectURL(url)
      if (res.danglingDomainRefs > 0) {
        toast.info(`삭제된 도메인을 가리키던 용어 ${formatCount(res.danglingDomainRefs)}건은 도메인 없이 내보냈습니다`)
      }
    } catch (err) { onError(err as { message: string }) }
  }

  const createLibrary = useMutation(trpc.resource.library.create.mutationOptions({
    onSuccess: async () => {
      toast.success('라이브러리를 만들었습니다')
      setCreateOpen(false); setNewName(''); setNewDescription('')
      await invalidateLibraries()
    },
    onError,
  }))
  const removeLibrary = useMutation(trpc.resource.library.remove.mutationOptions({
    onSuccess: async (_data, variables) => {
      if (viewingId === variables.libraryId) setViewingId(null)
      await invalidateLibraries()
    },
    onError,
  }))

  const viewing = libraries.data?.find((lib) => lib.id === viewingId) ?? null

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {scope === 'global' ? '전역 공용 리소스' : '조직 공용 리소스'}
        </h2>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> 라이브러리 만들기
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportTarget(scope === 'global' ? { kind: 'create', scope } : { kind: 'create', scope, orgId: orgId! })}>
              <FileUp /> 파일에서 만들기
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        프로젝트에서 "공용 리소스" 화면으로 가져가 쓰는 표준 단어·용어·도메인·커스텀 항목입니다.
      </p>

      {libraries.isError && <p role="alert" className="text-destructive">{libraries.error.message}</p>}
      {libraries.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">아직 라이브러리가 없습니다</p>
      )}

      <ul className="grid gap-2">
        {libraries.data?.map((lib) => (
          <li key={lib.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
            <button type="button" className="grid flex-1 gap-0.5 text-left" onClick={() => setViewingId(lib.id)}>
              <span className="font-medium">{lib.name}</span>
              <span className="text-xs text-muted-foreground">
                {lib.description || '설명 없음'} · 항목 {formatCount(lib.itemCount)}개
              </span>
            </button>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 내보내기`} onClick={() => void onExport(lib)}>
              <Download className="size-4" />
            </Button>
            {canManage && (
              <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 가져오기`}
                onClick={() => setImportTarget({ kind: 'existing', libraryId: lib.id, name: lib.name })}>
                <Upload className="size-4" />
              </Button>
            )}
            {canManage && (
              <Button size="icon" variant="ghost" className="size-7 text-destructive"
                aria-label={`${lib.name} 삭제`}
                onClick={() => {
                  if (!window.confirm(`"${lib.name}"을(를) 삭제하면 항목 ${formatCount(lib.itemCount)}개도 함께 삭제됩니다. 계속할까요?`)) return
                  removeLibrary.mutate({ libraryId: lib.id })
                }}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>라이브러리 만들기</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rl-name">이름</Label>
              <Input id="rl-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rl-desc">설명 (선택)</Label>
              <Input id="rl-desc" value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" disabled={newName.trim() === '' || createLibrary.isPending}
              onClick={() => createLibrary.mutate(
                scope === 'global'
                  ? { scope, name: newName.trim(), description: newDescription.trim() }
                  : { scope, orgId: orgId!, name: newName.trim(), description: newDescription.trim() },
              )}>
              만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewing && (
        <LibraryViewDialog library={viewing} canManage={canManage}
          onClose={() => setViewingId(null)} onChanged={invalidateLibraries} />
      )}

      {importTarget && (
        <LibraryImportDialog target={importTarget} onClose={() => setImportTarget(null)}
          onDone={() => {
            setImportTarget(null)
            void invalidateLibraries()
            if (importTarget.kind === 'existing') void invalidateItems(importTarget.libraryId)
          }} />
      )}
    </section>
  )
}
```

- [ ] **Step 6: 가져오기 다이얼로그를 고친다** — `library-import-dialog.tsx`

import 에서 `useQuery` 를 빼고(`useMutation` 만 남긴다) `resourceDisplayName` 을 빼며 두 줄을 더한다:

```ts
import { useMutation } from '@tanstack/react-query'
import { formatCount } from '@/lib/format'
import { useLibraryDomains } from '@/lib/library-domains'
```

`existingItems` 선언(4줄)을 이것으로 바꾼다:

```ts
  // 대상 라이브러리의 도메인 이름 — Excel 을 라이브러리 문서로 바꿀 때 용어의 도메인을 이름으로 푸는 데만 쓴다.
  // 항목 전체(items.list)를 받지 않는다(설계 3절 — 이 쓰임은 dryRun 응답·countsByKind 로 대신할 수 없다).
  const existingDomains = useLibraryDomains(
    target.kind === 'existing' ? target.libraryId : null, target.kind === 'existing',
  )
```

`onFile` 안의 `domainNames` 계산을 이것으로 바꾼다:

```ts
        const domainNames = (existingDomains.data ?? []).map((d) => d.name)
```

적용 결과 토스트를 천 단위로:

```ts
      toast.success(`추가 ${formatCount(c.add)} · 갱신 ${formatCount(c.update + (includeStale ? c.stale : 0))} · 삭제 ${formatCount(prune ? c.remove - c.removeBlocked : 0)}`)
```

- [ ] **Step 7: 승인 뒤 무효화를 바꾼다** — `promotion-requests-section.tsx` 의 `resolve` `onSuccess` 에서 `items.list` 무효화 블록을 이것으로 바꾸고, import 에 `import { libraryDomainsQueryKey } from '@/lib/library-domains'` 를 더한다.

```ts
      // 승격은 같은 화면의 라이브러리 관리 목록(개수)과 조회 모달(항목 페이지·도메인 목록)을 낡게 만든다 —
      // QueryClient가 refetchOnWindowFocus:false라 자동 회복 트리거가 없어 여기서 직접 지운다.
      const resolvedLibraryId = detail.data?.request.libraryId
      if (resolvedLibraryId !== undefined) {
        await queryClient.invalidateQueries({
          queryKey: trpc.resource.items.page.queryKey({ libraryId: resolvedLibraryId }),
        })
        await queryClient.invalidateQueries({ queryKey: libraryDomainsQueryKey(resolvedLibraryId) })
      }
```

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/lib/library-domains.test.ts src/components/library-view-dialog.test.tsx src/components/resource-library-manager.test.tsx src/components/library-import-dialog.test.tsx src/components/promotion-requests-section.test.tsx`
Expected: PASS(개수 확인). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/lib/library-domains.ts apps/web/src/lib/library-domains.test.ts apps/web/src/components/library-view-dialog.tsx apps/web/src/components/library-view-dialog.test.tsx apps/web/src/components/resource-library-manager.tsx apps/web/src/components/resource-library-manager.test.tsx apps/web/src/components/library-import-dialog.tsx apps/web/src/components/library-import-dialog.test.tsx apps/web/src/components/promotion-requests-section.tsx && git commit -m "feat(web): 라이브러리 관리 화면을 종류별 탭·검색·페이지 조회 모달로 바꾼다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/lib/library-domains.ts apps/web/src/lib/library-domains.test.ts apps/web/src/components/library-view-dialog.tsx apps/web/src/components/library-view-dialog.test.tsx apps/web/src/components/resource-library-manager.tsx apps/web/src/components/resource-library-manager.test.tsx apps/web/src/components/library-import-dialog.tsx apps/web/src/components/library-import-dialog.test.tsx apps/web/src/components/promotion-requests-section.tsx
```

- [ ] **Step 10: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. `KindTab` 의 `useEffect`(물러나기)를 지운다 → 「마지막 쪽의 마지막 항목을 지우면…」 FAIL 기대.
  2. `LibraryViewDialog` 의 `onQueryChange={(query) => patchTab(k, { query, page: 1 })}` 에서 `page: 1` 을 뺀다 → 「다음 쪽은 offset 을…」 FAIL 기대(`offset: 0` 호출이 없다).
  3. `invalidate` 에서 `items.page` 무효화 줄을 뺀다 → 「항목을 추가하면…」 FAIL 기대.
  4. `fetchAllDomainOptions` 의 종료 조건에서 `page.items.length < DOMAIN_PAGE_LIMIT ||` 를 뺀다 → 「그 사이 지워져…」 FAIL 기대.
  복구 후 `git status --short` clean.

---
### Task 8: web — 모델 변경 저수준 경로의 나눠 보내기

설계 5절의 규칙 1~6 과 「실패와 경합」을 `use-model.ts` 의 `useSubmit` 한 곳에 구현한다. 소비처는 이 태스크에서 바꾸지 않는다(Task 11). Task 1 의 불변식에 기댄다.

**Files:**
- Create: `apps/web/src/editor/mutation-chunks.ts`, `apps/web/src/editor/mutation-chunks.test.ts`, `apps/web/src/editor/use-model-chunks.test.tsx`
- Modify: `apps/web/src/editor/use-model.ts`

**Interfaces:**
- Consumes: `MAX_OPS_PER_MUTATION`(`@erdd/core`), `formatCount`(Task 6).
- Produces:
  - `SUMMARY_MAX_LENGTH = 200`, `CHUNKED_SUMMARY_FALLBACK = '대량 편집'`
  - `chunkOps<T>(ops: readonly T[], size: number): T[][]`
  - `chunkSummary(summary: string | undefined, index: number, total: number): string | undefined` — `total <= 1` 이면 `summary` 그대로. 아니면 `` `${base} (${index}/${total})` `` 이고 전체 길이가 200 을 넘지 않게 `base` 를 자른다. `summary` 가 없으면 `base` 는 `'대량 편집'`.
  - `chunkFailureMessage(done: number, total: number, message: string): string` — `done === 0` 또는 `done >= total` 이면 `message`, 아니면 `${formatCount(total)}개 묶음 중 ${formatCount(done)}개를 적용했고 나머지는 적용하지 못했습니다 — ${message}`.
  - `useModelMutation(projectId)` 가 돌려주는 함수의 옵션이 `{ summary?: string; onProgress?: (done: number, total: number) => void }` 가 된다. `onProgress` 는 **조각이 둘 이상일 때만** 불린다 — 보내기 전 `(0, n)`, 조각이 끝날 때마다 `(i, n)`. `Mutate` 타입은 자동으로 따라온다. Task 11 의 소비처가 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/web/src/editor/mutation-chunks.test.ts
import { describe, expect, it } from 'vitest'
import { chunkFailureMessage, chunkOps, chunkSummary } from './mutation-chunks'

describe('chunkOps', () => {
  it('순서를 그대로 두고 size 씩 자른다', () => {
    expect(chunkOps([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkOps([1, 2], 5)).toEqual([[1, 2]])
  })
})

describe('chunkSummary', () => {
  it('조각이 하나면 원래 요약 그대로다(없으면 없음)', () => {
    expect(chunkSummary('메모 추가', 1, 1)).toBe('메모 추가')
    expect(chunkSummary(undefined, 1, 1)).toBeUndefined()
  })
  it('조각 번호를 붙이고, 요약이 없으면 「대량 편집」으로 묶어 알아보게 한다', () => {
    expect(chunkSummary('메모 추가', 2, 4)).toBe('메모 추가 (2/4)')
    expect(chunkSummary(undefined, 2, 3)).toBe('대량 편집 (2/3)')
  })
  it('요약이 길어도 조각 번호를 붙인 결과가 서버 상한 200자를 넘지 않는다', () => {
    const s = chunkSummary('가'.repeat(200), 1, 12)!
    expect(s).toHaveLength(200)
    expect(s.endsWith(' (1/12)')).toBe(true)
  })
})

describe('chunkFailureMessage', () => {
  it('첫 조각 실패와 전부 끝난 뒤의 실패는 원래 문구 그대로다', () => {
    expect(chunkFailureMessage(0, 4, '거절됨')).toBe('거절됨')
    expect(chunkFailureMessage(4, 4, '거절됨')).toBe('거절됨')
  })
  it('중간 실패는 몇 묶음을 적용했는지 말한다', () => {
    expect(chunkFailureMessage(2, 4, '거절됨')).toBe('4개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 거절됨')
  })
})
```

```tsx
// apps/web/src/editor/use-model-chunks.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import {
  MAX_OPS_PER_MUTATION, createEmptyModel, type Domain, type Op, type ProjectModel,
} from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { serializeMutation, useModelMutation, useUndoRedo } from './use-model.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

const MAX = MAX_OPS_PER_MUTATION
const PID = '018f6b0e-0000-7000-8000-0000000000aa'
const OTHER = '018f6b0e-0000-7000-8000-0000000000bb'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

function withNotes(model: ProjectModel, n: number): ProjectModel {
  const notes = { ...model.notes }
  for (let i = 0; i < n; i++) {
    const id = `n${i}`
    notes[id] = { id, content: `메모${i}`, position: { x: 0, y: 0 }, color: '#fff' }
  }
  return { ...model, notes }
}

function domain(id: string): Domain {
  return {
    id, name: id, category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}

type Sent = { ops: Op[]; summary?: string }

/**
 * model.mutate 스텁. 기본은 seq 를 1씩 올린다. `seqs` 를 주면 i번째 호출에 그 seq 를 돌려주고,
 * `fail` 번째 호출은 거절하며, `onCall` 은 응답 전에 부른다(그 사이의 사건을 흉내 낸다).
 */
function serverStub(opts: {
  seqs?: number[]; fail?: number; fresh?: ProjectModel; onCall?: (i: number) => void
} = {}) {
  const sent: Sent[] = []
  const freshCalls: number[] = []
  let seq = 1
  mockTrpcFetch({
    'model.mutate': (input) => {
      const i = sent.length
      sent.push(input as Sent)
      opts.onCall?.(i)
      if (opts.fail === i) return { error: { code: -32600, message: '거절됨' } }
      seq = opts.seqs?.[i] ?? seq + 1
      return { data: { seq } }
    },
    'model.get': () => {
      freshCalls.push(1)
      return { data: { model: opts.fresh ?? createEmptyModel(), seq: 99 } }
    },
  })
  return { sent, freshCalls }
}

function setup() {
  useEditorStore.getState().setLoaded(createEmptyModel(), 1, PID)
  grantEditPermission()
  return renderHook(
    () => ({ mutate: useModelMutation(PID), history: useUndoRedo(PID) }),
    { wrapper: wrapper() },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
  useEditorStore.getState().reset()
})

describe('useModelMutation — 5,000 op 를 넘는 편집은 나눠 보낸다', () => {
  it('5,000건 이하는 지금처럼 한 번에 보내고 요약에 번호를 붙이지 않으며 진행도 알리지 않는다', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    const progress = vi.fn()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, MAX), { summary: '메모 추가', onProgress: progress })
    })
    expect(outcome).toBe('applied')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.ops).toHaveLength(MAX)
    expect(sent[0]!.summary).toBe('메모 추가')
    expect(progress).not.toHaveBeenCalled()
    expect(useEditorStore.getState().seq).toBe(2)
  })

  it('넘으면 5,000씩 차례로 보내고 요약에 조각 번호를 붙이며, 실행 취소 기록은 전체 op 하나다', async () => {
    const { sent, freshCalls } = serverStub()
    const { result } = setup()
    const progress = vi.fn()
    await act(async () => {
      await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가', onProgress: progress })
    })
    expect(sent.map((s) => s.ops.length)).toEqual([MAX, MAX, 1])
    expect(sent.map((s) => s.summary)).toEqual(['메모 추가 (1/3)', '메모 추가 (2/3)', '메모 추가 (3/3)'])
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
    expect(freshCalls).toHaveLength(0)                  // seq 가 이어졌으므로 되맞추지 않는다
    expect(useEditorStore.getState().seq).toBe(4)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().undoStack[0]).toHaveLength(2 * MAX + 1)
  })

  it('조각은 diffModels 순서 그대로다 — 부모(도메인)가 앞 조각, 그것을 가리키는 용어가 뒤 조각', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    await act(async () => {
      await result.current.mutate((m) => {
        const domains = { ...m.domains }
        for (let i = 0; i < MAX; i++) domains[`d${i}`] = domain(`d${i}`)
        return {
          ...m, domains,
          terms: { t1: { id: 't1', logicalName: '금액', physicalName: 'AMT', domainId: `d${MAX - 1}`, description: null, origin: null } },
        }
      }, { summary: '사전' })
    })
    expect(sent).toHaveLength(2)
    expect(sent[0]!.ops.every((op) => op.entity === 'domain')).toBe(true)
    expect(sent[1]!.ops).toEqual([expect.objectContaining({ action: 'create', entity: 'term', entityId: 't1' })])
  })

  it('실행 취소 한 번이 역연산 전부를 조각으로 보내고, 다시 실행도 그렇다', async () => {
    const { sent } = serverStub()
    const { result } = setup()
    await act(async () => { await result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' }) })
    await act(async () => { await result.current.history.undo() })
    expect(sent.slice(2).map((s) => s.summary)).toEqual(['실행 취소 (1/2)', '실행 취소 (2/2)'])
    expect(sent.slice(2).flatMap((s) => s.ops).every((op) => op.action === 'delete')).toBe(true)
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(0)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
    await act(async () => { await result.current.history.redo() })
    expect(sent.slice(4).map((s) => s.summary)).toEqual(['다시 실행 (1/2)', '다시 실행 (2/2)'])
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(MAX + 1)
  })

  it('중간 조각이 실패하면 거기서 멈추고 서버 상태로 되맞추며 실행 취소 기록을 남기지 않는다', async () => {
    const fresh = withNotes(createEmptyModel(), 3)
    const { sent, freshCalls } = serverStub({ fail: 1, fresh })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('error')
    expect(sent).toHaveLength(2)                          // 셋째 조각은 보내지 않는다
    expect(toast.error).toHaveBeenCalledWith('3개 묶음 중 1개를 적용했고 나머지는 적용하지 못했습니다 — 거절됨')
    expect(freshCalls).toHaveLength(1)
    expect(Object.keys(useEditorStore.getState().model.notes)).toHaveLength(3)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })

  it('첫 조각이 실패하면 지금의 단일 실패와 같은 문구로 알린다', async () => {
    const { sent } = serverStub({ fail: 0 })
    const { result } = setup()
    await act(async () => { await result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' }) })
    expect(sent).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('거절됨')
  })

  it('조각 사이에 남의 편집이 끼면 남은 조각을 끝까지 보낸 뒤 서버 모델로 되맞춘다', async () => {
    const fresh = withNotes(createEmptyModel(), 2 * MAX + 1)
    const { sent, freshCalls } = serverStub({ seqs: [2, 4, 5], fresh })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('applied')
    expect(sent).toHaveLength(3)
    expect(freshCalls).toHaveLength(1)
    expect(useEditorStore.getState().seq).toBe(99)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('조각 사이에 프로젝트를 떠나면 남은 조각을 보내지 않는다', async () => {
    const { sent } = serverStub({
      onCall: (i) => { if (i === 0) useEditorStore.getState().setLoaded(createEmptyModel(), 0, OTHER) },
    })
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.mutate((m) => withNotes(m, 2 * MAX + 1), { summary: '메모 추가' })
    })
    expect(outcome).toBe('error')
    expect(sent).toHaveLength(1)
    expect(useEditorStore.getState().loadedProjectId).toBe(OTHER)
    expect(useEditorStore.getState().model.notes).toEqual({})
  })

  it('조각을 보내는 동안 줄을 선 실시간 처리는 모든 조각 뒤에 돌고, 적용 중에 누른 실행 취소는 한 번에 전부 되돌린다', async () => {
    const order: string[] = []
    const { sent } = serverStub({
      onCall: (i) => {
        order.push(`chunk${i}`)
        // 첫 조각의 응답을 기다리는 사이 실시간 op 가 도착했다(use-realtime 은 같은 체인에 줄을 선다).
        if (i === 0) void serializeMutation(async () => { order.push('realtime') })
      },
    })
    const { result } = setup()
    await act(async () => {
      const applying = result.current.mutate((m) => withNotes(m, MAX + 1), { summary: '메모 추가' })
      // 적용이 끝나기 전에 실행 취소를 누른다 — 체인에서 적용 바로 뒤, 실시간 처리 앞에 선다.
      void result.current.history.undo()
      await applying
    })
    await act(async () => { await serializeMutation(async () => undefined) })   // 체인을 비운다
    expect(order).toEqual(['chunk0', 'chunk1', 'chunk2', 'chunk3', 'realtime'])
    expect(sent.map((s) => s.summary)).toEqual(['메모 추가 (1/2)', '메모 추가 (2/2)', '실행 취소 (1/2)', '실행 취소 (2/2)'])
    expect(useEditorStore.getState().model.notes).toEqual({})
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/mutation-chunks.test.ts src/editor/use-model-chunks.test.tsx`
Expected: `mutation-chunks` 는 모듈 없음, `use-model-chunks` 는 5,000 초과 케이스들이 FAIL(지금은 10,001 op 를 한 요청에 담는다 — 스텁은 받아 주므로 `sent` 길이가 1).

- [ ] **Step 3: `mutation-chunks.ts` 를 쓴다**

```ts
// apps/web/src/editor/mutation-chunks.ts
import { formatCount } from '@/lib/format'

/** 서버 `model.mutate` 의 summary 상한(zod `max(200)`). 조각 번호를 붙여도 넘지 않게 원래 요약을 자른다. */
export const SUMMARY_MAX_LENGTH = 200
/** 요약 없이 나눠 보낼 때의 이름 — 이력에서 조각들을 한 묶음으로 알아보게 한다. */
export const CHUNKED_SUMMARY_FALLBACK = '대량 편집'

/** 순서를 그대로 두고 size 씩 자른다. 순서가 정확성 조건이다(guides/data-layer.md 「한 요청의 op 상한은 …」). */
export function chunkOps<T>(ops: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('size 는 1 이상이어야 합니다')
  const out: T[][] = []
  for (let start = 0; start < ops.length; start += size) out.push(ops.slice(start, start + size))
  return out
}

/** `〈원래 요약〉 (i/n)`. 조각이 하나면 원래 요약 그대로다. */
export function chunkSummary(summary: string | undefined, index: number, total: number): string | undefined {
  if (total <= 1) return summary
  const suffix = ` (${index}/${total})`
  const base = summary ?? CHUNKED_SUMMARY_FALLBACK
  return `${base.slice(0, SUMMARY_MAX_LENGTH - suffix.length)}${suffix}`
}

/**
 * 실패 토스트 문구. 첫 조각의 실패는 지금의 단일 실패와 같은 문구이고, 중간 실패만 몇 묶음이 들어갔는지 말한다
 * — 앞 조각은 서버에 남아 있으므로 사용자가 그 사실을 알아야 한다.
 */
export function chunkFailureMessage(done: number, total: number, message: string): string {
  if (done === 0 || done >= total) return message
  return `${formatCount(total)}개 묶음 중 ${formatCount(done)}개를 적용했고 나머지는 적용하지 못했습니다 — ${message}`
}
```

- [ ] **Step 4: `use-model.ts` 를 고친다**

import 두 줄을 바꾼다:

```ts
import {
  applyOps, diffModels, invertOps, MAX_OPS_PER_MUTATION, validateModelIntegrity, type ProjectModel,
} from '@erdd/core'
import { chunkFailureMessage, chunkOps, chunkSummary } from './mutation-chunks.js'
```

`ModelMutationResult` 타입 선언 바로 아래에 더한다:

```ts
/** 진행 콜백. 조각이 둘 이상일 때만 불린다 — 보내기 전 (0, n), 조각이 끝날 때마다 (i, n). */
export type MutationProgress = (done: number, total: number) => void

/** 저수준 경로의 선택지. record=true면 undo 스택에 기록. */
type SubmitOptions = { summary?: string; record: boolean; onProgress?: MutationProgress }
```

`useSubmit` 의 콜백 시그니처를 `opts: SubmitOptions` 로 바꾸고, `useEditorStore.getState().pruneSelection(next)` 다음의 `try { … } catch (err) { … }` 전체를 아래로 바꾼다(그 위 — 프로젝트 가드·권한 가드·producer·diff·무결성·낙관적 반영·pruneSelection — 은 그대로 둔다):

```ts
      // 5,000건을 넘으면 diffModels 가 낸 순서 그대로 잘라 차례로 보낸다(guides/data-layer.md 「한 요청의 op
      // 상한은 …」). 서버는 조각 하나를 독립된 mutation 으로 적용하므로 각 조각까지의 중간 상태가 무결해야
      // 하고, diffModels 순서의 모든 접두사가 무결하다는 것이 이 자름이 기대는 불변식이다(core
      // diff-prefix.test.ts). 자르기 전에 op 를 재정렬·필터하지 마라. 낙관적 반영은 위에서 전체 다음 모델로
      // 한 번 했고, 전부 이 체인(serializeMutation) 안에서 보내므로 그 사이 내 다른 편집·실행 취소·실시간
      // 수신은 뒤에 줄을 선다.
      const chunks = chunkOps(ops, MAX_OPS_PER_MUTATION)
      const total = chunks.length
      let lastSeq = seqBefore
      let interleaved = false
      let done = 0
      if (total > 1) opts.onProgress?.(0, total)
      try {
        for (const chunk of chunks) {
          const { seq } = await mutation.mutateAsync({
            projectId, ops: chunk, summary: chunkSummary(opts.summary, done + 1, total),
          })
          // await 사이 프로젝트가 바뀌었으면 남은 조각을 보내지 않고, 새 프로젝트의 seq/히스토리도 오염시키지 않는다.
          if (useEditorStore.getState().loadedProjectId !== projectId) return 'error'
          // 내 조각이 서버 락에 대기하는 동안 다른 사용자의 revision 이 끼어들었다. 남은 조각은 계속 보낸다 —
          // 조각은 op 단위로 적용되고, 남의 편집과 겹쳐 거절되면 아래 catch 의 중간 실패로 간다.
          if (seq !== lastSeq + 1) interleaved = true
          lastSeq = seq
          done += 1
          if (total > 1) opts.onProgress?.(done, total)
        }
        if (interleaved) {
          // 끼어든 op 는 use-realtime 의 seq 체인에서 "이미 지나간 것"으로 오인돼 버려지므로,
          // 낙관적 로컬 상태를 버리고 서버의 최신 모델로 통째 되맞춘다.
          const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
          if (useEditorStore.getState().loadedProjectId === projectId) {
            useEditorStore.getState().resync(fresh.model, fresh.seq)
          }
        } else {
          useEditorStore.getState().setSeq(lastSeq)
        }
        // 조각이 몇 개였든 편집 1건 = 실행 취소 1회다 — 전체 Op[] 하나를 기록한다. 실행 취소·다시 실행은 그
        // 역연산을 이 경로로 다시 보내므로 역시 조각으로 나뉘어 간다.
        if (opts.record) useEditorStore.getState().recordEdit(ops)
        return 'applied'
      } catch (err) {
        // 첫 조각의 실패는 지금의 단일 실패와 같다. 중간 실패는 원자적이지 않다 — 앞 조각은 서버에 남는다.
        // 반쯤 들어간 편집을 「한 번에 되돌리기」로 기록하지 않는다(되돌릴 op 가 서버 상태와 어긋난다).
        // 아래 resync 가 실행 취소 기록을 비운다.
        toast.error(chunkFailureMessage(done, total, err instanceof Error ? err.message : '변경을 저장하지 못했습니다'))
        // 여전히 이 프로젝트를 보고 있을 때만 서버 상태로 복구한다(다른 프로젝트 화면 덮어쓰기 방지).
        if (useEditorStore.getState().loadedProjectId === projectId) {
          try {
            const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
            if (useEditorStore.getState().loadedProjectId === projectId) {
              // setLoaded가 아니라 **resync**다 — 같은 프로젝트를 서버 상태로 되맞추는 것이므로
              // 위 seq 간극 경로와 같은 함수여야 한다. 셋이 갈린다:
              // ① 그룹 뷰: 편집 하나가 거절됐다고 그룹 뷰에서 튕기면 안 된다(setLoaded는 튕긴다).
              // ② 참여자: setLoaded는 peers를 비워, 다음 presence 프레임까지 남들의 하이라이트가
              //    통째로 사라진다.
              // ③ 선택: **resync만 keptSelection을 탄다.** 남이 먼저 지운 테이블 때문에 내 op가
              //    거절된 경우, setLoaded면 모델에 없는 id가 선택에 남아 BulkPanel 헤더 개수와
              //    목록이 어긋나고 유령 presence가 나간다(설계 §4 — 사라진 대상은 모든 경로에서
              //    같은 한 규칙으로 걷어낸다).
              useEditorStore.getState().resync(fresh.model, fresh.seq)
            }
          } catch {
            toast.error('서버 상태를 복구하지 못했습니다. 새로고침해 주세요.')
          }
        }
        return 'error'
      }
```

`useModelMutation` 을 이렇게 바꾼다(옵션에 `onProgress` 를 더해 그대로 넘긴다):

```ts
export function useModelMutation(projectId: string) {
  const submit = useSubmit(projectId)
  return useCallback(
    (
      producer: (model: ProjectModel) => ProjectModel,
      opts?: { summary?: string; onProgress?: MutationProgress },
    ): Promise<ModelMutationResult> =>
      serializeMutation(async () => {
        const r = await submit(producer, { summary: opts?.summary, onProgress: opts?.onProgress, record: true })
        if (r === 'error') failedMutations += 1
        return r
      }),
    [submit],
  )
}
```

`useUndoRedo` 의 두 `submit(...)` 호출은 그대로 둔다(`{ summary: '실행 취소', record: false }` 가 `SubmitOptions` 를 만족한다).

- [ ] **Step 5: 통과를 확인한다 — 기존 use-model·undo 테스트까지**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/mutation-chunks.test.ts src/editor/use-model-chunks.test.tsx src/editor/use-model.test.tsx src/editor/undo-redo.test.tsx src/editor/use-realtime.test.tsx`
Expected: PASS(개수 확인). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/mutation-chunks.ts apps/web/src/editor/mutation-chunks.test.ts apps/web/src/editor/use-model.ts apps/web/src/editor/use-model-chunks.test.tsx && git commit -m "feat(web): 5,000 op 를 넘는 모델 편집을 저수준 경로에서 조각으로 나눠 보낸다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/editor/mutation-chunks.ts apps/web/src/editor/mutation-chunks.test.ts apps/web/src/editor/use-model.ts apps/web/src/editor/use-model-chunks.test.tsx
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — 각각 되돌리고 `use-model-chunks.test.tsx`·`mutation-chunks.test.ts` 를 돌린 뒤 복구:
  1. `chunkOps(ops, MAX_OPS_PER_MUTATION)` 를 `[ops]` 로 → 「넘으면 5,000씩…」·「실행 취소 한 번이…」 FAIL 기대.
  2. 루프 안의 `loadedProjectId` 가드를 지운다 → 「조각 사이에 프로젝트를 떠나면…」 FAIL 기대.
  3. `if (seq !== lastSeq + 1) interleaved = true` 를 지운다 → 「조각 사이에 남의 편집이 끼면…」 FAIL 기대.
  4. `recordEdit(ops)` 를 조각마다(루프 안, `recordEdit(chunk)`)로 옮긴다 → 「실행 취소 기록은 전체 op 하나다」 FAIL 기대.
  5. `chunkSummary` 의 `.slice(0, SUMMARY_MAX_LENGTH - suffix.length)` 를 뺀다 → 「요약이 길어도…」 FAIL 기대.
  6. catch 의 `chunkFailureMessage(done, total, …)` 를 메시지만으로 → 「중간 조각이 실패하면…」 FAIL 기대.
  복구: `git checkout -- apps/web/src/editor/use-model.ts apps/web/src/editor/mutation-chunks.ts && git status --short` → clean.

---

### Task 9: cli — 로컬 모드도 조각을 차례로 받는다

설계 7절: 로컬 모드는 로컬 라우터(`packages/cli/src/local/router.ts`)의 `model.mutate` 를 쓴다. 웹의 나눠 보내기는 같은 요청을 여러 번 보낼 뿐이므로 로컬 라우터가 조각을 차례로 받고 `seq` 를 1씩 올리는지 확인한다. **프로덕션 코드는 바꾸지 않는다** — 이 태스크의 구분력 실증은 없다(바뀐 것이 없다). 확인 결과를 보고한다.

**Files:**
- Modify (test): `packages/cli/src/local/router.test.ts`

**Interfaces:**
- Consumes: `createLocalRouter().createCaller(ctx)`, `MAX_OPS_PER_MUTATION`, `diffModels`, `createEmptyModel`, `LOCAL_PROJECT_ID`(파일에 이미 있는 헬퍼 `caller()`).

- [ ] **Step 1: 테스트를 쓴다** — import 의 `@erdd/core` 줄을 `import { MAX_OPS_PER_MUTATION, createEmptyModel, diffModels, type Op } from '@erdd/core'` 로 바꾸고, 「op 상한을 넘는 mutate 는 BAD_REQUEST 로 거절한다」 테스트 바로 뒤에 더한다.

```ts
  it('5,000건을 넘는 편집을 웹처럼 조각으로 나눠 보내면 차례로 적용하고 seq 를 1씩 올린다', async () => {
    const call = await caller()
    const target = createEmptyModel()
    for (let i = 0; i <= MAX_OPS_PER_MUTATION; i += 1) {
      const id = `018f6b0e-0000-7000-8000-${String(i).padStart(12, '0')}`
      target.words[id] = {
        id, logicalName: `단어${i}`, abbreviation: `W${i}`, englishName: null, description: null, origin: null,
      }
    }
    const ops = diffModels(createEmptyModel(), target)
    expect(ops).toHaveLength(MAX_OPS_PER_MUTATION + 1)
    const first = await call.model.mutate({
      projectId: LOCAL_PROJECT_ID, ops: ops.slice(0, MAX_OPS_PER_MUTATION), summary: '단어 등록 (1/2)',
    })
    const second = await call.model.mutate({
      projectId: LOCAL_PROJECT_ID, ops: ops.slice(MAX_OPS_PER_MUTATION), summary: '단어 등록 (2/2)',
    })
    expect(second.seq).toBe(first.seq + 1)
    const after = await call.model.get({ projectId: LOCAL_PROJECT_ID })
    expect(Object.keys(after.model.words)).toHaveLength(MAX_OPS_PER_MUTATION + 1)
  })
```

- [ ] **Step 2: 돌린다 — 처음부터 통과가 기대값이다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/router.test.ts`
Expected: PASS(개수 확인). **실패하면 로컬 모드에서 나눠 보내기가 동작하지 않는 것이다 — 멈추고 출력과 함께 보고한다.** 이어서 `docs/manual/local-guide.md` 의 「4.2 사용 매뉴얼의 어느 장이 해당하나」 표가 9·10·11·16·20절을 「그대로」로 적는지 확인한다(Task 15 가 문서를 고칠 때 이 결과를 근거로 쓴다).

- [ ] **Step 3: 커밋**

```bash
git add packages/cli/src/local/router.test.ts && git commit -m "test(cli): 로컬 라우터가 웹의 나눠 보내기 조각을 차례로 적용함을 잠근다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/cli/src/local/router.test.ts
```

---

### Task 10: web — 재동기화·승격 목록의 구역 검색·페이지, 공용 리소스 패널 탭

**Files:**
- Create: `apps/web/src/components/paged-section.tsx`, `apps/web/src/components/paged-section.test.tsx`
- Modify: `apps/web/src/editor/resource-resync-tab.tsx`(전체 교체), `apps/web/src/components/promote-entry-list.tsx`(전체 교체), `apps/web/src/editor/resource-panel.tsx`(탭·개수)
- Test: `apps/web/src/editor/resource-panel.test.tsx`, `apps/web/src/components/promote-entry-list.test.tsx`

**Interfaces:**
- Consumes: `useListPage`·`PAGE_SIZE`·`Pagination`·`Tabs*`·`formatCount`(Task 6), `resourceSecondaryName`(Task 2).
- Produces: `PagedSection<T>({ title, rows, fields, renderRow, actions?, children? })` — 제목 `〈title〉 (N)`, 검색창(`〈title〉 검색`), 50건 페이지, `actions`(구역 일괄 버튼)는 행이 있을 때만 보이고 검색 중이거나 페이지가 여럿이면 옆에 「구역 전체 N건에 적용」. `<section aria-label={title}>` 라 `getByRole('region', { name: title })` 로 잡힌다. 선택 상태는 이 부품이 갖지 않는다 — 부모의 `Decisions`/`selected` 가 구역 전체를 들고 있으므로 페이지를 넘겨도 남는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// apps/web/src/components/paged-section.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PagedSection } from './paged-section'

type Row = { id: string; name: string; code: string | null }
const FIELDS = (r: Row) => [r.name, r.code]
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `이름${String(i).padStart(2, '0')}`, code: `C${i}` }))

function renderSection(list: Row[], onAll = vi.fn()) {
  render(
    <PagedSection title="신규 추가" rows={list} fields={FIELDS}
      renderRow={(r) => <li key={r.id}>{r.name}</li>}
      actions={<button type="button" onClick={onAll}>모두 선택</button>} />,
  )
  return within(screen.getByRole('region', { name: '신규 추가' }))
}

afterEach(cleanup)

describe('PagedSection', () => {
  it('제목에 구역 전체 건수를 적고 50건씩 보이며 다음 쪽으로 넘긴다', async () => {
    const section = renderSection(rows(60))
    expect(section.getByText('신규 추가 (60)')).toBeInTheDocument()
    expect(section.getByText('이름49')).toBeInTheDocument()
    expect(section.queryByText('이름50')).toBeNull()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.getByText('이름50')).toBeInTheDocument()
  })

  it('검색은 1쪽으로 돌아가고 논리명·물리명 칸 어느 쪽으로도 찾는다', async () => {
    const section = renderSection(rows(60))
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), 'c5')
    expect(section.getByText('이름05')).toBeInTheDocument()
    expect(section.getByText('이름50')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: '다음' })).toBeNull()
  })

  it('검색 중이거나 쪽이 여럿이면 일괄 버튼 옆에 「구역 전체 N건에 적용」을 보인다', async () => {
    const small = renderSection(rows(3))
    expect(small.queryByText(/구역 전체/)).toBeNull()
    await userEvent.type(small.getByRole('textbox', { name: '신규 추가 검색' }), '이름0')
    expect(small.getByText('구역 전체 3건에 적용')).toBeInTheDocument()
    cleanup()
    expect(renderSection(rows(60)).getByText('구역 전체 60건에 적용')).toBeInTheDocument()
  })

  it('행이 없으면 일괄 버튼과 검색창을 숨긴다', () => {
    const section = renderSection([])
    expect(section.getByText('신규 추가 (0)')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: '모두 선택' })).toBeNull()
    expect(section.queryByRole('textbox')).toBeNull()
  })
})
```

`apps/web/src/editor/resource-panel.test.tsx` 의 import 에 `within` 을 더하고(`import { cleanup, render, screen, waitFor, within } from '@testing-library/react'`), `describe('ResourcePanel', …)` 안 끝에 더한다:

```tsx
  const manyItems = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, kind: 'word', version: 1,
    payload: {
      logicalName: `단어${String(i).padStart(3, '0')}`, abbreviation: `W${String(i).padStart(3, '0')}`,
      englishName: null, description: null,
    },
  }))

  it('라이브러리 목록의 항목 수를 천 단위로 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: [{ ...LIBS[0], itemCount: 16565 }] }),
    }, createEmptyModel())
    expect(await screen.findByText(/항목 16,565개/)).toBeInTheDocument()
  })

  it('신규 추가는 50건씩 나뉘고, 행에 물리명(약어)이 보이며, 쪽을 넘겨도 선택이 남는다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(60) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (60)')
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    expect(section.getByText('W000')).toBeInTheDocument()
    await userEvent.click(section.getByRole('checkbox', { name: '단어000 선택' }))
    expect(section.getByRole('checkbox', { name: '단어000 선택' })).not.toBeChecked()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.queryByRole('checkbox', { name: '단어000 선택' })).toBeNull()
    expect(section.getByRole('checkbox', { name: '단어050 선택' })).toBeChecked()
    await userEvent.click(section.getByRole('button', { name: '이전' }))
    expect(section.getByRole('checkbox', { name: '단어000 선택' })).not.toBeChecked()
    expect(screen.getByText('처리 대상 59건')).toBeInTheDocument()
  })

  it('검색 중 「모두 해제」는 보이는 행이 아니라 구역 전체에 적용된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(60) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (60)')
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), '단어05')
    expect(section.getAllByRole('checkbox')).toHaveLength(10)
    expect(section.getByText('구역 전체 60건에 적용')).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: '모두 해제' }))
    expect(screen.getByText('처리 대상 0건')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled()
  })
```

`apps/web/src/components/promote-entry-list.test.tsx` 의 import 에 `within` 을 더하고 describe 안 끝에 더한다:

```tsx
  const entries = (n: number): PromoteEntry[] => Array.from({ length: n }, (_, i) => ({
    ...ENTRY, entityId: `w${i}`, name: `단어${String(i).padStart(3, '0')}`,
    payload: { logicalName: `단어${String(i).padStart(3, '0')}`, abbreviation: `W${String(i).padStart(3, '0')}` },
  }))

  it('구역이 50건씩 나뉘고 체크 표시는 쪽과 무관하게 selected 를 따른다 — 행에 물리명이 보인다', async () => {
    render(
      <PromoteEntryList audience="promote" entries={entries(60)} selected={new Set(['w55'])}
        onToggle={vi.fn()} onSetAll={vi.fn()} />,
    )
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    expect(section.getByText('W000')).toBeInTheDocument()
    expect(section.queryByRole('checkbox', { name: '단어055 선택' })).toBeNull()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.getByRole('checkbox', { name: '단어055 선택' })).toBeChecked()
  })

  it('검색 중 「모두 선택」도 구역 단위로 부른다 — 구역 전체 안내가 붙는다', async () => {
    const onSetAll = vi.fn()
    render(
      <PromoteEntryList audience="promote" entries={entries(60)} selected={new Set()}
        onToggle={vi.fn()} onSetAll={onSetAll} />,
    )
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), 'w05')
    expect(section.getByText('구역 전체 60건에 적용')).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: '모두 선택' }))
    expect(onSetAll).toHaveBeenCalledWith('new', true)
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/paged-section.test.tsx src/editor/resource-panel.test.tsx src/components/promote-entry-list.test.tsx`
Expected: `paged-section` 모듈 없음, 새 케이스 FAIL(`region` 없음, `W000` 없음, `16,565` 없음).

- [ ] **Step 3: `paged-section.tsx` 를 쓴다**

```tsx
// apps/web/src/components/paged-section.tsx
import type { ReactNode } from 'react'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'

/**
 * 재동기화·승격 화면의 한 구역 — 제목, 구역 일괄 버튼, 검색창, 50건 페이지.
 *
 * **선택 상태는 이 부품이 갖지 않는다.** 부모의 결정(`Decisions`)·선택(`selected`)이 구역 전체를 들고 있어
 * 쪽을 넘기거나 검색해도 체크가 남는다. 일괄 버튼(`actions`)도 보이는 쪽이 아니라 **구역 전체**에 적용된다 —
 * 그래서 검색 중이거나 쪽이 여럿이면 버튼 옆에 「구역 전체 N건에 적용」을 적어 오해를 막는다.
 */
export function PagedSection<T>({ title, rows, fields, renderRow, actions, children }: {
  title: string
  rows: readonly T[]
  /** 검색 대상 칸(논리명·물리명). 모듈 수준 상수 함수로 넘긴다. */
  fields: (row: T) => readonly (string | null | undefined)[]
  /** 행 하나 — `key` 를 단 `<li>` 를 돌려준다. */
  renderRow: (row: T) => ReactNode
  actions?: ReactNode
  /** 제목 아래 안내 문단. */
  children?: ReactNode
}) {
  const list = useListPage(rows, fields)
  const { view } = list
  const searching = list.query.trim() !== ''
  return (
    <section aria-label={title} className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title} ({formatCount(rows.length)})</h4>
        {actions !== undefined && rows.length > 0 && (
          <span className="flex items-center gap-1">
            {(searching || view.pageCount > 1) && (
              <span className="text-xs text-muted-foreground">구역 전체 {formatCount(rows.length)}건에 적용</span>
            )}
            {actions}
          </span>
        )}
      </div>
      {children}
      {rows.length > 0 && (
        <Input aria-label={`${title} 검색`} placeholder="논리명·물리명 검색" className="h-8"
          value={list.query} onChange={(e) => list.setQuery(e.target.value)} />
      )}
      {searching && view.total === 0 && (
        <p className="text-xs text-muted-foreground">검색 결과가 없습니다</p>
      )}
      <ul className="grid gap-1">{view.rows.map(renderRow)}</ul>
      <Pagination label={title} page={view.page} pageCount={view.pageCount} total={view.total}
        onPageChange={list.setPage} />
    </section>
  )
}
```

- [ ] **Step 4: 재동기화 탭을 바꾼다** — `apps/web/src/editor/resource-resync-tab.tsx` 를 통째로 바꾼다(적용 동작 `onApply` 는 **지금 그대로** 둔다 — 상한 가드 제거와 진행 표시는 Task 11 이다).

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyResyncPlan, planResync, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, resourcePayloadOf,
  resourceSecondaryName,
  type LibraryItem, type ProjectModel, type ResyncDecision, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { countActive, initialDecisions, overLimitMessage, setAllForStatus, type Decisions } from './resource-decisions.js'
import type { LibraryRow } from './resource-panel.js'
import { PagedSection } from '@/components/paged-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EMPTY_PLAN: ResyncPlan = {
  libraryId: '', entries: [], keptLocal: 0, keptSynced: 0, keptDetached: 0,
}

/** 구역 검색 칸 — 논리명 칸과 물리명 칸(core resourceSecondaryName). */
const ENTRY_FIELDS = (entry: ResyncEntry) => [entry.name, resourceSecondaryName(entry.kind, entry.nextPayload)]

function EntryLabel({ entry }: { entry: ResyncEntry }) {
  const physical = resourceSecondaryName(entry.kind, entry.nextPayload)
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
        {physical !== null && <span className="font-mono text-xs text-muted-foreground">{physical}</span>}
      </span>
      {entry.status !== 'added' && (
        <span className="text-xs text-muted-foreground">
          v{entry.fromVersion} → v{entry.version}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/** 화면 표시용 값 포맷 — null/undefined는 "(없음)", 객체·배열은 JSON으로 떨어뜨린다. */
function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined) return '(없음)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 충돌 항목의 프로젝트 현재 payload — origin 없는 신규(added)면 null. */
function currentProjectPayload(model: ProjectModel, entry: ResyncEntry): Record<string, unknown> | null {
  if (!entry.projectEntityId) return null
  const collection = model[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as Record<string, Record<string, unknown>>
  const entity = collection[entry.projectEntityId]
  if (!entity) return null
  return resourcePayloadOf(entry.kind, entity)
}

/**
 * 충돌 항목의 필드별 "현재(프로젝트) ↔ 원본" 비교. "프로젝트 유지"는 이 변경을 검토·거절했다고
 * 영구 기록해 다시 띄우지 않으므로, 값을 못 본 채 고르면 원본 개선을 영원히 놓친다.
 */
function ConflictValueDiff({ entry, model }: { entry: ResyncEntry; model: ProjectModel }) {
  const current = currentProjectPayload(model, entry)
  if (!current || entry.changedFields.length === 0) return null
  return (
    <ul className="grid gap-0.5 text-xs text-muted-foreground">
      {entry.changedFields.map((field) => (
        <li key={field}>
          <span className="font-medium text-foreground">{field}</span>
          {': 현재 '}
          <span>{formatConflictValue(current[field])}</span>
          {' → 원본 '}
          <span>{formatConflictValue(entry.nextPayload[field])}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * "공용 리소스" 다이얼로그의 가져오기(재동기화) 탭: 전역·조직 라이브러리를 프로젝트로
 * 가져오고 재동기화한다. 최초 가져오기는 "전 항목이 신규인 재동기화"라 코드 경로가 하나다.
 * 적용은 단일 producer → diffModels → model.mutate라 Revision 1건·undo 1회로 원복된다.
 *
 * 구역마다 검색·50건 페이지가 있고(`PagedSection`), 결정(`decisions`)은 구역 전체에 대해 여기 있다 —
 * 쪽을 넘겨도 체크가 남고 일괄 버튼은 구역 전체에 적용된다.
 */
export function ResourceResyncTab({ projectId, library }: { projectId: string; library: LibraryRow }) {
  const trpc = useTRPC()
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [decisions, setDecisions] = useState<Decisions>({})

  const items = useQuery(trpc.resource.items.list.queryOptions({ libraryId: library.id }))

  const plan = useMemo(() => {
    if (!items.data) return EMPTY_PLAN
    return planResync(model, library.id, items.data as LibraryItem[])
  }, [model, library.id, items.data])

  // 계획이 다시 계산되면(모델 변경·라이브러리 전환·항목 재조회) 결정을 초기값으로 되돌린다.
  useEffect(() => { setDecisions(initialDecisions(plan)) }, [plan])

  const sections = useMemo(() => ({
    added: plan.entries.filter((e) => e.status === 'added'),
    autoUpdate: plan.entries.filter((e) => e.status === 'auto-update'),
    conflicts: plan.entries.filter((e) => e.status === 'conflict'),
  }), [plan])
  const active = countActive(decisions)
  const setAll = (status: ResyncEntry['status'], decision: ResyncDecision) =>
    setDecisions((prev) => setAllForStatus(prev, plan, status, decision))

  const onApply = () => {
    if (active === 0) return
    const message = overLimitMessage(active)
    if (message !== null) { toast.error(message); return }
    const applied = decisions
    const currentPlan = plan
    void mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
      summary: `공용 리소스 재동기화 — ${library.name}`,
    })
  }

  const checkboxRow = (entry: ResyncEntry) => (
    <li key={entry.sourceId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      {canEdit
        ? (
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" aria-label={`${entry.name} 선택`}
                checked={decisions[entry.sourceId] === 'apply'}
                onChange={(e) => {
                  const next = e.target.checked ? 'apply' : 'defer'
                  setDecisions((prev) => ({ ...prev, [entry.sourceId]: next }))
                }} />
              <EntryLabel entry={entry} />
            </label>
          )
        : (
            <span className="flex flex-1 items-center gap-2"><EntryLabel entry={entry} /></span>
          )}
      {entry.nameClash && <Badge variant="outline" className="shrink-0">이름 중복</Badge>}
    </li>
  )

  const conflictRow = (entry: ResyncEntry) => (
    <li key={entry.sourceId} className="grid gap-1 rounded border px-2 py-1.5">
      <EntryLabel entry={entry} />
      <ConflictValueDiff entry={entry} model={model} />
      {canEdit && (
        <div className="flex flex-wrap gap-3 text-sm">
          {([
            ['defer', '보류'], ['keep', '프로젝트 유지'], ['apply', '원본 반영'],
          ] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1">
              <input type="radio" aria-label={`${entry.name} ${label}`}
                name={`conflict-${entry.sourceId}`}
                checked={(decisions[entry.sourceId] ?? 'defer') === value}
                onChange={() =>
                  setDecisions((prev) => ({ ...prev, [entry.sourceId]: value }))} />
              {label}
            </label>
          ))}
        </div>
      )}
    </li>
  )

  if (items.isError) {
    return <p role="alert" className="text-destructive">{items.error.message}</p>
  }

  return (
    <>
      <PagedSection title="신규 추가" rows={sections.added} fields={ENTRY_FIELDS} renderRow={checkboxRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('added', 'apply')}>모두 선택</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('added', 'defer')}>모두 해제</Button>
          </>
        ) : undefined} />

      <PagedSection title="자동 갱신" rows={sections.autoUpdate} fields={ENTRY_FIELDS} renderRow={checkboxRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('auto-update', 'apply')}>모두 선택</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('auto-update', 'defer')}>모두 해제</Button>
          </>
        ) : undefined} />

      <PagedSection title="충돌" rows={sections.conflicts} fields={ENTRY_FIELDS} renderRow={conflictRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('conflict', 'apply')}>모두 원본 반영</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('conflict', 'keep')}>모두 프로젝트 유지</Button>
          </>
        ) : undefined}>
        {canEdit && sections.conflicts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            "프로젝트 유지"는 내용을 그대로 두고 이 변경을 검토했다고 기록합니다(다음에 다시 뜨지 않습니다).
            "보류"는 아무것도 기록하지 않아 다음에 다시 뜹니다.
          </p>
        )}
      </PagedSection>

      <section className="grid gap-1 text-xs text-muted-foreground">
        <h4 className="text-sm font-semibold text-foreground">유지</h4>
        <span>최신 상태 {formatCount(plan.keptSynced)}건 · 프로젝트 자체 항목 {formatCount(plan.keptLocal)}건</span>
        {plan.keptDetached > 0 && (
          <span>원본에서 삭제된 항목 {formatCount(plan.keptDetached)}건 — 프로젝트 사본은 그대로 둡니다.</span>
        )}
      </section>

      {canEdit && (
        <div className="flex items-center justify-end gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">처리 대상 {formatCount(active)}건</span>
          <Button type="button" disabled={active === 0} onClick={onApply}>적용</Button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: 승격 목록을 바꾼다** — `apps/web/src/components/promote-entry-list.tsx` 를 통째로 바꾼다.

```tsx
import { useMemo } from 'react'
import {
  RESOURCE_KIND_LABEL, danglingDomain, resourceSecondaryName, type PromoteEntry, type PromoteStatus,
} from '@erdd/core'
import { formatCount } from '@/lib/format'
import { PagedSection } from '@/components/paged-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

/**
 * 원본이 앞선 항목(`sourceBehind`)의 배지 문구 — 화면마다 할 수 있는 행동이 달라 여기서 한 번에 고른다.
 * 요청자·직접 승격자는 재동기화로 받을 수 있지만, 승인자는 요청 프로젝트를 재동기화할 수 없다.
 * 승인자 문구는 「언제」 앞섰는지 말하지 않는다 — `sourceBehind` 는 승인 시점의 프로젝트 origin 과
 * 원본 버전의 비교라, 요청자가 배지를 무시하고 직접 켠(요청 당시 이미 뒤처진) 항목에도 붙는다.
 */
const SOURCE_BEHIND_NOTICE = {
  promote: '원본이 더 새롭습니다 — 먼저 가져오기(재동기화)로 받으세요',
  approve: '원본이 요청자가 받은 버전보다 새롭습니다 — 승인하면 최신 원본을 요청자의 값으로 되돌립니다',
} as const

/**
 * 구역 검색 칸 — 논리명 칸과 물리명 칸. 물리명은 계획에 이미 실린 payload(프로젝트 엔티티를 라이브러리 공간으로
 * 투영한 값 — 단어 약어·용어 물리명은 투영에서 바뀌지 않는다)에서 읽는다. 조직 승인 화면에는 모델 store 가 없다.
 */
const ENTRY_FIELDS = (entry: PromoteEntry) => [entry.name, resourceSecondaryName(entry.kind, entry.payload)]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  const physical = resourceSecondaryName(entry.kind, entry.payload)
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
        {physical !== null && <span className="font-mono text-xs text-muted-foreground">{physical}</span>}
      </span>
      {entry.targetVersion !== null && (
        <span className="text-xs text-muted-foreground">
          v{entry.targetVersion} → v{entry.targetVersion + 1}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/**
 * 승격 계획의 3구역 목록. 승격 탭(프로젝트)과 승인 다이얼로그(조직)가 함께 쓴다.
 *
 * **에디터 store를 참조하지 않는다** — 조직 화면에는 프로젝트 모델 store가 없고,
 * 계획은 거기서 서버가 계산해 내려준다. 구역마다 검색·50건 페이지가 있고 선택(`selected`)은 부모가 구역 전체에
 * 대해 들고 있다 — 쪽을 넘겨도 체크가 남고 「모두 선택/해제」는 구역 전체에 적용된다.
 */
export function PromoteEntryList({
  audience, entries, selected, onToggle, onSetAll, syncedCount,
}: {
  /** 승격 탭(`promote`)인지 조직 승인 다이얼로그(`approve`)인지 — 배지 문구를 고른다. */
  audience: keyof typeof SOURCE_BEHIND_NOTICE
  entries: readonly PromoteEntry[]
  selected: ReadonlySet<string>
  onToggle: (entityId: string, on: boolean) => void
  onSetAll: (status: PromoteStatus, on: boolean) => void
  /** 승격 탭에서만 넘긴다(승인 화면에는 의미가 없다). */
  syncedCount?: number
}) {
  const byStatus = useMemo(
    () => new Map(SECTIONS.map(({ status }) => [status, entries.filter((entry) => entry.status === status)])),
    [entries],
  )
  const row = (entry: PromoteEntry) => (
    <li key={entry.entityId}
      className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      <label className="flex flex-1 items-center gap-2">
        <input type="checkbox" aria-label={`${entry.name} 선택`}
          checked={selected.has(entry.entityId)}
          onChange={(e) => onToggle(entry.entityId, e.target.checked)} />
        <EntryLabel entry={entry} />
      </label>
      {/* 문장이 길어 좁은 패널에서 잘리지 않게 줄바꿈을 허용한다. */}
      {entry.sourceBehind && (
        <Badge variant="outline" className="max-w-[60%] shrink whitespace-normal">
          {SOURCE_BEHIND_NOTICE[audience]}
        </Badge>
      )}
      {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
        <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
      )}
    </li>
  )

  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = byStatus.get(status) ?? []
        return (
          <PagedSection key={status} title={title} rows={rows} fields={ENTRY_FIELDS} renderRow={row}
            actions={(
              <>
                <Button size="sm" variant="ghost" onClick={() => onSetAll(status, true)}>모두 선택</Button>
                <Button size="sm" variant="ghost" onClick={() => onSetAll(status, false)}>모두 해제</Button>
              </>
            )}>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
          </PagedSection>
        )
      })}

      {syncedCount !== undefined && (
        <section className="grid gap-1 text-xs text-muted-foreground">
          <h4 className="text-sm font-semibold text-foreground">유지</h4>
          <span>이미 이 라이브러리와 같은 항목 {formatCount(syncedCount)}건</span>
        </section>
      )}
    </>
  )
}
```

- [ ] **Step 6: 공용 리소스 패널의 탭과 개수를 바꾼다** — `apps/web/src/editor/resource-panel.tsx`

import 에 더한다:

```ts
import { formatCount } from '@/lib/format'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
```

`{canPromote && ( <div role="tablist" …> … </div> )}` 블록을 이것으로 바꾼다:

```tsx
        {canPromote && (
          <Tabs value={tab} onValueChange={(value) => switchTab(value as Tab)}>
            <TabsList aria-label="공용 리소스 방향">
              <TabsTrigger value="resync">가져오기</TabsTrigger>
              <TabsTrigger value="promote">조직으로 승격</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
```

라이브러리 버튼의 개수 줄을 이것으로 바꾼다:

```tsx
                  {lib.scope === 'global' ? '전역' : '조직'} · 항목 {formatCount(lib.itemCount)}개
```

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/paged-section.test.tsx src/editor/resource-panel.test.tsx src/editor/resource-promote-tab.test.tsx src/components/promote-entry-list.test.tsx src/components/promotion-requests-section.test.tsx`
Expected: PASS(개수 확인 — 기존 테스트의 `신규 추가 (2)`·`tab` 역할 단언도 그대로 통과해야 한다). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/components/paged-section.tsx apps/web/src/components/paged-section.test.tsx apps/web/src/editor/resource-resync-tab.tsx apps/web/src/components/promote-entry-list.tsx apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-panel.test.tsx apps/web/src/components/promote-entry-list.test.tsx && git commit -m "feat(web): 재동기화·승격 구역에 검색·페이지와 물리명을 더하고 공용 리소스 탭을 Tabs 로 바꾼다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/paged-section.tsx apps/web/src/components/paged-section.test.tsx apps/web/src/editor/resource-resync-tab.tsx apps/web/src/components/promote-entry-list.tsx apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-panel.test.tsx apps/web/src/components/promote-entry-list.test.tsx
```

- [ ] **Step 9: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. `resource-resync-tab.tsx` 의 `setAll` 을 「보이는 쪽만」으로 흉내 낸다 — `setAllForStatus(prev, plan, …)` 의 `plan` 을 `{ ...plan, entries: plan.entries.slice(0, 10) }` 로 → 「검색 중 「모두 해제」는…」 FAIL 기대.
  2. `PagedSection` 의 「구역 전체」 안내 조건을 `false` 로 → `paged-section` 안내 테스트 FAIL 기대.
  3. `EntryLabel` 두 곳의 `physical` 줄을 지운다 → 물리명 단언 FAIL 기대.
  복구 후 `git status --short` clean.

---
### Task 11: web — 5,000건 사전 차단 넷을 걷고 진행을 보인다

설계 5절 「걷는 것」과 「실행 중 표시」. 나눔은 Task 8 의 저수준 경로가 하므로 소비처는 가드를 지우고 `onProgress` 로 진행만 보인다.

- 재동기화 탭·Excel 사전 가져오기·DDL 가져오기는 다이얼로그가 떠 있는 채 적용하므로 **적용 버튼을 잠그고 버튼에 「적용 중… 2 / 4」**를 보인다.
- ⚠️ **일괄 삭제는 다이얼로그에 진행을 보일 수 없다(코드 현실).** `BulkDeleteDialog` 는 제출과 함께 닫히고(지금 동작), 그 다이얼로그를 띄운 `BulkPanel` 은 낙관적 삭제로 선택이 비는 순간 통째로 사라진다(`project.tsx` 가 선택 2개 이상일 때만 그린다). 그래서 일괄 삭제의 진행은 **토스트**(`toast.loading(formatProgress(…), { id })`, 끝나면 `toast.dismiss(id)`)로 알린다. 이 차이를 태스크 보고에 적는다.

**Files:**
- Modify: `apps/web/src/editor/resource-decisions.ts`, `resource-resync-tab.tsx`, `dict-import-section.tsx`, `dict-import-edits.ts`(주석), `bulk-panel.tsx`, `ddl-import-dialog.tsx`, `apps/web/src/testing/fixtures.ts`(주석)
- Test: `resource-decisions.test.ts`, `resource-panel.test.tsx`, `dict-import-section.test.tsx`, `bulk-panel.test.tsx`, `toolbar.test.tsx`, `ddl-import-dialog.test.tsx`

**Interfaces:**
- Consumes: `useModelMutation` 의 `onProgress`(Task 8), `formatCount`·`formatProgress`(Task 6).
- Produces: `overLimitMessage` 삭제(Task 12 가 승격 탭에서 마지막 쓰임을 지운다 — **이 태스크 커밋 시점에 `resource-promote-tab.tsx` 가 아직 `overLimitMessage` 를 import 하므로 함수는 Task 12 에서 지운다.** 이 태스크는 재동기화 탭의 호출만 걷는다).

- [ ] **Step 1: 테스트를 고친다(상한 단언 → 「넘어도 적용되고 조각으로 나뉘어 간다」, 진행 표시 추가)**

`resource-panel.test.tsx`:
- import 에 `act` 를 더한다(`import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'`).
- 파일 위의 `vi.mock('./resource-decisions.js', …)` 블록과 `import { overLimitMessage } from './resource-decisions.js'` 줄, 그리고 테스트 「op 상한 가드가 걸리면 적용을 눌러도 mutate를 부르지 않고 오류 토스트를 띄운다」를 **지운다**(Task 12 가 승격 탭 테스트에서 같은 것을 지운다 — 이 파일은 재동기화 탭만 본다).
- `describe('ResourcePanel', …)` 안 끝에 더한다(`manyItems` 는 Task 10 에서 이미 이 describe 안에 있다):

```tsx
  it('5,000건을 넘는 선택도 막지 않고 적용한다 — 나눔은 저수준 경로가 한다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: manyItems(5001) }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(toast.error).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    expect(Object.keys((producer(createEmptyModel()) as ProjectModel).words)).toHaveLength(5001)
  }, 30000)

  it('나눠 적용하는 동안 적용 버튼이 잠기고 「적용 중… 1 / 2」를 보인다', async () => {
    let finish!: (r: string) => void
    mutate.mockImplementationOnce((_producer: unknown, opts: { onProgress?: (d: number, t: number) => void }) => {
      opts.onProgress?.(1, 2)
      return new Promise((resolve) => { finish = resolve })
    })
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' })).toBeDisabled()
    await act(async () => { finish('applied') })
    expect(await screen.findByRole('button', { name: '적용' })).toBeInTheDocument()
  })

  it('조각 적용이 실패로 끝나면 진행 표시가 걷히고 적용 버튼이 다시 열린다', async () => {
    mutate.mockImplementationOnce(async (_producer: unknown, opts: { onProgress?: (d: number, t: number) => void }) => {
      opts.onProgress?.(1, 2)
      return 'error'
    })
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '적용' })).toBeEnabled())
    expect(screen.queryByText(/적용 중…/)).toBeNull()
  })
```

`resource-decisions.test.ts`: `describe('overLimitMessage', …)` 블록 전체와 import 에서 `overLimitMessage`·(쓰이지 않게 되면) `MAX_OPS_PER_MUTATION` 을 지운다 — 함수 자체는 Task 12 에서 지우므로 여기서는 **테스트만** 먼저 지운다(Task 12 에서 함수가 사라져도 깨질 테스트가 남지 않게).

`dict-import-section.test.tsx`:
- `mutate` 선언을 인자를 받는 모양으로 바꾼다:

```ts
const mutate = vi.fn(
  (_producer?: unknown, _opts?: { summary?: string; onProgress?: (done: number, total: number) => void }): Promise<ModelMutationResult> =>
    Promise.resolve('applied'),
)
```

- 테스트 「서버 op 한도를 넘으면 가져오기를 막고 파일 분할을 안내한다」를 이것으로 바꾼다(import 에 `formatCount` 를 더한다: `import { formatCount } from '@/lib/format'`):

```tsx
  it('5,000건을 넘어도 가져오기를 막지 않는다 — 나눔은 저수준 경로가 한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderSection()
    const rows = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, (_, i) => [`단어${i}`, `W${i}`, '', ''])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), await xlsxFile([wordsSheet(rows)]))
    await waitFor(
      () => expect(screen.getByText(`적용 대상 ${formatCount(MAX_OPS_PER_MUTATION + 1)}건`)).toBeInTheDocument(),
      { timeout: 20000 },
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(importButton()).toBeEnabled()
    await userEvent.click(importButton())
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  }, 60000)

  it('나눠 보내는 동안 버튼이 잠기고 진행을 보인다', async () => {
    const pending = deferred<ModelMutationResult>()
    mutate.mockImplementationOnce((_producer, opts) => {
      opts?.onProgress?.(1, 2)
      return pending.promise
    })
    await uploadOneWord()
    await userEvent.click(importButton())
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' })).toBeDisabled()
    await act(async () => { pending.resolve('applied') })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
  })
```

`bulk-panel.test.tsx`: import 에 `import { toast } from 'sonner'` 를 더하고, 테스트 「삭제 op가 상한을 넘으면 확인 다이얼로그가 삭제를 막고 이유를 알린다」를 이것으로 바꾼다:

```tsx
  it('삭제 op 가 상한을 넘어도 막지 않고 조각으로 나눠 보내며 진행을 토스트로 알린다', async () => {
    // 확인 창은 제출과 함께 닫히고 이 패널도 선택이 비면서 사라지므로 진행은 창이 아니라 토스트로 보인다.
    const calls: { ops: unknown[]; summary?: string }[] = []
    let seq = 1
    mockTrpcFetch({
      'model.mutate': (input) => {
        calls.push(input as { ops: unknown[]; summary?: string })
        seq += 1
        return { data: { seq } }
      },
    })
    const loading = vi.spyOn(toast, 'loading')
    useEditorStore.getState().setLoaded(modelOverOpCap(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(/한 번에 지우기에 너무 많습니다/)).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.summary)).toEqual(['테이블 삭제 (2개) (1/2)', '테이블 삭제 (2개) (2/2)'])
    expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(0)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(loading).toHaveBeenCalledWith('적용 중… 1 / 2', expect.objectContaining({ id: expect.any(String) }))
    loading.mockRestore()
  })
```

`toolbar.test.tsx`: 테스트 「툴바 경로도 op 상한 가드를 지난다 — 상한을 넘으면 삭제를 막는다」를 이것으로 바꾼다(파일에 이미 있는 `mockModelMutate()`·`countModelMutate()` 를 쓴다):

```tsx
  it('툴바 경로도 같은 확인 창을 지난다 — 상한을 넘어도 삭제되고 조각으로 나뉘어 간다', async () => {
    // 툴바는 일괄 패널과 **같은 다이얼로그**를 쓴다. 이 케이스가 없으면 누군가 툴바에 다이얼로그를
    // 복제해 옛 상한 가드를 되살려도 아무 테스트도 실패하지 않는다.
    const fetchMock = mockModelMutate()
    useEditorStore.getState().setLoaded(modelOverOpCap(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderToolbar()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(/한 번에 지우기에 너무 많습니다/)).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(0))
    await waitFor(() => expect(countModelMutate(fetchMock)).toBe(2))
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })
```

`ddl-import-dialog.test.tsx`: `renderDialog` 가 `onOpenChange` 를 받게 바꾸고(`function renderDialog(onOpenChange: (open: boolean) => void = () => {})` 와 `<DdlImportDialog … onOpenChange={onOpenChange} />`), describe 안 끝에 더한다:

```tsx
  it('5,000건을 넘는 가져오기는 막지 않고 나눠 보내며 버튼에 진행을 보인다', async () => {
    const calls: { ops: unknown[]; summary?: string }[] = []
    let release!: () => void
    mockTrpcFetch({
      'model.mutate': (input) => {
        calls.push(input as { ops: unknown[]; summary?: string })
        if (calls.length === 1) return { data: { seq: 2 } }
        return new Promise((resolve) => { release = () => resolve({ data: { seq: 3 } }) })
      },
    })
    const onOpenChange = vi.fn()
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog(onOpenChange)
    // 테이블 1 + 컬럼 5,001 = op 5,002 → 조각 5,000 + 2. 테이블을 하나로 두어 자동 배치 비용을 피한다.
    const columns = Array.from({ length: 5001 }, (_, i) => `C${i} int`).join(', ')
    fireEvent.change(screen.getByRole('textbox', { name: 'DDL' }), { target: { value: `CREATE TABLE T (${columns});` } })
    const apply = await screen.findByRole('button', { name: '1개 테이블 만들기' }, { timeout: 30000 })
    expect(screen.queryByText(/한 번에 가져올 수 있는 양을 넘었습니다/)).toBeNull()
    await userEvent.click(apply)
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' }, { timeout: 30000 })).toBeDisabled()
    release()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 30000 })
    expect(calls.map((c) => c.ops.length)).toEqual([5000, 2])
    expect(calls.map((c) => c.summary)).toEqual(['DDL 가져오기 (1/2)', 'DDL 가져오기 (2/2)'])
  }, 60000)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-decisions.test.ts src/editor/resource-panel.test.tsx src/editor/dict-import-section.test.tsx src/editor/bulk-panel.test.tsx src/editor/toolbar.test.tsx src/editor/ddl-import-dialog.test.tsx`
Expected: 새·바뀐 케이스가 FAIL(가드가 막는다, 진행 문구 없음). DDL 케이스는 `1개 테이블 만들기` 가 잠겨 있어 FAIL.

- [ ] **Step 3: 재동기화 탭** — `resource-resync-tab.tsx`

import 를 고친다(`useRef` 추가, `toast`·`overLimitMessage` 제거, `formatProgress` 추가):

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCount, formatProgress } from '@/lib/format'
import { countActive, initialDecisions, setAllForStatus, type Decisions } from './resource-decisions.js'
```
(`import { toast } from 'sonner'` 줄은 지운다.)

컴포넌트 주석의 마지막 문장 「적용은 단일 producer → diffModels → model.mutate라 Revision 1건·undo 1회로 원복된다.」를 이것으로 바꾼다:

```ts
 * 적용은 단일 producer → diffModels → model.mutate 이고 실행 취소 한 번으로 원복된다. 5,000건을 넘으면
 * 저수준 경로가 조각으로 나눠 보내 Revision 은 조각 수만큼 쌓인다(guides/data-layer.md 「한 요청의 op 상한은 …」)
 * — 이 탭은 나눔을 모르고 진행(`onProgress`)만 보인다.
```

`const [decisions, setDecisions] = …` 아래에 더한다:

```ts
  // 조각이 둘 이상일 때만 채워진다(저수준 경로가 onProgress 를 그때만 부른다). ref 는 리렌더 전 재진입을 막는다.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const applyingRef = useRef(false)
```

`onApply` 를 이것으로 바꾼다:

```ts
  const onApply = async () => {
    if (active === 0 || applyingRef.current) return
    applyingRef.current = true
    const applied = decisions
    const currentPlan = plan
    try {
      await mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
        summary: `공용 리소스 재동기화 — ${library.name}`,
        onProgress: (done, total) => setProgress({ done, total }),
      })
    } finally {
      applyingRef.current = false
      setProgress(null)
    }
  }
```

적용 버튼을 이것으로 바꾼다:

```tsx
          <Button type="button" disabled={active === 0 || progress !== null} onClick={() => { void onApply() }}>
            {progress !== null ? formatProgress(progress.done, progress.total) : '적용'}
          </Button>
```

- [ ] **Step 4: Excel 사전 가져오기** — `dict-import-section.tsx`

import 에서 `MAX_OPS_PER_MUTATION` 을 빼고 `import { formatCount, formatProgress } from '@/lib/format'` 를 더한다. `importing` 상태 아래에 더한다:

```ts
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
```

`onImport` 의 주석 첫 문장과 본문을 이것으로 바꾼다:

```ts
  /**
   * 사전 전체를 편집 1건으로 보낸다(실행 취소 한 번으로 원복). 5,000건을 넘으면 저수준 경로가 조각으로 나눠
   * 보내므로 여기서 막지 않는다(guides/data-layer.md 「한 요청의 op 상한은 …」) — 진행만 버튼에 보인다.
   * 서버가 거절할 수도 있으므로 결과를 기다렸다가 성공했을 때만 완료를 알리고 미리보기를 치운다 — 실패하면
   * 미리보기를 남겨 사용자가 그대로 다시 시도할 수 있게 한다.
   *
   * 덮어쓰기인데 파일 내용이 사전과 같으면 보낼 op이 없어 mutation이 noop으로 끝난다. 이때는
   * 아무도 알려 주지 않으므로 여기서 안내한다("눌렀는데 아무 일도 없는" 상태 방지).
   */
  const onImport = async () => {
    if (!plan || importingRef.current) return
    const current = plan
    const currentMode = mode
    const counts = countApplied(current, currentMode)
    const summary = `Excel 사전 가져오기 (단어 ${formatCount(counts.words)} · 용어 ${formatCount(counts.terms)} · 도메인 ${formatCount(counts.domains)})`
    importingRef.current = true
    setImporting(true)
    try {
      const result = await mutate((m) => applyDictImport(m, current, currentMode, newId), {
        summary,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      if (result === 'error') return
      setPlan(null)
      setFileName('')
      if (result === 'noop') toast.info('파일 내용이 현재 사전과 같아 바뀐 항목이 없습니다')
      else toast.success(summary)
    } finally {
      importingRef.current = false
      setImporting(false)
      setProgress(null)
    }
  }
```

`tooManyOps` 선언과 그 위 두 줄 주석, `{tooManyOps && ( <p role="alert" …> … </p> )}` 블록을 지운다. 「적용 대상」 줄과 버튼을 이것으로 바꾼다:

```tsx
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">적용 대상 {formatCount(appliedTotal)}건</p>
                <Button
                  type="button" disabled={nothingToApply || importing}
                  onClick={() => { void onImport() }}
                >
                  {progress !== null
                    ? formatProgress(progress.done, progress.total)
                    : <><Upload /> 가져오기 실행</>}
                </Button>
              </div>
```

`dict-import-edits.ts` 의 `applyDictImport` 주석 마지막 줄 「한 producer 안에서 3종을 모두 처리하므로 Revision 1건, undo 한 번으로 원복된다.」를 이것으로 바꾼다:

```ts
 * 한 producer 안에서 3종을 모두 처리하므로 편집 1건 — 실행 취소 한 번으로 원복된다(5,000건을 넘으면 Revision 은
 * 조각 수만큼 쌓인다 — guides/data-layer.md 「한 요청의 op 상한은 …」).
```

- [ ] **Step 5: 일괄 삭제** — `bulk-panel.tsx`

import 를 바꾼다:

```ts
import { toast } from 'sonner'
import {
  deleteTableCascade, setTableGroup, type ProjectModel,
} from '@erdd/core'
import { formatCount, formatProgress } from '@/lib/format'
```

`deleteOpCount` 함수와 그 주석을 지운다(더 쓰이지 않는다). `BulkDeleteDialog` 의 주석 둘째 문단(「op 상한 가드도 여기 둔다. …」)을 이것으로 바꾼다:

```ts
 * 5,000건을 넘는 삭제도 막지 않는다 — 저수준 경로가 조각으로 나눠 보낸다(guides/data-layer.md 「한 요청의
 * op 상한은 …」). 이 창은 제출과 함께 닫히고, 이 창을 띄운 일괄 패널도 낙관적 삭제로 선택이 비는 순간
 * 사라지므로 조각 진행은 창이 아니라 토스트로 알린다.
```

본문에서 `opCount`·`tooBig` 선언을 지우고 `onDelete` 를 이것으로 바꾼다:

```ts
  const onDelete = () => {
    const doomed = [...ids]
    const progressToast = `bulk-delete-${Date.now()}`
    onOpenChange(false)
    void mutate((m) => doomed.reduce((acc, id) => deleteTableCascade(acc, id), m), {
      summary: `테이블 삭제 (${formatCount(doomed.length)}개)`,
      onProgress: (done, total) => {
        if (done < total) toast.loading(formatProgress(done, total), { id: progressToast })
        else toast.dismiss(progressToast)
      },
    }).finally(() => toast.dismiss(progressToast))
  }
```

설명 문구의 숫자를 천 단위로:

```tsx
          <DialogDescription>
            테이블 {formatCount(cascade.tables)}개와 관계 {formatCount(cascade.relationships)}개가 삭제됩니다.
            컬럼 {formatCount(cascade.columns)}개와 인덱스 {formatCount(cascade.indexes)}개도 함께 사라집니다.
          </DialogDescription>
```

`{tooBig && ( … )}` 블록을 지우고 삭제 버튼의 `disabled={tooBig}` 를 지운다(`<Button variant="destructive" onClick={onDelete}>삭제</Button>`).

`apps/web/src/testing/fixtures.ts` 의 `modelOverOpCap` 주석을 이것으로 바꾼다:

```ts
/**
 * 테스트용: 삭제 op 총수가 한 요청의 상한(MAX_OPS_PER_MUTATION)을 넘는 모델. 테이블 수는 그대로 두고 컬럼만 붙인다.
 *
 * 여기 두는 이유: 일괄 삭제 확인 창(`BulkDeleteDialog`)을 **툴바와 일괄 패널이 공유**하고, 두 진입점의 테스트가
 * 「상한을 넘어도 조각으로 나뉘어 간다」를 같은 픽스처로 봐야 한쪽만 옛 가드로 돌아가도 잡힌다.
 */
```

- [ ] **Step 6: DDL 가져오기** — `ddl-import-dialog.tsx`

import 에서 `MAX_OPS_PER_MUTATION` 을 빼고 `import { formatProgress } from '@/lib/format'` 을 더한다. 컴포넌트 위 주석의 「적용하면 단일 mutation(Revision 1건)으로 반영한다.」를 「적용하면 편집 1건으로 반영한다(5,000건을 넘으면 저수준 경로가 조각으로 나눠 보낸다 — guides/data-layer.md 「한 요청의 op 상한은 …」).」로, 「방언 선택·미리보기·op 상한·적용은 완전히 공유한다」를 「방언 선택·미리보기·적용은 완전히 공유한다」로 바꾼다.

`const overLimit = …` 줄을 지우고 그 자리에 더한다:

```ts
  // 적용 중에는 제출한 계획을 그대로 보인다 — 낙관적 반영으로 모델이 바뀌면 plan 이 다시 계산돼
  // 방금 만든 테이블이 전부 「이름이 겹침」으로 보인다. progress 는 조각이 둘 이상일 때만 채워진다.
  const [applying, setApplying] = useState<{
    plan: NonNullable<typeof plan>; progress: { done: number; total: number } | null
  } | null>(null)
  const shown = applying?.plan ?? plan
```

`onApply` 를 이것으로 바꾼다:

```ts
  const onApply = async () => {
    if (plan === null || applying !== null) return
    const captured = plan                       // producer 진입 전에 캡처한다(마이크로태스크 지연 대비)
    const summary = format === 'ddl' ? 'DDL 가져오기' : 'DBML 가져오기'
    setApplying({ plan: captured, progress: null })
    try {
      const r = await mutate((m) => applyDdlImport(m, captured, newId), {
        summary,
        onProgress: (done, total) => setApplying({ plan: captured, progress: { done, total } }),
      })
      if (r !== 'applied') return
      // ⚠️ **모델 변경 뒤의 두 번째 동작이다** — 프로젝트 설정은 op 로그 밖이라 `applyDdlImport` 에 섞으면
      // 「편집 1건 = 실행 취소 1회」가 반쪽이 된다(설정은 되돌아가지 않는다).
      if (canApplyOption && applyOption && captured.tableOptions !== null) {
        await updateProject.mutateAsync({
          projectId, tableOptions: { ...tableOptions, [dialect]: captured.tableOptions },
        })
      }
      onOpenChange(false); setText('')
    } finally {
      setApplying(null)
    }
  }
```

`columnCount`·`indexCount` 계산과 미리보기 JSX 에서 `plan` 을 **`shown`** 으로 바꾼다(`{plan !== null && (` → `{shown !== null && (`, `plan.tables.length` → `shown.tables.length` 등 미리보기 안의 모든 `plan.` 참조). `planOption`·`canApplyOption` 계산은 `plan` 그대로 둔다(체크박스 판정은 지금 모델 기준). `{overLimit && ( … )}` 블록을 지우고 적용 버튼을 이것으로 바꾼다:

```tsx
            <DialogFooter>
              <Button type="button" disabled={applying !== null} onClick={() => { void onApply() }}>
                {applying?.progress
                  ? formatProgress(applying.progress.done, applying.progress.total)
                  : `${shown.tables.length}개 테이블 만들기`}
              </Button>
            </DialogFooter>
```

`resource-decisions.ts` 의 `countActive` 주석 「op 상한 가드와 버튼 활성 판정에 쓴다.」를 「적용 버튼 활성 판정과 처리 대상 표시에 쓴다.」로 바꾼다(`overLimitMessage` 함수 삭제는 Task 12).

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-decisions.test.ts src/editor/resource-panel.test.tsx src/editor/dict-import-section.test.tsx src/editor/bulk-panel.test.tsx src/editor/toolbar.test.tsx src/editor/ddl-import-dialog.test.tsx src/editor/use-shortcuts.test.tsx`
Expected: PASS(개수 확인). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/resource-decisions.ts apps/web/src/editor/resource-decisions.test.ts apps/web/src/editor/resource-resync-tab.tsx apps/web/src/editor/resource-panel.test.tsx apps/web/src/editor/dict-import-section.tsx apps/web/src/editor/dict-import-section.test.tsx apps/web/src/editor/dict-import-edits.ts apps/web/src/editor/bulk-panel.tsx apps/web/src/editor/bulk-panel.test.tsx apps/web/src/editor/toolbar.test.tsx apps/web/src/editor/ddl-import-dialog.tsx apps/web/src/editor/ddl-import-dialog.test.tsx apps/web/src/testing/fixtures.ts && git commit -m "feat(web): 재동기화·Excel 사전·일괄 삭제·DDL 가져오기의 5,000건 차단을 걷고 나눠 적용 진행을 보인다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/editor/resource-decisions.ts apps/web/src/editor/resource-decisions.test.ts apps/web/src/editor/resource-resync-tab.tsx apps/web/src/editor/resource-panel.test.tsx apps/web/src/editor/dict-import-section.tsx apps/web/src/editor/dict-import-section.test.tsx apps/web/src/editor/dict-import-edits.ts apps/web/src/editor/bulk-panel.tsx apps/web/src/editor/bulk-panel.test.tsx apps/web/src/editor/toolbar.test.tsx apps/web/src/editor/ddl-import-dialog.tsx apps/web/src/editor/ddl-import-dialog.test.tsx apps/web/src/testing/fixtures.ts
```

- [ ] **Step 9: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. 재동기화 탭 `onApply` 의 `finally` 에서 `setProgress(null)` 을 뺀다 → 「조각 적용이 실패로 끝나면…」 FAIL 기대.
  2. 재동기화 탭 버튼의 `|| progress !== null` 을 뺀다 → 「나눠 적용하는 동안…」 FAIL 기대(버튼이 잠기지 않는다).
  3. 일괄 삭제 `onProgress` 를 빼고 부른다 → 「…진행을 토스트로 알린다」 FAIL 기대.
  4. DDL `onProgress` 를 빼고 부른다 → DDL 케이스 FAIL 기대.
  5. Excel 사전 버튼에 `disabled={… || progress !== null}` 이 없어도 `importing` 이 잠그므로 진행 문구만 본다 — `progress !== null ? …` 분기를 지워 「나눠 보내는 동안…」 FAIL 을 확인한다.
  복구 후 `git status --short` clean.

---

### Task 12: web — 승격을 5,000건씩 나눠 부르고 요청 상한 가드를 걷는다

**Files:**
- Create: `apps/web/src/lib/promote-chunks.ts`, `apps/web/src/lib/promote-chunks.test.ts`
- Modify: `apps/web/src/lib/promote-selection.ts`(`promoteSummary` 천 단위), `apps/web/src/editor/resource-promote-tab.tsx`, `apps/web/src/editor/resource-decisions.ts`(`overLimitMessage` 삭제)
- Test: `apps/web/src/editor/resource-promote-tab.test.tsx`, `apps/web/src/lib/promote-selection.test.ts`(바뀌는 단언이 있으면)

**Interfaces:**
- Consumes: `resource.promote`(입력 `entries` 상한 5,000 그대로), `MAX_OPS_PER_MUTATION`, `formatCount`·`formatProgress`.
- Produces:
  - `type PromoteRequestEntry = { entityId: string; expectedStatus: PromoteStatus; expectedTargetItemId: string | null; expectedTargetVersion: number | null }`
  - `toPromoteRequest(entry: PromoteEntry): PromoteRequestEntry`
  - `type PromoteRunResult = { outcome: { inserted: number; updated: number; skipped: unknown[] }; done: number; total: number; error: unknown }` — 성공이면 `error === null`.
  - `promoteInChunks(entries: readonly PromoteRequestEntry[], send: (chunk: PromoteRequestEntry[]) => Promise<{ inserted: number; updated: number; skipped: readonly unknown[] }>, onProgress?: (done: number, total: number) => void): Promise<PromoteRunResult>` — 받은 순서 그대로 5,000씩 자르고, 실패한 조각에서 멈추며 **던지지 않는다.** `onProgress` 는 조각이 둘 이상일 때만.
  - `promoteFailureMessage(requested: number, run: PromoteRunResult): string` — `done === 0` 이면 오류 문구 그대로, 아니면 `${formatCount(requested)}건 중 ${formatCount(inserted + updated)}건 승격했습니다 — ${오류}`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/web/src/lib/promote-chunks.test.ts
import { describe, expect, it, vi } from 'vitest'
import { MAX_OPS_PER_MUTATION } from '@erdd/core'
import { promoteFailureMessage, promoteInChunks, type PromoteRequestEntry } from './promote-chunks'

const req = (i: number): PromoteRequestEntry => ({
  entityId: `e${i}`, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
})
const reqs = (n: number) => Array.from({ length: n }, (_, i) => req(i))

describe('promoteInChunks', () => {
  it('받은 순서 그대로 5,000씩 차례로 보내고 결과를 합친다', async () => {
    const send = vi.fn(async (chunk: PromoteRequestEntry[]) => ({
      inserted: chunk.length, updated: 0, skipped: chunk.length === 1 ? [{ entityId: 'x', reason: 'missing' }] : [],
    }))
    const progress = vi.fn()
    const run = await promoteInChunks(reqs(MAX_OPS_PER_MUTATION + 1), send, progress)
    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([MAX_OPS_PER_MUTATION, 1])
    expect(send.mock.calls[0]![0][0]!.entityId).toBe('e0')
    expect(send.mock.calls[1]![0][0]!.entityId).toBe(`e${MAX_OPS_PER_MUTATION}`)
    expect(run).toMatchObject({ done: 2, total: 2, error: null })
    expect(run.outcome).toEqual({ inserted: MAX_OPS_PER_MUTATION + 1, updated: 0, skipped: [{ entityId: 'x', reason: 'missing' }] })
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('한 조각이면 진행을 알리지 않는다', async () => {
    const progress = vi.fn()
    await promoteInChunks(reqs(3), async () => ({ inserted: 3, updated: 0, skipped: [] }), progress)
    expect(progress).not.toHaveBeenCalled()
  })

  it('실패한 조각에서 멈추고 그때까지의 합을 돌려준다 — 던지지 않는다', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ inserted: 4000, updated: 1000, skipped: [] })
      .mockRejectedValueOnce(new Error('거절'))
    const run = await promoteInChunks(reqs(2 * MAX_OPS_PER_MUTATION + 1), send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(run).toMatchObject({ done: 1, total: 3, outcome: { inserted: 4000, updated: 1000 } })
    expect(run.error).toBeInstanceOf(Error)
    expect(promoteFailureMessage(2 * MAX_OPS_PER_MUTATION + 1, run)).toBe('10,001건 중 5,000건 승격했습니다 — 거절')
  })

  it('첫 조각 실패는 오류 문구 그대로다', async () => {
    const run = await promoteInChunks(reqs(2), async () => { throw new Error('권한이 없습니다') })
    expect(promoteFailureMessage(2, run)).toBe('권한이 없습니다')
  })
})
```

`resource-promote-tab.test.tsx`:
- 파일 위의 `vi.mock('./resource-decisions.js', …)` 블록, `import { overLimitMessage } from './resource-decisions.js'`, 테스트 「op 상한 가드가 걸리면 승격을 눌러도 mutate를 부르지 않고 오류 토스트를 띄운다」를 **지운다.**
- describe 안 끝에 더한다:

```tsx
  /** 도메인 하나 + 단어 n 개 — 계획 항목 순서는 도메인 → 단어다. */
  function bigModel(n: number): ProjectModel {
    const words: Record<string, Word> = {}
    for (let i = 0; i < n; i++) words[`w${String(i).padStart(5, '0')}`] = word(`w${String(i).padStart(5, '0')}`, `단어${i}`, `W${i}`)
    return { ...createEmptyModel(), domains: { d0: domain('d0', '금액') }, words }
  }

  it('5,000건을 넘는 승격은 계획 순서 그대로 나눠 부르고 결과를 토스트 하나로 합친다 — 도중에 진행을 보인다', async () => {
    let release!: () => void
    const promoted = vi.fn((input: unknown) => {
      const n = (input as { entries: unknown[] }).entries.length
      const reply = { data: { seq: 1, inserted: n, updated: 0, skipped: [] } }
      return promoted.mock.calls.length === 1
        ? reply
        : new Promise<typeof reply>((resolve) => { release = () => resolve(reply) })
    })
    const model = bigModel(5000)
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model, seq: 3 } }),
    }, model)
    await openPromoteTab()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '승격' }))
    expect(await screen.findByRole('button', { name: '적용 중… 1 / 2' })).toBeDisabled()
    release()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('추가 5,001건 · 갱신 0건을 올렸습니다'))
    expect(promoted).toHaveBeenCalledTimes(2)
    const chunks = promoted.mock.calls.map(([input]) => (input as { entries: { entityId: string }[] }).entries)
    expect(chunks.map((c) => c.length)).toEqual([5000, 1])
    expect(chunks[0]![0]!.entityId).toBe('d0')                   // 도메인이 앞 조각
    expect(chunks[1]![0]!.entityId).toBe('w04999')
  }, 30000)

  it('중간 조각이 실패하면 몇 건 올렸는지 알리고 계획을 다시 불러온다', async () => {
    const promoted = vi.fn((input: unknown) => (promoted.mock.calls.length === 1
      ? { data: { seq: 1, inserted: (input as { entries: unknown[] }).entries.length, updated: 0, skipped: [] } }
      : { error: { code: -32600, message: '거절' } }))
    const modelGet = vi.fn(() => ({ data: { model: bigModel(5000), seq: 3 } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': modelGet,
    }, bigModel(5000))
    await openPromoteTab()
    await screen.findByText('신규 추가 (5,001)', undefined, { timeout: 10000 })
    await userEvent.click(screen.getByRole('button', { name: '승격' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('5,001건 중 5,000건 승격했습니다 — 거절'))
    expect(modelGet).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  }, 30000)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/lib/promote-chunks.test.ts src/editor/resource-promote-tab.test.tsx`
Expected: `promote-chunks` 모듈 없음, 승격 탭 새 케이스 FAIL(지금은 `overLimitMessage` 가 막아 `toast.error('한 번에 5000건까지…')`).

- [ ] **Step 3: `promote-chunks.ts` 를 쓴다**

```ts
// apps/web/src/lib/promote-chunks.ts
import { MAX_OPS_PER_MUTATION, type PromoteEntry, type PromoteStatus } from '@erdd/core'
import { formatCount } from '@/lib/format'

export type PromoteRequestEntry = {
  entityId: string
  expectedStatus: PromoteStatus
  expectedTargetItemId: string | null
  expectedTargetVersion: number | null
}

export type PromoteRunResult = {
  outcome: { inserted: number; updated: number; skipped: unknown[] }
  /** 성공한 조각 수. */
  done: number
  total: number
  /** 성공이면 null. */
  error: unknown
}

/** 화면이 본 계획 → 서버가 락 안에서 대조할 기대치(guides/shared-resources.md 「승격」). payload 는 보내지 않는다. */
export function toPromoteRequest(entry: PromoteEntry): PromoteRequestEntry {
  return {
    entityId: entry.entityId,
    expectedStatus: entry.status,
    expectedTargetItemId: entry.targetItemId,
    expectedTargetVersion: entry.targetVersion,
  }
}

/**
 * 선택을 `resource.promote` 의 입력 상한(MAX_OPS_PER_MUTATION)씩 잘라 **차례로** 보낸다.
 * 자르는 순서는 받은 순서 그대로다 — 호출자는 계획 항목 순서(도메인 → 단어 → 용어 → 커스텀)를 넘긴다. 그래야
 * 용어 조각을 서버가 락 안에서 다시 계획할 때 앞 조각에서 올라간 도메인을 본다.
 * 실패한 조각에서 멈추고 그때까지의 합을 돌려준다(던지지 않는다) — 앞 조각은 이미 서버에 반영돼 있다.
 */
export async function promoteInChunks(
  entries: readonly PromoteRequestEntry[],
  send: (chunk: PromoteRequestEntry[]) => Promise<{ inserted: number; updated: number; skipped: readonly unknown[] }>,
  onProgress?: (done: number, total: number) => void,
): Promise<PromoteRunResult> {
  const chunks: PromoteRequestEntry[][] = []
  for (let start = 0; start < entries.length; start += MAX_OPS_PER_MUTATION) {
    chunks.push(entries.slice(start, start + MAX_OPS_PER_MUTATION))
  }
  const total = chunks.length
  const outcome = { inserted: 0, updated: 0, skipped: [] as unknown[] }
  if (total > 1) onProgress?.(0, total)
  for (let i = 0; i < total; i++) {
    try {
      const r = await send(chunks[i]!)
      outcome.inserted += r.inserted
      outcome.updated += r.updated
      outcome.skipped.push(...r.skipped)
    } catch (error) {
      return { outcome, done: i, total, error }
    }
    if (total > 1) onProgress?.(i + 1, total)
  }
  return { outcome, done: total, total, error: null }
}

/** 실패 토스트. 첫 조각 실패는 오류 문구 그대로, 중간 실패는 몇 건이 올라갔는지 말한다. */
export function promoteFailureMessage(requested: number, run: PromoteRunResult): string {
  const message = run.error instanceof Error ? run.error.message : '승격하지 못했습니다'
  if (run.done === 0) return message
  return `${formatCount(requested)}건 중 ${formatCount(run.outcome.inserted + run.outcome.updated)}건 승격했습니다 — ${message}`
}
```

- [ ] **Step 4: `promoteSummary` 를 천 단위로** — `promote-selection.ts`

```ts
import { formatCount } from '@/lib/format'
```

```ts
export function promoteSummary(
  result: { inserted: number; updated: number; skipped: readonly unknown[] },
): string {
  const head = `추가 ${formatCount(result.inserted)}건 · 갱신 ${formatCount(result.updated)}건을 올렸습니다`
  return result.skipped.length === 0
    ? head
    : `${head} — ${formatCount(result.skipped.length)}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
}
```

- [ ] **Step 5: 승격 탭을 고친다** — `resource-promote-tab.tsx`

import 를 바꾼다(`overLimitMessage` import 줄 삭제, 아래 더함):

```ts
import { formatCount, formatProgress } from '@/lib/format'
import { promoteFailureMessage, promoteInChunks, toPromoteRequest } from '@/lib/promote-chunks'
```

`const promote = useMutation(trpc.resource.promote.mutationOptions({ onSuccess: …, onError: … }))` 블록 전체를 이것으로 바꾼다:

```ts
  // 조각마다 부르므로 onSuccess/onError 를 쓰지 않고 promoteInChunks 가 결과를 모은다.
  const promote = useMutation(trpc.resource.promote.mutationOptions())
  const [promoting, setPromoting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  /** 서버가 모델(origin)과 라이브러리를 바꿨다 — 서버 상태로 되맞추고 계획의 입력을 다시 받는다. */
  const refreshAfterPromote = async () => {
    const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
    if (useEditorStore.getState().loadedProjectId === projectId) {
      useEditorStore.getState().resync(fresh.model, fresh.seq)
    }
    await queryClient.invalidateQueries({
      queryKey: trpc.resource.items.list.queryKey({ libraryId: library.id }),
    })
    await queryClient.invalidateQueries({
      queryKey: trpc.resource.library.listForProject.queryKey({ projectId }),
    })
  }
```

`request` 의 `onSuccess` 토스트를 천 단위로:

```ts
      toast.success(result.dropped.length === 0
        ? `${formatCount(result.requested)}건을 승격 요청했습니다`
        : `${formatCount(result.requested)}건을 요청했습니다 — ${formatCount(result.dropped.length)}건은 이미 반영됐거나 삭제되어 빠졌습니다`)
```

`onRequest` 에서 `overLimitMessage` 두 줄을 지운다(요청은 나누지 않는다 — 서버 상한 50,000, Task 5). `onPromote` 를 이것으로 바꾼다:

```ts
  /**
   * 선택을 5,000건씩 잘라 차례로 승격한다(서버 `resource.promote` 의 입력 상한은 그대로다). 결과는 합쳐 토스트
   * 하나로 보인다. 중간 실패면 앞 조각은 이미 올라갔으므로 몇 건인지 알리고 계획을 다시 불러온다. 첫 조각
   * 실패는 지금처럼 오류만 알린다(서버에 바뀐 것이 없다).
   */
  const onPromote = async () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0 || promoting) return
    setPromoting(true)
    try {
      const run = await promoteInChunks(
        entries.map(toPromoteRequest),
        (chunk) => promote.mutateAsync({ projectId, libraryId: library.id, entries: chunk }),
        (done, total) => setProgress({ done, total }),
      )
      if (run.done > 0) {
        try {
          await refreshAfterPromote()
        } catch {
          toast.error('서버 상태를 불러오지 못했습니다. 새로고침해 주세요.')
        }
      }
      if (run.error === null) toast.success(promoteSummary(run.outcome))
      else toast.error(promoteFailureMessage(entries.length, run))
    } finally {
      setPromoting(false)
      setProgress(null)
    }
  }
```

승격 버튼과 선택 건수를 이것으로 바꾼다:

```tsx
          <span className="text-xs text-muted-foreground">올릴 항목 {formatCount(selected.size)}건</span>
          {library.canWrite ? (
            <Button type="button" disabled={selected.size === 0 || promoting} onClick={() => { void onPromote() }}>
              {progress !== null ? formatProgress(progress.done, progress.total) : '승격'}
            </Button>
          ) : (
```

대기 요청 줄의 건수도 천 단위로: `{row.requesterName} · {formatCount(row.entityIds.length)}건`.

컴포넌트 위 주석의 「**승격**(canWrite): … 성공하면 model.get으로 되맞추되 …」 문단 끝에 한 줄을 더한다: 「선택이 5,000건을 넘으면 `promoteInChunks` 로 나눠 부른다.」

- [ ] **Step 6: `overLimitMessage` 를 지운다** — `resource-decisions.ts` 에서 `overLimitMessage` 함수와 그 주석, `import { MAX_OPS_PER_MUTATION } from '@erdd/core'` 줄을 지운다. 남은 쓰임이 없는지 센다:

```bash
grep -rn "overLimitMessage" apps/web/src; echo "EXIT=$?"
```
Expected: 출력 없음, `EXIT=1`(grep 이 못 찾음).

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/lib/promote-chunks.test.ts src/lib/promote-selection.test.ts src/editor/resource-promote-tab.test.tsx src/editor/resource-decisions.test.ts src/editor/resource-panel.test.tsx src/components/promotion-requests-section.test.tsx`
Expected: PASS(개수 확인). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/lib/promote-chunks.ts apps/web/src/lib/promote-chunks.test.ts apps/web/src/lib/promote-selection.ts apps/web/src/editor/resource-promote-tab.tsx apps/web/src/editor/resource-promote-tab.test.tsx apps/web/src/editor/resource-decisions.ts && git commit -m "feat(web): 5,000건을 넘는 승격을 나눠 부르고 결과를 합쳐 보이며 요청 상한 가드를 걷는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/lib/promote-chunks.ts apps/web/src/lib/promote-chunks.test.ts apps/web/src/lib/promote-selection.ts apps/web/src/editor/resource-promote-tab.tsx apps/web/src/editor/resource-promote-tab.test.tsx apps/web/src/editor/resource-decisions.ts
```

(`promote-selection.test.ts` 의 단언이 천 단위 때문에 바뀌어 고쳤다면 그 파일도 같은 명령의 경로에 더한다.)

- [ ] **Step 9: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. `promoteInChunks` 의 자름을 `[entries.slice()]` 한 조각으로 → `promote-chunks` 첫 테스트와 승격 탭 첫 테스트 FAIL 기대.
  2. `onPromote` 의 `if (run.done > 0) { … refreshAfterPromote … }` 를 지운다 → 「중간 조각이 실패하면…」 FAIL 기대(`model.get` 이 불리지 않는다).
  3. `promoteFailureMessage` 가 늘 `message` 만 내게 → 같은 테스트 FAIL 기대.
  복구 후 `git status --short` clean.

---
### Task 13: web — 사용처 색인과 사전 패널(탭·검색·페이지·나란한 이름)

**Files:**
- Modify: `apps/web/src/editor/dict-edits.ts`(`buildUsageIndex` 추가), `apps/web/src/editor/dict-panel.tsx`(import 블록과 `DictPanel` 함수, 새 `DictRow`)
- Test: `apps/web/src/editor/dict-edits.test.ts`, `apps/web/src/editor/dict-panel.test.tsx`

**Interfaces:**
- Consumes: `wordUsage`·`termUsage`·`DictUsageEntry`(같은 파일), `decomposeByWords`·`stripLogicalSeparator`(`@erdd/core`), `useListPage`·`Pagination`·`Tabs*`·`formatCount`(Task 6).
- Produces:
  - `type UsageIndex = { words: Map<string, DictUsageEntry[]>; terms: Map<string, DictUsageEntry[]> }`
  - `buildUsageIndex(model: ProjectModel, rules: NamingRules): UsageIndex` — 모든 단어·용어 id 가 키로 있고(없으면 빈 배열), 값은 **같은 모델·규칙에서 `wordUsage(model, id, rules)`·`termUsage(model, id)` 와 같다**(순서까지). 모델을 한 번 훑는다.

⚠️ **두 판정의 미묘한 차이를 그대로 옮겨야 한다.** `termUsage` 는 **평문 `trim` 완전일치**(구분자를 벗기지 않는다)이고, `wordUsage` 가 「용어 완전일치면 단어 분해를 건너뛴다」를 볼 때는 **양쪽 구분자를 벗겨** 비교한다(`matchesTermExactly`). 색인이 둘을 하나로 합치면 목록의 사용 수와 삭제·용어 수정 경고(`planTermPropagation` 은 `termUsage` 를 계속 쓴다)가 서로 다른 수를 말한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`dict-edits.test.ts` 의 import 에 `buildUsageIndex`·`wordUsage`·`termUsage`·`createWord`·`createTerm` 이 없으면 더하고, `DEFAULT_NAMING_RULES`·`type NamingRules`·`type ProjectModel` 을 `@erdd/core` 에서, `buildSampleModel` 을 `@erdd/core/src/testing/fixtures.js` 에서 import 한다(이미 있으면 그대로). 파일 끝에 더한다:

```ts
describe('buildUsageIndex — 목록의 사용 수는 삭제·수정 경고와 같은 수를 말한다', () => {
  /**
   * 두 판정이 갈리는 모양을 전부 넣는다: 구분자가 든 용어(단어 분해 건너뜀 판정만 벗겨 비교), 공백뿐인 용어
   * (termUsage 는 빈 논리명과 맞춘다), 같은 단어가 두 번 든 이름(한 번만 센다), 앞뒤 공백, 빈 논리명.
   */
  function usageFixture(): ProjectModel {
    let m = buildSampleModel()   // t1 회원등급 · t2 회원, c1·c4 등급코드 · c2 회원번호 · c3 회원명
    const words: [string, string, string][] = [
      ['w1', '회원', 'MBR'], ['w2', '번호', 'NO'], ['w3', '등급', 'GRD'], ['w4', '코드', 'CD'], ['w5', '명', 'NM'],
      ['w6', '주문', 'ORD'],
    ]
    for (const [id, logicalName, abbreviation] of words) {
      m = createWord(m, { id, logicalName, abbreviation, englishName: null, description: null, origin: null })
    }
    const terms: [string, string, string][] = [
      ['tm1', '등급코드', 'GRD_CD'], ['tm2', '회원_번호', 'MBR_NO'], ['tm3', '없는용어', 'NONE'], ['tm4', '  ', 'BLANK'],
    ]
    for (const [id, logicalName, physicalName] of terms) {
      m = createTerm(m, { id, logicalName, physicalName, domainId: null, description: null, origin: null })
    }
    const tables = { ...m.tables, t3: { ...m.tables.t1!, id: 't3', logicalName: '회원_등급', physicalName: 'MBR_GRD2' } }
    const columns = {
      ...m.columns,
      c5: { ...m.columns.c3!, id: 'c5', tableId: 't3', logicalName: ' 회원회원 ', physicalName: 'MBR_MBR' },
      c6: { ...m.columns.c3!, id: 'c6', tableId: 't3', logicalName: '', physicalName: 'EMPTY' },
      c7: { ...m.columns.c3!, id: 'c7', tableId: 't3', logicalName: '회원번호', physicalName: 'MBR_NO' },
    }
    return { ...m, tables, columns }
  }

  const RULES: [string, NamingRules][] = [
    ['기본 규칙(논리명 구분자 _)', DEFAULT_NAMING_RULES],
    ['논리명 구분자 없음', { ...DEFAULT_NAMING_RULES, logicalSeparator: '' }],
  ]
  for (const [label, rules] of RULES) {
    it(`${label}: 모든 단어·용어 id 에서 wordUsage·termUsage 와 같은 값이다`, () => {
      const m = usageFixture()
      const index = buildUsageIndex(m, rules)
      expect([...index.words.keys()].sort()).toEqual(Object.keys(m.words).sort())
      expect([...index.terms.keys()].sort()).toEqual(Object.keys(m.terms).sort())
      for (const id of Object.keys(m.words)) expect(index.words.get(id), `단어 ${id}`).toEqual(wordUsage(m, id, rules))
      for (const id of Object.keys(m.terms)) expect(index.terms.get(id), `용어 ${id}`).toEqual(termUsage(m, id))
    })
  }

  it('픽스처가 갈림길을 실제로 밟는다 — 용어 완전일치 컬럼은 단어 사용처에서 빠지고, 빈 용어는 빈 논리명과 맞는다', () => {
    const m = usageFixture()
    const index = buildUsageIndex(m, DEFAULT_NAMING_RULES)
    // c2·c7(회원번호)은 tm2(회원_번호)와 구분자를 벗겨 같으므로 단어 분해를 건너뛴다 — 회원 단어의 사용처가 아니다.
    const memberUsers = index.words.get('w1')!.map((u) => u.entity.id)
    expect(memberUsers).not.toContain('c2')
    expect(memberUsers).toContain('c5')
    expect(memberUsers.filter((id) => id === 'c5')).toHaveLength(1)
    // termUsage 는 평문 비교라 tm2(회원_번호)는 회원번호 컬럼과 맞지 않는다.
    expect(index.terms.get('tm2')).toEqual([])
    expect(index.terms.get('tm4')!.map((u) => u.entity.id)).toEqual(['c6'])
  })
})
```

`dict-panel.test.tsx`:
- 섹션 버튼이 Tabs 로 바뀌므로 역할을 바꾼다(아래 명령 뒤 `grep` 결과가 0 줄이어야 한다):

```bash
sed -i '' \
  -e "s/getByRole('button', { name: '용어' })/getByRole('tab', { name: \/^용어\/ })/g" \
  -e "s/getByRole('button', { name: \/미등록 항목\/ })/getByRole('tab', { name: \/^미등록 항목\/ })/g" \
  -e "s/getByRole('button', { name: '가져오기' })/getByRole('tab', { name: '가져오기' })/g" \
  apps/web/src/editor/dict-panel.test.tsx
grep -nE "getByRole\('button', \{ name: ('용어'|/미등록 항목/|'가져오기') \}\)" apps/web/src/editor/dict-panel.test.tsx | wc -l
```

- 파일 위(다른 `vi.mock` 과 같은 자리 — 없으면 import 블록 바로 아래)에 부분 목을 더하고 import 에 `termUsage, wordUsage` 를 더한다(`import { createWord, createTerm, termUsage, wordUsage } from './dict-edits.js'`):

```ts
// 사용 수가 색인에서 오는지 잠그려고 두 함수에만 스파이를 단다. 동작은 실제 구현 그대로다.
vi.mock('./dict-edits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dict-edits.js')>()
  return { ...actual, wordUsage: vi.fn(actual.wordUsage), termUsage: vi.fn(actual.termUsage) }
})
```

- describe 안 끝에 더한다:

```tsx
  it('사용 수는 모델을 한 번 훑은 색인에서 읽는다 — 행마다 wordUsage·termUsage 를 부르지 않는다', async () => {
    loadModelWithDict()
    vi.mocked(wordUsage).mockClear()
    vi.mocked(termUsage).mockClear()
    renderPanel()
    expect(screen.getByText(/사용처 \d+개/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^용어/ }))
    expect(screen.getByText('GRD_CD')).toBeInTheDocument()
    expect(wordUsage).not.toHaveBeenCalled()
    expect(termUsage).not.toHaveBeenCalled()
  })

  it('단어는 50건씩 나뉘고 약어로도 찾으며, 탭 제목에 건수가 붙는다', async () => {
    let m = createEmptyModel()
    for (let i = 0; i < 60; i++) {
      const n = String(i).padStart(2, '0')
      m = createWord(m, { id: `w${i}`, logicalName: `단어${n}`, abbreviation: `AB${n}`, englishName: null, description: null, origin: null })
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    renderPanel()
    expect(screen.getByRole('tab', { name: '단어 (60)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('단어49')).toBeInTheDocument()
    expect(screen.queryByText('단어50')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('단어50')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'ab05')
    expect(screen.getByText('단어05')).toBeInTheDocument()
    expect(screen.getByText('AB05')).toBeInTheDocument()
    expect(screen.queryByText('단어06')).toBeNull()
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-edits.test.ts src/editor/dict-panel.test.tsx`
Expected: `buildUsageIndex` 없음, `tab` 역할 없음 등으로 FAIL.

- [ ] **Step 3: `buildUsageIndex` 를 쓴다** — `dict-edits.ts` 의 `termUsage` 바로 아래에 더한다.

```ts
/** 사전 목록의 사용처 색인 — 단어·용어 id → 사용처. 모든 id 가 키로 있다(없으면 빈 배열). */
export type UsageIndex = { words: Map<string, DictUsageEntry[]>; terms: Map<string, DictUsageEntry[]> }

/**
 * 모델을 **한 번** 훑어 모든 단어·용어의 사용처를 만든다. 사전 목록이 행마다 `wordUsage`/`termUsage` 를 부르면
 * 비용이 사전 행 수 × (테이블 + 컬럼)이라 대용량 사전에서 패널이 멈춘다.
 *
 * ⚠️ **결과는 같은 모델·규칙의 `wordUsage`/`termUsage` 와 같아야 한다**(순서까지). 삭제 확인·용어 수정 전파처럼
 * 한 건만 필요한 곳은 기존 함수를 계속 쓰므로, 두 경로가 갈리면 목록의 사용 수와 경고가 다른 수를 말한다.
 * 그래서 두 판정의 차이를 그대로 옮긴다 — 용어 사용처는 **평문 trim 완전일치**(`termUsage`), 단어 분해를 건너뛸
 * 용어 완전일치는 **양쪽 구분자를 벗겨** 비교한다(`matchesTermExactly`). `dict-edits.test.ts` 의
 * 「buildUsageIndex — 목록의 사용 수는…」 블록이 모든 id 에서 두 경로가 같음을 잠근다.
 */
export function buildUsageIndex(model: ProjectModel, rules: NamingRules): UsageIndex {
  const words = new Map<string, DictUsageEntry[]>()
  const terms = new Map<string, DictUsageEntry[]>()
  for (const id of Object.keys(model.words)) words.set(id, [])
  for (const id of Object.keys(model.terms)) terms.set(id, [])

  // termUsage: 논리명 trim 평문 → 용어 id 들.
  const termIdsByName = new Map<string, string[]>()
  for (const term of Object.values(model.terms)) {
    const key = term.logicalName.trim()
    const ids = termIdsByName.get(key)
    if (ids) ids.push(term.id)
    else termIdsByName.set(key, [term.id])
  }
  // matchesTermExactly: 양쪽 구분자를 벗긴 용어 논리명 집합.
  const bareTermNames = new Set(
    Object.values(model.terms).map((t) => stripLogicalSeparator(t.logicalName.trim(), rules)))

  // 같은 논리명의 테이블·컬럼이 많으므로 분해 결과를 이름으로 캐시한다.
  const wordIdsByName = new Map<string, ReadonlySet<string>>()
  const wordIdsOf = (name: string): ReadonlySet<string> => {
    const cached = wordIdsByName.get(name)
    if (cached) return cached
    const ids = name === '' || bareTermNames.has(stripLogicalSeparator(name, rules))
      ? new Set<string>()
      : new Set(decomposeByWords(name, model.words, rules).flatMap((s) => (s.word ? [s.word.id] : [])))
    wordIdsByName.set(name, ids)
    return ids
  }

  const visit = (entry: DictUsageEntry) => {
    const name = entry.entity.logicalName.trim()
    for (const id of termIdsByName.get(name) ?? []) terms.get(id)!.push(entry)
    for (const id of wordIdsOf(name)) words.get(id)?.push(entry)
  }
  for (const t of Object.values(model.tables)) visit({ kind: 'table', entity: t })
  for (const c of Object.values(model.columns)) visit({ kind: 'column', entity: c })
  return { words, terms }
}
```

- [ ] **Step 4: 사전 패널을 바꾼다** — `dict-panel.tsx` 의 **import 블록과 `DictPanel` 함수만** 아래로 바꾸고, 파일 끝(`displayFieldValue` 아래)에 `DictRow` 를 더한다. `UnregisteredSection`·`WordEditDialog`·`TermEditDialog`·`PROPAGATION_FIELD_LABEL`·`displayFieldValue` 는 그대로 둔다.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ProjectModel, Term, Word } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import {
  buildUsageIndex, canRegisterWord,
  createTerm, createWord, removeTerm, removeWord, unregisteredAbbreviations, unregisteredWords,
  updateTerm, updateWord,
  planTermPropagation, applyTermPropagation, type TermPropagationPlan,
} from './dict-edits.js'
import { DictImportSection } from './dict-import-section.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FieldLabel } from '@/components/field-label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Section = 'words' | 'terms' | 'unregistered' | 'import'

/** 검색 칸 — 서버 `items.page` 와 같은 필드다(guides/shared-resources.md 「관리 화면의 항목 조회」). */
const WORD_FIELDS = (w: Word) => [w.logicalName, w.abbreviation, w.englishName]
const TERM_FIELDS = (t: Term) => [t.logicalName, t.physicalName]

/** 헤더의 "사전": 물리명 자동 생성에 쓰이는 단어·용어 사전의 목록·추가·편집·삭제, 사용처, 미등록 단어 모아보기. */
export function DictPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)
  const [section, setSection] = useState<Section>('words')
  const [direction, setDirection] = useState<'toAbbr' | 'toLogical'>('toAbbr')
  const [editingWord, setEditingWord] = useState<Word | null>(null)
  const [wordEditorOpen, setWordEditorOpen] = useState(false)
  const [editingTerm, setEditingTerm] = useState<Term | null>(null)
  const [termEditorOpen, setTermEditorOpen] = useState(false)

  const words = useMemo(
    () => Object.values(model.words).sort((a, b) => a.logicalName.localeCompare(b.logicalName)), [model.words])
  const terms = useMemo(
    () => Object.values(model.terms).sort((a, b) => a.logicalName.localeCompare(b.logicalName)), [model.terms])
  const wordList = useListPage(words, WORD_FIELDS)
  const termList = useListPage(terms, TERM_FIELDS)
  // 사용 수는 모델을 한 번 훑은 색인에서 읽는다(행마다 wordUsage/termUsage 를 부르지 않는다). 다이얼로그가
  // 닫혀 있거나 사용 수를 보이지 않는 탭이면 만들지 않는다 — 이 패널은 늘 마운트돼 있어 편집마다 다시 만들게 된다.
  const usage = useMemo(
    () => (open && (section === 'words' || section === 'terms') ? buildUsageIndex(model, namingRules) : null),
    [open, section, model, namingRules])
  const candidates = useMemo(
    () => unregisteredWords(model, namingRules), [model, namingRules])
  // 물리명 분해에서 나온 미등록 약어(위 candidates의 대칭 — 논리명 분해 vs 물리명 분해).
  const abbrCandidates = useMemo(
    () => unregisteredAbbreviations(model, namingRules), [model, namingRules])
  const unregisteredCount = candidates.length + abbrCandidates.length

  const onAddWord = () => { setEditingWord(null); setWordEditorOpen(true) }
  const onEditWord = (w: Word) => { setEditingWord(w); setWordEditorOpen(true) }
  const onRemoveWord = (id: string) => { void mutate((m) => removeWord(m, id), { summary: '단어 삭제' }) }

  const onAddTerm = () => { setEditingTerm(null); setTermEditorOpen(true) }
  const onEditTerm = (t: Term) => { setEditingTerm(t); setTermEditorOpen(true) }
  const onRemoveTerm = (id: string) => { void mutate((m) => removeTerm(m, id), { summary: '용어 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>단어·용어 사전</DialogTitle></DialogHeader>
          <Tabs value={section} onValueChange={(value) => setSection(value as Section)}>
            <TabsList aria-label="사전 구역">
              <TabsTrigger value="words">단어 ({formatCount(words.length)})</TabsTrigger>
              <TabsTrigger value="terms">용어 ({formatCount(terms.length)})</TabsTrigger>
              <TabsTrigger value="unregistered">
                미등록 항목{unregisteredCount > 0 ? ` (${formatCount(unregisteredCount)})` : ''}
              </TabsTrigger>
              <TabsTrigger value="import">가져오기</TabsTrigger>
            </TabsList>

            <TabsContent value="words" className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  단어의 표준 약어를 등록해 물리명 자동 생성에 사용합니다
                </p>
                {canEdit && <Button size="sm" onClick={onAddWord}><Plus /> 단어 추가</Button>}
              </div>
              {words.length > 0 && (
                <Input aria-label="단어 검색" placeholder="논리명·약어·영문명 검색" value={wordList.query}
                  onChange={(e) => wordList.setQuery(e.target.value)} />
              )}
              <ul className="grid max-h-96 gap-2 overflow-y-auto">
                {words.length === 0 && <p className="text-sm text-muted-foreground">아직 단어가 없습니다</p>}
                {words.length > 0 && wordList.view.total === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
                {wordList.view.rows.map((w) => (
                  <DictRow key={w.id} logical={w.logicalName} physical={w.abbreviation}
                    usage={usage?.words.get(w.id)?.length ?? 0} canEdit={canEdit}
                    onEdit={() => onEditWord(w)} onRemove={() => onRemoveWord(w.id)} />
                ))}
              </ul>
              <Pagination label="단어" page={wordList.view.page} pageCount={wordList.view.pageCount}
                total={wordList.view.total} onPageChange={wordList.setPage} />
            </TabsContent>

            <TabsContent value="terms" className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  논리명 전체가 완전일치할 때 우선 적용되는 표준 물리명을 관리합니다
                </p>
                {canEdit && <Button size="sm" onClick={onAddTerm}><Plus /> 용어 추가</Button>}
              </div>
              {terms.length > 0 && (
                <Input aria-label="용어 검색" placeholder="논리명·물리명 검색" value={termList.query}
                  onChange={(e) => termList.setQuery(e.target.value)} />
              )}
              <ul className="grid max-h-96 gap-2 overflow-y-auto">
                {terms.length === 0 && <p className="text-sm text-muted-foreground">아직 용어가 없습니다</p>}
                {terms.length > 0 && termList.view.total === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
                {termList.view.rows.map((t) => (
                  <DictRow key={t.id} logical={t.logicalName} physical={t.physicalName}
                    usage={usage?.terms.get(t.id)?.length ?? 0} canEdit={canEdit}
                    onEdit={() => onEditTerm(t)} onRemove={() => onRemoveTerm(t.id)} />
                ))}
              </ul>
              <Pagination label="용어" page={termList.view.page} pageCount={termList.view.pageCount}
                total={termList.view.total} onPageChange={termList.setPage} />
            </TabsContent>

            <TabsContent value="unregistered" className="grid gap-3">
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={direction === 'toAbbr' ? 'default' : 'outline'}
                  onClick={() => setDirection('toAbbr')}
                >
                  논리명 → 약어{candidates.length > 0 ? ` (${formatCount(candidates.length)})` : ''}
                </Button>
                <Button
                  type="button" size="sm" variant={direction === 'toLogical' ? 'default' : 'outline'}
                  onClick={() => setDirection('toLogical')}
                >
                  물리명 → 논리명{abbrCandidates.length > 0 ? ` (${formatCount(abbrCandidates.length)})` : ''}
                </Button>
              </div>
              <UnregisteredSection
                projectId={projectId} canEdit={canEdit} direction={direction}
                candidates={direction === 'toAbbr' ? candidates : abbrCandidates}
              />
            </TabsContent>

            <TabsContent value="import">
              <DictImportSection projectId={projectId} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {wordEditorOpen && (
        <WordEditDialog
          key={editingWord?.id ?? 'new'} projectId={projectId} word={editingWord}
          open={wordEditorOpen} onOpenChange={setWordEditorOpen}
        />
      )}
      {termEditorOpen && (
        <TermEditDialog
          key={editingTerm?.id ?? 'new'} projectId={projectId} term={editingTerm}
          open={termEditorOpen} onOpenChange={setTermEditorOpen}
        />
      )}
    </>
  )
}
```

파일 끝에 더한다:

```tsx
/** 사전 한 행 — 논리명 | 물리명 | 사용 수를 한 줄에 나란히 보인다. */
function DictRow({ logical, physical, usage, canEdit, onEdit, onRemove }: {
  logical: string
  physical: string
  usage: number
  canEdit: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2">
      <span className="truncate font-medium">{logical}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">{physical}</span>
      <div className="flex shrink-0 items-center gap-2">
        {usage > 0 && <span className="text-xs text-muted-foreground">사용처 {formatCount(usage)}개</span>}
        {canEdit && (
          <>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`${logical} 편집`} onClick={onEdit}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7 text-destructive"
              aria-label={`${logical} 삭제`} onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-edits.test.ts src/editor/dict-panel.test.tsx src/editor/dict-import-section.test.tsx src/editor/header-tools.test.tsx`
Expected: PASS(개수 확인). 기존 dict-panel 테스트 중 탭 제목 문자열(`'단어'` 등)을 정확히 찾던 단언이 건수 괄호 때문에 어긋나면 워커 지시 1 대로 단언을 정정하고 보고한다. `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx && git commit -m "feat(web): 사전 패널을 탭·검색·페이지로 바꾸고 사용 수를 한 번 훑은 색인에서 읽는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. `buildUsageIndex` 의 `termIdsByName` 키를 `stripLogicalSeparator(term.logicalName.trim(), rules)` 로(= 두 판정을 합침) → 등가 테스트·「픽스처가 갈림길을 실제로 밟는다」 FAIL 기대(`tm2` 가 회원번호 컬럼과 맞는다).
  2. `wordIdsOf` 의 `bareTermNames.has(…)` 조건을 뺀다 → 등가 테스트 FAIL 기대.
  3. `DictPanel` 의 `usage?.words.get(w.id)?.length ?? 0` 를 `wordUsage(model, w.id, namingRules).length` 로(import 복원 포함) → 「사용 수는 … 색인에서 읽는다」 FAIL 기대.
  복구 후 `git status --short` clean.

---

### Task 14: web — 도메인·커스텀 항목 패널의 검색·페이지

**Files:**
- Modify: `apps/web/src/editor/domain-panel.tsx`(전체 교체), `apps/web/src/editor/custom-field-panel.tsx`(전체 교체)
- Test: `apps/web/src/editor/domain-panel.test.tsx`, `apps/web/src/editor/custom-field-panel.test.tsx`

**Interfaces:**
- Consumes: `useListPage`·`Pagination`·`formatCount`(Task 6).
- Produces: 도메인 — 검색창 `도메인 검색`(이름), 페이지는 **분류 → 이름 순으로 편 전체 행**에서 자르고 묶음 제목은 그 쪽에 나온 분류만. 커스텀 항목 — 검색창 `커스텀 항목 검색`(이름), 페이지는 테이블 항목 → 컬럼 항목 순으로 편 전체 행에서 자르고, **순서 버튼은 검색 중 잠기며** 첫·끝 판정은 쪽이 아니라 대상 전체 기준.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`domain-panel.test.tsx` 의 import 에 `createEmptyModel` 을 더하고(`import { createEmptyModel } from '@erdd/core'`, 이미 있으면 그대로) describe 안 끝에 더한다:

```tsx
  function loadManyDomains(n: number, splitAt: number) {
    let m = createEmptyModel()
    for (let i = 0; i < n; i++) {
      m = createDomain(m, {
        id: `d${i}`, name: `도메인${String(i).padStart(2, '0')}`, category: i < splitAt ? '가분류' : '나분류',
        logicalType: 'INT', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      })
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
  }

  it('50건씩 나뉘고 묶음 제목은 그 쪽에 나온 분류만 그린다', async () => {
    loadManyDomains(55, 50)
    renderPanel()
    expect(screen.getByText('가분류')).toBeInTheDocument()
    expect(screen.queryByText('나분류')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('나분류')).toBeInTheDocument()
    expect(screen.queryByText('가분류')).toBeNull()
  })

  it('이름으로 찾고, 없으면 알린다', async () => {
    loadManyDomains(55, 50)
    renderPanel()
    await userEvent.type(screen.getByRole('textbox', { name: '도메인 검색' }), '도메인07')
    expect(screen.getByText('도메인07')).toBeInTheDocument()
    expect(screen.queryByText('도메인08')).toBeNull()
    await userEvent.clear(screen.getByRole('textbox', { name: '도메인 검색' }))
    await userEvent.type(screen.getByRole('textbox', { name: '도메인 검색' }), '없는이름')
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument()
  })
```

`custom-field-panel.test.tsx` 의 import 에 `createEmptyModel` 을 더하고(`import { createEmptyModel } from '@erdd/core'`) `describe('CustomFieldPanel', …)` 안 끝에 더한다:

```tsx
  it('검색 중에는 순서 버튼이 잠긴다 — 걸러진 목록의 이웃은 실제 이웃이 아니다', async () => {
    loadModelWithFields()
    renderPanel()
    expect(screen.getByRole('button', { name: '암호화방식 위로' })).toBeEnabled()
    await userEvent.type(screen.getByRole('textbox', { name: '커스텀 항목 검색' }), '암호')
    expect(screen.queryByText('개인정보여부')).toBeNull()
    expect(screen.getByRole('button', { name: '암호화방식 위로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '암호화방식 아래로' })).toBeDisabled()
  })

  it('50건을 넘으면 쪽으로 나뉘고, 첫·끝 판정은 쪽이 아니라 대상 전체 기준이다', async () => {
    let m = createEmptyModel()
    for (let i = 0; i < 60; i++) {
      m = createCustomField(m, {
        id: `f${i}`, name: `항목${String(i).padStart(2, '0')}`, target: 'column', type: 'text',
        options: [], required: false, defaultValue: null, origin: null,
      })
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    renderPanel()
    expect(screen.getByRole('button', { name: '항목49 아래로' })).toBeEnabled()   // 쪽의 끝이지만 전체의 끝이 아니다
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByRole('button', { name: '항목50 위로' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '항목59 아래로' })).toBeDisabled()
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/domain-panel.test.tsx src/editor/custom-field-panel.test.tsx`
Expected: 새 케이스 FAIL(검색창·페이지 없음).

- [ ] **Step 3: 도메인 패널** — `domain-panel.tsx` 를 통째로 바꾼다.

```tsx
import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { type Domain } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { removeDomain, usageOf } from './domain-edits.js'
import { DomainEditDialog } from './domain-edit-dialog.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const UNCATEGORIZED = '미분류'
/** 검색 칸 — 서버 `items.page` 의 도메인 검색과 같다(이름). */
const DOMAIN_FIELDS = (d: Domain) => [d.name]

function groupByCategory(domains: readonly Domain[]): [string, Domain[]][] {
  const map = new Map<string, Domain[]>()
  for (const d of domains) {
    const key = d.category ?? UNCATEGORIZED
    const list = map.get(key)
    if (list) list.push(d)
    else map.set(key, [d])
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * 헤더의 "도메인": 공통 컬럼 도메인(타입·기본값·허용값 재사용 단위)의 목록·추가·편집·삭제.
 *
 * 열림 상태는 제어형이다 — 트리거는 `header-tools.tsx`가 렌더한다(설계 D5).
 * 목록은 분류 → 이름 순으로 편 뒤 거르고 50건씩 자른다. 묶음 제목은 그 쪽에 나온 분류만 그린다.
 */
export function DomainPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [editing, setEditing] = useState<Domain | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const ordered = useMemo(
    () => groupByCategory(Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name)))
      .flatMap(([, items]) => items),
    [model.domains])
  const list = useListPage(ordered, DOMAIN_FIELDS)
  const groups = groupByCategory(list.view.rows)

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (d: Domain) => { setEditing(d); setEditorOpen(true) }
  const onRemove = (id: string) => { void mutate((m) => removeDomain(m, id), { summary: '도메인 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>도메인</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">공통 컬럼 타입·기본값·허용값을 재사용 단위로 관리합니다</p>
            {canEdit && <Button size="sm" onClick={onAdd}><Plus /> 도메인 추가</Button>}
          </div>
          {ordered.length > 0 && (
            <Input aria-label="도메인 검색" placeholder="이름 검색" value={list.query}
              onChange={(e) => list.setQuery(e.target.value)} />
          )}
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {ordered.length === 0 && <p className="text-sm text-muted-foreground">아직 도메인이 없습니다</p>}
            {ordered.length > 0 && list.view.total === 0 && (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
            )}
            {groups.map(([category, items]) => (
              <div key={category} className="grid gap-2">
                <h4 className="text-xs font-semibold text-muted-foreground">{category}</h4>
                <ul className="grid gap-2">
                  {items.map((d) => {
                    const usage = usageOf(model, d.id).length
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                        <div className="grid gap-0.5">
                          <span className="font-medium">{d.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{d.logicalType}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {usage > 0 && <span className="text-xs text-muted-foreground">사용처 {formatCount(usage)}개</span>}
                          {canEdit && (
                            <>
                              <Button
                                size="icon" variant="ghost" className="size-7" aria-label={`${d.name} 편집`}
                                onClick={() => onEdit(d)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="size-7 text-destructive"
                                aria-label={`${d.name} 삭제`} disabled={usage > 0}
                                onClick={() => onRemove(d.id)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <Pagination label="도메인" page={list.view.page} pageCount={list.view.pageCount}
            total={list.view.total} onPageChange={list.setPage} />
        </DialogContent>
      </Dialog>
      {editorOpen && (
        <DomainEditDialog
          key={editing?.id ?? 'new'} projectId={projectId} domain={editing}
          open={editorOpen} onOpenChange={setEditorOpen}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: 커스텀 항목 패널** — `custom-field-panel.tsx` 를 통째로 바꾼다.

```tsx
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { customFieldsFor, customFieldUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { moveCustomField, removeCustomField } from './custom-field-edits.js'
import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const TARGET_TITLE = { table: '테이블 항목', column: '컬럼 항목' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const
const TARGETS = ['table', 'column'] as const
/** 검색 칸 — 서버 `items.page` 의 커스텀 항목 검색과 같다(이름). */
const FIELD_FIELDS = (f: CustomField) => [f.name]

/**
 * 헤더의 "커스텀 항목": 테이블/컬럼에 붙는 조직·프로젝트 고유 메타 항목의 정의를 관리한다.
 *
 * 목록은 테이블 항목 → 컬럼 항목(각각 표시 순서) 순으로 편 뒤 거르고 50건씩 자른다. 대상 제목은 그 쪽에 나온
 * 대상만 그린다. **순서 버튼은 검색 중 잠긴다** — 걸러진 목록에서 「위로」는 사용자가 보는 이웃이 아니라 숨은
 * 이웃과 자리를 바꾼다. 첫·끝 판정도 쪽이 아니라 그 대상 전체 기준이다.
 */
export function CustomFieldPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const byTarget = useMemo(() => ({
    table: customFieldsFor(model, 'table'),
    column: customFieldsFor(model, 'column'),
  }), [model])
  const ordered = useMemo(() => [...byTarget.table, ...byTarget.column], [byTarget])
  /** id → 그 대상 전체에서의 자리. 첫·끝 판정이 쪽에 흔들리지 않게 한다. */
  const position = useMemo(() => {
    const out = new Map<string, { index: number; count: number }>()
    for (const target of TARGETS) {
      byTarget[target].forEach((f, index) => out.set(f.id, { index, count: byTarget[target].length }))
    }
    return out
  }, [byTarget])
  const list = useListPage(ordered, FIELD_FIELDS)
  const searching = list.query.trim() !== ''

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (f: CustomField) => { setEditing(f); setEditorOpen(true) }
  const onMove = (id: string, dir: -1 | 1) => {
    void mutate((m) => moveCustomField(m, id, dir), { summary: '커스텀 항목 순서 변경' })
  }
  const onRemove = (f: CustomField) => {
    const used = customFieldUsageCount(model, f.id)
    const message = used > 0
      ? `"${f.name}"을(를) 삭제하면 입력된 값 ${formatCount(used)}건도 함께 삭제됩니다. 계속할까요?`
      : `"${f.name}"을(를) 삭제할까요?`
    if (!window.confirm(message)) return
    const fieldId = f.id
    void mutate((m) => removeCustomField(m, fieldId), { summary: '커스텀 항목 삭제' })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>커스텀 항목</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              테이블·컬럼에 프로젝트 고유의 관리 항목을 정의합니다
            </p>
            {canEdit && <Button size="sm" onClick={onAdd}><Plus /> 항목 추가</Button>}
          </div>
          {ordered.length > 0 && (
            <Input aria-label="커스텀 항목 검색" placeholder="이름 검색" value={list.query}
              onChange={(e) => list.setQuery(e.target.value)} />
          )}
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {searching && list.view.total === 0 && (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
            )}
            {TARGETS.map((target) => {
              const fields = list.view.rows.filter((f) => f.target === target)
              // 그 쪽에 나온 대상만 그린다. 대상 자체가 비어 있으면(검색 중이 아닐 때) 빈 안내를 남긴다.
              const empty = !searching && byTarget[target].length === 0
              if (fields.length === 0 && !empty) return null
              return (
                <div key={target} className="grid gap-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">
                    {TARGET_TITLE[target]}
                  </h4>
                  {empty && (
                    <p className="text-sm text-muted-foreground">아직 항목이 없습니다</p>
                  )}
                  <ul className="grid gap-2">
                    {fields.map((f) => {
                      const used = customFieldUsageCount(model, f.id)
                      const pos = position.get(f.id) ?? { index: 0, count: 1 }
                      return (
                        <li key={f.id}
                          className="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div className="grid gap-0.5">
                            <span className="font-medium">
                              {f.name}{f.required && <span className="text-destructive"> *</span>}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {TYPE_LABEL[f.type]}
                              {f.type === 'select' && f.options.length > 0 && ` · ${f.options.join(' / ')}`}
                              {f.defaultValue !== null && ` · 기본값 ${f.defaultValue}`}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {used > 0 && (
                              <span className="mr-1 text-xs text-muted-foreground">값 {formatCount(used)}건</span>
                            )}
                            {canEdit && (
                              <>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 위로`} disabled={searching || pos.index === 0}
                                  onClick={() => onMove(f.id, -1)}>
                                  <ChevronUp className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 아래로`} disabled={searching || pos.index === pos.count - 1}
                                  onClick={() => onMove(f.id, 1)}>
                                  <ChevronDown className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7"
                                  aria-label={`${f.name} 편집`} onClick={() => onEdit(f)}>
                                  <Pencil className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-7 text-destructive"
                                  aria-label={`${f.name} 삭제`} onClick={() => onRemove(f)}>
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
          <Pagination label="커스텀 항목" page={list.view.page} pageCount={list.view.pageCount}
            total={list.view.total} onPageChange={list.setPage} />
        </DialogContent>
      </Dialog>
      {editorOpen && (
        <CustomFieldEditDialog
          key={editing?.id ?? 'new'} projectId={projectId} field={editing}
          open={editorOpen} onOpenChange={setEditorOpen}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/domain-panel.test.tsx src/editor/custom-field-panel.test.tsx`
Expected: PASS(개수 확인 — 기존 「첫 항목의 위로 버튼과 마지막 항목의 아래로 버튼이 비활성이다」도 그대로). `pnpm -C apps/web typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-panel.test.tsx apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-panel.test.tsx && git commit -m "feat(web): 도메인·커스텀 항목 패널에 검색·페이지를 더하고 검색 중 순서 버튼을 잠근다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-panel.test.tsx apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-panel.test.tsx
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — 각각 되돌리고 돌린 뒤 복구:
  1. 커스텀 항목 순서 버튼의 `searching ||` 두 곳을 뺀다 → 「검색 중에는 순서 버튼이 잠긴다」 FAIL 기대.
  2. `pos.index === pos.count - 1` 을 쪽 기준(`i === fields.length - 1`, map 에 인덱스 추가)으로 → 「첫·끝 판정은 쪽이 아니라…」 FAIL 기대.
  3. 도메인의 `groupByCategory(list.view.rows)` 를 `groupByCategory(ordered)` 로 → 「묶음 제목은 그 쪽에 나온 분류만」 FAIL 기대.
  복구 후 `git status --short` clean.

---
### Task 15: 문서 — 정본·매뉴얼·코드 주석을 새 규칙에 맞춘다

설계 7절과 「착수 시점 서술 목록」의 문서·주석 몫이다. `docs/guides/doc-conventions.md` 를 먼저 읽는다 — **연대기 금지**(「전에는 5,000건에서 막았다」 같은 문장 금지, 끝난 뒤의 상태만), **`파일:줄번호` 인용 금지**(파일 이름 + 절 제목·함수명·테스트 이름), **같은 규칙을 두 문서에 적지 않는다**(사본은 정본의 파일 이름 + 절 제목 한 줄). 코드 주석이 가리키는 정본 절 제목은 이 태스크가 만드는 **`docs/guides/data-layer.md` 「한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이 나눠 보낸다」**다(앞 태스크 주석의 「한 요청의 op 상한은 …」가 이것이다 — 절 제목을 바꾸면 `grep -rn "한 요청의 op 상한" apps packages` 로 가리키는 자리를 전부 함께 고친다).

**Files:**
- Modify: `docs/guides/data-layer.md`, `docs/guides/shared-resources.md`, `docs/guides/cli.md`, `docs/manual/user-guide.md`, `docs/manual/cli-guide.md`, `packages/core/src/op-guard.ts`, `packages/core/src/ddl-import.ts`, `packages/cli/src/commands/import.ts`, `apps/web/src/editor/custom-field-edits.ts`, `apps/web/src/editor/dict-edits.ts`
- 확인만: `docs/manual/local-guide.md`(Task 9 결과로 대조표가 그대로 참인지)

- [ ] **Step 1: `data-layer.md` — 상한 절을 바꾼다**

「### ⚠️ 한 뮤테이션의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이다」 절(제목부터 다음 `###` 앞까지)을 통째로 이것으로 바꾼다:

```markdown
### ⚠️ 한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이 나눠 보낸다

`apps/server/src/routers/model.ts` 가 `model.mutate`·`model.push` 의 `ops` 를 zod 로 이 값까지만 받고
Fastify `bodyLimit` 도 함께 올려 뒀다. **상한은 요청 하나의 크기다** — 본문 크기·트랜잭션 시간·실시간 방송
크기를 예측 가능하게 둔다.

- **웹은 넘는 편집을 막지 않고 나눠 보낸다.** 자르는 곳은 모델 변경의 저수준 단일 경로(`use-model.ts` 의
  `useSubmit`) 한 곳이다 — 정상 편집·실행 취소·다시 실행이 모두 거기를 지나므로 소비처(재동기화 적용·Excel
  사전 가져오기·일괄 삭제·DDL 가져오기)는 나눔을 모르고 진행 콜백(`onProgress`)만 받는다. **소비처에 상한
  가드를 다시 두지 마라** — 서버가 받아 줄 편집을 UI 가 헛되이 막는다.
- **「편집 1건 = 실행 취소 1회」는 그대로다. 「Revision 1건」은 5,000 op 이하에서만 참이다.** 나눠 보낸 편집은
  조각 수만큼 Revision 이 쌓이고 요약에 `(1/4)` 가 붙는다(`mutation-chunks.ts` 의 `chunkSummary`). 실행 취소
  기록은 전체 `Op[]` 하나라 한 번 눌러 전부 되돌아가고, 그 역연산도 같은 경로로 나뉘어 간다.
- ⚠️ **조각 순서가 정확성 조건이다.** 서버는 조각 하나를 독립된 mutation 으로 적용하므로 각 조각까지 적용한
  중간 상태가 무결성을 만족해야 한다. `diffModels` 가 낸 순서 그대로 자르면 성립한다 — 추가는 부모 먼저,
  갱신이 그 뒤, 삭제는 자식 먼저라 모든 접두사가 무결하다(아래 「`ENTITY_KINDS` 순서는 정확성 제약이다」).
  `packages/core/src/diff-prefix.test.ts` 가 참조가 걸린 대량 diff 를 5,000 경계가 참조 사이에 오게 만들어
  잠근다. **자르기 전에 op 를 재정렬·필터하지 마라.**
- **중간 조각이 실패하면 원자적이지 않다.** 앞 조각은 서버에 남는다. 웹은 거기서 멈춰 서버 상태로
  되맞추고(`resync` — 실행 취소 기록이 비워진다) 「4개 묶음 중 2개를 적용했고 나머지는 적용하지
  못했습니다 — 〈오류〉」를 띄운다. 반쯤 들어간 편집을 실행 취소 1회로 기록하면 되돌릴 op 가 서버 상태와
  어긋난다. 조각 사이에 남의 편집이 끼면(응답 `seq` 간극) 남은 조각을 끝까지 보낸 뒤 `resync` 한다.
- CLI `push` 는 나눠 보내지 않는다 — [cli.md](cli.md) 「push·병합」.
```

같은 파일 「## 알려진 한계」 → 「### 모델·op」 목록 끝에 더한다:

```markdown
- **모든 접두사 무결성은 컬럼의 소속 테이블을 바꾸는 update 에서는 성립하지 않는다.** `diffModels` 는 갱신을
  종류 순으로 내므로, 컬럼의 `tableId` 를 바꾸는 update 와 그 컬럼을 가리키는 관계·인덱스 update 사이에서
  자르면 중간 상태가 「매핑 컬럼이 없거나 소속 테이블이 다름」이 된다. 웹에는 컬럼을 다른 테이블로 옮기는
  편집이 없어 나눠 보내기가 이 모양을 만나지 않는다. 그런 편집을 만들면 조각 경계를 참조 단위로 조정해야
  한다(자리는 `use-model.ts` 의 `chunkOps` 호출).
- **나눠 보낸 편집의 Revision 은 이력 화면에서 묶여 보이지 않는다** — 요약의 `(1/4)` 로만 알아본다. 대량 편집의
  실시간 방송도 조각마다 한 번이라 다른 참여자의 화면은 조각 단위로 바뀐다.
```

- [ ] **Step 2: `shared-resources.md`**

(a) 「## 라이브러리는 op 로그 밖이다」의 「- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → Revision 1건, undo 1회로 원복된다.」를 이것으로 바꾼다:

```markdown
- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → 실행 취소 1회로 원복된다. 5,000 op 를 넘으면
  웹이 조각으로 나눠 보내 Revision 은 조각 수만큼 쌓인다([data-layer.md](data-layer.md) 「한 요청의 op 상한은
  `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이 나눠 보낸다」).
```

(b) 「## 파일 내보내기·가져오기」 바로 앞에 새 절을 넣는다:

```markdown
## 관리 화면의 항목 조회 — `resource.items.page`

관리 화면의 조회 모달(`library-view-dialog.tsx`)은 종류 하나·한 페이지만 받는다. 목록 행의 탭 개수는
`library.list`·`listForProject` 가 함께 싣는 `countsByKind` 다(`itemCount` 는 CLI 가 쓴다).

- **`items.list` 는 전체 조회로 남는다** — CLI(`dict pull`·`dict push`·`library`)와 재동기화·승격 계획이 전체를
  전제로 `planPromote`·`planResync` 를 돌린다. 형태를 바꾸지 마라.
- **권한은 `items.list` 와 같은 `requireLibraryRead` 다.** 한쪽만 고치면 볼 수 없는 라이브러리가 다른 경로로 샌다.
- **정렬은 논리명 칸(`logicalName`/`name`) 오름차순, 동률은 `id`.** 동률 깨기가 없으면 같은 이름이 많을 때
  페이지를 넘기며 항목이 겹치거나 빠진다.
- **검색은 대소문자를 무시한 부분 일치이고 `%`·`_`·`\` 를 이스케이프한다**(`resource-library.ts` 의 `escapeLike`).
  필드는 단어 `logicalName`·`abbreviation`·`englishName`, 용어 `logicalName`·`physicalName`, 도메인·커스텀
  `name`(`PAGE_SEARCH_FIELDS`)이고, 에디터 사전·도메인·커스텀 패널의 클라이언트 검색(`paginate.ts` 의
  `matchesQuery`)도 같은 필드를 쓴다 — 한쪽만 바꾸면 같은 검색어가 화면마다 다르게 걸린다.
- **세션 전용이다** — `apiProcedure` 가 아니다. 토큰 소비처가 없고 토큰에 여는 것은 명시적 opt-in 이다
  ([cli.md](cli.md) 「액세스 토큰 인증」).
- 이름이 jsonb 안에 있어 정렬·검색은 인덱스를 타지 않는다 — `(library_id, kind)` 복합 인덱스로 좁힌 뒤 거른다.
  용어 폼·용어 표의 도메인은 `items.page({ kind: 'domain', limit: 200 })` 를 끝까지 받아 푼다
  (`library-domains.ts`). 라이브러리 파일 가져오기의 Excel 변환도 도메인 이름만 이것으로 받는다.
```

(c) 「## 승격 — 가져오기의 반대 방향」의 목록 끝(「클라는 payload 를 보내지 않는다」 항목 다음)에 더한다:

```markdown
- **선택이 5,000건을 넘으면 웹이 `resource.promote` 를 조각으로 나눠 차례로 부른다**(`promote-chunks.ts` 의
  `promoteInChunks`) — 입력 `entries` 상한(`MAX_OPS_PER_MUTATION`)은 그대로다. **자르는 순서는 계획의 항목
  순서(도메인 → 단어 → 용어 → 커스텀)다** — 용어 조각을 서버가 락 안에서 다시 계획할 때 앞 조각에서 올라간
  도메인을 보게 하려는 것이다. 순서를 바꾸면 용어가 도메인 없이 올라간다. 결과는 조각별 응답을 합쳐 토스트
  하나로 보이고, 중간 실패면 「N건 중 M건 승격했습니다 — 〈오류〉」 뒤 계획을 다시 불러온다. 조각마다 한
  트랜잭션이라 중간 실패는 원자적이지 않다.
```

(d) 「## 요청·승인 큐」의 목록 끝(「원자성은 …」 항목 다음)에 더한다:

```markdown
- **요청(`promotion.create`)·승인(`promotion.resolve`)의 항목 상한은 `MAX_LIBRARY_FILE_ITEMS`(50,000)다** —
  라이브러리 파일 상한과 같은 공유 상수다. 요청은 id 목록을 저장할 뿐이고 승인은 한 트랜잭션이라 모델 op
  상한과 무관하다. **나누지 않는다** — 요청을 쪼개면 승인자가 같은 요청을 여러 번 검토해야 한다.
```

(e) 「## 알려진 한계」 → 「### 승격」 끝에 더한다:

```markdown
- **나눠 부른 승격의 중간 실패는 원자적이지 않다** — 앞 조각의 라이브러리 쓰기와 `origin` 갱신은 남는다.
  실행 취소 대상도 아니다(승격은 원래 에디터 실행 취소 밖이다).
```

「### 요청·승인 큐」 끝에 더한다:

```markdown
- **대량 승인은 한 트랜잭션·한 방송이라 실시간 방송 크기에 상한이 없다.** 승인 반영은 `mutateAndPublish` 로 가며
  op 수 검사가 없다. 나누면 요청 하나가 여러 Revision 으로 갈라지므로 두었다.
```

「### fork(가져오기)」 끝에 더한다:

```markdown
- **관리 화면 조회 모달의 정렬은 DB 정렬 규칙을 따른다.** 에디터 패널의 `localeCompare` 정렬과 한글·영문 혼합에서
  순서가 미세하게 다를 수 있다.
```

- [ ] **Step 3: `cli.md` 「push·병합」**

「- **한 push 가 op 상한(5000)을 넘으면 거부한다.** 대규모 최초 push(300테이블+)는 청크가 필요한데 **「단일 Revision = undo 1회」 계약과 상충하므로 별도 설계 대상이다.**」를 이것으로 바꾼다:

```markdown
- **한 push 가 op 상한(5000)을 넘으면 거부한다.** 웹 에디터는 넘는 편집을 조각으로 나눠 보내지만
  ([data-layer.md](data-layer.md) 「한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이
  나눠 보낸다」) push 는 `expectedSeq` 하나로 지키는 단일 배치다. 나누려면 조각마다 `expectedSeq` 를 이어 받고,
  중간 실패로 서버에 반쪽이 남았을 때 로컬 파일과 기준선을 어떻게 되맞출지를 먼저 정해야 한다 — 별도 설계 대상이다.
```

- [ ] **Step 4: `cli-guide.md`** — push 오류 표의 「변경 5,000건 초과」 행의 이유 칸 `단일 Revision = 되돌리기 1회 계약` 을 `서버가 요청 하나에 받는 상한 — push 는 나눠 보내지 않는다` 로 바꾼다(메시지 칸은 실물 출력 그대로 둔다 — CLI 동작은 바뀌지 않았다).

- [ ] **Step 5: `user-guide.md`** — 아래 자리를 바꾼다(화면 문구는 「」로 감싼다).

9절(도메인) 「**어떻게 — 수정과 일괄 반영**」 문단 바로 앞에 한 문단을 더한다:

```markdown
**어떻게 — 찾기** — 목록 위 검색창은 도메인 이름으로 찾는다. 목록은 50개씩 쪽으로 나뉘고 아래에 「이전 · 3 / 5 · 다음」과 「전체 N건」이 보인다. 분류 묶음 제목은 그 쪽에 나온 분류만 보인다.
```

10절(명명 체계) 「**어떻게 — 등록**」 문단 끝의 「두 목록 모두 「사용처 N개」가 표시되고 연필·휴지통으로 수정·삭제한다.」를 이것으로 바꾼다:

```markdown
두 목록 모두 행마다 논리명과 물리명(단어는 약어)이 나란히 보이고 「사용처 N개」가 붙으며, 연필·휴지통으로 수정·삭제한다. 탭 제목에는 「단어 (3,280)」처럼 전체 건수가 붙는다. 목록 위 검색창은 단어는 논리명·약어·영문명, 용어는 논리명·물리명으로 찾고, 목록은 50건씩 쪽으로 나뉜다.
```

11절(커스텀 항목) 「**어떻게 — 정의**」 문단 끝에 더한다:

```markdown
목록 위 검색창은 이름으로 찾고 목록은 50개씩 쪽으로 나뉜다. **검색하는 동안에는 순서(▲▼) 버튼이 잠긴다** — 걸러진 목록에서 옮기면 보이지 않는 항목과 자리가 바뀌기 때문이다.
```

13절 「### 가져오기(재동기화)」의 2번 항목 표 바로 아래에 한 문단을 더한다:

```markdown
구역마다 검색창(논리명·물리명)과 쪽 이동(50건씩)이 있고, 행에는 종류·논리명·물리명(단어는 약어)이 보인다. 쪽을 넘기거나 검색해도 체크는 그대로 남는다.
```

같은 절 4번 항목을 이것으로 바꾼다:

```markdown
4. 구역별 「모두 선택」/「모두 해제」(충돌은 「모두 원본 반영」/「모두 프로젝트 유지」)로 일괄 처리한다. 이 버튼은 **보이는 쪽이나 검색 결과가 아니라 구역 전체**에 적용된다 — 검색 중이거나 쪽이 여럿이면 버튼 옆에 「구역 전체 N건에 적용」이 붙는다.
```

같은 절 **제약** 문단을 이것으로 바꾼다:

```markdown
**제약** — 최초 가져오기는 「전 항목이 신규인 재동기화」와 같아 별도 메뉴가 없다. 5,000건을 넘는 적용은 여러 묶음으로 나눠 보낸다 — 「적용」 버튼이 잠기고 「적용 중… 2 / 4」처럼 진행이 보인다. 몇 묶음으로 갔든 적용은 편집 1건이라 **실행 취소 한 번으로 전부 되돌아간다**(버전 이력에는 묶음마다 「… (1/4)」처럼 따로 남는다). 중간 묶음이 실패하면 거기서 멈추고 「4개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 〈오류〉」가 뜬다. 이때 앞 묶음은 이미 반영돼 있고 실행 취소 기록은 비워진다 — 되돌리려면 버전(이력) 화면에서 이전 스냅샷으로 돌아간다. 원본에서 항목이 삭제돼도 프로젝트 사본은 지워지지 않는다.
```

13절 「### 승격 · 승격 요청」의 3번 항목을 이것으로 바꾼다:

```markdown
3. **쓰기 권한이 있으면** 버튼이 「승격」이다. 누르면 바로 올라가고 결과가 토스트로 나온다. 5,000건을 넘으면 나눠 올리며 버튼에 「적용 중… 1 / 2」처럼 진행이 보이고, 결과는 토스트 하나로 합쳐 나온다. 중간에 실패하면 「N건 중 M건 승격했습니다 — 〈오류〉」가 뜨고 목록을 다시 불러온다(앞서 올라간 항목은 남는다).
```

같은 절 4번 항목 첫 문장 뒤에 「한 번에 요청할 수 있는 항목은 50,000건까지다.」를 더한다. 승격 절의 구역 표 아래 「「동명 발견」에는 …」 문단 앞에 「구역마다 검색창과 쪽 이동이 있고, 「모두 선택」/「모두 해제」는 구역 전체에 적용된다(가져오기와 같다).」를 더한다.

16절 「### DDL·DBML 가져오기」의 「**형식에 따라 갈리는 것은 파서뿐이다** — 방언 선택·미리보기·경고·op 상한·적용은 완전히 같은 경로를 탄다.」에서 「op 상한·」을 뺀다. 같은 절 **그 밖의 제약**의 「- 한 번에 보낼 수 있는 양(5,000건)을 넘으면 「한 번에 가져올 수 있는 양을 넘었습니다. 입력을 나눠 올려주세요.」가 뜨고 버튼이 잠긴다.」를 이것으로 바꾼다:

```markdown
- 5,000건을 넘는 가져오기는 여러 묶음으로 나눠 보낸다 — 버튼이 「적용 중… 1 / 2」로 바뀌고 잠긴다. 몇 묶음이었든 실행 취소 한 번으로 되돌아가고, 중간 묶음이 실패했을 때의 동작은 [13절 가져오기](#가져오기재동기화)의 제약과 같다.
```

16절 「### Excel 사전 가져오기」 **제약** 문단을 이것으로 바꾼다:

```markdown
**제약** — 사전 전체가 편집 1건으로 나가므로 실행 취소 한 번으로 되돌아간다. 5,000건을 넘으면 여러 묶음으로 나눠 보내고 버튼에 「적용 중… 2 / 4」처럼 진행이 보인다(중간 묶음이 실패했을 때의 동작은 [13절 가져오기](#가져오기재동기화)의 제약과 같다). 파일 내용이 이미 사전과 같으면 「파일 내용이 현재 사전과 같아 바뀐 항목이 없습니다」가 뜬다. 적용 대상이 0건이면 버튼이 잠긴다. 처리 중에는 버튼과 파일 선택이 함께 잠기고, 실패하면 미리보기가 남아 그대로 다시 시도할 수 있다.
```

19절 「### 라이브러리 관리」 첫 문단의 「라이브러리를 클릭해 펼치면 「도메인」·「단어」·「용어」·「커스텀 항목」 네 구역이 나온다. 구역별 「추가」로 항목을 만들고 연필로 고치고 휴지통으로 지운다(항목에는 버전 `v1`…이 표시된다).」를 이것으로 바꾼다:

```markdown
목록 행에는 「〈설명〉 · 항목 16,565개」처럼 설명과 항목 수가 보인다. 행을 누르면 「라이브러리 조회 — 〈이름〉」 창이 열린다. 탭은 「단어 (3,280)」·「용어 (13,159)」·「도메인 (126)」·「커스텀 항목 (0)」처럼 종류별 건수가 붙고 처음에는 단어 탭이다. 탭마다 검색창(논리명·물리명으로 찾는다 — 도메인·커스텀 항목은 이름)과 표, 아래에 50건씩의 쪽 이동이 있다. 검색어를 바꾸면 1쪽으로 가고, 탭을 옮겼다 돌아와도 그 탭의 검색어와 쪽은 남는다. 표는 단어가 논리명·물리명·영문명, 용어가 논리명·물리명·도메인, 도메인이 이름·분류·논리 타입, 커스텀 항목이 이름·대상·타입이고 끝에 버전(`v1`…)이 붙는다. 결과가 없으면 검색 중에는 「검색 결과가 없습니다」, 빈 탭이면 「항목이 없습니다」가 뜬다. 관리 권한이 있으면 탭마다 「추가」, 행마다 연필(편집)·휴지통(삭제)이 있다.
```

20절(선택과 복사) 「**어떻게 — 일괄 작업 패널**」 문단의 마지막 문장 「한 번에 지울 것이 너무 많으면(상한 5000개 항목) 「한 번에 지우기에 너무 많습니다」가 뜨고 삭제가 잠긴다 — 나눠서 지우면 된다.」를 이것으로 바꾼다:

```markdown
지울 것이 5,000개 항목을 넘으면 여러 묶음으로 나눠 지우고 화면 아래 알림에 「적용 중… 1 / 2」처럼 진행이 보인다(확인 창은 누르는 즉시 닫힌다). 몇 묶음이었든 실행 취소 한 번으로 되돌아간다.
```

- [ ] **Step 6: 로컬 모드 매뉴얼을 확인한다**

`docs/manual/local-guide.md` 「4.2 사용 매뉴얼의 어느 장이 해당하나」 표가 9·10·11·16·20절을 「그대로」로 적는지 본다. Task 9 가 로컬 라우터의 조각 적용을 확인했으므로 **표는 그대로 참이다** — 고치지 않는다. 13·19절은 로컬 모드에 「없다」로 이미 적혀 있다. 확인한 행을 보고에 적는다.

- [ ] **Step 7: 코드 주석을 고친다**

`packages/core/src/op-guard.ts` 의 `MAX_OPS_PER_MUTATION` 주석을 이것으로 바꾼다:

```ts
/**
 * 요청 하나(mutation 1건)가 담을 수 있는 op 최대 개수. 서버 입력 검증(`model.mutate`·`model.push`·
 * `resource.promote`)과 로컬 저장소가 이 값을 쓴다. **편집 하나의 크기 상한이 아니다** — 웹은 넘는 편집을
 * 이 값씩 나눠 보낸다(guides/data-layer.md 「한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는
 * 편집은 웹이 나눠 보낸다」).
 */
```

`packages/core/src/ddl-import.ts` 의 `tableOptions` 주석 「프로젝트 설정은 op 로그 밖이라 「Revision 1건 = undo 1회」 규약이 닿지 않는다 — 모델 변경에 섞으면 되돌리기가 반쪽이 된다(설계 §5.5-3).」를 「프로젝트 설정은 op 로그 밖이라 실행 취소가 닿지 않는다 — 모델 변경에 섞으면 되돌리기가 반쪽이 된다(설계 §5.5-3).」로 바꾼다. `packages/cli/src/commands/import.ts` 의 같은 취지 주석 「「Revision 1건 = undo 1회」 규약이 닿지 않는다(설계 §5.5-3).」도 「실행 취소·되돌리기가 닿지 않는다(설계 §5.5-3).」로 바꾼다.

`apps/web/src/editor/custom-field-edits.ts` 의 `removeCustomField` 주석 둘째 줄 「단일 뮤테이션 = Revision 1건이라 실행 취소 한 번으로 값까지 되살아난다.」를 「편집 1건이라 실행 취소 한 번으로 값까지 되살아난다(값이 5,000건을 넘으면 Revision 은 조각 수만큼 쌓인다 — guides/data-layer.md 「한 요청의 op 상한은 …」).」로 바꾼다.

`apps/web/src/editor/dict-edits.ts` 의 `applyTermPropagation` 주석 「updateTerm과 같은 producer 안에서 연달아 호출해 단일 mutation(Revision 1건)으로 만든다.」를 「updateTerm과 같은 producer 안에서 연달아 호출해 편집 1건(실행 취소 1회)으로 만든다.」로 바꾼다.

- [ ] **Step 8: 남은 서술을 다시 세고 분류한다**

```bash
grep -rnE "Revision 1건|undo 1회|undo 한 번|5000건|5,000건|MAX_OPS_PER_MUTATION|실행 취소 1회|단일 뮤테이션|단일 mutation|mutation 1건" --exclude-dir=node_modules --exclude-dir=.worktrees --exclude-dir=superpowers --exclude-dir=dist . | grep -v '^./.git/'
grep -rn "한 요청의 op 상한" apps packages docs/guides | wc -l
```

남은 줄을 전부 「착수 시점 서술 목록」의 「손대지 않는다」 행(작은 편집의 Revision 1건 — 5,000 op 에 닿지 않아 참 / 서버 `bodyLimit` / CLI·로컬 저장소의 요청 상한 / 테스트의 `MAX_OPS_PER_MUTATION` 사용)과 대조해 **분류표를 보고에 적는다.** 그 어디에도 들지 않는 줄(= 여전히 「5,000에서 막는다」·「대량 편집도 Revision 1건」을 말하는 줄)이 있으면 고치고 보고한다. 둘째 명령은 이 계획이 넣은 「한 요청의 op 상한」 인용이 정본의 실제 절 제목과 같은 문자열로 시작하는지 확인하는 것이다(`grep -n "### ⚠️ 한 요청의 op 상한" docs/guides/data-layer.md` 가 한 줄이어야 한다).

- [ ] **Step 9: typecheck 와 영향받는 스위트**

```bash
pnpm -r typecheck; echo "EXIT=$?"
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/cli exec vitest run src/commands/import.test.ts
```
Expected: `EXIT=0`, 통과(주석만 바꿨다).

- [ ] **Step 10: 커밋**

```bash
git add docs/guides/data-layer.md docs/guides/shared-resources.md docs/guides/cli.md docs/manual/user-guide.md docs/manual/cli-guide.md packages/core/src/op-guard.ts packages/core/src/ddl-import.ts packages/cli/src/commands/import.ts apps/web/src/editor/custom-field-edits.ts apps/web/src/editor/dict-edits.ts && git commit -m "docs: 5,000 op 초과 편집의 나눠 보내기와 라이브러리 조회 모달을 정본·매뉴얼·주석에 적는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/guides/data-layer.md docs/guides/shared-resources.md docs/guides/cli.md docs/manual/user-guide.md docs/manual/cli-guide.md packages/core/src/op-guard.ts packages/core/src/ddl-import.ts packages/cli/src/commands/import.ts apps/web/src/editor/custom-field-edits.ts apps/web/src/editor/dict-edits.ts
```

---

### Task 16: 전체 검증 · whole-branch 리뷰 · 스모크

이 태스크는 컨트롤러가 워커(검증·스모크)와 리뷰어를 띄워 돈다(`docs/guides/worktree-workflow.md` 「sub-project 하나를 도는 흐름」 5단계). 메인 세션은 판정만 한다.

- [ ] **Step 1: 전체 스위트 체크포인트(워커)**

```bash
cd /Users/jang2162/IdeaProjects/ERDD/.worktrees/feat-large-library-ux
pnpm -r typecheck; echo "EXIT=$?"
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/cli exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
```
Expected: `EXIT=0`, 네 스위트 전부 통과, 서버 `skipped` 0. 스위트별 `Tests N passed` 를 Task 0 기준선과 나란히 보고한다(늘어난 수가 각 태스크가 더한 테스트 수와 맞는지). **`. ./.env` 를 로드하지 않는다.**

- [ ] **Step 2: whole-branch 리뷰(리뷰어 워커)** — 브리프에 이 문장들을 넣는다.
  - 「**이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라.**」(예: `useSubmit` — 정상 편집·실행 취소·다시 실행이 이제 조각을 보낸다, `requireLibraryRead` — `items.list`·`items.page`, `listWithCounts` — 두 목록 프로시저, `PromoteEntryList` — 승격 탭·승인 다이얼로그, `planPromote` 의 서버 재계산 — 조각마다 한 번.)
  - 지목할 load-bearing 리스크: ① 나눠 보내기 중 `seq`·`undoStack`·선택 정리가 단일 경로와 같은 결과를 내는가(중간 실패·seq 간극·프로젝트 이탈) ② `buildUsageIndex` 가 `wordUsage`/`termUsage` 와 갈리는 입력이 테스트 밖에 있는가 ③ `items.page` 의 권한·이스케이프·정렬 안정성 ④ 조각 승격에서 뒤 조각의 `expectedStatus`/`expectedTargetVersion` 이 앞 조각 뒤 서버 재계산과 어긋나 `plan-changed` 로 조용히 빠지는 경우가 있는가 ⑤ 걷은 5,000 가드의 서술이 코드·문서 어디에 남았는가.
  - 구현자의 보고는 **미검증 주장**이다. 리뷰어도 구분력을 **독립적으로** 실증한다(커밋 뒤, 되돌린 뒤 `git status` clean).
  - typecheck 는 `pnpm -r typecheck; echo "EXIT=$?"` 로 종료코드를 본다(파이프 금지).

- [ ] **Step 3: 수정(수정 워커)** — 리뷰가 낸 항목마다 수정 → 테스트 → 커밋 → 구분력 실증. 브리프에 워커 지시 3(「리뷰 보고서의 제안도 검증되지 않은 주장이다 …」)을 넣는다.

- [ ] **Step 4: 스모크 — 실 앱 + 실 DB(워커)**

브라우저 도구는 `CLAUDE.md` 「BrowserOS neo 가 깔려 있으면 neo 로 본다」와 `docs/guideline/browser/00-tool-choice.md` 를 따라 고른다. 렌더 속도를 재는 확인은 독립 브라우저(Playwright)로 한다. `.playwright-mcp/` 를 저장소에 남기지 않는다.

1. 좀비 프로세스를 확인하고 띄운다:
   ```bash
   lsof -nP -iTCP:3001 -iTCP:5174 -sTCP:LISTEN
   ADMIN_EMAIL=admin@erdd.local ADMIN_PASSWORD='Passw0rd!erdd' PORT=3001 ERDD_SERVER_PORT=3001 ERDD_WEB_PORT=5174 pnpm dev
   ```
   `http://127.0.0.1:5174` 로 접속한다(`localhost` 금지). 이번에 더한 `resource.items.page` 가 404 가 아니라 401 인지 `curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/trpc/resource.items.page?input=%7B%7D'` 로 확증한다(최신 서버인지).
2. **공통표준 규모 라이브러리를 만든다.** 스크래치 디렉터리(저장소 밖)에서 도메인 126 · 단어 3,280 · 용어 13,159 = 16,565건의 원천 파일을 만든다(YAML 은 JSON 의 상위집합이라 JSON 으로 써도 된다):
   ```js
   // <scratch>/gen-lib.mjs — node <scratch>/gen-lib.mjs > <scratch>/std.erdd-lib.yaml
   const pad = (i, n) => String(i).padStart(n, '0')
   const domains = Array.from({ length: 126 }, (_, i) => ({
     name: `도메인${pad(i, 3)}`, category: `분류${i % 7}`, logicalType: 'VARCHAR(100)',
     dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
     defaultValue: null, allowedValues: [], description: null,
   }))
   const words = Array.from({ length: 3280 }, (_, i) => ({
     logicalName: `단어${pad(i, 4)}`, abbreviation: `W${pad(i, 4)}`, englishName: `Word ${i}`, description: null,
   }))
   const terms = Array.from({ length: 13159 }, (_, i) => ({
     logicalName: `용어${pad(i, 5)}`, physicalName: `T_${pad(i, 5)}`, domainName: `도메인${pad(i % 126, 3)}`, description: null,
   }))
   console.log(JSON.stringify({
     format: 'erdd-library', formatVersion: 1,
     library: { name: '공통표준(스모크)', description: '행안부 공통표준 규모' },
     domains, words, terms,
   }))
   ```
   `/admin` 의 「전역 공용 리소스」 → 「파일에서 만들기」로 올린다(미리보기 「추가」 16,565건 확인 후 실행). 형식 오류가 나면 파일의 해당 필드를 고쳐 다시 만들고 무엇을 고쳤는지 보고한다. **컨트롤러 결정: 실데이터를 먼저 쓴다.** `/private/tmp/claude-501/-Users-jang2162-IdeaProjects-ERDD/fdff6296-a7b9-4087-a0cc-594dd7ce9020/scratchpad/행정안전부 공공데이터_20251101.erdd-lib.yaml`(운영 서버에 실제로 올린 행안부 공통표준 원천 파일, 도메인 126 · 단어 3,280 · 용어 13,159)이 있으면 위 합성 파일 대신 그것을 올린다 — 이 경우 아래 확인 항목의 라이브러리 이름·검색어는 실데이터에 맞춰 바꾼다(예: 용어 탭 검색 `납세자` → `TXPR_NM` 이 보임). 파일이 없을 때만 합성 파일을 쓴다.
3. **① 관리 화면 모달** — 목록 행 「… · 항목 16,565개」, 모달 탭 「단어 (3,280)」·「용어 (13,159)」·「도메인 (126)」·「커스텀 항목 (0)」, 용어 탭 검색(`T_0001` → 결과, `%`·`_` 입력 시 글자 그대로), 쪽 이동(「1 / 264」 → 「다음」), 마지막 쪽 항목 삭제 후 물러나기. 스크린샷을 남긴다.
4. **② 재동기화 16,565건** — 조직·프로젝트를 만들고(`setup.md` 「매번 물리는 것들」의 tRPC 시드 순서) 빈 프로젝트의 「공용 리소스」 → 「가져오기」 → 그 라이브러리 → 「적용」. **조각 4개**(16,565 op → 5,000·5,000·5,000·1,565)와 버튼의 「적용 중… n / 4」가 보이는지, 끝난 뒤 버전 이력에 「공용 리소스 재동기화 — 공통표준(스모크) (1/4)」…「(4/4)」 네 건이 있는지 확인한다. 이어서 「단어·용어 사전」을 열어 **열림까지 걸린 시간**을 잰다(용어 탭 전환 포함). **실행 취소 한 번**으로 사전이 전부 비는지(이력에 「실행 취소 (1/4)」… 네 건), **다시 실행**으로 돌아오는지 본다.
5. **③ 승격 5,000건 초과** — 다른 빈 조직 라이브러리를 만들고, ②의 프로젝트에서 「조직으로 승격」 → 그 라이브러리 → 「승격」. 버튼의 「적용 중… n / m」, 토스트 하나(「추가 16,565건 · 갱신 0건을 올렸습니다」)를 확인한다. 쓰기 권한 없는 Editor 로 같은 화면에서 「승격 요청」(5,000건 초과)이 받아들여지는지 본다.
6. **대조군(필수 — worktree-workflow.md 「스모크는 「동작한다」가 아니라 「고친 것이 실제로 고쳐졌다」를 봐야 한다」)** — 나눠 보내기가 실제로 필요했음을 보인다: node 스크립트로 같은 프로젝트에 `model.mutate` 를 **5,001 op 한 번에** 보내 400(zod `too_big`)이 나는 것을 확인한다(세션 쿠키는 `auth.login` 응답의 `erdd_session`). 즉 ②가 통과한 것은 저수준 경로가 나눴기 때문이다.
7. 결과(스크린샷 경로·시간·이력 문구·대조군 응답)를 보고한다. 발견한 결함은 Step 3 으로 돌린다.

- [ ] **Step 5: 병합 준비(컨트롤러)** — 모든 리뷰·스모크가 clean 이면 `docs/guides/worktree-workflow.md` 「sub-project 하나를 도는 흐름」대로 main 에 병합하고 브랜치를 지운다. **이 계획서(`docs/superpowers/plans/2026-09-24-large-library-ux.md`)는 병합 뒤 지운다.** 워크트리를 지우기 전에 격리 DB(`erdd_dev_a`·`erdd_test_a`)를 정리할지 정한다.

---

## Self-Review (계획 작성자가 돌린 점검)

**1. 설계 대비 누락 점검** — 설계의 절·요구마다 태스크를 짚었다.

| 설계 | 태스크 |
|---|---|
| 1절 `resourceSecondaryName`, 표시 규칙 | 2(core), 7(모달 표 열), 10(재동기화·승격 행), 13(사전 행) |
| 1절 `formatCount` 전 소비처(관리 목록·삭제 확인·공용 리소스 목록·탭 개수·페이지·진행·토스트) | 6(정의·페이지), 7(목록·삭제 확인·탭·가져오기 토스트), 10(공용 리소스 목록), 11(진행·요약), 12(승격 토스트·요청 토스트) |
| 2절 `items.page`(권한·검색·이스케이프·정렬·total·세션 전용) | 3 |
| 2절 `countsByKind`·`itemCount` 유지 | 4 |
| 2절 인덱스 | 4 |
| 3절 관리 화면 모달(탭·검색 300ms·페이지 50·탭별 상태·열·버전·권한·빈 문구·도메인 전체·무효화 규칙 하나) | 7 |
| 3절 가져오기 다이얼로그의 전체 조회 걷기 + 쓰임 확인·보고 | 7(확인 결과를 태스크 머리에 적음) |
| 4절 공용 부품(tabs·pagination·`filterAndPage`) | 6 |
| 4절 사전 패널(Tabs·검색·50·나란한 이름·`buildUsageIndex`·등가 잠금) | 13 |
| 4절 도메인·커스텀(검색·페이지·묶음 제목·순서 버튼 잠금) | 14 |
| 4절 재동기화·승격 목록(구역 검색·페이지·종류·논리·물리·구역 전체 선택·안내·승인 다이얼로그) | 10 |
| 5절 불변식 먼저 + 멈춤 지시 | 1 |
| 5절 규칙 1~6, 진행 표시, 실패·경합 4갈래 | 8 |
| 5절 걷는 것 넷 + 테스트 단언 전환 | 11(넷), 12(승격의 `overLimitMessage`) |
| 6절 승격 나눠 부르기·순서·합친 토스트·중간 실패·실행 취소 밖 | 12 |
| 6절 요청·승인 상한 50,000 공유 상수 | 5 |
| 7절 문서(data-layer·shared-resources·user-guide·local-guide·주석 grep) | 15(+9 로컬 확인) |
| 8절 테스트 표 전 행 | core `resourceSecondaryName`(2) · `formatCount`(6) · `items.page`(3) · `countsByKind`(4) · 조회 모달(7) · `buildUsageIndex`(13) · 에디터 패널(13·14) · 재동기화·승격 목록(10) · diff 접두사(1) · 저수준 경로(8) · 승격(12) · `promotion.create`(5) |
| 8절 구분력·스모크 | 각 태스크 마지막 Step, 16 |
| 알려진 한계 5개 | 15(data-layer·shared-resources 「알려진 한계」) |

**2. 설계와 코드 현실이 어긋난 곳(계획이 택한 것)**
- 일괄 삭제의 진행은 다이얼로그가 아니라 **토스트**다 — 다이얼로그가 제출과 함께 닫히고 `BulkPanel` 이 선택이 비면 사라진다(Task 11 머리).
- 승격 행의 물리명은 「프로젝트 엔티티」가 아니라 **`PromoteEntry.payload`**(그 엔티티를 라이브러리 공간으로 투영한 값)에서 읽는다 — 조직 승인 다이얼로그에는 모델 store 가 없다. 약어·물리명은 투영에서 바뀌지 않으므로 값은 같다(Task 10).
- 「모든 접두사 무결성」은 컬럼 `tableId` 를 바꾸는 update 에서는 일반적으로 참이 아니다 — 웹에 그런 편집이 없어 이 사이클에는 걸리지 않는다(Task 1 참고, Task 15 가 한계로 기록).
- 요약이 없는 편집을 나눌 때 설계가 문구를 정하지 않았다 — `대량 편집 (i/n)` 을 쓴다(Task 8). 요약 200자 상한 때문에 원래 요약을 자른다.

**3. 타입·이름 일관성** — 태스크 사이에 넘어가는 이름을 대조했다: `resourceSecondaryName`(2→7·10·13), `loadLibraryItemPage`·`escapeLike`·`PAGE_SEARCH_FIELDS`(3), `countsByKind`(4→7), `formatCount`·`formatProgress`·`PAGE_SIZE`·`matchesQuery`·`filterAndPage`·`useListPage`·`useDebouncedValue`·`Tabs*`·`Pagination`(6→7·10·11·12·13·14), `useLibraryDomains`·`libraryDomainsQueryKey`·`fetchAllDomainOptions`(7), `MutationProgress`·`onProgress`·`chunkOps`·`chunkSummary`·`chunkFailureMessage`(8→11), `PagedSection`(10), `promoteInChunks`·`toPromoteRequest`·`promoteFailureMessage`(12), `buildUsageIndex`·`UsageIndex`(13). 정본 절 제목 「한 요청의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이고, 넘는 편집은 웹이 나눠 보낸다」는 Task 8·11 주석과 Task 15 가 같은 앞머리로 가리킨다(Task 15 Step 8 이 센다).

**4. Review Focus** — 다섯 줄 각각의 테스트가 담당 태스크에 들어 있다(검색 특수 문자: 3·6, 페이지 줄어듦: 6·7, 중간 실패 뒤 UI: 11, 실시간+곧바로 실행 취소: 8, 검색 중 모두 선택: 10).
