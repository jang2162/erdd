# CLI push 멱등성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**설계:** [2026-08-05-cli-push-idempotency-design.md](../specs/2026-08-05-cli-push-idempotency-design.md)

**Goal:** `erdd push`가 서버에 커밋된 뒤 응답이 유실돼도 다음 push가 사본을 만들지 않게 한다 — 신규 엔티티 id를 전송 직전에 로컬 파일에 기록해 고정한다.

**Architecture:** `filesToModel`이 신규 id를 발급하는 자리(`idOf`)에서 그 id를 트리 복사본에 되써 넣어 "id를 채운 트리"(`assignedTree`)를 함께 낸다. CLI `push`는 `model.push`를 보내기 직전에 그 트리 중 **실제로 id가 늘어난 파일만** 원래 경로에 다시 쓰고 fsync한다. 다음 push는 `model.get`으로 서버 상태를 새로 읽으므로, 신규 id만 안정되면 세 가지 결말(커밋+응답유실 / 미커밋 / 커밋+syncDown실패)이 전부 수렴한다.

**Tech Stack:** TypeScript · vitest · `yaml` · `structuredClone`(전역) · pnpm 워크스페이스(`@erdd/core`, `@erdd/cli`)

## Global Constraints

- 응답·커밋 메시지·주석·문서는 **한국어**로 쓴다.
- **서버 변경 없음. 마이그레이션 없음. 새 op 엔티티 없음. 새 런타임 의존성 없음.** web·server 스위트는 무변경이어야 한다.
- `packages/core`는 **IO·런타임 의존성 free**를 유지한다. `structuredClone`은 전역 함수라 허용된다(2026-08-05 core `typecheck` EXIT=0으로 확인).
- **입력 `tree`는 절대 변형하지 않는다** — `assignedTree`는 복사본이다.
- **`reserveIds`는 `writeTree`를 쓰지 않는다.** 그 함수의 삭제·개명 패스가 돌면 설계 §2.2가 막으려는 사고(같은 테이블이 두 파일에 남음)가 그대로 일어난다.
- **기록은 사용자가 만든 원래 파일 경로에** 한다. `modelToFiles`가 내는 정규 경로에 쓰면 안 된다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
  ```
- `git add -A` 금지. 커밋할 경로를 명시한다.
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`는 자식 출력을 삼켜 오류가 있어도 0바이트 출력 + 종료코드 1이다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 것이 되어 또 오판한다.
  ```bash
  pnpm -r typecheck; echo "EXIT=$?"      # EXIT=0이어야 통과
  ```

## 구현자·리뷰어 공통 지시 (모든 태스크에 적용)

1. **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크 산출물도 고치지 마라 — 단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
2. **수정 건마다 그 수정이 구분력이 있는지 확인하라** — 프로덕션 변경을 되돌려 테스트가 실패하는지 보고 복구하라. **실패하지 않으면 덮지 말고 그렇다고 보고하라.**

## 기준선

```
core 453 · cli 114 · web 382 · server 143 · typecheck EXIT=0
```
(2026-08-05 실측, `set -a && . ./.env && set +a && pnpm verify` exit 0)

**이 계획의 목표치: core 459 (+6) · cli 126 (+12) · web 382 · server 143.**
설계 §7의 예상치는 cli +11이었다. 계획을 쓰며 `push.test.ts`의 문구 검증을 별도 테스트로 분리해 12가 됐다. 최종 수는 구현 후 실측으로 확정한다.

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/core/src/file-format.ts` | `idOf`가 발급 id를 복사본에 되써 넣고 `assignedTree`로 낸다 | 1 |
| `packages/core/src/file-format.test.ts` | 완전성(자리 누락 자동 감시)·불변성 | 1 |
| `packages/cli/src/tree.ts` | `canonical` export (이미 `diffTrees`가 쓰는 비교) | 2 |
| `packages/cli/src/commands/reserve-ids.ts` | **신규** — 변경된 파일만 원래 경로에 쓰고 fsync | 2 |
| `packages/cli/src/commands/reserve-ids.test.ts` | **신규** — 선별·no-op | 2 |
| `packages/cli/src/plan.ts` | `PushPlan`에 `localTree`·`assignedTree` 실어 나름 (쓰지는 않음) | 3 |
| `packages/cli/src/commands/push.ts` | `confirmDeletes` 뒤·전송 앞에 `reserveIds` 호출, 문구·봉투 | 3 |
| `packages/cli/src/commands/push.test.ts` | 핵심 회귀 + 경계 | 3 |
| `docs/superpowers/HANDOFF.md` | 이월 정정·기준선 갱신 | 4 |
| `docs/superpowers/specs/2026-08-04-cli-push-design.md` | §9 해당 항목에 해소 표시 | 4 |

---

## Task 1: core — `filesToModel`이 id를 채운 트리를 함께 낸다

**Files:**
- Modify: `packages/core/src/file-format.ts` (`FilesToModelResult` 207-209행, `filesToModel` 247행~, `idOf` 261행~, 반환 457-458행)
- Test: `packages/core/src/file-format.test.ts` (파일 끝에 새 `describe` 추가)

**Interfaces:**
- Consumes: 기존 `FilesToModelOptions.newId?: () => string`, `FileTree = Record<string, unknown>`, `NEW_ID_PREFIX = 'new:'`, `isNewId(id)` (전부 `@erdd/core`에서 export 중)
- Produces: `FilesToModelResult`의 성공 갈래에 `assignedTree?: FileTree`. Task 3의 `plan.ts`가 `localResult.assignedTree`로 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/file-format.test.ts` 맨 끝에 추가한다. 파일 상단 import에 `type FileTree`가 없으면 `@erdd/core`가 아니라 **같은 패키지 내부 경로**(`./file-format.js`)에서 가져온다 — 이 테스트 파일은 이미 `./file-format.js`에서 import하고 있다.

```ts
/**
 * 9종 전부에 id가 빠진 항목이 있는 트리. groups·domains·words·terms·customFields·
 * table·columns·indexes·relations 각각이 idOf를 지나므로, 한 자리라도 되쓰기를
 * 빠뜨리면 아래 완전성 테스트가 잡는다.
 */
function treeWithNewEverywhere(): FileTree {
  return {
    'erdd/groups.yaml': { groups: [{ name: '회원관리', color: '#eef' }] },
    'erdd/domains.yaml': { domains: [{ name: '명칭', logicalType: 'VARCHAR(100)', dialectTypes: {} }] },
    'erdd/words.yaml': { words: [{ logicalName: '회원', abbreviation: 'MBR' }] },
    'erdd/terms.yaml': { terms: [{ logicalName: '회원번호', physicalName: 'MBR_NO' }] },
    'erdd/custom-fields.yaml': { customFields: [{ name: 'cf1', target: 'table', type: 'text' }] },
    'erdd/tables/MBR.yaml': {
      name: 'MBR', logicalName: '회원', group: '회원관리',
      columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, nullable: false, domain: '명칭' }],
      indexes: [{ name: 'UX_MBR_01', columns: ['MBR_NO'], unique: true }],
    },
    'erdd/tables/ORD.yaml': {
      name: 'ORD', logicalName: '주문',
      columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', nullable: false }],
      relations: [{ to: 'MBR', columns: { MBR_NO: 'MBR_NO' } }],
    },
  }
}

/** 재귀적으로 id 키를 걷어낸다 — "원본 + id뿐"임을 확인하는 데 쓴다. */
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds)
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== 'id')
        .map(([k, x]) => [k, stripIds(x)]),
    )
  }
  return v
}

describe('filesToModel — assignedTree (push 멱등성)', () => {
  it('id가 빠진 자리를 하나도 남기지 않는다', () => {
    let n = 0
    const first = filesToModel(treeWithNewEverywhere(), { newId: () => `id-${++n}` })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.assignedTree).toBeDefined()

    // 채운 트리를 newId 없이 다시 파싱하면 임시 id가 하나도 없어야 한다. 임시 id는 정확히
    // "id가 없는 자리"의 표식이라, 되쓰기를 한 자리라도 빠뜨리면 여기서 드러난다.
    // 새 파일 종류나 새 배열이 붙어도 이 단언이 자동으로 따라간다.
    const again = filesToModel(first.assignedTree!)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const m = again.model
    const allIds = [
      ...Object.keys(m.tableGroups), ...Object.keys(m.tables),
      ...Object.keys(m.columns), ...Object.keys(m.indexes), ...Object.keys(m.relationships),
      ...Object.keys(m.domains), ...Object.keys(m.words), ...Object.keys(m.terms),
      ...Object.keys(m.customFields),
    ]
    // 그룹1·도메인1·단어1·용어1·커스텀1·테이블2·컬럼2·인덱스1·관계1
    expect(allIds).toHaveLength(11)
    expect(allIds.some(isNewId)).toBe(false)
  })

  it('입력 트리를 변형하지 않는다', () => {
    const tree = treeWithNewEverywhere()
    const before = structuredClone(tree)
    filesToModel(tree, { newId: () => 'id-x' })
    expect(tree).toEqual(before)
  })

  it('채운 트리는 원본에 id만 더한 것이다', () => {
    const tree = treeWithNewEverywhere()
    let n = 0
    const result = filesToModel(tree, { newId: () => `id-${++n}` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(stripIds(result.assignedTree!)).toEqual(tree)
  })

  it('이미 적힌 id는 그대로 두고 새로 발급하지 않는다', () => {
    const result = filesToModel({
      'erdd/tables/MBR.yaml': {
        id: 'table-keep', name: 'MBR', logicalName: '회원',
        columns: [{ id: 'col-keep', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT' }],
      },
    }, { newId: () => 'issued' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const file = result.assignedTree!['erdd/tables/MBR.yaml'] as { id: string; columns: { id: string }[] }
    expect(file.id).toBe('table-keep')
    expect(file.columns[0]!.id).toBe('col-keep')
    expect(Object.keys(result.model.tables)).toEqual(['table-keep'])
  })

  it('newId를 주지 않으면 assignedTree가 없다', () => {
    const result = filesToModel(treeWithNewEverywhere())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assignedTree).toBeUndefined()
  })

  it('파싱에 실패하면 assignedTree를 내지 않는다', () => {
    // 없는 부모 테이블을 가리키는 관계 — 기존 테스트가 쓰는 것과 같은 실패 경로다.
    const result = filesToModel({
      'erdd/tables/ORD.yaml': {
        name: 'ORD', logicalName: '주문', columns: [],
        relations: [{ to: 'NOPE', columns: {} }],
      },
    }, { newId: () => 'id-x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result).not.toHaveProperty('assignedTree')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
pnpm --filter @erdd/core exec vitest run src/file-format.test.ts
```

Expected: 새 `describe`의 6건 중 최소 4건이 FAIL. `assignedTree`가 아직 없으므로 `toBeDefined()`·`stripIds(...!)`가 깨지고, `not.toHaveProperty`와 `toBeUndefined()`는 지금도 통과할 수 있다(아직 속성이 없으므로) — **정상이다.** 그 둘은 구현 후 회귀 방지용이다.

- [ ] **Step 3: 반환 타입을 넓힌다**

`packages/core/src/file-format.ts` 207-209행:

```ts
export type FilesToModelResult =
  | { ok: true; model: ProjectModel; warnings: FileIssue[]; assignedTree?: FileTree }
  | { ok: false; issues: FileIssue[] }
```

- [ ] **Step 4: 복사본을 순회하고 `idOf`가 되써 넣게 한다**

`filesToModel`(247행) 진입부, `const newId = opts?.newId` 바로 아래에 추가한다:

```ts
  // newId가 있으면(push 경로) 복사본에 발급 id를 되써 넣어 "id를 채운 트리"를 함께 낸다.
  // 입력은 절대 변형하지 않는다 — 호출자가 원본 트리를 계속 쓴다(reserveIds가 둘을 비교한다).
  // JSON 왕복이 아니라 structuredClone인 이유는 YAML이 낼 수 있는 Date 스칼라를 보존하기 위해서다.
  const src = newId === undefined ? tree : structuredClone(tree)
```

그다음 **입력 트리를 읽는 3곳을 `src`로 바꾼다.** 현재 위치는 다음과 같다(줄 번호는 위 삽입으로 밀린다 — 표현으로 찾아라):

| 현재 표현 | 바꿀 표현 | 위치 |
|---|---|---|
| `const file = tree[path]` (`readList` 안) | `const file = src[path]` | 284행 부근 |
| `Object.keys(tree).filter(...)` (`tablePaths`) | `Object.keys(src).filter(...)` | 362행 부근 |
| `const file = tree[path]` (테이블 순회) | `const file = src[path]` | 366행 부근 |

`filesToModel` 안에서 `tree`를 읽는 곳은 이 3곳뿐이다. 바꾼 뒤 `grep -n '\btree\b' packages/core/src/file-format.ts`로 `filesToModel` 본문에 `tree` 참조가 남지 않았는지 확인하라(`modelToFiles`의 `tree`는 별개의 지역 변수다 — 건드리지 마라).

`idOf`(261행 부근)의 발급 갈래를 바꾼다:

```ts
  const idOf = (r: Rec, path: string, kind: string, index: number): string => {
    const explicit = asStr(r['id'])
    if (explicit === null) {
      if (newId === undefined) return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
      // r은 src 안의 객체다(입력 tree는 그대로다). 발급 자리가 곧 기록 자리이므로 순회를
      // 복제할 필요가 없고, 나중에 자리가 늘어도 자동으로 따라간다 — 이것이 별도
      // assignMissingIds를 만들지 않은 이유다.
      const id = newId()
      r['id'] = id
      return id
    }
    // ↓ 아래 explicit id 중복 검사는 그대로 둔다
```

- [ ] **Step 5: 성공 갈래에 `assignedTree`를 싣는다**

`filesToModel` 마지막 반환(457-458행 부근):

```ts
  if (issues.length > 0) return { ok: false, issues }
  // 파싱에 실패한 트리에 id를 기록할 이유가 없다 — ok:false에는 싣지 않는다.
  return { ok: true, model, warnings, ...(newId === undefined ? {} : { assignedTree: src }) }
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/core exec vitest run src/file-format.test.ts
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
```

Expected: 전부 PASS, EXIT=0.

- [ ] **Step 7: 구분력을 확인한다**

`idOf`의 `r['id'] = id` 한 줄을 주석 처리하고 위 테스트를 다시 돌린다.
Expected: "id가 빠진 자리를 하나도 남기지 않는다"와 "채운 트리는 원본에 id만 더한 것이다"가 FAIL.
확인 후 **되돌린다.** 실패하지 않으면 덮지 말고 보고하라.

- [ ] **Step 8: core 전체 스위트를 돌린다**

```bash
pnpm --filter @erdd/core exec vitest run
```

Expected: **459 passed** (기준선 453 + 6). 기존 테스트는 하나도 깨지지 않아야 한다 — 특히 `newId를 주면 신규 객체가 발급된 id를 받고 참조도 그 id로 조립된다`(132행)와 `왕복이 항등이다 — 9개 컬렉션 전부`(192행).

- [ ] **Step 9: 커밋**

```bash
git add packages/core/src/file-format.ts packages/core/src/file-format.test.ts && \
git commit -m "$(cat <<'EOF'
feat(core): filesToModel이 신규 id를 채운 트리를 함께 낸다

push 멱등성의 토대. newId를 받았을 때만 입력 트리의 복사본을 순회하며 idOf가 발급한
id를 그 자리에 되써 넣고 assignedTree로 돌려준다. 입력은 변형하지 않는다.

별도 순회 함수를 만들지 않은 이유는 갈릴 수 있기 때문이다 — id가 빠질 수 있는 자리
9곳이 전부 idOf 하나를 지나므로, 발급 자리에서 되쓰면 새 파일 종류나 새 배열이 붙어도
자동으로 따라간다. 완전성은 "채운 트리를 다시 파싱하면 임시 id가 0건"으로 잠근다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- packages/core/src/file-format.ts packages/core/src/file-format.test.ts
```

---

## Task 2: cli — `reserveIds`

**Files:**
- Modify: `packages/cli/src/tree.ts` (11행 `canonical`에 `export` 추가)
- Create: `packages/cli/src/commands/reserve-ids.ts`
- Test: `packages/cli/src/commands/reserve-ids.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `assignedTree`(형식만 — 여기서는 `FileTree`를 직접 만들어 테스트한다), `canonical(v: unknown): string`(`tree.ts`)
- Produces: `reserveIds(cwd: string, local: FileTree, assigned: FileTree | undefined): Promise<string[]>` — 실제로 기록한 상대 경로들(정렬됨). Task 3의 `push.ts`가 부른다.

- [ ] **Step 1: `canonical`을 export한다**

`packages/cli/src/tree.ts` 11행:

```ts
/** 키 순서와 무관하게 값이 같은지 본다 — YAML 재작성으로 순서가 흔들려도 수정으로 잡지 않는다. */
export function canonical(v: unknown): string {
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/cli/src/commands/reserve-ids.test.ts` (신규):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { FileTree } from '@erdd/core'
import { reserveIds } from './reserve-ids.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-reserve-'))
  await mkdir(join(dir, 'erdd/tables'), { recursive: true })
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const write = (rel: string, v: unknown) => writeFile(join(dir, rel), stringifyYaml(v), 'utf8')
const read = async (rel: string) => parseYaml(await readFile(join(dir, rel), 'utf8')) as Record<string, unknown>

describe('reserveIds', () => {
  it('id가 늘어난 파일만 쓰고 나머지는 손대지 않는다', async () => {
    const untouchedBody = { name: 'ORD', logicalName: '주문', id: 'tb2', columns: [] }
    await write('erdd/tables/MBR.yaml', { name: 'MBR', logicalName: '회원', columns: [] })
    await write('erdd/tables/ORD.yaml', untouchedBody)
    const mtimeBefore = (await stat(join(dir, 'erdd/tables/ORD.yaml'))).mtimeMs

    const local: FileTree = {
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [] },
      'erdd/tables/ORD.yaml': untouchedBody,
    }
    const assigned: FileTree = {
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [], id: 'tb1' },
      'erdd/tables/ORD.yaml': untouchedBody,
    }

    const written = await reserveIds(dir, local, assigned)
    expect(written).toEqual(['erdd/tables/MBR.yaml'])
    expect((await read('erdd/tables/MBR.yaml'))['id']).toBe('tb1')
    // 안 바뀐 파일은 다시 쓰지도 않는다 — 매번 전부 쓰면 사용자 트리가 push마다 흔들린다.
    expect((await stat(join(dir, 'erdd/tables/ORD.yaml'))).mtimeMs).toBe(mtimeBefore)
  })

  it('assigned가 없으면 아무것도 하지 않는다', async () => {
    await write('erdd/tables/MBR.yaml', { name: 'MBR', logicalName: '회원', columns: [] })
    const mtimeBefore = (await stat(join(dir, 'erdd/tables/MBR.yaml'))).mtimeMs

    const written = await reserveIds(dir, { 'erdd/tables/MBR.yaml': {} }, undefined)
    expect(written).toEqual([])
    expect((await stat(join(dir, 'erdd/tables/MBR.yaml'))).mtimeMs).toBe(mtimeBefore)
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
pnpm --filter @erdd/cli exec vitest run src/commands/reserve-ids.test.ts
```

Expected: FAIL — `Cannot find module './reserve-ids.js'`.

- [ ] **Step 4: `reserveIds`를 구현한다**

`packages/cli/src/commands/reserve-ids.ts` (신규):

```ts
import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { FileTree } from '@erdd/core'
import { canonical } from '../tree.js'

/**
 * push가 서버로 보내기 직전에, 이번 계획이 발급한 신규 id를 로컬 파일에 박아 둔다.
 * 이것이 push 멱등성의 전부다 — 커밋 뒤 응답이 유실돼도 다음 push가 같은 id를 쓰므로
 * 서버는 "이미 있는 것"으로 보고 사본을 만들지 않는다.
 *
 * writeTree를 쓰지 않는다. 그 함수는 삭제·개명 패스를 함께 돌리는데, 여기서 파일명이
 * 정규화되면(tableFileName은 물리명으로 파일명을 정하고 충돌 시 id 뒷자리를 붙인다)
 * 사용자가 만든 파일과 갈려 같은 테이블이 두 파일에 남고, 다음 filesToModel이 id 중복
 * 으로 push 자체를 막는다. 원래 경로에 내용만 다시 쓴다.
 *
 * 반환은 실제로 기록한 상대 경로들이다(정렬됨).
 */
export async function reserveIds(
  cwd: string, local: FileTree, assigned: FileTree | undefined,
): Promise<string[]> {
  if (assigned === undefined) return []
  const written: string[] = []
  for (const [rel, content] of Object.entries(assigned)) {
    // id가 실제로 늘어난 파일만 쓴다. 매번 전부 쓰면 push할 때마다 사용자 트리가 재작성된다.
    if (canonical(local[rel]) === canonical(content)) continue
    const abs = join(cwd, rel)
    await mkdir(dirname(abs), { recursive: true })
    // 전송이 실패한 시점에 디스크에 남아 있어야 의미가 있으므로 fsync까지 한다.
    const fh = await open(abs, 'w')
    try {
      await fh.writeFile(stringifyYaml(content), 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    written.push(rel)
  }
  return written.sort()
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/cli exec vitest run src/commands/reserve-ids.test.ts
pnpm -s -C packages/cli typecheck; echo "EXIT=$?"
```

Expected: 2 passed, EXIT=0.

- [ ] **Step 6: 구분력을 확인한다**

`if (canonical(local[rel]) === canonical(content)) continue` 줄을 지우고 다시 돌린다.
Expected: "id가 늘어난 파일만 쓰고…"가 FAIL(`written`이 2개가 되고 ORD의 mtime이 바뀐다).
확인 후 **되돌린다.**

- [ ] **Step 7: cli 전체 스위트를 돌린다**

```bash
pnpm --filter @erdd/cli exec vitest run
```

Expected: **116 passed** (기준선 114 + 2).

- [ ] **Step 8: 커밋**

```bash
git add packages/cli/src/tree.ts packages/cli/src/commands/reserve-ids.ts packages/cli/src/commands/reserve-ids.test.ts && \
git commit -m "$(cat <<'EOF'
feat(cli): 신규 id를 원래 파일 경로에 기록하는 reserveIds

id가 실제로 늘어난 파일만 골라 원래 경로에 다시 쓰고 fsync한다. writeTree를 쓰지
않는 것이 핵심이다 — 그 함수의 삭제·개명 패스가 돌면 파일명이 정규화되어 사용자가
만든 파일과 갈리고, 같은 테이블이 두 파일에 남아 다음 push가 id 중복으로 막힌다.

tree.ts의 canonical을 export한다(diffTrees가 이미 쓰는 같은 비교다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- packages/cli/src/tree.ts packages/cli/src/commands/reserve-ids.ts packages/cli/src/commands/reserve-ids.test.ts
```

---

## Task 3: cli — `push` 배선과 보고 문구

**Files:**
- Modify: `packages/cli/src/plan.ts` (`PushPlan` 11-24행, `buildPlan` 반환 62-66행)
- Modify: `packages/cli/src/commands/push.ts` (115행 뒤 `reserveIds` 호출, 세 `emit` 봉투, `outcomeUnknown` 문구)
- Test: `packages/cli/src/commands/push.test.ts` (`describe('push', ...)` 안 끝에 추가)

**Interfaces:**
- Consumes: Task 1의 `assignedTree`, Task 2의 `reserveIds(cwd, local, assigned)`
- Produces: `PushPlan`에 `localTree: FileTree`·`assignedTree: FileTree | undefined`. JSON 봉투 세 곳에 `reservedFiles: string[]`.

- [ ] **Step 1: `PushPlan`을 넓힌다**

`packages/cli/src/plan.ts`. import에 `type FileTree`를 더한다(`@erdd/core`에서). 타입:

```ts
export type PushPlan = {
  /** model.get 시점의 서버 리비전 — model.push의 expectedSeq가 된다. */
  seq: number
  /** 정규화하지 않은 서버 모델. applyMerge가 좌표·origin·메모를 여기서 가져온다. */
  server: ProjectModel
  /** 파일 가시 공간의 셋 — diff의 표시가 이 셋을 쓴다. */
  base: ProjectModel
  local: ProjectModel
  serverVisible: ProjectModel
  /** 읽은 그대로의 로컬 트리 — reserveIds가 "실제로 id가 늘었는지" 비교하는 기준이다. */
  localTree: FileTree
  /**
   * filesToModel이 신규 id를 채워 넣은 트리. buildPlan은 이것을 쓰지 않는다 —
   * erdd diff도 이 함수를 쓰므로 계획 수립이 파일을 건드리면 안 된다. push만 기록한다.
   */
  assignedTree: FileTree | undefined
  /** 충돌이 있으면 빈 배열이다(충돌 필드에 서버 값이 남은 merged로 op를 내면 틀린다). */
  ops: Op[]
  conflicts: MergeConflict[]
  pruned: PrunedRef[]
}
```

반환문(62-66행):

```ts
  return {
    seq, server, base: baseResult.model, local: localResult.model, serverVisible,
    localTree, assignedTree: localResult.assignedTree,
    ops: conflicts.length > 0 ? [] : diffModels(server, applied),
    conflicts, pruned,
  }
```

`localTree`는 33행에서 이미 읽은 `const localTree = await readTree(cwd)` 변수다 — 새로 읽지 마라.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/cli/src/commands/push.test.ts`. 먼저 import를 보강한다:

```ts
import { readTree, writeTree } from '../tree.js'      // readTree 추가
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml'   // 새 import
```

`describe('push', ...)` 블록 안, 마지막 `it` 뒤에 헬퍼와 테스트를 추가한다:

```ts
  /** MBR 테이블에 id 없는 컬럼을 하나 더한다 — 계획에 create가 하나 생긴다. */
  const addNewColumn = async (name = 'NEW_COL'): Promise<void> => {
    const tree = await readTree(dir)
    const mbr = tree['erdd/tables/MBR.yaml'] as { columns: Record<string, unknown>[] }
    mbr.columns.push({ name, logicalName: '새컬럼', type: 'INT' })
    await writeTree(dir, tree)
  }

  /** pushCalls[i]의 컬럼 create op가 쓴 entityId. */
  const createdColumnId = (calls: unknown[], i: number): string =>
    (calls[i] as { ops: Array<{ entity: string; action: string; entityId: string }> }).ops
      .find((o) => o.entity === 'column' && o.action === 'create')!.entityId

  it('커밋 뒤 응답이 유실돼도 다시 push하면 사본이 생기지 않는다', async () => {
    // 이 사이클의 핵심 회귀. 서버는 커밋을 마쳤는데 응답만 사라진 상황을 만든 뒤,
    // 사용자가 아무것도 모르고 그냥 다시 push하는 것을 재현한다.
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const first = stub(server, {
      pushImpl: async (input) => {
        Object.assign(server, applyOps(server, (input as { ops: Op[] }).ops))
        throw new CliError('NETWORK', 'socket hang up')
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: first.client })).toBe(1)
    expect(lastJson<{ outcomeUnknown: boolean }>().outcomeUnknown).toBe(true)
    expect(Object.values(server.columns).filter((c) => c.physicalName === 'NEW_COL')).toHaveLength(1)

    // 파일은 그대로, 서버는 이미 반영된 상태. 다시 실행한다.
    const second = stub(server, { seq: 2 })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: second.client })).toBe(0)
    expect(second.pushCalls).toHaveLength(0)          // 보낼 것이 없다
    expect(lastJson<{ ops: number }>().ops).toBe(0)
    // 사본이 없다. id를 기록하지 않으면 여기가 2가 된다.
    expect(Object.values(server.columns).filter((c) => c.physicalName === 'NEW_COL')).toHaveLength(1)
  })

  it('전송이 실패해 아무것도 커밋되지 않았어도 다음 push가 같은 id를 쓴다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const first = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: first.client })).toBe(1)

    const second = stub(server, { pushImpl: applyingPush(server, 2) })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: second.client })).toBe(0)
    expect(createdColumnId(second.pushCalls, 0)).toBe(createdColumnId(first.pushCalls, 0))
  })

  it('파일명과 물리명이 달라도 원래 파일에 id를 기록한다', async () => {
    // filesToModel은 파일명과 name의 일치를 강제하지 않는다. 정규 경로(NEWTBL.yaml)에
    // 기록하면 같은 테이블이 두 파일에 남아 다음 filesToModel이 id 중복으로 막는다.
    const server = fullModel()
    await seed(server)
    await writeFile(join(dir, 'erdd/tables/새테이블.yaml'), stringifyYaml({
      name: 'NEWTBL', logicalName: '새테이블',
      columns: [{ name: 'ID', logicalName: '아이디', type: 'INT' }],
    }), 'utf8')

    // 실패시켜야 syncDown이 파일을 정규화하기 전 상태를 볼 수 있다.
    const { client } = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)

    const written = parseYaml(await readFile(join(dir, 'erdd/tables/새테이블.yaml'), 'utf8')) as { id?: string }
    expect(typeof written.id).toBe('string')
    await expect(readFile(join(dir, 'erdd/tables/NEWTBL.yaml'), 'utf8')).rejects.toThrow()
  })

  it('CONFLICT로 다시 계산해도 신규 id가 바뀌지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    let attempt = 0
    const { client, pushCalls } = stub(server, {
      getImpl: () => ({ model: server, seq: attempt === 0 ? 1 : 2 }),
      pushImpl: async () => {
        if (attempt++ === 0) throw new CliError('CONFLICT', '서버가 앞서 있습니다')
        return { seq: 3 }
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(2)
    expect(createdColumnId(pushCalls, 1)).toBe(createdColumnId(pushCalls, 0))
  })

  it('삭제 확인에서 취소하면 파일에 아무것도 기록하지 않는다', async () => {
    const original = fullModel()
    await seed(original)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))   // 삭제를 만든다
    await addNewColumn()                              // 신규 항목도 함께 만든다
    const before = await readTree(dir)

    const { client, pushCalls } = stub(fullModel())
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client, confirm: async () => false,
    })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('충돌이 있으면 파일에 아무것도 기록하지 않는다', async () => {
    const original = fullModel()
    await seed(original)
    // 같은 필드를 로컬과 서버가 서로 다르게 고친다.
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 로컬'))
    await addNewColumn()
    const before = await readTree(dir)

    const server = fullModel()
    Object.values(server.columns).find((c) => c.logicalName === '회원명')!.logicalName = '서버'

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('보낼 변경이 없으면 파일에 아무것도 기록하지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const before = await readTree(dir)

    const { client } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('기록에 실패하면 model.push를 보내지 않는다', async () => {
    // id를 못 남긴 채 보내면 원래의 사본 문제가 그대로다 — 조용히 넘어가서는 안 된다.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      throw new Error('root로 실행 중이라 chmod 444가 무의미하다 — 이 테스트는 검증력이 없다')
    }
    const server = fullModel()
    await seed(server)
    await addNewColumn()
    await chmod(join(dir, 'erdd/tables/MBR.yaml'), 0o444)

    const { client, pushCalls } = stub(server)
    await expect(push({ cwd: dir, json: true, yes: true, strict: false, client })).resolves.toBe(1)
    expect(pushCalls).toHaveLength(0)
    await chmod(join(dir, 'erdd/tables/MBR.yaml'), 0o644)
  })

  it('성공 봉투에 기록한 파일 목록이 담긴다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const { client } = stub(server, { pushImpl: applyingPush(server, 2) })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(lastJson<{ reservedFiles: string[] }>().reservedFiles).toEqual(['erdd/tables/MBR.yaml'])
  })

  it('반영 여부 불명 문구가 다시 push해도 안전하다고 알린다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const { client } = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: false, yes: true, strict: false, client })).toBe(1)
    const text = out.join('')
    expect(text).toContain('반영 여부를 확인할 수 없습니다')
    expect(text).toContain('중복 없이 수렴')
    expect(text).toContain('erdd pull')     // 기존 안내도 남는다
  })
```

`chmod`를 `node:fs/promises` import에 더한다.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
pnpm --filter @erdd/cli exec vitest run src/commands/push.test.ts
```

Expected: 새 10건 중 최소 6건 FAIL — 핵심 회귀(사본이 2개가 됨), 같은 id 두 건, `reservedFiles` undefined, 문구, 기록 실패. "파일에 아무것도 기록하지 않는다" 3건은 지금도 통과한다(아직 아무것도 기록하지 않으므로) — **정상이다.** 그 셋은 배선 후 회귀 방지용이다.

- [ ] **Step 4: `push`에 `reserveIds`를 배선한다**

`packages/cli/src/commands/push.ts`. import 추가:

```ts
import { reserveIds } from './reserve-ids.js'
```

115행 `await confirmDeletes(ctx, plan)` **바로 뒤**에:

```ts
      await confirmDeletes(ctx, plan)

      // 서버로 보내기 직전에 신규 id를 파일에 박는다. 이 뒤로 무슨 일이 있어도 파일이 id를
      // 쥐고 있으므로, 응답이 유실돼 사용자가 다시 push해도 서버는 "이미 있는 것"으로 본다.
      // 여기서 실패하면 전송하지 않고 그대로 던진다 — id를 못 남긴 채 보내면 바로 그 사본
      // 문제가 남는다. 실패해도 기록한 id를 되돌리지 않는다(되돌리는 순간 문제가 부활한다).
      const reservedFiles = await reserveIds(ctx.cwd, plan.localTree, plan.assignedTree)
```

- [ ] **Step 5: 봉투 세 곳과 문구를 고친다**

`outcomeUnknown` 봉투(151-160행 부근) — 사람용 문구와 JSON 양쪽:

```ts
        emit(
          ctx.json,
          `반영 여부를 확인할 수 없습니다 (변경 ${plan.ops.length}건) — 신규 항목의 id를 파일에 `
            + `기록해 두었으므로 그대로 다시 push하면 중복 없이 수렴합니다. `
            + `먼저 확인하려면 erdd pull 또는 erdd diff를 실행하세요 (${detail})`,
          {
            ok: false, outcomeUnknown: true, revisionSeq: null, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
            pushError: detail,
            pushErrorCode: err instanceof CliError ? err.code : null,
          },
        )
```

`committed: true` 봉투(171-179행 부근) — 문구는 그대로 두고 `reservedFiles`만 더한다:

```ts
          {
            ok: false, committed: true, revisionSeq: seq, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
            syncError: detail,
          },
```

성공 봉투(183-186행 부근):

```ts
      emit(ctx.json, `반영했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건)`, {
        ok: true, revisionSeq: seq, ops: plan.ops.length,
        ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
      })
```

**`plan.ops.length === 0` 조기 반환 봉투(102-105행)는 건드리지 마라** — 그 경로는 `reserveIds`에 닿기 전이고, 보낼 변경이 없으면 기록할 것도 없다.

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/cli exec vitest run src/commands/push.test.ts
pnpm -s -C packages/cli typecheck; echo "EXIT=$?"
```

Expected: 전부 PASS, EXIT=0. 기존 테스트도 전부 통과해야 한다 — 특히 `model.push가 CONFLICT가 아닌 이유로 실패하면 사람용 문구가 확인 방법을 알려 준다`(469행)가 `erdd pull`을 단언하므로 새 문구에 그 문자열이 남아 있어야 한다.

- [ ] **Step 7: 구분력을 확인한다**

`push.ts`의 `reserveIds` 호출 줄을 `const reservedFiles: string[] = []`로 바꾸고 다시 돌린다.
Expected: "커밋 뒤 응답이 유실돼도…"(사본 2건), "전송이 실패해…같은 id"(id 불일치), "파일명과 물리명이 달라도…", "CONFLICT로 다시 계산해도…", "성공 봉투에 기록한 파일 목록"이 FAIL.
확인 후 **되돌린다.** 실패하지 않는 것이 있으면 덮지 말고 어느 것인지 보고하라.

- [ ] **Step 8: cli 전체 스위트를 돌린다**

```bash
pnpm --filter @erdd/cli exec vitest run
```

Expected: **126 passed** (기준선 114 + Task 2의 2 + 여기 10).

- [ ] **Step 9: 커밋**

```bash
git add packages/cli/src/plan.ts packages/cli/src/commands/push.ts packages/cli/src/commands/push.test.ts && \
git commit -m "$(cat <<'EOF'
feat(cli): push가 전송 직전 신규 id를 파일에 기록한다

buildPlan은 계획에 localTree·assignedTree를 실어 나르기만 한다 — erdd diff도 같은
함수를 쓰므로 계획 수립이 파일을 건드리면 안 된다. 기록은 push에서, 삭제 확인을
통과한 뒤 model.push 직전에 한다. 실패하면 전송하지 않고, 실패해도 기록한 id를
되돌리지 않는다(되돌리는 순간 사본 문제가 부활한다).

CONFLICT 재시도 경로는 손대지 않았다 — 두 번째 buildPlan이 방금 기록된 id를 파일에서
읽으므로 저절로 안정된다.

반영 여부 불명 문구가 이제 "다시 push하면 중복 없이 수렴한다"고 말한다. 이 문장은
이번 변경 전에는 참이 아니었다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- packages/cli/src/plan.ts packages/cli/src/commands/push.ts packages/cli/src/commands/push.test.ts
```

---

## Task 4: 문서 정정

**Files:**
- Modify: `docs/superpowers/HANDOFF.md` (1절 기준선 40행·"다음 작업" 77-80행, 6절 "승격 요청 큐" 369행, "CLI 트랙 B" 453행)
- Modify: `docs/superpowers/specs/2026-08-04-cli-push-design.md` (§9 마지막 항목)

**Interfaces:** 없음(문서 전용). 실측 테스트 수는 Task 3까지 마친 뒤 전체 스위트로 확정한다.

- [ ] **Step 1: 전체 스위트를 돌려 실제 수를 확정한다**

```bash
set -a && . ./.env && set +a && pnpm verify 2>&1 | grep -E "Test Files|Tests  "
```

Expected: core 459 · cli 126 · web 382 · server 143, 전체 exit 0.
**수가 다르면 그대로 기록하고 왜 다른지 보고하라** — 문서에는 실측값을 쓴다.

- [ ] **Step 2: `HANDOFF.md` 1절 기준선을 고친다**

40행:
```
core 453 · cli 114 · web 378 · server 141 (erdd_test) · typecheck EXIT=0
```
→ Step 1의 실측값으로. `web 382 · server 143`은 이번 사이클이 아니라 직전 사이클 막바지 커밋(`feb54df`·`5c81dd1`)이 올린 값이고, `core`·`cli` 증가분이 이번 사이클 몫이다. 44행의 "승격 요청 큐 사이클에서 web +20 · server +19가 붙었다" 문단 뒤에 이번 사이클 한 줄을 더한다.

- [ ] **Step 3: `HANDOFF.md` 1절 "다음 작업"에서 끝난 두 항목을 지운다**

77-80행의 번호 목록에서:
- **1번(CLI push의 비멱등 쓰기)** — 이번 사이클에서 해소. 삭제한다.
- **2번(`cancel`의 read-then-write)** — `feb54df`에서 이미 해소돼 있었다(조건부 UPDATE + `rowCount === 0` → CONFLICT). 삭제한다.

남는 3·4번을 1·2번으로 올린다.

- [ ] **Step 4: `HANDOFF.md` 6절의 낡은 이월 항목을 지운다**

369행 "**`cancel`이 read-then-write다**"로 시작하는 항목 전체를 삭제한다. 대신 370행 항목("동시성은 결정적으로 테스트할 수 있다")의 `cancel` vs `resolve` 서술이 **이미 구현된 테스트를 가리키도록** 과거형으로 다듬는다 — 그 기법은 `promotion.test.ts:609`에 실재하고 `5c81dd1`이 `pg_locks` 확인까지 넣었다.

- [ ] **Step 5: `HANDOFF.md` 6절 "CLI 트랙 B"의 해소 항목을 갱신한다**

453행 "**`push`는 비멱등 쓰기다 — 커밋 후 응답이 유실되면 다음 push가 조용히 사본을 만든다.**"로 시작하는 항목을 **해소로 바꾼다.** 남는 한계는 설계 §9 그대로 적는다:

```markdown
- ~~`push`는 비멱등 쓰기다~~ → **해소됨**(2026-08-05, [설계](specs/2026-08-05-cli-push-idempotency-design.md)).
  `filesToModel`이 신규 id를 채운 트리를 함께 내고, `push`가 전송 직전 그것을 원래 파일 경로에
  기록한다. 남는 한계: **서버는 여전히 멱등이 아니다**(같은 요청을 그대로 두 번 보내면 리비전이
  둘 생긴다 — CLI는 재전송하지 않으므로 이 경로를 만들지 않는다), 기록된 id는 회수되지 않는다,
  기록 대상 파일은 push가 실패해도 한 번 재작성된다(주석·서식 손실 — pull과 같은 성질).
```

- [ ] **Step 6: push 설계 §9에 해소 표시를 단다**

`docs/superpowers/specs/2026-08-04-cli-push-design.md` §9의 "**`push`는 신뢰할 수 없는 전송로 위를 지나는 비멱등 쓰기다.**" 항목 끝에 한 줄을 더한다:

```markdown
  **→ 해소됨(2026-08-05):** [CLI push 멱등성 설계](2026-08-05-cli-push-idempotency-design.md).
  멱등 키가 아니라 "신규 id를 전송 직전 로컬 파일에 기록"으로 닫았다 — 멱등 키는 같은 요청의
  재전송만 흡수하고 사용자가 나중에 다시 push하는 경로를 막지 못한다.
```

- [ ] **Step 7: 커밋**

```bash
git add docs/superpowers/HANDOFF.md docs/superpowers/specs/2026-08-04-cli-push-design.md && \
git commit -m "$(cat <<'EOF'
docs: push 멱등성 해소를 기록하고 낡은 이월 항목을 정정한다

CLI 트랙 B의 비멱등 쓰기와 승격 요청 큐의 cancel read-then-write를 이월에서 뺀다.
후자는 이번 사이클이 아니라 feb54df에서 이미 고쳐져 있었는데(조건부 UPDATE +
rowCount 0 → CONFLICT), 5c81dd1의 테스트 견고화와 함께 HANDOFF에 반영되지 않은 채
남아 있었다. 테스트 기준선도 그 두 커밋 이전 값이었다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- docs/superpowers/HANDOFF.md docs/superpowers/specs/2026-08-04-cli-push-design.md
```

---

## 최종 리뷰 (컨트롤러가 태스크 4개 뒤에 수행)

태스크별 리뷰가 전부 clean이어도 **최종 whole-branch 리뷰를 반드시 한다.** 실시간 사이클에서 7태스크가 모두 Critical 0건이었는데 최종 리뷰가 Critical 1건 + Important 2건을 잡았고, 셋 다 태스크 경계를 가로지르는 결함이었다.

최종 리뷰 프롬프트에 반드시 넣을 질문:

> **이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라.**

이번 브랜치에서 이에 해당하는 후보(리뷰어가 스스로 찾아야 하므로 프롬프트에는 넣지 않는다):
- `filesToModel` — `newId` 있는 호출자(`plan.ts`)와 없는 호출자(`validate`, base 파싱, 테스트)가 이제 **서로 다른 반환 shape**을 받는다.
- `canonical` — `diffTrees`와 `reserveIds`. 전자는 base 대비 수정 판정, 후자는 "id가 늘었는지" 판정.

추가로 확인할 것:
- `structuredClone`이 `filesToModel`의 **모든** 호출 경로에서 도는지, 아니면 `newId`가 있을 때만 도는지(성능 — `pull`/`validate`는 큰 트리를 다루는데 복사 비용을 지면 안 된다).
- `erdd diff`가 파일을 건드리지 않는 것이 **구조적으로** 보장되는지(`reserveIds` 호출처가 `push.ts` 하나인지 grep으로 확인).
- typecheck를 **종료코드로** 판정했는지.

이후 컨트롤러가 브라우저 스모크(실 앱 + 실 DB)를 하고 main에 머지한다. CLI 변경이라 브라우저 스모크의 값이 제한적이므로, **실제 서버에 대고 `erdd push`를 한 번 돌리는 CLI 스모크**를 함께 한다 — 신규 테이블을 파일로 만들어 push하고, 파일에 id가 채워지는지와 두 번째 push가 "변경 없음"이 되는지 확인한다.

---

## 자체 리뷰 결과

**1. 설계 커버리지**

| 설계 절 | 태스크 |
|---|---|
| §2.1 로컬 id 기반 | 1·3 (서버 무변경) |
| §2.2 원래 파일 경로 | 2(`writeTree` 미사용) · 3(테스트 "파일명과 물리명이 달라도") |
| §2.3 `filesToModel`이 채운다 | 1 |
| §2.4 시점·미정리·diff 제외 | 3 Step 4(위치) · 테스트 "삭제 확인에서 취소" · `reserveIds` 호출처가 `push.ts` 하나 |
| §2.5 자동 재시도 없음 | 3 Step 5(문구만 변경, 재시도 로직 무변경) |
| §4.1 core | 1 |
| §5.1-5.3 cli | 3 |
| §7.1 core 테스트 6건 | 1 Step 1 |
| §7.2 push 테스트 | 3 Step 2 (설계 9건 → 계획 10건, 문구 분리) |
| §7.3 reserve-ids 2건 | 2 Step 2 |
| §8 문서 정정 | 4 |

**2. 플레이스홀더** — 없다. 설계 §7.2에서 "계획에서 확정한다"로 남겼던 두 가지를 확정했다: 기록 실패 주입은 **chmod 444 + root 가드**(디렉터리로 만드는 방법은 `readTree`가 그 파일을 못 읽어 계획 자체가 달라지므로 못 쓴다), `diff.test.ts` 추가 테스트는 **넣지 않는다**(`reserveIds` 호출처가 `push.ts` 하나인 것이 구조적 보장이고, 최종 리뷰 항목으로 확인한다).

**3. 타입 일관성** — `assignedTree: FileTree | undefined`(`PushPlan`)와 `assignedTree?: FileTree`(`FilesToModelResult`)가 다르게 보이지만, `plan.ts`가 `localResult.assignedTree`를 대입할 때 `FileTree | undefined`로 좁혀지므로 호환된다. `reserveIds`의 세 번째 인자도 `FileTree | undefined`다. `canonical(v: unknown): string`는 `local[rel]`이 `undefined`일 수 있는데(assigned에만 있는 경로) `JSON.stringify(undefined)`가 `undefined`를 반환해 `content`의 문자열과 절대 같지 않으므로 "쓴다"로 귀결된다 — 의도한 동작이다.

**4. 기준선 산술** — core 453+6=459, cli 114+2+10=126. Task 2 Step 7의 중간 기대값 116, Task 3 Step 8의 126이 일관된다.
