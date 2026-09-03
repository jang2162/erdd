# 부호 없음(`UNSIGNED`)과 테이블 옵션(`ENGINE`·`CHARSET`) — 설계

**작성:** 2026-09-03 / **상태:** 사용자 확정 2건 + 미결 9건(§9) / **마이그레이션:** 0014 하나
(테이블 옵션만 — 부호 없음은 **없다**) / **서버 변경:** `projects` 컬럼 1개 + `project.get`·
`project.update` 입출력 / **새 tRPC 프로시저:** 없다 / **구현 아님 — 이 문서는 설계다**

---

## 1. 목적과 범위

소비처 피드백 1·2번을 닫는다. MySQL DDL 을 가져왔다가 다시 내보내면 두 가지가 **경고 한 줄 없이**
사라진다.

- **컬럼의 부호 없음** — `INT UNSIGNED` → `INT`. 사용자의 말: 「MySQL 에서 PK/FK 에 `INT UNSIGNED` 를
  쓰는 것은 흔한 관례라, 왕복시킨 DDL 을 실제 DB 에 적용하면 타입이 달라집니다.」
- **테이블 옵션** — `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` 가 통째로. 사용자의 말: 「`CHARSET` 은
  MySQL 에서 실무상 필수 지정 항목입니다.」

**목표는 왕복 보존 자체가 아니라 「내보낸 DDL 을 실제 DB 에 적용할 수 있는 것」이다.** 왕복 보존은
그 수단이다. 이 문서의 모든 판단은 그 기준으로 갈렸다 — 특히 §4.5(방언 간 이동)에서 「원본과 똑같이
생긴 타입」보다 「그 방언에서 실제로 도는 DDL」을 택했다.

**범위:** 논리 타입의 부호 없음 1급화(파서·생성·도메인·검사·왕복) · 프로젝트 수준 테이블 옵션
(모델·서버·CLI config·GUI·내보내기·가져오기) · 문서 갱신 · 유실을 잠그고 있는 기존 테스트의 단언 뒤집기.

**범위 밖:** §10 에 목록으로. 특히 **컬럼 수준 `COLLATE`**, 파티션, 인덱스 옵션, `AUTO_INCREMENT=`
시작값, `ROW_FORMAT`. 그리고 이 조사에서 **새로 발견한 기존 결함 셋**도 §10 에 함께 적었다.

---

## 2. 확정된 결정 (사용자 확정 — 이 문서가 바꾸지 않는다)

### D1. 부호 없음은 **논리 타입의 1급 속성**이다

`INT UNSIGNED` 를 논리 타입의 **변형으로 정식 인정**한다. 파서·DDL 생성·도메인·검사가 전부 그것을
안다. 「문자열로 남기되 아무도 모르는 값」이 아니다.

**버린 안 (B) 보존만** — `type` 이 자유 문자열이므로 `INT UNSIGNED` 를 그냥 저장할 수는 있다. 그러나
`parseLogicalType` 이 모르면 그 컬럼은 전 경로에서 **미지 타입**이 된다: 가져오기가 `unknown-type`
경고를 내고, `toDialectType` 이 방언 타입을 못 만들어 DDL 에 원문이 그대로 나가고(다른 방언으로
내보내면 그 방언에 없는 문자열이 나간다), `isIntegerType` 이 false 라 **`AUTO_INCREMENT` 가 붙지
않는다**(`ddl.ts`·`dbml.ts` 의 `auto` 판정). PK 에 `INT UNSIGNED` 를 쓰는 바로 그 관례가 깨진다.

**버린 안 (C) 경고만** — 유실을 알리기만 한다. 사용자가 겪는 문제(적용하면 타입이 다르다)가 그대로
남고, 경고를 본 사용자가 할 수 있는 일이 없다.

### D2. 테이블 옵션은 **프로젝트 수준 설정**이다

`ENGINE`·`DEFAULT CHARSET` 은 논리 모델이 아니라 **물리 배포 설정**이고 실무에서 프로젝트 전체가
같은 값을 쓴다. 방언·명명 규칙 옆에 두고 **모든 테이블에 같은 값을 붙인다.** 가져올 때 테이블마다
값이 다르면 **가장 많이 쓰인 것을 채택하고 경고**한다.

**버린 안 (테이블별 필드)** — 정확하지만 마이그레이션 + HANDOFF 3.2 등록처 + `FILE_FIELDS`(3.8) +
파일 포맷 + `model-diff` 라벨 + GUI 편집기가 함께 열린다. 실무에서 테이블마다 다른 값을 쓰는 일이
거의 없는데 그 전부를 연다.

**버린 안 (기본값 + 예외 병행)** — 두 경로를 다 만들고 「기본값과 같으면 개별값을 지운다」 규칙이
붙는다. 그 규칙이 어긋나는 자리가 곧 「어느 쪽이 진실인가」 버그다.

---

## 3. 조사 결과 — 지금 무엇이 어디서 사라지는가 (실측)

실측은 전부 저장소 밖 임시 디렉터리에서 `tsx` 로 `packages/core` 를 직접 불러 확인했다.

### 3.1 부호 없음이 사라지는 자리는 **둘**이다

```
CREATE TABLE ORD (
  ORD_NO int unsigned NOT NULL AUTO_INCREMENT, ...
```

1. **파서가 타입에서 잘라낸다.** `ddl-parse.ts:355` 의 타입 정규식은 「첫 토큰 + 선택적 괄호」만
   집는다. 실측된 `ParsedColumn.rawType` 은 `"int"` 이고 `unsigned` 는 `attrs` 로 흘러가 **아무도
   줍지 않는다**(`parseInlineColumnConstraints` 는 `UNIQUE`·`REFERENCES` 만 본다).
2. **설령 넘어와도 타입 해석이 거절한다.** `fromDialectType('int unsigned', 'mysql')` →
   `{ok:false, raw:'int unsigned'}`, `parseLogicalType('INT UNSIGNED')` → `{ok:false}`. 실측 그대로다.

`skipped` 에도 안 남고 경고도 없다. 기존 왕복 테스트가 그 사실을 잠그고 있다.

### 3.2 테이블 옵션은 **파서가 이미 손에 쥐고 있는데 버린다**

`parseCreateTable` 은 `firstParenGroup(stmt.text)` 로 `group.tail` 을 얻어 **거기서 MySQL 테이블
코멘트만 꺼내 쓰고 나머지를 버린다**(`ddl-parse.ts:538~551`). `) ENGINE=InnoDB AUTO_INCREMENT=3
DEFAULT CHARSET=utf8mb4 COLLATE=... COMMENT='주문'` 에서 `COMMENT` 만 살아남고 나머지는
`ParsedTable` 에 담길 필드 자체가 없다. **`skipped` 에도 안 들어간다** — `skipped` 는 문장 단위이지
꼬리 절 단위가 아니다.

즉 **가져오기 쪽은 새 파싱을 만드는 것이 아니라 이미 있는 `group.tail` 을 밖으로 내보내는 일**이다.

### 3.3 ⚠️ D1 의 전제(모델 스키마 변경·마이그레이션 불필요)는 **맞다** — 단 D2 는 아니다

브리프 3.1 이 「모델 스키마 변경도 마이그레이션도 필요 없다」고 적었다. **부호 없음에 대해서는
전수 확인 결과 참이다.**

| 확인한 자리 | 결과 |
|---|---|
| `ColumnSchema.type`(`model.ts:23`) | `z.string()` 자유 문자열 — 열거가 아니다 |
| `DomainSchema.logicalType`(`model.ts:100`) | 같음 |
| 서버 `columns.type`(`db/schema.ts:132`) | `text('type').notNull()` — CHECK 제약 없음. 마이그레이션 0002 도 `"type" text NOT NULL` 뿐 |
| op 저장(`revisions.ops` jsonb) | payload 를 통째로 담는다 — 타입 문자열에 무관 |
| `FILE_FIELDS`(3.8 체크리스트) | `column: { …, type: 'type', … }` 이 **이미 있다.** 새 엔티티 필드가 아니므로 3.8 은 **해당 없음** |
| `file-format.ts` 읽기/쓰기 | 타입은 문자열 그대로 왕복. 검증 없음 |
| Excel 내보내기·업로드 | 「타입」·「논리 타입」 셀은 문자열 그대로. 도메인 업로드는 **비었는지만** 본다(`excel-import.ts:197`) |
| `diffModelsForDisplay` | `column.type` 은 `FIELD_LABEL` 에 이미 있고 원시 값 비교라 `INT` → `INT UNSIGNED` 가 그냥 변경으로 잡힌다 |
| GUI 타입 입력 | **선택기가 아니라 자유 텍스트다**(§4.8) |

**그래서 부호 없음은 마이그레이션이 0건이고 서버 코드도 0줄이다.** 열리는 것은 `packages/core` 와
문서뿐이다.

**반면 D2 는 마이그레이션이 필요하다.** `projects` 테이블에는 `dialects`·`naming_rules` 만 있고
(`db/schema.ts:37~45`), 테이블 옵션을 담을 자리가 없다. **`0014` 가 필요하다**(§5.2).

### 3.4 ⚠️ 조사에서 나온 뜻밖의 사실 셋

**(가) MySQL 5.7 모양(`int(11)`·`int(10) unsigned`)은 이미 오늘도 깨져 있다.**
실측: `fromDialectType('int(11)','mysql')` → `{ok:false}`, `bigint(20)` → `{ok:false}`,
`smallint(5)` → `{ok:false}`. 표시폭이 붙은 정수는 **오늘도 `unknown-type` 경고와 함께 원문이
그대로 컬럼 타입이 된다.** (`tinyint(1)`·`tinyint(3)` 만 `fromMysql` 의 전용 분기 덕에 산다.)

⚠️ **이것은 이번 사이클의 성패에 직접 걸린다.** MySQL 5.7 의 `SHOW CREATE TABLE`·`mysqldump` 는
`int(10) unsigned` 로 낸다. 표시폭을 다루지 않으면 **부호 없음 기능이 그 모양의 덤프에는 아예 닿지
않는다.** 다만 이것은 이번 사이클이 만드는 회귀가 **아니라** 이미 있는 결함이므로 §10(범위 밖)에
적고 §9 ①에서 「이번에 함께 넣자」는 추천과 근거를 단다.

**(나) 순진하게 고치면 `tinyint unsigned` 가 회귀한다.**
오늘은 파서가 `unsigned` 를 잘라내므로 `rawType='tinyint'` → `fromMysql` 의 `TINYINT` 분기 →
`SMALLINT` 로 **산다**(부호 없음만 잃는다). 파서가 `tinyint unsigned` 를 통째로 넘기게만 고치고
`fromDialectType` 을 안 고치면 `t.name === 'TINYINT UNSIGNED'` 가 되어 그 분기를 못 타고
**`unknown-type` 으로 떨어진다.** §4.4 의 `splitSqlType` 설계가 이것을 막는다.

**(다) `ddlWarnings` 는 도메인을 지정한 컬럼의 경고를 놓친다.**
`ddl.ts:271` 이 `resolveColumnType(c.type, dialect)` 로 경고를 계산한다 — **컬럼 자신의 `type`
문자열**이다. 반면 실제 DDL 은 `resolveColumn`(도메인 우선)이 만든다. 그래서 도메인이 지정된 컬럼은
`ORACLE_WARN` 이 오늘도 안 뜬다. §4.5 의 새 경고는 이 함정을 피해 **해석된 논리 타입** 기준으로
계산해야 한다. 기존 `ORACLE_WARN` 의 같은 결함은 §10 에 적는다.

---

## 4. 부호 없음 설계

### 4.1 표기(canonical) — `INT UNSIGNED`, 대문자, 공백 하나

모델의 `type` 문자열에 저장하는 값은 **`SMALLINT UNSIGNED` · `INT UNSIGNED` · `BIGINT UNSIGNED`**
셋뿐이다.

- **접미(suffix)다.** MySQL DDL 의 표기 그대로이고 사용자가 읽고 쓰는 형태다.
- **대문자, 구분 공백 하나.** `parseLogicalType` 의 기존 정규화(`toUpperCase()` +
  `replace(/\s+/g,' ')`)가 그대로 처리한다 — 실측: `'int unsigned'`·`'INT   UNSIGNED'`·
  `'  int   unsigned  '` 셋 다 `INT UNSIGNED` 로 정규화된다.
- **괄호와 섞이지 않는다.** 허용 대상이 파라미터 없는 정수 3종뿐이라(§4.2) `DECIMAL(10,2) UNSIGNED`
  같은 「괄호 뒤 접미」 표기를 **모델 표기로는 정하지 않아도 된다.** 기존 `canonical` 규약
  (`DECIMAL(10,2)`·`VARCHAR(50)`)과 충돌할 자리가 아예 생기지 않는다.

**이 값이 `erdd/tables/*.yaml` 과 서버 `columns.type` 에 그대로 박힌다.** 그래서 한 번 정하면
되돌리는 비용이 곧 데이터 이행 비용이다 — 이 절의 결정이 이 문서에서 가장 되돌리기 비싼 것이다.

**버린 표기 (a) 전치 `UNSIGNED INT`** — 정규식이 이미 받아들이는 모양이지만(이름에 공백 허용) MySQL
문법과 반대라 사용자가 그대로 읽을 수 없다. **(b) 별도 필드 `Column.unsigned: boolean`** — 모델
스키마 변경 + 마이그레이션 + 3.8 `FILE_FIELDS` 분류 + `model-diff` 라벨이 함께 열린다. D1 이
「논리 타입의 속성」이라고 정한 이상 타입 문자열 안에 있는 것이 맞다.

### 4.2 허용 범위 — 정수 3종뿐(`SMALLINT`·`INT`·`BIGINT`)

MySQL 은 `DECIMAL`·`FLOAT`·`DOUBLE` 에도 `UNSIGNED` 를 허용하지만 **8.0.17 부터 그 셋에 대해서는
deprecated 이고, MySQL 문서 자신이 「대신 CHECK 제약을 쓰라」고 권한다**
([Numeric Type Attributes](https://dev.mysql.com/doc/refman/8.0/en/numeric-type-attributes.html)).
같은 릴리스에서 `ZEROFILL` 과 정수 표시폭도 deprecated 됐다.

- **여는 것:** `SMALLINT UNSIGNED` · `INT UNSIGNED` · `BIGINT UNSIGNED`.
- **열지 않는 것:** `DECIMAL`·`FLOAT`·`DOUBLE`(deprecated) · `BOOLEAN`(`TINYINT(1)` 이 실체) ·
  나머지 전부.
- **좁게 여는 편이 되돌리기 쉽다** — 나중에 넓히는 것은 집합에 원소를 더하는 일이지만, 넓혀 둔 것을
  좁히면 이미 저장된 `DECIMAL(10,2) UNSIGNED` 가 전부 미지 타입이 된다.

**허용하지 않는 조합이 들어오면 「부호 없음만 떨어뜨리고 경고」한다**(예외를 던지거나 미지 타입으로
만들지 않는다 — §4.6).

### 4.3 타입 표현 — `LogicalType` 유니온을 가른다

```ts
export type LogicalType =
  | { kind: 'CHAR'; length: number }
  | { kind: 'VARCHAR'; length: number }
  | { kind: 'DECIMAL'; precision: number; scale: number }
  | { kind: 'SMALLINT' | 'INT' | 'BIGINT'; unsigned: boolean }        // ← 새 갈래
  | { kind: Exclude<LogicalTypeKind,
        'CHAR' | 'VARCHAR' | 'DECIMAL' | 'SMALLINT' | 'INT' | 'BIGINT'> }
```

- **`unsigned` 는 옵셔널이 아니라 필수 `boolean` 이다.** 옵셔널로 두면 「안 적으면 signed」가 되어
  구성처마다 판단이 갈린다. 필수면 **타입 검사가 모든 구성처에 결정을 강제한다** — 이 저장소가
  즐겨 쓰는 typecheck-driven 훑기다(HANDOFF 3.3 의 「`: ProjectModel` 리터럴에 키를 전부 추가」와
  같은 성질).
- ⚠️ **그런데 지금 코드에는 그 강제를 무력화하는 `as LogicalType` 캐스트가 셋 있다.**
  `logical-type.ts` 의 둘(`{ kind, length: p1 } as LogicalType` · 마지막 `{ kind } as LogicalType`)과
  `dialect.ts` 의 `fixed()` 헬퍼 하나. **캐스트라 필드가 빠져도 컴파일이 그냥 통과한다.** 구현
  태스크는 이 셋을 **캐스트 없는 생성으로 바꾸는 것부터** 해야 한다 — 그러지 않으면 `unsigned` 를
  필수로 만들어도 강제되는 자리가 하나도 없다. (실질적으로는 `fixed(kind, alternatives,
  unsigned = false)` 로 인자를 하나 늘리고 정수 3종만 다른 값을 주는 형태가 된다.)

`parseLogicalType` 의 변경은 **이름 정규화 직후에 접미를 한 번 벗기는 것**이 전부다. 저장소 밖
프로토타입으로 전수 확인했다.

| 입력 | 결과 |
|---|---|
| `INT UNSIGNED` · `int unsigned` · `INT   UNSIGNED` | `{kind:'INT',unsigned:true}`, canonical `INT UNSIGNED` |
| `integer unsigned` | 같음 (별칭 해석이 접미 제거 **뒤에** 온다) |
| `smallint unsigned` · `bigint unsigned` | 각각 canonical `SMALLINT UNSIGNED` · `BIGINT UNSIGNED` |
| `INT` | `{kind:'INT',unsigned:false}`, canonical `INT`(**바뀌지 않는다**) |
| `UNSIGNED INT` · `UNSIGNED` | `ok:false` |
| `decimal unsigned` · `double unsigned` · `boolean unsigned` | `ok:false`(§4.2 의 허용 집합 밖) |
| `DECIMAL(10,2) UNSIGNED` | `ok:false`(괄호가 끝에 없어 정규식 자체가 안 맞는다) |
| `VARCHAR(50)` · `DOUBLE PRECISION` | **변화 없음** |

⚠️ **`parseLogicalType` 은 모델 표기용이라 엄격하다.** 방언 원문(`int(10) unsigned`,
`tinyint unsigned`)을 관대하게 받는 것은 §4.4 의 `splitSqlType` 의 일이다. **두 함수의 역할을 섞지
마라** — 섞으면 GUI 에 `tinyint unsigned` 를 쳐도 통과해 버려 모델에 방언 이름이 들어간다.

### 4.4 파서와 방언 해석 — 자르지 말고 넘기고, 이름과 접미를 나눠 본다

**(1) `ddl-parse.ts` — 타입 정규식이 접미를 함께 집는다.**
`parseColumnDef`(355행)의 타입 정규식 캡처 그룹 끝에 `(?:\s+UNSIGNED)?` 를 붙인다(정규식에 `i`
플래그가 이미 있다). `attrs` 는 그 뒤부터 잘리므로 `NOT NULL`·`AUTO_INCREMENT` 판정은 그대로다.
`ZEROFILL` 은 여기서 집지 않고 `attrs` 로 흘려보내 버린다 — 실효 없는 표시 속성이다(§10).

⚠️ **HANDOFF 3.11(마스킹 길이 보존 계약)은 이 변경에 걸리지 않는다.** 바뀌는 것은 `attrs` 의
**시작 경계**뿐이고, `attrsScan = maskQuoted(attrs)` 는 잘린 뒤의 같은 문자열에서 만들어지므로
인덱스 공유가 그대로 성립한다. 마스킹 함수 자체는 손대지 않는다.

**(2) `dialect.ts` — `splitSqlType` 이 이름·괄호·접미를 셋으로 가른다.**

```
현행: ^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:,\s*(\d+)\s*)?\))?$
제안: ^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:,\s*(\d+)\s*)?\))?((?:\s+(?:UNSIGNED|ZEROFILL))*)\s*$
```

`SqlTypeParts` 에 `unsigned: boolean` 을 더한다. **`ZEROFILL` 은 삼키기만 하고 버린다**(표시 전용,
deprecated).

⚠️ **이 순서가 중요하다 — 접미를 이름에서 떼어내야 방언별 전용 분기가 계속 맞는다.** §3.4(나) 가
그 자리다: `tinyint unsigned` 는 이름이 `TINYINT` 로 남아야 `fromMysql` 의 `TINYINT` 분기를 타
`SMALLINT` 가 된다. 그 뒤에 `unsigned` 를 결과에 얹는다.

기존 케이스가 안 깨지는 것을 프로토타입으로 확인했다 — `NVARCHAR(MAX)` · `double precision` ·
`timestamp with time zone` · `number(10,2)` 는 현행과 **완전히 같은 분해**를 낸다.

**(3) `fromDialectType` 이 접미를 결과에 적용한다.** 방언별 분기(`fromMysql` 등)와 공통 경로
(`parseLogicalType`)가 base 결과를 낸 **뒤에** 한 자리에서 적용한다.

- base 의 `kind` 가 정수 3종이면 → `unsigned: true` 를 얹고 `canonical` 을 `<KIND> UNSIGNED` 로.
- 아니면 → **부호 없음을 떨어뜨리고 그 사실을 결과에 싣는다**(§4.6 의 경고 재료).
- **방언별 분기를 새로 만들지 않는다.** 접미 해석이 네 방언 공통 경로에 있으므로 postgresql 프로젝트
  로 `INT UNSIGNED` 가 든 DDL 이 들어와도 **똑같이** 해석된다(브리프가 물은 역방향 — §4.6).

### 4.5 방언 간 이동(내보내기) — 타입은 그대로, `CHECK (col >= 0)` 를 함께 낸다

| 방언 | `INT UNSIGNED` 가 나가는 모양 | 경고 |
|---|---|---|
| mysql | `INT UNSIGNED` | 없음 |
| postgresql | `integer` + `CHECK ("COL" >= 0)` | 상한 초과 경고 |
| mssql | `INT` + `CHECK ([COL] >= 0)` | 상한 초과 경고 |
| oracle | `NUMBER(10)` + `CHECK ("COL" >= 0)` | `BIGINT UNSIGNED` 만 경고(아래 표) |

**왜 CHECK 인가.**

- **선례가 이미 있다.** `ddl.ts:90` 의 `columnLine` 이 도메인 `allowedValues` 로
  `CHECK (col IN (…))` 를 인라인으로 낸다. 그 자리 바로 옆에 한 줄 붙는다 — 새 경로가 아니다.
- **MySQL 문서 자신이 권하는 대체 수단이다**(§4.2 인용). deprecated 된 `DECIMAL UNSIGNED` 의 대안이
  CHECK 라면, 애초에 unsigned 가 없는 방언의 대안도 같은 것이 자연스럽다.
- **의미가 정확히 보존된다.** 「이 컬럼은 음수가 될 수 없다」가 사용자가 `UNSIGNED` 로 표현한 것의
  핵심이고, 그것이 대상 DB 에서 실제로 강제된다.

**버린 안 (a) 부호 있는 타입으로 그냥 떨어뜨리기** — 지금과 같다. 「적용하면 타입이 달라진다」는
불만이 「적용하면 제약이 달라진다」로 이름만 바뀐 채 남는다.

**버린 안 (b) 한 단계 넓은 타입** (`INT UNSIGNED` → `bigint`) — 값 범위는 완전히 보존되지만 셋이
걸린다. ① **`BIGINT UNSIGNED` 에 갈 곳이 없다.** `numeric(20,0)`/`DECIMAL(20,0)` 으로 도망가야 하는데
그것은 정수가 아니다(연산·인덱스 성격이 바뀐다) — 규칙이 마지막 원소에서 예외를 만든다. ② 사용자가
선언한 저장 크기가 조용히 바뀐다. ③ **되읽으면 그냥 `BIGINT` 다** — 왕복이 CHECK 안보다 더 나쁘다.
CHECK 안은 세 정수에 **똑같은 한 규칙**이 적용된다.

**대가(정직하게 적는다):** unsigned 상한의 위쪽 절반이 대상 방언에서 표현되지 않는다. 그래서
**경고를 낸다.**

| 논리 타입 | unsigned 상한 | postgresql | mssql | oracle |
|---|---|---|---|---|
| `SMALLINT UNSIGNED` | 65,535 | `smallint` 32,767 → **경고** | `SMALLINT` → **경고** | `NUMBER(5)` 99,999 → 안전 |
| `INT UNSIGNED` | 4,294,967,295 | `integer` 2,147,483,647 → **경고** | `INT` → **경고** | `NUMBER(10)` → 안전 |
| `BIGINT UNSIGNED` | 1.8446744e19 | `bigint` 9.2233720e18 → **경고** | `BIGINT` → **경고** | `NUMBER(19)` 9.99e18 → **경고** |

**경고를 내는 자리는 `dialect.ts` 의 `ORACLE_WARN` 옆이다** — 같은 성격의 표를 하나 더 두고
`resolveColumnType` 이 함께 본다. 그러면 `ddlWarnings` → 내보내기 다이얼로그 · CLI `export` 에
자동으로 실린다(새 표면을 만들지 않는다).

⚠️ **단, `ddlWarnings` 의 기존 결함(§3.4 다)을 그대로 답습하면 안 된다.** 지금 그 함수는
`resolveColumnType(c.type, …)` 로 **컬럼 자신의 문자열**을 본다. 도메인이 지정된 컬럼은 실효 타입이
도메인의 것이므로 새 경고는 **`resolveColumn(...).logicalType` 을 넣어** 계산해야 한다.

**CHECK 의 판정 기준도 「해석된 논리 타입」이다.** 도메인의 `logicalType` 이 `INT UNSIGNED` 면 그
컬럼도 CHECK 를 받는다. **방언별 물리 타입 오버라이드(`dialectTypes`)가 있어도 CHECK 는 낸다** —
오버라이드는 저장 형태에 대한 것이고 CHECK 는 값에 대한 것이라 서로 배타적이지 않다.

**DBML 은 CHECK 를 낼 자리가 없다.** DBML 은 `r.sql` 을 그대로 적으므로 mysql 로 낸 DBML 에는
`INT UNSIGNED` 가 그대로 들어가고(파서도 `[` 앞을 통째로 타입으로 읽어 **왕복이 저절로 성립한다**),
다른 방언으로 낸 DBML 에서는 부호 없음이 사라진다. DBML 은 배포용 DDL 이 아니라 교환 포맷이므로
그대로 둔다(§10 에 한 줄 적는다).

### 4.6 방언 간 이동(가져오기·역방향)

- **네 방언 모두 `UNSIGNED` 접미를 읽는다.** 해석이 공통 경로에 있으므로(§4.4-3) postgresql·oracle·
  mssql 로 지정해 읽어도 결과가 같다. **별도 분기도, 「이 방언에는 unsigned 가 없습니다」 경고도
  두지 않는다** — 프로젝트는 방언을 **여럿** 가질 수 있고(`projects.dialects` 는 배열이다) 모델은
  방언 중립이라, 읽는 시점의 방언 하나로 모델 값을 깎으면 다른 방언 내보내기가 손해를 본다.
- **허용 집합 밖의 조합은 떨어뜨리고 경고한다.** `decimal(10,2) unsigned` → `DECIMAL(10,2)` +
  경고 1건. `tinyint(1) unsigned` → `BOOLEAN` + 경고 1건.
  - 새 `DdlImportWarning['kind']` **`unsigned-dropped`** 하나를 더한다.
  - HANDOFF 3.14 표대로 **가져오기 경고는 그 체크리스트를 타지 않는다** — 등록처는
    `ddl-import.ts` 의 유니온 **하나뿐**이고, `naming-check.tsx` 의 `KIND_LABEL` 은 해당 없음이다.
    ⚠️ 그래서 **전수 강제가 없다 — 문구를 테스트로 못 박아야 한다**(§8).
  - 문구(안): ``ORD.AMT: DECIMAL(10,2) 에는 부호 없음을 붙일 수 없어 떨어뜨렸습니다``.
- **`type-mismatch` 경고가 덤으로 정확해진다.** `warnings.ts:84` 는 `child.type !== parent.type`
  문자열 비교다. 부모가 `INT UNSIGNED` 이고 자식이 `INT` 면 이제 경고가 뜬다 — **MySQL 이 실제로
  FK 를 거절하는 바로 그 조건**이다. 의도한 효과이고, §8 이 잠근다.
- **에디터에서 만드는 FK 컬럼은 자동으로 따라간다.** `relationship.ts:58` 이
  `type: pk.type` 로 부모 PK 의 타입 문자열을 그대로 복사한다 — 배선이 필요 없다.

### 4.7 도메인·Excel·검사·diff

- **도메인은 허용한다 — 코드 변경 0줄.** `Domain.logicalType` 이 자유 문자열이고
  `resolveColumnType(d.logicalType, dialect)` 를 그대로 타므로 `INT UNSIGNED` 를 넣으면 §4.5 대로
  나간다. **테스트만 추가한다.** (도메인 정의서 Excel 왕복·공용 리소스 fork 도 문자열이라 자동.)
- **Excel** — 「타입」·「논리 타입」 열은 문자열 그대로다. 업로드 검증은 **비었는지만** 본다. 변경 없음.
- **`computeWarnings`** — 길이·중복·용어·예약어 경고는 전부 **이름**을 보지 타입을 보지 않는다.
  `type-mismatch` 만 타입을 보고, 그것은 §4.6 대로 개선된다. **`Warning['kind']` 는 늘지 않는다 →
  HANDOFF 3.14 체크리스트 자체가 해당 없음이다.**
- **`diffModelsForDisplay`** — `column.type` 은 이미 대상이고 라벨도 있다. `INT` → `INT UNSIGNED`
  가 그대로 표시된다. 변경 없음.

### 4.8 GUI — **타입 선택기는 존재하지 않는다**

⚠️ **브리프의 「GUI 타입 선택기」는 실물과 다르다.** 확인한 세 자리 전부 자유 텍스트 입력이다.

| 자리 | 실물 |
|---|---|
| 편집 패널 컬럼 타입(`edit-panel.tsx:313`) | `<CommitInput label="타입" mono …>` — 자유 입력 |
| 도메인 편집(`domain-edit-dialog.tsx:126`) | `논리 타입` 텍스트 입력 |
| 공용 리소스 항목(`resource-item-form.tsx:179`) | `placeholder="예: VARCHAR(100)"` 텍스트 입력 |

**그래서 부호 없음의 GUI 작업은 0이다.** 사용자는 이미 `INT UNSIGNED` 를 칠 수 있고, 이 사이클이
바꾸는 것은 **그 문자열을 시스템이 이해하게 되는 것**이다.

**선택기·자동완성·「부호 없음」 체크박스를 이번에 만들지 않는다** — 17종 목록을 UI 에 처음으로
박아 넣는 일이고(지금 어디에도 없다), 자유 입력 관례를 바꾸는 별개 결정이다. §9 ⑤ 에 미결로 둔다.

---

## 5. 테이블 옵션 설계

### 5.1 값의 모양 — **방언별 자유 문자열 4칸**

```ts
export type TableOptions = {
  postgresql: string; mysql: string; oracle: string; mssql: string
}
export const DEFAULT_TABLE_OPTIONS: TableOptions =
  { postgresql: '', mysql: '', oracle: '', mssql: '' }
```

값 예: `mysql: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'`, `oracle: 'TABLESPACE users'`,
`mssql: 'ON [PRIMARY]'`.

- **방언마다 문법이 다르므로 한 칸으로는 안 된다.** 한 문자열을 네 방언에 다 붙이면 MySQL 의
  `ENGINE=` 이 PostgreSQL `CREATE TABLE` 뒤에 나가 **DDL 이 아예 실행되지 않는다** — §1 의 목표와
  정면으로 어긋난다.
- **선례가 있다.** `Domain.dialectTypes` 가 정확히 「방언 4키 × 자유 문자열」이다. 같은 모양을 쓰면
  사용자가 이미 아는 화면이 되고 zod 모양도 그대로 베낀다.
- **키-값 맵으로 만들지 않는다.** `{engine, charset, collation}` 은 MySQL 만 맞는 모양이고, 새 옵션을
  원할 때마다 스키마·마이그레이션·UI 가 함께 열린다. `TABLESPACE`·`ON [PRIMARY]` 처럼 `=` 가 없는
  옵션은 애초에 그 모양에 안 들어간다.
- **검증하지 않는다.** `dialectTypes` 와 같은 방침이다(임의 문자열을 받는다). 잘못 적으면 그 방언의
  DDL 이 실패하고, 그것은 사용자가 즉시 보는 실패다.

### 5.2 저장 위치 셋 — 서버·CLI config·계약

**(1) 서버 `projects` 테이블 — 마이그레이션 `0014` 가 필요하다.**

```sql
ALTER TABLE "projects" ADD COLUMN "table_options" jsonb
  DEFAULT '{"postgresql":"","mysql":"","oracle":"","mssql":""}'::jsonb NOT NULL;
```

`naming_rules`(0005)와 같은 모양이다. 기존 행은 DB 기본값으로 채워진다.

**(2) `erdd.config.yaml` — `ErddConfig` 에 `tableOptions` 를 더한다.**
`readConfig` 는 **누락만 기본값으로 채운다**(템플릿 두 키가 이미 그 방식이다 — 필수로 요구하면 기존
사용자의 `pull` 이 깨진다). `init.ts` 의 생성 리터럴과 `sync-down.ts` 의 되쓰기에도 함께 넣는다.

⚠️ **`sync-down`(=`pull`)이 서버 값으로 config 를 통째로 덮어쓴다**(`sync-down.ts:36`). 즉 **연결된
프로젝트에서 config 의 테이블 옵션은 서버의 거울이다** — 로컬에서 고쳐도 다음 `pull` 에 지워지고,
`push` 는 모델만 보내므로 서버로 올라가지도 않는다. 이것은 `namingRules` 가 **이미 갖고 있는
성질**이라 이 사이클이 새로 만드는 문제가 아니다. 다만 §5.5 의 CLI 가져오기가 이 성질을 **소리 내어
알려야 한다.**

**(3) `project.get` / `project.update` 계약 — HANDOFF 3.18.**
서버 라우터에 넣으면 **로컬 라우터에도 같은 모양이 있어야 한다.** 다행히 강제 장치가 이미 있다 —
`packages/cli/src/local/router.test.ts` 의 `InputGaps`·`OutputGaps` 대조가 로컬이 구현한 프로시저를
전수로 훑으므로, 서버에만 넣으면 **타입 테스트가 이름을 말하며 빨개진다.** 새 프로시저는 필요 없다
(기존 둘의 입출력만 넓힌다). 로컬 `project.get` 은 `ctx.config.tableOptions` 를, `update` 는
`writeConfig` + `Object.assign(ctx.config, next)`(그 자리의 ⚠️ 주석대로)를 그대로 따른다.

### 5.3 ⚠️ 읽기 스키마와 쓰기 스키마를 **나눈다** — HANDOFF 3.16 과 같은 함정

`NamingRulesSchema` 가 읽기용(기본값 주입)과 `NamingRulesStrictSchema` 쓰기용(전 키 필수)으로 갈려
있는 이유가 **여기에 그대로 적용된다.** 테이블 옵션은 **키가 넷**이라 함정이 더 크다.

- **읽기 `TableOptionsSchema`** — 네 키에 `.default('')`. `project.get` 이 DB jsonb 를 이것으로
  파싱해 **키가 없는 옛 행에 기본값을 주입**한다(3.5b: 「기본값이 주입되는 지점은 `project.get` 의
  파싱 하나뿐이다」).
- **쓰기 `TableOptionsStrictSchema`** — 네 키 전부 필수. `project.update` 가 이것을 쓴다.
  **읽기 스키마를 쓰기에 걸면 `{mysql: '…'}` 만 보낸 화면이 나머지 세 방언의 값을 조용히 지운다.**
  부분 페이로드가 전체 덮어쓰기로 둔갑하는 바로 그 사고다.
- **UI 는 언제나 네 키를 전부 보낸다**(`NamingRulesSection` 이 `{...namingRules, 바꾼키}` 로 보내는
  것과 같은 관례).

### 5.4 내보내기 — `)` 뒤, `COMMENT` **앞**

`ddl.ts` 의 `createTableBlock` 이 닫는 괄호 뒤에 그 방언의 문자열을 붙인다.

```
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '주문';
```

- **`COMMENT` 앞에 둔다.** 파서의 테이블 코멘트 추출이 `group.tail` 에서 **첫 `COMMENT` 키워드**를
  찾으므로(`ddl-parse.ts:546`), 옵션이 앞에 있으면 그 스캔이 그대로 맞는다.
  ⚠️ **사용자가 옵션 칸에 `COMMENT=` 를 적으면 그 스캔이 그것을 테이블 코멘트로 읽는다.**
  §5.5 의 가져오기 허용 목록이 `COMMENT` 를 **배제**하는 이유이기도 하다. 문서에 한 줄 적는다.
- **빈 문자열이면 아무것도 붙이지 않는다** — 지금과 한 글자도 달라지지 않아야 한다. `ddl.test.ts`
  의 전체 문자열 `toBe` 비교가 그 무변경을 잠근다(3.17 이 머릿말에서 쓴 것과 같은 장치).
- **`generateDdl` 시그니처.** 지금 `(model, dialect, scope, rules)` 다. **옵셔널 5번째 인자**
  `tableOptions?: TableOptions` 를 더한다 — 비호출 테스트 36곳이 그대로 컴파일된다. 실호출처는
  **둘뿐**이다(`export-dialog.tsx:57`, CLI `export.ts:72`).
  ⚠️ **옵셔널은 「빠뜨려도 조용히 동작한다」는 뜻이다** — 두 호출처의 배선을 잠그는 테스트를
  §8 에 넣는다(HANDOFF 3.5b 의 「그 배선은 잠기지 않는다」 실측이 경고하는 자리다).
  대안(항상 `ProjectSettings = {namingRules, tableOptions}` 한 덩어리로 받기)은 §9 ④.
- **DBML 에는 넣지 않는다.** DBML 에 테이블 옵션 문법이 없다.

### 5.5 가져오기 — 파서가 꺼내고, 계획이 고르고, **적용은 모델 밖이다**

**(1) 파서: `ParsedTable.options?: string`.**
`group.tail` 에서 **코멘트 절을 걷어낸 나머지**를 공백 정규화해 담는다. 없으면 필드를 두지 않는다.
⚠️ **옵셔널로 두는 이유는 3.17 의 `nameMeta?` 와 같다** — 기존 테스트의 `ParsedDdl` 리터럴
(`ddl-import.test.ts:597` 등)이 안 깨진다. **파서는 해석하지 않는다** — 무엇이 프로젝트 수준 옵션인지
정하는 것은 정책이고, 정책은 `ddl-import.ts` 에 둔다(`skipped` 와 같은 층 분리).

**(2) 계획: `DdlImportPlan.tableOptions: string | null` + 다수결.**

- **허용 목록으로 거른다.** `ENGINE` · `DEFAULT CHARSET`/`CHARACTER SET` · `COLLATE` 만 취한다.
  ⚠️ **`AUTO_INCREMENT=3` 을 반드시 버려야 한다** — 테이블마다 다른 **일회성 카운터**인데 프로젝트
  설정으로 올려 모든 테이블에 다시 붙이면 전 테이블의 시작값을 3 으로 바꾼다. `PARTITION BY`·
  `DATA DIRECTORY`·`ROW_FORMAT`·`STATS_*` 도 「테이블별이거나 이번 범위 밖」이라 버린다(§10).
  **`COMMENT` 는 사유가 다르다** — 이미 테이블 코멘트로 따로 잡히므로 여기 담으면 진실이 둘이 된다.
- **채택값은 정규화한 한 줄이다.** `ENGINE=<값> DEFAULT CHARSET=<값> COLLATE=<값>` 순서로, **있는
  것만** 잇는다. 키는 이 표기로 통일하고(`CHARACTER SET` 도 `DEFAULT CHARSET` 으로) **값의 대소문자는
  원문 그대로** 둔다(`InnoDB`·`utf8mb4`). ⚠️ **정규화가 없으면 다수결이 깨진다** — 같은 뜻을
  `CHARACTER SET` 과 `DEFAULT CHARSET` 으로 적은 두 테이블이 서로 다른 표에 갈린다.
- **빈 꼬리는 투표하지 않는다.** 옵션이 없는 테이블이 「옵션 없음」에 표를 던지면, 절반이 `ENGINE` 을
  생략한 덤프에서 최다 득표가 `''` 가 되어 **있는 값을 잃는다.**
- **동수면 DDL 에 먼저 나온 것.** 테이블 둘짜리 덤프에서 동수는 흔하다 — 결정적이어야 한다.
- **다르면 경고.** 새 `DdlImportWarning['kind']` **`table-option-conflict`** 하나.
  **채택값과 다른 옵션을 가진 테이블마다 1건**을 내고, `target` 은 **그 테이블의 DDL 원문 이름**이다
  (3.17 의 관례 — 사용자가 입력에서 찾을 수 있는 이름). 「어느 테이블이 달랐는가」를 못 찍으면
  사용자가 원문에서 확인할 방법이 없다.
  문구(안): ``ORD_LOG: 테이블 옵션이 'ENGINE=MyISAM' 이라 채택값 'ENGINE=InnoDB DEFAULT
  CHARSET=utf8mb4' 과 다릅니다 — 채택값을 씁니다``.

**(3) 반영 규칙은 core 가 정하고, 웹·CLI 가 같은 규칙을 쓴다**

⚠️ **가져오기는 지금까지 모델만 건드리고 프로젝트 설정은 손대지 않았다**(HANDOFF 6절 이월 항목의
템플릿 복원 대목이 그 사실을 명시한다). 설정은 **op 로그 밖**이라 `Revision 1건 = undo 1회` 규약이
닿지 않는다 — **`applyDdlImport` 에 섞지 않는다.** 설정 반영은 그 함수 **밖의 두 번째 동작**이다.

**공통 규칙(둘 다 이것을 쓴다 — 3.19 의 「같은 일을 웹과 CLI 가 다르게 하지 않는다」):**

| 프로젝트의 그 방언 값 | 동작 |
|---|---|
| 비어 있다 | **반영한다** |
| 채택값과 같다 | 아무 일도 없다 |
| 값이 있고 다르다 | **반영하지 않고 알린다**(설정한 값을 조용히 덮어쓰지 않는다) |

- **웹:** 다이얼로그에 **체크박스 하나**(「프로젝트의 테이블 옵션도 갱신」). 초기 상태는 위 표대로
  (비었으면 켬 / 다르면 끔)이고 사용자가 뒤집을 수 있다. 적용 시 `model.mutate` **뒤에**
  `project.update` 를 따로 부른다.
  - **`canManage` 일 때만 렌더한다**(설정 변경은 manage 다). 스토어에 `canManage` 가 이미 있다.
  - **되돌리기가 갈린다는 것을 문구로 알린다** — 모델은 undo 되지만 설정은 안 된다.
- **CLI:** `erdd import` 는 **이미 로컬 파일을 쓰는 명령**이고(`erdd/*.yaml`) 확인 프롬프트도 있으므로,
  같은 승인 아래 `erdd.config.yaml` 도 위 표대로 쓴다. **사용자가 뒤집는 플래그는 두지 않는다**(§9 ⑨).
  무엇을 했는지는 사람용 출력과 `--json`(`tableOptions`·`tableOptionsApplied`)에 싣는다 —
  `dialectSource` 를 싣는 것과 같은 정신으로 **조용히 정하지 않는다.**
  - ⚠️ **연결된 프로젝트에서는 「서버에는 반영되지 않고 다음 `pull` 이 덮어쓴다」를 함께 출력한다**
    (§5.2 의 성질). 그 한 줄이 없으면 사용자는 서버에도 들어간 줄 안다.
  - ⚠️ **서버 `project.update` 를 부르지 않는다.** 그것은 `authedProcedure`(세션 전용)라 액세스
    토큰에 열려 있지 않고, 열지 않기로 했다 — §9 ③.

### 5.6 GUI — 프로젝트 설정에 섹션 하나

`project-settings.tsx` 의 `NamingRulesSection` 옆에 `TableOptionsSection` 을 둔다. 방언 4칸,
`onBlur` 커밋(템플릿 입력과 같은 관례), `canManage` 게이트.

- **로컬 모드에도 보인다.** 그 화면은 `isLocal` 로 가리지 않고(`ProjectMembers` 만 가린다),
  `project.update` 가 로컬 라우터에도 있으므로 3.18 의 「로컬에 보이는 화면이 부르는 프로시저는
  로컬에도 있어야 한다」가 이미 만족된다.
- **프로젝트가 쓰는 방언만 보일까?** → 네 칸 다 보인다(§9 ⑦).

---

## 6. 머릿말(`erdd:v2`)과의 관계 — **아무것도 싣지 않는다**

**둘 다 DDL 본문만으로 왕복이 성립한다.**

- **부호 없음** — mysql 덤프에는 `INT UNSIGNED` 가 본문에 있다. 머릿말에 또 실으면 **같은 사실의
  진실 원본이 둘**이 되고, 둘이 갈렸을 때 어느 쪽이 이기는지를 정해야 한다. 3.17 이 「빈 값은 키를
  생략한다 — 머릿말이 한 줄이라 길이가 곧 비용이다」라고 못 박은 자리이기도 하다.
- **테이블 옵션** — mysql 덤프에는 `) ENGINE=… ` 이 본문에 있다.

**다른 방언 덤프에서는 되살아나지 않는다**(postgres 덤프에는 `CHECK (col >= 0)` 만 있고 파서는
인라인 CHECK 를 읽지 않는다 — §10). 그것을 메우려고 머릿말에 실으면 **「본문으로 되는 것을 머릿말에
싣지 마라」를 정확히 어기는 것**이고, 더구나 테이블 옵션은 **프로젝트 설정**이라 3번째 구획
(`t`·`g` 와 나란한 프로젝트 구획)을 새로 여는 일이다. HANDOFF 이월 항목이 템플릿에 대해 「가져오기가
설정을 덮어써도 되는지가 먼저 결정돼야 한다」고 남긴 그 문제를 그대로 물려받는다. **이번 사이클은
그 구획을 열지 않는다** — §5.5 의 「모델 밖, 명시적 opt-in」이 그 결정에 대한 이 문서의 답이다.

**결론: `name-meta.ts` 는 한 줄도 바뀌지 않는다.**

---

## 7. 함께 고쳐야 할 문서·주석 (grep 으로 훑은 전수)

### 7.1 거짓이 되는 서술

| 자리 | 무엇이 거짓이 되나 |
|---|---|
| `docs/manual/cli-guide.md:1058~1063` | ⚠️ 문단 전체 — 「부호 없음과 테이블 옵션이 경고 없이 사라진다」·「별도 사이클의 과제」·「그 테스트가 사실을 잠그고 있다」. **보존된다**로 다시 쓴다 |
| `docs/manual/user-guide.md:178` | 「타입에 DB 타입을 직접 쓴다」 — 부호 없음 표기(`INT UNSIGNED`)를 쓸 수 있다는 한 줄을 더한다 |
| `docs/manual/user-guide.md:294·303` | 도메인 절 — 논리 타입에 부호 없음을 쓸 수 있고 비 MySQL 방언에서 `CHECK (컬럼 >= 0)` 가 함께 나간다는 것(303 행이 이미 「DDL 에 반영되는 것은 셋이다」로 CHECK 를 설명한다 — 그 목록에 붙는다) |
| `docs/manual/user-guide.md` 프로젝트 설정 절 | **테이블 옵션 섹션 신규** — 방언 4칸, 어디에 나가는지, 가져오기 체크박스 |
| `docs/manual/cli-guide.md` `erdd import` 절 | 채택한 테이블 옵션이 출력·`--json` 에 실린다는 것, `erdd.config.yaml` 반영 규칙(비었을 때만), **연결된 프로젝트에서는 서버에 안 올라간다**는 것 |
| `docs/manual/cli-guide.md` `erdd.config.yaml` 절 | `tableOptions` 키(누락 시 기본값, 연결 프로젝트에서는 `pull` 이 덮어씀) |
| `docs/manual/local-guide.md` | 로컬 모드 설정 화면에 테이블 옵션이 보인다 |

### 7.2 코드 주석

| 자리 | 무엇 |
|---|---|
| `packages/cli/src/commands/roundtrip.test.ts:189~199` | ⚠️ **단언을 뒤집는 것과 함께 주석 전체를 다시 쓴다.** 「담길 자리가 없고」·「별도 설계 사이클에서 다룬다」·「나중에 고치면 이 테스트가 빨개져서 사람을 데려온다」가 전부 과거형이 된다 |
| `packages/core/src/logical-type.ts` 머리 | 17종 + 정수 3종의 부호 없음 변형이라는 것, `parseLogicalType`(모델 표기·엄격)과 `splitSqlType`(방언 원문·관대)의 역할 분리 |
| `packages/core/src/dialect.ts` 의 `fromDialectType` 위 ⚠️ 주석 | 「`toDialectType`·`FIXED` 를 고치면 이 함수도 함께」에 **부호 없음 접미도 같은 짝**이라는 것 |
| `packages/core/src/ddl.ts` `columnLine` | CHECK 가 둘(도메인 허용값 · 부호 없음)이 될 수 있다는 것 |
| `packages/core/src/naming.ts` 의 두 스키마 ⚠️ 주석 | 테이블 옵션이 **같은 이유로** 갈렸다는 상호 참조 |

### 7.3 HANDOFF (⚠️ **이 트랙은 고치지 않는다 — 코디네이터가 병합 후 일괄로 한다**)

- 6절 이월 항목 「DDL 왕복의 `UNSIGNED`·테이블 옵션 유실」 → **해소**로 정리.
- 3절에 새 불변식이 필요하다(안): 「부호 없음은 논리 타입 문자열의 접미다 — `parseLogicalType`(엄격)
  과 `splitSqlType`(관대)의 역할을 섞지 마라」, 「테이블 옵션은 방언별 자유 문자열이고 읽기/쓰기
  스키마가 갈린다」.
- 1절 마이그레이션 표기 `0013까지` → `0014까지`.
- **테스트 기준선 네 수를 다시 잰다**(서버 스위트 포함 — 이 사이클은 서버를 건드리므로 HANDOFF 가
  요구한 「격리 DB 로 다시 재라」에 해당한다).

---

## 8. 테스트 전략 — 무엇을 잠가야 하는가

### 8.1 최우선 — **오늘의 유실을 잠그고 있는 테스트를 뒤집는다**

`packages/cli/src/commands/roundtrip.test.ts` 의
「MySQL INT UNSIGNED·ENGINE·CHARSET 은 현재 왕복에서 유실된다 (피드백 1·2번)」.

```
현재: expect(ddl).not.toContain('UNSIGNED') / not.toContain('ENGINE') / not.toContain('CHARSET')
      expect(kinds).toEqual(new Set(['unknown-word']))
      expect(ddl).toContain('ORD_NO INT AUTO_INCREMENT NOT NULL')
뒤집기: toContain('ORD_NO INT UNSIGNED AUTO_INCREMENT NOT NULL')
        toContain('QTY SMALLINT UNSIGNED NOT NULL')
        toContain('ENGINE=InnoDB') · toContain('CHARSET=utf8mb4')
```

- **경고 집합은 그대로 `{'unknown-word'}` 여야 한다.** 테이블이 하나라 다수결 충돌이 없고, 부호
  없음은 이제 정상 해석이라 경고를 내지 않는다. **이 단언을 지우지 마라** — 새 경고가 조용히 늘면
  여기서 걸린다.
- **이 테스트가 성립하려면 `erdd import` 가 `erdd.config.yaml` 에 테이블 옵션을 써야 한다**(§5.5).
  안 쓰기로 하면 이 테스트에서 `ENGINE`·`CHARSET` 단언을 뺄 수밖에 없고, **CLI 왕복은 닫히지
  않는다.** 둘은 한 몸이다.

⚠️ **테스트 **이름**과 주석도 함께 바꾼다.** 이름에 「현재 유실된다」가 남으면 다음 사람이 정반대
사실을 읽는다.

### 8.2 구분력이 픽스처에 달린 자리 (미리 지목한다)

HANDOFF 3.5b·3.17 이 남긴 선례 — **잠금이 실제로 갈리는지 확인하지 않으면 되돌려도 전건 초록이다.**

| 잠금 | 순진한 픽스처가 통과해 버리는 이유 | 어떻게 갈리게 하나 |
|---|---|---|
| **테이블 옵션이 DDL 에 나간다** | 옵션이 **빈 문자열**이면 배선을 끊어도 결과가 같다 | 픽스처의 `tableOptions.mysql` 을 **반드시 비우지 않는다.** 그리고 **빈 값일 때 한 글자도 안 바뀐다**를 전체 문자열 `toBe` 로 따로 잠근다(3.17 의 짝 구조) |
| **`generateDdl` 5번째 인자 배선(호출처 2곳)** | 옵셔널이라 안 넘겨도 컴파일·실행된다 | 웹 `export-dialog` 와 CLI `export` **각각**에 「설정한 옵션이 산출물에 있다」 단언을 둔다. core 테스트만으로는 절대 안 잡힌다 |
| **부호 없음이 방언별로 갈린다** | mysql 만 보면 `CHECK` 경로가 무테스트다 | 네 방언 전부에 대해 한 컬럼의 출력을 고정한다(mysql=접미, 나머지 셋=기본 타입+CHECK) |
| **`unsigned-dropped` 경고 문구** | `kind` 만 보면 문구가 **엉뚱한 타입 이름**(원문 `tinyint(1) unsigned` vs 결과 `BOOLEAN`)을 적어도 초록이다 — 3.17 이 실제로 물린 형태 | **문자열까지** 못 박는다. 갈래 둘(`DECIMAL` 처럼 허용 밖 / `TINYINT(1)` → `BOOLEAN` 승격)을 **각각** |
| **다수결** | 테이블이 하나면 다수결이 무의미하다 | 3 테이블(A,A,B) · 동수 2 테이블(A,B) · **빈 꼬리 섞인** 케이스 셋을 각각 |
| **읽기/쓰기 스키마 분리** | 전 키를 보내는 테스트만 있으면 strict 를 읽기 스키마로 바꿔도 초록 | `project.update` 에 **한 키만** 보내 **거절되는지**를 단언(3.16 의 잠금과 같은 모양) |

### 8.3 그 밖에 남길 것

- **core `logical-type`** — §4.3 표의 전 행(특히 `ok:false` 쪽 6건. 허용 집합을 넓히면 빨개진다).
- **core `dialect`** — `tinyint unsigned` → `SMALLINT UNSIGNED`(§3.4 나의 회귀 잠금),
  `tinyint(1) unsigned` → `BOOLEAN` + dropped, `decimal(10,2) unsigned` → `DECIMAL(10,2)` + dropped.
- **core `ddl-parse`** — `rawType` 이 `int unsigned` 를 물고 오는 것 + **`attrs` 판정이 안 깨지는 것**
  (`int unsigned NOT NULL AUTO_INCREMENT` 에서 `notNull`·`autoIncrement` 가 여전히 true).
- **core `ddl-parse`** — `ParsedTable.options` 가 코멘트를 뺀 꼬리를 담는 것, `AUTO_INCREMENT=3` 이
  꼬리 안에 그대로 있는 것(거르는 것은 다음 층의 일).
- **core `ddl`/`domain-resolve`** — 도메인 `logicalType: 'INT UNSIGNED'` 인 컬럼도 CHECK·경고를
  받는 것(§3.4 다의 함정을 잠근다), `dialectTypes` 오버라이드가 있어도 CHECK 는 나가는 것.
- **core `warnings`** — 부모 `INT UNSIGNED` · 자식 `INT` 가 `type-mismatch` 를 낸다.
- **core `dbml`/`dbml-parse`** — mysql DBML 왕복에서 `INT UNSIGNED` 가 살아남는다.
- **core `file-format`/`file-merge`** — `INT UNSIGNED` 가 yaml 왕복을 견딘다.
- **server** — `project.get` 이 옛 행(키 없음)에 기본값을 주입한다, `project.update` 가 네 키를 쓴다,
  권한 없는 사용자가 거절된다. **격리 DB 로 실제로 돌린다**(HANDOFF 의 미실측 표기 해소).
- **cli `local/router.test.ts`** — 계약 3종(`InputGaps`·`OutputGaps`·`LocalOnly`)이 그대로 통과.
  **이 파일을 고쳐서 통과시키지 마라** — 로컬 라우터를 고쳐 맞춘다.
- **cli `config`** — `tableOptions` 누락 config 가 기본값으로 열린다(옛 사용자의 `pull` 보호).
- **cli `import`** — 반영 규칙 3갈래를 각각: 비었으면 `erdd.config.yaml` 에 쓴다 / 같으면 안 쓴다 /
  다르면 **안 쓰고 알린다**. ⚠️ **「안 쓴다」쪽 두 건이 없으면 「항상 덮어쓴다」로 바꿔도 초록이다.**
- **web** — 설정 화면에서 값 저장, 가져오기 다이얼로그 체크박스(권한 없으면 안 보임 / 값이 이미
  있으면 기본 끔).

---

## 9. 미결 사항 (각각 추천·근거·뒤집는 비용 — TBD 로 두지 않는다)

**① 정수 표시폭(`int(10) unsigned`·`int(11)`)을 이번에 함께 고칠까 — 2026-09-03 사용자 확정.**
→ **함께 고친다 — 확정.** 근거: MySQL 5.7 의 `mysqldump`·`SHOW CREATE TABLE` 이 내는 표준 모양이고,
안 고치면 **부호 없음 기능이 그 덤프에 아예 닿지 않는다**(실측 §3.4 가). 비용도 작다 — §4.4 의
`splitSqlType` 정규식은 **어느 쪽으로 정하든 그대로**(그래야 `decimal(10,2) unsigned` 를 「알아보고
떨어뜨릴」 수 있다), 여기 더해지는 것은 `fromMysql` 의 `SMALLINT`/`INT`/`BIGINT` 분기 3개가 **`p1` 을
무시**하게 하는 것뿐이다. 곁들여 `int(11)` 이 오늘 `unknown-type` 인 기존 결함도
닫힌다. ~~다만 브리프가 정한 범위 밖이므로 §10 에도 적었다~~ → **사용자가 「함께 고친다」로 확정했으므로
이 사이클의 범위에 정식으로 들어온다.** §10 의 1번 항목은 더 이상 「범위 밖」이 아니다.
**뒤집는 비용:** 분기 3개와 그 테스트를 지우면 된다 — 한 태스크 안이다.

**② 비 MySQL 방언에 `CHECK (col >= 0)` 를 낼까(§4.5).**
→ **낸다(추천).** 근거는 §4.5 전체. **뒤집는 비용:** `columnLine` 의 한 줄과 방언별 테스트 3건.
값이 이미 저장된 뒤에도 되돌릴 수 있다 — **모델 표기는 바뀌지 않으므로 데이터 이행이 없다.**
(반대로 §4.1 의 표기를 되돌리면 저장된 문자열 전부를 손봐야 한다 — 그래서 이 둘은 되돌리기 비용이
자릿수로 다르다.)

**③ `project.update` 를 `apiProcedure` 로 열어 CLI 가 서버 설정까지 쓰게 할까(§5.5).**
→ **열지 않는다(추천).** 근거: HANDOFF 3.7 이 「기본은 세션 전용, 여는 목록은 CLI 가 실제로 쓰는
것으로 한정」이라고 못 박았고, `project.update` 는 이름·설명·방언까지 바꾸는 넓은 프로시저다. 토큰
하나가 새면 프로젝트 설정 전체가 열린다. 테이블 옵션 하나 때문에 그 문을 여는 것은 비용 대비가 나쁘다.
CLI 는 `erdd.config.yaml` 만 쓰고(§5.5) 연결된 프로젝트에서는 그 한계를 **출력으로 알린다.**
**뒤집는 비용:** 한 줄(`authedProcedure` → `apiProcedure`) + CLI 쪽 호출 + 권한 테스트. 나중에 「CLI
에서 프로젝트 설정을 관리하고 싶다」가 독립 요구로 오면 그때 좁은 전용 프로시저로 여는 편이 낫다.

**④ `generateDdl` 을 5인자로 늘릴까, `ProjectSettings` 한 덩어리로 묶을까(§5.4).**
→ **옵셔널 5번째 인자(추천).** 근거: 실호출처가 둘뿐이고 테스트 36곳이 그대로 산다. 묶는 리팩터는
`composeTablePhysicalName(t, model, rules)` 등 `rules` 를 받는 모든 함수로 번져 이 사이클의 범위를
넘는다. **뒤집는 비용:** 나중에 세 번째 프로젝트 설정이 생기면 그때 묶는다 — 그 시점의 호출처는
여전히 둘이다.

**⑤ 타입 선택기(드롭다운·자동완성)를 이번에 만들까(§4.8).**
→ **만들지 않는다(추천).** 근거: 지금 세 화면 전부 자유 텍스트이고 17종 목록이 UI 에 존재한 적이
없다. 만들면 「선택기에 없는 타입을 쓰던 사용자」와 도메인 방언 오버라이드까지 함께 설계해야 한다 —
독립 사이클이다. **뒤집는 비용:** 없음(추가 기능이라 나중에 얹으면 된다).

**⑥ 가져오기 체크박스의 기본값(§5.5).**
→ **「현재 값이 비었으면 켬, 값이 있고 다르면 끔」(추천).** 근거: 조용한 덮어쓰기가 이 저장소에서
가장 비싼 사고 유형이고(3.16), 반대로 「항상 끔」은 처음 가져오는 사용자가 체크박스를 못 보고 지나쳐
왕복이 안 닫힌다. **뒤집는 비용:** 조건식 한 줄.

**⑦ 프로젝트가 쓰는 방언의 칸만 보일까.**
→ **네 칸 다 보인다(추천).** 근거: 도메인 편집 다이얼로그의 「방언별 물리 타입 (선택)」이 이미 네 칸을
항상 보인다 — 같은 모양이어야 사용자가 배운 것을 다시 쓴다. 그리고 방언은 나중에 추가되는데, 숨겨
두면 추가한 순간 「전에 적어 둔 값이 있었나」를 알 수 없다. **뒤집는 비용:** 필터 한 줄.

**⑧ 가져오기 허용 목록에 테이블 수준 `COLLATE` 를 넣을까(§5.5).**
→ **넣는다(추천).** 근거: `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` 는 실무에서 한 덩어리로
쓰이고, 문자셋만 살리고 정렬 규칙을 버리면 「적용했더니 비교 결과가 다르다」가 남는다. ⚠️ **브리프가
`COLLATE` 를 범위 밖으로 예시한 것은 컬럼 수준 `COLLATE`(`VARCHAR(50) COLLATE …`)로 읽었다 — 그것은
컬럼 속성이라 §10 에 그대로 남긴다.** **뒤집는 비용:** 허용 목록에서 정규식 하나를 빼면 된다.

**⑨ CLI 에 「설정을 덮어쓰기」 플래그(`--overwrite-options` 같은 것)를 둘까(§5.5).**
→ **두지 않는다(추천).** 근거: 값이 이미 있는데 다른 값이 들어오는 상황은 **드물고**(같은 DB 에서
뽑은 덤프를 다시 넣는 것이 주 흐름이다), 그때 사용자가 할 일은 `erdd.config.yaml` 을 직접 고치는
것이다 — 텍스트 파일 한 줄이라 플래그보다 빠르고 오해가 없다. 플래그를 두면 「무엇을 덮어쓰는지」를
문서·도움말·테스트에 각각 설명해야 한다. **뒤집는 비용:** 플래그 하나와 그 테스트 — 한 태스크 안이다.

---

## 10. 이번 범위 밖 (발견한 것 — 고치지 않고 목록으로만)

**이 사이클의 조사에서 새로 확인한 결함**

1. **정수 표시폭이 미지 타입이 된다.** `int(11)`·`bigint(20)`·`smallint(5)` → `unknown-type`
   (실측 §3.4 가). MySQL 5.7 덤프 전체가 여기 걸린다. **→ 2026-09-03 사용자가 「이번에 함께 고친다」로
   확정해 이 사이클의 범위에 들어왔다(§9 ①). 남은 범위 밖 항목은 아래 2번부터다.**
2. **`ddlWarnings` 가 도메인 지정 컬럼의 경고를 놓친다.** `resolveColumnType(c.type, …)` 가 컬럼
   자신의 문자열을 봐서 `ORACLE_WARN` 이 안 뜬다(§3.4 다). 이번 사이클의 새 경고는 이 함정을 피하지만
   **기존 `ORACLE_WARN` 은 그대로 남는다.**
3. **인라인 `CHECK` 가 가져오기에서 조용히 사라진다.** 테이블 수준 `CHECK` 는 `skipped` 에 남지만
   (`ddl-parse.ts:523`) **컬럼 인라인 `CHECK` 는 `parseInlineColumnConstraints` 가 보지 않아 흔적도
   없다.** 그래서 도메인 허용값 CHECK 도, 이번에 낼 `CHECK (col >= 0)` 도 되읽히지 않는다.

**왕복에서 사라지는 다른 것들**

4. **컬럼 수준 `COLLATE`** (`VARCHAR(50) COLLATE utf8mb4_bin`) — 컬럼 속성이다(§9 ⑧ 이 테이블 수준과
   가른다).
5. **`ZEROFILL`** — §4.4 가 흘려보내고 버린다. deprecated 표시 전용이라 되살릴 값이 없다.
   ⚠️ **다만 MySQL 에서 `ZEROFILL` 은 `UNSIGNED` 를 함의한다**(`int zerofill` = `int unsigned
   zerofill`). 이 설계는 그 함의를 **따르지 않는다** — `unsigned` 를 명시하지 않은 `int zerofill` 은
   `INT` 로 들어온다. deprecated 문법의 암묵 규칙을 되살리는 것보다, 사용자가 원문에서 본 그대로가
   되는 편이 예측 가능하다. 실제로 걸리면 그때 한 줄로 넣는다.
6. **`AUTO_INCREMENT=<시작값>`** — 테이블별 일회성 카운터라 프로젝트 설정에 담을 수 없다(§5.5).
7. **파티션(`PARTITION BY …`)** · **`ROW_FORMAT`·`DATA DIRECTORY`·`STATS_*`** · **인덱스 옵션**
   (`USING BTREE`·`KEY_BLOCK_SIZE`) · **생성 컬럼(`GENERATED ALWAYS AS`)** · **`ON UPDATE
   CURRENT_TIMESTAMP`**.
8. **다른 방언 덤프에서 부호 없음이 되살아나지 않는다** — postgres 덤프의 `integer` +
   `CHECK (col >= 0)` 를 되읽으면 `INT` 다(3번 때문). 머릿말에 싣지 않기로 한 대가다(§6).
9. **DBML 은 mysql 로 낼 때만 부호 없음을 나른다**(§4.5 끝).

---

## 11. 영향받는 파일

**신규**

- `packages/core/src/table-options.ts` (+ 테스트) — `TableOptions` · `DEFAULT_TABLE_OPTIONS` ·
  `TableOptionsSchema`(읽기) · `TableOptionsStrictSchema`(쓰기)
- `apps/server/drizzle/0014_*.sql` — `projects.table_options`
- `apps/web/src/pages/…` 안의 `TableOptionsSection`(파일을 나눌지는 구현 판단)

**변경 — core**

- `logical-type.ts` — `LogicalType` 유니온 분기, 접미 해석, `as LogicalType` 캐스트 제거
- `dialect.ts` — `splitSqlType`(괄호+접미), `SqlTypeParts.unsigned`, `fromDialectType` 의 접미 적용,
  `toDialectType` 의 mysql 접미, 부호 없음 경고 표(`ORACLE_WARN` 옆), `fixed`/`sized` 헬퍼
- `ddl-parse.ts` — 타입 정규식의 `UNSIGNED` 접미, `ParsedTable.options?`
- `ddl-import.ts` — `DdlImportWarning['kind']` 둘(`unsigned-dropped`·`table-option-conflict`),
  `DdlImportPlan.tableOptions`, 허용 목록·다수결
- `ddl.ts` — `generateDdl` 5번째 인자, `createTableBlock` 의 옵션, `columnLine` 의 CHECK,
  `ddlWarnings` 가 해석된 논리 타입을 보게
- `index.ts` — 새 export

**변경 — 서버**

- `db/schema.ts` — `projects.tableOptions`
- `routers/project.ts` — `get` 의 파싱(기본값 주입) · `update` 의 strict 입력

**변경 — CLI**

- `config.ts`(`ErddConfig`·`readConfig` 백필) · `commands/init.ts` · `commands/sync-down.ts` ·
  `commands/export.ts`(5번째 인자) · `commands/import.ts`(채택값 출력·`--json`·`writeConfig` 반영·
  연결 프로젝트 주의 문구) · `local/router.ts`(`project.get`·`update`)

**변경 — 웹**

- `editor/store.ts`(`tableOptions` + `setProjectConfig` 시그니처) · `editor/use-model.ts` ·
  `editor/export-dialog.tsx`(5번째 인자) · `editor/ddl-import-dialog.tsx`(체크박스·`project.update`) ·
  `pages/project-settings.tsx`

**변경하지 않는다(의도)**

- `packages/core/src/name-meta.ts` — 머릿말은 한 줄도 안 바뀐다(§6)
- `packages/core/src/model.ts` · `file-merge.ts` · `file-format.ts` · `model-diff.ts` ·
  `excel-*.ts` — 타입이 자유 문자열이라 자동으로 따라온다(§3.3)
- `packages/core/src/warnings.ts` — `Warning['kind']` 는 늘지 않는다(HANDOFF 3.14 해당 없음)
- `apps/web/src/editor/naming-check.tsx` 의 `KIND_LABEL` — 같은 이유
- `packages/cli/src/local/router.test.ts` 의 계약 3종 — **맞추는 쪽은 라우터다**
- `apps/server/src/services/mutation.ts` · `model-store.ts` — 새 엔티티도 새 필드도 없다
- `docs/superpowers/HANDOFF.md` — **이 트랙은 건드리지 않는다**(§7.3)
