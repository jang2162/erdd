# CLI 로컬 모드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `erdd serve` 하나로 백엔드·DB·계정 없이 `erdd/` 파일을 진실 원천 삼아 기존 웹 에디터를 브라우저에 띄운다.

**Architecture:** CLI 안(`packages/cli/src/local/`)에 Fastify + 축소 tRPC 라우터를 두고, `FileStore` 가 `erdd/` YAML 과 `erdd/layout.yaml` 을 읽어 `ProjectModel` 을 메모리에 든다. `model.mutate` 는 `applyOps` → 메모리 갱신 → 디바운스 파일 쓰기로 끝난다. 파일 감시가 외부 변경을 잡아 SSE 로 브라우저에 `reload` 를 보낸다. `apps/server` 는 `auth.me` 의 `mode` 필드 1줄만 바뀐다.

**Tech Stack:** TypeScript(ESM, `tsx` 로 직접 실행) · Fastify 5 · tRPC 11 · zod 4 · yaml 2 · vitest 4 · React 19 + TanStack Query 5

**Spec:** `docs/superpowers/specs/2026-08-20-cli-local-mode-design.md`

## Global Constraints

- **응답·주석·커밋 메시지·문서는 한국어로 쓴다.**
- **`packages/core` 는 IO·런타임 의존성 free 다.** YAML·파일시스템·Fastify 를 core 에 들이지 않는다. dagre 도 들이지 않는다(웹 전용).
- **`apps/server` 변경은 `auth.me` 한 줄뿐이다.** 그 밖의 서버 파일을 고치지 않는다.
- **작업은 워크트리에서 한다.** `git worktree add -b feat/cli-local-mode .worktrees/feat-cli-local-mode main` 로 만들고 그 안에서 `pnpm install` 을 먼저 실행한다.
- **커밋은 경로 지정으로 한다** — `git commit -m "..." -- <경로들>`. `git add -A`/`git commit -a` 를 쓰지 않는다.
- 커밋 메시지 말미에 트레일러 2줄을 붙인다.
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c
  ```
- **`.idea/*` 와 루트 `.env` 는 커밋하지 않는다.**
- 테스트 실행: `pnpm -C packages/core test` · `pnpm -C packages/cli test` · `pnpm -C apps/web test`. 단일 파일은 `pnpm -C <패키지> exec vitest run <경로>`.
- 타입 검사: `pnpm -r typecheck`.
- **`apps/server` 테스트는 `DATABASE_URL` 을 직접 줘야 한다** — 이 트랙은 서버를 1줄만 고치므로 서버 테스트는 돌리지 않아도 된다(마지막 Task 에서 typecheck 로만 확인).

---

## 파일 구조

**신규**

| 파일 | 책임 |
|---|---|
| `packages/core/src/layout.ts` | 좌표·메모의 모델 ↔ 평문 데이터 변환(순수 함수). 격자 기본 배치 |
| `packages/core/src/layout.test.ts` | 위 테스트 |
| `packages/cli/src/local/store.ts` | `FileStore` — 로드/저장/디바운스/직렬화/읽기 전용 상태 |
| `packages/cli/src/local/store.test.ts` | 위 테스트 |
| `packages/cli/src/local/router.ts` | 축소 tRPC 라우터 |
| `packages/cli/src/local/router.test.ts` | 라우터 동작 + 계약 잠금 |
| `packages/cli/src/local/server.ts` | Fastify 조립 — 정적 서빙·리다이렉트·SSE·감시 배선 |
| `packages/cli/src/local/server.test.ts` | 위 테스트 |
| `packages/cli/src/local/watch.ts` | 파일 감시(디바운스 + 자기 쓰기 무시) |
| `packages/cli/src/local/watch.test.ts` | 위 테스트 |
| `packages/cli/src/commands/serve.ts` | `erdd serve` 명령 |
| `packages/cli/src/commands/serve.test.ts` | 위 테스트 |
| `apps/web/src/editor/use-local-watch.ts` | SSE 구독 → 모델 resync |
| `apps/web/src/editor/use-local-watch.test.tsx` | 위 테스트 |

**변경**

| 파일 | 변경 |
|---|---|
| `packages/core/src/index.ts` | `layout.js` re-export |
| `packages/cli/src/config.ts` | `serverUrl`·`projectId` optional, `LOCAL_PROJECT_ID` |
| `packages/cli/src/commands/context.ts` | `clientFor` 에 연결 설정 가드 |
| `packages/cli/src/commands/status.ts` | 연결 설정 없을 때의 출력 |
| `packages/cli/src/commands/init.ts` | `--local` 경로 |
| `packages/cli/src/main.ts` | `serve` 배차 · `--local`·`--port`·`--no-open` · USAGE |
| `packages/cli/package.json` | `fastify`·`@trpc/server`·`@fastify/static` 런타임 의존, `@erdd/server` 타입 전용 devDependency |
| `apps/server/src/routers/auth.ts` | `me` 에 `mode: 'server'` |
| `apps/web/src/components/require-auth.tsx` | `Me` 에 `mode` |
| `apps/web/src/editor/header-tools.tsx` | 로컬 모드에서 「공용 리소스」 제외 |
| `apps/web/src/editor/version-dialog.tsx` | 로컬 모드에서 「이력」 탭 제외 |
| `apps/web/src/components/app-shell.tsx` | 로컬 모드에서 `PendingPromotionsBadge` 제외 |
| `apps/web/src/pages/project-settings.tsx` | 로컬 모드에서 `ProjectMembers` 제외 |
| `apps/web/src/pages/project.tsx` | presence·사용자 메뉴 제외, 감시 훅 |
| `apps/web/src/routes.tsx` | 로컬 모드의 `/` 리다이렉트 |
| `docs/16-cli.md` · `docs/manual/cli-guide.md` · `docs/02-architecture.md` · `docs/superpowers/HANDOFF.md` | 문서 |

---

## Task 1: core — 좌표·메모 직렬화(`layout.ts`)

**Files:**
- Create: `packages/core/src/layout.ts`
- Create: `packages/core/src/local.ts`
- Test: `packages/core/src/layout.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ProjectModel`·`Position`·`Note`(`./model.js`)
- Produces:
  ```ts
  export type TableLayout = { id: string; name: string; position: Position; groupPosition: Position | null }
  export type LayoutData = { tables: TableLayout[]; notes: Note[] }
  export function layoutFromModel(model: ProjectModel): LayoutData
  export function applyLayout(model: ProjectModel, layout: LayoutData): ProjectModel
  // local.ts
  export const LOCAL_PROJECT_ID: string
  ```

  `LOCAL_PROJECT_ID` 가 core 에 있는 이유는 **CLI 와 웹이 함께 써야 하기 때문이다.** 로컬 서버는 이
  id 로 라우팅하고, 웹은 로컬 모드에서 `/` 를 `/p/<id>` 로 보낼 때 같은 값이 필요하다. 웹이
  `@erdd/cli` 를 의존하게 만들 수는 없고 core 는 이미 양쪽의 공통 의존이다.

**배경(구현자가 알아야 할 것):** ⚠️ **격자 배치를 새로 만들지 마라.** core 에 `gridPositions(server, count)`(`file-merge.ts:341`)가
이미 있다 — CLI push 가 좌표 없는 신규 테이블을 **기존 테이블 아래** 격자에 놓는 데 쓰는 함수다.
같은 문제이므로 그대로 쓴다. 그러면 layout 에 좌표가 있는 테이블과 겹치지도 않는다.

`erdd/` 의 테이블 YAML 은 **스키마만** 담는다 — 배치 좌표와 메모는
일부러 뺐다(테이블을 옮기기만 해도 스키마 파일이 diff 에 뜨는 것을 막으려고). 그래서 `filesToModel` 은
모든 테이블에 `position: {x:0, y:0}` 을 준다(`file-format.ts:435`). 로컬 모드는 그 둘을 `erdd/layout.yaml`
에 따로 담는데, **YAML 인코딩은 core 밖(CLI)에서 한다** — core 는 IO free 다. 이 파일은 모델 ↔ 평문
객체 변환만 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyLayout, layoutFromModel, type LayoutData } from './layout.js'
import { createEmptyModel, type ProjectModel, type Table } from './model.js'

function tbl(id: string, physicalName: string, over: Partial<Table> = {}): Table {
  return {
    id, logicalName: id, physicalName, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {}, ...over,
  }
}

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t2'] = tbl('t2', 'ORD', { position: { x: 300, y: 40 }, groupPosition: { x: 12, y: 34 } })
  m.tables['t1'] = tbl('t1', 'MBR', { position: { x: 100, y: 20 } })
  m.notes['n1'] = { id: 'n1', content: '정산 배치는 매일 02:00', position: { x: 400, y: 200 }, color: '#fde68a' }
  return m
}

describe('layoutFromModel', () => {
  it('테이블 좌표와 메모를 모은다', () => {
    const layout = layoutFromModel(model())
    expect(layout.tables).toEqual([
      { id: 't1', name: 'MBR', position: { x: 100, y: 20 }, groupPosition: null },
      { id: 't2', name: 'ORD', position: { x: 300, y: 40 }, groupPosition: { x: 12, y: 34 } },
    ])
    expect(layout.notes).toEqual([
      { id: 'n1', content: '정산 배치는 매일 02:00', position: { x: 400, y: 200 }, color: '#fde68a' },
    ])
  })

  // 정렬이 흔들리면 아무것도 안 바꿔도 git diff 가 뜬다.
  it('물리명 오름차순으로 정렬해 diff 를 안정시킨다', () => {
    const m = createEmptyModel()
    m.tables['z'] = tbl('z', 'AAA')
    m.tables['a'] = tbl('a', 'ZZZ')
    expect(layoutFromModel(m).tables.map((t) => t.name)).toEqual(['AAA', 'ZZZ'])
  })

  it('물리명이 같으면 id 로 갈라 결정적으로 정렬한다', () => {
    const m = createEmptyModel()
    m.tables['b'] = tbl('b', 'SAME')
    m.tables['a'] = tbl('a', 'SAME')
    expect(layoutFromModel(m).tables.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('applyLayout', () => {
  it('좌표와 메모를 모델에 되꽂는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'MBR')
    const layout: LayoutData = {
      tables: [{ id: 't1', name: 'MBR', position: { x: 7, y: 8 }, groupPosition: { x: 1, y: 2 } }],
      notes: [{ id: 'n9', content: '메모', position: { x: 5, y: 6 }, color: '#fff' }],
    }
    const next = applyLayout(m, layout)
    expect(next.tables['t1']!.position).toEqual({ x: 7, y: 8 })
    expect(next.tables['t1']!.groupPosition).toEqual({ x: 1, y: 2 })
    expect(next.notes['n9']).toEqual(layout.notes[0])
  })

  // 테이블이 지워진 뒤 layout 에 남은 잔재.
  it('모델에 없는 테이블 항목은 버린다', () => {
    const m = createEmptyModel()
    const next = applyLayout(m, {
      tables: [{ id: 'gone', name: 'GONE', position: { x: 1, y: 1 }, groupPosition: null }],
      notes: [],
    })
    expect(next.tables).toEqual({})
  })

  // filesToModel 이 전부 (0,0) 을 주므로, 이게 없으면 pull 직후 모든 테이블이 한 점에 겹친다.
  it('layout 에 없는 테이블은 서로 겹치지 않게 놓는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'AAA')
    m.tables['t2'] = tbl('t2', 'BBB')
    const next = applyLayout(m, { tables: [], notes: [] })
    expect(next.tables['t1']!.position).not.toEqual(next.tables['t2']!.position)
  })

  it('배치가 결정적이다 — 두 번 불러도 같다', () => {
    const m = createEmptyModel()
    m.tables['z'] = tbl('z', 'AAA')
    m.tables['a'] = tbl('a', 'ZZZ')
    const once = applyLayout(m, { tables: [], notes: [] })
    const twice = applyLayout(m, { tables: [], notes: [] })
    expect(once.tables['z']!.position).toEqual(twice.tables['z']!.position)
    expect(once.tables['a']!.position).toEqual(twice.tables['a']!.position)
  })

  it('layout 에 있는 테이블은 덮어쓰지 않고, 없는 것은 그 아래에 놓는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'AAA')
    m.tables['t2'] = tbl('t2', 'BBB')
    const next = applyLayout(m, {
      tables: [{ id: 't1', name: 'AAA', position: { x: 100, y: 100 }, groupPosition: null }],
      notes: [],
    })
    expect(next.tables['t1']!.position).toEqual({ x: 100, y: 100 })
    // gridPositions 는 기존 테이블의 아래(최대 y + 간격)에서 시작한다 — 겹치지 않는다.
    expect(next.tables['t2']!.position.y).toBeGreaterThan(100)
  })

  it('입력 모델을 변형하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'MBR')
    applyLayout(m, { tables: [{ id: 't1', name: 'MBR', position: { x: 7, y: 8 }, groupPosition: null }], notes: [] })
    expect(m.tables['t1']!.position).toEqual({ x: 0, y: 0 })
  })
})

describe('왕복', () => {
  it('layoutFromModel → applyLayout 이 좌표·메모를 보존한다', () => {
    const m = model()
    const back = applyLayout(model(), layoutFromModel(m))
    expect(back.tables['t1']!.position).toEqual(m.tables['t1']!.position)
    expect(back.tables['t2']!.groupPosition).toEqual(m.tables['t2']!.groupPosition)
    expect(back.notes).toEqual(m.notes)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/layout.test.ts`
Expected: FAIL — `Failed to resolve import "./layout.js"`

- [ ] **Step 3: 구현한다**

`packages/core/src/layout.ts`:

```ts
import { gridPositions } from './file-merge.js'
import type { Note, Position, ProjectModel } from './model.js'

export type TableLayout = {
  id: string
  /** 사람이 읽기 위한 값. identity 는 id 다 — 물리명이 바뀌어도 매칭에 쓰지 않는다. */
  name: string
  position: Position
  groupPosition: Position | null
}

export type LayoutData = {
  tables: TableLayout[]
  notes: Note[]
}

/**
 * 물리명 오름차순, 같으면 id 오름차순. **정렬이 흔들리면 아무것도 안 바꿔도 git diff 가 뜬다** —
 * layout.yaml 은 커밋 대상이므로 순서가 계약이다.
 */
function orderedTables(model: ProjectModel) {
  return Object.values(model.tables).sort((a, b) =>
    a.physicalName === b.physicalName
      ? (a.id < b.id ? -1 : 1)
      : (a.physicalName < b.physicalName ? -1 : 1))
}

export function layoutFromModel(model: ProjectModel): LayoutData {
  return {
    tables: orderedTables(model).map((t) => ({
      id: t.id,
      name: t.physicalName,
      position: { ...t.position },
      groupPosition: t.groupPosition === null ? null : { ...t.groupPosition },
    })),
    notes: Object.values(model.notes)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((n) => ({ ...n, position: { ...n.position } })),
  }
}

/**
 * layout 의 좌표를 모델에 되꽂는다. **layout 에 없는 테이블은 이미 놓인 것들 아래 격자에 둔다** —
 * `filesToModel` 은 모든 테이블에 `{x:0, y:0}` 을 주므로(file-format.ts) 그대로 두면 `erdd pull`
 * 직후 모든 테이블이 한 점에 겹쳐 아무것도 읽을 수 없다.
 *
 * 격자는 `gridPositions`(file-merge.ts) 를 그대로 쓴다 — CLI push 가 좌표 없는 신규 테이블을
 * 놓는 데 쓰는 같은 함수다. 더 나은 배치는 에디터의 「자동 정렬」(dagre)이 하고 **dagre 는
 * apps/web 전용이다** — core 에 들이지 않는다.
 */
export function applyLayout(model: ProjectModel, layout: LayoutData): ProjectModel {
  const byId = new Map(layout.tables.map((t) => [t.id, t]))
  const tables: ProjectModel['tables'] = {}
  const missing: string[] = []

  // 순회는 **물리명 순서**다 — 객체 키 순서(= 파일을 읽은 순서)에 기대면 파일 하나를 고칠 때마다
  // 남의 테이블 자리가 움직인다.
  for (const t of orderedTables(model)) {
    const entry = byId.get(t.id)
    if (entry === undefined) {
      missing.push(t.id)
      tables[t.id] = { ...t, groupPosition: null }
      continue
    }
    tables[t.id] = {
      ...t,
      position: { ...entry.position },
      groupPosition: entry.groupPosition === null ? null : { ...entry.groupPosition },
    }
  }

  if (missing.length > 0) {
    // 좌표가 정해진 것들만 놓고 그 아래에서 시작한다 — 이미 놓인 테이블과 겹치지 않는다.
    const placed = Object.fromEntries(
      Object.entries(tables).filter(([id]) => !missing.includes(id)),
    )
    const spots = gridPositions({ ...model, tables: placed }, missing.length)
    missing.forEach((id, i) => { tables[id] = { ...tables[id]!, position: spots[i]! } })
  }

  const notes: ProjectModel['notes'] = {}
  for (const n of layout.notes) notes[n.id] = { ...n, position: { ...n.position } }
  return { ...model, tables, notes }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/layout.test.ts`
Expected: PASS (12건 — `LOCAL_PROJECT_ID` 케이스 포함)

- [ ] **Step 5: 고정 프로젝트 id 상수를 둔다**

`packages/core/src/local.ts`:

```ts
/**
 * 연결 설정이 없는 로컬 전용 프로젝트가 쓰는 고정 프로젝트 id.
 *
 * **실행마다 새로 만들지 않는다** — 바뀌면 사용자가 북마크한 주소와 브라우저에 남은 상태가
 * 매번 무효가 된다. 웹 라우트(`/p/:projectId`)와 서버 프로시저의 입력이 uuid 를 요구하므로
 * uuid 형식이어야 한다.
 *
 * CLI(로컬 서버의 라우팅)와 웹(로컬 모드의 `/` 리다이렉트)이 함께 쓰므로 core 에 둔다.
 */
export const LOCAL_PROJECT_ID = '00000000-0000-7000-8000-000000000000'
```

테스트는 `layout.test.ts` 끝에 한 건만 둔다.

```ts
import { LOCAL_PROJECT_ID } from './local.js'

describe('LOCAL_PROJECT_ID', () => {
  it('uuid 형식이다 — 웹 라우트와 프로시저 입력이 uuid 를 요구한다', () => {
    expect(LOCAL_PROJECT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
```

- [ ] **Step 6: core 에서 re-export 한다**

`packages/core/src/index.ts` 의 export 목록에 한 줄을 더한다(알파벳/기존 배치 관례를 따라 넣는다).

```ts
export {
  applyLayout, layoutFromModel,
  type LayoutData, type TableLayout,
} from './layout.js'
export { LOCAL_PROJECT_ID } from './local.js'
```

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `pnpm -C packages/core test && pnpm -C packages/core typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat(core): 배치 좌표·메모의 직렬화를 순수 함수로 낸다

로컬 모드는 파일 포맷이 일부러 뺀 좌표·메모를 erdd/layout.yaml 에 따로
담는다. 그 변환 규칙만 core 에 두고 YAML 인코딩은 CLI 가 한다.

layout 에 없는 테이블은 격자에 놓는다 — filesToModel 이 전부 (0,0) 을
주므로 그대로 두면 pull 직후 모든 테이블이 한 점에 겹친다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/core/src/layout.ts packages/core/src/local.ts packages/core/src/layout.test.ts packages/core/src/index.ts
```

---

## Task 2: CLI — 연결 설정을 선택 값으로 완화

**Files:**
- Modify: `packages/cli/src/config.ts`
- Modify: `packages/cli/src/commands/context.ts`
- Modify: `packages/cli/src/commands/status.ts`
- Test: `packages/cli/src/config.test.ts`(기존 파일에 추가), `packages/cli/src/commands/commands.test.ts`(기존 파일에 추가)

**Interfaces:**
- Consumes: `ErddConfig`(현재 `serverUrl: string; projectId: string`)
- Produces:
  ```ts
  export type ErddConfig = {
    serverUrl: string | null
    projectId: string | null
    dialects: Dialect[]
    namingRules: NamingRules
  }
  /** core 의 것을 그대로 re-export 한다(CLI 안에서 짧게 쓰기 위해). 정의는 Task 1 의 core/local.ts. */
  export { LOCAL_PROJECT_ID } from '@erdd/core'
  export function requireConnection(config: ErddConfig): { serverUrl: string; projectId: string }
  ```

**배경:** 지금 `readConfig`(`packages/cli/src/config.ts:43`)는 `serverUrl`·`projectId` 가 없으면
`VALIDATION` 으로 던진다. 로컬 모드에서는 둘이 없어도 되고, **서버가 필요한 명령이 그때 실패**해야
한다. 서버를 쓰는 명령은 전부 `clientFor`(`commands/context.ts`)를 지나가므로 가드는 그 한 곳이면
된다. `status` 만 예외로 `config.serverUrl` 을 직접 읽어 출력한다.

`LOCAL_PROJECT_ID` 는 Task 1 에서 `@erdd/core` 에 두었다 — 웹도 같은 값이 필요하기 때문이다.
여기서는 `export { LOCAL_PROJECT_ID } from '@erdd/core'` 한 줄로 re-export 만 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/config.test.ts` 끝에 추가한다(파일 상단의 기존 import 에 `requireConnection`,
`LOCAL_PROJECT_ID` 를 더한다 — 기존 테스트가 쓰는 헬퍼·픽스처는 그대로 쓴다):

```ts
describe('연결 설정이 없는 config', () => {
  const localYaml = [
    'dialects: [postgresql]',
    'namingRules:',
    '  case: UPPER_SNAKE',
    '  separator: _',
    '  maxLengthBytes: 30',
    '',
  ].join('\n')

  it('serverUrl·projectId 가 없어도 읽힌다', async () => {
    const dir = await tmpdir()
    await writeFile(join(dir, CONFIG_FILE), localYaml, 'utf8')
    const config = await readConfig(dir)
    expect(config.serverUrl).toBeNull()
    expect(config.projectId).toBeNull()
    expect(config.dialects).toEqual(['postgresql'])
  })

  it('둘 중 하나만 있으면 거절한다 — 오타를 로컬 모드로 삼키지 않는다', async () => {
    const dir = await tmpdir()
    await writeFile(join(dir, CONFIG_FILE), `serverUrl: https://e.example.com\n${localYaml}`, 'utf8')
    await expect(readConfig(dir)).rejects.toThrow(/serverUrl.*projectId|projectId.*serverUrl/)
  })

  it('requireConnection 이 연결 설정 없음을 NO_CONFIG 로 알린다', () => {
    expect(() => requireConnection({
      serverUrl: null, projectId: null, dialects: ['postgresql'],
      namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30, logicalSeparator: '' },
    })).toThrow(/erdd init/)
  })

  it('requireConnection 은 값이 있으면 그대로 돌려준다', () => {
    expect(requireConnection({
      serverUrl: 'https://e.example.com', projectId: 'p1', dialects: ['postgresql'],
      namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30, logicalSeparator: '' },
    })).toEqual({ serverUrl: 'https://e.example.com', projectId: 'p1' })
  })

  it('config 모듈이 LOCAL_PROJECT_ID 를 넘겨준다', () => {
    expect(LOCAL_PROJECT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
```

> ⚠️ `tmpdir()`·`CONFIG_FILE`·`writeFile`·`join` 은 이 파일이 이미 쓰는 헬퍼다. 파일을 열어 기존
> 이름을 확인하고 그대로 쓴다. `namingRules` 리터럴의 필드도 기존 테스트에서 쓰는 형태를 그대로
> 베낀다(`logicalSeparator` 의 기본값이 `''` 인지 확인할 것).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/config.test.ts`
Expected: FAIL — `requireConnection` 미정의, `serverUrl` 없으면 던짐

- [ ] **Step 3: 구현한다**

`packages/cli/src/config.ts`:

```ts
export type ErddConfig = {
  /** 로컬 전용 프로젝트에는 없다. 서버가 필요한 명령은 requireConnection 을 지난다. */
  serverUrl: string | null
  projectId: string | null
  dialects: Dialect[]
  namingRules: NamingRules
}

// 정의는 core 에 있다(웹도 같은 값을 쓴다). 여기서는 CLI 안에서 짧게 쓰기 위해 넘겨만 준다.
export { LOCAL_PROJECT_ID } from '@erdd/core'
```

`readConfig` 안의 검증을 아래로 바꾼다.

```ts
  const { serverUrl, projectId, dialects, namingRules } = parsed
  const hasServer = typeof serverUrl === 'string'
  const hasProject = typeof projectId === 'string'
  // 둘 다 없으면 로컬 전용이다. **하나만 있는 것은 오타로 본다** — 삼키면 사용자는 서버에 붙은
  // 줄 알고 편집하다 push 할 때가 되어서야 연결이 없다는 것을 안다.
  if (hasServer !== hasProject) {
    throw new CliError(
      'VALIDATION',
      `${CONFIG_FILE}에 serverUrl과 projectId는 함께 있어야 합니다(둘 다 없으면 로컬 전용입니다)`,
    )
  }
```

그리고 반환에서 `serverUrl: hasServer ? serverUrl : null`, `projectId: hasProject ? projectId : null`
로 넘긴다(기존 반환 리터럴을 찾아 그 두 필드만 고친다).

파일 끝에 가드를 더한다.

```ts
/** 서버가 필요한 명령의 단일 관문. 여기 하나면 pull·push·diff 가 같은 문구로 실패한다. */
export function requireConnection(config: ErddConfig): { serverUrl: string; projectId: string } {
  if (config.serverUrl === null || config.projectId === null) {
    throw new CliError(
      'NO_CONFIG',
      `${CONFIG_FILE}에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요`,
    )
  }
  return { serverUrl: config.serverUrl, projectId: config.projectId }
}
```

- [ ] **Step 4: 호출부를 고친다**

`packages/cli/src/commands/context.ts` 의 `clientFor`:

```ts
export async function clientFor(ctx: CommandCtx): Promise<ApiClient> {
  if (ctx.client !== undefined) return ctx.client
  const config = await readConfig(ctx.cwd)
  const { serverUrl } = requireConnection(config)
  return createClient(serverUrl, await resolveToken(ctx.cwd))
}
```

(import 에 `requireConnection` 을 더한다.)

`packages/cli/src/commands/status.ts` 의 human/JSON 출력에서 `config.serverUrl`·`config.projectId` 가
`null` 일 수 있게 한다.

```ts
    const human = [
      config.serverUrl === null ? '서버   (로컬 전용 — 연결 설정 없음)' : `서버   ${config.serverUrl}`,
      config.projectId === null ? '프로젝트 (로컬 전용)' : `프로젝트 ${config.projectId}`,
      ...
```

JSON 쪽은 이미 `config.serverUrl` 을 그대로 싣고 있으므로 타입만 따라온다(값이 `null` 이 된다).

- [ ] **Step 5: `projectId` 를 쓰던 다른 자리를 타입 검사로 훑는다**

Run: `pnpm -C packages/cli typecheck`
Expected: `pull`·`push`·`diff` 에서 `string | null` 을 `string` 에 넣는 오류가 뜬다.
각 자리에서 `readConfig` 직후 `const { projectId } = requireConnection(config)` 를 쓰도록 고친다.
**`?? ''` 나 `!` 로 덮지 않는다** — 그러면 연결 없이 서버를 부르는 경로가 조용히 살아난다.

- [ ] **Step 6: 연결 없을 때 pull 이 실패하는 테스트를 더한다**

`packages/cli/src/commands/commands.test.ts` 에 추가한다(이 파일이 이미 쓰는 하네스
`packages/cli/src/testing/harness.ts` 의 헬퍼를 그대로 쓴다 — 파일을 열어 이름을 확인할 것):

```ts
it('연결 설정이 없으면 pull 이 NO_CONFIG 로 실패한다', async () => {
  const dir = await tmpdir()
  await writeFile(join(dir, CONFIG_FILE), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  const code = await pull({ cwd: dir, json: true, yes: true, strict: false })
  expect(code).toBe(1)
})
```

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `pnpm -C packages/cli test && pnpm -r typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat(cli): 연결 설정을 선택 값으로 완화한다

로컬 전용 프로젝트에는 serverUrl·projectId 가 없다. 서버가 필요한 명령은
clientFor 한 곳의 requireConnection 가드에서 같은 문구로 실패한다.

둘 중 하나만 있는 것은 오타로 보고 거절한다 — 삼키면 사용자는 서버에
붙은 줄 알고 편집하다 push 할 때가 되어서야 연결이 없다는 것을 안다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/config.ts packages/cli/src/config.test.ts packages/cli/src/commands/context.ts packages/cli/src/commands/status.ts packages/cli/src/commands/commands.test.ts packages/cli/src/commands/pull.ts packages/cli/src/commands/push.ts packages/cli/src/commands/diff.ts
```

---

## Task 3: CLI — `erdd init --local`

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/main.ts`
- Test: `packages/cli/src/commands/init.test.ts`(기존 파일에 추가)

**Interfaces:**
- Consumes: `ErddConfig`·`LOCAL_PROJECT_ID`(Task 2), `writeConfig`(`config.ts` 의 기존 함수 — 이름을 파일에서 확인할 것)
- Produces: `init` 이 `ctx.local === true` 일 때 서버 호출 없이 config 를 만든다.

**배경:** 기존 `init` 은 서버 URL·토큰을 묻고 프로젝트를 고르게 한 뒤 `erdd.config.yaml` 을 쓴다.
`--local` 은 그 왕복을 전부 건너뛰고 방언·명명 규칙 기본값만 담은 config 와 빈 `erdd/` 를 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/commands/init.test.ts` 에 추가한다:

```ts
describe('init --local', () => {
  it('서버 호출 없이 연결 설정 없는 config 를 만든다', async () => {
    const dir = await tmpdir()
    const code = await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(code).toBe(0)
    const config = await readConfig(dir)
    expect(config.serverUrl).toBeNull()
    expect(config.projectId).toBeNull()
    expect(config.dialects.length).toBeGreaterThan(0)
  })

  it('.gitignore 에 .erdd/ 를 넣는다', async () => {
    const dir = await tmpdir()
    await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toContain('.erdd/')
  })

  it('이미 config 가 있으면 덮어쓰지 않고 실패한다', async () => {
    const dir = await tmpdir()
    await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    const code = await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(code).toBe(1)
  })
})
```

> ⚠️ 세 번째 케이스는 기존 `init` 이 이미 그렇게 동작할 수도 있다. 먼저 확인하고, 이미 있다면
> **`--local` 경로에도 같은 가드가 걸리는지**를 이 테스트가 잠근다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/commands/init.test.ts`
Expected: FAIL — `local` 이 `CommandCtx` 에 없음(타입 오류) 또는 서버 호출 시도

- [ ] **Step 3: 구현한다**

`packages/cli/src/commands/context.ts` 의 `CommandCtx` 에 필드를 더한다.

```ts
  /** init --local: 서버 연결 없이 로컬 전용 프로젝트를 만든다. serve: 브라우저를 열지 않는다 등. */
  local?: boolean
  port?: number
  open?: boolean
```

`packages/cli/src/commands/init.ts` 의 `init` 본문 맨 앞에 분기를 둔다.

```ts
    if (ctx.local === true) {
      // 서버 왕복이 전부 없다. 방언·명명 규칙은 기본값으로 시작하고, 이후 GUI 의 설정 화면이나
      // erdd.config.yaml 직접 편집으로 바꾼다.
      await writeConfig(ctx.cwd, {
        serverUrl: null,
        projectId: null,
        dialects: ['postgresql'],
        namingRules: DEFAULT_NAMING_RULES,
      })
      await ensureGitignore(ctx.cwd)
      emit(ctx.json, `로컬 전용 프로젝트를 만들었습니다. erdd serve 로 여세요`, { local: true })
      return 0
    }
```

> `writeConfig`·`ensureGitignore`·`DEFAULT_NAMING_RULES` 의 실제 이름은 `config.ts` 와 기존
> `init.ts` 를 열어 확인하고 그대로 쓴다. 기존 init 이 `.gitignore` 를 다루는 코드를 이미 갖고
> 있으면 그것을 함수로 뽑아 두 경로가 공유하게 한다 — **같은 규칙이 두 벌이 되면 안 된다.**
> config 존재 확인 가드도 이 분기보다 **앞에** 있어야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/commands/init.test.ts`
Expected: PASS

- [ ] **Step 5: `main.ts` 에 플래그를 배선한다**

`--local` 을 boolean 플래그로 읽어 `init` 에 넘긴다(기존 `--yes`·`--strict` 를 읽는 방식을 그대로
따른다: `argv.includes('--local')`). USAGE 의 `init` 줄 아래에 옵션 설명을 더한다.

```
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
```

- [ ] **Step 6: 전체 테스트**

Run: `pnpm -C packages/cli test && pnpm -C packages/cli typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(cli): erdd init --local 로 서버 없이 프로젝트를 시작한다

서버 URL·토큰·프로젝트 선택 왕복을 전부 건너뛰고 연결 설정 없는 config 와
.gitignore 만 만든다. 방언·명명 규칙은 기본값에서 시작한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/commands/init.ts packages/cli/src/commands/init.test.ts packages/cli/src/commands/context.ts packages/cli/src/main.ts
```

---

## Task 4: 로컬 — `FileStore` 로드

**Files:**
- Create: `packages/cli/src/local/store.ts`
- Test: `packages/cli/src/local/store.test.ts`

**Interfaces:**
- Consumes: `readTree`·`writeTree`(`../tree.js`) · `filesToModel`·`modelToFiles`·`applyLayout`·`layoutFromModel`·`validateModelIntegrity`(`@erdd/core`) · `readConfig`(`../config.js`)
- Produces:
  ```ts
  export const LAYOUT_FILE = 'erdd/layout.yaml'
  export type LoadFailure = { path: string; message: string }
  export type StoreState =
    | { ok: true; model: ProjectModel; seq: number }
    | { ok: false; model: ProjectModel; seq: number; failures: LoadFailure[] }
  export class FileStore {
    constructor(cwd: string)
    load(): Promise<StoreState>
    get state(): StoreState
    /** 마지막 load 가 읽은 디스크 내용이 **우리가 마지막으로 쓴 것과 같은가.** Task 5 에서 채운다. */
    get isSelfWrite(): boolean
  }
  ```

**배경:** `readTree` 는 `erdd/tables/*.yaml` 과 최상위 5개만 읽는다 — `layout.yaml` 은 **읽지 않는다.**
`FileStore` 가 그 파일을 따로 읽어 `applyLayout` 으로 모델에 꽂는다.

`filesToModel` 은 파일에 `id` 가 없는 객체에 `new:` 접두 임시 id 를 준다. **그 상태로 GUI 에 띄우면
안 된다** — 에이전트가 손으로 쓴 새 테이블을 GUI 가 임시 id 로 편집하면 다음 로드에서 다른 객체가
된다. 로드 시 `newId: uuidv7` 을 넘겨 처음부터 최종 id 로 조립하고, `assignedTree`(id 를 채운 트리)가
입력과 다르면 **파일에 되쓴다.** CLI push 의 `reserve-ids.ts` 가 같은 문제를 같은 방식으로 닫는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/store.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileStore } from './store.js'

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-local-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body, 'utf8')
  }
  return dir
}

const MBR = [
  'id: 018f6b0e-0000-7000-8000-000000000001',
  'name: MBR',
  'logicalName: 회원',
  'columns:',
  '  - id: 018f6b0e-0000-7000-8000-000000000002',
  '    name: MBR_NO',
  '    logicalName: 회원번호',
  '    type: BIGINT',
  '    pk: true',
  '',
].join('\n')

describe('FileStore.load', () => {
  it('빈 디렉터리에서 빈 모델로 시작한다', async () => {
    const store = new FileStore(await project({}))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(s.model.tables).toEqual({})
    expect(s.seq).toBe(0)
  })

  it('테이블 파일을 모델로 읽는다', async () => {
    const store = new FileStore(await project({ 'erdd/tables/MBR.yaml': MBR }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(Object.values(s.model.tables)[0]!.physicalName).toBe('MBR')
  })

  it('layout.yaml 의 좌표와 메모를 모델에 꽂는다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': [
        'tables:',
        '  - id: 018f6b0e-0000-7000-8000-000000000001',
        '    name: MBR',
        '    position: { x: 120, y: 80 }',
        'notes:',
        '  - id: 018f6b0e-0000-7000-8000-000000000009',
        '    content: 메모',
        '    position: { x: 5, y: 6 }',
        "    color: '#fde68a'",
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position).toEqual({ x: 120, y: 80 })
    expect(Object.values(s.model.notes)[0]!.content).toBe('메모')
  })

  it('layout.yaml 이 없어도 모델을 연다', async () => {
    const store = new FileStore(await project({ 'erdd/tables/MBR.yaml': MBR }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    // 좌표는 gridPositions 가 정한다 — 구체적 값이 아니라 "숫자로 정해졌다"만 잠근다.
    const pos = s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true)
  })

  it('id 없는 신규 객체에 uuid 를 발급하고 파일에 되쓴다', async () => {
    const dir = await project({
      'erdd/tables/ORD.yaml': ['name: ORD', 'logicalName: 주문', 'columns: []', ''].join('\n'),
    })
    const s = await new FileStore(dir).load()
    expect(s.ok).toBe(true)
    const written = await readFile(join(dir, 'erdd/tables/ORD.yaml'), 'utf8')
    expect(written).toMatch(/id: [0-9a-f-]{36}/)
    // 되쓴 id 가 메모리 모델의 id 와 같아야 한다 — 다르면 다음 로드에서 다른 객체가 된다.
    expect(written).toContain(Object.keys(s.model.tables)[0]!)
  })

  it('layout.yaml 의 망가진 항목은 걸러 격자로 떨어뜨린다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': [
        'tables:',
        '  - id: 018f6b0e-0000-7000-8000-000000000001',
        '    name: MBR',
        '    position: { x: 몰라, y: 80 }',   // 숫자가 아니다
        'notes:',
        '  - id: n1',                          // content·position·color 가 없다
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    // 좌표만 잃고 격자로 떨어진다 — 파일 전체를 거절하지 않는다.
    const pos = s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true)
    expect(s.model.notes).toEqual({})
  })

  it('layout.yaml 자체가 깨져도 모델은 연다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': 'tables: [불완전\n',
    }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(Object.values(s.model.tables)[0]!.physicalName).toBe('MBR')
  })

  it('YAML 이 깨지면 실패를 알리고 마지막 정상 모델을 유지한다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    const first = await store.load()
    expect(first.ok).toBe(true)

    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    const second = await store.load()
    expect(second.ok).toBe(false)
    // 모델은 직전 정상값 그대로다 — 성한 메모리 모델로 깨진 파일을 덮어쓰면 안 되므로
    // 호출자가 이 상태에서 쓰기를 막는다.
    expect(Object.values(second.model.tables)[0]!.physicalName).toBe('MBR')
    expect(store.state.ok).toBe(false)
  })

  it('참조 무결성이 깨져도 실패로 본다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': [
        'id: 018f6b0e-0000-7000-8000-000000000001',
        'name: MBR',
        'logicalName: 회원',
        'columns: []',
        'relations:',
        '  - to: NOPE',
        '    columns: { A: B }',
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.ok).toBe(false)
  })

  it('깨진 파일이 고쳐지면 다시 정상으로 돌아온다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    expect((await store.load()).ok).toBe(false)
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), MBR, 'utf8')
    expect((await store.load()).ok).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store.js"`

- [ ] **Step 3: 구현한다**

`packages/cli/src/local/store.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { uuidv7 } from 'uuidv7'
import {
  applyLayout, createEmptyModel, filesToModel, validateModelIntegrity,
  type FileTree, type LayoutData, type Note, type Position, type ProjectModel, type TableLayout,
} from '@erdd/core'
import { canonical, readTree } from '../tree.js'

export const LAYOUT_FILE = 'erdd/layout.yaml'

export type LoadFailure = { path: string; message: string }

export type StoreState =
  | { ok: true; model: ProjectModel; seq: number }
  | { ok: false; model: ProjectModel; seq: number; failures: LoadFailure[] }

const EMPTY_LAYOUT: LayoutData = { tables: [], notes: [] }

/** 자기 쓰기 판정용 정규화 서명. 키 순서·표현 차이를 지운다. */
function signatureOf(tree: FileTree, layout: LayoutData): string {
  return canonical({ ...tree, [LAYOUT_FILE]: layout }, LAYOUT_FILE) ?? ''
}

/** layout.yaml 은 스키마 파일이 아니다 — 깨져 있으면 배치만 잃고 모델은 연다. */
async function readLayout(cwd: string): Promise<LayoutData> {
  let raw: string
  try {
    raw = await readFile(join(cwd, LAYOUT_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_LAYOUT
    throw err
  }
  try {
    const parsed: unknown = parseYaml(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_LAYOUT
    const rec = parsed as Record<string, unknown>
    return {
      tables: asArray(rec['tables']).filter(isTableLayout),
      notes: asArray(rec['notes']).filter(isNote),
    }
  } catch {
    return EMPTY_LAYOUT
  }
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const isPosition = (v: unknown): v is Position =>
  typeof v === 'object' && v !== null
  && typeof (v as Position).x === 'number' && Number.isFinite((v as Position).x)
  && typeof (v as Position).y === 'number' && Number.isFinite((v as Position).y)

/**
 * layout.yaml 은 사람이 손으로 고칠 수 있는 커밋 대상 파일이다. 좌표가 없거나 숫자가 아닌
 * 항목을 그냥 통과시키면 `position` 이 `{}` 인 테이블이 모델에 들어가 캔버스가 NaN 으로 깨진다.
 * **거른 항목은 좌표만 잃고 격자로 떨어진다** — 파일 전체를 거절하지 않는다.
 */
function isTableLayout(v: unknown): v is TableLayout {
  if (typeof v !== 'object' || v === null) return false
  const t = v as TableLayout
  if (typeof t.id !== 'string' || t.id === '') return false
  if (!isPosition(t.position)) return false
  return t.groupPosition === null || t.groupPosition === undefined || isPosition(t.groupPosition)
}

function isNote(v: unknown): v is Note {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Note
  return typeof n.id === 'string' && n.id !== ''
    && typeof n.content === 'string' && typeof n.color === 'string' && isPosition(n.position)
}

export class FileStore {
  #cwd: string
  #state: StoreState = { ok: true, model: createEmptyModel(), seq: 0 }
  /** flush 가 마지막으로 디스크에 쓴 내용의 정규화 서명. */
  #written = ''
  /** 마지막 load 가 읽은 것이 그 서명과 같았는가. */
  #selfWrite = false

  constructor(cwd: string) {
    this.#cwd = cwd
  }

  get cwd(): string { return this.#cwd }
  get state(): StoreState { return this.#state }

  /**
   * 마지막 `load()` 가 읽은 디스크 내용이 **우리가 마지막으로 쓴 것과 같은가.**
   *
   * 감시 이벤트가 자기 쓰기인지 남의 변경인지 가르는 값이다. ⚠️ `load()` 전후의 서명을
   * 비교하는 방식으로는 판정할 수 없다 — 서명은 `flush()` 만 바꾸므로 언제나 같다.
   * **읽은 것**과 **쓴 것**을 비교해야 한다. 로드가 실패하면 언제나 `false` 다(파일이 깨진 것은
   * 자기 쓰기로 설명되지 않으므로 반드시 알려야 한다).
   */
  get isSelfWrite(): boolean { return this.#selfWrite }

  /**
   * 파일에서 모델을 다시 읽는다. **실패해도 마지막 정상 모델을 버리지 않는다** — 호출자가
   * `ok:false` 인 동안 쓰기를 막으므로, 성한 메모리 모델로 깨진 파일을 덮어쓰는 일이 생기지 않는다.
   */
  async load(): Promise<StoreState> {
    const seq = this.#state.seq
    const fail = (failures: LoadFailure[]): StoreState => {
      // 깨진 파일은 자기 쓰기로 설명되지 않는다 — 반드시 알려야 하므로 언제나 false 다.
      this.#selfWrite = false
      this.#state = { ok: false, model: this.#state.model, seq, failures }
      return this.#state
    }

    let tree
    try {
      tree = await readTree(this.#cwd)
    } catch (err) {
      return fail([{ path: 'erdd/', message: (err as Error).message }])
    }

    // newId 를 넘겨 **처음부터 최종 id 로** 조립한다. 나중에 리맵하면 참조 필드 하나만
    // 빠뜨려도 조용히 깨진다(file-format.ts 의 주석과 같은 이유).
    const result = filesToModel(tree, { newId: uuidv7 })
    if (!result.ok) {
      return fail(result.issues.map((i) => ({ path: i.path, message: i.message })))
    }

    const issues = validateModelIntegrity(result.model)
    if (issues.length > 0) {
      return fail(issues.map((i) => ({ path: 'erdd/', message: i.message })))
    }

    // 발급한 id 를 파일에 되쓴다. 안 쓰면 다음 로드가 또 새 id 를 발급해 같은 테이블이
    // 매번 다른 객체가 된다(CLI push 의 reserve-ids 와 같은 문제).
    if (result.assignedTree !== undefined) {
      for (const [rel, content] of Object.entries(result.assignedTree)) {
        if (tree[rel] === content) continue
        const abs = join(this.#cwd, rel)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, stringifyYaml(content), 'utf8')
      }
    }

    const layout = await readLayout(this.#cwd)
    // **읽은 것**의 서명을 **쓴 것**과 비교한다. 같으면 이 감시 이벤트는 자기 쓰기다.
    this.#selfWrite = signatureOf(tree, layout) === this.#written
    const model = applyLayout(result.model, layout)
    this.#state = { ok: true, model, seq }
    return this.#state
  }
}
```

> ⚠️ `assignedTree` 비교는 참조 비교로는 부족할 수 있다. `filesToModel` 은 `newId` 가 있으면
> **입력을 structuredClone 한 복사본**을 돌려주므로 모든 키가 새 객체다. `../tree.js` 의
> `canonical(value, path)` 로 정규화 문자열을 비교해 **실제로 바뀐 파일만** 쓴다.
> `if (canonical(tree[rel], rel) === canonical(content, rel)) continue` 로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/store.test.ts`
Expected: PASS (10건)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): 로컬 서버의 파일 저장소 로드를 넣는다

erdd/ 트리와 layout.yaml 을 읽어 모델을 만든다. id 없는 신규 객체에는
로드 시점에 uuid 를 발급해 파일에 되쓴다 — 안 쓰면 다음 로드가 또 새 id 를
발급해 같은 테이블이 매번 다른 객체가 된다.

파싱·무결성 실패는 마지막 정상 모델을 유지한 채 ok:false 로 알린다.
성한 메모리 모델로 깨진 파일을 덮어쓰지 않기 위해서다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/local/store.ts packages/cli/src/local/store.test.ts
```

---

## Task 5: 로컬 — `FileStore` 쓰기·직렬화·디바운스

**Files:**
- Modify: `packages/cli/src/local/store.ts`
- Test: `packages/cli/src/local/store.test.ts`(추가)

**Interfaces:**
- Produces (FileStore 에 추가):
  ```ts
  mutate(ops: Op[]): Promise<{ seq: number }>
  setModel(model: ProjectModel): Promise<{ seq: number }>   // 스냅샷 복원용
  flush(): Promise<void>
  ```
  `isSelfWrite`(Task 4)는 `flush()` 가 채우는 `#written` 서명에 기대므로 이 Task 에서 완성된다.

**배경:** 서버는 프로젝트 행 `FOR UPDATE` 락으로 mutation 을 직렬화한다. 로컬에는 DB 가 없으므로
**단일 promise 체인**이 그 자리를 대신한다. 테이블 드래그는 초당 수십 건의 mutate 를 내므로 디스크
쓰기는 **300ms 디바운스**하고, 프로세스 종료 시 `flush()` 한다.

`seq` 를 유지하는 이유는 웹의 낙관적 갱신 경로가 `seq !== seqBefore + 1` 로 "내 mutation 사이에 남의
변경이 끼어들었는가"를 판정하기 때문이다(`apps/web/src/editor/use-model.ts`). 로컬에 남은 없지만
**파일 감시로 인한 재로드**가 정확히 그 상황이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`store.test.ts` 에 추가한다(파일 상단 import 에 `parseOps`·`applyOps` 는 필요 없다 — op 리터럴을
직접 만든다. `Op` 타입은 `@erdd/core` 에서 가져온다):

```ts
import { MAX_OPS_PER_MUTATION, type Op } from '@erdd/core'

const createTable = (id: string, name: string): Op => ({
  kind: 'table',
  type: 'create',
  id,
  payload: {
    id, logicalName: name, physicalName: name, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  },
} as Op)

describe('FileStore.mutate', () => {
  it('op 을 적용하고 seq 를 올린다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const { seq } = await store.mutate([createTable('t1', 'MBR')])
    expect(seq).toBe(1)
    expect(store.state.model.tables['t1']!.physicalName).toBe('MBR')
  })

  it('flush 하면 파일에 쓴다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'MBR')])
    await store.flush()
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('name: MBR')
    expect(await readFile(join(dir, 'erdd/layout.yaml'), 'utf8')).toContain('t1')
  })

  it('연속 mutate 가 순서대로 적용된다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const results = await Promise.all([
      store.mutate([createTable('t1', 'A')]),
      store.mutate([createTable('t2', 'B')]),
      store.mutate([createTable('t3', 'C')]),
    ])
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(Object.keys(store.state.model.tables).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('읽기 전용 상태에서는 mutate 를 거절한다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    await store.load()
    await expect(store.mutate([createTable('t9', 'X')])).rejects.toThrow()
  })

  it('op 상한을 넘기면 거절한다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const many = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, (_, i) => createTable(`t${i}`, `T${i}`))
    await expect(store.mutate(many)).rejects.toThrow()
  })

  it('무결성을 깨는 op 은 거절하고 모델을 되돌린다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const bad = {
      kind: 'column', type: 'create', id: 'c1',
      payload: {
        id: 'c1', tableId: '없는테이블', logicalName: 'x', physicalName: 'X', type: 'TEXT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
        comment: null, domainId: null, custom: {},
      },
    } as Op
    await expect(store.mutate([bad])).rejects.toThrow()
    expect(store.state.model.columns).toEqual({})
  })

  it('setModel 이 모델을 통째로 갈아끼운다(스냅샷 복원)', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    await store.mutate([createTable('t1', 'MBR')])
    const snap = store.state.model
    await store.mutate([createTable('t2', 'ORD')])
    const { seq } = await store.setModel(snap)
    expect(seq).toBe(3)
    expect(Object.keys(store.state.model.tables)).toEqual(['t1'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/store.test.ts`
Expected: FAIL — `store.mutate is not a function`

- [ ] **Step 3: 구현한다**

`store.ts` 에 추가한다(import 에 `applyOps`·`modelToFiles`·`layoutFromModel`·`MAX_OPS_PER_MUTATION`·
`type Op` 를 더하고, `writeTree` 를 `../tree.js` 에서 가져온다 — `canonical` 은 Task 4 에서 이미
가져와 `signatureOf` 가 쓰고 있다):

```ts
const WRITE_DEBOUNCE_MS = 300

export class LocalStoreError extends Error {}
```

`FileStore` 안:

```ts
  #chain: Promise<unknown> = Promise.resolve()
  #timer: NodeJS.Timeout | null = null
  #dirty = false

  /** 서버의 프로젝트 행 FOR UPDATE 락에 대응하는 자리. 모든 쓰기가 이 체인을 지난다. */
  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn)
    this.#chain = run.then(() => undefined, () => undefined)
    return run
  }

  async mutate(ops: Op[]): Promise<{ seq: number }> {
    return this.#serialize(async () => {
      if (!this.#state.ok) {
        throw new LocalStoreError('파일을 읽을 수 없어 편집이 잠겨 있습니다')
      }
      if (ops.length > MAX_OPS_PER_MUTATION) {
        throw new LocalStoreError(
          `변경이 ${ops.length}건으로 한 번에 반영할 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다`,
        )
      }
      const next = applyOps(this.#state.model, ops)
      const issues = validateModelIntegrity(next)
      if (issues.length > 0) throw new LocalStoreError(issues[0]!.message)
      return this.#commit(next)
    })
  }

  /** 스냅샷 복원처럼 모델을 통째로 갈아끼우는 경로. */
  async setModel(model: ProjectModel): Promise<{ seq: number }> {
    return this.#serialize(async () => {
      if (!this.#state.ok) {
        throw new LocalStoreError('파일을 읽을 수 없어 편집이 잠겨 있습니다')
      }
      const issues = validateModelIntegrity(model)
      if (issues.length > 0) throw new LocalStoreError(issues[0]!.message)
      return this.#commit(model)
    })
  }

  #commit(model: ProjectModel): { seq: number } {
    const seq = this.#state.seq + 1
    this.#state = { ok: true, model, seq }
    this.#dirty = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    // 드래그 한 번이 초당 수십 건의 mutate 를 낸다 — 매번 파일을 쓰면 감시 루프와 함께 요동친다.
    this.#timer = setTimeout(() => { void this.flush() }, WRITE_DEBOUNCE_MS)
    return { seq }
  }

  /** 대기 중인 쓰기를 지금 끝낸다. 프로세스 종료 전에 반드시 부른다. */
  async flush(): Promise<void> {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    if (!this.#dirty) return
    this.#dirty = false
    const model = this.#state.model
    const { tree } = modelToFiles(model)
    await writeTree(this.#cwd, tree)
    const layout = layoutFromModel(model)
    const abs = join(this.#cwd, LAYOUT_FILE)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, stringifyYaml(layout), 'utf8')
    // 다음 load 가 이 서명과 같은 것을 읽으면 그 감시 이벤트는 자기 쓰기다.
    this.#written = signatureOf(tree, layout)
    this.#selfWrite = true
  }
```

> ⚠️ `#commit` 안에서 `this.#state = { ok: true, ... }` 로 덮는 것이 의도다 — mutate 는
> `ok:false` 에서 이미 거절됐으므로 여기 도달했다면 정상 상태다.
>
> ⚠️ `modelToFiles` 는 `{ tree, issues }` 를 돌려준다. `issues` 는 파일명으로 쓸 수 없는 물리명 같은
> 경고이고 **쓰기를 막지 않는다** — 기존 `pull` 과 같은 취급이다.
>
> ⚠️ `#written`·`#selfWrite` 는 Task 4 에서 선언한 private 필드다. `flush()` 뒤 곧바로
> `isSelfWrite` 가 참인 것은 의도다 — 그 쓰기가 낼 감시 이벤트를 미리 자기 것으로 표시해 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/store.test.ts`
Expected: PASS (17건)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): 로컬 저장소의 쓰기를 직렬화하고 디바운스한다

모든 쓰기가 단일 promise 체인을 지난다 — 서버의 프로젝트 행 FOR UPDATE
락에 대응하는 자리다. 드래그 한 번이 초당 수십 건의 mutate 를 내므로
디스크 쓰기는 300ms 디바운스하고 종료 전에 flush 한다.

읽기 전용 상태·op 상한 초과·무결성 위반은 거절하고 모델을 되돌린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/local/store.ts packages/cli/src/local/store.test.ts
```

---

## Task 6: 로컬 — 축소 tRPC 라우터와 계약 잠금

**Files:**
- Create: `packages/cli/src/local/router.ts`
- Create: `packages/cli/src/local/snapshots.ts`
- Test: `packages/cli/src/local/router.test.ts`
- Modify: `packages/cli/package.json`

**Interfaces:**
- Consumes: `FileStore`(Task 4·5), `ErddConfig`·`LOCAL_PROJECT_ID`(Task 2)
- Produces:
  ```ts
  export type LocalContext = { store: FileStore; cwd: string; projectId: string; config: ErddConfig }
  export function createLocalRouter(): <라우터>
  export type LocalRouter = ReturnType<typeof createLocalRouter>
  // snapshots.ts
  export type SnapshotRecord = { id: string; name: string; description: string; revisionSeq: number; model: ProjectModel; createdAt: string }
  export function readSnapshots(cwd: string): Promise<SnapshotRecord[]>
  export function writeSnapshots(cwd: string, items: SnapshotRecord[]): Promise<void>
  ```

**배경 — 이 Task 의 급소:** 웹은 `AppRouter`(`apps/server`) **타입**으로 tRPC 클라이언트를 만든다
(`apps/web/src/main.tsx`). 로컬 라우터의 입출력이 어긋나도 **컴파일에 안 잡히고 런타임에 깨진다.**
그래서 타입 수준 대조를 반드시 넣는다.

서버 쪽 실제 계약(구현자가 맞춰야 하는 것):

| 프로시저 | 입력 | 출력 |
|---|---|---|
| `auth.me` | 없음 | `{ id, email, name, role: 'admin'\|'user', mode: 'server'\|'local' }` |
| `project.get` | `{ projectId: uuid }` | `{ id, orgId, name, description, dialects, namingRules, createdAt, myRole, myOrgRole, canEdit, canManage }` |
| `project.update` | `{ projectId, name?, description?, dialects?, namingRules? }` | `{ ok: true }` |
| `model.get` | `{ projectId }` | `{ model, seq }` |
| `model.mutate` | `{ projectId, ops: unknown[], summary? }` | `{ seq }` |
| `snapshot.create` | `{ projectId, name, description? }` | `{ id }` |
| `snapshot.list` | `{ projectId }` | `{ items: [{ id, name, description, revisionSeq, createdAt }] }` |
| `snapshot.get` | `{ projectId, snapshotId }` | `{ id, projectId, name, description, revisionSeq, model, createdAt }` |
| `snapshot.delete` | `{ projectId, snapshotId }` | `{ ok: true }` |
| `snapshot.restore` | `{ projectId, snapshotId }` | `{ seq }` |

`createdAt` 은 서버에서 `Date` 다(drizzle `timestamp`). tRPC 기본 직렬화는 `Date` 를 문자열로
보내므로 **로컬도 문자열이 아니라 `Date` 를 돌려준다** — 그래야 타입 대조가 통과하고 화면의
날짜 포맷 코드가 같은 값을 본다.

- [ ] **Step 1: 의존성을 더한다**

`packages/cli/package.json`:

```json
  "dependencies": {
    "@erdd/core": "workspace:^",
    "@fastify/static": "^10.1.2",
    "@trpc/server": "^11.18.0",
    "fastify": "^5.10.0",
    "uuidv7": "^1.2.1",
    "yaml": "^2.8.1"
  },
  "devDependencies": {
    "@erdd/server": "workspace:^",
    "@types/node": "^22.20.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
```

> `@erdd/server` 는 **타입 전용**이다(계약 잠금에 `AppRouter` 가 필요하다). `apps/web` 이 이미 같은
> 형태로 devDependency 에 두고 있다.

Run: `pnpm install`

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/cli/src/local/router.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@erdd/server/src/router.js'
import { createEmptyModel, type Op } from '@erdd/core'
import { FileStore } from './store.js'
import { createLocalRouter, type LocalContext, type LocalRouter } from './router.js'
import { LOCAL_PROJECT_ID, readConfig } from '../config.js'

async function ctx(): Promise<LocalContext> {
  const cwd = await mkdtemp(join(tmpdir(), 'erdd-router-'))
  await writeFile(join(cwd, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  const store = new FileStore(cwd)
  await store.load()
  return { store, cwd, projectId: LOCAL_PROJECT_ID, config: await readConfig(cwd) }
}

const caller = async () => createLocalRouter().createCaller(await ctx())

describe('로컬 라우터', () => {
  it('auth.me 가 로컬 모드를 알린다', async () => {
    expect(await (await caller()).auth.me()).toMatchObject({ mode: 'local' })
  })

  it('project.get 이 config 의 방언·명명 규칙을 낸다', async () => {
    const p = await (await caller()).project.get({ projectId: LOCAL_PROJECT_ID })
    expect(p.dialects).toEqual(['postgresql'])
    expect(p.canEdit).toBe(true)
    expect(p.canManage).toBe(true)
  })

  it('project.update 가 erdd.config.yaml 에 되쓴다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)
    await call.project.update({
      projectId: LOCAL_PROJECT_ID,
      namingRules: { case: 'lower_snake', separator: '_', maxLengthBytes: 64, logicalSeparator: '' },
    })
    expect((await readConfig(c.cwd)).namingRules.case).toBe('lower_snake')
  })

  it('model.get → model.mutate → model.get 이 이어진다', async () => {
    const call = await caller()
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).seq).toBe(0)
    const op: Op = {
      kind: 'table', type: 'create', id: 't1',
      payload: {
        id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null,
        position: { x: 0, y: 0 }, groupPosition: null, custom: {},
      },
    } as Op
    const { seq } = await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [op] })
    expect(seq).toBe(1)
    const after = await call.model.get({ projectId: LOCAL_PROJECT_ID })
    expect(after.model.tables['t1']!.physicalName).toBe('MBR')
  })

  it('다른 projectId 는 거절한다', async () => {
    const call = await caller()
    await expect(call.model.get({ projectId: '00000000-0000-7000-8000-0000000000ff' }))
      .rejects.toThrow()
  })

  it('스냅샷을 만들고 목록·조회·복원·삭제한다', async () => {
    const call = await caller()
    const op: Op = {
      kind: 'table', type: 'create', id: 't1',
      payload: {
        id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null,
        position: { x: 0, y: 0 }, groupPosition: null, custom: {},
      },
    } as Op
    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [op] })
    const { id } = await call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '1차' })

    const list = await call.snapshot.list({ projectId: LOCAL_PROJECT_ID })
    expect(list.items.map((i) => i.name)).toEqual(['1차'])

    const got = await call.snapshot.get({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect(got.model.tables['t1']).toBeDefined()

    // 스냅샷 이후 지운 테이블이 복원으로 되살아난다
    await call.model.mutate({
      projectId: LOCAL_PROJECT_ID,
      ops: [{ kind: 'table', type: 'delete', id: 't1' } as Op],
    })
    await call.snapshot.restore({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).model.tables['t1']).toBeDefined()

    await call.snapshot.delete({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect((await call.snapshot.list({ projectId: LOCAL_PROJECT_ID })).items).toEqual([])
  })

  it('없는 스냅샷은 NOT_FOUND 로 던진다', async () => {
    const call = await caller()
    await expect(call.snapshot.get({
      projectId: LOCAL_PROJECT_ID, snapshotId: '00000000-0000-7000-8000-0000000000aa',
    })).rejects.toThrow()
  })
})

/**
 * 계약 잠금. 웹은 AppRouter **타입**으로 클라이언트를 만들므로, 여기서 어긋나면
 * 컴파일에 안 잡히고 런타임에 깨진다.
 */
describe('서버 라우터와의 계약', () => {
  type ServerIn = inferRouterInputs<AppRouter>
  type ServerOut = inferRouterOutputs<AppRouter>
  type LocalIn = inferRouterInputs<LocalRouter>
  type LocalOut = inferRouterOutputs<LocalRouter>

  it('입력 타입이 서버와 호환된다', () => {
    expectTypeOf<ServerIn['model']['get']>().toExtend<LocalIn['model']['get']>()
    expectTypeOf<ServerIn['model']['mutate']>().toExtend<LocalIn['model']['mutate']>()
    expectTypeOf<ServerIn['project']['get']>().toExtend<LocalIn['project']['get']>()
    expectTypeOf<ServerIn['snapshot']['create']>().toExtend<LocalIn['snapshot']['create']>()
    expectTypeOf<ServerIn['snapshot']['restore']>().toExtend<LocalIn['snapshot']['restore']>()
  })

  it('출력 타입이 서버와 호환된다 — 웹이 서버 타입으로 읽는다', () => {
    expectTypeOf<LocalOut['auth']['me']>().toExtend<ServerOut['auth']['me']>()
    expectTypeOf<LocalOut['model']['get']>().toExtend<ServerOut['model']['get']>()
    expectTypeOf<LocalOut['model']['mutate']>().toExtend<ServerOut['model']['mutate']>()
    expectTypeOf<LocalOut['project']['get']>().toExtend<ServerOut['project']['get']>()
    expectTypeOf<LocalOut['snapshot']['list']>().toExtend<ServerOut['snapshot']['list']>()
    expectTypeOf<LocalOut['snapshot']['get']>().toExtend<ServerOut['snapshot']['get']>()
    expectTypeOf<LocalOut['snapshot']['restore']>().toExtend<ServerOut['snapshot']['restore']>()
  })

  it('로컬이 구현한 프로시저는 전부 서버에도 있다', () => {
    const local = createLocalRouter()
    const names = Object.keys(local._def.procedures).sort()
    expect(names).toEqual([
      'auth.me',
      'model.get', 'model.mutate',
      'project.get', 'project.update',
      'snapshot.create', 'snapshot.delete', 'snapshot.get', 'snapshot.list', 'snapshot.restore',
    ])
  })
})
```

> ⚠️ `_def.procedures` 의 키 형식은 tRPC 버전에 따라 `'model.get'` 같은 평면 문자열이다. 실행해
> 실제 값을 확인하고 기대값을 맞춘다 — **테스트를 지우지 말고** 실제 형식에 맞춰 고친다.

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/router.test.ts`
Expected: FAIL — `Failed to resolve import "./router.js"`

- [ ] **Step 4: 스냅샷 저장소를 구현한다**

`packages/cli/src/local/snapshots.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectModel } from '@erdd/core'

export const SNAPSHOTS_FILE = '.erdd/snapshots.json'

export type SnapshotRecord = {
  id: string
  name: string
  description: string
  revisionSeq: number
  model: ProjectModel
  /** 서버가 Date 를 주므로 로컬도 Date 로 되살려 넘긴다. 파일에는 ISO 문자열로 담는다. */
  createdAt: string
}

export async function readSnapshots(cwd: string): Promise<SnapshotRecord[]> {
  let raw: string
  try {
    raw = await readFile(join(cwd, SNAPSHOTS_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) return []
  const items = (parsed as { snapshots?: unknown }).snapshots
  return Array.isArray(items) ? (items as SnapshotRecord[]) : []
}

export async function writeSnapshots(cwd: string, items: SnapshotRecord[]): Promise<void> {
  const abs = join(cwd, SNAPSHOTS_FILE)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, `${JSON.stringify({ snapshots: items }, null, 2)}\n`, 'utf8')
}
```

- [ ] **Step 5: 라우터를 구현한다**

`packages/cli/src/local/router.ts`:

```ts
import { initTRPC, TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { createEmptyModel, diffModels, parseOps, OpParseError, type ProjectModel } from '@erdd/core'
import { writeConfig, type ErddConfig } from '../config.js'
import { FileStore, LocalStoreError } from './store.js'
import { readSnapshots, writeSnapshots, type SnapshotRecord } from './snapshots.js'

export type LocalContext = {
  store: FileStore
  cwd: string
  /** 이 서버가 여는 유일한 프로젝트 id. 다른 값이 오면 거절한다. */
  projectId: string
  config: ErddConfig
}

const t = initTRPC.context<LocalContext>().create()

/** 이 서버는 프로젝트 하나만 연다 — 다른 id 는 잘못 연결된 클라이언트다. */
const scoped = t.procedure
  .input(z.object({ projectId: z.string() }))
  .use(({ ctx, input, next }) => {
    if (input.projectId !== ctx.projectId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '이 서버가 여는 프로젝트가 아닙니다' })
    }
    return next()
  })

function toRecord(store: FileStore, name: string, description: string): SnapshotRecord {
  return {
    id: uuidv7(),
    name,
    description,
    revisionSeq: store.state.seq,
    model: store.state.model,
    createdAt: new Date().toISOString(),
  }
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof LocalStoreError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
    }
    throw err
  })
}

export function createLocalRouter() {
  return t.router({
    auth: t.router({
      me: t.procedure.query(() => ({
        id: '00000000-0000-7000-8000-0000000000u0'.replace('u', '0'),
        email: 'local@erdd',
        name: '로컬',
        role: 'user' as const,
        mode: 'local' as const,
      })),
    }),

    project: t.router({
      get: scoped.query(({ ctx }) => ({
        id: ctx.projectId,
        orgId: ctx.projectId,
        name: '로컬 프로젝트',
        description: '',
        dialects: ctx.config.dialects,
        namingRules: ctx.config.namingRules,
        createdAt: new Date(0),
        myRole: 'admin' as const,
        myOrgRole: 'owner' as const,
        canEdit: true,
        canManage: true,
      })),

      update: scoped
        .input(z.object({
          projectId: z.string(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          dialects: z.array(z.string()).optional(),
          namingRules: z.unknown().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          // 이름·설명은 config 에 담을 자리가 없다(로컬 프로젝트에는 이름이 없다).
          // 방언·명명 규칙만 되쓴다.
          await writeConfig(ctx.cwd, {
            ...ctx.config,
            dialects: (input.dialects as ErddConfig['dialects'] | undefined) ?? ctx.config.dialects,
            namingRules: (input.namingRules as ErddConfig['namingRules'] | undefined)
              ?? ctx.config.namingRules,
          })
          return { ok: true as const }
        }),
    }),

    model: t.router({
      get: scoped.query(({ ctx }) => ({
        model: ctx.store.state.model,
        seq: ctx.store.state.seq,
      })),

      mutate: scoped
        .input(z.object({
          projectId: z.string(),
          ops: z.array(z.unknown()).min(1),
          summary: z.string().min(1).max(200).optional(),
        }))
        .mutation(({ ctx, input }) => wrap(async () => {
          let ops
          try {
            ops = parseOps(input.ops)
          } catch (err) {
            if (err instanceof OpParseError) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
            }
            throw err
          }
          return await ctx.store.mutate(ops)
        })),
    }),

    snapshot: t.router({
      create: scoped
        .input(z.object({
          projectId: z.string(),
          name: z.string().min(1).max(100),
          description: z.string().max(1000).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          const rec = toRecord(ctx.store, input.name, input.description ?? '')
          await writeSnapshots(ctx.cwd, [rec, ...await readSnapshots(ctx.cwd)])
          return { id: rec.id }
        }),

      list: scoped.query(async ({ ctx }) => ({
        items: (await readSnapshots(ctx.cwd)).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          revisionSeq: s.revisionSeq,
          createdAt: new Date(s.createdAt),
        })),
      })),

      get: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .query(async ({ ctx, input }) => {
          const s = (await readSnapshots(ctx.cwd)).find((x) => x.id === input.snapshotId)
          if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
          return {
            id: s.id,
            projectId: ctx.projectId,
            name: s.name,
            description: s.description,
            revisionSeq: s.revisionSeq,
            model: s.model,
            createdAt: new Date(s.createdAt),
          }
        }),

      delete: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          const all = await readSnapshots(ctx.cwd)
          if (!all.some((x) => x.id === input.snapshotId)) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
          }
          await writeSnapshots(ctx.cwd, all.filter((x) => x.id !== input.snapshotId))
          return { ok: true as const }
        }),

      restore: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .mutation(({ ctx, input }) => wrap(async () => {
          const s = (await readSnapshots(ctx.cwd)).find((x) => x.id === input.snapshotId)
          if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
          // 옛 스냅샷에는 신규 컬렉션 키가 없을 수 있다 — 서버 restore 와 같은 정규화를 한다.
          const model: ProjectModel = { ...createEmptyModel(), ...s.model }
          return await ctx.store.setModel(model)
        })),
    }),
  })
}

export type LocalRouter = ReturnType<typeof createLocalRouter>
```

> ⚠️ `auth.me` 의 `id` 리터럴이 지저분하다. **평범한 상수로 쓴다** — 예:
> `const LOCAL_USER_ID = '00000000-0000-7000-8000-000000000001'`. 위 `.replace` 트릭을 그대로
> 옮기지 말 것.
>
> ⚠️ `project.get` 의 `myRole`·`myOrgRole` 값은 서버의 실제 enum 과 맞아야 타입 대조가 통과한다
> (`project_members.role` 은 `'admin'|'editor'|'viewer'`, 조직 역할은 `members` 테이블을 확인).
> 타입 오류가 나면 **서버 enum 을 고치지 말고** 로컬 값을 맞춘다.
>
> ⚠️ `diffModels` import 가 안 쓰이면 지운다.

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/router.test.ts && pnpm -C packages/cli typecheck`
Expected: PASS, EXIT=0

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(cli): 로컬 축소 tRPC 라우터와 계약 잠금을 넣는다

auth.me·project.get/update·model.get/mutate·snapshot 5종만 구현한다.
revision·resource·promotion·org·admin·invitation 은 로컬 UI 에서 숨긴다.

웹은 AppRouter 타입으로 클라이언트를 만들므로 로컬 라우터가 어긋나도
컴파일에 안 잡히고 런타임에 깨진다 — inferRouterInputs/Outputs 대조와
프로시저 이름 집합 대조로 그 자리를 잠근다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/local/router.ts packages/cli/src/local/router.test.ts packages/cli/src/local/snapshots.ts packages/cli/package.json pnpm-lock.yaml
```

---

## Task 7: 로컬 — 파일 감시

**Files:**
- Create: `packages/cli/src/local/watch.ts`
- Test: `packages/cli/src/local/watch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Watcher = { close: () => void }
  export function watchProject(
    cwd: string,
    onChange: () => void,
    opts?: { debounceMs?: number },
  ): Watcher
  ```

**배경:** `fs.watch` 는 플랫폼마다 이벤트를 여러 번 낸다(macOS 에서 한 번의 저장이 `rename` +
`change` 로 온다). 디바운스로 뭉친다. **자기 쓰기를 걸러내는 것은 이 모듈이 아니라 호출자(server.ts)의
일이다** — `FileStore.isSelfWrite`(재로드가 읽은 것과 마지막으로 쓴 것의 비교)로 정한다. 여기서 하면
저장소 내부 상태를 감시 모듈이 알아야 해서 경계가 흐려진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/watch.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { watchProject } from './watch.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watchProject', () => {
  it('erdd/ 안의 파일 변경을 알린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    try {
      await sleep(50)
      await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: MBR\n', 'utf8')
      await sleep(200)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })

  it('연속 변경을 한 번으로 뭉친다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 80 })
    try {
      await sleep(50)
      for (let i = 0; i < 5; i++) {
        await writeFile(join(dir, `erdd/tables/T${i}.yaml`), `name: T${i}\n`, 'utf8')
      }
      await sleep(300)
      expect(hits).toBe(1)
    } finally { w.close() }
  })

  it('erdd.config.yaml 변경도 알린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd'), { recursive: true })
    await writeFile(join(dir, 'erdd.config.yaml'), 'dialects: [postgresql]\n', 'utf8')
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    try {
      await sleep(50)
      await writeFile(join(dir, 'erdd.config.yaml'), 'dialects: [oracle]\n', 'utf8')
      await sleep(200)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })

  it('erdd/ 가 없어도 던지지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    const w = watchProject(dir, () => {}, { debounceMs: 20 })
    w.close()
  })

  it('close 뒤에는 알리지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    await sleep(50)
    w.close()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: MBR\n', 'utf8')
    await sleep(200)
    expect(hits).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/watch.test.ts`
Expected: FAIL — `Failed to resolve import "./watch.js"`

- [ ] **Step 3: 구현한다**

`packages/cli/src/local/watch.ts`:

```ts
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export type Watcher = { close: () => void }

const DEFAULT_DEBOUNCE_MS = 150

/**
 * `erdd/`(재귀)와 `erdd.config.yaml` 을 본다.
 *
 * `fs.watch` 는 한 번의 저장을 플랫폼에 따라 여러 이벤트로 낸다(macOS 는 rename + change).
 * 디바운스로 뭉쳐 한 번만 알린다.
 *
 * **자기 쓰기를 걸러내는 것은 호출자의 일이다** — 저장소의 마지막 쓰기 서명과 지금 디스크
 * 상태를 비교해 정한다. 여기서 하면 감시 모듈이 저장소 내부를 알아야 해서 경계가 흐려진다.
 */
export function watchProject(
  cwd: string,
  onChange: () => void,
  opts: { debounceMs?: number } = {},
): Watcher {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  let closed = false

  const fire = () => {
    if (closed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!closed) onChange() }, debounceMs)
  }

  const add = (path: string, recursive: boolean) => {
    try {
      // ENOENT 는 정상이다 — erdd/ 가 아직 없는 새 프로젝트에서 serve 할 수 있다.
      watchers.push(watch(path, { recursive, persistent: false }, fire))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  add(join(cwd, 'erdd'), true)
  add(join(cwd, 'erdd.config.yaml'), false)

  return {
    close: () => {
      closed = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      for (const w of watchers) w.close()
    },
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/watch.test.ts`
Expected: PASS (5건)

> 이 테스트들은 실제 파일시스템 이벤트에 기대므로 **CI 에서 흔들릴 수 있다.** 대기 시간이
> 부족해 빨개지면 `sleep` 을 늘린다(줄이지 않는다). 두 번 이상 흔들리면 그 케이스만
> `it.skipIf(process.env['CI'])` 로 감싸고 **왜 그랬는지 주석을 남긴다.**

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): 로컬 서버의 파일 감시를 넣는다

erdd/ 와 erdd.config.yaml 을 보고 디바운스로 한 번만 알린다. fs.watch 는
한 번의 저장을 플랫폼에 따라 여러 이벤트로 내기 때문이다.

자기 쓰기를 거르는 것은 호출자의 일로 남긴다 — 여기서 하면 감시 모듈이
저장소 내부를 알아야 해서 경계가 흐려진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/local/watch.ts packages/cli/src/local/watch.test.ts
```

---

## Task 8: 로컬 — Fastify 조립(정적·리다이렉트·SSE·감시 배선)

**Files:**
- Create: `packages/cli/src/local/server.ts`
- Test: `packages/cli/src/local/server.test.ts`

**Interfaces:**
- Consumes: `FileStore`(4·5) · `createLocalRouter`(6) · `watchProject`(7)
- Produces:
  ```ts
  export type LocalServer = { url: string; close: () => Promise<void> }
  export async function startLocalServer(opts: {
    cwd: string
    port: number
    host?: string
    webDist?: string
  }): Promise<LocalServer>
  ```

**배경:** `apps/server/src/server.ts` 가 `web/dist` 를 `@fastify/static` 으로 서빙하고 404 를
`index.html` 로 돌린다(SPA). 같은 형태를 쓴다. 다른 점 셋:

1. `/` 로 들어오면 `/p/<projectId>` 로 리다이렉트한다.
2. `/local/events` 가 SSE 로 `reload` 를 보낸다.
3. 감시가 잡으면 `store.load()` 후 SSE 를 쏜다. **자기 쓰기는 거른다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/server.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLocalServer, type LocalServer } from './server.js'
import { LOCAL_PROJECT_ID } from '../config.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let running: LocalServer | null = null
afterEach(async () => { await running?.close(); running = null })

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-server-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  await mkdir(join(dir, 'erdd/tables'), { recursive: true })
  return dir
}

async function start(cwd: string, webDist?: string): Promise<LocalServer> {
  // port 0 = 커널이 빈 포트를 준다. 테스트끼리 포트를 다투지 않는다.
  running = await startLocalServer({ cwd, port: 0, webDist })
  return running
}

describe('startLocalServer', () => {
  it('tRPC 로 모델을 읽을 수 있다', async () => {
    const s = await start(await project())
    const url = `${s.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: { seq: number } } }
    expect(body.result.data.seq).toBe(0)
  })

  it('/ 는 프로젝트 경로로 리다이렉트한다', async () => {
    const s = await start(await project())
    const res = await fetch(`${s.url}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/p/${LOCAL_PROJECT_ID}`)
  })

  it('127.0.0.1 에만 바인딩한다', async () => {
    const s = await start(await project())
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('web/dist 가 있으면 SPA 경로를 index.html 로 돌린다', async () => {
    const cwd = await project()
    const dist = await mkdtemp(join(tmpdir(), 'erdd-dist-'))
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>erdd</title>', 'utf8')
    const s = await start(cwd, dist)
    const res = await fetch(`${s.url}/p/${LOCAL_PROJECT_ID}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('erdd')
  })

  it('외부 파일 변경을 SSE 로 알린다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()
    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), [
      'id: 018f6b0e-0000-7000-8000-000000000001',
      'name: MBR',
      'logicalName: 회원',
      'columns: []',
      '',
    ].join('\n'), 'utf8')

    expect(await chunk).toContain('reload')
    await reader.cancel()
  }, 10_000)

  it('자기 쓰기는 SSE 로 알리지 않는다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    let got = ''
    void (async () => {
      const { value } = await reader.read()
      got = new TextDecoder().decode(value ?? new Uint8Array())
    })()

    await sleep(100)
    // 라우터를 통한 편집 = 자기 쓰기. 디바운스(300ms) + 감시 디바운스를 넉넉히 기다린다.
    const url = `${s.url}/trpc/model.mutate`
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: LOCAL_PROJECT_ID,
        ops: [{
          kind: 'table', type: 'create', id: '018f6b0e-0000-7000-8000-000000000001',
          payload: {
            id: '018f6b0e-0000-7000-8000-000000000001', logicalName: '회원', physicalName: 'MBR',
            comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
          },
        }],
      }),
    })
    await sleep(1500)
    expect(got).toBe('')
    await reader.cancel()
  }, 10_000)

  it('파일이 깨지면 blocked 를 보낸다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()
    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')

    expect(await chunk).toContain('blocked')
    await reader.cancel()
  }, 10_000)

  it('감시가 잡은 변경이 모델에 반영된다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), [
      'id: 018f6b0e-0000-7000-8000-000000000001',
      'name: MBR',
      'logicalName: 회원',
      'columns: []',
      '',
    ].join('\n'), 'utf8')
    await sleep(500)
    const url = `${s.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const body = await (await fetch(url)).json() as {
      result: { data: { model: { tables: Record<string, { physicalName: string }> } } }
    }
    expect(Object.values(body.result.data.model.tables)[0]!.physicalName).toBe('MBR')
  }, 10_000)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/server.test.ts`
Expected: FAIL — `Failed to resolve import "./server.js"`

- [ ] **Step 3: 구현한다**

`packages/cli/src/local/server.ts`:

```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { LOCAL_PROJECT_ID, readConfig } from '../config.js'
import { FileStore } from './store.js'
import { createLocalRouter, type LocalContext } from './router.js'
import { watchProject } from './watch.js'

export type LocalServer = { url: string; close: () => Promise<void> }

/** 워크스페이스 안에서 실행될 때의 web 빌드 산출물 위치. */
const defaultWebDist = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../../apps/web/dist',
)

export async function startLocalServer(opts: {
  cwd: string
  port: number
  host?: string
  webDist?: string
}): Promise<LocalServer> {
  const { cwd, port } = opts
  // 인증이 없는 서버다. LAN 노출은 옵션으로도 열지 않는다(설계 D8).
  const host = opts.host ?? '127.0.0.1'
  const webDist = opts.webDist ?? defaultWebDist

  const config = await readConfig(cwd)
  const projectId = config.projectId ?? LOCAL_PROJECT_ID
  const store = new FileStore(cwd)
  await store.load()

  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const router = createLocalRouter()

  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router,
      createContext: (_o: CreateFastifyContextOptions): LocalContext =>
        ({ store, cwd, projectId, config }),
    },
  })

  // ── SSE: 외부 파일 변경을 브라우저에 알린다 ──
  const clients = new Set<{ write: (s: string) => void }>()
  app.get('/local/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const client = { write: (s: string) => reply.raw.write(s) }
    clients.add(client)
    req.raw.on('close', () => { clients.delete(client) })
  })
  // 파일이 깨져 편집이 잠긴 상태도 같은 채널로 알린다 — 브라우저가 배너를 띄우고 편집을 막는다.
  const broadcast = () => {
    const payload = store.state.ok
      ? { type: 'reload' as const }
      : { type: 'blocked' as const, failures: store.state.failures }
    for (const c of clients) c.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const watcher = watchProject(cwd, () => {
    void (async () => {
      await store.load()
      // 방금 읽은 디스크가 우리가 마지막으로 쓴 그것이면 자기 쓰기다 — 브라우저를 흔들 이유가 없다.
      // 로드가 실패했으면 isSelfWrite 는 언제나 false 라 blocked 가 반드시 나간다.
      if (store.isSelfWrite) return
      broadcast()
    })()
  })

  // ── 정적 서빙 ──
  app.get('/', (_req, reply) => reply.redirect(`/p/${projectId}`, 302))
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url === '/trpc' || req.url.startsWith('/trpc/')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  await app.listen({ port, host })
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    url: `http://${host}:${actualPort}`,
    close: async () => {
      watcher.close()
      for (const c of clients) c.write('')
      clients.clear()
      await store.flush()
      await app.close()
    },
  }
}
```

> ⚠️ **자기 쓰기 판정은 `load()` 전후 비교로 하면 안 된다** — 서명은 `flush()` 만 바꾸므로 전후가
> 언제나 같아 SSE 가 **한 번도 안 나간다.** `isSelfWrite` 는 **읽은 것**과 **쓴 것**을 비교한다
> (Task 4·5). 반대로 거르지 않으면 브라우저가 자기 편집마다 resync 해 화면이 튄다. 아래
> Step 4 의 테스트 둘이 양쪽을 다 잠근다.
>
> ⚠️ `reply.redirect` 의 인자 순서는 Fastify 5 에서 `(url, code)` 다. 타입 오류가 나면 순서를 확인한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/local/server.test.ts`
Expected: PASS (8건)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): 로컬 Fastify 서버를 조립한다

정적 서빙 + / 리다이렉트 + tRPC + SSE + 파일 감시 배선. 127.0.0.1 에만
바인딩한다 — 인증이 없는 서버라 LAN 노출은 옵션으로도 열지 않는다.

감시가 잡은 변경이 자기 쓰기면 브로드캐스트하지 않는다. 안 거르면
브라우저가 자기 편집마다 resync 해 화면이 튄다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/local/server.ts packages/cli/src/local/server.test.ts
```

---

## Task 9: CLI — `erdd serve` 명령

**Files:**
- Create: `packages/cli/src/commands/serve.ts`
- Test: `packages/cli/src/commands/serve.test.ts`
- Modify: `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: `startLocalServer`(Task 8) — **동적 `import()`** 로만 가져온다
- Produces: `export function serve(ctx: CommandCtx): Promise<number>`

**배경:** `serve` 외의 명령이 Fastify 를 부팅에 얹지 않도록 **동적 `import()`** 로만 로컬 서버를
가져온다(core 가 `exceljs` 를 다루는 방식과 같은 정신).

포트가 이미 쓰이면 **자동으로 다음 포트를 시도하지 않는다** — 에이전트가 `erdd serve` 를 띄우고
`http://127.0.0.1:4300` 을 가정한 채 다른 사람의 서버에 붙는 것을 막는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/commands/serve.test.ts`:

```ts
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serve } from './serve.js'

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-serve-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  return dir
}

describe('serve', () => {
  it('config 가 없으면 실패한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-serve-'))
    expect(await serve({ cwd: dir, json: true, yes: true, strict: false, open: false })).toBe(1)
  })

  it('포트가 이미 쓰이면 자동 증가시키지 않고 실패한다', async () => {
    const dir = await project()
    const blocker = createServer(() => {})
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const port = (blocker.address() as { port: number }).port
    try {
      const code = await serve({ cwd: dir, json: true, yes: true, strict: false, port, open: false })
      expect(code).toBe(1)
    } finally { blocker.close() }
  })
})
```

> ⚠️ **정상 기동 케이스는 여기서 테스트하지 않는다** — `serve` 는 신호를 받을 때까지 돌아
> 테스트가 끝나지 않는다. 기동은 Task 8 의 `startLocalServer` 테스트가 이미 덮는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/cli exec vitest run src/commands/serve.test.ts`
Expected: FAIL — `Failed to resolve import "./serve.js"`

- [ ] **Step 3: 구현한다**

`packages/cli/src/commands/serve.ts`:

```ts
import { readConfig } from '../config.js'
import { CliError, note } from '../output.js'
import { run, type CommandCtx } from './context.js'

const DEFAULT_PORT = 4300

export function serve(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    // config 가 없으면 여기서 NO_CONFIG 로 끝난다.
    await readConfig(ctx.cwd)
    const port = ctx.port ?? DEFAULT_PORT

    // 동적 import — serve 가 아닌 명령의 부팅에 Fastify 가 얹히지 않게 한다.
    const { startLocalServer } = await import('../local/server.js')

    let server
    try {
      server = await startLocalServer({ cwd: ctx.cwd, port })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        // 자동으로 다음 포트를 잡지 않는다 — 에이전트가 고정 포트를 가정한 채 남의 서버에
        // 붙는 것을 막는다.
        throw new CliError('VALIDATION', `포트 ${port}이 이미 사용 중입니다. --port로 다른 포트를 지정하세요`)
      }
      throw err
    }

    note(`${server.url} 에서 실행 중 (프로젝트: ${ctx.cwd})`)
    note('중지하려면 Ctrl+C')
    if (ctx.open !== false) await openBrowser(server.url)

    // 신호를 받을 때까지 돈다. 종료 전에 대기 중인 쓰기를 flush 한다.
    await new Promise<void>((resolve) => {
      const stop = () => { void server.close().then(resolve, resolve) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return 0
  })
}

/** 실패해도 서버는 계속 돈다 — 브라우저를 못 여는 것은 치명적이지 않다. */
async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open'
  try {
    const { spawn } = await import('node:child_process')
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    note(`브라우저를 열지 못했습니다. 직접 ${url} 을 여세요`)
  }
}
```

- [ ] **Step 4: `main.ts` 에 배선한다**

- `serve` 를 import 하고 배차 `switch`(또는 분기)에 더한다.
- `--port` 는 `flagValue(argv, 'port')` 로 읽어 `Number()` 로 바꾼다. 숫자가 아니면
  `CliError('USAGE', ...)`.
- `--no-open` 은 `argv.includes('--no-open')` → `open: false`.
- USAGE 에 줄을 더한다.

```
  serve        로컬 서버를 띄워 브라우저에서 편집한다(서버 연결 불필요)
```

```
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C packages/cli test && pnpm -C packages/cli typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 6: 손으로 한 번 띄워 본다(스모크)**

```bash
pnpm -C apps/web build
mkdir -p /tmp/erdd-smoke && cd /tmp/erdd-smoke
node --import tsx <저장소>/packages/cli/src/main.ts init --local
node --import tsx <저장소>/packages/cli/src/main.ts serve --no-open --port 4399
```

다른 터미널에서 확인한다.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4399/p/00000000-0000-7000-8000-000000000000
curl -s "http://127.0.0.1:4399/trpc/model.get?input=%7B%22projectId%22%3A%2200000000-0000-7000-8000-000000000000%22%7D"
```

Expected: `200` 과 `{"result":{"data":{"model":{...},"seq":0}}}`

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(cli): erdd serve 를 넣는다

로컬 서버를 띄우고 브라우저를 연다. 로컬 서버는 동적 import 로만 가져와
serve 가 아닌 명령의 부팅에 Fastify 가 얹히지 않게 한다.

포트가 쓰이면 자동으로 다음 포트를 잡지 않고 실패한다 — 에이전트가 고정
포트를 가정한 채 남의 서버에 붙는 것을 막는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- packages/cli/src/commands/serve.ts packages/cli/src/commands/serve.test.ts packages/cli/src/main.ts
```

---

## Task 10: 서버·웹 — `auth.me` 의 `mode` 필드

**Files:**
- Modify: `apps/server/src/routers/auth.ts`
- Modify: `apps/web/src/components/require-auth.tsx`
- Test: `apps/web/src/components/app-shell.test.tsx` 또는 새 `require-auth.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // apps/web/src/components/require-auth.tsx
  export type Me = { id: string; email: string; name: string; role: 'admin' | 'user'; mode: 'server' | 'local' }
  export function useMe(): Me
  export function useIsLocal(): boolean
  ```

**배경:** 웹이 로컬 모드인지 아는 유일한 경로다. `RequireAuth` 가 이미 `auth.me` 를 부르므로 왕복이
늘지 않는다.

- [ ] **Step 1: 서버를 고친다 (1줄)**

`apps/server/src/routers/auth.ts`:

```ts
  // mode 는 클라이언트가 "지금 붙어 있는 것이 운영 서버인가 로컬 서버인가"를 판정하는 값이다.
  // 운영 서버는 언제나 'server'다 — 로컬 서버(packages/cli/src/local)가 'local'을 돌려준다.
  me: apiProcedure.query(({ ctx }) => ({ ...ctx.user, mode: 'server' as const })),
```

- [ ] **Step 2: 웹 타입과 헬퍼를 고친다**

`apps/web/src/components/require-auth.tsx`:

```ts
export type Me = {
  id: string; email: string; name: string
  role: 'admin' | 'user'
  /** 'local'이면 백엔드 없이 파일 위에서 도는 로컬 서버다 — 계정·조직·협업 기능이 없다. */
  mode: 'server' | 'local'
}
```

파일 끝에 헬퍼를 더한다.

```ts
/** 로컬 모드 분기의 단일 진입점. 컴포넌트마다 me.mode를 직접 비교하지 않는다. */
export function useIsLocal(): boolean {
  return useMe().mode === 'local'
}
```

- [ ] **Step 3: 테스트를 더한다**

`apps/web` 의 tRPC 목(`apps/web/src/testing/trpc-mock.ts`)이 `auth.me` 를 돌려주는 자리에 `mode` 를
더한다. **파일을 열어 기존 형태를 확인하고 그대로 따라 쓴다.** 기본값은 `'server'` 로 둔다 —
기존 테스트가 전부 서버 모드를 가정하고 있다.

새 테스트 `apps/web/src/components/require-auth.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RequireAuth, useIsLocal } from './require-auth'
// renderWithTrpc 류의 헬퍼 이름은 apps/web/src/testing/ 을 열어 확인해 그대로 쓴다.

function Probe() {
  return <span>{useIsLocal() ? '로컬' : '서버'}</span>
}

describe('useIsLocal', () => {
  it('mode 가 local 이면 참이다', async () => {
    // trpc 목의 auth.me 가 { ..., mode: 'local' } 을 돌려주도록 구성한다
    // (기존 테스트가 목을 구성하는 방식을 그대로 따른다).
    render(<RequireAuth><Probe /></RequireAuth>)
    expect(await screen.findByText('로컬')).toBeInTheDocument()
  })

  it('mode 가 server 면 거짓이다', async () => {
    render(<RequireAuth><Probe /></RequireAuth>)
    expect(await screen.findByText('서버')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web test && pnpm -r typecheck`
Expected: 전부 PASS, EXIT=0

> `apps/server` 테스트는 이 트랙에서 돌리지 않는다(`DATABASE_URL` 필요). typecheck 로 충분하다 —
> 바뀐 것은 반환 리터럴 한 줄이다.

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat: auth.me 가 실행 모드를 알린다

웹이 \"지금 붙어 있는 것이 운영 서버인가 로컬 서버인가\"를 아는 유일한
경로다. RequireAuth 가 이미 부르는 쿼리라 왕복이 늘지 않는다.

apps/server 변경은 이 한 줄이 전부다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- apps/server/src/routers/auth.ts apps/web/src/components/require-auth.tsx apps/web/src/components/require-auth.test.tsx apps/web/src/testing/trpc-mock.ts
```

---

## Task 11: 웹 — 로컬 모드 UI 축소

**Files:**
- Modify: `apps/web/src/editor/header-tools.tsx`
- Modify: `apps/web/src/editor/version-dialog.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/pages/project-settings.tsx`
- Modify: `apps/web/src/pages/project.tsx`
- Modify: `apps/web/src/routes.tsx`
- Test: `apps/web/src/editor/header-tools.test.tsx`(없으면 생성), `apps/web/src/routes.test.tsx`(추가)

**Interfaces:**
- Consumes: `useIsLocal()`(Task 10)

**배경 — 왜 "숨기기"로는 부족한가:** 아래 둘은 **닫힌 다이얼로그 안에서도 쿼리를 쏜다.** 로컬
라우터에 없는 프로시저라 조건부 렌더가 아니면 화면에 오류가 뜬다.

- `ResourcePanel`(`editor/resource-panel.tsx:39`) — `enabled` 가드 없이 `resource.library.listForProject` 를 마운트 즉시 부른다.
- `PendingPromotionsBadge`(`components/pending-promotions-badge.tsx`) — `promotion.pendingCount` 를 60초마다 폴링한다.

로컬 모드에서 빠지는 것과 남는 것:

| 자리 | 로컬 모드 |
|---|---|
| `header-tools` 「사전·리소스 ▾ → 공용 리소스」 | **뺀다**(항목 + `<ResourcePanel>` 렌더 둘 다) |
| `header-tools` 「버전」 버튼 | **남긴다** |
| `version-dialog` 「이력」 탭 | **뺀다**(`revision.list` 를 부른다). 스냅샷·비교는 남긴다 |
| `app-shell` `PendingPromotionsBadge` | **뺀다** |
| `project.tsx` `PresenceBar`·`UserMenu` | **뺀다** |
| `project-settings` `ProjectMembers` | **뺀다**(`org.members.list` 를 부른다) |
| `routes` `/` → `HomePage` | 로컬이면 `/p/<projectId>` 로 리다이렉트 |

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/header-tools.test.tsx`(기존 파일이 있으면 케이스만 추가):

```tsx
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// 렌더 헬퍼·목 구성은 같은 디렉터리의 기존 에디터 테스트를 열어 그대로 따라 쓴다.

describe('HeaderTools 로컬 모드', () => {
  it('로컬 모드에서 「공용 리소스」 항목이 없다', async () => {
    // auth.me 목이 mode: 'local' 을 돌려주도록 구성한 뒤 렌더한다
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    expect(screen.queryByText('공용 리소스')).not.toBeInTheDocument()
    // 나머지 셋은 남아 있어야 한다
    expect(screen.getByText('도메인')).toBeInTheDocument()
    expect(screen.getByText('단어·용어 사전')).toBeInTheDocument()
    expect(screen.getByText('커스텀 항목')).toBeInTheDocument()
  })

  it('서버 모드에서는 「공용 리소스」가 있다', async () => {
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    expect(screen.getByText('공용 리소스')).toBeInTheDocument()
  })

  it('로컬 모드에서도 「버전」 버튼은 남는다', () => {
    expect(screen.getByRole('button', { name: /버전/ })).toBeInTheDocument()
  })

  it('로컬 모드에서 「이력」 탭이 없다', async () => {
    await userEvent.click(screen.getByRole('button', { name: /버전/ }))
    expect(screen.queryByRole('button', { name: '이력' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '스냅샷' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '비교' })).toBeInTheDocument()
  })
})
```

`apps/web/src/routes.test.tsx` 에 추가:

```tsx
it('로컬 모드에서 / 는 프로젝트로 리다이렉트한다', async () => {
  // auth.me 목을 mode: 'local' 로 구성하고 초기 경로 '/' 로 라우터를 렌더한다.
  expect(await screen.findByTestId('editor-root')).toBeInTheDocument()
})
```

> ⚠️ `editor-root` 같은 식별자가 없으면 이 파일이 이미 쓰는 방식(스텁 컴포넌트 텍스트 대조 등)을
> 그대로 따른다. **기존 테스트가 실제 라우트 표를 렌더한다**는 점이 중요하다(`routes.tsx` 상단 주석).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/header-tools.test.tsx src/routes.test.tsx`
Expected: FAIL — 로컬 모드에서도 「공용 리소스」·「이력」이 보인다

- [ ] **Step 3: `header-tools.tsx` 를 고친다**

```tsx
import { useIsLocal } from '@/components/require-auth'
...
export function HeaderTools({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<ToolId | null>(null)
  const close = (open: boolean) => { if (!open) setTool(null) }
  const warnings = useWarnings()
  const canEdit = useEditorStore((s) => s.canEdit)
  // 공용 리소스는 서버의 라이브러리 테이블에 얹혀 있다 — 로컬 서버에는 그 프로시저가 없다.
  const isLocal = useIsLocal()
```

메뉴 항목:

```tsx
          {!isLocal && (
            <DropdownMenuItem onSelect={() => setTool('resource')}>공용 리소스</DropdownMenuItem>
          )}
```

다이얼로그 렌더:

```tsx
      {/*
        닫아 두는 것으로는 부족하다 — ResourcePanel 은 enabled 가드 없이 마운트 즉시
        resource.library.listForProject 를 부른다. 로컬 라우터에 없는 프로시저다.
      */}
      {!isLocal && <ResourcePanel projectId={projectId} open={tool === 'resource'} onOpenChange={close} />}
```

- [ ] **Step 4: `version-dialog.tsx` 의 「이력」 탭을 감춘다**

탭 버튼과 그 내용(이력 섹션) 둘 다 `!isLocal` 로 감싼다. **탭 상태의 기본값이 「이력」이면
로컬에서 빈 화면이 되므로, 기본값이 「스냅샷」인지 확인한다.**

- [ ] **Step 5: `app-shell.tsx` 를 고친다**

```tsx
  const isLocal = useIsLocal()
...
          {!isLocal && <PendingPromotionsBadge />}
```

> ⚠️ `AppShell` 은 `RequireAuth` **안에서** 렌더된다(`routes.tsx` 의 `Protected`). `useIsLocal` 이
> `MeContext` 를 요구하므로 그 순서가 맞는지 확인한다. 어긋나면 `AppShell` 에 prop 으로 내린다.

- [ ] **Step 6: `project-settings.tsx` 를 고친다**

```tsx
      {canManage && <NamingRulesSection projectId={projectId} namingRules={p.namingRules} />}
      {canManage && !isLocal && <ProjectMembers projectId={projectId} orgId={p.orgId} />}
```

- [ ] **Step 7: `project.tsx` 를 고친다**

`PresenceBar` 와 `UserMenu` 를 `!isLocal` 로 감싼다. `useRealtime(projectId)` 는 로컬에서 WS 가
없으므로 부르지 않는다 — 다음 Task 에서 `useLocalWatch` 로 갈린다. 지금은 이렇게 둔다.

```tsx
  const isLocal = useIsLocal()
  useRealtime(isLocal ? '' : projectId)
```

> ⚠️ `useRealtime` 이 빈 문자열에 어떻게 반응하는지 **먼저 읽어 확인한다.** 빈 값으로도 소켓을
> 열려 한다면 훅 자체에 `enabled` 인자를 더한다. Task 12 에서 이 자리를 다시 손대므로,
> **여기서는 소켓이 안 열리는 것만 확실히 하고** 넘어간다.

- [ ] **Step 8: `routes.tsx` 를 고친다**

`/` 라우트를 로컬 모드에서 리다이렉트하는 작은 컴포넌트로 감싼다.

```tsx
/** 로컬 모드에는 홈·조직·프로젝트 목록이 없다 — 유일한 프로젝트로 바로 보낸다. */
function HomeOrEditor() {
  const isLocal = useIsLocal()
  const projectId = LOCAL_PROJECT_ID
  if (isLocal) return <Navigate to={`/p/${projectId}`} replace />
  return <HomePage />
}
```

```tsx
  { path: '/', element: <Protected><HomeOrEditor /></Protected> },
```

`HomeOrEditor` 의 `const projectId = LOCAL_PROJECT_ID` 줄은 지우고 상수를 바로 쓴다.

`LOCAL_PROJECT_ID` 는 **`@erdd/core` 에서 가져온다**(Task 1 에서 `packages/core/src/local.ts` 에
두었다). 웹이 `@erdd/cli` 를 의존하게 만들지 않기 위한 자리다.

```tsx
import { LOCAL_PROJECT_ID } from '@erdd/core'
import { Navigate } from 'react-router'
import { useIsLocal } from '@/components/require-auth'
```

> ⚠️ **서버 쪽 `/` 리다이렉트(Task 8)만으로는 부족하다.** 그것은 브라우저가 주소창으로 들어올
> 때만 걸린다 — `AppShell` 의 브랜드 링크(`<Link to="/">`)는 react-router 가 클라이언트에서
> 처리해 서버에 닿지 않으므로, 이 라우트 분기가 없으면 로컬 모드에서 홈 화면이 뜬다.

- [ ] **Step 9: 통과를 확인한다**

Run: `pnpm -C apps/web test && pnpm -r typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 10: 커밋**

```bash
git commit -m "feat(web): 로컬 모드에서 서버 전용 UI 를 걷어낸다

공용 리소스·승격 배지·참여자·사용자 메뉴·프로젝트 멤버·버전 이력 탭을
로컬 모드에서 렌더하지 않는다. 「버전」 버튼과 스냅샷·비교 탭은 남는다.

닫아 두는 것으로는 부족하다 — ResourcePanel 은 마운트 즉시, 승격 배지는
60초마다 로컬 라우터에 없는 프로시저를 부른다. 조건부 렌더가 아니면
화면에 오류가 뜬다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- apps/web/src/editor/header-tools.tsx apps/web/src/editor/version-dialog.tsx apps/web/src/components/app-shell.tsx apps/web/src/pages/project-settings.tsx apps/web/src/pages/project.tsx apps/web/src/routes.tsx apps/web/src/editor/header-tools.test.tsx apps/web/src/routes.test.tsx
```

---

## Task 12: 웹 — SSE 구독과 읽기 전용 배너

**Files:**
- Create: `apps/web/src/editor/use-local-watch.ts`
- Create: `apps/web/src/editor/use-local-watch.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Produces: `export function useLocalWatch(projectId: string, enabled: boolean): void`

**배경:** 로컬 서버가 외부 파일 변경을 잡으면 `/local/events` 로 `{"type":"reload"}` 를 보낸다.
받으면 `model.get` 을 다시 가져와 스토어를 `resync` 한다.

**`setLoaded` 가 아니라 `resync` 를 쓴다.** 셋이 갈린다(`use-model.ts` 의 긴 주석 참조):
그룹 뷰에서 튕기지 않고, 참여자 목록을 비우지 않으며, **`resync` 만 `keptSelection` 을 타** 사라진
대상이 선택에 남지 않는다. 로컬에 참여자는 없지만 나머지 둘은 그대로 적용된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/use-local-watch.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLocalWatch } from './use-local-watch'
import { useEditorStore } from './store'

/** EventSource 는 jsdom 에 없다 — 최소 스텁을 심는다. */
class FakeEventSource {
  static last: FakeEventSource | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false
  constructor(public url: string) { FakeEventSource.last = this }
  close() { this.closed = true }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.last = null
})
afterEach(() => { vi.unstubAllGlobals() })

describe('useLocalWatch', () => {
  it('enabled 가 false 면 구독하지 않는다', () => {
    renderHook(() => useLocalWatch('p1', false))
    expect(FakeEventSource.last).toBeNull()
  })

  it('enabled 면 /local/events 를 구독한다', () => {
    renderHook(() => useLocalWatch('p1', true))
    expect(FakeEventSource.last?.url).toContain('/local/events')
  })

  it('reload 를 받으면 모델을 다시 가져와 resync 한다', async () => {
    // trpc 목의 model.get 이 새 모델을 돌려주도록 구성한다(기존 에디터 테스트의 방식을 따른다).
    renderHook(() => useLocalWatch('p1', true))
    FakeEventSource.last!.emit({ type: 'reload' })
    await waitFor(() => {
      expect(useEditorStore.getState().seq).toBeGreaterThan(0)
    })
  })

  it('언마운트하면 소켓을 닫는다', () => {
    const { unmount } = renderHook(() => useLocalWatch('p1', true))
    const es = FakeEventSource.last!
    unmount()
    expect(es.closed).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/use-local-watch.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-local-watch"`

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/use-local-watch.ts`:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { serializeMutation } from './use-model.js'

/**
 * 로컬 서버의 파일 감시 알림을 받아 모델을 되맞춘다.
 *
 * 로컬 모드에는 실시간 협업이 없으므로 op 브로드캐스트도 presence 도 없다 —
 * 필요한 것은 "밖에서 파일이 바뀌었다" 한 줄뿐이라 SSE 로 충분하다.
 */
export function useLocalWatch(projectId: string, enabled: boolean): void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || projectId === '') return
    const es = new EventSource('/local/events')
    es.onmessage = (e) => {
      let payload: unknown
      try { payload = JSON.parse(e.data) } catch { return }
      if ((payload as { type?: string }).type !== 'reload') return
      // 내 편집이 in-flight 인 동안 끼어들어 낙관적 상태와 경합하지 않도록 같은 체인을 탄다
      // (use-realtime 이 수신 op 를 다루는 방식과 같다).
      void serializeMutation(async () => {
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        if (useEditorStore.getState().loadedProjectId !== projectId) return
        // setLoaded 가 아니라 resync 다 — resync 만 keptSelection 을 타서 사라진 대상이
        // 선택에 남지 않고, 그룹 뷰에서 튕기지 않는다(use-model.ts 의 주석 참조).
        useEditorStore.getState().resync(fresh.model, fresh.seq)
      })
    }
    return () => { es.close() }
  }, [enabled, projectId, queryClient, trpc])
}
```

- [ ] **Step 4: `project.tsx` 에 배선한다**

```tsx
  const isLocal = useIsLocal()
  useRealtime(isLocal ? '' : projectId)
  useLocalWatch(projectId, isLocal)
```

> Task 11 Step 7 에서 `useRealtime` 이 빈 projectId 로도 소켓을 여는지 확인해 뒀다. 열린다면
> 그 훅에 `enabled` 인자를 더해 여기서 끈다.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C apps/web test && pnpm -r typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 6: 읽기 전용 배너 — 로컬 서버가 상태를 알리게 한다**

`model.get` 의 출력은 서버 계약에 묶여 있어 필드를 더할 수 없다(계약 잠금이 막는다).
대신 로컬 서버가 **`model.mutate` 를 `BAD_REQUEST` 로 거절**하고 그 메시지가 이미 토스트로 뜬다
(`use-model.ts` 의 `catch`). 배너는 그 위에 얹는 별도 표면이므로 **이 사이클에서는 만들지 않는다.**

로컬 서버는 이미 `blocked` 를 SSE 로 보낸다(Task 8 — `store.state.ok` 가 거짓이면
`{type:'blocked', failures}`, 로드 실패 시 `isSelfWrite` 는 언제나 거짓이라 반드시 나간다).
남은 것은 **웹이 그것을 받아 편집을 잠그는 것**이다.

`use-local-watch.ts` 에서 `blocked` 를 받으면 스토어에 담는다.

```ts
      if ((payload as { type?: string }).type === 'blocked') {
        useEditorStore.getState().setBlocked(
          (payload as { failures: { path: string; message: string }[] }).failures,
        )
        return
      }
      useEditorStore.getState().setBlocked(null)
```

`apps/web/src/editor/store.ts` 에 상태와 액션을 더한다(기존 액션들의 형태를 그대로 따른다).

```ts
  /** 로컬 모드에서 파일이 깨져 편집이 잠긴 상태. null 이면 정상. */
  blocked: { path: string; message: string }[] | null
  setBlocked: (failures: { path: string; message: string }[] | null) => void
```

`project.tsx` 에서 배너를 그린다.

```tsx
        {blocked !== null && (
          <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            파일을 읽을 수 없어 편집이 잠겼습니다 — {blocked[0]!.path}: {blocked[0]!.message}
          </div>
        )}
```

편집 차단은 **이미 있는 규칙을 재사용한다** — `setBlocked` 가 `canEdit` 을 함께 내린다.

```ts
  setBlocked: (failures) => set({ blocked: failures, canEdit: failures === null }),
```

> ⚠️ `canEdit` 은 `setPermissions` 도 쓴다. 두 곳이 같은 값을 다투지 않도록, `setPermissions` 는
> `blocked !== null` 이면 `canEdit: false` 를 유지하도록 한다. **테스트로 잠근다**: 깨진 상태에서
> `project.get` 이 다시 도착해도 편집이 열리지 않아야 한다.

- [ ] **Step 7: 배너 테스트를 더한다**

`apps/web/src/editor/use-local-watch.test.tsx` 에 추가:

```tsx
  it('blocked 를 받으면 편집을 잠근다', async () => {
    renderHook(() => useLocalWatch('p1', true))
    FakeEventSource.last!.emit({
      type: 'blocked',
      failures: [{ path: 'erdd/tables/MBR.yaml', message: '파싱 실패' }],
    })
    await waitFor(() => {
      expect(useEditorStore.getState().blocked).toHaveLength(1)
      expect(useEditorStore.getState().canEdit).toBe(false)
    })
  })

  it('다시 reload 를 받으면 편집이 풀린다', async () => {
    renderHook(() => useLocalWatch('p1', true))
    FakeEventSource.last!.emit({ type: 'blocked', failures: [{ path: 'x', message: 'y' }] })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(false))
    FakeEventSource.last!.emit({ type: 'reload' })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(true))
  })

  it('깨진 동안 project.get 이 다시 와도 편집이 열리지 않는다', async () => {
    renderHook(() => useLocalWatch('p1', true))
    FakeEventSource.last!.emit({ type: 'blocked', failures: [{ path: 'x', message: 'y' }] })
    await waitFor(() => expect(useEditorStore.getState().canEdit).toBe(false))
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: true })
    expect(useEditorStore.getState().canEdit).toBe(false)
  })
```

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm -C apps/web test && pnpm -C packages/cli test && pnpm -r typecheck`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat(web): 로컬 모드의 파일 감시 구독과 편집 잠금을 넣는다

SSE 로 reload 를 받으면 모델을 다시 가져와 resync 한다 — setLoaded 가
아니라 resync 인 이유는 resync 만 keptSelection 을 타고 그룹 뷰에서
튕기지 않기 때문이다.

파일이 깨지면 blocked 를 받아 편집을 잠그고 배너를 띄운다. 성한 메모리
모델로 깨진 파일을 덮어쓰면 사용자의 수정이 조용히 사라진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- apps/web/src/editor/use-local-watch.ts apps/web/src/editor/use-local-watch.test.tsx apps/web/src/editor/store.ts apps/web/src/pages/project.tsx
```

---

## Task 13: 브라우저 스모크와 문서

**Files:**
- Modify: `docs/16-cli.md`
- Modify: `docs/manual/cli-guide.md`
- Modify: `docs/02-architecture.md`
- Modify: `docs/superpowers/HANDOFF.md`

**배경:** HANDOFF 2절이 못 박는다 — **CLI 의 명령·옵션·출력 문구·종료 코드·파일 포맷을 바꾸면
`cli-guide` 가 어긋난다**(그 문서는 실물 출력을 그대로 인용한다).

- [ ] **Step 1: 브라우저 스모크를 돌린다**

```bash
pnpm -C apps/web build
mkdir -p /tmp/erdd-smoke2 && cd /tmp/erdd-smoke2
node --import tsx <저장소>/packages/cli/src/main.ts init --local
node --import tsx <저장소>/packages/cli/src/main.ts serve --port 4399
```

브라우저에서 확인할 것(전부 통과해야 한다):

1. `http://127.0.0.1:4399/` 가 에디터로 리다이렉트된다.
2. 로그인 화면이 뜨지 않는다.
3. 테이블을 하나 만들고 컬럼을 더한다 → `erdd/tables/*.yaml` 이 생긴다.
4. 테이블을 드래그해 옮긴다 → `erdd/layout.yaml` 의 좌표가 바뀐다(**테이블 YAML 은 안 바뀐다**).
5. 메모를 하나 만든다 → `layout.yaml` 의 `notes` 에 들어간다.
6. 상단에 「공용 리소스」·참여자·사용자 메뉴가 **없다.**
7. 「버전」을 열면 「스냅샷」·「비교」는 있고 「이력」은 **없다.**
8. 스냅샷을 만들고 테이블을 지운 뒤 복원한다 → 되살아난다. `.erdd/snapshots.json` 이 생긴다.
9. 터미널에서 테이블 YAML 의 `logicalName` 을 고친다 → **새로고침 없이** 화면이 바뀐다.
10. 터미널에서 테이블 YAML 을 깨뜨린다(`name: [불완전`) → 배너가 뜨고 편집이 잠긴다. 되돌리면 풀린다.
11. Ctrl+C 로 끄고 다시 `serve` → 좌표·메모가 그대로다.

**실패한 항목은 그 자리에서 고치고 해당 Task 의 테스트에 케이스를 더한다.**

- [ ] **Step 2: `docs/16-cli.md` 를 고친다**

- 명령 표에 `serve` 행과 `init --local` 을 더한다.
- 파일 포맷 절의 트리에 `erdd/layout.yaml` 과 `.erdd/snapshots.json` 을 더한다.
- `erdd.config.yaml` 예시 아래에 "`serverUrl`·`projectId` 는 선택 값이다 — 둘 다 없으면 로컬 전용"을 적는다.
- **"배치 좌표·`notes`·공용 리소스 `origin`은 파일에 담지 않는다"** 문장을 고친다 — 좌표·메모는
  이제 `layout.yaml` 에 담긴다. **서버와 오가는 파일(`tables/`·최상위 5개)에는 여전히 없다**는 것이
  요점이므로 그렇게 다시 쓴다.
- "단계별 범위" 절에 로컬 모드 항목을 더한다.

- [ ] **Step 3: `docs/manual/cli-guide.md` 를 고친다**

`serve`·`init --local` 절을 더한다. **실물 출력을 그대로 인용한다**(Step 1 의 터미널에서 복사).
포함할 것: 기본 포트, `--port`·`--no-open`, 127.0.0.1 바인딩, 로컬 모드에서 없는 기능 목록,
파일이 깨졌을 때의 동작, `pull`/`push` 와 함께 쓰는 법.

- [ ] **Step 4: `docs/02-architecture.md` 를 고친다**

실행 형태가 둘이라는 것을 적는다 — ① 서버 배포(Postgres + 계정), ② 로컬 모드(`erdd serve`, 파일).

- [ ] **Step 5: `docs/superpowers/HANDOFF.md` 를 고친다**

- 1절 완료 표에 이 사이클 행을 더한다. 담을 것: 축소 라우터를 고른 이유, **계약 잠금이 급소라는 것**,
  좌표·메모를 `layout.yaml` 로 가른 이유, 자기 쓰기 서명 비교, `resync` vs `setLoaded`.
- 3절에 불변식을 더한다.
  > **3.18 로컬 라우터는 서버 라우터의 계약을 따른다.** 웹은 `AppRouter` 타입으로 클라이언트를
  > 만들므로 로컬 라우터가 어긋나도 컴파일에 안 잡히고 런타임에 깨진다. `router.test.ts` 의
  > `inferRouterInputs/Outputs` 대조와 프로시저 이름 집합 대조를 지우지 마라. **서버에 프로시저를
  > 더할 때 로컬에도 더할 필요는 없다** — 로컬 UI 에서 그 화면이 숨겨져 있으면 된다. 반대로 로컬
  > 모드에 보이는 화면이 부르는 프로시저는 반드시 로컬에도 있어야 한다.
- 테스트 기준선 수치를 갱신한다(`pnpm -C packages/core test` 등을 돌려 실측값을 적는다).

- [ ] **Step 6: 전체 검증**

Run: `pnpm -r typecheck && pnpm -C packages/core test && pnpm -C packages/cli test && pnpm -C apps/web test`
Expected: 전부 PASS, EXIT=0

- [ ] **Step 7: 커밋**

```bash
git commit -m "docs: 로컬 모드를 문서에 반영한다

16-cli 에 serve·init --local·layout.yaml·선택적 연결 설정을, cli-guide 에
실물 출력을 인용한 명령 레퍼런스를, 02-architecture 에 실행 형태 둘을 적는다.

HANDOFF 에 완료 항목과 3.18(로컬 라우터의 계약) 불변식을 더한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XKzabonBh9kvNDPZK6Fk5c" -- docs/16-cli.md docs/manual/cli-guide.md docs/02-architecture.md docs/superpowers/HANDOFF.md
```

---

## 완료 기준

1. `pnpm -r typecheck` EXIT=0
2. `pnpm -C packages/core test` · `pnpm -C packages/cli test` · `pnpm -C apps/web test` 전부 그린
3. Task 13 Step 1 의 브라우저 스모크 11항목 전부 통과
4. `apps/server` 변경이 `auth.me` 한 줄뿐인 것을 `git diff main -- apps/server` 로 확인
