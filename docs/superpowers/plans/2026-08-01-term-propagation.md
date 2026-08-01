# 용어 수정 시 사용처 일괄 반영 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 용어(Term)를 수정할 때 그 용어를 쓰는 테이블·컬럼에 논리명·물리명·기본 도메인을 함께 반영할지 선택할 수 있게 한다.

**Architecture:** `apps/web/src/editor/dict-edits.ts`에 순수 함수 2개(`planTermPropagation` 계획 산출 / `applyTermPropagation` 적용)를 추가하고, `dict-panel.tsx`의 용어 수정 폼이 저장 직전에 계획을 만들어 확인 다이얼로그를 띄운다. 용어 수정과 사용처 반영은 **한 producer 안에서 연달아 적용**해 단일 mutation(Revision 1건)이 된다.

**Tech Stack:** React 19, zustand, vitest + @testing-library/react. **서버·core·마이그레이션 변경 없음.**

**설계 문서:** [docs/superpowers/specs/2026-08-01-term-propagation-design.md](../specs/2026-08-01-term-propagation-design.md)

## Global Constraints

- **웹 전용.** `packages/core`·`apps/server`를 건드리지 않는다. **새 마이그레이션 없음**(`apps/server/drizzle/`에 파일이 늘면 가정이 틀린 것).
- 불가침: `packages/core/src/diff.ts` · `op.ts`(`ENTITY_KINDS`·`applyOps`) · `integrity.ts` · `model.ts`.
- `planTermPropagation`·`applyTermPropagation`은 **순수 함수**다 — 모델을 입력으로 받아 값을 반환하고, 스토어·IO·`Date.now()`에 접근하지 않는다.
- **용어 수정과 사용처 반영은 단일 mutation이어야 한다**(Revision 1건, undo 한 번). `mutate`를 두 번 부르면 안 된다.
- **`planTermPropagation`에는 반드시 `updateTerm` 적용 *전*의 모델을 넘긴다.** `termUsage`가 `entity.logicalName === term.logicalName`으로 사용처를 찾으므로, 논리명이 바뀐 뒤의 모델을 넘기면 매칭이 0건이 되어 전파가 조용히 사라진다.
- **`domainId`가 `null`로 바뀌는 경우는 전파하지 않는다.** 컬럼의 도메인을 지우면 타입 해석이 통째로 사라진다.
- **HANDOFF §3.4 재발 버그**: 이벤트/폼 값은 producer 진입 **전에** const로 캡처한다(`serializeMutation`이 producer를 마이크로태스크로 미루므로 producer 안에서 lazy read하면 스테일 값을 잡는다). 기존 `TermEditDialog`의 주석이 이 규칙을 명시하고 있으니 그대로 유지한다.
- 새 런타임 의존성 금지. UI 카피는 한국어.
- 커밋은 **명시 파일만** 스테이징(`git add .` / `-A` 금지). `.idea/*`·`.env`는 절대 커밋하지 않는다(워킹트리에 항상 `.idea` 노이즈가 있다).
- 커밋 메시지는 한국어 + 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
  ```
- **테스트 기준선: core 271 · web 278 · server 88 · typecheck 0.** 이 작업은 web만 늘어난다.
  ```bash
  pnpm -s -C apps/web test        # DB 불필요
  pnpm -s -r typecheck            # 출력이 없어야 통과
  ```

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/web/src/editor/dict-edits.ts` (수정) | `planTermPropagation`·`applyTermPropagation` 추가. 기존 `termUsage` 바로 아래 — 같은 "용어 ↔ 사용처" 관심사 |
| `apps/web/src/editor/dict-edits.test.ts` (수정) | 순수 함수 테스트 8건 추가 |
| `apps/web/src/editor/dict-panel.tsx` (수정) | `TermEditDialog`에 확인 단계 삽입 |
| `apps/web/src/editor/dict-panel.test.tsx` (수정) | 화면 테스트 4건 추가 |

---

## Task 1: 전파 계획·적용 순수 함수

**Files:**
- Modify: `apps/web/src/editor/dict-edits.ts`
- Test: `apps/web/src/editor/dict-edits.test.ts`

**Interfaces:**
- Consumes: 기존 `termUsage(model, termId): DictUsageEntry[]` (같은 파일), `ProjectModel`·`Term` (from `@erdd/core`)
- Produces: Task 2가 쓰는 전부
  ```ts
  type TermPropagationChange = {
    field: 'logicalName' | 'physicalName' | 'domainId'
    before: string | null
    after: string | null
  }
  type TermPropagationEntry = {
    kind: 'table' | 'column'
    entityId: string
    label: string
    changes: TermPropagationChange[]
  }
  type TermPropagationPlan = { entries: TermPropagationEntry[] }
  function planTermPropagation(model: ProjectModel, termId: string, patch: Partial<Omit<Term, 'id'>>): TermPropagationPlan
  function applyTermPropagation(model: ProjectModel, plan: TermPropagationPlan): ProjectModel
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/dict-edits.test.ts`의 import 문을 바꾼다.
```ts
import {
  createWord, updateWord, removeWord,
  createTerm, updateTerm, removeTerm,
  wordUsage, termUsage, unregisteredWords,
} from './dict-edits.js'
```
→
```ts
import {
  createWord, updateWord, removeWord,
  createTerm, updateTerm, removeTerm,
  wordUsage, termUsage, unregisteredWords,
  planTermPropagation, applyTermPropagation,
} from './dict-edits.js'
```

파일 **맨 끝**에 **최상위 형제 describe로** 추가한다(기존 `describe('dict-edits', ...)` 안에 중첩하지 말 것):

```ts
/**
 * 전파 테스트용 모델: 용어 '주문번호'(ORD_NO)를 테이블 1개·컬럼 2개가 쓰고 있다.
 * 기존 table()/column() 헬퍼는 physicalName이 ''이라 스프레드로 덮어쓴다.
 */
function propagationModel() {
  let m = createEmptyModel()
  m = createTerm(m, term('tm1'))                     // 주문번호 / ORD_NO / domainId null
  m = {
    ...m,
    domains: {
      d1: {
        id: 'd1', name: '번호', category: null, logicalType: 'BIGINT',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      },
      d2: {
        id: 'd2', name: '코드', category: null, logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      },
    },
    tables: {
      t1: { ...table('t1', '주문번호'), physicalName: 'ORD_NO' },   // 용어와 논리명이 같은 테이블
      t2: { ...table('t2', '주문'), physicalName: 'ORD' },          // 무관한 테이블(컬럼 소속용)
    },
    columns: {
      c1: { ...column('c1', 't2', '주문번호'), physicalName: 'ORD_NO' },
      c2: { ...column('c2', 't2', '주문번호'), physicalName: 'OLD_NO', domainId: 'd2' },
      c3: { ...column('c3', 't2', '주문일자'), physicalName: 'ORD_DT' },  // 무관한 컬럼
    },
  }
  return m
}

describe('planTermPropagation / applyTermPropagation', () => {
  it('물리명만 바뀌면 물리명만 전파하고 논리명은 건드리지 않는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    // t1·c1·c2 모두 물리명이 ORDER_NO와 다르므로 대상, c3는 논리명이 달라 제외
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2', 't1'])
    expect(plan.entries.every((e) => e.changes.every((c) => c.field === 'physicalName'))).toBe(true)

    const next = applyTermPropagation(m, plan)
    expect(next.tables.t1!.physicalName).toBe('ORDER_NO')
    expect(next.tables.t1!.logicalName).toBe('주문번호')      // 논리명 불변
    expect(next.columns.c1!.physicalName).toBe('ORDER_NO')
    expect(next.columns.c2!.physicalName).toBe('ORDER_NO')
    expect(next.columns.c3!.physicalName).toBe('ORD_DT')      // 무관한 컬럼 불변
  })

  it('논리명이 바뀌면 수정 전 논리명 기준으로 사용처를 찾는다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { logicalName: '주문식별번호' })
    // 수정 후 논리명('주문식별번호')으로 찾는 구현이면 매칭이 0건이 되어 이 단언이 실패한다.
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2', 't1'])

    const next = applyTermPropagation(m, plan)
    expect(next.tables.t1!.logicalName).toBe('주문식별번호')
    expect(next.columns.c1!.logicalName).toBe('주문식별번호')
    expect(next.columns.c3!.logicalName).toBe('주문일자')
  })

  it('테이블과 컬럼이 모두 대상에 들어간다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    expect(plan.entries.filter((e) => e.kind === 'table')).toHaveLength(1)
    expect(plan.entries.filter((e) => e.kind === 'column')).toHaveLength(2)
  })

  it('라벨은 수정 전 물리명 기준이고 컬럼은 소속 테이블을 앞에 붙인다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { physicalName: 'ORDER_NO' })
    const byId = Object.fromEntries(plan.entries.map((e) => [e.entityId, e.label]))
    expect(byId.t1).toBe('ORD_NO')
    expect(byId.c1).toBe('ORD.ORD_NO')
    expect(byId.c2).toBe('ORD.OLD_NO')
  })

  it('domainId가 null로 바뀌면 전파하지 않는다(컬럼 도메인 보존)', () => {
    let m = propagationModel()
    m = updateTerm(m, 'tm1', { domainId: 'd1' })        // 용어에 도메인이 있는 상태에서
    const plan = planTermPropagation(m, 'tm1', { domainId: null })
    expect(plan.entries).toEqual([])

    const next = applyTermPropagation(m, plan)
    expect(next.columns.c2!.domainId).toBe('d2')        // 기존 도메인 그대로
  })

  it('domainId가 null→값 / 값→다른 값이면 컬럼에만 전파한다', () => {
    const m = propagationModel()
    const plan = planTermPropagation(m, 'tm1', { domainId: 'd1' })
    // c1(null→d1)·c2(d2→d1)는 대상, t1은 테이블이라 domainId 필드가 없어 변경 없음 → 제외
    expect(plan.entries.map((e) => e.entityId).sort()).toEqual(['c1', 'c2'])
    expect(plan.entries.every((e) => e.changes.every((c) => c.field === 'domainId'))).toBe(true)

    const next = applyTermPropagation(m, plan)
    expect(next.columns.c1!.domainId).toBe('d1')
    expect(next.columns.c2!.domainId).toBe('d1')
  })

  it('바뀐 필드가 없으면 빈 계획이다(값이 같은 키가 patch에 있어도)', () => {
    const m = propagationModel()
    // 폼은 항상 모든 필드를 채워 보낸다 — 값이 같으면 전파 대상이 아니어야 한다.
    const plan = planTermPropagation(m, 'tm1', {
      logicalName: '주문번호', physicalName: 'ORD_NO', domainId: null, description: '설명만 바꿈',
    })
    expect(plan.entries).toEqual([])
  })

  it('사용처가 없거나 이미 값이 일치하는 엔티티는 계획에서 빠진다', () => {
    const m = propagationModel()
    // 사용처 없음
    let m2 = createTerm(m, term('tm2', { logicalName: '배송지', physicalName: 'DLV_ADDR' }))
    expect(planTermPropagation(m2, 'tm2', { physicalName: 'SHIP_ADDR' }).entries).toEqual([])
    // c1은 이미 ORD_NO라 물리명 변경 없음 → t1도 ORD_NO라 제외, c2(OLD_NO)만 남는다
    m2 = { ...m, tables: { ...m.tables, t1: { ...m.tables.t1!, physicalName: 'ORD_NO' } } }
    const plan = planTermPropagation(m2, 'tm1', { physicalName: 'ORD_NO' })
    expect(plan.entries.map((e) => e.entityId)).toEqual(['c2'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C apps/web test dict-edits`
Expected: FAIL — `planTermPropagation is not a function` 또는 import 해석 실패

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/dict-edits.ts`의 `termUsage` 함수 **바로 아래**(`unregisteredWords` 위)에 추가한다:

```ts
/** 전파로 바뀌는 필드 1건. 실제로 값이 달라지는 것만 만든다. */
export type TermPropagationChange = {
  field: 'logicalName' | 'physicalName' | 'domainId'
  before: string | null
  after: string | null
}

export type TermPropagationEntry = {
  kind: 'table' | 'column'
  entityId: string
  /** 화면 표시용. **수정 전 물리명** 기준(사용자가 목록에서 대상을 알아보려면 바뀌기 전 이름이어야 한다). */
  label: string
  changes: TermPropagationChange[]
}

export type TermPropagationPlan = { entries: TermPropagationEntry[] }

/**
 * 용어 수정을 사용처(테이블·컬럼)에 전파할 계획을 만든다. 순수 함수.
 *
 * ⚠️ **반드시 updateTerm을 적용하기 전의 모델을 넘겨야 한다.** termUsage가
 * `entity.logicalName === term.logicalName`으로 사용처를 찾으므로, 논리명이 바뀐 뒤의
 * 모델을 넘기면 매칭이 0건이 되어 전파가 조용히 사라진다.
 *
 * "바뀐 필드"는 patch에 키가 있고 값이 실제로 다른 것만 뜻한다(폼이 항상 모든 필드를
 * 채워 보내므로 이 구분이 없으면 안 바꾼 필드까지 전파된다).
 */
export function planTermPropagation(
  model: ProjectModel, termId: string, patch: Partial<Omit<Term, 'id'>>,
): TermPropagationPlan {
  const term = model.terms[termId]
  if (!term) return { entries: [] }

  const nextLogicalName = 'logicalName' in patch
    ? (patch.logicalName ?? '').trim() : term.logicalName.trim()
  const nextPhysicalName = 'physicalName' in patch
    ? (patch.physicalName ?? '').trim() : term.physicalName.trim()
  const nextDomainId = 'domainId' in patch ? (patch.domainId ?? null) : term.domainId

  const logicalChanged = nextLogicalName !== '' && nextLogicalName !== term.logicalName.trim()
  const physicalChanged = nextPhysicalName !== '' && nextPhysicalName !== term.physicalName.trim()
  // 용어에서 도메인을 떼는 것은 "쓰는 곳의 도메인을 지워라"가 아니다 — null 방향은 전파하지 않는다.
  const domainChanged = nextDomainId !== null && nextDomainId !== term.domainId

  if (!logicalChanged && !physicalChanged && !domainChanged) return { entries: [] }

  const entries: TermPropagationEntry[] = []
  for (const usage of termUsage(model, termId)) {
    const entity = usage.entity
    const changes: TermPropagationChange[] = []
    if (logicalChanged && entity.logicalName !== nextLogicalName) {
      changes.push({ field: 'logicalName', before: entity.logicalName, after: nextLogicalName })
    }
    if (physicalChanged && entity.physicalName !== nextPhysicalName) {
      changes.push({ field: 'physicalName', before: entity.physicalName, after: nextPhysicalName })
    }
    // 테이블에는 domainId 필드가 없다 — 컬럼만 대상.
    if (usage.kind === 'column' && domainChanged && usage.entity.domainId !== nextDomainId) {
      changes.push({ field: 'domainId', before: usage.entity.domainId, after: nextDomainId })
    }
    if (changes.length === 0) continue
    const label = usage.kind === 'column'
      ? `${model.tables[usage.entity.tableId]?.physicalName ?? '?'}.${usage.entity.physicalName}`
      : usage.entity.physicalName
    entries.push({ kind: usage.kind, entityId: entity.id, label, changes })
  }
  return { entries }
}

/**
 * 계획을 모델에 적용한다. 순수 함수.
 * updateTerm과 같은 producer 안에서 연달아 호출해 단일 mutation(Revision 1건)으로 만든다.
 * 계획을 세운 뒤 대상이 사라졌으면(실시간 협업 중 남이 삭제) 그 항목은 조용히 건너뛴다.
 */
export function applyTermPropagation(model: ProjectModel, plan: TermPropagationPlan): ProjectModel {
  if (plan.entries.length === 0) return model
  const tables = { ...model.tables }
  const columns = { ...model.columns }
  for (const entry of plan.entries) {
    if (entry.kind === 'table') {
      const cur = tables[entry.entityId]
      if (!cur) continue
      const next = { ...cur }
      for (const c of entry.changes) {
        if (c.field === 'logicalName') next.logicalName = c.after ?? ''
        else if (c.field === 'physicalName') next.physicalName = c.after ?? ''
      }
      tables[entry.entityId] = next
    } else {
      const cur = columns[entry.entityId]
      if (!cur) continue
      const next = { ...cur }
      for (const c of entry.changes) {
        if (c.field === 'logicalName') next.logicalName = c.after ?? ''
        else if (c.field === 'physicalName') next.physicalName = c.after ?? ''
        else next.domainId = c.after
      }
      columns[entry.entityId] = next
    }
  }
  return { ...model, tables, columns }
}
```

- [ ] **Step 4: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C apps/web test
pnpm -s -r typecheck
```
Expected: web 286 passed (278 + 8), typecheck 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts
git commit -F - <<'EOF'
feat(web): 용어 전파 계획·적용 순수 함수

planTermPropagation은 수정 전 모델·논리명 기준으로 사용처를 확정하고 실제로 값이
달라지는 필드만 계획에 담는다. domainId가 null로 바뀌는 방향은 컬럼 도메인을 지우게
되므로 전파하지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## Task 2: 용어 수정 폼의 확인 단계

**Files:**
- Modify: `apps/web/src/editor/dict-panel.tsx`
- Test: `apps/web/src/editor/dict-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `planTermPropagation`·`applyTermPropagation`·`TermPropagationPlan`, 기존 `updateTerm`
- Produces: 사용자 화면 동작만(다른 태스크가 쓰는 export 없음)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/dict-panel.test.tsx`를 두 곳 고친다.

먼저 import와 afterEach에 tRPC 스텁 준비를 더한다(이 파일은 지금까지 mutation 결과를 단언한 적이
없어 스텁이 없었다 — 아래 3·4번 테스트가 처음이다).
```ts
import { afterEach, describe, expect, it } from 'vitest'
```
→
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
```
그리고 `import { DictPanel } from './dict-panel.js'` 아래에 추가:
```ts
import { mockTrpcFetch } from '@/testing/trpc-mock'
```
afterEach도 바꾼다.
```ts
afterEach(() => { cleanup(); useEditorStore.getState().reset() })
```
→
```ts
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })
```

그다음 파일 **맨 끝**에 **최상위 형제 describe로** 추가한다(기존 `describe('DictPanel', ...)` 안에
중첩하지 말 것):

```tsx
/**
 * loadModelWithDict의 term1은 '등급코드'/GRD_CD이고, 픽스처의 c1·c4가 논리명 '등급코드' ·
 * 물리명 'GRD_CD'로 이미 용어와 일치한다. 물리명을 바꾸면 두 컬럼이 전파 대상이 된다.
 * (논리명 '등급코드'인 테이블은 없으므로 대상은 컬럼 2개다.)
 */
async function openTermEdit() {
  await userEvent.click(screen.getByRole('button', { name: /사전/ }))
  await userEvent.click(screen.getByRole('button', { name: '용어' }))
  await userEvent.click(screen.getByRole('button', { name: '등급코드 편집' }))
}

async function typePhysicalName(value: string) {
  const physical = screen.getByLabelText('물리명')
  await userEvent.clear(physical)
  await userEvent.type(physical, value)
}

describe('DictPanel 용어 전파', () => {
  it('사용처가 있고 바뀐 값이 있으면 확인 단계를 보여준다', async () => {
    loadModelWithDict()
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText(/함께 갱신할까요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2곳에 반영/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '유지' })).toBeInTheDocument()
    // 무엇이 바뀌는지 대상별로 보여준다
    expect(screen.getAllByText(/GRD_CD → GRADE_CD/)).toHaveLength(2)
  })

  it('바뀐 값이 없으면 확인 없이 저장된다', async () => {
    loadModelWithDict()
    renderPanel()
    await openTermEdit()
    await userEvent.type(screen.getByLabelText('설명'), '설명만 수정')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(screen.queryByText(/함께 갱신할까요/)).not.toBeInTheDocument()
  })

  it('유지를 고르면 용어만 바뀌고 사용처는 그대로다', async () => {
    loadModelWithDict()
    // 스토어는 seq 1로 로드된다. 낙관적 갱신이 롤백되지 않으려면 mutation이 성공해야 하고,
    // 반환 seq는 정확히 seqBefore+1(=2)이어야 한다 — 다른 값이면 use-model의 resync 경로가
    // 발동해 model.get을 부르고 낙관적 상태를 덮어쓴다.
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await userEvent.click(await screen.findByRole('button', { name: '유지' }))

    await waitFor(() => expect(useEditorStore.getState().model.terms.term1!.physicalName).toBe('GRADE_CD'))
    const m = useEditorStore.getState().model
    expect(m.columns.c1!.physicalName).toBe('GRD_CD')   // 사용처는 그대로
    expect(m.columns.c4!.physicalName).toBe('GRD_CD')
  })

  it('반영을 고르면 용어와 사용처가 한 번의 mutation으로 함께 바뀐다', async () => {
    loadModelWithDict()
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await userEvent.click(await screen.findByRole('button', { name: /2곳에 반영/ }))

    await waitFor(() => expect(useEditorStore.getState().model.columns.c1!.physicalName).toBe('GRADE_CD'))
    const m = useEditorStore.getState().model
    expect(m.terms.term1!.physicalName).toBe('GRADE_CD')
    expect(m.columns.c4!.physicalName).toBe('GRADE_CD')
    // Revision 1건 — model.mutate가 정확히 한 번만 나간다
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

`waitFor`가 이 파일의 `@testing-library/react` import에 없으면 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -s -C apps/web test dict-panel`
Expected: FAIL — `함께 갱신할까요` 텍스트를 찾지 못함

- [ ] **Step 3: import를 추가한다**

`apps/web/src/editor/dict-panel.tsx`의 `./dict-edits.js` import에 3개를 더한다.
```ts
  createTerm, createWord, removeTerm, removeWord, termUsage, unregisteredWords, updateTerm, updateWord,
```
→
```ts
  createTerm, createWord, removeTerm, removeWord, termUsage, unregisteredWords, updateTerm, updateWord,
  planTermPropagation, applyTermPropagation, type TermPropagationPlan,
```
(기존 import 문의 형태에 맞춰 넣는다 — `wordUsage`가 다음 줄에 있으니 줄바꿈 위치는 그대로 둔다.)

- [ ] **Step 4: `TermEditDialog`에 확인 단계를 넣는다**

`TermEditDialog` 컴포넌트 안, `const domains = ...` 아래에 보류 상태를 추가한다.
```ts
  const domains = Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name))
```
→
```ts
  const domains = Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name))

  // 저장 시 전파할 게 있으면 여기에 담고 확인 단계를 띄운다. patch·plan은 클릭 시점에 확정된 값이다.
  const [pending, setPending] = useState<
    { termId: string; patch: Partial<Omit<Term, 'id'>>; plan: TermPropagationPlan } | null
  >(null)
```

`onSave`의 수정 분기(`const termId = term.id`부터 `onOpenChange(false)`까지)를 바꾼다.
```ts
    const termId = term.id
    void mutate((m) => updateTerm(m, termId, {
      logicalName: trimmedLogicalName,
      physicalName: trimmedPhysicalName,
      domainId: nextDomainId,
      description: trimmedDescription === '' ? null : trimmedDescription,
    }), { summary: '용어 수정' })
    onOpenChange(false)
  }
```
→
```ts
    const termId = term.id
    const patch = {
      logicalName: trimmedLogicalName,
      physicalName: trimmedPhysicalName,
      domainId: nextDomainId,
      description: trimmedDescription === '' ? null : trimmedDescription,
    }
    // 반드시 updateTerm 적용 전의 모델로 계획을 세운다(논리명이 바뀌면 사용처 판정이 무너진다).
    const plan = planTermPropagation(model, termId, patch)
    if (plan.entries.length === 0) {
      void mutate((m) => updateTerm(m, termId, patch), { summary: '용어 수정' })
      onOpenChange(false)
      return
    }
    setPending({ termId, patch, plan })
  }

  /** 확인 단계의 선택. propagate=false면 용어만 저장한다. */
  const onResolve = (propagate: boolean) => {
    if (!pending) return
    const { termId, patch, plan } = pending      // producer 진입 전에 캡처
    setPending(null)
    void mutate(
      (m) => (propagate
        ? applyTermPropagation(updateTerm(m, termId, patch), plan)
        : updateTerm(m, termId, patch)),
      { summary: propagate ? '용어 수정·사용처 반영' : '용어 수정' },
    )
    onOpenChange(false)
  }
```

편집 다이얼로그의 `open`을 바꿔 확인 단계가 뜰 때 폼을 감춘다.
```tsx
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{term === null ? '용어 추가' : '용어 수정'}</DialogTitle></DialogHeader>
```
→
```tsx
    <>
    <Dialog open={open && pending === null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{term === null ? '용어 추가' : '용어 수정'}</DialogTitle></DialogHeader>
```

그리고 컴포넌트의 닫는 `</Dialog>` 뒤, `)` 앞에 확인 다이얼로그를 형제로 추가한다.
```tsx
      </DialogContent>
    </Dialog>
  )
}
```
→
```tsx
      </DialogContent>
    </Dialog>

    <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            &quot;{term?.logicalName}&quot; 용어를 쓰는 {pending?.plan.entries.length ?? 0}곳을 함께 갱신할까요?
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto text-sm">
          {pending?.plan.entries.map((entry) => (
            <div key={entry.entityId} className="border-b py-2 last:border-b-0">
              <p className="font-mono text-xs font-semibold">{entry.label}</p>
              {entry.changes.map((c) => (
                <p key={c.field} className="text-xs text-muted-foreground">
                  {PROPAGATION_FIELD_LABEL[c.field]}{' '}
                  {displayFieldValue(c.field, c.before, model)} → {displayFieldValue(c.field, c.after, model)}
                </p>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onResolve(false)}>유지</Button>
          <Button type="button" onClick={() => onResolve(true)}>
            {pending?.plan.entries.length ?? 0}곳에 반영
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
```

`TermEditDialog` 함수 **바깥**(파일의 다른 최상위 헬퍼 옆)에 표시용 헬퍼 2개를 추가한다.
```ts
const PROPAGATION_FIELD_LABEL: Record<'logicalName' | 'physicalName' | 'domainId', string> = {
  logicalName: '논리명', physicalName: '물리명', domainId: '도메인',
}

/** 도메인은 UUID 대신 이름으로 보여준다(없으면 '없음'). */
function displayFieldValue(
  field: 'logicalName' | 'physicalName' | 'domainId', value: string | null, model: ProjectModel,
): string {
  if (field !== 'domainId') return value ?? ''
  if (value === null) return '없음'
  return model.domains[value]?.name ?? value
}
```

`Term`·`ProjectModel` 타입이 이 파일에 아직 import돼 있지 않으면 `@erdd/core`의 기존 타입 import에 더한다.

- [ ] **Step 5: 테스트와 typecheck를 돌린다**

```bash
pnpm -s -C apps/web test
pnpm -s -r typecheck
```
Expected: web 290 passed (286 + 4), typecheck 출력 없음. **기존 `dict-panel.test.tsx` 6건이 하나도 깨지지 않아야 한다** — 확인 단계는 전파할 게 있을 때만 뜨므로 기존 경로는 그대로여야 한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx
git commit -F - <<'EOF'
feat(web): 용어 수정 시 사용처 일괄 반영 확인 단계

전파할 변경이 있을 때만 확인 다이얼로그를 띄우고, 무엇이 어떻게 바뀌는지 엔티티별로
보여준다. 반영을 고르면 용어 수정과 사용처 반영이 한 mutation으로 나가 undo 한 번에
되돌아간다. 도메인은 UUID 대신 이름으로 표시한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MyoHUXfZxogLMsWTZhhRaK
EOF
```

---

## 완료 기준

- core 271 · web 290 · server 88 · typecheck 0 (증가분: web +12)
- `git diff main --stat`에 `packages/core`·`apps/server`가 **없다**
- `apps/server/drizzle/`에 새 마이그레이션 파일이 **없다**
- 새 런타임 의존성 없음

## 브라우저 스모크 (구현 완료 후, 별도)

1. 사전 → 용어에서 사용처가 있는 용어의 **물리명**을 바꾸고 저장 → 확인 다이얼로그에 대상 목록과 물리명 변경이 보인다
2. **[유지]** → 용어만 바뀌고 캔버스의 컬럼 물리명은 그대로, 모델 검사에 `term-mismatch` 경고가 뜬다
3. 되돌린 뒤 **[N곳에 반영]** → 캔버스의 컬럼 물리명이 함께 바뀌고 `term-mismatch` 경고가 사라진다
4. **실행 취소(undo) 한 번**으로 용어와 사용처가 **동시에** 원복된다(Revision 1건 확인)
5. **논리명**을 바꿔도 사용처가 정상 검출된다(수정 전 논리명 기준 확정 확인)
6. 용어의 도메인을 **없음으로** 바꾸면 컬럼 도메인이 유지된다(확인 다이얼로그에 도메인 변경이 뜨지 않는다)
