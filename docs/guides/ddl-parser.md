# DDL·DBML 파서 — 마스킹·식별자·방언 판정

손으로 쓴 좁은 파서다(`CREATE TABLE`/`ALTER TABLE ADD CONSTRAINT`/`CREATE INDEX`/`COMMENT ON`).
`packages/core/src/ddl-parse.ts` 와 `dbml-parse.ts`, 그리고 그 결과를 모델 변경 계획으로 바꾸는
`ddl-import.ts` 다.

내보낸 산출물의 첫 줄 머릿말은 [export-format.md](export-format.md) 가 갖는다.

---

## 마스킹은 길이를 보존해야 한다

**구조 키워드의 *위치* 는 마스킹본에서 찾고, *값* 은 언제나 원본에서 잘라낸다.** 이 파일의 기존
관례이고(`parseColumnDef`·MySQL 꼬리 `COMMENT`), 그래서 **마스킹 함수는 길이를 반드시 보존해야 한다** —
마스킹본에서 얻은 인덱스를 원본에 그대로 쓰기 때문이다.

⚠️ **이 계약은 한 브랜치 안에서 두 번 깨졌다. 둘 다 「한 글자 짧아져 뒤쪽 제약명이 밀리는」 같은
증상이었고, 테스트 500여 개가 전부 그린인 채로 통과했다.**

1. `for…of` 순회 — 서로게이트 페어를 문자 하나로 묶어 자리표시 1글자로 덮었다.
   **코드 유닛 단위(`for (let i = 0; i < text.length; i++)`)로 순회한다.**
2. 인용 이스케이프 분기 — `''` `""` 백틱 쌍 `]]` 는 **2개를 소비하고 2개를 내야 한다.**
   하나만 내면 `UX_A` 가 `UX_` 로 잘린다.

두 경로 모두 회귀 테스트가 있다(「괄호 안 마스킹이 서로게이트 페어에서도…」,
「인용 이스케이프에서도 마스킹이 길이를 보존한다」). **마스킹 함수를 고칠 때 이 둘을 먼저 봐라.**

### 인용 4종은 한 번의 좌→우 스캔에서 함께 처리한다

`'` `"` 백틱 `[` 를 `maskQuoted` 한 번이 처리한다. **리터럴과 따옴표 식별자를 각각 독립된 스캔으로
돌리면 어느 쪽을 먼저 돌려도 반대편에 구멍이 생긴다** — 리터럴이 먼저면 `"o'brien"` 의 아포스트로피를
문자열 시작으로 오인해 뒤를 통째로 덮고, 식별자가 먼저면 `DEFAULT '{"a": 1}'`(PostgreSQL jsonb,
매우 흔하다)이 깨진다. **순서 조정으로는 못 푼다.**
`splitStatements`·`splitTopLevel`·`unquoteIdentifier` 가 모두 같은 관례를 따른다.

**남는 순서 제약은 하나뿐이다** — `maskParenContents` 는 인용 마스킹 **뒤**에 온다
(인용 안의 괄호가 먼저 덮여야 깊이 계산이 맞는다 — `COLLATE "a(b"` 가 실증한다).
**이 순서를 바꾸지 마라.**

### 인라인 제약은 속성 구간에서만 읽는다

**컬럼 정의의 인라인 제약은 `parseColumnDef` 가 함께 내주는 속성 구간(`attrs`)에서만 읽는다.**
항목 전체를 훑으면 컬럼 **이름**이 구조 키워드와 같을 때(`"unique" boolean not null` — 사용자 실물
DDL 에 있다) 그것을 제약으로 오인한다. **정규식 가드로 막지 말고 이 구조를 유지해라.**

---

## 식별자 정규식은 전부 `IDENT_PART` 를 쓴다

**같은 이름이 경로에 따라 살거나 죽으면 안 된다.** 한때 인라인 경로만 비ASCII 이름을 살리고 테이블
수준·`ALTER TABLE`·컬럼명 경로는 `[A-Za-z_][\w$]*`(JS 의 `\w` 는 ASCII 전용)라 죽였다 —
**비ASCII 컬럼명 하나로 컬럼이 통째로 사라졌다.** 한글 물리명을 쓰는 조직에서 체감이 크다.

새 식별자 정규식을 만들 때는 `IDENT_PART`(따옴표 4종 + 인용 없는 이름의 **부정 문자 클래스**)를
조립해 쓴다. 현재 사용처: `COLUMN_NAME_RE`·`NAMED_CONSTRAINT_RE`·`ALTER_ADD_RE`·
`REFERENCES_TARGET_RE`·`CONSTRAINT_NAME_SRC`.

- ⚠️ **컬럼명 정규식(`COLUMN_NAME_RE`)은 파서의 진입점이다.** 넓히면 컬럼이 아닌 항목까지 컬럼으로
  먹을 수 있다. 그것을 막는 것은 `parseCreateTable` 의 **항목 첫머리 라우팅**(`^PRIMARY KEY` /
  `^UNIQUE` / `^FOREIGN KEY` / `^CHECK`, `CONSTRAINT <이름>` 접두사를 뗀 `body` 기준)이고,
  이 전제는 「테이블 수준 제약을 컬럼으로 먹지 않는다」가 잠근다(`toEqual` 로 유령 컬럼까지 잡는다).
  **진입점을 다시 건드릴 때는 이 테스트부터 확인해라.**
- **타입 정규식만 ASCII 전용으로 남아 있다**(`[A-Za-z_][\w$]*`). **의도적이다** — 유령 컬럼이 생기는
  조건이 「타입 자리에 ASCII 단어가 온다」라서, 타입까지 넓히면 아래 「테이블 수준 절 9종」이 유령
  컬럼이 되는 문턱이 함께 낮아진다. 그래서 비ASCII **타입**(`회원번호 숫자`)은 아직 컬럼을 버린다.
  넓히려면 라우팅을 먼저 촘촘히 해야 한다.

---

## `detectDialect` 는 DDL 전용이다 — DBML 에 태우지 마라

- **`detectDialect` 의 시그니처 목록에 `/\[[A-Za-z_]/`(mssql 대괄호 식별자, 가중치 2)가 있다.**
  DBML 의 **속성 문법**(`[pk, increment, note: '…']`)이 그것을 **항상** 때리므로, 다른 시그니처가
  걸리지 않는 한 **어떤 DBML 이든 mssql 로 판정된다.**
- **DBML 의 방언은 `Project { database_type }` 이고 `dialectFromDatabaseType` 이 그것을 푼다.**
  웹의 `ddl-import-dialog.tsx` 는 처음부터 그렇게 갈라 쓰고 있고 CLI 의 `import.ts`(`resolveDialect`)도
  같다. **같은 일을 웹과 CLI 가 다르게 하지 않는다**([cli.md](cli.md) 「로컬 라우터는 서버 라우터의
  계약을 따른다」와 같은 정신이다).
- **방언은 조용히 틀려도 타입이 나온다.** `fromDialectType` 의 매핑이 방언마다 갈리므로 잘못 고르면
  컬럼 타입이 경고 없이 달라진다. 그래서 CLI 는 **무엇을 왜 골랐는지**를 사람용 출력 첫 줄과
  `--json` 의 `dialectSource` 에 함께 싣는다.
- 잠금: `packages/cli/src/commands/import.test.ts` 의 「DBML 의 방언은 database_type 을 따르고, 없으면
  config 로 떨어진다 — mssql 로 새지 않는다」. `resolveDialect` 의 형식 분기를 지우면 빨개진다.

---

## 알려진 한계

### 파서가 못 읽는 것

- **파서는 `CREATE TABLE`·`ALTER TABLE ADD CONSTRAINT`·`CREATE INDEX`·`COMMENT ON` 만 안다.**
  뷰·프로시저·트리거·시퀀스는 건너뛴다.
- **테이블 수준 절 9종이 유령 컬럼이 된다**(선재 결함). MySQL `KEY`/`INDEX`/`FULLTEXT KEY`/
  `SPATIAL INDEX`, PostgreSQL `EXCLUDE USING`/`LIKE … INCLUDING`, Oracle `SUPPLEMENTAL LOG DATA`,
  MSSQL `INDEX … NONCLUSTERED`/`PERIOD FOR SYSTEM_TIME` 이 `parseCreateTable` 의 항목 라우팅에
  걸리지 않아 `parseColumnDef` 로 떨어지고, 첫 토큰이 컬럼명·둘째 토큰이 타입으로 읽힌다.
  **라우팅에 이 접두사들을 추가해 `skipped` 로 보내는 것이 정답이다.**
- **MySQL 테이블 수준 `UNIQUE KEY <이름> (컬럼들)` 의 제약명이 유실된다.** `CONSTRAINT` 접두사가 없는
  MySQL 고유 형태라 `NAMED_CONSTRAINT_RE` 를 안 타고, 항목 첫머리 `^UNIQUE` 라우팅이 이름을 읽지 않는다.
- **인용 없는 비식별자 문자로 된 컬럼명이 경고 없이 통과한다.** `IDENT_PART` 의 부정 문자 클래스가
  제외하는 것은 SQL 구분자·인용 문자뿐이라 그 밖의 문자로만 이뤄진 첫 토큰은 무엇이든 컬럼 이름이
  된다(`@x`·`a-b`·`a+b`·`#t`·`1A`). **의도한 대상(`회원번호`·이모지)과 같은 문턱을 공유한다.**
  실질 영향은 **경고 신호의 상실**이다(전에는 `skipped-statement` 경고가 떠서 「이 줄을 못 읽었다」를
  알 수 있었다). 정규식을 되돌리면 비ASCII 이름이 다시 죽으므로, 고친다면 **「컬럼은 만들되 이름이
  비식별자 문자를 포함하면 경고를 남긴다」** 쪽이다.
- **인용 없는 무효 제약명이 따옴표째 이름이 된다** — `CONSTRAINT 'x' UNIQUE (A)` → `uq('x')`.
  `unquoteIdentifier` 가 작은따옴표를 벗기지 않는다. **4개 방언 어디서도 무효인 SQL 이라 조치 불필요.**
- **`detectDialect` 가 실물 DDL 에서 `null` 을 내는 경우가 있다.** 컬럼 **이름**에 든 단어가 방언
  시그니처에 걸려 두 방언이 동점이 되고, **동점이면 `null`** 이다. 화면에서 방언을 직접 고르면 되므로
  동작은 한다. 고치려면 시그니처 스캔을 컬럼 이름 구간 밖에서만 돌리거나, 동점 시 2차 신호로 가른다.
- **`ALTER TABLE … OWNER TO …` 가 테이블마다 `skipped-statement` 경고를 낸다.** 정상 동작이지만
  사용자 눈에는 경고 수십 건으로 보인다. `OWNER TO`·`GRANT` 처럼 모델과 무관한 것이 확실한 문장은
  **조용히 버리는 화이트리스트**를 두면 노이즈가 준다.
- **인라인 제약 스캔이 같은 문자열을 두 번 마스킹한다**(`parseInlineColumnConstraints` 가 만든 뒤
  `parseReferencesClause` 가 자기 입력을 또 마스킹한다). 성능 문제는 없고
  (700KB DDL 25ms — `ddl-parse` 벤치 기준), **`parseReferencesClause` 가 자기 입력을 스스로 마스킹해야
  세 호출처가 같은 계약으로 묶이므로** 현재 형태가 낫다고 판정했다.

### 가져오기가 잃는 것

- **MySQL 의 `UNSIGNED` 와 테이블 옵션(`ENGINE`·`CHARSET`)이 유실된다.** `int unsigned` 는 논리 타입
  `INT` 가 되고 테이블 옵션은 파서의 `skipped` 에도 남지 않는다. **유실을 알리는 경고가 한 줄도 없다.**
  - **왜 그렇게 두었나:** 「컬럼 타입은 방언 중립 논리 타입 17종」이라는 설계와 정면으로 맞물린다.
    부호 없음은 타입 축에, 테이블 옵션은 `Table` 에 담을 자리 자체가 없다. 담을 자리를 만드는 것은
    모델 스키마·마이그레이션·DDL 생성·파서·왕복 테스트를 함께 여는 일이다.
  - **이 사실을 잠그는 것은** `packages/cli/src/commands/roundtrip.test.ts` 의
    「MySQL INT UNSIGNED·ENGINE·CHARSET 은 현재 왕복에서 유실된다」다.
    ⚠️ **그 테스트는 「고쳐진 동작」이 아니라 「현재 유실된다」를 단언한다.** 고치면 그 테스트가
    빨개지면서 사람을 여기로 데려온다 — 그때 단언을 뒤집어라(유실 → 보존).
    사용자용 서술은 [../manual/cli-guide.md](../manual/cli-guide.md) 에 있다.
- **가져온 컬럼의 도메인이 비어 있다.** 내보내기가 도메인을 타입으로 풀어 쓰므로 DDL 에 도메인의
  흔적이 없다. 타입만 채우고 `domainId` 는 `null` 이다 — 도메인 자동 매칭은 후속이다.
- **인덱스 컬럼의 정렬 방향(`ASC`/`DESC`)이 유실된다.** 파서의 `identifierList` 가 방향 토큰을 버려
  계획 타입에 자리가 없고, 적용 시 전부 `'asc'` 로 고정된다.
- **DDL 경로의 관계 카디널리티가 항상 `1:N` 이다.** 자식 FK 컬럼에 `UNIQUE` 가 걸린 1:1 관계도
  `1:N` 으로 저장된다 — 계획 단계가 UNIQUE 제약을 관계 판정에 쓰지 않는다(DBML 은
  `oneToOne` 을 채우므로 그쪽만 1:1 이 나온다).
- **`CHECK` 제약을 도메인 허용값으로 변환하지 않는다**(건너뛰고 경고한다).
- **왕복이 깨지는 타입 조합이 다섯 있다**(`JSON`→oracle/mssql, `DATE`·`TIME`→oracle, `UUID`→mysql).
  내보내기 매핑이 단사가 아니어서 생기는 성질이고 `dialect.test.ts` 의 `ROUND_TRIP_LOSSES` 에 상수로
  고정돼 있다. **`toDialectType` 을 고치면 이 목록도 함께 봐야 한다.**
- **Oracle `TIMESTAMP` 는 의도적으로 `DATETIME` 으로 읽는다.** 우리 매핑상 `TIME` 으로 읽으면 왕복이
  살아나지만 실무 Oracle DDL 의 `TIMESTAMP` 는 거의 항상 일시다.
- **MSSQL 코멘트는 왕복하지 않는다.** 내보내기가 `EXEC sys.sp_addextendedproperty` 로 내는데 그 문장
  형태는 파싱 범위 밖이다. 구조는 왕복하고 논리명만 물리명으로 떨어지며 경고가 남는다.
  **이 동작은 테스트로 고정돼 있어 나중에 파싱을 구현하면 그 테스트가 깨져 재검토를 강제한다.**
- **DDL 에 적힌 이름이 기존 인덱스 이름과 겹치면 동명 인덱스가 2개 만들어진다**(선재 결함).
  무명 UNIQUE 의 자동 이름은 충돌을 정확히 피하는데 **DDL 에 적힌 이름은 `used` 확인 없이 그대로 쓴다.**
  `alter table t add constraint ux1 unique (a)` + `create unique index ux1 on t (a)` 로 재현된다.
- **기존 테이블과의 병합·재동기화가 없다** — 이름이 겹치면 건너뛴다. 운영 DB 가 바뀐 뒤 다시 가져오는
  시나리오는 미지원이다.
- **`0개 테이블 만들기` 버튼이 눌러도 반응이 없다.** 만들 것이 0개여도 버튼이 활성이고, 눌러도
  다이얼로그가 닫히지 않으며 토스트도 없다. 기능적으로는 안전(빈 Revision 이 생기지 않고 모델도 불변)
  하나 **사용자에게는 먹통으로 보인다** — 비활성화하거나 안내 후 닫는 편이 낫다.
- **DDL 가져오기에 파일 업로드가 없다**(텍스트 영역뿐이다).

### DBML

- **인덱스 이름이 빈 문자열이면 `name: ''` 를 낸다**(`dbml.ts` 의 `indexLines`).
  **현행 유지가 판정 결과다** — 되읽으면 `''` 로 그대로 돌아와 **왕복이 성립**하기 때문이다.
  설정을 아예 빼는 편이 dbdocs 에는 자연스러워 보이지만, 그러면 가져오기가 자동 이름을 붙여
  **왕복이 깨진다.** 바꾸려면 그 트레이드오프를 먼저 정해야 한다.
- **`ddl-import.ts` 의 `fk.oneToOne === undefined` 판정은 암묵 채널이다.** 「이 fk 가 DBML 파서에서
  왔는가」를 *다른 목적의 옵셔널 필드가 존재하는지*로 판정한다. **DDL 파서가 언젠가 `oneToOne` 을
  채우면(예: UNIQUE 동반 FK 를 1:1 로 읽는 개선) 조용히 뒤집힌다.** 명시 필드
  (`source: 'dbml' | 'ddl'`)나 `planDdlImport` 옵션이 안전하다. 코드 주석이 위험을 설명한다.
- **dangling 인덱스 컬럼 처리가 DDL 과 DBML 에서 갈린다**(선재 결함). 같은 모델에서 DDL 은
  columnId 를 이름처럼 출력하고 DBML 은 그 컬럼을 빼고 낸다. **DBML 쪽이 옳고 DDL 쪽이 결함이다.**
  모델 정합성상 dangling 은 없어야 하므로 실사용 영향은 없다고 본다.
- **인라인 `[pk]` 와 `indexes { [pk] }` 가 공존하며 서로 다른 컬럼을 가리키면 뒤에 오는 쪽이 `isPk` 를
  잃는다.** `planDdlImport` 의 `pkOf` 가 **먼저 나온 pk 제약**만 쓰기 때문이다(DDL 파서와 같은 규칙이다).
  **우리 내보내기는 그 형태를 내지 않으므로 왕복에는 영향이 없고**(단일 PK 는 인라인, 복합 PK 는
  indexes 블록 — 둘이 겹치지 않는다), 애초에 두 선언이 어긋난 **모순된 입력**이다.
  다만 **남의 파일에서는 일어날 수 있고 그때 경고 없이 조용히 갈린다.** 나중에 경고를 붙인다면
  「한 테이블에 pk 제약이 둘 이상」이 판정 조건이다.
- **Enum 타입 컬럼의 `rawType` 에 큰따옴표가 남는다** — `"ID" "status" [pk]` → `rawType: '"status"'`.
  「타입 원문으로 그대로 둔다」에는 부합하지만 따옴표째 남는다. `unknown-type` 경고가 뜨므로 조용하지는
  않다.
