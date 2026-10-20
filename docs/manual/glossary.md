# Glossary

This table maps the terms used in the English manuals (`docs/manual/en/`) to the Korean terms used in the Korean
manuals (`docs/manual/ko/`). Use the same term for the same thing everywhere. Before you introduce a new term, check
whether it is already here, and add it here when you do.

Product names, commands, file names, configuration keys, and code are not translated. The ERDD interface and CLI
messages are in Korean, so the English manuals quote on-screen text and CLI output exactly as they appear, in Korean,
followed by an English translation in parentheses where it matters.

## Modeling

| English | 한국어 | Notes |
| --- | --- | --- |
| logical name | 논리명 | The business name of a table or column |
| physical name | 물리명 | The DB identifier of a table or column |
| table | 테이블 | |
| column | 컬럼 | |
| relationship | 관계 | A foreign key from child to parent |
| identifying relationship | 식별 관계 | The FK columns become part of the child's primary key |
| cardinality | 카디널리티 | `1:1` or `1:N` |
| column mapping | 컬럼 매핑 | |
| junction table | 교차 테이블 | Created by resolving an N:M relationship |
| index | 인덱스 | |
| primary key | 기본 키 | |
| note | 메모 | A sticky note on the canvas |
| group | 그룹 | |
| group view | 그룹 뷰 | |
| full view | 전체 뷰 | |
| ungrouped | 미분류 | Tables not in any group; also domains without a category (uncategorized) |
| color area | 색상 영역 | The area a group draws behind its tables |
| ghost node | 고스트 노드 | |
| alias (group alias) | 별칭 | |
| domain | 도메인 | |
| logical type | 논리 타입 | |
| physical type per dialect | 방언별 물리 타입 | |
| allowed values | 허용값 | |
| unsigned | 부호 없음 | |
| custom field | 커스텀 항목 | |
| table options | 테이블 옵션 | |
| dialect | 방언 | PostgreSQL, MySQL·MariaDB, Oracle, MSSQL |

## Naming

| English | 한국어 | Notes |
| --- | --- | --- |
| naming rules | 명명 규칙 | |
| naming system | 명명 체계 | |
| word | 단어 | |
| term | 용어 | |
| abbreviation | 약어 | |
| English name | 영문명 | |
| word and term dictionary | 단어·용어 사전 | |
| word dictionary | 단어 사전 | |
| term dictionary | 용어 사전 | |
| unregistered word | 미등록 단어 | |
| unregistered items | 미등록 항목 | |
| logical name separator | 논리명 구분자 | |
| table physical name format | 테이블 물리명 형식 | |
| table logical name format | 테이블 논리명 형식 | |
| composed name | 조합된 이름 | The final name after a format is applied |
| model check | 모델 검사 | |
| term mismatch | 용어 불일치 | |

## Editor

| English | 한국어 | Notes |
| --- | --- | --- |
| editor | 에디터 | |
| canvas | 캔버스 | |
| table tree | 테이블 트리 | |
| edit panel | 편집 패널 | |
| header | 헤더 | |
| bottom bar | 하단 바 | |
| view mode | 보기 모드 | Logical, Physical, Mixed |
| auto layout | 자동 정렬 | |
| undo / redo | 실행 취소 / 다시 실행 | |
| bulk action panel | 일괄 작업 패널 | |
| read-only | 읽기 전용 | |
| real-time co-editing | 실시간 동시편집 | |

## Versions, import, and export

| English | 한국어 | Notes |
| --- | --- | --- |
| versions | 버전 | The editor feature that handles the model's history |
| history | 이력 | |
| revision | 리비전 | |
| snapshot | 스냅샷 | |
| compare | 비교 | |
| base / compare (comparison sides) | 기준 / 비교 | |
| export | 내보내기 | |
| import | 가져오기 | |
| Excel specification | Excel 정의서 | |
| table specification | 테이블정의서 | Excel sheet |
| domain specification | 도메인정의서 | Excel sheet |
| change specification | 변경분 정의서 | Excel file of differences only |
| header (`erdd:v2` comment) | 머릿말 | The first-line comment in exported DDL and DBML |
| reverse engineering | 역설계 | |

## Shared resources

| English | 한국어 | Notes |
| --- | --- | --- |
| shared resources | 공용 리소스 | |
| shared dictionary | 공용 사전 | The CLI's name for shared resource libraries |
| library | 라이브러리 | |
| global | 전역 | |
| organization (library tier) | 조직 | |
| import (resync) | 가져오기(재동기화) | |
| resync | 재동기화 | |
| promotion | 승격 | |
| promotion request | 승격 요청 | |
| source | 원본 | The library side of an item |
| source (of an item, `origins.yaml`) | 출처 | Where a received item came from |
| auto update | 자동 갱신 | |
| conflict | 충돌 | |
| defer | 보류 | |
| link (`--adopt`) | 연결 | |
| distribution file | 배포 파일 | A `.erdd-lib.yaml` file the server exported |
| subscription | 구독 | |
| stale file | 오래된 파일 | |
| processing note | 처리 메모 | The approver's note |
| request note | 요청 메모 | |

## Accounts and administration

| English | 한국어 | Notes |
| --- | --- | --- |
| account | 계정 | |
| invite link | 초대 링크 | |
| reset link | 재설정 링크 | |
| service role | 서비스 역할 | `admin` / `user` |
| organization role | 조직 역할 | `owner` / `admin` / `member` |
| project role | 프로젝트 역할 | `admin` / `editor` / `viewer` |
| personal organization | 개인 조직 | |
| manage permission | 관리 권한 | |
| edit permission | 편집 권한 | |
| access token | 액세스 토큰 | |
| admin | 관리자 | |

## CLI and local mode

| English | 한국어 | Notes |
| --- | --- | --- |
| local mode | 로컬 모드 | Running with `erdd serve`, without a server |
| server mode | 서버 모드 | |
| local-only project | 로컬 전용 프로젝트 | |
| connected project | 연결된 프로젝트 | |
| source of truth | 진실 원천 | |
| working copy | 작업 사본 | |
| baseline | 기준 시점 | `.erdd/base.json`. The same word as the CLI message `기준 시점이 없습니다` |
| 3-way merge | 3-way 병합 | |
| draft | 드래프트 | `.erdd/draft.json` |
| unsaved edits | 미저장 편집 | |
| change records | 변경 기록 | `erdd/changes/` |
| unrecorded changes | 미기록 변경 | |
| storage (server project) | 보관함 | How the CLI manual refers to the server project when using `erdd dict` |
| migration (moving a local project to a server) | 이관 | Not a DB migration |
| skill (agent skill document) | 스킬 | |
| web bundle | 웹 번들 | |
| usage error | 사용법 오류 | Exit code `2` |
| exit code | 종료 코드 | |
| envelope (`--json`) | 봉투 | |
