# Phase 2 — 명명 체계 설계 (Naming: 단어/용어 사전·물리명 자동생성·경고)

**작성일:** 2026-07-26
**상태:** 승인됨 (사용자 "진행해줘")
**원 기획:** docs/13-naming.md Phase 2 범위

## 목표

단어–용어–도메인 3단 체계로 논리명↔물리명을 일관 관리한다. 논리명 입력 시 물리명과 기본 도메인을 자동 제안하고, 미등록 단어·용어 불일치·길이 초과·예약어·물리명 중복을 **경고 수준**으로 알린다(작업 흐름 비차단, 물리명 중복만 오류 강조하되 저장 허용). 도메인(sub-project #1)은 완료됨 — Term이 기본 도메인을 참조한다.

**범위 밖(후속 sub-project):** Excel 사전 업로드(Excel 사이클), 공용/조직 사전 fork·재동기화(fork 사이클).

## 핵심 결정 (사용자 확정)

- **단어/용어 = 모델 op 엔티티**(도메인과 동일). undo·스냅샷·향후 fork가 도메인과 일원화된 패턴. 자동생성·경고는 인메모리 모델에서 직접 조회. (대량 표준사전 임포트의 op-로그 비대는 이후 Excel/fork 사이클에서 공용 리소스 참조 전략으로 해결.)
- **명명 규칙 = 프로젝트 설정**(버전 모델 아님). 선례 `projects.dialects`처럼 `projects.namingRules` jsonb.
- **자동생성 = 수동 우선**: 논리명 commit 시 물리명이 비어 있을 때만 자동 채움. 비어있지 않으면 덮지 않음("물리명 재생성" 버튼 제공).
- **단어/용어 삭제 = 자유**(사용처 안내만). 컬럼은 word/term id를 들지 않고 물리명 문자열만 생성·저장하므로 참조 무결성 대상이 아니다.

## 아키텍처 / 방침

- `packages/core`는 IO·의존성 free. 모델 변경은 op 엔진으로만. 뮤테이션은 producer+diff 단일 뮤테이션.
- 단어/용어는 7번째 도메인에 이은 8·9번째 op 엔티티. **ENTITY_KINDS 순서**: `term.domainId → domain` FK 때문에 term은 domain 뒤. word는 무의존. → `['tableGroup','domain','word','term','table','column','relationship','index','note']`.
- 예약어 판별은 `packages/core/src/identifier.ts`의 예약어 세트 재사용(신규 export `isReservedWord`).
- 새 런타임 의존성 없음.

## 전역 제약 (Global Constraints)

- core IO·의존성 free. 새 의존성 금지.
- 새 엔티티 `word`,`term`을 6곳에 일관 등록: core `ENTITY_KINDS`·`ENTITY_SCHEMAS`·`COLLECTION_BY_KIND`·`applyOps` spread + `integrity.ts`(union+collections) + server `TABLE_BY_KIND`. **term은 ENTITY_KINDS에서 domain 뒤**(FK 순서 — 스냅샷 복원 단일 배치 안전).
- `term.domainId`는 존재하는 도메인 참조(integrity). 단어/용어 자체 삭제는 참조 가드 없음(컬럼이 id 참조 안 함).
- 명명 규칙은 `projects.namingRules` jsonb(버전 아님). 마이그레이션 append-only(0005).
- 하위호환: 새 컬렉션(words/terms)은 `ProjectModelSchema`에서 `.default({})`, `namingRules`는 서버 로드 시 기본값 보충 — 옛 스냅샷/프로젝트 파싱 안전. 스냅샷 복원은 이미 `{...createEmptyModel(), ...snap.model}`로 정규화됨(sub-project #1).
- 커밋 명시 파일만. UI 카피 한국어. producer 진입 전 이벤트 값 즉시 캡처.

## 확인된 기존 인터페이스

- `ProjectModel`(core): `{ tables, columns, relationships, indexes, notes, tableGroups, domains }`. `createEmptyModel()`.
- op 엔진(`op.ts`): `ENTITY_KINDS` 등 4곳. `diff.ts`는 ENTITY_KINDS 순회. `integrity.ts` union+collections. `applyOps` 초기 spread.
- `identifier.ts`: 방언별 예약어 `RESERVED`(내부), `quoteIdentifier`. → `isReservedWord(name, dialect)` export 추가.
- `projects` 테이블: `dialects jsonb $type<Dialect[]>`. project 라우터 `project.update`(name/description/dialects). model-store `TABLE_BY_KIND`/`loadProjectModel`/`persistOps`.
- edit-panel: 논리/물리명 `CommitInput`(onCommit→mutate updateTable/updateColumn). 도메인 관리 `domain-panel.tsx` 패턴.
- 스냅샷 복원 정규화: `snapshot.ts` restore가 `{...createEmptyModel(), ...snap.model}` 사용(신규 컬렉션 자동 보충).

## 파일 구조

**core**: `model.ts`(Word/TermSchema, words/terms, createEmptyModel), `op.ts`(등록·ENTITY_KINDS), `integrity.ts`(term.domainId), `identifier.ts`(isReservedWord export), `naming.ts`+test(generatePhysicalName), `naming-warnings.ts`+test(collectNamingWarnings), `index.ts`.
**server**: `db/schema.ts`(model_words/model_terms + projects.namingRules), `drizzle/0005_*.sql`, `services/model-store.ts`(words/terms), `routers/project.ts`(namingRules 갱신·조회).
**web**: `dict-edits.ts`+test(word/term producer), `dict-panel.tsx`(단어/용어 관리), `naming.ts` 클라 래퍼(제안·경고 조회), `edit-panel.tsx`(자동생성 통합·경고 인라인), 노드 경고 배지(`table-node.tsx`), `naming-check.tsx`(명명 검사 화면), 프로젝트 설정(명명 규칙).

---

## 항목 1: core 데이터 모델 + op 엔티티 (word/term)

```ts
export const WordSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),   // "회원"
  abbreviation: z.string(),  // "MBR"
  description: z.string().nullable(),
})
export type Word = z.infer<typeof WordSchema>

export const TermSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),   // "회원번호"
  physicalName: z.string(),  // "MBR_NO"
  domainId: z.string().nullable(),
  description: z.string().nullable(),
})
export type Term = z.infer<typeof TermSchema>
```
- `ProjectModelSchema`에 `words: z.record(z.string(), WordSchema).default({})`, `terms: z.record(z.string(), TermSchema).default({})`. `createEmptyModel`에 `words:{}, terms:{}`.
- `op.ts`: ENTITY_KINDS `['tableGroup','domain','word','term','table','column','relationship','index','note']` + SCHEMAS/COLLECTION/applyOps spread.
- `integrity.ts`: union에 `'word'|'term'` 추가, collections에 words/terms, `term.domainId` 참조 검사(null이면 skip).

**테스트**: word/term op 왕복. term이 없는 도메인 참조 시 무결성 위반. `.default({})` 하위호환(words/terms 생략 파싱→{}).

## 항목 2: 물리명 자동생성 엔진 (core `naming.ts`)

```ts
export type NamingRules = { case: 'UPPER_SNAKE' | 'lower_snake'; separator: '_' | ''; maxLengthBytes: number }
export const DEFAULT_NAMING_RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }

export type GenResult = { physicalName: string; unknownWords: string[]; termId?: string; domainId?: string | null }

export function generatePhysicalName(
  logicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): GenResult
```
- 1) **용어 완전일치**: `terms`에 `logicalName`(trim) 일치 항목 → `{ physicalName: term.physicalName, unknownWords: [], termId, domainId }`.
- 2) **단어 분해조합(최장일치)**: 논리명을 앞에서부터 최장 일치 단어로 토큰화(단어 `logicalName` 사전). 매칭 실패 위치는 미해결 토큰으로 모아 `unknownWords`. 매칭 약어들을 `rules.separator`로 연결, `rules.case === 'lower_snake'`면 소문자화(기본 대문자). unknownWords가 있으면 부분 결과라도 반환.
- 순수 함수. 방언 무관.

**테스트**: 용어 일치 우선. 최장일치 분해(회원+상태+코드→MBR_STAT_CD). 미등록 단어 포함 시 unknownWords. lower_snake·구분자 없음 케이스.

## 항목 3: 경고 시스템 (core `naming-warnings.ts`)

```ts
export type NamingWarning = {
  severity: 'warning' | 'error'
  kind: 'unknown-word' | 'term-mismatch' | 'too-long' | 'reserved' | 'duplicate'
  entity: 'table' | 'column'
  entityId: string
  message: string
}
export function collectNamingWarnings(
  model: ProjectModel, rules: NamingRules, dialects: Dialect[],
): NamingWarning[]
```
- 각 테이블·컬럼(논리명 있는 것)에 대해:
  - **unknown-word**: `generatePhysicalName(logicalName,...).unknownWords`가 비어있지 않음(warning).
  - **term-mismatch**: `terms`에 논리명 일치 Term이 있는데 `physicalName`이 그 Term과 다름(warning).
  - **too-long**: `new TextEncoder().encode(physicalName).length > rules.maxLengthBytes`(warning).
  - **reserved**: `dialects.some(d => isReservedWord(physicalName, d))`(warning).
  - **duplicate**: 테이블 물리명 중복(테이블 간), 컬럼 물리명 중복(한 테이블 내) — **error**.
- 순수 함수. identifier.ts `isReservedWord` 사용.

**테스트**: 각 kind별 케이스 + duplicate error severity.

## 항목 4: server 스키마 + 마이그레이션 0005 + 명명 규칙 API

- `db/schema.ts`: `modelWords`(id/projectId/logicalName/abbreviation/description), `modelTerms`(id/projectId/logicalName/physicalName/domainId FK→modelDomains/description). `projects`에 `namingRules jsonb $type<NamingRules>().notNull().default(...)`. (drizzle `.default` 또는 마이그레이션 기본값.)
- 마이그레이션 0005 생성(drizzle-kit) → dev·test migrate.
- `model-store.ts`: `TABLE_BY_KIND`에 word/term, `loadProjectModel`에 words/terms 로드.
- `routers/project.ts`: `project.get`이 `namingRules` 반환(없으면 DEFAULT 보충), `project.update`에 `namingRules` optional 추가.

**테스트(erdd_test)**: word/term 왕복, term.domainId FK, namingRules 저장·기본값 보충. 단일 배치(word+term+domain+참조컬럼) FK 안전(스냅샷 복원 회귀 가드).

## 항목 5: 사전 관리 화면 (web `dict-panel.tsx` + `dict-edits.ts`)

- producer 헬퍼: `createWord/updateWord/removeWord`, `createTerm/updateTerm/removeTerm`, `wordUsage/termUsage`(사용처 = 논리명이 그 단어/용어를 쓰는 테이블·컬럼 역참조), 미등록 단어 모아보기(모델 전체의 unknownWords 집계).
- 화면: 단어·용어 탭 목록·CRUD, 사용처, 미등록 단어 모아보기(일괄 등록). 헤더에 "사전" 진입 버튼(도메인 버튼과 별개 — 3탭 통합은 후속). 도메인 관리(sub-project #1)는 그대로.
- 이벤트 값 즉시 캡처.

**테스트**: word/term CRUD producer, 사용처 집계, 미등록 모아보기.

## 항목 6: 자동생성 에디터 통합 (web `edit-panel.tsx` + `naming.ts` 클라)

- 논리명 `CommitInput` onCommit 시: 물리명이 비어 있으면 `generatePhysicalName`으로 채워 같은 producer에서 물리명도 설정(용어 일치면 기본 도메인도 제안 — 도메인 미지정 시 setColumnDomain). 비어있지 않으면 물리명 불변.
- "물리명 재생성" 버튼(현재 논리명으로 재생성, 덮어씀). "용어로 등록"(현 논리↔물리↔도메인을 Term으로 createTerm). 미등록 단어 인라인 "단어 등록"(createWord).
- namingRules·words·terms는 클라이언트 모델/프로젝트에서 조회. 이벤트 값 즉시 캡처.

**테스트**: 빈 물리명 자동채움, 비어있지 않으면 불변, 용어로 등록, 단어 등록.

## 항목 7: 경고 노출 (web 노드 배지 + 편집 패널)

- `table-node.tsx`: 해당 테이블+컬럼의 `collectNamingWarnings` 개수를 배지로(경고/오류 색 구분). `useMemo`로 모델·규칙 의존.
- edit-panel: 편집 중 엔티티의 경고를 필드 아래 인라인 표시.
- 성능: collectNamingWarnings는 모델 규모(수십~수백)라 memo로 충분.

**테스트**: 경고 있는 테이블 배지 렌더, 패널 인라인.

## 항목 8: 명명 검사 화면 (web `naming-check.tsx`)

- 헤더 진입 버튼(또는 사전 화면 탭). `collectNamingWarnings` 전체를 kind/severity별 그룹 목록, 각 항목 클릭 시 해당 테이블/컬럼 선택(`select`/`selectColumn`)으로 바로가기. 미등록 단어는 인라인 등록 유도.

**테스트**: 경고 목록 렌더, 항목 클릭 시 선택 동작.

## 실행

하나의 계획으로 SDD. 순서: 1 모델+op → 2 자동생성 → 3 경고 → 4 서버+마이그0005+규칙API → 5 사전 관리 → 6 자동생성 통합 → 7 경고 노출 → 8 명명 검사 화면. 각 태스크 독립 테스트. 전체 스위트(core/server[erdd_test]/web)+typecheck 그린. fable 최종 리뷰 후 main 머지.

## 범위 밖 (후속)

- Excel 단어/용어/도메인 사전 업로드·산출물 → Excel 사이클.
- 공용(전역/조직) 사전·도메인 fork·재동기화 → fork 사이클.
- 단어/용어/도메인 3탭 통합 관리 화면(현재는 사전(단어·용어)과 도메인 별도 진입).
- 인덱스/관계 이름 명명 검사(현재는 테이블·컬럼).
