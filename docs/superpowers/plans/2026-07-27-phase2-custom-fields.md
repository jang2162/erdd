# Phase 2 커스텀 항목 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트마다 다른 관리 항목(개인정보여부·암호화방식·비고 등)을 테이블/컬럼에 정의하고 값을 입력하며, 필수 미입력을 경고로 노출한다.

**Architecture:** 정의는 10번째 op 엔티티 `customField`(도메인·단어·용어와 동일 패턴), 값은 `table.custom` / `column.custom` 레코드 필드(`Record<fieldId, string>`). 모든 값은 문자열이고, 미입력(키 없음)은 정의의 `defaultValue`로 라이브 해석한다. 정의에 없는 키가 값에 남아 있어도 무결성 위반이 아니며(관대), 항목 삭제 시 producer가 값까지 한 뮤테이션 안에서 정리한다.

**Tech Stack:** TypeScript, zod(core 스키마), drizzle-orm + PostgreSQL 17(server), React 19 + zustand + TanStack Query + tRPC(web), vitest + @testing-library/react.

**설계 문서:** [docs/superpowers/specs/2026-07-27-phase2-custom-fields-design.md](../specs/2026-07-27-phase2-custom-fields-design.md)

## Global Constraints

- `packages/core`는 IO·런타임 의존성 free(순수 도메인 로직). 새 런타임 의존성 추가 금지.
- 모델 변경은 op 엔진으로만. 클라이언트는 producer + `diffModels` 패턴(`mutate(producer, { summary })`).
- **`ENTITY_KINDS` 순서는 정확성 제약**: `['tableGroup','domain','word','term','customField','table','column','relationship','index','note']`. 참조 대상(부모)이 참조하는 쪽(자식)보다 앞.
- **임시 가드는 반드시 `OpApplyError`로 throw**(plain `Error`면 라우터 catch를 못 타 미제어 500). 도메인·명명 sub-project에서 두 번 재발한 버그.
- 하위호환: 새 컬렉션은 `.default({})`, 새 엔티티 필드는 `.default({})` 또는 `.nullable().default(null)`. `z.infer` 출력 타입은 필수이므로 `: ProjectModel` / `: Table` / `: Column` 리터럴에는 전부 키를 추가한다(typecheck-driven).
- 마이그레이션은 append-only(0006). dev(`erdd`)·test(`erdd_test`) 두 DB 모두 적용.
- **이벤트 값은 producer 진입 전에 캡처**: `const v = e.target.value` 후 producer에 넘긴다. `serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로 lazy read하면 stale 값을 읽는다.
- UI 카피는 한국어.
- 커밋은 **명시 파일만 스테이징**(`git add .` / `git add -A` 금지). `.idea/*`와 루트 `.env`는 절대 커밋하지 않는다.
- 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
  ```
- 테스트 기준선(시작 시점): core 127 · web 126 · server 49(erdd_test) · `pnpm -r typecheck` 0 errors. 각 태스크 종료 시 해당 패키지 스위트가 그린이어야 한다.

## 테스트 실행 명령

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```

단일 파일: `pnpm --filter @erdd/core exec vitest run src/custom-field.test.ts`

## File Structure

**core (`packages/core/src/`)**
| 파일 | 책임 |
|---|---|
| `model.ts` (수정) | `CustomFieldSchema`, `customFields` 컬렉션, `Table.custom`·`Column.custom` |
| `op.ts` (수정) | `ENTITY_KINDS`/`ENTITY_SCHEMAS`/`COLLECTION_BY_KIND`/`applyOps` spread |
| `integrity.ts` (수정) | `IntegrityIssue['entity']` 유니언 + `collections` |
| `diff.ts` (수정) | 빈 `changes` update op 미생성(구 스냅샷 복원 회귀 방지) |
| `custom-field.ts` (신규) | `customFieldsFor` / `resolveCustomValue` / usage 카운트 2종 |
| `warnings.ts` (수정) | `custom-required` 경고 |
| `index.ts` (수정) | 신규 export |
| `testing/fixtures.ts` (수정) | `customFields: {}` + 각 table/column `custom: {}` |

**server (`apps/server/src/`)**
| 파일 | 책임 |
|---|---|
| `db/schema.ts` (수정) | `modelCustomFields` + `model_tables.custom` + `model_columns.custom` |
| `drizzle/0006_*.sql` (신규, drizzle-kit 생성) | 마이그레이션 |
| `services/model-store.ts` (수정) | `TABLE_BY_KIND` + `loadProjectModel` |
| `services/mutation.ts` (수정) | `KIND_LABEL` |
| `testing/helpers.ts` (수정) | `withUuidIds`의 `customFields` + `custom` 키 리매핑 |

**web (`apps/web/src/`)**
| 파일 | 책임 |
|---|---|
| `editor/custom-field-edits.ts` (신규) | producer 5종 |
| `editor/custom-field-panel.tsx` (신규) | 정의 목록·순서·삭제 다이얼로그 |
| `editor/custom-field-edit-dialog.tsx` (신규) | 정의 추가/수정 폼 |
| `editor/custom-fields-section.tsx` (신규) | 값 입력 렌더러(테이블·컬럼 공용) |
| `editor/edit-panel.tsx` (수정) | 값 입력 섹션 배치 |
| `editor/naming-check.tsx` (수정) | 새 경고 라벨 + 화면 표시명 |
| `pages/project.tsx` (수정) | 헤더 진입 버튼 |

---

## Task 1: core 데이터 모델 + op 엔티티 (customField)

**Files:**
- Modify: `packages/core/src/model.ts`
- Modify: `packages/core/src/op.ts`
- Modify: `packages/core/src/integrity.ts`
- Modify: `packages/core/src/diff.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/testing/fixtures.ts`
- Modify: `apps/server/src/services/model-store.ts` (임시 가드 + 컴파일 유지)
- Test: `packages/core/src/model.test.ts`, `packages/core/src/op.test.ts`, `packages/core/src/diff.test.ts`, `apps/server/src/routers/model.test.ts`

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces:
  - `CustomFieldSchema` / `type CustomField = { id: string; name: string; target: 'table' | 'column'; type: 'text' | 'boolean' | 'select'; options: string[]; required: boolean; defaultValue: string | null; order: number }`
  - `ProjectModel.customFields: Record<string, CustomField>`
  - `Table.custom: Record<string, string>`, `Column.custom: Record<string, string>`
  - `EntityKind`에 `'customField'` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 스키마 하위호환**

`packages/core/src/model.test.ts`의 기존 두 테스트를 아래로 **교체**하고 새 테스트 2개를 추가한다(기존 assertion은 `custom`/`customFields`가 늘어나면 깨지므로 함께 고친다).

```ts
import { describe, expect, it } from 'vitest'
import { ColumnSchema, ProjectModelSchema, TableSchema, createEmptyModel } from './model.js'

describe('model schemas', () => {
  it('createEmptyModel returns all ten empty collections', () => {
    expect(createEmptyModel()).toEqual({
      tables: {},
      columns: {},
      relationships: {},
      indexes: {},
      notes: {},
      tableGroups: {},
      domains: {},
      words: {},
      terms: {},
      customFields: {},
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
    expect(TableSchema.parse(table)).toEqual({ ...table, custom: {} })
    expect(() => TableSchema.parse({ ...table, extra: 1 })).toThrow()
  })

  it('TableSchema/ColumnSchema default custom to {} when omitted (구 리비전 하위호환)', () => {
    const legacyTable = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null,
      // custom 의도적으로 생략 — custom 필드가 없던 구 리비전 데이터를 흉내
    }
    expect(TableSchema.parse(legacyTable).custom).toEqual({})

    const legacyColumn = {
      id: 'c1', tableId: 't1', logicalName: '이름', physicalName: 'NAME', type: 'varchar',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
      comment: null,
      // custom·domainId 의도적으로 생략
    }
    expect(ColumnSchema.parse(legacyColumn).custom).toEqual({})
  })

  it('ProjectModelSchema defaults customFields to {} when omitted (구 스냅샷 하위호환)', () => {
    const legacyModel = {
      tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
      tableGroups: {}, domains: {},
      // words/terms/customFields 생략
    }
    const parsed = ProjectModelSchema.parse(legacyModel)
    expect(parsed.customFields).toEqual({})
  })

  it('ColumnSchema rejects a column missing required fields', () => {
    expect(() => ColumnSchema.parse({ id: 'c1', tableId: 't1' })).toThrow()
  })

  it('ColumnSchema defaults domainId to null when omitted (구 리비전 하위호환)', () => {
    const legacyColumn = {
      id: 'c1',
      tableId: 't1',
      logicalName: '이름',
      physicalName: 'NAME',
      type: 'varchar',
      isPk: false,
      autoIncrement: false,
      nullable: true,
      defaultValue: null,
      order: 0,
      comment: null,
      // domainId 의도적으로 생략 — domainId 필드가 없던 구 리비전 데이터를 흉내
    }
    expect(ColumnSchema.parse(legacyColumn).domainId).toBeNull()
  })
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 — op 왕복 + diff 순서 + 빈 changes**

`packages/core/src/op.test.ts`의 마지막 `})` 앞에 추가:

```ts
  it('customField 엔티티를 왕복하고 table/column의 custom 값을 갱신한다', () => {
    const m = createEmptyModel()
    const field = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, order: 0,
    }
    const withField = applyOps(m, [
      { action: 'create', entity: 'customField', entityId: 'f1', data: field },
    ])
    expect(withField.customFields['f1']!.name).toBe('개인정보여부')

    const withTable = applyOps(withField, [
      { action: 'create', entity: 'table', entityId: 't1', data: {
        id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null,
        position: { x: 0, y: 0 }, groupPosition: null, custom: {} } },
      { action: 'create', entity: 'column', entityId: 'c1', data: {
        id: 'c1', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM', type: 'VARCHAR(100)',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
        comment: null, domainId: null, custom: { f1: 'true' } } },
    ])
    expect(withTable.columns['c1']!.custom).toEqual({ f1: 'true' })

    const updated = applyOps(withTable, [
      { action: 'update', entity: 'column', entityId: 'c1',
        changes: { custom: { from: { f1: 'true' }, to: { f1: 'false' } } } },
    ])
    expect(updated.columns['c1']!.custom).toEqual({ f1: 'false' })

    // 정의를 지워도(dangling 키가 남아도) 무결성 위반이 아니다 — 관대 정책
    const dropped = applyOps(updated, [
      { action: 'delete', entity: 'customField', entityId: 'f1', before: field },
    ])
    expect(dropped.customFields['f1']).toBeUndefined()
    expect(dropped.columns['c1']!.custom).toEqual({ f1: 'false' })
  })

  it('customFields 생략된 옛 모델도 파싱된다(.default)', () => {
    const legacy = { ...createEmptyModel() } as Record<string, unknown>
    delete legacy.customFields
    const out = applyOps(legacy as ReturnType<typeof createEmptyModel>, [])
    expect(out.customFields).toEqual({})
  })
```

`packages/core/src/diff.test.ts`의 마지막 `})` 앞에 추가:

```ts
  it('orders customField creates before table/column creates and deletes after them', () => {
    const empty = createEmptyModel()
    const target = buildSampleModel()
    target.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, order: 0,
    }
    target.columns.c1!.custom = { f1: 'true' }

    const createOps = diffModels(empty, target)
    const kinds = createOps.map((o) => `${o.action}:${o.entity}`)
    expect(kinds.indexOf('create:customField')).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf('create:table')).toBeGreaterThan(kinds.indexOf('create:customField'))
    expect(applyOps(empty, createOps)).toEqual(target)

    const deleteOps = diffModels(target, empty)
    const dkinds = deleteOps.map((o) => `${o.action}:${o.entity}`)
    expect(dkinds.lastIndexOf('delete:column')).toBeLessThan(dkinds.indexOf('delete:customField'))
    expect(applyOps(target, deleteOps)).toEqual(empty)
  })

  it('does not emit an update op when the target entity merely lacks a property the base has', () => {
    // 구 스냅샷 복원 회귀 가드: 스냅샷 jsonb의 table에는 custom 키가 없고 현재 모델에는 있다.
    // 이때 changes가 빈 객체인 update op가 나가면 persistOps가 값 없는 UPDATE를 실행해 터진다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    const legacyTable = { ...target.tables.t1! } as Record<string, unknown>
    delete legacyTable.custom
    target.tables.t1 = legacyTable as unknown as typeof base.tables.t1

    const ops = diffModels(base, target)
    expect(ops.filter((o) => o.action === 'update')).toEqual([])
  })
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/model.test.ts src/op.test.ts src/diff.test.ts`
Expected: FAIL — `customFields`/`custom` 미정의, `create:customField` 인덱스 -1, 빈 update op 발생

- [ ] **Step 4: `model.ts`에 스키마를 추가한다**

`packages/core/src/model.ts`:

```ts
export const TableSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  comment: z.string().nullable(),
  groupId: z.string().nullable(),
  position: PositionSchema,
  groupPosition: PositionSchema.nullable(),
  custom: z.record(z.string(), z.string()).default({}),
})
```

`ColumnSchema`에도 마지막 필드로 `custom: z.record(z.string(), z.string()).default({}),`를 추가한다(`domainId` 다음).

`TermSchema` 정의 다음에 추가:

```ts
export const CustomFieldSchema = z.strictObject({
  id: z.string(),
  name: z.string(),                              // "개인정보여부"
  target: z.enum(['table', 'column']),           // 적용 대상
  type: z.enum(['text', 'boolean', 'select']),
  options: z.array(z.string()),                  // select일 때만 사용(그 외 [])
  required: z.boolean(),                         // boolean 타입에는 적용하지 않는다(항상 값이 있음)
  defaultValue: z.string().nullable(),
  order: z.number().int(),                       // 같은 target 안에서의 표시 순서
})
export type CustomField = z.infer<typeof CustomFieldSchema>
```

`ProjectModelSchema`에 `customFields: z.record(z.string(), CustomFieldSchema).default({}),`를 추가하고, `createEmptyModel`의 반환에 `customFields: {}`를 추가한다.

- [ ] **Step 5: `op.ts`에 엔티티를 등록한다**

```ts
import type { z } from 'zod'
import {
  ColumnSchema, CustomFieldSchema, DomainSchema, IndexSchema, NoteSchema, RelationshipSchema,
  TableGroupSchema, TableSchema, TermSchema, WordSchema,
  type ProjectModel,
} from './model.js'
import { validateModelIntegrity } from './integrity.js'

export const ENTITY_KINDS = [
  'tableGroup', 'domain', 'word', 'term', 'customField',
  'table', 'column', 'relationship', 'index', 'note',
] as const
```

`ENTITY_SCHEMAS`에 `customField: CustomFieldSchema,`, `COLLECTION_BY_KIND`에 `customField: 'customFields',`, `applyOps`의 초기 `next`에 `customFields: { ...(model.customFields ?? {}) },`를 추가한다.

> `customField`는 아무것도 참조하지 않고 table/column이 값의 키로 참조하므로 `table` 앞에 둔다. 값은 jsonb 필드라 실제 DB FK는 없지만, 정의가 먼저 생성되고 나중에 삭제되는 순서를 지켜 fork·스냅샷 복원에서 일관성을 유지한다.

- [ ] **Step 6: `integrity.ts`에 컬렉션을 등록한다**

`IntegrityIssue['entity']` 유니언 끝에 `| 'customField'`를 추가하고(리터럴 유니언이므로 문자열로), `collections` 배열에 추가한다:

```ts
    { entity: 'customField', record: model.customFields },
```

**참조 검사는 추가하지 않는다** — 정의에 없는 fieldId가 `custom`에 남아 있어도 위반이 아니다(관대 정책). 렌더·경고·산출물이 정의 목록 기준으로만 읽는다.

- [ ] **Step 7: `diff.ts`에서 빈 changes update를 막는다**

`diffModels`의 update 분기를 수정한다:

```ts
      } else {
        const existing = baseCol[id]!
        if (!deepEqual(existing, entity)) {
          const changes: Record<string, { from: unknown; to: unknown }> = {}
          for (const prop of Object.keys(entity)) {
            if (!deepEqual(existing[prop], entity[prop])) {
              changes[prop] = { from: existing[prop], to: entity[prop] }
            }
          }
          // base에만 있는 속성(구 스냅샷의 table에 custom 키가 없는 경우) 때문에 deepEqual은
          // 다르다고 보지만 target 기준 변경점은 없을 수 있다. 이때 빈 changes를 내보내면
          // persistOps가 값 없는 UPDATE를 실행해 실패한다 → 그런 op는 만들지 않는다.
          if (Object.keys(changes).length > 0) {
            updates.push({ action: 'update', entity: kind, entityId: id, changes })
          }
        }
      }
```

- [ ] **Step 8: `index.ts`에 export를 추가한다**

`model.js` export 블록에 `CustomFieldSchema`를, 타입 export 블록에 `CustomField`를 추가한다:

```ts
export {
  PositionSchema, TableSchema, ColumnSchema, RelationshipSchema,
  IndexSchema, NoteSchema, TableGroupSchema, DomainSchema, WordSchema, TermSchema,
  CustomFieldSchema, ProjectModelSchema, createEmptyModel,
} from './model.js'
export type {
  Position, Table, Column, Relationship, IndexDef, Note, TableGroup, Domain, Word, Term,
  CustomField, ProjectModel,
} from './model.js'
```

- [ ] **Step 9: fixture를 갱신한다**

`packages/core/src/testing/fixtures.ts`: 각 table 리터럴(`t1`, `t2`)에 `custom: {}`를, 각 column 리터럴(`c1`~`c4`)에 `custom: {}`를 추가하고, 반환 객체 끝에 `customFields: {},`를 추가한다. 예:

```ts
      t1: {
        id: 't1', logicalName: '회원등급', physicalName: 'MBR_GRD', comment: null,
        groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: { x: 10, y: 10 }, custom: {},
      },
```

- [ ] **Step 10: 서버 컴파일을 유지하고 임시 가드를 넣는다**

`apps/server/src/services/model-store.ts`는 아직 DB 테이블이 없으므로(Task 3에서 추가) 다음 두 가지만 한다.

`loadProjectModel` 반환에 `customFields: {},`를 추가하고, tables/columns 매핑에 `custom: {}`를 추가한다:

```ts
    tables: keyed(tableRows.map((r): Table => ({
      id: r.id, logicalName: r.logicalName, physicalName: r.physicalName,
      comment: r.comment, groupId: r.groupId, position: r.position,
      groupPosition: r.groupPosition ?? null,
      custom: {}, // Task 3에서 r.custom으로 교체(아직 컬럼 없음)
    }))),
```

columns 매핑도 동일하게 `custom: {},`를 추가한다. `customFields: {},`는 `terms` 다음에 추가한다.

`persistOps` 첫 줄에 임시 가드를 넣는다(`TABLE_BY_KIND`에 `customField` 키가 없어 타입도 통과하지 않으므로 반드시 필요):

```ts
import { OpApplyError, type Op, ... } from '@erdd/core'

export async function persistOps(
  db: DbLike, projectId: string, ops: readonly Op[],
): Promise<void> {
  for (const op of ops) {
    // Task 3에서 model_custom_fields 테이블과 함께 제거되는 임시 가드.
    // plain Error가 아니라 OpApplyError여야 라우터가 400으로 매핑한다(500 방지).
    if (op.entity === 'customField') {
      throw new OpApplyError('커스텀 항목은 아직 저장할 수 없습니다')
    }
    // 유니언 테이블에 대한 캐스트 — ...
```

- [ ] **Step 11: 가드의 400 회귀 테스트를 쓴다**

`apps/server/src/routers/model.test.ts` 상단 import에 `import { uuidv7 } from 'uuidv7'`를 추가하고, 마지막 `})` 앞에 다음을 추가한다(이 파일의 세션 토큰 변수명은 `editorToken`이다):

```ts
  it('rejects a customField op with 400 (임시 가드는 OpApplyError여야 한다)', async () => {
    const fieldId = uuidv7()
    const res = await post(app, 'model.mutate', editorToken, {
      projectId,
      ops: [{
        action: 'create', entity: 'customField', entityId: fieldId,
        data: {
          id: fieldId, name: '개인정보여부', target: 'column', type: 'boolean',
          options: [], required: false, defaultValue: null, order: 0,
        },
      }],
    })
    expect(res.statusCode).toBe(400)
  })
```

> `data.id`는 `entityId`와 같아야 `applyOps`를 통과한다. `applyOps`(core)는 성공하고 `persistOps`의 임시 가드에서 `OpApplyError`가 나야 400이 된다 — plain `Error`면 500이 되어 이 테스트가 실패한다.

- [ ] **Step 12: typecheck 스윕**

Run: `pnpm -r typecheck`
Expected: `custom` / `customFields` 누락으로 다수 에러. 각 에러 지점의 `Table`·`Column` 리터럴에 `custom: {}`를, `ProjectModel` 리터럴에 `customFields: {}`를 추가한다. 예상 파일: `packages/core/src/{ddl,domain-resolve,group,op,relationship,table-index,warnings}.test.ts`, `apps/web/src/editor/{column-edits,dict-edits,domain-edits,edges,ghost-nodes,group-nodes}.test.ts`, `apps/web/src/editor/{group-view,naming-check,table-node,undo-redo}.test.tsx`, `apps/web/src/editor/{model-edits,column-edits}.ts`(`addTable`/`addColumn`의 새 엔티티 리터럴에 `custom: {}`).

`warnings.test.ts`처럼 헬퍼 빌더(`tbl`/`col`)가 있는 파일은 빌더 한 곳만 고치면 된다.

에러가 0이 될 때까지 반복한다.

- [ ] **Step 13: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 PASS(core는 기준선 127 + 신규 5~6건), typecheck 0 errors

- [ ] **Step 14: 커밋**

```bash
git add packages/core/src/model.ts packages/core/src/op.ts packages/core/src/integrity.ts \
  packages/core/src/diff.ts packages/core/src/index.ts packages/core/src/testing/fixtures.ts \
  packages/core/src/model.test.ts packages/core/src/op.test.ts packages/core/src/diff.test.ts \
  apps/server/src/services/model-store.ts apps/server/src/routers/model.test.ts
# Step 12에서 수정한 파일도 함께 명시적으로 add 한다(git status로 확인 후 나열)
git commit -F - <<'EOF'
feat(core): 커스텀 항목 op 엔티티(customField)와 table/column custom 필드 추가

ENTITY_KINDS에 customField를 table 앞에 배치(정의 먼저 생성·나중 삭제).
정의에 없는 fieldId가 custom에 남아도 무결성 위반으로 보지 않는다(관대 정책).
diffModels가 빈 changes update op를 만들지 않도록 수정 — 구 스냅샷(custom 키 없음)
복원 시 값 없는 UPDATE로 터지는 것을 막는다. 서버는 임시 OpApplyError 가드(400).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 2: core 해석 헬퍼 + 필수 경고

**Files:**
- Create: `packages/core/src/custom-field.ts`
- Create: `packages/core/src/custom-field.test.ts`
- Modify: `packages/core/src/warnings.ts`
- Modify: `packages/core/src/warnings.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `CustomField`, `ProjectModel`(Task 1)
- Produces:
  - `customFieldsFor(model: ProjectModel, target: 'table' | 'column'): CustomField[]`
  - `resolveCustomValue(entity: { custom: Record<string, string> }, field: CustomField): string`
  - `customFieldUsageCount(model: ProjectModel, fieldId: string): number`
  - `customOptionUsageCount(model: ProjectModel, fieldId: string, option: string): number`
  - `Warning['kind']`에 `'custom-required'` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 헬퍼**

`packages/core/src/custom-field.test.ts` (신규):

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type CustomField, type ProjectModel } from './model.js'
import {
  customFieldsFor, customFieldUsageCount, customOptionUsageCount, resolveCustomValue,
} from './custom-field.js'

function field(id: string, over: Partial<CustomField> = {}): CustomField {
  return {
    id, name: id, target: 'column', type: 'text', options: [], required: false,
    defaultValue: null, order: 0, ...over,
  }
}
function modelWith(fields: CustomField[]): ProjectModel {
  const m = createEmptyModel()
  for (const f of fields) m.customFields[f.id] = f
  m.tables['T'] = {
    id: 'T', logicalName: 'T', physicalName: 'T', comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['C'] = {
    id: 'C', tableId: 'T', logicalName: 'C', physicalName: 'C', type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
    domainId: null, custom: {},
  }
  return m
}

describe('customFieldsFor', () => {
  it('target으로 거르고 order 오름차순으로 정렬한다', () => {
    const m = modelWith([
      field('b', { order: 2 }),
      field('a', { order: 1 }),
      field('t', { target: 'table', order: 0 }),
    ])
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['a', 'b'])
    expect(customFieldsFor(m, 'table').map((f) => f.id)).toEqual(['t'])
  })

  it('order가 같으면 이름순으로 안정 정렬한다', () => {
    const m = modelWith([field('z', { name: '나', order: 0 }), field('y', { name: '가', order: 0 })])
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['y', 'z'])
  })
})

describe('resolveCustomValue', () => {
  it('입력값 > 기본값 > 빈 문자열 순으로 해석한다', () => {
    const f = field('f', { defaultValue: 'N' })
    expect(resolveCustomValue({ custom: { f: 'Y' } }, f)).toBe('Y')
    expect(resolveCustomValue({ custom: {} }, f)).toBe('N')
    expect(resolveCustomValue({ custom: {} }, field('f'))).toBe('')
  })

  it('빈 문자열은 미입력으로 보고 기본값으로 되돌린다', () => {
    expect(resolveCustomValue({ custom: { f: '' } }, field('f', { defaultValue: 'N' }))).toBe('N')
  })
})

describe('usage counts', () => {
  it('값이 입력된 엔티티 수를 센다(빈 문자열은 제외)', () => {
    const m = modelWith([field('f')])
    expect(customFieldUsageCount(m, 'f')).toBe(0)
    m.columns['C']!.custom = { f: 'Y' }
    expect(customFieldUsageCount(m, 'f')).toBe(1)
    m.columns['C']!.custom = { f: '' }
    expect(customFieldUsageCount(m, 'f')).toBe(0)
  })

  it('target이 table이면 테이블 쪽을 센다', () => {
    const m = modelWith([field('f', { target: 'table' })])
    m.tables['T']!.custom = { f: 'Y' }
    expect(customFieldUsageCount(m, 'f')).toBe(1)
  })

  it('특정 선택지를 값으로 갖는 엔티티 수를 센다', () => {
    const m = modelWith([field('f', { type: 'select', options: ['AES256', 'SHA256'] })])
    m.columns['C']!.custom = { f: 'AES256' }
    expect(customOptionUsageCount(m, 'f', 'AES256')).toBe(1)
    expect(customOptionUsageCount(m, 'f', 'SHA256')).toBe(0)
  })

  it('없는 항목 id는 0을 반환한다', () => {
    const m = modelWith([])
    expect(customFieldUsageCount(m, 'nope')).toBe(0)
    expect(customOptionUsageCount(m, 'nope', 'x')).toBe(0)
  })
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 — 경고**

`packages/core/src/warnings.test.ts`의 마지막 `})` 앞에 추가(파일 상단 import에 `CustomField` 타입을 추가하고, 기존 `tbl`/`col` 빌더는 Task 1 Step 12에서 이미 `custom: {}`를 갖는다):

```ts
  it('필수 커스텀 항목이 비어 있으면 경고한다(rules 없이 호출해도 계산된다)', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME')
    const w = computeWarnings(m).filter((x) => x.kind === 'custom-required')
    expect(w).toHaveLength(1)
    expect(w[0]!.entityId).toBe('A')
    expect(w[0]!.tableId).toBe('T')
    expect(w[0]!.message).toContain('개인정보여부')
  })

  it('값이 있거나 기본값이 있으면 필수 경고를 내지 않는다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0,
    }
    m.customFields['f2'] = {
      id: 'f2', name: '암호화방식', target: 'column', type: 'text',
      options: [], required: true, defaultValue: '없음', order: 1,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { custom: { f1: 'Y' } })
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('boolean 타입은 필수여도 경고하지 않는다(체크박스는 항상 값이 있다)', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME')
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('테이블 대상 필수 항목은 테이블 scope로 경고한다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    const w = computeWarnings(m).filter((x) => x.kind === 'custom-required')
    expect(w).toHaveLength(1)
    expect(w[0]!.scope).toBe('table')
    expect(w[0]!.entityId).toBe('T')
  })
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/custom-field.test.ts src/warnings.test.ts`
Expected: FAIL — `custom-field.js` 모듈 없음, `custom-required` 경고 미발생

- [ ] **Step 4: `custom-field.ts`를 구현한다**

`packages/core/src/custom-field.ts` (신규):

```ts
import type { CustomField, ProjectModel } from './model.js'

/** target에 적용되는 커스텀 항목을 order 오름차순(동률은 이름순)으로 반환한다. */
export function customFieldsFor(model: ProjectModel, target: 'table' | 'column'): CustomField[] {
  return Object.values(model.customFields)
    .filter((f) => f.target === target)
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name))
}

/**
 * 커스텀 항목 값을 해석한다: 입력값 > 정의 기본값 > 빈 문자열.
 * 기본값은 스냅샷이 아니라 라이브 해석이다(도메인과 같은 철학) — 기본값을 고치면
 * 값을 입력하지 않은 엔티티에 즉시 반영된다. 빈 문자열은 미입력으로 본다.
 */
export function resolveCustomValue(
  entity: { custom: Record<string, string> }, field: CustomField,
): string {
  const v = entity.custom[field.id]
  if (v === undefined || v === '') return field.defaultValue ?? ''
  return v
}

function targetEntities(
  model: ProjectModel, target: 'table' | 'column',
): { custom: Record<string, string> }[] {
  return target === 'table' ? Object.values(model.tables) : Object.values(model.columns)
}

/** 값이 실제로 입력된(키가 있고 빈 문자열이 아닌) 테이블 또는 컬럼 수. 항목 삭제 확인 카피용. */
export function customFieldUsageCount(model: ProjectModel, fieldId: string): number {
  const field = model.customFields[fieldId]
  if (!field) return 0
  return targetEntities(model, field.target)
    .filter((e) => (e.custom[fieldId] ?? '') !== '').length
}

/** 그 선택지를 값으로 갖는 테이블 또는 컬럼 수. 선택지 삭제 가드용. */
export function customOptionUsageCount(
  model: ProjectModel, fieldId: string, option: string,
): number {
  const field = model.customFields[fieldId]
  if (!field) return 0
  return targetEntities(model, field.target).filter((e) => e.custom[fieldId] === option).length
}
```

- [ ] **Step 5: `warnings.ts`를 확장한다**

import를 추가한다:

```ts
import { customFieldsFor, resolveCustomValue } from './custom-field.js'
```

`Warning['kind']` 유니언에 `| 'custom-required'`를 추가하고, `computeWarnings`의 `if (rules) { ... }` 블록 **뒤**(즉 `return warnings` 직전)에 다음을 넣는다:

```ts
  // 5) 커스텀 항목 필수 미입력 — 명명 규칙과 무관하므로 rules 게이트 밖에서 계산한다.
  const tableFields = customFieldsFor(model, 'table')
  const columnFields = customFieldsFor(model, 'column')
  const checkRequired = (
    scope: 'table' | 'column', entityId: string, tableId: string | undefined,
    entity: { custom: Record<string, string> }, fields: typeof tableFields,
  ) => {
    for (const field of fields) {
      // boolean은 체크박스라 "미입력"이 없다 → 필수 검사 대상 아님
      if (!field.required || field.type === 'boolean') continue
      if (resolveCustomValue(entity, field) !== '') continue
      warnings.push({
        kind: 'custom-required', scope, entityId, tableId,
        message: `필수 항목 "${field.name}"이(가) 비어 있습니다`,
      })
    }
  }
  if (tableFields.length > 0) {
    for (const t of Object.values(model.tables)) checkRequired('table', t.id, undefined, t, tableFields)
  }
  if (columnFields.length > 0) {
    for (const c of Object.values(model.columns)) checkRequired('column', c.id, c.tableId, c, columnFields)
  }
```

- [ ] **Step 6: `index.ts`에 export를 추가한다**

```ts
export {
  customFieldsFor, resolveCustomValue, customFieldUsageCount, customOptionUsageCount,
} from './custom-field.js'
```

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -r typecheck`
Expected: PASS, typecheck 0 errors

> `naming-check.tsx`의 `KIND_LABEL`은 `Record<Warning['kind'], string>`이라 새 kind 때문에 web typecheck가 깨진다. Task 7에서 정식으로 라벨을 넣지만, typecheck를 그린으로 유지하기 위해 이 태스크에서 `'custom-required': '필수 항목 미입력',` 한 줄을 먼저 추가한다(파일: `apps/web/src/editor/naming-check.tsx`).

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/custom-field.ts packages/core/src/custom-field.test.ts \
  packages/core/src/warnings.ts packages/core/src/warnings.test.ts packages/core/src/index.ts \
  apps/web/src/editor/naming-check.tsx
git commit -F - <<'EOF'
feat(core): 커스텀 항목 해석 헬퍼와 필수 미입력 경고 추가

resolveCustomValue는 입력값 > 정의 기본값 > 빈 문자열 순의 라이브 해석.
custom-required 경고는 명명 규칙과 무관하므로 rules 게이트 밖에서 계산해
computeWarnings(model) 무인자 호출에서도 나온다. boolean 타입은 필수 검사 제외.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 3: server 스키마 + 마이그레이션 0006 + model-store

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/drizzle/0006_*.sql` (drizzle-kit 생성)
- Modify: `apps/server/src/services/model-store.ts`
- Modify: `apps/server/src/services/mutation.ts`
- Modify: `apps/server/src/testing/helpers.ts`
- Test: `apps/server/src/services/model-store.test.ts`, `apps/server/src/routers/snapshot.test.ts`, `apps/server/src/routers/model.test.ts`(Task 1의 임시 가드 테스트 제거)

**Interfaces:**
- Consumes: `CustomField`, `ProjectModel.customFields`, `Table.custom`, `Column.custom`(Task 1)
- Produces: `modelCustomFields` drizzle 테이블, `loadProjectModel`이 `customFields`와 `custom` 값을 실제로 반환, `persistOps`가 `customField` op를 저장

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/services/model-store.test.ts`의 마지막 `})` 앞에 추가(파일 상단 import에 `type CustomField`를 추가):

```ts
  it('persists customField ops and table/column custom values roundtrip', async () => {
    const base = withUuidIds(buildSampleModel())
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), base))

    const fieldId = uuidv7()
    const field: CustomField = {
      id: fieldId, name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: 'N', order: 0,
    }
    const columnId = Object.keys(base.columns)[0]!

    await persistOps(app.db!, projectId, [
      { action: 'create', entity: 'customField', entityId: fieldId, data: field },
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { custom: { from: {}, to: { [fieldId]: 'Y' } } },
      },
    ])
    let loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toEqual(field)
    expect(loaded.columns[columnId]!.custom).toEqual({ [fieldId]: 'Y' })

    const updated: CustomField = { ...field, name: '개인정보', options: ['Y', 'N', 'X'], order: 2 }
    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'customField', entityId: fieldId,
        changes: {
          name: { from: field.name, to: updated.name },
          options: { from: field.options, to: updated.options },
          order: { from: field.order, to: updated.order },
        },
      },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toEqual(updated)

    await persistOps(app.db!, projectId, [
      {
        action: 'update', entity: 'column', entityId: columnId,
        changes: { custom: { from: { [fieldId]: 'Y' }, to: {} } },
      },
      { action: 'delete', entity: 'customField', entityId: fieldId, before: updated },
    ])
    loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.customFields[fieldId]).toBeUndefined()
    expect(loaded.columns[columnId]!.custom).toEqual({})
  })

  it('persists a single batch with customField + table/column custom values (create and delete)', async () => {
    // 스냅샷 복원은 diffModels가 만든 단일 배치를 그대로 persist한다. customField가
    // table/column보다 먼저 생성되고 나중에 삭제되는지 실 DB로 확인하는 회귀 가드.
    const target = buildSampleModel()
    const fieldId = 'cf1'
    target.customFields[fieldId] = {
      id: fieldId, name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, order: 0,
    }
    target.columns.c1!.custom = { [fieldId]: 'true' }
    const full = withUuidIds(target)
    const empty = createEmptyModel()

    const createOps = diffModels(empty, full)
    expect(applyOps(empty, createOps)).toEqual(full)
    await persistOps(app.db!, projectId, createOps)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(full)

    const deleteOps = diffModels(full, empty)
    expect(applyOps(full, deleteOps)).toEqual(empty)
    await persistOps(app.db!, projectId, deleteOps)
    expect(await loadProjectModel(app.db!, projectId)).toEqual(empty)
  })
```

`apps/server/src/routers/snapshot.test.ts`의 마지막 `})` 앞에 추가:

```ts
  it('restores a pre-custom-fields snapshot whose tables have no custom key, without crashing', async () => {
    const target = withUuidIds(buildSampleModel())
    await post(app, 'model.mutate', token, { projectId, ops: diffModels(createEmptyModel(), target) })

    // 커스텀 항목 도입 이전에 저장된 스냅샷 jsonb를 재현: customFields 키가 없고
    // 각 table/column에도 custom 키가 없다. diffModels가 빈 changes update를 내면
    // persistOps가 값 없는 UPDATE로 터진다(Task 1의 diff 수정이 이걸 막는다).
    const legacyModel = JSON.parse(JSON.stringify(target)) as Record<string, unknown>
    delete legacyModel.customFields
    for (const t of Object.values(legacyModel.tables as Record<string, Record<string, unknown>>)) {
      delete t.custom
    }
    for (const c of Object.values(legacyModel.columns as Record<string, Record<string, unknown>>)) {
      delete c.custom
    }

    const snapshotId = uuidv7()
    await app.db!.insert(snapshots).values({
      id: snapshotId, projectId, name: '레거시 스냅샷(커스텀 항목 이전)', description: '',
      revisionSeq: 1, model: legacyModel as unknown as ProjectModel,
    })

    const restored = await post(app, 'snapshot.restore', token, { projectId, snapshotId })
    expect(restored.statusCode).toBe(200)

    const after = (await get(app, 'model.get', token, { projectId })).json().result.data
    expect(after.model.customFields).toEqual({})
    const tableId = Object.keys(target.tables)[0]!
    expect(after.model.tables[tableId].custom).toEqual({})
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run src/services/model-store.test.ts src/routers/snapshot.test.ts`
Expected: FAIL — Task 1의 임시 가드가 `customField` op를 거부

- [ ] **Step 3: 스키마를 추가한다**

`apps/server/src/db/schema.ts`의 `modelTerms` 정의 다음에 추가:

```ts
export const modelCustomFields = pgTable('model_custom_fields', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  target: text('target', { enum: ['table', 'column'] }).notNull(),
  type: text('type', { enum: ['text', 'boolean', 'select'] }).notNull(),
  options: jsonb('options').$type<string[]>().notNull(),
  required: boolean('required').notNull(),
  defaultValue: text('default_value'),
  order: integer('order').notNull(),
})
```

`modelTables`와 `modelColumns`에 각각 마지막 필드로 추가:

```ts
  custom: jsonb('custom').$type<Record<string, string>>().notNull().default({}),
```

- [ ] **Step 4: 마이그레이션을 생성하고 적용한다**

```bash
pnpm --filter @erdd/server exec drizzle-kit generate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd'      pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec drizzle-kit migrate
```
Expected: `apps/server/src/drizzle/0006_*.sql` 생성, 두 DB 모두 적용 성공. 생성된 SQL을 열어 `CREATE TABLE "model_custom_fields"`와 `ALTER TABLE "model_tables" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL`(columns도 동일)이 있는지 확인한다.

- [ ] **Step 5: `model-store.ts`를 배선한다**

Task 1의 임시 가드(`if (op.entity === 'customField') throw ...`)를 **삭제**하고, import·`TABLE_BY_KIND`·`loadProjectModel`을 실제 값으로 바꾼다:

```ts
import {
  type Column, type CustomField, type Domain, type IndexDef, type Note, type Op,
  type ProjectModel, type Relationship, type Table, type TableGroup, type Term, type Word,
} from '@erdd/core'
import {
  modelColumns, modelCustomFields, modelDomains, modelIndexes, modelNotes, modelRelationships,
  modelTableGroups, modelTables, modelTerms, modelWords,
} from '../db/schema.js'

const TABLE_BY_KIND = {
  tableGroup: modelTableGroups,
  table: modelTables,
  column: modelColumns,
  relationship: modelRelationships,
  index: modelIndexes,
  note: modelNotes,
  domain: modelDomains,
  word: modelWords,
  term: modelTerms,
  customField: modelCustomFields,
} as const
```

`loadProjectModel`에 조회를 추가한다:

```ts
  const customFieldRows = await db.select().from(modelCustomFields)
    .where(eq(modelCustomFields.projectId, projectId))
```

반환 객체에서 Task 1의 임시 `custom: {}`를 실제 값으로 바꾸고 `customFields`를 채운다:

```ts
    tables: keyed(tableRows.map((r): Table => ({
      id: r.id, logicalName: r.logicalName, physicalName: r.physicalName,
      comment: r.comment, groupId: r.groupId, position: r.position,
      groupPosition: r.groupPosition ?? null, custom: r.custom ?? {},
    }))),
    columns: keyed(columnRows.map((r): Column => ({
      id: r.id, tableId: r.tableId, logicalName: r.logicalName, physicalName: r.physicalName,
      type: r.type, isPk: r.isPk, autoIncrement: r.autoIncrement, nullable: r.nullable,
      defaultValue: r.defaultValue, order: r.order, comment: r.comment,
      domainId: r.domainId, custom: r.custom ?? {},
    }))),
```

`terms` 다음에 추가:

```ts
    customFields: keyed(customFieldRows.map((r): CustomField => ({
      id: r.id, name: r.name, target: r.target, type: r.type, options: r.options,
      required: r.required, defaultValue: r.defaultValue, order: r.order,
    }))),
```

- [ ] **Step 6: `mutation.ts`의 요약 라벨을 추가한다**

`apps/server/src/services/mutation.ts`의 `KIND_LABEL`:

```ts
const KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계',
  index: '인덱스', note: '메모', tableGroup: '그룹', domain: '도메인',
  word: '단어', term: '용어', customField: '커스텀 항목',
}
```

- [ ] **Step 7: `withUuidIds`를 확장한다**

`apps/server/src/testing/helpers.ts`의 `withUuidIds`에 `custom` 키 리매핑을 추가한다. **`custom`의 키는 fieldId이므로 `customFields`의 새 id와 같은 값으로 매핑돼야 한다**(같은 `nid`를 쓰므로 호출 순서와 무관하게 일치한다).

```ts
  const remapCustom = (custom: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(custom).map(([fieldId, v]) => [nid(fieldId), v]))

  return {
    tableGroups: remapRecord(model.tableGroups, (g) => g),
    tables: remapRecord(model.tables, (t) => ({
      ...t,
      groupId: t.groupId === null ? null : nid(t.groupId),
      custom: remapCustom(t.custom),
    })),
    columns: remapRecord(model.columns, (c) => ({
      ...c,
      tableId: nid(c.tableId),
      domainId: c.domainId === null ? null : nid(c.domainId),
      custom: remapCustom(c.custom),
    })),
    // ... 나머지 동일 ...
    customFields: remapRecord(model.customFields, (f) => f),
  }
```

- [ ] **Step 8: Task 1의 임시 가드 테스트를 제거한다**

`apps/server/src/routers/model.test.ts`에서 Task 1 Step 11에 추가한 `rejects a customField op with 400 (임시 가드는 OpApplyError여야 한다)` 테스트를 삭제한다(가드가 없어졌으므로 더 이상 400이 아니다).

- [ ] **Step 9: 테스트가 통과하는지 확인한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: PASS(기준선 49 + 신규 3건), typecheck 0 errors

- [ ] **Step 10: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/src/drizzle \
  apps/server/src/services/model-store.ts apps/server/src/services/mutation.ts \
  apps/server/src/testing/helpers.ts apps/server/src/services/model-store.test.ts \
  apps/server/src/routers/snapshot.test.ts apps/server/src/routers/model.test.ts
git commit -F - <<'EOF'
feat(server): model_custom_fields·table/column custom 컬럼·마이그0006

model-store에 customField 배선(임시 가드 제거), 요약 라벨 추가,
withUuidIds가 customFields와 custom의 fieldId 키를 함께 리매핑.
커스텀 항목 이전 스냅샷(custom 키 없음) 복원 회귀 테스트 추가.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 4: web producer (`custom-field-edits.ts`)

**Files:**
- Create: `apps/web/src/editor/custom-field-edits.ts`
- Create: `apps/web/src/editor/custom-field-edits.test.ts`

**Interfaces:**
- Consumes: `customFieldsFor`, `CustomField`, `ProjectModel`(Task 1·2)
- Produces:
  - `createCustomField(model: ProjectModel, field: Omit<CustomField, 'order'>): ProjectModel`
  - `updateCustomField(model: ProjectModel, id: string, patch: Partial<Omit<CustomField, 'id' | 'type' | 'target' | 'order'>>): ProjectModel`
  - `moveCustomField(model: ProjectModel, id: string, dir: -1 | 1): ProjectModel`
  - `removeCustomField(model: ProjectModel, id: string): ProjectModel`
  - `setCustomValue(model: ProjectModel, target: 'table' | 'column', entityId: string, fieldId: string, value: string): ProjectModel`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/custom-field-edits.test.ts` (신규):

```ts
import { describe, expect, it } from 'vitest'
import { customFieldsFor, type CustomField, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import {
  createCustomField, moveCustomField, removeCustomField, setCustomValue, updateCustomField,
} from './custom-field-edits.js'

function newField(id: string, over: Partial<CustomField> = {}): Omit<CustomField, 'order'> {
  const { order: _order, ...rest } = {
    id, name: id, target: 'column' as const, type: 'text' as const, options: [] as string[],
    required: false, defaultValue: null, order: 0, ...over,
  }
  return rest
}
function withFields(): ProjectModel {
  let m = buildSampleModel()
  m = createCustomField(m, newField('f1', { name: '개인정보여부' }))
  m = createCustomField(m, newField('f2', { name: '암호화방식' }))
  m = createCustomField(m, newField('t1f', { name: '업무구분', target: 'table' }))
  return m
}

describe('createCustomField', () => {
  it('같은 target 안에서 order를 최대+1로 부여한다', () => {
    const m = withFields()
    expect(customFieldsFor(m, 'column').map((f) => [f.id, f.order])).toEqual([['f1', 0], ['f2', 1]])
    expect(customFieldsFor(m, 'table').map((f) => [f.id, f.order])).toEqual([['t1f', 0]])
  })
})

describe('updateCustomField', () => {
  it('이름·필수·기본값·선택지를 갱신한다', () => {
    const m = updateCustomField(withFields(), 'f1', {
      name: '개인정보', required: true, defaultValue: 'N', options: ['Y', 'N'],
    })
    expect(m.customFields['f1']).toMatchObject({
      name: '개인정보', required: true, defaultValue: 'N', options: ['Y', 'N'], target: 'column',
    })
  })

  it('없는 id는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(updateCustomField(m, 'nope', { name: 'x' })).toBe(m)
  })
})

describe('moveCustomField', () => {
  it('같은 target 안에서 인접 항목과 order를 교환한다', () => {
    const m = moveCustomField(withFields(), 'f2', -1)
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['f2', 'f1'])
  })

  it('다른 target의 항목 순서는 건드리지 않는다', () => {
    const m = moveCustomField(withFields(), 'f2', -1)
    expect(m.customFields['t1f']!.order).toBe(0)
  })

  it('경계를 넘으면 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(moveCustomField(m, 'f1', -1)).toBe(m)
    expect(moveCustomField(m, 'f2', 1)).toBe(m)
  })
})

describe('setCustomValue', () => {
  it('컬럼 값을 설정하고 빈 문자열이면 키를 지운다', () => {
    let m = setCustomValue(withFields(), 'column', 'c1', 'f1', 'Y')
    expect(m.columns['c1']!.custom).toEqual({ f1: 'Y' })
    m = setCustomValue(m, 'column', 'c1', 'f1', '')
    expect(m.columns['c1']!.custom).toEqual({})
  })

  it('테이블 값도 같은 방식으로 다룬다', () => {
    const m = setCustomValue(withFields(), 'table', 't1', 't1f', '공통')
    expect(m.tables['t1']!.custom).toEqual({ t1f: '공통' })
  })

  it('없는 엔티티는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(setCustomValue(m, 'column', 'nope', 'f1', 'Y')).toBe(m)
  })
})

describe('removeCustomField', () => {
  it('정의와 함께 모든 테이블·컬럼의 값을 제거한다', () => {
    let m = withFields()
    m = setCustomValue(m, 'column', 'c1', 'f1', 'Y')
    m = setCustomValue(m, 'column', 'c2', 'f1', 'N')
    m = setCustomValue(m, 'column', 'c2', 'f2', 'AES256')
    m = removeCustomField(m, 'f1')

    expect(m.customFields['f1']).toBeUndefined()
    expect(m.columns['c1']!.custom).toEqual({})
    expect(m.columns['c2']!.custom).toEqual({ f2: 'AES256' })
  })

  it('테이블 대상 항목이면 테이블 값도 제거한다', () => {
    let m = withFields()
    m = setCustomValue(m, 'table', 't1', 't1f', '공통')
    m = removeCustomField(m, 't1f')
    expect(m.tables['t1']!.custom).toEqual({})
  })

  it('없는 id는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(removeCustomField(m, 'nope')).toBe(m)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/custom-field-edits.test.ts`
Expected: FAIL — `custom-field-edits.js` 모듈 없음

- [ ] **Step 3: producer를 구현한다**

`apps/web/src/editor/custom-field-edits.ts` (신규):

```ts
import { customFieldsFor, type CustomField, type ProjectModel } from '@erdd/core'

/** 같은 target 안에서 마지막 순서로 추가한다(order = 최대+1). */
export function createCustomField(
  model: ProjectModel, field: Omit<CustomField, 'order'>,
): ProjectModel {
  const siblings = customFieldsFor(model, field.target)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((f) => f.order)) + 1
  const next: CustomField = { ...field, order }
  return { ...model, customFields: { ...model.customFields, [next.id]: next } }
}

/** 타입·대상·순서는 여기서 바꾸지 않는다(타입/대상은 변경 불허, 순서는 moveCustomField). */
export function updateCustomField(
  model: ProjectModel, id: string,
  patch: Partial<Omit<CustomField, 'id' | 'type' | 'target' | 'order'>>,
): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  return { ...model, customFields: { ...model.customFields, [id]: { ...cur, ...patch } } }
}

/** 같은 target 안에서 인접 항목과 order를 교환한다. dir: -1 위로, +1 아래로. */
export function moveCustomField(model: ProjectModel, id: string, dir: -1 | 1): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  const siblings = customFieldsFor(model, cur.target)
  const idx = siblings.findIndex((f) => f.id === id)
  const neighbor = siblings[idx + dir]
  if (!neighbor) return model
  return {
    ...model,
    customFields: {
      ...model.customFields,
      [cur.id]: { ...cur, order: neighbor.order },
      [neighbor.id]: { ...neighbor, order: cur.order },
    },
  }
}

/**
 * 정의 삭제 + 모든 테이블·컬럼의 해당 값 제거를 한 producer 안에서 수행한다.
 * 단일 뮤테이션 = Revision 1건이라 실행 취소 한 번으로 값까지 되살아난다.
 */
export function removeCustomField(model: ProjectModel, id: string): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  const nextFields = { ...model.customFields }
  delete nextFields[id]

  const strip = <T extends { custom: Record<string, string> }>(
    rec: Record<string, T>,
  ): Record<string, T> => {
    let changed = false
    const out: Record<string, T> = {}
    for (const [key, entity] of Object.entries(rec)) {
      if (Object.hasOwn(entity.custom, id)) {
        const custom = { ...entity.custom }
        delete custom[id]
        out[key] = { ...entity, custom }
        changed = true
      } else {
        out[key] = entity
      }
    }
    return changed ? out : rec
  }

  return {
    ...model,
    customFields: nextFields,
    tables: cur.target === 'table' ? strip(model.tables) : model.tables,
    columns: cur.target === 'column' ? strip(model.columns) : model.columns,
  }
}

/** 값 설정. 빈 문자열이면 키를 지워 "미입력"으로 되돌린다(정의 기본값 해석이 다시 적용됨). */
export function setCustomValue(
  model: ProjectModel, target: 'table' | 'column', entityId: string,
  fieldId: string, value: string,
): ProjectModel {
  const patched = (custom: Record<string, string>): Record<string, string> => {
    const next = { ...custom }
    if (value === '') delete next[fieldId]
    else next[fieldId] = value
    return next
  }
  if (target === 'table') {
    const t = model.tables[entityId]
    if (!t) return model
    return { ...model, tables: { ...model.tables, [entityId]: { ...t, custom: patched(t.custom) } } }
  }
  const c = model.columns[entityId]
  if (!c) return model
  return { ...model, columns: { ...model.columns, [entityId]: { ...c, custom: patched(c.custom) } } }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/custom-field-edits.test.ts && pnpm -r typecheck`
Expected: PASS(13건), typecheck 0 errors

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/custom-field-edits.ts apps/web/src/editor/custom-field-edits.test.ts
git commit -F - <<'EOF'
feat(web): 커스텀 항목 producer(정의 CRUD·순서·값 설정) 추가

removeCustomField는 정의 삭제와 전 테이블·컬럼 값 정리를 한 producer에서 수행해
Revision 1건·실행 취소 1회로 되돌아간다. setCustomValue는 빈 문자열이면 키를 지워
미입력(기본값 해석) 상태로 되돌린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 5: web 정의 관리 화면

**Files:**
- Create: `apps/web/src/editor/custom-field-panel.tsx`
- Create: `apps/web/src/editor/custom-field-edit-dialog.tsx`
- Create: `apps/web/src/editor/custom-field-panel.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: producer 5종(Task 4), `customFieldsFor`/`customFieldUsageCount`/`customOptionUsageCount`(Task 2), `useEditorStore`, `useModelMutation`, `newId`
- Produces: `<CustomFieldPanel projectId={string} />`(헤더 버튼 + 다이얼로그), `<CustomFieldEditDialog projectId field open onOpenChange />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/custom-field-panel.test.tsx` (신규):

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createCustomField, setCustomValue } from './custom-field-edits.js'
import { CustomFieldPanel } from './custom-field-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<CustomFieldPanel projectId={PROJECT_ID} />, { wrapper: w })
}

function loadModelWithFields() {
  let m = buildSampleModel()
  m = createCustomField(m, {
    id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
    options: ['Y', 'N'], required: true, defaultValue: null,
  })
  m = createCustomField(m, {
    id: 'f2', name: '암호화방식', target: 'column', type: 'text',
    options: [], required: false, defaultValue: null,
  })
  m = createCustomField(m, {
    id: 'f3', name: '업무구분', target: 'table', type: 'text',
    options: [], required: false, defaultValue: null,
  })
  m = setCustomValue(m, 'column', 'c1', 'f1', 'Y')
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('CustomFieldPanel', () => {
  it('대상별로 항목을 나눠 보여주고 사용 건수를 표시한다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    expect(screen.getByText('개인정보여부')).toBeInTheDocument()
    expect(screen.getByText('암호화방식')).toBeInTheDocument()
    expect(screen.getByText('업무구분')).toBeInTheDocument()
    expect(screen.getByText('값 1건')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '항목 추가' })).toBeInTheDocument()
  })

  it('첫 항목의 위로 버튼과 마지막 항목의 아래로 버튼이 비활성이다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    expect(screen.getByRole('button', { name: '개인정보여부 위로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '암호화방식 아래로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '암호화방식 위로' })).toBeEnabled()
  })

  it('순서 이동 버튼이 모델의 order를 바꾼다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    await userEvent.click(screen.getByRole('button', { name: '암호화방식 위로' }))
    const m = useEditorStore.getState().model
    expect(m.customFields['f2']!.order).toBeLessThan(m.customFields['f1']!.order)
  })
})
```

`custom-field-edit-dialog.tsx`의 타입 잠금은 다음 테스트로 확인한다(같은 파일 하단에 추가):

```tsx
import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'

function renderDialog(field: Parameters<typeof CustomFieldEditDialog>[0]['field']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(
    <CustomFieldEditDialog projectId={PROJECT_ID} field={field} open onOpenChange={() => {}} />,
    { wrapper: w },
  )
}

describe('CustomFieldEditDialog', () => {
  it('수정 모드에서는 타입·대상 선택이 잠긴다', () => {
    loadModelWithFields()
    renderDialog(useEditorStore.getState().model.customFields['f1']!)
    expect(screen.getByLabelText('타입')).toBeDisabled()
    expect(screen.getByLabelText('적용 대상')).toBeDisabled()
  })

  it('추가 모드에서는 타입·대상을 고를 수 있고 boolean이면 필수가 잠긴다', async () => {
    loadModelWithFields()
    renderDialog(null)
    expect(screen.getByLabelText('타입')).toBeEnabled()
    expect(screen.getByLabelText('필수')).toBeEnabled()
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'boolean')
    expect(screen.getByLabelText('필수')).toBeDisabled()
  })

  it('추가 모드에서 저장하면 모델에 항목이 생긴다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '보존기간')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const names = Object.values(useEditorStore.getState().model.customFields).map((f) => f.name)
    expect(names).toContain('보존기간')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/custom-field-panel.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 편집 다이얼로그를 구현한다**

`apps/web/src/editor/custom-field-edit-dialog.tsx` (신규):

```tsx
import { useState } from 'react'
import { customFieldUsageCount, customOptionUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { createCustomField, updateCustomField } from './custom-field-edits.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const TARGET_LABEL = { table: '테이블', column: '컬럼' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

/**
 * "커스텀 항목" 패널의 추가/수정 폼.
 * 타입·대상은 생성 시에만 고를 수 있다(변경 불허 — 삭제 후 재생성).
 * 불리언은 체크박스라 "미입력"이 없으므로 필수 옵션을 잠근다.
 * 모든 입력은 컨트롤드 state로 즉시 캡처되고, 저장 시 그 state에서 뽑은 const만 producer에 넘긴다.
 */
export function CustomFieldEditDialog({
  projectId, field, open, onOpenChange,
}: {
  projectId: string
  field: CustomField | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)

  const [name, setName] = useState(field?.name ?? '')
  const [target, setTarget] = useState<CustomField['target']>(field?.target ?? 'column')
  const [type, setType] = useState<CustomField['type']>(field?.type ?? 'text')
  const [required, setRequired] = useState(field?.required ?? false)
  const [defaultValue, setDefaultValue] = useState(field?.defaultValue ?? '')
  const [optionsText, setOptionsText] = useState(field?.options.join(', ') ?? '')

  const isEdit = field !== null
  const nameInvalid = name.trim() === ''
  const requiredLocked = type === 'boolean'

  const onSave = () => {
    const trimmedName = name.trim()
    if (trimmedName === '') return
    const nextOptions = type === 'select'
      ? optionsText.split(',').map((v) => v.trim()).filter((v) => v !== '')
      : []
    const trimmedDefault = defaultValue.trim()
    const nextRequired = requiredLocked ? false : required

    if (!isEdit) {
      const id = newId()
      void mutate((m) => createCustomField(m, {
        id,
        name: trimmedName,
        target,
        type,
        options: nextOptions,
        required: nextRequired,
        defaultValue: trimmedDefault === '' ? null : trimmedDefault,
      }), { summary: '커스텀 항목 추가' })
      onOpenChange(false)
      return
    }

    // 선택지를 지우면 그 값을 쓰던 엔티티가 생긴다 — 값은 유지되지만 사용자에게 알린다.
    const fieldId = field.id
    const removed = field.options.filter((o) => !nextOptions.includes(o))
    const affected = removed.reduce((sum, o) => sum + customOptionUsageCount(model, fieldId, o), 0)
    if (affected > 0
      && !window.confirm(`삭제하는 선택지를 ${affected}곳에서 사용 중입니다. 값은 유지됩니다. 계속할까요?`)) {
      return
    }
    void mutate((m) => updateCustomField(m, fieldId, {
      name: trimmedName,
      options: nextOptions,
      required: nextRequired,
      defaultValue: trimmedDefault === '' ? null : trimmedDefault,
    }), { summary: '커스텀 항목 수정' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '커스텀 항목 수정' : '커스텀 항목 추가'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-name">이름</Label>
            <Input id="cf-name" value={name} placeholder="예: 개인정보여부"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-target">적용 대상</Label>
              <select id="cf-target" disabled={isEdit} value={target}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                onChange={(e) => setTarget(e.target.value as CustomField['target'])}>
                {(['table', 'column'] as const).map((t) => (
                  <option key={t} value={t}>{TARGET_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-type">타입</Label>
              <select id="cf-type" disabled={isEdit} value={type}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                onChange={(e) => setType(e.target.value as CustomField['type'])}>
                {(['text', 'boolean', 'select'] as const).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              타입과 적용 대상은 변경할 수 없습니다. 바꾸려면 삭제 후 다시 만드세요.
            </p>
          )}
          {type === 'select' && (
            <div className="grid gap-1.5">
              <Label htmlFor="cf-options">선택지 (쉼표로 구분)</Label>
              <Input id="cf-options" value={optionsText} placeholder="예: 없음, AES256, SHA256"
                onChange={(e) => setOptionsText(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="cf-default">기본값</Label>
            <Input id="cf-default" value={defaultValue}
              placeholder={type === 'boolean' ? 'true 또는 false' : '값을 입력하지 않은 항목에 쓰입니다'}
              onChange={(e) => setDefaultValue(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input id="cf-required" type="checkbox" aria-label="필수"
              checked={required && !requiredLocked} disabled={requiredLocked}
              onChange={(e) => setRequired(e.target.checked)} />
            필수 (미입력 시 경고)
          </label>
          {requiredLocked && (
            <p className="text-xs text-muted-foreground">
              불리언은 항상 값이 있으므로 필수로 지정할 수 없습니다.
            </p>
          )}
          {isEdit && customFieldUsageCount(model, field.id) > 0 && (
            <p className="text-xs text-muted-foreground">
              현재 {customFieldUsageCount(model, field.id)}곳에서 값을 사용 중입니다.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={nameInvalid} onClick={onSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: 목록 패널을 구현한다**

`apps/web/src/editor/custom-field-panel.tsx` (신규):

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { customFieldsFor, customFieldUsageCount, type CustomField } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { moveCustomField, removeCustomField } from './custom-field-edits.js'
import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

const TARGET_TITLE = { table: '테이블 항목', column: '컬럼 항목' } as const
const TYPE_LABEL = { text: '텍스트', boolean: '불리언', select: '선택형' } as const

/** 헤더의 "커스텀 항목": 테이블/컬럼에 붙는 조직·프로젝트 고유 메타 항목의 정의를 관리한다. */
export function CustomFieldPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const onAdd = () => { setEditing(null); setEditorOpen(true) }
  const onEdit = (f: CustomField) => { setEditing(f); setEditorOpen(true) }
  const onMove = (id: string, dir: -1 | 1) => {
    void mutate((m) => moveCustomField(m, id, dir), { summary: '커스텀 항목 순서 변경' })
  }
  const onRemove = (f: CustomField) => {
    const used = customFieldUsageCount(model, f.id)
    const message = used > 0
      ? `"${f.name}"을(를) 삭제하면 입력된 값 ${used}건도 함께 삭제됩니다. 계속할까요?`
      : `"${f.name}"을(를) 삭제할까요?`
    if (!window.confirm(message)) return
    const fieldId = f.id
    void mutate((m) => removeCustomField(m, fieldId), { summary: '커스텀 항목 삭제' })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm"><ListPlus /> 커스텀 항목</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>커스텀 항목</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              테이블·컬럼에 프로젝트 고유의 관리 항목을 정의합니다
            </p>
            <Button size="sm" onClick={onAdd}><Plus /> 항목 추가</Button>
          </div>
          <div className="grid max-h-96 gap-4 overflow-y-auto">
            {(['table', 'column'] as const).map((target) => {
              const fields = customFieldsFor(model, target)
              return (
                <div key={target} className="grid gap-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">
                    {TARGET_TITLE[target]}
                  </h4>
                  {fields.length === 0 && (
                    <p className="text-sm text-muted-foreground">아직 항목이 없습니다</p>
                  )}
                  <ul className="grid gap-2">
                    {fields.map((f, i) => {
                      const used = customFieldUsageCount(model, f.id)
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
                              <span className="mr-1 text-xs text-muted-foreground">값 {used}건</span>
                            )}
                            <Button size="icon" variant="ghost" className="size-7"
                              aria-label={`${f.name} 위로`} disabled={i === 0}
                              onClick={() => onMove(f.id, -1)}>
                              <ChevronUp className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7"
                              aria-label={`${f.name} 아래로`} disabled={i === fields.length - 1}
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
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
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

- [ ] **Step 5: 헤더에 진입 버튼을 붙인다**

`apps/web/src/pages/project.tsx`:

```tsx
import { CustomFieldPanel } from '@/editor/custom-field-panel'
```

```tsx
            {loaded && <DictPanel projectId={projectId} />}
            {loaded && <CustomFieldPanel projectId={projectId} />}
            {loaded && <NamingCheck projectId={projectId} />}
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/custom-field-panel.test.tsx && pnpm -r typecheck`
Expected: PASS(6건), typecheck 0 errors

> `window.confirm`은 jsdom에서 정의돼 있지 않을 수 있다. 삭제 흐름을 테스트에 넣지 않았으므로 문제되지 않지만, 추가한다면 `vi.spyOn(window, 'confirm').mockReturnValue(true)`로 스텁한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-edit-dialog.tsx \
  apps/web/src/editor/custom-field-panel.test.tsx apps/web/src/pages/project.tsx
git commit -F - <<'EOF'
feat(web): 커스텀 항목 정의 관리 화면(목록·순서·추가/수정·삭제) 추가

타입·적용 대상은 생성 시에만 선택 가능(수정 시 잠금), 불리언은 필수 옵션 잠금.
삭제는 입력된 값 건수를 알리고 확인 후 진행하며, 선택지를 줄이면 사용 건수를 경고한다.
헤더에 진입 버튼 추가(도메인·사전 다음).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 6: web 값 입력 (편집 패널 통합)

**Files:**
- Create: `apps/web/src/editor/custom-fields-section.tsx`
- Create: `apps/web/src/editor/custom-fields-section.test.tsx`
- Modify: `apps/web/src/editor/edit-panel.tsx`
- Modify: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: `customFieldsFor`/`resolveCustomValue`(Task 2), `setCustomValue`(Task 4), `Warning`
- Produces: `<CustomFieldsSection fields={CustomField[]} values={Record<string,string>} idPrefix={string} warnings={Warning[]} onChange={(fieldId: string, value: string) => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/custom-fields-section.test.tsx` (신규):

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CustomField } from '@erdd/core'
import { CustomFieldsSection } from './custom-fields-section.js'

function field(id: string, over: Partial<CustomField> = {}): CustomField {
  return {
    id, name: id, target: 'column', type: 'text', options: [], required: false,
    defaultValue: null, order: 0, ...over,
  }
}

afterEach(cleanup)

describe('CustomFieldsSection', () => {
  it('정의가 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <CustomFieldsSection fields={[]} values={{}} idPrefix="x" warnings={[]} onChange={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('텍스트 항목은 blur 시 값을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '비고' })]} values={{}} idPrefix="x"
        warnings={[]} onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('비고'), '메모')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('f1', '메모')
  })

  it('불리언 항목은 체크 시 true/false 문자열을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '개인정보여부', type: 'boolean' })]} values={{}}
        idPrefix="x" warnings={[]} onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByLabelText('개인정보여부'))
    expect(onChange).toHaveBeenCalledWith('f1', 'true')
  })

  it('선택형 항목은 선택지를 보여주고 선택 시 값을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '암호화방식', type: 'select', options: ['없음', 'AES256'] })]}
        values={{}} idPrefix="x" warnings={[]} onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('암호화방식'), 'AES256')
    expect(onChange).toHaveBeenCalledWith('f1', 'AES256')
  })

  it('미입력이면 정의 기본값을 표시한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '비고', defaultValue: '해당없음' })]} values={{}}
        idPrefix="x" warnings={[]} onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('비고')).toHaveValue('해당없음')
  })

  it('선택지에 없는 기존 값도 비활성 옵션으로 남겨 값이 사라지지 않게 한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '암호화방식', type: 'select', options: ['없음', 'AES256'] })]}
        values={{ f1: 'SHA256' }} idPrefix="x" warnings={[]} onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('암호화방식')).toHaveValue('SHA256')
    expect(screen.getByRole('option', { name: /SHA256/ })).toBeDisabled()
  })

  it('필수 미입력 경고가 있으면 항목 옆에 표시한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '개인정보여부', required: true })]} values={{}} idPrefix="x"
        warnings={[{
          kind: 'custom-required', scope: 'column', entityId: 'c1',
          message: '필수 항목 "개인정보여부"이(가) 비어 있습니다',
        }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('필수')).toBeInTheDocument()
  })
})
```

`apps/web/src/editor/edit-panel.test.tsx` 상단 import에 `import { createCustomField } from './custom-field-edits.js'`를 추가하고, 마지막 `})` 앞에 통합 테스트 2건을 추가한다(이 파일의 기존 헬퍼 `renderPanel()`·`mockTrpcFetch`를 그대로 쓴다. `t1`은 컬럼 `c1` 하나뿐이라 `getByLabelText`가 유일하게 매치된다):

```tsx
  it('컬럼 커스텀 항목 체크박스가 모델의 custom 값을 바꾼다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    await userEvent.click(screen.getByLabelText('개인정보여부'))
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.custom).toEqual({ cf1: 'true' })
    })
  })

  it('테이블 대상 커스텀 항목은 테이블 영역에 기본값과 함께 렌더된다', () => {
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf2', name: '업무구분', target: 'table', type: 'text',
      options: [], required: false, defaultValue: '공통',
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    renderPanel()
    // 미입력이므로 정의 기본값이 라이브 해석돼 보인다
    expect(screen.getByLabelText('업무구분')).toHaveValue('공통')
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/custom-fields-section.test.tsx src/editor/edit-panel.test.tsx`
Expected: FAIL — 모듈 없음 / 커스텀 항목 미렌더

- [ ] **Step 3: 값 입력 렌더러를 구현한다**

`apps/web/src/editor/custom-fields-section.tsx` (신규):

```tsx
import { resolveCustomValue, type CustomField, type Warning } from '@erdd/core'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 커스텀 항목 값 입력. 테이블 영역과 컬럼 행에서 함께 쓴다.
 * 미입력(키 없음)은 정의 기본값으로 해석해 보여주고, 값 커밋은 항상 문자열이다
 * (불리언은 'true'/'false'). 빈 문자열을 커밋하면 호출부가 키를 지워 미입력으로 되돌린다.
 */
export function CustomFieldsSection(props: {
  fields: CustomField[]
  values: Record<string, string>
  idPrefix: string
  warnings: Warning[]
  onChange: (fieldId: string, value: string) => void
}) {
  if (props.fields.length === 0) return null
  const entity = { custom: props.values }
  const hasRequiredWarning = props.warnings.some((w) => w.kind === 'custom-required')

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">커스텀 항목</span>
        {hasRequiredWarning && (
          <span className="rounded bg-key/15 px-1 text-[10px] font-medium text-key">필수</span>
        )}
      </div>
      {props.fields.map((f) => {
        const id = `${props.idPrefix}-${f.id}`
        const value = resolveCustomValue(entity, f)
        if (f.type === 'boolean') {
          return (
            <label key={f.id} className="flex items-center gap-2 text-sm">
              <input
                id={id} type="checkbox" aria-label={f.name} checked={value === 'true'}
                onChange={(e) => {
                  const next = e.target.checked ? 'true' : 'false'
                  props.onChange(f.id, next)
                }}
              />
              {f.name}
            </label>
          )
        }
        if (f.type === 'select') {
          // 정의에서 사라진 선택지를 값으로 갖고 있으면 비활성 옵션으로 남겨 값 유실을 막는다
          const orphan = value !== '' && !f.options.includes(value)
          return (
            <div key={f.id} className="grid gap-1.5">
              <Label htmlFor={id}>{f.name}{f.required && <span className="text-destructive"> *</span>}</Label>
              <select
                id={id} aria-label={f.name} value={value}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                onChange={(e) => {
                  const next = e.target.value
                  props.onChange(f.id, next)
                }}
              >
                <option value="">선택 안 함</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                {orphan && <option value={value} disabled>{value} (삭제된 선택지)</option>}
              </select>
            </div>
          )
        }
        return (
          <div key={f.id} className="grid gap-1.5">
            <Label htmlFor={id}>{f.name}{f.required && <span className="text-destructive"> *</span>}</Label>
            <Input
              id={id} aria-label={f.name} defaultValue={value} key={value}
              onBlur={(e) => {
                const next = e.target.value
                if (next !== value) props.onChange(f.id, next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: `edit-panel.tsx`에 통합한다**

import를 추가한다:

```ts
import { customFieldsFor } from '@erdd/core'
import { setCustomValue } from './custom-field-edits.js'
import { CustomFieldsSection } from './custom-fields-section.js'
```

`EditPanel` 안, `warnings` useMemo 다음에 추가한다:

```ts
  const tableFields = useMemo(() => customFieldsFor(model, 'table'), [model])
  const columnFields = useMemo(() => customFieldsFor(model, 'column'), [model])
```

테이블 필드 블록(“소속 그룹” `</div>` 다음, 바깥 `</div>` 앞)에 추가한다:

```tsx
        <CustomFieldsSection
          fields={tableFields} values={table.custom} idPrefix={`tbl-custom-${tid}`}
          warnings={warnings.filter((w) => w.scope === 'table' && w.entityId === tid)}
          onChange={(fieldId, value) => {
            void mutate((m) => setCustomValue(m, 'table', tid, fieldId, value),
              { summary: '커스텀 항목 값 변경' })
          }}
        />
```

`ColumnRow` 호출부에 prop을 넘긴다:

```tsx
            customFields={columnFields}
            onCustomChange={(fieldId, value) => {
              void mutate((m) => setCustomValue(m, 'column', c.id, fieldId, value),
                { summary: '커스텀 항목 값 변경' })
            }}
```

`ColumnRow`의 props 타입에 추가한다:

```ts
  customFields: CustomField[]
  onCustomChange: (fieldId: string, value: string) => void
```

(`import { ..., type CustomField, ... } from '@erdd/core'`도 추가)

`ColumnRow` 본문의 마지막 `</li>` 바로 앞(PK/NN 줄 다음)에 추가한다:

```tsx
      <CustomFieldsSection
        fields={props.customFields} values={c.custom} idPrefix={`col-custom-${c.id}`}
        warnings={props.warnings.filter((w) => w.kind === 'custom-required')}
        onChange={props.onCustomChange}
      />
```

> `onChange` 콜백은 이미 값이 인자로 넘어오므로 producer 진입 전 캡처 규칙을 자동으로 만족한다 — producer 클로저 안에서 이벤트를 다시 읽지 않는다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run && pnpm -r typecheck`
Expected: PASS, typecheck 0 errors

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/custom-fields-section.tsx apps/web/src/editor/custom-fields-section.test.tsx \
  apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx
git commit -F - <<'EOF'
feat(web): 편집 패널에 커스텀 항목 값 입력 인라인 통합

텍스트/불리언/선택형 렌더러를 테이블 영역과 컬럼 행에서 공유한다. 미입력은 정의
기본값으로 해석해 표시하고, 정의에서 사라진 선택지를 값으로 가진 경우 비활성 옵션으로
남겨 값 유실을 막는다. 정의가 없으면 섹션 자체를 렌더하지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 7: 경고 노출 마무리 (검사 화면)

**Files:**
- Modify: `apps/web/src/editor/naming-check.tsx`
- Modify: `apps/web/src/editor/naming-check.test.tsx`

**Interfaces:**
- Consumes: `custom-required` 경고(Task 2)
- Produces: 검사 화면에 `필수 항목 미입력` 그룹 노출

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/naming-check.test.tsx`에서 **기존 두 테스트의 버튼 쿼리를 바꾼다**(28행·37행): `screen.getByRole('button', { name: /명명 검사/ })` → `screen.getByRole('button', { name: /모델 검사/ })`.

그리고 마지막 `})` 앞에 추가한다(이 파일의 `loadWith` 헬퍼는 테이블 하나만 만들므로, 테이블 대상 필수 항목으로 케이스를 단순화한다):

```tsx
  it('필수 커스텀 항목 미입력을 그룹으로 보여주고 클릭 시 해당 테이블을 선택한다', async () => {
    const m = createEmptyModel()
    m.customFields['cf1'] = {
      id: 'cf1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['t1'] = {
      id: 't1', logicalName: '', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    useEditorStore.getState().setProjectConfig(
      { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }, ['postgresql'])
    render(<NamingCheck projectId={PROJECT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /모델 검사/ }))
    expect(screen.getByText('필수 항목 미입력 (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('ORD'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableId).toBe('t1'))
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/naming-check.test.tsx`
Expected: FAIL — `모델 검사` 버튼 없음

- [ ] **Step 3: 라벨을 정리한다**

`apps/web/src/editor/naming-check.tsx`:

- `KIND_LABEL`에 `'custom-required': '필수 항목 미입력',`가 있는지 확인한다(Task 2 Step 7에서 이미 추가했다).
- 표시 문구를 바꾼다(컴포넌트명·파일명은 유지 — 이 화면은 이미 관계 경고까지 보여주므로 "명명"보다 정확하다):

```tsx
        <Button variant="ghost" size="sm">
          <ListChecks /> 모델 검사{warnings.length > 0 ? ` (${warnings.length})` : ''}
        </Button>
```

```tsx
        <DialogHeader><DialogTitle>모델 검사</DialogTitle></DialogHeader>
```

- 주석의 `헤더의 "명명 검사"`도 `헤더의 "모델 검사"`로 바꾼다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck
```
Expected: PASS, typecheck 0 errors

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/naming-check.tsx apps/web/src/editor/naming-check.test.tsx
git commit -F - <<'EOF'
feat(web): 검사 화면에 필수 항목 미입력 노출·표시명 "모델 검사"로 정리

이 화면은 이미 관계 경고(타입 불일치·매핑 불완전)까지 보여주고 있어 표시명을
"모델 검사"로 바꾼다(컴포넌트·파일명은 유지). 노드 배지와 편집 패널 인라인 경고는
computeWarnings 확장만으로 자동 노출된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## 최종 체크포인트 (모든 태스크 후)

- [ ] **전체 스위트**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 그린. 기준선(core 127 · web 126 · server 49) 대비 core +약 12, web +약 22, server +3.

- [ ] **브라우저 스모크** (실 앱 + 실 DB)

```bash
set -a; . ./.env; set +a; pnpm --parallel -r dev    # web :5173, server :3000
```

스크래치 프로젝트 `http://localhost:5173/p/019f9451-d164-7d8c-a2f0-b71b7b60d42d`에서:
1. 헤더 "커스텀 항목" → 컬럼 대상 선택형 항목("개인정보여부", 선택지 `Y, N`, 필수) 추가
2. 테이블 선택 → 컬럼 행에 항목이 인라인으로 보이는지, 값 선택이 저장되는지 확인
3. 헤더 "모델 검사"에 `필수 항목 미입력` 그룹이 뜨고 클릭 시 해당 테이블이 선택되는지 확인
4. 값을 채우면 경고가 사라지는지 확인
5. 항목 삭제 → 확인 문구에 값 건수가 나오고, 삭제 후 값도 사라지는지 확인
6. **실행 취소(undo)로 모든 변경을 원복해 dev DB를 깨끗이 둔다**
7. 브라우저 콘솔·서버 로그에 에러가 없는지 확인

- [ ] **최종 whole-branch 리뷰 → main fast-forward 머지 → 브랜치 삭제**

- [ ] **HANDOFF 갱신** — `docs/superpowers/HANDOFF.md`의 "현재 상태 요약" 표에 커스텀 항목 행 추가, "다음 작업"에서 커스텀 항목 제거, 테스트 기준선·마이그레이션 번호(0006) 갱신, 이월 항목 추가.

## 이월(범위 밖, 문서에만 남긴다)

- 조직 표준 커스텀 항목 템플릿 fork·재동기화 → 다음 sub-project(사전·도메인과 통합 설계)
- Excel 정의서의 커스텀 컬럼 → Excel 사이클
- CLI 파일 포맷 `custom` 필드 → Phase 4
- 캔버스 노드 표시(기획상 제외), 관계·인덱스 대상 커스텀 항목
- `moveCustomField`는 order 동률일 때 스왑해도 순서가 바뀌지 않는다(현재는 `createCustomField`가 max+1이라 동률이 생기지 않는다. fork·임포트로 동률이 생길 수 있게 되면 재부여 로직이 필요하다)
