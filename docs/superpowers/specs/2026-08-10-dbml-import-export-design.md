# DBML 가져오기·내보내기 설계

**작성:** 2026-08-10 / **기준 HEAD:** `f0d8744`

내보내기에 DBML 형식을, 가져오기에 DBML 파싱을 더한다. **주 용도는 dbdocs 문서 발행**이다
(사용자 확인) — dbdiagram.io 붙여넣기도 같은 문법이라 함께 동작하지만, 문법 선택이 갈릴 때는
dbdocs 문서에서 읽기 좋은 쪽을 택한다.

---

## 1. 범위

**넣는 것**

| 방향 | 내용 |
|---|---|
| 내보내기 | `Project` 블록, `Table`(headercolor·note·컬럼 설정·`indexes` 블록), `TableGroup`(color), `Ref`(1:N `>` / 1:1 `-`, 합성키, 관계 이름) |
| 가져오기 | 위 전부를 되읽는다. 테이블·컬럼·PK·FK·인덱스·논리명 + **TableGroup → 그룹 생성** + **note의 JSON 꼬리 → 커스텀 항목 값** |

**빼는 것**

- **도메인 허용값 → `enum`**(사용자가 선택하지 않았다). 도메인은 DDL과 똑같이 방언 타입으로 풀려
  나간다. `enum`을 내면 컬럼 타입 자리에 enum 이름이 들어가 타입 왕복이 깨지고, 되읽을 때
  도메인으로 되돌릴 방법이 없어 "이름만 남은 타입"이 된다.
- **사전 정의 4종**(단어·용어·도메인·커스텀 항목의 *정의*). DBML에 실을 자리가 없고, 이미 Excel
  업로드·공용 리소스라는 전용 경로가 있다. 커스텀 항목은 **값만** 실린다(§3).
- 메모 엔티티·색상 영역·좌표. DBML은 캔버스를 담지 않는다.
- CLI 지원. 웹 UI 두 다이얼로그에서만 쓴다.

## 2. 구조 — 기존 가져오기 파이프라인에 합류한다

DBML 전용 경로를 새로 파지 않는다. **파서만 새로 쓰고 그 뒤는 DDL 가져오기와 같은 함수를 탄다.**

```
DDL  텍스트 ──parseDdl ─┐
                        ├─→ ParsedDdl ──planDdlImport──→ DdlImportPlan ──applyDdlImport──→ ProjectModel
DBML 텍스트 ──parseDbml─┘   (+groups, +customValues)
```

이름 충돌 판정·논리명 복원(코멘트→사전→물리명)·인덱스 컬럼 정규화·FK 해소·경고 5종·op 상한
검사·단일 Revision이 전부 그대로 따라온다. 300줄을 복제하면 한쪽만 고쳐지는 사고가 나는데, 이
저장소에서 반복된 결함 클래스다(HANDOFF 3.2b의 `loadLibraryItems` 단일화, 3.9의 `idOf` 단일 되쓰기).

| 파일 | 상태 | 책임 |
|---|---|---|
| `packages/core/src/dbml.ts` | 신규 | `generateDbml(model, dialect, scope, opts?)` |
| `packages/core/src/dbml-parse.ts` | 신규 | `parseDbml(text): ParsedDbml` |
| `packages/core/src/ddl-import.ts` | 확장 | `groups`·`customValues`를 **있으면** 처리 |
| `packages/core/src/ddl.ts` | 소폭 | 공유 판정 2개를 export, 경고 문구에서 형식 이름 제거 |
| `apps/web/src/editor/export-dialog.tsx` | 확장 | 네 번째 섹션 |
| `apps/web/src/editor/ddl-import-dialog.tsx` | 확장 | 형식 토글 |
| `apps/web/src/editor/ddl-import-edits.ts` | 확장 | 그룹 생성 + 커스텀 값 적용 |
| `apps/web/src/editor/store.ts` | 소폭 | `projectName` 필드 |

### 2.1 타입

```ts
// dbml-parse.ts
export type ParsedGroup = { name: string; color: string | null; tables: string[] }
export type ParsedCustomValue = {
  table: string; column: string | null; values: Record<string, string>
}
export type ParsedDbml = ParsedDdl & {
  groups: ParsedGroup[]
  customValues: ParsedCustomValue[]
  databaseType: string | null      // Project { database_type } 원문. 방언 자동 감지용
}
```

`planDdlImport`의 두 번째 인자 타입을 `ParsedDdl & Partial<Pick<ParsedDbml, 'groups' | 'customValues'>>`
로 넓힌다. DDL 경로에서는 두 필드가 `undefined`라 동작이 그대로다. 계획 타입에는 이렇게 붙는다:

```ts
export type DdlImportPlan = {
  …기존…
  groups: Array<{ name: string; color: string | null; tablePhysicalNames: string[]; existingId: string | null }>
}
export type DdlImportTable  = { …기존…; custom: Record<string, string> }   // 키 = customField.id
export type DdlImportColumn = { …기존…; custom: Record<string, string> }
export type DdlImportRelationship = {
  …기존…
  cardinality: '1:1' | '1:N'      // DDL 경로는 항상 '1:N'
  name: string | null             // DDL 경로는 항상 null (§4.3)
}
```

`existingId`는 같은 이름의 그룹이 모델에 이미 있을 때 그 id다(있으면 새로 만들지 않고 거기에 넣는다).

`ddl-parse.ts`의 `ParsedConstraint` fk 변형에 **옵셔널 `oneToOne?: boolean`** 을 더한다. DDL 파서는
채우지 않고 DBML 파서만 채운다(`-` 연산자). 지금 `applyDdlImport`는 카디널리티와 관계 이름을
`'1:N'`/`null`로 **고정**하고 있어서, 이 두 필드를 계획까지 실어 나르지 않으면 §7의 "1:1과 관계
이름은 왕복한다"가 성립하지 않는다.

## 3. note 포맷 = 왕복 계약

DDL 코멘트 규칙(`commentText` / `splitComment`, `'논리명 - 설명'`)을 **그대로** 쓰고 커스텀 항목만
JSON 꼬리로 덧붙인다.

```dbml
Table "MBR" [headercolor: #3498DB, note: '회원 - 회원 기본정보 {"보안등급":"2","담당자":"사원관리팀"}'] {
  "MBR_NO" number(10) [pk, increment, note: '회원번호']
  "MBR_NM" varchar2(100) [not null, note: '회원명 - 실명 {"개인정보":"Y"}']
}
```

**키는 커스텀 항목 정의의 이름이다.** 모델 내부 키는 `customField.id`(UUIDv7)인데 문서에 UUID가
보이면 dbdocs 발행이라는 목적 자체가 훼손된다. 내보낼 때 id→이름, 가져올 때 이름→id로 옮긴다.

- **정의를 못 찾은 키는 버리고 경고한다**(새 경고 종류 `unknown-custom-field`). 이름 키를 그대로
  `custom`에 심으면 id 공간과 섞이고, 나중에 같은 이름의 정의가 생겨도 영영 연결되지 않는 죽은
  값이 된다. 기존 "dangling 키 관대" 규칙은 *id* 키가 정의보다 오래 남는 경우를 위한 것이라 여기에
  해당하지 않는다.
- 값이 빈 문자열인 항목은 내보내지 않는다(미입력이다 — `resolveCustomValue`의 판정과 같다).
  그래서 `custom: { <id>: '' }` 는 되읽으면 키가 사라진다. **왕복 픽스처에 빈 값을 넣지 않는다** —
  이것은 손실이 아니라 "빈 문자열 = 미입력"이라는 기존 규칙의 귀결이다.
- 값이 하나도 없으면 JSON 꼬리를 생략한다. 논리명==물리명이고 설명·커스텀이 모두 없으면 note
  자체를 생략한다.

**파싱 규칙:** note 문자열의 **마지막 `{`부터 끝까지**를 `JSON.parse` 해 본다. 성공하고 결과가
평범한 객체이며 **모든 값이 문자열**이면 떼어내고, 그 외에는 통째로 설명으로 둔다. 사람이 손으로
쓴 `{}`가 섞인 note를 깨뜨리지 않는다. 떼어낸 뒤 남은 앞부분에 `splitComment`를 적용한다(앞부분이
비면 논리명 없음으로 보고 사전→물리명 복원 경로를 탄다).

## 4. 내보내기 (`generateDbml`)

```ts
export function generateDbml(
  model: ProjectModel, dialect: Dialect, scope: ExportScope = { kind: 'all' },
  opts?: { projectName?: string },
): string
```

**대상 테이블 선정은 `generateDdl`과 완전히 같다** — 0컬럼 테이블과 빈 물리명 테이블을 제외한다.
`ddl.ts`의 `selectTables`·`tableColumns`·`hasEmptyPhysicalName`을 export해 공유한다. 판정이 갈리면
"DDL에는 있는데 DBML에는 없는 테이블"이 조용히 생긴다.

경고도 `ddlWarnings` 하나를 공유한다. 다만 현재 문구가 `"…: 컬럼이 없어 DDL에서 제외됨"`이라
DBML 섹션에서 어색하므로 **문구에서 형식 이름을 뺀다**(`"…: 컬럼이 없어 내보내기에서 제외됨"`).
타입 해석 경고는 형식과 무관하게 동일하다.

### 4.1 출력 형태

```dbml
Project "회원 관리 시스템" {
  database_type: 'Oracle'
}

Table "MBR" [headercolor: #0E7A6C, note: '회원 - 회원 기본정보'] {
  "MBR_NO" number(10) [pk, increment, note: '회원번호']
  "MBR_NM" varchar2(100) [not null, note: '회원명']
  "STTS_CD" varchar2(2) [not null, default: '01', note: '상태코드']
  "REG_DT" date [not null, default: `SYSDATE`, note: '등록일시']

  indexes {
    ("MBR_NM", "STTS_CD") [name: 'IX_MBR_01']
    ("MBR_NM") [unique, name: 'UX_MBR_NM']
  }
}

TableGroup "회원 관리" [color: #0E7A6C] {
  "MBR"
  "MBR_ROLE"
}

Ref "FK_MBR_ROLE_MBR": "MBR_ROLE"."MBR_NO" > "MBR"."MBR_NO"
Ref: "MBR_DTL".("MBR_NO", "SEQ") - "MBR".("MBR_NO", "SEQ")
```

| 모델 | DBML |
|---|---|
| 컬럼 타입 | `resolveColumn(col, model, dialect).sql` — DDL과 같은 해석(도메인 방언 매핑 포함) |
| `isPk` 단일 | 컬럼 설정 `[pk]` |
| `isPk` 복합 | `indexes { ("A", "B") [pk] }` — DBML의 복합 PK 표현 |
| `autoIncrement` | `increment`. **DDL과 같은 조건**(`autoIncrement && isPk && 정수 논리타입`)일 때만 |
| `nullable: false` | `not null` |
| `defaultValue` | §4.2 |
| 논리명·설명·커스텀 | `note` (§3) |
| 인덱스 | `indexes` 블록. 이름은 `[name: '…']`로 보존, `unique`는 설정으로 |
| 그룹 | `TableGroup`(+`color`), 소속 테이블은 `headercolor` |
| 관계 | `Ref`. `1:N`은 `>`, `1:1`은 `-`, `rel.name`이 있을 때만 `Ref "이름":` (§4.3) |

**식별자는 항상 큰따옴표로 감싼다.** 한글 물리명·예약어·숫자 시작 이름이 전부 안전해지고,
dbml-cli 자신의 `sql2dbml` 출력도 같은 관례다. 내부 `"`는 `\"`로 이스케이프한다.

**문자열(note·`default`·`name`)은 작은따옴표**, 내부 `'`는 `\'`. **개행이 있으면 `'''…'''`**
(트리플 쿼트)로 낸다 — 설명은 여러 줄일 수 있다.

**`database_type`** 은 방언별 고정 문자열로 매핑한다: `postgresql → 'PostgreSQL'`,
`mysql → 'MySQL'`, `oracle → 'Oracle'`, `mssql → 'SQL Server'`. `DIALECT_LABEL`(한국어 표시명)을
쓰면 안 된다 — 이것은 dbdocs가 읽는 값이다.

**색상**은 `#RRGGBB` 6자리로 정규화해 낸다(모델에는 `#000` 같은 3자리도 들어 있다).

**범위(scope)** 는 DDL과 동일하게 적용한다. `TableGroup` 블록은 **선택된 테이블이 실제로 속한
그룹만** 내고, 블록 안에도 선택된 테이블만 적는다. `Ref`도 양쪽이 모두 선택 안에 있을 때만 낸다
(`selectedRelationships` 재사용).

### 4.2 `defaultValue` 표현

모델의 `defaultValue`는 DDL에 그대로 삽입되는 **원문**이다(`'ACTIVE'`, `0`, `SYSDATE`). DBML은
문자열·숫자·불리언·표현식을 문법으로 구분하므로 변환이 필요하고, 가져오기가 정확히 역을 수행한다.

| 원문 | DBML | 되읽으면 |
|---|---|---|
| `'ACTIVE'` (작은따옴표로 감싸임) | `default: 'ACTIVE'` | `'ACTIVE'` |
| `0`, `-1.5` (숫자 리터럴) | `default: 0` | `0` |
| `TRUE` / `FALSE` (대소문자 무시) | `default: true` | `TRUE` |
| `NULL` | `default: null` | `NULL` |
| 그 외 (`SYSDATE`, `now()`, `CURRENT_TIMESTAMP`) | ``default: `SYSDATE` `` (백틱 = 표현식) | `SYSDATE` |

불리언·`NULL`은 대문자로 되돌린다(DDL 관례). 이 표를 테스트에 그대로 박아 양방향으로 고정한다.

### 4.3 관계 이름은 `fkBaseName` 폴백을 쓰지 않는다

DDL 내보내기는 이름 없는 관계에도 `FK_자식_부모`를 만들어 붙인다(SQL이 제약명을 요구하므로).
DBML의 `Ref`는 이름이 선택이라 **`rel.name`이 비어 있으면 익명 `Ref:`로 낸다.** 폴백을 쓰면 되읽을
때 원본에 없던 이름이 생겨 왕복이 깨진다. 같은 이유로 **1:1에 UNIQUE 제약을 동반시키지 않는다**
(§5) — DBML은 `-` 하나로 1:1을 말할 수 있고, UNIQUE를 내면 되읽을 때 원본에 없던 유니크 인덱스가
생긴다. DDL 왕복이 1:1에서 깨지는 것은 SQL 문법의 제약이지 우리가 물려받아야 할 것이 아니다.

## 5. 가져오기 (`parseDbml`)

**손으로 쓴 좁은 파서**다 — DDL 파서(`ddl-parse.ts`)와 같은 방침이고, `@dbml/core` 의존을 들이지
않는다(core는 IO·런타임 의존성 free가 규칙이고, `exceljs`조차 web에만 두고 동적 import 한다).

**이해하는 것:** `Project` 블록(`database_type`만), `Table`(별칭 `as X` 허용·무시, 설정
`headercolor`·`note`), 컬럼 줄(타입 + `[pk]`/`primary key`/`not null`/`null`/`unique`/`increment`/
`default:`/`note:`/인라인 `ref: > 대상`), `indexes` 블록(단일·합성, `[pk]`/`unique`/`name:`/`note:`),
`Ref` 블록·줄(이름 유무, `>` `<` `-`, 합성 `(a, b)`), `TableGroup`(+`color`·`note`), 주석(`//`,
`/* */`).

**건너뛰고 경고하는 것:** `Enum` 정의(컬럼 타입이 enum 이름이면 타입 원문으로 그대로 둔다),
`sticky note`, `TablePartial`, 그 밖에 모르는 최상위 블록. DDL 파서의 `skipped` 목록과 같은
방식으로 `skipped-statement` 경고를 낸다.

**방향 정규화:** DBML의 `<`는 one-to-many라 `A.x < B.y`는 "B가 자식"이다. `>`와 `-`는 왼쪽이
자식이다. 파서가 **항상 자식→부모 방향의 `ParsedConstraint`(`kind: 'fk'`)로 정규화**해서 낸다.
`-`는 `oneToOne: true`로 표시하고 **UNIQUE 제약은 만들지 않는다**(§4.3). `Ref` 이름은 fk 제약의
기존 `name` 필드에 담아 계획까지 나른다.

**인라인 `ref:`** 는 `Ref` 줄과 같은 제약으로 펼친다. **컬럼 설정의 `unique`** 는 UNIQUE 제약으로
낸다 — 우리 내보내기는 유니크 인덱스를 `indexes` 블록으로만 내지만, 남이 쓴 파일에는 컬럼 설정으로
있을 수 있고 `planDdlImport`의 UNIQUE→인덱스 경로가 이미 그것을 처리한다.

**PK:** 컬럼 설정 `[pk]`는 `inlinePk`로, `indexes` 블록의 `[pk]`는 `ParsedConstraint(kind:'pk')`로 낸다.

**note:** 테이블·컬럼 note는 §3의 규칙으로 쪼개, 설명 부분을 `ParsedComment`로(DDL의 `COMMENT ON`과
같은 자리) JSON 부분을 `customValues`로 낸다. **파서가 커스텀 항목 정의를 모른다**(모델을 안 받는다)
— 이름→id 변환과 `unknown-custom-field` 경고는 모델을 손에 쥔 `planDdlImport`가 한다.

**그룹:** `TableGroup`은 `ParsedGroup`으로 낸다. 이름이 같은 그룹이 모델에 이미 있으면
`planDdlImport`가 `existingId`를 채워 재사용한다(대소문자 무시 비교 — 테이블 이름 충돌 판정과 같은
`upper()` 관례). 건너뛴 테이블(이름 충돌)은 그룹 목록에서도 빠진다. 그룹 색은 `TableGroup [color:]`
→ 소속 테이블의 `headercolor`(먼저 나온 것) → 없으면 `null` 순으로 정한다. `null`이면
`applyDdlImport`가 웹의 그룹 생성 기본색을 쓴다 — 색은 모델에서 `string`(비어 있을 수 없다)이다.

**방언 자동 감지:** `Project { database_type }` 원문을 소문자로 비교해 방언을 고른다
(`postgres*`/`mysql`/`mariadb`/`oracle`/`sql server`·`mssql`). 없으면 `postgresql`. 사용자가 언제나
수동으로 덮을 수 있는 것은 DDL과 같다.

**op 수:** `opCountEstimate`에 **새로 만드는 그룹 수**를 더한다. 커스텀 값은 테이블·컬럼 create op에
실려 나가므로 더하지 않는다.

## 6. 웹 UI

**내보내기** — `Section` 타입에 `'dbml'`을 더해 네 번째 버튼. 방언 버튼 4개와 `ExportScopeSelect`는
DDL 섹션과 **같은 state를 공유**한다(형식을 바꿔도 고른 방언·범위가 유지된다). 미리보기 `<pre>`,
경고 목록, 복사·다운로드(`erdd_<dialect>.dbml`, MIME `text/plain`).

**가져오기** — 다이얼로그 맨 위에 형식 토글(`DDL` / `DBML`). 제목은 「DDL 가져오기」 → 「가져오기」.
형식에 따라 파서만 갈리고 방언 선택·미리보기 문장·경고 목록·op 상한·적용 버튼은 완전히 공유한다.
DBML을 고르면 자동 감지 출처가 `detectDialect(text)` → `parseDbml(text).databaseType`으로 바뀐다.
미리보기 문장에 **그룹 수**를 더한다(DBML일 때만 0이 아니다). 요약 문구는 `summary: 'DBML 가져오기'`.

**store** — `use-model.ts`가 이미 `project.get`을 불러 `namingRules`·`dialects`를 싣고 있으므로
`projectName`을 같은 자리에서 싣는다. `ExportDialog`는 props 없이 store만 읽는 현재 형태를 유지한다.

**적용(`applyDdlImport`)** — 그룹을 먼저 만들고(또는 `existingId`를 쓰고) 테이블의 `groupId`에
꽂는다. 테이블·컬럼의 `custom`은 계획의 값을 그대로 옮긴다(현재는 `custom: {}` 고정). 관계의
`cardinality`·`name`도 계획의 값을 쓴다(현재는 `'1:N'`·`null` 고정 — DDL 경로는 계획에서 같은 값이
오므로 동작이 바뀌지 않는다). 자동 배치·기존 테이블 아래로 밀기는 그대로다. **`groupPosition`은
`null`로 둔다** — 그룹 뷰 좌표는 그 뷰를 처음 열 때 계산되는 값이라 가져오기가 정할 것이 아니다.

## 7. 왕복

기준선은 DDL 역설계와 같은 형태다:

```
generateDbml(model, 'postgresql') → parseDbml → planDdlImport → applyDdlImport  ===  원본 model
```

id·좌표는 비교에서 제외한다. **PostgreSQL로 돌린다** — 타입 매핑이 단사라 방언 충돌 5건
(`2026-08-03-ddl-reverse-engineering-design.md` §2)이 개입하지 않는다. 그 5건은 `resolveColumn`/
`fromDialectType`을 공유하므로 DBML도 그대로 물려받지만, **이번 작업이 만드는 손실이 아니고 이미
`ddl-import.test.ts`에 상수로 박혀 있다** — 중복해서 만들지 않는다.

**이번 작업이 새로 만드는 왕복 손실은 넷이다.** 왕복 비교의 명시적 예외로 테스트에 박는다.

| 잃는 것 | 이유 | 되읽으면 |
|---|---|---|
| 인덱스 컬럼의 정렬 방향(`asc`/`desc`) | DBML `indexes` 블록에 컬럼별 방향 표기가 없다 | 전부 `asc`. DDL 가져오기도 같은 손실이다 |
| `relationship.identifying` | DBML에 표현이 없다 | "FK 컬럼 ⊆ 자식 PK" 규칙으로 **재추론**한다. 어긋나는 것은 "FK가 자식 PK에 들어 있는데 비식별로 표시해 둔 관계" 하나뿐이며 그것은 식별로 뒤집힌다 |
| `column.domainId` | 도메인이 방언 타입으로 풀려 나간다(enum 제외) | 타입 원문 + `domainId: null`. DDL 역설계와 같은 경계 |
| 메모·색상 영역·좌표 | DBML은 캔버스를 담지 않는다 | 좌표는 자동 배치로 새로 계산 |

그룹·그룹 색상·커스텀 항목 값·관계 이름·1:1 여부·자동증가·기본값·논리명·설명은 **왕복한다.**

## 8. 테스트

- **왕복(핵심).** 커스텀 항목 값·그룹·색상·합성 FK·1:1·복합 PK·한글 물리명·작은따옴표가 든 설명·
  여러 줄 설명을 모두 담은 픽스처 모델 하나로 §7의 왕복을 돌리고 원본과 비교. 손실 넷만 예외.
- **`generateDbml` 단위.** 인용·이스케이프(한글·`"`·`'`·개행), `default` 5형태(§4.2), 복합 PK,
  `increment` 조건, 범위 필터(그룹·선택 테이블에서 `TableGroup`·`Ref`가 함께 좁혀지는지),
  0컬럼·빈 물리명 제외가 `generateDdl`과 일치하는지.
- **`parseDbml` 단위.** 주석, 별칭, 인라인 `ref:`, 컬럼 `unique` → UNIQUE 제약, `<` 방향 정규화,
  `-` → `oneToOne`(그리고 **유니크 인덱스가 생기지 않는 것**), `indexes` 블록의 `[pk]`, 트리플 쿼트
  note, `Enum`·모르는 블록의 `skipped`, `database_type` 감지, 깨진 입력에서 죽지 않고 경고로 끝나는지.
- **1:1과 관계 이름.** 익명 관계가 익명으로 왕복하는지(폴백 이름이 붙지 않는지), 이름 있는 관계가
  이름을 유지하는지, `cardinality: '1:1'`이 `-`로 나갔다가 `'1:1'`로 돌아오는지.
- **note JSON 꼬리.** 정상·꼬리 없음·잘못된 JSON(설명으로 남는다)·값이 문자열이 아님(설명으로
  남는다)·설명 안에 `{}`가 있고 꼬리도 있는 경우.
- **`planDdlImport` 확장.** `unknown-custom-field` 경고, 같은 이름 그룹 재사용(`existingId`),
  건너뛴 테이블이 그룹 목록에서도 빠지는지, `opCountEstimate`에 그룹이 더해지는지,
  **DDL 경로에 회귀가 없는지**(`groups`/`customValues`가 `undefined`일 때 기존 테스트 전부 통과).
- **웹.** 내보내기 다이얼로그의 DBML 섹션 렌더·다운로드 파일명, 가져오기 형식 토글이 파서를
  가르는지, 그룹·커스텀이 적용된 모델이 나오는지(`applyDdlImport` 단위).

## 9. 문서

- `docs/17-import-export.md` — 기능 상세에 "DBML 내보내기"·"DBML 가져오기" 절, 단계별 범위에 추가.
- `docs/manual/user-guide.md` — 내보내기·가져오기 절에 DBML 선택지와 note 규칙(커스텀 항목 JSON).
- `docs/superpowers/HANDOFF.md` — 완료 표 한 줄, 테스트 기준선 4수 갱신.
