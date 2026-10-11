# ERDD 에이전트 지침

이 파일은 **ERDD 저장소만의 규칙**과 **「상황마다 어느 문서를 보라」는 목차**를 담는다. 모든 프로젝트에 공통인 규칙(응답 언어, 메모리, git, 위임, 검증, 브라우저, Orca, tiergear)은 `guideline` 서버에서 받은 스택(`.ruler/<스택>/`)이 갖는다. 규칙의 상세는 전부 `docs/guides/` 의 정본이 갖는다.

- 응답·커밋 메시지·문서는 **한국어**로 쓴다.
- 임시 파일은 저장소 밖(세션 스크래치 디렉터리)에 만든다. 저장소 안에 흘리지 않는다.

---

## 문서를 새로 만들 때 — 갈래를 먼저 정한다

**`docs/` 바로 아래에는 문서를 만들지 않는다.** 네 갈래 중 하나를 골라 그 안에 만든다.
고르는 질문은 하나다 — **「이 문서는 언젠가 지우는가?」**

| 갈래 | 무엇이 들어가나 | 수명 |
|---|---|---|
| **`docs/guides/`** | **규칙·가이드·정본.** 「이럴 때는 이렇게 한다」와 「어기면 무엇이 조용히 깨지는가」 | **계속 산다.** 규칙이 바뀌면 옛 규칙을 지우고 새 규칙만 남긴다 |
| **`docs/ops/`** | **끝나면 지우는 것.** 열려 있는 제품 결정·반영 절차·체크리스트·과도기 참고 자료 | **일이 끝나면 지운다.** 그때 살아남을 규칙이 있으면 `guides/` 로 올리고 나머지는 걷는다 |
| **`docs/manual/`** | **제품 사용자용 매뉴얼** 네 편(설치·운영, 사용자 가이드, CLI, 로컬 모드) | 산다. **개발자용이 아니다** — 기능을 바꾸면 여기도 함께 고친다 |
| **`docs/superpowers/`** | **이력.** `specs/`(설계 문서)·`plans/`(사이클 중 작업 문서) | `specs/` 는 남는다. 다만 **이력이라 연대기 금지의 예외**이고 **지금 참인 규칙의 근거로 인용하지 마라** |

- ⚠️ **`ops/` 문서를 규칙의 정본으로 삼지 마라.** 지워질 문서를 코드 주석이 가리키면 그 인용이 조용히
  죽는다. 코드가 가리켜야 하는 것은 **`guides/` 의 절 제목**이다.
- ⚠️ **갈래가 애매하면 `ops/` 로 시작한다.** 규칙으로 굳으면 그때 `guides/` 로 올린다 —
  반대 방향(정본이었다가 지워지는 것)이 훨씬 비싸다.
- **계획서(`plans/`)는 사이클이 끝나 main 에 병합되면 지운다.** 결정의 근거는 `specs/` 가, 결과는
  코드와 `git log` 가 들고 있어 계획서만 남으면 순수 부채다.

---

## 필수 참조 문서

- **문서를 고치거나 주석을 걷을 때 → [docs/guides/doc-conventions.md](docs/guides/doc-conventions.md)**
  (연대기 금지, `파일:줄번호` 인용 금지, 사본과 정본, 「알려진 한계」 쓰는 법)
- **코드 변경 작업을 시작할 때(병렬 여부 무관, 단일 작업 포함) →
  [docs/guides/worktree-workflow.md](docs/guides/worktree-workflow.md)**
  (워크트리 생성·정리, Orca 워커 띄우기와 제출 확인, 사이클 흐름, 리뷰·스모크, 병렬 트랙)
- **테스트를 돌리거나 DB·포트·서버를 만질 때 → [docs/guides/setup.md](docs/guides/setup.md)**
  🔥 **`.env` 를 로드해 `pnpm verify` 를 돌리면 개발 DB 가 통째로 날아간다** ·
  `pnpm -s -r typecheck` 는 오류가 있어도 출력이 비고 종료코드만 1 이다 · 브라우저 스모크 준비
- **CLI 패키지를 게시할 때 → [docs/guides/release.md](docs/guides/release.md)**
  (릴리스 전에 사용자에게 묻는 조건과 게시물 차이 판정, 태그 규약, 게시를 막는 가드 넷,
  core 버전 가드, 게시 경로·trusted publisher 설정 값, 새 패키지 첫 버전의 OTP 손 게시,
  게시 직후 레지스트리 반영 지연, 웹 번들·매뉴얼 동봉)
- **새 op 엔티티나 엔티티 필드를 추가할 때 → [docs/guides/data-layer.md](docs/guides/data-layer.md)**
  (등록처 여섯 + 일곱 번째, `ENTITY_KINDS` 순서가 정확성 제약인 이유, 하위호환, op 상한, diff 함수 둘)
- **명명 규칙·사전·형식 템플릿·경고를 건드릴 때 → [docs/guides/naming.md](docs/guides/naming.md)**
  (논리명 구분자, `composeTablePhysicalName`/`composeTableLogicalName` 이 유일한 출구인 이유,
  그룹 별칭 등록처 일곱, 새 `Warning['kind']` 체크리스트)
- **DDL·DBML 을 파싱하거나 가져오기를 고칠 때 → [docs/guides/ddl-parser.md](docs/guides/ddl-parser.md)**
  (마스킹 길이 보존 계약, `IDENT_PART`, `detectDialect` 를 DBML 에 태우지 않는 이유)
- **내보내기 포맷·머릿말·Excel 정의서를 건드릴 때 →
  [docs/guides/export-format.md](docs/guides/export-format.md)**
  (`erdd:v2` 머릿말이 가져오기 계약인 이유, 이름 충돌 판정 키, 경고 문구 갈래)
- **캔버스·사이드바 선택 상태나 다이얼로그를 건드릴 때 →
  [docs/guides/editor-state.md](docs/guides/editor-state.md)**
  (선택의 진실 원본은 하나, React Flow 와의 창구는 `onNodesChange` 하나, 단축키 가드 셋)
- **변경 기록(`erdd/changes/`, `packages/core/src/changeset/`)을 건드릴 때 →
  [docs/guides/changeset-format.md](docs/guides/changeset-format.md)**
  (투영이 DDL 과 같은 함수를 쓰는 이유, 문장 순서, `after` 의 뜻, `@id` 재생, 생성 시 자기검증)
- **실시간 채널·`seq`·소켓을 건드릴 때 → [docs/guides/realtime.md](docs/guides/realtime.md)**
  (모델 변경은 전부 `mutateAndPublish`, `store.seq` 에 의미는 하나)
- **CLI 를 고치거나 서버 프로시저를 토큰에 열 때 → [docs/guides/cli.md](docs/guides/cli.md)**
  (`apiProcedure` 는 명시적 opt-in, push 의 경합 방어선과 신규 id 고정, 로컬 라우터 계약)
- **공용 리소스 fork·승격·승인 큐를 건드릴 때 →
  [docs/guides/shared-resources.md](docs/guides/shared-resources.md)**
  (`origin.base` 규칙, 승격의 유일한 엔진, 경합 테스트를 실제로 잠그는 법)
- **초대·비밀번호 재설정 링크나 공개 프로시저를 건드릴 때 →
  [docs/guides/auth-links.md](docs/guides/auth-links.md)**
  (공개 표면 일곱과 그 잠금, `assertLive` 한 곳 판정, 링크 오류의 종료성 판정)
- **다음에 무엇을 할지 고를 때 → [docs/ops/known-issues.md](docs/ops/known-issues.md)**
  (범위 밖으로 미룬 제품 결정, 배제한 것, 기획 대비 미구현)
- **제품 동작·화면 문구를 바꿨을 때 → `docs/manual/` 네 편을 함께 고친다.**
  화면 문구를 바꾸면 사용자 가이드의 인용이 어긋나고, 환경변수·compose·마이그레이션을 건드리면
  설치 매뉴얼의 표와 절차가 어긋나며, **CLI 의 명령·옵션·출력 문구·종료 코드·파일 포맷을 바꾸면
  CLI 매뉴얼이 어긋난다**(그 문서는 실물 출력을 그대로 인용한다). **로컬 모드 분기를 늘리거나 줄이면**
  로컬 모드 매뉴얼의 대조표와 사용자 가이드의 「로컬 모드에는 없다」 표시가 함께 어긋난다.
- **왜 그렇게 만들었는지가 궁금할 때 → `docs/superpowers/specs/`.**
  ⚠️ **지금 참인 규칙의 근거로 인용하지 마라** — 그 시점의 판단이다. 규칙은 `guides/` 가 갖는다.

---

## 에이전트 기본

### 게시본과 origin/main 이 갈리면 릴리스할지 묻는다 — 자동으로 릴리스하지 않는다

게시물에 들어가는 변경이 `origin/main` 에 올라가 공개 npm 의 최신 게시본과 차이가 생기면, 버전을 올리거나
태그를 밀기 전에 사용자에게 릴리스할지 묻는다.

- **Why:** 기능 여럿을 모아 한 번에 낼지는 사용자가 정한다. 에이전트가 스스로 내면 모으려던 것이 쪼개져
  나가고, 공개 레지스트리에 올린 버전은 되돌리기 어렵다.
- **How to apply:** 무엇이 게시물 차이인지, 판정 명령, 물을 때 보여 줄 것은
  [docs/guides/release.md](docs/guides/release.md) 「릴리스할지는 사용자에게 묻는다」를 따른다.

---

## Git 작업 규칙 (ERDD 한정)

최상위 체크아웃에서 브랜치를 갈아타지 않는 것, 작업 트리를 쓸어 담지 않는 것은 `base` 스택의 `01-git.md` 가 갖는다. 아래는 ERDD 에서 더하는 것이다.

- **최상위의 기준 상태는 진행 중인 주 트랙 브랜치 하나를 물고 있는 것이다**(`main` 이 아니어도 된다). main 머지 후 최상위를 `main` 으로 되돌리는 것은 정상 절차다.
- **경로 지정 커밋을 쓴다** — index 를 거치지 않고 지정한 경로만 커밋한다.
  ```bash
  git commit -m "..." -- <경로1> <경로2>
  ```
  **새로 만든(untracked) 파일은 「pathspec 이 일치하지 않는다」로 실패한다** —
  `git add <경로> && git commit -m "..." -- <경로>` 로 한 명령에 붙인다.
- **`add` 와 `commit` 사이에 틈을 두지 마라.** index 는 저장소 전체가 공유하는 단일 자원이라, 스테이징해 두고 다른 일을 하면 다른 작업의 `add -A`/`commit -a` 에 내 staged 파일이 딸려 들어간다.
- `.idea/*` 와 루트 `.env` 는 커밋하지 않는다(워킹트리에 항상 `.idea` 노이즈가 있다).
- 커밋 메시지는 한국어로 쓰고, 말미에 트레일러 2줄을 붙인다.
  ```
  Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
  Claude-Session: <세션 URL>
  ```

## 워크트리 작업 (ERDD 한정)

**코드 변경 작업은 항상 워크트리에서 한다. 병렬 작업이든 단일 작업이든 예외 없다.**

- **위치는 `.worktrees/<브랜치-슬러그>/`, 기준 브랜치는 로컬 `main` 을 명시한다.**
  ```bash
  git worktree add -b feat/<작업명> .worktrees/feat-<작업명> main
  ```
  생략하면 진행 중인 주 트랙 위에 얹히고, `origin/main` 을 쓰면 뒤처진 옛 커밋을 잡는다.
- **워커 띄우기·제출 확인·정리·병렬 트랙의 절차는 전부
  [docs/guides/worktree-workflow.md](docs/guides/worktree-workflow.md) 에 있다.**
  포트·격리 DB 할당표는 [docs/guides/setup.md](docs/guides/setup.md).
- ⚠️ **브리프 주입의 성공 응답은 「전송」까지만 보증한다.** 제출은 `terminal read` 로 눈으로 확인한다 —
  `Ctx Used: 0.0%` 면 무조건 미제출이다. **긴 한국어 브리프는 파일 경유가 기본이다.**
- ⚠️ **워커에게 보내는 문자열을 셸이 한 번도 해석하지 않게 해라.** zsh 는 큰따옴표 안에서도 백틱을
  실행하고, 따옴표 없는 heredoc 은 `$`·백틱·글롭·`!` 를 전부 해석한다 — **오류 없이 조용히 짧아진다.**

---

## 문서 작성 규약

정본은 [docs/guides/doc-conventions.md](docs/guides/doc-conventions.md) 다. 요지 둘만 여기 남긴다.

- **문서에 연대기를 적지 마라.** 날짜·커밋 해시·「전에는 이랬다」·「어느 사이클이 고쳤다」는 git 이
  갖는다. 문서에는 **지금 참인 규칙**과 **어기면 무엇이 조용히 깨지는가**만 적는다.
  예외는 `docs/superpowers/` 뿐이다.
- **`파일:줄번호` 로 인용하지 마라.** 한 줄만 바뀌어도 조용히 거짓이 된다. **파일 이름과 절 제목·
  함수명·테스트 이름**으로 가리켜라. 같은 규칙을 두 문서에 적지 마라 — 사본에는 정본을 가리키는
  한 줄만 남기고 **금지와 증상은 정본이 갖는다.**
