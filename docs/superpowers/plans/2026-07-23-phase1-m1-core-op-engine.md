# Phase 1 / M1 — core 모델과 op 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/core`에 프로젝트 모델 타입과 op 엔진(적용·무결성 검증·역변환·diff)을 구현한다. `applyOps(base, diffModels(base, target)) ≡ target`과 `applyOps(applyOps(A, ops), invertOps(ops)) ≡ A` 라운드트립이 성립하는 순수 함수 계층.

**Architecture:** docs/02-architecture.md의 "상태 + op 로그" 설계의 core 부분. 모델은 **정규화된 flat 구조**(엔티티 종류별 `Record<id, entity>`) — op이 `(entity, entityId)`로 주소를 지정하고 M3의 상태 테이블과 1:1 대응하기 위함. 모든 함수는 순수(입력 불변, 새 모델 반환), IO 없음.

**Tech Stack:** TypeScript(strict/ESM), zod 4.x(엔티티 스키마), vitest.

## 설계 결정 (이 계획으로 확정)

- **모델 값은 JSON 직렬화 가능해야 한다**(스냅샷·CLI 파일 포맷 전제). 필드에 `undefined`/optional 금지 — 없음은 `null`로 표현하고 모든 필드는 required.
- **Phase 1 스코프의 엔티티만** 포함: table/column/relationship/index/note/tableGroup. 사전(Word/Term/Domain)·CustomField는 Phase 2 마일스톤에서 모델에 추가한다.
- Op의 `from`/`before`는 **기록용**이다. applyOps는 이를 전제조건(CAS)으로 검사하지 않는다(Phase 3 LWW에서 from 불일치는 정상). M3 서버 파이프라인이 영속화 전에 `from`/`before`를 서버의 현재 값으로 재기록해 Revision 로그의 정확성을 보장한다.
- Op의 zod 스키마(tRPC 입력용)는 M3에서 작성한다. M1의 op은 수동 TS 타입이고, applyOps가 엔티티 zod 스키마로 의미 검증한다.
- 컬럼 `type`은 문자열(논리 타입 정규형 또는 raw). 파싱·검증은 편집 시점(M4/M6)의 몫이고 모델은 저장만 한다.

## Global Constraints

- 이 마일스톤은 `packages/core`만 수정한다(다른 패키지·루트 파일 금지, 단 `pnpm-lock.yaml`은 zod 설치로 변경됨 — 함께 커밋).
- 순수 TS, IO 없음, 외부 런타임 의존성은 zod 하나만(서버와 같은 4.x 메이저).
- ESM, TypeScript strict. 테스트는 vitest, TDD(실패 확인 → 구현 → 통과).
- 모든 public 함수는 입력을 변경하지 않는다(불변). 테스트에서 입력 동결/비교로 확인한다.
- 커밋 메시지는 한국어. `git add .`/`-A` 금지(작업 트리에 무관한 .idea 변경 존재) — 명시 경로만.

---

### Task 1: 모델 타입과 zod 스키마

**Files:**
- Create: `packages/core/src/model.ts`
- Test: `packages/core/src/model.test.ts`
- Modify: `packages/core/src/index.ts`(export 추가), `packages/core/package.json`(zod 의존성)

**Interfaces:**
- Produces: 타입 `Table`, `Column`, `Relationship`, `IndexDef`, `Note`, `TableGroup`, `Position`, `ProjectModel`과 각 zod 스키마(`TableSchema` 등), `ProjectModelSchema`, `createEmptyModel(): ProjectModel`. Task 2~5가 전부 이 타입 위에 선다.

- [ ] **Step 1: zod 설치**

Run: `pnpm --filter @erdd/core add zod`
Expected: zod 4.x 설치. 4.x가 아니면 중단하고 보고.

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/core/src/model.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ColumnSchema, TableSchema, createEmptyModel } from './model.js'

describe('model schemas', () => {
  it('createEmptyModel returns all six empty collections', () => {
    expect(createEmptyModel()).toEqual({
      tables: {},
      columns: {},
      relationships: {},
      indexes: {},
      notes: {},
      tableGroups: {},
    })
  })

  it('TableSchema accepts a complete table and rejects unknown keys', () => {
    const table = {
      id: 't1',
      logicalName: '회원',
      physicalName: 'MBR',
      comment: null,
      groupId: null,
      position: { x: 0, y: 0 },
      groupPosition: null,
    }
    expect(TableSchema.parse(table)).toEqual(table)
    expect(() => TableSchema.parse({ ...table, extra: 1 })).toThrow()
  })

  it('ColumnSchema rejects a column missing required fields', () => {
    expect(() => ColumnSchema.parse({ id: 'c1', tableId: 't1' })).toThrow()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `model.js` 모듈 없음. (기존 logical-type 테스트 8개는 통과 유지)

- [ ] **Step 4: 구현**

`packages/core/src/model.ts`:
```ts
import { z } from 'zod'

export const PositionSchema = z.strictObject({ x: z.number(), y: z.number() })
export type Position = z.infer<typeof PositionSchema>

export const TableSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  comment: z.string().nullable(),
  groupId: z.string().nullable(),
  position: PositionSchema,
  groupPosition: PositionSchema.nullable(),
})
export type Table = z.infer<typeof TableSchema>

export const ColumnSchema = z.strictObject({
  id: z.string(),
  tableId: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  type: z.string(),
  isPk: z.boolean(),
  autoIncrement: z.boolean(),
  nullable: z.boolean(),
  defaultValue: z.string().nullable(),
  order: z.number().int(),
  comment: z.string().nullable(),
})
export type Column = z.infer<typeof ColumnSchema>

export const RelationshipSchema = z.strictObject({
  id: z.string(),
  parentTableId: z.string(),
  childTableId: z.string(),
  columnMappings: z.array(
    z.strictObject({ childColumnId: z.string(), parentColumnId: z.string() }),
  ),
  cardinality: z.enum(['1:1', '1:N']),
  identifying: z.boolean(),
  name: z.string().nullable(),
})
export type Relationship = z.infer<typeof RelationshipSchema>

export const IndexSchema = z.strictObject({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  columns: z.array(
    z.strictObject({ columnId: z.string(), direction: z.enum(['asc', 'desc']) }),
  ),
  unique: z.boolean(),
})
export type IndexDef = z.infer<typeof IndexSchema>

export const NoteSchema = z.strictObject({
  id: z.string(),
  content: z.string(),
  position: PositionSchema,
  color: z.string(),
})
export type Note = z.infer<typeof NoteSchema>

export const TableGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  comment: z.string().nullable(),
})
export type TableGroup = z.infer<typeof TableGroupSchema>

export const ProjectModelSchema = z.strictObject({
  tables: z.record(z.string(), TableSchema),
  columns: z.record(z.string(), ColumnSchema),
  relationships: z.record(z.string(), RelationshipSchema),
  indexes: z.record(z.string(), IndexSchema),
  notes: z.record(z.string(), NoteSchema),
  tableGroups: z.record(z.string(), TableGroupSchema),
})
export type ProjectModel = z.infer<typeof ProjectModelSchema>

export function createEmptyModel(): ProjectModel {
  return { tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {} }
}
```

`packages/core/src/index.ts`에 추가:
```ts
export {
  PositionSchema, TableSchema, ColumnSchema, RelationshipSchema,
  IndexSchema, NoteSchema, TableGroupSchema, ProjectModelSchema, createEmptyModel,
} from './model.js'
export type {
  Position, Table, Column, Relationship, IndexDef, Note, TableGroup, ProjectModel,
} from './model.js'
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck`
Expected: PASS (11 tests = 기존 8 + 신규 3).

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): 프로젝트 모델 타입과 zod 스키마"
```

---

### Task 2: 무결성 검증과 테스트 픽스처

**Files:**
- Create: `packages/core/src/integrity.ts`, `packages/core/src/testing/fixtures.ts`
- Test: `packages/core/src/integrity.test.ts`
- Modify: `packages/core/src/index.ts`(export 추가)

**Interfaces:**
- Consumes: Task 1의 `ProjectModel` 등 타입.
- Produces: `IntegrityIssue = { entity: EntityRef의 종류 문자열; entityId: string; message: string }`, `validateModelIntegrity(model: ProjectModel): IntegrityIssue[]`, 테스트 픽스처 `buildSampleModel(): ProjectModel`(Task 3~5의 테스트가 재사용). fixtures는 index.ts로 export하지 않는다(테스트 전용).

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/testing/fixtures.ts` 먼저 작성:
```ts
import type { ProjectModel } from '../model.js'

/** 그룹 1, 테이블 2(MBR_GRD, MBR), 컬럼 4, 관계 1, 인덱스 1, 메모 1인 유효한 샘플 모델. */
export function buildSampleModel(): ProjectModel {
  return {
    tableGroups: {
      g1: { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null },
    },
    tables: {
      t1: {
        id: 't1', logicalName: '회원등급', physicalName: 'MBR_GRD', comment: null,
        groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: { x: 10, y: 10 },
      },
      t2: {
        id: 't2', logicalName: '회원', physicalName: 'MBR', comment: '서비스 가입 회원',
        groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: { x: 310, y: 10 },
      },
    },
    columns: {
      c1: {
        id: 'c1', tableId: 't1', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: true, autoIncrement: false, nullable: false,
        defaultValue: null, order: 0, comment: null,
      },
      c2: {
        id: 'c2', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
        type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
        defaultValue: null, order: 0, comment: null,
      },
      c3: {
        id: 'c3', tableId: 't2', logicalName: '회원명', physicalName: 'MBR_NM',
        type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 1, comment: null,
      },
      c4: {
        id: 'c4', tableId: 't2', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 2, comment: null,
      },
    },
    relationships: {
      r1: {
        id: 'r1', parentTableId: 't1', childTableId: 't2',
        columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
        cardinality: '1:N', identifying: false, name: null,
      },
    },
    indexes: {
      i1: {
        id: 'i1', tableId: 't2', name: 'UX_MBR_01',
        columns: [{ columnId: 'c3', direction: 'asc' }], unique: true,
      },
    },
    notes: {
      n1: { id: 'n1', content: '회원 도메인 메모', position: { x: 600, y: 0 }, color: '#FFF3B0' },
    },
  }
}
```

`packages/core/src/integrity.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('validateModelIntegrity', () => {
  it('returns no issues for a valid model', () => {
    expect(validateModelIntegrity(buildSampleModel())).toEqual([])
  })

  it('flags a column whose tableId does not exist', () => {
    const m = buildSampleModel()
    m.columns.c9 = { ...m.columns.c3!, id: 'c9', tableId: 'missing' }
    const issues = validateModelIntegrity(m)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ entity: 'column', entityId: 'c9' })
  })

  it('flags a table whose groupId does not exist', () => {
    const m = buildSampleModel()
    m.tables.t1!.groupId = 'missing'
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags a relationship referencing a missing table', () => {
    const m = buildSampleModel()
    m.relationships.r1!.parentTableId = 'missing'
    expect(validateModelIntegrity(m).map((i) => i.entityId)).toEqual(['r1'])
  })

  it('flags a relationship mapping whose column belongs to the wrong table', () => {
    const m = buildSampleModel()
    // c3는 t2 소속인데 parent(t1) 쪽 컬럼으로 매핑
    m.relationships.r1!.columnMappings = [{ childColumnId: 'c4', parentColumnId: 'c3' }]
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags an index column that does not belong to the index table', () => {
    const m = buildSampleModel()
    m.indexes.i1!.columns = [{ columnId: 'c1', direction: 'asc' }]
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `integrity.js` 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/integrity.ts`:
```ts
import type { ProjectModel } from './model.js'

export type IntegrityIssue = {
  entity: 'table' | 'column' | 'relationship' | 'index'
  entityId: string
  message: string
}

/** 참조 무결성 검사. 이슈가 없으면 빈 배열. */
export function validateModelIntegrity(model: ProjectModel): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []

  for (const table of Object.values(model.tables)) {
    if (table.groupId !== null && !model.tableGroups[table.groupId]) {
      issues.push({
        entity: 'table', entityId: table.id,
        message: `존재하지 않는 그룹 참조: ${table.groupId}`,
      })
    }
  }

  for (const column of Object.values(model.columns)) {
    if (!model.tables[column.tableId]) {
      issues.push({
        entity: 'column', entityId: column.id,
        message: `존재하지 않는 테이블 참조: ${column.tableId}`,
      })
    }
  }

  for (const rel of Object.values(model.relationships)) {
    if (!model.tables[rel.parentTableId] || !model.tables[rel.childTableId]) {
      issues.push({
        entity: 'relationship', entityId: rel.id,
        message: '존재하지 않는 테이블 참조',
      })
      continue
    }
    for (const m of rel.columnMappings) {
      const child = model.columns[m.childColumnId]
      const parent = model.columns[m.parentColumnId]
      if (!child || child.tableId !== rel.childTableId || !parent || parent.tableId !== rel.parentTableId) {
        issues.push({
          entity: 'relationship', entityId: rel.id,
          message: '매핑 컬럼이 없거나 소속 테이블이 다름',
        })
        break
      }
    }
  }

  for (const index of Object.values(model.indexes)) {
    if (!model.tables[index.tableId]) {
      issues.push({
        entity: 'index', entityId: index.id,
        message: `존재하지 않는 테이블 참조: ${index.tableId}`,
      })
      continue
    }
    for (const ic of index.columns) {
      const column = model.columns[ic.columnId]
      if (!column || column.tableId !== index.tableId) {
        issues.push({
          entity: 'index', entityId: index.id,
          message: '인덱스 컬럼이 없거나 소속 테이블이 다름',
        })
        break
      }
    }
  }

  return issues
}
```

`packages/core/src/index.ts`에 추가:
```ts
export { validateModelIntegrity } from './integrity.js'
export type { IntegrityIssue } from './integrity.js'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck`
Expected: PASS (17 tests = 11 + 6).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 모델 참조 무결성 검증과 테스트 픽스처"
```

---

### Task 3: Op 타입과 applyOps

**Files:**
- Create: `packages/core/src/op.ts`
- Test: `packages/core/src/op.test.ts`
- Modify: `packages/core/src/index.ts`(export 추가)

**Interfaces:**
- Consumes: Task 1의 스키마들, Task 2의 `validateModelIntegrity`, `buildSampleModel`.
- Produces:
  - `ENTITY_KINDS: readonly ['tableGroup','table','column','relationship','index','note']`, `EntityKind`
  - `CreateOp | UpdateOp | DeleteOp` 유니언 `Op` (아래 정의 그대로)
  - `applyOps(model: ProjectModel, ops: readonly Op[]): ProjectModel` — 순수, 실패 시 `OpApplyError`(메시지에 몇 번째 op인지 포함) throw
  - Task 4·5가 이 타입과 함수를 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/op.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyOps, OpApplyError, type Op } from './op.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('applyOps', () => {
  it('applies create/update/delete and does not mutate the input model', () => {
    const base = buildSampleModel()
    const frozen = JSON.parse(JSON.stringify(base))
    const ops: Op[] = [
      {
        action: 'create', entity: 'note', entityId: 'n2',
        data: { id: 'n2', content: '새 메모', position: { x: 1, y: 2 }, color: '#FFFFFF' },
      },
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' } },
      },
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
    ]
    const next = applyOps(base, ops)
    expect(next.notes.n2?.content).toBe('새 메모')
    expect(next.columns.c3?.logicalName).toBe('고객명')
    expect(next.indexes.i1).toBeUndefined()
    expect(base).toEqual(frozen) // 입력 불변
  })

  it('rejects creating an entity whose id already exists', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n1',
      data: { id: 'n1', content: 'dup', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects create when data.id does not match entityId', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'create', entity: 'note', entityId: 'n2',
      data: { id: 'n9', content: 'x', position: { x: 0, y: 0 }, color: '#fff' },
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects update of a missing entity and update of the id property', () => {
    const base = buildSampleModel()
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 'missing', changes: { comment: { from: null, to: 'x' } } },
      ]),
    ).toThrow(OpApplyError)
    expect(() =>
      applyOps(base, [
        { action: 'update', entity: 'table', entityId: 't1', changes: { id: { from: 't1', to: 't9' } } },
      ]),
    ).toThrow(OpApplyError)
  })

  it('rejects update that produces a schema-invalid entity', () => {
    const base = buildSampleModel()
    const op: Op = {
      action: 'update', entity: 'column', entityId: 'c3',
      changes: { order: { from: 1, to: 1.5 } }, // order는 정수여야 함
    }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('rejects a batch that breaks referential integrity', () => {
    const base = buildSampleModel()
    // 컬럼·관계·인덱스를 남긴 채 테이블만 삭제 → 무결성 위반
    const op: Op = { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 }
    expect(() => applyOps(base, [op])).toThrow(OpApplyError)
  })

  it('accepts a full cascade delete batch', () => {
    const base = buildSampleModel()
    const ops: Op[] = [
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'relationship', entityId: 'r1', before: base.relationships.r1 },
      { action: 'delete', entity: 'column', entityId: 'c2', before: base.columns.c2 },
      { action: 'delete', entity: 'column', entityId: 'c3', before: base.columns.c3 },
      { action: 'delete', entity: 'column', entityId: 'c4', before: base.columns.c4 },
      { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 },
    ]
    const next = applyOps(base, ops)
    expect(next.tables.t2).toBeUndefined()
    expect(Object.keys(next.columns)).toEqual(['c1'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `op.js` 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/op.ts`:
```ts
import type { z } from 'zod'
import {
  ColumnSchema, IndexSchema, NoteSchema, RelationshipSchema, TableGroupSchema, TableSchema,
  type ProjectModel,
} from './model.js'
import { validateModelIntegrity } from './integrity.js'

export const ENTITY_KINDS = ['tableGroup', 'table', 'column', 'relationship', 'index', 'note'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

const ENTITY_SCHEMAS: Record<EntityKind, z.ZodType> = {
  tableGroup: TableGroupSchema,
  table: TableSchema,
  column: ColumnSchema,
  relationship: RelationshipSchema,
  index: IndexSchema,
  note: NoteSchema,
}

export const COLLECTION_BY_KIND = {
  tableGroup: 'tableGroups',
  table: 'tables',
  column: 'columns',
  relationship: 'relationships',
  index: 'indexes',
  note: 'notes',
} as const satisfies Record<EntityKind, keyof ProjectModel>

// from/before는 기록용이다. applyOps는 전제조건으로 검사하지 않는다(Phase 3 LWW에서
// from 불일치는 정상). M3 서버 파이프라인이 영속화 전에 서버의 현재 값으로 재기록한다.
export type CreateOp = { action: 'create'; entity: EntityKind; entityId: string; data: unknown }
export type UpdateOp = {
  action: 'update'
  entity: EntityKind
  entityId: string
  changes: Record<string, { from: unknown; to: unknown }>
}
export type DeleteOp = { action: 'delete'; entity: EntityKind; entityId: string; before: unknown }
export type Op = CreateOp | UpdateOp | DeleteOp

export class OpApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpApplyError'
  }
}

/** op 배치를 적용한 새 모델을 반환한다. 입력 모델은 변경하지 않는다. */
export function applyOps(model: ProjectModel, ops: readonly Op[]): ProjectModel {
  const next: ProjectModel = {
    tables: { ...model.tables },
    columns: { ...model.columns },
    relationships: { ...model.relationships },
    indexes: { ...model.indexes },
    notes: { ...model.notes },
    tableGroups: { ...model.tableGroups },
  }

  ops.forEach((op, i) => {
    const collection = next[COLLECTION_BY_KIND[op.entity]] as Record<string, { id: string }>
    const label = `op[${i}] ${op.action} ${op.entity} ${op.entityId}`

    if (op.action === 'create') {
      if (collection[op.entityId]) throw new OpApplyError(`${label}: 이미 존재함`)
      const parsed = ENTITY_SCHEMAS[op.entity].safeParse(op.data)
      if (!parsed.success) throw new OpApplyError(`${label}: 데이터 형식 오류 — ${parsed.error.message}`)
      const entity = parsed.data as { id: string }
      if (entity.id !== op.entityId) throw new OpApplyError(`${label}: data.id(${entity.id}) 불일치`)
      collection[op.entityId] = entity
    } else if (op.action === 'update') {
      const current = collection[op.entityId]
      if (!current) throw new OpApplyError(`${label}: 존재하지 않음`)
      const updated: Record<string, unknown> = { ...current }
      for (const [prop, change] of Object.entries(op.changes)) {
        if (prop === 'id') throw new OpApplyError(`${label}: id는 변경할 수 없음`)
        updated[prop] = change.to
      }
      const parsed = ENTITY_SCHEMAS[op.entity].safeParse(updated)
      if (!parsed.success) throw new OpApplyError(`${label}: 갱신 결과 형식 오류 — ${parsed.error.message}`)
      collection[op.entityId] = parsed.data as { id: string }
    } else {
      if (!collection[op.entityId]) throw new OpApplyError(`${label}: 존재하지 않음`)
      delete collection[op.entityId]
    }
  })

  const issues = validateModelIntegrity(next)
  if (issues.length > 0) {
    const summary = issues.map((it) => `${it.entity} ${it.entityId}: ${it.message}`).join('; ')
    throw new OpApplyError(`배치 적용 결과 무결성 위반 — ${summary}`)
  }

  return next
}
```

`packages/core/src/index.ts`에 추가:
```ts
export { ENTITY_KINDS, OpApplyError, applyOps } from './op.js'
export type { CreateOp, UpdateOp, DeleteOp, Op, EntityKind } from './op.js'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck`
Expected: PASS (24 tests = 17 + 7).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): op 타입과 applyOps — 스키마 검증, 무결성 검사, 불변 적용"
```

---

### Task 4: 역변환 (invert)

**Files:**
- Create: `packages/core/src/invert.ts`
- Test: `packages/core/src/invert.test.ts`
- Modify: `packages/core/src/index.ts`(export 추가)

**Interfaces:**
- Consumes: Task 3의 `Op` 타입, `applyOps`, `buildSampleModel`.
- Produces: `invertOp(op: Op): Op`, `invertOps(ops: readonly Op[]): Op[]`(역순 + 개별 역변환). undo(M4)와 스냅샷 복원 검증에 쓰인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/invert.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from './op.js'
import { invertOp, invertOps } from './invert.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('invert', () => {
  it('inverts create to delete, delete to create, update by swapping', () => {
    const data = { id: 'n2', content: 'x', position: { x: 0, y: 0 }, color: '#fff' }
    expect(invertOp({ action: 'create', entity: 'note', entityId: 'n2', data })).toEqual({
      action: 'delete', entity: 'note', entityId: 'n2', before: data,
    })
    expect(invertOp({ action: 'delete', entity: 'note', entityId: 'n2', before: data })).toEqual({
      action: 'create', entity: 'note', entityId: 'n2', data,
    })
    expect(
      invertOp({
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' } },
      }),
    ).toEqual({
      action: 'update', entity: 'column', entityId: 'c3',
      changes: { logicalName: { from: '고객명', to: '회원명' } },
    })
  })

  it('round-trips: apply(apply(A, ops), invertOps(ops)) equals A', () => {
    const base = buildSampleModel()
    const ops: Op[] = [
      {
        action: 'create', entity: 'note', entityId: 'n2',
        data: { id: 'n2', content: '새 메모', position: { x: 1, y: 2 }, color: '#FFFFFF' },
      },
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: { logicalName: { from: '회원명', to: '고객명' }, order: { from: 1, to: 5 } },
      },
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'note', entityId: 'n1', before: base.notes.n1 },
    ]
    const after = applyOps(base, ops)
    const restored = applyOps(after, invertOps(ops))
    expect(restored).toEqual(base)
  })

  it('invertOps reverses order so dependent creates/deletes round-trip', () => {
    const base = buildSampleModel()
    // 캐스케이드 삭제(자식 먼저) → 역변환은 생성이 부모 먼저여야 무결성 통과
    const ops: Op[] = [
      { action: 'delete', entity: 'index', entityId: 'i1', before: base.indexes.i1 },
      { action: 'delete', entity: 'relationship', entityId: 'r1', before: base.relationships.r1 },
      { action: 'delete', entity: 'column', entityId: 'c2', before: base.columns.c2 },
      { action: 'delete', entity: 'column', entityId: 'c3', before: base.columns.c3 },
      { action: 'delete', entity: 'column', entityId: 'c4', before: base.columns.c4 },
      { action: 'delete', entity: 'table', entityId: 't2', before: base.tables.t2 },
    ]
    const after = applyOps(base, ops)
    expect(applyOps(after, invertOps(ops))).toEqual(base)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `invert.js` 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/invert.ts`:
```ts
import type { Op } from './op.js'

/** 단일 op의 역연산. update의 from/to를 교환하고, create↔delete를 서로 바꾼다. */
export function invertOp(op: Op): Op {
  if (op.action === 'create') {
    return { action: 'delete', entity: op.entity, entityId: op.entityId, before: op.data }
  }
  if (op.action === 'delete') {
    return { action: 'create', entity: op.entity, entityId: op.entityId, data: op.before }
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [prop, change] of Object.entries(op.changes)) {
    changes[prop] = { from: change.to, to: change.from }
  }
  return { action: 'update', entity: op.entity, entityId: op.entityId, changes }
}

/** 배치의 역연산 — 역순으로 각 op을 역변환한다. */
export function invertOps(ops: readonly Op[]): Op[] {
  return [...ops].reverse().map(invertOp)
}
```

`packages/core/src/index.ts`에 추가:
```ts
export { invertOp, invertOps } from './invert.js'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck`
Expected: PASS (27 tests = 24 + 3).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): op 역변환(invert) — undo와 복원의 기반"
```

---

### Task 5: diff 엔진

**Files:**
- Create: `packages/core/src/equal.ts`, `packages/core/src/diff.ts`
- Test: `packages/core/src/diff.test.ts`
- Modify: `packages/core/src/index.ts`(export 추가)

**Interfaces:**
- Consumes: Task 1~3의 타입·함수, `buildSampleModel`.
- Produces: `deepEqual(a: unknown, b: unknown): boolean`(JSON-safe 값 구조 비교), `diffModels(base: ProjectModel, target: ProjectModel): Op[]`. 반환 순서 보장: create는 `tableGroup→table→column→relationship→index→note` 순, delete는 그 역순, update는 그 사이. `applyOps(base, diffModels(base, target))`가 항상 target과 동일해야 한다. 스냅샷 diff·복원(M7)·CLI push(Phase 4)가 이 함수를 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/diff.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyOps } from './op.js'
import { deepEqual } from './equal.js'
import { diffModels } from './diff.js'
import { buildSampleModel } from './testing/fixtures.js'
import { createEmptyModel } from './model.js'

describe('deepEqual', () => {
  it('compares JSON-safe values structurally', () => {
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('diffModels', () => {
  it('returns [] for identical models', () => {
    expect(diffModels(buildSampleModel(), buildSampleModel())).toEqual([])
  })

  it('emits update ops with per-property from/to', () => {
    const base = buildSampleModel()
    const target = buildSampleModel()
    target.columns.c3!.logicalName = '고객명'
    target.columns.c3!.order = 9
    const ops = diffModels(base, target)
    expect(ops).toEqual([
      {
        action: 'update', entity: 'column', entityId: 'c3',
        changes: {
          logicalName: { from: '회원명', to: '고객명' },
          order: { from: 1, to: 9 },
        },
      },
    ])
  })

  it('orders creates parent-first and deletes child-first (round-trip both ways)', () => {
    const empty = createEmptyModel()
    const full = buildSampleModel()

    const createOps = diffModels(empty, full)
    const kinds = createOps.map((o) => `${o.action}:${o.entity}`)
    // create: tableGroup → table → column → relationship → index → note 순서
    expect(kinds.indexOf('create:table')).toBeGreaterThan(kinds.indexOf('create:tableGroup'))
    expect(kinds.indexOf('create:column')).toBeGreaterThan(kinds.lastIndexOf('create:table'))
    expect(kinds.indexOf('create:relationship')).toBeGreaterThan(kinds.lastIndexOf('create:column'))
    expect(applyOps(empty, createOps)).toEqual(full)

    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
  })

  it('round-trips a mixed change set: apply(base, diff(base,target)) equals target', () => {
    const base = buildSampleModel()
    const target = buildSampleModel()
    // 수정
    target.tables.t2!.comment = '변경된 설명'
    // 삭제 (인덱스)
    delete target.indexes.i1
    // 추가 (메모)
    target.notes.n2 = { id: 'n2', content: '추가', position: { x: 5, y: 5 }, color: '#EEE' }
    const ops = diffModels(base, target)
    expect(applyOps(base, ops)).toEqual(target)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `equal.js`/`diff.js` 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/equal.ts`:
```ts
/** JSON-safe 값(객체/배열/원시/null)의 구조적 동등 비교. undefined·함수·Date는 전제 밖. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const arrA = a as unknown[]
    const arrB = b as unknown[]
    return arrA.length === arrB.length && arrA.every((v, i) => deepEqual(v, arrB[i]))
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)
  return (
    keysA.length === keysB.length &&
    keysA.every((k) => Object.prototype.hasOwnProperty.call(objB, k) && deepEqual(objA[k], objB[k]))
  )
}
```

`packages/core/src/diff.ts`:
```ts
import type { ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, ENTITY_KINDS, type Op } from './op.js'
import { deepEqual } from './equal.js'

/**
 * base → target으로 가는 op 배치.
 * 순서 보장: create는 ENTITY_KINDS(부모 우선) 순, update는 그 다음, delete는 역순(자식 우선)
 * — applyOps(base, diffModels(base, target))가 무결성 검사를 항상 통과하도록.
 */
export function diffModels(base: ProjectModel, target: ProjectModel): Op[] {
  const creates: Op[] = []
  const updates: Op[] = []
  const deletes: Op[] = []

  for (const kind of ENTITY_KINDS) {
    const baseCol = base[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>
    const targetCol = target[COLLECTION_BY_KIND[kind]] as Record<string, Record<string, unknown>>

    for (const [id, entity] of Object.entries(targetCol)) {
      const existing = baseCol[id]
      if (!existing) {
        creates.push({ action: 'create', entity: kind, entityId: id, data: entity })
      } else if (!deepEqual(existing, entity)) {
        const changes: Record<string, { from: unknown; to: unknown }> = {}
        for (const prop of Object.keys(entity)) {
          if (!deepEqual(existing[prop], entity[prop])) {
            changes[prop] = { from: existing[prop], to: entity[prop] }
          }
        }
        updates.push({ action: 'update', entity: kind, entityId: id, changes })
      }
    }

    for (const [id, entity] of Object.entries(baseCol)) {
      if (!targetCol[id]) {
        deletes.push({ action: 'delete', entity: kind, entityId: id, before: entity })
      }
    }
  }

  deletes.reverse()
  return [...creates, ...updates, ...deletes]
}
```

`packages/core/src/index.ts`에 추가:
```ts
export { deepEqual } from './equal.js'
export { diffModels } from './diff.js'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck`
Expected: PASS (32 tests = 27 + 5). 루트 `pnpm test`도 전체 통과.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): diff 엔진 — 모델 비교와 순서 보장된 op 배치 생성"
```

---

## 완료 기준 (M1 Definition of Done)

- `pnpm --filter @erdd/core test` 32개 테스트 전부 통과, typecheck 통과, 루트 `pnpm test`/`pnpm typecheck` 통과.
- 라운드트립 성립: `applyOps(base, diffModels(base, target)) ≡ target`, `applyOps(applyOps(A, ops), invertOps(ops)) ≡ A`.
- 모든 함수가 순수(입력 불변)하고 packages/core 밖을 수정하지 않았다.
