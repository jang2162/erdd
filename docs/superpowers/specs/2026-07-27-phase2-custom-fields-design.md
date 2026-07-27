# Phase 2 — 커스텀 항목 설계 (Custom Fields: 조직/프로젝트별 메타 항목)

**작성일:** 2026-07-27
**상태:** 승인됨 (사용자 "맞다, 그대로 진행해줘" / "spec 문서로 작성해줘")
**원 기획:** [docs/15-custom-fields.md](../../15-custom-fields.md) Phase 2 범위

## 목표

프로젝트마다 다른 관리 항목(개인정보여부, 암호화방식, 비고 등)을 **테이블/컬럼에 정의하고 값을 입력**할 수 있게 한다. 정의는 버전 관리(op 로그·undo·스냅샷) 대상이고, 값은 테이블/컬럼 엔티티에 붙는다. 필수 미입력은 **경고 수준**으로만 알린다(저장 차단 없음 — 명명·도메인 경고와 동일 정책).

**범위 밖(후속 sub-project):** 조직 표준 템플릿 fork·재동기화(fork 사이클), Excel 정의서의 커스텀 컬럼(Excel 사이클), CLI 파일 포맷 `custom` 필드(Phase 4), 캔버스 노드 표시(기획상 제외 — 정보 과밀 방지), 관계·인덱스 대상 커스텀 항목.

## 핵심 결정 (사용자 확정)

- **정의 = op 엔티티 `customField`, 값 = table/column의 `custom` 필드.** 정의는 도메인·단어·용어에 이은 10번째 op 엔티티(undo·스냅샷·향후 fork를 일원화). 값은 별도 엔티티가 아니라 `table.custom` / `column.custom` 레코드 필드 — 테이블/컬럼 삭제 시 값이 자동 소멸하고, 값 전용 엔티티가 table·column·customField를 삼중 참조하는 FK 순서·캐스케이드 문제가 생기지 않는다.
- **조직 템플릿은 이번 범위 밖.** 사전·도메인·커스텀 항목 3종을 하나의 fork/재동기화 메커니즘으로 다음 sub-project에서 한꺼번에 설계한다.
- **편집 패널은 항상 인라인 표시**(접이식·다이얼로그 아님). 정의 순서대로 테이블 영역과 각 컬럼 행에 그린다.
- **모든 값은 문자열.** boolean은 `'true'`/`'false'`, select는 선택지 문자열, text는 자유 문자열. jsonb·향후 Excel·CLI 왕복이 한 표현으로 끝난다.
- **기본값은 라이브 해석**(스냅샷 아님). `resolve(entity, field) = entity.custom[field.id] ?? field.defaultValue ?? ''`. 도메인의 라이브 해석과 같은 철학 — 기본값을 고치면 미입력 엔티티에 즉시 반영된다.
- **dangling 키는 무결성 위반이 아니다.** 정의에 없는 fieldId가 `custom`에 남아 있어도 통과시키고, 렌더·경고·산출물은 정의 목록 기준으로만 읽는다(옛 리비전 재적용·스냅샷 복원·향후 fork 병합에서 깨질 여지 제거). 대신 항목 삭제 시 producer가 모든 테이블/컬럼의 해당 키를 실제로 지운다.

## 아키텍처 / 방침

- `packages/core`는 IO·런타임 의존성 free. 모델 변경은 op 엔진으로만, 클라이언트는 producer + `diffModels`.
- **`ENTITY_KINDS` 순서**: `['tableGroup','domain','word','term','customField','table','column','relationship','index','note']`. 값이 jsonb 필드라 실제 DB FK는 없지만, 정의가 table/column보다 **먼저 생성되고 나중에 삭제**되도록 `table` 앞에 둔다(HANDOFF 3.2 부모-우선 규칙과 일관). 배열 중간 삽입은 과거 op 로그에 영향이 없다 — `ENTITY_KINDS`는 diff 생성 시에만 쓰인다.
- 새 런타임 의존성 없음. DDL 생성에는 영향 없음(커스텀 항목은 문서용 메타).

## 전역 제약 (Global Constraints)

- core IO·의존성 free. 새 의존성 금지.
- 새 엔티티 `customField`를 6곳에 일관 등록: core `ENTITY_KINDS`·`ENTITY_SCHEMAS`·`COLLECTION_BY_KIND`·`applyOps` spread + `integrity.ts`(union+collections) + server `TABLE_BY_KIND`/`loadProjectModel`. 추가로 `mutation.ts`의 `KIND_LABEL`, `testing/helpers.ts`의 `withUuidIds`.
- 임시 가드가 필요하면 plain `Error`가 아니라 `OpApplyError`를 throw(라우터 catch가 `OpApplyError`만 400으로 매핑 — 도메인·명명에서 두 번 재발한 500 버그).
- 하위호환: `customFields`는 `ProjectModelSchema`에서 `.default({})`, `Table.custom`/`Column.custom`은 `.default({})` — 옛 스냅샷·옛 op 페이로드 파싱 안전. `: ProjectModel` 리터럴(fixtures, model-store 반환, `createEmptyModel`)에는 `z.infer` 출력 타입상 키가 **필수**이므로 typecheck-driven으로 전부 채운다.
- 마이그레이션 append-only(0006). dev·test 두 DB 모두 적용.
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. UI 카피 한국어. 이벤트 값은 producer 진입 전 즉시 캡처.

## 확인된 기존 인터페이스

- `ProjectModel`(core): `{ tables, columns, relationships, indexes, notes, tableGroups, domains, words, terms }`, `createEmptyModel()`.
- op 엔진 `op.ts`: `ENTITY_KINDS`/`ENTITY_SCHEMAS`/`COLLECTION_BY_KIND`/`applyOps` spread. `diff.ts`가 `ENTITY_KINDS` 순회(create 정순·delete 역순). `integrity.ts`는 유니언 + `collections` 배열.
- `warnings.ts`: `computeWarnings(model, rules?, dialects?)` → `Warning{kind, scope, entityId, tableId?, message, severity?}`. `buildNodes`가 scope별 분배, `WarningBadge`가 표시, `naming-check.tsx`가 kind별 그룹핑(`KIND_LABEL: Record<Warning['kind'], string>` — exhaustive라 새 kind 추가 시 typecheck가 잡는다).
- server `schema.ts`: `modelColumns.order = integer('order').notNull()`, jsonb 컬럼은 `jsonb('x').$type<T>().notNull()` 패턴.
- web: `edit-panel.tsx`(254줄, 테이블 필드 + `ColumnRow` 리스트 + `IndexSection`), `domain-panel.tsx`(100줄, 다이얼로그형 관리 화면 패턴), 헤더 진입 버튼은 `pages/project.tsx:41-43`(도메인·사전·명명 검사).

## 파일 구조

**core**: `model.ts`(CustomFieldSchema, `customFields`, `Table.custom`/`Column.custom`, createEmptyModel), `op.ts`(등록·ENTITY_KINDS), `integrity.ts`(union+collections), `custom-field.ts`+test(해석 헬퍼), `warnings.ts`(custom-required), `index.ts`.
**server**: `db/schema.ts`(model_custom_fields + model_tables.custom + model_columns.custom), `drizzle/0006_*.sql`, `services/model-store.ts`, `services/mutation.ts`(KIND_LABEL), `testing/helpers.ts`(withUuidIds).
**web**: `custom-field-edits.ts`+test(producer), `custom-field-panel.tsx`(정의 관리 화면), `custom-fields-section.tsx`(값 입력 렌더러), `edit-panel.tsx`(통합), `naming-check.tsx`(라벨), `pages/project.tsx`(진입 버튼).

---

## 항목 1: core 데이터 모델 + op 엔티티 (customField)

```ts
export const CustomFieldSchema = z.strictObject({
  id: z.string(),
  name: z.string(),                              // "개인정보여부"
  target: z.enum(['table', 'column']),           // 적용 대상
  type: z.enum(['text', 'boolean', 'select']),
  options: z.array(z.string()),                  // select일 때만 사용(그 외 [])
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  order: z.number().int(),                       // 패널·산출물 표시 순서
})
export type CustomField = z.infer<typeof CustomFieldSchema>
```

- `TableSchema`·`ColumnSchema`에 `custom: z.record(z.string(), z.string()).default({})` 추가(키 = fieldId, 값 = 문자열, 미입력은 키 없음).
- `ProjectModelSchema`에 `customFields: z.record(z.string(), CustomFieldSchema).default({})`, `createEmptyModel`에 `customFields: {}`.
- `op.ts`: `ENTITY_KINDS`를 `['tableGroup','domain','word','term','customField','table','column','relationship','index','note']`로, `ENTITY_SCHEMAS`/`COLLECTION_BY_KIND`/`applyOps` 초기 spread에 `customFields: { ...(model.customFields ?? {}) }`.
- `integrity.ts`: `IntegrityIssue['entity']` 유니언에 `'customField'`, `collections`에 `{ entity: 'customField', record: model.customFields }`. **참조 검사는 추가하지 않는다**(dangling 키 관대 정책).

**테스트**: customField op 왕복(create/update/delete). `custom` 필드 update op 왕복. 하위호환 — `customFields` 생략 파싱 → `{}`, `custom` 생략 파싱 → `{}`. diff 순서 — customField create idx < table create idx, table delete idx < customField delete idx. dangling 키가 있어도 `validateModelIntegrity`가 빈 배열.

## 항목 2: core 해석 헬퍼 + 필수 경고

```ts
// packages/core/src/custom-field.ts
export function customFieldsFor(
  model: ProjectModel, target: 'table' | 'column',
): CustomField[]                                  // target 일치 항목을 order 오름차순(동률은 name)

export function resolveCustomValue(
  entity: { custom: Record<string, string> }, field: CustomField,
): string                                          // custom[field.id] ?? field.defaultValue ?? ''

export function customFieldUsageCount(model: ProjectModel, fieldId: string): number
// 값이 실제로 입력된(키가 존재하는) 테이블+컬럼 수 — 삭제 확인 카피용

export function customOptionUsageCount(
  model: ProjectModel, fieldId: string, option: string,
): number                                          // 선택지 삭제 가드용
```

- `warnings.ts`: `Warning['kind']`에 `'custom-required'` 추가. 각 테이블·컬럼에 대해 `customFieldsFor(model, scope)`를 돌며 `field.required && field.type !== 'boolean' && resolveCustomValue(entity, field) === ''`이면 경고 1건(`severity: 'warning'`, message: `필수 항목 "${field.name}"이(가) 비어 있습니다`).
- **`rules` 게이트 밖**에서 계산한다 — 커스텀 필수는 명명 규칙과 무관하므로 `computeWarnings(model)` 무인자 호출에서도 나와야 한다. 시그니처는 그대로(정의가 모델 안에 있으므로 인자 추가 불필요).
- **`required`는 boolean 타입에 적용하지 않는다** — 체크박스는 "미입력" 상태를 표현할 수 없어 항상 충족되므로 경고가 무의미하다(정의 편집 UI에서도 비활성).
- 모두 순수 함수.

**테스트**: order 정렬·target 필터, `resolveCustomValue`의 3단 fallback(입력값 > 기본값 > 빈 문자열), 필수 미입력 경고 발생/기본값이 있으면 미발생/boolean은 미발생, `computeWarnings(model)` 무인자에서도 custom-required가 나옴, usageCount 2종.

## 항목 3: server 스키마 + 마이그레이션 0006

- `db/schema.ts`:
  - `modelCustomFields` = `model_custom_fields`(id uuid pk, projectId FK, name text, target text, type text, options jsonb `$type<string[]>` notNull, required boolean notNull, defaultValue text nullable, order `integer('order')` notNull).
  - `modelTables`·`modelColumns`에 `custom: jsonb('custom').$type<Record<string, string>>().notNull().default({})`.
- 마이그레이션 0006 생성(drizzle-kit) → dev(`erdd`)·test(`erdd_test`) 양쪽 migrate.
- `model-store.ts`: `TABLE_BY_KIND`에 `customField: modelCustomFields`, `loadProjectModel`에 `customFields` 로드 + table/column 매핑에 `custom: r.custom ?? {}`.
- `mutation.ts` `KIND_LABEL`에 `customField: '커스텀 항목'`.
- `testing/helpers.ts` `withUuidIds`: `customFields` 리매핑 + table/column의 `custom` **키**(fieldId)를 새 id로 리매핑 — 안 하면 fixture 기반 서버 테스트에서 값이 정의와 끊긴다.

**테스트(erdd_test)**: customField 왕복, table/column `custom` 값 왕복(기본값 `{}`), 단일 배치(customField create + table/column create with custom + delete 역순) persist 안전 — 스냅샷 복원 회귀 가드.

## 항목 4: web producer (`custom-field-edits.ts`)

```ts
createCustomField(model, field: CustomField): ProjectModel      // order = 같은 target 최대+1
updateCustomField(model, id, patch: Partial<Omit<CustomField, 'id' | 'type' | 'target'>>)
moveCustomField(model, id, dir: -1 | 1)                          // 같은 target 안에서 order 스왑
removeCustomField(model, id)                                     // 정의 삭제 + 전 테이블·컬럼의 해당 키 제거
setCustomValue(model, target, entityId, fieldId, value: string)  // '' 이면 키 삭제(미입력으로 환원)
```

- `removeCustomField`는 **한 producer 안에서** 정의 삭제와 값 정리를 모두 수행한다 → 단일 뮤테이션 = Revision 1건, undo 1회로 원복.
- `type`·`target`은 patch에서 제외(타입 변경 불허 — 삭제 후 재생성).

**테스트**: 각 producer, `removeCustomField`가 값까지 지움, `setCustomValue('')`가 키를 지움, `moveCustomField`가 다른 target의 order를 건드리지 않음.

## 항목 5: web 정의 관리 화면 (`custom-field-panel.tsx`)

- 헤더 4번째 진입 버튼 "커스텀 항목"(`pages/project.tsx`). `domain-panel.tsx`의 다이얼로그 패턴을 따른다.
- 목록: target별 섹션(테이블/컬럼), order 오름차순, 위/아래 이동 버튼.
- 생성 폼: 이름·대상·타입·필수·기본값(+ select면 선택지 목록). **타입 선택은 생성 시에만** — 수정 시 비활성(안내 문구: "타입은 변경할 수 없습니다. 삭제 후 다시 만드세요"). 타입이 boolean이면 필수 체크박스 비활성.
- 선택지 삭제: `customOptionUsageCount`가 0보다 크면 "N곳에서 사용 중입니다" 확인 후 진행(값은 유지).
- 항목 삭제: `customFieldUsageCount`로 "입력된 값 N건도 함께 삭제됩니다" 확인 후 `removeCustomField`.
- 이벤트 값은 producer 진입 전 즉시 캡처.

**테스트**: 목록 렌더·생성·수정 시 타입 잠금·삭제 확인 카피에 사용 건수 표시·순서 이동.

## 항목 6: web 값 입력 (`custom-fields-section.tsx` + `edit-panel.tsx`)

```tsx
<CustomFieldsSection
  fields={CustomField[]} values={Record<string, string>}
  idPrefix={string} onChange={(fieldId, value) => void}
/>
```

- 정의 순서대로 **항상 인라인** 렌더: `text` → `CommitInput`(blur 커밋), `boolean` → 체크박스(`'true'`/`'false'` 즉시 커밋), `select` → `<select>`(빈 옵션 "선택 안 함" + 선택지). select의 현재 값이 선택지에 없으면 그 값을 **비활성 옵션으로 함께 표시**해 값이 사라진 것처럼 보이지 않게 한다.
- 필수인데 비어 있으면 라벨 옆에 경고 표시(해당 엔티티의 `custom-required` 경고를 재사용).
- `edit-panel.tsx` 통합: 테이블은 "소속 그룹" 아래, 컬럼은 `ColumnRow` 하단(도메인/타입 블록 뒤). 정의가 하나도 없으면 섹션 자체를 렌더하지 않는다.
- `edit-panel.tsx`가 더 커지지 않도록 렌더러는 별도 파일로 분리한다.

**테스트**: 3가지 타입 렌더·값 커밋(mutate 호출), 기본값이 미입력 시 표시됨, 선택지에 없는 기존 값이 비활성 옵션으로 남음, 정의 0개면 섹션 없음.

## 항목 7: 경고 노출 마무리 (`naming-check.tsx`)

- `KIND_LABEL`에 `'custom-required': '필수 항목 미입력'` 추가(Record가 exhaustive라 typecheck가 강제).
- 이 화면은 이미 관계 경고(타입 불일치·매핑 불완전)까지 보여주고 있어 이름과 내용이 어긋나므로, **표시 라벨(버튼·다이얼로그 제목)만 "모델 검사"로** 바꾼다. 컴포넌트명·파일명은 유지(호출부 변경 최소화).
- 노드 배지·편집 패널 인라인 경고는 `computeWarnings` 확장만으로 자동 노출된다(추가 배선 없음).

**테스트**: custom-required 경고가 검사 화면에 그룹으로 뜨고 클릭 시 해당 테이블 선택.

## 실행

하나의 계획으로 SDD. 순서: 1 모델+op → 2 헬퍼+경고 → 3 서버+마이그0006 → 4 producer → 5 정의 관리 화면 → 6 값 입력 통합 → 7 경고 노출. 각 태스크 독립 테스트.

기준선(core 127 · web 126 · server 49[erdd_test] · `pnpm -r typecheck` 0 errors)에서 시작해 태스크마다 그린 유지. 전체 스위트 체크포인트 → 브라우저 스모크(실 앱 + 실 DB, 변경은 undo로 원복) → whole-branch 리뷰 → main fast-forward 머지.

## 범위 밖 (후속)

- 조직 표준 커스텀 항목 템플릿 fork·재동기화 → fork 사이클(사전·도메인과 통합 설계).
- Excel 정의서의 커스텀 컬럼, 커스텀 항목 값 업로드 → Excel 사이클.
- CLI 파일 포맷 `custom` 필드 → Phase 4.
- 캔버스 노드 표시(기획상 제외), 관계·인덱스 대상 커스텀 항목, 커스텀 항목 값의 스냅샷 diff 전용 화면(Phase 3 diff 화면과 함께).
