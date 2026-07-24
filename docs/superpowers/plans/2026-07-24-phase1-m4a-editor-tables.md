# Phase 1 / M4a — ERD 에디터: 캔버스와 테이블/컬럼 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M3의 `model.get`/`model.mutate` 위에 ERD 에디터의 읽기+테이블/컬럼 편집을 올린다 — React Flow 캔버스, 테이블 노드(컬럼·PK·타입·보기 모드), 테이블 생성·드래그 이동·삭제, 편집 패널의 테이블/컬럼 CRUD, 좌측 트리와 검색. 관계·undo·그룹·메모는 M4b.

**Architecture:** 클라이언트는 Zustand 스토어에 `ProjectModel + seq`를 들고, **UI는 "다음 모델"을 immutable하게 만들고 core `diffModels(현재, 다음)`가 op 배치를 도출**한다(스냅샷 복원·CLI push와 같은 메커니즘 — core 최대 재사용). 변경은 낙관적으로 스토어에 반영 후 `model.mutate` 호출, 실패 시 `model.get` 재로드 + 토스트. TableNode는 M4a에서 **핸들 없는 순수 표현 컴포넌트**(연결 핸들·엣지는 M4b 관계에서 도입).

**Tech Stack:** 기존 웹 스택 + `@xyflow/react`(React Flow), `zustand`, `uuidv7`.

## 디자인 방향 — "데이터 도면"의 심장부 (M2b 계약 계승)

- 팔레트 토큰만(임의 색 금지), 물리명·타입은 `font-mono`. BrandMark가 곧 테이블 글리프이므로 **TableNode가 제품의 시그니처**다.
- TableNode: 흰 카드 + 보더 + `shadow-sm`, 선택 시 `ring-2 ring-primary`. 헤더에 물리명(mono bold)/논리명(sans muted, 보기 모드에 따름). 컬럼 행 = PK 키골드 마커 + 이름(보기 모드) + 타입(mono muted 우측). NN은 옅은 표식.
- 캔버스 배경은 React Flow `Background`(점 격자) — 로그인/빈 상태의 dotgrid와 같은 도면 언어.
- 카피: 능동태, 버튼은 결과를 말함("테이블 추가"). 빈 캔버스는 "테이블을 추가해 설계를 시작하세요".

## Global Constraints

- 수정 범위: `apps/web` + `pnpm-lock.yaml`. 서버·core 수정 금지(M3 API를 그대로 사용).
- 테스트: vitest + testing-library. React Flow는 jsdom에서 ResizeObserver가 필요 → Task 1에서 폴리필. **전체 ReactFlow 통합은 컨트롤러 Playwright 스모크로 검증**하고, 유닛 테스트는 순수 조각(스토어·op 도출·TableNode 단독·편집 패널·트리/검색)을 다룬다.
- 상태 변경은 전부 `useModelMutation`의 producer+diff 경로를 지난다(직접 op 조립 금지 — diffModels가 도출).
- ESM, TypeScript strict. 커밋 메시지는 한국어. `git add .`/`-A` 금지(작업 트리에 무관한 .idea 변경·.env 존재) — 명시 경로만.
- 기존 테스트(web 8, server 36, core 43) 유지. 서버 typecheck 영향 없음.

---

### Task 1: 에디터 기반 — 모델 스토어, mutate 훅, 라우트 재구성

**Files:**
- Create: `apps/web/src/editor/store.ts`, `apps/web/src/editor/use-model.ts`, `apps/web/src/editor/uid.ts`, `apps/web/src/test-setup.ts`, `apps/web/src/pages/project-settings.tsx`
- Modify: `apps/web/src/pages/project.tsx`(에디터 셸로 전환), `apps/web/src/routes.tsx`(`/p/:projectId/settings` 추가), `apps/web/vitest.config.ts`(setupFiles), `apps/web/package.json`
- Test: `apps/web/src/editor/use-model.test.tsx`

**Interfaces:**
- Produces:
  - `useEditorStore` — Zustand: `{ model, seq, viewMode, selectedTableId, setLoaded, setModel, setSeq, setViewMode, select }`. `ViewMode = 'logical'|'physical'|'mixed'`.
  - `useModelMutation(projectId)` → `mutate(producer: (m: ProjectModel) => ProjectModel, opts?: { summary?: string }): Promise<void>` — diffModels로 op 도출, 낙관적 setModel, `model.mutate` 호출, 실패 시 `model.get` 재로드 + 토스트. `diff.length === 0`이면 no-op. 낙관 커밋 전 `validateModelIntegrity(next)`로 사전 차단.
  - `useModelLoader(projectId)` — `model.get`을 스토어에 적재(로딩/에러 상태 반환).
  - `newId()` = uuidv7 (`uid.ts`).
- Task 2~5가 store와 mutate를 사용한다.

- [ ] **Step 1: 의존성과 테스트 셋업**

Run:
```bash
pnpm --filter @erdd/web add @xyflow/react zustand uuidv7
```

`apps/web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'

// React Flow가 jsdom에서 요구하는 관측자 폴리필
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never)
if (!globalThis.DOMMatrixReadOnly) {
  globalThis.DOMMatrixReadOnly = class { constructor() {} } as never
}
```

Run: `pnpm --filter @erdd/web add -D @testing-library/jest-dom`

`apps/web/vitest.config.ts`의 `test` 객체에 `setupFiles: ['./src/test-setup.ts']` 추가(기존 environment/alias 유지).

- [ ] **Step 2: uid와 스토어**

`apps/web/src/editor/uid.ts`:
```ts
import { uuidv7 } from 'uuidv7'
export function newId(): string {
  return uuidv7()
}
```

`apps/web/src/editor/store.ts`:
```ts
import { create } from 'zustand'
import { createEmptyModel, type ProjectModel } from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  viewMode: ViewMode
  selectedTableId: string | null
  setLoaded: (model: ProjectModel, seq: number) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
  reset: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  viewMode: 'physical',
  selectedTableId: null,
  setLoaded: (model, seq) => set({ model, seq, loaded: true }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set({ seq }),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (selectedTableId) => set({ selectedTableId }),
  reset: () => set({ model: createEmptyModel(), seq: 0, loaded: false, selectedTableId: null }),
}))
```

- [ ] **Step 3: 실패하는 테스트 작성**

`apps/web/src/editor/use-model.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

const NOTE = {
  id: '018f6b0e-0000-7000-8000-000000000001',
  content: '메모', position: { x: 0, y: 0 }, color: '#fff',
}

afterEach(() => {
  vi.unstubAllGlobals()
  useEditorStore.getState().reset()
})

describe('useModelMutation', () => {
  it('derives ops via diffModels, optimistically updates the store, and reconciles seq', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 3)
    const captured: unknown[] = []
    mockTrpcFetch({
      'model.mutate': (input) => { captured.push(input); return { data: { seq: 4 } } },
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    expect(useEditorStore.getState().model.notes[NOTE.id]).toBeDefined()
    await waitFor(() => expect(useEditorStore.getState().seq).toBe(4))
    const sent = captured[0] as { ops: unknown[] }
    expect(sent.ops).toHaveLength(1)
  })

  it('is a no-op when the producer changes nothing', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1)
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => { await result.current((m) => m) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useEditorStore.getState().seq).toBe(1)
  })

  it('rolls back to the server model on mutation error', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 5)
    mockTrpcFetch({
      'model.mutate': () => ({ error: { code: -32600, message: '무결성 위반' } }),
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 5 } }),
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    await waitFor(() => expect(useEditorStore.getState().model.notes[NOTE.id]).toBeUndefined())
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(use-model.js 없음).

- [ ] **Step 4: mutate 훅과 로더 구현**

`apps/web/src/editor/use-model.ts`:
```ts
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { diffModels, validateModelIntegrity, type ProjectModel } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'

/** model.get을 스토어에 적재한다. */
export function useModelLoader(projectId: string) {
  const trpc = useTRPC()
  const setLoaded = useEditorStore((s) => s.setLoaded)
  const query = useQuery(trpc.model.get.queryOptions({ projectId }))
  if (query.data && !useEditorStore.getState().loaded) {
    setLoaded(query.data.model, query.data.seq)
  }
  return query
}

/**
 * 모델 변경의 단일 경로. producer가 다음 모델을 만들면 diffModels로 op을 도출해
 * 낙관적으로 스토어에 반영하고 서버에 전송한다. 실패 시 서버 상태로 재로드한다.
 */
export function useModelMutation(projectId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(trpc.model.mutate.mutationOptions())

  return useCallback(
    async (producer: (model: ProjectModel) => ProjectModel, opts?: { summary?: string }) => {
      const store = useEditorStore.getState()
      const current = store.model
      const next = producer(current)
      const ops = diffModels(current, next)
      if (ops.length === 0) return

      const issues = validateModelIntegrity(next)
      if (issues.length > 0) {
        toast.error(issues[0]!.message)
        return
      }

      store.setModel(next) // 낙관적
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts?.summary })
        useEditorStore.getState().setSeq(seq)
      } catch (err) {
        const message = err instanceof Error ? err.message : '변경을 저장하지 못했습니다'
        toast.error(message)
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        useEditorStore.getState().setLoaded(fresh.model, fresh.seq)
      }
    },
    [projectId, mutation, queryClient, trpc],
  )
}
```

- [ ] **Step 5: 라우트 재구성 — 설정 분리, 프로젝트 페이지를 에디터 셸로**

`apps/web/src/pages/project-settings.tsx`를 만들고, 현재 `project.tsx`의 **프로젝트 메타(이름·설명·방언·내 역할 헤더) + ProjectMembers 섹션**을 그대로 옮긴다(AppShell 안에서 렌더, 상단에 "← 에디터로" 링크 `to={/p/${projectId}}`). `ProjectMembers` 컴포넌트도 이 파일로 이동.

`apps/web/src/pages/project.tsx`는 에디터 셸로 재작성(Task 2에서 캔버스를 채움 — 지금은 뼈대):
```tsx
import { Link, useParams } from 'react-router'
import { Settings } from 'lucide-react'
import { useModelLoader } from '@/editor/use-model'
import { useEditorStore } from '@/editor/store'
import { BrandWordmark } from '@/components/brand-mark'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)

  if (load.isError) {
    return <p role="alert" className="p-8 text-destructive">{load.error.message}</p>
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-4">
          <Link to="/" aria-label="홈으로"><BrandWordmark /></Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/p/${projectId}/settings`}><Settings /> 설정</Link>
          </Button>
          <UserMenu />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* Task 5: 좌측 트리 · Task 2: 캔버스 · Task 4: 편집 패널 */}
        {loaded
          ? <div className="flex-1" data-testid="editor-canvas-slot" />
          : <div className="flex flex-1 items-center justify-center text-muted-foreground">불러오는 중…</div>}
      </div>
    </div>
  )
}
```

`apps/web/src/routes.tsx`: `/p/:projectId` 유지(위 에디터 셸), `/p/:projectId/settings`를 `<Protected><ProjectSettingsPage /></Protected>`로 추가(import). 에디터는 AppShell로 감싸지 않으므로 `/p/:projectId`의 Protected는 RequireAuth만 적용하도록 조정 — 즉 `<RequireAuth><ProjectPage /></RequireAuth>`(AppShell 없이). RequireAuth를 직접 쓰거나, Protected에 `bare?: boolean`을 추가해 AppShell을 생략할 수 있게 한다(택1, 보고서에 기록).

- [ ] **Step 6: 테스트·타입체크 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS(기존 8 + use-model 3). settings 이동으로 깨진 기존 테스트가 있으면 import 경로만 갱신.

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): 에디터 기반 — 모델 스토어, producer+diff mutate 훅, 라우트 재구성"
```

---

### Task 2: 캔버스 + TableNode + 보기 모드

**Files:**
- Create: `apps/web/src/editor/table-node.tsx`, `apps/web/src/editor/canvas.tsx`, `apps/web/src/editor/view-mode-toggle.tsx`, `apps/web/src/editor/nodes.ts`
- Modify: `apps/web/src/pages/project.tsx`(캔버스·보기 모드 배치), `apps/web/src/styles/globals.css`(React Flow 스타일 import)
- Test: `apps/web/src/editor/table-node.test.tsx`

**Interfaces:**
- Consumes: store, core 타입.
- Produces:
  - `<TableNode data={{ table, columns, viewMode, selected }} />` — 핸들 없는 순수 표현.
  - `buildNodes(model, viewMode, selectedId): Node[]`(`nodes.ts`) — React Flow 노드 배열(position은 model.tables[].position).
  - `<Canvas projectId />` — ReactFlow + Background + MiniMap + Controls, 노드는 store에서 파생.
  - `<ViewModeToggle />`.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/editor/table-node.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TableNode } from './table-node.js'

const DATA = {
  table: {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null,
  },
  columns: [
    { id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
      type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
      defaultValue: null, order: 0, comment: null },
    { id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
      type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 1, comment: null },
  ],
  selected: false,
}

describe('TableNode', () => {
  it('shows physical names in physical mode', () => {
    render(<TableNode data={{ ...DATA, viewMode: 'physical' }} />)
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_NO')).toBeInTheDocument()
    expect(screen.getByText('VARCHAR(100)')).toBeInTheDocument()
  })

  it('shows logical names in logical mode', () => {
    render(<TableNode data={{ ...DATA, viewMode: 'logical' }} />)
    expect(screen.getByText('회원')).toBeInTheDocument()
    expect(screen.getByText('회원번호')).toBeInTheDocument()
  })

  it('shows both names in mixed mode and marks the PK column', () => {
    render(<TableNode data={{ ...DATA, viewMode: 'mixed' }} />)
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('회원')).toBeInTheDocument()
    // PK 컬럼은 접근성 레이블로 표시
    expect(screen.getByLabelText('기본 키')).toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(모듈 없음).

- [ ] **Step 2: TableNode 구현**

`apps/web/src/editor/table-node.tsx`:
```tsx
import { KeyRound } from 'lucide-react'
import type { Column, Table } from '@erdd/core'
import { cn } from '@/lib/utils'
import type { ViewMode } from './store.js'

export type TableNodeData = {
  table: Table
  columns: Column[]
  viewMode: ViewMode
  selected: boolean
}

function name(logical: string, physical: string, mode: ViewMode) {
  if (mode === 'logical') return logical
  if (mode === 'physical') return physical
  return null // mixed는 둘 다 표시
}

export function TableNode({ data }: { data: TableNodeData }) {
  const { table, columns, viewMode, selected } = data
  const sorted = [...columns].sort((a, b) => a.order - b.order)
  const mixed = viewMode === 'mixed'

  return (
    <div
      className={cn(
        'min-w-48 overflow-hidden rounded-lg border bg-card shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="border-b bg-secondary/60 px-3 py-2">
        {mixed ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-bold">{table.physicalName}</span>
            <span className="text-xs text-muted-foreground">{table.logicalName}</span>
          </div>
        ) : (
          <span className={cn('text-sm font-bold', viewMode === 'physical' && 'font-mono')}>
            {name(table.logicalName, table.physicalName, viewMode)}
          </span>
        )}
      </div>
      <ul className="divide-y">
        {sorted.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="flex w-4 shrink-0 justify-center">
              {c.isPk && <KeyRound className="size-3 text-key" aria-label="기본 키" />}
            </span>
            {mixed ? (
              <span className="flex-1 truncate">
                <span className="font-mono">{c.physicalName}</span>{' '}
                <span className="text-muted-foreground">{c.logicalName}</span>
              </span>
            ) : (
              <span className={cn('flex-1 truncate', viewMode === 'physical' && 'font-mono')}>
                {name(c.logicalName, c.physicalName, viewMode)}
              </span>
            )}
            <span className="shrink-0 font-mono text-muted-foreground">{c.type}</span>
            {!c.nullable && <span className="shrink-0 text-[10px] text-muted-foreground">NN</span>}
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">컬럼 없음</li>
        )}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: nodes.ts, canvas, view-mode-toggle 구현**

`apps/web/src/editor/nodes.ts`:
```ts
import type { Node } from '@xyflow/react'
import type { ProjectModel } from '@erdd/core'
import type { TableNodeData } from './table-node.js'
import type { ViewMode } from './store.js'

export function buildNodes(
  model: ProjectModel, viewMode: ViewMode, selectedId: string | null,
): Node<TableNodeData>[] {
  return Object.values(model.tables).map((table) => ({
    id: table.id,
    type: 'table',
    position: table.position,
    data: {
      table,
      columns: Object.values(model.columns).filter((c) => c.tableId === table.id),
      viewMode,
      selected: table.id === selectedId,
    },
  }))
}
```

`apps/web/src/editor/view-mode-toggle.tsx`:
```tsx
import { useEditorStore, type ViewMode } from './store.js'
import { Button } from '@/components/ui/button'

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'logical', label: '논리명' },
  { value: 'physical', label: '물리명' },
  { value: 'mixed', label: '혼합' },
]

export function ViewModeToggle() {
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  return (
    <div className="flex rounded-md border p-0.5">
      {MODES.map((m) => (
        <Button
          key={m.value} size="sm"
          variant={viewMode === m.value ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          onClick={() => setViewMode(m.value)}
        >
          {m.label}
        </Button>
      ))}
    </div>
  )
}
```

`apps/web/src/editor/canvas.tsx`:
```tsx
import { useEffect, useMemo } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow, useNodesState, type Node, type NodeChange,
} from '@xyflow/react'
import { useEditorStore } from './store.js'
import { buildNodes } from './nodes.js'
import { TableNode, type TableNodeData } from './table-node.js'

const nodeTypes = { table: TableNode }

export function Canvas() {
  const model = useEditorStore((s) => s.model)
  const viewMode = useEditorStore((s) => s.viewMode)
  const selectedId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)

  const derived = useMemo(
    () => buildNodes(model, viewMode, selectedId),
    [model, viewMode, selectedId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>(derived)

  // 스토어(구조/보기 모드/선택)가 바뀌면 노드를 재구성한다.
  useEffect(() => { setNodes(derived) }, [derived, setNodes])

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange as (c: NodeChange[]) => void}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <MiniMap pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
```
(주: Task 3에서 `onNodeDragStop`으로 이동 영속화를 추가한다. `onNodesChange`는 드래그 중 로컬 위치 갱신용.)

`apps/web/src/styles/globals.css` 상단 import에 추가:
```css
@import '@xyflow/react/dist/style.css';
```

- [ ] **Step 4: project.tsx에 배치**

`project.tsx`의 `data-testid="editor-canvas-slot"` div를 `<ReactFlowProvider><Canvas /></ReactFlowProvider>`로 교체하고(`import { ReactFlowProvider } from '@xyflow/react'`), 헤더 우측 그룹 앞에 `<ViewModeToggle />` 추가.

- [ ] **Step 5: 테스트·타입체크 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS(TableNode 3건 추가).

```bash
git add apps/web
git commit -m "feat(web): 캔버스와 테이블 노드 — 컬럼·PK·타입 렌더, 보기 모드"
```

---

### Task 3: 테이블 생성·이동·삭제

**Files:**
- Create: `apps/web/src/editor/model-edits.ts`, `apps/web/src/editor/toolbar.tsx`
- Modify: `apps/web/src/editor/canvas.tsx`(onNodeDragStop), `apps/web/src/pages/project.tsx`(툴바)
- Test: `apps/web/src/editor/model-edits.test.ts`

**Interfaces:**
- Consumes: core 타입, `newId`.
- Produces: 순수 모델 변형 함수(producer로 넘길 것) — `addTable(model, {id, position}) → model`, `moveTable(model, id, position) → model`, `removeTable(model, id) → model`(소속 컬럼·인덱스도 제거; 관계는 M4b라 없음). Task 4가 컬럼용 변형을 추가한다.
- 툴바에 "테이블 추가" 버튼, 캔버스 드래그 종료 시 이동 영속화, 선택 테이블 삭제.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/editor/model-edits.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, diffModels } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { addTable, moveTable, removeTable } from './model-edits.js'

describe('model-edits', () => {
  it('addTable inserts a table with a default physical name', () => {
    const m = addTable(createEmptyModel(), { id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']).toMatchObject({ id: 't-new', position: { x: 10, y: 20 } })
    expect(m.tables['t-new']!.physicalName).not.toBe('')
    // diff가 정확히 create 1건
    const ops = diffModels(createEmptyModel(), m)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('create')
  })

  it('moveTable changes only the position (one update op)', () => {
    const base = buildSampleModel()
    const id = Object.keys(base.tables)[0]!
    const next = moveTable(base, id, { x: 999, y: 888 })
    const ops = diffModels(base, next)
    expect(ops).toEqual([
      { action: 'update', entity: 'table', entityId: id,
        changes: { position: { from: base.tables[id]!.position, to: { x: 999, y: 888 } } } },
    ])
  })

  it('removeTable cascades its columns (delete ops child-first)', () => {
    const base = buildSampleModel()
    // 관계·인덱스가 없는 테이블을 고른다: t1(MBR_GRD)은 인덱스 없음이나 관계 자식이므로,
    // 여기서는 관계·인덱스가 얽히지 않도록 새 독립 테이블을 만들어 검증
    const withT = addTable(base, { id: 'tx', position: { x: 0, y: 0 } })
    const next = removeTable(withT, 'tx')
    expect(next.tables['tx']).toBeUndefined()
    const ops = diffModels(withT, next)
    expect(ops.every((o) => o.action === 'delete')).toBe(true)
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(모듈 없음).

- [ ] **Step 2: model-edits 구현**

`apps/web/src/editor/model-edits.ts`:
```ts
import type { Position, ProjectModel, Table } from '@erdd/core'

/** 새 테이블(컬럼 없음). 물리명은 임시 기본값 — 편집 패널에서 바꾼다. */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const n = Object.keys(model.tables).length + 1
  const table: Table = {
    id, logicalName: `테이블${n}`, physicalName: `TABLE_${n}`,
    comment: null, groupId: null, position, groupPosition: null,
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}

export function moveTable(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, position } } }
}

/** 테이블과 그 소속 컬럼·인덱스를 제거한다(관계는 M4b). */
export function removeTable(model: ProjectModel, id: string): ProjectModel {
  const columns = Object.fromEntries(
    Object.entries(model.columns).filter(([, c]) => c.tableId !== id),
  )
  const indexes = Object.fromEntries(
    Object.entries(model.indexes).filter(([, ix]) => ix.tableId !== id),
  )
  const tables = { ...model.tables }
  delete tables[id]
  return { ...model, tables, columns, indexes }
}
```

- [ ] **Step 3: 툴바와 캔버스 이동/삭제 배선**

`apps/web/src/editor/toolbar.tsx`:
```tsx
import { Plus, Trash2 } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { addTable, removeTable } from './model-edits.js'
import { Button } from '@/components/ui/button'

export function Toolbar({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)
  const rf = useReactFlow()

  const onAdd = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2, y: window.innerHeight / 2,
    })
    void mutate((m) => addTable(m, { id, position: center }), { summary: '테이블 추가' })
    select(id)
  }
  const onDelete = () => {
    if (!selectedTableId) return
    const id = selectedTableId
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      <Button size="sm" variant="outline" disabled={!selectedTableId} onClick={onDelete}>
        <Trash2 /> 삭제
      </Button>
    </div>
  )
}
```

`canvas.tsx`에 이동 영속화 추가 — `useModelMutation`을 받아 `onNodeDragStop` 핸들러 추가:
```tsx
// Canvas가 projectId를 prop으로 받도록 변경: export function Canvas({ projectId }: { projectId: string })
// 내부:
import { useModelMutation } from './use-model.js'
import { moveTable } from './model-edits.js'
// ...
const mutate = useModelMutation(projectId)
// ReactFlow에 추가:
  onNodeDragStop={(_, node) =>
    void mutate((m) => moveTable(m, node.id, { x: node.position.x, y: node.position.y }),
      { summary: '테이블 이동' })
  }
```
`project.tsx`에서 `<Canvas projectId={projectId} />`로 전달하고, 헤더에 `<ReactFlowProvider>` 안에서 `<Toolbar projectId={projectId} />`가 `useReactFlow`를 쓸 수 있도록 배치(툴바·캔버스 모두 ReactFlowProvider 하위). 즉 헤더의 좌측 그룹을 Provider 안으로 옮기거나, Provider를 셸 전체로 승격. **ReactFlowProvider를 `<div className="flex min-h-0 flex-1">` 상위(헤더 포함)로 올려** 툴바와 캔버스가 같은 컨텍스트를 공유하게 한다.

- [ ] **Step 4: 테스트·타입체크 통과 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS(model-edits 3건).

```bash
git add apps/web
git commit -m "feat(web): 테이블 생성·이동·삭제 — 툴바와 드래그 영속화"
```

---

### Task 4: 편집 패널 — 테이블·컬럼 CRUD

**Files:**
- Create: `apps/web/src/editor/edit-panel.tsx`, `apps/web/src/editor/column-edits.ts`
- Modify: `apps/web/src/editor/model-edits.ts`(테이블 필드 업데이트 추가), `apps/web/src/pages/project.tsx`(우측 패널)
- Test: `apps/web/src/editor/column-edits.test.ts`, `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Produces:
  - model-edits: `updateTable(model, id, patch: Partial<Pick<Table,'logicalName'|'physicalName'|'comment'>>) → model`.
  - column-edits: `addColumn(model, tableId, {id}) → model`(기본 컬럼, order=마지막), `updateColumn(model, id, patch) → model`, `removeColumn(model, id) → model`, `reorderColumn(model, id, dir: -1|1) → model`.
  - `<EditPanel projectId />` — 선택 테이블의 논리/물리명·설명 필드, 컬럼 목록(논리/물리명·타입·PK·NN 인라인 편집, 추가/삭제/순서). 선택 없으면 안내.

- [ ] **Step 1: 실패하는 테스트 작성 (column-edits)**

`apps/web/src/editor/column-edits.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { addColumn, removeColumn, reorderColumn, updateColumn } from './column-edits.js'

describe('column-edits', () => {
  it('addColumn appends with the next order', () => {
    const base = buildSampleModel()
    const m = addColumn(base, 't2', { id: 'c-new' })
    const cols = Object.values(m.columns).filter((c) => c.tableId === 't2')
    const added = m.columns['c-new']!
    expect(added.order).toBe(Math.max(...cols.filter((c) => c.id !== 'c-new').map((c) => c.order)) + 1)
    expect(added.type).not.toBe('')
  })

  it('updateColumn patches fields', () => {
    const base = buildSampleModel()
    const m = updateColumn(base, 'c3', { logicalName: '고객명', isPk: true })
    expect(m.columns['c3']).toMatchObject({ logicalName: '고객명', isPk: true })
  })

  it('removeColumn drops the column', () => {
    const base = buildSampleModel()
    const m = removeColumn(base, 'c3')
    expect(m.columns['c3']).toBeUndefined()
  })

  it('reorderColumn swaps order with the neighbor in the same table', () => {
    const base = buildSampleModel()
    // t2: c2(0), c3(1), c4(2)
    const m = reorderColumn(base, 'c3', -1)
    expect(m.columns['c3']!.order).toBe(0)
    expect(m.columns['c2']!.order).toBe(1)
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL.

- [ ] **Step 2: column-edits · model-edits 구현**

`apps/web/src/editor/column-edits.ts`:
```ts
import type { Column, ProjectModel } from '@erdd/core'

function tableColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.tableId === tableId)
}

export function addColumn(
  model: ProjectModel, tableId: string, { id }: { id: string },
): ProjectModel {
  const siblings = tableColumns(model, tableId)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.order)) + 1
  const n = siblings.length + 1
  const column: Column = {
    id, tableId, logicalName: `컬럼${n}`, physicalName: `COL_${n}`,
    type: 'VARCHAR(255)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order, comment: null,
  }
  return { ...model, columns: { ...model.columns, [id]: column } }
}

export function updateColumn(
  model: ProjectModel, id: string,
  patch: Partial<Omit<Column, 'id' | 'tableId'>>,
): ProjectModel {
  const column = model.columns[id]
  if (!column) return model
  return { ...model, columns: { ...model.columns, [id]: { ...column, ...patch } } }
}

export function removeColumn(model: ProjectModel, id: string): ProjectModel {
  const columns = { ...model.columns }
  delete columns[id]
  return { ...model, columns }
}

/** 같은 테이블 내 인접 컬럼과 order를 교환한다. dir: -1 위로, +1 아래로. */
export function reorderColumn(model: ProjectModel, id: string, dir: -1 | 1): ProjectModel {
  const column = model.columns[id]
  if (!column) return model
  const siblings = tableColumns(model, column.tableId).sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((c) => c.id === id)
  const neighbor = siblings[idx + dir]
  if (!neighbor) return model
  return {
    ...model,
    columns: {
      ...model.columns,
      [column.id]: { ...column, order: neighbor.order },
      [neighbor.id]: { ...neighbor, order: column.order },
    },
  }
}
```

`apps/web/src/editor/model-edits.ts`에 추가:
```ts
export function updateTable(
  model: ProjectModel, id: string,
  patch: Partial<Pick<Table, 'logicalName' | 'physicalName' | 'comment'>>,
): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, ...patch } } }
}
```

- [ ] **Step 3: EditPanel 구현과 실패 테스트**

`apps/web/src/editor/edit-panel.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { EditPanel } from './edit-panel.js'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<EditPanel projectId="018f6b0e-0000-7000-8000-0000000000aa" />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('EditPanel', () => {
  it('prompts to select a table when nothing is selected', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    renderPanel()
    expect(screen.getByText(/테이블을 선택/)).toBeInTheDocument()
  })

  it('edits the table physical name and sends a mutation', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('물리명') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER')
    await userEvent.tab() // blur → commit
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  it('adds a column via the add button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    useEditorStore.getState().select('t1')
    renderPanel()
    const before = Object.values(useEditorStore.getState().model.columns)
      .filter((c) => c.tableId === 't1').length
    await userEvent.click(screen.getByRole('button', { name: '컬럼 추가' }))
    await waitFor(() => {
      const after = Object.values(useEditorStore.getState().model.columns)
        .filter((c) => c.tableId === 't1').length
      expect(after).toBe(before + 1)
    })
  })
})
```

`apps/web/src/editor/edit-panel.tsx`:
```tsx
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { Column } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { updateTable } from './model-edits.js'
import { addColumn, removeColumn, reorderColumn, updateColumn } from './column-edits.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** blur 시 값이 바뀌었으면 producer로 커밋하는 제어 인풋. */
function CommitInput(props: {
  id?: string; label?: string; value: string; mono?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <Input
      id={props.id}
      defaultValue={props.value}
      key={props.value}
      className={props.mono ? 'font-mono' : undefined}
      onBlur={(e) => {
        if (e.target.value !== props.value) props.onCommit(e.target.value)
      }}
    />
  )
}

export function EditPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const mutate = useModelMutation(projectId)
  const table = selectedTableId ? model.tables[selectedTableId] : undefined

  if (!table) {
    return (
      <aside className="w-80 shrink-0 border-l bg-card p-4">
        <p className="text-sm text-muted-foreground">테이블을 선택하면 여기서 편집합니다.</p>
      </aside>
    )
  }

  const columns = Object.values(model.columns)
    .filter((c) => c.tableId === table.id)
    .sort((a, b) => a.order - b.order)
  const tid = table.id

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tbl-logical">논리명</Label>
          <CommitInput id="tbl-logical" value={table.logicalName}
            onCommit={(v) => void mutate((m) => updateTable(m, tid, { logicalName: v }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="물리명-tbl">물리명</Label>
          <CommitInput id="물리명-tbl" value={table.physicalName} mono
            onCommit={(v) => void mutate((m) => updateTable(m, tid, { physicalName: v }))} />
          {/* 접근성: 테스트가 getByLabelText('물리명')로 찾도록 aria-label 부여 */}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold">컬럼</h3>
        <Button size="sm" variant="outline"
          onClick={() => void mutate((m) => addColumn(m, tid, { id: newId() }), { summary: '컬럼 추가' })}>
          <Plus /> 컬럼 추가
        </Button>
      </div>

      <ul className="mt-2 grid gap-3">
        {columns.map((c, i) => (
          <ColumnRow
            key={c.id} column={c} isFirst={i === 0} isLast={i === columns.length - 1}
            onPatch={(patch) => void mutate((m) => updateColumn(m, c.id, patch))}
            onRemove={() => void mutate((m) => removeColumn(m, c.id), { summary: '컬럼 삭제' })}
            onMove={(dir) => void mutate((m) => reorderColumn(m, c.id, dir))}
          />
        ))}
        {columns.length === 0 && <li className="text-xs text-muted-foreground">컬럼이 없습니다.</li>}
      </ul>
    </aside>
  )
}

function ColumnRow(props: {
  column: Column; isFirst: boolean; isLast: boolean
  onPatch: (patch: Partial<Omit<Column, 'id' | 'tableId'>>) => void
  onRemove: () => void; onMove: (dir: -1 | 1) => void
}) {
  const { column: c } = props
  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="grid grid-cols-2 gap-2">
        <CommitInput label="논리명" value={c.logicalName} onCommit={(v) => props.onPatch({ logicalName: v })} />
        <CommitInput label="물리명" value={c.physicalName} mono onCommit={(v) => props.onPatch({ physicalName: v })} />
      </div>
      <CommitInput label="타입" value={c.type} mono onCommit={(v) => props.onPatch({ type: v })} />
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={c.isPk} onChange={(e) => props.onPatch({ isPk: e.target.checked })} /> PK
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!c.nullable} onChange={(e) => props.onPatch({ nullable: !e.target.checked })} /> NN
        </label>
        <span className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" className="size-6" disabled={props.isFirst}
            aria-label="위로" onClick={() => props.onMove(-1)}><ChevronUp className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-6" disabled={props.isLast}
            aria-label="아래로" onClick={() => props.onMove(1)}><ChevronDown className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-6 text-destructive"
            aria-label="컬럼 삭제" onClick={props.onRemove}><Trash2 className="size-3" /></Button>
        </span>
      </div>
    </li>
  )
}
```
(주: 테이블 물리명 인풋의 `getByLabelText('물리명')`가 컬럼 행의 "물리명"과 충돌하지 않도록, 테이블 물리명 Label의 htmlFor/텍스트를 유지하되 테스트는 첫 번째 매치를 쓰거나 `getAllByLabelText`로 조정. 구현자는 테스트가 안정적으로 테이블 물리명을 집도록 Label 텍스트를 "테이블 물리명"으로 바꾸고 테스트의 `getByLabelText('물리명')`도 그에 맞춰 조정할 것 — 테스트-구현 정합만 맞추면 됨. 컬럼 행 CommitInput의 label prop은 aria-label로 렌더하지 않으므로 현재 충돌 없음.)

- [ ] **Step 4: project.tsx에 우측 패널 배치**

`project.tsx`의 캔버스 우측에 `<EditPanel projectId={projectId} />` 추가(flex row: 좌측 트리(Task 5)·캔버스·우측 패널).

- [ ] **Step 5: 테스트·타입체크 통과 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS(column-edits 4 + edit-panel 3).

```bash
git add apps/web
git commit -m "feat(web): 편집 패널 — 테이블 필드와 컬럼 CRUD"
```

---

### Task 5: 좌측 테이블 트리 + 검색·포커스, 전체 빌드 스모크

**Files:**
- Create: `apps/web/src/editor/table-tree.tsx`
- Modify: `apps/web/src/editor/store.ts`(focusTableId + focus 액션 — 캔버스 포커스 신호), `apps/web/src/editor/canvas.tsx`(focus 신호 수신 → fitView/center), `apps/web/src/pages/project.tsx`(좌측 트리)
- Test: `apps/web/src/editor/table-tree.test.tsx`

**Interfaces:**
- Produces: `<TableTree />` — 검색 인풋 + 테이블 목록(물리명 mono + 논리명). 클릭 → `select(id)` + `focus(id)`. store에 `focusTableId`와 `focus(id)`/`consumeFocus()` 추가(캔버스가 소비). 검색은 논리명·물리명 부분일치.

- [ ] **Step 1: store에 focus 추가**

`store.ts`에 `focusTableId: string | null`, `focus: (id) => set({ focusTableId: id, selectedTableId: id })`, `consumeFocus: () => set({ focusTableId: null })` 추가(reset에도 포함).

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/web/src/editor/table-tree.test.tsx`:
```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { TableTree } from './table-tree.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('TableTree', () => {
  it('lists tables and filters by search (logical or physical)', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    render(<TableTree />)
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('테이블 검색'), '등급')
    expect(screen.queryByText('MBR')).not.toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
  })

  it('selects and focuses a table on click', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1)
    render(<TableTree />)
    await userEvent.click(screen.getByText('MBR'))
    expect(useEditorStore.getState().selectedTableId).toBe('t2')
    expect(useEditorStore.getState().focusTableId).toBe('t2')
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL.

- [ ] **Step 3: TableTree 구현**

`apps/web/src/editor/table-tree.tsx`:
```tsx
import { useState } from 'react'
import { useEditorStore } from './store.js'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function TableTree() {
  const model = useEditorStore((s) => s.model)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const focus = useEditorStore((s) => s.focus)
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const tables = Object.values(model.tables)
    .filter((t) =>
      query === '' ||
      t.physicalName.toLowerCase().includes(query) ||
      t.logicalName.toLowerCase().includes(query),
    )
    .sort((a, b) => a.physicalName.localeCompare(b.physicalName))

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="border-b p-2">
        <Input placeholder="테이블 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {tables.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => focus(t.id)}
              className={cn(
                'flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent',
                t.id === selectedTableId && 'bg-accent',
              )}
            >
              <span className="font-mono text-xs font-medium">{t.physicalName}</span>
              <span className="text-xs text-muted-foreground">{t.logicalName}</span>
            </button>
          </li>
        ))}
        {tables.length === 0 && (
          <li className="p-3 text-center text-xs text-muted-foreground">
            {Object.keys(model.tables).length === 0 ? '테이블을 추가해 설계를 시작하세요.' : '검색 결과가 없습니다.'}
          </li>
        )}
      </ul>
    </aside>
  )
}
```

`canvas.tsx`에 focus 소비 추가 — `useReactFlow`의 `setCenter`/`fitView`로 해당 노드로 이동:
```tsx
// Canvas 내부:
const focusTableId = useEditorStore((s) => s.focusTableId)
const consumeFocus = useEditorStore((s) => s.consumeFocus)
const rf = useReactFlow()
useEffect(() => {
  if (!focusTableId) return
  const node = rf.getNode(focusTableId)
  if (node) rf.setCenter(node.position.x + 120, node.position.y + 60, { zoom: 1, duration: 400 })
  consumeFocus()
}, [focusTableId, rf, consumeFocus])
```
(`import { useReactFlow } from '@xyflow/react'`, `useEffect` 추가.)

- [ ] **Step 4: project.tsx에 좌측 트리 배치, 전체 빌드**

`project.tsx`의 flex row에 `<TableTree />`를 캔버스 좌측에 배치. 최종 레이아웃: `[TableTree | ReactFlowProvider(Toolbar in header + Canvas) | EditPanel]`.

Run:
```bash
pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck && pnpm --filter @erdd/web build
pnpm test && pnpm typecheck   # 루트 전체(서버·core 회귀 없음; 서버 통합은 DATABASE_URL 없이 스킵 무방)
```
Expected: 전부 통과.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 좌측 테이블 트리와 검색·포커스 이동"
```

---

## 완료 기준 (M4a Definition of Done)

- `pnpm --filter @erdd/web test`(신규 유닛 테스트 포함), typecheck, build 통과. 루트 테스트·타입체크 통과(server 36·core 43 유지).
- 컨트롤러 Playwright 스모크(실서버): 로그인 → 프로젝트 진입 → 테이블 추가 → 드래그 이동(새로고침 후 위치 유지) → 편집 패널에서 논리/물리명·컬럼(추가·PK·타입) 편집 → 보기 모드 전환(논리/물리/혼합) → 트리 검색·클릭 포커스 → 설정 페이지 왕복까지 동작. 변경이 revision.list에 쌓임.
- 디자인 계약 준수: 팔레트 토큰만, 물리명·타입 font-mono, 캔버스 도면 배경, TableNode 시그니처.
- 모든 모델 변경이 producer+diff(useModelMutation) 단일 경로를 지난다.
