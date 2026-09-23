# 변경 기록 — `.erddc` 문법과 재생 규칙

`erdd/changes/*.erddc` 는 스키마 수정 내역을 DB·마이그레이션 도구에 묶이지 않는 텍스트로 남긴다.
**ERDD 는 SQL 을 만들지 않는다** — 각 프로젝트가 이 기록을 보고 자기 도구로 마이그레이션을 쓴다.
사용법은 [로컬 모드 매뉴얼](../manual/local-guide.md) 「5.6 변경 기록」 이다. 이 문서는 **규칙과
어기면 무엇이 조용히 깨지는가**를 갖는다. 로컬 모드 전용이다.

- 기준선은 **기록 파일 전부를 파일명 순으로 재생한 결과**다. 따로 저장한 사본이 없다.
- 미기록 변경 = 기준선 ↔ 현재 모델의 스키마 투영 차이.
- 새 기록은 쓰기 **전에** 재생해 현재와 같아지는지 확인한다.

코드: `packages/core/src/changeset/`(투영·차이·문법·재생·상태), `packages/cli/src/local/changes.ts`
(파일), `packages/cli/src/commands/changes.ts`(`erdd changes`).

---

## 기록 대상 — 스키마 투영

| 대상 | 싣는 것 | 싣지 않는 것 |
|---|---|---|
| 테이블 | 명명 템플릿을 거친 **실제 물리명**, 코멘트, PK | 그룹·배치·커스텀 항목 |
| 컬럼 | 물리명, **유효 논리 타입**(도메인을 거친 값), 도메인의 방언별 타입 중 프로젝트 방언에 있는 것, NULL 허용, 기본값 원문, 자동증가, 코멘트, 허용값, 순서 | 커스텀 항목, 도메인 참조 자체 |
| FK | DDL 과 같은 제약 이름, 자식·부모 컬럼, 카디널리티, 1:1 의 UNIQUE 이름 | 식별/비식별 |
| 인덱스 | 이름, 컬럼과 정렬 방향, UNIQUE | |

- **판정과 이름은 DDL 내보내기와 같은 함수로 만든다** — `exportableTables`(컬럼이 없거나 물리명이 빈
  테이블은 빠진다), `composeTablePhysicalName`, `relationshipConstraintNames`, `commentText`,
  `effectiveAutoIncrement`. ⚠️ 사본 함수를 두면 기록과 내보내기가 **조용히 다른 이름**을 말하고,
  기록을 보고 쓴 마이그레이션이 내보내기 DDL 로 만든 DB 와 어긋난다.
- 도메인·명명 템플릿 변경은 영향받는 컬럼·테이블 각각의 변경으로 펼쳐진다.
- 테이블 옵션(`tableOptions`)은 싣지 않는다(「알려진 한계」).

## 파일 이름과 재생 순서

`erdd/changes/<YYYYMMDDHHmmss>_<슬러그>.erddc` — 앞 14자리는 UTC 시각이고, **파일명 전체의 코드 단위
사전순이 재생 순서다.** 새 기록의 시각은 `max(지금, 마지막 기록 + 1초)` 다.

- ⚠️ 시각을 그냥 「지금」으로 두면, 시계가 앞선 브랜치의 기록이 합쳐진 뒤 새 기록이 그 **앞**에
  재생되어 기준선이 틀린다.
- ⚠️ 정렬에 `localeCompare` 를 쓰면 실행 환경마다 순서가 달라진다. `compareCodeUnits` 만 쓴다.
- `.erddc` 가 아닌 파일은 읽지 않는다. 트리 로더(`readTree`)는 `erdd/changes/` 를 모델로 읽지 않는다.

## 문법

```
// ERDD 변경 기록 — 이 파일을 보고 마이그레이션을 직접 작성한다. 만든 뒤에는 고치지 않는다
changeset '회원 등급 추가' {
  format: 1
  created: '2026-09-23T04:12:00Z'
}

drop foreign key FK_ORD_OLD ORD(OLD_NO) -> OLD(OLD_NO) [1:N]    @<id>
drop index IX_MBR_OLD on MBR (MBR_NM asc)                       @<id>
rename index IX_A -> IX_B on MBR                                @<id>

drop table TMP_LOG [comment: '임시'] {                          @<id>
  column LOG_NO BIGINT [not null, increment]                    @<id>
  primary key (LOG_NO)
  index IX_TMP_LOG_01 (LOG_NO desc)                             @<id>
}

rename table ORD_DTL -> ORD_ITEM                                @<id>

create table MBR_GRD [comment: '회원등급'] {                    @<id>
  column GRD_CD VARCHAR(10) [not null, comment: '등급코드']      @<id>
  column USE_YN CHAR(1) [not null, default: `'Y'`, check: ('Y', 'N')]  @<id>
  primary key (GRD_CD)
}

alter table MBR {                                               @<id>
  drop column OLD_FLAG CHAR(1) [not null, default: `'N'`]       @<id>
  rename column TEL_NO -> MBL_TEL_NO                            @<id>
  add column GRD_CD VARCHAR(10) [null, after: MBR_NM]           @<id>
  modify column MBR_NM {                                        @<id>
    type: VARCHAR(50) -> VARCHAR(100)
    nullable: yes -> no
  }
  primary key: (MBR_NO) -> (MBR_NO, SITE_CD)
  comment: '회원' -> '회원 기본'
}

add index IX_MBR_01 on MBR (MBR_NM asc, GRD_CD desc) [unique]   @<id>
add foreign key FK_MBR_MBR_GRD MBR(GRD_CD) -> MBR_GRD(GRD_CD) [1:1, unique: UQ_MBR_GRD_CD]  @<id>
```

- **머릿말:** `format`(필수), `created`(필수), `baseline: true`(선택 — 이미 DB 에 있는 스키마의 첫
  기록. 재생에는 영향이 없다). `format` 이 이 ERDD 가 아는 것보다 크면 파서가 멈춘다.
- **컬럼 속성**(`[...]`): `null`/`not null`(언제나), `increment`, `default: `원문``, `comment: '…'`,
  `check: ('…', …)`, 방언 타입(`postgresql: TEXT`), `after: X`/`first`(add column 만).
- **modify column 필드:** `type`, `dialects`(`(postgresql: TEXT)`/`none`), `nullable`(`yes`/`no`),
  `default`, `increment`, `comment`, `check`, `position`(`after X`/`first`). 값이 없으면 `none`.
- **표기:** 식별자는 `[A-Za-z_][A-Za-z0-9_$#]*` 면 그대로, 아니면 큰따옴표. 값 자리 키워드와 같은
  `first`·`none` 도 큰따옴표. 타입은 이름 + 괄호 하나까지 그대로, 공백이 있으면(`"INT UNSIGNED"`)
  큰따옴표. 문자열은 작은따옴표, 기본값은 백틱이고 둘 다 `\`·따옴표·줄바꿈만 `\\`·`\'`(`` \` ``)·`\n`
  으로 이스케이프한다. `//` 줄 주석과 빈 줄은 무시한다. CRLF·BOM 을 받는다.
- **변경은 `이전 -> 이후`**, 삭제는 **삭제 직전의 정의 전부**를 싣는다 — 되돌리기 마이그레이션에
  필요한 정보가 기록에 다 있다.
- 인덱스·FK 의 내용 변경은 `drop` + `add` 다. 이름만 바뀐 인덱스는 `rename index`.

## 문장 순서

1. `drop foreign key` 2. `drop index`·`rename index` 3. `drop table` 4. `rename table`
5. `create table` 6. `alter table`(블록 안: `drop column` → `rename column` → `add column` →
   `modify column` → `primary key` → `comment`) 7. `add index` 8. `add foreign key`

같은 순번 안에서는 테이블 물리명 → 컬럼 순서 → 이름의 코드 단위 사전순이다. **위에서 아래로 SQL 로
옮기면 의존성이 맞는다.** 이름은 그 문장 시점의 이름이다(`alter table` 머리는 개명 뒤 이름,
`rename index … on T` 의 `T` 는 개명 전 이름).

- ⚠️ 삭제를 개명·추가 뒤로 옮기면 「지운 컬럼과 같은 이름의 새 컬럼」·「지운 테이블 이름으로 개명」이
  SQL 에서 이름 충돌을 낸다.

## `after` 는 최종 순서의 바로 앞 컬럼이다

`add column … [after: X]` 와 `position: … -> after X` 는 **이 기록이 끝난 뒤의 최종 순서에서 바로 앞
컬럼이 X** 라는 뜻이다. 재생은 `alter table` 블록 끝에서 한 번에 순서를 정한다. 순서 비교는 컬럼
`id` 목록의 최장 공통 부분열로 하므로, 컬럼 하나를 끼우면 `add` 한 줄만 나오고 뒤 컬럼들은 움직이지
않는다.

- ⚠️ 문장 시점 의미로 바꾸면, 아직 옮기지 않은 컬럼 뒤에 붙인 추가가 그 컬럼이 옮겨 간 뒤 엉뚱한
  자리에 남는다 — 재생 결과가 현재와 달라 자기검증이 기록 생성을 막는다.

## 재생은 `@id` 로 대상을 찾는다

줄 끝 `@<id>` 는 모델의 엔티티 id 다. 재생은 고치고 지울 대상을 **이름이 아니라 `@id` 로** 찾는다.
FK·인덱스·PK·`after` 의 참조만 그 시점의 이름으로 푼다.

- ⚠️ 이름으로 찾으면 브랜치 A 의 `X→Y` 개명과 브랜치 B 의 `X` 수정이 합쳐질 때 오류가 나거나,
  같은 이름으로 새로 만든 컬럼에 **조용히 잘못 적용**된다.
- `@id` 는 꼬리표를 싣는 줄에서만 떼어 낸다 — 값 안의 `@` 를 꼬리표로 오인하지 않는다.

## 경합은 경고다

`rename`·`modify`·`primary key`·`comment` 를 재생할 때 `이전` 값이 그 시점 기준선과 다르면 두 기록이
같은 속성을 서로 다른 전제로 바꾼 것이다. **경고하고 `이후` 값으로 계속한다.** 최종 차이는 미기록
변경으로 드러나고, 그것을 새 기록으로 만드는 것이 정리 방법이다. `position` 의 이전 값은 참고용이라
경합 판정에 쓰지 않는다.

## 생성 시 자기검증

새 기록 텍스트를 만든 뒤 쓰기 **전에**, 기존 기록 + 새 기록을 파싱·재생한 결과가 현재 투영과 같은지
확인한다. 다르면 파일을 쓰지 않는다(「내부 오류 — 기록을 재생한 결과가 현재 모델과 달라 …」).

- ⚠️ 이 검사를 빼면 직렬화·파서·재생의 버그가 **영구히 틀린 기준선**으로 저장소에 들어간다 —
  이후 모든 미기록 변경이 거짓이 된다. 왕복 불변식은 `roundtrip.test.ts` 의 속성 테스트가 잠근다.

## 기록을 만들 수 없는 경우

| 경우 | 이유 |
|---|---|
| 기록 파일이 깨졌거나 재생이 실패했다 | 기준선을 모르는 채 차이를 내면 거짓 기록이다 |
| 파일에 `id` 없는 항목이 있다 | `@id` 를 쓸 수 없다 — `erdd serve` 가 채운다 |
| 미저장 편집이 있다 | 파일 어디에도 없는 상태를 가리키는 기록이 생긴다(스냅샷과 같은 규칙) |
| 같은 물리명의 테이블이 둘, 한 테이블에 같은 물리명의 컬럼이 둘 | 재생이 참조를 이름으로 풀기 때문이다. DB 에도 만들 수 없다 |
| 컬럼이 다른 테이블로 옮겨졌다 | 표현할 문장이 없다 — id 를 지워 새 컬럼으로 만든다 |
| 서버에 연결된 프로젝트 | 로컬 모드 전용이다 |
| 미기록 변경이 없다 | 빈 기록을 만들지 않는다 |
| `--baseline` 인데 기록이 이미 있다 | baseline 은 첫 기록만의 표시다 |

## 기록 파일은 고치지 않는다

기록은 기준선의 원천이라 한 글자를 고치면 그 뒤 모든 기준선이 바뀐다. 잘못 만들었고 **아직 공유하지
않았다면 파일을 지우고 다시 만든다** — 지우면 그 변경이 미기록으로 돌아온다. 공유한 기록을 지우면
뒤 기록의 재생이 그 파일·줄에서 멈춘다.

## 알려진 한계

- **테이블 옵션**(`tableOptions`)을 기록하지 않는다.
- **파생 FK 이름**(`name` 이 빈 관계)은 다른 FK 가 늘어 충돌 접미사가 바뀌면 이름 변경(`drop`+`add`)
  으로 기록된다 — 내보내기 DDL 의 이름과 맞추려는 선택이다.
- **두 컬럼(테이블)의 이름 맞바꾸기**는 `rename` 두 줄로 나온다. SQL 에서는 임시 이름을 거쳐야 한다.
- 모델은 그대로이고 기록 파일만 늘어난 `git pull` 은 웹 탭에 이벤트가 없다 — 탭을 다시 열어야 보인다.
- 서버 모드에는 없다.
