# 역할 기반 읽기 전용 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project Viewer에게 편집 어포던스를 숨기고 입력을 잠그며, Project Editor에게 `'manage'` 전용 동작(스냅샷 복원·삭제)을 숨긴다.

**Architecture:** 서버 `project.get`이 이미 계산해 둔 `canEdit`·`canManage`를 응답에 실어 보내고, 클라는 그것을 store에 담아 컴포넌트가 읽는다. 판정 로직은 서버 `perm.ts` 하나뿐이고 클라는 역할 조합식을 재현하지 않는다. 어포던스 숨김이 여러 파일에 흩어지므로 `useSubmit` 한 곳에 최종 안전망 가드를 둔다.

**Tech Stack:** TypeScript, React 19, zustand 5, TanStack Query, tRPC, @xyflow/react, vitest + @testing-library/react (web) / vitest + fastify inject (server)

**설계 문서:** [docs/superpowers/specs/2026-08-01-viewer-readonly-ui-design.md](../specs/2026-08-01-viewer-readonly-ui-design.md)

## Global Constraints

- **`packages/core`를 건드리지 않는다. 새 마이그레이션 없음.** 서버 변경은 `apps/server/src/routers/project.ts`의 `get` 반환 필드 2개뿐이다.
- 불가침: `apps/server/src/services/perm.ts`(판정 로직), 라우터의 기존 게이트, `packages/core/src/diff.ts`·`op.ts`·`integrity.ts`·`model.ts`.
- **안전망 가드는 `useSubmit`에만 넣는다.** `serializeMutation`이나 `use-realtime.ts`에 넣으면 수신 op까지 막혀 Viewer의 실시간 화면이 얼어붙는다.
- 클라가 역할 조합식(`myRole === 'editor' || …`)을 재현하지 않는다. `canEdit`·`canManage`는 서버가 준 값을 그대로 쓴다.
- store 기본값은 `canEdit: false`, `canManage: false`(fail-closed). `reset()`도 같은 값으로 되돌린다.
- 새 런타임 의존성 금지. UI 카피는 한국어. 읽기 전용 배지 문구는 정확히 `읽기 전용`.
- 이벤트 값은 producer 진입 **전에** 캡처한다(`serializeMutation`이 producer를 마이크로태스크로 미루므로 지연 읽기는 스테일 값을 잡는다).
- 커밋은 명시 파일만(`git add .` / `git add -A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
  ```

## 검증 명령

```bash
set -a && . ./.env && set +a && pnpm verify; echo "EXIT=$?"
```

⚠️ **`pnpm -s -r typecheck`의 출력만 보고 판정하지 말 것.** `-s`가 자식 출력을 삼켜서 타입 오류가 있어도 **출력이 0바이트이고 종료코드만 1**이다. 반드시 `EXIT=0`을 확인한다. 파이프(`| tail`)를 붙이면 `$?`가 tail의 종료코드가 되어 또 오판한다.

웹만 빠르게 돌릴 때: `pnpm -C apps/web test`

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `apps/server/src/routers/project.ts` | 수정 | `get`이 `canEdit`·`canManage`를 함께 반환 |
| `apps/server/src/routers/project.test.ts` | 수정 | 역할별 판정값 검증 |
| `apps/web/src/editor/store.ts` | 수정 | `canEdit`·`canManage` 보관(기본 `false`) + `setPermissions` |
| `apps/web/src/editor/store.test.ts` | 생성 | 기본값·setter·reset 검증 |
| `apps/web/src/editor/use-model.ts` | 수정 | `project.get` → store 배선, `useSubmit` 안전망 가드 |
| `apps/web/src/testing/editor-store.ts` | 생성 | 테스트용 `grantEditPermission()` |
| `apps/web/src/editor/toolbar.tsx` | 수정 | 편집군 숨김 + `읽기 전용` 배지 + 단축키 가드 |
| `apps/web/src/editor/canvas.tsx` | 수정 | 드래그·연결·삭제키 차단 |
| `apps/web/src/editor/table-tree.tsx` | 수정 | `그룹 추가` 숨김 |
| `apps/web/src/editor/edit-panel.tsx` 외 5개 | 수정 | 입력 잠금 + 편집 버튼 숨김 |
| `apps/web/src/editor/dict-panel.tsx` 외 6개 | 수정 | 다이얼로그 내 CRUD 숨김 |
| `apps/web/src/editor/version-dialog.tsx` | 수정 | `canEdit`=만들기 / `canManage`=복원·삭제 |
| `docs/superpowers/HANDOFF.md`, `docs/90-roadmap.md`, `docs/91-checklist.md` | 수정 | 검토 결론·완료 반영 |

---

### Task 1: 서버 판정 노출과 store 권한 상태 배선

이 태스크는 **상태를 흘려보내기만 한다.** 아직 아무 컴포넌트도 `canEdit`을 읽지 않으므로 기존 테스트는 전부 그대로 통과해야 한다. 하나라도 깨지면 배선을 잘못한 것이다.

**Files:**
- Modify: `apps/server/src/routers/project.ts:64-75`
- Modify: `apps/server/src/routers/project.test.ts:66-81`, `:101-116`
- Modify: `apps/web/src/editor/store.ts`
- Create: `apps/web/src/editor/store.test.ts`
- Modify: `apps/web/src/editor/use-model.ts:20-38`
- Test: `apps/server/src/routers/project.test.ts`, `apps/web/src/editor/store.test.ts`, `apps/web/src/editor/use-model.test.tsx`

**Interfaces:**
- Produces: `project.get`의 응답에 `canEdit: boolean`, `canManage: boolean` 추가 (기존 `myRole`·`myOrgRole`은 **유지**)
- Produces: store의 `canEdit: boolean`, `canManage: boolean`, `setPermissions: (perms: { canEdit: boolean; canManage: boolean }) => void`

- [ ] **Step 1: 서버 테스트를 먼저 고친다 (실패 확인용)**

`apps/server/src/routers/project.test.ts`의 viewer 테스트(66행부터)에서 `myRole` 단언 바로 뒤에 두 줄을 추가한다:

```ts
    expect(got.json().result.data.myRole).toBe('viewer')
    expect(got.json().result.data.canEdit).toBe(false)
    expect(got.json().result.data.canManage).toBe(false)
```

editor 테스트(101행부터)에서도 같은 위치에:

```ts
    expect(got.json().result.data.myRole).toBe('editor')
    expect(got.json().result.data.canEdit).toBe(true)
    expect(got.json().result.data.canManage).toBe(false)
```

그리고 editor 테스트 블록 **뒤에** 새 테스트를 추가한다(org owner는 프로젝트 멤버가 아니어도 둘 다 참이어야 한다 — `perm.ts`의 `isOrgManager` 경로):

```ts
  it('project.get grants canEdit and canManage to the org owner', async () => {
    const projectId = await createProject()
    const got = await get(app, 'project.get', ownerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.canEdit).toBe(true)
    expect(got.json().result.data.canManage).toBe(true)
  })
```

- [ ] **Step 2: 서버 테스트가 실패하는지 확인**

```bash
set -a && . ./.env && set +a && pnpm -C apps/server test -- project
```

Expected: FAIL — `expected undefined to be false` (아직 `canEdit`을 반환하지 않는다)

- [ ] **Step 3: 서버가 판정값을 반환하게 한다**

`apps/server/src/routers/project.ts`의 `get` 반환 객체에 두 줄을 더한다:

```ts
      return {
        ...access.project,
        namingRules: access.project.namingRules ?? DEFAULT_NAMING_RULES,
        myRole: access.projectRole ?? null,
        myOrgRole: access.orgRole ?? null,
        // 판정은 서버가 한다. 클라가 역할 조합식을 재현하면 perm.ts가 바뀔 때 조용히 어긋난다.
        canEdit: access.canEdit,
        canManage: access.canManage,
      }
```

- [ ] **Step 4: 서버 테스트 통과 확인**

```bash
set -a && . ./.env && set +a && pnpm -C apps/server test -- project
```

Expected: PASS

- [ ] **Step 5: store 테스트를 새로 만든다**

`apps/web/src/editor/store.test.ts` 생성:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './store.js'

afterEach(() => { useEditorStore.getState().reset() })

describe('editor store 권한 상태', () => {
  it('기본값은 fail-closed다 — 서버 판정이 오기 전에는 편집할 수 없다', () => {
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('setPermissions가 두 값을 함께 반영한다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: false })
    expect(useEditorStore.getState().canEdit).toBe(true)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('reset은 권한을 fail-closed로 되돌린다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: true })
    useEditorStore.getState().reset()
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })
})
```

- [ ] **Step 6: store 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- store.test
```

Expected: FAIL — `canEdit` 없음(`expected undefined to be false`)

- [ ] **Step 7: store에 권한 상태를 추가한다**

`apps/web/src/editor/store.ts`의 `EditorState` 타입에서 `dialects: Dialect[]` 바로 뒤에 추가:

```ts
  /** 모델을 편집할 수 있는가(서버 판정). 로드 전 기본값 false — fail-closed. */
  canEdit: boolean
  /** 프로젝트를 관리할 수 있는가(스냅샷 복원·삭제). 로드 전 기본값 false. */
  canManage: boolean
```

같은 타입의 `setProjectConfig` 선언 바로 뒤에 추가:

```ts
  setPermissions: (perms: { canEdit: boolean; canManage: boolean }) => void
```

초기 상태에서 `dialects: [],` 바로 뒤에 추가:

```ts
  canEdit: false,
  canManage: false,
```

`setProjectConfig` 구현 바로 뒤에 추가:

```ts
  setPermissions: ({ canEdit, canManage }) => set({ canEdit, canManage }),
```

`reset` 구현의 `namingRules: DEFAULT_NAMING_RULES, dialects: [], peers: [],` 줄을 다음으로 바꾼다:

```ts
    namingRules: DEFAULT_NAMING_RULES, dialects: [], peers: [], canEdit: false, canManage: false,
```

`setProjectConfig`의 시그니처는 **바꾸지 않는다.** 권한은 별도 setter로 두어야 테스트가 명명 규칙과 무관하게 권한만 조작할 수 있다(같은 `useEffect` 안에서 두 setter를 부르므로 React 18 자동 배칭으로 렌더는 한 번이다).

- [ ] **Step 8: store 테스트 통과 확인**

```bash
pnpm -C apps/web test -- store.test
```

Expected: PASS (3 tests)

- [ ] **Step 9: 로더 배선 테스트를 추가한다**

`apps/web/src/editor/use-model.test.tsx`에 다음 테스트를 추가한다. `describe('useModelMutation', …)` 블록 **밖**, 파일 끝에 새 describe로 넣는다. 상단 import에 `DEFAULT_NAMING_RULES`와 `useModelLoader`가 필요하다(`useModelLoader`는 이미 import돼 있다):

```ts
describe('useModelLoader', () => {
  it('project.get의 판정 결과를 store에 싣는다', async () => {
    mockTrpcFetch({
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
      'project.get': () => ({
        data: {
          namingRules: DEFAULT_NAMING_RULES,
          dialects: ['postgresql'],
          canEdit: true,
          canManage: false,
        },
      }),
    })
    renderHook(() => useModelLoader('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    await waitFor(() => {
      expect(useEditorStore.getState().canEdit).toBe(true)
    })
    expect(useEditorStore.getState().canManage).toBe(false)
    expect(useEditorStore.getState().dialects).toEqual(['postgresql'])
  })
})
```

파일 상단 import에서 `import { createEmptyModel } from '@erdd/core'`를 다음으로 바꾼다:

```ts
import { createEmptyModel, DEFAULT_NAMING_RULES } from '@erdd/core'
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- use-model
```

Expected: FAIL — `expected false to be true` (아직 `setPermissions`를 부르지 않는다)

- [ ] **Step 11: 로더가 권한을 store에 싣게 한다**

`apps/web/src/editor/use-model.ts`의 `useModelLoader`에서 `setProjectConfig` 셀렉터 바로 뒤에 셀렉터를 하나 더 만든다:

```ts
  const setProjectConfig = useEditorStore((s) => s.setProjectConfig)
  const setPermissions = useEditorStore((s) => s.setPermissions)
```

그리고 `projectQuery.data` 효과를 다음으로 바꾼다:

```ts
  useEffect(() => {
    if (projectQuery.data) {
      setProjectConfig(projectQuery.data.namingRules, projectQuery.data.dialects)
      setPermissions({
        canEdit: projectQuery.data.canEdit,
        canManage: projectQuery.data.canManage,
      })
    }
  }, [projectQuery.data, setProjectConfig, setPermissions])
```

- [ ] **Step 12: 웹 전체 테스트 통과 확인**

```bash
pnpm -C apps/web test
```

Expected: PASS — **기존 테스트가 하나도 깨지지 않아야 한다.** 아직 `canEdit`을 읽는 컴포넌트가 없기 때문이다. 깨진 게 있으면 배선을 잘못한 것이니 다음 단계로 넘어가지 말고 원인을 찾는다.

- [ ] **Step 13: 커밋**

```bash
git add apps/server/src/routers/project.ts apps/server/src/routers/project.test.ts \
  apps/web/src/editor/store.ts apps/web/src/editor/store.test.ts \
  apps/web/src/editor/use-model.ts apps/web/src/editor/use-model.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 프로젝트 권한 판정을 store로 배선

project.get이 canEdit·canManage를 함께 반환하고, useModelLoader가 그것을
store에 싣는다. 클라가 역할 조합식을 재현하지 않도록 판정은 서버 perm.ts
하나로 유지한다. store 기본값은 fail-closed(false)다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 2: `useSubmit` 안전망 가드와 테스트 권한 헬퍼

이 태스크에서 **기존 테스트가 대량으로 깨진다.** store 기본값이 fail-closed라 편집을 수행하는 테스트가 전부 막히기 때문이다. 깨지는 것이 정상이고, 그것을 헬퍼로 고치는 것이 이 태스크의 절반이다.

**Files:**
- Modify: `apps/web/src/editor/use-model.ts` (`useSubmit` 내부)
- Create: `apps/web/src/testing/editor-store.ts`
- Modify: 아래 목록 중 실패하는 테스트 파일들
- Test: `apps/web/src/editor/use-model.test.tsx`, `apps/web/src/editor/use-realtime.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`(Task 1)
- Produces: `grantEditPermission(perms?: { canEdit: boolean; canManage: boolean }): void` — `@/testing/editor-store`에서 export

- [ ] **Step 1: 가드 테스트를 먼저 쓴다**

`apps/web/src/editor/use-model.test.tsx`의 `describe('useModelMutation', …)` 안에 추가:

```ts
  it('편집 권한이 없으면 서버로 보내지도, 모델을 바꾸지도 않는다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 3, '018f6b0e-0000-7000-8000-0000000000aa')
    // grantEditPermission을 부르지 않는다 — store 기본값 canEdit=false 그대로 검증한다.
    const captured: unknown[] = []
    mockTrpcFetch({
      'model.mutate': (input) => { captured.push(input); return { data: { seq: 4 } } },
    })
    const { result } = renderHook(() => useModelMutation('018f6b0e-0000-7000-8000-0000000000aa'), {
      wrapper: wrapper(),
    })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current((m) => ({ ...m, notes: { ...m.notes, [NOTE.id]: NOTE } }))
    })
    expect(outcome).toBe('error')
    expect(captured).toHaveLength(0)                          // 서버 왕복 없음
    expect(useEditorStore.getState().model.notes).toEqual({})  // 낙관적 적용 없음
  })
```

- [ ] **Step 2: 실시간 회귀 테스트를 쓴다**

이 테스트는 **가드를 잘못된 곳(`serializeMutation` 또는 `use-realtime.ts`)에 넣으면 실패한다.** `apps/web/src/editor/use-realtime.test.tsx`에 추가한다:

```ts
  it('편집 권한이 없어도 수신 op는 그대로 적용된다', async () => {
    // Viewer도 실시간 수신·presence는 정상 동작해야 한다(Phase 3 실시간 설계 확정 사항).
    // 안전망 가드를 serializeMutation이나 이 훅에 넣으면 이 테스트가 실패한다.
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    // canEdit은 기본값 false 그대로 둔다.
    renderHook()
    const s = FakeSocket.instances[0]!
    s.onopen?.()
    s.emit({ type: 'ready', seq: 1, peers: [] })
    s.emit({
      type: 'ops', seq: 2, ops: [noteOp(NOTE_A, '남의 메모')],
      actorUserId: 'u-other', actorName: '남',
    })
    await waitFor(() => {
      expect(useEditorStore.getState().model.notes[NOTE_A]?.content).toBe('남의 메모')
    })
  })
```

- [ ] **Step 3: 두 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- use-model use-realtime
```

Expected: 가드 테스트는 FAIL(`expected 'applied' to be 'error'`), 실시간 테스트는 PASS(아직 가드가 없으므로). 실시간 테스트는 **가드를 넣은 뒤에도 계속 PASS**여야 한다 — 이것이 이 테스트의 목적이다.

- [ ] **Step 4: 가드를 `useSubmit`에 넣는다**

`apps/web/src/editor/use-model.ts`의 `useSubmit` 안, 기존 프로젝트 전환 가드 바로 다음에 넣는다:

```ts
      if (useEditorStore.getState().loadedProjectId !== projectId) return 'error'
      // 편집 권한이 없으면 서버 왕복도 낙관적 적용도 하지 않는다. 서버가 이미 'edit' 게이트로
      // 막지만, 여기서 끊어야 낙관적 적용 → FORBIDDEN → resync 롤백으로 화면이 튀지 않는다.
      // ⚠️ 이 가드는 useSubmit 전용이다. serializeMutation이나 use-realtime에 넣으면 수신 op까지
      // 막혀 Viewer의 실시간 화면이 얼어붙는다(Viewer도 수신·presence는 정상 동작해야 한다).
      if (!useEditorStore.getState().canEdit) {
        toast.error('이 프로젝트에 대한 편집 권한이 없습니다')
        return 'error'
      }
```

- [ ] **Step 5: 테스트 헬퍼를 만든다**

`apps/web/src/testing/editor-store.ts` 생성:

```ts
import { useEditorStore } from '@/editor/store'

/**
 * 테스트용: 편집 권한을 부여한다.
 *
 * store 기본값은 fail-closed(canEdit=false)라, 편집 동작을 검증하는 테스트는 setLoaded 뒤에
 * 이것을 불러야 한다. 읽기 전용 동작을 검증하는 테스트는 부르지 않거나 canEdit:false로 덮는다.
 */
export function grantEditPermission(
  perms: { canEdit: boolean; canManage: boolean } = { canEdit: true, canManage: true },
): void {
  useEditorStore.getState().setPermissions(perms)
}
```

- [ ] **Step 6: 깨진 기존 테스트를 전부 확인한다**

```bash
pnpm -C apps/web test
```

Expected: FAIL — 편집을 수행하는 테스트들이 깨진다. 실패 목록을 그대로 다음 단계의 작업 목록으로 쓴다.

`setLoaded(`를 호출하는 테스트 파일은 다음 20개다. 깨지는 것은 이 중 **편집을 수행하는** 것들이다(단순 렌더·표시만 검증하는 것은 깨지지 않는다):

```
editor/custom-field-panel.test.tsx   editor/relationship-panel.test.tsx
editor/dict-import-section.test.tsx  editor/resource-panel.test.tsx
editor/dict-panel.test.tsx           editor/snapshot-diff.test.tsx
editor/domain-panel.test.tsx         editor/table-tree.test.tsx
editor/edit-panel.test.tsx           editor/toolbar.test.tsx
editor/export-dialog.test.tsx        editor/undo-redo.test.tsx
editor/export-scope-select.test.tsx  editor/use-model.test.tsx
editor/group-panel.test.tsx          editor/use-realtime.test.tsx
editor/group-view-select.test.tsx    editor/index-section.test.tsx
editor/group-view.test.tsx           editor/naming-check.test.tsx
```

- [ ] **Step 7: 깨진 테스트에 편집 권한을 부여한다**

실패한 각 테스트 파일에서 `useEditorStore.getState().setLoaded(...)` 호출 **바로 다음 줄**에 `grantEditPermission()`을 넣고, 파일 상단에 import를 추가한다:

```ts
import { grantEditPermission } from '@/testing/editor-store'
```

예시 (`toolbar.test.tsx`):

```ts
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().enterGroupView('g1')
```

**Step 1에서 새로 쓴 가드 테스트와 Step 2의 실시간 테스트에는 넣지 않는다** — 그 둘은 권한 없음을 검증한다.

- [ ] **Step 8: 전체 테스트 통과 확인**

```bash
pnpm -C apps/web test
```

Expected: PASS — 기존 테스트 전부 + 새 테스트 2개

- [ ] **Step 9: 가드가 실제로 동작하는지 역검증한다**

가드 코드 `if (!useEditorStore.getState().canEdit) { … }` 세 줄을 임시로 주석 처리하고 다음을 실행한다:

```bash
pnpm -C apps/web test -- use-model
```

Expected: Step 1의 가드 테스트가 FAIL. 실패하지 않으면 테스트가 아무것도 검증하지 못하는 것이니 테스트를 고친다. 확인 후 주석을 되돌린다.

- [ ] **Step 10: 커밋**

```bash
# Step 7에서 고친 테스트 파일들을 여기에 하나씩 명시적으로 나열해 추가한다.
# `git status --short apps/web/src/editor`로 수정된 파일을 확인하고 그것만 적는다.
# `git add .` / `git add -A` / `git add -u`는 금지다.
git add apps/web/src/editor/use-model.ts apps/web/src/testing/editor-store.ts \
  apps/web/src/editor/use-model.test.tsx apps/web/src/editor/use-realtime.test.tsx \
  <Step 7에서 수정한 나머지 테스트 파일들>
git commit -m "$(cat <<'EOF'
feat(web): 편집 권한 없는 모델 변경을 useSubmit에서 차단

낙관적 적용 → FORBIDDEN → resync 롤백으로 화면이 튀는 대신, 권한이 없으면
서버 왕복 없이 즉시 안내한다. 가드는 useSubmit에만 둔다 — serializeMutation에
넣으면 수신 op까지 막혀 Viewer의 실시간 화면이 얼어붙는다(회귀 테스트 추가).

기존 테스트에는 grantEditPermission 헬퍼로 편집 권한을 명시한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 3: 툴바 편집군 숨김과 읽기 전용 배지

**Files:**
- Modify: `apps/web/src/editor/toolbar.tsx`
- Test: `apps/web/src/editor/toolbar.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`(Task 1), `grantEditPermission`(Task 2)

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/toolbar.test.tsx`에 추가:

```ts
  it('편집 권한이 없으면 편집 버튼 대신 읽기 전용 배지를 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderToolbar()

    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /테이블 추가/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /메모/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /자동 정렬/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '실행 취소' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 실행' })).toBeNull()
  })

  it('편집 권한이 있으면 읽기 전용 배지가 없다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderToolbar()

    expect(screen.queryByText('읽기 전용')).toBeNull()
    expect(screen.getByRole('button', { name: /테이블 추가/ })).toBeInTheDocument()
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- toolbar
```

Expected: FAIL — `Unable to find an element with the text: 읽기 전용`

- [ ] **Step 3: 툴바를 고친다**

`apps/web/src/editor/toolbar.tsx` 상단 import에 배지를 더한다:

```ts
import { Badge } from '@/components/ui/badge'
```

`Toolbar` 함수 안, `const mutate = useModelMutation(projectId)` 위에 셀렉터를 추가한다:

```ts
  const canEdit = useEditorStore((s) => s.canEdit)
```

키보드 단축키 효과에 가드를 넣는다(권한이 없으면 Cmd+Z가 무의미하게 돌지 않게 한다):

```ts
  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, canEdit])
```

`return` 문 맨 앞에 조기 반환을 넣는다(편집 버튼 묶음 전체를 배지로 대체):

```ts
  if (!canEdit) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary">읽기 전용</Badge>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      …기존 그대로…
    </div>
  )
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C apps/web test -- toolbar
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/toolbar.tsx apps/web/src/editor/toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 읽기 전용일 때 툴바 편집군을 배지로 대체

테이블 추가·메모·자동 정렬·삭제·실행 취소·다시 실행을 숨기고 "읽기 전용"
배지를 보여준다. Cmd+Z 전역 단축키도 함께 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 4: 캔버스 고정과 테이블 트리

**Files:**
- Modify: `apps/web/src/editor/canvas.tsx:119-184`
- Modify: `apps/web/src/editor/table-tree.tsx:53`
- Test: `apps/web/src/editor/table-tree.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`(Task 1), `grantEditPermission`(Task 2)

- [ ] **Step 1: 테이블 트리 실패 테스트를 쓴다**

`apps/web/src/editor/table-tree.test.tsx`에 추가(파일에 이미 있는 렌더 헬퍼 이름을 그대로 쓴다):

```ts
  it('편집 권한이 없으면 그룹 추가 버튼을 숨긴다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderTree()

    expect(screen.queryByRole('button', { name: '그룹 추가' })).toBeNull()
    // 조회 기능은 그대로다.
    expect(screen.getByPlaceholderText('테이블 검색')).toBeInTheDocument()
  })
```

렌더 헬퍼 이름과 검색 입력의 placeholder는 파일의 기존 테스트에서 확인해 그대로 맞춘다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- table-tree
```

Expected: FAIL — `expected <button …그룹 추가…> to be null`

- [ ] **Step 3: 테이블 트리를 고친다**

`apps/web/src/editor/table-tree.tsx`에 셀렉터를 추가하고:

```ts
  const canEdit = useEditorStore((s) => s.canEdit)
```

`그룹 추가` 버튼(53행)을 감싼다:

```ts
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="그룹 추가" onClick={onAddGroup}>
            …기존 아이콘 그대로…
          </Button>
        )}
```

- [ ] **Step 4: 캔버스를 고친다**

`apps/web/src/editor/canvas.tsx`의 `Canvas` 함수에 셀렉터를 추가한다(`const mutate = useModelMutation(projectId)` 위):

```ts
  const canEdit = useEditorStore((s) => s.canEdit)
```

`<ReactFlow …>`의 props에 세 줄을 더한다(`connectionMode={ConnectionMode.Loose}` 바로 다음):

```ts
        connectionMode={ConnectionMode.Loose}
        // 위치는 모델 상태라 드래그가 곧 모델 변경이다. 읽기 전용에서는 아예 못 잡게 막는다.
        // 팬·줌·선택은 뷰 상태라 그대로 둔다.
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        deleteKeyCode={canEdit ? 'Backspace' : null}
```

`deleteKeyCode`의 `'Backspace'`는 React Flow의 기본값이라 편집 가능 상태의 동작은 바뀌지 않는다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm -C apps/web test -- table-tree canvas
```

Expected: PASS

- [ ] **Step 6: 전체 웹 테스트 확인**

```bash
pnpm -C apps/web test
```

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/editor/canvas.tsx apps/web/src/editor/table-tree.tsx \
  apps/web/src/editor/table-tree.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 읽기 전용 캔버스 고정과 그룹 추가 숨김

노드 드래그·관계 연결·삭제키를 막는다(위치는 모델 상태라 드래그가 곧 모델
변경이다). 팬·줌·선택·경고 배지는 조회에 필요하므로 유지한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 5: 편집 패널군 입력 잠금

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx`
- Modify: `apps/web/src/editor/relationship-panel.tsx`
- Modify: `apps/web/src/editor/note-panel.tsx`
- Modify: `apps/web/src/editor/group-panel.tsx`
- Modify: `apps/web/src/editor/index-section.tsx`
- Modify: `apps/web/src/editor/custom-fields-section.tsx`
- Test: `apps/web/src/editor/edit-panel.test.tsx`, `relationship-panel.test.tsx`, `group-panel.test.tsx`, `index-section.test.tsx`, `custom-fields-section.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`(Task 1), `grantEditPermission`(Task 2)

**적용 규칙 (모든 파일 공통, 이것이 구속력 있는 기준이다):**

각 파일에서 `useModelMutation`으로 얻은 `mutate(...)`를 호출하는 **모든 핸들러를 찾고**, 그 핸들러를 트리거하는 컨트롤을 아래처럼 처리한다. `grep -n "mutate(" <파일>`로 빠짐없이 열거할 수 있다.

- **버튼·아이콘 버튼** (추가·삭제·재생성·용어 등록·순서 이동 등) → `{canEdit && ( … )}`로 감싸 렌더하지 않는다
- **텍스트/숫자 입력** → `readOnly={!canEdit}` (값이 보여야 하므로 `disabled`가 아니다)
- **select·체크박스** → `disabled={!canEdit}` (`readOnly`가 동작하지 않는다)
- **값 표시, 경고 배지, 접기/펼치기** → 건드리지 않는다

확인된 컨트롤(최소 집합이며, 위 규칙이 우선한다):

| 파일 | 숨길 컨트롤 (접근명) |
|---|---|
| `edit-panel.tsx` | `컬럼 삭제`, `용어로 등록`, `물리명 재생성`, `아래로`, 텍스트 `재생성`·`용어 등록`, 컬럼 추가 |
| `relationship-panel.tsx` | `관계 삭제` |
| `note-panel.tsx` | `메모 삭제` |
| `group-panel.tsx` | `그룹 삭제` |
| `index-section.tsx` | `인덱스 추가`, `인덱스 삭제`, `인덱스 컬럼 제거`, `위로`, `아래로` |
| `custom-fields-section.tsx` | 값 입력 잠금(이 파일은 커스텀 항목 **값** 편집이다) |

- [ ] **Step 1: 실패 테스트를 쓴다**

각 테스트 파일에 읽기 전용 케이스를 하나씩 추가한다. `edit-panel.test.tsx` 예시(다른 파일도 같은 모양으로, 위 표의 접근명을 넣어 작성한다):

```ts
  it('편집 권한이 없으면 입력이 잠기고 편집 버튼이 사라진다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().select('t1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '컬럼 삭제' })).toBeNull()
    expect(screen.queryByRole('button', { name: '물리명 재생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '용어로 등록' })).toBeNull()
    // 값은 그대로 보인다.
    const logical = screen.getByDisplayValue('회원')
    expect(logical).toHaveAttribute('readonly')
  })
```

테이블 id(`'t1'`)·표시값(`'회원'`)·렌더 헬퍼 이름은 각 파일의 기존 테스트에서 쓰는 것을 그대로 맞춘다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- edit-panel relationship-panel group-panel index-section custom-fields-section
```

Expected: FAIL — 버튼이 여전히 있고 입력에 `readonly`가 없다

- [ ] **Step 3: 6개 파일에 규칙을 적용한다**

각 파일에 셀렉터를 추가하고:

```ts
  const canEdit = useEditorStore((s) => s.canEdit)
```

위 "적용 규칙"에 따라 컨트롤을 감싸거나 잠근다. `useEditorStore`가 아직 import되지 않은 파일은 import를 추가한다:

```ts
import { useEditorStore } from './store.js'
```

컴포넌트가 하위 컴포넌트로 쪼개져 있어 셀렉터를 직접 못 쓰는 곳은 `canEdit`을 prop으로 내려준다(`custom-fields-section.tsx`는 `edit-panel.tsx`가 렌더하므로 prop이 자연스럽다).

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C apps/web test
```

Expected: PASS

- [ ] **Step 5: 누락 점검**

각 파일에서 다음을 실행해, 나온 `mutate(` 호출이 전부 `canEdit` 뒤에 있는지 눈으로 확인한다:

```bash
grep -n "mutate(" apps/web/src/editor/edit-panel.tsx apps/web/src/editor/relationship-panel.tsx \
  apps/web/src/editor/note-panel.tsx apps/web/src/editor/group-panel.tsx \
  apps/web/src/editor/index-section.tsx apps/web/src/editor/custom-fields-section.tsx
```

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx apps/web/src/editor/relationship-panel.tsx \
  apps/web/src/editor/note-panel.tsx apps/web/src/editor/group-panel.tsx \
  apps/web/src/editor/index-section.tsx apps/web/src/editor/custom-fields-section.tsx \
  apps/web/src/editor/edit-panel.test.tsx apps/web/src/editor/relationship-panel.test.tsx \
  apps/web/src/editor/group-panel.test.tsx apps/web/src/editor/index-section.test.tsx \
  apps/web/src/editor/custom-fields-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 읽기 전용 편집 패널 — 값은 보이고 입력만 잠근다

테이블·컬럼·관계·메모·그룹·인덱스·커스텀 값 패널에서 편집 버튼을 숨기고
입력을 readOnly/disabled로 잠근다. 타입·도메인·설명 등 Viewer가 봐야 하는
값과 경고 배지는 그대로 둔다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 6: 사전·도메인·커스텀 항목·공용 리소스 다이얼로그

**Files:**
- Modify: `apps/web/src/editor/dict-panel.tsx`
- Modify: `apps/web/src/editor/dict-import-section.tsx`
- Modify: `apps/web/src/editor/domain-panel.tsx`
- Modify: `apps/web/src/editor/domain-edit-dialog.tsx`
- Modify: `apps/web/src/editor/custom-field-panel.tsx`
- Modify: `apps/web/src/editor/custom-field-edit-dialog.tsx`
- Modify: `apps/web/src/editor/resource-panel.tsx`
- Test: `apps/web/src/editor/dict-panel.test.tsx`, `dict-import-section.test.tsx`, `domain-panel.test.tsx`, `custom-field-panel.test.tsx`, `resource-panel.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`(Task 1), `grantEditPermission`(Task 2)

**적용 규칙:** Task 5와 같다 — `grep -n "mutate(" <파일>`로 mutation 트리거를 전부 찾아 버튼은 `{canEdit && …}`, 입력은 `readOnly`/`disabled`. **다이얼로그를 여는 진입점 버튼(`사전`·`도메인`·`커스텀 항목`·`공용 리소스`)은 숨기지 않는다** — 열람은 Viewer의 권한이다.

확인된 컨트롤(최소 집합):

| 파일 | 숨길 컨트롤 |
|---|---|
| `dict-panel.tsx` | `단어 추가`, `용어 추가`, 각 항목의 편집·삭제 아이콘 버튼, 미등록 단어의 등록 액션 |
| `dict-import-section.tsx` | 파일 선택·업로드·적용 버튼 (`양식 다운로드`는 **유지** — 다운로드는 조회다) |
| `domain-panel.tsx` | `도메인 추가`, 각 도메인의 편집·삭제, 일괄 반영 |
| `domain-edit-dialog.tsx` | 저장 버튼 + 모든 입력 잠금(권한이 없으면 애초에 열 수 없지만 방어적으로) |
| `custom-field-panel.tsx` | `항목 추가`, 각 항목의 편집·삭제 |
| `custom-field-edit-dialog.tsx` | 저장 버튼 + 모든 입력 잠금 |
| `resource-panel.tsx` | 가져오기·재동기화·충돌 해소(`유지`/원본 반영) 액션 |

- [ ] **Step 1: 실패 테스트를 쓴다**

각 테스트 파일에 읽기 전용 케이스를 하나씩 추가한다. `dict-panel.test.tsx` 예시:

```ts
  it('편집 권한이 없으면 사전을 열람만 할 수 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))

    // 목록은 보인다.
    expect(screen.getByText('단어·용어 사전')).toBeInTheDocument()
    // 편집 액션은 없다.
    expect(screen.queryByRole('button', { name: /단어 추가/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '편집' })).toBeNull()
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })
```

버튼 접근명은 각 파일의 기존 테스트가 쓰는 것을 그대로 맞춘다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- dict-panel dict-import-section domain-panel custom-field-panel resource-panel
```

Expected: FAIL — 편집 버튼이 여전히 있다

- [ ] **Step 3: 7개 파일에 규칙을 적용한다**

각 파일에 `const canEdit = useEditorStore((s) => s.canEdit)`를 추가하고 위 규칙대로 감싼다. 하위 컴포넌트로 쪼개진 곳은 `canEdit`을 prop으로 내려준다(`domain-edit-dialog.tsx`·`custom-field-edit-dialog.tsx`는 각각 부모 패널이 렌더한다).

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C apps/web test
```

Expected: PASS

- [ ] **Step 5: 누락 점검**

```bash
grep -n "mutate(" apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-import-section.tsx \
  apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-edit-dialog.tsx \
  apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-edit-dialog.tsx \
  apps/web/src/editor/resource-panel.tsx
```

나온 호출이 전부 `canEdit` 뒤에 있는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-import-section.tsx \
  apps/web/src/editor/domain-panel.tsx apps/web/src/editor/domain-edit-dialog.tsx \
  apps/web/src/editor/custom-field-panel.tsx apps/web/src/editor/custom-field-edit-dialog.tsx \
  apps/web/src/editor/resource-panel.tsx \
  apps/web/src/editor/dict-panel.test.tsx apps/web/src/editor/dict-import-section.test.tsx \
  apps/web/src/editor/domain-panel.test.tsx apps/web/src/editor/custom-field-panel.test.tsx \
  apps/web/src/editor/resource-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 읽기 전용일 때 사전·도메인·커스텀 항목·공용 리소스는 열람만

다이얼로그 진입점과 목록·정의 열람은 유지하고 내부 CRUD·Excel 업로드·
가져오기·재동기화만 숨긴다. 양식 다운로드는 조회이므로 유지한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 7: 버전 다이얼로그 — `canEdit`과 `canManage` 구분

이 태스크만 `canManage`를 쓴다. **Project Editor는 스냅샷을 만들 수 있지만 복원·삭제는 못 한다**(서버가 각각 `'edit'`·`'manage'` 게이트다). 지금은 Editor에게도 복원·삭제 버튼이 보여 누르면 FORBIDDEN으로 튕긴다.

**Files:**
- Modify: `apps/web/src/editor/version-dialog.tsx`
- Test: `apps/web/src/editor/version-dialog.test.tsx`

**Interfaces:**
- Consumes: store의 `canEdit`·`canManage`(Task 1), `grantEditPermission`(Task 2)

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/version-dialog.test.tsx`에 세 케이스를 추가한다:

```ts
  it('Viewer는 스냅샷을 만들 수도 복원할 수도 없다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — canEdit=false, canManage=false.
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /버전/ }))

    expect(screen.queryByRole('button', { name: '스냅샷 만들기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '복원' })).toBeNull()
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })

  it('Editor는 스냅샷을 만들 수 있지만 복원·삭제는 못 한다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission({ canEdit: true, canManage: false })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /버전/ }))

    expect(screen.getByRole('button', { name: '스냅샷 만들기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '복원' })).toBeNull()
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })

  it('Project Admin은 복원·삭제까지 할 수 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission({ canEdit: true, canManage: true })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /버전/ }))

    expect(screen.getByRole('button', { name: '스냅샷 만들기' })).toBeInTheDocument()
  })
```

복원·삭제 버튼은 스냅샷이 하나 이상 있어야 렌더된다. 파일의 기존 테스트가 `snapshot.list`를 어떻게 mock하는지 보고 같은 방식으로 스냅샷 1건을 준비한 뒤 단언한다. 버튼 접근명(`복원`·`삭제`·`스냅샷 만들기`)도 기존 테스트에서 확인해 맞춘다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm -C apps/web test -- version-dialog
```

Expected: FAIL — 버튼이 여전히 있다

- [ ] **Step 3: 버전 다이얼로그를 고친다**

`apps/web/src/editor/version-dialog.tsx`에 셀렉터를 추가한다(스냅샷 목록 컴포넌트와 생성 폼 컴포넌트 각각에서 필요한 값을 읽거나 prop으로 내려준다):

```ts
  const canEdit = useEditorStore((s) => s.canEdit)
  const canManage = useEditorStore((s) => s.canManage)
```

- 스냅샷 **만들기** 폼·버튼 → `{canEdit && ( … )}`
- 스냅샷 **복원**·**삭제** 버튼 → `{canManage && ( … )}`
- 스냅샷 목록·이력 탭·비교(diff) 탭 → 그대로 둔다

`useEditorStore`가 import되지 않았으면 추가한다:

```ts
import { useEditorStore } from './store.js'
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm -C apps/web test -- version-dialog
```

Expected: PASS

- [ ] **Step 5: 전체 검증**

```bash
set -a && . ./.env && set +a && pnpm verify; echo "EXIT=$?"
```

Expected: `EXIT=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/version-dialog.tsx apps/web/src/editor/version-dialog.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): 스냅샷 복원·삭제를 manage 권한자에게만 노출

서버는 복원·삭제를 'manage' 게이트로 막는데 화면은 Editor에게도 버튼을
보여줘 누르면 FORBIDDEN으로 튕겼다. 만들기는 canEdit, 복원·삭제는
canManage로 구분한다. 목록·이력·비교는 Viewer도 볼 수 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

### Task 8: 문서 갱신

**Files:**
- Modify: `docs/90-roadmap.md:30`
- Modify: `docs/91-checklist.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 로드맵의 권한 세분화 항목을 결론으로 바꾼다**

`docs/90-roadmap.md`의 Phase 3 마지막 줄을 다음으로 바꾼다:

```markdown
- 권한 세분화 검토 완료 — **새 권한 축은 도입하지 않는다**(그룹 단위·표준 축 분리 모두 필요 미확인). 대신 이미 있는 Project 역할을 화면에 반영: Viewer 읽기 전용 화면, `manage` 전용 동작(스냅샷 복원·삭제) 노출 정리 ([설계](superpowers/specs/2026-08-01-viewer-readonly-ui-design.md))
```

- [ ] **Step 2: 체크리스트에 검토 결과를 남긴다**

`docs/91-checklist.md`의 "Phase 3 착수 전" 절 끝에 항목을 추가한다:

```markdown
- [x] **권한 세분화** — 검토 결과 **새 권한 축 미도입**. 그룹 단위 편집 권한은 `column`·`relationship`·`index`의 그룹 귀속 판정과 사전·도메인 예외 처리가 필요해 비용 대비 실익 미확인, 표준 축(사전·도메인) 분리는 `ENTITY_KINDS`로 구현은 싸지만 필요 미확인. 실제 필요는 "이미 있는 역할이 UI에 반영되지 않는 것"이었고 그것만 해소했다 → [설계](superpowers/specs/2026-08-01-viewer-readonly-ui-design.md)
```

- [ ] **Step 3: HANDOFF의 다음 작업과 기준선을 갱신한다**

`docs/superpowers/HANDOFF.md`의 "다음 작업" 절에서 다음 두 줄을

```markdown
**권한 세분화 검토 → Phase 4(CLI·역설계)** (→ `docs/90-roadmap.md`, `docs/16-cli.md`)

Phase 1~3이 모두 main에 있다. 다음 후보는 (a) 권한 세분화(필요 시 그룹 단위 편집 권한 등), (b) Phase 4 CLI·DDL 역설계, (c) 6절 이월 항목 정리다. 과금은 "추후 검토"로 이동됨 — 최우선 목표는 조직 내에서 쓸 수 있는 도구 완성.
```

다음으로 바꾼다:

```markdown
**Phase 4(CLI·DDL 역설계)** (→ `docs/90-roadmap.md`, `docs/16-cli.md`)

Phase 1~3이 모두 main에 있고 권한 세분화 검토도 끝났다(새 권한 축 미도입 — 근거는 `docs/91-checklist.md`). 다음 후보는 (a) Phase 4 CLI·DDL 역설계, (b) 6절 이월 항목 정리다. 과금은 "추후 검토"로 이동됨 — 최우선 목표는 조직 내에서 쓸 수 있는 도구 완성.
```

테스트 기준선의 숫자를 실제 값으로 갱신한다:

```bash
set -a && . ./.env && set +a && pnpm verify 2>&1 | grep -E "Tests +[0-9]+ passed"
```

나온 수치로 `core NNN · web NNN · server NN (erdd_test) · typecheck 0` 줄을 고친다.

6절 이월 항목에 다음을 추가한다:

```markdown
**권한 (역할 기반 읽기 전용 — 구현 완료, 잔여 한계)**
- 읽기 전용 판정은 `project.get` 응답에 의존한다. 다른 사용자가 내 역할을 낮춰도 **내 화면은 새로고침 전까지 편집 가능 상태로 남는다**(실시간으로 권한 변경을 밀어주지 않는다). 서버가 막으므로 데이터는 안전하고, 편집 시도가 토스트로 거절된다
- Org Owner/Admin은 프로젝트 멤버가 아니어도 항상 `canEdit`·`canManage`가 참이다(`perm.ts`의 기존 정책 그대로)
- presence에서 Viewer와 Editor를 구분해 표시하지 않는다
- `custom-field-edit-dialog`·`domain-edit-dialog`는 읽기 전용에서 열 수 없지만 방어적으로 입력도 잠갔다 — 중복이지만 의도된 것
```

- [ ] **Step 4: 커밋**

```bash
git add docs/90-roadmap.md docs/91-checklist.md docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs: 권한 세분화 검토 결론과 읽기 전용 화면 반영

새 권한 축은 도입하지 않기로 한 근거를 로드맵·체크리스트에 남기고,
HANDOFF의 다음 작업을 Phase 4로 넘긴다. 읽기 전용의 잔여 한계를 이월에 기록.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
)"
```

---

## 브라우저 스모크 (구현 완료 후)

환경 기동은 HANDOFF 4절을 따른다. 스모크용으로 **Viewer 계정 하나와 Editor 계정 하나**를 만들어 같은 프로젝트에 각각 `viewer`·`editor`로 추가해야 한다.

1. **Viewer로 로그인** → 프로젝트를 연다 → 툴바에 `읽기 전용` 배지만 보이고 테이블 추가·메모·자동 정렬·삭제·실행 취소가 없다
2. 캔버스에서 테이블을 **드래그해도 움직이지 않는다**. 팬·줌·클릭 선택은 된다
3. 테이블을 선택하면 편집 패널에 **값은 다 보이는데** 입력이 잠겨 있고 컬럼 추가·삭제가 없다
4. `사전`·`도메인`·`커스텀 항목`·`공용 리소스`를 **열 수 있고** 목록이 보이지만 추가·수정·삭제가 없다
5. `모델 검사`·`내보내기`는 정상 동작한다(Viewer의 권한이다)
6. `버전`을 열면 스냅샷 목록·이력·비교는 보이고 **만들기·복원·삭제가 없다**
7. **Editor로 다른 브라우저에서 같은 프로젝트를 열고** 테이블을 하나 추가한다 → Viewer 화면에 **실시간으로 나타나고** presence에 상대가 보인다 (가드가 `serializeMutation`에 잘못 들어갔다면 여기서 화면이 얼어붙는다)
8. Editor 화면의 `버전`에는 **만들기는 있고 복원·삭제는 없다**
9. Project Admin(또는 Org Owner)으로 열면 복원·삭제까지 보인다
