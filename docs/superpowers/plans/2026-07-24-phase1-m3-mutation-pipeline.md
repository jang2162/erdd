# Phase 1 / M3 — mutation 파이프라인과 Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M1 op 엔진을 서버 저장 계층에 연결 — 프로젝트 모델 상태 테이블, op 배치 mutation 파이프라인(권한→검증→상태 갱신+Revision 기록 단일 트랜잭션), 모델 로드 API, Revision 이력 API. M4 에디터가 이 위에 선다.

**Architecture:** docs/02-architecture.md "mutation 파이프라인 — 단일 변경 경로"의 구현. 정규화된 모델 상태 테이블 6종(진실 원천) + `revisions` append-only 로그. 프로젝트 행 `FOR UPDATE` 잠금으로 프로젝트별 mutation 직렬화(Phase 3 LWW의 "서버 도착 순서" 기반). core의 `applyOps`가 메모리 모델에서 배치를 검증하고, 검증 통과 후 op을 행 단위 SQL로 영속화한다.

**Tech Stack:** 기존 스택 그대로(신규 의존성 없음).

## 설계 결정 (이 계획으로 확정)

- **엔티티 id는 클라이언트가 생성한 UUID**(v7 권장). 서버는 `parseOps`에서 형식만 검증하고, 충돌은 PK 중복(DB)과 applyOps의 "이미 존재함" 검사로 거부된다. (02-architecture의 "서버 발급"은 CLI pull/push 신규 객체에 대한 규칙으로 유지 — M4에서 문서 정합화)
- **서버가 from/before를 권위값으로 재기록**한 뒤 Revision에 저장한다(M1 op.ts 주석의 이행). 클라이언트가 보낸 from/before는 무시된다.
- 모델 상태 테이블에 물리명 unique 제약을 **두지 않는다** — 물리명 중복은 경고 수준(13-naming, 저장 허용).
- 모델 테이블 간 FK는 기본(NO ACTION)으로 건다. core가 배치 순서(부모 우선 생성/자식 우선 삭제)를 보장하므로 트랜잭션 내 순차 적용으로 충족된다.
- `revision.list`는 seq 내림차순 커서 페이지네이션. ops 전문 포함(이력 화면 M8에서 상세 표시용; 최적화는 그때).

## Global Constraints

- 수정 범위: `packages/core`(op 가드 + 배럴 export 소폭), `apps/server`. 신규 외부 의존성 없음(pnpm-lock 변경 없음). `apps/web` 수정 금지.
- 통합 테스트는 `DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd` 로 GREEN 확인(erdd-db-1 컨테이너 실행 중) + 미설정 실행(스킵)도 1회 확인.
- ESM, TypeScript strict. 커밋 메시지는 한국어. `git add .`/`-A` 금지(작업 트리에 무관한 .idea 변경·.env 존재) — 명시 경로만.
- 기존 테스트(core 38, server 27, web 8) 전부 유지.

---

### Task 1: core — op 파스 가드와 배럴 정리

**Files:**
- Create: `packages/core/src/op-guard.ts`
- Test: `packages/core/src/op-guard.test.ts`
- Modify: `packages/core/src/index.ts`(parseOps·OpParseError·COLLECTION_BY_KIND export 추가)

**Interfaces:**
- Produces: `parseOps(value: unknown): Op[]` — 신뢰할 수 없는 입력(tRPC body)을 Op 배열로 검증·정규화. 실패 시 `OpParseError`(몇 번째 op·이유 포함) throw. entityId는 UUID 형식 필수. update의 from은 보존하되 서버가 재기록하므로 형식만 확인. Task 4의 mutation 라우트가 사용.
- `COLLECTION_BY_KIND`를 배럴로 노출(M1 이월 — 서버의 from/before 재기록이 사용).

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/op-guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { OpParseError, parseOps } from './op-guard.js'

const UUID = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e6f'

describe('parseOps', () => {
  it('accepts a valid mixed batch and returns typed ops', () => {
    const ops = parseOps([
      { action: 'create', entity: 'note', entityId: UUID, data: { id: UUID } },
      { action: 'update', entity: 'column', entityId: UUID, changes: { logicalName: { from: 'a', to: 'b' } } },
      { action: 'delete', entity: 'table', entityId: UUID, before: null },
    ])
    expect(ops).toHaveLength(3)
    expect(ops[0]!.action).toBe('create')
  })

  it('rejects non-array input and empty batches', () => {
    expect(() => parseOps('nope')).toThrow(OpParseError)
    expect(() => parseOps([])).toThrow(OpParseError)
  })

  it('rejects unknown action/entity and non-uuid entityId', () => {
    expect(() => parseOps([{ action: 'upsert', entity: 'note', entityId: UUID, data: {} }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'create', entity: 'widget', entityId: UUID, data: {} }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'create', entity: 'note', entityId: 't1', data: {} }]))
      .toThrow(OpParseError)
  })

  it('rejects structurally broken ops with the op index in the message', () => {
    expect(() =>
      parseOps([
        { action: 'create', entity: 'note', entityId: UUID, data: {} },
        { action: 'update', entity: 'note', entityId: UUID, changes: { x: { to: 1 } } },
      ]),
    ).toThrow(/op\[1\]/)
    expect(() => parseOps([{ action: 'delete', entity: 'note', entityId: UUID }]))
      .toThrow(OpParseError)
    expect(() => parseOps([{ action: 'update', entity: 'note', entityId: UUID, changes: {} }]))
      .toThrow(OpParseError)
  })
})
```

Run: `pnpm --filter @erdd/core test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`packages/core/src/op-guard.ts`:
```ts
import { ENTITY_KINDS, type EntityKind, type Op } from './op.js'

export class OpParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpParseError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ['create', 'update', 'delete'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 신뢰할 수 없는 입력을 Op 배열로 검증한다. 의미 검증(스키마·무결성)은 applyOps의 몫. */
export function parseOps(value: unknown): Op[] {
  if (!Array.isArray(value)) throw new OpParseError('ops는 배열이어야 합니다')
  if (value.length === 0) throw new OpParseError('ops가 비어 있습니다')

  return value.map((raw, i) => {
    const label = `op[${i}]`
    if (!isRecord(raw)) throw new OpParseError(`${label}: 객체가 아닙니다`)
    const action = raw.action
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      throw new OpParseError(`${label}: 알 수 없는 action`)
    }
    const entity = raw.entity
    if (typeof entity !== 'string' || !(ENTITY_KINDS as readonly string[]).includes(entity)) {
      throw new OpParseError(`${label}: 알 수 없는 entity`)
    }
    const entityId = raw.entityId
    if (typeof entityId !== 'string' || !UUID_RE.test(entityId)) {
      throw new OpParseError(`${label}: entityId는 UUID여야 합니다`)
    }

    if (action === 'create') {
      if (!isRecord(raw.data)) throw new OpParseError(`${label}: create에는 data 객체가 필요합니다`)
      return { action, entity: entity as EntityKind, entityId, data: raw.data }
    }
    if (action === 'delete') {
      if (!('before' in raw)) throw new OpParseError(`${label}: delete에는 before가 필요합니다`)
      return { action, entity: entity as EntityKind, entityId, before: raw.before }
    }
    const changes = raw.changes
    if (!isRecord(changes) || Object.keys(changes).length === 0) {
      throw new OpParseError(`${label}: update에는 비어 있지 않은 changes가 필요합니다`)
    }
    const parsed: Record<string, { from: unknown; to: unknown }> = {}
    for (const [prop, change] of Object.entries(changes)) {
      if (!isRecord(change) || !('from' in change) || !('to' in change)) {
        throw new OpParseError(`${label}: changes.${prop}에는 from/to가 필요합니다`)
      }
      parsed[prop] = { from: change.from, to: change.to }
    }
    return { action, entity: entity as EntityKind, entityId, changes: parsed }
  })
}
```

`packages/core/src/index.ts`에 추가:
```ts
export { COLLECTION_BY_KIND } from './op.js'
export { OpParseError, parseOps } from './op-guard.js'
```

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck` → PASS(42 tests).
```bash
git add packages/core
git commit -m "feat(core): op 파스 가드 — 외부 입력 검증과 배럴 정리"
```

---

### Task 2: 모델 상태 테이블과 revisions 스키마

**Files:**
- Modify: `apps/server/src/db/schema.ts`(모델 테이블 6종 + revisions 추가), `apps/server/src/testing/db.ts`(TEST_TABLES 확장)
- Test: `apps/server/src/db/schema.test.ts`(테이블 존재 검증 확장)
- 생성됨: `apps/server/drizzle/0002_*.sql`(커밋 대상)

**Interfaces:**
- Produces: `modelTables/modelColumns/modelRelationships/modelIndexes/modelNotes/modelTableGroups/revisions` drizzle 테이블. Task 3~5가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/db/schema.test.ts`의 첫 테스트(`has all six tables migrated`)를 다음으로 교체(TEST_TABLES 기반 유지):
```ts
  it('has all account and model tables migrated', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const names = res.rows.map((r) => r.table_name)
    for (const t of TEST_TABLES) expect(names).toContain(t)
    expect(names).toContain('revisions')
    await pool.end()
  })
```

`apps/server/src/testing/db.ts`의 TEST_TABLES를 다음으로 교체:
```ts
export const TEST_TABLES = [
  'revisions',
  'model_columns', 'model_indexes', 'model_relationships', 'model_notes',
  'model_tables', 'model_table_groups',
  'project_members', 'projects', 'members', 'organizations', 'sessions', 'users',
] as const
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(테이블 없음 — resetDb의 TRUNCATE도 실패하므로 다수 실패 정상).

- [ ] **Step 2: 스키마 구현**

`apps/server/src/db/schema.ts` — 상단 import에 `integer`(drizzle-orm/pg-core)와 `import type { Op } from '@erdd/core'`를 추가하고, 파일 하단에 다음을 추가:
```ts

// ─── 프로젝트 모델 상태 테이블 (packages/core ProjectModel과 1:1) ───

export const modelTableGroups = pgTable('model_table_groups', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  comment: text('comment'),
})

export const modelTables = pgTable('model_tables', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  comment: text('comment'),
  groupId: uuid('group_id').references(() => modelTableGroups.id),
  position: jsonb('position').$type<{ x: number; y: number }>().notNull(),
  groupPosition: jsonb('group_position').$type<{ x: number; y: number }>(),
})

export const modelColumns = pgTable('model_columns', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => modelTables.id),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  type: text('type').notNull(),
  isPk: boolean('is_pk').notNull(),
  autoIncrement: boolean('auto_increment').notNull(),
  nullable: boolean('nullable').notNull(),
  defaultValue: text('default_value'),
  order: integer('order').notNull(),
  comment: text('comment'),
})

export const modelRelationships = pgTable('model_relationships', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentTableId: uuid('parent_table_id').notNull().references(() => modelTables.id),
  childTableId: uuid('child_table_id').notNull().references(() => modelTables.id),
  columnMappings: jsonb('column_mappings')
    .$type<Array<{ childColumnId: string; parentColumnId: string }>>().notNull(),
  cardinality: text('cardinality', { enum: ['1:1', '1:N'] }).notNull(),
  identifying: boolean('identifying').notNull(),
  name: text('name'),
})

export const modelIndexes = pgTable('model_indexes', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => modelTables.id),
  name: text('name').notNull(),
  columns: jsonb('columns')
    .$type<Array<{ columnId: string; direction: 'asc' | 'desc' }>>().notNull(),
  unique: boolean('unique').notNull(),
})

export const modelNotes = pgTable('model_notes', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  position: jsonb('position').$type<{ x: number; y: number }>().notNull(),
  color: text('color').notNull(),
})

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
    source: text('source', { enum: ['web', 'cli', 'system'] }).notNull(),
    ops: jsonb('ops').$type<Op[]>().notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_revisions_project_seq').on(t.projectId, t.seq)],
)
```

- [ ] **Step 3: 마이그레이션 생성·적용·테스트**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server db:generate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server db:migrate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server typecheck
```
Expected: `drizzle/0002_*.sql`에 신규 테이블 7종 CREATE(기존 테이블 변경 없음 — 신설만이라 대화형 프롬프트 없어야 함), 테스트 전부 통과.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "feat(server): 프로젝트 모델 상태 테이블과 revisions 스키마"
```

---

### Task 3: model-store — 모델 로드와 op 영속화

**Files:**
- Create: `apps/server/src/services/model-store.ts`
- Modify: `apps/server/src/testing/helpers.ts`(withUuidIds 추가)
- Test: `apps/server/src/services/model-store.test.ts`

**Interfaces:**
- Consumes: Task 2 스키마, core의 타입·`applyOps`·`diffModels`·`createEmptyModel`.
- Produces:
  - `type DbLike` — Db와 트랜잭션 객체 공용 쿼리 인터페이스
  - `loadProjectModel(db: DbLike, projectId: string): Promise<ProjectModel>`
  - `persistOps(db: DbLike, projectId: string, ops: readonly Op[]): Promise<void>` — **applyOps로 선검증된 배치**만 받는다는 계약(JSDoc 명시)
  - 테스트 헬퍼 `withUuidIds(model: ProjectModel): ProjectModel` — core 픽스처의 짧은 id('t1' 등)를 UUID로 재매핑(DB uuid 컬럼용). Task 4·5 테스트가 재사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/testing/helpers.ts`에 추가:
```ts
import { uuidv7 } from 'uuidv7'
import type { ProjectModel } from '@erdd/core'

/** core 픽스처의 짧은 id를 UUID로 재매핑한다(DB uuid 컬럼용). 참조 필드도 함께 치환. */
export function withUuidIds(model: ProjectModel): ProjectModel {
  const map = new Map<string, string>()
  const nid = (old: string): string => {
    if (!map.has(old)) map.set(old, uuidv7())
    return map.get(old)!
  }
  const remapRecord = <T extends { id: string }>(
    rec: Record<string, T>, fix: (e: T) => T,
  ): Record<string, T> =>
    Object.fromEntries(Object.values(rec).map((e) => {
      const next = fix({ ...e, id: nid(e.id) })
      return [next.id, next]
    }))

  return {
    tableGroups: remapRecord(model.tableGroups, (g) => g),
    tables: remapRecord(model.tables, (t) => ({
      ...t, groupId: t.groupId === null ? null : nid(t.groupId),
    })),
    columns: remapRecord(model.columns, (c) => ({ ...c, tableId: nid(c.tableId) })),
    relationships: remapRecord(model.relationships, (r) => ({
      ...r,
      parentTableId: nid(r.parentTableId),
      childTableId: nid(r.childTableId),
      columnMappings: r.columnMappings.map((m) => ({
        childColumnId: nid(m.childColumnId),
        parentColumnId: nid(m.parentColumnId),
      })),
    })),
    indexes: remapRecord(model.indexes, (ix) => ({
      ...ix,
      tableId: nid(ix.tableId),
      columns: ix.columns.map((c) => ({ ...c, columnId: nid(c.columnId) })),
    })),
    notes: remapRecord(model.notes, (n) => n),
  }
}
```

`apps/server/src/services/model-store.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createEmptyModel, diffModels } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { uuidv7 } from 'uuidv7'
import { organizations, projects } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, withUuidIds } from '../testing/helpers.js'
import { loadProjectModel, persistOps } from './model-store.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('model-store', () => {
  let app: FastifyInstance
  let projectId: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const orgId = uuidv7()
    projectId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '테스트', kind: 'team' })
    await app.db!.insert(projects).values({
      id: projectId, orgId, name: 'P', description: '', dialects: ['postgresql'],
    })
  })

  it('persists a creation batch and loads back the identical model', async () => {
    const target = withUuidIds(buildSampleModel())
    const ops = diffModels(createEmptyModel(), target)
    await persistOps(app.db!, projectId, ops)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(target)
  })

  it('applies update and delete ops to rows', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const next = structuredClone(base)
    const someColumnId = Object.keys(next.columns)[0]!
    next.columns[someColumnId]!.logicalName = '변경됨'
    const noteId = Object.keys(next.notes)[0]!
    delete next.notes[noteId]

    await persistOps(app.db!, projectId, diffModels(base, next))
    expect(await loadProjectModel(app.db!, projectId)).toEqual(next)
  })

  it('scopes by project — ops cannot touch another project rows', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const otherProject = uuidv7()
    const orgId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '다른', kind: 'team' })
    await app.db!.insert(projects).values({
      id: otherProject, orgId, name: 'Q', description: '', dialects: ['mysql'],
    })
    // 다른 프로젝트 스코프로 기존 노트를 삭제 시도 → 행이 남아 있어야 함
    const noteId = Object.keys(base.notes)[0]!
    await persistOps(app.db!, otherProject, [
      { action: 'delete', entity: 'note', entityId: noteId, before: null },
    ])
    const reloaded = await loadProjectModel(app.db!, projectId)
    expect(reloaded.notes[noteId]).toBeDefined()
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`apps/server/src/services/model-store.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type {
  Column, IndexDef, Note, Op, ProjectModel, Relationship, Table, TableGroup,
} from '@erdd/core'
import * as schema from '../db/schema.js'
import {
  modelColumns, modelIndexes, modelNotes, modelRelationships, modelTableGroups, modelTables,
} from '../db/schema.js'

/** Db와 drizzle 트랜잭션 객체가 공유하는 쿼리 인터페이스. */
export type DbLike = Pick<
  NodePgDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete' | 'execute'
>

const TABLE_BY_KIND = {
  tableGroup: modelTableGroups,
  table: modelTables,
  column: modelColumns,
  relationship: modelRelationships,
  index: modelIndexes,
  note: modelNotes,
} as const

function keyed<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]))
}

export async function loadProjectModel(db: DbLike, projectId: string): Promise<ProjectModel> {
  const groupRows = await db.select().from(modelTableGroups)
    .where(eq(modelTableGroups.projectId, projectId))
  const tableRows = await db.select().from(modelTables)
    .where(eq(modelTables.projectId, projectId))
  const columnRows = await db.select().from(modelColumns)
    .where(eq(modelColumns.projectId, projectId))
  const relRows = await db.select().from(modelRelationships)
    .where(eq(modelRelationships.projectId, projectId))
  const indexRows = await db.select().from(modelIndexes)
    .where(eq(modelIndexes.projectId, projectId))
  const noteRows = await db.select().from(modelNotes)
    .where(eq(modelNotes.projectId, projectId))

  return {
    tableGroups: keyed(groupRows.map((r): TableGroup => ({
      id: r.id, name: r.name, color: r.color, comment: r.comment,
    }))),
    tables: keyed(tableRows.map((r): Table => ({
      id: r.id, logicalName: r.logicalName, physicalName: r.physicalName,
      comment: r.comment, groupId: r.groupId, position: r.position,
      groupPosition: r.groupPosition ?? null,
    }))),
    columns: keyed(columnRows.map((r): Column => ({
      id: r.id, tableId: r.tableId, logicalName: r.logicalName, physicalName: r.physicalName,
      type: r.type, isPk: r.isPk, autoIncrement: r.autoIncrement, nullable: r.nullable,
      defaultValue: r.defaultValue, order: r.order, comment: r.comment,
    }))),
    relationships: keyed(relRows.map((r): Relationship => ({
      id: r.id, parentTableId: r.parentTableId, childTableId: r.childTableId,
      columnMappings: r.columnMappings, cardinality: r.cardinality,
      identifying: r.identifying, name: r.name,
    }))),
    indexes: keyed(indexRows.map((r): IndexDef => ({
      id: r.id, tableId: r.tableId, name: r.name, columns: r.columns, unique: r.unique,
    }))),
    notes: keyed(noteRows.map((r): Note => ({
      id: r.id, content: r.content, position: r.position, color: r.color,
    }))),
  }
}

/**
 * op 배치를 행 단위 SQL로 적용한다.
 * 계약: 호출 전에 반드시 core `applyOps`로 같은 배치가 검증(스키마·무결성)되어 있어야 한다.
 * 모든 조건에 projectId 스코프를 포함해 타 프로젝트 행 접근을 차단한다.
 */
export async function persistOps(
  db: DbLike, projectId: string, ops: readonly Op[],
): Promise<void> {
  for (const op of ops) {
    // 유니언 테이블에 대한 캐스트 — 필드명이 모델 속성과 1:1이고 applyOps가 선검증한다.
    const table = TABLE_BY_KIND[op.entity] as typeof modelNotes
    if (op.action === 'create') {
      await db.insert(table).values({ ...(op.data as object), projectId } as never)
    } else if (op.action === 'update') {
      const patch: Record<string, unknown> = {}
      for (const [prop, change] of Object.entries(op.changes)) patch[prop] = change.to
      await db.update(table).set(patch as never)
        .where(and(eq(table.id, op.entityId), eq(table.projectId, projectId)))
    } else {
      await db.delete(table)
        .where(and(eq(table.id, op.entityId), eq(table.projectId, projectId)))
    }
  }
}
```

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server typecheck
```
Expected: PASS. (`as typeof modelNotes` 캐스트가 typecheck에서 마찰을 일으키면 최소한으로 조정하고 보고서에 기록 — 의미는 유지할 것)

```bash
git add apps/server
git commit -m "feat(server): model-store — 모델 로드와 op 행 단위 영속화"
```

---

### Task 4: mutation 파이프라인 — model.get / model.mutate

**Files:**
- Create: `apps/server/src/routers/model.ts`
- Modify: `apps/server/src/services/perm.ts`(canEdit + requireProjectAccess 이동), `apps/server/src/routers/project.ts`(requireProjectAccess 재사용), `apps/server/src/router.ts`(model 연결)
- Test: `apps/server/src/routers/model.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseOps`, Task 3 model-store, core `applyOps`/`OpApplyError`/`COLLECTION_BY_KIND`.
- Produces:
  - perm.ts: `ProjectAccess.canEdit`(= canManage ∨ projectRole 'editor'), `requireProjectAccess(db, projectId, userId, level: 'view'|'edit'|'manage')` export — project.ts의 로컬 requireAccess를 대체.
  - `model.get({projectId})` → `{ model: ProjectModel, seq: number }` (view 권한)
  - `model.mutate({projectId, ops, summary?})` → `{ seq: number }` (edit 권한). 파이프라인: parseOps → 트랜잭션[프로젝트 행 FOR UPDATE → loadProjectModel → from/before 권위값 재기록 → applyOps(실패 시 BAD_REQUEST) → persistOps → revisions INSERT(seq=max+1)].

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/routers/model.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { createEmptyModel, diffModels, type Op } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs, withUuidIds } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: token } })
}

describe.skipIf(!url)('model', () => {
  let app: FastifyInstance
  let editorToken: string
  let viewerToken: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'v@t.dev', name: '뷰어', password: 'password-v', role: 'user' })
    editorToken = await loginAs(app, 'o@t.dev', 'password-o')
    viewerToken = await loginAs(app, 'v@t.dev', 'password-v')
    const orgId = (await post(app, 'org.create', editorToken, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', editorToken, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
    await post(app, 'org.members.add', editorToken, { orgId, email: 'v@t.dev', role: 'member' })
    const members = (await get(app, 'org.members.list', editorToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const v = members.find((m) => m.email === 'v@t.dev')!
    await post(app, 'project.members.add', editorToken, {
      projectId, memberId: v.id, role: 'viewer',
    })
  })

  it('mutates a creation batch and reads back the identical model with seq', async () => {
    const target = withUuidIds(buildSampleModel())
    const ops = diffModels(createEmptyModel(), target)
    const res = await post(app, 'model.mutate', editorToken, { projectId, ops })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.seq).toBe(1)

    const got = await get(app, 'model.get', viewerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.model).toEqual(JSON.parse(JSON.stringify(target)))
    expect(got.json().result.data.seq).toBe(1)
  })

  it('rewrites update.from and delete.before with authoritative values', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    const columnId = Object.keys(target.columns)[0]!
    const realName = target.columns[columnId]!.logicalName
    const ops: Op[] = [
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { logicalName: { from: '거짓말', to: '새이름' } },
      },
    ]
    const res = await post(app, 'model.mutate', editorToken, { projectId, ops, summary: '이름 변경' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.seq).toBe(2)

    // revisions 테이블 직접 조회(revision.list 라우트는 Task 5)
    const rows = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    const top = rows[0]!
    expect(top.seq).toBe(2)
    expect(top.summary).toBe('이름 변경')
    const firstOp = top.ops[0] as { changes: Record<string, { from: unknown }> }
    expect(firstOp.changes.logicalName!.from).toBe(realName) // 권위값으로 재기록됨
  })

  it('rejects an integrity-breaking batch with 400 and leaves state unchanged', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    const tableId = Object.values(target.tables)
      .find((t) => t.physicalName === 'MBR')!.id
    const res = await post(app, 'model.mutate', editorToken, {
      projectId,
      ops: [{ action: 'delete', entity: 'table', entityId: tableId, before: null }],
    })
    expect(res.statusCode).toBe(400)
    const got = (await get(app, 'model.get', editorToken, { projectId })).json().result.data
    expect(got.seq).toBe(1)
    expect(got.model.tables[tableId]).toBeDefined()
  })

  it('denies mutate to viewers (403) but allows get; denies get to non-members', async () => {
    const noteId = '018f6b0e-5f2a-7c3d-9e4b-1a2b3c4d5e6f'
    const denied = await post(app, 'model.mutate', viewerToken, {
      projectId,
      ops: [{
        action: 'create', entity: 'note', entityId: noteId,
        data: { id: noteId, content: 'x', position: { x: 0, y: 0 }, color: '#fff' },
      }],
    })
    expect(denied.statusCode).toBe(403)

    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const got = await get(app, 'model.get', outsider, { projectId })
    expect([403, 404]).toContain(got.statusCode)
  })
})
```
Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(라우트 없음).

- [ ] **Step 2: 구현**

`apps/server/src/services/perm.ts` — `ProjectAccess`에 `canEdit` 추가, `requireProjectAccess` 신설:
```ts
// ProjectAccess 타입에 추가:
  /** 스키마 편집 가능(Org Owner/Admin ∨ Project Admin/Editor) */
  canEdit: boolean

// getProjectAccess 반환 객체에 추가:
    canEdit: isOrgManager || projectRole === 'admin' || projectRole === 'editor',

// 신설:
import { TRPCError } from '@trpc/server'

export async function requireProjectAccess(
  db: Db, projectId: string, userId: string, level: 'view' | 'edit' | 'manage',
): Promise<ProjectAccess> {
  const access = await getProjectAccess(db, projectId, userId)
  if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  const allowed =
    level === 'view' ? access.canView : level === 'edit' ? access.canEdit : access.canManage
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 접근 권한이 없습니다' })
  return access
}
```

`apps/server/src/routers/project.ts` — 로컬 `requireAccess` 함수를 제거하고 `requireProjectAccess`를 import해 기존 호출부를 `requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view'|'manage')`로 교체(동작 동일).

`apps/server/src/routers/model.ts`:
```ts
import { desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  applyOps, COLLECTION_BY_KIND, OpApplyError, OpParseError, parseOps,
  type EntityKind, type Op, type ProjectModel,
} from '@erdd/core'
import { projects, revisions } from '../db/schema.js'
import { loadProjectModel, persistOps } from '../services/model-store.js'
import { requireProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

const KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계',
  index: '인덱스', note: '메모', tableGroup: '그룹',
}
const ACTION_LABEL = { create: '생성', update: '수정', delete: '삭제' } as const

export function summarizeOps(ops: readonly Op[]): string {
  const first = ops[0]!
  const head = `${KIND_LABEL[first.entity]} ${ACTION_LABEL[first.action]}`
  return ops.length === 1 ? head : `${head} 외 ${ops.length - 1}건`
}

/** update.from / delete.before를 서버의 현재 값으로 재기록한다(Revision 로그의 정확성 보장). */
function withAuthoritativeHistory(model: ProjectModel, ops: readonly Op[]): Op[] {
  return ops.map((op) => {
    const collection = model[COLLECTION_BY_KIND[op.entity]] as Record<string, Record<string, unknown>>
    const current = Object.hasOwn(collection, op.entityId) ? collection[op.entityId] : undefined
    if (op.action === 'update' && current) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const [prop, change] of Object.entries(op.changes)) {
        changes[prop] = { from: current[prop], to: change.to }
      }
      return { ...op, changes }
    }
    if (op.action === 'delete' && current) return { ...op, before: current }
    return op
  })
}

async function currentSeq(db: Parameters<typeof loadProjectModel>[0], projectId: string) {
  const rows = await db.select({ seq: revisions.seq }).from(revisions)
    .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
  return rows[0]?.seq ?? 0
}

export const modelRouter = router({
  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const model = await loadProjectModel(ctx.db, input.projectId)
      const seq = await currentSeq(ctx.db, input.projectId)
      return { model, seq }
    }),

  mutate: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      ops: z.array(z.unknown()).min(1).max(500),
      summary: z.string().min(1).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')

      let ops: Op[]
      try {
        ops = parseOps(input.ops)
      } catch (err) {
        if (err instanceof OpParseError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        }
        throw err
      }

      return ctx.db.transaction(async (tx) => {
        // 프로젝트별 mutation 직렬화 — 같은 프로젝트의 동시 mutate는 여기서 대기한다.
        await tx.execute(sql`SELECT id FROM projects WHERE id = ${input.projectId} FOR UPDATE`)
        const exists = await tx.select({ id: projects.id }).from(projects)
          .where(eq(projects.id, input.projectId))
        if (exists.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
        }

        const model = await loadProjectModel(tx, input.projectId)
        const authoritative = withAuthoritativeHistory(model, ops)

        try {
          applyOps(model, authoritative)
        } catch (err) {
          if (err instanceof OpApplyError) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
          }
          throw err
        }

        await persistOps(tx, input.projectId, authoritative)
        const seq = (await currentSeq(tx, input.projectId)) + 1
        await tx.insert(revisions).values({
          id: uuidv7(),
          projectId: input.projectId,
          seq,
          actorUserId: ctx.user.id,
          source: 'web',
          ops: authoritative,
          summary: input.summary ?? summarizeOps(authoritative),
        })
        return { seq }
      })
    }),
})
```

`apps/server/src/router.ts`: appRouter에 `model: modelRouter` 추가.

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server typecheck && pnpm --filter @erdd/web typecheck
```
Expected: PASS(web typecheck — AppRouter 확장 영향 없음 확인).

```bash
git add apps/server
git commit -m "feat(server): mutation 파이프라인 — 잠금·검증·영속화·Revision 기록 단일 트랜잭션"
```

---

### Task 5: revision.list 라우트

**Files:**
- Create: `apps/server/src/routers/revision.ts`
- Modify: `apps/server/src/router.ts`(revision 연결)
- Test: `apps/server/src/routers/revision.test.ts`

**Interfaces:**
- Consumes: Task 4 파이프라인(테스트 데이터 생성), `requireProjectAccess`.
- Produces: `revision.list({projectId, cursor?, limit?})` → `{ items: [{seq, summary, source, actorName, createdAt, ops}], nextCursor: number | null }` — seq 내림차순, cursor는 "이 seq 미만"을 의미. view 권한.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/routers/revision.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: token } })
}

function noteCreateOp() {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

describe.skipIf(!url)('revision', () => {
  let app: FastifyInstance
  let token: string
  let projectId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    token = await loginAs(app, 'o@t.dev', 'password-o')
    const orgId = (await post(app, 'org.create', token, { name: '팀' })).json().result.data.id
    projectId = (await post(app, 'project.create', token, {
      orgId, name: 'P', dialects: ['postgresql'],
    })).json().result.data.id
  })

  it('lists revisions newest-first with actor name and paginates by cursor', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await post(app, 'model.mutate', token, { projectId, ops: [noteCreateOp()] })
      expect(res.statusCode).toBe(200)
    }
    const page1 = (await get(app, 'revision.list', token, { projectId, limit: 2 }))
      .json().result.data
    expect(page1.items.map((r: { seq: number }) => r.seq)).toEqual([3, 2])
    expect(page1.items[0].actorName).toBe('오너')
    expect(page1.items[0].summary).toBe('메모 생성')
    expect(page1.nextCursor).toBe(2)

    const page2 = (await get(app, 'revision.list', token, {
      projectId, limit: 2, cursor: page1.nextCursor,
    })).json().result.data
    expect(page2.items.map((r: { seq: number }) => r.seq)).toEqual([1])
    expect(page2.nextCursor).toBeNull()
  })

  it('denies non-members', async () => {
    await createAccount(app.db!, { email: 'x@t.dev', name: '외부', password: 'password-x', role: 'user' })
    const outsider = await loginAs(app, 'x@t.dev', 'password-x')
    const res = await get(app, 'revision.list', outsider, { projectId })
    expect([403, 404]).toContain(res.statusCode)
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(라우트 없음).

- [ ] **Step 2: 구현**

`apps/server/src/routers/revision.ts`:
```ts
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { revisions, users } from '../db/schema.js'
import { requireProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

export const revisionRouter = router({
  list: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      const where = input.cursor === undefined
        ? eq(revisions.projectId, input.projectId)
        : and(eq(revisions.projectId, input.projectId), lt(revisions.seq, input.cursor))
      const items = await ctx.db
        .select({
          seq: revisions.seq,
          summary: revisions.summary,
          source: revisions.source,
          ops: revisions.ops,
          createdAt: revisions.createdAt,
          actorName: users.name,
        })
        .from(revisions)
        .innerJoin(users, eq(revisions.actorUserId, users.id))
        .where(where)
        .orderBy(desc(revisions.seq))
        .limit(input.limit)
      const nextCursor = items.length === input.limit ? items.at(-1)!.seq : null
      return { items, nextCursor }
    }),
})
```

`apps/server/src/router.ts`: appRouter에 `revision: revisionRouter` 추가.

- [ ] **Step 3: 전체 검증 후 Commit**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm test
pnpm --filter @erdd/server test   # 미설정 — 통합 스킵 확인
pnpm typecheck
```
Expected: 전부 통과(core 42, server 통합 확장, web 8 유지).

```bash
git add apps/server
git commit -m "feat(server): Revision 이력 조회 API — 커서 페이지네이션"
```

---

## 완료 기준 (M3 Definition of Done)

- `DATABASE_URL` 설정 시 전체 테스트 통과: 생성 배치 → DB 왕복 → 동일 모델 복원(`toEqual`), from/before 권위값 재기록, 무결성 위반 400 + 상태 불변, viewer 403 / 외부인 차단, revision 커서 페이지네이션.
- 파이프라인이 단일 트랜잭션(잠금→검증→영속화→Revision)이고, 실패 시 부분 반영이 없다.
- 기존 테스트(core 38→42, web 8) 전부 유지. web typecheck 통과(AppRouter 확장 영향 없음).
