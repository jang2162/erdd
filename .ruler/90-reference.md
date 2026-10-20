# ERDD 참조 문서

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 규칙의 상세는 이 파일들이 갖는다.

| 언제 | 읽을 파일 |
| --- | --- |
| 문서를 고치거나 주석을 걷을 때(연대기 금지, `파일:줄번호` 인용 금지, 사본과 정본, 「알려진 한계」 쓰는 법) | `docs/guides/doc-conventions.md` |
| 코드 변경 작업을 시작할 때 — 병렬 여부 무관, 단일 작업 포함(워크트리 생성·정리, Orca 워커 띄우기와 제출 확인, 사이클 흐름, 리뷰·스모크, 병렬 트랙) | `docs/guides/worktree-workflow.md` |
| 테스트를 돌리거나 DB·포트·서버를 만질 때(아래 경고 둘, 브라우저 스모크 준비) | `docs/guides/setup.md` |
| CLI 패키지를 게시할 때(릴리스 전에 사용자에게 묻는 조건과 게시물 차이 판정, 태그 규약, 게시를 막는 가드 넷, core 버전 가드, 게시 경로·trusted publisher 설정 값, 새 패키지 첫 버전의 OTP 손 게시, 게시 직후 레지스트리 반영 지연, 웹 번들·매뉴얼 동봉) | `docs/guides/release.md` |
| 새 op 엔티티나 엔티티 필드를 추가할 때(등록처 여섯 + 일곱 번째, `ENTITY_KINDS` 순서가 정확성 제약인 이유, 하위호환, op 상한, diff 함수 둘) | `docs/guides/data-layer.md` |
| 명명 규칙·사전·형식 템플릿·경고를 건드릴 때(논리명 구분자, `composeTablePhysicalName`/`composeTableLogicalName` 이 유일한 출구인 이유, 그룹 별칭 등록처 일곱, 새 `Warning['kind']` 체크리스트) | `docs/guides/naming.md` |
| DDL·DBML 을 파싱하거나 가져오기를 고칠 때(마스킹 길이 보존 계약, `IDENT_PART`, `detectDialect` 를 DBML 에 태우지 않는 이유) | `docs/guides/ddl-parser.md` |
| 내보내기 포맷·머릿말·Excel 정의서를 건드릴 때(`erdd:v2` 머릿말이 가져오기 계약인 이유, 이름 충돌 판정 키, 경고 문구 갈래) | `docs/guides/export-format.md` |
| 캔버스·사이드바 선택 상태나 다이얼로그를 건드릴 때(선택의 진실 원본은 하나, React Flow 와의 창구는 `onNodesChange` 하나, 단축키 가드 셋) | `docs/guides/editor-state.md` |
| 변경 기록(`erdd/changes/`, `packages/core/src/changeset/`)을 건드릴 때(투영이 DDL 과 같은 함수를 쓰는 이유, 문장 순서, `after` 의 뜻, `@id` 재생, 생성 시 자기검증) | `docs/guides/changeset-format.md` |
| 실시간 채널·`seq`·소켓을 건드릴 때(모델 변경은 전부 `mutateAndPublish`, `store.seq` 에 의미는 하나) | `docs/guides/realtime.md` |
| CLI 를 고치거나 서버 프로시저를 토큰에 열 때(`apiProcedure` 는 명시적 opt-in, push 의 경합 방어선과 신규 id 고정, 로컬 라우터 계약) | `docs/guides/cli.md` |
| 공용 리소스 fork·승격·승인 큐를 건드릴 때(`origin.base` 규칙, 승격의 유일한 엔진, 경합 테스트를 실제로 잠그는 법) | `docs/guides/shared-resources.md` |
| 초대·비밀번호 재설정 링크나 공개 프로시저를 건드릴 때(공개 표면 일곱과 그 잠금, `assertLive` 한 곳 판정, 링크 오류의 종료성 판정) | `docs/guides/auth-links.md` |
| 다음에 무엇을 할지 고를 때(범위 밖으로 미룬 제품 결정, 배제한 것, 기획 대비 미구현) | `docs/ops/known-issues.md` |
| 제품 동작·화면 문구를 바꿨을 때 — 아래 「제품 동작·화면 문구를 바꿨을 때 — 매뉴얼을 함께 고친다」 | `docs/manual/en/` 네 편, 그다음 `docs/manual/ko/` |
| 왜 그렇게 만들었는지가 궁금할 때(⚠️ 지금 참인 규칙의 근거로 인용하지 마라 — 그 시점의 판단이다. 규칙은 `docs/guides/` 가 갖는다) | `docs/superpowers/specs/` |

`docs/guides/setup.md` 의 경고 둘은 그 문서를 열기 전에도 알아야 한다.

- 🔥 **`.env` 를 로드해 `pnpm verify` 를 돌리면 개발 DB 가 통째로 날아간다.**
- ⚠️ **`pnpm -s -r typecheck` 는 오류가 있어도 출력이 비고 종료코드만 1 이다.** 종료코드를 본다.

## 제품 동작·화면 문구를 바꿨을 때 — 매뉴얼을 함께 고친다

`docs/manual/en/` 네 편을 먼저 고치고, 같은 PR 에서 `docs/manual/ko/` 번역본도 고친다. 번역본을 못 고쳤을 때의 표시와 번역본 맨 위 source 주석은 `public-docs` 스택 「원본을 바꾸면 같은 PR 에서 번역본도 고치고, 못 하면 뒤처졌다고 표시한다」 를 따른다.

- 화면 문구를 바꾸면 사용자 가이드의 인용이 어긋난다.
- 환경변수·compose·마이그레이션을 건드리면 설치 매뉴얼의 표와 절차가 어긋난다.
- **CLI 의 명령·옵션·출력 문구·종료 코드·파일 포맷을 바꾸면 CLI 매뉴얼이 어긋난다**(그 문서는 실물 출력을 그대로 인용한다).
- **로컬 모드 분기를 늘리거나 줄이면** 로컬 모드 매뉴얼의 대조표와 사용자 가이드의 「로컬 모드에는 없다」 표시가 함께 어긋난다.
