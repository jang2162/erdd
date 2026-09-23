# 변경 기록(changeset) — 마이그레이션 작성을 돕는 DB 중립 수정 내역

## 배경과 목표

로컬 모드에서 테이블·컬럼을 고친 뒤 **실제 DB 마이그레이션은 각 프로젝트가 자기 도구**(Flyway·
Liquibase·ORM 마이그레이션 등)와 자기 DB 문법으로 쓴다. ERDD 는 지금 그 작업에 쓸 재료를 남기지 않는다
— 「비교」 탭과 변경분 정의서(Excel)는 화면·제출용이고, DDL 내보내기는 **전체 스키마** `CREATE` 다.

**목표:** 스키마 수정 내역을 **DB·도구에 묶이지 않는 ERDD 고유 문법**(DBML 처럼 사람이 읽는 텍스트)으로
저장소에 보관한다. 개발자(와 AI 에이전트)는 기록 파일 하나를 보고 마이그레이션 파일 하나를 빠짐없이
쓴다. **ERDD 는 SQL 을 만들지 않는다.**

**사용자 결정**

| 질문 | 결정 |
|---|---|
| 기록이 만들어지는 시점 | **명시적 생성.** 「변경 기록 만들기」(UI) / `erdd changes new`(CLI) 가 직전 기록 이후 쌓인 차이를 파일 하나로 굳힌다 (prisma migrate·django makemigrations 모델) |
| 범위 | **로컬 모드만.** 서버 모드는 다음 사이클로 미룬다 — 문법·엔진은 core 에 두어 그때 재사용한다 |
| 브랜치 동시 작업 | **있다 — 자연스럽게 합쳐져야 한다.** 병합 후 상대 브랜치 변경이 다음 기록에 중복으로 담기면 안 된다 |
| 기준선(직전 기록 이후의 「직전」) | **B안 — 텍스트 재생.** 기록 파일들을 처음부터 재생해 기준선을 만든다. 저장물은 텍스트뿐이다 |

**B안이 요구하는 것(수용한 비용).** 재생이 기준선의 유일한 원천이므로 (1) 기록은 **기록 대상 범위
안에서 무손실**이어야 하고, (2) 이름 변경을 DROP+ADD 로 오인하지 않으려면 **식별자(`id`)가 텍스트에
있어야** 한다. (1)은 범위를 스키마 투영으로 좁혀 감당하고(1절), (2)는 줄 끝 `@id` 로 감당한다(3절).
재생·직렬화 버그가 기준선을 영구히 오염시키는 위험은 **생성 시 자기검증**(4.2)으로 막는다.

**배제한 대안**
- A안(기록마다 「적용 후 모델」 gz 사본 + 3-way 병합으로 기준선) — 사용자가 텍스트 단일 저장물을 골랐다.
- C안(기록이 git 커밋 해시를 들고 `git show` 로 기준선) — squash·rebase 로 커밋이 사라지면 기준선을 잃는다.
- 저장할 때마다 자동 기록 — 버릴 시도까지 쪼개지고, 파일을 직접 고친 변경(터미널·에이전트·`git pull`·
  `erdd import`)이 빠진다.
- 이름 기반 재생 + 파일 끝 식별자 표 — 「삭제 후 같은 이름으로 재생성」을 구분하지 못하고, 브랜치 A 의
  `X→Y` 개명과 B 의 `X` 수정이 교차하면 **새로 만든 같은 이름의 컬럼에 조용히 잘못 적용**될 수 있다.

## 범위

**포함**

1. core: 스키마 투영, 투영 diff → 문장, 직렬화, 파서, 재생(경합 경고 포함).
2. CLI: `erdd/changes/*.erddc` 입출력, `erdd changes`(상태) · `erdd changes new <이름> [--baseline]` ·
   `erdd changes --check`, `--json`.
3. 로컬 서버: `POST /local/changes`(상태) · `POST /local/changes/create`(생성).
4. 웹: 「버전」 다이얼로그의 「변경 기록」 탭(로컬 모드 전용).
5. `erdd skill install` 의 SKILL.md 에 에이전트용 절.
6. 문서: 문법 정본 guide 신설, 매뉴얼 셋 반영, known-issues.

**제외**

- 서버 모드(웹·CLI 모두). 서버에 연결된 프로젝트에서 `erdd changes` 는 멈춘다.
- 테이블 옵션(`tableOptions`: MySQL ENGINE·문자셋 등)의 기록 — 「알려진 한계」로 남긴다.
- SQL 생성, 「어느 기록이 이미 마이그레이션으로 옮겨졌나」 추적 — 각 프로젝트 도구의 몫이다.
- 기록 삭제 UI — 공유 여부를 아는 사람이 git 에서 판단한다(파일을 지운다).

---

## 1. 무엇을 기록하나 — 스키마 투영

기록·재생·비교는 모델 전체가 아니라 **스키마 투영**(`SchemaProjection`) 위에서만 일어난다.
기준선 = `replay(기록 전부)`, 현재 = `project(현재 모델)`, 미기록 변경 = `diffProjection(기준선, 현재)`.

| 대상 | 투영에 담는 속성 | 담지 않는 것 |
|---|---|---|
| 테이블 | `id`, **실제 물리명**(`composeTablePhysicalName` — DDL 내보내기와 같은 이름), 코멘트, PK 컬럼 목록(순서 포함) | 그룹, 배치, 커스텀 항목, 논리명 자체 |
| 컬럼 | `id`, 소속 테이블, 물리명, **유효 타입**, NULL 허용, 기본값(원문), 자동증가, 코멘트, 허용값(CHECK). 순서는 테이블별 **컬럼 `id` 목록**으로 담는다(정수 `order` 가 아니다 — 아래) | 커스텀 항목, 도메인 참조 자체 |
| 관계(FK) | `id`, **제약 이름**(DDL 내보내기와 같은 함수), 자식 테이블·컬럼 → 부모 테이블·컬럼, 카디널리티(1:1 이면 UNIQUE 동반) | 식별/비식별 |
| 인덱스 | `id`, 이름, 테이블, 구성 컬럼과 정렬 방향, UNIQUE | |

- **코멘트는 DDL 내보내기가 내는 코멘트 텍스트와 같다**(`commentText` 재사용). 논리명·설명을 바꾸면
  DB 코멘트가 바뀌므로 코멘트 변경으로 기록된다.
- **유효 타입은 DB 중립이다.** 컬럼의 논리 타입, 도메인을 쓰면 도메인의 논리 타입. 도메인에 방언별
  타입이 지정돼 있고 그 방언이 프로젝트 `dialects` 에 있으면 함께 싣는다 — `VARCHAR(10) [postgresql: TEXT]`.
  기본값·허용값도 도메인을 거친 유효값이다.
- **컬럼 순서는 상대 위치로 비교한다.** 정수 `order` 를 비교하면 컬럼 하나를 중간에 끼워 넣는 순간
  뒤쪽 컬럼 전부가 「순서 변경」으로 잡힌다. 양쪽에 모두 있는 컬럼의 `id` 목록에서 **최장 공통
  부분열(LCS)** 에 들지 못한 컬럼만 순서 이동으로 기록한다. 새 컬럼은 `add column … [after: X]` 로
  위치를 싣는다(맨 앞이면 `first`).
- **`after: X` 는 「이 기록이 끝난 뒤의 최종 순서에서 바로 앞 컬럼이 X」라는 뜻이다**(문장 시점의 순서가
  아니다). 재생은 `alter table` 블록 끝에서 한 번에 순서를 정한다 — 추가·이동 문장의 순서와 무관하게
  최종 순서가 정확히 복원된다. 문장 시점 의미로 두면 아직 옮기지 않은 컬럼 뒤에 붙인 추가가 그 컬럼이
  옮겨 간 뒤 엉뚱한 자리에 남는다.
- **투영에 들지 않는 테이블:** 컬럼이 없거나 물리명이 빈 테이블 — DDL 내보내기가 빼는 것과 같은 판정
  (`exportableTables`)이다. 그 테이블에 걸린 FK·인덱스도 빠진다.
- **도메인·명명 템플릿 변경은 영향받는 컬럼·테이블 각각의 변경으로 펼쳐진다.** 마이그레이션도 결국
  컬럼마다 ALTER 이므로 그게 맞다.
- **FK 제약 이름은 모델 전체에서 파생된다**(충돌 접미사). 다른 FK 가 늘어 접미사가 바뀌면 이름 변경으로
  기록된다 — 내보내기 결과와 기록이 어긋나지 않게 하려는 선택이고, 「알려진 한계」에 적는다.
- `ddl.ts` 의 판정·이름 함수(`exportableTables`·`relationshipConstraintNames`·`effectiveAutoIncrement`·
  `commentText`)를 **export 해서 같은 것을 쓴다.** 사본을 만들면 내보내기와 기록이 조용히 갈라진다.

## 2. 파일 구조

```
erdd/changes/
├─ 20260923041200_회원-등급-추가.erddc
└─ 20260925093000_주문-메모-추가.erddc
```

- **기록 하나 = 파일 하나 = 마이그레이션 하나.** 파일명 앞 14자리 UTC 시각(`YYYYMMDDHHmmss`)이
  **재생 순서**다(파일명 전체의 코드 단위 사전순). 새 기록의 시각은 **`max(지금, 마지막 기록 + 1초)`** —
  새 기록이 언제나 마지막에 재생되게 한다(시계가 어긋난 브랜치의 기록이 미래 시각을 들고 와도).
  슬러그는 이름에서 파일명에 쓸 수 없는 문자를 뺀 것이다(공백은 `-`, 비면 `changes`).
- `erdd/` 아래라 커밋 대상이다. 브랜치 A·B 의 기록은 파일명이 달라 git 충돌 없이 합쳐진다.
- 트리 로더는 `TOP_LEVEL_FILES` + `tables/` 만 읽으므로 `changes/` 를 모델로 오인하지 않는다.
  파일 감시는 `erdd/` 를 재귀로 보지만 모델 서명이 바뀌지 않으므로 reload 를 일으키지 않는다 —
  **이 두 성질을 테스트로 잠근다.**
- 기록은 **저장된 상태**에서만 만든다(스냅샷과 같은 규칙).

## 3. 기록 문법 (`.erddc`, `format: 1`)

**문법의 정본은 `docs/guides/changeset-format.md`(신설)다.** 아래는 설계 시점의 모양이다.

```
// ERDD 변경 기록 — 이 파일을 보고 마이그레이션을 직접 작성한다
changeset '회원 등급 추가' {
  format: 1
  created: '2026-09-23T04:12:00Z'
}

drop foreign key FK_ORD_OLD ORD(OLD_NO) -> OLD(OLD_NO) [1:N]              @<id>
drop index IX_MBR_OLD on MBR (MBR_NM asc)                                 @<id>

drop table TMP_LOG [comment: '임시'] {                                    @<id>
  column LOG_NO BIGINT [not null, increment]                              @<id>
  primary key (LOG_NO)
  index IX_TMP_LOG_01 (LOG_NO desc)                                       @<id>
}

rename table ORD_DTL -> ORD_ITEM                                          @<id>

create table MBR_GRD [comment: '회원등급'] {                              @<id>
  column GRD_CD VARCHAR(10) [not null, comment: '등급코드']                @<id>
  column USE_YN CHAR(1) [not null, default: `'Y'`, check: ('Y', 'N')]      @<id>
  primary key (GRD_CD)
}

alter table MBR {                                                         @<id>
  drop column OLD_FLAG CHAR(1) [not null, default: `'N'`]                 @<id>
  rename column TEL_NO -> MBL_TEL_NO                                      @<id>
  add column GRD_CD VARCHAR(10) [null, comment: '등급코드', after: MBR_NM] @<id>
  modify column MBR_NM {                                                  @<id>
    type: VARCHAR(50) -> VARCHAR(100)
    nullable: yes -> no
  }
  primary key: (MBR_NO) -> (MBR_NO, SITE_CD)
  comment: '회원' -> '회원 기본'
}

add index IX_MBR_01 on MBR (MBR_NM asc, GRD_CD desc) [unique]             @<id>
add foreign key FK_MBR_MBR_GRD MBR(GRD_CD) -> MBR_GRD(GRD_CD) [1:N]       @<id>
```

### 3.1 문장 순서 — SQL 로 옮겨도 안전한 순서로 고정

1. `drop foreign key` 2. `drop index` / `rename index` 3. `drop table` 4. `rename table`
5. `create table` 6. `alter table` (블록 안: `drop column` → `rename column` → `add column` →
   `modify column` → `primary key` → 테이블 `comment`) 7. `add index` 8. `add foreign key`

**삭제가 이름 변경·추가보다 앞선다** — 「지운 컬럼과 같은 이름으로 새 컬럼 추가」·「지운 테이블의 이름으로
개명」에서 이름이 한순간도 겹치지 않는다. 삭제는 다른 것에 의존하지 않는다(걸린 FK·인덱스는 1·2번이
이미 지웠다). 같은 순번 안에서는 테이블 물리명 → 컬럼 순서 → 이름의 코드 단위 사전순. **위에서 아래로
옮겨 쓰면 의존성이 맞는다.** 두 컬럼의 이름을 맞바꾸는 경우만 예외로, 기록은 `rename` 두 줄로 나오고
SQL 에서는 임시 이름을 거쳐야 한다(「알려진 한계」).

### 3.2 규칙

- **이름은 그 문장 시점의 이름이다.** 개명 뒤 문장은 새 이름을 쓴다. `alter table` 머리는 4번(`rename table`)
  이후이므로 새 테이블 이름이다. `rename index … on T` 의 `T` 는 2번 시점이므로 옛 테이블 이름이다.
- **변경은 `이전 -> 이후`.** 되돌리기(down) 마이그레이션에 필요한 정보가 기록에 다 있다.
  `drop` 은 **삭제 직전의 정의 전부**를 싣는다.
- **인덱스·FK 의 내용 변경은 `drop` + `add`** 로 쓴다(대부분의 DB 가 그렇다). 이름만 바뀐 인덱스는
  `rename index A -> B on T`. FK 는 이름만 바뀌어도 `drop` + `add` 다.
- **기본값은 백틱 안에 원문 그대로** — `` `'Y'` ``, `` `CURRENT_TIMESTAMP` ``. 문자열 리터럴과 식이
  섞이지 않는다. 원문의 `\`·백틱·줄바꿈만 `\\`·`` \` ``·`\n` 으로 이스케이프한다.
- 문자열은 작은따옴표, 안의 `\`·`'`·줄바꿈은 `\\`·`\'`·`\n`.
- 식별자(물리명)는 `[A-Za-z_][A-Za-z0-9_$#]*` 이면 그대로, 아니면 큰따옴표로 감싼다. 값 자리의 키워드와
  같은 `first`·`none` 도 큰따옴표로 감싼다.
- 타입은 `[A-Za-z][A-Za-z0-9_]*` 뒤에 괄호 하나(`VARCHAR(10)`, `DECIMAL(10, 2)`)까지 그대로 쓰고,
  그 밖(`INT UNSIGNED` 처럼 공백이 있는 것)은 큰따옴표로 감싼다.
- 속성 목록(`[...]`) 키: `null`/`not null`(언제나 쓴다), `increment`, `default`, `comment`, `check`,
  방언 타입(`postgresql:` 등), `after: X`/`first`(add column 만), 관계의 `1:1`/`1:N` 과 1:1 의
  `unique: <UQ 이름>`(DDL 내보내기의 UNIQUE 제약 이름), 인덱스의 `unique`.
- `drop table` 블록은 컬럼·PK 에 더해 **그 테이블의 인덱스**도 `index <이름> (<컬럼> asc) [unique]` 로
  싣는다 — 테이블과 함께 사라지므로 따로 `drop index` 를 쓰지 않지만, 되돌리기에는 필요하다.
- `modify column` 블록의 필드: `type`, `dialects`(방언별 타입, `(postgresql: TEXT)`/`none`),
  `nullable`, `default`, `increment`, `comment`, `check`, `position`(순서 이동;
  `position: after A -> after B`, 맨 앞은 `first`). 개명은 `modify` 가 아니라 `rename column` 이다.
  `position` 의 이전 값은 참고용이고(경합 판정에 쓰지 않는다), 이후 값은 위 `after` 와 같은 뜻이다.
- **`@<id>` 는 줄 끝 꼬리표다.** 재생은 이름이 아니라 `@id` 로 대상을 찾는다. 사람은 무시하고 읽는다.
  테이블 수준 문장(`alter table`·`primary key`·테이블 `comment`)은 블록 머리의 `@id` 를 쓴다.
- 헤더: `format`(필수), `created`(필수), `baseline: true`(선택 — 4.4).
- `//` 줄 주석은 파서가 무시한다.

## 4. 재생 · 미기록 변경 · 병합 · 오류

### 4.1 계산

- `replay(records)` — 빈 투영에서 출발해 파일명 순으로 문장을 적용한다. 반환: 투영 + 경고 목록 + 오류.
- `pending = diffProjection(replay(records).projection, project(currentModel))` → 문장 목록.
  비면 「기록할 변경 없음」.

### 4.2 생성 시 자기검증

새 기록 텍스트 `T` 를 만든 뒤, 쓰기 **전에** `replay(기존 기록 + parse(T))` 가 `project(현재 모델)`
과 같은지 확인한다. 다르면 파일을 쓰지 않고 멈춘다(「내부 오류 — 기록을 만들지 않았습니다」, 차이를
함께 출력). **직렬화·파서·재생 버그가 저장소에 거짓 기록으로 들어가는 것을 막는 안전망이다.**

### 4.3 브랜치 병합과 경합

- 겹치지 않는 두 브랜치: 기록 파일은 둘 다 들어오고 모델 YAML 은 git 이 `id` 단위로 합친다 →
  `replay(전부) == 현재` → **미기록 변경 0, 중복 기록 없음.**
- **경합 감지:** `modify`·`rename`·`primary key`·테이블 `comment` 를 재생할 때 **`이전` 값이 그 시점
  기준선의 값과 다르면** 두 기록이 같은 속성을 서로 다른 전제로 바꾼 것이다 → **경고**
  (「기록 간 경합 — 20260925…_주문-메모-추가.erddc 7행: MBR.MBR_NM type 의 이전 값이 VARCHAR(50) 이
  아니라 VARCHAR(80) 입니다」). **재생은 `이후` 값으로 계속**하고, 최종 차이는 미기록 변경으로 드러난다.
  멈추지 않는 이유: 그 상태를 정리하는 방법 자체가 「새 기록을 만든다」이기 때문이다.

### 4.4 기록 파일 다루기

- **만든 기록은 고치지 않는다.** 잘못 만들었고 공유 전이면 **지우고 다시 만든다** — 지우면 그 변경이
  미기록으로 돌아온다. 공유 전 기록 여럿을 하나로 합치는 것도 같은 방법이다.
- `--baseline`: 운영 중인 DB 에 도입할 때 첫 기록(전체 `create`)에 `baseline: true` 를 싣는다 —
  「DB 에 이미 있다, 마이그레이션 불필요」의 표시. **기록이 하나도 없을 때만** 허용한다.
  재생은 `baseline` 과 무관하게 똑같이 적용한다.

### 4.5 오류 — 모두 멈추고 파일·줄을 알린다

| 경우 | 동작 |
|---|---|
| 문법 오류 | `〈파일〉 〈줄〉: 〈무엇을 기대했는데 무엇이 왔나〉` |
| `format` 이 이 CLI 가 아는 것보다 크다 | 「더 새 ERDD 로 만든 기록입니다 — CLI 를 올리세요」 |
| 재생 실패 — 없는 `@id` 에 `modify`/`drop`/`rename`, 이미 있는 `@id` 에 `create`/`add`, 없는 테이블에 컬럼 추가 | 파일·줄과 `@id` |
| 재생이 실패한 상태에서 `new` | 거절 — 기준선을 모르는 채 차이를 내면 거짓 기록이다 |
| 파일에 `id` 없는 항목이 있다 | 거절 — 「`erdd serve` 로 열어 id 를 채운 뒤 다시 하세요」 |
| 미저장 편집(`.erdd/draft.json`)이 있다 | 거절 — 스냅샷과 같은 형식의 문구 |
| 서버에 연결된 프로젝트 | 멈춤(종료 코드 1) — 「변경 기록은 로컬 모드 전용입니다」 |
| 미기록 변경 없음에 `new` | 성공이 아니라 거절(종료 코드 1) — 빈 기록 파일을 만들지 않는다 |
| 현재 모델에 같은 물리명의 테이블이 둘, 또는 한 테이블에 같은 물리명의 컬럼이 둘 | 거절 — 재생이 이름으로 FK·인덱스·PK·`after` 를 풀기 때문이다. DB 에도 만들 수 없는 상태다 |
| 컬럼이 다른 테이블로 옮겨졌다(같은 `id`, 다른 소속) | 거절 — 「옮긴 컬럼은 id 를 지워 새 컬럼으로 만드세요」 |

## 5. 사용 화면

### 5.1 웹 — 「버전」 → 「변경 기록」 탭 (로컬 모드 전용)

- **위: 미기록 변경.** 만들어질 `.erddc` 본문 미리보기(읽기 전용, 헤더 제외) + 「이름」 + 「변경 기록
  만들기」. 미기록이 없으면 「기록할 변경이 없습니다」, 버튼 비활성. 미저장 편집이 있으면 거절 문구.
- **아래: 기록 목록**(최신순) — 이름·시각·문장 수·`baseline` 배지. 누르면 본문 펼침. 삭제 버튼 없음.
- 재생 오류·경합 경고는 탭 맨 위에 파일·줄과 함께. 오류가 있으면 「만들기」가 잠긴다.
- 탭을 열 때, 기록을 만든 뒤, `reload`·`status` 이벤트를 받을 때 다시 가져온다. 모델은 그대로이고
  기록 파일만 늘어난 `git pull` 은 이벤트가 없으므로 탭을 다시 열어야 보인다(「알려진 한계」).
- 미리보기는 **화면 모델 기준**이다(미저장 편집 포함). 미저장 편집이 있으면 거절 문구가 함께 뜨고
  「만들기」가 잠긴다.
- 서버 모드에서는 탭 자체가 렌더되지 않는다.

### 5.2 로컬 서버 채널

`local-protocol.ts` 에 두 경로와 응답 타입을 정의한다. **둘 다 POST 다** — 로컬 전용 라우트는 전부
POST 라는 기존 규칙을 따른다.
- `POST /local/changes` → `LocalChangesStatus` = `{ records: [{file, name, created, baseline,
  statementCount, text}], pending: {text, count} | null, warnings, error | null, unsaved }`.
- `POST /local/changes/create` (JSON `{name, baseline?}`) → `{ ok: true, file, statementCount }` |
  `{ ok: false, reason, message }`.

**tRPC 가 아니다** — 서버 라우터에 없는 로컬 전용 동작이라 `LocalOnly` 잠금과 같은 이유로
`/local/save` 선례를 따른다.

### 5.3 CLI

```
erdd changes                            # 상태: 미기록 변경 미리보기 + 기록 수 + 경고
erdd changes new <이름> [--baseline]    # 기록 생성 → 만든 파일 경로
erdd changes --check                    # 미기록 변경이 있으면 종료 코드 1 (CI)
```

- 모두 `--json` 을 받고 기존 `--json` 규약을 따른다.
- `--check` 는 경합 경고로는 실패하지 않는다. 재생 오류는 항상 종료 코드 1 이다.

### 5.4 AI 에이전트 — SKILL.md

- 「마이그레이션을 쓸 때는 `erdd/changes/` 에서 아직 옮기지 않은 기록을 읽고, 이 프로젝트의 도구와
  DB 문법으로 옮겨 쓴다. `@id` 는 옮기지 않는다. `baseline: true` 는 건너뛴다.」
- 「스키마를 고친 뒤에는 `erdd changes new <이름>`.」
- 「기록 파일을 고치지 않는다.」

## 6. 코드 배치

| 위치 | 역할 |
|---|---|
| `packages/core/src/changeset/types.ts` | 투영·문장·헤더 타입 |
| `packages/core/src/changeset/projection.ts` | `projectSchema(model, settings) → SchemaProjection` |
| `packages/core/src/changeset/diff.ts` | `diffProjection(a, b) → 문장 목록 \| 거절 사유` (3.1 순서로 정렬) |
| `packages/core/src/changeset/syntax.ts` | 식별자·타입·문자열·값의 표기 규칙(직렬화·파서가 공유) |
| `packages/core/src/changeset/format.ts` | `formatChangeset(changeset) → string` · `formatStatements` |
| `packages/core/src/changeset/parse.ts` | `parseChangeset(text) → 변경 기록 \| 오류(줄 번호)` |
| `packages/core/src/changeset/replay.ts` | `applyChangeset` · `replay(records) → {projection, warnings, error}` |
| `packages/core/src/changeset/plan.ts` | `planChanges`(상태) · `composeChangeset`(새 기록 + 자기검증) · 파일명 규칙 |
| `packages/core/src/ddl.ts` | `exportableTables`·`relationshipConstraintNames`·`effectiveAutoIncrement` export (동작 불변) |
| `packages/cli/src/local/changes.ts` | `erdd/changes/` 읽기·쓰기, 파일명, 상태 계산, 자기검증 |
| `packages/cli/src/commands/changes.ts` + `main.ts` | `erdd changes` |
| `packages/core/src/local-protocol.ts` + `packages/cli/src/local/server.ts` | `/local/changes` · `/local/changes/create` |
| `apps/web/src/editor/use-local-changes.ts` · `changes-section.tsx` · `version-dialog.tsx` | 「변경 기록」 탭 |

기존 `diffModels`(적용용)·`diffModelsForDisplay`(표시용)는 **건드리지 않는다.** 투영 전용 diff 를
새로 둔다 — 두 함수는 모델 전체 대상이고 용도가 고정돼 있다(`data-layer.md` 「diff 함수가 두 개다」).
`Statement` 는 판별 유니온(`kind: 'createTable' | 'alterTable' | …`)이고 각 문장은 소스 줄 번호를 갖는다
(파서 산출물일 때).

## 7. 테스트

**중심은 왕복 불변식이다.**

- **`replay(parse(format(diffProjection(A, B))))` 를 A 에 적용하면 B 가 된다** — 무작위 편집 시퀀스
  (테이블·컬럼·관계·인덱스 생성/개명/수정/삭제, 도메인 타입 변경, 명명 템플릿 변경)로 생성하는 속성
  테스트. 시드 고정.
- `parse(format(s)) == s` (문장 수준 왕복), 특수 문자(작은따옴표·백틱·줄바꿈·비ASCII 물리명).
- 이름 변경이 `rename` 으로 나온다(DROP+ADD 아님), 도메인 변경이 컬럼별로 펼쳐진다, 문장 순서(3.1),
  `drop` 이 이전 정의 전부를 싣는다, FK 이름이 `generateDdl` 출력과 같다, 컬럼 하나를 중간에 끼워
  넣으면 `add column … [after: X]` 한 문장만 나온다(뒤쪽 컬럼의 `position` 변경이 없다).
- 브랜치: 겹치지 않는 병합 → 미기록 0 / 같은 속성 경합 → 경고 + 재생 계속 / 개명 × 수정 교차 →
  `@id` 로 정확히 재생 / 삭제 후 같은 이름 재생성.
- 오류 표(4.5) 각 행.
- CLI: `changes`·`new`·`--check`·`--baseline`·`--json`, 서버 연결 프로젝트에서 멈춤.
  로더가 `changes/` 를 모델로 읽지 않음, 감시가 기록 쓰기로 reload 하지 않음.
- 웹: 탭이 로컬 모드에서만 렌더, 미기록 미리보기, 거절 문구, 오류 시 버튼 잠금.
- **구분력:** 자기검증·`@id` 해석·경합 감지·문장 정렬을 각각 일부러 깨뜨려 테스트가 실패하는지 확인한다.
- **스모크:** 실제 `erdd serve` → 편집 → 저장 → 탭에서 기록 생성 → 파일 확인 → `erdd changes --check`
  → 두 브랜치 기록 병합 후 `erdd changes` 가 미기록 0.

## 8. 문서 영향

- `docs/guides/changeset-format.md` 신설 — **문법의 정본**(3절 전체, 경합·자기검증 규칙, 어기면 무엇이
  조용히 깨지는가). 코드 주석은 이 문서의 절 제목을 가리킨다. `CLAUDE.md` 필수 참조 목록에 한 줄.
- `docs/manual/local-guide.md` — 「변경 기록」 절 신설(운영 절차, 브랜치 병합, 파일 지우기로 되돌리기,
  마이그레이션 파일에 기록 파일명을 적어 두라는 안내). 문법 상세는 정본을 가리킨다.
- `docs/manual/cli-guide.md` — `erdd changes` 레퍼런스(실물 출력 인용), 로컬 모드 절.
- `docs/manual/user-guide.md` 14절 — 「변경 기록 탭은 로컬 모드에만 있다」.
- SKILL.md(5.4).
- `docs/ops/known-issues.md` — 서버 모드 미지원, 테이블 옵션 미기록, 파생 FK 이름의 접미사 이동.

## 9. 병행 트랙

`feat/cli-dict-sync` 가 진행 중이다. `packages/cli/src/main.ts`(명령 분기), SKILL.md, `cli-guide.md`,
`CLAUDE.md` 가 겹칠 수 있다. **병행하고 병합 시 충돌을 처리한다**(사용자 결정). 겹치는 파일에서는
기존 서술을 옮기거나 재배치하지 말고 **추가만** 해서 충돌 면적을 줄인다.
