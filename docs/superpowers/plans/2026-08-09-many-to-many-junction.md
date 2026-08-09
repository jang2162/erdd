# N:M 교차 테이블 자동 생성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관계 패널에서 버튼 하나로 1:N 관계를 교차 테이블 + 식별 관계 2개로 푼다.

**Architecture:** core에 순수 함수 2개를 넣고(`junctionTableName` · `resolveManyToMany`), 웹은 id·이름·좌표를 미리 계산한 계획(`planJunction`)을 만들어 그 함수에 넘긴다. 모델 스키마는 건드리지 않는다 — 결과물은 보통 테이블 1개와 1:N 관계 2개뿐이라 DDL·diff·병합·파일 포맷·CLI가 새로 알 것이 없다.

**Tech Stack:** TypeScript, vitest, React, zustand(에디터 store), @testing-library/react

**설계 문서:** `docs/superpowers/specs/2026-08-09-many-to-many-junction-design.md` — 결정의 근거는 전부 거기 있다. 이 계획과 어긋나면 **설계가 아니라 이 계획을 의심하고 보고하라.**

## Global Constraints

- 응답·커밋 메시지·주석·문서는 **한국어**로 쓴다.
- 커밋은 **경로를 명시**한다: `git commit -m "..." -- <경로1> <경로2>`. `git add -A`·`git add .`·`git commit -a` 금지. untracked 파일이 있으면 `git add <경로들> && git commit ...`로 **한 명령에 붙인다**(add와 commit 사이에 틈을 두지 않는다).
- `.idea/*`와 루트 `.env`는 커밋하지 않는다.
- **모델 스키마를 바꾸지 않는다.** `packages/core/src/model.ts`의 `cardinality: z.enum(['1:1', '1:N'])`은 그대로다. 이 파일을 수정해야 할 것 같으면 멈추고 보고하라.
- `packages/core`는 IO-free 순수 도메인이다. id 생성·좌표·사전 조회·시간은 core에 넣지 않고 호출측이 계산해 넘긴다.
- **시작 기준선:** core 463 · cli 138 · web 423 · server 194 · `pnpm -r typecheck` EXIT=0. server·cli는 이 계획에서 **변하지 않아야 한다** — 변했다면 범위를 넘은 것이다.
- 테스트 실행:
  - core: `pnpm --filter @erdd/core exec vitest run`
  - web: `pnpm --filter @erdd/web exec vitest run`
  - 타입: `pnpm -r typecheck`
- **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 단언을 정정한 뒤 그 내역과 근거를 보고하라.**
- **각 수정마다 구분력을 확인하라** — 프로덕션 변경을 되돌려 새 단언이 *실제로* 실패하는지 보고 복구한다(`git status`로 clean 확인). **실패하지 않으면 덮지 말고 그대로 보고하라.**

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/core/src/relationship.ts` | 관계 생성·삭제·변형 순수 함수 | `junctionTableName` · `resolveManyToMany` 추가 |
| `packages/core/src/relationship.test.ts` | 위 함수들의 테스트 | 새 describe 2개 추가 |
| `packages/core/src/index.ts` | core 공개 표면 | export 2개 추가 |
| `apps/web/src/editor/model-edits.ts` | 웹 전용 모델 편집 헬퍼 | `nextTablePhysicalName` 추출 |
| `apps/web/src/editor/edges.ts` | 캔버스 엣지 + 연결 계획 | `planJunction` · `JunctionPlan` 추가 |
| `apps/web/src/editor/edges.test.ts` | 위 테스트 | 새 describe 추가 |
| `apps/web/src/editor/relationship-panel.tsx` | 관계 편집 패널 | 버튼 + 비활성 사유 문구 |
| `apps/web/src/editor/relationship-panel.test.tsx` | 위 테스트 | 새 it 3개 추가 |

---

## Task 1: core — `junctionTableName` · `resolveManyToMany`

**Files:**
- Modify: `packages/core/src/relationship.ts` (파일 끝에 추가)
- Modify: `packages/core/src/index.ts:45-48` (export 블록)
- Test: `packages/core/src/relationship.test.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: 같은 파일의 `createRelationshipFromParentPk` · `deleteColumnCascade`, `./model.js`의 `Position` · `Table` · `ProjectModel`
- Produces:
  ```ts
  export function junctionTableName(parent: Table, child: Table): string

  export type JunctionSpec = {
    id: string
    logicalName: string
    physicalName: string
    position: Position
    groupId: string | null
    groupPosition: Position | null
  }

  export function resolveManyToMany(
    model: ProjectModel,
    args: {
      relationshipId: string
      junction: JunctionSpec
      a: { relationshipId: string; newColumnIds: string[] }
      b: { relationshipId: string; newColumnIds: string[] }
    },
  ): ProjectModel
  ```
  Task 2가 `JunctionSpec`과 `junctionTableName`을, Task 3이 `resolveManyToMany`를 쓴다.

---

- [ ] **Step 1: 테스트 헬퍼와 정상 경로 테스트를 쓴다**

`packages/core/src/relationship.test.ts` 파일 **맨 끝**에 붙인다. 파일 상단의 기존 헬퍼 `tbl`·`col`을 재사용한다(새로 만들지 마라 — 이미 있다). `tbl`은 `logicalName`을 id로 채우므로 논리명이 필요한 곳은 전개해서 덮는다.

```ts
describe('junctionTableName', () => {
  it('두 논리명을 구분자 없이 이어붙인다', () => {
    const p = { ...tbl('P', 'ORDERS'), logicalName: '주문' }
    const c = { ...tbl('C', 'PRODUCTS'), logicalName: '상품' }
    expect(junctionTableName(p, c)).toBe('주문상품')
  })
})

// 부모 주문(PK ORDER_ID) → 자식 상품(PK PRODUCT_ID), non-identifying 관계 r1.
// createRelationshipFromParentPk가 자식에 FK 컬럼 'fk1'(physicalName 'ORDER_ID')을 만든다.
function m2mBase(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { ...tbl('P', 'ORDERS'), logicalName: '주문', position: { x: 0, y: 0 } }
  m.tables['C'] = { ...tbl('C', 'PRODUCTS'), logicalName: '상품', position: { x: 100, y: 50 } }
  m.columns['P_PK'] = col('P_PK', 'P', 'ORDER_ID', { isPk: true, nullable: false, order: 0 })
  m.columns['C_PK'] = col('C_PK', 'C', 'PRODUCT_ID', { isPk: true, nullable: false, order: 0 })
  return createRelationshipFromParentPk(m, {
    relationshipId: 'r1', parentTableId: 'P', childTableId: 'C', newColumnIds: ['fk1'],
  })
}

const JUNCTION = {
  id: 'J', logicalName: '주문상품', physicalName: 'ORD_PRD',
  position: { x: 50, y: 25 }, groupId: null, groupPosition: null,
}
const ARGS = {
  relationshipId: 'r1',
  junction: JUNCTION,
  a: { relationshipId: 'ra', newColumnIds: ['ja1'] },
  b: { relationshipId: 'rb', newColumnIds: ['jb1'] },
}

describe('resolveManyToMany', () => {
  it('교차 테이블을 만들고 두 FK를 복합 PK로 둔다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)

    expect(out.tables['J']?.logicalName).toBe('주문상품')
    expect(out.tables['J']?.physicalName).toBe('ORD_PRD')

    const jCols = Object.values(out.columns).filter((c) => c.tableId === 'J')
    expect(jCols.map((c) => c.id).sort()).toEqual(['ja1', 'jb1'])
    expect(jCols.every((c) => c.isPk)).toBe(true)
    // 부모 PK의 물리명을 그대로 가져온다
    expect(jCols.map((c) => c.physicalName).sort()).toEqual(['ORDER_ID', 'PRODUCT_ID'])
  })

  it('원본 관계와 그 FK 컬럼을 없앤다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)
    expect(out.relationships['r1']).toBeUndefined()
    expect(out.columns['fk1']).toBeUndefined()
  })

  it('새 관계 둘은 각 부모에서 교차 테이블로 가는 식별 1:N 이다', () => {
    const out = resolveManyToMany(m2mBase(), ARGS)

    expect(out.relationships['ra']).toMatchObject({
      parentTableId: 'P', childTableId: 'J', cardinality: '1:N', identifying: true,
    })
    expect(out.relationships['rb']).toMatchObject({
      parentTableId: 'C', childTableId: 'J', cardinality: '1:N', identifying: true,
    })
    expect(out.relationships['ra']?.columnMappings).toEqual([{ childColumnId: 'ja1', parentColumnId: 'P_PK' }])
    expect(out.relationships['rb']?.columnMappings).toEqual([{ childColumnId: 'jb1', parentColumnId: 'C_PK' }])
  })

  it('결과 모델의 참조 무결성이 유지된다', () => {
    expect(validateModelIntegrity(resolveManyToMany(m2mBase(), ARGS))).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/relationship.test.ts`
Expected: FAIL — `junctionTableName is not defined` · `resolveManyToMany is not defined`

- [ ] **Step 3: 두 함수를 구현한다**

`packages/core/src/relationship.ts` **파일 끝**에 붙인다. 상단 import에 `Position`을 추가한다(현재 `import type { Column, ProjectModel, Relationship } from './model.js'` — `Position`과 `Table`을 더한다).

```ts
/** 교차 테이블의 기본 논리명 — 두 부모 논리명을 구분자 없이 잇는다(설계 D4). */
export function junctionTableName(parent: Table, child: Table): string {
  return `${parent.logicalName}${child.logicalName}`
}

export type JunctionSpec = {
  id: string
  logicalName: string
  physicalName: string
  position: Position
  groupId: string | null
  groupPosition: Position | null
}

/**
 * 1:N 관계를 교차 테이블 + 식별 1:N 관계 2개로 바꾼다(설계 3절).
 * id·이름·좌표는 호출측이 계산해 넘긴다 — core는 id를 만들지 않는다.
 * 아래 어느 가드에 걸려도 model을 그대로 돌려준다(부분 상태를 남기지 않는다).
 */
export function resolveManyToMany(
  model: ProjectModel,
  args: {
    relationshipId: string
    junction: JunctionSpec
    a: { relationshipId: string; newColumnIds: string[] }
    b: { relationshipId: string; newColumnIds: string[] }
  },
): ProjectModel {
  const rel = model.relationships[args.relationshipId]
  if (!rel) return model
  if (rel.identifying) return model // 자식 PK 구성이 바뀌어 하위 관계가 깨진다(설계 3.3)

  const parentTableId = rel.parentTableId
  const childTableId = rel.childTableId // 관계가 사라지기 전에 읽어 둔다
  if (!model.tables[parentTableId] || !model.tables[childTableId]) return model

  // PK 개수는 "FK를 지운 뒤"를 기준으로 센다(설계 3.4).
  const fkColumnIds = rel.columnMappings.map((m) => m.childColumnId)
  const droppedPk = fkColumnIds.filter((id) => model.columns[id]?.isPk).length
  const pkCount = (tableId: string) =>
    Object.values(model.columns).filter((c) => c.tableId === tableId && c.isPk).length
  if (pkCount(parentTableId) === 0) return model
  if (pkCount(childTableId) - droppedPk === 0) return model

  // FK 컬럼을 지우면 매핑이 비면서 원본 관계도 함께 사라진다(설계 3.2).
  // deleteRelationship은 자식 FK 컬럼을 일부러 보존하므로 쓰지 않는다.
  let next = model
  for (const id of fkColumnIds) next = deleteColumnCascade(next, id)

  const junction: Table = {
    id: args.junction.id,
    logicalName: args.junction.logicalName,
    physicalName: args.junction.physicalName,
    comment: null,
    groupId: args.junction.groupId,
    position: args.junction.position,
    groupPosition: args.junction.groupPosition,
    custom: {},
  }
  next = { ...next, tables: { ...next.tables, [junction.id]: junction } }

  next = createRelationshipFromParentPk(next, {
    relationshipId: args.a.relationshipId,
    parentTableId, childTableId: junction.id,
    newColumnIds: args.a.newColumnIds,
    cardinality: '1:N', identifying: true,
  })
  return createRelationshipFromParentPk(next, {
    relationshipId: args.b.relationshipId,
    parentTableId: childTableId, childTableId: junction.id,
    newColumnIds: args.b.newColumnIds,
    cardinality: '1:N', identifying: true,
  })
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/relationship.test.ts`
Expected: PASS (새 테스트 5건 포함)

- [ ] **Step 5: 가드(no-op) 테스트를 쓴다**

같은 describe 안에 이어 붙인다. **반환 모델을 입력과 깊게 비교한다** — 반환값 일부만 보면 "테이블은 만들고 관계는 안 만든" 부분 상태를 놓친다.

```ts
  it('존재하지 않는 관계면 아무것도 하지 않는다', () => {
    const m = m2mBase()
    expect(resolveManyToMany(m, { ...ARGS, relationshipId: 'nope' })).toEqual(m)
  })

  it('식별 관계면 아무것도 하지 않는다', () => {
    const m = setRelationshipIdentifying(m2mBase(), 'r1', true)
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('부모에 PK가 없으면 아무것도 하지 않는다', () => {
    const base = m2mBase()
    // 부모 P의 PK를 비-PK로 바꾼다(컬럼을 지우면 관계까지 사라져 다른 가드에 걸린다)
    const m = {
      ...base,
      columns: { ...base.columns, P_PK: { ...base.columns['P_PK']!, isPk: false } },
    }
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })

  it('FK 컬럼이 자식의 유일한 PK면 아무것도 하지 않는다', () => {
    // identifying:false 인데 FK 의 isPk 가 true 인 불일치 상태 — 모델이 둘을 묶지 않는다.
    // 삭제 '전' 개수로 세면 통과해 버리고, FK 를 지운 뒤 두 번째 관계 생성이 조용히
    // no-op 이 되어 교차 테이블과 관계 하나만 남는다(설계 3.4).
    const base = m2mBase()
    const { C_PK, ...rest } = base.columns
    const m = { ...base, columns: { ...rest, fk1: { ...base.columns['fk1']!, isPk: true } } }
    expect(resolveManyToMany(m, ARGS)).toEqual(m)
  })
```

- [ ] **Step 6: 가드 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/relationship.test.ts`
Expected: PASS

⚠️ **`FK 컬럼이 자식의 유일한 PK면` 테스트가 Step 3 구현에서 바로 통과하는지 확인하라.** 통과해야 정상이다(Step 3에 그 가드가 들어 있다). 만약 실패한다면 `pkCount(childTableId) - droppedPk` 계산이 틀린 것이니 **구현을 고치고 보고하라.**

- [ ] **Step 7: 인덱스 정리와 자기참조 테스트를 쓴다**

```ts
  it('원본 FK 컬럼을 쓰던 인덱스를 정리한다', () => {
    const base = m2mBase()
    const m = {
      ...base,
      indexes: {
        ix_only: { id: 'ix_only', tableId: 'C', name: 'IX_ONLY', unique: false,
          columns: [{ columnId: 'fk1', direction: 'asc' as const }] },
        ix_mixed: { id: 'ix_mixed', tableId: 'C', name: 'IX_MIXED', unique: false,
          columns: [{ columnId: 'fk1', direction: 'asc' as const },
                    { columnId: 'C_PK', direction: 'asc' as const }] },
      },
    }
    const out = resolveManyToMany(m, ARGS)
    expect(out.indexes['ix_only']).toBeUndefined() // 컬럼이 0개가 되면 인덱스도 사라진다
    expect(out.indexes['ix_mixed']?.columns).toEqual([{ columnId: 'C_PK', direction: 'asc' }])
  })

  it('자기참조 관계에서도 FK 물리명이 충돌하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['S'] = { ...tbl('S', 'EMP'), logicalName: '사원' }
    m.columns['S_PK'] = col('S_PK', 'S', 'EMP_NO', { isPk: true, nullable: false, order: 0 })
    const withRel = createRelationshipFromParentPk(m, {
      relationshipId: 'r1', parentTableId: 'S', childTableId: 'S', newColumnIds: ['fk1'],
    })
    const out = resolveManyToMany(withRel, ARGS)
    const jCols = Object.values(out.columns).filter((c) => c.tableId === 'J').sort((a, b) => a.order - b.order)
    expect(jCols.map((c) => c.physicalName)).toEqual(['EMP_NO', 'EMP_NO_2'])
  })
```

- [ ] **Step 8: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/relationship.test.ts`
Expected: PASS

- [ ] **Step 9: core 공개 표면에 export 한다**

`packages/core/src/index.ts:45-48`의 블록을 이렇게 바꾼다.

```ts
export {
  createRelationshipFromParentPk, remapRelationshipChildColumn, setRelationshipIdentifying,
  deleteRelationship, deleteTableCascade, deleteColumnCascade,
  junctionTableName, resolveManyToMany,
} from './relationship.js'
export type { JunctionSpec } from './relationship.js'
```

- [ ] **Step 10: 전체 스위트와 타입을 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -r typecheck`
Expected: core PASS (463 + 새 테스트 11건 = **474**), typecheck EXIT=0

기대 수가 다르면 **실제 수로 정정하고 보고하라**(테스트를 지우거나 더하지 마라).

- [ ] **Step 11: 구분력을 확인한다**

각각 되돌려 **지목된 테스트가 실제로 실패하는지** 보고 복구한다. 실패하지 않으면 그 사실을 보고하라.

| 되돌릴 것 | 실패해야 하는 테스트 |
|---|---|
| `deleteColumnCascade` → `deleteRelationship`로 바꾼다 | `원본 관계와 그 FK 컬럼을 없앤다` (FK 컬럼이 남는다) |
| 두 `createRelationshipFromParentPk`의 `identifying: true` → `false` | `교차 테이블을 만들고 두 FK를 복합 PK로 둔다` |
| `if (rel.identifying) return model` 을 지운다 | `식별 관계면 아무것도 하지 않는다` |
| `- droppedPk` 를 지운다 | `FK 컬럼이 자식의 유일한 PK면 아무것도 하지 않는다` |

복구 후 `git status`가 clean인지 확인한다.

- [ ] **Step 12: 커밋한다**

```bash
git commit -m "feat(core): 1:N 관계를 교차 테이블로 푸는 순수 함수

resolveManyToMany 는 원본 FK 컬럼을 deleteColumnCascade 로 지워 원본 관계까지
함께 정리한 뒤, 교차 테이블과 식별 1:N 관계 2개를 만든다. deleteRelationship 을
쓰지 않는 이유는 그 함수가 자식 FK 컬럼을 일부러 보존해 고아를 남기기 때문이다.

PK 개수는 'FK 를 지운 뒤'를 기준으로 센다 — identifying:false 인데 FK 의 isPk 가
true 인 불일치 상태에서, 삭제 전 개수로 세면 통과시켜 놓고 두 번째 관계 생성이
조용히 no-op 이 되어 부분 상태가 남는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC" -- packages/core/src/relationship.ts packages/core/src/relationship.test.ts packages/core/src/index.ts
```

---

## Task 2: 웹 — `planJunction`

**Files:**
- Modify: `apps/web/src/editor/model-edits.ts:4-15` (`addTable`에서 물리명 생성을 추출)
- Modify: `apps/web/src/editor/edges.ts` (파일 끝에 추가)
- Test: `apps/web/src/editor/edges.test.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1의 `junctionTableName` · `JunctionSpec`, core의 `generatePhysicalName` · `NamingRules`
- Produces:
  ```ts
  export function nextTablePhysicalName(model: ProjectModel): string   // model-edits.ts

  export type JunctionPlan =
    | { ok: false; reason: 'missing' | 'identifying' | 'no-pk' }
    | { ok: true; junction: JunctionSpec
        a: { relationshipId: string; newColumnIds: string[] }
        b: { relationshipId: string; newColumnIds: string[] } }

  export function planJunction(
    model: ProjectModel, relationshipId: string, genId: () => string,
    ctx: { namingRules: NamingRules; activeGroupView: string | null },
  ): JunctionPlan
  ```
  Task 3이 `planJunction`과 `JunctionPlan`을 쓴다.

---

- [ ] **Step 1: `nextTablePhysicalName` 추출 테스트를 쓴다**

`apps/web/src/editor/edges.test.ts` 파일 끝에 붙인다.

⚠️ **이 파일은 `buildSampleModel`을 import하지 않는다** — 자체 `model()` 헬퍼로 최소 모델을 만들어 쓴다. 아래 테스트는 픽스처가 필요하므로 상단 import를 더한다(경로는 `relationship-panel.test.tsx:10`과 같다).

```ts
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import type { NamingRules } from '@erdd/core'
import { planJunction } from './edges.js'                     // 기존 './edges.js' 줄에 합친다
import { nextTablePhysicalName } from './model-edits.js'      // edges.ts 가 re-export 하지 않는다
```

```ts
describe('nextTablePhysicalName', () => {
  it('사용 중이지 않은 가장 작은 TABLE_n 을 준다', () => {
    const m = buildSampleModel()
    expect(nextTablePhysicalName(m)).toBe('TABLE_1')
  })

  it('이미 쓰이는 번호를 건너뛴다', () => {
    const base = buildSampleModel()
    const m = { ...base, tables: {
      ...base.tables,
      x1: { ...base.tables['t1']!, id: 'x1', physicalName: 'TABLE_1' },
      x2: { ...base.tables['t1']!, id: 'x2', physicalName: 'TABLE_2' },
    } }
    expect(nextTablePhysicalName(m)).toBe('TABLE_3')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/edges.test.ts`
Expected: FAIL — `nextTablePhysicalName is not defined`

- [ ] **Step 3: `addTable`에서 추출한다**

`apps/web/src/editor/model-edits.ts`의 `addTable`을 이렇게 바꾼다. **동작은 그대로다** — 같은 로직을 함수로 뽑아 `planJunction`이 재사용하게 하는 것뿐이다.

```ts
/** 사용 중이지 않은 가장 작은 TABLE_n. 논리명이 정해지기 전의 임시 물리명이다. */
export function nextTablePhysicalName(model: ProjectModel): string {
  const used = new Set(Object.values(model.tables).map((t) => t.physicalName))
  let n = 1
  while (used.has(`TABLE_${n}`)) n++
  return `TABLE_${n}`
}

/** 새 테이블(컬럼 없음). 물리명은 임시 기본값 — 편집 패널에서 바꾼다. */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const physicalName = nextTablePhysicalName(model)
  const n = physicalName.slice('TABLE_'.length)
  const table: Table = {
    id, logicalName: `테이블${n}`, physicalName,
    comment: null, groupId: null, position, groupPosition: null, custom: {},
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}
```

⚠️ 기존 코드는 `테이블${n}`의 `n`과 `TABLE_${n}`의 `n`이 같은 숫자였다. 위 형태가 그 성질을 유지하는지 확인하라 — `addTable` 관련 기존 테스트가 깨지면 **그 테스트가 옳고 이 리팩터가 틀린 것이다.**

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/edges.test.ts src/editor/toolbar.test.tsx`
Expected: PASS (`toolbar.test.tsx`가 없으면 그 인자를 빼고 돌린다)

- [ ] **Step 5: `planJunction` 테스트를 쓴다**

`edges.test.ts` 파일 끝에 붙인다.

`buildSampleModel()`의 실제 값을 그대로 쓴다 — **확인된 사실이다**: `t1`(회원등급, MBR_GRD, position `{x:0,y:0}`, PK `c1`) → `t2`(회원, MBR, position `{x:300,y:0}`, PK `c2`)로 가는 `r1`은 `identifying: false`이고 FK 컬럼은 `c4`(`isPk: false`)다. **`words`와 `terms`가 비어 있어서** 물리명 생성은 빈 문자열이 되고 `TABLE_1`로 떨어진다.

```ts
const RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }
const CTX = { namingRules: RULES, activeGroupView: null }

describe('planJunction', () => {
  function ids() {
    let n = 0
    return () => `gen${++n}`
  }

  it('사전이 비어 있으면 물리명이 TABLE_n 으로 떨어진다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.junction.logicalName).toBe('회원등급회원')
    expect(plan.junction.physicalName).toBe('TABLE_1')
  })

  it('용어 사전에 완전일치가 있으면 그 물리명을 쓴다', () => {
    const base = buildSampleModel()
    const m = { ...base, terms: {
      tm1: { id: 'tm1', logicalName: '회원등급회원', physicalName: 'MBR_GRD_MBR',
             domainId: null, description: null, origin: null },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    expect(plan.ok && plan.junction.physicalName).toBe('MBR_GRD_MBR')
  })

  it('단어 사전이 일부만 알면 아는 부분으로 물리명을 만든다', () => {
    const base = buildSampleModel()
    const m = { ...base, words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR',
            englishName: null, description: null, origin: null },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    // '회원등급회원' 을 최장일치로 분해하면 회원(MBR) · 등급(모름) · 회원(MBR) 이라
    // 아는 것만 이어 붙는다. '등급' 은 기존 미등록 단어 경고가 따로 알린다.
    expect(plan.ok && plan.junction.physicalName).toBe('MBR_MBR')
  })

  it('두 부모의 중점에 놓는다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    // t1 (0,0) 과 t2 (300,0) 의 중점
    expect(plan.ok && plan.junction.position).toEqual({ x: 150, y: 0 })
  })

  it('부모 PK 개수만큼 FK 컬럼 id 를 발급한다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.a.newColumnIds).toHaveLength(1) // t1 의 PK 는 c1 하나
    expect(plan.b.newColumnIds).toHaveLength(1) // t2 의 PK 는 c2 하나
    const all = [plan.junction.id, plan.a.relationshipId, plan.b.relationshipId,
                 ...plan.a.newColumnIds, ...plan.b.newColumnIds]
    expect(new Set(all).size).toBe(all.length) // 모두 서로 다르다
  })

  it('활성 그룹뷰가 있으면 교차 테이블을 그 그룹에 넣는다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(),
      { namingRules: RULES, activeGroupView: 'g1' })
    expect(plan.ok && plan.junction.groupId).toBe('g1')
    // t1 groupPosition (10,10), t2 (310,10) 의 중점
    expect(plan.ok && plan.junction.groupPosition).toEqual({ x: 160, y: 10 })
  })

  it('없는 관계는 missing 이다', () => {
    expect(planJunction(buildSampleModel(), 'nope', ids(), CTX))
      .toEqual({ ok: false, reason: 'missing' })
  })

  it('식별 관계는 identifying 이다', () => {
    const base = buildSampleModel()
    const m = { ...base, relationships: {
      ...base.relationships, r1: { ...base.relationships['r1']!, identifying: true },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'identifying' })
  })

  it('FK 가 자식의 유일한 PK면 no-pk 다', () => {
    const base = buildSampleModel()
    // t2 의 PK c2 를 비-PK 로, FK c4 를 PK 로 → 지우면 t2 의 PK 가 0개가 된다
    const m = { ...base, columns: {
      ...base.columns,
      c2: { ...base.columns['c2']!, isPk: false },
      c4: { ...base.columns['c4']!, isPk: true },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'no-pk' })
  })
})
```

`Term`·`Word`의 필드는 `packages/core/src/model.ts:107-125`에서 확인한 실제 값이다 — `Term`은 `{ id, logicalName, physicalName, domainId, description, origin }`, `Word`는 `{ id, logicalName, abbreviation, englishName, description, origin }`. 둘 다 `z.strictObject`라 없는 필드를 넣으면 안 된다.

- [ ] **Step 6: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/edges.test.ts`
Expected: FAIL — `planJunction is not defined`

- [ ] **Step 7: `planJunction` 을 구현한다**

`apps/web/src/editor/edges.ts` 파일 끝에 붙인다. 상단 import를 더한다.

```ts
import { generatePhysicalName, junctionTableName } from '@erdd/core'
import type { JunctionSpec, NamingRules, Position } from '@erdd/core'
import { nextTablePhysicalName } from './model-edits.js'
```

```ts
export type JunctionPlan =
  | { ok: false; reason: 'missing' | 'identifying' | 'no-pk' }
  | {
      ok: true
      junction: JunctionSpec
      a: { relationshipId: string; newColumnIds: string[] }
      b: { relationshipId: string; newColumnIds: string[] }
    }

const mid = (a: number, b: number) => Math.round((a + b) / 2)
const midPoint = (a: Position, b: Position): Position => ({ x: mid(a.x, b.x), y: mid(a.y, b.y) })

/**
 * 1:N 관계를 교차 테이블로 푸는 계획을 만든다. 순수 함수(genId 주입).
 * 가드는 core 의 resolveManyToMany 와 같은 규칙이다 — 버튼을 미리 잠그기 위해 여기서도 본다.
 */
export function planJunction(
  model: ProjectModel,
  relationshipId: string,
  genId: () => string,
  ctx: { namingRules: NamingRules; activeGroupView: string | null },
): JunctionPlan {
  const rel = model.relationships[relationshipId]
  if (!rel) return { ok: false, reason: 'missing' }
  const parent = model.tables[rel.parentTableId]
  const child = model.tables[rel.childTableId]
  if (!parent || !child) return { ok: false, reason: 'missing' }
  if (rel.identifying) return { ok: false, reason: 'identifying' }

  // PK 개수는 "FK 를 지운 뒤" 기준이다(설계 3.4).
  const droppedPk = rel.columnMappings
    .filter((m) => model.columns[m.childColumnId]?.isPk).length
  const pks = (tableId: string) =>
    Object.values(model.columns).filter((c) => c.tableId === tableId && c.isPk)
  const parentPkCount = pks(parent.id).length
  const childPkCount = pks(child.id).length - droppedPk
  if (parentPkCount === 0 || childPkCount === 0) return { ok: false, reason: 'no-pk' }

  const logicalName = junctionTableName(parent, child)
  const gen = generatePhysicalName(logicalName, model.words, model.terms, ctx.namingRules)
  // 빈 물리명은 DDL 생성을 깨뜨리므로 임시 이름으로 채운다(설계 5.2).
  const physicalName = gen.physicalName || nextTablePhysicalName(model)

  const groupId = ctx.activeGroupView
  return {
    ok: true,
    junction: {
      id: genId(),
      logicalName,
      physicalName,
      position: midPoint(parent.position, child.position),
      groupId,
      groupPosition: groupId
        ? midPoint(parent.groupPosition ?? parent.position, child.groupPosition ?? child.position)
        : null,
    },
    a: {
      relationshipId: genId(),
      newColumnIds: Array.from({ length: parentPkCount }, () => genId()),
    },
    b: {
      relationshipId: genId(),
      newColumnIds: Array.from({ length: childPkCount }, () => genId()),
    },
  }
}
```

⚠️ **`b.newColumnIds`의 개수에 주의하라.** 자식이 교차 테이블의 부모가 될 때 넘겨줄 PK 개수는 **FK를 지운 뒤 남는 PK 수**(`childPkCount`)다. 지우기 전 개수를 쓰면 실제보다 많은 id를 발급하는데, `createRelationshipFromParentPk`는 남는 id를 조용히 버리므로 **테스트로는 드러나지 않는다.**

- [ ] **Step 8: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/edges.test.ts`
Expected: PASS

- [ ] **Step 9: 구분력을 확인한다**

| 되돌릴 것 | 실패해야 하는 테스트 |
|---|---|
| `gen.physicalName \|\| nextTablePhysicalName(model)` → `gen.physicalName` | `사전이 비어 있으면 물리명이 TABLE_n 으로 떨어진다` |
| `- droppedPk` 를 지운다 | `FK 가 자식의 유일한 PK면 no-pk 다` |
| `groupPosition` 을 항상 `null` 로 | `활성 그룹뷰가 있으면 교차 테이블을 그 그룹에 넣는다` |

복구 후 `git status`가 clean인지 확인한다.

- [ ] **Step 10: 커밋한다**

```bash
git commit -m "feat(web): 교차 테이블 생성 계획을 만드는 planJunction

id·논리명·물리명·좌표를 미리 계산해 core 의 resolveManyToMany 에 넘긴다.
물리명은 기존 명명 체계가 만들고, 사전에 없어 빈 문자열이면 addTable 과 같은
TABLE_n 으로 채운다 — 빈 물리명은 DDL 생성을 깨뜨린다.

가드는 core 와 같은 규칙을 쓴다(버튼을 미리 잠그기 위해). PK 개수를 FK 삭제 뒤
기준으로 세는 것도 같다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC" -- apps/web/src/editor/edges.ts apps/web/src/editor/edges.test.ts apps/web/src/editor/model-edits.ts
```

---

## Task 3: 웹 — 관계 패널 버튼

**Files:**
- Modify: `apps/web/src/editor/relationship-panel.tsx` (컬럼 매핑 섹션 뒤)
- Test: `apps/web/src/editor/relationship-panel.test.tsx` (기존 describe 안에 추가)

**Interfaces:**
- Consumes: Task 1의 `resolveManyToMany`, Task 2의 `planJunction` · `JunctionPlan`
- Produces: 없음(최종 태스크)

---

- [ ] **Step 1: 패널 테스트를 쓴다**

`relationship-panel.test.tsx`의 기존 `describe('RelationshipPanel', ...)` 안에 붙인다. 파일 상단 관례(`renderPanel` · `mockTrpcFetch` · `grantEditPermission`)를 그대로 쓴다.

```ts
  it('교차 테이블로 풀면 원본 관계가 사라지고 교차 테이블이 생긴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '교차 테이블로 풀기' }))

    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    const m = useEditorStore.getState().model
    // 원본 FK 컬럼이 사라진다
    expect(m.columns['c4']).toBeUndefined()
    // 교차 테이블 1개 + 새 관계 2개
    const junction = Object.values(m.tables).find((t) => t.logicalName === '회원등급회원')
    expect(junction).toBeDefined()
    const jRels = Object.values(m.relationships).filter((r) => r.childTableId === junction!.id)
    expect(jRels).toHaveLength(2)
    expect(jRels.every((r) => r.identifying)).toBe(true)
    // 교차 테이블이 선택된다
    expect(useEditorStore.getState().selectedTableId).toBe(junction!.id)
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })

  it('식별 관계면 버튼이 잠기고 이유가 보인다', () => {
    const base = buildSampleModel()
    const m = { ...base, relationships: {
      ...base.relationships, r1: { ...base.relationships['r1']!, identifying: true },
    } }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectRelationship('r1')
    renderPanel()

    expect(screen.getByRole('button', { name: '교차 테이블로 풀기' })).toBeDisabled()
    expect(screen.getByText(/식별 관계는 풀 수 없습니다/)).toBeInTheDocument()
  })

  it('편집 권한이 없으면 교차 테이블 버튼이 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectRelationship('r1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '교차 테이블로 풀기' })).toBeNull()
  })
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/relationship-panel.test.tsx`
Expected: FAIL — `교차 테이블로 풀기` 버튼을 찾지 못한다

- [ ] **Step 3: 버튼을 붙인다**

`relationship-panel.tsx`를 고친다. import를 더한다.

```ts
import { computeWarnings, setRelationshipIdentifying, deleteRelationship,
  remapRelationshipChildColumn, resolveManyToMany } from '@erdd/core'
import { planJunction } from './edges.js'
import { newId } from './uid.js'
```

컴포넌트 안, `childColumns` 선언 뒤에 계획을 계산한다.

```ts
  const namingRules = useEditorStore((s) => s.namingRules)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const junctionPlan = planJunction(model, relId, newId, { namingRules, activeGroupView })
```

⚠️ **hook 은 조건문(`if (!rel) return null`)보다 위에서 부른다.** 그 아래에 두면 관계가 사라질 때 hook 개수가 달라져 React가 터진다. `planJunction` 호출 자체는 hook이 아니므로 아래에 둬도 되지만, `useEditorStore` 세 줄은 반드시 위다.

컬럼 매핑 `</div>` 뒤, 바깥 `</div>` 앞에 붙인다.

```tsx
        {canEdit && (
          <div className="grid gap-1.5 border-t pt-3">
            <Button size="sm" variant="outline" disabled={!junctionPlan.ok}
              onClick={() => {
                if (!junctionPlan.ok) return
                const { junction, a, b } = junctionPlan
                selectRelationship(null)
                select(junction.id)
                void mutate(
                  (m) => resolveManyToMany(m, { relationshipId: relId, junction, a, b }),
                  { summary: '교차 테이블로 풀기' },
                )
              }}>
              교차 테이블로 풀기
            </Button>
            {!junctionPlan.ok && junctionPlan.reason === 'identifying' && (
              <p className="text-xs text-muted-foreground">
                식별 관계는 풀 수 없습니다 — 위 "식별 관계" 체크를 먼저 해제하세요
              </p>
            )}
            {!junctionPlan.ok && junctionPlan.reason === 'no-pk' && (
              <p className="text-xs text-muted-foreground">
                양쪽 테이블에 모두 기본 키가 있어야 합니다
              </p>
            )}
          </div>
        )}
```

⚠️ **`selectRelationship(null)`과 `select(...)`를 `mutate` 앞에 둔다.** 이 mutation으로 원본 관계가 사라지므로, 선택이 남아 있으면 패널이 없는 관계를 그리려다 통째로 사라진다. `store.ts:102-103`을 보면 `select`와 `selectRelationship`은 둘 다 `CLEARED_SELECTION`을 펼치므로 **뒤에 부른 것만 남는다** — `select`가 나중이어야 교차 테이블이 선택된다.

> **정정 (최종 리뷰 수정, 2026-08-09).** 위 ⚠️ 의 **`mutate` 앞에 둔다는 근거는 틀렸다.**
> `serializeMutation`이 producer를 `.then`으로 미루므로, 같은 동기 블록 안에서는 선택 호출이
> `mutate` 앞이든 뒤든 결과가 동일하다 — Task 3 구현자와 최종 리뷰어가 **각각 독립적으로 실측
> 확인**했다. 실제로 잠겨 있던 것은 **두 선택 호출의 상대 순서**뿐이다(순서를 바꾸면 테스트 1건이
> 실패한다).
>
> 그마저도 지금은 남아 있지 않다. `selectRelationship(null)`은 뒤따르는 `select(...)`가
> `CLEARED_SELECTION`을 다시 펼쳐 효과를 **전부 덮으므로 죽은 코드**였고(그 줄만 지워도 web
> 스위트가 전부 통과한다), 최종 리뷰 수정에서 삭제했다. 위 코드 블록은 삭제 이전 상태다 —
> 현재 구현과 그 근거는 **설계 5.3**을 보라. 이 mutation으로 원본 관계가 사라진다는 사실 자체는
> 그대로이며, 그 결과(선택이 남으면 패널이 통째로 사라진다)는 이제 패널 테스트가 DOM으로 잠근다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/relationship-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: 전체 스위트와 타입을 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run && pnpm -r typecheck`
Expected: web PASS (423 + Task 2의 11건 + Task 3의 3건 = **437**), typecheck EXIT=0

기대 수가 다르면 **실제 수로 정정하고 보고하라.**

- [ ] **Step 6: 구분력을 확인한다**

| 되돌릴 것 | 실패해야 하는 테스트 |
|---|---|
| `disabled={!junctionPlan.ok}` → `disabled={false}` | `식별 관계면 버튼이 잠기고 이유가 보인다` |
| `select(junction.id)` 를 지운다 | `교차 테이블로 풀면 …` (선택 단언) |
| `{canEdit && (...)}` 를 지운다 | `편집 권한이 없으면 교차 테이블 버튼이 없다` |

복구 후 `git status`가 clean인지 확인한다.

- [ ] **Step 7: 커밋한다**

```bash
git commit -m "feat(web): 관계 패널에 교차 테이블로 풀기 버튼

캔버스에서 관계를 그으면 그 관계가 자동으로 선택되므로, 패널의 버튼 한 번이면
다대다가 만들어진다. 식별 관계와 PK 없는 경우는 버튼을 잠그고 이유를 보여준다.

mutate 앞에서 선택을 교차 테이블로 옮긴다 — 원본 관계가 이 mutation 으로
사라지므로 선택이 남아 있으면 패널이 통째로 사라진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC" -- apps/web/src/editor/relationship-panel.tsx apps/web/src/editor/relationship-panel.test.tsx
```

---

## 완료 조건

- core 474 · cli 138 · web 437 · server 194 · `pnpm -r typecheck` EXIT=0 (수가 다르면 실측으로 정정하고 보고)
- `packages/core/src/model.ts` **무변경** — 스키마를 건드렸다면 범위를 넘었다
- `apps/server` · `packages/cli` **무변경**
- 작업 트리 clean, untracked 없음
