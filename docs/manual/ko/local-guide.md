<!-- source: docs/manual/en/local-guide.md @ v0.6.0 -->

# ERDD 로컬 모드 매뉴얼

**서버도 계정도 데이터베이스도 없이** 저장소 안의 YAML 파일만으로 ERD 를 그리는 방법을 처음부터 끝까지
다룹니다. `erdd serve` 명령 하나가 브라우저에 **서버 모드와 같은 웹 에디터**를 열고, 화면에서 바꾼 것이
`erdd/` 파일이 됩니다. 이력은 서버가 아니라 **git 커밋**이 갖습니다. 혼자 설계하고 스키마를 자기 저장소에
두는 사람을 위한 문서입니다.

**이 문서 하나면 됩니다.** 서버 설치·운영([install.md](install.md))은 읽지 않아도 됩니다. 화면마다의 세부는
[사용 매뉴얼](user-guide.md)을, 명령마다의 레퍼런스는 [CLI 매뉴얼](cli-guide.md)을 필요할 때만 여세요.

**목차** — [1. 이 문서를 읽는 사람](#1-이-문서를-읽는-사람) · [2. 준비](#2-준비) · [3. 시작하기](#3-시작하기) · [4. 브라우저에서 되는 것과 없는 것](#4-브라우저에서-되는-것과-없는-것) · [5. 파일과 git](#5-파일과-git) · [6. 스냅샷](#6-스냅샷) · [7. 서버와 오가기](#7-서버와-오가기) · [8. 문제 해결](#8-문제-해결) · [부록: 검증 상태](#부록-검증-상태)

---

## 1. 이 문서를 읽는 사람

**로컬 모드가 맞는 경우** — 혼자 설계합니다. 붙을 ERDD 서버가 없거나 서버를 세우고 싶지 않습니다. 스키마를
코드 저장소 안에 두고 git 으로 관리하고 싶습니다. 팀과는 PR 로 공유하면 충분합니다.

**서버 모드가 필요한 경우** — 여러 사람이 같은 프로젝트를 **동시에** 편집합니다. 계정·권한·조직이
필요합니다. 누가 언제 무엇을 바꿨는지 서버가 기록해야 합니다. 여러 프로젝트가 조직 공용 리소스(표준
도메인·단어)를 함께 씁니다. → [install.md](install.md)

| | **로컬 모드** | 서버 모드 |
|---|---|---|
| 진실 원천 | `erdd/` 파일 | 서버 DB |
| 여는 방법 | `erdd serve` | 서버를 설치하고 띄움 |
| 필요한 것 | Node 22 + `@erdd/cli`(npm 에서 설치) | 거기에 더해 PostgreSQL, 배포, 계정 |
| 계정·로그인 | **없음.** 에디터가 바로 열림 | 있음 |
| 편집 이력 | **git 커밋** | 서버 리비전(+ git) |
| 파일에 쓰기 | **저장(`Cmd+S`)을 눌러야 함** | 즉시(서버 DB) |
| 동시 편집 | 없음. 한 사람을 가정 | 실시간 |
| 배치 좌표·메모 | `erdd/layout.yaml`(커밋함) | 서버 DB. 다만 프로젝트를 `erdd serve` 로 옮겨 열면 그 좌표와 메모는 `erdd/layout.yaml` 에 쌓임(→ [7.1](#71-서버-프로젝트를-로컬-에디터로-열기)) |
| 스냅샷 | `erdd/snapshots/`(**커밋하므로** git 이력에 남음) | 서버 DB |
| 조직 공용 리소스(표준 단어·용어·도메인) | 화면 없음. `erdd dict pull --file` 로 받음(서버 연결 없이) | 웹의 **공용 리소스**. 서버에 연결된 프로젝트는 `erdd dict` 로 로컬 파일에 받고 올릴 수도 있음(→ [7.3](#73-공용-사전을-받아-쓰기--erdd-dict)) |

**둘은 배타적이지 않습니다.** 서버에 연결된 프로젝트를 `erdd serve` 로 열어 시각적으로 다듬을 수 있고,
로컬에서 시작한 프로젝트를 나중에 서버로 옮길 수 있습니다(`erdd init --create` 명령 하나)
→ [7절](#7-서버와-오가기).

---

## 2. 준비

### 2.1 필요한 것 — 준비 경로가 둘이다

**어느 쪽이든 결과는 같습니다.** `erdd serve` 로 여는 에디터와 그것이 만드는 파일은 다르지 않습니다.
다른 것은 **미리 갖춰 둬야 하는 것**뿐입니다.

| | **[경로 A: npm 에서 설치](#22-경로-a-npm-에서-설치한다-권장)** | [경로 B: 저장소 체크아웃](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다) |
|---|---|---|
| 언제 | **보통은 이쪽** | npm 에 닿을 수 없거나(오프라인) ERDD 자체를 고치는 중일 때 |
| Node.js | **22 이상**(패키지의 `engines` 가 강제) | **22 이상**(ERDD 저장소의 `mise.toml` 도 `22`) |
| ERDD 저장소 체크아웃 | **필요 없음** | 필요 |
| `tsx` | 필요(`pnpm add -D tsx`). **`@erdd/cli` 가 대신 끌어오지 않음** | 필요 |
| **웹 번들** | **필요 없음. 패키지에 들어 있음** | **직접 빌드** → [2.3](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다) |

DB 도 Docker 도 계정도 필요 없습니다. 둘 다 그렇습니다.

### 2.2 경로 A: npm 에서 설치한다 (권장)

스키마를 둘 **내 프로젝트** 안에서 명령 하나면 됩니다. 패키지가 **공개 npm** 에 있으므로 레지스트리 설정도
토큰도 필요 없습니다.

```bash
pnpm add -D @erdd/cli tsx
# with npm
npm install -D @erdd/cli tsx
```

- ⚠️ **`tsx` 를 빼지 마세요.** 패키지에는 빌드 결과물이 아니라 원본 TypeScript 가 들어 있고,
  **`@erdd/cli` 는 `tsx` 를 대신 끌어오지 않습니다.** 패키지 매니저가 무엇이든 내 프로젝트에 직접 선언해야
  합니다. 빼면 `npx` 가 그때그때 받아 와 **돌아가는 경우가 많지만**, 그것은 네트워크와 캐시에 달려 있어
  패키지 매니저마다 증상이 다릅니다([8절](#8-문제-해결) 표). 명시적인 선언만이 보장된 길입니다
  (→ [CLI 매뉴얼 2.1](cli-guide.md#21-요구-사항)).
- **웹 번들을 빌드할 필요가 없습니다.** 에디터가 패키지 안에 통째로 들어 있으므로
  [2.3](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)은 이 경로에 해당하지 않습니다. 설치본은
  저장소 배치를 가질 수 없으므로 늘 동봉본을 씁니다.
- **이 매뉴얼도 설치본 안에 있습니다.** 매뉴얼 네 편이 언어별로 `node_modules/@erdd/cli/docs/en/`(영어)과
  `node_modules/@erdd/cli/docs/ko/`(한국어)에 패키지 루트의 `README.md` 와 함께 들어 있습니다. 이 문서는
  그중 `docs/ko/local-guide.md` 이고, 문서끼리의 상대 링크도 그대로 동작합니다. ERDD 저장소를 클론하지
  않아도 읽을 수 있습니다.

### 2.3 경로 B: ERDD 저장소 체크아웃 — 웹 번들을 한 번 빌드한다

⚠️ **이 절은 저장소 체크아웃을 쓸 때만 해당합니다.** npm 에서 설치했으면
([2.2](#22-경로-a-npm-에서-설치한다-권장)) 번들이 이미 패키지에 있으므로 건너뛰세요.

`erdd serve` 는 **미리 빌드한 웹 번들을 정적 파일로 서빙합니다.** 갓 클론한 저장소에는 그 번들이 없으므로
한 번 빌드하세요.

```bash
cd /path/to/ERDD
pnpm install
pnpm -C apps/web build      # creates apps/web/dist
```

⚠️ **건너뛰었을 때의 증상이 「서버가 안 뜬다」가 아니라 「화면만 안 나온다」여서 원인을 찾기 어렵습니다.**
`erdd serve` 는 같은 터미널 출력으로 평소처럼 뜨지만, 브라우저에는 에디터 대신 JSON 이 보입니다.

```json
{"message":"Route GET:/p/00000000-0000-7000-8000-000000000000 not found","error":"Not Found","statusCode":404}
```

ERDD 저장소를 `git pull` 로 갱신했으면 번들도 다시 빌드하세요. 그러지 않으면 옛 번들이 그대로 서빙됩니다.

**저장소에서는 가장 최근에 빌드한 `apps/web/dist` 가 늘 이깁니다.** 릴리스를 준비하려고 `packages/cli/web` 에
사본(`bundle:web`)을 만든 적이 있어도 `erdd serve` 는 최신 빌드를 계속 봅니다. 화면이 바뀌지 않는다고 그
사본을 의심할 필요는 없습니다.

### 2.4 `erdd` 를 부를 수 있게 한다

**npm 에서 설치했으면**([2.2](#22-경로-a-npm-에서-설치한다-권장)) 이미 된 것입니다. `pnpm exec erdd …`
(npm 이면 `npx erdd …`)로 부르세요. 이 절의 나머지는 **저장소 체크아웃**
([2.3](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다))을 쓸 때의 이야기입니다.

**가장 단순한 방법** — 셸 별칭을 더하세요.

```bash
# ~/.zshrc or similar
alias erdd='npx tsx /path/to/ERDD/packages/cli/src/main.ts'
```

체크아웃을 파일 의존성으로 내 프로젝트에 링크할 수도 있습니다(`pnpm exec erdd …`). 그 방식의 주의점(`tsx`
도 함께 더해야 하고, ERDD 체크아웃의 파일 권한이 바뀝니다)은
[CLI 매뉴얼 2.4](cli-guide.md#24-방법-c-프로젝트에-의존성으로-링크)에 있습니다.

⚠️ **명령은 늘 「현재 디렉터리」를 프로젝트로 봅니다.** CLI 는 `erdd.config.yaml`, `erdd/`, `.erdd/` 를 모두
`process.cwd()` 에서 찾습니다. ERDD 저장소 안에서 실행하면 엉뚱한 곳을 봅니다. 스키마를 둘 **내 프로젝트
디렉터리**에서 실행하세요.

**이 문서는 여기서부터 명령을 `erdd …` 로 적습니다.** npm 에서 설치했으면 `pnpm exec erdd …`(npm 이면
`npx erdd …`)로 읽으세요. 옵션과 출력은 같습니다.

---

## 3. 시작하기

### 3.1 `erdd init --local` — 프로젝트를 만든다

```bash
$ cd /path/to/my-project
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
```

**정확히 두 가지가 만들어집니다.**

| 파일 | 내용 |
|---|---|
| `erdd.config.yaml` | 방언, 명명 규칙, 테이블 옵션. `serverUrl` 과 `projectId` 는 `null` |
| `.gitignore` | `.erdd/` 한 줄이 더해짐(이미 있으면 그대로 둠) |

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
tableOptions:
  postgresql: ""
  mysql: ""
  oracle: ""
  mssql: ""
```

이 시점에는 토큰도, 서버 왕복도, `erdd/` 디렉터리도 없습니다(→ [3.3](#33-첫-저장이-erdd-를-만든다)).

**방언과 대소문자 규칙은 여기서 고르세요.** 기본값은 위의 `postgresql` · `UPPER_SNAKE` 입니다.

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

**나머지 명명 규칙에는 옵션이 없습니다.** `separator`, `logicalSeparator`, `maxLengthBytes`, 이름 템플릿은
`erdd.config.yaml` 을 직접 고쳐 바꾸세요(형식은 [CLI 매뉴얼 5.2](cli-guide.md#52-erddconfigyaml)).
잘못된 값은 사용법 오류(`2`)로 멈춥니다:
`--case 값이 올바르지 않습니다: Camel — UPPER_SNAKE | lower_snake`.

⚠️ **이 둘은 `--local` 전용입니다.** 서버에 연결하는 `erdd init` 에 주면 사용법 오류(`2`)입니다. 서버
프로젝트의 설정이 진실 원천이라 첫 `pull` 이 곧바로 덮어쓰기 때문입니다.

⚠️ **`--local` 은 `--yes` 를 줘도 덮어쓰지 않습니다.** `erdd.config.yaml` 이 이미 있으면
`erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` 로 멈춥니다(종료 코드 `1`). 되돌아갈 서버
프로젝트가 없으므로, 덮어쓰면 공들여 정한 방언과 명명 규칙을 조용히 잃게 됩니다.

### 3.2 `erdd serve` — 에디터를 연다

```bash
$ erdd serve
http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

기본 브라우저가 자동으로 열립니다(열 수 없으면 `브라우저를 열지 못했습니다. 직접 … 을 여세요` 만 찍히고
서버는 계속 돕니다). 그 주소로 가면 바로 에디터입니다. **로그인 화면은 없습니다.**

| 옵션 | |
|---|---|
| `--port <번호>` | 기본값 `4300`. 포트가 이미 쓰이고 있으면 다음 포트를 자동으로 고르지 않고 **멈춥니다**(종료 코드 `1`) |
| `--no-open` | 브라우저를 자동으로 열지 않습니다 |

`serve` 는 `Ctrl+C` 까지 터미널을 붙잡습니다. **여러 프로젝트를 동시에 열려면** 터미널을 나누고 포트를 각각
다르게 주세요.

```bash
# terminal 1
cd ~/work/shop  && erdd serve --port 4300
# terminal 2
cd ~/work/admin && erdd serve --port 4301
```

**주소는 실행할 때마다 같습니다.** 로컬 전용 프로젝트의 id 는 고정값
(`00000000-0000-7000-8000-000000000000`)이라 북마크해 둘 수 있습니다. `/` 로 가면 그 프로젝트 화면으로
갑니다(서버에 연결된 프로젝트를 열면 그 프로젝트의 id 를 씁니다 → [7.1](#71-서버-프로젝트를-로컬-에디터로-열기)).

⚠️ **`127.0.0.1` 에만 붙고, LAN 에 여는 옵션은 없습니다.** 인증이 없는 서버이기 때문입니다. `Host` 헤더가
`127.0.0.1:<port>` 나 `localhost:<port>` 류가 아니면 응답은 **403** 입니다. 사설 DNS 이름이나 앞에 둔
리버스 프록시로는 닿지 않습니다. 이것은 바인드만으로는 막을 수 없는 **DNS 리바인딩**(악성 페이지가 내
브라우저를 거쳐 이 서버를 읽고 쓰는 것)도 막습니다.

### 3.3 첫 **저장**이 `erdd/` 를 만든다

`init --local` 직후에는 `erdd/` 가 없습니다. 브라우저에서 테이블을 만들어도 아직 생기지 않습니다. **저장
(`Cmd+S`)을 누를 때** 만들어집니다(→ [4.4](#44-편집은-드래프트에-저장이-파일에)). 에디터를 여는 것만으로는
저장소에 파일이 하나도 더해지지 않습니다.

```text
erdd/
├─ tables/MBR.yaml        # one table = one file, file name = physical name
├─ groups.yaml
├─ words.yaml
├─ terms.yaml
├─ domains.yaml
├─ custom-fields.yaml
└─ layout.yaml            # layout coordinates and notes
```

`erdd/` 가 이미 있는 저장소를 클론했다면(팀원의 작업을 받았다면) `erdd serve` 가 그 파일을 읽어 그대로
엽니다. `erdd.config.yaml` 이 함께 커밋돼 있으므로 `init` 을 다시 할 필요가 없습니다.

### 3.4 끝내기

**`Ctrl+C`** 로 멈추세요. 미저장 편집이 있으면 터미널에 이렇게 찍힙니다.

```text
미저장 편집이 있습니다 — 다음 erdd serve 에서 이어집니다
```

**잃어버리지 않습니다.** 미저장 편집은 `.erdd/draft.json` 에 있고, 다음 `serve` 가 그것을 반영한
채로 열립니다(→ [4.4](#44-편집은-드래프트에-저장이-파일에)). 파일에 남기려면 멈추기 전에 저장하세요.

---

## 4. 브라우저에서 되는 것과 없는 것

### 4.1 화면은 둘뿐이다

| 경로 | 화면 | |
|---|---|---|
| `/p/<id>` | ERD 에디터 | 캔버스, 트리, 편집 패널. 서버 모드와 같음 |
| `/p/<id>/settings` | 프로젝트 설정 | 에디터 헤더의 **설정** → [4.3](#43-프로젝트-설정) |

로그인·홈·조직·관리자 화면은 아예 없습니다. 헤더 왼쪽의 로고를 눌러도 홈으로 가지 않고 **에디터로
돌아옵니다.** 로컬 모드에는 갈 홈이 없기 때문입니다.

### 4.2 사용 매뉴얼의 어느 장이 해당하나

에디터는 서버 모드와 **같은 화면**에서 동작하므로 [사용 매뉴얼](user-guide.md)을 그대로 따르면 됩니다. 다만
20개 장 중 6개는 로컬 모드에 전혀 해당하지 않고 2개는 내용이 다릅니다.

| 사용 매뉴얼 | 로컬 모드에서 |
|---|---|
| [1. 계정과 로그인](user-guide.md#1-계정과-로그인) | **없음.** 로그인 화면이 나오지 않음 |
| [2. 화면 지도](user-guide.md#2-화면-지도) | **다름** → [4.1](#41-화면은-둘뿐이다) |
| [3. 조직·프로젝트와 권한](user-guide.md#3-조직프로젝트와-권한) | **없음.** 조직도 멤버도 역할도 없음. 늘 관리 권한을 가짐 |
| [4. 에디터 기본](user-guide.md#4-에디터-기본) | 그대로(실행 취소, 다시 실행, 자동 정렬, 단축키 포함) |
| [5. 테이블과 컬럼](user-guide.md#5-테이블과-컬럼) · [6. 관계](user-guide.md#6-관계) · [7. 인덱스와 메모](user-guide.md#7-인덱스와-메모) | 그대로 |
| [8. 그룹과 그룹 뷰](user-guide.md#8-그룹과-그룹-뷰) · [9. 도메인](user-guide.md#9-도메인) · [10. 명명 체계](user-guide.md#10-명명-체계단어용어-사전) · [11. 커스텀 항목](user-guide.md#11-커스텀-항목) | 그대로(Excel 사전 업로드 포함) |
| [12. 모델 검사](user-guide.md#12-모델-검사) | 모든 경고를 포함해 그대로 |
| [13. 공용 리소스](user-guide.md#13-공용-리소스) | 화면 없음. 라이브러리·승격·승격 요청 화면이 없음. 서버에 연결된 프로젝트면 `erdd dict` 로 주고받음. 연결이 없어도 `erdd dict pull --file` 로 받음(→ [7.3](#73-공용-사전을-받아-쓰기--erdd-dict)) |
| [14. 버전](user-guide.md#14-버전이력스냅샷비교) | **스냅샷**과 **비교**는 그대로. **이력 탭이 없음** → [6절](#6-스냅샷). **변경 기록** 탭은 **로컬 모드에만** 있음 → [5.6](#56-변경-기록--마이그레이션을-쓰기-위한-수정-내역) |
| [15. 내보내기](user-guide.md#15-내보내기) · [16. 가져오기](user-guide.md#16-가져오기) | 그대로(DDL, DBML, 이미지, Excel 정의서) |
| [17. 실시간 동시편집](user-guide.md#17-실시간-동시편집) | **없음.** 참여자 표시도 커서도 없음 |
| [18. 액세스 토큰](user-guide.md#18-액세스-토큰) | **없음.** 부를 서버가 없음 |
| [19. 관리자 업무](user-guide.md#19-관리자-업무) | **없음** |
| [20. 선택과 복사](user-guide.md#20-선택과-복사) | 그대로 |

편집 이력이 없는 것이 손해처럼 보일 수 있지만, 로컬 모드에서는 **git** 이 그 역할을 합니다. 커밋 하나가
리비전 하나이고, `git log`·`git diff`·PR 리뷰가 이력 화면보다 낫습니다.

### 4.3 프로젝트 설정

에디터 헤더의 **설정**을 누르세요.

| 항목 | 로컬 모드에서 |
|---|---|
| 프로젝트 이름 | **로컬 프로젝트로 고정.** `erdd.config.yaml` 에 이름을 둘 자리가 없어 바꿀 수 없음 |
| 명명 규칙 | **여기서 고침.** 저장하면 `erdd.config.yaml` 에 다시 씀 |
| 테이블 옵션 | **여기서 고침.** 방언 네 칸이 그대로 보이고, 저장하면 `erdd.config.yaml` 의 `tableOptions` 에 다시 씀. 화면과 동작은 서버 모드와 같음 |
| 방언(`dialects`) | 화면에 고칠 자리가 없음(서버 모드도 같음. 프로젝트를 만들 때 정함). `erdd.config.yaml` 의 `dialects` 를 직접 고치면 파일 감시가 반영함 |
| 프로젝트 멤버 | 없음 |

### 4.4 편집은 드래프트에, 저장이 파일에

**화면 → 파일은 저장을 거칩니다.** 텍스트 에디터처럼 동작합니다. 편집하는 동안 파일은 그대로이고,
**`Cmd+S`**(또는 헤더의 **저장**)를 누를 때만 `erdd/` 에 써집니다. 커서가 입력란에 있으면 **그 입력란에 친
값을 먼저 반영하고** 저장합니다. 포커스를 옮길 필요가 없고, 저장한 뒤에도 커서가 입력란에 남습니다. 반영하던
편집이 거절되면(오류 토스트가 먼저 나옵니다) **반영되지 않은 편집이 있어 저장하지 않았습니다** 가 나오고
파일에는 아무것도 써지지 않습니다.

| 헤더 | |
|---|---|
| **● 미저장** | 저장할 것이 남아 있음. 편집을 원래대로 되돌리면 저절로 사라짐 |
| **저장** | 파일에 씀. 쓸 것이 없으면 비활성. 저장한 뒤 **입력란에 첫 편집을 치는 동안에도 비활성**(그 값은 포커스가 떠날 때 반영되므로)이니 그때는 `Cmd+S` 를 쓰세요 |
| **⌄ → 변경 버리기** | 내 편집을 버리고 파일 내용으로 돌아감(한 번 확인을 받음) |

**미저장 편집은 잃어버리지 않습니다.** 저장하지 않은 것은 `.erdd/draft.json` 에 자동으로 기록되므로,
브라우저를 닫거나 `Ctrl+C` 로 멈춰도 **다음 `erdd serve` 에서 이어집니다.** 탭을 닫을 때 경고가 나오지 않는
것도 그래서입니다. 잃을 것이 없습니다. **유일한 예외는 입력하던 칸 하나입니다.** 그 값은 포커스가 떠나거나
저장할 때 비로소 편집이 되므로, 그대로 탭을 닫으면 그 칸만 사라집니다.

**왜 이렇게 동작하나** — 버린 시도와 중간 상태가 모두 파일이 되면 `git diff` 가 지저분해집니다. 드래프트는
`.erdd/`(gitignore)에 있으므로 **커밋 후보에 나타나지 않습니다.**

**파일 → 화면** — 터미널, 텍스트 에디터, AI 에이전트, `git pull` 이 `erdd/` 나 `erdd.config.yaml` 을 바꾸면
화면이 **새로 고침 없이** 따라옵니다. 브랜치를 바꿀 때도 같습니다.

```bash
# in another terminal
$EDITOR erdd/tables/MBR.yaml     # the browser changes the moment you save
git checkout feature/orders      # the screen switches to the branch's schema
```

⚠️ **미저장 편집이 있는데 파일이 밖에서 바뀌면** 화면을 자동으로 바꾸지 않습니다. 대신 배너가 묻습니다.

```text
파일이 밖에서 바뀌었습니다. 내 편집을 유지하면 저장할 때 화면의 내용이 파일을 덮어씁니다.
                                            [내 편집 유지]  [파일 다시 읽기]
```

- **내 편집 유지** — 배너를 닫고 계속 편집하게 합니다. 그 뒤 **저장**은 파일을 **화면에 보이는 그대로**
  씁니다. 밖에서 새로 생긴 파일은 **지워집니다.** 자동으로 병합하는 것은 없습니다.
- **파일 다시 읽기** — 미저장 편집을 버리고 파일 내용으로 돌아갑니다(한 번 확인을 받습니다).

⚠️ **저장은 내가 보지 못한 변경을 절대 덮어쓰지 않습니다.** 배너가 아직 나오지 않았어도 **저장**은 누르는
순간 파일을 다시 읽고, 다르면 아무것도 쓰지 않고 위 배너를 보여 줍니다.

### 4.5 파일이 깨지면 편집이 잠긴다

`erdd/` 의 YAML 이 파싱·스키마·정합성 검사에 실패하면 화면은 마지막으로 유효했던 모델을 유지하고 편집만
잠깁니다.

- 위쪽의 빨간 배너: `파일을 읽을 수 없어 편집이 잠겼습니다 — <경로>: <사유>`
- 하단 바가 **읽기 전용**으로 바뀌고, **파일** 메뉴에서 가져오기 항목이 사라집니다
- **파일을 고치면 자동으로 풀립니다.** 서버를 다시 띄울 필요가 없습니다

⚠️ **이 잠금은 데이터를 지킵니다.** 편집을 계속 받으면 멀쩡한 화면 상태가 깨진 파일을 통째로 덮어써, 손으로
고치던 것이 사라집니다. **`layout.yaml` 도 예외가 아닙니다.** 좌표뿐 아니라 **메모의 글**도 들고 있으므로,
깨진 상태에서 편집을 허용하면 다음 저장이 `notes: []` 로 메모를 지웁니다. **파일이 깨져 있는 동안에는
저장도 막힙니다.**

명명 경고와 필수 커스텀 항목 누락은 오류가 아닙니다. 아무것도 잠그지 않고 **모델 검사**에 나옵니다.

### 4.6 탭을 여러 개 열면

⚠️ **브라우저에서 한 편집은 그 편집을 한 탭에만 보입니다.** 모든 탭이 파일에 **밖에서** 생긴 변경은 받지만,
탭 자신의 편집은 되돌아올 때 걸러집니다. 그러지 않으면 드래그 중인 탭이 계속 튀기 때문입니다. 다른 탭은 다음
외부 변경 때 따라잡습니다. 그 전에 따라잡으려면 새로 고치세요. **로컬 모드는 한 사람이 한 화면에서 작업한다고
가정합니다.**

다만 **모든 탭이 미저장 표시를 공유합니다.** 서버가 드래프트를 하나만 들고 있으므로, 어느 탭에서 저장하든
다른 탭의 표시도 함께 꺼집니다.

---

## 5. 파일과 git

### 5.1 무엇이 어디에 있나

```text
erdd.config.yaml            # dialects, naming rules, table options (serverUrl, projectId are null)  ← commit
erdd/                                                                        ← commit
├─ tables/*.yaml            # one table = one file, file name = physical name
├─ groups.yaml              # table groups
├─ words.yaml               # word dictionary
├─ terms.yaml               # term dictionary
├─ domains.yaml             # domains (type standards)
├─ custom-fields.yaml       # custom field definitions
├─ layout.yaml              # layout coordinates and notes → 5.3
├─ changes/               # change records → 5.6
└─ snapshots/               # snapshots → section 6
   ├─ index.yaml            #   list (name, description, time), readable with git diff
   └─ <id>.json.gz          #   one snapshot = one file (gzip)
.erdd/                                                                       ← do not commit
└─ draft.json               # unsaved edits → 4.4
```

파일 포맷의 세부(테이블 파일의 키 하나하나, 사전 파일의 모양, `id` 다루는 법)는
[CLI 매뉴얼 5절](cli-guide.md#5-파일-구조와-포맷)에 있습니다.

### 5.2 커밋

```bash
git add erdd erdd.config.yaml
git commit -m "스키마: 회원 등급 컬럼 추가"
```

- ⚠️ **커밋하기 전에 저장했는지 확인하세요.** 미저장 편집은 `erdd/` 에 없으므로 커밋되지 않습니다.
  터미널에서도 확인할 수 있습니다: `erdd status` 가 **저장하지 않은 편집이 있습니다** 를 알려 줍니다.
- **`erdd/snapshots/` 도 커밋합니다.** 스냅샷은 팀과 공유되고 이력에 남습니다(→ [6절](#6-스냅샷)).
- **`.erdd/` 는 커밋하지 마세요.** `init --local` 이 `.gitignore` 에 그 줄을 더해 둡니다.
- **`erdd.config.yaml` 을 함께 커밋하세요.** 저장소를 클론해 `erdd serve` 를 실행한 팀원이 같은 방언·명명
  규칙·테이블 옵션으로 같은 그림을 봅니다. `init` 을 다시 할 필요가 없습니다.
- 이 커밋들이 로컬 모드의 **이력 전부**입니다. 되돌리기는 `git revert` 로, 비교는 `git diff` 로 하세요.

### 5.3 `erdd/layout.yaml` — 배치 좌표와 메모

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

- **테이블을 옮기면 이 파일만 바뀝니다.** `erdd/tables/*.yaml` 은 한 글자도 바뀌지 않습니다. 이리저리
  옮기는 것이 스키마 diff 를 만들지 않도록 파일을 나눴습니다.
- **커밋합니다.** 배치는 팀이 함께 보는 그림의 일부입니다.
- **테이블은 `id` 로 식별합니다.** 물리명을 바꿔도 배치가 따라갑니다. 지운 테이블의 흔적은 조용히
  버립니다.
- **없으면 테이블이 물리명 순으로 격자에 놓입니다.** 항목 하나가 깨지면 **그 항목만** 걸러지고 나머지는
  그대로 열립니다(파일 전체가 깨진 것은 다릅니다 → [4.5](#45-파일이-깨지면-편집이-잠긴다)).

### 5.4 서버 없이 검사하기 — `erdd validate`

`erdd/` 파일만으로 참조 정합성과 명명 규칙을 검사합니다. 로컬 모드에서 그대로 동작합니다.

```bash
erdd validate            # consistency and naming warnings
erdd validate --strict   # treats warnings as failures too (exit code 1), for commit hooks and CI
```

`--json` 출력 규약과 CI 예시는 [CLI 매뉴얼 10절](cli-guide.md#10-자동화와-ci)에 있습니다.

⚠️ **로컬 전용 프로젝트에서는 `pull`, `push`, `diff` 가 멈춥니다**(종료 코드 `1`). 서버가 없으므로 예상된
동작입니다. 메시지는 `erdd.config.yaml` 에 연결 설정이 없다고 알리고, `erdd init` 으로 연결하거나 `erdd serve`
로 로컬에서 열라고 제안합니다.

```text
오류: erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요
```

### 5.5 DDL·DBML 로 주고받기 — `erdd export` · `erdd import`

**둘 다 서버를 부르지 않으므로 로컬 모드에서 그대로 동작합니다.**

```bash
erdd export > schema.sql             # safe in a pipe; warnings go to stderr
erdd export --format dbml -o s.dbml
erdd import legacy.sql --dry-run     # look at the plan first
erdd import legacy.sql --yes         # apply; it merges (existing tables are skipped)
```

기존 DB 덤프로 프로젝트를 시작할 때가 `import` 의 자리입니다. 적용한 뒤 `erdd validate` 로 사전
(`words.yaml`, `terms.yaml`)을 정리하고 **git 커밋**을 하세요. 로컬 모드에서는 그것이 이력의 전부입니다.

옵션, 감지 순서, `--json` 모양은 [CLI 매뉴얼 6.9·6.10](cli-guide.md#69-erdd-export)에 있습니다.

### 5.6 변경 기록 — 마이그레이션을 쓰기 위한 수정 내역

**무엇** — 테이블·컬럼·관계·인덱스에 한 변경을 어느 DB 나 도구에도 묶이지 않은 글로 `erdd/changes/` 에
기록합니다. **ERDD 는 SQL 을 만들지 않습니다.** 프로젝트마다 이 기록을 읽고 자기 도구(Flyway, Liquibase,
ORM 마이그레이션 등)로 자기 DB 문법의 마이그레이션을 씁니다. 기록 하나가 마이그레이션 하나입니다.

**어디서** — 에디터 헤더 **버전 → 변경 기록** 탭, 또는 터미널의 `erdd changes`.

**어떻게**

1. 편집하고 **저장**하세요(미저장 편집이 있으면 기록을 만들 수 없습니다).
2. **변경 기록** 탭 위쪽의 **미기록 변경**이 만들어질 기록을 미리 보여 줍니다.
3. **이름**(예: 「회원 등급 추가」)을 입력하고 **변경 기록 만들기**를 누르세요.
   `erdd/changes/<시각>_<이름>.erddc` 가 만들어집니다.
4. 기록 파일을 커밋하고, 그것을 보고 마이그레이션을 쓰세요. 마이그레이션 파일 이름이나 주석에 기록 파일
   이름을 넣어 두면 어디까지 옮겼는지 보입니다.

터미널에서는:

```bash
erdd changes                       # preview unrecorded changes
erdd changes new "회원 등급 추가"   # create a record
erdd changes --check               # exit code 1 if there are unrecorded changes (CI)
```

기록은 이렇게 생겼습니다. 위에서 아래로 옮기면 SQL 의존 관계를 만족하는 순서가 됩니다. 줄 끝의 `@…` 는
ERDD 가 대상을 찾는 표식이므로 옮기지 마세요.

```text
alter table MBR {                                               @01a0…
  rename column TEL_NO -> MBL_TEL_NO                            @01a0…
  add column GRD_CD VARCHAR(10) [null, after: MBR_NM]           @01a0…
  modify column MBR_NM {                                        @01a0…
    type: VARCHAR(50) -> VARCHAR(100)
    nullable: yes -> no
  }
}
```

전체 문법과 규칙은 [변경 기록 문법](../../guides/changeset-format.md)에 있습니다.

**이미 운영 중인 DB 에 도입할 때** — 첫 기록은 스키마 전체의 `create` 가 됩니다. 터미널에서
`erdd changes new "운영 DB" --baseline` 으로 만들면 「이미 DB 에 있으니 마이그레이션이 필요 없다」는
표시(`baseline: true`)가 붙습니다.

**브랜치** — 두 브랜치가 각자 기록을 만들어도 파일 이름이 달라 git 충돌 없이 병합됩니다. 병합한 뒤
`erdd changes` 가 미기록 변경이 없다고 하면 문제없습니다. 두 기록이 같은 컬럼의 같은 속성을 다르게 바꿨으면
**⚠️ 기록 간 경합** 경고가 나옵니다. 브랜치마다의 마이그레이션이 서로 다른 전제로 쓰였다는 뜻이므로, 확인한
뒤 남은 차이를 새 기록으로 만드세요. 두 브랜치가 같은 것을 지웠거나 한 브랜치가 다른 브랜치에서 이름을 바꾼
것을 참조해도 같은 ⚠️ 경고가 나오고 기록은 멈추지 않습니다. 이때도 남은 차이를 새 기록으로 만드세요.

⚠️ **기록 파일은 고치지 마세요.** 잘못 만들었고 아직 공유하지 않았다면 파일을 지우고 다시 만드세요. 이유는
[변경 기록 문법](../../guides/changeset-format.md)의 「기록 파일은 고치지 않는다」에 있습니다.

**기록을 만들 수 없을 때** — 가장 흔한 것은 미저장 편집이 있을 때와 기록할 변경이 없을 때입니다.
전체 목록은 [변경 기록 문법](../../guides/changeset-format.md)의 「기록을 만들 수 없는 경우」에 있습니다.

---

## 6. 스냅샷

**무엇** — 지금의 모델 전체를 이름을 붙여 저장해 두고, 나중에 그 시점으로 돌아가거나 지금과 비교합니다.

**어디서** — 에디터 헤더의 **버전** → **스냅샷**·**비교** 탭. (서버 모드의 **이력** 탭은 로컬 모드에
없습니다.)

**어떻게** — **이름**을 입력하고 **스냅샷 만들기**를 누르세요. 목록의 항목을 누르면 테이블 수와 처음 5개의
물리명이 펼쳐집니다. **복원**은 확인을 받은 뒤 그 시점으로 돌아가고, **삭제**도 한 번 확인을 받습니다.
**비교** 탭에서 **기준**과 **비교**에 스냅샷과 **현재**를 고르면 차이를 볼 수 있고, Excel **변경분 정의서**로
내려받을 수 있습니다. 화면의 세부는 [사용 매뉴얼 14절](user-guide.md#14-버전이력스냅샷비교)과 같습니다.

⚠️ **미저장 편집이 있으면 스냅샷을 만들 수 없습니다.**
**저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 스냅샷을 만드세요** 로 거절됩니다. 스냅샷은 **저장된 상태**에
이름을 붙이는 것이므로, 파일 어디에도 없는 상태를 가리키는 버전이 있어서는 안 됩니다.

⚠️ **복원은 파일을 바로 바꾸지 않습니다.** 복원하면 화면이 그 시점으로 돌아가고 **미저장**으로 표시됩니다.
`erdd/` 는 **저장을 누를 때만** 그 내용으로 다시 써집니다(→ [4.4](#44-편집은-드래프트에-저장이-파일에)).

**저장되는 곳** — `erdd/snapshots/` 에 **스냅샷 하나당 파일 하나**(gzip)로 저장됩니다. 목록의 이름·설명·
시각은 같은 디렉터리의 평문 `index.yaml` 에 있습니다.

```text
erdd/snapshots/
├─ index.yaml                              # name, description, time, revision
├─ 018f6b0e-1111-7000-8000-….json.gz       # full copy of the model (compressed)
└─ 018f6b12-2222-7000-8000-….json.gz
```

✅ **스냅샷은 git 에 저장됩니다.** `erdd/` 아래에 있으므로 커밋되어 팀원과 내 다른 컴퓨터로 옮겨 갑니다.
스냅샷 하나가 파일 하나이므로, 새로 만들면 **그 파일 하나만 커밋에 더해집니다.** 무엇이 더해졌는지는
`index.yaml` 의 diff 로 읽을 수 있습니다.

```bash
git add erdd/snapshots
git commit -m "스냅샷: 회원 도메인 정리 전"
```

- **파일 이름은 id 뿐입니다.** 스냅샷 이름을 파일 이름에 넣지 않습니다. macOS 와 git 이 한글 이름을 서로
  다르게 정규화해, 플랫폼마다 다른 파일로 보이기 때문입니다. id 는 시각 순으로 정렬되므로 `ls` 가 이미 시간
  순입니다.
- **복원은 실행 취소할 수 없습니다.** 복원 직후 실행 취소 이력이 비워집니다. 되돌아가려면 다른 스냅샷을
  복원하거나(저장하지 않았다면 **변경 버리기**로 충분합니다) git 에서 `erdd/` 를 되살리세요.
- `erdd/snapshots/` 를 손으로 고치지 마세요. 내용이 깨지면 그 스냅샷은 **스냅샷이 손상됐습니다** 로
  거절됩니다. 없다고 하지 않고 깨졌다고 알리는 것은 의도입니다.
- **`index.yaml` 이 깨져도 목록 보기와 복원은 됩니다.** 이름만 잠시 `(이름 없음) …` 으로 보입니다. 그 상태에서
  스냅샷을 만들거나 지우면 깨진 파일은 **덮어쓰지 않고** `index.corrupt-<시각>.yaml` 로 옮깁니다. 옛 이름이
  거기 남아 있으므로 손으로 되살릴 수 있습니다. (병합 충돌 표시가 남은 `index.yaml` 이 이 상태의 가장 흔한
  원인입니다.)

**옛 스냅샷은 자동으로 옮겨집니다.** 예전 `.erdd/snapshots.json` 이 있으면 `erdd serve` 가 처음 뜰 때 한 번
새 위치로 옮기고 이렇게 알립니다.

```text
스냅샷 3개를 erdd/snapshots/ 로 옮겼습니다 — 이제 커밋 대상입니다. git add erdd/snapshots
```

옛 파일은 지우지 않고 `.erdd/snapshots.json.migrated` 로 이름만 바꿉니다. 내용이 깨진 항목은 손상이 커밋
대상으로 승격되지 않도록 **옮기지 않고** 그 이름을 알립니다.

---

## 7. 서버와 오가기

로컬 모드와 서버 연결은 **배타적이지 않습니다.** `erdd.config.yaml` 에 `serverUrl` 과 `projectId` 가 있으면
연결된 프로젝트이고, 없으면 로컬 전용입니다. 어느 쪽이든 `erdd serve` 는 **뜨고, 늘 파일만 봅니다.**

### 7.1 서버 프로젝트를 로컬 에디터로 열기

받아 온 스키마를 **시각적으로** 확인하고 다듬은 뒤 다시 올리는 흐름입니다. 서버에 닿지 않는 곳(비행기 안,
서버가 있는 네트워크 밖)에서도 편집할 수 있습니다.

```bash
erdd pull                      # receive the server schema as files
erdd serve                     # view and edit it visually in the browser (stop with Ctrl+C)
erdd validate                  # check without a server
erdd diff                      # preview changes to push, changes to pull, and conflicts
erdd push -m "회원 등급 컬럼 추가"
```

- 열리는 프로젝트는 config 의 `projectId` 입니다. 주소는 `/p/<서버의 프로젝트 id>` 가 됩니다.
- **`serve` 가 도는 동안 다른 터미널에서 `erdd pull` 을 실행해도 됩니다.** 파일 감시가 반영해 화면이
  따라옵니다.
- ⚠️ **`pull` 은 로컬 변경을 덮어씁니다.** 파일을 건드렸으면 그 목록을 보여 주고 `계속할까요?` 로 한 번
  묻습니다. 브라우저에서 편집하던 중이었다면 여기서 멈추고 먼저 `push` 하세요. 마지막 pull 기준 시점이 없으면
  (클론 직후 등) `erdd/` 의 **모든** 파일을 덮어쓸 목록에 보여 주고 묻습니다.
- ⚠️ **좌표와 메모는 서버로 가지 않습니다.** `push` 는 `erdd/layout.yaml` 을 보내지 않고, `pull` 은 그것을
  덮어쓰지 않습니다. 서버 모드의 좌표와 메모는 서버 DB 에 따로 있고, 둘은 서로를 모릅니다.

### 7.2 로컬로 시작한 프로젝트를 서버로 옮기기

**`erdd init --create` 명령 하나면 됩니다.** 서버에 빈 프로젝트를 만들고 이 디렉터리를 거기에 연결합니다.
`erdd/` 는 한 바이트도 건드리지 않고, 「마지막 pull 시점」을 **빈 서버**로 정하므로 내 스키마 전체가 올릴
변경(추가)으로 잡힙니다.

```bash
$ git add erdd erdd.config.yaml && git commit -m "스키마: 서버 이관 전 상태"   # recommended: a point to return to

$ erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --create --org 플랫폼팀 --name 이관
이 로컬 프로젝트를 서버 프로젝트 "이관"로 연결합니다. 계속할까요? [y/N] y
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

- **조직 Owner/Admin 만 할 수 있습니다**(프로젝트 생성 권한). 권한이 없으면 서버에 아무것도 만들지 않고
  이렇게 멈춥니다. 그때는 아래 「생성 권한이 없을 때」로 가세요.

  ```text
  오류: 프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요
  ```

  메시지가 가리키는 「로컬로 시작한 프로젝트를 서버로 옮기기」 의 수동 절차가 바로 이 절의 아래
  「생성 권한이 없을 때 — 수동 절차」입니다.

- **서버 프로젝트는 이 디렉터리의 설정으로 만들어집니다.** `erdd.config.yaml` 의 방언·명명 규칙·테이블 옵션이
  그대로 올라가고, config 에 `serverUrl` 과 `projectId` 가 채워집니다. 그래서 `--dialect` 나 `--case` 를 줄 수
  없습니다.
- `--yes` 는 확인을 건너뜁니다. **`erdd serve` 에 미저장 편집이 있으면** 프롬프트 전에
  `⚠️ 저장하지 않은 편집이 있습니다 …` 가 나옵니다. 옮기는 것은 저장된 파일뿐이므로 먼저 저장하세요.
- 연결 직후 `erdd status` 가 `erdd/` 에 없던 빈 사전 파일을 `-` 로 보여 줄 수 있습니다. 기준은 `diff` 이고,
  `push` 한 번이면 사라집니다.
- **`layout.yaml` 은 올라가지 않습니다.** 파일은 그대로 두세요. 그 뒤로는 `erdd serve` 로 프로젝트를 열 때만
  쓰입니다.
- **서버 쪽 배치는 웹 에디터의 자동 정렬로 새로 잡으세요.**

#### 생성 권한이 없을 때 — 수동 절차

관리자에게 **빈 프로젝트**를 만들어 달라고 하고, 그 id 로 연결하세요. ⚠️ **이 연결에는 「마지막 pull 시점」이
없으므로** `push` 는 `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` 로 멈추고(종료 코드 `1`), `pull` 은
`erdd/` 를 빈 서버 상태로 덮어씁니다. 그래서 **복구할 수 있게 먼저 커밋해 두는 것이 핵심입니다.**

```bash
git add erdd erdd.config.yaml && git commit -m "스키마: 서버 이관 전 상태"

erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --project <new-project-id> --yes
erdd pull --yes                  # ⚠️ the empty server state overwrites erdd/ (the list it asks about is all your files)
git checkout HEAD -- erdd        # put back the schema you committed a moment ago
erdd diff                        # everything showing as additions is expected
erdd push -m "로컬에서 설계한 스키마 이관"
```

- `--yes` 는 「`erdd.config.yaml` 이 이미 있습니다. 덮어쓸까요?」 를 건너뜁니다. 로컬 전용 config 를 서버 연결
  config 로 바꾸는 것이 여기서 의도한 동작입니다(`--local` 과 달리 이쪽은 덮어씁니다).
- `init` 은 `erdd.config.yaml` 을 서버의 값(방언, 명명 규칙)으로 덮어씁니다. 로컬에서 정한 규칙과 다르면 웹의
  프로젝트 설정에서 맞추세요.
- `layout.yaml` 은 올라가지 않고, 서버 쪽 배치는 웹 에디터의 **자동 정렬**로 새로 잡습니다(위와 같습니다).

### 7.3 공용 사전을 받아 쓰기 — `erdd dict`

**서버에 연결한 프로젝트**는 조직·전역 공용 사전(표준 단어·용어·도메인·커스텀 항목)을 로컬 파일로 받고, 새
단어를 공용 라이브러리로 올릴 수 있습니다. 편집은 로컬(`erdd serve` + git)에서 하고, 서버는 저장소 역할을
합니다.

```bash
erdd dict pull --library "플랫폼팀 표준 사전"   # receive; erdd/words.yaml etc. and erdd/origins.yaml change
erdd serve                                      # edit as usual → save → git commit
erdd push -m "…"                                # bring the storage (server project) up to date first
erdd dict push --library "플랫폼팀 표준 사전"   # push to the shared library; a promotion request without permission
```

- **이 흐름(서버 구독으로 받기, 승격으로 올리기)은 연결한 프로젝트에만 있습니다.** 먼저
  [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)로 서버에 연결하세요. **받기만 할 거라면 로컬 전용
  프로젝트도 됩니다.** 아래 「로컬 전용 프로젝트도 배포 파일로 받는다」를 보세요.
  이미 자체 단어가 있는 프로젝트는 `erdd dict pull --adopt` 로 이름과 내용이 같은 단어의 출처만 연결합니다
  (내용이 다른 단어는 [CLI 매뉴얼 6.11](cli-guide.md#611-erdd-dict--공용-사전) 의 `--adopt` 부분대로 정리하세요).
- **`erdd/origins.yaml` 은 받은 항목이 어디서 왔는지 기록합니다. 손으로 고치지 마세요.** 커밋합니다.
- 명령·옵션·출력의 세부는 [CLI 매뉴얼 6.11](cli-guide.md#611-erdd-dict--공용-사전)에 있습니다.

#### 로컬 전용 프로젝트도 배포 파일로 받는다

**서버 연결이 전혀 없어도**, 관리자가 `erdd library export` 나 웹 **공용 리소스**의 **내보내기**로 만든 배포
파일(`.erdd-lib.yaml`)이 있으면 `erdd dict pull --file` 로 받을 수 있습니다. 그 명령은 파일만 읽고 서버를
부르지 않습니다.

```bash
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd dict pull --file standard.erdd-lib.yaml
데모 사전 (파일 standard.erdd-lib.yaml)
  추가 14 · 자동 갱신 0 · 연결 0 · 유지 0
반영했습니다 — erdd/custom-fields.yaml, erdd/domains.yaml, erdd/origins.yaml, erdd/terms.yaml, erdd/words.yaml
```

- 처음 받으면 파일 경로가 `erdd.config.yaml` 의 `dictionaries[].file` 에 구독으로 기록됩니다. 그 뒤로는 인자
  없는 `erdd dict pull` 도 이 파일에서 다시 받습니다(바뀐 것을 받으려면 새 배포 파일로 덮어쓰세요).
- **받기만 할 수 있습니다.** 로컬 전용 프로젝트에는 애초에 `erdd dict push` 가 없습니다(서버 연결이 필요합니다).
  로컬에서 만든 항목을 공용 라이브러리로 올리려면 [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)로 서버에
  연결하세요. (서버에 연결된 프로젝트가 파일 구독으로 받은 라이브러리를 올리려 하면
  `파일에서 받은 사전은 올릴 수 없습니다` 로 따로 막힙니다 → [CLI 매뉴얼 6.11](cli-guide.md#611-erdd-dict--공용-사전).)
- 옵션과 판정 규칙은 서버 구독의 `dict pull` 과 같습니다(추가, 자동 갱신, 충돌, 동명). 세부는
  [CLI 매뉴얼 6.11 의 `--file`](cli-guide.md#611-erdd-dict--공용-사전)을 보세요.

---

## 8. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `erdd serve` 는 떴는데 브라우저에 `{"message":"Route GET:/p/… not found"…}` 만 보임 | 웹 번들(`apps/web/dist`)이 없음. **저장소 체크아웃을 쓸 때만 생깁니다.** 레지스트리 설치본에는 번들이 들어 있습니다 | ERDD 체크아웃에서 `pnpm -C apps/web build` (→ [2.3](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)) |
| `sh: tsx: command not found`(종료 코드 127) | 프로젝트에 `tsx` 가 없음. **빠뜨렸을 때의 증상은 패키지 매니저마다 다릅니다.** pnpm 은 `npx` 가 그때그때 받아 와 **대개 돌아가지만** 네트워크가 없으면 실패합니다. 평평한 npm 배치는 캐시가 없으면 `ENOTCACHED` 로 실패합니다 | `pnpm add -D tsx` (→ [2.1](#21-필요한-것--준비-경로가-둘이다)) |
| `pnpm exec erdd …` 가 `ERR_PNPM_IGNORED_BUILDS`(`esbuild`)로 실패 | **pnpm 11 의 동작입니다.** `pnpm exec` 가 먼저 `pnpm install` 을 돌려 의존성 상태를 확인하는데, 빌드 스크립트가 승인되지 않은 패키지(`tsx` 가 끌어오는 `esbuild`)가 있으면 그 설치가 실패합니다. `@erdd/cli` 와 무관하고 pnpm 10 에서는 생기지 않습니다 | pnpm 이 제안하는 대로 `pnpm approve-builds` 로 `esbuild` 를 승인하세요. 그 전에도 **`./node_modules/.bin/erdd` 를 직접 부르면 동작합니다**(실측 확인) |
| `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요` | 프로젝트 루트 밖에서 실행함 | 프로젝트 루트로 옮기거나 `erdd init --local` 을 실행하세요 |
| `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` | `init --local` 을 실행했는데 config 가 이미 있음 | 기존 파일을 지우고 다시 실행하세요. `--yes` 로도 덮어쓰지 않습니다 |
| `포트 4300이 이미 사용 중입니다 …` | 다른 `erdd serve` 나 다른 프로그램이 그 포트를 잡고 있음 | `--port` 로 다른 포트를 주세요. 다음 포트를 자동으로 고르지 않는 것은 의도입니다 |
| `--port abc` 가 사용법 오류(`2`)로 실패 | 정수가 아님 | 포트 번호를 주세요 |
| 브라우저에 **파일을 읽을 수 없어 편집이 잠겼습니다** 배너가 나오고 편집할 수 없음 | `erdd/` 의 YAML 이 깨짐 | 배너가 가리키는 파일을 고치세요. 고치면 자동으로 풀립니다(→ [4.5](#45-파일이-깨지면-편집이-잠긴다)) |
| 테이블이 격자로 나란히 놓임 | `erdd/layout.yaml` 이 없거나 그 테이블의 항목이 없음 | 정상입니다. 테이블을 옮기거나 **자동 정렬**을 실행하면 좌표가 저장됩니다 |
| 내가 한 편집을 다른 탭이 따라오지 않음 | 편집은 그 편집을 한 탭에만 보임 | 새로 고치세요(→ [4.6](#46-탭을-여러-개-열면)) |
| 화면에서 편집했는데 `git status` 에 아무것도 없음 | **저장하지 않았습니다.** 편집은 `.erdd/draft.json`(gitignore)에만 있습니다 | 헤더의 **저장** 또는 `Cmd+S`. 터미널에서는 `erdd status` 가 알려 줍니다(→ [4.4](#44-편집은-드래프트에-저장이-파일에)) |
| **파일이 밖에서 바뀌었습니다** 배너가 나옴 | 미저장 편집이 있는데 `git pull`, 에이전트 등이 `erdd/` 를 바꿈 | **내 편집 유지**(저장하면 화면으로 파일을 덮어씀) 또는 **파일 다시 읽기**(내 편집을 버림) (→ [4.4](#44-편집은-드래프트에-저장이-파일에)) |
| **저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 스냅샷을 만드세요** | 스냅샷은 저장된 상태만 담음 | 먼저 저장하세요(→ [6절](#6-스냅샷)) |
| `erdd serve` 를 멈췄다 다시 띄웠는데 편집이 그대로 있음 | 정상입니다. 미저장 편집은 드래프트에 남습니다 | 계속 작업하거나 **변경 버리기**로 버리세요(→ [4.4](#44-편집은-드래프트에-저장이-파일에)) |
| 터미널에서 파일을 고쳤는데 화면이 바뀌지 않음 | 파일 감시 등록이 실패함(플랫폼, 권한, `EMFILE`) | 새로 고치세요. `serve` 를 돌리는 터미널에 `[watchProject] …` 경고가 보입니다 |
| `erdd.config.yaml에 연결 설정이 없습니다 …` | 로컬 전용 프로젝트에서 `pull`, `push`, `diff` 를 실행함 | 로컬에서 작업하려면 `erdd serve`. 서버에 연결하려면 `erdd init --server … --create` (→ [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)) |
| `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 …` | 로컬 전용 프로젝트에서 `erdd dict pull --library`, `dict push`, `dict requests` 를 실행함 | 올리기와 요청 보기에는 서버 연결이 필요합니다(→ [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)). **받기만** 하고 배포 파일이 있다면 연결 없이 `erdd dict pull --file <경로>` 로 받을 수 있습니다(→ [7.3](#73-공용-사전을-받아-쓰기--erdd-dict)) |
| `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다 …` | 둘 중 하나만 적음 | 둘 다 적거나 둘 다 지우세요(둘 다 없으면 로컬 전용입니다) |
| `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` | 연결 설정만 적었거나 `--project` 로 연결한 뒤 `push` 를 실행함 | **`pull` 하기 전에** [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)를 읽으세요. 그냥 `pull` 하면 `erdd/` 가 서버 상태로 덮어써집니다 |
| 사설 도메인이나 리버스 프록시로 접속하면 **403** | `Host` 검사 | 루프백 주소로 여세요. LAN·프록시 노출은 일부러 막았습니다(→ [3.2](#32-erdd-serve--에디터를-연다)) |
| **공용 리소스**, **이력**, 사용자 메뉴가 없음 | 로컬 모드에는 없는 기능 | 정상입니다(→ [4.2](#42-사용-매뉴얼의-어느-장이-해당하나)) |
| `변경 기록은 로컬 모드 전용입니다 …` | 서버에 연결된 프로젝트에서 `erdd changes` 를 실행함 | 서버 모드에는 변경 기록이 없습니다 |

CLI 전반(서버 연결, 토큰, 충돌)의 문제 해결은 [CLI 매뉴얼 11절](cli-guide.md#11-문제-해결)에 있습니다.

---

## 부록: 검증 상태

**로컬 모드의 동작은 실제로 실행해 확인했습니다.** 명령 출력, 종료 코드, 브라우저 스모크 11개 항목의 목록은
[CLI 매뉴얼 부록](cli-guide.md#로컬-모드)에 있습니다.

**이 문서를 쓰면서 더 확인한 것.**

- **웹 번들이 없을 때의 증상** — `apps/web/dist` 를 치우고 `erdd serve` 를 실행했습니다. 터미널 출력은 평소와
  같았고 `/` 는 `/p/<id>` 로 302 를 돌려줬지만, 그 주소는 [2.3](#23-경로-b-erdd-저장소-체크아웃--웹-번들을-한-번-빌드한다)
  에 인용한 JSON 404 를 돌려줬습니다.
- 로컬 전용 프로젝트에서 `init --local` 이 `erdd.config.yaml` 과 `.gitignore`(`.erdd/` 한 줄)만 만드는 것,
  `status` 의 사람용·`--json` 출력, `validate` 가 그대로 동작하는 것.

**패키지 설치로 확인한 것.**

- **레지스트리 설치본에서 `erdd serve` 가 그대로 뜹니다.** `pnpm pack` 으로 만든 tarball 을 별도 소비자
  프로젝트(**웹 앱을 한 번도 빌드하지 않은** 프로젝트)에 설치하고 `erdd serve --no-open` 을 실행했습니다.
  `/p/<id>` 는 **200 + HTML**, `/assets/index-*.js` 는 200 + 1,162,100 바이트, `/trpc/model.get` 은 200 을
  돌려줬습니다. 설치된 `node_modules/@erdd/cli/web` 에는 파일이 101개 있었고 `engines` 는
  `{"node":">=22"}` 였습니다. 그 프로젝트에서 `erdd --help`, `init --local`, `validate` 도 `0` 으로 끝났습니다.
- **저장소 배치에서는 갓 빌드한 `apps/web/dist` 가 이깁니다.** 어느 쪽이 서빙되는지 가리려고 두 후보
  (`apps/web/dist` 와 `packages/cli/web`)에 서로 다른 표식 파일을 두었습니다. 저장소 배치의 `/p/<id>` 도 200 을
  돌려줬습니다. **릴리스 준비로 만든 사본이 최신 빌드를 가리지 않습니다.**
- **소비자가 `tsx` 를 직접 선언해야 합니다.** [2.2](#22-경로-a-npm-에서-설치한다-권장)의
  `pnpm add -D @erdd/cli tsx` 경로는 캐시를 비우고 오프라인이어도 `0` 으로 끝납니다. `tsx` 를 `@erdd/cli` 의
  `dependencies` 에 넣어 풀려던 시도는 **오히려 pnpm 소비자를 퇴행시켜**(되던 것이 `127` 이 됨) 되돌렸습니다.

**공개 npm 에서 설치해 확인한 것.** 위 항목(`pnpm pack` 으로 만든 tarball)과 달리 npm 에 게시된 버전을
설치했습니다. 빈 디렉터리에서 [2.2](#22-경로-a-npm-에서-설치한다-권장)과 똑같이 `pnpm add -D @erdd/cli tsx`
로 설치하자 `erdd init --local` 과 `validate` 가 `0` 으로 끝났고, `erdd serve --no-open` 에서 `/` 는
`/p/<id>` 로 302 를 돌려주고 그 주소는 **200 + HTML** 을 돌려줬습니다. 즉 웹 앱을 한 번도 빌드하지 않은
프로젝트에서 동봉된 웹 앱이 서빙됩니다. 원본 출력과 확인하지 않은 조합(npm 설치, 전역 설치,
`npx @erdd/cli`, Windows)은 [CLI 매뉴얼 부록](cli-guide.md#레지스트리-게시)에 있습니다.

**실서버로 확인한 것** — [7.2](#72-로컬로-시작한-프로젝트를-서버로-옮기기)의 `init --create` 이관
(`init --local` → 단어 추가 → `init --create` → `diff` 가 전부 추가로 보임 → `push`),
[7.3](#73-공용-사전을-받아-쓰기--erdd-dict)의 `dict pull`, `--adopt`, `dict push`, 그리고 기준 시점 없이 연결한
디렉터리에서 `pull` 이 모든 파일을 나열하고 묻는 것. 목록은
[CLI 매뉴얼 부록](cli-guide.md#공용-사전서버-프로젝트-생성--실서버)에 있습니다.

**서버를 붙여 확인하지 못한 것** — 7.2 의 「생성 권한이 없을 때」 수동 절차는 소스와 단위 테스트를 읽고
옮겼습니다. 인용한 메시지는 구현과 테스트 기대값에서 그대로 가져왔습니다.

**근거** — `packages/cli/src/{commands/{init,serve}.ts,local/*,config.ts}`,
`packages/core/src/{layout,local}.ts`, `apps/web/src` 의 로컬 모드 분기.
기능이 바뀌면 이 문서도 함께 바뀌어야 합니다.

---

**다음 문서** — 에디터 화면마다의 세부는 [사용 매뉴얼](user-guide.md)을 읽으세요. 모든 명령과 파일 포맷,
CI 는 [CLI 매뉴얼](cli-guide.md)을 읽으세요. 팀에 공용 서버가 필요해지면
[설치·운영 매뉴얼](install.md)을 읽으세요.
