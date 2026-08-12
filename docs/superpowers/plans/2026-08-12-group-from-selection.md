# 선택 테이블로 새 그룹 만들기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**설계:** [`docs/superpowers/specs/2026-08-12-group-from-selection-design.md`](../specs/2026-08-12-group-from-selection-design.md) — 결정의 근거는 전부 거기 있다. 이 계획과 어긋나면 설계가 우선이다.

**Goal:** 테이블을 여러 개 골라 둔 상태에서 우측 사이드바 버튼 하나로 그것들을 담는 새 그룹을 만든다.

**Architecture:** "새 그룹 하나 만들기"의 규칙(권한·미사용 최소 번호 이름·다음 색·그룹 뷰 좌표 비움)을 신설 `apps/web/src/editor/group-edits.ts`의 `createGroupWith` 한 곳에 모으고, 우측 `BulkPanel`과 좌측 `TableTree`가 **같은 함수**를 부른다. 그룹 생성과 테이블 배정은 **한 producer** 안에 있어 Revision 1건 = `cmd+Z` 1회다. 좌표는 건드리지 않는다.

**Tech Stack:** React 19 + Zustand(`useEditorStore`) + tRPC, Vitest + Testing Library. 모델 변경은 전부 `useModelMutation(projectId)`의 producer 패턴(UI가 "다음 모델"을 만들고 `diffModels`가 op를 도출).

## Global Constraints

- **`packages/core`·`apps/server`·`packages/cli` 를 한 줄도 고치지 않는다.** 변경 파일은 `apps/web/src/editor/` 안의 5개(+테스트)뿐이다. 그 셋이 움직였다면 범위를 넘은 것이다.
- **마이그레이션 없음.** DB 스키마·서버 프로시저 변경 없음.
- 응답·커밋 메시지·주석·문서는 **한국어**로 쓴다.
- 커밋은 **경로 지정 커밋**으로 한다: `git commit -m "..." -- <경로들>`. `git add -A`/`git commit -a` 금지.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- `planGroupMove`를 **부르지 않는다**(설계 D2). 새 그룹에는 기준 bbox가 없어 정의상 빈 배열이고, 부르지 않아야 "제자리가 의도"임이 코드에 드러난다.
- 새 그룹 이름은 **미사용 최소 번호** `그룹N`, 색은 `nextGroupColor(사용 중인 색들)` — 좌측 「그룹 추가」와 같은 규칙이다.
- typecheck 판정은 **종료코드로** 한다. `pnpm -s -r typecheck`의 출력만 보고 판정하면 안 된다(`-s`가 자식 출력을 삼켜 오류가 있어도 0바이트에 종료코드만 1이다). 파이프(`| tail`)를 붙이면 `$?`가 파이프 끝의 종료코드가 되어 또 오판한다.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/web/src/editor/use-model.ts` | 모델 변경의 표준 진입점 | `Mutate` 타입 선언을 여기로 올려 export (2줄) |
| `apps/web/src/editor/group-edits.ts` | **신설.** "새 그룹 하나 만들기"의 규칙 한 곳 | 신설 |
| `apps/web/src/editor/group-edits.test.ts` | **신설.** 위 함수의 계약 | 신설 |
| `apps/web/src/editor/bulk-panel.tsx` | 우측 일괄 작업 패널 + `applyGroupMove` | 로컬 `Mutate` 선언 제거 → import, 버튼 1개 추가 |
| `apps/web/src/editor/bulk-panel.test.tsx` | 위 패널 | 테스트 3건 추가 |
| `apps/web/src/editor/table-tree.tsx` | 좌측 사이드바 트리 | `onAddGroup` 본문을 `createGroupWith` 호출로 교체 |
| `docs/manual/user-guide.md` | 제품 사용자용 매뉴얼 | 8절에 새 진입점 |
| `docs/superpowers/HANDOFF.md` | 인계 문서 | 1절 완료 표 · 테스트 기준선 · 6절 이월 |

`group-edits.ts`를 따로 두는 이유: `bulk-panel.tsx`에 넣으면 `table-tree.tsx → bulk-panel.tsx` import가 하나 더 생겨(이미 `applyGroupMove`로 하나 있다) 사이드바가 우측 패널 모듈에 더 얽힌다. 그룹 편집 규칙은 어느 패널의 것도 아니다.

---

## 착수 준비 (Task 1 전에 한 번)

- [ ] **워크트리 안에 있는지 확인한다.** `git rev-parse --show-toplevel`이 `.worktrees/…` 아래를 가리켜야 한다. 최상위 체크아웃(`/Users/jang2162/IdeaProjects/ERDD`)이면 **멈추고 보고한다** — 최상위는 IDE·dev 서버·다른 세션이 공유하는 자원이다.
- [ ] **의존성을 설치한다.** 워크트리에서 `post-checkout` 훅이 안 돌 수 있다.

```bash
pnpm install
```

- [ ] **기준선을 실측한다.** 이 계획이 손댈 스위트는 web 하나다.

```bash
pnpm -C apps/web test 2>&1 | tail -5
```

기대: `Tests  719 passed`. **숫자를 적어 둔다** — 마지막에 증가분을 보고해야 한다. 719가 아니면 멈추고 보고한다(계획이 낡았거나 워크트리가 오래된 base를 물었다).

---

### Task 1: `createGroupWith` — 새 그룹 하나 만들기 규칙의 소재지

**Files:**
- Modify: `apps/web/src/editor/use-model.ts:167` (`useModelMutation` 정의 바로 뒤)
- Modify: `apps/web/src/editor/bulk-panel.tsx:15` (로컬 `Mutate` 선언 → import)
- Create: `apps/web/src/editor/group-edits.ts`
- Test: `apps/web/src/editor/group-edits.test.ts` (신설)

**Interfaces:**
- Consumes: `useModelMutation`(기존), `createGroup`·`setTableGroup`(`@erdd/core`), `clearTableGroupPosition`(`./model-edits.js`), `newId`(`./uid.js`), `nextGroupColor`(`./group-palette.js`), `useEditorStore`(`./store.js`)
- Produces:
  - `export type Mutate = ReturnType<typeof useModelMutation>` (`use-model.ts`)
  - `export function createGroupWith(mutate: Mutate, tableIds: readonly string[]): string | null` (`group-edits.ts`) — Task 2·3이 부른다

- [ ] **Step 1: `Mutate` 타입을 `use-model.ts`로 올린다**

`apps/web/src/editor/use-model.ts`의 `useModelMutation` 함수가 끝나는 자리(167행 `}` 바로 뒤)에 붙인다.

```ts
/**
 * `useModelMutation`이 돌려주는 함수의 타입. 컴포넌트 밖의 편집 헬퍼(`applyGroupMove`·
 * `createGroupWith`)가 mutate를 인자로 받으므로 여러 모듈이 이 타입을 쓴다 — 선언은 출처인
 * 여기 하나다.
 */
export type Mutate = ReturnType<typeof useModelMutation>
```

- [ ] **Step 2: `bulk-panel.tsx`의 로컬 선언을 import로 바꾼다**

`apps/web/src/editor/bulk-panel.tsx:6`의 import를 고치고,

```ts
import { useModelMutation, type Mutate } from './use-model.js'
```

`:15`의 로컬 선언 한 줄을 **지운다**.

```ts
type Mutate = ReturnType<typeof useModelMutation>   // ← 삭제
```

- [ ] **Step 3: typecheck로 이 리팩터가 무해한지 확인한다**

```bash
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

기대: `EXIT=0`.

- [ ] **Step 4: 실패하는 테스트를 쓴다**

`apps/web/src/editor/group-edits.test.ts`를 새로 만든다. **컴포넌트를 렌더하지 않는다** — `createGroupWith`는 `mutate`를 인자로 받는 평범한 함수라 가짜 mutate로 producer를 붙잡아 계약만 본다.

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import type { Mutate } from './use-model.js'
import { createGroupWith } from './group-edits.js'

/**
 * producer와 summary만 붙잡아 두는 가짜 mutate. 서버 제출·낙관 반영 없이 **producer가 만드는
 * 모델**을 직접 본다 — 이 함수의 계약이 거기에 전부 들어 있다.
 */
function fakeMutate() {
  const calls: { producer: (m: ProjectModel) => ProjectModel; summary?: string }[] = []
  const mutate = ((producer: (m: ProjectModel) => ProjectModel, opts?: { summary?: string }) => {
    calls.push({ producer, summary: opts?.summary })
    return Promise.resolve('applied' as const)
  }) as Mutate
  return { mutate, calls }
}

afterEach(() => { useEditorStore.getState().reset() })

describe('createGroupWith', () => {
  it('새 그룹을 만들고 주어진 테이블 전원을 그 그룹에 넣는다 — producer 하나로(undo 1회)', () => {
    // 픽스처: t1·t2는 g1(회원관리) 소속이다.
    grantEditPermission()
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, ['t1', 't2'])

    expect(id).not.toBeNull()
    expect(calls).toHaveLength(1)   // 생성 + 배정이 한 Revision
    const next = calls[0]!.producer(buildSampleModel())
    expect(next.tableGroups[id!]).toBeDefined()
    expect(next.tables['t1']?.groupId).toBe(id)
    expect(next.tables['t2']?.groupId).toBe(id)
    expect(calls[0]!.summary).toBe('그룹 추가 (테이블 2개)')
  })

  it('이름은 미사용 최소 번호다 — 그룹1·그룹3이 있으면 그룹2', () => {
    grantEditPermission()
    const m = buildSampleModel()
    m.tableGroups = {
      a: { id: 'a', name: '그룹1', color: '#111111', comment: null },
      b: { id: 'b', name: '그룹3', color: '#222222', comment: null },
    }
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(m)
    expect(next.tableGroups[id!]?.name).toBe('그룹2')
  })

  it('이름·색을 producer가 받은 모델에서 계산한다 — store 스냅샷이 아니다', () => {
    // 낙관적 체인에서 앞선 뮤테이션이 이미 「그룹1」을 만들었을 수 있다. store에는 아직 없고
    // producer가 받는 모델에는 있는 상태가 정확히 그것이다 — 그때 이름이 겹치면 안 된다.
    // setLoaded → grantEditPermission 순서다(다른 스위트와 같다). setLoaded가 권한을 다시
    // 세우지는 않지만, 순서를 뒤집어 두면 그런 변경이 생겼을 때 이 파일만 조용히 갈린다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    const ahead = buildSampleModel()
    ahead.tableGroups = { ...ahead.tableGroups, z: { id: 'z', name: '그룹1', color: '#333333', comment: null } }
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(ahead)
    expect(next.tableGroups[id!]?.name).toBe('그룹2')
  })

  it('이동 대상 전원의 그룹 뷰 좌표를 비운다 — 남기면 새 그룹 뷰에서 멤버가 갈라진다', () => {
    grantEditPermission()
    const m = buildSampleModel()
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(m.tables['t1']?.groupPosition).not.toBeNull()
    const { mutate, calls } = fakeMutate()

    createGroupWith(mutate, ['t1', 't2'])

    const next = calls[0]!.producer(m)
    expect(next.tables['t1']?.groupPosition).toBeNull()
    expect(next.tables['t2']?.groupPosition).toBeNull()
  })

  it('좌표는 건드리지 않는다 — 테이블은 제자리에 두고 색상 영역만 씌운다', () => {
    grantEditPermission()
    const m = buildSampleModel()
    const before = { t1: m.tables['t1']!.position, t2: m.tables['t2']!.position }
    const { mutate, calls } = fakeMutate()

    createGroupWith(mutate, ['t1', 't2'])

    const next = calls[0]!.producer(m)
    expect(next.tables['t1']?.position).toEqual(before.t1)
    expect(next.tables['t2']?.position).toEqual(before.t2)
  })

  it('tableIds가 비면 멤버 없는 그룹을 만든다 — 좌측 「그룹 추가」의 경로다', () => {
    grantEditPermission()
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(buildSampleModel())
    expect(next.tableGroups[id!]).toBeDefined()
    expect(Object.values(next.tables).filter((t) => t.groupId === id)).toHaveLength(0)
    expect(calls[0]!.summary).toBe('그룹 추가')
  })

  it('편집 권한이 없으면 null을 돌려주고 아무것도 제출하지 않는다', () => {
    // grantEditPermission을 부르지 않는다 — store 기본값은 fail-closed(canEdit=false)다.
    const { mutate, calls } = fakeMutate()

    expect(createGroupWith(mutate, ['t1'])).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
```

세 번째 케이스가 쓰는 `PROJECT_ID`를 import 아래에 둔다.

```ts
const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000dd'
```

- [ ] **Step 5: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/group-edits.test.ts
```

기대: 모듈을 찾지 못해 FAIL (`Failed to resolve import "./group-edits.js"`).

- [ ] **Step 6: `group-edits.ts`를 구현한다**

```ts
import { createGroup, setTableGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { clearTableGroupPosition } from './model-edits.js'
import { newId } from './uid.js'
import { nextGroupColor } from './group-palette.js'
import type { Mutate } from './use-model.js'

/**
 * 새 그룹을 만들고 주어진 테이블을 그 그룹에 넣는다. `tableIds`가 비면 빈 그룹이다
 * (좌측 사이드바 「그룹 추가」가 그 경로다).
 *
 * **"새 그룹 하나 만들기"의 규칙이 전부 여기 있다** — 권한·미사용 최소 번호·다음 색·그룹 뷰 좌표
 * 비움. 진입점이 둘이므로(우측 일괄 패널·좌측 사이드바) 호출자에 두면 같은 사용자 의도가 진입점에
 * 따라 다르게 끝난다. `applyGroupMove`(bulk-panel.tsx)와 같은 형태다.
 *
 * ⚠️ **좌표는 건드리지 않는다.** `planGroupMove`는 *대상 그룹의 기존 멤버* bbox를 기준으로 삼는데
 * 새 그룹에는 기존 멤버가 없어 정의상 빈 배열을 낸다. 부르지 않는 편이 "제자리가 의도"임이
 * 드러나고 컬럼 전수 스캔도 돌지 않는다.
 *
 * 반환값은 새 그룹 id — 권한이 없으면 null. **선택은 건드리지 않는다**(호출자가 `selectGroup`을
 * 부른다). `applyGroupMove`와 마찬가지로 이 함수는 모델만 바꾼다.
 */
export function createGroupWith(mutate: Mutate, tableIds: readonly string[]): string | null {
  // 권한 판정은 여기 한 곳이다. useSubmit도 canEdit을 막지만 그쪽은 **토스트를 띄운다** —
  // 사용자가 하지도 않은 편집으로 에러를 보게 된다.
  if (!useEditorStore.getState().canEdit) return null
  // id는 producer 밖에서 발급한다 — 반환해야 하는 값이기 때문이다.
  const id = newId()
  void mutate((m) => {
    // 이름·색은 **producer가 받은 모델**에서 계산한다. store 스냅샷을 쓰면 낙관적 체인에서 앞선
    // 뮤테이션이 만든 그룹을 못 보고 이름·색이 겹친다.
    const groups = Object.values(m.tableGroups)
    const usedNames = new Set(groups.map((g) => g.name))
    // 개수 기반이 아니라 미사용 최소 번호를 찾는다(삭제 후 재추가 시 이름 충돌 방지).
    let n = 1
    while (usedNames.has(`그룹${n}`)) n++
    let next = createGroup(m, {
      id, name: `그룹${n}`, color: nextGroupColor(groups.map((g) => g.color)),
    })
    for (const tid of tableIds) {
      next = setTableGroup(next, tid, id)
      // 옛 그룹 뷰 좌표를 남기면 새 그룹의 그룹 뷰에서 멤버가 갈라진다 — 옛 그룹에 있던 것은 옛
      // 좌표, 미분류였던 것은 폴백 좌표에 선다. 전원 비워야 모두 전체 뷰 좌표로 폴백해 나란히 선다.
      next = clearTableGroupPosition(next, tid)
    }
    return next
  }, { summary: tableIds.length === 0 ? '그룹 추가' : `그룹 추가 (테이블 ${tableIds.length}개)` })
  return id
}
```

- [ ] **Step 7: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/group-edits.test.ts
```

기대: `Tests  7 passed`.

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat: 선택 테이블로 새 그룹을 만드는 createGroupWith 를 만든다

- 새 그룹 생성 규칙(권한·미사용 최소 번호·다음 색·그룹 뷰 좌표 비움)을 group-edits.ts 한 곳에
- 생성과 배정이 한 producer 라 Revision 1건 = undo 1회
- 좌표는 건드리지 않는다 — planGroupMove 는 기준 bbox 가 없어 정의상 빈 배열이라 부르지 않는다
- Mutate 타입 선언을 출처인 use-model.ts 로 올린다

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" -- apps/web/src/editor/group-edits.ts apps/web/src/editor/group-edits.test.ts apps/web/src/editor/use-model.ts apps/web/src/editor/bulk-panel.tsx
```

---

### Task 2: 우측 일괄 패널의 「선택 테이블로 새 그룹」 버튼

**Files:**
- Modify: `apps/web/src/editor/bulk-panel.tsx` (`BulkPanel` 안, 그룹 드롭다운 `</div>`과 삭제 버튼 사이)
- Test: `apps/web/src/editor/bulk-panel.test.tsx` (기존 `describe('BulkPanel')` 안에 3건 추가)

**Interfaces:**
- Consumes: `createGroupWith(mutate, tableIds)` (Task 1), `useEditorStore`의 `selectGroup`
- Produces: 접근성 이름 `선택 테이블로 새 그룹`인 버튼 — Task 4의 매뉴얼 문구가 이 텍스트를 「」로 인용한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/bulk-panel.test.tsx`의 `describe('BulkPanel', …)` 안, `'이미 대상 그룹에 있던 테이블의 그룹 뷰 좌표도 비운다'` 케이스 **뒤**에 붙인다.

```ts
  it('「선택 테이블로 새 그룹」이 선택 전원을 담는 그룹을 만들고 그 그룹을 연다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블로 새 그룹' }))

    await waitFor(() => {
      expect(Object.values(useEditorStore.getState().model.tableGroups)).toHaveLength(2)
    })
    const created = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g1')!
    const tables = useEditorStore.getState().model.tables
    expect(tables['t1']?.groupId).toBe(created.id)
    expect(tables['t2']?.groupId).toBe(created.id)
    // 기존 그룹은 "회원관리"뿐이므로 미사용 최소 번호는 "그룹1".
    expect(created.name).toBe('그룹1')
    // 만든 직후 그 그룹이 열린다 — 이름·색을 그 자리에서 고치는 것이 다음 행동이다.
    expect(useEditorStore.getState().selectedGroupId).toBe(created.id)
    // ⚠️ waitFor로는 "최소 1건"밖에 못 본다. 나갈 것을 다 내보낸 뒤 정확히 1건으로 못 박아야
    // producer를 쪼갠 변경이 잡힌다(위 드롭다운 케이스와 같은 이유).
    await settle()
    expect(calls).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('새 그룹을 만들면 선택 전원의 그룹 뷰 좌표가 비워진다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const model = buildSampleModel()
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(model.tables['t1']?.groupPosition).not.toBeNull()
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블로 새 그룹' }))

    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupPosition).toBeNull()
      expect(tables['t2']?.groupPosition).toBeNull()
    })
    // 전체 뷰 좌표는 그대로다 — 새 그룹은 테이블을 옮기지 않는다(설계 D2).
    expect(useEditorStore.getState().model.tables['t1']?.position)
      .toEqual(buildSampleModel().tables['t1']?.position)
  })
```

읽기 전용 케이스는 **기존 테스트를 넓힌다.** `'읽기 전용이면 이동·삭제 컨트롤이 비활성이다'`에 한 줄을 더한다.

```ts
    expect(screen.getByRole('button', { name: '선택 테이블로 새 그룹' })).toBeDisabled()
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/bulk-panel.test.tsx
```

기대: 새 3건이 FAIL — `Unable to find an accessible element with the role "button" and name "선택 테이블로 새 그룹"`.

- [ ] **Step 3: 버튼을 붙인다**

`bulk-panel.tsx` 상단 import에 더한다.

```ts
import { createGroupWith } from './group-edits.js'
```

`BulkPanel` 본문 위쪽, `const [confirming, setConfirming] = useState(false)` 아래에 store 액션을 꺼낸다.

```ts
  const selectGroup = useEditorStore((s) => s.selectGroup)
```

그룹 드롭다운을 감싼 `<div className="mb-4 grid gap-1.5">…</div>`와 삭제 버튼 사이에 넣는다.

```tsx
      {/*
        드롭다운은 **있는 그룹으로 옮기고**, 이 버튼은 **새 그룹을 만들어** 선택 전원을 담는다.
        만든 직후 `selectGroup`이 우측을 그룹 패널로 바꾸므로 이름·색을 그 자리에서 고친다
        (그 액션이 선택을 비우는 것은 의도다 — 패널은 둘 중 하나만 그린다).
      */}
      <Button variant="outline" className="mb-4 w-full" disabled={!canEdit}
        onClick={() => {
          const id = createGroupWith(mutate, ids)
          if (id !== null) selectGroup(id)
        }}>선택 테이블로 새 그룹</Button>
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/bulk-panel.test.tsx
```

기대: 파일 전체 그린(기존 13건 + 신규 2건 = 15건).

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat: 일괄 패널에 「선택 테이블로 새 그룹」 버튼을 넣는다

- 클릭 한 번에 새 그룹 생성 + 선택 전원 배정(뮤테이션 1건) 후 그 그룹 패널을 연다
- 읽기 전용이면 잠긴다

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" -- apps/web/src/editor/bulk-panel.tsx apps/web/src/editor/bulk-panel.test.tsx
```

---

### Task 3: 좌측 「그룹 추가」를 같은 함수로 옮긴다

동작을 바꾸는 태스크가 아니다. 지금 `table-tree.tsx`의 `onAddGroup` 안에 인라인으로 있는 규칙(id 발급·미사용 최소 번호·다음 색)이 `createGroupWith`와 **중복**이므로 없앤다. 남겨 두면 한쪽만 고쳐질 자리가 그대로 남는다.

**Files:**
- Modify: `apps/web/src/editor/table-tree.tsx:1-13`(import), `:135-144`(`onAddGroup`)
- Test: `apps/web/src/editor/table-tree.test.tsx` — **새로 쓰지 않는다.** `:96`·`:112`의 두 케이스가 이 리팩터의 회귀 가드다(자동 이름·미사용 최소 번호·`selectedGroupId` 세팅).

**Interfaces:**
- Consumes: `createGroupWith(mutate, [])` (Task 1)
- Produces: 없음

- [ ] **Step 1: 회귀 가드가 지금 그린인지 먼저 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/table-tree.test.tsx
```

기대: 전부 PASS. (리팩터 전에 그린을 확인해야 뒤의 빨강이 내 변경 때문인지 알 수 있다.)

- [ ] **Step 2: `onAddGroup`을 교체한다**

```ts
  const onAddGroup = () => {
    // 새 그룹 하나 만들기의 규칙은 createGroupWith 한 곳에 있다 — 우측 일괄 패널의
    // 「선택 테이블로 새 그룹」과 같은 함수다. 여기서는 멤버 없이 만든다.
    const id = createGroupWith(mutate, [])
    if (id !== null) selectGroup(id)
  }
```

import를 정리한다 — `createGroup`·`newId`·`nextGroupColor`가 이 파일에서 더는 쓰이지 않으면 **지운다**(`type Table` import는 남는다).

```ts
import { createGroupWith } from './group-edits.js'
```

- [ ] **Step 3: 회귀 가드가 여전히 그린인지 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/table-tree.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

기대: 전부 PASS · `EXIT=0`. **여기서 빨개지면 리팩터가 동작을 바꾼 것이다** — 계획대로 되돌리고 보고한다.

- [ ] **Step 4: 커밋**

```bash
git commit -m "refactor: 좌측 「그룹 추가」도 createGroupWith 를 쓴다

- 인라인 중복(id 발급·미사용 최소 번호·다음 색)을 없애 규칙 소재지를 하나로
- 부수 효과: 이름·색을 producer 가 받은 모델에서 계산하므로 낙관적 체인에서도 겹치지 않는다

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" -- apps/web/src/editor/table-tree.tsx
```

---

### Task 4: 전체 검증과 문서

**Files:**
- Modify: `docs/manual/user-guide.md:248` (8절 「어떻게」 문단)
- Modify: `docs/superpowers/HANDOFF.md` (1절 완료 표 · 테스트 기준선 · 6절)

- [ ] **Step 1: web 스위트 전체와 typecheck를 돌린다**

```bash
pnpm -C apps/web test 2>&1 | tail -5
pnpm -r typecheck; echo "EXIT=$?"
```

기대: `Tests  728 passed`(719 + 9 = group-edits 7 + bulk-panel 2) · `EXIT=0`. **실측한 수를 적어 둔다.**

- [ ] **Step 2: core·server·cli가 안 움직였는지 확인한다**

```bash
git diff --stat main -- packages apps/server
```

기대: **빈 출력.** 한 줄이라도 나오면 범위를 넘은 것이다 — 멈추고 보고한다.

- [ ] **Step 3: 매뉴얼 8절을 고친다**

`docs/manual/user-guide.md:248`의 「테이블을 넣는 길은 셋이다」를 **넷으로** 늘린다. 기존 문장:

> 테이블을 넣는 길은 셋이다 — 그 테이블의 편집 패널에서 「소속 그룹」을 고르거나, **왼쪽 트리에서 항목을 잡아 그룹 블록에 끌어다 놓거나**, **캔버스의 테이블 노드를 트리의 그룹 블록으로 끌어다 놓는다**. 여러 개를 골라 두면 한 번에 옮겨진다(→ [4절](#4-에디터-기본)). 그룹이 바뀌면 캔버스 좌표도 새 그룹 옆으로 함께 조정된다.

바꿀 문장:

> 테이블을 넣는 길은 넷이다 — 그 테이블의 편집 패널에서 「소속 그룹」을 고르거나, **왼쪽 트리에서 항목을 잡아 그룹 블록에 끌어다 놓거나**, **캔버스의 테이블 노드를 트리의 그룹 블록으로 끌어다 놓거나**, 여러 개를 골라 둔 채 오른쪽 패널의 「선택 테이블의 그룹」 드롭다운으로 옮긴다. 여러 개를 골라 두면 한 번에 옮겨진다(→ [4절](#4-에디터-기본)). 그룹이 바뀌면 캔버스 좌표도 새 그룹 옆으로 함께 조정된다.
>
> **이미 있는 그룹이 아니라 새 그룹으로 묶으려면** — 캔버스에서 `Shift`+드래그로 상자를 그리거나 트리에서 여러 개를 골라 둔 다음, 오른쪽 패널의 「선택 테이블로 새 그룹」을 누른다. 「그룹1」처럼 쓰이지 않은 번호와 색이 자동으로 붙고 고른 테이블 전부가 그 그룹에 들어가며, 오른쪽이 곧바로 「그룹」 패널로 바뀌어 이름·색상·설명을 그 자리에서 고칠 수 있다(이때 테이블 선택은 풀린다). **테이블은 있던 자리에 그대로 있고 색상 영역만 씌워진다** — 멀리 떨어진 테이블끼리 묶으면 영역이 그만큼 커져 사이의 다른 테이블까지 덮어 보일 수 있으니, 그럴 때는 만든 뒤 캔버스에서 끌어 정리한다. 편집 1건이므로 **실행 취소 한 번으로 통째로 되돌아간다**.

- [ ] **Step 4: `HANDOFF.md`를 갱신한다**

세 곳이다.

1. **1절 완료 표** — 「캔버스 박스 선택 깜박임(버그 수정)」 행 **뒤**에 한 행을 더한다.

```markdown
| **선택 테이블로 새 그룹** | 테이블을 골라 둔 채 우측 일괄 패널의 버튼 하나로 그것들을 담는 그룹을 만든다. 지금까지는 빈 그룹을 만들고(선택이 풀린다) 다시 골라 드롭다운으로 옮겨야 해 **Revision 2건**이었다. 「새 그룹 하나 만들기」 규칙(권한·미사용 최소 번호·다음 색·그룹 뷰 좌표 비움)을 **`group-edits.ts`의 `createGroupWith` 한 곳**에 모으고 좌측 「그룹 추가」도 같은 함수를 쓴다(`applyGroupMove`와 같은 형태 — 진입점이 둘이면 규칙은 하나여야 한다). 생성과 배정이 **한 producer**라 `cmd+Z` 한 번에 원복된다. ⚠️ **좌표는 건드리지 않는다** — `planGroupMove`는 *대상 그룹의 기존 멤버* bbox를 기준으로 삼는데 새 그룹에는 기준이 없어 정의상 빈 배열이라, 부르지 않는 편이 의도가 드러나고 컬럼 전수 스캔도 안 돈다. 리팩터의 부수 효과로 이름·색을 **producer가 받은 모델**에서 계산하게 되어(옛 `onAddGroup`은 store 스냅샷을 읽었다) 낙관적 체인에서 이름이 겹치지 않는다. **core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-12-group-from-selection-design.md)) |
```

2. **테스트 기준선** — `web 719`를 실측값으로 고치고, 표 아래에 한 문단을 더한다(문구의 수는 Step 1의 실측으로 바꾼다).

```markdown
선택 테이블로 새 그룹 사이클에서 **web +9**가 붙었다(직전 기준선은 `web 719`였다). **core·cli·server는
무변경** — 설계가 "core·서버·CLI 변경 없음"을 못 박았고 그 셋이 움직였다면 범위를 넘은 것이다.
```

3. **6절 이월 항목** — 「캔버스 다중 선택 + 클립보드 (구현 완료, 잔여)」의 `편집 패널의 다중 선택 화면이 「N개 선택됨」과 안내문만 두고 **동작 버튼이 없다.**` 줄은 사이드바 사이클이 이미 해소했다(일괄 패널에 그룹 이동·삭제가 들어갔다). **그 줄을 지운다** — 고친 사이클에서 이월 목록을 함께 지우지 않으면 다음 세션이 끝난 일을 후보로 고른다. 그리고 새 항목 두 줄을 새 소절로 더한다.

```markdown
**선택 테이블로 새 그룹 (구현 완료, 잔여)**
- **흩어진 선택으로 만든 그룹은 영역이 크고 남의 테이블을 품는다**(설계 D2의 수용된 한계). 사용자가
  보고 직접 끌어 정리한다. 걸리면 선택지는 둘 — 만들기 전에 모으거나, "선택 밖 테이블이 영역에
  들어올 때만 모아 붙이는" 배치 규칙을 새로 두거나.
- **만든 직후 그룹 이름에 자동 포커스하지 않는다.** 좌측 「그룹 추가」와 대칭을 지킨 결과다. 둘을
  함께 바꾼다면 `GroupPanel`의 이름 input에 `autoFocus`를 주는 한 곳이다.
```

- [ ] **Step 5: 커밋**

```bash
git commit -m "docs: 선택 테이블로 새 그룹 기능을 매뉴얼·인계 문서에 반영한다

- user-guide 8절: 새 진입점과 좌표를 건드리지 않는다는 점, 흩어진 선택의 한계
- HANDOFF 1절 완료 표 · 테스트 기준선 web 719 → 728 · 6절 이월(해소된 항목 정리 + 신규 2건)

Co-Authored-By: Claude <이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>" -- docs/manual/user-guide.md docs/superpowers/HANDOFF.md
```

---

## 완료 보고에 담을 것

- `pnpm -C apps/web test`의 **실측 수**(`Tests  N passed`)와 `pnpm -r typecheck`의 `EXIT=`
- `git diff --stat main -- packages apps/server`가 빈 출력이라는 것
- 계획에서 벗어난 것이 있으면 무엇을 왜 바꿨는지
- 계획이 틀렸던 자리(픽스처 사실이 다르다든가, 행 번호가 어긋난다든가)
