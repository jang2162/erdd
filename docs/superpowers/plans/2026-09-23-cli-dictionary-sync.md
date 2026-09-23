# CLI 공용 사전 동기화 구현 계획

> **에이전트 작업자용:** 이 계획은 태스크 단위로 실행한다. 실행 방식은 저장소 규칙
> [docs/guides/worktree-workflow.md](../../guides/worktree-workflow.md) 가 정한다 — **워크트리
> `.worktrees/feat-cli-dict-sync`(기준 `main`) 안에서 워커가 구현·테스트·커밋하고, 메인 세션은
> 디스패치·판정·병합만 한다.** 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 로컬 편집 + 서버 보관함 구조에서 조직 공용 사전(단어·용어·도메인·커스텀 항목)을 CLI 로
받고(`erdd dict pull`) 올리며(`erdd dict push`), 서버 프로젝트 생성·이관을 `erdd init --create` 한 줄로 한다.

**아키텍처:** `origin` 을 커밋되는 파일 `erdd/origins.yaml` 에 싣고 3-way 병합의 일반 필드로 바꾼다.
`dict pull` 은 core `planResync`/`applyResyncPlan` 을 **로컬 파일 모델**에 돌리고, `dict push` 는 서버의
기존 승격 엔진(`resource.promote`→`runPromoteInTx`, `promotion.create`)을 토큰으로 부른다. 서버는 CLI 가
쓰는 여섯 프로시저만 `apiProcedure` 로 연다.

**기술 스택:** TypeScript · vitest · tRPC · zod · drizzle(PostgreSQL) · `yaml` · `uuidv7`

**설계:** [docs/superpowers/specs/2026-09-23-cli-dictionary-sync-design.md](../specs/2026-09-23-cli-dictionary-sync-design.md)
— 실행자는 이 계획과 설계를 **둘 다** 읽는다.

## 전역 제약

- 응답·커밋 메시지·문서·사용자 문구는 **한국어**.
- 커밋은 **경로 지정**으로 한다: `git add <경로들> && git commit -m "…" -- <경로들>`. `git add -A`·`commit -a` 금지.
- 커밋 메시지 말미 트레일러: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- 🔥 **`.env` 를 로드해 테스트를 돌리지 않는다**(개발 DB 가 날아간다). 서버 스위트는
  [setup.md](../../guides/setup.md) 의 격리 test DB 를 `DATABASE_URL` 로 **명시**해 돌린다.
- `pnpm -s -r typecheck` 는 오류가 있어도 출력이 빈다 — `pnpm -r typecheck; echo "EXIT=$?"` 로 판정한다.
- 새 tRPC 프로시저의 기본은 `authedProcedure` 다. 토큰에 여는 것은 **설계 6절 표의 여섯 개뿐**이다.
- 파일 경로 상수: `erdd/origins.yaml`. 출처 0건이면 **파일을 쓰지 않는다**(없음 = 0건).
- `origin.base` 는 **라이브러리 payload 를 프로젝트 공간으로 투영한 값**이다(`shared-resources.md`).
- 문서에 연대기·`파일:줄번호` 를 쓰지 않는다([doc-conventions.md](../../guides/doc-conventions.md)).

## 리뷰 초점

스펙이 암시하지만 쉽게 빠지는 입력 — 각 줄의 테스트는 소유 태스크에 들어 있다.

1. **`erdd pull` 이 config 를 다시 쓰면서 `dictionaries`(구독)를 지운다** — `syncDown` 이 config 를
   통째로 새로 만든다. pull 뒤에도 구독이 남아야 한다 → Task 4 테스트.
2. **id 없는 로컬 항목(사람이 직접 추가한 단어)이 있는 상태에서 `dict pull`** — 파일에 `new:…` 임시
   id 가 새어 나가면 안 된다 → Task 5 테스트.
3. **업그레이드 직후(옛 `base.json` 에 `origins.yaml` 이 없음)의 `push`** — 서버의 `origin` 을 지우는
   op 가 나가면 안 된다 → Task 1 테스트(cli `buildPlan`).
4. **`dict pull` 이 사전과 무관한 테이블 파일을 재작성** — 손으로 다듬은 테이블 YAML 이 바이트 단위로
   그대로여야 한다 → Task 5 테스트.
5. **사람이 `words.yaml` 에서 항목을 지워 `origins.yaml` 에 댕글링 줄이 남음** — 편집 잠금·push 거절이
   아니라 조용히 무시되고 다음 쓰기에서 정리돼야 한다 → Task 1 테스트.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/core/src/file-format.ts` | `ORIGINS_FILE`, `origins.yaml` 쓰기·읽기 | 1 |
| `packages/core/src/file-merge.ts` | `origin` 을 가시·병합 필드로 | 1 |
| `packages/core/src/resource-sync.ts` | `'adopt'` 결정, `adoptTargetOf` | 2 |
| `apps/server/src/routers/{resource,promotion,project}.ts` | 토큰 개방, promote source, create 입력 | 3 |
| `apps/server/src/routers/token-api.test.ts` (신규) | 토큰 개방 잠금 | 3 |
| `packages/cli/src/config.ts` | `dictionaries` 구독 | 4 |
| `packages/cli/src/commands/sync-down.ts` | 구독 보존 | 4 |
| `packages/cli/src/commands/dict-shared.ts` (신규) | 연결 관문·라이브러리 해석·옛 서버 번역·로컬 모델 읽기 | 4 |
| `packages/cli/src/commands/dict-list.ts` (신규) | `erdd dict list` | 4 |
| `packages/cli/src/commands/dict-pull.ts` (신규) | `erdd dict pull` | 5 |
| `packages/cli/src/commands/dict-push.ts` (신규) | `erdd dict push` | 6 |
| `packages/cli/src/commands/dict-requests.ts` (신규) | `erdd dict requests` | 6 |
| `packages/cli/src/commands/init.ts` | `--create` | 7 |
| `packages/cli/src/main.ts` | `dict` 배차·`init --create` 플래그·USAGE | 4·5·6·7 |
| `docs/…`, `packages/cli/skill/SKILL.md` | 정본·매뉴얼 | 8 |

---

### Task 0: 워크트리와 「옛 계약 서술」 목록

**Files:** 없음(작업 공간 준비)

- [ ] **Step 1: 워크트리 생성과 설치**

```bash
git worktree add -b feat/cli-dict-sync .worktrees/feat-cli-dict-sync main
cd .worktrees/feat-cli-dict-sync && pnpm install
```

- [ ] **Step 2: 없애는 계약의 서술을 grep 해 목록으로 남긴다**(worktree-workflow 4절 「기존 동작을 없애는
  사이클」). 이 목록이 Task 1·8 의 수정 대상이다.

```bash
grep -rn "origin" --include='*.md' docs packages/cli/skill | grep -iE "담기지 않|담지 않|건드리지 않|FILE_INVISIBLE|파일에 없" 
grep -rn "origin" packages/core/src/file-format.test.ts packages/core/src/file-merge.test.ts packages/cli/src/tree.test.ts packages/cli/src/commands/push.test.ts
```

Expected: `docs/guides/cli.md`(알려진 한계), `docs/manual/cli-guide.md`(8절 표·1절), `packages/cli/skill/SKILL.md`,
`file-format.test.ts` 의 「notes·position·origin은 어느 파일에도 나타나지 않는다」, `file-merge.test.ts` 의
「메모·좌표·origin을 파일 공간 값으로 정규화한다」, `tree.test.ts` 의 `origin = null` 기대값이 잡힌다.
결과를 워커 보고에 붙인다.

---

### Task 1: `origin` 을 파일 가시 필드로 — `origins.yaml` 과 병합 계약

두 변경은 기존 왕복 테스트(`filesToModel(modelToFiles(m)) == fileVisibleModel(m)`)로 묶여 있어 한
태스크다 — 한쪽만 바꾸면 그 테스트가 깨진다.

**Files:**
- Modify: `packages/core/src/file-format.ts`
- Modify: `packages/core/src/file-merge.ts`
- Test: `packages/core/src/file-format.test.ts`, `packages/core/src/file-merge.test.ts`,
  `packages/cli/src/tree.test.ts`, `packages/cli/src/commands/push.test.ts`

**Interfaces:**
- Produces: `export const ORIGINS_FILE = 'erdd/origins.yaml'`(file-format.ts, core index 로 재수출),
  `TOP_LEVEL_FILES` 의 **마지막** 원소로 `ORIGINS_FILE` 추가(순서 유지 — file-merge 가 앞 다섯을 위치로
  구조분해한다). `FILE_FIELDS.{domain,word,term,customField}.origin = '(출처)'`.
  `FILE_INVISIBLE_FIELDS` 의 네 종류는 `[]`. `fileVisibleModel` 은 `origin` 을 보존한다.

- [ ] **Step 1: 실패하는 core 테스트를 쓴다** — `file-format.test.ts` 끝에 추가

```ts
describe('origins.yaml', () => {
  const origin = {
    libraryId: 'L1', sourceId: 'S1', sourceVersion: 3,
    base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null },
  }
  function withWord(o: typeof origin | null = origin) {
    const m = createEmptyModel()
    m.words['w1'] = {
      id: 'w1', logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null, origin: o,
    }
    return m
  }

  it('출처를 origins.yaml 로 쓰고, 사전 파일에는 싣지 않으며, 다시 읽으면 복원된다', () => {
    const { tree } = modelToFiles(withWord())
    expect(tree['erdd/origins.yaml']).toEqual({
      origins: [{ id: 'w1', kind: 'word', library: 'L1', item: 'S1', version: 3, base: origin.base }],
    })
    expect(tree['erdd/words.yaml']).toEqual({ words: [{ id: 'w1', logicalName: '고객', abbreviation: 'CUST' }] })
    const r = filesToModel(tree)
    expect(r.ok && r.model.words['w1']!.origin).toEqual(origin)
  })

  it('출처가 0건이면 origins.yaml 을 만들지 않는다', () => {
    expect(modelToFiles(withWord(null)).tree).not.toHaveProperty('erdd/origins.yaml')
  })

  it('여러 종류의 출처를 id 오름차순으로 쓴다', () => {
    const m = withWord()
    m.domains['d0'] = {
      id: 'd0', name: 'NO', category: null, logicalType: 'string',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
      origin: { libraryId: 'L1', sourceId: 'S0', sourceVersion: 1, base: {} },
    }
    const list = (modelToFiles(m).tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins
    expect(list.map((o) => o.id)).toEqual(['d0', 'w1'])
  })

  it('가리키는 엔티티가 없는 줄은 조용히 무시하고 다음 쓰기에서 사라진다', () => {
    const { tree } = modelToFiles(withWord())
    tree['erdd/words.yaml'] = { words: [] }   // 사람이 단어를 지웠다
    const r = filesToModel(tree)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(modelToFiles(r.model).tree).not.toHaveProperty('erdd/origins.yaml')
  })

  it('같은 id 의 출처가 두 번이면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const list = (tree['erdd/origins.yaml'] as { origins: unknown[] }).origins
    tree['erdd/origins.yaml'] = { origins: [list[0], list[0]] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.message).join('\n')).toContain('두 번')
  })

  it('kind 가 실제 엔티티 종류와 다르면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: [{ ...o, kind: 'term' }] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(false)
  })

  it('필수 키가 빠지거나 version 이 정수가 아니면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: [{ ...o, version: '3' }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, base: undefined }] }
    expect(filesToModel(tree).ok).toBe(false)
  })
})
```

`file-merge.test.ts` 에 추가:

```ts
describe('origin 병합', () => {
  const X = { libraryId: 'L1', sourceId: 'S1', sourceVersion: 2, base: { logicalName: '고객' } }
  function word(origin: typeof X | null) {
    const m = createEmptyModel()
    m.words['w1'] = { id: 'w1', logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null, origin }
    return m
  }

  it('하위호환 — base·local 에 출처가 없고 서버에만 있으면 서버 값을 채택하고 충돌이 없다', () => {
    const { merged, conflicts } = mergeModels(word(null), word(null), word(X))
    expect(conflicts).toEqual([])
    expect(merged.words['w1']!.origin).toEqual(X)
  })

  it('로컬이 붙인 출처(dict pull)는 서버로 올라간다', () => {
    const server = word(null)
    const { merged } = mergeModels(word(null), word(X), server)
    const { model } = applyMerge(server, merged)
    const ops = diffModels(server, model)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ action: 'update', entity: 'word', entityId: 'w1' })
  })

  it('양쪽이 출처를 다르게 바꾸면 (출처) 필드 충돌이다', () => {
    const Y = { ...X, sourceVersion: 3 }
    const { conflicts } = mergeModels(word(null), word(X), word(Y))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ field: '(출처)', reason: 'field', path: 'erdd/words.yaml' })
  })
})
```

`diffModels` 와 `applyMerge` 를 이 파일의 import 에 더한다(이미 있으면 그대로).

`packages/cli/src/commands/push.test.ts` 에 리뷰 초점 3 을 추가한다 — 기존 `seed`/`stubClient` 관례를 따른다.

```ts
it('업그레이드 직후(base·로컬에 origins.yaml 이 없음) push 는 서버의 origin 을 지우지 않는다', async () => {
  const server = createEmptyModel()
  server.words['018f6b0e-0000-7000-8000-0000000000a1'] = {
    id: '018f6b0e-0000-7000-8000-0000000000a1', logicalName: '고객', abbreviation: 'CUST',
    englishName: null, description: null,
    origin: { libraryId: 'L1', sourceId: 'S1', sourceVersion: 1, base: { logicalName: '고객' } },
  }
  // 옛 CLI 가 쓴 트리 — origins.yaml 이 없다.
  const { tree } = modelToFiles(server)
  delete tree['erdd/origins.yaml']
  await writeTree(dir, tree)
  await writeBase(dir, tree)
  const { client } = stubClient(server)
  const plan = await buildPlan(dir, { serverUrl: TEST_CONFIG.serverUrl, projectId: TEST_CONFIG.projectId }, client)
  expect(plan.conflicts).toEqual([])
  expect(plan.ops).toEqual([])
})
```

(`dir`·`writeTree`·`writeBase`·`buildPlan`·`modelToFiles`·`createEmptyModel` 의 import 는 파일의 기존
것을 쓰고, 없으면 `../tree.js`·`../config.js`·`../plan.js`·`@erdd/core` 에서 더한다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/file-format.test.ts src/file-merge.test.ts`
Expected: FAIL — `erdd/origins.yaml` 키가 없음, 하위호환 케이스에서 `origin` 이 `null`.

- [ ] **Step 3: `file-format.ts` 를 구현한다**

상단 상수:

```ts
export const ORIGINS_FILE = `${TREE_ROOT}/origins.yaml`
export const TOP_LEVEL_FILES = [
  `${TREE_ROOT}/groups.yaml`,
  `${TREE_ROOT}/words.yaml`,
  `${TREE_ROOT}/terms.yaml`,
  `${TREE_ROOT}/domains.yaml`,
  `${TREE_ROOT}/custom-fields.yaml`,
  // ⚠️ 마지막에 둔다 — file-merge 가 앞 다섯을 위치로 구조분해한다.
  ORIGINS_FILE,
] as const
```

`import` 에 `import { RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, resourceEntitiesOf, type ResourceKind } from './resource.js'` 와 `type Origin` 을 더한다.

`modelToFiles` 의 `custom-fields.yaml` 쓰기 다음:

```ts
  // 출처는 사전 파일에 인라인하지 않는다 — base 가 payload 사본이라 항목 길이가 두 배가 되고,
  // 사람이 고치는 파일과 기계가 관리하는 파일이 섞인다. 0건이면 파일을 만들지 않는다.
  const origins = RESOURCE_KINDS.flatMap((kind) =>
    resourceEntitiesOf(model, kind)
      .filter((e): e is { id: string; origin: Origin } => e.origin !== null)
      .map((e) => ({
        id: e.id, kind, library: e.origin.libraryId, item: e.origin.sourceId,
        version: e.origin.sourceVersion, base: e.origin.base,
      })))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (origins.length > 0) tree[ORIGINS_FILE] = { origins }
```

`filesToModel` 의 `custom-fields.yaml` 읽기 다음(테이블 파일 읽기 전):

```ts
  // 출처 — 엔티티가 아니라 부속 정보라 idOf 를 지나지 않는다.
  // 가리키는 엔티티가 없는 줄(사람이 사전에서 항목을 지웠다)은 조용히 무시한다 — 다음 쓰기가
  // 정리하며, 이것 때문에 편집을 잠그면 과잉이다. 형식 오류·중복·종류 불일치는 파일 오류다.
  const originSeen = new Set<string>()
  readList(ORIGINS_FILE, 'origins').forEach((o, i) => {
    const id = asStr(o['id'])
    const kind = asStr(o['kind'])
    const library = asStr(o['library'])
    const item = asStr(o['item'])
    const version = o['version']
    const base = o['base']
    if (id === null || kind === null || !(RESOURCE_KINDS as readonly string[]).includes(kind)
        || library === null || item === null
        || typeof version !== 'number' || !Number.isInteger(version) || !isRec(base)) {
      issues.push({
        path: ORIGINS_FILE,
        message: `origins[${i}]의 형식이 올바르지 않습니다 — id·kind·library·item·version(정수)·base(객체)가 필요합니다`,
      })
      return
    }
    if (originSeen.has(id)) {
      issues.push({ path: ORIGINS_FILE, message: `id ${id}의 출처가 두 번 적혀 있습니다` })
      return
    }
    originSeen.add(id)
    const collectionOfKind = (k: ResourceKind) =>
      model[RESOURCE_COLLECTION_BY_KIND[k]] as unknown as Record<string, { origin: Origin | null }>
    const entity = collectionOfKind(kind as ResourceKind)[id]
    if (entity === undefined) {
      const actual = RESOURCE_KINDS.find((k) => k !== kind && collectionOfKind(k)[id] !== undefined)
      if (actual !== undefined) {
        issues.push({ path: ORIGINS_FILE, message: `id ${id}의 kind가 ${kind}로 적혀 있지만 실제로는 ${actual}입니다` })
      }
      return
    }
    entity.origin = { libraryId: library, sourceId: item, sourceVersion: version, base }
  })
```

`packages/core/src/index.ts` 가 `file-format.js` 를 `export *` 로 내보내는지 확인하고, 명시 목록이면
`ORIGINS_FILE` 을 더한다.

- [ ] **Step 4: `file-merge.ts` 를 구현한다**

```ts
// FILE_FIELDS — 사전 4종에 한 줄씩
  domain: { /* 기존 키 그대로 */ origin: '(출처)' },
  word: { /* 기존 */ origin: '(출처)' },
  term: { /* 기존 */ origin: '(출처)' },
  customField: { /* 기존 */ origin: '(출처)' },

/** 파일에 담기지 않는 필드. 병합 대상이 아니고 push가 절대 건드리지 않는다. */
export const FILE_INVISIBLE_FIELDS: Record<MergeKind, readonly string[]> = {
  tableGroup: [],
  // origin 은 erdd/origins.yaml 에 실려 파일이 진실이다(병합 필드). 객체 전체를 한 값으로 비교한다.
  domain: [], word: [], term: [], customField: [],
  table: ['position', 'groupPosition'],
  column: [], relationship: [], index: [],
}
```

`clearOrigin` 함수를 지우고 `fileVisibleModel` 의 네 줄을 얕은 복사로 바꾼다:

```ts
    domains: { ...model.domains },
    words: { ...model.words },
    terms: { ...model.terms },
    customFields: { ...model.customFields },
```

`fileVisibleModel`·`applyMerge` 의 주석에서 「origin 이 비어 있다」·「fork 출처가 지워진다」는 서술을
지금 참인 내용(좌표·메모만 비가시)으로 고친다. `displayValue` 에 출처 표시를 더한다:

```ts
  if (field === 'origin' && typeof value === 'object') {
    const o = value as { libraryId: string; sourceId: string; sourceVersion: number }
    return `${o.libraryId}/${o.sourceId} v${o.sourceVersion}`
  }
```

(`if (typeof value === 'object') return JSON.stringify(value)` **앞**에 둔다.)

- [ ] **Step 5: 옛 계약을 고정하던 테스트를 새 계약으로 고친다**

- `file-format.test.ts` 「notes·position·origin은 어느 파일에도 나타나지 않는다」 → 제목과 단언을
  「notes·position 은 어느 파일에도 나타나지 않는다」로 줄이고 `origin` 단언을 뺀다(출처는 위 새
  describe 가 다룬다).
- `file-merge.test.ts` 「메모·좌표·origin을 파일 공간 값으로 정규화한다」 → `origin` 은 **보존**된다고 단언한다
  (`expect(v.domains['d1']!.origin).toEqual({ libraryId: 'L1', sourceId: 'S1', sourceVersion: 3, base: {} })`).
- `packages/cli/src/tree.test.ts` 의 왕복 테스트에서 `origin = null` 로 지우던 네 줄을 지운다(왕복이 출처를 보존).

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck; echo "EXIT=$?"`
Expected: 전부 PASS, `EXIT=0`. `@erdd/web` 도 `fileVisibleModel` 을 쓰지 않는지 typecheck 가 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/file-format.ts packages/core/src/file-merge.ts packages/core/src/index.ts \
  packages/core/src/file-format.test.ts packages/core/src/file-merge.test.ts \
  packages/cli/src/tree.test.ts packages/cli/src/commands/push.test.ts && \
git commit -m "feat(core): origin 을 erdd/origins.yaml 에 싣고 3-way 병합 필드로 바꾼다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- \
  packages/core/src/file-format.ts packages/core/src/file-merge.ts packages/core/src/index.ts \
  packages/core/src/file-format.test.ts packages/core/src/file-merge.test.ts \
  packages/cli/src/tree.test.ts packages/cli/src/commands/push.test.ts
```

---

### Task 2: 재동기화 결정 `'adopt'` — 같은 이름의 프로젝트 항목에 출처를 연결

**Files:**
- Modify: `packages/core/src/resource-sync.ts`
- Test: `packages/core/src/resource-sync.test.ts`

**Interfaces:**
- Produces: `ResyncDecision = 'apply' | 'keep' | 'defer' | 'adopt'`;
  `export function adoptTargetOf(model: ProjectModel, entry: ResyncEntry): string | null` — `added` 이고
  같은 종류·같은 표시 이름(trim)·**출처 없는** 엔티티 중 id 오름차순 첫 것, 없으면 `null`.
  `applyResyncPlan(model, plan, decisions, newId)` 시그니처는 그대로.

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('adopt', () => {
  const libWord = (id: string, version: number, payload: Record<string, unknown>) =>
    ({ id, kind: 'word' as const, version, payload })
  function localWord(id: string, abbreviation: string, origin: Origin | null = null) {
    return { id, logicalName: '고객', abbreviation, englishName: null, description: null, origin }
  }

  it('같은 이름의 로컬 항목에 내용은 두고 출처만 붙인다 — base 는 투영된 원본 값', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST')
    const items = [libWord('S1', 4, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })]
    const plan = planResync(m, 'L1', items)
    expect(plan.entries[0]).toMatchObject({ status: 'added', nameClash: true })
    const next = applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')
    expect(Object.keys(next.words)).toEqual(['w1'])
    expect(next.words['w1']).toMatchObject({ abbreviation: 'CUST' })
    expect(next.words['w1']!.origin).toEqual({
      libraryId: 'L1', sourceId: 'S1', sourceVersion: 4,
      base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null },
    })
    expect(planResync(next, 'L1', items).entries).toEqual([])   // 곧바로 동기 상태
  })

  it('내용이 다르게 연결된 항목은 원본이 바뀌면 충돌로 뜬다', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CSTMR')
    const v1 = [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })]
    const adopted = applyResyncPlan(m, planResync(m, 'L1', v1), { S1: 'adopt' }, () => 'unused')
    const v2 = [libWord('S1', 2, { logicalName: '고객', abbreviation: 'CUS', englishName: null, description: null })]
    expect(planResync(adopted, 'L1', v2).entries[0]).toMatchObject({ status: 'conflict' })
  })

  it('같은 배치에서 연결한 도메인을 용어의 base.domainId 가 프로젝트 id 로 가리킨다', () => {
    const m = createEmptyModel()
    m.domains['d1'] = {
      id: 'd1', name: 'NO', category: null, logicalType: 'string',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    m.terms['t1'] = { id: 't1', logicalName: '고객번호', physicalName: 'CUST_NO', domainId: 'd1', description: null, origin: null }
    const items = [
      { id: 'SD', kind: 'domain' as const, version: 1, payload: { name: 'NO', category: null, logicalType: 'string', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null }, defaultValue: null, allowedValues: [], description: null } },
      { id: 'ST', kind: 'term' as const, version: 1, payload: { logicalName: '고객번호', physicalName: 'CUST_NO', domainId: 'SD', description: null } },
    ]
    const next = applyResyncPlan(m, planResync(m, 'L1', items), { SD: 'adopt', ST: 'adopt' }, () => 'unused')
    expect(next.terms['t1']!.origin!.base).toMatchObject({ domainId: 'd1' })
    expect(planResync(next, 'L1', items).entries).toEqual([])
  })

  it('이미 다른 출처가 붙은 항목은 대상이 아니다', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST', { libraryId: 'L0', sourceId: 'X', sourceVersion: 1, base: {} })
    const plan = planResync(m, 'L1', [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })])
    expect(adoptTargetOf(m, plan.entries[0]!)).toBeNull()
    expect(applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')).toEqual(m)
  })

  it('후보가 둘이면 id 오름차순 첫 항목에 붙인다', () => {
    const m = createEmptyModel()
    m.words['w2'] = localWord('w2', 'CUST')
    m.words['w1'] = localWord('w1', 'CUST')
    const plan = planResync(m, 'L1', [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })])
    const next = applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')
    expect(next.words['w1']!.origin).not.toBeNull()
    expect(next.words['w2']!.origin).toBeNull()
  })

  it('added 가 아닌 항목의 adopt 는 무시한다(keep 으로 새지 않는다)', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST', { libraryId: 'L1', sourceId: 'S1', sourceVersion: 1, base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null } })
    const plan = planResync(m, 'L1', [libWord('S1', 2, { logicalName: '고객', abbreviation: 'CUS', englishName: null, description: null })])
    expect(plan.entries[0]!.status).toBe('auto-update')
    expect(applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused').words['w1']!.origin!.sourceVersion).toBe(1)
  })
})
```

import 에 `adoptTargetOf` 와 `type Origin` 을 더한다.

- [ ] **Step 2: 실패 확인** — Run: `pnpm --filter @erdd/core exec vitest run src/resource-sync.test.ts` → FAIL(`adoptTargetOf` 없음).

- [ ] **Step 3: 구현**

```ts
export type ResyncDecision = 'apply' | 'keep' | 'defer' | 'adopt'

/**
 * `adopt` 의 대상 — 같은 종류·같은 표시 이름(trim)·**출처가 없는** 프로젝트 엔티티 중 id 오름차순
 * 첫 것. 이미 출처가 붙은 항목을 빼는 이유: 다른 라이브러리와의 링크를 조용히 갈아치우면 그쪽
 * 재동기화가 영영 「원본에서 사라짐」으로 보인다. 정렬은 planPromote 와 같은 결정성 규칙이다.
 */
export function adoptTargetOf(model: ProjectModel, entry: ResyncEntry): string | null {
  if (entry.status !== 'added') return null
  const hit = resourceEntitiesOf(model, entry.kind)
    .filter((e) => e.origin === null)
    .filter((e) => resourceDisplayName(entry.kind,
      resourcePayloadOf(entry.kind, e as unknown as Record<string, unknown>)).trim() === entry.name.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  return hit?.id ?? null
}
```

`applyResyncPlan` 의 1) 색인 단계, `allocated` 루프 **앞**에:

```ts
  // adopt 대상도 색인에 먼저 넣는다 — 같은 배치의 용어가 연결된 도메인을 참조할 수 있어야 한다.
  // 두 원본이 같은 엔티티를 고르면 먼저 온 쪽만 인정한다.
  const adopted = new Map<string, string>()
  const claimed = new Set<string>()
  for (const entry of selected) {
    if (decisions[entry.sourceId] !== 'adopt') continue
    const target = adoptTargetOf(model, entry)
    if (target === null || claimed.has(target)) continue
    claimed.add(target)
    adopted.set(entry.sourceId, target)
    idBySource.set(keyOf(entry.kind, entry.sourceId), target)
  }
```

적용 루프의 분기:

```ts
    if (entry.status === 'added') {
      if (decision === 'adopt') {
        const target = adopted.get(entry.sourceId)
        if (target === undefined) continue
        collection[target] = { ...collection[target]!, origin }   // 내용은 그대로, 출처만
        continue
      }
      if (decision !== 'apply') continue
      // … 기존 added 처리 그대로
    }
    if (decision === 'adopt') continue   // added 가 아니면 의미가 없다 — keep 으로 새면 안 된다
```

- [ ] **Step 4: 통과·타입 확인** — Run: `pnpm --filter @erdd/core exec vitest run && pnpm -r typecheck; echo "EXIT=$?"`
  Expected: PASS, `EXIT=0`. **웹의 재동기화 패널이 `ResyncDecision` 을 `Record<ResyncDecision, …>` 로
  쓰면** 여기서 깨진다 — 그 자리는 `Exclude<ResyncDecision, 'adopt'>` 로 좁혀 웹 동작을 그대로 둔다.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/resource-sync.ts packages/core/src/resource-sync.test.ts && \
git commit -m "feat(core): 재동기화에 adopt 결정을 더한다 — 같은 이름 항목에 출처만 연결

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- \
  packages/core/src/resource-sync.ts packages/core/src/resource-sync.test.ts
```

(웹을 고쳤다면 그 경로도 함께 명시한다.)

---

### Task 3: 서버 — 여섯 프로시저를 토큰에 열고, promote source·create 입력을 고친다

**Files:**
- Modify: `apps/server/src/routers/resource.ts`, `apps/server/src/routers/promotion.ts`, `apps/server/src/routers/project.ts`
- Create: `apps/server/src/routers/token-api.test.ts`

**Interfaces:**
- Produces(토큰 호출 가능): `resource.library.listForProject`, `resource.items.list`, `resource.promote`,
  `promotion.create`, `promotion.listForProject`, `project.create`.
  `project.create` 입력 += `namingRules?: NamingRules(strict)`, `tableOptions?: TableOptions(strict)`.
  `resource.promote` 의 Revision `source` = `ctx.authKind === 'token' ? 'cli' : 'web'`.

- [ ] **Step 1: 실패하는 테스트 — `token-api.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createEmptyModel, diffModels, type ProjectModel } from '@erdd/core'
import { revisions } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('CLI 사전 동기화가 토큰으로 부르는 프로시저', () => {
  let app: FastifyInstance
  let session: string
  let token: string
  let orgId: string
  let projectId: string
  let libraryId: string

  const sPost = (path: string, input: unknown) => app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
  const tGet = (path: string, input: unknown) => app.inject({
    method: 'GET', url: `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
    headers: { authorization: `Bearer ${token}` },
  })
  const tPost = (path: string, input: unknown) => app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(input),
  })

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user' })
    session = await loginAs(app, 'o@t.dev', 'password-o')
    token = (await sPost('auth.tokens.create', { name: 'cli' })).json().result.data.token
    orgId = (await sPost('org.create', { name: '팀' })).json().result.data.id
    projectId = (await sPost('project.create', { orgId, name: 'P', dialects: ['postgresql'] })).json().result.data.id
    libraryId = (await sPost('resource.library.create', { scope: 'org', orgId, name: '조직 표준' })).json().result.data.id
  })

  async function seedWord(): Promise<string> {
    const id = uuidv7()
    const next: ProjectModel = {
      ...createEmptyModel(),
      words: { [id]: { id, logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null } },
    }
    const res = await sPost('model.mutate', { projectId, ops: diffModels(createEmptyModel(), next), summary: '단어' })
    expect(res.statusCode).toBe(200)
    return id
  }

  it('project.create 를 토큰으로 부르고 명명 규칙·테이블 옵션을 함께 저장한다', async () => {
    const namingRules = {
      case: 'lower_snake', separator: '_', logicalSeparator: '_', maxLengthBytes: 64,
      tablePhysicalTemplate: '', tableLogicalTemplate: '',
    }
    const tableOptions = { postgresql: '', mysql: 'ENGINE=InnoDB', oracle: '', mssql: '' }
    const res = await tPost('project.create', { orgId, name: 'CLI', dialects: ['mysql'], namingRules, tableOptions })
    expect(res.statusCode).toBe(200)
    const created = res.json().result.data as { id: string }
    const got = (await tGet('project.get', { projectId: created.id })).json().result.data
    expect(got).toMatchObject({ dialects: ['mysql'], namingRules, tableOptions })
  })

  it('라이브러리 목록·항목을 토큰으로 읽는다', async () => {
    const libs = await tGet('resource.library.listForProject', { projectId })
    expect(libs.statusCode).toBe(200)
    expect(libs.json().result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: libraryId, canWrite: true })]))
    expect((await tGet('resource.items.list', { libraryId })).statusCode).toBe(200)
  })

  it('토큰으로 승격하면 Revision source 가 cli 다', async () => {
    const wordId = await seedWord()
    const res = await tPost('resource.promote', {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    })
    expect(res.statusCode).toBe(200)
    const [latest] = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(latest!.source).toBe('cli')
  })

  it('세션으로 승격하면 여전히 source 가 web 이다', async () => {
    const wordId = await seedWord()
    await sPost('resource.promote', {
      projectId, libraryId,
      entries: [{ entityId: wordId, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    })
    const [latest] = await app.db!.select().from(revisions)
      .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
    expect(latest!.source).toBe('web')
  })

  it('승격 요청을 토큰으로 만들고 목록을 읽는다', async () => {
    const wordId = await seedWord()
    const created = await tPost('promotion.create', { projectId, libraryId, entityIds: [wordId], note: 'CLI 요청' })
    expect(created.statusCode).toBe(200)
    const list = await tGet('promotion.listForProject', { projectId })
    expect(list.statusCode).toBe(200)
    expect(list.json().result.data).toEqual([expect.objectContaining({ note: 'CLI 요청', status: 'pending' })])
  })

  it('목록 밖의 프로시저는 여전히 토큰을 거절한다', async () => {
    expect((await tPost('resource.library.create', { scope: 'org', orgId, name: 'X' })).statusCode).toBe(401)
    expect((await tPost('resource.items.create', { libraryId, kind: 'word', payload: {} })).statusCode).toBe(401)
    expect((await tGet('resource.library.list', { scope: 'org', orgId })).statusCode).toBe(401)
  })
})
```

`revisions` 의 프로젝트 컬럼 이름이 `projectId` 가 아니면 `apps/server/src/db/schema.ts` 의 실제 이름으로 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL='<setup.md 의 격리 test DB>' pnpm --filter @erdd/server exec vitest run src/routers/token-api.test.ts`
Expected: FAIL — 토큰 호출이 401. (DATABASE_URL 이 없으면 **조용히 skip** 되므로 skip 수가 0 인지 본다.)

- [ ] **Step 3: 구현**

- `resource.ts`: `import { apiProcedure, authedProcedure, router } from '../trpc.js'`. `library.listForProject`·
  `items.list`·`promote` 의 `authedProcedure` → `apiProcedure`. 각 자리에 한 줄 주석
  `// CLI(erdd dict)가 토큰으로 부른다 — guides/cli.md 「액세스 토큰 인증」.`
  `promote` 의 `source: 'web'` → `source: ctx.authKind === 'token' ? 'cli' : 'web'`.
- `promotion.ts`: `create`·`listForProject` → `apiProcedure`(같은 주석).
- `project.ts`: `create` → `apiProcedure`. 입력에

```ts
      // CLI(init --create)가 로컬 config 의 규칙을 한 호출로 싣는다 — 생성 후 update 를 따로 부르면
      // 반쯤 만들어진 프로젝트가 남을 수 있다. update 와 같은 이유로 strict 다.
      namingRules: NamingRulesStrictSchema.optional(),
      tableOptions: TableOptionsStrictSchema.optional(),
```

  insert values 에 `...(input.namingRules ? { namingRules: input.namingRules } : {}), ...(input.tableOptions ? { tableOptions: input.tableOptions } : {})`.

- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. 서버 스위트 전체와 typecheck:
  `DATABASE_URL='<격리 test DB>' pnpm --filter @erdd/server exec vitest run && pnpm -r typecheck; echo "EXIT=$?"`

- [ ] **Step 5: 커밋**

```bash
git add apps/server/src/routers/resource.ts apps/server/src/routers/promotion.ts \
  apps/server/src/routers/project.ts apps/server/src/routers/token-api.test.ts && \
git commit -m "feat(server): CLI 사전 동기화용 프로시저 여섯을 토큰에 연다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- \
  apps/server/src/routers/resource.ts apps/server/src/routers/promotion.ts \
  apps/server/src/routers/project.ts apps/server/src/routers/token-api.test.ts
```

---

### Task 4: CLI 기반 — 구독(`dictionaries`), 공용 헬퍼, `erdd dict list`

**Files:**
- Modify: `packages/cli/src/config.ts`, `packages/cli/src/commands/sync-down.ts`,
  `packages/cli/src/commands/init.ts`(config 리터럴에 필드 추가만), `packages/cli/src/testing/harness.ts`,
  `packages/cli/src/main.ts`
- Create: `packages/cli/src/commands/dict-shared.ts`, `packages/cli/src/commands/dict-list.ts`,
  `packages/cli/src/commands/dict-shared.test.ts`
- Test: `packages/cli/src/config.test.ts`, `packages/cli/src/commands/commands.test.ts`(pull 쪽)

**Interfaces:**
- Produces:
  - `config.ts`: `export type DictionaryRef = { id: string; name: string }`; `ErddConfig.dictionaries: DictionaryRef[]`
    (**필수** — 모든 writer 가 컴파일에서 걸리게 한다). `readConfig` 는 누락을 `[]` 로 읽는다.
    `writeConfig` 는 빈 배열이면 키를 쓰지 않는다.
  - `dict-shared.ts`:
    ```ts
    export type LibraryRow = { id: string; scope: 'global' | 'org'; orgId: string | null; name: string;
      description: string; itemCount: number; canWrite: boolean }
    export function requireDictConnection(config: ErddConfig): Connection
    export async function guardFeature<T>(call: () => Promise<T>): Promise<T>
    export async function listLibraries(client: ApiClient, projectId: string): Promise<LibraryRow[]>
    export function resolveLibrary(rows: readonly LibraryRow[], ref: string): LibraryRow
    export async function fetchItems(client: ApiClient, libraryId: string): Promise<LibraryItem[]>
    export async function readLocalModel(cwd: string): Promise<{ tree: FileTree; model: ProjectModel }>
    export const DICTIONARY_FILES: readonly string[]
    ```

- [ ] **Step 1: 실패하는 테스트**

`config.test.ts` 에:

```ts
it('dictionaries 가 없는 옛 config 는 빈 구독으로 읽고, 빈 구독은 파일에 쓰지 않는다', async () => {
  await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: undefined }))
  expect((await readConfig(dir)).dictionaries).toEqual([])
  await writeConfig(dir, await readConfig(dir))
  expect(await readFile(join(dir, 'erdd.config.yaml'), 'utf8')).not.toContain('dictionaries')
})

it('dictionaries 가 배열이 아니거나 항목에 id·name 이 없으면 VALIDATION', async () => {
  await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: [{ id: 'L1' }] }))
  await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
})
```

(`TEST_CONFIG` 는 harness 에서, `stringifyYaml` 은 `yaml` 에서 import. 파일에 이미 쓰는 `dir` 관례를 따른다.)

`commands.test.ts`(pull 을 다루는 파일 — 없으면 새 `sync-down.test.ts`)에 리뷰 초점 1:

```ts
it('pull 은 config 를 서버 값으로 갱신하면서 구독(dictionaries)을 보존한다', async () => {
  await writeConfig(dir, { ...TEST_CONFIG, dictionaries: [{ id: 'L1', name: '표준' }] })
  const { client } = stubClient(createEmptyModel())
  expect(await pull({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
  expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
})
```

`dict-shared.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CliError } from '../output.js'
import { guardFeature, resolveLibrary, type LibraryRow } from './dict-shared.js'

const row = (id: string, name: string, scope: 'org' | 'global' = 'org'): LibraryRow =>
  ({ id, scope, orgId: scope === 'org' ? 'o1' : null, name, description: '', itemCount: 0, canWrite: false })

describe('resolveLibrary', () => {
  it('id 가 정확히 맞으면 그것을 고른다', () => {
    expect(resolveLibrary([row('L1', '표준'), row('L2', '표준')], 'L2').id).toBe('L2')
  })
  it('이름이 하나면 그것을 고른다', () => {
    expect(resolveLibrary([row('L1', '표준'), row('L2', '확장')], '확장').id).toBe('L2')
  })
  it('이름이 모호하면 후보를 보이며 USAGE', () => {
    expect(() => resolveLibrary([row('L1', '표준'), row('L2', '표준', 'global')], '표준'))
      .toThrow(expect.objectContaining({ code: 'USAGE', message: expect.stringContaining('L2') }))
  })
  it('없으면 NOT_FOUND 로 dict list 를 가리킨다', () => {
    expect(() => resolveLibrary([], '표준'))
      .toThrow(expect.objectContaining({ code: 'NOT_FOUND', message: expect.stringContaining('erdd dict list') }))
  })
})

describe('guardFeature', () => {
  it('세션 전용 거절(옛 서버)을 업그레이드 안내로 바꾼다', async () => {
    await expect(guardFeature(async () => {
      throw new CliError('UNAUTHORIZED', '이 작업은 액세스 토큰으로 할 수 없습니다')
    })).rejects.toMatchObject({ message: expect.stringContaining('서버를 업그레이드') })
  })
  it('프로시저가 없는 서버도 같은 안내다', async () => {
    await expect(guardFeature(async () => {
      throw new CliError('NOT_FOUND', 'No "query"-procedure on path "resource.items.list"')
    })).rejects.toMatchObject({ message: expect.stringContaining('서버를 업그레이드') })
  })
  it('그 밖의 오류는 그대로 올린다', async () => {
    await expect(guardFeature(async () => { throw new CliError('FORBIDDEN', '권한 없음') }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: '권한 없음' })
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm --filter @erdd/cli exec vitest run src/config.test.ts src/commands/dict-shared.test.ts src/commands/commands.test.ts` → FAIL.

- [ ] **Step 3: 구현 — `config.ts`**

```ts
export type DictionaryRef = { id: string; name: string }

export type ErddConfig = {
  // … 기존 필드 그대로
  /**
   * 구독한 공용 사전(`erdd dict pull` 이 인자 없이 받는 목록). 순서 = 처리 순서.
   * ⚠️ **config 를 다시 쓰는 모든 자리가 이 값을 보존해야 한다** — pull(`syncDown`)이 서버 값으로
   * config 를 새로 만들 때 빠뜨리면 pull 할 때마다 구독이 사라진다. 필수 필드로 둔 것이 그 가드다.
   */
  dictionaries: DictionaryRef[]
}
```

`readConfig` 의 반환 직전:

```ts
  const rawDicts = (parsed as Record<string, unknown>)['dictionaries']
  // 옛 config 에는 없다 — 누락만 빈 목록으로 읽는다. 잘못 적은 값은 삼키지 않는다.
  if (rawDicts !== undefined && (!Array.isArray(rawDicts) || !rawDicts.every(
    (d) => isRec(d) && typeof d['id'] === 'string' && typeof d['name'] === 'string'))) {
    throw new CliError('VALIDATION', `${CONFIG_FILE}의 dictionaries는 {id, name} 목록이어야 합니다`)
  }
  const dictionaries = ((rawDicts ?? []) as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name }))
```

반환 객체에 `dictionaries` 를 더한다. `writeConfig`:

```ts
export async function writeConfig(cwd: string, config: ErddConfig): Promise<void> {
  // 빈 구독은 쓰지 않는다 — 사전을 쓰지 않는 프로젝트의 config 에 빈 키가 생겨 diff 가 시끄러워진다.
  const { dictionaries, ...rest } = config
  const out = dictionaries.length > 0 ? { ...rest, dictionaries } : rest
  await writeFile(join(cwd, CONFIG_FILE), stringifyYaml(out), 'utf8')
}
```

- `sync-down.ts`: `writeConfig` 호출 전에 `const { dictionaries } = await readConfig(cwd)` 를 읽고
  리터럴에 `dictionaries` 를 넣는다(주석: `// 구독은 서버가 모르는 로컬 값이다 — 보존한다.`). `readConfig` import.
- `init.ts`: 두 `writeConfig` 리터럴에 `dictionaries: []`(새 연결 = 새 프로젝트라 구독을 잇지 않는다).
- `harness.ts`: `TEST_CONFIG` 에 `dictionaries: [] as DictionaryRef[]`.
- 타입 오류가 나는 나머지 writer(`local/router.ts`·`import.ts` 는 `...config` 스프레드라 그대로 통과한다)를
  typecheck 로 확인한다.

- [ ] **Step 4: 구현 — `dict-shared.ts`**

```ts
import {
  TOP_LEVEL_FILES, filesToModel,
  type FileTree, type LibraryItem, type ProjectModel,
} from '@erdd/core'
import { uuidv7 } from 'uuidv7'
import type { ApiClient } from '../client.js'
import { CONFIG_FILE, type Connection, type ErddConfig } from '../config.js'
import { CliError } from '../output.js'
import { readTree } from '../tree.js'

export type LibraryRow = {
  id: string; scope: 'global' | 'org'; orgId: string | null; name: string
  description: string; itemCount: number; canWrite: boolean
}

/**
 * 사전 동기화가 쓰는 파일. 그룹·테이블 파일은 재동기화가 건드리지 않으므로 쓰지 않는다 —
 * modelToFiles 가 다시 만든 테이블 파일을 쓰면 손으로 다듬은 YAML 이 이유 없이 정규화된다.
 */
export const DICTIONARY_FILES: readonly string[] = TOP_LEVEL_FILES.filter((p) => p !== 'erdd/groups.yaml')

export function requireDictConnection(config: ErddConfig): Connection {
  if (config.serverUrl === null || config.projectId === null) {
    throw new CliError(
      'NO_CONFIG',
      `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 (${CONFIG_FILE})`,
    )
  }
  return { serverUrl: config.serverUrl, projectId: config.projectId }
}

/**
 * 새로 토큰에 연 프로시저를 옛 서버에 부르면 둘 중 하나로 떨어진다 — 세션 전용 거절(401)이거나
 * 프로시저 부재(404). 둘 다 사용자가 고칠 수 있는 것은 서버 업그레이드뿐이라 그렇게 말한다.
 * 토큰 자체가 틀린 401 은 문구가 달라 여기 걸리지 않는다.
 */
export async function guardFeature<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (err instanceof CliError && (
      (err.code === 'UNAUTHORIZED' && err.message.includes('액세스 토큰으로 할 수 없습니다'))
      || (err.code === 'NOT_FOUND' && /procedure on path/i.test(err.message)))) {
      throw new CliError(err.code, '서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요')
    }
    throw err
  }
}

export function listLibraries(client: ApiClient, projectId: string): Promise<LibraryRow[]> {
  return guardFeature(() => client.query<LibraryRow[]>('resource.library.listForProject', { projectId }))
}

/** id 순으로 정렬해 넘긴다 — planResync 의 순회 순서가 결과를 흔들지 않게(결정성). */
export async function fetchItems(client: ApiClient, libraryId: string): Promise<LibraryItem[]> {
  const items = await guardFeature(() => client.query<LibraryItem[]>('resource.items.list', { libraryId }))
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

export function resolveLibrary(rows: readonly LibraryRow[], ref: string): LibraryRow {
  const byId = rows.find((r) => r.id === ref)
  if (byId !== undefined) return byId
  const byName = rows.filter((r) => r.name === ref)
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new CliError('USAGE', [
      `이름이 ${ref}인 라이브러리가 여럿입니다 — id로 지정하세요:`,
      ...byName.map((r) => `  ${r.id}  ${r.scope === 'global' ? '전역' : '조직'}  ${r.name}`),
    ].join('\n'))
  }
  throw new CliError('NOT_FOUND', `라이브러리 ${ref}을(를) 찾지 못했습니다 — erdd dict list 로 확인하세요`)
}

/**
 * 로컬 파일 모델. id 없는 항목(사람이 직접 추가한 것)에는 **실제 uuid** 를 준다 — 임시 id(`new:…`)
 * 로 조립하면 사전 파일을 다시 쓸 때 그 임시 id 가 파일에 새어 나간다.
 */
export async function readLocalModel(cwd: string): Promise<{ tree: FileTree; model: ProjectModel }> {
  const tree = await readTree(cwd)
  const result = filesToModel(tree, { newId: uuidv7 })
  if (!result.ok) {
    throw new CliError('VALIDATION', [
      `파일 오류 ${result.issues.length}건 — erdd validate로 확인하세요`,
      ...result.issues.map((i) => `  ${i.path}: ${i.message}`),
    ].join('\n'))
  }
  return { tree, model: result.model }
}
```

- [ ] **Step 5: 구현 — `dict-list.ts` 와 배차**

```ts
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { listLibraries, requireDictConnection } from './dict-shared.js'

export function dictList(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const { projectId } = requireDictConnection(config)
    const rows = await listLibraries(await clientFor(ctx), projectId)
    const subscribed = new Set(config.dictionaries.map((d) => d.id))
    const human = rows.length === 0
      ? '이 프로젝트에서 보이는 라이브러리가 없습니다'
      : rows.map((r) => [
        subscribed.has(r.id) ? '*' : ' ',
        r.name,
        `— ${r.scope === 'global' ? '전역' : '조직'} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
      ].join(' ')).join('\n')
    emit(ctx.json, human, rows.map((r) => ({ ...r, subscribed: subscribed.has(r.id) })))
    return 0
  })
}
```

`main.ts` — USAGE 명령 목록에 `  dict <list|pull|push|requests>  공용 사전을 주고받는다` 를 더하고 배차:

```ts
    case 'dict': {
      const sub = argv[1]
      if (sub === 'list') return dictList(ctx)
      return usageError(json, `알 수 없는 dict 하위 명령: ${sub ?? '(없음)'} — list | pull | push | requests`)
    }
```

(`import { dictList } from './commands/dict-list.js'` 를 더한다. pull·push·requests 갈래는 Task 5·6 이
이 `case` 에 더한다.)

`dict list` 테스트를 `dict-shared.test.ts` 에 더한다 — 구독 표시와 `--json` 의 `subscribed`.
파일 상단 import 에 아래를 더한다.

```ts
import { afterEach, beforeEach, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { dictList } from './dict-list.js'
```

```ts
describe('dict list', () => {
  let dir: string
  let out: string[]
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erdd-dict-list-'))
    out = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('구독한 라이브러리를 표시한다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules },
      tableOptions: { ...TEST_CONFIG.tableOptions }, dictionaries: [{ id: 'L1', name: '표준' }],
    })
    const client: ApiClient = {
      query: (async (path: string) => {
        if (path === 'resource.library.listForProject') return [row('L1', '표준'), row('L2', '확장')]
        throw new Error(`unexpected ${path}`)
      }) as ApiClient['query'],
      mutate: (async () => { throw new Error('unexpected mutate') }) as ApiClient['mutate'],
    }
    expect(await dictList({ cwd: dir, json: true, yes: false, strict: false, client })).toBe(0)
    expect(JSON.parse(out.join(''))).toEqual([
      expect.objectContaining({ id: 'L1', subscribed: true }),
      expect.objectContaining({ id: 'L2', subscribed: false }),
    ])
  })
})
```

- [ ] **Step 6: 통과 확인** — Run: `pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck; echo "EXIT=$?"` → PASS, `EXIT=0`.

- [ ] **Step 7: 커밋**

```bash
F="packages/cli/src/config.ts packages/cli/src/config.test.ts packages/cli/src/commands/sync-down.ts \
packages/cli/src/commands/init.ts packages/cli/src/testing/harness.ts packages/cli/src/main.ts \
packages/cli/src/commands/dict-shared.ts packages/cli/src/commands/dict-shared.test.ts \
packages/cli/src/commands/dict-list.ts packages/cli/src/commands/commands.test.ts"
git add $F && git commit -m "feat(cli): 사전 구독 설정과 erdd dict list 를 더한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

### Task 5: `erdd dict pull`

**Files:**
- Create: `packages/cli/src/commands/dict-pull.ts`, `packages/cli/src/commands/dict-pull.test.ts`
- Modify: `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: Task 1 `ORIGINS_FILE`, Task 2 `adoptTargetOf`·`'adopt'`, Task 4 `dict-shared` 전부·`DictionaryRef`.
- Produces: `export type DictPullCtx = CommandCtx & { library?: string; adopt: boolean; conflicts?: 'theirs' | 'ours'; dryRun: boolean }`,
  `export function dictPull(ctx: DictPullCtx): Promise<number>`.

- [ ] **Step 1: 실패하는 테스트 — `dict-pull.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, modelToFiles, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { readConfig, writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { CliError } from '../output.js'
import { dictPull, type DictPullCtx } from './dict-pull.js'
import type { LibraryRow } from './dict-shared.js'

let dir: string
let out: string[]
let err: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-dict-pull-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules }, tableOptions: { ...TEST_CONFIG.tableOptions }, dictionaries: [] })
})
afterEach(() => vi.restoreAllMocks())

const LIB: LibraryRow = { id: 'L1', scope: 'org', orgId: 'o1', name: '표준', description: '', itemCount: 1, canWrite: false }
const word = (id: string, version: number, abbreviation: string): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName: '고객', abbreviation, englishName: null, description: null } })

function client(libs: LibraryRow[], items: Record<string, LibraryItem[]>): ApiClient {
  return {
    query: (async (path: string, input: { libraryId?: string }) => {
      if (path === 'resource.library.listForProject') return libs
      if (path === 'resource.items.list') return items[input.libraryId!] ?? []
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string) => { throw new Error(`unexpected mutate ${path}`) }) as ApiClient['mutate'],
  }
}
const ctx = (c: ApiClient, extra: Partial<DictPullCtx> = {}): DictPullCtx =>
  ({ cwd: dir, json: true, yes: true, strict: false, client: c, adopt: false, dryRun: false, ...extra })

async function seed(model: ProjectModel): Promise<void> {
  await writeTree(dir, modelToFiles(model).tree)
}
const localWord = (m: ProjectModel, id: string, abbreviation: string) => {
  m.words[id] = { id, logicalName: '고객', abbreviation, englishName: null, description: null, origin: null }
}

describe('dict pull', () => {
  it('신규 항목을 words.yaml·origins.yaml 에 쓰고 구독을 남긴다', async () => {
    await seed(createEmptyModel())
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: '표준' }))).toBe(0)
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { abbreviation: string }[] }).words).toEqual([expect.objectContaining({ abbreviation: 'CUST' })])
    expect((tree['erdd/origins.yaml'] as { origins: unknown[] }).origins).toEqual([expect.objectContaining({ library: 'L1', item: 'S1', version: 1 })])
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
  })

  it('이름 중복은 기본으로 건너뛰고 --adopt 면 출처만 붙인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    const c = client([LIB], { L1: [word('S1', 1, 'CUST')] })
    await dictPull(ctx(c, { library: 'L1' }))
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
    await dictPull(ctx(c, { adopt: true }))
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { id: string; abbreviation: string }[] }).words)
      .toEqual([expect.objectContaining({ id: 'w1', abbreviation: 'CSTMR' })])
    expect((tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins).toEqual([expect.objectContaining({ id: 'w1', item: 'S1' })])
  })

  it('충돌은 기본 보류(종료 0), --conflicts theirs 면 원본을 반영한다', async () => {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    // 로컬에서 약어를 고친다
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('CUST', 'CSTMR'))
    const v2 = client([LIB], { L1: [word('S1', 2, 'CUS')] })
    expect(await dictPull(ctx(v2))).toBe(0)
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CSTMR')
    expect(JSON.parse(out.at(-1)!).libraries[0].conflicts).toHaveLength(1)
    await dictPull(ctx(v2, { conflicts: 'theirs' }))
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CUS\n')
  })

  it('--dry-run 은 파일도 config 도 쓰지 않는다', async () => {
    await seed(createEmptyModel())
    const before = await readTree(dir)
    const cfgBefore = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1', dryRun: true }))).toBe(0)
    expect(await readTree(dir)).toEqual(before)
    expect(await readFile(join(dir, 'erdd.config.yaml'), 'utf8')).toBe(cfgBefore)
  })

  it('id 없는 로컬 단어가 있어도 파일에 new: 임시 id 를 쓰지 않는다', async () => {
    await seed(createEmptyModel())
    await writeFile(join(dir, 'erdd/words.yaml'), 'words:\n  - logicalName: 주문\n    abbreviation: ORD\n')
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    const raw = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    expect(raw).not.toContain('new:')
    expect(raw).toContain('ORD')
  })

  it('사전과 무관한 테이블 파일은 바이트 그대로다', async () => {
    await seed(createEmptyModel())
    const handmade = 'name: MBR\nlogicalName: 회원\ncolumns:\n  - name: MBR_NO\n    pk: true\n    nullable: false\n    type: bigint\n'
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), handmade)
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toBe(handmade)
  })

  it('사라진 구독은 경고하고 건너뛰되 구독은 지우지 않는다', async () => {
    await seed(createEmptyModel())
    await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'GONE', name: '옛 사전' }, { id: 'L1', name: '표준' }] })
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] })))).toBe(0)
    expect(err.join('')).toContain('옛 사전')
    expect((await readConfig(dir)).dictionaries.map((d) => d.id)).toEqual(['GONE', 'L1'])
  })

  it('구독도 --library 도 없으면 USAGE', async () => {
    await seed(createEmptyModel())
    expect(await dictPull(ctx(client([LIB], {})))).toBe(2)
  })

  it('로컬 전용 config 면 연결 안내와 함께 실패한다', async () => {
    await writeConfig(dir, { ...(await readConfig(dir)), serverUrl: null, projectId: null })
    expect(await dictPull(ctx(client([LIB], {}), { library: 'L1' }))).toBe(1)
    expect(out.join('')).toContain('--create')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm --filter @erdd/cli exec vitest run src/commands/dict-pull.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현 — `dict-pull.ts`**

```ts
import { uuidv7 } from 'uuidv7'
import {
  RESOURCE_KIND_LABEL, adoptTargetOf, applyResyncPlan, modelToFiles, planResync,
  type FileTree, type ProjectModel, type ResyncDecision, type ResyncPlan,
} from '@erdd/core'
import { readConfig, writeConfig, type DictionaryRef } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { writeTreeChanges } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'
import {
  DICTIONARY_FILES, fetchItems, listLibraries, readLocalModel, requireDictConnection, resolveLibrary,
} from './dict-shared.js'

export type DictPullCtx = CommandCtx & {
  library?: string
  adopt: boolean
  conflicts?: 'theirs' | 'ours'
  dryRun: boolean
}

type LibraryReport = {
  id: string
  name: string
  missing: boolean
  added: number
  autoUpdated: number
  adopted: number
  /** 이름 중복인데 연결하지 않은(또는 연결할 대상이 없는) 항목 */
  nameClashSkipped: { kind: string; name: string }[]
  conflicts: { kind: string; name: string; fields: string[]; decision: ResyncDecision }[]
  kept: number
}

/** 웹 「가져오기」의 기본 선택과 같다 — 설계 3.2. */
function decide(model: ProjectModel, plan: ResyncPlan, ctx: DictPullCtx): Record<string, ResyncDecision> {
  const out: Record<string, ResyncDecision> = {}
  for (const e of plan.entries) {
    if (e.status === 'added') {
      out[e.sourceId] = !e.nameClash ? 'apply'
        : ctx.adopt && adoptTargetOf(model, e) !== null ? 'adopt' : 'defer'
    } else if (e.status === 'auto-update') out[e.sourceId] = 'apply'
    else out[e.sourceId] = ctx.conflicts === 'theirs' ? 'apply' : ctx.conflicts === 'ours' ? 'keep' : 'defer'
  }
  return out
}

function pick(tree: FileTree): FileTree {
  return Object.fromEntries(DICTIONARY_FILES.filter((p) => p in tree).map((p) => [p, tree[p]]))
}

function render(reports: LibraryReport[], files: { written: string[]; deleted: string[] }, dryRun: boolean): string {
  const lines: string[] = []
  for (const r of reports) {
    if (r.missing) { lines.push(`${r.name} — 찾을 수 없어 건너뛰었습니다`); continue }
    lines.push(`${r.name}`)
    lines.push(`  추가 ${r.added} · 자동 갱신 ${r.autoUpdated} · 연결 ${r.adopted} · 유지 ${r.kept}`)
    const deferred = r.conflicts.filter((c) => c.decision === 'defer')
    if (r.conflicts.length > 0) {
      lines.push(`  충돌 ${r.conflicts.length}${deferred.length > 0 ? ' — 보류(--conflicts theirs|ours 로 정리)' : ''}:`)
      for (const c of r.conflicts) lines.push(`    ${c.kind} ${c.name}  (${c.fields.join(', ')})`)
    }
    if (r.nameClashSkipped.length > 0) {
      lines.push(`  이름 중복 ${r.nameClashSkipped.length} — 건너뜀 (--adopt 로 연결)`)
    }
  }
  const changed = [...files.written, ...files.deleted]
  lines.push(dryRun ? '미리보기입니다 — 파일을 쓰지 않았습니다'
    : changed.length === 0 ? '바뀐 파일이 없습니다' : `반영했습니다 — ${changed.join(', ')}`)
  return lines.join('\n')
}

export function dictPull(ctx: DictPullCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const { projectId } = requireDictConnection(config)
    const client = await clientFor(ctx)
    const { tree, model: initial } = await readLocalModel(ctx.cwd)
    const libraries = await listLibraries(client, projectId)

    let subscriptions: DictionaryRef[] = config.dictionaries
    let targets: DictionaryRef[]
    if (ctx.library !== undefined) {
      const lib = resolveLibrary(libraries, ctx.library)
      if (!subscriptions.some((s) => s.id === lib.id)) subscriptions = [...subscriptions, { id: lib.id, name: lib.name }]
      targets = [{ id: lib.id, name: lib.name }]
    } else {
      if (subscriptions.length === 0) {
        throw new CliError('USAGE', '구독한 라이브러리가 없습니다 — --library <이름|id> 로 지정하세요 (목록: erdd dict list)')
      }
      targets = subscriptions
    }

    let model = initial
    const reports: LibraryReport[] = []
    for (const target of targets) {
      const lib = libraries.find((l) => l.id === target.id)
      if (lib === undefined) {
        note(`경고: 라이브러리 ${target.name}(${target.id})을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`)
        reports.push({ id: target.id, name: target.name, missing: true, added: 0, autoUpdated: 0, adopted: 0, nameClashSkipped: [], conflicts: [], kept: 0 })
        continue
      }
      const plan = planResync(model, lib.id, await fetchItems(client, lib.id))
      const decisions = decide(model, plan, ctx)
      const label = (k: keyof typeof RESOURCE_KIND_LABEL) => RESOURCE_KIND_LABEL[k]
      reports.push({
        id: lib.id, name: lib.name, missing: false,
        added: plan.entries.filter((e) => decisions[e.sourceId] === 'apply' && e.status === 'added').length,
        autoUpdated: plan.entries.filter((e) => e.status === 'auto-update').length,
        adopted: plan.entries.filter((e) => decisions[e.sourceId] === 'adopt').length,
        nameClashSkipped: plan.entries
          .filter((e) => e.status === 'added' && e.nameClash && decisions[e.sourceId] === 'defer')
          .map((e) => ({ kind: label(e.kind), name: e.name })),
        conflicts: plan.entries.filter((e) => e.status === 'conflict')
          .map((e) => ({ kind: label(e.kind), name: e.name, fields: e.changedFields, decision: decisions[e.sourceId]! })),
        kept: plan.keptSynced,
      })
      model = applyResyncPlan(model, plan, decisions, uuidv7)
    }

    // 표시 이름은 서버를 따른다(개명 추종). 사라진 구독은 그대로 둔다 — 권한이 일시적으로 없을 수 있다.
    subscriptions = subscriptions.map((s) => {
      const lib = libraries.find((l) => l.id === s.id)
      return lib === undefined ? s : { id: s.id, name: lib.name }
    })

    let files = { written: [] as string[], deleted: [] as string[] }
    if (!ctx.dryRun) {
      files = await writeTreeChanges(ctx.cwd, pick(tree), pick(modelToFiles(model).tree))
      if (JSON.stringify(subscriptions) !== JSON.stringify(config.dictionaries)) {
        await writeConfig(ctx.cwd, { ...config, dictionaries: subscriptions })
      }
    }
    emit(ctx.json, render(reports, files, ctx.dryRun), { libraries: reports, ...files, dryRun: ctx.dryRun })
    return 0
  })
}
```

⚠️ `pick(tree)` 의 `tree` 는 **디스크에서 읽은 원본**이다. id 없는 로컬 항목에 새 id 를 준 결과는
`modelToFiles(model)` 쪽에만 있으므로 `words.yaml` 이 「변경」으로 잡혀 id 가 기록된다 — 의도된 동작이다.

`main.ts` 의 `dict` case 에:

```ts
      if (sub === 'pull') {
        const conflicts = enumFlag<'theirs' | 'ours'>(argv, 'conflicts', ['theirs', 'ours'] as const)
        if (!conflicts.ok) return usageError(json, conflicts.message)
        if (argv.includes('--library') && flagValue(argv, 'library') === undefined) {
          return usageError(json, '--library 값이 올바르지 않습니다: (값 없음)')
        }
        return dictPull({
          ...ctx, library: flagValue(argv, 'library'), adopt: argv.includes('--adopt'),
          conflicts: conflicts.value, dryRun: argv.includes('--dry-run'),
        })
      }
```

USAGE 옵션 목록에 `--library <이름|id>`·`--adopt`·`--conflicts <theirs|ours>` 를 더하고 `--dry-run` 설명을
「import·dict pull 전용」으로 고친다.

- [ ] **Step 4: 통과 확인** — Run: `pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck; echo "EXIT=$?"` → PASS.

- [ ] **Step 5: 커밋**

```bash
F="packages/cli/src/commands/dict-pull.ts packages/cli/src/commands/dict-pull.test.ts packages/cli/src/main.ts"
git add $F && git commit -m "feat(cli): erdd dict pull — 공용 사전을 로컬 파일로 재동기화한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

### Task 6: `erdd dict push` · `erdd dict requests`

**Files:**
- Create: `packages/cli/src/commands/dict-push.ts`, `packages/cli/src/commands/dict-push.test.ts`,
  `packages/cli/src/commands/dict-requests.ts`
- Modify: `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: Task 3 서버 프로시저, Task 4 `dict-shared`, `syncDown`(sync-down.ts), `readBase`·`diffTrees`·`readTree`.
- Produces:
  `export type DictPushCtx = CommandCtx & { library?: string; kinds?: ResourceKind[]; names?: string[]; includeNameMatch: boolean; message?: string }`,
  `dictPush(ctx)`, `export type DictRequestsCtx = CommandCtx & { status?: 'pending' | 'resolved' | 'rejected' | 'cancelled' }`, `dictRequests(ctx)`.

- [ ] **Step 1: 실패하는 테스트 — `dict-push.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { TEST_CONFIG, seedPulled } from '../testing/harness.js'
import { readTree } from '../tree.js'
import { dictPush, type DictPushCtx } from './dict-push.js'
import type { LibraryRow } from './dict-shared.js'

const W1 = '018f6b0e-0000-7000-8000-0000000000a1'
const W2 = '018f6b0e-0000-7000-8000-0000000000a2'
let dir: string
let out: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-dict-push-'))
  out = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules }, tableOptions: { ...TEST_CONFIG.tableOptions }, dictionaries: [] })
})
afterEach(() => vi.restoreAllMocks())

function serverModel(): ProjectModel {
  const m = createEmptyModel()
  m.words[W1] = { id: W1, logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null, origin: null }
  m.words[W2] = { id: W2, logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null, origin: null }
  return m
}
const lib = (canWrite: boolean): LibraryRow =>
  ({ id: 'L1', scope: 'org', orgId: 'o1', name: '표준', description: '', itemCount: 1, canWrite })
// 라이브러리에 「고객」이 이미 있다 → W2 는 name-match, W1 은 new
const ITEMS: LibraryItem[] = [{ id: 'S2', kind: 'word', version: 1, payload: { logicalName: '고객', abbreviation: 'CST', englishName: null, description: null } }]

function client(server: ProjectModel, canWrite: boolean, promoteResult = { seq: 2, inserted: 1, updated: 0, skipped: [] as unknown[] }) {
  const calls: { path: string; input: unknown }[] = []
  let current = server
  const c: ApiClient = {
    query: (async (path: string) => {
      if (path === 'model.get') return { model: current, seq: 1 }
      if (path === 'project.get') return { name: 'P', dialects: ['postgresql'], namingRules: TEST_CONFIG.namingRules }
      if (path === 'resource.library.listForProject') return [lib(canWrite)]
      if (path === 'resource.items.list') return ITEMS
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string, input: unknown) => {
      calls.push({ path, input })
      if (path === 'resource.promote') {
        current = structuredClone(server)
        current.words[W1]!.origin = { libraryId: 'L1', sourceId: 'S9', sourceVersion: 1, base: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } }
        return promoteResult
      }
      if (path === 'promotion.create') return { id: 'R1', requested: 1, dropped: [] }
      throw new Error(`unexpected mutate ${path}`)
    }) as ApiClient['mutate'],
  }
  return { client: c, calls }
}
const ctx = (c: ApiClient, extra: Partial<DictPushCtx> = {}): DictPushCtx =>
  ({ cwd: dir, json: true, yes: true, strict: false, client: c, library: '표준', includeNameMatch: false, ...extra })

describe('dict push', () => {
  it('push 하지 않은 로컬 변경이 있으면 서버를 부르지 않고 거절한다', async () => {
    await seedPulled(dir, serverModel())
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('ORD', 'ORDR'))
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(1)
    expect(out.join('')).toContain('erdd push')
    expect(calls).toEqual([])
  })

  it('쓰기 가능하면 resource.promote 에 expected 값을 싣고, 성공 뒤 origins.yaml 을 받는다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(0)
    expect(calls).toEqual([{ path: 'resource.promote', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1',
      entries: [{ entityId: W1, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    } }])
    expect(await readTree(dir)).toHaveProperty('erdd/origins.yaml')
  })

  it('쓰기 불가면 promotion.create 에 entityIds 와 메모를 보내고 파일은 그대로다', async () => {
    await seedPulled(dir, serverModel())
    const before = await readTree(dir)
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { message: '주문 단어' }))).toBe(0)
    expect(calls).toEqual([{ path: 'promotion.create', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1', entityIds: [W1], note: '주문 단어',
    } }])
    expect(await readTree(dir)).toEqual(before)
  })

  it('동명 발견은 기본 제외, --include-name-match 면 포함한다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), false)
    await dictPush(ctx(c, { includeNameMatch: true }))
    expect((calls[0]!.input as { entityIds: string[] }).entityIds.sort()).toEqual([W1, W2].sort())
  })

  it('서버가 전부 건너뛰면 종료 코드 1 이다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c } = client(serverModel(), true, { seq: 1, inserted: 0, updated: 0, skipped: [{ entityId: W1, reason: 'plan-changed' }] })
    expect(await dictPush(ctx(c))).toBe(1)
  })

  it('--json 에서 --yes 가 없으면 확인이 필요하다며 멈춘다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { yes: false }))).toBe(1)
    expect(out.join('')).toContain('--yes')
    expect(calls).toEqual([])
  })

  it('올릴 항목이 없으면 서버에 쓰지 않고 0 이다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { kinds: ['domain'] }))).toBe(0)
    expect(calls).toEqual([])
  })

  it('--library 가 없으면 USAGE', async () => {
    await seedPulled(dir, serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { library: undefined }))).toBe(2)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm --filter @erdd/cli exec vitest run src/commands/dict-push.test.ts` → FAIL.

- [ ] **Step 3: 구현 — `dict-push.ts`**

```ts
import {
  MAX_OPS_PER_MUTATION, RESOURCE_KIND_LABEL, planPromote,
  type ProjectModel, type PromoteEntry, type ResourceKind,
} from '@erdd/core'
import { readBase, readConfig } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { diffTrees, readTree } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { fetchItems, guardFeature, listLibraries, requireDictConnection, resolveLibrary } from './dict-shared.js'
import { syncDown } from './sync-down.js'

export type DictPushCtx = CommandCtx & {
  library?: string
  kinds?: ResourceKind[]
  names?: string[]
  includeNameMatch: boolean
  message?: string
}

type PromoteResult = { seq: number; inserted: number; updated: number; skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[] }

const STATUS_MARK = { new: '+', update: '~', 'name-match': '=' } as const

/**
 * 승격 대상은 **서버 프로젝트의 엔티티**다. 로컬에서 고친 값이 서버에 없으면 보던 값이 아니라
 * 보관함의 옛 값이 라이브러리에 올라간다 — 그래서 로컬 변경이 없을 것을 요구한다(설계 4.1).
 * 자동 push 를 하지 않는 이유: push 의 삭제 확인·충돌 중단이 끌려와 두 명령의 실패 모드가 섞인다.
 */
async function requireClean(cwd: string): Promise<void> {
  const base = await readBase(cwd)
  if (base === null) throw new CliError('VALIDATION', '기준 시점이 없습니다. 먼저 erdd pull을 실행하세요')
  const d = diffTrees(base, await readTree(cwd))
  if (d.added.length + d.modified.length + d.deleted.length > 0) {
    throw new CliError('VALIDATION', 'push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요')
  }
}

export function dictPush(ctx: DictPushCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.library === undefined) throw new CliError('USAGE', '--library <이름|id> 가 필요합니다')
    const config = await readConfig(ctx.cwd)
    const connection = requireDictConnection(config)
    await requireClean(ctx.cwd)
    const client = await clientFor(ctx)
    const lib = resolveLibrary(await listLibraries(client, connection.projectId), ctx.library)
    const { model } = await client.query<{ model: ProjectModel; seq: number }>('model.get', { projectId: connection.projectId })
    const plan = planPromote(model, lib.id, await fetchItems(client, lib.id))

    const nameMatches = plan.entries.filter((e) => e.status === 'name-match')
    const selected = plan.entries.filter((e: PromoteEntry) =>
      (e.status !== 'name-match' || ctx.includeNameMatch)
      && (ctx.kinds === undefined || ctx.kinds.includes(e.kind))
      && (ctx.names === undefined || ctx.names.includes(e.name)))

    if (selected.length === 0) {
      emit(ctx.json, '올릴 항목이 없습니다', { libraryId: lib.id, selected: 0 })
      return 0
    }
    if (selected.length > MAX_OPS_PER_MUTATION) {
      throw new CliError('VALIDATION', `항목이 ${selected.length}건으로 한 번에 올릴 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다 — --kind·--name 으로 나누세요`)
    }

    const count = (s: PromoteEntry['status']) => selected.filter((e) => e.status === s).length
    note(`신규 추가 ${count('new')} · 원본 갱신 ${count('update')} · 동명 발견 ${ctx.includeNameMatch ? count('name-match') : `${nameMatches.length}(제외 — --include-name-match)`}`)
    for (const e of selected) note(`  ${STATUS_MARK[e.status]} ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}`)
    if (!ctx.yes) {
      if (ctx.confirm === undefined) {
        throw new CliError('CANCELLED', '확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요')
      }
      if (!await ctx.confirm('계속할까요?')) throw new CliError('CANCELLED', '사용자가 취소했습니다')
    }

    if (!lib.canWrite) {
      const r = await guardFeature(() => client.mutate<{ id: string; requested: number; dropped: string[] }>(
        'promotion.create',
        { projectId: connection.projectId, libraryId: lib.id, entityIds: selected.map((e) => e.entityId), note: ctx.message ?? '' },
      ))
      emit(ctx.json, `승격 요청을 만들었습니다 (${r.requested}건). 조직 관리자가 웹에서 승인하면 반영됩니다`, { mode: 'request', ...r })
      return 0
    }

    const r = await guardFeature(() => client.mutate<PromoteResult>('resource.promote', {
      projectId: connection.projectId, libraryId: lib.id,
      entries: selected.map((e) => ({
        entityId: e.entityId, expectedStatus: e.status,
        expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
      })),
    }))
    const skippedLines = r.skipped.map((s) => {
      const e = selected.find((x) => x.entityId === s.entityId)
      return `  건너뜀 ${e === undefined ? s.entityId : `${RESOURCE_KIND_LABEL[e.kind]} ${e.name}`} (${s.reason === 'missing' ? '대상이 사라짐' : '그 사이 계획이 바뀜'})`
    })
    if (r.inserted + r.updated === 0) {
      emit(ctx.json, ['승격된 항목이 없습니다 — 전부 건너뛰었습니다', ...skippedLines].join('\n'), { mode: 'promote', ...r })
      return 1
    }
    // 서버가 엔티티 origin 을 바꿨다 — 받아 온다. requireClean 을 지났으므로 덮을 로컬 변경이 없다.
    await syncDown(ctx.cwd, connection, client)
    emit(ctx.json, [`승격했습니다 — 신규 ${r.inserted} · 갱신 ${r.updated}`, ...skippedLines].join('\n'), { mode: 'promote', ...r })
    return 0
  })
}
```

- [ ] **Step 4: 구현 — `dict-requests.ts`**

```ts
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { guardFeature, listLibraries, requireDictConnection } from './dict-shared.js'

export type RequestStatus = 'pending' | 'resolved' | 'rejected' | 'cancelled'
export type DictRequestsCtx = CommandCtx & { status?: RequestStatus }

type Row = {
  id: string; libraryId: string; entityIds: string[]; note: string; status: RequestStatus
  createdAt: string; resolvedAt: string | null; resolutionNote: string | null
  approvedEntityIds: string[] | null; requesterName: string
}
const STATUS_LABEL: Record<RequestStatus, string> = { pending: '대기', resolved: '승인', rejected: '반려', cancelled: '취소' }

export function dictRequests(ctx: DictRequestsCtx): Promise<number> {
  return run(ctx, async () => {
    const { projectId } = requireDictConnection(await readConfig(ctx.cwd))
    const client = await clientFor(ctx)
    const rows = await guardFeature(() => client.query<Row[]>('promotion.listForProject', { projectId, status: ctx.status }))
    const names = new Map((await listLibraries(client, projectId)).map((l) => [l.id, l.name]))
    const human = rows.length === 0 ? '승격 요청이 없습니다' : rows.map((r) => [
      `[${STATUS_LABEL[r.status]}] ${String(r.createdAt).slice(0, 10)} ${names.get(r.libraryId) ?? r.libraryId} — ${r.entityIds.length}건 · ${r.requesterName}`,
      ...(r.note !== '' ? [`  메모: ${r.note}`] : []),
      ...(r.resolutionNote ? [`  처리 메모: ${r.resolutionNote}`] : []),
    ].join('\n')).join('\n')
    emit(ctx.json, human, rows)
    return 0
  })
}
```

`dict-push.test.ts` 에 `dictRequests` 테스트 하나를 더한다 — 반려 행의 `처리 메모` 가 사람용 출력에 나오는지
(`json: false` 로 부르고 stdout 에 `처리 메모: 중복` 포함).

- [ ] **Step 5: `main.ts` 배차**

```ts
      if (sub === 'push') {
        const kinds = argv.includes('--kind') ? (flagValue(argv, 'kind') ?? '').split(',').filter(Boolean) : undefined
        if (kinds !== undefined && (kinds.length === 0 || !kinds.every((k) => (RESOURCE_KINDS as readonly string[]).includes(k)))) {
          return usageError(json, `--kind 값이 올바르지 않습니다: ${flagValue(argv, 'kind') ?? '(값 없음)'} — ${RESOURCE_KINDS.join(' | ')}`)
        }
        const names = argv.flatMap((a, i) => (a === '--name' && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? [argv[i + 1]!] : []))
        return dictPush({
          ...ctx, library: flagValue(argv, 'library'), kinds: kinds as ResourceKind[] | undefined,
          names: names.length > 0 ? names : undefined, includeNameMatch: argv.includes('--include-name-match'),
          message: flagValue(argv, 'message') ?? shortFlagValue(argv, 'm'),
        })
      }
      if (sub === 'requests') {
        const status = enumFlag<RequestStatus>(argv, 'status', ['pending', 'resolved', 'rejected', 'cancelled'] as const)
        if (!status.ok) return usageError(json, status.message)
        return dictRequests({ ...ctx, status: status.value })
      }
```

`main.ts` import 에 `RESOURCE_KINDS`·`type ResourceKind`(@erdd/core), `dictPush`(./commands/dict-push.js),
`dictRequests`·`type RequestStatus`(./commands/dict-requests.js)를 더한다. Task 5 의 `dictPull` import 도 같은 자리다.

USAGE 에 `--kind <종류,…>`·`--name <이름>`(반복)·`--include-name-match`·`--status <상태>` 를 더하고
`-m` 설명을 「push·dict push 의 요약·메모」로 고친다.

- [ ] **Step 6: 통과 확인** — Run: `pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck; echo "EXIT=$?"` → PASS.

- [ ] **Step 7: 커밋**

```bash
F="packages/cli/src/commands/dict-push.ts packages/cli/src/commands/dict-push.test.ts packages/cli/src/commands/dict-requests.ts packages/cli/src/main.ts"
git add $F && git commit -m "feat(cli): erdd dict push·requests — 기존 승격 엔진으로 공용 사전에 올린다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

### Task 7: `erdd init --create` — 서버 프로젝트 생성·연결, 로컬 전용 이관

**Files:**
- Modify: `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/init.test.ts`, `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: Task 3 `project.create`(토큰, `namingRules`·`tableOptions`), `writeBase`·`writeSync`, core `createEmptyModel`·`modelToFiles`.
- Produces: `InitCtx` += `create?: boolean; org?: string; name?: string`.

- [ ] **Step 1: 실패하는 테스트 — `init.test.ts` 에 추가**

```ts
describe('init --create', () => {
  function createClient(opts: { forbid?: boolean } = {}) {
    const calls: { path: string; input: unknown }[] = []
    const c: ApiClient = {
      query: vi.fn(async (path: string) => {
        if (path === 'auth.me') return { id: 'u1', email: 'u1@test.dev', name: '사용자1', role: 'user' }
        if (path === 'org.list') return [{ id: '018f6b0e-0000-7000-8000-00000000000a', name: '플랫폼팀', role: 'owner' }]
        throw new Error(`unexpected ${path}`)
      }) as ApiClient['query'],
      mutate: vi.fn(async (path: string, input: unknown) => {
        calls.push({ path, input })
        if (path !== 'project.create') throw new Error(`unexpected mutate ${path}`)
        if (opts.forbid) throw new CliError('FORBIDDEN', '프로젝트 생성 권한이 없습니다')
        return { id: '018f6b0e-0000-7000-8000-0000000000f1', name: (input as { name: string }).name }
      }) as ApiClient['mutate'],
    }
    return { client: c, calls }
  }
  const base = { json: true, yes: true, strict: false, serverUrl: 'https://erdd.example.com', token: 'erdd_pat_x', create: true, org: '플랫폼팀', name: '주문시스템' }

  it('새 디렉터리: 프로젝트를 만들고 빈 모델을 기준선으로 연결한다', async () => {
    const { client, calls } = createClient()
    expect(await init({ ...base, cwd: dir, client, dialect: 'mysql' })).toBe(0)
    expect(calls[0]).toMatchObject({ path: 'project.create', input: { orgId: '018f6b0e-0000-7000-8000-00000000000a', name: '주문시스템', dialects: ['mysql'] } })
    expect((await readConfig(dir)).projectId).toBe('018f6b0e-0000-7000-8000-0000000000f1')
    const baseTree = JSON.parse(await readFile(join(dir, '.erdd/base.json'), 'utf8'))
    expect(baseTree).toEqual(modelToFiles(createEmptyModel()).tree)
    expect(JSON.parse(await readFile(join(dir, '.erdd/sync.json'), 'utf8'))).toMatchObject({ revisionSeq: 0 })
  })

  it('로컬 전용 프로젝트를 이관한다 — erdd/ 는 그대로, config 의 규칙을 생성값으로 보낸다', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true, dialect: 'oracle', namingCase: 'lower_snake' })
    await mkdir(join(dir, 'erdd'), { recursive: true })
    await writeFile(join(dir, 'erdd/words.yaml'), 'words:\n  - logicalName: 주문\n    abbreviation: ORD\n')
    const before = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    const { client, calls } = createClient()
    expect(await init({ ...base, cwd: dir, client })).toBe(0)
    expect(calls[0]!.input).toMatchObject({ dialects: ['oracle'], namingRules: expect.objectContaining({ case: 'lower_snake' }) })
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toBe(before)
    const cfg = await readConfig(dir)
    expect(cfg).toMatchObject({ projectId: '018f6b0e-0000-7000-8000-0000000000f1', dialects: ['oracle'] })
  })

  it('이관은 확인을 받는다 — 비대화형에 --yes 가 없으면 멈춘다', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true })
    const { client, calls } = createClient()
    expect(await init({ ...base, yes: false, cwd: dir, client })).toBe(1)
    expect(calls).toEqual([])
  })

  it('이관에 --dialect·--case 를 주면 USAGE', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true })
    const { client } = createClient()
    expect(await init({ ...base, cwd: dir, client, dialect: 'mysql' })).toBe(2)
  })

  it('이미 연결된 config 면 거절한다', async () => {
    const { client } = createClient()
    await init({ ...base, cwd: dir, client })
    expect(await init({ ...base, cwd: dir, client })).toBe(1)
    expect(out.join('')).toContain('--project')
  })

  it('생성 권한이 없으면 관리자에게 요청하라고 안내한다', async () => {
    const { client } = createClient({ forbid: true })
    expect(await init({ ...base, cwd: dir, client })).toBe(1)
    expect(out.join('')).toContain('--project <id>')
  })
})
```

import 에 `mkdir`·`writeFile`(node:fs/promises), `createEmptyModel`·`modelToFiles`(@erdd/core) 를 더한다.

`main.test.ts` 에: `main(['init', '--create', '--project', 'p1'], dir)` → `2`,
`main(['init', '--create', '--local'], dir)` → `2`.

- [ ] **Step 2: 실패 확인** — Run: `pnpm --filter @erdd/cli exec vitest run src/commands/init.test.ts src/main.test.ts` → FAIL.

- [ ] **Step 3: 구현 — `init.ts`**

`InitCtx` 에:

```ts
  /** --create: 서버에 프로젝트를 만들고 연결한다. 로컬 전용 config 가 있으면 그것을 이관한다. */
  create?: boolean
  org?: string
  name?: string
```

`init` 본문의 `configExists && ctx.local` 검사 **다음**, 일반 덮어쓰기 확인 **앞**에:

```ts
    if (ctx.create === true) return createAndConnect(ctx, configExists)
```

새 함수(같은 파일):

```ts
/**
 * 서버에 빈 프로젝트를 만들고 연결한다. 로컬 전용 config 가 있으면 그 규칙으로 만들고 `erdd/` 는
 * 건드리지 않는다 — 기준선을 **빈 모델**로 두므로 다음 `erdd push` 가 로컬 스키마 전부를 「추가」로 올린다.
 * `pull` 로 빈 서버 상태를 받아 덮은 뒤 되얹던 수동 절차를 대체한다.
 */
async function createAndConnect(ctx: InitCtx, configExists: boolean): Promise<number> {
  const existing = configExists ? await readConfig(ctx.cwd) : null
  if (existing !== null && existing.projectId !== null) {
    throw new CliError('VALIDATION', '이미 서버 프로젝트에 연결돼 있습니다 — 다른 프로젝트로 바꾸려면 erdd init --project <id> --yes')
  }
  if (existing !== null && (ctx.dialect !== undefined || ctx.namingCase !== undefined)) {
    throw new CliError('USAGE', `로컬 프로젝트를 이관할 때는 ${CONFIG_FILE}의 방언·명명 규칙을 씁니다 — --dialect·--case를 빼세요`)
  }
  const name = ctx.name ?? await ask(ctx, '서버에 만들 프로젝트 이름을 입력하세요')
  if (existing !== null && !ctx.yes) {
    const ok = ctx.confirm === undefined ? false : await ctx.confirm(`이 로컬 프로젝트를 서버 프로젝트 "${name}"로 연결합니다. 계속할까요?`)
    if (!ok) {
      throw new CliError('CANCELLED', ctx.confirm === undefined
        ? '확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요' : '사용자가 취소했습니다')
    }
  }

  const serverUrl = ctx.serverUrl ?? await ask(ctx, '서버 URL을 입력하세요')
  const token = ctx.token ?? await ask(ctx, '액세스 토큰을 입력하세요')
  const client: ApiClient = ctx.client ?? createClient(serverUrl, token)
  await client.query('auth.me', {})

  const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
  let orgId: string
  if (ctx.org !== undefined) {
    const hit = orgs.filter((o) => o.id === ctx.org || o.name === ctx.org)
    if (hit.length !== 1) {
      throw new CliError(hit.length === 0 ? 'NOT_FOUND' : 'USAGE',
        hit.length === 0 ? `조직 ${ctx.org}을(를) 찾지 못했습니다` : `이름이 ${ctx.org}인 조직이 여럿입니다 — id로 지정하세요`)
    }
    orgId = hit[0]!.id
  } else {
    if (ctx.choose === undefined) throw new CliError('USAGE', '--org를 주거나 대화형으로 실행하세요')
    orgId = await ctx.choose('조직을 고르세요', orgs.map((o) => ({ id: o.id, label: o.name })))
  }

  const settings = existing ?? {
    dialects: [ctx.dialect ?? 'postgresql'] as Dialect[],
    namingRules: { ...DEFAULT_NAMING_RULES, case: ctx.namingCase ?? DEFAULT_NAMING_RULES.case },
    tableOptions: { ...DEFAULT_TABLE_OPTIONS },
  }
  let project: { id: string; name: string }
  try {
    project = await client.mutate('project.create', {
      orgId, name, dialects: settings.dialects,
      namingRules: settings.namingRules, tableOptions: settings.tableOptions,
    })
  } catch (err) {
    if (err instanceof CliError && err.code === 'FORBIDDEN') {
      throw new CliError('FORBIDDEN', '프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 --project <id> 로 연결하세요')
    }
    throw err
  }

  await writeConfig(ctx.cwd, {
    serverUrl, projectId: project.id, dialects: settings.dialects,
    namingRules: settings.namingRules, tableOptions: settings.tableOptions,
    dictionaries: existing?.dictionaries ?? [],
  })
  await writeToken(ctx.cwd, token)
  await ensureGitignore(ctx.cwd)
  // 기준선 = 빈 서버 프로젝트. push 가 요구하는 base 를 pull 없이 세운다.
  await writeBase(ctx.cwd, modelToFiles(createEmptyModel()).tree)
  await writeSync(ctx.cwd, { revisionSeq: 0, pulledAt: new Date().toISOString() })

  emit(ctx.json, existing !== null
    ? `서버 프로젝트 ${project.name}을(를) 만들어 연결했습니다. erdd diff로 확인한 뒤 erdd push로 올리세요.`
    : `서버 프로젝트 ${project.name}을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.`,
  { configPath: CONFIG_FILE, projectId: project.id, projectName: project.name, migrated: existing !== null })
  return 0
}
```

import 에 `readConfig`·`writeBase`·`writeSync`(../config.js), `createEmptyModel`·`modelToFiles`(@erdd/core) 를 더한다.
⚠️ `createAndConnect` 의 USAGE 는 `run()` 이 종료 코드 2 로 바꾼다(`exitCodeFor`).

- [ ] **Step 4: `main.ts`**

- `init` case 에서 `const create = argv.includes('--create')`.
- `create && argv.includes('--project')` → `usageError(json, '--create와 --project는 함께 쓸 수 없습니다')`.
- `create && local` → `usageError(json, '--create와 --local은 함께 쓸 수 없습니다')`.
- 기존 가드 `!local && (dialect || case)` 를 `!local && !create && (…)` 로 바꾸고 문구를
  `'--dialect·--case는 init --local·--create 전용입니다 — 기존 프로젝트에 연결할 때는 서버 프로젝트 설정을 따릅니다'` 로.
- `init({ …, create, org: flagValue(argv, 'org'), name: flagValue(argv, 'name') })`.
- USAGE 에 `--create`·`--org <이름|id>`·`--name <이름>`(init --create 전용)을 더한다.

- [ ] **Step 5: 이관 뒤 push 계획이 전부 「추가」인지 확인하는 테스트** — `init.test.ts` 이관 테스트 끝에:

```ts
    const { buildPlan } = await import('../plan.js')
    const empty = { query: async (p: string) => (p === 'model.get' ? { model: createEmptyModel(), seq: 0 } : null), mutate: async () => null } as unknown as ApiClient
    const plan = await buildPlan(dir, { serverUrl: 'https://erdd.example.com', projectId: '018f6b0e-0000-7000-8000-0000000000f1' }, empty)
    expect(plan.conflicts).toEqual([])
    expect(plan.ops.length).toBeGreaterThan(0)
    expect(plan.ops.every((op) => op.action === 'create')).toBe(true)
```

- [ ] **Step 6: 통과 확인** — Run: `pnpm --filter @erdd/cli exec vitest run && pnpm -r typecheck; echo "EXIT=$?"` → PASS.

- [ ] **Step 7: 커밋**

```bash
F="packages/cli/src/commands/init.ts packages/cli/src/commands/init.test.ts packages/cli/src/main.ts packages/cli/src/main.test.ts"
git add $F && git commit -m "feat(cli): init --create — 서버 프로젝트를 만들어 연결하고 로컬 전용 프로젝트를 이관한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

### Task 8: 문서·스킬 문서 갱신과 실서버 스모크

**Files:**
- Modify: `docs/guides/cli.md`, `docs/guides/shared-resources.md`, `docs/guides/data-layer.md`,
  `docs/guides/release.md`, `docs/manual/cli-guide.md`, `docs/manual/local-guide.md`,
  `docs/manual/user-guide.md`, `packages/cli/skill/SKILL.md`, `docs/ops/known-issues.md`(해당 시)

- [ ] **Step 1: 실서버 스모크로 실물 출력을 채집한다** — 매뉴얼은 실물 출력을 인용하므로 먼저 한다.
  [setup.md](../../guides/setup.md) 의 워크트리 포트·격리 DB 로 서버를 띄우고, 웹에서 조직·조직
  라이브러리(항목 2~3개)와 토큰을 만든 뒤 스크래치 디렉터리에서:

```bash
erdd init --server http://127.0.0.1:<포트> --token "$T" --create --org <조직> --name 스모크 --yes
erdd dict list
erdd dict pull --library "<라이브러리>"
erdd dict pull --dry-run
erdd serve --no-open    # 브라우저에서 단어 하나 추가 → 저장 → Ctrl+C
erdd push -m "스모크"
erdd dict push --library "<라이브러리>" -m "스모크 요청"   # 일반 멤버 토큰으로 → 요청
erdd dict requests
# 웹에서 조직 관리자로 승인
erdd pull --yes && cat erdd/origins.yaml
# 이관 경로
mkdir ../migr && cd ../migr && erdd init --local && (단어 하나를 words.yaml 에) && \
erdd init --server … --create --org <조직> --name 이관 --yes && erdd diff && erdd push -m 이관
```

  **확인할 것:** 승인 뒤 `pull` 이 `origins.yaml` 에 승격 항목을 쓰는가 · 이관 `diff` 가 전부 「추가」인가 ·
  옛 서버(이 브랜치 이전 빌드)에 `dict list` 를 부르면 업그레이드 안내가 뜨는가(가능하면).
  출력 전문을 워커 보고에 붙인다.

- [ ] **Step 2: 정본(guides) 갱신** — 연대기 없이 지금 참인 규칙만, 함수명·절 제목으로 가리킨다.
  - `cli.md`: 「액세스 토큰 인증」에 토큰에 연 프로시저 목록(설계 6절 표)을 적는다. 「알려진 한계」의
    「파일에 `notes`·배치 좌표·`origin` 을 담지 않는다」에서 `origin` 을 빼고, `origins.yaml` 의 판독 규칙
    (댕글링 무시·중복/종류 불일치 오류)과 **`dict push` 가 로컬 변경 없음을 요구하는 이유**, **`config` 를
    다시 쓰는 자리는 `dictionaries` 를 보존해야 한다**(필수 필드로 둔 이유)를 새 절로 적는다.
  - `shared-resources.md`: 「CLI 경로도 같은 엔진을 탄다 — `dict push` 는 `resource.promote`·`promotion.create`
    를 부를 뿐 세 번째 승격 경로가 아니다」, `adopt` 의 `origin.base`(투영값) 규칙과 「출처가 이미 붙은
    항목은 대상이 아니다」, 알려진 한계 「요청자는 반려 사유를 볼 수 없다」를 「웹 UI 에서는」으로 좁힌다
    (`erdd dict requests` 가 처리 메모를 보인다).
  - `data-layer.md`: `TOP_LEVEL_FILES` 를 다루는 자리에 `origins.yaml` 이 **마지막 원소여야 하는 이유**
    (file-merge 의 위치 구조분해).
  - `release.md`: 「서버를 먼저 배포한다 — 새 CLI 의 `dict`·`init --create` 는 새 서버 프로시저를 요구한다」.

- [ ] **Step 3: 매뉴얼 갱신** — Step 1 의 실물 출력을 그대로 인용한다.
  - `cli-guide.md`: 명령 레퍼런스에 `dict list`·`dict pull`·`dict push`·`dict requests`, `init` 절에
    `--create`·`--org`·`--name`, 파일 구조 절에 `erdd/origins.yaml`(손으로 고치지 않는다), `erdd.config.yaml`
    절에 `dictionaries`, 「파일에 담기지 않는 것」 표에서 origin 행을 걷고 대신 `origins.yaml` 로 안내,
    `--json` 규약 절에 `dict pull` 의 봉투(`libraries[]`), 문제 해결에 「서버가 이 기능을 지원하지 않습니다」.
  - `local-guide.md`: 1절 대조표 「조직 공용 리소스」 설명에 「`erdd dict` 로 서버 연결 프로젝트에서 받을 수
    있다」, 「로컬로 시작한 프로젝트를 서버로 옮기기」 절을 `erdd init --server … --create` 한 줄 절차로 교체.
  - `user-guide.md` 13장: 「CLI(`erdd dict`)로도 가져오기·승격할 수 있다 → CLI 매뉴얼」 한 줄.
  - `packages/cli/skill/SKILL.md`: 파일 트리에 `origins.yaml`, 표의 「공용 리소스 출처(`origin`)」 행을
    「`erdd/origins.yaml` 에 있다 — **손으로 고치지 않는다**. 사전 항목을 지우면 다음 저장에서 그 줄이
    정리된다」로.

- [ ] **Step 4: 링크·서술 점검**

```bash
grep -rn "origin" docs/guides docs/manual packages/cli/skill | grep -iE "담기지 않|담지 않|FILE_INVISIBLE"   # 0건이어야 한다
grep -rn "7.2\|로컬로 시작한 프로젝트를 서버로" docs/manual   # 앵커가 바뀌었으면 인용처를 고친다
```

- [ ] **Step 5: 전체 검증** — Run: `DATABASE_URL='<격리 test DB>' pnpm verify`(🔥 `.env` 로드 금지) → PASS.

- [ ] **Step 6: 커밋**

```bash
F="docs/guides/cli.md docs/guides/shared-resources.md docs/guides/data-layer.md docs/guides/release.md \
docs/manual/cli-guide.md docs/manual/local-guide.md docs/manual/user-guide.md packages/cli/skill/SKILL.md"
git add $F && git commit -m "docs: CLI 공용 사전 동기화 — 정본·매뉴얼·스킬 문서를 갱신한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

(`known-issues.md` 를 고쳤다면 그 경로도 명시한다.)

---

## 마무리

- 최종 리뷰(브랜치 전체)를 태스크별 리뷰가 전부 clean 이어도 반드시 한다(worktree-workflow 4절).
- `main` 병합 뒤 이 계획서(`docs/superpowers/plans/2026-09-23-cli-dictionary-sync.md`)를 지운다 —
  설계는 `specs/` 가, 결과는 코드와 `git log` 가 갖는다.
