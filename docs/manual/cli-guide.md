# ERDD CLI 매뉴얼

ERDD 서버의 스키마를 **코드베이스 안의 YAML 파일**로 내려받아 git 으로 버전 관리하고, 로컬 수정을
서버로 되미는 명령줄 도구 `erdd` 의 사용 설명서다. 대상은 스키마를 코드와 함께 다루는 개발자와,
그 파일을 읽고 고치는 AI 에이전트다. 화면 사용법은 [사용자 가이드](user-guide.md), 서버 설치·운영은
[설치·운영 매뉴얼](install.md) 에 있다. **서버 없이 파일만으로 쓰는 길**은
[로컬 모드 매뉴얼](local-guide.md) 이 처음부터 끝까지 다룬다.

**목차** — [1. 개요](#1-개요) · [2. 설치와 실행](#2-설치와-실행) · [3. 연결 — 서버 연결과 로컬 모드](#3-연결--서버-연결과-로컬-모드) · [4. 일상 워크플로](#4-일상-워크플로) · [5. 파일 구조와 포맷](#5-파일-구조와-포맷) · [6. 명령 레퍼런스](#6-명령-레퍼런스) · [7. 동기화와 충돌](#7-동기화와-충돌) · [8. 파일에 담기지 않는 것](#8-파일에-담기지-않는-것) · [9. AI 에이전트와 함께 쓰기](#9-ai-에이전트와-함께-쓰기) · [10. 자동화와 CI](#10-자동화와-ci) · [11. 문제 해결](#11-문제-해결) · [부록: 검증 상태](#부록-검증-상태-2026-08-14)

---

## 1. 개요

**무엇** — 웹 UI 가 진실 원천인 ERD 모델을 로컬 파일로 양방향 동기화한다.

```
  [ ERDD 서버 ]  ◀── push ──  erdd/*.yaml  ── git commit ──▶  [ 저장소 ]
   (진실 원천)    ── pull ──▶   (작업 사본)                      (리뷰·이력)
```

- **PR 리뷰에서 스키마 변경이 코드와 함께 보인다.** 테이블 하나가 파일 하나라 diff 가 읽힌다.
- **AI 에이전트가 마이그레이션이나 ORM 코드를 뒤지지 않고** `erdd/` 를 읽어 DB 구조를 파악한다.
- **에이전트가 파일을 고쳐 `push` 하고 설계자가 웹에서 이어 다듬는다.** push 는 웹 편집과 똑같이
  Revision 으로 기록되고 실시간 채널로 전파된다.

**전제 세 가지.**

| 전제 | 뜻 |
|---|---|
| 서버가 진실 원천이다 | 로컬 파일은 작업 사본이다. `pull` 은 서버 상태로 로컬을 덮어쓴다. |
| 파일은 **스키마의 의미 정보만** 담는다 | 배치 좌표·메모는 **스키마 파일**(`erdd/tables/*.yaml` 과 최상위 사전 파일)에 없다(→ [8절](#8-파일에-담기지-않는-것)). 공용 사전 출처는 따로 `erdd/origins.yaml` 에 있다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)). |
| 모든 명령은 **현재 디렉터리 기준**이다 | `erdd.config.yaml` 이 있는 프로젝트 루트에서 실행한다. |

**실행 형태가 둘이다 — 위 전제 중 앞의 둘은 「서버에 연결된 프로젝트」 기준이다.** `erdd serve` 로 여는
**로컬 모드**에는 서버도 계정도 DB 도 없고 `erdd/` 파일 자체가 진실 원천이다. 브라우저에는 같은 웹
에디터가 뜬다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)). 배치 좌표·메모는 `erdd/layout.yaml` 에 담기는데
이것은 **모드와 무관하다** — 서버에 연결된 프로젝트를 `erdd serve` 로 열어 편집해도 같은 파일에 쌓인다
(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)).
**로컬 모드로만 쓸 생각이라면 이 문서 대신 [로컬 모드 매뉴얼](local-guide.md) 하나로 끝난다.**

**MCP 서버는 제공하지 않는다.** 에이전트 연동은 이 CLI + 동봉 스킬 문서 조합이다(→ [9절](#9-ai-에이전트와-함께-쓰기)).

---

## 2. 설치와 실행

**세 가지 방법이 있고 첫째가 기본이다.** 아래 표에서 자기 상황을 고르면 된다.

| 방법 | 언제 쓰나 | ERDD 저장소 체크아웃 |
|---|---|---|
| [A. npm 에서 설치](#22-방법-a-npm-에서-설치-권장) | **보통 이것이다** — 스키마를 둘 프로젝트에서 그냥 쓴다 | **필요 없다** |
| [B. 저장소에서 직접 실행](#23-방법-b-저장소에서-직접-실행-설치-없음) | npm 에 닿지 않거나(오프라인), CLI 자체를 고치는 중이다 | 필요하다 |
| [C. 프로젝트에 의존성으로 링크](#24-방법-c-프로젝트에-의존성으로-링크) | CLI 를 고치면서 소비처 프로젝트에서 바로 확인한다 | 필요하다 |

### 2.1 요구 사항

| 항목 | 값 | 근거 |
|---|---|---|
| Node.js | **22 이상** | `.nvmrc` 이자 **패키지가 강제한다** — 두 패키지 모두 `engines.node: ">=22"` 라 맞지 않는 Node 로 설치하면 패키지 관리자가 경고하거나 막는다 |
| 패키지 | `@erdd/cli`(바이너리 `erdd`) · 의존 패키지 `@erdd/core` | `packages/cli/package.json` |
| 실행기 | `tsx` — **소비처가 직접 설치한다** | 패키지가 원본 TypeScript 를 그대로 담고 바이너리의 shebang 이 `npx tsx` 다(아래 ⚠️) |
| ERDD 저장소 체크아웃 | **방법 B·C 에만.** 방법 A 에는 필요 없다 | |

⚠️ **`tsx` 를 프로젝트에 함께 넣어라 — 패키지 관리자가 무엇이든 마찬가지다.** 패키지에는 빌드
산출물이 아니라 **원본 TypeScript 가 그대로** 들어 있고 바이너리의 shebang 이
`#!/usr/bin/env -S npx tsx` 다. **`@erdd/cli` 가 `tsx` 를 대신 끌어오지 않는다** — 소비처가 자기
프로젝트에 선언해야 한다.

**빠뜨렸을 때의 증상은 패키지 관리자마다 다르다.** shebang 이 `npx` 를 거치므로 **`npx` 가 그때그때
`tsx` 를 받아 와 대개는 그냥 돈다**(대신 첫 실행이 느려지고 레지스트리 접근에 기댄다). 네트워크가
없으면 CLI 가 아니라 셸이 이렇게 끝내고,

```
sh: tsx: command not found
# 종료 코드 127 — CLI 가 아니라 셸이 낸 오류다
```

npm 평면 배치는 캐시가 없으면 `ENOTCACHED` 로 죽는다. **되기도 하고 안 되기도 한다** — 그래서
이 증상 하나만 놓고 진단하면 헤맨다(→ [11. 문제 해결](#11-문제-해결)).

**이 문서의 설치 명령이 어느 경로에서나 `tsx` 를 함께 적는 이유가 이것이다.** 그것이 **유일하게
보증된 경로**다.

### 2.2 방법 A: npm 에서 설치 (권장)

`@erdd/cli` 와 `@erdd/core` 는 **공개 npm**(registry.npmjs.org)에 있다. 따로 할 레지스트리 설정도,
토큰도 필요 없다. 스키마를 둘 프로젝트에서 바로 설치한다.

```bash
cd /path/to/my-project
pnpm add -D @erdd/cli tsx
pnpm exec erdd --help

# npm 이면
npm install -D @erdd/cli tsx
npx erdd --help
```

`node_modules/.bin/erdd` 가 생겨 `pnpm exec erdd …`(npm 이면 `npx erdd …`)로 부를 수 있다.
`@erdd/core` 는 의존성으로 따라 들어오므로 따로 설치하지 않는다.

**웹 번들이 패키지 안에 들어 있다.** `erdd serve` 가 브라우저에 띄우는 에디터 화면(`apps/web` 의 빌드
산출물)이 tarball 에 통째로 동봉돼 나간다 — **npm 에서 설치한 쪽은 웹을 따로 빌드하지 않아도
`erdd serve` 가 그대로 뜬다**(→ [로컬 모드 매뉴얼 2.2](local-guide.md#22-경로-a-npm-에서-설치한다-권장)).
설치본에는 저장소 배치(`apps/web/dist`)가 애초에 존재할 수 없으므로 언제나 이 동봉본이 쓰인다.

**문서도 함께 들어 있다.** 패키지 루트에 `README.md`(두 모드의 진입점)가 있고, 이 매뉴얼과
[로컬 모드](local-guide.md)·[사용](user-guide.md)·[설치·운영](install.md) 매뉴얼 네 편이
`node_modules/@erdd/cli/docs/` 에 그대로 동봉된다 — 저장소를 클론하지 않아도 읽을 수 있고 문서끼리의
상대 링크도 살아 있다.

### 2.3 방법 B: 저장소에서 직접 실행 (설치 없음)

**언제** — npm 에 닿지 않거나(오프라인), CLI 소스를 고치면서 바로 돌려 볼 때.

설치가 전혀 없다. **작업할 프로젝트 디렉터리에서** ERDD 체크아웃의 진입점을 가리켜 실행한다.

```bash
cd /path/to/my-project
npx tsx /path/to/ERDD/packages/cli/src/main.ts status
```

경로가 길어지므로 셸 별칭을 두면 편하다.

```bash
# ~/.zshrc 등
alias erdd='npx tsx /path/to/ERDD/packages/cli/src/main.ts'
```

⚠️ **현재 디렉터리가 대상 프로젝트여야 한다.** CLI 는 `erdd.config.yaml`·`erdd/`·`.erdd/` 를 전부
`process.cwd()` 기준으로 찾는다. ERDD 저장소 안에서 실행하면 엉뚱한 곳을 본다.

⚠️ **이 방법에서는 `erdd serve` 를 쓰기 전에 웹을 한 번 빌드해야 한다** — 체크아웃에는 번들이 없다.
`pnpm -C apps/web build`(→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)).

### 2.4 방법 C: 프로젝트에 의존성으로 링크

**언제** — CLI 를 고치면서 소비처 프로젝트에서 `pnpm exec erdd …` 형태 그대로 확인할 때. 레지스트리
설치와 같은 호출 형태를 쓰면서 코드만 로컬 체크아웃을 본다.

`node_modules/.bin/erdd` 가 생겨 `pnpm exec erdd …` 로 부를 수 있다. **`tsx` 를 함께 넣어야 한다.**

```bash
cd /path/to/my-project
pnpm add -D /path/to/ERDD/packages/cli tsx
pnpm exec erdd --help
```

⚠️ **`tsx` 를 빼면 실행이 보증되지 않는다** — `npx` 가 즉석에서 받아 와 도는 경우도 있고, 네트워크·
캐시가 없으면 `sh: tsx: command not found`(종료 코드 127)나 `ENOTCACHED` 로 죽는다
(→ [2.1](#21-요구-사항)).

⚠️ **이 설치는 ERDD 저장소의 원본 파일 권한을 바꾼다.** 패키지 관리자가 bin 진입점에 실행 비트를
붙이므로, 설치 뒤 ERDD 체크아웃에서 `git status` 를 보면 `packages/cli/src/main.ts` 가
`old mode 100644 / new mode 100755` 로 뜬다. 커밋하지 말고 `chmod 644 packages/cli/src/main.ts` 로
되돌린다. 이 부작용이 싫으면 [방법 B](#23-방법-b-저장소에서-직접-실행-설치-없음) 를 쓴다.

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

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate·diff에서 경고·충돌도 실패로 본다
  -m, --message <요약>  push의 Revision 요약, dict push의 승격 요청 메모
  --dir <경로>          skill install 전용 — 설치 위치
  --force               skill install 전용 — 기존 파일 덮어쓰기
  --server <url>        init 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
  --create              init 전용 — 서버에 프로젝트를 만들어 연결한다(로컬 전용 프로젝트면 이관한다)
  --org <이름|id>        init --create 전용 — 프로젝트를 만들 조직
  --case <대소문자>      init --local·--create 전용 — UPPER_SNAKE(기본) 또는 lower_snake
  --format <ddl|dbml>   export·import 전용 — export 기본 ddl, import 기본 확장자 판별
  --dialect <방언>       export·import·init --local·--create 전용
                        export·import는 기본이 erdd.config.yaml의 dialects[0], init --local·--create는 postgresql
  -o <경로>             export 전용 — 산출물을 쓸 파일(없으면 stdout)
  --dry-run             import·dict pull 전용 — 계획만 보고 파일을 쓰지 않는다
  --library <이름|id>   dict pull·push 전용 — pull은 받을 라이브러리(구독에 없으면 더한다, 없으면 구독 전부)
                        push는 올릴 라이브러리(필수)
  --adopt               dict pull 전용 — 이름이 같은 로컬 항목에 출처를 연결한다(내용이 같을 때만)
                        내용이 달라도 로컬 값을 유지한 채 연결하려면 --conflicts ours 를 함께 준다
  --conflicts <theirs|ours>  dict pull 전용 — 충돌을 원본(theirs)·로컬(ours)로 정리한다(기본 보류)
  --kind <종류,…>        dict push 전용 — domain·word·term·customField 중 올릴 종류
  --name <이름>          dict push 전용 — 올릴 항목 이름(반복 가능)
                        init --create 전용 — 서버에 만들 프로젝트 이름
  --include-name-match  dict push 전용 — 라이브러리에 같은 이름이 있는 항목도 올린다(기본 제외)
  --status <상태>        dict requests 전용 — pending·resolved·rejected·cancelled
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
  --check               changes 전용 — 미기록 변경이 있으면 종료 코드 1
  --baseline            changes new 전용 — 첫 기록을 「이미 DB 에 있음」으로 표시
  --help                이 도움말
```

`--help`·`-h` 는 다른 인자보다 먼저 처리되고 항상 종료 코드 `0` 이다.

---

## 3. 연결 — 서버 연결과 로컬 모드

### 3.1 개인 액세스 토큰 발급

**어디서** — 웹의 `/settings`(사용자 메뉴 → 「설정」)의 「액세스 토큰」 카드.

**어떻게** — 「토큰 이름」에 알아볼 이름(예: 「노트북」)을 넣고 「발급」을 누른다. 값이 노란 상자에
나오고 「복사」로 클립보드에 담는다. 자세한 화면 조작은
[사용자 가이드 18절](user-guide.md#18-액세스-토큰) 에 있다.

**제약 — 평문은 발급 직후 한 번만 보인다.** 잃으면 조회가 아니라 재발급이다.

**권한은 새 축이 아니다.** 토큰의 권한은 **발급한 사용자의 조직·프로젝트 역할을 그대로 따른다.**
Viewer 가 만든 토큰은 Viewer 권한만 갖고, 그 사용자가 프로젝트 멤버에서 빠지면 토큰도 자동으로 그
프로젝트에 닿지 못한다 — 토큰을 따로 회수할 필요가 없다. 만료는 없고 폐기만 있다.

**토큰으로 호출할 수 있는 서버 기능은 CLI 가 쓰는 것뿐이다** — 연결·동기화(`auth.me`, `org.list`,
`project.list`, `project.get`, `model.get`, `model.push`), 프로젝트 생성(`project.create` —
`init --create`), 공용 사전(`resource.library.listForProject`, `resource.items.list`,
`resource.promote`, `promotion.create`, `promotion.listForProject` — `erdd dict`). 웹 UI 의 나머지
기능(내보내기·스냅샷·멤버 관리·승격 요청 승인 등)은 세션 전용이라 토큰으로 부를 수 없다.

⚠️ **토큰은 발급한 사람이 웹에서 할 수 있는 쓰기를 그대로 한다.** 조직 Owner/Admin 의 토큰은 조직에
**프로젝트를 만들고**(`erdd init --create`) 조직 라이브러리에 **승인 없이 바로 올린다**(`erdd dict push`).
서비스 관리자의 토큰은 전역 라이브러리까지 쓴다. 에이전트·CI 에 줄 토큰은 **편집자(Editor) 계정**으로
발급한다 — 그러면 `dict push` 는 승격 **요청**이 되고 조직 관리자가 웹에서 승인해야 반영된다.

### 3.2 `erdd init`

프로젝트 루트에서 실행한다. 대화형이면 순서대로 묻는다.

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

비대화형(CI·에이전트)에서는 세 값을 인자로 준다. 하나라도 빠지면 종료 코드 `2` 다.

```bash
erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --project 018f6b0e-… --json
```

**하는 일 순서.**

1. `erdd.config.yaml` 이 이미 있으면 「덮어쓸까요?」를 묻는다(`--yes` 로 건너뜀, 거절하면 종료 코드 `1`).
2. **토큰이 실제로 통하는지 `auth.me` 로 먼저 확인한다** — 잘못된 토큰으로 config 를 만들지 않는다.
3. `--project` 가 없으면 조직 → 프로젝트를 차례로 고르게 한다.
4. 프로젝트의 방언·명명 규칙을 받아 `erdd.config.yaml` 을 쓴다.
5. `.erdd/credentials.json` 에 토큰을 쓴다 — **파일 권한 `0600`**(이미 있던 파일도 매번 좁힌다).
6. `.gitignore` 에 `.erdd/` 를 한 줄 추가한다(이미 있으면 건드리지 않는다).

**같은 서버의 같은 프로젝트로 다시 연결하면**(토큰만 바꿀 때 등) config 의 공용 사전 구독
(`dictionaries`)을 이어받는다. 다른 프로젝트나 다른 서버로 연결하면 구독을 비운다.

**서버에 아직 프로젝트가 없으면 `--create` 로 만들어 연결한다** — 조직 Owner/Admin 만 된다.
로컬 전용 프로젝트를 서버로 옮기는 것도 이 명령이다(→ [6.1](#61-erdd-init)).

```bash
$ erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --create --org 플랫폼팀 --name 주문시스템 --yes
서버 프로젝트 주문시스템을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.
```

### 3.3 토큰을 두는 곳

| 위치 | 우선순위 | 용도 |
|---|---|---|
| 환경 변수 `ERDD_TOKEN` | **높음** | CI·컨테이너. 빈 문자열이면 없는 것으로 본다. |
| `.erdd/credentials.json` | 낮음 | `init` 이 저장한다. git-ignore 된다. |

환경 변수가 있으면 파일은 읽지 않는다. **`erdd.config.yaml` 은 커밋 대상**이고 토큰은 들어 있지
않으므로, 팀원은 저장소를 클론한 뒤 `ERDD_TOKEN` 만 자기 것으로 주면 된다(`init` 을 다시 돌릴
필요가 없다).

### 3.4 로컬 모드 — 서버 없이 쓰기

**서버도 계정도 DB 도 없이** `erdd/` 파일만으로 같은 웹 에디터를 연다. 붙을 서버가 없거나, 스키마를
저장소 안에서 혼자 그리고 싶을 때 쓴다. **이 절은 CLI 쪽에서 알아야 할 것만 담는다** — 준비(웹 번들
빌드)·브라우저에서 되는 것과 없는 것·파일과 git·스냅샷은 [로컬 모드 매뉴얼](local-guide.md) 에 있다.
명령 옵션의 상세는 [6.8](#68-erdd-serve).

```bash
$ cd /path/to/my-project
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd serve
http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

**`init --local` 이 만드는 것은 `erdd.config.yaml` 과 `.gitignore` 의 `.erdd/` 한 줄뿐이다** —
`erdd/` 디렉터리는 만들지 않는다(브라우저에서 처음 편집할 때 생긴다). 토큰도 서버 왕복도 없다.

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

⚠️ **`--local` 은 `--yes` 로도 덮어쓰지 않는다.** `erdd.config.yaml` 이 이미 있으면
`erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` 로 멈춘다(종료 코드 `1`) — 되물을 서버
프로젝트가 없어서, 덮어쓰면 방언·명명 규칙을 조용히 잃는다.

⚠️ **`erdd serve` 는 미리 빌드된 웹 번들을 정적으로 내보낸다 — 저장소 배치에서는 그 번들을 한 번
만들어 둬야 한다.** [npm 에서 설치](#22-방법-a-npm-에서-설치-권장)한 쪽은 번들이
패키지에 동봉돼 있어 할 일이 없다. 저장소 체크아웃(방법 B·C)에서는 `apps/web/dist` 가 없으면 서버는
평소처럼 뜨는데 브라우저에 에디터 대신 JSON 404 가 나오므로, ERDD 체크아웃에서
`pnpm -C apps/web build` 를 한 번 돌려 둔다
(→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)).
**저장소에서는 방금 빌드한 `apps/web/dist` 가 언제나 이긴다** — 게시 준비로 `packages/cli/web` 에
복사본을 만들어 둔 적이 있어도 화면은 계속 최신 빌드를 본다.

**편집은 드래프트에, 저장이 파일에.** 화면에서 바꾼 것은 `.erdd/draft.json`(gitignore)에 자동으로
기록되고, **`Cmd+S`(또는 헤더의 「저장」)를 눌러야** `erdd/` 에 쓰인다 — 버릴 시도가 git diff 를
더럽히지 않게 하기 위해서다. 미저장 편집은 `serve` 를 껐다 켜도 남는다. 터미널·에이전트·
`git pull` 이 파일을 고치면 **새로고침 없이** 화면이 따라온다. 테이블을 옮기거나 메모를 만든 것은
`erdd/layout.yaml` 에만 담겨 스키마 파일의 diff 를 더럽히지 않는다(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)).
**파일이 깨지면 편집이 잠긴다** — 상단에 빨간 배너가 뜨고 하단 바가 「읽기 전용」으로 바뀌며, 고치면
자동으로 풀린다(→ [로컬 모드 매뉴얼 4.5](local-guide.md#45-파일이-깨지면-편집이-잠긴다)).

**브라우저에 없는 것** — 로그인·계정·액세스 토큰, 홈·조직·프로젝트 목록·관리자, 참여자(presence)와
실시간 커서, 공용 리소스·승격 요청·프로젝트 멤버, 「버전」의 **「이력」 탭**. 그 밖의 에디터 기능은
전부 그대로다(장별 대조표 → [로컬 모드 매뉴얼 4.2](local-guide.md#42-사용-매뉴얼의-어느-장이-해당하나)).

**`pull`·`push` 와 함께 쓰기 — 두 형태는 배타가 아니다.**

- 연결 설정이 없으면(`serverUrl`·`projectId` 가 `null`) `pull`·`push`·`diff` 가 이렇게 멈춘다(`1`).

  ```
  오류: erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요
  ```

- **연결 설정이 있는 프로젝트에서도 `erdd serve` 는 뜬다.** 그때는 config 의 `projectId` 로 열고,
  로컬 서버는 어느 경우든 **파일만** 본다 — 서버와의 왕래는 여전히 `pull`·`push` 가 한다. `pull` 로
  받은 프로젝트를 `serve` 로 열어 그림으로 확인하고 고쳐 `push` 하는 흐름이 그대로 된다. GUI 가 떠
  있는 채로 `erdd pull` 을 돌려도 감시가 그것을 잡아 화면이 따라온다.
- **로컬로 시작한 프로젝트를 서버로 옮기는 것은 `erdd init --server … --create` 한 줄이다.** 서버에 빈
  프로젝트를 만들고 기준선을 **빈 모델**로 세우므로 `erdd/` 는 그대로 남고, `erdd diff` 가 전부
  「추가」로 보인 뒤 `erdd push` 로 올라간다(→ [6.1](#61-erdd-init)). ⚠️ **연결 설정을 손으로 적는
  것만으로는 안 된다** — `push` 는 마지막 pull 기준선(`.erdd/base.json`)을 요구하므로 `기준 시점이
  없습니다. 먼저 erdd pull을 실행하세요` 로 멈추고, 그 상태에서 `pull` 을 하면 `erdd/` 가 서버의 빈
  상태로 덮인다. 프로젝트 생성 권한이 없을 때의 수동 절차는
  [로컬 모드 매뉴얼 7.2](local-guide.md#72-로컬로-시작한-프로젝트를-서버로-옮기기) 에 있다.

---

## 4. 일상 워크플로

```
  erdd pull ──▶ erdd/ 파일 편집 ──▶ erdd validate ──▶ erdd diff ──▶ erdd push
      ▲              (에디터·에이전트)     (서버 없이)      (미리보기)      │
      └──────────────────── 충돌이면 pull 로 받아 정리 ◀──────────────────┘
```

```bash
erdd pull                      # 최신 스키마를 받는다(로컬 변경을 덮어쓴다)
$EDITOR erdd/tables/MBR.yaml   # 편집
erdd validate                  # 서버 없이 참조 무결성·명명 규칙 검사
erdd diff                      # 올릴 변경 · 내려올 변경 · 충돌 미리보기
erdd push -m "회원 등급 컬럼 추가"
git add erdd erdd.config.yaml && git commit -m "스키마: 회원 등급 컬럼"
```

- **`status` 는 서버를 부르지 않는다.** 연결 정보와 로컬 변경 유무만 본다(오프라인에서도 된다).
- **`validate` 도 서버를 부르지 않는다.** 그래서 커밋 훅·CI 에 넣기 좋다.
- **`push` 는 성공하면 자동으로 pull 을 한 번 더 한다** — 새로 만든 객체의 `id` 가 파일에 채워지고,
  자동 병합된 서버 쪽 변경도 함께 내려와 다음 `status` 가 바로 깨끗해진다.
- **커밋 대상은 `erdd/` 와 `erdd.config.yaml` 이다.** `.erdd/` 는 커밋하지 않는다.
- **로컬 모드에는 이 왕복 자체가 없다.** 저장이 곧 파일이고 커밋이 곧 이력이다 — `pull`·`diff`·`push` 대신 `erdd serve` 를 띄워 두고 편집한 뒤 `git commit` 한다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)).
- **`export`·`import` 도 서버를 부르지 않는다** — `erdd/` 파일만 읽고 쓴다(→ [6.9](#69-erdd-export) ·
  [6.10](#610-erdd-import-파일)). `import` 는 **파일만** 고치므로 서버 모드라면 그 뒤에 `diff` → `push` 가
  이어진다. 서버의 최신 상태를 내보내려면 `export` 앞에 `pull` 을 둔다.
- **조직 공용 사전(단어·용어·도메인·커스텀 항목)은 `erdd dict` 로 주고받는다** — 받기는 `dict pull`,
  새 단어를 공용으로 올리기는 `push` 뒤 `dict push` 다(→ [6.11](#611-erdd-dict--공용-사전)).
  서버에 연결된 프로젝트에서만 된다.

---

## 5. 파일 구조와 포맷

### 5.1 디렉터리

```
erdd.config.yaml            # 서버·프로젝트·방언·명명 규칙          ← 커밋한다
erdd/                                                             ← 커밋한다
├─ tables/
│  ├─ MBR.yaml              # 테이블 1개 = 파일 1개, 파일명 = 물리명
│  └─ ORD.yaml
├─ groups.yaml              # 테이블 그룹
├─ words.yaml               # 단어 사전
├─ terms.yaml               # 용어 사전
├─ domains.yaml             # 도메인(타입 표준)
├─ custom-fields.yaml       # 커스텀 항목 정의
├─ origins.yaml             # 공용 사전 출처 — erdd dict·pull 이 쓴다. 손으로 고치지 않는다(→ 5.8)
└─ layout.yaml              # 배치 좌표·메모 — erdd serve 가 읽고 쓴다(→ 5.7)
.erdd/                                                            ← 커밋하지 않는다
├─ base.json                # 마지막 pull 시점 모델 — 3-way 병합의 기준선
├─ sync.json                # { "revisionSeq": 42, "pulledAt": "…" }
├─ credentials.json         # { "token": "erdd_pat_…" }, 권한 0600
└─ draft.json               # 로컬 모드의 **저장하지 않은 편집**(모델 전체). 저장하면 지워진다
```

⚠️ **`.erdd/` 아래를 편집하지 않는다.** 병합 기준선과 자격 증명이 들어 있다. 손상되면 `erdd pull`
로 다시 받는다.

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
tableOptions:                               # 선택 — 없으면 네 방언 모두 빈 문자열
  postgresql: ""
  mysql: ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  oracle: ""
  mssql: ""
```

**`serverUrl`·`projectId` 는 선택 값이다.** 둘 다 없으면(또는 `null` 이면) **로컬 전용 프로젝트**이고
`erdd serve` 로 연다 — 서버가 필요한 `pull`·`push`·`diff` 만 그때 종료 코드 `1` 로 멈춘다
(→ [3.4](#34-로컬-모드--서버-없이-쓰기)). ⚠️ **둘 중 하나만 적힌 것은 오타로 보고 거절한다** —
삼키면 서버에 붙은 줄 알고 편집하다 `push` 할 때가 되어서야 연결이 없다는 것을 알게 된다.
`dialects`·`namingRules` 의 형태가 어긋나도 종료 코드 `1` 이다.

**방언과 명명 규칙은 `pull` 이 매번 서버 값으로 덮어쓴다.** 모델이 아니라 프로젝트 설정에 있는
값인데, `validate` 가 서버 없이 명명 경고를 내려면 로컬에 사본이 있어야 하기 때문이다. 웹에서 이
설정을 바꾸면 **다음 `pull` 전까지 로컬 `validate` 결과가 서버와 다를 수 있다.**

**`tableOptions` 는 DDL 로 내보낼 때 `CREATE TABLE` 의 닫는 괄호 뒤에 그대로 붙는 방언별 자유
문자열**이다. 모든 테이블에 같은 값이 붙고, 값은 검증하지 않는다 — 잘못 적으면 그 방언의 DDL 이
실패하고 그것은 즉시 보이는 실패다. **키가 없는 옛 config 는 네 방언 모두 빈 문자열로 열린다**
(필수로 요구하면 기존 사용자의 `pull` 이 깨진다).

⚠️ **`tableOptions` 도 `pull` 이 서버 값으로 덮어쓴다** — 연결된 프로젝트에서 이 칸은 **서버의
거울**이다. 로컬에서 고쳐도 다음 `pull` 에 지워지고, `push` 는 모델만 보내므로 서버로 올라가지도
않는다. 서버 쪽 값은 웹의 프로젝트 설정 화면에서 바꾼다. 로컬 전용 프로젝트에서는 이 파일이
유일한 진실 원본이다.

⚠️ **`COMMENT=` 를 적지 마라** — 옵션이 테이블 코멘트보다 앞에 나가므로, 되읽을 때 파서가 그것을
테이블 코멘트로 읽는다.

**`dictionaries` 는 공용 사전 구독이다** — `erdd dict pull --library …` 가 처음 받을 때 적고, 인자
없는 `erdd dict pull` 이 이 목록을 **적힌 순서대로** 처리한다(→ [6.11](#611-erdd-dict--공용-사전)).

```yaml
dictionaries:
  - id: 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
    name: 플랫폼팀 표준 사전      # 표시용. 서버에서 이름이 바뀌면 다음 dict pull 이 고쳐 쓴다
  - id: 01a0cf70-8bb2-7bf8-9635-821049933b45
    name: 데모 사전
    file: standard.erdd-lib.yaml  # 있으면 서버 대신 이 배포 파일에서 받는다(erdd dict pull --file)
```

- 구독이 없으면 키 자체를 쓰지 않는다. 키가 없거나 값이 비어 있으면(`dictionaries:`) 구독 0건이다.
- `pull`·`push`·`init`(같은 프로젝트로 재연결)이 config 를 다시 써도 구독은 남는다.
- 형태가 틀리면(`{id, name, file?}` 목록이 아님) 종료 코드 `1` —
  `erdd.config.yaml의 dictionaries는 {id, name, file?} 목록이어야 합니다`. 같은 id 가 두 번 있어도 `1` —
  `erdd.config.yaml의 dictionaries에 같은 사전(<id>)이 두 번 있습니다`.
- 구독을 끊으려면 그 줄을 지운다. 이미 받아 온 항목과 `origins.yaml` 의 출처는 그대로 남는다.
- **`file` 은 `erdd dict pull --file <경로>` 가 처음 받을 때 적는다** — 그 뒤로는 인자 없는
  `erdd dict pull` 도 서버가 아니라 이 경로의 파일에서 받는다(→ [6.11 의 `--file`](#611-erdd-dict--공용-사전)).
  경로는 프로젝트 안의 POSIX 상대 경로이고 `erdd/` 아래일 수 없다. 없는 키와 같은 뜻이다(서버 구독).

### 5.3 테이블 파일

```yaml
id: 018f6b0e-…                             # UUIDv7 — CLI 가 발급한다. 고치거나 지우지 않는다
name: MBR                                  # 물리명(= 파일명)
logicalName: 회원
group: 회원관리                             # groups.yaml 의 그룹 이름
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
    domain: 명                              # domains.yaml 의 도메인 이름
    type: VARCHAR(100)
    nullable: false
indexes:
  - id: 018f6b0e-…
    name: UX_MBR_01
    columns: [MBR_NM]                       # 내림차순은 "MBR_NM DESC" 처럼 한 문자열로
    unique: true
relations:
  - id: 018f6b0e-…
    to: MBR_GRD                             # 부모 테이블의 물리명
    columns: { MBR_GRD_CD: GRD_CD }         # { 자식 컬럼: 부모 컬럼 }
    identifying: false
```

**필드.**

| 위치 | 키 | 뜻 | 생략하면 |
|---|---|---|---|
| 테이블 | `id` · `name` · `logicalName` · `group` · `comment` · `custom` | 물리명·논리명·그룹 이름·설명·커스텀 값 | `id` 없음 = 신규, 나머지는 빈 값 |
| 컬럼 | `id` · `name` · `logicalName` · `domain` · `type` | 이름과 타입 | — |
| 컬럼 | `pk` | 기본키 | `false` |
| 컬럼 | `autoIncrement` | 자동 증가 | `false` |
| 컬럼 | `nullable` | NULL 허용 | **`true`** |
| 컬럼 | `default` · `comment` · `custom` | 기본값·설명·커스텀 값 | 없음 |
| 인덱스 | `name` · `columns` | 이름과 컬럼 목록 | — |
| 인덱스 | `unique` | 유니크 | `false` |
| 관계 | `to` · `columns` | 부모 테이블 물리명, 컬럼 매핑 | — |
| 관계 | `name` | 제약 이름 | 없음 |
| 관계 | `identifying` | 식별 관계 | `false` |
| 관계 | `cardinality` | `1:1` 또는 `1:N` | **`1:N`** |

**기본값과 같은 값은 파일에서 빠진다.** `pull` 이 그렇게 쓰므로 diff 가 조용하다. 직접 적어도
동작은 같다.

**규칙 넷.**

1. **컬럼 순서가 곧 모델의 순서다.** 파일에 적힌 차례가 컬럼 순서가 된다.
2. **관계는 자식 테이블 파일에만 적는다.** `to` 가 부모를 가리킨다.
3. **인덱스 컬럼의 방향은 이름 뒤에 붙인다.** `MBR_NM`(오름차순) · `MBR_NM DESC`. `ASC`/`DESC` 는
   대소문자를 가리지 않고, 오름차순은 생략하는 것이 표준이다.
4. **`type` 은 도메인이 있어도 함께 적는다.** 모델이 실제로 둘 다 들고 있어서다 — 실효 타입은
   도메인이 우선하고 `type` 은 참고값이다. 하나만 남기면 왕복에서 다른 하나가 사라진다.

**파일명은 identity 가 아니다.** 물리명이 바뀌면 `pull` 이 파일명을 갱신한다. 이름을 바꾸려면
파일명이 아니라 파일 안의 `name` 을 고친다. 물리명이 **대소문자만 다른** 테이블이 둘 이상이면
(macOS·Windows 에서 파일명이 충돌한다) 그 테이블들만 `MBR.1a2b3c4d.yaml` 처럼 id 뒤 8자가 붙는다.

### 5.4 사전·정의 파일

```yaml
# erdd/groups.yaml
groups:
  - { id: 018f…, name: 회원관리, color: '#4f46e5', comment: 회원 도메인 }

# erdd/words.yaml — 논리명 조각 → 약어
words:
  - { id: 018f…, logicalName: 회원, abbreviation: MBR, englishName: member, description: … }

# erdd/terms.yaml — 논리명 → 물리명(도메인을 함께 묶을 수 있다)
terms:
  - { id: 018f…, logicalName: 회원번호, physicalName: MBR_NO, domain: 번호, description: … }

# erdd/domains.yaml — 타입 표준
domains:
  - id: 018f…
    name: 명
    category: 문자
    logicalType: VARCHAR
    dialectTypes: { postgresql: varchar(100), mysql: null, oracle: VARCHAR2(100), mssql: null }
    defaultValue: null
    allowedValues: []
    description: 사람·사물의 이름

# erdd/custom-fields.yaml — 커스텀 항목 정의
customFields:
  - id: 018f…
    name: 개인정보여부
    target: column        # table | column
    type: boolean         # text | boolean | select
    options: []           # type: select 일 때의 선택지
    required: false
    defaultValue: null
    order: 0
```

### 5.5 이름으로 참조되는 것은 유일해야 한다

파일 안의 참조는 사람이 읽을 **이름**으로 적는다. 그래서 다음 셋은 중복되면 오류다.

| 이름 | 참조하는 곳 | 중복 시 메시지 |
|---|---|---|
| 그룹 이름 | 테이블의 `group` | `그룹 이름 X가 중복됩니다 — 이름으로 참조되므로 유일해야 합니다` |
| 도메인 이름 | 컬럼·용어의 `domain` | `도메인 이름 X가 중복됩니다 — …` |
| 테이블 물리명 | 관계의 `to` | `테이블 물리명 X가 중복됩니다 — 관계가 이름으로 참조하므로 유일해야 합니다` |

가리키는 대상이 없어도 오류다 — `그룹 X을 찾지 못했습니다`, `도메인 X을 찾지 못했습니다`,
`관계의 부모 테이블 X을 찾지 못했습니다`, `인덱스 컬럼 X을 찾지 못했습니다`.

### 5.6 `id` 취급 — 가장 흔한 사고

- **`id`(UUIDv7)는 identity 다.** 고치거나 지우지 않는다. 이름이 바뀌어도 `id` 가
  같으면 "삭제 + 추가"가 아니라 "수정"으로 인식된다.
- **새로 만드는 객체는 `id` 를 아예 쓰지 않는다.** **발급하는 것은 서버가 아니라 CLI 다** — 서버
  모드에서는 `push` 가(→ [7.4](#74-push-가-정상으로-끝나지-않는-세-가지)), `erdd serve` 로 열었을 때는
  로컬 store 가 uuidv7 을 만들어 파일에 채워 넣는다.
- ⚠️ **파일을 복사해 새 테이블을 만들 때는 `id` 를 전부 지운다** — 테이블뿐 아니라 컬럼·인덱스·관계의
  `id` 도 함께. 남겨 두면 "새 테이블 생성"이 아니라 **"원본을 복사본 내용으로 덮어쓰기"** 가 된다.
  같은 `id` 가 두 번 나오면 **`erdd validate` 가 종료 코드 `1` 로 막고**(서버를 부르지 않으므로 두
  모드 모두 그렇다), 서버 모드에서는 `diff`·`push` 의 계획 단계에서도 막힌다.

  ```
  id 018f…가 erdd/tables/MBR.yaml에도 있습니다 — 복사해서 새로 만든 것이라면 id를 지우세요(그대로 두면 원본을 덮어씁니다)
  ```

- ⚠️ **YAML anchor/alias(`&이름` … `*이름`)는 지원하지 않는다.** 두 항목이 조용히 한 항목으로
  합쳐지기 때문에 오류로 막는다. 별칭을 풀어 항목마다 내용을 그대로 적는다.

### 5.7 `erdd/layout.yaml` — 배치 좌표와 메모

**`erdd serve` 가 읽고 쓴다 — 모드를 가리지 않는다.** 서버에 연결된 프로젝트를 `serve` 로 열어
테이블을 옮기거나 메모를 써도 이 파일이 생기고 갱신된다. 다만 **서버와 오가지는 않는다** —
`pull`·`push` 는 이 파일을 보내지도 받지도 않는다(→ [8절](#8-파일에-담기지-않는-것)).
커밋 대상이다 — 배치는 팀이 함께 보는 그림의 일부다.

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

- **테이블을 옮기면 이 파일만 바뀐다** — `erdd/tables/*.yaml` 은 한 글자도 안 바뀐다. 좌표를 스키마
  파일에서 뺀 원래 이유(옮기기만 해도 diff 가 뜨는 것)를 그대로 지키려고 파일을 갈랐다.
- **식별은 `id` 다.** `name` 은 사람이 읽기 위한 값이고 매칭에 쓰이지 않는다 — 물리명을 바꿔도
  배치가 따라온다. 모델에 없는 `id` 가 남아 있으면(지운 테이블의 잔재) 조용히 버려진다.
- **항목이 없거나 파일 자체가 없으면 물리명 오름차순 격자로 떨어진다.** `erdd pull` 로 받아 온
  프로젝트도 좌표 파일 없이 열린다 — 그 뒤 에디터의 「자동 정렬」로 다듬는다.
- ⚠️ **파일 전체가 파싱되지 않으면 다른 `erdd/` 파일과 똑같이 편집이 잠긴다.** 여기에는 좌표만
  있는 것이 아니라 **메모 본문**이 함께 담기므로, 깨진 채로 열어 두면 다음 저장이 `notes: []` 로
  메모를 지운다. 빨간 배너(`파일을 읽을 수 없어 편집이 잠겼습니다 — erdd/layout.yaml: …`)가 뜨고
  파일을 고치면 풀린다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)).
- **항목 하나가 망가진 것은 다르다.** 좌표가 숫자가 아니거나 필드가 빠진 **그 항목만** 걸러지고
  (해당 테이블은 격자로 떨어진다) 나머지는 그대로 열린다. 파일이 아예 없거나 비어 있는 것도
  손상이 아니다.

### 5.8 `erdd/origins.yaml` — 공용 사전 출처

**공용 사전에서 받아 온 항목이 어느 라이브러리의 어느 항목·몇 번째 버전에서 왔는지**를 적는 파일이다.
`erdd dict pull`·`dict push` 가 쓰고, `pull`·`push` 가 서버와 주고받는다. **커밋 대상이다.**

```yaml
origins:
  - id: 01a0cc5f-58b5-712a-8cd1-8fcda45c2b5c      # 이 프로젝트의 단어 id (words.yaml 의 id)
    kind: word                                    # domain | word | term | customField
    library: 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341 # 라이브러리 id
    item: 01a0cc5e-eedc-7919-8f5d-f0301716e827    # 라이브러리 항목 id
    version: 1                                    # 받아 온 항목 버전
    base:                                         # 받아 온 시점의 값 — 「내가 고쳤는가」의 기준
      description: null
      englishName: Customer
      logicalName: 고객
      abbreviation: CUST
```

(주석은 설명용이다 — 실제 파일에는 주석이 없다.)

- ⚠️ **손으로 고치지 않는다.** 사전 파일(`words.yaml` 등)의 값을 고치는 것은 괜찮다 — `base` 와 달라져
  「프로젝트가 고친 항목」이 되고, 원본이 바뀌면 `dict pull` 이 충돌로 알린다. 용어의 `base.domainId` 는
  이름이 아니라 **이 프로젝트의 도메인 id** 다(기계용 파일이라 id 를 쓴다).
- **사전 파일에서 항목을 지우면 그 출처 줄은 조용히 무시되고 다음 쓰기에서 정리된다.** 오류가 아니다.
- **출처가 0건이면 파일이 없다.** 파일이 없는 것도 출처 0건이다.
- **이 파일에서 줄을 지우고 `push` 하면 서버의 출처도 떨어진다** — 파일이 진실이다. 그래서 `push` 가
  확인 전에 한 줄로 알린다(→ [6.6](#66-erdd-push)). 의도하지 않았으면 `erdd pull` 로 되돌린다.
- **형식이 틀리면 파일 오류다** — `serve` 는 편집이 잠기고 `push`·`dict` 는 거절하며 `erdd validate` 가
  가리킨다. 틀린 줄은 `origins[i]` 번호로 나온다.

  | 메시지 | 원인 |
  |---|---|
  | `origins[N]의 형식이 올바르지 않습니다 — id·kind·library·item·version(정수)·base(객체)가 필요합니다` | 키가 빠졌거나 `kind` 가 넷 밖이거나 `version` 이 정수가 아니다 |
  | `origins[N]가 객체가 아닙니다` | 목록 원소가 객체가 아니다 |
  | `id <id>의 출처가 두 번 적혀 있습니다` | 같은 항목의 줄이 둘이다 |
  | `id <id>의 kind가 word로 적혀 있지만 실제로는 term입니다` | `kind` 가 실제 항목 종류와 다르다 |

---

## 6. 명령 레퍼런스

**공통 옵션.**

| 옵션 | 뜻 |
|---|---|
| `--json` | stdout 에 JSON 한 덩어리. 진행 메시지·프롬프트는 stderr 로 나간다. |
| `--yes` | 확인 프롬프트를 건너뛴다(비대화형 필수). |
| `--strict` | `validate` 는 경고를, `diff` 는 충돌을 실패로 본다. 다른 명령에는 영향이 없다. |
| `--help`, `-h` | 도움말. 항상 종료 코드 `0`. |

**종료 코드.**

| 코드 | 뜻 |
|---|---|
| `0` | 성공 |
| `1` | 실패 — 검증 실패, 충돌, 서버 오류, 사용자 취소, 설정 없음 |
| `2` | 사용법 오류 — 알 수 없는 명령, 필수 인자 누락 |

### 6.1 `erdd init`

서버·토큰·프로젝트를 연결한다. → [3.2](#32-erdd-init)

| | |
|---|---|
| 전용 옵션 | `--server <url>` · `--token <token>` · `--project <id>` · `--local` · `--create` · `--org <이름\|id>` · `--name <이름>` · `--dialect <방언>` · `--case <UPPER_SNAKE\|lower_snake>` |
| 서버 호출 | `auth.me`, (선택 시) `org.list`·`project.list`, `project.get`. `--create` 는 `auth.me`·`org.list`·`project.create` |
| 쓰는 파일 | `erdd.config.yaml` · `.erdd/credentials.json` · `.gitignore`. `--create` 는 여기에 `.erdd/base.json`·`.erdd/sync.json`(빈 기준선) |

**`--local` 은 서버 연결 없이 로컬 전용 프로젝트를 만든다** → [3.4](#34-로컬-모드--서버-없이-쓰기).
서버를 한 번도 부르지 않고 `.erdd/credentials.json` 도 쓰지 않는다(`erdd.config.yaml` 과 `.gitignore`
뿐이다). 다른 인자와 달리 **기존 config 를 `--yes` 로도 덮어쓰지 않는다.**

**`--dialect` 와 `--case` 는 `--local`·`--create` 전용이다.** 로컬 전용 프로젝트에는 설정을 받아 올 서버가
없고 `--create` 는 서버에 만들 값을 정해야 해서 이 둘만 여기서 정하고, 나머지 명명 규칙(`separator`·`logicalSeparator`·`maxLengthBytes`·
템플릿)은 기본값으로 시작해 `erdd.config.yaml` 을 직접 고쳐 바꾼다.

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

⚠️ **기존 프로젝트에 연결할 때(`--local`·`--create` 없이) 이 둘을 주면 사용법 오류(`2`)다** —
`--dialect·--case는 init --local·--create 전용입니다 — 기존 프로젝트에 연결할 때는 서버 프로젝트 설정을 따릅니다`.
서버 프로젝트의 방언·명명 규칙이 진실 원천이라, 여기서 받아 봐야 첫 `pull` 이 곧바로 덮어쓴다.

#### `--create` — 서버에 프로젝트를 만들어 연결한다

```bash
erdd init --server <url> --token <토큰> --create --org <조직 이름|id> --name <프로젝트 이름> [--yes]
```

**조직 Owner/Admin 만 된다**(웹에서 프로젝트를 만들 수 있는 사람과 같다). 시작 상태에 따라 셋으로 갈린다.

| 시작 상태 | 하는 일 |
|---|---|
| `erdd.config.yaml` 이 없다 | 서버에 빈 프로젝트를 만들고(`--dialect`·`--case` 가 생성값, 기본 `postgresql`·`UPPER_SNAKE`) 연결한다. `erdd/` 가 비어 있으면 빈 사전 파일 다섯을 함께 쓴다 — 빈 서버를 `pull` 한 것과 같은 상태다 |
| **로컬 전용 config**(`serverUrl: null`) — **이관** | 확인을 받은 뒤, 로컬 config 의 방언·명명 규칙·테이블 옵션으로 서버 프로젝트를 만들고 config 에 `serverUrl`·`projectId` 를 채워 다시 쓴다(구독도 그대로). **`erdd/` 는 한 바이트도 건드리지 않는다** |
| 이미 서버에 연결된 config | 거절(`1`) — 기존 서버 프로젝트를 고아로 만들지 않는다 |

**기준선은 빈 모델이다.** `pull` 없이 `push` 가 요구하는 기준선(`.erdd/base.json`)을 세우므로,
`erdd/` 에 파일이 있으면(이관이거나, config 만 없던 디렉터리) **다음 `erdd diff` 가 전부 「추가」로 보이고
`erdd push` 로 올라간다.** 그때는 안내도 다르다.

```bash
# 빈 디렉터리
$ erdd init --server http://127.0.0.1:3004 --token "$T" --create --org 플랫폼팀 --name 스모크 --yes
서버 프로젝트 스모크을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.

# 로컬 전용 프로젝트(erdd/words.yaml 에 단어 둘)
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

- **이관은 확인을 받는다** — `이 로컬 프로젝트를 서버 프로젝트 "이관"로 연결합니다. 계속할까요? [y/N]`.
  `--yes` 로 건너뛴다. 비대화형(`--json`)에서 `--yes` 가 없으면
  `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요`(`1`).
- **이관은 저장된 파일만 올린다.** `erdd serve` 에 저장하지 않은 편집이 있으면 안내 앞에
  `⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 나온다.
- 이관 직후 `erdd status` 에는 `erdd/` 에 없던 빈 사전 파일이 `-` 로 보일 수 있다. 내용이 빈 목록이라
  `diff`·`push` 에는 영향이 없고 `push` 한 번으로 사라진다.
- `erdd/layout.yaml`(배치 좌표·메모)은 서버로 올라가지 않는다. 서버 쪽 배치는 웹 에디터의 「자동 정렬」로
  새로 잡는다.
- `--org` 는 조직 이름이나 id 다. 없으면 대화형으로 고르게 하고, 비대화형이면 사용법 오류(`2`) —
  `--org를 주거나 대화형으로 실행하세요`. `--name` 이 없으면 `서버에 만들 프로젝트 이름을 입력하세요` 로
  묻는다. 공백뿐인 이름은 `프로젝트 이름이 비었습니다`(`2`).
- 서버가 CLI 보다 옛 버전이라 토큰으로 프로젝트를 만들 수 없으면
  `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요`(`1`)로 멈추고 로컬에 아무것도 쓰지 않는다.
  토큰을 재발급해도 풀리지 않는다.
- `--create` 는 `--project`·`--local` 과 함께 쓸 수 없다(`2`). **이관할 때는 `--dialect`·`--case` 도 줄 수
  없다**(`2`) — `로컬 프로젝트를 이관할 때는 erdd.config.yaml의 방언·명명 규칙을 씁니다 — --dialect·--case를 빼세요`.
- 로컬 config 의 명명 규칙·테이블 옵션이 서버 형식에 맞지 않으면 **서버를 부르기 전에** 멈춘다(`1`) —
  `erdd.config.yaml의 namingRules.case가 올바르지 않습니다` 처럼 키를 가리킨다. `erdd/` 의 YAML 이 깨져
  있어도 서버를 부르기 전에 멈춘다. 반쯤 만들어진 서버 프로젝트를 남기지 않기 위해서다.

**막히는 경우.**

| 상황 | 메시지 | 종료 코드 |
|---|---|---|
| 권한 없음(새 디렉터리) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 erdd init --project <id> 로 연결하세요` | `1` |
| 권한 없음(이관) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요` | `1` |
| 이미 연결됨 | `이미 서버 프로젝트에 연결돼 있습니다 — 다른 프로젝트로 바꾸려면 erdd init --project <id> --yes` | `1` |
| 조직 없음 | `조직 <이름>을(를) 찾지 못했습니다` | `1` |
| 같은 이름의 조직이 여럿 | `이름이 <이름>인 조직이 여럿입니다 — id로 지정하세요` | `2` |

권한이 없을 때 이관 쪽 안내가 `--project` 연결을 권하지 않는 이유 — 그 연결에는 빈 기준선이 없어서
다음 `pull` 이 `erdd/` 를 서버의 빈 상태로 덮는다. 수동 절차는
[로컬 모드 매뉴얼 7.2](local-guide.md#72-로컬로-시작한-프로젝트를-서버로-옮기기) 에 있다.

`--json` 은 `{ configPath, projectId, projectName, migrated, hasLocalFiles }` 를 낸다 — `migrated` 는 로컬 전용
config 를 이관했는가, `hasLocalFiles` 는 `erdd/` 에 올릴 파일이 있었는가(= 다음에 `diff`·`push` 할 것이 있는가)다.

### 6.2 `erdd pull`

서버 스키마를 파일로 내려받는다. **로컬 변경을 덮어쓴다.**

```bash
$ erdd pull
커머스: 테이블 24개를 받았습니다 (리비전 42)
```

로컬에 변경이 있으면 먼저 목록을 보이고 확인을 받는다.

```
로컬 변경 2건이 덮어쓰기 됩니다:
  erdd/tables/MBR.yaml
  erdd/words.yaml
계속할까요? [y/N]
```

거절하면 `사용자가 취소했습니다` 와 함께 종료 코드 `1`. `--yes` 로 건너뛴다. 비대화형(`--json`)에서
`--yes` 가 없으면 묻지 못하므로 멈춘다 — `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께
주세요`(코드 `CANCELLED`, 종료 코드 `1`).

⚠️ **기준선(`.erdd/base.json`)이 없어도 `erdd/` 에 파일이 있으면 묻는다.** 저장소를 클론한 직후나
연결 설정만 적은 직후가 그렇다 — 비교할 기준이 없으니 `erdd/` 의 파일 **전부**를 덮어쓸 변경으로 보인다.
묻지 않는 것은 `erdd/` 가 비어 있을 때(진짜 최초 `pull`)뿐이다.

```
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

클론한 파일이 서버와 같다면 `--yes` 로 받아도 잃는 것이 없다(받은 뒤 `erdd status` 가 「로컬 변경 없음」이다).
**로컬 전용으로 만든 스키마를 서버에 붙이는 중이라면 `pull` 하지 않는다** — 서버가 비어 있으면 그 스키마가
지워진다. `erdd init --create` 를 쓴다(→ [6.1](#61-erdd-init)).

**서버에서 사라진 테이블의 파일은 지워진다.** `erdd/tables/*.yaml` 중 서버에 없는 것과, 최상위 5개
파일 중 서버가 내려주지 않은 것이 삭제 대상이다.

⚠️ **`pull` 중간에 중단(Ctrl+C 등)하면 기준선이 트리보다 낡은 채 남는다.** 다음 `status` 가 손대지
않은 파일을 "로컬 변경"으로 오탐할 수 있다. `erdd pull --yes` 를 한 번 더 돌리면 수렴한다.

`--json` 은 `{ revisionSeq, written, deleted, tables, warnings }` 를 낸다.

**공용 사전 출처(`erdd/origins.yaml`)도 받는다.** 웹에서 가져오기·승격을 했거나 승격 요청이 승인되면
서버 항목에 출처가 붙고, 다음 `pull` 이 그것을 `origins.yaml` 로 쓴다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)).

### 6.3 `erdd status`

**서버를 부르지 않는다.** 연결 정보와 로컬 변경만 본다.

```bash
$ erdd status
서버   https://erdd.example.com
프로젝트 018f6b0e-0000-7000-8000-000000000001
마지막 pull 리비전 42 (2026-08-14T05:12:33.109Z)
로컬 변경 2건
  + erdd/tables/CPN.yaml
  M erdd/tables/MBR.yaml
```

연결 설정이 없는 로컬 전용 프로젝트에서는 위 두 줄이 이렇게 바뀐다.

```bash
$ erdd status
서버   (로컬 전용 — 연결 설정 없음)
프로젝트 (로컬 전용)
아직 pull하지 않았습니다
로컬 변경 없음
```

`--json` 은 그때 `"serverUrl": null, "projectId": null` 을 낸다.

⚠️ **로컬 전용 프로젝트에서 「로컬 변경 없음」은 영영 그대로다.** 비교 기준선인 `.erdd/base.json`
(마지막 pull 시점)이 애초에 생기지 않으므로 `status` 는 변경 계산 자체를 건너뛴다 — 무엇을 고쳤든
「로컬 변경 없음」을 종료 코드 `0` 으로 낸다. **로컬 모드에서 변경을 보는 것은 `git status`·`git diff` 다.**

`+` 추가 · `M` 수정 · `-` 삭제. 아직 `pull` 하지 않았으면 「아직 pull하지 않았습니다」가 나오고
변경은 「로컬 변경 없음」으로 본다. 비교는 **키 순서와 무관한 값 비교**라, YAML 을 재작성해 키
순서만 바뀐 파일은 수정으로 잡지 않는다.

### 6.4 `erdd validate`

**서버를 부르지 않고** 로컬 파일만 검사한다. 커밋 훅·CI 에 넣기 좋다.

```bash
$ erdd validate
정합성 문제 없음
명명 경고 3건
  등록되지 않은 단어가 있습니다: 회원
  등록되지 않은 단어가 있습니다: 회원번호
  등록되지 않은 단어가 있습니다: 회원명
```

검사는 3단계다.

| 단계 | 무엇 | 실패하면 |
|---|---|---|
| 파싱 | YAML 구조, `id` 중복, 이름 참조 해소 | 종료 코드 `1`, 파일별 메시지 |
| 정합성 | 존재하지 않는 테이블·그룹·도메인 참조 등 | 종료 코드 `1` |
| 명명 경고 | 아래 10종 | 기본 `0`, `--strict` 면 `1` |

**경고 종류** — 미등록 단어(`unknown-word`), 용어 불일치(`term-mismatch`), 물리명 길이 초과
(`too-long`), 예약어(`reserved`), 물리명 중복(`duplicate-physical`, `duplicate-physical-table`),
관계 매핑 누락(`incomplete-mapping`), 관계 타입 불일치(`type-mismatch`), 필수값 비어 있음
(`required-empty`), 필수 커스텀 항목 누락(`custom-required`).

명명 경고는 `erdd.config.yaml` 의 `namingRules`·`dialects` 를 기준으로 계산한다 — 서버에서 그
설정을 바꿨다면 `pull` 을 먼저 해야 결과가 서버와 맞는다.

### 6.5 `erdd diff`

로컬과 서버의 차이를 **미리 본다. 아무것도 쓰지 않는다.**

```bash
$ erdd diff
올릴 변경 2건
  + 컬럼 MBR.MBR_GRD_CD
  M 테이블 MBR  설명: 회원 → 서비스 가입 회원

내려올 변경 1건
  M 컬럼 ORD.ORD_DT  타입: DATE → TIMESTAMP

충돌 없음
```

- **`push` 와 완전히 같은 병합 엔진을 쓴다** — 여기서 본 것과 실제 반영이 갈라지지 않는다.
- **항상 3-way 미리보기다.** 「마지막 pull 시점 기준」 모드나 `--base` 플래그는 없다.
- **기본 종료 코드는 `0`** 이다(정보 제공). `--strict` 를 주면 충돌이 있을 때 `1`.
- 기준선(`.erdd/base.json`)이 없으면 서버를 부르기 전에 멈춘다 —
  `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요`.

### 6.6 `erdd push`

로컬 변경을 서버에 반영한다.

```bash
$ erdd push -m "회원 등급 컬럼 추가"
반영했습니다 (리비전 43, 변경 2건)
```

| | |
|---|---|
| 전용 옵션 | `-m`, `--message <요약>` — Revision 요약(최대 200자, 넘으면 잘린다) |
| 서버 호출 | `model.get`(계획) → `model.push`(반영) → `project.get`+`model.get`(암묵적 pull) |

**요약을 주지 않으면 자동으로 만든다** — `CLI push (테이블 1건 · 컬럼 5건)` 형태. `-m ""` 도 값을
주지 않은 것과 같이 보고 자동 요약으로 떨어진다.

**삭제가 있으면 목록을 보이고 확인한다.**

```
삭제 2건이 서버에 반영됩니다:
  - 컬럼 MBR.MBR_TEL
  - 인덱스 IX_MBR_02
계속할까요? [y/N]
```

참조가 끊겨 **병합이 대신 지우는 항목**이 있으면 근거가 다르므로 따로 나열한다.

```
참조가 끊겨 함께 정리되는 항목 3건:
  - 컬럼 ORD.MBR_NO (참조 대상이 삭제됨)
  - 관계 ORD→MBR (참조 대상이 삭제됨)
  - 테이블 ORD (그룹이 삭제되어 참조를 해제함)
```

⚠️ **비대화형(`--json`)에서 삭제가 있으면 `--yes` 를 함께 줘야 한다.** 아니면 이렇게 멈춘다 —
`확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요`(종료 코드 `1`).

**공용 사전 출처를 떼는 변경이 있으면 확인 전에 한 줄로 알린다**(stderr). `erdd/origins.yaml` 에서 줄이
사라진 채 `push` 하면 서버의 출처도 떨어진다 — 파일이 진실이기 때문이다.

```
공용 사전 출처를 떼는 변경 1건이 포함됩니다 — 의도하지 않았다면 erdd pull 로 되돌리세요
```

막지는 않는다(의도한 분리일 수 있다). `--json` 성공 봉투의 `detachedOrigins` 가 그 건수다(0 이어도 실린다).

**막는 것 셋.**

| 상황 | 메시지 | 이유 |
|---|---|---|
| 충돌 | `충돌 N건 — push를 중단했습니다.` | 서버는 그대로다(→ [7절](#7-동기화와-충돌)) |
| `erdd/` 가 통째로 비었는데 기준선에는 파일이 있음 | `erdd/ 아래에 파일이 없습니다. 전체 삭제가 의도라면 파일을 개별로 지우고, 아니라면 erdd pull로 되돌리세요` | `rm -rf` 사고를 "전부 삭제"로 해석하지 않는다 |
| 변경 5,000건 초과 | `변경이 N건으로 한 번에 반영할 수 있는 5000건을 넘습니다. 나눠서 반영하세요` | 단일 Revision = 되돌리기 1회 계약 |

**성공하면 자동으로 pull 한다** — 신규 `id` 가 파일에 채워지고 자동 병합된 서버 변경도 내려온다.

### 6.7 `erdd skill install`

동봉된 에이전트 스킬 문서를 프로젝트에 복사한다. → [9절](#9-ai-에이전트와-함께-쓰기)

```bash
$ erdd skill install
스킬을 설치했습니다: /path/to/my-project/.claude/skills/erdd/SKILL.md
```

| 옵션 | 뜻 |
|---|---|
| `--dir <경로>` | 설치 위치(기본 `.claude/skills/erdd`). `SKILL.md` 는 그 아래에 놓인다. |
| `--force` | 기존 파일 덮어쓰기 |

대상이 이미 있는데 `--force` 가 없으면 종료 코드 `1` 로 멈춘다 —
`…/SKILL.md가 이미 있습니다. 덮어쓰려면 --force를 쓰세요`. 서브명령을 빼면 사용법 오류(`2`)다.

### 6.8 `erdd serve`

로컬 서버를 띄워 브라우저에서 편집한다. **서버 연결이 필요 없다** → [3.4](#34-로컬-모드--서버-없이-쓰기).

```bash
$ erdd serve --no-open --port 4399
http://127.0.0.1:4399 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

| | |
|---|---|
| 전용 옵션 | `--port <번호>`(기본 `4300`) · `--no-open`(브라우저를 자동으로 열지 않는다) |
| 바인딩 | **`127.0.0.1` 고정.** 인증이 없는 서버라 LAN 노출은 옵션으로도 열지 않는다 |
| Host 검사 | `Host` 가 `127.0.0.1:<포트>`·`localhost:<포트>` 계열이 아니면 **403** 이다. 다른 이름(사설 DNS·`/etc/hosts` 별칭·리버스 프록시)으로는 닿지 않는다 — 바인딩만으로는 **DNS 리바인딩**(공격자 페이지가 브라우저를 통해 이 서버에 읽고 쓰는 것)을 막지 못한다 |
| 웹 번들 | **미리 빌드된 번들을 정적으로 내보낸다.** 후보는 둘이고 **저장소의 `apps/web/dist` 를 먼저 본다** — 있으면 그것이 이기고, 없을 때 패키지 안의 `web/`(레지스트리 설치본의 동봉본)로 떨어진다. 설치본에는 저장소 후보가 존재할 수 없어 언제나 동봉본이 쓰인다. 저장소 배치에서 둘 다 없으면 서버는 뜨는데 브라우저에 JSON 404 만 나온다 — `pnpm -C apps/web build` (→ [로컬 모드 매뉴얼 2.3](local-guide.md#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)) |
| 서버 호출 | 없다. `erdd.config.yaml` 과 `erdd/` 파일만 읽고 쓴다 |
| 쓰는 파일 | `.erdd/draft.json`(편집마다) · `erdd/**` 와 `erdd/layout.yaml`(**「저장」할 때만**) · `erdd/snapshots/`(스냅샷) · `erdd.config.yaml`(설정 저장 시) |

- **`erdd.config.yaml` 이 없으면 뜨지 않는다** — `erdd.config.yaml이 없습니다. erdd init을 먼저
  실행하세요`(종료 코드 `1`). `erdd init --local` 로 만든다.
- **연결 설정이 있는 프로젝트에서도 뜬다.** 그때는 config 의 `projectId` 로 열고, 없으면 고정 id
  (`00000000-0000-7000-8000-000000000000`)로 연다 — 실행마다 바뀌지 않으므로 주소를 북마크해도 된다.
  `/` 로 들어가면 그 프로젝트 화면으로 넘어간다.
- **포트가 이미 쓰이면 다음 포트를 자동으로 잡지 않고 멈춘다**(종료 코드 `1`). 에이전트가 고정 포트를
  가정한 채 남의 서버에 붙는 것을 막는다.

  ```
  오류: 포트 4399이 이미 사용 중입니다. --port로 다른 포트를 지정하세요
  ```

- `--port` 에 정수가 아닌 값을 주거나 값을 빠뜨리면 사용법 오류(`2`)다 —
  `--port 값이 올바르지 않습니다: abc`.
- **`Ctrl+C`(SIGINT·SIGTERM)로 끝낸다.** 종료 전에 대기 중인 **드래프트** 쓰기를 밀어 넣으므로
  방금 옮긴 좌표·방금 만든 메모가 남는다.
- 브라우저를 못 열면(`--no-open` 이 아닌데 실행기가 없을 때) `브라우저를 열지 못했습니다. 직접 … 을
  여세요` 만 남기고 서버는 계속 돈다.

### 6.9 `erdd export`

로컬 파일을 DDL 또는 DBML 로 내보낸다. **서버를 부르지 않는다** — `validate` 와 같은 순수 파일
경로다(`erdd/` → 모델 → DDL). 서버 모드에서도 **로컬 파일**이 원본이므로, 서버의 최신 상태를
내보내려면 먼저 `erdd pull` 한다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--format <ddl\|dbml>` | `ddl` | 산출 형식. 다른 값은 사용법 오류(`2`) |
| `--dialect <방언>` | `erdd.config.yaml` 의 `dialects[0]` | `DIALECTS` 밖의 값은 사용법 오류(`2`) |
| `-o <경로>` | (없음 = stdout) | 쓸 파일. 상위 디렉터리는 만들어 준다 |

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

⚠️ **stdout 에는 산출물 본문만 나간다.** 내보내기 경고도, 방언 안내도 전부 **stderr** 다 —
`erdd export > schema.sql` 이 이 명령의 주 용도라, 한 줄이 섞이면 파일이 깨진다.

```bash
$ erdd export --dialect postgresql > schema.sql
알림: postgresql는 erdd.config.yaml의 dialects에 없습니다(mysql). 그대로 내보냅니다
#  ↑ stderr. schema.sql 에는 DDL 만 들어간다
```

- ⚠️ **DBML 의 `Project` 이름은 작업 디렉터리 이름이다**(위 예시의 `my-project`). 이름 자체는
  표시용이지만 **그 블록이 방언을 실어 나른다** — `database_type` 이 곧 `erdd import` 가 읽는
  방언이라(→ [6.10](#610-erdd-import-파일)의 판별 표), 이 블록이 없으면 되읽을 때 방언이 받는
  쪽 `config.dialects[0]` 으로 떨어진다. 파일시스템 루트에서 내보내면 이름이 비어 블록이 빠진다.
- **`config.dialects` 에 없는 방언도 유효하기만 하면 낸다.** 일회성으로 다른 DB 의 DDL 이 필요한
  것은 정상적인 쓰임이라 막지 않고, 대신 위처럼 stderr 로 한 줄 알린다.
- 내보내기 경고(컬럼이 없거나 물리명이 빈 테이블은 제외된다)도 stderr 로 `경고: …` 로 나온다.
  `--json` 이면 `warnings` 배열에도 함께 실린다.
- 로컬 파일에 파싱 오류가 있으면 **`validate` 와 같은 봉투**로 종료 코드 `1` 이다.

### 6.10 `erdd import <파일>`

DDL 또는 DBML 파일을 로컬 파일 트리에 가져온다. **웹 에디터의 「DDL·DBML 가져오기」와 같은
경로**라 동작도 같다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--format <ddl\|dbml>` | 확장자로 판별 | `.sql`·`.ddl` → ddl, `.dbml` → dbml |
| `--dialect <방언>` | 아래 판별 순서 | `DIALECTS` 밖의 값은 사용법 오류(`2`) |
| `--dry-run` | — | 계획만 내고 **파일을 하나도 건드리지 않는다** |
| `--yes` | — | 쓰기 전 확인을 건너뛴다 |

**형식 판별**: `--format` > 확장자 > **실패하면 사용법 오류(`2`)**. 내용을 추정하지 않는다 —
틀린 파서로 읽으면 테이블이 하나도 안 잡힌 채 「0건 가져왔습니다」로 조용히 끝나기 때문이다.

```bash
$ erdd import dump.txt
오류: dump.txt의 형식을 확장자로 정할 수 없습니다 — --format ddl 또는 --format dbml을 주세요(확장자는 .sql·.ddl이면 ddl, .dbml이면 dbml입니다)
$ echo $?
2
```

**방언 판별은 형식마다 다르다.**

| 형식 | 순서 |
|---|---|
| DDL | `--dialect` > 본문의 특징 토큰 감지(`detectDialect`) > `config.dialects[0]` |
| DBML | `--dialect` > `Project { database_type }` > `config.dialects[0]` |

⚠️ **DBML 에는 본문 토큰 감지를 쓰지 않는다.** DBML 의 속성 문법(`[pk, increment, …]`)이 감지기의
mssql 대괄호 식별자 시그니처를 **항상** 때려서, 그대로 태우면 어떤 DBML 이든 mssql 로 읽힌다
(2026-09-03 실측). 무엇을 왜 골랐는지는 출력 첫 줄과 `--json` 의 `dialectSource` 에 나온다.

```bash
$ erdd import ../a/schema.sql --dry-run
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
--dry-run이라 파일을 쓰지 않았습니다

$ erdd import ../a/schema.sql --yes
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
파일 7개를 썼습니다. erdd push로 서버에 반영하세요

$ erdd import ../a/schema.dbml --yes     # DBML — erdd export 가 실어 준 Project 를 읽는다
dbml · 방언 mysql(Project의 database_type) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
파일 7개를 썼습니다. erdd push로 서버에 반영하세요
```

⚠️ **머지다. 덮어쓰기가 아니다.**

- **만들어질 이름이 이미 있는 테이블은 건너뛴다** — 기존 테이블의 `id` 도 내용도 그대로다.
  **갱신하지 않는다.** 건너뛴 이름은 `table-conflict` 경고와 `--json` 의 `skipped` 에 나온다.
- 가져오는 파일에 없는 기존 테이블은 **지우지 않는다.**
- 새 엔티티의 `id` 는 그 자리에서 `uuidv7` 로 발급해 **파일에 바로 박는다**(`push` 의 관례와 같다).

**테이블 옵션도 함께 본다.** 꼬리 절에서 `ENGINE`·`DEFAULT CHARSET`(`CHARACTER SET`)·`COLLATE`
만 뽑아 한 줄로 정규화하고, 테이블마다 다르면 **가장 많이 쓰인 것을 채택**한다(동수면 DDL 에 먼저
나온 것). `AUTO_INCREMENT=` 시작값·`ROW_FORMAT`·파티션은 테이블별이거나 범위 밖이라 버린다.
옵션이 없는 테이블은 투표하지 않는다 — 절반이 생략한 덤프에서 있는 값을 잃지 않기 위해서다.

`erdd.config.yaml` 의 그 방언 칸에 대한 반영 규칙은 셋이다.

| 그 방언 칸의 현재 값 | 동작 |
|---|---|
| 비어 있다 | **반영한다** |
| 채택값과 같다 | 아무 일도 없다 |
| 값이 있고 다르다 | **반영하지 않고 알린다**(설정한 값을 조용히 덮어쓰지 않는다) |

값을 바꾸고 싶으면 `erdd.config.yaml` 을 직접 고친다 — 덮어쓰기 플래그는 두지 않았다.
채택값과 반영 여부는 사람용 출력과 `--json` 의 `tableOptions`·`tableOptionsApplied` 에 함께 나온다.

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

⚠️ **연결된 프로젝트에서는 서버에 반영되지 않는다.** 그때는 출력이 그 사실을 한 줄로 함께 알린다
(`(서버 프로젝트 설정에는 반영되지 않습니다 — 다음 erdd pull 이 이 값을 덮어씁니다)`).
서버 값은 웹의 프로젝트 설정 화면에서 바꾼다.

⚠️ **부호 없음을 정수 3종 밖에 붙이면 떨어뜨리고 `unsigned-dropped` 경고를 낸다.**
`SMALLINT`·`INT`·`BIGINT` 만 부호 없음을 가질 수 있다(MySQL 8.0.17 이 `DECIMAL`·`FLOAT`·`DOUBLE`
의 `UNSIGNED` 를 deprecated 했고, 문서 자신이 대신 `CHECK` 를 권한다).

```bash
$ erdd import ../a/schema.sql --yes --json | jq '{added, skipped, warnings}'   # 같은 DDL 을 두 번째로
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

**서버에는 아무것도 보내지 않는다.** `.erdd/base.json`·`sync.json` 을 건드리지 않으므로 가져온
결과는 `erdd status` 에 **로컬 변경**으로 보인다 — 반영은 기존대로 `erdd diff` → `erdd push` 다.

⚠️ **테이블 파일 이름이 물리명 기준으로 재작성된다.** `pull` 과 같은 동작이다(`writeTree` 가
`<물리명>.yaml` 로 정규화한다) — 사람이 직접 지은 파일명은 이 명령을 지나면 바뀌어 있다.

**확인 프롬프트.** `--dry-run` 이 아니고 `--yes` 도 없으면 쓰기 전에 묻는다. 비대화형(`--json`)
에서는 물을 수 없으므로 무엇을 하면 되는지 말하고 멈춘다.

```bash
$ erdd import ../a/schema.sql --json
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
{"error":{"code":"CANCELLED","message":"파일을 덮어씁니다 — 비대화형(--json)에서는 --yes를 함께 주세요"}}
$ echo $?
1
```

**부호 없음과 테이블 옵션은 왕복에서 보존된다.** MySQL 의 `INT UNSIGNED` 는 논리 타입의 1급
속성이라 모델에 그대로 남고, 테이블 옵션(`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)은
`erdd.config.yaml` 의 `tableOptions` 로 올라간다(→ [5.2](#52-erddconfigyaml)). 실제 왕복:

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

정수 표시폭(`int(11)`·`smallint(5)`)은 읽어서 **버린다** — MySQL 8.0.17 부터 deprecated 인
표시 전용 값이라 되살릴 뜻이 없다. `ZEROFILL` 도 같다.

다른 방언으로 내보내면 부호 없음이 `CHECK` 로 바뀐다(그 방언에 부호 없음 타입이 없다):

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

⚠️ **그 `CHECK` 는 되읽히지 않는다** — 파서가 컬럼 인라인 `CHECK` 를 보지 않으므로 PostgreSQL
덤프를 다시 가져오면 그냥 `INT` 다. 부호 없음이 본문으로 왕복하는 것은 **MySQL DDL 뿐**이다.

### 6.11 `erdd dict` — 공용 사전

조직·전역 **공용 사전 라이브러리**(단어·용어·도메인·커스텀 항목)를 로컬 파일과 주고받는다. 라이브러리를
만들고 항목을 관리하는 것, 승격 요청을 승인하는 것은 웹에서 한다([사용자 가이드 13절](user-guide.md#13-공용-리소스)).

```bash
erdd dict list                                        # 이 프로젝트에서 보이는 라이브러리
erdd dict pull --library "플랫폼팀 표준 사전"          # 처음 받기 — 구독에 더한다
erdd dict pull                                        # 이후로는 구독 전부
erdd push -m "…"                                      # 새 단어를 보관함(서버 프로젝트)에 먼저 올리고
erdd dict push --library "플랫폼팀 표준 사전" -m "…"   # 공용으로 올린다(권한이 없으면 승격 요청)
erdd dict requests                                    # 내 프로젝트의 승격 요청과 처리 결과
```

**서버에 연결된 프로젝트에서만 된다.** 로컬 전용 프로젝트에서는 이렇게 멈춘다(`1`) —

```
오류: 서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 (erdd.config.yaml)
```

| 명령 | 서버 호출 | 쓰는 파일 |
|---|---|---|
| `dict list` | `resource.library.listForProject` | 없음 |
| `dict pull` | `resource.library.listForProject`·`resource.items.list` | 사전 파일 넷(`words`·`terms`·`domains`·`custom-fields`)·`origins.yaml`·`erdd.config.yaml`(구독) |
| `dict push` | 위 둘 + `model.get`, `resource.promote` 또는 `promotion.create` | 직접 승격이면 `pull` 과 같다(암묵적 pull) |
| `dict requests` | `resource.library.listForProject`·`promotion.listForProject` | 없음 |

#### `erdd dict list`

```bash
$ erdd dict list
  표준 사전(예시) — 전역 · 항목 14 · 쓰기 가능 · 01a0cc5e-c4a0-7402-b99c-fd41fb2cb350
* 플랫폼팀 표준 사전 — 조직 · 항목 5 · 쓰기 가능 · 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
```

- 앞의 `*` 는 구독 중이라는 표시다(`erdd.config.yaml` 의 `dictionaries`).
- **「쓰기 가능」이 있으면 `dict push` 가 바로 승격하고, 없으면 승격 요청이 된다.** 조직 라이브러리는
  조직 Owner/Admin, 전역 라이브러리는 서비스 관리자만 쓸 수 있다.
- 보이는 라이브러리가 없으면 `이 프로젝트에서 보이는 라이브러리가 없습니다`.

#### `erdd dict pull`

라이브러리 항목을 **로컬 파일**에 받는다. 처음이면 전부 복사하고, 이후로는 **재동기화**(3-way)다 —
웹의 「가져오기」와 같은 계산을 로컬 파일에 돌린다. **서버 프로젝트는 건드리지 않는다** — 받은 것은 다음
`erdd push` 때 보관함에 올라간다.

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

- **`--library <이름|id>`** — 그 라이브러리만 받고, 구독에 없으면 더한다. 이름이 여럿에 맞으면 후보를
  보이고 멈춘다(`2`) — `이름이 <이름>인 라이브러리가 여럿입니다 — id로 지정하세요`. 없으면
  `라이브러리 <이름>을(를) 찾지 못했습니다 — erdd dict list 로 확인하세요`(`1`).
- **인자가 없으면 구독 전부를 적힌 순서대로** 처리한다. 구독이 없으면
  `구독한 라이브러리가 없습니다 — --library <이름|id> 로 지정하세요 (목록: erdd dict list)`(`2`).
- 구독한 라이브러리가 사라졌거나 권한이 없어졌으면 **그것만 건너뛰고** 나머지를 받는다(stderr 에
  `경고: 라이브러리 <이름>(<id>)을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`, 보고에는
  `<이름> — 찾을 수 없어 건너뛰었습니다`). 구독은 지우지 않는다.
- **`--dry-run`** — 계획만 보이고 파일도 config 도 쓰지 않는다. 마지막 줄이 `미리보기입니다 — 파일을
  쓰지 않았습니다` 다.
- **다시 돌려도 바뀐 것이 없으면 아무 파일도 쓰지 않는다**(`바뀐 파일이 없습니다`).
- 사전과 무관한 테이블·그룹 파일은 건드리지 않는다. 사람이 `id` 없이 적은 사전 항목에는 이 명령이
  `id` 를 채운다(`push` 가 채우는 것과 같다).
- 로컬 파일이 깨져 있으면 거절한다(`erdd validate` 로 확인하라는 문구와 함께 `1`).
- `erdd serve` 가 떠 있어도 된다 — 파일 감시가 받는다. 저장하지 않은 편집이 있으면 화면에 「파일이
  밖에서 바뀌었습니다」 배너가 뜬다.
- **재동기화는 파일(저장된 값)을 기준으로 한다.** `erdd serve` 에 저장하지 않은 편집이 있으면 stderr 에
  `⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 먼저 나온다.
  알림일 뿐이라 판정·종료 코드·`--json` 봉투는 그대로다.

**항목마다 어떻게 되나 — 기본값은 웹 「가져오기」의 기본 선택과 같다.**

| 상태 | 뜻 | 기본 | 바꾸는 옵션 |
|---|---|---|---|
| 추가 | 로컬에 없는 원본 항목 | 받는다 | — |
| 자동 갱신 | 받은 뒤 로컬에서 안 고쳤는데 원본이 바뀌었다 | 원본 값으로 바꾼다 | — |
| 충돌 | 로컬에서도 고쳤고 원본도 바뀌었다 | **보류**(파일을 바꾸지 않고 다음에 다시 알린다) | `--conflicts theirs`(원본 반영) · `--conflicts ours`(로컬 유지 — 이 변경을 검토했다고 기록해 다시 뜨지 않는다) |
| 이름 중복 | 원본과 같은 이름의 항목이 로컬에 이미 있다(출처 없음) | **건너뜀** | `--adopt` — 내용이 같으면 그 로컬 항목에 출처를 연결한다. 내용이 다르면 `--adopt --conflicts ours` 여야 연결된다(아래) |
| 유지 | 이미 최신이거나 로컬 자체 항목 | 그대로 | — |
| 원본에서 사라짐 | 원본 항목이 지워졌다 | 로컬에 남겨 둔다 | — |

```bash
# 원본(라이브러리)에서 「번호」 약어가 바뀌고, 로컬이 고쳐 둔 「고객」도 원본이 바뀌었을 때
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

충돌 줄은 `종류 이름  (바뀐 필드 키)` 다 — 필드는 파일의 키 이름 그대로이고 값의 전후는 보이지 않는다.
`--conflicts ours` 면 머리줄이 `충돌 N — 로컬 유지:` 다.

**`--adopt` — 로컬로 시작해 이미 자기 단어가 있는 프로젝트가 사전에 합류할 때.**

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

- **연결은 내용을 바꾸지 않고 출처만 붙인다.** 연결 대상은 같은 종류·같은 이름(앞뒤 공백 무시)이고 **아직
  출처가 없는** 로컬 항목이다. 커스텀 항목은 적용 대상(`target`)도 같아야 한다. 연결할 수 없는 이름 중복은
  따로 센다 — `이름 중복 N — 연결할 수 없음 (같은 이름 항목을 다른 원본이 차지했거나 커스텀 항목의 적용 대상이 다릅니다)`.
- **내용이 같은 항목만 연결한다.** 내용이 다른 채 연결하면 그 항목은 「라이브러리 값과 다른 연결 항목」이
  되어, 다음 `dict push` 가 그것을 **원본 갱신으로 기본 선택**한다 — 한 번도 보지 않은 라이브러리 값을 이
  프로젝트의 값으로 덮게 된다. 그래서 내용이 다른 이름 중복은 `--adopt` 여도 연결하지 않고 다른 필드와 함께
  보인다.

  ```bash
  $ erdd dict pull --adopt
  플랫폼팀 표준 사전 (조직)
    추가 0 · 자동 갱신 0 · 연결 0 · 유지 5
    이름 중복 1 — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)
      단어 고객  (abbreviation)
  바뀐 파일이 없습니다
  ```

  항목 줄은 충돌 줄과 같은 `종류 이름  (다른 필드 키)` 다. 이 줄은 `--adopt` 없이 돌려도 나온다 —
  **`건너뜀 (--adopt 로 연결)` 은 `--adopt` 를 주면 실제로 연결되는 항목만 센다.** 줄 순서는 `충돌` →
  `건너뜀` → `내용이 달라 연결하지 않음` → `연결할 수 없음` → `원본에서 사라짐` 이다.
- 용어는 가리키는 도메인이 이번에 연결되지도 추가되지도 않으면(예: 그 도메인이 내용이 달라 연결되지 않았다)
  내용이 다른 것으로 본다 — 필드는 `domainId` 로 보인다. 도메인을 먼저 정리하면 용어도 따라 연결된다.
- **내용이 다를 때는 어느 값으로 맞출지 골라서 정리한다.**

  | 원하는 것 | 하는 법 |
  |---|---|
  | 로컬 값을 유지한 채 연결 | `erdd dict pull --adopt --conflicts ours` — 로컬 값 유지에 동의한 것으로 보고 연결한다. 그 뒤 `push` → `dict push` 하면 이 값이 원본 갱신으로 올라간다(원본 값을 **보고 나서** 덮는 것이다) |
  | 원본 값으로 바꾸기 | 로컬 항목을 지우고 다시 `erdd dict pull` — 이름 중복이 사라져 「추가」로 받는다. 도메인처럼 다른 파일이 이름으로 가리키는 항목은 지우면 파일이 깨져 `dict pull` 이 거절하므로, 괄호의 필드를 원본 값으로 고친 뒤 `--adopt` 한다(내용이 같아져 연결된다) |

  `--conflicts theirs` 는 이 갈래에서 아무것도 하지 않는다 — 연결하지도 원본 값으로 바꾸지도 않는다.
- `--adopt --conflicts ours` 로 연결한 항목은 로컬 값이 원본과 다른 「로컬에서 고친 항목」이라, 나중에
  원본이 바뀌면 자동 갱신이 아니라 **충돌**로 알린다(로컬 값을 조용히 덮지 않는다).

**`--file <경로>` — 서버가 내보낸 파일에서 받는다. 서버 연결이 필요 없다.**

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

- **서버에 연결되지 않은(로컬 전용) 프로젝트에서도 된다.** `--library` 는 서버 목록에서 골라야 하므로
  연결이 필요하지만, `--file` 은 그 파일을 그대로 읽을 뿐이라 서버를 부르지 않는다(→
  [로컬 모드 매뉴얼 7.3](local-guide.md#73-공용-사전을-받아-쓰기--erdd-dict)).
- **파일은 배포 파일이어야 한다** — 서버가 내보낸 파일처럼 `library.id`·항목 `id`·`version` 이 모두
  있어야 한다. 사람이 적은 원천 파일이나 `library import`·웹 가져오기가 받는 Excel 은 여기 쓸 수
  없다(`1`) —

  ```
  오류: <경로>: 서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) — 오류 N건
    library.id — 배포 파일에는 필수입니다 — 서버에서 내보낸 파일만 받을 수 있습니다
    …
  ```

- **처음 받으면 그 라이브러리를 파일 구독으로 config 에 남긴다**(`erdd.config.yaml` 의
  `dictionaries[].file`, → [5.2](#52-erddconfigyaml)). 인자 없는 `erdd dict pull` 은 그 경로를 다시
  읽는다 — 배포 파일을 새 버전으로 다시 받아 그 자리에 덮어써 두면 다음 `dict pull` 이 그 변경을 본다.
  **같은 라이브러리 id 로 `--file` 을 다시 주면 그 구독 줄이 파일 구독으로 바뀐다**(서버 구독이었어도).
- **구독이 가리키는 라이브러리와 다른 파일을 주면 거절한다**(`1`) —

  ```
  오류: 구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<다른 id>)입니다 — 다른 라이브러리로
  바꾸려면 구독 줄을 지우고 --file 로 다시 받으세요
  ```

  다른 라이브러리로 바꾸려면 `erdd.config.yaml` 에서 그 구독 줄을 지우고 `--file` 로 다시 받는다.
- **그 밖의 판정(추가·자동 갱신·충돌·이름 중복·`--adopt`)은 서버 구독과 완전히 같다** — 위 표와 규칙을
  그대로 따른다. `--library` 와 `--file` 은 함께 줄 수 없다(`--file 과 --library 는 함께 쓸 수
  없습니다`, `2`).

#### `erdd dict push`

로컬에서 만든 사전 항목을 공용 라이브러리로 올린다. 판정과 쓰기는 **서버의 승격 엔진**이 **서버
프로젝트(보관함)의 값**으로 한다 — 웹 「조직으로 승격」과 같은 계산이다.

**전제 — 올리기 전에 `erdd push` 로 보관함을 최신으로 만든다.** 승격 대상은 서버에 있는 값이라, 로컬에서
고친 값이 서버에 없으면 **보던 값이 아니라 보관함의 옛 값이** 올라간다. 그래서 둘을 확인하고 멈춘다(`1`).

| 상황 | 메시지 | 할 일 |
|---|---|---|
| push 하지 않은 로컬 변경이 있다 | `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` | `erdd push` |
| 마지막 pull 뒤에 서버가 바뀌었다 | `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` | `erdd pull` (로컬 변경이 없으므로 잃는 것이 없다) |
| 기준선이 없다 | `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` | `erdd pull` |

**`erdd serve` 에 저장하지 않은 편집은 올라가지 않는다.** 그런 편집이 있으면 stderr 에
`⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` 가 먼저 나온다(알림일
뿐이라 멈추지 않는다). 그 편집도 올리려면 화면에서 저장한 뒤 `erdd push` → `dict push` 한다.

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

계획 목록(`+` 신규 추가 · `~` 원본 갱신 · `=` 동명 발견, 괄호 안은 라이브러리 값과 다른 필드)과 확인
질문은 stderr, 결과 한 줄은 stdout 이다.

**용어의 도메인이 라이브러리에 없고 이번에 함께 올리지도 않으면, 라이브러리 용어의 도메인 연결이 빈다.**
그 용어 행 끝에 표시가 붙는다 — `--kind term`·`--name`·아래의 원본 앞섬 제외처럼 도메인을 빠뜨리기 쉬운
필터 뒤의 **최종 선택**을 기준으로 판정한다(웹 「조직으로 승격」의 「도메인 연결 비움」 배지와 같은 판정).

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --kind term
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 용어 주문금액  (도메인 연결 비움 — 금액을(를) 함께 올리면 연결됩니다)
계속할까요? [y/N]
```

연결을 살리려면 거절하고 도메인을 함께 올린다(`--kind domain,term` 또는 `--name` 에 도메인 이름을 더한다).

| 구역 | 뜻 | 기본 |
|---|---|---|
| 신규 추가 | 라이브러리에 없는 항목 | 보낸다 |
| 원본 갱신 | 이미 연결된 라이브러리 항목을 이 프로젝트 값으로 올린다 | 보낸다 — **단, 라이브러리 원본이 마지막 `dict pull` 이후 바뀐 항목은 뺀다**(아래) |
| 동명 발견 | 같은 이름의 다른 항목이 라이브러리에 있다 | **보내지 않는다** — `--include-name-match` 로 포함(그 항목을 이 프로젝트 값으로 갱신하고 연결한다) |

- **`--kind <종류,…>`**(`domain`·`word`·`term`·`customField`)와 **`--name <이름>`**(반복 가능)으로 올릴
  항목을 좁힌다. 요약의 `동명 발견 N` 은 이 필터를 적용한 뒤 센다.
- 올릴 것이 없으면 `올릴 항목이 없습니다`(`0`). 그때 `--name` 에 맞는 항목이 없었거나 동명 발견을 뺐으면
  stderr 에 `--name 에 맞는 항목이 없습니다: <이름, …>` / `동명 발견 N건은 제외했습니다 — 올리려면
  --include-name-match` 가 함께 나온다.
- 확인은 `--yes` 로 건너뛴다. 비대화형(`--json`)에서는 `--yes` 가 필수다 —
  `확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요`(`1`).
- `--library` 는 필수다(`--library <이름|id> 가 필요합니다`, `2`).

**라이브러리 원본이 마지막 `dict pull` 이후 바뀐 항목은 올리지 않는다.** 받아 온 뒤 다른 사람이 라이브러리의
그 항목을 고쳤다면(`origins.yaml` 의 `version` 보다 라이브러리 버전이 크다), 이 프로젝트의 값은 **그 사람의
새 값보다 오래된 값**이다 — 로컬에서 손대지 않았어도 값이 다르니 「원본 갱신」으로 잡히고, 그대로 올리면
남이 고친 원본이 옛 값으로 되돌아간다. 그래서 그런 항목은 **`--name` 으로 지정해도** 선택에서 빼고,
계획 목록 뒤(확인 질문 앞)에 따로 알린다.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --yes
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 단어 결제
라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 2건은 제외했습니다 — erdd dict pull 로 먼저 받으세요
  ~ 단어 고객  (abbreviation)
  ~ 단어 번호  (abbreviation)
승격했습니다 — 신규 1 · 갱신 0
```

**이런 항목을 올리려면 먼저 `erdd dict pull` 로 받는다.** 로컬에서 손대지 않은 항목은 자동 갱신으로 원본
값이 되어 올릴 것이 사라지고, 로컬에서도 고친 항목은 충돌로 보류된다. 로컬 값을 공용으로 올리는 것이
의도라면 `--conflicts ours` 로 정리한 뒤 `push` → `dict push` 하면 그때는 원본 갱신으로 올라간다
(원본의 최신 값을 **보고 나서** 덮는 것이기 때문이다).

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

제외로 올릴 것이 0건이 되면 `올릴 항목이 없습니다`(`0`)이고, 제외 안내 두 줄은 그대로 stderr 에 나온다.

⚠️ **종료 코드 `0` 은 「올라갔다」가 아니다.** CLI 쪽 선택(원본 앞섬 제외·동명 발견 제외·`--name` 불일치)으로
올릴 것이 0건이 되면 서버를 부르지 않고 `0` 으로 끝난다. 종료 코드 `1` 로 끝나는 「전부 건너뜀」은 **서버가**
확인 뒤 전부 건너뛴 경우뿐이다(아래). 스크립트·에이전트가 올라갔는지를 판정하려면 `--json` 의
`selected: 0`(올릴 것이 없었다)과 `behind`(원본 앞섬으로 뺀 항목)를 본다(→ [10.1](#101---json-규약)).

**권한에 따라 결과가 갈린다** — `erdd dict list` 의 「쓰기 가능」.

- **쓰기 가능 → 바로 승격한다.** 서버가 확인 뒤 다시 계산해 그 사이 어긋난 항목만 건너뛰고, 성공하면
  자동으로 `pull` 해 `erdd/origins.yaml` 을 받는다(새로 올린 항목에 출처가 붙는다).
  - 건너뛴 항목은 `  건너뜀 단어 주문 (그 사이 계획이 바뀜)`(또는 `(대상이 사라짐)`)처럼 나열하고 종료 코드는 `0`
    이다. **전부 건너뛰면** `승격된 항목이 없습니다 — 전부 건너뛰었습니다` 와 함께 `1` 이다.
  - 승격은 됐는데 자동 `pull` 이 실패하면 `승격했습니다 — 신규 N · 갱신 M. 파일 갱신에 실패했습니다 —
    erdd pull을 실행하세요 (<사유>)`(`1`). **다시 `dict push` 하지 말고 `erdd pull` 한다.** 확인을 기다리는
    사이 로컬 파일을 고쳤으면 사유가 `확인하는 사이 로컬 파일이 바뀌어 덮어쓰지 않았습니다` 다.
- **쓰기 불가 + 조직 라이브러리 → 승격 요청을 만든다.** `-m` 이 요청 메모다. 로컬 파일은 바뀌지 않는다.

  ```bash
  $ erdd dict push --library "플랫폼팀 표준 사전" -m "스모크 요청" --yes
  신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
    + 단어 주문
  승격 요청을 만들었습니다 (1건). 조직 관리자가 웹에서 승인하면 반영됩니다
  ```

  그 사이 지워진 항목이 있으면 둘째 줄에 `(N건은 그 사이 사라져 빠졌습니다)` 가 붙는다.
  **승인되면 서버 항목에 출처가 붙고, 다음 `erdd pull` 이 `origins.yaml` 에 받아 온다** — 서버만 바뀐
  것이라 충돌하지 않는다.
- **쓰기 불가 + 전역 라이브러리 → 서버를 부르기 전에 거절한다**(`1`) —
  `전역 라이브러리로는 승격을 요청할 수 없습니다 — 서비스 관리자만 전역 라이브러리에 올릴 수 있습니다`.

#### `erdd dict requests`

이 프로젝트의 승격 요청을 오래된 것부터 보인다. 날짜는 로컬 날짜다.

```bash
$ erdd dict requests
[승인] 2026-09-23 플랫폼팀 표준 사전 — 1건 · 멤버
  메모: 스모크 요청
  처리 메모: 승인 — 스모크
```

- 상태는 `[대기]`·`[승인]`·`[반려]`·`[취소]` 다. **처리 메모**(승인자가 남긴 사유 — 반려 사유 포함)는
  웹 프로젝트 화면에는 없고 여기서 볼 수 있다.
- `--status pending|resolved|rejected|cancelled` 로 거른다. 요청이 없으면 `승격 요청이 없습니다`.
- 요청 취소와 승인은 웹에서 한다. 요청 항목의 이름은 보이지 않는다(건수만 보인다).

### 6.12 `erdd library` — 라이브러리 관리

공용 라이브러리를 **파일로** 내보내고 가져온다(`.erdd-lib.yaml`, `format: erdd-library`). 라이브러리
쓰기 권한이 있는 사람(조직 Owner/Admin, 전역은 서비스 관리자)만 가져올 수 있고, 내보내기는 읽을 수
있으면 누구나 된다. 가져오기의 판정 규칙은
[../guides/shared-resources.md](../guides/shared-resources.md) 「파일 내보내기·가져오기」에 있다.

**프로젝트 없이 돈다** — 관리자가 빈 디렉터리나 CI 에서 부르는 명령이다. 서버 주소는 `--server <url>`,
없으면(서버에 연결된 프로젝트 안에서 실행할 때) `erdd.config.yaml` 의 `serverUrl`. 둘 다 없으면
멈춘다(`2`) —

```
오류: 서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요
```

토큰은 다른 명령과 같은 순서(`ERDD_TOKEN` → `.erdd/credentials.json`)로 찾는다.

```bash
erdd library list                                                   # 보이는 라이브러리
erdd library export "표준 사전(예시)" -o standard.erdd-lib.yaml    # 배포 파일로 내보내기
erdd library import standard.erdd-lib.yaml --library "표준 사전(예시)"          # 그 라이브러리에 반영
erdd library import standard.erdd-lib.yaml --create "새 라이브러리" --scope global   # 새로 만들며 가져오기
```

#### `erdd library list`

```bash
$ erdd library list --server http://127.0.0.1:3001
  표준 사전(예시) — 전역 · 항목 14 · 쓰기 가능 · 019fff92-8724-7f9e-88f4-627da6a47f20
  데모 사전 — 전역 · 항목 14 · 쓰기 가능 · 01a0cf70-8bb2-7bf8-9635-821049933b45
```

토큰이 속한 조직을 모두 돌며 전역 + 조직 라이브러리를 모은다. 「쓰기 가능」이 없으면 `library import` 가
그 라이브러리를 거절한다. 보이는 라이브러리가 없으면 `볼 수 있는 라이브러리가 없습니다`.

#### `erdd library export <이름|id> [-o 파일]`

```bash
$ erdd library export "표준 사전(예시)" -o standard.erdd-lib.yaml --server http://127.0.0.1:3001
내보냈습니다 — standard.erdd-lib.yaml
```

- `-o` 가 없으면 stdout(`--json` 이면 JSON 봉투 하나)에 낸다.
- 삭제된 도메인을 가리키던 용어가 있으면(도메인 없이 내보낸다) stderr 에 `삭제된 도메인을 가리키던
  용어 N건은 도메인 없이 내보냈습니다`.
- 이름이 여럿에 맞거나 라이브러리를 못 찾으면 `dict pull`(→ [6.11](#611-erdd-dict--공용-사전))과 같은
  오류 문구이되 안내 명령만 `erdd library list` 다 — 예: `라이브러리 없는사전을(를) 찾지 못했습니다 —
  erdd library list 로 확인하세요`(`1`).
- `<이름|id>` 없이 부르면 `사용법: erdd library export <이름|id> [-o 파일]`(`2`).

#### `erdd library import <파일> (--library <이름|id> | --create <이름> --scope <global|org>)`

라이브러리 파일이나 손으로 적은 원천 파일·Excel(`.xlsx`, 헤더는
[사용자 가이드 16절 Excel 사전 가져오기](user-guide.md#16-가져오기)와 같다)을 읽어 기존 라이브러리에
반영하거나 새 라이브러리를 만들며 반영한다. **`--library`·`--create` 중 정확히 하나**가 필요하다 — 둘
다 없거나 둘 다 있으면 `--library 와 --create 중 정확히 하나를 주세요`(`2`).

| 상태 | 뜻 | 기본 | 바꾸는 옵션 |
|---|---|---|---|
| 추가 | 라이브러리에 없는 항목 | 반영 | — |
| 갱신 | 이미 매칭된 항목을 파일 값으로 바꾼다 | 반영 | — |
| 그대로 | 파일과 라이브러리 값이 같다 | 손대지 않는다 | — |
| 오래된 파일 | 항목 id 로 매칭됐고 파일의 `version` 이 서버보다 낮다(이 라이브러리에서 내보낸 뒤 서버가 앞서 나갔다) | **건너뜀** | `--include-stale` — 서버의 새 값을 파일의 옛 값으로 덮는다 |
| 파일에 없음 | 파일이 그 종류를 말했는데(빈 목록이어도) 그 안에 없는 기존 항목 — 종류 자체가 파일에 없으면 대상이 아니다 | **남긴다** | `--prune` — 지운다(남는 항목이 가리키는 도메인은 지우지 않고 경고한다) |

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

- **`--dry-run`** — 계획만 보이고 아무것도 쓰지 않는다.
- **`--yes`** — 미리보기 없이 바로 반영한다. 결과 줄에 「반영했습니다」가 붙지 않는다(확인을 거치는
  경로에는 붙는다) — 반영 여부는 종료 코드(`0`)와 위 요약 숫자로 본다.
- **`--yes` 도 `--dry-run` 도 없으면** 계획을 보인 뒤 `가져올까요? [y/N]` 로 한 번 묻고, 승낙하면 같은
  요약 뒤에 `반영했습니다` 가 붙는다.

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

  **이 확인을 기다리는 사이 남이 먼저 반영했으면** `CONFLICT` 로 거절되고(`미리보기 이후 라이브러리가
  바뀌었습니다 — 다시 미리보기 하세요 — 아무것도 반영하지 않았습니다`, `1`) 다시 실행해 새 미리보기부터
  본다. `--yes` 로 미리보기 없이 바로 반영하는 경로에는 이 확인이 없다.
- **`--create <이름> --scope <global|org>`** — 새 라이브러리를 만들며 파일 전체를 「추가」로 반영한다
  (`init --create` 와는 다른 명령이다). `--scope org` 면 `--org <이름|id>` 가 필요하다
  (`--scope org 에는 --org <이름|id> 가 필요합니다`, `2`).

  ```bash
  $ erdd library import standard.erdd-lib.yaml --create "데모 사전" --scope global --server http://127.0.0.1:3001 --yes
  데모 사전 (전역, 새로 만듦)
    추가 14 · 갱신 0 · 그대로 0 · 삭제 0
  ```

- **`--prune`** — 파일이 말한 종류인데 파일에 없는 기존 항목을 지운다. 주지 않으면 그 항목은 남고
  요약 줄에 `(--prune 이 없어 파일에 없는 N건은 남김)` 이 붙는다. 남는 용어가 가리키는 도메인은
  `--prune` 이어도 지우지 않고 경고가 함께 뜬다.
- **`--include-stale`** — 「오래된 파일」 항목도 파일 값으로 덮는다. 서버가 더 앞서 나간 값을 되돌리는
  것이므로 기본은 꺼져 있다.
- **파일이 잘못됐으면 서버를 부르기 전에 거절한다**(`1`) — 라이브러리 파일이면
  `라이브러리 파일 오류 N건 — 아무것도 반영하지 않았습니다` 뒤에 문제 줄, Excel 이면
  `Excel 오류 N건 — 아무것도 반영하지 않았습니다` 뒤에 시트·행과 함께.
- `--library` 로 지정한 라이브러리에 쓸 권한이 없으면 서버를 부르기 전에 거절한다(`1`, `<이름> 에 쓸
  권한이 없습니다`).

**제약** — 반영은 한 트랜잭션이다(전부 아니면 전무). 갱신은 항목마다 `UPDATE` 한 번이라 대량 갱신은
느릴 수 있다. 자세한 목록은 [../guides/shared-resources.md](../guides/shared-resources.md) 「알려진
한계」의 「파일 내보내기·가져오기」.

### 6.13 `erdd changes`

로컬 모드 전용. 스키마 수정 내역(변경 기록)을 `erdd/changes/` 에 남긴다. 무엇이고 어떻게 쓰는지는
[로컬 모드 매뉴얼 5.6](local-guide.md#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역), 문법은
[변경 기록 문법](../guides/changeset-format.md).

```
erdd changes [--check] [--json]
erdd changes new <이름> [--baseline] [--json]
```

| 형태 | 하는 일 | 종료 코드 |
|---|---|---|
| `erdd changes` | 기록 수·경합 경고·미기록 변경 미리보기 | `0`, 기록이 깨졌거나 기록을 만들 수 없는 상태면 `1` |
| `erdd changes --check` | 위와 같고, 미기록 변경이 있으면 실패 | 미기록이 있으면 `1` |
| `erdd changes new <이름>` | 미기록 변경을 `erdd/changes/<시각>_<이름>.erddc` 로 기록 | `0`, 거절이면 `1` |
| `… --baseline` | 첫 기록에 「이미 DB 에 있음」 표시 | 기록이 이미 있으면 `1` |

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

- 보는 것은 **디스크의 `erdd/`** 다. 미저장 편집은 포함하지 않고, 있으면 `new` 가 거절한다.
- `--json` 은 `{ records, pending, warnings, error, unsaved }`(상태) / `{ ok, file, statementCount }`
  (생성)이다. 거절은 오류 봉투에 `reason`(`name`·`empty`·`baseline`·`invalid`·`unsaved`·`local-only`)이 실린다.
- 서버에 연결된 프로젝트에서는 `변경 기록은 로컬 모드 전용입니다 …` 로 멈춘다(`1`).

---

## 7. 동기화와 충돌

### 7.1 3-way 병합

`push` 와 `diff` 는 세 모델을 놓고 비교한다.

| 이름 | 무엇 | 어디서 |
|---|---|---|
| **기준(base)** | 마지막 `pull` 시점의 모델 | `.erdd/base.json` |
| **로컬(local)** | 지금 `erdd/` 파일의 내용 | 작업 디렉터리 |
| **서버(server)** | 지금 서버의 모델 | `model.get` |

**비교는 필드 단위다.**

- 기준 대비 **한쪽만** 바뀐 필드 → 그 값을 채택해 **자동 병합**한다.
- 양쪽이 **서로 다른 값으로** 바꾼 필드만 **충돌**이다.
- 배열·객체인 필드(컬럼 매핑, 인덱스 컬럼 목록 등)는 통째로 한 값으로 본다.

그래서 같은 테이블을 나와 다른 사람이 동시에 고쳐도, 서로 다른 필드를 고쳤다면 충돌하지 않는다.

### 7.2 충돌이 나면

**push 를 중단하고 서버는 변경되지 않는다.** 파일별로 묶어 세 값을 나란히 보여준다.

```
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

- `(없음)` — 그 시점에 값이 없었다. `(삭제됨)` — 그쪽에서 항목 자체를 지웠다.
- 항목 통째로 갈린 경우에는 필드 이름 대신 `로컬에서 삭제, 서버에서 수정` 같은 사유가 나온다.
- `--json`(`push`·`diff`)에서는 `conflicts[]` 의 `reason` 이 갈래다 — `field`(필드 값) · `both-added`
  · `local-delete` · `server-delete` · `duplicate-origin`(아래).

**해결 절차.**

1. `erdd pull` 로 서버 변경을 받는다(로컬 변경이 덮어쓰이므로, 살릴 내용은 미리 복사해 둔다).
2. 파일에서 원하는 값으로 정리한다.
3. `erdd diff` 로 확인하고 `erdd push`.

**같은 공용 사전 항목이 두 번 들어왔을 때(`duplicate-origin`).** 같은 라이브러리 항목을 서버 쪽이 먼저
받았는데(다른 사람의 `dict pull` + `push`, 웹 「가져오기」) 이쪽도 `dict pull` 로 받아 push 하면, 두 항목은
id 가 달라 필드 충돌로는 잡히지 않는다. 그대로 올리면 이후 재동기화가 한쪽만 갱신해 다른 쪽이 옛 값으로
남으므로 push 를 막는다. **이 push 가 만든 중복만 막는다** — 서버에 이미 있던 중복은 이 push 로 고칠 수
없어 막지 않는다. 무엇을 지울지가 두 갈래로 갈린다.

```
충돌 1건 — push를 중단했습니다.

erdd/words.yaml
  단어 고객 · 같은 공용 사전 항목이 두 번 들어왔습니다 — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요
    기준  (없음)
    로컬  고객 (id 018f6b0e-0000-7000-8000-0000000000b2) · v1 · 항목 item-1
    서버  고객 (id 018f6b0e-0000-7000-8000-0000000000a1) · v1 · 항목 item-1

erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.
```

| 경로 · 문구 | 무엇이 일어났나 | 할 일 |
|---|---|---|
| 사전 파일(`erdd/words.yaml` 등) · `… — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요` | 로컬이 **새로 추가한** 항목이 서버 항목과 같은 원본을 가리킨다 | 그 항목만 사전 파일에서 지우고 다시 `push` — 서버의 항목이 `pull` 로 내려온다 |
| `erdd/origins.yaml` · `… — 이 항목의 출처 줄을 지워 연결을 풀고 다시 push 하세요` | 로컬이 **기존 항목에 출처를 붙였는데**(`--adopt` 등) 서버에 같은 원본의 항목이 따로 있다 | `erdd/origins.yaml` 에서 그 항목의 줄만 지우고 다시 `push`. 항목을 지우면 서버의 기존 데이터가 지워진다 |

⚠️ **이 충돌에는 위의 해결 절차(먼저 `erdd pull`)를 쓰지 않는다.** `pull` 은 로컬 변경을 서버 상태로
덮으므로, 지워야 할 항목이 **다른 로컬 작업과 함께** 사라진다. 표의 한 줄만 지우고 다시 push 한다.
값 줄은 `이름 (id …) · 출처` 다 — 두 항목은 이름이 같기 쉬워 id 로 어느 쪽을 지울지 가린다. 로컬이 새로
추가한 갈래의 기준은 `(삭제됨)` 이 아니라 `(없음)` 이다.

### 7.3 경합 — 서버가 앞서 나갔을 때

계획을 세운 뒤 반영하기 전에 남이 먼저 커밋하면 서버가 거절한다. **CLI 가 한 번 자동으로 다시
계산해 재시도한다**(`서버가 앞서 있어 다시 계산합니다`). 두 번째도 거절되면 그대로 오류로 끝난다.

### 7.4 push 가 정상으로 끝나지 않는 세 가지

| 결말 | 무엇이 일어났나 | 무엇을 하면 되나 |
|---|---|---|
| **충돌** (`ok:false`, `conflicts`) | 서버는 그대로다 | 7.2 절차 |
| **반영 여부 불명** (`outcomeUnknown:true`) | 연결이 끊겨 요청이 서버에 닿았는지 알 수 없다 | **그대로 다시 `push`** 하면 중복 없이 수렴한다. 먼저 보고 싶으면 **`erdd diff`** 를 쓴다 |
| **반영됨 + 파일 갱신 실패** (`committed:true`, `syncError`) | 서버 반영은 끝났고 이후 자동 pull 이 실패했다 | `erdd pull` |

⚠️ **"반영 여부 불명" 에서는 `erdd pull` 을 먼저 쓰지 않는다.** 반영되지 않았을 경우 pull 이 로컬
변경을 서버 상태로 덮어써 지운다 — 다시 push 하면 수렴한다는 성질 자체가 사라진다. `erdd diff` 는
읽기만 하므로 안전하다.

**왜 다시 push 해도 사본이 안 생기나** — `push` 는 서버로 보내기 **직전에** 이번에 발급한 신규
`id` 를 로컬 파일에 먼저 박아 둔다(디스크 동기화까지 한다). 그래서 응답이 유실돼 같은 내용을 다시
보내도 서버는 같은 `id` 를 "이미 있는 것"으로 보고 수정으로 처리한다. `--json` 응답의
`reservedFiles` 가 그때 실제로 다시 쓴 파일 목록이다.

---

## 8. 파일에 담기지 않는 것

**서버와 오가는 파일** — `erdd/tables/*.yaml` 과 최상위 5개 — 은 스키마의 **의미 정보만** 담아
diff 를 깨끗하게 유지한다. 다음은 그 파일들에 없고, `pull`·`push` 도 건드리지 않는다(서버에 있던
값이 그대로 보존된다).

| 스키마 파일에 담기지 않는 것 | 어디서 다루나 |
|---|---|
| 테이블 배치 좌표(캔버스 위치, 그룹 뷰 좌표) | 서버 DB 쪽은 웹 에디터. `erdd serve` 로 옮긴 것은 **모드와 무관하게 `erdd/layout.yaml`**(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)) |
| 메모(note) | 위와 같다 |

**공용 사전 출처는 여기 들지 않는다** — 사전 파일 옆의 `erdd/origins.yaml` 에 담기고 `pull`·`push` 가
서버와 주고받는다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)).

⚠️ **`erdd/layout.yaml` 도 서버와 오가지 않는다.** `erdd serve` 로 옮긴 좌표는 `push` 해도 서버에
반영되지 않고, `pull` 이 그 파일을 덮어쓰지도 않는다 — **서버 모드에서도 마찬가지다.** 서버 쪽
배치를 손보려면 웹 에디터로 한다.

에이전트가 "좌표를 옮겨 달라"·"메모를 남겨 달라"는 요청을 **스키마 파일**(`erdd/tables/*.yaml` 과
최상위 5개)에서 처리하려 하면 안 된다 — 그런 정보는 그 파일들에 없다. 그 자리는 **모드와 무관하게**
`erdd/layout.yaml` 이고, 사람이 `erdd serve` 화면에서 옮기면 거기에 쌓인다. **그 파일을 잔재로 보고
지우지 않는다** — 메모 본문이 함께 들어 있다.

---

## 9. AI 에이전트와 함께 쓰기

### 9.1 스킬 설치

```bash
erdd skill install                 # .claude/skills/erdd/SKILL.md
erdd skill install --dir .agent/skills/erdd --force
```

**문서가 두 모드를 모두 다룬다.** 맨 앞에서 `erdd.config.yaml` 의 `serverUrl` 로 모드를 판별하게
하고(`projectId` 와 함께 값이 있으면 서버 모드, 둘 다 `null` 이거나 키 자체가 없으면 로컬 모드, 한쪽만
있으면 설정 오류 → [3.4](#34-로컬-모드--서버-없이-쓰기)), 워크플로와 금지 사항 중 갈리는 것을 모드별로
갈라 적는다. 로컬 전용 프로젝트에 깔려도 에이전트가 `pull`·`push` 를 시도해 종료 코드 `1` 로 막히는
일이 없다.

설치되는 문서는 에이전트에게 다음을 지시한다.

- **스키마를 알아야 하면 마이그레이션·ORM 코드를 뒤지지 말고 `erdd/` 파일을 읽는다.**
- **먼저 모드를 판별한다.** 진실 원천이 서버 모드는 서버, 로컬 모드는 `erdd/` 파일 자체다.
- 수정 워크플로 — 서버 모드는 `pull` → 편집 → `validate` → `diff` → `push`, 로컬 모드는 편집 →
  `validate` → **git 커밋**(`pull`·`push`·`diff` 는 종료 코드 `1` 로 멈춘다는 것을 함께 알린다).
- **로컬 모드에서 `status` 로 변경을 확인하지 않게 한다** — 기준선이 없어 언제나 「로컬 변경 없음」
  이다(→ [6.3](#63-erdd-status)). 비교는 `git status`·`git diff` 다.
- **물리명을 임의로 만들지 않는다** — ① `terms.yaml` 에서 논리명이 같은 용어의 물리명을 그대로
  쓰고 ② 없으면 `words.yaml` 의 단어를 조합하며(회원 `MBR` + 번호 `NO` → `MBR_NO`) ③ 조합에 필요한
  단어가 사전에 없으면 `words.yaml` 에 함께 등록한다.
- 컬럼 타입은 가능하면 `domain` 으로 지정한다(방언별 타입·기본값·허용값이 따라온다).
- `custom-fields.yaml` 에 `required: true` 인 항목이 있으면 대상의 `custom` 에 값을 채운다.
- **하지 말 것(공통)** — 기존 `id` 수정·삭제, 복사한 파일에서 `id` 를 안 지우기(`validate` 가 종료
  코드 `1` 로 막는다), 테이블 파일 이름 직접 변경, `.erdd/` 편집, **좌표를 손으로 고치기**
  (`erdd serve` 화면에서 옮긴다 — 좌표는 스키마 파일에 없다).
- **`erdd/layout.yaml` 은 `erdd serve` 로 편집하면 모드와 무관하게 생기는 커밋 대상**이고 메모 본문이
  함께 들어 있다 — 잔재로 보고 지우지 않는다. 다만 서버와 오가지는 않는다.
- **`id` 는 두 모드 모두 CLI 가 발급한다** — 서버가 발급하는 것이 아니다.
- **모드별로 갈리는 것** — 공용 사전 출처(`erdd/origins.yaml`)와 `erdd dict` 는 서버 모드에만 해당한다.
  출처 파일은 **손으로 고치지 않는다**고 지시한다(사전 항목을 지우면 그 줄은 다음 저장에서 정리된다).

### 9.2 에이전트에게 쥐여 줄 때의 요령

- **토큰은 `ERDD_TOKEN` 으로 준다.** 파일에 두면 에이전트가 읽어 로그에 흘릴 수 있다.
- **비대화형에서는 `--json --yes` 를 함께 준다.** `--json` 만 주면 삭제가 포함된 push 가 확인
  프롬프트를 만들 수 없어 멈춘다.
- **`validate` 를 push 전에 반드시 돌리게 한다.** 서버를 부르지 않으므로 비용이 없고, 명명 규칙
  위반을 사전에 잡는다.
- 권한은 토큰 발급자의 역할을 그대로 따른다 — 에이전트에게 읽기만 시키려면 **Viewer 계정으로 발급한
  토큰**을 준다. **조직 관리자의 토큰을 에이전트에게 주지 않는다** — 그 토큰으로는 `erdd dict push` 가
  승인 없이 조직 라이브러리를 고치고 `erdd init --create` 가 프로젝트를 만든다(→ [3.1](#31-개인-액세스-토큰-발급)).

---

## 10. 자동화와 CI

### 10.1 `--json` 규약

- **stdout 은 항상 파싱 가능한 JSON 한 덩어리다.** 진행 메시지·프롬프트·확인 질문은 전부 stderr 로
  나가므로 `command --json 2>/dev/null | jq` 가 안전하다.
- 실패도 같은 규약이다 — stdout 에 오류 봉투가 나온다.

```bash
$ erdd status --json          # erdd.config.yaml 이 없는 디렉터리
{"error":{"code":"NO_CONFIG","message":"erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요"}}
$ echo $?
1
```

**오류 코드.**

| `code` | 뜻 | 종료 코드 |
|---|---|---|
| `USAGE` | 명령·인자 사용법 오류 | `2` |
| `NO_CONFIG` | `erdd.config.yaml` 이 없다 | `1` |
| `UNAUTHORIZED` | 토큰이 없거나 통하지 않는다 | `1` |
| `FORBIDDEN` | 권한이 없다 | `1` |
| `NOT_FOUND` | 조직·프로젝트·라이브러리를 찾지 못했다 | `1` |
| `VALIDATION` | 파일·입력이 잘못됐다 | `1` |
| `CONFLICT` | 서버가 앞서 나갔다(재시도 후에도) | `1` |
| `CANCELLED` | 사용자가 취소했거나 확인이 필요하다 | `1` |
| `NETWORK` | 연결·응답 해석 실패, 그 밖의 오류 | `1` |

⚠️ **에이전트·스크립트가 재시도를 판단할 때 `code` 로 분기한다면**, `NETWORK` 만 재시도 대상으로
삼는다. `VALIDATION`·`FORBIDDEN` 은 같은 명령을 다시 돌려도 영원히 실패한다.

**`export` 의 JSON.** `content` 와 `path` 는 **서로 배타다** — 같은 본문을 두 자리에 싣지 않는다.
`-o` 를 줬으면 본문은 그 파일에 있으므로 `content` 가 `null` 이고, 안 줬으면 `path` 가 `null` 이다.

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
| `content` | 산출물 본문. `-o` 를 줬으면 `null` |
| `warnings` | 내보내기 경고 문자열 배열(사람용 출력에서는 stderr 로도 나간다) |

**`import` 의 JSON.**

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
| `format`·`dialect` | 실제로 쓴 형식·방언 |
| `dialectSource` | 방언을 고른 근거 — `"--dialect"` · `"본문에서 감지"` · `"Project의 database_type"` · `"erdd.config.yaml의 dialects[0]"` |
| `dryRun` | `--dry-run` 이었는가. `true` 면 `written`·`deleted` 는 항상 `[]` 다 |
| `added` | **새로 만든** 테이블 수(건너뛴 것은 안 센다) |
| `columns`·`indexes`·`relationships`·`groups` | 새 테이블에 딸려 만들어진 개수 |
| `skipped` | 이름이 겹쳐 **건너뛴** 테이블 이름들(가져오는 파일의 원문 이름) |
| `warnings` | `{kind, target, message}` 배열 — `table-conflict`·`unknown-type`·`unknown-word`·`unresolved-fk`·`unresolved-index` 등 |
| `written`·`deleted` | 실제로 쓰거나 지운 파일 경로(저장소 상대) |

**`dict pull` 의 JSON.** 라이브러리마다 보고 하나다. 보류된 충돌이 있어도 종료 코드는 `0` 이다 —
충돌은 오류가 아니라 계획 결과다.

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
| `libraries[].missing` | 구독했지만 찾을 수 없어 건너뛰었다(`scope` 는 `null`) |
| `added`·`autoUpdated`·`adopted`·`kept`·`detached` | 추가·자동 갱신·연결·유지·원본에서 사라짐 건수 |
| `nameClashSkipped`·`unlinkable` | 이름 중복으로 건너뛴 이름(`--adopt` 면 연결된다) / 연결할 수 없는 이름 — `[{ kind, name }]` |
| `adoptDiffers` | 이름 중복이지만 내용이 달라 연결하지 않은 항목 — `[{ kind, name, fields }]`(`fields` 는 다른 필드 키). `--adopt --conflicts ours` 여야 연결된다 |
| `conflicts[].decision` | `defer`(보류) · `apply`(`--conflicts theirs`) · `keep`(`--conflicts ours`) |
| `written`·`deleted` | 실제로 쓰거나 지운 파일. `dryRun` 이면 항상 `[]` |

**`dict push` 의 JSON.** `mode` 로 갈린다.

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
| 승격됨 + 자동 pull 실패(종료 `1`) | `{ mode: "promote", ok: false, committed: true, syncError, … }` — **다시 올리지 말고 `erdd pull`** |
| 승격 요청 | `{ mode: "request", id, requested, dropped, behind, danglingDomain }` |
| 올릴 것이 없음(종료 `0`) | `{ libraryId, selected: 0, behind }` |

어느 봉투에나 **`behind`** 가 실린다 — 라이브러리 원본이 앞서 있어 뺀 항목의 `[{ kind, name, entityId }]`
(없으면 `[]`). **`danglingDomain`** 은 도메인 연결이 비는 용어의 `[{ name, domain }]`(용어 이름·도메인
이름, 없으면 `[]`)이고, 올릴 것이 없는 봉투에는 없다 — 선택이 없으면 빌 연결도 없다.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --name 고객 --json --yes
{"libraryId":"01a0cc72-fdd9-7a07-8d16-75937f36cd3d","selected":0,
 "behind":[{"kind":"word","name":"고객","entityId":"01a0cc73-5ea4-7256-94f1-4864bf41a9c9"}]}
```

`dict list --json` 은 라이브러리 배열(`canWrite`·`subscribed` 포함), `dict requests --json` 은 요청 배열
(`status`·`note`·`resolutionNote`·`approvedEntityIds` 포함)이다. `init --create` 의 JSON 은
[6.1](#61-erdd-init), `push` 의 `detachedOrigins` 는 [6.6](#66-erdd-push).

⚠️ 파일 파싱 오류일 때는 `export`·`import` 둘 다 **`validate` 와 같은 봉투**
(`{ok:false, parseErrors, integrityIssues, warnings}`)를 내고 종료 코드 `1` 이다 — 오류 봉투
(`{error:{code,…}}`)가 아니다.

### 10.2 CI 예시

스키마 파일이 서버와 어긋난 채 머지되는 것을 막는다.

```bash
#!/usr/bin/env bash
set -euo pipefail
export ERDD_TOKEN="$ERDD_CI_TOKEN"

# 1) 서버 없이 파일 자체 검사 — 경고도 실패로 본다
erdd validate --strict --json > validate.json || {
  echo "스키마 파일 검사 실패"; cat validate.json; exit 1
}

# 2) 서버와의 충돌 여부 확인 — 충돌이면 실패
erdd diff --strict --json > diff.json || {
  echo "서버와 충돌이 있다 — erdd pull 로 정리하고 다시 올려라"; cat diff.json; exit 1
}
```

**반영까지 자동화한다면** `--yes` 가 필요하다(삭제 확인 프롬프트를 띄울 수 없다).

```bash
erdd push --json --yes -m "CI: ${GIT_COMMIT:0:8}"
```

⚠️ **`push` 를 CI 에 두는 것은 신중히 결정한다.** 서버가 진실 원천이므로, 웹에서 편집 중인 내용과
경합하면 CI 가 사람의 작업을 되돌릴 수 있다. 보통은 `validate`·`diff` 만 CI 에 두고 `push` 는
사람이 한다.

---

## 11. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `sh: tsx: command not found` (종료 코드 127) | 프로젝트에 `tsx` 가 없다. **빠뜨렸을 때의 증상이 패키지 관리자마다 다르다** — pnpm 은 `npx` 가 그때그때 받아 와 **대개는 돌지만** 네트워크가 없으면 죽고, npm 평면 배치는 캐시가 없으면 `ENOTCACHED` 로 죽는다 | `pnpm add -D tsx` (→ [2.1](#21-요구-사항)) |
| `pnpm exec erdd …` 가 `ERR_PNPM_IGNORED_BUILDS`(`esbuild`)로 죽는다 | **pnpm 11 의 동작이다.** `pnpm exec` 이 먼저 의존성 상태를 확인하며 `pnpm install` 을 돌리는데, 빌드 스크립트가 승인되지 않은 패키지(`tsx` 가 끌어오는 `esbuild`)가 있으면 그 install 이 실패한다. `@erdd/cli` 와 무관하고 pnpm 10 에서는 나지 않는다 | pnpm 이 안내하는 `pnpm approve-builds` 로 `esbuild` 를 승인한다. 그 전에도 **`./node_modules/.bin/erdd` 를 직접 부르면 그대로 동작한다**(실측) |
| ERDD 저장소에서 `packages/cli/src/main.ts` 가 `old mode 100644 / new mode 100755` 로 뜬다 | 방법 B 설치가 bin 진입점에 실행 비트를 붙였다 | `chmod 644 packages/cli/src/main.ts`. 커밋하지 않는다 |
| `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요` | 프로젝트 루트가 아닌 곳에서 실행했거나 아직 연결하지 않았다 | 프로젝트 루트로 이동하거나 `erdd init` |
| `토큰이 없습니다. ERDD_TOKEN을 설정하거나 erdd init을 실행하세요` | 환경 변수도 `.erdd/credentials.json` 도 없다 | 둘 중 하나를 채운다 |
| `code: "UNAUTHORIZED"` | 토큰이 폐기됐거나 오타 | 웹 「설정 → 액세스 토큰」에서 재발급 |
| `code: "FORBIDDEN"` | 발급자가 그 프로젝트에 권한이 없다 | 프로젝트 멤버·역할을 확인한다. 토큰을 바꿔도 권한은 안 넓어진다 |
| `서버 응답에 result가 없습니다 … serverUrl이 ERDD 서버를 가리키는지 확인하세요` | `serverUrl` 이 다른 서버·프록시를 가리킨다 | `erdd.config.yaml` 의 `serverUrl` 을 고친다 |
| `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` | `.erdd/base.json` 이 없다(클론 직후 등) | `erdd pull` |
| `.erdd/base.json이 손상됐습니다. erdd pull로 다시 받으세요` | 기준선 파일 파손 | `erdd pull` |
| 손대지 않은 파일이 `status` 에 「로컬 변경」으로 뜬다 | `pull` 이 중간에 끊겼다 | `erdd pull --yes` 로 다시 받는다 |
| `id …가 …에도 있습니다` | 파일을 복사하고 `id` 를 안 지웠다 | 복사본의 모든 `id` 를 지운다 (→ [5.6](#56-id-취급--가장-흔한-사고)) |
| `… 항목 하나가 두 번 나타납니다 — YAML anchor/alias …` | anchor/alias 를 썼다 | 별칭을 풀어 그대로 적는다 |
| `erdd/ 아래에 파일이 없습니다 …` | `erdd/` 를 통째로 지웠다 | 실수라면 `erdd pull`, 의도라면 파일을 개별로 지운다 |
| `변경이 N건으로 … 5000건을 넘습니다` | 한 번에 너무 많다 | 나눠서 push 한다 |
| push 후 `반영은 성공했습니다 … 파일 갱신에 실패했습니다` | 반영은 끝났고 자동 pull 만 실패 | `erdd pull` |
| push 가 `반영 여부를 확인할 수 없습니다` | 전송 계층 실패 | `erdd diff` 로 확인 후 그대로 다시 `push`. **`pull` 을 먼저 쓰지 않는다** |
| 웹에서 방언·명명 규칙을 바꿨는데 `validate` 결과가 다르다 | 로컬 `erdd.config.yaml` 이 낡았다 | `erdd pull` |
| `MBR.1a2b3c4d.yaml` 처럼 파일명에 접미사가 붙었다 | 물리명이 대소문자만 다른 테이블이 있다 | 정상 동작이다. 이름을 갈라 주면 접미사가 사라진다 |
| `erdd.config.yaml에 연결 설정이 없습니다 …` | 로컬 전용 프로젝트에서 `pull`·`push`·`diff` 를 돌렸다 | 서버에 붙이려면 `erdd init`, 로컬로 쓰려면 `erdd serve` (→ [3.4](#34-로컬-모드--서버-없이-쓰기)) |
| `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다 …` | 둘 중 하나만 적혀 있다 | 둘을 함께 적거나 둘 다 지운다(둘 다 없으면 로컬 전용이다) |
| `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` | `init --local` 인데 config 가 이미 있다 | 기존 파일을 지우고 다시 실행한다. `--yes` 로는 덮이지 않는다 |
| `erdd serve` 는 떴는데 브라우저에 `{"message":"Route GET:/p/… not found"…}` 만 나온다 | 웹 번들이 없다(저장소 배치에서 쓸 때만 나는 증상이다 — 레지스트리 설치본에는 번들이 동봉돼 있다) | ERDD 체크아웃에서 `pnpm -C apps/web build` |
| 웹을 고쳐 다시 빌드했는데 화면이 안 바뀐다 | 브라우저·vite 캐시이거나 `erdd serve` 를 다시 띄우지 않았다. **`packages/cli/web` 의 잔재 때문은 아니다** — 저장소에서는 `apps/web/dist` 가 언제나 이긴다 | `erdd serve` 를 다시 띄우고 새로고침한다 |
| `포트 4300이 이미 사용 중입니다 …` | 다른 `erdd serve` 나 다른 프로그램이 그 포트를 물고 있다 | `--port` 로 다른 포트를 준다 |
| 브라우저 상단에 「파일을 읽을 수 없어 편집이 잠겼습니다」 배너가 뜨고 편집이 안 된다 | `erdd/` 안의 YAML 이 깨졌다 | 배너가 가리키는 파일을 고친다. 고치면 자동으로 풀린다 |
| `erdd serve` 화면에서 테이블이 격자로 나란히 놓여 있다(모드를 가리지 않는다) | `erdd/layout.yaml` 이 없거나 그 테이블 항목이 없다 | 정상이다. 옮기거나 「자동 정렬」을 하면 좌표가 그 파일에 저장된다 |
| `변경 기록은 로컬 모드 전용입니다 …` | 서버에 연결된 프로젝트에서 `erdd changes` 를 돌렸다 | 서버 모드에는 변경 기록이 없다 |
| `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요` | 서버가 CLI 보다 옛 버전이라 `erdd dict`·`init --create` 가 부르는 기능을 토큰에 열지 않았다 | 서버 관리자에게 서버 업그레이드를 요청한다. 토큰을 재발급해도 풀리지 않는다 |
| `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 …` | 로컬 전용 프로젝트에서 `erdd dict` 를 돌렸다 | `erdd init --server … --create` (→ [6.1](#61-erdd-init)) |
| `서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요` | `erdd library` 명령에 `--server` 도 없고 연결된 프로젝트 안도 아니다 | `--server <url>` 을 주거나 서버에 연결된 프로젝트 디렉터리에서 실행한다(→ [6.12](#612-erdd-library--라이브러리-관리)) |
| `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` | `dict push` 전에 로컬 변경이 서버에 없다 | `erdd push` 뒤 다시 `dict push` |
| `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` | `dict push` 전에 서버가 바뀌었다(다른 사람의 편집·승격 승인 등) | `erdd pull` 뒤 다시 `dict push` |
| `파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤 구독의 file 을 지우세요` | `dict push` 의 대상 라이브러리가 파일 구독(`dictionaries[].file`)이다 | `erdd.config.yaml` 에서 그 구독의 `file` 줄을 지우고 `erdd dict pull --library` 로 서버 구독으로 다시 받은 뒤 `dict push` (→ [5.2](#52-erddconfigyaml)) |
| `구독한 라이브러리가 없습니다 …` | 인자 없는 `dict pull` 인데 구독이 없다 | `erdd dict pull --library <이름\|id>` |
| `dict pull` 이 충돌을 계속 「보류」로 보인다 | 로컬에서도 고쳤고 원본도 바뀌었다 | `--conflicts theirs`(원본 값으로) 또는 `--conflicts ours`(로컬 값 유지) |
| `dict pull --adopt` 가 `이름 중복 N — 내용이 달라 연결하지 않음 …` 을 보이고 연결하지 않는다 | 같은 이름의 로컬 항목이 원본과 내용이 다르다 | 로컬 값을 살리려면 `--adopt --conflicts ours`, 원본 값으로 바꾸려면 로컬 항목을 지우고 다시 `dict pull` (→ [6.11](#611-erdd-dict--공용-사전)) |
| `dict pull --file` 이 `서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) …` 로 거절한다 | 사람이 적은 원천 파일이나 Excel 변환 파일을 줬다 | `library export`·웹 「내보내기」가 만든 배포 파일을 쓴다(→ [6.12](#612-erdd-library--라이브러리-관리)) |
| `dict pull` 이 `구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<id>)입니다 …` 로 거절한다 | 파일 구독의 경로에 다른 라이브러리를 내보낸 파일을 덮어썼다 | `erdd.config.yaml` 에서 그 구독 줄을 지우고 `erdd dict pull --file <경로>` 로 다시 받는다 |
| push·diff 가 `같은 공용 사전 항목이 두 번 들어왔습니다 — …` 로 멈춘다 | 서버가 이미 받은 라이브러리 항목을 로컬도 따로 받았다 | 문구대로 그 항목(또는 `origins.yaml` 의 그 줄)만 지우고 다시 `push`. **먼저 `pull` 하지 않는다**(→ [7.2](#72-충돌이-나면)) |
| `프로젝트 생성 권한이 없습니다 — …` | `init --create` 는 조직 Owner/Admin 만 된다 | 안내대로 관리자에게 프로젝트를 만들어 달라고 한다(→ [6.1](#61-erdd-init)) |
| `이미 서버 프로젝트에 연결돼 있습니다 …` | 연결된 프로젝트에서 `init --create` 를 돌렸다 | 다른 프로젝트로 바꾸려면 `erdd init --project <id> --yes` |
| `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` | `pull`·`init --create`(이관)이 확인을 요구했는데 `--json` 이라 물을 수 없다 | 무엇이 덮이는지 stderr 목록을 보고 `--yes` |
| `origins[N]의 형식이 올바르지 않습니다 …` 등 | `erdd/origins.yaml` 을 손으로 고쳤다 | `erdd pull` 로 되받는다(→ [5.8](#58-erddoriginsyaml--공용-사전-출처)) |

---

## 부록: 검증 상태 (2026-08-14)

**여러 시점의 검증이 함께 담겨 있다** — 서버 연결 워크플로는 2026-08-14, 로컬 모드는 2026-08-20,
패키지 게시 형태는 2026-08-29 이고, 아래 `tsx` 항목에는 2026-09-03
재실측이 덧붙어 있다.

**실제 명령으로 확인한 것.** 격리된 임시 프로젝트를 만들어 `@erdd/cli` 를 파일 의존성으로 설치한 뒤
돌렸다.

- `pnpm add <경로>/packages/cli` 로 `node_modules/.bin/erdd` 링크가 생기는 것, **`tsx` 없이는
  `sh: tsx: command not found`(종료 코드 127)로 죽고 `pnpm add -D tsx` 후 정상 동작**하는 것.
  ⚠️ **2026-09-03 재실측에서는 `npx` 가 `tsx` 를 그때그때 받아 와 정상 동작했다**(종료 코드 `0`).
  다만 **설치 형태가 다르다** — 재실측은 팩한 tarball 을 `npm install <tarball>` 로 깐 임시
  디렉터리였고, 위 줄은 `pnpm add <경로>/packages/cli` 다. 어느 한쪽이 틀린 것이 아니라
  **네트워크·캐시·패키지 관리자에 따라 갈린다** — 위 줄은 2026-08-14 의 환경 그대로이고, 지금
  정확한 서술은 [2.1](#21-요구-사항) 에 있다.
- 그 설치가 **ERDD 저장소의 `packages/cli/src/main.ts` 모드를 100644 → 100755 로 바꾸는 것**
  (`git status` 에 잡힌다. 검증 후 되돌렸다).
- `--help` 출력 전문(본문 2.4 는 실제 출력 그대로다).
- 설정이 없는 디렉터리에서 `status` 의 사람용·`--json` 출력과 종료 코드 `1`, 오류 봉투
  `{"error":{"code":"NO_CONFIG",…}}`.
- 최소 트리(`erdd.config.yaml` + 테이블 1개 + 최상위 5개 파일)에서 `validate` 의 사람용·`--json`
  출력, 미등록 단어 경고 3건, **`--strict` 가 종료 코드 `1` 로 바뀌는 것**, `status` 의 사람용 출력.
- `diff` 가 기준선이 없으면 서버를 부르기 전에 `기준 시점이 없습니다…` 로 멈추는 것(종료 코드 `1`).
- `skill install` 의 설치·재실행 거부(`1`)·`--force` 덮어쓰기, `skill` 서브명령 누락의 사용법
  오류(`2`), `init --json --yes` 의 인자 누락 오류(`2`).

**서버를 붙여 확인하지는 않았다.** `init` 의 조직·프로젝트 선택, `pull`·`push`·`diff` 의 실제 서버
왕복, 충돌 출력, 경합 재시도, push 의 비정상 종료 세 갈래는 **소스와 단위 테스트를 읽고 옮긴 것**
이며 실환경 검증이 남아 있다. 인용한 출력 문구는 구현과 테스트의 기대값에서 그대로 가져왔다.

### 로컬 모드 (2026-08-20)

**실제 명령으로 확인한 것.** 스크래치 디렉터리에 로컬 전용 프로젝트를 만들어 돌렸다.

- `erdd init --local` 의 출력과 **만들어지는 것이 `erdd.config.yaml`·`.gitignore` 뿐**인 것
  (`erdd/` 는 만들어지지 않는다), config 초기 내용(본문 3.4 는 실제 파일 그대로다), 재실행이
  `erdd.config.yaml이 이미 있습니다…`(`1`)로 멈추는 것.
- 로컬 전용 프로젝트에서 `status` 의 사람용·`--json` 출력(본문 6.3 그대로), `pull`·`push`·`diff` 가
  `erdd.config.yaml에 연결 설정이 없습니다…`(`1`)로 멈추는 것, `validate` 는 그대로 도는 것.
- `erdd serve --no-open --port 4399` 의 stderr 두 줄(본문 3.4·6.8 그대로), `/` 가
  `/p/00000000-0000-7000-8000-000000000000` 으로 302 하는 것, 같은 포트 재실행의
  `포트 4399이 이미 사용 중입니다…`(`1`), `--port abc` 의 사용법 오류(`2`), `--help` 전문(본문 2.4).
- 연결 설정이 있어도 `.erdd/base.json` 이 없으면 `push` 가 `기준 시점이 없습니다…`(`1`)로 멈추는 것
  (본문 3.4 의 승격 주의).

**브라우저에서 확인한 것**(로컬 모드 사이클의 스모크 11항목) — `/` 가 에디터로 넘어가고 로그인
화면이 뜨지 않는 것, 테이블·컬럼 생성이 `erdd/tables/*.yaml` 과 최상위 5개 파일을 만드는 것,
**드래그가 `erdd/layout.yaml` 만 바꾸고 테이블 YAML 은 그대로인 것**, 메모가 `layout.yaml` 의
`notes` 에 들어가는 것, 「공용 리소스」·참여자·사용자 메뉴가 없는 것, 「버전」에 「스냅샷」·「비교」만
있고 「이력」이 없는 것, 스냅샷 생성·복원과 `erdd/snapshots/`, 터미널에서 파일을 고치면
**새로고침 없이** 화면이 바뀌는 것, 파일을 깨뜨리면 배너 + 「읽기 전용」으로 바뀌고 되돌리면 풀리는
것, `Ctrl+C` 후 다시 `serve` 해도 좌표·메모가 남는 것.

**기준** — `packages/cli`(`main.ts`, `commands/*`, `local/*`, `plan.ts`, `tree.ts`, `client.ts`,
`config.ts`, `output.ts`), `packages/core/src/{file-format,layout,local}.ts`,
`apps/server/src/routers/*`(토큰 허용 프로시저), `apps/web` 의 로컬 모드 분기.
기능이 바뀌면 이 문서도 함께 고쳐야 한다.

### 레지스트리 게시 (2026-08-29)

**패키지 형태로 확인한 것.** `pnpm pack` 으로 만든 tarball 을 별도의 소비처 프로젝트에 설치해 돌렸다.

- tarball 에 **원본 TypeScript 와 웹 번들이 함께 들어가는 것** — `@erdd/cli` 127개 파일(그중
  `web/` 101개, `*.test.ts` 0개), `@erdd/core` 39개 파일. `workspace:^` 가 실제 버전(`^0.1.0`)으로
  치환되는 것, `engines.node` 가 `>=22` 로 들어가는 것.
- 설치본에서 `erdd --help`·`erdd init --local`·`erdd validate` 가 정상 동작하는 것(종료 코드 `0`).
- 설치본에서 `erdd serve` 가 뜨고 **`/p/<id>` 가 200 + HTML**, `/assets/index-*.js` 가 200 +
  1,162,100 바이트, `/trpc/model.get` 이 200 인 것 — **웹을 따로 빌드하지 않은 프로젝트에서다.**
- **저장소 배치에서는 방금 빌드한 `apps/web/dist` 가 이기는 것** — 두 후보에 서로 다른 표식 파일을
  두고 갈랐다. 저장소 배치의 `/p/<id>` 도 200 이다.
- **`tsx` 는 소비처가 직접 선언해야 하는 것**(2.1) — 문서가 안내하는 경로(pnpm + `tsx` 선언)는
  깨끗한 캐시 + 오프라인에서도 종료 코드 `0` 이다. `tsx` 를 `@erdd/cli` 의 `dependencies` 에 넣어
  대신 해결하려던 시도는 **pnpm 소비처를 오히려 회귀시켜**(되던 것이 `127` 로) 되돌렸다.
- **웹 번들 없이 팩하면 `prepack` 가드가 종료 코드 `1` 로 막는 것**(`pnpm pack`·`npm pack` 양쪽).

**공개 npm 에서 설치해 확인한 것.** 위 항목(`pnpm pack` 한 tarball)과 달리 npm 에 게시된 판
(`@erdd/cli@0.4.0`·`@erdd/core@0.3.0`)을 빈 디렉터리에 2.2 의 절차 그대로 `pnpm add -D @erdd/cli tsx`
(pnpm 10.33.0)로 깔았다. 레지스트리 설정·토큰 없이 받아진다.

- `pnpm exec erdd --help` 가 명령 목록을 낸다(본문 [2.5](#25-실행-확인)).
- `erdd init --local` 이 `로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요` 를 내고 종료 코드 `0`.
- `erdd validate` 가 `정합성 문제 없음`·`명명 경고 없음` 을 내고 종료 코드 `0`.
- `erdd serve --port 4391 --no-open` 이 아래 두 줄을 내고, `/` 가 `/p/00000000-0000-7000-8000-000000000000`
  으로 **302**, 그 주소가 **200 + HTML**(`<!doctype html>`·`<html lang="ko">`)이다 — 웹을 빌드하지 않은
  프로젝트에서 설치본에 동봉된 웹 번들이 서빙된다.

  ```
  http://127.0.0.1:4391 에서 실행 중 (프로젝트: …)
  중지하려면 Ctrl+C
  ```

**확인하지 않은 조합** — npm 으로 설치(`npm install -D @erdd/cli tsx` + `npx erdd`), 전역 설치,
설치 없이 `npx @erdd/cli`, Windows.

### 공용 사전·서버 프로젝트 생성 — 실서버

**실제 서버에 붙여 확인한 것.** 이 저장소의 서버를 격리 DB 로 띄우고, 조직·조직 라이브러리(도메인 1·단어 2·
용어 1)·관리자 토큰·편집자 토큰을 tRPC 로 만든 뒤, 저장소 밖 스크래치 디렉터리에서 CLI 를 돌렸다
(`npx tsx <ERDD>/packages/cli/src/main.ts …`). 본문 3.2·6.1·6.2·6.11·6.12·10.1 의 출력 인용은 그 실물이다.

- `init --create` 의 두 안내(빈 디렉터리 / 이관), 빈 디렉터리에서 빈 사전 파일 다섯이 생기는 것, 편집자
  토큰의 생성 권한 안내, 이미 연결된 config 의 거절.
- `dict list` 의 구독 표시·쓰기 가능 표시, `dict pull` 의 첫 수신·재실행(아무 파일도 쓰지 않음)·
  `--dry-run`, 구독이 config 에 남고 `push`·`pull` 뒤에도 유지되는 것.
- 사전 파일에 id 없이 적은 단어가 `push` 로 id 를 받고, 라이브러리에서 받은 항목과 출처가 `push` 로 서버에
  올라가 다른 사용자의 `pull` 에서 `origins.yaml` 로 내려오는 것.
- 편집자 토큰의 `dict push` 가 승격 요청이 되고, 웹 승인(`promotion.resolve`) 뒤 편집자의 `pull` 이
  승격 항목의 출처를 `origins.yaml` 에 쓰는 것, `dict requests` 의 대기·승인·처리 메모.
- `library list`·`export`·`import`(`--library`·`--create`·`--dry-run`·`--yes`·확인 프롬프트·`--prune`·
  `--include-stale`), 내보낸 파일을 그대로 다시 가져오면 전부 「그대로」인 것, 서버에서 항목을 고쳐
  「오래된 파일」로 잡히는 것, `dict pull --file`(첫 수신·재실행·다른 라이브러리 거절·원천 파일 거절)과
  연결된 프로젝트에서 파일 구독을 `dict push` 하면 거절되는 것.
- 관리자 토큰의 `dict push` 가 바로 승격하고 암묵적 pull 로 `origins.yaml` 을 갱신하는 것, 그 전제 두 가지
  (로컬 변경 있음 / 서버가 앞서 나감)의 거절.
- 이관 — `init --local` → 단어 추가 → `init --create` → `diff` 가 전부 「추가」 → `push`. 이어서 `dict pull`
  의 이름 중복 건너뜀 → `--adopt` 연결, 라이브러리 수정 뒤의 자동 갱신·충돌 보류·`--conflicts theirs`,
  `dict pull --json` 봉투.
- 기준선 없이 연결된 디렉터리(`erdd/` 에 파일 있음)의 `pull` 이 대화형이면 묻고, `--json` 이면
  `CANCELLED` 로 멈추고, `--yes` 면 받는 것.
- 편집자의 전역 라이브러리 `dict push` 가 서버를 부르기 전에 거절되는 것.
- **라이브러리 원본이 앞선 항목의 제외** — 받아 온 뒤 라이브러리에서 두 단어를 고친 상태에서 `dict push` 가
  두 항목을 제외 안내와 함께 빼고 새 단어만 올리며, DB 의 라이브러리 값·버전이 그대로인 것. `--name` 으로
  지정해도 `selected: 0`·`behind` 로 빠지는 것. `dict pull`(자동 갱신 / `--conflicts ours`) 뒤에는 로컬에서
  고친 값이 원본 갱신으로 올라가는 것. 같은 상태에서 제외 동작이 없는 CLI 는 라이브러리 값을 옛 값으로
  되돌리는 것(대조군).

**확인하지 않은 것.** 옛 서버에 새 CLI 를 붙였을 때의 「서버가 이 기능을 지원하지 않습니다」(`dict`·
`init --create` 모두 단위 테스트로만 확인), `erdd serve` 화면에서의 사전 편집(파일 직접 편집으로 대신했다),
`init --create` 의 대화형 조직 선택. 다음 출력 인용은 실서버가 아니라 **단위 테스트의 기대값**에서 옮겼다 —
`dict pull` 의 `내용이 달라 연결하지 않음` 줄과 `adoptDiffers`, `dict push` 의 `(도메인 연결 비움 — …)` 행과
`danglingDomain`, push·diff 의 출처 중복(`duplicate-origin`) 충돌 보고, `dict pull`·`dict push` 의 미저장 편집 알림.
