# 논리명 구분자 + 상대 필드 적용 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 논리명 저장값에 단어 구분자(`_`)를 넣고, 편집 패널의 `↻` 2개를 「상대 필드를 내 값으로 채우는」 화살표 2개로 바꾼다.

**Architecture:** `NamingRules`에 `logicalSeparator`를 더해 분해·조립·후보 산출·경고가 그것을 공유한다. 구분자 없는 기존 논리명은 split 토큰을 그리디로 재분해하는 폴백으로 지금과 같은 결과를 내고 경고만 새로 뜬다. 용어는 저장값을 건드리지 않고 비교할 때 구분자를 벗겨 맞춘다(공용 라이브러리 호환).

**Tech Stack:** TypeScript · zod · vitest · React 19 · zustand · tRPC 11 · drizzle(jsonb)

**설계 문서:** `docs/superpowers/specs/2026-08-15-logical-name-separator-design.md` — 결정의 근거는 그쪽에 있다.

## Global Constraints

- **마이그레이션 없음.** `projects.naming_rules`는 jsonb라 컬럼 변경이 필요 없다. 기본값은 **읽기 시점 파싱**으로 주입한다(Task 7). DB 스키마 파일을 고치면 범위를 넘은 것이다.
- **용어·단어의 저장값을 바꾸지 않는다.** 마이그레이션도, 일괄 변환도 없다(설계 D4·6절).
- **응답·커밋 메시지·주석·문서는 한국어.**
- **커밋은 경로 지정.** `git add -A` / `git commit -a` 금지. `git add <경로들> && git commit ...`를 한 명령에 붙인다.
- 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```
- **테스트 기준선(시작 시점):** `core 646 · cli 138 · web 860 · server 196 · typecheck EXIT=0`.
- **typecheck는 종료코드로 판정한다.** `pnpm -r typecheck; echo "EXIT=$?"`. `-s`는 오류가 있어도 출력이 0바이트고, 파이프를 붙이면 `$?`가 tail 것이 된다.
- 🔥 **`. ./.env` 로 verify 를 돌리지 마라 — 개발 DB가 통째로 날아간다.** 이 트랙은 **서버 테스트가 필요하다**(Task 7). 반드시 격리 test DB를 명시해서 준다:
  ```bash
  DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
  ```
  없으면 만들고 마이그레이션을 적용한다:
  ```bash
  docker exec -i erdd-db-1 createdb -U postgres erdd_test_a
  DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec drizzle-kit migrate
  ```
- **작업 디렉터리는 워크트리다.** 최상위 체크아웃에서 파일을 고치지 않는다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/core/src/naming.ts` | `logicalSeparator` · `NamingRulesSchema` · 정규화 2종 · 분해/조립/후보 | 수정 |
| `packages/core/src/naming.test.ts` | 위 전부 | 수정 |
| `packages/core/src/warnings.ts` | `missing-logical-separator` | 수정 |
| `packages/core/src/warnings.test.ts` | 위 경고 | 수정 |
| `packages/core/src/index.ts` | 신규 심볼 재export | 수정 |
| `apps/server/src/routers/project.ts` | 손-미러 zod 제거 + jsonb 파싱 | 수정 |
| `apps/server/src/routers/project.test.ts` | 키 없는 행 → 기본값 | 수정 |
| `packages/cli/src/config.ts` | `logicalSeparator` 옵셔널 | 수정 |
| `apps/web/src/editor/name-pair.tsx` | 화살표 2개 · 덮어쓰기 정책 | 수정 |
| `apps/web/src/editor/name-pair.test.tsx` | 4경로 전수 | 수정 |
| `apps/web/src/editor/naming-check.tsx` | `KIND_LABEL` | 수정 |
| `apps/web/src/pages/project-settings.tsx` | 논리명 구분자 토글 | 수정 |
| `apps/web/src/pages/project-settings.test.tsx` | 토글 | **신설** |
| `docs/13-naming.md` · `docs/manual/user-guide.md` · 직전 설계 · `HANDOFF.md` | 문서 | 수정 |

---

## Task 1: `NamingRules` 확장과 `NamingRulesSchema`

**Files:**
- Modify: `packages/core/src/naming.ts:3-4`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NamingRules = {
    case: 'UPPER_SNAKE' | 'lower_snake'
    separator: '_' | ''
    logicalSeparator: '_' | ''
    maxLengthBytes: number
  }
  export const NamingRulesSchema: z.ZodType<NamingRules>   // logicalSeparator 에 .default('_')
  ```

⚠️ **이 태스크는 저장소 전역의 타입을 깨뜨린다.** `NamingRules` 리터럴을 인라인으로 만드는 곳이 전부 컴파일 오류가 된다. Step 3에서 **한 번에** 고친다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/naming.test.ts` 끝에 추가:

```ts
describe('NamingRulesSchema', () => {
  it('logicalSeparator 가 없는 옛 값에 기본값 _ 를 주입한다', () => {
    // 기존 projects.naming_rules jsonb 의 실제 모양이다(2026-08-15 실측).
    const legacy = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }
    expect(NamingRulesSchema.parse(legacy)).toEqual({
      case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
    })
  })

  it('명시된 logicalSeparator 는 그대로 둔다', () => {
    const given = { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30 }
    expect(NamingRulesSchema.parse(given).logicalSeparator).toBe('')
  })

  it('DEFAULT_NAMING_RULES 는 스키마를 만족한다', () => {
    expect(NamingRulesSchema.parse(DEFAULT_NAMING_RULES)).toEqual(DEFAULT_NAMING_RULES)
  })

  it('잘못된 값은 거부한다', () => {
    expect(() => NamingRulesSchema.parse({ case: 'X', separator: '_', maxLengthBytes: 30 })).toThrow()
    expect(() => NamingRulesSchema.parse({
      case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '-', maxLengthBytes: 30,
    })).toThrow()
  })
})
```

import 줄에 `NamingRulesSchema`를 더한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
```
기대: `NamingRulesSchema is not defined`로 4건 FAIL.

- [ ] **Step 3: 구현하고 깨진 리터럴을 전부 고친다**

`packages/core/src/naming.ts` 1-4행을 교체한다:

```ts
import { z } from 'zod'
import type { Word, Term } from './model.js'

export type NamingRules = {
  case: 'UPPER_SNAKE' | 'lower_snake'
  /** 물리명 토큰 구분자. 약어를 잇는다. */
  separator: '_' | ''
  /**
   * 논리명 단어 구분자. 물리명과 **별도 축**이다 — 한글 논리명과 영문 약어는 구분자 정책이
   * 다를 이유가 충분하고, 공유하면 물리명 규칙을 바꾸는 순간 논리명 저장값 전체가 규칙 위반이
   * 된다(설계 D1).
   */
  logicalSeparator: '_' | ''
  maxLengthBytes: number
}

export const DEFAULT_NAMING_RULES: NamingRules = {
  case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
}

/**
 * 프로젝트 명명 규칙의 단일 스키마. 서버가 DB jsonb 를 이것으로 파싱해 **키가 없는 기존 행에
 * 기본값을 주입**한다(설계 3.6). 서버에 손으로 미러링한 zod 를 두지 않는다.
 */
export const NamingRulesSchema = z.object({
  case: z.enum(['UPPER_SNAKE', 'lower_snake']),
  separator: z.enum(['_', '']),
  logicalSeparator: z.enum(['_', '']).default('_'),
  maxLengthBytes: z.number().int().positive(),
})
```

`packages/core/src/index.ts`의 `naming.js` export 줄에 `NamingRulesSchema`를 더한다.

이제 **깨진 리터럴을 찾아 전부 고친다.** 빠짐없이 훑어야 한다:

```bash
grep -rn "maxLengthBytes:" packages apps --include=*.ts --include=*.tsx | grep -v "logicalSeparator"
```

각 자리에 `logicalSeparator: '_'`를 더한다(테스트 픽스처는 그 케이스의 의도에 맞춰 `''`를 쓸 수도 있으나, **이 태스크에서는 전부 `'_'`로 통일**한다 — 동작을 바꾸는 것은 뒤 태스크의 일이다).

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 신규 4건 PASS, `EXIT=0`. **typecheck 를 반드시 전 패키지로 돌린다** — 리터럴을 빠뜨린 곳이 여기서만 드러난다.

- [ ] **Step 5: 전체 스위트로 회귀를 본다**

```bash
pnpm -C packages/core test
pnpm -C apps/web test
pnpm -C packages/cli test
```
기대: 실패 0. **이 시점에는 동작이 하나도 바뀌지 않았다** — 필드만 늘었다. 빨간 것이 있으면 리터럴 수정에서 값을 잘못 넣은 것이다.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts packages/core/src/index.ts && \
git commit -m "feat(core): NamingRules 에 logicalSeparator 와 단일 zod 스키마를 더한다

논리명 구분자를 물리명과 별도 축으로 둔다. NamingRulesSchema 는 키가 없는 기존
jsonb 행에 기본값 _ 를 주입하는 자리이고, 서버의 손-미러 zod 를 대신한다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
⚠️ 리터럴을 고친 다른 파일이 있으면 **그 경로도 같은 커밋에 명시**한다(`git status`로 확인).

---

## Task 2: 용어 정규화 `stripLogicalSeparator` / `withLogicalSeparator`

**Files:**
- Modify: `packages/core/src/naming.ts` (`decomposeByWords` 아래)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Consumes: Task 1의 `NamingRules`, 기존 `decomposeByWords`
- Produces:
  ```ts
  export function stripLogicalSeparator(name: string, rules: NamingRules): string
  export function withLogicalSeparator(name: string, words: Record<string, Word>, rules: NamingRules): string
  ```

⚠️ `withLogicalSeparator`는 Task 3에서 `decomposeByWords`의 시그니처가 바뀌면 함께 손대야 한다. 이 태스크에서는 **현재 시그니처**(`(name, words)`)로 쓰고 Task 3이 인자를 넘긴다.

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
describe('논리명 구분자 정규화', () => {
  const w = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    w3: { id:'w3', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
  }

  it('strip 은 구분자를 벗긴다', () => {
    expect(stripLogicalSeparator('회원_주문_번호', DEFAULT_NAMING_RULES)).toBe('회원주문번호')
    expect(stripLogicalSeparator('회원주문번호', DEFAULT_NAMING_RULES)).toBe('회원주문번호')
  })

  it('strip 은 구분자가 없는 규칙에서 원본을 그대로 낸다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(stripLogicalSeparator('회원_주문', rules)).toBe('회원_주문')
  })

  it('with 는 세그먼트 경계마다 구분자를 넣는다', () => {
    expect(withLogicalSeparator('회원주문번호', w, DEFAULT_NAMING_RULES)).toBe('회원_주문_번호')
  })

  it('with 는 미매칭 구간도 세그먼트 하나로 취급한다', () => {
    // '쿠폰'은 사전에 없다 → 미매칭 세그먼트 하나 → 앞에 구분자가 붙는다
    expect(withLogicalSeparator('회원쿠폰', w, DEFAULT_NAMING_RULES)).toBe('회원_쿠폰')
  })

  it('with 는 이미 구분자가 있는 이름을 두 번 넣지 않는다', () => {
    expect(withLogicalSeparator('회원_주문', w, DEFAULT_NAMING_RULES)).toBe('회원_주문')
  })

  it('with 는 구분자가 없는 규칙에서 원본을 그대로 낸다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(withLogicalSeparator('회원주문번호', w, rules)).toBe('회원주문번호')
  })

  it('strip 과 with 는 왕복한다', () => {
    const withSep = withLogicalSeparator('회원주문번호', w, DEFAULT_NAMING_RULES)
    expect(stripLogicalSeparator(withSep, DEFAULT_NAMING_RULES)).toBe('회원주문번호')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts -t '논리명 구분자 정규화'
```
기대: `stripLogicalSeparator is not a function`으로 7건 FAIL.

- [ ] **Step 3: 구현한다**

`decomposeByWords` 아래에 추가:

```ts
/**
 * 비교용 — 논리명에서 구분자를 벗긴다.
 * 용어 매칭이 구분자 유무에 흔들리지 않게 한다(설계 D4). 용어 저장값은 공용 라이브러리에서
 * 내려오므로 이 프로젝트의 구분자 정책을 강요할 수 없다.
 */
export function stripLogicalSeparator(name: string, rules: NamingRules): string {
  return rules.logicalSeparator === '' ? name : name.split(rules.logicalSeparator).join('')
}

/**
 * 삽입용 — 사전으로 분해해 **세그먼트 경계마다** 구분자를 끼운다.
 * 미매칭 구간(word: null)도 세그먼트 하나로 취급하므로 그 앞뒤에 구분자가 붙는다.
 * 이미 구분자가 든 이름은 분해가 그 경계를 그대로 따르므로 두 번 들어가지 않는다.
 */
export function withLogicalSeparator(
  name: string, words: Record<string, Word>, rules: NamingRules,
): string {
  if (rules.logicalSeparator === '') return name
  const bare = stripLogicalSeparator(name.trim(), rules)
  if (bare === '') return name
  return decomposeByWords(bare, words).map((s) => s.text).join(rules.logicalSeparator)
}
```

`index.ts`에 두 이름을 더한다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
```
기대: 신규 7건 PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts packages/core/src/index.ts && \
git commit -m "feat(core): 논리명 구분자 정규화 두 함수를 더한다

용어는 저장값을 바꾸지 않고 비교할 때만 구분자를 벗긴다. 넣을 때는 사전 분해의
세그먼트 경계마다 끼운다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 3: `decomposeByWords` 가 구분자를 안다 (+ 폴백)

**Files:**
- Modify: `packages/core/src/naming.ts:16`
- Modify (호출처): `packages/core/src/naming.ts:44`·`:207`, `packages/core/src/excel-import.ts:261`, `packages/core/src/excel-sheets.ts:152`, `apps/web/src/editor/dict-edits.ts:93`
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Produces: `decomposeByWords(logicalName, words, rules)` — **세 번째 인자가 필수로 추가된다.**

⚠️ **기존 주석의 계약이 바뀐다.** *"세그먼트 text를 이어붙이면 trim된 원본 논리명이 복원된다"* 는 구분자가 있으면 성립하지 않는다(구분자가 빠진다). 주석을 함께 고친다.

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
describe('decomposeByWords 구분자', () => {
  const w = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    w3: { id:'w3', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
  }
  const texts = (name: string, rules = DEFAULT_NAMING_RULES) =>
    decomposeByWords(name, w, rules).map((s) => s.text)

  it('구분자로 쪼갠다', () => {
    expect(texts('회원_주문_번호')).toEqual(['회원', '주문', '번호'])
  })

  // ⚠️ 폴백이 없으면 기존 프로젝트 전체가 통째로 미등록 단어가 된다(설계 3.1 급소).
  it('구분자가 없는 옛 논리명은 그리디로 재분해한다', () => {
    expect(texts('회원주문번호')).toEqual(['회원', '주문', '번호'])
    expect(decomposeByWords('회원주문번호', w, DEFAULT_NAMING_RULES).every((s) => s.word !== null))
      .toBe(true)
  })

  it('구분자로 쪼갠 토큰 중 사전에 없는 것만 재분해한다', () => {
    // '회원주문'은 토큰으로는 사전에 없지만 그리디로는 갈린다. '쿠폰'은 어느 쪽으로도 없다.
    const segs = decomposeByWords('회원주문_쿠폰', w, DEFAULT_NAMING_RULES)
    expect(segs.map((s) => s.text)).toEqual(['회원', '주문', '쿠폰'])
    expect(segs.filter((s) => s.word === null).map((s) => s.text)).toEqual(['쿠폰'])
  })

  it('빈 토큰은 버린다', () => {
    expect(texts('회원__주문')).toEqual(['회원', '주문'])
    expect(texts('_회원_')).toEqual(['회원'])
  })

  it('구분자 없는 규칙에서는 기존 그리디 그대로다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(texts('회원주문번호', rules)).toEqual(['회원', '주문', '번호'])
    // 이 규칙에서는 _ 가 단어의 일부로 취급된다(기존 동작)
    expect(texts('회원_주문', rules)).toEqual(['회원', '_', '주문'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts -t 'decomposeByWords 구분자'
```
기대: 인자 개수 불일치로 TS 오류 또는 `['회원주문번호']` 같은 값 불일치 FAIL.

- [ ] **Step 3: 구현한다**

`naming.ts:16`의 함수를 교체한다(기존 본문은 `greedyDecompose`로 뽑아낸다):

```ts
/**
 * 논리명을 단어 세그먼트로 분해한다.
 *
 * rules.logicalSeparator 가 있으면 **구분자 split 이 1차**이고, 사전에 없는 토큰만
 * 최장일치 그리디로 재분해한다(폴백).
 *
 * ⚠️ 폴백이 이 함수의 급소다. 구분자가 없는 옛 논리명('회원주문번호')을 split 하면 토큰이
 * 하나이고 사전에 그런 단어는 없다 → 폴백이 없으면 **통째로 미등록 단어**가 되어 물리명 생성이
 * 죽고 칩에 이름 전체가 뜬다. 기존 프로젝트가 전부 그 꼴이 된다(설계 3.1).
 * 폴백 덕에 바뀌는 것은 경고 한 줄뿐이다.
 *
 * ⚠️ 계약 변경: 예전 주석은 "세그먼트 text 를 이어붙이면 원본이 복원된다"였지만, 구분자가 있으면
 * **구분자가 빠진 문자열**이 된다. 원본을 되살리려면 rules.logicalSeparator 로 join 해야 한다
 * (withLogicalSeparator 가 그것을 한다).
 */
export function decomposeByWords(
  logicalName: string, words: Record<string, Word>, rules: NamingRules,
): WordSegment[] {
  const name = logicalName.trim()
  if (name === '') return []
  if (rules.logicalSeparator === '') return greedyDecompose(name, words)

  const byName = new Map(Object.values(words).map((w) => [w.logicalName, w]))
  const segments: WordSegment[] = []
  for (const token of name.split(rules.logicalSeparator)) {
    if (token === '') continue           // '회원__주문'·'_회원_' 의 빈 토큰
    const hit = byName.get(token)
    if (hit) segments.push({ text: token, word: hit })
    else segments.push(...greedyDecompose(token, words))
  }
  return segments
}

/** 구분자 없는 이름을 최장일치 그리디로 분해한다. 예전 decomposeByWords 의 본문이다. */
function greedyDecompose(name: string, words: Record<string, Word>): WordSegment[] {
  const byLen = Object.values(words).slice().sort((a, b) => b.logicalName.length - a.logicalName.length)
  const segments: WordSegment[] = []
  let i = 0
  let pending = ''
  while (i < name.length) {
    const match = byLen.find((w) => w.logicalName.length > 0 && name.startsWith(w.logicalName, i))
    if (match) {
      if (pending) { segments.push({ text: pending, word: null }); pending = '' }
      segments.push({ text: match.logicalName, word: match })
      i += match.logicalName.length
    } else {
      pending += name[i]!; i += 1
    }
  }
  if (pending) segments.push({ text: pending, word: null })
  return segments
}
```

**호출처 5곳에 `rules`를 넘긴다:**

| 파일:행 | 넘길 값 |
|---|---|
| `naming.ts:44`(`generatePhysicalName`) | 이미 받는 `rules` |
| `naming.ts:207`(`logicalQuery`) | 호출자에서 `rules`를 받도록 인자 추가 |
| `naming.ts` `withLogicalSeparator` | 이미 받는 `rules` |
| `excel-import.ts:261` | 그 함수가 받는 `rules`(없으면 인자로 뚫는다) |
| `excel-sheets.ts:152` | 같음 |
| `apps/web/src/editor/dict-edits.ts:93` | 그 함수(`wordUsage` 계열)가 `rules`를 받도록 인자 추가 — **호출자도 함께 고친다** |

⚠️ `dict-edits.ts`의 함수에 `rules`를 뚫으면 `dict-panel.tsx`의 호출도 바뀐다. store의 `namingRules`를 넘긴다(`DEFAULT_NAMING_RULES`를 쓰지 마라 — 직전 사이클이 정확히 그 하드코딩을 닫았다).

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -r typecheck; echo "EXIT=$?"
pnpm -C packages/core test && pnpm -C apps/web test
```
기대: 신규 5건 PASS, `EXIT=0`, 전체 스위트 실패 0.

- [ ] **Step 5: 폴백이 진짜 잠기는지 실증한다**

`decomposeByWords`의 `else segments.push(...greedyDecompose(token, words))`를
`else segments.push({ text: token, word: null })`로 **잠시 바꾸고** 돌린다.

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts -t '옛 논리명은 그리디로'
```
기대: **FAIL**. 확인했으면 되돌리고 PASS를 확인한다. **결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts packages/core/src/excel-import.ts packages/core/src/excel-sheets.ts apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-panel.tsx && \
git commit -m "feat(core): 논리명 분해가 구분자를 1차로 쓰고 옛 이름은 그리디로 되돌린다

구분자가 없는 기존 논리명이 통째로 미등록 단어가 되지 않도록, split 토큰 중 사전에
없는 것만 최장일치로 재분해한다. 바뀌는 것은 경고 한 줄뿐이다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
⚠️ 실제로 고친 파일만 경로에 적는다(`git status`로 확인).

---

## Task 4: `generatePhysicalName` · `restoreLogicalName`

**Files:**
- Modify: `packages/core/src/naming.ts:36-50`(생성)·`:70-112`(복원)
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Consumes: Task 2의 `stripLogicalSeparator`·`withLogicalSeparator`
- Produces: 시그니처 변경 없음. **동작만** 바뀐다.

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
describe('구분자와 용어', () => {
  const w = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    w3: { id:'w3', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
  }
  // ⚠️ 용어 저장값에는 구분자가 없다 — 공용 라이브러리에서 내려온 모양이다(설계 D4).
  const t = {
    t1: { id:'t1', logicalName:'회원주문번호', physicalName:'MBR_ORD_NO', domainId:'d1', description:null, origin:null },
  }

  it('구분자가 든 논리명이 구분자 없는 용어와 매칭된다', () => {
    const r = generatePhysicalName('회원_주문_번호', w, t, DEFAULT_NAMING_RULES)
    expect(r.physicalName).toBe('MBR_ORD_NO')
    expect(r.termId).toBe('t1')
    expect(r.domainId).toBe('d1')
  })

  it('구분자 없는 논리명도 여전히 같은 용어와 매칭된다', () => {
    expect(generatePhysicalName('회원주문번호', w, t, DEFAULT_NAMING_RULES).termId).toBe('t1')
  })

  it('용어가 없으면 분해 조합으로 떨어진다', () => {
    expect(generatePhysicalName('회원_주문', w, {}, DEFAULT_NAMING_RULES).physicalName).toBe('MBR_ORD')
  })

  it('복원은 구분자를 넣어 조립한다', () => {
    const r = restoreLogicalName('MBR_ORD_NO', w, {}, DEFAULT_NAMING_RULES)
    expect(r.ok && r.logicalName).toBe('회원_주문_번호')
  })

  it('용어 물리명이 일치하면 용어 논리명을 구분자 형식으로 변환해 낸다', () => {
    const r = restoreLogicalName('MBR_ORD_NO', w, t, DEFAULT_NAMING_RULES)
    // 용어 저장값은 '회원주문번호' 이지만 넣을 때는 변환된다
    expect(r.ok && r.logicalName).toBe('회원_주문_번호')
  })

  it('구분자 없는 규칙에서는 기존 동작 그대로다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    const r = restoreLogicalName('MBR_ORD_NO', w, {}, rules)
    expect(r.ok && r.logicalName).toBe('회원주문번호')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts -t '구분자와 용어'
```
기대: 용어 매칭 실패(`termId` undefined)와 복원 조립(`회원주문번호`)에서 FAIL.

- [ ] **Step 3: 구현한다**

`generatePhysicalName`의 1단계 용어 매칭을 고친다:

```ts
  // 1) 용어 완전일치 — 양쪽에서 구분자를 벗겨 비교한다(설계 D4).
  const bare = stripLogicalSeparator(name, rules)
  const term = Object.values(terms).find(
    (t) => stripLogicalSeparator(t.logicalName.trim(), rules) === bare)
```

`restoreLogicalName`의 1단계와 조립부를 고친다:

```ts
  // 1) 용어 물리명 완전일치 — 넣을 때는 구분자 형식으로 변환한다.
  const term = Object.values(terms).find((t) => t.physicalName.trim().toUpperCase() === upper)
  if (term) return { ok: true, logicalName: withLogicalSeparator(term.logicalName, words, rules) }
```

두 조립 지점(2-a의 `join('')`, 2-b의 `parts.join('')`)을 `join(rules.logicalSeparator)`로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -C packages/core test
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
```
기대: 신규 6건 PASS. ⚠️ **기존 케이스가 빨개질 수 있다** — `restoreLogicalName`이 이제 구분자를 넣으므로 `DEFAULT_NAMING_RULES`로 돌던 옛 단언(`'회원주문번호'`)이 어긋난다. **그것은 의도된 변경이다.** 해당 케이스의 기댓값을 새 동작으로 고치되, **구분자 없는 규칙을 쓰는 대조군 케이스를 하나 남겨** 옛 경로가 살아 있음을 잠근다.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts && \
git commit -m "feat(core): 용어 매칭은 구분자를 무시하고 복원은 구분자를 넣는다

용어 저장값은 그대로 두고 비교할 때만 벗긴다 — 공용 라이브러리에서 내려온 용어에
프로젝트 구분자 정책을 강요할 수 없다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 5: `suggestCompletions` 쿼리 산출

**Files:**
- Modify: `packages/core/src/naming.ts:206`(`logicalQuery`)와 용어 후보 `insert`
- Test: `packages/core/src/naming.test.ts`

**Interfaces:**
- Produces: 시그니처 변경 없음. 논리명 쿼리가 구분자 기반이 되고, 용어 후보 `insert`가 변환된 값이 된다.

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
describe('suggestCompletions 구분자', () => {
  const w = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    w3: { id:'w3', logicalName:'주소', abbreviation:'ADDR', englishName:null, description:null, origin:null },
  }
  const t = {
    t1: { id:'t1', logicalName:'회원주문번호', physicalName:'MBR_ORD_NO', domainId:null, description:null, origin:null },
  }

  it('논리명 쿼리는 마지막 구분자 뒤 토큰이다', () => {
    const r = suggestCompletions('회원_주', 'logical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('주')
    expect(r.items.map((i) => i.insert)).toEqual(['주문', '주소'])
    expect('회원_주'.slice(0, r.items[0]!.start) + r.items[0]!.insert).toBe('회원_주문')
  })

  // 사전에 없는 단어가 껴도 구분자가 경계를 못박는다 — 그리디 추측에 기대지 않는다
  it('앞 토큰이 미등록이어도 꼬리 쿼리가 흔들리지 않는다', () => {
    const r = suggestCompletions('쿠폰_주', 'logical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('주')
    expect(r.items.map((i) => i.insert)).toEqual(['주문', '주소'])
  })

  it('구분자로 딱 끝나면 쿼리가 비어 단어 후보를 내지 않는다', () => {
    const r = suggestCompletions('회원_', 'logical', w, {}, DEFAULT_NAMING_RULES)
    expect(r.query).toBe('')
    expect(r.items.filter((i) => i.kind === 'word')).toEqual([])
  })

  it('용어 후보는 구분자 형식으로 변환돼 들어간다', () => {
    const r = suggestCompletions('회원_주', 'logical', w, t, DEFAULT_NAMING_RULES)
    const term = r.items.find((i) => i.kind === 'term')
    expect(term?.insert).toBe('회원_주문_번호')   // 저장값은 '회원주문번호'
    expect(term?.start).toBe(0)
  })

  it('용어는 구분자를 무시하고 입력 전체로 찾는다', () => {
    // 입력에 구분자가 있어도 용어 저장값(구분자 없음)과 접두가 맞아야 한다
    const r = suggestCompletions('회원_주문', 'logical', w, t, DEFAULT_NAMING_RULES)
    expect(r.items.some((i) => i.kind === 'term')).toBe(true)
  })

  it('구분자 없는 규칙에서는 기존 그리디 쿼리 그대로다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    const r = suggestCompletions('회원주', 'logical', w, {}, rules)
    expect(r.query).toBe('주')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts -t 'suggestCompletions 구분자'
```
기대: 용어 `insert`가 `'회원주문번호'`로 나오고, `'쿠폰_주'`의 쿼리가 `'쿠폰_주'`로 나와 FAIL.

- [ ] **Step 3: 구현한다**

`logicalQuery`를 고친다:

```ts
/**
 * 논리명의 미매칭 꼬리.
 * 구분자가 있으면 **마지막 구분자 뒤 토큰**이다 — 물리명 쪽(physicalQuery)과 같은 방식이고,
 * 사전에 없는 단어가 껴도 경계가 흔들리지 않는다. 없으면 그리디 분해의 마지막 미매칭 세그먼트다.
 */
function logicalQuery(input: string, words: Record<string, Word>, rules: NamingRules): string {
  if (rules.logicalSeparator !== '') {
    const idx = input.lastIndexOf(rules.logicalSeparator)
    const tail = idx === -1 ? input : input.slice(idx + rules.logicalSeparator.length)
    // 꼬리가 통째로 사전 단어면 더 칠 것이 없다(단어 후보를 열지 않는다).
    return Object.values(words).some((w) => w.logicalName === tail) ? '' : tail
  }
  const segments = decomposeByWords(input, words, rules)
  const last = segments[segments.length - 1]
  return last && last.word === null ? last.text : ''
}
```

호출부(`suggestCompletions` 안)에 `rules`를 넘긴다.

용어 후보 루프에서 `insert`를 변환한다:

```ts
  for (const t of Object.values(terms)) {
    const target = side === 'logical' ? t.logicalName : t.physicalName
    // 논리명 쪽은 입력에 구분자가 있을 수 있으므로 양쪽을 벗겨 비교한다(설계 D4).
    const probe = side === 'logical' ? stripLogicalSeparator(input, rules) : input
    if (!startsWithFold(target, probe, side) || foldEq(target, probe, side)) continue
    push(termItems, {
      insert: side === 'logical' ? withLogicalSeparator(target, words, rules) : target,
      hint: side === 'logical' ? t.physicalName : t.logicalName,
      kind: 'term', start: 0,
    })
  }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/naming.test.ts
pnpm -C packages/core test
pnpm -s -C packages/core typecheck; echo "EXIT=$?"
```
기대: 신규 6건 PASS, 기존 `suggestCompletions` 케이스 유지(그 픽스처는 구분자 없는 입력을 쓴다).

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/naming.ts packages/core/src/naming.test.ts && \
git commit -m "feat(core): 논리명 자동완성 쿼리를 구분자 기준으로 끊는다

사전에 없는 단어가 껴도 경계가 흔들리지 않는다. 용어 후보는 구분자 형식으로 변환해
넣는다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 6: 새 경고 `missing-logical-separator`

**Files:**
- Modify: `packages/core/src/warnings.ts:8`(union)·`:85-118`(검사)·`:27`(`findMatchingTerm`)
- Modify: `apps/web/src/editor/naming-check.tsx`(`KIND_LABEL`)
- Test: `packages/core/src/warnings.test.ts`

**Interfaces:**
- Consumes: Task 2·3의 정규화·분해
- Produces: `Warning['kind']`에 `'missing-logical-separator'` 추가

HANDOFF 3.14의 등록처를 따른다 — union · 검사 로직 · `KIND_LABEL`(타입이 강제한다) · 기존 픽스처 영향.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/core/src/warnings.test.ts`에 추가:

```ts
describe('missing-logical-separator', () => {
  const words = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
  }
  const modelWith = (logicalName: string) => {
    const m = createEmptyModel()
    m.words = words
    m.tables['t1'] = {
      id:'t1', logicalName, physicalName:'MBR_ORD', comment:null, groupId:null,
      position:{x:0,y:0}, groupPosition:null, custom:{},
    }
    return m
  }
  const kinds = (name: string, rules = DEFAULT_NAMING_RULES) =>
    computeWarnings(modelWith(name), rules).map((w) => w.kind)

  it('구분자 없이 두 단어 이상이면 경고한다', () => {
    expect(kinds('회원주문')).toContain('missing-logical-separator')
  })

  it('구분자가 있으면 경고하지 않는다', () => {
    expect(kinds('회원_주문')).not.toContain('missing-logical-separator')
  })

  // ⚠️ 이것이 없으면 단일 단어 논리명 전부에 경고가 붙어 신호가 죽는다(설계 3.5).
  it('단일 단어에는 경고하지 않는다', () => {
    expect(kinds('회원')).not.toContain('missing-logical-separator')
  })

  it('사전에 없어 한 덩어리로 남는 이름에는 경고하지 않는다', () => {
    expect(kinds('쿠폰')).not.toContain('missing-logical-separator')
  })

  it('구분자 없는 규칙에서는 경고하지 않는다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(kinds('회원주문', rules)).not.toContain('missing-logical-separator')
  })

  it('rules 를 주지 않으면 계산하지 않는다', () => {
    expect(computeWarnings(modelWith('회원주문')).map((w) => w.kind))
      .not.toContain('missing-logical-separator')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/warnings.test.ts -t 'missing-logical-separator'
```
기대: 첫 케이스가 FAIL(경고가 없다).

- [ ] **Step 3: 구현한다**

`warnings.ts:8`의 union에 `| 'missing-logical-separator'`를 더한다.

`findMatchingTerm`을 구분자 무시로 고친다(Task 4와 같은 정책):

```ts
function findMatchingTerm(
  logicalName: string, terms: Record<string, Term>, rules: NamingRules,
): Term | undefined {
  const bare = stripLogicalSeparator(logicalName.trim(), rules)
  return Object.values(terms).find(
    (t) => stripLogicalSeparator(t.logicalName.trim(), rules) === bare)
}
```
호출부(`:99`)에 `rules`를 넘긴다.

`checkNamingEntity`의 `if (logical !== '')` 블록 안에 검사를 더한다:

```ts
        // 구분자가 의미를 갖는 것은 단어가 둘 이상일 때뿐이다 — 단일 단어에까지 붙이면
        // 경고가 노이즈가 되어 신호가 죽는다(설계 3.5).
        if (rules.logicalSeparator !== '' && !logical.includes(rules.logicalSeparator)) {
          const segments = decomposeByWords(logical, model.words, rules)
          if (segments.length >= 2) {
            warnings.push({
              kind: 'missing-logical-separator', scope, entityId, tableId,
              message: `논리명 "${logical}"에 단어 구분자(${rules.logicalSeparator})가 없습니다`
                + ` — "${segments.map((s) => s.text).join(rules.logicalSeparator)}"`,
            })
          }
        }
```

`apps/web/src/editor/naming-check.tsx`의 `KIND_LABEL`에 항목을 더한다(`Record<Warning['kind'], string>`이라 **빠뜨리면 web typecheck가 깨진다**):

```ts
  'missing-logical-separator': '논리명 구분자 없음',
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/core exec vitest run src/warnings.test.ts
pnpm -C packages/core test && pnpm -C apps/web test
pnpm -r typecheck; echo "EXIT=$?"
```
기대: 신규 6건 PASS.

⚠️ **기존 픽스처가 새 경고를 낳아 다른 케이스가 빨개질 수 있다**(HANDOFF 3.14의 4번 — `required-empty` 추가 때 실제로 있었다). 경고 **개수**를 단언하는 케이스가 특히 그렇다. 빨개진 것은 픽스처의 논리명에 구분자를 넣거나 그 케이스의 기댓값을 고쳐 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/warnings.ts packages/core/src/warnings.test.ts apps/web/src/editor/naming-check.tsx && \
git commit -m "feat(core): 구분자 없는 논리명에 경고를 띄운다

단어가 둘 이상으로 분해될 때만 띄운다 — 단일 단어에까지 붙이면 신호가 죽는다.
용어 매칭도 같은 정규화를 쓰도록 findMatchingTerm 을 맞췄다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 7: 서버 — 손-미러 제거와 jsonb 파싱

**Files:**
- Modify: `apps/server/src/routers/project.ts:11-15`(손-미러)·`:70`(get)
- Test: `apps/server/src/routers/project.test.ts`

**Interfaces:**
- Consumes: Task 1의 `NamingRulesSchema`

⚠️ **이번 파급의 급소다.** 지금 `get`은 DB jsonb를 **파싱 없이** 그대로 내보내므로, 키가 없는 기존 행은 `logicalSeparator: undefined`인 채 클라이언트에 도착한다. 설계 D3(기존 프로젝트도 `'_'`)가 성립하는 유일한 지점이다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`apps/server/src/routers/project.test.ts`의 `describe.skipIf(!url)('project', ...)` 안에 추가한다.
⚠️ **이 파일은 tRPC caller 가 아니라 HTTP inject 방식이다** — 기존 `post`/`get` 헬퍼와 `createProject()`를
그대로 쓰고, DB 는 `app.db!` 로 접근한다.

```ts
  it('logicalSeparator 키가 없는 기존 행에 기본값을 주입해 내려준다', async () => {
    const projectId = await createProject()
    // 마이그레이션 이전 모양으로 되돌린다(2026-08-15 실측한 실제 jsonb).
    await app.db!.update(projects)
      .set({ namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 } as never })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('_')
  })

  it('명시된 logicalSeparator 는 그대로 내려준다', async () => {
    const projectId = await createProject()
    await app.db!.update(projects)
      .set({ namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30 } })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('')
  })

  it('update 로 logicalSeparator 를 바꿀 수 있다', async () => {
    const projectId = await createProject()
    const res = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30 },
    })
    expect(res.statusCode).toBe(200)
    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('')
  })
```

import 에 `eq`(drizzle-orm)와 `projects`(`../db/schema.js`)를 더한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec vitest run src/routers/project.test.ts
```
기대: 첫 케이스가 `undefined`로 FAIL.

⚠️ **`20 passed | 174 skipped` 같은 결과가 나오면 `DATABASE_URL`이 안 먹은 것이다** — 그때는 통과가 아니라 미실행이다.

- [ ] **Step 3: 구현한다**

`project.ts`의 손-미러를 지우고 core 스키마를 쓴다:

```ts
import { DEFAULT_NAMING_RULES, DIALECTS, NamingRulesSchema } from '@erdd/core'
// const namingRulesSchema = z.object({ … })  ← 삭제
```

`get`(`:70`):

```ts
        // ⚠️ DB jsonb 를 스키마로 파싱해야 키가 없는 기존 행에 기본값이 주입된다(설계 3.6).
        // 파싱 없이 넘기면 logicalSeparator 가 undefined 인 채로 클라이언트에 도착한다.
        namingRules: NamingRulesSchema.parse(access.project.namingRules ?? DEFAULT_NAMING_RULES),
```

`update`의 입력(`:85`): `namingRules: NamingRulesSchema.optional()`.

- [ ] **Step 4: 통과를 확인한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec vitest run
pnpm -s -C apps/server typecheck; echo "EXIT=$?"
```
기대: 신규 3건 포함 전부 PASS, skip이 아닌 실제 실행.

- [ ] **Step 5: 주입이 진짜 잠기는지 실증한다**

`get`의 `NamingRulesSchema.parse(...)`를 `access.project.namingRules ?? DEFAULT_NAMING_RULES`로 **되돌리고** 돌린다.

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm -C apps/server exec vitest run src/routers/project.test.ts -t '기본값을 주입'
```
기대: **FAIL**. 확인 후 되돌리고 PASS를 확인한다. **결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/server/src/routers/project.ts apps/server/src/routers/project.test.ts && \
git commit -m "feat(server): 명명 규칙을 core 스키마로 파싱해 기본값을 주입한다

키가 없는 기존 jsonb 행에 logicalSeparator 기본값이 들어가는 유일한 자리다.
손으로 미러링하던 zod 를 지우고 core 의 NamingRulesSchema 를 쓴다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 8: CLI config 옵셔널

**Files:**
- Modify: `packages/cli/src/config.ts:50-55`(`readConfig`의 손-검증과 반환)
- Test: `packages/cli/src/config.test.ts`

**Interfaces:**
- Produces: 옛 `erdd.config.yaml`(키 없음)을 읽으면 `logicalSeparator: '_'`가 채워진다.

⚠️ **지금도 옛 config 가 「로드」는 된다** — `namingRules as unknown as NamingRules` 캐스트라 키가 없어도
통과한다. 문제는 그 값이 **`undefined`인 채로 core 함수에 흘러들어가** 분해가 조용히 그리디로 떨어지는
것이다. 검증을 필수로 만들지 말고 **읽은 뒤 채운다.**

- [ ] **Step 1: 실패 테스트를 쓴다**

`config.test.ts`의 `describe('config', …)` 안에 추가한다. 그 파일은 임시 디렉터리(`dir`)에 파일을 써서
`readConfig(dir)`를 부르는 방식이다.

```ts
  it('logicalSeparator 가 없는 옛 config 에 기본값을 채운다', async () => {
    // Task 1 이전에 writeConfig 가 내던 모양 그대로다.
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    const cfg = await readConfig(dir)
    expect(cfg.namingRules.logicalSeparator).toBe('_')
  })

  it('명시된 빈 logicalSeparator 는 그대로 둔다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30 },
    })
    expect((await readConfig(dir)).namingRules.logicalSeparator).toBe('')
  })
```

⚠️ 파일 상단의 `CONFIG` 상수도 Task 1 에서 `logicalSeparator: '_'`가 붙었을 것이다(안 붙었으면
typecheck 가 깨졌을 것이다). 「쓰고 읽으면 같다」 케이스가 그대로 통과하는지 확인한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C packages/cli exec vitest run src/config.test.ts
```
기대: 첫 케이스가 `undefined`로 FAIL.

- [ ] **Step 3: 구현한다**

`readConfig`의 손-검증(`:50-54`)은 **그대로 두고**(`logicalSeparator`를 필수로 요구하지 않는다),
반환 직전에 채운다:

```ts
  // 옛 config 에는 이 키가 없다. 필수로 요구하면 기존 사용자의 pull 이 깨지므로 여기서 채운다.
  // 명시적으로 빈 문자열을 적은 경우만 '' 이고 나머지(누락 포함)는 기본값 '_' 다.
  const logicalSeparator = namingRules['logicalSeparator'] === '' ? '' as const : '_' as const
  return {
    serverUrl, projectId, dialects,
    namingRules: { ...(namingRules as unknown as NamingRules), logicalSeparator },
  }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C packages/cli test
pnpm -s -C packages/cli typecheck; echo "EXIT=$?"
```

- [ ] **Step 5: 커밋**

```bash
git add packages/cli/src/config.ts packages/cli/src/config.test.ts && \
git commit -m "feat(cli): 옛 config 의 없는 logicalSeparator 를 기본값으로 채운다

필수로 요구하면 기존 사용자의 pull 이 깨진다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 9: 편집 패널 — 화살표 2개와 덮어쓰기 정책

**Files:**
- Modify: `apps/web/src/editor/name-pair.tsx`
- Test: `apps/web/src/editor/name-pair.test.tsx`

**Interfaces:**
- Produces: `NameField`의 `onRegenerate` prop이 **`onFillOther`로 바뀐다**(방향 반대). `↻` 관련 코드·테스트가 사라진다.

⚠️ **이 태스크는 직전 사이클(`48ea752`)의 산출물을 부분적으로 되돌린다.** `aria-label` 「물리명 재생성」/「논리명 재생성」에 걸린 케이스와 `↻` 포커스 잠금 2건이 화살표로 옮겨간다.

- [ ] **Step 1: 테스트를 새 동작으로 옮기고 4경로 전수를 더한다**

기존 `name-pair.test.tsx`에서 `'물리명 재생성'`·`'논리명 재생성'`을 쓰는 케이스를 찾아 이름과 의미를 바꾼다:

| 옛 | 새 |
|---|---|
| `getByRole('button', { name: '물리명 재생성' })` (물리명 칸) | `getByRole('button', { name: '논리명 채우기' })` (물리명 칸 — **채우는 대상이 반대**) |
| `getByRole('button', { name: '논리명 재생성' })` (논리명 칸) | `getByRole('button', { name: '물리명 채우기' })` |

⚠️ **의미가 뒤집히므로 기댓값도 함께 본다.** 예전 「논리명 칸의 ↻」는 *논리명*을 채웠는데, 이제 「논리명 칸의 화살표」는 *물리명*을 채운다. 같은 칸에서 같은 결과를 기대하던 케이스는 **다른 칸의 버튼**을 눌러야 한다.

그리고 덮어쓰기 4경로를 전수로 더한다:

```tsx
describe('상대 필드 적용 — 덮어쓰기 4경로', () => {
  // 물리명이 손으로 정해져 있고 논리명을 고치는 상황. 경로마다 물리명이 덮이는지 갈린다.
  const setup = () => loadModel({ logicalName: '회원', physicalName: 'MBR_X' })

  it('blur 는 이미 찬 상대를 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원_주문')
    await userEvent.tab()
    await waitFor(() =>
      expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원_주문'))
    expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_X')
  })

  it('Enter 는 덮는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원_주문{Enter}')
    await waitFor(() =>
      expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD'))
  })

  it('화살표 버튼은 덮는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원_주문')          // blur 하지 않는다
    await userEvent.click(screen.getByRole('button', { name: '물리명 채우기' }))
    await waitFor(() =>
      expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD'))
  })

  it('자동완성 확정은 상대 draft 를 바꾸되 커밋하지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원_주')
    await userEvent.click(await screen.findByRole('option', { name: /주문/ }))
    // 화면(draft)에는 반영된다
    expect((screen.getByLabelText(/물리명/) as HTMLInputElement).value).toBe('MBR_ORD')
    // 모델은 아직 그대로다
    expect(calls).toHaveLength(0)
    expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_X')
  })

  it('확정 뒤 blur 하면 두 필드가 한 뮤테이션으로 나간다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원_주')
    await userEvent.click(await screen.findByRole('option', { name: /주문/ }))
    await userEvent.tab()
    await waitFor(() => {
      const t = useEditorStore.getState().model.tables['t2']!
      expect(t.logicalName).toBe('회원_주문')
      expect(t.physicalName).toBe('MBR_ORD')
    })
    expect(calls).toHaveLength(1)
  })

  it('화살표를 눌러도 포커스가 입력란에 남는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    setup(); renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    logical.focus()
    await userEvent.click(screen.getByRole('button', { name: '물리명 채우기' }))
    expect(document.activeElement).toBe(logical)
  })
})
```

⚠️ `loadModel` 헬퍼의 사전에 `주문`/`ORD`가 있어야 한다(기존 헬퍼가 이미 넣는다). 논리명 픽스처를 **구분자 형식**으로 바꾸면 다른 케이스가 흔들릴 수 있으니 이 describe 안에서만 값을 준다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx
```
기대: 「물리명 채우기」 버튼이 없어 FAIL.

- [ ] **Step 3: 구현한다**

`NamePair`의 `regenerate`를 **방향을 뒤집어** `fillOther`로 바꾼다:

```tsx
  /**
   * 화살표 — **상대** 필드를 내 draft 기준으로 채운다. 덮어쓴다(설계 D6).
   * side 는 버튼이 놓인 칸이고, 채우는 대상은 그 반대다.
   */
  const fillOther = (side: 'logical' | 'physical') => {
    const patch: NamePatch = {}
    if (side === 'logical') {
      const gen = generatePhysicalName(draft.logicalName, words, terms, namingRules)
      if (!gen.physicalName) {
        toast.error(gen.unknownWords.length > 0
          ? `사전에 없는 단어: ${gen.unknownWords.join(', ')}`
          : '논리명이 비어 있어 물리명을 만들 수 없습니다')
        return
      }
      if (gen.physicalName !== physicalName) patch.physicalName = gen.physicalName
      if (draft.logicalName !== logicalName) patch.logicalName = draft.logicalName
    } else {
      const r = restoreLogicalName(draft.physicalName, words, terms, namingRules)
      if (!r.ok) {
        toast.error(r.unknownTokens.length > 0
          ? `등록되지 않은 약어: ${r.unknownTokens.join(', ')}`
          : '물리명이 비어 있어 논리명을 만들 수 없습니다')
        return
      }
      if (r.logicalName !== logicalName) patch.logicalName = r.logicalName
      if (draft.physicalName !== physicalName) patch.physicalName = draft.physicalName
    }
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'logical' ? '물리명 채우기' : '논리명 채우기')
  }
```

`commitSide`에 덮어쓰기 플래그를 더한다:

```tsx
  /**
   * 한쪽을 커밋한다. overwriteOther 면 상대를 덮고, 아니면 **비어 있을 때만** 채운다.
   * blur 만 false 다 — 필드를 스쳐 지나가기만 해도 발생하므로 손으로 정한 값이 날아가면 안 된다.
   */
  const commitSide = (side: 'logical' | 'physical', value: string, overwriteOther: boolean) => {
    const current = side === 'logical' ? logicalName : physicalName
    const otherDraft = side === 'logical' ? draft.physicalName : draft.logicalName
    const patch: NamePatch = side === 'logical' ? { logicalName: value } : { physicalName: value }
    const shouldFill = overwriteOther || otherDraft.trim() === ''
    if (shouldFill && value.trim() !== '') {
      if (side === 'logical') {
        const gen = generatePhysicalName(value, words, terms, namingRules)
        if (gen.physicalName) patch.physicalName = gen.physicalName
      } else {
        const r = restoreLogicalName(value, words, terms, namingRules)
        if (r.ok) patch.logicalName = r.logicalName
      }
    }
    if (value === current && Object.keys(patch).length === 1) return
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'logical' ? '논리명 변경' : '물리명 변경')
  }
```

**자동완성 확정 — 상대 draft만 갱신한다:**

```tsx
  /** 확정은 커밋이 아니다(이어서 칠 수 있어야 한다). 상대는 draft 만 바꾼다(설계 3.7). */
  const previewOther = (side: 'logical' | 'physical', value: string) => {
    if (value.trim() === '') return
    if (side === 'logical') {
      const gen = generatePhysicalName(value, words, terms, namingRules)
      if (gen.physicalName) setDraft((d) => ({ ...d, physicalName: gen.physicalName }))
    } else {
      const r = restoreLogicalName(value, words, terms, namingRules)
      if (r.ok) setDraft((d) => ({ ...d, logicalName: r.logicalName }))
    }
  }
```

`NameField`에서:
- `onRegenerate` → `onFillOther`로 이름과 아이콘을 바꾼다. 아이콘은 물리명 칸 `ArrowDown`, 논리명 칸 `ArrowUp`(lucide).
- `aria-label`은 **채우는 대상** 기준 — 물리명 칸은 「논리명 채우기」, 논리명 칸은 「물리명 채우기」.
- `onMouseDown={(e) => e.preventDefault()}`는 **유지**한다(포커스 유지가 실효다 — 직전 사이클이 계측으로 확정했다).
- 자동완성 `apply`에서 `props.onPreviewOther?.(next)`를 부른다.
- Enter 커밋은 `onCommit(value, true)`, blur는 `onCommit(value, false)`.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx src/editor/edit-panel.test.tsx
pnpm -C apps/web test
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
기대: 전부 PASS. `edit-panel.test.tsx`·`canvas.test.tsx`가 옛 버튼 이름을 쓰면 함께 고친다.

- [ ] **Step 5: 덮어쓰기 정책이 진짜 잠기는지 실증한다**

`commitSide`의 `const shouldFill = overwriteOther || otherDraft.trim() === ''`를
`const shouldFill = true`로 **잠시 바꾸고** 돌린다.

```bash
pnpm -C apps/web exec vitest run src/editor/name-pair.test.tsx -t 'blur 는 이미 찬 상대를 덮지 않는다'
```
기대: **FAIL**. 되돌린 뒤 PASS를 확인하고 **결과를 보고에 적는다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/editor/name-pair.tsx apps/web/src/editor/name-pair.test.tsx apps/web/src/editor/edit-panel.test.tsx && \
git commit -m "feat(web): 재생성 버튼을 상대 필드를 채우는 화살표로 바꾼다

버튼 넷을 두면 동작은 둘뿐이라 각 칸에 화살표 하나씩만 둔다. 덮어쓰기는 blur 만
제외한다 — 필드를 스쳐 지나가기만 해도 손으로 정한 값이 날아가면 안 된다.
자동완성 확정은 상대 draft 만 바꿔 이어서 칠 수 있게 두고, 커밋은 blur/Enter 때
두 필드가 함께 나간다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 10: 프로젝트 설정 — 논리명 구분자 토글

**Files:**
- Modify: `apps/web/src/pages/project-settings.tsx`
- Test: `apps/web/src/pages/project-settings.test.tsx` (**신설**)

**Interfaces:**
- Consumes: Task 7의 `project.update`

- [ ] **Step 1: 실패 테스트를 쓴다**

`project-settings.test.tsx` 신설. `apps/web/src/pages/org-detail.test.tsx`의 `renderOrg`(26행)를 본떠
`renderSettings`를 만든다 — 라우터(`useParams`로 `projectId`를 읽으므로 경로 파라미터가 필요하다) +
trpc provider + `mockTrpcFetch`.

`projectFixture`는 **이 파일에서 직접 만든다**(공용 헬퍼가 없다). `project.get` 응답 모양은
`apps/server/src/routers/project.ts`의 `get` 반환값과 같다 — 프로젝트 행 전체 + `namingRules` ·
`myRole` · `myOrgRole` · `canEdit` · `canManage`.

```tsx
  it('논리명 구분자 토글이 현재 값을 보여 준다', async () => {
    mockTrpcFetch({
      'project.get': () => ({ data: projectFixture({ logicalSeparator: '_' }) }),
    })
    renderSettings()
    expect(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).toBeChecked()
  })

  it('끄면 빈 구분자로 update 를 보낸다', async () => {
    const calls: any[] = []
    mockTrpcFetch({
      'project.get': () => ({ data: projectFixture({ logicalSeparator: '_' }) }),
      'project.update': (input) => { calls.push(input); return { data: { ok: true } } },
    })
    renderSettings()
    await userEvent.click(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].namingRules.logicalSeparator).toBe('')
    // 나머지 규칙은 그대로 실어 보낸다(부분 갱신이 아니라 객체 통째다)
    expect(calls[0].namingRules.separator).toBe('_')
  })

  it('관리 권한이 없으면 토글이 없다', async () => {
    mockTrpcFetch({
      'project.get': () => ({ data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }) }),
    })
    renderSettings()
    await screen.findByText(/설명 없음|프로젝트/)
    expect(screen.queryByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/pages/project-settings.test.tsx
```
기대: 체크박스가 없어 FAIL.

- [ ] **Step 3: 구현한다**

`ProjectSettingsPage`에 섹션을 더한다(`ProjectMembers` 위):

```tsx
{canManage && (
  <div className="grid gap-2">
    <h2 className="text-lg font-semibold">명명 규칙</h2>
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={p.namingRules.logicalSeparator === '_'}
        onChange={(e) => {
          const logicalSeparator = e.target.checked ? '_' as const : '' as const
          update.mutate({ projectId, namingRules: { ...p.namingRules, logicalSeparator } })
        }}
      />
      논리명을 밑줄로 구분
    </label>
    <p className="text-xs text-muted-foreground">
      켜면 논리명을 「회원_주문_번호」처럼 단어마다 밑줄로 나눠 적습니다.
      끄더라도 이미 저장된 논리명의 밑줄은 그대로 남습니다.
    </p>
  </div>
)}
```

`update` 뮤테이션과 성공 시 `project.get` 무효화를 더한다(`ProjectMembers`의 `invalidate` 패턴을 따른다).

⚠️ **`canManage`는 `p.canManage`를 쓴다.** 지금 `:109`가 역할 조합식을 손으로 재현하는데, 같은 응답에 `canManage`가 실려 온다(HANDOFF 이월 항목). **이 자리를 손대는 김에 한 줄로 교체하고 그 사실을 보고에 적는다.**

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm -C apps/web exec vitest run src/pages/project-settings.test.tsx
pnpm -C apps/web test
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/project-settings.tsx apps/web/src/pages/project-settings.test.tsx && \
git commit -m "feat(web): 프로젝트 설정에 논리명 구분자 토글을 넣는다

이번 사이클이 도입하는 규칙을 끄고 켜는 유일한 길이다. 나머지 명명 규칙 셋은
화면 없이 그대로 둔다. 겸사겸사 canManage 를 서버 응답 값으로 바꿨다.

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## Task 11: 문서와 최종 검증

**Files:**
- Modify: `docs/13-naming.md` · `docs/manual/user-guide.md`
- Modify: `docs/superpowers/specs/2026-08-14-naming-input-ux-design.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 기획·매뉴얼 문서를 고친다**

```bash
grep -n "재생성\|복원\|논리명" docs/13-naming.md | head -20
grep -n "재생성\|↻\|자동완성\|미등록" docs/manual/user-guide.md | head -20
```

- `docs/13-naming.md` — 논리명 구분자를 명명 체계의 일부로 적는다(분해 폴백과 용어 정규화 포함).
- `docs/manual/user-guide.md` — 버튼이 `↻` 2개에서 화살표 2개로 바뀐 것, 새 경고, 설정 토글. **화면 문구 인용(「」)이 어긋나는 자리를 전부 본다.**

- [ ] **Step 2: 직전 설계 문서를 갱신한다**

`docs/superpowers/specs/2026-08-14-naming-input-ux-design.md`의 3.2·3.3에서 `↻`를 서술한 부분에 **이번 사이클이 화살표 2개로 교체했다는 표시**를 남긴다. **그 문서를 지우거나 통째로 고치지 마라** — `preventDefault`의 인과를 계측으로 확정한 실증 기록이 거기 있고, 그것은 여전히 유효하다.

- [ ] **Step 3: 최종 검증**

```bash
pnpm -C packages/core test
pnpm -C packages/cli test
pnpm -C apps/web test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_a' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```
네 수를 실측해 적는다. 🔥 **`. ./.env` 금지.** 서버 스위트가 `20 passed | 174 skipped`면 미실행이다.

- [ ] **Step 4: HANDOFF 를 갱신한다**

1. **1절 완료 표**에 한 줄. 담을 것: `logicalSeparator`가 물리명과 별도 축인 이유, **분해 폴백이 없으면 기존 프로젝트가 통째로 미등록이 된다는 급소**, 용어는 저장값을 안 바꾸고 비교에서만 벗긴다는 것(공용 라이브러리 호환), **서버가 jsonb를 파싱해야 기본값이 주입된다는 것**, `↻` → 화살표 교체.
2. **3절 아키텍처 불변식**에 `logicalSeparator` 항목을 추가한다 — 「논리명 분해는 구분자 split 이 1차이고 사전에 없는 토큰만 그리디로 재분해한다」, 「용어 매칭은 항상 `stripLogicalSeparator` 를 거친다」.
3. **테스트 기준선**을 실측값으로 갱신하고 직전 기준선(`core 646 · cli 138 · web 860 · server 196`)과 함께 적는다.
4. **6절 이월 정리** — **닫히는 것:** 「core에 `NamingRulesSchema`(zod) export → server `project.ts`의 손-미러 제거」, 「`project-settings.tsx:109`의 역할 조합식이 이제 중복이다」. **새로 적는 것:** 기존 논리명 일괄 변환 도구 없음 · 명명 규칙 나머지 3개의 설정 UI 없음 · `↻`가 하던 「같은 칸에서 자기 필드 재생성」이 사라진 것.

- [ ] **Step 5: 커밋**

```bash
git add docs/13-naming.md docs/manual/user-guide.md docs/superpowers/specs/2026-08-14-naming-input-ux-design.md docs/superpowers/HANDOFF.md && \
git commit -m "docs: 논리명 구분자와 화살표 버튼을 문서에 반영한다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

## 브라우저 스모크 (병합 전, 확장이 하나뿐이라 사용자가 돈다)

단위 테스트가 잡지 못하는 것만 본다.

1. **기존 모델을 열었을 때 경고가 쏟아지는 모양**이 감당되는지(설계 D3가 의도한 것이지만 실제 개수를 봐야 안다).
2. 논리명에 `회원_주`를 치고 자동완성 목록이 뜨는지, **용어 후보가 `회원_주문_번호`로 변환돼** 보이는지.
3. 화살표 두 개의 방향이 헷갈리지 않는지(누른 칸의 **반대**가 채워진다).
4. 자동완성으로 확정했을 때 **상대 칸이 즉시 바뀌고**, Tab으로 빠져나가면 두 값이 함께 저장되는지.
5. 설정에서 토글을 끄면 경고가 사라지고 **저장된 논리명의 밑줄은 그대로 남는지.**
