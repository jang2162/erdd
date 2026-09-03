# Phase 3 — 스냅샷 diff · 변경분 정의서 설계

**작성일:** 2026-07-28
**상태:** 승인됨 (사용자 "맞아")
**원 기획:** docs/11-collaboration.md "diff" 절, docs/17-import-export.md의 "변경분 정의서" 시트

## 목표

두 시점의 프로젝트 모델을 비교해 **무엇이 추가·삭제·변경됐는지** 사람이 읽는 형태로 보여주고, 그 결과를 **감리 제출용 Excel(변경분 정의서)**로 내보낸다. 비교 대상은 스냅샷↔스냅샷, 스냅샷↔현재 모두 지원한다.

**범위 밖(다른 sub-project):** 실시간 동시편집(Phase 3의 나머지 절반 — presence·WebSocket·LWW), diff 결과를 되돌리는 "선택 복원"(스냅샷 전체 복원은 이미 있음), CLI push 충돌 판정(Phase 4 — 같은 `revisions` 로그를 쓰지만 판정 로직이 다르다).

## 핵심 결정 (사용자 확정)

- **표시 전용 diff 함수를 core에 새로 만든다.** 기존 `diffModels`(→ `Op[]`)는 건드리지 않는다 — 스냅샷 복원과 향후 CLI push가 의존하는 함수이고, 직전 병합에서도 이 함수의 미세한 계약 변경이 문제가 될 뻔했다. Op 배열은 FK 안전 순서로 정렬돼 있어 사람이 읽는 순서가 아니고, 삭제된 엔티티의 이름·소속 해석이 빠져 있어 화면과 Excel이 각자 중복 구현하게 된다.
- **비교 대상은 기준/비교 각각 선택**(드롭다운 2개, 각각 `현재` + 스냅샷 목록). 내부적으로는 "모델 2개를 비교"라 구현 부담이 거의 같고, 감리 실무에서 `v1.0 ↔ v1.1` 비교가 실제로 필요하다.
- **Excel은 한 시트 flat.** 컬럼: `구분 · 대상 · 변경유형 · 속성 · 이전값 · 이후값`. 기존 테이블정의서가 이미 한 시트 flat이라 일관되고, 엑셀에서 필터·피벗으로 바로 가공된다.
- **배치 좌표는 diff에서 제외한다.** `position`/`groupPosition`만 바뀌어도 전 테이블이 "변경"으로 잡히면 정의서가 무의미해진다.
- **변경분 정의서 다운로드 버튼은 비교 화면 안에 둔다.** 내보내기 다이얼로그의 6번째 체크박스로 넣으면 거기서도 기준/비교 스냅샷을 고르게 해야 해 UI가 중복된다.

## 아키텍처 / 방침

기존 계층 분리를 그대로 따른다: **판정·양식은 core 순수 함수, 조달·표시는 web.**

| 계층 | 파일 | 책임 |
|---|---|---|
| core | `model-diff.ts` (신규) | `diffModelsForDisplay(base, target)` → `ModelDiff`. 이름 해석·정렬·좌표 제외가 전부 여기 |
| core | `excel-sheets.ts` (수정) | `buildChangeSheet(diff, meta)` → `SheetData`. 양식의 유일한 정의처 |
| web | `snapshot-diff.tsx` (신규) | 기준/비교 선택 · 결과 목록 · 항목 클릭 이동 · Excel 다운로드 |
| web | `excel-file.ts` (수정) | 제목 행이 있는 시트를 인코딩할 수 있게 확장 |

**모델 조달에 새 서버 엔드포인트가 필요 없다.** `현재`는 스토어의 모델, 스냅샷은 기존 `snapshot.get`이 이미 `model` jsonb를 통째로 반환한다.

## 전역 제약 (Global Constraints)

- `packages/core`는 IO·런타임 의존성 free. `diffModelsForDisplay`·`buildChangeSheet`는 순수 함수.
- **`diffModels`(diff.ts)와 `ENTITY_KINDS`·`applyOps`는 건드리지 않는다.** 이번 작업은 읽기 전용 기능이라 op 엔진·스키마·마이그레이션 변경이 전혀 없다(새 마이그레이션 없음).
- **옛 스냅샷 정규화 필수**: 스냅샷 jsonb는 zod 파싱을 거치지 않으므로, 비교 전에 복원 경로와 동일하게 `{ ...createEmptyModel(), ...snap.model }`로 누락 컬렉션을 보충한다. 엔티티 레벨 누락 필드(예: 옛 스냅샷의 `table.custom` 없음)는 **없는 것으로 취급**하고 "변경"으로 잡지 않는다(아래 항목 1 참조).
- UI 카피는 한국어. 새 런타임 의존성 금지(Excel은 기존 `exceljs` 동적 import 경로 재사용).
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지 한국어 + 트레일러 2줄.
- 기준선: core 234 · web 242 · server 69 · `pnpm -r typecheck` 0 errors.

## 확인된 기존 인터페이스

- `ProjectModel`(core) 10 컬렉션, `createEmptyModel()`, `ENTITY_KINDS` = `['tableGroup','domain','word','term','customField','table','column','relationship','index','note']`.
- `snapshot.get`(server) → `{ id, name, description, revisionSeq, model, createdAt }`. `snapshot.list` → 목록.
- `useEditorStore`의 `model`, `select(tableId)` / `selectRelationship(id)` — "모델 검사" 화면이 쓰는 이동 패턴.
- `version-dialog.tsx`(199줄): `Section = 'snapshot' | 'history'` 토글 구조. 여기에 `'diff'`를 추가한다.
- `excel-sheets.ts`: `ExcelSheetKey`(5종 union), `EXCEL_SHEET_KEYS`(const 5개 — **내보내기 다이얼로그가 이 배열을 순회**), `EXCEL_SHEET_NAME`, `SheetData = { key; name; headers; rows }`, `buildExcelSheets(model, opts)`.
- `excel-file.ts`(web): `downloadExcelWorkbook(sheets, filename)` — 현재 **헤더를 1행에 쓰고 autoFilter를 1행으로 고정**한다.
- `resolveColumn`·`customFieldsFor`·`resolveCustomValue` 등 기존 해석 헬퍼.

## 항목 1: core 표시 전용 diff (`model-diff.ts`)

```ts
export type DiffChangeKind = 'added' | 'removed' | 'changed'

export type DiffFieldChange = {
  field: string      // 'physicalName'
  label: string      // '물리명'
  before: string     // 사람이 읽는 문자열(없으면 '')
  after: string
}

export type DiffEntry = {
  kind: EntityKind          // 기존 10종
  changeKind: DiffChangeKind
  entityId: string
  label: string             // 'MBR' / 'MBR.MBR_NO' / '회원번호'
  parentTableId?: string    // 컬럼·인덱스·관계 → 화면에서 클릭 이동에 쓴다
  fields: DiffFieldChange[] // changed일 때만 채운다
}

export type ModelDiff = {
  entries: DiffEntry[]
  counts: { added: number; removed: number; changed: number }
}

export function diffModelsForDisplay(base: ProjectModel, target: ProjectModel): ModelDiff
```

**판정 규칙**
- id 기준. `base`에만 있으면 `removed`, `target`에만 있으면 `added`, 양쪽에 있고 비교 대상 속성이 다르면 `changed`.
- **비교 제외 속성**: `position`, `groupPosition`(테이블), 그리고 `id` 자체. 나머지는 전부 비교한다(`custom` 레코드 포함 — 커스텀 항목 값 변경은 추적 대상이다).
- **엔티티 레벨 누락 필드는 없는 것으로 취급**한다. 옛 스냅샷의 `table`에 `custom` 키가 아예 없으면 `{}`와 같게 보고 변경으로 잡지 않는다(`diffModels`가 빈 changes op를 만들지 않는 것과 같은 정신).
- `changed`인데 제외 속성만 바뀐 경우 **엔트리를 만들지 않는다**.

**라벨 규칙**(삭제는 `base`, 추가는 `target`, 변경은 `target` 기준으로 해석)
- table: 물리명(비어 있으면 논리명, 그것도 비면 `(이름 없음)`)
- column: `테이블물리명.컬럼물리명`
- relationship: `name` 또는 `부모물리명 → 자식물리명`
- index: `테이블물리명.인덱스명`
- word/term/domain/customField: 각자의 논리명·이름
- tableGroup: 그룹명 / note: `메모` + 내용 앞 20자

**필드 라벨**은 `FIELD_LABEL: Partial<Record<string, string>>`로 한국어 매핑(`logicalName`→논리명, `physicalName`→물리명, `isPk`→기본키, …). 매핑에 없는 필드는 필드명을 그대로 쓴다.

**값 포매팅**: `boolean`→`Y`/`''`, `null`/`undefined`→`''`, 배열·객체(예: `custom`, `columnMappings`, `allowedValues`)→ 안정적인 문자열(정렬된 `key=value` 나열). 값 포매팅은 이 파일 안의 한 함수(`formatValue`)로만 한다.

**정렬**: 엔티티 종류(테이블 → 컬럼 → 관계 → 인덱스 → 그룹 → 도메인 → 단어 → 용어 → 커스텀 항목 → 메모) → 대상 라벨 → 속성명. FK 안전 순서(`ENTITY_KINDS`)와 **다르다** — 사람이 읽는 순서다.

**테스트**: 추가/삭제/변경 각각, 좌표만 바뀌면 엔트리 없음, 옛 스냅샷(엔티티에 `custom` 키 없음) 대비 현재(`custom: {}`)가 변경으로 안 잡힘, 컬럼 라벨이 `테이블.컬럼`, 삭제된 컬럼의 라벨을 base에서 해석, 사전 3종·커스텀 항목 변경 포함, counts 집계, 빈 diff.

## 항목 2: core 변경분 정의서 시트 (`excel-sheets.ts`)

```ts
export type SheetKey = ExcelSheetKey | 'changes'   // SheetData.key를 이 타입으로 넓힌다
export const CHANGE_HEADERS = ['구분', '대상', '변경유형', '속성', '이전값', '이후값'] as const

export function buildChangeSheet(
  diff: ModelDiff, meta: { baseLabel: string; targetLabel: string },
): SheetData
```

- `EXCEL_SHEET_NAME`에 `changes: '변경분 정의서'` 추가. **`EXCEL_SHEET_KEYS`(5개 const)는 그대로 둔다** — 내보내기 다이얼로그가 이 배열을 순회하므로 건드리면 거기 체크박스가 하나 늘어난다(이번 결정과 어긋난다).
- `buildExcelSheets`의 `sheets` 옵션 타입은 `ExcelSheetKey[]`로 **좁게 유지**한다(`'changes'`를 넘길 수 없게).
- 행 생성: `changed`는 속성 하나당 한 행(대상·구분이 반복된다), `added`/`removed`는 한 행(속성·이전값·이후값 빈칸).
- `구분` = 엔티티 종류의 한국어 라벨(테이블/컬럼/관계/인덱스/그룹/도메인/단어/용어/커스텀 항목/메모).
- **제목 행**: `title` 필드를 `SheetData`에 optional로 추가하고 `buildChangeSheet`가 `기준: {baseLabel} · 비교: {targetLabel}`을 채운다. 다른 시트는 `title`이 없다.

**테스트**: changed가 속성 수만큼 행을 만듦, added/removed는 1행에 속성 칸이 빔, 헤더 상수 일치, 제목 행에 기준·비교 라벨, 빈 diff면 데이터 행 0개(헤더·제목은 남음).

## 항목 3: web Excel 인코더 확장 (`excel-file.ts`)

- `downloadExcelWorkbook`이 `SheetData.title`이 있으면 **1행에 제목, 2행에 헤더**를 쓰고 `autoFilter`를 2행 기준으로 잡는다. `title`이 없으면 지금 동작 그대로(1행 헤더, autoFilter 1행).
- 열 너비 계산은 제목 행을 무시한다(제목이 길어 열이 과하게 넓어지는 것 방지).

**테스트**: 제목 있는 시트를 인코딩→디코딩하면 헤더가 2행에서 읽힘, 제목 없는 기존 5시트는 1행 헤더 유지(회귀).

## 항목 4: web 비교 화면 (`snapshot-diff.tsx`)

- `version-dialog.tsx`의 `Section` 유니언에 `'diff'` 추가, 토글 버튼 "비교". 본체는 별도 파일(version-dialog가 이미 199줄).
- 기준/비교 `<select>` 2개: 옵션은 `현재` + `snapshot.list` 항목(이름 + 생성일). 기본값 `기준=최근 스냅샷`, `비교=현재`. 스냅샷이 없으면 안내 문구만.
- 선택이 스냅샷이면 `snapshot.get`으로 모델을 가져온다(TanStack Query, `enabled` 가드). **가져온 모델은 `{ ...createEmptyModel(), ...snap.model }`로 정규화**한 뒤 비교한다.
- 결과: 요약 배지 `추가 N · 삭제 M · 변경 K`, 종류별 그룹 목록. 항목 클릭 시 `parentTableId ?? entityId`로 테이블 선택 후 다이얼로그 닫기(관계는 `selectRelationship`). 사전·도메인·커스텀 항목처럼 캔버스에 대응 객체가 없는 종류는 **클릭 비활성**.
- 같은 대상을 기준/비교로 고르면 "같은 시점을 비교하고 있습니다" 안내.
- 로딩 중·에러는 명시적으로 표면화한다(모델을 못 가져왔는데 "차이가 없습니다"로 보이면 안 된다).
- 다운로드 버튼: `buildChangeSheet` → `downloadExcelWorkbook([sheet], filename)`. 파일명 `erdd_변경분정의서.xlsx`, 실패 시 `toast.error`(기존 내보내기와 동일 패턴).

**테스트**: 기준/비교 선택 렌더, 차이 없으면 안내, 추가/삭제/변경 목록 렌더와 요약 배지, 항목 클릭 시 해당 테이블 선택, 사전 항목은 클릭 비활성, 같은 시점 선택 시 안내, 다운로드가 빌더를 호출(빌더 호출·파일명 검증), 조회 실패 시 에러 표면.

## 실행

하나의 계획으로 SDD. 순서: 1 core diff → 2 core 시트 → 3 web 인코더 → 4 web 화면.
각 태스크 독립 테스트. 전체 스위트(core/web/server[erdd_test]) + typecheck 그린 유지 → 최종 whole-branch 리뷰 → 브라우저 스모크 → main 머지.

**서버 변경 없음**(새 라우터·마이그레이션 없음) — 서버 테스트 수는 69 그대로일 것으로 예상한다.

## 범위 밖 (후속)

- 실시간 동시편집(Phase 3 나머지) — presence·WebSocket·속성 단위 LWW.
- diff에서 선택 항목만 되돌리는 "선택 복원" — 스냅샷 전체 복원만 존재.
- 배치 좌표 변경 이력 보기(좌표는 diff에서 의도적으로 제외).
- Revision 단위 diff(현재는 스냅샷·현재 시점 단위) — 이력 화면 확장은 별도.
- 변경분 정의서의 발주처별 양식 커스터마이징(로드맵 "추후 검토").
