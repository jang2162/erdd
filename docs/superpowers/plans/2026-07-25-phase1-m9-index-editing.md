# Phase 1 M9 — 인덱스 편집 UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 패널에서 선택한 테이블의 인덱스를 생성·편집(이름·유니크·구성 컬럼과 정렬 방향·순서)·삭제한다. 모델·DDL·무결성은 이미 인덱스를 지원하므로 core producer + 편집 패널 UI만 추가한다.

**Architecture:** 인덱스는 모델 엔티티(`IndexSchema { id, tableId, name, columns:[{columnId,direction}], unique }`)이며 이미 상태 테이블·DDL 생성기·무결성 검사가 지원한다. 관계/그룹과 동일하게 순수 producer를 `packages/core`에 두고(CLI·서버 재사용), 웹은 M4b 단일 mutation 경로(producer+diff)로 편집 패널에 인덱스 섹션을 추가한다. 인덱스 컬럼 배열은 UI가 "다음 배열"을 만들어 `updateIndex(columns)`로 넘기는 producer+diff 방식(개별 op 조립 금지).

**Tech Stack:** TypeScript, @erdd/core, React 19, Zustand, vitest.

## Global Constraints

- `IndexDef.columns`는 순서 있는 `{ columnId: string; direction: 'asc' | 'desc' }[]`. 컬럼 재정렬·방향·추가·제거는 UI가 next 배열을 만들어 `updateIndex(model, id, { columns })`로 커밋한다.
- core producer는 불변·IO 없음. 없는 대상(테이블/인덱스 id 없음)·중복 id는 no-op(모델 그대로 반환).
- `validateModelIntegrity`(이미 존재)가 인덱스 컬럼이 해당 테이블의 실존 컬럼인지 검사한다. UI는 그 테이블 컬럼만 추가하지만, producer가 잘못된 컬럼을 넣으면 `applyOps`의 무결성 검사가 막는다.
- 컬럼/테이블 삭제 시 인덱스 정리는 이미 M4b 캐스케이드(`deleteColumnCascade`가 인덱스 컬럼 정리·빈 인덱스 삭제, `deleteTableCascade`가 테이블 인덱스 삭제)로 처리됨 — **이 계획에서 캐스케이드 변경 없음**.
- 이벤트 값은 호출 시점 즉시 캡처(M4b~M8 교훈: producer 클로저에서 `e.target` 지연 읽기 금지).
- 새로고침 후 인덱스가 서버에서 복원되어야 한다(M3 영속화 경로, 서버 변경 없음).
- DDL 내보내기는 이미 인덱스를 출력하므로(M6), 인덱스를 만들면 DDL에 `CREATE [UNIQUE ]INDEX ...`가 자동 반영된다.
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖

- 인덱스 자동 제안(FK·PK 기반), 함수형/부분 인덱스, 인덱스 유형(BTREE/HASH 등), 인덱스 경고 배지(중복 인덱스 등).

---

## File Structure

**core (신규):**
- `packages/core/src/table-index.ts` — `createIndex`, `updateIndex`, `removeIndex`.
- `packages/core/src/table-index.test.ts`

**core (수정):**
- `packages/core/src/index.ts` — 신규 export.

**web (신규):**
- `apps/web/src/editor/index-section.tsx` — 편집 패널 인덱스 섹션(`IndexSection` + `IndexRow`).
- `apps/web/src/editor/index-section.test.tsx`

**web (수정):**
- `apps/web/src/editor/edit-panel.tsx` — 컬럼 섹션 아래에 `<IndexSection>` 삽입.

---

## Task 1: core 인덱스 producer

**Files:**
- Create: `packages/core/src/table-index.ts`, `packages/core/src/table-index.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `IndexDef`, `ProjectModel` (from `./model.js`).
- Produces:
  ```ts
  createIndex(model, args: { id: string; tableId: string; name: string; unique?: boolean; columns?: IndexDef['columns'] }): ProjectModel
  updateIndex(model, id: string, patch: Partial<Pick<IndexDef, 'name' | 'unique' | 'columns'>>): ProjectModel
  removeIndex(model, id: string): ProjectModel
  ```

### Steps

- [ ] **Step 1: 실패 테스트** — `table-index.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { createIndex, updateIndex, removeIndex } from './table-index.js'
import { createEmptyModel, type Column, type ProjectModel, type Table } from './model.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function col(id: string, tableId: string): Column {
  return { id, tableId, logicalName: id, physicalName: id.toUpperCase(), type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null }
}
function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['T'] = tbl('T')
  m.columns['C1'] = col('C1', 'T')
  m.columns['C2'] = col('C2', 'T')
  return m
}

describe('createIndex', () => {
  it('빈 컬럼·unique 기본 false로 인덱스를 만든다', () => {
    const next = createIndex(base(), { id: 'IX', tableId: 'T', name: 'IX_T_1' })
    expect(next.indexes['IX']).toMatchObject({ id: 'IX', tableId: 'T', name: 'IX_T_1', unique: false, columns: [] })
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('컬럼·unique 지정 생성 후 무결성 통과', () => {
    const next = createIndex(base(), {
      id: 'IX', tableId: 'T', name: 'UX_T', unique: true,
      columns: [{ columnId: 'C1', direction: 'asc' }, { columnId: 'C2', direction: 'desc' }],
    })
    expect(next.indexes['IX']!.unique).toBe(true)
    expect(next.indexes['IX']!.columns).toHaveLength(2)
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 테이블·중복 id는 no-op', () => {
    const m = base()
    expect(createIndex(m, { id: 'IX', tableId: 'NONE', name: 'x' })).toBe(m)
    const withIx = createIndex(m, { id: 'IX', tableId: 'T', name: 'a' })
    expect(createIndex(withIx, { id: 'IX', tableId: 'T', name: 'b' }).indexes['IX']!.name).toBe('a')
  })
})

describe('updateIndex', () => {
  it('이름·유니크·컬럼을 바꾼다', () => {
    const m = createIndex(base(), { id: 'IX', tableId: 'T', name: 'a' })
    const next = updateIndex(m, 'IX', { name: 'b', unique: true, columns: [{ columnId: 'C1', direction: 'desc' }] })
    expect(next.indexes['IX']).toMatchObject({ name: 'b', unique: true })
    expect(next.indexes['IX']!.columns).toEqual([{ columnId: 'C1', direction: 'desc' }])
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 인덱스는 no-op', () => {
    const m = base()
    expect(updateIndex(m, 'X', { name: 'y' })).toBe(m)
  })
})

describe('removeIndex', () => {
  it('인덱스를 지운다', () => {
    const m = createIndex(base(), { id: 'IX', tableId: 'T', name: 'a' })
    const next = removeIndex(m, 'IX')
    expect(next.indexes['IX']).toBeUndefined()
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 인덱스는 no-op', () => {
    const m = base()
    expect(removeIndex(m, 'X')).toBe(m)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @erdd/core test table-index` → FAIL.

- [ ] **Step 3: 구현** — `table-index.ts`

```ts
import type { IndexDef, ProjectModel } from './model.js'

export function createIndex(
  model: ProjectModel,
  args: { id: string; tableId: string; name: string; unique?: boolean; columns?: IndexDef['columns'] },
): ProjectModel {
  if (!model.tables[args.tableId]) return model
  if (Object.hasOwn(model.indexes, args.id)) return model
  const index: IndexDef = {
    id: args.id, tableId: args.tableId, name: args.name,
    unique: args.unique ?? false, columns: args.columns ?? [],
  }
  return { ...model, indexes: { ...model.indexes, [args.id]: index } }
}

export function updateIndex(
  model: ProjectModel, id: string,
  patch: Partial<Pick<IndexDef, 'name' | 'unique' | 'columns'>>,
): ProjectModel {
  const index = model.indexes[id]
  if (!index) return model
  return { ...model, indexes: { ...model.indexes, [id]: { ...index, ...patch } } }
}

export function removeIndex(model: ProjectModel, id: string): ProjectModel {
  if (!Object.hasOwn(model.indexes, id)) return model
  const indexes = { ...model.indexes }
  delete indexes[id]
  return { ...model, indexes }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @erdd/core test table-index` → PASS.

- [ ] **Step 5: index.ts export**

```ts
export { createIndex, updateIndex, removeIndex } from './table-index.js'
```

- [ ] **Step 6: 전체 검증** — `pnpm --filter @erdd/core test && pnpm --filter @erdd/core typecheck` → PASS.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/table-index.ts packages/core/src/table-index.test.ts packages/core/src/index.ts
git commit -m "feat(core): 인덱스 producer — 생성·수정·삭제"
```

---

## Task 2: 웹 편집 패널 인덱스 섹션

**Files:**
- Create: `apps/web/src/editor/index-section.tsx`, `apps/web/src/editor/index-section.test.tsx`
- Modify: `apps/web/src/editor/edit-panel.tsx`

**Interfaces:**
- Consumes: `createIndex`/`updateIndex`/`removeIndex`(Task 1), `useModelMutation`, `newId`; store `model`.
- Produces: `IndexSection({ projectId, tableId })`.

### 설계 (읽고 시작)

- `IndexSection`은 `model.indexes`에서 `tableId`가 일치하는 인덱스를 렌더한다. 상단 "인덱스 추가" 버튼 → `createIndex`(기본 이름 `IX_<n>` — 모델 전체 인덱스 이름 중 미사용 최소 n; unique false; columns []) 후 아무 것도 선택 안 함.
- 각 인덱스(`IndexRow`):
  - 이름 입력(blur-commit → `updateIndex(name)`).
  - 유니크 체크박스(`updateIndex(unique)`; `e.target.checked` 즉시 캡처).
  - 구성 컬럼 목록(순서대로): 각 항목 = 컬럼 물리명 + 방향 토글(asc⇄desc) + 위/아래 이동 + 제거. 이 조작들은 **다음 columns 배열**을 만들어 `updateIndex(columns)`로 커밋.
  - "컬럼 추가" select: 이 테이블의 컬럼 중 아직 인덱스에 없는 것 → 선택 시 `{ columnId, direction:'asc' }`를 append한 next 배열로 `updateIndex(columns)`(값 즉시 캡처).
  - 인덱스 삭제 버튼 → `removeIndex`.
- edit-panel.tsx: 컬럼 `<ul>` 아래에 `<IndexSection projectId={projectId} tableId={tid} />` 삽입.
- 헬퍼: `moveInArray(arr, index, dir)`(순수), 방향 토글은 map으로 해당 항목만 교체.

### Steps

- [ ] **Step 1: index-section.tsx 구현**

```tsx
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { createIndex, updateIndex, removeIndex, type IndexDef } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type IndexColumns = IndexDef['columns']

function nextIndexName(usedNames: Set<string>): string {
  let n = 1
  while (usedNames.has(`IX_${n}`)) n++
  return `IX_${n}`
}

export function IndexSection({ projectId, tableId }: { projectId: string; tableId: string }) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const indexes = Object.values(model.indexes).filter((ix) => ix.tableId === tableId)
  const tableColumns = Object.values(model.columns)
    .filter((c) => c.tableId === tableId).sort((a, b) => a.order - b.order)

  const onAdd = () => {
    const id = newId()
    const used = new Set(Object.values(model.indexes).map((ix) => ix.name))
    void mutate((m) => createIndex(m, { id, tableId, name: nextIndexName(used) }), { summary: '인덱스 추가' })
  }

  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold">인덱스</h3>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus /> 인덱스 추가</Button>
      </div>
      <ul className="mt-2 grid gap-3">
        {indexes.map((ix) => (
          <IndexRow
            key={ix.id} index={ix}
            columnName={(id) => model.columns[id]?.physicalName ?? '?'}
            availableColumns={tableColumns.filter((c) => !ix.columns.some((ic) => ic.columnId === c.id))}
            onPatch={(patch) => void mutate((m) => updateIndex(m, ix.id, patch), { summary: '인덱스 수정' })}
            onRemove={() => void mutate((m) => removeIndex(m, ix.id), { summary: '인덱스 삭제' })}
          />
        ))}
        {indexes.length === 0 && <li className="text-xs text-muted-foreground">인덱스가 없습니다.</li>}
      </ul>
    </>
  )
}

function IndexRow(props: {
  index: IndexDef
  columnName: (columnId: string) => string
  availableColumns: { id: string; physicalName: string }[]
  onPatch: (patch: Partial<Pick<IndexDef, 'name' | 'unique' | 'columns'>>) => void
  onRemove: () => void
}) {
  const { index: ix } = props
  const cols = ix.columns

  const setColumns = (next: IndexColumns) => props.onPatch({ columns: next })
  const toggleDir = (i: number) =>
    setColumns(cols.map((c, j) => (j === i ? { ...c, direction: c.direction === 'asc' ? 'desc' : 'asc' } : c)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= cols.length) return
    const next = [...cols]; [next[i], next[j]] = [next[j]!, next[i]!]; setColumns(next)
  }
  const removeCol = (i: number) => setColumns(cols.filter((_, j) => j !== i))
  const addCol = (columnId: string) => setColumns([...cols, { columnId, direction: 'asc' }])

  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <Input aria-label="인덱스명" defaultValue={ix.name} key={ix.name} className="h-8 font-mono"
          onBlur={(e) => { const v = e.target.value; if (v !== ix.name && v.trim() !== '') props.onPatch({ name: v }) }} />
        <Button size="icon" variant="ghost" className="size-7 shrink-0 text-destructive"
          aria-label="인덱스 삭제" onClick={props.onRemove}><Trash2 className="size-3" /></Button>
      </div>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={ix.unique}
          onChange={(e) => { const unique = e.target.checked; props.onPatch({ unique }) }} /> UNIQUE
      </label>
      <ul className="grid gap-1">
        {cols.map((c, i) => (
          <li key={c.columnId} className="flex items-center gap-1 text-xs">
            <span className="flex-1 truncate font-mono">{props.columnName(c.columnId)}</span>
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]"
              onClick={() => toggleDir(i)}>{c.direction.toUpperCase()}</Button>
            <Button size="icon" variant="ghost" className="size-6" disabled={i === 0}
              aria-label="위로" onClick={() => move(i, -1)}><ChevronUp className="size-3" /></Button>
            <Button size="icon" variant="ghost" className="size-6" disabled={i === cols.length - 1}
              aria-label="아래로" onClick={() => move(i, 1)}><ChevronDown className="size-3" /></Button>
            <Button size="icon" variant="ghost" className="size-6 text-destructive"
              aria-label="인덱스 컬럼 제거" onClick={() => removeCol(i)}><Trash2 className="size-3" /></Button>
          </li>
        ))}
        {cols.length === 0 && <li className="text-[11px] text-muted-foreground">구성 컬럼 없음</li>}
      </ul>
      {props.availableColumns.length > 0 && (
        <select aria-label="인덱스 컬럼 추가" className="h-8 rounded border bg-background px-1 text-xs" value=""
          onChange={(e) => { const columnId = e.target.value; if (columnId) addCol(columnId) }}>
          <option value="">컬럼 추가…</option>
          {props.availableColumns.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
        </select>
      )}
    </li>
  )
}
```

- [ ] **Step 2: edit-panel.tsx에 삽입** — 컬럼 `<ul>` 뒤(닫는 `</aside>` 앞)에 추가

```tsx
import { IndexSection } from './index-section.js'
// 컬럼 ul 다음:
<IndexSection projectId={projectId} tableId={tid} />
```

- [ ] **Step 3: index-section.test.tsx** — edit-panel.test.tsx의 tRPC 목·provider 패턴 재사용. 최소 2개:
  (a) 인덱스가 있는 테이블에서 인덱스명·UNIQUE·구성 컬럼이 렌더된다(store에 인덱스 1건 세팅).
  (b) "인덱스 추가" 클릭 시 해당 테이블에 인덱스가 생겨 스토어에 반영된다(성공 목).

- [ ] **Step 4: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS(기존 87 + 신규).

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/index-section.tsx apps/web/src/editor/index-section.test.tsx apps/web/src/editor/edit-panel.tsx
git commit -m "feat(web): 편집 패널 인덱스 섹션 — 생성·이름·유니크·구성 컬럼·방향·순서"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- 테이블 선택 시 편집 패널 컬럼 아래 "인덱스" 섹션이 보인다.
- "인덱스 추가"로 인덱스가 생기고(기본명 IX_n·미충돌), 이름·UNIQUE를 편집한다.
- 구성 컬럼을 추가(테이블 컬럼 중 미포함분)·제거·순서 변경·방향(ASC/DESC) 토글할 수 있고, 순서가 유지된다.
- 인덱스를 삭제할 수 있다.
- 만든 인덱스가 DDL 내보내기에 `CREATE [UNIQUE ]INDEX ...`로 반영된다(M6 연계).
- 컬럼 삭제 시 그 컬럼이 인덱스에서 제거되고, 빈 인덱스는 사라진다(기존 캐스케이드 — 회귀 없음 확인).
- 새로고침 후 인덱스가 복원된다.
- 전체 테스트·타입체크 통과.

## 이월(후속)

인덱스 자동 제안, 인덱스 유형, 함수형/부분 인덱스, 중복 인덱스 경고 배지.
