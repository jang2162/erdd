# 명명 입력 UI 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 패널의 테이블·컬럼 명명 입력을 세로 배치 + 필드 내 재생성 버튼 + 자동완성 + 미등록 단어 인라인 등록으로 바꾸고, 사전 화면의 미등록 항목을 방향별 하위 탭으로 가른다.

**Architecture:** 논리·물리명 쌍을 한 컨테이너(`NamePair`)가 제어 인풋 두 개의 draft로 함께 쥔다. 버튼에 `onMouseDown` `preventDefault`를 걸어 blur를 발생시키지 않으므로 "치고 바로 버튼"이 방금 친 값으로 동작하고, 두 필드 변경이 mutation 한 건으로 나간다. 자동완성 후보 산출만 core 순수 함수로 내려가고(분해 규칙을 `generatePhysicalName`과 공유해야 하므로) 나머지는 전부 `apps/web`이다.

**Tech Stack:** React 19 · TypeScript · zustand(`useEditorStore`) · vitest + @testing-library/react + userEvent · sonner(toast) · shadcn/ui(`Input`/`Button`/`Label`)

**설계 문서:** `docs/superpowers/specs/2026-08-14-naming-input-ux-design.md` — 결정의 근거는 그쪽에 있다. 이 계획서는 "무엇을 어떤 순서로 친다"만 담는다.

## Global Constraints

- **서버 변경 없음 · 마이그레이션 없음 · CLI 변경 없음.** 변경 파일이 `packages/core/src/naming.ts`(+테스트)와 `apps/web/src/**` 밖으로 나가면 범위를 넘은 것이다.
- **응답·커밋 메시지·주석·문서는 한국어로 쓴다.**
- **커밋은 경로를 명시한다.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...`로 한 명령에 붙인다(스테이징과 커밋 사이에 다른 일을 하지 않는다).
- 커밋 메시지 말미에 트레일러 2줄을 붙인다:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 630 · cli 138 · web 800 · server 196 · typecheck EXIT=0`. 이 트랙은 **core와 web만** 올린다.
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`는 자식 출력을 삼켜 오류가 있어도 출력이 0바이트다. `pnpm -r typecheck; echo "EXIT=$?"` 또는 패키지별로 돌린다. 파이프(`| tail`)를 붙이면 `$?`가 tail 것이 되어 또 오판한다.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라 — 개발 DB가 통째로 날아간다.** 이 트랙은 서버 테스트가 필요 없다. 돌린다면 `DATABASE_URL`을 격리 test DB로 **명시**해서 준다.
- **작업 디렉터리는 워크트리다.** 최상위 체크아웃(`/Users/jang2162/IdeaProjects/ERDD`)에서 파일을 고치지 않는다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/naming.ts` | 자동완성 후보 산출 `suggestCompletions` 추가 | 수정 |
| `packages/core/src/naming.test.ts` | 위 함수 테스트 | 수정 |
| `packages/core/src/index.ts` | `suggestCompletions`·타입 재export | 수정 |
| `apps/web/src/editor/dict-edits.ts` | 등록 가능 판정 `canRegisterWord`/`canRegisterTerm` 추가 | 수정 |
| `apps/web/src/editor/dict-edits.test.ts` | 위 판정 테스트 | 수정 |
| `apps/web/src/editor/name-pair.tsx` | 논리·물리명 쌍 컨테이너 + 필드(제어 인풋·↻·자동완성·칩·인라인 등록) | **신설** |
| `apps/web/src/editor/name-pair.test.tsx` | 위 컴포넌트 테스트 | **신설** |
| `apps/web/src/editor/edit-panel.tsx` | 테이블·컬럼 명명 영역을 `NamePair`로 교체, 용어 등록 개선 | 수정 |
| `apps/web/src/editor/edit-panel.test.tsx` | 접근 이름 변경 반영 | 수정 |
| `apps/web/src/editor/dict-panel.tsx` | 미등록 항목 하위 탭 2개 + 두 섹션 통합 + store 규칙 사용 | 수정 |
| `apps/web/src/editor/dict-panel.test.tsx` | 하위 탭 양방향 전수 | 수정 |
| `docs/manual/user-guide.md` · `docs/13-naming.md` · `docs/superpowers/HANDOFF.md` | 문서 갱신 | 수정 |

`name-pair.tsx` 하나에 컨테이너와 필드를 함께 두는 이유: 둘이 draft를 공유하고 **함께 바뀐다**. 파일을 가르면 draft를 prop으로 왕복시켜야 해서 오히려 결합이 는다.

---

## Task 1: core `suggestCompletions`

**Files:**
- Modify: `packages/core/src/naming.ts` (파일 끝에 추가)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/naming.test.ts` (파일 끝에 `describe` 추가)

**Interfaces:**
- Consumes: 같은 파일의 `decomposeByWords`(16행)·`abbreviationIndex`(57행, private)·`NamingRules`
- Produces:
  ```ts
  export type Completion = { insert: string; hint: string; kind: 'word' | 'term'; start: number }
  export type CompletionResult = { query: string; items: Completion[] }
  export function suggestCompletions(
    input: string, side: 'logical' | 'physical',
    words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
  ): CompletionResult
  ```
  `insert`를 넣는 방법은 `input.slice(0, item.start) + item.insert`다. 단어 후보는 `start`가 쿼리 시작 위치이고, **용어 후보는 `start: 0`**(입력 전체를 치환한다).

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/naming.test.ts` 끝에 추가:

```ts
describe('suggestCompletions', () => {
  const w = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    w3: { id:'w3', logicalName:'주소', abbreviation:'ADDR', englishName:null, description:null, origin:null },
    w4: { id:'w4', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
  }
  const t = {
    t1: { id:'t1', logicalName:'회원주문번호', physicalName:'MBR_ORD_NO', domainId:null, description:null, origin:null },
  }

  it('논리명 — 마지막 미매칭 꼬리만 쿼리가 된다', () => {
    const r = suggestCompletions('회원주', 'logical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('주')
    expect(r.items.map((i) => i.insert)).toEqual(['주문', '주소'])
    // '회원'은 매칭돼 확정 구간이므로 치환은 그 뒤부터다
    expect(r.items[0]!.start).toBe(2)
    expect('회원주'.slice(0, r.items[0]!.start) + r.items[0]!.insert).toBe('회원주문')
  })

  it('논리명 — 사전 단어로 딱 떨어지면 후보를 내지 않는다', () => {
    const r = suggestCompletions('회원주문', 'logical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('')
    expect(r.items).toEqual([])
  })

  it('빈 입력이면 후보가 없다', () => {
    expect(suggestCompletions('', 'logical', w, {}, DEFAULT_NAMING_RULES).items).toEqual([])
    expect(suggestCompletions('', 'physical', w, {}, DEFAULT_NAMING_RULES).items).toEqual([])
  })

  it('앞뒤 공백이 있는 입력은 후보를 내지 않는다(치환 인덱스가 어긋난다)', () => {
    expect(suggestCompletions(' 회원주', 'logical', w, {}, DEFAULT_NAMING_RULES).items).toEqual([])
    expect(suggestCompletions('회원주 ', 'logical', w, {}, DEFAULT_NAMING_RULES).items).toEqual([])
  })

  it('용어는 입력 전체로 찾고 전체를 치환한다(start 0)', () => {
    const r = suggestCompletions('회원주', 'logical', w, t, DEFAULT_NAMING_RULES)
    const term = r.items.find((i) => i.kind === 'term')
    expect(term).toBeDefined()
    expect(term!.insert).toBe('회원주문번호')
    expect(term!.start).toBe(0)
    // 용어가 단어보다 앞에 온다 — generatePhysicalName의 우선순위와 같다
    expect(r.items[0]!.kind).toBe('term')
  })

  it('물리명 — 구분자 뒤 토큰이 쿼리다', () => {
    const r = suggestCompletions('MBR_OR', 'physical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('OR')
    expect(r.items.map((i) => i.insert)).toEqual(['ORD'])
    expect(r.items[0]!.start).toBe(4)
    expect('MBR_OR'.slice(0, 4) + 'ORD').toBe('MBR_ORD')
  })

  it('물리명 — 소문자로 쳐도 약어를 찾는다', () => {
    const r = suggestCompletions('mbr_or', 'physical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.items.map((i) => i.insert)).toEqual(['ORD'])
  })

  it('물리명 — 구분자가 없는 규칙에서는 약어 그리디로 끊고 남은 꼬리가 쿼리다', () => {
    const rules = { case: 'UPPER_SNAKE' as const, separator: '' as const, maxLengthBytes: 30 }
    const r = suggestCompletions('MBROR', 'physical', w, {}, rules)
    expect(r.query).toBe('OR')
    expect(r.items.map((i) => i.insert)).toEqual(['ORD'])
    expect(r.items[0]!.start).toBe(3)
  })

  it('쿼리와 완전히 같은 후보는 제외한다', () => {
    const r = suggestCompletions('MBR_ORD', 'physical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.items.map((i) => i.insert)).not.toContain('ORD')
  })

  it('짧은 것 먼저 · 동률이면 사전순, 상한 8', () => {
    // ⚠️ i를 1부터 돌린다. 0이면 사전에 '가' 자체가 들어가 decomposeByWords가 그것을 매칭해
    // 쿼리가 빈 문자열이 되고, 후보가 0건이라 이 테스트가 상한을 검사하지 못한다.
    const many: Record<string, Word> = {}
    for (let i = 1; i <= 12; i += 1) {
      many[`m${i}`] = {
        id: `m${i}`, logicalName: `가${'나'.repeat(i)}`, abbreviation: `A${i}`,
        englishName: null, description: null, origin: null,
      }
    }
    const r = suggestCompletions('가', 'logical', many, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('가')
    expect(r.items).toHaveLength(8)
    expect(r.items[0]!.insert).toBe('가나')            // 가장 짧은 것이 먼저다
    expect(r.items[0]!.insert.length).toBeLessThanOrEqual(r.items[7]!.insert.length)
  })

  it('같은 약어를 가진 단어가 둘이어도 후보는 하나다', () => {
    const dup = {
      ...w,
      w5: { id:'w5', logicalName:'차주', abbreviation:'ORD', englishName:null, description:null, origin:null },
    }
    const r = suggestCompletions('MBR_OR', 'physical', dup, {}, DEFAULT_NAMING_RULES)
    expect(r.items.filter((i) => i.insert === 'ORD')).toHaveLength(1)
  })
})
```

import 줄도 함께 고친다(파일 2행):

```ts
import {
  generatePhysicalName, decomposeByWords, restoreLogicalName, DEFAULT_NAMING_RULES, suggestCompletions,
} from './naming.js'
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
```
기대: `suggestCompletions is not a function` 또는 TS 해석 실패로 전 케이스 FAIL.

- [ ] **Step 3: 구현한다**

`packages/core/src/naming.ts` 끝에 추가:

```ts
/** 자동완성 후보 하나. 넣는 방법은 `input.slice(0, start) + insert` 다. */
export type Completion = { insert: string; hint: string; kind: 'word' | 'term'; start: number }
export type CompletionResult = { query: string; items: Completion[] }

/** 한 번에 보여 주는 후보 수. 이 위로는 목록이 스크롤되어 고르는 비용이 타이핑보다 커진다. */
const MAX_COMPLETIONS = 8

/**
 * 입력 중인 이름의 **아직 사전에 매칭되지 않은 꼬리 한 조각**을 쿼리로 삼아 후보를 낸다.
 *
 * ⚠️ 쿼리 산출은 generatePhysicalName·restoreLogicalName과 **같은 분해 규칙**을 써야 한다 —
 * 그래서 이 파일에 있다(abbreviationIndex도 이 파일의 private 함수다).
 *
 * 용어만 **입력 전체**로 찾는다. 용어는 논리명 전체 완전일치가 적용 규칙이므로(generatePhysicalName
 * 1단계) 꼬리 조각으로 찾으면 의미가 달라진다. 그래서 용어 후보의 start는 0이다.
 *
 * 앞뒤 공백이 있는 입력은 후보를 내지 않는다 — decomposeByWords가 trim된 이름을 다루므로
 * 세그먼트 길이로 계산한 start가 원본 input에서 어긋난다.
 */
export function suggestCompletions(
  input: string, side: 'logical' | 'physical',
  words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): CompletionResult {
  const none: CompletionResult = { query: '', items: [] }
  if (input === '' || input !== input.trim()) return none

  const query = side === 'logical'
    ? logicalQuery(input, words)
    : physicalQuery(input, words, rules)
  if (query === '') return none

  const start = input.length - query.length
  const seen = new Set<string>()
  const push = (list: Completion[], c: Completion) => {
    if (c.insert === '' || seen.has(`${c.kind} ${c.insert}`)) return
    seen.add(`${c.kind} ${c.insert}`)
    list.push(c)
  }

  // 용어 먼저 — generatePhysicalName이 용어를 먼저 보는 것과 같은 우선순위다.
  const termItems: Completion[] = []
  for (const t of Object.values(terms)) {
    const target = side === 'logical' ? t.logicalName : t.physicalName
    if (!startsWithFold(target, input, side) || foldEq(target, input, side)) continue
    push(termItems, {
      insert: target, hint: side === 'logical' ? t.physicalName : t.logicalName,
      kind: 'term', start: 0,
    })
  }

  const wordItems: Completion[] = []
  for (const w of Object.values(words)) {
    const target = side === 'logical' ? w.logicalName : w.abbreviation
    if (!startsWithFold(target, query, side) || foldEq(target, query, side)) continue
    push(wordItems, {
      insert: target, hint: side === 'logical' ? w.abbreviation : w.logicalName,
      kind: 'word', start,
    })
  }

  const byLength = (a: Completion, b: Completion) => (
    a.insert.length !== b.insert.length
      ? a.insert.length - b.insert.length
      : (a.insert < b.insert ? -1 : a.insert > b.insert ? 1 : 0)
  )
  termItems.sort(byLength)
  wordItems.sort(byLength)
  return { query, items: [...termItems, ...wordItems].slice(0, MAX_COMPLETIONS) }
}

/** 물리명 쪽만 대소문자를 접어 비교한다(약어는 대문자 규약이지만 소문자로 치는 것을 허용한다). */
function fold(s: string, side: 'logical' | 'physical'): string {
  return side === 'physical' ? s.toUpperCase() : s
}
function startsWithFold(target: string, prefix: string, side: 'logical' | 'physical'): boolean {
  return target !== '' && fold(target, side).startsWith(fold(prefix, side))
}
function foldEq(a: string, b: string, side: 'logical' | 'physical'): boolean {
  return fold(a, side) === fold(b, side)
}

/** 논리명의 미매칭 꼬리. decomposeByWords의 마지막 세그먼트가 word:null일 때만 있다. */
function logicalQuery(input: string, words: Record<string, Word>): string {
  const segments = decomposeByWords(input, words)
  const last = segments[segments.length - 1]
  return last && last.word === null ? last.text : ''
}

/** 물리명의 미매칭 꼬리. 구분자가 있으면 마지막 구분자 뒤, 없으면 약어 그리디의 잔여다. */
function physicalQuery(input: string, words: Record<string, Word>, rules: NamingRules): string {
  if (rules.separator !== '') {
    const idx = input.lastIndexOf(rules.separator)
    return idx === -1 ? input : input.slice(idx + rules.separator.length)
  }
  const index = abbreviationIndex(words)
  const byLen = [...index.keys()].sort((a, b) => b.length - a.length)
  const upper = input.toUpperCase()
  let i = 0
  let pending = ''
  while (i < upper.length) {
    const hit = byLen.find((abbr) => upper.startsWith(abbr, i))
    if (hit) { pending = ''; i += hit.length } else { pending += input[i]!; i += 1 }
  }
  return pending
}
```

`packages/core/src/index.ts`에 재export를 더한다 — 기존 `naming.js` export 줄에 이름을 추가한다(파일에서 `restoreLogicalName`을 내보내는 줄을 찾아 같은 자리에 넣는다):

```ts
export {
  /* …기존 이름 그대로… */ suggestCompletions,
  type Completion, type CompletionResult,
} from './naming.js'
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
```
기대: 신규 11건 PASS, `EXIT=0`.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts packages/core/src/index.ts && \
git commit -m "feat(core): 자동완성 후보를 내는 suggestCompletions 를 더한다

쿼리는 입력 중 아직 사전에 매칭되지 않은 꼬리 한 조각이다. 분해 규칙을
generatePhysicalName·restoreLogicalName 과 공유해야 해서 같은 파일에 둔다.
용어만 입력 전체로 찾고 전체를 치환한다(start 0).

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 2: 등록 가능 판정 `canRegisterWord` / `canRegisterTerm`

**Files:**
- Modify: `apps/web/src/editor/dict-edits.ts` (`createTerm` 아래, 34행 근처)
- Test: `apps/web/src/editor/dict-edits.test.ts` (파일 끝에 `describe` 추가)

**Interfaces:**
- Consumes: `ProjectModel`
- Produces:
  ```ts
  export type RegisterCheck = { ok: boolean; reason?: 'empty' | 'duplicate'; abbrClash?: boolean }
  export function canRegisterWord(model: ProjectModel, w: { logicalName: string; abbreviation: string }): RegisterCheck
  export function canRegisterTerm(model: ProjectModel, t: { logicalName: string; physicalName: string }): RegisterCheck
  ```

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/dict-edits.test.ts` 끝에 추가:

```ts
describe('canRegisterWord', () => {
  const base = (): ProjectModel => ({
    ...createEmptyModel(),
    words: {
      w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    },
  })

  it('정상 등록', () => {
    expect(canRegisterWord(base(), { logicalName: '주문', abbreviation: 'ORD' }))
      .toEqual({ ok: true, abbrClash: false })
  })

  it('같은 논리명이 이미 있으면 막는다', () => {
    expect(canRegisterWord(base(), { logicalName: '회원', abbreviation: 'MEM' }))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  it('앞뒤 공백을 무시하고 중복을 판정한다', () => {
    expect(canRegisterWord(base(), { logicalName: ' 회원 ', abbreviation: 'MEM' }).ok).toBe(false)
  })

  it('약어가 겹치면 막지는 않고 표식만 세운다', () => {
    expect(canRegisterWord(base(), { logicalName: '멤버', abbreviation: 'mbr' }))
      .toEqual({ ok: true, abbrClash: true })
  })

  it('어느 한쪽이 비면 막는다', () => {
    expect(canRegisterWord(base(), { logicalName: '', abbreviation: 'X' }))
      .toEqual({ ok: false, reason: 'empty' })
    expect(canRegisterWord(base(), { logicalName: '주문', abbreviation: '  ' }))
      .toEqual({ ok: false, reason: 'empty' })
  })
})

describe('canRegisterTerm', () => {
  const base = (): ProjectModel => ({
    ...createEmptyModel(),
    terms: {
      t1: { id:'t1', logicalName:'회원번호', physicalName:'MBR_NO', domainId:null, description:null, origin:null },
    },
  })

  it('정상 등록', () => {
    expect(canRegisterTerm(base(), { logicalName: '주문번호', physicalName: 'ORD_NO' }))
      .toEqual({ ok: true })
  })

  it('같은 논리명이 이미 있으면 막는다', () => {
    expect(canRegisterTerm(base(), { logicalName: '회원번호', physicalName: 'MEMBER_NO' }))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  it('어느 한쪽이 비면 막는다', () => {
    expect(canRegisterTerm(base(), { logicalName: '주문번호', physicalName: '' }))
      .toEqual({ ok: false, reason: 'empty' })
  })
})
```

파일 상단 import에 `canRegisterWord`, `canRegisterTerm`, `createEmptyModel`을 더한다(`createEmptyModel`은 `@erdd/core`에서 온다 — 이미 import돼 있으면 그대로 쓴다).

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/dict-edits.test.ts
```
기대: `canRegisterWord is not a function`으로 신규 8건 FAIL.

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/dict-edits.ts`의 `removeTerm`(34행) 아래에 추가:

```ts
/**
 * 인라인 등록의 사전 판정. createWord·createTerm 에는 중복 검사가 없어서(같은 논리명 단어를 둘
 * 만들면 decomposeByWords 가 하나만 쓰고 나머지는 유령이 된다) 부르는 쪽이 막아야 한다.
 * 사전 화면의 일괄 등록은 미등록 목록에서 오므로 정의상 중복이 아니다 — 그래서 이 판정은
 * 인라인 등록 경로만 쓴다.
 */
export type RegisterCheck = { ok: boolean; reason?: 'empty' | 'duplicate'; abbrClash?: boolean }

export function canRegisterWord(
  model: ProjectModel, w: { logicalName: string; abbreviation: string },
): RegisterCheck {
  const logicalName = w.logicalName.trim()
  const abbreviation = w.abbreviation.trim()
  if (logicalName === '' || abbreviation === '') return { ok: false, reason: 'empty' }
  const values = Object.values(model.words)
  if (values.some((x) => x.logicalName.trim() === logicalName)) return { ok: false, reason: 'duplicate' }
  // 약어 충돌은 막지 않는다 — abbreviationIndex 가 id 가 작은 쪽으로 결정론적으로 고르므로
  // 무결성 문제가 아니고, 같은 약어를 쓰는 단어가 실제로 존재한다(표시만 경고한다).
  const abbrClash = values.some((x) => x.abbreviation.trim().toUpperCase() === abbreviation.toUpperCase())
  return { ok: true, abbrClash }
}

export function canRegisterTerm(
  model: ProjectModel, t: { logicalName: string; physicalName: string },
): RegisterCheck {
  const logicalName = t.logicalName.trim()
  const physicalName = t.physicalName.trim()
  if (logicalName === '' || physicalName === '') return { ok: false, reason: 'empty' }
  if (Object.values(model.terms).some((x) => x.logicalName.trim() === logicalName)) {
    return { ok: false, reason: 'duplicate' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/dict-edits.test.ts
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 신규 8건 PASS, `EXIT=0`.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts && \
git commit -m "feat(web): 인라인 등록용 중복 판정 canRegisterWord·canRegisterTerm 을 더한다

createWord·createTerm 에는 검사가 없어 같은 논리명 단어를 둘 만들 수 있고 그러면
decomposeByWords 가 하나만 쓴다. 약어 충돌은 막지 않고 표식만 세운다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: `NamePair` 골격 — 제어 인풋 · 필드 내 ↻ · blur 경합 제거

자동완성과 칩은 Task 4·5에서 얹는다. 이 태스크의 결과물만으로 편집 패널을 교체할 수 있어야 한다(교체 자체는 Task 6).

**Files:**
- Create: `apps/web/src/editor/name-pair.tsx`
- Test: `apps/web/src/editor/name-pair.test.tsx`

**Interfaces:**
- Consumes: `@erdd/core`의 `generatePhysicalName`·`restoreLogicalName`, `useEditorStore`(`model`·`namingRules`), `useModelMutation`
- Produces:
  ```ts
  export type NamePatch = { logicalName?: string; physicalName?: string }
  export function NamePair(props: {
    projectId: string
    logicalName: string        // 모델의 현재 값
    physicalName: string
    idPrefix: string           // 'tbl' | `col-${id}`
    physicalLabel: string      // '테이블 물리명' | '물리명'
    canEdit: boolean
    applyNames: (m: ProjectModel, patch: NamePatch) => ProjectModel
    extra?: ReactNode          // 컬럼의 「용어 등록」 슬롯
  }): JSX.Element
  ```
  `applyNames`를 받는 이유: 테이블이면 `updateTable`, 컬럼이면 `updateColumn`인데 **단어 등록(Task 5)과 이름 갱신을 한 producer로 합성**해야 하므로 mutate 소유권이 `NamePair`에 있어야 한다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/web/src/editor/name-pair.test.tsx` 신설:

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
import { grantEditPermission } from '@/testing/editor-store'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createWord } from './dict-edits.js'
import { updateTable } from './model-edits.js'
import { NamePair } from './name-pair.js'

const PROJECT = '018f6b0e-0000-7000-8000-0000000000aa'

/** 단어 사전을 채운 모델을 store에 싣는다. t2 = 회원/MBR. */
function loadModel(over?: { logicalName?: string; physicalName?: string }) {
  let m = buildSampleModel()
  m = createWord(m, { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null })
  m = createWord(m, { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null })
  m = createWord(m, { id:'w3', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null })
  if (over) m = updateTable(m, 't2', over)
  useEditorStore.getState().setLoaded(m, 1, PROJECT)
  grantEditPermission()
}

function renderPair(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  const table = useEditorStore.getState().model.tables['t2']!
  render(
    <NamePair
      projectId={PROJECT}
      logicalName={table.logicalName}
      physicalName={table.physicalName}
      idPrefix="tbl"
      physicalLabel="테이블 물리명"
      canEdit={canEdit}
      applyNames={(m, patch) => updateTable(m, 't2', patch)}
    />,
    { wrapper: w },
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('NamePair', () => {
  it('blur 하면 값을 커밋한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  it('Enter 로도 커밋한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER{Enter}')
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  // ⚠️ 이 트랙의 핵심 회귀. onMouseDown 의 preventDefault 를 지우면 빨개진다.
  it('치고 blur 없이 재생성을 누르면 방금 친 값을 기준으로 돈다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문번호')      // blur 하지 않는다
    await userEvent.click(screen.getByRole('button', { name: '물리명 재생성' }))
    await waitFor(() => {
      const t = useEditorStore.getState().model.tables['t2']!
      expect(t.physicalName).toBe('MBR_ORD_NO')      // 옛 값('회원')이면 'MBR' 이 나온다
      expect(t.logicalName).toBe('회원주문번호')       // 친 값도 함께 확정된다
    })
  })

  it('재생성 한 번이 뮤테이션 한 건이다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문번호')
    await userEvent.click(screen.getByRole('button', { name: '물리명 재생성' }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD_NO'))
    expect(calls).toHaveLength(1)
  })

  it('논리명 재생성은 물리명을 기준으로 돈다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '', physicalName: 'MBR_ORD' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '논리명 재생성' }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원주문'))
  })

  it('복원할 수 없으면 사유를 토스트로 알린다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '' as never)
    loadModel({ logicalName: '', physicalName: 'MBR_XXX' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '논리명 재생성' }))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('XXX'))
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('')
  })

  it('물리명을 커밋할 때 논리명이 비어 있으면 함께 채운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '', physicalName: '' })
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.type(input, 'MBR_ORD')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원주문'))
  })

  it('논리명이 이미 있으면 물리명 커밋이 그것을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '기존이름', physicalName: '' })
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.type(input, 'MBR_ORD')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD'))
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('기존이름')
  })

  it('읽기 전용이면 재생성 버튼이 없고 입력이 readOnly 다', () => {
    loadModel()
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    expect(screen.queryByRole('button', { name: '물리명 재생성' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('논리명')).toHaveAttribute('readonly')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
```
기대: `Failed to resolve import "./name-pair.js"` 로 전 케이스 FAIL.

- [ ] **Step 3: 구현한다**

`apps/web/src/editor/name-pair.tsx` 신설:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { generatePhysicalName, restoreLogicalName, type ProjectModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/field-label'

export type NamePatch = { logicalName?: string; physicalName?: string }

/**
 * 논리명·물리명을 **쌍으로** 쥐는 컨테이너.
 *
 * ⚠️ 두 draft 를 한 곳에 두는 것이 이 컴포넌트의 존재 이유다 — ↻ 버튼은 *반대편 필드의 아직
 * 커밋되지 않은 값*을 기준으로 삼아야 맞는데, draft 가 각 필드 안에만 있으면 그 값에 닿을 수 없다.
 *
 * ⚠️ 버튼에는 onMouseDown 에서 preventDefault 를 건다. 그러지 않으면
 * `mousedown → blur(커밋 큐) → click(옛 값으로 동작)` 순서가 되어 버튼이 방금 친 값을 못 본다.
 * 포커스 이동 자체를 막으면 blur 가 발생하지 않고, 핸들러가 draft 를 직접 읽어 한 번에 반영한다.
 *
 * mutate 를 이 컴포넌트가 소유하는 이유: 단어 인라인 등록과 이름 갱신을 **한 producer** 로
 * 합성해야 하기 때문이다. 대상이 테이블인지 컬럼인지는 applyNames 가 안다.
 */
export function NamePair(props: {
  projectId: string
  logicalName: string
  physicalName: string
  idPrefix: string
  physicalLabel: string
  canEdit: boolean
  applyNames: (m: ProjectModel, patch: NamePatch) => ProjectModel
  extra?: ReactNode
}) {
  const { logicalName, physicalName, canEdit, applyNames } = props
  const namingRules = useEditorStore((s) => s.namingRules)
  const words = useEditorStore((s) => s.model.words)
  const terms = useEditorStore((s) => s.model.terms)
  const mutate = useModelMutation(props.projectId)
  const [draft, setDraft] = useState({ logicalName, physicalName })

  // 모델 값이 바뀌면 draft 를 맞춘다 — 낙관적 반영·undo·남의 편집이 전부 이 경로로 온다.
  // 값이 같으면 setState 가 no-op 이라 내가 방금 커밋한 값으로는 아무 일도 일어나지 않는다.
  useEffect(() => { setDraft({ logicalName, physicalName }) }, [logicalName, physicalName])

  const commit = (patch: NamePatch, summary: string) => {
    if (Object.keys(patch).length === 0) return
    void mutate((m) => applyNames(m, patch), { summary })
  }

  /** 한쪽을 커밋한다. 반대쪽이 비어 있으면 기존 정책대로 함께 채운다(버튼만 덮어쓴다). */
  const commitSide = (side: 'logical' | 'physical', value: string) => {
    const current = side === 'logical' ? logicalName : physicalName
    if (value === current) return
    const patch: NamePatch = side === 'logical' ? { logicalName: value } : { physicalName: value }
    if (side === 'physical' && draft.logicalName.trim() === '' && value.trim() !== '') {
      const r = restoreLogicalName(value, words, terms, namingRules)
      if (r.ok) patch.logicalName = r.logicalName
    }
    if (side === 'logical' && draft.physicalName.trim() === '' && value.trim() !== '') {
      const gen = generatePhysicalName(value, words, terms, namingRules)
      if (gen.physicalName) patch.physicalName = gen.physicalName
    }
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'logical' ? '논리명 변경' : '물리명 변경')
  }

  /** ↻ — 자기 필드를 반대편 draft 기준으로 다시 만든다. 덮어쓴다. */
  const regenerate = (side: 'logical' | 'physical') => {
    const patch: NamePatch = {}
    if (side === 'physical') {
      const gen = generatePhysicalName(draft.logicalName, words, terms, namingRules)
      if (!gen.physicalName) {
        toast.error(gen.unknownWords.length > 0
          ? `사전에 없는 단어: ${gen.unknownWords.join(', ')}`
          : '논리명이 비어 있어 물리명을 만들 수 없습니다')
        return
      }
      if (gen.physicalName !== physicalName) patch.physicalName = gen.physicalName
    } else {
      const r = restoreLogicalName(draft.physicalName, words, terms, namingRules)
      if (!r.ok) {
        toast.error(r.unknownTokens.length > 0
          ? `등록되지 않은 약어: ${r.unknownTokens.join(', ')}`
          : '물리명이 비어 있어 논리명을 만들 수 없습니다')
        return
      }
      if (r.logicalName !== logicalName) patch.logicalName = r.logicalName
    }
    // 아직 커밋되지 않은 반대편 draft 도 함께 확정한다 — 안 그러면 다음 blur 가 뮤테이션을 하나 더 낸다.
    // 유니온 키로 patch[other] 에 쓰면 TS 가 거부하므로 분기로 적는다.
    if (side === 'physical') {
      if (draft.logicalName !== logicalName) patch.logicalName = draft.logicalName
    } else if (draft.physicalName !== physicalName) {
      patch.physicalName = draft.physicalName
    }
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'physical' ? '물리명 재생성' : '논리명 재생성')
  }

  return (
    <div className="grid gap-3">
      <NameField
        side="physical" label={props.physicalLabel} id={`${props.idPrefix}-physical`}
        value={draft.physicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, physicalName: v }))}
        onCommit={(v) => commitSide('physical', v)}
        onRegenerate={() => regenerate('physical')}
      />
      <NameField
        side="logical" label="논리명" id={`${props.idPrefix}-logical`}
        value={draft.logicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, logicalName: v }))}
        onCommit={(v) => commitSide('logical', v)}
        onRegenerate={() => regenerate('logical')}
      />
      {props.extra}
    </div>
  )
}

function NameField(props: {
  side: 'logical' | 'physical'
  label: string
  id: string
  value: string
  canEdit: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onRegenerate: () => void
}) {
  const regenerateLabel = props.side === 'physical' ? '물리명 재생성' : '논리명 재생성'
  return (
    <div className="grid gap-1.5">
      <FieldLabel htmlFor={props.id} required>{props.label}</FieldLabel>
      <div className="relative">
        <Input
          id={props.id}
          aria-label={props.label}
          value={props.value}
          readOnly={!props.canEdit}
          className={props.side === 'physical' ? 'pr-9 font-mono' : 'pr-9'}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={(e) => props.onCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); props.onCommit(props.value) }
          }}
        />
        {props.canEdit && (
          <Button
            type="button" size="icon" variant="ghost"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={regenerateLabel}
            // ⚠️ 포커스를 뺏지 않는다 — blur 커밋이 먼저 큐에 들어가면 옛 값으로 동작한다.
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onRegenerate}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 9건 PASS, `EXIT=0`.

- [ ] **Step 5: 회귀 테스트가 공허하지 않은지 실증한다**

⚠️ **이 Step 은 리뷰 수정 라운드에서 고쳐 적은 것이다.** 원래는 *"`onMouseDown` 의 `preventDefault` 한 줄을 지우면 「방금 친 값」이 빨개진다"* 로 적혀 있었는데 **사실이 아니다** — 그 줄을 지워도 web 전건이 통과한다(리뷰어·구현자 각각 실측). 「방금 친 값」이 잠그는 것은 **draft 기반 읽기**다.

`regenerate`(`name-pair.tsx`)의 `draft.logicalName`·`draft.physicalName` 을 커밋된 props 로 **잠시 바꾸고** 돌린다.

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
```
기대: **「방금 친 값」·「뮤테이션 한 건」 2건 FAIL**(물리명이 `MBR`로 나온다). 확인했으면 되살리고 다시 PASS를 확인한다.

`preventDefault` 는 **포커스 유지**가 실효이므로 그것을 보는 케이스로 따로 잠근다(Task 4 이후에 넣는다):
```tsx
it('↻ 를 눌러도 포커스가 입력란에 남는다', async () => { /* … */ expect(logical).toHaveFocus() })
```
그 줄을 지우면 이 케이스가 빨개진다.

⚠️ **실증은 반드시 최종 코드에서 다시 돌려라.** 이 Task 시점의 실증 결과는 Task 4 가 blur 를 `setTimeout` 으로 미루면서 뒤집힌다 — 그때는 blur 커밋이 ↻ 커밋보다 **먼저** 도착해 실제 op 를 냈지만, 지연 뒤에는 나중에 도착해 `ops.length===0 → noop` 으로 사라진다. 중간 단계의 실증을 최종 보고에 그대로 옮겨 적으면 안 된다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/name-pair.tsx apps/web/src/editor/name-pair.test.tsx && \
git commit -m "feat(web): 논리·물리명 쌍을 함께 쥐는 NamePair 를 만든다

두 draft 를 한 컨테이너에 두어 ↻ 가 반대편의 미커밋 값을 기준으로 돌게 하고,
버튼의 onMouseDown preventDefault 로 blur 커밋 경합을 없앤다. 재생성 한 번이
뮤테이션 한 건이다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 4: 자동완성 목록

**Files:**
- Modify: `apps/web/src/editor/name-pair.tsx` (`NameField`)
- Test: `apps/web/src/editor/name-pair.test.tsx` (`describe('NamePair 자동완성')` 추가)

**Interfaces:**
- Consumes: Task 1의 `suggestCompletions`·`Completion`
- Produces: 없음(내부 동작)

- [ ] **Step 1: 실패 테스트를 쓴다**

`name-pair.test.tsx` 끝에 추가:

```tsx
describe('NamePair 자동완성', () => {
  it('논리명 꼬리에 맞는 후보를 목록으로 낸다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    const list = await screen.findByRole('listbox')
    expect(list).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /주문/ })).toBeInTheDocument()
  })

  it('사전 단어로 딱 떨어지면 목록이 없다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('클릭으로 확정하면 꼬리만 치환되고 커밋은 나가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await userEvent.click(await screen.findByRole('option', { name: /주문/ }))
    expect(logical.value).toBe('회원주문')
    expect(calls).toHaveLength(0)                 // 확정은 커밋이 아니다
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원')
  })

  it('아래 화살표 + Enter 로 확정하고, 그 Enter 는 커밋으로 내려가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(logical.value).toBe('회원주문')
    expect(calls).toHaveLength(0)
  })

  it('Esc 로 닫고, 한 글자 더 치면 다시 열린다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // 닫은 뒤 한 글자 더 치면 다시 열린다
    await userEvent.type(logical, '문')
    expect(logical.value).toBe('회원주문')
  })

  it('목록을 닫는 Esc 는 상위로 전파되지 않는다', async () => {
    const onKeyDown = vi.fn()
    loadModel()
    // 상위 감시자를 끼운 래퍼로 다시 렌더한다(renderPair 와 같은 provider 를 쓴다).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
    const table = useEditorStore.getState().model.tables['t2']!
    render(
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onKeyDown={onKeyDown}>
            <NamePair
              projectId={PROJECT}
              logicalName={table.logicalName}
              physicalName={table.physicalName}
              idPrefix="tbl"
              physicalLabel="테이블 물리명"
              canEdit
              applyNames={(m, patch) => updateTable(m, 't2', patch)}
            />
          </div>
        </TRPCProvider>
      </QueryClientProvider>,
    )
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    onKeyDown.mockClear()
    await userEvent.keyboard('{Escape}')
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it('물리명에서는 약어를 제안한다', async () => {
    loadModel()
    renderPair()
    const physical = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(physical)
    await userEvent.type(physical, 'MBR_OR')
    expect(await screen.findByRole('option', { name: /ORD/ })).toBeInTheDocument()
  })

  it('읽기 전용이면 목록이 열리지 않는다', async () => {
    loadModel()
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.click(logical)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx -t '자동완성'
```
기대: `Unable to find role="listbox"`로 FAIL.

- [ ] **Step 3: 구현한다**

`name-pair.tsx`의 import에 더한다:

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  generatePhysicalName, restoreLogicalName, suggestCompletions,
  type Completion, type ProjectModel,
} from '@erdd/core'
```

`NameField`를 아래로 교체한다:

```tsx
function NameField(props: {
  side: 'logical' | 'physical'
  label: string
  id: string
  value: string
  canEdit: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onRegenerate: () => void
}) {
  const namingRules = useEditorStore((s) => s.namingRules)
  const words = useEditorStore((s) => s.model.words)
  const terms = useEditorStore((s) => s.model.terms)
  const [focused, setFocused] = useState(false)
  // 확정·Esc 로 닫은 상태. 다음 타이핑에서 풀린다.
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const completions = useMemo(
    () => (props.canEdit
      ? suggestCompletions(props.value, props.side, words, terms, namingRules)
      : { query: '', items: [] as Completion[] }),
    [props.value, props.side, props.canEdit, words, terms, namingRules],
  )
  const open = focused && !dismissed && completions.items.length > 0
  useEffect(() => { setActive(0) }, [completions.query])

  const apply = (item: Completion) => {
    props.onChange(props.value.slice(0, item.start) + item.insert)
    setDismissed(true)      // 확정하면 닫는다. 다음 글자를 치면 다시 열린다.
  }

  const regenerateLabel = props.side === 'physical' ? '물리명 재생성' : '논리명 재생성'
  const listId = `${props.id}-completions`

  return (
    <div className="grid gap-1.5">
      <FieldLabel htmlFor={props.id} required>{props.label}</FieldLabel>
      <div className="relative">
        <Input
          id={props.id}
          aria-label={props.label}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={props.value}
          readOnly={!props.canEdit}
          className={props.side === 'physical' ? 'pr-9 font-mono' : 'pr-9'}
          onFocus={() => setFocused(true)}
          onChange={(e) => { setDismissed(false); props.onChange(e.target.value) }}
          onBlur={(e) => {
            const value = e.target.value
            // 목록 항목을 누른 경우 mousedown 의 preventDefault 로 blur 가 오지 않는다.
            // 그래도 방어로 한 틱 미뤄 확정이 먼저 반영되게 한다.
            blurTimer.current = setTimeout(() => { setFocused(false); props.onCommit(value) }, 0)
          }}
          onKeyDown={(e) => {
            if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              const delta = e.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + delta + completions.items.length) % completions.items.length)
              return
            }
            if (open && e.key === 'Enter') {
              // 목록이 열려 있는 동안 Enter 는 확정 전용이다 — 커밋으로 내려가지 않는다.
              e.preventDefault()
              const item = completions.items[active]
              if (item) apply(item)
              return
            }
            if (open && e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()     // 상위(다이얼로그·캔버스)로 새면 안 된다
              setDismissed(true)
              return
            }
            if (e.key === 'Enter') { e.preventDefault(); props.onCommit(props.value) }
          }}
        />
        {props.canEdit && (
          <Button
            type="button" size="icon" variant="ghost"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={regenerateLabel}
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onRegenerate}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
        {open && (
          <ul
            id={listId} role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {completions.items.map((item, i) => (
              <li
                key={`${item.kind}-${item.insert}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm ${
                  i === active ? 'bg-accent' : ''
                }`}
                onMouseDown={(e) => e.preventDefault()}   // blur 로 목록이 닫히기 전에 클릭이 온다
                onClick={() => apply(item)}
              >
                <span className={props.side === 'physical' ? 'font-mono' : undefined}>{item.insert}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.kind === 'term' ? `용어 · ${item.hint}` : item.hint}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

`blurTimer`가 남지 않도록 언마운트에서 정리한다(`NameField` 안, `useEffect` 하나 추가):

```tsx
useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: Task 3의 9건 + 신규 8건 = 17건 PASS. **Task 3의 9건이 하나도 깨지지 않아야 한다** — 깨졌다면 blur 지연이 커밋을 늦춘 것이니 `waitFor`가 아니라 구현을 고친다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/name-pair.tsx apps/web/src/editor/name-pair.test.tsx && \
git commit -m "feat(web): 명명 입력에 단어 단위 자동완성을 붙인다

입력 중 미매칭 꼬리를 쿼리로 후보를 낸다. 확정은 커밋이 아니라 치환이고,
목록이 열린 동안 Enter 는 확정 전용이다. Esc 는 상위로 전파하지 않는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: 미등록 칩 · 인라인 단어 등록

**Files:**
- Modify: `apps/web/src/editor/name-pair.tsx`
- Test: `apps/web/src/editor/name-pair.test.tsx` (`describe('NamePair 미등록 칩')` 추가)

**Interfaces:**
- Consumes: Task 2의 `canRegisterWord`, `dict-edits.ts`의 `createWord`, `./uid.js`의 `newId`
- Produces: 없음(내부 동작)

⚠️ **칩은 `props.logicalName`/`props.physicalName`(모델의 커밋된 값)으로 계산한다. draft 가 아니다.** draft 로 하면 타이핑 중 마지막 구간이 늘 미등록이라 칩이 깜박인다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`name-pair.test.tsx` 끝에 추가:

```tsx
describe('NamePair 미등록 칩', () => {
  it('커밋된 논리명의 미등록 단어를 칩으로 낸다', () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    expect(screen.getByRole('button', { name: '쿠폰 등록' })).toBeInTheDocument()
  })

  it('타이핑 중에는 칩이 바뀌지 않는다(커밋된 값 기준)', async () => {
    loadModel({ logicalName: '회원', physicalName: 'MBR' })
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.type(logical, '쿠')
    expect(screen.queryByRole('button', { name: '쿠 등록' })).not.toBeInTheDocument()
  })

  it('칩을 누르면 약어 입력이 펼쳐지고 등록하면 단어가 생긴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR_XXX' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() => {
      const added = Object.values(useEditorStore.getState().model.words)
        .find((w) => w.logicalName === '쿠폰')
      expect(added?.abbreviation).toBe('CPN')
    })
  })

  it('물리명 칩은 논리명을 받아 역방향으로 등록한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원', physicalName: 'MBR_CPN' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: 'CPN 등록' }))
    await userEvent.type(screen.getByLabelText('CPN 논리명'), '쿠폰')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() => {
      const added = Object.values(useEditorStore.getState().model.words)
        .find((w) => w.abbreviation === 'CPN')
      expect(added?.logicalName).toBe('쿠폰')
    })
  })

  // ⚠️ duplicate 는 **물리명 칩 방향에서만** 도달한다. 논리명 칩은 정의상 사전에 없는 구간이라
  // 그쪽으로는 중복이 생길 수 없다 — 물리명 칩 'CPN' 에 이미 있는 논리명 '회원' 을 넣는 것이
  // 실제로 일어나는 형태다.
  it('물리명 칩에 이미 있는 논리명을 넣으면 등록이 막히고 사유가 보인다', async () => {
    loadModel({ logicalName: '회원', physicalName: 'MBR_CPN' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: 'CPN 등록' }))
    const input = screen.getByLabelText('CPN 논리명')
    await userEvent.type(input, '주문')          // 사전에 있다(w2)
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeDisabled()
    expect(screen.getByText(/이미 있는 이름/)).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '쿠폰')          // 사전에 없다
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeEnabled()
  })

  it('사전이 채워져 칩이 사라지면 펼친 폼도 닫힌다', async () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    expect(screen.getByLabelText('쿠폰 약어')).toBeInTheDocument()
    const m = useEditorStore.getState().model
    useEditorStore.getState().setLoaded(
      createWord(m, { id:'w9', logicalName:'쿠폰', abbreviation:'CPN', englishName:null, description:null, origin:null }),
      2, PROJECT,
    )
    grantEditPermission()
    await waitFor(() => expect(screen.queryByLabelText('쿠폰 약어')).not.toBeInTheDocument())
  })

  it('약어가 겹치면 막지 않고 경고만 보여 준다', async () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'MBR')   // w1과 겹친다
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeEnabled()
    expect(screen.getByText(/이미 쓰는 약어/)).toBeInTheDocument()
  })

  it('등록하면 반대편이 비어 있을 때만 함께 채운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: '' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() =>
      expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_CPN'))
  })

  it('반대편이 이미 차 있으면 등록이 그것을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: '기존물리명' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() =>
      expect(Object.values(useEditorStore.getState().model.words).some((w) => w.logicalName === '쿠폰'))
        .toBe(true))
    expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('기존물리명')
  })

  it('읽기 전용이면 칩이 없다', () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    expect(screen.queryByRole('button', { name: '쿠폰 등록' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx -t '미등록 칩'
```
기대: `Unable to find role="button" name="쿠폰 등록"`으로 FAIL.

- [ ] **Step 3: 구현한다**

import에 더한다:

```tsx
import { Plus } from 'lucide-react'
import { canRegisterWord, createWord } from './dict-edits.js'
import { newId } from './uid.js'
```

`NamePair` 안에 단어 등록 핸들러를 더한다(`regenerate` 아래):

```tsx
  /**
   * 미등록 구간을 단어로 등록한다. 등록과 "반대편이 비어 있으면 채우기"를 **한 producer** 로 묶어
   * Revision 1건 · undo 1회로 만든다.
   * ⚠️ 자동 생성은 next.words(방금 등록한 단어가 든 모델)로 계산해야 한다.
   */
  const registerWord = (logical: string, abbreviation: string) => {
    const id = newId()
    const draftLogical = draft.logicalName
    const draftPhysical = draft.physicalName
    void mutate((m) => {
      const next = createWord(m, {
        id, logicalName: logical.trim(), abbreviation: abbreviation.trim(),
        englishName: null, description: null, origin: null,
      })
      const patch: NamePatch = {}
      if (draftPhysical.trim() === '' && draftLogical.trim() !== '') {
        const gen = generatePhysicalName(draftLogical, next.words, next.terms, namingRules)
        if (gen.physicalName) patch.physicalName = gen.physicalName
      } else if (draftLogical.trim() === '' && draftPhysical.trim() !== '') {
        const r = restoreLogicalName(draftPhysical, next.words, next.terms, namingRules)
        if (r.ok) patch.logicalName = r.logicalName
      }
      return Object.keys(patch).length > 0 ? applyNames(next, patch) : next
    }, { summary: '단어 등록' })
  }
```

두 `NameField`에 prop을 더한다:

```tsx
      <NameField
        side="physical" label={props.physicalLabel} id={`${props.idPrefix}-physical`}
        value={draft.physicalName} committed={physicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, physicalName: v }))}
        onCommit={(v) => commitSide('physical', v)}
        onRegenerate={() => regenerate('physical')}
        onRegisterWord={registerWord}
      />
      <NameField
        side="logical" label="논리명" id={`${props.idPrefix}-logical`}
        value={draft.logicalName} committed={logicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, logicalName: v }))}
        onCommit={(v) => commitSide('logical', v)}
        onRegenerate={() => regenerate('logical')}
        onRegisterWord={registerWord}
      />
```

`NameField`의 props 타입에 `committed: string`과 `onRegisterWord: (logical: string, abbreviation: string) => void`를 더하고, 본문에 칩 계산과 렌더를 더한다. 칩 줄은 `</div>`(relative 컨테이너) **뒤**, 필드 `<div className="grid gap-1.5">`의 마지막 자식으로 들어간다:

```tsx
  const model = useEditorStore((s) => s.model)
  const [openChip, setOpenChip] = useState<string | null>(null)
  const [chipValue, setChipValue] = useState('')

  // ⚠️ draft 가 아니라 committed 로 계산한다 — draft 로 하면 타이핑 중 꼬리가 늘 미등록이라 깜박인다.
  const chips = useMemo(() => {
    if (!props.canEdit || props.committed.trim() === '') return []
    if (props.side === 'logical') {
      return generatePhysicalName(props.committed, words, terms, namingRules).unknownWords
    }
    const r = restoreLogicalName(props.committed, words, terms, namingRules)
    return r.ok ? [] : r.unknownTokens
  }, [props.canEdit, props.committed, props.side, words, terms, namingRules])

  // 사전이 바뀌어 칩이 사라지면 펼친 폼도 닫는다.
  useEffect(() => {
    if (openChip !== null && !chips.includes(openChip)) { setOpenChip(null); setChipValue('') }
  }, [chips, openChip])

  const check = openChip === null
    ? null
    : canRegisterWord(model, props.side === 'logical'
      ? { logicalName: openChip, abbreviation: chipValue }
      : { logicalName: chipValue, abbreviation: openChip })
```

렌더:

```tsx
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">미등록</span>
          {chips.map((chip) => (
            <Button
              key={chip} type="button" size="sm" variant="outline"
              className="h-6 gap-0.5 px-1.5 text-[11px]"
              aria-label={`${chip} 등록`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpenChip((cur) => (cur === chip ? null : chip))
                setChipValue('')
              }}
            >
              <Plus className="size-3" />
              <span className={props.side === 'physical' ? 'font-mono' : undefined}>{chip}</span>
            </Button>
          ))}
        </div>
      )}
      {openChip !== null && (
        <div className="grid gap-1 rounded-md border p-2">
          <span className="text-xs font-medium">{openChip}</span>
          <div className="flex items-center gap-1">
            <Input
              aria-label={`${openChip} ${props.side === 'logical' ? '약어' : '논리명'}`}
              placeholder={props.side === 'logical' ? '약어' : '논리명'}
              className={props.side === 'logical' ? 'h-8 font-mono' : 'h-8'}
              value={chipValue}
              onChange={(e) => setChipValue(e.target.value)}
            />
            <Button
              type="button" size="sm" className="h-8 shrink-0"
              disabled={!check?.ok}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const target = openChip
                const value = chipValue
                setOpenChip(null)
                setChipValue('')
                if (props.side === 'logical') props.onRegisterWord(target, value)
                else props.onRegisterWord(value, target)
              }}
            >
              단어 등록
            </Button>
          </div>
          {check?.abbrClash && (
            <span className="text-[11px] text-muted-foreground">이미 쓰는 약어입니다</span>
          )}
          {check?.reason === 'duplicate' && (
            <span className="text-[11px] text-destructive">사전에 이미 있는 이름입니다</span>
          )}
        </div>
      )}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 17 + 10 = 27건 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/editor/name-pair.tsx apps/web/src/editor/name-pair.test.tsx && \
git commit -m "feat(web): 미등록 단어를 이름 옆 칩에서 바로 등록한다

칩은 커밋된 값으로 계산해 타이핑 중 깜박이지 않는다. 등록과 「반대편이 비면 채우기」를
한 producer 로 묶어 Revision 1건이다. 논리명 칩은 약어를, 물리명 칩은 논리명을 받아
같은 createWord 로 간다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: 편집 패널 통합

**Files:**
- Modify: `apps/web/src/editor/edit-panel.tsx` (테이블 명명 영역 98-154행 · `ColumnRow` 276-367행 · 컬럼 핸들러 배선 190-260행 근처)
- Test: `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: Task 3~5의 `NamePair`·`NamePatch`, Task 2의 `canRegisterTerm`
- Produces: `ColumnRow`의 props에서 `onPhysicalName`·`onLogicalName`·`onRegenerate`·`onRestoreLogical` 4개가 **사라지고** `applyNames: (m: ProjectModel, patch: NamePatch) => ProjectModel` 하나가 들어온다.

- [ ] **Step 1: 기존 테스트를 새 접근 이름으로 옮기고, 용어 등록 케이스를 더한다**

`edit-panel.test.tsx`에서 아래 이름을 쓰는 케이스를 찾아 고친다.

| 옛 접근 이름 | 새 접근 이름 |
|---|---|
| `getByRole('button', { name: '재생성' })` (테이블) | `getByRole('button', { name: '물리명 재생성' })` |
| `getByRole('button', { name: '논리명 복원' })` | `getByRole('button', { name: '논리명 재생성' })` |
| `getByRole('button', { name: '물리명 재생성' })` (컬럼, aria-label) | 그대로 — 컬럼도 같은 이름이 된다 |
| `getByRole('button', { name: '컬럼 논리명 복원' })` | `getByRole('button', { name: '논리명 재생성' })` |

⚠️ 테이블과 컬럼이 같은 화면에 있으므로 **같은 이름의 버튼이 여러 개**가 된다. 옛 케이스가 `getByRole`로 하나만 집던 자리는 `getAllByRole(...)[0]`(테이블) 또는 컬럼 카드 안에서 `within(...)`으로 좁힌다:

```tsx
import { within } from '@testing-library/react'
// …
const card = screen.getByLabelText('논리명', { selector: `#col-${'c2'}-logical` }).closest('li')!
await userEvent.click(within(card).getByRole('button', { name: '물리명 재생성' }))
```

용어 등록 케이스를 더한다:

```tsx
  it('이미 있는 용어와 논리명이 같으면 용어 등록이 비활성이다', async () => {
    let m = buildSampleModel()
    m = createTerm(m, {
      id: 'tm1', logicalName: '회원명', physicalName: 'MBR_NM',
      domainId: null, description: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const card = screen.getByLabelText('논리명', { selector: '#col-c3-logical' }).closest('li')!
    expect(within(card).getByRole('button', { name: '용어 등록' })).toBeDisabled()
  })

  it('용어를 등록하면 토스트로 알린다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => '' as never)
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const card = screen.getByLabelText('논리명', { selector: '#col-c3-logical' }).closest('li')!
    await userEvent.click(within(card).getByRole('button', { name: '용어 등록' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })
```

`createTerm` import를 파일 상단에 더한다(`dict-edits.js`에서).

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx
```
기대: 이름을 바꾼 케이스 + 신규 2건 FAIL.

- [ ] **Step 3: 구현한다**

**(a) 테이블 명명 영역** — `edit-panel.tsx` 98-154행(물리명 `<div className="grid gap-1.5">`부터 논리명 블록 끝까지)을 통째로 교체한다:

```tsx
        <NamePair
          key={tid}
          projectId={projectId}
          logicalName={table.logicalName}
          physicalName={table.physicalName}
          idPrefix="tbl"
          physicalLabel="테이블 물리명"
          canEdit={canEdit}
          applyNames={(m, patch) => updateTable(m, tid, patch)}
        />
```

`key={tid}`가 중요하다 — 선택이 다른 테이블로 옮겨갈 때 draft가 남지 않게 한다.

**(b) 컬럼 핸들러** — `ColumnRow`에 넘기던 `onPhysicalName`·`onLogicalName`·`onRegenerate`·`onRestoreLogical` 네 prop을 지우고 둘로 바꾼다(`projectId`도 함께 넘겨야 한다 — `NamePair`가 `useModelMutation`을 직접 쓴다):

```tsx
            projectId={projectId}
            applyNames={(m, patch) => updateColumn(m, c.id, patch)}
```

`onRegisterTerm`은 유지하되 토스트를 더한다:

```tsx
            onRegisterTerm={() => {
              const logicalName = c.logicalName
              const physicalName = c.physicalName
              const domainId = c.domainId
              void mutate(
                (m) => createTerm(
                  m, { id: newId(), logicalName, physicalName, domainId, description: null, origin: null },
                ),
                { summary: '용어 등록' },
              )
              toast.success(`용어 「${logicalName}」을(를) 등록했습니다`)
            }}
```
(기존의 `if (… === '') return` 가드는 버튼 `disabled`로 옮겨가므로 지운다.)

**(c) `ColumnRow`** — props 타입에서 네 개를 빼고 `applyNames`를 넣는다. 명명 영역(299-317행)을 교체한다:

```tsx
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <NamePair
            projectId={props.projectId}
            logicalName={c.logicalName}
            physicalName={c.physicalName}
            idPrefix={`col-${c.id}`}
            physicalLabel="물리명"
            canEdit={canEdit}
            applyNames={props.applyNames}
            extra={canEdit ? (
              <div>
                <Button
                  size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                  aria-label="용어로 등록"
                  disabled={!termCheck.ok}
                  title={termCheck.reason === 'duplicate'
                    ? '같은 논리명의 용어가 이미 있습니다'
                    : termCheck.reason === 'empty'
                      ? '논리명과 물리명이 모두 있어야 등록할 수 있습니다'
                      : undefined}
                  onClick={props.onRegisterTerm}
                >
                  용어 등록
                </Button>
              </div>
            ) : undefined}
          />
        </div>
        <WarningBadge warnings={props.warnings} className="shrink-0" />
      </div>
```

`ColumnRow`는 `projectId`와 `termCheck`가 필요하다 — props에 `projectId: string`을 더하고, 부모에서 `model`을 넘기는 대신 컴포넌트 안에서 판정한다:

```tsx
  const model = useEditorStore((s) => s.model)
  const termCheck = canRegisterTerm(model, { logicalName: c.logicalName, physicalName: c.physicalName })
```

⚠️ `aria-label="용어로 등록"`은 그대로 두면 Step 1의 테스트가 `name: '용어 등록'`으로 못 찾는다. **`aria-label`을 지우고 버튼 텍스트(`용어 등록`)를 접근 이름으로 쓴다.**

import를 정리한다 — `NamePair`·`NamePatch`·`canRegisterTerm`·`toast`를 더하고, 더 쓰지 않게 된 `generatePhysicalName`·`restoreLogicalName`을 **실제로 남은 사용처가 없는지 확인한 뒤** 뺀다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/edit-panel.test.tsx src/editor/name-pair.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 전부 PASS, `EXIT=0`.

- [ ] **Step 5: web 전체 스위트를 돌려 파급을 본다**

```bash
pnpm -C apps/web test
```
기대: 실패 0. **`canvas.test.tsx`·`naming-check.test.tsx`처럼 편집 패널을 렌더하는 다른 스위트가 옛 버튼 이름을 쓰고 있으면 여기서 빨개진다** — 같은 표에 따라 고친다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/edit-panel.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 편집 패널의 테이블·컬럼 명명을 NamePair 로 바꾼다

컬럼 2열 가로 배치를 세로로 펴고 라벨 자리가 생겨 필수 표시(*)를 붙인다. 재생성
버튼은 필드 안으로 들어가고 이름을 「물리명 재생성」·「논리명 재생성」으로 통일한다.
용어 등록에 중복 가드와 성공 토스트를 더한다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 7: 사전 화면 미등록 항목 하위 탭

**Files:**
- Modify: `apps/web/src/editor/dict-panel.tsx` (42행 · 184-197행 · 221-360행)
- Test: `apps/web/src/editor/dict-panel.test.tsx`

**Interfaces:**
- Consumes: 없음(내부 리팩터)
- Produces: `UnregisteredWordsSection`·`UnregisteredAbbreviationsSection` 두 컴포넌트가 사라지고 `UnregisteredSection({ projectId, candidates, canEdit, direction })` 하나가 된다. `direction: 'toAbbr' | 'toLogical'`.

- [ ] **Step 1: 기존 케이스 2건을 고치고, 하위 탭 테스트를 더한다**

⚠️ **먼저 기존 케이스 2건이 깨진다.** `dict-panel.test.tsx`의 263행·280행이 「미등록 약어 일괄 등록」 버튼을 누르는데, 통합 후 그 버튼 이름은 **「일괄 등록」**이고 역방향은 **하위 탭을 먼저 눌러야** 보인다. 두 케이스에 탭 클릭 한 줄을 끼우고 버튼 이름을 고친다:

```tsx
    await userEvent.click(screen.getByRole('button', { name: /미등록 항목/ }))
    await userEvent.click(screen.getByRole('button', { name: /물리명 → 논리명/ }))   // ← 추가
    const input = screen.getByLabelText('GRD 논리명')
    await userEvent.type(input, '등급')
    await userEvent.click(screen.getByRole('button', { name: '일괄 등록' }))         // ← 이름 변경
```

116-120행의 읽기 전용 케이스는 **그대로 통과한다**(기본 탭이 「논리명 → 약어」라 `getByText('명')`·`queryByLabelText('명 약어')`가 그 탭 안에 있다). 확인만 하고 손대지 않는다.

그다음 아래 2건을 파일에 더한다. 헬퍼는 그 파일의 것을 그대로 쓴다 — `renderPanel()` · `PROJECT_ID` · `loadModelWithDict()`.

```tsx
  it('미등록 항목이 방향별 하위 탭으로 갈린다', async () => {
    // 논리명에 미등록 단어('쿠폰'), 물리명에 미등록 약어('XXX')가 각각 있는 모델
    let m = buildSampleModel()
    m = updateTable(m, 't2', { logicalName: '회원쿠폰', physicalName: 'MBR_XXX' })
    m = createWord(m, { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null })
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /미등록 항목/ }))

    // 기본 탭 — 논리명 → 약어
    expect(screen.getByLabelText('쿠폰 약어')).toBeInTheDocument()
    expect(screen.queryByLabelText('XXX 논리명')).not.toBeInTheDocument()

    // 반대 탭
    await userEvent.click(screen.getByRole('button', { name: /물리명 → 논리명/ }))
    expect(screen.getByLabelText('XXX 논리명')).toBeInTheDocument()
    expect(screen.queryByLabelText('쿠폰 약어')).not.toBeInTheDocument()
  })

  it('하위 탭에 각 방향의 건수가 붙는다', async () => {
    let m = buildSampleModel()
    m = updateTable(m, 't2', { logicalName: '회원쿠폰', physicalName: 'MBR_XXX' })
    m = createWord(m, { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null })
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    grantEditPermission()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /미등록 항목/ }))
    // 건수는 모델 전체 기준이라 픽스처의 다른 테이블·컬럼도 후보를 낸다 — 정확한 수가 아니라
    // "괄호 안에 수가 붙는다"를 본다.
    expect(screen.getByRole('button', { name: /논리명 → 약어 \(\d+\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /물리명 → 논리명 \(\d+\)/ })).toBeInTheDocument()
  })
```

`updateTable`(`./model-edits.js`) import를 더한다. `createWord`·`buildSampleModel`은 이미 있다.

⚠️ **정방향의 명명 규칙 수정(아래 Step 3-a)은 테스트로 잠기지 않는다.** 이월 노트가 이미 적었듯 *"관측 가능한 차이는 0 — `unknownWords`는 `decomposeByWords`에서만 나오고 `rules`는 조합·케이스·길이에만 쓰인다"*. 그래서 규칙을 바꿔도 결과가 같다. 고치는 목적은 **통합 후 두 방향이 같은 인자를 받게 하는 정합성**이다. 억지 테스트를 만들지 말고 이 사실을 보고에 적는다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/dict-panel.test.tsx
```
기대: 「물리명 → 논리명」 버튼이 없어 신규 2건 + 고친 기존 2건 = 4건 FAIL.

- [ ] **Step 3: 구현한다**

**(a) 1행의 import에 `useEffect`를 더한다**(`import { useEffect, useMemo, useState } from 'react'`). `Plus`·`Input`·`Button`은 이미 있다.

**(b) 42행의 명명 규칙 하드코딩을 고친다:**

```tsx
  const candidates = useMemo(
    () => unregisteredWords(model, namingRules), [model, namingRules])
```
(위의 `// Task 6에서 store에 실제 프로젝트 명명 규칙이…` 주석도 지운다. 그 Task는 끝났다.)
`DEFAULT_NAMING_RULES` import가 더 이상 쓰이지 않으면 지운다.

**(c) 하위 탭 상태를 더한다**(`section` state 옆):

```tsx
  const [direction, setDirection] = useState<'toAbbr' | 'toLogical'>('toAbbr')
```

**(d) 184-197행의 미등록 항목 블록을 교체한다:**

```tsx
          {section === 'unregistered' && (
            <div className="grid gap-3">
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={direction === 'toAbbr' ? 'default' : 'outline'}
                  onClick={() => setDirection('toAbbr')}
                >
                  논리명 → 약어{candidates.length > 0 ? ` (${candidates.length})` : ''}
                </Button>
                <Button
                  type="button" size="sm" variant={direction === 'toLogical' ? 'default' : 'outline'}
                  onClick={() => setDirection('toLogical')}
                >
                  물리명 → 논리명{abbrCandidates.length > 0 ? ` (${abbrCandidates.length})` : ''}
                </Button>
              </div>
              <UnregisteredSection
                projectId={projectId} canEdit={canEdit} direction={direction}
                candidates={direction === 'toAbbr' ? candidates : abbrCandidates}
              />
            </div>
          )}
```

**(e) 두 섹션 컴포넌트(221-360행)를 하나로 합친다:**

```tsx
/**
 * 미등록 항목 일괄 등록. 방향만 다르고 등록은 같은 createWord 다 —
 * toAbbr 는 논리명이 후보이고 약어를 받고, toLogical 은 그 반대다.
 * ⚠️ 두 방향을 각각의 컴포넌트로 두면 등록 규칙이 갈린다(그래서 합쳤다).
 */
function UnregisteredSection(
  { projectId, candidates, canEdit, direction }: {
    projectId: string; candidates: string[]; canEdit: boolean
    direction: 'toAbbr' | 'toLogical'
  },
) {
  const mutate = useModelMutation(projectId)
  const [valueByCandidate, setValueByCandidate] = useState<Record<string, string>>({})
  const toAbbr = direction === 'toAbbr'

  // 방향이 바뀌면 입력 중이던 값을 비운다 — 후보 집합이 통째로 다르다.
  useEffect(() => { setValueByCandidate({}) }, [direction])

  const onBulkRegister = () => {
    // producer 진입 전에 등록 대상(후보 + 입력값 + 신규 id)을 모두 확정한 상수 배열로 캡처한다.
    const registrations = candidates
      .map((candidate) => {
        const typed = (valueByCandidate[candidate] ?? '').trim()
        return {
          id: newId(),
          logicalName: toAbbr ? candidate : typed,
          abbreviation: toAbbr ? typed : candidate,
          typed,
        }
      })
      .filter((r) => r.typed !== '')
    if (registrations.length === 0) return
    void mutate(
      (m: ProjectModel) => registrations.reduce(
        (acc, r) => createWord(acc, {
          id: r.id, logicalName: r.logicalName, abbreviation: r.abbreviation,
          englishName: null, description: null, origin: null,
        }),
        m,
      ),
      { summary: toAbbr ? '미등록 단어 일괄 등록' : '미등록 약어 일괄 등록' },
    )
    setValueByCandidate({})
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {toAbbr
          ? '테이블·컬럼 논리명 분해 중 사전에 없는 단어입니다. 약어를 입력한 항목만 일괄 등록됩니다'
          : '테이블·컬럼 물리명 분해 중 사전에 없는 약어입니다. 논리명을 입력한 항목만 일괄 등록됩니다'}
      </p>
      {candidates.length === 0
        ? (
            <p className="text-sm text-muted-foreground">
              {toAbbr ? '미등록 단어가 없습니다' : '미등록 약어가 없습니다'}
            </p>
          )
        : (
            <>
              <ul className="grid max-h-72 gap-2 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li key={candidate} className="flex items-center gap-2 rounded-md border p-2">
                    <span className={`flex-1 font-medium ${toAbbr ? '' : 'font-mono'}`}>{candidate}</span>
                    {canEdit && (
                      <Input
                        aria-label={`${candidate} ${toAbbr ? '약어' : '논리명'}`}
                        placeholder={toAbbr ? '약어' : '논리명'}
                        className={`w-32 ${toAbbr ? 'font-mono' : ''}`}
                        value={valueByCandidate[candidate] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setValueByCandidate((prev) => ({ ...prev, [candidate]: value }))
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={onBulkRegister}><Plus /> 일괄 등록</Button>
                </div>
              )}
            </>
          )}
    </div>
  )
}
```

⚠️ 옛 역방향 섹션의 버튼 문구는 「미등록 약어 일괄 등록」이었다. 통합하면서 **양쪽 다 「일괄 등록」**이 된다. `dict-panel.test.tsx`에 그 문구로 버튼을 집는 기존 케이스가 있으면 함께 고친다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/dict-panel.test.tsx
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 신규 2건 포함 전부 PASS.

- [ ] **Step 5: 하위 탭 테스트가 공허하지 않은지 실증한다**

`UnregisteredSection`에 넘기는 `candidates` 삼항을 **뒤집어**(`direction === 'toAbbr' ? abbrCandidates : candidates`) 다시 돌린다.

```bash
pnpm -C apps/web exec vitest run src/editor/dict-panel.test.tsx -t '방향별 하위 탭'
```
기대: **FAIL**. 확인했으면 되돌리고 PASS를 확인한다. **실증 결과를 보고에 적는다** — HANDOFF가 *"'열면 열린다'류 테스트는 전수가 아니면 배선을 맞바꿔도 통과한다"* 고 경고한 자리다.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx && \
git commit -m "feat(web): 미등록 항목을 방향별 하위 탭으로 가르고 두 섹션을 합친다

상하로 이어 붙어 길던 두 목록을 탭 2개로 나눈다. 55줄 구조 중복이던 두 컴포넌트를
direction prop 하나로 합쳐 등록 규칙이 갈릴 자리를 없애고, 정방향 목록이 무시하던
프로젝트 명명 규칙을 store 값으로 바로잡는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 8: 문서 갱신과 최종 검증

**Files:**
- Modify: `docs/manual/user-guide.md`
- Modify: `docs/13-naming.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 사용자 매뉴얼을 고친다**

```bash
grep -n "재생성\|복원\|미등록" docs/manual/user-guide.md
```
찾은 자리를 새 동작으로 고친다. **화면 문구 인용(「」)이 어긋나는 자리를 전부 본다** — 특히:
- 「재생성」/「복원」 → 「물리명 재생성」/「논리명 재생성」(필드 안 ↻ 버튼)
- 컬럼 편집이 세로 배치가 된 것
- 이름 옆 「미등록」 칩으로 단어를 바로 등록할 수 있다는 것
- 사전 화면 「미등록 항목」이 하위 탭 2개로 갈린 것
- 논리명·물리명 입력 중 자동완성이 뜬다는 것

- [ ] **Step 2: 기획 문서를 고친다**

`docs/13-naming.md`에 자동완성·인라인 등록이 명명 흐름에 들어온 것을 한 절로 반영한다.

- [ ] **Step 3: 최종 검증을 돌린다**

```bash
pnpm -C packages/core test
pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```

네 수를 실측해 적어 둔다. 🔥 **서버 테스트를 돌린다면 `DATABASE_URL`을 격리 test DB로 명시한다. `. ./.env` 는 개발 DB를 지운다.** 이 트랙은 서버를 건드리지 않으므로 `cli`·`server`는 **무변경이어야 한다** — 움직였다면 범위를 넘은 것이다.

- [ ] **Step 4: HANDOFF 를 갱신한다**

`docs/superpowers/HANDOFF.md`에서:

1. **1절 완료 표**에 한 줄을 더한다. 담을 것: 두 draft 를 한 컨테이너에 둔 이유, `onMouseDown` `preventDefault` 가 blur 경합 수정의 본체라는 것, 칩은 커밋된 값으로 계산한다는 것(draft 면 깜박인다), 용어만 입력 전체로 찾는다는 것, **core 변경은 `suggestCompletions` 하나**라는 것.
2. **테스트 기준선**을 실측값으로 갱신하고, 이 사이클이 올린 수(`core +N · web +M`)와 **직전 기준선(`core 630 · web 800`)** 을 함께 적는다. `cli`·`server`는 무변경임을 명시한다.
3. **6절 이월 항목**을 정리한다.
   - **좁혀 다시 쓴다:** 「복원·재생성 버튼이 blur 커밋 전 값을 읽는다」 → *남은 곳은 사전의 단어·용어 편집 다이얼로그 둘*. 「컬럼 행에 필수 표시가 없다」 → *인덱스명만 남는다*.
   - **지운다:** 「`dict-panel.tsx`의 두 미등록 섹션이 55줄 구조 중복」, 「`dict-panel.tsx:39`가 `DEFAULT_NAMING_RULES`로 프로젝트 실제 규칙을 무시」, 명명 체계 절의 「자동생성 패널의 미등록 단어 인라인 등록」.
   - **새로 적는다:** 컬럼이 많은 모델에서 사이드바가 길어진다 · 자동완성이 접두일치뿐이다 · 물리명 칩의 역방향 등록은 약어를 고칠 수 없다(사전 화면으로 가야 한다).
4. **1절 「다음 작업」**에 남은 두 묶음을 적는다 — **A: 단축키 확장**(메모 삭제/복사·관계선 삭제, `use-shortcuts.ts`), **B: 그룹 별칭 + 테이블명 형식 템플릿**(`TableGroupSchema`에 필드 추가 → 마이그레이션 + 등록처 6~8곳, 그리고 "저장된 물리명 vs 조합해서 보여 주는 물리명"이 갈리는 새 개념).

- [ ] **Step 5: 커밋**

```bash
git add docs/manual/user-guide.md docs/13-naming.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 명명 입력 UI 개편을 문서에 반영한다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 확장이 하나뿐이라 사용자가 돈다)

단위 테스트가 잡지 못하는 것만 본다.

1. 컬럼이 10개 이상인 테이블을 골라 **사이드바 스크롤 길이**가 감당되는지 본다.
2. 논리명에 「회원주」까지 치고 **자동완성 목록이 입력란 바로 아래에** 뜨는지, 편집 패널 밖으로 잘리지 않는지 본다(jsdom은 레이아웃을 계산하지 않아 이것만은 테스트가 못 잡는다).
3. 미등록 칩을 눌러 펼친 폼이 컬럼 카드 안에서 깨지지 않는지 본다.
4. 물리명을 치다가 **논리명 칸의 ↻** 를 눌러 방금 친 물리명 기준으로 논리명이 나오는지 본다(핵심 회귀의 실물 확인).
5. `cmd+Z` 한 번으로 「단어 등록 + 이름 자동 생성」이 통째로 되돌아가는지 본다.
