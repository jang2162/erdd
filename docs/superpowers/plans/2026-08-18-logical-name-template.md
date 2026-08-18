# 테이블 논리명 형식 템플릿 + 접기 규칙 변경 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 테이블 논리명도 템플릿으로 조합해 DDL 코멘트·DBML note·Excel 논리명 열에 내보내고, 빈 변수가 뒤 리터럴을 통째로 먹던 접기 규칙을 「밑줄만 지운다」로 고친다.

**Architecture:** 조합 몸통 `compose(template, table, model)` 하나를 두고 `composeTablePhysicalName`·`composeTableLogicalName` 두 형제가 각자 템플릿만 골라 넘긴다. 논리명 조합은 **산출물 전용**이라 `warnings.ts` 는 한 줄도 안 바뀐다.

**Tech Stack:** TypeScript · zod · vitest · React 19

**설계 문서:** `docs/superpowers/specs/2026-08-18-logical-name-template-design.md`

## Global Constraints

- **마이그레이션 없음.** `naming_rules` 는 jsonb 이고 `project.get` 이 `NamingRulesSchema.parse` 를 이미 태운다. DB 스키마 파일을 고치면 범위를 넘은 것이다.
- **`warnings.ts` 를 고치지 마라.** 논리명에는 조합 기준이라야 의미가 있는 검사가 없다(중복·길이·예약어는 전부 물리명 쪽). 설계 D1. Task 4 가 「안 바뀌는 것」을 테스트로 잠근다.
- **컬럼은 건드리지 않는다**(설계 범위 밖).
- **`DEFAULT_NAMING_RULES` 를 프로덕션 폴백으로 쓰지 마라.** 테스트 파일의 import 별칭 심은 허용이다(직전 사이클이 깐 관례).
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...` 을 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 740 · cli 143 · web 926 · server 206 · typecheck EXIT=0`.
- **typecheck 는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라.** 서버 테스트는 격리 DB 를 명시한다:
  `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_d' …`
  `20 passed | 174 skipped` 로 끝나면 **미실행**이다.
- **작업 디렉터리는 워크트리다.**

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/name-template.ts` | 접기 규칙 교체 · `compose` 추출 · 논리명 형제 함수 | 수정 |
| `packages/core/src/name-template.test.ts` | 위 | 수정 |
| `packages/core/src/naming.ts` | `tableLogicalTemplate` + 두 스키마 | 수정 |
| `packages/core/src/index.ts` | 재export | 수정 |
| `packages/core/src/ddl.ts` | 코멘트 2자리 + `warningLabel` | 수정 |
| `packages/core/src/dbml.ts` | note 의 논리명 | 수정 |
| `packages/core/src/excel-sheets.ts` | 논리명 열 2자리 | 수정 |
| `packages/core/src/warnings.test.ts` | **무변경을 잠그는 테스트만 추가**(프로덕션 코드는 그대로) | 수정 |
| `apps/web/src/pages/project-settings.tsx` | 두 번째 입력란 + 미리보기 | 수정 |
| `apps/web/src/editor/edit-panel.tsx` | 미리보기 두 줄(라벨 부착) | 수정 |
| `packages/cli/src/config.ts` | 옵셔널 키 | 수정 |
| 문서 3종 | | 수정 |

### ⚠️ 착수 전에 알아야 할 사실 (조사 완료 — 다시 조사하지 마라)

1. **`generateDdl`·`ddlWarnings`·`generateDbml`·`buildExcelSheets` 는 이미 `rules` 를 필수로 받는다**(직전 사이클). **새로 뚫을 인자가 없다.**
2. 그 테스트 파일들에는 **import 별칭 심**이 이미 깔려 있다(`generateDdl as generateDdlRaw` + 기본값 래퍼). 새 케이스에서 `rules` 를 넘기려면 심이 아니라 `…Raw` 를 쓰거나 4번째 인자를 주면 된다 — **심을 새로 만들지 마라.**
3. **편집 패널의 물리명 미리보기는 `NamePair` 바깥, 두 칸 아래**에 있다(`edit-panel.tsx:111-116`). 논리명 미리보기도 같은 자리에 놓고 **라벨로 구분**한다. `NamePair` 에 prop 을 뚫지 마라.
4. **기존 미리보기 단언 3건이 문구 변경으로 함께 바뀐다** — `edit-panel.test.tsx:674`(`'→ TB_MBR_MBR'`), `:682`(`/^→ /`), `:692`(`getAllByText(/^→ /)`).
5. `excel-sheets.ts:156-166` 의 `logicalName` 은 **`Word`·`Term`** 이다(단어사전·용어사전 시트). **건드리지 마라.**
6. `TemplatePreview`(`project-settings.tsx:111-130`)는 지금 `composeTablePhysicalName` 을 하드코딩한다. `kind` prop 을 받아 갈라야 한다.

---

## Task 1: 접기 규칙을 「밑줄만 지운다」로 바꾼다

**Files:**
- Modify: `packages/core/src/name-template.ts:56-76`(`composeTablePhysicalName` 의 루프와 doc 주석)
- Test: `packages/core/src/name-template.test.ts`(`describe('빈 구간 접기')`)

**Interfaces:**
- Produces: `composeTablePhysicalName` 의 시그니처는 그대로. **동작만 바뀐다.**

- [x] **Step 1: 실패 테스트를 쓴다**

`name-template.test.ts` 의 `describe('빈 구간 접기')` **안에** 추가한다. 그 describe 에는 이미
`model()`·`rulesWith()`·`compose()`·`noGroup()`·`noPhysical()` 헬퍼가 있다 — **먼저 읽고 그대로 쓴다.**

```ts
  // ⚠️ 여기부터가 이 태스크에서 새로 잠그는 것이다(설계 D2).
  it('변수 뒤 리터럴이 구분자 하나가 아니면 밑줄만 지운다', () => {
    expect(compose('TB_{그룹별칭}_LOG', noGroup())).toBe('TB_LOG')
  })

  it('맨 앞 변수가 비어도 뒤 리터럴의 낱말은 남는다', () => {
    expect(compose('{그룹별칭}_LOG_{물리명}', noGroup())).toBe('LOG_ORD')
  })

  // ⚠️ 급소. 앞 변수가 남긴 **빈 조각**을 건너뛰지 않으면 'TB_' 가 나온다.
  it('연속으로 비고 뒤에 리터럴이 없으면 앞 리터럴의 말미 밑줄까지 지운다', () => {
    expect(compose('TB_{그룹별칭}_{그룹명}', noGroup())).toBe('TB')
  })

  // ⚠️ 변수 값은 절대 건드리지 않는다 — 사용자가 넣은 말미 밑줄이 살아남아야 한다.
  it('앞 조각이 변수 값이면 말미 밑줄을 지우지 않는다', () => {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'ORD_', groupId: null }
    expect(composeTablePhysicalName(m.tables['t2']!, m, rulesWith('{물리명}{그룹별칭}'))).toBe('ORD_')
  })

  it('밑줄이 여럿이어도 선두 밑줄을 모두 지운다', () => {
    expect(compose('TB_{그룹별칭}__LOG', noGroup())).toBe('TB_LOG')
  })

  // 별칭이 있으면 아무것도 안 지운다(대조군).
  it('변수에 값이 있으면 리터럴이 그대로 남는다', () => {
    expect(compose('TB_{그룹별칭}_LOG')).toBe('TB_MBR_LOG')
  })
```

⚠️ **기존 케이스 6건을 고치지 마라.** 이 태스크의 성공 조건은 **그것들이 하나도 안 깨지는 것**이다.

- [x] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts -t '빈 구간 접기'
```
기대: 새 케이스 중 최소 4건 FAIL(`'TB_'` vs `'TB_LOG'`, `'ORD'` vs `'LOG_ORD'` 등). 대조군 1건은 통과.

- [x] **Step 3: 구현한다**

`name-template.ts` 에 조각 타입과 말미 정리 헬퍼를 더하고 루프를 바꾼다.

```ts
/**
 * 조합 중간 조각. `lit` 은 「리터럴 토큰에서 왔는가」다.
 * ⚠️ 이 표시가 필요한 이유: 말미 밑줄을 지울 때 **변수 값은 건드리면 안 된다**(설계 D2).
 * 사용자가 물리명을 'ORD_' 로 넣었으면 그대로 나가야 한다.
 */
type Piece = { text: string; lit: boolean }

/**
 * 조각 배열 말미의 밑줄을 정리한다.
 *
 * ⚠️ **뒤에서부터 훑는 것이 급소다.** 직전 조각 하나만 보면 `TB_{A}_{B}` 에서 A·B 가 둘 다 빌 때
 * A 가 남긴 **빈 조각**에 막혀 `TB_` 가 나온다. 빈 조각을 버리며 계속 훑어야 `TB` 가 된다.
 */
function trimTrailingSeparator(out: Piece[]): void {
  for (let k = out.length - 1; k >= 0; k -= 1) {
    const p = out[k]!
    if (p.text === '') { out.pop(); continue }
    if (!p.lit) return                       // 변수 값 — 건드리지 않는다
    p.text = p.text.replace(/_+$/, '')
    if (p.text === '') out.pop()
    return
  }
}
```

`composeTablePhysicalName` 의 루프를 통째로 교체한다:

```ts
  if (rules.tablePhysicalTemplate === '') return table.physicalName
  const tokens = parseTemplate(rules.tablePhysicalTemplate)
  const out: Piece[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.kind === 'lit') { out.push({ text: tok.text, lit: true }); continue }
    const value = resolveVar(tok.name, table, model)
    if (value !== '') { out.push({ text: value, lit: false }); continue }
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') {
      // 뒤 리터럴을 통째로 버리지 않는다 — 선두 밑줄만 지우고 낱말은 남긴다.
      out.push({ text: next.text.replace(/^_+/, ''), lit: true })
      i += 1
      continue
    }
    trimTrailingSeparator(out)
  }
  return out.map((p) => p.text).join('')
```

**doc 주석의 빈 변수 규칙 문단을 새 규칙으로 고친다:**

```
 * ⚠️ 빈 변수 규칙(설계 D2): **빈 변수는 자기 자신과 바로 뒤 리터럴 선두의 밑줄들을 지운다. 뒤에
 * 리터럴이 없으면 바로 앞 리터럴 말미의 밑줄들을 지운다. 변수 값은 절대 건드리지 않는다.**
 * 정규식 후처리로 흉내내지 않는다 — 변수 값 안의 연속 밑줄(`A__B`)까지 접힌다.
```

- [x] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: `EXIT=0`, **기존 케이스 전부 그대로**. `ddl.test.ts`·`excel-sheets.test.ts` 도 안 깨져야 한다 —
그 테스트들은 `TB_{그룹별칭}_{물리명}` 만 쓰고 그 형은 결과가 안 바뀐다. 깨졌다면 새 루프가 기존 6형을
보존하지 못한 것이다.

- [x] **Step 5: 두 급소가 진짜 잠기는지 실증한다**

**(a) 선두 밑줄만 지우기**
`out.push({ text: next.text.replace(/^_+/, ''), lit: true })` 를 `i += 1; continue` (뒤 리터럴 통째
버리기 — 옛 동작)로 되돌린다.
```bash
git diff packages/core/src/name-template.ts        # 바뀐 줄을 눈으로 본다
pnpm -C packages/core exec vitest run src/name-template.test.ts -t '빈 구간 접기'
```
기대: **FAIL** — `'TB_LOG'` 자리에 `'TB_'`, `'LOG_ORD'` 자리에 `'ORD'`.

**(b) 뒤에서부터 훑기**
`trimTrailingSeparator` 의 `if (p.text === '') { out.pop(); continue }` 줄을 지운다.
```bash
git diff packages/core/src/name-template.ts
pnpm -C packages/core exec vitest run src/name-template.test.ts -t '연속으로 비고'
```
기대: **FAIL** — `'TB'` 자리에 `'TB_'`.

둘 다 되돌리고 초록을 확인한 뒤 **네 결과(빨강 2·초록 2)를 보고에 적는다.**

- [x] **Step 6: 커밋**

```bash
git add packages/core/src/name-template.ts packages/core/src/name-template.test.ts && \
git commit -m "fix(core): 빈 변수가 뒤 리터럴을 통째로 먹지 않게 한다

TB_{그룹별칭}_LOG 에서 별칭이 비면 _LOG 가 함께 사라져 TB_ 가 나왔다. 지우는 단위를
리터럴 토큰 하나에서 그 리터럴 선두·말미의 밑줄로 좁혀 TB_LOG 가 되게 한다. 기존
여섯 형의 결과는 그대로다. 말미 정리는 빈 조각을 건너뛰며 뒤에서부터 훑고, 변수
값 조각을 만나면 멈춘다 — 사용자가 넣은 말미 밑줄을 지우면 안 된다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 2: 논리명 조합 엔진

**Files:**
- Modify: `packages/core/src/name-template.ts`(`compose` 추출 + 형제 함수) · `packages/core/src/naming.ts:4-49` · `packages/core/src/index.ts`
- Test: `packages/core/src/name-template.test.ts`

**Interfaces:**
- Consumes: Task 1 의 접기 규칙
- Produces:
  ```ts
  export function composeTableLogicalName(
    table: Table, model: ProjectModel, rules: NamingRules,
  ): string
  ```
  `NamingRules` 에 `tableLogicalTemplate: string`(기본 `''`).

⚠️ **`NamingRules` 리터럴이 저장소 전역에서 깨진다**(직전 두 사이클과 같은 형태). Step 3 의 grep 으로
전부 찾아 고치고 `pnpm -r typecheck` 로 확인한다.

- [x] **Step 1: 실패 테스트를 쓴다**

`name-template.test.ts` 끝에 추가한다. 파일 상단 import 에 `composeTableLogicalName` 을 더한다.

```ts
describe('composeTableLogicalName', () => {
  const withLogical = (tableLogicalTemplate: string): NamingRules =>
    ({ ...DEFAULT_NAMING_RULES, tableLogicalTemplate })
  /** model(): g1 = 회원관리(별칭 MBR), t2 = 주문/ORD 소속. name-template.test.ts 상단 헬퍼. */
  const composeL = (tpl: string, m: ProjectModel = model()) =>
    composeTableLogicalName(m.tables['t2']!, m, withLogical(tpl))

  // ⚠️ 물리명과 같은 계약이다 — 소비처가 템플릿 유무를 몰라도 된다(설계 D4).
  it('템플릿이 비면 논리명을 그대로 낸다', () => {
    expect(composeL('')).toBe('주문')
  })

  it('변수 네 종을 해석한다', () => {
    expect(composeL('{그룹별칭}')).toBe('MBR')
    expect(composeL('{그룹명}')).toBe('회원관리')
    expect(composeL('{물리명}')).toBe('ORD')
    expect(composeL('{논리명}')).toBe('주문')
  })

  it('전체 조합', () => {
    expect(composeL('{그룹명}_{논리명}')).toBe('회원관리_주문')
  })

  it('알 수 없는 변수는 빈 값이고 접기도 같다', () => {
    expect(composeL('{그룹명}_{없는것}_{논리명}')).toBe('회원관리_주문')
  })

  it('접기 규칙을 물리명과 공유한다', () => {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, groupId: null }
    expect(composeTableLogicalName(m.tables['t2']!, m, withLogical('{그룹명}_이력'))).toBe('이력')
  })

  // ⚠️ 이 사이클의 계약. 변수는 **저장된 부분**을 돌려주지 조합 결과를 돌려주지 않는다 —
  // 그래서 재귀가 원리적으로 불가능하다(설계 D4).
  it('{물리명} 은 조합 물리명이 아니라 부분을 돌려준다', () => {
    const m = model()
    const rules: NamingRules = {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}',
      tableLogicalTemplate: '{물리명}',
    }
    expect(composeTablePhysicalName(m.tables['t2']!, m, rules)).toBe('TB_MBR_ORD')
    expect(composeTableLogicalName(m.tables['t2']!, m, rules)).toBe('ORD')   // TB_MBR_ORD 가 아니다
  })

  // ⚠️ 두 템플릿이 서로를 침범하지 않는지.
  it('두 템플릿이 동시에 걸려도 각자 자기 것을 쓴다', () => {
    const m = model()
    const rules: NamingRules = {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{물리명}',
      tableLogicalTemplate: '{그룹명}_{논리명}',
    }
    expect(composeTablePhysicalName(m.tables['t2']!, m, rules)).toBe('TB_ORD')
    expect(composeTableLogicalName(m.tables['t2']!, m, rules)).toBe('회원관리_주문')
  })
})
```

- [x] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts
```
기대: `composeTableLogicalName` 이 없어 TS 오류로 FAIL.

- [x] **Step 3: 구현하고 깨진 리터럴을 전부 고친다**

`naming.ts` 의 `NamingRules` 에 `tablePhysicalTemplate` 다음 줄로 더한다:

```ts
  /**
   * 테이블 논리명 조합 틀. 빈 문자열이면 조합하지 않고 logicalName 을 그대로 쓴다(기존 동작).
   * ⚠️ **산출물 전용이다** — 용어 사전 조회·미등록 단어 검사·물리명 재생성은 전부 부분(logicalName)을
   * 본다(설계 D1). 조합 이름으로 사전을 찾게 하면 사용자가 조합된 이름을 등록해야 하고, 재생성이
   * 그룹 약어를 물리명에 넣어 물리명 템플릿과 이중 적용된다.
   * 예: '{그룹명}_{논리명}'
   */
  tableLogicalTemplate: string
```

`DEFAULT_NAMING_RULES` 에 `tableLogicalTemplate: ''`,
`NamingRulesSchema` 에 `tableLogicalTemplate: z.string().default('')`,
`NamingRulesStrictSchema` 에 `tableLogicalTemplate: z.string()`.

⚠️ **strict 쪽을 빠뜨리면 조용한 데이터 손실이다** — `.default('')` 를 물려받으면 키를 안 보낸
`project.update` 가 설정해 둔 템플릿을 지운다. 직전 사이클이 같은 자리에서 실증으로 잠갔다.

`name-template.ts` — 공통 몸통을 뽑고 형제를 더한다. **Task 1 이 쓴 루프를 그대로 옮긴다.**

```ts
/** 조합 몸통. 템플릿이 비었는지는 **호출자가 판단한다** — 여기 오면 비어 있지 않다. */
function compose(template: string, table: Table, model: ProjectModel): string {
  const tokens = parseTemplate(template)
  const out: Piece[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.kind === 'lit') { out.push({ text: tok.text, lit: true }); continue }
    const value = resolveVar(tok.name, table, model)
    if (value !== '') { out.push({ text: value, lit: false }); continue }
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') {
      out.push({ text: next.text.replace(/^_+/, ''), lit: true })
      i += 1
      continue
    }
    trimTrailingSeparator(out)
  }
  return out.map((p) => p.text).join('')
}

export function composeTablePhysicalName(
  table: Table, model: ProjectModel, rules: NamingRules,
): string {
  if (rules.tablePhysicalTemplate === '') return table.physicalName
  return compose(rules.tablePhysicalTemplate, table, model)
}

/**
 * 테이블의 최종 논리명. **산출물 전용이다**(DDL 코멘트 · DBML note · Excel 논리명 열).
 *
 * ⚠️ 용어 사전·미등록 단어 검사·물리명 재생성은 이것을 쓰지 않는다 — 부분(`table.logicalName`)을
 * 본다(설계 D1). `warnings.ts` 가 이 함수를 부르면 D1 위반이다.
 *
 * ⚠️ 변수는 **저장된 부분**을 돌려준다 — `{물리명}` 은 `table.physicalName` 이지 조합 물리명이
 * 아니다. 그래서 재귀가 원리적으로 불가능하다.
 */
export function composeTableLogicalName(
  table: Table, model: ProjectModel, rules: NamingRules,
): string {
  if (rules.tableLogicalTemplate === '') return table.logicalName
  return compose(rules.tableLogicalTemplate, table, model)
}
```

`index.ts` 의 기존 재export 줄에 `composeTableLogicalName` 을 더한다.

**깨진 리터럴을 전부 고친다** — 목록을 뽑아 하나씩 `tableLogicalTemplate: ''` 를 더한다
(`...DEFAULT_NAMING_RULES` 스프레드 형태는 안 고쳐도 된다):
```bash
grep -rn "tablePhysicalTemplate:" packages apps --include='*.ts' --include='*.tsx' \
  | grep -v node_modules | grep -v tableLogicalTemplate
```
⚠️ **`naming.test.ts` 의 `NamingRulesSchema.parse(legacy)` 기대값도 고쳐야 한다** — 런타임 단언이라
typecheck 에 안 걸리는데 `.default('')` 때문에 깨진다(직전 사이클이 같은 자리에서 물렸다).

- [x] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/name-template.test.ts
pnpm -r typecheck; echo "EXIT=$?"
pnpm -C packages/core test && pnpm -C apps/web test && pnpm -C packages/cli test
```
기대: 신규 케이스 PASS, `EXIT=0`, **기존 스위트 전부 그대로**(아직 아무도 논리명 조합을 안 부른다).

- [x] **Step 5: 두 템플릿이 안 섞이는지 실증한다**

`composeTableLogicalName` 안의 `rules.tableLogicalTemplate` 두 자리를 **둘 다** `rules.tablePhysicalTemplate`
로 바꾼다.
```bash
git diff packages/core/src/name-template.ts        # 두 줄이 바뀐 것을 눈으로 본다
pnpm -C packages/core exec vitest run src/name-template.test.ts -t 'composeTableLogicalName'
```
기대: **FAIL** — 「두 템플릿이 동시에 걸려도 각자 자기 것을 쓴다」가 `회원관리_주문` 대신 `TB_ORD` 를
낸다. 되돌리고 초록을 확인한 뒤 **양쪽 결과를 보고에 적는다.**

- [x] **Step 6: 커밋**

```bash
git add packages/core/src/name-template.ts packages/core/src/name-template.test.ts \
        packages/core/src/naming.ts packages/core/src/index.ts && \
git commit -m "feat(core): 테이블 논리명 조합 엔진을 더한다

조합 몸통을 compose 로 뽑고 물리명·논리명 두 형제가 각자 템플릿만 골라 넘긴다.
기존 호출처 12곳은 하나도 안 바뀐다. 변수는 항상 저장된 부분을 돌려주므로 논리
템플릿이 {물리명} 을 참조해도 조합 결과를 다시 참조하지 않는다 — 재귀가 원리적으로
불가능하다. 쓰기 검증 스키마에는 기본값을 주입하지 않는다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
⚠️ 리터럴을 고친 다른 파일이 있으면 그 경로도 같은 커밋에 명시한다.

---

## Task 3: DDL 배선 (코멘트 2자리 + 경고 라벨)

**Files:**
- Modify: `packages/core/src/ddl.ts:111`(mysql 인라인) · `:135`(`warningLabel`) · `:199`(`COMMENT ON`)
- Test: `packages/core/src/ddl.test.ts`

**Interfaces:**
- Consumes: `composeTableLogicalName(table, model, rules)` (Task 2)

- [x] **Step 1: 실패 테스트를 쓴다**

`ddl.test.ts` 의 `describe('물리명 템플릿')` **아래에 새 describe** 로 추가한다. 그 파일에는
`generateDdlRaw`·`ddlWarningsRaw` 심이 이미 있다 — **새 심을 만들지 말고 그것을 쓴다.**

```ts
describe('논리명 템플릿', () => {
  const both = (physical: string, logical: string): NamingRules => ({
    ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: physical, tableLogicalTemplate: logical,
  })
  /** buildSampleModel: g1 에 t1(회원등급/MBR_GRD)·t2(회원/MBR). */
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    return x
  }

  it('COMMENT ON TABLE 이 조합된 논리명을 쓴다', () => {
    const sql = generateDdlRaw(m(), 'postgresql', { kind: 'all' }, both('', '{그룹명}_{논리명}'))
    expect(sql).toContain("COMMENT ON TABLE MBR IS 'SALES_회원'")
  })

  it('mysql 인라인 코멘트도 조합된 논리명을 쓴다', () => {
    const sql = generateDdlRaw(m(), 'mysql', { kind: 'all' }, both('', '{그룹명}_{논리명}'))
    expect(sql).toContain("COMMENT 'SALES_회원'")
  })

  // ⚠️ 설계 D5 의 갈리는 입력 그대로다. 논리명 == 물리명 == 'ORD' 이고 두 템플릿이 같은 결과를
  // 내면 「같으면 생략」이 성립해 코멘트가 아예 안 나가야 한다.
  it('생략 판정이 조합끼리 비교된다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    const rules = both('{그룹명}_{물리명}', '{그룹명}_{논리명}')
    const sql = generateDdlRaw(x, 'postgresql', { kind: 'all' }, rules)
    expect(sql).toContain('CREATE TABLE SALES_ORD')
    expect(sql).not.toContain('COMMENT ON TABLE SALES_ORD')      // 둘 다 SALES_ORD → 생략
  })

  it('논리명만 부분으로 두면 생략되지 않는다(대조군)', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    const rules = both('{그룹명}_{물리명}', '')                   // 논리 템플릿 없음 → 부분 'ORD'
    expect(generateDdlRaw(x, 'postgresql', { kind: 'all' }, rules))
      .toContain("COMMENT ON TABLE SALES_ORD IS 'ORD'")
  })

  // ⚠️ 물리명이 비어 조합 결과도 빌 때의 라벨 폴백(ddl.ts:135).
  it('경고 라벨 폴백이 조합된 논리명을 쓴다', () => {
    const x = m()
    x.tables['t3'] = {
      ...x.tables['t2']!, id: 't3', physicalName: '', logicalName: '이력',
    }
    const warns = ddlWarningsRaw(x, 'postgresql', { kind: 'all' }, both('', '{그룹명}_{논리명}'))
    expect(warns.some((w) => w.startsWith('SALES_이력:'))).toBe(true)
    expect(warns.some((w) => w.startsWith('이력:'))).toBe(false)
  })

  // ⚠️ 설계 3.3 — 조합 논리명이 비면 코멘트에 논리명을 안 넣는다(설명만 남거나 코멘트가 생략된다).
  // commentText 의 첫 인자가 빈 문자열일 때의 동작이고, 조합이 그 자리에 들어가면서 새로 닿는 경로다.
  it('조합 논리명이 비면 설명만 코멘트로 나간다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: '', comment: '서비스 가입 회원' }
    const sql = generateDdlRaw(x, 'postgresql', { kind: 'all' }, both('', '{논리명}'))
    expect(sql).toContain("COMMENT ON TABLE MBR IS '서비스 가입 회원'")
    expect(sql).not.toContain("IS ' - 서비스 가입 회원'")
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDdlRaw(m(), 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES))
      .toContain("COMMENT ON TABLE MBR IS '회원 - 서비스 가입 회원'")
  })
})
```

⚠️ 위 단언의 **정확한 문자열은 그 파일의 기존 케이스를 보고 맞춰라** — 인용 규칙(`quoteIdentifier` 는
예약어·불안전 문자일 때만 인용한다)과 `buildSampleModel` 의 코멘트 값(`t2.comment = '서비스 가입 회원'`)을
먼저 확인한다. `t3` 는 컬럼이 없어 「컬럼이 없어 내보내기에서 제외됨」 경고로 잡힐 수 있다 — 어느
경고 문구든 **라벨이 `SALES_이력` 이면 통과**하도록 `startsWith` 로 썼다.

- [x] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl.test.ts -t '논리명 템플릿'
```
기대: 조합 전 논리명(`회원`)이 나와 FAIL.

- [x] **Step 3: 구현한다**

세 자리를 바꾼다. 각 함수는 이미 `model`·`rules` 를 갖고 있다 — **새 인자를 뚫지 마라.**

| 행 | 함수 | 바꿀 것 |
|---|---|---|
| `:111` | `createTableBlock`(mysql) | `commentText(composeTableLogicalName(table, model, rules), tableName, table.comment)` |
| `:199` | `commentStatements` | 같은 형태 |
| `:135` | `warningLabel` | `return name.trim() === '' ? (composeTableLogicalName(t, model, rules) \|\| t.id) : name` |

각 자리의 기존 주석(`// 「논리명==물리명이면 생략」 판정은 최종 이름과 비교해야 한다.`)을
**「양쪽 다 최종 이름이다(설계 D5)」**로 갱신한다.

- [x] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/ddl.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
⚠️ **기존 DDL 테스트가 깨지면 안 된다** — 전부 논리 템플릿이 없어 조합 == 부분이다.

- [x] **Step 5: 생략 판정이 진짜 잠기는지 실증한다**

`ddl.ts:199` 의 첫 인자를 `table.logicalName`(부분)으로 되돌린다.
```bash
git diff packages/core/src/ddl.ts
pnpm -C packages/core exec vitest run src/ddl.test.ts -t '생략 판정이 조합끼리'
```
기대: **FAIL** — 생략돼야 할 `COMMENT ON TABLE SALES_ORD` 가 나온다. 되돌리고 초록을 확인한 뒤
**양쪽 결과를 보고에 적는다.**

- [x] **Step 6: 커밋**

```bash
git add packages/core/src/ddl.ts packages/core/src/ddl.test.ts && \
git commit -m "feat(core): DDL 코멘트가 조합된 논리명을 쓴다

mysql 인라인·COMMENT ON 두 자리와 경고 라벨 폴백이 조합 논리명을 본다. 「논리명==
물리명이면 생략」 판정은 이제 양쪽 다 조합 이름으로 비교한다 — 한쪽만 조합이면
최종 산출물에서 같은 이름인데도 코멘트가 한 번 더 나간다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: DBML · Excel 배선과 「경고 무변경」 잠그기

**Files:**
- Modify: `packages/core/src/dbml.ts:129-131` · `packages/core/src/excel-sheets.ts:127,138`
- Test: `packages/core/src/dbml.test.ts` · `packages/core/src/excel-sheets.test.ts` · `packages/core/src/warnings.test.ts`

**Interfaces:**
- Consumes: `composeTableLogicalName(table, model, rules)` (Task 2)

⚠️ **`warnings.ts` 는 한 줄도 고치지 않는다.** 이 태스크가 추가하는 warnings 테스트는 **안 바뀌는
것을 잠그는** 회귀 방어다(설계 D1).

- [x] **Step 1: 실패 테스트를 쓴다 (DBML)**

`dbml.test.ts` 의 `describe('물리명 템플릿')` 아래에 추가한다. 그 파일에는 `generateDbmlRaw` 심이
이미 있다.

```ts
describe('논리명 템플릿', () => {
  const both = (physical: string, logical: string): NamingRules => ({
    ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: physical, tableLogicalTemplate: logical,
  })
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    return x
  }

  it('note 의 논리명이 조합된다', () => {
    const out = generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, both('', '{그룹명}_{논리명}'))
    expect(out).toContain("note: 'SALES_회원 - 서비스 가입 회원'")
  })

  // ⚠️ 생략 판정도 조합끼리다(설계 D5) — DDL 과 같은 성질이 note 에도 있다.
  it('note 생략 판정이 조합끼리 비교된다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    const out = generateDbmlRaw(
      x, 'postgresql', { kind: 'all' }, {}, both('{그룹명}_{물리명}', '{그룹명}_{논리명}'))
    expect(out).toContain('Table "SALES_ORD"')
    expect(out).not.toContain("note: 'SALES_ORD'")
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES))
      .toContain("note: '회원 - 서비스 가입 회원'")
  })
})
```
⚠️ note 문자열 형식(`'논리명 - 설명'`)은 `dbml-note.ts` 의 `buildDbmlNote` 를 먼저 읽고 맞춰라.

- [x] **Step 2: 실패 테스트를 쓴다 (Excel)**

`excel-sheets.test.ts` 의 `describe('물리명 템플릿')` 아래에 추가한다. `buildExcelSheetsRaw` 심이
이미 있다.

```ts
describe('논리명 템플릿', () => {
  const RULES: NamingRules = {
    ...DEFAULT_NAMING_RULES, tableLogicalTemplate: '{그룹명}_{논리명}',
  }
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    return x
  }

  it('테이블 목록 시트의 논리명 열이 조합된다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: RULES }), 'tableList')!
    const names = s.rows.map((r) => r[1])          // [그룹, 논리명, 물리명, 설명, …]
    expect(names).toContain('SALES_회원')
    expect(names).not.toContain('회원')
  })

  it('테이블정의서 시트의 「테이블 논리명」 열도 조합된다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: RULES }), 'tableSpec')!
    const names = new Set(s.rows.map((r) => r[1]))
    expect(names.has('SALES_회원')).toBe(true)
    expect(names.has('회원')).toBe(false)
  })

  // ⚠️ 단어사전·용어사전 시트의 logicalName 은 Word·Term 이다. 건드리면 안 된다.
  it('용어사전 시트의 논리명은 조합되지 않는다', () => {
    const x = m()
    x.terms['tm1'] = {
      id: 'tm1', logicalName: '주문', physicalName: 'ORD',
      domainId: null, description: null, origin: null,
    }
    const s = sheetOf(buildExcelSheetsRaw(x, { rules: RULES }), 'terms')!
    expect(s.rows.map((r) => r[0])).toContain('주문')
  })

  it('템플릿이 없으면 지금과 같다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: DEFAULT_NAMING_RULES }), 'tableList')!
    expect(s.rows.map((r) => r[1])).toContain('회원')
  })
})
```
⚠️ 열 인덱스 `1`(논리명)과 용어사전 시트의 열 순서는 `TABLE_LIST_HEADERS` 와 그 파일의 기존 케이스를
보고 맞춰라.

- [x] **Step 3: 실패 테스트를 쓴다 (경고 무변경)**

`warnings.test.ts` 의 `describe('물리명 템플릿과 경고')` 아래에 추가한다.

```ts
// ⚠️ 설계 D1 을 잠근다 — 논리명 조합은 **산출물 전용**이다. 사전·검사는 부분을 본다.
// 이 케이스들은 「무언가를 바꾼다」가 아니라 「아무것도 안 바뀐다」를 지킨다.
describe('논리명 템플릿과 경고', () => {
  const withLogical: NamingRules = {
    ...DEFAULT_NAMING_RULES, tableLogicalTemplate: '{그룹명}_{논리명}',
  }
  function m(): ProjectModel {
    const x = createEmptyModel()
    x.tableGroups['g1'] = { id: 'g1', name: '회원관리', color: '#eee', comment: null, alias: 'MBR' }
    x.tables['t1'] = tbl('t1', { groupId: 'g1', logicalName: '주문', physicalName: 'ORD' })
    return x
  }

  it('용어 검사가 부분 논리명을 본다', () => {
    const x = m()
    x.terms['tm1'] = term('tm1', '주문', 'ORD')     // 부분과 정확히 일치 → 불일치 경고가 없어야 한다
    expect(computeWarnings(x, withLogical).filter((w) => w.kind === 'term-mismatch')).toEqual([])
  })

  it('미등록 단어 검사가 부분 논리명을 본다', () => {
    const x = m()
    x.words['w1'] = word('w1', '주문', 'ORD')       // 부분은 전부 등록됨
    const kinds = computeWarnings(x, withLogical).map((w) => w.kind)
    expect(kinds).not.toContain('unknown-word')     // 조합('회원관리_주문')을 봤다면 '회원관리'가 미등록이다
  })

  it('논리 구분자 경고가 부분 논리명을 본다', () => {
    const x = m()
    x.words['w1'] = word('w1', '주문', 'ORD')
    const kinds = computeWarnings(x, withLogical).map((w) => w.kind)
    expect(kinds).not.toContain('missing-logical-separator')  // 부분은 단어 하나라 경고 없음
  })

  it('논리 템플릿을 걸어도 경고 목록이 통째로 같다', () => {
    const x = m()
    x.words['w1'] = word('w1', '주문', 'ORD')
    expect(computeWarnings(x, withLogical)).toEqual(computeWarnings(x, DEFAULT_NAMING_RULES))
  })
})
```
⚠️ `tbl`·`word`·`term` 은 그 파일 상단의 기존 헬퍼다. `computeWarnings` 의 반환에 순서 의존이 있으면
마지막 케이스가 흔들릴 수 있다 — 그러면 `.map((w) => w.kind).sort()` 비교로 낮춰라.

- [x] **Step 4: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/dbml.test.ts src/excel-sheets.test.ts src/warnings.test.ts
```
기대: DBML·Excel 케이스가 조합 전 논리명(`회원`)으로 FAIL. **warnings 케이스 4건은 이미 통과한다** —
`warnings.ts` 가 논리 템플릿을 아예 모르기 때문이다. **그 사실을 보고에 적어라**(빨강을 못 본 테스트이고,
Step 6 이 그 대신 구분력을 실증한다).

- [x] **Step 5: 구현한다**

`dbml.ts:130` — `buildDbmlNote` 의 첫 인자를 조합 논리명으로:
```ts
  const note = buildDbmlNote(
    composeTableLogicalName(table, model, rules), tableName, table.comment,
    customOf(model, table, 'table'),
  )
```
⚠️ `tableBlock` 이 `rules` 를 받는지 확인하고, 안 받으면 `generateDbml` 에서 넘긴다(`tableName` 을
이미 조합해 넘기고 있으므로 `rules` 도 그 경로에 있다).

`excel-sheets.ts:127`·`:138` — `t.logicalName` 을 `composeTableLogicalName(t, model, rules)` 로.
⚠️ **`:156-166` 은 손대지 마라**(단어·용어 사전 시트).

`warnings.ts` **는 고치지 않는다.**

- [x] **Step 6: 통과를 확인하고 D1 의 구분력을 실증한다**

```bash
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```

warnings 케이스가 「빨강을 못 본」 테스트이므로 **일부러 D1 을 위반해 빨개지는지 본다.**
`warnings.ts` 의 테이블 루프에서 `checkNamingEntity('table', …, t.logicalName, …)` 의 `t.logicalName` 을
`composeTableLogicalName(t, model, rules)` 로 바꾼다(import 추가 필요).
```bash
git diff packages/core/src/warnings.ts             # 바뀐 줄을 눈으로 본다
pnpm -C packages/core exec vitest run src/warnings.test.ts -t '논리명 템플릿과 경고'
```
기대: **FAIL** — 「미등록 단어 검사가 부분 논리명을 본다」가 `회원관리` 를 미등록으로 잡고,
「통째로 같다」도 갈린다. 되돌리고 초록을 확인한 뒤 **양쪽 결과를 보고에 적는다.**

- [x] **Step 7: 커밋**

```bash
git add packages/core/src/dbml.ts packages/core/src/dbml.test.ts \
        packages/core/src/excel-sheets.ts packages/core/src/excel-sheets.test.ts \
        packages/core/src/warnings.test.ts && \
git commit -m "feat(core): DBML note 와 Excel 논리명 열이 조합된 논리명을 쓴다

논리명 조합은 산출물 전용이라 warnings.ts 는 한 줄도 안 바꾼다 — 대신 「논리 템플릿을
걸어도 경고가 통째로 같다」를 테스트로 잠근다. 사전·검사가 조합 이름을 보게 되면
사용자가 조합된 이름을 사전에 등록해야 한다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: 서버 확인과 CLI 설정

**Files:**
- Test: `apps/server/src/routers/project.test.ts`(`tablePhysicalTemplate` 케이스 4건 아래)
- Modify: `packages/cli/src/config.ts:66-74` · `packages/cli/src/config.test.ts`

서버 코드는 **고칠 것이 없다** — `project.ts` 가 이미 `NamingRulesSchema.parse`(읽기)와
`NamingRulesStrictSchema`(쓰기)를 태운다. Task 2 가 두 스키마를 다르게 고쳤으므로 **동작 확인만** 한다.

- [x] **Step 1: 서버 실패 테스트를 쓴다**

`project.test.ts` 의 기존 `tablePhysicalTemplate` 케이스 바로 아래에 같은 형태로 추가한다.
**그 케이스들의 `db.update(...).set({ namingRules })` 패턴을 그대로 따른다.**

```ts
  it('tableLogicalTemplate 키가 없는 기존 행에 빈 문자열을 주입해 내려준다', async () => {
    await db.update(projects)
      .set({ namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{물리명}',
      } })
      .where(eq(projects.id, projectId))
    const got = await caller.project.get({ projectId })
    expect(got.namingRules.tableLogicalTemplate).toBe('')
    expect(got.namingRules.tablePhysicalTemplate).toBe('TB_{물리명}')
  })

  // ⚠️ 급소. strict 스키마가 .default('') 를 물려받으면 키를 안 보낸 클라이언트가 설정해 둔
  // 논리 템플릿을 조용히 지운다.
  it('tableLogicalTemplate 이 빠진 namingRules 는 update 가 거절하고 설정값을 지킨다', async () => {
    await caller.project.update({
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '{그룹명}_{논리명}',
      },
    })
    await expect(caller.project.update({
      projectId,
      // @ts-expect-error tableLogicalTemplate 을 일부러 뺀 옛 클라이언트 페이로드
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: '',
      },
    })).rejects.toThrow()
    const got = await caller.project.get({ projectId })
    expect(got.namingRules.tableLogicalTemplate).toBe('{그룹명}_{논리명}')
  })

  it('update 로 논리 템플릿을 바꿀 수 있다', async () => {
    await caller.project.update({
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '{그룹별칭}_{논리명}',
      },
    })
    expect((await caller.project.get({ projectId })).namingRules.tableLogicalTemplate)
      .toBe('{그룹별칭}_{논리명}')
  })
```
⚠️ `db`·`caller`·`projectId`·`projects`·`eq` 는 그 파일이 이미 쓰는 것들이다. **기존 케이스를 먼저 읽어라.**

- [x] **Step 2: CLI 실패 테스트를 쓴다**

`config.test.ts` — 물리명 템플릿과 **같은 정책**이다(임의 문자열이라 「잘못 적은 값」이 없다).
파일 상단 `CONFIG` 상수의 `namingRules` 에 `tableLogicalTemplate: ''` 를 더한다(Task 2 의 grep 에 이미
잡혔을 수 있다).

```ts
  it('tableLogicalTemplate 이 없는 옛 config 에 빈 문자열을 채운다', async () => {
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
      '  tablePhysicalTemplate: "TB_{물리명}"',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    const cfg = await readConfig(dir)
    expect(cfg.namingRules.tableLogicalTemplate).toBe('')
    expect(cfg.namingRules.tablePhysicalTemplate).toBe('TB_{물리명}')
  })

  it('적어 둔 논리 템플릿은 그대로 읽는다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: { ...CONFIG.namingRules, tableLogicalTemplate: '{그룹명}_{논리명}' },
    })
    expect((await readConfig(dir)).namingRules.tableLogicalTemplate).toBe('{그룹명}_{논리명}')
  })
```

- [x] **Step 3: 실패를 확인한다**

```bash
pnpm -C packages/cli exec vitest run src/config.test.ts
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_d' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts
```
기대: CLI 는 `undefined` 라 FAIL. **서버는 Task 2 의 스키마가 맞으면 이미 통과할 수 있다** — 통과하면
그것이 「서버는 확인만」의 확인이다. **통과했다는 사실을 보고에 적어라.**
🔥 `. ./.env` 로 돌리지 마라.

- [x] **Step 4: 구현한다**

`config.ts` 의 반환부를 고친다. 물리명 템플릿 바로 아래에 같은 형태로 붙인다:
```ts
  const tpl = namingRules['tablePhysicalTemplate']
  const tablePhysicalTemplate = typeof tpl === 'string' ? tpl : ''
  const ltpl = namingRules['tableLogicalTemplate']
  const tableLogicalTemplate = typeof ltpl === 'string' ? ltpl : ''
  return {
    serverUrl, projectId, dialects,
    namingRules: {
      ...(namingRules as unknown as NamingRules),
      logicalSeparator, tablePhysicalTemplate, tableLogicalTemplate,
    },
  }
```

- [x] **Step 5: 통과를 확인하고 strict 스키마를 실증한다**

```bash
pnpm -C packages/cli test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_d' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts
```

`naming.ts` 의 `NamingRulesStrictSchema` 에서 `tableLogicalTemplate: z.string()` 줄을 **지운다.**
```bash
git diff packages/core/src/naming.ts               # 그 줄이 사라진 것을 눈으로 본다
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_d' \
  pnpm --filter @erdd/server exec vitest run src/routers/project.test.ts -t '거절하고 설정값을 지킨다'
```
기대: **FAIL** — 키를 뺀 update 가 통과해 논리 템플릿이 `''` 로 덮인다. 되돌리고 초록을 확인한 뒤
**양쪽 결과를 보고에 적는다.**

- [x] **Step 6: 커밋**

```bash
git add apps/server/src/routers/project.test.ts packages/cli/src/config.ts \
        packages/cli/src/config.test.ts && \
git commit -m "feat(cli): 논리 템플릿 키를 config 에서 읽고 서버 동작을 테스트로 못 박는다

서버는 이미 두 스키마를 태우고 있어 코드 변경이 없다. 옛 행에 '' 가 주입되는 것과
키를 뺀 update 가 거절되는 것을 테스트로 고정한다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: web — 두 번째 입력란과 미리보기 두 줄

**Files:**
- Modify: `apps/web/src/pages/project-settings.tsx:111-200` · `apps/web/src/pages/project-settings.test.tsx`
- Modify: `apps/web/src/editor/edit-panel.tsx:111-116` · `apps/web/src/editor/edit-panel.test.tsx:656-693`

**Interfaces:**
- Consumes: `composeTableLogicalName(table, model, rules)` (Task 2)

⚠️ **`NamePair` 에 prop 을 뚫지 마라.** 컬럼과 공유하는 컴포넌트이고 컬럼에는 템플릿이 없다.
미리보기 두 줄을 `NamePair` **바깥**(지금 물리명 미리보기가 있는 자리)에 라벨과 함께 둔다.

- [x] **Step 1: 편집 패널 테스트를 고치고 더한다**

`edit-panel.test.tsx:656-693` 의 기존 3건은 문구 변경으로 **함께 바뀐다.**

```ts
  // :674 — '→ TB_MBR_MBR' 를 '물리 → TB_MBR_MBR' 로
  expect(await screen.findByText('물리 → TB_MBR_MBR')).toBeInTheDocument()

  // :682 — /^→ / 를 /^(물리|논리) → / 로
  expect(screen.queryByText(/^(물리|논리) → /)).not.toBeInTheDocument()

  // :692 — getAllByText(/^→ /) 를 같은 정규식으로
  expect(screen.getAllByText(/^(물리|논리) → /)).toHaveLength(1)
```

새 케이스를 같은 describe 에 더한다:

```ts
  it('논리 템플릿이 있으면 조합된 논리명을 보여 준다', async () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    renderPanel(m, { ...DEFAULT_NAMING_RULES, tableLogicalTemplate: '{그룹명}_{논리명}' })
    act(() => { useEditorStore.getState().selectTables(['t2']) })
    expect(await screen.findByText('논리 → SALES_회원')).toBeInTheDocument()
  })

  it('두 템플릿이 다 있으면 두 줄이 다 뜬다', async () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    renderPanel(m, {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}',
      tableLogicalTemplate: '{그룹명}_{논리명}',
    })
    act(() => { useEditorStore.getState().selectTables(['t2']) })
    expect(await screen.findByText('물리 → TB_MBR_MBR')).toBeInTheDocument()
    expect(screen.getByText('논리 → SALES_회원')).toBeInTheDocument()
  })

  it('물리 템플릿만 있으면 논리 줄은 없다', async () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    renderPanel(m, { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    act(() => { useEditorStore.getState().selectTables(['t2']) })
    await screen.findByText('물리 → TB_MBR_MBR')
    expect(screen.queryByText(/^논리 → /)).not.toBeInTheDocument()
  })
```
⚠️ `renderPanel` 은 그 파일의 실제 헬퍼 이름·시그니처에 맞춰라(먼저 읽는다).

- [x] **Step 2: 설정 화면 테스트를 더한다**

`project-settings.test.tsx` — `projectFixture` 에 `tableLogicalTemplate` 를 받는 필드를 더한다
(`over.tableLogicalTemplate ?? ''`). 기존 `MODEL_FIXTURE` 를 그대로 쓴다.

```ts
describe('ProjectSettingsPage — 테이블 논리명 형식', () => {
  it('현재 논리 템플릿을 입력란에 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tableLogicalTemplate: '{그룹명}_{논리명}' }) }),
      'model.get': () => ({ data: { model: MODEL_FIXTURE, seq: 1 } }),
    })
    expect(await screen.findByLabelText(/테이블 논리명 형식/)).toHaveValue('{그룹명}_{논리명}')
  })

  it('입력하고 포커스를 빼면 update 로 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture() }),
      'model.get': () => ({ data: { model: MODEL_FIXTURE, seq: 1 } }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    const input = await screen.findByLabelText(/테이블 논리명 형식/)
    await userEvent.type(input, '{{그룹명}_{{논리명}')     // userEvent 에서 '{' 는 '{{' 로 이스케이프
    await userEvent.tab()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.tableLogicalTemplate).toBe('{그룹명}_{논리명}')
    // 물리 템플릿은 그대로 실려 나간다(객체 통째다)
    expect(calls[0]!.namingRules.tablePhysicalTemplate).toBe('')
  })

  it('논리 미리보기가 현재 모델의 테이블로 나온다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tableLogicalTemplate: '{그룹명}_{논리명}' }) }),
      'model.get': () => ({ data: { model: MODEL_FIXTURE, seq: 1 } }),
    })
    // MODEL_FIXTURE 의 첫 테이블은 그룹 '회원관리' 소속 논리명 '주문' 이다(기존 픽스처).
    expect(await screen.findByText('회원관리_주문')).toBeInTheDocument()
  })

  it('두 미리보기가 서로를 침범하지 않는다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({
        tablePhysicalTemplate: 'TB_{물리명}', tableLogicalTemplate: '{그룹명}_{논리명}',
      }) }),
      'model.get': () => ({ data: { model: MODEL_FIXTURE, seq: 1 } }),
    })
    expect(await screen.findByText('TB_ITEM')).toBeInTheDocument()      // 물리 미리보기
    expect(screen.getByText('회원관리_주문')).toBeInTheDocument()        // 논리 미리보기
  })

  it('관리 권한이 없으면 논리 입력란도 없다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }) }),
      'model.get': () => ({ data: { model: MODEL_FIXTURE, seq: 1 } }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByLabelText(/테이블 논리명 형식/)).not.toBeInTheDocument()
  })
})
```
⚠️ `MODEL_FIXTURE` 의 실제 그룹명·논리명·물리명(`PRD`/`ITEM` 으로 바꿔 둔 값)을 **먼저 읽고** 위
기대값을 맞춰라. `model.get` 이 `{ model, seq }` 로 감싸 돌려주는 것도 기존 픽스처를 따른 것이다.

- [x] **Step 3: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/pages/project-settings.test.tsx src/editor/edit-panel.test.tsx
```
기대: 논리 입력란·논리 미리보기가 없어 FAIL. 문구를 바꾼 기존 3건도 FAIL(아직 `→ ` 접두다).

- [x] **Step 4: 구현한다**

`project-settings.tsx` — `TemplatePreview` 에 `kind` 를 받는다:

```tsx
function TemplatePreview({ kind, template, model }: {
  kind: 'physical' | 'logical'; template: string; model: ProjectModel | undefined
}) {
  if (template === '') return null
  const table = model === undefined ? undefined : Object.values(model.tables)[0]
  const sample: ProjectModel = table !== undefined && model !== undefined ? model : {
    ...createEmptyModel(),
    tableGroups: { g: { id: 'g', name: '회원관리', color: '#eeeeee', comment: null, alias: 'MBR' } },
    tables: { t: {
      id: 't', logicalName: '주문', physicalName: 'ORD', comment: null, groupId: 'g',
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    } },
  }
  const target = table ?? sample.tables['t']!
  // ⚠️ DEFAULT_NAMING_RULES 는 폴백이 아니라 「미리보기는 템플릿만 본다」는 뜻이다 —
  // 조합은 case·separator·maxLengthBytes 를 쓰지 않는다.
  const composed = kind === 'physical'
    ? composeTablePhysicalName(target, sample, { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: template })
    : composeTableLogicalName(target, sample, { ...DEFAULT_NAMING_RULES, tableLogicalTemplate: template })
  return (
    <p className="text-xs text-muted-foreground">
      미리보기: <span className="font-mono text-foreground">{composed}</span>
    </p>
  )
}
```

`NamingRulesSection` — draft 를 둘로 늘린다. **`projectId` 를 deps 에 함께 넣는 것**을 잊지 마라
(그룹 별칭 사이클에서 값만 넣었다가 「같은 값을 가진 다른 대상」으로 옮길 때 draft 가 남는 버그를 만들었다):

```tsx
  const [template, setTemplate] = useState(namingRules.tablePhysicalTemplate)
  const [logicalTemplate, setLogicalTemplate] = useState(namingRules.tableLogicalTemplate)
  useEffect(() => { setTemplate(namingRules.tablePhysicalTemplate) },
    [projectId, namingRules.tablePhysicalTemplate])
  useEffect(() => { setLogicalTemplate(namingRules.tableLogicalTemplate) },
    [projectId, namingRules.tableLogicalTemplate])
```

물리명 입력란 블록 아래에 같은 모양의 블록을 하나 더 둔다:

```tsx
      <div className="grid gap-1">
        <Label htmlFor="ltpl" className="text-xs">테이블 논리명 형식</Label>
        <input
          id="ltpl" className="h-9 rounded-md border bg-background px-2 font-mono text-sm"
          value={logicalTemplate} disabled={update.isPending}
          onChange={(e) => setLogicalTemplate(e.target.value)}
          onBlur={() => {
            if (logicalTemplate === namingRules.tableLogicalTemplate) return
            update.mutate({
              projectId, namingRules: { ...namingRules, tableLogicalTemplate: logicalTemplate },
            })
          }}
        />
        <p className="text-xs text-muted-foreground">
          비우면 입력한 논리명을 그대로 씁니다. 산출물(DDL 코멘트·DBML·Excel)에만 쓰이고
          용어 사전·단어 검사·물리명 재생성은 입력한 논리명을 그대로 봅니다.
        </p>
        <TemplatePreview kind="logical" template={logicalTemplate} model={model.data?.model} />
      </div>
```
기존 물리명 블록의 `<TemplatePreview …>` 에 `kind="physical"` 를 더한다.

`edit-panel.tsx:111-116` — 두 줄로 바꾼다:

```tsx
        {/* ⚠️ NamePair **밖**에 둔다 — NamePair 는 컬럼과 공유하는데 컬럼에는 템플릿이 없다.
            두 줄이 나란히 서므로 라벨로 구분한다(슬롯 prop 을 뚫는 것보다 싸다). */}
        {namingRules.tablePhysicalTemplate !== '' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-mono">물리 → {composeTablePhysicalName(table, model, namingRules)}</span>
          </p>
        )}
        {namingRules.tableLogicalTemplate !== '' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-mono">논리 → {composeTableLogicalName(table, model, namingRules)}</span>
          </p>
        )}
```
`@erdd/core` import 에 `composeTableLogicalName` 을 더한다.

- [x] **Step 5: 통과를 확인한다**

```bash
pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```

- [x] **Step 6: 논리 줄 가드가 잠기는지 실증한다**

`edit-panel.tsx` 의 `namingRules.tableLogicalTemplate !== ''` 가드를 지운다(항상 렌더).
```bash
git diff apps/web/src/editor/edit-panel.tsx
pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx -t '물리 템플릿만 있으면'
```
기대: **FAIL** — 논리 줄이 떠서 `queryByText(/^논리 → /)` 가 잡힌다. 되돌리고 초록을 확인한 뒤
**양쪽 결과를 보고에 적는다.**

- [x] **Step 7: 커밋**

```bash
git add apps/web/src/pages/project-settings.tsx apps/web/src/pages/project-settings.test.tsx \
        apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 설정에 논리명 형식 입력란을, 편집 패널에 미리보기 두 줄을 넣는다

미리보기가 둘이 되어 어느 줄이 어느 이름인지 구분되지 않으므로 「물리 →」·「논리 →」
라벨을 붙인다. NamePair 에 슬롯 prop 을 뚫어 칸 바로 아래에 붙이는 대신 이 방법을
골랐다 — NamePair 는 컬럼과 공유하는데 컬럼에는 템플릿이 없다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 7: 문서와 최종 검증

**Files:**
- Modify: `docs/13-naming.md` · `docs/manual/user-guide.md` · `docs/superpowers/HANDOFF.md`

- [x] **Step 1: 문서를 쓴다**

`docs/13-naming.md`:
- **접기 규칙 표를 교체한다.** ⚠️ 지금 표의 마지막 두 줄(`TB_{그룹별칭}_LOG` → `TB_` ⚠️,
  `{그룹별칭}_LOG_{물리명}` → `ORD` ⚠️)이 **옛 동작**이다. 새 값(`TB_LOG`·`LOG_ORD`)으로 고치고
  ⚠️ 표시를 뗀다.
- 그 아래 「지우는 단위는 리터럴 토큰 하나이지 구분자 한 글자가 아니다」 문단과 「변수 앞에 두어라」
  해법 안내를 **통째로 교체한다** — 이제 밑줄만 지운다. 대신 **하이픈 등 밑줄이 아닌 구분자는 남는다**
  (`TB_{그룹별칭}-LOG` → `TB_-LOG`)를 경계로 적고, 이유(논리명 템플릿 리터럴이 한글이라 「글자·숫자가
  아닌 문자」로 넓히면 한글을 먹는다)를 함께 적는다.
- **「테이블 논리명 형식」 절을 새로 쓴다** — 변수 다섯, 접기 규칙 공유, **산출물 전용이라는 것**
  (용어·단어·재생성은 부분 기준), `{물리명}` 이 조합 물리명이 아니라 부분이라는 것.

`docs/manual/user-guide.md`:
- 설정의 두 입력란과 편집 패널 미리보기 두 줄
- ⚠️ **접기 규칙이 바뀌었다는 안내** — 「`TB_{그룹별칭}_LOG` 처럼 변수 뒤에 낱말이 붙은 형식을 쓰고
  있었다면 결과가 `TB_` 에서 `TB_LOG` 로 달라집니다」
- ⚠️ **왕복 주의를 논리명으로 확장** — 내보낸 DDL 을 되읽으면 코멘트의 조합 논리명이 통째로 논리명에 박힌다

`docs/superpowers/HANDOFF.md`:
- 머리말의 **최종 갱신 · main HEAD · 마이그레이션** 갱신
- 완료 표에 이 사이클 추가
- 테스트 기준선을 **실측값**으로 갱신
- 3절 불변식에 추가:
  > **테이블 최종 논리명은 `composeTableLogicalName` 한 곳에서 나온다.** 단, **산출물 전용이다** —
  > `warnings.ts` 나 `generatePhysicalName` 경로에서 이 함수를 부르면 설계 D1 위반이다. 사전·검사·
  > 재생성은 `table.logicalName`(부분)을 본다.
- 6절 이월 갱신 — **해소된 것 둘을 지운다**(논리명 템플릿, 접기 규칙 재검토). 남는 것: 역분해
  메타정보(설계 6절의 결정 셋을 옮긴다) · 컬럼 템플릿 · CLI 비대칭 · `project-settings.tsx` 가드 미잠금.
- 6절에 **이번 사이클이 새로 남기는 미잠금 둘**을 적는다:
  > - **설계 D3 의 「사이드바 트리·캔버스는 부분을 유지한다」는 테스트로 잠기지 않는다.** 그 경로의
  >   코드를 한 줄도 안 건드렸으므로 잠글 대상이 없다 — 누군가 나중에 `table-tree.tsx` 에서
  >   `composeTableLogicalName` 을 부르면 조용히 D3 이 깨진다. 브라우저 스모크 7번이 유일한 방어다.
  > - **접기 규칙 변경이 기존 프로젝트의 산출물을 바꾼다.** `TB_{그룹별칭}_LOG` 형식을 쓰던
  >   프로젝트는 별칭이 빈 테이블의 이름이 `TB_` 에서 `TB_LOG` 로 달라진다. 사실상 버그 수정이지만
  >   **이미 내보낸 DDL 과 새로 내보낸 DDL 이 갈린다.** 사용자 매뉴얼에 안내를 적었다.

- [x] **Step 2: 최종 검증**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -C apps/web test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_d' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
🔥 `. ./.env` 금지. 서버가 `20 passed | 174 skipped` 면 미실행이다.
각 스위트의 **실측 통과 수를 보고에 적는다**(기준선 `core 740 · cli 143 · web 926 · server 206` 대비 증가분).

- [x] **Step 3: 커밋**

```bash
git add docs/13-naming.md docs/manual/user-guide.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 논리명 템플릿과 바뀐 접기 규칙을 문서에 넣는다

접기 규칙 표의 마지막 두 줄이 옛 동작이라 새 값으로 교체하고, 「리터럴 토큰 하나를
지운다」 문단을 「밑줄만 지운다」로 바꿨다. 논리명 템플릿이 산출물 전용이라는 것과
그 근거를 불변식에 더한다.

Co-Authored-By: Claude <Claude Opus 5 (1M context)> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 사용자·컨트롤러가 돈다)

⚠️ 확장이 하나뿐이라 이것만 직접 돈다(`CLAUDE.md` 의 예외).

1. 설정에 논리명 형식 `{그룹명}_{논리명}` 을 넣고 미리보기가 맞는지. 물리 미리보기와 **둘 다** 뜨는지.
2. 편집 패널에서 `물리 → …` · `논리 → …` 두 줄이 뜨는지, **컬럼에는 안 뜨는지**.
3. 논리 템플릿만 지우면 논리 줄만 사라지는지(물리 줄은 남는다).
4. DDL 내보내기 — `COMMENT ON TABLE` 이 조합 논리명인지.
5. ⚠️ **접기 규칙 변경 확인** — 템플릿을 `TB_{그룹별칭}_LOG` 로 두고 **그룹 없는 테이블**이 `TB_` 가
   아니라 `TB_LOG` 로 나오는지. 이 사이클이 고친 바로 그 자리다.
6. Excel 내보내기의 논리명 열이 조합인지.
7. **사이드바 트리·캔버스는 부분(`회원`) 그대로인지**(설계 D3 의 경계).
8. 논리명이 조합되어도 **용어·미등록 단어 경고가 그대로인지**(설계 D1) — 사전에 부분만 등록된
   테이블에서 미등록 경고가 새로 생기면 D1 위반이다.
