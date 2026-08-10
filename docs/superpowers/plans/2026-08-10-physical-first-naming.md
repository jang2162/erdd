# 물리명 우선 명명 + 필수값 표시 (트랙 A+B) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 논리명 → 물리명 한 방향뿐이던 명명을 양방향 대칭으로 만들고, 폼에서 필수값을 구분할 수 있게 한다.

**Architecture:** core에는 `required-empty` 경고와 DDL의 빈 물리명 제외만 더한다 — 역생성 함수 `restoreLogicalName`은 **이미 `naming.ts:70`에 있고** DDL 역설계가 쓰고 있으므로 새로 만들지 않는다. 웹은 폼 순서를 뒤집고, 기존 "논리명 커밋 → 물리명 자동 생성" 규칙의 거울상을 편집 패널에 붙이며, 사전 화면에 미등록 **약어** 섹션을 더한다. 필수 표시는 `FieldLabel` 공용 컴포넌트 하나로 통일한다.

**Tech Stack:** TypeScript · React 19 · zustand · zod · vitest · @testing-library/react

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-10-physical-first-naming-design.md` — 이 계획과 어긋나면 **설계가 우선**이다.
- **마이그레이션 없음. 서버 변경 없음.** `apps/server` 아래 파일을 건드리면 범위를 넘은 것이다.
- **`packages/core`는 IO·런타임 의존성 free.** DOM·브라우저 API를 core에 넣지 않는다.
- **`restoreLogicalName`·`generatePhysicalName`의 알고리즘을 고치지 않는다.** 호출만 한다.
- 트랙 C(`2026-08-10-canvas-selection-clipboard-design.md`)가 **같은 저장소에서 병렬로** 돈다.
  - `edit-panel.tsx`에서 이 트랙이 건드리는 것은 **입력 필드 순서·라벨·역생성 핸들러**뿐이다. 컬럼 행의 선택 상태·하이라이트·스크롤은 트랙 C의 것이므로 손대지 않는다.
  - `docs/manual/user-guide.md`에서는 **명명·폼 관련 기존 절만** 고친다. 새 절을 추가하지 않는다.
  - `store.ts`·`table-node.tsx`·`canvas.tsx`·`toolbar.tsx`·`table-tree.tsx`·`use-realtime.ts`는 **건드리지 않는다.**
  - **`main` 체크아웃·머지 금지.** 병합은 컨트롤러가 한다.
  - **`docs/superpowers/HANDOFF.md`·`docs/91-checklist.md`를 건드리지 않는다.** 컨트롤러가 병합 후 일괄 갱신한다.
- 커밋 메시지는 한국어. `git add -A` 금지 — 경로를 명시하고 `add`와 `commit`을 한 명령으로 붙인다.
- **테스트 픽스처 주의:** `buildSampleModel()`(`packages/core/src/testing/fixtures.ts`)은 **`words`·`terms`가 비어 있다.** 명명 관련 테스트는 단어·용어를 직접 주입해야 한다. 기존 테스트(`edit-panel.test.tsx:88`)가 그 형태다.
- **기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 마라.** 이전 태스크 산출물도 고치지 마라. **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라.** 판단은 컨트롤러가 한다.
- **수정 건마다 구분력을 확인하라** — 프로덕션 변경을 되돌려 테스트가 실제로 실패하는지 보고 복구한다(`git checkout -- <path>` → `git status`로 clean 확인). **실패하지 않으면 덮지 말고 그렇다고 보고하라.** 아직 커밋되지 않은 신규 파일은 `git checkout`이 통하지 않으므로, 변조 전 내용을 스크래치에 복사해 두고 편집으로 되돌린 뒤 diff로 확인한다.

**검증 명령** (파이프를 붙이지 마라 — `$?`가 tail의 것이 된다):

```bash
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
pnpm -C packages/core test
pnpm -C apps/web test
```

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/warnings.ts` | `required-empty` 경고 | 수정 |
| `packages/core/src/ddl.ts` | 빈 물리명 테이블 제외 + 경고 | 수정 |
| `apps/web/src/components/field-label.tsx` | 필수 별표를 붙이는 라벨 | **신규** |
| `apps/web/src/editor/model-edits.ts` | `addTable`이 물리명을 비운다 | 수정 |
| `apps/web/src/editor/edit-panel.tsx` | 폼 순서·역생성·필수 표시 | 수정 |
| `apps/web/src/editor/dict-edits.ts` | `unregisteredAbbreviations` | 수정 |
| `apps/web/src/editor/dict-panel.tsx` | 다이얼로그 순서·필수 표시·역방향 섹션 | 수정 |
| `apps/web/src/editor/domain-edit-dialog.tsx` | 필수 표시 | 수정 |
| `apps/web/src/editor/index-section.tsx` | 필수 표시 | 수정 |
| `apps/web/src/components/resource-item-form.tsx` | 순서·필수 표시 | 수정 |
| `docs/manual/user-guide.md` | 매뉴얼 | 수정 |

---

## Task 1: core — `required-empty` 경고

**Files:**
- Modify: `packages/core/src/warnings.ts:7-23` (union), `:147-169` (검사 추가 위치)
- Test: `packages/core/src/warnings.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `Warning['kind']`에 `'required-empty'` 추가. 메시지 형식 `필수 항목 "<라벨>"이(가) 비어 있습니다` — Task 5·6이 이 문자열에 의존하지 않지만, 매뉴얼(Task 10)이 인용한다.

**배경:** 표준 필드의 빈 값 경고가 **지금 하나도 없다.** `custom-required`(`warnings.ts:147-169`)가 유일한 필수 경고이고 커스텀 항목 전용이다. 같은 자리에 같은 모양으로 추가한다 — **`rules` 게이트 밖**이다(명명 규칙과 무관한 완결성 경고).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/warnings.test.ts` 끝에 추가:

```typescript
describe('required-empty', () => {
  it('테이블의 빈 논리명·물리명을 각각 경고한다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.logicalName = ''
    m.tables['t2']!.physicalName = ''
    const ws = computeWarnings(m)
    const t1 = ws.filter((w) => w.kind === 'required-empty' && w.entityId === 't1')
    const t2 = ws.filter((w) => w.kind === 'required-empty' && w.entityId === 't2')
    expect(t1).toHaveLength(1)
    expect(t1[0]!.message).toContain('논리명')
    expect(t1[0]!.scope).toBe('table')
    expect(t2).toHaveLength(1)
    expect(t2[0]!.message).toContain('물리명')
  })

  it('컬럼의 빈 논리명·물리명·타입을 각각 경고하고 tableId를 싣는다', () => {
    const m = buildSampleModel()
    m.columns['c1']!.type = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 'c1')
    expect(ws).toHaveLength(1)
    expect(ws[0]!.scope).toBe('column')
    expect(ws[0]!.tableId).toBe('t1')
    expect(ws[0]!.message).toContain('타입')
  })

  it('한 엔티티에서 여러 필드가 비면 각각 한 건씩 낸다', () => {
    const m = buildSampleModel()
    m.columns['c1']!.logicalName = ''
    m.columns['c1']!.physicalName = ''
    m.columns['c1']!.type = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 'c1')
    expect(ws).toHaveLength(3)
  })

  it('공백만 있는 값도 비어 있는 것으로 본다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.logicalName = '   '
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 't1')
    expect(ws).toHaveLength(1)
  })

  // ⚠️ 이 테스트가 없으면 "항상 경고를 낸다"는 구현도 위 넷을 전부 통과한다.
  it('필수값이 모두 차 있으면 한 건도 내지 않는다', () => {
    const ws = computeWarnings(buildSampleModel()).filter((w) => w.kind === 'required-empty')
    expect(ws).toEqual([])
  })

  // rules 게이트 밖에 있어야 한다 — 명명 규칙을 주지 않아도 나온다.
  it('rules 없이 호출해도 계산된다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.physicalName = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty')
    expect(ws.length).toBeGreaterThan(0)
  })
})
```

`buildSampleModel`이 이미 import돼 있는지 확인하고, 없으면 파일 상단의 import에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/warnings.test.ts`
Expected: FAIL — `required-empty` 경고가 하나도 나오지 않아 `toHaveLength(1)`이 0을 받는다.

- [ ] **Step 3: 구현한다**

`warnings.ts:17`의 union에 한 줄 추가:

```typescript
    | 'custom-required'
    | 'required-empty'
```

`warnings.ts`의 `// 5) 커스텀 항목 필수 미입력` 블록 **바로 앞**에 추가(같은 이유로 `rules` 게이트 밖이다):

```typescript
  // 5) 표준 필드 필수 미입력 — 명명 규칙과 무관한 완결성 경고이므로 rules 게이트 밖에서 계산한다.
  const requiredEmpty = (
    scope: 'table' | 'column', entityId: string, tableId: string | undefined,
    label: string, value: string,
  ) => {
    if (value.trim() !== '') return
    warnings.push({
      kind: 'required-empty', scope, entityId, tableId,
      message: `필수 항목 "${label}"이(가) 비어 있습니다`,
    })
  }
  for (const t of Object.values(model.tables)) {
    requiredEmpty('table', t.id, undefined, '논리명', t.logicalName)
    requiredEmpty('table', t.id, undefined, '물리명', t.physicalName)
  }
  for (const c of Object.values(model.columns)) {
    requiredEmpty('column', c.id, c.tableId, '논리명', c.logicalName)
    requiredEmpty('column', c.id, c.tableId, '물리명', c.physicalName)
    requiredEmpty('column', c.id, c.tableId, '타입', c.type)
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/warnings.test.ts`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

`requiredEmpty` 안의 `if (value.trim() !== '') return`을 지우고 테스트를 돌려 **"필수값이 모두 차 있으면 한 건도 내지 않는다"가 실패**하는지 본다. 그 뒤 `git checkout -- packages/core/src/warnings.ts`로 복구하고 `git status`가 clean인지 확인한다. 실패하지 않으면 덮지 말고 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/warnings.ts packages/core/src/warnings.test.ts && \
git commit -m "feat(core): 표준 필드 빈 값에 required-empty 경고를 낸다"
```

---

## Task 2: core — DDL에서 빈 물리명 테이블 제외

**Files:**
- Modify: `packages/core/src/ddl.ts:193-219`
- Test: `packages/core/src/ddl.test.ts`

**Interfaces:**
- Consumes: Task 1과 무관 (독립)
- Produces: `generateDdl`·`ddlWarnings`의 동작 변경. Task 4가 만드는 "물리명이 빈 테이블"이 이 규칙에 걸린다.

**배경:** Task 4가 `addTable`의 물리명을 비우므로 물리명 없는 테이블이 정상적으로 존재하게 된다. DDL은 `quoteIdentifier(table.physicalName, dialect)`를 그대로 쓰므로(`ddl.ts:99`) `CREATE TABLE ""`가 나온다. **0컬럼 테이블과 같은 정책**(제외 + 경고)으로 처리한다 — 제외 지점은 이미 `generateDdl:194`에 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/ddl.test.ts` 끝에 추가:

```typescript
describe('빈 물리명', () => {
  it('물리명이 빈 테이블은 DDL에서 빠지고 경고가 나온다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.physicalName = ''
    const sql = generateDdl(m, 'postgresql')
    expect(sql).not.toContain('CREATE TABLE ""')
    expect(sql).not.toContain('GRD_CD')          // t1의 유일한 컬럼
    expect(sql).toContain('MBR')                  // t2는 그대로 나온다
    const warns = ddlWarnings(m, 'postgresql')
    expect(warns.some((w) => w.includes('물리명'))).toBe(true)
  })

  it('물리명이 빈 컬럼이 있으면 그 테이블이 통째로 빠진다', () => {
    const m = buildSampleModel()
    m.columns['c3']!.physicalName = ''            // c3는 t2의 컬럼
    const sql = generateDdl(m, 'postgresql')
    expect(sql).not.toContain('CREATE TABLE "MBR"')
    expect(sql).toContain('MBR_GRD')              // t1은 그대로
    const warns = ddlWarnings(m, 'postgresql')
    expect(warns.some((w) => w.includes('물리명'))).toBe(true)
  })

  it('빠진 테이블을 참조하는 FK도 함께 빠진다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.physicalName = ''             // r1의 부모
    const sql = generateDdl(m, 'postgresql')
    expect(sql).not.toContain('FOREIGN KEY')
  })

  // ⚠️ 없으면 "항상 제외한다"는 구현도 위 셋을 통과한다.
  it('물리명이 모두 차 있으면 아무것도 빠지지 않는다', () => {
    const m = buildSampleModel()
    const sql = generateDdl(m, 'postgresql')
    expect(sql).toContain('MBR_GRD')
    expect(sql).toContain('FOREIGN KEY')
    const warns = ddlWarnings(m, 'postgresql')
    expect(warns.some((w) => w.includes('물리명'))).toBe(false)
  })
})
```

`buildSampleModel`·`generateDdl`·`ddlWarnings`가 import돼 있는지 확인하고 없으면 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts`
Expected: FAIL — 빈 물리명 테이블이 `CREATE TABLE ""`로 그대로 나온다.

- [ ] **Step 3: 구현한다**

`ddl.ts`의 `selectedRelationships` **위**에 판정 함수를 추가한다(`generateDdl`과 `ddlWarnings`가 공유한다 — 두 곳에 조건을 복제하면 한쪽만 고쳐질 때 경고 없이 빠지는 테이블이 생긴다):

```typescript
/**
 * DDL로 낼 수 있는 테이블인가. 물리명이 비면 식별자를 만들 수 없다.
 * generateDdl의 제외와 ddlWarnings의 경고가 같은 판정을 써야 하므로 여기 하나만 둔다.
 */
function hasEmptyPhysicalName(model: ProjectModel, table: Table): boolean {
  if (table.physicalName.trim() === '') return true
  return tableColumns(model, table.id).some((c) => c.physicalName.trim() === '')
}
```

`generateDdl:194`를 고친다:

```typescript
  const tables = selectTables(model, scope).filter(
    (t) => tableColumns(model, t.id).length > 0 && !hasEmptyPhysicalName(model, t),
  )
```

`ddlWarnings`의 0컬럼 루프 **뒤**에 추가한다:

```typescript
  for (const t of inScope) {
    if (!hasEmptyPhysicalName(model, t)) continue
    const label = t.physicalName.trim() === '' ? (t.logicalName || t.id) : t.physicalName
    out.push(`${label}: 물리명이 비어 있어 DDL에서 제외됨`)
  }
```

> 물리명이 빈 테이블은 `${t.physicalName}` 접두가 빈 문자열이 되어 `: 물리명이…`로 시작하는 읽을 수 없는 줄이 된다. 그래서 논리명으로 대체한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C packages/core exec vitest run src/ddl.test.ts`
Expected: PASS. **기존 DDL 테스트도 전부 통과해야 한다** — 하나라도 깨지면 픽스처에 빈 물리명이 있다는 뜻이므로 보고한다.

- [ ] **Step 5: 구분력을 확인한다**

`generateDdl`의 `&& !hasEmptyPhysicalName(model, t)`를 지우고 **"물리명이 빈 테이블은 DDL에서 빠지고"**가 실패하는지 본다. 복구 후 `git status` clean 확인.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts && \
git commit -m "feat(core): 물리명이 빈 테이블을 DDL에서 제외하고 경고한다"
```

---

## Task 3: `FieldLabel` 공용 컴포넌트

**Files:**
- Create: `apps/web/src/components/field-label.tsx`
- Test: `apps/web/src/components/field-label.test.tsx`

**Interfaces:**
- Consumes: `@/components/ui/label`의 `Label`
- Produces: `<FieldLabel htmlFor="..." required>논리명</FieldLabel>` — Task 5·6·8·9가 전부 이것을 쓴다. `required`가 없으면 별표가 붙지 않는다.

**배경:** 폼 7곳에 표시를 넣어야 하므로 표기를 한 곳에 모은다. 개별 폼에 「(필수)」를 문자열로 적으면 다음에 형태를 바꿀 때 7곳을 다시 훑어야 한다. `@/components/ui/label`은 shadcn 생성 파일이라 **수정하지 않고 감싼다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/components/field-label.test.tsx`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FieldLabel } from './field-label.js'

afterEach(() => { cleanup() })

describe('FieldLabel', () => {
  it('required면 별표를 붙이고 스크린리더용 텍스트를 준다', () => {
    render(<FieldLabel htmlFor="x" required>논리명</FieldLabel>)
    expect(screen.getByText('논리명')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('(필수)')).toBeInTheDocument()
  })

  it('required가 없으면 별표를 붙이지 않는다', () => {
    render(<FieldLabel htmlFor="x">설명</FieldLabel>)
    expect(screen.getByText('설명')).toBeInTheDocument()
    expect(screen.queryByText('*')).toBeNull()
    expect(screen.queryByText('(필수)')).toBeNull()
  })

  it('htmlFor를 그대로 넘긴다', () => {
    render(
      <>
        <FieldLabel htmlFor="fld" required>논리명</FieldLabel>
        <input id="fld" />
      </>,
    )
    expect(screen.getByLabelText(/논리명/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/components/field-label.test.tsx`
Expected: FAIL — `./field-label.js`를 찾을 수 없다.

- [ ] **Step 3: 구현한다**

`apps/web/src/components/field-label.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/**
 * 필수 여부를 표기하는 폼 라벨. 필수에만 별표를 붙이고 선택에는 아무것도 붙이지 않는다
 * (「(선택)」 표기와 섞으면 규칙이 흐려진다 — 설계 §5.2).
 * 별표는 시각 표시라 aria-hidden이고, 스크린리더에는 sr-only 텍스트로 전달한다.
 */
export function FieldLabel(
  { htmlFor, required, children }: { htmlFor?: string; required?: boolean; children: ReactNode },
) {
  return (
    <Label htmlFor={htmlFor}>
      <span>{children}</span>
      {required && (
        <>
          <span aria-hidden="true" className="text-destructive">*</span>
          <span className="sr-only">(필수)</span>
        </>
      )}
    </Label>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/components/field-label.test.tsx`
Expected: PASS

⚠️ `sr-only` 유틸리티가 이 저장소의 Tailwind 설정에 있는지 확인한다. 없으면 테스트는 통과하지만(텍스트는 DOM에 있다) 화면에 「(필수)」가 그대로 보인다. `grep -rn "sr-only" apps/web/src` 로 기존 사용례를 찾아보고, 없으면 **`className="sr-only"` 대신 인라인으로 숨기지 말고 그 사실을 보고하라.**

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/components/field-label.tsx apps/web/src/components/field-label.test.tsx && \
git commit -m "feat(web): 필수 표시를 담당하는 FieldLabel 컴포넌트"
```

---

## Task 4: `addTable`이 물리명을 비운다

**Files:**
- Modify: `apps/web/src/editor/model-edits.ts:4-22`
- Test: `apps/web/src/editor/model-edits.test.ts`

**Interfaces:**
- Consumes: Task 2 (DDL 제외 규칙이 이미 있어야 빈 물리명이 안전하다)
- Produces: 새 테이블의 `physicalName === ''`. Task 5의 테이블 폼 자동 생성이 이 값을 전제한다.

**배경:** `HANDOFF.md` 6절 이월 항목 — 「새 테이블에 논리명을 입력해도 물리명이 자동 생성되지 않는다」. `addTable`이 `TABLE_n`을 채우는데 편집 패널은 **물리명이 빌 때만** 자동 생성해서, 사용자가 `TABLE_1`을 손으로 지워야 했다. 논리명(`테이블n`)은 **그대로 둔다**(설계 D-A3).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/model-edits.test.ts`에 추가:

```typescript
it('새 테이블의 물리명은 비어 있고 논리명은 임시값이 붙는다', () => {
  const m = addTable(buildSampleModel(), { id: 'new1', position: { x: 0, y: 0 } })
  expect(m.tables['new1']!.physicalName).toBe('')
  expect(m.tables['new1']!.logicalName).not.toBe('')
})

it('연속으로 추가해도 논리명이 서로 다르다', () => {
  let m = addTable(buildSampleModel(), { id: 'new1', position: { x: 0, y: 0 } })
  m = addTable(m, { id: 'new2', position: { x: 0, y: 0 } })
  expect(m.tables['new1']!.logicalName).not.toBe(m.tables['new2']!.logicalName)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/model-edits.test.ts`
Expected: FAIL — `physicalName`이 `'TABLE_1'`이다.

- [ ] **Step 3: 구현한다**

`model-edits.ts`의 `nextTablePhysicalName`을 **논리명 번호 계산으로 바꾼다.** 물리명 기준으로 번호를 세던 것을 논리명 기준으로 옮기는 것이다 — 물리명이 비면 `used` 집합이 전부 빈 문자열이 되어 번호가 항상 1이 된다.

```typescript
/** 새 테이블의 임시 논리명 번호. 「테이블1」이 이미 있으면 2를 쓴다. */
function nextTableLogicalName(model: ProjectModel): string {
  const used = new Set(Object.values(model.tables).map((t) => t.logicalName))
  let n = 1
  while (used.has(`테이블${n}`)) n++
  return `테이블${n}`
}

/**
 * 새 테이블(컬럼 없음). 물리명은 **비워 둔다** — 논리명을 입력하면 편집 패널이 사전으로 생성한다.
 * 물리명이 빈 테이블은 DDL에서 제외되고(core ddl.ts) required-empty 경고가 붙는다.
 */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const table: Table = {
    id, logicalName: nextTableLogicalName(model), physicalName: '',
    comment: null, groupId: null, position, groupPosition: null, custom: {},
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}
```

⚠️ **`nextTablePhysicalName`은 export돼 있다.** 다른 호출처가 있는지 먼저 확인하라:

```bash
grep -rn "nextTablePhysicalName" apps/web/src packages
```

호출처가 이 파일뿐이면 export를 지우고 위 함수로 교체한다. 다른 곳에서 쓰고 있으면 **지우지 말고** 그 사실을 보고하라 — 그 호출처의 처리는 컨트롤러가 판단한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/model-edits.test.ts`
Expected: PASS

그리고 **웹 전체 스위트**를 돌린다 — `TABLE_1`을 기대하던 기존 테스트가 있을 수 있다:

Run: `pnpm -C apps/web test`
Expected: 실패가 있으면 **그 단언을 정정하고** 무엇이 어떻게 어긋났는지 보고한다.

- [ ] **Step 5: 구분력을 확인한다**

`physicalName: ''`를 `physicalName: 'TABLE_1'`로 되돌려 첫 테스트가 실패하는지 본다. 복구 후 `git status` clean 확인.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/model-edits.ts apps/web/src/editor/model-edits.test.ts && \
git commit -m "fix(web): 새 테이블의 물리명을 비워 논리명 입력 시 자동 생성되게 한다"
```

---

## Task 5: 편집 패널 — 테이블 폼 순서·역생성·필수 표시

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx:84-116`
- Test: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `FieldLabel`, Task 4의 빈 물리명
- Produces: 테이블 폼의 DOM 순서(물리명 먼저)와 「논리명 복원」 버튼. Task 6이 컬럼 행에 같은 형태를 만든다.

**배경:** 현재 `:85` 논리명 → `:102` 테이블 물리명 순서다. 이것을 뒤집고, `:92`의 자동 생성 규칙("물리명이 비면 생성")의 거울상을 물리명 커밋에 붙인다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`edit-panel.test.tsx`에 추가:

```typescript
it('테이블 폼은 물리명 입력이 논리명 입력보다 앞에 온다', () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  const physical = screen.getByLabelText(/테이블 물리명/)
  const logical = screen.getAllByLabelText(/논리명/)[0]!   // [0] 테이블
  // compareDocumentPosition: 4 === FOLLOWING (physical 뒤에 logical이 온다)
  expect(physical.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('빈 논리명 테이블은 물리명 입력 시 논리명이 복원된다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '', physicalName: '' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  const physical = screen.getByLabelText(/테이블 물리명/)
  await userEvent.type(physical, 'MBR')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('회원')
  })
})

it('논리명이 이미 있으면 물리명 입력이 논리명을 덮지 않는다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '유지', physicalName: '' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  await userEvent.type(screen.getByLabelText(/테이블 물리명/), 'MBR')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.tables['t1']!.physicalName).toBe('MBR')
  })
  expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('유지')
})

it('사전에 없는 약어면 논리명을 채우지 않는다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '', physicalName: '' } },
  }   // words가 비어 있다 — buildSampleModel의 기본값
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  await userEvent.type(screen.getByLabelText(/테이블 물리명/), 'XYZ')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.tables['t1']!.physicalName).toBe('XYZ')
  })
  expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('')
})

it('「논리명 복원」 버튼은 값이 있어도 덮어쓴다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '옛이름', physicalName: 'MBR' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  await userEvent.click(screen.getByRole('button', { name: '논리명 복원' }))
  await waitFor(() => {
    expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('회원')
  })
})
```

> ⚠️ 라벨 조회를 `getByLabelText('논리명')` 정확일치에서 **정규식 `/논리명/`으로 바꾼 이유**: Task 3의 `FieldLabel`이 필수 항목에 `(필수)` sr-only 텍스트를 덧붙여 접근성 이름이 `논리명 * (필수)`처럼 된다. 정확일치는 그 순간 전부 깨진다. **기존 테스트 중 `getByLabelText('논리명')`·`'테이블 물리명'`·`'타입'`을 쓰는 것들도 이 태스크에서 함께 정규식으로 고친다**(`edit-panel.test.tsx:43`·`:78`·`:83`·`:102`·`:124`). 고친 뒤 실제 접근성 이름이 무엇인지 확인해 보고하라 — 예상과 다르면 `FieldLabel`의 구조가 예상과 다른 것이다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: FAIL — 순서 테스트가 실패하고, 「논리명 복원」 버튼이 없어 `getByRole`이 던진다.

- [ ] **Step 3: 구현한다**

`edit-panel.tsx` 상단 import에 추가:

```typescript
import { restoreLogicalName } from '@erdd/core'
import { FieldLabel } from '@/components/field-label'
```

`:84-116`의 두 블록을 **순서를 바꿔** 아래로 교체한다:

```tsx
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="tbl-physical" required>테이블 물리명</FieldLabel>
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                onClick={() => {
                  const logical = table.logicalName
                  void mutate((m) => {
                    const gen = generatePhysicalName(logical, m.words, m.terms, namingRules)
                    return gen.physicalName ? updateTable(m, tid, { physicalName: gen.physicalName }) : m
                  }, { summary: '물리명 재생성' })
                }}>재생성</Button>
            )}
          </div>
          <CommitInput id="tbl-physical" value={table.physicalName} mono readOnly={!canEdit}
            onCommit={(v) => {
              const physical = v
              void mutate((m) => {
                let next = updateTable(m, tid, { physicalName: physical })
                const cur = next.tables[tid]
                if (cur && cur.logicalName.trim() === '' && physical.trim() !== '') {
                  const r = restoreLogicalName(physical, next.words, next.terms, namingRules)
                  if (r.ok) next = updateTable(next, tid, { logicalName: r.logicalName })
                }
                return next
              }, { summary: '물리명 변경' })
            }} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="tbl-logical" required>논리명</FieldLabel>
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                aria-label="논리명 복원"
                onClick={() => {
                  const physical = table.physicalName
                  void mutate((m) => {
                    const r = restoreLogicalName(physical, m.words, m.terms, namingRules)
                    return r.ok ? updateTable(m, tid, { logicalName: r.logicalName }) : m
                  }, { summary: '논리명 복원' })
                }}>복원</Button>
            )}
          </div>
          <CommitInput id="tbl-logical" value={table.logicalName} readOnly={!canEdit}
            onCommit={(v) => {
              const logical = v
              void mutate((m) => {
                let next = updateTable(m, tid, { logicalName: logical })
                const cur = next.tables[tid]
                if (cur && cur.physicalName.trim() === '' && logical.trim() !== '') {
                  const gen = generatePhysicalName(logical, next.words, next.terms, namingRules)
                  if (gen.physicalName) next = updateTable(next, tid, { physicalName: gen.physicalName })
                }
                return next
              }, { summary: '논리명 변경' })
            }} />
        </div>
```

> **버튼 라벨이 「복원」인데 `aria-label`이 「논리명 복원」인 이유:** 기존 「재생성」 버튼과 같은 형태다(`:243`이 `aria-label="물리명 재생성"`에 표시는 「재생성」). 좁은 사이드바에서 버튼 폭을 아끼면서 접근성 이름은 명확히 남긴다.

`:118`의 「소속 그룹」 라벨도 `FieldLabel`로 바꾸되 **`required`를 주지 않는다**(`groupId`는 nullable).

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 구분력을 확인한다**

두 가지를 각각 확인한다:
1. 물리명 `onCommit`의 `cur.logicalName.trim() === ''` 조건을 지워 **항상 덮어쓰게** 바꾸면 "논리명이 이미 있으면 덮지 않는다"가 실패하는가
2. 두 `<div>` 블록의 순서를 원래대로 되돌리면 순서 테스트가 실패하는가

각각 확인 후 `git checkout -- apps/web/src/editor/edit-panel.tsx`로 복구하고 `git status` clean 확인.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 테이블 폼을 물리명 우선으로 바꾸고 논리명 복원을 추가한다"
```

---

## Task 6: 편집 패널 — 컬럼 행 순서·역생성·필수 표시

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx:161-180` (핸들러), `:215-268` (`ColumnRow`)
- Test: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `restoreLogicalName` import·`FieldLabel`
- Produces: `ColumnRow`에 `onPhysicalName`·`onRestoreLogical` prop 추가

**배경:** 컬럼 행은 `grid-cols-2` 좌우 배치다(`:233`). 설계 D-A2에 따라 **좌우를 유지하고 순서만** 바꾼다(왼쪽=물리명). 컬럼의 논리명 커밋에는 도메인 자동 지정이 딸려 있다(`:169`) — 역방향에는 **대응물이 없다**(용어 물리명 완전일치로 복원해도 `restoreLogicalName`은 `domainId`를 돌려주지 않는다). 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
it('컬럼 행은 물리명 입력이 논리명 입력보다 앞에 온다', () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')   // t1은 컬럼 c1 하나뿐
  renderPanel()
  const physicals = screen.getAllByLabelText(/물리명/)
  const logicals = screen.getAllByLabelText(/논리명/)
  // [0]은 테이블 폼, [1]이 컬럼 행
  const colPhysical = physicals[1]!
  const colLogical = logicals[1]!
  expect(colPhysical.compareDocumentPosition(colLogical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('빈 논리명 컬럼은 물리명 입력 시 논리명이 복원된다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: '' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  const colPhysical = screen.getAllByLabelText(/물리명/)[1]!
  await userEvent.type(colPhysical, 'MBR')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
  })
})

it('컬럼의 논리명이 이미 있으면 물리명 입력이 덮지 않는다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '유지', physicalName: '' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  await userEvent.type(screen.getAllByLabelText(/물리명/)[1]!, 'MBR')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('MBR')
  })
  expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('유지')
})

it('컬럼의 「논리명 복원」 버튼은 값이 있어도 덮어쓴다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m,
    words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } },
    columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '옛이름', physicalName: 'MBR' } },
  }
  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('t1')
  renderPanel()
  await userEvent.click(screen.getByRole('button', { name: '컬럼 논리명 복원' }))
  await waitFor(() => {
    expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
  })
})
```

> **버튼 `aria-label`이 「컬럼 논리명 복원」인 이유:** Task 5가 테이블 폼에 「논리명 복원」을 만들었으므로, 같은 이름이면 `getByRole`이 둘을 찾아 던진다. 컬럼 쪽은 접두를 붙여 구별한다(기존 컬럼 버튼이 「물리명 재생성」·「용어로 등록」인 것과 같은 자리).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`ColumnRow`의 props 타입(`:215-226`)에 두 줄 추가:

```typescript
  onPhysicalName: (value: string) => void
  onRestoreLogical: () => void
```

`ColumnRow` 본문의 `:233-237`을 교체한다(**순서만 바뀐다 — `grid-cols-2` 유지**):

```tsx
        <div className="grid flex-1 grid-cols-2 gap-2">
          <CommitInput label="물리명" value={c.physicalName} mono readOnly={!canEdit}
            onCommit={props.onPhysicalName} />
          <CommitInput label="논리명" value={c.logicalName} readOnly={!canEdit}
            onCommit={props.onLogicalName} />
        </div>
```

> ⚠️ **`CommitInput`은 `label`을 `aria-label`로만 받고 `FieldLabel`을 쓰지 않는다**(`:34`). 컬럼 행은 라벨 텍스트를 화면에 그리지 않는 압축 레이아웃이라 별표를 붙일 자리가 없다. **컬럼 행에는 별표를 넣지 않는다** — 빈 값은 `required-empty` 경고 배지(`WarningBadge`, `:238`)가 드러낸다. 이 판단이 설계와 어긋나 보이면 구현하지 말고 보고하라.

`:240-247`의 버튼 줄에 「복원」 버튼을 추가한다:

```tsx
      {canEdit && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
            aria-label="물리명 재생성" onClick={props.onRegenerate}>재생성</Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
            aria-label="컬럼 논리명 복원" onClick={props.onRestoreLogical}>복원</Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
            aria-label="용어로 등록" onClick={props.onRegisterTerm}>용어 등록</Button>
        </div>
      )}
```

`:248-262`의 「도메인」 라벨과 `:267`의 「타입」은 이렇게 한다:
- 「도메인」 → `FieldLabel`, **`required` 없음**(nullable)
- 「타입」 → `CommitInput`의 `label="타입"` 그대로 (컬럼 행과 같은 이유로 별표 없음)

`EditPanel`의 `<ColumnRow>` 호출부(`:154-205`)에 두 prop을 넘긴다:

```tsx
            onPhysicalName={(v) => {
              const physical = v
              void mutate((m) => {
                let next = updateColumn(m, c.id, { physicalName: physical })
                const cur = next.columns[c.id]
                if (cur && cur.logicalName.trim() === '' && physical.trim() !== '') {
                  const r = restoreLogicalName(physical, next.words, next.terms, namingRules)
                  if (r.ok) next = updateColumn(next, c.id, { logicalName: r.logicalName })
                }
                return next
              }, { summary: '물리명 변경' })
            }}
            onRestoreLogical={() => {
              const physical = c.physicalName
              void mutate((m) => {
                const r = restoreLogicalName(physical, m.words, m.terms, namingRules)
                return r.ok ? updateColumn(m, c.id, { logicalName: r.logicalName }) : m
              }, { summary: '논리명 복원' })
            }}
```

그리고 `:235-236`에 있던 기존 `onPatch({ physicalName: v })` 경로는 **사라진다**(위 `onPhysicalName`이 대체). `onPatch`는 `isPk`·`nullable`·`type`에 계속 쓰이므로 지우지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

`onPhysicalName`의 `cur.logicalName.trim() === ''` 조건을 지워 "컬럼의 논리명이 이미 있으면 덮지 않는다"가 실패하는지 확인하고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 컬럼 행을 물리명 우선으로 바꾸고 논리명 복원을 추가한다"
```

---

## Task 7: `unregisteredAbbreviations` — 미등록 약어 수집

**Files:**
- Modify: `apps/web/src/editor/dict-edits.ts:205-219`
- Test: `apps/web/src/editor/dict-edits.test.ts`

**Interfaces:**
- Consumes: core `restoreLogicalName`
- Produces: `unregisteredAbbreviations(model: ProjectModel, rules: NamingRules): string[]` — Task 8이 이것을 렌더한다.

**배경:** `unregisteredWords`(`:206`)의 대칭이다. 그쪽은 논리명을 `generatePhysicalName`으로 분해해 `unknownWords`를 모은다. 이쪽은 물리명을 `restoreLogicalName`으로 훑어 `unknownTokens`를 모은다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/dict-edits.test.ts`에 추가:

```typescript
describe('unregisteredAbbreviations', () => {
  const rules = DEFAULT_NAMING_RULES

  it('사전에 없는 약어만 모은다', () => {
    let m = buildSampleModel()
    m = { ...m, words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } } }
    // 픽스처: t1=MBR_GRD, t2=MBR, c1=GRD_CD, c2=MBR_NO, c3=MBR_NM, c4=GRD_CD
    const out = unregisteredAbbreviations(m, rules)
    expect(out).not.toContain('MBR')          // 사전에 있다
    expect(out).toContain('GRD')
    expect(out).toContain('CD')
    expect(out).toContain('NO')
    expect(out).toContain('NM')
  })

  it('중복을 제거한다', () => {
    const out = unregisteredAbbreviations(buildSampleModel(), rules)
    expect(out.length).toBe(new Set(out).size)
  })

  it('빈 물리명은 건너뛴다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.physicalName = ''
    m.columns['c1']!.physicalName = ''
    expect(() => unregisteredAbbreviations(m, rules)).not.toThrow()
    expect(unregisteredAbbreviations(m, rules)).not.toContain('')
  })

  // ⚠️ 없으면 "전부 모은다"는 구현도 위를 통과한다.
  it('모든 약어가 사전에 있으면 빈 배열이다', () => {
    let m = buildSampleModel()
    m = { ...m, words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null },
      w2: { id: 'w2', logicalName: '등급', abbreviation: 'GRD', englishName: null, description: null, origin: null },
      w3: { id: 'w3', logicalName: '코드', abbreviation: 'CD', englishName: null, description: null, origin: null },
      w4: { id: 'w4', logicalName: '번호', abbreviation: 'NO', englishName: null, description: null, origin: null },
      w5: { id: 'w5', logicalName: '명', abbreviation: 'NM', englishName: null, description: null, origin: null },
    } }
    expect(unregisteredAbbreviations(m, rules)).toEqual([])
  })
})
```

> ⚠️ **첫 테스트의 기대값은 `DEFAULT_NAMING_RULES`의 `separator: '_'` 전제다.** 구분자가 있으면 `restoreLogicalName`이 `_`로 쪼개 토큰별로 맞춘다(`naming.ts:84-90`). `MBR_GRD` → `['MBR','GRD']`. 실제 출력이 다르면 **단언을 정정하고 관찰값을 보고하라.**

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/dict-edits.test.ts`
Expected: FAIL — `unregisteredAbbreviations`가 없다.

- [ ] **Step 3: 구현한다**

`dict-edits.ts` 상단 import에 `restoreLogicalName`을 추가하고, `unregisteredWords` 아래에 붙인다:

```typescript
/**
 * 전 테이블·컬럼 물리명을 restoreLogicalName으로 훑었을 때 나오는 unknownTokens의 dedupe된 합집합.
 * unregisteredWords의 대칭 — 그쪽은 논리명에서 미등록 "단어"를, 이쪽은 물리명에서 미등록 "약어"를 낸다.
 */
export function unregisteredAbbreviations(model: ProjectModel, rules: NamingRules): string[] {
  const set = new Set<string>()
  const collect = (physicalName: string) => {
    if (physicalName.trim() === '') return
    const r = restoreLogicalName(physicalName, model.words, model.terms, rules)
    if (!r.ok) r.unknownTokens.forEach((t) => set.add(t))
  }
  for (const t of Object.values(model.tables)) collect(t.physicalName)
  for (const c of Object.values(model.columns)) collect(c.physicalName)
  return [...set]
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/dict-edits.test.ts`
Expected: PASS

- [ ] **Step 5: 구분력을 확인한다**

`if (!r.ok)` 가드를 지워 항상 모으게 바꾸면 **"모든 약어가 사전에 있으면 빈 배열"**이 실패하는지 확인하고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts && \
git commit -m "feat(web): 물리명에서 미등록 약어를 모으는 unregisteredAbbreviations"
```

---

## Task 8: 사전 화면 — 다이얼로그 순서·필수 표시·역방향 섹션

**Files:**
- Modify: `apps/web/src/editor/dict-panel.tsx` — `:64-90`(탭), `:202-270`(미등록 섹션), `:325-365`(단어 다이얼로그), `:451-490`(용어 다이얼로그)
- Test: `apps/web/src/editor/dict-panel.test.tsx`

**Interfaces:**
- Consumes: Task 3 `FieldLabel`, Task 7 `unregisteredAbbreviations`
- Produces: 「미등록 단어」 탭 안의 두 섹션

**배경:** 기존 `UnregisteredWordsSection`(`:202`)은 후보마다 **약어**를 입력받아 `createWord`한다. 역방향은 후보(약어)마다 **논리명**을 입력받아 **같은 `createWord`**를 부른다(설계 §3.3 — 두 번째 생성 경로를 만들지 않는다).

⚠️ **단어·용어 다이얼로그의 「저장」 `disabled`(`:358`·`:488`)를 제거하지 마라.** 설계 D-B1의 "저장을 막지 않는다"는 편집 패널에 관한 것이고, 다이얼로그의 기존 차단은 유지한다. 이 태스크가 다이얼로그에 더하는 것은 **별표뿐**이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`dict-panel.test.tsx`에 추가:

```typescript
it('단어 다이얼로그는 약어가 논리명보다 앞에 온다', async () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
  renderPanel()
  await userEvent.click(screen.getByRole('button', { name: /단어 추가/ }))
  const abbr = screen.getByLabelText(/약어/)
  const logical = screen.getByLabelText(/논리명/)
  expect(abbr.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('용어 다이얼로그는 물리명이 논리명보다 앞에 온다', async () => {
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
  renderPanel()
  await userEvent.click(screen.getByRole('tab', { name: /용어/ }))
  await userEvent.click(screen.getByRole('button', { name: /용어 추가/ }))
  const physical = screen.getByLabelText(/물리명/)
  const logical = screen.getByLabelText(/논리명/)
  expect(physical.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('미등록 약어에 논리명을 입력해 일괄 등록하면 단어가 생긴다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
  renderPanel()
  await userEvent.click(screen.getByRole('tab', { name: /미등록/ }))
  const input = screen.getByLabelText('GRD 논리명')
  await userEvent.type(input, '등급')
  await userEvent.click(screen.getByRole('button', { name: '미등록 약어 일괄 등록' }))
  await waitFor(() => {
    const words = Object.values(useEditorStore.getState().model.words)
    expect(words.some((w) => w.abbreviation === 'GRD' && w.logicalName === '등급')).toBe(true)
  })
})

it('논리명을 입력하지 않은 약어는 등록되지 않는다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
  grantEditPermission()
  renderPanel()
  await userEvent.click(screen.getByRole('tab', { name: /미등록/ }))
  await userEvent.type(screen.getByLabelText('GRD 논리명'), '등급')
  await userEvent.click(screen.getByRole('button', { name: '미등록 약어 일괄 등록' }))
  await waitFor(() => {
    expect(Object.values(useEditorStore.getState().model.words)).toHaveLength(1)
  })
})
```

> `PROJECT_ID`·`renderPanel`·`grantEditPermission`은 이 파일에 이미 있는 헬퍼를 그대로 쓴다. 이름이 다르면 **파일의 기존 헬퍼에 맞추고** 무엇으로 맞췄는지 보고하라. 탭 이름(`/미등록/`)도 실제 렌더 결과를 확인해 맞춘다 — 현재 탭 라벨은 `미등록 단어 (N)` 형태다(`:72`).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/dict-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다**

**(a) 다이얼로그 순서** — 단어 다이얼로그(`:329-355`)에서 「논리명」 블록과 「약어」 블록의 순서를 바꾸고, 둘 다 `FieldLabel ... required`로 교체한다. 「영문명」·「설명」은 `FieldLabel`이되 `required` 없음.

용어 다이얼로그(`:456-485`)도 같게 — 「물리명」을 먼저, 「논리명」을 뒤로. 「도메인 (선택)」 라벨은 **「도메인」으로 바꾸고 `required` 없이** 둔다(설계 §5.2 — 「(선택)」 표기 제거).

**(b) 역방향 섹션** — `UnregisteredWordsSection` 아래에 대칭 컴포넌트를 추가한다:

```tsx
/**
 * 물리명 분해에서 나온 미등록 약어에 논리명을 붙여 일괄 등록한다.
 * UnregisteredWordsSection의 대칭 — 빈 칸이 약어냐 논리명이냐만 다르고 등록은 같은 createWord다.
 */
function UnregisteredAbbreviationsSection(
  { projectId, candidates, canEdit }: { projectId: string; candidates: string[]; canEdit: boolean },
) {
  const mutate = useModelMutation(projectId)
  const [logicalByCandidate, setLogicalByCandidate] = useState<Record<string, string>>({})

  const onBulkRegister = () => {
    // producer 진입 전에 전부 확정한다(serializeMutation이 producer를 지연 실행한다).
    const registrations = candidates
      .map((candidate) => ({
        id: newId(), abbreviation: candidate, logicalName: (logicalByCandidate[candidate] ?? '').trim(),
      }))
      .filter((r) => r.logicalName !== '')
    if (registrations.length === 0) return
    void mutate(
      (m: ProjectModel) => registrations.reduce(
        (acc, r) => createWord(acc, {
          id: r.id, logicalName: r.logicalName, abbreviation: r.abbreviation,
          englishName: null, description: null, origin: null,
        }),
        m,
      ),
      { summary: '미등록 약어 일괄 등록' },
    )
    setLogicalByCandidate({})
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        테이블·컬럼 물리명 분해 중 사전에 없는 약어입니다. 논리명을 입력한 항목만 일괄 등록됩니다
      </p>
      {candidates.length === 0
        ? <p className="text-sm text-muted-foreground">미등록 약어가 없습니다</p>
        : (
            <>
              <ul className="grid max-h-72 gap-2 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li key={candidate} className="flex items-center gap-2 rounded-md border p-2">
                    <span className="flex-1 font-mono font-medium">{candidate}</span>
                    {canEdit && (
                      <Input
                        aria-label={`${candidate} 논리명`} placeholder="논리명" className="w-32"
                        value={logicalByCandidate[candidate] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setLogicalByCandidate((prev) => ({ ...prev, [candidate]: value }))
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <Button size="sm" onClick={onBulkRegister}>미등록 약어 일괄 등록</Button>
              )}
            </>
          )}
    </div>
  )
}
```

> 기존 `UnregisteredWordsSection`의 일괄 등록 버튼에도 **구별되는 이름을 준다** — 지금 무엇으로 렌더되는지 확인하고(`:259` 이후), 두 버튼이 같은 접근성 이름이면 「미등록 단어 일괄 등록」으로 바꾼다. 그 변경이 기존 테스트를 깨면 단언을 정정하고 보고하라.

**(c) 탭에 두 섹션을 함께 렌더** — 「미등록 단어」 탭 내용을 두 섹션으로 나눈다. 후보는 `useMemo`로 계산한다:

```tsx
  const abbrCandidates = useMemo(
    () => unregisteredAbbreviations(model, namingRules), [model, namingRules])
```

탭 라벨의 개수 배지는 **두 후보의 합**으로 바꾼다(`:72`). 탭 제목은 「미등록 단어」에서 **「미등록 항목」**으로 바꾼다 — 약어도 들어가므로 「단어」만으로는 맞지 않는다. 매뉴얼(Task 10)이 이 문구를 인용하므로 **바꾼 문구를 정확히 기록해 보고하라.**

각 섹션 위에 소제목을 둔다: 「논리명 → 약어」 / 「물리명 → 논리명」.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/editor/dict-panel.test.tsx`
Expected: PASS (기존 테스트 포함)

- [ ] **Step 5: 구분력을 확인한다**

`onBulkRegister`의 `.filter((r) => r.logicalName !== '')`를 지워 **"논리명을 입력하지 않은 약어는 등록되지 않는다"**가 실패하는지 확인하고 복구한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx && \
git commit -m "feat(web): 사전 다이얼로그 순서를 뒤집고 미등록 약어 역등록을 추가한다"
```

---

## Task 9: 나머지 폼 — 도메인·인덱스·공용 리소스

**Files:**
- Modify: `apps/web/src/editor/domain-edit-dialog.tsx`, `apps/web/src/editor/index-section.tsx`, `apps/web/src/components/resource-item-form.tsx:132-160`
- Test: 각 파일의 기존 테스트 (`domain-panel.test.tsx`·`index-section.test.tsx`·`resource-item-form.test.tsx`)

**Interfaces:**
- Consumes: Task 3 `FieldLabel`
- Produces: 없음 (마지막 UI 태스크)

- [ ] **Step 1: 현재 라벨을 조사한다**

```bash
grep -n "Label htmlFor" apps/web/src/editor/domain-edit-dialog.tsx apps/web/src/editor/index-section.tsx apps/web/src/components/resource-item-form.tsx
```

각 라벨이 설계 §3.1 표의 **필수**인지 **선택**인지 판정해 목록을 만든다:
- 도메인: `name`·`logicalType` 필수 / `category`·`defaultValue`·`description`·방언별 타입 선택
- 인덱스: `name` 필수
- 공용 리소스 폼: kind에 따라 다르다 — `domain`·`customField`는 「이름」 필수, `word`는 논리명·물리 약어 필수, `term`은 논리명·물리명 필수

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`resource-item-form.test.tsx`에 순서 테스트를 추가한다(이 파일만 논리·물리가 함께 나온다):

```typescript
it('word/term 폼은 물리 입력이 논리 입력보다 앞에 온다', () => {
  renderForm({ kind: 'term' })   // 이 파일의 기존 렌더 헬퍼에 맞춘다
  const physical = screen.getByLabelText(/물리명/)
  const logical = screen.getByLabelText(/논리명/)
  expect(physical.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
```

> 이 파일의 기존 렌더 헬퍼 이름·시그니처를 먼저 읽고 맞춘다. `kind` prop의 실제 값도 확인한다(`:132`가 `kind === 'domain' || kind === 'customField'`를 분기하므로 최소 4종이 있다).

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm -C apps/web exec vitest run src/components/resource-item-form.test.tsx`
Expected: FAIL

- [ ] **Step 4: 구현한다**

세 파일에서 `Label` → `FieldLabel`로 바꾸고 Step 1의 판정대로 `required`를 붙인다. `resource-item-form.tsx:143·152`의 「물리 약어」·「물리명」 블록을 `:132`의 이름 블록 **앞으로** 옮긴다.

⚠️ `resource-item-form.tsx:132`의 `nameLabel`은 kind에 따라 「이름」/「논리명」이 갈린다. **물리 입력이 없는 kind**(`domain`·`customField`)에서는 옮길 것이 없으므로 순서 변경이 그 분기에 영향을 주지 않아야 한다. 조건부 렌더 안에서 순서를 바꿔라.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm -C apps/web test`
Expected: PASS (전체 스위트)

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/domain-edit-dialog.tsx apps/web/src/editor/index-section.tsx \
  apps/web/src/components/resource-item-form.tsx apps/web/src/components/resource-item-form.test.tsx && \
git commit -m "feat(web): 도메인·인덱스·공용 리소스 폼에 필수 표시와 물리 우선 순서를 적용한다"
```

---

## Task 10: 매뉴얼 갱신

**Files:**
- Modify: `docs/manual/user-guide.md` — `:151`, `:156`, `:157`, `:292`, `:301`, 「미등록 단어」 절
- Test: 없음 (문서)

**Interfaces:**
- Consumes: Task 5·6·8이 확정한 실제 화면 문구
- Produces: 없음

⚠️ **트랙 C도 이 파일을 건드린다.** 아래 목록의 줄만 고치고 **새 절을 추가하지 마라.**

- [ ] **Step 1: 실제 화면 문구를 확인한다**

Task 8이 「미등록 단어」 탭 이름을 바꿨다. 구현된 실제 문구를 코드에서 확인하고 그것을 인용한다 — 매뉴얼의 「」 인용이 화면과 어긋나면 안 된다.

```bash
grep -n "미등록" apps/web/src/editor/dict-panel.tsx
grep -n "복원\|재생성" apps/web/src/editor/edit-panel.tsx
```

- [ ] **Step 2: 고친다**

1. **`:151`** (테이블 폼) — 입력 순서를 물리명 먼저로 서술하고, 「새 테이블의 초기 이름은 「테이블1」/`TABLE_1`처럼 비어 있지 않은 임시값이다」를 **「논리명만 「테이블1」 같은 임시값이 붙고 물리명은 비어 있다 — 논리명을 업무 이름으로 고치면 사전으로 물리명이 생성된다」**로 바꾼다(Task 4).
2. **`:156`** — 「각 행에서 왼쪽이 논리명, 오른쪽이 물리명이다」 → **왼쪽이 물리명, 오른쪽이 논리명**. 이어지는 자동 생성 서술에 역방향을 대칭으로 추가한다.
3. **`:157`** — 「재생성」 옆에 「복원」 버튼 설명을 추가한다(물리명 기준으로 논리명을 다시 만든다).
4. **`:292`** — 단어·용어 등록 다이얼로그의 필드 순서를 뒤집어 서술한다. 「도메인 (선택)」 인용을 **「도메인」**으로 고친다(Task 8이 라벨을 바꿨다).
5. **`:301`** — 「물리명 자동 생성은 물리명이 비어 있을 때만…」 아래에 대칭 문장을 추가한다: 논리명 자동 복원도 논리명이 비어 있을 때만 일어나고, 사전에 없는 약어가 하나라도 있으면 채우지 않는다.
6. **「미등록 단어」 절** — 탭 이름 변경과 역방향 섹션(물리명 → 논리명)을 서술한다.
7. **필수 표시** — 폼 절 어딘가에 한 줄: 필수 항목에는 라벨에 별표가 붙고, 비어 있으면 경고로 잡힌다.

- [ ] **Step 3: 인용 검증**

매뉴얼이 「」로 인용한 문구가 실제 코드에 있는지 확인한다:

```bash
grep -n "「" docs/manual/user-guide.md | sed -n '140,200p'
```

바꾼 절의 인용 문구를 하나씩 `apps/web/src`에서 `grep`해 존재를 확인하고, 없으면 매뉴얼을 코드에 맞춘다(코드를 매뉴얼에 맞추지 않는다).

- [ ] **Step 4: 커밋**

```bash
git add docs/manual/user-guide.md && \
git commit -m "docs: 매뉴얼에 물리명 우선 순서·논리명 복원·필수 표시를 반영한다"
```

---

## Task 11: 전체 검증

- [ ] **Step 1: typecheck**

```bash
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

Expected: 둘 다 `EXIT=0`. ⚠️ 출력이 비어 있어도 종료코드가 1이면 실패다.

- [ ] **Step 2: 전체 스위트**

```bash
pnpm -C packages/core test
pnpm -C apps/web test
```

Expected: 전부 그린. **기준선은 core 481 · web 450이고 이 트랙이 올린 만큼 늘어야 한다.** 실제 수를 세어 보고한다.

- [ ] **Step 3: cli·server가 무변경인지 확인**

```bash
git diff --stat main -- packages/cli apps/server
```

Expected: 출력 없음. 있으면 범위를 넘은 것이므로 보고한다.

- [ ] **Step 4: 워킹트리 clean 확인**

```bash
git status
```

Expected: clean. 구분력 확인 중 변조한 파일이 남아 있으면 안 된다.

---

## Self-Review 기록

**Spec coverage:**

| 설계 항목 | 태스크 |
|---|---|
| A-1 폼 순서 (5곳) | Task 5(테이블)·6(컬럼)·8(단어·용어)·9(리소스) |
| A-2 역생성 자동 + 버튼 | Task 5·6 |
| A-3 addTable 물리명 비우기 | Task 4 (+ DDL은 Task 2) |
| A-4 사전 역방향 | Task 7(수집)·8(UI) |
| B-1 필수 표시 | Task 3(공용)·5·6·8·9(적용) |
| B-2 required-empty | Task 1 |
| §3.5 빈 물리명과 DDL | Task 2 |
| §5.4 매뉴얼 | Task 10 |
| §6.3 구분력 | 각 태스크의 Step 5 |
| D-A3 × B-2 상호작용 테스트 | **아래 참조** |

⚠️ **설계 §6.2가 요구한 「D-A3 × B-2 상호작용」 테스트가 위 태스크에 없다.** Task 4는 core 경고를 모르고, Task 1은 `addTable`을 모른다. **Task 5의 Step 1에 다음 테스트를 추가하라**(그 태스크가 두 산출물을 처음으로 함께 쓰는 자리다):

```typescript
it('새 테이블은 물리명 required-empty가 뜨고, 논리명을 넣으면 사라진다', async () => {
  mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
  let m = buildSampleModel()
  m = { ...m, words: { w1: {
    id: 'w1', logicalName: '회원', abbreviation: 'MBR',
    englishName: null, description: null, origin: null,
  } } }
  m = addTable(m, { id: 'newt', position: { x: 0, y: 0 } })
  const before = computeWarnings(m).filter(
    (w) => w.kind === 'required-empty' && w.entityId === 'newt')
  expect(before).toHaveLength(1)          // 물리명만 비어 있다

  useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
  grantEditPermission()
  useEditorStore.getState().select('newt')
  renderPanel()
  const logical = screen.getAllByLabelText(/논리명/)[0]!
  await userEvent.clear(logical)
  await userEvent.type(logical, '회원')
  await userEvent.tab()
  await waitFor(() => {
    expect(useEditorStore.getState().model.tables['newt']!.physicalName).toBe('MBR')
  })
  const after = computeWarnings(useEditorStore.getState().model).filter(
    (w) => w.kind === 'required-empty' && w.entityId === 'newt')
  expect(after).toEqual([])
})
```

`addTable`·`computeWarnings` import를 테스트 파일 상단에 추가해야 한다.

**Placeholder scan:** 통과 — "적절히 처리", "TBD", "비슷하게" 없음. 모든 코드 스텝에 실제 코드가 있다.

**Type consistency:**
- `FieldLabel(htmlFor?, required?, children)` — Task 3에서 정의, 5·6·8·9에서 같은 시그니처로 사용 ✓
- `unregisteredAbbreviations(model, rules): string[]` — Task 7 정의, Task 8 사용 ✓
- `restoreLogicalName(physicalName, words, terms, rules): RestoreLogicalResult` — core 기존 시그니처, Task 5·6·7이 동일하게 호출 ✓
- `ColumnRow`의 `onPhysicalName`·`onRestoreLogical` — Task 6에서 정의와 호출부를 함께 추가 ✓
- `hasEmptyPhysicalName(model, table)` — Task 2 내부 함수, export하지 않음 ✓
