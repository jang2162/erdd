# Phase 1 이월 정리 설계 (Deferred Cleanup)

**작성일:** 2026-07-25
**상태:** 승인됨 (사용자 "이대로 진행해줘")

## 목표

Phase 1(M0~M10) 완료 후 남은 이월 항목 5건을 정리한다. 사용자 체감이 큰 **관계 기반 자동 정렬**을 헤드라인으로, DDL 정확성(식별자 인용·0컬럼)과 코드 정합(그룹 라벨·중복 제거)을 함께 마무리한다.

## 아키텍처 / 방침

- 기존 패턴 준수: 에디터 변경은 **producer + diff**(`mutate((m) => nextModel)`)로 단일 뮤테이션·되돌리기 가능. `packages/core`는 **IO·의존성 free** 유지.
- 새 의존성은 **`@dagrejs/dagre` 1개만**, `apps/web`에만 추가(자동 정렬 레이아웃 계산용). core에는 절대 추가하지 않는다.
- UI 카피는 한국어.

## 전역 제약 (Global Constraints)

- `packages/core`는 의존성 free — dagre 등 어떤 런타임 의존성도 추가 금지. 레이아웃 계산은 `apps/web`에 둔다.
- 새 의존성: `@dagrejs/dagre`(apps/web devDependencies 아님, dependencies). 그 외 신규 의존성 금지.
- 모든 모델 변경은 `useModelMutation`의 producer로 수행하고 단일 뮤테이션으로 커밋(되돌리기 가능).
- 이벤트 값은 producer 진입 전 즉시 캡처(`serializeMutation` 마이크로태스크 지연으로 인한 stale read 방지) — 이번 배치의 자동 정렬 버튼은 입력 읽기가 없지만 원칙 유지.
- DDL은 문자열만 반환하는 `generateDdl` 시그니처 유지. 경고는 별도 `ddlWarnings`로 채널 분리.
- 커밋 시 `git add .`/`-A` 금지 — 명시 파일만 스테이징. `.idea/*`·`.env` 커밋 금지.

## 파일 구조

**생성**
- `apps/web/src/editor/auto-layout.ts` — dagre 기반 순수 레이아웃 함수
- `apps/web/src/editor/auto-layout.test.ts`
- `packages/core/src/identifier.ts` — 방언별 예약어 + `quoteIdentifier`
- `packages/core/src/identifier.test.ts`
- `apps/web/src/lib/format.ts` — 공용 `formatCreatedAt`
- `apps/web/src/lib/labels.ts` — 공용 `DIALECT_LABEL`

**수정**
- `packages/core/src/ddl.ts` — 식별자 인용 적용 + 0컬럼 테이블 제외
- `packages/core/src/index.ts` — `quoteIdentifier`, `ddlWarnings` 등 export
- `apps/web/src/editor/toolbar.tsx` — "자동 정렬" 버튼
- `apps/web/src/editor/export-dialog.tsx` — `typeWarnings` → `ddlWarnings`로 교체, `DIALECT_LABEL` import
- `apps/web/src/pages/org-detail.tsx` — 로컬 `DIALECT_LABEL` 제거, import
- `apps/web/src/editor/group-node.tsx` — 라벨 위치 상향(가림 해소)
- `apps/web/src/editor/version-dialog.tsx` / `history-view.tsx` — 로컬 `formatCreatedAt` 제거, import
- `packages/core/src/ddl.test.ts` — 인용·0컬럼 케이스 추가

---

## 확인된 기존 인터페이스

- `moveTable(model, id, position): ProjectModel` / `moveTableGroupPosition(model, id, position): ProjectModel` — `apps/web/src/editor/model-edits.ts`
- 그룹 뷰 노드 위치: `table.groupPosition ?? table.position` (`apps/web/src/editor/nodes.ts:28`)
- `resolveColumnType(rawType, dialect): { sql; warning? }` — `packages/core/src/dialect.ts`
- `generateDdl(model, dialect, scope): string`, `DdlScope = {kind:'all'} | {kind:'group';groupId} | {kind:'tables';tableIds}` — `packages/core/src/ddl.ts`
- `useModelMutation(projectId)` → `mutate(producer, { summary })`
- React Flow: `rf.getNode(id)?.measured?.{width,height}` 측정값 제공

---

## 항목 1: 자동 정렬 (dagre)

### 레이아웃 함수 (순수)

`apps/web/src/editor/auto-layout.ts`

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

- 자기 참조 엣지(`source===target`)는 제외(dagre 무한 처리 방지).
- dagre는 순환·고립 노드도 안전 처리(고립 노드는 별도 배치).

### 툴바 배선

`apps/web/src/editor/toolbar.tsx`에 버튼 추가. 핸들러:

```ts
const onAutoLayout = () => {
  const agv = activeGroupView
  const visible = Object.values(model.tables).filter((t) => (agv ? t.groupId === agv : true))
  if (visible.length < 2) return
  const ids = new Set(visible.map((t) => t.id))
  const nodes = visible.map((t) => {
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

- 버튼: `<Button size="sm" variant="outline" disabled={visibleCount < 2} onClick={onAutoLayout}>자동 정렬</Button>` (아이콘 `LayoutGrid` 등 lucide). `visibleCount`는 위 필터로 계산.
- 일반 뷰 → `moveTable`(position). 그룹 뷰 → `moveTableGroupPosition`(groupPosition).

### 테스트 (`auto-layout.test.ts`)

1. 부모→자식 2노드: 자식 y > 부모 y(TB에서 아래 레이어).
2. 여러 노드 배치 후 바운딩 박스가 겹치지 않음(각 노드 사각형 비겹침 검사).
3. 순환(A→B→A) 입력에도 반환되며 모든 노드 좌표 존재(무한루프 없음).
4. 자기 참조 엣지 포함 입력이 예외 없이 처리됨.

---

## 항목 2: 식별자 인용 (조건부)

### `packages/core/src/identifier.ts`

```ts
import type { Dialect } from './dialect.js'

// 흔히 물리명과 충돌하는 예약어(큐레이션, 확장 가능). 소문자로 저장하고 비교는 대소문자 무시.
const BASE = ['order','user','group','table','select','from','where','index','key','primary',
  'foreign','constraint','check','default','desc','asc','date','time','timestamp','level','type',
  'comment','column','value','values','case','when','then','end','null','into','set','join']
const EXTRA: Record<Dialect, string[]> = {
  postgresql: ['limit','offset','analyse','analyze'],
  mysql: ['rank','lead','lag','read','write','status'],
  oracle: ['number','rowid','level','date','session','access','audit'],
  mssql: ['identity','rowcount','proc','current'],
}
const RESERVED: Record<Dialect, Set<string>> = {
  postgresql: new Set([...BASE, ...EXTRA.postgresql]),
  mysql: new Set([...BASE, ...EXTRA.mysql]),
  oracle: new Set([...BASE, ...EXTRA.oracle]),
  mssql: new Set([...BASE, ...EXTRA.mssql]),
}

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 예약어이거나 안전패턴 위반 시에만 방언 규칙으로 인용. */
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

### `ddl.ts` 적용 지점

식별자 **참조** 위치에만 `quoteIdentifier(name, dialect)` 적용:
- `createTableBlock`: `CREATE TABLE <T>`, PK 컬럼 목록
- `columnLine`: 컬럼명
- `fkStatements`: `ALTER TABLE <child>`, 제약명, 컬럼 목록, `REFERENCES <parent>`, UNIQUE 제약명/컬럼
- `indexStatements`: 인덱스명, 테이블명, 컬럼명
- `commentStatements` (PG/Oracle): `COMMENT ON TABLE <T>` / `COLUMN <T>.<C>`

**인용하지 않는 곳(문자열 리터럴):**
- MySQL 인라인 `COMMENT '...'` 값 → `esc()` 유지
- MSSQL `sp_addextendedproperty`의 `@level1name=N'...'`, `@level2name=N'...'` — 이름이 문자열 리터럴이므로 `esc()` 유지(인용 아님)
- 코멘트 본문 텍스트 → `esc()` 유지

### 테스트 (`ddl.test.ts` 추가)

- 물리명 `ORDER`(예약어): PG `"ORDER"`, MySQL `` `ORDER` ``, MSSQL `[ORDER]`.
- 안전 물리명 `MBR_TBL`: 인용 없음.
- 특수문자 포함 물리명(예: `USER-LOG`): 인용됨.
- MSSQL 코멘트문의 `@level1name`은 인용이 아니라 `N'...'` 리터럴 유지 확인.

---

## 항목 3: 0컬럼 DDL 처리 + 경고 통합

### `ddl.ts`

`generateDdl` 초입에서 **컬럼 0개 테이블 제외**:

```ts
export function generateDdl(model, dialect, scope = { kind: 'all' }) {
  const tables = selectTables(model, scope).filter((t) => tableColumns(model, t.id).length > 0)
  const selectedIds = new Set(tables.map((t) => t.id))
  // ... 이하 동일(제외 테이블은 CREATE·FK·인덱스·코멘트 어디에도 나오지 않음)
}
```

### 경고 함수 (신규 export)

```ts
export function ddlWarnings(model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' }): string[] {
  const inScope = selectTables(model, scope)
  const out: string[] = []
  // 0컬럼 제외 경고
  for (const t of inScope) {
    if (tableColumns(model, t.id).length === 0) out.push(`${t.physicalName}: 컬럼이 없어 DDL에서 제외됨`)
  }
  // scope 범위 타입 변환 경고(Oracle 등)
  for (const t of inScope) {
    for (const c of tableColumns(model, t.id)) {
      const { warning } = resolveColumnType(c.type, dialect)
      if (warning) out.push(`${t.physicalName}.${c.physicalName}: ${warning}`)
    }
  }
  return out
}
```

### `export-dialog.tsx`

- 로컬 `typeWarnings` useMemo 제거 → `const warnings = useMemo(() => ddlWarnings(model, dialect, scope), [model, dialect, scope])`.
- 렌더: DDL 탭 하단 `⚠ {message}` 목록(기존 `text-key` 스타일 유지). scope를 반영하므로 M10에서 남긴 "scope 무시" Minor도 해소.

### 테스트

- 0컬럼 테이블은 `generateDdl` 출력에 `CREATE TABLE` 없음, 무효 `(\n\n)` 없음.
- 0컬럼 테이블을 참조하는 FK도 출력되지 않음.
- `ddlWarnings`가 해당 테이블 제외 경고를 포함.

---

## 항목 4: 그룹 라벨 가림

`apps/web/src/editor/group-node.tsx`: 라벨 버튼을 영역 **상단 테두리 바깥 위**로 이동해 멤버 테이블에 가리지 않게 한다. 컨테이너는 그대로(반투명 영역), 라벨만 절대 위치로 상단 밖에 배치.

```tsx
<div className="relative size-full rounded-xl border-2" style={{ ... }}>
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); selectGroup(group.id) }}
    className="absolute left-0 -top-6 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
    style={{ background: group.color }}   // 잉여 pointerEvents:'auto' 제거
  >
    {group.name}
  </button>
</div>
```

- 영역 노드 상단(`minY - PAD`)보다 위(`-top-6`)에 라벨 → 멤버 영역과 겹치지 않음.
- (범위 외) 측정 bbox 기반 영역 크기 산정은 이번 배치에서 제외(이월 유지).
- 기존 `group-view` 관련 테스트가 라벨 클릭·selectGroup 동작을 계속 통과하는지 확인.

---

## 항목 5: C급 코스메틱 (중복 제거)

### `apps/web/src/lib/format.ts`

```ts
export function formatCreatedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}
```
- `version-dialog.tsx`·`history-view.tsx`의 로컬 정의 제거 후 import.

### `apps/web/src/lib/labels.ts`

```ts
import type { Dialect } from '@erdd/core'
export const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL·MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}
```
- `export-dialog.tsx`·`pages/org-detail.tsx`의 로컬 정의 제거 후 import.
- 동작 불변, 순수 리팩터. 기존 테스트 그린 유지로 검증.

---

## 실행

하나의 구현 계획으로 묶어 subagent-driven-development로 태스크별 구현+리뷰:

1. 식별자 인용(core `identifier.ts` + `ddl.ts` 적용)
2. 0컬럼 DDL 제외 + `ddlWarnings` 통합(core + export-dialog)
3. 자동 정렬(dagre 설치 + `auto-layout.ts` + toolbar)
4. 그룹 라벨 가림(group-node)
5. C급 코스메틱 중복 제거(format/labels)

각 태스크는 독립 테스트 가능. 전체 스위트(core/server/web) + typecheck 그린 유지, 마지막에 fable 전체 브랜치 리뷰 후 main 머지.

## 범위 밖 (계속 이월)

- 측정 bbox 기반 그룹 영역 크기 산정
- 완전한 방언별 예약어 전수(현재는 큐레이션 세트)
- 자동 정렬 방향 토글(TB/LR) UI — 기본 TB 고정
