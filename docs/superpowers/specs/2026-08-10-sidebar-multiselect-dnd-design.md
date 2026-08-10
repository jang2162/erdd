# 좌측 사이드바 사용성 개선 — 다중 선택·드래그 그룹 이동 설계

**작성일:** 2026-08-10 / **상태:** 사용자 확정
**선행 문서:** `docs/superpowers/HANDOFF.md`(3.4 웹 UI 재발 버그, 3.6 실시간 협업), `docs/11-collaboration.md`

---

## 1. 목적과 범위

좌측 사이드바(`apps/web/src/editor/table-tree.tsx`)는 지금 **읽기 전용 탐색기**다. 테이블을 하나 클릭해
캔버스를 그쪽으로 이동시키는 것이 전부이고, 테이블의 그룹을 바꾸려면 **편집 패널의 드롭다운을 하나씩
여는 길밖에 없다**(`edit-panel.tsx:120`). 테이블 20개를 새 그룹으로 정리하려면 20번 반복해야 한다.

이 사이클은 사이드바를 **조작 가능한 표면**으로 만든다.

| # | 기능 | 진입점 |
|---|---|---|
| 1 | 여러 테이블 선택 | 사이드바 트리 · 캔버스(공유 상태) |
| 2 | 사이드바 안에서 드래그해 그룹 이동 | 트리 항목 → 그룹 블록 |
| 3 | 캔버스에서 드래그해 사이드바 그룹에 드롭 | 캔버스 노드 → 사이드바 그룹 블록 |
| 4 | 선택한 테이블 일괄 삭제 | 우측 일괄 작업 패널 |

**모델 스키마는 바뀌지 않는다.** 새 op 엔티티도, 엔티티 필드 추가도, 마이그레이션도 없다. 따라서
DDL·Excel·CLI·파일 포맷·3-way 병합·diff는 이 사이클이 알 것이 하나도 없다. 변경은 **웹 UI + 실시간
presence 프로토콜**에 갇힌다.

### 범위 밖 (의도적)

- **선택 테이블 내보내기 범위 지정** — `ExportScope`의 `{kind:'tables'}`는 타입만 있고 UI가 없다
  (HANDOFF 6절 이월). 사용자가 이번 범위에서 명시적으로 뺐다. 이월 항목으로 그대로 남긴다.
- **그룹 순서 변경(그룹 자체를 드래그해 재정렬)** — `TableGroup`에 순서 필드가 없다(현재 이름 정렬).
  필드 추가는 op 엔티티 스키마 변경이고 파일 포맷·diff·병합까지 번진다. 별도 사이클.
- **다중 선택 상태에서의 상세 편집**(N개 테이블의 논리명을 한 번에 치환하는 등) — 일괄 작업은 그룹
  이동과 삭제 둘로 한정한다.

---

## 2. 확정된 결정 (사용자 확정)

### D1. 다중 선택은 사이드바·캔버스가 **하나의 상태**를 공유한다

사이드바 전용 체크 상태를 따로 두지 않는다. `store.selectedTableId`를 배열로 넓혀 캔버스 하이라이트·
편집 패널·실시간 presence가 전부 같은 값을 본다. 사이드바에서 3개를 고르면 캔버스에서도 3개가
하이라이트되고, 캔버스에서 박스 선택한 것이 사이드바에도 나타난다.

**근거:** 기능 3(캔버스에서 여러 테이블을 잡아 사이드바로 끌기)이 성립하려면 캔버스 선택과 사이드바
선택이 같은 집합이어야 한다. 두 상태를 따로 두면 "무엇이 끌려가는가"가 화면마다 달라진다.

### D2. 2개 이상 선택하면 우측 패널이 **일괄 작업 패널로 전환**된다

```
┌─ 편집 패널 ────────────┐
│ 3개 테이블 선택됨       │
│  · MBR  회원            │
│  · ORD  주문            │
│  · PRD  상품            │
│                         │
│ 그룹 [주문영역     ▾]   │
│ [ 선택 테이블 삭제 ]    │
└─────────────────────────┘
```

**근거:** 상세 편집(컬럼 목록·논리명·커스텀 항목)은 다중 선택에서 의미가 모호하다. 그리고 이 패널의
그룹 드롭다운이 **드래그의 접근성 대체 경로**가 된다 — 드래그만이 유일한 길이면 키보드·보조기술
사용자가 그룹 이동에서 완전히 막힌다.

### D3. 그룹을 옮기면 **캔버스 좌표를 자동으로 새 그룹 옆에 붙인다**

그룹 색상 영역은 멤버 테이블들의 bbox로 그려진다(`group-nodes.ts:20-27`). 좌표를 그대로 두면 새 그룹
영역이 화면을 가로질러 멀리 있는 테이블까지 감싸는 거대한 사각형이 된다.

- 옮기는 테이블 집합의 **상대 배치를 유지한 채 통째로 평행이동**한다(사용자가 잡아 놓은 배열 보존).
- **대상 그룹이 비어 있거나(멤버 0) 미분류로 옮기는 경우는 좌표를 유지한다.** 기준으로 삼을 영역이
  없어서, 억지로 옮기면 오히려 예측 불가능해진다.
- `groupId` 변경과 좌표 변경은 **한 producer 안에서** 적용해 Revision 1건 = `cmd+Z` 한 번으로 전부
  되돌아간다.

### D4. 실시간 presence는 **선택한 것 전부**를 브로드캐스트한다

`Peer.selection: PeerSelection | null` → `Peer.selections: PeerSelection[]`로 프로토콜을 확장한다.
남이 3개를 잡고 있으면 3개 다 하이라이트된다.

**근거:** 일괄 삭제가 들어오므로 "지금 남이 그걸 만지고 있다"가 삭제 직전에 보여야 한다. 대표 1개만
보내면 남이 5개를 잡고 있어도 4개는 자유로워 보인다.

**대가:** core 프로토콜 + 서버 `services/realtime.ts` + `ws.ts` + 웹 3파일이 함께 바뀐다. 이 사이클에서
유일하게 웹 밖으로 나가는 부분이다.

### D5. 선택 제스처는 OS 관례를 따르고, **체크박스는 두지 않는다**

| 제스처 | 사이드바 | 캔버스 |
|---|---|---|
| 클릭 | 단일 선택(기존 동작) | 단일 선택(기존 동작) |
| Cmd/Ctrl + 클릭 | 토글 추가·제거 | 토글 추가·제거 |
| Shift + 클릭 | **화면에 보이는 트리 순서** 기준 범위 선택 | 토글 추가·제거(범위 아님) |
| Shift + 드래그 | — | 박스 선택 |

캔버스에서 Shift가 "범위"가 아닌 이유: 2D 배치에는 선형 순서가 없다. 캔버스에서 Shift는 박스 선택
제스처(ReactFlow 기본 `selectionKeyCode`)에 이미 쓰이고, Shift+클릭은 추가 토글로 흡수한다.

체크박스를 두지 않는 이유: 트리 항목마다 상시 노출되는 시각 노이즈가 크고, 위 관례로 충분하다.

---

## 3. 선택 상태 모델

### 3.1 store 변경

`apps/web/src/editor/store.ts`

```ts
// 변경 전
selectedTableId: string | null
select: (tableId: string | null) => void

// 변경 후
selectedTableIds: string[]              // 마지막 원소 = 주 선택
select: (tableId: string | null) => void        // 시그니처 유지 — 내부적으로 [id] 또는 []
toggleTable: (tableId: string) => void          // 신규: Cmd/Ctrl+클릭
selectTables: (tableIds: string[]) => void      // 신규: Shift 범위 · 박스 선택
```

**"주 선택 = 배열의 마지막 원소"** 가 이 절의 유일한 규칙이다. 길이 0/1이면 지금과 완전히 같은 동작이
되도록 `select`의 시그니처를 유지한다 — `focus()`·`enterGroupView()`·툴바·N:M 버튼 등 기존 호출부를
건드리지 않기 위해서다.

파생 셀렉터를 store 파일에서 함께 export한다(호출부가 `.at(-1)`을 각자 쓰면 규칙이 흩어진다):

```ts
export const primaryTableId = (s: EditorState) => s.selectedTableIds.at(-1) ?? null
```

`CLEARED_SELECTION`의 `selectedTableId: null`은 `selectedTableIds: []`가 된다.

### 3.2 `resync`의 존재 검사는 filter가 된다

현재 `keep(id, rec)`는 단일 id가 사라졌으면 null로 떨어뜨린다. 배열에서는 **살아남은 id만 남기는
filter**로 바뀐다.

```ts
selectedTableIds: s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id)),
```

⚠️ **참조 안정성:** 모두 살아남았으면 **원래 배열 참조를 그대로 반환**해야 한다. 매번 새 배열을 만들면
`selectedTableIds`를 구독하는 컴포넌트가 남의 모든 편집마다 리렌더된다(실시간 op는 초당 여러 번 온다).

### 3.3 `buildNodes`는 집합을 받는다

`nodes.ts`의 `selectedId: string | null` → `selectedIds: ReadonlySet<string>`. `data.selected`는
`selectedIds.has(table.id)`가 된다. 호출부는 `canvas.tsx` 하나뿐이다.

---

## 4. 캔버스 ↔ store 선택 동기화

ReactFlow는 자체적으로 `node.selected`를 관리한다. 두 상태가 각자 진실을 주장하면 어긋난다.

**규칙: store가 진실이다.**

- **store → ReactFlow**: `derived` 노드를 만들 때 `selected: selectedIds.has(id)`를 노드 속성으로 넣는다
  (지금은 `data.selected`만 있고 노드 속성 `selected`는 안 쓴다 — 박스 선택을 쓰려면 필요하다).
- **ReactFlow → store**: 사용자 입력 경로 둘만 store로 흘린다.
  - `onNodeClick(event, node)` — `event.metaKey || event.ctrlKey`면 `toggleTable`, 아니면 `select`.
  - `onSelectionChange({ nodes })` — 박스 선택 결과를 `selectTables`로 반영.

⚠️ **루프 방지:** `onSelectionChange`는 우리가 노드의 `selected`를 바꿀 때도 발화한다. **현재
`selectedTableIds`와 집합이 같으면 store를 갱신하지 않는다**(순서 무시 비교). 이 가드가 없으면
`derived` 재생성 → `onSelectionChange` → `setState` → `derived` 재생성의 무한 루프가 된다.

⚠️ **`onSelectionChange`는 테이블 노드만 본다.** 노드 배열에는 그룹·메모·고스트가 섞여 있고, 그룹
노드는 `selectable: false`라 오지 않지만 메모는 온다. `n.type === 'table'`로 걸러야 한다.

---

## 5. 드래그 앤 드롭

두 경로(사이드바 내부 / 캔버스 → 사이드바)를 **한 벌의 판정 코드**로 처리한다. 드래그 소스만 둘이고,
"화면 좌표 → 드롭 타깃" 판정과 하이라이트 상태는 공용이다.

### 5.1 드롭 타깃 판정 — 좌표 하나로 수렴한다

사이드바의 각 그룹 블록과 미분류 블록에 `data-drop-group` 속성을 단다(그룹 헤더 + 멤버 목록을 함께
감싸는 바깥 `<div>`. 헤더만 타깃이면 조준이 너무 어렵다). 미분류는 특수값 `"unassigned"`.

```ts
// apps/web/src/editor/drop-target.ts (신규)
export type DropTarget = { groupId: string | null }   // null = 미분류

export function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop-group]')
  if (!el) return null
  const raw = el.getAttribute('data-drop-group')!
  return { groupId: raw === 'unassigned' ? null : raw }
}
```

좌표만 있으면 되므로 두 소스가 같은 함수를 쓴다. HTML5 native DnD(`dragover`/`drop`)를 쓰지 않는
이유가 여기 있다 — ReactFlow의 노드 드래그는 pointer 이벤트 기반이라 `dragstart`가 발생하지 않고,
native DnD를 쓰면 캔버스 경로만 별도 구현이 되어 판정·하이라이트가 두 벌로 갈린다.

### 5.2 드래그 상태는 **별도 store**에 둔다

`apps/web/src/editor/drag-store.ts` (신규, 작은 zustand store)

```ts
type DragState = {
  tableIds: string[]          // 끌고 있는 테이블(빈 배열 = 드래그 중 아님)
  over: DropTarget | null     // 현재 커서 아래 드롭 타깃
}
```

⚠️ **에디터 store에 넣지 않는다.** `over`는 `pointermove`마다 갱신되는데, 에디터 store는 모델까지 들고
있어 구독자가 많다. 캔버스 전체가 커서 움직임마다 리렌더된다.

### 5.3 소스 ① — 사이드바 내부

트리 항목에서 `pointerdown` 후 **4px 이상 움직이면** 드래그 시작(그보다 작으면 클릭으로 처리).
`setPointerCapture`로 포인터를 잡고 `pointermove`에서 `dropTargetAt`, `pointerup`에서 드롭.

- **끌리는 대상:** 잡은 항목이 현재 선택에 포함돼 있으면 **선택 전체**, 아니면 그 항목 하나
  (그 경우 선택도 그 항목으로 바꾼다 — 파일 탐색기 관례).
- 드래그 중에는 커서를 따라다니는 고스트("3개 테이블")를 `position: fixed`로 그린다.

### 5.4 소스 ② — 캔버스

ReactFlow의 노드 드래그를 그대로 쓴다. 노드 드래그는 document 레벨에서 추적되므로 커서가 사이드바
위로 나가도 드래그가 유지된다.

- `onNodeDrag(event, node)` — `event.clientX/clientY`로 `dropTargetAt` → `drag-store` 갱신.
- `onNodeDragStop(event, node, dragged)` — `over`가 있으면 **위치 이동 mutate를 건너뛰고** 그룹 이동으로
  분기한다. 대상은 `dragged` 배열의 테이블 노드 전부라 다중 선택 드래그가 자동으로 따라온다.
- 드롭 후 노드는 `setNodes(derived)`로 되돌린다 — 최종 좌표는 `planGroupMove`가 정한다.

⚠️ **`autoPanOnNodeDrag`를 드롭 타깃 위에 있는 동안 꺼야 한다.** 기본값이 `true`라, 사이드바 쪽
가장자리에 커서를 대고 있으면 캔버스가 계속 팬되어 **다른 노드들이 화면 밖으로 밀려난다**. `over !== null`
일 때 `false`로 내리는 prop 바인딩으로 처리한다.

⚠️ **그룹 노드·고스트 노드 드래그는 이 분기에 들어가면 안 된다.** 그룹 노드 드래그는 이미 "그룹 통째
이동"이라는 다른 의미가 있다(`canvas.tsx:144-172`). `node.type !== 'table'`이면 기존 경로 그대로.

### 5.5 드래그 중에는 숨은 그룹을 다시 보여준다

트리는 두 조건에서 그룹을 숨긴다.

1. **검색 중** 멤버가 하나도 안 걸리는 그룹(`table-tree.tsx:63`)
2. **그룹 뷰**(`activeGroupView`) 중 그 그룹을 제외한 전부(`table-tree.tsx:34`)

둘 다 드래그 중에는 해제한다. 안 그러면 검색으로 찾은 테이블을 원하는 그룹에 놓을 수 없고, 그룹 뷰에서
"이건 다른 그룹으로 보내야겠다"는 가장 자연스러운 동선이 막힌다.

---

## 6. `planGroupMove` — 좌표 재배치

`apps/web/src/editor/group-move.ts` (신규)

```ts
export function planGroupMove(
  model: ProjectModel, tableIds: string[], targetGroupId: string | null,
): { id: string; position: Position }[]
```

**core가 아니라 web에 두는 이유:** 그룹 영역 크기 추정(`EST_W = 260`, `estHeight(colCount)`)이
`group-nodes.ts`에만 있는 웹 렌더링 상수다. core는 IO·렌더 무관 순수 도메인이어야 한다(HANDOFF 3.5).

**알고리즘**

1. 대상 그룹의 **기존 멤버**(이동 대상 제외)의 bbox를 구한다. 멤버가 0이거나 `targetGroupId === null`
   (미분류)이면 **빈 배열을 반환한다** — 좌표를 건드리지 않는다.
2. 이동 집합의 bbox를 구한다.
3. `delta = { x: targetMaxX + GAP - moveMinX, y: targetMinY - moveMinY }` (`GAP = 60`)
4. 모든 이동 대상에 같은 delta를 더한다 → **상대 배치 보존**.

bbox 계산은 `group-nodes.ts`의 것과 같은 로직이므로 **`tableBounds(model, tables)` 헬퍼를 뽑아 양쪽이
공유한다**(HANDOFF 3.5 "중복 헬퍼 통합" 선례).

### 6.1 `groupPosition`은 null로 초기화한다

테이블은 좌표를 둘 갖는다 — 전체 뷰의 `position`과 그룹 뷰 전용 `groupPosition`(`nodes.ts:31`이
`groupPosition ?? position`으로 폴백). **그룹이 바뀌면 이전 그룹 뷰에서 잡아 둔 좌표는 의미가 없으므로
`groupPosition`을 `null`로 되돌린다.** 그러면 새 그룹의 그룹 뷰에서 전체 뷰 좌표로 폴백해 자연스럽게
자리를 잡는다.

`planGroupMove`가 계산하는 것은 **언제나 전체 뷰 좌표(`position`)**다. 그룹 뷰 중에 드롭해도 마찬가지다
— 그 테이블은 다른 그룹 소속이 되어 현재 그룹 뷰에서 사라지므로, 재배치 결과는 전체 뷰로 나가야 보인다.

### 6.2 하나의 producer, 하나의 Revision

```ts
void mutate((m) => {
  let next = m
  for (const id of ids) next = setTableGroup(next, id, targetGroupId)
  for (const { id, position } of planGroupMove(m, ids, targetGroupId)) {
    next = moveTable(next, id, position)
  }
  return next
}, { summary: `그룹 이동 (${ids.length}개)` })
```

⚠️ `planGroupMove`에 넘기는 모델은 **그룹 변경 전 모델**(`m`)이다. `next`를 넘기면 이동 대상이 이미
대상 그룹의 멤버가 되어 있어 bbox에 자기 자신이 섞이고, "기존 멤버 오른쪽"이 자기 자신 오른쪽이 된다.

---

## 7. 일괄 삭제

`deleteTableCascade`를 선택 수만큼 producer 안에서 접어 **Revision 1건**으로 만든다.

**확인 다이얼로그를 둔다.** 지금 단일 삭제(`toolbar.tsx:52`)는 확인 없이 즉시 지우지만, 일괄 삭제는
다르게 취급한다 — undo로 되돌아가긴 하나 실시간으로 남의 화면에도 즉시 반영되는 파괴적 동작이고,
잘못 선택한 채 누르는 것이 다중 선택에서 훨씬 쉽다.

다이얼로그는 **삭제 대상 목록 + 함께 사라지는 관계 수**를 보여준다("테이블 3개와 관계 5개가
삭제됩니다"). 관계 수는 선택 테이블이 부모 또는 자식인 관계의 개수다(`deleteTableCascade`가 지우는
것과 같은 집합).

**툴바의 기존 삭제 버튼도 같은 경로를 탄다.** 선택이 1개면 지금처럼 확인 없이 즉시 삭제하고, 2개
이상이면 일괄 패널과 **같은 확인 다이얼로그 컴포넌트**를 띄워 선택 전체를 지운다. 다중 선택일 때
툴바 버튼만 주 선택 하나를 지우면, 화면에 3개가 하이라이트된 상태에서 1개만 사라져 사용자가 무엇이
지워질지 예측할 수 없다.

**op 상한 가드:** 삭제될 엔티티 총수(테이블 + 컬럼 + 인덱스 + 관계)가 `MAX_OPS_PER_MUTATION`(5000)을
넘으면 **제출 전에 막고 안내한다**(HANDOFF 3.2 ⚠️ — 낙관 반영 후 서버 거절로 되돌려지는 것을
사용자가 겪지 않도록). 그룹 이동은 테이블당 update op 1건이라 5000 도달이 비현실적이므로 가드를 두지
않는다.

---

## 8. 실시간 presence 프로토콜 확장

### 8.1 core (`packages/core/src/realtime-protocol.ts`)

```ts
export const MAX_PEER_SELECTIONS = 50

export type Peer = { userId: string; name: string; selections: PeerSelection[] }
export type ClientMessage = { type: 'selection'; selections: PeerSelection[] }
```

- `PeerSelection`(`{ kind, id }`)과 `PEER_SELECTION_KINDS`는 그대로다.
- `parseSelection` → `parseSelections(v): PeerSelection[] | undefined`. 배열이 아니면 형식 오류
  (`undefined`), 원소 하나라도 형식 오류면 전체 오류. **길이가 `MAX_PEER_SELECTIONS`를 넘으면 앞
  50개로 자른다**(거부가 아니라 절단 — 신뢰할 수 없는 입력에 대한 payload 방어이고, 지금 소켓에는
  cap이 없다. HANDOFF 6절 이월 항목).
- 빈 배열이 "선택 없음"이다. `null`은 프로토콜에서 사라진다.

### 8.2 서버

- `apps/server/src/services/realtime.ts` — `Entry.selection` → `selections: PeerSelection[]`,
  `setSelection` → `setSelections`. `peers()`의 사용자 단위 병합(같은 사용자의 여러 소켓 중 `selRank`가
  가장 큰 것을 채택)은 **로직 그대로**이고 실어 나르는 값만 배열이 된다.
- `apps/server/src/ws.ts:105` — `handle.setSelections(msg.selections)`.

### 8.3 웹

- `peer-marks.ts` — peer마다 `selections`를 순회해 마크를 뒤집는다. 지금은 peer당 1건이지만 앞으로는
  peer당 N건이 같은 맵에 들어간다.
- `use-realtime.ts` — `selectionOf(state)`가 배열을 반환한다. 재접속 시 재발신(`socket.onopen`)과
  변경 감지(`JSON.stringify` 비교)는 배열에서도 그대로 동작한다.
- `selectionImpact` — "내 선택 **중 하나라도** 남의 op에 걸리면" 토스트로 넓힌다.

### 8.4 배포 시 호환성

새 서버 + 옛 탭 조합에서는 그 탭이 보내는 `{selection: …}` 프레임이 파싱 실패로 무시된다(소켓은
유지되고 하이라이트만 안 뜬다). 반대로 옛 탭은 서버가 보내는 `selections`를 못 읽어 presence 프레임을
버린다. **인메모리 허브 단일 인스턴스이고 새로고침하면 해소되므로 프로토콜 버전 협상은 넣지 않는다.**
이 사실을 릴리스 노트에 적는 것으로 갈음한다.

---

## 9. 파일 목록

**신규**

| 파일 | 내용 |
|---|---|
| `apps/web/src/editor/drop-target.ts` | `dropTargetAt(x, y)` — 좌표 → 드롭 타깃 |
| `apps/web/src/editor/drag-store.ts` | 드래그 중 상태(끌리는 id 집합 · 현재 타깃) |
| `apps/web/src/editor/group-move.ts` | `planGroupMove` · `tableBounds` |
| `apps/web/src/editor/bulk-panel.tsx` | 일괄 작업 패널(목록 · 그룹 이동 · 삭제 + 확인 다이얼로그) |

**변경**

| 파일 | 내용 |
|---|---|
| `packages/core/src/realtime-protocol.ts` | `selections` 배열 · `MAX_PEER_SELECTIONS` · `parseSelections` |
| `apps/server/src/services/realtime.ts` | `Entry.selections` · `setSelections` |
| `apps/server/src/ws.ts` | 105행 배선 |
| `apps/web/src/editor/store.ts` | `selectedTableIds` · `toggleTable` · `selectTables` · `resync` filter |
| `apps/web/src/editor/table-tree.tsx` | 다중 선택 제스처 · 드래그 소스 ① · 드롭 타깃 마크업 · 드래그 중 그룹 노출 |
| `apps/web/src/editor/canvas.tsx` | 선택 동기화 · 드래그 소스 ② · `autoPanOnNodeDrag` 제어 |
| `apps/web/src/editor/nodes.ts` | `selectedIds` 집합 |
| `apps/web/src/editor/group-nodes.ts` | `tableBounds` 공유로 전환 |
| `apps/web/src/editor/edit-panel.tsx` | 2개 이상이면 `BulkPanel`로 분기 |
| `apps/web/src/editor/toolbar.tsx` | 삭제 버튼이 다중 선택이면 전체 삭제 + 확인 다이얼로그(7절) |
| `apps/web/src/editor/peer-marks.ts` | `selections` 순회 |
| `apps/web/src/editor/use-realtime.ts` | `selectionOf` 배열화 · `selectionImpact` 확장 |

---

## 10. 테스트 전략

> 이 저장소의 지배적 결함군은 틀린 코드가 아니라 **아무것도 붙잡아 두지 않는 맞는 코드**다
> (HANDOFF 5절). 아래는 "무엇을 되돌리면 실패해야 하는가"로 적는다.

### 10.1 core (`realtime-protocol.test.ts`)

- `parseSelections`: 빈 배열과 필드 누락을 구분한다(빈 배열은 유효, 누락은 형식 오류)
- 원소 하나가 형식 오류면 전체 거부
- **51개를 보내면 50개로 잘린다** — 절단 상수를 지우면 실패해야 한다
- `parseServerMessage`의 presence/ready가 `selections`를 왕복

### 10.2 서버 (`ws.test.ts` · `realtime.test.ts`)

- 다중 선택 프레임을 보내면 다른 소켓의 presence에 **N건 그대로** 나타난다
- 같은 사용자의 소켓 둘 중 **나중 갱신본**이 채택되는 기존 규칙이 배열에서도 유지된다
- 형식 오류 프레임은 무시되고 **소켓이 끊기지 않는다**(기존 계약)

### 10.3 웹 — 순수 함수

- `planGroupMove`
  - 상대 배치 보존: 3개를 옮기면 서로의 상대 좌표차가 이동 전과 같다
  - 대상 그룹 오른쪽 배치: 결과 minX > 대상 그룹 maxX
  - **빈 그룹·미분류는 빈 배열 반환**(좌표 불변) — 이 갈래를 지우면 실패해야 한다
  - 그룹 변경 **전** 모델을 기준으로 계산한다(6.2 ⚠️): 이동 대상이 이미 대상 그룹 멤버인 모델을
    넘기면 결과가 달라지는 것을 고정
- `dropTargetAt`: `unassigned` → `{ groupId: null }`, 타깃 밖 → `null`
- `tableBounds`: `group-nodes.ts`와 `group-move.ts`가 같은 값을 낸다

### 10.4 웹 — 컴포넌트

- Cmd+클릭 토글 / Shift 범위가 **화면에 보이는 트리 순서**를 따른다 — **검색 필터가 걸린 상태**에서
  범위를 잡으면 걸러진 항목은 포함되지 않는다(정렬 배열이 아니라 렌더 목록을 쓰는지 잡는다)
- 2개 이상 선택 시 편집 패널이 일괄 패널로 바뀐다
- 일괄 패널의 그룹 드롭다운으로 이동하면 **op 배치 1개**가 나간다(= undo 1회)
- 일괄 삭제 확인 다이얼로그가 관계 수를 정확히 세고, 취소하면 아무 op도 나가지 않는다
- 드래그 중 검색으로 숨은 그룹·그룹 뷰 밖 그룹이 다시 보인다
- `resync`가 남이 지운 테이블을 선택 배열에서 걷어내고, **아무것도 안 지워졌으면 배열 참조를 유지**한다
  (3.2 ⚠️ — 새 배열을 만들면 실패해야 한다)
- `onSelectionChange` 루프 가드: 같은 집합이 오면 `setState`가 호출되지 않는다

### 10.5 구분력 실증

각 수정에 대해 프로덕션 변경을 되돌려 테스트가 **실제로 실패**하는지 확인하고 복구한다. 특히 다음
넷은 "있어도 그만"으로 보이기 쉬워 실증을 명시적으로 요구한다.

1. `MAX_PEER_SELECTIONS` 절단
2. `resync`의 배열 참조 유지
3. `onSelectionChange` 루프 가드
4. `planGroupMove`에 넘기는 모델이 변경 **전** 모델인 것

### 10.6 브라우저 스모크

실 앱 + 실 DB에서 다음을 밟는다(대조군 포함 — HANDOFF 5절).

1. 사이드바에서 Cmd+클릭으로 3개 선택 → 캔버스에서도 3개 하이라이트되는지
2. 그중 하나를 잡아 다른 그룹 블록에 드롭 → 3개가 함께 이동하고 **상대 배치가 보존**되는지
3. `cmd+Z` 한 번으로 그룹과 좌표가 **동시에** 원복되는지
4. 캔버스에서 Shift 박스 선택 → 사이드바 그룹으로 드래그 → 같은 결과
5. 드래그 중 사이드바 가장자리에서 **캔버스가 팬되지 않는지**(5.4 ⚠️)
6. 두 번째 클라이언트에서 접속해 **다중 선택이 N개 그대로 하이라이트**되는지
7. 일괄 삭제 확인 다이얼로그 → 취소 시 무변경, 확인 시 Revision 1건

---

## 11. 알려진 한계 (이월 후보)

- **그룹 순서 변경 불가** — 그룹은 이름 정렬 고정. 순서 필드가 모델에 없다(2절 범위 밖).
- **선택 테이블 내보내기 범위 미지원** — `ExportScope`의 `{kind:'tables'}`는 여전히 타입만 있다.
- **터치 드래그 미검증** — `pointerdown`/`setPointerCapture` 기반이라 원리상 동작하지만 이 사이클에서
  터치 기기 스모크는 하지 않는다.
- **드롭 타깃이 사이드바 밖에는 없다** — 캔버스의 그룹 색상 영역에 직접 떨어뜨려 그룹을 바꾸는 것은
  이번 범위가 아니다(같은 `dropTargetAt` 위에 얹을 수 있는 확장점이다).
- **일괄 작업은 그룹 이동·삭제 둘뿐** — 논리명 일괄 치환, 커스텀 항목 일괄 지정 등은 없다.
- **presence 절단이 조용하다** — 51개 이상 선택하면 남에게 50개만 보이고 아무 안내도 없다.
- **드래그 중 자동 스크롤 없음** — 사이드바 트리가 길어 타깃이 화면 밖이면 사용자가 먼저 스크롤해야
  한다.
