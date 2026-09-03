# 로컬 모드 명시적 저장 · 스냅샷 git 이관 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 모드(`erdd serve`)의 편집이 곧바로 `erdd/` 파일이 되던 것을 드래프트 계층으로 바꿔 명시적 저장(`Cmd+S`)에서만 파일이 쓰이게 하고, 스냅샷을 gitignore 되는 `.erdd/snapshots.json` 에서 커밋 대상 `erdd/snapshots/<id>.json.gz` 로 옮긴다.

**Architecture:** `FileStore` 의 편집 경로(`mutate`/`setModel`/`#serialize`/`seq`)는 그대로 두고 **디바운스 쓰기의 대상만** `erdd/` 에서 `.erdd/draft.json` 으로 바꾼다. 저장·버리기·유지는 tRPC 프로시저가 아니라 **로컬 전용 HTTP 라우트**(`/local/events` SSE 의 선례)로 내어 HANDOFF 3.18 의 계약 잠금을 건드리지 않는다. 자기 쓰기 판정(`#written`/`#selfWrite`)은 드래프트 기준선(`#base.signature`)으로 승격되어 자기 쓰기 거르기와 외부 변경 감지를 함께 맡는다.

**Tech Stack:** TypeScript(ESM, Node ≥22) · Fastify + tRPC v11 · zod v4 · vitest · React 19 + zustand + TanStack Query · `node:zlib`(gzip, 새 의존성 없음) · `yaml`

**Spec:** [`docs/superpowers/specs/2026-09-03-local-save-model-design.md`](../specs/2026-09-03-local-save-model-design.md)

---

## Global Constraints

모든 태스크의 요구사항에 아래가 **암묵적으로 포함된다.**

- **응답·주석·문서·커밋 메시지는 한국어.** 임시 파일은 저장소 밖(세션 스크래치)에 만든다.
- **새 런타임 의존성을 늘리지 않는다.** 압축은 `node:zlib` 내장이다.
- **새 마이그레이션 없다. `apps/server/**` 를 고치지 않는다.**
- **로컬 라우터의 tRPC 프로시저를 하나도 늘리지 않는다.** `packages/cli/src/local/router.test.ts` 의 프로시저 이름 목록 단언과 `InputGaps`/`OutputGaps`/`LocalOnly` 세 타입은 **바뀌지 않고 그대로 초록**이어야 한다(spec §6.2). 그 파일을 고치게 되면 설계에서 벗어난 것이므로 멈추고 보고한다.
- **`docs/superpowers/HANDOFF.md` 를 고치지 않는다.** 다른 트랙(`feat/cli-ddl`)이 동시에 돌고 있고 갱신은 병합 후 컨트롤러가 한다.
- 🔥 **착수 전에 `main` 을 얹어라.** 이 워크트리는 `2307ec7` 기준인데 `feat/cli-ddl` 이 이미 병합됐다(`2618fc6`). 얹지 않으면 Task 11 이 고쳐야 할 `cli-guide.md` 의 신설 절(`export`·`import`)이 보이지 않고, 병합 뒤 그 절을 다시 손봐야 한다.
  ```bash
  git merge main          # 워크트리 안에서. 충돌이 나면 멈추고 보고한다
  pnpm install            # cli-ddl 이 의존성을 늘렸다면 필요하다
  ```
- **다른 트랙이 쥔 파일을 고치지 않는다:** `packages/cli/src/main.ts`(USAGE) · `packages/cli/src/commands/export.ts` · `packages/cli/src/commands/import.ts` · `packages/cli/src/commands/init.ts` · `packages/core/README.md`. 병합 뒤에도 **이 사이클은 그 파일들을 건드릴 일이 없다**(새 CLI 명령·새 플래그가 없다).
- **커밋은 경로 지정이다.** `git add -A` / `git commit -a` 금지. 신규 파일은 `git add <경로들> && git commit -m "..."` 처럼 **한 명령에 붙인다**(경로 지정 커밋 `git commit -- <경로>` 는 untracked 파일에 통하지 않는다). 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
  ```
- **기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 마라.** 이전 태스크 산출물도 고치지 마라 — **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
- **수정 건마다 구분력을 실증하라** — 프로덕션 변경을 되돌려 테스트가 실패하는지 보고 복구한다. **실패하지 않으면 덮지 말고 그렇다고 보고하라.** 🔥 **실증은 반드시 커밋 뒤에 한다**(커밋 전에 `git checkout -- <path>` 를 하면 그 태스크의 구현이 통째로 날아간다). 순서: 구현 → 테스트 초록 → 커밋 → 실증 → 되돌리기 → `git status` clean.
- **테스트 실행:**
  ```bash
  pnpm --filter @erdd/core exec vitest run <경로>
  pnpm --filter @erdd/cli  exec vitest run <경로>
  pnpm --filter @erdd/web  exec vitest run <경로>
  pnpm -r typecheck
  ```

### 판단 둘의 출처 (spec §13)

- **① 사용자 확정(2026-09-03).** 「내 편집 유지」 뒤의 저장은 **화면이 곧 파일**이 된다 — 밖에서 추가된 파일도 지워진다. Task 4 의 `keep()` 과 그 테스트가 자리다. **바꾸지 마라.**
- **② 작성자 판단(사용자 확정 아님).** `push` 에도 미저장 알림 한 줄을 붙인다. Task 8 의 자리다. 리뷰에서 빠지면 그 한 줄과 테스트 하나를 지우면 된다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/core/src/local-protocol.ts` | 로컬 전용 HTTP·SSE 프로토콜의 **유일한 정의처**(경로 상수·`LocalEvent`·`LocalSaveResult`·파서). IO 없음 | 1 |
| `packages/cli/src/local/draft.ts` | `.erdd/draft.json` 의 읽기·원자적 쓰기·삭제·손상 격리·`hasDraft` | 2 |
| `packages/cli/src/local/store.ts` | 드래프트 계층. `#base`/`#external`/`#draftPending`/`#dirty`, `flush`(드래프트), `adoptDraft` | 3 |
| 〃 | `save`/`discard`/`keep` 과 외부 변경 판정 | 4 |
| `packages/cli/src/local/server.ts` | 라우트 3개 등록(한 함수에 모은다 — spec §10.3), SSE `status`, 기동 배선 | 5 |
| `packages/cli/src/local/snapshots.ts` | `erdd/snapshots/<id>.json.gz` + `index.yaml`. 「디렉터리가 진실」 | 6 |
| `packages/cli/src/local/snapshot-migrate.ts` | 옛 `.erdd/snapshots.json` → 새 포맷 1회 이행 | 7 |
| `packages/cli/src/commands/{status,validate,push}.ts` | 미저장 알림 한 줄 | 8 |
| `apps/web/src/editor/use-local-save.ts` | 저장/버리기/유지 호출 + `Cmd+S`. 로컬에서만 마운트된다 | 9 |
| `apps/web/src/editor/local-save-controls.tsx` | 헤더 컨트롤 + 외부 변경 배너 | 10 |

**`use-local-watch.ts` 가 SSE 를 단독 소유한다.** `use-local-save` 는 자기 `EventSource` 를 열지 않고 store 를 읽는다 — 연결이 둘이면 서버의 접속 시 상태 전송이 두 번 나가고 어느 쪽이 최신인지 알 수 없다.

---

### Task 1: core 로컬 프로토콜

**Files:**
- Create: `packages/core/src/local-protocol.ts`
- Create: `packages/core/src/local-protocol.test.ts`
- Modify: `packages/core/src/index.ts:110` (`local.js` export 줄 아래)

**Interfaces:**
- Consumes: 없음(순수 모듈)
- Produces: `LOCAL_EVENTS_PATH`·`LOCAL_SAVE_PATH`·`LOCAL_DISCARD_PATH`·`LOCAL_KEEP_PATH`: `string` / `type LocalLoadFailure = { path: string; message: string }` / `type LocalEvent = { type:'reload' } | { type:'blocked'; failures: LocalLoadFailure[] } | { type:'status'; dirty: boolean; external: boolean }` / `type LocalSaveResult = { ok:true; seq:number; written:string[]; deleted:string[] } | { ok:false; reason:'blocked'|'external'; message:string }` / `parseLocalEvent(raw: string): LocalEvent | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/local-protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LOCAL_EVENTS_PATH, LOCAL_SAVE_PATH, parseLocalEvent } from './local-protocol.js'

describe('parseLocalEvent', () => {
  it('reload·blocked·status 를 그대로 되살린다', () => {
    expect(parseLocalEvent(JSON.stringify({ type: 'reload' }))).toEqual({ type: 'reload' })
    expect(parseLocalEvent(JSON.stringify({
      type: 'blocked', failures: [{ path: 'erdd/', message: '깨졌다' }],
    }))).toEqual({ type: 'blocked', failures: [{ path: 'erdd/', message: '깨졌다' }] })
    expect(parseLocalEvent(JSON.stringify({ type: 'status', dirty: true, external: false })))
      .toEqual({ type: 'status', dirty: true, external: false })
  })

  /**
   * ⚠️ 모르는 type 에 null 을 돌려주는 것이 **옛 웹이 새 이벤트를 만나도 죽지 않게** 하는 자리다.
   * 설치본의 웹 번들은 CLI 버전과 따로 움직인다(패키지에 동봉된 것과 저장소 빌드가 다를 수 있다).
   */
  it('모르는 type·깨진 JSON·형식 위반은 null 이다', () => {
    expect(parseLocalEvent(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseLocalEvent('{')).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'status', dirty: 'yes', external: false }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'blocked' }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'blocked', failures: [{ path: 1, message: 'x' }] }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify(['reload']))).toBeNull()
  })

  it('경로 상수는 /local/ 아래에 있다', () => {
    expect(LOCAL_EVENTS_PATH).toBe('/local/events')
    expect(LOCAL_SAVE_PATH).toBe('/local/save')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/local-protocol.test.ts`
Expected: FAIL — `Failed to resolve import "./local-protocol.js"`

- [ ] **Step 3: 최소 구현**

`packages/core/src/local-protocol.ts`:

```ts
/**
 * 로컬 서버(`erdd serve`)와 웹 사이의 **tRPC 밖 채널** 정의. 저장·버리기·유지는 서버 라우터에 없는
 * 로컬 전용 동작이라 tRPC 프로시저로 만들 수 없다 — 만들면 `router.test.ts` 의 `LocalOnly` 잠금이
 * 깨지고, 애초에 웹은 `AppRouter` 타입으로 클라이언트를 만들어 그 이름을 부를 수조차 없다.
 * `GET /local/events`(SSE)가 이미 같은 형태라 그 선례를 따른다(설계 §6).
 *
 * ⚠️ **tRPC 밖으로 나가면 타입 계약이 사라지므로 정의를 여기 한자리에 둔다.** 예전에는 SSE 페이로드
 * 모양이 `server.ts` 와 `use-local-watch.ts` 에 **각각 인라인 리터럴로 두 벌** 적혀 있었다 —
 * HANDOFF 3.18 이 닫으려는 것과 같은 종류의 표류다. `realtime-protocol.ts` 와 같은 형태다.
 */
export const LOCAL_EVENTS_PATH = '/local/events'
export const LOCAL_SAVE_PATH = '/local/save'
export const LOCAL_DISCARD_PATH = '/local/discard'
export const LOCAL_KEEP_PATH = '/local/keep'

export type LocalLoadFailure = { path: string; message: string }

/**
 * 서버 → 브라우저 단방향 알림.
 * - `reload`: 디스크가 바뀌었고 그것을 채택했다. 브라우저가 모델을 다시 가져온다
 * - `blocked`: 파일이 깨져 편집이 잠겼다
 * - `status`: 미저장 여부·외부 변경 여부. **모델을 나르지 않는다** — 드래그 중에 와도 화면이 튀지 않는다
 */
export type LocalEvent =
  | { type: 'reload' }
  | { type: 'blocked'; failures: LocalLoadFailure[] }
  | { type: 'status'; dirty: boolean; external: boolean }

/** `written`·`deleted` 가 둘 다 비면 쓸 것이 없었다는 뜻이고 그것도 성공이다. */
export type LocalSaveResult =
  | { ok: true; seq: number; written: string[]; deleted: string[] }
  | { ok: false; reason: 'blocked' | 'external'; message: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFailure = (v: unknown): v is LocalLoadFailure =>
  isRecord(v) && typeof v['path'] === 'string' && typeof v['message'] === 'string'

/** 반환 null = 형식 오류이거나 **모르는 type** 이다(옛 웹이 새 이벤트를 만나도 죽지 않는다). */
export function parseLocalEvent(raw: string): LocalEvent | null {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!isRecord(v)) return null
  if (v['type'] === 'reload') return { type: 'reload' }
  if (v['type'] === 'blocked') {
    const failures = v['failures']
    if (!Array.isArray(failures) || !failures.every(isFailure)) return null
    return { type: 'blocked', failures }
  }
  if (v['type'] === 'status') {
    const { dirty, external } = v
    if (typeof dirty !== 'boolean' || typeof external !== 'boolean') return null
    return { type: 'status', dirty, external }
  }
  return null
}
```

`packages/core/src/index.ts` 의 110행(`export { LOCAL_PROJECT_ID, type RunMode } from './local.js'`) **아래**에 더한다:

```ts
export {
  LOCAL_EVENTS_PATH, LOCAL_SAVE_PATH, LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, parseLocalEvent,
} from './local-protocol.js'
export type { LocalEvent, LocalLoadFailure, LocalSaveResult } from './local-protocol.js'
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/local-protocol.test.ts && pnpm -r typecheck`
Expected: PASS (3 tests), typecheck 0 errors

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/local-protocol.ts packages/core/src/local-protocol.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'MSG'
feat(core): 로컬 전용 HTTP·SSE 프로토콜을 한자리에 정의한다

저장·버리기·유지는 서버 라우터에 없어 tRPC 로 낼 수 없다(LocalOnly 잠금).
tRPC 밖으로 나가면 타입 계약이 사라지므로 realtime-protocol.ts 와 같은 형태로
경로 상수·이벤트 union·파서를 core 에 둔다. 지금 SSE 페이로드가 server.ts 와
use-local-watch.ts 에 두 벌 인라인으로 적혀 있는 것도 이 모듈로 모은다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`parseLocalEvent` 의 `if (v['type'] === 'status')` 블록에서 `typeof dirty !== 'boolean'` 검사를 지운다 → `pnpm --filter @erdd/core exec vitest run src/local-protocol.test.ts` 가 **실패**해야 한다(`dirty: 'yes'` 케이스). `git checkout -- packages/core/src/local-protocol.ts` 로 되돌리고 `git status` 가 clean 인지 확인한다.

---

### Task 2: 드래프트 파일 모듈

**Files:**
- Create: `packages/cli/src/local/draft.ts`
- Create: `packages/cli/src/local/draft.test.ts`

**Interfaces:**
- Consumes: `ProjectModelSchema`·`type ProjectModel` (`@erdd/core`), `STATE_DIR` (`../config.js`)
- Produces:
  - `DRAFT_FILE = '.erdd/draft.json'`
  - `type Draft = { formatVersion: 1; baseSignature: string; seq: number; updatedAt: string; model: ProjectModel }`
  - `type DraftRead = { kind: 'none' } | { kind: 'corrupt'; backupPath: string } | { kind: 'ok'; draft: Draft }`
  - `readDraft(cwd: string): Promise<DraftRead>` — 손상이면 **격리(rename)까지 하고** `corrupt` 를 돌려준다
  - `writeDraft(cwd: string, draft: Draft): Promise<void>` — 임시 파일 + `rename`(원자적)
  - `removeDraft(cwd: string): Promise<void>` — 없어도 성공
  - `hasDraft(cwd: string): Promise<boolean>` — 존재만 본다(파싱하지 않는다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/draft.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { DRAFT_FILE, hasDraft, readDraft, removeDraft, writeDraft, type Draft } from './draft.js'

const dir = () => mkdtemp(join(tmpdir(), 'erdd-draft-'))

const draftOf = (over: Partial<Draft> = {}): Draft => ({
  formatVersion: 1,
  baseSignature: 'sig-1',
  seq: 7,
  updatedAt: '2026-09-03T05:25:30.000Z',
  model: createEmptyModel(),
  ...over,
})

/** 라우터를 거치지 않아야 담을 수 있는 모양을 직접 만든다. */
async function writeRaw(cwd: string, body: string): Promise<void> {
  await mkdir(join(cwd, '.erdd'), { recursive: true })
  await writeFile(join(cwd, DRAFT_FILE), body, 'utf8')
}

describe('draft', () => {
  it('없으면 none 이고 hasDraft 는 false 다', async () => {
    const cwd = await dir()
    expect(await readDraft(cwd)).toEqual({ kind: 'none' })
    expect(await hasDraft(cwd)).toBe(false)
  })

  it('쓰고 읽으면 그대로 돌아온다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf())
    expect(await hasDraft(cwd)).toBe(true)
    const r = await readDraft(cwd)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.draft.baseSignature).toBe('sig-1')
    expect(r.draft.seq).toBe(7)
    expect(r.draft.model).toEqual(createEmptyModel())
  })

  it('임시 파일을 남기지 않는다 — .erdd 에는 draft.json 하나만 남는다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf())
    await writeDraft(cwd, draftOf({ seq: 8 }))
    expect(await readdir(join(cwd, '.erdd'))).toEqual(['draft.json'])
  })

  /**
   * 🔥 **이 사이클에서 가장 중요한 방어다.** 반쪽짜리 `model` 을 그대로 얹으면
   * `{ ...createEmptyModel(), ...model }` 정규화가 「유효한 빈 모델」을 만들고, 그것은 무결성
   * 검사에 걸릴 것이 없어 통과한 뒤 **다음 저장이 사용자의 `erdd/` 를 통째로 비운다.**
   * `snapshots.ts` 의 `snapshotModel` 이 막는 것과 같은 사고이고 **더 나쁘다** — 스냅샷은 사용자가
   * 복원을 눌러야 닿지만 드래프트는 기동 시 자동으로 얹힌다.
   *
   * ⚠️ **손상 드래프트를 지우지 않는다.** 사용자의 미저장 작업이 든 유일한 사본일 수 있다.
   */
  const BROKEN: [name: string, body: string][] = [
    ['JSON 이 잘렸다', '{"formatVersion":1,"model":{'],
    ['model 키가 없다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x' })],
    ['model 이 빈 객체다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x', model: {} })],
    ['필수 컬렉션이 모자란다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x', model: { tables: {}, columns: {} } })],
    ['최상위가 배열이다', '[]'],
  ]

  for (const [label, body] of BROKEN) {
    it(`손상 드래프트는 corrupt 로 알리고 지우지 않는다 — ${label}`, async () => {
      const cwd = await dir()
      await writeRaw(cwd, body)
      const r = await readDraft(cwd)
      expect(r.kind).toBe('corrupt')
      if (r.kind !== 'corrupt') return
      // 원본 내용이 백업 파일에 그대로 살아 있다.
      expect(await readFile(r.backupPath, 'utf8')).toBe(body)
      // 격리했으므로 다음 기동은 드래프트가 없는 상태로 깨끗하게 시작한다.
      expect(await hasDraft(cwd)).toBe(false)
    })
  }

  /**
   * ⚠️ 손상 판정이 **정상 경로를 막지 않는다**는 증거다. 이것이 없으면 위 잠금은
   * 「빈 모델을 전부 거절」로 과하게 조여도 초록으로 남는다.
   */
  it('정당하게 비어 있는 모델은 통과한다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf({ model: createEmptyModel() }))
    expect((await readDraft(cwd)).kind).toBe('ok')
  })

  it('removeDraft 는 없어도 던지지 않는다', async () => {
    const cwd = await dir()
    await expect(removeDraft(cwd)).resolves.toBeUndefined()
    await writeDraft(cwd, draftOf())
    await removeDraft(cwd)
    expect(await hasDraft(cwd)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/draft.test.ts`
Expected: FAIL — `Failed to resolve import "./draft.js"`

- [ ] **Step 3: 최소 구현**

`packages/cli/src/local/draft.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ProjectModelSchema, type ProjectModel } from '@erdd/core'
import { STATE_DIR } from '../config.js'

export const DRAFT_FILE = `${STATE_DIR}/draft.json`

/**
 * 저장하지 않은 편집. **모델+배치가 한 덩어리**다(좌표·메모가 `model` 안에 들어 있다).
 *
 * `baseSignature` 는 이 드래프트를 뜬 시점의 파일 서명이다 — `serve` 가 꺼진 사이 `git pull` 이
 * 파일을 바꿨는지 **재시작 때 판정하는 유일한 근거**다. 조용히 얹으면 사용자는 브랜치가 바뀐 줄
 * 모른 채 저장해 남의 변경을 덮는다.
 */
export type Draft = {
  formatVersion: 1
  baseSignature: string
  seq: number
  updatedAt: string
  model: ProjectModel
}

export type DraftRead =
  | { kind: 'none' }
  | { kind: 'corrupt'; backupPath: string }
  | { kind: 'ok'; draft: Draft }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 드래프트를 읽는다. **손상이면 지우지 않고 격리한 뒤 `corrupt` 로 알린다.**
 *
 * 🔥 `ProjectModelSchema` 로 판정하는 것이 요점이다. 손으로 만든 모양 검사(`model` 키 유무)로는
 * 부족하다 — `{}` 가 그대로 통과해 `{ ...createEmptyModel(), ...model }` 정규화에서 「유효한 빈
 * 모델」이 되고, 무결성 검사에 걸릴 것이 없어 통과한 뒤 **다음 저장이 `erdd/` 를 통째로 비운다.**
 * `snapshots.ts` 의 같은 방어와 한 벌이다.
 *
 * ⚠️ 반환하는 `model` 은 원본이 아니라 **파싱 결과**다 — `words`·`terms`·`customFields` 는
 * `.default({})` 라 누락 컬렉션 보충이 파싱 안에서 일어난다. 원본을 그대로 넘기면 그 보충이 사라진다.
 */
export async function readDraft(cwd: string): Promise<DraftRead> {
  const abs = join(cwd, DRAFT_FILE)
  let raw: string
  try {
    raw = await readFile(abs, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
    throw err
  }

  const quarantine = async (): Promise<DraftRead> => {
    const backupPath = join(cwd, `${STATE_DIR}/draft.corrupt-${Date.now()}.json`)
    await rename(abs, backupPath)
    return { kind: 'corrupt', backupPath }
  }

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return quarantine() }
  if (!isRecord(parsed)) return quarantine()

  const model = ProjectModelSchema.safeParse(parsed['model'])
  if (!model.success) return quarantine()

  return {
    kind: 'ok',
    draft: {
      formatVersion: 1,
      baseSignature: typeof parsed['baseSignature'] === 'string' ? parsed['baseSignature'] : '',
      seq: typeof parsed['seq'] === 'number' ? parsed['seq'] : 0,
      updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : '',
      model: model.data,
    },
  }
}

/**
 * **원자적으로 쓴다** — 임시 파일에 쓰고 `rename` 한다. 이 파일 하나가 사용자의 미저장 작업 전부를
 * 담으므로, 쓰다가 죽어 반쪽이 남는 갈래를 만들면 안 된다(`rename` 은 같은 파일시스템에서 원자적이다).
 */
export async function writeDraft(cwd: string, draft: Draft): Promise<void> {
  const abs = join(cwd, DRAFT_FILE)
  await mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  await writeFile(tmp, `${JSON.stringify(draft)}\n`, 'utf8')
  await rename(tmp, abs)
}

/** 이미 없는 것은 성공으로 본다. */
export async function removeDraft(cwd: string): Promise<void> {
  try {
    await rm(join(cwd, DRAFT_FILE))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * 존재만 본다 — **파싱하지 않는다.** `status`·`validate`·`push` 가 이것만 쓰므로, 손상된 드래프트
 * 때문에 그 명령들이 실패하거나 (더 나쁘게) 격리를 일으키면 안 된다.
 */
export async function hasDraft(cwd: string): Promise<boolean> {
  try {
    await readFile(join(cwd, DRAFT_FILE), 'utf8')
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/draft.test.ts && pnpm -r typecheck`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/draft.ts packages/cli/src/local/draft.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): 드래프트 파일 모듈을 더한다

.erdd/draft.json 의 읽기·원자적 쓰기·삭제·손상 격리. 손상 판정은
ProjectModelSchema 로 한다 — 손으로 만든 모양 검사는 {} 를 통과시켜
「유효한 빈 모델」이 되고, 그것이 다음 저장에서 erdd/ 를 통째로 비운다
(snapshots.ts 의 같은 방어와 한 벌). 손상본은 지우지 않고 격리한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`readDraft` 의 `ProjectModelSchema.safeParse` 판정을 `parsed['model'] !== undefined` 로 되돌린다 → 테스트가 **`model 이 빈 객체다`·`필수 컬렉션이 모자란다` 두 건에서 실패**해야 한다. `git checkout -- packages/cli/src/local/draft.ts` 로 되돌리고 `git status` clean 확인.

---

### Task 3: FileStore — 디바운스의 쓰기 대상을 드래프트로 바꾼다

**Files:**
- Modify: `packages/cli/src/local/store.ts` (`#written`/`#selfWrite`/`#tree`/`#layout` → `#base`, `flush()` 의 대상, `adoptDraft()` 추가)
- Modify: `packages/cli/src/local/store.test.ts` (기존 `flush` 관련 단언 정정 + 새 잠금)

**Interfaces:**
- Consumes: `readDraft`·`writeDraft`·`removeDraft`·`type Draft` (Task 2)
- Produces:
  - `get dirty(): boolean` — 저장할 것이 남았는가(내용 비교 결과)
  - `get external(): boolean` — 디스크가 `#base` 와 달라졌는데 사용자가 아직 고르지 않았다
  - `flush(): Promise<void>` — **이름과 호출부는 그대로, 대상만 드래프트로 바뀐다**
  - `adoptDraft(): Promise<void>` — 기동 시 1회. 첫 `load()` 뒤에 부른다
- ⚠️ **`isSelfWrite` getter 는 사라진다.** 유일한 호출부는 `server.ts:164` 이고 Task 5 가 그 자리를 고친다. 이 태스크에서는 `store.test.ts` 의 `isSelfWrite` 단언만 정리하고 `server.ts` 는 건드리지 않는다 — Task 3 끝 시점에 `server.ts` 가 컴파일되도록 **getter 를 남기되 `!this.#externalPending` 로 위임**하지 말고, **Task 3 과 Task 5 를 한 번에 검증**한다(아래 Step 4 의 주의).

> ⚠️ **이 태스크는 `server.ts` 를 깨뜨린다.** `store.isSelfWrite` 를 지우면 `server.ts:164` 가
> 컴파일되지 않는다. 그래서 **Task 3 의 Step 3 에서 `server.ts:164` 의 그 한 줄만 함께 고친다**
> (`if (store.isSelfWrite) return` → 삭제). 나머지 서버 변경은 Task 5 다. 태스크 경계를 넘는 최소
> 수정이고, 이것을 미루면 Task 3 이 typecheck 초록으로 끝날 수 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/store.test.ts` 에 새 describe 를 더한다. **기존 `describe('FileStore.flush')` 의 두 테스트는 이 태스크에서 의미가 바뀐다** — `'바뀐 파일만 쓴다'`·`'모델에서 사라진 테이블의 파일은 여전히 지운다'` 는 `flush()` 가 아니라 **`save()`** 를 부르도록 고쳐야 하는데, `save()` 는 Task 4 다. **이 태스크에서는 그 두 테스트에 `.skip` 을 달고 Task 4 가 되살린다**(지우지 않는다 — 되살릴 것을 잊지 않게).

```ts
import { hasDraft, readDraft, writeDraft } from './draft.js'

describe('FileStore 드래프트', () => {
  /**
   * 🔥 **이 사이클의 존재 이유다.** 편집이 파일을 건드리지 않는다는 것을 직접 잠근다.
   *
   * ⚠️ 픽스처의 테이블 파일에 `id` 가 **이미 있어야 한다** — 없으면 `#loadOnce` 의 신규 id
   * 되쓰기가 파일을 건드려, 이 테스트가 「편집이 안 썼다」가 아니라 「되쓰기가 썼다」를 재게 된다.
   * 위 `MBR` 픽스처는 id 를 갖고 있다.
   */
  it('편집과 flush 는 erdd/ 를 건드리지 않는다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    const before = await stat(join(cwd, 'erdd/tables/MBR.yaml'))
    const bodyBefore = await readFile(join(cwd, 'erdd/tables/MBR.yaml'), 'utf8')

    await store.mutate([renameTable('MBR2')])
    await store.flush()

    const after = await stat(join(cwd, 'erdd/tables/MBR.yaml'))
    expect(await readFile(join(cwd, 'erdd/tables/MBR.yaml'), 'utf8')).toBe(bodyBefore)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    // 대신 드래프트가 생겼다.
    expect(await hasDraft(cwd)).toBe(true)
    expect(store.dirty).toBe(true)
  })

  it('드래프트에 담긴 모델이 편집 결과다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    const r = await readDraft(cwd)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.draft.model.tables[TABLE_ID]!.physicalName).toBe('MBR2')
    expect(r.draft.seq).toBe(1)
  })

  /**
   * 되돌리는 편집(A→B→A)에서 「미저장」이 남으면 표시가 거짓말을 하고 저장 버튼이 쓸 것 없는
   * 저장을 하게 된다. **그래서 `#dirty` 는 플래그가 아니라 내용 비교다.**
   */
  it('편집을 되돌리면 dirty 가 내려가고 드래프트 파일이 지워진다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()
    expect(store.dirty).toBe(true)

    await store.mutate([renameTable('MBR')])
    await store.flush()
    expect(store.dirty).toBe(false)
    expect(await hasDraft(cwd)).toBe(false)
  })

  it('adoptDraft 가 재시작을 넘어 편집을 되살린다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(cwd)
    await first.load()
    await first.mutate([renameTable('MBR2')])
    await first.flush()

    const second = new FileStore(cwd)
    await second.load()
    await second.adoptDraft()
    expect(second.state.model.tables[TABLE_ID]!.physicalName).toBe('MBR2')
    expect(second.dirty).toBe(true)
    // 파일은 여전히 옛 이름이다 — 저장하지 않았으므로.
    expect(await readFile(join(cwd, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('name: MBR\n')
  })

  /**
   * `serve` 가 꺼진 사이 `git pull`·`git checkout` 이 파일을 바꾼 경우다. 조용히 얹으면 사용자는
   * 브랜치가 바뀐 줄 모른 채 저장해 남의 변경을 덮는다.
   */
  it('드래프트의 기준선이 지금 파일과 다르면 external 을 함께 세운다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(cwd)
    await first.load()
    await first.mutate([renameTable('MBR2')])
    await first.flush()

    // serve 가 꺼진 사이 밖에서 파일이 바뀌었다.
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR.replace('logicalName: 회원', 'logicalName: 멤버'), 'utf8')

    const second = new FileStore(cwd)
    await second.load()
    await second.adoptDraft()
    expect(second.dirty).toBe(true)
    expect(second.external).toBe(true)
    expect(second.state.model.tables[TABLE_ID]!.physicalName).toBe('MBR2')
  })

  it('손상 드래프트는 얹지 않고 파일 그대로 연다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    await mkdir(join(cwd, '.erdd'), { recursive: true })
    await writeFile(join(cwd, '.erdd/draft.json'), '{"model":{}}', 'utf8')

    const store = new FileStore(cwd)
    await store.load()
    await store.adoptDraft()
    expect(store.state.model.tables[TABLE_ID]!.physicalName).toBe('MBR')
    expect(store.dirty).toBe(false)
  })

  /**
   * 첫 `load()` 가 실패하면(파일 손상) 얹을 기준선이 없다. 들고 있다가 파일이 고쳐져 로드가
   * 성공하는 순간 얹는다 — 그때까지 편집은 어차피 잠겨 있다.
   */
  it('파일이 깨진 채로 기동하면 드래프트를 들고 있다가 복구 시 얹는다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(cwd)
    await first.load()
    await first.mutate([renameTable('MBR2')])
    await first.flush()

    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), ': : 깨진 YAML :', 'utf8')
    const second = new FileStore(cwd)
    expect((await second.load()).ok).toBe(false)
    await second.adoptDraft()
    expect(second.dirty).toBe(false)          // 아직 얹지 않았다

    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR, 'utf8')
    expect((await second.load()).ok).toBe(true)
    expect(second.state.model.tables[TABLE_ID]!.physicalName).toBe('MBR2')
    expect(second.dirty).toBe(true)
  })
})
```

테스트 파일 위쪽에 헬퍼를 더한다(`MBR` 픽스처 바로 아래):

```ts
const TABLE_ID = '018f6b0e-0000-7000-8000-000000000001'

/** 물리명만 바꾸는 update op. `before` 가 있어야 parseOps 를 통과한다. */
const renameTable = (to: string): Op => ({
  action: 'update',
  entity: 'table',
  entityId: TABLE_ID,
  patch: { physicalName: to },
})
```

> ⚠️ **`renameTable` 의 op 모양은 `packages/core/src/op.ts` 의 `update` 스키마와 정확히 맞아야
> 한다.** 계획을 실행하기 전에 그 파일을 열어 `update` op 가 `patch` 를 쓰는지 `data`/`before` 를
> 함께 요구하는지 확인하고, **어긋나면 프로덕션이 아니라 이 단언을 정정한 뒤 보고하라.**

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/store.test.ts -t '드래프트'`
Expected: FAIL — `store.dirty is not a function` / `adoptDraft is not a function`

- [ ] **Step 3: 구현**

`store.ts` 의 필드·메서드를 바꾼다.

```ts
import { readDraft, removeDraft, writeDraft, type Draft } from './draft.js'

// ── 필드 ──
/**
 * 마지막으로 **채택했거나 사용자가 인정한** 디스크 상태. 저장의 비교 기준이고(`writeTreeChanges`
 * 의 `base`), 동시에 **외부 변경 감지의 기준**이다.
 *
 * 옛 `#written`/`#selfWrite` 가 여기로 합쳐졌다. 지금의 자기 쓰기 판정은 「방금 읽은 것 == 내가
 * 마지막으로 쓴 것」이었는데, 드래프트 이후에는 「방금 읽은 것 == 내가 아는 파일 상태」가 **자기
 * 쓰기 거르기와 외부 변경 감지를 동시에** 한다. 비교식은 그대로다 — `load()` 전후를 비교하는
 * 방식으로는 판정할 수 없다는 옛 주석의 이유도 그대로다.
 *
 * ⚠️ `signature` 의 초깃값 `''` 는 **어떤 실제 서명과도 같을 수 없다**(`canonical` 은 객체에 대해
 * 언제나 문자열을 낸다). 그래서 첫 `load()` 는 언제나 채택한다.
 */
#base: { tree: FileTree; layout: LayoutData; signature: string } =
  { tree: {}, layout: EMPTY_LAYOUT, signature: '' }

/**
 * 디스크가 `#base` 와 달라졌는데 **사용자가 아직 고르지 않았다.**
 *
 * 밖에서 온 내용을 들고 있지 않고 플래그 하나다 — 들고 있으면 그 사이 디스크가 또 바뀌었을 때
 * 낡은 것을 `#base` 로 승격시킨다. `keep`·`discard` 가 그 시점에 디스크를 다시 읽으므로 두 번째
 * 외부 변경에 대해 스스로 교정된다.
 */
#external = false

/** 드래프트 **파일에 쓸 것**이 남았는가(디바운스 플래그). 옛 `#dirty` 의 역할이다. */
#draftPending = false

/**
 * **저장할 것**이 남았는가. 플래그가 아니라 **내용 비교 결과**다 — 되돌리는 편집(A→B→A)에서
 * `#draftPending` 은 참이고 이것은 거짓이다. 합치면 「미저장」 표시가 거짓말을 한다.
 */
#dirty = false

/** 아직 얹지 못한 드래프트(첫 `load()` 가 실패했을 때). 성공하는 순간 얹는다. */
#pendingDraft: Draft | null = null

get dirty(): boolean { return this.#dirty }
get external(): boolean { return this.#external }
```

`#commitLoad` 의 성공 경로를 갈아끼운다(실패 경로와 seq 가드는 **그대로 둔다**):

```ts
if (this.#state.seq !== seqAtStart) return { state: this.#state, stale: true }

const signature = signatureOf(outcome.tree, outcome.layout)
if (signature === this.#base.signature) {
  // 자기 저장이거나 실제로 달라진 것이 없다 — 브라우저를 흔들 이유가 없다.
  this.#tryAdoptPending()
  return { state: this.#state, stale: false }
}
if (this.#dirty || this.#draftPending) {
  // 미저장 편집이 있다 — 채택하지 않고 사용자가 고르게 한다(설계 D2, 자동 병합 없음).
  this.#external = true
  return { state: this.#state, stale: false }
}
this.#base = { tree: outcome.tree, layout: outcome.layout, signature }
this.#state = { ok: true, model: outcome.model, seq: seqAtStart }
this.#tryAdoptPending()
return { state: this.#state, stale: false }
```

`load()` 의 재시도 루프에서 **`flush()` 호출을 걷어낸다.** 상한에 닿으면 버리지 말고 `#external` 을 세운다:

```ts
async load(): Promise<StoreState> {
  for (let attempt = 1; ; attempt += 1) {
    const { state, stale } = await this.#loadOnce()
    if (!stale) return state
    // 겹친 편집을 만난 로드는 그냥 다시 읽는다 — 드래프트 이후에는 **읽기가 미저장 편집을
    // 건드릴 수 없으므로** 먼저 flush 할 이유가 없다(옛 주석의 사고가 성립하지 않는다).
    if (attempt >= MAX_LOAD_ATTEMPTS) {
      // ⚠️ 버리지 않는다. 지금은 「자기 flush 가 다시 감시를 깨운다」가 회수해 줬는데, 편집이
      // 더 이상 erdd/ 를 쓰지 않으므로 그 회수 경로가 없어졌다 — 버리면 이 로드가 들고 온
      // 외부 변경 알림이 통째로 사라진다.
      this.#external = true
      return state
    }
  }
}
```

`#loadOnce` 의 **신규 id 되쓰기**에서 되쓴 내용을 `tree` 에 반영한다(spec §4.4 의 함정):

```ts
if (result.assignedTree !== undefined) {
  for (const [rel, content] of Object.entries(result.assignedTree)) {
    if (canonical(tree[rel], rel) === canonical(content, rel)) continue
    const abs = join(this.#cwd, rel)
    try {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, stringifyYaml(content), 'utf8')
      // ⚠️ **되쓴 것을 tree 에 반영해야 한다.** 안 하면 #base 가 디스크보다 뒤처져, 이 쓰기가
      // 깨운 다음 감시가 「밖에서 바뀌었다」로 판정해 **거짓 충돌 배너**를 띄운다. 옛 코드에서는
      // #written 이 modelToFiles 결과라 우연히 가려져 있었다.
      tree[rel] = content
    } catch (err) {
      return fail([{ path: rel, message: (err as Error).message }])
    }
  }
}
```

`flush()` 의 몸통을 드래프트 쓰기로 갈아끼운다(**이름과 호출부는 그대로 둔다**):

```ts
/**
 * 대기 중인 **드래프트** 쓰기를 지금 끝낸다. 프로세스 종료 전에 반드시 부른다.
 *
 * 옛 구현은 여기서 `erdd/` 에 썼다 — 그 대상이 `.erdd/draft.json` 으로 바뀐 것이 이 사이클의
 * 전부다. 파일 쓰기는 `save()` 만 한다.
 *
 * `#dirty` 를 여기서 **다시 계산한다** — 내용 비교 비용(`modelToFiles` 한 번)이 드는 유일한
 * 자리이고, 디바운스돼 있으므로 드래그 프레임마다 계산하지 않는다.
 */
async flush(): Promise<void> {
  return this.#serialize(async () => {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    if (!this.#draftPending) return
    const { tree } = modelToFiles(this.#state.model)
    const layout = layoutFromModel(this.#state.model)
    const dirty = signatureOf(tree, layout) !== this.#base.signature
    if (dirty) {
      await writeDraft(this.#cwd, {
        formatVersion: 1,
        baseSignature: this.#base.signature,
        seq: this.#state.seq,
        updatedAt: new Date().toISOString(),
        model: this.#state.model,
      })
    } else {
      await removeDraft(this.#cwd)
    }
    // 쓰기가 성공한 뒤에만 내린다 — 실패하면 참으로 남아 다음 flush 가 재시도한다.
    this.#draftPending = false
    this.#dirty = dirty
  })
}
```

`#commit` 에서 `this.#dirty = true` 를 `this.#draftPending = true` 로 바꾸고 주석을 고친다:

```ts
this.#draftPending = true
if (this.#timer !== null) clearTimeout(this.#timer)
// 드래그 한 번이 초당 수십 건의 mutate 를 낸다 — 매번 드래프트를 쓰면 디스크가 요동친다.
// 타이머發 호출은 아무도 반환값을 보지 않으므로 실패를 삼킨다 — #draftPending 은 flush() 가
// 실패 시 참으로 남기므로 다음 편집이나 명시적 flush() 가 재시도한다.
this.#timer = setTimeout(() => { this.flush().catch(() => {}) }, WRITE_DEBOUNCE_MS)
```

`adoptDraft()` 와 `#tryAdoptPending()` 을 더한다:

```ts
/**
 * 기동 시 1회. 드래프트가 있으면 얹어 「미저장 변경 있음」 상태로 연다.
 *
 * **첫 `load()` 가 성공했을 때만 얹는다** — 실패했으면 얹을 기준선(`#base`)이 없고 어차피 편집이
 * 잠겨 있다. 그때는 들고 있다가 파일이 고쳐져 로드가 성공하는 순간 얹는다(`#tryAdoptPending`).
 */
async adoptDraft(): Promise<void> {
  const read = await readDraft(this.#cwd)
  if (read.kind !== 'ok') return
  await this.#serialize(async () => {
    if (!this.#state.ok) { this.#pendingDraft = read.draft; return }
    this.#applyDraft(read.draft)
  })
}

/** 로드가 성공한 순간 밀린 드래프트를 얹는다. 이미 `#serialize` 안이다. */
#tryAdoptPending(): void {
  const draft = this.#pendingDraft
  if (draft === null) return
  this.#pendingDraft = null
  this.#applyDraft(draft)
}

#applyDraft(draft: Draft): void {
  const { tree } = modelToFiles(draft.model)
  const layout = layoutFromModel(draft.model)
  this.#dirty = signatureOf(tree, layout) !== this.#base.signature
  if (!this.#dirty) {
    // 드래프트 내용이 파일과 같다 — 남겨 둘 이유가 없다. 삭제는 다음 flush 가 한다.
    this.#draftPending = true
    return
  }
  this.#state = { ok: true, model: draft.model, seq: Math.max(this.#state.seq, draft.seq) }
  // `serve` 가 꺼진 사이 파일이 바뀌었으면 사용자가 알아야 한다 — 조용히 얹으면 브랜치가 바뀐
  // 줄 모른 채 저장해 남의 변경을 덮는다.
  if (draft.baseSignature !== this.#base.signature) this.#external = true
}
```

마지막으로 **`isSelfWrite` getter 와 `#written`·`#selfWrite`·`#tree`·`#layout` 필드를 지우고**, `server.ts:164` 의 `if (store.isSelfWrite) return` 한 줄을 **삭제한다**(그 판정은 이제 `#commitLoad` 안에서 끝난다 — 자기 저장이면 `signature === #base.signature` 라 `#state` 가 바뀌지 않고, 따라서 `server.ts` 의 `modelChanged` 필터가 이미 거른다).

- [ ] **Step 4: 통과를 확인한다**

Run:
```bash
pnpm --filter @erdd/cli exec vitest run src/local/store.test.ts
pnpm --filter @erdd/cli exec vitest run src/local/server.test.ts
pnpm -r typecheck
```
Expected: store 는 전부 PASS(스킵 2건 포함). **`server.test.ts` 의 `'자기 쓰기는 SSE 로 알리지 않는다'` 는 이 시점에 의미가 바뀐다** — 편집이 더 이상 파일을 쓰지 않으므로 감시가 깨어나지도 않는다. 실패하면 **프로덕션을 고치지 말고** 그 테스트를 Task 5 로 미루도록 `.skip` 을 달고 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/store.ts packages/cli/src/local/store.test.ts packages/cli/src/local/server.ts
git commit -m "$(cat <<'MSG'
feat(cli): 디바운스의 쓰기 대상을 erdd/ 에서 드래프트로 옮긴다

편집 경로(mutate·setModel·#serialize·seq)는 그대로 두고 디바운스가 쓰는 대상만
.erdd/draft.json 으로 바꾼다. #written·#selfWrite 는 #base.signature 로 합쳐져
자기 쓰기 거르기와 외부 변경 감지를 함께 맡는다. load() 의 "다시 읽기 전 flush" 는
읽기가 미저장 편집을 건드릴 수 없게 되어 사라지지만, seq 가드는 그대로 남는다 —
#dirty 는 디바운스 뒤에야 갱신되므로 그것으로 대체할 수 없다.

신규 id 되쓰기가 tree 에 반영되도록 함께 고친다. 안 하면 그 쓰기가 깨운 감시가
자기 쓰기를 외부 변경으로 오인해 거짓 충돌 배너를 띄운다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`flush()` 안의 `writeDraft(...)` 를 옛 `writeTreeChanges(this.#cwd, this.#base.tree, tree)` 로 되돌린다 → `'편집과 flush 는 erdd/ 를 건드리지 않는다'` 가 **실패**해야 한다. 이어서 `#loadOnce` 의 `tree[rel] = content` 한 줄을 지운다 → Task 4 의 ⑪ 테스트가 아직 없으므로 **여기서는 실패하지 않는 것이 정상이다**(그 잠금은 Task 4 에 있다). 두 변경 모두 `git checkout -- packages/cli/src/local/store.ts` 로 되돌리고 `git status` clean 확인.

---

### Task 4: FileStore — 저장·버리기·유지

**Files:**
- Modify: `packages/cli/src/local/store.ts`
- Modify: `packages/cli/src/local/store.test.ts` (Task 3 에서 `.skip` 을 단 둘을 `save()` 로 되살린다)

**Interfaces:**
- Consumes: Task 3 의 `#base`·`#external`·`#dirty`·`flush()`
- Produces:
  - `save(): Promise<LocalSaveResult>` — `LocalSaveResult` 는 Task 1 의 것을 그대로 쓴다
  - `discard(): Promise<void>` — 드래프트 삭제 후 디스크 채택
  - `keep(): Promise<void>` — 디스크를 다시 읽어 `#base` 로 삼고 `#external` 을 내린다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('FileStore.save', () => {
  it('저장이 파일을 쓰고 드래프트를 지우고 dirty 를 내린다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    const r = await store.save()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.written).toContain('erdd/tables/MBR2.yaml')
    expect(r.deleted).toContain('erdd/tables/MBR.yaml')
    expect(store.dirty).toBe(false)
    expect(await hasDraft(cwd)).toBe(false)
  })

  it('쓸 것이 없으면 빈 목록으로 성공한다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    const r = await store.save()
    expect(r).toMatchObject({ ok: true, written: [], deleted: [] })
  })

  /**
   * 🔥 **안전 계약이다 — 저장은 사용자가 보지 못한 외부 변경을 절대 덮지 않는다.**
   * 감시(150ms 디바운스)가 늦어 배너가 아직 안 떴어도 저장 직전의 재읽기가 구조적으로 막는다.
   * 그래서 이 테스트는 **감시를 쓰지 않고** FileStore 만으로 그 창을 만든다.
   */
  it('저장 직전에 디스크를 다시 읽어, 밖에서 바뀌었으면 거절한다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    // 감시를 거치지 않고 파일만 바꾼다 — store 는 아직 모른다.
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR.replace('logicalName: 회원', 'logicalName: 멤버'), 'utf8')
    const body = await readFile(join(cwd, 'erdd/tables/MBR.yaml'), 'utf8')

    const r = await store.save()
    expect(r).toMatchObject({ ok: false, reason: 'external' })
    expect(store.external).toBe(true)
    // 파일이 그대로여야 한다 — 이것이 요점이다.
    expect(await readFile(join(cwd, 'erdd/tables/MBR.yaml'), 'utf8')).toBe(body)
    expect(await hasDraft(cwd)).toBe(true)
  })

  it('파일이 깨져 있으면 blocked 로 거절하고 드래프트를 남긴다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), ': : 깨진 YAML :', 'utf8')
    await store.load()

    expect(await store.save()).toMatchObject({ ok: false, reason: 'blocked' })
    expect(await hasDraft(cwd)).toBe(true)
  })

  /**
   * ⚠️ **사용자가 확정한 동작이다**(spec §13 ①, 2026-09-03). 「내 편집 유지」는 기준선을
   * 지금 디스크로 옮기므로, 이어지는 저장은 **화면이 곧 파일**이 된다 — 밖에서 추가된 파일도
   * 지워진다. 대안(옛 기준선 유지)은 「화면에 없는 테이블이 파일에 있는」 조용한 부분 병합이라
   * 「자동 병합 없음」과 어긋난다. 배너 문구가 이 대가를 말해야 한다.
   */
  it('keep 뒤의 저장은 화면이 곧 파일이 된다 — 밖에서 추가된 파일이 지워진다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    await writeFile(join(cwd, 'erdd/tables/NEW.yaml'), [
      'id: 018f6b0e-0000-7000-8000-0000000000ff',
      'name: NEW',
      'logicalName: 신규',
      'columns: []',
      '',
    ].join('\n'), 'utf8')
    expect(await store.save()).toMatchObject({ ok: false, reason: 'external' })

    await store.keep()
    expect(store.external).toBe(false)
    const r = await store.save()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.deleted).toContain('erdd/tables/NEW.yaml')
  })

  it('discard 는 드래프트를 버리고 디스크를 채택한다', async () => {
    const cwd = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(cwd)
    await store.load()
    await store.mutate([renameTable('MBR2')])
    await store.flush()

    await store.discard()
    expect(store.dirty).toBe(false)
    expect(store.external).toBe(false)
    expect(await hasDraft(cwd)).toBe(false)
    expect(store.state.model.tables[TABLE_ID]!.physicalName).toBe('MBR')
  })

  /**
   * spec §4.4 의 함정. id 없는 파일로 기동하면 되쓰기가 일어나는데, 그것이 #base 에 반영되지
   * 않으면 그 쓰기가 깨운 다음 로드가 「밖에서 바뀌었다」로 판정한다.
   */
  it('신규 id 되쓰기는 외부 변경으로 오인되지 않는다', async () => {
    const cwd = await project({
      'erdd/tables/MBR.yaml': ['name: MBR', 'logicalName: 회원', 'columns: []', ''].join('\n'),
    })
    const store = new FileStore(cwd)
    await store.load()
    expect(store.external).toBe(false)
    // 되쓰기 직후의 재로드(감시가 하는 일)에서도 external 이 서지 않아야 한다.
    await store.load()
    expect(store.external).toBe(false)
  })
})
```

그리고 Task 3 에서 `.skip` 을 단 두 테스트를 되살린다 — `store.flush()` 를 `await store.save()` 로 바꾸고 `.skip` 을 뗀다(`'바뀐 파일만 쓴다 — 손대지 않은 파일의 내용·mtime 이 그대로다'`, `'모델에서 사라진 테이블의 파일은 여전히 지운다'`).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/store.test.ts -t 'FileStore.save'`
Expected: FAIL — `store.save is not a function`

- [ ] **Step 3: 구현**

```ts
import { type LocalSaveResult } from '@erdd/core'

/**
 * 드래프트를 파일에 확정한다. **파일이 쓰이는 유일한 자리다**(신규 id 되쓰기 제외).
 *
 * 🔥 **②의 재읽기가 안전 계약이다.** 감시가 늦어 배너가 아직 안 떴어도, 저장 직전에 디스크를 다시
 * 읽어 `#base` 와 다르면 거절한다 — 사용자가 보지 못한 외부 변경을 구조적으로 덮지 않는다.
 *
 * 전부 `#serialize` 안에서 한다 — 재읽기와 쓰기 사이에 `mutate` 가 끼어들면 방금 잰 디스크와
 * 다른 모델을 쓰게 된다.
 */
async save(): Promise<LocalSaveResult> {
  return this.#serialize(async () => {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    if (!this.#state.ok) {
      return { ok: false, reason: 'blocked', message: '파일을 읽을 수 없어 저장이 잠겨 있습니다' }
    }
    if (this.#external) {
      return { ok: false, reason: 'external', message: '파일이 밖에서 바뀌었습니다 — 유지할지 다시 읽을지 고르세요' }
    }

    let disk: { tree: FileTree; layout: LayoutData }
    try {
      disk = { tree: await readTree(this.#cwd), layout: await readLayout(this.#cwd) }
    } catch (err) {
      return { ok: false, reason: 'blocked', message: (err as Error).message }
    }
    if (signatureOf(disk.tree, disk.layout) !== this.#base.signature) {
      this.#external = true
      return { ok: false, reason: 'external', message: '파일이 밖에서 바뀌었습니다 — 유지할지 다시 읽을지 고르세요' }
    }

    const { tree } = modelToFiles(this.#state.model)
    const layout = layoutFromModel(this.#state.model)
    // **바뀐 파일만** 쓴다 — 매번 전체를 다시 쓰면 손으로 다듬어 둔 YAML 포맷이 무관한 편집
    // 한 번에 전부 정규화된다(설계 §4). 삭제는 그대로 산다.
    const { written, deleted } = await writeTreeChanges(this.#cwd, this.#base.tree, tree)
    if (canonical(layout, LAYOUT_FILE) !== canonical(this.#base.layout, LAYOUT_FILE)) {
      const abs = join(this.#cwd, LAYOUT_FILE)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, stringifyYaml(layout), 'utf8')
      written.push(LAYOUT_FILE)
    }

    this.#base = { tree, layout, signature: signatureOf(tree, layout) }
    this.#draftPending = false
    this.#dirty = false
    await removeDraft(this.#cwd)
    return { ok: true, seq: this.#state.seq, written: written.sort(), deleted }
  })
}

/**
 * 미저장 편집을 버리고 디스크를 채택한다. 「파일 다시 읽기」의 자리다.
 *
 * 플래그를 먼저 내리고 `load()` 를 부르는 순서가 중요하다 — `#dirty` 가 참인 채로 부르면
 * `#commitLoad` 가 「미저장 있음」으로 보고 채택하지 않는다.
 */
async discard(): Promise<void> {
  await this.#serialize(async () => {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    this.#draftPending = false
    this.#dirty = false
    this.#external = false
    this.#pendingDraft = null
    await removeDraft(this.#cwd)
  })
  await this.load()
}

/**
 * 밖의 변경을 인정하되 **내 편집을 유지한다.** 기준선을 지금 디스크로 옮기므로, 이어지는 저장은
 * 화면이 곧 파일이 된다 — 밖에서 추가된 파일도 지워진다(계획서 채택 판단 ①, spec §13).
 *
 * `#external` 이 들고 있던 값을 쓰지 않고 **여기서 디스크를 다시 읽는다** — 그 사이 디스크가 또
 * 바뀌었을 수 있고, 그때 낡은 값을 기준선으로 승격시키면 다음 저장이 그 두 번째 변경을 말없이
 * 덮는다.
 */
async keep(): Promise<void> {
  return this.#serialize(async () => {
    let disk: { tree: FileTree; layout: LayoutData }
    try {
      disk = { tree: await readTree(this.#cwd), layout: await readLayout(this.#cwd) }
    } catch {
      // 디스크를 못 읽으면 인정할 것이 없다 — 다음 load() 가 blocked 로 알린다.
      return
    }
    this.#base = { tree: disk.tree, layout: disk.layout, signature: signatureOf(disk.tree, disk.layout) }
    this.#external = false
    // 기준선이 움직였으므로 「저장할 것이 남았는가」를 다시 계산해야 한다.
    this.#draftPending = true
  })
}
```

`readLayout` 은 모듈 안의 함수이므로 그대로 부를 수 있다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/store.test.ts && pnpm -r typecheck`
Expected: PASS — `.skip` 이 하나도 남지 않아야 한다

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/store.ts packages/cli/src/local/store.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): 저장·버리기·유지를 FileStore 에 더한다

save() 는 저장 직전에 디스크를 다시 읽어 기준선과 다르면 거절한다 — 감시가 늦어
배너가 아직 안 떴어도 사용자가 보지 못한 외부 변경을 구조적으로 덮지 않는다.
keep() 은 기준선을 지금 디스크로 옮겨 이어지는 저장이 화면 = 파일이 되게 한다
(계획서 채택 판단, spec 13절). #external 은 값을 들고 있지 않고 keep·discard 가
그 시점에 다시 읽어 두 번째 외부 변경에 스스로 교정된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

세 가지를 각각 되돌리고 되살린다.
1. `save()` 의 저장 직전 재읽기 블록(`if (signatureOf(disk...) !== this.#base.signature)`)을 지운다 → `'저장 직전에 디스크를 다시 읽어…'` 가 **실패**해야 한다.
2. `keep()` 의 `this.#base = {...}` 를 지운다 → `'keep 뒤의 저장은 화면이 곧 파일이 된다'` 가 **실패**해야 한다.
3. `#loadOnce` 의 `tree[rel] = content`(Task 3) 를 지운다 → `'신규 id 되쓰기는 외부 변경으로 오인되지 않는다'` 가 **실패**해야 한다.

각각 `git checkout -- packages/cli/src/local/store.ts` 로 되돌리고 마지막에 `git status` clean 확인.

---

### Task 5: 로컬 서버 — 라우트 3개와 SSE status

**Files:**
- Modify: `packages/cli/src/local/server.ts`
- Modify: `packages/cli/src/local/server.test.ts`

**Interfaces:**
- Consumes: Task 1 의 경로 상수·`LocalEvent`, Task 4 의 `store.save()`·`discard()`·`keep()`·`dirty`·`external`
- Produces: `POST /local/save` → `LocalSaveResult` (JSON) / `POST /local/discard`·`POST /local/keep` → `{ ok: true }` / SSE 에 `{ type:'status', dirty, external }` 추가

> ⚠️ **라우트 등록을 한 함수(`registerLocalRoutes`)에 모은다.** 다음 사이클의 `POST /local/apply`
> 가 여기 옆에 붙는다(spec §10.3). 흩어 놓으면 그때 세 자리를 찾아다녀야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, parseLocalEvent } from '@erdd/core'

/** POST 헬퍼 — 본문이 없다(드래프트는 서버가 들고 있다). */
async function post(url: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, { method: 'POST' })
  return { status: res.status, body: await res.json() }
}

describe('로컬 저장 라우트', () => {
  it('편집 뒤 저장하면 파일이 생기고, 저장 전에는 없다', async () => {
    const cwd = await project()
    const server = await start(cwd)
    const call = createLocalCaller(server.url)   // 아래 헬퍼

    await call.mutate([createTable()])
    await sleep(400)                              // 디바운스 통과
    // 저장 전 — erdd/tables 가 비어 있다.
    expect(await readdir(join(cwd, 'erdd/tables'))).toEqual([])

    const saved = await post(server.url, LOCAL_SAVE_PATH)
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ ok: true })
    expect(await readdir(join(cwd, 'erdd/tables'))).toEqual(['MBR.yaml'])
  })

  it('저장은 status 를 SSE 로 알린다 — 다른 탭의 표시가 함께 내려간다', async () => {
    const cwd = await project()
    const server = await start(cwd)
    const events = await openEvents(server.url)   // 아래 헬퍼
    const call = createLocalCaller(server.url)

    await call.mutate([createTable()])
    await sleep(400)
    await waitFor(() => events.last('status')?.dirty === true)

    await post(server.url, LOCAL_SAVE_PATH)
    await waitFor(() => events.last('status')?.dirty === false)
  })

  it('밖에서 파일이 바뀌면 external 이 서고, discard 가 그것을 푼다', async () => {
    const cwd = await project()
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')
    const server = await start(cwd)
    const call = createLocalCaller(server.url)

    await call.mutate([renameTableOp('MBR2')])
    await sleep(400)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE.replace('회원', '멤버'), 'utf8')
    await sleep(400)

    expect((await post(server.url, LOCAL_SAVE_PATH)).body).toMatchObject({ ok: false, reason: 'external' })
    expect((await post(server.url, LOCAL_DISCARD_PATH)).body).toMatchObject({ ok: true })
    expect((await post(server.url, LOCAL_SAVE_PATH)).body).toMatchObject({ ok: true })
  })

  it('keep 은 external 을 풀고 저장을 통과시킨다', async () => {
    const cwd = await project()
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')
    const server = await start(cwd)
    const call = createLocalCaller(server.url)

    await call.mutate([renameTableOp('MBR2')])
    await sleep(400)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE.replace('회원', '멤버'), 'utf8')
    await sleep(400)
    expect((await post(server.url, LOCAL_SAVE_PATH)).body).toMatchObject({ ok: false })

    await post(server.url, LOCAL_KEEP_PATH)
    expect((await post(server.url, LOCAL_SAVE_PATH)).body).toMatchObject({ ok: true })
  })

  /**
   * ⚠️ **POST 여야 한다.** GET 이면 공격자 페이지의 `<img src>` 한 줄로 저장이 불린다.
   * Host 검사는 라우트 전체에 걸리는 onRequest 훅이라 새 라우트도 자동으로 그 아래 들어온다.
   */
  it('낯선 Host 로는 저장에 닿지 않는다', async () => {
    const server = await start(await project())
    const res = await rawPost(`${server.url}${LOCAL_SAVE_PATH}`, 'evil.example.com')
    expect(res.status).toBe(403)
  })

  it('접속하자마자 현재 status 를 한 번 받는다', async () => {
    const cwd = await project()
    const server = await start(cwd)
    const call = createLocalCaller(server.url)
    await call.mutate([createTable()])
    await sleep(400)

    // 늦게 붙은 탭도 미저장 상태를 즉시 안다.
    const late = await openEvents(server.url)
    await waitFor(() => late.last('status')?.dirty === true)
  })
})
```

> ⚠️ `createLocalCaller`·`openEvents`·`rawPost`·`waitFor`·`renameTableOp`·`createTable` 은 **이
> 태스크가 만들 헬퍼**다. `server.test.ts` 에 이미 있는 `rawGet` 을 그대로 본떠 `rawPost` 를 만들고
> (`method: 'POST'`), `openEvents` 는 `fetch(url + LOCAL_EVENTS_PATH)` 의 스트림을 읽어
> `parseLocalEvent` 로 파싱한 것을 배열에 쌓고 `last(type)` 으로 마지막 것을 주는 얇은 객체로 만든다.
> `createLocalCaller` 는 tRPC HTTP 로 `model.mutate` 를 부르는 대신 **`fetch` 로 직접**
> `POST /trpc/model.mutate` 를 때리는 것이 간단하다 — 기존 `'tRPC 로 모델을 읽을 수 있다'` 테스트가
> 그 관용구를 이미 갖고 있으니 그것을 따른다. **op 페이로드는 `router.test.ts` 의 `createTable` 을
> 그대로 복사한다**(`entityId` 가 UUID 여야 `parseOps` 를 통과한다).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/server.test.ts -t '저장 라우트'`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 구현**

`server.ts` 에서 SSE 페이로드를 core 타입으로 바꾸고 라우트를 등록한다.

```ts
import {
  LOCAL_DISCARD_PATH, LOCAL_EVENTS_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, type LocalEvent,
} from '@erdd/core'

/** SSE 로 내보낼 페이로드. 정상이면 reload, 파일이 깨져 편집이 잠겼으면 blocked. */
const eventPayload = (state: StoreState): LocalEvent =>
  state.ok ? { type: 'reload' } : { type: 'blocked', failures: state.failures }

const statusPayload = (store: FileStore): LocalEvent =>
  ({ type: 'status', dirty: store.dirty, external: store.external })
```

`broadcast` 옆에 `send` 를 두고 status 전용 브로드캐스트를 더한다:

```ts
const send = (payload: LocalEvent) => {
  for (const c of clients) c.write(`data: ${JSON.stringify(payload)}\n\n`)
}
const broadcast = () => { send(eventPayload(store.state)) }
const broadcastStatus = () => { send(statusPayload(store)) }
```

SSE 접속 시 status 도 한 번 보낸다:

```ts
client.write(`data: ${JSON.stringify(eventPayload(store.state))}\n\n`)
// 늦게 붙은 탭도 미저장·충돌 상태를 즉시 안다(blocked 를 접속 시 보내는 것과 같은 이유).
client.write(`data: ${JSON.stringify(statusPayload(store))}\n\n`)
```

라우트를 한 함수에 모은다. **`app.register(fastifyTRPCPlugin, …)` 바로 뒤, SSE 등록 앞**에 놓는다:

```ts
/**
 * 로컬 전용 HTTP 라우트. tRPC 밖인 이유는 `local-protocol.ts` 의 주석과 같다 — 서버 라우터에 없는
 * 프로시저를 만들면 `router.test.ts` 의 `LocalOnly` 잠금이 깨지고, 웹은 `AppRouter` 타입으로
 * 클라이언트를 만들어 그 이름을 부를 수조차 없다.
 *
 * ⚠️ **전부 POST 다.** GET 이면 공격자 페이지의 `<img src>` 한 줄로 저장·버리기가 불린다.
 * Host 검사(onRequest 훅)는 라우트 전체에 걸리므로 여기도 자동으로 그 아래 들어온다.
 *
 * 다음 사이클의 `POST /local/apply`(에이전트의 op 주입)가 이 함수에 붙는다 — 흩어 놓지 마라.
 */
function registerLocalRoutes(
  app: FastifyInstance, store: FileStore, onChanged: () => void,
): void {
  app.post(LOCAL_SAVE_PATH, async () => {
    const result = await store.save()
    onChanged()
    return result
  })
  app.post(LOCAL_DISCARD_PATH, async () => {
    await store.discard()
    onChanged()
    return { ok: true as const }
  })
  app.post(LOCAL_KEEP_PATH, async () => {
    await store.keep()
    onChanged()
    return { ok: true as const }
  })
}
```

호출부:

```ts
registerLocalRoutes(app, store, () => {
  // 저장·버리기 뒤에는 dirty·external 이 달라졌다 — 다른 탭의 표시가 함께 맞춰져야 한다.
  broadcastStatus()
  // discard 는 모델을 디스크로 되돌렸다 — 브라우저가 다시 읽어야 한다.
  if (!store.dirty && !store.external) lastModelSignature = stateSignature(store.state)
})
```

⚠️ 위 `onChanged` 는 **`discard` 뒤에 `reload` 를 보내야 한다.** 저장 뒤에는 모델이 그대로라 보내면 안 된다(브라우저가 헛되이 다시 읽는다). 라우트별로 갈라 쓰는 편이 분명하다 — `registerLocalRoutes` 의 시그니처를 `{ onSaved, onReset }` 둘로 받게 하고, `onSaved` 는 `broadcastStatus()` 만, `onReset`(discard) 은 `broadcast(); broadcastStatus()` 를 하게 한다.

감시 콜백에서 자기 쓰기 필터(`if (store.isSelfWrite) return`)는 Task 3 에서 이미 지웠다. 그 자리에 status 브로드캐스트를 더한다:

```ts
if (!state.ok) { broadcast(); return }
if (configChanged) { broadcast(); return }
// 미저장 편집이 있는데 밖이 바뀌었으면 모델을 채택하지 않았다 — 배너를 띄우는 것은 status 다.
if (store.external) { broadcastStatus(); return }
if (modelChanged) broadcast()
```

기동 배선에 `adoptDraft` 를 더한다(`await store.load()` 바로 뒤):

```ts
await store.load()
await store.adoptDraft()
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/ && pnpm -r typecheck`
Expected: PASS — Task 3 에서 `.skip` 을 달았을 수 있는 `'자기 쓰기는 SSE 로 알리지 않는다'` 를 이 시점에 **되살린다**(편집이 파일을 안 쓰므로 「저장 뒤에 reload 가 나가지 않는다」로 의미를 바꿔 다시 쓴다).

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/server.ts packages/cli/src/local/server.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): 저장·버리기·유지 라우트와 SSE status 를 더한다

tRPC 프로시저를 늘리지 않고 /local/events 의 선례대로 로컬 전용 HTTP 로 낸다.
전부 POST 다 — GET 이면 공격자 페이지의 img 한 줄로 저장이 불린다. Host 검사는
onRequest 훅이라 새 라우트도 그 아래 자동으로 들어온다. 라우트 등록은 한 함수에
모았다(다음 사이클의 /local/apply 가 여기 붙는다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

접속 시 status 전송 한 줄을 지운다 → `'접속하자마자 현재 status 를 한 번 받는다'` 가 **실패**해야 한다. `git checkout -- packages/cli/src/local/server.ts` 로 되돌리고 clean 확인.

---

### Task 6: 스냅샷 새 포맷 — `erdd/snapshots/<id>.json.gz` + `index.yaml`

**Files:**
- Modify: `packages/cli/src/local/snapshots.ts` (전면 교체)
- Create: `packages/cli/src/local/snapshots.test.ts`
- Modify: `packages/cli/src/local/router.test.ts` — **손상 스냅샷을 만드는 헬퍼 `writeSnapshotsFile` 만** 새 포맷으로 바꾼다. ⚠️ **계약 잠금 3종과 프로시저 이름 목록은 건드리지 마라.**

**Interfaces:**
- Consumes: `ProjectModelSchema` (`@erdd/core`), `node:zlib`
- Produces:
  - `SNAPSHOTS_DIR = 'erdd/snapshots'` · `SNAPSHOTS_INDEX = 'erdd/snapshots/index.yaml'`
  - `type SnapshotRecord = { id, name, description, revisionSeq, model, createdAt }` (기존과 같은 모양)
  - `type SnapshotMeta = { id, name, description, revisionSeq, createdAt }`
  - `listSnapshots(cwd): Promise<SnapshotMeta[]>` — **디렉터리 스캔 ∩ 인덱스 라벨**
  - `readSnapshot(cwd, id): Promise<SnapshotRecord | null>` — 없으면 `null`, **손상이면 던진다**(`SnapshotCorruptError`)
  - `writeSnapshot(cwd, rec): Promise<void>` — `.gz` 먼저, 인덱스 나중
  - `deleteSnapshot(cwd, id): Promise<boolean>` — 없었으면 `false`
  - `class SnapshotCorruptError extends Error`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/src/local/snapshots.test.ts`:

```ts
import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import {
  SNAPSHOTS_DIR, SnapshotCorruptError,
  deleteSnapshot, listSnapshots, readSnapshot, writeSnapshot, type SnapshotRecord,
} from './snapshots.js'

const dir = () => mkdtemp(join(tmpdir(), 'erdd-snap-'))
const ID_A = '018f6b0e-1111-7000-8000-000000000001'
const ID_B = '018f6b12-2222-7000-8000-000000000002'

const rec = (id: string, name: string): SnapshotRecord => ({
  id, name, description: '설명', revisionSeq: 42,
  model: createEmptyModel(), createdAt: '2026-09-03T05:25:30.000Z',
})

async function writeRawGz(cwd: string, id: string, body: string): Promise<void> {
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
  await writeFile(join(cwd, SNAPSHOTS_DIR, `${id}.json.gz`), gzipSync(Buffer.from(body, 'utf8')))
}

describe('snapshots', () => {
  it('쓰고 읽으면 그대로 돌아온다 — 파일 하나당 스냅샷 하나', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect(await readdir(join(cwd, SNAPSHOTS_DIR))).toEqual([`${ID_A}.json.gz`, 'index.yaml'].sort())
    const got = await readSnapshot(cwd, ID_A)
    expect(got).toMatchObject({ id: ID_A, name: '1차', revisionSeq: 42 })
    expect(got!.model).toEqual(createEmptyModel())
  })

  it('스냅샷을 더해도 기존 파일은 다시 쓰이지 않는다 — git 이 blob 을 재사용한다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    const { mtimeMs } = await stat(join(cwd, SNAPSHOTS_DIR, `${ID_A}.json.gz`))
    await writeSnapshot(cwd, rec(ID_B, '2차'))
    expect((await stat(join(cwd, SNAPSHOTS_DIR, `${ID_A}.json.gz`))).mtimeMs).toBe(mtimeMs)
  })

  it('목록은 uuidv7 순서라 시간순이다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_B, '2차'))
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect((await listSnapshots(cwd)).map((s) => s.name)).toEqual(['1차', '2차'])
  })

  /**
   * ⚠️ **디렉터리가 진실이고 인덱스는 라벨이다.** 어느 방향으로도 조용히 사라지지 않아야 한다 —
   * 라벨을 잃은 스냅샷도 복원·삭제할 수 있고, 파일 없는 인덱스 항목이 「있다」고 거짓말하지 않는다.
   */
  it('인덱스에 없는 파일도 목록에 뜬다(라벨만 없다)', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    await writeRawGz(cwd, ID_B, JSON.stringify(rec(ID_B, '인덱스에 없음')))
    const list = await listSnapshots(cwd)
    expect(list.map((s) => s.id)).toEqual([ID_A, ID_B])
    expect(list[1]!.name).toContain('018f6b12')       // 이름 없음 + id 앞 8자
    // 라벨이 없어도 복원·삭제는 된다.
    expect(await readSnapshot(cwd, ID_B)).toMatchObject({ id: ID_B })
    expect(await deleteSnapshot(cwd, ID_B)).toBe(true)
  })

  it('파일 없는 인덱스 항목은 목록에 뜨지 않는다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
    await writeFile(join(cwd, 'erdd/snapshots/index.yaml'), [
      'snapshots:',
      `  - id: ${ID_A}`,
      '    name: 1차',
      '    description: 설명',
      '    revisionSeq: 42',
      '    createdAt: 2026-09-03T05:25:30.000Z',
      `  - id: ${ID_B}`,
      '    name: 사라진 것',
      '    description: ""',
      '    revisionSeq: 1',
      '    createdAt: 2026-09-03T05:25:30.000Z',
      '',
    ].join('\n'), 'utf8')
    expect((await listSnapshots(cwd)).map((s) => s.id)).toEqual([ID_A])
    expect(await readSnapshot(cwd, ID_B)).toBeNull()
  })

  /**
   * 🔥 **`snapshots.ts` 의 기존 방어를 새 포맷으로 이식한 것이다.** 반쪽짜리 `model` 을 그대로
   * 복원하면 「유효한 빈 모델」이 되어 무결성 검사를 통과하고, 그 뒤 저장이 `erdd/` 를 통째로
   * 비운다. `.gz` 는 사람 눈에 내용이 안 보여 손상을 더 늦게 안다.
   *
   * ⚠️ 「없다」가 아니라 「깨졌다」로 알린다 — NOT_FOUND 로 뭉개면 사용자는 파일이 보이는데
   * 없다는 말을 듣고 무엇을 고쳐야 하는지 알 수 없다.
   */
  const BROKEN: [name: string, body: string][] = [
    ['model 키가 없다', JSON.stringify({ id: ID_B, name: 'x', description: '', revisionSeq: 0, createdAt: 'x' })],
    ['model 이 빈 객체다', JSON.stringify({ id: ID_B, model: {} })],
    ['필수 컬렉션이 모자란다', JSON.stringify({ id: ID_B, model: { tables: {}, columns: {} } })],
    ['JSON 이 아니다', 'not json'],
  ]
  for (const [label, body] of BROKEN) {
    it(`손상 스냅샷은 깨졌다고 던진다 — ${label}`, async () => {
      const cwd = await dir()
      await writeRawGz(cwd, ID_B, body)
      await expect(readSnapshot(cwd, ID_B)).rejects.toThrow(SnapshotCorruptError)
    })
  }

  it('gzip 이 아닌 파일도 깨진 것으로 본다', async () => {
    const cwd = await dir()
    await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
    await writeFile(join(cwd, SNAPSHOTS_DIR, `${ID_B}.json.gz`), 'plain text', 'utf8')
    await expect(readSnapshot(cwd, ID_B)).rejects.toThrow(SnapshotCorruptError)
  })

  /** 손상 판정이 정상 경로를 막지 않는다는 증거. 없으면 「빈 모델 전부 거절」로 조여도 초록이다. */
  it('정당하게 비어 있는 스냅샷은 그대로 읽힌다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '빈 상태'))
    expect((await readSnapshot(cwd, ID_A))!.model).toEqual(createEmptyModel())
  })

  it('옛 모양(누락 컬렉션)은 보충해서 읽는다', async () => {
    const cwd = await dir()
    await writeRawGz(cwd, ID_B, JSON.stringify({
      ...rec(ID_B, '옛 것'),
      model: { tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {}, domains: {} },
    }))
    const got = await readSnapshot(cwd, ID_B)
    expect(got!.model.words).toEqual({})
    expect(got!.model.terms).toEqual({})
    expect(got!.model.customFields).toEqual({})
  })

  it('삭제는 파일과 인덱스를 함께 지우고, 없던 것은 false 다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect(await deleteSnapshot(cwd, ID_A)).toBe(true)
    expect(await listSnapshots(cwd)).toEqual([])
    expect(await deleteSnapshot(cwd, ID_A)).toBe(false)
  })

  it('스냅샷이 하나도 없으면 빈 목록이다', async () => {
    expect(await listSnapshots(await dir())).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/snapshots.test.ts`
Expected: FAIL — `SNAPSHOTS_DIR` 등이 export 되지 않는다

- [ ] **Step 3: 구현**

`snapshots.ts` 를 갈아엎는다. 핵심만:

```ts
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ProjectModelSchema, type ProjectModel } from '@erdd/core'

/**
 * 스냅샷은 **커밋 대상**이다(`erdd/` 아래). 하나당 파일 하나라 새 스냅샷이 새 blob 하나만 더하고
 * 기존 blob 을 재사용한다 — 단일 파일이면 만들 때마다 전체가 새 blob 이 된다.
 *
 * ⚠️ **`readTree`/`writeTree` 는 이 디렉터리를 보지 않는다** — `TOP_LEVEL_FILES`(5개)와
 * `erdd/tables/*.yaml` 만 훑기 때문이다. 그래서 모델 파싱에 섞이지 않고 `erdd pull` 이 지우지도
 * 않는다. 다만 `watchProject` 는 `erdd/` 를 재귀 감시하므로 스냅샷을 쓸 때마다 감시가 깨어난다 —
 * 읽어 봐야 `readTree` 결과가 그대로라 아무것도 브로드캐스트되지 않는다(무해).
 */
export const SNAPSHOTS_DIR = 'erdd/snapshots'
export const SNAPSHOTS_INDEX = `${SNAPSHOTS_DIR}/index.yaml`

export class SnapshotCorruptError extends Error {}

export type SnapshotRecord = {
  id: string; name: string; description: string
  revisionSeq: number; model: ProjectModel; createdAt: string
}
export type SnapshotMeta = Omit<SnapshotRecord, 'model'>

/**
 * 파일명은 **id 뿐이다.** 스냅샷 이름을 넣지 않는 이유 둘:
 * (a) `unsafeFileName`(core)이 이미 푼 문제 — 경로 구분자·`.`·`..`·빈 문자열 — 를 다시 만난다.
 * (b) 이 프로젝트의 스냅샷 이름은 **한국어**가 정상인데 macOS 는 파일명을 NFD 로, git 인덱스는
 *     NFC 로 들고 있어 같은 파일이 플랫폼마다 다른 이름으로 보인다.
 * uuidv7 은 앞 48비트가 밀리초 타임스탬프라 **사전순 = 시간순**이므로 시각 접두도 필요 없다.
 */
const fileOf = (id: string) => join(SNAPSHOTS_DIR, `${id}.json.gz`)
const ID_RE = /^([0-9a-f-]{36})\.json\.gz$/

/** 디렉터리에 실제로 있는 스냅샷 id. **이것이 진실이다.** */
async function idsOnDisk(cwd: string): Promise<string[]> {
  let names: string[] = []
  try {
    names = await readdir(join(cwd, SNAPSHOTS_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return names.map((n) => ID_RE.exec(n)?.[1]).filter((v): v is string => v !== undefined).sort()
}

/** 인덱스의 라벨. 깨져 있으면 **빈 라벨로 본다** — 목록이 통째로 죽는 것보다 낫다. */
async function readIndex(cwd: string): Promise<Map<string, SnapshotMeta>> { /* parseYaml + 항목 단위 관대 필터 */ }

async function writeIndex(cwd: string, metas: SnapshotMeta[]): Promise<void> {
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
  await writeFile(join(cwd, SNAPSHOTS_INDEX), stringifyYaml({ snapshots: metas }), 'utf8')
}

/** **디렉터리 스캔 ∩ 인덱스 라벨.** 라벨이 없으면 id 로 표시한다 — 보이지 않는 스냅샷은 없다. */
export async function listSnapshots(cwd: string): Promise<SnapshotMeta[]> {
  const ids = await idsOnDisk(cwd)
  const labels = await readIndex(cwd)
  return ids.map((id) => labels.get(id) ?? {
    id, name: `(이름 없음) ${id.slice(0, 8)}`, description: '', revisionSeq: 0, createdAt: '',
  })
}

export async function readSnapshot(cwd: string, id: string): Promise<SnapshotRecord | null> {
  let raw: Buffer
  try {
    raw = await readFile(join(cwd, fileOf(id)))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(gunzipSync(raw).toString('utf8'))
  } catch (err) {
    throw new SnapshotCorruptError((err as Error).message)
  }
  const rec = parsed as Partial<SnapshotRecord>
  // ⚠️ 기존 방어를 그대로 옮긴다 — 손으로 만든 모양 검사로는 `{}` 가 통과해 「유효한 빈 모델」이
  // 되고, 그것이 복원 뒤 저장에서 사용자의 erdd/ 를 통째로 비운다. 반환은 **파싱 결과**여야
  // 한다(누락 컬렉션 보충이 파싱 안에서 일어난다).
  const model = ProjectModelSchema.safeParse(rec.model)
  if (!model.success) throw new SnapshotCorruptError('모델이 온전하지 않습니다')
  return {
    id, name: rec.name ?? '', description: rec.description ?? '',
    revisionSeq: rec.revisionSeq ?? 0, createdAt: rec.createdAt ?? '', model: model.data,
  }
}

/**
 * **`.gz` 를 먼저 쓰고 인덱스를 나중에 쓴다.** 중간에 죽으면 「라벨 없는 복원 가능한 스냅샷」이
 * 남는다 — 반대 순서면 「가리키는 파일이 없는 항목」이 남는다.
 *
 * 같은 내용이면 같은 바이트다(Node 는 gzip 헤더의 mtime 을 0 으로 쓴다). 다만 OS 바이트는
 * 플랫폼차가 있으므로 「다른 머신에서 재생성하면 같은 blob」에 기대지 않는다 — 스냅샷은 한 번 쓰고
 * 다시 쓰지 않는 파일이라 기댈 자리도 없다.
 */
export async function writeSnapshot(cwd: string, rec: SnapshotRecord): Promise<void> {
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
  await writeFile(join(cwd, fileOf(rec.id)), gzipSync(Buffer.from(JSON.stringify(rec), 'utf8')))
  const { model: _model, ...meta } = rec
  await writeIndex(cwd, [...(await listSnapshots(cwd)).filter((m) => m.id !== rec.id), meta]
    .sort((a, b) => (a.id < b.id ? -1 : 1)))
}

export async function deleteSnapshot(cwd: string, id: string): Promise<boolean> {
  try {
    await rm(join(cwd, fileOf(id)))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
  await writeIndex(cwd, await listSnapshots(cwd))
  return true
}
```

기존 `updateSnapshots` 의 **직렬화 체인은 유지한다** — 읽기-수정-쓰기가 겹치면 스냅샷 하나가 조용히 사라지고, 탭 둘이나 빠른 연속 클릭으로 충분히 만들어진다. `writeSnapshot`·`deleteSnapshot` 을 그 체인에 태운다.

`router.ts` 의 소비부를 새 API 로 갈아끼운다:
- `snapshot.create` → `writeSnapshot(ctx.cwd, toRecord(...))`
- `snapshot.list` → `listSnapshots(ctx.cwd)` (`createdAt` 은 `new Date(...)`)
- `snapshot.get`·`restore` → `readSnapshot` + `null` → `NOT_FOUND`, `SnapshotCorruptError` → `BAD_REQUEST('스냅샷이 손상됐습니다')`
- `snapshot.delete` → `deleteSnapshot` 이 `false` → `NOT_FOUND`

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/ && pnpm -r typecheck`
Expected: PASS. **`router.test.ts` 의 계약 3종과 프로시저 이름 목록이 그대로 초록**이어야 한다 — 빨개지면 멈추고 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/snapshots.ts packages/cli/src/local/snapshots.test.ts packages/cli/src/local/router.ts packages/cli/src/local/router.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): 스냅샷을 erdd/snapshots/<id>.json.gz 로 옮긴다

하나당 파일 하나라 새 스냅샷이 새 blob 하나만 더한다. 파일명은 id 뿐이다 —
이름을 넣으면 unsafeFileName 이 푼 문제를 다시 만나고, 한국어 이름은 macOS NFD 와
git NFC 가 갈려 플랫폼마다 다른 파일로 보인다. uuidv7 이라 사전순이 곧 시간순이다.
목록 라벨은 평문 index.yaml 이 들고 디렉터리가 진실이다 — 인덱스 없는 파일도
목록에 뜨고 파일 없는 항목은 안 뜬다. ProjectModelSchema 방어를 그대로 이식했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`readSnapshot` 의 `ProjectModelSchema.safeParse` 를 `rec.model !== undefined` 로 되돌린다 → 손상 테스트 2건이 **실패**해야 한다. 이어 `listSnapshots` 를 `readIndex` 만 보도록 바꾼다 → `'인덱스에 없는 파일도 목록에 뜬다'` 가 **실패**해야 한다. 되돌리고 clean 확인.

---

### Task 7: 옛 스냅샷 이행 + 미저장 상태에서 스냅샷 금지

**Files:**
- Create: `packages/cli/src/local/snapshot-migrate.ts`
- Create: `packages/cli/src/local/snapshot-migrate.test.ts`
- Modify: `packages/cli/src/local/server.ts` (기동 시 이행 1회)
- Modify: `packages/cli/src/local/router.ts` (`snapshot.create` 의 dirty 거절)
- Modify: `packages/cli/src/local/router.test.ts` (dirty 거절 테스트 추가 — **계약 3종은 건드리지 않는다**)

**Interfaces:**
- Consumes: Task 6 의 `writeSnapshot`·`readSnapshot`, Task 4 의 `store.dirty`
- Produces: `migrateSnapshots(cwd: string): Promise<{ moved: string[]; skipped: { id: string; name: string }[] } | null>` — 옛 파일이 없으면 `null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('migrateSnapshots', () => {
  it('옛 파일이 없으면 null 이다', async () => {
    expect(await migrateSnapshots(await dir())).toBeNull()
  })

  it('정상 레코드를 새 포맷으로 옮기고 옛 파일을 .migrated 로 남긴다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [rec(ID_A, '1차'), rec(ID_B, '2차')])

    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([ID_A, ID_B])
    expect((await listSnapshots(cwd)).map((s) => s.name)).toEqual(['1차', '2차'])
    // ⚠️ 지우지 않는다 — gitignore 된 파일이라 남겨도 저장소가 더러워지지 않고,
    //    이행이 잘못됐을 때 되돌릴 유일한 근거다.
    expect(await hasFile(cwd, '.erdd/snapshots.json.migrated')).toBe(true)
    expect(await hasFile(cwd, '.erdd/snapshots.json')).toBe(false)
  })

  /**
   * 🔥 **손상 레코드를 옮기지 않는 것이 요점이다.** 옮기면 손상이 **커밋 대상**으로 승격되고
   * 그때부터 팀 전체가 그 파일을 본다. 남겨서 알린다.
   */
  it('손상 레코드는 옮기지 않고 이름을 돌려준다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [rec(ID_A, '정상'), { id: ID_B, name: '깨진 것', description: '', revisionSeq: 0, createdAt: '', model: {} } as never])

    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([ID_A])
    expect(r!.skipped).toEqual([{ id: ID_B, name: '깨진 것' }])
    expect((await listSnapshots(cwd)).map((s) => s.id)).toEqual([ID_A])
  })

  it('두 번 돌려도 멱등이다 — 이미 있는 id 는 건너뛴다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [rec(ID_A, '1차')])
    await migrateSnapshots(cwd)
    // 옛 파일을 되살려 다시 돌린다(사용자가 .migrated 를 되돌린 경우).
    await rename(join(cwd, '.erdd/snapshots.json.migrated'), join(cwd, '.erdd/snapshots.json'))
    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([])
    expect((await listSnapshots(cwd)).length).toBe(1)
  })
})

describe('미저장 상태의 스냅샷', () => {
  it('드래프트가 있으면 snapshot.create 를 BAD_REQUEST 로 거절한다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)
    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })
    await c.store.flush()          // 드래프트가 생긴다

    await expect(call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '1차' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('저장한 뒤에는 스냅샷을 만들 수 있다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)
    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })
    await c.store.flush()
    expect((await c.store.save()).ok).toBe(true)

    const { id } = await call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '1차' })
    expect((await call.snapshot.get({ projectId: LOCAL_PROJECT_ID, snapshotId: id })).model.tables[T1]).toBeDefined()
  })
})
```

> ⚠️ `writeOld`·`hasFile`·`dir`·`rec` 은 이 태스크의 헬퍼다. `writeOld` 는
> `.erdd/snapshots.json` 에 `{ "snapshots": [...] }` 를 그대로 쓴다(옛 포맷).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/snapshot-migrate.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// packages/cli/src/local/snapshot-migrate.ts
import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectModelSchema } from '@erdd/core'
import { STATE_DIR } from '../config.js'
import { readSnapshot, writeSnapshot, type SnapshotRecord } from './snapshots.js'

const OLD_FILE = `${STATE_DIR}/snapshots.json`

/**
 * 옛 `.erdd/snapshots.json`(gitignore 되는 머신 로컬 단일 파일)을 `erdd/snapshots/`(커밋 대상)로
 * 한 번 옮긴다. **기동 시 자동·멱등**이다.
 *
 * 「둘 다 읽는 기간」을 두지 않는 이유: 옛 파일은 gitignore 된 머신 로컬 파일이라 그 기간이 사 줄
 * 것이 없고, `list` 합치기·id 충돌·삭제 대상 판정이라는 부채만 남는다.
 *
 * ⚠️ **손상 레코드는 옮기지 않는다.** 옮기면 손상이 커밋 대상으로 승격되고 팀 전체가 그것을 본다.
 * ⚠️ **옛 파일을 지우지 않고 `.migrated` 로 이름만 바꾼다** — 이행이 잘못됐을 때 되돌릴 유일한 근거다.
 */
export async function migrateSnapshots(
  cwd: string,
): Promise<{ moved: string[]; skipped: { id: string; name: string }[] } | null> {
  let raw: string
  try {
    raw = await readFile(join(cwd, OLD_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  let items: unknown = []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) items = (parsed as { snapshots?: unknown }).snapshots
  } catch { items = [] }
  const records = Array.isArray(items) ? (items as SnapshotRecord[]) : []

  const moved: string[] = []
  const skipped: { id: string; name: string }[] = []
  for (const rec of records) {
    if (typeof rec?.id !== 'string' || rec.id === '') continue
    // 멱등: 이미 새 포맷에 있으면 건너뛴다. readSnapshot 이 던지는 것(= 이미 있는데 손상)도
    // 「있다」로 본다 — 덮어써서 고칠 일이 아니다.
    try {
      if (await readSnapshot(cwd, rec.id) !== null) continue
    } catch { continue }
    if (!ProjectModelSchema.safeParse(rec.model).success) {
      skipped.push({ id: rec.id, name: typeof rec.name === 'string' ? rec.name : '' })
      continue
    }
    await writeSnapshot(cwd, rec)
    moved.push(rec.id)
  }

  await rename(join(cwd, OLD_FILE), join(cwd, `${OLD_FILE}.migrated`))
  return { moved, skipped }
}
```

`server.ts` 기동 배선(`await store.load()` **앞**에 둔다 — 이행이 `erdd/snapshots/` 에 파일을 만들고, 그것은 `readTree` 가 보지 않으므로 순서가 모델에 영향을 주지 않지만, 먼저 끝내야 첫 감시 이벤트가 조용하다):

```ts
const migrated = await migrateSnapshots(cwd)
if (migrated !== null) {
  note(`스냅샷 ${migrated.moved.length}개를 ${SNAPSHOTS_DIR}/ 로 옮겼습니다 — 이제 커밋 대상입니다. git add ${SNAPSHOTS_DIR}`)
  for (const s of migrated.skipped) {
    note(`⚠️ 손상된 스냅샷을 옮기지 않았습니다: ${s.name || '(이름 없음)'} (${s.id})`)
  }
}
```

`router.ts` 의 `snapshot.create` 에 가드를 더한다:

```ts
create: scoped
  .input(/* 그대로 */)
  .mutation(async ({ ctx, input }) => {
    // 저장된 상태만 스냅샷 대상이다(설계 D4) — 미저장 편집으로 버전을 만들 수 없다.
    if (ctx.store.dirty) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 스냅샷을 만드세요',
      })
    }
    const rec = toRecord(ctx.store, input.name, input.description ?? '')
    await writeSnapshot(ctx.cwd, rec)
    return { id: rec.id }
  }),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/local/ && pnpm -r typecheck`
Expected: PASS, 계약 3종 그대로 초록

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/snapshot-migrate.ts packages/cli/src/local/snapshot-migrate.test.ts packages/cli/src/local/server.ts packages/cli/src/local/router.ts packages/cli/src/local/router.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): 옛 스냅샷을 기동 시 한 번 옮기고, 미저장 상태의 스냅샷을 막는다

이행은 자동·멱등이고 손상 레코드는 옮기지 않는다 — 옮기면 손상이 커밋 대상으로
승격돼 팀 전체가 그것을 본다. 옛 파일은 지우지 않고 .migrated 로 남긴다.
snapshot.create 는 드래프트가 있으면 거절한다(설계 D4).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`migrateSnapshots` 의 `ProjectModelSchema.safeParse` 가드를 지운다 → `'손상 레코드는 옮기지 않고'` 가 **실패**해야 한다. `router.ts` 의 `ctx.store.dirty` 가드를 지운다 → `'드래프트가 있으면 snapshot.create 를 BAD_REQUEST 로'` 가 **실패**해야 한다. 각각 되돌리고 clean 확인.

---

### Task 8: CLI 미저장 알림

**Files:**
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/validate.ts`
- Modify: `packages/cli/src/commands/push.ts` (한 줄 — 계획서 채택 판단 ②)
- Modify: `packages/cli/src/commands/serve.ts` (종료 note)
- Modify: `packages/cli/src/commands/commands.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `hasDraft`
- Produces: `UNSAVED_NOTICE` 상수 — 세 명령이 **같은 문구**를 쓴다

> ⚠️ **`main.ts` 를 고치지 않는다**(다른 트랙이 쥐고 있다). 새 플래그·새 명령이 없으므로 고칠 일도 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('미저장 편집 알림', () => {
  it('status 가 드래프트를 발견하면 알리고 --json 에 필드를 더한다', async () => {
    const cwd = await localProject()
    await writeDraft(cwd, someDraft())
    const out = await captureJson(() => status({ ...ctx(cwd), json: true }))
    expect(out.unsavedDraft).toBe(true)
  })

  it('status 는 드래프트가 없으면 알리지 않는다', async () => {
    const cwd = await localProject()
    const out = await captureJson(() => status({ ...ctx(cwd), json: true }))
    expect(out.unsavedDraft).toBe(false)
  })

  /**
   * ⚠️ **판정을 바꾸지 않는다**(설계 D3 — validate·push·export 는 파일만 본다).
   * 미저장 편집이 있어도 종료 코드는 파일 검사 결과 그대로다.
   */
  it('validate 의 종료 코드는 드래프트와 무관하다', async () => {
    const cwd = await localProject()             // 파일은 정상이다
    await writeDraft(cwd, someDraft())
    expect(await validate({ ...ctx(cwd), json: true })).toBe(0)
  })

  it('세 명령이 같은 문구를 쓴다', () => {
    expect(UNSAVED_NOTICE).toContain('저장하지 않은 편집')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/commands/commands.test.ts -t '미저장'`
Expected: FAIL — `unsavedDraft` 가 없다

- [ ] **Step 3: 구현**

`packages/cli/src/local/draft.ts` 에 문구를 둔다(드래프트를 아는 모듈이 여기다):

```ts
/** `status`·`validate`·`push` 가 **같은 문구**를 쓴다. 갈리면 사용자가 다른 일로 읽는다. */
export const UNSAVED_NOTICE =
  '⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다'
```

`status.ts` — `human` 배열과 `emit` 페이로드에 더한다:

```ts
const unsavedDraft = await hasDraft(ctx.cwd)
const human = [
  /* 기존 줄들 */,
  ...(unsavedDraft ? [UNSAVED_NOTICE] : []),
].join('\n')
emit(ctx.json, human, { /* 기존 필드 그대로 */, unsavedDraft })
```

`validate.ts` — 같은 방식으로 `human` 끝에 붙이고 `emit` 에 `unsavedDraft` 를 더한다. **`ok` 계산에는 넣지 않는다.**

`push.ts` — 계획 출력 앞에 한 줄만 더한다(판정·종료 코드에는 손대지 않는다). ⚠️ **이것은 작성자 판단 ②다**(spec §13 — 사용자 확정 아님). 리뷰에서 빠지면 이 줄과 그 테스트만 지우면 된다.

`serve.ts` — 종료 직전:

```ts
await new Promise<void>((resolve) => { /* 기존 */ })
// 미저장 편집은 드래프트에 남는다 — 다음 serve 가 이어받는다는 것을 알려야 사용자가 안심한다.
if (await hasDraft(ctx.cwd)) note('미저장 편집이 있습니다 — 다음 erdd serve 에서 이어집니다')
return 0
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/local/draft.ts packages/cli/src/commands/status.ts packages/cli/src/commands/validate.ts packages/cli/src/commands/push.ts packages/cli/src/commands/serve.ts packages/cli/src/commands/commands.test.ts
git commit -m "$(cat <<'MSG'
feat(cli): status·validate·push 가 미저장 편집을 알린다

세 명령이 같은 문구를 쓴다. 판정은 바꾸지 않는다 — validate·push·export 는
파일만 본다는 결정(D3) 그대로이고, 알림은 종료 코드에 들어가지 않는다.
serve 는 종료 시 드래프트가 남았음을 알린다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`validate.ts` 의 `ok` 계산에 `&& !unsavedDraft` 를 **일부러 넣어** 본다 → `'validate 의 종료 코드는 드래프트와 무관하다'` 가 **실패**해야 한다(그 테스트가 D3 을 지키는 자리라는 증거다). 되돌리고 clean 확인.

---

### Task 9: 웹 — 상태와 저장 훅

**Files:**
- Modify: `apps/web/src/editor/store.ts` (`localSave` 상태 + 액션 + `reset`)
- Modify: `apps/web/src/editor/use-local-watch.ts` (`parseLocalEvent` 사용 + `status` 처리)
- Modify: `apps/web/src/editor/use-local-watch.test.tsx`
- Create: `apps/web/src/editor/use-local-save.ts`
- Create: `apps/web/src/editor/use-local-save.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `parseLocalEvent`·`LOCAL_SAVE_PATH`·`LOCAL_DISCARD_PATH`·`LOCAL_KEEP_PATH`·`type LocalSaveResult`
- Produces:
  - store: `localSave: { dirty: boolean; external: boolean; saving: boolean }` / `setLocalSaveStatus({dirty, external})` / `setSaving(boolean)`
  - `useLocalSave(): { dirty, external, saving, save(), discard(), keep() }` — `save` 등은 `() => Promise<void>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`use-local-save.test.tsx`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useLocalSave } from './use-local-save.js'

function mockPost(result: unknown = { ok: true, seq: 1, written: [], deleted: [] }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return { ok: true, json: async () => result } as Response
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('useLocalSave', () => {
  it('save 는 POST /local/save 를 부른다', async () => {
    const calls = mockPost()
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    expect(calls).toEqual([`POST ${LOCAL_SAVE_PATH}`])
  })

  it('discard·keep 도 각자의 경로를 POST 한다', async () => {
    const calls = mockPost({ ok: true })
    const { result } = renderHook(() => useLocalSave())
    await result.current.discard()
    await result.current.keep()
    expect(calls).toEqual([`POST ${LOCAL_DISCARD_PATH}`, `POST ${LOCAL_KEEP_PATH}`])
  })

  /**
   * ⚠️ 저장을 가장 누르고 싶은 순간이 **편집 패널 입력란에 타이핑하던 중**이다.
   * `use-shortcuts.ts` 는 `isTypingTarget`/`isDialogOpen` 에서 먼저 물러나므로 거기 넣을 수 없다.
   */
  it('Cmd+S 는 입력란 안에서도 저장을 부르고 기본 동작을 막는다', async () => {
    const calls = mockPost()
    renderHook(() => useLocalSave())

    const input = document.createElement('input')
    document.body.appendChild(input)
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    await waitFor(() => { expect(calls).toEqual([`POST ${LOCAL_SAVE_PATH}`]) })
    input.remove()
  })

  it('Ctrl+S 도 같다', async () => {
    const calls = mockPost()
    renderHook(() => useLocalSave())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }))
    await waitFor(() => { expect(calls.length).toBe(1) })
  })

  it('언마운트하면 리스너를 뗀다 — 서버 모드에서 Cmd+S 가 가로채이지 않는다', async () => {
    const calls = mockPost()
    const { unmount } = renderHook(() => useLocalSave())
    unmount()
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(calls).toEqual([])
  })

  it('저장이 external 로 거절되면 상태에 남는다', async () => {
    mockPost({ ok: false, reason: 'external', message: '밖에서 바뀌었습니다' })
    const { result } = renderHook(() => useLocalSave())
    await result.current.save()
    await waitFor(() => { expect(useEditorStore.getState().localSave.external).toBe(true) })
  })
})
```

`use-local-watch.test.tsx` 에 더한다:

```ts
it('status 를 받아 store 에 반영한다', async () => {
  renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
  FakeEventSource.last!.emit({ type: 'status', dirty: true, external: false })
  await waitFor(() => {
    expect(useEditorStore.getState().localSave.dirty).toBe(true)
  })
})

/** 옛 웹이 새 이벤트를 만나도 죽지 않아야 한다 — parseLocalEvent 가 null 을 준다. */
it('모르는 이벤트는 조용히 무시한다', () => {
  renderHook(() => useLocalWatch(PROJECT_ID, true), { wrapper: wrapper() })
  expect(() => FakeEventSource.last!.emit({ type: '미래의것' })).not.toThrow()
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/use-local-save.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`store.ts` 에 상태를 더한다(`blocked` 옆):

```ts
/** 로컬 모드 저장 상태. **서버가 진실**이고 SSE status 로 받는다(use-local-watch). */
localSave: { dirty: boolean; external: boolean; saving: boolean }
setLocalSaveStatus: (s: { dirty: boolean; external: boolean }) => void
setSaving: (saving: boolean) => void
```

```ts
localSave: { dirty: false, external: false, saving: false },
setLocalSaveStatus: ({ dirty, external }) =>
  set((s) => ({ localSave: { ...s.localSave, dirty, external } })),
setSaving: (saving) => set((s) => ({ localSave: { ...s.localSave, saving } })),
```

`reset()` 의 초기화 객체에 `localSave: { dirty: false, external: false, saving: false }` 를 더한다.

`use-local-watch.ts` — 손으로 파싱하던 것을 `parseLocalEvent` 로 바꾸고 `status` 를 처리한다:

```ts
import { LOCAL_EVENTS_PATH, parseLocalEvent } from '@erdd/core'

const es = new EventSource(LOCAL_EVENTS_PATH)
let generation = 0
es.onmessage = (e) => {
  const payload = parseLocalEvent(e.data)
  if (payload === null) return          // 형식 오류이거나 모르는 type
  if (payload.type === 'status') {
    // 모델을 나르지 않는다 — 드래그 중에 와도 화면이 튀지 않는다.
    useEditorStore.getState().setLocalSaveStatus({ dirty: payload.dirty, external: payload.external })
    return
  }
  if (payload.type === 'blocked') { /* 기존 그대로 */ }
  /* reload 도 기존 그대로 */
}
```

`use-local-save.ts` 신규:

```ts
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import {
  LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, type LocalSaveResult,
} from '@erdd/core'
import { useEditorStore } from './store.js'

/**
 * 로컬 모드의 저장·버리기·유지와 `Cmd+S`.
 *
 * ⚠️ **`use-shortcuts.ts` 에 넣지 않는다.** 그 훅은 `isTypingTarget`/`isDialogOpen` 에서 먼저
 * 물러나는데, 저장을 가장 누르고 싶은 순간이 바로 편집 패널 입력란에 타이핑하던 중이다.
 * 그리고 그 훅은 `Canvas` 가 마운트된 동안만 산다.
 *
 * ⚠️ **로컬 모드에서만 마운트한다**(`project.tsx` 의 `isLocal` 가드). 서버 모드에서
 * 브라우저의 「페이지 저장」을 가로채면 안 되는데, 마운트 자체를 막으면 그것이 구조적으로 보장된다.
 */
export function useLocalSave() {
  const { dirty, external, saving } = useEditorStore((s) => s.localSave)

  const post = useCallback(async (path: string): Promise<LocalSaveResult | { ok: true }> => {
    const res = await fetch(path, { method: 'POST' })
    return (await res.json()) as LocalSaveResult | { ok: true }
  }, [])

  const save = useCallback(async () => {
    const store = useEditorStore.getState()
    if (store.localSave.saving) return
    store.setSaving(true)
    try {
      const r = await post(LOCAL_SAVE_PATH) as LocalSaveResult
      if (r.ok) {
        useEditorStore.getState().setLocalSaveStatus({ dirty: false, external: false })
        toast.success(r.written.length + r.deleted.length === 0 ? '저장할 변경이 없습니다' : '저장했습니다')
      } else {
        useEditorStore.getState().setLocalSaveStatus({
          dirty: true, external: r.reason === 'external',
        })
        toast.error(r.message)
      }
    } catch {
      toast.error('저장하지 못했습니다')
    } finally {
      useEditorStore.getState().setSaving(false)
    }
  }, [post])

  const discard = useCallback(async () => {
    try {
      await post(LOCAL_DISCARD_PATH)
      // 모델 되맞춤은 SSE reload 가 한다 — 여기서 직접 fetch 하면 규칙이 두 벌이 된다.
      useEditorStore.getState().setLocalSaveStatus({ dirty: false, external: false })
    } catch { toast.error('되돌리지 못했습니다') }
  }, [post])

  const keep = useCallback(async () => {
    try {
      await post(LOCAL_KEEP_PATH)
      useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    } catch { toast.error('처리하지 못했습니다') }
  }, [post])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      // 입력 중이든 다이얼로그가 열려 있든 막고 저장한다 — 브라우저의 「페이지 저장」이 뜨면 안 된다.
      e.preventDefault()
      void save()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [save])

  return { dirty, external, saving, save, discard, keep }
}
```

> ⚠️ **`beforeunload` 경고를 붙이지 마라.** 드래프트는 서버가 들고 있어 탭을 닫아도 잃는 것이
> 없다 — 경고를 띄우면 거짓말이다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/use-local-save.test.tsx src/editor/use-local-watch.test.tsx && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/store.ts apps/web/src/editor/use-local-watch.ts apps/web/src/editor/use-local-watch.test.tsx apps/web/src/editor/use-local-save.ts apps/web/src/editor/use-local-save.test.tsx
git commit -m "$(cat <<'MSG'
feat(web): 로컬 저장 상태와 use-local-save 훅을 더한다

dirty·external 은 서버가 진실이고 SSE status 로 받는다. Cmd+S 는 use-shortcuts 가
아니라 이 훅이 잡는다 — 그 훅은 입력 중·다이얼로그에서 먼저 물러나는데 저장을
가장 누르고 싶은 순간이 입력란 안이다. 로컬에서만 마운트되므로 서버 모드에서
브라우저의 페이지 저장을 가로채지 않는 것이 구조적으로 보장된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`onKeyDown` 의 `e.preventDefault()` 를 지운다 → `'Cmd+S 는 입력란 안에서도…'` 가 **실패**해야 한다. `use-local-watch.ts` 의 `status` 분기를 지운다 → `'status 를 받아 store 에 반영한다'` 가 **실패**해야 한다. 되돌리고 clean 확인.

---

### Task 10: 웹 — 헤더 컨트롤과 외부 변경 배너

**Files:**
- Create: `apps/web/src/editor/local-save-controls.tsx`
- Create: `apps/web/src/editor/local-save-controls.test.tsx`
- Modify: `apps/web/src/pages/project.tsx`

**Interfaces:**
- Consumes: Task 9 의 `useLocalSave`
- Produces: `<LocalSaveControls />`(헤더용) · `<LocalSaveBanner />`(배너용) — 둘 다 prop 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
describe('LocalSaveControls', () => {
  it('미저장이면 표시가 뜨고 저장 버튼이 활성이다', () => {
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    render(<LocalSaveControls />)
    expect(screen.getByText('미저장')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /저장/ })).toBeEnabled()
  })

  it('저장할 것이 없으면 저장 버튼이 비활성이다', () => {
    render(<LocalSaveControls />)
    expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled()
  })

  it('파일이 깨져 있으면 저장할 수 없다', () => {
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    useEditorStore.getState().setBlocked([{ path: 'erdd/', message: '깨졌다' }])
    render(<LocalSaveControls />)
    expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled()
  })

  /** 「버릴 시도」가 피드백의 동기다 — 버리는 수단이 없으면 드래프트가 재시작을 넘어 살아남는다. */
  it('변경 버리기는 확인을 한 번 받는다', async () => {
    const user = userEvent.setup()
    mockPost({ ok: true })
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    render(<LocalSaveControls />)
    await user.click(screen.getByRole('button', { name: /더 보기|⋯/ }))
    await user.click(screen.getByRole('menuitem', { name: /변경 버리기/ }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('LocalSaveBanner', () => {
  it('external 이 아니면 아무것도 그리지 않는다', () => {
    const { container } = render(<LocalSaveBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * ⚠️ **배너 문구가 대가를 말해야 한다**(spec §13 ①, 사용자 확정) — 「내 편집 유지」를 고르면
   * 저장할 때 화면의 내용이 파일을 덮어쓴다.
   */
  it('external 이면 두 선택지와 대가를 보여 준다', () => {
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
    render(<LocalSaveBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('덮어씁니다')
    expect(screen.getByRole('button', { name: '내 편집 유지' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '파일 다시 읽기' })).toBeInTheDocument()
  })

  it('파일 다시 읽기는 확인을 받는다 — 미저장 작업을 버리는 동작이다', async () => {
    const user = userEvent.setup()
    mockPost({ ok: true })
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
    render(<LocalSaveBanner />)
    await user.click(screen.getByRole('button', { name: '파일 다시 읽기' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })
})
```

`project.tsx` 의 배선을 잠근다 — `apps/web/src/pages/project.test.tsx` 가 없으면 만든다:

```tsx
it('서버 모드에는 저장 컨트롤이 없다', async () => {
  renderProject('server')
  await waitFor(() => { expect(screen.queryByRole('button', { name: /저장/ })).toBeNull() })
})

it('로컬 모드에는 저장 컨트롤이 있다', async () => {
  renderProject('local')
  expect(await screen.findByRole('button', { name: /저장/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/local-save-controls.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`local-save-controls.tsx` 는 기존 UI 관용구를 따른다 — `Button`(`@/components/ui/button`), `DropdownMenu`(header-tools 와 같은 것), 확인은 `AlertDialog`(`BulkDeleteDialog` 가 쓰는 것과 같은 컴포넌트). 저장 버튼은 `disabled={!dirty || saving || blocked !== null}`.

`project.tsx` 배선:

```tsx
{loaded && isLocal && <LocalSaveControls />}
{loaded && <HeaderTools projectId={projectId} />}
```

배너는 기존 `blocked` 배너 **아래**에 둔다(파일이 깨진 것이 더 급한 사실이다):

```tsx
{blocked !== null && (/* 기존 그대로 */)}
{isLocal && <LocalSaveBanner />}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/local-save-controls.tsx apps/web/src/editor/local-save-controls.test.tsx apps/web/src/pages/project.tsx apps/web/src/pages/project.test.tsx
git commit -m "$(cat <<'MSG'
feat(web): 로컬 모드 헤더에 저장 컨트롤과 외부 변경 배너를 더한다

저장 버튼·미저장 표시·변경 버리기(확인)와 「내 편집 유지 / 파일 다시 읽기」 배너.
가드는 렌더 자체다 — 서버 모드에서는 마운트되지 않는다. 배너 문구가 대가를
말한다: 내 편집을 유지하면 저장할 때 화면의 내용이 파일을 덮어쓴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)**

`project.tsx` 의 `isLocal &&` 가드를 지운다 → `'서버 모드에는 저장 컨트롤이 없다'` 가 **실패**해야 한다. 되돌리고 clean 확인.

---

### Task 11: 문서와 주석

**Files:** spec §10.1·§10.2 의 목록 그대로. **`docs/superpowers/HANDOFF.md` 는 건드리지 않는다.**

> ⚠️ **`feat/cli-ddl` 은 이미 `main` 에 병합됐다**(`2618fc6`). Global Constraints 의 「착수 전에
> `main` 을 얹어라」를 따랐다면 `cli-guide.md` 에 그 트랙이 만든 `export`·`import` 절이 이미 있다.
> **없다면 병합을 건너뛴 것이다** — 여기서 멈추고 `git merge main` 부터 한다. 안 그러면 이 태스크가
> 고친 문서를 병합 때 다시 손봐야 한다.

- [ ] **Step 1: 문서 — 로컬 모드 매뉴얼**

`docs/manual/local-guide.md`:
- 33행 표: 스냅샷을 `erdd/snapshots/`(**커밋한다**)로
- **3.3** 제목·본문: 「첫 편집이 `erdd/` 를 만든다」 → 「첫 **저장**이 `erdd/` 를 만든다」
- **3.4**: 종료 시 드래프트에 남고 다음 `serve` 가 이어받는다
- **4.4** 절 전체 교체: 「편집이 곧 파일이다」 → 「편집은 드래프트에, 저장이 파일에」. 화면→드래프트→(저장)→파일, `Cmd+S`, 미저장 표시, 변경 버리기
- **4.5**: 「다음 flush 가 `notes: []` 로 확정한다」 → 「다음 **저장**이」
- **4.6**: 미저장 표시가 탭 간에 공유된다는 한 줄
- **5.1** 트리: `erdd/snapshots/` 추가, `.erdd/snapshots.json` → `.erdd/draft.json`
- **5.2**: 커밋 대상에 스냅샷 포함
- **6절 전체**: 위치·`.gz`·`index.yaml`·이행·미저장 상태에서 못 만드는 것·복원이 드래프트가 되는 것
- **8절**: 「미저장인데 파일이 밖에서 바뀌었다」 항목 신설

- [ ] **Step 2: 문서 — CLI 매뉴얼·사용 매뉴얼**

`docs/manual/cli-guide.md`: 328행 · 379행 · 403행 트리 · 839행 「쓰는 파일」 · 855행 `Ctrl+C` · 1154행 부록 스모크 목록.
`docs/manual/user-guide.md`: 528행 각주.

- [ ] **Step 3: 문서 — 기획**

`docs/16-cli.md`: 76행 트리 · 148행 문단(첫 편집 → 첫 저장) · 153행 스냅샷 · **155행 「즉시 쓰기 + 파일 감시가 기본 동작이다」**(이 사이클이 정확히 이 문장을 없앤다) · 179행 단계별 범위.
`docs/02-architecture.md`: 69행 표(스냅샷 행) · 75행 · **128행**(「디바운스 뒤 파일로 쓰인다」).
`docs/90-roadmap.md`: 38행 부근에 완료 항목.

- [ ] **Step 4: 문서 — 에이전트 스킬과 README**

`packages/cli/skill/SKILL.md`: 37~39행 트리 · **56행**(「파일만 보고 파일에만 쓴다」) · 110~111행. 그리고 **에이전트용 주의 신설**:

> `erdd serve` 가 떠 있고 화면에 미저장 편집이 있으면, 내가 파일을 고치는 것이 **충돌 배너**를 띄운다. 사람이 「내 편집 유지 / 파일 다시 읽기」를 고를 때까지 내 수정은 화면에 반영되지 않는다.

`packages/cli/README.md`: 49·53·62행.

- [ ] **Step 5: 코드 주석**

spec §10.2 의 여섯 파일. Task 3~9 에서 고친 코드의 주석은 그 태스크에서 이미 고쳤어야 하므로, 여기서는 **남은 것을 훑어 확인**한다:
```bash
grep -rn "곧바로 파일\|즉시 쓰기\|편집이 곧 파일\|snapshots.json\|isSelfWrite\|디바운스 뒤 파일" \
  packages/cli/src packages/core/src apps/web/src | grep -v node_modules
```
나온 것이 전부 정당한지 하나씩 본다. **한 건도 남지 않아야 한다**(옛 파일을 가리키는 이행 코드의 `OLD_FILE` 은 예외).

- [ ] **Step 6: 전체 스위트 + 커밋**

```bash
pnpm -r typecheck && pnpm -C packages/core test && pnpm -C packages/cli test && pnpm -C apps/web test
git add docs packages/cli/skill/SKILL.md packages/cli/README.md
git commit -m "$(cat <<'MSG'
docs: 명시적 저장·스냅샷 이관에 맞춰 문서를 고친다

「편집이 곧 파일이다」를 서술하던 자리 전부와 .erdd/snapshots.json 을 가리키던
트리 그림 넷을 고친다. SKILL.md 에는 에이전트용 주의를 더한다 — serve 가 떠 있고
미저장 편집이 있으면 내 파일 수정이 충돌 배너를 띄운다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ZGq5DBCXRKF7S8ysd7NGF
MSG
)"
```

---

## 최종 게이트 (태스크 밖)

- [ ] **전체 스위트** — `pnpm -r typecheck && pnpm -C packages/core test && pnpm -C packages/cli test && pnpm -C apps/web test && pnpm -C apps/server test`
- [ ] **whole-branch 리뷰** — 프롬프트에 이 한 줄을 반드시 넣는다: **「이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라.」** 이번 사이클의 대상은 최소 셋이다 — `signatureOf`(자기 쓰기 판정 → 기준선 + 외부 변경 감지), `writeTreeChanges`(디바운스 flush → 저장), `readLayout`(load → save 의 재읽기).
- [ ] **계약 확인** — `git diff main -- packages/cli/src/local/router.test.ts` 에 **계약 3종과 프로시저 이름 목록의 변경이 없어야 한다.**
- [ ] **브라우저 스모크**(Playwright MCP, 워커에게 맡긴다 — 격리 포트 `PORT=3001 ERDD_SERVER_PORT=3001 ERDD_WEB_PORT=5174`):
  1. 테이블을 만들고 **파일이 생기지 않는 것**을 확인(`ls erdd/tables`)
  2. `Cmd+S` → 파일이 생기는 것
  3. 드래그 → 미저장 표시 → 저장 → `erdd/layout.yaml` 만 바뀌는 것
  4. 브라우저를 닫고 `Ctrl+C` 후 다시 `serve` → 미저장 편집이 살아 있는 것
  5. 터미널에서 파일을 고쳐 **충돌 배너** → 「내 편집 유지」 → 저장이 화면대로 되는 것
  6. 「파일 다시 읽기」로 미저장 편집이 버려지는 것
  7. 미저장 상태에서 스냅샷 버튼이 막히는 것, 저장 후 만들어지는 것
  8. 옛 `.erdd/snapshots.json` 을 심고 `serve` → `erdd/snapshots/*.json.gz` 로 옮겨지고 note 가 나오는 것
  - ⚠️ **대조군을 함께 돌려라** — 1번은 「원래 그랬던 것」과 구별되지 않으므로, `main` 체크아웃에서 같은 조작이 **파일을 만드는 것**을 함께 보여야 이번 변경의 효과다.
  - `.playwright-mcp/` 를 저장소에 남기지 않는다.

---

## 자기 리뷰 결과

**1. spec 커버리지** — §4 상태 모델→Task 2·3, §5.1 편집→Task 3, §5.2 저장→Task 4, §5.3 외부 변경→Task 4·5, §5.4 재시작→Task 3, §5.5 종료→Task 8, §5.6 새로고침·탭→Task 5·9, §5.7 스냅샷→Task 7, §5.8 config→**변경 없음(의도)**, §6 채널→Task 1·5, §7 스냅샷 포맷→Task 6·7, §8 CLI→Task 8, §9 UI→Task 9·10, §10 문서→Task 11, §12 테스트 ①~㉑→각 태스크의 Step 1. **빠진 요구 없음.**

**2. 플레이스홀더 스캔** — 코드 스텁을 남긴 곳이 하나 있다: Task 6 의 `readIndex` 는 본문을 `/* parseYaml + 항목 단위 관대 필터 */` 로 두었다. **구현자는 `store.ts` 의 `readLayout` 과 같은 규칙을 따른다** — 파일이 없으면 빈 Map, 파싱 실패면 빈 Map(목록이 통째로 죽는 것보다 낫다), 항목 단위로 `id`·`name`이 문자열인 것만 통과시킨다. 나머지 태스크에는 스텁이 없다.

**3. 타입 일관성** — `LocalSaveResult`(Task 1)를 Task 4 의 `save()` 반환·Task 5 의 라우트 응답·Task 9 의 `post()` 가 같은 이름으로 쓴다. `hasDraft`(Task 2)를 Task 8 의 세 명령이 쓴다. `SnapshotRecord`(Task 6)를 Task 7 의 이행이 쓴다. `store.dirty`/`store.external`(Task 3·4)을 Task 5 의 `statusPayload` 와 Task 7 의 라우터 가드가 쓴다. **어긋난 이름 없음.**

**남은 위험 둘(구현 중 확인할 것):**
- Task 3 의 `renameTable` op 모양 — `packages/core/src/op.ts` 의 `update` 스키마와 대조해야 한다. 어긋나면 **단언을 정정하고 보고**한다.
- Task 10 의 확인 다이얼로그 컴포넌트 이름 — `BulkDeleteDialog` 가 쓰는 것을 열어 확인하고 같은 것을 쓴다.
