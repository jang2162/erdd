# ERDD 에이전트 지침

이 파일은 **매 세션 반드시 지켜야 할 규칙**만 담는다. 프로젝트 현재 상태·아키텍처 불변식·개발 환경·
sub-project 워크플로는 **`docs/superpowers/HANDOFF.md`** 에 있다 — 작업을 시작하기 전에 그 문서를 읽어라.

- 응답·커밋 메시지·문서는 **한국어**로 쓴다.
- 임시 파일은 저장소 밖(세션 스크래치 디렉터리)에 만든다. 저장소 안에 흘리지 않는다.

---

## 메모리 기능 금지

에이전트의 **메모리(memory) 기능에 프로젝트 지식을 저장하지 않는다.** 알게 된 결정·제약·관례는 전부
문서에 기록하고 커밋한다.

- **Why:** 메모리는 에이전트별·머신별·세션별로 갈라진다. 다른 에이전트나 다른 사람은 그 내용을 볼 수
  없고, 리뷰도 되지 않으며, 코드와 함께 버전 관리되지 않는다. 문서로 남겨야 모든 에이전트에 동일하게
  전달된다.
- **How to apply:** 사용자가 "기억해"라고 하거나 재사용할 결정이 확정되면 → 저장소 안의 지침 문서에
  추가하고 커밋한다. 이 저장소에서 목적지는 보통 셋 중 하나다.
  | 기록할 것 | 목적지 |
  |---|---|
  | 반드시 지켜야 할 작업 규칙 | 이 파일(`CLAUDE.md`) |
  | 아키텍처 불변식·개발 환경·워크플로·이월 항목 | `docs/superpowers/HANDOFF.md` |
  | 제품 사양·기획 결정 | `docs/*.md` (기능 문서) |
- **예외(메모리에 남겨도 되는 것):** 저장소와 무관한 **개인 환경** 문제뿐이다. 로컬 경로, 개인 계정/툴
  설정, 머신 특이사항 등. 프로젝트 코드·아키텍처·컨벤션·의사결정은 예외가 아니다.

---

## Git 작업 규칙

### 최상위 프로젝트에서는 임의로 브랜치를 체크아웃하지 않는다

**최상위 프로젝트 디렉터리**(`/Users/jang2162/IdeaProjects/ERDD` — 워크트리가 아닌 원본 체크아웃)에서는
브랜치를 마음대로 `checkout`/`switch` 하지 않는다.

- **Why:** 최상위 체크아웃은 혼자 쓰는 작업 공간이 아니라 **공유 자원**이다 — IDE, 실행 중인 dev
  서버(`tsx watch`·vite 는 세션을 넘어 살아남는다), 다른 에이전트 세션이 동시에 그 디렉터리를 보고
  있다. 최상위의 `HEAD` 를 옮기면 그것들이 전부 영향을 받는다. **동시 작업이 하나도 없어 보여도
  마찬가지다** — 사람이 켜 둔 IDE·서버는 남아 있다.
- **기준 상태:** 최상위는 **진행 중인 주 트랙 브랜치 하나**를 물고 있는 것이 정상이다(`main` 이 아니어도
  된다). main 머지 후 최상위를 `main` 으로 되돌리는 것은 정상 절차다.
- **How to apply:**
  - 다른 브랜치에서 작업해야 하면 브랜치를 갈아타지 말고 **워크트리를 새로 만든다**(아래).
  - 최상위에서 허용되는 것은 읽기 작업(`status`, `log`, `diff`, `show`, `fetch`)과 현재 주 트랙 위의
    커밋이다.
  - 체크아웃이 꼭 필요하면 **먼저 사용자에게 확인**을 받는다.
  - 워크트리 내부에서는 그 워크트리의 브랜치를 자유롭게 다뤄도 된다.

### 커밋 주의

최상위 체크아웃은 다른 에이전트가 동시에 만지고 있을 수 있다.

- `git add -A` / `git add .` / `git commit -a` 로 **작업 트리 전체를 쓸어 담지 않는다.** 남의 작업 중인
  파일이 내 커밋에 섞인다(실제로 발생한 사고다).
- 커밋할 파일을 **경로로 명시**한다. 가장 안전한 형태는 **경로 지정 커밋**이다 — index를 아예 거치지
  않고 지정한 경로만 커밋한다.
  ```bash
  git commit -m "..." -- <경로1> <경로2>
  ```
- **`add` 와 `commit` 사이에 틈을 두지 마라.** index는 저장소 전체가 공유하는 **단일 자원**이다.
  스테이징해 두고 다른 일을 하면, 그 사이 다른 작업이 `add -A`/`commit -a` 로 커밋할 때 내 staged
  파일이 그 커밋에 통째로 딸려 들어간다. 굳이 `add` 를 쓴다면 `git add <경로들> && git commit ...` 로
  한 명령에 붙인다. (2026-08-04 실제 발생: `add` 후 `status` 확인과 커밋 사이 1분 동안, 병렬 작업이
  만든 서버 커밋 `c37b5c5` 에 이 지침 문서 5개가 통째로 섞여 들어갔다. 되돌리려면 남의 작업이 딛고
  선 HEAD 를 움직여야 해서 그대로 두었다.)
- 커밋 직전에 `git status` 로 stage 목록을 확인한다. 내가 건드리지 않은 파일이 있으면 멈추고 사용자에게
  알린다.
- `.idea/*` 와 루트 `.env` 는 커밋하지 않는다(워킹트리에 항상 `.idea` 노이즈가 있다).

### 커밋 메시지

한국어로 쓰고, 말미에 트레일러 2줄을 붙인다.

```
Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>
```

---

## 워크트리 규칙

**코드 변경 작업은 항상 워크트리에서 한다. 병렬 작업이든 단일 작업이든 예외 없다.** "지금은 나 혼자
작업하니 최상위에서 브랜치를 갈아타도 된다"가 반복된 이탈이다 — 위 절의 Why(최상위는 공유 자원)가
동시 작업 유무와 무관하게 그대로 적용된다.

- **위치**: `.worktrees/<브랜치-슬러그>/` (저장소 루트 하위, gitignore 됨). 저장소 바깥이나 임의 경로에
  만들지 않는다 — 다른 에이전트가 찾지 못한다.
- **브랜치**: 워크트리를 만들 때 **새 브랜치를 함께 만든다.** 이미 다른 워크트리가 체크아웃한 브랜치는
  git 이 거부한다. **기준 브랜치는 로컬 `main` 을 명시한다** — 생략하면 현재 `HEAD`(= 진행 중인 주 트랙)를
  물게 되고, `origin/main` 을 쓰면 뒤처진 옛 커밋을 잡는다(실제로 42커밋 뒤처진 적이 있다).
  ```bash
  git worktree add -b feat/<작업명> .worktrees/feat-<작업명> main
  ```
- **하나의 작업 = 하나의 워크트리.** 여러 작업을 한 워크트리에서 브랜치 갈아타며 처리하지 않는다.
- **생성 직후 의존성을 설치한다.** `post-checkout` 훅은 새 워크트리에서 자동으로 돌지 않을 수 있다.
  빌드/테스트 전에 워크트리 안에서 `pnpm install` 을 직접 실행한다. 새 런타임 의존성이 붙은 트랙은
  설치 전에는 타입이 implicit any 로 깨진다.
- **개발 포트·DB가 겹치지 않게 한다.** 같은 포트를 물면 먼저 뜬 워크트리만 살고 나머지는 조용히 죽거나
  남의 서버에 붙는다. 공유 `erdd_test` 를 두 트랙이 함께 쓰면 테스트가 서로의 데이터를 지운다.

  | 트랙 | server | web | dev DB | test DB |
  |---|---|---|---|---|
  | 최상위 | 3000 | 5173 | `erdd` | `erdd_test` |
  | 워크트리 A | 3001 | 5174 | `erdd_dev_a` | `erdd_test_a` |
  | 워크트리 B | 3002 | 5175 | `erdd_dev_b` | `erdd_test_b` |

  서버는 `PORT`, web 의 프록시 타깃은 `ERDD_SERVER_PORT`(둘을 같은 값으로 준다), vite 포트는
  `ERDD_WEB_PORT` 다. 셋을 함께 주면 루트 `pnpm dev` 하나로 그 트랙이 통째로 뜬다.
  ```bash
  # 워크트리 A 루트에서
  PORT=3001 ERDD_SERVER_PORT=3001 ERDD_WEB_PORT=5174 pnpm dev
  ```
  `DATABASE_URL` 은 그 워크트리의 `.env` 로 준다 — 루트 `pnpm dev` 가 `.env` 를 셸에 로드하므로,
  워크트리마다 `.env` 안의 `DATABASE_URL` 을 격리 DB 로 바꿔 둔다. **`.env` 에는 포트를 적지 않는다** —
  `.env` 의 키가 인라인으로 준 값을 덮으므로, 적어 두면 위 인라인 포트 지정이 무력화된다.
  격리 DB는 미리 만들고 `drizzle-kit migrate` 를 적용해 둔다.
- **정리**: 작업이 끝나 병합·폐기되면 `git worktree remove .worktrees/<...>` 로 지운다. 디렉터리를
  `rm -rf` 로 지웠다면 `git worktree prune` 을 함께 돌린다.
  - **지우기 전에 컨테이너·볼륨을 정리한다.** compose `down` 은 컨테이너만 내리고 named volume 을
    남기므로, 워크트리를 지우면 볼륨이 고아로 쌓인다. 워크트리 디렉터리 안에서 `down -v` 까지 돌린 뒤
    워크트리를 제거한다. 볼륨을 직접 지울 때는 **접두사를 확인**한다 — 최상위 체크아웃의 공유 DB
    볼륨(`erdd-db-1`)을 함께 날리기 쉽다.
- **작업 전 확인**: `git worktree list` 로 같은 작업의 워크트리가 이미 있는지 본다. 있으면 새로 만들지
  말고 그것을 쓴다.

병렬 트랙을 실제로 돌릴 때의 실측 노하우(마이그레이션 번호 충돌, 병합 비용, 워커 브리프에 넣을 금지
사항)는 `docs/superpowers/HANDOFF.md` 5절 "병렬 트랙(worktree 2개)으로 돌릴 때"에 있다.

---

## 워크트리 작업은 Orca 세션으로 한다 (병렬 여부 무관)

**워크트리에서 작업을 시작하는 상황이면 병렬 여부와 무관하게**, 먼저 **Orca 앱 환경인지 확인**하고
가능하면 **Orca 오케스트레이션(`/orchestration`)으로 별도 Orca 터미널에 워커를 띄워** 진행한다 —
백그라운드 서브에이전트(Agent 도구)보다 우선한다.

**메인 세션은 워크트리를 만들고, 그 안의 실제 작업은 Orca 로 띄운 Claude 세션이 한다.** 메인 세션이
워크트리에 들어가 직접 파일을 고치지 않는다 — **디스패치·판정·병합**만 한다.

- **메인 세션이 하는 것:** 워크트리 생성, 워커·리뷰어를 띄우고 브리프를 쓰는 것, 받은 보고를 두고
  무엇을 고치고 무엇을 이월할지 **판정**하는 것, main 병합, 최상위 문서 갱신.
- **에이전트가 하는 것:** 구현, 리뷰, 테스트 실행, 구분력 실증, 스모크 — **실행은 전부 워크트리 안에서**
  에이전트가 한다. 메인 세션은 그 결과를 보고로 받는다.
- **"리뷰"는 리뷰어를 띄우는 것이지 메인 세션이 코드를 뜯어보는 것이 아니다.** 보고가 미검증 주장인
  것은 맞지만, 그 검증도 워커에게 시킨다 — 구현자와 리뷰어가 **각각 독립적으로** 구분력을 실증하므로
  두 소스가 이미 교차 검증된다. **둘이 갈리거나 한쪽이 "실패하지 않았다"고 보고할 때만** 제3의 워커를
  띄워 재현시킨다. 메인 세션이 세 번째 소스로 끼어드는 것은 잉여다(2026-08-06 실측: 컨트롤러가 재실증
  7회를 했는데 워커·리뷰어 보고를 뒤집은 것이 **0건**이었다).
- **예외는 확장이 하나뿐인 브라우저 스모크다**(`HANDOFF.md` 5절). CLI 스모크처럼 터미널로 끝나는
  것은 에이전트에게 시킨다.
- ⚠️ **이 규칙은 사고를 막는다.** 메인 세션의 셸은 `cd` 가 유지되므로 최상위와 워크트리를 오가다
  **어디에 있는지 착각하기 쉽다**(2026-08-06 실제 발생: 최상위에 있는 줄 모르고 워크트리 기준으로
  검증 명령을 돌렸다. 읽기라 무해했지만 파일을 고치는 명령이었다면 `main` 을 건드렸을 것이다).
  메인 세션이 워크트리에서 아무것도 쓰지 않으면 이 사고 자체가 성립하지 않는다. 워커가 도는 중에
  같은 파일을 만져 워커의 작업을 덮어쓰는 경합도 함께 사라진다.

- **트리거는 워크트리다.** 병렬 트랙인지, 태스크를 순차로 도는지, 워커가 하나인지는 따지지 않는다.
  `git worktree add` 로 작업 공간을 떼어냈으면 그 안의 작업은 Orca 터미널에서 시작한다.
  SDD(subagent-driven-development)처럼 태스크마다 워커를 띄우는 워크플로도 마찬가지다 —
  구현자·리뷰어를 Orca 터미널 워커로 띄운다.
  (2026-08-04 실제 발생: 승격 요청 큐 사이클에서 "단일 워크트리 + 순차 태스크라 병렬이 아니다"라고
  판단해 Agent 도구로 진행했다. 사용자가 두 번 바로잡았다 — 조건은 병렬성도, 위임 여부도 아니라
  **워크트리에서 작업을 시작하는가**이다.)
- **판단 지점은 "워크트리를 만들 때"가 아니라 "일을 시작할 때"다.** 워크트리 **생성**은
  `git worktree add` 로 해도 된다. 갈리는 지점은 그 안에서 실제 작업을 시작하는 순간이다 — 워크트리만
  만들어 놓고 메인 세션이 직접 고치거나 Agent 도구를 써버리는 것이 가장 흔한 이탈이다. 그래서
  **워크트리를 만들기 전에 `orca status --json` 부터 실행한다.** running runtime 이면 "메인 세션이 직접
  작업"과 "Agent 도구"는 선택지에서 빠진다.
- **Why:** Orca 터미널 워커는 앱에 **독립 터미널**로 떠서 진행을 직접 보고 개입할 수 있고, Orca
  태스크/디스패치 이력(provenance)이 남는다. 서브에이전트는 컨텍스트가 코디네이터 안에 숨어 안 보인다.
  이 이점은 워커가 하나여도 그대로다 — 오히려 순차 작업일수록 사용자가 지금 무엇이 도는지 보고
  중간에 개입할 값이 크다.
- **환경 확인:** `orca status --json` 이 running runtime 을 보이면 Orca 환경이다(CLI 실행자:
  `ORCA_CLI_COMMAND` 가 있으면 그 값, 없으면 macOS·일반은 `orca`, **Linux 는 `orca-ide`** — 리눅스에서
  bare `orca` 는 GNOME 스크린리더로 붙는다). 오케스트레이션 experimental 기능이 켜져 있어야 한다.
- **방식은 외우지 말고** `orca skills get orchestration` 으로 버전 맞춤 가이드를 읽는다(플래그·서브커맨드가
  릴리스마다 바뀐다). 요지: `git worktree add` 로 만든 `.worktrees/*` 도 Orca 가 인식한다
  (`orca worktree list --json` 에 id 로 나옴) → 그 워크트리 id 로
  `orca terminal create --worktree id:<fullId> --command "claude"` → `terminal wait --for tui-idle` →
  **감독**이면 `orchestration task-create` + 그 핸들로 주입(`worker-start --terminal <handle>` 또는
  `dispatch --inject`) → **제출 확인**(아래 ⚠️, 생략 금지) →
  `check --wait --types worker_done,escalation,decision_gate`.
- **감독(supervised) vs 완전 위임(handoff):** 완료를 기다려 리뷰·병합하면 supervised(`task-create` +
  `dispatch --inject` + `check --wait`). 소유권을 넘기고 안 지켜보면 full handoff(`terminal send` 또는
  `worktree create --prompt`, lifecycle 프리앰블 안 붙임).
- ⚠️ **주입의 성공 응답은 "전송"까지만 보증한다. 제출은 따로 확인해야 한다.** `worker-start` 의
  `stage: input_accepted` 도, `dispatch --inject` 의 `dispatch_input.state: accepted` 도 **터미널에 바이트를
  썼다**는 뜻이지 TUI 가 그 입력을 **제출했다**는 뜻이 아니다. 반환값만으로는 실행 여부를 알 수 없다.
  실패하면 브리프가 입력창에 텍스트로 남은 채 워커는 아무것도 하지 않는데, `check --wait` 는 15분을 조용히
  기다리다 `timedOut` 으로 끝나므로 워커가 죽은 것처럼 보이지도 않는다. **성공 여부가 타이밍에 달려 있어
  같은 명령이 될 때도 있고 안 될 때도 있다** — 한 세션에서 워커 3개를 띄워 1·2번째만 실행되고 3번째만
  방치된 적이 있고, 2026-08-04 에도 같은 방식으로 띄운 둘 중 하나만 자동 제출됐다.
  - **예방 — 터미널 생성과 브리프 주입을 분리한다.** `--terminal` 없이 부르면 `worker-start` 가 **터미널
    생성과 주입을 한 번에** 처리해서 그 사이에 TUI 준비 대기가 없다. Claude Code TUI 가 시작 화면을 그리는
    중에 여러 줄 브리프가 들어가면 **마지막 Enter 가 제출이 아니라 줄바꿈으로 흡수된다.** 터미널을 먼저
    만들어 `tui-idle` 까지 기다린 뒤, 그 핸들에 주입하라.
    ```bash
    orca terminal create --worktree id:<fullId> --command "claude"        # handle 확보
    orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000
    orca orchestration worker-start --task <task_id> --terminal <handle> --json
    ```
  - **검증 — 생략 금지. 확인 없이 `check --wait` 로 넘어가지 않는다.** 예방책만으로는 타이밍 레이스를
    완전히 없앨 수 없다. 주입 직후 터미널을 읽어 제출됐는지 **눈으로** 확인한다.
    ```bash
    orca terminal read --terminal <handle> --json
    ```
    **미제출은 두 형태이고 대응이 다르다.** 판정 기준은 `Ctx Used` 다 — **`0.0%` 면 무조건 미제출**이다.
    - **(a) 입력창(`❯`)에 브리프 텍스트가 그대로 보인다** — 바이트는 들어갔고 Enter 만 흡수됐다.
      엔터만 보내 제출시키고, **다시 읽어 입력창이 비었는지 확인한 뒤에** 대기로 넘어간다.
      ```bash
      orca terminal send --terminal <handle> --text "" --enter --json      # Enter만 보낸다
      orca terminal read  --terminal <handle> --json                       # 입력창이 비어 있어야 한다
      ```
    - **(b) 입력창도 비어 있다(시작 화면만 있고 `Ctx Used: 0.0%`)** — 바이트가 **아예 안 들어갔다.**
      보낼 Enter 가 없으므로 (a) 의 방법이 통하지 않는다. **브리프를 워크트리에 파일로 쓰고 한 줄로
      가리켜라**(아래 ⚠️ 파일 경유).

    `worker-read` 로도 같은 것을 본다 — `orca orchestration worker-read --dispatch <id> --limit 20 --json`
    의 `terminal.tail` 에 프롬프트가 그대로 있고 "Ctx Used: 0.0%" 면 미제출이다. 제출되면 `source` 가
    `terminal` → `transcript` 로 바뀌고 실제 도구 호출이 보인다.
- ⚠️ **예방책을 지켜도 실패한다 — 2026-08-16/17 세션은 `worker-start` 주입이 4/4 전부 (b) 로 실패했다.**
  `terminal create` → `tui-idle` 대기 → `--terminal <handle>` 로 주입하는 위 순서를 **정확히 따랐는데도**
  네 워커 모두 컨텍스트 0.0% 로 아무것도 받지 못했다. 위 문단의 "될 때도 있고 안 될 때도 있다"보다
  **실패 쪽이 기본값에 가깝다고 보고 처음부터 파일 경유로 가는 편이 빠르다.**
  - **파일 경유(권장 레시피).** 브리프를 워크트리 루트에 파일로 쓰고 짧은 한 줄만 보낸다. 여러 줄이
    TUI 에 흡수되는 문제 자체가 사라진다.
    ```bash
    # 1) 브리프 파일을 쓴다 (⚠️ heredoc 은 반드시 따옴표로 — 아래 항목 참조)
    # 2) 한 줄만 보낸다
    orca terminal send --terminal <handle> \
      --text "워크트리 루트의 BRIEF.txt 를 읽고 그 지시를 그대로 수행해라." --enter --json
    orca terminal read --terminal <handle> --json      # Ctx Used 가 0.0% 를 벗어나야 제출된 것
    ```
  - ⚠️ **파일 경유로 우회하면 `worker_done` 을 보낼 수 없다.** `worker-start` 가 주입하는 lifecycle
    preamble 에 `taskId`·`dispatchId` 가 들어 있는데 `terminal send` 에는 그것이 없다. 워커는 일을
    정상적으로 마치고도 보고할 방법이 없어 화면에만 결과를 남긴다(실제로 한 번 그렇게 잃었다).
    **브리프 파일 끝에 완료 보고 명령을 ID 와 함께 박아 둔다.**
    ```bash
    D=$(orca orchestration dispatch-show --task <task_id> --json \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['dispatch']['id'])")
    # 브리프 끝에 아래를 적는다:
    #   orca orchestration send --type worker_done --subject "<요약>" --body "<본문>" \
    #     --task-id <task_id> --dispatch-id $D --outcome succeeded --json
    ```
  - ⚠️ **디스패치 capability 가 폐기되면 메시지 채널이 통째로 막힌다.**
    `dispatch_capability_invalid`("capability is revoked")가 나오면 `worker_done` 도 `heartbeat` 도
    거부된다(거부된 메일이 `escalation`·`status` 로 재전송돼 같은 보고가 두세 번 도착하기도 한다).
    **워커 실패가 아니다** — 프로세스는 정상으로 돌고 있다. 완료 보고를 **파일로 받아라**:
    워커에게 "끝나면 워크트리 루트에 `DONE.md` 를 쓰라"고 지시하고 그 파일을 폴링한다.
- ⚠️ **워커에게 보내는 문자열은 셸이 한 번도 해석하지 않게 해라.** heredoc 만의 문제가 아니다 —
  `task-create --spec "…"` · `send --body "…"` · `terminal send --text "…"` 전부 같다. zsh 는
  **큰따옴표 안에서도 백틱을 명령 치환으로 실행**한다(2026-08-20 실측: `--spec` 안의 백틱 경로 셋이
  빈칸이 된 채 워커에게 갔고, 하필 **「이 파일은 건드리지 마라」의 파일 이름 둘**이 사라져 다른
  트랙과 같은 파일을 고칠 뻔했다).
  - **쓰는 법:** 본문을 파일에 먼저 쓰고 `"$(cat /tmp/brief.txt)"` 로 넘긴다.
  - **검증(생략 금지):** 보낸 뒤 `orca orchestration task-list --json` 으로 **실제로 간 문장을
    되읽어** 핵심 문자열을 grep 한다. `--spec` 은 파일과 달리 눈에 안 보여 이 확인이 더 중요하다.
  - ⚠️ `${VAR:+--flag "$VAR"}` 같은 조건부 확장은 **두 인자가 아니라 한 인자로 붙는다**(같은 세션에서
    `check ${D:+--ack "$D"} --wait` 가 `Unknown flag` 로 즉시 죽었다). 분기해 두 줄로 써라.
- ⚠️ **브리프 heredoc 은 반드시 따옴표로 막아라 — `<<'BRIEF'`.** 따옴표 없는 `<<BRIEF` 는 `$`·백틱·
  글롭을 확장한다. 2026-08-16 에 두 번 물렸다: 브리프의 `alias` 라는 낱말이 셸 빌트인으로 확장돼
  **`alias` 출력 270줄이 브리프 한가운데 통째로 끼어들었고**(리뷰어가 원문을 추정 복원해야 했다),
  다른 브리프에서는 `[groupId, groupAlias]` 가 글롭으로 해석돼 `no matches found` 와 함께 **그 줄만
  조용히 사라졌다**(핵심 수정 방법이 담긴 줄이었다). 변수를 넣어야 하면 파일을 쓴 뒤 치환하거나 Write
  도구를 쓴다. **쓴 뒤에는 줄 수와 핵심 문자열을 grep 으로 확인하라.**
- ⚠️ **`--json` 출력은 NDJSON이고 keepalive가 섞인다.** `check --wait` 는 15초마다
  `{"_keepalive":true,…}` 를 한 줄씩 내고 **마지막 실제 결과는 여러 줄 pretty-print** 다. `json.load`
  로 통째 파싱하면 `Extra data` 로 깨지고, 줄 단위 파싱은 마지막 결과를 놓친다. `raw_decode` 로
  스트리밍 파싱해 `_keepalive` 가 아닌 마지막 객체를 취한다.
- **`check --wait` 의 `timedOut`/`count:0` 은 워커 실패가 아니라 체크포인트다.** 긴 작업은 15~60분이
  보통이다. `worker_done`/`escalation` 을 받거나 터미널이 사라지지 않는 한 rolling wait 를 계속한다.
- ⚠️ **`runtime_unavailable`("The Orca runtime closed the connection before responding") 도 워커 실패가
  아니다.** 코디네이터의 **대기 연결만** 끊긴 것이고 워커 프로세스는 그대로 돈다. 재시작하지 말고 확인부터
  하라 — `orca status --json`(런타임 ready 인지), `worker-show --dispatch`(상태), `worker-read --dispatch`
  (`source: transcript` + terminal `running` 이면 살아 있다), 그리고 **워크트리의 `git log`**(워커가 이미
  커밋했는지). 살아 있으면 `check --wait` 를 다시 걸면 된다. 워커를 죽이고 재디스패치하면 진행 중인
  작업을 버리게 된다.
- ⚠️ **받은 Delivery 는 반드시 `--ack` 하라.** `check` 는 가장 오래된 Delivery 배치를 `--ack <delivery_id>`
  할 때까지 **그대로 재생한다.** ack 없이 다음 `check --wait` 를 걸면 새 워커가 아직 일하는 중인데도
  **직전 메일이 즉시 다시 나와** 완료로 오인한다(실제로 수정 라운드 대기에서 직전 리뷰 결과를 다시 받았다).
  ack 와 대기를 한 번에: `check --ack <delivery_id> --wait --types … --json`.
- **터미널 핸들은 재발급된다.** `worker-start` 응답의 핸들을 나중에 다시 쓰면 `terminal_worktree_mismatch`
  가 난다. `orca terminal list --json` 에서 워크트리·제목으로 다시 찾아 **새 핸들만** 쓴다(옛 핸들과
  양쪽으로 보내지 않는다). 기존 워커를 이어 쓸 때는 `--terminal <handle>` 과 `--worktree` 를 **함께** 준다 —
  `--terminal` 만 주면 워크트리가 기본값(최상위)으로 잡혀 거부된다.
- **Orca 환경이 아니거나 오케스트레이션이 불가하면** 기존대로 워크트리 + 서브에이전트(Agent 도구)로
  진행한다.
