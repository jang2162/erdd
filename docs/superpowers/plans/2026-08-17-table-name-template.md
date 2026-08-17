# 테이블 물리명 형식 템플릿 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 테이블 물리명을 「접두 + 입력한 부분」으로 조합해 DDL·DBML·Excel·검사에 내보낸다. 저장값은 부분만 유지한다.

**Architecture:** 조합 함수 하나(`composeTablePhysicalName`)가 템플릿 유무를 흡수한다 — 템플릿이 비면 `physicalName`을 그대로 돌려주므로 소비처는 분기를 몰라도 된다. 산출물 4곳이 그 함수를 타고, 화면·CLI·클립보드는 부분을 그대로 쓴다.

**Tech Stack:** TypeScript · zod · vitest · React 19

**설계 문서:** `docs/superpowers/specs/2026-08-17-table-name-template-design.md`

## Global Constraints

- **마이그레이션 없음.** `naming_rules`는 jsonb이고 논리명 구분자 사이클이 `project.get`에 `NamingRulesSchema.parse`를 이미 태워 뒀다. DB 스키마 파일을 고치면 범위를 넘은 것이다.
- **`DEFAULT_NAMING_RULES`를 프로덕션 코드의 폴백으로 하드코딩하지 마라.** 함수가 `rules`를 안 받으면 **인자를 뚫는다**. 논리명 구분자 사이클이 정확히 그 결함(`dict-panel.tsx`의 하드코딩)을 닫았다. ⚠️ `buildExcelSheets`에 이미 `opts.rules ?? DEFAULT_NAMING_RULES`가 있다(Task 4에서 없앤다).
  - **예외는 테스트 파일이다.** 아래 각 태스크가 지시하는 **import 별칭 심(shim)** 은 테스트 안에서만 기본값을 채운다. 그 자리는 「프로젝트 규칙을 조용히 무시하는」 자리가 아니라 「이 테스트는 템플릿 없는 규칙을 쓴다」를 한 줄로 말하는 자리다.
- **논리명·컬럼은 건드리지 않는다**(설계 D6·범위 밖).
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...`을 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 700 · cli 141 · web 917 · server 202 · typecheck EXIT=0`.
- **typecheck는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라.** 서버 테스트가 필요하면 격리 DB를 명시한다:
  `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' …` (없으면 만들고 migrate).
- **작업 디렉터리는 워크트리다.**

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/name-template.ts` | 파싱 · 변수 해석 · 빈 구간 접기 · 조합 | **신설** |
| `packages/core/src/name-template.test.ts` | 위 | **신설** |
| `packages/core/src/naming.ts` | `NamingRules.tablePhysicalTemplate` + 읽기/쓰기 두 스키마 | 수정 |
| `packages/core/src/index.ts` | 재export | 수정 |
| `packages/core/src/ddl.ts` | 테이블명 8자리 + `rules` 인자 | 수정 |
| `packages/core/src/dbml.ts` | Table · Ref · 그룹 멤버 · note + `rules` 인자 | 수정 |
| `packages/core/src/excel-sheets.ts` | 물리명 열 + `rules` 폴백 제거 | 수정 |
| `packages/core/src/warnings.ts` | 중복 · 길이 · 예약어 | 수정 |
| `apps/web/src/editor/export-dialog.tsx` | 네 함수에 `rules` 전달 | 수정 |
| `apps/web/src/pages/project-settings.tsx` | 템플릿 입력란 + 미리보기 | 수정 |
| `apps/web/src/editor/edit-panel.tsx` | 테이블 물리명 아래 미리보기 | 수정 |
| `packages/cli/src/config.ts` | 옵셔널 키 | 수정 |
| 테스트 6종 | import 별칭 심 한 줄씩 | 수정 |
| 문서 3종 | | 수정 |

### ⚠️ 착수 전에 알아야 할 사실 (조사 완료 — 다시 조사하지 마라)

1. **`generateDdl`·`ddlWarnings`·`generateDbml`·`buildExcelSheets`는 `rules`를 안 받는다.**
2. **프로덕션 호출처는 `apps/web/src/editor/export-dialog.tsx` 한 파일뿐이다**(`:56` ddl · `:58` dbml · `:61` ddlWarnings · `:99` excel). 그래서 `rules`를 **필수 인자**로 둬도 프로덕션 부담이 없다.
3. **그러나 테스트 호출처가 약 70곳이다.** 그대로 두면 전부 타입 오류가 난다. **테스트를 70곳 고치지 마라** — 각 테스트 파일의 **import 한 줄**을 별칭 심으로 바꾸면 호출부는 하나도 안 건드린다. 심을 넣을 파일:
   | 파일 | 감쌀 것 | 호출 수(대략) |
   |---|---|---|
   | `packages/core/src/ddl.test.ts` | `generateDdl` · `ddlWarnings` | 30 |
   | `packages/core/src/ddl-import.test.ts` | `generateDdl` | 2 |
   | `packages/core/src/dbml.test.ts` | `generateDbml` | 20 |
   | `packages/core/src/dbml-roundtrip.test.ts` | `generateDbml` | 1 |
   | `packages/core/src/excel-sheets.test.ts` | `buildExcelSheets` | 15 |
   | `apps/web/src/editor/ddl-import-edits.test.ts` | `generateDdl` · `generateDbml` | 2 |
   | `apps/web/src/editor/excel-file.test.ts` | `buildExcelSheets` | 3 |
4. **TS 는 「기본값 있는 인자 뒤의 필수 인자」를 허용한다**(실측 확인: `f(a, b = 1, c)` → `tsc --strict` EXIT=0). 그래서 `scope: DdlScope = { kind: 'all' }` 뒤에 `rules: NamingRules`를 붙여도 컴파일된다. **단 `?` 옵셔널 인자 뒤에는 못 붙인다**(TS1016) — `generateDbml`의 `opts?:`가 여기 걸리므로 Task 3 에서 `opts: {…} = {}` 로 바꾼다.

---

## Task 1: 조합 엔진과 명명 규칙 필드

**Files:**
- Create: `packages/core/src/name-template.ts` · `packages/core/src/name-template.test.ts`
- Modify: `packages/core/src/naming.ts:4-41`(타입 · `DEFAULT_NAMING_RULES` · 두 스키마) · `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TemplateToken = { kind: 'lit'; text: string } | { kind: 'var'; name: string }
  export function parseTemplate(template: string): TemplateToken[]
  export function composeTablePhysicalName(
    table: Table, model: ProjectModel, rules: NamingRules,
  ): string
  ```
  `NamingRules`에 `tablePhysicalTemplate: string`(기본 `''`).

⚠️ **`NamingRules` 리터럴이 저장소 전역에서 깨진다**(그룹 별칭 사이클과 같은 형태). 아래 Step 3 의 grep 으로 전부 찾아 고친다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/name-template.test.ts` 신설. 픽스처는 `buildSampleModel()`(그룹 `g1`「회원관리」, 테이블 `t1`=MBR_GRD·`t2`=MBR, 둘 다 `g1` 소속, `alias: ''`)을 쓰되 별칭을 채운다.

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import { composeTablePhysicalName, parseTemplate } from './name-template.js'
import type { ProjectModel } from './model.js'

/** g1 에 별칭 MBR 을 주고 t2 를 ORD/주문으로 바꾼 모델. */
function model(): ProjectModel {
  const m = buildSampleModel()
  m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: '회원관리', alias: 'MBR' }
  m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'ORD', logicalName: '주문' }
  return m
}
const rulesWith = (tablePhysicalTemplate: string): NamingRules =>
  ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate })
const compose = (tpl: string, m: ProjectModel = model()) =>
  composeTablePhysicalName(m.tables['t2']!, m, rulesWith(tpl))

describe('parseTemplate', () => {
  it('리터럴과 변수를 쪼갠다', () => {
    expect(parseTemplate('TB_{그룹별칭}_{물리명}')).toEqual([
      { kind: 'lit', text: 'TB_' },
      { kind: 'var', name: '그룹별칭' },
      { kind: 'lit', text: '_' },
      { kind: 'var', name: '물리명' },
    ])
  })

  it('짝이 맞지 않는 중괄호는 리터럴로 남긴다', () => {
    expect(parseTemplate('TB_{물리명')).toEqual([{ kind: 'lit', text: 'TB_{물리명' }])
  })

  it('빈 템플릿은 빈 배열이다', () => {
    expect(parseTemplate('')).toEqual([])
  })
})

describe('composeTablePhysicalName', () => {
  // ⚠️ 이것이 「소비처가 템플릿을 몰라도 된다」를 성립시키는 계약이다(설계 3.1).
  it('템플릿이 비면 물리명을 그대로 낸다', () => {
    expect(compose('')).toBe('ORD')
  })

  it('변수 네 종을 해석한다', () => {
    expect(compose('{그룹별칭}')).toBe('MBR')
    expect(compose('{그룹명}')).toBe('회원관리')
    expect(compose('{물리명}')).toBe('ORD')
    expect(compose('{논리명}')).toBe('주문')
  })

  it('커스텀 항목을 정의 이름으로 지목한다', () => {
    const m = model()
    m.customFields['cf9'] = {
      id: 'cf9', name: '서브시스템', target: 'table', type: 'text',
      options: [], required: false, defaultValue: null, order: 0, origin: null,
    }
    m.tables['t2'] = { ...m.tables['t2']!, custom: { cf9: 'SLS' } }
    expect(compose('{커스텀:서브시스템}', m)).toBe('SLS')
  })

  it('커스텀 항목 정의가 없으면 빈 값이다', () => {
    expect(compose('TB_{커스텀:없는항목}_{물리명}')).toBe('TB_ORD')
  })

  // ⚠️ 커스텀은 「값 > 정의 기본값 > 빈 문자열」이다(custom-field.ts 의 resolveCustomValue 와 같은 정책).
  it('커스텀 값이 없으면 정의 기본값을 쓴다', () => {
    const m = model()
    m.customFields['cf9'] = {
      id: 'cf9', name: '서브시스템', target: 'table', type: 'text',
      options: [], required: false, defaultValue: 'COM', order: 0, origin: null,
    }
    expect(compose('{커스텀:서브시스템}', m)).toBe('COM')
  })

  it('컬럼용 커스텀 항목은 테이블 변수로 잡히지 않는다', () => {
    const m = model()
    m.customFields['cf8'] = {
      id: 'cf8', name: '서브시스템', target: 'column', type: 'text',
      options: [], required: false, defaultValue: 'X', order: 0, origin: null,
    }
    expect(compose('TB_{커스텀:서브시스템}_{물리명}', m)).toBe('TB_ORD')
  })

  it('알 수 없는 변수는 빈 값이다', () => {
    expect(compose('TB_{없는것}_{물리명}')).toBe('TB_ORD')
  })

  it('전체 조합', () => {
    expect(compose('TB_{그룹별칭}_{물리명}')).toBe('TB_MBR_ORD')
  })
})

// ⚠️ 이 사이클의 급소. 설계 3.2 의 표 그대로다.
describe('빈 구간 접기', () => {
  /** 그룹을 떼어 {그룹별칭}·{그룹명} 이 비게 만든다. */
  function noGroup(): ProjectModel {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, groupId: null }
    return m
  }
  /** 물리명을 비운다. */
  function noPhysical(): ProjectModel {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: '' }
    return m
  }

  it('가운데 변수가 비면 뒤 구분자와 함께 접는다', () => {
    expect(compose('TB_{그룹별칭}_{물리명}', noGroup())).toBe('TB_ORD')
  })

  it('맨 앞 변수가 비면 뒤 구분자와 함께 접는다', () => {
    expect(compose('{그룹별칭}_{물리명}', noGroup())).toBe('ORD')
  })

  it('맨 뒤 변수가 비면 앞 구분자를 지운다', () => {
    expect(compose('{그룹별칭}_{물리명}', noPhysical())).toBe('MBR')
  })

  it('연속으로 비어도 접힌다', () => {
    expect(compose('TB_{그룹별칭}_{그룹명}_{물리명}', noGroup())).toBe('TB_ORD')
  })

  it('전부 비면 빈 문자열이다', () => {
    const m = noGroup()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: '' }
    expect(compose('{그룹별칭}_{물리명}', m)).toBe('')
  })

  // ⚠️ 정규식 후처리(`_{2,}` → `_`)로 흉내내면 이 케이스가 깨진다(설계 3.2).
  it('부분 이름 안의 연속 밑줄은 접지 않는다', () => {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'A__B' }
    expect(compose('TB_{물리명}', m)).toBe('TB_A__B')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts
```
기대: 모듈이 없어 전 케이스 FAIL.

- [ ] **Step 3: 구현하고 깨진 리터럴을 전부 고친다**

`naming.ts`의 `NamingRules`에 필드를 더한다(`maxLengthBytes` 다음 줄):

```ts
  /**
   * 테이블 물리명 조합 틀. 빈 문자열이면 조합하지 않고 physicalName 을 그대로 쓴다(기존 동작).
   * 예: 'TB_{그룹별칭}_{물리명}'
   */
  tablePhysicalTemplate: string
```

`DEFAULT_NAMING_RULES`에 `tablePhysicalTemplate: ''`를 더한다.

**두 스키마를 다르게 고친다 — 이 파일에 이미 적힌 이유(naming.ts:32-38) 그대로다.**

```ts
export const NamingRulesSchema = z.object({
  case: z.enum(['UPPER_SNAKE', 'lower_snake']),
  separator: z.enum(['_', '']),
  logicalSeparator: z.enum(['_', '']).default('_'),
  maxLengthBytes: z.number().int().positive(),
  tablePhysicalTemplate: z.string().default(''),   // 읽기 시점 주입
})

export const NamingRulesStrictSchema = NamingRulesSchema.extend({
  logicalSeparator: z.enum(['_', '']),
  tablePhysicalTemplate: z.string(),               // 쓰기: 기본값 주입 금지
})
```

⚠️ **`NamingRulesStrictSchema` 쪽을 빠뜨리면 조용한 데이터 손실이 된다.** `.extend` 로 덮지 않으면 strict 스키마가 `.default('')`를 물려받아, 키를 안 보낸 클라이언트의 `project.update` 가 **설정해 둔 템플릿을 빈 문자열로 덮어쓴다.** `logicalSeparator` 가 같은 이유로 이미 갈라져 있다.

`packages/core/src/name-template.ts` 신설:

```ts
import type { NamingRules } from './naming.js'
import type { ProjectModel, Table } from './model.js'
import { resolveCustomValue } from './custom-field.js'

export type TemplateToken = { kind: 'lit'; text: string } | { kind: 'var'; name: string }

/** 템플릿을 리터럴·변수 토큰으로 쪼갠다. 짝이 안 맞는 중괄호는 리터럴로 남긴다(오류를 던지지 않는다). */
export function parseTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = []
  let i = 0
  let lit = ''
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open === -1) { lit += template.slice(i); break }
    const close = template.indexOf('}', open + 1)
    if (close === -1) { lit += template.slice(i); break }
    lit += template.slice(i, open)
    if (lit !== '') { tokens.push({ kind: 'lit', text: lit }); lit = '' }
    tokens.push({ kind: 'var', name: template.slice(open + 1, close) })
    i = close + 1
  }
  if (lit !== '') tokens.push({ kind: 'lit', text: lit })
  return tokens
}

const CUSTOM_PREFIX = '커스텀:'

/** 알 수 없는 변수는 빈 값이다 — 설정 화면 오타로 모델 전체가 죽으면 안 된다(설계 3.2). */
function resolveVar(name: string, table: Table, model: ProjectModel): string {
  const group = table.groupId === null ? undefined : model.tableGroups[table.groupId]
  if (name === '그룹별칭') return group?.alias ?? ''
  if (name === '그룹명') return group?.name ?? ''
  if (name === '물리명') return table.physicalName
  if (name === '논리명') return table.logicalName
  if (name.startsWith(CUSTOM_PREFIX)) {
    const fieldName = name.slice(CUSTOM_PREFIX.length)
    // 값 맵의 키가 UUID 라 사람이 쓸 수 없다 — 정의 이름으로 지목한다(설계 D4).
    const field = Object.values(model.customFields)
      .find((f) => f.target === 'table' && f.name === fieldName)
    // 값 > 정의 기본값 > '' 은 custom-field.ts 의 정책이다. 여기서 다시 짜지 않는다.
    return field === undefined ? '' : resolveCustomValue(table, field)
  }
  return ''
}

/**
 * 테이블의 최종 물리명. 산출물(DDL·DBML·Excel)과 검사(중복·길이·예약어)가 이것을 쓴다.
 *
 * ⚠️ **템플릿이 비면 physicalName 을 그대로 돌려준다.** 소비처가 「템플릿이 있는가」를 몰라도 되게
 * 하는 계약이다 — 분기가 소비처로 새면 스무 곳이 각자 판단하게 된다(설계 3.1).
 *
 * ⚠️ 빈 변수 규칙(설계 3.2): **빈 변수는 자기 자신과 바로 뒤의 리터럴을 함께 지운다. 뒤에 리터럴이
 * 없으면 바로 앞의 리터럴을 지운다.** 정규식 후처리로 흉내내지 않는다 — 구분자가 '_' 가 아닐 수 있고
 * 부분 이름 안의 연속 밑줄까지 접힌다.
 */
export function composeTablePhysicalName(
  table: Table, model: ProjectModel, rules: NamingRules,
): string {
  if (rules.tablePhysicalTemplate === '') return table.physicalName
  const tokens = parseTemplate(rules.tablePhysicalTemplate)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.kind === 'lit') { out.push(tok.text); continue }
    const value = resolveVar(tok.name, table, model)
    if (value !== '') { out.push(value); continue }
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') { i += 1; continue }  // 뒤 리터럴을 함께 건너뛴다
    if (tokens[i - 1]?.kind === 'lit') out.pop()                          // 없으면 앞 리터럴을 지운다
  }
  return out.join('')
}
```

`packages/core/src/index.ts`에 재export를 더한다:
```ts
export { composeTablePhysicalName, parseTemplate } from './name-template.js'
export type { TemplateToken } from './name-template.js'
```

**깨진 `NamingRules` 리터럴을 전부 고친다.** 아래로 목록을 뽑아 하나씩 `tablePhysicalTemplate: ''`를 더한다(`...DEFAULT_NAMING_RULES` 스프레드 형태는 안 고쳐도 된다):
```bash
grep -rn "maxLengthBytes:" packages apps --include='*.ts' --include='*.tsx' \
  | grep -v node_modules | grep -v tablePhysicalTemplate
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts
pnpm -r typecheck; echo "EXIT=$?"
pnpm -C packages/core test && pnpm -C apps/web test && pnpm -C packages/cli test
```
기대: 신규 케이스 PASS, `EXIT=0`, **기존 스위트 전부 그대로**. 이 시점에는 동작이 하나도 안 바뀌었다 — 아무도 조합 함수를 부르지 않는다. 기존 스위트가 깨졌다면 리터럴을 덜 고쳤거나 스키마를 잘못 고친 것이다.

- [ ] **Step 5: 접기 규칙이 진짜 잠기는지 실증한다**

`composeTablePhysicalName`의 빈 변수 처리 세 줄
```ts
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') { i += 1; continue }
    if (tokens[i - 1]?.kind === 'lit') out.pop()
```
을 **`continue` 한 줄로** 바꾼다(빈 값만 빼고 리터럴은 남긴다).

⚠️ **치환이 실제로 먹었는지 눈으로 확인한 뒤에 돌린다**(이 저장소에서 세 번 물린 함정 — 치환이 조용히 실패하고 테스트만 초록으로 남았다):
```bash
git diff --numstat packages/core/src/name-template.ts   # 변경 줄 수가 0 이 아니어야 한다
git diff packages/core/src/name-template.ts             # 지운 줄을 눈으로 본다
pnpm -C packages/core exec vitest run src/name-template.test.ts -t '빈 구간 접기'
```
기대: **FAIL**(`TB__ORD`·`_ORD`·`MBR_` 등). 되돌리고 PASS를 확인한 뒤 **양쪽 결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/name-template.ts packages/core/src/name-template.test.ts \
        packages/core/src/naming.ts packages/core/src/index.ts && \
git commit -m "feat(core): 테이블 물리명 조합 엔진을 더한다

템플릿이 비면 physicalName 을 그대로 돌려준다 — 소비처가 템플릿 유무를 몰라도
되게 하는 계약이다. 빈 변수는 뒤 리터럴과 함께 접어 TB__ORD 가 안 나오게 한다.
쓰기 검증 스키마에는 기본값을 주입하지 않는다 — 키를 안 보낸 클라이언트가 설정해
둔 템플릿을 지우면 안 된다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
⚠️ 리터럴을 고친 다른 파일이 있으면 그 경로도 같은 커밋에 명시한다.

---

## Task 2: DDL 배선

**Files:**
- Modify: `packages/core/src/ddl.ts` — 여덟 자리 + `rules` 인자
- Modify: `apps/web/src/editor/export-dialog.tsx:56,61`
- Modify(심 한 줄): `packages/core/src/ddl.test.ts` · `packages/core/src/ddl-import.test.ts` · `apps/web/src/editor/ddl-import-edits.test.ts`
- Test: `packages/core/src/ddl.test.ts` · `packages/core/src/ddl-import.test.ts`

**Interfaces:**
- Consumes: `composeTablePhysicalName(table, model, rules)` (Task 1)
- Produces:
  ```ts
  export function selectTables(model: ProjectModel, scope: DdlScope, rules: NamingRules): Table[]
  export function hasEmptyPhysicalName(model: ProjectModel, table: Table, rules: NamingRules): boolean
  export function generateDdl(
    model: ProjectModel, dialect: Dialect, scope: DdlScope | undefined, rules: NamingRules,
  ): string
  export function ddlWarnings(
    model: ProjectModel, dialect: Dialect, scope: DdlScope | undefined, rules: NamingRules,
  ): string[]
  ```
  실제 선언은 `scope: DdlScope = { kind: 'all' }, rules: NamingRules` 로 쓴다(기본값 뒤 필수 인자 — 위 "알아야 할 사실 4").

- [ ] **Step 1: 세 테스트 파일에 심을 넣는다 (호출부는 안 건드린다)**

`packages/core/src/ddl.test.ts` 의 2행을 아래로 **교체**한다:
```ts
import {
  generateDdl as generateDdlRaw, ddlWarnings as ddlWarningsRaw, type DdlScope,
} from './ddl.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import type { Dialect } from './dialect.js'

// 이 파일의 기존 케이스는 전부 「템플릿 없는 규칙」을 전제한다. 심으로 그 전제를 한 줄에 적고
// 호출부 30곳을 그대로 둔다. 템플릿을 쓰는 새 케이스는 rules 를 직접 넘긴다.
const generateDdl = (
  model: ProjectModel, dialect: Dialect,
  scope: DdlScope = { kind: 'all' }, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDdlRaw(model, dialect, scope, rules)
const ddlWarnings = (
  model: ProjectModel, dialect: Dialect,
  scope: DdlScope = { kind: 'all' }, rules: NamingRules = DEFAULT_NAMING_RULES,
) => ddlWarningsRaw(model, dialect, scope, rules)
```

`packages/core/src/ddl-import.test.ts` 와 `apps/web/src/editor/ddl-import-edits.test.ts` 에도 같은 형태의 `generateDdl` 심을 넣는다(web 쪽은 `@erdd/core` 에서 import 한다).

- [ ] **Step 2: 실패 테스트를 쓴다**

`packages/core/src/ddl.test.ts` 끝에 추가한다.

```ts
describe('물리명 템플릿', () => {
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })
  const TPL = 'TB_{그룹별칭}_{물리명}'
  /** buildSampleModel: g1 에 t1(MBR_GRD)·t2(MBR), r1 이 t1→t2, i1 은 t2 의 유니크 인덱스. */
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }

  it('CREATE TABLE 이 조합된 이름을 쓴다', () => {
    const sql = generateDdl(m(), 'postgresql', { kind: 'all' }, tpl(TPL))
    expect(sql).toContain('CREATE TABLE "TB_MBR_MBR"')
    expect(sql).toContain('CREATE TABLE "TB_MBR_MBR_GRD"')
  })

  // ⚠️ 한 자리만 안 바뀌어도 DDL 이 깨진다 — 존재하지 않는 테이블을 가리킨다.
  it('FK·인덱스·코멘트가 모두 같은 조합 이름을 쓴다', () => {
    const sql = generateDdl(m(), 'postgresql', { kind: 'all' }, tpl(TPL))
    expect(sql).toContain('ALTER TABLE "TB_MBR_MBR" ADD CONSTRAINT')
    expect(sql).toContain('REFERENCES "TB_MBR_MBR_GRD"')
    expect(sql).toContain('ON "TB_MBR_MBR"')            // CREATE INDEX … ON <테이블>
    expect(sql).toContain('COMMENT ON TABLE "TB_MBR_MBR"')
    expect(sql).toContain('COMMENT ON COLUMN "TB_MBR_MBR"."MBR_NO"')
    // 조합 전 이름이 한 자리라도 남으면 안 된다
    expect(sql).not.toMatch(/"MBR"(?!_)/)
    expect(sql).not.toMatch(/"MBR_GRD"/)
  })

  // 부분 기준 정렬이면 MBR(t2) < MBR_GRD(t1) 라 t2 가 앞이다. t1 을 별칭 AA 인 그룹으로 옮기면
  // 조합 기준으로는 TB_AA_MBR_GRD < TB_MBR_MBR 이라 순서가 **뒤집힌다** — 그 뒤집힘을 잠근다.
  it('정렬도 조합 이름 기준이다', () => {
    const x = m()
    x.tableGroups['g2'] = { id: 'g2', name: '기타', color: '#eeeeee', comment: null, alias: 'AA' }
    x.tables['t1'] = { ...x.tables['t1']!, groupId: 'g2' }
    const sql = generateDdl(x, 'postgresql', { kind: 'all' }, tpl(TPL))
    expect(sql.indexOf('CREATE TABLE "TB_AA_MBR_GRD"'))
      .toBeLessThan(sql.indexOf('CREATE TABLE "TB_MBR_MBR"'))
    // 같은 모델을 템플릿 없이 내면 순서가 반대다(부분 기준 MBR < MBR_GRD).
    const plain = generateDdl(x, 'postgresql')
    expect(plain.indexOf('CREATE TABLE "MBR"'))
      .toBeLessThan(plain.indexOf('CREATE TABLE "MBR_GRD"'))
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDdl(m(), 'postgresql')).toContain('CREATE TABLE "MBR"')
  })

  // ⚠️ 부분이 비어도 접두가 있으면 유효한 이름이다(설계 3.3 — hasEmptyPhysicalName).
  it('부분이 비어도 조합 결과가 있으면 DDL 에 나가고 경고하지 않는다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, physicalName: '' }
    const sql = generateDdl(x, 'postgresql', { kind: 'all' }, tpl(TPL))
    expect(sql).toContain('CREATE TABLE "TB_MBR"')
    const warns = ddlWarnings(x, 'postgresql', { kind: 'all' }, tpl(TPL))
    expect(warns.filter((w) => w.includes('물리명이 비어 있어'))).toEqual([])
  })

  it('조합해도 이름이 비면 제외하고 경고한다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, physicalName: '' }
    const sql = generateDdl(x, 'postgresql', { kind: 'all' }, tpl('{물리명}'))
    expect(sql).not.toContain('CREATE TABLE ""')
    expect(ddlWarnings(x, 'postgresql', { kind: 'all' }, tpl('{물리명}'))
      .some((w) => w.includes('물리명이 비어 있어'))).toBe(true)
  })
})
```

`packages/core/src/ddl-import.test.ts` 에 **D2(왕복이 깨진다)를 고정하는 테스트**를 더한다. 설계 §4 「잠기지 않는 것」이 요구한 자리다 — 나중에 역분해를 넣으면 이 테스트가 빨개져 재검토를 강제한다.

```ts
// ⚠️ 설계 D2 를 **고정**하는 테스트다. 「깨진다」가 의도된 동작이라는 뜻이지 옳다는 뜻이 아니다.
// 역분해를 넣게 되면 이 테스트가 빨개진다 — 그때 설계 D2 를 다시 읽어라.
it('템플릿이 걸린 DDL 을 되읽으면 접두가 부분에 박힌다(역분해하지 않는다)', () => {
  const m = buildSampleModel()
  m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
  const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
  const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
  const imported = parseDdl(ddl, 'postgresql')     // ⚠️ 이 파일의 기존 파싱 헬퍼 이름에 맞춰라
  expect(imported.tables.map((t) => t.physicalName).sort())
    .toEqual(['TB_MBR_MBR', 'TB_MBR_MBR_GRD'])
})
```
⚠️ `parseDdl`/`imported.tables` 는 그 파일이 실제로 쓰는 헬퍼·반환 모양에 맞춰라(`:322` 부근의 왕복 헬퍼를 먼저 읽는다).

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl.test.ts src/ddl-import.test.ts
```
기대: 인자 개수 불일치(TS) 또는 조합 전 이름이 나와 FAIL.

- [ ] **Step 4: 구현한다**

`ddl.ts`에서 테이블 이름을 쓰는 **여덟 자리**를 조합으로 바꾼다. 각 함수에 `rules: NamingRules`를 뚫는다.

| 행 | 함수 | 바꿀 것 |
|---|---|---|
| `:43` | `selectTables` | `picked.sort((a, b) => compose(a).localeCompare(compose(b)))` — ⚠️ 그래야 DDL 순서가 최종 이름 기준이 된다 |
| `:99` | `createTableBlock` | `CREATE TABLE ${quoteIdentifier(<조합>, dialect)}` |
| `:101` | `createTableBlock`(mysql 인라인 코멘트) | `commentText(table.logicalName, <조합>, table.comment)` — ⚠️ 「논리명==물리명이면 생략」 판정이 조합 이름과 비교돼야 한다 |
| `:112` | `hasEmptyPhysicalName` | `if (compose(table).trim() === '') return true` (컬럼 검사는 그대로) |
| `:121` | `warningLabel` | 조합 결과가 비었을 때만 논리명 폴백, 아니면 조합 이름 |
| `:142-148` | `fkStatements` | `fkBaseName(rel, <자식 조합>, <부모 조합>)` · `ALTER TABLE <자식 조합>` · `REFERENCES <부모 조합>` · `UQ_<자식 조합>_…` |
| `:159` | `indexStatements` | `const tableName = table ? compose(table) : ix.tableId` |
| `:175-180` | `commentStatements` | `commentText(table.logicalName, <조합>, …)` · `tableCommentStatement(dialect, <조합>, …)` · `columnCommentStatement(dialect, <조합>, …)` |
| `:238` | `ddlWarnings` 타입 경고 접두 | `${<조합>}.${c.physicalName}` |

⚠️ **`fkBaseName`·`uniqueConstraintName` 은 손대지 마라** — 테이블 이름을 인자로 받아 자동 이름을 만들므로 위를 바꾸면 자동으로 따라간다.

각 함수 안에서 지역 헬퍼를 하나 두면 반복이 줄어든다:
```ts
const compose = (t: Table) => composeTablePhysicalName(t, model, rules)
```

`generateDdl`·`ddlWarnings`·`selectTables`·`hasEmptyPhysicalName` 시그니처에 `rules`를 더하고, `dbml.ts:187-188` 의 `selectTables`·`hasEmptyPhysicalName` 호출은 **Task 3 에서** 고친다(지금은 타입 오류가 남는다 — Task 3 까지 `pnpm -r typecheck` 가 빨간 것이 정상이다. ⚠️ 이 사실을 보고에 적어라).

`export-dialog.tsx`:
```tsx
  const ddl = useMemo(
    () => generateDdl(model, dialect, scope, namingRules), [model, dialect, scope, namingRules])
  const warnings = useMemo(
    () => ddlWarnings(model, dialect, scope, namingRules), [model, dialect, scope, namingRules])
```
⚠️ `namingRules` 를 **useMemo 의존성 배열에 넣어라.** 빠뜨리면 설정을 바꿔도 미리보기가 안 따라온다.

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl.test.ts src/ddl-import.test.ts
pnpm -C packages/core test
```
⚠️ **기존 DDL 테스트가 깨지면 안 된다** — 심이 템플릿 없는 규칙을 넘기므로 결과가 같아야 한다. 깨졌다면 조합 함수가 빈 템플릿에서 부분을 안 돌려주는 것이다.
(`pnpm -r typecheck` 는 dbml.ts 때문에 아직 EXIT≠0 이다.)

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts packages/core/src/ddl-import.test.ts \
        apps/web/src/editor/export-dialog.tsx apps/web/src/editor/ddl-import-edits.test.ts && \
git commit -m "feat(core): DDL 이 조합된 테이블 이름을 쓴다

CREATE TABLE·FK·인덱스·코멘트·정렬·빈 이름 판정·경고 라벨 여덟 자리가 같은 조합
이름을 본다. 인덱스·제약의 자동 이름은 그 자리를 따라 자동으로 바뀐다. 역설계는
조합된 이름을 통째로 부분에 넣는다(D2) — 그 동작을 테스트로 고정했다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: DBML 배선

**Files:**
- Modify: `packages/core/src/dbml.ts:115-201` · `apps/web/src/editor/export-dialog.tsx:58`
- Modify(심 한 줄): `packages/core/src/dbml.test.ts` · `packages/core/src/dbml-roundtrip.test.ts` · `apps/web/src/editor/ddl-import-edits.test.ts`
- Test: `packages/core/src/dbml.test.ts`

**Interfaces:**
- Consumes: `composeTablePhysicalName` · `selectTables(model, scope, rules)` · `hasEmptyPhysicalName(model, table, rules)` (Task 2)
- Produces:
  ```ts
  export function generateDbml(
    model: ProjectModel, dialect: Dialect,
    scope: DdlScope, opts: { projectName?: string }, rules: NamingRules,
  ): string
  ```
  실제 선언: `scope: DdlScope = { kind: 'all' }, opts: { projectName?: string } = {}, rules: NamingRules`.

⚠️ **`opts?:` 를 `opts: {…} = {}` 로 바꿔야 한다.** `?` 옵셔널 인자 뒤에는 필수 인자를 못 붙인다(TS1016). 기본값 인자 뒤에는 붙는다.

- [ ] **Step 1: 세 테스트 파일에 심을 넣는다**

`packages/core/src/dbml.test.ts` 의 `generateDbml` import 를 교체한다:
```ts
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import type { DdlScope } from './ddl.js'
import type { Dialect } from './dialect.js'

const generateDbml = (
  model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' },
  opts: { projectName?: string } = {}, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDbmlRaw(model, dialect, scope, opts, rules)
```
`dbml-roundtrip.test.ts` 와 `apps/web/src/editor/ddl-import-edits.test.ts` 에도 같은 심을 넣는다.

- [ ] **Step 2: 실패 테스트를 쓴다**

`packages/core/src/dbml.test.ts` 끝에 추가한다. ⚠️ 이 파일은 `baseModel()`(그룹 없는 단일 테이블)을 쓴다 — 그룹 별칭이 필요하므로 `buildSampleModel()` 을 쓴다(`./testing/fixtures.js` import 를 더한다).

```ts
describe('물리명 템플릿', () => {
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })
  const TPL = 'TB_{그룹별칭}_{물리명}'
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }

  it('Table·Ref·그룹 멤버가 조합된 이름을 쓴다', () => {
    const out = generateDbml(m(), 'postgresql', { kind: 'all' }, {}, tpl(TPL))
    expect(out).toContain('Table TB_MBR_MBR ')
    expect(out).toContain('Table TB_MBR_MBR_GRD ')
    expect(out).toContain('Ref: TB_MBR_MBR.')          // 자식(MBR) 쪽
    expect(out).toContain('TB_MBR_MBR_GRD.')           // 부모 쪽
    expect(out).toMatch(/TableGroup [^\n]*\{\n\s+TB_MBR_/)
    expect(out).not.toMatch(/Table MBR_GRD\b/)
    expect(out).not.toMatch(/Table MBR /)
  })

  // note 는 물리명을 **찍지 않는다** — `commentText(논리명, 물리명, 설명)` 의 「논리명==물리명이면
  // 생략」 판정에만 쓴다(dbml-note.ts). 그 판정이 조합 이름과 비교돼야 한다.
  it('note 의 논리명 생략 판정이 조합 이름 기준이다', () => {
    const x = m()
    // 논리명 == 부분 물리명 == 'ORD', 설명 없음 → 템플릿이 없으면 note 자체가 안 나온다.
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    expect(generateDbml(x, 'postgresql')).not.toContain("note: 'ORD'")
    // 조합하면 'TB_MBR_ORD' 라 논리명과 달라진다 → 논리명이 note 로 나온다.
    expect(generateDbml(x, 'postgresql', { kind: 'all' }, {}, tpl(TPL))).toContain("note: 'ORD'")
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDbml(m(), 'postgresql')).toContain('Table MBR ')
  })
})
```
⚠️ 위 단언의 **정확한 인용 형식(`quoteDbmlIdent`)과 note 문자열**은 그 파일의 기존 케이스를 보고 맞춰라. `TB_MBR_MBR` 은 안전 패턴이라 따옴표가 안 붙지만, 기존 케이스가 `"MBR"` 형태를 쓰는 자리가 있으면 그쪽을 따른다.

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/dbml.test.ts
```
기대: 인자 개수 불일치(TS) 또는 조합 전 이름이 나와 FAIL.

- [ ] **Step 4: 구현한다**

`dbml.ts` 의 네 자리에 `rules`를 뚫고 조합 이름을 쓴다.

| 행 | 함수 | 바꿀 것 |
|---|---|---|
| `:124` | `tableBlock` → `buildDbmlNote` | 2번째 인자를 조합 이름으로 |
| `:133` | `tableBlock` | `Table ${quoteDbmlIdent(<조합>)}` |
| `:148` | `groupBlocks` | 멤버 목록 `quoteDbmlIdent(<조합>)` |
| `:178` | `refLines` | `side(<자식 조합>, childCols)` · `side(<부모 조합>, parentCols)` |
| `:187-188` | `generateDbml` | `selectTables(model, scope, rules)` · `hasEmptyPhysicalName(model, t, rules)` (Task 2 가 남긴 타입 오류를 여기서 닫는다) |

`export-dialog.tsx:58`:
```tsx
    () => generateDbml(model, dialect, scope, { projectName: projectName ?? undefined }, namingRules),
```
⚠️ 의존성 배열에 `namingRules` 를 더한다.

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/dbml.test.ts src/dbml-roundtrip.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: `EXIT=0`(Task 2 가 남긴 오류가 여기서 닫힌다).
⚠️ **`dbml-roundtrip.test.ts` 가 깨지면 안 된다** — 심이 템플릿 없는 규칙을 넘기므로 왕복은 그대로다. 깨졌다면 심을 안 넣었거나 왕복 픽스처가 템플릿을 쓰는 것이고, 후자라면 D2(왕복이 깨진다)를 왕복 테스트로 끌고 들어온 것이니 픽스처를 되돌려라.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/dbml.ts packages/core/src/dbml.test.ts \
        packages/core/src/dbml-roundtrip.test.ts apps/web/src/editor/export-dialog.tsx \
        apps/web/src/editor/ddl-import-edits.test.ts && \
git commit -m "feat(core): DBML 이 조합된 테이블 이름을 쓴다

Table·Ref 양쪽·TableGroup 멤버·note 의 물리명이 같은 조합 이름을 본다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: Excel 배선과 `rules` 폴백 제거

**Files:**
- Modify: `packages/core/src/excel-sheets.ts:102-140` 부근
- Modify(심 한 줄): `packages/core/src/excel-sheets.test.ts` · `apps/web/src/editor/excel-file.test.ts`
- Test: `packages/core/src/excel-sheets.test.ts`

**Interfaces:**
- Produces: `buildExcelSheets(model, opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[]; rules: NamingRules })` — **`rules` 필수**

⚠️ **이 파일에 이미 `const rules = opts.rules ?? DEFAULT_NAMING_RULES` 가 있다**(`:106`). Global Constraints 가 금지한 프로덕션 폴백이고, 그룹 별칭 사이클이 「옵셔널 + 기본값으로 뚫었다」고 보고한 자리다. **이번에 필수로 올려 없앤다.** 프로덕션 호출처는 `export-dialog.tsx:99` 하나이고 **이미 `rules: namingRules` 를 넘긴다** — 고칠 것이 없다.

- [ ] **Step 1: 두 테스트 파일에 심을 넣는다**

`packages/core/src/excel-sheets.test.ts` 의 `buildExcelSheets` import 를 교체한다:
```ts
import {
  buildChangeSheet, buildDictTemplateSheets, buildExcelSheets as buildExcelSheetsRaw,
  CHANGE_HEADERS, EXCEL_SHEET_NAME, type ExcelSheetKey,
} from './excel-sheets.js'
import type { ExportScope } from './ddl.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'

const buildExcelSheets = (
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[]; rules?: NamingRules } = {},
) => buildExcelSheetsRaw(model, { ...opts, rules: opts.rules ?? DEFAULT_NAMING_RULES })
```
⚠️ `{ rules: DEFAULT_NAMING_RULES, ...opts }` 순서로 쓰지 마라 — `opts.rules` 가 명시적 `undefined` 면 기본값을 덮어 다시 깨진다.

`apps/web/src/editor/excel-file.test.ts` 에도 같은 심을 넣는다(`@erdd/core` 에서 import).

- [ ] **Step 2: 실패 테스트를 쓴다**

`packages/core/src/excel-sheets.test.ts` 에 추가한다. 이 파일은 `sheetOf(sheets, key)` 헬퍼로 시트를 꺼내고 `rows` 를 배열로 단언한다 — 그 관례를 따른다.

```ts
describe('물리명 템플릿', () => {
  const TPL: NamingRules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }

  it('테이블 목록 시트의 물리명 열이 조합 이름이다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: TPL }), 'tableList')!
    const names = s.rows.map((r) => r[2])          // [그룹, 논리명, 물리명, 설명, …]
    expect(names).toContain('TB_MBR_MBR')
    expect(names).not.toContain('MBR')
  })

  it('테이블 정의서 시트의 물리명 열도 조합 이름이다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: TPL }), 'tableSpec')!
    const names = new Set(s.rows.map((r) => r[2]))
    expect(names.has('TB_MBR_MBR')).toBe(true)
    expect(names.has('MBR')).toBe(false)
  })

  it('템플릿이 없으면 지금과 같다', () => {
    const s = sheetOf(buildExcelSheets(m()), 'tableList')!
    expect(s.rows.map((r) => r[2])).toContain('MBR')
  })
})
```
⚠️ 열 인덱스 `2` 는 `TABLE_LIST_HEADERS`(그룹·논리명·물리명·설명)를 전제한다. **그 상수를 먼저 읽고 맞춰라.**

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/excel-sheets.test.ts
```
기대: 물리명 열이 `MBR` 그대로라 FAIL.

- [ ] **Step 4: 구현한다**

```ts
export function buildExcelSheets(
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[]; rules: NamingRules },
): SheetData[] {
  const scope = opts.scope ?? { kind: 'all' }
  const rules = opts.rules                       // ⚠️ 폴백을 두지 마라 — 프로젝트 규칙을 조용히 무시한다
```
`= {}` 기본값도 지운다(`rules` 가 필수라 빈 객체가 유효하지 않다). `tableList`·`tableSpec` 의 `t.physicalName` 을 `composeTablePhysicalName(t, model, rules)` 로 바꾼다. `:97` 부근의 「rules 는 용어 시트의 파생 컬럼에만 쓴다」 주석도 갱신한다 — 이제 테이블 물리명에도 쓴다.

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm -C packages/core test && pnpm -C apps/web test && pnpm -C packages/cli test
pnpm -r typecheck; echo "EXIT=$?"
```
⚠️ `excel-file.test.ts:147` 의 `buildExcelSheets(restored, dictOnly)` 는 사전 시트만 비교한다 — 심이 붙으면 그대로 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/excel-sheets.ts packages/core/src/excel-sheets.test.ts \
        apps/web/src/editor/excel-file.test.ts && \
git commit -m "feat(core): Excel 물리명 열이 조합된 이름을 쓰고 rules 폴백을 없앤다

opts.rules ?? DEFAULT_NAMING_RULES 는 프로젝트 규칙을 조용히 무시하는 자리였다.
필수 인자로 올려 호출처가 반드시 넘기게 한다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: 검사 배선

**Files:**
- Modify: `packages/core/src/warnings.ts:94-170`
- Test: `packages/core/src/warnings.test.ts`

⚠️ **`computeWarnings(model, rules?, dialects?)` 는 이미 `rules` 를 받는다**(옵셔널). 옵셔널인 것은 「rules 가 없으면 명명 경고를 아예 계산하지 않는다」는 기존 게이트라 **그대로 둔다** — 조합도 그 게이트 안에서만 한다. 여기에 폴백을 넣지 마라.

⚠️ **`checkNamingEntity` 의 `physicalName` 을 통째로 조합 이름으로 바꾸면 안 된다.** 그 인자는 세 곳에 쓰이는데 성격이 다르다:
| 쓰임 | 기준 |
|---|---|
| `term-mismatch`(`:109`) — 용어 사전의 표준 물리명과 비교 | **부분**(사용자가 입력하는 값이 부분이다. 조합 이름과 비교하면 접두 때문에 항상 불일치가 뜬다) |
| `too-long`(`:131`) | **조합** |
| `reserved`(`:137`) | **조합** |
인자를 하나 더 받는다: `finalName: string = physicalName`. 컬럼은 안 넘기므로 기본값으로 부분과 같아진다.

⚠️ **`required-empty`(`:185`)는 부분 기준 그대로 둔다.** rules 게이트 밖이라 조합할 수단도 없고, 「부분을 채워라」는 안내가 맞다. 결과적으로 부분이 비고 접두만 있는 테이블은 **DDL 에는 나가지만 경고는 뜬다** — 의도한 조합이다(내보내기를 막지는 않되 채우라고 알린다). 이 사실을 보고에 적어라.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/warnings.test.ts` 끝에 추가한다. 이 파일은 `tbl(id, over)`·`col(id, tableId, physicalName, over)` 헬퍼와 `createEmptyModel()` 을 쓴다.

```ts
describe('물리명 템플릿과 경고', () => {
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })
  const TPL = 'TB_{그룹별칭}_{물리명}'

  /** g1(MBR)·g2(PRD) 에 각각 부분 이름이 'ORD' 인 테이블을 하나씩. */
  function twoGroups(): ProjectModel {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원', color: '#eeeeee', comment: null, alias: 'MBR' }
    m.tableGroups['g2'] = { id: 'g2', name: '상품', color: '#eeeeee', comment: null, alias: 'PRD' }
    m.tables['t1'] = tbl('t1', { groupId: 'g1', physicalName: 'ORD', logicalName: '주문' })
    m.tables['t2'] = tbl('t2', { groupId: 'g2', physicalName: 'ORD', logicalName: '주문' })
    return m
  }

  // ⚠️ D3 의 근거를 잠근다 — 실제 DB 에서 충돌하는 것은 최종 이름이다.
  it('다른 그룹의 같은 부분 이름은 중복이 아니다', () => {
    const kinds = computeWarnings(twoGroups(), tpl(TPL)).map((w) => w.kind)
    expect(kinds).not.toContain('duplicate-physical-table')
  })

  it('템플릿이 없으면 같은 부분 이름이 중복이다', () => {
    const kinds = computeWarnings(twoGroups(), DEFAULT_NAMING_RULES).map((w) => w.kind)
    expect(kinds).toContain('duplicate-physical-table')
  })

  it('조합 결과가 같으면 부분이 달라도 중복이다', () => {
    const m = twoGroups()
    // 두 테이블이 같은 그룹이면 조합 결과가 같아진다.
    m.tables['t2'] = { ...m.tables['t2']!, groupId: 'g1' }
    const w = computeWarnings(m, tpl(TPL)).filter((x) => x.kind === 'duplicate-physical-table')
    expect(w.map((x) => x.entityId).sort()).toEqual(['t1', 't2'])
    expect(w[0]!.message).toContain('TB_MBR_ORD')       // 문구도 최종 이름이라야 고칠 곳을 안다
  })

  // maxLengthBytes 는 30 이다. 부분 25바이트는 통과, 접두 10바이트를 붙인 35바이트는 초과.
  it('길이 검사가 조합 기준이다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', { physicalName: 'A'.repeat(25), logicalName: '긴이름' })
    const kindsPlain = computeWarnings(m, DEFAULT_NAMING_RULES)
      .filter((w) => w.entityId === 't1').map((w) => w.kind)
    expect(kindsPlain).not.toContain('too-long')

    const kindsTpl = computeWarnings(m, tpl('TB_PREFIX_{물리명}'))   // 접두 10바이트 → 35바이트
      .filter((w) => w.entityId === 't1').map((w) => w.kind)
    expect(kindsTpl).toContain('too-long')
  })

  // 'user' 는 네 방언 공통 예약어다(identifier.ts BASE). 'ER' 은 예약어가 아니다.
  it('예약어 검사가 조합 기준이다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', { physicalName: 'ER', logicalName: '사용자' })
    const plain = computeWarnings(m, DEFAULT_NAMING_RULES, ['postgresql'])
      .filter((w) => w.entityId === 't1').map((w) => w.kind)
    expect(plain).not.toContain('reserved')

    const composed = computeWarnings(m, tpl('US{물리명}'), ['postgresql'])   // → 'USER'
      .filter((w) => w.entityId === 't1').map((w) => w.kind)
    expect(composed).toContain('reserved')
  })

  it('부분이 예약어라도 조합 결과가 예약어가 아니면 경고하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', { physicalName: 'ORDER', logicalName: '주문' })
    expect(computeWarnings(m, DEFAULT_NAMING_RULES, ['postgresql'])
      .filter((w) => w.entityId === 't1').map((w) => w.kind)).toContain('reserved')
    expect(computeWarnings(m, tpl('TB_{물리명}'), ['postgresql'])
      .filter((w) => w.entityId === 't1').map((w) => w.kind)).not.toContain('reserved')
  })

  // ⚠️ 용어 검사만 부분 기준이다 — 사용자가 사전에 등록하는 표준 물리명은 접두가 없는 값이다.
  it('용어 불일치 검사는 조합 이름에 오염되지 않는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', { physicalName: 'ORD', logicalName: '주문' })
    m.terms['tm1'] = term('tm1', '주문', 'ORD')
    expect(computeWarnings(m, tpl(TPL)).filter((w) => w.kind === 'term-mismatch')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/warnings.test.ts
```
기대: 중복·길이·예약어 케이스가 FAIL(용어 케이스는 이미 통과 — 구현 후에도 통과해야 하는 회귀 방지 케이스다).

- [ ] **Step 3: 구현한다**

`checkNamingEntity` 에 인자를 하나 더한다:
```ts
    const checkNamingEntity = (
      scope: 'table' | 'column', entityId: string, tableId: string | undefined,
      logicalName: string, physicalName: string,
      // ⚠️ 길이·예약어만 최종 이름 기준이다. 용어 비교는 사용자가 입력하는 부분과 해야 한다.
      finalName: string = physicalName,
    ) => {
```
`:131` `new TextEncoder().encode(finalName)` · `:134` 문구도 `finalName` · `:137` `isReservedWord(finalName, d)` · `:140` 문구도 `finalName`. 나머지(용어·미등록 단어·논리 구분자)는 그대로 둔다.

테이블 루프:
```ts
    for (const t of Object.values(model.tables)) {
      checkNamingEntity('table', t.id, undefined, t.logicalName, t.physicalName,
        composeTablePhysicalName(t, model, rules))
    }
```
컬럼 루프는 그대로(6번째 인자를 안 넘긴다).

중복 블록(`:152-169`)을 최종 이름 기준으로 바꾼다:
```ts
    // 실제 DB 에서 충돌하는 것은 최종 이름이다 — 다른 그룹의 같은 부분 이름은 충돌이 아니다(설계 D3).
    const tableNames = new Map<string, string[]>() // 조합된 최종 이름 → tableIds
    for (const t of Object.values(model.tables)) {
      const finalName = composeTablePhysicalName(t, model, rules)
      if (finalName === '') continue
      const ids = tableNames.get(finalName) ?? []
      ids.push(t.id)
      tableNames.set(finalName, ids)
    }
    for (const [finalName, ids] of tableNames) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical-table', scope: 'table', entityId: id,
          severity: 'error',
          message: `테이블 물리명 "${finalName}"이(가) 중복됩니다`,
        })
      }
    }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/warnings.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
⚠️ `apps/web` 도 돌린다 — `edit-panel`·`table-tree` 가 경고를 화면에 붙인다.

- [ ] **Step 5: 용어 검사 분리가 진짜 잠기는지 실증한다**

`checkNamingEntity` 의 `:109` 비교를 `term.physicalName !== finalName` 으로 바꾼다.
```bash
git diff packages/core/src/warnings.ts                  # 바뀐 줄을 눈으로 본다
pnpm -C packages/core exec vitest run src/warnings.test.ts -t '용어 불일치'
```
기대: **FAIL**. 되돌리고 PASS를 확인한 뒤 **양쪽 결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/warnings.ts packages/core/src/warnings.test.ts && \
git commit -m "feat(core): 중복·길이·예약어 검사가 조합된 이름을 본다

실제 DB 에서 충돌하는 것은 최종 이름이다 — 다른 그룹의 같은 부분 이름(ORD)은
최종 이름이 갈리므로 중복이 아니다. 용어 검사만 부분 기준으로 남긴다: 사전의
표준 물리명은 사용자가 입력하는 값이라 접두가 없다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: 서버 확인과 CLI 설정

**Files:**
- Test: `apps/server/src/routers/project.test.ts:160-220` 부근에 추가
- Modify: `packages/cli/src/config.ts:50-69` · `packages/cli/src/config.test.ts`

서버 코드는 **고칠 것이 없다** — `project.ts:69` 가 이미 `NamingRulesSchema.parse` 를 태우고, `update` 는 `NamingRulesStrictSchema` 를 쓴다. Task 1 이 두 스키마를 다르게 고쳤으므로 **동작이 맞는지 테스트로 확인만** 한다. 논리명 구분자 사이클에서 이 자리가 급소였다.

- [ ] **Step 1: 서버 실패 테스트를 쓴다**

`apps/server/src/routers/project.test.ts` 의 기존 `logicalSeparator` 케이스 바로 아래에, 같은 형태로 추가한다(그 케이스들의 `db.update(...).set({ namingRules })` 패턴을 그대로 따른다).

```ts
  it('tablePhysicalTemplate 키가 없는 기존 행에 빈 문자열을 주입해 내려준다', async () => {
    await db.update(projects)
      .set({ namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 } })
      .where(eq(projects.id, projectId))
    const got = await caller.project.get({ projectId })
    expect(got.namingRules.tablePhysicalTemplate).toBe('')
  })

  it('설정된 템플릿은 그대로 내려준다', async () => {
    await db.update(projects)
      .set({ namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}',
      } })
      .where(eq(projects.id, projectId))
    const got = await caller.project.get({ projectId })
    expect(got.namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
  })

  // ⚠️ 급소. strict 스키마가 .default('') 를 물려받으면 4키만 보낸 클라이언트가 설정해 둔
  // 템플릿을 조용히 지운다 — 부분 페이로드가 전체 덮어쓰기로 둔갑한다.
  it('tablePhysicalTemplate 가 빠진 namingRules 는 update 가 거절하고 설정값을 지킨다', async () => {
    await caller.project.update({
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{물리명}',
      },
    })
    await expect(caller.project.update({
      projectId,
      // @ts-expect-error tablePhysicalTemplate 를 일부러 뺀 옛 클라이언트 페이로드
      namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 },
    })).rejects.toThrow()
    const got = await caller.project.get({ projectId })
    expect(got.namingRules.tablePhysicalTemplate).toBe('TB_{물리명}')
  })

  it('update 로 템플릿을 바꿀 수 있다', async () => {
    await caller.project.update({
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'PRE_{논리명}',
      },
    })
    expect((await caller.project.get({ projectId })).namingRules.tablePhysicalTemplate)
      .toBe('PRE_{논리명}')
  })
```
⚠️ `db`·`caller`·`projectId`·`projects`·`eq` 는 그 파일이 이미 쓰는 것들이다. **기존 케이스를 먼저 읽고 이름을 맞춰라.**

- [ ] **Step 2: CLI 실패 테스트를 쓴다**

`packages/cli/src/config.test.ts` — 논리명 구분자와 **다른 정책**이다. `logicalSeparator` 는 값 집합이 `'_' | ''` 로 좁아 오타를 거절할 수 있었지만, 템플릿은 **임의 문자열이라 「잘못 적은 값」이 없다.** 그래서 누락만 채우고 검증은 하지 않는다.

```ts
  it('tablePhysicalTemplate 가 없는 옛 config 에 빈 문자열을 채운다', async () => {
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  logicalSeparator: "_"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    expect((await readConfig(dir)).namingRules.tablePhysicalTemplate).toBe('')
  })

  it('적어 둔 템플릿은 그대로 읽는다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: { ...CONFIG.namingRules, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' },
    })
    expect((await readConfig(dir)).namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
  })
```
파일 상단 `CONFIG` 상수(`:15-20`)의 `namingRules` 에도 `tablePhysicalTemplate: ''` 를 더한다(Task 1 의 리터럴 grep 에 이미 잡혔을 수 있다).

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm -C packages/cli exec vitest run src/config.test.ts
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts
```
기대: CLI 는 `undefined` 라 FAIL. 서버는 **Task 1 의 스키마가 맞으면 이미 통과할 수 있다** — 통과하면 그것이 「서버는 확인만」의 확인이다. **통과했다는 사실을 보고에 적어라**(빨강을 못 봤다면 그 테스트가 무엇을 잠그는지 Step 5 에서 실증한다).
🔥 `. ./.env` 로 돌리지 마라 — 개발 DB가 날아간다.

- [ ] **Step 4: 구현한다**

`packages/cli/src/config.ts:66-69` 의 반환을 고친다:
```ts
  // 템플릿은 임의 문자열이라 「잘못 적은 값」이 없다 — logicalSeparator 와 달리 검증하지 않고
  // 누락만 빈 문자열로 채운다(빈 문자열 = 템플릿을 쓰지 않음).
  const tpl = namingRules['tablePhysicalTemplate']
  const tablePhysicalTemplate = typeof tpl === 'string' ? tpl : ''
  return {
    serverUrl, projectId, dialects,
    namingRules: {
      ...(namingRules as unknown as NamingRules), logicalSeparator, tablePhysicalTemplate,
    },
  }
```

- [ ] **Step 5: 통과를 확인하고 서버 스키마를 실증한다**

```bash
pnpm -C packages/cli test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts
```

`packages/core/src/naming.ts` 의 `NamingRulesStrictSchema` 에서 `tablePhysicalTemplate: z.string()` 줄을 **지운다**(= `.default('')` 를 물려받게 만든다).
```bash
git diff packages/core/src/naming.ts     # 그 줄이 실제로 사라졌는지 눈으로 본다
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts -t '거절하고 설정값을 지킨다'
```
기대: **FAIL**(update 가 통과해 템플릿이 `''` 로 덮인다). 되돌리고 PASS를 확인한 뒤 **양쪽 결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/routers/project.test.ts packages/cli/src/config.ts \
        packages/cli/src/config.test.ts && \
git commit -m "feat(cli): 템플릿 키를 config 에서 읽고 서버 동작을 테스트로 못 박는다

서버는 이미 NamingRulesSchema.parse 를 태우고 있어 코드 변경이 없다. 옛 행에 ''
가 주입되는 것과, 키를 뺀 update 가 거절되는 것을 테스트로 고정한다. CLI 는 임의
문자열이라 검증 없이 누락만 채운다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 7: web — 설정 입력란과 미리보기

**Files:**
- Modify: `apps/web/src/pages/project-settings.tsx:106-142`(`NamingRulesSection`)
- Modify: `apps/web/src/pages/project-settings.test.tsx`
- Modify: `apps/web/src/editor/edit-panel.tsx:97-111`
- Modify: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: `composeTablePhysicalName(table, model, rules)` (Task 1)

⚠️ **미리보기를 `NamePair` 안에 넣지 마라.** `NamePair` 는 테이블과 컬럼이 공유하는데 **컬럼에는 템플릿이 없다**(범위 밖). 넣으면 컬럼에도 뜨거나 조건 prop 이 하나 더 생긴다. **`edit-panel.tsx` 의 테이블 영역에서 `NamePair` 바로 아래**에 둔다.

⚠️ **설정 화면은 모델을 안 갖고 있다.** 설계 3.4 의 「현재 모델의 테이블 하나로 미리보기」를 지키려면 `trpc.model.get` 을 한 번 더 부른다(에디터가 이미 쓰는 쿼리라 react-query 캐시를 탄다). 테이블이 하나도 없으면 **고정 예시**(그룹별칭 `MBR` · 물리명 `ORD` · 논리명 `주문` 인 가상 테이블)로 떨어진다.

- [ ] **Step 1: 설정 화면 실패 테스트를 쓴다**

`apps/web/src/pages/project-settings.test.tsx` — `projectFixture` 에 `tablePhysicalTemplate` 를 받는 필드를 더하고(`over.tablePhysicalTemplate ?? ''`), `renderSettings` 의 기본 핸들러에 `'model.get'` 을 더한다.

```ts
const MODEL_FIXTURE = {
  ...createEmptyModel(),
  tableGroups: { g1: { id: 'g1', name: '회원관리', color: '#eeeeee', comment: null, alias: 'MBR' } },
  tables: {
    t1: {
      id: 't1', logicalName: '주문', physicalName: 'ORD', comment: null, groupId: 'g1',
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    },
  },
}
```

```ts
describe('ProjectSettingsPage — 테이블 물리명 형식', () => {
  it('현재 템플릿을 입력란에 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tablePhysicalTemplate: 'TB_{물리명}' }) }),
      'model.get': () => ({ data: MODEL_FIXTURE }),
    })
    expect(await screen.findByLabelText(/테이블 물리명 형식/)).toHaveValue('TB_{물리명}')
  })

  it('입력하고 포커스를 빼면 update 로 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture() }),
      'model.get': () => ({ data: MODEL_FIXTURE }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    const input = await screen.findByLabelText(/테이블 물리명 형식/)
    await userEvent.type(input, 'TB_{{그룹별칭}_{{물리명}')   // userEvent 에서 '{' 는 '{{' 로 이스케이프
    await userEvent.tab()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
    // 나머지 규칙은 그대로 실어 보낸다(객체 통째다)
    expect(calls[0]!.namingRules.logicalSeparator).toBe('_')
    expect(calls[0]!.namingRules.maxLengthBytes).toBe(30)
  })

  it('현재 모델의 테이블로 미리보기를 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }) }),
      'model.get': () => ({ data: MODEL_FIXTURE }),
    })
    expect(await screen.findByText('TB_MBR_ORD')).toBeInTheDocument()
  })

  // ⚠️ 오타를 즉시 알게 하는 것이 미리보기의 목적이다(설계 3.2 — 알 수 없는 변수는 빈 값).
  it('없는 변수를 적으면 미리보기가 그 자리를 비워 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tablePhysicalTemplate: 'TB_{그룹별칙}_{물리명}' }) }),
      'model.get': () => ({ data: MODEL_FIXTURE }),
    })
    expect(await screen.findByText('TB_ORD')).toBeInTheDocument()
  })

  it('관리 권한이 없으면 입력란이 없다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }) }),
      'model.get': () => ({ data: MODEL_FIXTURE }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByLabelText(/테이블 물리명 형식/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 편집 패널 실패 테스트를 쓴다**

`apps/web/src/editor/edit-panel.test.tsx` — 이 파일의 기존 렌더 헬퍼(store 에 모델·`namingRules` 를 넣고 `selectTables([...])` 로 고르는 형태)를 그대로 쓴다.

```ts
describe('EditPanel — 테이블 물리명 미리보기', () => {
  it('템플릿이 있으면 조합 결과를 보여 준다', async () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    renderPanel(m, { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    act(() => { useEditorStore.getState().selectTables(['t2']) })   // t2 = MBR
    expect(await screen.findByText('→ TB_MBR_MBR')).toBeInTheDocument()
  })

  it('템플릿이 없으면 미리보기를 렌더하지 않는다', async () => {
    renderPanel(buildSampleModel(), DEFAULT_NAMING_RULES)
    act(() => { useEditorStore.getState().selectTables(['t2']) })
    await screen.findByLabelText(/테이블 물리명/)
    expect(screen.queryByText(/^→ /)).not.toBeInTheDocument()
  })

  // ⚠️ 컬럼에는 템플릿이 없다(범위 밖). NamePair 안에 넣으면 여기가 빨개진다.
  it('컬럼 물리명에는 미리보기가 없다', async () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    renderPanel(m, { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    act(() => {
      useEditorStore.getState().selectTables(['t2'])
      useEditorStore.getState().selectColumns(['c2'])                // ⚠️ 실제 액션 이름에 맞춰라
    })
    await screen.findByLabelText(/^물리명/)
    expect(screen.getAllByText(/^→ /)).toHaveLength(1)               // 테이블 것 하나뿐
  })
})
```
⚠️ `renderPanel`·`selectColumns` 는 그 파일의 실제 헬퍼·store 액션 이름에 맞춰라. `→ ` 접두는 아래 구현과 맞춘 것이다.

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/pages/project-settings.test.tsx src/editor/edit-panel.test.tsx
```
기대: 입력란·미리보기가 없어 FAIL.

- [ ] **Step 4: 구현한다**

`project-settings.tsx` 의 `NamingRulesSection` 에 더한다. **입력은 로컬 draft 로 받고 blur 에 커밋한다** — 매 글자마다 mutate 하면 안 된다.

```tsx
function TemplatePreview({ template, model }: { template: string; model: ProjectModel | undefined }) {
  if (template === '') return null
  const table = model === undefined ? undefined : Object.values(model.tables)[0]
  // 모델에 테이블이 없으면 가상 예시로 보여 준다 — 새 프로젝트에서도 형식을 확인할 수 있어야 한다.
  const sample: ProjectModel = table !== undefined && model !== undefined ? model : {
    ...createEmptyModel(),
    tableGroups: { g: { id: 'g', name: '회원관리', color: '#eeeeee', comment: null, alias: 'MBR' } },
    tables: { t: {
      id: 't', logicalName: '주문', physicalName: 'ORD', comment: null, groupId: 'g',
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    } },
  }
  const target = table ?? sample.tables['t']!
  const composed = composeTablePhysicalName(
    target, sample, { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: template })
  return (
    <p className="text-xs text-muted-foreground">
      미리보기: <span className="font-mono text-foreground">{composed}</span>
    </p>
  )
}
```
⚠️ `TemplatePreview` 안의 `DEFAULT_NAMING_RULES` 는 **폴백이 아니라 「미리보기는 템플릿만 본다」**는 뜻이다 — 조합은 `case`·`separator`·`maxLengthBytes` 를 쓰지 않는다. 다른 규칙을 섞으면 오히려 오해를 만든다.

`NamingRulesSection` 본문:
```tsx
  const model = useQuery(trpc.model.get.queryOptions({ projectId }))
  const [template, setTemplate] = useState(namingRules.tablePhysicalTemplate)
  // 서버 값이 바뀌면 draft 를 맞춘다. ⚠️ projectId 를 deps 에 함께 넣는다 — 그룹 별칭 사이클에서
  // 값만 넣었다가 「같은 값을 가진 다른 대상」으로 옮길 때 draft 가 남는 버그를 만들었다.
  useEffect(() => { setTemplate(namingRules.tablePhysicalTemplate) },
    [projectId, namingRules.tablePhysicalTemplate])
```
```tsx
      <div className="grid gap-1">
        <Label htmlFor="tpl" className="text-xs">테이블 물리명 형식</Label>
        <input
          id="tpl" className="h-9 rounded-md border bg-background px-2 font-mono text-sm"
          value={template} disabled={update.isPending}
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={() => {
            if (template === namingRules.tablePhysicalTemplate) return
            update.mutate({ projectId, namingRules: { ...namingRules, tablePhysicalTemplate: template } })
          }}
        />
        <p className="text-xs text-muted-foreground">
          비우면 입력한 물리명을 그대로 씁니다. 쓸 수 있는 변수:
          <code className="font-mono"> {'{그룹별칭}'} {'{그룹명}'} {'{물리명}'} {'{논리명}'} {'{커스텀:항목이름}'}</code>
        </p>
        <TemplatePreview template={template} model={model.data} />
      </div>
```

`edit-panel.tsx` — `NamePair`(`:101-110`) 바로 아래에 넣는다:
```tsx
        {namingRules.tablePhysicalTemplate !== '' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-mono">→ {composeTablePhysicalName(table, model, namingRules)}</span>
          </p>
        )}
```
⚠️ `table` 은 이 시점에 non-null 이 보장돼 있다(`:84` 의 조기 반환). `namingRules` 도 `:60` 에서 이미 읽는다.

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/project-settings.tsx apps/web/src/pages/project-settings.test.tsx \
        apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 설정에 물리명 형식 입력란을, 편집 패널에 미리보기를 넣는다

미리보기는 NamePair 밖에 둔다 — 컬럼에는 템플릿이 없어서 안에 넣으면 컬럼에도
뜨거나 조건 prop 이 하나 늘어난다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 8: 문서와 최종 검증

**Files:**
- Modify: `docs/13-naming.md` · `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 문서를 쓴다**

`docs/13-naming.md` — 명명 체계에 「테이블 물리명 형식」 절을 더한다: 변수 다섯, 빈 구간 접기 규칙(설계 3.2 의 표를 그대로), **저장은 부분·산출은 조합**이라는 것, 검사(중복·길이·예약어)가 조합 기준이고 **용어 검사만 부분 기준**이라는 것.

`docs/manual/user-guide.md` — 설정의 형식 입력란과 편집 패널 미리보기 사용법. ⚠️ **왕복 주의를 굵게 적는다:**
> 템플릿을 쓰는 프로젝트에서 내보낸 DDL 을 다시 가져오면 `TB_MBR_ORD` 가 통째로 물리명이 됩니다.
> 다시 내보내면 `TB_MBR_TB_MBR_ORD` 가 됩니다 — 가져온 뒤 접두를 손으로 지우세요.

`docs/superpowers/HANDOFF.md`:
- 머리말의 **최종 갱신 · main HEAD · 마이그레이션** 갱신
- 완료 표에 이 사이클 추가
- 테스트 기준선을 실측값으로 갱신
- 3절(아키텍처 불변식)에 항목 추가:
  > **테이블의 최종 물리명은 `composeTablePhysicalName` 한 곳에서 나온다.** 산출물·검사를 새로 만들면
  > 그 함수를 타야 한다. `table.physicalName` 을 직접 쓰면 템플릿이 걸린 프로젝트에서 조용히 어긋난다.
  > 예외는 **편집 입력란·클립보드·CLI 파일·역설계**다(설계 D3 — 그쪽은 부분을 쓴다).
- 3절에 또 하나:
  > **`rules` 를 받는 함수에 `?? DEFAULT_NAMING_RULES` 폴백을 두지 않는다.** 두 사이클 연속으로 그
  > 폴백이 프로젝트 규칙을 조용히 무시하는 결함이었다(`dict-panel.tsx` · `buildExcelSheets`).
  > 테스트가 편하려면 **테스트 파일에 import 별칭 심**을 두어라 — 프로덕션 시그니처는 필수로 남긴다.
- 6절 이월에 설계 6절 네 항목(논리명 템플릿 · 역분해 · 컬럼 템플릿 · CLI 최종 이름)

- [ ] **Step 2: 최종 검증**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -C apps/web test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_c' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
🔥 `. ./.env` 금지. 서버가 `20 passed | 174 skipped` 로 끝나면 **미실행**이다 — `DATABASE_URL` 을 다시 확인한다.
각 스위트의 **실측 통과 수를 보고에 적는다**(기준선 `core 700 · cli 141 · web 917 · server 202` 대비 증가분).

- [ ] **Step 3: 커밋**

```bash
git add docs/13-naming.md docs/manual/user-guide.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 테이블 물리명 형식 템플릿을 문서에 넣는다

왕복이 깨지는 것(내보낸 DDL 을 되읽으면 접두가 박힌다)을 사용자 문서에 경고로
남긴다. 조합이 한 함수에서만 나온다는 것과 rules 폴백 금지를 불변식에 더한다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 사용자가 돈다)

⚠️ 확장이 하나뿐이라 이것만 사용자·컨트롤러가 직접 돈다(`CLAUDE.md` 의 예외).

1. 설정에 `TB_{그룹별칭}_{물리명}` 을 넣고 **미리보기가 실제 테이블 이름으로** 뜨는지.
2. 오타(`{그룹별칙}`)를 내면 미리보기가 그 자리를 비워 보여 주는지 — 화면이 죽지 않는지.
3. 편집 패널에서 테이블 물리명 아래 `→ TB_MBR_ORD` 가 뜨는지, **컬럼에는 안 뜨는지**.
4. DDL 내보내기 — `CREATE TABLE`·FK·인덱스·코멘트가 **모두** 조합 이름인지(하나라도 다르면 DDL 이 깨진다).
5. 그룹이 없는 테이블이 `TB__ORD` 가 아니라 `TB_ORD` 로 나오는지.
6. 그룹 별칭을 바꾸면 DDL 미리보기가 **즉시** 따라오는지(D1 의 값).
7. Excel 내보내기의 물리명 열이 조합 이름인지.
8. 설정에서 템플릿을 지우면 전부 원래대로 돌아오는지.
9. **사이드바 트리·클립보드 복사는 부분(`ORD`) 그대로인지**(D3 의 경계).
