

<!-- Source: .ruler/base/00-agent.md -->

# 에이전트 기본

## 사용자 응답은 한국어로 하고, 코드와 식별자는 원래 형태를 지킨다

요약·설명·대화형 답변은 한국어로 한다. 코드, 식별자, 커밋 메시지는 자연스러운 형태(영문·코드)를 유지한다. 파일 안의 주석은 그 파일의 기존 관례를 따른다.

- **Why:** 식별자와 커밋 메시지까지 한국어로 옮기면 `grep`·도구 연동·외부 참조가 함께 끊긴다. 주석을 파일마다 다른 언어로 쓰면 한 파일 안에서 언어가 갈린다.
- **How to apply:** 설명은 한국어로, 코드 블록 안은 그대로 둔다. 기존 파일을 고칠 때는 그 파일이 쓰던 언어를 따른다.

## 에이전트의 메모리 기능에 프로젝트 지식을 저장하지 않는다

알게 된 결정·제약·관례는 전부 문서에 기록하고 커밋한다.

- **Why:** 메모리는 에이전트별·머신별·세션별로 갈라진다. 다른 에이전트나 다른 사람은 그 내용을 볼 수 없고, 리뷰도 되지 않으며, 코드와 함께 버전 관리되지 않는다. 문서로 남겨야 모든 에이전트에 동일하게 전달된다.
- **How to apply:** 사용자가 "기억해"라고 하거나 재사용할 결정이 확정되면 그 프로젝트의 지침 문서에 추가하고 커밋한다.
- **예외 — 메모리에 남겨도 되는 것은 저장소와 무관한 개인 환경 문제뿐이다.** 로컬 경로, 개인 계정·툴 설정, 머신 특이사항 등. 프로젝트 코드·아키텍처·컨벤션·의사결정은 예외가 아니다.

## 지침을 고쳐야 할 일이 생기면 사용자에게 보고하고 진행한다

작업 중에 지침이 틀렸거나 비어 있는 것을 발견하면 그 자리에서 말한다. 그 자리에서 못 고치는 것은 **어느 문서의 어느 절에 무슨 문장을 넣어야 하는지까지 써서** 보고에 남긴다.

- **Why:** 발견은 세션 안에만 있다. 보고하지 않으면 다음 세션과 다른 에이전트는 같은 지침을 같은 상태로 다시 받고, 같은 자리에서 다시 넘어진다. 「어디에 무슨 문장」이 없는 보고는 다음 사람이 그 판단을 처음부터 다시 하게 만든다.
- **How to apply:** 보고에 세 가지를 적는다 — 무엇이 틀렸는가, 어느 문서 어느 절인가, 넣을 문장은 무엇인가.

## 브라우저 탭과 창은 백그라운드로 연다

에이전트가 여는 탭·창이 사람의 화면을 최전면으로 끌어오지 않게 한다.

- **Why:** 검증은 대개 탭을 여러 번 열므로 **확인 한 번이 사람의 작업을 여러 번 끊는다.** 고장으로 보이지 않아 그냥 참고 넘기게 되는 종류의 손해다.
- **How to apply:** 탭을 새로 여는 API 에 백그라운드 옵션이 있으면 항상 준다. 앞으로 띄우는 것은 사람이 그렇게 해 달라고 했을 때만이다. 이미 열린 탭을 옮기는 것(`navigate` 류)은 포커스를 건드리지 않으므로, 새로 열지 말고 쓰던 탭을 옮기면 이 문제 자체가 생기지 않는다. 창 생성 API 에 백그라운드 옵션이 없으면 창 대신 탭으로 연다.



<!-- Source: .ruler/base/01-git.md -->

# Git 과 워크트리

## 최상위 체크아웃에서는 브랜치를 갈아타지 않는다

최상위 프로젝트 디렉터리(워크트리가 아닌 원본 체크아웃)에서 `checkout`/`switch` 를 하지 않는다.

- **Why:** 최상위는 IDE·개발 서버·다른 에이전트 세션이 함께 보고 있는 공유 자원이다. `HEAD` 를 옮기면 그 디렉터리를 보고 있는 작업이 전부 영향을 받아 병렬 작업이 깨진다.
- **How to apply:**
  - 다른 브랜치에서 작업해야 하면 브랜치를 갈아타지 말고 **워크트리를 새로 만든다.**
  - 최상위에서 허용되는 것은 읽기 작업이다(`status`·`log`·`diff`·`show`·`fetch`).
  - 체크아웃이 꼭 필요하면 **먼저 사용자에게 확인**을 받는다.
  - 워크트리 내부에서는 그 워크트리의 브랜치를 자유롭게 다뤄도 된다.

## `git add -A` / `git commit -a` 로 작업 트리를 쓸어 담지 않는다

커밋할 파일을 **경로로 명시**해서 stage 한다.

- **Why:** 최상위 체크아웃은 다른 에이전트가 동시에 만지고 있을 수 있다. 쓸어 담으면 남의 작업 중인 파일이 내 커밋에 섞인다 — 실제로 발생한 사고다.
- **How to apply:** 커밋 직전에 `git status` 로 stage 목록을 확인한다. 내가 건드리지 않은 파일이 있으면 멈추고 사용자에게 알린다.

## 코드 변경 작업의 기본값은 워크트리다

브레인스토밍도 스펙 명세도 구현계획도 없이 **바로 구현할 수 있는 작업만** 워크트리 없이 처리한다.

- **Why:** 최상위 체크아웃은 공유 자원이다(위 절). 설계 판단이 남아 있거나 빌드·테스트를 반복해야 하는 작업을 거기서 하면 그 시간 내내 다른 작업이 막힌다.
- **How to apply — 직접 처리해도 되는 것:** 오타·문구 수정, 주석·문서 갱신, 상수·설정값 조정, 이미 진단이 끝난 버그 수정, 정해진 패턴의 기계적 일괄 변경. 판정은 둘이다 — ① 무엇을 어떻게 고칠지가 요청만으로 확정되고 ② 현재 브랜치에 그대로 커밋할 수 있는가.
  - **파일 개수는 기준이 아니다.** 여러 파일에 걸쳐도 구현 방법이 확정돼 있으면 직접 처리한다.
  - **애매하면 워크트리로 간다.**
  - 직접 작업 중에 설계 판단이 생기거나, 스펙·구현계획을 써야 하거나, 빌드·테스트를 반복해야 하면 **거기서 멈추고 워크트리로 옮긴다.** 그대로 밀고 나가지 않는다 — 「바로 구현하면 되는 줄 알았는데 아니었다」가 실제 이탈 경로다.
    ```bash
    git stash                                   # 최상위를 원래대로 되돌린다
    git worktree add -b feat/x .worktrees/feat-x
    (cd .worktrees/feat-x && git stash pop)     # 워크트리에서 이어서 작업
    ```



<!-- Source: .ruler/base/02-delegation.md -->

# 워커에게 일을 맡길 때

## 메인 세션은 디스패치·판정·병합만 한다

워크트리 작업의 **실행은 전부 워커가 한다.** 메인 세션은 일을 나눠 주고, 올라온 보고를 판정하고, 병합한다.

- **메인 세션이 하는 것:** 워크트리 생성, 워커·리뷰어를 띄우고 브리프를 쓰는 것, 받은 보고를 두고 무엇을 고치고 무엇을 이월할지 **판정**하는 것, 병합, 최상위 지침 문서 갱신.
- **워커가 하는 것:** 구현, 리뷰, 테스트 실행, 수정의 구분력 실증, 개발 서버 스모크 — **실행은 전부** 워크트리 안에서 워커가 하고 메인 세션은 결과를 보고로 받는다.
- **「리뷰」는 리뷰어를 띄우는 것이지 메인 세션이 코드를 뜯어보는 것이 아니다.** 보고가 미검증 주장인 것은 맞지만 그 검증도 워커에게 시킨다 — 구현자와 리뷰어가 **각각 독립적으로** 실증하므로 두 소스가 이미 교차 검증돼 있다. **둘이 갈리거나 한쪽이 「확인했는데 실패하지 않았다」고 보고할 때만** 제3의 워커를 띄워 재현시킨다.
- **예외는 메인 세션만 가진 자원이 필요한 확인이다.** 사람의 브라우저에 붙는 확장처럼 워커가 가질 수 없는 것이 그렇다. 터미널로 끝나는 검증(테스트·타입체크·빌드·포맷·린트)과 **워크트리 전용 포트로 띄우는 개발 서버 확인**은 전부 워커에게 시킨다.

**Why — 둘 다 이유다.**

1. **메인 세션의 셸은 작업 디렉터리가 유지된다.** 최상위와 워크트리를 오가다 지금 어디에 있는지 착각하기 쉽다. 메인 세션이 워크트리에 아무것도 쓰지 않으면 이 사고 자체가 성립하지 않는다.
2. **워커가 도는 중에 메인 세션이 같은 파일을 만지면 워커의 작업을 덮어쓴다.** 순차로 돌 때 안 겹치는 것은 우연일 뿐이다.



<!-- Source: .ruler/base/05-verification.md -->

# 검증

## 생성물을 직접 편집하지 않는다 — 소스를 고치고 그 자리에서 재생성한다

생성기가 만드는 파일은 소스를 고치고 생성기를 돌려 만든다.

- **Why:** 생성물은 다음 재생성에서 통째로 덮어써진다. 더 나쁜 것은 **재생성을 안 돌렸을 때다** — 생성물이 gitignore 면 `git status` 에 뜨지 않아 아무 경고가 없고, 리뷰에도 안 걸리고, 테스트도 통과한다. 그동안 다른 에이전트와 다음 세션은 **낡은 것을 최신인 줄 알고 받는다.** 소스에는 새 규칙이 적혀 있는데 실제로 읽히는 건 옛 것이다.
- **How to apply:**
  - **소스를 고쳤으면 그 자리에서 재생성한다.** 한 줄을 고쳤든 절을 통째로 다시 썼든, 만들었든 옮겼든 지웠든 예외가 없다. **커밋 전에, 작업이 끝난 그 턴에** 돌린다.
  - **지침 파일을 생성물에 써 넣지 않는다.** 생성물이 다시 소스로 읽히면 재생성마다 자기 자신을 덧붙여 중복으로 오염된다.
  - **옮길 때가 가장 티가 안 난다.** 안 돌리면 옛 위치의 생성물이 그대로 남아 낡은 것이 **새 것과 나란히** 계속 주입된다.
  - **소스를 지웠을 때도 돌린다.** 생성기는 대개 소스가 사라진 경로의 생성물을 치워 주지 않으므로 남은 파일을 직접 지운다.
  - 의심스러우면 그냥 돌린다. 멱등이라 두 번 돌려도 손해가 없다.

## 「통과」를 보기 전에 몇 개가 실행됐는지 확인한다

테스트가 **0개 실행되고도 성공으로 끝나는** 빌드 도구가 있다.

- **Why:** 캐시가 최신이라고 판단했거나 필터가 아무것도 고르지 못하면, 실행이 0건인 채로 성공 메시지가 뜬다. **실패가 없으므로 통과로 읽히고**, 그 상태로 「테스트 통과」를 보고하면 아무도 검증하지 않은 코드가 병합된다.
- **How to apply:** 출력에서 **실제 실행 개수**를 확인하고 보고에 함께 적는다. 개수가 0이면 통과가 아니라 **실행되지 않은 것**이다. 캐시를 무시하는 옵션이 있으면 그것을 쓴다.

## 수를 셀 때는 두 번 세고 표본을 열어 본다

세는 `grep` 은 **틀려도 오류를 내지 않는다.**

- **Why:** 함정이 셋이고 **셋 다 그럴듯한 수**를 내놓는다 — ① BSD `grep` 의 BRE 는 `\|` 를 교대가 아니라 글자로 본다 ② **배타 조건으로 세면 걸러진 쪽이 통째로 빠진다** ③ **공백 변형**(`foo (` 대 `foo(`)을 놓치면 실제보다 적게 나온다.
- **How to apply:**
  - `grep -E` 를 쓰고, 공백은 `\s*`, 따옴표는 `["']` 로 흡수한다.
  - **zsh 에서는 패턴을 작은따옴표로 감싼다.** `?`·`*`·`[…]` 가 든 인자는 셸이 먼저 파일 이름으로 펼친다 — 맞는 파일이 없으면 `no matches found` 로 명령이 아예 돌지 않고, 맞는 파일이 있으면 패턴 대신 파일 이름이 넘어가 **오류 없이 엉뚱한 수**가 나온다.
  - 센 뒤 **표본을 열어 보고, 같은 것을 다른 방법으로 한 번 더 센다.**
  - **세는 범위를 라벨에 밝힌다.** 같은 이름도 「식별자 줄」·「호출 자리」·「특정 디렉터리 안」에 따라 수가 갈린다. 범위를 안 적으면 두 문서가 다른 수를 말하게 된다.
  - **수치를 고쳤으면 그 수치에서 나온 것을 전부 다시 센다.** 파생 수치를 함께 고치지 않으면 두 문서가 서로 다른 수를 말하고, 겉으로는 어느 쪽이 옛 값인지 구별되지 않는다.
  - **도구를 문서에 실을 때는 그 도구가 보지 않는 것을 같은 자리에 적는다.** 침묵이 보증으로 읽히면 사람은 확인을 건너뛴다.
  - **도구가 「없다」고 말하는 것과 실제로 없는 것은 다르다.** 정적으로는 영영 못 잡는 것이 섞인다(런타임에 조립되는 이름 등). **버킷 이름을 지을 때 그 이름이 사람에게 어떤 행동을 허가하는지 생각한다** — 「죽었다」는 삭제 허가로 읽힌다.



<!-- Source: .ruler/base/10-package-manager.md -->

# 패키지 매니저

## Node 패키지를 쓰는 저장소는 패키지 매니저로 pnpm 을 쓴다

`package.json` 이 있는 저장소에서 의존성 설치·추가·제거·스크립트 실행은 `pnpm` 으로 한다. `npm`·`yarn` 을 쓰지 않는다.

| 하려는 일 | 명령 |
| --- | --- |
| 설치 | `pnpm install` |
| 추가 | `pnpm add <패키지>` (개발 의존성은 `-D`) |
| 스크립트 실행 | `pnpm <스크립트>` 또는 `pnpm run <스크립트>` |
| 설치본 실행 | `pnpm exec <도구>` |
| 일회성 실행 | `pnpm dlx <도구>` |

- **Why:** 매니저가 섞이면 lockfile 이 둘이 되고(`pnpm-lock.yaml` 과 `package-lock.json`·`yarn.lock`), 어느 쪽이 의존성 버전의 원천인지 갈린다. 다른 매니저로 설치하면 pnpm 이 만든 `node_modules` 구조도 덮어써져 사람과 머신마다 설치 결과가 달라진다.
- **How to apply:**
  - `npm install` 이 습관으로 나오기 쉽다. 명령을 쓰기 전에 `pnpm-lock.yaml` 이 있는지 본다.
  - 다른 매니저의 lockfile(`package-lock.json`, `yarn.lock`)을 만들거나 커밋하지 않는다. 실수로 생겼으면 지운다.
  - 이미 다른 매니저를 쓰는 저장소를 pnpm 으로 옮길지는 사용자에게 묻는다. 말없이 lockfile 을 바꾸지 않는다.



<!-- Source: .ruler/base/99-reference.md -->

# base 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| 코드나 문서의 주석을 쓰거나 고치거나 걷을 때 | `docs/guideline/base/03-comments.md` |
| 문서·주석에서 다른 파일이나 문서를 가리키거나, 지침·문서를 쓰거나 고칠 때 | `docs/guideline/base/04-citation.md` |
| 워크트리를 만들 때 | `docs/guideline/base/06-worktree-setup.md` |
| 워크트리를 지우거나 회수할 때 | `docs/guideline/base/07-worktree-cleanup.md` |
| 워크트리에서 개발 서버·컨테이너처럼 포트를 잡는 것을 띄울 때 | `docs/guideline/base/08-shared-resources.md` |
| 워커에게 브리프를 쓰거나 보내거나, 워커의 결과를 병합할 때 | `docs/guideline/base/09-worker-brief.md` |
| 문서를 새로 만들거나 옮길 때, README 나 지침에서 문서를 가리킬 때 | `docs/guideline/base/11-docs-layout.md` |
| 워커나 다른 에이전트에게 문서를 경로로 넘기거나, 넘겨받은 문서를 읽을 때 | `docs/guideline/base/12-handoff-docs.md` |



<!-- Source: .ruler/browser/99-reference.md -->

# browser 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| 브라우저로 화면을 확인해야 할 때 — 어느 도구로 볼지 고르기 전에 | `docs/guideline/browser/00-tool-choice.md` |
| 브라우저 MCP 서버가 안 붙거나, 워커에게 브라우저 확인을 맡길 때 | `docs/guideline/browser/01-mcp-lifecycle.md` |
| 브라우저 콘솔이나 네트워크 요청을 읽어 판단할 때 | `docs/guideline/browser/02-console-network.md` |
| Playwright 같은 페이지 자동화 도구를 이미 떠 있는 브라우저에 붙일 때 | `docs/guideline/browser/03-cdp.md` |
| 여러 세션이나 워커가 한 브라우저를 함께 쓸 때 | `docs/guideline/browser/04-shared-profile.md` |



<!-- Source: .ruler/browseros-neo/00-switch.md -->

# BrowserOS neo 가 있을 때

## BrowserOS neo 가 깔려 있으면 neo 로 본다

`browser` 스택 「무엇이 붙어 있는지 먼저 확인하고 고른다」 의 **고르는 순서만** 바꾼다 — `/Applications/BrowserOS neo.app` 이 있으면 화면 확인은 neo(`mcp__browseros-neo__*`)로 하고, neo 가 없을 때만 그 절의 순서로 고른다. 도구가 없을 때 검증을 건너뛰지 않는 것, 한계에 걸리면 버리지 말고 얹는 것은 그 스택을 따른다.

- **Why:** neo 는 에이전트 전용으로 띄워 둔 **로그인이 살아 있는 실제 브라우저**다. 다른 도구로 새 브라우저를 띄우면 그 로그인과 프로필을 잃고, 사람의 브라우저에 붙는 도구는 사람의 탭과 섞인다.
- **How to apply:**
  - **꺼져 있으면 에이전트가 켠다** — 화면을 뺏지 않게 `-g` 를 준다. MCP 가 열릴 때까지 기다린다(406 이 정상 응답이다). 포트는 neo 설정(`~/Library/Application Support/BrowserClaw/.browseros/config.json`)의 `ports.proxy` 다.
    ```bash
    open -g -a "BrowserOS neo"
    curl -s -o /dev/null -w '%{http_code}\n' --max-time 40 --retry 40 --retry-delay 1 \
      --retry-connrefused http://127.0.0.1:9010/mcp
    ```
  - **세션을 열기 전에 켜 둔다.** 세션이 시작될 때 꺼져 있었으면 켜도 이 세션에는 붙지 않는다 — 고장을 가르는 법은 `browser` 스택 「브라우저 서버가 안 붙을 때」. 앱을 로그인 항목에 넣어 두면 이 조건을 매번 기억하지 않아도 된다.
  - **새 탭은 백그라운드로 연다.** `tabs action="new"` 에는 `background: true` 를 준다. `run` 의 `browser.pages.newPage(url)` 은 기본이 백그라운드다. `windows action="create"` 에는 백그라운드 옵션이 없으니 창 대신 탭으로 연다.
  - neo 가 못 하는 확인(콘솔 `log`, 첫 로드 콘솔, 네트워크, 뷰포트)이면 **neo 에 Playwright 를 얹는다** — 이 스택 「neo 가 못 하는 다섯 가지」·「Playwright 를 neo 에 붙일 때」. 렌더(애니메이션·캔버스)를 재거나 다른 계정의 둘째 클라이언트가 필요한 검증은 neo 가 아니라 독립 브라우저로 한다 — `browser` 스택 「페이지 자동화 도구를 얹을 때」 의 예외.



<!-- Source: .ruler/browseros-neo/99-reference.md -->

# browseros-neo 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| neo 로 콘솔 로그·네트워크·모바일 레이아웃·렌더(애니메이션·캔버스)를 확인해야 할 때 | `docs/guideline/browseros-neo/01-limits.md` |
| neo 에 Playwright 를 붙이거나, playwright-neo MCP 를 설정할 때 | `docs/guideline/browseros-neo/02-playwright.md` |
| 여러 세션·워커가 neo 를 함께 쓰거나, neo 를 재시작한 뒤 탭을 다시 찾을 때 | `docs/guideline/browseros-neo/03-tabs.md` |



<!-- Source: .ruler/guideline.md -->

# 공용 지침 관리

이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.

- 사본은 직접 고치지 않는다: `.ruler/<스택>/NN-*.md`, `.ruler/<스택>/99-reference.md`, `docs/guideline/`, `guideline.json`·`guideline-lock.json`, 이 파일. 사본을 고쳐 원본에 올릴 것은 `guideline propose` 로, 새 지침은 `guideline-export` 스킬로 제안한다.
- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 `.ruler/<스택>/override.md`, 파일이 여럿이면 `.ruler/<스택>/override.d/*.md` 다. 바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.
- 지침을 최신으로 맞출 때는 `guideline status` 로 보고 `guideline update` 를 쓴다(에이전트는 `guideline-sync` 스킬).
- 프로젝트를 세팅할 때(그 스택을 처음 받았을 때, 새로 클론했을 때, 세팅이 맞는지 의심될 때)는 아래 문서를 읽고 따른다. 스택을 고른 것은 그 기술을 이 프로젝트에 들이기로 한 결정이다. 프로젝트가 아직 그 기술을 쓰지 않는다는 이유로 세팅을 건너뛰지 않는다 — 세팅이 바로 그 기술을 들이는 단계다. 세팅할 수 없으면(권한, 사람이 앱에서 해야 하는 설정 등) 건너뛰지 말고 사용자에게 알린다.

| 스택 | 세팅 문서 |
| --- | --- |
| base | `docs/guideline/base/SETUP.md` |
| browseros-neo | `docs/guideline/browseros-neo/SETUP.md` |
| mise | `docs/guideline/mise/SETUP.md` |
| orca | `docs/guideline/orca/SETUP.md` |



<!-- Source: .ruler/komodo/99-reference.md -->

# komodo 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| Komodo 에 Git Repo Stack 을 새로 만들거나, Stack 의 Source·File Paths·Webhook 설정을 고칠 때 | `docs/guideline/komodo/00-stack.md` |
| Komodo 로 배포하는 compose 에 환경 변수를 추가·변경하거나, Stack Environment 를 채울 때 | `docs/guideline/komodo/01-environment.md` |
| Komodo 서버용으로 compose 의 네트워크·볼륨·포트 등을 덮어쓰는 override 파일을 서버에 쓰거나 고치거나, Stack 의 File Paths·git ignore 를 설정할 때 | `docs/guideline/komodo/02-override.md` |



<!-- Source: .ruler/lefthook/99-reference.md -->

# lefthook 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| lefthook 훅이 부르는 명령을 쓰거나 고칠 때 | `docs/guideline/lefthook/00-toolchain.md` |
| lefthook 의 pre-commit·pre-push 검사 범위를 정하거나 고칠 때 | `docs/guideline/lefthook/01-pre-push.md` |
| lefthook 의 post-checkout 훅을 쓰거나 고칠 때 | `docs/guideline/lefthook/02-post-checkout.md` |



<!-- Source: .ruler/mise/99-reference.md -->

# mise 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| 클론이나 워크트리를 새로 만들었을 때, 또는 런타임 버전을 바꿀 때 | `docs/guideline/mise/00-source.md` |
| 실제로 쓰이는 런타임 버전이 mise.toml 과 다를 때 | `docs/guideline/mise/01-path.md` |
| mise 로 pnpm 을 설치하거나, pnpm 버전이 어긋날 때 | `docs/guideline/mise/02-pnpm.md` |



<!-- Source: .ruler/orca/05-switch.md -->

# Orca 가 살아 있을 때

## Orca 가 살아 있으면 워크트리도 Orca 로 만든다

`base` 스택 「워크트리는 저장소 안에 만들고, 하나의 작업이 하나를 갖는다」 의 **생성 명령(`git worktree add`)과 위치(`.worktrees/`)만** 바꾼다. 브랜치·「하나의 작업 = 하나의 워크트리」·정리 규칙은 그 절을 따른다. 만드는 절차와 그 함정은 `orca-worker` 스킬.

일을 시작하기 전에 `orca status --json` 으로 환경을 먼저 확인하고, running runtime 이면 `orca worktree create` 를 쓴다.

- **Why:** 셋 다 `git worktree add` 에는 없다 — ① 반환 JSON 에 워크트리 **id** 가 들어 있어 워커를 붙일 때 그대로 쓴다(따로 찾을 필요가 없다) ② 프로젝트에 설정된 셋업 훅이 돈다(`orca.yaml` 의 `scripts.setup`. 구성은 `06-orca-yaml.md`) ③ 워크트리 생성과 워커 기동을 한 번에 할 수 있다.
- **How to apply:**
  - **환경 확인은 워크트리를 만들기 전에 한다.** 만든 뒤에 확인하면 「이미 만들었으니 그냥 여기서 하자」로 새어 나간다.
  - `git worktree add` 로 만든 것도 Orca 는 인식한다(`orca worktree list --json` 에 id 로 나온다). 그러니 **이미 손으로 만들었더라도 워커는 Orca 로 붙인다.**
  - Orca 환경이 아니면 워크트리는 그대로 만들고, 그 안에서 서브에이전트로 진행하거나 사용자에게 워크트리 경로를 알려 직접 세션을 띄우게 한다.



<!-- Source: .ruler/orca/99-reference.md -->

# orca 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| 프로젝트에 orca.yaml 을 만들거나 고칠 때, 워크트리 셋업·아카이브 스크립트를 정할 때 | `docs/guideline/orca/06-orca-yaml.md` |



<!-- Source: .ruler/oxc/01-formatting.md -->

# 포맷과 린트

## 포매터·린터가 강제하는 스타일은 손으로 맞추지 않는다 — 도구를 돌린다

코드를 쓴 뒤 포매터와 린터(`--fix`)를 돌린다. 들여쓰기·따옴표·import 순서·클래스 순서를 손으로 맞추지 않는다.

- **Why:** 도구가 강제하는 것을 손으로 바꾸면 다음 포맷에서 되돌려진다. 특히 정렬 옵션이 켜져 있으면 **순서를 임의로 바꿔도 포매터가 되돌린다** — 손으로 맞춘 순서는 커밋에 남지 않는다.
- **How to apply:**
  - 무엇이 자동인지는 `.oxfmtrc.json` 을 본다.
    - `sortImports` 가 있으면 import 는 그 `groups` 순서로 정렬된다. 손으로 정렬하지 않는다.
    - `sortTailwindcss` 가 있으면 `className` 뿐 아니라 `functions` 에 적힌 호출(`cx`·`cva` 등) 안의 클래스 문자열도 정렬 대상이다.
  - 커밋 전에 포맷과 린트를 한 번 돌려 두면 훅이 파일을 고쳐 다시 stage 하는 일이 줄어든다.



<!-- Source: .ruler/oxc/99-reference.md -->

# oxc 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| oxfmt·oxlint 를 스크립트나 훅에서 부르게 할 때 | `docs/guideline/oxc/00-version.md` |



<!-- Source: .ruler/project.md -->

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



<!-- Source: .ruler/ruler/00-sources.md -->

# ruler 소스와 생성물

## 지침 소스는 `.ruler/` 이고 에이전트가 읽는 파일은 생성물이다

| 구분 | 파일 |
| --- | --- |
| 소스(수정 대상) | `.ruler/*.md`, `.ruler/skills/` |
| 설정 | `.ruler/ruler.toml` |
| 생성물(직접 수정 금지) | `AGENTS.md`, `CLAUDE.md`, 에이전트별 설정·스킬 경로(`.codex/config.toml`, `.claude/`, `.agents/` 등), 이들의 `.bak` |

생성물에 지침을 써 넣지 않는다. 지침을 고치려면 소스를 고치고 `ruler apply` 를 돌린다.

`.ruler/<스택>/` 과 `docs/guideline/` 은 `sync-guideline` 이 문서 저장소에서 복사한 **사본**이다. 직접 고치지 않는다 — 고칠 것은 문서 저장소에 `import-guideline` 으로 올린다. 직접 고친 사본은 다음 sync 에서 덮어써지거나 원본과 조용히 갈라진다.

- **Why:** 생성물은 다음 apply 에서 통째로 덮어써진다. 생성물이 소스로 다시 읽히는 설정이면 apply 마다 자기 자신을 덧붙여 중복 헤더로 오염된다.
- **How to apply:** 어떤 파일이 생성물인지 헷갈리면 `.ruler/ruler.toml` 의 에이전트 목록과 `.gitignore` 의 Ruler 블록을 본다. 블록 안에 있으면 생성물이다.

## ruler 는 devDependency 로 고정하고 설치본으로 부른다

`pnpx @intellectronica/ruler apply` 가 아니라 `pnpm exec ruler apply` 로 부른다(또는 그것을 감싼 패키지 스크립트).

- **Why:** `pnpx` 는 `pnpm dlx` 의 별칭이라 `node_modules` 를 무시하고 부를 때마다 레지스트리의 **최신본**을 받는다. 사람과 시점마다 다른 ruler 가 생성물을 만들게 된다. 설치본으로 부르면 lockfile 이 버전의 단일 원천이 되고, 설치가 안 됐으면 조용히 다른 버전을 쓰는 대신 실패한다.
- **How to apply:** `package.json` 의 `devDependencies` 에 `@intellectronica/ruler` 를 넣는다. `prepare` 스크립트에 걸 때도 `pnpm exec ruler apply` 로 쓴다.

## `ruler apply` 는 저절로 돌지 않는다 — 소스를 고친 턴에 직접 돌린다

`prepare` 스크립트에 걸어 둔 apply 는 **install 할 때만** 돈다. 소스를 고쳤다고 돌지 않는다.

- **Why:** 생성물은 gitignore 되어 `git status` 에 뜨지 않는다. 안 돌려도 경고가 없고 리뷰에도 안 걸리므로, 다른 에이전트와 다음 세션이 낡은 지침을 최신인 줄 알고 주입받는다. 원칙과 나머지 근거는 `base` 스택 「생성물을 직접 편집하지 않는다」 절.
- **How to apply:** 저장소 루트에서 apply 를 돌린 뒤 `git status` 를 본다. 생성물은 ignore 되므로 **추적 파일 변경이 없어야 정상**이다(생성물 경로가 새로 생겼으면 `.gitignore` 블록만 바뀐다). 소스 변경만 커밋한다.
  ```bash
  pnpm exec ruler apply
  git status
  ```

## `.gitignore` 의 Ruler 블록은 손으로 고치지 않는다

생성물은 커밋하지 않고, `.gitignore` 의 `# START Ruler Generated Files` … `# END Ruler Generated Files` 블록이 가린다. 이 블록은 apply 가 갱신한다.

- **Why:** apply 가 블록 안을 다시 쓰므로 손으로 넣은 줄은 다음 apply 에서 사라진다.
- **How to apply:** 새 생성물 경로를 가려야 하면 소스(`.ruler/`)나 `ruler.toml` 을 고치고 apply 를 돌려 블록이 스스로 바뀌게 한다. 생성물이 아닌 파일을 가려야 하면 블록 **바깥**에 적는다.



<!-- Source: .ruler/ruler/99-reference.md -->

# ruler 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| 하위 디렉터리의 ruler 지침을 만들거나 옮기거나 지울 때 | `docs/guideline/ruler/01-nested.md` |
| 에이전트 지침이나 참조 문서를 새로 쓰거나 옮길 때 | `docs/guideline/ruler/02-documents.md` |



<!-- Source: .ruler/tiergear/00-switch.md -->

# tiergear 가 있을 때

## tiergear CLI 가 있으면 워커를 붙이기 직전에 `tiergear launch` 로 모델·effort 를 고른다

워커를 붙이는 명령(`worker-start` 등)을 부르기 직전에 `command -v tiergear` 를 본다. 있으면 그 워크트리에 floor 를 쓰고 모델·effort 를 받아, 붙이는 명령의 `--model`·`--effort` 에 넣는다.

```bash
tiergear launch --worktree <워크트리 경로> [역할 범위] -- "<브리프>"
# stdout: claude --model <모델> --effort <effort>
```

**바뀌는 것은 모델을 고르는 자리 하나뿐이다.** 워크트리를 만드는 법, 만든 직후의 세팅, 붙이는 법, 제출 확인, 수신 대기, 정리는 그 프로젝트가 쓰는 절차(`orca-worker` 스킬, 프로젝트 스크립트, 지침의 손 절차)를 그대로 따른다. 역할이 모델을 정하던 규칙은 역할이 tier 범위를 정하는 규칙이 된다(`01-launch.md`).

- **Why:** `tiergear launch --worktree` 는 판단기가 브리프를 읽고 고른 모델·effort 를 주고, 워커 세션 안의 플러그인이 그 범위 안에서만 tier 를 오르내리게 floor 파일을 써 둔다. floor 없이 붙이면 워커의 첫 턴은 브리프가 아니라 Orca 프리앰블로 판단돼 대개 확신도가 낮게 나오고, 역할로 정한 하한·상한도 세션 안에 남지 않는다.
- **How to apply:**
  - **tiergear 가 없는 머신에서도 돌아야 한다.** CLI 가 없거나 `tiergear launch` 가 실패하면 경고 한 줄을 내고 원래의 역할 기본 모델로 진행한다. 워커 기동을 막지 않는다.
  - 사람이 모델을 명시하면(`--model`) tiergear 를 부르지 않는다. 명시한 예외가 판단기를 이긴다.
  - 이미 도는 에이전트에 붙일 때(`--terminal`)는 모델을 바꿀 수 없으므로 부르지 않는다.
  - 워커를 띄우는 프로젝트 스크립트가 있으면 이 한 줄을 그 스크립트의 붙이기 직전에 넣는다. 범위·출력 읽기·테스트는 `01-launch.md` 를 읽는다.
  - `tiergear orca-spawn` 은 워크트리 생성과 붙이기를 한 번에 해서 그 사이의 세팅을 건너뛴다. 생성 직후 세팅이 없는 프로젝트에서만 쓴다(`02-orca-spawn.md`).



<!-- Source: .ruler/tiergear/99-reference.md -->

# tiergear 참조 지침

아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.

| 언제 | 읽을 파일 |
| --- | --- |
| tiergear launch 로 워커의 모델·effort 를 고르거나, 워커를 띄우는 절차·스크립트에 tiergear 를 끼울 때 | `docs/guideline/tiergear/01-launch.md` |
| 생성 직후 세팅이 없는 프로젝트에서 tiergear orca-spawn 으로 워커를 띄우거나, orca-spawn 이 실패했을 때 | `docs/guideline/tiergear/02-orca-spawn.md` |
