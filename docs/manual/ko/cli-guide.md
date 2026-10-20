<!-- source: docs/manual/en/cli-guide.md @ v0.6.0 -->

# ERDD CLI 매뉴얼

`erdd` 는 ERDD 서버의 스키마를 **코드베이스 안의 YAML 파일**로 내려받아 git 으로 버전 관리하고, 로컬에서 고친
것을 서버로 다시 올리는 명령줄 도구입니다. 이 문서는 코드와 함께 스키마를 다루는 개발자와, 그 파일을 읽고
고치는 AI 에이전트를 위한 매뉴얼입니다. 에디터 사용법은 [사용 매뉴얼](user-guide.md)을, 서버 설치·운영은
[설치·운영 매뉴얼](install.md)을 보세요. **서버 없이 파일만으로 쓰는 방법**은
[로컬 모드 매뉴얼](local-guide.md)이 처음부터 끝까지 다룹니다.

이 매뉴얼의 출력은 CLI 가 찍는 그대로 인용합니다.

**목차** — [1. 개요](#1-개요) · [2. 설치와 실행](#2-설치와-실행) · [3. 연결 — 서버 연결과 로컬 모드](#3-연결--서버-연결과-로컬-모드) · [4. 일상 워크플로](#4-일상-워크플로) · [5. 파일 구조와 포맷](#5-파일-구조와-포맷) · [6. 명령 레퍼런스](#6-명령-레퍼런스) · [7. 동기화와 충돌](#7-동기화와-충돌) · [8. 파일에 담기지 않는 것](#8-파일에-담기지-않는-것) · [9. AI 에이전트와 함께 쓰기](#9-ai-에이전트와-함께-쓰기) · [10. 자동화와 CI](#10-자동화와-ci) · [11. 문제 해결](#11-문제-해결) · [부록: 검증 상태](#부록-검증-상태)

---

## 1. 개요

**무엇** — 웹 UI 가 진실 원본인 ERD 모델을 로컬 파일과 양방향으로 동기화합니다.

```text
  [ ERDD server ]  ◀── push ──  erdd/*.yaml  ── git commit ──▶  [ Repository ]
  (source of truth) ── pull ──▶  (working copy)                  (review, history)
```

- **스키마 변경이 PR 리뷰에서 코드와 나란히 보입니다.** 테이블 하나가 파일 하나라 diff 를 읽을 수 있습니다.
- **AI 에이전트가 `erdd/` 를 읽고 DB 구조를 이해합니다.** 마이그레이션이나 ORM 코드를 뒤질 필요가 없습니다.
- **에이전트가 파일을 고쳐 `push` 하고, 설계자는 웹에서 이어서 다듬습니다.** push 는 웹 편집과 똑같이 리비전으로
  기록되고 실시간 채널로 방송됩니다.

**전제 셋.**

| 전제 | 뜻 |
|---|---|
| 서버가 진실 원본 | 로컬 파일은 작업 사본입니다. `pull` 은 로컬 파일을 서버 상태로 덮어씁니다. |
| 파일에는 **스키마의 의미 정보만** 담김 | 배치 좌표와 메모는 **스키마 파일**(`erdd/tables/*.yaml` 과 최상위 사전 파일)에 없습니다(→ [8절](#8-파일에-담기지-않는-것)). 공용 사전의 출처는 `erdd/origins.yaml` 에 따로 둡니다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)). |
| 모든 명령은 **현재 디렉터리에서** 동작 | `erdd.config.yaml` 이 있는 프로젝트 루트에서 실행하세요. |

**실행 방식은 둘이고, 위 전제의 앞 두 개는 「서버에 연결된 프로젝트」를 가정합니다.** `erdd serve` 로 여는
**로컬 모드**에는 서버도 계정도 DB 도 없고, `erdd/` 파일 자체가 진실 원본입니다. 브라우저에는 같은 웹 에디터가
보입니다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)). 배치 좌표와 메모는 `erdd/layout.yaml` 에 들어가고, 이것은
**모드와 무관합니다.** 서버에 연결된 프로젝트를 `erdd serve` 로 열어 편집해도 같은 파일에 쌓입니다
(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)).
**로컬 모드만 쓸 계획이면 이 문서 대신 [로컬 모드 매뉴얼](local-guide.md) 하나로 충분합니다.**

**MCP 서버는 없습니다.** 에이전트 연동은 이 CLI 와 동봉된 스킬 문서입니다(→ [9절](#9-ai-에이전트와-함께-쓰기)).

---

## 2. 설치와 실행

**방법은 셋이고 첫째가 기본입니다.** 아래 표에서 내 상황을 고르세요.

| 방법 | 언제 쓰나 | ERDD 저장소 체크아웃 |
|---|---|---|
| [A. npm 에서 설치](#22-방법-a-npm-에서-설치-권장) | **보통은 이쪽입니다.** 스키마를 둘 프로젝트에서 바로 씁니다 | **필요 없음** |
| [B. 저장소에서 직접 실행](#23-방법-b-저장소에서-직접-실행-설치-없음) | npm 에 닿을 수 없거나(오프라인) CLI 자체를 고치는 중 | 필요 |
| [C. 프로젝트에 의존성으로 링크](#24-방법-c-프로젝트에-의존성으로-링크) | CLI 를 고치고 소비자 프로젝트에서 바로 확인할 때 | 필요 |

### 2.1 요구 사항

| 항목 | 값 | 근거 |
|---|---|---|
| Node.js | **22 이상** | `mise.toml`, 그리고 **패키지가 강제합니다.** 두 패키지 모두 `engines.node: ">=22"` 라서 맞지 않는 Node 로 설치하면 패키지 매니저가 경고하거나 거부합니다 |
| 패키지 | `@erdd/cli`(바이너리 `erdd`) · 의존성 `@erdd/core` | `packages/cli/package.json` |
| 실행기 | `tsx`. **소비자가 직접 설치합니다** | 패키지에 원본 TypeScript 가 그대로 들어 있고, 바이너리의 shebang 이 `npx tsx` 입니다(아래 ⚠️) |
| ERDD 저장소 체크아웃 | **방법 B·C 에서만.** 방법 A 는 필요 없습니다 | |

⚠️ **패키지 매니저가 무엇이든 프로젝트에 `tsx` 를 더하세요.** 패키지에는 빌드 결과물이 아니라 **원본
TypeScript 가 그대로** 들어 있고, 바이너리의 shebang 은 `#!/usr/bin/env -S npx tsx` 입니다. **`@erdd/cli` 는
`tsx` 를 대신 끌어오지 않습니다.** 소비자가 자기 프로젝트에 선언해야 합니다.

**빠뜨렸을 때의 증상은 패키지 매니저마다 다릅니다.** shebang 이 `npx` 를 거치므로 **`npx` 가 `tsx` 를 그때그때
받아 와 대개 돌아갑니다**(다만 첫 실행이 느리고 레지스트리 접근에 기댑니다). 네트워크가 없으면 CLI 가 아니라
셸이 이렇게 끝냅니다.

```text
sh: tsx: command not found
# exit code 127: an error from the shell, not the CLI
```

평평한 npm 배치는 캐시가 없으면 `ENOTCACHED` 로 실패합니다. **될 때도 있고 안 될 때도 있으므로** 이 증상 하나만
보고 진단하면 헛돕니다(→ [11. 문제 해결](#11-문제-해결)).

**그래서 이 문서의 설치 명령에는 모두 `tsx` 가 들어 있습니다.** 그것이 **유일하게 보장된 길**입니다.

### 2.2 방법 A: npm 에서 설치 (권장)

`@erdd/cli` 와 `@erdd/core` 는 **공개 npm**(registry.npmjs.org)에 있습니다. 레지스트리 설정도 토큰도 필요
없습니다. 스키마를 둘 프로젝트에서 바로 설치하세요.

```bash
cd /path/to/my-project
pnpm add -D @erdd/cli tsx
pnpm exec erdd --help

# with npm
npm install -D @erdd/cli tsx
npx erdd --help
```

이렇게 하면 `node_modules/.bin/erdd` 가 생기고, `pnpm exec erdd …`(npm 이면 `npx erdd …`)로 부릅니다.
`@erdd/core` 는 의존성으로 들어오므로 따로 설치하지 않습니다.

**웹 번들이 패키지 안에 있습니다.** `erdd serve` 가 브라우저에 여는 에디터(`apps/web` 의 빌드 결과물)가 tarball
에 통째로 들어 있습니다. **npm 설치라면 웹 앱을 따로 빌드하지 않아도 `erdd serve` 가 그대로 뜹니다**
(→ [로컬 모드 매뉴얼 2.2](local-guide.md#22-경로-a-npm-에서-설치한다-권장)). 설치본은 애초에 저장소 배치
(`apps/web/dist`)를 가질 수 없으므로 늘 이 동봉본을 씁니다.

**문서도 함께 들어 있습니다.** 패키지 루트에 `README.md`(두 모드의 입구)가 있고, 이 매뉴얼과
[로컬 모드](local-guide.md)·[사용](user-guide.md)·[설치·운영](install.md) 매뉴얼까지 네 편이 언어별로
`node_modules/@erdd/cli/docs/en/`(영어)과 `node_modules/@erdd/cli/docs/ko/`(한국어)에 그대로 동봉돼 있습니다.
저장소를 클론하지 않아도 읽을 수 있고, 문서끼리의 상대 링크도 그대로 동작합니다.

### 2.3 방법 B: 저장소에서 직접 실행 (설치 없음)

**언제** — npm 에 닿을 수 없거나(오프라인), CLI 소스를 고치면서 바로 실행해 보고 싶을 때.

아무것도 설치하지 않습니다. **작업 중인 프로젝트 디렉터리에서** ERDD 체크아웃의 진입점을 가리켜 실행하세요.

```bash
cd /path/to/my-project
npx tsx /path/to/ERDD/packages/cli/src/main.ts status
```

경로가 길므로 셸 별칭을 두면 편합니다.

```bash
# ~/.zshrc or similar
alias erdd='npx tsx /path/to/ERDD/packages/cli/src/main.ts'
```

⚠️ **현재 디렉터리가 대상 프로젝트여야 합니다.** CLI 는 `erdd.config.yaml`, `erdd/`, `.erdd/` 를 모두
`process.cwd()` 기준으로 찾습니다. ERDD 저장소 안에서 실행하면 엉뚱한 곳을 봅니다.

⚠️ **이 방법으로 `erdd serve` 를 쓰려면 웹 앱을 한 번 빌드해야 합니다.** 체크아웃에는 번들이 없습니다.
`pnpm -C apps/web build` 를 실행하세요(→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)).

### 2.4 방법 C: 프로젝트에 의존성으로 링크

**언제** — CLI 를 고치면서 소비자 프로젝트에서 같은 `pnpm exec erdd …` 호출로 확인하고 싶을 때. 호출 형태는
레지스트리 설치와 같고, 코드는 로컬 체크아웃에서 옵니다.

이렇게 하면 `node_modules/.bin/erdd` 가 생기고 `pnpm exec erdd …` 로 부릅니다. **`tsx` 도 함께 더해야 합니다.**

```bash
cd /path/to/my-project
pnpm add -D /path/to/ERDD/packages/cli tsx
pnpm exec erdd --help
```

⚠️ **`tsx` 가 없으면 실행이 보장되지 않습니다.** `npx` 가 그 자리에서 받아 와 돌아갈 때도 있습니다. 네트워크나
캐시가 없으면 `sh: tsx: command not found`(종료 코드 127)나 `ENOTCACHED` 로 실패합니다(→ [2.1](#21-요구-사항)).

⚠️ **이 설치는 ERDD 저장소 원본 파일의 권한을 바꿉니다.** 패키지 매니저가 bin 진입점에 실행 비트를 붙이므로,
설치한 뒤 ERDD 체크아웃의 `git status` 에 `packages/cli/src/main.ts` 가 `old mode 100644 / new mode 100755` 로
보입니다. 커밋하지 마세요. `chmod 644 packages/cli/src/main.ts` 로 되돌리세요. 이 부작용이 싫으면
[방법 B](#23-방법-b-저장소에서-직접-실행-설치-없음)를 쓰세요.

### 2.5 실행 확인

```bash
$ erdd --help
사용법: erdd <명령> [옵션]

명령
  init         서버·토큰·프로젝트를 연결하고 erdd.config.yaml을 만든다
  pull         서버 스키마를 파일로 내려받는다
  push         로컬 파일의 변경을 서버에 반영한다
  diff         로컬 파일과 서버의 차이를 미리 본다
  status       연결 정보와 로컬 변경을 보여준다
  validate     서버 없이 파일을 검사한다
  export       로컬 파일을 DDL·DBML로 내보낸다(stdout 또는 -o 파일)
  import <파일> DDL·DBML 파일을 로컬 파일에 가져온다(머지 — 서버 반영은 push)
  serve        로컬 서버를 띄워 브라우저에서 편집한다(서버 연결 불필요)
  skill install 에이전트 스킬 문서를 프로젝트에 설치한다
  changes      변경 기록 상태 — 미기록 변경 미리보기(로컬 모드 전용)
  changes new <이름> 미기록 변경을 erdd/changes/ 에 기록한다
  dict <list|pull|push|requests>  공용 사전을 주고받는다
  library <list|export|import>  공용 라이브러리를 파일로 내보내고 가져온다(관리자)

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate·diff에서 경고·충돌도 실패로 본다
  -m, --message <요약>  push의 Revision 요약, dict push의 승격 요청 메모
  --dir <경로>          skill install 전용 — 설치 위치
  --force               skill install 전용 — 기존 파일 덮어쓰기
  --server <url>        init·library 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
  --create              init 전용 — 서버에 프로젝트를 만들어 연결한다(로컬 전용 프로젝트면 이관한다)
  --org <이름|id>        init --create 전용 — 프로젝트를 만들 조직
                        library import --create --scope org 전용 — 라이브러리를 만들 조직
  --case <대소문자>      init --local·--create 전용 — UPPER_SNAKE(기본) 또는 lower_snake
  --format <ddl|dbml>   export·import 전용 — export 기본 ddl, import 기본 확장자 판별
  --dialect <방언>       export·import·init --local·--create 전용
                        export·import는 기본이 erdd.config.yaml의 dialects[0], init --local·--create는 postgresql
  -o <경로>             export·library export 전용 — 산출물을 쓸 파일(없으면 stdout)
  --dry-run             import·dict pull·library import 전용 — 계획만 보고 파일을 쓰지 않는다
  --library <이름|id>   dict pull·push·library import 전용 — pull은 받을 라이브러리(구독에 없으면 더한다, 없으면 구독 전부)
                        push·library import 는 올릴/가져올 라이브러리
  --file <경로>          dict pull 전용 — 서버에서 내보낸 라이브러리 파일에서 받는다(서버 연결 불필요)
  --adopt               dict pull 전용 — 이름이 같은 로컬 항목에 출처를 연결한다(내용이 같을 때만)
                        내용이 달라도 로컬 값을 유지한 채 연결하려면 --conflicts ours 를 함께 준다
  --conflicts <theirs|ours>  dict pull 전용 — 충돌을 원본(theirs)·로컬(ours)로 정리한다(기본 보류)
  --kind <종류,…>        dict push 전용 — domain·word·term·customField 중 올릴 종류
  --create <이름>        library import 전용 — 새 라이브러리를 만들며 가져온다(init --create 와 다르다)
  --scope <global|org>  library import --create 전용
  --prune               library import 전용 — 파일에 없는 항목을 지운다(적힌 종류만)
  --include-stale       library import 전용 — 서버가 더 새로운 항목도 파일 값으로 덮는다
  --name <이름>          dict push 전용 — 올릴 항목 이름(반복 가능)
                        init --create 전용 — 서버에 만들 프로젝트 이름
  --include-name-match  dict push 전용 — 라이브러리에 같은 이름이 있는 항목도 올린다(기본 제외)
  --status <상태>        dict requests 전용 — pending·resolved·rejected·cancelled
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
  --check               changes 전용 — 미기록 변경이 있으면 종료 코드 1
  --baseline            changes new 전용 — 첫 기록을 「이미 DB 에 있음」으로 표시
  -v, --version         버전을 출력한다
  --help                이 도움말
```

명령과 옵션마다의 설명은 [6절](#6-명령-레퍼런스)에 있습니다. `--help` 와 `-h` 는 다른 어떤 인자보다 먼저
처리되고 늘 `0` 으로 끝납니다.

설치된 버전은 `--version`(`-v`)으로 확인하세요. 버전 문자열 한 줄만 stdout 에 찍고 `0` 으로 끝납니다. `--json`
을 주면 객체 하나를 찍습니다.

```bash
$ erdd --version
0.5.0
$ erdd --json --version
{"version":"0.5.0"}
```

`--version` 과 `-v` 는 **명령 자리(첫 인자)에서만** 버전으로 받습니다(`--json` 은 앞뒤 어디에 와도 됩니다).
명령 뒤에 쓴 `-v` 는 버전이 아닙니다. `erdd status -v` 는 `-v` 를 무시하고 status 를 그대로 실행하고,
`erdd export -o -v` 는 `-v` 라는 파일에 씁니다. `--help` 와 함께 주면 `--help` 가 이깁니다. 웹 화면 위쪽
워드마크 옆에 보이는 버전도 같은 값입니다.

---

## 3. 연결 — 서버 연결과 로컬 모드

### 3.1 개인 액세스 토큰 발급

**어디서** — 웹 `/settings`(사용자 메뉴 → **설정**)의 **액세스 토큰** 카드.

**어떻게** — **토큰 이름**에 알아볼 수 있는 이름(예: 「노트북」)을 입력하고 **발급**을 누르세요. 노란 상자에
값이 나오고, **복사**가 클립보드에 넣습니다. 화면의 세부는 [사용 매뉴얼 18절](user-guide.md#18-액세스-토큰)에
있습니다.

**제약 — 평문은 발급 직후 한 번만 보입니다.** 잃어버리면 찾는 것이 아니라 다시 발급합니다.

**권한은 새로운 축이 아닙니다.** 토큰의 권한은 **발급한 사용자의 조직·프로젝트 역할을 그대로 따릅니다.**
Viewer 가 만든 토큰은 Viewer 권한만 갖고, 그 사용자가 프로젝트 멤버에서 빠지면 토큰도 자동으로 그 프로젝트에
접근하지 못합니다. 토큰을 따로 폐기할 필요가 없습니다. 토큰은 만료되지 않고 폐기만 할 수 있습니다.

**토큰으로 부를 수 있는 서버 기능은 CLI 가 쓰는 것뿐입니다**: 연결과 동기화(`auth.me`, `org.list`,
`project.list`, `project.get`, `model.get`, `model.push`), 프로젝트 생성(`init --create` 용 `project.create`),
공용 사전(`erdd dict` 용 `resource.library.listForProject`, `resource.items.list`, `resource.promote`,
`promotion.create`, `promotion.listForProject`). 웹 UI 의 나머지 기능(내보내기, 스냅샷, 멤버 관리, 승격 요청 승인
등)은 세션 전용이라 토큰으로 부를 수 없습니다.

⚠️ **토큰은 발급한 사람이 웹에서 할 수 있는 모든 쓰기를 할 수 있습니다.** 조직 Owner/Admin 의 토큰은 조직에
**프로젝트를 만들고**(`erdd init --create`) **조직 라이브러리에 승인 없이 바로 올립니다**(`erdd dict push`).
서비스 관리자의 토큰은 전역 라이브러리에까지 씁니다. 에이전트와 CI 용 토큰은 **Editor 계정**에서 발급하세요.
그러면 `dict push` 가 승격 **요청**이 되고, 조직 관리자가 웹에서 승인해야 반영됩니다.

### 3.2 `erdd init`

프로젝트 루트에서 실행하세요. 대화형이면 차례로 묻습니다.

```bash
$ cd /path/to/my-project
$ erdd init
서버 URL을 입력하세요: https://erdd.example.com
액세스 토큰을 입력하세요: erdd_pat_…
조직을 고르세요
  1) 우리회사
  2) 개인
번호: 1
프로젝트를 고르세요
  1) 커머스
번호: 1
커머스에 연결했습니다. erdd pull로 스키마를 받으세요.
```

비대화형(CI, 에이전트)이면 세 값을 인자로 주세요. 하나라도 빠지면 종료 코드는 `2` 입니다.

```bash
erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --project 018f6b0e-… --json
```

**하는 일, 순서대로.**

1. `erdd.config.yaml` 이 이미 있으면 「덮어쓸까요?」 를 묻습니다(`--yes` 로 건너뜁니다. 거절하면 `1` 로 끝납니다).
2. **토큰이 실제로 동작하는지 `auth.me` 로 먼저 확인합니다.** 그래서 잘못된 토큰으로 config 를 만드는 일이 없습니다.
3. `--project` 가 없으면 조직을, 그다음 프로젝트를 고르게 합니다.
4. 프로젝트의 방언과 명명 규칙을 받아 `erdd.config.yaml` 을 씁니다.
5. 토큰을 `.erdd/credentials.json` 에 **파일 모드 `0600`** 으로 씁니다(기존 파일도 매번 좁힙니다).
6. `.gitignore` 에 `.erdd/` 한 줄을 더합니다(이미 있으면 그대로 둡니다).

**같은 서버의 같은 프로젝트에 다시 연결하면**(토큰만 바꿀 때 등) config 의 공용 사전 구독(`dictionaries`)이
이어집니다. 다른 프로젝트나 서버에 연결하면 서버 구독은 비워지지만, 파일 구독(`file` 이 있는 줄
→ [5.2](#52-erddconfigyaml))은 남습니다. 저장소 안의 파일이라 서버 연결과 무관하기 때문입니다.

**서버에 아직 프로젝트가 없으면 `--create` 로 만들어 연결하세요.** 조직 Owner/Admin 만 할 수 있습니다. 로컬
전용 프로젝트를 서버로 옮기는 것도 이 명령으로 합니다(→ [6.1](#61-erdd-init)).

```bash
$ erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --create --org 플랫폼팀 --name 주문시스템 --yes
서버 프로젝트 주문시스템을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.
```

### 3.3 토큰을 두는 곳

| 위치 | 우선순위 | 쓰임 |
|---|---|---|
| 환경 변수 `ERDD_TOKEN` | **높음** | CI, 컨테이너. 빈 문자열은 설정하지 않은 것으로 봅니다. |
| `.erdd/credentials.json` | 낮음 | `init` 이 저장합니다. git 에서 무시됩니다. |

환경 변수가 있으면 파일은 읽지 않습니다. **`erdd.config.yaml` 은 커밋되고** 토큰을 담지 않으므로, 저장소를
클론한 팀원은 자기 `ERDD_TOKEN` 만 주면 됩니다(`init` 을 다시 할 필요가 없습니다).

### 3.4 로컬 모드 — 서버 없이 쓰기

**서버도 계정도 DB 도 없이** `erdd/` 파일만으로 같은 웹 에디터를 엽니다. 붙을 서버가 없거나, 저장소 안에서
혼자 스키마를 그리고 싶을 때 쓰세요. **이 절은 CLI 쪽에서 알아야 할 것만 다룹니다.** 준비(웹 번들 빌드),
브라우저에서 되는 것과 없는 것, 파일과 git, 스냅샷은 [로컬 모드 매뉴얼](local-guide.md)에 있습니다. 명령
옵션의 세부는 [6.8](#68-erdd-serve)에 있습니다.

```bash
$ cd /path/to/my-project
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd serve
http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

**`init --local` 은 `erdd.config.yaml` 과 `.gitignore` 의 `.erdd/` 한 줄만 만듭니다.** `erdd/` 디렉터리는
만들지 않습니다(브라우저에서 처음 편집할 때 생깁니다). 토큰도 서버 왕복도 없습니다.

```yaml
serverUrl: null
projectId: null
dialects:
  - postgresql
namingRules:
  case: UPPER_SNAKE
  separator: _
  logicalSeparator: _
  maxLengthBytes: 30
  tablePhysicalTemplate: ""
  tableLogicalTemplate: ""
```

⚠️ **`--local` 은 `--yes` 를 줘도 덮어쓰지 않습니다.** `erdd.config.yaml` 이 이미 있으면
`erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` 로 멈춥니다(종료 코드 `1`). 되돌아갈 서버 프로젝트가
없으므로, 덮어쓰면 방언과 명명 규칙을 조용히 잃게 됩니다.

⚠️ **`erdd serve` 는 미리 빌드한 웹 번들을 정적 파일로 서빙하고, 저장소 배치에서는 그 번들을 한 번 빌드해야
합니다.** [npm 설치](#22-방법-a-npm-에서-설치-권장)라면 번들이 패키지에 들어 있으므로 할 일이 없습니다. 저장소
체크아웃(방법 B·C)에서 `apps/web/dist` 가 없으면 서버는 평소처럼 뜨지만 브라우저에는 에디터 대신 JSON 404 가
보입니다. ERDD 체크아웃에서 `pnpm -C apps/web build` 를 한 번 실행하세요
(→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)).
**저장소에서는 갓 빌드한 `apps/web/dist` 가 늘 이깁니다.** 릴리스를 준비하려고 `packages/cli/web` 에 사본을 만든
적이 있어도 화면은 최신 빌드를 계속 보여 줍니다.

**편집은 저장할 때까지 드래프트에 머뭅니다.** 화면에서 바꾼 것은 `.erdd/draft.json`(gitignore)에 자동으로
기록되고, **`Cmd+S`(또는 헤더의 저장)를 누를 때만** `erdd/` 에 써집니다. 버린 시도가 git diff 를 어지럽히지
않게 하기 위해서입니다. 저장하지 않은 편집은 `serve` 를 멈췄다 다시 띄워도 남습니다. 터미널, 에이전트,
`git pull` 이 파일을 고치면 화면이 **새로 고침 없이** 따라옵니다. 테이블을 옮기거나 메모를 만드는 것은
`erdd/layout.yaml` 에만 들어가므로 스키마 파일의 diff 를 어지럽히지 않습니다
(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)).
**파일이 깨지면 편집이 잠깁니다.** 위쪽에 빨간 배너가 나오고 하단 바가 **읽기 전용**으로 바뀌며, 파일을
고치면 자동으로 풀립니다(→ [로컬 모드 매뉴얼 4.5](local-guide.md#45-파일이-깨지면-편집이-잠긴다)).

**브라우저에 없는 것** — 로그인, 계정, 액세스 토큰. 홈, 조직, 프로젝트 목록, 관리자. 참여자(presence)와
실시간 커서. 공용 리소스, 승격 요청, 프로젝트 멤버. 그리고 **버전**의 **이력 탭**. 나머지 에디터 기능은 모두
그대로 있습니다(장별 대조 → [로컬 모드 매뉴얼 4.2](local-guide.md#42-사용-매뉴얼의-어느-장이-해당하나)).

**`pull`·`push` 와 함께 쓰기 — 두 형태는 배타적이지 않습니다.**

- 연결 설정이 없으면(`serverUrl` 과 `projectId` 가 `null`) `pull`, `push`, `diff` 가 이렇게 멈춥니다(`1`).

  ```text
  오류: erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요
  ```

- **연결 설정이 있는 프로젝트에서도 `erdd serve` 는 뜹니다.** 그때는 config 의 `projectId` 로 열리고, 로컬
  서버는 어느 쪽이든 **파일만** 봅니다. 서버와 주고받는 것은 여전히 `pull` 과 `push` 가 합니다. pull 한
  프로젝트를 `serve` 로 열어 시각적으로 확인·편집하고 `push` 하는 흐름이 그대로 됩니다. GUI 가 떠 있는 동안
  `erdd pull` 을 실행하면 감시가 잡아 화면이 따라옵니다.
- **로컬에서 시작한 프로젝트를 서버로 옮기는 것은 `erdd init --server … --create` 명령 하나입니다.** 서버에 빈
  프로젝트를 만들고 기준 시점을 **빈 모델**로 정하므로, `erdd/` 는 그대로이고 `erdd diff` 는 전부 추가로
  보여 주며 `erdd push` 가 올립니다(→ [6.1](#61-erdd-init)). ⚠️ **연결 설정을 손으로 적는 것으로는 부족합니다.**
  `push` 는 마지막 pull 기준 시점(`.erdd/base.json`)이 필요하므로
  `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` 로 멈추고, 그 상태에서 `pull` 을 실행하면 `erdd/` 가 서버의 빈 상태로 덮어써집니다. 프로젝트
  생성 권한이 없을 때의 수동 절차는 [로컬 모드 매뉴얼 7.2](local-guide.md#72-로컬로-시작한-프로젝트를-서버로-옮기기)에
  있습니다.

---

## 4. 일상 워크플로

```text
  erdd pull ──▶ edit erdd/ files ──▶ erdd validate ──▶ erdd diff ──▶ erdd push
      ▲          (editor, agent)       (no server)      (preview)       │
      └─────────────────── on conflict, pull and sort it out ◀─────────┘
```

```bash
erdd pull                      # get the latest schema (overwrites local changes)
$EDITOR erdd/tables/MBR.yaml   # edit
erdd validate                  # check referential integrity and naming rules without a server
erdd diff                      # preview changes to push · changes to pull · conflicts
erdd push -m "회원 등급 컬럼 추가"
git add erdd erdd.config.yaml && git commit -m "스키마: 회원 등급 컬럼"
```

- **`status` 는 서버를 부르지 않습니다.** 연결 정보와 로컬 변경 유무만 보여 줍니다(오프라인에서도 됩니다).
- **`validate` 도 서버를 부르지 않습니다.** 그래서 커밋 훅과 CI 에 잘 맞습니다.
- **`push` 가 성공하면 pull 을 한 번 더 자동으로 합니다.** 새로 만든 객체의 `id` 가 파일에 채워지고, 자동으로
  병합된 서버 쪽 변경도 함께 내려오므로 다음 `status` 가 바로 깨끗합니다.
- **커밋하는 것은 `erdd/` 와 `erdd.config.yaml` 입니다.** `.erdd/` 는 커밋하지 마세요.
- **로컬 모드에는 이런 왕복이 없습니다.** 저장이 곧 파일이고 커밋이 곧 이력입니다. `pull`·`diff`·`push` 대신
  `erdd serve` 를 띄워 둔 채 편집하고 `git commit` 하세요(→ [3.4](#34-로컬-모드--서버-없이-쓰기)).
- **`export` 와 `import` 도 서버를 부르지 않습니다.** `erdd/` 파일만 읽고 씁니다
  (→ [6.9](#69-erdd-export) · [6.10](#610-erdd-import-파일)). `import` 는 **파일만** 바꾸므로 서버 모드에서는
  `diff` → `push` 가 뒤따릅니다. 서버의 최신 상태를 내보내려면 `export` 앞에 `pull` 을 두세요.
- **조직 공용 사전(단어·용어·도메인·커스텀 항목)은 `erdd dict` 로 주고받습니다.** `dict pull` 로 받고, 새 단어는
  `push` 뒤에 `dict push` 로 공용 라이브러리에 올립니다(→ [6.11](#611-erdd-dict--공용-사전)). 서버에 연결된
  프로젝트에서만 됩니다.

---

## 5. 파일 구조와 포맷

### 5.1 디렉터리

```text
erdd.config.yaml            # server, project, dialects, naming rules          ← commit
erdd/                                                             ← commit
├─ tables/
│  ├─ MBR.yaml              # one table = one file, file name = physical name
│  └─ ORD.yaml
├─ groups.yaml              # table groups
├─ words.yaml               # word dictionary
├─ terms.yaml               # term dictionary
├─ domains.yaml             # domains (type standards)
├─ custom-fields.yaml       # custom field definitions
├─ origins.yaml             # shared dictionary sources, written by erdd dict and pull. Do not edit by hand (→ 5.8)
└─ layout.yaml              # layout coordinates and notes, read and written by erdd serve (→ 5.7)
.erdd/                                                            ← do not commit
├─ base.json                # the model at the last pull, the baseline for the 3-way merge
├─ sync.json                # { "revisionSeq": 42, "pulledAt": "…" }
├─ credentials.json         # { "token": "erdd_pat_…" }, mode 0600
└─ draft.json               # local mode's **unsaved edits** (the whole model). Removed on save
```

⚠️ **`.erdd/` 아래는 아무것도 고치지 마세요.** 병합 기준과 자격 증명이 들어 있습니다. 손상되면 `erdd pull` 로
다시 받으세요.

### 5.2 `erdd.config.yaml`

```yaml
serverUrl: https://erdd.example.com
projectId: 018f6b0e-0000-7000-8000-000000000001
dialects:
  - postgresql
  - oracle
namingRules:
  case: UPPER_SNAKE
  separator: _
  maxLengthBytes: 30
tableOptions:                               # optional; without it, all four dialects are empty strings
  postgresql: ""
  mysql: ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  oracle: ""
  mssql: ""
```

**`serverUrl` 과 `projectId` 는 선택입니다.** 둘 다 없으면(또는 `null` 이면) **로컬 전용 프로젝트**이고
`erdd serve` 로 엽니다. 그때는 서버가 필요한 명령인 `pull`, `push`, `diff` 만 종료 코드 `1` 로 멈춥니다
(→ [3.4](#34-로컬-모드--서버-없이-쓰기)). ⚠️ **둘 중 하나만 적혀 있으면 오타로 보고 거절합니다.** 삼켜 버리면
서버에 연결된 줄 알고 편집하다가 `push` 때에야 연결이 없다는 것을 알게 됩니다. 형식이 잘못된 `dialects` 나
`namingRules` 도 `1` 로 끝납니다.

**`pull` 은 방언과 명명 규칙을 매번 서버 값으로 덮어씁니다.** 이 값은 모델이 아니라 프로젝트 설정에 있지만,
`validate` 가 서버 없이 명명 경고를 내려면 로컬 사본이 필요합니다. 웹에서 이 설정을 바꾸면 **다음 `pull` 전까지
로컬 `validate` 결과가 서버와 다를 수 있습니다.**

**`tableOptions` 는 DDL 을 내보낼 때 `CREATE TABLE` 의 닫는 괄호 뒤에 그대로 붙는 방언별 자유 문자열입니다.**
모든 테이블이 같은 값을 받고, 값은 검증하지 않습니다. 잘못 쓰면 그 방언의 DDL 이 실패하고, 실패가 바로
보입니다. **이 키가 없는 예전 config 는 네 방언 모두 빈 문자열로 열립니다**(필수로 하면 기존 사용자의 `pull` 이
깨집니다).

⚠️ **`pull` 은 `tableOptions` 도 서버 값으로 덮어씁니다.** 연결된 프로젝트에서 이 필드는 **서버의 거울**입니다.
로컬에서 고치면 다음 `pull` 이 지우고, `push` 는 모델만 보내므로 서버로 올라가지도 않습니다. 서버 쪽 값은 웹의
프로젝트 설정 화면에서 바꾸세요. 로컬 전용 프로젝트에서는 이 파일이 유일한 진실 원본입니다.

⚠️ **`COMMENT=` 를 쓰지 마세요.** 옵션은 테이블 코멘트 앞에 나가므로, DDL 을 다시 읽으면 파서가 그것을 테이블
코멘트로 읽습니다.

**`dictionaries` 는 공용 사전 구독입니다.** `erdd dict pull --library …` 가 라이브러리를 처음 받을 때 항목을
쓰고, 인자 없는 `erdd dict pull` 은 이 목록을 **적힌 순서대로** 처리합니다
(→ [6.11](#611-erdd-dict--공용-사전)).

```yaml
dictionaries:
  - id: 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
    name: 플랫폼팀 표준 사전      # for display; the next dict pull rewrites it if the name changes on the server
  - id: 01a0cf70-8bb2-7bf8-9635-821049933b45
    name: 데모 사전
    file: standard.erdd-lib.yaml  # if present, receive from this distribution file instead of the server (erdd dict pull --file)
```

- 구독이 없으면 키 자체를 쓰지 않습니다. 키가 없거나 값이 비어 있으면(`dictionaries:`) 구독 0개입니다.
- `pull`, `push`, `init`(같은 프로젝트에 다시 연결)이 config 를 다시 써도 구독은 남습니다.
- 모양이 틀리면(`{id, name, file?}` 목록이 아니면) 종료 코드는 `1` 입니다:
  `erdd.config.yaml의 dictionaries는 {id, name, file?} 목록이어야 합니다`. 같은 id 가 두 번 나와도 `1` 입니다:
  `erdd.config.yaml의 dictionaries에 같은 사전(<id>)이 두 번 있습니다`.
- 구독을 끝내려면 그 줄을 지우세요. 이미 받은 항목과 `origins.yaml` 의 출처는 남습니다.
- **`file` 은 `erdd dict pull --file <경로>` 가 파일을 처음 받을 때 써집니다.** 그 뒤로는 인자 없는
  `erdd dict pull` 도 서버 대신 이 경로의 파일에서 받습니다(→ [6.11 의 `--file`](#611-erdd-dict--공용-사전)).
  경로는 프로젝트 안의 POSIX 상대 경로이고 `erdd/` 아래일 수 없습니다. 키가 없으면 서버 구독과 같은 뜻입니다.
  손으로 고친 값도 이 규칙으로 다시 검사합니다. 어기면 `dict pull`, `dict list` 를 포함해 config 를 읽는 모든
  명령이 종료 코드 `1` 로 멈춥니다:
  `erdd.config.yaml의 dictionaries(<id>).file 이 규칙을 어깁니다 — …`.

### 5.3 테이블 파일

```yaml
id: 018f6b0e-…                             # UUIDv7, issued by the CLI. Do not change or delete it
name: MBR                                  # physical name (= file name)
logicalName: 회원
group: 회원관리                             # group name from groups.yaml
comment: 서비스 가입 회원
custom:
  개인정보여부: 'true'
columns:
  - id: 018f6b0e-…
    name: MBR_NO
    logicalName: 회원번호
    type: BIGINT
    pk: true
    nullable: false
  - id: 018f6b0e-…
    name: MBR_NM
    logicalName: 회원명
    domain: 명                              # domain name from domains.yaml
    type: VARCHAR(100)
    nullable: false
indexes:
  - id: 018f6b0e-…
    name: UX_MBR_01
    columns: [MBR_NM]                       # for descending, one string such as "MBR_NM DESC"
    unique: true
relations:
  - id: 018f6b0e-…
    to: MBR_GRD                             # physical name of the parent table
    columns: { MBR_GRD_CD: GRD_CD }         # { child column: parent column }
    identifying: false
```

**필드.**

| 위치 | 키 | 뜻 | 생략하면 |
|---|---|---|---|
| 테이블 | `id` · `name` · `logicalName` · `group` · `comment` · `custom` | 물리명, 논리명, 그룹 이름, 설명, 커스텀 값 | `id` 가 없으면 새것, 나머지는 빈 값 |
| 컬럼 | `id` · `name` · `logicalName` · `domain` · `type` | 이름과 타입 | — |
| 컬럼 | `pk` | 기본 키 | `false` |
| 컬럼 | `autoIncrement` | 자동 증가 | `false` |
| 컬럼 | `nullable` | NULL 허용 | **`true`** |
| 컬럼 | `default` · `comment` · `custom` | 기본값, 설명, 커스텀 값 | 없음 |
| 인덱스 | `name` · `columns` | 이름과 컬럼 목록 | — |
| 인덱스 | `unique` | 고유 | `false` |
| 관계 | `to` · `columns` | 부모 테이블 물리명, 컬럼 매핑 | — |
| 관계 | `name` | 제약 이름 | 없음 |
| 관계 | `identifying` | 식별 관계 | `false` |
| 관계 | `cardinality` | `1:1` 또는 `1:N` | **`1:N`** |

**기본값과 같은 값은 파일에서 뺍니다.** `pull` 이 그렇게 쓰므로 diff 가 조용합니다. 명시적으로 써도 똑같이
동작합니다.

**규칙 넷.**

1. **컬럼 순서가 모델의 순서입니다.** 파일에 적힌 순서가 컬럼 순서가 됩니다.
2. **관계는 자식 테이블의 파일에만 쓰세요.** `to` 가 부모를 가리킵니다.
3. **인덱스 컬럼의 방향은 이름 뒤에 붙이세요.** `MBR_NM`(오름차순) · `MBR_NM DESC`. `ASC`/`DESC` 는 대소문자를
   가리지 않고, 오름차순은 생략하는 것이 표준입니다.
4. **도메인이 있어도 `type` 을 쓰세요.** 모델은 실제로 둘 다 갖습니다. 실효 타입은 도메인이 우선하고 `type` 은
   참고값입니다. 하나만 남기면 왕복에서 다른 하나를 잃습니다.

**파일 이름은 정체성이 아닙니다.** 물리명이 바뀌면 `pull` 이 파일 이름을 고칩니다. 테이블 이름을 바꾸려면 파일
이름이 아니라 파일 안의 `name` 을 고치세요. 물리명이 **대소문자만 다른** 테이블이 둘 이상이면(macOS 와
Windows 에서 파일 이름이 부딪칩니다) 그 테이블에만 `MBR.1a2b3c4d.yaml` 처럼 id 의 마지막 8자가 붙습니다.

### 5.4 사전·정의 파일

```yaml
# erdd/groups.yaml
groups:
  - { id: 018f…, name: 회원관리, color: '#4f46e5', comment: 회원 도메인 }

# erdd/words.yaml: logical name fragment → abbreviation
words:
  - { id: 018f…, logicalName: 회원, abbreviation: MBR, englishName: member, description: … }

# erdd/terms.yaml: logical name → physical name (can also bind a domain)
terms:
  - { id: 018f…, logicalName: 회원번호, physicalName: MBR_NO, domain: 번호, description: … }

# erdd/domains.yaml: type standards
domains:
  - id: 018f…
    name: 명
    category: 문자
    logicalType: VARCHAR
    dialectTypes: { postgresql: varchar(100), mysql: null, oracle: VARCHAR2(100), mssql: null }
    defaultValue: null
    allowedValues: []
    description: 사람·사물의 이름

# erdd/custom-fields.yaml: custom field definitions
customFields:
  - id: 018f…
    name: 개인정보여부
    target: column        # table | column
    type: boolean         # text | boolean | select
    options: []           # options when type: select
    required: false
    defaultValue: null
    order: 0
```

### 5.5 이름으로 참조되는 것은 유일해야 한다

파일 안의 참조는 사람이 읽을 수 있는 **이름**으로 씁니다. 그래서 다음 셋의 중복은 오류입니다.

| 이름 | 참조하는 곳 | 중복일 때 메시지 |
|---|---|---|
| 그룹 이름 | 테이블의 `group` | `그룹 이름 X가 중복됩니다 — 이름으로 참조되므로 유일해야 합니다` |
| 도메인 이름 | 컬럼·용어의 `domain` | `도메인 이름 X가 중복됩니다 — …` |
| 테이블 물리명 | 관계의 `to` | `테이블 물리명 X가 중복됩니다 — 관계가 이름으로 참조하므로 유일해야 합니다` |

대상이 없는 것도 오류입니다: `그룹 X을 찾지 못했습니다`, `도메인 X을 찾지 못했습니다`,
`관계의 부모 테이블 X을 찾지 못했습니다`, `인덱스 컬럼 X을 찾지 못했습니다`.

### 5.6 `id` 취급 — 가장 흔한 사고

- **`id`(UUIDv7)가 정체성입니다.** 바꾸거나 지우지 마세요. 이름이 바뀌어도 `id` 가 같으면 「삭제 + 추가」가
  아니라 「수정」으로 인식됩니다.
- **새로 만드는 객체에는 `id` 를 아예 쓰지 마세요.** **id 는 서버가 아니라 CLI 가 발급합니다.** 서버 모드에서는
  `push` 가 하고(→ [7.4](#74-push-가-정상으로-끝나지-않는-세-가지)), `erdd serve` 로 열면 로컬 저장소가 uuidv7 을
  만들어 파일에 채웁니다.
- ⚠️ **파일을 복사해 새 테이블을 만들 때는 `id` 를 모두 지우세요.** 테이블의 것만이 아니라 컬럼·인덱스·관계의
  것까지입니다. 남겨 두면 「새 테이블 만들기」가 아니라 **「원본을 사본의 내용으로 덮어쓰기」**가 됩니다. 같은
  `id` 가 두 번 나오면 **`erdd validate` 가 종료 코드 `1` 로 막고**(서버를 부르지 않으므로 두 모드 모두에
  해당합니다), 서버 모드에서는 `diff` 와 `push` 의 계획 단계도 막습니다.

  ```text
  id 018f…가 erdd/tables/MBR.yaml에도 있습니다 — 복사해서 새로 만든 것이라면 id를 지우세요(그대로 두면 원본을 덮어씁니다)
  ```

- ⚠️ **YAML 앵커와 별칭(`&name` … `*name`)은 지원하지 않습니다.** 두 항목이 조용히 하나로 합쳐지므로 오류로
  막습니다. 별칭을 풀어 항목마다 내용을 적으세요.

### 5.7 `erdd/layout.yaml` — 배치 좌표와 메모

**`erdd serve` 가 모드와 무관하게 읽고 씁니다.** 서버에 연결된 프로젝트를 `serve` 로 열어 테이블을 옮기거나
메모를 써도 이 파일이 만들어지고 갱신됩니다. 다만 **서버와 오가지 않습니다.** `pull` 과 `push` 는 이 파일을
보내지도 받지도 않습니다(→ [8절](#8-파일에-담기지-않는-것)). 배치는 팀이 함께 보는 그림의 일부이므로
커밋합니다.

```yaml
tables:
  - id: 01a01f7c-2227-70a0-ab77-d25ec5315f11
    name: MBR
    position:
      x: 431
      y: 362.5
    groupPosition: null
notes:
  - id: 01a01f80-f89f-7741-b076-c24985eeed41
    content: 메모
    position:
      x: 547
      y: 394
    color: "#FDF6E3"
```

- **테이블을 옮기면 이 파일만 바뀝니다.** `erdd/tables/*.yaml` 은 한 글자도 바뀌지 않습니다. 좌표를 스키마
  파일에서 뺀 본래 이유(옮기기만 해도 diff 가 생기는 것)를 지키려고 파일을 나눴습니다.
- **항목은 `id` 로 식별합니다.** `name` 은 사람이 읽으라고 있는 것이라 대조에 쓰지 않으므로, 물리명을 바꿔도
  배치가 따라갑니다. 모델에 없는 `id`(지운 테이블의 흔적)는 조용히 버립니다.
- **항목이나 파일 전체가 없으면 테이블이 물리명 순으로 격자에 놓입니다.** `erdd pull` 로 받은 프로젝트도 좌표
  파일 없이 열립니다. 나중에 에디터의 **자동 정렬**로 다듬으세요.
- ⚠️ **파일 전체가 파싱되지 않으면 다른 `erdd/` 파일과 똑같이 편집이 잠깁니다.** 이 파일은 좌표뿐 아니라
  **메모의 글**도 들고 있으므로, 깨진 채로 열어 두면 다음 저장이 `notes: []` 로 메모를 지웁니다. 빨간 배너
  (`파일을 읽을 수 없어 편집이 잠겼습니다 — erdd/layout.yaml: …`)가 나오고, 파일을 고치면 풀립니다
  (→ [3.4](#34-로컬-모드--서버-없이-쓰기)).
- **항목 하나가 깨진 것은 다릅니다.** 좌표가 숫자가 아니거나 필드가 빠진 **그 항목만** 걸러지고(그 테이블은
  격자에 놓입니다) 나머지는 그대로 열립니다. 파일이 없거나 비어 있는 것도 손상이 아닙니다.

### 5.8 `erdd/origins.yaml` — 공용 사전 출처

공용 사전에서 받은 항목마다 **어느 라이브러리의 어느 항목, 어느 버전에서 왔는지**를 기록하는 파일입니다.
`erdd dict pull` 과 `dict push` 가 쓰고, `pull` 과 `push` 가 서버와 주고받습니다. **커밋합니다.**

```yaml
origins:
  - id: 01a0cc5f-58b5-712a-8cd1-8fcda45c2b5c      # this project's word id (the id in words.yaml)
    kind: word                                    # domain | word | term | customField
    library: 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341 # library id
    item: 01a0cc5e-eedc-7919-8f5d-f0301716e827    # library item id
    version: 1                                    # version of the item received
    base:                                         # value at the time it was received; the reference for "did I change it"
      description: null
      englishName: Customer
      logicalName: 고객
      abbreviation: CUST
```

(주석은 설명용입니다. 실제 파일에는 주석이 없습니다.)

- ⚠️ **손으로 고치지 마세요.** 사전 파일(`words.yaml` 등)의 값을 고치는 것은 괜찮습니다. 그러면 `base` 와
  달라져 「프로젝트가 바꾼 항목」이 되고, 원본이 바뀌면 `dict pull` 이 충돌로 알립니다. 용어의 `base.domainId`
  는 이름이 아니라 **이 프로젝트의 도메인 id** 입니다(기계용 파일이라 id 를 씁니다).
- **사전 파일에서 항목을 지우면 그 출처 줄은 조용히 무시되고 다음에 쓸 때 정리됩니다.** 오류가 아닙니다.
- **출처가 0개면 파일이 없습니다.** 파일이 없는 것도 출처 0개라는 뜻입니다.
- **이 파일에서 줄을 지우고 `push` 하면 서버의 출처도 빠집니다.** 파일이 진실입니다. 그래서 `push` 가 확인 전에
  한 줄로 알려 줍니다(→ [6.6](#66-erdd-push)). 의도하지 않았다면 `erdd pull` 로 되살리세요.
- **형식이 틀리면 파일 오류입니다.** `serve` 는 편집을 잠그고, `push` 와 `dict` 는 거절하며, `erdd validate` 가
  그 자리를 가리킵니다. 틀린 줄은 `origins[i]` 번호로 알려 줍니다.

  | 메시지 | 원인 |
  |---|---|
  | `origins[N]의 형식이 올바르지 않습니다 — id·kind·library·item·version(정수)·base(객체)가 필요합니다` | 키가 빠졌거나, `kind` 가 넷 중 하나가 아니거나, `version` 이 정수가 아님 |
  | `origins[N]가 객체가 아닙니다` | 목록 원소가 객체가 아님 |
  | `id <id>의 출처가 두 번 적혀 있습니다` | 같은 항목의 줄이 둘 |
  | `id <id>의 kind가 word로 적혀 있지만 실제로는 term입니다` | `kind` 가 실제 항목 종류와 다름 |

---

## 6. 명령 레퍼런스

**공통 옵션.**

| 옵션 | 뜻 |
|---|---|
| `--json` | stdout 에 JSON 블록 하나. 진행 메시지와 프롬프트는 stderr 로 갑니다. |
| `--yes` | 확인 프롬프트를 건너뜁니다(비대화형에서 필수). |
| `--strict` | `validate` 는 경고를, `diff` 는 충돌을 실패로 봅니다. 다른 명령에는 효과가 없습니다. |
| `--help`, `-h` | 도움말. 종료 코드는 늘 `0`. |
| `--version`, `-v` | stdout 에 버전 문자열만 찍습니다(`--json` 이면 `{"version": …}`). 종료 코드 `0`. 명령 자리(첫 인자)에서만 받습니다. 명령 뒤의 `-v` 는 버전이 아닙니다. |

**종료 코드.**

| 코드 | 뜻 |
|---|---|
| `0` | 성공 |
| `1` | 실패: 검증 실패, 충돌, 서버 오류, 사용자 취소, 설정 없음 |
| `2` | 사용법 오류: 모르는 명령, 필수 인자 누락 |

### 6.1 `erdd init`

서버·토큰·프로젝트를 연결합니다. → [3.2](#32-erdd-init)

| | |
|---|---|
| 전용 옵션 | `--server <url>` · `--token <token>` · `--project <id>` · `--local` · `--create` · `--org <이름\|id>` · `--name <이름>` · `--dialect <방언>` · `--case <UPPER_SNAKE\|lower_snake>` |
| 서버 호출 | `auth.me`, `org.list`·`project.list`(고를 때), `project.get`. `--create` 는 `auth.me`, `org.list`, `project.create` |
| 쓰는 파일 | `erdd.config.yaml` · `.erdd/credentials.json` · `.gitignore`. `--create` 는 `.erdd/base.json` 과 `.erdd/sync.json`(빈 기준 시점)을 더 씁니다 |

**`--local` 은 서버 연결 없이 로컬 전용 프로젝트를 만듭니다** → [3.4](#34-로컬-모드--서버-없이-쓰기).
서버를 전혀 부르지 않고 `.erdd/credentials.json` 도 쓰지 않습니다(`erdd.config.yaml` 과 `.gitignore` 뿐).
다른 인자와 달리 **`--yes` 를 줘도 기존 config 를 덮어쓰지 않습니다.**

**`--dialect` 와 `--case` 는 `--local`·`--create` 전용입니다.** 로컬 전용 프로젝트에는 설정을 받아 올 서버가
없고, `--create` 는 서버에 만들 값을 정해야 하므로 이 둘만 여기서 정합니다. 나머지 명명 규칙(`separator`,
`logicalSeparator`, `maxLengthBytes`, 템플릿)은 기본값으로 시작하고, `erdd.config.yaml` 을 직접 고쳐 바꿉니다.

| 옵션 | 기본값 | 값 |
|---|---|---|
| `--dialect` | `postgresql` | `postgresql` · `mysql` · `oracle` · `mssql` |
| `--case` | `UPPER_SNAKE` | `UPPER_SNAKE` · `lower_snake` |

```bash
$ erdd init --local --dialect mysql --case lower_snake
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요

$ cat erdd.config.yaml
serverUrl: null
projectId: null
dialects:
  - mysql
namingRules:
  case: lower_snake
  separator: _
  logicalSeparator: _
  maxLengthBytes: 30
  tablePhysicalTemplate: ""
  tableLogicalTemplate: ""
```

⚠️ **기존 프로젝트에 연결할 때(`--local`·`--create` 없이) 이 둘을 주면 사용법 오류(`2`)입니다**:
`--dialect·--case는 init --local·--create 전용입니다 — 기존 프로젝트에 연결할 때는 서버 프로젝트 설정을 따릅니다`.
서버 프로젝트의 방언과 명명 규칙이 진실 원본이라, 여기서 준 것은 첫 `pull` 이 곧바로 덮어쓰기 때문입니다.

#### `--create` — 서버에 프로젝트를 만들어 연결한다

```bash
erdd init --server <url> --token <token> --create --org <organization name|id> --name <project name> [--yes]
```

**조직 Owner/Admin 만 할 수 있습니다**(웹에서 프로젝트를 만들 수 있는 사람과 같습니다). 시작 상태에 따라 셋으로
갈립니다.

| 시작 상태 | 하는 일 |
|---|---|
| `erdd.config.yaml` 없음 | 서버에 빈 프로젝트를 만들고(`--dialect` 와 `--case` 가 생성 값. 기본 `postgresql`·`UPPER_SNAKE`) 연결합니다. `erdd/` 가 비어 있으면 빈 사전 파일 다섯 개도 씁니다. 빈 서버를 pull 한 것과 같은 상태입니다 |
| **로컬 전용 config**(`serverUrl: null`): **이관** | 확인을 받은 뒤 로컬 config 의 방언·명명 규칙·테이블 옵션으로 서버 프로젝트를 만들고, `serverUrl` 과 `projectId` 를 채워 config 를 다시 씁니다(구독은 그대로). **`erdd/` 는 한 바이트도 건드리지 않습니다** |
| 이미 서버에 연결된 config | 기존 서버 프로젝트가 고아가 되지 않도록 거절합니다(`1`) |

**기준 시점은 빈 모델입니다.** `push` 가 요구하는 기준 시점(`.erdd/base.json`)을 `pull` 없이 세우므로, `erdd/` 에
파일이 있으면(이관, 또는 config 만 없던 디렉터리) **다음 `erdd diff` 가 전부 추가로 보여 주고 `erdd push` 가
올립니다.** 그때는 안내 메시지도 다릅니다.

```bash
# empty directory
$ erdd init --server http://127.0.0.1:3004 --token "$T" --create --org 플랫폼팀 --name 스모크 --yes
서버 프로젝트 스모크을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.

# local-only project (two words in erdd/words.yaml)
$ erdd init --server http://127.0.0.1:3004 --token "$T" --create --org 플랫폼팀 --name 이관 --yes
서버 프로젝트 이관을(를) 만들어 연결했습니다. erdd diff로 확인한 뒤 erdd push로 올리세요.
$ erdd diff
올릴 변경 2건
  + 단어 결제
  + 단어 고객

내려올 변경 없음

충돌 없음
$ erdd push -m 이관
반영했습니다 (리비전 1, 변경 2건)
```

- **이관은 확인을 받습니다**: `이 로컬 프로젝트를 서버 프로젝트 "이관"로 연결합니다. 계속할까요? [y/N]`.
  `--yes` 로 건너뜁니다. 비대화형(`--json`)에서 `--yes` 가 없으면
  `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` 로 실패합니다(`1`).
- **이관은 저장된 파일만 올립니다.** `erdd serve` 에 저장하지 않은 편집이 있으면 메시지 앞에
  `⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 나옵니다.
- 이관 직후 `erdd status` 가 `erdd/` 에 없던 빈 사전 파일을 `-` 로 보여 줄 수 있습니다. 내용이 빈 목록이라
  `diff` 와 `push` 에 영향이 없고, `push` 한 번이면 사라집니다.
- `erdd/layout.yaml`(배치 좌표와 메모)은 서버로 올라가지 않습니다. 서버 쪽 배치는 웹 에디터의 **자동 정렬**로
  새로 잡으세요.
- `--org` 는 조직 이름이나 id 입니다. 없으면 대화형으로 고릅니다. 비대화형이면 사용법 오류(`2`)입니다:
  `--org를 주거나 대화형으로 실행하세요`. `--name` 이 없으면 `서버에 만들 프로젝트 이름을 입력하세요` 로 묻습니다.
  공백뿐인 이름은 `프로젝트 이름이 비었습니다` 입니다(`2`).
- 서버가 CLI 보다 오래돼 토큰으로 프로젝트를 만들 수 없으면 `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요`
  로 멈추고(`1`) 로컬에는 아무것도 쓰지 않습니다. 토큰을 다시 발급해도 소용없습니다.
- `--create` 는 `--project` 나 `--local` 과 함께 쓸 수 없습니다(`2`). **이관할 때는 `--dialect` 나 `--case` 도 줄
  수 없습니다**(`2`): `로컬 프로젝트를 이관할 때는 erdd.config.yaml의 방언·명명 규칙을 씁니다 — --dialect·--case를 빼세요`.
- 로컬 config 의 명명 규칙이나 테이블 옵션이 서버의 형식에 맞지 않으면 **서버를 부르기 전에** 멈추고(`1`)
  `erdd.config.yaml의 namingRules.case가 올바르지 않습니다` 처럼 키를 가리킵니다. `erdd/` 의 YAML 이 깨져
  있어도 서버를 부르기 전에 멈춥니다. 반쯤 만들어진 서버 프로젝트를 남기지 않기 위해서입니다.

**막히는 경우.**

| 상황 | 메시지 | 종료 코드 |
|---|---|---|
| 권한 없음(새 디렉터리) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 erdd init --project <id> 로 연결하세요` | `1` |
| 권한 없음(이관) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요` | `1` |
| 이미 연결됨 | `이미 서버 프로젝트에 연결돼 있습니다 — 다른 프로젝트로 바꾸려면 erdd init --project <id> --yes` | `1` |
| 조직을 찾을 수 없음 | `조직 <이름>을(를) 찾지 못했습니다` | `1` |
| 같은 이름의 조직이 여럿 | `이름이 <이름>인 조직이 여럿입니다 — id로 지정하세요` | `2` |

권한이 없을 때 이관 메시지가 `--project` 연결을 권하지 않는 것은, 그 연결에는 빈 기준 시점이 없어 다음 `pull`
이 `erdd/` 를 서버의 빈 상태로 덮어쓰기 때문입니다. 수동 절차는
[로컬 모드 매뉴얼 7.2](local-guide.md#72-로컬로-시작한-프로젝트를-서버로-옮기기)에 있습니다.

`--json` 은 `{ configPath, projectId, projectName, migrated, hasLocalFiles }` 를 찍습니다. `migrated` 는 로컬
전용 config 를 이관했는지, `hasLocalFiles` 는 `erdd/` 에 올릴 파일이 있었는지(즉 다음에 `diff`·`push` 할 것이
있는지)를 알려 줍니다.

### 6.2 `erdd pull`

서버 스키마를 파일로 내려받습니다. **로컬 변경을 덮어씁니다.**

```bash
$ erdd pull
커머스: 테이블 24개를 받았습니다 (리비전 42)
```

로컬 변경이 있으면 먼저 목록을 보여 주고 확인을 받습니다.

```text
로컬 변경 2건이 덮어쓰기 됩니다:
  erdd/tables/MBR.yaml
  erdd/words.yaml
계속할까요? [y/N]
```

거절하면 `사용자가 취소했습니다` 와 종료 코드 `1` 입니다. `--yes` 로 건너뜁니다. 비대화형(`--json`)에서
`--yes` 가 없으면 물을 수 없으므로 `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` 로 멈춥니다
(코드 `CANCELLED`, 종료 코드 `1`).

⚠️ **기준 시점(`.erdd/base.json`)이 없어도 `erdd/` 에 파일이 있으면 묻습니다.** 저장소를 클론한 직후나 연결
설정만 적은 직후가 그렇습니다. 비교할 기준이 없으므로 `erdd/` 의 **모든** 파일이 덮어쓸 변경으로 보입니다.
`erdd/` 가 비어 있을 때(진짜 첫 `pull`)만 묻지 않습니다.

```text
$ erdd pull
로컬 변경 6건이 덮어쓰기 됩니다:
  erdd/custom-fields.yaml
  erdd/domains.yaml
  erdd/groups.yaml
  erdd/origins.yaml
  erdd/terms.yaml
  erdd/words.yaml
계속할까요? [y/N]
```

클론한 파일이 서버와 같다면 `--yes` 로 받아도 잃는 것이 없습니다(받은 뒤 `erdd status` 가 「로컬 변경 없음」 을
알립니다). **로컬 전용으로 만든 스키마를 서버에 붙이는 중이라면 `pull` 하지 마세요.** 서버가 비어 있으면 그
스키마가 지워집니다. `erdd init --create` 를 쓰세요(→ [6.1](#61-erdd-init)).

**서버에서 사라진 테이블의 파일은 지웁니다.** 지우는 대상은 `erdd/tables/*.yaml` 중 서버에 없는 파일과, 최상위
파일 다섯 중 서버가 보내지 않은 것입니다.

⚠️ **`pull` 을 도중에 끊으면(Ctrl+C 등) 기준 시점이 트리보다 오래된 채로 남습니다.** 다음 `status` 가 손대지
않은 파일을 「로컬 변경」으로 잘못 알릴 수 있습니다. `erdd pull --yes` 를 한 번 더 실행하면 맞춰집니다.

`--json` 은 `{ revisionSeq, written, deleted, tables, warnings }` 를 찍습니다.

**공용 사전 출처(`erdd/origins.yaml`)도 받습니다.** 웹에서 가져오기나 승격을 하거나 승격 요청이 승인되면 서버
항목에 출처가 붙고, 다음 `pull` 이 그것을 `origins.yaml` 에 씁니다
(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)).

### 6.3 `erdd status`

**서버를 부르지 않습니다.** 연결 정보와 로컬 변경만 보여 줍니다.

```bash
$ erdd status
서버   https://erdd.example.com
프로젝트 018f6b0e-0000-7000-8000-000000000001
마지막 pull 리비전 42 (2026-08-14T05:12:33.109Z)
로컬 변경 2건
  + erdd/tables/CPN.yaml
  M erdd/tables/MBR.yaml
```

연결 설정이 없는 로컬 전용 프로젝트에서는 앞 두 줄이 이렇게 바뀝니다.

```bash
$ erdd status
서버   (로컬 전용 — 연결 설정 없음)
프로젝트 (로컬 전용)
아직 pull하지 않았습니다
로컬 변경 없음
```

그때 `--json` 은 `"serverUrl": null, "projectId": null` 을 찍습니다.

⚠️ **로컬 전용 프로젝트에서는 「로컬 변경 없음」 이 영원히 그대로입니다.** 비교 기준인 `.erdd/base.json`(마지막
pull 시점)이 애초에 만들어지지 않으므로 `status` 는 변경 계산을 통째로 건너뜁니다. 무엇을 바꿨든 「로컬 변경
없음」 과 종료 코드 `0` 을 알립니다. **로컬 모드에서는 변경을 `git status` 와 `git diff` 로 보세요.**

`+` 추가 · `M` 수정 · `-` 삭제. 아직 pull 하지 않았으면 「아직 pull하지 않았습니다」 가 나오고 변경은 「로컬 변경
없음」 으로 알립니다. 비교는 **키 순서와 무관하게 값으로** 하므로, 키 순서만 바뀌어 YAML 이 다시 쓰인 파일은
수정으로 세지 않습니다.

### 6.4 `erdd validate`

**서버를 부르지 않고** 로컬 파일만 검사합니다. 커밋 훅과 CI 에 잘 맞습니다.

```bash
$ erdd validate
정합성 문제 없음
명명 경고 3건
  등록되지 않은 단어가 있습니다: 회원
  등록되지 않은 단어가 있습니다: 회원번호
  등록되지 않은 단어가 있습니다: 회원명
```

검사는 세 단계입니다.

| 단계 | 무엇을 | 실패하면 |
|---|---|---|
| 파싱 | YAML 구조, `id` 중복, 이름 참조 풀이 | 종료 코드 `1`, 파일마다 메시지 |
| 정합성 | 없는 테이블·그룹·도메인 참조 등 | 종료 코드 `1` |
| 명명 경고 | 아래 11종 | 기본 `0`, `--strict` 면 `1` |

**경고 종류** — 미등록 단어(`unknown-word`), 용어 불일치(`term-mismatch`), 물리명 길이 초과(`too-long`),
예약어(`reserved`), 물리명 중복(`duplicate-physical`, `duplicate-physical-table`), 관계 매핑 불완전
(`incomplete-mapping`), 관계 타입 불일치(`type-mismatch`), 필수 값 누락(`required-empty`), 필수 커스텀 항목
미입력(`custom-required`), 논리명 구분자 없음(`missing-logical-separator`).

명명 경고는 `erdd.config.yaml` 의 `namingRules` 와 `dialects` 로 계산합니다. 서버에서 그 설정이 바뀌었으면
결과가 서버와 맞도록 먼저 `pull` 하세요.

### 6.5 `erdd diff`

로컬과 서버의 차이를 **미리 봅니다.** **아무것도 쓰지 않습니다.**

```bash
$ erdd diff
올릴 변경 2건
  + 컬럼 MBR.MBR_GRD_CD
  M 테이블 MBR  설명: 회원 → 서비스 가입 회원

내려올 변경 1건
  M 컬럼 ORD.ORD_DT  타입: DATE → TIMESTAMP

충돌 없음
```

- **`push` 와 완전히 같은 병합 엔진을 씁니다.** 그래서 여기서 보는 것과 실제로 반영되는 것이 갈리지 않습니다.
- **늘 3-way 미리보기입니다.** 「마지막 pull 대비」 모드나 `--base` 플래그는 없습니다.
- **기본 종료 코드는 `0`**(정보 제공)입니다. `--strict` 면 충돌이 있을 때 `1` 입니다.
- 기준 시점(`.erdd/base.json`)이 없으면 서버를 부르기 전에 `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` 로
  멈춥니다.

### 6.6 `erdd push`

로컬 변경을 서버에 반영합니다.

```bash
$ erdd push -m "회원 등급 컬럼 추가"
반영했습니다 (리비전 43, 변경 2건)
```

| | |
|---|---|
| 전용 옵션 | `-m`, `--message <요약>`: 리비전 요약(최대 200자. 넘으면 잘립니다) |
| 서버 호출 | `model.get`(계획) → `model.push`(반영) → `project.get` + `model.get`(암묵적 pull) |

**요약이 없으면 자동으로 만듭니다.** 형태는 `CLI push (테이블 1건 · 컬럼 5건)` 입니다. `-m ""` 은 값을 주지 않은
것과 같이 보고 자동 요약으로 돌아갑니다.

**삭제가 있으면 목록을 보여 주고 확인을 받습니다.**

```text
삭제 2건이 서버에 반영됩니다:
  - 컬럼 MBR.MBR_TEL
  - 인덱스 IX_MBR_02
계속할까요? [y/N]
```

참조가 끊겨 **병합이 대신 지우는 항목**이 있으면 이유가 다르므로 따로 나열합니다(참조 대상이 지워졌거나, 그룹이
지워져 참조가 풀린 경우).

```text
참조가 끊겨 함께 정리되는 항목 3건:
  - 컬럼 ORD.MBR_NO (참조 대상이 삭제됨)
  - 관계 ORD→MBR (참조 대상이 삭제됨)
  - 테이블 ORD (그룹이 삭제되어 참조를 해제함)
```

⚠️ **비대화형(`--json`)에서 삭제가 있으면 `--yes` 도 함께 줘야 합니다.** 아니면 이렇게 멈춥니다:
`확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요`(종료 코드 `1`).

**공용 사전 출처를 떼는 변경이 있으면 확인 전에 한 줄로 알립니다**(stderr). `erdd/origins.yaml` 에서 줄이 빠진
채로 `push` 하면 서버의 출처도 빠집니다. 파일이 진실이기 때문입니다.

```text
공용 사전 출처를 떼는 변경 1건이 포함됩니다 — 의도하지 않았다면 erdd pull 로 되돌리세요
```

막지는 않습니다(떼는 것이 의도일 수 있습니다). `--json` 성공 봉투의 `detachedOrigins` 가 그 수입니다(0 이어도
들어갑니다).

**막는 것 셋.**

| 상황 | 메시지 | 이유 |
|---|---|---|
| 충돌 | `충돌 N건 — push를 중단했습니다.` | 서버는 그대로 둡니다(→ [7절](#7-동기화와-충돌)) |
| `erdd/` 가 통째로 비었는데 기준 시점에는 파일이 있음 | `erdd/ 아래에 파일이 없습니다. 전체 삭제가 의도라면 파일을 개별로 지우고, 아니라면 erdd pull로 되돌리세요` | `rm -rf` 사고를 「전부 삭제」로 해석하지 않습니다 |
| 변경이 5,000건 초과 | `변경이 N건으로 한 번에 반영할 수 있는 5000건을 넘습니다. 나눠서 반영하세요` | 서버가 요청 하나에 받는 상한이고, push 는 나누지 않습니다 |

**성공하면 자동으로 pull 합니다.** 새 `id` 가 파일에 채워지고, 자동으로 병합된 서버 변경도 내려옵니다.

### 6.7 `erdd skill install`

동봉된 에이전트 스킬 문서를 프로젝트에 복사합니다. → [9절](#9-ai-에이전트와-함께-쓰기)

```bash
$ erdd skill install
스킬을 설치했습니다: /path/to/my-project/.claude/skills/erdd/SKILL.md
```

| 옵션 | 뜻 |
|---|---|
| `--dir <경로>` | 설치 위치(기본 `.claude/skills/erdd`). 그 아래에 `SKILL.md` 를 둡니다. |
| `--force` | 기존 파일을 덮어씁니다 |

대상이 이미 있고 `--force` 가 없으면 종료 코드 `1` 로 멈춥니다:
`…/SKILL.md가 이미 있습니다. 덮어쓰려면 --force를 쓰세요`. 하위 명령을 빼면 사용법 오류(`2`)입니다.

### 6.8 `erdd serve`

로컬 서버를 띄워 브라우저에서 편집합니다. **서버 연결이 필요 없습니다** → [3.4](#34-로컬-모드--서버-없이-쓰기).

```bash
$ erdd serve --no-open --port 4399
http://127.0.0.1:4399 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

| | |
|---|---|
| 전용 옵션 | `--port <번호>`(기본 `4300`) · `--no-open`(브라우저를 자동으로 열지 않음) |
| 바인드 | **`127.0.0.1` 고정.** 인증이 없는 서버라 LAN 에 여는 옵션이 없습니다 |
| Host 검사 | `Host` 가 `127.0.0.1:<port>` 나 `localhost:<port>` 류가 아니면 응답은 **403** 입니다. 다른 이름(사설 DNS, `/etc/hosts` 별칭, 리버스 프록시)으로는 닿지 않습니다. 바인드만으로는 **DNS 리바인딩**(공격자의 페이지가 브라우저를 거쳐 이 서버를 읽고 쓰는 것)을 막을 수 없습니다 |
| 웹 번들 | **미리 빌드한 번들을 정적 파일로 서빙합니다.** 후보는 둘이고 **저장소의 `apps/web/dist` 를 먼저 봅니다.** 있으면 그것이 이기고, 없으면 패키지 안의 `web/`(레지스트리 설치본에 동봉된 사본)으로 넘어갑니다. 설치본은 저장소 후보를 가질 수 없으므로 늘 동봉본을 씁니다. 저장소 배치에서 둘 다 없으면 서버는 뜨지만 브라우저에는 JSON 404 만 보입니다. `pnpm -C apps/web build` 를 실행하세요(→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)) |
| 서버 호출 | 없음. `erdd.config.yaml` 과 `erdd/` 파일만 읽고 씁니다 |
| 쓰는 파일 | `.erdd/draft.json`(편집할 때마다) · `erdd/**` 와 `erdd/layout.yaml`(**저장을 누를 때만**) · `erdd/snapshots/`(스냅샷) · `erdd.config.yaml`(설정을 저장할 때) |

- **`erdd.config.yaml` 이 없으면 뜨지 않습니다**: `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요`
  (종료 코드 `1`). `erdd init --local` 로 만드세요.
- **연결 설정이 있는 프로젝트에서도 뜹니다.** 그때는 config 의 `projectId` 로, 아니면 고정 id
  (`00000000-0000-7000-8000-000000000000`)로 열립니다. 실행할 때마다 바뀌지 않으므로 주소를 북마크해 둘 수
  있습니다. `/` 로 가면 그 프로젝트 화면으로 갑니다.
- **포트가 이미 쓰이고 있으면 다음 포트를 자동으로 고르지 않고 멈춥니다**(종료 코드 `1`). 고정 포트를 가정한
  에이전트가 남의 서버에 붙지 않게 하기 위해서입니다.

  ```text
  오류: 포트 4399이 이미 사용 중입니다. --port로 다른 포트를 지정하세요
  ```

- `--port` 에 정수가 아닌 값을 주거나 값을 빼면 사용법 오류(`2`)입니다: `--port 값이 올바르지 않습니다: abc`.
- **`Ctrl+C`(SIGINT, SIGTERM)로 멈추세요.** 끝나기 전에 밀려 있던 **드래프트** 쓰기를 비우므로, 방금 옮긴
  좌표와 방금 만든 메모가 남습니다.
- 브라우저를 열 수 없으면(실행기가 없고 `--no-open` 도 없을 때) `브라우저를 열지 못했습니다. 직접 … 을 여세요` 만
  찍고 서버는 계속 돕니다.

### 6.9 `erdd export`

로컬 파일을 DDL 이나 DBML 로 내보냅니다. **서버를 부르지 않습니다.** `validate` 처럼 순수한 파일 경로
(`erdd/` → 모델 → DDL)입니다. 서버 모드에서도 원천은 **로컬 파일**이므로, 서버의 최신 상태를 내보내려면 먼저
`erdd pull` 하세요.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--format <ddl\|dbml>` | `ddl` | 출력 형식. 다른 값은 사용법 오류(`2`) |
| `--dialect <방언>` | `erdd.config.yaml` 의 `dialects[0]` | `DIALECTS` 밖의 값은 사용법 오류(`2`) |
| `-o <경로>` | (없음 = stdout) | 쓸 파일. 상위 디렉터리를 만듭니다 |

```bash
$ erdd export --format ddl
CREATE TABLE mbr (
  mbr_no BIGINT AUTO_INCREMENT NOT NULL COMMENT '회원번호',
  mbr_nm VARCHAR(100) NOT NULL COMMENT '회원명',
  PRIMARY KEY (mbr_no)
) COMMENT '회원 - 회원 기본 정보';

CREATE TABLE ord (
  ord_no BIGINT NOT NULL COMMENT '주문번호',
  mbr_no BIGINT NOT NULL COMMENT '회원번호',
  ord_sttus VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT '주문상태',
  PRIMARY KEY (ord_no)
) COMMENT '주문';

ALTER TABLE ord ADD CONSTRAINT FK_ord_mbr FOREIGN KEY (mbr_no) REFERENCES mbr (mbr_no);

CREATE INDEX ix_mbr_nm ON mbr (mbr_nm ASC);

$ erdd export -o schema.sql
/path/to/my-project/schema.sql에 ddl을 썼습니다

$ erdd export --format dbml -o schema.dbml
/path/to/my-project/schema.dbml에 dbml을 썼습니다

$ cat schema.dbml
Project "my-project" {
  database_type: 'MySQL'
}

Table "mbr" [note: '회원 - 회원 기본 정보'] {
  "mbr_no" BIGINT [pk, increment, note: '회원번호']
  "mbr_nm" VARCHAR(100) [not null, note: '회원명']

  indexes {
    ("mbr_nm") [name: 'ix_mbr_nm']
  }
}

Table "ord" [note: '주문'] {
  "ord_no" BIGINT [pk, note: '주문번호']
  "mbr_no" BIGINT [not null, note: '회원번호']
  "ord_sttus" VARCHAR(20) [not null, default: 'PENDING', note: '주문상태']
}

Ref: "ord"."mbr_no" > "mbr"."mbr_no"
```

`-o` 를 주면 CLI 가 쓴 경로를 알립니다(`…에 ddl을 썼습니다`).

⚠️ **stdout 에는 출력 본문만 갑니다.** 내보내기 경고와 방언 알림은 모두 **stderr** 로 갑니다.
`erdd export > schema.sql` 이 이 명령의 주된 쓰임이라, 엉뚱한 한 줄이 파일을 깨뜨리기 때문입니다.

```bash
$ erdd export --dialect postgresql > schema.sql
알림: postgresql는 erdd.config.yaml의 dialects에 없습니다(mysql). 그대로 내보냅니다
#  ↑ stderr; schema.sql gets only the DDL
```

- ⚠️ **DBML 의 `Project` 이름은 작업 디렉터리 이름입니다**(위 예에서 `my-project`). 이름 자체는 표시용이지만
  **그 블록이 방언을 실어 나릅니다.** `database_type` 은 `erdd import` 가 읽는 방언이므로
  ([6.10](#610-erdd-import-파일)의 감지 표), 이 블록이 없으면 다시 읽을 때 방언이 받는 쪽의
  `config.dialects[0]` 으로 떨어집니다. 파일 시스템 루트에서 내보내면 이름이 비어 블록이 빠집니다.
- **`config.dialects` 에 없는 방언이라도 유효하면 내보냅니다.** 다른 DB 용 DDL 이 한 번 필요한 것은 정상적인
  쓰임이라 막지 않습니다. 대신 위처럼 stderr 에 한 줄을 남깁니다.
- 내보내기 경고(컬럼이 없거나 물리명이 빈 테이블은 제외)도 stderr 에 `경고: …` 로 갑니다. `--json` 이면
  `warnings` 배열에도 들어갑니다.
- 로컬 파일에 파싱 오류가 있으면 **`validate` 와 같은 봉투로** `1` 로 끝납니다.

### 6.10 `erdd import <파일>`

DDL 이나 DBML 파일을 로컬 파일 트리에 가져옵니다. **웹 에디터의 DDL·DBML 가져오기와 같은 경로를 타므로** 동작도
같습니다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--format <ddl\|dbml>` | 확장자로 정함 | `.sql`, `.ddl` → ddl, `.dbml` → dbml |
| `--dialect <방언>` | 아래 감지 순서 | `DIALECTS` 밖의 값은 사용법 오류(`2`) |
| `--dry-run` | — | 계획만 보여 주고 **파일을 전혀 건드리지 않습니다** |
| `--yes` | — | 쓰기 전 확인을 건너뜁니다 |

**형식 판정**: `--format` > 확장자 > **그 밖에는 사용법 오류(`2`)**. 내용으로 추측하지 않습니다. 엉뚱한 파서로
읽으면 테이블을 하나도 잡지 못하고 「0개 가져옴」으로 조용히 끝나기 때문입니다.

```bash
$ erdd import dump.txt
오류: dump.txt의 형식을 확장자로 정할 수 없습니다 — --format ddl 또는 --format dbml을 주세요(확장자는 .sql·.ddl이면 ddl, .dbml이면 dbml입니다)
$ echo $?
2
```

**방언 감지는 형식마다 다릅니다.**

| 형식 | 순서 |
|---|---|
| DDL | `--dialect` > 본문의 특징 토큰 감지(`detectDialect`) > `config.dialects[0]` |
| DBML | `--dialect` > `Project { database_type }` > `config.dialects[0]` |

⚠️ **DBML 에는 본문 토큰 감지를 쓰지 않습니다.** DBML 의 속성 문법(`[pk, increment, …]`)이 감지기의 mssql
대괄호 식별자 서명에 **늘** 걸리므로, 돌리면 어떤 DBML 이든 mssql 로 읽힙니다.
무엇을 왜 골랐는지는 출력 첫 줄과 `--json` 의 `dialectSource` 에 나옵니다.

```bash
$ erdd import ../a/schema.sql --dry-run
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
--dry-run이라 파일을 쓰지 않았습니다

$ erdd import ../a/schema.sql --yes
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
파일 7개를 썼습니다. erdd push로 서버에 반영하세요

$ erdd import ../a/schema.dbml --yes     # DBML: reads the Project that erdd export wrote
dbml · 방언 mysql(Project의 database_type) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
파일 7개를 썼습니다. erdd push로 서버에 반영하세요
```

⚠️ **병합합니다. 덮어쓰지 않습니다.**

- **결과 이름이 이미 있는 테이블은 건너뜁니다.** 기존 테이블의 `id` 와 내용은 그대로입니다. **갱신하지
  않습니다.** 건너뛴 이름은 `table-conflict` 경고와 `--json` 의 `skipped` 에 나옵니다.
- 가져온 파일에 없는 기존 테이블은 **지우지 않습니다.**
- 새 엔티티의 `id` 는 그 자리에서 `uuidv7` 로 발급해 **파일에 바로 씁니다**(`push` 와 같은 관례).

**테이블 옵션도 봅니다.** 꼬리 절에서 `ENGINE`, `DEFAULT CHARSET`(`CHARACTER SET`), `COLLATE` 만 뽑아 한 줄로
정규화합니다. 테이블마다 다르면 **가장 많이 쓰인 값을 채택합니다**(같으면 DDL 에 먼저 나온 것).
`AUTO_INCREMENT=` 시작값, `ROW_FORMAT`, 파티션은 테이블별이거나 범위 밖이라 버립니다. 옵션이 없는 테이블은
투표하지 않습니다. 절반의 테이블이 옵션을 생략한 덤프에서 있는 값을 잃지 않기 위해서입니다.

`erdd.config.yaml` 의 그 방언 칸에 반영하는 규칙은 셋입니다.

| 그 방언 칸의 지금 값 | 동작 |
|---|---|
| 비어 있음 | **반영합니다** |
| 채택값과 같음 | 아무 일도 없습니다 |
| 다른 값이 있음 | **반영하지 않고 알립니다**(정해 둔 값을 조용히 덮어쓰지 않습니다) |

값을 바꾸려면 `erdd.config.yaml` 을 직접 고치세요. 덮어쓰기 플래그는 없습니다. 채택값과 반영 여부는 사람용
출력과 `--json` 의 `tableOptions`·`tableOptionsApplied` 에 나옵니다.

```bash
$ erdd import mixed.sql --yes
ddl · 방언 mysql(본문에서 감지) · 추가 3개 테이블(컬럼 3 · 인덱스 0 · 관계 0)
경고 8건
  ...
  [unsigned-dropped] ORD_LOG.C: DECIMAL(10,2)에는 부호 없음을 붙일 수 없어 떨어뜨렸습니다 (원문 decimal(10,2) unsigned)
  [table-option-conflict] ORD_LOG: 테이블 옵션이 'ENGINE=MyISAM DEFAULT CHARSET=latin1'이라 채택값 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'과 다릅니다 — 채택값을 씁니다
테이블 옵션 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'을 erdd.config.yaml 의 mysql 칸에 반영합니다
파일 8개를 썼습니다. erdd push로 서버에 반영하세요
```

⚠️ **연결된 프로젝트에서는 서버에 닿지 않습니다.** 그때는 출력이 한 줄로 알립니다
(`(서버 프로젝트 설정에는 반영되지 않습니다 — 다음 erdd pull 이 이 값을 덮어씁니다)`). 서버 값은 웹의 프로젝트 설정
화면에서 바꾸세요.

⚠️ **정수 3종이 아닌 타입에 붙은 부호 없음은 `unsigned-dropped` 경고와 함께 떨어집니다.** 부호 없음은
`SMALLINT`, `INT`, `BIGINT` 만 가능합니다(MySQL 8.0.17 이 `DECIMAL`, `FLOAT`, `DOUBLE` 의 `UNSIGNED` 를
deprecated 했고, 자기 문서에서도 대신 `CHECK` 를 권합니다).

```bash
$ erdd import ../a/schema.sql --yes --json | jq '{added, skipped, warnings}'   # the same DDL a second time
{
  "added": 0,
  "skipped": ["mbr", "ord"],
  "warnings": [
    { "kind": "table-conflict", "target": "mbr", "message": "같은 이름의 테이블이 이미 있어 건너뜁니다" },
    { "kind": "table-conflict", "target": "ord", "message": "같은 이름의 테이블이 이미 있어 건너뜁니다" },
    { "kind": "unresolved-index", "target": "mbr.ix_mbr_nm", "message": "소속 테이블을 찾지 못해 인덱스 ix_mbr_nm을 만들지 않았습니다" },
    { "kind": "unresolved-fk", "target": "ord", "message": "참조 대상 mbr을 찾지 못해 관계를 만들지 않았습니다" }
  ]
}
```

**서버로는 아무것도 보내지 않습니다.** `.erdd/base.json` 과 `sync.json` 을 건드리지 않으므로, 가져온 결과는
`erdd status` 에 **로컬 변경**으로 보입니다. 반영은 평소대로 `erdd diff` → `erdd push` 입니다.

⚠️ **테이블 파일 이름은 물리명 기준으로 다시 써집니다.** `pull` 과 같은 동작입니다(`writeTree` 가
`<물리명>.yaml` 로 정규화합니다). 사람이 손으로 정한 파일 이름은 이 명령 뒤에 바뀝니다.

**확인 프롬프트.** `--dry-run` 이 아니고 `--yes` 도 없으면 쓰기 전에 묻습니다. 비대화형(`--json`)에서는 물을 수
없으므로 할 일을 알리고 멈춥니다.

```bash
$ erdd import ../a/schema.sql --json
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
{"error":{"code":"CANCELLED","message":"파일을 덮어씁니다 — 비대화형(--json)에서는 --yes를 함께 주세요"}}
$ echo $?
1
```

**부호 없음과 테이블 옵션은 왕복에서 살아남습니다.** MySQL 의 `INT UNSIGNED` 는 논리 타입의 일급 속성이라
모델에 그대로 남고, 테이블 옵션(`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)은 `erdd.config.yaml` 의
`tableOptions` 에 들어갑니다(→ [5.2](#52-erddconfigyaml)). 실제 왕복:

```bash
$ cat src.sql
CREATE TABLE ORD (
  ORD_NO int unsigned NOT NULL AUTO_INCREMENT,
  MBR_NO int(11) NOT NULL,
  QTY smallint(5) unsigned NOT NULL,
  AMT bigint(20) unsigned NOT NULL,
  PRIMARY KEY (ORD_NO)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

$ erdd import src.sql --yes
ddl · 방언 mysql(본문에서 감지) · 추가 1개 테이블(컬럼 4 · 인덱스 0 · 관계 0)
경고 5건
  ...
테이블 옵션 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'을 erdd.config.yaml 의 mysql 칸에 반영합니다
파일 6개를 썼습니다. erdd push로 서버에 반영하세요

$ erdd export --format ddl -o back.sql --yes
$ cat back.sql
CREATE TABLE ORD (
  ORD_NO INT UNSIGNED AUTO_INCREMENT NOT NULL,
  MBR_NO INT NOT NULL,
  QTY SMALLINT UNSIGNED NOT NULL,
  AMT BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ORD_NO)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

정수 표시폭(`int(11)`, `smallint(5)`)은 읽고 **버립니다.** MySQL 8.0.17 부터 deprecated 인 표시 전용 값이라
되살릴 이유가 없습니다. `ZEROFILL` 도 같습니다.

다른 방언으로 내보내면 부호 없음은 `CHECK` 가 됩니다(그 방언에는 부호 없는 타입이 없습니다):

```bash
$ erdd export --format ddl --dialect postgresql --yes
경고: ORD.ORD_NO: postgresql에는 부호 없음이 없어 CHECK (컬럼 >= 0)로 대신합니다 — 상한 4,294,967,295가 integer(2,147,483,647)를 넘습니다
...
CREATE TABLE ORD (
  ORD_NO integer GENERATED BY DEFAULT AS IDENTITY NOT NULL CHECK (ORD_NO >= 0),
  MBR_NO integer NOT NULL,
  QTY smallint NOT NULL CHECK (QTY >= 0),
  AMT bigint NOT NULL CHECK (AMT >= 0),
  PRIMARY KEY (ORD_NO)
);
```

⚠️ **그 `CHECK` 는 되읽지 않습니다.** 파서는 컬럼 인라인 `CHECK` 를 보지 않으므로, PostgreSQL 덤프를 다시
가져오면 그냥 `INT` 가 됩니다. 부호 없음이 글로 왕복하는 것은 **MySQL DDL 에서만**입니다.

### 6.11 `erdd dict` — 공용 사전

조직·전역 **공용 사전 라이브러리**(단어·용어·도메인·커스텀 항목)를 로컬 파일과 주고받습니다. 라이브러리 생성,
항목 관리, 승격 요청 승인은 웹에서 합니다([사용 매뉴얼 13절](user-guide.md#13-공용-리소스)).

```bash
erdd dict list                                        # libraries visible to this project
erdd dict pull --library "플랫폼팀 표준 사전"          # first receive; adds a subscription
erdd dict pull                                        # from then on, all subscriptions
erdd push -m "…"                                      # push new words to the storage (server project) first, then
erdd dict push --library "플랫폼팀 표준 사전" -m "…"   # push them to the shared library (a promotion request without permission)
erdd dict requests                                    # this project's promotion requests and their results
```

**서버에 연결된 프로젝트에서만 됩니다.** 로컬 전용 프로젝트에서는 이렇게 멈춥니다(`1`).

```text
오류: 서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 (erdd.config.yaml)
```

| 명령 | 서버 호출 | 쓰는 파일 |
|---|---|---|
| `dict list` | `resource.library.listForProject` | 없음 |
| `dict pull` | `resource.library.listForProject`, `resource.items.list` | 사전 파일 넷(`words`, `terms`, `domains`, `custom-fields`), `origins.yaml`, `erdd.config.yaml`(구독) |
| `dict push` | 위 둘 + `model.get`, `resource.promote` 또는 `promotion.create` | 직접 승격이면 `pull` 과 같음(암묵적 pull) |
| `dict requests` | `resource.library.listForProject`, `promotion.listForProject` | 없음 |

#### `erdd dict list`

```bash
$ erdd dict list
  표준 사전(예시) — 전역 · 항목 14 · 쓰기 가능 · 01a0cc5e-c4a0-7402-b99c-fd41fb2cb350
* 플랫폼팀 표준 사전 — 조직 · 항목 5 · 쓰기 가능 · 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
```

- 앞의 `*` 는 구독(`erdd.config.yaml` 의 `dictionaries`)을 뜻합니다.
- **쓰기 가능이면 `dict push` 가 바로 승격하고, 아니면 승격 요청이 됩니다.** 조직 라이브러리는 조직 Owner/Admin
  만, 전역 라이브러리는 서비스 관리자만 쓸 수 있습니다.
- 보이는 라이브러리가 없으면 `이 프로젝트에서 보이는 라이브러리가 없습니다` 를 찍습니다.

#### `erdd dict pull`

라이브러리 항목을 **로컬 파일**로 받습니다. 처음에는 전부 복사하고, 그 뒤로는 **재동기화**(3-way)입니다. 웹의
**가져오기**와 같은 계산을 로컬 파일에 대고 합니다. **서버 프로젝트는 건드리지 않습니다.** 받은 것은 다음
`erdd push` 때 보관함으로 올라갑니다.

```bash
$ erdd dict pull --library "플랫폼팀 표준 사전"
플랫폼팀 표준 사전 (조직)
  추가 4 · 자동 갱신 0 · 연결 0 · 유지 0
반영했습니다 — erdd/domains.yaml, erdd/origins.yaml, erdd/terms.yaml, erdd/words.yaml

$ erdd dict pull
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 0 · 연결 0 · 유지 4
바뀐 파일이 없습니다
```

- **`--library <이름|id>`** — 그 라이브러리만 받고, 구독에 없으면 더합니다. 이름이 여럿에 맞으면 후보를 보여
  주고 멈춥니다(`2`): `이름이 <이름>인 라이브러리가 여럿입니다 — id로 지정하세요`. 하나도 맞지 않으면:
  `라이브러리 <이름>을(를) 찾지 못했습니다 — erdd dict list 로 확인하세요`(`1`).
- **인자가 없으면 구독 전부를 적힌 순서대로 처리합니다.** 구독이 없으면:
  `구독한 라이브러리가 없습니다 — --library <이름|id> 로 지정하세요 (목록: erdd dict list)`(`2`).
- 구독한 라이브러리가 사라졌거나 권한을 잃었으면 **그 하나만 건너뛰고** 나머지를 받습니다(stderr:
  `경고: 라이브러리 <이름>(<id>)을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`, 보고에는
  `<이름> — 찾을 수 없어 건너뛰었습니다`). 구독은 지우지 않습니다.
- **`--dry-run`** — 계획만 보여 주고 파일도 config 도 쓰지 않습니다. 마지막 줄은
  `미리보기입니다 — 파일을 쓰지 않았습니다` 입니다.
- **다시 실행했을 때 바뀐 것이 없으면 파일을 하나도 쓰지 않습니다**(`바뀐 파일이 없습니다`).
- 사전과 무관한 테이블·그룹 파일은 건드리지 않습니다. 사람이 `id` 없이 쓴 사전 항목은 이 명령이 id 를
  채웁니다(`push` 가 채우는 것과 같습니다).
- 로컬 파일이 깨져 있으면 거절합니다(`1`. `erdd validate` 로 확인하라는 메시지가 붙습니다).
- `erdd serve` 가 돌고 있어도 괜찮습니다. 파일 감시가 반영합니다. 저장하지 않은 편집이 있으면 화면에
  **파일이 밖에서 바뀌었습니다** 배너가 나옵니다.
- **재동기화는 파일(저장된 값)을 기준으로 합니다.** `erdd serve` 에 저장하지 않은 편집이 있으면 stderr 에
  `⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 먼저 나옵니다. 알림일
  뿐이라 판정·종료 코드·`--json` 봉투는 그대로입니다.

**항목마다 일어나는 일: 기본값은 웹 가져오기의 기본 선택과 같습니다.**

| 상태 | 뜻 | 기본 | 바꾸는 옵션 |
|---|---|---|---|
| 추가 | 로컬에 없는 원본 항목 | 받음 | — |
| 자동 갱신 | 받은 뒤 로컬에서 바꾸지 않았는데 원본이 바뀜 | 원본 값으로 바꿈 | — |
| 충돌 | 로컬에서 바꿨고 원본도 바뀜 | **보류**(파일을 바꾸지 않고 다음에 다시 알림) | `--conflicts theirs`(원본 반영) · `--conflicts ours`(로컬 유지. 이 변경을 검토했다고 기록해 다시 나타나지 않음) |
| 이름 중복 | 원본과 이름이 같은 로컬 항목이 이미 있음(출처 없음) | **건너뜀** | `--adopt`: 내용이 같으면 그 로컬 항목에 출처를 연결. 내용이 다르면 `--adopt --conflicts ours` 로만 연결(아래) |
| 유지 | 이미 최신이거나 프로젝트 자체 항목 | 그대로 | — |
| 원본에서 사라짐 | 원본 항목이 지워짐 | 로컬에 그대로 둠 | — |

```bash
# when the 「번호」 abbreviation changed in the source (library), and the source of 「고객」, which was changed locally, also changed
$ erdd dict pull
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 1 · 연결 0 · 유지 4
  충돌 1 — 보류(--conflicts theirs|ours 로 정리):
    단어 고객  (abbreviation)
반영했습니다 — erdd/origins.yaml, erdd/words.yaml

$ erdd dict pull --conflicts theirs
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 0 · 연결 0 · 유지 5
  충돌 1 — 원본 반영:
    단어 고객  (abbreviation)
반영했습니다 — erdd/origins.yaml, erdd/words.yaml
```

충돌 줄은 `종류 이름  (바뀐 필드 키)` 꼴입니다. 필드는 파일의 키 이름 그대로이고, 전후 값은 보여 주지 않습니다.
제목은 기본이 `충돌 N — 보류`, `--conflicts theirs` 면 `충돌 N — 원본 반영`, `--conflicts ours` 면
`충돌 N — 로컬 유지:` 입니다.

**`--adopt` — 로컬에서 시작해 이미 자체 단어가 있는 프로젝트가 사전에 합류할 때.**

```bash
$ erdd dict pull --library "플랫폼팀 표준 사전"
플랫폼팀 표준 사전 (조직)
  추가 5 · 자동 갱신 0 · 연결 0 · 유지 0
  이름 중복 1 — 건너뜀 (--adopt 로 연결)
반영했습니다 — erdd/domains.yaml, erdd/origins.yaml, erdd/terms.yaml, erdd/words.yaml

$ erdd dict pull --adopt
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 0 · 연결 1 · 유지 5
반영했습니다 — erdd/origins.yaml
```

- **연결은 내용을 바꾸지 않고 출처만 붙입니다.** 연결 대상은 종류가 같고 이름이 같은(앞뒤 공백 무시) 로컬 항목 중
  **아직 출처가 없는** 것입니다. 커스텀 항목은 적용 대상(`target`)도 같아야 합니다. 연결할 수 없는 이름 중복은
  따로 셉니다: `이름 중복 N — 연결할 수 없음 (같은 이름 항목을 다른 원본이 차지했거나 커스텀 항목의 적용 대상이 다릅니다)`.
- **내용이 같은 항목만 연결합니다.** 내용이 다른 채로 연결하면 「라이브러리 값과 다른 연결 항목」이 되고, 다음
  `dict push` 가 **그것을 원본 갱신으로 기본 선택합니다.** 아무도 본 적 없는 라이브러리 값을 이 프로젝트의 값으로
  덮어쓰게 됩니다. 그래서 내용이 다른 이름 중복은 `--adopt` 로도 연결하지 않고, 다른 필드와 함께 보여 줍니다.

  ```bash
  $ erdd dict pull --adopt
  플랫폼팀 표준 사전 (조직)
    추가 0 · 자동 갱신 0 · 연결 0 · 유지 5
    이름 중복 1 — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)
      단어 고객  (abbreviation)
  바뀐 파일이 없습니다
  ```

  항목 줄은 충돌 줄과 같은 `종류 이름  (다른 필드 키)` 꼴입니다. 이 줄은 `--adopt` 없이 실행해도 나옵니다.
  **`건너뜀 (--adopt 로 연결)` 은 `--adopt` 가 실제로 연결할 항목만 셉니다.** 줄 순서는 `충돌` → `건너뜀` →
  `내용이 달라 연결하지 않음` → `연결할 수 없음` → `원본에서 사라짐` 입니다.
- 용어는 가리키는 도메인이 이번에 연결되지도 추가되지도 않으면(예: 그 도메인이 내용이 달라 연결되지 않았으면)
  내용이 다른 것으로 봅니다. 필드는 `domainId` 로 보입니다. 도메인을 먼저 정리하면 용어도 함께 연결됩니다.
- **내용이 다르면 어느 값에 맞출지 고르세요.**

  | 원하는 것 | 방법 |
  |---|---|
  | 로컬 값을 유지한 채 연결 | `erdd dict pull --adopt --conflicts ours`. 로컬 값을 유지하는 데 동의한 것으로 보고 연결합니다. 그 뒤 `push` → `dict push` 가 이 값을 원본 갱신으로 올립니다(원본 값을 **본 뒤에** 덮어쓰는 것입니다) |
  | 원본 값으로 바꾸기 | 로컬 항목을 지우고 `erdd dict pull` 을 다시 실행하세요. 이름 중복이 사라지고 항목이 추가로 들어옵니다. 도메인처럼 다른 파일이 이름으로 참조하는 항목은 지우면 파일이 깨져 `dict pull` 이 거절하므로, 괄호 안의 필드를 원본 값으로 바꾼 뒤 `--adopt` 를 실행하세요(내용이 같아져 연결됩니다) |

  이 경우 `--conflicts theirs` 는 아무것도 하지 않습니다. 연결하지도, 값을 원본 값으로 바꾸지도 않습니다.
- `--adopt --conflicts ours` 로 연결한 항목은 로컬 값이 원본과 다른 「로컬에서 바꾼 항목」이므로, 나중에 원본이
  바뀌면 자동 갱신이 아니라 **충돌**로 알립니다(로컬 값을 조용히 덮어쓰지 않습니다).

**`--file <경로>` — 서버가 내보낸 파일에서 받습니다. 서버 연결이 필요 없습니다.**

```bash
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd dict pull --file standard.erdd-lib.yaml
데모 사전 (파일 standard.erdd-lib.yaml)
  추가 14 · 자동 갱신 0 · 연결 0 · 유지 0
반영했습니다 — erdd/custom-fields.yaml, erdd/domains.yaml, erdd/origins.yaml, erdd/terms.yaml, erdd/words.yaml

$ erdd dict pull
데모 사전 (파일 standard.erdd-lib.yaml)
  추가 0 · 자동 갱신 0 · 연결 0 · 유지 14
바뀐 파일이 없습니다
```

- **서버에 연결되지 않은 프로젝트(로컬 전용)에서도 됩니다.** `--library` 는 서버의 목록에서 고르므로 연결이
  필요하지만, `--file` 은 그 파일을 그대로 읽을 뿐 서버를 부르지 않습니다
  (→ [로컬 모드 매뉴얼 7.3](local-guide.md#73-공용-사전을-받아-쓰기--erdd-dict)).
- **파일은 배포 파일이어야 합니다.** 서버가 내보낸 파일처럼 `library.id`, 항목 `id`, `version` 이 있어야
  합니다. 사람이 쓴 원본 파일이나 `library import`·웹 가져오기가 받는 Excel 은 여기 쓸 수 없습니다(`1`).

  ```text
  오류: <경로>: 서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) — 오류 N건
    library.id — 배포 파일에는 필수입니다 — 서버에서 내보낸 파일만 받을 수 있습니다
    …
  ```

- **처음 받으면 그 라이브러리가 config 에 파일 구독으로 기록됩니다**(`erdd.config.yaml` 의
  `dictionaries[].file`, → [5.2](#52-erddconfigyaml)). 인자 없는 `erdd dict pull` 은 그 경로를 다시 읽습니다.
  배포 파일의 새 버전을 받아 그 자리에 덮어쓰면 다음 `dict pull` 이 바뀐 것을 봅니다. **같은 라이브러리 id 로
  `--file` 을 다시 주면 그 구독 줄이 파일 구독으로 바뀝니다**(서버 구독이었어도).
- **구독이 가리키는 것과 다른 라이브러리의 파일은 거절합니다**(`1`).

  ```text
  오류: 구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<다른 id>)입니다 — 다른 라이브러리로
  바꾸려면 구독 줄을 지우고 --file 로 다시 받으세요
  ```

  다른 라이브러리로 바꾸려면 `erdd.config.yaml` 에서 그 구독 줄을 지우고 `--file` 로 다시 받으세요.
- **나머지 판정(추가, 자동 갱신, 충돌, 이름 중복, `--adopt`)은 서버 구독과 완전히 같습니다.** 위 표와 규칙을
  그대로 따르세요. `--library` 와 `--file` 은 함께 줄 수 없습니다(`--file 과 --library 는 함께 쓸 수 없습니다`,
  `2`).

#### `erdd dict push`

로컬에서 만든 사전 항목을 공용 라이브러리에 올립니다. 판정과 쓰기는 **서버의 승격 엔진**이 **서버 프로젝트
(보관함)의 값**으로 합니다. 웹의 **조직으로 승격**과 같은 계산입니다.

**전제: 올리기 전에 `erdd push` 로 보관함을 최신으로 맞추세요.** 승격되는 것은 서버에 있는 값이므로, 로컬에서
바꾼 값이 서버에 없으면 **보고 있던 값이 아니라 보관함의 옛 값이 올라갑니다.** 그래서 두 가지를 확인하고
멈춥니다(`1`).

| 상황 | 메시지 | 할 일 |
|---|---|---|
| push 하지 않은 로컬 변경이 있음 | `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` | `erdd push` |
| 마지막 pull 뒤 서버가 바뀜 | `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` | `erdd pull`(로컬 변경이 없으므로 잃는 것이 없습니다) |
| 기준 시점이 없음 | `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` | `erdd pull` |

**`erdd serve` 의 저장하지 않은 편집은 올라가지 않습니다.** 있으면 stderr 에
`⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 먼저 나옵니다(알림일 뿐 멈추지
않습니다). 그 편집도 올리려면 화면에서 저장한 뒤 `erdd push` → `dict push` 를 실행하세요.

```bash
$ erdd push -m "배송 추가·고객 약어"
반영했습니다 (리비전 3, 변경 2건)
$ erdd dict push --library "플랫폼팀 표준 사전"
신규 추가 1 · 원본 갱신 1 · 동명 발견 0(제외 — --include-name-match)
  ~ 단어 고객  (abbreviation)
  + 단어 배송
계속할까요? [y/N] y
승격했습니다 — 신규 1 · 갱신 1
```

계획 목록(`+` 신규, `~` 원본 갱신, `=` 동명 발견. 괄호에는 라이브러리 값과 다른 필드가 있습니다)과 확인 질문은
stderr 로, 한 줄짜리 결과(승격했습니다)는 stdout 으로 갑니다.

**용어의 도메인이 라이브러리에 없고 함께 올리지도 않으면, 라이브러리 용어의 도메인 연결이 비워집니다.** 그
용어 줄 끝에 표시가 붙습니다. 판정은 `--kind term`, `--name`, 원본이 앞선 항목 제외(아래)처럼 도메인을 빠뜨리기
쉬운 필터를 거친 **최종 선택**을 기준으로 합니다(웹 **조직으로 승격**의 **도메인 연결 비움** 배지와 같은 판정).

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --kind term
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 용어 주문금액  (도메인 연결 비움 — 금액을(를) 함께 올리면 연결됩니다)
계속할까요? [y/N]
```

연결을 지키려면 거절하고 도메인을 함께 올리세요(`--kind domain,term`, 또는 `--name` 에 도메인 이름을 더하기).

| 구역 | 뜻 | 기본 |
|---|---|---|
| 신규 추가 | 라이브러리에 없는 항목 | 보냄 |
| 원본 갱신 | 이미 연결된 라이브러리 항목에 이 프로젝트의 값을 올림 | 보냄. 다만 **마지막 `dict pull` 뒤 라이브러리 원본이 바뀐 항목은 뺌**(아래) |
| 동명 발견 | 라이브러리에 이름이 같은 다른 항목이 있음 | **보내지 않음.** `--include-name-match` 로 넣음(그 항목을 이 프로젝트의 값으로 갱신하고 연결) |

- 올릴 항목은 **`--kind <종류,…>`**(`domain`, `word`, `term`, `customField`)와 **`--name <이름>`**(반복 가능)로
  좁히세요. 요약의 `동명 발견 N` 은 이 필터를 거친 뒤에 셉니다.
- 올릴 것이 없으면 `올릴 항목이 없습니다` 를 찍습니다(`0`). `--name` 에 맞는 항목이 없었거나 동명 항목을 뺐으면
  stderr 에도 `--name 에 맞는 항목이 없습니다: <이름, …>` / `동명 발견 N건은 제외했습니다 — 올리려면 --include-name-match`
  가 나옵니다.
- 확인은 `--yes` 로 건너뜁니다. 비대화형(`--json`)에서는 `--yes` 가 필수입니다:
  `확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요`(`1`).
- `--library` 는 필수입니다(`--library <이름|id> 가 필요합니다`, `2`).

**마지막 `dict pull` 뒤 라이브러리 원본이 바뀐 항목은 올리지 않습니다.** 받은 뒤 다른 사람이 그 라이브러리 항목을
고쳤으면(라이브러리 버전이 `origins.yaml` 의 `version` 보다 크면) 이 프로젝트의 값은 **그 사람의 새 값보다
오래됐습니다.** 로컬에서 건드리지 않았어도 값이 다르므로 원본 갱신으로 잡히고, 그대로 올리면 고쳐진 원본이 옛
값으로 되돌아갑니다. 그래서 그런 항목은 **`--name` 으로 지목해도** 선택에서 빠지고, 계획 목록 뒤(확인 질문 전)에
따로 알립니다.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --yes
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 단어 결제
라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 2건은 제외했습니다 — erdd dict pull 로 먼저 받으세요
  ~ 단어 고객  (abbreviation)
  ~ 단어 번호  (abbreviation)
승격했습니다 — 신규 1 · 갱신 0
```

**그런 항목을 올리려면 먼저 `erdd dict pull` 로 받으세요.** 로컬에서 건드리지 않은 항목은 자동 갱신으로 원본 값이
되므로 올릴 것이 남지 않고, 로컬에서도 바꾼 항목은 충돌로 보류됩니다. 로컬 값을 공용 라이브러리에 올리는 것이
의도라면 `--conflicts ours` 로 정리한 뒤 `push` → `dict push` 하세요. 그러면 원본 갱신으로 올라갑니다(원본의 최신
값을 **본 뒤에** 덮어쓰는 것이기 때문입니다).

```bash
$ erdd dict pull
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 1 · 연결 0 · 유지 3
  충돌 1 — 보류(--conflicts theirs|ours 로 정리):
    단어 번호  (abbreviation)
반영했습니다 — erdd/origins.yaml, erdd/words.yaml
$ erdd dict pull --conflicts ours
플랫폼팀 표준 사전 (조직)
  추가 0 · 자동 갱신 0 · 연결 0 · 유지 4
  충돌 1 — 로컬 유지:
    단어 번호  (abbreviation)
반영했습니다 — erdd/origins.yaml
$ erdd push -m "사전 정리"
반영했습니다 (리비전 4, 변경 2건)
$ erdd dict push --library "플랫폼팀 표준 사전" --yes
신규 추가 0 · 원본 갱신 1 · 동명 발견 0(제외 — --include-name-match)
  ~ 단어 번호  (abbreviation)
승격했습니다 — 신규 0 · 갱신 1
```

제외하고 나서 올릴 것이 없으면 `올릴 항목이 없습니다`(`0`)를 찍고, 제외 알림 두 줄은 그래도 stderr 에 나옵니다.

⚠️ **종료 코드 `0` 이 「올라갔다」는 뜻은 아닙니다.** CLI 쪽 선택(원본이 앞선 항목 제외, 동명 항목 제외, `--name`
불일치)으로 올릴 것이 없으면 서버를 부르지 않고 `0` 으로 끝납니다. 「전부 건너뜀」이 종료 코드 `1` 로 끝나는 것은
확인 뒤 **서버가** 전부 건너뛰었을 때뿐입니다(아래). 스크립트와 에이전트가 무엇이 올라갔는지 판정하려면 `--json`
의 `selected: 0`(올릴 것이 없었음)과 `behind`(원본이 앞서 빠진 항목)를 보세요(→ [10.1](#101---json-규약)).

**결과는 권한에 따라 다릅니다**: `erdd dict list` 의 쓰기 가능.

- **쓰기 가능 → 바로 승격합니다.** 서버가 확인 뒤 다시 계산해 그 사이 어긋난 항목만 건너뜁니다. 성공하면 자동으로
  `pull` 해 `erdd/origins.yaml` 을 받습니다(새로 올린 항목에 출처가 붙습니다).
  - 건너뛴 항목은 `  건너뜀 단어 주문 (그 사이 계획이 바뀜)`(또는 `(대상이 사라짐)`)으로 나열되고 종료 코드는
    `0` 입니다. **전부 건너뛰었으면** `승격된 항목이 없습니다 — 전부 건너뛰었습니다` 와 `1` 입니다.
  - 승격은 성공했는데 자동 `pull` 이 실패하면
    `승격했습니다 — 신규 N · 갱신 M. 파일 갱신에 실패했습니다 — erdd pull을 실행하세요 (<사유>)` 를 찍습니다(`1`).
    **`dict push` 를 다시 실행하지 말고 `erdd pull` 을 실행하세요.** 확인을 기다리는 사이 로컬 파일을 고쳤으면
    사유는 `확인하는 사이 로컬 파일이 바뀌어 덮어쓰지 않았습니다` 입니다.
- **쓰기 불가 + 조직 라이브러리 → 승격 요청을 만듭니다.** `-m` 이 요청 메모입니다. 로컬 파일은 바뀌지 않습니다.

  ```bash
  $ erdd dict push --library "플랫폼팀 표준 사전" -m "스모크 요청" --yes
  신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
    + 단어 주문
  승격 요청을 만들었습니다 (1건). 조직 관리자가 웹에서 승인하면 반영됩니다
  ```

  그 사이 지워진 항목이 있으면 둘째 줄에 `(N건은 그 사이 사라져 빠졌습니다)` 가 붙습니다. **승인되면 서버 항목에
  출처가 붙고, 다음 `erdd pull` 이 그것을 `origins.yaml` 로 가져옵니다.** 서버만 바뀌었으므로 충돌은 없습니다.
- **쓰기 불가 + 전역 라이브러리 → 서버를 부르기 전에 거절합니다**(`1`):
  `전역 라이브러리로는 승격을 요청할 수 없습니다 — 서비스 관리자만 전역 라이브러리에 올릴 수 있습니다`.

#### `erdd dict requests`

이 프로젝트의 승격 요청을 오래된 순으로 보여 줍니다. 날짜는 로컬 날짜입니다.

```bash
$ erdd dict requests
[승인] 2026-09-23 플랫폼팀 표준 사전 — 1건 · 멤버
  메모: 스모크 요청
  처리 메모: 승인 — 스모크
```

- 상태는 `[대기]`, `[승인]`, `[반려]`, `[취소]` 중 하나입니다. **처리 메모**(승인자의 사유. 반려 사유 포함)는 웹
  프로젝트 화면에는 없지만 여기서 볼 수 있습니다. 메모는 요청 메모입니다.
- `--status pending|resolved|rejected|cancelled` 로 거르세요. 요청이 없으면 `승격 요청이 없습니다` 를 찍습니다.
- 요청 취소와 승인은 웹에서 합니다. 요청한 항목의 이름은 보이지 않습니다(건수만 보입니다).

### 6.12 `erdd library` — 라이브러리 관리

공용 라이브러리를 **파일로** 내보내고 가져옵니다(`.erdd-lib.yaml`, `format: erdd-library`). 가져오기는 그
라이브러리에 쓰기 권한이 있는 사람(조직 Owner/Admin, 전역 라이브러리는 서비스 관리자)만 할 수 있고, 내보내기는
라이브러리를 읽을 수 있는 사람이면 누구나 할 수 있습니다. 가져오기의 판정 규칙은
[../../guides/shared-resources.md](../../guides/shared-resources.md) 의 「파일 내보내기·가져오기」에 있습니다.

**프로젝트 없이 돕니다.** 관리자가 빈 디렉터리나 CI 에서 부르는 명령입니다. 서버 주소는 `--server <url>` 이고,
없으면(서버에 연결된 프로젝트 안에서 실행할 때) `erdd.config.yaml` 의 `serverUrl` 입니다. 둘 다 없으면 멈춥니다
(`2`).

```text
오류: 서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요
```

토큰은 다른 명령과 같은 순서로 찾습니다(`ERDD_TOKEN` → `.erdd/credentials.json`).

```bash
erdd library list                                                   # visible libraries
erdd library export "표준 사전(예시)" -o standard.erdd-lib.yaml    # export as a distribution file
erdd library import standard.erdd-lib.yaml --library "표준 사전(예시)"          # apply to that library
erdd library import standard.erdd-lib.yaml --create "새 라이브러리" --scope global   # import while creating a new one
```

#### `erdd library list`

```bash
$ erdd library list --server http://127.0.0.1:3001
  표준 사전(예시) — 전역 · 항목 14 · 쓰기 가능 · 019fff92-8724-7f9e-88f4-627da6a47f20
  데모 사전 — 전역 · 항목 14 · 쓰기 가능 · 01a0cf70-8bb2-7bf8-9635-821049933b45
```

토큰이 속한 조직을 모두 돌며 전역·조직 라이브러리를 모읍니다. 쓰기 가능이 없으면 `library import` 가 그
라이브러리를 거절합니다. 보이는 라이브러리가 없으면 `볼 수 있는 라이브러리가 없습니다` 를 찍습니다.

#### `erdd library export <이름|id> [-o 파일]`

```bash
$ erdd library export "표준 사전(예시)" -o standard.erdd-lib.yaml --server http://127.0.0.1:3001
내보냈습니다 — standard.erdd-lib.yaml
```

- `-o` 가 없으면 stdout 에 씁니다(`--json` 이면 JSON 봉투 하나).
- 지워진 도메인을 가리키던 용어가 있었으면(도메인 없이 내보냅니다) stderr 에
  `삭제된 도메인을 가리키던 용어 N건은 도메인 없이 내보냈습니다` 가 나옵니다.
- 이름이 여럿에 맞거나 라이브러리를 찾을 수 없을 때의 오류 문구는 `dict pull` 과 같고
  (→ [6.11](#611-erdd-dict--공용-사전)), 권하는 명령만 `erdd library list` 입니다. 예:
  `라이브러리 없는사전을(를) 찾지 못했습니다 — erdd library list 로 확인하세요`(`1`).
- `<이름|id>` 없이 부르면 `사용법: erdd library export <이름|id> [-o 파일]` 입니다(`2`).

#### `erdd library import <파일> (--library <이름|id> | --create <이름> --scope <global|org>)`

라이브러리 파일, 손으로 쓴 원본 파일, Excel(`.xlsx`. 헤더는
[사용 매뉴얼 16절의 Excel 사전 가져오기](user-guide.md#excel-사전-가져오기)와 같습니다)을 읽어 기존 라이브러리나
새로 만드는 라이브러리에 적용합니다. **`--library` 와 `--create` 중 정확히 하나**가 필요합니다. 둘 다 없거나 둘
다 있으면 `--library 와 --create 중 정확히 하나를 주세요` 를 찍습니다(`2`).

| 상태 | 뜻 | 기본 | 바꾸는 옵션 |
|---|---|---|---|
| 추가 | 라이브러리에 없는 항목 | 적용 | — |
| 갱신 | 이미 대응된 항목을 파일의 값으로 바꿈 | 적용 | — |
| 그대로 | 파일과 라이브러리 값이 같음 | 건드리지 않음 | — |
| 오래된 파일 | 항목 id 로 대응됐고 파일의 `version` 이 서버보다 낮음(이 라이브러리에서 내보낸 뒤 서버가 앞서 나감) | **건너뜀** | `--include-stale`: 서버의 새 값을 파일의 옛 값으로 덮어씀 |
| 파일에 없음 | 파일이 언급한 종류(빈 목록이라도)에서 빠진 기존 항목. 종류 자체가 파일에 없으면 대상이 아님 | **남김** | `--prune`: 지움(남는 항목이 가리키는 도메인은 지우지 않고 경고를 냄) |

```bash
$ erdd library import demo-edit.erdd-lib.yaml --library "데모 사전" --server http://127.0.0.1:3001 --dry-run
데모 사전 (전역)
  추가 0 · 갱신 1 · 그대로 11 · 삭제 0 (--prune 이 없어 파일에 없는 1건은 남김)
  오래된 파일 1 — 건너뜀 (--include-stale 로 덮어쓰기):
    단어 번호  (서버 v2, 파일 v1)
미리보기입니다 — 반영하지 않았습니다

$ erdd library import demo-edit.erdd-lib.yaml --library "데모 사전" --server http://127.0.0.1:3001 --prune --include-stale --dry-run
데모 사전 (전역)
  추가 0 · 갱신 2 · 그대로 11 · 삭제 1
  오래된 파일 1 — 덮어씀:
    단어 번호  (서버 v2, 파일 v1)
미리보기입니다 — 반영하지 않았습니다
```

- **`--dry-run`** — 계획만 보여 주고 아무것도 쓰지 않습니다.
- **`--yes`** — 미리보기 없이 바로 적용합니다. 결과 줄에 「반영했습니다」 가 붙지 않습니다(확인을 거치는 경로에는
  붙습니다). 적용됐는지는 종료 코드(`0`)와 위 요약 수치로 판단하세요.
- **`--yes` 도 `--dry-run` 도 없으면** 계획을 보여 주고 `가져올까요? [y/N]` 로 한 번 묻고, 예라고 하면 같은 요약
  뒤에 `반영했습니다` 를 찍습니다.

  ```bash
  $ erdd library import demo-edit.erdd-lib.yaml --library "데모 사전" --server http://127.0.0.1:3001 --include-stale
  데모 사전 (전역)
    추가 0 · 갱신 1 · 그대로 12 · 삭제 0
    오래된 파일 1 — 덮어씀:
      단어 번호  (서버 v2, 파일 v1)
  가져올까요? [y/N] y
  데모 사전 (전역)
    추가 0 · 갱신 1 · 그대로 12 · 삭제 0
    오래된 파일 1 — 덮어씀:
      단어 번호  (서버 v2, 파일 v1)
  반영했습니다
  ```

  **이 확인을 기다리는 사이 다른 사람이 먼저 적용했으면** `CONFLICT` 로 거절합니다
  (`미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요 — 아무것도 반영하지 않았습니다`, `1`). 다시 실행해
  새 미리보기부터 시작하세요. 미리보기 없이 바로 적용하는 `--yes` 경로에는 이 확인이 없습니다.
- **`--create <이름> --scope <global|org>`** — 새 라이브러리를 만들고 파일 전체를 추가로 적용합니다
  (`init --create` 와 다른 명령입니다). `--scope` 없는 `--create` 는 거절합니다
  (`--create 에는 --scope <global|org> 가 필요합니다`, `2`). `--scope org` 에는 `--org <이름|id>` 가 필요합니다
  (`--scope org 에는 --org <이름|id> 가 필요합니다`, `2`).

  ```bash
  $ erdd library import standard.erdd-lib.yaml --create "데모 사전" --scope global --server http://127.0.0.1:3001 --yes
  데모 사전 (전역, 새로 만듦)
    추가 14 · 갱신 0 · 그대로 0 · 삭제 0
  ```

- **`--prune`** — 파일이 언급한 종류의 기존 항목 중 파일에 없는 것을 지웁니다. 없으면 그 항목은 남고 요약 줄에
  `(--prune 이 없어 파일에 없는 N건은 남김)` 이 붙습니다. 남는 용어가 가리키는 도메인은 `--prune` 이어도 지우지
  않고 경고를 냅니다.
- **`--include-stale`** — 오래된 파일 항목도 파일의 값으로 덮어씁니다. 서버가 앞서 나간 값을 되돌리는 것이라
  기본으로 꺼져 있습니다.
- **잘못된 파일은 거절합니다**(`1`). 파일 검사는 CLI 안에서 끝나므로 가져오기 자체(`resource.library.import`)는
  부르지 않습니다. **다만 `--library` 는 라이브러리 목록을 이미 받아 온 뒤에 파일을 검사합니다.** 「서버를 전혀
  부르지 않는다」는 뜻은 아닙니다(`--create --scope global` 만 받아 오지 않고 바로 검사합니다). 라이브러리 파일이면
  `라이브러리 파일 오류 N건 — 아무것도 반영하지 않았습니다` 뒤에 문제 줄이 이어집니다. Excel 이면
  `Excel 오류 N건 — 아무것도 반영하지 않았습니다` 뒤에 시트와 행이 이어집니다.
- `--library` 로 지목한 라이브러리에 쓸 권한이 없으면 거절합니다(`1`, `<이름> 에 쓸 권한이 없습니다`). 이 판정도
  라이브러리 목록을 받아 온(서버를 부른) **뒤에** 로컬에서 하고, 가져오기 자체는 부르지 않습니다.

**제약** — 적용은 트랜잭션 하나입니다(전부 아니면 전무). 갱신은 항목마다 `UPDATE` 하나이므로 큰 갱신은 느릴 수
있습니다. 자세한 목록은 [../../guides/shared-resources.md](../../guides/shared-resources.md) 의 「알려진 한계」
아래 「파일 내보내기·가져오기」에 있습니다.

### 6.13 `erdd changes`

로컬 모드 전용입니다. 스키마 수정 내역(변경 기록)을 `erdd/changes/` 에 기록합니다. 무엇이고 어떻게 쓰는지는
[로컬 모드 매뉴얼 5.6](local-guide.md#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역)에, 문법은
[변경 기록 문법](../../guides/changeset-format.md)에 있습니다.

```text
erdd changes [--check] [--json]
erdd changes new <name> [--baseline] [--json]
```

| 형태 | 하는 일 | 종료 코드 |
|---|---|---|
| `erdd changes` | 기록 수, 경합 경고, 미기록 변경 미리보기 | `0`. 기록이 깨졌거나 지금 상태로 기록을 만들 수 없으면 `1` |
| `erdd changes --check` | 위와 같고, 미기록 변경이 있으면 실패 | 미기록 변경이 있으면 `1` |
| `erdd changes new <이름>` | 미기록 변경을 `erdd/changes/<시각>_<이름>.erddc` 로 기록 | `0`. 거절되면 `1` |
| `… --baseline` | 첫 기록을 「이미 DB 에 있음」으로 표시 | 기록이 이미 있으면 `1` |

```bash
$ erdd changes
변경 기록 0건 (erdd/changes/)
미기록 변경 1문장 — erdd changes new <이름> 으로 기록합니다

  create table MBR [comment: '회원'] {                              @018f6b0e-0000-7000-8000-000000000001
    column MBR_NO BIGINT [not null, comment: '회원번호']              @018f6b0e-0000-7000-8000-000000000002
    primary key (MBR_NO)
  }

$ erdd changes new "초기 스키마"
기록했습니다: erdd/changes/20260923061230_초기-스키마.erddc (문장 1개)

$ erdd changes
변경 기록 1건 (erdd/changes/)
미기록 변경 1문장 — erdd changes new <이름> 으로 기록합니다

  alter table MBR {                                               @018f6b0e-0000-7000-8000-000000000001
    add column MBR_NM VARCHAR(100) [null, comment: '회원명', after: MBR_NO]  @018f6b0e-0000-7000-8000-000000000003
  }
```

- **디스크의 `erdd/`** 를 봅니다. 저장하지 않은 편집은 들어가지 않고, 있으면 `new` 가 거절합니다.
- `--json` 은 `{ records, pending, warnings, error, unsaved }`(상태) / `{ ok, file, statementCount }`(생성)입니다.
  거절은 오류 봉투에 `reason`(`name`, `empty`, `baseline`, `invalid`, `unsaved`, `local-only`)을 싣습니다.
- 서버에 연결된 프로젝트에서는 `변경 기록은 로컬 모드 전용입니다 …` 로 멈춥니다(`1`).

---

## 7. 동기화와 충돌

### 7.1 3-way 병합

`push` 와 `diff` 는 모델 셋을 비교합니다.

| 이름 | 무엇 | 어디 |
|---|---|---|
| **기준** | 마지막 `pull` 의 모델 | `.erdd/base.json` |
| **로컬** | 지금 `erdd/` 파일의 내용 | 작업 디렉터리 |
| **서버** | 서버의 지금 모델 | `model.get` |

**비교는 필드 단위입니다.**

- 기준 대비 **한쪽만** 바꾼 필드 → 그 값을 채택해 **자동으로 병합합니다.**
- 양쪽이 **서로 다른 값으로** 바꾼 필드만 **충돌**입니다.
- 배열이나 객체인 필드(컬럼 매핑, 인덱스 컬럼 목록 등)는 통째로 값 하나로 다룹니다.

그래서 나와 다른 사람이 같은 테이블을 동시에 고쳐도, 서로 다른 필드를 고쳤다면 충돌이 없습니다.

### 7.2 충돌이 나면

**`push` 가 멈추고 서버는 바뀌지 않습니다.** 충돌을 파일별로 묶고 세 값(기준, 로컬, 서버)을 나란히 보여 줍니다.

```text
충돌 2건 — push를 중단했습니다.

erdd/tables/MBR.yaml
  컬럼 MBR.MBR_NM · logicalName
    기준  회원명
    로컬  회원 이름
    서버  회원성명
  테이블 MBR · comment
    기준  (없음)
    로컬  서비스 가입 회원
    서버  가입 회원 마스터

erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.
```

- `(없음)` — 그 시점에 값이 없었습니다. `(삭제됨)` — 그쪽이 항목 자체를 지웠습니다.
- 항목 전체가 갈렸으면 필드 이름 대신 `로컬에서 삭제, 서버에서 수정` 같은 사유가 나옵니다.
- `--json`(`push`, `diff`)에서는 `conflicts[]` 의 `reason` 이 경우를 알려 줍니다: `field`(필드 값) ·
  `both-added` · `local-delete` · `server-delete` · `duplicate-origin`(아래).

**푸는 방법.**

1. `erdd pull` 로 서버 변경을 받으세요(로컬 변경이 덮어써지므로 남기고 싶은 것은 미리 복사해 두세요).
2. 원하는 값을 파일에서 정리하세요.
3. `erdd diff` 로 확인한 뒤 `erdd push` 하세요.

**같은 공용 사전 항목이 두 번 들어왔을 때(`duplicate-origin`).** 서버 쪽이 라이브러리 항목을 먼저 받았고(다른
사람의 `dict pull` + `push`, 또는 웹 **가져오기**) 이쪽도 `dict pull` 로 받아 push 하면, 두 항목의 id 가 달라
필드 충돌로 잡히지 않습니다. 그대로 올리면 이후 재동기화가 한쪽만 갱신하고 다른 쪽은 옛 값으로 남기므로 `push` 를
막습니다. **막는 것은 이번 push 가 만드는 중복뿐입니다.** 서버에 이미 있는 중복은 이번 push 로 고칠 수 없으므로
막지 않습니다. 무엇을 지울지는 두 경우로 갈립니다.

```text
충돌 1건 — push를 중단했습니다.

erdd/words.yaml
  단어 고객 · 같은 공용 사전 항목이 두 번 들어왔습니다 — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요
    기준  (없음)
    로컬  고객 (id 018f6b0e-0000-7000-8000-0000000000b2) · v1 · 항목 item-1
    서버  고객 (id 018f6b0e-0000-7000-8000-0000000000a1) · v1 · 항목 item-1

erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.
```

| 경로 · 메시지 | 일어난 일 | 할 일 |
|---|---|---|
| 사전 파일(`erdd/words.yaml` 등) · `… — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요` | 로컬에서 **새로 추가한** 항목이 서버 항목과 같은 출처를 가리킴 | 사전 파일에서 그 항목만 지우고 다시 `push` 하세요. 서버의 항목은 `pull` 로 내려옵니다 |
| `erdd/origins.yaml` · `… — 이 항목의 출처 줄을 지워 연결을 풀고 다시 push 하세요` | 로컬에서 **기존 항목에 출처를 붙였는데**(`--adopt` 등) 서버에는 같은 출처의 별도 항목이 있음 | `erdd/origins.yaml` 에서 그 항목의 줄만 지우고 다시 `push` 하세요. 항목을 지우면 서버의 기존 데이터가 지워집니다 |

⚠️ **이 충돌에는 위의 푸는 방법(`erdd pull` 먼저)을 쓰지 마세요.** `pull` 은 로컬 변경을 서버 상태로 덮어쓰므로,
지울 항목이 **다른 로컬 작업과 함께** 사라집니다. 표의 한 줄만 지우고 다시 push 하세요. 값 줄은
`이름 (id …) · 출처` 꼴입니다. 두 항목은 이름이 같은 경우가 많으므로 id 로 어느 쪽을 지울지 가리세요. 「로컬에서
추가함」 경우에는 기준이 `(삭제됨)` 이 아니라 `(없음)` 입니다.

### 7.3 경합 — 서버가 앞서 나갔을 때

계획을 만든 뒤 반영하기 전에 다른 사람이 커밋하면 서버가 거절합니다. **CLI 가 다시 계산해 한 번 자동으로
재시도합니다**(`서버가 앞서 있어 다시 계산합니다`). 두 번째도 거절되면 오류로 끝납니다.

### 7.4 push 가 정상으로 끝나지 않는 세 가지

| 결과 | 일어난 일 | 할 일 |
|---|---|---|
| **충돌**(`ok:false`, `conflicts`) | 서버는 그대로 | 7.2 의 절차 |
| **반영 여부 불명**(`outcomeUnknown:true`) | 연결이 끊겨 요청이 서버에 닿았는지 모름 | **`push` 를 그대로 다시 실행하면** 중복 없이 수렴합니다. 먼저 보고 싶으면 **`erdd diff`** |
| **반영 + 파일 갱신 실패**(`committed:true`, `syncError`) | 서버 반영은 끝났고 그 뒤 자동 pull 이 실패함 | `erdd pull` |

⚠️ **「반영 여부 불명」에서는 `erdd pull` 을 먼저 쓰지 마세요.** push 가 반영되지 않았다면 pull 이 로컬 변경을 서버
상태로 덮어써 지우고, 다시 push 하면 수렴한다는 성질도 잃습니다. `erdd diff` 는 읽기만 하므로 안전합니다.

**다시 push 해도 사본이 생기지 않는 이유** — `push` 는 이번에 발급한 새 `id` 를 서버로 보내기 **직전에** 로컬
파일에 씁니다(디스크 동기화 포함). 그래서 응답을 잃고 같은 내용을 다시 보내도 서버는 같은 `id` 를 「이미 있는
것」으로 보고 수정으로 다룹니다. `--json` 응답의 `reservedFiles` 가 그때 실제로 다시 쓴 파일 목록입니다.

---

## 8. 파일에 담기지 않는 것

**서버와 오가는 파일**(`erdd/tables/*.yaml` 과 최상위 파일 다섯)은 diff 를 깨끗하게 유지하려고 스키마의 **의미
정보만** 담습니다. 다음은 그 파일에 없고, `pull` 과 `push` 도 건드리지 않습니다(서버에 있는 값은 그대로 보존됩니다).

| 스키마 파일에 없는 것 | 다루는 곳 |
|---|---|
| 테이블 배치 좌표(캔버스 위치, 그룹 뷰 좌표) | 서버 DB 쪽은 웹 에디터. `erdd serve` 로 옮긴 것은 **모드와 무관하게 `erdd/layout.yaml`** 에 갑니다(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)) |
| 메모 | 위와 같음 |

**공용 사전 출처는 여기 속하지 않습니다.** 사전 파일 옆의 `erdd/origins.yaml` 에 있고, `pull` 과 `push` 가 서버와
주고받습니다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)).

⚠️ **`erdd/layout.yaml` 도 서버와 오가지 않습니다.** `erdd serve` 로 옮긴 좌표는 `push` 해도 서버에 반영되지 않고,
`pull` 은 그 파일을 덮어쓰지 않습니다. **서버 모드에서도 그렇습니다.** 서버 쪽 배치를 맞추려면 웹 에디터를 쓰세요.

에이전트는 「좌표를 옮겨 줘」, 「메모를 남겨 줘」 같은 요청을 **스키마 파일**(`erdd/tables/*.yaml` 과 최상위 파일
다섯)에서 처리하려 해서는 안 됩니다. 그 정보는 거기 없습니다. 자리는 **모드와 무관하게** `erdd/layout.yaml` 이고,
사람이 `erdd serve` 화면에서 옮길 때 거기 쌓입니다. **그 파일을 찌꺼기로 지우지 마세요.** 메모의 글도 들어
있습니다.

---

## 9. AI 에이전트와 함께 쓰기

### 9.1 스킬 설치

```bash
erdd skill install                 # .claude/skills/erdd/SKILL.md
erdd skill install --dir .agent/skills/erdd --force
```

**문서는 두 모드를 모두 다룹니다.** 맨 처음 에이전트에게 `erdd.config.yaml` 의 `serverUrl` 로 모드를 판정하게
하고(`projectId` 와 함께 값이 있으면 서버 모드, 둘 다 `null` 이거나 키가 없으면 로컬 모드, 하나만 있으면 설정
오류 → [3.4](#34-로컬-모드--서버-없이-쓰기)), 모드마다 다른 워크플로와 금지 사항을 나눕니다. 로컬 전용
프로젝트에 설치해도 에이전트가 `pull` 이나 `push` 를 시도하다 종료 코드 `1` 로 막히지 않습니다.

설치된 문서는 에이전트에게 다음을 지시합니다.

- **스키마를 알아야 하면 마이그레이션이나 ORM 코드를 뒤지지 말고 `erdd/` 파일을 읽으세요.**
- **모드부터 판정하세요.** 진실 원본은 서버 모드에서는 서버, 로컬 모드에서는 `erdd/` 파일 자체입니다.
- 편집 워크플로: 서버 모드는 `pull` → 편집 → `validate` → `diff` → `push`, 로컬 모드는 편집 → `validate` →
  **git commit**(`pull`, `push`, `diff` 가 종료 코드 `1` 로 멈춘다는 것도 알려 줍니다).
- **로컬 모드에서는 `status` 로 변경을 확인하지 마세요.** 기준 시점이 없어 늘 「로컬 변경 없음」 을 알립니다
  (→ [6.3](#63-erdd-status)). `git status` 와 `git diff` 로 비교하세요.
- **물리명을 지어내지 마세요.** ① `terms.yaml` 에서 논리명이 같은 용어의 물리명을 그대로 쓰세요. ② 없으면
  `words.yaml` 의 단어를 조합하세요(회원 `MBR` + 번호 `NO` → `MBR_NO`). ③ 조합에 필요한 단어가 사전에 없으면
  `words.yaml` 에도 등록하세요.
- 컬럼 타입은 되도록 `domain` 으로 정하세요(방언별 타입, 기본값, 허용값이 함께 따라옵니다).
- `custom-fields.yaml` 에 `required: true` 인 항목이 있으면 대상의 `custom` 에 값을 채우세요.
- **하지 말 것(두 모드 공통)** — 기존 `id` 를 바꾸거나 지우기, 복사한 파일에 `id` 남기기(`validate` 가 종료 코드
  `1` 로 막습니다), 테이블 파일 이름을 직접 바꾸기, `.erdd/` 고치기, **좌표를 손으로 고치기**(`erdd serve` 화면에서
  옮기세요. 좌표는 스키마 파일에 없습니다).
- **`erdd/layout.yaml` 은 모드와 무관하게 `erdd serve` 로 편집하면 생기는 커밋 대상 파일이고**, 메모의 글도 들어
  있습니다. 찌꺼기로 지우지 마세요. 다만 서버와 오가지 않습니다.
- **두 모드 모두 `id` 는 CLI 가 발급합니다.** 서버가 아닙니다.
- **모드마다 다른 것** — 공용 사전 출처(`erdd/origins.yaml`)와 `erdd dict` 는 서버 모드에만 해당합니다. 에이전트에게
  **출처 파일을 손으로 고치지 말라고** 알립니다(사전 항목을 지우면 그 줄은 다음 저장 때 정리됩니다).

### 9.2 에이전트에게 쥐여 줄 때의 요령

- **토큰은 `ERDD_TOKEN` 으로 주세요.** 파일에 있으면 에이전트가 읽어 로그에 흘릴 수 있습니다.
- **비대화형에서는 `--json --yes` 를 함께 주세요.** `--json` 만 주면 삭제가 든 push 가 확인 프롬프트를 띄울 수
  없어 멈춥니다.
- **push 전에 늘 `validate` 를 돌리게 하세요.** 서버를 부르지 않으므로 비용이 없고, 명명 규칙 위반을 미리 잡습니다.
- 권한은 토큰 발급자의 역할을 따릅니다. 에이전트에게 읽기만 시키려면 **Viewer 계정에서 발급한 토큰**을 주세요.
  **에이전트에게 조직 관리자의 토큰을 주지 마세요.** 그 토큰이면 `erdd dict push` 가 승인 없이 조직 라이브러리를
  바꾸고, `erdd init --create` 가 프로젝트를 만듭니다(→ [3.1](#31-개인-액세스-토큰-발급)).

---

## 10. 자동화와 CI

### 10.1 `--json` 규약

- **stdout 은 늘 파싱할 수 있는 JSON 블록 하나입니다.** 진행 메시지, 프롬프트, 확인 질문은 모두 stderr 로 가므로
  `command --json 2>/dev/null | jq` 가 안전합니다.
- 실패도 같은 규약을 따릅니다. stdout 에 오류 봉투가 나옵니다.

```bash
$ erdd status --json          # in a directory without erdd.config.yaml
{"error":{"code":"NO_CONFIG","message":"erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요"}}
$ echo $?
1
```

**오류 코드.**

| `code` | 뜻 | 종료 코드 |
|---|---|---|
| `USAGE` | 명령·인자 사용법 오류 | `2` |
| `NO_CONFIG` | `erdd.config.yaml` 이 없음 | `1` |
| `UNAUTHORIZED` | 토큰이 없거나 동작하지 않음 | `1` |
| `FORBIDDEN` | 권한 없음 | `1` |
| `NOT_FOUND` | 조직·프로젝트·라이브러리를 찾지 못함 | `1` |
| `VALIDATION` | 파일이나 입력이 잘못됨 | `1` |
| `CONFLICT` | 서버가 앞서 나감(재시도 뒤에도) | `1` |
| `CANCELLED` | 사용자가 취소했거나 확인이 필요함 | `1` |
| `NETWORK` | 연결·응답 파싱 실패, 그 밖의 오류 | `1` |

⚠️ **에이전트나 스크립트가 `code` 로 재시도 여부를 가른다면** `NETWORK` 만 재시도 대상으로 보세요. `VALIDATION`
과 `FORBIDDEN` 은 같은 명령을 몇 번 돌려도 영원히 실패합니다.

**`export` JSON.** `content` 와 `path` 는 **서로 배타적**입니다. 같은 본문을 둘 다에 넣지 않습니다. `-o` 를 주면
본문은 그 파일에 있으므로 `content` 가 `null` 이고, 주지 않으면 `path` 가 `null` 입니다.

```bash
$ erdd export --json
{"format":"ddl","dialect":"mysql","path":null,
 "content":"CREATE TABLE mbr (\n  mbr_no BIGINT AUTO_INCREMENT NOT NULL COMMENT '회원번호',\n …",
 "warnings":[]}

$ erdd export --json -o out.sql
{"format":"ddl","dialect":"mysql",
 "path":"/path/to/my-project/out.sql","content":null,"warnings":[]}
```

| 키 | 뜻 |
|---|---|
| `format` | `"ddl"` 또는 `"dbml"` |
| `dialect` | 실제로 쓴 방언 |
| `path` | `-o` 로 쓴 **절대 경로**. `-o` 가 없으면 `null` |
| `content` | 출력 본문. `-o` 면 `null` |
| `warnings` | 내보내기 경고 문자열 배열(사람용 출력에서는 stderr 에도 갑니다) |

**`import` JSON.**

```bash
$ erdd import ../a/schema.sql --dry-run --json
{"ok":true,"format":"ddl","dialect":"mysql","dialectSource":"본문에서 감지",
 "dryRun":true,"added":2,"columns":5,"indexes":1,"relationships":1,"groups":0,
 "skipped":[],"warnings":[],"written":[],"deleted":[]}

$ erdd import ../a/schema.sql --yes --json
{"ok":true,"format":"ddl","dialect":"mysql","dialectSource":"본문에서 감지",
 "dryRun":false,"added":2,"columns":5,"indexes":1,"relationships":1,"groups":0,
 "skipped":[],"warnings":[],
 "written":["erdd/custom-fields.yaml","erdd/domains.yaml","erdd/groups.yaml",
            "erdd/tables/mbr.yaml","erdd/tables/ord.yaml","erdd/terms.yaml","erdd/words.yaml"],
 "deleted":[]}
```

| 키 | 뜻 |
|---|---|
| `format`, `dialect` | 실제로 쓴 형식과 방언 |
| `dialectSource` | 방언을 고른 이유: `"--dialect"` · `"본문에서 감지"` · `"Project의 database_type"` · `"erdd.config.yaml의 dialects[0]"` |
| `dryRun` | `--dry-run` 이었는지. `true` 면 `written` 과 `deleted` 는 늘 `[]` |
| `added` | **새로 만든** 테이블 수(건너뛴 것은 세지 않음) |
| `columns`, `indexes`, `relationships`, `groups` | 새 테이블과 함께 만든 수 |
| `skipped` | 이름 중복으로 **건너뛴** 테이블 이름(가져온 파일의 원래 이름) |
| `warnings` | `{kind, target, message}` 배열: `table-conflict`, `unknown-type`, `unknown-word`, `unresolved-fk`, `unresolved-index` 등 |
| `written`, `deleted` | 실제로 쓰거나 지운 파일 경로(저장소 기준) |

**`dict pull` JSON.** 라이브러리마다 보고 하나입니다. 보류한 충돌이 있어도 종료 코드는 `0` 입니다. 충돌은 오류가
아니라 계획의 결과이기 때문입니다.

```bash
$ erdd dict pull --json
{"libraries":[{"id":"01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341","name":"플랫폼팀 표준 사전","scope":"org",
  "missing":false,"added":0,"autoUpdated":0,"adopted":0,"nameClashSkipped":[],"adoptDiffers":[],
  "unlinkable":[],"conflicts":[{"kind":"단어","name":"고객","fields":["abbreviation"],"decision":"defer"}],
  "kept":5,"detached":0}],
 "written":[],"deleted":[],"dryRun":false}
```

| 키 | 뜻 |
|---|---|
| `libraries[].missing` | 구독했지만 찾을 수 없어 건너뜀(`scope` 는 `null`) |
| `added`, `autoUpdated`, `adopted`, `kept`, `detached` | 추가, 자동 갱신, 연결, 유지, 원본에서 사라짐의 수 |
| `nameClashSkipped`, `unlinkable` | 이름 중복으로 건너뛴 이름(`--adopt` 로 연결됨) / 연결할 수 없는 이름: `[{ kind, name }]` |
| `adoptDiffers` | 내용이 달라 연결하지 않은 이름 중복: `[{ kind, name, fields }]`(`fields` 는 다른 필드 키). `--adopt --conflicts ours` 로만 연결됨 |
| `conflicts[].decision` | `defer`(보류) · `apply`(`--conflicts theirs`) · `keep`(`--conflicts ours`) |
| `written`, `deleted` | 실제로 쓰거나 지운 파일. `dryRun` 이면 늘 `[]` |

**`dict push` JSON.** `mode` 로 갈립니다.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --json --yes
{"mode":"promote","ok":true,"seq":3,"inserted":1,"updated":0,"skipped":[],
 "behind":[{"kind":"word","name":"고객","entityId":"01a0cc74-e6c9-7367-a79d-81162824677e"}],
 "danglingDomain":[]}
```

| 경우 | 봉투 |
|---|---|
| 직접 승격 성공 | `{ mode: "promote", ok: true, seq, inserted, updated, skipped, behind, danglingDomain }` |
| 전부 건너뜀(종료 `1`) | `{ mode: "promote", ok: false, … }` |
| 승격 + 자동 pull 실패(종료 `1`) | `{ mode: "promote", ok: false, committed: true, syncError, … }`. **다시 push 하지 말고 `erdd pull` 을 실행하세요** |
| 승격 요청 | `{ mode: "request", id, requested, dropped, behind, danglingDomain }` |
| 올릴 것이 없음(종료 `0`) | `{ libraryId, selected: 0, behind }` |

모든 봉투에 **`behind`** 가 있습니다: 라이브러리 원본이 앞서 빠진 항목의 `[{ kind, name, entityId }]`(없으면
`[]`). **`danglingDomain`** 은 도메인 연결이 비워질 용어의 `[{ name, domain }]`(용어 이름과 도메인 이름. 없으면
`[]`)입니다. 올릴 것이 없는 봉투에는 없습니다. 선택이 없으면 비울 연결도 없기 때문입니다.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --name 고객 --json --yes
{"libraryId":"01a0cc72-fdd9-7a07-8d16-75937f36cd3d","selected":0,
 "behind":[{"kind":"word","name":"고객","entityId":"01a0cc73-5ea4-7256-94f1-4864bf41a9c9"}]}
```

`dict list --json` 은 라이브러리 배열이고(`canWrite`, `subscribed` 포함. 서버 라이브러리 행에는 종류별 항목 수
`countsByKind` 도 있습니다), `dict requests --json` 은 요청 배열입니다(`status`, `note`, `resolutionNote`,
`approvedEntityIds` 포함). `init --create` 의 JSON 은 [6.1](#61-erdd-init)에, `push` 의 `detachedOrigins` 는
[6.6](#66-erdd-push)에 있습니다.

⚠️ 파일 파싱 오류가 나면 `export` 와 `import` 모두 **`validate` 와 같은 봉투**
(`{ok:false, parseErrors, integrityIssues, warnings}`)를 종료 코드 `1` 로 찍습니다. 오류 봉투
(`{error:{code,…}}`)가 아닙니다.

### 10.2 CI 예시

스키마 파일이 서버와 어긋난 채로 병합되는 것을 막습니다.

```bash
#!/usr/bin/env bash
set -euo pipefail
export ERDD_TOKEN="$ERDD_CI_TOKEN"

# 1) Check the files themselves without a server; treat warnings as failures too
erdd validate --strict --json > validate.json || {
  echo "Schema file check failed"; cat validate.json; exit 1
}

# 2) Check for conflicts with the server; fail on conflict
erdd diff --strict --json > diff.json || {
  echo "Conflicts with the server. Sort them out with erdd pull and push again"; cat diff.json; exit 1
}
```

**반영까지 자동화하려면** `--yes` 가 필요합니다(삭제 확인 프롬프트를 띄울 수 없습니다).

```bash
erdd push --json --yes -m "CI: ${GIT_COMMIT:0:8}"
```

⚠️ **CI 에 `push` 를 넣기 전에 신중하게 정하세요.** 서버가 진실 원본이라, 웹에서 진행 중인 편집과 경합하면 CI 가
사람의 작업을 되돌릴 수 있습니다. 보통은 CI 에 `validate` 와 `diff` 만 넣고 `push` 는 사람에게 맡기세요.

---

## 11. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `sh: tsx: command not found`(종료 코드 127) | 프로젝트에 `tsx` 가 없음. **빠뜨렸을 때의 증상은 패키지 매니저마다 다릅니다.** pnpm 은 `npx` 가 그때그때 받아 와 **대개 돌아가지만** 네트워크가 없으면 실패합니다. 평평한 npm 배치는 캐시가 없으면 `ENOTCACHED` 로 실패합니다 | `pnpm add -D tsx` (→ [2.1](#21-요구-사항)) |
| `pnpm exec erdd …` 가 `ERR_PNPM_IGNORED_BUILDS`(`esbuild`)로 실패 | **pnpm 11 의 동작입니다.** `pnpm exec` 가 먼저 `pnpm install` 을 돌려 의존성 상태를 확인하는데, 빌드 스크립트가 승인되지 않은 패키지(`tsx` 가 끌어오는 `esbuild`)가 있으면 그 설치가 실패합니다. `@erdd/cli` 와 무관하고 pnpm 10 에서는 생기지 않습니다 | pnpm 이 제안하는 대로 `pnpm approve-builds` 로 `esbuild` 를 승인하세요. 그 전에도 **`./node_modules/.bin/erdd` 를 직접 부르면 동작합니다**(실측 확인) |
| ERDD 저장소에서 `packages/cli/src/main.ts` 가 `old mode 100644 / new mode 100755` 로 보임 | 방법 C 설치가 bin 진입점에 실행 비트를 붙임 | `chmod 644 packages/cli/src/main.ts`. 커밋하지 마세요 |
| `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요` | 프로젝트 루트 밖에서 실행했거나 아직 연결하지 않음 | 프로젝트 루트로 옮기거나 `erdd init` |
| `토큰이 없습니다. ERDD_TOKEN을 설정하거나 erdd init을 실행하세요` | 환경 변수도 `.erdd/credentials.json` 도 없음 | 둘 중 하나를 채우세요 |
| `code: "UNAUTHORIZED"` | 토큰이 폐기됐거나 오타 | 웹의 **설정 → 액세스 토큰**에서 다시 발급하세요 |
| `code: "FORBIDDEN"` | 발급자에게 그 프로젝트 권한이 없음 | 프로젝트 멤버와 역할을 확인하세요. 토큰을 바꿔도 권한은 넓어지지 않습니다 |
| `서버 응답에 result가 없습니다 … serverUrl이 ERDD 서버를 가리키는지 확인하세요` | `serverUrl` 이 다른 서버나 프록시를 가리킴 | `erdd.config.yaml` 의 `serverUrl` 을 고치세요 |
| `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` | `.erdd/base.json` 이 없음(클론 직후 등) | `erdd pull` |
| `.erdd/base.json이 손상됐습니다. erdd pull로 다시 받으세요` | 기준 시점 파일이 손상됨 | `erdd pull` |
| 손대지 않은 파일이 `status` 에 로컬 변경으로 보임 | `pull` 이 도중에 끊김 | `erdd pull --yes` 로 다시 받으세요 |
| `id …가 …에도 있습니다` | 파일을 복사하고 `id` 를 지우지 않음 | 사본의 `id` 를 모두 지우세요(→ [5.6](#56-id-취급--가장-흔한-사고)) |
| `… 항목 하나가 두 번 나타납니다 — YAML anchor/alias …` | 앵커나 별칭을 씀 | 별칭을 풀어 적으세요 |
| `erdd/ 아래에 파일이 없습니다 …` | `erdd/` 를 통째로 지움 | 실수면 `erdd pull`. 의도라면 파일을 개별로 지우세요 |
| `변경이 N건으로 … 5000건을 넘습니다` | 한 번에 너무 많음 | 나눠서 push 하세요 |
| push 뒤 `반영은 성공했습니다 … 파일 갱신에 실패했습니다` | 반영은 끝났고 자동 pull 만 실패함 | `erdd pull` |
| push 가 `반영 여부를 확인할 수 없습니다` 를 알림 | 전송 계층 실패 | `erdd diff` 로 확인한 뒤 `push` 를 그대로 다시 하세요. **`pull` 을 먼저 쓰지 마세요** |
| 웹에서 방언이나 명명 규칙을 바꿨는데 `validate` 결과가 다름 | 로컬 `erdd.config.yaml` 이 낡음 | `erdd pull` |
| 파일 이름에 `MBR.1a2b3c4d.yaml` 처럼 접미가 붙음 | 물리명이 대소문자만 다른 테이블이 있음 | 정상 동작입니다. 이름을 구별되게 바꾸면 접미가 사라집니다 |
| `erdd.config.yaml에 연결 설정이 없습니다 …` | 로컬 전용 프로젝트에서 `pull`, `push`, `diff` 를 실행함 | 서버에 연결하려면 `erdd init`, 로컬에서 작업하려면 `erdd serve` (→ [3.4](#34-로컬-모드--서버-없이-쓰기)) |
| `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다 …` | 둘 중 하나만 적음 | 둘 다 적거나 둘 다 지우세요(둘 다 없으면 로컬 전용입니다) |
| `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` | `init --local` 을 실행했는데 config 가 이미 있음 | 기존 파일을 지우고 다시 실행하세요. `--yes` 로도 덮어쓰지 않습니다 |
| `erdd serve` 는 떴는데 브라우저에 `{"message":"Route GET:/p/… not found"…}` 만 보임 | 웹 번들이 없음(저장소 배치를 쓸 때만 생깁니다. 레지스트리 설치본에는 번들이 들어 있습니다) | ERDD 체크아웃에서 `pnpm -C apps/web build` |
| 웹 앱을 고치고 다시 빌드했는데 화면이 바뀌지 않음 | 브라우저나 vite 캐시, 또는 `erdd serve` 를 다시 띄우지 않음. **`packages/cli/web` 에 남은 것 때문이 아닙니다.** 저장소에서는 `apps/web/dist` 가 늘 이깁니다 | `erdd serve` 를 다시 띄우고 새로 고치세요 |
| `포트 4300이 이미 사용 중입니다 …` | 다른 `erdd serve` 나 다른 프로그램이 그 포트를 잡고 있음 | `--port` 로 다른 포트를 주세요 |
| 브라우저 위쪽에 **파일을 읽을 수 없어 편집이 잠겼습니다** 배너가 나오고 편집할 수 없음 | `erdd/` 의 YAML 이 깨짐 | 배너가 가리키는 파일을 고치세요. 고치면 자동으로 풀립니다 |
| `erdd serve` 화면에서 테이블이 격자로 나란히 놓임(어느 모드든) | `erdd/layout.yaml` 이 없거나 그 테이블의 항목이 없음 | 정상입니다. 테이블을 옮기거나 **자동 정렬**을 실행하면 좌표가 그 파일에 저장됩니다 |
| `변경 기록은 로컬 모드 전용입니다 …` | 서버에 연결된 프로젝트에서 `erdd changes` 를 실행함 | 서버 모드에는 변경 기록이 없습니다 |
| `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요` | 서버가 CLI 보다 오래돼 `erdd dict` 와 `init --create` 가 부르는 기능을 토큰에 열지 않음 | 서버 관리자에게 서버 업그레이드를 요청하세요. 토큰을 다시 발급해도 소용없습니다 |
| `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 …` | 로컬 전용 프로젝트에서 `erdd dict` 를 실행함 | `erdd init --server … --create` (→ [6.1](#61-erdd-init)) |
| `서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요` | `erdd library` 명령에 `--server` 가 없고 연결된 프로젝트 안도 아님 | `--server <url>` 을 주거나 서버에 연결된 프로젝트 디렉터리에서 실행하세요(→ [6.12](#612-erdd-library--라이브러리-관리)) |
| `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` | `dict push` 전에 로컬 변경이 서버에 없음 | `erdd push` 뒤 `dict push` 를 다시 |
| `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` | `dict push` 전에 서버가 바뀜(다른 사람의 편집, 승인된 승격 등) | `erdd pull` 뒤 `dict push` 를 다시 |
| `파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤 구독의 file 을 지우세요` | `dict push` 의 대상 라이브러리가 파일 구독(`dictionaries[].file`)임 | `erdd.config.yaml` 에서 그 구독의 `file` 줄을 지우고, `erdd dict pull --library` 로 서버 구독으로 다시 받은 뒤 `dict push` (→ [5.2](#52-erddconfigyaml)) |
| `구독한 라이브러리가 없습니다 …` | 인자 없는 `dict pull` 인데 구독이 없음 | `erdd dict pull --library <이름\|id>` |
| `dict pull` 이 충돌을 계속 보류로 보여 줌 | 로컬에서 바꿨고 원본도 바뀜 | `--conflicts theirs`(원본 값으로) 또는 `--conflicts ours`(로컬 값 유지) |
| `dict pull --adopt` 가 `이름 중복 N — 내용이 달라 연결하지 않음 …` 을 보이고 연결하지 않음 | 이름이 같은 로컬 항목의 내용이 원본과 다름 | 로컬 값을 유지하려면 `--adopt --conflicts ours`. 원본 값으로 바꾸려면 로컬 항목을 지우고 `dict pull` 을 다시(→ [6.11](#611-erdd-dict--공용-사전)) |
| `dict pull --file` 이 `서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) …` 로 거절 | 사람이 쓴 원본 파일이나 Excel 에서 바꾼 파일을 줌 | `library export` 나 웹 **내보내기**로 만든 배포 파일을 쓰세요(→ [6.12](#612-erdd-library--라이브러리-관리)) |
| `dict pull` 이 `구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<id>)입니다 …` 로 거절 | 파일 구독의 경로를 다른 라이브러리에서 내보낸 파일로 덮어씀 | `erdd.config.yaml` 에서 그 구독 줄을 지우고 `erdd dict pull --file <경로>` 로 다시 받으세요 |
| push 나 diff 가 `같은 공용 사전 항목이 두 번 들어왔습니다 — …` 로 멈춤 | 서버가 이미 받은 라이브러리 항목을 로컬이 따로 받음 | 메시지대로 그 항목(또는 `origins.yaml` 의 그 줄)만 지우고 다시 `push` 하세요. **먼저 `pull` 하지 마세요**(→ [7.2](#72-충돌이-나면)) |
| `프로젝트 생성 권한이 없습니다 — …` | `init --create` 는 조직 Owner/Admin 만 됨 | 메시지대로 관리자에게 프로젝트를 만들어 달라고 하세요(→ [6.1](#61-erdd-init)) |
| `이미 서버 프로젝트에 연결돼 있습니다 …` | 연결된 프로젝트에서 `init --create` 를 실행함 | 다른 프로젝트로 바꾸려면 `erdd init --project <id> --yes` |
| `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` | `pull` 이나 `init --create`(이관)가 확인이 필요했는데 `--json` 이라 물을 수 없었음 | stderr 의 덮어쓸 목록을 보고 `--yes` 를 주세요 |
| `origins[N]의 형식이 올바르지 않습니다 …` 등 | `erdd/origins.yaml` 을 손으로 고침 | `erdd pull` 로 다시 받으세요(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)) |

---

## 부록: 검증 상태

**아래 항목은 저마다 다른 구성으로 따로 확인했습니다.** 절마다 어떻게 확인했는지 적었습니다. 항목과 이 매뉴얼
본문이 다르면 본문이 지금의 설명입니다.

**실제 명령으로 확인한 것.** 격리된 임시 프로젝트를 만들고 `@erdd/cli` 를 파일 의존성으로 설치해 명령을
실행했습니다.

- `pnpm add <path>/packages/cli` 가 `node_modules/.bin/erdd` 링크를 만드는 것, 그리고 **`tsx` 가 없으면
  `sh: tsx: command not found`(종료 코드 127)로 실패하고 `pnpm add -D tsx` 뒤에 동작하는 것**.
  ⚠️ **따로 잰 측정에서는 `npx` 가 `tsx` 를 그때그때 받아 와 동작했습니다**(종료 코드 `0`). 다만 **설치 형태가
  달랐습니다.** 그 측정은 팩한 tarball 을 `npm install <tarball>` 로 설치한 임시 디렉터리였고, 위 줄은
  `pnpm add <path>/packages/cli` 입니다. 어느 쪽도 틀리지 않았습니다. **네트워크, 캐시, 패키지 매니저에 달려
  있습니다.** 무엇을 설치해야 하는지의 정확한 설명은 [2.1](#21-요구-사항)에 있습니다.
- 이 설치가 **ERDD 저장소의 `packages/cli/src/main.ts` 모드를 100644 에서 100755 로 바꾸는 것**
  (`git status` 에 보입니다. 확인 뒤 되돌렸습니다).
- `--help` 전체 출력(2.5 절이 실제 출력 그대로입니다).
- 설정이 없는 디렉터리에서 `status` 의 사람용·`--json` 출력과 종료 코드 `1`, 오류 봉투
  `{"error":{"code":"NO_CONFIG",…}}`.
- 최소 트리(`erdd.config.yaml` + 테이블 1개 + 최상위 파일 5개)에서 `validate` 의 사람용·`--json` 출력, 미등록 단어
  경고 3건, **`--strict` 가 종료 코드를 `1` 로 바꾸는 것**, `status` 의 사람용 출력.
- 기준 시점이 없을 때 `diff` 가 서버를 부르기 전에 `기준 시점이 없습니다…` 로 멈추는 것(종료 코드 `1`).
- `skill install` 의 설치, 재실행 거절(`1`), `--force` 덮어쓰기, `skill` 하위 명령이 빠졌을 때의 사용법 오류(`2`),
  `init --json --yes` 의 인자 누락 오류(`2`).

**서버를 붙여 확인하지 못한 것.** `init` 의 조직·프로젝트 선택, `pull`·`push`·`diff` 의 실제 서버 왕복, 충돌 출력,
경합 재시도, push 의 비정상 종료 셋은 **소스와 단위 테스트를 읽고 옮겼고**, 실제 환경에서 확인이 더 필요합니다.
인용한 출력은 구현과 테스트 기대값에서 그대로 가져왔습니다.

### 로컬 모드

**실제 명령으로 확인한 것.** 스크래치 디렉터리에 로컬 전용 프로젝트를 만들고 명령을 실행했습니다.

- `erdd init --local` 의 출력, **`erdd.config.yaml` 과 `.gitignore` 만 만드는 것**(`erdd/` 는 만들지 않음),
  초기 config 내용(3.4 절이 실제 파일 그대로입니다), 재실행이 `erdd.config.yaml이 이미 있습니다…` 로 멈추는 것(`1`).
- 로컬 전용 프로젝트에서 `status` 의 사람용·`--json` 출력(6.3 절과 같음), `pull`·`push`·`diff` 가
  `erdd.config.yaml에 연결 설정이 없습니다…` 로 멈추는 것(`1`), `validate` 가 그대로 동작하는 것.
- `erdd serve --no-open --port 4399` 의 stderr 두 줄(3.4·6.8 절과 같음), `/` 가
  `/p/00000000-0000-7000-8000-000000000000` 으로 302 를 돌려주는 것, 같은 포트로 다시 실행하면
  `포트 4399이 이미 사용 중입니다…`(`1`), `--port abc` 의 사용법 오류(`2`), `--help` 전체(2.5 절).
- 연결 설정이 있어도 `.erdd/base.json` 이 없으면 `push` 가 `기준 시점이 없습니다…` 로 멈추는 것(`1`)(3.4 절의
  이관 주의).

**브라우저로 확인한 것**(로컬 모드 사이클의 스모크 11개 항목) — `/` 가 에디터로 가고 로그인 화면이 나오지 않는 것,
테이블과 컬럼을 만들면 `erdd/tables/*.yaml` 과 최상위 파일 5개가 생기는 것, **드래그는 `erdd/layout.yaml` 만 바꾸고
테이블 YAML 은 그대로 두는 것**, 메모가 `layout.yaml` 의 `notes` 에 들어가는 것, **공용 리소스**·참여자·사용자
메뉴가 없는 것, **버전**에 **스냅샷**과 **비교**만 있고 **이력**은 없는 것, 스냅샷 만들기·복원과
`erdd/snapshots/`, 터미널에서 파일을 고치면 **새로 고침 없이** 화면이 바뀌는 것, 파일을 깨뜨리면 배너 + **읽기
전용**으로 바뀌고 되돌리면 풀리는 것, `Ctrl+C` 뒤 `serve` 를 다시 띄워도 좌표와 메모가 남는 것.

**근거** — `packages/cli`(`main.ts`, `commands/*`, `local/*`, `plan.ts`, `tree.ts`, `client.ts`, `config.ts`,
`output.ts`), `packages/core/src/{file-format,layout,local}.ts`, `apps/server/src/routers/*`(토큰에 허용한
프로시저), `apps/web` 의 로컬 모드 분기.
기능이 바뀌면 이 문서도 함께 바뀌어야 합니다.

### 레지스트리 게시

**패키지 형태로 확인한 것.** `pnpm pack` 으로 만든 tarball 을 별도 소비자 프로젝트에 설치해 실행했습니다.

- tarball 에 **원본 TypeScript 와 웹 번들이 모두 들어 있는 것**: `@erdd/cli` 에 파일 127개(그중 `web/` 에 101개,
  `*.test.ts` 0개), `@erdd/core` 에 39개. `workspace:^` 가 실제 버전(`^0.1.0`)으로 바뀌는 것, `engines.node` 가
  `>=22` 로 들어 있는 것.
- 설치본에서 `erdd --help`, `erdd init --local`, `erdd validate` 가 정상 동작하는 것(종료 코드 `0`).
- 설치본에서 `erdd serve` 가 뜨고, **웹 앱을 따로 빌드한 적 없는 프로젝트에서** `/p/<id>` 가 **200 + HTML**,
  `/assets/index-*.js` 가 200 + 1,162,100 바이트, `/trpc/model.get` 이 200 을 돌려주는 것.
- **저장소 배치에서는 갓 빌드한 `apps/web/dist` 가 이기는 것.** 둘을 가리려고 두 후보에 서로 다른 표식 파일을
  두었습니다. 저장소 배치의 `/p/<id>` 도 200 을 돌려줍니다.
- **소비자가 `tsx` 를 직접 선언해야 하는 것**(2.1). 이 문서가 설명하는 경로(pnpm + `tsx` 선언)는 캐시를 비우고
  오프라인이어도 `0` 으로 끝납니다. `tsx` 를 `@erdd/cli` 의 `dependencies` 에 넣어 풀려던 시도는 **오히려 pnpm
  소비자를 퇴행시켜**(되던 것이 `127` 이 됨) 되돌렸습니다.
- **웹 번들 없이 팩하면 `prepack` 가드가 종료 코드 `1` 로 막는 것**(`pnpm pack` 과 `npm pack` 모두).

**공개 npm 에서 설치해 확인한 것.** 위 항목(`pnpm pack` 으로 만든 tarball)과 달리 게시된 버전
(`@erdd/cli@0.4.0`, `@erdd/core@0.3.0`)을 빈 디렉터리에 2.2 와 똑같이 `pnpm add -D @erdd/cli tsx`
(pnpm 10.33.0)로 설치했습니다. 레지스트리 설정도 토큰도 없이 설치됩니다.

- `pnpm exec erdd --help` 가 명령 목록을 찍습니다([2.5](#25-실행-확인) 절).
- `erdd init --local` 이 `로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요` 를 찍고 `0` 으로 끝납니다.
- `erdd validate` 가 `정합성 문제 없음` 과 `명명 경고 없음` 을 찍고 `0` 으로 끝납니다.
- `erdd serve --port 4391 --no-open` 이 아래 두 줄을 찍고, `/` 는
  `/p/00000000-0000-7000-8000-000000000000` 으로 **302** 를 돌려주며, 그 주소는 **200 + HTML**
  (`<!doctype html>`, `<html lang="ko">`)을 돌려줍니다. 웹 앱을 빌드한 적 없는 프로젝트에서 설치본에 동봉된 웹
  번들이 서빙됩니다.

  ```text
  http://127.0.0.1:4391 에서 실행 중 (프로젝트: …)
  중지하려면 Ctrl+C
  ```

**확인하지 못한 조합** — npm 으로 설치(`npm install -D @erdd/cli tsx` + `npx erdd`), 전역 설치, 설치 없이
`npx @erdd/cli`, Windows.

### 공용 사전·서버 프로젝트 생성 — 실서버

**실서버로 확인한 것.** 이 저장소의 서버를 격리 DB 로 띄우고, tRPC 로 조직, 조직 라이브러리(도메인 1, 단어 2,
용어 1), 관리자 토큰, editor 토큰을 만든 뒤, 저장소 밖 스크래치 디렉터리에서 CLI 를 실행했습니다
(`npx tsx <ERDD>/packages/cli/src/main.ts …`). 3.2·6.1·6.2·6.11·6.12·10.1 절에 인용한 출력이 그 실제 출력입니다.

- `init --create` 의 두 메시지(빈 디렉터리 / 이관), 빈 디렉터리에 만들어지는 빈 사전 파일 다섯, editor 토큰의 생성
  권한 메시지, 이미 연결된 config 의 거절.
- `dict list` 의 구독·쓰기 가능 표시, `dict pull` 의 첫 받기·재실행(파일을 쓰지 않음)·`--dry-run`, 구독이 config 에
  남아 `push` 와 `pull` 뒤에도 살아남는 것.
- 사전 파일에 id 없이 쓴 단어가 `push` 로 id 를 받는 것, 라이브러리에서 받은 항목과 그 출처가 `push` 로 서버에
  올라가고 다른 사용자의 `pull` 에서 `origins.yaml` 로 내려오는 것.
- editor 토큰의 `dict push` 가 승격 요청이 되는 것, 웹 승인(`promotion.resolve`) 뒤 editor 의 `pull` 이 승격된
  항목의 출처를 `origins.yaml` 에 쓰는 것, `dict requests` 의 대기·승인·처리 메모.
- `library list`, `export`, `import`(`--library`, `--create`, `--dry-run`, `--yes`, 확인 프롬프트, `--prune`,
  `--include-stale`), 내보낸 파일을 그대로 다시 가져오면 전부 그대로로 알리는 것, 서버에서 항목을 고치면 오래된
  파일로 세는 것, `dict pull --file`(첫 받기, 재실행, 다른 라이브러리 거절, 원본 파일 거절), 연결된 프로젝트에서 파일
  구독의 `dict push` 가 거절되는 것.
- 관리자 토큰의 `dict push` 가 바로 승격하고 암묵적 pull 로 `origins.yaml` 을 갱신하는 것, 그리고 두 전제(로컬
  변경 있음 / 서버가 앞서 나감)의 거절.
- 이관: `init --local` → 단어 추가 → `init --create` → `diff` 가 전부 추가로 보임 → `push`. 그 뒤 `dict pull` 의
  이름 중복 건너뛰기 → `--adopt` 로 연결, 자동 갱신, 보류된 충돌, 라이브러리 편집 뒤의 `--conflicts theirs`,
  `dict pull --json` 봉투.
- 기준 시점 없이 연결된 디렉터리(`erdd/` 에 파일 있음)에서 `pull` 이 대화형으로 묻고, `--json` 에서는
  `CANCELLED` 로 멈추고, `--yes` 로 받는 것.
- editor 의 전역 라이브러리 `dict push` 가 서버를 부르기 전에 거절되는 것.
- **라이브러리 원본이 앞선 항목 제외** — 받은 뒤 라이브러리에서 단어 둘을 고친 상태에서 `dict push` 가 그 두 항목을
  제외 알림과 함께 빼고 새 단어만 올리며, DB 의 라이브러리 값과 버전은 그대로인 것. `--name` 으로 지목해도
  `selected: 0` 과 `behind` 로 빠지는 것. `dict pull`(자동 갱신 / `--conflicts ours`) 뒤에는 로컬에서 고친 값이
  원본 갱신으로 올라가는 것. 그리고 대조로, 제외가 없는 CLI 는 같은 상태에서 라이브러리 값을 옛 값으로 되돌리는 것.

**확인하지 못한 것.** 새 CLI 를 옛 서버에 붙였을 때의 「서버가 이 기능을 지원하지 않습니다」(`dict` 와
`init --create` 모두 단위 테스트로만 확인), `erdd serve` 화면에서 사전 편집(대신 파일을 직접 고쳤습니다),
`init --create` 의 대화형 조직 선택. 다음 인용 출력은 실서버가 아니라 **단위 테스트의 기대값**에서 가져왔습니다:
`dict pull` 의 `내용이 달라 연결하지 않음` 줄과 `adoptDiffers`, `dict push` 의 `(도메인 연결 비움 — …)` 줄과
`danglingDomain`, push·diff 의 출처 중복(`duplicate-origin`) 충돌 보고, `dict pull`·`dict push` 의 미저장 편집
알림.

---

**다음 문서** — 팀이 프로젝트를 함께 쓰도록 ERDD 서버를 직접 운영하려면 [설치·운영 매뉴얼](install.md)을
읽으세요. 에디터 화면은 [사용 매뉴얼](user-guide.md)을 읽으세요.
