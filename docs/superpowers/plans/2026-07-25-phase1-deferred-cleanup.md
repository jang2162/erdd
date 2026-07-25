# Phase 1 이월 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 이월 5항목(식별자 인용, 0컬럼 DDL, 자동 정렬, 그룹 라벨 가림, 중복 제거)을 정리한다.

**Architecture:** 기존 producer+diff 뮤테이션 패턴과 `packages/core` IO/의존성-free 원칙을 유지한다. 자동 정렬 레이아웃 계산만 `apps/web`에 `@dagrejs/dagre`로 추가한다.

**Tech Stack:** TypeScript, React 19, @xyflow/react, @dagrejs/dagre, vitest.

## Global Constraints

- `packages/core`에는 어떤 런타임 의존성도 추가 금지. dagre는 `apps/web` dependencies에만.
- 신규 의존성은 `@dagrejs/dagre` 1개만 허용. 그 외 금지.
- 모델 변경은 `useModelMutation`의 producer로 단일 뮤테이션(되돌리기 가능).
- `generateDdl(model, dialect, scope): string` 시그니처 불변. 경고는 별도 `ddlWarnings`로.
- 커밋은 명시 파일만 스테이징(`git add <files>`), `git add .`/`-A` 금지. `.idea/*`·`.env` 커밋 금지.
- UI 카피는 한국어.
- 테스트: 특정 파일은 `pnpm --filter @erdd/core exec vitest run <path>` / `pnpm --filter @erdd/web exec vitest run <path>`. 전체 타입체크 `pnpm -r typecheck`.

---

## Task 1: DDL 식별자 조건부 인용

**Files:**
- Create: `packages/core/src/identifier.ts`
- Create: `packages/core/src/identifier.test.ts`
- Modify: `packages/core/src/ddl.ts`
- Modify: `packages/core/src/index.ts` (export `quoteIdentifier`)
- Modify: `packages/core/src/ddl.test.ts` (인용 케이스 추가)

**Interfaces:**
- Consumes: `Dialect` from `./dialect.js`.
- Produces: `quoteIdentifier(name: string, dialect: Dialect): string` — 예약어이거나 안전패턴(`^[A-Za-z_]\w*$`) 위반 시에만 방언 규칙으로 인용.

- [ ] **Step 1: Write the failing test** — `packages/core/src/identifier.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { quoteIdentifier } from './identifier.js'

describe('quoteIdentifier', () => {
  it('안전한 이름은 인용하지 않는다', () => {
    expect(quoteIdentifier('MBR_TBL', 'postgresql')).toBe('MBR_TBL')
    expect(quoteIdentifier('order_no', 'mysql')).toBe('order_no')
  })
  it('예약어는 방언별로 인용한다', () => {
    expect(quoteIdentifier('ORDER', 'postgresql')).toBe('"ORDER"')
    expect(quoteIdentifier('ORDER', 'oracle')).toBe('"ORDER"')
    expect(quoteIdentifier('ORDER', 'mysql')).toBe('`ORDER`')
    expect(quoteIdentifier('ORDER', 'mssql')).toBe('[ORDER]')
  })
  it('예약어 판별은 대소문자를 무시한다', () => {
    expect(quoteIdentifier('user', 'postgresql')).toBe('"user"')
  })
  it('안전패턴 위반(특수문자/공백/숫자시작)은 인용한다', () => {
    expect(quoteIdentifier('USER-LOG', 'postgresql')).toBe('"USER-LOG"')
    expect(quoteIdentifier('1TBL', 'mysql')).toBe('`1TBL`')
  })
  it('내부 인용부호는 이스케이프한다', () => {
    expect(quoteIdentifier('a"b', 'postgresql')).toBe('"a""b"')
    expect(quoteIdentifier('a`b', 'mysql')).toBe('`a``b`')
    expect(quoteIdentifier('a]b', 'mssql')).toBe('[a]]b]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @erdd/core exec vitest run src/identifier.test.ts`
Expected: FAIL ("Cannot find module './identifier.js'").

- [ ] **Step 3: Implement `packages/core/src/identifier.ts`**

```ts
import type { Dialect } from './dialect.js'

// 흔히 물리명과 충돌하는 예약어(큐레이션, 확장 가능). 소문자로 저장하고 비교는 대소문자 무시.
const BASE = ['order','user','group','table','select','from','where','index','key','primary',
  'foreign','constraint','check','default','desc','asc','date','time','timestamp','level','type',
  'comment','column','value','values','case','when','then','end','null','into','set','join']
const EXTRA: Record<Dialect, string[]> = {
  postgresql: ['limit','offset','analyse','analyze'],
  mysql: ['rank','lead','lag','read','write','status'],
  oracle: ['number','rowid','session','access','audit'],
  mssql: ['identity','rowcount','proc','current'],
}
const RESERVED: Record<Dialect, Set<string>> = {
  postgresql: new Set([...BASE, ...EXTRA.postgresql]),
  mysql: new Set([...BASE, ...EXTRA.mysql]),
  oracle: new Set([...BASE, ...EXTRA.oracle]),
  mssql: new Set([...BASE, ...EXTRA.mssql]),
}

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 예약어이거나 안전패턴 위반 시에만 방언 규칙으로 인용한다. */
export function quoteIdentifier(name: string, dialect: Dialect): string {
  const needs = !SAFE.test(name) || RESERVED[dialect].has(name.toLowerCase())
  if (!needs) return name
  switch (dialect) {
    case 'postgresql':
    case 'oracle':
      return `"${name.replace(/"/g, '""')}"`
    case 'mysql':
      return '`' + name.replace(/`/g, '``') + '`'
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @erdd/core exec vitest run src/identifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply quoting in `packages/core/src/ddl.ts`**

Add import at top:
```ts
import { quoteIdentifier } from './identifier.js'
```

Replace `columnLine` first line:
```ts
function columnLine(col: Column, dialect: Dialect): string {
  const parts = [quoteIdentifier(col.physicalName, dialect), resolveColumnType(col.type, dialect).sql]
```

Replace `createTableBlock` PK line and CREATE line:
```ts
  if (pks.length > 0) lines.push(`  PRIMARY KEY (${pks.map((c) => quoteIdentifier(c.physicalName, dialect)).join(', ')})`)
  let block = `CREATE TABLE ${quoteIdentifier(table.physicalName, dialect)} (\n${lines.join(',\n')}\n)`
```
(그 아래 MySQL COMMENT '...' 는 문자열 리터럴이므로 `esc()` 유지 — 변경 없음.)

주의: `fkStatements`/`indexStatements`는 현재 `dialect`를 인자로 받지 않는다. 인용을 위해 `dialect`를 넘기도록 시그니처를 확장한다(호출부는 Step 5 끝에서 함께 수정). 각 함수의 최종 형태:

`fkStatements`를 아래로 교체:
```ts
function fkStatements(model: ProjectModel, selectedIds: Set<string>, dialect: Dialect): string[] {
  const rels = selectedRelationships(model, selectedIds)
  const statements: string[] = []
  const used = new Set<string>() // 원문 기준 유일성 추적, 출력 시 인용
  const q = (s: string) => quoteIdentifier(s, dialect)
  for (const rel of rels) {
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    if (!parent || !child) continue
    const childCols = rel.columnMappings.map((m) => q(model.columns[m.childColumnId]?.physicalName ?? ''))
    const parentCols = rel.columnMappings.map((m) => q(model.columns[m.parentColumnId]?.physicalName ?? ''))
    const rawChildCols = rel.columnMappings.map((m) => model.columns[m.childColumnId]?.physicalName ?? '')
    const name = uniqueConstraintName(fkBaseName(rel, child.physicalName, parent.physicalName), used)
    statements.push(
      `ALTER TABLE ${q(child.physicalName)} ADD CONSTRAINT ${q(name)} FOREIGN KEY (${childCols.join(', ')}) REFERENCES ${q(parent.physicalName)} (${parentCols.join(', ')});`,
    )
    if (rel.cardinality === '1:1') {
      const uqName = uniqueConstraintName(`UQ_${child.physicalName}_${rawChildCols.join('_')}`, used)
      statements.push(`ALTER TABLE ${q(child.physicalName)} ADD CONSTRAINT ${q(uqName)} UNIQUE (${childCols.join(', ')});`)
    }
  }
  return statements
}
```

`indexStatements`를 아래로 교체:
```ts
function indexStatements(model: ProjectModel, selectedIds: Set<string>, dialect: Dialect): string[] {
  const indexes = Object.values(model.indexes).filter((ix) => selectedIds.has(ix.tableId))
  const q = (s: string) => quoteIdentifier(s, dialect)
  return indexes.map((ix) => {
    const table = model.tables[ix.tableId]
    const tableName = table ? table.physicalName : ix.tableId
    const cols = ix.columns
      .map((c) => {
        const col = model.columns[c.columnId]
        const colName = col ? col.physicalName : c.columnId
        return `${q(colName)} ${c.direction.toUpperCase()}`
      })
      .join(', ')
    const uniqueToken = ix.unique ? 'UNIQUE ' : ''
    return `CREATE ${uniqueToken}INDEX ${q(ix.name)} ON ${q(tableName)} (${cols});`
  })
}
```

`tableCommentStatement`/`columnCommentStatement`의 PG/Oracle 분기만 인용(MSSQL은 이름이 `N'...'` 리터럴이므로 그대로):
```ts
function tableCommentStatement(dialect: Dialect, tableName: string, text: string): string {
  switch (dialect) {
    case 'postgresql':
    case 'oracle':
      return `COMMENT ON TABLE ${quoteIdentifier(tableName, dialect)} IS '${esc(text)}';`
    case 'mssql':
      return `EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'${esc(text)}', @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'${tableName}';`
    case 'mysql':
      throw new Error('MySQL uses inline comments')
  }
}

function columnCommentStatement(dialect: Dialect, tableName: string, columnName: string, text: string): string {
  switch (dialect) {
    case 'postgresql':
    case 'oracle':
      return `COMMENT ON COLUMN ${quoteIdentifier(tableName, dialect)}.${quoteIdentifier(columnName, dialect)} IS '${esc(text)}';`
    case 'mssql':
      return `EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'${esc(text)}', @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'${tableName}', @level2type=N'COLUMN', @level2name=N'${columnName}';`
    case 'mysql':
      throw new Error('MySQL uses inline comments')
  }
}
```

`generateDdl`에서 호출부에 `dialect` 전달:
```ts
  const fk = fkStatements(model, selectedIds, dialect).join('\n')
  const index = indexStatements(model, selectedIds, dialect).join('\n')
```

- [ ] **Step 6: Add ddl.ts quoting tests** — `packages/core/src/ddl.test.ts`에 추가

기존 픽스처/헬퍼 스타일을 따라 예약어 물리명 테이블을 만들어 다음을 검증:
```ts
it('예약어 물리명을 방언별로 인용한다', () => {
  // ORDER 라는 물리명 테이블 + USER 컬럼을 가진 모델 구성(기존 테스트의 모델 빌더 방식 재사용)
  // PostgreSQL
  const pg = generateDdl(m, 'postgresql')
  expect(pg).toContain('CREATE TABLE "ORDER"')
  expect(pg).toContain('"USER"')
  // MySQL
  expect(generateDdl(m, 'mysql')).toContain('CREATE TABLE `ORDER`')
  // MSSQL 코멘트문의 이름은 리터럴이라 대괄호 인용이 아님
  const ms = generateDdl(m, 'mssql')
  expect(ms).toContain('CREATE TABLE [ORDER]')
  expect(ms).not.toContain("@level1name=N'[ORDER]'")
})
```
(모델 구성은 `ddl.test.ts`의 기존 헬퍼를 그대로 사용해 물리명만 `ORDER`/`USER`로 지정한다. 없으면 기존 테스트가 만드는 최소 모델을 복제해 물리명을 바꾼다.)

- [ ] **Step 7: Export from `packages/core/src/index.ts`**

`quoteIdentifier`를 export에 추가(기존 export 스타일 준수):
```ts
export { quoteIdentifier } from './identifier.js'
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @erdd/core exec vitest run src/identifier.test.ts src/ddl.test.ts`
Run: `pnpm --filter @erdd/core typecheck`
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/identifier.ts packages/core/src/identifier.test.ts packages/core/src/ddl.ts packages/core/src/ddl.test.ts packages/core/src/index.ts
git commit -m "feat: DDL 식별자 조건부 인용(예약어·특수문자 방언별 인용)"
```

---

## Task 2: 0컬럼 DDL 제외 + 경고 통합

**Files:**
- Modify: `packages/core/src/ddl.ts` (0컬럼 제외 + `ddlWarnings` 추가)
- Modify: `packages/core/src/index.ts` (export `ddlWarnings`)
- Modify: `packages/core/src/ddl.test.ts` (0컬럼 케이스)
- Modify: `apps/web/src/editor/export-dialog.tsx` (`typeWarnings` → `ddlWarnings`)

**Interfaces:**
- Consumes: `selectTables`, `tableColumns`, `resolveColumnType`, `DdlScope`, `Dialect`, `ProjectModel`.
- Produces: `ddlWarnings(model: ProjectModel, dialect: Dialect, scope?: DdlScope): string[]`.

- [ ] **Step 1: Write the failing test** — `packages/core/src/ddl.test.ts`에 추가

```ts
import { ddlWarnings } from './ddl.js' // 상단 import에 병합
// ...
it('컬럼이 없는 테이블은 CREATE 하지 않고 경고로 알린다', () => {
  // 기존 헬퍼로 컬럼 0개 테이블(physicalName: 'EMPTY_TBL') 포함 모델 m 구성
  const sql = generateDdl(m, 'postgresql')
  expect(sql).not.toContain('CREATE TABLE EMPTY_TBL')
  expect(sql).not.toContain('(\n\n)')
  expect(ddlWarnings(m, 'postgresql')).toEqual(
    expect.arrayContaining([expect.stringContaining('EMPTY_TBL')]),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @erdd/core exec vitest run src/ddl.test.ts`
Expected: FAIL (`ddlWarnings` 미존재 또는 CREATE EMPTY_TBL 존재).

- [ ] **Step 3: Implement in `packages/core/src/ddl.ts`**

`generateDdl` 첫 두 줄 교체(0컬럼 제외):
```ts
export function generateDdl(model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' }): string {
  const tables = selectTables(model, scope).filter((t) => tableColumns(model, t.id).length > 0)
  const selectedIds = new Set(tables.map((t) => t.id))
```

파일 하단(export `generateDdl` 뒤)에 추가:
```ts
/** DDL 생성 시 사용자가 알아야 할 경고 목록(0컬럼 제외, 타입 변환 등). scope를 반영한다. */
export function ddlWarnings(model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' }): string[] {
  const inScope = selectTables(model, scope)
  const out: string[] = []
  for (const t of inScope) {
    if (tableColumns(model, t.id).length === 0) out.push(`${t.physicalName}: 컬럼이 없어 DDL에서 제외됨`)
  }
  for (const t of inScope) {
    for (const c of tableColumns(model, t.id)) {
      const { warning } = resolveColumnType(c.type, dialect)
      if (warning) out.push(`${t.physicalName}.${c.physicalName}: ${warning}`)
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @erdd/core exec vitest run src/ddl.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

```ts
export { generateDdl, ddlWarnings, type DdlScope } from './ddl.js'
```
(기존 `generateDdl`/`DdlScope` export 라인을 이 형태로 병합. 중복 export 주의.)

- [ ] **Step 6: Wire `export-dialog.tsx`**

Import 변경: `resolveColumnType` 제거, `ddlWarnings` 추가:
```ts
import { DIALECTS, generateDdl, ddlWarnings, type Dialect, type DdlScope } from '@erdd/core'
```

`typeWarnings` useMemo 블록 전체를 아래로 교체:
```ts
  const warnings = useMemo(() => ddlWarnings(model, dialect, scope), [model, dialect, scope])
```

렌더의 경고 목록 교체:
```tsx
{warnings.length > 0 && (
  <ul aria-label="DDL 경고" className="grid gap-0.5 text-xs text-key">
    {warnings.map((w, i) => (
      <li key={i}>⚠ {w}</li>
    ))}
  </ul>
)}
```

- [ ] **Step 7: Run web tests + typecheck**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/export-dialog.test.tsx`
Run: `pnpm --filter @erdd/web typecheck` 및 `pnpm --filter @erdd/core typecheck`
Expected: PASS / clean. (export-dialog 테스트가 `⚠` 텍스트에 의존한다면 새 형식에 맞게 최소 수정.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts packages/core/src/index.ts apps/web/src/editor/export-dialog.tsx
git commit -m "feat: 0컬럼 테이블 DDL 제외·경고 통합(ddlWarnings, scope 반영)"
```

---

## Task 3: 자동 정렬 (dagre)

**Files:**
- Modify: `apps/web/package.json` (add `@dagrejs/dagre`)
- Create: `apps/web/src/editor/auto-layout.ts`
- Create: `apps/web/src/editor/auto-layout.test.ts`
- Modify: `apps/web/src/editor/toolbar.tsx`

**Interfaces:**
- Consumes: `moveTable`, `moveTableGroupPosition` (`./model-edits.js`), `useReactFlow().getNode(id).measured`, `useModelMutation`.
- Produces: `computeAutoLayout(nodes, edges, opts?): Map<string, {x:number;y:number}>`.

- [ ] **Step 1: Install dagre**

```bash
pnpm --filter @erdd/web add @dagrejs/dagre
```
Run: `pnpm --filter @erdd/web typecheck`
Expected: 타입 에러 없음. 만약 `Cannot find ... '@dagrejs/dagre'` 타입 에러가 나면 `apps/web/src/dagre-shim.d.ts` 생성:
```ts
declare module '@dagrejs/dagre' {
  export namespace graphlib { class Graph {
    setGraph(o: Record<string, unknown>): void
    setDefaultEdgeLabel(f: () => Record<string, unknown>): void
    setNode(id: string, o: { width: number; height: number }): void
    setEdge(a: string, b: string): void
    node(id: string): { x: number; y: number; width: number; height: number }
  } }
  export function layout(g: graphlib.Graph): void
  const _default: { graphlib: typeof graphlib; layout: typeof layout }
  export default _default
}
```

- [ ] **Step 2: Write the failing test** — `apps/web/src/editor/auto-layout.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { computeAutoLayout, type LayoutNode, type LayoutEdge } from './auto-layout.js'

const N = (id: string): LayoutNode => ({ id, width: 200, height: 100 })
function overlaps(a: {x:number;y:number}, b: {x:number;y:number}, w=200, h=100): boolean {
  return Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h
}

describe('computeAutoLayout', () => {
  it('부모→자식은 자식이 아래 레이어에 배치된다(TB)', () => {
    const pos = computeAutoLayout([N('p'), N('c')], [{ source: 'p', target: 'c' }])
    expect(pos.get('c')!.y).toBeGreaterThan(pos.get('p')!.y)
  })
  it('노드들이 서로 겹치지 않는다', () => {
    const nodes = ['a','b','c','d'].map(N)
    const edges: LayoutEdge[] = [{source:'a',target:'b'},{source:'a',target:'c'},{source:'b',target:'d'}]
    const pos = computeAutoLayout(nodes, edges)
    const ids = nodes.map(n => n.id)
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++)
      expect(overlaps(pos.get(ids[i]!)!, pos.get(ids[j]!)!)).toBe(false)
  })
  it('순환 그래프도 모든 노드 좌표를 반환한다(무한루프 없음)', () => {
    const pos = computeAutoLayout([N('a'),N('b')], [{source:'a',target:'b'},{source:'b',target:'a'}])
    expect(pos.has('a')).toBe(true)
    expect(pos.has('b')).toBe(true)
  })
  it('자기 참조 엣지를 무시하고 처리한다', () => {
    const pos = computeAutoLayout([N('a')], [{source:'a',target:'a'}])
    expect(pos.get('a')).toBeDefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/auto-layout.test.ts`
Expected: FAIL (module 없음).

- [ ] **Step 4: Implement `apps/web/src/editor/auto-layout.ts`**

```ts
import dagre from '@dagrejs/dagre'

export type LayoutNode = { id: string; width: number; height: number }
export type LayoutEdge = { source: string; target: string } // parent -> child (FK 참조 방향)

/** dagre 계층 배치. 반환 좌표는 React Flow 기준(노드 좌상단). */
export function computeAutoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { rankdir?: 'TB' | 'LR'; ranksep?: number; nodesep?: number } = {},
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: opts.rankdir ?? 'TB', ranksep: opts.ranksep ?? 80, nodesep: opts.nodesep ?? 60 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  for (const e of edges) if (e.source !== e.target) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const dn = g.node(n.id) // dagre는 중심 좌표 → 좌상단으로 변환
    out.set(n.id, { x: dn.x - n.width / 2, y: dn.y - n.height / 2 })
  }
  return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/auto-layout.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire toolbar** — `apps/web/src/editor/toolbar.tsx`

Import 추가:
```ts
import { LayoutGrid } from 'lucide-react' // 기존 lucide import에 병합
import { computeAutoLayout } from './auto-layout.js'
import { moveTable, moveTableGroupPosition } from './model-edits.js' // addTable/removeTable import에 병합
```

컴포넌트 본문에 핸들러 추가(기존 `model` 접근이 없으면 `const model = useEditorStore((s) => s.model)` 추가):
```ts
  const model = useEditorStore((s) => s.model)
  const visibleTables = Object.values(model.tables).filter((t) => (activeGroupView ? t.groupId === activeGroupView : true))
  const onAutoLayout = () => {
    const agv = activeGroupView
    if (visibleTables.length < 2) return
    const ids = new Set(visibleTables.map((t) => t.id))
    const nodes = visibleTables.map((t) => {
      const n = rf.getNode(t.id)
      return { id: t.id, width: n?.measured?.width ?? 260, height: n?.measured?.height ?? 120 }
    })
    const edges = Object.values(model.relationships)
      .filter((r) => ids.has(r.parentTableId) && ids.has(r.childTableId))
      .map((r) => ({ source: r.parentTableId, target: r.childTableId }))
    const pos = computeAutoLayout(nodes, edges)
    void mutate((m) => {
      let n = m
      for (const [id, p] of pos) n = agv ? moveTableGroupPosition(n, id, p) : moveTable(n, id, p)
      return n
    }, { summary: '자동 정렬' })
  }
```

버튼 추가(툴바 JSX, "메모"/구분선 근처):
```tsx
<Button size="sm" variant="outline" disabled={visibleTables.length < 2} onClick={onAutoLayout}>
  <LayoutGrid /> 자동 정렬
</Button>
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/auto-layout.test.ts src/editor/toolbar.test.tsx`
Run: `pnpm --filter @erdd/web typecheck`
Expected: PASS / clean. (toolbar 핸들러 자체 동작은 최종 컨트롤러 브라우저 스모크로 확인 — M5b/M10 드래그와 동일 정책.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/editor/auto-layout.ts apps/web/src/editor/auto-layout.test.ts apps/web/src/editor/toolbar.tsx
# 타입 shim을 생성했다면 함께: git add apps/web/src/dagre-shim.d.ts
git commit -m "feat: 관계 기반 자동 정렬(dagre) 툴바 추가"
```

---

## Task 4: 그룹 라벨 가림 해소

**Files:**
- Modify: `apps/web/src/editor/group-node.tsx`

**Interfaces:** 없음(기존 `GroupNodeData`, `selectGroup` 사용).

- [ ] **Step 1: 라벨을 영역 상단 밖으로 이동**

`group-node.tsx`의 컨테이너 div에 `relative` 추가하고 라벨을 절대 위치로 상단 밖에 배치. 잉여 `pointerEvents:'auto'` 제거:
```tsx
export function GroupNode({ data }: NodeProps) {
  const { group, selected } = data as unknown as GroupNodeData
  const selectGroup = useEditorStore((s) => s.selectGroup)
  return (
    <div
      className="relative size-full rounded-xl border-2"
      style={{
        borderColor: group.color,
        background: `${group.color}14`,
        borderStyle: selected ? 'solid' : 'dashed',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          selectGroup(group.id)
        }}
        className="absolute left-0 -top-6 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
        style={{ background: group.color }}
      >
        {group.name}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: 기존 그룹 관련 테스트 그린 확인**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/group-view.test.tsx src/editor/group-nodes.test.ts`
Run: `pnpm --filter @erdd/web typecheck`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/editor/group-node.tsx
git commit -m "fix: 그룹 라벨을 영역 상단 밖으로 이동해 멤버 테이블 가림 해소"
```

---

## Task 5: 중복 헬퍼 제거 (C급 코스메틱)

**Files:**
- Create: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/lib/labels.ts`
- Modify: `apps/web/src/editor/version-dialog.tsx`
- Modify: `apps/web/src/editor/history-view.tsx`
- Modify: `apps/web/src/editor/export-dialog.tsx`
- Modify: `apps/web/src/pages/org-detail.tsx`

**Interfaces:**
- Produces: `formatCreatedAt(value: string | Date): string`, `DIALECT_LABEL: Record<Dialect, string>`.

- [ ] **Step 1: Create `apps/web/src/lib/format.ts`**

```ts
export function formatCreatedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}
```

- [ ] **Step 2: Create `apps/web/src/lib/labels.ts`**

```ts
import type { Dialect } from '@erdd/core'

export const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL·MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}
```

- [ ] **Step 3: Replace local definitions with imports**

- `version-dialog.tsx`: 로컬 `formatCreatedAt` 함수 삭제, 상단에 `import { formatCreatedAt } from '@/lib/format'` 추가.
- `history-view.tsx`: 동일하게 로컬 삭제 + import.
- `export-dialog.tsx`: 로컬 `DIALECT_LABEL` 삭제, `import { DIALECT_LABEL } from '@/lib/labels'` 추가.
- `pages/org-detail.tsx`: 로컬 `DIALECT_LABEL` 삭제, 동일 import 추가.

(경로 별칭 `@/`는 기존 코드에서 사용 중 — `@/components/ui/button` 등. 동일 별칭 사용.)

- [ ] **Step 4: Run web tests + typecheck (동작 불변 확인)**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/version-dialog.test.tsx src/editor/history-view.test.tsx src/editor/export-dialog.test.tsx`
Run: `pnpm --filter @erdd/web typecheck`
Expected: PASS / clean. (해당 테스트 파일이 없으면 전체 `pnpm --filter @erdd/web test`로 회귀 없음 확인.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/labels.ts apps/web/src/editor/version-dialog.tsx apps/web/src/editor/history-view.tsx apps/web/src/editor/export-dialog.tsx apps/web/src/pages/org-detail.tsx
git commit -m "refactor: 중복 헬퍼 통합(formatCreatedAt, DIALECT_LABEL)"
```

---

## 완료 후

- 전체 스위트 그린 확인: `pnpm -r test`(서버는 DB-gated, 이 배치는 서버 미변경) 및 `pnpm -r typecheck`.
- 컨트롤러 브라우저 스모크: 자동 정렬 버튼 클릭 → 테이블 재배치, 그룹 라벨 비가림, DDL 예약어 인용/0컬럼 경고 표면 확인.
- fable 전체 브랜치 리뷰(merge-base..HEAD) → main 머지.

## Self-Review 메모

- 타입 일관성: `quoteIdentifier(name, dialect)`, `ddlWarnings(model, dialect, scope)`, `computeAutoLayout(nodes, edges, opts?)`, `formatCreatedAt`, `DIALECT_LABEL` — 계획 전반 동일 시그니처.
- `fkStatements`/`indexStatements`는 `dialect` 인자를 추가하므로 `generateDdl` 호출부도 함께 수정(Task 1 Step 5).
- MSSQL 코멘트문 이름은 리터럴 → 인용 금지(Task 1에서 명시, 테스트로 고정).
- 0컬럼 제외는 `generateDdl`과 `ddlWarnings` 양쪽 `selectTables` 기준 일치.
