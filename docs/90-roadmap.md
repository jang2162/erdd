# 로드맵

차별화 기능(명명 체계·산출물, Phase 2)을 실시간 협업(Phase 3)보다 앞에 둔다. dbdiagram.io 대비 경쟁력이 명명 체계·산출물에서 나오고, 실시간 협업은 기술 난도가 높아 기반만 먼저 깔고 완성은 뒤로 미루는 것이 리스크가 적다.

## Phase 1 — 핵심 에디터 (MVP)

혼자서 ERD를 설계하고 DDL을 뽑을 수 있는 최소 제품.

- 계정 / 조직 / 프로젝트 / 멤버·권한 ([01-concepts](01-concepts.md), [18-account](18-account.md))
- GUI 에디터: 테이블·컬럼·관계·인덱스·메모, 편집 패널, 보기 모드, 검색, 실행 취소 ([10-editor](10-editor.md))
- 그룹핑: 그룹 관리, 전체 뷰 색상 영역, 그룹 뷰 독립 배치, 외부 참조 테이블 ([12-grouping](12-grouping.md))
- 버전: Revision 자동 이력, 스냅샷 생성·열람·복원 ([11-collaboration](11-collaboration.md))
- 내보내기: DDL(4개 방언), 이미지(PNG/SVG) ([17-import-export](17-import-export.md))
- 컬럼 직접 타입 입력 ([14-domain](14-domain.md))

> 아키텍처 전제: 데이터 계층은 Phase 1부터 이벤트(작업 로그) 기반으로 설계해 Phase 3 실시간 협업의 기반을 만든다. CLI 파일 포맷 명세도 내부적으로 함께 정의한다. 구체 설계는 [02-architecture](02-architecture.md) 참조.

## Phase 2 — 명명 체계와 산출물 (한국 실무 차별화)

- 단어/용어 사전, 물리명 자동생성, 경고 체계, 명명 검사 화면 ([13-naming](13-naming.md))
- 도메인 정의·지정·일괄 반영 ([14-domain](14-domain.md))
- 커스텀 항목 ([15-custom-fields](15-custom-fields.md))
- 서비스 전역·조직 공용 리소스와 fork/재동기화 ([01-concepts](01-concepts.md))
- Excel 산출물 내보내기, Excel 사전 업로드, 그룹 단위 내보내기 ([17-import-export](17-import-export.md))

## Phase 3 — 협업 완성

- 실시간 동시편집: presence, 즉시 반영, 충돌 정책 ([11-collaboration](11-collaboration.md))
- 스냅샷 diff, 변경분 정의서 ([11-collaboration](11-collaboration.md), [17-import-export](17-import-export.md))
- 권한 세분화 검토 완료 — **새 권한 축은 도입하지 않는다**(그룹 단위·표준 축 분리 모두 필요 미확인). 대신 이미 있는 Project 역할을 화면에 반영: Viewer 읽기 전용 화면, `manage` 전용 동작(스냅샷 복원·삭제) 노출 정리 ([설계](superpowers/specs/2026-08-01-viewer-readonly-ui-design.md))

## Phase 4 — 생태계

- CLI: pull/push/diff, 파일 포맷 공개, 에이전트 스킬 ([16-cli](16-cli.md)) — **Phase 4 잔여 항목**
- DDL 가져오기(역설계) 완료 — 손으로 쓴 좁은 파서(`CREATE TABLE`/`ALTER TABLE ADD CONSTRAINT`/`CREATE INDEX`/`COMMENT ON`)로 기존 DDL을 파싱해 미리보기 후 모델에 적용, 논리명은 코멘트→사전 순으로 복원 ([설계](superpowers/specs/2026-08-03-ddl-reverse-engineering-design.md)) ([17-import-export](17-import-export.md))

## 추후 검토 (현재 비범위)

- **과금 플랜 설계·결제** ([00-vision](00-vision.md)) — 최우선 목표는 조직 내에서 사용 가능한 수준의 도구를 완성하는 것. 상용화·과금은 그 이후 판단.
- 발주처별 Excel 양식 템플릿 커스터마이징
- 셀프 가입(이메일 인증), 초대·비밀번호 재설정 메일 발송 (현재는 관리자 계정 생성으로 대체)
- 소셜 로그인(Google OAuth 등)
- MCP 서버 제공(CLI + 스킬로 우선 대응)
- 프로젝트당 복수 스키마/복수 다이어그램
- 실제 DB 접속 스키마 스캔(현재는 DDL 텍스트 가져오기만)
- N:M 관계의 교차 테이블 자동 생성
- 공개 프로젝트/커뮤니티 공유 기능
