# 관계선을 컬럼 위치에 붙인다 (복합키 포함) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관계선을 테이블 좌우 중앙이 아니라 실제 FK 컬럼 행(복합키면 합성 행 `(col1, col2)`)에 붙인다.

**Architecture:** 앵커 키를 순수 함수 `buildAnchors(model)` **한 곳**에서만 만들고, 엣지(`sourceHandle` 문자열)와 노드(`<Handle id>`)가 그 결과만 읽는다. 좌표 계산은 하지 않는다 — React Flow가 DOM 실측(`handleBounds`)으로 알아서 한다. 핸들이 모델에 따라 동적으로 붙고 떨어지므로 `updateNodeInternals` 호출이 새 의무로 붙는다.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` ^12.11.2, vitest + @testing-library/react

**설계 문서:** `docs/superpowers/specs/2026-08-12-column-anchored-edges-design.md` — 절 번호(3.3, 5.5 등)는 그 문서를 가리킨다.

## Global Constraints

- **`packages/core`·`apps/server`·`packages/cli` 를 고치지 마라.** 이 트랙은 `apps/web` 전용이다. 필요한 정보(`relationship.columnMappings`, `column.order`)는 이미 모델에 있다. 그 셋이 움직였다면 범위를 넘은 것이다.
- **마이그레이션 없음.** 모델 스키마를 건드리지 않는다.
- **앵커 키 문자열을 만드는 코드는 `anchors.ts` 밖에 있어서는 안 된다.** 엣지가 적는 handle id 와 노드가 렌더하는 `<Handle id>` 가 한 글자라도 어긋나면 React Flow 는 예외도 경고도 없이 **선을 그리지 않는다**(설계 3.3). `handleId()` 헬퍼를 반드시 거쳐라.
- 주석·커밋 메시지·문서는 **한국어**로 쓴다.
- 커밋은 **경로를 명시**한다(`git add <경로들> && git commit ... -- <경로들>`). `git add -A`/`git commit -a` 금지 — 저장소는 공유 자원이라 남의 작업 중인 파일이 섞인다.
- 커밋 메시지 말미에 트레일러 2줄을 붙인다:
  ```
  Co-Authored-By: Claude <이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- 테스트 실행: `pnpm -C apps/web exec vitest run <파일경로>`
- 타입 검사: `pnpm -s -C apps/web typecheck` — **`pnpm -s -r typecheck` 의 출력만 보고 판정하지 마라.** `-s` 가 자식 출력을 삼켜 오류가 있어도 출력이 0바이트이고 종료코드만 1이다.

## 작업 순서의 근거 (바꾸지 마라)

Task 1~4는 **핸들을 만들기만 하고 아무도 쓰지 않는다** — 화면 변화가 없고 앱은 정상이다. Task 5에서 엣지를 앵커 키로 전환하는데, 그 시점에는 붙을 핸들이 이미 전부 존재한다. 순서를 뒤집어 엣지를 먼저 전환하면 **중간 커밋에서 캔버스의 모든 관계선이 사라진다.**

---

## Task 1: `anchors.ts` — 앵커 계산 순수 함수

**Files:**
- Create: `apps/web/src/editor/anchors.ts`
- Test: `apps/web/src/editor/anchors.test.ts`

**Interfaces:**
- Consumes: `@erdd/core` 의 `ProjectModel`, `Column` 타입
- Produces:
  - `type Anchor = { key: string; columnIds: string[] }`
  - `type RelationshipAnchorKeys = { childKey: string | null; parentKey: string | null }`
  - `type AnchorIndex = { byTable: Map<string, Anchor[]>; byRelationship: Map<string, RelationshipAnchorKeys> }`
  - `function buildAnchors(model: ProjectModel): AnchorIndex`
  - `function handleId(side: 'l' | 'r', key: string | null): string`
  - `function anchorSignatures(index: AnchorIndex): Map<string, string>`
  - `function changedAnchorTables(prev: Map<string, string>, next: Map<string, string>): string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/anchors.test.ts` 를 만든다:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Column, type ProjectModel, type Table } from '@erdd/core'
import {
  anchorSignatures, buildAnchors, changedAnchorTables, handleId,
} from './anchors.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string, order: number): Column {
  return { id, tableId, logicalName: id, physicalName: id, type: 'VARCHAR(10)',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
    order, comment: null, domainId: null, custom: {} }
}

/** 부모 P(p1, p2) · 자식 C(c1, c2). 관계는 테스트마다 따로 넣는다. */
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = tbl('P')
  m.tables['C'] = tbl('C')
  m.columns['p1'] = col('p1', 'P', 0)
  m.columns['p2'] = col('p2', 'P', 1)
  m.columns['c1'] = col('c1', 'C', 0)
  m.columns['c2'] = col('c2', 'C', 1)
  return m
}

function withRel(m: ProjectModel, mappings: { childColumnId: string; parentColumnId: string }[]) {
  m.relationships['R'] = {
    id: 'R', parentTableId: 'P', childTableId: 'C',
    columnMappings: mappings, cardinality: '1:N', identifying: false, name: null,
  }
  return m
}

describe('buildAnchors', () => {
  it('단일 매핑은 양 끝 모두 c: 키를 낸다', () => {
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 'c:c1', parentKey: 'c:p1' })
    expect(a.byTable.get('C')).toEqual([{ key: 'c:c1', columnIds: ['c1'] }])
    expect(a.byTable.get('P')).toEqual([{ key: 'c:p1', columnIds: ['p1'] }])
  })

  it('복합 매핑은 s: 키를 내고 컬럼은 order 순으로 고정 정렬된다', () => {
    // 매핑 배열을 일부러 역순으로 준다 — 입력 순서가 키에 새면 안 된다.
    const a = buildAnchors(withRel(model(), [
      { childColumnId: 'c2', parentColumnId: 'p2' },
      { childColumnId: 'c1', parentColumnId: 'p1' },
    ]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 's:c1+c2', parentKey: 's:p1+p2' })
    expect(a.byTable.get('C')).toEqual([{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }])
  })

  it('order가 같으면 컬럼 id 사전순으로 결정된다', () => {
    const m = model()
    m.columns['c2']!.order = 0 // c1과 동률
    const a = buildAnchors(withRel(m, [
      { childColumnId: 'c2', parentColumnId: 'p2' },
      { childColumnId: 'c1', parentColumnId: 'p1' },
    ]))
    expect(a.byRelationship.get('R')!.childKey).toBe('s:c1+c2')
  })

  it('같은 childColumnId가 두 번 담겨도 단일 앵커로 남는다', () => {
    // remapRelationshipChildColumn이 실제로 이런 매핑을 만든다.
    const a = buildAnchors(withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c1', parentColumnId: 'p2' },
    ]))
    expect(a.byRelationship.get('R')!.childKey).toBe('c:c1')
    expect(a.byRelationship.get('R')!.parentKey).toBe('s:p1+p2')
  })

  it('빈 columnMappings는 양 끝이 null이다', () => {
    const a = buildAnchors(withRel(model(), []))
    expect(a.byRelationship.get('R')).toEqual({ childKey: null, parentKey: null })
    expect(a.byTable.size).toBe(0)
  })

  it('모델에 없는 컬럼을 가리키면 그 끝만 null이다', () => {
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'GONE', parentColumnId: 'p1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: null, parentKey: 'c:p1' })
  })

  it('매핑 컬럼이 그 관계의 테이블 소속이 아니면 걸러진다', () => {
    // c1은 C 소속인데 부모(P) 쪽 매핑에 들어왔다 — 잘못된 모델에서 엉뚱한 행에 붙지 않게 한다.
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'c1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 'c:c1', parentKey: null })
  })

  it('두 관계가 같은 조합을 쓰면 그 테이블의 앵커는 하나다', () => {
    const m = withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ])
    m.tables['C2'] = tbl('C2')
    m.relationships['R2'] = {
      id: 'R2', parentTableId: 'C', childTableId: 'C2',
      // 부모(C) 쪽이 R과 같은 조합이다.
      columnMappings: [
        { childColumnId: 'c1', parentColumnId: 'c1' },
        { childColumnId: 'c2', parentColumnId: 'c2' },
      ],
      cardinality: '1:N', identifying: false, name: null,
    }
    const a = buildAnchors(m)
    expect(a.byTable.get('C')).toHaveLength(1)
    expect(a.byTable.get('C')![0]!.key).toBe('s:c1+c2')
  })

  it('한 테이블의 앵커 목록은 단일 먼저·복합 나중으로 고정 정렬된다', () => {
    const m = withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ])
    m.tables['P2'] = tbl('P2')
    m.columns['q1'] = col('q1', 'P2', 0)
    m.relationships['R2'] = {
      id: 'R2', parentTableId: 'P2', childTableId: 'C',
      columnMappings: [{ childColumnId: 'c2', parentColumnId: 'q1' }],
      cardinality: '1:N', identifying: false, name: null,
    }
    const a = buildAnchors(m)
    expect(a.byTable.get('C')!.map((x) => x.key)).toEqual(['c:c2', 's:c1+c2'])
  })
})

describe('handleId', () => {
  it('키가 있으면 side:key, 없으면 side만 낸다(중앙 폴백)', () => {
    expect(handleId('l', 'c:c1')).toBe('l:c:c1')
    expect(handleId('r', 's:c1+c2')).toBe('r:s:c1+c2')
    expect(handleId('l', null)).toBe('l')
    expect(handleId('r', null)).toBe('r')
  })
})

describe('anchorSignatures / changedAnchorTables', () => {
  it('앵커가 그대로면 바뀐 테이블이 없다', () => {
    const m = withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])
    const sig = anchorSignatures(buildAnchors(m))
    expect(changedAnchorTables(sig, anchorSignatures(buildAnchors(m)))).toEqual([])
  })

  it('관계가 생기면 두 테이블이 바뀐 것으로 나온다', () => {
    const before = anchorSignatures(buildAnchors(model()))
    const after = anchorSignatures(buildAnchors(
      withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])))
    expect(changedAnchorTables(before, after).sort()).toEqual(['C', 'P'])
  })

  it('관계가 사라져 앵커가 0개가 된 테이블도 바뀐 것으로 나온다', () => {
    const before = anchorSignatures(buildAnchors(
      withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])))
    const after = anchorSignatures(buildAnchors(model()))
    expect(changedAnchorTables(before, after).sort()).toEqual(['C', 'P'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/anchors.test.ts`
Expected: FAIL — `Failed to resolve import "./anchors.js"`

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/anchors.ts` 를 만든다:

```ts
import type { Column, ProjectModel } from '@erdd/core'

/** 한 테이블 안에서 관계선이 붙는 한 지점. 컬럼 id 집합으로 식별된다. */
export type Anchor = {
  /** `c:<컬럼id>`(단일) 또는 `s:<컬럼id>+<컬럼id>`(복합) */
  key: string
  /** column.order 오름차순(동률이면 컬럼 id 사전순)으로 고정 정렬된 컬럼 id */
  columnIds: string[]
}

/** 관계 하나의 양 끝 앵커 키. null이면 그 끝은 중앙 핸들 폴백(설계 3.5). */
export type RelationshipAnchorKeys = { childKey: string | null; parentKey: string | null }

export type AnchorIndex = {
  /** 테이블 id → 그 테이블에 렌더할 앵커 목록(키로 중복 제거, 순서 고정) */
  byTable: Map<string, Anchor[]>
  /** 관계 id → 양 끝 앵커 키 */
  byRelationship: Map<string, RelationshipAnchorKeys>
}

/**
 * 핸들 id 를 만드는 **유일한 자리**. 엣지의 `sourceHandle`/`targetHandle` 과 노드의
 * `<Handle id>` 가 반드시 이 함수를 거쳐야 한다 — 한 글자만 어긋나도 React Flow 는
 * 붙일 핸들을 못 찾고 예외도 경고도 없이 **선을 그리지 않는다**(설계 3.3).
 *
 * 키가 null 이면 기존 중앙 핸들 id(`l`/`r`)를 그대로 낸다.
 */
export function handleId(side: 'l' | 'r', key: string | null): string {
  return key === null ? side : `${side}:${key}`
}

/**
 * 유효한 컬럼만 남겨 앵커를 만든다. 남는 것이 없으면 null(→ 중앙 폴백).
 *
 * - 중복 제거: `remapRelationshipChildColumn` 이 같은 childColumnId 를 두 번 담을 수 있다.
 *   중복을 세면 단일 관계가 복합으로 오인되어 없는 합성 행을 가리킨다(설계 3.6).
 * - 소속 검사: 매핑이 다른 테이블의 컬럼을 가리키는 깨진 모델에서 엉뚱한 행에 붙지 않게 한다.
 */
function anchorOf(model: ProjectModel, tableId: string, columnIds: string[]): Anchor | null {
  const cols = [...new Set(columnIds)]
    .map((id) => model.columns[id])
    .filter((c): c is Column => c !== undefined && c.tableId === tableId)
  if (cols.length === 0) return null
  // 정렬을 고정하지 않으면 같은 조합이 columnMappings 배열 순서에 따라 다른 키가 되어,
  // 같은 행에 붙어야 할 두 관계가 서로 다른(존재하지 않는) 핸들을 가리킨다.
  const ids = [...cols]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => c.id)
  return { key: ids.length === 1 ? `c:${ids[0]}` : `s:${ids.join('+')}`, columnIds: ids }
}

/** 앵커 목록 정렬용 — 첫 컬럼의 order. */
function firstOrder(model: ProjectModel, a: Anchor): number {
  return model.columns[a.columnIds[0]!]?.order ?? 0
}

export function buildAnchors(model: ProjectModel): AnchorIndex {
  const byTable = new Map<string, Anchor[]>()
  const byRelationship = new Map<string, RelationshipAnchorKeys>()

  const add = (tableId: string, anchor: Anchor | null) => {
    if (anchor === null) return
    const list = byTable.get(tableId)
    if (list === undefined) { byTable.set(tableId, [anchor]); return }
    if (!list.some((a) => a.key === anchor.key)) list.push(anchor)
  }

  for (const rel of Object.values(model.relationships)) {
    const child = anchorOf(model, rel.childTableId, rel.columnMappings.map((m) => m.childColumnId))
    const parent = anchorOf(model, rel.parentTableId, rel.columnMappings.map((m) => m.parentColumnId))
    add(rel.childTableId, child)
    add(rel.parentTableId, parent)
    byRelationship.set(rel.id, { childKey: child?.key ?? null, parentKey: parent?.key ?? null })
  }

  // 순서를 고정한다 — 흔들리면 합성 행이 렌더마다 자리를 바꾼다.
  // 단일(컬럼 행에 붙는 것) 먼저, 복합(합성 행) 나중.
  for (const list of byTable.values()) {
    list.sort((a, b) =>
      (a.columnIds.length === 1 ? 0 : 1) - (b.columnIds.length === 1 ? 0 : 1)
      || firstOrder(model, a) - firstOrder(model, b)
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
  return { byTable, byRelationship }
}

/** 테이블별 앵커 키 서명. `updateNodeInternals` 대상을 고르는 데 쓴다(설계 5.5). */
export function anchorSignatures(index: AnchorIndex): Map<string, string> {
  const out = new Map<string, string>()
  for (const [tableId, list] of index.byTable) out.set(tableId, list.map((a) => a.key).join('|'))
  return out
}

/** 서명이 달라졌거나 사라진 테이블 id. 앵커가 0개가 된 테이블도 갱신 대상이다. */
export function changedAnchorTables(
  prev: Map<string, string>, next: Map<string, string>,
): string[] {
  const changed: string[] = []
  for (const [id, sig] of next) if (prev.get(id) !== sig) changed.push(id)
  for (const id of prev.keys()) if (!next.has(id)) changed.push(id)
  return changed
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/anchors.test.ts`
Expected: PASS (12건)

- [ ] **Step 5: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/anchors.ts apps/web/src/editor/anchors.test.ts && \
git commit -m "feat: 관계선이 붙을 앵커를 계산하는 순수 함수를 만든다

단일 FK 는 c:<컬럼id>, 복합 FK 는 s:<id>+<id> 키를 낸다. 키를 만드는 자리는
handleId 하나뿐이다 — 엣지와 노드가 서로 다른 문자열을 만들면 선이 조용히 사라진다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/anchors.ts apps/web/src/editor/anchors.test.ts
```

---

## Task 2: `buildNodes` 가 앵커를 노드에 싣는다

**Files:**
- Modify: `apps/web/src/editor/nodes.ts`
- Modify: `apps/web/src/editor/table-node.tsx:9-19` (`TableNodeData` 타입에 필드 추가만)
- Test: `apps/web/src/editor/nodes.test.ts`

**Interfaces:**
- Consumes: Task 1의 `buildAnchors`, `AnchorIndex`, `Anchor`
- Produces:
  - `TableNodeData` 에 `anchors?: Anchor[]` 필드(**optional** — 이 컴포넌트를 직접 렌더하는 기존 테스트들이 깨지지 않게 한다. `buildNodes` 는 항상 채워 넣는다)
  - `buildNodes(model, viewMode, selectedIds, warnings, view?, peerMarks?, columnSelection?, anchors?)` — 8번째 인자, 기본값 `buildAnchors(model)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/nodes.test.ts` 끝에 붙인다:

```ts
describe('buildNodes — 앵커 전달', () => {
  function relModel(): ProjectModel {
    const m = model()
    m.relationships['R'] = {
      id: 'R', parentTableId: 'T1', childTableId: 'T2',
      columnMappings: [{ childColumnId: 'C2', parentColumnId: 'C1' }],
      cardinality: '1:N', identifying: false, name: null,
    }
    return m
  }

  it('테이블마다 자기 앵커 목록을 싣는다', () => {
    const nodes = buildNodes(relModel(), 'physical', new Set<string>(), [])
    const t1 = nodes.find((n) => n.id === 'T1')!
    const t2 = nodes.find((n) => n.id === 'T2')!
    expect(t1.data.anchors).toEqual([{ key: 'c:C1', columnIds: ['C1'] }])
    expect(t2.data.anchors).toEqual([{ key: 'c:C2', columnIds: ['C2'] }])
  })

  it('앵커가 없는 테이블은 빈 배열을 받는다', () => {
    const nodes = buildNodes(model(), 'physical', new Set<string>(), [])
    for (const n of nodes) expect(n.data.anchors).toEqual([])
  })

  it('앵커를 넘기지 않아도 자기 계산으로 올바른 값을 싣는다', () => {
    // 인자를 빠뜨려도 결과가 옳아야 한다 — 배선 누락이 "조용한 중앙 폴백"으로 숨지 않게 한다.
    const withArg = buildNodes(relModel(), 'physical', new Set<string>(), [],
      undefined, undefined, {}, buildAnchors(relModel()))
    const without = buildNodes(relModel(), 'physical', new Set<string>(), [])
    expect(without.map((n) => n.data.anchors)).toEqual(withArg.map((n) => n.data.anchors))
  })
})
```

파일 상단 import 에 `buildAnchors` 를 추가한다:

```ts
import { buildAnchors } from './anchors.js'
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/nodes.test.ts`
Expected: FAIL — `expected undefined to deeply equal [ ... ]`

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/table-node.tsx` 의 `TableNodeData` 에 필드를 더한다(렌더는 Task 3에서 한다):

```tsx
import type { Anchor } from './anchors.js'

export type TableNodeData = {
  table: Table
  columns: Column[]
  viewMode: ViewMode
  selected: boolean
  tableWarnings?: Warning[]
  columnWarnings?: Record<string, Warning[]>
  peers?: PeerMark[]
  selectedColumnIds?: readonly string[]
  onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  /** 이 테이블에서 관계선이 붙는 지점들. 단일은 컬럼 행에, 복합은 합성 행에 렌더된다. */
  anchors?: Anchor[]
}
```

`apps/web/src/editor/nodes.ts` 를 고친다:

```ts
import { buildAnchors, type AnchorIndex } from './anchors.js'

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: ReadonlySet<string>, warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
  columnSelection: {
    selectedColumnIds?: readonly string[]
    onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  } = {},
  // 기본값을 undefined 가 아니라 **자기 계산**으로 둔다 — 인자를 빠뜨려도 결과가 옳다.
  // undefined 였다면 배선 누락이 "전부 중앙으로 조용히 폴백"으로 나타나 눈에 띄지 않는다.
  anchors: AnchorIndex = buildAnchors(model),
): Node<TableNodeData>[] {
```

`data` 객체에 한 줄을 더한다(`onColumnClick` 아래):

```ts
        onColumnClick: columnSelection.onColumnClick,
        anchors: anchors.byTable.get(table.id) ?? [],
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/nodes.test.ts`
Expected: PASS (기존 건 + 신규 3건)

- [ ] **Step 5: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/nodes.ts apps/web/src/editor/nodes.test.ts apps/web/src/editor/table-node.tsx && \
git commit -m "feat: buildNodes 가 테이블별 앵커를 노드 데이터에 싣는다

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/nodes.ts apps/web/src/editor/nodes.test.ts apps/web/src/editor/table-node.tsx
```

---

## Task 3: 컬럼 행 핸들 + 합성 행 렌더

**Files:**
- Create: `apps/web/src/editor/anchor-handles.tsx`
- Modify: `apps/web/src/editor/table-node.tsx`
- Test: `apps/web/src/editor/table-node.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `handleId`, `Anchor` / Task 2의 `TableNodeData.anchors`
- Produces: `<AnchorHandles anchorKey={string} />` — 보이지 않는 좌·우 핸들 한 쌍. 고스트 노드(Task 4)도 이것을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/table-node.test.tsx` 끝에 붙인다:

```tsx
describe('TableNode — 앵커 핸들과 합성 행', () => {
  const handleIds = (c: HTMLElement) =>
    [...c.querySelectorAll('[data-handleid]')].map((el) => el.getAttribute('data-handleid'))

  it('단일 앵커 컬럼 행에 좌·우 핸들이 붙는다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }],
    })
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l:c:c1', 'r:c:c1']))
  })

  it('앵커가 아닌 컬럼에는 핸들이 없다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }],
    })
    expect(handleIds(container)).not.toContain('l:c:c2')
  })

  it('기존 중앙 핸들은 그대로 남는다', () => {
    // 드래그 연결의 시작점이자 폴백 자리다 — 없어지면 관계를 만들 수 없다.
    const { container } = renderNode({ ...DATA, viewMode: 'physical', anchors: [] })
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l', 'r']))
  })

  it('복합 앵커는 컬럼 목록 맨 아래에 합성 행으로 렌더된다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(MBR_NO, MBR_NM)')).toBeInTheDocument()
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l:s:c1+c2', 'r:s:c1+c2']))
    // 맨 아래여야 한다 — 컬럼 행보다 뒤에 온다.
    const items = [...container.querySelectorAll('li')].map((el) => el.textContent ?? '')
    expect(items.at(-1)).toContain('(MBR_NO, MBR_NM)')
  })

  it('합성 행 라벨은 논리 모드에서 논리명을 쓴다', () => {
    renderNode({
      ...DATA, viewMode: 'logical',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(회원번호, 회원명)')).toBeInTheDocument()
  })

  it('혼합 모드에서 합성 행은 물리명만 쓴다', () => {
    // 컬럼 2~3개의 논리명·물리명을 한 줄에 다 넣으면 노드가 과하게 넓어진다(설계 D-4).
    renderNode({
      ...DATA, viewMode: 'mixed',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(MBR_NO, MBR_NM)')).toBeInTheDocument()
    expect(screen.queryByText('(회원번호, 회원명)')).not.toBeInTheDocument()
  })

  it('합성 행을 클릭해도 컬럼 선택이 일어나지 않는다', async () => {
    const onColumnClick = vi.fn()
    renderNode({
      ...DATA, viewMode: 'physical', onColumnClick,
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    await userEvent.click(screen.getByText('(MBR_NO, MBR_NM)'))
    expect(onColumnClick).not.toHaveBeenCalled()
  })

  it('앵커를 주지 않아도 렌더된다', () => {
    // anchors 는 optional 이다 — 이 컴포넌트를 직접 렌더하는 기존 테스트들이 깨지면 안 된다.
    const { container } = renderNode({ ...DATA, viewMode: 'physical' })
    expect(handleIds(container)).toEqual(['l', 'r'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/table-node.test.tsx`
Expected: FAIL — `Unable to find an element with the text: (MBR_NO, MBR_NM)`

- [ ] **Step 3: `anchor-handles.tsx` 를 만든다**

```tsx
import { Handle, Position } from '@xyflow/react'
import { handleId } from './anchors.js'

/**
 * 관계선이 붙는 **표시 전용** 핸들 한 쌍. 보이지 않고 연결 대상도 아니다 —
 * 관계 생성 드래그는 테이블 좌우의 보이는 중앙 핸들(`l`/`r`)이 계속 전담한다(설계 D-3).
 *
 * ⚠️ `display:none`·`hidden` 으로 감추지 마라. `getBoundingClientRect` 가 전부 0이 되어
 * React Flow 가 재는 `handleBounds` 좌표가 무너진다. 크기를 0으로 하되 렌더는 시킨다 —
 * 위치(x·y)는 그래도 정확하고, React Flow 는 핸들 중심을 `x + width/2` 로 잡는다.
 *
 * 이 컴포넌트를 담는 요소에 `relative` 가 있어야 한다. Handle 은 `position: absolute` 라
 * **가장 가까운 positioned 조상** 기준으로 배치되므로, 빠뜨리면 노드 루트 기준이 되어
 * 모든 앵커가 같은 자리에 겹친다.
 */
export function AnchorHandles({ anchorKey }: { anchorKey: string }) {
  const cls = '!h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent'
  return (
    <>
      <Handle id={handleId('l', anchorKey)} type="source" position={Position.Left}
        isConnectable={false} className={cls} />
      <Handle id={handleId('r', anchorKey)} type="source" position={Position.Right}
        isConnectable={false} className={cls} />
    </>
  )
}
```

- [ ] **Step 4: `table-node.tsx` 를 고친다**

import 를 더한다:

```tsx
import { AnchorHandles } from './anchor-handles.js'
import type { Anchor } from './anchors.js'
```

구조 분해에 `anchors` 를 더하고, 앵커를 두 갈래로 나눈다(`const sorted = ...` 아래):

```tsx
  const { table, columns, viewMode, selected, tableWarnings = [], columnWarnings = {}, peers = [],
    selectedColumnIds = [], onColumnClick, anchors = [] } = data
  const peerColorHex = peers[0]?.color
  const sorted = [...columns].sort((a, b) => a.order - b.order)
  const mixed = viewMode === 'mixed'
  // 단일 앵커는 그 컬럼 행에, 복합 앵커는 맨 아래 합성 행에 붙는다.
  const anchorByColumn = new Map(
    anchors.filter((a) => a.columnIds.length === 1).map((a) => [a.columnIds[0]!, a]))
  const composites = anchors.filter((a) => a.columnIds.length > 1)
  const columnById = new Map(columns.map((c) => [c.id, c]))
  /** 합성 행 라벨. 혼합 모드는 물리명만 쓴다 — 둘 다 넣으면 노드가 과하게 넓어진다(설계 D-4). */
  const compositeLabel = (a: Anchor) =>
    `(${a.columnIds.map((id) => {
      const c = columnById.get(id)
      if (c === undefined) return id
      return viewMode === 'logical' ? c.logicalName : c.physicalName
    }).join(', ')})`
```

컬럼 `<li>` 에 `relative` 를 더하고 핸들을 넣는다:

```tsx
              className={cn(
                'relative flex items-center gap-2 px-3 py-1.5 text-xs',
                selectedColumnIds.includes(c.id) && 'bg-primary/10',
                onColumnClick && 'cursor-pointer',
              )}
              onClick={(e) => { /* 기존 그대로 */ }}
            >
              {anchorByColumn.has(c.id) && (
                <AnchorHandles anchorKey={anchorByColumn.get(c.id)!.key} />
              )}
              <span className="flex w-4 shrink-0 justify-center">
```

컬럼 목록의 "컬럼 없음" 항목 **뒤에**, `</ul>` 앞에 합성 행을 넣는다:

```tsx
        {sorted.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">컬럼 없음</li>
        )}
        {composites.map((a) => (
          <li key={a.key} className="relative bg-secondary/40 px-3 py-1.5 text-xs font-medium">
            <AnchorHandles anchorKey={a.key} />
            <span className={cn(viewMode !== 'logical' && 'font-mono')}>{compositeLabel(a)}</span>
          </li>
        ))}
      </ul>
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/table-node.test.tsx`
Expected: PASS (기존 건 + 신규 8건)

- [ ] **Step 6: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/anchor-handles.tsx apps/web/src/editor/table-node.tsx apps/web/src/editor/table-node.test.tsx && \
git commit -m "feat: 테이블 노드가 컬럼 행 핸들과 복합키 합성 행을 그린다

핸들은 보이지 않고 연결 대상도 아니다 — 관계 생성 드래그는 기존 중앙 핸들이
계속 전담한다. 아직 아무 엣지도 이 핸들을 쓰지 않으므로 화면은 그대로다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/anchor-handles.tsx apps/web/src/editor/table-node.tsx apps/web/src/editor/table-node.test.tsx
```

---

## Task 4: 고스트 노드도 같은 앵커 핸들을 갖는다

**Files:**
- Modify: `apps/web/src/editor/ghost-nodes.ts`
- Modify: `apps/web/src/editor/ghost-node.tsx`
- Test: `apps/web/src/editor/ghost-nodes.test.ts`
- Create: `apps/web/src/editor/ghost-node.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `buildAnchors`·`AnchorIndex`·`Anchor`, Task 3의 `AnchorHandles`
- Produces:
  - `GhostNodeData` 에 `anchors: Anchor[]` 필드
  - `buildGhostNodes(model, groupId, anchors?)` — 3번째 인자, 기본값 `buildAnchors(model)`

**왜 필요한가:** 고스트는 헤더만 있고 컬럼 행이 없다. 그래도 그 테이블의 앵커 핸들을 **전부, 같은 자리에 겹쳐서** 렌더한다. 그러면 `buildEdges`(Task 5)가 "상대가 고스트인가"를 알 필요가 없고 엣지는 언제나 앵커 키만 쓴다(설계 3.4). 결과 그림은 기존과 같다 — 헤더 중앙에서 선이 나간다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/ghost-nodes.test.ts` 끝에 붙인다(파일이 없으면 아래 import 를 포함해 새로 만든다):

```ts
import { buildAnchors } from './anchors.js'

describe('buildGhostNodes — 앵커 전달', () => {
  it('고스트 노드도 원본 테이블의 앵커 목록을 싣는다', () => {
    // 그룹 g1 안의 자식 C 가 그룹 밖 부모 P 를 참조한다 → P 가 고스트로 나온다.
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: 'G', color: '#000', comment: null }
    m.tables['P'] = { id: 'P', logicalName: 'P', physicalName: 'P', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    m.tables['C'] = { id: 'C', logicalName: 'C', physicalName: 'C', comment: null,
      groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {} }
    m.columns['p1'] = { id: 'p1', tableId: 'P', logicalName: 'p1', physicalName: 'p1',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.columns['c1'] = { id: 'c1', tableId: 'C', logicalName: 'c1', physicalName: 'c1',
      type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'c1', parentColumnId: 'p1' }],
      cardinality: '1:N', identifying: false, name: null }

    const ghosts = buildGhostNodes(m, 'g1', buildAnchors(m))
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]!.data.anchors).toEqual([{ key: 'c:p1', columnIds: ['p1'] }])
  })
})
```

`apps/web/src/editor/ghost-node.test.tsx` 를 새로 만든다:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { GhostNode } from './ghost-node.js'
import type { GhostNodeData } from './ghost-nodes.js'

afterEach(() => { cleanup() })

const TABLE = {
  id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
  groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
}

function renderGhost(data: GhostNodeData) {
  // GhostNode 는 NodeProps 를 받지만 실제로 읽는 것은 data 뿐이다.
  return render(
    <ReactFlowProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <GhostNode {...({ data } as any)} />
    </ReactFlowProvider>,
  )
}

describe('GhostNode', () => {
  it('앵커 핸들을 전부 렌더한다', () => {
    // 컬럼 행이 없어도 핸들은 있어야 한다 — 없으면 그룹↔외부 관계선이 사라진다(설계 3.4).
    const { container } = renderGhost({
      table: TABLE, targetGroupId: null,
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }, { key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    const ids = [...container.querySelectorAll('[data-handleid]')]
      .map((el) => el.getAttribute('data-handleid'))
    expect(ids).toEqual(expect.arrayContaining([
      'l', 'r', 'l:c:c1', 'r:c:c1', 'l:s:c1+c2', 'r:s:c1+c2',
    ]))
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ghost-nodes.test.ts src/editor/ghost-node.test.tsx`
Expected: FAIL — `anchors` 가 `GhostNodeData` 에 없다는 타입 오류 / `expected [ 'l', 'r' ] to contain 'l:c:c1'`

- [ ] **Step 3: `ghost-nodes.ts` 를 고친다**

```ts
import { buildAnchors, type Anchor, type AnchorIndex } from './anchors.js'

export type GhostNodeData = {
  table: Table
  targetGroupId: string | null
  /** 원본 테이블의 앵커 전체. 고스트에는 컬럼 행이 없어 전부 헤더 중앙에 겹쳐 렌더된다. */
  anchors: Anchor[]
}

export function buildGhostNodes(
  model: ProjectModel, groupId: string, anchors: AnchorIndex = buildAnchors(model),
): Node<GhostNodeData>[] {
```

`data` 를 고친다:

```ts
      data: { table, targetGroupId: table.groupId, anchors: anchors.byTable.get(id) ?? [] },
```

- [ ] **Step 4: `ghost-node.tsx` 를 고친다**

import 를 더한다:

```tsx
import { AnchorHandles } from './anchor-handles.js'
```

구조 분해에 `anchors` 를 더하고, 기존 `l`/`r` 핸들 아래에 앵커 핸들을 전부 렌더한다:

```tsx
  const { table, targetGroupId, anchors } = data as unknown as GhostNodeData
```

```tsx
      <Handle id="r" type="source" position={Position.Right} isConnectable={isConnectable}
        className="!h-2 !w-2 !border !border-muted-foreground/40 !bg-background" />
      {/*
        컬럼 행이 없으므로 앵커 핸들이 전부 같은 자리(헤더 세로 중앙)에 겹친다. 그래도 렌더한다 —
        그래야 buildEdges 가 "상대가 고스트인가"를 몰라도 되고, 엣지는 언제나 앵커 키만 쓴다.
        결과 그림은 기존과 같다(헤더 중앙에서 선이 나간다).
      */}
      {anchors.map((a) => <AnchorHandles key={a.key} anchorKey={a.key} />)}
```

`GhostNode` 를 감싸는 `<div>` 는 이미 positioned 가 아니다 — `className` 에 `relative` 를 더한다:

```tsx
      className="relative min-w-40 cursor-pointer rounded-lg border border-dashed bg-card/50 px-3 py-2 text-left opacity-70 hover:opacity-100"
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/ghost-nodes.test.ts src/editor/ghost-node.test.tsx`
Expected: PASS

- [ ] **Step 6: 타입 검사 + 전체 web 스위트**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

Run: `pnpm -C apps/web exec vitest run`
Expected: 전부 PASS — `GhostNodeData` 에 필수 필드를 더했으므로 고스트를 만드는 다른 테스트가 깨질 수 있다. 깨지면 그 테스트에 `anchors: []` 를 채워 고친다.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/ghost-nodes.ts apps/web/src/editor/ghost-nodes.test.ts apps/web/src/editor/ghost-node.tsx apps/web/src/editor/ghost-node.test.tsx && \
git commit -m "feat: 고스트 노드도 같은 앵커 핸들을 헤더 중앙에 겹쳐 갖는다

buildEdges 가 상대가 고스트인지 몰라도 되게 해 폴백 분기를 하나 없앤다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/ghost-nodes.ts apps/web/src/editor/ghost-nodes.test.ts apps/web/src/editor/ghost-node.tsx apps/web/src/editor/ghost-node.test.tsx
```

---

## Task 5: `buildEdges` 가 앵커 키로 붙는다 (여기서 선이 옮겨간다)

**Files:**
- Modify: `apps/web/src/editor/edges.ts:13-38`
- Test: `apps/web/src/editor/edges.test.ts`

**Interfaces:**
- Consumes: Task 1의 `buildAnchors`·`handleId`·`AnchorIndex`
- Produces: `buildEdges(model, visibleTableIds?, peerMarks?, anchors?)` — 4번째 인자, 기본값 `buildAnchors(model)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/edges.test.ts` 의 `describe('buildEdges', ...)` 안에 붙인다:

```ts
  it('단일 FK 는 양 끝 모두 컬럼 앵커 핸들에 붙는다', () => {
    const m = model()
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.columns['cc'] = { id: 'cc', tableId: 'C', logicalName: 'cc', physicalName: 'cc',
      type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'cc', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    // 자식 C(x=400)가 부모 P(x=0)보다 오른쪽 → 자식은 왼쪽, 부모는 오른쪽.
    expect(e.sourceHandle).toBe('l:c:cc')
    expect(e.targetHandle).toBe('r:c:pc')
  })

  it('복합 FK 는 양 끝 모두 합성 앵커 핸들에 붙는다', () => {
    const m = model()
    for (const [id, tableId, order] of [
      ['p1', 'P', 0], ['p2', 'P', 1], ['c1', 'C', 0], ['c2', 'C', 1],
    ] as const) {
      m.columns[id] = { id, tableId, logicalName: id, physicalName: id, type: 'INT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
        order, comment: null, domainId: null, custom: {} }
    }
    m.relationships['R']!.columnMappings = [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('l:s:c1+c2')
    expect(e.targetHandle).toBe('r:s:p1+p2')
  })

  it('빈 매핑 관계는 양 끝 모두 중앙 핸들로 폴백한다', () => {
    // DDL/DBML 가져오기가 이런 관계를 만든다 — 예외가 아니라 정상 경로다(설계 3.5).
    const e = buildEdges(model())[0]!
    expect(e.sourceHandle).toBe('l')
    expect(e.targetHandle).toBe('r')
  })

  it('한쪽 매핑만 깨졌으면 그 끝만 중앙으로 폴백한다', () => {
    const m = model()
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'GONE', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('l')          // 자식 끝만 폴백
    expect(e.targetHandle).toBe('r:c:pc')     // 부모 끝은 앵커
  })

  it('부모가 자식보다 오른쪽이면 좌우가 뒤집힌다', () => {
    const m = model()
    m.tables['P']!.position = { x: 800, y: 0 } // 부모를 오른쪽으로
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.columns['cc'] = { id: 'cc', tableId: 'C', logicalName: 'cc', physicalName: 'cc',
      type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'cc', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('r:c:cc')
    expect(e.targetHandle).toBe('l:c:pc')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edges.test.ts`
Expected: FAIL — `expected 'l' to be 'l:c:cc'`

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/edges.ts` 상단에 import 를 더한다:

```ts
import { buildAnchors, handleId, type AnchorIndex } from './anchors.js'
```

`buildEdges` 를 고친다:

```ts
export function buildEdges(
  model: ProjectModel, visibleTableIds?: Set<string>, peerMarks: PeerMarks = new Map(),
  // 기본값을 자기 계산으로 둔다(nodes.ts 와 같은 이유) — 인자를 빠뜨려도 결과가 옳다.
  anchors: AnchorIndex = buildAnchors(model),
): Edge[] {
  const edges: Edge[] = []
  for (const rel of Object.values(model.relationships)) {
    if (visibleTableIds && (!visibleTableIds.has(rel.parentTableId) || !visibleTableIds.has(rel.childTableId))) {
      continue
    }
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    // 자식이 부모보다 오른쪽이면 자식의 왼쪽 핸들 → 부모의 오른쪽 핸들.
    // 좌우 판정 근거는 앵커가 생겨도 여전히 **테이블 위치**다(설계 3.7).
    const childRight = !!parent && !!child && child.position.x >= parent.position.x
    // 앵커 키가 null 인 끝은 기존 중앙 핸들('l'/'r')로 떨어진다 — 양 끝을 각각 판정한다.
    const keys = anchors.byRelationship.get(rel.id)
    edges.push({
      id: rel.id,
      source: rel.childTableId,
      target: rel.parentTableId,
      sourceHandle: handleId(childRight ? 'l' : 'r', keys?.childKey ?? null),
      targetHandle: handleId(childRight ? 'r' : 'l', keys?.parentKey ?? null),
      type: 'relationship',
      data: {
        cardinality: rel.cardinality, identifying: rel.identifying, peers: peerMarks.get(rel.id),
      },
    })
  }
  return edges
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edges.test.ts`
Expected: PASS (기존 건 + 신규 5건). 기존 픽스처는 `columnMappings: []` 라 폴백 경로를 타므로 그대로 통과해야 한다.

- [ ] **Step 5: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edges.ts apps/web/src/editor/edges.test.ts && \
git commit -m "feat: 관계선을 컬럼 앵커 핸들에 붙인다

단일 FK 는 컬럼 행, 복합 FK 는 합성 행에 붙는다. 매핑이 비었거나 깨진 끝만
기존 중앙 핸들로 폴백한다. 좌우 판정은 그대로 테이블 위치 기준이다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/edges.ts apps/web/src/editor/edges.test.ts
```

> **이 커밋 시점의 알려진 공백:** 관계를 새로 만들거나 지운 **직후**에는 선이 옛 자리에 남거나 붙지 못할 수 있다. React Flow 가 핸들 집합 변화를 자동으로 반영하지 않기 때문이고, Task 6이 해소한다.

---

## Task 6: `canvas.tsx` 배선 + `updateNodeInternals`

**Files:**
- Modify: `apps/web/src/editor/canvas.tsx`

**Interfaces:**
- Consumes: Task 1의 `buildAnchors`·`anchorSignatures`·`changedAnchorTables`, Task 2·4·5의 확장된 시그니처
- Produces: 없음(배선)

**왜 필요한가:** 핸들 집합이 이제 모델에 따라 변한다(관계 추가·삭제 → 그 두 테이블의 앵커가 늘고 준다). React Flow 는 `<Handle>` 이 붙고 떨어져도 `handleBounds` 를 **자동으로 다시 파싱하지 않는다** — `updateNodeInternals(id)` 를 명시적으로 불러야 한다(v12 의 dynamic handles 규칙). 부르지 않으면 관계를 만든 직후 선이 옛 자리에 남는다.

- [ ] **Step 1: import 를 더한다**

```tsx
import {
  Background, Controls, MiniMap, ReactFlow, ConnectionMode,
  useNodesState, useReactFlow, useUpdateNodeInternals,
  type Connection, type Edge, type Node, type NodeChange, type XYPosition,
} from '@xyflow/react'
```

```tsx
import { anchorSignatures, buildAnchors, changedAnchorTables } from './anchors.js'
```

- [ ] **Step 2: 앵커를 한 번 계산해 셋 모두에 넘긴다**

`peerMarks` 계산 아래에 더한다:

```tsx
  // 앵커는 노드·엣지·고스트 셋이 함께 읽는다 — 한 번만 계산해 넘긴다(설계 3.3).
  const anchors = useMemo(() => buildAnchors(model), [model])
```

`derived` 의 `buildNodes`·`buildGhostNodes` 호출에 넘긴다:

```tsx
    const tableNodes = buildNodes(
      model, viewMode, selectedIds, warnings, view, peerMarks,
      { selectedColumnIds, onColumnClick }, anchors)
    if (view.kind === 'group') {
      const ghostNodes = buildGhostNodes(model, view.groupId, anchors)
      return [...ghostNodes, ...tableNodes]
    }
```

`derived` 의 deps 배열 끝에 `anchors` 를 더한다:

```tsx
  }, [model, viewMode, selectedIds, selectedColumnIds, onColumnClick, selectedNoteId, selectedGroupId, canEdit, warnings, peerMarks, anchors, view.kind, view.kind === 'group' ? view.groupId : null])
```

`edges` 의 `buildEdges`·`buildGhostNodes` 호출에도 넘기고 deps 에 `anchors` 를 더한다:

```tsx
  const edges = useMemo<Edge[]>(() => {
    const built = view.kind === 'group'
      ? buildEdges(model, new Set([
          ...Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id),
          ...buildGhostNodes(model, view.groupId, anchors).map((g) => g.data.table.id),
        ]), peerMarks, anchors)
      : buildEdges(model, undefined, peerMarks, anchors)
    return selectedRelId ? built.map((e) => (e.id === selectedRelId ? { ...e, selected: true } : e)) : built
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 객체는 매 렌더 새로 만들어지므로 kind/groupId로 분해해 넣는다.
  }, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId, peerMarks, anchors])
```

- [ ] **Step 3: `updateNodeInternals` effect 를 더한다**

`keepMeasured` 를 부르는 effect(`canvas.tsx:162`) 바로 아래에 넣는다:

```tsx
  /**
   * 핸들 집합이 바뀐 테이블에 `updateNodeInternals` 를 건다.
   *
   * ⚠️ 앵커 핸들은 **모델에 따라 붙고 떨어진다**(관계를 만들거나 지우면 그 두 테이블의 앵커가
   * 늘고 준다). React Flow 는 그 변화를 자동으로 반영하지 않으므로 — `handleBounds` 는
   * `updateNodeInternals` 가 DOM 을 다시 재야 갱신된다 — 부르지 않으면 관계를 만든 직후
   * 선이 옛 자리에 남거나 붙지 못한다.
   *
   * `keepMeasured`(위 effect)와 방향이 반대이자 상보적이다. 그쪽은 선택이 바뀌었을 뿐인데
   * `measured` 가 날아가 `handleBounds` 까지 함께 버려지는 것을 **막고**, 이쪽은 핸들이 실제로
   * 바뀌었는데 옛 측정이 남는 것을 **갱신으로** 막는다. 둘 중 하나만 있으면 각각 깜박임과
   * 선 어긋남이 난다.
   *
   * 서명이 같은 테이블은 건드리지 않는다 — 매 렌더 전부 부르면 그때마다 DOM 을 다시 재는
   * 비용이 붙는다. 첫 실행에서는 모든 테이블이 대상이 되는데(이전 서명이 비어 있다) 무해하다.
   */
  const updateNodeInternals = useUpdateNodeInternals()
  const prevAnchorSigs = useRef(new Map<string, string>())
  useEffect(() => {
    const next = anchorSignatures(anchors)
    const changed = changedAnchorTables(prevAnchorSigs.current, next)
    prevAnchorSigs.current = next
    if (changed.length > 0) updateNodeInternals(changed)
  }, [anchors, updateNodeInternals])
```

- [ ] **Step 4: web 스위트 전체를 돌린다**

Run: `pnpm -C apps/web exec vitest run`
Expected: 전부 PASS

- [ ] **Step 5: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/canvas.tsx && \
git commit -m "feat: 앵커를 한 번 계산해 넘기고 핸들 변화에 updateNodeInternals 를 건다

핸들이 모델에 따라 붙고 떨어지므로 React Flow 에 재측정을 시켜야 한다.
keepMeasured 와 방향이 반대이자 상보적이다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/canvas.tsx
```

---

## Task 7: 교차 검증 테스트 (급소를 잠근다)

**Files:**
- Create: `apps/web/src/editor/anchor-wiring.test.tsx`

**Interfaces:**
- Consumes: Task 1~5의 전부

**왜 별도 태스크인가:** 설계 3.3의 불변식 — "앵커 키의 소재지는 한 곳" — 이 깨지는 순간을 잡는 **유일한** 방어다. 엣지가 적는 handle id 와 노드가 렌더하는 `<Handle id>` 가 어긋나면 React Flow 는 예외도 경고도 없이 선을 그리지 않으므로, 단위 테스트들이 각자 초록이어도 화면에서는 선이 사라진다.

- [ ] **Step 1: 테스트를 쓴다**

`apps/web/src/editor/anchor-wiring.test.tsx`:

```tsx
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { createEmptyModel, type Column, type ProjectModel, type Table } from '@erdd/core'
import { buildAnchors } from './anchors.js'
import { buildEdges } from './edges.js'
import { buildNodes } from './nodes.js'
import { buildGhostNodes } from './ghost-nodes.js'
import { TableNode } from './table-node.js'
import { GhostNode } from './ghost-node.js'

afterEach(() => { cleanup() })

function tbl(id: string, x: number, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string, order: number): Column {
  return { id, tableId, logicalName: id, physicalName: id, type: 'INT',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
    order, comment: null, domainId: null, custom: {} }
}

/**
 * 첨부 이미지의 4테이블 모델을 축약한 것. 단일 FK · 복합 FK · 빈 매핑 관계 · 그룹 경계를
 * 넘는 관계(고스트)를 전부 담는다.
 */
function fixture(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['g1'] = { id: 'g1', name: '주문', color: '#4A90D9', comment: null }
  m.tables['orders'] = tbl('orders', 0, 'g1')
  m.tables['products'] = tbl('products', 0, null)      // 그룹 밖 → 고스트로 나온다
  m.tables['items'] = tbl('items', 400, 'g1')
  m.tables['options'] = tbl('options', 800, 'g1')
  m.columns['o_id'] = col('o_id', 'orders', 0)
  m.columns['p_id'] = col('p_id', 'products', 0)
  m.columns['i_o'] = col('i_o', 'items', 0)
  m.columns['i_p'] = col('i_p', 'items', 1)
  m.columns['x_o'] = col('x_o', 'options', 1)
  m.columns['x_p'] = col('x_p', 'options', 2)
  m.relationships['r_o'] = { id: 'r_o', parentTableId: 'orders', childTableId: 'items',
    columnMappings: [{ childColumnId: 'i_o', parentColumnId: 'o_id' }],
    cardinality: '1:N', identifying: false, name: null }
  m.relationships['r_p'] = { id: 'r_p', parentTableId: 'products', childTableId: 'items',
    columnMappings: [{ childColumnId: 'i_p', parentColumnId: 'p_id' }],
    cardinality: '1:N', identifying: false, name: null }
  m.relationships['r_x'] = { id: 'r_x', parentTableId: 'items', childTableId: 'options',
    columnMappings: [
      { childColumnId: 'x_o', parentColumnId: 'i_o' },
      { childColumnId: 'x_p', parentColumnId: 'i_p' },
    ],
    cardinality: '1:N', identifying: false, name: null }
  m.tables['orphan'] = tbl('orphan', 1200, 'g1')
  m.relationships['r_empty'] = { id: 'r_empty', parentTableId: 'orders', childTableId: 'orphan',
    columnMappings: [], cardinality: '1:N', identifying: false, name: null }
  return m
}

/** 노드 하나를 렌더해 DOM 에 실제로 나온 handle id 를 모은다. */
function renderedHandleIds(element: ReactElement): string[] {
  const { container, unmount } = render(<ReactFlowProvider>{element}</ReactFlowProvider>)
  const ids = [...container.querySelectorAll('[data-handleid]')]
    .map((el) => el.getAttribute('data-handleid')!)
  unmount()
  return ids
}

describe('앵커 배선 교차 검증', () => {
  it('전체 뷰: buildEdges 가 가리키는 핸들은 전부 실제로 렌더된다', () => {
    const m = fixture()
    const anchors = buildAnchors(m)
    const wanted = buildEdges(m, undefined, undefined, anchors)
      .flatMap((e) => [e.sourceHandle, e.targetHandle])
      .filter((h): h is string => typeof h === 'string')
    expect(wanted.length).toBeGreaterThan(0)

    const rendered = new Set<string>()
    for (const node of buildNodes(m, 'physical', new Set<string>(), [], undefined, undefined, {}, anchors)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<TableNode data={node.data as any} />)) rendered.add(id)
    }
    for (const h of wanted) expect([...rendered]).toContain(h)
  })

  it('그룹 뷰: 고스트로 가는 엣지의 핸들도 전부 실제로 렌더된다', () => {
    const m = fixture()
    const anchors = buildAnchors(m)
    const ghosts = buildGhostNodes(m, 'g1', anchors)
    expect(ghosts.length).toBeGreaterThan(0) // products 가 고스트로 나와야 한다
    const visible = new Set([
      ...Object.values(m.tables).filter((t) => t.groupId === 'g1').map((t) => t.id),
      ...ghosts.map((g) => g.data.table.id),
    ])
    const wanted = buildEdges(m, visible, undefined, anchors)
      .flatMap((e) => [e.sourceHandle, e.targetHandle])
      .filter((h): h is string => typeof h === 'string')

    const rendered = new Set<string>()
    for (const node of buildNodes(m, 'physical', new Set<string>(), [],
      { kind: 'group', groupId: 'g1' }, undefined, {}, anchors)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<TableNode data={node.data as any} />)) rendered.add(id)
    }
    for (const g of ghosts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<GhostNode {...({ data: g.data } as any)} />)) rendered.add(id)
    }
    for (const h of wanted) expect([...rendered]).toContain(h)
  })
})
```

- [ ] **Step 2: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/anchor-wiring.test.tsx`
Expected: PASS (2건)

- [ ] **Step 3: 구분력을 실증한다 (생략 금지)**

이 테스트는 **그린 상태로 추가되므로**, 공허하지 않다는 것을 직접 보여야 한다.

⚠️ `anchors.ts` 의 `handleId` 를 고치는 것으로는 실증되지 않는다 — 엣지와 노드가 **함께** 바뀌어 여전히 일치하기 때문이다. 어긋남을 만들려면 **한쪽에서만** 키를 바꿔야 한다. `anchor-handles.tsx` 의 왼쪽 핸들만 잠시 망가뜨린다:

```tsx
      <Handle id={handleId('l', `${anchorKey}_BROKEN`)} type="source" position={Position.Left}
        isConnectable={false} className={cls} />
```

Run: `pnpm -C apps/web exec vitest run src/editor/anchor-wiring.test.tsx`
Expected: **FAIL** — `expected [ ... ] to contain 'l:c:i_o'`

확인했으면 `anchor-handles.tsx` 를 원래대로 되돌리고 다시 돌려 PASS 를 확인한다. 되돌린 것을 `git diff` 로 확인한 뒤 커밋한다.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/editor/anchor-wiring.test.tsx && \
git commit -m "test: 엣지의 handle id 가 실제 렌더된 핸들과 일치하는지 전수 대조한다

앵커 키의 소재지가 한 곳이라는 불변식이 깨지면 선이 예외 없이 조용히
사라진다 — 이 테스트만이 그것을 잡는다. anchor-handles 에서만 키를 바꿔
빨개지는 것을 확인했다.

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/anchor-wiring.test.tsx
```

---

## Task 8: 브라우저 스모크 + 문서 갱신

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `docs/manual/user-guide.md` (관계 관련 절 — 합성 행이 화면에 새로 생기므로)

- [ ] **Step 1: 전체 검증을 돌린다**

```bash
set -a && . ./.env && set +a && pnpm verify
```
Expected: typecheck EXIT=0 + core·cli·web·server 네 스위트 전부 PASS.

**web 의 최종 건수를 적어 둔다** — HANDOFF 의 기준선을 갱신해야 한다. `core`·`cli`·`server` 는 **움직이면 안 된다**(범위를 넘은 것이다).

- [ ] **Step 2: 브라우저 스모크**

dev 서버를 띄우고 첨부 이미지의 DBML 을 가져와 눈으로 확인한다. 컬럼 위치는 DOM 실측이라 jsdom 에서 좌표가 전부 0이다 — 단위 테스트는 "어느 핸들에 붙는가"까지만 잠그고 "그 핸들이 화면 어디인가"는 못 본다.

```
Table products { product_id int [pk, increment] name varchar(100) [not null]
  price decimal(10,2) [not null] stock int [not null, default: 0]
  is_active boolean [not null, default: true] created_at timestamp }
Table orders { order_id int [pk, increment] user_id int [not null]
  status varchar(20) [not null, default: 'PENDING'] ordered_at timestamp }
Table order_items { order_id int [not null] product_id int [not null]
  quantity int [not null, default: 1] unit_price decimal(10,2)
  Indexes { (order_id, product_id) [pk] } }
Table order_item_options { option_id int [pk, increment] order_id int [not null]
  product_id int [not null] option_name varchar(50) extra_price decimal(10,2)
  Indexes { (order_id, product_id) } }
Ref: order_items.order_id > orders.order_id
Ref: order_items.product_id > products.product_id
Ref: order_item_options.(order_id, product_id) > order_items.(order_id, product_id)
```

확인 항목:

1. `orders.order_id` → `order_items.order_id` 선이 **그 컬럼 행 높이**에서 나간다
2. `products.product_id` → `order_items.product_id` 도 마찬가지다
3. 복합 FK 선이 `order_items` 와 `order_item_options` 의 **합성 행끼리** 이어진다
4. 테이블을 드래그해 좌우가 뒤집히면 선이 반대편 핸들로 옮겨 간다
5. 관계를 **새로 만든 직후** 선이 곧바로 올바른 컬럼에 붙는다(Task 6의 `updateNodeInternals` 확인)
6. 관계를 지우면 합성 행이 사라지고 남은 선이 어긋나지 않는다
7. 그룹 뷰에서 고스트로 가는 선이 헤더 중앙에 붙는다
8. PNG 내보내기에 같은 그림이 나온다
9. 보기 모드(논리/물리/혼합)를 바꿔도 선이 컬럼 행을 따라간다

- [ ] **Step 3: `docs/manual/user-guide.md` 를 고친다**

「6. 관계」절의 마지막 문단(`user-guide.md:196` — "캔버스에서 부모 끝은 항상 막대…"로 시작하는 문단) **뒤에** 문단을 하나 더한다:

```markdown
관계선은 테이블 가운데가 아니라 **실제로 이어지는 컬럼 행**에 붙는다. 자식의 FK 컬럼 행과 부모의
참조 컬럼 행이 직접 이어지므로 어느 컬럼이 무엇을 참조하는지 그림만 보고 알 수 있다. 컬럼이
둘 이상인 **복합 키 관계**는 두 테이블 맨 아래에 `(컬럼1, 컬럼2)` 행이 생기고 그 행끼리 선
하나로 이어진다. 이 행은 **보기 전용**이라 클릭하거나 선택할 수 없고, 관계가 실제로 쓰는 컬럼
조합에만 생긴다. 매핑이 아직 비어 있는 관계는 예전처럼 테이블 좌·우 가운데에 붙는다.
```

「어떻게 — 만들기」 문단(`user-guide.md:185`)은 **고치지 않는다** — 관계 생성 드래그는 지금도 테이블 좌·우 손잡이에서 시작한다(설계 D-3).

- [ ] **Step 4: `docs/superpowers/HANDOFF.md` 를 고친다**

1절 완료 표에 행을 더한다(다른 행과 같은 밀도로, 실제로 겪은 함정을 담아):

```
| **관계선을 컬럼 위치에 붙임** | 관계선이 테이블 좌우 **중앙**에서 나가 어느 컬럼이 어느 컬럼을 참조하는지 그림에 없던 것을 고쳤다. 단일 FK 는 그 컬럼 행에, 복합 FK 는 양쪽 테이블 맨 아래의 **합성 행 `(col1, col2)`** 끼리 붙는다. 합성 행은 **관계가 쓰는 조합에만** 만든다(복합 PK·인덱스 기준이 아니다 — 그러면 "관계가 쓰는 조합이 인덱스로 정의돼 있지 않다"는 흔한 상태에서 붙을 자리가 없다). ⚠️ **급소는 앵커 키의 소재지가 한 곳이라는 것** — 엣지가 적는 `sourceHandle` 문자열과 노드의 `<Handle id>` 가 한 글자만 어긋나면 React Flow 는 **예외도 경고도 없이 선을 그리지 않는다.** `anchors.ts` 의 `handleId()` 만이 그 문자열을 만들고, `anchor-wiring.test.tsx` 가 "엣지가 가리키는 핸들 ⊆ 실제 렌더된 핸들"을 전수 대조해 잠근다. 고스트 노드(컬럼 행이 없다)에도 **같은 앵커 핸들을 전부 헤더 중앙에 겹쳐** 달아 `buildEdges` 가 "상대가 고스트인가"를 몰라도 되게 했다. ⚠️ **핸들이 모델에 따라 붙고 떨어지므로 `updateNodeInternals` 가 새 의무로 붙는다** — React Flow 는 `<Handle>` 이 바뀌어도 `handleBounds` 를 자동 재파싱하지 않아, 부르지 않으면 관계를 만든 직후 선이 옛 자리에 남는다. 직전 사이클의 `keepMeasured`(측정 **보존**)와 방향이 반대이자 상보적이다. **core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-12-column-anchored-edges-design.md)) |
```

테스트 기준선 절의 수를 **실측값으로** 갱신하고, 이 사이클이 올린 것이 web 뿐임을 적는다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/HANDOFF.md docs/manual/user-guide.md && \
git commit -m "docs: 관계선 컬럼 앵커를 인계 문서와 매뉴얼에 반영한다

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- docs/superpowers/HANDOFF.md docs/manual/user-guide.md
```

---

## 완료 기준

- [ ] `pnpm verify` 가 전부 그린이고 typecheck `EXIT=0`
- [ ] `packages/core`·`apps/server`·`packages/cli` 의 테스트 수가 **변하지 않았다**
- [ ] 브라우저 스모크 9항목 전부 확인
- [ ] `anchor-wiring.test.tsx` 의 구분력을 실제로 실증했다(Task 7 Step 3)
- [ ] HANDOFF·매뉴얼 갱신
