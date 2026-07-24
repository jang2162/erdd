# Phase 1 M4b — 관계·undo/redo·메모·경고 배지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ERD 에디터에 관계(까마귀발 표기·FK 자동생성·식별/비식별·캐스케이드), 실행 취소/재실행, 메모, 유효성 경고 배지를 추가해 Phase 1 에디터 기능을 완성한다.

**Architecture:** 관계 시맨틱은 도메인 규칙이므로 `packages/core`에 순수 producer 함수(model→model)로 구현한다(CLI·서버가 재사용). ID는 IO 없는 core가 생성할 수 없으므로 호출 측(웹)이 미리 발급해 인자로 넘긴다(M4a `addTable({id})` 패턴 동일). undo/redo는 서버에 별도 개념을 두지 않고 **역op 배치를 일반 mutation으로 재제출**하되, 클라이언트는 `applyOps(current, invertOps(ops))`를 producer로 사용해 M4a의 단일 mutation 경로(producer+diff)를 그대로 재사용한다. 경고(물리명 중복·타입 불일치·매핑 불완전)는 저장을 막지 않는 비차단 정보이므로 무결성 검사(`validateModelIntegrity`, 차단)와 분리해 별도 `computeWarnings`로 계산한다.

**Tech Stack:** TypeScript, React 19, @xyflow/react(커스텀 엣지·핸들·마커), Zustand, @erdd/core(zod·op 엔진), vitest, @testing-library/react.

## Global Constraints

- op 배치는 **하나의 producer가 만든 next 모델**에서 `diffModels`로 도출된다. 관계 생성처럼 컬럼+관계를 함께 만드는 변경도 반드시 next 모델을 통째로 반환하는 단일 producer로 표현한다(부분 op을 손으로 조립하지 않는다).
- core producer는 **불변**이다. 입력 모델을 변경하지 않고 새 객체를 반환한다(기존 `model-edits.ts` 패턴).
- core는 **IO 없음**. UUID·시간·난수를 생성하지 않는다. 새 id가 필요하면 파라미터로 받는다.
- 관계 생성/컬럼 삭제 등 캐스케이드가 만든 next 모델은 `validateModelIntegrity(next) === []`를 만족해야 한다(diffModels·applyOps의 전제). 캐스케이드는 참조가 깨지지 않도록 연관 엔티티를 함께 정리한다.
- 물리명 중복·타입 불일치·매핑 불완전은 **경고**이지 오류가 아니다. 저장을 막지 않는다(`10-editor.md` §유효성 표시).
- 관계 삭제 시 **자식 FK 컬럼은 일반 컬럼으로 보존**한다(`10-editor.md` §삭제 처리). 컬럼을 지우지 않는다.
- 카디널리티는 `'1:1' | '1:N'`만(zod enum). N:M 비범위.
- 식별(identifying)=실선, 비식별=점선. 부모 쪽=one(막대), 자식 쪽=1:N이면 many(까마귀발)·1:1이면 one.
- 새로고침 후에도 관계·메모가 서버에서 복원되어야 한다(M3 영속화 경로 사용, 별도 서버 변경 없음).
- 한국어 UI 문구, 커밋 메시지는 한국어.

---

## File Structure

**core (신규):**
- `packages/core/src/relationship.ts` — 관계 도메인 producer: `createRelationshipFromParentPk`, `remapRelationshipChildColumn`, `setRelationshipIdentifying`, `deleteRelationship`, `deleteTableCascade`, `deleteColumnCascade`.
- `packages/core/src/relationship.test.ts`
- `packages/core/src/warnings.ts` — `computeWarnings(model): Warning[]`.
- `packages/core/src/warnings.test.ts`

**core (수정):**
- `packages/core/src/index.ts` — 신규 export 추가.

**web (신규):**
- `apps/web/src/editor/edges.ts` — `buildEdges(model): Edge[]`, 핸들 선택 휴리스틱.
- `apps/web/src/editor/relationship-edge.tsx` — 커스텀 까마귀발 엣지 + 마커 defs.
- `apps/web/src/editor/note-edits.ts` — `addNote`, `updateNote`, `moveNote`, `removeNote`.
- `apps/web/src/editor/note-node.tsx` — 메모 노드.
- `apps/web/src/editor/relationship-panel.tsx` — 관계 편집 패널.
- `apps/web/src/editor/note-panel.tsx` — 메모 편집 패널.
- `apps/web/src/editor/warning-badge.tsx` — 경고 배지 컴포넌트.
- 대응 테스트: `edges.test.ts`, `note-edits.test.ts`, `relationship-panel.test.tsx`, `warning-badge.test.tsx`, `undo-redo.test.tsx`(use-model 확장).

**web (수정):**
- `apps/web/src/editor/store.ts` — 선택(rel/note) 필드, undo/redo 스택, seq 단조 가드, 히스토리 초기화.
- `apps/web/src/editor/use-model.ts` — `useSubmit` 내부 함수로 리팩터, `useModelMutation`(record=true) + `useUndoRedo`.
- `apps/web/src/editor/model-edits.ts` — `removeTable`를 core `deleteTableCascade`로 위임.
- `apps/web/src/editor/column-edits.ts` — `removeColumn`을 core `deleteColumnCascade`로 위임.
- `apps/web/src/editor/canvas.tsx` — 엣지·메모 노드 렌더, `onConnect`, 노드 타입별 드래그 처리, 변수 섀도잉 정리.
- `apps/web/src/editor/nodes.ts` — 테이블 노드에 경고 표면 데이터 추가.
- `apps/web/src/editor/table-node.tsx` — 핸들 추가, 경고 배지 표시.
- `apps/web/src/editor/edit-panel.tsx` — 선택 종류에 따라 테이블/관계/메모 패널 분기, 컬럼 경고 표시.
- `apps/web/src/editor/toolbar.tsx` — 메모 추가 버튼, undo/redo 버튼, 단축키.

---

## Task 1: core 관계 도메인 producer

**Files:**
- Create: `packages/core/src/relationship.ts`
- Test: `packages/core/src/relationship.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ProjectModel`, `Column`, `Relationship`, `Table` (from `./model.js`), `applyOps`/`diffModels`는 사용하지 않음(순수 producer).
- Produces (later tasks rely on these exact signatures):
  ```ts
  // 헤더 드래그: 부모 PK 전부를 자식에 FK 컬럼으로 자동 생성 + 관계 생성.
  // newColumnIds.length는 부모 PK 개수 이상이어야 한다(부족하면 throw).
  createRelationshipFromParentPk(model, args: {
    relationshipId: string; parentTableId: string; childTableId: string;
    newColumnIds: string[]; cardinality?: '1:1' | '1:N'; identifying?: boolean; name?: string | null;
  }): ProjectModel
  // 관계의 특정 자식 FK 컬럼을 자식 테이블의 기존 컬럼으로 재매핑(자동생성 컬럼은 삭제).
  remapRelationshipChildColumn(model, args: {
    relationshipId: string; parentColumnId: string; newChildColumnId: string;
  }): ProjectModel
  // 식별/비식별 전환: FK 컬럼을 자식 PK에 편입/제외.
  setRelationshipIdentifying(model, relationshipId: string, identifying: boolean): ProjectModel
  // 관계 삭제(자식 FK 컬럼은 일반 컬럼으로 보존).
  deleteRelationship(model, relationshipId: string): ProjectModel
  // 테이블 삭제 + 소속 컬럼/인덱스 + 관련 관계 삭제(반대편 FK 컬럼은 보존).
  deleteTableCascade(model, tableId: string): ProjectModel
  // 컬럼 삭제 + 매핑에서 제거, 매핑이 비면 관계도 삭제.
  deleteColumnCascade(model, columnId: string): ProjectModel
  ```

### Implementation notes (읽고 시작)

- 모든 함수는 **불변**. `{ ...model, columns: { ...model.columns, ... } }` 형태로 새 객체 반환.
- 존재하지 않는 대상(없는 relationshipId/tableId/columnId)은 **모델을 그대로 반환**(no-op). 예외를 던지지 않는다(M4a `moveTable`/`updateColumn` 패턴). **예외:** `createRelationshipFromParentPk`에서 `newColumnIds`가 부모 PK 수보다 적으면 `throw new Error('FK 컬럼 id가 부족합니다')`(호출 측 버그이므로).
- 물리명 충돌 회피: FK 컬럼 물리명이 자식 테이블에 이미 있으면 `_2`, `_3`… 접미(사용 중이지 않은 최소 숫자). 논리명도 동일 규칙(한글은 `2` 접미).
- FK 컬럼 order: 자식 테이블 기존 컬럼 max order + 1부터 순차.
- 식별 관계 FK 컬럼은 `isPk: true`, `nullable: false`. 비식별은 `isPk: false`, `nullable: false`(NOT NULL 기본, `10-editor.md` §생성).
- `setRelationshipIdentifying(true)`: 매핑된 자식 컬럼들을 `isPk:true`로. `false`: `isPk:false`로. PK 순서는 기존 컬럼 order를 유지(별도 재정렬 없음 — order 필드가 이미 PK 순서를 결정).

### Steps

- [ ] **Step 1: 실패 테스트 작성** — `packages/core/src/relationship.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import {
  createRelationshipFromParentPk, remapRelationshipChildColumn,
  setRelationshipIdentifying, deleteRelationship, deleteTableCascade, deleteColumnCascade,
} from './relationship.js'
import type { Column, ProjectModel, Table } from './model.js'
import { createEmptyModel } from './model.js'

function tbl(id: string, physicalName: string): Table {
  return { id, logicalName: id, physicalName, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, ...over }
}

// 부모 USERS(PK id), 자식 ORDERS(컬럼 없음)
function baseModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = tbl('P', 'USERS')
  m.tables['C'] = tbl('C', 'ORDERS')
  m.columns['P_ID'] = col('P_ID', 'P', 'ID', { isPk: true, nullable: false, order: 0, type: 'BIGINT' })
  return m
}

describe('createRelationshipFromParentPk', () => {
  it('부모 PK를 자식에 FK 컬럼으로 생성하고 관계를 만든다', () => {
    const next = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const fk = next.columns['FK1']!
    expect(fk.tableId).toBe('C')
    expect(fk.physicalName).toBe('ID')       // 부모 물리명 복제
    expect(fk.type).toBe('BIGINT')            // 타입 복제
    expect(fk.nullable).toBe(false)           // NOT NULL 기본
    expect(fk.isPk).toBe(false)               // 비식별 기본
    const rel = next.relationships['R']!
    expect(rel.parentTableId).toBe('P')
    expect(rel.childTableId).toBe('C')
    expect(rel.columnMappings).toEqual([{ childColumnId: 'FK1', parentColumnId: 'P_ID' }])
    expect(rel.cardinality).toBe('1:N')
    expect(rel.identifying).toBe(false)
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('자식에 물리명이 이미 있으면 _2 접미를 붙인다', () => {
    const m = baseModel()
    m.columns['EXIST'] = col('EXIST', 'C', 'ID', { order: 0 })  // 이미 ID 존재
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    expect(next.columns['FK1']!.physicalName).toBe('ID_2')
  })

  it('복합 PK면 컬럼을 모두 생성하고 매핑한다', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1', 'FK2'],
    })
    expect(next.relationships['R']!.columnMappings).toHaveLength(2)
    expect(validateModelIntegrity(next)).toEqual([])
  })

  it('식별 관계면 FK 컬럼이 자식 PK가 된다', () => {
    const next = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'], identifying: true,
    })
    expect(next.columns['FK1']!.isPk).toBe(true)
    expect(next.relationships['R']!.identifying).toBe(true)
  })

  it('newColumnIds가 부족하면 throw', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    expect(() => createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })).toThrow()
  })

  it('부모에 PK가 없으면 관계를 만들지 않고 그대로 반환한다', () => {
    const m = baseModel()
    m.columns['P_ID']!.isPk = false
    const next = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeUndefined()
  })
})

describe('setRelationshipIdentifying', () => {
  it('true면 FK 컬럼이 PK가 되고 false면 해제된다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const on = setRelationshipIdentifying(created, 'R', true)
    expect(on.columns['FK1']!.isPk).toBe(true)
    expect(on.relationships['R']!.identifying).toBe(true)
    const off = setRelationshipIdentifying(on, 'R', false)
    expect(off.columns['FK1']!.isPk).toBe(false)
    expect(off.relationships['R']!.identifying).toBe(false)
    expect(validateModelIntegrity(off)).toEqual([])
  })
})

describe('remapRelationshipChildColumn', () => {
  it('자동생성 FK를 기존 컬럼으로 교체하고 자동생성 컬럼은 삭제한다', () => {
    const m = baseModel()
    m.columns['USER_REF'] = col('USER_REF', 'C', 'USER_REF', { type: 'BIGINT', order: 0 })
    const created = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = remapRelationshipChildColumn(created, {
      relationshipId: 'R', parentColumnId: 'P_ID', newChildColumnId: 'USER_REF',
    })
    expect(next.relationships['R']!.columnMappings).toEqual([
      { childColumnId: 'USER_REF', parentColumnId: 'P_ID' },
    ])
    expect(next.columns['FK1']).toBeUndefined()  // 이전 자동생성 컬럼 삭제
    expect(next.columns['USER_REF']).toBeDefined()
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteRelationship', () => {
  it('관계를 지우되 자식 FK 컬럼은 일반 컬럼으로 남긴다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteRelationship(created, 'R')
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeDefined()   // 컬럼 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteTableCascade', () => {
  it('부모 삭제 시 관계는 지우고 자식 FK 컬럼은 보존한다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteTableCascade(created, 'P')
    expect(next.tables['P']).toBeUndefined()
    expect(next.columns['P_ID']).toBeUndefined()  // 부모 소속 컬럼 삭제
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['FK1']).toBeDefined()     // 자식 FK 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('자식 삭제 시 관계와 자식 컬럼이 함께 삭제된다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteTableCascade(created, 'C')
    expect(next.tables['C']).toBeUndefined()
    expect(next.columns['FK1']).toBeUndefined()
    expect(next.relationships['R']).toBeUndefined()
    expect(next.columns['P_ID']).toBeDefined()    // 부모 컬럼 보존
    expect(validateModelIntegrity(next)).toEqual([])
  })
})

describe('deleteColumnCascade', () => {
  it('매핑에 쓰인 컬럼 삭제 시 매핑에서 제거하고 매핑이 비면 관계도 삭제한다', () => {
    const created = createRelationshipFromParentPk(baseModel(), {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1'],
    })
    const next = deleteColumnCascade(created, 'FK1')
    expect(next.columns['FK1']).toBeUndefined()
    expect(next.relationships['R']).toBeUndefined()  // 매핑이 비어 관계 삭제
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('복합 매핑에서 한 컬럼만 지우면 관계는 유지되고 매핑만 축소된다', () => {
    const m = baseModel()
    m.columns['P_ID2'] = col('P_ID2', 'P', 'TENANT', { isPk: true, nullable: false, order: 1 })
    const created = createRelationshipFromParentPk(m, {
      relationshipId: 'R', parentTableId: 'P', childTableId: 'C', newColumnIds: ['FK1', 'FK2'],
    })
    const next = deleteColumnCascade(created, 'FK1')
    expect(next.relationships['R']).toBeDefined()
    expect(next.relationships['R']!.columnMappings).toHaveLength(1)
    expect(validateModelIntegrity(next)).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — `pnpm --filter @erdd/core test relationship` → 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현** — `packages/core/src/relationship.ts`

```ts
import type { Column, ProjectModel, Relationship } from './model.js'

function childColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.tableId === tableId)
}

/** base 물리명이 used에 있으면 _2, _3… 붙여 사용 중이지 않은 이름을 만든다. */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/** 부모 PK 컬럼을 order 순으로 반환. */
function parentPkColumns(model: ProjectModel, parentTableId: string): Column[] {
  return childColumns(model, parentTableId)
    .filter((c) => c.isPk)
    .sort((a, b) => a.order - b.order)
}

export function createRelationshipFromParentPk(
  model: ProjectModel,
  args: {
    relationshipId: string
    parentTableId: string
    childTableId: string
    newColumnIds: string[]
    cardinality?: '1:1' | '1:N'
    identifying?: boolean
    name?: string | null
  },
): ProjectModel {
  const { relationshipId, parentTableId, childTableId, newColumnIds } = args
  if (!model.tables[parentTableId] || !model.tables[childTableId]) return model
  const pks = parentPkColumns(model, parentTableId)
  if (pks.length === 0) return model // 부모 PK 없음 — no-op(호출 측이 경고)
  if (newColumnIds.length < pks.length) {
    throw new Error('FK 컬럼 id가 부족합니다')
  }

  const identifying = args.identifying ?? false
  const existing = childColumns(model, childTableId)
  const usedPhysical = new Set(existing.map((c) => c.physicalName))
  const usedLogical = new Set(existing.map((c) => c.logicalName))
  let order = existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.order)) + 1

  const newColumns: Record<string, Column> = {}
  const mappings: Relationship['columnMappings'] = []

  pks.forEach((pk, i) => {
    const id = newColumnIds[i]!
    const physicalName = uniqueName(pk.physicalName, usedPhysical)
    const logicalName = uniqueName(pk.logicalName, usedLogical)
    usedPhysical.add(physicalName)
    usedLogical.add(logicalName)
    newColumns[id] = {
      id, tableId: childTableId, logicalName, physicalName, type: pk.type,
      isPk: identifying, autoIncrement: false, nullable: false,
      defaultValue: null, order: order++, comment: null,
    }
    mappings.push({ childColumnId: id, parentColumnId: pk.id })
  })

  const relationship: Relationship = {
    id: relationshipId, parentTableId, childTableId, columnMappings: mappings,
    cardinality: args.cardinality ?? '1:N', identifying, name: args.name ?? null,
  }

  return {
    ...model,
    columns: { ...model.columns, ...newColumns },
    relationships: { ...model.relationships, [relationshipId]: relationship },
  }
}

export function remapRelationshipChildColumn(
  model: ProjectModel,
  args: { relationshipId: string; parentColumnId: string; newChildColumnId: string },
): ProjectModel {
  const rel = model.relationships[args.relationshipId]
  if (!rel) return model
  const target = rel.columnMappings.find((m) => m.parentColumnId === args.parentColumnId)
  if (!target) return model
  const newChild = model.columns[args.newChildColumnId]
  if (!newChild || newChild.tableId !== rel.childTableId) return model
  const oldChildId = target.childColumnId
  if (oldChildId === args.newChildColumnId) return model

  const columnMappings = rel.columnMappings.map((m) =>
    m.parentColumnId === args.parentColumnId
      ? { childColumnId: args.newChildColumnId, parentColumnId: m.parentColumnId }
      : m,
  )
  // 이전 자식 컬럼이 다른 매핑에서도 안 쓰이면 삭제(자동생성 FK 정리).
  const stillUsed = columnMappings.some((m) => m.childColumnId === oldChildId)
  const columns = { ...model.columns }
  if (!stillUsed) delete columns[oldChildId]

  return {
    ...model,
    columns,
    relationships: { ...model.relationships, [rel.id]: { ...rel, columnMappings } },
  }
}

export function setRelationshipIdentifying(
  model: ProjectModel, relationshipId: string, identifying: boolean,
): ProjectModel {
  const rel = model.relationships[relationshipId]
  if (!rel) return model
  const columns = { ...model.columns }
  for (const m of rel.columnMappings) {
    const c = columns[m.childColumnId]
    if (c) columns[m.childColumnId] = { ...c, isPk: identifying }
  }
  return {
    ...model,
    columns,
    relationships: { ...model.relationships, [rel.id]: { ...rel, identifying } },
  }
}

export function deleteRelationship(model: ProjectModel, relationshipId: string): ProjectModel {
  if (!model.relationships[relationshipId]) return model
  const relationships = { ...model.relationships }
  delete relationships[relationshipId] // 자식 FK 컬럼은 보존
  return { ...model, relationships }
}

export function deleteTableCascade(model: ProjectModel, tableId: string): ProjectModel {
  if (!model.tables[tableId]) return model
  const tables = { ...model.tables }
  delete tables[tableId]
  const columns = Object.fromEntries(
    Object.entries(model.columns).filter(([, c]) => c.tableId !== tableId),
  )
  const indexes = Object.fromEntries(
    Object.entries(model.indexes).filter(([, ix]) => ix.tableId !== tableId),
  )
  // 이 테이블이 부모 또는 자식인 관계 삭제(반대편 FK 컬럼은 위 columns 필터로 보존됨).
  const relationships = Object.fromEntries(
    Object.entries(model.relationships).filter(
      ([, r]) => r.parentTableId !== tableId && r.childTableId !== tableId,
    ),
  )
  return { ...model, tables, columns, indexes, relationships }
}

export function deleteColumnCascade(model: ProjectModel, columnId: string): ProjectModel {
  if (!model.columns[columnId]) return model
  const columns = { ...model.columns }
  delete columns[columnId]

  const relationships: Record<string, Relationship> = {}
  for (const rel of Object.values(model.relationships)) {
    const columnMappings = rel.columnMappings.filter(
      (m) => m.childColumnId !== columnId && m.parentColumnId !== columnId,
    )
    if (columnMappings.length === 0) continue // 매핑이 비면 관계 삭제
    relationships[rel.id] = columnMappings === rel.columnMappings ? rel : { ...rel, columnMappings }
  }

  // 삭제된 컬럼을 참조하던 인덱스 컬럼도 정리(무결성 유지).
  const indexes: ProjectModel['indexes'] = {}
  for (const ix of Object.values(model.indexes)) {
    const cols = ix.columns.filter((ic) => ic.columnId !== columnId)
    if (cols.length === ix.columns.length) indexes[ix.id] = ix
    else if (cols.length > 0) indexes[ix.id] = { ...ix, columns: cols }
    // cols.length === 0 이면 인덱스 삭제
  }

  return { ...model, columns, relationships, indexes }
}
```

- [ ] **Step 4: 테스트 통과 확인** — `pnpm --filter @erdd/core test relationship` → PASS.

- [ ] **Step 5: index.ts export 추가**

```ts
export {
  createRelationshipFromParentPk, remapRelationshipChildColumn, setRelationshipIdentifying,
  deleteRelationship, deleteTableCascade, deleteColumnCascade,
} from './relationship.js'
```

- [ ] **Step 6: 전체 core 테스트·타입체크** — `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/relationship.ts packages/core/src/relationship.test.ts packages/core/src/index.ts
git commit -m "feat(core): 관계 도메인 producer — FK 자동생성·식별 전환·캐스케이드 삭제"
```

---

## Task 2: core 경고 엔진

**Files:**
- Create: `packages/core/src/warnings.ts`, `packages/core/src/warnings.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ProjectModel`, `Column`, `Relationship`.
- Produces:
  ```ts
  type Warning = {
    kind: 'duplicate-physical' | 'type-mismatch' | 'incomplete-mapping'
    scope: 'column' | 'relationship'
    entityId: string        // column.id 또는 relationship.id
    tableId?: string        // duplicate-physical일 때 소속 테이블
    message: string
  }
  computeWarnings(model: ProjectModel): Warning[]
  ```

### 경고 규칙 (읽고 시작)

1. `duplicate-physical` (scope: column): 같은 테이블 안에서 물리명이 중복되는 컬럼들. 중복 그룹의 **각 컬럼마다** 하나씩 경고(배지를 각 행에 붙이기 위함). 빈 문자열 물리명은 검사 제외.
2. `type-mismatch` (scope: relationship): 관계의 매핑에서 자식 컬럼 `type`과 부모 컬럼 `type`이 다르면 경고(관계당 1건).
3. `incomplete-mapping` (scope: relationship): 관계 매핑 수가 부모 PK 컬럼 수와 다르면(부모 PK 추가/제거 후) 경고(관계당 1건).

- 순수 함수. 참조 무결성이 깨진 모델(존재하지 않는 컬럼 참조)에서도 throw 없이 동작(해당 검사만 건너뜀).

### Steps

- [ ] **Step 1: 실패 테스트** — `packages/core/src/warnings.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { computeWarnings } from './warnings.js'
import type { Column, ProjectModel, Relationship, Table } from './model.js'
import { createEmptyModel } from './model.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, ...over }
}

describe('computeWarnings', () => {
  it('같은 테이블 물리명 중복을 각 컬럼마다 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { order: 0 })
    m.columns['B'] = col('B', 'T', 'NAME', { order: 1 })
    m.columns['C'] = col('C', 'T', 'CODE', { order: 2 })
    const w = computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')
    expect(w.map((x) => x.entityId).sort()).toEqual(['A', 'B'])
  })

  it('다른 테이블의 같은 물리명은 경고하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['T1'] = tbl('T1'); m.tables['T2'] = tbl('T2')
    m.columns['A'] = col('A', 'T1', 'ID'); m.columns['B'] = col('B', 'T2', 'ID')
    expect(computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')).toEqual([])
  })

  it('관계 매핑의 타입 불일치를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['PC'] = col('PC', 'P', 'ID', { type: 'BIGINT', isPk: true })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'VARCHAR(20)' })
    const rel: Relationship = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'PC' }],
      cardinality: '1:N', identifying: false, name: null }
    m.relationships['R'] = rel
    const w = computeWarnings(m).filter((x) => x.kind === 'type-mismatch')
    expect(w).toHaveLength(1)
    expect(w[0]!.entityId).toBe('R')
  })

  it('부모 PK 수와 매핑 수가 다르면 매핑 불완전을 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['P1'] = col('P1', 'P', 'ID', { isPk: true, type: 'BIGINT' })
    m.columns['P2'] = col('P2', 'P', 'TENANT', { isPk: true, type: 'BIGINT' })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'BIGINT' })
    m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'P1' }],
      cardinality: '1:N', identifying: false, name: null }
    const w = computeWarnings(m).filter((x) => x.kind === 'incomplete-mapping')
    expect(w).toHaveLength(1)
  })

  it('경고가 없으면 빈 배열', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'ID')
    expect(computeWarnings(m)).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core test warnings` → FAIL.

- [ ] **Step 3: 구현** — `packages/core/src/warnings.ts`

```ts
import type { ProjectModel } from './model.js'

export type Warning = {
  kind: 'duplicate-physical' | 'type-mismatch' | 'incomplete-mapping'
  scope: 'column' | 'relationship'
  entityId: string
  tableId?: string
  message: string
}

export function computeWarnings(model: ProjectModel): Warning[] {
  const warnings: Warning[] = []

  // 1) 같은 테이블 물리명 중복
  const byTable = new Map<string, Map<string, string[]>>() // tableId → physicalName → columnIds
  for (const c of Object.values(model.columns)) {
    if (c.physicalName === '') continue
    let names = byTable.get(c.tableId)
    if (!names) { names = new Map(); byTable.set(c.tableId, names) }
    const ids = names.get(c.physicalName) ?? []
    ids.push(c.id)
    names.set(c.physicalName, ids)
  }
  for (const [tableId, names] of byTable) {
    for (const [physicalName, ids] of names) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical', scope: 'column', entityId: id, tableId,
          message: `물리명 "${physicalName}"이(가) 같은 테이블에서 중복됩니다`,
        })
      }
    }
  }

  // 2), 3) 관계 타입 불일치 / 매핑 불완전
  for (const rel of Object.values(model.relationships)) {
    const parentPkCount = Object.values(model.columns).filter(
      (c) => c.tableId === rel.parentTableId && c.isPk,
    ).length
    if (parentPkCount !== rel.columnMappings.length) {
      warnings.push({
        kind: 'incomplete-mapping', scope: 'relationship', entityId: rel.id,
        message: '부모 기본 키와 매핑 수가 일치하지 않습니다',
      })
    }
    for (const m of rel.columnMappings) {
      const child = model.columns[m.childColumnId]
      const parent = model.columns[m.parentColumnId]
      if (child && parent && child.type !== parent.type) {
        warnings.push({
          kind: 'type-mismatch', scope: 'relationship', entityId: rel.id,
          message: `참조 컬럼 타입이 다릅니다 (${parent.type} ↔ ${child.type})`,
        })
        break // 관계당 1건
      }
    }
  }

  return warnings
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/core test warnings` → PASS.

- [ ] **Step 5: index.ts export**

```ts
export { computeWarnings } from './warnings.js'
export type { Warning } from './warnings.js'
```

- [ ] **Step 6: 전체 검증** — `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/warnings.ts packages/core/src/warnings.test.ts packages/core/src/index.ts
git commit -m "feat(core): 경고 엔진 — 물리명 중복·타입 불일치·매핑 불완전"
```

---

## Task 3: 웹 undo/redo + 스토어 확장

**Files:**
- Modify: `apps/web/src/editor/store.ts`, `apps/web/src/editor/use-model.ts`
- Test: `apps/web/src/editor/undo-redo.test.tsx` (신규), 기존 `use-model.test.tsx` 유지

**Interfaces:**
- Consumes: `applyOps`, `invertOps`, `diffModels`, `type Op` from `@erdd/core`.
- Produces (later tasks rely on these store fields/actions):
  ```ts
  // store 추가 필드
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  undoStack: Op[][]     // 커밋된 forward op 배치들(최근이 뒤)
  redoStack: Op[][]
  // store 추가 액션
  select: (tableId: string | null) => void            // rel/note 선택 해제
  selectRelationship: (id: string | null) => void      // table/note 선택 해제
  selectNote: (id: string | null) => void              // table/rel 선택 해제
  recordEdit: (ops: Op[]) => void                       // undoStack push + redoStack clear(cap 100)
  moveUndoToRedo: () => Op[] | null                     // undoStack pop→redoStack push, 반환
  moveRedoToUndo: () => Op[] | null                     // redoStack pop→undoStack push, 반환
  // use-model
  useModelMutation(projectId): (producer, opts?) => Promise<void>   // 기존 시그니처 유지(record=true)
  useUndoRedo(projectId): { undo: () => Promise<void>; redo: () => Promise<void>; canUndo: boolean; canRedo: boolean }
  ```

### 설계 (읽고 시작)

- **단일 경로 유지:** undo/redo도 M4a의 producer+diff 경로를 쓴다. undo는 `applyOps(current, invertOps(ops))`, redo는 `applyOps(current, ops)`를 producer로 넘긴다.
- **기록 시점:** 정상 mutate는 서버 성공 후 `recordEdit(ops)`로 forward 배치를 undoStack에 쌓고 redoStack을 비운다. undo/redo 제출은 `record:false`로 하여 스택을 이중 기록하지 않는다.
- **스택 이동은 성공 후에만:** undo는 `undoStack` 맨 위 배치를 **peek**해 제출하고, **성공하면** `moveUndoToRedo()`로 이동. 실패 시 스택 불변(단, 실패는 서버 재로드→히스토리 초기화로 이어짐).
- **히스토리 초기화:** `setLoaded`(최초 적재 및 롤백 재로드)에서 undo/redo 스택을 비운다. 정상 성공은 `setSeq`만 호출하므로 히스토리 유지.
- **seq 단조:** `setSeq`는 `Math.max(prev, next)`로 역행 방지(동시 응답 순서 뒤섞임 대비 — 이월 백로그).
- **producer throw 처리:** undo/redo의 `applyOps`가 무결성/충돌로 throw할 수 있으므로 submit이 producer 호출을 try/catch로 감싸 실패 시 토스트 후 중단(스택 이동 안 함).
- cap: undoStack 최대 100개(초과 시 오래된 것 제거).

### Steps

- [ ] **Step 1: 실패 테스트** — `apps/web/src/editor/undo-redo.test.tsx`

핵심 시나리오만 검증(스토어 순수 로직 + 훅 통합):

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEditorStore } from './store.js'

beforeEach(() => { act(() => useEditorStore.getState().reset()) })

describe('store 선택·히스토리', () => {
  it('select는 rel/note 선택을 해제한다', () => {
    const s = useEditorStore.getState()
    act(() => { s.selectRelationship('R'); s.select('T') })
    const st = useEditorStore.getState()
    expect(st.selectedTableId).toBe('T')
    expect(st.selectedRelationshipId).toBeNull()
  })

  it('recordEdit는 undo에 쌓고 redo를 비운다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })

  it('moveUndoToRedo는 맨 위 배치를 이동하고 반환한다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
    })
    let moved: unknown
    act(() => { moved = useEditorStore.getState().moveUndoToRedo() })
    expect(moved).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })

  it('setSeq는 역행하지 않는다', () => {
    act(() => { useEditorStore.getState().setSeq(5); useEditorStore.getState().setSeq(3) })
    expect(useEditorStore.getState().seq).toBe(5)
  })

  it('setLoaded는 히스토리를 초기화한다', () => {
    act(() => {
      useEditorStore.getState().recordEdit([{ action: 'create', entity: 'table', entityId: 'A', data: {} }])
      useEditorStore.getState().setLoaded({ tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {} }, 1, 'p1')
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })
})
```

(훅 통합 테스트는 use-model.test.tsx의 기존 tRPC 목 패턴을 따라 `useUndoRedo`가 서버 성공 시 스택을 이동시키는지 1건 추가. 기존 파일의 목 헬퍼를 재사용하되, 목 서버가 항상 성공을 반환하면 undo 후 redoStack 길이 1을 assert.)

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web test undo-redo` → FAIL(액션 없음).

- [ ] **Step 3: store.ts 확장**

```ts
import { create } from 'zustand'
import { createEmptyModel, type Op, type ProjectModel } from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'
const HISTORY_CAP = 100

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  loadedProjectId: string | null
  viewMode: ViewMode
  selectedTableId: string | null
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  focusTableId: string | null
  undoStack: Op[][]
  redoStack: Op[][]
  setLoaded: (model: ProjectModel, seq: number, projectId: string) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
  selectRelationship: (id: string | null) => void
  selectNote: (id: string | null) => void
  focus: (tableId: string) => void
  consumeFocus: () => void
  recordEdit: (ops: Op[]) => void
  moveUndoToRedo: () => Op[] | null
  moveRedoToUndo: () => Op[] | null
  reset: () => void
}

const CLEARED_SELECTION = {
  selectedTableId: null, selectedRelationshipId: null, selectedNoteId: null,
}

export const useEditorStore = create<EditorState>((set, get) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  loadedProjectId: null,
  viewMode: 'physical',
  selectedTableId: null,
  selectedRelationshipId: null,
  selectedNoteId: null,
  focusTableId: null,
  undoStack: [],
  redoStack: [],
  setLoaded: (model, seq, projectId) =>
    set({ model, seq, loaded: true, loadedProjectId: projectId, undoStack: [], redoStack: [] }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set((s) => ({ seq: Math.max(s.seq, seq) })),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (selectedTableId) => set({ ...CLEARED_SELECTION, selectedTableId }),
  selectRelationship: (selectedRelationshipId) => set({ ...CLEARED_SELECTION, selectedRelationshipId }),
  selectNote: (selectedNoteId) => set({ ...CLEARED_SELECTION, selectedNoteId }),
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableId: id }),
  consumeFocus: () => set({ focusTableId: null }),
  recordEdit: (ops) =>
    set((s) => ({ undoStack: [...s.undoStack, ops].slice(-HISTORY_CAP), redoStack: [] })),
  moveUndoToRedo: () => {
    const { undoStack, redoStack } = get()
    const ops = undoStack[undoStack.length - 1]
    if (!ops) return null
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, ops] })
    return ops
  },
  moveRedoToUndo: () => {
    const { undoStack, redoStack } = get()
    const ops = redoStack[redoStack.length - 1]
    if (!ops) return null
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, ops] })
    return ops
  },
  reset: () => set({
    model: createEmptyModel(), seq: 0, loaded: false, loadedProjectId: null,
    ...CLEARED_SELECTION, focusTableId: null, undoStack: [], redoStack: [],
  }),
}))
```

- [ ] **Step 4: use-model.ts 리팩터**

```ts
import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { applyOps, diffModels, invertOps, validateModelIntegrity, type ProjectModel } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'

export function useModelLoader(projectId: string) {
  const trpc = useTRPC()
  const setLoaded = useEditorStore((s) => s.setLoaded)
  const query = useQuery(trpc.model.get.queryOptions({ projectId }))
  useEffect(() => {
    if (query.data && useEditorStore.getState().loadedProjectId !== projectId) {
      setLoaded(query.data.model, query.data.seq, projectId)
    }
  }, [query.data, setLoaded, projectId])
  return query
}

/** 모델 변경의 저수준 단일 경로. 성공 시 true. record=true면 undo 스택에 기록. */
function useSubmit(projectId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(trpc.model.mutate.mutationOptions())

  return useCallback(
    async (
      producer: (model: ProjectModel) => ProjectModel,
      opts: { summary?: string; record: boolean },
    ): Promise<boolean> => {
      const store = useEditorStore.getState()
      const current = store.model
      let next: ProjectModel
      try {
        next = producer(current)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 적용할 수 없습니다')
        return false
      }
      const ops = diffModels(current, next)
      if (ops.length === 0) return false

      const issues = validateModelIntegrity(next)
      if (issues.length > 0) {
        toast.error(issues[0]!.message)
        return false
      }

      store.setModel(next) // 낙관적
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts.summary })
        useEditorStore.getState().setSeq(seq)
        if (opts.record) useEditorStore.getState().recordEdit(ops)
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 저장하지 못했습니다')
        try {
          const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
          useEditorStore.getState().setLoaded(fresh.model, fresh.seq, projectId)
        } catch {
          toast.error('서버 상태를 복구하지 못했습니다. 새로고침해 주세요.')
        }
        return false
      }
    },
    [projectId, mutation, queryClient, trpc],
  )
}

export function useModelMutation(projectId: string) {
  const submit = useSubmit(projectId)
  return useCallback(
    (producer: (model: ProjectModel) => ProjectModel, opts?: { summary?: string }) =>
      submit(producer, { summary: opts?.summary, record: true }).then(() => undefined),
    [submit],
  )
}

export function useUndoRedo(projectId: string) {
  const submit = useSubmit(projectId)
  const undoStack = useEditorStore((s) => s.undoStack)
  const redoStack = useEditorStore((s) => s.redoStack)

  const undo = useCallback(async () => {
    const store = useEditorStore.getState()
    const ops = store.undoStack[store.undoStack.length - 1]
    if (!ops) return
    const ok = await submit((m) => applyOps(m, invertOps(ops)), { summary: '실행 취소', record: false })
    if (ok) useEditorStore.getState().moveUndoToRedo()
  }, [submit])

  const redo = useCallback(async () => {
    const store = useEditorStore.getState()
    const ops = store.redoStack[store.redoStack.length - 1]
    if (!ops) return
    const ok = await submit((m) => applyOps(m, ops), { summary: '다시 실행', record: false })
    if (ok) useEditorStore.getState().moveRedoToUndo()
  }, [submit])

  return { undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }
}
```

- [ ] **Step 5: 테스트 통과 확인** — `pnpm --filter @erdd/web test undo-redo use-model` → PASS.

- [ ] **Step 6: 웹 전체 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS(기존 27개 + 신규 유지).

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/use-model.ts apps/web/src/editor/undo-redo.test.tsx
git commit -m "feat(web): undo/redo — 역op 재제출·스토어 히스토리·선택 확장·seq 단조"
```

---

## Task 4: 웹 관계 엣지 렌더링·드래그 생성

**Files:**
- Create: `apps/web/src/editor/edges.ts`, `apps/web/src/editor/relationship-edge.tsx`, `apps/web/src/editor/edges.test.ts`
- Modify: `apps/web/src/editor/table-node.tsx`(핸들), `apps/web/src/editor/canvas.tsx`(엣지·onConnect·변수 섀도잉 정리)

**Interfaces:**
- Consumes: `ProjectModel`, `createRelationshipFromParentPk`(Task 1), `useModelMutation`(Task 3), `newId`.
- Produces:
  ```ts
  buildEdges(model: ProjectModel): Edge[]   // @xyflow/react Edge, 각 edge.id = relationship.id
  ```

### 설계 (읽고 시작)

- **Phase 1 범위 확정:** 캔버스 드래그는 **헤더 드래그(테이블→테이블)**만 지원한다. 핸들은 테이블 노드 좌/우 양측(`Handle` 2개). `connectionMode="loose"`로 어느 핸들이든 연결 가능. 컬럼 단위 드래그·컬럼별 핸들은 두지 않는다(성능·복잡도). "기존 컬럼으로 매핑"은 관계 패널(Task 5)에서 처리.
- **드래그 방향:** 자식에서 시작해 부모에서 끝난다 → React Flow `onConnect({ source, target })`에서 `source`=자식, `target`=부모. `createRelationshipFromParentPk({ parentTableId: target, childTableId: source, newColumnIds: [부모 PK 수만큼 newId()] })`.
- **부모 PK 없음:** producer가 no-op(Task 1)이라 diff가 비어 저장 안 됨 → onConnect에서 부모 PK 수를 미리 확인해 0이면 `toast.error('부모 테이블에 기본 키가 없습니다')` 후 중단.
- **엣지 표기:** 커스텀 엣지 `relationship`. `getSmoothStepPath`. 부모 끝 = one(막대), 자식 끝 = 1:N이면 many(까마귀발)·1:1이면 one. 식별=실선, 비식별=`strokeDasharray`. 선택 시 primary 색.
- **핸들 위치 휴리스틱:** buildEdges에서 부모/자식 노드 x 좌표를 비교해 가까운 쪽 핸들(`sourceHandle`/`targetHandle`: `'l'`|`'r'`)을 고른다. 좌표를 못 구하면 기본 `r`→`l`.

### Steps

- [ ] **Step 1: 실패 테스트** — `apps/web/src/editor/edges.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildEdges } from './edges.js'
import type { ProjectModel } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { id: 'P', logicalName: 'P', physicalName: 'P', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
  m.tables['C'] = { id: 'C', logicalName: 'C', physicalName: 'C', comment: null, groupId: null, position: { x: 400, y: 0 }, groupPosition: null }
  m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C', columnMappings: [], cardinality: '1:N', identifying: false, name: null }
  return m
}

describe('buildEdges', () => {
  it('관계마다 엣지를 만들고 id는 관계 id다', () => {
    const edges = buildEdges(model())
    expect(edges).toHaveLength(1)
    expect(edges[0]!.id).toBe('R')
    expect(edges[0]!.type).toBe('relationship')
  })
  it('source=자식, target=부모', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.source).toBe('C')
    expect(edges[0]!.target).toBe('P')
  })
  it('엣지 data에 카디널리티·식별 여부를 담는다', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.data).toMatchObject({ cardinality: '1:N', identifying: false })
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web test edges` → FAIL.

- [ ] **Step 3: edges.ts 구현**

```ts
import type { Edge } from '@xyflow/react'
import type { ProjectModel } from '@erdd/core'

export type RelationshipEdgeData = {
  cardinality: '1:1' | '1:N'
  identifying: boolean
}

export function buildEdges(model: ProjectModel): Edge[] {
  return Object.values(model.relationships).map((rel) => {
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    // 자식이 부모보다 오른쪽이면 자식의 왼쪽 핸들 → 부모의 오른쪽 핸들.
    const childRight = !!parent && !!child && child.position.x >= parent.position.x
    return {
      id: rel.id,
      source: rel.childTableId,
      target: rel.parentTableId,
      sourceHandle: childRight ? 'l' : 'r',
      targetHandle: childRight ? 'r' : 'l',
      type: 'relationship',
      data: { cardinality: rel.cardinality, identifying: rel.identifying },
    }
  })
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/web test edges` → PASS.

- [ ] **Step 5: relationship-edge.tsx 구현** (까마귀발 마커 + 엣지)

```tsx
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { RelationshipEdgeData } from './edges.js'

/** 캔버스에 한 번 렌더하는 까마귀발 SVG 마커 정의. Canvas에서 마운트한다. */
export function RelationshipMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {/* one: 짧은 수직 막대 */}
        <marker id="erd-one" viewBox="0 0 20 20" markerWidth="20" markerHeight="20"
          refX="16" refY="10" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M16,2 L16,18" stroke="var(--color-muted-foreground)" strokeWidth="1.5" fill="none" />
        </marker>
        {/* many: 까마귀발 */}
        <marker id="erd-many" viewBox="0 0 20 20" markerWidth="20" markerHeight="20"
          refX="2" refY="10" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M18,2 L2,10 L18,18 M2,10 L18,10" stroke="var(--color-muted-foreground)"
            strokeWidth="1.5" fill="none" />
        </marker>
      </defs>
    </svg>
  )
}

export function RelationshipEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props
  const data = props.data as RelationshipEdgeData | undefined
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const identifying = data?.identifying ?? false
  const many = (data?.cardinality ?? '1:N') === '1:N'
  return (
    <BaseEdge
      id={props.id}
      path={path}
      // source=자식 끝, target=부모 끝. 부모는 항상 one, 자식은 1:N이면 many.
      markerStart={many ? 'url(#erd-many)' : 'url(#erd-one)'}
      markerEnd="url(#erd-one)"
      style={{
        stroke: selected ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
        strokeWidth: selected ? 2 : 1.5,
        strokeDasharray: identifying ? undefined : '6 4',
      }}
    />
  )
}
```

(주: `EdgeLabelRenderer` import는 관계명 라벨 표시 여지를 위한 것이나 Phase 1에서 미사용이면 import를 제거해 lint를 통과시킬 것. 관계명 라벨은 선택 시 패널에서만 편집.)

- [ ] **Step 6: table-node.tsx에 핸들 추가**

`table-node.tsx` 상단 import에 `Handle, Position` 추가, 최상위 `<div>` 안(래퍼 내부)에 좌/우 핸들을 넣는다. 핸들은 시각적으로 최소화(작게, 반투명)하되 연결 가능해야 한다.

```tsx
import { Handle, Position } from '@xyflow/react'
// ... 기존 import 유지

// 컴포넌트 return의 최상위 래퍼 div 안, 헤더 위쪽에 삽입:
<Handle id="l" type="source" position={Position.Left}
  className="!h-3 !w-3 !border !border-muted-foreground/50 !bg-background" />
<Handle id="r" type="source" position={Position.Right}
  className="!h-3 !w-3 !border !border-muted-foreground/50 !bg-background" />
```

(핸들 2개 모두 `type="source"` + Canvas의 `connectionMode="loose"`로 양방향 연결 허용. `!` 프리픽스는 React Flow 기본 핸들 스타일을 덮어쓰기 위함.)

기존 `table-node.test.tsx`가 `<Handle>` 렌더 시 `ReactFlowProvider` 컨텍스트를 요구할 수 있으므로, 테스트가 깨지면 렌더를 `ReactFlowProvider`로 감싼다.

- [ ] **Step 7: canvas.tsx 수정** — 엣지·마커·onConnect·변수 섀도잉 정리

```tsx
import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeChange,
} from '@xyflow/react'
import { toast } from 'sonner'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { buildEdges } from './edges.js'
import { TableNode, type TableNodeData } from './table-node.js'
import { RelationshipEdge, RelationshipMarkers } from './relationship-edge.js'
import { useModelMutation } from './use-model.js'
import { moveTable } from './model-edits.js'
import { newId } from './uid.js'
import { createRelationshipFromParentPk } from '@erdd/core'

const nodeTypes = { table: TableNode }
const edgeTypes = { relationship: RelationshipEdge }

export function Canvas({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const selectedRelId = useEditorStore((s) => s.selectedRelationshipId)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const focusTableId = useEditorStore((s) => s.focusTableId)
  const consumeFocus = useEditorStore((s) => s.consumeFocus)
  const mutate = useModelMutation(projectId)
  const rf = useReactFlow()

  const derived = useMemo(
    () => buildNodes(model, viewMode, selectedId),
    [model, viewMode, selectedId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>(derived)
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

  const edges = useMemo<Edge[]>(() => {
    const built = buildEdges(model)
    return selectedRelId ? built.map((e) => (e.id === selectedRelId ? { ...e, selected: true } : e)) : built
  }, [model, selectedRelId])

  useEffect(() => {
    if (!focusTableId) return
    const node = rf.getNode(focusTableId)
    if (node) rf.setCenter(node.position.x + 120, node.position.y + 60, { zoom: 1, duration: 400 })
    consumeFocus()
  }, [focusTableId, rf, consumeFocus])

  const onConnect = (conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return
    const parentTableId = conn.target // 부모
    const childTableId = conn.source  // 자식
    const pkCount = Object.values(model.columns)
      .filter((c) => c.tableId === parentTableId && c.isPk).length
    if (pkCount === 0) {
      toast.error('부모 테이블에 기본 키가 없습니다')
      return
    }
    const relationshipId = newId()
    const newColumnIds = Array.from({ length: pkCount }, () => newId())
    void mutate(
      (m) => createRelationshipFromParentPk(m, { relationshipId, parentTableId, childTableId, newColumnIds }),
      { summary: '관계 생성' },
    )
    selectRelationship(relationshipId)
  }

  return (
    <div className="relative flex-1 min-w-0">
      <RelationshipMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange as (c: NodeChange[]) => void}
        onConnect={onConnect}
        onNodeClick={(_, node) => select(node.id)}
        onEdgeClick={(_, edge) => selectRelationship(edge.id)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, __, dragged) =>
          void mutate(
            (m) => dragged.reduce((acc, n) => moveTable(acc, n.id, { x: n.position.x, y: n.position.y }), m),
            { summary: '테이블 이동' },
          )}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
```

(핵심 변경: `edges`/`edgeTypes`/`onConnect`/`onEdgeClick` 추가, `connectionMode=Loose`, drag 콜백 파라미터를 `nodes`→`dragged`로 개명해 섀도잉 제거, 마커 마운트를 위한 `relative` 래퍼. `flex-1`을 래퍼로 옮겨 캔버스가 공간을 채우도록.)

- [ ] **Step 8: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS. table-node 테스트가 Provider 필요로 깨지면 수정.

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/editor/edges.ts apps/web/src/editor/edges.test.ts apps/web/src/editor/relationship-edge.tsx apps/web/src/editor/table-node.tsx apps/web/src/editor/canvas.tsx
git commit -m "feat(web): 관계 엣지 렌더·드래그 생성 — 까마귀발 표기·핸들"
```

---

## Task 5: 웹 관계 편집 패널 + 캐스케이드 위임

**Files:**
- Create: `apps/web/src/editor/relationship-panel.tsx`, `apps/web/src/editor/relationship-panel.test.tsx`
- Modify: `apps/web/src/editor/edit-panel.tsx`(분기), `apps/web/src/editor/model-edits.ts`·`column-edits.ts`(core 위임), `apps/web/src/editor/toolbar.tsx`(undo/redo 버튼·단축키)

**Interfaces:**
- Consumes: `setRelationshipIdentifying`, `deleteRelationship`, `remapRelationshipChildColumn`, `deleteTableCascade`, `deleteColumnCascade`(Task 1), `useUndoRedo`(Task 3).
- Produces: `RelationshipPanel({ projectId })`.

### Steps

- [ ] **Step 1: model-edits.ts / column-edits.ts를 core 캐스케이드로 위임**

`model-edits.ts`의 `removeTable`을 교체:
```ts
import { deleteTableCascade, type Position, type ProjectModel, type Table } from '@erdd/core'
// ... addTable/moveTable/updateTable 유지 ...
export function removeTable(model: ProjectModel, id: string): ProjectModel {
  return deleteTableCascade(model, id)
}
```

`column-edits.ts`의 `removeColumn`을 교체:
```ts
import { deleteColumnCascade, type Column, type ProjectModel } from '@erdd/core'
// ...
export function removeColumn(model: ProjectModel, id: string): ProjectModel {
  return deleteColumnCascade(model, id)
}
```

기존 `model-edits.test.ts`/`column-edits.test.ts`의 removeTable/removeColumn 테스트가 여전히 통과하는지 확인(관계 없는 케이스는 동일 동작).

- [ ] **Step 2: relationship-panel.tsx 구현**

```tsx
import { Trash2 } from 'lucide-react'
import { setRelationshipIdentifying, deleteRelationship, remapRelationshipChildColumn } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function RelationshipPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const relId = useEditorStore((s) => s.selectedRelationshipId)!
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const mutate = useModelMutation(projectId)
  const rel = model.relationships[relId]
  if (!rel) return null

  const parent = model.tables[rel.parentTableId]
  const child = model.tables[rel.childTableId]
  const childColumns = Object.values(model.columns)
    .filter((c) => c.tableId === rel.childTableId)
    .sort((a, b) => a.order - b.order)

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">관계</h3>
        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="관계 삭제"
          onClick={() => { selectRelationship(null); void mutate((m) => deleteRelationship(m, relId), { summary: '관계 삭제' }) }}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        <span className="font-mono">{child?.physicalName}</span> →{' '}
        <span className="font-mono">{parent?.physicalName}</span>
      </p>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>카디널리티</Label>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={rel.cardinality}
            onChange={(e) => void mutate((m) => {
              const r = m.relationships[relId]!
              return { ...m, relationships: { ...m.relationships, [relId]: { ...r, cardinality: e.target.value as '1:1' | '1:N' } } }
            })}>
            <option value="1:N">1 : N</option>
            <option value="1:1">1 : 1</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rel.identifying}
            onChange={(e) => void mutate((m) => setRelationshipIdentifying(m, relId, e.target.checked), { summary: '식별 관계 전환' })} />
          식별 관계 (자식 기본 키 편입)
        </label>

        <div className="grid gap-1.5">
          <Label>관계명</Label>
          <input className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={rel.name ?? ''}
            key={rel.name ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim() === '' ? null : e.target.value
              if (v !== rel.name) void mutate((m) => {
                const r = m.relationships[relId]!
                return { ...m, relationships: { ...m.relationships, [relId]: { ...r, name: v } } }
              })
            }} />
        </div>

        <div className="grid gap-1.5">
          <Label>컬럼 매핑</Label>
          <ul className="grid gap-2">
            {rel.columnMappings.map((mm) => {
              const p = model.columns[mm.parentColumnId]
              return (
                <li key={mm.parentColumnId} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 text-xs">
                  <select className="h-8 rounded border bg-background px-1 font-mono" value={mm.childColumnId}
                    onChange={(e) => void mutate((m) => remapRelationshipChildColumn(m, { relationshipId: relId, parentColumnId: mm.parentColumnId, newChildColumnId: e.target.value }), { summary: '매핑 변경' })}>
                    {childColumns.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
                  </select>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate font-mono text-muted-foreground">{p?.physicalName ?? '?'}</span>
                </li>
              )
            })}
            {rel.columnMappings.length === 0 && <li className="text-xs text-muted-foreground">매핑 없음</li>}
          </ul>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: edit-panel.tsx 분기** — 선택 종류에 따라 패널 전환

`EditPanel` 상단에서 selectedRelationshipId가 있으면 `RelationshipPanel`을, selectedNoteId가 있으면(Task 6에서 채움) `NotePanel`을 렌더. 현재는 relationship 분기만 추가:

```tsx
import { RelationshipPanel } from './relationship-panel.js'
// EditPanel 본문 시작에 추가:
const selectedRelationshipId = useEditorStore((s) => s.selectedRelationshipId)
if (selectedRelationshipId) return <RelationshipPanel projectId={projectId} />
// 이하 기존 테이블/빈 상태 로직 유지
```

- [ ] **Step 4: toolbar.tsx에 undo/redo 버튼·단축키**

```tsx
import { Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useEditorStore } from './store.js'
import { useModelMutation, useUndoRedo } from './use-model.js'
import { newId } from './uid.js'
import { addTable, removeTable } from './model-edits.js'
import { Button } from '@/components/ui/button'

export function Toolbar({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)
  const { undo, redo, canUndo, canRedo } = useUndoRedo(projectId)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)
  const rf = useReactFlow()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const onAdd = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    void mutate((m) => addTable(m, { id, position: center }), { summary: '테이블 추가' })
    select(id)
  }
  const onDelete = () => {
    if (!selectedTableId) return
    const id = selectedTableId
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      <Button size="sm" variant="outline" disabled={!selectedTableId} onClick={onDelete}>
        <Trash2 /> 삭제
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" className="size-8" disabled={!canUndo} aria-label="실행 취소" onClick={() => void undo()}>
        <Undo2 className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" disabled={!canRedo} aria-label="다시 실행" onClick={() => void redo()}>
        <Redo2 className="size-4" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: relationship-panel.test.tsx** — 관계 선택 시 삭제 버튼·식별 체크박스 렌더, 삭제 클릭 시 mutate 호출 검증(tRPC 목은 기존 edit-panel.test.tsx 패턴 재사용). 최소 2개 테스트.

- [ ] **Step 6: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/relationship-panel.tsx apps/web/src/editor/relationship-panel.test.tsx apps/web/src/editor/edit-panel.tsx apps/web/src/editor/model-edits.ts apps/web/src/editor/column-edits.ts apps/web/src/editor/toolbar.tsx
git commit -m "feat(web): 관계 편집 패널·캐스케이드 위임·undo/redo 버튼과 단축키"
```

---

## Task 6: 웹 메모(Note)

**Files:**
- Create: `apps/web/src/editor/note-edits.ts`, `apps/web/src/editor/note-node.tsx`, `apps/web/src/editor/note-panel.tsx`, `apps/web/src/editor/note-edits.test.ts`
- Modify: `apps/web/src/editor/canvas.tsx`(노트 노드·드래그 분기), `apps/web/src/editor/edit-panel.tsx`(노트 분기), `apps/web/src/editor/toolbar.tsx`(메모 추가 버튼)

**Interfaces:**
- Consumes: `Note`, `ProjectModel`, `Position` from `@erdd/core`; `useModelMutation`; `newId`.
- Produces: `addNote`, `updateNote`, `moveNote`, `removeNote`(note-edits.ts); `NoteNode`; `NotePanel`.

### 설계

- Note는 이미 core 모델에 존재(`NoteSchema`). 서버 영속화도 M3 경로로 자동 지원.
- 기본 색상: 도면 팔레트의 부드러운 노란 계열(예: `#FDF6E3` 배경). color 필드에 hex 저장.
- 노트 노드 타입 `note`. 드래그 이동은 canvas onNodeDragStop에서 `node.type`으로 분기(table→moveTable, note→moveNote).

### Steps

- [ ] **Step 1: note-edits.ts + 테스트**

```ts
import type { Note, Position, ProjectModel } from '@erdd/core'

const DEFAULT_COLOR = '#FDF6E3'

export function addNote(model: ProjectModel, { id, position }: { id: string; position: Position }): ProjectModel {
  const note: Note = { id, content: '메모', position, color: DEFAULT_COLOR }
  return { ...model, notes: { ...model.notes, [id]: note } }
}
export function moveNote(model: ProjectModel, id: string, position: Position): ProjectModel {
  const note = model.notes[id]
  if (!note) return model
  return { ...model, notes: { ...model.notes, [id]: { ...note, position } } }
}
export function updateNote(model: ProjectModel, id: string, patch: Partial<Pick<Note, 'content' | 'color'>>): ProjectModel {
  const note = model.notes[id]
  if (!note) return model
  return { ...model, notes: { ...model.notes, [id]: { ...note, ...patch } } }
}
export function removeNote(model: ProjectModel, id: string): ProjectModel {
  const notes = { ...model.notes }
  delete notes[id]
  return { ...model, notes }
}
```

테스트(`note-edits.test.ts`): addNote가 기본 content·color를 넣는지, moveNote/updateNote/removeNote 동작, 없는 id no-op. (model-edits.test.ts 패턴 준수, 4~5개.)

- [ ] **Step 2: note-node.tsx**

```tsx
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { Note } from '@erdd/core'

export type NoteNodeData = { note: Note; selected: boolean }

export function NoteNode({ data }: NodeProps) {
  const { note, selected } = data as unknown as NoteNodeData
  return (
    <div
      className="min-h-16 min-w-40 max-w-64 rounded-md border p-2 text-xs shadow-sm"
      style={{ background: note.color, borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        outline: selected ? '2px solid var(--color-primary)' : undefined }}
    >
      <p className="whitespace-pre-wrap break-words text-ink/90">{note.content}</p>
    </div>
  )
}
```

(`NodeResizer` import는 미사용이면 제거. 텍스트 색은 도면 ink 토큰.)

- [ ] **Step 3: note-panel.tsx** — 내용(textarea)·색상(color input)·삭제

```tsx
import { Trash2 } from 'lucide-react'
import { updateNote, removeNote } from './note-edits.js'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function NotePanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const noteId = useEditorStore((s) => s.selectedNoteId)!
  const selectNote = useEditorStore((s) => s.selectNote)
  const mutate = useModelMutation(projectId)
  const note = model.notes[noteId]
  if (!note) return null
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">메모</h3>
        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="메모 삭제"
          onClick={() => { selectNote(null); void mutate((m) => removeNote(m, noteId), { summary: '메모 삭제' }) }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="note-content">내용</Label>
          <textarea id="note-content" className="min-h-24 rounded-md border bg-background p-2 text-sm"
            defaultValue={note.content} key={note.content}
            onBlur={(e) => { if (e.target.value !== note.content) void mutate((m) => updateNote(m, noteId, { content: e.target.value })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-color">색상</Label>
          <input id="note-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={note.color} key={note.color}
            onBlur={(e) => { if (e.target.value !== note.color) void mutate((m) => updateNote(m, noteId, { color: e.target.value })) }} />
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: canvas.tsx에 노트 노드 통합** — `nodeTypes`에 `note` 추가, 노드 배열에 노트 노드 합치기, 드래그·클릭 분기

`buildNodes`는 테이블만 만들므로 canvas에서 노트 노드를 별도로 만들어 합친다:
```tsx
import { NoteNode, type NoteNodeData } from './note-node.js'
import { moveNote } from './note-edits.js'
// nodeTypes에 추가:
const nodeTypes = { table: TableNode, note: NoteNode }
// selectedNoteId 구독, selectNote 구독 추가
// derived를 테이블+노트로:
const derived = useMemo(() => {
  const tableNodes = buildNodes(model, viewMode, selectedId)
  const noteNodes: Node[] = Object.values(model.notes).map((note) => ({
    id: note.id, type: 'note', position: note.position,
    data: { note, selected: note.id === selectedNoteId } satisfies NoteNodeData,
  }))
  return [...tableNodes, ...noteNodes]
}, [model, viewMode, selectedId, selectedNoteId])
// onNodeClick 분기: node.type === 'note' ? selectNote(node.id) : select(node.id)
// onNodeDragStop 분기: type별 moveTable/moveNote
onNodeDragStop={(_, __, dragged) =>
  void mutate((m) => dragged.reduce((acc, n) =>
    n.type === 'note' ? moveNote(acc, n.id, n.position) : moveTable(acc, n.id, n.position), m),
    { summary: '이동' })}
```

(nodes 상태 타입을 `Node<TableNodeData>`에서 `Node`로 넓힌다. onNodesChange 캐스팅 유지.)

- [ ] **Step 5: edit-panel.tsx에 노트 분기 추가**

```tsx
import { NotePanel } from './note-panel.js'
// relationship 분기 다음에:
const selectedNoteId = useEditorStore((s) => s.selectedNoteId)
if (selectedNoteId) return <NotePanel projectId={projectId} />
```

- [ ] **Step 6: toolbar.tsx에 메모 추가 버튼**

```tsx
import { FileText, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { addNote } from './note-edits.js'
import { newId } from './uid.js'
// onAddNote:
const selectNote = useEditorStore((s) => s.selectNote)
const onAddNote = () => {
  const id = newId()
  const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  void mutate((m) => addNote(m, { id, position: center }), { summary: '메모 추가' })
  selectNote(id)
}
// 툴바에 버튼 추가:
<Button size="sm" variant="outline" onClick={onAddNote}><FileText /> 메모</Button>
```

- [ ] **Step 7: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/note-edits.ts apps/web/src/editor/note-edits.test.ts apps/web/src/editor/note-node.tsx apps/web/src/editor/note-panel.tsx apps/web/src/editor/canvas.tsx apps/web/src/editor/edit-panel.tsx apps/web/src/editor/toolbar.tsx
git commit -m "feat(web): 메모 — 캔버스 노트 노드·편집 패널·추가 버튼"
```

---

## Task 7: 웹 유효성 경고 배지

**Files:**
- Create: `apps/web/src/editor/warning-badge.tsx`, `apps/web/src/editor/warning-badge.test.tsx`
- Modify: `apps/web/src/editor/nodes.ts`(경고 데이터 주입), `apps/web/src/editor/table-node.tsx`(테이블·컬럼 배지), `apps/web/src/editor/edit-panel.tsx`(컬럼 배지), `apps/web/src/editor/relationship-panel.tsx`(관계 배지)

**Interfaces:**
- Consumes: `computeWarnings`, `type Warning`(Task 2).
- Produces: `WarningBadge({ warnings })` — 경고 배열을 받아 개수·툴팁을 표시하는 작은 배지.

### 설계

- 경고는 저장을 막지 않으므로 순수 표시. `computeWarnings(model)`를 canvas/패널에서 `useMemo`로 계산해 관련 엔티티별로 그룹화.
- 표시 위치: (a) 테이블 노드 헤더 우측에 해당 테이블 관련 경고 개수 배지(테이블 소속 컬럼의 duplicate-physical + 그 테이블이 부모/자식인 관계 경고), (b) 테이블 노드 컬럼 행에 해당 컬럼 경고 마커, (c) 편집 패널 컬럼 행, (d) 관계 패널 상단.
- 배지 색: destructive 계열 아님(경고는 주의 수준) — key gold(`text-key`)나 amber. 도면 팔레트상 경고는 amber/gold 톤 권장.

### Steps

- [ ] **Step 1: warning-badge.tsx + 테스트**

```tsx
import { AlertTriangle } from 'lucide-react'
import type { Warning } from '@erdd/core'
import { cn } from '@/lib/utils'

export function WarningBadge({ warnings, className }: { warnings: Warning[]; className?: string }) {
  if (warnings.length === 0) return null
  const title = warnings.map((w) => w.message).join('\n')
  return (
    <span title={title} aria-label={`경고 ${warnings.length}건: ${title}`}
      className={cn('inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-key', className)}>
      <AlertTriangle className="size-3" />
      {warnings.length}
    </span>
  )
}
```

테스트(`warning-badge.test.tsx`): 경고 0건이면 아무것도 렌더 안 함(null), 2건이면 "2"와 aria-label 표시. 2개 테스트.

- [ ] **Step 2: nodes.ts에 경고 데이터 주입** — `buildNodes` 시그니처에 warnings 추가

```ts
import type { Warning } from '@erdd/core'
// TableNodeData에 columnWarnings, tableWarnings 추가는 table-node.tsx에서; nodes.ts는 계산해 전달.
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null, warnings: Warning[],
): Node<TableNodeData>[] {
  return Object.values(model.tables).map((table) => {
    const tableCols = Object.values(model.columns).filter((c) => c.tableId === table.id)
    const colIds = new Set(tableCols.map((c) => c.id))
    const relIds = new Set(Object.values(model.relationships)
      .filter((r) => r.parentTableId === table.id || r.childTableId === table.id).map((r) => r.id))
    const tableWarnings = warnings.filter((w) =>
      (w.scope === 'column' && w.tableId === table.id) || (w.scope === 'relationship' && relIds.has(w.entityId)))
    const columnWarnings: Record<string, Warning[]> = {}
    for (const w of warnings) {
      if (w.scope === 'column' && colIds.has(w.entityId)) {
        (columnWarnings[w.entityId] ??= []).push(w)
      }
    }
    return {
      id: table.id, type: 'table', position: table.position,
      data: { table, columns: tableCols, viewMode, selected: table.id === selectedId, tableWarnings, columnWarnings },
    }
  })
}
```

`TableNodeData`에 `tableWarnings: Warning[]`, `columnWarnings: Record<string, Warning[]>` 추가.

- [ ] **Step 3: table-node.tsx에 배지 표시** — 헤더 우측에 `WarningBadge(tableWarnings)`, 각 컬럼 행에 `columnWarnings[c.id]` 있으면 작은 마커.

- [ ] **Step 4: canvas.tsx에서 warnings 계산·전달**

```tsx
import { computeWarnings } from '@erdd/core'
const warnings = useMemo(() => computeWarnings(model), [model])
// derived useMemo에 warnings 추가:
const tableNodes = buildNodes(model, viewMode, selectedId, warnings)
// deps에 warnings 추가
```

- [ ] **Step 5: edit-panel.tsx·relationship-panel.tsx에 배지** — 편집 패널 컬럼 행에 해당 컬럼 경고, 관계 패널 상단에 해당 관계 경고. 각 패널에서 `computeWarnings(model)`를 `useMemo`로 계산해 필터.

- [ ] **Step 6: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/warning-badge.tsx apps/web/src/editor/warning-badge.test.tsx apps/web/src/editor/nodes.ts apps/web/src/editor/table-node.tsx apps/web/src/editor/canvas.tsx apps/web/src/editor/edit-panel.tsx apps/web/src/editor/relationship-panel.tsx
git commit -m "feat(web): 유효성 경고 배지 — 노드·편집/관계 패널에 표면화"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- 테이블→테이블 드래그로 관계 생성 시 부모 PK가 자식에 FK 컬럼으로 자동 생성되고 까마귀발 엣지가 그려진다.
- 부모 PK 없으면 토스트 경고, 관계 미생성.
- 식별 관계 토글 시 FK 컬럼이 자식 PK로 편입/해제되고 실선/점선이 바뀐다.
- 관계 삭제 시 자식 FK 컬럼은 일반 컬럼으로 남는다.
- 테이블 삭제 시 관련 관계는 사라지고 반대편 FK 컬럼은 보존된다.
- 컬럼 삭제 시 매핑에서 제거되고 매핑이 비면 관계도 사라진다.
- undo/redo(버튼·Cmd/Ctrl+Z·Shift): 관계 생성/식별 전환/테이블 이동/컬럼 편집이 역으로 되돌아가고 다시 실행된다. 입력 필드 포커스 중 단축키는 무시.
- 메모 추가·이동·내용/색상 편집·삭제, 새로고침 후 복원.
- 물리명 중복·타입 불일치·매핑 불완전이 노드/패널에 경고 배지로 표시되되 저장을 막지 않는다.
- 새로고침 후 관계·메모·식별 상태가 서버에서 복원된다.
- 프로젝트 전환 시 이전 프로젝트의 관계/메모/히스토리가 새 프로젝트로 새지 않는다(M4a 회귀).
- 전체 테스트(core + server + web) 통과, 타입체크 클린.

## 이월 백로그(이번에 다루는 것 / 남기는 것)

**이번 M4b에서 해결:** seq 단조 가드(Task 3), canvas 변수 섀도잉(`nodes`→`dragged`, Task 4), 다중 노드 드래그 배치(기존 유지+노트 분기).

**M5 이후로 남김:** 선택 변경 시 노드 배열 전체 재구성 경량화(perf — 노드 memo/셀렉터 분리), 다중 선택 정책(복사/붙여넣기), 자동 정렬 레이아웃, 컬럼 단위 드래그로 관계 생성, 노트 리사이즈. 빈 상태 2분기 테스트는 관련 컴포넌트 수정 시 함께 보강.
