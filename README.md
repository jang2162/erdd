# Schemantic

웹에서 ERD를 실시간 협업으로 설계하고, 한국 실무의 명명 체계(단어·용어·도메인 사전)와 산출물까지 관리하며, CLI로 코드베이스와 AI agent에 연결되는 상용 SaaS.

현재는 기획/설계 문서를 정리하는 단계이며, 구현은 이후 진행한다.

## 문서

| 문서 | 내용 |
|---|---|
| [00-vision](docs/00-vision.md) | 비전, 타깃 사용자, 경쟁 분석, 차별화 포인트 |
| [01-concepts](docs/01-concepts.md) | 개념 도메인 모델 — 계층 구조, 엔티티, 공용 리소스 패턴 (허브 문서) |
| [10-editor](docs/10-editor.md) | ERD 에디터 (캔버스, 편집 패널, 보기 모드) |
| [11-collaboration](docs/11-collaboration.md) | 실시간 협업, 이력/스냅샷/diff, 권한 |
| [12-grouping](docs/12-grouping.md) | 테이블 그룹핑, 그룹 뷰와 독립 배치 |
| [13-naming](docs/13-naming.md) | 단어/용어 사전, 물리명 자동생성, 공용 사전 fork/재동기화 |
| [14-domain](docs/14-domain.md) | 도메인 정의, DB 방언별 타입 매핑 |
| [15-custom-fields](docs/15-custom-fields.md) | 커스텀 항목 정의와 활용 범위 |
| [16-cli](docs/16-cli.md) | npm 패키지, 스키마 파일 포맷, pull/push/diff, 에이전트 스킬 |
| [17-import-export](docs/17-import-export.md) | DDL/Excel/이미지 내보내기, DDL 역설계, Excel 업로드 |
| [90-roadmap](docs/90-roadmap.md) | 단계별 로드맵 |

기능 문서(10~17)는 공통 템플릿을 따른다: **목적 → 사용자 시나리오 → 기능 상세 → 다른 영역과의 연계 → 단계별 범위**.
