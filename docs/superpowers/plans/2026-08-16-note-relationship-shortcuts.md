# 메모·관계선 단축키 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캔버스에서 메모·관계선을 `Delete`로 지우고, 메모를 `Cmd+C`/`Cmd+X`/`Cmd+V`로 복사·잘라내기·붙여넣는다.

**Architecture:** 선택이 항상 한 종류(`CLEARED_SELECTION`)라 `use-shortcuts.ts`의 세 핸들러 앞에 분기를 얹으면 된다. 삭제는 우측 패널 버튼과 **같은 함수**를 부르고, 복사는 기존 클립보드 포맷에 `kind: 'notes'`를 더한다.

**Tech Stack:** React 19 · TypeScript · zustand(`useEditorStore`) · vitest + @testing-library/react

**설계 문서:** `docs/superpowers/specs/2026-08-16-note-relationship-shortcuts-design.md`

## Global Constraints

- **`apps/web` 전용.** `packages/core` · `apps/server` · `packages/cli` · 마이그레이션이 움직이면 범위를 넘은 것이다. core의 `deleteRelationship`은 **부르기만** 한다.
- **`CLIPBOARD_VERSION`을 올리지 않는다**(`clipboard.ts:4`, 현재 `1`). `parseClipboard`가 `raw['v'] !== CLIPBOARD_VERSION`이면 버리므로, 올리면 사용자가 이미 복사해 둔 테이블·컬럼이 전부 무효가 된다. kind 추가는 하위호환이다.
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...`를 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 692 · cli 141 · web 882 · server 200 · typecheck EXIT=0`. 이 트랙은 **web만** 올린다.
- **typecheck는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`. `-s`는 오류가 있어도 출력이 0바이트고, 파이프를 붙이면 `$?`가 tail 것이 된다.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라 — 개발 DB가 통째로 날아간다.** 이 트랙은 **서버 테스트가 필요 없다.** 검증은 `pnpm -C apps/web test`와 `pnpm -r typecheck` 둘이다.
- **작업 디렉터리는 워크트리다.** 최상위 체크아웃에서 파일을 고치지 않는다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `apps/web/src/editor/clipboard.ts` | `ClipboardNote` 타입 · `serializeNotes` · `parseClipboard` 분기 | 수정 |
| `apps/web/src/editor/clipboard.test.ts` | 위 | 수정 |
| `apps/web/src/editor/clipboard-edits.ts` | `planPasteNoteIds` · `pasteNotes` | 수정 |
| `apps/web/src/editor/clipboard-edits.test.ts` | 위 | 수정 |
| `apps/web/src/editor/use-shortcuts.ts` | 삭제 2분기 + 복사/잘라내기/붙여넣기 메모 분기 | 수정 |
| `apps/web/src/editor/use-shortcuts.test.tsx` | 위 | 수정 |
| `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md` | 문서 | 수정 |

---

## Task 1: 클립보드 포맷에 `notes` 추가

**Files:**
- Modify: `apps/web/src/editor/clipboard.ts:38-40`(타입) · `:121` 뒤(직렬화) · `:141-147`(파서)
- Test: `apps/web/src/editor/clipboard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ClipboardNote = { content: string; color: string; position: { x: number; y: number } }
  // ClipboardPayload 에 { __erdd: 1; v: number; kind: 'notes'; notes: ClipboardNote[] } 추가
  export function serializeNotes(model: ProjectModel, noteIds: readonly string[]): ClipboardPayload
  ```

- [ ] **Step 1: 실패 테스트를 쓴다**

`clipboard.test.ts`에 추가한다(그 파일의 기존 import·픽스처를 쓴다 — `buildSampleModel`의 메모는 `n1` / content `'회원 도메인 메모'` / color `'#FFF3B0'` / position `{x:600,y:0}`).

```ts
describe('메모 클립보드', () => {
  it('선택한 메모를 notes 페이로드로 직렬화한다', () => {
    const m = buildSampleModel()
    const payload = serializeNotes(m, ['n1'])
    expect(payload).toEqual({
      __erdd: 1, v: 1, kind: 'notes',
      notes: [{ content: '회원 도메인 메모', color: '#FFF3B0', position: { x: 600, y: 0 } }],
    })
  })

  it('id 는 싣지 않는다', () => {
    const payload = serializeNotes(buildSampleModel(), ['n1'])
    expect(JSON.stringify(payload)).not.toContain('"id"')
  })

  it('없는 id 는 건너뛴다', () => {
    const payload = serializeNotes(buildSampleModel(), ['없음', 'n1'])
    expect(payload.kind === 'notes' && payload.notes).toHaveLength(1)
  })

  it('parseClipboard 가 notes 를 받는다', () => {
    const text = JSON.stringify(serializeNotes(buildSampleModel(), ['n1']))
    const parsed = parseClipboard(text)
    expect(parsed?.kind).toBe('notes')
  })

  // ⚠️ 버전을 올리면 사용자가 이미 복사해 둔 테이블·컬럼이 전부 무효가 된다.
  it('버전이 다르면 여전히 버린다', () => {
    const bad = JSON.stringify({ __erdd: 1, v: 999, kind: 'notes', notes: [] })
    expect(parseClipboard(bad)).toBeNull()
  })

  it('notes 가 배열이 아니면 버린다', () => {
    const bad = JSON.stringify({ __erdd: 1, v: 1, kind: 'notes', notes: 'x' })
    expect(parseClipboard(bad)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/clipboard.test.ts
```
기대: `serializeNotes is not a function`으로 FAIL.

- [ ] **Step 3: 구현한다**

`clipboard.ts`의 타입에 더한다(`ClipboardPayload` 유니온 위):

```ts
/** 메모 한 장. 참조가 없어 이름으로 재연결할 것도 없다 — 세 필드로 끝난다. */
export type ClipboardNote = { content: string; color: string; position: { x: number; y: number } }
```

```ts
export type ClipboardPayload =
  | { __erdd: 1; v: number; kind: 'tables'; tables: ClipboardTable[] }
  | { __erdd: 1; v: number; kind: 'columns'; columns: ClipboardColumn[] }
  | { __erdd: 1; v: number; kind: 'notes'; notes: ClipboardNote[] }
```

`serializeColumns`(`:109-121`) 아래에 더한다:

```ts
/**
 * 메모를 클립보드 페이로드로. id 는 싣지 않고(붙여넣기가 새로 발급한다) position 은 싣는다
 * (붙여넣기가 그 자리에서 PASTE_OFFSET 만큼 밀어 놓는 기준점이다).
 */
export function serializeNotes(model: ProjectModel, noteIds: readonly string[]): ClipboardPayload {
  const notes: ClipboardNote[] = []
  for (const id of noteIds) {
    const n = model.notes[id]
    if (!n) continue
    notes.push({ content: n.content, color: n.color, position: { ...n.position } })
  }
  return { __erdd: 1, v: CLIPBOARD_VERSION, kind: 'notes', notes }
}
```

`parseClipboard`의 두 분기 뒤에 더한다:

```ts
  if (raw['kind'] === 'notes' && Array.isArray(raw['notes'])) {
    return raw as unknown as ClipboardPayload
  }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/clipboard.test.ts
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 신규 6건 PASS, `EXIT=0`.

⚠️ **`ClipboardPayload`가 유니온이라 기존 소비처가 깨질 수 있다** — `payload.kind`로 좁히지 않고 `payload.tables`를 바로 읽는 곳이 있으면 타입 오류가 난다. `pnpm -r typecheck`로 전 패키지를 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/clipboard.ts apps/web/src/editor/clipboard.test.ts && \
git commit -m "feat(web): 클립보드 포맷에 메모(notes)를 더한다

kind 추가는 하위호환이라 CLIPBOARD_VERSION 을 올리지 않는다 — 올리면 사용자가
이미 복사해 둔 테이블·컬럼이 전부 무효가 된다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 2: 메모 붙여넣기

**Files:**
- Modify: `apps/web/src/editor/clipboard-edits.ts`(`planPasteColumnIds`(`:24`) 아래, `pasteColumns`(`:125`) 뒤)
- Test: `apps/web/src/editor/clipboard-edits.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ClipboardNote`
- Produces:
  ```ts
  export function planPasteNoteIds(payload: ClipboardPayload, newId: () => string): string[]
  export function pasteNotes(
    model: ProjectModel, payload: ClipboardPayload,
    { ids, offset }: { ids: readonly string[]; offset: { x: number; y: number } },
  ): ProjectModel
  ```

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
describe('메모 붙여넣기', () => {
  const payload = (): ClipboardPayload => ({
    __erdd: 1, v: 1, kind: 'notes',
    notes: [{ content: '메모A', color: '#FFF3B0', position: { x: 100, y: 50 } }],
  })

  it('메모 수만큼 id 를 발급한다', () => {
    let n = 0
    expect(planPasteNoteIds(payload(), () => `id${++n}`)).toEqual(['id1'])
  })

  it('다른 kind 면 빈 배열이다', () => {
    const cols: ClipboardPayload = { __erdd: 1, v: 1, kind: 'columns', columns: [] }
    expect(planPasteNoteIds(cols, () => 'x')).toEqual([])
  })

  it('offset 만큼 밀어 메모를 만든다', () => {
    const m = buildSampleModel()
    const before = Object.keys(m.notes).length
    const next = pasteNotes(m, payload(), { ids: ['nn1'], offset: { x: 40, y: 40 } })
    expect(Object.keys(next.notes)).toHaveLength(before + 1)
    expect(next.notes['nn1']).toEqual({
      id: 'nn1', content: '메모A', color: '#FFF3B0', position: { x: 140, y: 90 },
    })
  })

  it('원본 모델을 변형하지 않는다', () => {
    const m = buildSampleModel()
    const before = Object.keys(m.notes).length
    pasteNotes(m, payload(), { ids: ['nn1'], offset: { x: 40, y: 40 } })
    expect(Object.keys(m.notes)).toHaveLength(before)
  })

  it('id 가 모자라면 그만큼만 만든다', () => {
    const two: ClipboardPayload = {
      __erdd: 1, v: 1, kind: 'notes',
      notes: [
        { content: 'A', color: '#fff', position: { x: 0, y: 0 } },
        { content: 'B', color: '#fff', position: { x: 0, y: 0 } },
      ],
    }
    const next = pasteNotes(buildSampleModel(), two, { ids: ['only'], offset: { x: 0, y: 0 } })
    expect(next.notes['only']?.content).toBe('A')
    expect(Object.values(next.notes).filter((n) => n.content === 'B')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/clipboard-edits.test.ts
```
기대: `planPasteNoteIds is not a function`으로 FAIL.

- [ ] **Step 3: 구현한다**

`planPasteColumnIds` 아래:

```ts
export function planPasteNoteIds(payload: ClipboardPayload, newId: () => string): string[] {
  if (payload.kind !== 'notes') return []
  return payload.notes.map(() => newId())
}
```

파일 끝(`pasteColumns` 뒤):

```ts
/**
 * 메모를 붙여넣는다. 원본 좌표에서 offset 만큼 밀어 놓는다.
 * ⚠️ 다른 프로젝트에 붙여넣으면 그 좌표가 그 프로젝트와 무관한 자리일 수 있다 —
 * 테이블 붙여넣기와 같은 성질이고 사용자가 보고 끌어 옮긴다(설계 3.4).
 */
export function pasteNotes(
  model: ProjectModel, payload: ClipboardPayload,
  { ids, offset }: { ids: readonly string[]; offset: { x: number; y: number } },
): ProjectModel {
  if (payload.kind !== 'notes') return model
  const notes = { ...model.notes }
  payload.notes.forEach((n, i) => {
    const id = ids[i]
    if (id === undefined) return
    notes[id] = {
      id, content: n.content, color: n.color,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
    }
  })
  return { ...model, notes }
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/clipboard-edits.test.ts
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 신규 5건 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/clipboard-edits.ts apps/web/src/editor/clipboard-edits.test.ts && \
git commit -m "feat(web): 메모 붙여넣기 순수 함수를 더한다

id 는 producer 밖에서 발급한다 — 안에서 부르면 serializeMutation 재실행에서
다른 id 가 나온다(테이블·컬럼과 같은 규약).

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: 단축키 배선

**Files:**
- Modify: `apps/web/src/editor/use-shortcuts.ts`(`onKeyDown`의 세 분기 + `onPaste`)
- Test: `apps/web/src/editor/use-shortcuts.test.tsx`

**Interfaces:**
- Consumes: Task 1·2의 `serializeNotes`·`planPasteNoteIds`·`pasteNotes`, `note-edits.ts`의 `removeNote`, core의 `deleteRelationship`
- Produces: 없음(내부 배선)

⚠️ **분기는 기존 `nothingSelected` 가드보다 앞에 둔다.** 메모·관계가 선택된 상태에서는 `selectedTableIds`가 비어 있으므로(`CLEARED_SELECTION`) 뒤에 두면 그 가드에 걸려 죽는다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`use-shortcuts.test.tsx`의 `describe('useEditorShortcuts', …)` 안에 추가한다.

⚠️ **그 파일의 실제 패턴을 따라라 — 아래가 실측한 형태다.**
- `beforeEach`(95-101행)가 이미 **`writeText` 리셋 + `navigator` stub + `setLoaded(buildSampleModel())` +
  `grantEditPermission()`** 을 한다. 케이스 안에서 그것들을 다시 하지 마라.
- `writeText`는 **파일 상단의 공유 `vi.fn()`**(93행)이다. 케이스마다 새로 만들지 않는다.
- 키 이벤트는 `document.dispatchEvent(new KeyboardEvent(...))` 다(`fireEvent.keyDown`이 아니다).
- paste 는 `new Event('paste', …)` + `Object.defineProperty(e, 'clipboardData', …)` + `dispatchEvent` 다.
- 뮤테이션이 필요한 케이스는 `mockTrpcFetch({ 'model.mutate': … })` 또는 `mockModelMutate()`를 케이스
  안에서 부른다.

픽스처: 메모 `n1`(content `'회원 도메인 메모'`), 관계 `r1`(부모 `t1` · 자식 `t2`, 매핑 `childColumnId: 'c4'`).

```tsx
  it('메모를 선택하고 Delete로 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectNote('n1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.notes['n1']).toBeUndefined())
    expect(useEditorStore.getState().selectedNoteId).toBeNull()
  })

  it('관계를 선택하고 Delete로 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectRelationship('r1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })

  // ⚠️ 설계 D2의 급소. 자식 FK 컬럼을 함께 지우는 함수로 바꾸면 이 케이스가 빨개진다.
  it('관계를 지워도 자식 FK 컬럼은 남는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectRelationship('r1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.relationships['r1']).toBeUndefined())
    expect(useEditorStore.getState().model.columns['c4']).toBeDefined()
  })

  it('Backspace도 메모를 지운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectNote('n1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.notes['n1']).toBeUndefined())
  })

  it('메모를 선택하고 Cmd+C를 누르면 notes 페이로드가 쓰인다', async () => {
    useEditorStore.getState().selectNote('n1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const payload = JSON.parse(writeText.mock.calls[0]![0] as string)
    expect(payload.kind).toBe('notes')
    expect(payload.notes[0].content).toBe('회원 도메인 메모')
  })

  it('메모 Cmd+X는 복사와 삭제를 한 뮤테이션으로 낸다', async () => {
    const fetchMock = mockModelMutate()
    useEditorStore.getState().selectNote('n1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true }))
    await waitFor(() => expect(useEditorStore.getState().model.notes['n1']).toBeUndefined())
    expect(writeText).toHaveBeenCalled()
    expect(countModelMutate(fetchMock)).toBe(1)
  })

  it('메모 붙여넣기가 offset만큼 밀고 새 메모를 선택한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderHarness()
    const payload = {
      __erdd: 1, v: 1, kind: 'notes',
      notes: [{ content: '붙인메모', color: '#fff', position: { x: 10, y: 20 } }],
    }
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => JSON.stringify(payload) } })
    document.dispatchEvent(e)
    await waitFor(() => {
      const added = Object.values(useEditorStore.getState().model.notes)
        .find((n) => n.content === '붙인메모')
      expect(added?.position).toEqual({ x: 50, y: 60 })
    })
    const added = Object.values(useEditorStore.getState().model.notes)
      .find((n) => n.content === '붙인메모')!
    expect(useEditorStore.getState().selectedNoteId).toBe(added.id)
  })

  it('읽기 전용이면 메모를 지우지 못하고 복사만 된다', async () => {
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().selectNote('n1')
    renderHarness()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(useEditorStore.getState().model.notes['n1']).toBeDefined()
  })

  it('다이얼로그가 열려 있으면 메모 삭제가 막힌다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().selectNote('n1')
    renderHarness({ withDialog: true })
    openDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useEditorStore.getState().model.notes['n1']).toBeDefined()
  })
```

⚠️ **`selectNote('n1')`은 `renderHarness()` 앞에 부른다** — 그 파일의 기존 케이스들이 전부 그 순서다
(`select('t2')` → `renderHarness()`).

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/use-shortcuts.test.tsx -t '메모·관계선 단축키'
```
기대: 삭제·복사·붙여넣기가 전부 no-op이라 FAIL.

- [ ] **Step 3: 구현한다**

import를 더한다:

```ts
import { deleteColumnCascade, deleteRelationship, type ProjectModel } from '@erdd/core'
import { removeNote } from './note-edits.js'
import { parseClipboard, serializeColumns, serializeNotes, serializeTables } from './clipboard.js'
import {
  pasteColumns, pasteNotes, pasteTables,
  planPasteColumnIds, planPasteNoteIds, planPasteTableIds,
} from './clipboard-edits.js'
```

**Cmd+C** — `nothingSelected` 가드 **앞**에 넣는다:

```ts
      if (mod && e.key.toLowerCase() === 'c') {
        // 선택은 항상 한 종류다(store의 CLEARED_SELECTION) — 우선순위를 정할 필요가 없다.
        if (s.selectedNoteId) {
          e.preventDefault()
          void navigator.clipboard.writeText(JSON.stringify(serializeNotes(model, [s.selectedNoteId])))
          return
        }
        if (nothingSelected) return
        …기존…
      }
```

**Cmd+X**:

```ts
      if (mod && e.key.toLowerCase() === 'x') {
        if (s.selectedNoteId) {
          if (!canEdit) return
          e.preventDefault()
          const noteId = s.selectedNoteId
          void navigator.clipboard.writeText(JSON.stringify(serializeNotes(model, [noteId])))
          void mutate((m) => removeNote(m, noteId), { summary: '메모 잘라내기' })
          s.selectNote(null)
          return
        }
        if (!canEdit || nothingSelected) return
        …기존…
      }
```

**Delete / Backspace** — ⚠️ 기존 첫 줄이 `if (!canEdit || nothingSelected) return`이므로 **그 앞**에 넣는다:

```ts
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedNoteId) {
          if (!canEdit) return
          e.preventDefault()
          const noteId = s.selectedNoteId
          s.selectNote(null)
          void mutate((m) => removeNote(m, noteId), { summary: '메모 삭제' })
          return
        }
        if (s.selectedRelationshipId) {
          if (!canEdit) return
          e.preventDefault()
          const relId = s.selectedRelationshipId
          s.selectRelationship(null)
          // ⚠️ deleteRelationship 이다 — 자식 FK 컬럼을 일부러 보존한다(설계 D2).
          // deleteColumnCascade 로 바꾸면 같은 「관계 삭제」가 진입점에 따라 다른 결과를 낸다.
          void mutate((m) => deleteRelationship(m, relId), { summary: '관계 삭제' })
          return
        }
        if (!canEdit || nothingSelected) return
        …기존…
      }
```

**onPaste** — `columns` 분기 뒤, `tables` 기본 경로 앞:

```ts
      if (payload.kind === 'notes') {
        const ids = planPasteNoteIds(payload, newId)      // producer 밖에서 발급
        void mutate((m) => pasteNotes(m, payload, { ids, offset: PASTE_OFFSET }),
          { summary: '메모 붙여넣기' })
        const first = ids[0]
        if (first !== undefined) s.selectNote(first)
        return
      }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/use-shortcuts.test.tsx
pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 신규 10건 PASS, 전체 실패 0, `EXIT=0`.

- [ ] **Step 5: D2 의 급소가 진짜 잠기는지 실증한다**

`deleteRelationship(m, relId)`을 **`deleteColumnCascade(deleteRelationship(m, relId), 'c4')`** 로
잠시 바꾸고 돌린다.

⚠️ **`deleteColumnCascade(m, 'c4')` 단독으로 바꾸지 마라** — 그러면 관계가 아예 안 지워져서 앞의 두
케이스(「관계를 선택하고 Delete로 지운다」·「자식 FK 컬럼은 남는다」의 첫 단언)가 먼저 깨진다.
그건 "FK 보존이 잠겼는가"를 보여 주지 못한다. **관계는 지우되 컬럼도 함께 지우는** 형태여야
정확히 한 건만 빨개진다.

⚠️ **치환이 실제로 적용됐는지 먼저 확인해라:**

```bash
grep -c "deleteColumnCascade(deleteRelationship" apps/web/src/editor/use-shortcuts.ts   # 1 이어야 한다
pnpm -C apps/web exec vitest run src/editor/use-shortcuts.test.tsx -t '자식 FK 컬럼은 남는다'
```
기대: **그 1건만 FAIL**(관계 삭제 케이스는 여전히 green). 되돌리고 PASS를 확인한 뒤 **결과를
보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/use-shortcuts.ts apps/web/src/editor/use-shortcuts.test.tsx && \
git commit -m "feat(web): 메모·관계선을 키보드로 지우고 메모를 복사한다

선택이 항상 한 종류라 분기를 nothingSelected 가드 앞에 얹으면 된다. 삭제는 우측
패널 버튼과 같은 함수를 쓴다 — 특히 관계는 자식 FK 컬럼을 보존하는
deleteRelationship 이라 진입점에 따라 결과가 갈리면 안 된다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: 문서와 최종 검증

**Files:**
- Modify: `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 매뉴얼을 고친다**

```bash
grep -n "단축키\|Cmd+C\|Delete" docs/manual/user-guide.md | head -20
```
단축키 절에 메모·관계선을 더한다 — **메모는 삭제·복사·잘라내기·붙여넣기, 관계선은 삭제만**(복사가 없는 이유도 한 줄로: 두 테이블에 의존해 붙여넣을 대상이 정해지지 않는다).

- [ ] **Step 2: 최종 검증**

```bash
pnpm -C apps/web test
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -r typecheck; echo "EXIT=$?"
```
서버 테스트는 **돌리지 않는다**(이 트랙은 서버를 안 건드린다). 🔥 `. ./.env` 금지.
`core`·`cli`는 **무변경이어야 한다**(각각 692·141). 움직였으면 범위를 넘은 것이다.

- [ ] **Step 3: HANDOFF 를 갱신한다**

1. **1절 완료 표**에 한 줄. 담을 것: 선택이 항상 한 종류라 분기가 단순하다는 것(`CLEARED_SELECTION`), 삭제가 패널 버튼과 **같은 함수**라는 것과 **관계는 `deleteRelationship`(FK 보존)** 이라는 것, `CLIPBOARD_VERSION`을 올리지 않은 이유.
2. **테스트 기준선**을 실측값으로 갱신하고 직전 기준선(`core 692 · cli 141 · web 882 · server 200`)과 함께 적는다. **core·cli·server 무변경**을 명시한다.
3. **6절 이월** — **새로 적는 것:** 관계 복사 없음(D3) · 그룹 단축키 없음(D4) · 메모 다중 선택 없음(D5).
4. **1절 「다음 작업」** — 남은 묶음 **B: 그룹 별칭 + 테이블명 형식 템플릿**을 적는다(`TableGroupSchema`에 필드 추가 → 마이그레이션 + 등록처 6~8곳, 그리고 "저장된 물리명 vs 조합해서 보여 주는 물리명"이 갈리는 새 개념).

- [ ] **Step 4: 커밋**

```bash
git add docs/manual/user-guide.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 메모·관계선 단축키를 문서에 반영한다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 확장이 하나뿐이라 사용자가 돈다)

1. 메모를 클릭해 고르고 `Delete` — 지워지는지.
2. 메모를 고르고 `Cmd+C` → `Cmd+V` — 원본에서 오른쪽 아래로 밀린 복제가 생기고 **그것이 선택되는지**.
3. 관계선을 클릭해 고르고 `Delete` — 선만 사라지고 **자식 테이블의 FK 컬럼은 남는지**(이번 사이클의 급소).
4. 테이블을 고른 상태에서 `Delete` — 기존 동작이 그대로인지(회귀 확인).
5. 다이얼로그(예: 「파일 ▾ → 내보내기」)를 열고 `Delete` — **뒤에 있는 메모가 지워지지 않는지**.
