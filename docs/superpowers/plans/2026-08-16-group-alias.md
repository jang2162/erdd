# 그룹 별칭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 그룹에 물리 식별자 별칭(`alias`)을 붙이고, 직전 사이클이 만든 컬럼 행 배지 레이아웃 결함을 함께 고친다.

**Architecture:** `TableGroupSchema`에 필드를 하나 더하는 일이지만 **마이그레이션 + 등록처 4곳**(DB 스키마 · 파일 포맷 · 그룹 패널 · core 모델)이 따라온다. 별칭은 nullable이 아니라 빈 문자열 기본값이고, 입력 규칙은 타이핑 중에 강제한다. 이번 사이클이 끝나도 **별칭은 쓰이는 곳이 없다**(다음 사이클의 템플릿이 소비자다).

**Tech Stack:** TypeScript · zod · drizzle(postgres) · React 19 · vitest

**설계 문서:** `docs/superpowers/specs/2026-08-16-group-alias-design.md`

## Global Constraints

- **마이그레이션 0013이 붙는다.** 워크트리에 격리 DB를 만들고 적용한 뒤 서버 테스트를 돌린다:
  ```bash
  docker exec -i erdd-db-1 createdb -U postgres erdd_test_b
  DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm -C apps/server exec drizzle-kit migrate
  DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
  ```
  🔥 **`. ./.env` 로 verify 를 돌리지 마라 — 개발 DB가 통째로 날아간다.** ⚠️ 서버 스위트가 `20 passed | 174 skipped`면 통과가 아니라 **미실행**이다.
- **`op.ts`를 손대지 않는다** — `ENTITY_SCHEMAS`가 `TableGroupSchema`를 참조하므로 따라온다. 고쳤다면 범위를 넘은 것이다.
- **DBML·Excel·DDL에 별칭을 내보내지 않는다**(설계 1절 범위 밖).
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...`를 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 692 · cli 141 · web 910 · server 200 · typecheck EXIT=0`.
- **typecheck는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`. `-s`는 오류가 있어도 출력이 0바이트고, 파이프를 붙이면 `$?`가 tail 것이 된다.
- **작업 디렉터리는 워크트리다.** 최상위 체크아웃에서 파일을 고치지 않는다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/model.ts` | `TableGroupSchema.alias` | 수정 |
| `packages/core/src/group.ts` | `updateGroup`의 patch 타입에 `alias` | 수정 |
| `packages/core/src/diff.test.ts` | 구 스냅샷 회귀(HANDOFF 3.3) | 수정 |
| `packages/core/src/file-merge.ts` | `FILE_FIELDS.tableGroup.alias` | 수정 |
| `packages/core/src/file-merge.test.ts` | 위 | 수정 |
| `apps/server/src/db/schema.ts` + `apps/server/drizzle/0013_*.sql` | 컬럼 추가 | 수정/**생성** |
| `apps/server/src/routers/model.test.ts` 또는 `snapshot.test.ts` | 왕복·기본값 | 수정 |
| `apps/web/src/editor/group-panel.tsx` | 별칭 입력 + 자동 생성 | 수정 |
| `apps/web/src/editor/group-panel.test.tsx` | 위 | 수정 |
| `apps/web/src/editor/edit-panel.tsx` | 배지 `absolute` (B) | 수정 |
| `docs/manual/user-guide.md` · `docs/13-naming.md` · `docs/superpowers/HANDOFF.md` | 문서 | 수정 |

---

## Task 1: core 모델에 `alias` 추가

**Files:**
- Modify: `packages/core/src/model.ts`(`TableGroupSchema`, 66-72행 부근) · `packages/core/src/group.ts:12-14`
- Test: `packages/core/src/model.test.ts`(없으면 `group.test.ts`) · `packages/core/src/diff.test.ts`

**Interfaces:**
- Produces: `TableGroup`에 `alias: string`(기본값 `''`), `updateGroup`의 patch가 `alias`를 받는다

⚠️ **`z.strictObject`라 필드를 더하면 기존 `TableGroup` 리터럴이 전부 깨진다.** 픽스처·테스트에서 그룹을 손으로 만드는 곳을 전부 찾아 고친다. `pnpm -r typecheck`로 확인한다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/diff.test.ts`에 추가한다(기존 「구 스냅샷 회귀」 두 건과 **같은 패턴**이다 — 128행·141행을 먼저 읽고 그 형태를 따른다):

```ts
  it('does not emit an update op when the target group merely lacks alias (legacy snapshot regression)', () => {
    // alias는 이번 sub-project에서 tableGroup에 새로 추가된 필드다.
    // HANDOFF 3.3: 새 필드를 추가할 때는 "구 스냅샷에 필드 없음" 케이스를 회귀 테스트로 남긴다.
    // alias가 생기기 전 스냅샷의 jsonb에는 그룹에 alias 키가 아예 없고 현재 모델(base)에는 있다.
    // 이때 값 없는 update op가 나가면 옛 스냅샷 복원이 500으로 터진다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    const legacyGroup = { ...target.tableGroups.g1! } as Record<string, unknown>
    delete legacyGroup.alias
    target.tableGroups.g1 = legacyGroup as unknown as NonNullable<typeof base.tableGroups.g1>

    const ops = diffModels(base, target)
    expect(ops.filter((o) => o.action === 'update')).toEqual([])
  })
```

그리고 스키마 기본값을 잠근다(`packages/core/src/model.test.ts`가 있으면 거기, 없으면 `group.test.ts`):

```ts
  it('alias 가 없는 옛 페이로드를 파싱하면 빈 문자열이 된다', () => {
    const legacy = { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null }
    expect(TableGroupSchema.parse(legacy).alias).toBe('')
  })

  it('updateGroup 이 alias 를 고친다', () => {
    const m = buildSampleModel()
    expect(updateGroup(m, 'g1', { alias: 'MBR' }).tableGroups['g1']!.alias).toBe('MBR')
  })
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/diff.test.ts src/group.test.ts src/model.test.ts
```
기대: `alias` 관련 신규 케이스가 FAIL(`undefined`).

- [ ] **Step 3: 구현하고 깨진 리터럴을 전부 고친다**

`model.ts`의 `TableGroupSchema`:

```ts
export const TableGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  comment: z.string().nullable(),
  /**
   * 물리명 조합용 짧은 식별자(영문·숫자·밑줄, 대문자). 선택 입력이라 없으면 빈 문자열이다.
   * ⚠️ HANDOFF 3.3 의 관례(`.nullable().default(null)`)를 따르지 않는다 — 별칭은 comment 가 아니라
   * physicalName 쪽 성격(비어 있을 수 있는 식별자)이라 null 이면 소비처마다 `?? ''` 가 붙는다.
   * `.default('')` 도 옛 op 페이로드 파싱을 똑같이 만족한다(설계 3.1).
   */
  alias: z.string().default(''),
})
```

`group.ts:12-14`의 patch 타입:

```ts
  patch: Partial<Pick<TableGroup, 'name' | 'color' | 'comment' | 'alias'>>,
```

**깨진 리터럴을 찾아 전부 고친다:**

```bash
grep -rn "color: '#" packages apps --include=*.ts --include=*.tsx | grep -v alias
```
그룹을 손으로 만드는 곳(픽스처·테스트·서버 헬퍼)에 `alias: ''`를 더한다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 신규 3건 PASS, `EXIT=0`. **typecheck 를 전 패키지로 돌린다** — 리터럴을 빠뜨린 곳이 여기서만 드러난다.

- [ ] **Step 5: 회귀 테스트가 진짜 잠그는지 실증한다**

`diff.ts`의 「빈 changes면 update op를 내지 않는다」 가드(`diff.ts:40`의 `if (Object.keys(changes).length > 0)`)를 **잠시 `if (true)`로 바꾸고** 돌린다.

⚠️ **치환이 적용됐는지 먼저 확인해라** — `git diff` 로 실제 바뀐 줄을 눈으로 본 뒤에 테스트를 돌린다.

```bash
pnpm -C packages/core exec vitest run src/diff.test.ts -t 'lacks alias'
```
기대: **FAIL**. 되돌리고 PASS를 확인한 뒤 **결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/model.ts packages/core/src/group.ts packages/core/src/diff.test.ts && \
git commit -m "feat(core): 그룹에 물리 식별자 별칭을 더한다

nullable 이 아니라 빈 문자열 기본값이다 — 별칭은 comment 가 아니라 physicalName 쪽
성격이라 null 이면 소비처마다 ?? '' 가 붙는다. 구 스냅샷 회귀 가드를 함께 넣었다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
⚠️ 리터럴을 고친 다른 파일이 있으면 **그 경로도 같은 커밋에 명시**한다(`git status`로 확인).

---

## Task 2: DB 스키마와 마이그레이션 0013

**Files:**
- Modify: `apps/server/src/db/schema.ts:104-110`(`modelTableGroups`)
- Create: `apps/server/drizzle/0013_*.sql`(생성기가 이름을 붙인다)
- Test: `apps/server/src/routers/model.test.ts`(그룹 왕복이 있는 파일 — 없으면 `snapshot.test.ts`)

**Interfaces:**
- Consumes: Task 1의 `TableGroup`
- Produces: `model_table_groups.alias`(`text NOT NULL DEFAULT ''`)

- [ ] **Step 1: 격리 DB를 준비한다**

```bash
docker exec -i erdd-db-1 createdb -U postgres erdd_test_b 2>/dev/null || echo "(이미 있음)"
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm -C apps/server exec drizzle-kit migrate
```

- [ ] **Step 2: 실패 테스트를 쓴다**

`apps/server/src/routers/model.test.ts`의 `describe.skipIf(!url)('model', …)` 안에 추가한다.
⚠️ **그 파일은 tRPC caller 가 아니라 HTTP inject 방식이다** — 기존 `post`/`get` 헬퍼와 `beforeEach`가
만들어 두는 `editorToken`·`projectId`를 그대로 쓴다. 첫 케이스(28행)가 정확히 이 형태다.

```ts
  it('그룹 별칭이 왕복한다', async () => {
    const target = withUuidIds(buildSampleModel())
    const groupId = Object.keys(target.tableGroups)[0]!
    target.tableGroups[groupId]!.alias = 'MBR'
    const res = await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    expect(res.statusCode).toBe(200)

    const got = await get(app, 'model.get', editorToken, { projectId })
    expect(got.json().result.data.model.tableGroups[groupId].alias).toBe('MBR')
  })

  it('별칭을 비운 그룹은 빈 문자열로 왕복한다', async () => {
    // DB 컬럼이 NOT NULL DEFAULT '' 라 null 이 아니라 '' 로 돌아와야 한다.
    const target = withUuidIds(buildSampleModel())
    const groupId = Object.keys(target.tableGroups)[0]!
    expect(target.tableGroups[groupId]!.alias).toBe('')      // 픽스처 기본값
    await post(app, 'model.mutate', editorToken, {
      projectId, ops: diffModels(createEmptyModel(), target),
    })
    const got = await get(app, 'model.get', editorToken, { projectId })
    expect(got.json().result.data.model.tableGroups[groupId].alias).toBe('')
  })
```

⚠️ **「마이그레이션 전에 만들어진 행」은 테스트로 관측할 수 없다.** `NOT NULL DEFAULT ''`라 SQL로
`NULL`을 넣을 수 없고, 테스트 DB는 항상 마이그레이션이 적용된 상태에서 시작한다. 실질적으로 확인할
것은 **생성된 0013 SQL이 `DEFAULT ''`를 담고 있는가**뿐이다 — Step 4에서 파일을 열어 눈으로 확인하고
**그 사실을 보고에 적어라**(억지 테스트를 만들지 마라). 설계 4절의 「잠기지 않는 것」에도 추가한다.

- [ ] **Step 3: 실패를 확인한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm -C apps/server exec vitest run
```
기대: 신규 케이스 FAIL. **skip 이 아닌지 수를 확인한다.**

- [ ] **Step 4: 구현한다**

`schema.ts`의 `modelTableGroups`에 더한다:

```ts
  alias: text('alias').notNull().default(''),
```

마이그레이션을 생성한다:

```bash
pnpm -C apps/server exec drizzle-kit generate
```
생성된 `apps/server/drizzle/0013_*.sql`을 **열어서 확인한다** — `ALTER TABLE "model_table_groups" ADD COLUMN "alias" text DEFAULT '' NOT NULL;` 형태여야 한다. 다른 테이블이 함께 바뀌었으면 스키마를 잘못 건드린 것이다.

격리 DB에 적용한다:

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm -C apps/server exec drizzle-kit migrate
```

`model-store.ts`는 **확인만** 한다 — `db.select().from(modelTableGroups)`가 행 전체를 읽으면 배선이 자동이다. 손으로 컬럼을 나열하고 있으면 그때만 고친다.

- [ ] **Step 5: 통과를 확인한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -s -C apps/server typecheck; echo "EXIT=$?"
```

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/ apps/server/src/routers/*.test.ts && \
git commit -m "feat(server): 그룹 별칭 컬럼과 마이그레이션 0013 을 더한다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: CLI 파일 포맷

**Files:**
- Modify: `packages/core/src/file-merge.ts:24`(`FILE_FIELDS.tableGroup`)
- Test: `packages/core/src/file-merge.test.ts`

**Interfaces:**
- Produces: 파일에 그룹 `alias`가 실리고 3-way 병합이 그 필드를 다룬다

- [ ] **Step 1: 실패 테스트를 쓴다**

`file-merge.test.ts`에 추가한다. ⚠️ **그 파일은 `trio()` 헬퍼로 base/local/server 세 모델을 만들고
`mergeModels(base, local, server)`를 부른다**(108행 「로컬만 추가한 것은 생성한다」가 그 형태다).

```ts
  it('로컬이 고친 그룹 별칭을 채택한다', () => {
    const { base, local, server } = trio()
    const g = Object.keys(base.tableGroups)[0]!
    local.tableGroups[g] = { ...local.tableGroups[g]!, alias: 'MBR' }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups[g]!.alias).toBe('MBR')
  })

  it('양쪽이 별칭을 다르게 고치면 그 필드가 충돌이다', () => {
    const { base, local, server } = trio()
    const g = Object.keys(base.tableGroups)[0]!
    local.tableGroups[g] = { ...local.tableGroups[g]!, alias: 'MBR' }
    server.tableGroups[g] = { ...server.tableGroups[g]!, alias: 'MEM' }
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts.some((c) => c.field === 'alias')).toBe(true)
  })
```

⚠️ **두 번째 케이스의 `c.field` 가 `'alias'` 인지 확인해라** — `FILE_FIELDS` 의 **값**(사용자가 파일에서
보는 키)이 충돌의 `field` 에 들어간다(`file-merge.ts:109-110` 주석). 키와 값을 같은 `alias` 로 두면
일치하지만, 파일 키를 다르게 지으면 그 값으로 단언해야 한다.

⚠️ `trio()` 가 만드는 그룹에 `alias` 가 있는지 먼저 확인해라 — Task 1 에서 픽스처를 고쳤으면 있고,
없으면 그 헬퍼도 함께 고쳐야 한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/file-merge.test.ts
```

- [ ] **Step 3: 구현한다**

```ts
  tableGroup: { name: 'name', color: 'color', comment: 'comment', alias: 'alias' },
```

`FILE_INVISIBLE_FIELDS.tableGroup`은 `[]` 그대로 둔다(별칭은 파일에 보이는 필드다).

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -s -C packages/cli typecheck; echo "EXIT=$?"
```
⚠️ **CLI 스위트가 깨질 수 있다** — 파일 스냅샷을 문자열로 비교하는 케이스가 있으면 `alias` 줄이 늘어난다. 그건 의도된 변경이니 기댓값을 고친다.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/file-merge.ts packages/core/src/file-merge.test.ts && \
git commit -m "feat(core): 그룹 별칭을 CLI 파일 포맷에 싣는다

넣지 않으면 데이터가 깨지지는 않지만(applyMerge 가 서버 값을 통과시킨다) CLI 로
별칭을 다룰 수 없다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: 그룹 패널 — 별칭 입력과 자동 생성

**Files:**
- Modify: `apps/web/src/editor/group-panel.tsx`(이름 필드 아래)
- Test: `apps/web/src/editor/group-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `updateGroup(m, id, { alias })`, core의 `generatePhysicalName`
- Produces: 없음(UI)

- [ ] **Step 1: 실패 테스트를 쓴다**

`group-panel.test.tsx`에 추가한다. 그 파일의 헬퍼(`renderPanel()` · `PROJECT_ID` · `buildSampleModel()` · `grantEditPermission()`)를 그대로 쓴다. 픽스처의 그룹은 `g1`(이름 `회원관리`).

```tsx
  it('별칭을 입력하면 blur 로 커밋된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    const input = screen.getByLabelText('별칭') as HTMLInputElement
    await userEvent.type(input, 'MBR')
    await userEvent.tab()
    await waitFor(() =>
      expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('MBR'))
  })

  // ⚠️ 설계 D3 — 타이핑 중에 규칙을 강제한다.
  it('한글·특수문자는 입력되지 않고 소문자는 대문자가 된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    const input = screen.getByLabelText('별칭') as HTMLInputElement
    await userEvent.type(input, 'mbr-회원_1!')
    expect(input.value).toBe('MBR_1')
  })

  it('이름으로 채우기가 사전으로 별칭을 만든다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    // 픽스처 그룹 이름은 '회원관리' — 사전에 두 단어를 넣어 MBR_MGMT 가 나오게 한다.
    m = createWord(m, { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null })
    m = createWord(m, { id:'w2', logicalName:'관리', abbreviation:'MGMT', englishName:null, description:null, origin:null })
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '이름으로 별칭 채우기' }))
    await waitFor(() =>
      expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('MBR_MGMT'))
  })

  it('사전에 없으면 토스트를 내고 별칭을 바꾸지 않는다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '' as never)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)   // 사전 비어 있음
    grantEditPermission()
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '이름으로 별칭 채우기' }))
    expect(spy).toHaveBeenCalled()
    expect(useEditorStore.getState().model.tableGroups['g1']!.alias).toBe('')
  })

  it('읽기 전용이면 별칭이 readOnly 이고 채우기 버튼이 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.setState({ canEdit: false })
    useEditorStore.getState().selectGroup('g1')
    renderPanel()
    expect(screen.getByLabelText('별칭')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '이름으로 별칭 채우기' })).not.toBeInTheDocument()
  })
```

`createWord`(`./dict-edits.js`) import를 더한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/group-panel.test.tsx
```
기대: 「별칭」 라벨이 없어 FAIL.

- [ ] **Step 3: 구현한다**

`group-panel.tsx`의 이름 필드 아래에 더한다. ⚠️ **타이핑 중 정규화를 하려면 로컬 state가 필요하다** — 비제어 인풋에서 `e.target.value`를 직접 바꾸면 React와 어긋난다.

```tsx
const ALIAS_RE = /[^A-Z0-9_]/g
/** 별칭은 물리 식별자다 — 타이핑 중에 규칙을 강제한다(설계 D3). */
function normalizeAlias(v: string): string {
  return v.toUpperCase().replace(ALIAS_RE, '')
}
```

컴포넌트 안:

```tsx
  const namingRules = useEditorStore((s) => s.namingRules)
  const [alias, setAlias] = useState(group.alias)
  // 모델 값이 바뀌면(자동 생성·실시간·undo) 입력을 맞춘다.
  useEffect(() => { setAlias(group.alias) }, [group.alias])
```

렌더:

```tsx
        <div className="grid gap-1.5">
          <Label htmlFor="grp-alias">별칭</Label>
          <div className="relative">
            <Input
              id="grp-alias" aria-label="별칭" className="pr-9 font-mono"
              value={alias} readOnly={!canEdit}
              onChange={(e) => setAlias(normalizeAlias(e.target.value))}
              onBlur={() => {
                if (alias !== group.alias) void mutate((m) => updateGroup(m, groupId, { alias }),
                  { summary: '그룹 별칭 변경' })
              }}
            />
            {canEdit && (
              <Button
                type="button" size="icon" variant="ghost"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                aria-label="이름으로 별칭 채우기"
                // 포커스를 뺏지 않는다 — 직전 사이클이 계측으로 확정한 효용이다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const gen = generatePhysicalName(group.name, model.words, model.terms, namingRules)
                  if (!gen.physicalName) {
                    toast.error(gen.unknownWords.length > 0
                      ? `사전에 없는 단어: ${gen.unknownWords.join(', ')}`
                      : '그룹 이름이 비어 있어 별칭을 만들 수 없습니다')
                    return
                  }
                  const next = normalizeAlias(gen.physicalName)
                  setAlias(next)
                  if (next !== group.alias) void mutate((m) => updateGroup(m, groupId, { alias: next }),
                    { summary: '그룹 별칭 생성' })
                }}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
```

import를 더한다 — `useEffect`·`useState`(react), `ArrowUp`(lucide-react), `toast`(sonner), `generatePhysicalName`(@erdd/core).

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/group-panel.test.tsx
pnpm -C apps/web test
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

- [ ] **Step 5: 정규화가 진짜 잠기는지 실증한다**

`onChange`의 `normalizeAlias(e.target.value)`를 `e.target.value`로 **잠시 바꾸고** 돌린다.
⚠️ **`git diff`로 실제 바뀐 줄을 눈으로 확인한 뒤에** 테스트를 돌린다.

```bash
pnpm -C apps/web exec vitest run src/editor/group-panel.test.tsx -t '한글·특수문자'
```
기대: **FAIL**. 되돌리고 PASS를 확인한 뒤 **결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/group-panel.tsx apps/web/src/editor/group-panel.test.tsx && \
git commit -m "feat(web): 그룹 패널에 별칭 입력과 사전 기반 생성을 더한다

규칙은 타이핑 중에 강제한다 — 커밋 후 거절하는 쪽보다 예측 가능하고, 한글을 치면
아무것도 안 들어가서 규칙을 즉시 알 수 있다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: (B) 컬럼 행 배지 레이아웃

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx:246-280`

**Interfaces:** 없음(스타일)

⚠️ **이 수정은 테스트로 잠기지 않는다**(설계 3.5). jsdom이 레이아웃을 계산하지 않아 「폭이 같다」를 관측할 수 없다. **억지 테스트를 만들지 마라** — 클래스 문자열을 단언하는 것은 스타일 복사일 뿐 동작을 보지 않는다. 기존 배지 테스트(경고 건수가 보인다 등)가 그대로 통과하는지만 확인한다.

- [ ] **Step 1: 구현한다**

지금:

```tsx
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <NamePair … />
        </div>
        <WarningBadge warnings={props.warnings} className="shrink-0" />
      </div>
```

고친 뒤 — `<li>`에 `relative`를 더하고, flex wrapper를 없애고 배지를 띄운다:

```tsx
    <li
      className={cn('relative grid gap-2 rounded-md border p-2', props.selected && 'ring-2 ring-primary')}
      aria-selected={props.selected}
      ref={props.rowRef}
    >
      {/*
        ⚠️ 배지를 NamePair 와 같은 flex row 에 두면 shrink-0 인 배지가 폭을 뺏어
        **경고가 있는 컬럼만 입력란이 좁아진다**(320px 사이드바에서 컬럼마다 폭이 들쭉날쭉해진다).
        직전 사이클 설계 3.7 의 「카드 우상단」 의도대로 띄운다. 물리명 라벨이 짧아 겹치지 않는다.
      */}
      <WarningBadge warnings={props.warnings} className="absolute top-2 right-2" />
      <NamePair … />
```

`NamePair` 호출부는 그대로 옮긴다(속성 변경 없음).

- [ ] **Step 2: 회귀를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx
pnpm -C apps/web test
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 실패 0. 배지를 찾는 기존 케이스가 있으면 그대로 통과해야 한다(위치만 바뀌고 DOM에는 그대로 있다).

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx && \
git commit -m "fix(web): 컬럼 행 경고 배지가 이름 입력란 폭을 뺏지 않게 한다

배지가 NamePair 와 같은 flex row 에 있어 경고가 있는 컬럼만 입력란이 좁아졌다.
직전 사이클 설계 3.7 의 「카드 우상단」 의도대로 absolute 로 띄운다.
⚠️ jsdom 이 레이아웃을 계산하지 않아 테스트로 잠기지 않는다 — 스모크에서 본다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: 문서와 최종 검증

**Files:**
- Modify: `docs/manual/user-guide.md` · `docs/13-naming.md` · `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 매뉴얼과 기획 문서를 고친다**

```bash
grep -n "그룹" docs/manual/user-guide.md | head -20
```
- `user-guide.md` — 그룹 패널의 별칭 필드(입력 규칙과 「이름으로 채우기」 버튼).
- `docs/13-naming.md` — 별칭이 명명 체계의 일부가 될 것임을 한 줄. **템플릿은 다음 사이클임을 명시**한다(지금은 쓰이는 곳이 없다).

- [ ] **Step 2: 최종 검증**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -C apps/web test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
네 수를 실측해 적는다. 🔥 **`. ./.env` 금지.** 서버가 `20 passed | 174 skipped`면 미실행이다.

- [ ] **Step 3: HANDOFF 를 갱신한다**

1. **머리말** — **마이그레이션을 0013까지**로 고친다(지금 0012라 적혀 있다). main HEAD는 컨트롤러가 병합 후 채우므로 **날짜만** 갱신한다.
2. **1절 완료 표**에 한 줄. 담을 것: `alias`가 nullable이 아니라 빈 문자열인 이유(3.3 관례와 갈리는 지점), **이번 사이클이 끝나도 별칭은 쓰이는 곳이 없다**는 것과 그 이유(템플릿이 다음 사이클), 마이그레이션 0013, (B) 배지 수정.
3. **3절**에 「그룹 별칭은 물리 식별자이고 타이핑 중에 정규화된다」를 적는다.
4. **테스트 기준선**을 실측값으로 갱신하고 직전 기준선(`core 692 · cli 141 · web 910 · server 200`)과 함께 적는다.
5. **6절 이월** — 테이블명 형식 템플릿 · 중복 별칭 경고 · 별칭의 DBML/Excel/DDL 노출 · **(B) 배지 레이아웃이 테스트로 잠기지 않는다** · Task 2에서 관측 불가로 판정한 것.

- [ ] **Step 4: 커밋**

```bash
git add docs/manual/user-guide.md docs/13-naming.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 그룹 별칭을 문서에 반영한다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 확장이 하나뿐이라 사용자가 돈다)

1. 그룹을 골라 별칭 칸에 **한글을 쳐 본다** — 아무것도 안 들어가야 한다. 소문자는 대문자가 되어야 한다.
2. 「이름으로 채우기」 — 사전이 비어 있으면 토스트, 채워져 있으면 약어 조합이 들어가야 한다.
3. **(B) 배지** — 경고가 있는 컬럼과 없는 컬럼의 **이름 입력란 폭이 같은지**. 이번 사이클에서 테스트로 잠기지 않는 유일한 항목이다.
4. 배지가 카드 우상단에 뜨고 물리명 라벨과 겹치지 않는지.
5. 별칭을 넣고 새로고침 — 값이 남아 있는지(서버 왕복).
