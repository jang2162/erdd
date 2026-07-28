# Phase 2 공용 리소스 fork/재동기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서비스 전역·조직 단위 공용 리소스 라이브러리(단어·용어·도메인·커스텀 항목)를 만들고, 프로젝트가 그것을 복사(fork)해 쓰다가 원본이 갱신되면 수동 재동기화로 신규 추가·자동 갱신·충돌을 항목별로 처리할 수 있게 한다.

**Architecture:** 라이브러리는 프로젝트 모델 **밖**의 서버 테이블 2개(`resource_libraries`, `resource_items`)다. 프로젝트 쪽 원본 참조는 기존 op 엔티티 4종(`domain`/`word`/`term`/`customField`)에 붙는 `origin` 필드(`{ libraryId, sourceId, sourceVersion, base }`)이고, `base`는 가져온 시점에 프로젝트에 써넣은 payload다. 덕분에 3-way 병합 전체가 `packages/core`의 순수 함수(`planResync`/`applyResyncPlan`)로 닫히고, 적용은 새 엔드포인트 없이 기존 producer + `diffModels` + `model.mutate` 경로를 그대로 탄다(Revision 1건·undo 1회).

**Tech Stack:** TypeScript, zod 4(core 스키마), drizzle-orm + PostgreSQL 17(server), tRPC v11 + Fastify(server), React 19 + zustand + TanStack Query(web), vitest + @testing-library/react.

**설계 문서:** [docs/superpowers/specs/2026-07-28-phase2-shared-resources-fork-design.md](../specs/2026-07-28-phase2-shared-resources-fork-design.md)

## Global Constraints

- `packages/core`는 IO·런타임 의존성 free(순수 도메인 로직). **새 런타임 의존성 추가 금지.** id 생성기는 인자로 주입한다(core는 uuidv7 비의존).
- **새 op 엔티티는 없다.** `ENTITY_KINDS`는 그대로 `['tableGroup','domain','word','term','customField','table','column','relationship','index','note']`. 기존 4종에 필드만 추가한다.
- 하위호환: `origin`은 `.nullable().default(null)`. `z.infer` **출력 타입은 필수**이므로 `: Domain`/`: Word`/`: Term`/`: CustomField`/`: ProjectModel` 리터럴에는 전부 `origin: null`을 넣어야 한다(typecheck-driven으로 훑는다).
- **`origin.sourceId`/`origin.libraryId`에 참조 무결성 검사를 추가하지 않는다.** 라이브러리 항목이 삭제돼도 프로젝트 사본은 살아 있어야 한다(프로젝트 독립성).
- 임시 가드가 필요하면 plain `Error`가 아니라 `@erdd/core`의 `OpApplyError`를 throw한다(라우터 catch가 `OpApplyError`만 400으로 매핑 — 과거 두 번 재발한 500 버그).
- 모델 변경은 op 엔진으로만. 클라이언트는 producer + `diffModels` 패턴(`mutate(producer, { summary })`).
- `apps/server/src/routers/model.ts`의 `ops` 상한(`.max(500)`)은 **바꾸지 않는다**. 초과분은 UI가 사전에 막는다.
- 마이그레이션은 append-only(**0007**). **이 워크트리에서는 격리 DB에만 적용한다** — dev `erdd_dev_a`, test `erdd_test_a`. 공유 `erdd`/`erdd_test`는 절대 건드리지 않는다(코디네이터가 병합 시점에 처리한다. 0007 번호 사용은 코디네이터 승인 완료).
- **이벤트 값은 producer 진입 전에 캡처**: `const v = e.target.value` 후 producer에 넘긴다(`serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로 lazy read는 stale 값을 읽는다).
- UI 카피는 한국어.
- 커밋은 **명시 파일만 스테이징**(`git add .` / `git add -A` 금지). `.idea/*`와 루트 `.env`는 절대 커밋하지 않는다.
- **`docs/superpowers/HANDOFF.md`와 `docs/91-checklist.md`는 이 트랙에서 수정하지 않는다**(코디네이터가 두 트랙 병합 후 한 번에 갱신).
- 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
  ```
- 테스트 기준선(시작 시점, 실측): **core 146 · web 159 · server 52(erdd_test_a) · `pnpm -r typecheck` 0 errors**. 각 태스크 종료 시 해당 패키지 스위트가 그린이어야 한다.

## 테스트 실행 명령

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```

단일 파일: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts`

## File Structure

**core (`packages/core/src/`)**

| 파일 | 책임 |
|---|---|
| `model.ts` (수정) | `OriginSchema`/`Origin`, 4종 엔티티에 `origin` |
| `resource.ts` (신규) | `RESOURCE_KINDS`, 컬렉션·라벨 매핑, payload 스키마·투영 |
| `resource-sync.ts` (신규) | `planResync` / `applyResyncPlan` |
| `index.ts` (수정) | 신규 export |

**server (`apps/server/src/`)**

| 파일 | 책임 |
|---|---|
| `db/schema.ts` (수정) | `resourceLibraries`, `resourceItems` + 모델 4종에 `origin jsonb` |
| `drizzle/0007_*.sql` (신규, drizzle-kit 생성) | 마이그레이션 |
| `services/model-store.ts` (수정) | `loadProjectModel`의 `origin` 매핑 |
| `services/resource-library.ts` (신규) | 권한 헬퍼 + 예시 시드 `ensureStarterGlobalLibrary` |
| `routers/resource.ts` (신규) | 라이브러리·항목 CRUD |
| `router.ts` / `main.ts` (수정) | 라우터 등록 / 시드 훅 |
| `testing/db.ts` (수정) | `TEST_TABLES`에 신규 테이블 |
| `testing/helpers.ts` (수정) | `withUuidIds`가 `origin`을 건드리지 않는다는 계약 주석 |

**web (`apps/web/src/`)**

| 파일 | 책임 |
|---|---|
| `components/resource-library-manager.tsx` (신규) | 라이브러리 목록·CRUD·항목 목록(전역/조직 공용) |
| `components/resource-item-form.tsx` (신규) | 종류별 항목 편집 폼 4종 |
| `editor/resource-decisions.ts` (신규) | 결정 상태 초기화·일괄 조작 순수 헬퍼 |
| `editor/resource-panel.tsx` (신규) | 프로젝트 "공용 리소스" 다이얼로그 |
| `pages/admin.tsx` / `pages/org-detail.tsx` (수정) | 관리 컴포넌트 배선 |
| `pages/project.tsx` (수정) | 헤더 5번째 진입 버튼 |

---

## Task 1: core `origin` 필드 + 리소스 종류 정의

**Files:**
- Modify: `packages/core/src/model.ts`
- Create: `packages/core/src/resource.ts`
- Create: `packages/core/src/resource.test.ts`
- Modify: `packages/core/src/model.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify(typecheck 사후 정리): `packages/core/src/*.test.ts`, `apps/server/src/services/model-store.ts`, `apps/web/src/**`

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces:
  - `OriginSchema`, `type Origin = { libraryId: string; sourceId: string; sourceVersion: number; base: Record<string, unknown> }`
  - `Domain`/`Word`/`Term`/`CustomField`에 `origin: Origin | null`
  - `RESOURCE_KINDS`, `type ResourceKind = 'domain'|'word'|'term'|'customField'`
  - `RESOURCE_COLLECTION_BY_KIND`, `RESOURCE_KIND_LABEL`, `RESOURCE_PAYLOAD_SCHEMAS`
  - `resourcePayloadOf(kind, entity): Record<string, unknown>`
  - `resourceDisplayName(kind, payload): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — `origin` 하위호환과 왕복**

`packages/core/src/model.test.ts`에 아래 describe 블록을 **추가**한다(기존 테스트는 건드리지 않는다 — `createEmptyModel`의 컬렉션 구성은 변하지 않는다).

```ts
import { DomainSchema, WordSchema, TermSchema, CustomFieldSchema } from './model.js'

describe('origin (공용 리소스 원본 참조)', () => {
  const domainPayload = {
    id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  }

  it('origin을 생략하면 null로 파싱된다 (옛 op 페이로드·옛 스냅샷)', () => {
    expect(DomainSchema.parse(domainPayload).origin).toBeNull()
    expect(WordSchema.parse({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
    }).origin).toBeNull()
    expect(TermSchema.parse({
      id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: null, description: null,
    }).origin).toBeNull()
    expect(CustomFieldSchema.parse({
      id: 'f1', name: '개인정보여부', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null, order: 0,
    }).origin).toBeNull()
  })

  it('origin을 그대로 왕복한다', () => {
    const origin = {
      libraryId: 'lib1', sourceId: 'src1', sourceVersion: 3,
      base: { name: '금액', category: null },
    }
    expect(DomainSchema.parse({ ...domainPayload, origin }).origin).toEqual(origin)
  })

  it('origin에 알 수 없는 키가 있으면 거부한다', () => {
    const bad = { libraryId: 'l', sourceId: 's', sourceVersion: 1, base: {}, extra: 1 }
    expect(DomainSchema.safeParse({ ...domainPayload, origin: bad }).success).toBe(false)
  })
})
```

`packages/core/src/resource.test.ts`를 새로 만든다.

```ts
import { describe, expect, it } from 'vitest'
import {
  CustomFieldSchema, DomainSchema, TermSchema, WordSchema,
} from './model.js'
import {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL,
  RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName, resourcePayloadOf,
} from './resource.js'

describe('resource kinds', () => {
  it('4종을 고정 순서로 노출한다', () => {
    expect(RESOURCE_KINDS).toEqual(['domain', 'word', 'term', 'customField'])
  })

  it('컬렉션·라벨 매핑이 모든 종류를 덮는다', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(RESOURCE_COLLECTION_BY_KIND[kind]).toBeTruthy()
      expect(RESOURCE_KIND_LABEL[kind]).toBeTruthy()
    }
  })
})

describe('RESOURCE_PAYLOAD_SCHEMAS', () => {
  const ENTITY_SHAPES = {
    domain: DomainSchema, word: WordSchema, term: TermSchema, customField: CustomFieldSchema,
  } as const

  it('엔티티 스키마에서 id·origin(+customField의 order)만 뺀 형태다', () => {
    for (const kind of RESOURCE_KINDS) {
      const dropped = kind === 'customField'
        ? ['id', 'origin', 'order']
        : ['id', 'origin']
      const expected = Object.keys(ENTITY_SHAPES[kind].shape)
        .filter((k) => !dropped.includes(k)).sort()
      expect(Object.keys(RESOURCE_PAYLOAD_SCHEMAS[kind].shape).sort()).toEqual(expected)
    }
  })

  it('id가 섞인 payload를 거부한다', () => {
    const res = RESOURCE_PAYLOAD_SCHEMAS.word.safeParse({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
    })
    expect(res.success).toBe(false)
  })
})

describe('resourcePayloadOf', () => {
  it('도메인에서 id·origin을 뺀다', () => {
    const entity = {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
      origin: { libraryId: 'l', sourceId: 's', sourceVersion: 1, base: {} },
    }
    const payload = resourcePayloadOf('domain', entity)
    expect(payload.id).toBeUndefined()
    expect(payload.origin).toBeUndefined()
    expect(payload.name).toBe('금액')
    expect(RESOURCE_PAYLOAD_SCHEMAS.domain.safeParse(payload).success).toBe(true)
  })

  it('커스텀 항목에서는 order도 뺀다 (순서는 프로젝트의 표시 관심사)', () => {
    const payload = resourcePayloadOf('customField', {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null, order: 7, origin: null,
    })
    expect(payload.order).toBeUndefined()
    expect(RESOURCE_PAYLOAD_SCHEMAS.customField.safeParse(payload).success).toBe(true)
  })
})

describe('resourceDisplayName', () => {
  it('도메인·커스텀 항목은 name, 단어·용어는 logicalName을 쓴다', () => {
    expect(resourceDisplayName('domain', { name: '금액' })).toBe('금액')
    expect(resourceDisplayName('customField', { name: '개인정보여부' })).toBe('개인정보여부')
    expect(resourceDisplayName('word', { logicalName: '회원' })).toBe('회원')
    expect(resourceDisplayName('term', { logicalName: '회원번호' })).toBe('회원번호')
  })

  it('이름 필드가 없으면 빈 문자열', () => {
    expect(resourceDisplayName('word', {})).toBe('')
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource.test.ts src/model.test.ts`
Expected: FAIL — `Failed to resolve import "./resource.js"`, 그리고 model.test.ts의 origin 테스트가 `undefined`를 받는다.

- [ ] **Step 3: `model.ts`에 `OriginSchema`와 `origin` 필드를 추가한다**

`packages/core/src/model.ts`의 `DomainSchema` 정의 **바로 위**에 다음을 넣는다.

```ts
/**
 * 공용 리소스 라이브러리에서 복사(fork)해 온 항목의 원본 참조.
 * base는 "가져온(또는 마지막으로 재동기화 처리한) 시점에 프로젝트에 써넣은 payload"이며
 * 프로젝트 공간이다(term.domainId는 프로젝트 도메인 id). 3-way 병합의 기준점.
 * libraryId가 있어야 여러 라이브러리를 쓰는 프로젝트에서 계획 대상을 정확히 가를 수 있다.
 */
export const OriginSchema = z.strictObject({
  libraryId: z.string(),
  sourceId: z.string(),
  sourceVersion: z.number().int(),
  base: z.record(z.string(), z.unknown()),
})
export type Origin = z.infer<typeof OriginSchema>
```

그리고 `DomainSchema`·`WordSchema`·`TermSchema`·`CustomFieldSchema` 각각의 마지막 필드 뒤에 다음 줄을 추가한다.

```ts
  origin: OriginSchema.nullable().default(null),
```

> `base`의 추론 타입이 `Record<string, unknown>`이 아니라 옵셔널이 섞인 형태로 나오면(zod 버전 특성) `z.record(z.string(), z.unknown())` 대신 `z.record(z.string(), z.any())`를 쓰고 `Origin['base']`를 `Record<string, unknown>`으로 좁히는 타입 별칭을 둔다. 판정 기준은 `pnpm -r typecheck` 통과 여부다.

- [ ] **Step 4: `resource.ts`를 만든다**

```ts
import type { z } from 'zod'
import {
  CustomFieldSchema, DomainSchema, TermSchema, WordSchema, type ProjectModel,
} from './model.js'

/** 공용 리소스로 다루는 엔티티 종류. 배열 순서 = 화면 표시 순서. */
export const RESOURCE_KINDS = ['domain', 'word', 'term', 'customField'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export const RESOURCE_COLLECTION_BY_KIND = {
  domain: 'domains', word: 'words', term: 'terms', customField: 'customFields',
} as const satisfies Record<ResourceKind, keyof ProjectModel>

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  domain: '도메인', word: '단어', term: '용어', customField: '커스텀 항목',
}

/**
 * 라이브러리 항목 payload 스키마 — 엔티티에서 id·origin(+ customField의 order)을 뺀 형태.
 * customField의 order를 빼는 이유: 순서는 프로젝트의 표시 관심사다. payload에 넣으면
 * 사용자가 패널에서 순서만 바꿔도 "프로젝트 수정"으로 잡혀 엉뚱한 충돌이 난다.
 */
export const RESOURCE_PAYLOAD_SCHEMAS = {
  domain: DomainSchema.omit({ id: true, origin: true }),
  word: WordSchema.omit({ id: true, origin: true }),
  term: TermSchema.omit({ id: true, origin: true }),
  customField: CustomFieldSchema.omit({ id: true, origin: true, order: true }),
} satisfies Record<ResourceKind, z.ZodType>

const DROPPED_KEYS = ['id', 'origin'] as const

/** 엔티티 → payload 투영(비교·저장 공용). RESOURCE_PAYLOAD_SCHEMAS와 키 집합이 일치한다. */
export function resourcePayloadOf(
  kind: ResourceKind, entity: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entity)) {
    if ((DROPPED_KEYS as readonly string[]).includes(key)) continue
    if (kind === 'customField' && key === 'order') continue
    out[key] = value
  }
  return out
}

/** 목록·충돌 화면에 쓰는 표시 이름. */
export function resourceDisplayName(
  kind: ResourceKind, payload: Record<string, unknown>,
): string {
  const key = kind === 'domain' || kind === 'customField' ? 'name' : 'logicalName'
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}
```

> `z.strictObject(...).omit(...)`이 `.shape`를 잃거나 타입이 깨지면, 위 4개 스키마를 `z.strictObject({...})`로 **명시적으로** 다시 쓴다(필드 구성은 `model.ts`와 동일). 어느 쪽이든 Step 1의 "엔티티 스키마와 키 집합 1:1" 테스트가 계약을 고정한다.

- [ ] **Step 5: `index.ts`에 export를 추가한다**

`packages/core/src/index.ts`의 `model.js` export 블록에 `OriginSchema`를, 타입 블록에 `Origin`을 추가하고, 파일 끝에 다음을 추가한다.

```ts
export {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, RESOURCE_PAYLOAD_SCHEMAS,
  resourcePayloadOf, resourceDisplayName,
} from './resource.js'
export type { ResourceKind } from './resource.js'
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run`
Expected: PASS (146 + 신규 11건 = 157건)

- [ ] **Step 7: typecheck로 `origin: null` 누락 지점을 전부 훑는다**

Run: `pnpm -r typecheck`

`origin`이 출력 타입에서 필수이므로 `Domain`/`Word`/`Term`/`CustomField` 리터럴을 만드는 모든 곳이 에러로 뜬다. 각 지점에 `origin: null`을 추가한다. 알려진 지점:

- `apps/server/src/services/model-store.ts` — `domains`/`words`/`terms`/`customFields` 매핑 4곳에 `origin: r.origin ?? null` (아직 DB 컬럼이 없으므로 이 태스크에서는 **`origin: null`** 로 두고 Task 3에서 `r.origin ?? null`로 바꾼다)
- `apps/web/src/editor/dict-panel.tsx` — `createWord`(2곳: 미등록 단어 일괄 등록, 단어 추가), `createTerm`(1곳)
- `apps/web/src/editor/edit-panel.tsx:180` — `createTerm`
- `apps/web/src/editor/domain-edit-dialog.tsx:78` — `createDomain`
- `apps/web/src/editor/custom-field-edit-dialog.tsx:65` — `createCustomField`
- 테스트 픽스처 팩토리: `apps/web/src/editor/dict-edits.test.ts`(`word`/`term` 헬퍼), `domain-edits.test.ts`(`dom` 헬퍼), `custom-field-edits.test.ts`(`newField` 헬퍼), `dict-panel.test.tsx`, `domain-panel.test.tsx`, `custom-field-panel.test.tsx`, `edit-panel.test.tsx`, `undo-redo.test.tsx`
- core 테스트: `warnings.test.ts`, `naming.test.ts`, `op.test.ts`, `custom-field.test.ts`, `integrity.test.ts`, `ddl.test.ts`, `domain-resolve.test.ts` 중 해당 엔티티 리터럴이 있는 곳
- `apps/server/src/routers/model.test.ts`, `apps/server/src/services/model-store.test.ts`

**팩토리 헬퍼가 있는 테스트 파일은 헬퍼 한 곳만 고치면 된다.** 예:

```ts
const word = (id: string, over: Partial<Word> = {}): Word =>
  ({ id, logicalName: '회원', abbreviation: 'MBR', description: null, origin: null, ...over })
```

Expected(수정 후): `pnpm -r typecheck` → 0 errors

- [ ] **Step 8: 전 스위트를 돌린다**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: core 157 · web 159 · server 52 · typecheck 0 errors

- [ ] **Step 9: 커밋**

```bash
git add packages/core/src/model.ts packages/core/src/resource.ts packages/core/src/resource.test.ts \
        packages/core/src/model.test.ts packages/core/src/index.ts
# typecheck 사후 정리로 실제 변경된 파일만 골라서 추가한다(git status로 확인 후 명시)
git commit -m "$(cat <<'EOF'
feat(core): 공용 리소스 원본 참조 origin 필드와 리소스 종류 정의

domain/word/term/customField에 origin({libraryId, sourceId, sourceVersion, base})을
추가한다. base는 가져온 시점에 프로젝트에 써넣은 payload(프로젝트 공간)라
"프로젝트가 고쳤는가"를 deepEqual 한 번으로 판정할 수 있고 3-way 병합이 core에서
닫힌다. customField의 order는 payload에서 제외한다 — 순서는 프로젝트의 표시
관심사이고, 포함하면 순서만 바꿔도 충돌로 잡힌다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 2: core 병합 엔진 (`planResync` / `applyResyncPlan`)

**Files:**
- Create: `packages/core/src/resource-sync.ts`
- Create: `packages/core/src/resource-sync.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1의 `Origin`, `RESOURCE_KINDS`, `RESOURCE_COLLECTION_BY_KIND`, `resourcePayloadOf`, `resourceDisplayName`, `ResourceKind`. 기존 `deepEqual`(`equal.ts`).
- Produces:
  - `type LibraryItem = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }`
  - `type ResyncStatus = 'added' | 'auto-update' | 'conflict'`
  - `type ResyncDecision = 'apply' | 'keep' | 'defer'`
  - `type ResyncEntry`(아래 코드 참조), `type ResyncPlan`
  - `planResync(model: ProjectModel, libraryId: string, items: readonly LibraryItem[]): ResyncPlan`
  - `applyResyncPlan(model: ProjectModel, plan: ResyncPlan, decisions: Readonly<Record<string, ResyncDecision>>, newId: () => string): ProjectModel`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 분류**

`packages/core/src/resource-sync.test.ts`를 만든다.

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel, type Word } from './model.js'
import { validateModelIntegrity } from './integrity.js'
import { diffModels } from './diff.js'
import { applyResyncPlan, planResync, type LibraryItem } from './resource-sync.js'

const LIB = 'lib-1'

function wordItem(id: string, logicalName: string, abbreviation: string, version = 1): LibraryItem {
  return { id, kind: 'word', version, payload: { logicalName, abbreviation, description: null } }
}
function domainItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'domain', version,
    payload: {
      name, category: null, logicalType: 'VARCHAR(100)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    },
  }
}
function termItem(id: string, logicalName: string, physicalName: string,
  domainSourceId: string | null, version = 1): LibraryItem {
  return {
    id, kind: 'term', version,
    payload: { logicalName, physicalName, domainId: domainSourceId, description: null },
  }
}
function customFieldItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'customField', version,
    payload: { name, target: 'column', type: 'text', options: [], required: false, defaultValue: null },
  }
}

/** 이 라이브러리 항목을 가져온 상태의 프로젝트 단어. */
function forkedWord(
  id: string, sourceId: string, logicalName: string, abbreviation: string, sourceVersion = 1,
): Word {
  const payload = { logicalName, abbreviation, description: null }
  return { id, ...payload, origin: { libraryId: LIB, sourceId, sourceVersion, base: payload } }
}

let seq = 0
const newId = () => `new-${++seq}`

describe('planResync — 분류', () => {
  it('프로젝트에 사본이 없으면 added', () => {
    const plan = planResync(createEmptyModel(), LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]!.status).toBe('added')
    expect(plan.entries[0]!.name).toBe('회원')
    expect(plan.entries[0]!.fromVersion).toBeNull()
    expect(plan.entries[0]!.projectEntityId).toBeNull()
  })

  it('버전이 같으면 목록에 없고 keptSynced로 센다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR', 1)])
    expect(plan.entries).toHaveLength(0)
    expect(plan.keptSynced).toBe(1)
  })

  it('원본만 바뀌면 auto-update', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    expect(plan.entries[0]!.status).toBe('auto-update')
    expect(plan.entries[0]!.fromVersion).toBe(1)
    expect(plan.entries[0]!.version).toBe(2)
    expect(plan.entries[0]!.changedFields).toEqual(['abbreviation'])
  })

  it('원본도 바뀌고 프로젝트도 고쳤으면 conflict', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    expect(plan.entries[0]!.status).toBe('conflict')
  })

  it('origin이 없는 항목은 keptLocal이고 계획에 영향이 없다', () => {
    const local: Word = { id: 'w9', logicalName: '쿠폰', abbreviation: 'CPN', description: null, origin: null }
    const model: ProjectModel = { ...createEmptyModel(), words: { w9: local } }
    const plan = planResync(model, LIB, [])
    expect(plan.keptLocal).toBe(1)
    expect(plan.entries).toHaveLength(0)
  })

  it('원본에서 사라진 항목은 keptDetached로만 센다 (삭제 제안 없음)', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [])
    expect(plan.keptDetached).toBe(1)
    expect(plan.entries).toHaveLength(0)
  })

  it('다른 라이브러리에서 온 항목은 어느 카운트에도 넣지 않는다', () => {
    const other = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: { ...other, origin: { ...other.origin!, libraryId: 'lib-other' } } },
    }
    const plan = planResync(model, LIB, [])
    expect(plan).toMatchObject({ keptLocal: 0, keptSynced: 0, keptDetached: 0 })
    expect(plan.entries).toHaveLength(0)
  })

  it('added인데 같은 종류에 같은 이름이 있으면 nameClash', () => {
    const local: Word = { id: 'w9', logicalName: '회원', abbreviation: 'MEM', description: null, origin: null }
    const model: ProjectModel = { ...createEmptyModel(), words: { w9: local } }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries[0]!.nameClash).toBe(true)
  })

  it('entries를 종류 순서(도메인→단어→용어→커스텀 항목)로 정렬한다', () => {
    const plan = planResync(createEmptyModel(), LIB, [
      customFieldItem('s4', '비고'),
      wordItem('s2', '회원', 'MBR'),
      termItem('s3', '회원번호', 'MBR_NO', null),
      domainItem('s1', '금액'),
    ])
    expect(plan.entries.map((e) => e.kind)).toEqual(['domain', 'word', 'term', 'customField'])
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts`
Expected: FAIL — `Failed to resolve import "./resource-sync.js"`

- [ ] **Step 3: `resource-sync.ts`를 구현한다**

```ts
import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, resourceDisplayName, resourcePayloadOf,
  type ResourceKind,
} from './resource.js'

/** 라이브러리 항목(서버 resource_items 한 행). payload는 라이브러리 공간이다. */
export type LibraryItem = {
  id: string
  kind: ResourceKind
  payload: Record<string, unknown>
  version: number
}

export type ResyncStatus = 'added' | 'auto-update' | 'conflict'
export type ResyncDecision = 'apply' | 'keep' | 'defer'

export type ResyncEntry = {
  kind: ResourceKind
  sourceId: string
  name: string
  status: ResyncStatus
  version: number
  /** 프로젝트가 들고 있던 버전. added면 null. */
  fromVersion: number | null
  /** 대응하는 프로젝트 엔티티 id. added면 null. */
  projectEntityId: string | null
  /** 라이브러리 공간 payload — 적용 시점에 다시 투영하기 위해 원본 그대로 싣는다. */
  sourcePayload: Record<string, unknown>
  /** 계획 시점 색인으로 투영한 프로젝트 공간 payload(표시·changedFields용). */
  nextPayload: Record<string, unknown>
  /** origin.base 대비 원본이 바꾼 필드. added면 []. */
  changedFields: string[]
  /** added인데 같은 종류에 같은 표시 이름이 이미 있음. */
  nameClash: boolean
}

export type ResyncPlan = {
  libraryId: string
  entries: ResyncEntry[]
  /** origin이 없는(프로젝트 자체 추가) 항목 수. */
  keptLocal: number
  /** 이 라이브러리에서 왔고 버전이 같은 항목 수. */
  keptSynced: number
  /** 이 라이브러리에서 왔으나 원본 항목이 사라진 항목 수. */
  keptDetached: number
}

type OriginBearing = { id: string; origin: Origin | null }

function entitiesOf(model: ProjectModel, kind: ResourceKind): OriginBearing[] {
  const collection = model[RESOURCE_COLLECTION_BY_KIND[kind]] as unknown as Record<string, OriginBearing>
  return Object.values(collection)
}

function keyOf(kind: ResourceKind, sourceId: string): string {
  return `${kind}:${sourceId}`
}

/**
 * 라이브러리 공간 payload를 프로젝트 공간으로 투영한다.
 * 지금 참조를 갖는 종류는 term(domainId)뿐이다. 색인에 없으면 null —
 * 도메인을 함께 가져오지 않아도 용어가 유효하게 들어간다.
 */
function projectPayload(
  kind: ResourceKind, payload: Record<string, unknown>, idBySource: Map<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const sourceDomainId = payload.domainId
  const mapped = typeof sourceDomainId === 'string'
    ? idBySource.get(keyOf('domain', sourceDomainId)) ?? null
    : null
  return { ...payload, domainId: mapped }
}

/**
 * 라이브러리 항목 목록과 프로젝트 모델을 3-way 비교해 재동기화 계획을 만든다.
 * "원본이 바뀌었다"의 판정은 오직 버전 비교다 — payload 비교로 하면 참조 투영 결과가
 * 나중에 달라졌을 때(예: 도메인을 나중에 추가로 가져옴) 원본이 그대로인데도 변경으로 잡힌다.
 */
export function planResync(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): ResyncPlan {
  const linked = new Map<string, { entity: OriginBearing; payload: Record<string, unknown> }>()
  const idBySource = new Map<string, string>()
  const namesByKind = new Map<ResourceKind, Set<string>>()
  let keptLocal = 0

  for (const kind of RESOURCE_KINDS) {
    const names = new Set<string>()
    for (const entity of entitiesOf(model, kind)) {
      const payload = resourcePayloadOf(kind, entity as unknown as Record<string, unknown>)
      names.add(resourceDisplayName(kind, payload).trim())
      if (!entity.origin) { keptLocal += 1; continue }
      idBySource.set(keyOf(kind, entity.origin.sourceId), entity.id)
      if (entity.origin.libraryId !== libraryId) continue
      linked.set(keyOf(kind, entity.origin.sourceId), { entity, payload })
    }
    namesByKind.set(kind, names)
  }

  const entries: ResyncEntry[] = []
  const seen = new Set<string>()
  let keptSynced = 0

  for (const item of items) {
    const key = keyOf(item.kind, item.id)
    seen.add(key)
    const name = resourceDisplayName(item.kind, item.payload)
    const nextPayload = projectPayload(item.kind, item.payload, idBySource)
    const link = linked.get(key)

    if (!link) {
      entries.push({
        kind: item.kind, sourceId: item.id, name, status: 'added',
        version: item.version, fromVersion: null, projectEntityId: null,
        sourcePayload: item.payload, nextPayload, changedFields: [],
        nameClash: namesByKind.get(item.kind)!.has(name.trim()),
      })
      continue
    }

    const origin = link.entity.origin!
    if (origin.sourceVersion === item.version) { keptSynced += 1; continue }

    const modified = !deepEqual(link.payload, origin.base)
    const changedFields = Object.keys(nextPayload)
      .filter((prop) => !deepEqual(nextPayload[prop], origin.base[prop]))
    entries.push({
      kind: item.kind, sourceId: item.id, name,
      status: modified ? 'conflict' : 'auto-update',
      version: item.version, fromVersion: origin.sourceVersion,
      projectEntityId: link.entity.id,
      sourcePayload: item.payload, nextPayload, changedFields, nameClash: false,
    })
  }

  let keptDetached = 0
  for (const key of linked.keys()) if (!seen.has(key)) keptDetached += 1

  const kindOrder = new Map(RESOURCE_KINDS.map((k, i) => [k, i]))
  entries.sort((a, b) =>
    kindOrder.get(a.kind)! - kindOrder.get(b.kind)! || a.name.localeCompare(b.name))

  return { libraryId, entries, keptLocal, keptSynced, keptDetached }
}
```

- [ ] **Step 4: 테스트를 돌려 분류가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts`
Expected: `planResync — 분류` 9건 PASS, `applyResyncPlan` 관련은 아직 없음

- [ ] **Step 5: 실패하는 테스트를 쓴다 — 적용**

`resource-sync.test.ts` 끝에 추가한다.

```ts
describe('applyResyncPlan', () => {
  it('added + apply가 origin을 달고 엔티티를 만든다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    const next = applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    const created = Object.values(next.words)[0]!
    expect(created.logicalName).toBe('회원')
    expect(created.origin).toEqual({
      libraryId: LIB, sourceId: 's1', sourceVersion: 3,
      base: { logicalName: '회원', abbreviation: 'MBR', description: null },
    })
  })

  it('defer(기본)는 아무것도 하지 않는다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(applyResyncPlan(model, plan, {}, newId)).toBe(model)
  })

  it('auto-update + apply가 내용과 origin을 함께 갱신한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    const next = applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    expect(next.words.w1!.abbreviation).toBe('MEMBER')
    expect(next.words.w1!.origin!.sourceVersion).toBe(2)
  })

  it('conflict + keep은 내용을 유지하고 origin만 갱신한다 — 다음엔 안 뜨고, 원본이 또 바뀌면 다시 충돌', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    const kept = applyResyncPlan(model, plan, { s1: 'keep' }, newId)

    expect(kept.words.w1!.abbreviation).toBe('MB')          // 프로젝트 값 유지
    expect(kept.words.w1!.origin!.sourceVersion).toBe(2)
    expect(kept.words.w1!.origin!.base).toEqual(
      { logicalName: '회원', abbreviation: 'MEMBER', description: null })  // 원본 현재값

    // 같은 원본으로 다시 계획하면 목록에 없다
    expect(planResync(kept, LIB, [wordItem('s1', '회원', 'MEMBER', 2)]).entries).toHaveLength(0)
    // 원본이 또 바뀌면 자동 갱신이 아니라 다시 충돌이다(로컬 수정이 조용히 덮이지 않는다)
    const again = planResync(kept, LIB, [wordItem('s1', '회원', 'MBRS', 3)])
    expect(again.entries[0]!.status).toBe('conflict')
  })

  it('도메인과 용어를 함께 추가하면 term.domainId가 새 프로젝트 도메인 id로 투영된다', () => {
    const model = createEmptyModel()
    const items = [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')]
    const plan = planResync(model, LIB, items)
    const next = applyResyncPlan(model, plan, { sd: 'apply', st: 'apply' }, newId)
    const domain = Object.values(next.domains)[0]!
    const term = Object.values(next.terms)[0]!
    expect(term.domainId).toBe(domain.id)
    expect(term.origin!.base).toMatchObject({ domainId: domain.id })
  })

  it('도메인을 빼고 용어만 추가하면 domainId는 null', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')])
    const next = applyResyncPlan(model, plan, { st: 'apply' }, newId)
    expect(Object.values(next.terms)[0]!.domainId).toBeNull()
    expect(Object.keys(next.domains)).toHaveLength(0)
  })

  it('커스텀 항목 추가는 같은 target 최대 order+1을 받고, 자동 갱신은 order를 보존한다', () => {
    const existing = {
      f0: {
        id: 'f0', name: '기존', target: 'column' as const, type: 'text' as const,
        options: [], required: false, defaultValue: null, order: 4, origin: null,
      },
    }
    const model: ProjectModel = { ...createEmptyModel(), customFields: existing }
    const added = applyResyncPlan(
      model, planResync(model, LIB, [customFieldItem('s1', '비고')]), { s1: 'apply' }, newId)
    const created = Object.values(added.customFields).find((f) => f.name === '비고')!
    expect(created.order).toBe(5)

    const bumped = planResync(added, LIB, [customFieldItem('s1', '비고 수정', 2)])
    const updated = applyResyncPlan(added, bumped, { s1: 'apply' }, newId)
    expect(Object.values(updated.customFields).find((f) => f.id === created.id)!.order).toBe(5)
  })

  it('결과 모델이 무결성을 통과하고 diffModels가 정상 op 배치를 낸다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')])
    const next = applyResyncPlan(model, plan, { sd: 'apply', st: 'apply' }, newId)
    expect(validateModelIntegrity(next)).toEqual([])
    const ops = diffModels(model, next)
    expect(ops.map((o) => o.entity)).toEqual(['domain', 'term'])   // 부모 우선 순서
    expect(ops.every((o) => o.action === 'create')).toBe(true)
  })

  it('입력 모델을 변경하지 않는다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    expect(Object.keys(model.words)).toHaveLength(0)
  })
})
```

- [ ] **Step 6: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts`
Expected: FAIL — `applyResyncPlan is not a function`

- [ ] **Step 7: `applyResyncPlan`을 구현한다**

`resource-sync.ts` 끝에 추가한다.

```ts
function maxCustomFieldOrder(model: ProjectModel, target: string): number {
  let max = -1
  for (const field of Object.values(model.customFields)) {
    if (field.target === target && field.order > max) max = field.order
  }
  return max
}

/**
 * 계획과 항목별 결정을 적용한 새 모델을 반환한다(입력 모델 불변).
 * 결정이 없는 항목은 'defer'로 본다. 처리할 것이 없으면 입력 모델을 그대로 돌려준다
 * (diffModels가 빈 배열을 내 뮤테이션 자체가 일어나지 않는다).
 */
export function applyResyncPlan(
  model: ProjectModel,
  plan: ResyncPlan,
  decisions: Readonly<Record<string, ResyncDecision>>,
  newId: () => string,
): ProjectModel {
  const selected = plan.entries.filter((e) => (decisions[e.sourceId] ?? 'defer') !== 'defer')
  if (selected.length === 0) return model

  // 1) 추가 항목 id를 먼저 전부 발급해 색인을 완성한다 — 같은 배치에서 추가되는
  //    도메인을 용어가 참조할 수 있어야 한다.
  const idBySource = new Map<string, string>()
  for (const kind of RESOURCE_KINDS) {
    for (const entity of entitiesOf(model, kind)) {
      if (entity.origin) idBySource.set(keyOf(kind, entity.origin.sourceId), entity.id)
    }
  }
  const allocated = new Map<string, string>()
  for (const entry of selected) {
    if (entry.status !== 'added' || decisions[entry.sourceId] !== 'apply') continue
    const id = newId()
    allocated.set(entry.sourceId, id)
    idBySource.set(keyOf(entry.kind, entry.sourceId), id)
  }

  const next: ProjectModel = {
    ...model,
    domains: { ...model.domains },
    words: { ...model.words },
    terms: { ...model.terms },
    customFields: { ...model.customFields },
  }
  const nextOrder: Record<string, number> = {
    table: maxCustomFieldOrder(model, 'table') + 1,
    column: maxCustomFieldOrder(model, 'column') + 1,
  }

  for (const entry of selected) {
    const decision = decisions[entry.sourceId]!
    const payload = projectPayload(entry.kind, entry.sourcePayload, idBySource)
    const origin: Origin = {
      libraryId: plan.libraryId,
      sourceId: entry.sourceId,
      sourceVersion: entry.version,
      base: payload,
    }
    const collection = next[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
      Record<string, Record<string, unknown>>

    if (entry.status === 'added') {
      if (decision !== 'apply') continue
      const id = allocated.get(entry.sourceId)!
      const extra = entry.kind === 'customField'
        ? { order: nextOrder[String(payload.target)]!++ }
        : {}
      collection[id] = { ...payload, ...extra, id, origin }
      continue
    }

    const id = entry.projectEntityId!
    const current = collection[id]
    if (!current) continue   // 계획 계산 후 삭제된 경우 방어
    if (decision === 'apply') {
      // customField의 order는 프로젝트 표시 관심사라 원본 반영에서도 보존한다.
      const keepOrder = entry.kind === 'customField' ? { order: current.order } : {}
      collection[id] = { ...payload, ...keepOrder, id, origin }
    } else {
      // 'keep' — 내용은 그대로, origin만 갱신해 "검토했고 거절했다"를 기록한다.
      collection[id] = { ...current, origin }
    }
  }

  return next
}
```

- [ ] **Step 8: `index.ts`에 export를 추가한다**

```ts
export { planResync, applyResyncPlan } from './resource-sync.js'
export type {
  LibraryItem, ResyncStatus, ResyncDecision, ResyncEntry, ResyncPlan,
} from './resource-sync.js'
```

- [ ] **Step 9: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run`
Expected: PASS (157 + 17 = 174건), `pnpm -r typecheck` 0 errors

- [ ] **Step 10: 커밋**

```bash
git add packages/core/src/resource-sync.ts packages/core/src/resource-sync.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): 재동기화 3-way 병합 엔진 planResync/applyResyncPlan

버전 비교로 "원본 변경"을, base와의 deepEqual로 "프로젝트 수정"을 판정해
added/auto-update/conflict로 분류한다. 원본에서 사라진 항목은 삭제 제안 없이
카운트만 낸다(프로젝트 독립성). 적용은 추가 항목 id를 먼저 전부 발급한 뒤
term.domainId를 투영해, 도메인과 용어를 같은 배치로 가져와도 참조가 이어진다.
conflict의 'keep'은 내용을 유지하고 origin만 원본 현재값으로 올려, 다음엔 안 뜨되
원본이 또 바뀌면 다시 충돌로 잡히게 한다(로컬 수정이 조용히 덮이지 않는다).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 3: server 스키마 + 마이그레이션 0007

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0007_*.sql` (drizzle-kit 생성)
- Modify: `apps/server/src/services/model-store.ts`
- Modify: `apps/server/src/testing/db.ts`
- Modify: `apps/server/src/testing/helpers.ts`
- Test: `apps/server/src/services/model-store.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Origin` 타입, `RESOURCE_KINDS`.
- Produces:
  - drizzle 테이블 `resourceLibraries`, `resourceItems`
  - `model_domains`/`model_words`/`model_terms`/`model_custom_fields`의 `origin` 컬럼
  - `loadProjectModel`이 `origin`을 채워 돌려줌

- [ ] **Step 1: 실패하는 테스트를 쓴다 — `origin` 왕복 persist**

`apps/server/src/services/model-store.test.ts`에 아래 테스트를 추가한다. **먼저 파일 상단을 읽고** 기존 setup이 쓰는 변수명(`db` 또는 다른 이름의 drizzle 인스턴스, 프로젝트 id 변수, `persistOps`/`loadProjectModel`/`uuidv7` import 여부)을 확인해 아래 코드의 이름을 그 파일에 맞춘다.

```ts
it('origin이 붙은 사전 엔티티를 단일 배치로 왕복시킨다', async () => {
  const libraryId = uuidv7()
  const domainId = uuidv7()
  const termId = uuidv7()
  const origin = (sourceId: string, base: Record<string, unknown>) =>
    ({ libraryId, sourceId, sourceVersion: 2, base })

  const domain = {
    id: domainId, name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
    origin: origin(uuidv7(), { name: '금액' }),
  }
  const term = {
    id: termId, logicalName: '주문금액', physicalName: 'ORD_AMT',
    domainId, description: null, origin: origin(uuidv7(), { logicalName: '주문금액' }),
  }

  await db.transaction(async (tx) => {
    await persistOps(tx, projectId, [
      { action: 'create', entity: 'domain', entityId: domainId, data: domain },
      { action: 'create', entity: 'term', entityId: termId, data: term },
    ])
  })

  const loaded = await loadProjectModel(db, projectId)
  expect(loaded.domains[domainId]!.origin).toEqual(domain.origin)
  expect(loaded.terms[termId]!.origin).toEqual(term.origin)
})

it('origin이 없는 행은 null로 로드된다', async () => {
  const wordId = uuidv7()
  await db.transaction(async (tx) => {
    await persistOps(tx, projectId, [{
      action: 'create', entity: 'word', entityId: wordId,
      data: { id: wordId, logicalName: '회원', abbreviation: 'MBR', description: null, origin: null },
    }])
  })
  expect((await loadProjectModel(db, projectId)).words[wordId]!.origin).toBeNull()
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/services/model-store.test.ts`
Expected: FAIL — `column "origin" of relation "model_domains" does not exist`

- [ ] **Step 3: `db/schema.ts`에 테이블과 컬럼을 추가한다**

`import` 줄의 `@erdd/core` 타입 목록에 `type Origin`을 추가하고, `snapshots` 정의 아래(파일 끝)에 다음을 넣는다.

```ts
// ─── 공용 리소스 라이브러리 (프로젝트 모델 밖 — op 로그 대상이 아니다) ───

export const resourceLibraries = pgTable('resource_libraries', {
  id: uuid('id').primaryKey(),
  scope: text('scope', { enum: ['global', 'org'] }).notNull(),
  /** scope='org'일 때만 채워진다. 정합성은 라우터가 강제한다. */
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const resourceItems = pgTable('resource_items', {
  id: uuid('id').primaryKey(),
  libraryId: uuid('library_id').notNull()
    .references(() => resourceLibraries.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['domain', 'word', 'term', 'customField'] }).notNull(),
  /** core RESOURCE_PAYLOAD_SCHEMAS[kind]를 통과한 값. term.domainId는 라이브러리 항목 id. */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`modelDomains`·`modelWords`·`modelTerms`·`modelCustomFields` 각각의 마지막 컬럼 뒤에 다음을 추가한다.

```ts
  origin: jsonb('origin').$type<Origin>(),
```

- [ ] **Step 4: 마이그레이션을 생성하고 격리 DB에만 적용한다**

```bash
pnpm --filter @erdd/server exec drizzle-kit generate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a'  pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec drizzle-kit migrate
```

생성된 SQL을 눈으로 확인한다. `CREATE TABLE resource_libraries`, `CREATE TABLE resource_items`, `ALTER TABLE ... ADD COLUMN "origin" jsonb` 4건이 있어야 하고 **기존 컬럼을 DROP하는 문장이 있으면 안 된다**. 공유 `erdd`/`erdd_test`에는 절대 적용하지 않는다.

- [ ] **Step 5: `model-store.ts`가 `origin`을 싣도록 고친다**

`domains`/`words`/`terms`/`customFields` 매핑 4곳에서 Task 1에 넣어 둔 `origin: null`을 다음으로 바꾼다.

```ts
      origin: r.origin ?? null,
```

- [ ] **Step 6: 테스트 인프라를 갱신한다**

`apps/server/src/testing/db.ts`의 `TEST_TABLES`를 다음으로 바꾼다.

```ts
export const TEST_TABLES = [
  'revisions', 'snapshots',
  'model_columns', 'model_indexes', 'model_relationships', 'model_notes',
  'model_tables', 'model_table_groups',
  'model_terms', 'model_words', 'model_domains', 'model_custom_fields',
  'resource_items', 'resource_libraries',
  'project_members', 'projects', 'members', 'organizations', 'sessions', 'users',
] as const
```

> `resource_libraries`가 **반드시** 필요하다. 전역 라이브러리는 `org_id`가 null이라 `organizations` TRUNCATE CASCADE로 지워지지 않아, 빠뜨리면 시드 라이브러리가 테스트 사이에 남아 격리가 깨진다.

`apps/server/src/testing/helpers.ts`의 `withUuidIds` docstring을 다음으로 바꾼다.

```ts
/**
 * core 픽스처의 짧은 id를 UUID로 재매핑한다(DB uuid 컬럼용). 참조 필드도 함께 치환.
 * origin은 건드리지 않는다 — origin.libraryId/sourceId는 라이브러리 id 공간이라
 * 모델 id 재매핑 대상이 아니다. origin을 쓰는 테스트는 실제 UUID를 직접 지정한다.
 */
```

- [ ] **Step 7: 테스트를 돌려 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run`
Expected: PASS (52 + 2 = 54건), `pnpm -r typecheck` 0 errors

- [ ] **Step 8: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/0007_*.sql apps/server/drizzle/meta \
        apps/server/src/services/model-store.ts apps/server/src/services/model-store.test.ts \
        apps/server/src/testing/db.ts apps/server/src/testing/helpers.ts
git commit -m "$(cat <<'EOF'
feat(server): 공용 리소스 테이블 2개와 모델 4종 origin 컬럼 (마이그 0007)

resource_libraries(scope global|org)와 resource_items(payload jsonb, version)를
추가하고, model_domains/model_words/model_terms/model_custom_fields에 origin jsonb를
붙인다. TEST_TABLES에 resource_libraries를 반드시 넣어야 한다 — 전역 라이브러리는
org_id가 null이라 organizations TRUNCATE CASCADE로 안 지워져 테스트 격리가 깨진다.
같은 김에 이월 항목이던 model_domains/words/terms/custom_fields/snapshots도 명시.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 4: server `resource` 라우터

**Files:**
- Create: `apps/server/src/services/resource-library.ts`
- Create: `apps/server/src/routers/resource.ts`
- Create: `apps/server/src/routers/resource.test.ts`
- Modify: `apps/server/src/router.ts`

**Interfaces:**
- Consumes: Task 3의 `resourceLibraries`/`resourceItems`, Task 1의 `RESOURCE_KINDS`/`RESOURCE_PAYLOAD_SCHEMAS`, 기존 `getOrgMember`/`requireProjectAccess`/`authedProcedure`.
- Produces (web가 호출할 tRPC 경로):
  - `resource.library.list({ scope: 'global' | 'org', orgId?: string })` → `{ id, scope, orgId, name, description, itemCount }[]`
  - `resource.library.listForProject({ projectId })` → 같은 형태(전역 + 프로젝트 소속 조직)
  - `resource.library.create({ scope, orgId?, name, description? })` → 라이브러리 행
  - `resource.library.update({ libraryId, name?, description? })` → `{ ok: true }`
  - `resource.library.remove({ libraryId })` → `{ ok: true }`
  - `resource.items.list({ libraryId })` → `{ id, kind, payload, version }[]`
  - `resource.items.create({ libraryId, kind, payload })` → 항목 행
  - `resource.items.update({ itemId, payload })` → `{ ok: true, version }`
  - `resource.items.remove({ itemId })` → `{ ok: true }`
- Produces (서비스): `requireLibraryRead(db, libraryId, user)`, `requireLibraryWrite(db, libraryId, user)`, `requireScopeWrite(db, scope, orgId, user)`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 권한과 버전**

`apps/server/src/routers/resource.test.ts`를 만든다. 다른 라우터 테스트(`org.test.ts`)의 setup 패턴(앱 생성·`resetDb`·`createAccount`·`loginAs`·`app.inject`)을 그대로 따른다.

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import { createAccount } from '../services/accounts.js'
import { members, organizations } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
let app: FastifyInstance

const WORD = { logicalName: '회원', abbreviation: 'MBR', description: null }

async function call(
  path: string, payload: unknown, cookie: string,
): Promise<{ status: number; body: any }> {
  const res = await app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json', cookie: `erdd_session=${cookie}` },
    payload: JSON.stringify(payload),
  })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

async function query(
  path: string, input: unknown, cookie: string,
): Promise<{ status: number; body: any }> {
  const res = await app.inject({
    method: 'GET', url: `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
    headers: { cookie: `erdd_session=${cookie}` },
  })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

beforeEach(async () => {
  await resetDb(pool)
  app ??= await createTestApp()
})
afterAll(async () => { await app?.close(); await pool.end() })

describe('resource router', () => {
  it('전역 라이브러리는 서비스 관리자만 만들 수 있다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    const adminCookie = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const userCookie = await loginAs(app, 'user@t.dev', 'pw-123456')

    const denied = await call('resource.library.create', { scope: 'global', name: '표준' }, userCookie)
    expect(denied.status).toBe(403)

    const created = await call('resource.library.create', { scope: 'global', name: '표준' }, adminCookie)
    expect(created.status).toBe(200)

    // 전역 라이브러리는 아무 인증 사용자나 읽을 수 있다
    const listed = await query('resource.library.list', { scope: 'global' }, userCookie)
    expect(listed.status).toBe(200)
    expect(listed.body.result.data).toHaveLength(1)
    expect(listed.body.result.data[0].itemCount).toBe(0)
  })

  it('조직 라이브러리는 Owner/Admin만 쓰고, 멤버는 읽기만, 외부인은 못 읽는다', async () => {
    const owner = await createAccount(app.db!, { email: 'owner@t.dev', name: 'O', password: 'pw-123456', role: 'user' })
    const memberUser = await createAccount(app.db!, { email: 'mem@t.dev', name: 'M', password: 'pw-123456', role: 'user' })
    await createAccount(app.db!, { email: 'out@t.dev', name: 'X', password: 'pw-123456', role: 'user' })
    const orgId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '팀', kind: 'team' })
    await app.db!.insert(members).values([
      { id: uuidv7(), orgId, userId: owner.id, role: 'owner' },
      { id: uuidv7(), orgId, userId: memberUser.id, role: 'member' },
    ])
    const ownerCookie = await loginAs(app, 'owner@t.dev', 'pw-123456')
    const memberCookie = await loginAs(app, 'mem@t.dev', 'pw-123456')
    const outsiderCookie = await loginAs(app, 'out@t.dev', 'pw-123456')

    expect((await call('resource.library.create', { scope: 'org', orgId, name: '조직표준' }, memberCookie)).status).toBe(403)
    const created = await call('resource.library.create', { scope: 'org', orgId, name: '조직표준' }, ownerCookie)
    expect(created.status).toBe(200)

    expect((await query('resource.library.list', { scope: 'org', orgId }, memberCookie)).status).toBe(200)
    expect((await query('resource.library.list', { scope: 'org', orgId }, outsiderCookie)).status).toBe(403)
  })

  it('payload가 스키마에 안 맞으면 400', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const cookie = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await call('resource.library.create', { scope: 'global', name: '표준' }, cookie)).body.result.data
    const bad = await call('resource.items.create',
      { libraryId: lib.id, kind: 'word', payload: { logicalName: '회원' } }, cookie)
    expect(bad.status).toBe(400)
  })

  it('항목 수정은 payload가 실제로 달라졌을 때만 version을 올린다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const cookie = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await call('resource.library.create', { scope: 'global', name: '표준' }, cookie)).body.result.data
    const item = (await call('resource.items.create',
      { libraryId: lib.id, kind: 'word', payload: WORD }, cookie)).body.result.data
    expect(item.version).toBe(1)

    const same = await call('resource.items.update', { itemId: item.id, payload: WORD }, cookie)
    expect(same.body.result.data.version).toBe(1)

    const changed = await call('resource.items.update',
      { itemId: item.id, payload: { ...WORD, abbreviation: 'MEMBER' } }, cookie)
    expect(changed.body.result.data.version).toBe(2)
  })

  it('라이브러리를 지우면 항목도 함께 사라진다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    const cookie = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const lib = (await call('resource.library.create', { scope: 'global', name: '표준' }, cookie)).body.result.data
    await call('resource.items.create', { libraryId: lib.id, kind: 'word', payload: WORD }, cookie)
    await call('resource.library.remove', { libraryId: lib.id }, cookie)
    const rows = await pool.query('SELECT count(*)::int AS n FROM resource_items')
    expect(rows.rows[0].n).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/routers/resource.test.ts`
Expected: FAIL — 404 `no such procedure`

- [ ] **Step 3: 권한 헬퍼를 만든다**

`apps/server/src/services/resource-library.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { resourceLibraries } from '../db/schema.js'
import { getOrgMember } from './perm.js'

export type LibraryRow = typeof resourceLibraries.$inferSelect
type Actor = { id: string; role: 'admin' | 'user' }

async function loadLibrary(db: Db, libraryId: string): Promise<LibraryRow> {
  const row = (
    await db.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId))
  )[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
  return row
}

/** 전역은 인증 사용자 전체, 조직은 해당 조직 멤버만 읽는다. */
export async function requireScopeRead(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') return
  if (!orgId || !(await getOrgMember(db, orgId, actor.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 접근 권한이 없습니다' })
  }
}

/** 전역은 서비스 관리자, 조직은 Org Owner/Admin만 쓴다. */
export async function requireScopeWrite(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') {
    if (actor.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '전역 리소스는 서비스 관리자만 관리할 수 있습니다' })
    }
    return
  }
  const me = orgId ? await getOrgMember(db, orgId, actor.id) : undefined
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 관리 권한이 없습니다' })
  }
}

export async function requireLibraryRead(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeRead(db, library.scope, library.orgId, actor)
  return library
}

export async function requireLibraryWrite(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeWrite(db, library.scope, library.orgId, actor)
  return library
}
```

- [ ] **Step 4: 라우터를 만든다**

`apps/server/src/routers/resource.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, isNull, or, type SQL } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { deepEqual, RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, type ResourceKind } from '@erdd/core'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { requireProjectAccess } from '../services/perm.js'
import {
  requireLibraryRead, requireLibraryWrite, requireScopeRead, requireScopeWrite,
} from '../services/resource-library.js'
import { authedProcedure, router } from '../trpc.js'

const KindEnum = z.enum(RESOURCE_KINDS)

function parsePayload(kind: ResourceKind, payload: unknown): Record<string, unknown> {
  const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(payload)
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `항목 형식 오류 — ${parsed.error.message}` })
  }
  return parsed.data as Record<string, unknown>
}

type Db = Parameters<typeof requireLibraryRead>[0]

/** 라이브러리 목록 + 항목 수. where 조건은 호출부가 만든다. */
async function listWithCounts(db: Db, where: SQL | undefined) {
  const rows = await db
    .select({
      id: resourceLibraries.id, scope: resourceLibraries.scope, orgId: resourceLibraries.orgId,
      name: resourceLibraries.name, description: resourceLibraries.description,
      updatedAt: resourceLibraries.updatedAt, itemCount: count(resourceItems.id),
    })
    .from(resourceLibraries)
    .leftJoin(resourceItems, eq(resourceItems.libraryId, resourceLibraries.id))
    .where(where)
    .groupBy(resourceLibraries.id)
    .orderBy(asc(resourceLibraries.createdAt))
  return rows
}

export const resourceRouter = router({
  library: router({
    list: authedProcedure
      .input(z.object({ scope: z.enum(['global', 'org']), orgId: z.string().uuid().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.scope === 'org' && !input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
        }
        await requireScopeRead(ctx.db, input.scope, input.orgId ?? null, ctx.user)
        const where = input.scope === 'global'
          ? eq(resourceLibraries.scope, 'global')
          : and(eq(resourceLibraries.scope, 'org'), eq(resourceLibraries.orgId, input.orgId!))
        return listWithCounts(ctx.db, where)
      }),

    listForProject: authedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const access = await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
        return listWithCounts(ctx.db, or(
          and(eq(resourceLibraries.scope, 'global'), isNull(resourceLibraries.orgId)),
          eq(resourceLibraries.orgId, access.project.orgId),
        ))
      }),

    create: authedProcedure
      .input(z.object({
        scope: z.enum(['global', 'org']),
        orgId: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).default(''),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.scope === 'org' && !input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
        }
        await requireScopeWrite(ctx.db, input.scope, input.orgId ?? null, ctx.user)
        return (await ctx.db.insert(resourceLibraries).values({
          id: uuidv7(), scope: input.scope,
          orgId: input.scope === 'org' ? input.orgId! : null,
          name: input.name, description: input.description,
        }).returning())[0]!
      }),

    update: authedProcedure
      .input(z.object({
        libraryId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        await ctx.db.update(resourceLibraries)
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            updatedAt: new Date(),
          })
          .where(eq(resourceLibraries.id, input.libraryId))
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ libraryId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        await ctx.db.delete(resourceLibraries).where(eq(resourceLibraries.id, input.libraryId))
        return { ok: true as const }
      }),
  }),

  items: router({
    list: authedProcedure
      .input(z.object({ libraryId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireLibraryRead(ctx.db, input.libraryId, ctx.user)
        return ctx.db
          .select({
            id: resourceItems.id, kind: resourceItems.kind,
            payload: resourceItems.payload, version: resourceItems.version,
          })
          .from(resourceItems)
          .where(eq(resourceItems.libraryId, input.libraryId))
          .orderBy(asc(resourceItems.createdAt))
      }),

    create: authedProcedure
      .input(z.object({
        libraryId: z.string().uuid(), kind: KindEnum, payload: z.unknown(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireLibraryWrite(ctx.db, input.libraryId, ctx.user)
        const payload = parsePayload(input.kind, input.payload)
        const row = (await ctx.db.insert(resourceItems).values({
          id: uuidv7(), libraryId: input.libraryId, kind: input.kind, payload, version: 1,
        }).returning())[0]!
        await ctx.db.update(resourceLibraries).set({ updatedAt: new Date() })
          .where(eq(resourceLibraries.id, input.libraryId))
        return row
      }),

    update: authedProcedure
      .input(z.object({ itemId: z.string().uuid(), payload: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        const item = (
          await ctx.db.select().from(resourceItems).where(eq(resourceItems.id, input.itemId))
        )[0]
        if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '항목을 찾을 수 없습니다' })
        await requireLibraryWrite(ctx.db, item.libraryId, ctx.user)
        const payload = parsePayload(item.kind, input.payload)
        // 같은 값 저장이 전 프로젝트에 재동기화 알림을 뿌리지 않도록 실제 변경일 때만 올린다.
        if (deepEqual(item.payload, payload)) return { ok: true as const, version: item.version }
        const version = item.version + 1
        await ctx.db.update(resourceItems).set({ payload, version, updatedAt: new Date() })
          .where(eq(resourceItems.id, input.itemId))
        await ctx.db.update(resourceLibraries).set({ updatedAt: new Date() })
          .where(eq(resourceLibraries.id, item.libraryId))
        return { ok: true as const, version }
      }),

    remove: authedProcedure
      .input(z.object({ itemId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const item = (
          await ctx.db.select().from(resourceItems).where(eq(resourceItems.id, input.itemId))
        )[0]
        if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '항목을 찾을 수 없습니다' })
        await requireLibraryWrite(ctx.db, item.libraryId, ctx.user)
        await ctx.db.delete(resourceItems).where(eq(resourceItems.id, input.itemId))
        return { ok: true as const }
      }),
  }),
})
```

- [ ] **Step 5: `router.ts`에 등록한다**

```ts
import { resourceRouter } from './routers/resource.js'
// appRouter 객체에 추가
  resource: resourceRouter,
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run`
Expected: PASS (54 + 5 = 59건), `pnpm -r typecheck` 0 errors

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/services/resource-library.ts apps/server/src/routers/resource.ts \
        apps/server/src/routers/resource.test.ts apps/server/src/router.ts
git commit -m "$(cat <<'EOF'
feat(server): 공용 리소스 라이브러리·항목 CRUD 라우터

전역은 서비스 관리자만 쓰고 인증 사용자 누구나 읽는다. 조직은 Owner/Admin만 쓰고
조직 멤버만 읽는다. payload는 core RESOURCE_PAYLOAD_SCHEMAS로 검증하고, 항목 수정은
payload가 실제로 달라졌을 때만 version을 올린다(같은 값 저장이 전 프로젝트에
재동기화 알림을 뿌리지 않도록). fork/재동기화 전용 엔드포인트는 두지 않는다 —
적용은 기존 model.mutate가 받는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 5: server 전역 예시 시드

**Files:**
- Modify: `apps/server/src/services/resource-library.ts`
- Create: `apps/server/src/services/resource-library.test.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: Task 3의 테이블, Task 4의 `resource-library.ts`.
- Produces: `ensureStarterGlobalLibrary(db: Db): Promise<void>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/services/resource-library.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { uuidv7 } from 'uuidv7'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { ensureStarterGlobalLibrary } from './resource-library.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })

beforeEach(async () => { await resetDb(pool) })
afterAll(async () => { await pool.end() })

describe('ensureStarterGlobalLibrary', () => {
  it('전역 라이브러리가 없으면 예시 1개를 만든다', async () => {
    await ensureStarterGlobalLibrary(db)
    const libs = await db.select().from(resourceLibraries)
    expect(libs).toHaveLength(1)
    expect(libs[0]!.scope).toBe('global')
    expect(libs[0]!.orgId).toBeNull()
    const items = await db.select().from(resourceItems)
    expect(items.length).toBeGreaterThan(0)
    for (const kind of ['domain', 'word', 'term', 'customField'] as const) {
      expect(items.some((i) => i.kind === kind)).toBe(true)
    }
  })

  it('두 번 호출해도 하나만 남는다 (멱등)', async () => {
    await ensureStarterGlobalLibrary(db)
    await ensureStarterGlobalLibrary(db)
    expect(await db.select().from(resourceLibraries)).toHaveLength(1)
  })

  it('이미 전역 라이브러리가 있으면 아무것도 만들지 않는다', async () => {
    await db.insert(resourceLibraries)
      .values({ id: uuidv7(), scope: 'global', orgId: null, name: '기존', description: '' })
    await ensureStarterGlobalLibrary(db)
    const libs = await db.select().from(resourceLibraries)
    expect(libs).toHaveLength(1)
    expect(libs[0]!.name).toBe('기존')
  })

  it('용어 항목의 domainId가 같은 라이브러리의 도메인 항목을 가리킨다', async () => {
    await ensureStarterGlobalLibrary(db)
    const lib = (await db.select().from(resourceLibraries))[0]!
    const items = await db.select().from(resourceItems).where(eq(resourceItems.libraryId, lib.id))
    const domainIds = new Set(items.filter((i) => i.kind === 'domain').map((i) => i.id))
    const linked = items.filter((i) => i.kind === 'term' && i.payload.domainId !== null)
    expect(linked.length).toBeGreaterThan(0)
    for (const term of linked) expect(domainIds.has(String(term.payload.domainId))).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run src/services/resource-library.test.ts`
Expected: FAIL — `ensureStarterGlobalLibrary is not a function`

- [ ] **Step 3: 시드를 구현한다**

`apps/server/src/services/resource-library.ts` 끝에 추가한다. `import { eq }`는 이미 있고 `resourceItems`·`uuidv7` import를 추가한다.

```ts
const STARTER_WORDS = [
  { logicalName: '회원', abbreviation: 'MBR', description: null },
  { logicalName: '주문', abbreviation: 'ORD', description: null },
  { logicalName: '번호', abbreviation: 'NO', description: null },
  { logicalName: '이름', abbreviation: 'NM', description: null },
  { logicalName: '금액', abbreviation: 'AMT', description: null },
  { logicalName: '일자', abbreviation: 'DT', description: null },
]

const STARTER_DOMAINS = [
  {
    name: '식별번호', category: '번호', logicalType: 'BIGINT',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: '순번형 식별자',
  },
  {
    name: '이름100', category: '명칭', logicalType: 'VARCHAR(100)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: '일반 명칭',
  },
  {
    name: '금액', category: '수량/금액', logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: '0', allowedValues: [], description: '통화 금액',
  },
]

const STARTER_CUSTOM_FIELDS = [
  {
    name: '개인정보여부', target: 'column' as const, type: 'select' as const,
    options: ['해당없음', '개인정보', '민감정보'], required: false, defaultValue: '해당없음',
  },
  {
    name: '비고', target: 'table' as const, type: 'text' as const,
    options: [], required: false, defaultValue: null,
  },
]

/**
 * 전역 라이브러리가 하나도 없을 때만 예시 라이브러리를 만든다(ensureBootstrapAdmin과 같은 패턴).
 * 행안부 표준 사전 실데이터는 출처·라이선스 확인이 끝난 뒤 별도로 넣는다.
 */
export async function ensureStarterGlobalLibrary(db: Db): Promise<void> {
  const existing = (
    await db.select({ id: resourceLibraries.id }).from(resourceLibraries)
      .where(eq(resourceLibraries.scope, 'global')).limit(1)
  )[0]
  if (existing) return

  const libraryId = uuidv7()
  await db.insert(resourceLibraries).values({
    id: libraryId, scope: 'global', orgId: null,
    name: '표준 사전(예시)',
    description: '가져오기·재동기화를 시험해 볼 수 있는 예시 데이터입니다. 행안부 표준 사전 실데이터는 별도 소싱 예정입니다.',
  })

  const rows: { id: string; libraryId: string; kind: 'domain' | 'word' | 'term' | 'customField'; payload: Record<string, unknown>; version: number }[] = []
  const domainIdByName = new Map<string, string>()
  for (const payload of STARTER_DOMAINS) {
    const id = uuidv7()
    domainIdByName.set(payload.name, id)
    rows.push({ id, libraryId, kind: 'domain', payload, version: 1 })
  }
  for (const payload of STARTER_WORDS) {
    rows.push({ id: uuidv7(), libraryId, kind: 'word', payload, version: 1 })
  }
  const terms = [
    { logicalName: '회원번호', physicalName: 'MBR_NO', domainId: domainIdByName.get('식별번호')!, description: null },
    { logicalName: '회원명', physicalName: 'MBR_NM', domainId: domainIdByName.get('이름100')!, description: null },
    { logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: domainIdByName.get('금액')!, description: null },
  ]
  for (const payload of terms) {
    rows.push({ id: uuidv7(), libraryId, kind: 'term', payload, version: 1 })
  }
  for (const payload of STARTER_CUSTOM_FIELDS) {
    rows.push({ id: uuidv7(), libraryId, kind: 'customField', payload, version: 1 })
  }
  await db.insert(resourceItems).values(rows)
  console.log(`예시 전역 공용 리소스 라이브러리 생성: ${libraryId}`)
}
```

- [ ] **Step 4: `main.ts`에 훅을 건다**

```ts
import { ensureStarterGlobalLibrary } from './services/resource-library.js'
// start() 안, ensureBootstrapAdmin 다음 줄
  if (app.db) await ensureStarterGlobalLibrary(app.db)
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run`
Expected: PASS (59 + 4 = 63건), `pnpm -r typecheck` 0 errors

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/services/resource-library.ts apps/server/src/services/resource-library.test.ts \
        apps/server/src/main.ts
git commit -m "$(cat <<'EOF'
feat(server): 전역 공용 리소스 예시 시드

전역 라이브러리가 0개일 때만 "표준 사전(예시)"을 만든다(도메인 3·단어 6·용어 3·
커스텀 항목 2). 용어의 domainId가 같은 배치의 도메인 항목을 가리켜 fork 시 참조
투영 경로가 실제로 검증된다. 행안부 실데이터 소싱은 이월 항목으로 남는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 6: web 항목 편집 폼

**Files:**
- Create: `apps/web/src/components/resource-item-form.tsx`
- Create: `apps/web/src/components/resource-item-form.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `ResourceKind`, `RESOURCE_KIND_LABEL`. 기존 UI 프리미티브(`Button`/`Input`/`Label`).
- Produces:
  ```tsx
  export type DomainOption = { id: string; name: string }
  export function ResourceItemForm(props: {
    kind: ResourceKind
    payload: Record<string, unknown> | null   // null이면 추가 모드
    domainOptions: DomainOption[]             // kind='term'일 때 도메인 선택지(라이브러리 항목)
    onSubmit: (payload: Record<string, unknown>) => void
    onCancel: () => void
  }): JSX.Element
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/components/resource-item-form.test.tsx`:

```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceItemForm } from './resource-item-form.js'

afterEach(cleanup)

describe('ResourceItemForm', () => {
  it('단어를 추가한다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="word" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('논리명'), '회원')
    await userEvent.type(screen.getByLabelText('물리 약어'), 'MBR')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      logicalName: '회원', abbreviation: 'MBR', description: null,
    })
  })

  it('용어의 도메인 선택은 라이브러리 항목 id를 담는다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="term" payload={null}
      domainOptions={[{ id: 'lib-d1', name: '금액' }]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('논리명'), '주문금액')
    await userEvent.type(screen.getByLabelText('물리명'), 'ORD_AMT')
    await userEvent.selectOptions(screen.getByLabelText('기본 도메인'), 'lib-d1')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: 'lib-d1', description: null,
    })
  })

  it('도메인의 방언 물리 타입은 비워 두면 null이다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="domain" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('이름'), '금액')
    await userEvent.type(screen.getByLabelText('논리 타입'), 'DECIMAL(15,2)')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    })
  })

  it('커스텀 항목 payload에는 order가 없다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('이름'), '비고')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '비고', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null,
    })
  })

  it('선택형인데 선택지가 없으면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('이름'), '개인정보여부')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
    expect(screen.getByText('선택형은 선택지를 하나 이상 입력해야 합니다')).toBeDefined()
  })

  it('이름이 비면 저장할 수 없다', () => {
    render(<ResourceItemForm kind="word" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
  })

  it('기존 payload를 폼에 채운다', () => {
    render(<ResourceItemForm kind="word"
      payload={{ logicalName: '회원', abbreviation: 'MBR', description: '가입자' }}
      domainOptions={[]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText('논리명')).toHaveProperty('value', '회원')
    expect(screen.getByLabelText('물리 약어')).toHaveProperty('value', 'MBR')
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/resource-item-form.test.tsx`
Expected: FAIL — `Failed to resolve import "./resource-item-form.js"`

- [ ] **Step 3: 폼을 구현한다**

`apps/web/src/components/resource-item-form.tsx`:

```tsx
import { useState } from 'react'
import { DIALECTS, type Dialect, type ResourceKind } from '@erdd/core'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type DomainOption = { id: string; name: string }

const TARGET_LABEL = { table: '테이블', column: '컬럼' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

function str(payload: Record<string, unknown> | null, key: string): string {
  const value = payload?.[key]
  return typeof value === 'string' ? value : ''
}
function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
function selectClass(): string {
  return 'h-9 rounded-md border bg-background px-2 text-sm'
}

/**
 * 라이브러리 항목(단어·용어·도메인·커스텀 항목)의 추가/수정 폼.
 * 제출 payload는 core RESOURCE_PAYLOAD_SCHEMAS[kind]를 통과하는 형태다(서버가 재검증).
 * 모든 입력은 컨트롤드 state로 즉시 캡처하고, 저장 시 그 state에서 뽑은 값만 넘긴다.
 */
export function ResourceItemForm({
  kind, payload, domainOptions, onSubmit, onCancel,
}: {
  kind: ResourceKind
  payload: Record<string, unknown> | null
  domainOptions: DomainOption[]
  onSubmit: (payload: Record<string, unknown>) => void
  onCancel: () => void
}) {
  // 공통
  const [name, setName] = useState(
    kind === 'domain' || kind === 'customField' ? str(payload, 'name') : str(payload, 'logicalName'),
  )
  const [description, setDescription] = useState(str(payload, 'description'))
  // word
  const [abbreviation, setAbbreviation] = useState(str(payload, 'abbreviation'))
  // term
  const [physicalName, setPhysicalName] = useState(str(payload, 'physicalName'))
  const [domainId, setDomainId] = useState(str(payload, 'domainId'))
  // domain
  const [category, setCategory] = useState(str(payload, 'category'))
  const [logicalType, setLogicalType] = useState(str(payload, 'logicalType'))
  const [dialectTypes, setDialectTypes] = useState<Record<Dialect, string>>(() => {
    const source = (payload?.dialectTypes ?? {}) as Partial<Record<Dialect, string | null>>
    return {
      postgresql: source.postgresql ?? '', mysql: source.mysql ?? '',
      oracle: source.oracle ?? '', mssql: source.mssql ?? '',
    }
  })
  const [allowedValuesText, setAllowedValuesText] = useState(
    Array.isArray(payload?.allowedValues) ? (payload.allowedValues as string[]).join(', ') : '',
  )
  const [defaultValue, setDefaultValue] = useState(str(payload, 'defaultValue'))
  // customField
  const [target, setTarget] = useState<'table' | 'column'>(
    payload?.target === 'table' ? 'table' : 'column',
  )
  const [type, setType] = useState<'text' | 'boolean' | 'select'>(
    payload?.type === 'boolean' ? 'boolean' : payload?.type === 'select' ? 'select' : 'text',
  )
  const [optionsText, setOptionsText] = useState(
    Array.isArray(payload?.options) ? (payload.options as string[]).join(', ') : '',
  )
  const [required, setRequired] = useState(payload?.required === true)

  const parsedOptions = [...new Set(
    optionsText.split(',').map((v) => v.trim()).filter((v) => v !== ''),
  )]
  const parsedAllowed = [...new Set(
    allowedValuesText.split(',').map((v) => v.trim()).filter((v) => v !== ''),
  )]
  const trimmedDefault = defaultValue.trim()
  const requiredLocked = type === 'boolean'

  const nameInvalid = name.trim() === ''
  const logicalTypeInvalid = kind === 'domain' && logicalType.trim() === ''
  const physicalNameInvalid = kind === 'term' && physicalName.trim() === ''
  const abbreviationInvalid = kind === 'word' && abbreviation.trim() === ''
  const selectOptionsEmpty = kind === 'customField' && type === 'select' && parsedOptions.length === 0
  const selectDefaultInvalid = kind === 'customField' && type === 'select'
    && trimmedDefault !== '' && !parsedOptions.includes(trimmedDefault)
  const booleanDefaultInvalid = kind === 'customField' && type === 'boolean'
    && trimmedDefault !== '' && trimmedDefault !== 'true' && trimmedDefault !== 'false'
  const saveDisabled = nameInvalid || logicalTypeInvalid || physicalNameInvalid
    || abbreviationInvalid || selectOptionsEmpty || selectDefaultInvalid || booleanDefaultInvalid

  const onSave = () => {
    if (saveDisabled) return
    const trimmedName = name.trim()
    if (kind === 'word') {
      onSubmit({
        logicalName: trimmedName, abbreviation: abbreviation.trim(),
        description: nullable(description),
      })
      return
    }
    if (kind === 'term') {
      onSubmit({
        logicalName: trimmedName, physicalName: physicalName.trim(),
        domainId: domainId === '' ? null : domainId, description: nullable(description),
      })
      return
    }
    if (kind === 'domain') {
      onSubmit({
        name: trimmedName, category: nullable(category), logicalType: logicalType.trim(),
        dialectTypes: Object.fromEntries(
          DIALECTS.map((d) => [d, nullable(dialectTypes[d])]),
        ) as Record<Dialect, string | null>,
        defaultValue: nullable(defaultValue), allowedValues: parsedAllowed,
        description: nullable(description),
      })
      return
    }
    onSubmit({
      name: trimmedName, target, type,
      options: type === 'select' ? parsedOptions : [],
      required: requiredLocked ? false : required,
      defaultValue: nullable(defaultValue),
    })
  }

  const nameLabel = kind === 'domain' || kind === 'customField' ? '이름' : '논리명'

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="ri-name">{nameLabel}</Label>
        <Input id="ri-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {kind === 'word' && (
        <div className="grid gap-1.5">
          <Label htmlFor="ri-abbr">물리 약어</Label>
          <Input id="ri-abbr" className="font-mono" value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)} />
        </div>
      )}

      {kind === 'term' && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="ri-physical">물리명</Label>
            <Input id="ri-physical" className="font-mono" value={physicalName}
              onChange={(e) => setPhysicalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ri-domain">기본 도메인</Label>
            <select id="ri-domain" className={selectClass()} value={domainId}
              onChange={(e) => setDomainId(e.target.value)}>
              <option value="">선택 안 함</option>
              {domainOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {kind === 'domain' && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="ri-category">분류 (선택)</Label>
            <Input id="ri-category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ri-logical-type">논리 타입</Label>
            <Input id="ri-logical-type" className="font-mono" value={logicalType}
              placeholder="예: VARCHAR(100)" onChange={(e) => setLogicalType(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DIALECTS.map((d) => (
              <div key={d} className="grid gap-1.5">
                <Label htmlFor={`ri-dialect-${d}`}>{DIALECT_LABEL[d]} 물리 타입 (선택)</Label>
                <Input id={`ri-dialect-${d}`} className="font-mono" value={dialectTypes[d]}
                  onChange={(e) => {
                    const value = e.target.value
                    setDialectTypes((prev) => ({ ...prev, [d]: value }))
                  }} />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ri-allowed">허용값 (쉼표로 구분, 선택)</Label>
            <Input id="ri-allowed" value={allowedValuesText}
              onChange={(e) => setAllowedValuesText(e.target.value)} />
          </div>
        </>
      )}

      {kind === 'customField' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ri-target">적용 대상</Label>
              <select id="ri-target" className={selectClass()} value={target}
                onChange={(e) => setTarget(e.target.value as 'table' | 'column')}>
                {(['table', 'column'] as const).map((t) => (
                  <option key={t} value={t}>{TARGET_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ri-type">타입</Label>
              <select id="ri-type" className={selectClass()} value={type}
                onChange={(e) => setType(e.target.value as 'text' | 'boolean' | 'select')}>
                {(['text', 'boolean', 'select'] as const).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          {type === 'select' && (
            <div className="grid gap-1.5">
              <Label htmlFor="ri-options">선택지 (쉼표로 구분)</Label>
              <Input id="ri-options" value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)} />
              {selectOptionsEmpty && (
                <p className="text-xs text-destructive">선택형은 선택지를 하나 이상 입력해야 합니다</p>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label="필수" checked={required && !requiredLocked}
              disabled={requiredLocked} onChange={(e) => setRequired(e.target.checked)} />
            필수 (미입력 시 경고)
          </label>
        </>
      )}

      {kind !== 'word' && kind !== 'term' && (
        <div className="grid gap-1.5">
          <Label htmlFor="ri-default">기본값 (선택)</Label>
          <Input id="ri-default" value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)} />
          {selectDefaultInvalid && (
            <p className="text-xs text-destructive">기본값은 선택지 중 하나여야 합니다</p>
          )}
          {booleanDefaultInvalid && (
            <p className="text-xs text-destructive">불리언 기본값은 true 또는 false여야 합니다</p>
          )}
        </div>
      )}

      {kind !== 'customField' && (
        <div className="grid gap-1.5">
          <Label htmlFor="ri-description">설명 (선택)</Label>
          <Input id="ri-description" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="button" disabled={saveDisabled} onClick={onSave}>저장</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/resource-item-form.test.tsx`
Expected: PASS 7건

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/components/resource-item-form.tsx apps/web/src/components/resource-item-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 공용 리소스 항목 편집 폼(단어·용어·도메인·커스텀 항목)

한 컴포넌트에서 종류별로 분기한다. 제출 payload는 core RESOURCE_PAYLOAD_SCHEMAS를
통과하는 형태이고, 커스텀 항목에는 order가 없다(순서는 프로젝트 관심사). 용어의
도메인 선택은 라이브러리 항목 id를 담는다 — 프로젝트 도메인 id로의 투영은 가져오기
시점에 core가 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 7: web 라이브러리 관리 화면 (전역/조직 공용)

**Files:**
- Create: `apps/web/src/components/resource-library-manager.tsx`
- Create: `apps/web/src/components/resource-library-manager.test.tsx`
- Modify: `apps/web/src/pages/admin.tsx`
- Modify: `apps/web/src/pages/org-detail.tsx`

**Interfaces:**
- Consumes: Task 4의 tRPC 경로, Task 6의 `ResourceItemForm`/`DomainOption`, Task 1의 `RESOURCE_KINDS`/`RESOURCE_KIND_LABEL`/`resourceDisplayName`.
- Produces:
  ```tsx
  export function ResourceLibraryManager(props: {
    scope: 'global' | 'org'
    orgId?: string        // scope='org'일 때 필수
    canManage: boolean
  }): JSX.Element
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/components/resource-library-manager.test.tsx`:

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

const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전(예시)', description: '예시', itemCount: 3 },
]
const ITEMS = [
  { id: 'i1', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } },
  { id: 'i2', kind: 'domain', version: 2, payload: { name: '금액' } },
]

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
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourceLibraryManager', () => {
  it('라이브러리 목록과 항목 수를 보여준다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    await waitFor(() => expect(screen.getByText('표준 사전(예시)')).toBeDefined())
    // 설명과 항목 수는 한 span에 함께 렌더되므로 부분 일치(정규식)로 찾는다.
    expect(screen.getByText(/항목 3개/)).toBeDefined()
  })

  it('라이브러리를 고르면 항목을 종류별로 보여준다', async () => {
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    })
    // 삭제 버튼의 aria-label도 라이브러리 이름을 포함하므로 목록 버튼만 잡히는 조건을 쓴다.
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await waitFor(() => expect(screen.getByText('회원')).toBeDefined())
    expect(screen.getByText('금액')).toBeDefined()
    expect(screen.getByText('도메인')).toBeDefined()
    expect(screen.getByText('단어')).toBeDefined()
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

  it('항목 삭제는 확인을 받는다', async () => {
    const remove = vi.fn(() => ({ data: { ok: true } }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
      'resource.items.remove': remove,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await screen.findByText('회원')
    await userEvent.click(screen.getByRole('button', { name: '회원 삭제' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ itemId: 'i1' }))
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/resource-library-manager.test.tsx`
Expected: FAIL — `Failed to resolve import "./resource-library-manager.js"`

- [ ] **Step 3: 관리 컴포넌트를 구현한다**

`apps/web/src/components/resource-library-manager.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  RESOURCE_KINDS, RESOURCE_KIND_LABEL, resourceDisplayName, type ResourceKind,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { ResourceItemForm, type DomainOption } from '@/components/resource-item-form'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ItemRow = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }

/**
 * 전역(/admin)·조직(/org/:orgId) 공용 리소스 라이브러리 관리 화면.
 * 데이터 모델과 로직은 두 스코프가 완전히 같고 권한 판정만 서버에서 갈린다.
 */
export function ResourceLibraryManager({
  scope, orgId, canManage,
}: { scope: 'global' | 'org'; orgId?: string; canManage: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listInput = scope === 'global' ? { scope } : { scope, orgId: orgId! }
  const libraries = useQuery(trpc.resource.library.list.queryOptions(listInput))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editing, setEditing] = useState<{ kind: ResourceKind; item: ItemRow | null } | null>(null)

  const items = useQuery({
    ...trpc.resource.items.list.queryOptions({ libraryId: selectedId ?? '' }),
    enabled: selectedId !== null,
  })

  const invalidateLibraries = () =>
    queryClient.invalidateQueries({ queryKey: trpc.resource.library.list.queryKey(listInput) })
  const invalidateItems = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.resource.items.list.queryKey({ libraryId: selectedId ?? '' }),
    })
  const onError = (err: { message: string }) => toast.error(err.message)

  const createLibrary = useMutation(trpc.resource.library.create.mutationOptions({
    onSuccess: async () => {
      toast.success('라이브러리를 만들었습니다')
      setCreateOpen(false); setNewName(''); setNewDescription('')
      await invalidateLibraries()
    },
    onError,
  }))
  const removeLibrary = useMutation(trpc.resource.library.remove.mutationOptions({
    onSuccess: async () => { setSelectedId(null); await invalidateLibraries() }, onError,
  }))
  const createItem = useMutation(trpc.resource.items.create.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidateItems(); await invalidateLibraries() },
    onError,
  }))
  const updateItem = useMutation(trpc.resource.items.update.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidateItems() }, onError,
  }))
  const removeItem = useMutation(trpc.resource.items.remove.mutationOptions({
    onSuccess: async () => { await invalidateItems(); await invalidateLibraries() }, onError,
  }))

  const rows = (items.data ?? []) as ItemRow[]
  const domainOptions: DomainOption[] = rows
    .filter((r) => r.kind === 'domain')
    .map((r) => ({ id: r.id, name: resourceDisplayName('domain', r.payload) }))

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {scope === 'global' ? '전역 공용 리소스' : '조직 공용 리소스'}
        </h2>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> 라이브러리 만들기
          </Button>
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
          <li key={lib.id} className="rounded-md border">
            <div className="flex items-center justify-between gap-2 p-3">
              <button type="button" className="grid flex-1 gap-0.5 text-left"
                onClick={() => setSelectedId(selectedId === lib.id ? null : lib.id)}>
                <span className="font-medium">{lib.name}</span>
                <span className="text-xs text-muted-foreground">
                  {lib.description || '설명 없음'} · 항목 {lib.itemCount}개
                </span>
              </button>
              {canManage && (
                <Button size="icon" variant="ghost" className="size-7 text-destructive"
                  aria-label={`${lib.name} 삭제`}
                  onClick={() => {
                    if (!window.confirm(`"${lib.name}"을(를) 삭제하면 항목 ${lib.itemCount}개도 함께 삭제됩니다. 계속할까요?`)) return
                    removeLibrary.mutate({ libraryId: lib.id })
                  }}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>

            {selectedId === lib.id && (
              <div className="grid gap-3 border-t p-3">
                {RESOURCE_KINDS.map((kind) => {
                  const kindRows = rows.filter((r) => r.kind === kind)
                  return (
                    <div key={kind} className="grid gap-1.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-muted-foreground">
                          {RESOURCE_KIND_LABEL[kind]}
                        </h3>
                        {canManage && (
                          <Button size="sm" variant="ghost"
                            onClick={() => setEditing({ kind, item: null })}>
                            <Plus className="size-3" /> 추가
                          </Button>
                        )}
                      </div>
                      {kindRows.length === 0 && (
                        <p className="text-xs text-muted-foreground">없음</p>
                      )}
                      <ul className="grid gap-1">
                        {kindRows.map((row) => {
                          const name = resourceDisplayName(kind, row.payload)
                          return (
                            <li key={row.id}
                              className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
                              <span>{name}</span>
                              <span className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">v{row.version}</span>
                                {canManage && (
                                  <>
                                    <Button size="icon" variant="ghost" className="size-6"
                                      aria-label={`${name} 편집`}
                                      onClick={() => setEditing({ kind, item: row })}>
                                      <Pencil className="size-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="size-6 text-destructive"
                                      aria-label={`${name} 삭제`}
                                      onClick={() => {
                                        if (!window.confirm(`"${name}"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.`)) return
                                        removeItem.mutate({ itemId: row.id })
                                      }}>
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
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

      {editing && selectedId && (
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
                domainOptions={domainOptions}
                onCancel={() => setEditing(null)}
                onSubmit={(payload) => {
                  if (editing.item) updateItem.mutate({ itemId: editing.item.id, payload })
                  else createItem.mutate({ libraryId: selectedId, kind: editing.kind, payload })
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/resource-library-manager.test.tsx`
Expected: PASS 5건

- [ ] **Step 5: 두 페이지에 배선한다**

`apps/web/src/pages/admin.tsx` — import를 추가하고 `AdminPage`가 반환하는 최상위 컨테이너의 **마지막 자식**으로 넣는다.

```tsx
import { ResourceLibraryManager } from '@/components/resource-library-manager'
// ...
      <ResourceLibraryManager scope="global" canManage />
```

`apps/web/src/pages/org-detail.tsx` — import를 추가하고 `MembersSection` 렌더 뒤에 넣는다.

```tsx
import { ResourceLibraryManager } from '@/components/resource-library-manager'
// ...
      {org && (
        <ResourceLibraryManager
          scope="org" orgId={orgId}
          canManage={org.role === 'owner' || org.role === 'admin'}
        />
      )}
```

- [ ] **Step 6: 전 스위트를 돌린다**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck
```
Expected: web 159 + 7 + 5 = 171건 PASS, typecheck 0 errors

> `admin.test.tsx`·기존 org 테스트가 `resource.library.list` 핸들러 부재로 실패하면, 그 테스트의 `mockTrpcFetch` 핸들러 맵에 `'resource.library.list': () => ({ data: [] })`를 추가한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/components/resource-library-manager.tsx \
        apps/web/src/components/resource-library-manager.test.tsx \
        apps/web/src/pages/admin.tsx apps/web/src/pages/org-detail.tsx
# 기존 테스트에 핸들러를 추가했다면 그 파일도 명시적으로 추가
git commit -m "$(cat <<'EOF'
feat(web): 공용 리소스 라이브러리 관리 화면(전역/조직 공용)

같은 컴포넌트를 /admin(scope=global)과 /org/:orgId(scope=org)에 붙인다. 라이브러리
CRUD와 항목 CRUD를 종류별 섹션으로 제공하고, canManage=false면 읽기 전용이다.
항목 삭제 확인 문구에 "이미 가져간 프로젝트의 사본은 그대로 남습니다"를 명시해
프로젝트 독립성 원칙을 화면에서도 드러낸다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## Task 8: web 프로젝트 "공용 리소스" 패널

**Files:**
- Create: `apps/web/src/editor/resource-decisions.ts`
- Create: `apps/web/src/editor/resource-decisions.test.ts`
- Create: `apps/web/src/editor/resource-panel.tsx`
- Create: `apps/web/src/editor/resource-panel.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: Task 2의 `planResync`/`applyResyncPlan`/`ResyncPlan`/`ResyncDecision`/`LibraryItem`, Task 4의 `resource.library.listForProject`/`resource.items.list`, 기존 `useEditorStore`/`useModelMutation`/`newId`.
- Produces:
  - `initialDecisions(plan: ResyncPlan): Record<string, ResyncDecision>`
  - `setAllForStatus(decisions, plan, status: ResyncStatus, decision: ResyncDecision): Record<string, ResyncDecision>`
  - `countActive(decisions: Record<string, ResyncDecision>): number`
  - `<ResourcePanel projectId={string} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 결정 헬퍼**

`apps/web/src/editor/resource-decisions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ResyncPlan } from '@erdd/core'
import { countActive, initialDecisions, setAllForStatus } from './resource-decisions.js'

const entry = (
  sourceId: string, status: 'added' | 'auto-update' | 'conflict', nameClash = false,
) => ({
  kind: 'word' as const, sourceId, name: sourceId, status, version: 2,
  fromVersion: status === 'added' ? null : 1,
  projectEntityId: status === 'added' ? null : `e-${sourceId}`,
  sourcePayload: {}, nextPayload: {}, changedFields: [], nameClash,
})

const PLAN: ResyncPlan = {
  libraryId: 'lib', keptLocal: 0, keptSynced: 0, keptDetached: 0,
  entries: [
    entry('a1', 'added'), entry('a2', 'added', true),
    entry('u1', 'auto-update'), entry('c1', 'conflict'),
  ],
}

describe('initialDecisions', () => {
  it('신규·자동갱신은 apply, 이름 중복 신규와 충돌은 defer', () => {
    expect(initialDecisions(PLAN)).toEqual({
      a1: 'apply', a2: 'defer', u1: 'apply', c1: 'defer',
    })
  })
})

describe('setAllForStatus', () => {
  it('해당 상태의 항목만 한 번에 바꾼다', () => {
    const next = setAllForStatus(initialDecisions(PLAN), PLAN, 'conflict', 'apply')
    expect(next.c1).toBe('apply')
    expect(next.a1).toBe('apply')
    expect(next.a2).toBe('defer')
  })

  it('신규를 모두 해제한다 (이름 중복 포함)', () => {
    const next = setAllForStatus(initialDecisions(PLAN), PLAN, 'added', 'defer')
    expect(next.a1).toBe('defer')
    expect(next.a2).toBe('defer')
    expect(next.u1).toBe('apply')
  })
})

describe('countActive', () => {
  it('defer가 아닌 결정 수를 센다', () => {
    expect(countActive({ a: 'apply', b: 'keep', c: 'defer' })).toBe(2)
    expect(countActive({})).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-decisions.test.ts`
Expected: FAIL — `Failed to resolve import "./resource-decisions.js"`

- [ ] **Step 3: 결정 헬퍼를 구현한다**

`apps/web/src/editor/resource-decisions.ts`:

```ts
import type { ResyncDecision, ResyncPlan, ResyncStatus } from '@erdd/core'

export type Decisions = Record<string, ResyncDecision>

/**
 * 기본 결정: 신규 추가·자동 갱신은 선택, 충돌은 보류.
 * 이름이 이미 있는 신규는 기본 미선택 — 중복 단어·용어가 조용히 생기지 않게 한다.
 */
export function initialDecisions(plan: ResyncPlan): Decisions {
  const out: Decisions = {}
  for (const entry of plan.entries) {
    out[entry.sourceId] = entry.status === 'conflict' || entry.nameClash ? 'defer' : 'apply'
  }
  return out
}

/** 특정 상태의 항목 전부를 한 결정으로 바꾼다(구역 일괄 버튼). */
export function setAllForStatus(
  decisions: Decisions, plan: ResyncPlan, status: ResyncStatus, decision: ResyncDecision,
): Decisions {
  const out = { ...decisions }
  for (const entry of plan.entries) {
    if (entry.status === status) out[entry.sourceId] = decision
  }
  return out
}

/** 실제로 적용될(= defer가 아닌) 항목 수. op 상한 가드와 버튼 활성 판정에 쓴다. */
export function countActive(decisions: Decisions): number {
  return Object.values(decisions).filter((d) => d !== 'defer').length
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-decisions.test.ts`
Expected: PASS 4건

- [ ] **Step 5: 실패하는 테스트를 쓴다 — 패널**

`apps/web/src/editor/resource-panel.test.tsx`:

```tsx
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel, type ProjectModel, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [{ id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 2 }]
const ITEMS = [
  { id: 's1', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } },
  { id: 's2', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', description: null } },
]

const mutate = vi.fn()
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))

function renderPanel(handlers: Parameters<typeof mockTrpcFetch>[0], model: ProjectModel) {
  mockTrpcFetch(handlers)
  useEditorStore.getState().setLoaded(model, 0, PROJECT_ID)
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

async function openLibrary() {
  await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
  await userEvent.click(await screen.findByRole('button', { name: /표준 사전/ }))
}

beforeEach(() => { mutate.mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourcePanel', () => {
  it('최초 가져오기는 전 항목이 "신규 추가"로 뜬다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    expect(await screen.findByText('신규 추가 (2)')).toBeDefined()
    expect(screen.getByText('회원')).toBeDefined()
  })

  it('적용하면 mutate를 한 번 호출한다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, createEmptyModel())
    await openLibrary()
    await screen.findByText('신규 추가 (2)')
    await userEvent.click(screen.getByRole('button', { name: '적용' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    const [producer] = mutate.mock.calls[0]!
    const next = producer(createEmptyModel()) as ProjectModel
    expect(Object.keys(next.words)).toHaveLength(2)
  })

  it('처리할 것이 없으면 적용 버튼이 비활성', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    const forked2: Word = {
      id: 'w2', logicalName: '주문', abbreviation: 'ORD', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's2', sourceVersion: 1,
        base: { logicalName: '주문', abbreviation: 'ORD', description: null },
      },
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    }, { ...createEmptyModel(), words: { w1: forked, w2: forked2 } })
    await openLibrary()
    await waitFor(() => expect(screen.getByRole('button', { name: '적용' }))
      .toHaveProperty('disabled', true))
    expect(screen.getByText(/최신 상태 2건/)).toBeDefined()
  })

  it('충돌은 3상태 라디오로 뜨고 일괄 버튼이 모두를 바꾼다', async () => {
    const forked: Word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MB', description: null,
      origin: {
        libraryId: 'l1', sourceId: 's1', sourceVersion: 1,
        base: { logicalName: '회원', abbreviation: 'MBR', description: null },
      },
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{ ...ITEMS[0]!, version: 2, payload: { logicalName: '회원', abbreviation: 'MEMBER', description: null } }],
      }),
    }, { ...createEmptyModel(), words: { w1: forked } })
    await openLibrary()
    expect(await screen.findByText('충돌 (1)')).toBeDefined()
    expect(screen.getByRole('radio', { name: '회원 보류' })).toHaveProperty('checked', true)
    await userEvent.click(screen.getByRole('button', { name: '모두 원본 반영' }))
    expect(screen.getByRole('radio', { name: '회원 원본 반영' })).toHaveProperty('checked', true)
  })

  it('이름이 겹치는 신규는 기본 미선택이고 배지가 붙는다', async () => {
    const local: Word = {
      id: 'w9', logicalName: '회원', abbreviation: 'MEM', description: null, origin: null,
    }
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [ITEMS[0]!] }),
    }, { ...createEmptyModel(), words: { w9: local } })
    await openLibrary()
    await screen.findByText('신규 추가 (1)')
    expect(screen.getByRole('checkbox', { name: /회원/ })).toHaveProperty('checked', false)
    expect(screen.getByText('이름 중복')).toBeDefined()
  })
})
```

- [ ] **Step 6: 테스트를 돌려 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/resource-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "./resource-panel.js"`

- [ ] **Step 7: 패널을 구현한다**

`apps/web/src/editor/resource-panel.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Library } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyResyncPlan, planResync, RESOURCE_KIND_LABEL,
  type LibraryItem, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { countActive, initialDecisions, setAllForStatus, type Decisions } from './resource-decisions.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

/** model.mutate의 ops 상한(500)과 같다. 초과하면 적용 전에 막는다. */
const MAX_OPS = 500

const EMPTY_PLAN: ResyncPlan = {
  libraryId: '', entries: [], keptLocal: 0, keptSynced: 0, keptDetached: 0,
}

function EntryLabel({ entry }: { entry: ResyncEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
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

/**
 * 헤더의 "공용 리소스": 전역·조직 라이브러리를 프로젝트로 가져오고 재동기화한다.
 * 최초 가져오기는 "전 항목이 신규인 재동기화"라 코드 경로가 하나다.
 * 적용은 단일 producer → diffModels → model.mutate라 Revision 1건·undo 1회로 원복된다.
 */
export function ResourcePanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC()
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [open, setOpen] = useState(false)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Decisions>({})

  const libraries = useQuery(trpc.resource.library.listForProject.queryOptions({ projectId }))
  const items = useQuery({
    ...trpc.resource.items.list.queryOptions({ libraryId: libraryId ?? '' }),
    enabled: libraryId !== null,
  })

  const plan = useMemo(() => {
    if (!libraryId || !items.data) return EMPTY_PLAN
    return planResync(model, libraryId, items.data as LibraryItem[])
  }, [model, libraryId, items.data])

  // 계획이 다시 계산되면(모델 변경·라이브러리 전환·항목 재조회) 결정을 초기값으로 되돌린다.
  useEffect(() => { setDecisions(initialDecisions(plan)) }, [plan])

  const library = libraries.data?.find((l) => l.id === libraryId)
  const byStatus = (status: ResyncEntry['status']) => plan.entries.filter((e) => e.status === status)
  const added = byStatus('added')
  const autoUpdate = byStatus('auto-update')
  const conflicts = byStatus('conflict')
  const active = countActive(decisions)

  const onApply = () => {
    if (active === 0) return
    if (active > MAX_OPS) {
      toast.error(`한 번에 ${MAX_OPS}건까지 적용할 수 있습니다. 나눠 선택해 주세요.`)
      return
    }
    const applied = decisions
    const currentPlan = plan
    void mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
      summary: `공용 리소스 재동기화 — ${library?.name ?? ''}`,
    })
  }

  const checkboxRow = (entry: ResyncEntry) => (
    <li key={entry.sourceId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      <label className="flex flex-1 items-center gap-2">
        <input type="checkbox" aria-label={`${entry.name} 선택`}
          checked={decisions[entry.sourceId] === 'apply'}
          onChange={(e) => {
            const next = e.target.checked ? 'apply' : 'defer'
            setDecisions((prev) => ({ ...prev, [entry.sourceId]: next }))
          }} />
        <EntryLabel entry={entry} />
      </label>
      {entry.nameClash && <Badge variant="outline" className="shrink-0">이름 중복</Badge>}
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Library /> 공용 리소스</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>공용 리소스</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="grid content-start gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">라이브러리</h4>
            {libraries.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">사용할 수 있는 라이브러리가 없습니다</p>
            )}
            {libraries.data?.map((lib) => (
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
            {libraryId === null && (
              <p className="text-sm text-muted-foreground">
                라이브러리를 선택하면 가져올 항목과 갱신 내역을 보여줍니다.
              </p>
            )}

            {libraryId !== null && (
              <>
                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">신규 추가 ({added.length})</h4>
                    {added.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'added', 'apply'))}>
                          모두 선택
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'added', 'defer'))}>
                          모두 해제
                        </Button>
                      </span>
                    )}
                  </div>
                  <ul className="grid gap-1">{added.map(checkboxRow)}</ul>
                </section>

                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">자동 갱신 ({autoUpdate.length})</h4>
                    {autoUpdate.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'auto-update', 'apply'))}>
                          모두 선택
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'auto-update', 'defer'))}>
                          모두 해제
                        </Button>
                      </span>
                    )}
                  </div>
                  <ul className="grid gap-1">{autoUpdate.map(checkboxRow)}</ul>
                </section>

                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">충돌 ({conflicts.length})</h4>
                    {conflicts.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'conflict', 'apply'))}>
                          모두 원본 반영
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'conflict', 'keep'))}>
                          모두 프로젝트 유지
                        </Button>
                      </span>
                    )}
                  </div>
                  {conflicts.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      "프로젝트 유지"는 내용을 그대로 두고 이 변경을 검토했다고 기록합니다(다음에 다시 뜨지 않습니다).
                      "보류"는 아무것도 기록하지 않아 다음에 다시 뜹니다.
                    </p>
                  )}
                  <ul className="grid gap-1">
                    {conflicts.map((entry) => (
                      <li key={entry.sourceId} className="grid gap-1 rounded border px-2 py-1.5">
                        <EntryLabel entry={entry} />
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
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="grid gap-1 text-xs text-muted-foreground">
                  <h4 className="text-sm font-semibold text-foreground">유지</h4>
                  <span>최신 상태 {plan.keptSynced}건 · 프로젝트 자체 항목 {plan.keptLocal}건</span>
                  {plan.keptDetached > 0 && (
                    <span>원본에서 삭제된 항목 {plan.keptDetached}건 — 프로젝트 사본은 그대로 둡니다.</span>
                  )}
                </section>

                <div className="flex items-center justify-end gap-2 border-t pt-2">
                  <span className="text-xs text-muted-foreground">처리 대상 {active}건</span>
                  <Button type="button" disabled={active === 0} onClick={onApply}>적용</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 8: 헤더에 배선한다**

`apps/web/src/pages/project.tsx`에 import를 추가하고 `CustomFieldPanel` 다음 줄에 넣는다.

```tsx
import { ResourcePanel } from '@/editor/resource-panel'
// ...
            {loaded && <ResourcePanel projectId={projectId} />}
```

- [ ] **Step 9: 테스트를 돌려 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run`
Expected: PASS (171 + 4 + 5 = 180건)

- [ ] **Step 10: 전 스위트 + typecheck**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: core 174 · web 180 · server 63 · typecheck 0 errors

- [ ] **Step 11: 커밋**

```bash
git add apps/web/src/editor/resource-decisions.ts apps/web/src/editor/resource-decisions.test.ts \
        apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-panel.test.tsx \
        apps/web/src/pages/project.tsx
git commit -m "$(cat <<'EOF'
feat(web): 프로젝트 "공용 리소스" 패널 — 가져오기·재동기화 통합 화면

라이브러리를 고르면 신규 추가/자동 갱신/충돌/유지 4구역으로 계획을 보여주고,
선택한 것만 단일 producer로 적용한다(Revision 1건·undo 1회). 충돌은 항목별
보류/프로젝트 유지/원본 반영 3상태 라디오 + 구역 일괄 버튼이다. 이름이 겹치는
신규는 기본 미선택 + "이름 중복" 배지. 처리 대상이 model.mutate의 op 상한(500)을
넘으면 적용 전에 막는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VapjFvjyNeV8UZUgtr41DP
EOF
)"
```

---

## 마무리 체크포인트 (모든 태스크 완료 후)

- [ ] 전체 스위트 그린 확인

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```

- [ ] `git status`로 의도치 않은 파일(`.idea/*`, `.env`, `apps/web/vite.config.ts`)이 남아 있지 않은지 확인. 로컬 확인용으로 `vite.config.ts`의 프록시 포트를 바꿨다면 `git checkout -- apps/web/vite.config.ts`로 원복한다.
- [ ] whole-branch 리뷰(서브에이전트, requesting-code-review의 code-reviewer 템플릿) → Critical/Important 수정 후 재리뷰
- [ ] **여기서 멈춘다.** main 병합·브라우저 스모크는 코디네이터가 한다. `worker_done`으로 보고한다.

## 범위 밖 (이 계획에서 구현하지 않는다)

- 프로젝트 → 조직 리소스 승격(반대 방향, 조직 관리자 승인)
- 행안부 표준 사전 실데이터 소싱(출처·라이선스·갱신 주기 미확인)
- 500 op를 넘는 대량 사전의 청크 적용(현재는 UI가 사전에 막는다)
- 라이브러리 항목의 변경 이력·되돌리기
- 라이브러리 Excel 업로드/내보내기
- 단어·용어 중복 경고(`warnings.ts`) — 이번에는 가져오기 시점의 `nameClash` 표시로만 다룬다
