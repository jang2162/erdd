# ERDD

웹에서 ERD를 실시간 협업으로 설계하고, 한국 실무의 명명 체계(단어·용어·도메인 사전)와 산출물까지 관리하며, CLI로 코드베이스와 AI agent에 연결되는 상용 SaaS.

에디터·실시간 협업·명명 체계·CLI·가져오기/내보내기가 구현되어 동작한다.

## 문서

`docs/` 는 갈래로 나뉜다. **어느 갈래에 무엇이 들어가는지와 「상황 → 문서」 목차는
[CLAUDE.md](CLAUDE.md) 가 갖는다.**

| 갈래 | 무엇이 있나 |
|---|---|
| [docs/manual/](docs/manual/) | **제품 사용자용 매뉴얼 네 편.** [설치·운영](docs/manual/install.md) · [사용자 가이드](docs/manual/user-guide.md) · [CLI](docs/manual/cli-guide.md) · [로컬 모드](docs/manual/local-guide.md) |
| [docs/guides/](docs/guides/) | **개발자·에이전트용 정본.** 「이럴 때는 이렇게 한다」와 「어기면 무엇이 조용히 깨지는가」. 자주 여는 것은 [개발 환경](docs/guides/setup.md) · [워크트리 작업 흐름](docs/guides/worktree-workflow.md) · [데이터 계층](docs/guides/data-layer.md) · [문서 작성 규약](docs/guides/doc-conventions.md) |
| [docs/ops/](docs/ops/) | **끝나면 지우는 것.** 지금은 [열려 있는 제품 결정](docs/ops/known-issues.md) 하나다 |
| [docs/superpowers/specs/](docs/superpowers/specs/) | **이력.** 기능별 설계 문서 — 각 기능을 왜 그렇게 만들었는지의 근거와 결정 기록 |

**처음 이 저장소를 여는 사람은 [CLAUDE.md](CLAUDE.md) 의 「필수 참조 문서」부터 본다** —
「~할 때 → 어느 문서」 목차다.
