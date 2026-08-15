# 메모·관계선 단축키 — 설계

**작성:** 2026-08-16 / **상태:** 사용자 확정 / **마이그레이션:** 없음 / **서버 변경:** 없음 /
**core 변경:** 없음 / **CLI 변경:** 없음 / **범위:** `apps/web` 전용

---

## 1. 목적과 범위

캔버스에서 **메모와 관계선을 키보드로 지우고, 메모를 복사·붙여넣는다.**

지금 `use-shortcuts.ts`의 세 단축키(`Cmd+C`·`Cmd+X`·`Delete`/`Backspace`)는 **테이블과 컬럼만**
본다. 메모나 관계선을 고른 상태에서는 아무 일도 일어나지 않아, 우측 패널의 삭제 버튼까지 마우스를
가져가야 한다. 테이블은 키보드로 지워지는데 메모는 안 되는 비대칭이다.

**범위 안**

| 대상 | 하는 일 |
|---|---|
| `apps/web/src/editor/use-shortcuts.ts` | 삭제 분기에 메모·관계 추가, 복사/잘라내기/붙여넣기에 메모 추가 |
| `apps/web/src/editor/clipboard.ts` | `kind: 'notes'` 추가(`serializeNotes`·`parseClipboard` 분기) |
| `apps/web/src/editor/clipboard-edits.ts` | `pasteNotes`·`planPasteNoteIds` |

**범위 밖 (건드리지 않는다)**

- **`packages/core`·서버·CLI·마이그레이션** — 메모는 이미 있는 op 엔티티이고 `removeNote`·`addNote`가
  `apps/web/src/editor/note-edits.ts`에 있다. 새로 알 것이 없다.
- **관계 복사·붙여넣기**(2절 D3) · **그룹 단축키**(D4) · **메모 다중 선택**(D5).
- 우측 패널의 삭제 버튼 — 그대로 둔다. 단축키가 **같은 함수를 부르는 두 번째 진입점**이 된다.

---

## 2. 확정된 결정 (사용자 확정)

### D1. 복사는 **ERDD JSON**이다 (평문이 아니다)

`Cmd+C`가 메모 내용을 평문으로 넣지 않고 기존 클립보드 포맷(`__erdd`·`v` 표식)으로 담는다.

**근거:** 앱 안에서 메모를 복제하는 것이 목적이다. 평문이면 `parseClipboard`가 표식을 요구하므로
붙여넣기 경로가 성립하지 않는다. 대가는 메모장·이슈에 붙여넣으면 JSON 문자열이 나온다는 것이고,
사용자가 그것을 수용했다.

### D2. 삭제는 **기존 패널 버튼과 완전히 같다**

같은 함수 · 같은 summary · 같은 순서(선택을 먼저 비우고 mutate).

| 선택 | 함수 | summary |
|---|---|---|
| 메모 | `removeNote`(`note-edits.ts:19`) | 「메모 삭제」 |
| 관계 | `deleteRelationship`(core) | 「관계 삭제」 |

**근거:** 진입점이 둘이면 규칙은 하나여야 한다(`applyGroupMove`·`createGroupWith`가 세운 형태).
특히 관계는 **`deleteRelationship`이 자식 FK 컬럼을 일부러 보존**하는데, 단축키가 무심코
`deleteColumnCascade`를 쓰면 같은 「관계 삭제」가 진입점에 따라 다른 결과를 낸다.

### D3. 관계는 복사하지 않는다

**근거:** 관계는 부모·자식 두 테이블과 컬럼 매핑에 의존한다. 붙여넣을 때 어느 테이블에 붙일지가
정해지지 않는다. 클립보드 사이클도 같은 이유로 *"관계는 복사하지 않고 인덱스만 따라간다"* 를
결정했다.

### D4. 그룹 단축키는 넣지 않는다

`selectedGroupId`가 선택된 채 `Delete`를 눌러도 지금처럼 아무 일도 일어나지 않는다.

**근거:** 요청에 없다. 그룹 삭제는 소속 테이블의 `groupId`를 함께 정리해야 해서 메모·관계와 성질이
다르다.

### D5. 메모 다중 선택은 넣지 않는다

`selectedNoteId`는 단일 필드로 둔다. 클립보드 타입은 배열(`notes: ClipboardNote[]`)이지만 실제로
담기는 것은 항상 1건이다.

**근거:** 다중으로 넓히면 store · 캔버스 선택 델타 · presence 프로토콜까지 번진다. 3.13이 테이블만
배열로 만든 것도 그 비용 때문이다. **타입을 배열로 두는 것은** 나중에 넓힐 때 클립보드 포맷을 다시
바꾸지 않기 위해서다.

---

## 3. 구조

### 3.1 선택은 항상 한 종류다 — 분기가 단순하다

⚠️ **이 설계가 서는 근거다.** `store.ts:221-223`의 `selectRelationship`·`selectNote`·`selectGroup`이
모두 `...CLEARED_SELECTION`을 앞에 두므로 **메모를 고르면 테이블 선택이 비워지고 그 반대도
마찬가지다.** 「테이블과 메모가 동시에 선택된」 상태가 구조적으로 존재하지 않는다.

따라서 우선순위를 정할 필요가 없고, 분기를 앞에 두면 된다:

```ts
if (s.selectedNoteId) { /* 메모 경로 */ return }
if (s.selectedRelationshipId) { /* 관계 경로 */ return }
/* 기존 테이블·컬럼 경로 */
```

### 3.2 삭제

`Delete`/`Backspace` 핸들러 맨 앞에 두 분기를 넣는다. 확인 다이얼로그는 **없다** — 기존 정책이
「테이블 2개 이상」만 확인을 거치고(사이드바 설계 §7), 메모·관계는 단일 선택이라 그 조건에 닿지 않는다.

`canEdit` 가드는 기존과 같다.

### 3.3 클립보드 포맷 확장

```ts
export type ClipboardNote = { content: string; color: string; position: { x: number; y: number } }

export type ClipboardPayload =
  | { __erdd: 1; v: number; kind: 'tables'; tables: ClipboardTable[] }
  | { __erdd: 1; v: number; kind: 'columns'; columns: ClipboardColumn[] }
  | { __erdd: 1; v: number; kind: 'notes'; notes: ClipboardNote[] }      // 신규
```

`parseClipboard`(`clipboard.ts:141-147`)에 `'notes'` 분기를 더한다. 알 수 없는 `kind`는 이미 `null`을
반환하므로 방어는 그대로다.

⚠️ **`CLIPBOARD_VERSION`을 올리지 않는다.** `parseClipboard`가 `raw['v'] !== CLIPBOARD_VERSION`이면
버린다 — 올리면 사용자가 이미 복사해 둔 테이블·컬럼이 전부 무효가 된다. **kind 추가는 하위호환이다**
(옛 페이로드는 그대로 읽히고, 새 페이로드를 옛 코드가 읽으면 `null`로 안전하게 무시된다).

**`id`는 싣지 않는다**(기존 규약 — 붙여넣기가 새로 발급한다). **`position`은 싣는다** — 붙여넣기가
원본 자리에서 `PASTE_OFFSET`만큼 밀어 놓으려면 기준점이 필요하고, 테이블 페이로드도 같은 이유로
`position`을 담는다. 메모는 참조가 없어 도메인·커스텀 항목처럼 **이름으로 재연결할 것도 없으므로**
필드는 셋(`content`·`color`·`position`)으로 끝난다.

### 3.4 붙여넣기

```ts
export function planPasteNoteIds(payload, newId): string[]
export function pasteNotes(model, payload, { ids, offset }): ProjectModel
```

- **id는 producer 밖에서 발급한다**(`planPasteTableIds`와 같은 형태 — `use-model.ts`가 producer를
  정확히 한 번 부르는 것에 기대지 않기 위해서다).
- 위치는 **페이로드의 `position` + `PASTE_OFFSET`(40,40)**. 테이블 붙여넣기와 같은 규칙이다.
  ⚠️ **다른 프로젝트에 붙여넣으면 그 좌표가 그 프로젝트와 무관한 자리일 수 있다.** 테이블 붙여넣기가
  이미 같은 성질을 갖고 있고(수용된 기존 동작) 메모도 그대로 따른다 — 사용자가 보고 끌어 옮긴다.
- 붙여넣은 뒤 `selectNote(새 id)`로 선택을 옮긴다(테이블 붙여넣기가 `selectTables`로 하는 것과 대칭).

### 3.5 잘라내기

복사와 삭제를 **한 mutation**으로 낸다(Revision 1건 · undo 1회). 기존 `Cmd+X`가 테이블·컬럼에
하는 것과 같은 형태이고, `writeText`는 fire-and-forget이다(쓰기가 거절돼도 삭제는 진행 — undo로
복구된다. 기존 동작과 같은 수용된 한계다).

---

## 4. 테스트

`apps/web/src/editor/use-shortcuts.test.tsx`(기존 파일)에 추가한다.

- **삭제** — 메모 선택 후 `Delete`로 모델에서 사라지고 선택이 비워진다 / 관계도 같다
- ⚠️ **관계 삭제가 자식 FK 컬럼을 보존한다** — `deleteRelationship`과 `deleteColumnCascade`를 맞바꾸면
  빨개지도록 **컬럼 존재를 단언**한다. 이것이 D2의 급소다
- **복사** — 메모 선택 후 `Cmd+C`면 클립보드에 `kind:'notes'` JSON이 들어간다
- **붙여넣기** — 그 JSON을 `paste` 이벤트로 넣으면 메모가 하나 늘고 좌표가 offset만큼 밀린다
- **잘라내기** — `mutate` 호출이 **1회**다(Revision 1건)
- **읽기 전용** — `canEdit:false`면 삭제·잘라내기·붙여넣기가 안 되고 복사만 된다(기존 정책)
- **다이얼로그 열림** — 기존 `isDialogOpen` 가드가 메모 경로에도 걸린다
- `clipboard.test.ts` — `parseClipboard`가 `kind:'notes'`를 받고, **버전이 다르면 여전히 `null`**이다

**잠기지 않는 것 (명시)**
- 「메모가 선택된 채 Delete를 눌렀을 때 테이블이 지워지지 않는다」는 `CLEARED_SELECTION` 때문에
  **애초에 도달할 수 없는 상태**라 테스트로 구분되지 않는다. 3.1의 근거를 주석으로 남긴다.

---

## 5. 문서

- `docs/manual/user-guide.md` — 단축키 절에 메모·관계선 항목 추가
- `docs/superpowers/HANDOFF.md` — 완료 표 한 줄, 기준선, 6절 이월 정리

---

## 6. 이월 (구현하지 않는다)

- **관계 복사**(D3) · **그룹 단축키**(D4) · **메모 다중 선택**(D5).
- 「메모/관계/그룹이 선택된 상태에서 빈 영역을 박스 드래그하면 그 선택이 풀리지 않는다」(기존 이월,
  캔버스 클립보드 사이클) — 이번 사이클이 메모 단축키를 붙이면서 **그 상태에 머무는 시간이 길어질 수
  있으나** 원인은 `ids === []` 조기 반환이고 이 범위 밖이다.
