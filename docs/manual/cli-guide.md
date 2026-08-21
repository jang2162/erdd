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
| 파일은 **스키마의 의미 정보만** 담는다 | 배치 좌표·메모·공용 리소스 출처는 파일에 없다(→ [8절](#8-파일에-담기지-않는-것)). |
| 모든 명령은 **현재 디렉터리 기준**이다 | `erdd.config.yaml` 이 있는 프로젝트 루트에서 실행한다. |

**실행 형태가 둘이다 — 위 전제 중 앞의 둘은 「서버에 연결된 프로젝트」 기준이다.** `erdd serve` 로 여는
**로컬 모드**에는 서버도 계정도 DB 도 없고 `erdd/` 파일 자체가 진실 원천이며, 배치 좌표·메모까지
`erdd/layout.yaml` 에 담긴다. 브라우저에는 같은 웹 에디터가 뜬다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)).
**로컬 모드로만 쓸 생각이라면 이 문서 대신 [로컬 모드 매뉴얼](local-guide.md) 하나로 끝난다.**

**MCP 서버는 제공하지 않는다.** 에이전트 연동은 이 CLI + 동봉 스킬 문서 조합이다(→ [9절](#9-ai-에이전트와-함께-쓰기)).

---

## 2. 설치와 실행

### 2.1 요구 사항

| 항목 | 값 | 근거 |
|---|---|---|
| Node.js | 22 | `.nvmrc` |
| 패키지 | `@erdd/cli`(바이너리 `erdd`) | `packages/cli/package.json` |
| 실행기 | `tsx` | 소스를 빌드 없이 실행한다(`#!/usr/bin/env -S npx tsx`) |

⚠️ **`@erdd/cli` 는 아직 npm 레지스트리에 공개되지 않았다**(`"private": true`). `npm i -g @erdd/cli`
는 동작하지 않는다. 아래 두 방법 중 하나로 ERDD 저장소 체크아웃에서 실행한다.

### 2.2 방법 A: 저장소에서 직접 실행 (설치 없음)

가장 단순하다. **작업할 프로젝트 디렉터리에서** ERDD 체크아웃의 진입점을 가리켜 실행한다.

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

### 2.3 방법 B: 프로젝트에 의존성으로 링크

`node_modules/.bin/erdd` 가 생겨 `pnpm exec erdd …` 로 부를 수 있다. **`tsx` 를 함께 넣어야 한다.**

```bash
cd /path/to/my-project
pnpm add -D /path/to/ERDD/packages/cli tsx
pnpm exec erdd --help
```

⚠️ **`tsx` 를 빼면 실행 자체가 안 된다.** 패키지 관리자가 만드는 bin 셸 심(shim)은 shebang 의
`npx tsx` 를 `tsx` 로 풀어 실행하므로, 프로젝트에 `tsx` 가 없으면 이렇게 끝난다.

```
sh: tsx: command not found
# 종료 코드 127 — CLI 가 아니라 셸이 낸 오류다
```

⚠️ **이 설치는 ERDD 저장소의 원본 파일 권한을 바꾼다.** 패키지 관리자가 bin 진입점에 실행 비트를
붙이므로, 설치 뒤 ERDD 체크아웃에서 `git status` 를 보면 `packages/cli/src/main.ts` 가
`old mode 100644 / new mode 100755` 로 뜬다. 커밋하지 말고 `chmod 644 packages/cli/src/main.ts` 로
되돌린다. 이 부작용이 싫으면 [방법 A](#22-방법-a-저장소에서-직접-실행-설치-없음) 를 쓴다.

### 2.4 실행 확인

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
  serve        로컬 서버를 띄워 브라우저에서 편집한다(서버 연결 불필요)
  skill install 에이전트 스킬 문서를 프로젝트에 설치한다

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate·diff에서 경고·충돌도 실패로 본다
  -m, --message <요약>  push의 Revision 요약
  --dir <경로>          skill install 전용 — 설치 위치
  --force               skill install 전용 — 기존 파일 덮어쓰기
  --server <url>        init 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
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

**토큰으로 호출할 수 있는 서버 기능은 명시적으로 열린 6개뿐이다** — `auth.me`, `org.list`,
`project.list`, `project.get`, `model.get`, `model.push`. 웹 UI 의 나머지 기능(내보내기·스냅샷·멤버
관리 등)은 세션 전용이라 토큰으로 부를 수 없다.

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

⚠️ **`erdd serve` 는 미리 빌드된 웹 번들(`apps/web/dist`)을 내보낸다.** 없으면 서버는 평소처럼 뜨는데
브라우저에 에디터 대신 JSON 404 가 나온다. ERDD 체크아웃에서 `pnpm -C apps/web build` 를 한 번
돌려 둔다(→ [로컬 모드 매뉴얼 2.2](local-guide.md#22-웹-번들을-한-번-빌드한다--빠뜨리면-화면이-뜨지-않는다)).

**편집이 곧 파일이다.** 화면에서 바꾼 것은 잠깐의 디바운스 뒤 `erdd/` 에 쓰이고, 터미널·에이전트·
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
- ⚠️ **로컬로 시작한 프로젝트를 서버로 옮기는 전용 명령은 없고, 연결 설정을 적는 것만으로는 부족하다.**
  `push` 는 마지막 pull 기준선(`.erdd/base.json`)을 요구하므로 `기준 시점이 없습니다. 먼저 erdd
  pull을 실행하세요` 로 멈춘다. 커밋해 둔 `erdd/` 를 git 에서 되살려 얹는 순서가 필요하다 —
  [로컬 모드 매뉴얼 7.2](local-guide.md#72-로컬로-시작한-프로젝트를-서버로-옮기기) 에 명령 순서가 있다.

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
- **로컬 모드에는 이 왕복 자체가 없다.** 편집이 곧 파일이고 커밋이 곧 이력이다 — `pull`·`diff`·`push` 대신 `erdd serve` 를 띄워 두고 편집한 뒤 `git commit` 한다(→ [3.4](#34-로컬-모드--서버-없이-쓰기)).

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
└─ layout.yaml              # 배치 좌표·메모 — 로컬 모드만 읽고 쓴다(→ 5.7)
.erdd/                                                            ← 커밋하지 않는다
├─ base.json                # 마지막 pull 시점 모델 — 3-way 병합의 기준선
├─ sync.json                # { "revisionSeq": 42, "pulledAt": "…" }
├─ credentials.json         # { "token": "erdd_pat_…" }, 권한 0600
└─ snapshots.json           # 로컬 모드의 스냅샷(모델 전체 사본)
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
```

**`serverUrl`·`projectId` 는 선택 값이다.** 둘 다 없으면(또는 `null` 이면) **로컬 전용 프로젝트**이고
`erdd serve` 로 연다 — 서버가 필요한 `pull`·`push`·`diff` 만 그때 종료 코드 `1` 로 멈춘다
(→ [3.4](#34-로컬-모드--서버-없이-쓰기)). ⚠️ **둘 중 하나만 적힌 것은 오타로 보고 거절한다** —
삼키면 서버에 붙은 줄 알고 편집하다 `push` 할 때가 되어서야 연결이 없다는 것을 알게 된다.
`dialects`·`namingRules` 의 형태가 어긋나도 종료 코드 `1` 이다.

**방언과 명명 규칙은 `pull` 이 매번 서버 값으로 덮어쓴다.** 모델이 아니라 프로젝트 설정에 있는
값인데, `validate` 가 서버 없이 명명 경고를 내려면 로컬에 사본이 있어야 하기 때문이다. 웹에서 이
설정을 바꾸면 **다음 `pull` 전까지 로컬 `validate` 결과가 서버와 다를 수 있다.**

### 5.3 테이블 파일

```yaml
id: 018f6b0e-…                             # 서버 발급 UUIDv7 — 고치거나 지우지 않는다
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

- **서버가 발급한 `id`(UUIDv7)는 identity 다.** 고치거나 지우지 않는다. 이름이 바뀌어도 `id` 가
  같으면 "삭제 + 추가"가 아니라 "수정"으로 인식된다.
- **새로 만드는 객체는 `id` 를 아예 쓰지 않는다.** `push` 가 발급해 파일에 채워 넣는다.
- ⚠️ **파일을 복사해 새 테이블을 만들 때는 `id` 를 전부 지운다** — 테이블뿐 아니라 컬럼·인덱스·관계의
  `id` 도 함께. 남겨 두면 "새 테이블 생성"이 아니라 **"원본을 복사본 내용으로 덮어쓰기"** 가 된다.
  같은 `id` 가 두 번 나오면 계획 단계에서 막힌다.

  ```
  id 018f…가 erdd/tables/MBR.yaml에도 있습니다 — 복사해서 새로 만든 것이라면 id를 지우세요(그대로 두면 원본을 덮어씁니다)
  ```

- ⚠️ **YAML anchor/alias(`&이름` … `*이름`)는 지원하지 않는다.** 두 항목이 조용히 한 항목으로
  합쳐지기 때문에 오류로 막는다. 별칭을 풀어 항목마다 내용을 그대로 적는다.

### 5.7 `erdd/layout.yaml` — 배치 좌표와 메모

**로컬 모드만 읽고 쓴다.** `pull`·`push` 는 이 파일을 보내지도 받지도 않는다(→ [8절](#8-파일에-담기지-않는-것)).
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
| 전용 옵션 | `--server <url>` · `--token <token>` · `--project <id>` · `--local` |
| 서버 호출 | `auth.me`, (선택 시) `org.list`·`project.list`, `project.get` |
| 쓰는 파일 | `erdd.config.yaml` · `.erdd/credentials.json` · `.gitignore` |

**`--local` 은 서버 연결 없이 로컬 전용 프로젝트를 만든다** → [3.4](#34-로컬-모드--서버-없이-쓰기).
서버를 한 번도 부르지 않고 `.erdd/credentials.json` 도 쓰지 않는다(`erdd.config.yaml` 과 `.gitignore`
뿐이다). 다른 인자와 달리 **기존 config 를 `--yes` 로도 덮어쓰지 않는다.**

### 6.2 `erdd pull`

서버 스키마를 파일로 내려받는다. **로컬 변경을 덮어쓴다.**

```bash
$ erdd pull
커머스: 테이블 24개를 받았습니다 (리비전 42)
```

로컬에 변경이 있으면 먼저 목록을 보이고 확인을 받는다(최초 `pull` 은 기준선이 없어 묻지 않는다).

```
로컬 변경 2건이 덮어쓰기 됩니다:
  erdd/tables/MBR.yaml
  erdd/words.yaml
계속할까요? [y/N]
```

거절하면 `사용자가 취소했습니다` 와 함께 종료 코드 `1`. `--yes` 로 건너뛴다.

**서버에서 사라진 테이블의 파일은 지워진다.** `erdd/tables/*.yaml` 중 서버에 없는 것과, 최상위 5개
파일 중 서버가 내려주지 않은 것이 삭제 대상이다.

⚠️ **`pull` 중간에 중단(Ctrl+C 등)하면 기준선이 트리보다 낡은 채 남는다.** 다음 `status` 가 손대지
않은 파일을 "로컬 변경"으로 오탐할 수 있다. `erdd pull --yes` 를 한 번 더 돌리면 수렴한다.

`--json` 은 `{ revisionSeq, written, deleted, tables, warnings }` 를 낸다.

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
| 웹 번들 | **미리 빌드된 `apps/web/dist` 를 내보낸다.** 없으면 서버는 뜨는데 브라우저에 JSON 404 만 나온다 — `pnpm -C apps/web build` (→ [로컬 모드 매뉴얼 2.2](local-guide.md#22-웹-번들을-한-번-빌드한다--빠뜨리면-화면이-뜨지-않는다)) |
| 서버 호출 | 없다. `erdd.config.yaml` 과 `erdd/` 파일만 읽고 쓴다 |
| 쓰는 파일 | `erdd/**`(편집 반영) · `erdd/layout.yaml` · `.erdd/snapshots.json` · `erdd.config.yaml`(설정 저장 시) |

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
- **`Ctrl+C`(SIGINT·SIGTERM)로 끝낸다.** 종료 전에 디바운스 대기 중인 쓰기를 파일에 flush 하므로
  방금 옮긴 좌표·방금 만든 메모가 남는다.
- 브라우저를 못 열면(`--no-open` 이 아닌데 실행기가 없을 때) `브라우저를 열지 못했습니다. 직접 … 을
  여세요` 만 남기고 서버는 계속 돈다.

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

**해결 절차.**

1. `erdd pull` 로 서버 변경을 받는다(로컬 변경이 덮어쓰이므로, 살릴 내용은 미리 복사해 둔다).
2. 파일에서 원하는 값으로 정리한다.
3. `erdd diff` 로 확인하고 `erdd push`.

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

| 담기지 않는 것 | 어디서 다루나 |
|---|---|
| 테이블 배치 좌표(캔버스 위치, 그룹 뷰 좌표) | 웹 에디터. 로컬 모드에서는 **`erdd/layout.yaml`**(→ [5.7](#57-erddlayoutyaml--배치-좌표와-메모)) |
| 메모(note) | 위와 같다 |
| 도메인·단어·용어·커스텀 항목의 **공용 리소스 출처(origin)** | 웹의 공용 리소스 화면(로컬 모드에는 공용 리소스가 없어 항상 비어 있다) |

⚠️ **`erdd/layout.yaml` 도 서버와 오가지 않는다.** 로컬 모드에서 옮긴 좌표는 `push` 해도 서버에
반영되지 않고, `pull` 이 그 파일을 덮어쓰지도 않는다.

에이전트가 서버에 연결된 프로젝트에서 "좌표를 옮겨 달라"·"메모를 남겨 달라"는 요청을 파일에서
처리하려 하면 안 된다 — 그런 정보는 그 파일들에 없다. 로컬 모드라면 `erdd/layout.yaml` 이 그 자리다.

---

## 9. AI 에이전트와 함께 쓰기

### 9.1 스킬 설치

```bash
erdd skill install                 # .claude/skills/erdd/SKILL.md
erdd skill install --dir .agent/skills/erdd --force
```

설치되는 문서는 에이전트에게 다음을 지시한다.

- **스키마를 알아야 하면 마이그레이션·ORM 코드를 뒤지지 말고 `erdd/` 파일을 읽는다.**
- 수정 워크플로: `pull` → 편집 → `validate` → `diff` → `push`.
- **물리명을 임의로 만들지 않는다** — ① `terms.yaml` 에서 논리명이 같은 용어의 물리명을 그대로
  쓰고 ② 없으면 `words.yaml` 의 단어를 조합하며(회원 `MBR` + 번호 `NO` → `MBR_NO`) ③ 조합에 필요한
  단어가 사전에 없으면 `words.yaml` 에 함께 등록한다.
- 컬럼 타입은 가능하면 `domain` 으로 지정한다(방언별 타입·기본값·허용값이 따라온다).
- `custom-fields.yaml` 에 `required: true` 인 항목이 있으면 대상의 `custom` 에 값을 채운다.
- **하지 말 것** — 기존 `id` 수정·삭제, 복사한 파일에서 `id` 를 안 지우기, 테이블 파일 이름 직접
  변경, `.erdd/` 편집, 좌표·메모를 파일에서 찾기.

### 9.2 에이전트에게 쥐여 줄 때의 요령

- **토큰은 `ERDD_TOKEN` 으로 준다.** 파일에 두면 에이전트가 읽어 로그에 흘릴 수 있다.
- **비대화형에서는 `--json --yes` 를 함께 준다.** `--json` 만 주면 삭제가 포함된 push 가 확인
  프롬프트를 만들 수 없어 멈춘다.
- **`validate` 를 push 전에 반드시 돌리게 한다.** 서버를 부르지 않으므로 비용이 없고, 명명 규칙
  위반을 사전에 잡는다.
- 권한은 토큰 발급자의 역할을 그대로 따른다 — 에이전트에게 읽기만 시키려면 **Viewer 계정으로 발급한
  토큰**을 준다.

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
| `NOT_FOUND` | 조직·프로젝트를 찾지 못했다 | `1` |
| `VALIDATION` | 파일·입력이 잘못됐다 | `1` |
| `CONFLICT` | 서버가 앞서 나갔다(재시도 후에도) | `1` |
| `CANCELLED` | 사용자가 취소했거나 확인이 필요하다 | `1` |
| `NETWORK` | 연결·응답 해석 실패, 그 밖의 오류 | `1` |

⚠️ **에이전트·스크립트가 재시도를 판단할 때 `code` 로 분기한다면**, `NETWORK` 만 재시도 대상으로
삼는다. `VALIDATION`·`FORBIDDEN` 은 같은 명령을 다시 돌려도 영원히 실패한다.

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
| `sh: tsx: command not found` (종료 코드 127) | 프로젝트에 `tsx` 가 없다 | `pnpm add -D tsx` (→ [2.3](#23-방법-b-프로젝트에-의존성으로-링크)) |
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
| `erdd serve` 는 떴는데 브라우저에 `{"message":"Route GET:/p/… not found"…}` 만 나온다 | 웹 번들(`apps/web/dist`)이 없다 | ERDD 체크아웃에서 `pnpm -C apps/web build` |
| `포트 4300이 이미 사용 중입니다 …` | 다른 `erdd serve` 나 다른 프로그램이 그 포트를 물고 있다 | `--port` 로 다른 포트를 준다 |
| 브라우저 상단에 「파일을 읽을 수 없어 편집이 잠겼습니다」 배너가 뜨고 편집이 안 된다 | `erdd/` 안의 YAML 이 깨졌다 | 배너가 가리키는 파일을 고친다. 고치면 자동으로 풀린다 |
| 로컬 모드에서 테이블이 격자로 나란히 놓여 있다 | `erdd/layout.yaml` 이 없거나 그 테이블 항목이 없다 | 정상이다. 옮기거나 「자동 정렬」을 하면 좌표가 그 파일에 저장된다 |

---

## 부록: 검증 상태 (2026-08-14)

**두 시점의 검증이 함께 담겨 있다** — 서버 연결 워크플로는 2026-08-14, 로컬 모드는 2026-08-20 이다.

**실제 명령으로 확인한 것.** 격리된 임시 프로젝트를 만들어 `@erdd/cli` 를 파일 의존성으로 설치한 뒤
돌렸다.

- `pnpm add <경로>/packages/cli` 로 `node_modules/.bin/erdd` 링크가 생기는 것, **`tsx` 없이는
  `sh: tsx: command not found`(종료 코드 127)로 죽고 `pnpm add -D tsx` 후 정상 동작**하는 것.
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
있고 「이력」이 없는 것, 스냅샷 생성·복원과 `.erdd/snapshots.json`, 터미널에서 파일을 고치면
**새로고침 없이** 화면이 바뀌는 것, 파일을 깨뜨리면 배너 + 「읽기 전용」으로 바뀌고 되돌리면 풀리는
것, `Ctrl+C` 후 다시 `serve` 해도 좌표·메모가 남는 것.

**기준** — `packages/cli`(`main.ts`, `commands/*`, `local/*`, `plan.ts`, `tree.ts`, `client.ts`,
`config.ts`, `output.ts`), `packages/core/src/{file-format,layout,local}.ts`,
`apps/server/src/routers/*`(토큰 허용 프로시저), `apps/web` 의 로컬 모드 분기.
기능이 바뀌면 이 문서도 함께 고쳐야 한다.
