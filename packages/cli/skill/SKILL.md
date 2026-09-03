---
name: erdd
description: Use when reading or changing this project's database schema — the ER model lives as YAML files under erdd/ and is handled with the erdd CLI, either standalone (local mode) or synced with an ERDD server.
---

# ERDD 스키마 다루기

이 프로젝트의 DB 스키마는 `erdd/` 아래 YAML로 있다.
스키마를 알아야 하면 마이그레이션이나 ORM 코드를 뒤지지 말고 이 파일들을 읽는다.

## 먼저 모드를 판별한다

**무엇을 하기 전이든 `erdd.config.yaml`의 `serverUrl`부터 본다.** 워크플로도 금지 사항도 여기서 갈린다.

```bash
grep '^serverUrl:' erdd.config.yaml
```

| grep 결과 | 모드 | 진실 원천 |
|---|---|---|
| 값이 있다(`projectId`도 있다) | **서버 모드** | ERDD 서버. `erdd/`는 작업 사본이다 |
| 값이 있는데 `projectId`가 없다 | **설정 오류** | **config를 읽는 명령**(`status`·`validate`·`diff`·`pull`·`push`·`serve`)이 종료 `1`로 거절한다 — `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다(둘 다 없으면 로컬 전용입니다)`. 하나만 적은 것은 오타로 본다. **복구는 막히지 않는다** — `erdd init`은 config를 읽지 않아 이 오류에 걸리지 않으니, 빠진 키를 채우거나 `erdd.config.yaml`을 지우고 `erdd init`(서버 연결) 또는 `erdd init --local`로 다시 쓴다. `erdd skill install`과 `--help`도 그대로 된다 |
| `serverUrl: null` | **로컬 모드** | `erdd/` 파일 자체. 이력은 git 커밋이 남긴다. `erdd init --local`이 쓰는 형태라 `projectId`도 함께 `null`이다 |
| 아무것도 안 나온다(키 자체가 없다 — grep이 종료 `1`) | **로컬 모드** | 위와 같다. `serverUrl`·`projectId`가 **함께** 없으면(둘 다 `null`이든, 키 자체가 없든) 로컬 전용이다 |

## 구조

```
erdd.config.yaml       서버·프로젝트(로컬 모드는 둘 다 null — 키 자체가 없어도 같다)·방언·명명 규칙
erdd/
├─ tables/MBR.yaml     테이블 하나당 파일 하나(파일명 = 물리명)
├─ groups.yaml         테이블 그룹
├─ words.yaml          단어 사전(논리명 조각 → 약어)
├─ terms.yaml          용어 사전(논리명 → 물리명)
├─ domains.yaml        도메인(타입 표준)
├─ custom-fields.yaml  커스텀 항목 정의
├─ layout.yaml         배치 좌표·메모 본문 — **`erdd serve`로 편집하면 모드와 무관하게 생긴다**
└─ snapshots/          스냅샷(`erdd serve`가 만든다). 커밋 대상이다
.erdd/                 내부 상태(git-ignore). 열지도 고치지도 않는다.
                       병합 기준선·자격 증명 / draft.json(`erdd serve`의 저장하지 않은 편집)
```

테이블 파일 안에 컬럼·인덱스·관계가 함께 있다. 관계는 **자식 테이블 파일에만** 적는다.

## 워크플로

| | 서버 모드 | 로컬 모드 |
|---|---|---|
| 받기 | `erdd pull` | 없다 — 파일이 원본이다 |
| 편집 | `erdd/` 아래 파일 | `erdd/` 아래 파일 |
| 검사 | `erdd validate` | `erdd validate` |
| 반영 | `erdd diff` → `erdd push` | `git commit` |

⚠️ **로컬 모드에서 `pull`·`push`·`diff`는 종료 코드 `1`로 멈춘다** — 부를 서버가 없다.
`erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요`

**`erdd serve`는 모드를 가리지 않는다** — 서버에 연결된 프로젝트도 그대로 열려 파일만 본다.
`Ctrl+C`까지 터미널을 붙잡는 장기 실행 프로세스이니 직접 띄우지 않는다.

⚠️ **`erdd serve`가 떠 있을 때 파일을 고치면 사람의 화면과 부딪칠 수 있다.** 화면의 편집은 사람이
**「저장」을 눌러야** 파일이 되므로, 그 전에 내가 파일을 고치면 사람의 화면에 「파일이 밖에서
바뀌었습니다 — 내 편집 유지 / 파일 다시 읽기」 배너가 뜨고, **사람이 고를 때까지 내 수정은 화면에
반영되지 않는다.** 사람이 「내 편집 유지」를 고른 뒤 저장하면 **내 수정이 지워질 수도 있다**(화면의
내용이 파일을 덮어쓴다). 내 수정이 화면에 안 뜬다고 같은 파일을 다시 쓰지 말고 사람에게 알려라.

**서버 모드**

```bash
erdd pull        # 최신 스키마를 받는다(로컬 변경을 덮어쓰므로 먼저 확인한다)
# ... erdd/ 아래 파일을 편집 ...
erdd validate    # 서버 없이 참조 무결성·명명 규칙을 검사
erdd diff        # 올릴 변경 · 내려올 변경 · 충돌을 미리 본다
erdd push        # 서버에 반영(3-way 병합, 충돌이면 중단)
```

충돌이 나면 `erdd pull`로 서버 변경을 받은 뒤 파일에서 정리하고 다시 push한다.
`erdd status`는 서버를 부르지 않고 로컬 변경 유무만 본다.

**로컬 모드**

```bash
# ... erdd/ 아래 파일을 편집 ...
erdd validate    # 참조 무결성·명명 규칙을 검사
git add erdd erdd.config.yaml && git commit -m "스키마: 회원 등급 컬럼 추가"
```

**git 커밋이 이력 전부다** — 되돌리기는 `git revert`, 비교는 `git diff`다. `.erdd/`는 커밋하지 않는다.

⚠️ **로컬 모드에서 `erdd status`로 변경을 확인하지 마라.** 비교 기준선(마지막 pull 시점)이 없어
**무엇을 고쳤든 언제나 「로컬 변경 없음」**을 종료 `0`으로 낸다 — 조용한 거짓 음성이다. 이것을
믿고 커밋을 건너뛰면 작업이 통째로 날아간다. 내가 고친 것은 `git status`·`git diff`로 본다.

## DDL·DBML로 주고받기

**두 모드가 같다.** 서버를 부르지 않고 `erdd/` 파일만 읽고 쓴다.

**내보내기** — 스키마를 SQL로 보여 달라거나 다른 도구에 넘겨야 할 때. 마이그레이션을 손으로
짜 맞추지 말고 이것을 쓴다.

```bash
erdd export                          # DDL을 stdout으로 (기본 방언 = config의 dialects[0])
erdd export --format dbml -o s.dbml  # DBML을 파일로
erdd export --dialect mysql --json   # {format, dialect, path, content, warnings}
```

**본문만 stdout이고 경고는 stderr다** — `erdd export > schema.sql`이 깨지지 않는다.
`-o`를 주면 `--json`의 `content`는 `null`이고 `path`가 채워진다(본문은 그 파일에 있다).

**가져오기** — 남의 DDL/DBML이나 기존 DB 덤프를 이 프로젝트로 들여올 때.

```bash
erdd import schema.sql --dry-run     # 먼저 계획만 본다 — 파일을 하나도 건드리지 않는다
erdd import schema.sql --yes         # 반영
erdd validate                        # 반영 뒤 항상 검사한다
```

⚠️ **머지다. 덮어쓰기가 아니다.**

- **만들어질 이름이 이미 있는 테이블은 건너뛴다**(갱신하지 않는다). `--json`의 `skipped`와
  `table-conflict` 경고에 그 이름이 나온다. 기존 테이블을 DDL로 **고치려는** 시도는 통하지
  않으니, 그럴 때는 테이블 파일을 직접 편집한다.
- DDL에 없는 기존 테이블은 지우지 않는다.
- **파일은 건드려도 서버에는 아무것도 안 간다.** 서버 모드라면 이어서 `erdd diff` → `erdd push`다.
- **테이블 파일 이름이 물리명 기준으로 재작성된다**(`pull`과 같은 동작). 사람이 지은 파일명은
  이 명령을 지나면 `<물리명>.yaml`이 된다.
- 형식은 `--format` > 확장자(`.sql`·`.ddl`→ddl, `.dbml`→dbml) 순이고 **내용은 추정하지 않는다** —
  확장자가 다르면 `--format`을 준다(종료 `2`).
- 방언은 `--dialect` > (DDL) 본문 감지 / (DBML) `Project { database_type }` > config의
  `dialects[0]` 순이다. 무엇을 왜 골랐는지 출력 첫 줄과 `--json`의 `dialectSource`에 나온다.
- `unknown-type`·`unknown-word` 같은 경고는 `warnings`에 실려 온다 — 무시하지 말고 사전
  (`words.yaml`·`terms.yaml`)이나 타입을 정리한다.

## 물리명 짓는 법

물리명을 임의로 만들지 않는다. 이 프로젝트는 사전 기반 명명 규칙을 쓴다. **두 모드가 같다.**

1. `erdd/terms.yaml`에서 논리명이 일치하는 용어를 찾는다 → 그 `physicalName`을 그대로 쓴다
2. 없으면 `erdd/words.yaml`의 단어들을 조합해 만든다(예: 회원=MBR + 번호=NO → `MBR_NO`)
3. 조합에 필요한 단어가 사전에 없으면 `words.yaml`에 함께 추가한다

`erdd validate`가 미등록 단어와 용어 불일치를 경고로 잡아 준다. 경고가 남으면 사전을 먼저 정리한다.

## 도메인과 커스텀 항목

- 컬럼 타입은 가능하면 `domain`(도메인 이름)으로 지정한다. 방언별 타입·기본값·허용값이 함께 따라온다
- `type`은 도메인이 있어도 함께 적는다(모델이 둘 다 들고 있다). 실효 타입은 도메인이 우선한다
- `custom-fields.yaml`에 `required: true`인 항목이 있으면 대상 테이블·컬럼의 `custom`에 값을 반드시 채운다

## 하지 말 것

**두 모드 공통**

- **기존 객체의 `id`를 고치거나 지우지 않는다.** identity다. **새 객체는 `id` 없이 쓴다** — 발급은 자동이고, **두 모드 모두 CLI가 uuidv7을 만들어 파일에 되쓴다**(서버 모드의 `push`도, `erdd serve`도). 서버가 발급하는 것이 아니다
- **파일을 복사해 새 테이블을 만들 때는 `id`를 반드시 지운다.** 컬럼·인덱스·관계의 `id`도 함께 지운다. 남겨 두면 `erdd validate`가 종료 `1`로 막는다 — `id …가 …에도 있습니다`. 막는 이유는 그대로 두면 새 테이블이 생기는 대신 원본이 복사본 내용으로 덮어써지기 때문이다
- **테이블 파일 이름을 직접 바꾸지 않는다.** 파일명은 물리명을 따라간다 — 이름을 바꾸려면 파일 안의 `name`을 고친다(서버 모드는 `pull`이 파일명을 맞춰 준다)
- **배치 좌표를 손으로 고치지 않는다** — `erdd serve` 화면에서 옮긴다. 그리고 **스키마 파일(`erdd/tables/*.yaml`)에서 좌표를 찾지 마라, 거기에 없다.** 좌표와 메모 본문은 `erdd/layout.yaml`에 있다
- **`erdd/layout.yaml`을 잔재로 보고 지우지 않는다.** `erdd serve`로 편집하면 **모드와 무관하게** 생기고 갱신되는 **커밋 대상** 파일이고, 안에 배치 좌표뿐 아니라 **메모 본문(`notes[].content`)** 이 들어 있다 — 사용자가 쓴 콘텐츠다
- **`.erdd/` 아래를 편집하지 않는다.**

**모드에 따라 갈리는 것**

| | 서버 모드 | 로컬 모드 |
|---|---|---|
| `erdd/layout.yaml` | **서버와 오가지 않는 로컬 산출물이다** — `push`가 보내지도 `pull`이 덮어쓰지도 않는다. 서버 DB의 배치·메모는 따로 있고 둘은 서로 모른다. 서버 쪽 배치를 손보려면 웹 에디터로 한다 | 배치 좌표·메모의 **유일한 자리**다 |
| 공용 리소스 출처(`origin`) | 도메인·단어·용어·커스텀 항목의 `origin`은 **파일에 담기지 않는다.** push가 절대 건드리지 않는다 | 해당 없다 — 공용 리소스 자체가 없다 |

## 자동화

모든 명령이 `--json`을 지원한다(stdout은 항상 파싱 가능한 JSON, 진행 메시지는 stderr).
확인 프롬프트(삭제 반영 등)는 `--yes`로 건너뛴다.

종료 코드: `0` 성공 · `1` 실패(검증 실패·충돌·서버 오류·취소) · `2` 사용법 오류.
