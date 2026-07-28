# Phase 3 스냅샷 diff · 변경분 정의서 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 두 시점의 프로젝트 모델(스냅샷↔스냅샷, 스냅샷↔현재)을 비교해 추가·삭제·변경을 사람이 읽는 형태로 보여주고, 감리 제출용 Excel "변경분 정의서"로 내보낸다.

**Architecture:** 판정·양식은 `packages/core`의 순수 함수, 조달·표시는 `apps/web`. 기존 `diffModels`(→ `Op[]`, 스냅샷 복원·CLI push가 의존)는 건드리지 않고 표시 전용 `diffModelsForDisplay`를 새로 만든다. 서버 변경·마이그레이션 없음(읽기 전용 기능이며 `snapshot.get`이 이미 모델 jsonb를 반환한다).

**Tech Stack:** TypeScript, zod(core), React 19 + TanStack Query + tRPC(web), exceljs(기존, 동적 import), vitest + @testing-library/react.

**설계 문서:** [docs/superpowers/specs/2026-07-28-phase3-snapshot-diff-design.md](../specs/2026-07-28-phase3-snapshot-diff-design.md)

## Global Constraints

- `packages/core`는 IO·런타임 의존성 free. `diffModelsForDisplay`·`buildChangeSheet`는 **순수 함수**.
- **`packages/core/src/diff.ts`(`diffModels`)·`op.ts`(`ENTITY_KINDS`, `applyOps`)·`integrity.ts`는 건드리지 않는다.** 이번 작업은 읽기 전용이라 op 엔진·DB 스키마·마이그레이션 변경이 **전혀 없다**.
- **`EXCEL_SHEET_KEYS`(5개 const 배열)를 바꾸지 않는다.** `export-dialog.tsx`가 이 배열을 순회해 체크박스를 그리므로, 여기에 `'changes'`를 넣으면 내보내기 다이얼로그에 체크박스가 하나 늘어난다(설계 결정과 어긋남 — 변경분 정의서 다운로드는 비교 화면에만 둔다).
- **비교 제외 속성**: `position`, `groupPosition`. 이것만 바뀐 엔티티는 diff 엔트리를 만들지 않는다.
- **엔티티 레벨 누락 필드는 "없음"으로 취급**한다. 옛 스냅샷의 `table`에 `custom` 키가 아예 없으면 `{}`와 같게 보고 변경으로 잡지 않는다.
- **스냅샷 모델은 비교 전에 정규화**한다: `{ ...createEmptyModel(), ...snap.model }` (스냅샷 jsonb는 zod 파싱을 거치지 않는다 — 복원 경로와 동일한 방어).
- 새 런타임 의존성 금지(Excel은 기존 `exceljs` 동적 import 경로 재사용).
- UI 카피는 **한국어**. 이벤트 값은 producer 진입 전 캡처(이번 작업은 뮤테이션이 없어 해당 없음이지만 규칙은 유지).
- 커밋은 **명시 파일만 스테이징**(`git add .` / `git add -A` 금지). `.idea/*`와 루트 `.env`는 커밋하지 않는다.
- 커밋 메시지는 한국어. 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
  ```
- 테스트 기준선(시작 시점): **core 234 · web 242 · server 69(erdd_test) · `pnpm -r typecheck` 0 errors.** 서버는 변경이 없으므로 69 그대로여야 한다.

## 테스트 실행 명령

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```

단일 파일: `pnpm --filter @erdd/core exec vitest run src/model-diff.test.ts`

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/core/src/model-diff.ts` (신규) | `diffModelsForDisplay` — 판정·이름 해석·정렬·좌표 제외 |
| `packages/core/src/model-diff.test.ts` (신규) | 위 함수 테스트 |
| `packages/core/src/excel-sheets.ts` (수정) | `SheetKey`, `SheetData.title?`, `CHANGE_HEADERS`, `buildChangeSheet` |
| `packages/core/src/excel-sheets.test.ts` (수정) | 변경분 시트 테스트 추가 |
| `packages/core/src/index.ts` (수정) | 신규 export |
| `apps/web/src/editor/excel-file.ts` (수정) | 제목 행이 있는 시트 인코딩 |
| `apps/web/src/editor/excel-file.test.ts` (수정) | 제목 행 왕복 테스트 |
| `apps/web/src/editor/snapshot-diff.tsx` (신규) | 비교 화면(기준/비교 선택·결과·다운로드) |
| `apps/web/src/editor/snapshot-diff.test.tsx` (신규) | 화면 테스트 |
| `apps/web/src/editor/version-dialog.tsx` (수정) | `Section`에 `'diff'` 추가 + 토글 버튼 |

---

## Task 1: core 표시 전용 diff (`model-diff.ts`)

**Files:**
- Create: `packages/core/src/model-diff.ts`
- Create: `packages/core/src/model-diff.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ProjectModel`, `EntityKind`, `COLLECTION_BY_KIND`(core 기존)
- Produces:
  - `type DiffChangeKind = 'added' | 'removed' | 'changed'`
  - `type DiffFieldChange = { field: string; label: string; before: string; after: string }`
  - `type DiffEntry = { kind: EntityKind; changeKind: DiffChangeKind; entityId: string; label: string; parentTableId?: string; fields: DiffFieldChange[] }`
  - `type ModelDiff = { entries: DiffEntry[]; counts: { added: number; removed: number; changed: number } }`
  - `function diffModelsForDisplay(base: ProjectModel, target: ProjectModel): ModelDiff`
  - `const DIFF_KIND_LABEL: Record<EntityKind, string>` (Task 2가 Excel `구분` 컬럼에 쓴다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/model-diff.test.ts` (신규):

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'
import { diffModelsForDisplay } from './model-diff.js'

/** 픽스처를 깊은 복사해 한쪽만 고칠 수 있게 한다. */
function clone(m: ProjectModel): ProjectModel {
  return structuredClone(m)
}

describe('diffModelsForDisplay', () => {
  it('같은 모델이면 엔트리가 없다', () => {
    const m = buildSampleModel()
    const d = diffModelsForDisplay(m, clone(m))
    expect(d.entries).toEqual([])
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('추가된 테이블을 added로 잡고 물리명을 라벨로 쓴다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t9'] = {
      id: 't9', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 't9')!
    expect(e.changeKind).toBe('added')
    expect(e.kind).toBe('table')
    expect(e.label).toBe('ORD')
    expect(e.fields).toEqual([])
    expect(d.counts.added).toBe(1)
  })

  it('삭제된 컬럼의 라벨과 소속 테이블을 base에서 해석한다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    delete target.columns['c3']
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 'c3')!
    expect(e.changeKind).toBe('removed')
    expect(e.kind).toBe('column')
    expect(e.label).toBe('MBR.MBR_NM')
    expect(e.parentTableId).toBe('t2')
    expect(d.counts.removed).toBe(1)
  })

  it('변경된 속성만 fields에 담고 한국어 라벨을 붙인다', () => {
    // 픽스처의 c3는 nullable:false다 — false→true로 바꿔야 실제 변경이 된다.
    const base = buildSampleModel()
    const target = clone(base)
    target.columns['c3']!.physicalName = 'MBR_NAME'
    target.columns['c3']!.nullable = true
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 'c3')!
    expect(e.changeKind).toBe('changed')
    const byField = Object.fromEntries(e.fields.map((f) => [f.field, f]))
    expect(byField['physicalName']).toMatchObject({
      label: '물리명', before: 'MBR_NM', after: 'MBR_NAME',
    })
    expect(byField['nullable']).toMatchObject({ label: 'NULL 허용', before: '', after: 'Y' })
    expect(e.fields).toHaveLength(2)
    expect(d.counts.changed).toBe(1)
  })

  it('배치 좌표만 바뀌면 엔트리를 만들지 않는다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t1']!.position = { x: 999, y: 999 }
    target.tables['t1']!.groupPosition = { x: 888, y: 888 }
    expect(diffModelsForDisplay(base, target).entries).toEqual([])
  })

  it('좌표와 실제 속성이 함께 바뀌면 실제 속성만 fields에 남는다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t1']!.position = { x: 999, y: 999 }
    target.tables['t1']!.comment = '설명 추가'
    const e = diffModelsForDisplay(base, target).entries.find((x) => x.entityId === 't1')!
    expect(e.fields.map((f) => f.field)).toEqual(['comment'])
  })

  it('옛 스냅샷처럼 엔티티에 키가 아예 없어도 변경으로 잡지 않는다', () => {
    // 커스텀 항목 도입 이전 스냅샷의 table에는 custom 키가 없다.
    const target = buildSampleModel()
    const base = clone(target)
    const legacy = { ...base.tables['t1']! } as Record<string, unknown>
    delete legacy.custom
    base.tables['t1'] = legacy as unknown as typeof target.tables.t1
    expect(diffModelsForDisplay(base, target).entries).toEqual([])
  })

  it('사전·도메인·커스텀 항목 변경도 잡는다', () => {
    const base = createEmptyModel()
    base.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    const target = clone(base)
    target.words['w1']!.abbreviation = 'MEM'
    target.domains['d1'] = {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    const d = diffModelsForDisplay(base, target)
    expect(d.entries.find((e) => e.entityId === 'w1')).toMatchObject({
      kind: 'word', changeKind: 'changed', label: '회원',
    })
    expect(d.entries.find((e) => e.entityId === 'd1')).toMatchObject({
      kind: 'domain', changeKind: 'added', label: '금액',
    })
  })

  it('객체·배열 속성을 안정적인 문자열로 만든다', () => {
    const base = createEmptyModel()
    base.domains['d1'] = {
      id: 'd1', name: '상태', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: ['Y'], description: null, origin: null,
    }
    const target = clone(base)
    target.domains['d1']!.allowedValues = ['Y', 'N']
    const e = diffModelsForDisplay(base, target).entries[0]!
    const f = e.fields.find((x) => x.field === 'allowedValues')!
    expect(f.before).toBe('Y')
    expect(f.after).toBe('Y, N')
  })

  it('사람이 읽는 순서로 정렬한다(테이블 → 컬럼 → 사전)', () => {
    const base = createEmptyModel()
    const target = clone(base)
    target.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    target.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    target.columns['c1'] = {
      id: 'c1', tableId: 't1', logicalName: '번호', physicalName: 'NO', type: 'INT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {},
    }
    const kinds = diffModelsForDisplay(base, target).entries.map((e) => e.kind)
    expect(kinds).toEqual(['table', 'column', 'word'])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/model-diff.test.ts`
Expected: FAIL — `Cannot find module './model-diff.js'`

- [ ] **Step 3: `model-diff.ts`를 구현한다**

`packages/core/src/model-diff.ts` (신규):

```ts
import type { ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, type EntityKind } from './op.js'

export type DiffChangeKind = 'added' | 'removed' | 'changed'

export type DiffFieldChange = {
  field: string
  label: string
  before: string
  after: string
}

export type DiffEntry = {
  kind: EntityKind
  changeKind: DiffChangeKind
  entityId: string
  /** 사람이 읽는 대상 이름. 'MBR' / 'MBR.MBR_NO' / '회원번호' */
  label: string
  /** 컬럼·인덱스·관계 → 화면에서 이 테이블을 선택해 이동한다. */
  parentTableId?: string
  /** changed일 때만 채운다. added/removed는 빈 배열. */
  fields: DiffFieldChange[]
}

export type ModelDiff = {
  entries: DiffEntry[]
  counts: { added: number; removed: number; changed: number }
}

/** Excel '구분' 컬럼과 화면 그룹 제목이 공유하는 종류 라벨. */
export const DIFF_KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계', index: '인덱스',
  tableGroup: '그룹', domain: '도메인', word: '단어', term: '용어',
  customField: '커스텀 항목', note: '메모',
}

/**
 * 표시 순서 — FK 안전 순서(ENTITY_KINDS)가 아니라 사람이 읽는 순서다.
 * 스키마(테이블→컬럼→관계→인덱스→그룹) 다음에 사전 자산, 마지막이 메모.
 */
const KIND_ORDER: readonly EntityKind[] = [
  'table', 'column', 'relationship', 'index', 'tableGroup',
  'domain', 'word', 'term', 'customField', 'note',
]

/**
 * 배치 좌표는 비교에서 뺀다 — 테이블을 옮기기만 해도 전 테이블이 '변경'으로
 * 잡히면 변경분 정의서가 무의미해진다.
 */
const IGNORED_FIELDS = new Set(['id', 'position', 'groupPosition'])

const FIELD_LABEL: Record<string, string> = {
  logicalName: '논리명', physicalName: '물리명', comment: '설명', description: '설명',
  name: '이름', groupId: '소속 그룹', tableId: '소속 테이블', type: '타입',
  isPk: '기본키', autoIncrement: '자동증가', nullable: 'NULL 허용',
  defaultValue: '기본값', order: '순번', domainId: '도메인', custom: '커스텀 항목',
  abbreviation: '약어', englishName: '영문명', logicalType: '논리 타입',
  dialectTypes: '방언별 타입', allowedValues: '허용값', category: '분류',
  color: '색상', content: '내용', unique: '유니크', columns: '구성 컬럼',
  parentTableId: '부모 테이블', childTableId: '자식 테이블', cardinality: '카디널리티',
  identifying: '식별 관계', columnMappings: '컬럼 매핑', target: '적용 대상',
  options: '선택지', required: '필수', origin: '원본 참조',
}

/** 값 하나를 셀 문자열로. 모든 표시 경로가 이 함수만 쓴다. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Y' : ''
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(formatValue).filter((s) => s !== '').join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => [k, formatValue(val)] as const)
      .filter(([, val]) => val !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${k}=${val}`)
      .join(', ')
  }
  return String(v)
}

type Entity = Record<string, unknown> & { id: string }

function tableLabel(model: ProjectModel, tableId: string | undefined): string {
  if (!tableId) return ''
  const t = model.tables[tableId] as { physicalName?: string; logicalName?: string } | undefined
  return t?.physicalName || t?.logicalName || '?'
}

/**
 * 엔티티의 사람용 이름. 삭제는 base, 추가·변경은 target에서 해석한다 —
 * 삭제된 컬럼의 소속 테이블은 target에 없으므로 base를 봐야 한다.
 */
function labelOf(kind: EntityKind, e: Entity, model: ProjectModel): string {
  switch (kind) {
    case 'table':
      return String(e.physicalName || e.logicalName || '(이름 없음)')
    case 'column': {
      const owner = tableLabel(model, e.tableId as string | undefined)
      const own = String(e.physicalName || e.logicalName || '?')
      return owner ? `${owner}.${own}` : own
    }
    case 'index': {
      const owner = tableLabel(model, e.tableId as string | undefined)
      const own = String(e.name || '?')
      return owner ? `${owner}.${own}` : own
    }
    case 'relationship': {
      if (e.name) return String(e.name)
      const p = tableLabel(model, e.parentTableId as string | undefined)
      const c = tableLabel(model, e.childTableId as string | undefined)
      return `${p} → ${c}`
    }
    case 'note': {
      const head = String(e.content ?? '').slice(0, 20)
      return head === '' ? '메모' : `메모: ${head}`
    }
    case 'tableGroup':
    case 'domain':
    case 'customField':
      return String(e.name || '(이름 없음)')
    case 'word':
    case 'term':
      return String(e.logicalName || '(이름 없음)')
  }
}

function parentTableIdOf(kind: EntityKind, e: Entity): string | undefined {
  if (kind === 'column' || kind === 'index') return e.tableId as string | undefined
  if (kind === 'relationship') return e.childTableId as string | undefined
  return undefined
}

/** base·target 양쪽 키의 합집합에서 무시 속성을 뺀 비교 대상 속성. */
function comparableFields(a: Entity, b: Entity): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !IGNORED_FIELDS.has(k)).sort()
}

/**
 * 두 모델을 비교해 사람이 읽는 변경 목록을 만든다.
 * 적용용 op 배치가 필요하면 diffModels(diff.ts)를 쓴다 — 이 함수는 표시 전용이고
 * 정렬·이름 해석·좌표 제외가 다르다.
 */
export function diffModelsForDisplay(base: ProjectModel, target: ProjectModel): ModelDiff {
  const entries: DiffEntry[] = []

  for (const kind of KIND_ORDER) {
    const collection = COLLECTION_BY_KIND[kind]
    const baseCol = (base[collection] ?? {}) as Record<string, Entity>
    const targetCol = (target[collection] ?? {}) as Record<string, Entity>

    for (const [id, entity] of Object.entries(targetCol)) {
      const before = baseCol[id]
      if (!before) {
        entries.push({
          kind, changeKind: 'added', entityId: id,
          label: labelOf(kind, entity, target),
          parentTableId: parentTableIdOf(kind, entity),
          fields: [],
        })
        continue
      }
      const fields: DiffFieldChange[] = []
      for (const field of comparableFields(before, entity)) {
        const b = formatValue(before[field])
        const a = formatValue(entity[field])
        if (b === a) continue
        fields.push({ field, label: FIELD_LABEL[field] ?? field, before: b, after: a })
      }
      if (fields.length === 0) continue
      entries.push({
        kind, changeKind: 'changed', entityId: id,
        label: labelOf(kind, entity, target),
        parentTableId: parentTableIdOf(kind, entity),
        fields,
      })
    }

    for (const [id, entity] of Object.entries(baseCol)) {
      if (Object.hasOwn(targetCol, id)) continue
      entries.push({
        kind, changeKind: 'removed', entityId: id,
        label: labelOf(kind, entity, base),
        parentTableId: parentTableIdOf(kind, entity),
        fields: [],
      })
    }
  }

  const order = new Map(KIND_ORDER.map((k, i) => [k, i]))
  entries.sort((x, y) =>
    (order.get(x.kind)! - order.get(y.kind)!) || x.label.localeCompare(y.label))

  return {
    entries,
    counts: {
      added: entries.filter((e) => e.changeKind === 'added').length,
      removed: entries.filter((e) => e.changeKind === 'removed').length,
      changed: entries.filter((e) => e.changeKind === 'changed').length,
    },
  }
}
```

> **주의**: `formatValue`가 빈 문자열과 `null`을 똑같이 `''`로 만들기 때문에, `null → ''` 같은 변경은 "변경 없음"으로 취급된다. 이는 의도된 동작이다(정의서에서 구분되지 않는 값이다).

- [ ] **Step 4: `index.ts`에 export를 추가한다**

`packages/core/src/index.ts`의 `diffModels` export 아래에 추가:

```ts
export { diffModelsForDisplay, DIFF_KIND_LABEL } from './model-diff.js'
export type { ModelDiff, DiffEntry, DiffFieldChange, DiffChangeKind } from './model-diff.js'
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -r typecheck`
Expected: PASS (core 234 + 신규 10건 = 244), typecheck 0 errors

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/model-diff.ts packages/core/src/model-diff.test.ts packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): 표시 전용 모델 diff(diffModelsForDisplay) 추가

기존 diffModels(Op[])는 스냅샷 복원·CLI push가 의존하므로 건드리지 않고 별도 함수를 만든다.
FK 안전 순서가 아니라 사람이 읽는 순서로 정렬하고, 삭제된 엔티티의 이름·소속 테이블을
base에서 해석한다. 배치 좌표(position/groupPosition)는 비교에서 제외 — 테이블을 옮기기만
해도 전체가 변경으로 잡히면 변경분 정의서가 무의미해진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 2: core 변경분 정의서 시트 (`excel-sheets.ts`)

**Files:**
- Modify: `packages/core/src/excel-sheets.ts`
- Modify: `packages/core/src/excel-sheets.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ModelDiff`, `DIFF_KIND_LABEL`(Task 1)
- Produces:
  - `type SheetKey = ExcelSheetKey | 'changes'`
  - `SheetData`에 optional `title?: string` 추가 (Task 3이 인코딩에 쓴다)
  - `const CHANGE_HEADERS = ['구분','대상','변경유형','속성','이전값','이후값']`
  - `function buildChangeSheet(diff: ModelDiff, meta: { baseLabel: string; targetLabel: string }): SheetData`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/excel-sheets.test.ts`의 마지막 `})` 앞에 추가한다. 파일 상단 import를 다음으로 보강한다(현재는 `buildDictTemplateSheets, buildExcelSheets, EXCEL_SHEET_NAME`만 가져온다):

```ts
import { createEmptyModel } from './model.js'
import {
  buildChangeSheet, buildDictTemplateSheets, buildExcelSheets, CHANGE_HEADERS, EXCEL_SHEET_NAME,
} from './excel-sheets.js'
import { diffModelsForDisplay } from './model-diff.js'
```

```ts
describe('buildChangeSheet', () => {
  const meta = { baseLabel: 'v1.0', targetLabel: '현재' }

  it('제목 행에 기준·비교 라벨을 담고 헤더가 상수와 같다', () => {
    const m = createEmptyModel()
    const sheet = buildChangeSheet(diffModelsForDisplay(m, m), meta)
    expect(sheet.key).toBe('changes')
    expect(sheet.name).toBe('변경분 정의서')
    expect(sheet.title).toBe('기준: v1.0 · 비교: 현재')
    expect(sheet.headers).toEqual([...CHANGE_HEADERS])
    expect(sheet.rows).toEqual([])
  })

  it('changed는 속성 하나당 한 행을 만든다', () => {
    // 픽스처의 c3는 nullable:false — false→true로 바꿔야 실제 변경이 된다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    target.columns['c3']!.physicalName = 'MBR_NAME'
    target.columns['c3']!.nullable = true
    const sheet = buildChangeSheet(diffModelsForDisplay(base, target), meta)
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows.every((r) => r[0] === '컬럼' && r[1] === 'MBR.MBR_NM')).toBe(true)
    expect(sheet.rows.every((r) => r[2] === '변경')).toBe(true)
    const physical = sheet.rows.find((r) => r[3] === '물리명')!
    expect(physical[4]).toBe('MBR_NM')
    expect(physical[5]).toBe('MBR_NAME')
  })

  it('added/removed는 한 행이고 속성·값 칸이 빈다', () => {
    const base = buildSampleModel()
    const target = structuredClone(base)
    delete target.columns['c3']
    const sheet = buildChangeSheet(diffModelsForDisplay(base, target), meta)
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]).toEqual(['컬럼', 'MBR.MBR_NM', '삭제', '', '', ''])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-sheets.test.ts`
Expected: FAIL — `buildChangeSheet is not exported`

- [ ] **Step 3: `excel-sheets.ts`를 확장한다**

파일 상단 import에 추가:

```ts
import { DIFF_KIND_LABEL, type ModelDiff } from './model-diff.js'
```

`ExcelSheetKey` 정의 **아래**에 추가(기존 `ExcelSheetKey`와 `EXCEL_SHEET_KEYS`는 그대로 둔다):

```ts
/**
 * 워크북에 실릴 수 있는 전체 시트 키. 'changes'(변경분 정의서)는 내보내기 다이얼로그의
 * 체크박스 목록(EXCEL_SHEET_KEYS)에 넣지 않는다 — 비교 화면에서만 만든다.
 */
export type SheetKey = ExcelSheetKey | 'changes'
```

`EXCEL_SHEET_NAME`의 타입을 넓히고 항목을 추가한다:

```ts
export const EXCEL_SHEET_NAME: Record<SheetKey, string> = {
  tableList: '테이블 목록',
  tableSpec: '테이블정의서',
  words: '단어사전',
  terms: '용어사전',
  domains: '도메인정의서',
  changes: '변경분 정의서',
}
```

`DOMAIN_HEADERS` 아래에 추가:

```ts
export const CHANGE_HEADERS = ['구분', '대상', '변경유형', '속성', '이전값', '이후값'] as const
```

`SheetData` 타입을 바꾼다:

```ts
export type SheetData = {
  key: SheetKey
  name: string
  headers: string[]
  rows: string[][]
  /** 있으면 헤더 위 1행에 쓰인다(변경분 정의서의 비교 대상 표기). */
  title?: string
}
```

파일 끝(`buildDictTemplateSheets` 다음)에 추가:

```ts
const CHANGE_KIND_LABEL = { added: '추가', removed: '삭제', changed: '변경' } as const

/**
 * 변경분 정의서 한 시트. changed는 속성 하나당 한 행이고, added/removed는
 * 한 행에 속성·값 칸을 비워 둔다(무엇이 통째로 생기거나 사라졌는지가 정보의 전부다).
 */
export function buildChangeSheet(
  diff: ModelDiff, meta: { baseLabel: string; targetLabel: string },
): SheetData {
  const rows: string[][] = []
  for (const e of diff.entries) {
    const head = [DIFF_KIND_LABEL[e.kind], e.label, CHANGE_KIND_LABEL[e.changeKind]]
    if (e.fields.length === 0) {
      rows.push([...head, '', '', ''])
      continue
    }
    for (const f of e.fields) rows.push([...head, f.label, f.before, f.after])
  }
  return {
    key: 'changes',
    name: EXCEL_SHEET_NAME.changes,
    title: `기준: ${meta.baseLabel} · 비교: ${meta.targetLabel}`,
    headers: [...CHANGE_HEADERS],
    rows,
  }
}
```

> `buildExcelSheets`의 `opts.sheets` 타입은 `readonly ExcelSheetKey[]` **그대로 둔다** — `'changes'`를 넘길 수 없어야 한다(그 시트를 만드는 빌더가 따로다).

- [ ] **Step 4: `index.ts`에 export를 추가한다**

`excel-sheets.js` export 블록에 `CHANGE_HEADERS`, `buildChangeSheet`를 추가하고, 타입 export에 `SheetKey`를 추가한다:

```ts
export type { ExcelSheetKey, SheetKey, SheetData } from './excel-sheets.js'
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run && pnpm -r typecheck`
Expected: PASS(core 244 + 3 = 247), typecheck 0 errors. `SheetData.key`가 넓어졌지만 `key`로 분기하는 소비자가 없어 web은 그대로 통과해야 한다 — 에러가 나면 그 지점을 보고하라(계획의 가정이 틀린 것이다).

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/excel-sheets.ts packages/core/src/excel-sheets.test.ts packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): 변경분 정의서 시트 빌더(buildChangeSheet) 추가

한 시트 flat(구분·대상·변경유형·속성·이전값·이후값). changed는 속성 하나당 한 행,
added/removed는 한 행에 속성 칸을 비운다. SheetData에 optional title을 추가해
비교 대상(기준·비교)을 시트 안에 남긴다.

'changes'는 EXCEL_SHEET_KEYS(내보내기 다이얼로그가 순회하는 배열)에 넣지 않는다 —
변경분 정의서는 비교 화면에서만 만든다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 3: web Excel 인코더 제목 행 지원 (`excel-file.ts`)

**Files:**
- Modify: `apps/web/src/editor/excel-file.ts`
- Modify: `apps/web/src/editor/excel-file.test.ts`

**Interfaces:**
- Consumes: `SheetData.title`(Task 2)
- Produces: `buildWorkbookBlob`/`downloadExcelWorkbook`이 `title` 있는 시트를 1행 제목·2행 헤더로 인코딩

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/excel-file.test.ts`의 마지막 `})` 앞에 추가:

```ts
describe('제목 행이 있는 시트', () => {
  it('제목을 1행에, 헤더를 2행에 쓴다', async () => {
    const sheet = {
      key: 'changes' as const, name: '변경분 정의서', title: '기준: v1.0 · 비교: 현재',
      headers: ['구분', '대상'], rows: [['컬럼', 'MBR.MBR_NO']],
    }
    const blob = await buildWorkbookBlob([sheet])
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('변경분 정의서')!
    expect(String(ws.getRow(1).getCell(1).value)).toBe('기준: v1.0 · 비교: 현재')
    expect(String(ws.getRow(2).getCell(1).value)).toBe('구분')
    expect(String(ws.getRow(3).getCell(2).value)).toBe('MBR.MBR_NO')
    expect(ws.autoFilter).toMatchObject({ from: { row: 2, column: 1 } })
  })

  it('제목이 없는 시트는 1행이 헤더 그대로다(회귀)', async () => {
    const sheet = {
      key: 'words' as const, name: '단어사전',
      headers: ['논리명', '약어'], rows: [['회원', 'MBR']],
    }
    const blob = await buildWorkbookBlob([sheet])
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('단어사전')!
    expect(String(ws.getRow(1).getCell(1).value)).toBe('논리명')
    expect(String(ws.getRow(2).getCell(1).value)).toBe('회원')
    expect(ws.autoFilter).toMatchObject({ from: { row: 1, column: 1 } })
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/excel-file.test.ts`
Expected: FAIL — 제목 행이 없어 1행이 `구분`으로 나온다

- [ ] **Step 3: `buildWorkbookBlob`을 확장한다**

`apps/web/src/editor/excel-file.ts`의 `buildWorkbookBlob` 안 루프를 교체한다:

```ts
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    // title이 있으면 1행은 비교 대상 표기, 헤더는 2행으로 내려간다.
    if (s.title !== undefined) {
      ws.addRow([s.title])
      ws.getRow(1).font = { italic: true }
    }
    const headerRow = s.title === undefined ? 1 : 2
    ws.addRow([...s.headers])
    ws.getRow(headerRow).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: headerRow }]
    if (s.headers.length > 0) {
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow, column: s.headers.length },
      }
    }
    for (const row of s.rows) ws.addRow([...row])
    ws.columns.forEach((col, i) => {
      // 제목 행은 열 너비 계산에서 뺀다(제목이 길다고 첫 열이 과하게 넓어지지 않도록).
      const header = s.headers[i] ?? ''
      const longest = s.rows.reduce((max, r) => Math.max(max, (r[i] ?? '').length), header.length)
      col.width = Math.min(MAX_COLUMN_WIDTH, Math.max(10, longest + 2))
    })
  }
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/excel-file.test.ts && pnpm -r typecheck`
Expected: PASS(신규 2건 포함), typecheck 0 errors

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/excel-file.ts apps/web/src/editor/excel-file.test.ts
git commit -F - <<'EOF'
feat(web): Excel 인코더가 제목 행이 있는 시트를 지원한다

SheetData.title이 있으면 1행 제목·2행 헤더로 쓰고 autoFilter와 고정 행도 2행 기준으로
잡는다. 제목이 없는 기존 5시트는 1행 헤더 그대로다(회귀 테스트 추가).
열 너비 계산에서 제목 행은 제외한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## Task 4: web 비교 화면 (`snapshot-diff.tsx`)

**Files:**
- Create: `apps/web/src/editor/snapshot-diff.tsx`
- Create: `apps/web/src/editor/snapshot-diff.test.tsx`
- Modify: `apps/web/src/editor/version-dialog.tsx`

**Interfaces:**
- Consumes: `diffModelsForDisplay`, `DIFF_KIND_LABEL`, `buildChangeSheet`(Task 1·2), `downloadExcelWorkbook`(Task 3), `useEditorStore`, `trpc.snapshot.list/get`
- Produces: `<SnapshotDiff projectId={string} onNavigate={() => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/editor/snapshot-diff.test.tsx` (신규). `mockTrpcFetch`로 `snapshot.list`/`snapshot.get`을 스텁한다(기존 web 테스트가 쓰는 헬퍼 — `@/testing/trpc-mock`):

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
import { SnapshotDiff } from './snapshot-diff.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'
const SNAP_ID = '018f6b0e-0000-7000-8000-0000000000b1'

function renderDiff(onNavigate = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<SnapshotDiff projectId={PROJECT_ID} onNavigate={onNavigate} />, { wrapper: w })
}

/** 스냅샷 1개(= 현재 모델에서 컬럼 하나를 지운 상태)를 돌려주는 tRPC 스텁. */
function mockSnapshot(model: unknown) {
  mockTrpcFetch({
    'snapshot.list': () => ({ data: { items: [{
      id: SNAP_ID, name: 'v1.0', description: '', revisionSeq: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
    }] } }),
    'snapshot.get': () => ({ data: {
      id: SNAP_ID, name: 'v1.0', description: '', revisionSeq: 1,
      createdAt: '2026-07-01T00:00:00.000Z', model,
    } }),
  })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('SnapshotDiff', () => {
  it('스냅샷이 없으면 안내만 보여준다', async () => {
    mockTrpcFetch({ 'snapshot.list': () => ({ data: { items: [] } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/스냅샷이 없습니다/)).toBeInTheDocument()
  })

  it('기준 스냅샷과 현재를 비교해 변경 목록과 요약을 보여준다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    delete snapModel.columns['c3']            // 스냅샷에는 없던 컬럼 → 현재에서 '추가'
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/추가 1/)).toBeInTheDocument()
    expect(screen.getByText('MBR.MBR_NM')).toBeInTheDocument()
  })

  it('차이가 없으면 안내를 보여준다', async () => {
    mockSnapshot(structuredClone(buildSampleModel()))
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    renderDiff()
    expect(await screen.findByText(/차이가 없습니다/)).toBeInTheDocument()
  })

  it('테이블·컬럼 항목을 클릭하면 해당 테이블을 선택하고 onNavigate를 부른다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    delete snapModel.columns['c3']
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    const onNavigate = vi.fn()
    renderDiff(onNavigate)
    await userEvent.click(await screen.findByText('MBR.MBR_NM'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableId).toBe('t2'))
    expect(onNavigate).toHaveBeenCalled()
  })

  it('사전 항목은 캔버스에 대응 객체가 없어 클릭 버튼이 아니다', async () => {
    const snapModel = structuredClone(buildSampleModel())
    const current = structuredClone(buildSampleModel())
    current.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    mockSnapshot(snapModel)
    useEditorStore.getState().setLoaded(current, 1, PROJECT_ID)
    renderDiff()
    const item = await screen.findByText('회원')
    expect(item.closest('button')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/snapshot-diff.test.tsx`
Expected: FAIL — `Cannot find module './snapshot-diff.js'`

- [ ] **Step 3: `snapshot-diff.tsx`를 구현한다**

`apps/web/src/editor/snapshot-diff.tsx` (신규):

```tsx
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DIFF_KIND_LABEL, buildChangeSheet, createEmptyModel, diffModelsForDisplay,
  type DiffEntry, type EntityKind, type ProjectModel,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCreatedAt } from '@/lib/format'
import { useEditorStore } from './store.js'
import { downloadExcelWorkbook } from './excel-file.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

/** 'current'는 편집 중인 모델, 그 외는 스냅샷 id. */
type Side = 'current' | string

const CHANGE_LABEL = { added: '추가', removed: '삭제', changed: '변경' } as const

/** 스냅샷 jsonb는 zod 파싱을 거치지 않는다 — 복원 경로와 같은 방식으로 누락 컬렉션을 보충한다. */
function normalize(model: unknown): ProjectModel {
  return { ...createEmptyModel(), ...(model as Partial<ProjectModel>) }
}

/** 캔버스에 대응 객체가 있어 클릭 이동이 되는 종류. */
function isNavigable(kind: EntityKind): boolean {
  return kind === 'table' || kind === 'column' || kind === 'index' || kind === 'relationship'
}

/** 헤더 "버전"의 비교 섹션: 두 시점을 골라 변경 목록을 보고 변경분 정의서를 내보낸다. */
export function SnapshotDiff({
  projectId, onNavigate,
}: { projectId: string; onNavigate: () => void }) {
  const trpc = useTRPC()
  const currentModel = useEditorStore((s) => s.model)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)

  const list = useQuery(trpc.snapshot.list.queryOptions({ projectId }))
  const items = list.data?.items ?? []

  const [base, setBase] = useState<Side | null>(null)
  const [target, setTarget] = useState<Side>('current')
  // 기본값: 기준=최근 스냅샷. 목록이 늦게 오므로 첫 렌더 이후에 정해진다.
  const effectiveBase: Side | null = base ?? items[0]?.id ?? null

  const baseSnap = useQuery(trpc.snapshot.get.queryOptions(
    { projectId, snapshotId: effectiveBase ?? '' },
    { enabled: effectiveBase !== null && effectiveBase !== 'current' },
  ))
  const targetSnap = useQuery(trpc.snapshot.get.queryOptions(
    { projectId, snapshotId: target },
    { enabled: target !== 'current' },
  ))

  const labelOfSide = (side: Side | null): string =>
    side === null ? '' : side === 'current' ? '현재' : items.find((i) => i.id === side)?.name ?? '?'

  const baseModel = effectiveBase === 'current'
    ? currentModel
    : baseSnap.data ? normalize(baseSnap.data.model) : null
  const targetModel = target === 'current'
    ? currentModel
    : targetSnap.data ? normalize(targetSnap.data.model) : null

  const diff = useMemo(
    () => (baseModel && targetModel ? diffModelsForDisplay(baseModel, targetModel) : null),
    [baseModel, targetModel],
  )

  const onClickEntry = (e: DiffEntry) => {
    if (!isNavigable(e.kind)) return
    if (e.kind === 'relationship') selectRelationship(e.entityId)
    else select(e.parentTableId ?? e.entityId)
    onNavigate()
  }

  const onDownload = () => {
    if (!diff) return
    const sheet = buildChangeSheet(diff, {
      baseLabel: labelOfSide(effectiveBase), targetLabel: labelOfSide(target),
    })
    void downloadExcelWorkbook([sheet], 'erdd_변경분정의서.xlsx')
      .catch(() => toast.error('변경분 정의서를 만들지 못했습니다'))
  }

  if (list.isPending) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (list.isError) {
    return <p className="text-sm text-destructive">스냅샷 목록을 불러오지 못했습니다</p>
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        비교하려면 스냅샷이 하나 이상 필요합니다. 아직 스냅샷이 없습니다
      </p>
    )
  }

  const options: { value: Side; label: string }[] = [
    { value: 'current', label: '현재' },
    ...items.map((i) => ({ value: i.id, label: `${i.name} (${formatCreatedAt(i.createdAt)})` })),
  ]
  const loadFailed = baseSnap.isError || targetSnap.isError
  const loading = baseSnap.isPending && effectiveBase !== 'current'
    || targetSnap.isPending && target !== 'current'

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="diff-base">기준</Label>
          <select
            id="diff-base" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={effectiveBase ?? 'current'}
            onChange={(e) => setBase(e.target.value)}
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="diff-target">비교</Label>
          <select
            id="diff-target" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {effectiveBase === target && (
        <p className="text-sm text-muted-foreground">같은 시점을 비교하고 있습니다</p>
      )}
      {loadFailed && <p className="text-sm text-destructive">스냅샷을 불러오지 못했습니다</p>}
      {loading && !loadFailed && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

      {diff && !loadFailed && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              추가 {diff.counts.added} · 삭제 {diff.counts.removed} · 변경 {diff.counts.changed}
            </p>
            <Button
              type="button" size="sm" variant="outline"
              disabled={diff.entries.length === 0} onClick={onDownload}
            >
              <Download /> 변경분 정의서
            </Button>
          </div>
          {diff.entries.length === 0
            ? <p className="text-sm text-muted-foreground">차이가 없습니다</p>
            : (
                <ul className="grid max-h-96 gap-1 overflow-y-auto">
                  {diff.entries.map((e) => (
                    <li key={`${e.kind}-${e.entityId}`} className="rounded border p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{DIFF_KIND_LABEL[e.kind]}</span>
                        {isNavigable(e.kind)
                          ? (
                              <button
                                type="button" className="font-mono font-medium hover:underline"
                                onClick={() => onClickEntry(e)}
                              >
                                {e.label}
                              </button>
                            )
                          : <span className="font-mono font-medium">{e.label}</span>}
                        <span className="ml-auto">{CHANGE_LABEL[e.changeKind]}</span>
                      </div>
                      {e.fields.length > 0 && (
                        <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                          {e.fields.map((f) => (
                            <li key={f.field}>
                              {f.label}: {f.before || '(없음)'} → {f.after || '(없음)'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `version-dialog.tsx`에 섹션을 추가한다**

import에 추가:

```ts
import { SnapshotDiff } from './snapshot-diff.js'
```

`Section` 타입을 바꾼다:

```ts
type Section = 'snapshot' | 'history' | 'diff'
```

토글 버튼 그룹의 "이력" 버튼 다음에 추가:

```tsx
          <Button
            type="button" size="sm" variant={section === 'diff' ? 'default' : 'outline'}
            onClick={() => setSection('diff')}
          >
            비교
          </Button>
```

본체 렌더를 삼항 중첩 대신 명시적으로 바꾼다:

```tsx
        {section === 'snapshot' && (
          <SnapshotSection projectId={projectId} onRestored={() => setOpen(false)} />
        )}
        {section === 'history' && <HistoryView projectId={projectId} />}
        {section === 'diff' && (
          <SnapshotDiff projectId={projectId} onNavigate={() => setOpen(false)} />
        )}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm --filter @erdd/core exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 PASS. server는 **69 그대로**(서버 변경 없음), typecheck 0 errors.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/snapshot-diff.tsx apps/web/src/editor/snapshot-diff.test.tsx apps/web/src/editor/version-dialog.tsx
git commit -F - <<'EOF'
feat(web): 버전 다이얼로그에 스냅샷 비교 섹션 추가

기준/비교를 각각 고르고(현재 + 스냅샷 목록) 변경 목록과 요약을 본다. 스냅샷 모델은
복원 경로와 동일하게 정규화한 뒤 비교한다. 테이블·컬럼·관계·인덱스 항목은 클릭하면
해당 테이블을 선택하고 다이얼로그를 닫는다(사전·도메인은 캔버스에 대응 객체가 없어 비활성).
변경분 정의서 다운로드 버튼은 이 화면 안에 둔다 — 기준/비교 선택이 여기 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XjBE4CTTjdQ5qrbuWQ2Rb
EOF
```

---

## 최종 체크포인트 (모든 태스크 후)

- [ ] **전체 스위트**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 그린. 기준선 core 234 · web 242 · server 69 대비 core +13, web +7, **server 변동 없음**.

- [ ] **최종 whole-branch 리뷰**(서브에이전트, requesting-code-review의 code-reviewer 템플릿) → Critical/Important 있으면 단일 수정 웨이브 후 재리뷰

- [ ] **브라우저 스모크** (실 앱 + 실 DB)

```bash
# 이전 dev 서버가 남아 있으면 포트 3000을 잡고 있다 — 먼저 확인
lsof -nP -iTCP:3000 -sTCP:LISTEN
export ADMIN_EMAIL=admin@erdd.local ADMIN_PASSWORD='Passw0rd!erdd'
set -a; . ./.env; set +a; pnpm --filter @erdd/server dev &
pnpm --filter @erdd/web exec vite --host 127.0.0.1 &
```

스크래치 프로젝트 `http://localhost:5173/p/019f9451-d164-7d8c-a2f0-b71b7b60d42d`에서:
1. 헤더 "버전" → "스냅샷" 탭에서 스냅샷 하나 생성(예: `v1.0`)
2. 캔버스에서 컬럼 하나의 물리명을 바꾸고 테이블 하나를 **드래그로 이동**
3. "비교" 탭 → 기준 `v1.0` · 비교 `현재` → **물리명 변경만 잡히고 좌표 이동은 안 잡히는지** 확인(핵심 설계 검증)
4. 항목 클릭 → 해당 테이블이 선택되고 다이얼로그가 닫히는지
5. "변경분 정의서" 다운로드 → 파일을 열어 1행 제목(`기준: v1.0 · 비교: 현재`), 2행 헤더, 변경 행 확인
6. 기준/비교를 둘 다 `현재`로 → "같은 시점" 안내
7. **실행 취소로 스모크 변경을 원복**하고 스냅샷도 삭제해 dev DB를 깨끗이 둔다
8. 콘솔·서버 로그 에러 확인

- [ ] **main 머지** → **HANDOFF.md·91-checklist.md 갱신**(Phase 3 절반 완료, 남은 것은 실시간 동시편집. `91-checklist`의 "diff 화면과 변경분 정의서" 항목 해소)

## 이월(범위 밖, 문서에만 남긴다)

- 실시간 동시편집(Phase 3 나머지 절반)
- diff에서 선택 항목만 되돌리는 "선택 복원"
- Revision 단위 diff(현재는 스냅샷·현재 시점 단위)
- 배치 좌표 변경 이력 보기(좌표는 diff에서 의도적으로 제외)
- `formatValue`가 `null`과 `''`를 같게 보므로 그 둘 사이의 변경은 잡히지 않는다(정의서에서 구분되지 않는 값이라 의도된 동작)
