# 공용 리소스 승격 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트에서 다듬은 사전 항목(도메인·단어·용어·커스텀 항목)을 조직/전역 라이브러리로 올리는 승격 기능을 만든다 — 기존 fork/재동기화의 반대 방향.

**Architecture:** 계획 계산은 `packages/core`의 순수 함수 2개(`planPromote`/`applyPromotePlan`)로 닫는다. 서버는 새 프로시저 `resource.promote` 하나이고, `runMutation`에 추가한 트랜잭션 내 선행 훅(`prepare`)으로 **라이브러리 쓰기와 프로젝트 `origin` 갱신을 한 트랜잭션**에 묶는다. 웹은 기존 "공용 리소스" 다이얼로그를 탭 2개로 나누고 두 번째 탭을 새로 만든다.

**Tech Stack:** TypeScript · zod · drizzle(PostgreSQL) · tRPC · Fastify · React + zustand + TanStack Query · vitest

**설계 문서:** [`docs/superpowers/specs/2026-08-04-resource-promotion-design.md`](../specs/2026-08-04-resource-promotion-design.md) — 절 번호는 이 문서를 가리킨다.

## Global Constraints

- **`packages/core`는 IO·런타임 의존성 free.** 난수·시간·DB를 쓰지 않는다. 새 id는 주입된 `newId()`로만 만든다.
- **마이그레이션 없음. 새 op 엔티티 없음. 새 런타임 의존성 없음.** 스키마 파일(`db/schema.ts`)을 건드리지 않는다.
- **모델을 바꾸는 모든 경로는 `mutateAndPublish`를 거친다**(HANDOFF 3.6). `runMutation`을 직접 부르는 새 호출자를 만들지 않는다.
- **이벤트 값은 producer 진입 전에 캡처한다**(HANDOFF 3.4). `mutate((m) => ... e.target.value ...)` 금지.
- **UI 카피·주석·커밋 메시지는 한국어.**
- **커밋은 명시 파일만 스테이징한다.** `git add .` / `git add -A` 금지. `.idea/*`와 루트 `.env`는 절대 커밋하지 않는다.
- 커밋 메시지 말미에 트레일러 2줄을 반드시 넣는다:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
  ```
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`의 출력만 보면 안 된다(`-s`가 자식 출력을 삼켜 오류가 있어도 0바이트 + 종료코드 1). `pnpm -r typecheck; echo "EXIT=$?"` 또는 패키지별로 돌린다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 것이 되어 또 오판한다.
- 서버 테스트는 DB env가 필요하다: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run`
- **브리프의 기대값이 실제와 어긋나면 이전 태스크 산출물을 고치지 말고 단언만 정정한 뒤 근거를 보고하라.**

**시작 기준선 (이 상태에서 전부 그린):** core 429 · cli 114 · web 341 · server 108 · typecheck EXIT=0

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/core/src/resource.ts` | `resourceEntitiesOf` 추출(두 엔진 공용) | 1 |
| `packages/core/src/resource-sync.ts` | 추출한 헬퍼로 교체(동작 불변) | 1 |
| `packages/core/src/resource-promote.ts` | `planPromote`(분류) → `applyPromotePlan`(적용) | 1, 2 |
| `packages/core/src/resource-promote.test.ts` | 위 두 함수의 테스트 | 1, 2 |
| `packages/core/src/index.ts` | 신규 export | 1, 2 |
| `apps/server/src/services/mutation.ts` | `runMutation`의 `prepare` 훅 | 3 |
| `apps/server/src/services/mutate-publish.ts` | `prepare` 통과 | 3 |
| `apps/server/src/services/mutate-publish.test.ts` | 훅의 트랜잭션 계약 테스트 | 3 |
| `apps/server/src/routers/resource.ts` | `promote` 프로시저 · `listForProject`의 `canWrite` | 4, 5 |
| `apps/server/src/routers/resource-promote.test.ts` | 승격 통합 테스트(실 DB) | 4 |
| `apps/server/src/routers/resource.test.ts` | `canWrite` 테스트 추가 | 5 |
| `apps/web/src/editor/resource-decisions.ts` | `overLimitMessage` 공용 가드 | 6 |
| `apps/web/src/editor/resource-panel.tsx` | 다이얼로그 껍데기 + 탭 + 라이브러리 목록 | 6 |
| `apps/web/src/editor/resource-resync-tab.tsx` | 기존 재동기화 내용 이동 | 6 |
| `apps/web/src/editor/promote-selection.ts` | 선택 상태·요약 순수 헬퍼 | 7 |
| `apps/web/src/editor/resource-promote-tab.tsx` | 승격 탭 | 7 |
| `docs/01-concepts.md` · `docs/90-roadmap.md` | 기획·로드맵 정합 | 8 |

---

### Task 1: core — `planPromote` (승격 계획 분류)

**Files:**
- Modify: `packages/core/src/resource.ts` (파일 끝에 헬퍼 추가)
- Modify: `packages/core/src/resource-sync.ts:52-55` (지역 `entitiesOf`를 공용 헬퍼로 교체)
- Create: `packages/core/src/resource-promote.ts`
- Create: `packages/core/src/resource-promote.test.ts`
- Modify: `packages/core/src/index.ts:74-77` 부근

**Interfaces:**
- Consumes: `deepEqual`(`./equal.js`), `ProjectModel`·`Origin`(`./model.js`), `RESOURCE_KINDS`·`RESOURCE_COLLECTION_BY_KIND`·`resourcePayloadOf`·`resourceDisplayName`·`ResourceKind`(`./resource.js`), `LibraryItem`(`./resource-sync.js`)
- Produces: `planPromote(model, libraryId, items) → PromotePlan`, 타입 `PromoteStatus`·`PromoteEntry`·`PromotePlan`, 그리고 `resourceEntitiesOf(model, kind) → { id, origin }[]`. Task 2가 같은 파일에 `applyPromotePlan`을 추가하고, Task 4·7이 `planPromote`를 호출한다.

- [ ] **Step 1: 공용 헬퍼를 `resource.ts`로 추출한다**

`packages/core/src/resource.ts` 맨 위 import에 `Origin`을 추가하고(이미 `ProjectModel`을 import 중이다), 파일 끝에 붙인다:

```ts
/** 공용 리소스 4종의 프로젝트 엔티티 목록. planResync·planPromote가 함께 쓴다. */
export function resourceEntitiesOf(
  model: ProjectModel, kind: ResourceKind,
): { id: string; origin: Origin | null }[] {
  const collection = model[RESOURCE_COLLECTION_BY_KIND[kind]] as unknown as
    Record<string, { id: string; origin: Origin | null }>
  return Object.values(collection)
}
```

`packages/core/src/resource-sync.ts`에서 지역 `entitiesOf`(52~55행)와 그 위의 `type OriginBearing` 선언을 지우고, import에 `resourceEntitiesOf`를 추가한 뒤 본문의 `entitiesOf(model, kind)` 호출 2곳을 `resourceEntitiesOf(model, kind)`로 바꾼다. `linked` 맵의 값 타입에 쓰이던 `OriginBearing`은 `{ entity: { id: string; origin: Origin | null }; payload: Record<string, unknown> }`로 인라인한다.

- [ ] **Step 2: 기존 테스트가 그대로 통과하는지 확인한다(추출의 안전망)**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts`
Expected: PASS (기존 테스트 전부 그린 — 동작이 바뀌면 안 되는 리팩터다)

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`packages/core/src/resource-promote.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Domain, type ProjectModel, type Term, type Word } from './model.js'
import { planPromote } from './resource-promote.js'
import type { LibraryItem } from './resource-sync.js'

const LIB = 'lib-1'

/** items.create가 zod로 파싱해 저장하는 형태 — 스키마의 모든 키가 들어 있다. */
function wordItem(id: string, logicalName: string, abbreviation: string, version = 1): LibraryItem {
  return {
    id, kind: 'word', version,
    payload: { logicalName, abbreviation, englishName: null, description: null },
  }
}
function domainItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'domain', version,
    payload: {
      name, category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    },
  }
}

function localWord(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
/** 대상 라이브러리에서 가져온 상태의 단어. base는 가져온 시점 payload다. */
function forkedWord(
  id: string, sourceId: string, logicalName: string, abbreviation: string, sourceVersion = 1,
): Word {
  const base = { logicalName, abbreviation, englishName: null, description: null }
  return { id, ...base, origin: { libraryId: LIB, sourceId, sourceVersion, base } }
}
/** domainItem과 같은 값 — 이 payload가 일치해야 "동기 상태"로 잡힌다. */
function domainPayload(name: string) {
  return {
    name, category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [] as string[], description: null,
  }
}
function localDomain(id: string, name: string): Domain {
  return { id, ...domainPayload(name), origin: null }
}
/** domainItem(sourceId, name)과 payload가 완전히 같은 프로젝트 도메인(= 동기 상태). */
function forkedDomain(id: string, sourceId: string, name: string): Domain {
  const base = domainPayload(name)
  return { id, ...base, origin: { libraryId: LIB, sourceId, sourceVersion: 1, base } }
}
function term(id: string, logicalName: string, physicalName: string, domainId: string | null): Term {
  return { id, logicalName, physicalName, domainId, description: null, origin: null }
}

describe('planPromote — 분류', () => {
  it('링크도 동명도 없으면 new', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({
      kind: 'word', entityId: 'w1', name: '회원', status: 'new',
      targetItemId: null, targetVersion: null, changedFields: [], domainRef: null,
    })
    expect(plan.entries[0]!.payload).toEqual({
      logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null,
    })
    expect(plan.syncedCount).toBe(0)
  })

  it('대상에서 왔고 값이 같으면 목록에서 빠지고 syncedCount로 센다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries).toHaveLength(0)
    expect(plan.syncedCount).toBe(1)
    expect(plan.linkedItemIds).toEqual({ w1: 's1' })
  })

  it('대상에서 왔고 프로젝트가 고쳤으면 update — 바뀐 필드를 싣는다', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    expect(plan.entries[0]).toMatchObject({
      status: 'update', targetItemId: 's1', targetVersion: 3, changedFields: ['abbreviation'],
    })
  })

  it('링크는 없고 같은 종류에 같은 이름이 있으면 name-match', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MB') } }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries[0]).toMatchObject({
      status: 'name-match', targetItemId: 's1', targetVersion: 1, changedFields: ['abbreviation'],
    })
  })

  it('링크가 가리키는 원본이 사라졌으면 링크 없음으로 내려간다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forkedWord('w1', 'gone', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.status).toBe('new')
    expect(plan.linkedItemIds).toEqual({})
  })

  it('다른 라이브러리에서 온 항목도 승격 대상이다(상류를 갈아탄다)', () => {
    const other = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: { ...other, origin: { ...other.origin!, libraryId: 'lib-other' } } },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.status).toBe('new')
  })

  it('한 원본을 두 항목이 주장하지 못한다 — 먼저 나온 쪽이 선점하고 나머지는 new', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: localWord('w1', '회원', 'MB'), w2: localWord('w2', '회원', 'MEM') },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries.map((e) => [e.entityId, e.status])).toEqual([['w1', 'name-match'], ['w2', 'new']])
  })

  it('용어의 도메인이 대상에 링크돼 있으면 라이브러리 항목 id로 역투영한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: forkedDomain('d1', 'sd', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [domainItem('sd', '금액')])
    expect(plan.syncedCount).toBe(1)                       // 도메인은 동기 상태라 목록에서 빠진다
    const entry = plan.entries[0]!
    expect(entry.kind).toBe('term')
    expect(entry.payload.domainId).toBe('sd')
    expect(entry.domainRef).toEqual({ entityId: 'd1', targetItemId: 'sd' })
  })

  it('도메인이 대상에 없으면 domainId를 비우고 domainRef.targetItemId가 null이다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const entry = plan.entries.find((e) => e.kind === 'term')!
    expect(entry.payload.domainId).toBeNull()
    expect(entry.domainRef).toEqual({ entityId: 'd1', targetItemId: null })
  })

  it('domainId가 모델에 없는 용어는 domainRef가 null이다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'ghost') },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.domainRef).toBeNull()
    expect(plan.entries[0]!.payload.domainId).toBeNull()
  })

  it('종류 순서(도메인→단어→용어→커스텀 항목) 다음 이름 순으로 정렬한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      words: { w2: localWord('w2', '주문', 'ORD'), w1: localWord('w1', '회원', 'MBR') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', null) },
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 0, origin: null,
        },
      },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries.map((e) => e.kind)).toEqual(['domain', 'word', 'word', 'term', 'customField'])
    expect(plan.entries.map((e) => e.name)).toEqual(['금액', '주문', '회원', '주문금액', '비고'])
  })

  it('모든 리소스 종류를 승격 대상으로 다룬다(완전성)', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      words: { w1: localWord('w1', '회원', 'MBR') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', null) },
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 0, origin: null,
        },
      },
    }
    const kinds = new Set(planPromote(model, LIB, []).entries.map((e) => e.kind))
    expect([...kinds].sort()).toEqual([...RESOURCE_KINDS].sort())
  })
})
```

테스트 파일 맨 위 import에 `RESOURCE_KINDS`를 추가한다: `import { RESOURCE_KINDS } from './resource.js'`

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-promote.test.ts`
Expected: FAIL — `Failed to resolve import "./resource-promote.js"`

- [ ] **Step 5: `resource-promote.ts`를 구현한다**

```ts
import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import {
  RESOURCE_KINDS, resourceDisplayName, resourceEntitiesOf, resourcePayloadOf,
  type ResourceKind,
} from './resource.js'
import type { LibraryItem } from './resource-sync.js'

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
  /**
   * 라이브러리 공간으로 역투영한 **잠정** payload. 이미 링크된 도메인만 해석하며,
   * 같은 배치에서 함께 승격되는 도메인은 applyPromotePlan이 최종 해석한다.
   */
  payload: Record<string, unknown>
  /** 원본 항목 payload 대비 바뀐 필드. new면 []. */
  changedFields: string[]
  /** term의 도메인 참조. targetItemId가 null이면 "함께 승격해야 연결된다"는 뜻이다. */
  domainRef: { entityId: string; targetItemId: string | null } | null
}

export type PromotePlan = {
  libraryId: string
  entries: PromoteEntry[]
  /** 대상에서 왔고 값이 같아 목록에서 제외된 항목 수. */
  syncedCount: number
  /** 프로젝트 엔티티 id → 대상 라이브러리 항목 id. 살아 있는 링크만 담는다(역투영 색인의 기반). */
  linkedItemIds: Record<string, string>
}

/**
 * 프로젝트 공간 payload를 라이브러리 공간으로 역투영한다(resource-sync의 projectPayload 반대).
 * 참조를 갖는 종류는 term(domainId)뿐이다. 색인에 없으면 null — 도메인을 함께 올리지 않아도
 * 용어 자체는 유효하게 올라간다.
 */
export function libraryPayload(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  itemIdByEntity: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const projectDomainId = payload.domainId
  const mapped = typeof projectDomainId === 'string'
    ? itemIdByEntity.get(projectDomainId) ?? null
    : null
  return { ...payload, domainId: mapped }
}

function nameKey(kind: ResourceKind, name: string): string {
  return `${kind}:${name.trim()}`
}

/**
 * 프로젝트 모델과 대상 라이브러리 항목을 비교해 승격 계획을 만든다.
 * "이미 올라가 있다"의 판정은 payload 비교다 — 재동기화와 달리 버전으로는 판정할 수 없다
 * (프로젝트가 원본을 마지막으로 본 시점이 아니라 지금 값이 같은지가 관심사다).
 */
export function planPromote(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): PromotePlan {
  const itemById = new Map(items.map((item) => [item.id, item]))

  // 1) 살아 있는 링크. 두 엔티티가 같은 원본을 가리키면 먼저 나온 쪽만 인정한다.
  const linkedItemId = new Map<string, string>()
  const claimed = new Set<string>()
  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      const origin = entity.origin
      if (!origin || origin.libraryId !== libraryId) continue
      if (!itemById.has(origin.sourceId) || claimed.has(origin.sourceId)) continue
      linkedItemId.set(entity.id, origin.sourceId)
      claimed.add(origin.sourceId)
    }
  }

  // 2) 동명 색인 — 이미 누군가 링크한 항목은 대상에서 뺀다.
  const itemByName = new Map<string, LibraryItem>()
  for (const item of items) {
    if (claimed.has(item.id)) continue
    const key = nameKey(item.kind, resourceDisplayName(item.kind, item.payload))
    if (!itemByName.has(key)) itemByName.set(key, item)
  }

  const entries: PromoteEntry[] = []
  let syncedCount = 0

  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      const raw = resourcePayloadOf(kind, entity as unknown as Record<string, unknown>)
      const payload = libraryPayload(kind, raw, linkedItemId)
      const name = resourceDisplayName(kind, raw)

      const linked = linkedItemId.get(entity.id)
      let target: LibraryItem | undefined
      let status: PromoteStatus
      if (linked !== undefined) {
        target = itemById.get(linked)!
        if (deepEqual(payload, target.payload)) { syncedCount += 1; continue }
        status = 'update'
      } else {
        target = itemByName.get(nameKey(kind, name))
        if (target && claimed.has(target.id)) target = undefined
        status = target ? 'name-match' : 'new'
        if (target) claimed.add(target.id)
      }

      entries.push({
        kind,
        entityId: entity.id,
        name,
        status,
        targetItemId: target?.id ?? null,
        targetVersion: target?.version ?? null,
        payload,
        changedFields: target
          ? Object.keys(payload).filter((prop) => !deepEqual(payload[prop], target!.payload[prop]))
          : [],
        domainRef: domainRefOf(kind, raw, model, linkedItemId),
      })
    }
  }

  const kindOrder = new Map(RESOURCE_KINDS.map((k, i) => [k, i]))
  entries.sort((a, b) =>
    kindOrder.get(a.kind)! - kindOrder.get(b.kind)! || a.name.localeCompare(b.name))

  return { libraryId, entries, syncedCount, linkedItemIds: Object.fromEntries(linkedItemId) }
}

function domainRefOf(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  model: ProjectModel,
  linkedItemId: ReadonlyMap<string, string>,
): { entityId: string; targetItemId: string | null } | null {
  if (kind !== 'term') return null
  const domainId = payload.domainId
  if (typeof domainId !== 'string') return null
  if (!Object.hasOwn(model.domains, domainId)) return null   // dangling — 참조 없음으로 본다
  return { entityId: domainId, targetItemId: linkedItemId.get(domainId) ?? null }
}
```

`packages/core/src/index.ts`의 `export { planResync, applyResyncPlan } from './resource-sync.js'` 아래에 추가한다:

```ts
export { planPromote } from './resource-promote.js'
export type { PromoteStatus, PromoteEntry, PromotePlan } from './resource-promote.js'
```

`resource.ts`의 export 블록에도 `resourceEntitiesOf`를 추가한다(index.ts의 `from './resource.js'` 목록에 이름을 끼워 넣는다).

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-promote.test.ts src/resource-sync.test.ts`
Expected: PASS (신규 12건 + 기존 resource-sync 전부)

- [ ] **Step 7: 전체 core 스위트와 typecheck**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -s -C packages/core typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/resource.ts packages/core/src/resource-sync.ts \
        packages/core/src/resource-promote.ts packages/core/src/resource-promote.test.ts \
        packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): 공용 리소스 승격 계획(planPromote)

프로젝트 사전 4종을 대상 라이브러리와 비교해 new/update/name-match로 분류한다.
링크가 가리키는 원본이 사라졌으면 링크 없음으로 내려가고, 한 원본을 두 항목이
주장하지 못하도록 먼저 나온 쪽이 선점한다. 용어의 domainId는 라이브러리 공간으로
역투영하며 색인에 없으면 비우고 domainRef로 "함께 승격하면 연결됨"을 알린다.

planResync와 공용으로 쓰는 엔티티 열거 헬퍼를 resource.ts로 추출했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 2: core — `applyPromotePlan` (라이브러리 write + `origin` 갱신)

**Files:**
- Modify: `packages/core/src/resource-promote.ts` (Task 1이 만든 파일에 추가)
- Modify: `packages/core/src/resource-promote.test.ts` (describe 블록 추가)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1의 `planPromote`·`PromotePlan`·`libraryPayload`·`resourceEntitiesOf`
- Produces: `applyPromotePlan(model, plan, selected: ReadonlySet<string>, newId: () => string) → { writes: PromoteWrite[]; nextModel: ProjectModel }`, 타입 `PromoteWrite = { mode: 'insert' | 'update'; itemId: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }`. Task 4의 서버 핸들러가 이것을 호출한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/resource-promote.test.ts` 끝에 추가한다. 파일 상단 import에 `applyPromotePlan`, `planResync`, `diffModels`, `validateModelIntegrity`를 더한다:

```ts
import { applyPromotePlan, planPromote } from './resource-promote.js'
import { planResync, type LibraryItem } from './resource-sync.js'
import { diffModels } from './diff.js'
import { validateModelIntegrity } from './integrity.js'
```

```ts
/** 테스트마다 1부터 다시 세는 id 발급기 — 단언이 호출 순서에 흔들리지 않는다. */
function makeNewId(): () => string {
  let n = 0
  return () => `item-${++n}`
}

describe('applyPromotePlan', () => {
  it('선택이 비면 입력 모델을 그대로 돌려주고 write가 없다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const out = applyPromotePlan(model, plan, new Set(), makeNewId())
    expect(out.writes).toEqual([])
    expect(out.nextModel).toBe(model)
  })

  it('new는 insert write와 origin 부여를 낸다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const payload = { logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null }
    expect(writes).toEqual([{ mode: 'insert', itemId: 'item-1', kind: 'word', payload, version: 1 }])
    expect(nextModel.words.w1!.origin).toEqual({
      libraryId: LIB, sourceId: 'item-1', sourceVersion: 1, base: payload,
    })
  })

  it('update는 targetVersion + 1로 올린다', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect(writes).toEqual([{
      mode: 'update', itemId: 's1', kind: 'word', version: 4,
      payload: { logicalName: '회원', abbreviation: 'MB', englishName: null, description: null },
    }])
    expect(nextModel.words.w1!.origin!.sourceVersion).toBe(4)
  })

  it('origin 외의 엔티티 필드는 절대 바꾸지 않는다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect({ ...nextModel.words.w1!, origin: null }).toEqual({ ...model.words.w1! })
  })

  it('diffModels가 origin 하나만 바꾸는 update op를 낸다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const ops = diffModels(model, nextModel)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('update')
    expect(ops[0]!.entity).toBe('word')
    expect(Object.keys((ops[0] as { changes: Record<string, unknown> }).changes)).toEqual(['origin'])
    expect(validateModelIntegrity(nextModel)).toEqual([])
  })

  it('승격 직후 같은 라이브러리로 재동기화하면 그 항목은 동기 상태다 (두 엔진의 왕복)', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const promoted: LibraryItem[] = writes.map((w) => ({
      id: w.itemId, kind: w.kind, version: w.version, payload: w.payload,
    }))
    const resync = planResync(nextModel, LIB, promoted)
    expect(resync.entries).toHaveLength(0)
    expect(resync.keptSynced).toBe(1)
  })

  it('도메인을 함께 승격하면 용어가 새 라이브러리 항목을 참조하고 base는 프로젝트 도메인 id다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['d1', 't1']), makeNewId())
    const domainWrite = writes.find((w) => w.kind === 'domain')!
    const termWrite = writes.find((w) => w.kind === 'term')!
    expect(termWrite.payload.domainId).toBe(domainWrite.itemId)
    expect(nextModel.terms.t1!.origin!.base).toMatchObject({ domainId: 'd1' })

    // 왕복: 승격 결과를 그대로 재동기화하면 둘 다 동기 상태다
    const promoted: LibraryItem[] = writes.map((w) => ({
      id: w.itemId, kind: w.kind, version: w.version, payload: w.payload,
    }))
    expect(planResync(nextModel, LIB, promoted).keptSynced).toBe(2)
  })

  it('도메인을 빼고 용어만 승격하면 연결이 비고, 다음 원본 변경은 auto-update가 아니라 conflict다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['t1']), makeNewId())
    const termWrite = writes[0]!
    expect(termWrite.payload.domainId).toBeNull()
    expect(nextModel.terms.t1!.origin!.base).toMatchObject({ domainId: null })

    const bumped: LibraryItem[] = [{
      id: termWrite.itemId, kind: 'term', version: 2,
      payload: { ...termWrite.payload, physicalName: 'ORD_AMOUNT' },
    }]
    expect(planResync(nextModel, LIB, bumped).entries[0]!.status).toBe('conflict')
  })

  it('커스텀 항목의 order는 payload에서 빠지고 프로젝트 값은 보존된다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 4, origin: null,
        },
      },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['f1']), makeNewId())
    expect(writes[0]!.payload).not.toHaveProperty('order')
    expect(nextModel.customFields.f1!.order).toBe(4)
  })

  it('입력 모델을 변경하지 않는다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect(model.words.w1!.origin).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-promote.test.ts`
Expected: FAIL — `applyPromotePlan is not exported` (Task 1 테스트는 계속 PASS)

- [ ] **Step 3: `applyPromotePlan`을 구현한다**

`resource-promote.ts` 끝에 추가한다:

```ts
export type PromoteWrite = {
  mode: 'insert' | 'update'
  itemId: string
  kind: ResourceKind
  payload: Record<string, unknown>
  /** 저장할 버전 — insert면 1, update면 targetVersion + 1. */
  version: number
}

/**
 * 라이브러리 공간 payload를 프로젝트 공간으로 되투영한다(origin.base 계산용).
 * base는 "가져오기 직후"와 같아야 하므로 import 경로와 같은 규칙을 한 번 더 통과시킨다 —
 * 도메인을 함께 올리지 않은 용어는 base.domainId가 null이 되어 "프로젝트가 고침"으로 잡히고,
 * 나중에 auto-update가 조용히 도메인 연결을 지우는 사고를 막는다.
 */
function projectSpace(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  entityByItemId: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const itemId = payload.domainId
  const mapped = typeof itemId === 'string' ? entityByItemId.get(itemId) ?? null : null
  return { ...payload, domainId: mapped }
}

/**
 * 선택된 항목에 대해 라이브러리 write 목록과 origin이 갱신된 다음 모델을 함께 낸다(입력 모델 불변).
 * 선택이 비면 입력 모델을 그대로 돌려준다(diffModels가 빈 배열을 내 뮤테이션이 일어나지 않는다).
 */
export function applyPromotePlan(
  model: ProjectModel,
  plan: PromotePlan,
  selected: ReadonlySet<string>,
  newId: () => string,
): { writes: PromoteWrite[]; nextModel: ProjectModel } {
  const chosen = plan.entries.filter((entry) => selected.has(entry.entityId))
  if (chosen.length === 0) return { writes: [], nextModel: model }

  // 1) 색인 완성 — 이미 링크된 것 + 이번 배치에서 대상이 정해지는 것.
  //    같은 배치의 도메인을 용어가 참조할 수 있어야 하므로 id를 먼저 전부 발급한다.
  const itemIdByEntity = new Map(Object.entries(plan.linkedItemIds))
  for (const entry of chosen) {
    itemIdByEntity.set(entry.entityId, entry.targetItemId ?? newId())
  }
  const entityByItemId = new Map<string, string>()
  for (const [entityId, itemId] of itemIdByEntity) entityByItemId.set(itemId, entityId)

  const next: ProjectModel = {
    ...model,
    domains: { ...model.domains },
    words: { ...model.words },
    terms: { ...model.terms },
    customFields: { ...model.customFields },
  }

  const writes: PromoteWrite[] = []
  for (const entry of chosen) {
    const collection = next[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
      Record<string, Record<string, unknown>>
    const entity = collection[entry.entityId]
    if (!entity) continue   // 계획 계산 후 삭제된 경우 방어
    const itemId = itemIdByEntity.get(entry.entityId)!
    const payload = libraryPayload(
      entry.kind, resourcePayloadOf(entry.kind, entity), itemIdByEntity)
    const version = entry.targetVersion === null ? 1 : entry.targetVersion + 1
    writes.push({
      mode: entry.targetItemId === null ? 'insert' : 'update',
      itemId, kind: entry.kind, payload, version,
    })
    const origin: Origin = {
      libraryId: plan.libraryId,
      sourceId: itemId,
      sourceVersion: version,
      base: projectSpace(entry.kind, payload, entityByItemId),
    }
    collection[entry.entityId] = { ...entity, origin }
  }

  return { writes, nextModel: next }
}
```

`RESOURCE_COLLECTION_BY_KIND`를 파일 상단 import에 추가한다.

`packages/core/src/index.ts`의 Task 1 export를 확장한다:

```ts
export { planPromote, applyPromotePlan } from './resource-promote.js'
export type { PromoteStatus, PromoteEntry, PromotePlan, PromoteWrite } from './resource-promote.js'
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-promote.test.ts`
Expected: PASS (Task 1의 12건 + 이번 10건)

- [ ] **Step 5: 전체 core 스위트와 typecheck**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -s -C packages/core typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/resource-promote.ts packages/core/src/resource-promote.test.ts \
        packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): 승격 적용(applyPromotePlan) — 라이브러리 write와 origin 갱신

선택 항목의 insert/update write 목록과 origin만 갱신된 다음 모델을 함께 낸다.
프로젝트 엔티티의 내용은 건드리지 않아 diffModels가 origin 하나짜리 update op만
낸다. origin.base는 라이브러리에 쓴 payload를 다시 프로젝트 공간으로 투영한
값이라 승격 직후 재동기화가 그 항목을 동기 상태로 보고, 도메인을 빼고 올린
용어는 반대로 conflict 후보가 되어 도메인 연결이 조용히 지워지지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 3: server — `runMutation`의 트랜잭션 내 선행 훅

**Files:**
- Modify: `apps/server/src/services/mutation.ts:52-70`
- Modify: `apps/server/src/services/mutate-publish.ts:16-40`
- Modify: `apps/server/src/services/mutate-publish.test.ts`

**Interfaces:**
- Consumes: 없음(기존 `runMutation`/`mutateAndPublish`)
- Produces: `runMutation`·`mutateAndPublish`의 `args`에 선택 필드 `prepare?: (tx: MutationTx, model: ProjectModel) => Promise<void>` 추가. Task 4가 이 훅으로 라이브러리에 쓴다. **기존 호출자 3곳(`model.mutate`·`snapshot.restore`·`model.push`)은 인자를 주지 않아 무영향이다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/services/mutate-publish.test.ts` 상단 import에 `eq`(drizzle-orm)와 `resourceLibraries`(../db/schema.js)를 추가하고, 파일 끝 describe 안에 붙인다:

```ts
  it('prepare는 락 안에서 그 시점의 권위 모델과 함께 호출된다', async () => {
    const seen: number[] = []
    const record = async (_tx: unknown, model: { notes: Record<string, unknown> }) => {
      seen.push(Object.keys(model.notes).length)
    }
    await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: record, deriveOps: () => [noteOp()],
    })
    await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: record, deriveOps: () => [noteOp()],
    })
    expect(seen).toEqual([0, 1])   // 두 번째 호출은 첫 메모가 반영된 모델을 본다
  })

  it('prepare가 쓴 행은 모델 변경과 한 트랜잭션이다 — op 적용이 실패하면 함께 롤백된다', async () => {
    const libraryId = uuidv7()
    await expect(mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: async (tx) => {
        await tx.insert(resourceLibraries).values({
          id: libraryId, scope: 'global', orgId: null, name: '롤백 확인', description: '',
        })
      },
      // 존재하지 않는 메모를 수정하는 op — applyOps가 거부한다
      deriveOps: () => [{
        action: 'update', entity: 'note', entityId: uuidv7(),
        changes: { content: { from: 'a', to: 'b' } },
      }],
    })).rejects.toThrow()

    const rows = await app.db!.select().from(resourceLibraries)
      .where(eq(resourceLibraries.id, libraryId))
    expect(rows).toHaveLength(0)
    expect(received).toEqual([])
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/services/mutate-publish.test.ts`
Expected: FAIL — `prepare`가 args 타입에 없어 typecheck/런타임에서 무시되고 첫 테스트의 `seen`이 `[]`

- [ ] **Step 3: `runMutation`에 훅을 추가한다**

`apps/server/src/services/mutation.ts`의 `runMutation` args 타입에 필드를 추가한다(`source` 아래):

```ts
    /**
     * 락 획득·모델 로드 뒤, deriveOps 앞에 같은 트랜잭션에서 실행한다.
     * 모델 밖 테이블(예: 공용 리소스 라이브러리)을 프로젝트 행 락 안에서 함께 쓰기 위한 훅이다.
     * 여기서 던지면 모델 변경과 함께 롤백된다.
     */
    prepare?: (tx: MutationTx, model: ProjectModel) => Promise<void>
```

본문에서 `const model = await loadProjectModel(tx, args.projectId)` 바로 다음 줄에 넣는다:

```ts
  if (args.prepare) await args.prepare(tx, model)
```

- [ ] **Step 4: `mutateAndPublish`가 통과시키게 한다**

`apps/server/src/services/mutate-publish.ts`의 args 타입에 같은 필드를 추가하고, `runMutation` 호출에 `prepare: args.prepare,`를 끼워 넣는다(`deriveOps` 위).

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/services/mutate-publish.test.ts`
Expected: PASS (기존 3건 + 신규 2건)

- [ ] **Step 6: 서버 전체 스위트와 typecheck**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run && pnpm -s -C apps/server typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/services/mutation.ts apps/server/src/services/mutate-publish.ts \
        apps/server/src/services/mutate-publish.test.ts
git commit -F - <<'EOF'
feat(server): runMutation에 트랜잭션 내 선행 훅(prepare)을 연다

모델 밖 테이블을 프로젝트 행 락 안에서 함께 쓰기 위한 훅이다. 락 획득·모델
로드 뒤 deriveOps 앞에 돌아 권위 모델을 손에 쥔 채 쓰고, 여기서 던지면 모델
변경과 함께 롤백된다. mutateAndPublish가 그대로 통과시키므로 새 변경 경로가
유일 진입점 밖으로 새지 않는다. 기존 호출자 3곳은 인자를 주지 않아 무영향이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 4: server — `resource.promote` 프로시저

**Files:**
- Modify: `apps/server/src/routers/resource.ts`
- Create: `apps/server/src/routers/resource-promote.test.ts`

**Interfaces:**
- Consumes: Task 1·2의 `planPromote`/`applyPromotePlan`/`PromoteWrite`, Task 3의 `prepare` 훅, 기존 `requireProjectAccess`·`requireLibraryWrite`·`parsePayload`(같은 파일의 private 함수)
- Produces: tRPC `resource.promote` — 입력 `{ projectId, libraryId, entries: { entityId, expectedStatus, expectedTargetItemId }[] }`, 출력 `{ seq, inserted, updated, skipped: { entityId, reason }[] }`. Task 7의 웹 승격 탭이 호출한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/routers/resource-promote.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel, type ServerMessage } from '@erdd/core'
import { resourceItems } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, session: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, session: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: session } })
}

/** 프로젝트에 단어 하나를 만들고 그 id를 돌려준다. */
async function seedWord(
  app: FastifyInstance, session: string, projectId: string,
  logicalName: string, abbreviation: string,
): Promise<string> {
  const id = uuidv7()
  const next: ProjectModel = {
    ...createEmptyModel(),
    words: { [id]: { id, logicalName, abbreviation, englishName: null, description: null, origin: null } },
  }
  const res = await post(app, 'model.mutate', session, {
    projectId, ops: diffModels(createEmptyModel(), next), summary: '단어 추가',
  })
  expect(res.statusCode).toBe(200)
  return id
}

describe.skipIf(!url)('resource.promote', () => {
  let app: FastifyInstance
  let ownerSession: string
  let memberSession: string
  let orgId: string
  let projectId: string
  let libraryId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'm@t.dev', name: '멤버', password: 'password-m', role: 'user' })
    ownerSession = await loginAs(app, 'o@t.dev', 'password-o')
    memberSession = await loginAs(app, 'm@t.dev', 'password-m')
    orgId = (await post(app, 'org.create', ownerSession, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', ownerSession, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', ownerSession, { orgId, email: 'm@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerSession, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerSession, {
      projectId, memberId: members.find((m) => m.email === 'm@t.dev')!.id, role: 'editor',
    })
    libraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId, name: '조직 표준',
    })).json().result.data.id
  })

  it('새 항목을 라이브러리에 만들고 프로젝트 항목에 origin을 붙인다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ inserted: 1, updated: 0, skipped: [] })

    const items = await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId)).orderBy(asc(resourceItems.createdAt))
    expect(items).toHaveLength(1)
    expect(items[0]!.version).toBe(1)
    expect(items[0]!.payload).toMatchObject({ logicalName: '회원', abbreviation: 'MBR' })

    const model = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data
      .model as ProjectModel
    expect(model.words[wordId]!.origin).toMatchObject({
      libraryId, sourceId: items[0]!.id, sourceVersion: 1,
    })
  })

  it('이미 링크된 항목을 고쳐 올리면 원본 버전이 오른다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const itemId = (await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId)))[0]!.id

    // 프로젝트에서 약어를 고친 뒤 다시 승격한다
    const before = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data
      .model as ProjectModel
    const after: ProjectModel = {
      ...before, words: { [wordId]: { ...before.words[wordId]!, abbreviation: 'MEM' } },
    }
    await post(app, 'model.mutate', ownerSession, {
      projectId, ops: diffModels(before, after), summary: '약어 수정',
    })
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'update', expectedTargetItemId: itemId }],
    })
    expect(res.json().result.data).toMatchObject({ inserted: 0, updated: 1, skipped: [] })

    const item = (await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.id, itemId)))[0]!
    expect(item.version).toBe(2)
    expect(item.payload).toMatchObject({ abbreviation: 'MEM' })
  })

  it('클라가 본 계획과 서버 재계산이 다르면 그 항목만 건너뛴다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      // 실제로는 new인데 update로 요청한다
      entries: [{ entityId: wordId, expectedStatus: 'update', expectedTargetItemId: uuidv7() }],
    })
    expect(res.json().result.data).toMatchObject({
      inserted: 0, updated: 0, skipped: [{ entityId: wordId, reason: 'plan-changed' }],
    })
    expect(await app.db!.select().from(resourceItems)
      .where(eq(resourceItems.libraryId, libraryId))).toHaveLength(0)
  })

  it('계획에 없는 엔티티는 missing으로 건너뛰고 Revision을 만들지 않는다', async () => {
    const seqBefore = (await get(app, 'model.get', ownerSession, { projectId })).json().result.data.seq
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: uuidv7(), expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const data = res.json().result.data
    expect(data.skipped).toEqual([{ entityId: expect.any(String), reason: 'missing' }])
    expect(data.seq).toBe(seqBefore)
  })

  it('프로젝트 편집 권한이 없으면 거절한다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const res = await post(app, 'resource.promote', outsider, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    // 프로젝트는 존재하므로 NOT_FOUND가 아니라 FORBIDDEN이다(getProjectAccess가 access를 돌려주고
    // canEdit이 false라 requireProjectAccess가 FORBIDDEN을 던진다).
    expect(res.statusCode).toBe(403)
  })

  it('조직 리소스 쓰기 권한이 없으면 거절한다 (Editor여도 Org Member면 못 올린다)', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const res = await post(app, 'resource.promote', memberSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(403)
  })

  it('다른 조직의 라이브러리로는 올릴 수 없다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const otherOrgId = (await post(app, 'org.create', ownerSession, { name: '다른 팀' }))
      .json().result.data.id
    const otherLibraryId = (await post(app, 'resource.library.create', ownerSession, {
      scope: 'org', orgId: otherOrgId, name: '남의 표준',
    })).json().result.data.id
    const res = await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId: otherLibraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    expect(res.statusCode).toBe(403)
  })

  it('승격이 실시간 채널로 발행된다', async () => {
    const wordId = await seedWord(app, ownerSession, projectId, '회원', 'MBR')
    const received: ServerMessage[] = []
    app.hub.subscribe(projectId, {
      userId: 'observer', name: '구독자',
      send: (text: string) => { received.push(JSON.parse(text) as ServerMessage) },
    })
    received.length = 0
    await post(app, 'resource.promote', ownerSession, {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null }],
    })
    const opsMsg = received.find((m) => m.type === 'ops')
    expect(opsMsg).toBeDefined()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/routers/resource-promote.test.ts`
Expected: FAIL — `resource.promote` 경로가 없어 404/NOT_FOUND

- [ ] **Step 3: 프로시저를 구현한다**

`apps/server/src/routers/resource.ts` 상단 import를 보강한다:

```ts
import {
  applyPromotePlan, deepEqual, diffModels, planPromote, MAX_OPS_PER_MUTATION, OpApplyError,
  RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, type LibraryItem, type ProjectModel, type ResourceKind,
} from '@erdd/core'
import { mutateAndPublish } from '../services/mutate-publish.js'
```

(`deepEqual`·`RESOURCE_KINDS`·`RESOURCE_PAYLOAD_SCHEMAS`는 기존 import에 이미 있다 — 중복 없이 합친다.)

`items` 라우터 뒤, `resourceRouter`의 마지막 키로 추가한다:

```ts
  /**
   * 프로젝트 사전 항목을 라이브러리로 올린다(fork의 반대 방향).
   *
   * 라이브러리 쓰기와 프로젝트 origin 갱신이 한 트랜잭션이다 — runMutation의 prepare 훅이
   * 프로젝트 행 락 안에서 돌고, 라이브러리 항목은 FOR UPDATE로 잠근 뒤 그 값으로 계획을
   * 세우므로 버전 경합이 구조적으로 불가능하다.
   *
   * payload는 클라에서 받지 않는다. 서버가 트랜잭션 안에서 모델을 다시 읽어 계획을
   * 재계산하고, 클라가 본 상태와 다른 항목만 건너뛴다.
   */
  promote: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      libraryId: z.string().uuid(),
      entries: z.array(z.object({
        entityId: z.string().uuid(),
        expectedStatus: z.enum(['new', 'update', 'name-match']),
        expectedTargetItemId: z.string().uuid().nullable(),
      })).min(1).max(MAX_OPS_PER_MUTATION),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
      const library = await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
      // 전역은 서비스 관리자만 requireLibraryWrite를 통과한다. 조직은 반드시 이 프로젝트의
      // 조직이어야 한다 — 없으면 두 조직에 속한 사용자가 남의 조직으로 사전을 흘릴 수 있다.
      if (library.scope === 'org' && library.orgId !== access.project.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '이 프로젝트의 조직 라이브러리가 아닙니다' })
      }

      const outcome = {
        inserted: 0,
        updated: 0,
        skipped: [] as { entityId: string; reason: 'missing' | 'plan-changed' }[],
      }
      const state: { next: ProjectModel | null } = { next: null }

      try {
        const { seq } = await mutateAndPublish(ctx.db, ctx.hub, {
          projectId: input.projectId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name,
          source: 'web',
          prepare: async (tx, model) => {
            const items = await tx
              .select({
                id: resourceItems.id, kind: resourceItems.kind,
                payload: resourceItems.payload, version: resourceItems.version,
              })
              .from(resourceItems)
              .where(eq(resourceItems.libraryId, input.libraryId))
              .orderBy(asc(resourceItems.createdAt))
              .for('update')
            const plan = planPromote(model, input.libraryId, items as LibraryItem[])
            const byEntity = new Map(plan.entries.map((entry) => [entry.entityId, entry]))

            const selected = new Set<string>()
            for (const req of input.entries) {
              const entry = byEntity.get(req.entityId)
              if (!entry) {
                outcome.skipped.push({ entityId: req.entityId, reason: 'missing' })
                continue
              }
              if (entry.status !== req.expectedStatus
                || entry.targetItemId !== req.expectedTargetItemId) {
                outcome.skipped.push({ entityId: req.entityId, reason: 'plan-changed' })
                continue
              }
              selected.add(req.entityId)
            }

            const applied = applyPromotePlan(model, plan, selected, uuidv7)
            state.next = applied.nextModel
            for (const write of applied.writes) {
              const payload = parsePayload(write.kind, write.payload)
              if (write.mode === 'insert') {
                await tx.insert(resourceItems).values({
                  id: write.itemId, libraryId: input.libraryId,
                  kind: write.kind, payload, version: write.version,
                })
                outcome.inserted += 1
              } else {
                await tx.update(resourceItems)
                  .set({ payload, version: write.version, updatedAt: new Date() })
                  .where(eq(resourceItems.id, write.itemId))
                outcome.updated += 1
              }
            }
            if (applied.writes.length > 0) {
              await tx.update(resourceLibraries).set({ updatedAt: new Date() })
                .where(eq(resourceLibraries.id, input.libraryId))
            }
          },
          deriveOps: (model) => (state.next ? diffModels(model, state.next) : []),
          summary: `공용 리소스 승격 — ${library.name}`,
        })
        return { seq, ...outcome }
      } catch (err) {
        if (err instanceof OpApplyError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
      }
    }),
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/routers/resource-promote.test.ts`
Expected: PASS (8건)

`.for('update')`가 drizzle 버전에서 지원되지 않아 타입 오류가 나면, `tx.execute(sql\`SELECT id, kind, payload, version FROM resource_items WHERE library_id = ${input.libraryId} ORDER BY created_at FOR UPDATE\`)`로 바꾸고 `rows`를 `LibraryItem[]`로 매핑하라 — **행 락을 빼면 안 된다**(§5.2가 이 락 위에 서 있다).

- [ ] **Step 5: 서버 전체 스위트와 typecheck**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run && pnpm -s -C apps/server typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/routers/resource.ts apps/server/src/routers/resource-promote.test.ts
git commit -F - <<'EOF'
feat(server): resource.promote — 프로젝트 사전을 라이브러리로 올린다

라이브러리 쓰기와 프로젝트 origin 갱신을 prepare 훅으로 한 트랜잭션에 묶는다.
라이브러리 항목을 FOR UPDATE로 잠근 뒤 그 값으로 계획을 세우므로 버전 경합이
구조적으로 불가능하고, payload는 클라에서 받지 않고 서버가 모델을 다시 읽어
재계산해 클라가 본 상태와 다른 항목만 건너뛴다.

권한은 프로젝트 편집 + 라이브러리 쓰기 + "이 프로젝트의 조직" 3중이다. 세 번째가
없으면 두 조직에 속한 사용자가 남의 조직 라이브러리로 사전을 흘릴 수 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 5: server — `listForProject`에 `canWrite`

**Files:**
- Modify: `apps/server/src/routers/resource.ts:55-63`
- Modify: `apps/server/src/routers/resource.test.ts`

**Interfaces:**
- Consumes: 기존 `requireProjectAccess`(반환의 `orgRole`), `ctx.user.role`
- Produces: `resource.library.listForProject`의 각 행에 `canWrite: boolean` 추가. Task 6·7의 웹이 이 값으로 승격 탭과 라이브러리 목록을 거른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/routers/resource.test.ts`의 describe 안에 추가한다:

```ts
  it('listForProject는 라이브러리별 쓰기 권한을 함께 준다', async () => {
    await createAccount(app.db!, { email: 'sa@t.dev', name: 'SA', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'ow@t.dev', name: 'OW', password: 'pw-123456', role: 'user' })
    await createAccount(app.db!, { email: 'me@t.dev', name: 'ME', password: 'pw-123456', role: 'user' })
    const saToken = await loginAs(app, 'sa@t.dev', 'pw-123456')
    const ownerToken = await loginAs(app, 'ow@t.dev', 'pw-123456')
    const memberToken = await loginAs(app, 'me@t.dev', 'pw-123456')

    await post(app, 'resource.library.create', saToken, { scope: 'global', name: '전역' })
    const orgId = (await post(app, 'org.create', ownerToken, { name: '팀' })).json().result.data.id
    await post(app, 'resource.library.create', ownerToken, { scope: 'org', orgId, name: '조직' })
    const projectId = (await post(app, 'project.create', ownerToken, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'me@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', ownerToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    await post(app, 'project.members.add', ownerToken, {
      projectId, memberId: members.find((m) => m.email === 'me@t.dev')!.id, role: 'editor',
    })

    const asOwner = (await get(app, 'resource.library.listForProject', ownerToken, { projectId }))
      .json().result.data as Array<{ name: string; canWrite: boolean }>
    expect(asOwner.find((l) => l.name === '조직')!.canWrite).toBe(true)
    expect(asOwner.find((l) => l.name === '전역')!.canWrite).toBe(false)

    const asMember = (await get(app, 'resource.library.listForProject', memberToken, { projectId }))
      .json().result.data as Array<{ name: string; canWrite: boolean }>
    expect(asMember.every((l) => l.canWrite === false)).toBe(true)
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/routers/resource.test.ts`
Expected: FAIL — `canWrite`가 `undefined`

- [ ] **Step 3: 구현한다**

`apps/server/src/routers/resource.ts`의 `listForProject` 본문을 바꾼다:

```ts
    listForProject: authedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
        const rows = await listWithCounts(ctx.db, or(
          and(eq(resourceLibraries.scope, 'global'), isNull(resourceLibraries.orgId)),
          eq(resourceLibraries.orgId, access.project.orgId),
        ))
        // 클라가 역할 조합식을 재현하지 않도록 쓰기 가능 여부를 서버가 판정해 싣는다.
        // 목록의 조직 라이브러리는 전부 이 프로젝트의 조직 것이다.
        const isServiceAdmin = ctx.user.role === 'admin'
        const isOrgManager = access.orgRole === 'owner' || access.orgRole === 'admin'
        return rows.map((row) => ({
          ...row,
          canWrite: row.scope === 'global' ? isServiceAdmin : isOrgManager,
        }))
      }),
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/routers/resource.test.ts`
Expected: PASS

- [ ] **Step 5: 서버 전체 스위트와 typecheck**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run && pnpm -s -C apps/server typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/routers/resource.ts apps/server/src/routers/resource.test.ts
git commit -F - <<'EOF'
feat(server): listForProject가 라이브러리별 쓰기 권한을 함께 준다

승격 UI가 "이 라이브러리에 올릴 수 있는가"를 알아야 하는데, 클라가 역할
조합식을 재현하면 서버 정책과 갈린다. 전역은 서비스 관리자, 조직은 Org
Owner/Admin이라는 판정을 서버가 그대로 실어 보낸다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 6: web — 패널을 탭 구조로 나누고 op 상한 상수를 통일한다

**Files:**
- Modify: `apps/web/src/editor/resource-decisions.ts`
- Modify: `apps/web/src/editor/resource-decisions.test.ts`
- Modify: `apps/web/src/editor/resource-panel.tsx` (껍데기만 남긴다)
- Create: `apps/web/src/editor/resource-resync-tab.tsx`
- Modify: `apps/web/src/editor/resource-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `canWrite`(라이브러리 행), 기존 `planResync`/`applyResyncPlan`/`useModelMutation`
- Produces: `ResourceResyncTab({ projectId, library })`(신규 컴포넌트), `overLimitMessage(active: number): string | null`(`resource-decisions.ts`), `type LibraryRow = { id: string; scope: 'global' | 'org'; orgId: string | null; name: string; description: string; itemCount: number; canWrite: boolean }`(`resource-panel.tsx`에서 export). Task 7의 승격 탭이 같은 `LibraryRow`와 `overLimitMessage`를 쓴다.

- [ ] **Step 1: 상한 가드를 순수 헬퍼로 옮기고 테스트를 쓴다**

`apps/web/src/editor/resource-decisions.ts` 끝에 추가한다(상단에 `import { MAX_OPS_PER_MUTATION } from '@erdd/core'`):

```ts
/**
 * 적용 전 op 상한 가드. 서버(model.mutate·resource.promote)와 같은 상수를 쓴다 —
 * 여기서만 낮게 잡으면 서버가 받아 줄 배치를 UI가 헛되이 막는다.
 */
export function overLimitMessage(active: number): string | null {
  return active > MAX_OPS_PER_MUTATION
    ? `한 번에 ${MAX_OPS_PER_MUTATION}건까지 적용할 수 있습니다. 나눠 선택해 주세요.`
    : null
}
```

`apps/web/src/editor/resource-decisions.test.ts` 끝에 추가한다:

```ts
describe('overLimitMessage', () => {
  it('상한 이하면 null, 초과하면 안내 문구를 준다', () => {
    expect(overLimitMessage(MAX_OPS_PER_MUTATION)).toBeNull()
    expect(overLimitMessage(MAX_OPS_PER_MUTATION + 1))
      .toBe(`한 번에 ${MAX_OPS_PER_MUTATION}건까지 적용할 수 있습니다. 나눠 선택해 주세요.`)
  })
})
```

(파일 상단 import에 `MAX_OPS_PER_MUTATION`(`@erdd/core`)과 `overLimitMessage`를 추가한다.)

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-decisions.test.ts`
Expected: FAIL — `overLimitMessage is not a function`

- [ ] **Step 3: 재동기화 탭 컴포넌트를 분리한다**

`apps/web/src/editor/resource-resync-tab.tsx`를 만들고, 현재 `resource-panel.tsx`의 `EntryLabel`·`formatConflictValue`·`currentProjectPayload`·`ConflictValueDiff`·`EMPTY_PLAN`과 계획/결정/적용 로직 + 오른쪽 열 JSX 전체를 그대로 옮긴다. 컴포넌트 시그니처는:

```tsx
export function ResourceResyncTab({ projectId, library }: { projectId: string; library: LibraryRow }) {
```

옮기면서 바꾸는 것은 셋뿐이다:

1. `libraryId` 상태를 없애고 `library.id`를 쓴다(선택은 껍데기가 소유한다).
2. `items` 쿼리의 `enabled` 분기를 없앤다(항상 라이브러리가 정해진 채로 렌더된다).
3. 상한 가드를 `overLimitMessage`로 교체한다:

```tsx
    const message = overLimitMessage(active)
    if (message !== null) { toast.error(message); return }
```

`MAX_OPS` 상수 선언은 지운다.

- [ ] **Step 4: 껍데기를 다시 쓴다**

`apps/web/src/editor/resource-panel.tsx` 전체를 대체한다:

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Library } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { ResourceResyncTab } from './resource-resync-tab.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

export type LibraryRow = {
  id: string
  scope: 'global' | 'org'
  orgId: string | null
  name: string
  description: string
  itemCount: number
  canWrite: boolean
}

type Tab = 'resync' | 'promote'

/**
 * 헤더의 "공용 리소스". 두 방향을 탭으로 나눈다.
 * - 가져오기: 라이브러리 → 프로젝트(최초 가져오기 = 전 항목이 신규인 재동기화)
 * - 조직으로 승격: 프로젝트 → 라이브러리(쓰기 권한이 있는 라이브러리에만)
 */
export function ResourcePanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC()
  const canEdit = useEditorStore((s) => s.canEdit)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('resync')
  const [libraryId, setLibraryId] = useState<string | null>(null)

  const libraries = useQuery(trpc.resource.library.listForProject.queryOptions({ projectId }))
  const rows = (libraries.data ?? []) as LibraryRow[]
  const visible = tab === 'promote' ? rows.filter((row) => row.canWrite) : rows
  const library = visible.find((row) => row.id === libraryId) ?? null
  const canPromote = canEdit && rows.some((row) => row.canWrite)

  // 탭을 옮길 때 그 탭에서 못 쓰는 라이브러리 선택은 버린다.
  const switchTab = (next: Tab) => {
    setTab(next)
    if (next === 'promote' && libraryId !== null
      && !rows.some((row) => row.id === libraryId && row.canWrite)) {
      setLibraryId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Library /> 공용 리소스</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>공용 리소스</DialogTitle></DialogHeader>
        {canPromote && (
          <div role="tablist" aria-label="공용 리소스 방향" className="flex gap-1 border-b pb-2">
            {([['resync', '가져오기'], ['promote', '조직으로 승격']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value}
                className={`rounded px-2 py-1 text-sm ${tab === value ? 'bg-muted font-semibold' : ''}`}
                onClick={() => switchTab(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="grid content-start gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">라이브러리</h4>
            {libraries.isError && (
              <p role="alert" className="text-destructive">{libraries.error.message}</p>
            )}
            {!libraries.isError && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">사용할 수 있는 라이브러리가 없습니다</p>
            )}
            {visible.map((lib) => (
              <button key={lib.id} type="button"
                className={`rounded border px-2 py-1.5 text-left text-sm ${libraryId === lib.id ? 'border-primary' : ''}`}
                onClick={() => setLibraryId(lib.id)}>
                <span className="block">{lib.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {lib.scope === 'global' ? '전역' : '조직'} · 항목 {lib.itemCount}개
                </span>
              </button>
            ))}
          </div>

          <div className="grid max-h-[60vh] content-start gap-4 overflow-y-auto">
            {library === null && (
              <p className="text-sm text-muted-foreground">
                {tab === 'resync'
                  ? '라이브러리를 선택하면 가져올 항목과 갱신 내역을 보여줍니다.'
                  : '올릴 라이브러리를 선택하면 승격할 항목을 보여줍니다.'}
              </p>
            )}
            {library !== null && tab === 'resync' && (
              <ResourceResyncTab projectId={projectId} library={library} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

(승격 탭 렌더는 Task 7에서 붙인다.)

- [ ] **Step 5: 기존 테스트를 이동에 맞게 고친다**

`apps/web/src/editor/resource-panel.test.tsx`에서:

1. `LIBS`의 각 항목에 `canWrite: false`를 추가한다(승격 탭이 안 뜨는 기존 시나리오 유지).
2. `MANY_ITEMS` 상수와 그것을 쓰는 "상한 초과" 테스트를 **지운다** — 같은 판정을 `resource-decisions.test.ts`의 `overLimitMessage` 단위 테스트가 덮고, 상한이 5000으로 통일되면 DOM에 5001행을 그려야 해서 비용만 크다. 지운 이유를 커밋 메시지에 남긴다.
3. 나머지 테스트는 그대로 둔다(껍데기+탭 분리 후에도 통과해야 한다 — 이게 이 리팩터의 안전망이다).
4. 탭이 권한 없이는 안 보이는 것을 고정하는 테스트를 추가한다:

```ts
  it('쓰기 가능한 라이브러리가 없으면 승격 탭이 없다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
    expect(screen.queryByRole('tab', { name: '조직으로 승격' })).toBeNull()
  })
```

- [ ] **Step 6: 웹 테스트와 typecheck**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-panel.test.tsx src/editor/resource-decisions.test.ts && pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 7: 웹 전체 스위트**

Run: `pnpm --filter @erdd/web exec vitest run`
Expected: PASS (상한 DOM 테스트 1건이 빠지고 탭 테스트 1건 + 단위 테스트 1건이 늘어난다)

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-resync-tab.tsx \
        apps/web/src/editor/resource-panel.test.tsx apps/web/src/editor/resource-decisions.ts \
        apps/web/src/editor/resource-decisions.test.ts
git commit -F - <<'EOF'
refactor(web): 공용 리소스 패널을 탭 구조로 나누고 op 상한을 서버와 맞춘다

다이얼로그 껍데기(탭·라이브러리 선택)와 재동기화 탭을 분리했다. 동작은 그대로라
기존 패널 테스트가 안전망이 된다.

패널의 상한 가드가 500으로 굳어 있었는데 서버는 Excel 사이클에서 5000으로
올라갔다 — 서버가 받아 줄 배치를 UI가 헛되이 막고 있었다. 공용 헬퍼
overLimitMessage로 옮겨 MAX_OPS_PER_MUTATION을 쓰게 하고, 501행을 그려
확인하던 DOM 테스트는 같은 판정을 덮는 단위 테스트로 대체했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 7: web — 승격 탭

**Files:**
- Create: `apps/web/src/editor/promote-selection.ts`
- Create: `apps/web/src/editor/promote-selection.test.ts`
- Create: `apps/web/src/editor/resource-promote-tab.tsx`
- Create: `apps/web/src/editor/resource-promote-tab.test.tsx`
- Modify: `apps/web/src/editor/resource-panel.tsx` (승격 탭 렌더 배선)

**Interfaces:**
- Consumes: Task 1·2의 `planPromote`·`PromotePlan`·`PromoteEntry`, Task 4의 `resource.promote`, Task 6의 `LibraryRow`·`overLimitMessage`
- Produces: `ResourcePromoteTab({ projectId, library })`

- [ ] **Step 1: 순수 헬퍼의 실패하는 테스트를 쓴다**

`apps/web/src/editor/promote-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PromoteEntry, PromotePlan } from '@erdd/core'
import {
  danglingDomain, initialSelection, promoteSummary, setAllForStatus,
} from './promote-selection.js'

function entry(over: Partial<PromoteEntry> & Pick<PromoteEntry, 'entityId' | 'status'>): PromoteEntry {
  return {
    kind: 'word', name: '이름', targetItemId: null, targetVersion: null,
    payload: {}, changedFields: [], domainRef: null, ...over,
  }
}
function plan(entries: PromoteEntry[]): PromotePlan {
  return { libraryId: 'lib-1', entries, syncedCount: 0, linkedItemIds: {} }
}

describe('initialSelection', () => {
  it('new·update는 선택하고 name-match는 보류한다', () => {
    const selected = initialSelection(plan([
      entry({ entityId: 'a', status: 'new' }),
      entry({ entityId: 'b', status: 'update' }),
      entry({ entityId: 'c', status: 'name-match' }),
    ]))
    expect([...selected].sort()).toEqual(['a', 'b'])
  })
})

describe('setAllForStatus', () => {
  it('같은 상태의 항목만 켜고 끈다', () => {
    const p = plan([
      entry({ entityId: 'a', status: 'new' }),
      entry({ entityId: 'c', status: 'name-match' }),
    ])
    const on = setAllForStatus(new Set<string>(), p, 'name-match', true)
    expect([...on]).toEqual(['c'])
    const off = setAllForStatus(new Set(['a', 'c']), p, 'new', false)
    expect([...off]).toEqual(['c'])
  })
})

describe('danglingDomain', () => {
  const term = entry({
    entityId: 't1', status: 'new', kind: 'term',
    domainRef: { entityId: 'd1', targetItemId: null },
  })

  it('도메인이 라이브러리에 없고 함께 선택되지도 않으면 연결이 빈다', () => {
    expect(danglingDomain(term, new Set(['t1']))).toBe(true)
  })

  it('도메인을 함께 선택하면 연결된다', () => {
    expect(danglingDomain(term, new Set(['t1', 'd1']))).toBe(false)
  })

  it('도메인이 이미 라이브러리에 있으면 선택과 무관하다', () => {
    const linked = entry({
      entityId: 't1', status: 'new', kind: 'term',
      domainRef: { entityId: 'd1', targetItemId: 'sd' },
    })
    expect(danglingDomain(linked, new Set(['t1']))).toBe(false)
  })

  it('도메인 참조가 없으면 false', () => {
    expect(danglingDomain(entry({ entityId: 'w1', status: 'new' }), new Set(['w1']))).toBe(false)
  })
})

describe('promoteSummary', () => {
  it('추가·갱신 건수를 알리고, 건너뛴 항목이 있으면 덧붙인다', () => {
    expect(promoteSummary({ inserted: 2, updated: 1, skipped: [] }))
      .toBe('추가 2건 · 갱신 1건을 올렸습니다')
    expect(promoteSummary({ inserted: 0, updated: 0, skipped: [{ entityId: 'a', reason: 'missing' }] }))
      .toBe('추가 0건 · 갱신 0건을 올렸습니다 — 1건은 그 사이 상태가 바뀌어 건너뛰었습니다')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/promote-selection.test.ts`
Expected: FAIL — `Failed to resolve import "./promote-selection.js"`

- [ ] **Step 3: 순수 헬퍼를 구현한다**

`apps/web/src/editor/promote-selection.ts`:

```ts
import type { PromoteEntry, PromotePlan, PromoteStatus } from '@erdd/core'

/** 기본 선택: 신규·원본 갱신은 켜고, 동명 발견은 사람이 확인해야 하므로 끈다. */
export function initialSelection(plan: PromotePlan): Set<string> {
  const out = new Set<string>()
  for (const entry of plan.entries) {
    if (entry.status !== 'name-match') out.add(entry.entityId)
  }
  return out
}

/** 특정 상태의 항목 전부를 한 번에 켜거나 끈다(구역 일괄 버튼). */
export function setAllForStatus(
  selected: ReadonlySet<string>, plan: PromotePlan, status: PromoteStatus, on: boolean,
): Set<string> {
  const out = new Set(selected)
  for (const entry of plan.entries) {
    if (entry.status !== status) continue
    if (on) out.add(entry.entityId)
    else out.delete(entry.entityId)
  }
  return out
}

/**
 * 이 용어를 지금 올리면 도메인 연결이 비는가.
 * 도메인이 이미 라이브러리에 있거나 같은 배치에서 함께 올라가면 연결된다.
 */
export function danglingDomain(entry: PromoteEntry, selected: ReadonlySet<string>): boolean {
  const ref = entry.domainRef
  if (!ref || ref.targetItemId !== null) return false
  return !selected.has(ref.entityId)
}

export function promoteSummary(
  result: { inserted: number; updated: number; skipped: readonly unknown[] },
): string {
  const head = `추가 ${result.inserted}건 · 갱신 ${result.updated}건을 올렸습니다`
  return result.skipped.length === 0
    ? head
    : `${head} — ${result.skipped.length}건은 그 사이 상태가 바뀌어 건너뛰었습니다`
}
```

- [ ] **Step 4: 헬퍼 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/promote-selection.test.ts`
Expected: PASS (8건)

- [ ] **Step 5: 승격 탭의 실패하는 테스트를 쓴다**

`apps/web/src/editor/resource-promote-tab.test.tsx`:

```tsx
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { createEmptyModel, type Domain, type ProjectModel, type Term, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 0, canWrite: false },
  { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: true },
]

function word(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
function domain(id: string, name: string): Domain {
  return {
    id, name, category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}
function term(id: string, logicalName: string, domainId: string | null): Term {
  return { id, logicalName, physicalName: 'X', domainId, description: null, origin: null }
}

vi.mock('./use-model.js', () => ({ useModelMutation: () => vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function renderPanel(handlers: Parameters<typeof mockTrpcFetch>[0], model: ProjectModel) {
  mockTrpcFetch(handlers)
  useEditorStore.getState().setLoaded(model, 0, PROJECT_ID)
  grantEditPermission({ canEdit: true, canManage: true })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ResourcePanel projectId={PROJECT_ID} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

async function openPromoteTab() {
  await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
  await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
  await userEvent.click(await screen.findByRole('button', { name: /조직 표준/ }))
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourcePromoteTab', () => {
  it('쓰기 가능한 라이브러리만 목록에 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
    await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
    expect(screen.queryByRole('button', { name: /표준 사전/ })).toBeNull()
    expect(screen.getByRole('button', { name: /조직 표준/ })).toBeDefined()
  })

  it('프로젝트 자체 항목이 "신규 추가"로 뜨고 기본 선택된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('신규 추가 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', true)
  })

  it('동명 항목은 "동명 발견"으로 뜨고 기본 미선택이다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{
          id: 's1', kind: 'word', version: 1,
          payload: { logicalName: '회원', abbreviation: 'MEMBER', englishName: null, description: null },
        }],
      }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('동명 발견 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', false)
  })

  it('도메인을 함께 선택하면 "도메인 연결 비움" 경고가 사라진다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, {
      ...createEmptyModel(),
      domains: { d1: domain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'd1') },
    })
    await openPromoteTab()
    await screen.findByText('신규 추가 (2)')
    // 기본은 둘 다 선택 상태라 경고가 없다 → 도메인을 빼면 경고가 뜬다
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    expect(await screen.findByText('도메인 연결 비움')).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    await waitFor(() => expect(screen.queryByText('도메인 연결 비움')).toBeNull())
  })

  it('승격하면 서버 결과를 알리고 그룹 뷰를 유지한 채 모델을 되맞춘다', async () => {
    const promoted = vi.fn(() => ({ data: { seq: 1, inserted: 1, updated: 0, skipped: [] } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    useEditorStore.getState().enterGroupView('g1')
    await openPromoteTab()
    await screen.findByText('신규 추가 (1)')
    await userEvent.click(screen.getByRole('button', { name: '승격' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('추가 1건 · 갱신 0건을 올렸습니다'))
    expect(promoted).toHaveBeenCalledTimes(1)
    // resync를 썼으므로 그룹 뷰가 살아 있다(setLoaded면 null로 튕긴다)
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
    expect(useEditorStore.getState().seq).toBe(1)
  })
})
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-promote-tab.test.tsx`
Expected: FAIL — 승격 탭이 렌더되지 않아 "신규 추가" 텍스트를 못 찾는다

- [ ] **Step 7: 승격 탭을 구현한다**

`apps/web/src/editor/resource-promote-tab.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  planPromote, RESOURCE_KIND_LABEL,
  type LibraryItem, type PromoteEntry, type PromotePlan, type PromoteStatus,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { overLimitMessage } from './resource-decisions.js'
import {
  danglingDomain, initialSelection, promoteSummary, setAllForStatus,
} from './promote-selection.js'
import type { LibraryRow } from './resource-panel.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EMPTY_PLAN: PromotePlan = { libraryId: '', entries: [], syncedCount: 0, linkedItemIds: {} }

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
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
 * "조직으로 승격" 탭 — 프로젝트 사전을 라이브러리로 올린다.
 *
 * 서버가 모델을 바꾸므로 낙관적 반영을 하지 않는다. 성공하면 model.get으로 되맞추되
 * setLoaded가 아니라 resync를 쓴다 — 승격은 사전만 건드리므로 그룹 뷰에서 튕기면 안 된다.
 */
export function ResourcePromoteTab({
  projectId, library,
}: { projectId: string; library: LibraryRow }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const model = useEditorStore((s) => s.model)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const items = useQuery(trpc.resource.items.list.queryOptions({ libraryId: library.id }))
  const plan = useMemo(
    () => (items.data ? planPromote(model, library.id, items.data as LibraryItem[]) : EMPTY_PLAN),
    [model, library.id, items.data],
  )
  useEffect(() => { setSelected(initialSelection(plan)) }, [plan])

  const promote = useMutation(trpc.resource.promote.mutationOptions({
    onSuccess: async (result) => {
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
      toast.success(promoteSummary(result))
    },
    onError: (err) => toast.error(err.message),
  }))

  const onPromote = () => {
    const entries = plan.entries.filter((entry) => selected.has(entry.entityId))
    if (entries.length === 0) return
    const message = overLimitMessage(entries.length)
    if (message !== null) { toast.error(message); return }
    promote.mutate({
      projectId,
      libraryId: library.id,
      entries: entries.map((entry) => ({
        entityId: entry.entityId,
        expectedStatus: entry.status,
        expectedTargetItemId: entry.targetItemId,
      })),
    })
  }

  if (items.isError) return <p role="alert" className="text-destructive">{items.error.message}</p>

  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = plan.entries.filter((entry) => entry.status === status)
        return (
          <section key={status} className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{title} ({rows.length})</h4>
              {rows.length > 0 && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost"
                    onClick={() => setSelected((prev) => setAllForStatus(prev, plan, status, true))}>
                    모두 선택
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => setSelected((prev) => setAllForStatus(prev, plan, status, false))}>
                    모두 해제
                  </Button>
                </span>
              )}
            </div>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
            <ul className="grid gap-1">
              {rows.map((entry) => (
                <li key={entry.entityId}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" aria-label={`${entry.name} 선택`}
                      checked={selected.has(entry.entityId)}
                      onChange={(e) => {
                        const on = e.target.checked
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (on) next.add(entry.entityId)
                          else next.delete(entry.entityId)
                          return next
                        })
                      }} />
                    <EntryLabel entry={entry} />
                  </label>
                  {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
                    <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <section className="grid gap-1 text-xs text-muted-foreground">
        <h4 className="text-sm font-semibold text-foreground">유지</h4>
        <span>이미 이 라이브러리와 같은 항목 {plan.syncedCount}건</span>
      </section>

      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <span className="text-xs text-muted-foreground">올릴 항목 {selected.size}건</span>
        <Button type="button" disabled={selected.size === 0 || promote.isPending} onClick={onPromote}>
          승격
        </Button>
      </div>
    </>
  )
}
```

`apps/web/src/editor/resource-panel.tsx`에 렌더를 붙인다(`ResourceResyncTab` 렌더 아래):

```tsx
            {library !== null && tab === 'promote' && (
              <ResourcePromoteTab projectId={projectId} library={library} />
            )}
```

상단에 `import { ResourcePromoteTab } from './resource-promote-tab.js'`를 추가한다.

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-promote-tab.test.tsx src/editor/resource-panel.test.tsx`
Expected: PASS

- [ ] **Step 9: 웹 전체 스위트와 typecheck**

Run: `pnpm --filter @erdd/web exec vitest run && pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`

- [ ] **Step 10: 커밋**

```bash
git add apps/web/src/editor/promote-selection.ts apps/web/src/editor/promote-selection.test.ts \
        apps/web/src/editor/resource-promote-tab.tsx apps/web/src/editor/resource-promote-tab.test.tsx \
        apps/web/src/editor/resource-panel.tsx
git commit -F - <<'EOF'
feat(web): 공용 리소스 "조직으로 승격" 탭

쓰기 권한이 있는 라이브러리만 대상으로 고르고, 신규 추가·원본 갱신·동명 발견
3구역으로 계획을 보여준다. 동명 발견은 기본 미선택이고, 도메인이 라이브러리에
없는 용어에는 "도메인 연결 비움" 배지를 띄워 도메인을 함께 고르면 사라진다.

승격은 서버가 모델을 바꾸므로 낙관적 반영을 하지 않고, 성공 후 model.get으로
되맞추되 setLoaded가 아니라 resync를 쓴다 — 사전만 바뀌는데 그룹 뷰에서
튕기면 안 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

### Task 8: docs — 기획·로드맵 정합

**Files:**
- Modify: `docs/01-concepts.md:38`
- Modify: `docs/90-roadmap.md:23`

**Interfaces:**
- Consumes: 없음
- Produces: 없음(문서)

- [ ] **Step 1: `01-concepts.md`의 승격 문구를 구현에 맞춘다**

38행을 바꾼다:

```markdown
4. **승격(반대 방향)** — 프로젝트에서 다듬은 항목을 조직(또는 전역) 리소스로 올린다. 라이브러리에 쓰기 권한이 있는 사람(조직은 Org Owner/Admin, 전역은 서비스 관리자)이 프로젝트 화면에서 직접 실행하며, 요청·승인 큐는 두지 않는다. 승격하면 그 항목의 상류가 대상 라이브러리로 바뀐다(항목당 상류는 항상 하나다).
```

- [ ] **Step 2: `90-roadmap.md`의 Phase 2 항목에 승격을 더한다**

23행을 바꾼다:

```markdown
- 서비스 전역·조직 공용 리소스와 fork/재동기화, 프로젝트 → 조직/전역 승격 ([01-concepts](01-concepts.md), [승격 설계](superpowers/specs/2026-08-04-resource-promotion-design.md))
```

- [ ] **Step 3: 링크가 깨지지 않았는지 눈으로 확인한다**

Run: `ls docs/superpowers/specs/2026-08-04-resource-promotion-design.md docs/01-concepts.md docs/90-roadmap.md`
Expected: 세 파일 모두 존재

- [ ] **Step 4: 커밋**

```bash
git add docs/01-concepts.md docs/90-roadmap.md
git commit -F - <<'EOF'
docs: 승격을 권한 기반 직접 실행으로 기획에 반영한다

01-concepts.md 4항이 "조직 관리자 승인"이라고 적혀 있었으나 구현은 요청·승인
큐 없이 라이브러리 쓰기 권한으로 바로 올린다. 문구를 구현에 맞추고 로드맵의
공용 리소스 항목에 승격을 더했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/ebce6812-4ac6-49ce-a8cc-08c0a6f3f96e
EOF
```

---

## 최종 체크포인트 (컨트롤러)

태스크 8까지 끝나면 컨트롤러가 직접 한다 — 서브에이전트에게 맡기지 않는다.

- [ ] **전체 스위트 한 번에**

```bash
set -a && . ./.env && set +a && pnpm verify
```
Expected: typecheck EXIT=0 + core·cli·web·server 4개 스위트 전부 PASS.
기준선 대비 증분: core +22 · web +13(신규 14, 상한 DOM 테스트 1건 삭제) · server +11 (cli는 무변경)
→ 대략 core 451 · cli 114 · web 354 · server 119. 숫자가 어긋나면 어느 태스크에서 갈렸는지 먼저 찾는다.

- [ ] **최종 whole-branch 리뷰.** 프롬프트에 반드시 넣는다:
  - "이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라." (이번엔 `runMutation`/`mutateAndPublish`의 `prepare`, `resourceEntitiesOf`, `overLimitMessage`가 해당된다)
  - "`pnpm -s -r typecheck`의 출력이 비어 있다고 통과로 판정하지 마라 — 종료코드로 판정하거나 패키지별로 돌려라."
- [ ] **수정의 구분력 실증** — 리뷰 대응으로 고친 파일은 수정 전 버전으로 되돌려 새 테스트가 실제로 실패하는지 컨트롤러가 직접 확인한다(`git show <base>:<path> > /tmp/x && cp /tmp/x <path>` → 테스트 → `git checkout -- <path>`).
- [ ] **브라우저 스모크**(실 앱 + 실 DB). `127.0.0.1`로 접속한다.
  1. 조직 라이브러리를 하나 만든다(조직 화면).
  2. 프로젝트에서 단어·용어·도메인을 만들고 → 공용 리소스 → "조직으로 승격" → 신규 3건 승격 → 토스트 확인.
  3. 조직 라이브러리 화면에서 항목 3건이 생겼는지 확인한다.
  4. 같은 탭을 다시 열면 3건이 "유지"로만 잡히고 목록이 비는지 확인한다(왕복 불변식의 실물 확인).
  5. 프로젝트에서 그 단어를 고치고 다시 열어 "원본 갱신"으로 뜨는지, 승격 후 원본 버전이 오르는지 확인한다.
  6. 그룹 뷰에 들어간 상태로 승격해 뷰가 유지되는지 확인한다.
- [ ] **`HANDOFF.md` 갱신** — 완료 표에 이 sub-project 행 추가, 테스트 기준선 갱신, 3.2b에 승격 규칙(단일 origin·`base` 계산) 한 줄, 3.6에 `prepare` 훅 한 줄, 6절에 설계 §9의 한계를 이월로 옮긴다.
- [ ] main 머지 후 브랜치 삭제.

---

## Self-Review

**1. 스펙 커버리지**

| 설계 절 | 태스크 |
|---|---|
| §3.1 3상태 분류 | 1 |
| §3.2 origin만 바뀐다 | 2 (`diffModels`가 origin 1필드 update만 내는 테스트) |
| §3.3 `origin.base` 불변식 | 2 (왕복 테스트 + 도메인 없는 용어의 conflict 테스트) |
| §3.4 역투영·`domainRef` | 1 (분류), 2 (최종 해석) |
| §4 core API | 1, 2 |
| §5.1 `prepare` 훅 | 3 |
| §5.2 `promote` 프로시저·권한 3중·`FOR UPDATE`·skip | 4 |
| §5.3 `canWrite` | 5 |
| §6 웹 탭 분리·`MAX_OPS` 통일·`resync` | 6, 7 |
| §7 파일 구조 | 위 표와 일치 |
| §8 테스트 전략 | 1·2·4·5·6·7의 테스트 단계 |
| §9 한계 | 문서(8) + HANDOFF 이월(최종 체크포인트) |

**2. 플레이스홀더** — 없음. 모든 코드 블록이 실제 구현·테스트 본문이다.

**3. 타입 일관성**

- `PromotePlan`은 `{ libraryId, entries, syncedCount, linkedItemIds }` — Task 1이 정의하고 Task 2(`applyPromotePlan`)·Task 7(`EMPTY_PLAN`·`promote-selection.test.ts`의 `plan()`)이 같은 4필드를 쓴다.
- `PromoteEntry`의 필드명(`entityId`·`targetItemId`·`targetVersion`·`domainRef`)이 Task 1 정의 → Task 4 서버 대조 → Task 7 UI에서 동일하게 쓰인다.
- `PromoteWrite.version`은 Task 2가 계산하고 Task 4가 `insert`/`update` 양쪽에서 그대로 저장한다.
- `resource.promote` 출력 `{ seq, inserted, updated, skipped }`는 Task 4 정의 → Task 7의 `promoteSummary(result)` 입력과 일치한다.
- `LibraryRow`는 Task 6이 `resource-panel.tsx`에서 export하고 Task 7이 import한다. `canWrite`는 Task 5의 서버 응답 필드와 같은 이름이다.
