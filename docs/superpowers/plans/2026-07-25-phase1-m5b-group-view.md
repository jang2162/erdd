# Phase 1 M5b — 그룹 뷰(독립 배치·외부 참조·필터) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 그룹을 선택해 그룹 뷰로 전환하면 해당 그룹 테이블만, 전체 뷰와 독립된 좌표(groupPosition)로 배치·표시하고, 그룹 밖의 관련 테이블은 외부 참조 고스트 노드로 보여주며(클릭 시 그 그룹 뷰로 이동), 좌측 트리를 활성 그룹으로 스코핑한다.

**Architecture:** "어떤 다이어그램을 보는가"는 이름 표기(viewMode: logical/physical/mixed)와 직교하는 축이므로 스토어에 `activeGroupView: string | null`(null=전체 뷰)을 새 축으로 둔다. 그룹 뷰의 좌표는 `Table.groupPosition`(이미 모델에 존재, nullable)에 저장하고, 없으면 전체 뷰 `position`으로 폴백한다(첫 재배치 시 분리). 캔버스는 `view` 컨텍스트를 받아 노드 집합·좌표·엣지·드래그 영속 대상을 뷰별로 바꾼다. 외부 참조 고스트는 별도 노드 타입으로 렌더하되 드래그 불가·클릭 시 이동만 한다. 서버·op 파이프라인 변경 없음(groupPosition은 Table 속성이라 기존 update op로 영속화).

**Tech Stack:** TypeScript, React 19, @xyflow/react, Zustand, @erdd/core, vitest, @testing-library/react.

## Global Constraints

- 데이터 모델 변경 없음: `Table.groupPosition: Position | null`(이미 존재). 그룹 뷰 좌표는 여기에, 전체 뷰 좌표는 `Table.position`에 저장 — 둘은 독립.
- 그룹 뷰 좌표 폴백: 그룹 뷰에서 테이블의 표시 좌표 = `groupPosition ?? position`. 그룹 뷰에서 드래그하면 `groupPosition`만 갱신(전체 뷰 `position` 불변).
- `activeGroupView`는 UI 상태(영속화 안 함). `setLoaded`(최초 적재·프로젝트 전환·롤백 재로드)와 `reset`에서 null로 되돌린다.
- 그룹 뷰에서는: 해당 그룹 소속 테이블 + 외부 참조 고스트만 표시. 메모·색상 영역·다른 그룹/미분류 테이블은 숨긴다.
- 외부 참조 = 그룹 내 테이블과 관계로 연결된, 그룹 밖(다른 그룹 또는 미분류) 테이블. 고스트는 헤더만·반투명·드래그 불가. 클릭 시 그 테이블의 그룹 뷰로 이동(미분류면 전체 뷰로).
- 모든 편집은 M4b 단일 mutation 경로(producer+diff+직렬화)를 지난다. 이벤트 값은 호출 시점에 즉시 캡처(M4b/M5a 교훈: producer 클로저에서 `e.target` 지연 읽기 금지).
- 새로고침 후 그룹 뷰 좌표(groupPosition)가 서버에서 복원되어야 한다(전체 뷰로 로드되지만 그룹 뷰 진입 시 저장된 배치가 보여야 함).
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖 (M5c/후속 이월)

- 그룹 영역 드래그로 멤버 함께 이동(전체 뷰) — RF 위치 모델·클릭통과와의 상호작용 설계 필요, 측정 bbox 작업과 함께.
- 자동 정렬(그룹 뷰 초기 배치 최적화) — 현재는 position 폴백.
- 다중 선택 일괄 배정, group.color hex 제약, select 옵션 정렬 등 M5a 이월 Minor.

---

## File Structure

**web (신규):**
- `apps/web/src/editor/group-view-select.tsx` — 헤더의 뷰 전환 컨트롤(전체 뷰 + 그룹들).
- `apps/web/src/editor/ghost-node.tsx` — 외부 참조 고스트 노드.
- `apps/web/src/editor/ghost-nodes.ts` — `buildGhostNodes(model, groupId): Node[]`.
- 대응 테스트: `ghost-nodes.test.ts`, `group-view.test.tsx`(스토어/뷰 전환).

**web (수정):**
- `apps/web/src/editor/store.ts` — `activeGroupView` + `enterGroupView`/`exitGroupView`, setLoaded/reset 초기화.
- `apps/web/src/editor/model-edits.ts` — `moveTableGroupPosition(model, id, position)`.
- `apps/web/src/editor/nodes.ts` — `buildNodes`에 `view` 파라미터(그룹 뷰 필터·groupPosition).
- `apps/web/src/editor/edges.ts` — `buildEdges`에 optional `visibleTableIds` 파라미터.
- `apps/web/src/editor/canvas.tsx` — view 컨텍스트로 노드/엣지/고스트/드래그 영속 분기, 그룹 뷰에서 색상영역·메모 숨김.
- `apps/web/src/editor/group-panel.tsx` — "이 그룹 뷰 열기" 버튼.
- `apps/web/src/editor/table-tree.tsx` — 그룹 뷰 활성 시 활성 그룹으로 스코핑.
- `apps/web/src/pages/project.tsx` — 헤더에 `GroupViewSelect`.

---

## Task 1: 웹 스토어 뷰 축 + groupPosition 이동 producer + 뷰 전환 컨트롤

**Files:**
- Modify: `apps/web/src/editor/store.ts`, `apps/web/src/editor/model-edits.ts`, `apps/web/src/editor/group-panel.tsx`, `apps/web/src/pages/project.tsx`
- Create: `apps/web/src/editor/group-view-select.tsx`, `apps/web/src/editor/group-view.test.tsx`

**Interfaces:**
- Produces (later tasks rely on these):
  ```ts
  // store
  activeGroupView: string | null
  enterGroupView: (groupId: string) => void   // 선택도 해제(전체 뷰 편집 잔상 방지) — 아래 설계 참고
  exitGroupView: () => void
  // model-edits
  moveTableGroupPosition(model, id: string, position: Position): ProjectModel
  ```

### 설계 (읽고 시작)

- `activeGroupView`는 selection과 독립이다. 다만 그룹 뷰로 들어갈 때 선택은 초기화하는 게 자연스럽다(`enterGroupView`가 `...CLEARED_SELECTION` 적용). `exitGroupView`도 선택 초기화.
- `setLoaded`/`reset`은 `activeGroupView: null`을 함께 설정한다.
- `moveTableGroupPosition`은 `moveTable`과 동일 패턴이되 `groupPosition`을 설정한다.
- `GroupViewSelect`(헤더): 현재 뷰를 보여주는 select. 옵션: "전체 뷰"(value="") + 각 그룹(이름순). onChange에서 값 **즉시 캡처** 후 enter/exit. 그룹이 하나도 없으면 렌더하지 않는다(공간 절약).
- `group-panel.tsx`에 "이 그룹 뷰 열기" 버튼 추가 → `enterGroupView(groupId)`.

### Steps

- [ ] **Step 1: 실패 테스트** — `apps/web/src/editor/group-view.test.tsx` (스토어 + move producer)

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { createEmptyModel } from '@erdd/core'
import { moveTableGroupPosition } from './model-edits.js'
import { useEditorStore } from './store.js'
import type { Table } from '@erdd/core'

beforeEach(() => { act(() => useEditorStore.getState().reset()) })

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 10, y: 20 }, groupPosition: null }
}

describe('store activeGroupView', () => {
  it('enterGroupView는 뷰를 설정하고 선택을 해제한다', () => {
    act(() => { useEditorStore.getState().select('T'); useEditorStore.getState().enterGroupView('G1') })
    const s = useEditorStore.getState()
    expect(s.activeGroupView).toBe('G1')
    expect(s.selectedTableId).toBeNull()
  })
  it('exitGroupView는 전체 뷰로 되돌린다', () => {
    act(() => { useEditorStore.getState().enterGroupView('G1'); useEditorStore.getState().exitGroupView() })
    expect(useEditorStore.getState().activeGroupView).toBeNull()
  })
  it('setLoaded는 activeGroupView를 null로 초기화한다', () => {
    act(() => {
      useEditorStore.getState().enterGroupView('G1')
      useEditorStore.getState().setLoaded(createEmptyModel(), 1, 'p1')
    })
    expect(useEditorStore.getState().activeGroupView).toBeNull()
  })
})

describe('moveTableGroupPosition', () => {
  it('groupPosition만 설정하고 position은 유지한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    const next = moveTableGroupPosition(m, 'T', { x: 500, y: 600 })
    expect(next.tables['T']!.groupPosition).toEqual({ x: 500, y: 600 })
    expect(next.tables['T']!.position).toEqual({ x: 10, y: 20 })
  })
  it('없는 테이블은 no-op', () => {
    const m = createEmptyModel()
    expect(moveTableGroupPosition(m, 'X', { x: 0, y: 0 })).toBe(m)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web test group-view` → FAIL.

- [ ] **Step 3: store.ts 확장**

`EditorState` 타입에 추가하고, 초기값·액션·setLoaded·reset을 갱신:
```ts
// 타입:
activeGroupView: string | null
enterGroupView: (groupId: string) => void
exitGroupView: () => void
// 초기값: activeGroupView: null,
// 액션:
enterGroupView: (activeGroupView) => set({ ...CLEARED_SELECTION, activeGroupView }),
exitGroupView: () => set({ ...CLEARED_SELECTION, activeGroupView: null }),
// setLoaded: 기존 set({...})에 activeGroupView: null 추가
// reset: 기존 set({...})에 activeGroupView: null 추가
```
(주의: `setLoaded`는 `set({ model, seq, loaded: true, loadedProjectId: projectId, undoStack: [], redoStack: [] })` 형태 — 여기에 `activeGroupView: null` 추가. `reset`도 동일.)

- [ ] **Step 4: model-edits.ts에 moveTableGroupPosition 추가**

```ts
export function moveTableGroupPosition(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, groupPosition: position } } }
}
```
(`Position` 타입이 이미 import되어 있는지 확인 — `moveTable`이 쓰므로 있음.)

- [ ] **Step 5: group-view-select.tsx 구현**

```tsx
import { useEditorStore } from './store.js'

/** 헤더의 뷰 전환: 전체 뷰 ↔ 각 그룹 뷰. 그룹이 없으면 렌더 안 함. */
export function GroupViewSelect() {
  const groups = useEditorStore((s) => s.model.tableGroups)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)

  const list = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  if (list.length === 0) return null

  return (
    <select
      aria-label="뷰 전환"
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value={activeGroupView ?? ''}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') exitGroupView()
        else enterGroupView(v)
      }}
    >
      <option value="">전체 뷰</option>
      {list.map((g) => <option key={g.id} value={g.id}>{g.name} 뷰</option>)}
    </select>
  )
}
```

- [ ] **Step 6: group-panel.tsx에 "이 그룹 뷰 열기" 버튼**

`group-panel.tsx`의 멤버 개수 문단 아래에 버튼 추가(그리고 `enterGroupView`를 스토어에서 가져온다):
```tsx
import { Button } from '@/components/ui/button' // 이미 import됨
// 컴포넌트 내부:
const enterGroupView = useEditorStore((s) => s.enterGroupView)
// 멤버 개수 <p> 아래:
<Button size="sm" variant="outline" className="mb-4 w-full" onClick={() => enterGroupView(groupId)}>
  이 그룹 뷰 열기
</Button>
```

- [ ] **Step 7: project.tsx 헤더에 GroupViewSelect** — `ViewModeToggle` 옆에 배치

`apps/web/src/pages/project.tsx`에서 import 추가 후, 헤더 우측 컨트롤 영역(ViewModeToggle 근처)에 `{loaded && <GroupViewSelect />}` 추가.

- [ ] **Step 8: 테스트 통과·타입체크** — `pnpm --filter @erdd/web test group-view && pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS(기존 65 + 신규).

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/model-edits.ts apps/web/src/editor/group-view-select.tsx apps/web/src/editor/group-panel.tsx apps/web/src/pages/project.tsx apps/web/src/editor/group-view.test.tsx
git commit -m "feat(web): 그룹 뷰 축 스토어·groupPosition 이동·뷰 전환 컨트롤"
```

---

## Task 2: 웹 그룹 뷰 캔버스 렌더링(독립 배치)

**Files:**
- Modify: `apps/web/src/editor/nodes.ts`, `apps/web/src/editor/edges.ts`, `apps/web/src/editor/canvas.tsx`
- Modify tests: `apps/web/src/editor/nodes` 관련(없으면 canvas 동작은 스모크로), `apps/web/src/editor/edges.test.ts`

**Interfaces:**
- Consumes: store `activeGroupView`, `moveTableGroupPosition`(Task 1).
- Produces:
  ```ts
  type NodeView = { kind: 'full' } | { kind: 'group'; groupId: string }
  buildNodes(model, viewMode, selectedId, warnings, view: NodeView): Node<TableNodeData>[]
  buildEdges(model, visibleTableIds?: Set<string>): Edge[]   // 주어지면 양 끝이 모두 집합에 있는 엣지만
  ```

### 설계 (읽고 시작)

- `buildNodes`에 5번째 인자 `view` 추가:
  - `full`: 기존과 동일(모든 테이블, position).
  - `group`: `t.groupId === view.groupId`인 테이블만, 좌표 = `t.groupPosition ?? t.position`.
- `buildEdges`에 optional `visibleTableIds` 추가: 주어지면 `parentTableId`·`childTableId`가 모두 집합에 있는 엣지만 반환(그룹 뷰에서 화면 밖 테이블로 가는 선을 숨기되, 고스트로 표시되는 외부 테이블과의 선은 Task 3에서 집합에 포함).
- `canvas.tsx`:
  - `view = activeGroupView ? { kind:'group', groupId: activeGroupView } : { kind:'full' }`.
  - 그룹 뷰: 색상 영역(`buildGroupNodes`)·메모 노드 숨김; 테이블 노드는 `buildNodes(..., view)`; 엣지는 그룹 뷰에서 `visibleTableIds`(그룹 멤버 id 집합; Task 3에서 고스트 id 추가)로 필터.
  - `onNodeDragStop`: 그룹 뷰(view.kind==='group')에서 table 노드 → `moveTableGroupPosition`; 전체 뷰 → 기존 `moveTable`/`moveNote`.
  - `derived` deps에 `activeGroupView` 추가.
- 활성 그룹이 삭제되어 `activeGroupView`가 더는 존재하지 않으면(그룹 뷰 도중 삭제) 빈 화면이 되므로, canvas에서 `activeGroupView && !model.tableGroups[activeGroupView]`이면 전체 뷰로 폴백(effacetiveView 계산 시 처리).

### Steps

- [ ] **Step 1: edges.ts 확장 + 테스트** — `buildEdges`에 optional visibleTableIds

`edges.ts`의 `buildEdges` 시그니처를 `(model: ProjectModel, visibleTableIds?: Set<string>)`로 바꾸고, 각 관계에 대해 `visibleTableIds`가 있으면 `visibleTableIds.has(parent) && visibleTableIds.has(child)`인 것만 push.

`edges.test.ts`에 테스트 추가:
```ts
it('visibleTableIds가 주어지면 양 끝이 모두 포함된 엣지만 반환한다', () => {
  const m = model() // P(부모)·C(자식) 관계 R 하나
  expect(buildEdges(m, new Set(['P', 'C']))).toHaveLength(1)
  expect(buildEdges(m, new Set(['C']))).toHaveLength(0)     // 부모 미포함 → 제외
  expect(buildEdges(m, new Set())).toHaveLength(0)
})
```

- [ ] **Step 2: nodes.ts에 view 파라미터**

```ts
export type NodeView = { kind: 'full' } | { kind: 'group'; groupId: string }

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null,
  warnings: Warning[], view: NodeView = { kind: 'full' },
): Node<TableNodeData>[] {
  const tables = Object.values(model.tables).filter(
    (t) => view.kind === 'full' || t.groupId === view.groupId,
  )
  return tables.map((table) => {
    const position = view.kind === 'group' ? (table.groupPosition ?? table.position) : table.position
    // ... 기존 tableWarnings/columnWarnings 계산 그대로 ...
    return { id: table.id, type: 'table', position, data: { /* 기존 그대로 */ } }
  })
}
```
(기존 warnings 그룹핑 로직은 유지. `position`만 view에 따라 바뀐다.)

- [ ] **Step 3: canvas.tsx 뷰 분기**

현재 canvas.tsx를 읽고 다음을 반영:
```tsx
import { moveTableGroupPosition } from './model-edits.js'
// 구독:
const activeGroupView = useEditorStore((s) => s.activeGroupView)
// 유효 뷰(삭제된 그룹 폴백):
const view = activeGroupView && model.tableGroups[activeGroupView]
  ? { kind: 'group' as const, groupId: activeGroupView }
  : { kind: 'full' as const }

const derived = useMemo(() => {
  const tableNodes = buildNodes(model, viewMode, selectedId, warnings, view)
  if (view.kind === 'group') {
    // 그룹 뷰: 색상영역·메모 숨김. (고스트는 Task 3에서 추가)
    return [...tableNodes]
  }
  const groupNodes = buildGroupNodes(model, selectedGroupId)
  const noteNodes = /* 기존 노트 노드 */
  return [...groupNodes, ...tableNodes, ...noteNodes]
}, [model, viewMode, selectedId, selectedNoteId, selectedGroupId, warnings, view.kind, view.kind === 'group' ? view.groupId : null])

const edges = useMemo(() => {
  if (view.kind === 'group') {
    const visible = new Set(Object.values(model.tables).filter((t) => t.groupId === view.groupId).map((t) => t.id))
    // Task 3에서 고스트 id도 visible에 추가
    return buildEdges(model, visible)
  }
  return buildEdges(model)
}, [model, view.kind, view.kind === 'group' ? view.groupId : null, selectedRelId])
// (selectedRel 하이라이트 로직 유지)

// onNodeDragStop:
onNodeDragStop={(_, __, dragged) =>
  void mutate((m) => dragged.reduce((acc, n) => {
    if (n.type === 'group' || n.type === 'ghost') return acc
    if (view.kind === 'group' && n.type === 'table') return moveTableGroupPosition(acc, n.id, n.position)
    if (n.type === 'note') return moveNote(acc, n.id, n.position)
    return moveTable(acc, n.id, n.position)
  }, m), { summary: '이동' })}
```
(주의: `view` 객체를 useMemo deps에 직접 넣으면 매 렌더 새 객체라 무효화된다 → `view.kind`와 groupId를 분리해 deps에 넣는다. 위 예시 참고.)

- [ ] **Step 4: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS. (buildNodes 기본값 view로 기존 호출부 호환. edges 기존 호출 호환.)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/nodes.ts apps/web/src/editor/edges.ts apps/web/src/editor/edges.test.ts apps/web/src/editor/canvas.tsx
git commit -m "feat(web): 그룹 뷰 캔버스 — 멤버만 표시·groupPosition 독립 배치·엣지 필터"
```

---

## Task 3: 웹 외부 참조 고스트 노드

**Files:**
- Create: `apps/web/src/editor/ghost-nodes.ts`, `apps/web/src/editor/ghost-node.tsx`, `apps/web/src/editor/ghost-nodes.test.ts`
- Modify: `apps/web/src/editor/canvas.tsx`

**Interfaces:**
- Consumes: `ProjectModel`, store `enterGroupView`/`exitGroupView`.
- Produces:
  ```ts
  type GhostNodeData = { table: Table; targetGroupId: string | null } // null=미분류→전체 뷰
  buildGhostNodes(model, groupId: string): Node<GhostNodeData>[]
  ```

### 설계 (읽고 시작)

- 외부 참조 = 활성 그룹(groupId) 내 테이블과 관계로 연결된, groupId에 **속하지 않는** 테이블. 각 외부 테이블당 고스트 1개.
- 고스트 좌표: 외부 테이블의 `position`(전체 뷰 좌표)을 그대로 사용(대략적 맥락 제공). 드래그 불가.
- `targetGroupId`: 외부 테이블의 `groupId`(있으면 그 그룹 뷰로, null이면 전체 뷰로 이동).
- 고스트 노드는 `type:'ghost'`, `draggable:false`, `selectable:false`.
- canvas: 그룹 뷰에서 `buildGhostNodes` 결과를 노드 배열에 추가(테이블 뒤/앞 무관하나 테이블보다 앞은 아니게 — 헤더만이라 겹침 적음). `visibleTableIds`에 고스트 테이블 id도 추가해 그룹↔외부 엣지가 보이게 한다.

### Steps

- [ ] **Step 1: 실패 테스트** — `ghost-nodes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildGhostNodes } from './ghost-nodes.js'
import { createEmptyModel, type ProjectModel, type Table, type Relationship } from '@erdd/core'

function tbl(id: string, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['G1'] = { id: 'G1', name: '주문', color: '#000', comment: null }
  m.tableGroups['G2'] = { id: 'G2', name: '회원', color: '#111', comment: null }
  m.tables['ORD'] = tbl('ORD', 'G1')   // 그룹 내
  m.tables['USR'] = tbl('USR', 'G2')   // 다른 그룹
  m.tables['LOG'] = tbl('LOG', null)   // 미분류
  m.tables['FAR'] = tbl('FAR', 'G2')   // 관계 없음
  const rel = (id: string, p: string, c: string): Relationship => ({
    id, parentTableId: p, childTableId: c, columnMappings: [], cardinality: '1:N', identifying: false, name: null })
  m.relationships['R1'] = rel('R1', 'USR', 'ORD') // USR(외부)↔ORD(내부)
  m.relationships['R2'] = rel('R2', 'ORD', 'LOG') // ORD(내부)↔LOG(미분류 외부)
  return m
}

describe('buildGhostNodes', () => {
  it('그룹 내 테이블과 관계된 외부 테이블만 고스트로 만든다', () => {
    const ghosts = buildGhostNodes(model(), 'G1')
    const ids = ghosts.map((g) => g.id).sort()
    expect(ids).toEqual(['ghost:LOG', 'ghost:USR']) // FAR는 관계 없어 제외, ORD는 내부라 제외
  })
  it('고스트에 targetGroupId를 담는다(미분류는 null)', () => {
    const ghosts = buildGhostNodes(model(), 'G1')
    const usr = ghosts.find((g) => g.id === 'ghost:USR')!
    const log = ghosts.find((g) => g.id === 'ghost:LOG')!
    expect((usr.data as { targetGroupId: string | null }).targetGroupId).toBe('G2')
    expect((log.data as { targetGroupId: string | null }).targetGroupId).toBeNull()
    expect(usr.type).toBe('ghost')
    expect(usr.draggable).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web test ghost-nodes` → FAIL.

- [ ] **Step 3: ghost-nodes.ts 구현**

```ts
import type { Node } from '@xyflow/react'
import type { ProjectModel, Table } from '@erdd/core'

export type GhostNodeData = { table: Table; targetGroupId: string | null }

export function buildGhostNodes(model: ProjectModel, groupId: string): Node<GhostNodeData>[] {
  const memberIds = new Set(
    Object.values(model.tables).filter((t) => t.groupId === groupId).map((t) => t.id),
  )
  const externalIds = new Set<string>()
  for (const rel of Object.values(model.relationships)) {
    const pIn = memberIds.has(rel.parentTableId)
    const cIn = memberIds.has(rel.childTableId)
    if (pIn && !cIn) externalIds.add(rel.childTableId)
    if (cIn && !pIn) externalIds.add(rel.parentTableId)
  }
  const ghosts: Node<GhostNodeData>[] = []
  for (const id of externalIds) {
    const table = model.tables[id]
    if (!table) continue
    ghosts.push({
      id: `ghost:${id}`,
      type: 'ghost',
      position: table.position,
      draggable: false,
      selectable: false,
      zIndex: 1,
      data: { table, targetGroupId: table.groupId },
    })
  }
  return ghosts
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/web test ghost-nodes` → PASS.

- [ ] **Step 5: ghost-node.tsx 구현**

```tsx
import type { NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GhostNodeData } from './ghost-nodes.js'

/** 외부 참조 테이블 — 헤더만·반투명. 클릭 시 해당 그룹 뷰(미분류면 전체 뷰)로 이동. */
export function GhostNode({ data }: NodeProps) {
  const { table, targetGroupId } = data as unknown as GhostNodeData
  const enterGroupView = useEditorStore((s) => s.enterGroupView)
  const exitGroupView = useEditorStore((s) => s.exitGroupView)
  return (
    <button
      type="button"
      onClick={() => (targetGroupId ? enterGroupView(targetGroupId) : exitGroupView())}
      className="min-w-40 rounded-lg border border-dashed bg-card/50 px-3 py-2 text-left opacity-70 hover:opacity-100"
      title="외부 참조 — 클릭해 이동"
    >
      <span className="font-mono text-sm font-medium text-muted-foreground">{table.physicalName}</span>
    </button>
  )
}
```

- [ ] **Step 6: canvas.tsx에 고스트 통합** — 그룹 뷰에서 고스트 노드 추가 + visibleTableIds에 고스트 포함

```tsx
import { GhostNode } from './ghost-node.js'
import { buildGhostNodes } from './ghost-nodes.js'
// nodeTypes에 추가: ghost: GhostNode
// derived의 group 분기:
if (view.kind === 'group') {
  const ghostNodes = buildGhostNodes(model, view.groupId)
  return [...ghostNodes, ...tableNodes]
}
// edges의 group 분기에서 visible에 고스트 테이블 id 추가:
const ghostIds = buildGhostNodes(model, view.groupId).map((g) => g.data.table.id)
const visible = new Set([...groupMemberIds, ...ghostIds])
```
(derived·edges useMemo에서 buildGhostNodes를 각각 부르면 계산 중복 — 허용 가능(작음). 원하면 useMemo로 한 번 계산해 공유.)

- [ ] **Step 7: 웹 테스트·타입체크** — PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/ghost-nodes.ts apps/web/src/editor/ghost-nodes.test.ts apps/web/src/editor/ghost-node.tsx apps/web/src/editor/canvas.tsx
git commit -m "feat(web): 외부 참조 고스트 노드 — 그룹 뷰에서 관련 외부 테이블 표시·이동"
```

---

## Task 4: 웹 트리 그룹 뷰 스코핑(필터)

**Files:**
- Modify: `apps/web/src/editor/table-tree.tsx`
- Modify: `apps/web/src/editor/table-tree.test.tsx`

**Interfaces:**
- Consumes: store `activeGroupView`.

### 설계 (읽고 시작)

- 그룹 뷰 활성 시(`activeGroupView` 설정), 트리를 **그 그룹으로 스코핑**: 활성 그룹 섹션만 표시(다른 그룹·미분류 숨김), 헤더에 활성 표시. 전체 뷰면 기존처럼 모든 그룹+미분류.
- 이것이 "그룹 기준 필터"의 구현이다(뷰와 트리가 함께 스코핑되어 그룹 도메인에 집중).
- 검색(q)은 스코핑된 목록 위에서 그대로 동작.

### Steps

- [ ] **Step 1: table-tree.tsx 스코핑 적용**

`table-tree.tsx`에서 `activeGroupView`를 구독하되, **존재하는 그룹일 때만** 스코핑한다(활성 그룹이 삭제된 경우 전체 뷰처럼 동작 — canvas 폴백과 일치):
```tsx
const activeGroupView = useEditorStore((s) => s.activeGroupView)
// 유효 활성 그룹: 설정됐고 실제로 존재할 때만.
const scopedGroupId = activeGroupView && model.tableGroups[activeGroupView] ? activeGroupView : null
// groups 렌더 루프에서:
const visibleGroups = scopedGroupId ? groups.filter((g) => g.id === scopedGroupId) : groups
// 미분류 섹션은 스코핑 중이면 숨긴다:
const showUnassigned = !scopedGroupId && (unassigned.length > 0 || groups.length > 0)
```
그룹 섹션 map을 `visibleGroups`로, 미분류 렌더 조건을 `showUnassigned`로 바꾼다. 활성(스코핑된) 그룹 헤더는 시각적으로 강조(예: `ring-1` 또는 배경).

- [ ] **Step 2: 테스트 추가** — `table-tree.test.tsx`에 1개: `activeGroupView`가 설정되면 그 그룹만 보이고 미분류/다른 그룹은 숨는다.

```tsx
it('그룹 뷰 활성 시 그 그룹만 스코핑해 표시한다', () => {
  const model = buildSampleModel() // g1 "회원관리" + 멤버, 그리고 미분류 테이블이 있도록 조정
  // t2를 미분류로:
  model.tables = { ...model.tables, t2: { ...model.tables.t2!, groupId: null } }
  useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
  useEditorStore.getState().enterGroupView('g1')
  renderTree()
  expect(screen.getByText('회원관리')).toBeInTheDocument()
  expect(screen.queryByText('미분류')).not.toBeInTheDocument() // 스코핑되어 숨김
})
```
(주의: `enterGroupView`는 `setLoaded` 이후에 호출해야 한다 — setLoaded가 activeGroupView를 null로 리셋하므로.)

- [ ] **Step 3: 웹 테스트·타입체크** — PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/editor/table-tree.tsx apps/web/src/editor/table-tree.test.tsx
git commit -m "feat(web): 그룹 뷰 활성 시 트리를 활성 그룹으로 스코핑"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- 그룹이 있으면 헤더에 "전체 뷰 / 그룹 뷰" 전환 컨트롤이 뜨고, 그룹 패널의 "이 그룹 뷰 열기"로도 진입한다.
- 그룹 뷰에서는 그 그룹 소속 테이블만 보이고, 색상 영역·메모·다른 그룹 테이블은 숨는다.
- 그룹 뷰에서 테이블을 드래그하면 groupPosition만 바뀌고, 전체 뷰로 돌아가면 원래 position 배치가 유지된다(독립).
- 그룹 내 테이블과 관계된 외부 테이블이 반투명 헤더 고스트로 보이고, 고스트 클릭 시 그 그룹 뷰(미분류면 전체 뷰)로 이동한다.
- 그룹↔외부 관계 엣지는 그룹 뷰에서 보이고, 화면에 없는 테이블로 가는 엣지는 숨는다.
- 그룹 뷰 활성 시 좌측 트리가 그 그룹으로 스코핑된다.
- 활성 그룹을 삭제하면 전체 뷰로 안전하게 폴백한다.
- 새로고침 후 그룹 뷰 좌표(groupPosition)가 서버에서 복원된다(전체 뷰로 로드 → 그룹 뷰 진입 시 저장된 배치).
- 프로젝트 전환·재로드 시 activeGroupView가 전체 뷰로 초기화된다.
- 전체 테스트(core+server+web) 통과, 타입체크 클린.

## M5c/후속 이월

그룹 영역 드래그(멤버 함께 이동), 그룹 뷰 자동 정렬 초기 배치, 그룹 단위 내보내기(M6/M8), M5a 이월 Minor(group.color hex 제약·select 정렬·라벨 가림·측정 bbox).
