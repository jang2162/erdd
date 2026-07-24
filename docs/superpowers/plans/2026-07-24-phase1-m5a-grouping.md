# Phase 1 M5a — 그룹 관리·전체 뷰 색상 영역 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 테이블을 업무 영역별 그룹으로 묶고(생성·이름·색상·설명·배정·삭제), 좌측 트리를 그룹별로 묶어 보여주며, 전체 뷰 캔버스에 그룹을 반투명 색상 영역으로 표시한다.

**Architecture:** 그룹 도메인 로직(생성/수정/삭제-멤버해제/배정)은 무결성 규칙(테이블은 최대 1그룹, 그룹 삭제 시 멤버 미배정)을 포함하므로 `packages/core`의 순수 producer로 둔다(M4b relationship.ts와 동일 패턴, CLI `groups.yaml`이 재사용). 웹은 M4b에서 확립한 단일 mutation 경로(producer+diff)·선택 스토어·패널 분기 패턴을 그대로 확장한다. 색상 영역은 테이블 뒤에 렌더하는 비상호작용 'group' 노드로 표현하되, 라벨만 클릭 가능(그룹 선택)하게 한다.

**Tech Stack:** TypeScript, React 19, @xyflow/react, Zustand, @erdd/core(zod), vitest, @testing-library/react.

## Global Constraints

- 데이터 모델은 이미 준비됨(추가 스키마 변경 없음): `TableGroup { id, name, color, comment }`, `Table { …, groupId: string|null, position, groupPosition: PositionSchema|null }`. `validateModelIntegrity`는 이미 `table.groupId`가 존재하는 그룹을 참조하는지 검사한다(integrity.ts:34-41).
- 테이블은 **최대 1개 그룹**에 속한다(`groupId` 단일 값, 미배정 = null).
- 그룹 삭제 시 **멤버 테이블은 삭제하지 않고 미배정(groupId=null)으로 되돌린다**. 그러지 않으면 무결성 위반(존재하지 않는 그룹 참조).
- 모든 core producer는 **불변**(입력 모델 미변경, 새 객체 반환), IO 없음(id는 파라미터로 주입).
- 웹 변경은 모두 M4b `useModelMutation` 단일 경로를 지난다(낙관적+diff+직렬화). 선택은 store에서 상호 배타(table/relationship/note/**group** 중 하나만 non-null).
- 색상 영역은 **표시 전용**(M5a). 그룹 영역 드래그로 멤버 이동, 그룹 뷰(독립 배치), 외부 참조, 그룹 필터는 **M5b 범위**(이 계획 밖).
- 새로고침 후 그룹·소속·색상이 서버에서 복원되어야 한다(M3 영속화 경로 사용, 서버 변경 없음).
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖 (M5b로 명시적 이월)

- 그룹 영역 드래그 시 소속 테이블 함께 이동(위치 모델을 그룹 뷰와 함께 홀리스틱하게 설계).
- 그룹 뷰(그룹만 표시·독립 groupPosition 배치·외부 참조 고스트 노드).
- 그룹 기준 검색/필터.
- 다중 선택 후 일괄 배정(다중 선택 자체가 미구현 — M4b 백로그).

---

## File Structure

**core (신규):**
- `packages/core/src/group.ts` — `createGroup`, `updateGroup`, `deleteGroup`, `setTableGroup`.
- `packages/core/src/group.test.ts`

**core (수정):**
- `packages/core/src/index.ts` — 신규 export.

**web (신규):**
- `apps/web/src/editor/group-node.tsx` — 색상 영역 'group' 노드.
- `apps/web/src/editor/group-nodes.ts` — `buildGroupNodes(model, selectedGroupId): Node[]` (멤버 bbox 근사).
- `apps/web/src/editor/group-panel.tsx` — 그룹 편집 패널.
- `apps/web/src/editor/group-palette.ts` — 기본 색상 팔레트·다음 색상 선택.
- 대응 테스트: `group-nodes.test.ts`, `group-panel.test.tsx`.

**web (수정):**
- `apps/web/src/editor/store.ts` — `selectedGroupId` + `selectGroup`, `CLEARED_SELECTION`에 편입, reset.
- `apps/web/src/editor/edit-panel.tsx` — 그룹 분기(관계/노트 다음), 테이블 편집에 "소속 그룹" select.
- `apps/web/src/editor/table-tree.tsx` — 그룹별 묶음 + "미분류" + 그룹 헤더(색·이름·선택) + "그룹 추가".
- `apps/web/src/editor/canvas.tsx` — 그룹 노드 concat·nodeTypes 등록(비상호작용).

---

## Task 1: core 그룹 도메인 producer

**Files:**
- Create: `packages/core/src/group.ts`, `packages/core/src/group.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ProjectModel`, `TableGroup`, `Table` (from `./model.js`).
- Produces:
  ```ts
  createGroup(model, args: { id: string; name: string; color: string; comment?: string | null }): ProjectModel
  updateGroup(model, id: string, patch: Partial<Pick<TableGroup, 'name' | 'color' | 'comment'>>): ProjectModel
  deleteGroup(model, id: string): ProjectModel        // 그룹 제거 + 멤버 테이블 groupId=null
  setTableGroup(model, tableId: string, groupId: string | null): ProjectModel  // groupId!=null이고 그룹 없으면 no-op
  ```

### Implementation notes (읽고 시작)

- 모두 불변. 없는 대상(그룹/테이블 id 없음)은 모델 그대로 반환(no-op). `setTableGroup`에 존재하지 않는 groupId를 주면 no-op(무결성 유지).
- `createGroup`은 이미 존재하는 id면 그대로 반환(중복 방지). comment 기본 null.
- `deleteGroup`은 그룹을 지우고, 그 그룹에 속한 모든 테이블의 `groupId`를 null로 되돌린다(멤버 테이블 자체는 보존).

### Steps

- [ ] **Step 1: 실패 테스트** — `packages/core/src/group.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { createGroup, updateGroup, deleteGroup, setTableGroup } from './group.js'
import { createEmptyModel, type ProjectModel, type Table } from './model.js'

function tbl(id: string, over: Partial<Table> = {}): Table {
  return { id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, ...over }
}
function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['T1'] = tbl('T1')
  m.tables['T2'] = tbl('T2')
  return m
}

describe('createGroup', () => {
  it('그룹을 추가한다', () => {
    const next = createGroup(base(), { id: 'G1', name: '회원', color: '#0E7A6C' })
    expect(next.tableGroups['G1']).toMatchObject({ id: 'G1', name: '회원', color: '#0E7A6C', comment: null })
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('이미 있는 id는 no-op', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const again = createGroup(m, { id: 'G1', name: '다른이름', color: '#fff' })
    expect(again.tableGroups['G1']!.name).toBe('회원')
  })
})

describe('updateGroup', () => {
  it('이름·색상·설명을 바꾼다', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const next = updateGroup(m, 'G1', { name: '주문', color: '#C89B3C', comment: '주문 도메인' })
    expect(next.tableGroups['G1']).toMatchObject({ name: '주문', color: '#C89B3C', comment: '주문 도메인' })
  })
  it('없는 그룹은 no-op', () => {
    const m = base()
    expect(updateGroup(m, 'X', { name: 'y' })).toBe(m)
  })
})

describe('setTableGroup', () => {
  it('테이블을 그룹에 배정한다', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const next = setTableGroup(m, 'T1', 'G1')
    expect(next.tables['T1']!.groupId).toBe('G1')
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('null로 미배정한다', () => {
    let m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    m = setTableGroup(m, 'T1', 'G1')
    const next = setTableGroup(m, 'T1', null)
    expect(next.tables['T1']!.groupId).toBeNull()
  })
  it('존재하지 않는 그룹으로 배정하면 no-op', () => {
    const m = base()
    expect(setTableGroup(m, 'T1', 'NOPE')).toBe(m)
  })
  it('없는 테이블은 no-op', () => {
    const m = base()
    expect(setTableGroup(m, 'X', null)).toBe(m)
  })
})

describe('deleteGroup', () => {
  it('그룹을 지우고 멤버 테이블을 미배정으로 되돌린다', () => {
    let m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    m = setTableGroup(m, 'T1', 'G1')
    m = setTableGroup(m, 'T2', 'G1')
    const next = deleteGroup(m, 'G1')
    expect(next.tableGroups['G1']).toBeUndefined()
    expect(next.tables['T1']!.groupId).toBeNull()
    expect(next.tables['T2']!.groupId).toBeNull()
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 그룹은 no-op', () => {
    const m = base()
    expect(deleteGroup(m, 'X')).toBe(m)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core test group` → FAIL.

- [ ] **Step 3: 구현** — `packages/core/src/group.ts`

```ts
import type { ProjectModel, TableGroup } from './model.js'

export function createGroup(
  model: ProjectModel,
  args: { id: string; name: string; color: string; comment?: string | null },
): ProjectModel {
  if (Object.hasOwn(model.tableGroups, args.id)) return model
  const group: TableGroup = { id: args.id, name: args.name, color: args.color, comment: args.comment ?? null }
  return { ...model, tableGroups: { ...model.tableGroups, [args.id]: group } }
}

export function updateGroup(
  model: ProjectModel, id: string,
  patch: Partial<Pick<TableGroup, 'name' | 'color' | 'comment'>>,
): ProjectModel {
  const group = model.tableGroups[id]
  if (!group) return model
  return { ...model, tableGroups: { ...model.tableGroups, [id]: { ...group, ...patch } } }
}

export function setTableGroup(
  model: ProjectModel, tableId: string, groupId: string | null,
): ProjectModel {
  const table = model.tables[tableId]
  if (!table) return model
  if (groupId !== null && !Object.hasOwn(model.tableGroups, groupId)) return model
  if (table.groupId === groupId) return model
  return { ...model, tables: { ...model.tables, [tableId]: { ...table, groupId } } }
}

export function deleteGroup(model: ProjectModel, id: string): ProjectModel {
  if (!Object.hasOwn(model.tableGroups, id)) return model
  const tableGroups = { ...model.tableGroups }
  delete tableGroups[id]
  // 멤버 테이블은 보존하되 미배정으로 되돌린다.
  const tables = { ...model.tables }
  for (const [tid, t] of Object.entries(model.tables)) {
    if (t.groupId === id) tables[tid] = { ...t, groupId: null }
  }
  return { ...model, tableGroups, tables }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/core test group` → PASS.

- [ ] **Step 5: index.ts export**

```ts
export { createGroup, updateGroup, deleteGroup, setTableGroup } from './group.js'
```

- [ ] **Step 6: 전체 검증** — `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/group.ts packages/core/src/group.test.ts packages/core/src/index.ts
git commit -m "feat(core): 그룹 도메인 producer — 생성·수정·삭제(멤버 미배정)·배정"
```

---

## Task 2: 웹 스토어 선택 확장 + 그룹 편집 패널 + 테이블 소속 배정

**Files:**
- Modify: `apps/web/src/editor/store.ts`, `apps/web/src/editor/edit-panel.tsx`
- Create: `apps/web/src/editor/group-panel.tsx`, `apps/web/src/editor/group-palette.ts`, `apps/web/src/editor/group-panel.test.tsx`

**Interfaces:**
- Consumes: `createGroup`/`updateGroup`/`deleteGroup`/`setTableGroup` (Task 1), `useModelMutation`, `newId`.
- Produces (later tasks rely on these):
  ```ts
  // store
  selectedGroupId: string | null
  selectGroup: (id: string | null) => void        // table/relationship/note 선택 해제
  // group-palette
  GROUP_PALETTE: string[]                          // 기본 색상들
  nextGroupColor(usedColors: string[]): string     // 미사용 색 우선 순환
  ```

### 설계 (읽고 시작)

- 선택 상태는 M4b에서 `selectedTableId`/`selectedRelationshipId`/`selectedNoteId`가 `CLEARED_SELECTION`으로 상호 배타. 여기에 `selectedGroupId`를 4번째로 추가한다. 모든 `select*` 액션이 나머지 3개를 null로 만든다.
- edit-panel 분기 순서: relationship → note → **group** → table → 빈 상태.
- 테이블 편집 패널에 "소속 그룹" `<select>`(미분류 + 그룹들) 추가. `setTableGroup` 사용. `<select>`는 controlled이므로 **onChange에서 값을 즉시 캡처**한다(M4b 회귀 교훈: producer 클로저에서 `e.target.value` 지연 읽기 금지).

### Steps

- [ ] **Step 1: store 확장** — `apps/web/src/editor/store.ts`

`EditorState`에 필드/액션 추가, `CLEARED_SELECTION`에 `selectedGroupId: null` 포함, `select`/`selectRelationship`/`selectNote`가 자동으로 그룹 선택도 해제(스프레드로 이미 처리됨), `selectGroup` 추가, `reset`에 반영:

```ts
// EditorState 타입에 추가:
selectedGroupId: string | null
selectGroup: (id: string | null) => void

// CLEARED_SELECTION 상수에 추가:
const CLEARED_SELECTION = {
  selectedTableId: null, selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}

// create 초기값에 추가: selectedGroupId: null,
// 액션 추가:
selectGroup: (selectedGroupId) => set({ ...CLEARED_SELECTION, selectedGroupId }),
// 기존 select/selectRelationship/selectNote/focus는 CLEARED_SELECTION 스프레드라 그룹도 자동 해제됨.
// reset은 이미 ...CLEARED_SELECTION 사용 → 그룹 포함.
```

(주의: 기존 `focus` 액션은 `{ ...CLEARED_SELECTION, focusTableId: id, selectedTableId: id }` 형태였는지 확인하고 selectedGroupId가 CLEARED_SELECTION에 포함되어 자동 해제되는지 검증.)

- [ ] **Step 2: group-palette.ts**

```ts
// 데이터 도면 팔레트 계열의 그룹 색상. 서로 구분되는 채도.
export const GROUP_PALETTE = [
  '#0E7A6C', // teal
  '#C89B3C', // key gold
  '#3B6FB0', // blue
  '#9C5BB0', // purple
  '#C4453C', // red
  '#4C8C4A', // green
  '#B06A2C', // amber
  '#5A6270', // slate
]

/** usedColors에 없는 첫 색을 반환, 모두 쓰였으면 개수 기준 순환. */
export function nextGroupColor(usedColors: string[]): string {
  const used = new Set(usedColors)
  const free = GROUP_PALETTE.find((c) => !used.has(c))
  if (free) return free
  return GROUP_PALETTE[usedColors.length % GROUP_PALETTE.length]!
}
```

- [ ] **Step 3: group-panel.tsx**

```tsx
import { Trash2 } from 'lucide-react'
import { updateGroup, deleteGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function GroupPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const groupId = useEditorStore((s) => s.selectedGroupId)!
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const mutate = useModelMutation(projectId)
  const group = model.tableGroups[groupId]
  if (!group) return null

  const memberCount = Object.values(model.tables).filter((t) => t.groupId === groupId).length

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">그룹</h3>
        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="그룹 삭제"
          onClick={() => { selectGroup(null); void mutate((m) => deleteGroup(m, groupId), { summary: '그룹 삭제' }) }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">소속 테이블 {memberCount}개</p>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="grp-name">이름</Label>
          <Input id="grp-name" defaultValue={group.name} key={group.name}
            onBlur={(e) => { const name = e.target.value; if (name !== group.name && name.trim() !== '') void mutate((m) => updateGroup(m, groupId, { name })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-color">색상</Label>
          <input id="grp-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={group.color} key={group.color}
            onBlur={(e) => { const color = e.target.value; if (color !== group.color) void mutate((m) => updateGroup(m, groupId, { color })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grp-comment">설명</Label>
          <Input id="grp-comment" defaultValue={group.comment ?? ''} key={group.comment ?? ''}
            onBlur={(e) => { const v = e.target.value.trim() === '' ? null : e.target.value; if (v !== group.comment) void mutate((m) => updateGroup(m, groupId, { comment: v })) }} />
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: edit-panel.tsx — 그룹 분기 + 테이블 소속 그룹 select**

그룹 분기 추가(관계·노트 분기 다음, 테이블 분기 앞):
```tsx
import { GroupPanel } from './group-panel.js'
import { setTableGroup } from '@erdd/core'
// EditPanel 본문:
const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
if (selectedGroupId) return <GroupPanel projectId={projectId} />
```

테이블 편집 영역(물리명 입력 아래)에 "소속 그룹" select 추가. `table`, `mutate`, `model`이 스코프에 있어야 한다:
```tsx
<div className="grid gap-1.5">
  <Label htmlFor="tbl-group">소속 그룹</Label>
  <select id="tbl-group" className="h-9 rounded-md border bg-background px-2 text-sm"
    value={table.groupId ?? ''}
    onChange={(e) => {
      const groupId = e.target.value === '' ? null : e.target.value
      void mutate((m) => setTableGroup(m, tid, groupId), { summary: '그룹 배정' })
    }}>
    <option value="">미분류</option>
    {Object.values(model.tableGroups).map((g) => (
      <option key={g.id} value={g.id}>{g.name}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 5: group-panel.test.tsx** — 2개 테스트. edit-panel.test.tsx의 tRPC 목·provider 패턴 재사용. (a) 그룹 선택 시 이름·삭제 버튼 렌더 + 소속 개수 표시, (b) 삭제 클릭 시 그룹이 스토어에서 제거되고 selectedGroupId=null.

- [ ] **Step 6: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS(기존 56 + 신규).

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/group-panel.tsx apps/web/src/editor/group-palette.ts apps/web/src/editor/group-panel.test.tsx apps/web/src/editor/edit-panel.tsx
git commit -m "feat(web): 그룹 편집 패널·테이블 소속 배정·선택 스토어 확장"
```

---

## Task 3: 웹 좌측 트리 그룹화

**Files:**
- Modify: `apps/web/src/editor/table-tree.tsx`
- Create: `apps/web/src/editor/table-tree.test.tsx` (없으면 신규; 있으면 수정)

**Interfaces:**
- Consumes: store `selectedGroupId`/`selectGroup`/`focus`/`select`, `createGroup`(Task 1), `nextGroupColor`(Task 2), `useModelMutation`, `newId`.

### 설계 (읽고 시작)

- 트리를 그룹별 섹션으로 묶는다: 각 그룹(이름순) 헤더 + 그 소속 테이블, 마지막에 "미분류" 섹션(groupId=null 테이블). 그룹이 하나도 없으면 기존 평면 목록처럼 보인다(미분류만).
- 그룹 헤더: 색상 점(그룹 color) + 그룹명 + 소속 개수. 클릭 시 `selectGroup(group.id)`(패널로 편집).
- 트리 상단에 "그룹 추가" 버튼: `createGroup`로 새 그룹 생성(이름 "그룹 N" — 기존 그룹 수+1 기반 미중복, 색상 `nextGroupColor(사용중색들)`), 생성 후 `selectGroup(newId)`.
- 검색(q)은 기존대로 테이블 이름 필터. 필터된 테이블만 각 그룹 아래 표시하고, 소속 테이블이 0개인 그룹 헤더는 검색 중에는 숨긴다(검색어 없을 땐 항상 표시).
- 테이블 클릭은 기존대로 `focus(t.id)`.

### Steps

- [ ] **Step 1: 트리 그룹화 구현** — `table-tree.tsx` 전체 교체

```tsx
import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { createGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { nextGroupColor } from './group-palette.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TableTree({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const focus = useEditorStore((s) => s.focus)
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const mutate = useModelMutation(projectId)
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const match = (t: { physicalName: string; logicalName: string }) =>
    query === '' || t.physicalName.toLowerCase().includes(query) || t.logicalName.toLowerCase().includes(query)

  const allTables = Object.values(model.tables).filter(match)
    .sort((a, b) => a.physicalName.localeCompare(b.physicalName))
  const groups = Object.values(model.tableGroups).sort((a, b) => a.name.localeCompare(b.name))
  const unassigned = allTables.filter((t) => t.groupId === null || !model.tableGroups[t.groupId])

  const onAddGroup = () => {
    const id = newId()
    const n = Object.keys(model.tableGroups).length + 1
    const usedColors = Object.values(model.tableGroups).map((g) => g.color)
    void mutate((m) => createGroup(m, { id, name: `그룹${n}`, color: nextGroupColor(usedColors) }), { summary: '그룹 추가' })
    selectGroup(id)
  }

  const totalTables = Object.keys(model.tables).length

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-1 border-b p-2">
        <Input placeholder="테이블 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="그룹 추가" onClick={onAddGroup}>
          <FolderPlus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {groups.map((g) => {
          const members = allTables.filter((t) => t.groupId === g.id)
          if (query !== '' && members.length === 0) return null
          return (
            <div key={g.id} className="mb-1">
              <button type="button" onClick={() => selectGroup(g.id)}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent',
                  g.id === selectedGroupId && 'bg-accent')}>
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.color }} />
                <span className="flex-1 truncate text-xs font-semibold">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">{members.length}</span>
              </button>
              <ul className="ml-3 border-l pl-1">
                {members.map((t) => <TableItem key={t.id} t={t} selected={t.id === selectedTableId} onClick={() => focus(t.id)} />)}
              </ul>
            </div>
          )
        })}

        {(unassigned.length > 0 || groups.length > 0) && (
          <div className="mb-1">
            {groups.length > 0 && (
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">미분류</div>
            )}
            <ul className={groups.length > 0 ? 'ml-3 border-l pl-1' : undefined}>
              {unassigned.map((t) => <TableItem key={t.id} t={t} selected={t.id === selectedTableId} onClick={() => focus(t.id)} />)}
            </ul>
          </div>
        )}

        {allTables.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {totalTables === 0 ? '테이블을 추가해 설계를 시작하세요.' : '검색 결과가 없습니다.'}
          </p>
        )}
      </div>
    </aside>
  )
}

function TableItem({ t, selected, onClick }: {
  t: { id: string; physicalName: string; logicalName: string }; selected: boolean; onClick: () => void
}) {
  return (
    <li>
      <button type="button" onClick={onClick}
        className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent', selected && 'bg-accent')}>
        <span className="font-mono text-xs font-medium">{t.physicalName}</span>
        <span className="text-xs text-muted-foreground">{t.logicalName}</span>
      </button>
    </li>
  )
}
```

- [ ] **Step 2: project.tsx에서 TableTree에 projectId 전달** — `TableTree`가 이제 `projectId`를 받는다. `apps/web/src/pages/project.tsx`에서 `<TableTree />` → `<TableTree projectId={projectId} />`로 수정.

- [ ] **Step 3: 테스트** — `table-tree.test.tsx`가 이미 있으면 시그니처 변경(projectId prop, tRPC provider 필요)에 맞춰 갱신하고, 최소 1개 추가: 그룹과 미분류가 함께 있을 때 그룹 헤더+미분류 섹션이 렌더되는지. (없으면 신규 작성, edit-panel.test.tsx의 provider 패턴 재사용 — mutate 훅을 쓰므로 QueryClient/TRPC provider로 감싼다.)

- [ ] **Step 4: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/table-tree.tsx apps/web/src/editor/table-tree.test.tsx apps/web/src/pages/project.tsx
git commit -m "feat(web): 좌측 트리 그룹화 — 그룹별 묶음·미분류·그룹 추가"
```

---

## Task 4: 웹 전체 뷰 색상 영역

**Files:**
- Create: `apps/web/src/editor/group-nodes.ts`, `apps/web/src/editor/group-node.tsx`, `apps/web/src/editor/group-nodes.test.ts`
- Modify: `apps/web/src/editor/canvas.tsx`

**Interfaces:**
- Consumes: `ProjectModel`, store `selectedGroupId`/`selectGroup`.
- Produces:
  ```ts
  buildGroupNodes(model: ProjectModel, selectedGroupId: string | null): Node<GroupNodeData>[]
  type GroupNodeData = { group: TableGroup; selected: boolean }
  ```

### 설계 (읽고 시작)

- 각 그룹의 소속 테이블 위치로 **근사 bounding box**를 계산해, 그 영역을 감싸는 반투명 색상 박스를 테이블 **뒤에** 렌더한다. 표시 전용(드래그·이동은 M5b). 라벨만 클릭 가능(그룹 선택).
- 테이블 실제 렌더 크기를 알 수 없으므로 **근사치**를 쓴다: 폭 `EST_W=260`, 높이 `EST_H = 44 + max(1, 컬럼수) * 28`. bbox는 멤버들의 (position.x, position.y)~(position.x+EST_W, position.y+EST_H)의 min/max에 padding `PAD=28`을 더한다. 멤버가 없는 그룹은 노드를 만들지 않는다.
- React Flow에서 뒤에 그리기: `buildGroupNodes` 결과를 `derived` 배열의 **맨 앞**에 두고, 각 그룹 노드에 `zIndex: 0`(테이블/노트는 기본 위)·`selectable: false`·`draggable: false`. 컨테이너 div는 `pointer-events: none`, 라벨만 `pointer-events: auto`로 클릭 허용(빈 영역 클릭이 pane/테이블로 전달되도록).
- 노드 크기는 데이터로 넘긴다(`style={{ width, height }}` on the node via `width`/`height` fields, and the component reads them). React Flow 노드에 `width`/`height`를 직접 지정하고 컴포넌트가 `100%`로 채운다.

### Steps

- [ ] **Step 1: 실패 테스트** — `group-nodes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildGroupNodes } from './group-nodes.js'
import { createEmptyModel, type ProjectModel, type Table } from '@erdd/core'

function tbl(id: string, x: number, y: number, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x, y }, groupPosition: null }
}
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['G1'] = { id: 'G1', name: '회원', color: '#0E7A6C', comment: null }
  m.tables['T1'] = tbl('T1', 0, 0, 'G1')
  m.tables['T2'] = tbl('T2', 400, 200, 'G1')
  m.tables['T3'] = tbl('T3', 1000, 0, null) // 미분류
  return m
}

describe('buildGroupNodes', () => {
  it('멤버가 있는 그룹마다 영역 노드를 만든다', () => {
    const nodes = buildGroupNodes(model(), null)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.id).toBe('group:G1')
    expect(nodes[0]!.type).toBe('group')
    expect(nodes[0]!.selectable).toBe(false)
    expect(nodes[0]!.draggable).toBe(false)
  })
  it('영역이 멤버 위치를 포함한다(좌상단은 최소 위치보다 작거나 같다)', () => {
    const n = buildGroupNodes(model(), null)[0]!
    expect(n.position.x).toBeLessThanOrEqual(0)
    expect(n.position.y).toBeLessThanOrEqual(0)
    expect(typeof n.width).toBe('number')
    expect(n.width!).toBeGreaterThan(400)
  })
  it('멤버가 없는 그룹은 노드를 만들지 않는다', () => {
    const m = createEmptyModel()
    m.tableGroups['G1'] = { id: 'G1', name: '빈그룹', color: '#000', comment: null }
    expect(buildGroupNodes(m, null)).toHaveLength(0)
  })
  it('selectedGroupId면 selected=true', () => {
    const n = buildGroupNodes(model(), 'G1')[0]!
    expect((n.data as { selected: boolean }).selected).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/web test group-nodes` → FAIL.

- [ ] **Step 3: group-nodes.ts 구현**

```ts
import type { Node } from '@xyflow/react'
import type { ProjectModel, TableGroup } from '@erdd/core'

export type GroupNodeData = { group: TableGroup; selected: boolean }

const EST_W = 260
const PAD = 28

function estHeight(colCount: number): number {
  return 44 + Math.max(1, colCount) * 28
}

export function buildGroupNodes(
  model: ProjectModel, selectedGroupId: string | null,
): Node<GroupNodeData>[] {
  const nodes: Node<GroupNodeData>[] = []
  for (const group of Object.values(model.tableGroups)) {
    const members = Object.values(model.tables).filter((t) => t.groupId === group.id)
    if (members.length === 0) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const t of members) {
      const cols = Object.values(model.columns).filter((c) => c.tableId === t.id).length
      minX = Math.min(minX, t.position.x)
      minY = Math.min(minY, t.position.y)
      maxX = Math.max(maxX, t.position.x + EST_W)
      maxY = Math.max(maxY, t.position.y + estHeight(cols))
    }
    nodes.push({
      id: `group:${group.id}`,
      type: 'group',
      position: { x: minX - PAD, y: minY - PAD },
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD * 2,
      selectable: false,
      draggable: false,
      zIndex: 0,
      data: { group, selected: group.id === selectedGroupId },
    })
  }
  return nodes
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/web test group-nodes` → PASS.

- [ ] **Step 5: group-node.tsx 구현**

```tsx
import type { NodeProps } from '@xyflow/react'
import { useEditorStore } from './store.js'
import type { GroupNodeData } from './group-nodes.js'

/** 테이블 뒤 반투명 색상 영역. 컨테이너는 클릭 통과, 라벨만 클릭 가능(그룹 선택). */
export function GroupNode({ data }: NodeProps) {
  const { group, selected } = data as unknown as GroupNodeData
  const selectGroup = useEditorStore((s) => s.selectGroup)
  return (
    <div
      className="size-full rounded-xl border-2"
      style={{
        pointerEvents: 'none',
        borderColor: group.color,
        background: `${group.color}14`, // ~8% 불투명
        borderStyle: selected ? 'solid' : 'dashed',
      }}
    >
      <button
        type="button"
        onClick={() => selectGroup(group.id)}
        className="m-2 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
        style={{ pointerEvents: 'auto', background: group.color }}
      >
        {group.name}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: canvas.tsx 통합** — 그룹 노드를 derived 맨 앞에 concat, nodeTypes 등록

`canvas.tsx`(현재 Task 4/6에서 수정된 상태)를 읽고:
- import: `import { GroupNode } from './group-node.js'`, `import { buildGroupNodes } from './group-nodes.js'`
- `nodeTypes`에 `group: GroupNode` 추가
- `selectedGroupId` 구독 추가
- `derived` useMemo에서 그룹 노드를 **맨 앞**에 붙이고 deps에 `selectedGroupId` 추가:
  ```tsx
  const derived = useMemo(() => {
    const groupNodes = buildGroupNodes(model, selectedGroupId)
    const tableNodes = buildNodes(model, viewMode, selectedId, warnings)
    const noteNodes = /* 기존 노트 노드 */
    return [...groupNodes, ...tableNodes, ...noteNodes]
  }, [model, viewMode, selectedId, selectedNoteId, selectedGroupId, warnings])
  ```
  (기존 buildNodes 인자 순서·warnings 유지. 노트 노드 생성 로직은 그대로.)
- 그룹 노드는 `selectable:false`·`draggable:false`라 `onNodeDragStop`/`onNodeClick`에 그룹 id가 들어오지 않는다(안전). 그래도 방어적으로 `onNodeClick`/`onNodeDragStop`에서 `node.type === 'group'`이면 무시하도록 early-return 추가 가능(선택).

- [ ] **Step 7: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/editor/group-nodes.ts apps/web/src/editor/group-nodes.test.ts apps/web/src/editor/group-node.tsx apps/web/src/editor/canvas.tsx
git commit -m "feat(web): 전체 뷰 그룹 색상 영역 — 테이블 뒤 반투명 박스·라벨 선택"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- "그룹 추가"로 그룹이 생기고, 색상 점·이름과 함께 좌측 트리에 그룹 섹션이 나타난다.
- 테이블 편집 패널의 "소속 그룹" select로 배정하면 트리에서 해당 그룹 아래로 이동하고, 캔버스에 색상 영역이 그 테이블을 감싼다.
- 그룹 헤더/영역 라벨 클릭 시 그룹 패널에서 이름·색상·설명 편집, 삭제 가능.
- 그룹 삭제 시 소속 테이블은 남고 "미분류"로 이동한다(모델 무결성 유지).
- 색상 영역은 테이블 뒤에 그려지고, 빈 영역 클릭은 pane 선택 해제로 전달된다(영역이 클릭을 가로채지 않음).
- 새로고침 후 그룹·소속·색상이 서버에서 복원된다.
- 선택 배타: 그룹 선택 시 테이블/관계/노트 선택이 해제되고 그룹 패널이 뜬다.
- 전체 테스트(core+server+web) 통과, 타입체크 클린.

## M5b 이월 (이 계획 밖)

그룹 영역 드래그로 멤버 함께 이동, 그룹 뷰(그룹만 표시·독립 groupPosition 배치), 외부 참조 고스트 노드, 그룹 기준 검색/필터, 다중 선택 일괄 배정. 색상 영역 bbox를 측정 크기(node.measured) 기반으로 정밀화하는 것도 M5b에서 검토.
