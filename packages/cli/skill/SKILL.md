---
name: erdd
description: Use when reading or changing this project's database schema — the ER model lives as YAML files under erdd/ and syncs with the ERDD server via the erdd CLI.
---

# ERDD 스키마 다루기

이 프로젝트의 DB 스키마는 `erdd/` 아래 YAML로 있고, ERDD 서버가 진실 원천이다.
스키마를 알아야 하면 마이그레이션이나 ORM 코드를 뒤지지 말고 이 파일들을 읽는다.

## 구조

```
erdd.config.yaml       서버·프로젝트·방언·명명 규칙
erdd/
├─ tables/MBR.yaml     테이블 하나당 파일 하나(파일명 = 물리명)
├─ groups.yaml         테이블 그룹
├─ words.yaml          단어 사전(논리명 조각 → 약어)
├─ terms.yaml          용어 사전(논리명 → 물리명)
├─ domains.yaml        도메인(타입 표준)
└─ custom-fields.yaml  커스텀 항목 정의
.erdd/                 내부 상태(git-ignore). 열지도 고치지도 않는다.
```

테이블 파일 안에 컬럼·인덱스·관계가 함께 있다. 관계는 **자식 테이블 파일에만** 적는다.

## 워크플로

```bash
erdd pull        # 최신 스키마를 받는다(로컬 변경을 덮어쓰므로 먼저 확인한다)
# ... erdd/ 아래 파일을 편집 ...
erdd validate    # 서버 없이 참조 무결성·명명 규칙을 검사
erdd diff        # 올릴 변경 · 내려올 변경 · 충돌을 미리 본다
erdd push        # 서버에 반영(3-way 병합, 충돌이면 중단)
```

`erdd status`는 서버를 부르지 않고 로컬 변경 유무만 본다.

충돌이 나면 `erdd pull`로 서버 변경을 받은 뒤 파일에서 정리하고 다시 push한다.

## 물리명 짓는 법

물리명을 임의로 만들지 않는다. 이 프로젝트는 사전 기반 명명 규칙을 쓴다.

1. `erdd/terms.yaml`에서 논리명이 일치하는 용어를 찾는다 → 그 `physicalName`을 그대로 쓴다
2. 없으면 `erdd/words.yaml`의 단어들을 조합해 만든다(예: 회원=MBR + 번호=NO → `MBR_NO`)
3. 조합에 필요한 단어가 사전에 없으면 `words.yaml`에 함께 추가한다

`erdd validate`가 미등록 단어와 용어 불일치를 경고로 잡아 준다. 경고가 남으면 사전을 먼저 정리한다.

## 도메인과 커스텀 항목

- 컬럼 타입은 가능하면 `domain`(도메인 이름)으로 지정한다. 방언별 타입·기본값·허용값이 함께 따라온다
- `type`은 도메인이 있어도 함께 적는다(모델이 둘 다 들고 있다). 실효 타입은 도메인이 우선한다
- `custom-fields.yaml`에 `required: true`인 항목이 있으면 대상 테이블·컬럼의 `custom`에 값을 반드시 채운다

## 하지 말 것

- **기존 객체의 `id`를 고치거나 지우지 않는다.** 서버가 발급한 identity다. 새 객체는 `id` 없이 쓰면 push가 발급한다
- **파일을 복사해 새 테이블을 만들 때는 `id`를 반드시 지운다.** 컬럼·인덱스·관계의 `id`도 함께 지운다. 남겨 두면 새 테이블이 생기는 대신 원본이 복사본 내용으로 덮어써진다(`push`가 이 상태를 오류로 막지만, 애초에 지우는 것이 맞다)
- **테이블 파일 이름을 직접 바꾸지 않는다.** 파일명은 물리명을 따라가고 `pull`이 갱신한다. 이름을 바꾸려면 파일 안의 `name`을 고친다
- **`.erdd/` 아래를 편집하지 않는다.** 병합 기준선과 자격 증명이 들어 있다
- **배치 좌표·메모를 파일에서 찾지 않는다.** 파일에 담기지 않으며 push도 건드리지 않는다
- **도메인·단어·용어·커스텀 항목의 공용 리소스 출처(origin)도 파일에 담기지 않는다.** push가 절대 건드리지 않는다

## 자동화

모든 명령이 `--json`을 지원한다(stdout은 항상 파싱 가능한 JSON, 진행 메시지는 stderr).
확인 프롬프트(삭제 반영 등)는 `--yes`로 건너뛴다.

종료 코드: `0` 성공 · `1` 실패(검증 실패·충돌·서버 오류·취소) · `2` 사용법 오류.
