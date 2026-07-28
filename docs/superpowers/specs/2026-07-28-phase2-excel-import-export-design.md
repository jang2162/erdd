# Phase 2 — Excel 산출물/업로드 설계 (Excel Export / Dictionary Import)

**작성일:** 2026-07-28
**상태:** 승인됨 (사용자 "진행해줘")
**원 기획:** [docs/17-import-export.md](../../17-import-export.md) Phase 2 범위, [docs/12-grouping.md](../../12-grouping.md) 그룹 단위 내보내기

## 목표

설계 결과를 **감리 제출 가능한 Excel 정의서**로 내보내고, 기존 자산인 **단어·용어·도메인 사전을 Excel로 일괄 등록**할 수 있게 한다. 내보내기는 모델을 읽기만 하고, 업로드는 기존 op 파이프라인(producer + `diffModels`)을 그대로 타 Revision 1건으로 기록된다.

**범위 밖(다른 Phase):** "변경분 정의서" 시트(스냅샷 diff 기반 → Phase 3), DDL 가져오기·역설계(→ Phase 4), 발주처별 양식 템플릿 커스터마이징(로드맵 "추후 검토"), 테이블·컬럼 커스텀 항목 **값**의 Excel 업로드(내보내기만 지원).

## 핵심 결정 (사용자 확정)

- **Excel 라이브러리는 `exceljs@4.4.0`(MIT), 생성·파싱 모두 클라이언트.** 기존 DDL·이미지 내보내기가 전부 클라이언트 생성이고 모델이 이미 브라우저 스토어에 통째로 있다. 서버 엔드포인트·인증·멀티파트 업로드가 필요 없다. `apps/web`에만 추가하고 **동적 `import()`로 lazy load**해 초기 번들에 영향을 주지 않는다. (코디네이터 승인 완료)
- **단일 워크북(.xlsx) + 시트 선택.** 5개 시트를 한 파일에 담되 다이얼로그에서 포함할 시트를 체크박스로 고른다 — "사전만", "정의서만" 제출이 가능하면서 zip 의존성이 필요 없다.
- **테이블정의서는 단일 시트 flat.** 한 시트에 모든 컬럼을 한 행씩, 앞쪽에 `그룹·테이블 논리명·테이블 물리명`이 반복된다. 테이블마다 시트를 만들면 31자 시트명 제한·중복 이름 처리가 붙고 테이블 50개면 시트가 50개가 된다.
- **진입 UI는 기존 것을 확장.** 내보내기는 `export-dialog.tsx`의 세 번째 섹션 "Excel", 사전 업로드는 성격이 다른 쓰기 동작이므로 기존 "사전" 패널(`dict-panel.tsx`)의 "가져오기" 섹션.
- **`Word`에 영문명(`englishName`) 추가 — 마이그레이션 0007.** 기획의 단어사전 시트가 `논리명·약어·영문명·설명`인데 모델에 영문명이 없었다. 다음 fork sub-project가 행안부 표준 사전(단어명/영문약어명/영문명 구조)을 가져올 때도 바로 쓰인다. (코디네이터가 0007 번호 사용을 승인 — 병행 트랙과는 격리 DB·별도 브랜치라 병합 시점에 코디네이터가 번호를 재조정한다.)
- **업로드 중복 처리는 업로드 전체 일괄 선택**(건너뛰기/덮어쓰기 라디오). 미리보기에 "신규 N건 · 중복 M건 · 오류 K행" 요약과 이슈 목록을 보여준다. 항목별 선택은 수백 행 업로드에서 조작 부담만 크다.
- **도메인 업로드는 내보내기 양식 전 컬럼을 파싱한다**(분류·방언별 타입 4종·기본값·허용값·설명). 내보낸 파일을 그대로 다시 올릴 수 있는 **완전 왕복 계약**이 성립한다.
- **범위 선택기를 공용 컴포넌트로 뽑고 그룹 드롭다운으로 확장한다.** 지금은 그룹 뷰로 전환한 상태에서만 "현재 그룹" 버튼이 나오는데, 기획의 "그룹별로 테이블정의서를 나눠 담당자별로 전달" 시나리오에는 뷰 전환 없이 아무 그룹이나 고를 수 있어야 한다. DDL 섹션도 같은 컴포넌트를 쓰므로 함께 개선된다.

## 아키텍처 / 방침

**계층 분리가 이 설계의 중심이다.** `generateDdl`(core, 순수) + 다운로드(web) 패턴을 그대로 따른다.

| 계층 | 파일 | 책임 |
|---|---|---|
| core | `excel-sheets.ts` | `buildExcelSheets(model, opts)` → `SheetData[]`(시트명·헤더·문자열 행). 양식의 유일한 정의처 |
| core | `excel-import.ts` | `planDictImport(sheets, model, rules?)` → 신규/중복/오류로 분류된 적용 계획 |
| core | `naming.ts` | `decomposeByWords` 추출(용어사전 "구성 단어" 산출 + 기존 중복 알고리즘 통합) |
| web | `excel-file.ts` | exceljs 동적 import로 `SheetData[]` ↔ `.xlsx` 인코딩/디코딩 + 다운로드 |
| web | `dict-import-edits.ts` | 계획 → producer(`ProjectModel → ProjectModel`). 단일 뮤테이션 = Revision 1건 |

양식 규칙·검증·중복 판정이 전부 core의 순수 함수라 node 환경 테스트로 검증되고, web 테스트는 얇은 xlsx 왕복 1건만 담당한다. `packages/core`는 IO·런타임 의존성 free 원칙을 유지한다(exceljs는 web에만).

**왕복 계약:** 내보내기 헤더 배열과 업로드 파서가 **같은 상수**를 공유한다. 단어·용어·도메인 3시트는 내보낸 파일을 그대로 다시 올릴 수 있다. 유일한 예외는 용어사전의 `구성 단어`(파생값 — 업로드 시 무시). 양식 다운로드도 같은 빌더로 헤더만 있는 3시트 워크북을 만들어, 양식이 코드 한 곳에서만 정의된다.

## 전역 제약 (Global Constraints)

- core는 IO·런타임 의존성 free. exceljs는 `apps/web` `dependencies`에만, **정적 import 금지**(동적 `import()`만).
- 새 op 엔티티는 없다. `ENTITY_KINDS`·`COLLECTION_BY_KIND`·`TABLE_BY_KIND`·`integrity.ts`는 건드리지 않는다. 사전 업로드는 기존 `word`/`term`/`domain` 엔티티의 create/update op로만 나간다.
- 하위호환: `Word.englishName`은 `z.string().nullable().default(null)`(옛 op 페이로드·옛 스냅샷 파싱). `z.infer` 출력 타입상 키는 **필수**이므로 `Word` 리터럴(fixtures, model-store 반환, 테스트)에 전부 채운다 — typecheck-driven으로 훑는다.
- 마이그레이션 0007은 append-only. **격리 DB `erdd_dev_b`/`erdd_test_b`에만 적용**한다(공유 `erdd`/`erdd_test`는 병합 시점에 코디네이터가 처리).
- 덮어쓰기는 **기존 id를 유지한 update**. 새 id를 발급하면 그 도메인을 참조하던 컬럼의 `domainId`가 끊긴다.
- 이벤트 값은 producer 진입 전 즉시 캡처(`serializeMutation`이 producer를 마이크로태스크로 지연 실행).
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. UI 카피 한국어.
- `docs/superpowers/HANDOFF.md`·`docs/91-checklist.md`는 이 트랙에서 수정하지 않는다(코디네이터가 두 트랙 병합 후 일괄 갱신).

## 확인된 기존 인터페이스

- `ProjectModel`(core): `{ tables, columns, relationships, indexes, notes, tableGroups, domains, words, terms, customFields }`.
- `DdlScope` = `{kind:'all'} | {kind:'group',groupId} | {kind:'tables',tableIds}` (`ddl.ts`). `selectTables`가 물리명 정렬로 필터.
- `customFieldsFor(model, target)` — order 오름차순(동률 name). `resolveCustomValue(entity, field)` — 입력값 > 정의 기본값 > `''`.
- `resolveColumn(column, model, dialect)` — 도메인 해석. **논리 타입·기본값은 방언과 무관**하므로 Excel 빌더는 `resolveColumn`을 쓰지 않고 도메인을 직접 읽어 방언 인자를 요구하지 않는다.
- `generatePhysicalName(logicalName, words, terms, rules)` — 용어 완전일치 우선, 그다음 최장일치 그리디 분해. 내부 while 루프가 분해 알고리즘의 원본.
- `dict-edits.ts`의 `usesWord`가 그 최장일치 루프를 **재구현**하고 있다(중복). `decomposeByWords` 추출로 통합한다.
- web: `export-dialog.tsx`(162줄, DDL·이미지 2섹션 토글), `dict-panel.tsx`(428줄, 단어·용어·미등록 3섹션), `useModelMutation(projectId) → mutate(producer, {summary})`, `newId()`(uid.ts), `useEditorStore`의 `namingRules`.
- server: `modelWords` = `model_words`(id, project_id, logical_name, abbreviation, description). 마이그레이션 0006까지 존재.

## 파일 구조

**core**: `model.ts`(Word.englishName), `naming.ts`(decomposeByWords 추출), `excel-sheets.ts`+test(신규), `excel-import.ts`+test(신규), `ddl.ts`(`ExportScope` 별칭), `index.ts`.
**server**: `db/schema.ts`(`model_words.english_name`), `drizzle/0007_*.sql`, `services/model-store.ts`.
**web**: `package.json`(exceljs), `excel-file.ts`+test(신규), `dict-import-edits.ts`+test(신규), `export-scope-select.tsx`+test(신규), `dict-import-section.tsx`+test(신규), `export-dialog.tsx`(Excel 섹션), `dict-panel.tsx`(가져오기 섹션 + 영문명 입력), `dict-edits.ts`(decomposeByWords 위임).

---

## 항목 1: core — Word 영문명 + 단어 분해 헬퍼

```ts
// model.ts
export const WordSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  abbreviation: z.string(),
  englishName: z.string().nullable().default(null),   // 신규: 회원 → MEMBER
  description: z.string().nullable(),
})
```

```ts
// naming.ts
export type WordSegment = { text: string; word: Word | null }

/**
 * 논리명을 단어 사전으로 최장일치 그리디 분해한다.
 * 매칭 실패 구간은 연속으로 모아 word: null 세그먼트 하나가 된다.
 * generatePhysicalName의 2단계와 동일 알고리즘 — 그쪽이 이 함수를 호출한다.
 */
export function decomposeByWords(logicalName: string, words: Record<string, Word>): WordSegment[]
```

- `generatePhysicalName`의 2단계를 `decomposeByWords` 호출로 교체한다: `parts = 매칭 세그먼트의 abbreviation`, `unknownWords = 미매칭 세그먼트의 text`. **동작은 완전히 동일**해야 하며 기존 naming 테스트가 그대로 통과하는 것이 근거다.
- `dict-edits.ts`의 `usesWord`도 `decomposeByWords(name, words).some((s) => s.word?.id === wordId)`로 교체한다(용어 완전일치 단축은 그대로 유지). 중복 구현이 사라진다.
- `Word` 리터럴에 `englishName`을 채운다(typecheck가 강제).

**테스트**: `decomposeByWords`의 최장일치·미매칭 구간 병합·빈 문자열·빈 사전. `generatePhysicalName` 기존 동작 불변(회귀). Word op 왕복에 englishName 포함. 하위호환 — `englishName` 없는 페이로드 파싱 시 `null`. `diffModels`가 옛 스냅샷(englishName 키 없음)에서 빈 changes update op를 만들지 않음.

## 항목 2: server — 스키마 + 마이그레이션 0007

- `db/schema.ts`: `modelWords`에 `englishName: text('english_name')`(nullable).
- `drizzle-kit generate` → `0007_*.sql` → **`erdd_dev_b`·`erdd_test_b`에만** migrate.
- `model-store.ts`: `loadProjectModel`의 words 매핑에 `englishName: r.englishName ?? null`.
- `TABLE_BY_KIND`·`KIND_LABEL`·`withUuidIds`는 변경 없음(새 엔티티가 아니라 기존 엔티티의 필드 추가).

**테스트(erdd_test_b)**: word create/update op에 englishName이 왕복. englishName 없는 옛 op 페이로드가 400이 아니라 정상 적용되고 `null`로 읽힘.

## 항목 3: core — Excel 시트 빌더 (`excel-sheets.ts`)

```ts
// ddl.ts — 이름이 DDL에 묶여 있지 않도록 별칭을 추가한다(기존 DdlScope는 유지, 호출부 무변경)
export type ExportScope = DdlScope

// excel-sheets.ts
export type ExcelSheetKey = 'tableList' | 'tableSpec' | 'words' | 'terms' | 'domains'
export const EXCEL_SHEET_KEYS: readonly ExcelSheetKey[]          // 고정 순서
export const EXCEL_SHEET_NAME: Record<ExcelSheetKey, string>     // 시트명(한국어)

export type SheetData = { key: ExcelSheetKey; name: string; headers: string[]; rows: string[][] }

export function buildExcelSheets(
  model: ProjectModel, opts?: { scope?: ExportScope; sheets?: ExcelSheetKey[] },
): SheetData[]

export function buildDictTemplateSheets(): SheetData[]   // words/terms/domains, 헤더만
```

**모든 셀은 문자열이다.** 물리명 `1234`가 숫자로 변하거나 `0001`의 앞 0이 날아가는 사고를 막고, 업로드 파서와 표현이 대칭이 된다(순번이 좌측 정렬로 보이는 것은 감수).

시트명·헤더:

| key | 시트명 | 헤더 |
|---|---|---|
| `tableList` | 테이블 목록 | 그룹 │ 논리명 │ 물리명 │ 설명 │ *(테이블 커스텀 항목…)* |
| `tableSpec` | 테이블정의서 | 그룹 │ 테이블 논리명 │ 테이블 물리명 │ 순번 │ 논리명 │ 물리명 │ 도메인 │ 타입 │ PK │ NOT NULL │ 기본값 │ 설명 │ *(컬럼 커스텀 항목…)* |
| `words` | 단어사전 | 논리명 │ 약어 │ 영문명 │ 설명 |
| `terms` | 용어사전 | 용어 │ 구성 단어 │ 물리명 │ 기본 도메인 │ 설명 |
| `domains` | 도메인정의서 | 이름 │ 분류 │ 논리 타입 │ PostgreSQL │ MySQL │ Oracle │ MSSQL │ 기본값 │ 허용값 │ 설명 |

- `WORD_HEADERS`·`TERM_HEADERS`·`DOMAIN_HEADERS`를 `as const` 상수로 export한다 — `excel-import.ts`가 같은 상수를 import해 왕복 계약이 컴파일 타임에 묶인다.
- **커스텀 항목 컬럼**: `customFieldsFor(model, 'table'|'column')` 순서대로 헤더에 `field.name`을 붙이고 값은 `resolveCustomValue(entity, field)`(기본값 라이브 해석). 정의가 0개면 컬럼이 붙지 않는다.
- **scope는 `tableList`/`tableSpec`에만 적용된다.** 사전 3시트는 그룹 개념이 없는 프로젝트 전역 자산이라 항상 전체를 낸다.
- 정렬: 테이블은 (그룹명, 테이블 물리명), 컬럼은 `order`, 단어·용어는 논리명, 도메인은 이름. 미배정 테이블의 그룹 칸은 빈 문자열.
- `순번`은 테이블 안에서의 1-based 위치(raw `order` 값이 아님).
- `도메인` = 도메인 이름 또는 `''`. `타입` = 도메인 지정 시 `domain.logicalType`, 아니면 `column.type`. `기본값` = `column.defaultValue`가 비어 있지 않으면 그 값, 아니면 도메인 기본값, 없으면 `''`(`resolveColumn`의 해석 규칙과 동일).
- `PK`·`NOT NULL`은 `'Y'` 또는 `''`.
- `허용값`·`구성 단어`는 `', '` 조인. `구성 단어`는 `decomposeByWords(term.logicalName, model.words)` 세그먼트의 `text`를 **매칭·미매칭 모두** 이어붙인다(용어 원문이 복원되어야 정직하다).
- **컬럼이 0개인 테이블은 `tableSpec`에 행을 만들지 않는다**(테이블 목록에는 나온다). DDL이 0컬럼 테이블을 제외하는 정책과 일관.
- `opts.sheets` 미지정 시 5개 전부, 지정 시 `EXCEL_SHEET_KEYS` 순서를 유지해 반환.

**테스트**: 5시트 헤더·행 내용, scope=group 필터가 tableList/tableSpec만 좁히고 사전 3시트는 그대로, 커스텀 항목 컬럼이 정의 순서대로 붙고 미입력이 기본값으로 채워짐, 정의 0개면 컬럼 없음, 0컬럼 테이블이 tableSpec에서 제외되고 tableList에는 있음, 도메인 지정 컬럼의 타입·기본값 해석, 미배정 테이블의 그룹 빈칸, `sheets` 부분 선택, `buildDictTemplateSheets`가 3시트 헤더만.

## 항목 4: core — Excel 사전 파서 (`excel-import.ts`)

```ts
export type DictSheetKey = 'words' | 'terms' | 'domains'
export type RawSheet = { key: DictSheetKey; headers: string[]; rows: string[][] }

export type DictImportIssue = {
  sheet: DictSheetKey
  row: number | null              // 1-based 데이터 행 번호(엑셀 행 = row+1). 시트 전체 문제면 null
  level: 'error' | 'warning'      // error=행 스킵, warning=행 등록하되 일부 값 무시
  message: string
}

export type TermDraft = Omit<Term, 'id' | 'domainId'> & { domainName: string }
export type DictImportEntry =
  | { kind: 'word';   row: number; draft: Omit<Word, 'id'>;   existingId: string | null }
  | { kind: 'term';   row: number; draft: TermDraft;          existingId: string | null }
  | { kind: 'domain'; row: number; draft: Omit<Domain, 'id'>; existingId: string | null }

export type DictImportCounts = { created: number; duplicated: number; errored: number }
export type DictImportPlan = {
  entries: DictImportEntry[]
  issues: DictImportIssue[]
  total: DictImportCounts
  bySheet: Record<DictSheetKey, DictImportCounts>
}

export function planDictImport(
  sheets: RawSheet[], model: ProjectModel, rules?: NamingRules,
): DictImportPlan
```

**계획만 세우고 모델을 바꾸지 않는다** — 미리보기를 그리고 나서 사용자가 건너뛰기/덮어쓰기를 고른 뒤 적용하기 때문이다.

공통 규칙:
- 헤더는 `trim()` 후 상수와 정확 일치로 매칭. **알려지지 않은 헤더는 무시**(추가 컬럼 허용 — 관대한 파싱 정책). 같은 헤더가 두 번이면 첫 번째를 쓴다.
- 키 헤더(words `논리명`, terms `용어`, domains `이름`)가 없으면 그 시트 전체를 건너뛰고 `row: null` error 이슈 1건.
- 모든 셀이 빈 문자열인 행은 조용히 스킵(이슈 없음).
- **파일 내 중복**: 같은 시트에서 이미 나온 키와 같으면 error("N행과 중복됩니다") + 스킵.
- **기존 중복 판정**: 키를 `trim()`한 값의 정확 일치(words/terms는 `logicalName`, domains는 `name`) → `existingId`.
- **처리 순서는 domains → words → terms.** 용어의 `기본 도메인`을 검증할 때 이번 파일에서 새로 생기는 도메인 이름도 알아야 한다.

시트별:
- **words** — 논리명 빈 값이면 error. `약어`는 빈 문자열 허용(등록됨). `영문명`·`설명`은 빈 값 → `null`.
- **terms** — 용어 빈 값이면 error. `물리명`이 비면 `rules`가 주어졌을 때 `generatePhysicalName(용어, model.words, {}, rules)`로 자동 생성한다(용어 사전은 `{}`를 넘긴다 — 자기 자신에 완전일치해 단축되는 것을 막고 단어 분해만 쓰기 위해). `rules`가 없거나 생성 결과가 빈 문자열이면 error. `기본 도메인`이 비어 있지 않은데 기존 도메인·이번 파일 도메인 어디에도 없으면 **warning**(행은 등록되고 적용 단계에서 `domainId: null`). `구성 단어` 컬럼은 읽지 않는다.
- **domains** — `이름` 또는 `논리 타입`이 비면 error(타입 없는 도메인은 무의미). 방언 4컬럼·`기본값`·`분류`·`설명`은 빈 값 → `null`. `허용값`은 `,`로 분리 → trim → 빈 항목 제거.

`total`/`bySheet`: `created` = `existingId === null`인 entry 수, `duplicated` = `existingId !== null`, `errored` = level `'error'` 이슈 수.

**테스트**: 3시트 정상 파싱, 헤더 순서가 뒤바뀌어도 이름으로 매칭, 미지의 추가 컬럼 무시, 키 헤더 누락 시 시트 스킵 + 이슈, 빈 행 스킵, 키 빈 값 error, 파일 내 중복 error, 기존 항목이 `existingId`로 잡힘, 도메인 허용값 쉼표 분해/빈 값 → `[]`, 방언 빈 칸 → `null`, 용어 물리명 자동 생성(rules 있음)과 error(rules 없음), 미지의 기본 도메인이 warning이면서 entry는 남음, 같은 파일에서 새로 만들어진 도메인 이름은 warning이 아님, counts 집계.

## 항목 5: web — xlsx 인코딩/디코딩 (`excel-file.ts`)

```ts
export async function downloadExcelWorkbook(sheets: SheetData[], fileName: string): Promise<void>
export async function buildWorkbookBlob(sheets: SheetData[]): Promise<Blob>
export async function readDictSheets(file: Blob): Promise<RawSheet[]>
```

- `const ExcelJS = (await import('exceljs')).default` — 정적 import 금지. Excel 섹션을 열거나 파일을 고를 때만 로드된다.
- 쓰기: 시트마다 `addWorksheet(name)`, 1행에 헤더(bold), `views: [{ state: 'frozen', ySplit: 1 }]`, `autoFilter` 헤더 행, 컬럼 너비는 헤더/값 길이 기반(상한 60).
- 읽기: `workbook.xlsx.load(await file.arrayBuffer())`. `EXCEL_SHEET_NAME`의 words/terms/domains 시트명과 일치하는 워크시트만 채택하고, **하나도 없으면 throw**("단어사전·용어사전·도메인정의서 시트를 찾을 수 없습니다"). 1행=헤더, 2행부터 데이터, 열 수는 헤더 길이에 맞춘다(부족분은 `''`).
- 셀 → 문자열 정규화 `cellText(v)`: `null`/`undefined` → `''`, string → 그대로, number/boolean → `String`, Date → `YYYY-MM-DD`, richText → 조각 `text` 이어붙임, formula → `result` 재귀, hyperlink → `text`. 마지막에 `trim()`은 파서가 하므로 여기서는 하지 않는다.
- 다운로드는 기존 패턴(Blob → `URL.createObjectURL` → `<a download>` → revoke)을 따른다.

**리스크와 대응**: exceljs가 jsdom 환경에서 브라우저 번들로 해석될 수 있다. 이 태스크를 **왕복 테스트부터** 세워 조기에 드러내고, 문제가 있으면 해당 테스트 파일에만 `// @vitest-environment node` 도크블록을 단다. 로직 대부분이 core에 있어 영향 범위가 작다.

**테스트**: `buildWorkbookBlob` → `readDictSheets` 왕복으로 헤더·셀 값이 보존됨, 시트가 하나도 없는 워크북에서 throw, 숫자·boolean 셀이 문자열로 정규화됨, 빈 셀이 `''`.

## 항목 6: web — 공용 범위 선택기 + 내보내기 다이얼로그 Excel 섹션

```tsx
// export-scope-select.tsx  (ExportScope 별칭은 항목 3에서 이미 추가됨)
export function ExportScopeSelect(
  { value, onChange }: { value: ExportScope; onChange: (s: ExportScope) => void },
)
```

- "전체" 버튼 + 그룹 `<select>`(그룹이 1개 이상일 때만 렌더). 그룹을 고르면 `{kind:'group', groupId}`, "전체"를 누르면 `{kind:'all'}`.
- `{kind:'tables'}`는 UI에서 만들지 않는다(타입은 남겨 둔다 — 향후 선택 테이블 내보내기용).
- `export-dialog.tsx`의 DDL 섹션 범위 UI를 이 컴포넌트로 교체하고, Excel 섹션도 같은 컴포넌트를 쓴다. 다이얼로그를 열 때 `activeGroupView`를 초기 범위로 반영하는 기존 동작은 유지.

Excel 섹션:
- 범위 선택기 + 시트 5개 체크박스(기본 전부 체크). 전부 해제하면 다운로드 버튼 비활성.
- 다운로드 → `buildExcelSheets(model, {scope, sheets})` → `downloadExcelWorkbook`. 파일명은 `erdd_정의서.xlsx`, 그룹 범위면 `erdd_정의서_{그룹명}.xlsx`(파일명 금지문자 `\/:*?"<>|`는 `_`로 치환).
- 실패 시 `toast.error`(이미지 내보내기와 동일 패턴).

**테스트**: 범위 선택기의 전체/그룹 전환과 그룹 0개일 때 select 미표시, DDL 섹션이 새 선택기로 그룹을 고르면 미리보기가 그 그룹으로 좁혀짐, Excel 섹션 체크박스 토글과 전부 해제 시 버튼 비활성, 다운로드가 선택한 시트 키로 빌더를 호출.

## 항목 7: web — 사전 가져오기 (producer + UI)

```ts
// dict-import-edits.ts
export function applyDictImport(
  model: ProjectModel, plan: DictImportPlan,
  mode: 'skip' | 'overwrite', newId: () => string,
): ProjectModel
```

- **적용 순서 domains → words → terms.** 용어의 `domainName`은 **도메인을 반영한 뒤의 모델**에서 이름으로 해석한다(같은 파일에서 새로 만들어진 도메인도 잡힌다). 해석 실패 시 `domainId: null`.
- `existingId !== null`이고 `mode === 'skip'`이면 건너뛴다. `mode === 'overwrite'`면 `{ ...기존, ...draft, id: existingId }` — **id를 유지**해 `column.domainId` 참조를 지킨다.
- 신규는 `newId()`로 id를 발급한다(주입받아 producer를 순수·테스트 가능하게 유지).
- 한 producer 안에서 3종을 모두 처리 → 단일 뮤테이션 → Revision 1건, undo 1회로 원복.

```tsx
// dict-import-section.tsx
export function DictImportSection({ projectId }: { projectId: string })
```

- "양식 다운로드" 버튼 → `buildDictTemplateSheets()` → `erdd_사전양식.xlsx`. (내보내기 다이얼로그가 아니라 여기 둔다 — 올릴 사람이 양식을 받는 자리다.)
- `<input type="file" accept=".xlsx">` → `readDictSheets` → `planDictImport(sheets, model, namingRules)` → 계획 state. 파싱 실패는 `toast.error`.
- 요약 "신규 N건 · 중복 M건 · 오류 K행", 중복 처리 라디오(건너뛰기 기본 / 덮어쓰기), 이슈 목록(최대 20건 + "외 N건").
- "가져오기" → `mutate((m) => applyDictImport(m, plan, mode, newId), { summary })`. summary는 실제 반영 건수 기준 `Excel 사전 가져오기 (단어 N · 용어 M · 도메인 K)`. 완료 후 state 리셋 + 성공 토스트.
- `dict-panel.tsx`의 `Section` 유니언에 `'import'`를 추가하고 "가져오기" 버튼으로 전환한다. dict-panel이 이미 428줄이라 섹션 본체는 별도 파일로 둔다.
- `dict-panel.tsx` 단어 편집 폼에 **영문명** 입력란을 추가한다(항목 1의 필드가 UI로 노출되는 자리).

**테스트**: `applyDictImport`의 skip/overwrite 각각, 덮어쓰기가 id를 유지(참조 컬럼의 domainId가 그대로), 같은 파일의 새 도메인을 용어가 참조, 해석 실패 도메인은 `null`, 적용 순서(도메인 먼저)가 결과에 반영됨. UI: 파일 선택 후 요약·이슈 렌더, 라디오 전환, 가져오기가 mutate를 1회 호출, 양식 다운로드, 단어 폼 영문명 입력·저장.

## 실행

하나의 계획으로 SDD. 순서: 1 core 모델·헬퍼 → 2 서버·마이그0007 → 3 시트 빌더 → 4 사전 파서 → 5 xlsx 왕복 → 6 범위 선택기·내보내기 UI → 7 가져오기 producer·UI. 태스크마다 독립 테스트.

기준선(core 146 · web 159 · server 52 · `pnpm -r typecheck` 0 errors)에서 시작해 태스크마다 그린 유지. 서버 테스트는 격리 DB `erdd_test_b`로 돌린다. 전체 스위트 체크포인트 → whole-branch 리뷰 → 코디네이터 보고(브라우저 스모크·main 병합은 코디네이터 담당).

## 범위 밖 (후속)

- **변경분 정의서 시트** — 스냅샷 diff 기반. Phase 3의 diff 화면과 함께 설계한다.
- **DDL 가져오기(역설계)** — Phase 4.
- **발주처별 양식 템플릿 커스터마이징** — 로드맵 "추후 검토".
- **테이블·컬럼 커스텀 항목 값의 Excel 업로드** — 내보내기만 지원한다. 값 업로드는 테이블·컬럼 식별(물리명? id?) 규칙이 따로 필요해 별도 사이클이 맞다.
- **선택 테이블 범위 내보내기** — `ExportScope`의 `{kind:'tables'}`는 타입에만 존재하고 UI를 만들지 않는다.
- **공용/조직 표준 사전 fork** — 병행 중인 fork sub-project 소관. 이번 업로드는 프로젝트 로컬 사전만 대상이다.
