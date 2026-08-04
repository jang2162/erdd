# 공용 리소스 승격 요청·승인 큐 설계

**작성일:** 2026-08-04
**상태:** 승인됨 (brainstorming 5문항 모두 권장안 채택)
**선행 설계:** [공용 리소스 승격](2026-08-04-resource-promotion-design.md) — 이 설계는 그 §9 첫 항목("요청·승인 큐 없음")을 채운다
**관련 기획:** [docs/01-concepts.md](../../01-concepts.md) "공용 리소스 패턴" 4항

## 1. 목적과 범위

라이브러리 쓰기 권한이 없는 Project Editor에게 **승격을 요청할 길을 준다.** 지금은 승격 탭 자체가
`canWrite`인 라이브러리가 하나도 없으면 숨겨져, 프로젝트에서 사전을 다듬은 사람이 그것을 조직 표준으로
올릴 방법이 없다. 실사용 흐름은 "Editor가 정리한 용어를 골라 요청 → Org Owner/Admin이 조직 화면에서
검토하고 일부 또는 전부 승인"이다.

**범위:** 요청 테이블(마이그 0011) · 요청/승인 프로시저(server) · 조직 화면의 승인 목록과 상세 ·
헤더·홈의 대기 건수 배지 · 승격 탭의 요청 모드.

**범위 밖:** 전역 라이브러리 요청(§2.3) · 메일/소켓 푸시 알림 · 생성 후 요청 항목 편집 ·
pending 자동 만료 · 승격 설계 §9의 나머지 한계(동시 INSERT로 인한 동명 항목, 락 순서 데드락).

**core 변경 없음. 새 op 엔티티 없음. 새 런타임 의존성 없음. 마이그레이션 0011 하나.**

### 1.1 선행 설계의 결정을 뒤집는 부분

승격 설계의 결정 #1은 **"승인 상태 머신을 만들지 않는다"** 였고, 근거는 "이 도구에는 메일/알림
인프라가 없어 요청 큐를 만들면 아무도 안 보는 채 쌓인다"였다. 이번 사이클은 그 결정을 뒤집는다.
근거를 무효화하는 것은 §2.2의 **배지**다 — 승인자가 조직 화면까지 찾아 들어가지 않아도, 로그인해서
어느 화면에 있든 대기 건수가 보인다. 배지가 없으면 원래 우려가 그대로 성립하므로, 배지는 이 설계에서
있으면 좋은 장식이 아니라 **큐를 성립시키는 전제**다.

`01-concepts.md` 4항은 지난 사이클에 "요청·승인 큐는 두지 않는다"로 고쳐졌다. 이번에 다시 고친다 —
쓰기 권한자는 직접 승격하고, 권한이 없으면 요청한다.

## 2. 확정된 결정 (사용자 확정)

### 2.1 요청 행은 엔티티 포인터만 담는다

요청은 `{projectId, libraryId, entityIds[]}` + 요청자·시각·메모다. **payload를 동결하지 않는다.**
승인 화면을 열 때 서버가 `planPromote`를 다시 돌려 지금의 값·상태를 보여주고, 승인은 그 시점 계획으로
승격한다.

이 선택이 사는 이유는 기존 `resource.promote`가 이미 **"클라는 payload를 보내지 않고 서버가 락 안에서
계획을 재계산한다"** 구조이기 때문이다(승격 설계 §5.2). 요청을 포인터로 두면 승인은 그 구조에 인자를
하나 더 얹은 것이 되고, `origin.base` 불변식(승격 설계 §3.3)을 어느 시점 기준으로 쓸지 다시 유도할
필요가 없다. payload를 동결했다면 그 사이 엔티티가 삭제됐을 때 `origin`을 쓸 대상이 없어지고, 요청 행이
프로젝트 모델과 별개의 진실 원본이 된다.

대가는 **요청 뒤 프로젝트에서 값을 고치면 고친 값이 올라간다**는 것이다. 이것은 대체로 옳은 동작이고
(오타를 고쳤으면 고친 것이 올라가야 한다), 승인 화면이 항상 최신을 보여주므로 승인자가 모르는 값이
올라가지는 않는다.

### 2.2 승인자에게 닿는 방법은 조직 화면 + 헤더 배지

승인 목록은 조직 화면(`ResourceLibraryManager` 옆)에 두고, 앱 셸 헤더에 "내가 승인해야 할 요청 N건"
배지를 단다. 홈의 조직 카드에는 조직별 건수를 단다. 전송은 tRPC 쿼리 폴링이라 **새 인프라가 붙지
않는다.**

실시간 푸시는 하지 않는다. 현재 실시간 채널은 `/ws?projectId=` 프로젝트 단위뿐이라 조직 단위 채널을
새로 만들어야 하고(허브 구조·구독 모델·인증이 모두 확장된다), 승인자는 보통 그 프로젝트 화면에 있지도
않아 실익이 배지 대비 크지 않다.

요청자 쪽으로도 푸시하지 않는다. 요청자는 프로젝트 승격 탭에서 자기 요청 상태를 조회한다.

### 2.3 대상은 조직 라이브러리만

전역 라이브러리로는 요청을 걸 수 없다. 전역은 ERDD가 제공하는 표준 사전(행안부 등)이라 사용자 조직이
거기에 올릴 일이 사실상 없고, 필요하면 서비스 관리자가 현행대로 직접 승격한다. 포함했다면 승인 화면이
관리자 화면에 하나 더 생기고 권한 판정·배지 집계가 전부 두 갈래가 된다.

요청 생성은 `library.scope === 'org' && library.orgId === project.orgId`를 강제한다. 이는
`resource.promote`의 3중 게이트 중 3번과 **같은 규칙**이다(없으면 두 조직에 속한 사용자가 A조직
프로젝트의 사전을 B조직 라이브러리로 흘린다).

### 2.4 요청은 항목 묶음이고 한 번에 처리된다

요청 1건 = 항목 여러 개. 승인자는 체크박스로 골라 승격하고, **한 번 처리하면 요청은 닫힌다** —
고르지 않은 항목은 반려로 기록되고 부분 pending 상태는 없다.

묶음인 이유는 이 기능의 의미 때문이다. 용어와 그 도메인을 **함께** 올려야 도메인 연결이 살아남는다
(승격 설계 §3.4의 역투영 경로 2). 요청을 항목 1건씩 쪼개면 그 묶음이 곧 의미인 정보가 흩어진다.

"1회 처리"인 이유는 상태 머신 때문이다. 부분 pending을 허용하면 요청 행이 "처리된 항목 목록"을 들고
계속 살아 있어야 하고, 다음 처리 때 그 목록과 재계산 계획을 다시 대조해야 한다. 남은 항목을 계속 올리고
싶으면 새 요청을 만들면 된다 — §2.5가 그것을 허용한다.

### 2.5 같은 프로젝트·같은 라이브러리로 pending 요청이 여러 건 있어도 된다

유니크 제약을 두지 않는다. 같은 항목이 두 요청에 걸려도 먼저 처리된 쪽이 승격되고, 나머지 요청은 열 때
계획을 재계산하므로 그 항목이 자연히 빠져 `unavailable`로 드러난다 — **포인터 모델이라 공짜로 풀리는
성질이다.** 부분 유니크 인덱스로 막았다면 "남의 요청 때문에 내가 올리지 못하는" 막다른 길과 "기존 요청에
항목 추가" 병합 경로를 함께 설계해야 했다.

## 3. 의미 모델

### 3.1 상태 4종 (단방향)

```
pending ──approve(1건 이상 승격)──▶ resolved
        ──reject(0건 승격)────────▶ rejected
        ──cancel(요청자·프로젝트 manage)─▶ cancelled
```

`pending`에서만 전이한다. 이미 전이한 요청에 대한 처리 시도는 `CONFLICT`다. 처리된 요청은 지우지 않고
남긴다(감사 흔적) — 목록의 기본 필터가 `pending`이다.

**`resolved`와 `rejected`를 가르는 것은 승인자가 고른 항목 수(`approve` 배열의 길이)이지, 실제로
승격된 수가 아니다.** 승인자가 체크박스를 전부 풀고 제출하면 `rejected`, 하나라도 고르면 `resolved`다.
고른 항목이 서버 재계산에서 전부 건너뛰어져(`skipped`) 실제 승격이 0건이 된 경우도 `resolved`로
남긴다 — 승인자의 의사는 승인이었고, 무슨 일이 있었는지는 `approvedEntityIds`(빈 배열)와 응답의
`skipped` 내역이 말한다. 판정 기준을 "실제 승격 수"로 두면 승인 의사와 경합 결과가 한 필드에 섞인다.

### 3.2 요청 시점과 승인 시점 사이

승인 화면이 여는 계획은 **지금** 계산한 것이므로, 요청의 `entityIds`는 셋 중 하나로 갈린다.

| 갈래 | 조건 | 화면 |
|---|---|---|
| 승격 가능 | 재계산 계획의 `entries`에 있다 | 3구역 목록에 표시(`new`/`update`/`name-match`) |
| `unavailable` | 계획에 없다 — 그새 동기화됐거나 엔티티가 삭제됐다 | "이미 반영됨 또는 삭제됨"으로 별도 표시, 선택 불가 |
| 상태가 바뀜 | 계획에 있으나 요청 당시와 다른 상태 | 그냥 지금 상태로 보여준다(요청 당시 상태를 저장하지 않으므로 대조할 것이 없다) |

`unavailable`이 전부이면 화면은 "처리할 것이 없습니다"를 띄우고 승인자는 반려(또는 그대로 승인 →
0건 → `resolved`)로 요청을 닫는다.

### 3.3 승인은 승격과 같은 엔진을 탄다

승인 시 실제 승격은 `resource.promote`와 **완전히 같은 경로**다 — 라이브러리 항목 `FOR UPDATE` →
`planPromote` → 클라 기대치 대조 → `applyPromotePlan` → writes → `diffModels`. 승인자가 화면에서 본
계획을 `{entityId, expectedStatus, expectedTargetItemId, expectedTargetVersion}`으로 보내고 서버가
락 안에서 재대조하는 것도 같다. 요청 행 갱신이 같은 트랜잭션에 하나 더 붙을 뿐이다.

그래서 이 사이클의 서버 작업 대부분은 **새 로직이 아니라 기존 로직의 추출**이다(§5.1).

## 4. core — 변경 없음

`planPromote`/`applyPromotePlan`/`PromoteEntry`/`PromotePlan`을 그대로 쓴다. 요청은 op 로그 밖의
서버 개념이고 순수 계산이 없다. `packages/core`에 들어갈 것이 없다.

## 5. 서버

### 5.1 `services/promote.ts` (신규) — 승격 트랜잭션 본문 추출

`resource.promote`의 `prepare` 콜백 본문과 결과 집계를 그대로 옮긴다. 두 번째 호출자(`promotion.resolve`)가
생기는 지점이므로, 복사가 아니라 추출이어야 한다.

```ts
export type PromoteRequestEntry = {
  entityId: string
  expectedStatus: PromoteStatus
  expectedTargetItemId: string | null
  expectedTargetVersion: number | null
}

export type PromoteOutcome = {
  inserted: number
  updated: number
  skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[]
}

/**
 * runMutation의 prepare 훅 안에서 도는 승격 본문.
 * 라이브러리 항목을 FOR UPDATE로 잠그고 계획을 재계산해, 클라 기대치와 일치하는 항목만 쓴다.
 * 반환한 nextModel을 호출부의 deriveOps가 diffModels에 넣는다.
 */
export async function runPromoteInTx(
  tx: MutationTx,
  args: {
    libraryId: string
    model: ProjectModel
    entries: readonly PromoteRequestEntry[]
    outcome: PromoteOutcome        // 호출부가 소유하는 집계 객체를 채운다
  },
): Promise<ProjectModel>            // nextModel
```

추출 후 `resource.promote`는 이 함수를 부르는 껍데기가 되고, 동작·응답 형태는 그대로다.
**기존 `resource.promote` 테스트가 리팩터링의 회귀 그물이다** — 추출 커밋에서 그 스위트가 무수정으로
통과해야 한다.

### 5.2 `promotion_requests` (마이그 0011)

```ts
export const promotionRequests = pgTable('promotion_requests', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  libraryId: uuid('library_id').notNull()
    .references(() => resourceLibraries.id, { onDelete: 'cascade' }),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 프로젝트 엔티티 id 묶음 — payload는 담지 않는다(§2.1). */
  entityIds: jsonb('entity_ids').$type<string[]>().notNull(),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['pending', 'resolved', 'rejected', 'cancelled'] })
    .notNull().default('pending'),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note').notNull().default(''),
  /** 실제로 승격된 엔티티 id(부분 승인의 결과). pending이면 null. */
  approvedEntityIds: jsonb('approved_entity_ids').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ix_promotion_requests_library_status').on(t.libraryId, t.status),
  index('ix_promotion_requests_project').on(t.projectId),
])
```

**`orgId` 비정규화 컬럼을 두지 않는다.** 조직 단위 조회는 `resource_libraries.orgId` 조인으로 얻는다.
요청 생성 시 `library.orgId === project.orgId`를 강제하므로(§2.3) 두 경로가 같은 값을 가리키고,
컬럼을 따로 두면 그 둘이 어긋날 수 있는 자리가 생긴다.

`ix_promotion_requests_library_status`는 승인 목록·배지 집계가 모두 `(libraryId, status)`로 훑기
때문이다.

### 5.3 `routers/promotion.ts` (신규)

전부 `authedProcedure`다(세션 전용 — CLI 토큰 allowlist에 넣지 않는다. HANDOFF 3.7의 기본이 거부다).

| 프로시저 | 권한 게이트 |
|---|---|
| `create` | `requireProjectAccess(projectId, 'edit')` + 대상이 이 프로젝트 조직의 `scope='org'` 라이브러리 |
| `listForProject` | `requireProjectAccess(projectId, 'view')` — 행에 `entityIds`를 그대로 실어, 모델을 들고 있는 승격 탭이 항목 이름을 직접 해석하게 한다(서버가 이름을 계산하지 않는다) |
| `cancel` | 요청자 본인 ∨ `requireProjectAccess(projectId, 'manage')` |
| `listForOrg` | `requireScopeWrite(db, 'org', orgId, user)` — Org Owner/Admin |
| `get` | `requireLibraryWrite(db, request.libraryId, user)` |
| `resolve` | `requireLibraryWrite` + `requireProjectAccess(projectId, 'edit')` |
| `pendingCount` | 인증만(집계 자체가 권한으로 필터된다) |

승인자가 Org Owner/Admin이면 `perm.ts`의 `canEdit`가 항상 참이므로(`isOrgManager || …`) `resolve`의
프로젝트 `edit` 게이트는 구조적으로 통과한다. **새 권한 축이 생기지 않는다** — Phase 3의 "새 권한 축은
도입하지 않는다" 결정과 일관된다.

#### `create`

```ts
input: { projectId: uuid, libraryId: uuid, entityIds: uuid[].min(1).max(MAX_OPS_PER_MUTATION), note: string.max(500).default('') }
output: { id: string; requested: number; dropped: string[] }
```

`planPromote`를 돌려 **계획에 실제로 있는 entityId만 저장한다.** 남은 것이 0이면 `BAD_REQUEST`.
검증 없이 저장하면 아무 uuid나 요청에 들어가고, 승인 화면이 그것을 전부 `unavailable`로 띄운다.
정상 흐름(방금 본 계획으로 요청)에서는 `dropped`가 항상 비고, 그 사이 남이 같은 항목을 올렸을 때만
채워져 클라가 안내한다.

이미 쓰기 권한이 있는 사용자의 요청 생성을 막지는 않는다(막을 실익이 없고, 자기가 승인하면 그만이다).

#### `get` — 요청 상세 + 지금 계산한 계획

```ts
input: { requestId: uuid }
output: {
  request: { …행, projectName, requesterName },
  entries: PromoteEntry[],        // 요청의 entityIds ∩ 재계산 계획
  unavailable: string[],          // 계획에 없는 entityId (§3.2)
}
```

**계획 계산이 서버로 옮겨오는 유일한 지점이다.** 승격 탭은 에디터 store의 모델로 클라에서
`planPromote`를 돌리지만, 조직 화면에는 프로젝트 모델이 없다. `model.get`으로 모델 전체를 조직 화면에
내려보내는 대신 서버가 계산해 `PromoteEntry[]`만 보낸다 — 승인은 어차피 서버가 락 안에서 재계산하므로
클라가 모델을 들 이유가 없다.

`listForOrg`는 이 계산을 **하지 않는다**(요약만). 목록에 요청이 N건이면 N개 프로젝트 모델을 로드하게
된다.

#### `resolve` — 승인·반려 한 입구

```ts
input: {
  requestId: uuid,
  approve: { entityId, expectedStatus, expectedTargetItemId, expectedTargetVersion }[],  // 빈 배열이면 반려
  note: string.max(500).default(''),
}
output: { status: 'resolved' | 'rejected', seq: number | null, inserted: number, updated: number, skipped: […] }
```

**반려 경로**(`approve.length === 0`): 모델을 건드리지 않는다. `db.transaction`으로 요청 행만
`FOR UPDATE`로 잠그고 `status === 'pending'`을 확인한 뒤 `rejected`로 갱신한다. Revision이 생기지 않고
`seq`는 `null`이다.

**승인 경로**: `mutateAndPublish`의 `prepare` 훅 안에서

```ts
prepare: async (tx, model) => {
  // 1. 요청 행을 잠그고 pending인지 확인 — 두 관리자의 동시 승인을 여기서 막는다
  const req = await tx.select().from(promotionRequests)
    .where(eq(promotionRequests.id, requestId)).for('update')
  if (req.status !== 'pending') throw new TRPCError({ code: 'CONFLICT', … })

  // 2. 요청에 없는 entityId를 승인 목록에 넣지 못하게 한다
  //    (없으면 승인자가 요청 범위 밖 항목을 임의로 올릴 수 있다)
  if (approve.some((e) => !req.entityIds.includes(e.entityId))) throw BAD_REQUEST

  // 3. 승격 본문 — resource.promote와 같은 함수
  const next = await runPromoteInTx(tx, { libraryId, model, entries: approve, outcome })
  state.next = next

  // 4. 요청 행 종결 — 같은 트랜잭션이므로 3이 실패하면 함께 롤백된다
  await tx.update(promotionRequests).set({
    status: 'resolved', resolvedBy, resolvedAt: new Date(), resolutionNote: note,
    approvedEntityIds: 실제로 승격된 entityId 목록, updatedAt: new Date(),
  }).where(eq(promotionRequests.id, requestId))
}
```

**락 순서는 `projects` → `promotion_requests` → `resource_items` → `resource_libraries`다.**
`runMutation`이 프로젝트 행을 먼저 잠그므로 요청 행 락은 그 뒤가 된다 — 즉 이미 처리된 요청이어도
프로젝트 락을 잡은 뒤에야 알게 된다. 트랜잭션 밖에서 `status`를 미리 한 번 읽어 대부분의 경우를 싸게
거르되, **권위 있는 판정은 락 안의 확인이다.**

`approvedEntityIds`는 `approve`가 아니라 **실제로 승격된 것**(`approve` − `outcome.skipped`)이다.

#### `pendingCount` — 배지

```ts
output: { total: number; byOrg: { orgId: string; count: number }[] }
```

```sql
SELECT rl.org_id, COUNT(*) FROM promotion_requests pr
  JOIN resource_libraries rl ON rl.id = pr.library_id
  JOIN members m ON m.org_id = rl.org_id AND m.user_id = $me AND m.role IN ('owner','admin')
 WHERE pr.status = 'pending'
 GROUP BY rl.org_id
```

권한이 조인 조건에 들어가 있어 **내가 승인할 수 있는 것만 세어진다.**

## 6. 웹

### 6.1 승격 탭 — 요청 모드

`resource-panel.tsx`의 가시성 조건을 바꾼다.

```ts
// 전
const canPromote = canEdit && rows.some((row) => row.canWrite)
// 후 — 조직 라이브러리가 있으면 요청할 수 있다
const canPromote = canEdit && rows.some((row) => row.canWrite || row.scope === 'org')
```

승격 탭의 라이브러리 목록은 `canWrite인 것(전역·조직) ∪ scope==='org'인 것`이다. 전역은 지금처럼
`canWrite`(서비스 관리자)일 때만 보인다 — 요청 대상이 아니기 때문이다(§2.3).

`resource-promote-tab.tsx`는 `library.canWrite`로 갈린다. 3구역 목록·체크박스·`danglingDomain` 경고는
**완전히 같고**, 하단 버튼과 제출 대상만 다르다.

| | `canWrite` | `!canWrite` |
|---|---|---|
| 버튼 | "N건 승격" | "N건 승격 요청" |
| 호출 | `resource.promote` | `promotion.create` (메모 입력 1줄 추가) |
| 성공 후 | `model.get` → `resync` + 쿼리 무효화 | 토스트 + `promotion.listForProject` 무효화 (**모델을 건드리지 않으므로 `resync` 없음**) |

탭 상단에 이 프로젝트의 pending 요청 목록을 띄운다(요청자·시각·항목 수·메모 + 본인/manage면 취소
버튼). 요청자가 결과를 확인하는 자리다.

### 6.2 `promote-entry-list.tsx` (신규) — 목록 컴포넌트 추출

3구역 렌더 + `EntryLabel` + 체크박스 + 구역 일괄 버튼을 승격 탭에서 뽑아, 승격 탭과 승인 다이얼로그가
공유한다. 승격 설계 §9의 이월 **"`EntryLabel`이 재동기화 탭과 승격 탭에 거의 동일하게 중복"** 이
여기서 함께 해소된다.

입력은 `PromoteEntry[]` + 선택 상태 + 콜백이다. 에디터 store를 참조하지 않아야 조직 화면에서 쓸 수
있다 — **이 컴포넌트는 store를 import하지 않는다**(계획을 props로 받는다).

### 6.3 조직 화면 — `promotion-requests-section.tsx` (신규)

`org-detail.tsx`의 `ResourceLibraryManager` 옆에 붙이고, `org.role`이 `owner`/`admin`일 때만 렌더한다.

- 목록: 프로젝트명 · 요청자 · 시각 · 항목 수 · 메모 · [검토] 버튼. 기본 필터 `pending`, "처리됨 보기"
  토글로 이력 열람.
- 검토 다이얼로그: `promotion.get`으로 받은 `entries`를 `PromoteEntryList`로 렌더 + `unavailable`
  안내 + 메모 입력 + [선택 항목 승격] / [반려].
- 성공 후 `listForOrg`·`pendingCount`·`resource.items.list` 무효화. **`resync`는 호출하지 않는다** —
  조직 화면에는 에디터 store가 없다. 그 프로젝트를 열고 있던 사용자에게는 승격 op가 **실시간 채널로
  전파된다**(`mutateAndPublish` 경로를 그대로 타므로 자동이다).

### 6.4 배지

- `app-shell.tsx`: `userMenu` 왼쪽에 `<PendingPromotionsBadge />`. `pendingCount` 폴링
  (`refetchInterval: 60_000`). 총계 0이면 렌더하지 않는다. 클릭 시 `byOrg`가 1건이면 그 조직으로,
  여러 건이면 홈으로 간다.
- `home.tsx`: 조직 카드에 조직별 건수 배지(`byOrg`).

## 7. 파일 구조

**server**

| 파일 | 변경 |
|---|---|
| `src/db/schema.ts` | `promotionRequests` 추가 |
| `drizzle/0011_*.sql` | 신규 마이그레이션 |
| `src/services/promote.ts` | 신규 — `runPromoteInTx` 추출 |
| `src/routers/resource.ts` | `promote`가 추출 함수를 쓰도록 수정(동작 불변) |
| `src/routers/promotion.ts` | 신규 — 7개 프로시저 |
| `src/routers/promotion.test.ts` | 신규(실 DB 통합) |
| `src/router.ts` | `promotion` 라우터 등록 |
| `src/testing/db.ts` | `TEST_TABLES` 맨 앞에 `promotion_requests` 추가(`projects`보다 앞 — `TRUNCATE … CASCADE`라 없어도 지워지지만 명시가 관례다) |

**web**

| 파일 | 변경 |
|---|---|
| `src/editor/promote-entry-list.tsx` | 신규 — 목록 컴포넌트 추출 |
| `src/editor/resource-promote-tab.tsx` | 요청 모드 분기 + 목록 추출 반영 + 내 요청 목록 |
| `src/editor/resource-panel.tsx` | 탭 가시성·라이브러리 목록 조건 |
| `src/components/promotion-requests-section.tsx` | 신규 — 조직 화면 승인 목록·검토 다이얼로그 |
| `src/components/pending-promotions-badge.tsx` | 신규 |
| `src/components/app-shell.tsx` | 배지 삽입 |
| `src/pages/org-detail.tsx` | 섹션 삽입 |
| `src/pages/home.tsx` | 조직 카드 배지 |
| 각 `*.test.tsx` | 신규·확장 |

**docs**

`01-concepts.md` 4항(요청·승인 큐를 두지 않는다 → 권한이 없으면 요청한다), `90-roadmap.md`,
`HANDOFF.md`(1절 완료 표·테스트 기준선, 3.2b 불변식, 6절 이월에서 이 항목 제거).

## 8. 테스트 전략

**결정적인 것 하나 — 원자성.** 승인 트랜잭션에서 승격이 실패하면 요청 `status`가 `pending`으로
롤백돼야 한다. `prepare` 훅 안에서 요청 행 갱신과 라이브러리 쓰기가 같은 트랜잭션이라는 계약이 여기서
고정된다. 승격 사이클이 라이브러리 쓰기에 대해 같은 테스트를 둔 선례를 따른다.

**server (실 DB)**

- 권한: `create`가 Viewer를 거절 / `listForOrg`·`get`·`resolve`가 Org Member를 거절 / 남의 조직
  라이브러리로의 `create` 거절 / 전역 라이브러리로의 `create` 거절
- `create`가 계획에 없는 entityId를 `dropped`로 걸러내고, 전부 걸러지면 `BAD_REQUEST`
- **1회 처리**: 이미 `resolved`인 요청에 대한 두 번째 `resolve`는 `CONFLICT`
- **원자성**: 승격 실패 시 요청이 `pending`으로 남는다
- **부분 승인**: 3건 요청 중 2건 승인 → 라이브러리에 2건만, `approvedEntityIds`가 그 2건
- **반려**: 모델 불변 · Revision 없음 · seq 그대로 · `status='rejected'`
- **요청 범위 밖 항목 승인 거절**: `approve`에 요청의 `entityIds`에 없는 id를 넣으면 `BAD_REQUEST`
- `approvedEntityIds`가 `skipped`를 제외한다(`plan-changed`를 강제로 만들어 확인)
- `get`이 그새 동기화된 항목을 `unavailable`로 내려준다
- `pendingCount`가 내가 Owner/Admin인 조직만 센다(Member인 조직의 pending은 0으로)
- **실시간 브로드캐스트**: 승인이 `origin` update op를 채널로 발행한다(승격 테스트의 선례)
- **`resource.promote` 기존 스위트가 추출 후 무수정 통과**(§5.1의 회귀 그물)

**web**

- 승격 탭: `canWrite=false`면 버튼이 "승격 요청"이고 `promotion.create`를 부른다 / `canWrite=true`면
  기존대로 `resource.promote`
- 탭 가시성: 조직 라이브러리만 있고 `canWrite`가 없어도 탭이 보인다(회귀 — 이전에는 숨겨졌다)
- 요청 성공 후 **`resync`를 부르지 않는다**(모델 무변경)
- 조직 섹션: Org Member에게 렌더되지 않는다 / 검토 다이얼로그가 `unavailable`을 표시한다 /
  선택 0건이면 버튼이 "반려"로 바뀐다
- 배지: 총계 0이면 렌더 안 함 / 홈 조직 카드의 조직별 건수
- `PromoteEntryList`가 store 없이 렌더된다(props만으로)

**core** — 변경 없음(기존 스위트가 그대로 그린이어야 한다)

## 9. 알려진 한계 (이월 후보)

- **알림이 폴링 배지뿐이다.** 승인자가 로그인해 있지 않으면 모른다. 메일 발송은 인프라 선택이 선행
  결정이라 별도 사이클(로드맵 "추후 검토"의 초대·비밀번호 재설정 메일과 함께 다루는 것이 자연스럽다).
- **전역 라이브러리로는 요청할 수 없다**(§2.3). 서비스 관리자가 직접 승격한다.
- **생성 후 요청을 편집할 수 없다.** 항목을 더하거나 빼려면 취소하고 다시 만든다.
- **pending 요청이 만료되지 않는다.** 승인자가 처리하지 않으면 영원히 남는다. 목록 정렬(오래된 순)과
  건수 배지로만 압박한다.
- **요청 시점의 상태를 저장하지 않는다**(§2.1). 승인 화면은 "요청 당시 이랬는데 지금 이렇다"를 보여줄
  수 없다 — 지금 상태만 보여준다.
- **요청자에게 결과가 푸시되지 않는다.** 프로젝트 승격 탭을 열어야 안다.
- **`resolved`가 0건 승격을 포함한다**(§3.1). 승인자가 승인했으나 전부 `skipped`된 경우도 `resolved`다 —
  처리 기록의 `approvedEntityIds`가 비어 있는 것으로만 구분된다.
- 승격 설계 §9의 한계가 그대로 상속된다 — 동시 `INSERT`로 인한 동명 항목, `library.remove`와의 락 순서
  데드락, 표시 이름 완전일치 동명 판정, `MAX_OPS_PER_MUTATION` 천장.
- **요청 행이 프로젝트·라이브러리 삭제에 cascade된다.** 이력이 함께 사라진다(감사 관점에서는 보존이
  나을 수 있으나, 참조 무결성을 유지하려면 `set null` + 이름 비정규화가 필요해 범위 밖).
