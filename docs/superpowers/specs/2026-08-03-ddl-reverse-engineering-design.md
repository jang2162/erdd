# DDL 역설계(가져오기) 설계

**작성일:** 2026-08-03
**상태:** 승인 대기
**원 기획:** [docs/17-import-export.md](../../17-import-export.md) "DDL 가져오기 (역설계)", [docs/90-roadmap.md](../../90-roadmap.md) Phase 4
**해소하는 체크리스트 항목:** [docs/91-checklist.md](../../91-checklist.md) "DDL 역설계 범위 — 지원 방언별 파싱 범위와 한계, 파서 라이브러리 선택"

## Phase 4 분해

Phase 4는 서로 의존하지 않는 두 sub-project다. **이 명세는 (B)만 다룬다.**

- **(A) CLI + 에이전트 스킬** — ApiToken 인증(현재 `api_tokens` 테이블 없음), 새 npm 패키지, 분할 YAML 포맷과 직렬화, 3-way 병합, `init/pull/push/diff/status/validate`, 동봉 `SKILL.md`. 별도 사이클.
- **(B) DDL 역설계** — 이 문서.

(B)를 먼저 하는 이유: 자체 완결적이고(파서 + 가져오기 UI, 새 인증 경로 없음), 기존 DB에서 시작하는 현장의 첫 사용 장벽을 직접 낮추며, "외부 표현 ↔ 내부 모델" 변환을 한 번 겪은 뒤에 CLI 파일 포맷을 설계하게 된다.

## 목표

DDL 텍스트를 붙여넣거나 파일로 올리면 파싱해 테이블·컬럼·PK·FK·인덱스를 만들고, 프로젝트 사전으로 물리명에서 논리명을 복원한다.

## 핵심 결정 (사용자 확정)

- **손으로 쓴 좁은 파서.** 파서 라이브러리를 도입하지 않는다. `packages/core`의 의존성은 `zod` 하나뿐이고 그 원칙을 지킨다. 라이브러리를 써도 AST → 모델 변환은 어차피 직접 써야 하고, 방언별 지원 품질 편차를 우리가 흡수해야 하며, 실패 구문을 사용자에게 정확히 알려주는 통제가 어렵다.
- **범위는 "왕복 + 실무 구문".** 우리 내보내기의 왕복을 보장하고, 거기에 실무 DDL에 항상 나오는 것을 더한다. 그보다 넓은 것(CHECK, 파티션, 트리거, 시퀀스, 권한)은 건너뛰고 경고한다.
- **모호하면 보수적 기본값 + 경고.** 방언 타입이 논리타입 여러 개에 대응할 때, 내보내기 매핑과 정확히 일치하는 후보가 있으면 그것을 고르고, 없으면 덜 놀라운 쪽을 고른 뒤 경고 목록에 남긴다. 대량 임포트가 막히지 않는다.
- **논리명은 코멘트 → 사전 → 물리명 순으로 복원한다.** DDL 코멘트가 있으면 그것이 논리명이다(국내 SI·공공 DDL의 실제 모습이고, 우리 내보내기도 논리명을 코멘트에 넣는다). 코멘트가 없을 때만 사전 역매칭으로 넘어가고, 이때는 **모든 토큰이 매칭될 때만** 제안한다. 한글·영문이 섞인 반쪽짜리 논리명을 만들지 않는다.
- **이름 충돌은 건너뛴다.** 같은 물리명 테이블이 이미 있으면 만들지 않고 미리보기에 "N개 건너뜀"을 표시한다. 기존 설계를 덮어쓰는 사고가 구조적으로 불가능하다.
- **진입점은 툴바 `가져오기` 신설.** `내보내기` 옆에 대칭으로 둔다.

**범위 밖:** CLI(별도 sub-project), CHECK 제약 → 도메인 허용값 변환, 기존 테이블과의 병합·재동기화, 실제 DB 접속 스캔(로드맵의 "추후 검토"), 뷰·프로시저·트리거.

## 아키텍처 / 방침

기존 **Excel 사전 업로드**가 이미 `core`에 순수 계획 함수 · `web`에 적용 producer · `web`에 UI 3단이다. 같은 모양을 따른다.

| 계층 | 파일 | 책임 |
|---|---|---|
| core | `ddl-parse.ts` (신규) | DDL 텍스트 → 구조. 방언 감지 포함. 의미 해석 없음 |
| core | `dialect.ts` (수정) | `fromDialectType` — `toDialectType`의 역함수 |
| core | `naming.ts` (수정) | `restoreLogicalName` — `generatePhysicalName`의 역함수 |
| core | `ddl-import.ts` (신규) | `planDdlImport` — 파싱 결과 + 현재 모델 + 사전 → 계획·경고·충돌 |
| web | `ddl-import-edits.ts` (신규) | 계획 → 다음 모델(자동 배치 포함) |
| web | `ddl-import-dialog.tsx` (신규) | 붙여넣기·파일 → 미리보기 → 적용 |

### 1. 역함수는 정함수 옆에 둔다

`fromDialectType`은 `dialect.ts`에, `restoreLogicalName`은 `naming.ts`에 넣는다. 별도 파일로 떼지 않는다.

이유는 **동기화**다. 두 쌍은 서로의 역이므로 한쪽을 고치면 반드시 다른 쪽도 봐야 한다. 같은 파일에 있으면 고칠 때 눈에 들어오고, 떨어뜨리면 조용히 어긋난다. 이 프로젝트는 이미 "손-미러가 조용히 어긋난다"는 문제를 `NamingRulesSchema`에서 겪었다(HANDOFF §6).

### 2. 왕복이 이 설계의 기준선

가장 강한 테스트는 이것이다:

```
generateDdl(model, dialect) → parseDdl → planDdlImport(…, dialect, …) → applyDdlImport  ===  원본 model
```

(테이블·컬럼 id와 배치 좌표는 비교에서 제외한다 — id는 새로 발급되고 좌표는 DDL에 없다.)

**왕복 픽스처는 도메인을 쓰지 않는 컬럼만 담는다.** 내보내기의 `resolveColumn`이 도메인을 타입으로 풀어 쓰므로 DDL에는 도메인의 흔적이 남지 않고, 가져오기는 타입만 채우고 `domainId`를 비운다(도메인 자동 매칭은 범위 밖). 도메인을 쓴 컬럼을 픽스처에 넣으면 왕복이 `domainId`에서 깨지는데, 그건 파서의 결함이 아니라 이 범위의 경계다.

같은 이유로 픽스처는 **허용값이 있는 도메인을 쓰지 않는다** — 내보내기가 `CHECK (col IN (…))`을 붙이는데 우리는 `CHECK`를 건너뛰기 때문이다. 모델 자체는 그대로 왕복하지만 경고가 섞여 테스트 의도가 흐려진다.

논리명·설명은 **코멘트를 통해** 왕복한다(§5). `commentText`가 `'논리명 - 설명'`으로 합치고 가져오기가 첫 `' - '`에서 되나눈다. 설명 자체에 `' - '`가 들어 있으면 뒤쪽이 설명으로 온전히 남으므로 왕복이 유지된다.

**단, MSSQL에서는 코멘트가 왕복하지 않는다.** 내보내기가 MSSQL 코멘트를 `EXEC sys.sp_addextendedproperty`로 내는데, 이것은 `CREATE TABLE`·`ALTER TABLE`·`CREATE INDEX`·`COMMENT ON`과 완전히 다른 문장 형태이고 §3의 파싱 범위 밖이다. MSSQL DDL을 가져오면 **구조(테이블·컬럼·타입·PK·관계·인덱스)는 정상 왕복하지만 논리명은 사전 → 물리명 순으로 떨어지고 `unknown-word` 경고가 남는다.** 이 동작을 테스트로 고정해 두었다 — 나중에 구조까지 깨지는 회귀가 생기면 드러난다. MySQL은 테이블 코멘트가 닫는 괄호 뒤 꼬리 절(`) … COMMENT '…'`)로 나가는데 이는 `CREATE TABLE` 문장의 일부라 파싱 범위 안이며 정상 왕복한다.

**PostgreSQL에서는 정확히 성립해야 한다.** `dialect.ts`의 PostgreSQL 매핑은 단사다(`text`/`jsonb`/`uuid`/`timestamp`/`timestamptz`/`boolean`/`date`/`time`이 모두 구별된다).

**나머지 3방언은 내보내기 자체가 이미 손실적이다.** 두 논리타입이 같은 방언 타입으로 나가면 되돌릴 때 하나는 반드시 진다. 이것은 이번 작업이 만드는 손실이 아니라 기존 매핑의 성질이고, `dialect.ts`의 `ORACLE_WARN`이 이미 일부를 경고하고 있다.

왕복이 깨지는 것은 다음 **5건**이다. 앞의 넷은 두 논리타입이 같은 방언 타입으로 나가서 하나가 밀린 것이고, 마지막 하나는 우리가 실무 정확성을 위해 일부러 포기한 것이다:

| 논리타입 | 방언 | 내보내면 | 다시 읽으면 | 진 이유 |
|---|---|---|---|---|
| `JSON` | oracle | `CLOB` | `TEXT` | `TEXT`도 `CLOB`으로 나간다 |
| `DATE` | oracle | `DATE` | `DATETIME` | `DATETIME`도 `DATE`로 나간다. Oracle `DATE`는 시각을 포함하므로 `DATETIME`이 더 정확하다 |
| `TIME` | oracle | `TIMESTAMP` | `DATETIME` | **의도한 포기** — 아래 참조 |
| `JSON` | mssql | `NVARCHAR(MAX)` | `TEXT` | `TEXT`도 `NVARCHAR(MAX)`로 나간다 |
| `UUID` | mysql | `CHAR(36)` | `CHAR(36)` | `CHAR(36)`이 그대로 유효한 타입이다 |

**Oracle `TIMESTAMP`는 왕복을 포기하고 실무를 택한다.** 우리 매핑에서 `TIMESTAMP`는 `TIME`에서만 나오므로 `TIME`으로 읽으면 왕복이 살아난다. 하지만 실무 Oracle DDL의 `TIMESTAMP` 컬럼은 거의 항상 시각(time-of-day)이 아니라 일시다. 왕복은 우리 테스트의 편의고 실무 DDL을 옳게 읽는 것이 제품의 목적이므로 `DATETIME`으로 읽고, 경고의 대안에 `TIME`을 적어 사용자가 고칠 수 있게 한다.

나머지는 전부 왕복한다. **PostgreSQL은 충돌이 0건**이고, MySQL·MSSQL은 각 1건뿐이다.

**이 5건을 테스트에 상수 목록으로 박는다.** 매핑을 손대서 승패가 바뀌면 목록이 어긋나 바로 드러난다.

### 3. 파싱 범위

**이해하는 것:**

- `CREATE TABLE` — 컬럼 정의(타입, `NOT NULL`, `NULL`, `DEFAULT`, 인라인 `PRIMARY KEY`, 인라인 `UNIQUE`, 인라인 `REFERENCES`), 테이블 수준 `PRIMARY KEY (…)` · `UNIQUE (…)` · `FOREIGN KEY (…) REFERENCES …`
- 자동증가 — MySQL `AUTO_INCREMENT`, PostgreSQL `serial`/`bigserial`/`GENERATED … AS IDENTITY`, MSSQL `IDENTITY(…)`, Oracle `GENERATED … AS IDENTITY`
- `ALTER TABLE … ADD CONSTRAINT …` — `PRIMARY KEY` · `UNIQUE` · `FOREIGN KEY`
- `CREATE [UNIQUE] INDEX … ON …`
- 코멘트 — `COMMENT ON TABLE/COLUMN …`(PostgreSQL·Oracle), MySQL 인라인 `COMMENT '…'`
- 식별자 — 따옴표(`"x"`, `` `x` ``, `[x]`) 해제, 스키마 접두사(`public.`, `dbo.`, `SCOTT.`) 제거
- 주석 — `--`, `/* */`
- 구분자 — `;`, Oracle 스크립트의 `/`

**건너뛰고 경고하는 것:** `CHECK`, 파티션 절, 테이블스페이스·스토리지 절, `CREATE TRIGGER/SEQUENCE/VIEW/PROCEDURE`, `GRANT`, `SET`, `ALTER TABLE … ENABLE/DISABLE`, 그 밖에 인식하지 못한 문장.

건너뛴 문장은 키워드·줄 번호·앞부분 발췌를 경고에 담는다. "관대한 파싱"은 이 프로젝트의 기존 방침이다(논리 타입 파싱, [91-checklist](../../91-checklist.md) Phase 2).

**방언 감지**는 특징 토큰 점수제로 한다: `AUTO_INCREMENT`·백틱 → mysql, `VARCHAR2`·`NUMBER(`·`CLOB` → oracle, `NVARCHAR`·`IDENTITY(`·`[대괄호]` → mssql, `serial`·`jsonb`·`timestamptz`·`text` → postgresql. 동점이거나 근거가 없으면 `null`을 돌려주고 UI가 사용자에게 고르게 한다. 감지 결과는 항상 **수동으로 덮을 수 있다.**

### 4. 타입 역매핑의 3단 처리

| 상황 | 처리 |
|---|---|
| 후보 1개 | 그대로 변환 |
| 후보 2개 이상 | 내보내기 매핑과 정확히 일치하는 후보가 있으면 그것, 없으면 덜 놀라운 쪽. **경고에 대안을 함께 적는다** |
| 인식 실패 | 원문 보존(직접 입력 타입) + 경고 — `parseLogicalType`이 이미 `{ok:false, raw}`를 돌려주는 기존 동작 |

확정된 모호 케이스의 기본값:

| 방언 타입 | 고르는 것 | 대안(경고에 표기) |
|---|---|---|
| oracle `NUMBER(5)` / `(10)` / `(19)` / `(1)` | `SMALLINT` / `INT` / `BIGINT` / `BOOLEAN` | `DECIMAL(p,0)` |
| oracle `NUMBER(p)` (위 외) | `DECIMAL(p,0)` | — |
| oracle `NUMBER(p,s)` | `DECIMAL(p,s)` | — |
| oracle `DATE` | `DATETIME` | `DATE` |
| oracle `TIMESTAMP` | `DATETIME` | `TIME` |
| oracle `CLOB` | `TEXT` | `JSON` |
| mssql `NVARCHAR(MAX)` | `TEXT` | `JSON` |
| mysql `TINYINT(1)` | `BOOLEAN` | `SMALLINT` |
| mysql `CHAR(36)` | `CHAR(36)` | `UUID` |

### 5. 논리명 복원 — 코멘트 → 사전 → 물리명

**코멘트가 첫 번째 출처다.** 국내 SI·공공 DDL은 코멘트가 곧 논리명인 경우가 압도적이고, 우리 내보내기도 `commentText`가 논리명을 코멘트에 넣는다(`'논리명 - 설명'`). 게다가 DDL을 가져오는 시점은 대개 프로젝트가 **비어 있을 때**라 사전에 기댈 수 없다. 사전만 쓰면 첫 가져오기에서 논리명이 하나도 복원되지 않는다.

1. **코멘트가 있으면** 그것을 논리명으로 쓴다. 첫 `' - '`에서 한 번만 쪼개 앞을 논리명, 뒤를 `comment`로 둔다(`commentText`의 역). 구분자가 없으면 전체가 논리명이고 `comment`는 `null`이다.
2. **코멘트가 없으면 사전 역매칭**한다:
   - 물리명 전체가 어떤 용어의 `physicalName`과 일치하면 그 용어의 `logicalName`(용어사전이 "논리명 전체가 완전일치할 때 우선 적용"이므로 역방향도 용어가 우선)
   - 아니면 명명 규칙으로 토큰을 나눠 단어사전의 `abbreviation`과 역매칭한다. **모든 토큰이 매칭될 때만** 논리명을 이어붙인다.
3. **둘 다 실패하면** 물리명을 논리명으로 두고 `unknown-word` 경고를 남긴다.

`unknown-word` 경고는 **2단계까지 실패했을 때만** 낸다. 코멘트로 논리명이 복원된 컬럼은 경고 대상이 아니다. 남은 경고 목록이 곧 사전에 채워 넣을 일감이 된다.

테이블명·컬럼명 모두 같은 규칙을 쓴다.

### 6. 적용

- **이름 충돌**(같은 물리명 테이블이 이미 존재) → 그 테이블 전체를 건너뛴다. 그 테이블을 참조하는 FK도 함께 건너뛰고 경고한다.
- **미해결 FK**(참조 대상 테이블이 DDL에도 프로젝트에도 없음) → 관계를 만들지 않고 경고한다.
- **PK와 중복되는 인덱스** → 만들지 않는다. DDL 추출본에는 PK 제약과 그것을 뒷받침하는 유니크 인덱스가 함께 나오는 경우가 흔하다(Oracle·MSSQL). 같은 테이블에서 컬럼 집합이 PK와 정확히 일치하는 유니크 인덱스는 조용히 제외한다 — 경고하지 않는다(사용자가 고칠 것이 없다).
- **자동 배치** — `computeAutoLayout`(web, dagre)을 재사용한다. 렌더 전이라 실측 크기가 없으므로 폭 260 고정, 높이는 `40 + 컬럼수 × 28`로 추정한다(툴바의 자동 정렬이 이미 `?? 260` 폴백을 쓰는 것과 같은 방식). FK를 알고 있으므로 격자보다 나은 출발점이 나온다. 기존 테이블이 있으면 **기존 테이블들의 최대 y + 200**부터 아래로 배치해 겹치지 않게 한다.
- **op 한도** — 계획 단계에서 op 수를 추정해 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 적용 버튼을 막고 안내한다. Excel 사전 업로드가 같은 벽을 "파일을 나눠 올려주세요"로 처리하는 것과 같은 방침이다.
- **단일 mutation** — 가져오기 전체가 Revision 1건이다. undo 한 번으로 통째 되돌아간다.
- **권한** — 진입점과 적용은 `canEdit` 게이트를 받는다([2026-08-01-viewer-readonly-ui-design.md](2026-08-01-viewer-readonly-ui-design.md)). Viewer에게는 툴바의 `가져오기` 버튼이 보이지 않는다.

### 7. 화면

툴바 `내보내기` 옆에 `가져오기`를 신설한다. 다이얼로그 한 개:

```
DDL 가져오기

[텍스트 붙여넣기 ▾]  방언: [자동 감지: PostgreSQL ▾]      [파일 선택]
┌──────────────────────────────────────────┐
│ CREATE TABLE MBR ( …                     │
└──────────────────────────────────────────┘

미리보기
  테이블 12개 · 컬럼 87개 · 관계 9개 · 인덱스 4개
  건너뜀 2개 (이미 있는 이름: MBR, ORD)
  경고 6건  ▾
    MBR_HIST.REG_DT   CLOB을 TEXT로 읽었습니다 (JSON일 수 있습니다)
    MBR_HIST          논리명 미복원 — 사전에 없는 단어: HIST
    12행              CHECK 제약을 건너뛰었습니다

                                  [취소]  [12개 테이블 가져오기]
```

파싱은 입력이 바뀔 때마다 즉시 돌린다(순수 함수라 서버 왕복이 없다). 적용 전까지 모델은 바뀌지 않는다.

## 인터페이스

```ts
// packages/core/src/ddl-parse.ts
export type ParsedColumn = {
  name: string
  rawType: string              // 원문 그대로. 예: 'NUMBER(10)', 'VARCHAR2(100)'
  notNull: boolean
  defaultValue: string | null
  autoIncrement: boolean
  inlinePk: boolean
  comment: string | null       // MySQL 인라인 COMMENT
}
export type ParsedTable = { name: string; columns: ParsedColumn[] }
export type ParsedConstraint =
  | { kind: 'pk'; table: string; columns: string[] }
  | { kind: 'unique'; table: string; name: string | null; columns: string[] }
  | { kind: 'fk'; table: string; name: string | null; columns: string[]
      refTable: string; refColumns: string[] }
export type ParsedIndex = { table: string; name: string; columns: string[]; unique: boolean }
export type ParsedComment = { table: string; column: string | null; text: string }
export type SkippedStatement = { keyword: string; line: number; excerpt: string }

export type ParsedDdl = {
  tables: ParsedTable[]
  constraints: ParsedConstraint[]
  indexes: ParsedIndex[]
  comments: ParsedComment[]
  skipped: SkippedStatement[]
}

/** 특징 토큰 점수제. 근거가 없거나 동점이면 null. */
export function detectDialect(ddl: string): Dialect | null

/**
 * 방언 인자를 받지 않는다 — 따옴표 세 종류를 모두 처리하고 자동증가 패턴도 한꺼번에 보므로
 * 파싱 자체는 방언과 무관하다. 방언이 필요한 곳은 타입 매핑뿐이고 그것은 planDdlImport에서 한다.
 */
export function parseDdl(ddl: string): ParsedDdl
```

```ts
// packages/core/src/dialect.ts — toDialectType 바로 아래에 추가
export type FromDialectResult =
  | { ok: true; type: LogicalType; canonical: string; alternatives: LogicalTypeKind[] }
  | { ok: false; raw: string }

/** toDialectType의 역함수. alternatives가 비어 있지 않으면 모호하게 해석한 것이다. */
export function fromDialectType(sqlType: string, dialect: Dialect): FromDialectResult
```

```ts
// packages/core/src/naming.ts — generatePhysicalName 바로 아래에 추가
export type RestoreLogicalResult =
  | { ok: true; logicalName: string }
  | { ok: false; unknownTokens: string[] }

/** generatePhysicalName의 역함수. 모든 토큰이 매칭될 때만 ok:true. */
export function restoreLogicalName(
  physicalName: string,
  words: Record<string, Word>,
  terms: Record<string, Term>,
  rules: NamingRules,
): RestoreLogicalResult
```

```ts
// packages/core/src/ddl-import.ts
export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word'
      | 'table-conflict' | 'unresolved-fk' | 'skipped-statement'
  target: string               // 'MBR' 또는 'MBR.MBR_NO' 또는 '12행'
  message: string              // 한국어 완성 문장
}
export type DdlImportColumn = {
  physicalName: string; logicalName: string; type: string
  isPk: boolean; nullable: boolean; autoIncrement: boolean
  defaultValue: string | null; comment: string | null
}
export type DdlImportTable = {
  physicalName: string; logicalName: string
  columns: DdlImportColumn[]
  indexes: Array<{ name: string; columnPhysicalNames: string[]; unique: boolean }>
}
export type DdlImportRelationship = {
  childPhysicalName: string; parentPhysicalName: string
  columnPairs: Array<{ child: string; parent: string }>
  identifying: boolean         // 자식의 FK 컬럼이 전부 자식 PK면 식별 관계
}
export type DdlImportPlan = {
  tables: DdlImportTable[]
  relationships: DdlImportRelationship[]
  skippedTables: string[]      // 이름 충돌로 제외된 것
  warnings: DdlImportWarning[]
  opCountEstimate: number      // MAX_OPS_PER_MUTATION 사전 판정용
}

export function planDdlImport(
  model: ProjectModel, parsed: ParsedDdl, dialect: Dialect, rules: NamingRules,
): DdlImportPlan
```

```ts
// apps/web/src/editor/ddl-import-edits.ts
/** 계획을 모델에 적용한다(순수). 자동 배치까지 여기서 한다. */
export function applyDdlImport(
  model: ProjectModel, plan: DdlImportPlan, newId: () => string,
): ProjectModel
```

`newId`를 인자로 받는 것은 `applyDictImport(model, plan, mode, newId)`와 같은 관례다.

## 전역 제약 (Global Constraints)

- **`packages/core`에 새 런타임 의존성을 넣지 않는다.** 현재 의존성은 `zod` 하나뿐이고 그 상태를 유지한다. 파서는 손으로 쓴다.
- **`dialect.ts`의 `toDialectType`·`FIXED` 매핑을 바꾸지 않는다.** 역함수를 추가만 한다. 정함수를 고치면 기존 내보내기가 바뀐다.
- 불가침: `packages/core/src/diff.ts` · `op.ts`(`ENTITY_KINDS`·`applyOps`) · `integrity.ts` · `model.ts`, `apps/server/src/services/perm.ts`.
- **서버·마이그레이션 변경 없음.** 가져오기는 기존 `model.mutate` 경로를 그대로 쓴다.
- 가져오기 전체가 **단일 mutation**이다(Revision 1건).
- 진입점·적용은 `canEdit` 게이트를 받는다.
- 파싱·계획 함수는 **순수 함수**다(입력 → 값, IO·스토어 접근 없음).
- 새 런타임 의존성 금지. UI 카피는 한국어. 툴바 버튼 문구는 정확히 `가져오기`.
- **웹 재발 버그 주의**: 이벤트 값은 producer 진입 **전에** 캡처한다(HANDOFF §3.4).
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지 한국어 + 트레일러 2줄.

## 테스트 전략

**파서** (`ddl-parse.test.ts`)
- 방언 4종 각각의 대표 `CREATE TABLE`을 파싱한다(따옴표 식별자·스키마 접두사·자동증가 포함)
- `ALTER TABLE ADD CONSTRAINT`로 분리된 PK·UNIQUE·FK를 잡는다
- `CREATE UNIQUE INDEX`를 인덱스로 잡는다
- `COMMENT ON`(PostgreSQL·Oracle)과 MySQL 인라인 `COMMENT`를 둘 다 코멘트로 잡는다
- `CHECK`·파티션·트리거·`GRANT`를 건너뛰고 `skipped`에 키워드·줄 번호를 남긴다
- `--`·`/* */` 주석과 Oracle의 `/` 구분자를 처리한다
- `detectDialect`가 4방언 각각을 맞히고, 근거가 없으면 `null`을 준다

**타입 역매핑** (`dialect.test.ts`에 추가)
- 모호 케이스 표의 8행 각각이 지정한 값을 고르고 `alternatives`를 채운다
- 인식 실패 시 `{ok:false, raw}`를 준다
- **왕복**: 모든 `LogicalTypeKind`에 대해 `fromDialectType(toDialectType(t, d), d)`가 `t`와 같다 — **PostgreSQL은 전부**, 나머지 방언은 위 손실 표의 5건만 예외로 허용한다. 예외를 테스트에 상수 배열로 두고, 예외 목록에 없는 조합이 깨지거나 **예외로 적힌 조합이 오히려 왕복하면** 둘 다 실패시킨다(매핑이 바뀌면 어느 방향이든 드러난다)

**논리명 복원** (`naming.test.ts`에 추가)
- 용어 전체 일치가 단어 분해보다 우선한다
- 모든 토큰이 매칭되면 논리명을 이어붙인다
- 한 토큰이라도 실패하면 `{ok:false, unknownTokens}`를 주고 논리명을 만들지 않는다
- **왕복**: `restoreLogicalName(generatePhysicalName(logical, …), …)`가 `logical`을 돌려준다

**코멘트 분해** (`ddl-import.test.ts`)
- `'회원번호 - 회원 식별자'` → 논리명 `회원번호`, 설명 `회원 식별자`
- `'회원번호'` → 논리명 `회원번호`, 설명 `null`
- `'회원번호 - 앞 - 뒤'` → 논리명 `회원번호`, 설명 `앞 - 뒤` (첫 구분자에서 한 번만 쪼갠다)
- 코멘트가 있으면 사전을 보지 않고 `unknown-word` 경고도 내지 않는다
- 코멘트가 없을 때만 사전 역매칭으로 넘어간다

**계획** (`ddl-import.test.ts`)
- 이름이 겹치는 테이블을 `skippedTables`에 넣고 만들지 않는다
- 건너뛴 테이블을 참조하는 FK를 관계에서 빼고 경고한다
- 참조 대상이 없는 FK를 `unresolved-fk`로 경고한다
- 자식의 FK 컬럼이 전부 자식 PK면 `identifying: true`
- 컬럼 집합이 PK와 정확히 일치하는 유니크 인덱스는 만들지 않고, 경고도 남기지 않는다
- PK와 컬럼이 겹치지만 일치하지는 않는 유니크 인덱스는 정상적으로 만든다
- 모호한 타입·미복원 논리명·건너뛴 구문이 각각 경고에 들어간다
- `opCountEstimate`가 실제 적용 op 수와 일치한다

**전체 왕복** (`ddl-import.test.ts`)
- `generateDdl(sample, 'postgresql')` → `parseDdl` → `planDdlImport` → `applyDdlImport`가 원본 모델과 같다(id·좌표 제외)
- 나머지 3방언도 같은 왕복을 돌리되 손실 표의 항목만 다름을 허용한다

**적용** (`ddl-import-edits.test.ts`)
- 새 테이블·컬럼·PK·인덱스·관계가 만들어지고 좌표가 배정된다
- 기존 모델의 테이블이 하나도 바뀌지 않는다
- 입력 모델을 제자리 변형하지 않는다(새 객체 반환)

**화면** (`ddl-import-dialog.test.tsx`)
- DDL을 붙여넣으면 미리보기에 개수·건너뜀·경고가 뜬다
- 방언을 수동으로 바꾸면 파싱 결과가 갱신된다
- 적용하면 단일 mutation이 나간다
- op 한도를 넘으면 적용 버튼이 막히고 안내가 뜬다
- `canEdit=false`면 툴바에 `가져오기`가 없다

## 열린 항목 (이번 범위 밖, 기록만)

- CLI + 에이전트 스킬 — Phase 4의 나머지 절반, 별도 사이클
- 기존 테이블과의 병합·재동기화(운영 DB가 바뀐 뒤 다시 가져오기)
- `CHECK` 제약 → 도메인 허용값 변환
- 가져온 컬럼의 도메인 자동 매칭(현재는 타입만 넣고 도메인은 비운다)
- MSSQL의 `EXEC sys.sp_addextendedproperty` 파싱 — 넣으면 MSSQL 코멘트도 왕복하고 실무 MSSQL 추출본의 논리명이 복원된다
- 실제 DB 접속 스캔(로드맵 "추후 검토")
