# Phase 1 M10 — 정리: 그룹 영역 드래그 + 사용자대면/정합성 Minor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 이월 항목 중 (1) 전체 뷰에서 그룹 색상 영역을 드래그하면 소속 테이블이 함께 이동하는 미완 기능과, (2) 사용자 대면·정합성 Minor들을 정리한다.

**Architecture:** 모두 기존 계층 위의 국소 수정. 그룹 영역 드래그는 M5a의 색상 영역 노드를 draggable로 바꾸고 canvas의 드래그 핸들러에서 멤버 테이블을 델타만큼 이동한다(persist는 기존 `moveTable` 경로). Minor들은 캔버스·에디터·내보내기·스냅샷의 이미 있는 코드를 손본다. 새 의존성 없음.

**Tech Stack:** React 19, @xyflow/react, Zustand, @erdd/core, Fastify+tRPC, vitest.

## Global Constraints

- 그룹 영역 드래그는 **전체 뷰에서만**(그룹 뷰는 색상 영역을 숨김). 멤버 이동은 전체 뷰 좌표(`position`) → `moveTable`. 그룹 드래그로 이동한 최종 위치는 하나의 mutation(요약 "그룹 이동")으로 persist.
- 이벤트 값은 호출 시점 즉시 캡처(M4b~M9 교훈: producer 클로저에서 `e.target` 지연 읽기 금지).
- 기존 동작 무회귀: 테이블/노트 드래그, onConnect, 그룹 뷰, DDL/이미지 내보내기, 스냅샷은 그대로.
- 서버는 snapshot.delete 한 곳만 변경(404 일관성). op/model 파이프라인 불변.
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖 (이번 정리에서 제외)

- 자동 정렬(관계 기반 레이아웃 — 별도), 식별자 인용/예약어, 0컬럼 DDL, 코스메틱 중복(formatCreatedAt·DIALECT_LABEL)·테스트 갭 등 C급 Minor.

---

## File Structure

**web (수정):**
- `apps/web/src/editor/group-nodes.ts` — 그룹 노드 `draggable: true`.
- `apps/web/src/editor/group-node.tsx` — 컨테이너 `pointer-events` 조정·라벨 클릭 stopPropagation.
- `apps/web/src/editor/canvas.tsx` — 그룹 드래그 핸들러(멤버 델타 이동), onNodeClick(group)=선택 해제.
- `apps/web/src/editor/toolbar.tsx` — 그룹 뷰에서 테이블 추가 시 활성 그룹 배정·메모 비활성.
- `apps/web/src/editor/ghost-nodes.ts` — 고스트 `connectable: false`.
- `apps/web/src/editor/group-view-select.tsx` — 삭제된 활성 그룹 스테일값 가드.
- `apps/web/src/editor/image-export.ts` — `rf.getNodesBounds` 바인딩 사용.
- `apps/web/src/editor/index-section.tsx` — 인덱스 기본명을 producer 안에서 산정(경쟁 제거).
- `apps/web/src/editor/export-dialog.tsx` — DDL 탭에 선택 방언의 변환 경고 표시.
- `apps/server/src/routers/snapshot.ts` — `delete`가 없는/타프로젝트 스냅샷에 404.

**web (수정 테스트):** 해당 파일들의 `*.test.tsx`에 케이스 추가.

---

## Task 1: 그룹 영역 드래그(전체 뷰)

**Files:**
- Modify: `apps/web/src/editor/group-nodes.ts`, `group-node.tsx`, `canvas.tsx`

**Interfaces:**
- Consumes: `moveTable`(model-edits), store `activeGroupView`/`select`/`selectGroup`, `buildGroupNodes`.

### 설계 (읽고 시작)

- **group-nodes.ts**: 그룹 노드에 `draggable: true`(현재 false). `selectable: false`, `zIndex: 0` 유지(테이블 뒤). id는 기존대로 `group:<groupId>`.
- **group-node.tsx**: 컨테이너 div의 `pointerEvents: 'none'`를 제거(드래그하려면 포인터 이벤트 필요). 대신 테이블이 배열 뒤(위 stacking)라 테이블 영역 클릭·드래그는 테이블에 간다 — 빈 영역만 그룹 노드가 받는다. 라벨 버튼 onClick에 `e.stopPropagation()` 추가(노드 클릭으로 버블 방지)하고 `selectGroup(group.id)` 유지.
- **canvas.tsx**:
  - `onNodeClick`: `node.type === 'group'`이면 `select(null)`(빈 영역 클릭 = 선택 해제; 라벨은 stopPropagation으로 별도 그룹 선택). ghost는 기존 처리 유지.
  - 그룹 드래그: `useRef`로 드래그 시작 상태 보관.
    ```tsx
    import { useRef } from 'react'
    import type { XYPosition } from '@xyflow/react'
    const dragOrigin = useRef<{ groupNodeStart: XYPosition; members: Map<string, XYPosition> } | null>(null)

    const groupIdOf = (nodeId: string) => nodeId.slice('group:'.length)

    // onNodeDragStart: 그룹 노드면 시작 좌표와 멤버 좌표를 기록
    onNodeDragStart={(_, node) => {
      if (node.type !== 'group') return
      const gid = groupIdOf(node.id)
      const members = new Map<string, XYPosition>()
      for (const t of Object.values(model.tables)) if (t.groupId === gid) members.set(t.id, { ...t.position })
      dragOrigin.current = { groupNodeStart: { ...node.position }, members }
    }}

    // onNodeDrag: 그룹 노드면 멤버 노드를 델타만큼 라이브 이동(로컬 RF 상태)
    onNodeDrag={(_, node) => {
      if (node.type !== 'group' || !dragOrigin.current) return
      const o = dragOrigin.current
      const dx = node.position.x - o.groupNodeStart.x
      const dy = node.position.y - o.groupNodeStart.y
      setNodes((ns) => ns.map((n) =>
        o.members.has(n.id) ? { ...n, position: { x: o.members.get(n.id)!.x + dx, y: o.members.get(n.id)!.y + dy } } : n))
    }}
    ```
  - `onNodeDragStop`: 그룹 노드면 멤버 최종 위치를 persist, 아니면 기존 테이블/노트 처리.
    ```tsx
    onNodeDragStop={(_, node, dragged) => {
      if (node.type === 'group') {
        const o = dragOrigin.current
        dragOrigin.current = null
        if (!o) return
        const dx = node.position.x - o.groupNodeStart.x
        const dy = node.position.y - o.groupNodeStart.y
        if (dx === 0 && dy === 0) return
        void mutate((m) => {
          let next = m
          for (const [id, pos] of o.members) next = moveTable(next, id, { x: pos.x + dx, y: pos.y + dy })
          return next
        }, { summary: '그룹 이동' })
        return
      }
      // 기존: group/ghost 스킵, 그룹뷰=moveTableGroupPosition, 전체뷰=moveTable/moveNote
      void mutate((m) => dragged.reduce((acc, n) => {
        if (n.type === 'group' || n.type === 'ghost') return acc
        if (view.kind === 'group' && n.type === 'table') return moveTableGroupPosition(acc, n.id, n.position)
        if (n.type === 'note') return moveNote(acc, n.id, n.position)
        return moveTable(acc, n.id, n.position)
      }, m), { summary: '이동' })
    }}
    ```
  - 현재 canvas.tsx를 읽고 위 핸들러들을 기존 것과 병합(onNodeDragStart/onNodeDrag가 없으면 추가). `setNodes`는 이미 `useNodesState`에서 얻고 있음. `mutate`·`model`·`view`·`select`·`moveTable` 이미 스코프에 있음.

### Steps

- [ ] **Step 1: group-nodes.ts** — 그룹 노드 `draggable: true`로. (기존 `draggable: false` → `true`.)
- [ ] **Step 2: group-node.tsx** — 컨테이너 `pointerEvents:'none'` 제거, 라벨 onClick에 `e.stopPropagation()` 추가.
- [ ] **Step 3: canvas.tsx** — dragOrigin ref + onNodeDragStart/onNodeDrag/onNodeDragStop 그룹 분기 + onNodeClick(group)=select(null). 기존 테이블/노트/고스트/그룹뷰 처리 보존.
- [ ] **Step 4: group-nodes.test.ts** — `buildGroupNodes` 결과의 `draggable === true` assert 추가(기존 draggable:false 단언이 있으면 갱신).
- [ ] **Step 5: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → PASS.
- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/group-nodes.ts apps/web/src/editor/group-node.tsx apps/web/src/editor/canvas.tsx apps/web/src/editor/group-nodes.test.ts
git commit -m "feat(web): 전체 뷰 그룹 영역 드래그 — 소속 테이블 함께 이동"
```

---

## Task 2: 캔버스/에디터 Minor 일괄

**Files:**
- Modify: `apps/web/src/editor/toolbar.tsx`, `ghost-nodes.ts`, `group-view-select.tsx`, `image-export.ts`, `index-section.tsx`
- Modify tests: 해당 `*.test` 중 영향받는 것

### 설계 (읽고 시작 — 각 항목 독립)

1. **그룹 뷰 툴바 UX** (`toolbar.tsx`): 현재 그룹 뷰에서 "테이블 추가"는 미분류 테이블을 만들어 그룹 뷰에 안 보이고, "메모"도 그룹 뷰에서 안 보인다.
   - `activeGroupView`를 구독. "테이블 추가"의 producer에서 activeGroupView가 있으면 새 테이블을 그 그룹에 배정: `(m) => { let n = addTable(m, { id, position: center }); if (agv) n = setTableGroup(n, id, agv); return n }` (setTableGroup import from `@erdd/core`). agv 값은 호출 시점 캡처.
   - "메모" 버튼 `disabled={!!activeGroupView}`(그룹 뷰에선 메모 숨김이므로 추가 비활성).
2. **고스트 connectable** (`ghost-nodes.ts`): 각 고스트 노드에 `connectable: false` 추가(고스트에서 관계 드래그 시작 방지 — 내비게이션 전용).
3. **GroupViewSelect 스테일 가드** (`group-view-select.tsx`): `value`를 `activeGroupView && groups[activeGroupView] ? activeGroupView : ''`로(삭제된 활성 그룹이면 "전체 뷰" 표시). onChange는 그대로.
4. **getNodesBounds 바인딩** (`image-export.ts`): 자유함수 `getNodesBounds(nodes)` → `rf.getNodesBounds(nodes)`(useReactFlow 인스턴스 바운드 버전; dev 콘솔 경고 제거). import에서 `getNodesBounds` 제거. `downloadCanvasImage`는 이미 `rf`를 받으므로 `rf.getNodesBounds(nodes)`로 교체. (가드 테스트는 getNodesBounds 도달 전 throw라 mock 불변; 통과 확인.)
5. **인덱스명 경쟁** (`index-section.tsx`): `onAdd`에서 이름을 producer 안에서 산정 —
   ```ts
   void mutate((m) => createIndex(m, {
     id, tableId,
     name: nextIndexName(new Set(Object.values(m.indexes).map((ix) => ix.name))),
   }), { summary: '인덱스 추가' })
   ```
   (render-scope `used` 대신 producer의 `m` 기준. 빠른 연속 추가 시 IX_1/IX_2로 분리.)

### Steps

- [ ] **Step 1: toolbar.tsx** — 그룹 뷰 테이블 추가 배정 + 메모 비활성. (addTable/setTableGroup 조합, 메모 disabled.)
- [ ] **Step 2: ghost-nodes.ts** — `connectable: false` 추가.
- [ ] **Step 3: group-view-select.tsx** — 스테일 가드.
- [ ] **Step 4: image-export.ts** — `rf.getNodesBounds` 사용, import 정리.
- [ ] **Step 5: index-section.tsx** — 이름 산정을 producer 안으로.
- [ ] **Step 6: 테스트** — 다음 중 값싼 것 추가/갱신: (a) 그룹 뷰에서 "테이블 추가" 시 새 테이블 groupId가 활성 그룹(store 세팅 후 toolbar 렌더·클릭); (b) 삭제된 활성 그룹에서 GroupViewSelect value가 ''(전체 뷰); (c) 인덱스 연속 2회 추가 시 이름이 IX_1·IX_2. 기존 테스트 무회귀.
- [ ] **Step 7: 웹 테스트·타입체크·커밋**

```bash
git add apps/web/src/editor/toolbar.tsx apps/web/src/editor/ghost-nodes.ts apps/web/src/editor/group-view-select.tsx apps/web/src/editor/image-export.ts apps/web/src/editor/index-section.tsx <해당 테스트들>
git commit -m "fix(web): 정리 — 그룹뷰 테이블추가 배정·메모 비활성·고스트 비연결·뷰선택 가드·이미지 바운드·인덱스명 경쟁"
```

---

## Task 3: 내보내기/스냅샷 Minor

**Files:**
- Modify: `apps/web/src/editor/export-dialog.tsx`, `apps/server/src/routers/snapshot.ts`
- Modify tests: `export-dialog.test.tsx`, `snapshot.test.ts`

### 설계 (읽고 시작)

1. **DDL 변환 경고 표면화** (`export-dialog.tsx`): DDL 탭에서 선택 방언 기준으로 각 컬럼 타입을 `resolveColumnType(col.type, dialect)`로 해석해 `warning`이 있는 것들을 미리보기 아래에 목록으로 보여준다.
   - `resolveColumnType`·컬럼→테이블 매핑으로 `useMemo(() => { const out = []; for (const c of Object.values(model.columns)) { const { warning } = resolveColumnType(c.type, dialect); if (warning) out.push({ table: model.tables[c.tableId]?.physicalName, col: c.physicalName, warning }) } return out }, [model, dialect])`.
   - 경고 목록이 있으면 미리보기 아래 `⚠ <table>.<col>: <warning>`을 작게 렌더(scope 필터는 생략 — 전체 기준; 간단화). 없으면 렌더 안 함.
   - `resolveColumnType`는 이미 `@erdd/core` export. 현재 Oracle의 TIME/DATETIME/JSON에만 경고가 있으므로 Oracle 선택 시에만 목록이 뜬다.
2. **snapshot.delete 404** (`snapshot.ts`): `delete`가 삭제 전에 존재(프로젝트 스코프)를 확인하고 없으면 `NOT_FOUND`(get/restore와 동일). 예:
   ```ts
   delete: authedProcedure.input(...).mutation(async ({ ctx, input }) => {
     await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
     const snap = (await ctx.db.select({ id: snapshots.id }).from(snapshots)
       .where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId))))[0]
     if (!snap) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
     await ctx.db.delete(snapshots).where(and(eq(snapshots.id, input.snapshotId), eq(snapshots.projectId, input.projectId)))
     return { ok: true as const }
   }),
   ```

### Steps

- [ ] **Step 1: export-dialog.tsx** — DDL 탭에 변환 경고 목록(위 useMemo + 렌더). DDL 미리보기·복사·다운로드·이미지 탭 불변.
- [ ] **Step 2: snapshot.ts** — delete 존재 확인 후 404.
- [ ] **Step 3: 테스트** — (a) export-dialog: Oracle 선택 + TIME 컬럼 있는 store에서 경고 목록이 렌더된다(1건). (b) snapshot.test.ts: 없는/타프로젝트 snapshotId delete가 NOT_FOUND(erdd_test DB 게이팅 — 기존 스냅샷 테스트 패턴에 추가).
- [ ] **Step 4: 웹·서버 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck && pnpm --filter @erdd/server typecheck`. (서버 통합 테스트는 DB 게이팅 — 컨트롤러가 erdd_test로 확인.)
- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/export-dialog.tsx apps/web/src/editor/export-dialog.test.tsx apps/server/src/routers/snapshot.ts apps/server/src/routers/snapshot.test.ts
git commit -m "fix: DDL 방언 변환 경고 표면화·snapshot.delete 404 일관성"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- 전체 뷰에서 그룹 색상 영역의 빈 부분을 끌면 소속 테이블이 함께 이동하고 릴리스 시 저장된다(테이블 개별 드래그·노트 드래그·그룹 뷰 드래그는 무회귀). 영역 빈 부분 클릭은 선택 해제, 라벨 클릭은 그룹 선택.
- 그룹 뷰에서 "테이블 추가"가 그 그룹에 배정돼 즉시 보이고, "메모"는 비활성.
- 고스트 노드에서 관계선을 새로 그릴 수 없다(내비게이션만).
- 활성 그룹을 삭제하면 뷰 선택이 "전체 뷰"로 표시된다.
- 이미지 내보내기 시 dev 콘솔에 getNodesBounds 경고가 없다(기능 무회귀).
- 인덱스를 빠르게 두 번 추가해도 이름이 겹치지 않는다(IX_1·IX_2).
- DDL 내보내기에서 Oracle 선택 시 TIME/DATETIME/JSON 컬럼의 변환 경고가 표시된다.
- 없는/타프로젝트 스냅샷 삭제가 404다.
- 전체 테스트·타입체크 통과.

## 이월(그대로 남김)

자동 정렬(관계 기반 레이아웃), 식별자 인용/예약어, 0컬럼 테이블 DDL, C급 코스메틱 중복·테스트 갭, 그룹 영역 라벨 가림(측정 bbox), Phase 2 항목.
