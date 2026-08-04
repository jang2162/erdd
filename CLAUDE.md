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

- **Why:** 이 저장소는 여러 에이전트/작업이 워크트리를 통해 병렬로 돌아간다. 최상위의 `HEAD` 를 옮기면
  그 디렉터리를 보고 있는 다른 작업·IDE·개발 서버가 전부 영향을 받아 병렬 작업이 깨진다.
- **기준 상태:** 최상위는 **진행 중인 주 트랙 브랜치 하나**를 물고 있는 것이 정상이다(`main` 이 아니어도
  된다). main 머지 후 최상위를 `main` 으로 되돌리는 것은 정상 절차다.
- **How to apply:**
  - 다른 브랜치에서 작업해야 하면 브랜치를 갈아타지 말고 **워크트리를 새로 만든다**(아래).
  - 최상위에서 허용되는 것은 읽기 작업(`status`, `log`, `diff`, `show`, `fetch`)과 현재 주 트랙 위의
    커밋이다.
  - 체크아웃이 꼭 필요하면 **먼저 사용자에게 확인**을 받는다.
  - 워크트리 내부에서는 그 워크트리의 브랜치를 자유롭게 다뤄도 된다.

### 병렬 작업 중 커밋 주의

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

  서버는 `PORT`, web 의 프록시 타깃은 `ERDD_SERVER_PORT`(둘을 같은 값으로 준다), vite 포트는 `--port` 다.
  ```bash
  # 워크트리 A에서
  PORT=3001 DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_dev_a' \
    pnpm --filter @erdd/server dev
  ERDD_SERVER_PORT=3001 ./node_modules/.bin/vite --host 127.0.0.1 --port 5174 --strictPort   # apps/web 에서
  ```
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

## 병렬·워크트리 작업은 Orca 환경이면 `/orchestration` 로

병렬 작업이나 워크트리를 분리해 굴리는 상황이면, 먼저 **Orca 앱 환경인지 확인**하고 가능하면 **Orca
오케스트레이션(`/orchestration`)으로 별도 Orca 터미널에 워커를 띄워** 진행한다 — 백그라운드
서브에이전트(Agent 도구)보다 우선한다.

- **Why:** Orca 터미널 워커는 앱에 **독립 터미널**로 떠서 진행을 직접 보고 개입할 수 있고, Orca
  태스크/디스패치 이력(provenance)이 남는다. 서브에이전트는 컨텍스트가 코디네이터 안에 숨어 안 보인다.
- **환경 확인:** `orca status --json` 이 running runtime 을 보이면 Orca 환경이다(CLI 실행자:
  `ORCA_CLI_COMMAND` 가 있으면 그 값, 없으면 macOS·일반은 `orca`, **Linux 는 `orca-ide`** — 리눅스에서
  bare `orca` 는 GNOME 스크린리더로 붙는다). 오케스트레이션 experimental 기능이 켜져 있어야 한다.
- **방식은 외우지 말고** `orca skills get orchestration` 으로 버전 맞춤 가이드를 읽는다(플래그·서브커맨드가
  릴리스마다 바뀐다). 요지: `git worktree add` 로 만든 `.worktrees/*` 도 Orca 가 인식한다
  (`orca worktree list --json` 에 id 로 나옴) → 그 워크트리 id 로
  `orca terminal create --worktree id:<fullId> --command "claude"` → `terminal wait --for tui-idle` →
  **감독**이면 `orchestration task-create` + `dispatch --inject` +
  `check --wait --types worker_done,escalation,decision_gate`.
- **감독(supervised) vs 완전 위임(handoff):** 완료를 기다려 리뷰·병합하면 supervised(`task-create` +
  `dispatch --inject` + `check --wait`). 소유권을 넘기고 안 지켜보면 full handoff(`terminal send` 또는
  `worktree create --prompt`, lifecycle 프리앰블 안 붙임).
- **Orca 환경이 아니거나 오케스트레이션이 불가하면** 기존대로 워크트리 + 서브에이전트(Agent 도구)로
  진행한다.
