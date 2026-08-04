# 공용 리소스 승격 설계 — 프로젝트 → 조직/전역 라이브러리 (fork의 반대 방향)

**작성일:** 2026-08-04
**상태:** 승인됨 (brainstorming 6문항 모두 권장안 채택)
**원 기획:** [docs/01-concepts.md](../../01-concepts.md) "공용 리소스 패턴" 4항 — "반대 방향(프로젝트 → 조직 리소스로 승격)"
**선행 설계:** [Phase 2 #4 공용 리소스 fork](2026-07-28-phase2-shared-resources-fork-design.md)

## 1. 목적과 범위

프로젝트에서 다듬은 사전 항목(`domain`/`word`/`term`/`customField`)을 **조직 또는 전역 라이브러리로 올린다.** Phase 2 #4가 만든 것이 라이브러리 → 프로젝트(fork·재동기화) 한 방향이었고, 이 설계가 그 거울상을 채운다. 실사용 흐름은 "표준 사전을 가져와 프로젝트에서 현실에 맞게 고친 뒤, 그 결과를 조직 표준으로 굳힌다"이다.

**범위:** 승격 계획 계산(core) · 단일 트랜잭션 승격 프로시저(server) · 공용 리소스 다이얼로그의 두 번째 탭(web).

**범위 밖:** 요청·승인 큐(§9), 라이브러리 → 라이브러리 복사, 승격 취소(라이브러리 항목 삭제는 기존 관리 화면), 배열 원소 단위 병합, 조직 리소스 화면에서 보는 역방향 미리보기.

**마이그레이션 없음. 새 op 엔티티 없음. 새 런타임 의존성 없음.**

## 2. 확정된 결정 (사용자 확정)

1. **승인 상태 머신을 만들지 않는다.** 라이브러리에 쓰기 권한이 있는 사람(조직 라이브러리 → Org Owner/Admin, 전역 → 서비스 관리자)이 프로젝트 화면에서 직접 승격한다. 요청 큐·알림·`promotion_requests` 테이블이 없다 — 이 도구에는 메일/알림 인프라가 없어 요청 큐를 만들면 아무도 안 보는 채 쌓인다. 기존 `requireScopeWrite`를 그대로 쓴다.
2. **다른 라이브러리에서 온 항목의 승격을 허용하고, `origin`을 대상 라이브러리로 재연결한다.** 프로젝트 항목은 한 순간 상류 하나만 따른다(git remote 하나). 전역 fork 항목을 조직으로 승격하면 이후 상류는 조직이다.
3. **대상에 동명 항목이 있으면 "기존 항목 갱신" 후보로 띄우되 기본 보류.** `planResync`의 `nameClash` 기본 보류 규칙과 대칭이다.
4. **라이브러리 쓰기와 프로젝트 `origin` 갱신은 한 트랜잭션.** `runMutation`에 트랜잭션 내 선행 훅을 추가하고 `mutateAndPublish`를 그대로 통과시켜, 유일 진입점 불변식(HANDOFF 3.6)과 Revision 1건·undo 1회·실시간 브로드캐스트를 모두 유지한다.
5. **UI는 기존 "공용 리소스" 다이얼로그의 두 번째 탭.** 양방향이 한 화면에 모이고, 여러 항목을 한 번에 올리는 실사용 흐름과 맞는다.
6. **승격하는 용어의 도메인이 대상 라이브러리에 없으면 연결을 비우고 경고한다.** `planResync`가 반대 방향에서 쓰는 규칙(색인에 없으면 `null`)과 정확히 대칭이다.

## 3. 의미 모델

### 3.1 승격의 3상태

라이브러리 하나를 대상으로 프로젝트 사전 4종을 훑어 항목별 상태를 낸다.

| 상태 | 조건 | 라이브러리 쓰기 | 프로젝트 쓰기 | 기본 결정 |
|---|---|---|---|---|
| `new` | 대상에 링크도 동명도 없음 | insert (v1) | `origin` 부여 | 선택 |
| `update` | `origin.libraryId === 대상`이고 그 원본 항목이 살아 있으며 payload가 다름 | update (v N→N+1) | `origin` 갱신 | 선택 |
| `name-match` | 링크는 없지만 대상에 **같은 종류·같은 표시 이름**의 항목이 있음 | update (v N→N+1) | `origin` 부여(연결) | **보류** |
| (목록 제외) | 링크돼 있고 payload가 같음 | — | — | `syncedCount`로만 집계 |

- 판정 순서는 위 표의 순서다. `origin.libraryId`가 대상을 가리키는데 **그 원본 항목이 사라졌으면** 링크 없음으로 내려가 `name-match` 또는 `new`가 된다(재동기화 쪽 `keptDetached`와 대칭).
- 대상에 동명이 여러 개면 목록 순서(= `createdAt` 오름차순)의 첫 항목을 고른다.
- 표시 이름은 `resourceDisplayName(kind, payload).trim()`으로 비교한다(재동기화의 `nameClash`와 같은 기준).
- "payload가 다름"의 비교 대상은 §3.4의 **잠정 payload**다. 용어의 도메인이 대상 라이브러리에 링크돼 있으면 양쪽 모두 라이브러리 항목 id로 해석되고, 링크가 없으면 양쪽 모두 `null`이라(승격 당시 비웠으므로) 판정이 흔들리지 않는다.
- 정렬은 `RESOURCE_KINDS` 순 → 이름 `localeCompare`. 도메인이 용어보다 앞이라 "도메인을 먼저 고른다"는 흐름이 화면 순서로 유도된다.

### 3.2 승격은 프로젝트 엔티티의 내용을 바꾸지 않는다

프로젝트 쪽 변경은 **`origin` 필드 하나뿐**이다(`{ ...entity, origin }`). 따라서 `diffModels`가 내는 op는 전부 `update`이고 `changes`는 `origin` 1개다. 선택 항목 수 = op 수다. `customField.order`는 엔티티를 통째로 교체하지 않으므로 자연히 보존된다.

### 3.3 `origin.base`는 "가져오기 직후"와 똑같이 만든다 (핵심 불변식)

승격 후 써넣는 `base`는 프로젝트의 현재 payload가 **아니라**, 방금 라이브러리에 쓴 payload를 **다시 프로젝트 공간으로 투영한 값**이다 — 즉 import 경로의 `projectPayload()`를 한 번 더 통과시킨다. `base`의 정의가 "가져온 시점에 프로젝트 공간으로 투영해 써넣은 payload"(HANDOFF 3.2b)이므로, 승격도 그 정의를 그대로 만족시켜야 두 엔진이 맞물린다.

- **정상 케이스**(용어의 도메인도 라이브러리에 있음): 왕복이 항등이라 `base === payloadOf(현재 엔티티)` → 다음 재동기화에서 "수정 없음"으로 잡히고 `syncedCount`에 들어간다.
- **도메인 연결이 비워진 용어**: `base.domainId = null ≠ 프로젝트의 domainId` → 그 항목은 즉시 "프로젝트가 수정함"으로 잡힌다. **이게 옳다.** 나중에 원본이 갱신됐을 때 `auto-update`로 조용히 적용돼 **프로젝트 용어의 도메인 연결이 지워지는 사고**를 구조적으로 막는다(대신 `conflict`로 떠서 사람이 본다).

### 3.4 역투영 (프로젝트 공간 → 라이브러리 공간)

참조를 갖는 종류는 `term.domainId`뿐이다(`projectPayload`의 대칭). 프로젝트 도메인 엔티티 id를 라이브러리 항목 id로 바꾸는 규칙:

1. 그 도메인의 `origin.libraryId === 대상 라이브러리`이고 원본 항목이 살아 있으면 → `origin.sourceId`
2. 그 도메인이 **같은 배치에서 함께 승격**되면 → 그 도메인의 대상 항목 id(`new`면 새로 발급한 id, `update`/`name-match`면 기존 항목 id)
3. 둘 다 아니면 → `null` (경고)

`planPromote`는 선택 전 상태라 2를 알 수 없다. 그래서 계획은 **1만 적용한 잠정 payload**를 싣고, 2·3의 최종 판정은 선택 집합을 받는 `applyPromotePlan`이 한다. 계획은 대신 `domainRef`를 실어 UI가 "도메인을 함께 선택하면 연결됩니다"를 판단할 수 있게 한다.

## 4. core — `packages/core/src/resource-promote.ts` (신규)

`resource-sync.ts`와 대칭이고 IO·난수 비의존이다.

```ts
export type PromoteStatus = 'new' | 'update' | 'name-match'

export type PromoteEntry = {
  kind: ResourceKind
  /** 프로젝트 엔티티 id — 선택·요청의 키다. */
  entityId: string
  name: string
  status: PromoteStatus
  /** update/name-match면 갱신할 원본 항목 id. new면 null. */
  targetItemId: string | null
  /** 그 원본 항목의 현재 버전. new면 null. */
  targetVersion: number | null
  /** 라이브러리 공간으로 역투영한 **잠정** payload(§3.4의 1만 적용). 표시·changedFields용. */
  payload: Record<string, unknown>
  /** 원본 항목 payload 대비 바뀐 필드. new면 []. */
  changedFields: string[]
  /**
   * term의 도메인 참조. term이 아니거나 domainId가 null이거나 그 도메인 엔티티가
   * 모델에 없으면 null. targetItemId가 null이면 "함께 승격해야 연결된다"는 뜻이다.
   */
  domainRef: { entityId: string; targetItemId: string | null } | null
}

export type PromotePlan = {
  libraryId: string
  entries: PromoteEntry[]
  /** 대상에서 왔고 값이 같아 목록에서 제외된 항목 수. */
  syncedCount: number
}

export type PromoteWrite = {
  mode: 'insert' | 'update'
  itemId: string
  kind: ResourceKind
  payload: Record<string, unknown>
  /** 저장할 버전 — insert면 1, update면 targetVersion + 1. 서버는 이 값을 그대로 쓴다. */
  version: number
}

/** 프로젝트 모델 + 대상 라이브러리 항목 → 승격 계획(순수). */
export function planPromote(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): PromotePlan

/**
 * 선택된 항목에 대해 라이브러리 write 목록과 origin이 갱신된 다음 모델을 함께 낸다.
 * 선택이 비면 { writes: [], nextModel: model }.
 */
export function applyPromotePlan(
  model: ProjectModel,
  plan: PromotePlan,
  selected: ReadonlySet<string>,   // entityId 집합
  newId: () => string,             // 새 라이브러리 항목 id 발급기(주입)
): { writes: PromoteWrite[]; nextModel: ProjectModel }
```

`applyPromotePlan`은 `applyResyncPlan`과 같은 2-pass다.

1. **색인 완성** — 선택된 `new` 항목에 id를 먼저 전부 발급하고, 선택 여부와 무관하게 이미 대상 라이브러리에 링크된 도메인의 `origin.sourceId`도 색인에 넣는다(§3.4의 1·2).
2. **항목별 처리** — 최종 payload = `libraryPayload(kind, resourcePayloadOf(entity), 색인)`. `writes`에 insert/update를 쌓고, `nextModel`의 엔티티에 `origin = { libraryId, sourceId: itemId, sourceVersion: new ? 1 : targetVersion + 1, base }`를 넣는다. `base`는 §3.3대로 최종 payload를 **프로젝트 공간으로 되투영**한 값이며, 되투영 색인은 "기존 origin(대상 라이브러리) + 이번 배치에서 부여될 (itemId → entityId)"의 합집합이다.

`version`을 core가 계산해 싣는 이유는 §5.2의 행 락 때문이다 — 계획을 세운 트랜잭션이 그 행을 이미 잠그고 있으므로 `version + 1`을 SQL 식으로 미룰 필요가 없고, 값이 계획에 있으면 core 테스트가 버전 진행을 직접 고정할 수 있다.

**같은 대상을 두 항목이 주장하지 못하게 한다.** 프로젝트에 같은 이름의 엔티티가 둘 있거나 두 엔티티가 같은 `origin.sourceId`를 들고 있으면 하나의 원본 항목에 두 번 쓰게 된다. `planPromote`는 먼저 나온 항목이 대상을 **선점**하게 하고, 뒤에 나온 항목은 `new`로 떨어뜨린다.

## 5. 서버

### 5.1 `runMutation`에 트랜잭션 내 선행 훅

```ts
runMutation(tx, {
  projectId, actorUserId, source,
  prepare?: (tx: MutationTx, model: ProjectModel) => Promise<void>,  // 신규
  deriveOps, summary,
})
```

프로젝트 행 `FOR UPDATE` 락 획득 → `loadProjectModel` **뒤**, `currentSeq`/`deriveOps` **앞**에 호출한다. `mutateAndPublish`가 인자를 그대로 통과시킨다. 기존 호출자 3곳(`model.mutate`·`snapshot.restore`·`model.push`)은 인자를 주지 않아 무영향이다.

**이 훅의 존재 이유**: 라이브러리 쓰기가 프로젝트 행 락 안에서, 권위 모델을 손에 쥔 채 일어나야 한다. 훅 없이 하려면 `runMutation`을 직접 부르는 네 번째 호출자가 생기고, 그 순간 브로드캐스트를 손으로 발행해야 해 3.6절의 불변식이 깨진다.

### 5.2 `resource.promote` (`authedProcedure` — 세션 전용, 토큰 allowlist 아님)

```ts
input: {
  projectId: uuid
  libraryId: uuid
  entries: { entityId: uuid; expectedStatus: PromoteStatus; expectedTargetItemId: uuid | null }[]
          // .min(1).max(MAX_OPS_PER_MUTATION)
}
output: { seq: number; inserted: number; updated: number; skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[] }
```

**권한 3중** (트랜잭션 전):

1. `requireProjectAccess(db, projectId, userId, 'edit')`
2. `requireLibraryWrite(db, libraryId, user)` — 조직은 Owner/Admin, 전역은 서비스 관리자
3. `library.scope === 'org' && library.orgId !== project.orgId` → `FORBIDDEN`. 3이 없으면 **두 조직에 속한 사용자가 A조직 프로젝트의 사전을 B조직 라이브러리로 흘릴 수 있다.**

**payload는 클라에서 받지 않는다.** 서버가 트랜잭션 안에서 모델과 라이브러리 항목을 다시 읽어 `planPromote`를 재계산한다. 클라가 보낸 `expectedStatus`/`expectedTargetItemId`와 다르면 그 항목만 **건너뛴다**(`skipped`). 건너뛴 항목은 라이브러리에도 모델에도 아무것도 쓰지 않으므로 원자성은 그대로다.

- entry가 재계산 계획에 없음(그새 동기화됐거나 엔티티 삭제) → `missing`
- `status`나 `targetItemId`가 다름 → `plan-changed`

**`prepare` 안의 순서:**

```ts
const items = await tx.select(...).from(resourceItems)
  .where(eq(resourceItems.libraryId, libraryId))
  .orderBy(asc(resourceItems.createdAt))
  .for('update')                                   // ← 라이브러리 항목 전체를 잠근다
const plan = planPromote(model, libraryId, items)
// 클라 기대와 대조 → selected / skipped
const { writes, nextModel } = applyPromotePlan(model, plan, selected, uuidv7)
for (const w of writes) { /* insert(version: 1) 또는 update(payload, version: version + 1) */ }
await tx.update(resourceLibraries).set({ updatedAt: new Date() }).where(...)
```

`FOR UPDATE`로 라이브러리 항목을 잠그고 그 값으로 계획을 세우므로 **버전 경합이 구조적으로 불가능하다**(`items.update`가 동시에 들어와도 우리 커밋 뒤로 밀린다). 락 순서는 항상 (프로젝트 행 → 라이브러리 항목)이고 반대로 잡는 경로가 없어 데드락이 없다.

`deriveOps`는 `diffModels(model, nextModel)`이다. 전부 skip되면 `writes`도 ops도 비어 `runMutation`이 Revision 없이 현재 seq를 돌려준다.

### 5.3 `library.listForProject`에 `canWrite: boolean`

각 행에 대해 전역이면 `user.role === 'admin'`, 조직이면 내 조직 역할이 `owner`/`admin`인지를 서버가 판정해 실어 보낸다. **클라가 역할 조합식을 재현하지 않는다**(HANDOFF 6절 `project-settings.tsx` 교훈).

## 6. 웹

`editor/resource-panel.tsx`(299줄)를 껍데기로 줄이고 탭으로 분리한다. 한 파일에 양방향을 다 넣으면 600줄이 넘는다.

| 파일 | 책임 |
|---|---|
| `editor/resource-panel.tsx` (수정) | 다이얼로그 + 탭 전환 + 라이브러리 목록(두 탭 공유) |
| `editor/resource-resync-tab.tsx` (신규) | 기존 가져오기/재동기화 내용을 그대로 이동 |
| `editor/resource-promote-tab.tsx` (신규) | 승격 계획 3구역 · 선택 · 호출 |
| `editor/promote-selection.ts` (신규) | 선택 상태 순수 헬퍼(`resource-decisions.ts`와 대칭) |

- 탭 UI 프리미티브(`ui/tabs.tsx`)는 리포에 없다. **새로 추가하지 않고** 버튼 2개에 `role="tablist"`/`role="tab"`/`aria-selected`를 손수 붙인다.
- 승격 탭은 `canEdit && canWrite인 라이브러리 ≥ 1`일 때만 보인다. 라이브러리 목록에서도 `canWrite`인 것만 고를 수 있다.
- 3구역(신규 추가 / 원본 갱신 / 동명 발견) + 항목별 체크박스 + 구역 일괄 버튼. `domainRef`가 미해결인 용어에는 "도메인 연결 비움" 경고 배지를 띄우고, 도메인을 함께 선택하면 배지가 사라진다.
- 선택 수가 `MAX_OPS_PER_MUTATION`을 넘으면 적용 전에 막는다. **이 파일의 `MAX_OPS = 500` 상수는 서버(5000)와 어긋난 채 남아 있으므로 이번에 `MAX_OPS_PER_MUTATION`으로 통일한다**(재동기화 쪽 가드 포함).
- **성공 처리**: `model.get`을 재조회해 `resync(fresh.model, fresh.seq)`. 스냅샷 복원과 같은 패턴이되 `setLoaded`가 아니라 **`resync`** 다 — 승격은 사전만 건드리므로 `activeGroupView`가 튕기면 안 된다(HANDOFF 3.6). 이어서 `resource.items.list`·`library.listForProject` 쿼리를 invalidate하고 토스트를 띄운다(`추가 N · 갱신 M`, skip이 있으면 "K건은 그 사이 상태가 바뀌어 건너뛰었습니다").
- 승격은 낙관적 반영을 하지 않는다(서버가 op를 만든다). 실패는 토스트만 띄우고 모델을 건드리지 않는다.

## 7. 파일 구조

**core**

| 파일 | 변경 |
|---|---|
| `src/resource-promote.ts` | 신규 — `planPromote`/`applyPromotePlan`/타입 |
| `src/resource-promote.test.ts` | 신규 |
| `src/index.ts` | 신규 export |

**server**

| 파일 | 변경 |
|---|---|
| `src/services/mutation.ts` | `prepare` 훅 |
| `src/services/mutate-publish.ts` | `prepare` 통과 |
| `src/routers/resource.ts` | `promote` 프로시저, `listForProject`에 `canWrite` |
| `src/routers/resource.test.ts` | 확장 |
| `src/routers/resource-promote.test.ts` | 신규(실 DB 통합) |

**web**

| 파일 | 변경 |
|---|---|
| `src/editor/resource-panel.tsx` | 껍데기 + 탭 |
| `src/editor/resource-resync-tab.tsx` | 신규(기존 내용 이동) |
| `src/editor/resource-promote-tab.tsx` | 신규 |
| `src/editor/promote-selection.ts` | 신규 |
| 각 `*.test.tsx` / `*.test.ts` | 이동·신규 |

**docs**

`01-concepts.md` 4항을 구현에 맞게 고치고(승인 큐가 아니라 권한 기반 직접 승격), `90-roadmap.md`·`HANDOFF.md`를 갱신한다.

## 8. 테스트 전략

**결정적인 것 하나 — 두 엔진의 왕복.** 승격 직후 같은 라이브러리로 `planResync`를 돌리면 그 항목이 `entries`에 없고 `keptSynced`에 잡혀야 한다. §3.3의 `base` 규칙이 깨지면 이 테스트가 즉시 깨진다. 짝이 되는 반대 테스트: **도메인을 빼고 용어만 승격**하면 그 용어는 다음 재동기화에서 `auto-update`가 아니라 `conflict` 후보가 된다.

core

- 상태 분류 4종(`new`/`update`/`name-match`/제외) + 원본 항목이 사라진 링크가 `name-match`/`new`로 내려가는 것
- 역투영 3경로(이미 링크된 도메인 / 같은 배치 승격 / 미해결 → `null` + `domainRef`)
- `applyPromotePlan`: writes의 insert·update 구성, `nextModel`이 `origin` **외 필드를 바꾸지 않음**, `customField.order` 보존, 빈 선택이 입력 모델을 그대로 반환
- `sourceVersion`이 `targetVersion + 1`인 것(승격 직후 동기 상태)
- `RESOURCE_KINDS` 전 종류가 승격 가능한지 확인하는 완전성 테스트(`resource-sync`·`model-diff`의 선례)
- 정렬 순서(종류 → 이름)

server (실 DB)

- 권한 3중 거절 각각 + 정상 통과
- **원자성**: `prepare`가 라이브러리에 쓴 뒤 op 적용이 실패하면 라이브러리 항목도 롤백된다
- `skipped` 2종(`missing`/`plan-changed`)이 그 항목만 제외하고 나머지를 커밋
- 전부 skip이면 Revision이 생기지 않고 seq가 그대로
- 실시간 채널로 `origin` update op가 발행된다(`model.push` 테스트의 선례)
- `entries` 상한(`MAX_OPS_PER_MUTATION`) 초과 거절
- `listForProject`의 `canWrite`가 역할별로 맞게 나온다

web

- 탭 가시성 3케이스(권한 없음 / `canWrite` 라이브러리 없음 / 정상)
- 계획 3구역 렌더 + `name-match` 기본 미선택
- 도메인 함께 선택 시 경고 배지가 사라짐
- 성공 후 `resync` 호출(`setLoaded`가 아님) + 토스트 문구(skip 포함)
- 기존 재동기화 탭 테스트가 이동 후에도 그대로 통과

## 9. 알려진 한계 (이월 후보)

- **요청·승인 큐 없음.** 쓰기 권한이 없는 Editor는 승격 탭 자체를 못 본다. 확장점: `promotion_requests` 테이블 + 조직 화면의 승인 목록. `01-concepts.md` 4항의 "승인"은 이 설계에 맞게 "권한 기반"으로 고친다.
- **전역 fork 항목을 조직으로 승격하면 전역 재동기화 목록에 그 원본이 `added`로 다시 뜬다.** `nameClash`가 붙어 기본 미선택이라 중복 생성은 막히지만, 매번 목록에 남는다. 해소하려면 "무시" 상태를 기록할 자리(모델 필드)가 필요해 범위 밖이다.
- **undo는 `origin`만 되돌린다.** 라이브러리에 쓴 항목은 남는다(op 로그 밖이라 구조적으로 그렇다). 라이브러리 관리 화면에서 지워야 한다.
- **승격은 프로젝트 항목의 삭제를 원본에 반영하지 않는다.** 프로젝트에서 지운 단어가 조직 표준에서 사라지지는 않는다(반대 방향의 "원본에서 삭제된 항목은 그대로 둔다"와 대칭인 보수적 정책).
- **동명 판정이 표시 이름 완전일치다.** 공백·대소문자 정규화나 동의어 매칭은 하지 않는다.
- 대상에 동명이 여러 개면 첫 항목을 고른다(사용자가 어느 것인지 고를 수 없다).
- 한 승격의 op 수가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 막는다. 청크 적용은 "단일 Revision = undo 1회" 계약과 충돌해 별도 설계 대상이다.
- 승격 미리보기의 `payload`는 잠정값이라(§3.4) 도메인을 함께 선택하면 실제 저장되는 값과 `changedFields` 표시가 미세하게 다를 수 있다(표시 전용).
- **라이브러리 항목 payload에 키가 아예 없으면 그 필드가 `changedFields`에 잡힌다.** 부팅 시드(`ensureStarterGlobalLibrary`)만 `RESOURCE_PAYLOAD_SCHEMAS` 파싱을 우회해 payload를 넣어서 `word.englishName` 키가 없다 — `items.create`/`update`를 거친 항목은 zod 기본값이 채워져 이 문제가 없다. 표시 전용 노이즈다.
