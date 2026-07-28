# Excel 산출물/업로드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 모델을 감리 제출용 Excel 정의서(5시트)로 내보내고, 단어·용어·도메인 사전을 Excel로 일괄 등록할 수 있게 한다.

**Architecture:** 양식 정의·검증·중복 판정은 전부 `packages/core`의 순수 함수(`excel-sheets.ts`, `excel-import.ts`)에 두고, `.xlsx` 인코딩/디코딩만 `apps/web`이 exceljs 동적 `import()`로 담당한다(`generateDdl`(core) + 다운로드(web) 패턴과 동일). 내보내기 헤더 상수를 파서가 그대로 import해 "내보낸 파일을 다시 올릴 수 있다"는 왕복 계약이 컴파일 타임에 묶인다. 업로드는 기존 producer + `diffModels` 파이프라인을 타 Revision 1건·undo 1회로 원복된다.

**Tech Stack:** TypeScript pnpm 모노레포 / `packages/core`(zod, IO-free) + `apps/server`(Fastify·tRPC·drizzle·PostgreSQL) + `apps/web`(React 19·zustand·TanStack Query·vitest+jsdom·Testing Library) / **exceljs 4.4.0**(신규, web only)

**설계 문서:** [docs/superpowers/specs/2026-07-28-phase2-excel-import-export-design.md](../specs/2026-07-28-phase2-excel-import-export-design.md)

## Global Constraints

- `packages/core`는 **IO·런타임 의존성 free**. exceljs는 `apps/web`의 `dependencies`에만 넣고 **정적 import 금지 — 동적 `import()`만** 사용한다.
- **새 op 엔티티는 없다.** `ENTITY_KINDS`·`ENTITY_SCHEMAS`·`COLLECTION_BY_KIND`·`integrity.ts`·`TABLE_BY_KIND`·`KIND_LABEL`은 건드리지 않는다. 사전 업로드는 기존 `word`/`term`/`domain` 엔티티의 create/update op로만 나간다.
- `Word.englishName`은 `z.string().nullable().default(null)` — 옛 op 페이로드·옛 스냅샷 파싱 안전. 단 `z.infer` **출력 타입에서는 필수 키**이므로 모든 `Word` 리터럴에 채워야 한다(typecheck가 강제).
- 마이그레이션은 append-only. **격리 DB `erdd_dev_b`/`erdd_test_b`에만 적용**한다. 공유 `erdd`/`erdd_test`는 절대 건드리지 않는다(병합 시점에 코디네이터가 처리).
- 사전 덮어쓰기는 **기존 id를 유지한 update**. 새 id를 발급하면 `column.domainId` 참조가 끊긴다.
- 이벤트 값은 producer 진입 **전에** 캡처한다(`serializeMutation`이 producer를 마이크로태스크로 지연 실행 → lazy read 시 stale 값).
- UI 카피는 한국어. 커밋 메시지도 한국어이고 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
  ```
- **`git add .` / `git add -A` 금지** — 명시 파일만 스테이징. `.idea/*`와 루트 `.env`는 커밋하지 않는다.
- **`docs/superpowers/HANDOFF.md`와 `docs/91-checklist.md`는 수정하지 않는다**(코디네이터가 두 트랙 병합 후 일괄 갱신).
- 테스트 기준선: **core 146 · web 159 · server 52 · `pnpm -r typecheck` 0 errors.** 태스크마다 그린을 유지한다.
- 서버 테스트는 반드시 격리 DB로 돌린다:
  `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run`

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/core/src/model.ts` | `WordSchema.englishName` 추가 | 1 |
| `packages/core/src/naming.ts` | `decomposeByWords` 추출 + `generatePhysicalName` 위임 | 1 |
| `apps/web/src/editor/dict-edits.ts` | `usesWord`가 `decomposeByWords`에 위임(중복 알고리즘 제거) | 1 |
| `apps/server/src/db/schema.ts` + `drizzle/0007_*.sql` | `model_words.english_name` | 2 |
| `apps/server/src/services/model-store.ts` | words 매핑에 englishName | 2 |
| `packages/core/src/excel-sheets.ts` | **양식의 유일한 정의처.** 시트명·헤더 상수 + `buildExcelSheets` + `buildDictTemplateSheets` | 3 |
| `packages/core/src/excel-import.ts` | `planDictImport` — 행 파싱·검증·중복 판정. 모델은 바꾸지 않는다 | 4 |
| `packages/core/src/ddl.ts` | `ExportScope` 별칭 export | 3 |
| `apps/web/src/editor/excel-file.ts` | exceljs 동적 import로 `SheetData[]` ↔ `.xlsx` + 다운로드 | 5 |
| `apps/web/src/editor/export-scope-select.tsx` | DDL·Excel 공용 범위 선택기(그룹 드롭다운) | 6 |
| `apps/web/src/editor/export-dialog.tsx` | Excel 섹션 추가 + 범위 선택기 교체 | 6 |
| `apps/web/src/editor/dict-import-edits.ts` | `applyDictImport` producer | 7 |
| `apps/web/src/editor/dict-import-section.tsx` | 가져오기 UI(양식 다운로드·파일 선택·미리보기·적용) | 7 |
| `apps/web/src/editor/dict-panel.tsx` | 가져오기 섹션 통합 + 단어 폼 영문명 입력 | 7 |

---

## Task 1: core — Word 영문명 + 단어 분해 헬퍼

**Files:**
- Modify: `packages/core/src/model.ts` (WordSchema)
- Modify: `packages/core/src/naming.ts` (decomposeByWords 추출)
- Modify: `packages/core/src/index.ts` (export 추가)
- Modify: `apps/web/src/editor/dict-edits.ts` (usesWord 위임)
- Test: `packages/core/src/naming.test.ts`, `packages/core/src/model.test.ts`
- 타입 오류로 손봐야 하는 기존 파일(`Word` 리터럴): `packages/core/src/naming.test.ts`, `packages/core/src/op.test.ts`, `packages/core/src/warnings.test.ts`, `apps/server/src/services/model-store.ts`, `apps/server/src/services/model-store.test.ts`, `apps/server/src/routers/model.test.ts`, `apps/web/src/editor/dict-edits.test.ts`, `apps/web/src/editor/dict-panel.tsx`, `apps/web/src/editor/dict-panel.test.tsx`, `apps/web/src/editor/edit-panel.test.tsx`

**Interfaces:**
- Consumes: 기존 `Word`(`packages/core/src/model.ts`), `generatePhysicalName`(`naming.ts`)
- Produces:
  - `Word.englishName: string | null` — Task 2(server 매핑), Task 3(단어사전 시트), Task 4(파서), Task 7(사전 폼)이 사용
  - `export type WordSegment = { text: string; word: Word | null }`
  - `export function decomposeByWords(logicalName: string, words: Record<string, Word>): WordSegment[]` — Task 3의 용어사전 "구성 단어" 컬럼이 사용

- [ ] **Step 1: `decomposeByWords`의 실패하는 테스트를 쓴다**

`packages/core/src/naming.test.ts` 맨 아래에 추가한다. 파일 상단의 import를 `import { generatePhysicalName, decomposeByWords, DEFAULT_NAMING_RULES } from './naming.js'`로 바꾸고, 파일 상단 `words` 상수의 각 항목에 `englishName: null`을 추가한다(Step 3에서 스키마가 바뀌면 타입이 요구한다).

```ts
describe('decomposeByWords', () => {
  it('최장일치로 논리명을 단어 세그먼트로 나눈다', () => {
    const segs = decomposeByWords('회원상태코드', words)
    expect(segs.map((s) => s.text)).toEqual(['회원', '상태', '코드'])
    expect(segs.map((s) => s.word?.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('사전에 없는 구간은 연속으로 모아 word: null 세그먼트 하나가 된다', () => {
    const segs = decomposeByWords('회원쿠폰번호', words)
    expect(segs.map((s) => s.text)).toEqual(['회원', '쿠폰번호'])
    expect(segs.map((s) => s.word === null)).toEqual([false, true])
  })

  it('앞뒤 공백을 제거하고 분해한다', () => {
    expect(decomposeByWords('  회원  ', words).map((s) => s.text)).toEqual(['회원'])
  })

  it('빈 논리명이나 빈 사전은 빈 배열/미매칭 한 조각을 낸다', () => {
    expect(decomposeByWords('', words)).toEqual([])
    expect(decomposeByWords('회원', {})).toEqual([{ text: '회원', word: null }])
  })

  it('세그먼트 text를 이어붙이면 원본 논리명이 복원된다', () => {
    expect(decomposeByWords('회원쿠폰번호', words).map((s) => s.text).join('')).toBe('회원쿠폰번호')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/naming.test.ts`
Expected: FAIL — `decomposeByWords is not a function` (또는 import 해결 실패)

- [ ] **Step 3: `WordSchema`에 `englishName`을 추가한다**

`packages/core/src/model.ts`의 `WordSchema`를 바꾼다:

```ts
export const WordSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  abbreviation: z.string(),
  englishName: z.string().nullable().default(null),   // 회원 → MEMBER. 옛 페이로드 하위호환
  description: z.string().nullable(),
})
```

- [ ] **Step 4: `decomposeByWords`를 구현하고 `generatePhysicalName`이 그것에 위임하게 한다**

`packages/core/src/naming.ts` 전체를 아래로 교체한다. **동작은 기존과 완전히 동일해야 한다** — 기존 `generatePhysicalName` 테스트가 그대로 통과하는 것이 근거다.

```ts
import type { Word, Term } from './model.js'

export type NamingRules = { case: 'UPPER_SNAKE' | 'lower_snake'; separator: '_' | ''; maxLengthBytes: number }
export const DEFAULT_NAMING_RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }
export type GenResult = { physicalName: string; unknownWords: string[]; termId?: string; domainId?: string | null }

/** 논리명 분해 결과 한 조각. word가 null이면 사전에 없는 구간이다. */
export type WordSegment = { text: string; word: Word | null }

/**
 * 논리명을 단어 사전으로 최장일치 그리디 분해한다.
 * 매칭 실패 구간은 연속으로 모아 word: null 세그먼트 하나가 된다.
 * 세그먼트 text를 이어붙이면 trim된 원본 논리명이 복원된다.
 * generatePhysicalName의 2단계와 동일 알고리즘 — 그쪽이 이 함수를 호출한다.
 */
export function decomposeByWords(logicalName: string, words: Record<string, Word>): WordSegment[] {
  const name = logicalName.trim()
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

export function generatePhysicalName(
  logicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): GenResult {
  const name = logicalName.trim()
  // 1) 용어 완전일치
  const term = Object.values(terms).find((t) => t.logicalName.trim() === name)
  if (term) return { physicalName: term.physicalName, unknownWords: [], termId: term.id, domainId: term.domainId }
  // 2) 최장일치 분해조합
  const segments = decomposeByWords(name, words)
  const parts = segments.filter((s) => s.word !== null).map((s) => s.word!.abbreviation)
  const unknownWords = segments.filter((s) => s.word === null).map((s) => s.text)
  const joined = parts.join(rules.separator)
  const physicalName = rules.case === 'lower_snake' ? joined.toLowerCase() : joined.toUpperCase()
  return { physicalName, unknownWords }
}
```

- [ ] **Step 5: `index.ts`에 export를 추가한다**

`packages/core/src/index.ts`의 naming 줄을 바꾼다:

```ts
export { generatePhysicalName, decomposeByWords, DEFAULT_NAMING_RULES } from './naming.js'
export type { NamingRules, GenResult, WordSegment } from './naming.js'
```

- [ ] **Step 6: `englishName` 하위호환 테스트를 추가한다**

`packages/core/src/model.test.ts`에 추가한다(파일 상단 import에 `WordSchema`를 넣는다):

```ts
describe('WordSchema englishName', () => {
  it('englishName이 없는 옛 페이로드는 null로 파싱된다 (구 리비전 하위호환)', () => {
    const legacyWord = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null }
    expect(WordSchema.parse(legacyWord).englishName).toBeNull()
  })

  it('englishName 값을 그대로 보존한다', () => {
    const word = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null,
    }
    expect(WordSchema.parse(word)).toEqual(word)
  })
})
```

- [ ] **Step 7: core 테스트를 돌려 새 테스트가 통과하고 기존 naming 테스트가 깨지지 않았는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run`
Expected: PASS. `generatePhysicalName`의 기존 4개 테스트가 그대로 통과해야 한다(위임 리팩터링이 동작을 바꾸지 않았다는 증거). 실패하면 타입 오류가 난 `Word` 리터럴에 `englishName: null`을 채운다.

- [ ] **Step 8: `dict-edits.ts`의 중복 알고리즘을 제거한다**

`apps/web/src/editor/dict-edits.ts`에서 import에 `decomposeByWords`를 추가하고, `usesWord` 함수를 아래로 교체한다. **`matchesTermExactly` 단축은 그대로 유지**한다(용어 완전일치면 단어 분해를 거치지 않는다는 기존 의미).

```ts
/**
 * logicalName을 generatePhysicalName과 동일한 최장일치 규칙으로 분해했을 때
 * wordId에 해당하는 단어가 실제로 매치에 쓰였는지 판정한다.
 */
function usesWord(
  logicalName: string, wordId: string, words: Record<string, Word>, terms: Record<string, Term>,
): boolean {
  const name = logicalName.trim()
  if (name === '') return false
  if (matchesTermExactly(name, terms)) return false
  return decomposeByWords(name, words).some((s) => s.word?.id === wordId)
}
```

- [ ] **Step 9: 타입 오류가 난 모든 `Word` 리터럴에 `englishName`을 채운다**

Run: `pnpm -r typecheck`

`englishName`이 빠졌다고 나오는 곳마다 값을 채운다:
- `apps/server/src/services/model-store.ts` — words 매핑에 **임시로 `englishName: null`**을 넣는다. 이 시점에는 drizzle 스키마에 컬럼이 없어 `r.englishName`을 읽을 수 없다. Task 2에서 실제 컬럼을 읽게 바꾼다.
- `apps/web/src/editor/dict-panel.tsx`의 `WordEditDialog` 안 `createWord(m, { id, logicalName, abbreviation, description })` 호출에 **임시로 `englishName: null`**을 넣는다(입력란은 Task 7에서 붙인다). `updateWord`는 `Partial`을 받으므로 손대지 않는다.
- 나머지(테스트 fixtures·리터럴)는 `englishName: null`.
- `apps/server/src/routers/model.test.ts`의 `expect(...).toEqual({ id: wordId, logicalName: '주문', abbreviation: 'ORD', description: null })`은 `englishName: null`을 추가한 형태로 고친다 — **op 페이로드에는 englishName이 없는데 로드 결과에는 null이 들어간다는 하위호환 증거**가 된다.

Expected: `pnpm -r typecheck` → 0 errors

- [ ] **Step 10: 전 스위트를 돌려 그린을 확인한다**

Run:
```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 PASS. core는 146 → 153 근처(새 테스트 7개), web 159 유지, server 52 유지.

- [ ] **Step 11: 커밋**

```bash
git add packages/core/src/model.ts packages/core/src/naming.ts packages/core/src/index.ts \
  packages/core/src/naming.test.ts packages/core/src/model.test.ts packages/core/src/op.test.ts \
  packages/core/src/warnings.test.ts \
  apps/web/src/editor/dict-edits.ts apps/web/src/editor/dict-edits.test.ts \
  apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx \
  apps/web/src/editor/edit-panel.test.tsx \
  apps/server/src/services/model-store.ts apps/server/src/services/model-store.test.ts \
  apps/server/src/routers/model.test.ts
git commit -F - <<'EOF'
feat(core): 단어에 영문명 추가·단어 분해 헬퍼 추출

Word에 englishName(nullable, 기본 null)을 추가한다. Excel 단어사전 시트의
"영문명" 컬럼이 쓸 값이고, 옛 op 페이로드·옛 스냅샷은 null로 파싱된다.

논리명의 최장일치 그리디 분해를 decomposeByWords로 추출하고
generatePhysicalName이 그것에 위임한다. dict-edits.ts의 usesWord가 같은
알고리즘을 재구현하고 있었는데 이제 core 헬퍼를 쓴다 — 분해 규칙이 한 곳에만
존재한다. 용어사전 시트의 "구성 단어" 컬럼도 이 헬퍼를 쓴다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 2: server — `model_words.english_name` + 마이그레이션 0007

**Files:**
- Modify: `apps/server/src/db/schema.ts:116-122` (`modelWords`)
- Create: `apps/server/drizzle/0007_*.sql` (drizzle-kit이 생성)
- Modify: `apps/server/src/services/model-store.ts:88-91` (words 매핑)
- Test: `apps/server/src/services/model-store.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Word.englishName: string | null`
- Produces: DB에 저장·조회되는 `englishName`. Task 7의 사전 폼이 이 값을 저장한다.

- [ ] **Step 1: 실패하는 왕복 테스트를 쓴다**

`apps/server/src/services/model-store.test.ts` 맨 아래(마지막 `})` 앞)에 추가한다:

```ts
  it('단어의 englishName을 왕복 저장·조회한다', async () => {
    const base = withUuidIds(buildSampleModel())
    const wordId = uuidv7()
    const target: typeof base = {
      ...base,
      words: {
        [wordId]: {
          id: wordId, logicalName: '회원', abbreviation: 'MBR',
          englishName: 'MEMBER', description: '서비스 가입 주체',
        },
      },
    }
    await persistOps(app.db!, projectId, diffModels(createEmptyModel(), target))
    const loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.words[wordId]).toEqual(target.words[wordId])
  })

  it('englishName 없이 만든 단어는 null로 읽힌다 (구 리비전 하위호환)', async () => {
    const wordId = uuidv7()
    const legacyPayload = {
      id: wordId, logicalName: '주문', abbreviation: 'ORD', description: null,
    }
    // CreateOp.data는 unknown이라 englishName이 빠진 옛 페이로드를 그대로 넣을 수 있다.
    await persistOps(app.db!, projectId, [
      { action: 'create', entity: 'word', entityId: wordId, data: legacyPayload },
    ])
    const loaded = await loadProjectModel(app.db!, projectId)
    expect(loaded.words[wordId]?.englishName).toBeNull()
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run src/services/model-store.test.ts`
Expected: FAIL — 저장은 되지만 조회 결과의 `englishName`이 `null`(Task 1에서 임시로 하드코딩)이라 첫 테스트가 `'MEMBER'`와 불일치

- [ ] **Step 3: drizzle 스키마에 컬럼을 추가한다**

`apps/server/src/db/schema.ts`의 `modelWords`:

```ts
export const modelWords = pgTable('model_words', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  englishName: text('english_name'),
  description: text('description'),
})
```

- [ ] **Step 4: 마이그레이션을 생성한다**

Run: `pnpm --filter @erdd/server exec drizzle-kit generate`
Expected: `apps/server/drizzle/0007_*.sql`이 생기고 내용은 `ALTER TABLE "model_words" ADD COLUMN "english_name" text;` 한 줄. **다른 테이블 변경이 섞여 있으면 멈추고 원인을 확인한다.**

- [ ] **Step 5: 격리 DB 두 곳에만 마이그레이션을 적용한다**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_b'  pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec drizzle-kit migrate
```
Expected: 두 명령 모두 성공. **공유 `erdd`/`erdd_test`에는 절대 적용하지 않는다.**

- [ ] **Step 6: `model-store.ts`의 words 매핑을 실제 컬럼으로 바꾼다**

`apps/server/src/services/model-store.ts`의 words 매핑(Task 1에서 `englishName: null`로 임시 처리한 곳):

```ts
    words: keyed(wordRows.map((r): Word => ({
      id: r.id, logicalName: r.logicalName, abbreviation: r.abbreviation,
      englishName: r.englishName, description: r.description,
    }))),
```

- [ ] **Step 7: 서버 테스트를 돌려 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run`
Expected: PASS, 52 → 54

- [ ] **Step 8: 전 스위트 확인**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/src/services/model-store.ts \
  apps/server/src/services/model-store.test.ts apps/server/drizzle/
git commit -F - <<'EOF'
feat(server): model_words.english_name 컬럼·마이그레이션 0007

단어 영문명을 저장할 nullable 컬럼을 추가하고 loadProjectModel이 그것을
읽게 한다. 컬럼이 없던 시절 만들어진 단어는 null로 읽힌다.

마이그레이션은 격리 DB(erdd_dev_b/erdd_test_b)에만 적용했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 3: core — Excel 시트 빌더 (`excel-sheets.ts`)

**Files:**
- Create: `packages/core/src/excel-sheets.ts`
- Create: `packages/core/src/excel-sheets.test.ts`
- Modify: `packages/core/src/ddl.ts` (`ExportScope` 별칭)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1의 `decomposeByWords`, `Word.englishName`. 기존 `customFieldsFor`/`resolveCustomValue`(`custom-field.ts`), `DdlScope`(`ddl.ts`)
- Produces:
  - `export type ExportScope = DdlScope` (from `ddl.ts`) — Task 6이 사용
  - `export type ExcelSheetKey = 'tableList' | 'tableSpec' | 'words' | 'terms' | 'domains'`
  - `export const EXCEL_SHEET_KEYS: readonly ExcelSheetKey[]`
  - `export const EXCEL_SHEET_NAME: Record<ExcelSheetKey, string>` — Task 5(시트 찾기), Task 6(체크박스 라벨)이 사용
  - `export const WORD_HEADERS/TERM_HEADERS/DOMAIN_HEADERS` — Task 4가 import해 왕복 계약을 묶는다
  - `export type SheetData = { key: ExcelSheetKey; name: string; headers: string[]; rows: string[][] }` — Task 5가 인코딩
  - `export function buildExcelSheets(model, opts?: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[] }): SheetData[]`
  - `export function buildDictTemplateSheets(): SheetData[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/excel-sheets.test.ts`를 만든다:

```ts
import { describe, expect, it } from 'vitest'
import { buildSampleModel } from './testing/fixtures.js'
import type { ProjectModel } from './model.js'
import { buildDictTemplateSheets, buildExcelSheets, EXCEL_SHEET_NAME } from './excel-sheets.js'

/** 시트 key로 하나를 꺼낸다(없으면 테스트 실패를 유도하도록 undefined 반환). */
function sheetOf(sheets: ReturnType<typeof buildExcelSheets>, key: string) {
  return sheets.find((s) => s.key === key)
}

function richModel(): ProjectModel {
  const m = buildSampleModel()
  return {
    ...m,
    domains: {
      d1: {
        id: 'd1', name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
        defaultValue: "'01'", allowedValues: ['01', '02'], description: '회원 등급',
      },
    },
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null },
      w2: { id: 'w2', logicalName: '번호', abbreviation: 'NO', englishName: null, description: '순번' },
    },
    terms: {
      tm1: {
        id: 'tm1', logicalName: '회원번호', physicalName: 'MBR_NO',
        domainId: 'd1', description: '회원 식별자',
      },
    },
    customFields: {
      cf1: {
        id: 'cf1', name: '업무구분', target: 'table', type: 'text',
        options: [], required: false, defaultValue: '공통', order: 0,
      },
      cf2: {
        id: 'cf2', name: '개인정보여부', target: 'column', type: 'select',
        options: ['Y', 'N'], required: false, defaultValue: 'N', order: 0,
      },
    },
    columns: {
      ...m.columns,
      c1: { ...m.columns['c1']!, domainId: 'd1', custom: { cf2: 'Y' } },
    },
  }
}

describe('buildExcelSheets', () => {
  it('5개 시트를 고정 순서로 낸다', () => {
    const sheets = buildExcelSheets(buildSampleModel())
    expect(sheets.map((s) => s.key)).toEqual(['tableList', 'tableSpec', 'words', 'terms', 'domains'])
    expect(sheets.map((s) => s.name)).toEqual([
      '테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서',
    ])
  })

  it('테이블 목록: 그룹·논리명·물리명·설명을 그룹명→물리명 순으로 낸다', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableList')!
    expect(s.headers).toEqual(['그룹', '논리명', '물리명', '설명'])
    // 정렬은 (그룹명, 물리명) — MBR < MBR_GRD 이므로 t2(회원)가 먼저다.
    expect(s.rows).toEqual([
      ['회원관리', '회원', 'MBR', '서비스 가입 회원'],
      ['회원관리', '회원등급', 'MBR_GRD', ''],
    ])
  })

  it('테이블정의서: 컬럼마다 한 행, 순번은 테이블 안에서 1부터', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableSpec')!
    expect(s.headers).toEqual([
      '그룹', '테이블 논리명', '테이블 물리명', '순번', '논리명', '물리명',
      '도메인', '타입', 'PK', 'NOT NULL', '기본값', '설명',
    ])
    expect(s.rows).toHaveLength(4)
    expect(s.rows[0]).toEqual([
      '회원관리', '회원', 'MBR', '1', '회원번호', 'MBR_NO', '', 'BIGINT', 'Y', 'Y', '', '',
    ])
  })

  it('도메인 지정 컬럼은 도메인 이름·논리 타입·기본값을 따른다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'tableSpec')!
    const row = s.rows.find((r) => r[5] === 'GRD_CD' && r[2] === 'MBR_GRD')!
    expect(row[6]).toBe('등급코드')     // 도메인
    expect(row[7]).toBe('CHAR(2)')      // 타입
    expect(row[10]).toBe("'01'")        // 기본값(도메인 기본값 라이브 해석)
  })

  it('커스텀 항목을 정의 순서대로 컬럼으로 붙이고 미입력은 기본값으로 채운다', () => {
    const sheets = buildExcelSheets(richModel())
    const list = sheetOf(sheets, 'tableList')!
    expect(list.headers).toEqual(['그룹', '논리명', '물리명', '설명', '업무구분'])
    expect(list.rows.every((r) => r[4] === '공통')).toBe(true)

    const spec = sheetOf(sheets, 'tableSpec')!
    expect(spec.headers.at(-1)).toBe('개인정보여부')
    const withValue = spec.rows.find((r) => r[5] === 'GRD_CD' && r[2] === 'MBR_GRD')!
    expect(withValue.at(-1)).toBe('Y')                        // 입력값
    const withDefault = spec.rows.find((r) => r[5] === 'MBR_NO')!
    expect(withDefault.at(-1)).toBe('N')                      // 정의 기본값
  })

  it('커스텀 항목 정의가 없으면 추가 컬럼이 붙지 않는다', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableList')!
    expect(s.headers).toHaveLength(4)
  })

  it('단어사전: 논리명순으로 논리명·약어·영문명·설명을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'words')!
    expect(s.headers).toEqual(['논리명', '약어', '영문명', '설명'])
    expect(s.rows).toEqual([
      ['번호', 'NO', '', '순번'],
      ['회원', 'MBR', 'MEMBER', ''],
    ])
  })

  it('용어사전: 구성 단어를 매칭·미매칭 모두 이어붙이고 기본 도메인 이름을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'terms')!
    expect(s.headers).toEqual(['용어', '구성 단어', '물리명', '기본 도메인', '설명'])
    expect(s.rows).toEqual([['회원번호', '회원, 번호', 'MBR_NO', '등급코드', '회원 식별자']])
  })

  it('도메인정의서: 방언별 타입과 허용값을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'domains')!
    expect(s.headers).toEqual([
      '이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명',
    ])
    expect(s.rows).toEqual([
      ['등급코드', '코드', 'CHAR(2)', 'char(2)', '', '', '', "'01'", '01, 02', '회원 등급'],
    ])
  })

  it('scope=group은 테이블 시트만 좁히고 사전 3시트는 전체를 유지한다', () => {
    const m = richModel()
    const scoped: ProjectModel = {
      ...m,
      tables: { ...m.tables, t2: { ...m.tables['t2']!, groupId: null } },
    }
    const sheets = buildExcelSheets(scoped, { scope: { kind: 'group', groupId: 'g1' } })
    expect(sheetOf(sheets, 'tableList')!.rows.map((r) => r[2])).toEqual(['MBR_GRD'])
    expect(sheetOf(sheets, 'tableSpec')!.rows.every((r) => r[2] === 'MBR_GRD')).toBe(true)
    expect(sheetOf(sheets, 'words')!.rows).toHaveLength(2)
    expect(sheetOf(sheets, 'domains')!.rows).toHaveLength(1)
  })

  it('그룹 미배정 테이블의 그룹 칸은 빈 문자열이다', () => {
    const m = buildSampleModel()
    const ungrouped: ProjectModel = {
      ...m,
      tables: { ...m.tables, t1: { ...m.tables['t1']!, groupId: null } },
    }
    const s = sheetOf(buildExcelSheets(ungrouped), 'tableList')!
    expect(s.rows.find((r) => r[2] === 'MBR_GRD')![0]).toBe('')
  })

  it('컬럼이 0개인 테이블은 테이블정의서에서 빠지고 테이블 목록에는 남는다', () => {
    const m = buildSampleModel()
    const empty: ProjectModel = {
      ...m,
      tables: {
        ...m.tables,
        t9: {
          id: 't9', logicalName: '빈테이블', physicalName: 'EMPTY', comment: null,
          groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
        },
      },
    }
    const sheets = buildExcelSheets(empty)
    expect(sheetOf(sheets, 'tableList')!.rows.some((r) => r[2] === 'EMPTY')).toBe(true)
    expect(sheetOf(sheets, 'tableSpec')!.rows.some((r) => r[2] === 'EMPTY')).toBe(false)
  })

  it('sheets 옵션으로 일부만 고르되 고정 순서를 유지한다', () => {
    const sheets = buildExcelSheets(buildSampleModel(), { sheets: ['domains', 'tableList'] })
    expect(sheets.map((s) => s.key)).toEqual(['tableList', 'domains'])
  })
})

describe('buildDictTemplateSheets', () => {
  it('사전 3시트의 헤더만 있는 빈 시트를 낸다', () => {
    const sheets = buildDictTemplateSheets()
    expect(sheets.map((s) => s.key)).toEqual(['words', 'terms', 'domains'])
    expect(sheets.map((s) => s.name)).toEqual([
      EXCEL_SHEET_NAME.words, EXCEL_SHEET_NAME.terms, EXCEL_SHEET_NAME.domains,
    ])
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true)
    expect(sheets[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
  })

  it('양식 헤더는 내보내기 헤더와 완전히 같다 (왕복 계약)', () => {
    const exported = buildExcelSheets(buildSampleModel())
    const template = buildDictTemplateSheets()
    for (const t of template) {
      expect(t.headers).toEqual(exported.find((e) => e.key === t.key)!.headers)
    }
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-sheets.test.ts`
Expected: FAIL — `Cannot find module './excel-sheets.js'`

- [ ] **Step 3: `ExportScope` 별칭을 추가한다**

`packages/core/src/ddl.ts`의 `DdlScope` 정의 바로 아래에 추가한다:

```ts
/** 내보내기 범위. DDL 전용이 아니라 Excel 산출물도 같은 범위 개념을 쓴다. */
export type ExportScope = DdlScope
```

- [ ] **Step 4: `excel-sheets.ts`를 구현한다**

`packages/core/src/excel-sheets.ts`를 만든다:

```ts
import type { Column, ProjectModel, Table } from './model.js'
import type { ExportScope } from './ddl.js'
import { customFieldsFor, resolveCustomValue } from './custom-field.js'
import { decomposeByWords } from './naming.js'

export type ExcelSheetKey = 'tableList' | 'tableSpec' | 'words' | 'terms' | 'domains'

/** 워크북 안에서의 시트 순서. buildExcelSheets는 항상 이 순서로 반환한다. */
export const EXCEL_SHEET_KEYS: readonly ExcelSheetKey[] =
  ['tableList', 'tableSpec', 'words', 'terms', 'domains']

export const EXCEL_SHEET_NAME: Record<ExcelSheetKey, string> = {
  tableList: '테이블 목록',
  tableSpec: '테이블정의서',
  words: '단어사전',
  terms: '용어사전',
  domains: '도메인정의서',
}

export const TABLE_LIST_HEADERS = ['그룹', '논리명', '물리명', '설명'] as const
export const TABLE_SPEC_HEADERS = [
  '그룹', '테이블 논리명', '테이블 물리명', '순번', '논리명', '물리명',
  '도메인', '타입', 'PK', 'NOT NULL', '기본값', '설명',
] as const
export const WORD_HEADERS = ['논리명', '약어', '영문명', '설명'] as const
export const TERM_HEADERS = ['용어', '구성 단어', '물리명', '기본 도메인', '설명'] as const
export const DOMAIN_HEADERS = [
  '이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명',
] as const

/**
 * 한 시트의 내용. 모든 셀은 문자열이다 — 물리명 "0001"의 앞 0이 날아가거나
 * 코드값이 숫자로 바뀌는 것을 막고, 업로드 파서와 표현이 대칭이 된다.
 */
export type SheetData = { key: ExcelSheetKey; name: string; headers: string[]; rows: string[][] }

const text = (v: string | null | undefined): string => v ?? ''

function groupNameOf(model: ProjectModel, t: Table): string {
  return t.groupId ? text(model.tableGroups[t.groupId]?.name) : ''
}

/** 범위에 드는 테이블을 (그룹명, 물리명) 순으로 낸다. */
function scopedTables(model: ProjectModel, scope: ExportScope): Table[] {
  const all = Object.values(model.tables)
  let picked: Table[]
  if (scope.kind === 'all') picked = all
  else if (scope.kind === 'group') picked = all.filter((t) => t.groupId === scope.groupId)
  else {
    const ids = new Set(scope.tableIds)
    picked = all.filter((t) => ids.has(t.id))
  }
  return picked.sort((a, b) =>
    groupNameOf(model, a).localeCompare(groupNameOf(model, b))
    || a.physicalName.localeCompare(b.physicalName))
}

function tableColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns)
    .filter((c) => c.tableId === tableId)
    .sort((a, b) => a.order - b.order)
}

/**
 * 컬럼의 도메인 이름·논리 타입·기본값을 해석한다(방언 무관 — domain-resolve의
 * resolveColumn과 같은 우선순위지만 SQL 타입을 만들지 않으므로 dialect가 필요 없다).
 */
function resolveForSheet(
  model: ProjectModel, col: Column,
): { domainName: string; type: string; defaultValue: string } {
  const d = col.domainId ? model.domains[col.domainId] : undefined
  if (!d) return { domainName: '', type: col.type, defaultValue: text(col.defaultValue) }
  const own = col.defaultValue !== null && col.defaultValue !== '' ? col.defaultValue : null
  return { domainName: d.name, type: d.logicalType, defaultValue: own ?? text(d.defaultValue) }
}

/**
 * 프로젝트 모델을 Excel 시트 데이터로 만든다.
 * scope는 테이블 시트(tableList/tableSpec)에만 적용된다 — 사전 3종은 그룹 개념이
 * 없는 프로젝트 전역 자산이라 항상 전체를 낸다.
 */
export function buildExcelSheets(
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[] } = {},
): SheetData[] {
  const scope = opts.scope ?? { kind: 'all' }
  const wanted = new Set<ExcelSheetKey>(opts.sheets ?? EXCEL_SHEET_KEYS)
  const tables = scopedTables(model, scope)
  const tableFields = customFieldsFor(model, 'table')
  const columnFields = customFieldsFor(model, 'column')

  const build = (key: ExcelSheetKey): SheetData => {
    switch (key) {
      case 'tableList':
        return {
          key, name: EXCEL_SHEET_NAME[key],
          headers: [...TABLE_LIST_HEADERS, ...tableFields.map((f) => f.name)],
          rows: tables.map((t) => [
            groupNameOf(model, t), t.logicalName, t.physicalName, text(t.comment),
            ...tableFields.map((f) => resolveCustomValue(t, f)),
          ]),
        }
      case 'tableSpec': {
        const rows: string[][] = []
        for (const t of tables) {
          tableColumns(model, t.id).forEach((c, i) => {
            const r = resolveForSheet(model, c)
            rows.push([
              groupNameOf(model, t), t.logicalName, t.physicalName, String(i + 1),
              c.logicalName, c.physicalName, r.domainName, r.type,
              c.isPk ? 'Y' : '', c.nullable ? '' : 'Y', r.defaultValue, text(c.comment),
              ...columnFields.map((f) => resolveCustomValue(c, f)),
            ])
          })
        }
        return {
          key, name: EXCEL_SHEET_NAME[key],
          headers: [...TABLE_SPEC_HEADERS, ...columnFields.map((f) => f.name)],
          rows,
        }
      }
      case 'words':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...WORD_HEADERS],
          rows: Object.values(model.words)
            .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
            .map((w) => [w.logicalName, w.abbreviation, text(w.englishName), text(w.description)]),
        }
      case 'terms':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...TERM_HEADERS],
          rows: Object.values(model.terms)
            .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
            .map((t) => [
              t.logicalName,
              decomposeByWords(t.logicalName, model.words).map((s) => s.text).join(', '),
              t.physicalName,
              t.domainId ? text(model.domains[t.domainId]?.name) : '',
              text(t.description),
            ]),
        }
      case 'domains':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...DOMAIN_HEADERS],
          rows: Object.values(model.domains)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((d) => [
              d.name, text(d.category), d.logicalType,
              text(d.dialectTypes.postgresql), text(d.dialectTypes.mysql),
              text(d.dialectTypes.oracle), text(d.dialectTypes.mssql),
              text(d.defaultValue), d.allowedValues.join(', '), text(d.description),
            ]),
        }
    }
  }

  return EXCEL_SHEET_KEYS.filter((k) => wanted.has(k)).map(build)
}

/** 사전 업로드 양식(단어·용어·도메인 3시트, 헤더만). 내보내기와 같은 헤더를 쓴다. */
export function buildDictTemplateSheets(): SheetData[] {
  return [
    { key: 'words', name: EXCEL_SHEET_NAME.words, headers: [...WORD_HEADERS], rows: [] },
    { key: 'terms', name: EXCEL_SHEET_NAME.terms, headers: [...TERM_HEADERS], rows: [] },
    { key: 'domains', name: EXCEL_SHEET_NAME.domains, headers: [...DOMAIN_HEADERS], rows: [] },
  ]
}
```

- [ ] **Step 5: `index.ts`에 export를 추가한다**

`packages/core/src/index.ts`의 ddl 줄 아래에 추가한다:

```ts
export type { DdlScope, ExportScope } from './ddl.js'
export {
  EXCEL_SHEET_KEYS, EXCEL_SHEET_NAME, WORD_HEADERS, TERM_HEADERS, DOMAIN_HEADERS,
  TABLE_LIST_HEADERS, TABLE_SPEC_HEADERS, buildExcelSheets, buildDictTemplateSheets,
} from './excel-sheets.js'
export type { ExcelSheetKey, SheetData } from './excel-sheets.js'
```

기존 `export type { DdlScope } from './ddl.js'` 줄은 위 줄로 대체한다(중복 export가 되지 않게 한다).

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-sheets.test.ts`
Expected: PASS (15개)

- [ ] **Step 7: 전 스위트 확인**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm -r typecheck
```
Expected: PASS, core 153 → 168 근처

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/excel-sheets.ts packages/core/src/excel-sheets.test.ts \
  packages/core/src/ddl.ts packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): Excel 시트 빌더

프로젝트 모델을 5개 시트(테이블 목록·테이블정의서·단어사전·용어사전·
도메인정의서)의 헤더/행 데이터로 만드는 순수 함수를 추가한다. xlsx 인코딩은
web이 맡고 core는 IO-free를 유지한다.

- 커스텀 항목은 정의 순서대로 추가 컬럼이 되고 값은 라이브 해석(미입력이면 기본값)
- 도메인 지정 컬럼의 도메인 이름·논리 타입·기본값 해석(방언 무관)
- scope는 테이블 시트에만 적용, 사전 3시트는 프로젝트 전역이라 항상 전체
- 컬럼 0개 테이블은 테이블정의서에서 제외(DDL 정책과 일관), 목록에는 유지
- 모든 셀은 문자열 — 코드값의 앞 0 손실을 막고 업로드 파서와 표현이 대칭
- 양식 다운로드용 buildDictTemplateSheets가 같은 헤더 상수를 써 왕복 계약 성립

DDL 전용으로 읽히던 범위 타입에 ExportScope 별칭을 추가했다(DdlScope 유지).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 4: core — Excel 사전 파서 (`excel-import.ts`)

**Files:**
- Create: `packages/core/src/excel-import.ts`
- Create: `packages/core/src/excel-import.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 3의 `WORD_HEADERS`/`TERM_HEADERS`/`DOMAIN_HEADERS`, Task 1의 `generatePhysicalName`
- Produces:
  - `export type DictSheetKey = 'words' | 'terms' | 'domains'`
  - `export type RawSheet = { key: DictSheetKey; headers: string[]; rows: string[][] }` — Task 5의 `readDictSheets`가 반환
  - `export type DictImportIssue = { sheet: DictSheetKey; row: number | null; level: 'error' | 'warning'; message: string }`
  - `export type TermDraft = Omit<Term, 'id' | 'domainId'> & { domainName: string }`
  - `export type DictImportEntry` (word/term/domain 유니언, 각각 `{ row, draft, existingId }`)
  - `export type DictImportCounts = { created: number; duplicated: number; errored: number }`
  - `export type DictImportPlan = { entries; issues; total; bySheet }`
  - `export function planDictImport(sheets: RawSheet[], model: ProjectModel, rules?: NamingRules): DictImportPlan` — Task 7이 사용

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/core/src/excel-import.test.ts`를 만든다:

```ts
import { describe, expect, it } from 'vitest'
import type { ProjectModel } from './model.js'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { DOMAIN_HEADERS, TERM_HEADERS, WORD_HEADERS } from './excel-sheets.js'
import { planDictImport, type RawSheet } from './excel-import.js'

const wordSheet = (rows: string[][]): RawSheet => ({ key: 'words', headers: [...WORD_HEADERS], rows })
const termSheet = (rows: string[][]): RawSheet => ({ key: 'terms', headers: [...TERM_HEADERS], rows })
const domainSheet = (rows: string[][]): RawSheet => ({ key: 'domains', headers: [...DOMAIN_HEADERS], rows })

function modelWith(): ProjectModel {
  return {
    ...createEmptyModel(),
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null },
    },
    domains: {
      d1: {
        id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null,
      },
    },
  }
}

describe('planDictImport — 단어', () => {
  it('신규 단어를 파싱한다', () => {
    const plan = planDictImport([wordSheet([['주문', 'ORD', 'ORDER', '주문 건']])], createEmptyModel())
    expect(plan.entries).toEqual([{
      kind: 'word', row: 1, existingId: null,
      draft: { logicalName: '주문', abbreviation: 'ORD', englishName: 'ORDER', description: '주문 건' },
    }])
    expect(plan.total).toEqual({ created: 1, duplicated: 0, errored: 0 })
  })

  it('빈 영문명·설명은 null이 된다', () => {
    const plan = planDictImport([wordSheet([['주문', 'ORD', '', '']])], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'word' && e.draft.englishName).toBeNull()
    expect(e.kind === 'word' && e.draft.description).toBeNull()
  })

  it('기존 단어와 논리명이 같으면 existingId가 잡힌다', () => {
    const plan = planDictImport([wordSheet([[' 회원 ', 'MBR', '', '']])], modelWith())
    expect(plan.entries[0]!.existingId).toBe('w1')
    expect(plan.total.duplicated).toBe(1)
  })

  it('논리명이 비면 error 이슈로 행을 건너뛴다', () => {
    const plan = planDictImport([wordSheet([['', 'ORD', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues).toEqual([
      { sheet: 'words', row: 1, level: 'error', message: '논리명이 비어 있습니다' },
    ])
    expect(plan.total.errored).toBe(1)
  })

  it('약어가 비어도 등록한다 (관대한 파싱)', () => {
    const plan = planDictImport([wordSheet([['주문', '', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues).toHaveLength(0)
  })

  it('모든 셀이 빈 행은 조용히 건너뛴다', () => {
    const plan = planDictImport([wordSheet([['', '', '', ''], ['주문', 'ORD', '', '']])], createEmptyModel())
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]!.row).toBe(2)
    expect(plan.issues).toHaveLength(0)
  })

  it('같은 파일 안에서 논리명이 겹치면 뒤 행을 error로 건너뛴다', () => {
    const plan = planDictImport(
      [wordSheet([['주문', 'ORD', '', ''], ['주문', 'ORDR', '', '']])], createEmptyModel(),
    )
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues[0]).toMatchObject({ sheet: 'words', row: 2, level: 'error' })
    expect(plan.issues[0]!.message).toContain('1행')
  })

  it('헤더 순서가 달라도 이름으로 매칭하고 모르는 컬럼은 무시한다', () => {
    const sheet: RawSheet = {
      key: 'words', headers: ['비고', '약어', '논리명'], rows: [['메모', 'ORD', '주문']],
    }
    const plan = planDictImport([sheet], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'word' && e.draft).toMatchObject({ logicalName: '주문', abbreviation: 'ORD' })
  })

  it('키 헤더가 없으면 시트 전체를 건너뛰고 시트 단위 이슈를 남긴다', () => {
    const sheet: RawSheet = { key: 'words', headers: ['약어', '설명'], rows: [['ORD', 'x']] }
    const plan = planDictImport([sheet], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]).toMatchObject({ sheet: 'words', row: null, level: 'error' })
  })
})

describe('planDictImport — 도메인', () => {
  it('방언별 타입·허용값을 파싱한다', () => {
    const plan = planDictImport([domainSheet([
      ['등급코드', '코드', 'CHAR(2)', 'char(2)', '', '', '', "'01'", '01, 02 ,', '설명'],
    ])], createEmptyModel())
    expect(plan.entries[0]).toEqual({
      kind: 'domain', row: 1, existingId: null,
      draft: {
        name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
        defaultValue: "'01'", allowedValues: ['01', '02'], description: '설명',
      },
    })
  })

  it('허용값이 비면 빈 배열이다', () => {
    const plan = planDictImport([domainSheet([['코드', '', 'CHAR(2)', '', '', '', '', '', '', '']])], createEmptyModel())
    const e = plan.entries[0]!
    expect(e.kind === 'domain' && e.draft.allowedValues).toEqual([])
  })

  it('이름 또는 논리 타입이 비면 error로 건너뛴다', () => {
    const plan = planDictImport([domainSheet([
      ['', '', 'CHAR(2)', '', '', '', '', '', '', ''],
      ['코드', '', '', '', '', '', '', '', '', ''],
    ])], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues.map((i) => i.row)).toEqual([1, 2])
    expect(plan.issues[1]!.message).toContain('논리 타입')
  })

  it('기존 도메인과 이름이 같으면 existingId가 잡힌다', () => {
    const plan = planDictImport(
      [domainSheet([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])], modelWith(),
    )
    expect(plan.entries[0]!.existingId).toBe('d1')
  })
})

describe('planDictImport — 용어', () => {
  it('구성 단어 컬럼은 무시하고 물리명·기본 도메인을 읽는다', () => {
    const plan = planDictImport(
      [termSheet([['회원번호', '아무거나', 'MBR_NO', '금액', '설명']])], modelWith(),
    )
    expect(plan.entries[0]).toEqual({
      kind: 'term', row: 1, existingId: null,
      draft: { logicalName: '회원번호', physicalName: 'MBR_NO', domainName: '금액', description: '설명' },
    })
    expect(plan.issues).toHaveLength(0)
  })

  it('물리명이 비면 단어 사전으로 자동 생성한다', () => {
    const plan = planDictImport(
      [termSheet([['회원', '', '', '', '']])], modelWith(), DEFAULT_NAMING_RULES,
    )
    const e = plan.entries[0]!
    expect(e.kind === 'term' && e.draft.physicalName).toBe('MBR')
  })

  it('물리명이 비고 rules가 없으면 error로 건너뛴다', () => {
    const plan = planDictImport([termSheet([['회원', '', '', '', '']])], modelWith())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]).toMatchObject({ sheet: 'terms', row: 1, level: 'error' })
  })

  it('물리명이 비고 단어 분해도 실패하면 error로 건너뛴다', () => {
    const plan = planDictImport(
      [termSheet([['미등록단어', '', '', '', '']])], createEmptyModel(), DEFAULT_NAMING_RULES,
    )
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues[0]!.level).toBe('error')
  })

  it('찾을 수 없는 기본 도메인은 warning이고 행은 등록된다', () => {
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '없는도메인', '']])], modelWith())
    expect(plan.entries).toHaveLength(1)
    expect(plan.issues[0]).toMatchObject({ sheet: 'terms', row: 1, level: 'warning' })
    expect(plan.total.errored).toBe(0)
  })

  it('같은 파일에서 새로 만들어지는 도메인은 warning을 내지 않는다', () => {
    const plan = planDictImport([
      termSheet([['회원번호', '', 'MBR_NO', '신규도메인', '']]),
      domainSheet([['신규도메인', '', 'CHAR(2)', '', '', '', '', '', '', '']]),
    ], createEmptyModel())
    expect(plan.issues).toHaveLength(0)
    expect(plan.entries).toHaveLength(2)
  })
})

describe('planDictImport — 집계', () => {
  it('시트별·전체 건수를 집계한다', () => {
    const plan = planDictImport([
      wordSheet([['회원', 'MBR', '', ''], ['주문', 'ORD', '', ''], ['', '', '', 'x']]),
      domainSheet([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']]),
    ], modelWith())
    expect(plan.bySheet.words).toEqual({ created: 1, duplicated: 1, errored: 1 })
    expect(plan.bySheet.domains).toEqual({ created: 0, duplicated: 1, errored: 0 })
    expect(plan.bySheet.terms).toEqual({ created: 0, duplicated: 0, errored: 0 })
    expect(plan.total).toEqual({ created: 1, duplicated: 2, errored: 1 })
  })

  it('시트가 하나도 없으면 빈 계획을 낸다', () => {
    const plan = planDictImport([], createEmptyModel())
    expect(plan.entries).toHaveLength(0)
    expect(plan.issues).toHaveLength(0)
    expect(plan.total).toEqual({ created: 0, duplicated: 0, errored: 0 })
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-import.test.ts`
Expected: FAIL — `Cannot find module './excel-import.js'`

- [ ] **Step 3: `excel-import.ts`를 구현한다**

`packages/core/src/excel-import.ts`를 만든다:

```ts
import type { Domain, ProjectModel, Term, Word } from './model.js'
import type { NamingRules } from './naming.js'
import { generatePhysicalName } from './naming.js'
import { DOMAIN_HEADERS, TERM_HEADERS, WORD_HEADERS } from './excel-sheets.js'

export type DictSheetKey = 'words' | 'terms' | 'domains'

/** 워크시트 한 장을 문자열 격자로 옮긴 것. 헤더 1행 + 데이터 행들. */
export type RawSheet = { key: DictSheetKey; headers: string[]; rows: string[][] }

/** row는 1-based 데이터 행 번호(엑셀 행 번호 = row + 1). 시트 전체 문제면 null. */
export type DictImportIssue = {
  sheet: DictSheetKey
  row: number | null
  level: 'error' | 'warning'    // error=행 스킵, warning=행 등록하되 일부 값 무시
  message: string
}

/** 기본 도메인은 이름으로만 담는다 — id 해석은 도메인을 반영한 뒤 적용 단계에서 한다. */
export type TermDraft = Omit<Term, 'id' | 'domainId'> & { domainName: string }

export type DictImportEntry =
  | { kind: 'word'; row: number; draft: Omit<Word, 'id'>; existingId: string | null }
  | { kind: 'term'; row: number; draft: TermDraft; existingId: string | null }
  | { kind: 'domain'; row: number; draft: Omit<Domain, 'id'>; existingId: string | null }

export type DictImportCounts = { created: number; duplicated: number; errored: number }

export type DictImportPlan = {
  entries: DictImportEntry[]
  issues: DictImportIssue[]
  total: DictImportCounts
  bySheet: Record<DictSheetKey, DictImportCounts>
}

const KEY_HEADER: Record<DictSheetKey, string> = {
  words: WORD_HEADERS[0],      // '논리명'
  terms: TERM_HEADERS[0],      // '용어'
  domains: DOMAIN_HEADERS[0],  // '이름'
}

const SHEET_OF: Record<DictImportEntry['kind'], DictSheetKey> = {
  word: 'words', term: 'terms', domain: 'domains',
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => (h ?? '').trim() === name)
}
function cell(row: string[], idx: number): string {
  return idx < 0 ? '' : (row[idx] ?? '').trim()
}
const orNull = (s: string): string | null => (s === '' ? null : s)
const isBlank = (row: string[]): boolean => row.every((c) => (c ?? '').trim() === '')
const splitList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter((x) => x !== '')

/**
 * 사전 시트를 파싱해 적용 계획을 세운다. 모델은 바꾸지 않는다 — 미리보기를 그린 뒤
 * 사용자가 건너뛰기/덮어쓰기를 고르고 나서 applyDictImport(web)가 실제로 반영한다.
 *
 * 처리 순서는 도메인 → 단어 → 용어다. 용어의 "기본 도메인"을 검증할 때 이번 파일에서
 * 새로 생기는 도메인 이름도 알아야 하기 때문이다.
 *
 * rules를 주면 용어의 물리명이 비었을 때 단어 사전으로 자동 생성한다. 이때 terms에는
 * 빈 객체를 넘긴다 — 자기 자신에 완전일치해 단축되는 것을 막고 단어 분해만 쓰기 위해서다.
 */
export function planDictImport(
  sheets: RawSheet[], model: ProjectModel, rules?: NamingRules,
): DictImportPlan {
  const entries: DictImportEntry[] = []
  const issues: DictImportIssue[] = []
  const domainNames = new Set(Object.values(model.domains).map((d) => d.name.trim()))

  /** 키 헤더를 확인하고 유효한 데이터 행을 순회한다. 없으면 시트 이슈를 남기고 만다. */
  const eachRow = (
    key: DictSheetKey,
    onRow: (row: string[], rowNo: number, headers: string[], keyValue: string) => void,
  ): void => {
    const sheet = sheets.find((s) => s.key === key)
    if (!sheet) return
    const keyName = KEY_HEADER[key]
    const keyIdx = columnIndex(sheet.headers, keyName)
    if (keyIdx < 0) {
      issues.push({
        sheet: key, row: null, level: 'error',
        message: `"${keyName}" 헤더를 찾을 수 없어 시트를 건너뜁니다`,
      })
      return
    }
    const seen = new Map<string, number>()
    sheet.rows.forEach((row, i) => {
      const rowNo = i + 1
      if (isBlank(row)) return
      const keyValue = cell(row, keyIdx)
      if (keyValue === '') {
        issues.push({ sheet: key, row: rowNo, level: 'error', message: `${keyName}이(가) 비어 있습니다` })
        return
      }
      const prev = seen.get(keyValue)
      if (prev !== undefined) {
        issues.push({
          sheet: key, row: rowNo, level: 'error',
          message: `${prev}행과 ${keyName}이(가) 중복됩니다`,
        })
        return
      }
      seen.set(keyValue, rowNo)
      onRow(row, rowNo, sheet.headers, keyValue)
    })
  }

  // 1) 도메인 — 용어가 참조할 수 있도록 먼저 처리한다
  eachRow('domains', (row, rowNo, headers, name) => {
    const logicalType = cell(row, columnIndex(headers, '논리 타입'))
    if (logicalType === '') {
      issues.push({ sheet: 'domains', row: rowNo, level: 'error', message: '논리 타입이 비어 있습니다' })
      return
    }
    const existing = Object.values(model.domains).find((d) => d.name.trim() === name)
    entries.push({
      kind: 'domain', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        name,
        category: orNull(cell(row, columnIndex(headers, '분류'))),
        logicalType,
        dialectTypes: {
          postgresql: orNull(cell(row, columnIndex(headers, 'PostgreSQL'))),
          mysql: orNull(cell(row, columnIndex(headers, 'MySQL'))),
          oracle: orNull(cell(row, columnIndex(headers, 'Oracle'))),
          mssql: orNull(cell(row, columnIndex(headers, 'MSSQL'))),
        },
        defaultValue: orNull(cell(row, columnIndex(headers, '기본값'))),
        allowedValues: splitList(cell(row, columnIndex(headers, '허용값'))),
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
    domainNames.add(name)
  })

  // 2) 단어
  eachRow('words', (row, rowNo, headers, logicalName) => {
    const existing = Object.values(model.words).find((w) => w.logicalName.trim() === logicalName)
    entries.push({
      kind: 'word', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        logicalName,
        abbreviation: cell(row, columnIndex(headers, '약어')),
        englishName: orNull(cell(row, columnIndex(headers, '영문명'))),
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
  })

  // 3) 용어 — "구성 단어" 컬럼은 파생값이라 읽지 않는다
  eachRow('terms', (row, rowNo, headers, logicalName) => {
    let physicalName = cell(row, columnIndex(headers, '물리명'))
    if (physicalName === '' && rules) {
      physicalName = generatePhysicalName(logicalName, model.words, {}, rules).physicalName
    }
    if (physicalName === '') {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'error',
        message: '물리명이 비어 있고 단어 사전으로 자동 생성할 수도 없습니다',
      })
      return
    }
    const domainName = cell(row, columnIndex(headers, '기본 도메인'))
    if (domainName !== '' && !domainNames.has(domainName)) {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'warning',
        message: `기본 도메인 "${domainName}"을(를) 찾을 수 없어 비웁니다`,
      })
    }
    const existing = Object.values(model.terms).find((t) => t.logicalName.trim() === logicalName)
    entries.push({
      kind: 'term', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        logicalName, physicalName, domainName,
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
  })

  const countsFor = (key: DictSheetKey): DictImportCounts => {
    const mine = entries.filter((e) => SHEET_OF[e.kind] === key)
    return {
      created: mine.filter((e) => e.existingId === null).length,
      duplicated: mine.filter((e) => e.existingId !== null).length,
      errored: issues.filter((i) => i.sheet === key && i.level === 'error').length,
    }
  }
  const bySheet: Record<DictSheetKey, DictImportCounts> = {
    words: countsFor('words'), terms: countsFor('terms'), domains: countsFor('domains'),
  }
  const total: DictImportCounts = {
    created: bySheet.words.created + bySheet.terms.created + bySheet.domains.created,
    duplicated: bySheet.words.duplicated + bySheet.terms.duplicated + bySheet.domains.duplicated,
    errored: bySheet.words.errored + bySheet.terms.errored + bySheet.domains.errored,
  }
  return { entries, issues, total, bySheet }
}
```

- [ ] **Step 4: `index.ts`에 export를 추가한다**

`packages/core/src/index.ts`의 excel-sheets 줄 아래에 추가한다:

```ts
export { planDictImport } from './excel-import.js'
export type {
  DictSheetKey, RawSheet, DictImportIssue, DictImportEntry, DictImportCounts,
  DictImportPlan, TermDraft,
} from './excel-import.js'
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-import.test.ts`
Expected: PASS (19개)

**주의:** "같은 파일에서 새로 만들어지는 도메인은 warning을 내지 않는다" 테스트가 통과하려면 `entries` 안에서 도메인이 용어보다 먼저 나와야 한다(도메인을 먼저 처리하므로 자연히 그렇다).

- [ ] **Step 6: 전 스위트 확인**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm -r typecheck
```
Expected: PASS, core 168 → 187 근처

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/excel-import.ts packages/core/src/excel-import.test.ts \
  packages/core/src/index.ts
git commit -F - <<'EOF'
feat(core): Excel 사전 업로드 파서

단어·용어·도메인 시트를 파싱해 신규/중복/오류로 분류한 적용 계획을 만든다.
모델은 바꾸지 않는다 — 미리보기를 그린 뒤 사용자가 건너뛰기/덮어쓰기를 고르고
나서 web의 producer가 반영한다.

- 헤더는 내보내기 상수와 같은 것을 써 왕복 계약이 컴파일 타임에 묶인다
- 헤더 순서 무관, 모르는 컬럼은 무시(관대한 파싱). 키 헤더가 없으면 시트째 스킵
- 이슈는 error(행 스킵)/warning(행 등록, 일부 값 무시) 2단계
- 도메인 → 단어 → 용어 순으로 처리해 같은 파일의 새 도메인도 용어가 참조 가능
- 용어 물리명이 비면 단어 사전으로 자동 생성(논리명만 적은 시트로 일괄 등록)
- 기본 도메인은 이름으로만 담는다 — id 해석은 도메인 반영 후 적용 단계 몫

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 5: web — xlsx 인코딩/디코딩 (`excel-file.ts`)

**Files:**
- Modify: `apps/web/package.json` (exceljs 추가)
- Create: `apps/web/src/editor/excel-file.ts`
- Create: `apps/web/src/editor/excel-file.test.ts`

**Interfaces:**
- Consumes: Task 3의 `SheetData`/`EXCEL_SHEET_NAME`, Task 4의 `RawSheet`/`DictSheetKey`
- Produces:
  - `export async function buildWorkbookBlob(sheets: SheetData[]): Promise<Blob>`
  - `export async function downloadExcelWorkbook(sheets: SheetData[], fileName: string): Promise<void>` — Task 6·7이 사용
  - `export async function readDictSheets(file: Blob): Promise<RawSheet[]>` — Task 7이 사용

**검증된 사실(스파이크 결과 — 그대로 믿어도 된다):**
- vitest+jsdom에서 `await import('exceljs')`는 `{ default: ... }`만 준다 → **반드시 `.default`를 꺼내 쓴다.**
- jsdom에서 Blob 왕복이 정상 동작한다. `@vitest-environment node` 도크블록은 필요 없다.
- `wb.getWorksheet('없는이름')`은 `undefined`를 반환한다(타입도 `Worksheet | undefined`).
- 빈 문자열로 쓴 셀은 `''`로 읽히고, 아예 쓰지 않은 열은 `null`로 읽힌다.
- `ws.rowCount`는 헤더를 포함한 행 수다.

- [ ] **Step 1: exceljs를 설치한다**

```bash
pnpm --filter @erdd/web add exceljs@^4.4.0
```
Expected: `apps/web/package.json`의 `dependencies`에 `"exceljs": "^4.4.0"`이 추가된다. 다른 워크스페이스에는 넣지 않는다.

- [ ] **Step 2: 실패하는 왕복 테스트를 쓴다**

`apps/web/src/editor/excel-file.test.ts`를 만든다:

```ts
import { describe, expect, it } from 'vitest'
import type { SheetData } from '@erdd/core'
import { buildWorkbookBlob, readDictSheets } from './excel-file.js'

const sheets: SheetData[] = [
  {
    key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'],
    rows: [['회원', 'MBR', 'MEMBER', ''], ['번호', 'NO', '', '순번']],
  },
  {
    key: 'domains', name: '도메인정의서',
    headers: ['이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명'],
    rows: [['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']],
  },
]

describe('excel-file 왕복', () => {
  it('만든 워크북을 다시 읽으면 헤더와 셀 값이 보존된다', async () => {
    const blob = await buildWorkbookBlob(sheets)
    const read = await readDictSheets(blob)
    expect(read.map((s) => s.key)).toEqual(['words', 'domains'])
    expect(read[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
    expect(read[0]!.rows).toEqual([['회원', 'MBR', 'MEMBER', ''], ['번호', 'NO', '', '순번']])
    expect(read[1]!.rows).toEqual([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])
  })

  it('사전이 아닌 시트는 읽기 결과에서 제외된다', async () => {
    const withSpec: SheetData[] = [
      { key: 'tableList', name: '테이블 목록', headers: ['그룹', '논리명'], rows: [['g', '회원']] },
      ...sheets,
    ]
    const read = await readDictSheets(await buildWorkbookBlob(withSpec))
    expect(read.map((s) => s.key)).toEqual(['words', 'domains'])
  })

  it('사전 시트가 하나도 없으면 에러를 던진다', async () => {
    const only: SheetData[] = [
      { key: 'tableList', name: '테이블 목록', headers: ['그룹'], rows: [['g']] },
    ]
    const blob = await buildWorkbookBlob(only)
    await expect(readDictSheets(blob)).rejects.toThrow(/단어사전/)
  })

  it('숫자·불리언 셀은 문자열로 정규화되고 빈 셀은 빈 문자열이 된다', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('단어사전')
    ws.addRow(['논리명', '약어', '영문명', '설명'])
    ws.addRow([1234, true, null, undefined])
    const buf = await wb.xlsx.writeBuffer()
    const read = await readDictSheets(new Blob([buf]))
    expect(read[0]!.rows).toEqual([['1234', 'true', '', '']])
  })

  it('데이터가 없는 시트는 빈 rows를 낸다', async () => {
    const empty: SheetData[] = [
      { key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'], rows: [] },
    ]
    const read = await readDictSheets(await buildWorkbookBlob(empty))
    expect(read[0]!.rows).toEqual([])
    expect(read[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/excel-file.test.ts`
Expected: FAIL — `Cannot find module './excel-file.js'`

- [ ] **Step 4: `excel-file.ts`를 구현한다**

`apps/web/src/editor/excel-file.ts`를 만든다:

```ts
import {
  EXCEL_SHEET_NAME, type DictSheetKey, type RawSheet, type SheetData,
} from '@erdd/core'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DICT_SHEET_KEYS: readonly DictSheetKey[] = ['words', 'terms', 'domains']
const MAX_COLUMN_WIDTH = 60

/**
 * exceljs는 초기 번들에 넣기에 크므로 동적 import로만 불러온다.
 * vitest+jsdom·vite 양쪽에서 네임스페이스에 default만 실리므로 .default를 꺼낸다.
 */
async function loadExcelJs() {
  return (await import('exceljs')).default
}

/** exceljs Row.values는 1-based 희소 배열(0번은 null)이다. 키 매핑 형태면 빈 배열로 본다. */
function rowValues(row: { values: unknown }): unknown[] {
  return Array.isArray(row.values) ? (row.values as unknown[]) : []
}

/** 셀 값을 문자열로 정규화한다. 파서가 trim을 하므로 여기서는 하지 않는다. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { richText?: { text?: string }[]; result?: unknown; text?: string }
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? '').join('')
    if ('result' in o) return cellText(o.result)
    if (typeof o.text === 'string') return o.text
  }
  return String(v)
}

/** 시트 데이터를 .xlsx 워크북 Blob으로 만든다. */
export async function buildWorkbookBlob(sheets: SheetData[]): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    ws.addRow([...s.headers])
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    if (s.headers.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } }
    }
    for (const row of s.rows) ws.addRow([...row])
    ws.columns.forEach((col, i) => {
      const header = s.headers[i] ?? ''
      const longest = s.rows.reduce((max, r) => Math.max(max, (r[i] ?? '').length), header.length)
      col.width = Math.min(MAX_COLUMN_WIDTH, Math.max(10, longest + 2))
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

/** 워크북을 만들어 브라우저 다운로드를 트리거한다. */
export async function downloadExcelWorkbook(sheets: SheetData[], fileName: string): Promise<void> {
  const blob = await buildWorkbookBlob(sheets)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 업로드된 워크북에서 사전 3시트(단어사전·용어사전·도메인정의서)를 문자열 격자로 읽는다.
 * 그 이름의 시트가 하나도 없으면 던진다 — 잘못된 파일을 조용히 0건으로 처리하지 않기 위해서다.
 */
export async function readDictSheets(file: Blob): Promise<RawSheet[]> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  const out: RawSheet[] = []
  for (const key of DICT_SHEET_KEYS) {
    const ws = wb.getWorksheet(EXCEL_SHEET_NAME[key])
    if (!ws) continue
    const headerValues = rowValues(ws.getRow(1))
    const headers: string[] = []
    for (let c = 1; c < headerValues.length; c++) headers.push(cellText(headerValues[c]))
    while (headers.length > 0 && headers.at(-1) === '') headers.pop()
    if (headers.length === 0) continue

    const rows: string[][] = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const values = headers.map((_, i) => cellText(row.getCell(i + 1).value))
      if (values.every((v) => v.trim() === '')) continue
      rows.push(values)
    }
    out.push({ key, headers, rows })
  }

  if (out.length === 0) {
    throw new Error('단어사전·용어사전·도메인정의서 시트를 찾을 수 없습니다')
  }
  return out
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/excel-file.test.ts`
Expected: PASS (5개)

- [ ] **Step 6: 전 스위트 확인**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck
```
Expected: PASS, web 159 → 164

- [ ] **Step 7: 커밋**

```bash
git add apps/web/package.json pnpm-lock.yaml \
  apps/web/src/editor/excel-file.ts apps/web/src/editor/excel-file.test.ts
git commit -F - <<'EOF'
feat(web): exceljs로 xlsx 인코딩·디코딩

core의 시트 데이터를 .xlsx로 만들고(헤더 굵게·틀 고정·자동 필터·컬럼 너비),
업로드된 워크북에서 사전 3시트를 문자열 격자로 읽는다. 숫자·불리언·수식·
서식 있는 텍스트 셀을 모두 문자열로 정규화한다.

exceljs는 번들이 커서 동적 import로만 불러온다 — Excel 섹션을 열거나 파일을
고를 때만 로드된다. 사전 시트가 하나도 없는 파일은 조용히 0건으로 넘기지 않고
에러를 던진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 6: web — 공용 범위 선택기 + 내보내기 다이얼로그 Excel 섹션

**Files:**
- Create: `apps/web/src/editor/export-scope-select.tsx`
- Create: `apps/web/src/editor/export-scope-select.test.tsx`
- Modify: `apps/web/src/editor/export-dialog.tsx`
- Modify: `apps/web/src/editor/export-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `ExportScope`/`EXCEL_SHEET_KEYS`/`EXCEL_SHEET_NAME`/`buildExcelSheets`, Task 5의 `downloadExcelWorkbook`
- Produces: `export function ExportScopeSelect({ value, onChange }: { value: ExportScope; onChange: (s: ExportScope) => void })`

- [ ] **Step 1: 범위 선택기의 실패하는 테스트를 쓴다**

`apps/web/src/editor/export-scope-select.test.tsx`를 만든다:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExportScope, ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { ExportScopeSelect } from './export-scope-select.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

function loadWithGroups() {
  const m = buildSampleModel()
  const withTwo: ProjectModel = {
    ...m,
    tableGroups: {
      ...m.tableGroups,
      g2: { id: 'g2', name: '주문관리', color: '#E58F65', comment: null },
    },
  }
  useEditorStore.getState().setLoaded(withTwo, 1, 'p1')
}

describe('ExportScopeSelect', () => {
  it('그룹을 고르면 group 범위를 낸다', async () => {
    loadWithGroups()
    const onChange = vi.fn()
    render(<ExportScopeSelect value={{ kind: 'all' }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g2')
    expect(onChange).toHaveBeenCalledWith({ kind: 'group', groupId: 'g2' })
  })

  it('전체 버튼을 누르면 all 범위를 낸다', async () => {
    loadWithGroups()
    const onChange = vi.fn()
    const value: ExportScope = { kind: 'group', groupId: 'g1' }
    render(<ExportScopeSelect value={value} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'all' })
  })

  it('현재 group 범위가 드롭다운에 선택되어 보인다', () => {
    loadWithGroups()
    render(<ExportScopeSelect value={{ kind: 'group', groupId: 'g2' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText<HTMLSelectElement>('그룹 선택').value).toBe('g2')
  })

  it('그룹이 하나도 없으면 드롭다운을 그리지 않는다', () => {
    useEditorStore.getState().setLoaded({ ...buildSampleModel(), tableGroups: {} }, 1, 'p1')
    render(<ExportScopeSelect value={{ kind: 'all' }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('그룹 선택')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/export-scope-select.test.tsx`
Expected: FAIL — `Cannot find module './export-scope-select.js'`

- [ ] **Step 3: `export-scope-select.tsx`를 구현한다**

```tsx
import type { ExportScope } from '@erdd/core'
import { useEditorStore } from './store.js'
import { Button } from '@/components/ui/button'

/**
 * DDL·Excel 내보내기가 공유하는 범위 선택기.
 * 그룹 뷰로 전환하지 않아도 드롭다운에서 아무 그룹이나 골라 내보낼 수 있다.
 * ExportScope의 { kind: 'tables' }는 이 UI에서 만들지 않는다.
 */
export function ExportScopeSelect(
  { value, onChange }: { value: ExportScope; onChange: (s: ExportScope) => void },
) {
  const model = useEditorStore((s) => s.model)
  const groups = Object.values(model.tableGroups).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">범위</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm"
          variant={value.kind === 'all' ? 'default' : 'outline'}
          onClick={() => onChange({ kind: 'all' })}
        >
          전체
        </Button>
        {groups.length > 0 && (
          <select
            aria-label="그룹 선택"
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
            value={value.kind === 'group' ? value.groupId : ''}
            onChange={(e) => {
              const id = e.target.value
              onChange(id === '' ? { kind: 'all' } : { kind: 'group', groupId: id })
            }}
          >
            <option value="">그룹 선택…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/export-scope-select.test.tsx`
Expected: PASS (4개)

- [ ] **Step 5: 내보내기 다이얼로그의 실패하는 테스트를 쓴다**

`apps/web/src/editor/export-dialog.test.tsx` 맨 아래(마지막 `})` 앞)에 추가한다. 파일 상단 import에 `vi`를 추가한다(`import { afterEach, describe, expect, it, vi } from 'vitest'`).

```tsx
  it('Excel 섹션으로 전환하면 시트 체크박스 5개를 보여준다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    for (const name of ['테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
    }
  })

  it('Excel 시트를 전부 해제하면 다운로드 버튼이 비활성된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    for (const name of ['테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서']) {
      await userEvent.click(screen.getByRole('checkbox', { name }))
    }
    expect(screen.getByRole('button', { name: /다운로드/ })).toBeDisabled()
  })

  it('DDL 섹션의 범위를 그룹 드롭다운으로 좁히면 미리보기가 그 그룹만 담는다', async () => {
    // 샘플 모델은 두 테이블이 모두 g1이므로, t2를 미배정으로 돌려 범위 효과가 보이게 한다.
    const m = buildSampleModel()
    useEditorStore.getState().setLoaded(
      { ...m, tables: { ...m.tables, t2: { ...m.tables['t2']!, groupId: null } } }, 1, 'p1',
    )
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g1')
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).not.toContain('MBR_NM')   // t2 전용 컬럼이 빠졌다
  })
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/export-dialog.test.tsx`
Expected: FAIL — `Unable to find role="button" and name "Excel"`

- [ ] **Step 7: `export-dialog.tsx`에 Excel 섹션을 추가하고 범위 UI를 교체한다**

`apps/web/src/editor/export-dialog.tsx` 전체를 아래로 교체한다:

```tsx
import { useMemo, useState } from 'react'
import { Copy, Download, FileOutput } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import {
  DIALECTS, EXCEL_SHEET_KEYS, EXCEL_SHEET_NAME, buildExcelSheets, generateDdl, ddlWarnings,
  type Dialect, type ExcelSheetKey, type ExportScope,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { downloadCanvasImage, type ImageFormat } from './image-export.js'
import { downloadExcelWorkbook } from './excel-file.js'
import { ExportScopeSelect } from './export-scope-select.js'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

type Section = 'ddl' | 'image' | 'excel'

/** 파일명에 못 쓰는 문자를 밑줄로 바꾼다. */
function safeFileNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}

/** 헤더의 "내보내기": DDL·이미지·Excel 세 섹션을 토글로 오간다. 모델을 변경하지 않는 읽기 전용 다이얼로그. */
export function ExportDialog() {
  const model = useEditorStore((s) => s.model)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const rf = useReactFlow()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('ddl')
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [scope, setScope] = useState<ExportScope>({ kind: 'all' })
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png')
  const [sheets, setSheets] = useState<ExcelSheetKey[]>([...EXCEL_SHEET_KEYS])

  const ddl = useMemo(() => generateDdl(model, dialect, scope), [model, dialect, scope])
  const warnings = useMemo(() => ddlWarnings(model, dialect, scope), [model, dialect, scope])

  const onCopy = () => { void navigator.clipboard?.writeText(ddl) }
  const onDownload = () => {
    const blob = new Blob([ddl], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `erdd_${dialect}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onDownloadImage = async () => {
    try {
      await downloadCanvasImage(rf, { format: imageFormat })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지를 내보내지 못했습니다')
    }
  }

  const toggleSheet = (key: ExcelSheetKey) => {
    setSheets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const onDownloadExcel = async () => {
    try {
      const data = buildExcelSheets(model, { scope, sheets })
      const groupName = scope.kind === 'group' ? model.tableGroups[scope.groupId]?.name : undefined
      const suffix = groupName ? `_${safeFileNamePart(groupName)}` : ''
      await downloadExcelWorkbook(data, `erdd_정의서${suffix}.xlsx`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Excel을 내보내지 못했습니다')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setScope(activeGroupView ? { kind: 'group', groupId: activeGroupView } : { kind: 'all' })
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><FileOutput /> 내보내기</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>내보내기</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button" size="sm" variant={section === 'ddl' ? 'default' : 'outline'}
            onClick={() => setSection('ddl')}
          >
            DDL
          </Button>
          <Button
            type="button" size="sm" variant={section === 'image' ? 'default' : 'outline'}
            onClick={() => setSection('image')}
          >
            이미지
          </Button>
          <Button
            type="button" size="sm" variant={section === 'excel' ? 'default' : 'outline'}
            onClick={() => setSection('excel')}
          >
            Excel
          </Button>
        </div>
        {section === 'ddl' && (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">방언</span>
              <div className="flex flex-wrap gap-2">
                {DIALECTS.map((d) => (
                  <Button
                    key={d} type="button" size="sm"
                    variant={dialect === d ? 'default' : 'outline'}
                    onClick={() => setDialect(d)}
                  >
                    {DIALECT_LABEL[d]}
                  </Button>
                ))}
              </div>
            </div>
            <ExportScopeSelect value={scope} onChange={setScope} />
            <pre
              aria-label="DDL 미리보기"
              className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre"
            >
              {ddl}
            </pre>
            {warnings.length > 0 && (
              <ul aria-label="DDL 경고" className="grid gap-0.5 text-xs text-key">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCopy}><Copy /> 복사</Button>
              <Button type="button" onClick={onDownload}><Download /> 다운로드</Button>
            </DialogFooter>
          </>
        )}
        {section === 'image' && (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">포맷</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" size="sm"
                  variant={imageFormat === 'png' ? 'default' : 'outline'}
                  onClick={() => setImageFormat('png')}
                >
                  PNG
                </Button>
                <Button
                  type="button" size="sm"
                  variant={imageFormat === 'svg' ? 'default' : 'outline'}
                  onClick={() => setImageFormat('svg')}
                >
                  SVG
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">현재 화면(뷰·보기 모드)이 그대로 저장됩니다</p>
            <DialogFooter>
              <Button type="button" onClick={() => void onDownloadImage()}><Download /> 다운로드</Button>
            </DialogFooter>
          </>
        )}
        {section === 'excel' && (
          <>
            <ExportScopeSelect value={scope} onChange={setScope} />
            <div className="grid gap-2">
              <span className="text-sm font-medium">시트</span>
              <div className="grid gap-1.5">
                {EXCEL_SHEET_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" className="size-4"
                      checked={sheets.includes(k)}
                      onChange={() => toggleSheet(k)}
                    />
                    {EXCEL_SHEET_NAME[k]}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              범위는 테이블 목록·테이블정의서에만 적용됩니다. 사전 3종은 항상 전체를 내보냅니다
            </p>
            <DialogFooter>
              <Button type="button" disabled={sheets.length === 0} onClick={() => void onDownloadExcel()}>
                <Download /> 다운로드
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/export-dialog.test.tsx`
Expected: PASS. 기존 테스트는 "현재 그룹" 버튼을 쓰지 않으므로(확인 완료) 수정이 필요 없다.

- [ ] **Step 9: 전 스위트 확인**

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -r typecheck
```
Expected: PASS, web 164 → 171 근처

- [ ] **Step 10: 커밋**

```bash
git add apps/web/src/editor/export-scope-select.tsx apps/web/src/editor/export-scope-select.test.tsx \
  apps/web/src/editor/export-dialog.tsx apps/web/src/editor/export-dialog.test.tsx
git commit -F - <<'EOF'
feat(web): 내보내기 다이얼로그 Excel 섹션·공용 범위 선택기

내보내기 다이얼로그에 Excel 섹션을 추가한다. 범위 + 시트 5개 체크박스를 고르고
다운로드하면 단일 워크북이 받아진다. 그룹 범위면 파일명에 그룹명이 붙는다.

범위 선택 UI를 ExportScopeSelect로 뽑아 DDL과 공유하고, 그룹 뷰로 전환하지
않아도 드롭다운에서 아무 그룹이나 골라 내보낼 수 있게 확장했다 — 기획의 "그룹별로
테이블정의서를 나눠 담당자별로 전달" 시나리오에 맞고 DDL도 함께 개선된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## Task 7: web — 사전 가져오기 (producer + UI)

**Files:**
- Create: `apps/web/src/editor/dict-import-edits.ts`
- Create: `apps/web/src/editor/dict-import-edits.test.ts`
- Create: `apps/web/src/editor/dict-import-section.tsx`
- Create: `apps/web/src/editor/dict-import-section.test.tsx`
- Modify: `apps/web/src/editor/dict-panel.tsx` (가져오기 섹션 + 단어 폼 영문명)

**Interfaces:**
- Consumes: Task 4의 `planDictImport`/`DictImportPlan`, Task 3의 `buildDictTemplateSheets`, Task 5의 `readDictSheets`/`downloadExcelWorkbook`, 기존 `useModelMutation`/`newId`
- Produces:
  - `export type DictImportMode = 'skip' | 'overwrite'`
  - `export type DictImportApplied = { words: number; terms: number; domains: number }`
  - `export function applyDictImport(model: ProjectModel, plan: DictImportPlan, mode: DictImportMode, newId: () => string): ProjectModel`
  - `export function countApplied(plan: DictImportPlan, mode: DictImportMode): DictImportApplied`

- [ ] **Step 1: producer의 실패하는 테스트를 쓴다**

`apps/web/src/editor/dict-import-edits.test.ts`를 만든다:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyModel, planDictImport, type ProjectModel, type RawSheet } from '@erdd/core'
import { applyDictImport } from './dict-import-edits.js'

let counter = 0
const fakeId = () => `new-${++counter}`

const wordSheet = (rows: string[][]): RawSheet => ({
  key: 'words', headers: ['논리명', '약어', '영문명', '설명'], rows,
})
const termSheet = (rows: string[][]): RawSheet => ({
  key: 'terms', headers: ['용어', '구성 단어', '물리명', '기본 도메인', '설명'], rows,
})
const domainSheet = (rows: string[][]): RawSheet => ({
  key: 'domains',
  headers: ['이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명'],
  rows,
})

function modelWithExisting(): ProjectModel {
  return {
    ...createEmptyModel(),
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MB', englishName: null, description: null },
    },
    domains: {
      d1: {
        id: 'd1', name: '금액', category: null, logicalType: 'INT',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null,
      },
    },
    columns: {
      c1: {
        id: 'c1', tableId: 't1', logicalName: '금액', physicalName: 'AMT', type: 'INT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
        comment: null, domainId: 'd1', custom: {},
      },
    },
  }
}

describe('applyDictImport', () => {
  it('신규 항목을 주입받은 id로 만든다', () => {
    counter = 0
    const plan = planDictImport([wordSheet([['주문', 'ORD', 'ORDER', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.words)).toEqual([
      { id: 'new-1', logicalName: '주문', abbreviation: 'ORD', englishName: 'ORDER', description: null },
    ])
  })

  it('skip 모드는 기존 항목을 건드리지 않는다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([wordSheet([['회원', 'MBR', 'MEMBER', '']])], base)
    const m = applyDictImport(base, plan, 'skip', fakeId)
    expect(m.words['w1']!.abbreviation).toBe('MB')
    expect(Object.keys(m.words)).toEqual(['w1'])
  })

  it('overwrite 모드는 기존 id를 유지한 채 값을 갱신한다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([wordSheet([['회원', 'MBR', 'MEMBER', '']])], base)
    const m = applyDictImport(base, plan, 'overwrite', fakeId)
    expect(Object.keys(m.words)).toEqual(['w1'])
    expect(m.words['w1']).toEqual({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null,
    })
  })

  it('도메인 덮어쓰기가 id를 유지해 컬럼의 domainId 참조가 살아남는다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport(
      [domainSheet([['금액', '통화', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])], base,
    )
    const m = applyDictImport(base, plan, 'overwrite', fakeId)
    expect(Object.keys(m.domains)).toEqual(['d1'])
    expect(m.domains['d1']!.logicalType).toBe('DECIMAL(15,2)')
    expect(m.columns['c1']!.domainId).toBe('d1')
  })

  it('용어의 기본 도메인을 기존 도메인 이름으로 해석한다', () => {
    counter = 0
    const base = modelWithExisting()
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '금액', '']])], base)
    const m = applyDictImport(base, plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBe('d1')
  })

  it('같은 파일에서 새로 만들어진 도메인도 용어가 참조한다', () => {
    counter = 0
    const plan = planDictImport([
      termSheet([['회원번호', '', 'MBR_NO', '신규도메인', '']]),
      domainSheet([['신규도메인', '', 'CHAR(2)', '', '', '', '', '', '', '']]),
    ], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    const domainId = Object.values(m.domains)[0]!.id
    expect(Object.values(m.terms)[0]!.domainId).toBe(domainId)
  })

  it('해석할 수 없는 기본 도메인은 null이 된다', () => {
    counter = 0
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '없음', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBeNull()
  })

  it('기본 도메인이 비면 null이다', () => {
    counter = 0
    const plan = planDictImport([termSheet([['회원번호', '', 'MBR_NO', '', '']])], createEmptyModel())
    const m = applyDictImport(createEmptyModel(), plan, 'skip', fakeId)
    expect(Object.values(m.terms)[0]!.domainId).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-import-edits.test.ts`
Expected: FAIL — `Cannot find module './dict-import-edits.js'`

- [ ] **Step 3: `dict-import-edits.ts`를 구현한다**

```ts
import type { DictImportPlan, Domain, ProjectModel, Term, Word } from '@erdd/core'

export type DictImportMode = 'skip' | 'overwrite'

/** 실제로 반영된 건수. 뮤테이션 summary와 완료 토스트에 쓴다. */
export type DictImportApplied = { words: number; terms: number; domains: number }

/**
 * 적용 계획을 모델에 반영한다.
 *
 * 도메인 → 단어 → 용어 순으로 처리한다. 용어의 기본 도메인 이름을 "도메인을 반영한 뒤의
 * 모델"에서 해석해야 같은 파일에서 새로 만들어진 도메인도 잡히기 때문이다.
 *
 * 덮어쓰기는 반드시 기존 id를 유지한다 — 새 id를 발급하면 그 도메인을 쓰던 컬럼의
 * domainId 참조가 끊긴다.
 *
 * 한 producer 안에서 3종을 모두 처리하므로 Revision 1건, undo 한 번으로 원복된다.
 */
export function applyDictImport(
  model: ProjectModel, plan: DictImportPlan, mode: DictImportMode, newId: () => string,
): ProjectModel {
  const domains = { ...model.domains }
  const words = { ...model.words }
  const terms = { ...model.terms }

  for (const e of plan.entries) {
    if (e.kind !== 'domain') continue
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = domains[e.existingId]
      if (!cur) continue
      domains[e.existingId] = { ...cur, ...e.draft, id: e.existingId } satisfies Domain
    } else {
      const id = newId()
      domains[id] = { ...e.draft, id } satisfies Domain
    }
  }

  for (const e of plan.entries) {
    if (e.kind !== 'word') continue
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = words[e.existingId]
      if (!cur) continue
      words[e.existingId] = { ...cur, ...e.draft, id: e.existingId } satisfies Word
    } else {
      const id = newId()
      words[id] = { ...e.draft, id } satisfies Word
    }
  }

  // 도메인을 반영한 뒤의 목록에서 이름으로 해석한다.
  const domainIdByName = new Map(Object.values(domains).map((d) => [d.name.trim(), d.id]))

  for (const e of plan.entries) {
    if (e.kind !== 'term') continue
    const { domainName, ...rest } = e.draft
    const domainId = domainName === '' ? null : (domainIdByName.get(domainName) ?? null)
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = terms[e.existingId]
      if (!cur) continue
      terms[e.existingId] = { ...cur, ...rest, domainId, id: e.existingId } satisfies Term
    } else {
      const id = newId()
      terms[id] = { ...rest, domainId, id } satisfies Term
    }
  }

  return { ...model, domains, words, terms }
}

/** mode를 반영해 실제로 반영될 건수를 센다. */
export function countApplied(plan: DictImportPlan, mode: DictImportMode): DictImportApplied {
  const n = (kind: 'word' | 'term' | 'domain') => plan.entries
    .filter((e) => e.kind === kind && (mode === 'overwrite' || e.existingId === null)).length
  return { words: n('word'), terms: n('term'), domains: n('domain') }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-import-edits.test.ts`
Expected: PASS (8개)

- [ ] **Step 5: 가져오기 UI의 실패하는 테스트를 쓴다**

`apps/web/src/editor/dict-import-section.test.tsx`를 만든다:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { SheetData } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { useEditorStore } from './store.js'
import { buildWorkbookBlob } from './excel-file.js'
import { DictImportSection } from './dict-import-section.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000cc'
const mutate = vi.fn(() => Promise.resolve())
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<DictImportSection projectId={PROJECT_ID} />, { wrapper: w })
}

async function xlsxFile(sheets: SheetData[], name = 'dict.xlsx'): Promise<File> {
  const blob = await buildWorkbookBlob(sheets)
  return new File([blob], name, { type: blob.type })
}

const wordsSheet = (rows: string[][]): SheetData => ({
  key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'], rows,
})

afterEach(() => { cleanup(); mutate.mockClear(); useEditorStore.getState().reset() })

describe('DictImportSection', () => {
  it('파일을 고르면 신규·중복·오류 건수를 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', ''], ['', '', '', 'x']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => {
      expect(screen.getByText(/신규 1건/)).toBeInTheDocument()
    })
    expect(screen.getByText(/오류 1행/)).toBeInTheDocument()
  })

  it('이슈 목록에 사유를 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['', 'ORD', '', 'x']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => {
      expect(screen.getByText(/논리명이 비어 있습니다/)).toBeInTheDocument()
    })
  })

  it('가져오기 버튼이 mutate를 한 번 호출한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('중복 처리 라디오를 덮어쓰기로 바꿀 수 있다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(screen.getByRole('radio', { name: '덮어쓰기' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('radio', { name: '덮어쓰기' }))
    expect(screen.getByRole('radio', { name: '덮어쓰기' })).toBeChecked()
  })

  it('양식 다운로드 버튼이 있다', () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    expect(screen.getByRole('button', { name: /양식 다운로드/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-import-section.test.tsx`
Expected: FAIL — `Cannot find module './dict-import-section.js'`

- [ ] **Step 7: `dict-import-section.tsx`를 구현한다**

```tsx
import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { buildDictTemplateSheets, planDictImport, type DictImportPlan } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { downloadExcelWorkbook, readDictSheets } from './excel-file.js'
import { applyDictImport, countApplied, type DictImportMode } from './dict-import-edits.js'
import { Button } from '@/components/ui/button'

const MAX_ISSUES_SHOWN = 20

/** 사전 패널의 "가져오기" 섹션: 양식 다운로드 → 파일 선택 → 미리보기 → 일괄 적용. */
export function DictImportSection({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)
  const [plan, setPlan] = useState<DictImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<DictImportMode>('skip')

  const onTemplate = () => {
    void downloadExcelWorkbook(buildDictTemplateSheets(), 'erdd_사전양식.xlsx')
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : '양식을 내려받지 못했습니다')
      })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setPlan(null)
    setFileName(file.name)
    try {
      const sheets = await readDictSheets(file)
      setPlan(planDictImport(sheets, model, namingRules))
    } catch (err) {
      setFileName('')
      toast.error(err instanceof Error ? err.message : 'Excel 파일을 읽지 못했습니다')
    }
  }

  const onImport = () => {
    if (!plan) return
    const current = plan
    const currentMode = mode
    const applied = countApplied(current, currentMode)
    const summary = `Excel 사전 가져오기 (단어 ${applied.words} · 용어 ${applied.terms} · 도메인 ${applied.domains})`
    void mutate((m) => applyDictImport(m, current, currentMode, newId), { summary })
    setPlan(null)
    setFileName('')
    toast.success(summary)
  }

  const applied = plan ? countApplied(plan, mode) : null
  const nothingToApply = applied !== null && applied.words + applied.terms + applied.domains === 0

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          정해진 양식의 Excel로 단어·용어·도메인을 한 번에 등록합니다
        </p>
        <Button size="sm" variant="outline" onClick={onTemplate}><Download /> 양식 다운로드</Button>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="dict-import-file" className="text-sm font-medium">Excel 파일 선택</label>
        <input
          id="dict-import-file" type="file" accept=".xlsx"
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => { const f = e.target.files?.[0]; void onFile(f) }}
        />
      </div>

      {plan && (
        <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm">
            <span className="font-medium">{fileName}</span>
            {' — '}
            신규 {plan.total.created}건 · 중복 {plan.total.duplicated}건 · 오류 {plan.total.errored}행
          </p>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">중복 항목 처리</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio" name="dict-import-mode" className="size-4"
                checked={mode === 'skip'} onChange={() => setMode('skip')}
              />
              건너뛰기
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio" name="dict-import-mode" className="size-4"
                checked={mode === 'overwrite'} onChange={() => setMode('overwrite')}
              />
              덮어쓰기
            </label>
          </fieldset>

          {plan.issues.length > 0 && (
            <ul aria-label="가져오기 이슈" className="grid max-h-48 gap-0.5 overflow-y-auto text-xs">
              {plan.issues.slice(0, MAX_ISSUES_SHOWN).map((i, idx) => (
                <li key={idx} className={i.level === 'error' ? 'text-destructive' : 'text-key'}>
                  {i.row === null ? '' : `${i.row}행 · `}{i.message}
                </li>
              ))}
              {plan.issues.length > MAX_ISSUES_SHOWN && (
                <li className="text-muted-foreground">외 {plan.issues.length - MAX_ISSUES_SHOWN}건</li>
              )}
            </ul>
          )}

          <div className="flex justify-end">
            <Button type="button" disabled={nothingToApply} onClick={onImport}>
              <Upload /> 가져오기
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-import-section.test.tsx`
Expected: PASS (5개)

- [ ] **Step 9: `dict-panel.tsx`에 가져오기 섹션과 단어 폼 영문명을 통합하는 실패 테스트를 쓴다**

`apps/web/src/editor/dict-panel.test.tsx` 맨 아래(마지막 `})` 앞)에 추가한다:

```tsx
  it('가져오기 탭에 양식 다운로드와 파일 선택이 있다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    expect(screen.getByRole('button', { name: /양식 다운로드/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Excel 파일 선택')).toBeInTheDocument()
  })

  it('단어 편집 폼에 영문명 입력란이 있다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: '단어 추가' }))
    expect(screen.getByLabelText('영문명')).toBeInTheDocument()
  })
```

`loadModelWithDict`의 `createWord` 호출에 `englishName: null`을 추가한다(Task 1에서 이미 고쳤을 수 있다).

- [ ] **Step 10: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-panel.test.tsx`
Expected: FAIL — "가져오기" 버튼과 "영문명" 라벨을 찾지 못함

- [ ] **Step 11: `dict-panel.tsx`를 수정한다**

세 곳을 고친다:

1) import에 섹션을 추가한다:
```tsx
import { DictImportSection } from './dict-import-section.js'
```

2) `Section` 유니언에 `'import'`를 넣고, 섹션 토글 버튼 줄의 "미등록 단어" 버튼 뒤에 버튼 하나를 추가한다:
```tsx
type Section = 'words' | 'terms' | 'unregistered' | 'import'
```
```tsx
            <Button
              type="button" size="sm" variant={section === 'import' ? 'default' : 'outline'}
              onClick={() => setSection('import')}
            >
              가져오기
            </Button>
```
그리고 `{section === 'unregistered' && (...)}` 블록 뒤에 렌더를 추가한다:
```tsx
          {section === 'import' && <DictImportSection projectId={projectId} />}
```

3) `WordEditDialog`에 영문명 입력을 추가한다(파일 안 `function WordEditDialog(...)`). 네 곳을 고친다.

(a) 상태 추가 — `const [abbreviation, setAbbreviation] = useState(word?.abbreviation ?? '')` 아래에:
```tsx
  const [englishName, setEnglishName] = useState(word?.englishName ?? '')
```

(b) `onSave` 안, `const trimmedDescription = description.trim()` 아래에:
```tsx
    const trimmedEnglishName = englishName.trim()
```

(c) `createWord` 페이로드에서 Task 1이 넣은 임시 `englishName: null`을 실제 값으로 바꾸고, `updateWord` 페이로드에도 같은 줄을 추가한다(두 곳 모두 `abbreviation` 줄 아래):
```tsx
        englishName: trimmedEnglishName === '' ? null : trimmedEnglishName,
```

(d) "약어" 입력 블록과 "설명" 블록 사이에 넣는다:
```tsx
          <div className="grid gap-1.5">
            <Label htmlFor="word-english">영문명</Label>
            <Input
              id="word-english" className="font-mono" value={englishName}
              onChange={(e) => setEnglishName(e.target.value)}
            />
          </div>
```

**이벤트 값은 producer 진입 전에 캡처되어야 한다** — 위처럼 컨트롤드 state에서 뽑은 `const`를 넘기므로 안전하다(이 폼의 기존 필드들과 같은 방식).

- [ ] **Step 12: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/editor/dict-panel.test.tsx`
Expected: PASS

- [ ] **Step 13: 전 스위트 확인**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 PASS. web 171 → 186 근처

- [ ] **Step 14: 커밋**

```bash
git add apps/web/src/editor/dict-import-edits.ts apps/web/src/editor/dict-import-edits.test.ts \
  apps/web/src/editor/dict-import-section.tsx apps/web/src/editor/dict-import-section.test.tsx \
  apps/web/src/editor/dict-panel.tsx apps/web/src/editor/dict-panel.test.tsx
git commit -F - <<'EOF'
feat(web): Excel 사전 가져오기

사전 패널에 "가져오기" 섹션을 추가한다. 양식을 내려받아 채운 뒤 올리면
신규·중복·오류 건수와 이슈 목록을 미리 보여주고, 중복을 건너뛸지 덮어쓸지
고른 다음 한 번에 반영한다.

- 도메인 → 단어 → 용어 순으로 반영해 같은 파일의 새 도메인도 용어가 참조한다
- 덮어쓰기는 기존 id를 유지 — 그 도메인을 쓰던 컬럼의 domainId가 살아남는다
- 한 producer라 Revision 1건, undo 한 번으로 전체 원복
- 단어 편집 폼에 영문명 입력란 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGmJVyvDp2ExvUG93R38cX
EOF
```

---

## 완료 체크포인트

7개 태스크가 모두 끝나면:

- [ ] **전체 로컬 스위트**

```bash
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test_b' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck
```
Expected: 전부 그린. 대략 core 187 · web 186 · server 54 · typecheck 0 errors

- [ ] **whole-branch 리뷰** — superpowers:requesting-code-review 스킬의 code-reviewer 템플릿으로 서브에이전트 리뷰. Critical/Important가 나오면 수정 후 재리뷰.

- [ ] **워킹트리 확인** — `git status --short`가 비어 있고 `apps/web/vite.config.ts`가 원본 그대로인지(로컬 확인용으로 포트를 바꿨다면 `git checkout -- apps/web/vite.config.ts`).

- [ ] **코디네이터 보고** — `worker_done`. **main 병합과 브라우저 스모크는 하지 않는다.**

---

## 범위 밖 (이 계획에서 만들지 않는 것)

- **변경분 정의서 시트** — 스냅샷 diff 기반, Phase 3.
- **DDL 가져오기(역설계)** — Phase 4.
- 발주처별 양식 템플릿 커스터마이징.
- 테이블·컬럼 커스텀 항목 **값**의 Excel 업로드(내보내기만 지원).
- `ExportScope`의 `{ kind: 'tables' }` 선택 테이블 범위 UI.
- 공용/조직 표준 사전 fork(병행 트랙 소관).
