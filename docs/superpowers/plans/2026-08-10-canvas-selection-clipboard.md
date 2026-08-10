# 캔버스 다중 선택 + 클립보드 + 단축키 (트랙 C) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캔버스에서 테이블·컬럼을 여러 개 고르고, 복사·잘라내기·붙여넣기를 단축키로 할 수 있게 한다.

**Architecture:** store의 단일 선택(`selectedTableId`)을 배열로 **교체**하고(병기하지 않는다) 컬럼 선택을 테이블 선택에 종속시킨다. 클립보드는 시스템 클립보드에 JSON을 쓰고 `paste` 이벤트로 읽으며, 도메인·커스텀 항목 참조는 **id가 아니라 이름**으로 실어 다른 프로젝트에서 재연결한다. core는 건드리지 않는다 — 브라우저 API에 닿는 코드는 core에 들어갈 수 없다.

**Tech Stack:** TypeScript · React 19 · zustand · @xyflow/react · vitest · @testing-library/react

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-10-canvas-selection-clipboard-design.md` — 이 계획과 어긋나면 **설계가 우선**이다.
- **마이그레이션 없음. 서버 변경 없음. core 변경 없음.** `apps/server`·`packages/core`·`packages/cli` 아래 파일을 건드리면 범위를 넘은 것이다.
- **실시간 프로토콜(`realtime-protocol.ts`)을 건드리지 않는다.** 다중 선택 시 presence는 **첫 번째 테이블만** 발신한다(설계 D-C5).
- 트랙 A+B(`2026-08-10-physical-first-naming-design.md`)가 **같은 저장소에서 병렬로** 돈다.
  - `edit-panel.tsx`에서 이 트랙이 건드리는 것은 **컬럼 행의 선택 하이라이트·스크롤과 다중 선택 표시**뿐이다. 입력 필드의 순서·라벨·역생성 핸들러는 트랙 A+B의 것이므로 손대지 않는다.
  - `docs/manual/user-guide.md`에는 **새 절만 추가**한다. 명명·폼 관련 기존 절을 고치지 않는다.
  - `warnings.ts`·`ddl.ts`·`model-edits.ts`·`dict-panel.tsx`·`dict-edits.ts`·`resource-item-form.tsx`·`domain-edit-dialog.tsx`·`index-section.tsx`는 **건드리지 않는다.**
  - **`main` 체크아웃·머지 금지.** 병합은 컨트롤러가 한다.
  - **`docs/superpowers/HANDOFF.md`·`docs/91-checklist.md`를 건드리지 않는다.**
- 커밋 메시지는 한국어. `git add -A` 금지 — 경로를 명시하고 `add`와 `commit`을 한 명령으로 붙인다.
- **producer 안에서 `newId()`를 부르지 마라.** `serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로 재실행 시 다른 id가 나온다. id·좌표는 **producer 진입 전에 확정해 인자로 넘긴다**(`HANDOFF.md` 3.4).
- **기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 마라.** 이전 태스크 산출물도 고치지 마라. **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라.**
- **수정 건마다 구분력을 확인하라** — 프로덕션 변경을 되돌려 테스트가 실제로 실패하는지 보고 복구한다(`git checkout -- <path>` → `git status` clean). **실패하지 않으면 덮지 말고 그렇다고 보고하라.** 미커밋 신규 파일은 `git checkout`이 통하지 않으므로 변조 전 내용을 스크래치에 복사해 두고 편집으로 되돌린 뒤 diff로 확인한다.

**검증 명령** (파이프 금지):

```bash
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
pnpm -C apps/web test
```

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `apps/web/src/editor/store.ts` | 선택 상태(배열)·액션·불변식 | 수정 |
| `apps/web/src/editor/clipboard.ts` | 직렬화·파싱·개명 — 순수 함수 | **신규** |
| `apps/web/src/editor/clipboard-edits.ts` | 붙여넣기 producer (모델 → 모델) | **신규** |
| `apps/web/src/editor/use-shortcuts.ts` | 키보드·paste 핸들러 | **신규** |
| `apps/web/src/editor/nodes.ts` | `buildNodes`가 선택 배열을 받는다 | 수정 |
| `apps/web/src/editor/table-node.tsx` | 컬럼 클릭·선택 표시 | 수정 |
| `apps/web/src/editor/canvas.tsx` | 다중 선택 배선·`deleteKeyCode` 해제·단축키 장착 | 수정 |
| `apps/web/src/editor/edit-panel.tsx` | 컬럼 하이라이트·스크롤·다중 선택 표시 | 수정 |
| `apps/web/src/editor/toolbar.tsx` · `table-tree.tsx` · `use-realtime.ts` | 배열 교체 대응 | 수정 |
| `docs/manual/user-guide.md` | 새 절 추가 | 수정 |

---

## Task 1: store — 선택 상태를 배열로 교체

**Files:**
- Modify: `apps/web/src/editor/store.ts:22-25`(타입), `:40-44`(액션 타입), `:54-56`(CLEARED_SELECTION), `:68-71`(초기값), `:90-100`(resync), `:102-109`(액션)
- Test: `apps/web/src/editor/store.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `selectedTableIds: string[]` — 선택 순서. `[0]`이 presence·사이드바 기준
  - `selectedColumnIds: string[]` — `selectedTableIds.length === 1`일 때만 비어 있지 않을 수 있다
  - `select(tableId: string | null): void` — **기존 시그니처 유지**(단일 선택)
  - `selectTables(ids: string[]): void` — 다중
  - `toggleTable(id: string): void` — Cmd/Ctrl+클릭
  - `selectColumn(tableId: string, columnId: string, mode: 'replace' | 'toggle' | 'range'): void`
  - Task 2~7이 전부 이것들을 쓴다.

⚠️ **`selectedTableId`를 남기지 마라.** 같은 사실에 두 진실 원본이 생기면 이 저장소가 이미 맞은 Critical(`store.seq`의 두 의미 → 남의 op 영구 유실, `HANDOFF.md` 3.6)과 같은 형태가 된다. **교체**한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`store.test.ts`에 추가:

```typescript
describe('선택 배열', () => {
  const s = () => useEditorStore.getState()

  beforeEach(() => { s().reset(); s().setLoaded(buildSampleModel(), 1, 'p1') })

  it('select는 단일 선택으로 배열을 만든다', () => {
    s().select('t1')
    expect(s().selectedTableIds).toEqual(['t1'])
  })

  it('select(null)은 선택을 비운다', () => {
    s().select('t1')
    s().select(null)
    expect(s().selectedTableIds).toEqual([])
  })

  it('toggleTable은 있으면 빼고 없으면 더한다', () => {
    s().select('t1')
    s().toggleTable('t2')
    expect(s().selectedTableIds).toEqual(['t1', 't2'])
    s().toggleTable('t1')
    expect(s().selectedTableIds).toEqual(['t2'])
  })

  it('테이블이 2개 이상 선택되면 컬럼 선택이 비워진다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    expect(s().selectedColumnIds).toEqual(['c2'])
    s().toggleTable('t1')
    expect(s().selectedTableIds).toHaveLength(2)
    expect(s().selectedColumnIds).toEqual([])
  })

  it('다른 테이블의 컬럼을 고르면 테이블 선택이 그 테이블로 바뀌고 컬럼이 교체된다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t1', 'c1', 'replace')
    expect(s().selectedTableIds).toEqual(['t1'])
    expect(s().selectedColumnIds).toEqual(['c1'])
  })

  it("selectColumn 'toggle'은 같은 테이블 안에서 누적·해제한다", () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c3', 'toggle')
    expect(s().selectedColumnIds).toEqual(['c2', 'c3'])
    s().selectColumn('t2', 'c2', 'toggle')
    expect(s().selectedColumnIds).toEqual(['c3'])
  })

  it("selectColumn 'range'는 마지막 선택부터 범위를 order 순으로 채운다", () => {
    // 픽스처 t2의 컬럼: c2(order 0) · c3(order 1) · c4(order 2)
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c4', 'range')
    expect(s().selectedColumnIds).toEqual(['c2', 'c3', 'c4'])
  })

  it("range에 앞선 선택이 없으면 replace처럼 동작한다", () => {
    s().select('t2')
    s().selectColumn('t2', 'c3', 'range')
    expect(s().selectedColumnIds).toEqual(['c3'])
  })

  it('테이블 선택이 바뀌면 컬럼 선택이 비워진다', () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().select('t1')
    expect(s().selectedColumnIds).toEqual([])
  })

  it('관계·메모·그룹 선택은 테이블·컬럼 선택을 비운다', () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().selectRelationship('r1')
    expect(s().selectedTableIds).toEqual([])
    expect(s().selectedColumnIds).toEqual([])
  })

  it('resync는 사라진 테이블·컬럼 id를 선택에서 뺀다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c3', 'toggle')
    const m = buildSampleModel()
    delete m.columns['c3']
    s().resync(m, 2)
    expect(s().selectedTableIds).toEqual(['t2'])
    expect(s().selectedColumnIds).toEqual(['c2'])
  })

  it('resync에서 테이블이 사라지면 그 컬럼 선택도 사라진다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    const m = buildSampleModel()
    delete m.tables['t2']
    s().resync(m, 2)
    expect(s().selectedTableIds).toEqual([])
    expect(s().selectedColumnIds).toEqual([])
  })
})
```

> ⚠️ 픽스처 확인: `buildSampleModel()`의 t2 컬럼은 **c2(order 0)·c3(order 1)·c4(order 2)**, t1은 c1 하나다(`packages/core/src/testing/fixtures.ts:19-40`). 실제 순서가 다르면 단언을 정정하고 보고하라.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/store.test.ts`
Expected: FAIL — `selectedTableIds`가 없고 `toggleTable`·`selectColumn`이 정의되지 않았다.

- [ ] **Step 3: 구현한다**

`store.ts`의 타입(`:22-25`)을 교체:

```typescript
  /** 선택된 테이블. 순서 = 선택한 순서. [0]이 presence·사이드바의 기준이다. */
  selectedTableIds: string[]
  /** 선택된 컬럼. selectedTableIds.length === 1 일 때만 비어 있지 않을 수 있다(불변식). */
  selectedColumnIds: string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
```

액션 타입(`:40`)을 교체:

```typescript
  select: (tableId: string | null) => void
  selectTables: (ids: string[]) => void
  toggleTable: (id: string) => void
  selectColumn: (tableId: string, columnId: string, mode: 'replace' | 'toggle' | 'range') => void
```

`CLEARED_SELECTION`(`:54`):

```typescript
const CLEARED_SELECTION = {
  selectedTableIds: [] as string[], selectedColumnIds: [] as string[],
  selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}
```

초기값(`:68-71`)을 `...CLEARED_SELECTION`으로 바꾼다.

`resync`(`:90-100`) — **컬럼은 테이블에도 종속**되므로 두 단계로 거른다:

```typescript
  resync: (model, seq) => set((s) => {
    const keep = (id: string | null, rec: Record<string, unknown>) =>
      (id !== null && Object.hasOwn(rec, id) ? id : null)
    const tableIds = s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id))
    // 컬럼은 테이블이 남아 있고 컬럼 자신도 남아 있을 때만 유지한다.
    const columnIds = tableIds.length === 1
      ? s.selectedColumnIds.filter((id) => {
          const c = model.columns[id]
          return c !== undefined && c.tableId === tableIds[0]
        })
      : []
    return {
      model, seq, loaded: true, undoStack: [], redoStack: [],
      selectedTableIds: tableIds,
      selectedColumnIds: columnIds,
      selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
      selectedNoteId: keep(s.selectedNoteId, model.notes),
      selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
    }
  }),
```

액션(`:102-109`):

```typescript
  select: (tableId) => set({
    ...CLEARED_SELECTION, selectedTableIds: tableId === null ? [] : [tableId],
  }),
  selectTables: (ids) => set({ ...CLEARED_SELECTION, selectedTableIds: [...ids] }),
  // 컬럼 선택은 테이블이 하나일 때만 성립한다(불변식) — 토글로 2개가 되면 비운다.
  toggleTable: (id) => set((s) => {
    const has = s.selectedTableIds.includes(id)
    const next = has ? s.selectedTableIds.filter((x) => x !== id) : [...s.selectedTableIds, id]
    return {
      ...CLEARED_SELECTION,
      selectedTableIds: next,
      selectedColumnIds: next.length === 1 && s.selectedTableIds.length === 1 && next[0] === s.selectedTableIds[0]
        ? s.selectedColumnIds
        : [],
    }
  }),
  selectColumn: (tableId, columnId, mode) => set((s) => {
    const sameTable = s.selectedTableIds.length === 1 && s.selectedTableIds[0] === tableId
    const base = sameTable ? s.selectedColumnIds : []
    let next: string[]
    if (mode === 'toggle') {
      next = base.includes(columnId) ? base.filter((x) => x !== columnId) : [...base, columnId]
    } else if (mode === 'range' && base.length > 0) {
      const anchor = base[base.length - 1]!
      const ordered = Object.values(s.model.columns)
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
      const i = ordered.indexOf(anchor)
      const j = ordered.indexOf(columnId)
      next = i === -1 || j === -1 ? [columnId] : ordered.slice(Math.min(i, j), Math.max(i, j) + 1)
    } else {
      next = [columnId]
    }
    return { ...CLEARED_SELECTION, selectedTableIds: [tableId], selectedColumnIds: next }
  }),
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableIds: [id] }),
```

`reset`(`:126-130`)의 `...CLEARED_SELECTION`은 그대로 동작한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/store.test.ts`
Expected: PASS

⚠️ **`pnpm -s -C apps/web typecheck`는 아직 실패한다** — 소비자 6곳이 `selectedTableId`를 참조하기 때문이다. Task 2가 고친다. **여기서 그 파일들을 고치지 마라**(태스크 경계).

- [ ] **Step 5: 구분력을 확인한다**

`toggleTable`의 `selectedColumnIds: … : []` 갈래를 `s.selectedColumnIds`로 바꿔 항상 유지하게 하면 **"테이블이 2개 이상 선택되면 컬럼 선택이 비워진다"**가 실패하는지 확인하고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/store.test.ts && \
git commit -m "feat(web): 선택 상태를 배열로 바꾸고 컬럼 선택을 추가한다"
```

---

## Task 2: 선택 소비자 6곳 대응

**Files:**
- Modify: `apps/web/src/editor/nodes.ts:9-12`, `toolbar.tsx:19,53,98`, `table-tree.tsx:15,75,87`, `canvas.tsx:33,62,136-143`, `use-realtime.ts:29-43,124`, `edit-panel.tsx:49,56`
- Test: 각 파일의 기존 테스트

**Interfaces:**
- Consumes: Task 1의 `selectedTableIds`
- Produces: `buildNodes(model, viewMode, selectedIds: string[], warnings, view?, peerMarks?)` — 세 번째 인자가 `string | null` → `string[]`로 바뀐다.

**배경:** Task 1이 타입을 바꿨으므로 typecheck가 깨져 있다. 이 태스크는 **동작을 바꾸지 않고** 컴파일을 통과시키는 것이 목표다 — 다중 선택의 UI 동작은 Task 5·6에서 붙인다.

- [ ] **Step 1: 깨진 곳을 전부 찾는다**

```bash
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
grep -rn "selectedTableId" apps/web/src
```

목록을 만들어 보고한다. 아래 표와 다르면 그 사실을 보고하라.

| 파일 | 고칠 것 |
|---|---|
| `nodes.ts:10` | `selectedId: string \| null` → `selectedIds: string[]`, `:34` 부근의 `selected` 계산을 `selectedIds.includes(table.id)`로 |
| `toolbar.tsx:19,53,98` | `selectedTableIds`를 읽고 `[0]`으로 단일 동작 유지 |
| `table-tree.tsx:15,75,87` | `selected={selectedTableIds.includes(t.id)}` |
| `canvas.tsx:33,62` | `selectedIds` 전달 |
| `use-realtime.ts:30,38,124` | `selectedTableIds[0] ?? null` (설계 D-C5) |
| `edit-panel.tsx:49,56` | `selectedTableIds[0]`으로 단일 테이블 조회 |

- [ ] **Step 2: 테스트를 먼저 쓴다**

`use-realtime.test.tsx`에 추가(프로토콜 불변을 잠근다):

```typescript
it('테이블이 여러 개 선택돼도 presence는 첫 번째만 발신한다', () => {
  const sel = selectionOf({
    selectedTableIds: ['t1', 't2'],
    selectedColumnIds: [],
    selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
  })
  expect(sel).toEqual({ kind: 'table', id: 't1' })
})

it('선택이 비면 null이다', () => {
  const sel = selectionOf({
    selectedTableIds: [], selectedColumnIds: [],
    selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
  })
  expect(sel).toBeNull()
})
```

> `selectionOf`가 현재 **export되어 있지 않다**(`use-realtime.ts:37`). 테스트를 위해 export한다. export가 부담이면 기존 테스트가 어떻게 이 함수를 검증하는지 먼저 확인하고 그 방식에 맞춰라.

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/use-realtime.test.tsx`
Expected: FAIL — `selectionOf`가 export되지 않았거나 `SelectionSource` 타입이 맞지 않는다.

- [ ] **Step 4: 구현한다**

`use-realtime.ts`의 `SelectionSource`(`:29-34`)와 `selectionOf`(`:37-43`):

```typescript
type SelectionSource = {
  selectedTableIds: string[]
  selectedColumnIds: string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
}

/**
 * 스토어 선택 상태를 프로토콜의 단일 selection으로 좁힌다.
 * 다중 선택이어도 첫 번째 테이블만 보낸다 — PeerSelection은 단일 값이고
 * 프로토콜 확장은 서버까지 움직여야 해서 이 사이클 범위 밖이다(설계 D-C5).
 * 컬럼 선택은 발신하지 않는다(로컬 전용).
 */
export function selectionOf(s: SelectionSource): PeerSelection | null {
  const tableId = s.selectedTableIds[0]
  if (tableId !== undefined) return { kind: 'table', id: tableId }
  if (s.selectedRelationshipId !== null) return { kind: 'relationship', id: s.selectedRelationshipId }
  if (s.selectedNoteId !== null) return { kind: 'note', id: s.selectedNoteId }
  if (s.selectedGroupId !== null) return { kind: 'group', id: s.selectedGroupId }
  return null
}
```

`:124` 부근의 `tableId: s.selectedTableId`는 `tableId: s.selectedTableIds[0] ?? null`로 바꾼다.

나머지 5개 파일은 위 표대로 고친다. `nodes.ts`의 `selected` 계산:

```typescript
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: string[], warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
): Node<TableNodeData>[] {
```

그리고 반환 객체의 `data.selected`를 `selectedIds.includes(table.id)`로 바꾼다.

`canvas.tsx:33`:

```typescript
  const selectedIds = useEditorStore((s) => s.selectedTableIds)
```

⚠️ **zustand 셀렉터가 배열을 반환하면 매 렌더 새 참조가 되어 무한 리렌더가 날 수 있다.** 이 저장소가 zustand v5를 쓰면 `useShallow`가 필요하다. **먼저 `package.json`에서 zustand 버전을 확인하고**, v5면 `import { useShallow } from 'zustand/react/shallow'` 후 `useEditorStore(useShallow((s) => s.selectedTableIds))`를 쓴다. **store가 배열 객체를 새로 만들지 않는 한**(위 액션들은 `set`할 때만 새 배열을 만든다) 참조는 안정적이지만, 실제로 리렌더 루프가 나는지 테스트로 확인하고 결과를 보고하라.

`:62`의 `buildNodes(model, viewMode, selectedId, ...)`를 `selectedIds`로 바꾸고, `useMemo` 의존성 배열(`:77`)의 `selectedId`도 `selectedIds`로 바꾼다.

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
pnpm -C apps/web test
```

Expected: `EXIT=0`, 전체 스위트 그린. 기존 테스트가 `selectedTableId`를 직접 읽고 있으면 **그 단언을 `selectedTableIds`로 정정하고** 무엇을 고쳤는지 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/nodes.ts apps/web/src/editor/toolbar.tsx \
  apps/web/src/editor/table-tree.tsx apps/web/src/editor/canvas.tsx \
  apps/web/src/editor/use-realtime.ts apps/web/src/editor/edit-panel.tsx \
  apps/web/src/editor/use-realtime.test.tsx && \
git commit -m "refactor(web): 선택 소비자를 배열 기반으로 옮긴다"
```

---

## Task 3: `clipboard.ts` — 직렬화·파싱·개명

**Files:**
- Create: `apps/web/src/editor/clipboard.ts`
- Test: `apps/web/src/editor/clipboard.test.ts`

**Interfaces:**
- Consumes: `@erdd/core`의 `ProjectModel` 타입
- Produces:
  - `serializeTables(model: ProjectModel, tableIds: string[]): ClipboardPayload`
  - `serializeColumns(model: ProjectModel, columnIds: string[]): ClipboardPayload`
  - `parseClipboard(text: string): ClipboardPayload | null`
  - `uniqueName(base: string, used: Set<string>, suffix: string): string`
  - 타입 `ClipboardPayload`·`ClipboardTable`·`ClipboardColumn`·`ClipboardIndex`
  - Task 4·7이 이것들을 쓴다.

**배경:** 다른 프로젝트에 붙여넣어야 하므로 **id를 싣지 않는다.** 도메인·커스텀 항목은 **이름**으로 싣고, 인덱스의 컬럼 참조도 **물리명**으로 싣는다(붙여넣을 때 새 컬럼에 연결하기 위해).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/clipboard.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildSampleModel, fullModel } from '@erdd/core/src/testing/fixtures.js'
import { parseClipboard, serializeColumns, serializeTables, uniqueName } from './clipboard.js'

describe('serializeTables', () => {
  it('테이블·컬럼·인덱스를 싣고 id는 싣지 않는다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    expect(p.kind).toBe('tables')
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables).toHaveLength(1)
    const t = p.tables[0]!
    expect(t.physicalName).toBe('MBR')
    expect(t.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM', 'GRD_CD'])
    expect(t.indexes.map((ix) => ix.name)).toEqual(['UX_MBR_01'])
    // id가 어디에도 없어야 한다
    expect(JSON.stringify(p)).not.toContain('"t2"')
    expect(JSON.stringify(p)).not.toContain('"c2"')
  })

  it('컬럼은 order 순으로 실린다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables[0]!.columns.map((c) => c.logicalName)).toEqual(['회원번호', '회원명', '등급코드'])
  })

  it('관계는 싣지 않는다', () => {
    const p = serializeTables(buildSampleModel(), ['t1', 't2'])
    expect(JSON.stringify(p)).not.toContain('relationship')
    expect(JSON.stringify(p)).not.toContain('columnMappings')
  })

  it('인덱스의 컬럼 참조는 물리명으로 실린다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables[0]!.indexes[0]!.columns).toEqual([{ columnPhysicalName: 'MBR_NM', direction: 'asc' }])
  })

  it('도메인은 이름으로 실린다', () => {
    // fullModel: c2가 도메인 d1(이름 "명")을 쓴다
    const p = serializeTables(fullModel(), ['tb1'])
    if (p.kind !== 'tables') throw new Error('kind')
    const c2 = p.tables[0]!.columns.find((c) => c.physicalName === 'MBR_NM')!
    expect(c2.domainName).toBe('명')
    expect(JSON.stringify(p)).not.toContain('"d1"')
  })

  it('커스텀 항목 값은 필드 이름을 키로 실린다', () => {
    // fullModel: c2.custom = { '개인정보여부': 'true' }, customFields cf1.name = '개인정보여부'
    const p = serializeTables(fullModel(), ['tb1'])
    if (p.kind !== 'tables') throw new Error('kind')
    const c2 = p.tables[0]!.columns.find((c) => c.physicalName === 'MBR_NM')!
    expect(c2.custom).toEqual({ '개인정보여부': 'true' })
  })
})

describe('serializeColumns', () => {
  it('선택한 컬럼만 order 순으로 싣는다', () => {
    const p = serializeColumns(buildSampleModel(), ['c4', 'c2'])
    expect(p.kind).toBe('columns')
    if (p.kind !== 'columns') throw new Error('kind')
    expect(p.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'GRD_CD'])
  })
})

describe('parseClipboard', () => {
  it('직렬화 결과를 되읽는다', () => {
    const text = JSON.stringify(serializeTables(buildSampleModel(), ['t2']))
    expect(parseClipboard(text)).not.toBeNull()
  })

  it('__erdd 표식이 없으면 null', () => {
    expect(parseClipboard(JSON.stringify({ kind: 'tables', tables: [] }))).toBeNull()
  })

  it('버전이 다르면 null', () => {
    expect(parseClipboard(JSON.stringify({ __erdd: 1, v: 99, kind: 'tables', tables: [] }))).toBeNull()
  })

  it('JSON이 아니면 null', () => {
    expect(parseClipboard('그냥 텍스트')).toBeNull()
    expect(parseClipboard('')).toBeNull()
  })

  it('kind가 모르는 값이면 null', () => {
    expect(parseClipboard(JSON.stringify({ __erdd: 1, v: 1, kind: 'notes', notes: [] }))).toBeNull()
  })
})

describe('uniqueName', () => {
  it('충돌이 없으면 그대로 둔다', () => {
    expect(uniqueName('주문', new Set(['회원']), '_사본')).toBe('주문')
  })

  it('충돌하면 접미사를 붙인다', () => {
    expect(uniqueName('주문', new Set(['주문']), '_사본')).toBe('주문_사본')
  })

  it('접미사도 충돌하면 번호를 올린다', () => {
    expect(uniqueName('주문', new Set(['주문', '주문_사본']), '_사본')).toBe('주문_사본2')
    expect(uniqueName('주문', new Set(['주문', '주문_사본', '주문_사본2']), '_사본')).toBe('주문_사본3')
  })

  it('물리명 접미사도 같은 규칙이다', () => {
    expect(uniqueName('ORD', new Set(['ORD']), '_COPY')).toBe('ORD_COPY')
    expect(uniqueName('ORD', new Set(['ORD', 'ORD_COPY']), '_COPY')).toBe('ORD_COPY2')
  })
})
```

> ⚠️ **픽스처 실제 값을 확인했다:** `buildSampleModel`의 t2 컬럼은 c2(MBR_NO, order 0)·c3(MBR_NM, order 1)·c4(GRD_CD, order 2), 인덱스 i1은 `UX_MBR_01`이고 컬럼은 c3(MBR_NM) asc다. `fullModel`의 c2는 `domainId: 'd1'`이고 d1의 `name`은 `'명'`, `custom`은 `{ '개인정보여부': 'true' }`이며 cf1의 `name`도 `'개인정보여부'`다. 어긋나면 단언을 정정하고 보고하라.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/clipboard.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/clipboard.ts`:

```typescript
import type { ProjectModel } from '@erdd/core'

/** 클립보드 형식 버전. 형식을 바꾸면 올리고, 모르는 버전은 조용히 무시된다. */
const CLIPBOARD_VERSION = 1

export type ClipboardColumn = {
  logicalName: string
  physicalName: string
  type: string
  isPk: boolean
  autoIncrement: boolean
  nullable: boolean
  defaultValue: string | null
  comment: string | null
  /** 도메인은 id가 아니라 이름으로 싣는다 — 다른 프로젝트에서 id는 무의미하다. */
  domainName: string | null
  /** 키가 customField의 **이름**이다(id가 아니다). */
  custom: Record<string, string>
}

export type ClipboardIndex = {
  name: string
  unique: boolean
  /** 컬럼도 id가 아니라 물리명으로 참조한다. */
  columns: { columnPhysicalName: string; direction: 'asc' | 'desc' }[]
}

export type ClipboardTable = {
  logicalName: string
  physicalName: string
  comment: string | null
  position: { x: number; y: number }
  custom: Record<string, string>
  columns: ClipboardColumn[]
  indexes: ClipboardIndex[]
}

export type ClipboardPayload =
  | { __erdd: 1; v: number; kind: 'tables'; tables: ClipboardTable[] }
  | { __erdd: 1; v: number; kind: 'columns'; columns: ClipboardColumn[] }

/** customField id → 이름. 값 맵의 키를 이름으로 바꿀 때 쓴다. */
function customFieldNames(model: ProjectModel): Map<string, string> {
  return new Map(Object.values(model.customFields).map((f) => [f.id, f.name]))
}

function toClipboardColumn(model: ProjectModel, columnId: string, names: Map<string, string>): ClipboardColumn | null {
  const c = model.columns[columnId]
  if (!c) return null
  const custom: Record<string, string> = {}
  for (const [fieldId, value] of Object.entries(c.custom)) {
    const name = names.get(fieldId)
    if (name !== undefined) custom[name] = value   // dangling 키는 버린다
  }
  return {
    logicalName: c.logicalName,
    physicalName: c.physicalName,
    type: c.type,
    isPk: c.isPk,
    autoIncrement: c.autoIncrement,
    nullable: c.nullable,
    defaultValue: c.defaultValue,
    comment: c.comment,
    domainName: c.domainId === null ? null : (model.domains[c.domainId]?.name ?? null),
    custom,
  }
}

export function serializeTables(model: ProjectModel, tableIds: string[]): ClipboardPayload {
  const names = customFieldNames(model)
  const tables: ClipboardTable[] = []
  for (const tableId of tableIds) {
    const t = model.tables[tableId]
    if (!t) continue
    const cols = Object.values(model.columns)
      .filter((c) => c.tableId === tableId)
      .sort((a, b) => a.order - b.order)
    const byId = new Map(cols.map((c) => [c.id, c]))
    const custom: Record<string, string> = {}
    for (const [fieldId, value] of Object.entries(t.custom)) {
      const name = names.get(fieldId)
      if (name !== undefined) custom[name] = value
    }
    tables.push({
      logicalName: t.logicalName,
      physicalName: t.physicalName,
      comment: t.comment,
      position: { ...t.position },
      custom,
      columns: cols.map((c) => toClipboardColumn(model, c.id, names)).filter((c): c is ClipboardColumn => c !== null),
      indexes: Object.values(model.indexes)
        .filter((ix) => ix.tableId === tableId)
        .map((ix) => ({
          name: ix.name,
          unique: ix.unique,
          // 이 테이블에 없는 컬럼을 가리키는 항목은 버린다(붙여넣을 곳이 없다).
          columns: ix.columns
            .map((c) => {
              const col = byId.get(c.columnId)
              return col ? { columnPhysicalName: col.physicalName, direction: c.direction } : null
            })
            .filter((c): c is { columnPhysicalName: string; direction: 'asc' | 'desc' } => c !== null),
        })),
    })
  }
  return { __erdd: 1, v: CLIPBOARD_VERSION, kind: 'tables', tables }
}

export function serializeColumns(model: ProjectModel, columnIds: string[]): ClipboardPayload {
  const names = customFieldNames(model)
  const ordered = columnIds
    .map((id) => model.columns[id])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .sort((a, b) => a.order - b.order)
  return {
    __erdd: 1, v: CLIPBOARD_VERSION, kind: 'columns',
    columns: ordered
      .map((c) => toClipboardColumn(model, c.id, names))
      .filter((c): c is ClipboardColumn => c !== null),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 클립보드 텍스트를 페이로드로 읽는다. 이 앱이 쓴 것이 아니면 null.
 * 다른 앱에서 복사한 텍스트를 캔버스에 붙여넣는 것은 정상적인 오작동이므로 오류를 내지 않는다.
 */
export function parseClipboard(text: string): ClipboardPayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw['__erdd'] !== 1) return null
  if (raw['v'] !== CLIPBOARD_VERSION) return null
  if (raw['kind'] === 'tables' && Array.isArray(raw['tables'])) {
    return raw as unknown as ClipboardPayload
  }
  if (raw['kind'] === 'columns' && Array.isArray(raw['columns'])) {
    return raw as unknown as ClipboardPayload
  }
  return null
}

/**
 * used와 충돌하지 않는 이름을 만든다. 충돌이 없으면 base 그대로.
 * 「주문」→「주문_사본」→「주문_사본2」, 「ORD」→「ORD_COPY」→「ORD_COPY2」.
 * ⚠️ 물리명 길이 제한을 넘길 수 있다 — 자르지 않는다(too-long 경고가 잡는다, 설계 §3.5).
 */
export function uniqueName(base: string, used: Set<string>, suffix: string): string {
  if (!used.has(base)) return base
  const first = `${base}${suffix}`
  if (!used.has(first)) return first
  let n = 2
  while (used.has(`${base}${suffix}${n}`)) n++
  return `${base}${suffix}${n}`
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/clipboard.test.ts`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

두 가지를 확인한다:
1. `parseClipboard`의 `if (raw['__erdd'] !== 1) return null`을 지우면 **"__erdd 표식이 없으면 null"**이 실패하는가
2. `uniqueName`의 `if (!used.has(base)) return base`를 지우면 **"충돌이 없으면 그대로 둔다"**가 실패하는가

신규 파일이라 `git checkout`이 통하지 않는다 — 변조 전 내용을 스크래치에 복사해 두고 편집으로 되돌린 뒤 `diff`로 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/clipboard.ts apps/web/src/editor/clipboard.test.ts && \
git commit -m "feat(web): 클립보드 직렬화·파싱·개명 순수 함수"
```

---

## Task 4: `clipboard-edits.ts` — 붙여넣기 producer

**Files:**
- Create: `apps/web/src/editor/clipboard-edits.ts`
- Test: `apps/web/src/editor/clipboard-edits.test.ts`

**Interfaces:**
- Consumes: Task 3의 `ClipboardPayload`·`uniqueName`
- Produces:
  - `pasteTables(model, payload, opts: { ids: PastedTableIds[]; offset: {x,y} }): ProjectModel`
  - `pasteColumns(model, payload, opts: { tableId: string; ids: string[] }): ProjectModel`
  - `planPasteTableIds(payload, newId: () => string): PastedTableIds[]`
  - `planPasteColumnIds(payload, newId: () => string): string[]`
  - Task 7이 이것들을 쓴다.

⚠️ **id는 producer 밖에서 발급한다.** `serializeMutation`이 producer를 지연 실행하므로 producer 안에서 `newId()`를 부르면 재실행 시 다른 id가 나온다. N:M 사이클의 `planJunction`이 같은 이유로 id를 미리 계산한다(`HANDOFF.md` 3.4).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/clipboard-edits.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildSampleModel, fullModel } from '@erdd/core/src/testing/fixtures.js'
import { serializeColumns, serializeTables } from './clipboard.js'
import { planPasteColumnIds, planPasteTableIds, pasteColumns, pasteTables } from './clipboard-edits.js'

/** 결정론적 id 생성기 — 테스트에서 발급 순서를 그대로 관찰한다. */
function idGen() {
  let n = 0
  return () => `new${++n}`
}

describe('pasteTables', () => {
  it('같은 프로젝트에 붙여넣으면 이름이 개명된다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const ids = planPasteTableIds(payload, idGen())
    const next = pasteTables(m, payload, { ids, offset: { x: 40, y: 40 } })
    const added = Object.values(next.tables).filter((t) => !Object.hasOwn(m.tables, t.id))
    expect(added).toHaveLength(1)
    expect(added[0]!.logicalName).toBe('회원_사본')
    expect(added[0]!.physicalName).toBe('MBR_COPY')
  })

  it('두 번 붙여넣으면 번호가 올라간다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    let next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const gen2 = () => { let n = 100; return () => `x${++n}` }
    next = pasteTables(next, payload, { ids: planPasteTableIds(payload, gen2()), offset: { x: 0, y: 0 } })
    const names = Object.values(next.tables).map((t) => t.logicalName).sort()
    expect(names).toContain('회원_사본')
    expect(names).toContain('회원_사본2')
  })

  it('컬럼과 인덱스가 함께 붙고 인덱스는 새 컬럼을 가리킨다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const cols = Object.values(next.columns).filter((c) => c.tableId === added.id)
    expect(cols).toHaveLength(3)
    const ix = Object.values(next.indexes).find((i) => i.tableId === added.id)!
    const target = next.columns[ix.columns[0]!.columnId]!
    expect(target.tableId).toBe(added.id)        // 원본 c3가 아니라 사본을 가리킨다
    expect(target.physicalName).toBe('MBR_NM')
  })

  it('관계는 붙지 않는다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t1', 't2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    expect(Object.keys(next.relationships)).toHaveLength(Object.keys(m.relationships).length)
  })

  it('위치에 오프셋이 더해진다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 40, y: 40 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    expect(added.position).toEqual({ x: 340, y: 40 })   // 원본 t2가 (300, 0)
  })

  it('도메인은 이름으로 재연결되고 없으면 null이 된다', () => {
    const src = fullModel()
    const payload = serializeTables(src, ['tb1'])
    // 도메인이 없는 프로젝트에 붙여넣는다
    const target = buildSampleModel()
    const next = pasteTables(target, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.physicalName === 'MBR')!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.domainId).toBeNull()
    expect(c.type).toBe('VARCHAR(100)')    // 복사본의 type 문자열이 유지된다
  })

  it('같은 이름의 도메인이 있으면 그 id로 연결된다', () => {
    const src = fullModel()
    const payload = serializeTables(src, ['tb1'])
    const next = pasteTables(src, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.domainId).toBe('d1')
  })

  it('커스텀 항목은 이름으로 재연결되고 없는 이름은 버려진다', () => {
    const src = fullModel()
    const payload = serializeTables(src, ['tb1'])
    const next = pasteTables(src, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.custom).toEqual({ cf1: 'true' })     // 이름 '개인정보여부' → id cf1

    const bare = pasteTables(buildSampleModel(), payload, {
      ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 },
    })
    const t = Object.values(bare.tables).find((x) => x.physicalName === 'MBR')!
    const bc = Object.values(bare.columns).find((x) => x.tableId === t.id && x.physicalName === 'MBR_NM')!
    expect(bc.custom).toEqual({})
  })
})

describe('pasteColumns', () => {
  it('대상 테이블 끝에 order를 이어 붙인다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])
    const ids = planPasteColumnIds(payload, idGen())
    const next = pasteColumns(m, payload, { tableId: 't1', ids })
    const cols = Object.values(next.columns).filter((c) => c.tableId === 't1').sort((a, b) => a.order - b.order)
    expect(cols).toHaveLength(2)
    expect(cols[1]!.physicalName).toBe('MBR_NO')
    expect(cols[1]!.order).toBeGreaterThan(cols[0]!.order)
  })

  it('대상 테이블에 동명 컬럼이 있으면 개명한다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])          // MBR_NO / 회원번호
    const next = pasteColumns(m, payload, { tableId: 't2', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).filter((c) => c.tableId === 't2' && !Object.hasOwn(m.columns, c.id))
    expect(added).toHaveLength(1)
    expect(added[0]!.physicalName).toBe('MBR_NO_COPY')
    expect(added[0]!.logicalName).toBe('회원번호_사본')
  })

  it('개명 범위는 대상 테이블 안이다 — 다른 테이블의 동명 컬럼은 무관하다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c1'])          // GRD_CD, t1 소속. t2에도 GRD_CD(c4)가 있다
    const next = pasteColumns(m, payload, { tableId: 't1', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).filter((c) => c.tableId === 't1' && !Object.hasOwn(m.columns, c.id))
    // t1 안에 GRD_CD(c1)가 이미 있으므로 개명된다
    expect(added[0]!.physicalName).toBe('GRD_CD_COPY')
  })

  it('붙여넣은 컬럼은 PK가 아니다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])          // c2는 isPk: true
    const next = pasteColumns(m, payload, { tableId: 't1', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).find((c) => c.tableId === 't1' && !Object.hasOwn(m.columns, c.id))!
    expect(added.isPk).toBe(false)
  })

  it('kind가 맞지 않으면 모델을 그대로 돌려준다', () => {
    const m = buildSampleModel()
    const tablePayload = serializeTables(m, ['t2'])
    expect(pasteColumns(m, tablePayload, { tableId: 't1', ids: [] })).toBe(m)
  })
})
```

> ⚠️ **「붙여넣은 컬럼은 PK가 아니다」는 설계에 명시되지 않은 판단이다.** 근거: PK 복사가 그대로 붙으면 대상 테이블의 PK 구성이 조용히 바뀌고, 그 테이블을 참조하는 관계의 `incomplete-mapping` 경고가 즉시 뜬다. **이 판단이 맞는지 컨트롤러에게 확인을 요청하고, 확인 전까지는 이 테스트를 포함해 구현하라.** 반대 판정이 나오면 이 테스트 하나만 뒤집으면 된다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/clipboard-edits.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/clipboard-edits.ts`:

```typescript
import type { Column, ProjectModel, TableIndex } from '@erdd/core'
import { uniqueName, type ClipboardPayload } from './clipboard.js'

/** 테이블 하나를 붙여넣는 데 필요한 id 묶음. producer 밖에서 발급한다. */
export type PastedTableIds = {
  tableId: string
  columnIds: string[]
  indexIds: string[]
}

/**
 * 붙여넣기에 쓸 id를 미리 발급한다.
 * ⚠️ producer 안에서 newId()를 부르면 serializeMutation의 재실행에서 다른 id가 나온다.
 */
export function planPasteTableIds(payload: ClipboardPayload, newId: () => string): PastedTableIds[] {
  if (payload.kind !== 'tables') return []
  return payload.tables.map((t) => ({
    tableId: newId(),
    columnIds: t.columns.map(() => newId()),
    indexIds: t.indexes.map(() => newId()),
  }))
}

export function planPasteColumnIds(payload: ClipboardPayload, newId: () => string): string[] {
  if (payload.kind !== 'columns') return []
  return payload.columns.map(() => newId())
}

/** customField 이름 → id. 없는 이름은 버린다(다른 프로젝트에는 그 정의가 없다). */
function customByName(model: ProjectModel, custom: Record<string, string>): Record<string, string> {
  const idByName = new Map(Object.values(model.customFields).map((f) => [f.name, f.id]))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(custom)) {
    const id = idByName.get(name)
    if (id !== undefined) out[id] = value
  }
  return out
}

/** 도메인 이름 → id. 같은 이름이 없으면 null(타입 문자열은 복사본 값을 그대로 쓴다). */
function domainIdByName(model: ProjectModel, name: string | null): string | null {
  if (name === null) return null
  return Object.values(model.domains).find((d) => d.name === name)?.id ?? null
}

export function pasteTables(
  model: ProjectModel, payload: ClipboardPayload,
  { ids, offset }: { ids: PastedTableIds[]; offset: { x: number; y: number } },
): ProjectModel {
  if (payload.kind !== 'tables') return model

  const tables = { ...model.tables }
  const columns = { ...model.columns }
  const indexes = { ...model.indexes }

  // 개명 판정에 쓰는 사용 중 이름. 붙여넣는 도중에도 갱신해 자기들끼리 충돌하지 않게 한다.
  const usedTableLogical = new Set(Object.values(tables).map((t) => t.logicalName))
  const usedTablePhysical = new Set(Object.values(tables).map((t) => t.physicalName))
  const usedIndexNames = new Set(Object.values(indexes).map((ix) => ix.name))

  payload.tables.forEach((src, ti) => {
    const plan = ids[ti]
    if (!plan) return

    const logicalName = uniqueName(src.logicalName, usedTableLogical, '_사본')
    const physicalName = uniqueName(src.physicalName, usedTablePhysical, '_COPY')
    usedTableLogical.add(logicalName)
    usedTablePhysical.add(physicalName)

    tables[plan.tableId] = {
      id: plan.tableId,
      logicalName,
      physicalName,
      comment: src.comment,
      groupId: null,                       // 그룹은 붙여넣지 않는다(그룹 자체를 복사 대상에서 뺐다)
      position: { x: src.position.x + offset.x, y: src.position.y + offset.y },
      groupPosition: null,
      custom: customByName(model, src.custom),
    }

    // 새 테이블 안의 컬럼 물리명 → 새 컬럼 id. 인덱스 재연결에 쓴다.
    const columnIdByPhysical = new Map<string, string>()
    src.columns.forEach((c, ci) => {
      const columnId = plan.columnIds[ci]
      if (columnId === undefined) return
      const column: Column = {
        id: columnId,
        tableId: plan.tableId,
        logicalName: c.logicalName,
        physicalName: c.physicalName,
        type: c.type,
        isPk: c.isPk,
        autoIncrement: c.autoIncrement,
        nullable: c.nullable,
        defaultValue: c.defaultValue,
        order: ci,
        comment: c.comment,
        domainId: domainIdByName(model, c.domainName),
        custom: customByName(model, c.custom),
      }
      columns[columnId] = column
      columnIdByPhysical.set(c.physicalName, columnId)
    })

    src.indexes.forEach((ix, ii) => {
      const indexId = plan.indexIds[ii]
      if (indexId === undefined) return
      const cols = ix.columns
        .map((c) => {
          const columnId = columnIdByPhysical.get(c.columnPhysicalName)
          return columnId ? { columnId, direction: c.direction } : null
        })
        .filter((c): c is { columnId: string; direction: 'asc' | 'desc' } => c !== null)
      if (cols.length === 0) return        // 가리킬 컬럼이 없으면 인덱스를 만들지 않는다
      const name = uniqueName(ix.name, usedIndexNames, '_COPY')
      usedIndexNames.add(name)
      const index: TableIndex = { id: indexId, tableId: plan.tableId, name, columns: cols, unique: ix.unique }
      indexes[indexId] = index
    })
  })

  return { ...model, tables, columns, indexes }
}

export function pasteColumns(
  model: ProjectModel, payload: ClipboardPayload,
  { tableId, ids }: { tableId: string; ids: string[] },
): ProjectModel {
  if (payload.kind !== 'columns') return model
  if (!model.tables[tableId]) return model

  const siblings = Object.values(model.columns).filter((c) => c.tableId === tableId)
  // 개명 판정 범위는 **대상 테이블 안**이다(컬럼 물리명 중복 경고가 테이블 단위다).
  const usedLogical = new Set(siblings.map((c) => c.logicalName))
  const usedPhysical = new Set(siblings.map((c) => c.physicalName))
  let order = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.order)) + 1

  const columns = { ...model.columns }
  payload.columns.forEach((src, i) => {
    const id = ids[i]
    if (id === undefined) return
    const logicalName = uniqueName(src.logicalName, usedLogical, '_사본')
    const physicalName = uniqueName(src.physicalName, usedPhysical, '_COPY')
    usedLogical.add(logicalName)
    usedPhysical.add(physicalName)
    columns[id] = {
      id,
      tableId,
      logicalName,
      physicalName,
      type: src.type,
      // PK는 이어받지 않는다 — 대상 테이블의 키 구성이 조용히 바뀌면 관계 경고가 즉시 뜬다.
      isPk: false,
      autoIncrement: src.autoIncrement,
      nullable: src.nullable,
      defaultValue: src.defaultValue,
      order: order++,
      comment: src.comment,
      domainId: domainIdByName(model, src.domainName),
      custom: customByName(model, src.custom),
    }
  })
  return { ...model, columns }
}
```

⚠️ `TableIndex` 타입 이름을 `@erdd/core`에서 확인하라(`packages/core/src/model.ts:48` 부근의 인덱스 스키마에서 유도되는 타입명). 다르면 실제 이름으로 맞추고 보고한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/clipboard-edits.test.ts`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

1. `uniqueName(src.logicalName, usedTableLogical, '_사본')`을 `src.logicalName`으로 바꾸면 **"같은 프로젝트에 붙여넣으면 이름이 개명된다"**가 실패하는가
2. `domainIdByName`을 항상 `null` 반환으로 바꾸면 **"같은 이름의 도메인이 있으면 그 id로 연결된다"**가 실패하는가
3. `pasteColumns`의 `usedPhysical`을 **모델 전체 컬럼**으로 넓히면 **"개명 범위는 대상 테이블 안이다"**가 실패하는가

신규 파일이므로 스크래치 복사본으로 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/clipboard-edits.ts apps/web/src/editor/clipboard-edits.test.ts && \
git commit -m "feat(web): 붙여넣기 producer — 이름 재연결과 자동 개명"
```

---

## Task 5: 캔버스 노드 — 컬럼 클릭과 선택 표시

**Files:**
- Modify: `apps/web/src/editor/table-node.tsx:9-17`(data 타입), `:76-111`(컬럼 `<li>`), `nodes.ts`(선택 컬럼 전달)
- Test: `apps/web/src/editor/table-node.test.tsx`

**Interfaces:**
- Consumes: Task 1 `selectColumn`, Task 2의 `buildNodes` 시그니처
- Produces: `TableNodeData`에 `selectedColumnIds?: string[]`·`onColumnClick?: (columnId, mode) => void`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`table-node.test.tsx`에 추가:

```typescript
it('컬럼을 클릭하면 replace 모드로 콜백이 불린다', async () => {
  const onColumnClick = vi.fn()
  render(<TableNode data={{ ...baseData, onColumnClick }} />)
  await userEvent.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
  expect(onColumnClick).toHaveBeenCalledWith('c2', 'replace')
})

it('Cmd/Ctrl+클릭은 toggle 모드다', async () => {
  const onColumnClick = vi.fn()
  render(<TableNode data={{ ...baseData, onColumnClick }} />)
  await userEvent.keyboard('{Meta>}')
  await userEvent.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
  await userEvent.keyboard('{/Meta}')
  expect(onColumnClick).toHaveBeenCalledWith('c2', 'toggle')
})

it('Shift+클릭은 range 모드다', async () => {
  const onColumnClick = vi.fn()
  render(<TableNode data={{ ...baseData, onColumnClick }} />)
  await userEvent.keyboard('{Shift>}')
  await userEvent.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
  await userEvent.keyboard('{/Shift}')
  expect(onColumnClick).toHaveBeenCalledWith('c2', 'range')
})

it('선택된 컬럼에 aria-selected가 붙는다', () => {
  render(<TableNode data={{ ...baseData, selectedColumnIds: ['c2'] }} />)
  const row = screen.getByRole('button', { name: /회원번호|MBR_NO/ })
  expect(row).toHaveAttribute('aria-selected', 'true')
})

it('선택되지 않은 컬럼에는 aria-selected가 false다', () => {
  render(<TableNode data={{ ...baseData, selectedColumnIds: [] }} />)
  const row = screen.getByRole('button', { name: /회원번호|MBR_NO/ })
  expect(row).toHaveAttribute('aria-selected', 'false')
})
```

> `baseData`는 이 파일의 기존 픽스처를 쓴다. 없으면 `TableNodeData`를 만족하는 객체를 파일 상단에 만들고, `buildSampleModel()`의 t2와 그 컬럼 c2·c3·c4를 넣는다. **접근성 이름이 `viewMode`에 따라 달라지므로** 정규식으로 조회한다(`physical`이면 `MBR_NO`, `logical`이면 `회원번호`).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/table-node.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`TableNodeData`(`:9-17`)에 추가:

```typescript
  selectedColumnIds?: string[]
  onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
```

컬럼 `<li>`(`:80`)를 버튼 역할로 바꾼다. **`stopPropagation`이 필수다** — 하지 않으면 React Flow의 `onNodeClick`이 함께 발화해 컬럼 선택이 곧바로 테이블 선택으로 덮인다:

```tsx
            <li
              key={c.id}
              role="button"
              tabIndex={0}
              aria-selected={selectedColumnIds.includes(c.id)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs',
                selectedColumnIds.includes(c.id) && 'bg-primary/10',
                onColumnClick && 'cursor-pointer',
              )}
              onClick={(e) => {
                if (!onColumnClick) return
                e.stopPropagation()   // React Flow의 onNodeClick이 테이블 선택으로 덮어쓰는 것을 막는다
                const mode = e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'
                onColumnClick(c.id, mode)
              }}
            >
```

`data` 구조분해(`:38`)에 기본값을 추가한다:

```typescript
  const { table, columns, viewMode, selected, tableWarnings = [], columnWarnings = {}, peers = [],
    selectedColumnIds = [], onColumnClick } = data
```

`nodes.ts`의 `buildNodes`에 선택 컬럼과 콜백을 흘려보낸다. 시그니처를 넓힌다:

```typescript
export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedIds: string[], warnings: Warning[],
  view: NodeView = { kind: 'full' }, peerMarks: PeerMarks = new Map(),
  columnSelection: {
    selectedColumnIds?: string[]
    onColumnClick?: (columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  } = {},
): Node<TableNodeData>[] {
```

각 노드의 `data`에 넣되, **선택된 테이블에만** 컬럼 선택을 실어야 한다(불변식: 컬럼 선택은 한 테이블에만 존재한다):

```typescript
      selectedColumnIds: selectedIds.length === 1 && selectedIds[0] === table.id
        ? columnSelection.selectedColumnIds
        : [],
      onColumnClick: columnSelection.onColumnClick,
```

`canvas.tsx`에서 넘긴다:

```typescript
  const selectedColumnIds = useEditorStore((s) => s.selectedColumnIds)
  const selectColumn = useEditorStore((s) => s.selectColumn)
```

`buildNodes(model, viewMode, selectedIds, warnings, view, peerMarks, { selectedColumnIds, onColumnClick })` — `onColumnClick`은 `useCallback`으로 감싸 노드 재생성을 줄인다:

```typescript
  const onColumnClick = useCallback(
    (columnId: string, mode: 'replace' | 'toggle' | 'range') => {
      const col = model.columns[columnId]
      if (col) selectColumn(col.tableId, columnId, mode)
    },
    [model.columns, selectColumn],
  )
```

`derived`의 `useMemo` 의존성에 `selectedColumnIds`·`onColumnClick`을 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/table-node.test.tsx`
Expected: PASS

그리고 `pnpm -C apps/web exec vitest run src/editor/canvas.test.tsx`로 캔버스 회귀가 없는지 본다.

- [ ] **Step 5: 구분력을 확인한다**

`e.stopPropagation()`을 지우고 **캔버스 통합 테스트**(있으면)에서 컬럼 클릭이 테이블 선택으로 덮이는지 확인한다. 단위 테스트만으로는 이 회귀가 안 잡히므로, **잡히지 않으면 그 사실을 보고하라** — 브라우저 스모크(Task 8)가 유일한 방어선이 된다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/table-node.tsx apps/web/src/editor/table-node.test.tsx \
  apps/web/src/editor/nodes.ts apps/web/src/editor/canvas.tsx && \
git commit -m "feat(web): 캔버스에서 컬럼을 클릭해 선택한다"
```

---

## Task 6: 편집 패널 — 컬럼 하이라이트·스크롤·다중 선택 표시

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx` — `EditPanel` 상단(선택 읽기), `ColumnRow`(하이라이트·ref)
- Test: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1 `selectedColumnIds`·`selectedTableIds`
- Produces: 없음

⚠️ **트랙 A+B가 같은 파일의 입력 필드를 고치고 있다.** 이 태스크는 **컬럼 행의 `<li>` 속성과 패널 상단의 분기**만 건드린다. `CommitInput`·`FieldLabel`·역생성 핸들러에 손대지 마라.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
it('선택된 컬럼 행에 aria-selected가 붙는다', () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
  renderPanel()
  const rows = screen.getAllByRole('listitem')
  const selected = rows.filter((r) => r.getAttribute('aria-selected') === 'true')
  expect(selected).toHaveLength(1)
})

it('테이블이 여러 개 선택되면 폼 대신 개수를 보여준다', () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().selectTables(['t1', 't2'])
  renderPanel()
  expect(screen.getByText(/2개 선택됨/)).toBeInTheDocument()
  expect(screen.queryByLabelText(/테이블 물리명/)).toBeNull()
})

it('선택이 하나면 기존처럼 폼이 나온다', () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t2')
  renderPanel()
  expect(screen.getByLabelText(/테이블 물리명/)).toBeInTheDocument()
})
```

> `getByLabelText(/테이블 물리명/)`을 **정규식**으로 쓴 이유는 트랙 A+B가 라벨에 별표를 붙이기 때문이다. 병합 전에는 정확일치도 통과하지만 정규식이 양쪽에서 다 통과한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`EditPanel` 상단(`:49`, Task 2가 이미 `selectedTableIds`로 바꿔 놓았다)에 추가:

```typescript
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const selectedColumnIds = useEditorStore((s) => s.selectedColumnIds)
  const table = selectedTableIds.length === 1 ? model.tables[selectedTableIds[0]!] : undefined
```

`if (!table)` 분기(`:68`) **앞에** 다중 선택 분기를 넣는다:

```tsx
  if (selectedTableIds.length > 1) {
    return (
      <aside className="w-80 shrink-0 border-l bg-card p-4">
        <p className="text-sm">테이블 {selectedTableIds.length}개 선택됨</p>
        <p className="mt-2 text-xs text-muted-foreground">
          복사·잘라내기·삭제는 단축키로 선택 전체에 적용됩니다.
        </p>
      </aside>
    )
  }
```

`ColumnRow`에 `selected` prop을 더하고 `<li>`에 반영한다:

```tsx
function ColumnRow(props: {
  column: Column; isFirst: boolean; isLast: boolean; warnings: Warning[]; domains: Domain[]
  canEdit: boolean
  selected: boolean
  // …기존 prop들
}) {
```

```tsx
    <li
      className={cn('grid gap-2 rounded-md border p-2', props.selected && 'ring-2 ring-primary')}
      aria-selected={props.selected}
      ref={props.selected ? selectedRef : undefined}
    >
```

`cn`을 import한다(`@/lib/utils`). 스크롤은 `EditPanel`에서 처리한다 — `ColumnRow`가 매 렌더 새 ref를 만들지 않도록 패널이 ref를 소유한다:

```typescript
  const selectedRowRef = useRef<HTMLLIElement | null>(null)
  const firstSelectedColumnId = selectedColumnIds[0]
  useEffect(() => {
    // block: 'nearest' — 이미 보이는 컬럼을 클릭했을 때 패널이 튀지 않아야 한다.
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [firstSelectedColumnId])
```

`<ColumnRow>` 호출부에 넘긴다:

```tsx
            selected={selectedColumnIds.includes(c.id)}
            rowRef={c.id === firstSelectedColumnId ? selectedRowRef : undefined}
```

`ColumnRow`의 prop 타입에 `rowRef?: Ref<HTMLLIElement>`를 더하고 `<li ref={props.rowRef}>`로 받는다.

⚠️ **jsdom에는 `scrollIntoView`가 없다.** 테스트에서 `Element.prototype.scrollIntoView`를 스텁하거나(`vi.fn()`), optional chaining으로 이미 방어돼 있는지 확인한다. `?.`는 ref가 null일 때만 막아 주고 메서드 부재는 못 막으므로, **테스트 setup에 스텁이 필요한지 실제로 돌려 확인하고 보고하라.**

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

`aria-selected={props.selected}`를 `aria-selected={false}`로 고정하면 첫 테스트가 실패하는지 확인하고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 사이드바가 선택된 컬럼으로 스크롤하고 다중 선택을 표시한다"
```

---

## Task 7: 단축키와 클립보드 배선

**Files:**
- Create: `apps/web/src/editor/use-shortcuts.ts`
- Modify: `apps/web/src/editor/canvas.tsx`(장착·`deleteKeyCode` 해제)
- Test: `apps/web/src/editor/use-shortcuts.test.tsx`

**Interfaces:**
- Consumes: Task 1 선택 상태, Task 3 직렬화, Task 4 붙여넣기
- Produces: `useEditorShortcuts({ projectId }): void`

**배경:** 붙여넣기는 **`paste` 이벤트**로 받는다 — `navigator.clipboard.readText()`는 권한 프롬프트를 띄우는 브라우저가 있어 Cmd+V 경로에 부적합하다(설계 §3.8). 쓰기는 사용자 제스처 안이므로 `writeText`를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/use-shortcuts.test.tsx`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { serializeColumns } from './clipboard.js'
import { useEditorShortcuts } from './use-shortcuts.js'

function Harness() {
  useEditorShortcuts({ projectId: '018f6b0e-0000-7000-8000-0000000000aa' })
  return <input aria-label="텍스트" />
}

// 실제 렌더에는 trpc provider가 필요하다 — 이 파일의 다른 테스트가 쓰는 wrapper를 재사용한다.
function renderHarness() { /* edit-panel.test.tsx의 renderPanel과 같은 wrapper를 쓴다 */ }

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset()
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  useEditorStore.getState().reset()
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('useEditorShortcuts', () => {
  it('테이블을 선택하고 Cmd+C를 누르면 클립보드에 tables 페이로드가 쓰인다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.__erdd).toBe(1)
    expect(payload.kind).toBe('tables')
  })

  it('컬럼이 선택돼 있으면 columns 페이로드가 쓰인다', async () => {
    useEditorStore.getState().selectColumn('t2', 'c2', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('columns')
    expect(payload.columns).toHaveLength(1)
  })

  // ⚠️ 이 가드가 회귀하면 텍스트를 치는 중 Delete가 테이블을 지운다. 유일한 방어선이다.
  it('입력란에 포커스가 있으면 아무 동작도 하지 않는다', async () => {
    useEditorStore.getState().select('t2')
    renderHarness()
    const input = document.querySelector('input')!
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).not.toHaveBeenCalled()
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  it('Delete는 선택된 테이블을 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']).toBeUndefined())
  })

  it('컬럼이 선택돼 있으면 Delete가 컬럼만 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.columns['c3']).toBeUndefined())
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
  })

  it('paste 이벤트로 컬럼을 붙여넣는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const payload = serializeColumns(buildSampleModel(), ['c2'])
    useEditorStore.getState().select('t1')
    renderHarness()
    const e = new Event('paste', { bubbles: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', {
      value: { getData: () => JSON.stringify(payload) },
    })
    document.dispatchEvent(e)
    await waitFor(() => {
      const cols = Object.values(useEditorStore.getState().model.columns).filter((c) => c.tableId === 't1')
      expect(cols).toHaveLength(2)
    })
  })

  it('__erdd가 아닌 텍스트를 붙여넣으면 아무 일도 없다', async () => {
    useEditorStore.getState().select('t1')
    renderHarness()
    const before = Object.keys(useEditorStore.getState().model.columns).length
    const e = new Event('paste', { bubbles: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '그냥 텍스트' } })
    document.dispatchEvent(e)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(useEditorStore.getState().model.columns)).toHaveLength(before)
  })

  it('읽기 전용이면 X·V·Delete가 무시되고 C만 동작한다', async () => {
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().select('t2')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useEditorStore.getState().model.tables['t2']).toBeDefined()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })
})
```

> ⚠️ **`renderHarness`를 실제로 채워야 한다.** `useModelMutation`이 trpc 컨텍스트를 요구하므로 `edit-panel.test.tsx:17-26`의 `renderPanel`과 같은 wrapper가 필요하다. 그 형태를 그대로 복사해 `<Harness />`를 감싼다. **wrapper 없이 렌더하면 훅이 던진다** — 그 오류를 보면 이 지시를 다시 읽어라.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/use-shortcuts.test.tsx`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/use-shortcuts.ts`:

```typescript
import { useEffect } from 'react'
import { deleteColumnCascade, type ProjectModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { parseClipboard, serializeColumns, serializeTables } from './clipboard.js'
import {
  pasteColumns, pasteTables, planPasteColumnIds, planPasteTableIds,
} from './clipboard-edits.js'
import { removeTable } from './model-edits.js'

/** 붙여넣은 테이블을 원본 위에 겹치지 않게 밀어 놓는 거리(px). */
const PASTE_OFFSET = { x: 40, y: 40 }

/** 입력 중인가 — 그렇다면 단축키를 전부 브라우저 기본 동작에 넘긴다. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * 캔버스 단축키. document에 걸되 입력 중에는 아무것도 하지 않는다.
 * 붙여넣기는 paste 이벤트로 받는다 — navigator.clipboard.readText()는 권한 프롬프트를 띄우는
 * 브라우저가 있어 Cmd+V 경로에 쓸 수 없다(설계 §3.8).
 */
export function useEditorShortcuts({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)

  useEffect(() => {
    const copyPayload = (model: ProjectModel, tableIds: string[], columnIds: string[]) =>
      (columnIds.length > 0 ? serializeColumns(model, columnIds) : serializeTables(model, tableIds))

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const s = useEditorStore.getState()
      const { model, canEdit, selectedTableIds, selectedColumnIds } = s
      const mod = e.metaKey || e.ctrlKey
      const nothingSelected = selectedTableIds.length === 0

      if (mod && e.key.toLowerCase() === 'c') {
        if (nothingSelected) return
        e.preventDefault()
        void navigator.clipboard.writeText(JSON.stringify(
          copyPayload(model, selectedTableIds, selectedColumnIds)))
        return
      }

      if (mod && e.key.toLowerCase() === 'x') {
        if (!canEdit || nothingSelected) return
        e.preventDefault()
        // 복사와 삭제를 한 mutation으로 — Revision 1건 · undo 1회(설계 §3.6)
        void navigator.clipboard.writeText(JSON.stringify(
          copyPayload(model, selectedTableIds, selectedColumnIds)))
        const columnIds = [...selectedColumnIds]
        const tableIds = [...selectedTableIds]
        void mutate(
          (m) => (columnIds.length > 0
            ? columnIds.reduce((acc, id) => deleteColumnCascade(acc, id), m)
            : tableIds.reduce((acc, id) => removeTable(acc, id), m)),
          { summary: '잘라내기' },
        )
        s.select(null)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit || nothingSelected) return
        e.preventDefault()
        const columnIds = [...selectedColumnIds]
        const tableIds = [...selectedTableIds]
        void mutate(
          (m) => (columnIds.length > 0
            ? columnIds.reduce((acc, id) => deleteColumnCascade(acc, id), m)
            : tableIds.reduce((acc, id) => removeTable(acc, id), m)),
          { summary: columnIds.length > 0 ? '컬럼 삭제' : '테이블 삭제' },
        )
        if (columnIds.length === 0) s.select(null)
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const s = useEditorStore.getState()
      if (!s.canEdit) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const payload = parseClipboard(text)
      if (!payload) return          // 이 앱이 쓴 것이 아니면 조용히 무시한다
      e.preventDefault()

      if (payload.kind === 'columns') {
        const tableId = s.selectedTableIds.length === 1 ? s.selectedTableIds[0] : undefined
        if (tableId === undefined) return
        const ids = planPasteColumnIds(payload, newId)     // producer 밖에서 발급
        void mutate((m) => pasteColumns(m, payload, { tableId, ids }), { summary: '컬럼 붙여넣기' })
        return
      }

      const ids = planPasteTableIds(payload, newId)
      void mutate((m) => pasteTables(m, payload, { ids, offset: PASTE_OFFSET }),
        { summary: '테이블 붙여넣기' })
      s.selectTables(ids.map((i) => i.tableId))
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('paste', onPaste)
    }
  }, [mutate])
}
```

⚠️ **`removeTable`이 `model-edits.ts`에 있는지 확인하라**(`:46`에 있다). 없으면 실제 이름으로 맞추고 보고한다.

`canvas.tsx`에 장착하고 React Flow의 자체 삭제를 끈다:

```typescript
  useEditorShortcuts({ projectId })
```

```tsx
        deleteKeyCode={null}
```

> **`deleteKeyCode={null}`인 이유:** 두 삭제 경로가 공존하면 컬럼 선택 상태에서 어느 쪽이 이기는지가 렌더 순서에 달린다. 단축키 훅이 컬럼/테이블을 모두 다루므로 React Flow의 것은 끈다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/use-shortcuts.test.tsx`
Expected: PASS

Run: `pnpm -C apps/web test`
Expected: 전체 그린. `deleteKeyCode`를 기대하던 기존 캔버스 테스트가 있으면 단언을 정정하고 보고한다.

- [ ] **Step 5: 구분력을 확인한다**

1. `if (isTypingTarget(e.target)) return`을 지우면 **"입력란에 포커스가 있으면 아무 동작도 하지 않는다"**가 실패하는가 — **이 가드의 구분력이 가장 중요하다**
2. `if (!payload) return`을 지우면 **"__erdd가 아닌 텍스트를 붙여넣으면 아무 일도 없다"**가 실패하는가
3. `planPasteColumnIds(payload, newId)`를 producer 안으로 옮기면 무엇이 깨지는지 관찰한다 — **깨지지 않으면 그 사실을 보고하라**(이 계약을 잡는 테스트가 없다는 뜻이다)

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/use-shortcuts.ts apps/web/src/editor/use-shortcuts.test.tsx \
  apps/web/src/editor/canvas.tsx && \
git commit -m "feat(web): 복사·잘라내기·붙여넣기·삭제 단축키"
```

---

## Task 8: 매뉴얼 — 새 절 추가

**Files:**
- Modify: `docs/manual/user-guide.md`
- Test: 없음

⚠️ **트랙 A+B가 이 파일의 명명·폼 절을 고치고 있다. 새 절만 추가하고 기존 절을 건드리지 마라.**

- [ ] **Step 1: 실제 문구를 확인한다**

```bash
grep -n "선택됨\|붙여넣기\|잘라내기" apps/web/src/editor
```

- [ ] **Step 2: 새 절을 쓴다**

캔버스 조작을 다루는 절 **뒤에** 「선택과 복사」 절을 추가한다. 담을 것:

- **선택** — 테이블 클릭, 드래그 박스·Shift로 여러 개, 컬럼 클릭으로 컬럼 선택(사이드바가 그 컬럼으로 이동), Cmd/Ctrl+클릭 토글, Shift+클릭 범위
- **복사·붙여넣기** — 테이블 선택 상태에서 Cmd/Ctrl+C면 테이블 전체, 컬럼 선택 상태면 그 컬럼들. 붙여넣기는 컬럼이면 선택된 테이블 끝에, 테이블이면 캔버스에
- **다른 프로젝트로** — 다른 탭·다른 프로젝트에 붙여넣을 수 있다. 도메인·커스텀 항목은 **이름이 같으면 다시 연결**되고 없으면 「없음」이 된다(타입 문자열은 유지)
- **이름 충돌** — 자동으로 「_사본」·`_COPY`가 붙는다
- **관계는 복사되지 않는다** — 붙여넣은 뒤 선을 다시 긋는다
- **단축키 표** — Cmd/Ctrl+C·X·V, Delete/Backspace. **입력란에 커서가 있으면 동작하지 않는다**
- **잘라내기·삭제는 undo 1회로 되돌아간다**

- [ ] **Step 3: 커밋**

```bash
git add docs/manual/user-guide.md && \
git commit -m "docs: 매뉴얼에 선택·복사·단축키 절을 추가한다"
```

---

## Task 9: 전체 검증

- [ ] **Step 1: typecheck**

```bash
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

Expected: `EXIT=0`. 출력이 비어도 종료코드가 1이면 실패다.

- [ ] **Step 2: 전체 스위트**

```bash
pnpm -C apps/web test
```

Expected: 그린. **기준선 web 450에서 이 트랙이 올린 만큼 늘어야 한다.** 실제 수를 세어 보고한다.

- [ ] **Step 3: 범위 확인**

```bash
git diff --stat main -- packages apps/server
```

Expected: 출력 없음. core·cli·server 무변경이 이 트랙의 계약이다.

- [ ] **Step 4: 워킹트리 clean**

```bash
git status
```

Expected: clean.

---

## Self-Review 기록

**Spec coverage:**

| 설계 항목 | 태스크 |
|---|---|
| C-1 선택 모델 (테이블·컬럼 다중) | Task 1 |
| §3.1 소비자 6곳 교체 | Task 2 |
| C-2 사이드바 포커싱 | Task 6 |
| §3.3 클립보드 형식·`__erdd`·`v` | Task 3 |
| §3.4 id를 싣지 않음 · 이름으로 참조 | Task 3(직렬화)·4(재연결) |
| §3.5 개명 규칙 | Task 3(`uniqueName`)·4(적용) |
| §3.6 잘라내기 단일 mutation | Task 7 |
| §3.7 단축키 가드 | Task 7 |
| §3.8 paste 이벤트 | Task 7 |
| D-C3 인덱스만·관계 제외 | Task 3·4 |
| D-C5 presence 무변경 | Task 2 |
| §5.3 클릭 수식 키 | Task 5 |
| §5.4 다중 선택 패널 | Task 6 |
| §6.5 스모크 | 아래 |

**Placeholder scan:** 통과. 다만 두 곳에 **의도적인 조사 지시**가 있다 — Task 2의 zustand 배열 셀렉터(useShallow 필요 여부), Task 6의 jsdom `scrollIntoView` 스텁. 둘 다 "확인하고 보고하라"로 닫혀 있고 판단 기준을 함께 적었다.

**Type consistency:**
- `selectColumn(tableId, columnId, mode)` — Task 1 정의, Task 5 호출 ✓
- `buildNodes(..., selectedIds: string[], ..., columnSelection?)` — Task 2에서 배열로, Task 5에서 7번째 인자 추가 ✓
- `ClipboardPayload` — Task 3 정의, Task 4·7 소비 ✓
- `planPasteTableIds(payload, newId): PastedTableIds[]` / `pasteTables(model, payload, { ids, offset })` — Task 4 정의, Task 7 호출 ✓
- `uniqueName(base, used, suffix)` — Task 3 정의, Task 4 사용 ✓

**미해결 — 컨트롤러 판단 필요:**
- **Task 4의 「붙여넣은 컬럼은 PK가 아니다」는 설계에 없는 판단이다.** 계획은 그렇게 구현하도록 썼고 근거를 적었다. 반대 판정이면 테스트 하나와 `isPk: false` 한 줄만 뒤집으면 된다.

**브라우저 스모크 (설계 §6.5, 병합 후 컨트롤러):**
1. 컬럼 클릭 → 사이드바 스크롤·하이라이트
2. Cmd+클릭·Shift+클릭 다중 컬럼 → Cmd+C → 다른 테이블 선택 → Cmd+V
3. 드래그 박스로 테이블 여러 개 → Cmd+X → Cmd+V → **undo 1회로 전부 복구**
4. **다른 프로젝트 탭**에 붙여넣기 → 도메인 이름 재연결 / 없으면 「없음」
5. 같은 프로젝트에 두 번 붙여넣기 → `_사본`, `_사본2`
6. 입력란에 타이핑 중 Delete·Cmd+C가 **테이블을 건드리지 않음**
7. **대조군**: 다른 앱에서 복사한 일반 텍스트를 붙여넣기 → 아무 일도 없어야 한다
