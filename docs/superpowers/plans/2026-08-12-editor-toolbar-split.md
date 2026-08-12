# 에디터 도구 재분배(상단 묶음 + 하단 바) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 헤더 한 줄에 몰린 도구를 성격으로 나눠 상단(관리 도구 4개) + 하단 바(편집 도구·뷰 상태·줌) 두 줄로 재분배해 작은 해상도에서 잘리지 않게 한다.

**Architecture:** 다이얼로그 8개의 열림 상태를 `HeaderTools` 한 곳의 단일 상태로 올리고(트리거 렌더 책임을 헤더로 이관), 기존 `Toolbar`·`GroupViewSelect`·`ViewModeToggle`을 **수정 없이** 새 `BottomBar`가 조립한다. React Flow 기본 `<Controls>`를 제거하고 같은 API를 쓰는 `ZoomControls`가 하단 바에 들어간다.

**Tech Stack:** React 19 · TypeScript · Zustand(`useEditorStore`) · Radix(shadcn `dialog`·`dropdown-menu`) · `@xyflow/react` · Vitest + Testing Library

**설계:** `docs/superpowers/specs/2026-08-12-editor-toolbar-split-design.md`

## Global Constraints

- **`packages/core`·`apps/server`·`packages/cli`를 건드리지 않는다.** 마이그레이션 없음, API 변경 없음, presence 프로토콜 변경 없음. 이 셋이 움직였다면 범위를 넘은 것이다.
- **`toolbar.tsx`·`group-view-select.tsx`·`view-mode-toggle.tsx`는 한 줄도 고치지 않는다.** 옮기는 것은 배치뿐이다.
- **`bulk-panel.tsx`·`table-tree.tsx`를 건드리지 않는다** — 병행 트랙(`2026-08-12-group-from-selection-design.md`)의 파일이다.
- **다이얼로그 내용·동작을 바꾸지 않는다.** 바뀌는 것은 "누가 여는가"뿐이다.
- 응답·커밋 메시지·주석·문서는 **한국어**로 쓴다.
- 커밋은 **경로를 명시**한다: `git commit -m "..." -- <경로들>`. `git add -A`/`git commit -a` 금지.
- 커밋 메시지 말미에 트레일러 2줄을 붙인다.
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- 테스트 실행: `pnpm -C apps/web test <파일경로>` (= `vitest run <경로>`). 타입 검사는 `pnpm -s -C apps/web typecheck`.
  ⚠️ `pnpm -s -r typecheck`의 **출력만 보고 판정하지 마라** — `-s`가 자식 출력을 삼켜 오류가 있어도 0바이트이고 종료코드만 1이다. 종료코드로 판정하거나 패키지별로 돌린다.
- 각 태스크가 끝난 시점에 **앱이 정상 동작해야 한다**(도구가 사라진 중간 상태를 남기지 않는다).

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `apps/web/src/editor/use-warnings.ts` | **신설** — `computeWarnings` 호출 한 곳 | 1 |
| `apps/web/src/editor/zoom-controls.tsx` | **신설** — 줌 아웃/배율/줌 인/화면 맞춤 | 2 |
| `apps/web/src/editor/bottom-bar.tsx` | **신설** — 하단 바 셸(기존 3개 조립 + 줌) | 3 |
| `apps/web/src/editor/header-tools.tsx` | **신설** — 상단 우측 도구 클러스터 + 다이얼로그 8개 마운트 | 4·5 |
| `apps/web/src/editor/canvas.tsx` | `<Controls>` 제거 | 3 |
| `apps/web/src/pages/project.tsx` | 헤더 우측 → `HeaderTools`, 아래 `BottomBar` | 3·4·5 |
| `apps/web/src/editor/naming-check.tsx` | 제어형 전환 + `useWarnings` 사용 | 1·5 |
| `domain-panel` `dict-panel` `custom-field-panel` `resource-panel` | 제어형 전환 | 4 |
| `version-dialog` `ddl-import-dialog` `export-dialog` | 제어형 전환 | 5 |
| `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md` | 문서 갱신 | 6 |

**제어형 전환의 공통 형태** (태스크 4·5가 반복한다):

```tsx
// 전
export function XxxPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Icon /> 라벨</Button>
      </DialogTrigger>
      ...

// 후
export function XxxPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      ...
```

`useState` 선언과 `<DialogTrigger>…</DialogTrigger>` 블록을 지우고, 남은 `setOpen(false)` 호출을 `onOpenChange(false)`로 바꾼다. 쓰지 않게 된 `useState`·`Button`·`DialogTrigger`·아이콘 import를 함께 지운다(typecheck가 잡는다).

⚠️ **`ExportDialog`만 `projectId`를 받지 않는다**(현재 시그니처가 `export function ExportDialog()`다). 그것은 `{ open, onOpenChange }` 둘만 받게 한다. 나머지 일곱은 `projectId`를 유지한다.

**Radix 메뉴와 jsdom:** `test-setup.ts:16~19`가 포인터 API를 이미 폴리필해 두었고(Radix Select용) 드롭다운도 같은 API를 쓴다. 그래도 테스트에서 메뉴가 열리지 않으면 — `getByRole('menuitem')`이 아무것도 못 찾으면 — 트리거 클릭 후 `await screen.findByRole('menu')`로 열림을 먼저 기다려 본다. `components/ui/dropdown-menu.tsx`는 이미 저장소에 있고 `components/user-menu.tsx`가 쓰는 형태를 참고할 수 있다.

---

## Task 1: `useWarnings` 훅 추출

경고 건수 배지(헤더)와 경고 목록(다이얼로그)이 같은 계산을 보게 한다.

**Files:**
- Create: `apps/web/src/editor/use-warnings.ts`
- Create: `apps/web/src/editor/use-warnings.test.ts`
- Modify: `apps/web/src/editor/naming-check.tsx:43-44`

**Interfaces:**
- Produces: `useWarnings(): Warning[]` — `@erdd/core`의 `Warning[]`을 반환. Task 5의 `HeaderTools`가 배지 건수로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/use-warnings.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { useWarnings } from './use-warnings.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('useWarnings', () => {
  it('예약어 물리명에 경고를 낸다', () => {
    const model = buildSampleModel()
    const table = Object.values(model.tables)[0]!
    model.tables[table.id] = { ...table, physicalName: 'SELECT' }
    useEditorStore.getState().setLoaded(model, 1)

    const { result } = renderHook(() => useWarnings())

    expect(result.current.some((w) => w.kind === 'reserved')).toBe(true)
  })

  it('모델이 비어 있으면 빈 배열이다', () => {
    useEditorStore.getState().setLoaded({
      tableGroups: {}, domains: {}, words: {}, terms: {}, customFields: {},
      tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
    }, 1)

    const { result } = renderHook(() => useWarnings())

    expect(result.current).toEqual([])
  })
})
```

> `setLoaded`의 두 번째 인자(seq)와 빈 모델의 컬렉션 키는 `naming-check.test.tsx:13~26`의 `loadWith` 헬퍼와 `store.ts`의 시그니처를 그대로 따른다. 두 값이 다르면 그 파일을 열어 실제 형태에 맞춘다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/use-warnings.test.ts`
Expected: FAIL — `Failed to resolve import "./use-warnings.js"`

- [ ] **Step 3: 훅을 만든다**

`apps/web/src/editor/use-warnings.ts`:

```ts
import { useMemo } from 'react'
import { computeWarnings, type Warning } from '@erdd/core'
import { useEditorStore } from './store.js'

/**
 * 모델 경고의 단일 소재지. 헤더의 「모델 검사」 배지(건수)와 검사 다이얼로그(목록)가 이것을 함께
 * 본다 — 계산이 두 벌이 되면 배지 수와 목록 길이가 갈릴 수 있다.
 */
export function useWarnings(): Warning[] {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  return useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/use-warnings.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: `naming-check.tsx`가 훅을 쓰게 한다**

`naming-check.tsx`에서 `model`·`namingRules`·`dialects` 구독과 `warnings` `useMemo`(`:36~38`, `:43~44`)를 지우고 `const warnings = useWarnings()`로 바꾼다. **`model`은 `entityLabel(model, w)` 호출에 계속 쓰이므로 `useEditorStore((s) => s.model)` 구독은 남긴다.** `computeWarnings` import를 지우고 `type Warning`은 남긴다(`KIND_LABEL`·`groups`가 쓴다).

- [ ] **Step 6: 기존 테스트가 그대로 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/naming-check.test.tsx`
Expected: PASS — 동작이 바뀌지 않았으므로 수정 없이 그대로 통과해야 한다.

- [ ] **Step 7: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 8: 커밋**

```bash
git commit -m "refactor: 모델 경고 계산을 useWarnings 훅으로 뺀다

헤더 배지와 검사 다이얼로그가 같은 계산을 보게 하려는 준비다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/use-warnings.ts apps/web/src/editor/use-warnings.test.ts \
     apps/web/src/editor/naming-check.tsx
```

---

## Task 2: `ZoomControls` 신설

하단 바 오른쪽 끝에 들어갈 줌 컨트롤. 이 태스크에서는 만들고 테스트만 하며, 배치는 Task 3이 한다.

**Files:**
- Create: `apps/web/src/editor/zoom-controls.tsx`
- Create: `apps/web/src/editor/zoom-controls.test.tsx`

**Interfaces:**
- Consumes: `@xyflow/react`의 `useReactFlow()`(`zoomIn`·`zoomOut`·`zoomTo`·`fitView`)와 `useStore()`
- Produces: `<ZoomControls />` — prop 없음. Task 3의 `BottomBar`가 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/zoom-controls.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const zoomIn = vi.fn()
const zoomOut = vi.fn()
const zoomTo = vi.fn()
const fitView = vi.fn()
let currentZoom = 1

// React Flow 컨텍스트 없이 렌더하기 위해 두 훅만 갈아끼운다. 실제 뷰포트가 없어도 배율 표시와
// 버튼 배선을 검증할 수 있다.
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ zoomIn, zoomOut, zoomTo, fitView }),
  useStore: (selector: (s: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, currentZoom] }),
}))

const { ZoomControls } = await import('./zoom-controls.js')

afterEach(() => {
  cleanup()
  currentZoom = 1
  ;[zoomIn, zoomOut, zoomTo, fitView].forEach((f) => f.mockClear())
})

describe('ZoomControls', () => {
  it('현재 배율을 백분율로 보여준다', () => {
    currentZoom = 0.755
    render(<ZoomControls />)
    expect(screen.getByRole('button', { name: '배율 100%로' })).toHaveTextContent('76%')
  })

  it('줌 인·줌 아웃·화면 맞춤이 각각 React Flow API를 부른다', async () => {
    render(<ZoomControls />)
    await userEvent.click(screen.getByRole('button', { name: '확대' }))
    await userEvent.click(screen.getByRole('button', { name: '축소' }))
    await userEvent.click(screen.getByRole('button', { name: '화면에 맞춤' }))
    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('배율 표시를 누르면 100%로 되돌린다', async () => {
    currentZoom = 2
    render(<ZoomControls />)
    await userEvent.click(screen.getByRole('button', { name: '배율 100%로' }))
    expect(zoomTo).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/zoom-controls.test.tsx`
Expected: FAIL — `Failed to resolve import "./zoom-controls.js"`

- [ ] **Step 3: 컴포넌트를 만든다**

`apps/web/src/editor/zoom-controls.tsx`:

```tsx
import { Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Button } from '@/components/ui/button'

/**
 * 하단 바의 줌 컨트롤. React Flow 기본 `<Controls>`를 대신한다 — 전체 폭 하단 바를 깔면 캔버스
 * 좌하단의 기본 컨트롤이 그 위에 겹쳐 "두 겹 툴바"가 되기 때문이다(설계 D4).
 */
export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const zoom = useStore((s: { transform: [number, number, number] }) => s.transform[2])

  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="size-8" aria-label="축소"
        onClick={() => zoomOut()}>
        <Minus className="size-4" />
      </Button>
      <Button size="sm" variant="ghost" className="h-8 w-14 px-0 text-xs tabular-nums"
        aria-label="배율 100%로" onClick={() => zoomTo(1)}>
        {Math.round(zoom * 100)}%
      </Button>
      <Button size="icon" variant="ghost" className="size-8" aria-label="확대"
        onClick={() => zoomIn()}>
        <Plus className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" aria-label="화면에 맞춤"
        onClick={() => fitView()}>
        <Maximize className="size-4" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/zoom-controls.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

> `useStore`의 selector 인자 타입이 `@xyflow/react`의 실제 상태 타입과 맞지 않아 오류가 나면, 위 인라인 타입 대신 `useStore((s) => s.transform[2])`로 두고 추론에 맡긴다.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat: 하단 바에 쓸 줌 컨트롤을 만든다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/zoom-controls.tsx apps/web/src/editor/zoom-controls.test.tsx
```

---

## Task 3: `BottomBar` 신설 + 배치

편집 도구·뷰 상태·줌을 헤더에서 하단 바로 옮긴다. **이 태스크가 끝나면 헤더가 눈에 띄게 짧아지고 앱은 정상 동작한다.**

**Files:**
- Create: `apps/web/src/editor/bottom-bar.tsx`
- Create: `apps/web/src/editor/bottom-bar.test.tsx`
- Modify: `apps/web/src/editor/canvas.tsx:3`, `:345`
- Modify: `apps/web/src/pages/project.tsx:42-75`

**Interfaces:**
- Consumes: `Toolbar`(Task 이전부터 존재, 무변경) · `GroupViewSelect` · `ViewModeToggle` · `ZoomControls`(Task 2)
- Produces: `<BottomBar projectId={string} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/bottom-bar.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { BottomBar } from './bottom-bar.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<BottomBar projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('BottomBar', () => {
  it('편집 권한이 있으면 편집 도구와 뷰 상태와 줌이 함께 보인다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    grantEditPermission()
    renderBar()

    expect(screen.getByRole('button', { name: /테이블 추가/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '물리명' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '화면에 맞춤' })).toBeInTheDocument()
  })

  it('읽기 전용이면 편집 도구가 없고 표시 모드와 줌은 남는다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    renderBar()

    expect(screen.queryByRole('button', { name: /테이블 추가/ })).not.toBeInTheDocument()
    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '물리명' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '화면에 맞춤' })).toBeInTheDocument()
  })
})
```

> 두 번째 케이스가 `grantEditPermission()`을 **부르지 않는** 것이 핵심이다. store 기본값이 fail-closed(`canEdit=false`)다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/bottom-bar.test.tsx`
Expected: FAIL — `Failed to resolve import "./bottom-bar.js"`

- [ ] **Step 3: `BottomBar`를 만든다**

`apps/web/src/editor/bottom-bar.tsx`:

```tsx
import { Toolbar } from './toolbar.js'
import { GroupViewSelect } from './group-view-select.js'
import { ViewModeToggle } from './view-mode-toggle.js'
import { ZoomControls } from './zoom-controls.js'

/**
 * 화면 전체 폭 하단 바. 캔버스를 직접 조작하는 것(편집 도구)과 캔버스를 어떻게 볼지 정하는
 * 것(그룹 뷰·표시 모드·줌)을 모은다. 관리 도구는 상단에 남는다(설계 D1·D3).
 *
 * 그룹 뷰·표시 모드는 좌측 트리·우측 편집 패널의 표시에도 걸리는 전역 상태라, 캔버스 열 안이
 * 아니라 전체 폭에 둔다.
 */
export function BottomBar({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-card px-4">
      <Toolbar projectId={projectId} />
      <div className="mx-1 h-5 w-px bg-border" />
      <GroupViewSelect />
      <ViewModeToggle />
      <div className="ml-auto">
        <ZoomControls />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/bottom-bar.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: 캔버스의 기본 줌 컨트롤을 제거한다**

`canvas.tsx`에서 `<Controls showInteractive={false} />`(`:345`) 줄을 지우고, `:3`의 import 목록에서 `Controls`를 뺀다. **`Background`·`MiniMap`은 그대로 둔다.**

- [ ] **Step 6: `project.tsx`를 고친다**

헤더에서 `Toolbar`·`GroupViewSelect`·`ViewModeToggle` 렌더를 지우고, 3칸 아래에 하단 바를 넣는다.

```tsx
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <Link to="/" aria-label="홈으로"><BrandWordmark /></Link>
          <div className="flex items-center gap-2">
            {loaded && <PresenceBar selfUserId={me.id} />}
            {loaded && <VersionDialog projectId={projectId} />}
            {loaded && <DomainPanel projectId={projectId} />}
            {loaded && <DictPanel projectId={projectId} />}
            {loaded && <CustomFieldPanel projectId={projectId} />}
            {loaded && <ResourcePanel projectId={projectId} />}
            {loaded && <NamingCheck projectId={projectId} />}
            {loaded && <DdlImportDialog projectId={projectId} />}
            {loaded && <ExportDialog />}
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/p/${projectId}/settings`}><Settings /> 설정</Link>
            </Button>
            <UserMenu />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          {loaded
            ? (
                <>
                  <TableTree projectId={projectId} />
                  <Canvas projectId={projectId} selfUserId={me.id} />
                  <EditPanel projectId={projectId} />
                </>
              )
            : <div className="flex flex-1 items-center justify-center text-muted-foreground">불러오는 중…</div>}
        </div>
        {loaded && <BottomBar projectId={projectId} />}
```

import에서 `Toolbar`·`GroupViewSelect`·`ViewModeToggle`을 지우고 `BottomBar`를 더한다. 좌측이 브랜드 하나만 남으므로 그것을 감싸던 `<div className="flex items-center gap-4">`도 함께 지운다.

- [ ] **Step 7: 웹 스위트 전체를 돌린다**

Run: `pnpm -C apps/web test`
Expected: PASS — 기존 719건 + Task 1·2·3이 더한 것. `canvas.test.tsx`가 `<Controls>` 제거로 깨지면(줌 버튼을 찾는 케이스가 있는지 확인) 그 케이스를 `zoom-controls.test.tsx`가 이미 덮으므로 캔버스 쪽에서 지운다.

- [ ] **Step 8: 타입 검사**

Run: `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat: 편집 도구·뷰 상태·줌을 하단 바로 내린다

헤더 한 줄에 몰려 작은 해상도에서 잘리던 것을 두 줄로 나눈다. Toolbar·GroupViewSelect·
ViewModeToggle 은 그대로 재사용하고 BottomBar 가 조립만 한다. React Flow 기본 Controls 는
전체 폭 바와 겹쳐 두 겹으로 보이므로 ZoomControls 로 대신한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/bottom-bar.tsx apps/web/src/editor/bottom-bar.test.tsx \
     apps/web/src/editor/canvas.tsx apps/web/src/pages/project.tsx
```

---

## Task 4: 사전·리소스 4개 제어형 전환 + `HeaderTools` 신설

**Files:**
- Create: `apps/web/src/editor/header-tools.tsx`
- Create: `apps/web/src/editor/header-tools.test.tsx`
- Modify: `apps/web/src/editor/domain-panel.tsx` · `dict-panel.tsx` · `custom-field-panel.tsx` · `resource-panel.tsx`
- Modify: 위 4개의 `.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Produces: `<HeaderTools projectId={string} />` — 상단 우측 도구 클러스터. Task 5가 확장한다.
- Produces: 4개 패널의 새 시그니처 `{ projectId: string; open: boolean; onOpenChange: (open: boolean) => void }`

- [ ] **Step 1: 4개 패널을 제어형으로 바꾼다**

각 파일에서 "파일 구조" 절의 공통 형태대로 `useState(false)`와 `<DialogTrigger>` 블록을 지우고 prop을 받게 한다. 대상 라인:

| 파일 | `useState` | `<DialogTrigger>` 블록 |
|---|---|---|
| `domain-panel.tsx` | `:31` | `:45~47` |
| `dict-panel.tsx` | `:29` | `:55~57` |
| `custom-field-panel.tsx` | `:21` | `:43~45` |
| `resource-panel.tsx` | `:33` | `:58~60` |

⚠️ **각 파일에는 하위 다이얼로그의 `useState`가 더 있다**(`editorOpen`·`wordEditorOpen`·`termEditorOpen` 등). **그것들은 그대로 둔다** — 지울 것은 바깥 다이얼로그의 `open` 하나뿐이다. `dict-panel.tsx`의 `:413`·`:540`·`:582` `<Dialog>`도 하위 다이얼로그이므로 건드리지 않는다.

이 4개에는 `setOpen(false)` 호출이 없다(확인 완료). 남는 것은 시그니처 교체뿐이다.

- [ ] **Step 2: 4개 패널 테스트를 고친다**

각 테스트의 `renderPanel()` 헬퍼가 `open`을 주고 렌더하게 바꾼 뒤, 각 케이스에서 **트리거를 여는 첫 클릭 줄을 지운다**.

```tsx
// domain-panel.test.tsx — 헬퍼
  render(<DomainPanel projectId={PROJECT_ID} open onOpenChange={() => {}} />, { wrapper: w })

// 각 케이스에서 지울 줄
-    await userEvent.click(screen.getByRole('button', { name: /도메인/ }))
```

지울 클릭 줄 수: `domain-panel` 4 · `dict-panel` 14 · `custom-field-panel` 4 · `resource-panel` 3.
⚠️ **트리거를 여는 클릭만 지운다.** 다이얼로그 **안**의 같은 이름 버튼(예: `dict-panel`의 「용어」 탭)은 남긴다 — 각 케이스에서 **맨 처음** 나오는 여는 클릭 한 줄이 대상이다.

- [ ] **Step 3: 4개 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/domain-panel.test.tsx src/editor/dict-panel.test.tsx src/editor/custom-field-panel.test.tsx src/editor/resource-panel.test.tsx`
Expected: PASS — 건수가 이전과 같아야 한다(검증 내용은 안 바뀌었다).

- [ ] **Step 4: `HeaderTools` 테스트를 쓴다**

`apps/web/src/editor/header-tools.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { HeaderTools } from './header-tools.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function renderTools() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<HeaderTools projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('HeaderTools — 사전·리소스', () => {
  it('메뉴에서 「도메인」을 고르면 도메인 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))

    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()
  })

  it('한 번에 하나만 열린다 — 다른 것을 고르면 앞의 것이 닫힌다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))
    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '커스텀 항목' }))

    expect(await screen.findByRole('dialog', { name: '커스텀 항목' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '도메인' })).not.toBeInTheDocument()
  })
})
```

> 다이얼로그의 접근 이름은 각 파일의 `<DialogTitle>` 문자열이다 — 「도메인」·「단어·용어 사전」·「커스텀 항목」·「공용 리소스」. 실제 문자열이 다르면 해당 파일을 열어 맞춘다.

- [ ] **Step 5: 테스트가 실패하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/header-tools.test.tsx`
Expected: FAIL — `Failed to resolve import "./header-tools.js"`

- [ ] **Step 6: `HeaderTools`를 만든다**

`apps/web/src/editor/header-tools.tsx`:

```tsx
import { useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import { DomainPanel } from './domain-panel.js'
import { DictPanel } from './dict-panel.js'
import { CustomFieldPanel } from './custom-field-panel.js'
import { ResourcePanel } from './resource-panel.js'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * 상단 우측 관리 도구. 열린 도구를 **단일 상태**로 들어 두 다이얼로그가 동시에 열리는 상태가
 * 구조적으로 생기지 않게 한다(설계 D5). 다이얼로그는 드롭다운 **바깥**에 마운트한다 — 메뉴 안에
 * 두면 메뉴가 닫힐 때 함께 언마운트된다.
 */
type ToolId = 'domain' | 'dict' | 'customField' | 'resource'

export function HeaderTools({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<ToolId | null>(null)
  const close = (open: boolean) => { if (!open) setTool(null) }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <BookOpen /> 사전·리소스 <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setTool('domain')}>도메인</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('dict')}>단어·용어 사전</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('customField')}>커스텀 항목</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('resource')}>공용 리소스</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DomainPanel projectId={projectId} open={tool === 'domain'} onOpenChange={close} />
      <DictPanel projectId={projectId} open={tool === 'dict'} onOpenChange={close} />
      <CustomFieldPanel projectId={projectId} open={tool === 'customField'} onOpenChange={close} />
      <ResourcePanel projectId={projectId} open={tool === 'resource'} onOpenChange={close} />
    </>
  )
}
```

- [ ] **Step 7: 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/header-tools.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 8: `project.tsx`에 배선한다**

헤더 우측에서 `DomainPanel`·`DictPanel`·`CustomFieldPanel`·`ResourcePanel` 네 줄을 지우고 `{loaded && <HeaderTools projectId={projectId} />}` 한 줄로 바꾼다. 위치는 `PresenceBar` 다음, `VersionDialog` 앞이다(Task 5에서 나머지가 이 안으로 들어온다). 네 컴포넌트의 import를 지우고 `HeaderTools`를 더한다.

- [ ] **Step 9: 웹 스위트 전체 + 타입 검사**

Run: `pnpm -C apps/web test` 그리고 `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: PASS / `EXIT=0`

- [ ] **Step 10: 커밋**

```bash
git commit -m "feat: 사전·도메인·커스텀 항목·공용 리소스를 상단 묶음 메뉴로 모은다

다이얼로그를 제어형으로 바꾸고 트리거 렌더 책임을 HeaderTools 한 곳으로 옮긴다. 열린 도구를
단일 상태로 들어 둘이 동시에 열리는 상태가 생기지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/header-tools.tsx apps/web/src/editor/header-tools.test.tsx \
     apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-panel.test.tsx \
     apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx \
     apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-panel.test.tsx \
     apps/web/src/editor/resource-panel.tsx apps/web/src/editor/resource-panel.test.tsx \
     apps/web/src/pages/project.tsx
```

---

## Task 5: 나머지 4개 제어형 전환 + `HeaderTools` 완성

**Files:**
- Modify: `apps/web/src/editor/version-dialog.tsx` · `naming-check.tsx` · `ddl-import-dialog.tsx` · `export-dialog.tsx`
- Modify: 위 4개의 `.test.tsx`
- Modify: `apps/web/src/editor/header-tools.tsx` · `header-tools.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: `useWarnings()`(Task 1) · `HeaderTools`(Task 4)
- Produces: 최종 `ToolId` union — `'version' | 'domain' | 'dict' | 'customField' | 'resource' | 'namingCheck' | 'ddlImport' | 'export'`

- [ ] **Step 1: 4개를 제어형으로 바꾼다**

공통 형태대로 바꾸되, **이 넷에는 각각 고유한 처리가 있다.**

| 파일 | `useState` | `<DialogTrigger>` | 추가로 할 것 |
|---|---|---|---|
| `version-dialog.tsx` | `:176` | `:181~183` | `setOpen(false)` 2곳(`:207`·`:211`) → `onOpenChange(false)` |
| `naming-check.tsx` | `:41` | `:64~68` | `goTo`의 `setOpen(false)`(`:59`) → `onOpenChange(false)` |
| `ddl-import-dialog.tsx` | `:34` | `:71~73` | `setOpen(false)`(`:61`) → `onOpenChange(false)`. **`if (!canEdit) return null`(`:64`)을 지운다** — 가드가 메뉴 항목으로 옮겨간다(Step 4) |
| `export-dialog.tsx` | `:38` | `:105~107` | **`onOpenChange`의 부수 효과를 `useEffect`로 옮긴다**(아래) |

`export-dialog.tsx`는 지금 열릴 때 범위를 초기화한다(`:100~103`):

```tsx
// 전
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setScope(activeGroupView ? { kind: 'group', groupId: activeGroupView } : { kind: 'all' })
      }}

// 후 — <Dialog open={open} onOpenChange={onOpenChange}> 로 두고, 컴포넌트 본문에
  // 열릴 때 범위를 현재 그룹 뷰에 맞춘다. 제어형이 되어 onOpenChange 가 부모 것이므로
  // "열림"을 여기서 감지한다.
  useEffect(() => {
    if (!open) return
    setScope(activeGroupView ? { kind: 'group', groupId: activeGroupView } : { kind: 'all' })
  }, [open, activeGroupView])
```

⚠️ **`activeGroupView`를 의존성에 넣으면 다이얼로그가 열려 있는 동안 그룹 뷰가 바뀔 때도 범위가 재설정된다.** 기존 동작(열 때만)과 다르다. 기존 동작을 정확히 지키려면 의존성을 `[open]`으로 두고 `activeGroupView`는 ref로 읽거나, eslint 지시로 의존성을 좁힌다. **기존 동작을 지키는 쪽을 택한다** — 이 사이클은 동작을 바꾸지 않는다.

- [ ] **Step 2: 4개 테스트를 고친다**

Task 4 Step 2와 같은 방식이다. 헬퍼에 `open onOpenChange={() => {}}`를 주고 각 케이스의 여는 클릭을 지운다.

지울 클릭 줄 수: `version-dialog` 7 · `naming-check` 3 · `ddl-import-dialog` 9 · `export-dialog` 10.
- `naming-check.test.tsx`는 헬퍼가 없고 각 케이스가 `render(<NamingCheck projectId={PROJECT_ID} />)`를 직접 부른다 — 각 호출에 prop을 더한다.
- `export-dialog.test.tsx`의 10개 `name: '내보내기'` 클릭은 **전부 트리거 클릭**이다(다이얼로그 안의 실행 버튼은 「다운로드」다). 전부 지운다.
- `ddl-import-dialog.test.tsx`에 **읽기 전용이면 렌더되지 않는다**는 케이스가 있으면 그 검증은 Step 5의 `header-tools` 테스트로 옮긴다(가드가 그쪽으로 갔으므로).

- [ ] **Step 3: 4개 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/version-dialog.test.tsx src/editor/naming-check.test.tsx src/editor/ddl-import-dialog.test.tsx src/editor/export-dialog.test.tsx`
Expected: PASS

- [ ] **Step 4: `HeaderTools`를 확장한다**

`ToolId`에 `'version' | 'namingCheck' | 'ddlImport' | 'export'`를 더하고, 트리거를 아래 순서로 렌더한다. 다이얼로그 4개도 같은 방식으로 마운트한다(`<ExportDialog open={tool === 'export'} onOpenChange={close} />` — `projectId` 없음).

import에 더할 것: `History`·`ListChecks`·`FolderOpen`(lucide-react), `useWarnings`(`./use-warnings.js`), `useEditorStore`(`./store.js`), 그리고 다이얼로그 4개.

```tsx
  const warnings = useWarnings()
  const canEdit = useEditorStore((s) => s.canEdit)

  // 순서: 버전 → 사전·리소스 → 모델 검사 → 파일
  <Button variant="ghost" size="sm" onClick={() => setTool('version')}>
    <History /> 버전
  </Button>

  {/* 사전·리소스 드롭다운 (Task 4) */}

  <Button variant="ghost" size="sm" onClick={() => setTool('namingCheck')}>
    <ListChecks /> 모델 검사{warnings.length > 0 ? ` (${warnings.length})` : ''}
  </Button>

  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm">
        <FolderOpen /> 파일 <ChevronDown className="size-3 opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {canEdit && (
        <DropdownMenuItem onSelect={() => setTool('ddlImport')}>DDL·DBML 가져오기</DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => setTool('export')}>내보내기</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
```

⚠️ **`canEdit` 가드가 여기로 온다.** `ddl-import-dialog.tsx`에서 지운 `if (!canEdit) return null`의 대체다 — 안 옮기면 읽기 전용 사용자 메뉴에 눌러도 아무 일 없는 항목이 남는다.

- [ ] **Step 5: `header-tools.test.tsx`에 케이스를 더한다**

```tsx
  it('경고가 있으면 「모델 검사」에 건수가 붙는다', async () => {
    const model = buildSampleModel()
    const table = Object.values(model.tables)[0]!
    model.tables[table.id] = { ...table, physicalName: 'SELECT' }
    useEditorStore.getState().setLoaded(model, 1)
    grantEditPermission()
    renderTools()

    expect(screen.getByRole('button', { name: /모델 검사 \(\d+\)/ })).toBeInTheDocument()
  })

  it('읽기 전용이면 「파일」에 가져오기가 없고 내보내기는 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)   // grantEditPermission 을 부르지 않는다
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /파일/ }))

    expect(screen.queryByRole('menuitem', { name: 'DDL·DBML 가져오기' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '내보내기' })).toBeInTheDocument()
  })

  it('「버전」을 누르면 버전 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /버전/ }))

    expect(await screen.findByRole('dialog', { name: '버전' })).toBeInTheDocument()
  })
```

- [ ] **Step 6: `header-tools` 테스트가 통과하는 것을 확인한다**

Run: `pnpm -C apps/web test src/editor/header-tools.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 7: `project.tsx`를 마무리한다**

헤더 우측에서 `VersionDialog`·`NamingCheck`·`DdlImportDialog`·`ExportDialog` 네 줄을 지운다(`HeaderTools`가 렌더한다). 최종 헤더 우측은 `PresenceBar` → `HeaderTools` → 「설정」 → `UserMenu` 넷이다. 네 컴포넌트의 import도 지운다.

- [ ] **Step 8: 웹 스위트 전체 + 타입 검사**

Run: `pnpm -C apps/web test` 그리고 `pnpm -s -C apps/web typecheck; echo "EXIT=$?"`
Expected: PASS / `EXIT=0`

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat: 버전·모델 검사·파일을 상단 도구 클러스터로 마무리한다

가져오기·내보내기를 「파일」로 묶어 사전 Excel 업로드와 이름이 갈린다(HANDOFF 6절 마찰).
ddl-import 의 canEdit 가드는 컴포넌트에서 메뉴 항목으로 옮겼다 — 제어형이 되면 컴포넌트가
스스로 사라져도 메뉴에는 죽은 항목이 남기 때문이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- apps/web/src/editor/header-tools.tsx apps/web/src/editor/header-tools.test.tsx \
     apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx \
     apps/web/src/editor/naming-check.tsx apps/web/src/editor/naming-check.test.tsx \
     apps/web/src/editor/ddl-import-dialog.tsx apps/web/src/editor/ddl-import-dialog.test.tsx \
     apps/web/src/editor/export-dialog.tsx apps/web/src/editor/export-dialog.test.tsx \
     apps/web/src/pages/project.tsx
```

---

## Task 6: 문서 갱신

화면 문구가 바뀌었으므로 매뉴얼의 「」 인용이 어긋난다. 기능을 바꾸면 매뉴얼도 함께 고치는 것이 이 저장소의 규칙이다.

**Files:**
- Modify: `docs/manual/user-guide.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: `user-guide.md`를 고친다**

| 위치 | 고칠 것 |
|---|---|
| `:90` | 「툴바 자리에 「읽기 전용」 배지」 → 하단 바 |
| `:105`·`:107` | 화면 구성·헤더 서술 — 상단(접속자 → 「버전」 → 「사전·리소스」 → 「모델 검사」 → 「파일」 → 「설정」 → 사용자 메뉴)과 하단 바(편집 도구 → 실행 취소/다시 실행 → 뷰 전환 → 보기 모드 → 줌)로 다시 쓴다 |
| `:121~125` | 「툴바 「삭제」」 → 「하단 바 「삭제」」(3곳) |
| `:145` | 「헤더 오른쪽 3버튼 토글」 → 하단 바 |
| `:236`·`:238` | 「툴바 「메모」」 → 하단 바 |
| `:246`·`:248` | 「헤더의 「뷰 전환」」 → 「하단 바의 「뷰 전환」」 |
| `:269` | 「에디터 헤더의 「도메인」」 → 「에디터 헤더 「사전·리소스」 → 「도메인」」 |
| `:289` | 「에디터 헤더의 「사전」」 → 「에디터 헤더 「사전·리소스」 → 「단어·용어 사전」」 |
| `:319` | 「에디터 헤더의 「커스텀 항목」」 → 「에디터 헤더 「사전·리소스」 → 「커스텀 항목」」 |
| `:344` | 「에디터 헤더의 「모델 검사」」 — 위치는 그대로이므로 문구 확인만 |
| `:375` | 「에디터 헤더의 「공용 리소스」」 → 「에디터 헤더 「사전·리소스」 → 「공용 리소스」」 |
| DDL 가져오기 절 | 「가져오기」 → 「파일」 → 「DDL·DBML 가져오기」 |
| 내보내기 절 | 「내보내기」 → 「파일」 → 「내보내기」 |

**행 번호는 이 계획을 쓸 때 기준이다.** 앞선 편집으로 밀렸을 수 있으니 `grep -n "툴바\|헤더" docs/manual/user-guide.md`로 실제 위치를 다시 찾아 고친다.

- [ ] **Step 2: 매뉴얼에 남은 옛 표현이 없는지 확인한다**

Run: `grep -n "툴바\|헤더 오른쪽\|헤더의 「" docs/manual/user-guide.md`
Expected: 「툴바」가 하단 바를 가리키던 자리에 하나도 남아 있지 않다. 남은 「헤더」 언급은 상단에 실제로 남은 것(공통 상단바·모델 검사·설정)뿐이다.

- [ ] **Step 3: `HANDOFF.md`를 고친다**

1. 1절 완료 표에 이 사이클 한 줄을 더한다. 담을 것 — 분배 축(캔버스를 조작하는가), 상단 8개 → 4개 묶음, 하단 전체 폭 바, 다이얼로그 8개 제어형 전환과 **트리거 렌더 책임의 단일화**, `ddl-import`의 `canEdit` 가드가 메뉴 항목으로 옮겨간 것, **core·서버·CLI 변경 없음 / 마이그레이션 없음**, 설계 문서 링크.
2. 테스트 기준선을 **실측해** 갱신한다(`core 630 · cli 138 · web 719 · server 196`의 web 값). 이 사이클이 올린 수를 함께 적는다.
3. 6절 이월 항목에서 **「같은 이름의 「가져오기」가 서로 다른 두 기능이다」를 지운다**(`:1136~1139`). 지우지 않으면 다음 세션이 끝난 일을 후보로 고른다.
4. 3절 웹 UI 절에 불변식 한 줄을 더한다 — **에디터 다이얼로그의 트리거는 `header-tools.tsx`만 렌더한다. 다이얼로그 컴포넌트는 제어형이고 자체 열림 상태를 갖지 않는다.**

- [ ] **Step 4: 커밋**

```bash
git commit -m "docs: 도구 재분배를 매뉴얼과 인계 문서에 반영한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <세션 URL>" \
  -- docs/manual/user-guide.md docs/superpowers/HANDOFF.md
```

---

## 마무리 검증 (전 태스크 완료 후)

- [ ] **루트 verify를 돌린다**

```bash
set -a && . ./.env && set +a && pnpm verify
```
Expected: typecheck EXIT=0 + core·cli·web·server 네 스위트 전부 그린. **core·cli·server의 건수가 변하지 않아야 한다** — 변했다면 범위를 넘은 것이다.

- [ ] **브라우저 스모크**

1. **1024px 폭에서 상단·하단 어느 줄도 잘리지 않는다**(목표 폭이 계산 추정치이므로 이 확인이 필수다).
2. 「사전·리소스 ▾」·「파일 ▾」에서 연 다이얼로그 6개가 전부 정상 동작한다.
3. 하단 바가 미니맵과 겹치지 않고, 줌 버튼 4개가 캔버스에 실제로 걸린다.
4. 그룹이 0개일 때 `GroupViewSelect`가 `null`을 내도 하단 바 레이아웃이 깨지지 않는다.
5. 읽기 전용 계정으로 들어가 하단 바에 「읽기 전용」 배지가 뜨고 뷰·줌이 살아 있으며, 「파일 ▾」에 「DDL·DBML 가져오기」가 없다.
