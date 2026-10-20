# ERDD CLI manual

This is the manual for `erdd`, a command-line tool that downloads the schema from an ERDD server as **YAML files in
your codebase**, lets you version them with git, and pushes local edits back to the server. It is for developers who
handle the schema alongside their code, and for AI agents that read and edit those files. For using the editor, see the
[user guide](user-guide.md). For installing and running the server, see the
[installation and operations manual](install.md). **The way to use it with files only, without a server**, is covered
from start to finish in the [local mode manual](local-guide.md).

The CLI's messages are in Korean. Output in this manual is quoted exactly as the CLI prints it, with an English
explanation next to it where it matters.

**Contents** — [1. Overview](#1-overview) · [2. Installation and running](#2-installation-and-running) · [3. Connecting — server connection and local mode](#3-connecting--server-connection-and-local-mode) · [4. Everyday workflow](#4-everyday-workflow) · [5. File structure and format](#5-file-structure-and-format) · [6. Command reference](#6-command-reference) · [7. Synchronization and conflicts](#7-synchronization-and-conflicts) · [8. What the files do not hold](#8-what-the-files-do-not-hold) · [9. Using it with AI agents](#9-using-it-with-ai-agents) · [10. Automation and CI](#10-automation-and-ci) · [11. Troubleshooting](#11-troubleshooting) · [Appendix: Verification status](#appendix-verification-status-2026-08-14)

---

## 1. Overview

**What** — Synchronizes, in both directions, an ERD model whose source of truth is the web UI with local files.

```text
  [ ERDD server ]  ◀── push ──  erdd/*.yaml  ── git commit ──▶  [ Repository ]
  (source of truth) ── pull ──▶  (working copy)                  (review, history)
```

- **Schema changes appear alongside code in PR reviews.** One table is one file, so the diff is readable.
- **An AI agent understands the DB structure by reading `erdd/`**, without digging through migrations or ORM code.
- **An agent edits the files and runs `push`, and a designer continues refining on the web.** A push is recorded as a
  revision and broadcast on the real-time channel, exactly like a web edit.

**Three premises.**

| Premise | Meaning |
|---|---|
| The server is the source of truth | Local files are a working copy. `pull` overwrites local files with the server state. |
| The files hold **only the semantic information of the schema** | Layout coordinates and notes are not in the **schema files** (`erdd/tables/*.yaml` and the top-level dictionary files) (→ [section 8](#8-what-the-files-do-not-hold)). Shared dictionary sources are kept separately in `erdd/origins.yaml` (→ [5.8](#58-erddoriginsyaml--shared-dictionary-sources)). |
| Every command works **from the current directory** | Run them in the project root, where `erdd.config.yaml` is. |

**There are two ways to run it, and the first two premises above assume "a project connected to a server".** **Local
mode**, opened with `erdd serve`, has no server, account, or DB, and the `erdd/` files themselves are the source of
truth. The browser shows the same web editor (→ [3.4](#34-local-mode--using-it-without-a-server)). Layout coordinates
and notes go into `erdd/layout.yaml`, and this is **independent of the mode**. Even if you open a server-connected
project with `erdd serve` and edit it, they accumulate in the same file
(→ [5.7](#57-erddlayoutyaml--layout-coordinates-and-notes)).
**If you plan to use only local mode, the [local mode manual](local-guide.md) alone is enough instead of this document.**

**There is no MCP server.** Agent integration is this CLI plus the bundled skill document (→ [section 9](#9-using-it-with-ai-agents)).

---

## 2. Installation and running

**There are three methods, and the first is the default.** Pick your situation from the table below.

| Method | When to use it | ERDD repository checkout |
|---|---|---|
| [A. Install from npm](#22-method-a-install-from-npm-recommended) | **This is the usual one.** Use it directly in the project where the schema will live | **Not needed** |
| [B. Run directly from the repository](#23-method-b-run-directly-from-the-repository-no-installation) | You cannot reach npm (offline), or you are changing the CLI itself | Needed |
| [C. Link as a project dependency](#24-method-c-link-as-a-project-dependency) | You change the CLI and check it right away in a consumer project | Needed |

### 2.1 Requirements

| Item | Value | Source |
|---|---|---|
| Node.js | **22 or later** | `mise.toml`, and **the packages enforce it**. Both packages have `engines.node: ">=22"`, so installing with a mismatched Node makes the package manager warn or refuse |
| Packages | `@erdd/cli` (binary `erdd`) · dependency `@erdd/core` | `packages/cli/package.json` |
| Runner | `tsx`. **The consumer installs it directly** | The package contains the original TypeScript as is, and the binary's shebang is `npx tsx` (⚠️ below) |
| ERDD repository checkout | **Only for methods B and C.** Method A does not need it | |

⚠️ **Add `tsx` to your project, whatever your package manager.** The package contains **the original TypeScript as
is**, not build output, and the binary's shebang is `#!/usr/bin/env -S npx tsx`. **`@erdd/cli` does not pull in `tsx`
for you.** The consumer must declare it in their own project.

**The symptom of leaving it out differs by package manager.** Because the shebang goes through `npx`, **`npx` fetches
`tsx` on demand and it usually just runs** (but the first run is slower and depends on registry access). Without a
network, the shell, not the CLI, ends it like this.

```text
sh: tsx: command not found
# exit code 127: an error from the shell, not the CLI
```

The flat npm layout fails with `ENOTCACHED` when there is no cache. **Sometimes it works and sometimes it does not**,
so diagnosing from this one symptom alone sends you in circles (→ [11. Troubleshooting](#11-troubleshooting)).

**That is why every installation command in this document includes `tsx`.** It is **the only guaranteed path**.

### 2.2 Method A: install from npm (recommended)

`@erdd/cli` and `@erdd/core` are on the **public npm** (registry.npmjs.org). You need no registry configuration and no
token. Install them right in the project where the schema will live.

```bash
cd /path/to/my-project
pnpm add -D @erdd/cli tsx
pnpm exec erdd --help

# with npm
npm install -D @erdd/cli tsx
npx erdd --help
```

This creates `node_modules/.bin/erdd`, which you call with `pnpm exec erdd …` (`npx erdd …` with npm). `@erdd/core`
comes in as a dependency, so you do not install it separately.

**The web bundle is inside the package.** The editor that `erdd serve` opens in the browser (the build output of
`apps/web`) ships whole in the tarball. **With an npm install, `erdd serve` starts as is without building the web app
separately** (→ [local mode manual 2.2](local-guide.md#22-path-a-install-from-npm-recommended)). An installed copy
cannot have the repository layout (`apps/web/dist`) in the first place, so this bundled copy is always used.

**The documentation is included too.** The package root has a `README.md` (the entry point for both modes), and the
four manuals, this one plus the [local mode](local-guide.md), [user](user-guide.md), and
[installation and operations](install.md) manuals, are bundled as is per language, in
`node_modules/@erdd/cli/docs/en/` (English) and `node_modules/@erdd/cli/docs/ko/` (Korean). You can read them without
cloning the repository, and the relative links between them still work.

### 2.3 Method B: run directly from the repository (no installation)

**When** — You cannot reach npm (offline), or you want to run the CLI right away while changing its source.

Nothing is installed. **From the project directory you are working in**, run it by pointing at the entry point of the
ERDD checkout.

```bash
cd /path/to/my-project
npx tsx /path/to/ERDD/packages/cli/src/main.ts status
```

The path is long, so a shell alias helps.

```bash
# ~/.zshrc or similar
alias erdd='npx tsx /path/to/ERDD/packages/cli/src/main.ts'
```

⚠️ **The current directory must be the target project.** The CLI looks for `erdd.config.yaml`, `erdd/`, and `.erdd/`
all relative to `process.cwd()`. If you run it inside the ERDD repository, it looks in the wrong place.

⚠️ **With this method, you must build the web app once before using `erdd serve`.** The checkout has no bundle. Run
`pnpm -C apps/web build` (→ [local mode manual 2.3](local-guide.md#23-path-b-erdd-repository-checkout--build-the-web-bundle-once)).

### 2.4 Method C: link as a project dependency

**When** — You change the CLI and want to check it in a consumer project with the same `pnpm exec erdd …` invocation.
You use the same call form as a registry install, while the code comes from your local checkout.

This creates `node_modules/.bin/erdd`, which you call with `pnpm exec erdd …`. **You must add `tsx` as well.**

```bash
cd /path/to/my-project
pnpm add -D /path/to/ERDD/packages/cli tsx
pnpm exec erdd --help
```

⚠️ **Without `tsx`, running is not guaranteed.** Sometimes `npx` fetches it on the spot and it runs. Without a network
or cache, it fails with `sh: tsx: command not found` (exit code 127) or `ENOTCACHED` (→ [2.1](#21-requirements)).

⚠️ **This installation changes the file permissions of the original file in the ERDD repository.** The package
manager adds the execute bit to the bin entry point, so after installing, `git status` in the ERDD checkout shows
`packages/cli/src/main.ts` as `old mode 100644 / new mode 100755`. Do not commit it. Revert it with
`chmod 644 packages/cli/src/main.ts`. If you do not want this side effect, use
[method B](#23-method-b-run-directly-from-the-repository-no-installation).

### 2.5 Check that it runs

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

The help text is in Korean. Each command and option is described in English in [section 6](#6-command-reference).
`--help` and `-h` are handled before any other argument and always exit with `0`.

Check the installed version with `--version` (`-v`). It prints only the version string as one line on stdout and exits
with `0`. With `--json`, it prints one object.

```bash
$ erdd --version
0.5.0
$ erdd --json --version
{"version":"0.5.0"}
```

`--version` and `-v` are taken as the version **only in the command position (the first argument)** (`--json` can come
before or after). A `-v` written after a command is not the version. `erdd status -v` ignores `-v` and runs status as
is, and `erdd export -o -v` writes to a file named `-v`. Together with `--help`, `--help` wins. The version shown next
to the wordmark at the top of the web screen is the same value.

---

## 3. Connecting — server connection and local mode

### 3.1 Issue a personal access token

**Where** — The **액세스 토큰** (Access tokens) card on the web's `/settings` (user menu → **설정**, Settings).

**How** — Enter a recognizable name in **토큰 이름** (Token name) (for example, 「노트북」, "laptop") and click **발급**
(Issue). The value appears in a yellow box, and **복사** (Copy) puts it on the clipboard. The screen details are in
[user guide section 18](user-guide.md#18-access-tokens).

**Limit — the plain text is shown only once, right after issue.** If you lose it, you reissue it rather than look it up.

**Permissions are not a new axis.** A token's permissions **follow the issuing user's organization and project roles
exactly.** A token created by a Viewer has only Viewer permissions, and if that user is removed from the project
members, the token automatically loses access to that project. You do not need to revoke the token separately. Tokens
do not expire; they can only be revoked.

**The only server features a token can call are the ones the CLI uses**: connection and synchronization (`auth.me`,
`org.list`, `project.list`, `project.get`, `model.get`, `model.push`), project creation (`project.create`, for
`init --create`), and shared dictionaries (`resource.library.listForProject`, `resource.items.list`,
`resource.promote`, `promotion.create`, `promotion.listForProject`, for `erdd dict`). The rest of the web UI's features
(export, snapshots, member management, approving promotion requests, and so on) are session-only and cannot be called
with a token.

⚠️ **A token can do every write its issuer can do on the web.** An organization Owner/Admin's token **creates
projects** in the organization (`erdd init --create`) and **pushes to organization libraries directly, without
approval** (`erdd dict push`). A service admin's token writes even to global libraries. Issue tokens for agents and CI
from an **Editor account**. Then `dict push` becomes a promotion **request**, and an organization admin must approve
it on the web before it takes effect.

### 3.2 `erdd init`

Run it in the project root. Interactively, it asks in order.

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

It asks for the server URL, the access token, the organization, and the project, and then reports that it connected to
the project and suggests `erdd pull`. Non-interactively (CI, agents), pass the three values as arguments. If any is
missing, the exit code is `2`.

```bash
erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --project 018f6b0e-… --json
```

**What it does, in order.**

1. If `erdd.config.yaml` already exists, it asks 「덮어쓸까요?」 ("Overwrite?") (skip with `--yes`; declining exits with `1`).
2. **It first checks with `auth.me` that the token actually works**, so it never creates a config with a bad token.
3. Without `--project`, it has you choose an organization and then a project.
4. It gets the project's dialects and naming rules and writes `erdd.config.yaml`.
5. It writes the token to `.erdd/credentials.json`, with **file mode `0600`** (an existing file is also narrowed every time).
6. It adds one `.erdd/` line to `.gitignore` (left alone if it is already there).

**If you reconnect to the same project on the same server** (to change only the token, for example), the config's
shared dictionary subscriptions (`dictionaries`) carry over. If you connect to a different project or server, the
server subscriptions are cleared, but file subscriptions (lines with `file` → [5.2](#52-erddconfigyaml)) are kept,
because they are files in the repository and unrelated to the server connection.

**If the server does not have the project yet, create it and connect with `--create`.** Only organization
Owners/Admins can do this. Moving a local-only project to a server is also done with this command
(→ [6.1](#61-erdd-init)).

```bash
$ erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --create --org 플랫폼팀 --name 주문시스템 --yes
서버 프로젝트 주문시스템을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.
```

The output reports that it created and connected the server project 주문시스템 and suggests starting to edit with
`erdd serve`.

### 3.3 Where to keep the token

| Location | Priority | Use |
|---|---|---|
| Environment variable `ERDD_TOKEN` | **High** | CI, containers. An empty string counts as unset. |
| `.erdd/credentials.json` | Low | Saved by `init`. It is git-ignored. |

If the environment variable is set, the file is not read. **`erdd.config.yaml` is committed** and contains no token,
so teammates who clone the repository only need to provide their own `ERDD_TOKEN` (they do not need to run `init`
again).

### 3.4 Local mode — using it without a server

Opens the same web editor from the `erdd/` files alone, **with no server, account, or DB**. Use it when there is no
server to connect to, or when you want to draw the schema alone inside your repository. **This section covers only what
you need to know on the CLI side.** Preparation (building the web bundle), what works in the browser and what does not,
files and git, and snapshots are in the [local mode manual](local-guide.md). Command option details are in
[6.8](#68-erdd-serve).

```bash
$ cd /path/to/my-project
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd serve
http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

**`init --local` creates only `erdd.config.yaml` and one `.erdd/` line in `.gitignore`.** It does not create the
`erdd/` directory (that appears the first time you edit in the browser). There is no token and no server round trip.

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

⚠️ **`--local` does not overwrite, even with `--yes`.** If `erdd.config.yaml` already exists, it stops with
`erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` ("erdd.config.yaml already exists. Delete it and run again")
(exit code `1`). There is no server project to fall back on, so overwriting would silently lose the dialects and naming
rules.

⚠️ **`erdd serve` serves a prebuilt web bundle as static files, and in the repository layout you must build that bundle
once.** With an [npm install](#22-method-a-install-from-npm-recommended), the bundle is included in the package, so there
is nothing to do. With a repository checkout (methods B and C), if `apps/web/dist` is missing, the server starts as usual
but the browser shows a JSON 404 instead of the editor. Run `pnpm -C apps/web build` once in the ERDD checkout
(→ [local mode manual 2.3](local-guide.md#23-path-b-erdd-repository-checkout--build-the-web-bundle-once)).
**In the repository, the freshly built `apps/web/dist` always wins.** Even if you once made a copy in
`packages/cli/web` to prepare a release, the screen keeps showing the latest build.

**Edits stay in a draft until you save.** What you change on screen is recorded automatically in `.erdd/draft.json`
(gitignored), and is written to `erdd/` **only when you press `Cmd+S` (or 저장 (Save) in the header)**, so that
discarded attempts do not clutter the git diff. Unsaved edits survive stopping and restarting `serve`. When a terminal,
agent, or `git pull` edits the files, the screen follows **without a reload**. Moving tables or creating notes goes
only into `erdd/layout.yaml`, so it does not clutter the schema files' diff
(→ [5.7](#57-erddlayoutyaml--layout-coordinates-and-notes)).
**A broken file locks editing.** A red banner appears at the top, the bottom bar changes to **읽기 전용** (Read-only),
and fixing the file unlocks it automatically (→ [local mode manual 4.5](local-guide.md#45-a-broken-file-locks-editing)).

**What the browser does not have** — Login, accounts, and access tokens; home, organizations, the project list, and
admin; participants (presence) and real-time cursors; shared resources, promotion requests, and project members; and the
**이력 (History) tab** of **버전** (Versions). Every other editor feature is there as is (chapter-by-chapter comparison
→ [local mode manual 4.2](local-guide.md#42-which-chapters-of-the-user-guide-apply)).

**Using it together with `pull` and `push` — the two forms are not mutually exclusive.**

- Without connection settings (`serverUrl` and `projectId` are `null`), `pull`, `push`, and `diff` stop like this
  (`1`). The message says that `erdd.config.yaml` has no connection settings.

  ```text
  오류: erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요
  ```

- **`erdd serve` also starts in a project with connection settings.** In that case it opens with the config's
  `projectId`, and the local server looks **only at the files** either way. Exchanging with the server is still done by
  `pull` and `push`. The flow of opening a pulled project with `serve`, checking and editing it visually, and running
  `push` works as is. If you run `erdd pull` while the GUI is up, the watcher catches it and the screen follows.
- **Moving a project started locally to a server takes one `erdd init --server … --create` command.** It creates an
  empty project on the server and sets the baseline to **an empty model**, so `erdd/` stays as it is, `erdd diff` shows
  everything as additions, and `erdd push` uploads it (→ [6.1](#61-erdd-init)). ⚠️ **Writing the connection settings
  by hand is not enough.** `push` requires the last-pull baseline (`.erdd/base.json`), so it stops with
  `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` ("There is no baseline. Run erdd pull first"), and running `pull`
  in that state overwrites `erdd/` with the server's empty state. The manual procedure for when you have no project
  creation permission is in [local mode manual 7.2](local-guide.md#72-move-a-project-started-locally-to-a-server).

---

## 4. Everyday workflow

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

- **`status` does not call the server.** It shows only the connection information and whether there are local changes
  (it works offline too).
- **`validate` does not call the server either.** That makes it a good fit for commit hooks and CI.
- **A successful `push` automatically runs one more pull.** The `id` of newly created objects is filled into the files,
  and server-side changes that were merged automatically come down too, so the next `status` is clean right away.
- **What you commit is `erdd/` and `erdd.config.yaml`.** Do not commit `.erdd/`.
- **Local mode has no such round trip.** Saving is the files, and committing is the history. Instead of `pull`, `diff`,
  and `push`, keep `erdd serve` running, edit, and run `git commit` (→ [3.4](#34-local-mode--using-it-without-a-server)).
- **`export` and `import` do not call the server either.** They only read and write the `erdd/` files
  (→ [6.9](#69-erdd-export) · [6.10](#610-erdd-import-file)). `import` changes **only the files**, so in server mode it
  is followed by `diff` → `push`. To export the server's latest state, put `pull` before `export`.
- **Exchange organization shared dictionaries (words, terms, domains, custom fields) with `erdd dict`.** Receive with
  `dict pull`, and push new words to the shared library with `dict push` after `push`
  (→ [6.11](#611-erdd-dict--shared-dictionaries)). It works only in projects connected to a server.

---

## 5. File structure and format

### 5.1 Directory layout

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

⚠️ **Do not edit anything under `.erdd/`.** It holds the merge baseline and credentials. If it gets damaged, get it
again with `erdd pull`.

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

**`serverUrl` and `projectId` are optional.** If both are missing (or `null`), it is a **local-only project**, which
you open with `erdd serve`. Only the commands that need a server, `pull`, `push`, and `diff`, stop with exit code `1`
in that case (→ [3.4](#34-local-mode--using-it-without-a-server)). ⚠️ **If only one of the two is written, it is
treated as a typo and rejected.** If it were swallowed, you would edit thinking you were connected to the server and
only find out at `push` time that there is no connection. A malformed `dialects` or `namingRules` also exits with `1`.

**`pull` overwrites the dialects and naming rules with the server's values every time.** They live in the project
settings, not the model, but `validate` needs a local copy to produce naming warnings without a server. If you change
these settings on the web, **the local `validate` result may differ from the server until the next `pull`.**

**`tableOptions` are free per-dialect strings appended as is after the closing parenthesis of `CREATE TABLE` when you
export DDL.** Every table gets the same value, and the value is not validated. If you write it wrong, that dialect's
DDL fails, and the failure is immediately visible. **An older config without the key opens with empty strings for all
four dialects** (requiring it would break existing users' `pull`).

⚠️ **`pull` also overwrites `tableOptions` with the server's value.** In a connected project, this field is **a mirror
of the server**. If you edit it locally, the next `pull` erases it, and `push` sends only the model, so it does not go
up to the server either. Change the server-side value on the project settings screen on the web. In a local-only
project, this file is the only source of truth.

⚠️ **Do not write `COMMENT=`.** Options are written before the table comment, so when the DDL is read back, the parser
reads it as the table comment.

**`dictionaries` are shared dictionary subscriptions.** `erdd dict pull --library …` writes an entry the first time it
receives a library, and `erdd dict pull` without arguments processes this list **in the order written**
(→ [6.11](#611-erdd-dict--shared-dictionaries)).

```yaml
dictionaries:
  - id: 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
    name: 플랫폼팀 표준 사전      # for display; the next dict pull rewrites it if the name changes on the server
  - id: 01a0cf70-8bb2-7bf8-9635-821049933b45
    name: 데모 사전
    file: standard.erdd-lib.yaml  # if present, receive from this distribution file instead of the server (erdd dict pull --file)
```

- Without subscriptions, the key itself is not written. A missing key or an empty value (`dictionaries:`) means zero
  subscriptions.
- Subscriptions remain when `pull`, `push`, or `init` (reconnecting to the same project) rewrites the config.
- If the shape is wrong (not a list of `{id, name, file?}`), the exit code is `1`:
  `erdd.config.yaml의 dictionaries는 {id, name, file?} 목록이어야 합니다` ("dictionaries in erdd.config.yaml must be a
  list of {id, name, file?}"). The same id appearing twice is also `1`:
  `erdd.config.yaml의 dictionaries에 같은 사전(<id>)이 두 번 있습니다` ("the same dictionary (<id>) appears twice").
- To end a subscription, delete its line. Items already received and their sources in `origins.yaml` remain.
- **`file` is written the first time `erdd dict pull --file <path>` receives a file.** From then on, `erdd dict pull`
  without arguments also receives from the file at this path instead of the server
  (→ [`--file` in 6.11](#611-erdd-dict--shared-dictionaries)). The path is a POSIX relative path inside the project and
  cannot be under `erdd/`. Without the key, it means the same as a server subscription. This rule is checked again for
  values edited by hand. If it is broken, every command that reads the config, including `dict pull` and `dict list`,
  stops with exit code `1`:
  `erdd.config.yaml의 dictionaries(<id>).file 이 규칙을 어깁니다 — …` ("dictionaries(<id>).file breaks the rule: …").

### 5.3 Table files

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

**Fields.**

| Location | Key | Meaning | If omitted |
|---|---|---|---|
| Table | `id` · `name` · `logicalName` · `group` · `comment` · `custom` | Physical name, logical name, group name, description, custom values | No `id` = new; the rest are empty |
| Column | `id` · `name` · `logicalName` · `domain` · `type` | Names and type | — |
| Column | `pk` | Primary key | `false` |
| Column | `autoIncrement` | Auto-increment | `false` |
| Column | `nullable` | Allows NULL | **`true`** |
| Column | `default` · `comment` · `custom` | Default, description, custom values | None |
| Index | `name` · `columns` | Name and column list | — |
| Index | `unique` | Unique | `false` |
| Relationship | `to` · `columns` | Parent table physical name, column mapping | — |
| Relationship | `name` | Constraint name | None |
| Relationship | `identifying` | Identifying relationship | `false` |
| Relationship | `cardinality` | `1:1` or `1:N` | **`1:N`** |

**Values equal to the default are left out of the file.** `pull` writes them that way, so the diff stays quiet. Writing
them explicitly works the same.

**Four rules.**

1. **Column order is the model's order.** The order written in the file becomes the column order.
2. **Write relationships only in the child table's file.** `to` points to the parent.
3. **Append the direction of an index column after its name.** `MBR_NM` (ascending) · `MBR_NM DESC`. `ASC`/`DESC` are
   case-insensitive, and leaving out ascending is the standard.
4. **Write `type` even when there is a domain.** The model actually holds both. The domain takes priority for the
   effective type, and `type` is a reference value. If you keep only one, the other is lost in the round trip.

**The file name is not the identity.** When the physical name changes, `pull` updates the file name. To rename a table,
edit `name` inside the file, not the file name. If two or more tables have physical names that **differ only in case**
(their file names collide on macOS and Windows), only those tables get the last 8 characters of their id appended, as
in `MBR.1a2b3c4d.yaml`.

### 5.4 Dictionary and definition files

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

### 5.5 Things referenced by name must be unique

References inside the files are written as human-readable **names**. That is why duplicates of the following three are
errors.

| Name | Referenced by | Message on duplicates |
|---|---|---|
| Group name | A table's `group` | `그룹 이름 X가 중복됩니다 — 이름으로 참조되므로 유일해야 합니다` ("Group name X is duplicated. It is referenced by name, so it must be unique") |
| Domain name | A column's or term's `domain` | `도메인 이름 X가 중복됩니다 — …` ("Domain name X is duplicated …") |
| Table physical name | A relationship's `to` | `테이블 물리명 X가 중복됩니다 — 관계가 이름으로 참조하므로 유일해야 합니다` ("Table physical name X is duplicated. Relationships reference it by name, so it must be unique") |

A missing target is also an error: `그룹 X을 찾지 못했습니다` (group X not found), `도메인 X을 찾지 못했습니다` (domain X
not found), `관계의 부모 테이블 X을 찾지 못했습니다` (the relationship's parent table X not found),
`인덱스 컬럼 X을 찾지 못했습니다` (index column X not found).

### 5.6 Handling `id` — the most common accident

- **The `id` (UUIDv7) is the identity.** Do not change or delete it. If the name changes but the `id` stays the same,
  it is recognized as an "edit", not as "delete + add".
- **Do not write an `id` at all for objects you create.** **The CLI issues them, not the server.** In server mode,
  `push` does it (→ [7.4](#74-three-ways-push-does-not-end-normally)), and when you open the project with `erdd serve`,
  the local store generates a uuidv7 and fills it into the file.
- ⚠️ **When you create a new table by copying a file, delete every `id`**: not only the table's, but also those of its
  columns, indexes, and relationships. If you leave them, it becomes **"overwrite the original with the copy's
  content"** instead of "create a new table". When the same `id` appears twice, **`erdd validate` blocks it with exit
  code `1`** (it does not call the server, so this applies in both modes), and in server mode the planning step of
  `diff` and `push` blocks it too.

  ```text
  id 018f…가 erdd/tables/MBR.yaml에도 있습니다 — 복사해서 새로 만든 것이라면 id를 지우세요(그대로 두면 원본을 덮어씁니다)
  ```

  The message says the id is also in `erdd/tables/MBR.yaml`, and that if you created this by copying, you should delete
  the id (leaving it overwrites the original).

- ⚠️ **YAML anchors and aliases (`&name` … `*name`) are not supported.** Two entries would silently merge into one, so
  they are blocked with an error. Expand the alias and write the content out for each entry.

### 5.7 `erdd/layout.yaml` — layout coordinates and notes

**`erdd serve` reads and writes it, regardless of the mode.** If you open a server-connected project with `serve` and
move tables or write notes, this file is created and updated too. However, **it does not travel to or from the server.**
`pull` and `push` neither send nor receive this file (→ [section 8](#8-what-the-files-do-not-hold)).
It is committed, because the layout is part of the diagram your team looks at together.

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

- **Moving a table changes only this file.** Not a single character of `erdd/tables/*.yaml` changes. The files were
  split to keep the original reason for taking coordinates out of the schema files (a diff appearing just from moving
  things).
- **Entries are identified by `id`.** `name` is for people to read and is not used for matching, so the layout follows
  even if you change the physical name. An `id` left over that is not in the model (from a deleted table) is discarded
  silently.
- **If an entry or the whole file is missing, tables fall into a grid sorted by physical name.** A project received
  with `erdd pull` also opens without a coordinates file. Refine it afterward with **자동 정렬** (Auto layout) in the
  editor.
- ⚠️ **If the whole file does not parse, editing is locked, just as for any other `erdd/` file.** The file holds not
  only coordinates but also **the text of notes**, so leaving it open while broken would make the next save erase the
  notes with `notes: []`. A red banner (`파일을 읽을 수 없어 편집이 잠겼습니다 — erdd/layout.yaml: …`, "Editing is
  locked because a file cannot be read") appears, and fixing the file unlocks it
  (→ [3.4](#34-local-mode--using-it-without-a-server)).
- **A single broken entry is different.** Only **that entry**, whose coordinates are not numbers or whose fields are
  missing, is filtered out (that table falls into the grid), and the rest open as is. A missing or empty file is not
  damage either.

### 5.8 `erdd/origins.yaml` — shared dictionary sources

This file records **which library, which item, and which version each item received from a shared dictionary came
from**. `erdd dict pull` and `dict push` write it, and `pull` and `push` exchange it with the server. **It is
committed.**

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

(The comments are for explanation. The actual file has no comments.)

- ⚠️ **Do not edit it by hand.** Editing values in the dictionary files (`words.yaml` and so on) is fine. They then
  differ from `base` and become "items the project changed", and when the source changes, `dict pull` reports a
  conflict. A term's `base.domainId` is **this project's domain id**, not a name (it is a machine file, so it uses ids).
- **If you delete an item from a dictionary file, its source line is silently ignored and cleaned up on the next
  write.** It is not an error.
- **With zero sources, there is no file.** A missing file also means zero sources.
- **If you delete a line from this file and run `push`, the source on the server is dropped too.** The file is the
  truth. That is why `push` mentions it in one line before the confirmation (→ [6.6](#66-erdd-push)). If you did not
  intend it, restore it with `erdd pull`.
- **A wrong format is a file error.** `serve` locks editing, `push` and `dict` refuse, and `erdd validate` points to it.
  The wrong line is reported by its `origins[i]` number.

  | Message | Cause |
  |---|---|
  | `origins[N]의 형식이 올바르지 않습니다 — id·kind·library·item·version(정수)·base(객체)가 필요합니다` ("origins[N] has an invalid format; id, kind, library, item, version (integer), base (object) are required") | A key is missing, `kind` is not one of the four, or `version` is not an integer |
  | `origins[N]가 객체가 아닙니다` ("origins[N] is not an object") | A list element is not an object |
  | `id <id>의 출처가 두 번 적혀 있습니다` ("the source of id <id> is written twice") | There are two lines for the same item |
  | `id <id>의 kind가 word로 적혀 있지만 실제로는 term입니다` ("kind of id <id> is written as word but it is actually term") | `kind` differs from the actual item kind |

---

## 6. Command reference

**Common options.**

| Option | Meaning |
|---|---|
| `--json` | One JSON block on stdout. Progress messages and prompts go to stderr. |
| `--yes` | Skips confirmation prompts (required for non-interactive use). |
| `--strict` | `validate` treats warnings, and `diff` treats conflicts, as failures. It has no effect on other commands. |
| `--help`, `-h` | Help. Always exit code `0`. |
| `--version`, `-v` | Prints only the version string on stdout (`{"version": …}` with `--json`). Exit code `0`. Accepted only in the command position (the first argument). A `-v` after a command is not the version. |

**Exit codes.**

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Failure: validation failure, conflict, server error, user cancellation, missing settings |
| `2` | Usage error: unknown command, missing required argument |

### 6.1 `erdd init`

Connects a server, token, and project. → [3.2](#32-erdd-init)

| | |
|---|---|
| Specific options | `--server <url>` · `--token <token>` · `--project <id>` · `--local` · `--create` · `--org <name\|id>` · `--name <name>` · `--dialect <dialect>` · `--case <UPPER_SNAKE\|lower_snake>` |
| Server calls | `auth.me`, `org.list` and `project.list` (when choosing), `project.get`. `--create` calls `auth.me`, `org.list`, `project.create` |
| Files written | `erdd.config.yaml` · `.erdd/credentials.json` · `.gitignore`. `--create` adds `.erdd/base.json` and `.erdd/sync.json` (an empty baseline) |

**`--local` creates a local-only project without a server connection** → [3.4](#34-local-mode--using-it-without-a-server).
It never calls the server and does not write `.erdd/credentials.json` either (only `erdd.config.yaml` and
`.gitignore`). Unlike the other arguments, **it does not overwrite an existing config, even with `--yes`.**

**`--dialect` and `--case` are only for `--local` and `--create`.** A local-only project has no server to get settings
from, and `--create` must decide the values to create on the server, so only these two are set here. The other naming
rules (`separator`, `logicalSeparator`, `maxLengthBytes`, templates) start at their defaults, and you change them by
editing `erdd.config.yaml` directly.

| Option | Default | Values |
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

⚠️ **Passing these two when connecting to an existing project (without `--local` or `--create`) is a usage error
(`2`)**: `--dialect·--case는 init --local·--create 전용입니다 — 기존 프로젝트에 연결할 때는 서버 프로젝트 설정을 따릅니다`
("--dialect and --case are only for init --local and --create. When connecting to an existing project, the server
project's settings apply"). The server project's dialects and naming rules are the source of truth, so the first
`pull` would overwrite anything given here at once.

#### `--create` — create a project on the server and connect to it

```bash
erdd init --server <url> --token <token> --create --org <organization name|id> --name <project name> [--yes]
```

**Only organization Owners/Admins can do this** (the same people who can create projects on the web). It splits into
three cases depending on the starting state.

| Starting state | What it does |
|---|---|
| No `erdd.config.yaml` | Creates an empty project on the server (`--dialect` and `--case` are the creation values; defaults `postgresql` and `UPPER_SNAKE`) and connects to it. If `erdd/` is empty, it also writes the five empty dictionary files, the same state as pulling an empty server |
| **A local-only config** (`serverUrl: null`): **migration** | After confirmation, creates the server project with the local config's dialects, naming rules, and table options, and rewrites the config with `serverUrl` and `projectId` filled in (subscriptions stay as they are). **It does not touch a single byte of `erdd/`** |
| A config already connected to a server | Refused (`1`), so the existing server project is not orphaned |

**The baseline is an empty model.** It sets up the baseline (`.erdd/base.json`) that `push` requires, without a `pull`,
so if `erdd/` has files (a migration, or a directory that only lacked a config), **the next `erdd diff` shows
everything as additions and `erdd push` uploads it.** The guidance message also differs in that case.

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

For an empty directory, the message suggests starting to edit with `erdd serve`. For a migration, it suggests checking
with `erdd diff` and then uploading with `erdd push`.

- **A migration asks for confirmation**: `이 로컬 프로젝트를 서버 프로젝트 "이관"로 연결합니다. 계속할까요? [y/N]` ("This
  connects the local project to the server project "이관". Continue? [y/N]"). Skip it with `--yes`. Non-interactively
  (`--json`) without `--yes`, it fails with `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` ("Confirmation
  is required. In non-interactive mode (--json), pass --yes as well") (`1`).
- **A migration uploads only saved files.** If `erdd serve` has unsaved edits, `⚠️ 저장하지 않은 편집이 있습니다 — erdd
  serve 화면에서 저장해야 파일에 반영됩니다` ("⚠️ There are unsaved edits. Save on the erdd serve screen to write them to
  the files") appears before the message.
- Right after a migration, `erdd status` may show empty dictionary files that were not in `erdd/` as `-`. Their content
  is an empty list, so they do not affect `diff` or `push`, and one `push` makes them disappear.
- `erdd/layout.yaml` (layout coordinates and notes) does not go up to the server. Lay out the server side anew with
  **자동 정렬** (Auto layout) in the web editor.
- `--org` is an organization name or id. Without it, you choose interactively. Non-interactively, it is a usage error
  (`2`): `--org를 주거나 대화형으로 실행하세요` ("Pass --org or run interactively"). Without `--name`, it asks
  `서버에 만들 프로젝트 이름을 입력하세요` ("Enter the name of the project to create on the server"). A name with only
  whitespace gives `프로젝트 이름이 비었습니다` ("The project name is empty") (`2`).
- If the server is older than the CLI and cannot create projects with a token, it stops with
  `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요` ("The server does not support this feature. Upgrade the
  server") (`1`) and writes nothing locally. Reissuing the token does not help.
- `--create` cannot be combined with `--project` or `--local` (`2`). **During a migration, you cannot pass `--dialect`
  or `--case` either** (`2`): `로컬 프로젝트를 이관할 때는 erdd.config.yaml의 방언·명명 규칙을 씁니다 — --dialect·--case를
  빼세요` ("Migrating a local project uses the dialects and naming rules in erdd.config.yaml. Remove --dialect and
  --case").
- If the local config's naming rules or table options do not fit the server's format, it stops **before calling the
  server** (`1`), pointing to the key, as in `erdd.config.yaml의 namingRules.case가 올바르지 않습니다` ("namingRules.case
  in erdd.config.yaml is invalid"). It also stops before calling the server if YAML in `erdd/` is broken. This avoids
  leaving a half-created server project behind.

**When it is blocked.**

| Situation | Message | Exit code |
|---|---|---|
| No permission (new directory) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 erdd init --project <id> 로 연결하세요` ("No project creation permission. Ask an organization admin to create the project, then connect with erdd init --project <id>") | `1` |
| No permission (migration) | `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요` ("No project creation permission. Ask an organization admin to create an empty project, commit erdd/ to git, and follow the manual procedure in the manual") | `1` |
| Already connected | `이미 서버 프로젝트에 연결돼 있습니다 — 다른 프로젝트로 바꾸려면 erdd init --project <id> --yes` ("Already connected to a server project. To switch to another project, use erdd init --project <id> --yes") | `1` |
| Organization not found | `조직 <이름>을(를) 찾지 못했습니다` ("Organization <name> not found") | `1` |
| Several organizations with the same name | `이름이 <이름>인 조직이 여럿입니다 — id로 지정하세요` ("Several organizations are named <name>. Specify an id") | `2` |

The migration message, when there is no permission, does not suggest connecting with `--project` because that
connection has no empty baseline, so the next `pull` would overwrite `erdd/` with the server's empty state. The manual
procedure is in [local mode manual 7.2](local-guide.md#72-move-a-project-started-locally-to-a-server).

`--json` prints `{ configPath, projectId, projectName, migrated, hasLocalFiles }`. `migrated` tells whether a
local-only config was migrated, and `hasLocalFiles` tells whether `erdd/` had files to upload (that is, whether there is
something to `diff` and `push` next).

### 6.2 `erdd pull`

Downloads the server schema as files. **It overwrites local changes.**

```bash
$ erdd pull
커머스: 테이블 24개를 받았습니다 (리비전 42)
```

The output reports that it received 24 tables for the project 커머스 at revision 42. If there are local changes, it
first shows the list and asks for confirmation ("2 local changes will be overwritten … Continue?").

```text
로컬 변경 2건이 덮어쓰기 됩니다:
  erdd/tables/MBR.yaml
  erdd/words.yaml
계속할까요? [y/N]
```

Declining prints `사용자가 취소했습니다` ("The user cancelled") with exit code `1`. Skip it with `--yes`.
Non-interactively (`--json`) without `--yes`, it cannot ask, so it stops with `확인이 필요합니다 — 비대화형(--json)에서는
--yes를 함께 주세요` ("Confirmation is required. In non-interactive mode (--json), pass --yes as well") (code
`CANCELLED`, exit code `1`).

⚠️ **Even without a baseline (`.erdd/base.json`), it asks if `erdd/` has files.** This happens right after cloning a
repository or right after writing only the connection settings. There is nothing to compare against, so **every** file
in `erdd/` shows as a change to be overwritten. It does not ask only when `erdd/` is empty (a true first `pull`).

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

If the cloned files are the same as the server, receiving with `--yes` loses nothing (after receiving, `erdd status`
reports 「로컬 변경 없음」, no local changes). **If you are attaching a schema created as local-only to a server, do not
`pull`.** If the server is empty, that schema is erased. Use `erdd init --create` (→ [6.1](#61-erdd-init)).

**Files of tables that disappeared from the server are deleted.** The deletion targets are the files in
`erdd/tables/*.yaml` that are not on the server, and those of the five top-level files that the server did not send.

⚠️ **If you interrupt `pull` partway (Ctrl+C and the like), the baseline is left older than the tree.** The next
`status` may misreport untouched files as "local changes". Running `erdd pull --yes` once more makes it converge.

`--json` prints `{ revisionSeq, written, deleted, tables, warnings }`.

**It also receives shared dictionary sources (`erdd/origins.yaml`).** When an import or promotion is done on the web,
or a promotion request is approved, the server items get sources, and the next `pull` writes them to `origins.yaml`
(→ [5.8](#58-erddoriginsyaml--shared-dictionary-sources)).

### 6.3 `erdd status`

**It does not call the server.** It shows only the connection information and local changes.

```bash
$ erdd status
서버   https://erdd.example.com
프로젝트 018f6b0e-0000-7000-8000-000000000001
마지막 pull 리비전 42 (2026-08-14T05:12:33.109Z)
로컬 변경 2건
  + erdd/tables/CPN.yaml
  M erdd/tables/MBR.yaml
```

The lines are the server, the project, the revision of the last pull, and the local changes. In a local-only project
without connection settings, the first two lines change like this ("local-only, no connection settings").

```bash
$ erdd status
서버   (로컬 전용 — 연결 설정 없음)
프로젝트 (로컬 전용)
아직 pull하지 않았습니다
로컬 변경 없음
```

`--json` then prints `"serverUrl": null, "projectId": null`.

⚠️ **In a local-only project, 「로컬 변경 없음」 (no local changes) stays that way forever.** The comparison baseline
`.erdd/base.json` (the last pull point) is never created in the first place, so `status` skips computing changes
altogether. Whatever you changed, it reports 「로컬 변경 없음」 with exit code `0`. **In local mode, you see changes with
`git status` and `git diff`.**

`+` added · `M` modified · `-` deleted. If you have not pulled yet, 「아직 pull하지 않았습니다」 (not pulled yet) appears,
and changes are reported as 「로컬 변경 없음」. The comparison is **by value, independent of key order**, so a file whose
YAML was rewritten with only its key order changed is not counted as modified.

### 6.4 `erdd validate`

Checks only the local files, **without calling the server**. It is a good fit for commit hooks and CI.

```bash
$ erdd validate
정합성 문제 없음
명명 경고 3건
  등록되지 않은 단어가 있습니다: 회원
  등록되지 않은 단어가 있습니다: 회원번호
  등록되지 않은 단어가 있습니다: 회원명
```

The output reports no consistency problems and 3 naming warnings (unregistered words). The check has three stages.

| Stage | What | On failure |
|---|---|---|
| Parsing | YAML structure, duplicate `id`, resolving name references | Exit code `1`, a message per file |
| Consistency | References to tables, groups, or domains that do not exist, and the like | Exit code `1` |
| Naming warnings | The 10 kinds below | `0` by default, `1` with `--strict` |

**Warning kinds** — unregistered word (`unknown-word`), term mismatch (`term-mismatch`), physical name too long
(`too-long`), reserved word (`reserved`), duplicate physical name (`duplicate-physical`, `duplicate-physical-table`),
incomplete relationship mapping (`incomplete-mapping`), relationship type mismatch (`type-mismatch`), required value
empty (`required-empty`), required custom field missing (`custom-required`).

Naming warnings are computed from `namingRules` and `dialects` in `erdd.config.yaml`. If those settings changed on the
server, `pull` first so that the result matches the server.

### 6.5 `erdd diff`

**Previews** the differences between local and server. **It writes nothing.**

```bash
$ erdd diff
올릴 변경 2건
  + 컬럼 MBR.MBR_GRD_CD
  M 테이블 MBR  설명: 회원 → 서비스 가입 회원

내려올 변경 1건
  M 컬럼 ORD.ORD_DT  타입: DATE → TIMESTAMP

충돌 없음
```

The output has three parts: changes to push (올릴 변경), changes to pull (내려올 변경), and conflicts (충돌; here, none).

- **It uses exactly the same merge engine as `push`**, so what you see here and what is actually applied never diverge.
- **It is always a 3-way preview.** There is no "relative to the last pull" mode or `--base` flag.
- **The default exit code is `0`** (informational). With `--strict`, it is `1` when there are conflicts.
- Without a baseline (`.erdd/base.json`), it stops before calling the server with
  `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` ("There is no baseline. Run erdd pull first").

### 6.6 `erdd push`

Applies local changes to the server.

```bash
$ erdd push -m "회원 등급 컬럼 추가"
반영했습니다 (리비전 43, 변경 2건)
```

The output reports that it applied 2 changes as revision 43.

| | |
|---|---|
| Specific options | `-m`, `--message <summary>`: the revision summary (up to 200 characters; longer is truncated) |
| Server calls | `model.get` (plan) → `model.push` (apply) → `project.get` + `model.get` (implicit pull) |

**Without a summary, one is generated automatically**, in the form `CLI push (테이블 1건 · 컬럼 5건)` ("1 table · 5
columns"). `-m ""` is treated the same as giving no value and falls back to the automatic summary.

**If there are deletions, it shows the list and asks for confirmation** ("2 deletions will be applied to the server …
Continue?").

```text
삭제 2건이 서버에 반영됩니다:
  - 컬럼 MBR.MBR_TEL
  - 인덱스 IX_MBR_02
계속할까요? [y/N]
```

If there are **items the merge deletes on your behalf** because their references broke, they are listed separately,
because the reason differs ("3 items cleaned up together because their references broke": the referenced target was
deleted, or the group was deleted so the reference was released).

```text
참조가 끊겨 함께 정리되는 항목 3건:
  - 컬럼 ORD.MBR_NO (참조 대상이 삭제됨)
  - 관계 ORD→MBR (참조 대상이 삭제됨)
  - 테이블 ORD (그룹이 삭제되어 참조를 해제함)
```

⚠️ **Non-interactively (`--json`), if there are deletions, you must also pass `--yes`.** Otherwise it stops like this:
`확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요` ("These changes need confirmation. In
non-interactive mode (--json), pass --yes as well") (exit code `1`).

**If there are changes that detach shared dictionary sources, it mentions them in one line before the confirmation**
(stderr). If you `push` with lines missing from `erdd/origins.yaml`, the sources on the server are dropped too, because
the file is the truth.

```text
공용 사전 출처를 떼는 변경 1건이 포함됩니다 — 의도하지 않았다면 erdd pull 로 되돌리세요
```

The message says 1 change that detaches a shared dictionary source is included, and to revert with `erdd pull` if you
did not intend it. It does not block (the detachment may be intended). `detachedOrigins` in the `--json` success
envelope is that count (it is included even when 0).

**Three things it blocks.**

| Situation | Message | Reason |
|---|---|---|
| Conflict | `충돌 N건 — push를 중단했습니다.` ("N conflicts. push stopped.") | The server stays as it is (→ [section 7](#7-synchronization-and-conflicts)) |
| `erdd/` is entirely empty, but the baseline has files | `erdd/ 아래에 파일이 없습니다. 전체 삭제가 의도라면 파일을 개별로 지우고, 아니라면 erdd pull로 되돌리세요` ("There are no files under erdd/. If you intend to delete everything, delete the files individually; otherwise restore with erdd pull") | An `rm -rf` accident is not interpreted as "delete everything" |
| More than 5,000 changes | `변경이 N건으로 한 번에 반영할 수 있는 5000건을 넘습니다. 나눠서 반영하세요` ("N changes exceed the 5000 that can be applied at once. Apply them in parts") | The cap the server accepts per request; push does not split it |

**On success, it pulls automatically.** New `id`s are filled into the files, and server changes merged automatically
come down too.

### 6.7 `erdd skill install`

Copies the bundled agent skill document into the project. → [section 9](#9-using-it-with-ai-agents)

```bash
$ erdd skill install
스킬을 설치했습니다: /path/to/my-project/.claude/skills/erdd/SKILL.md
```

The output reports where it installed the skill.

| Option | Meaning |
|---|---|
| `--dir <path>` | Installation location (default `.claude/skills/erdd`). `SKILL.md` is placed under it. |
| `--force` | Overwrites an existing file |

If the target already exists and there is no `--force`, it stops with exit code `1`:
`…/SKILL.md가 이미 있습니다. 덮어쓰려면 --force를 쓰세요` ("…/SKILL.md already exists. Use --force to overwrite").
Leaving out the subcommand is a usage error (`2`).

### 6.8 `erdd serve`

Starts a local server to edit in the browser. **No server connection is needed** → [3.4](#34-local-mode--using-it-without-a-server).

```bash
$ erdd serve --no-open --port 4399
http://127.0.0.1:4399 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

| | |
|---|---|
| Specific options | `--port <number>` (default `4300`) · `--no-open` (does not open the browser automatically) |
| Binding | **Fixed to `127.0.0.1`.** It is a server without authentication, so no option exposes it to the LAN |
| Host check | If `Host` is not of the `127.0.0.1:<port>` or `localhost:<port>` kind, the response is **403**. Other names (private DNS, `/etc/hosts` aliases, reverse proxies) do not reach it. Binding alone cannot prevent **DNS rebinding** (an attacker's page reading and writing this server through the browser) |
| Web bundle | **Serves a prebuilt bundle as static files.** There are two candidates, and **it looks at the repository's `apps/web/dist` first**. If it exists, it wins; otherwise it falls back to `web/` inside the package (the copy bundled in a registry install). An installed copy cannot have the repository candidate, so the bundled copy is always used. In the repository layout, if neither exists, the server starts but the browser shows only a JSON 404. Run `pnpm -C apps/web build` (→ [local mode manual 2.3](local-guide.md#23-path-b-erdd-repository-checkout--build-the-web-bundle-once)) |
| Server calls | None. It reads and writes only `erdd.config.yaml` and the `erdd/` files |
| Files written | `.erdd/draft.json` (on every edit) · `erdd/**` and `erdd/layout.yaml` (**only when you click 저장 (Save)**) · `erdd/snapshots/` (snapshots) · `erdd.config.yaml` (when settings are saved) |

- **It does not start without `erdd.config.yaml`**: `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요`
  ("erdd.config.yaml not found. Run erdd init first") (exit code `1`). Create it with `erdd init --local`.
- **It also starts in a project with connection settings.** In that case it opens with the config's `projectId`, and
  otherwise with a fixed id (`00000000-0000-7000-8000-000000000000`). It does not change between runs, so you can
  bookmark the address. Going to `/` takes you to that project's screen.
- **If the port is already in use, it stops instead of picking the next port automatically** (exit code `1`). This
  keeps an agent that assumes a fixed port from attaching to someone else's server.

  ```text
  오류: 포트 4399이 이미 사용 중입니다. --port로 다른 포트를 지정하세요
  ```

  The message says port 4399 is already in use and asks for another port with `--port`.

- Passing a non-integer to `--port`, or leaving out its value, is a usage error (`2`):
  `--port 값이 올바르지 않습니다: abc` ("invalid --port value: abc").
- **Stop it with `Ctrl+C` (SIGINT, SIGTERM).** Before exiting, it flushes pending **draft** writes, so coordinates you
  just moved and notes you just created are kept.
- If it cannot open the browser (no launcher, without `--no-open`), it prints only `브라우저를 열지 못했습니다. 직접 … 을
  여세요` ("Could not open the browser. Open … yourself") and the server keeps running.

### 6.9 `erdd export`

Exports the local files as DDL or DBML. **It does not call the server.** Like `validate`, it is a pure file path
(`erdd/` → model → DDL). Even in server mode, the **local files** are the source, so to export the server's latest
state, run `erdd pull` first.

| Option | Default | Meaning |
|---|---|---|
| `--format <ddl\|dbml>` | `ddl` | Output format. Other values are a usage error (`2`) |
| `--dialect <dialect>` | `dialects[0]` of `erdd.config.yaml` | Values outside `DIALECTS` are a usage error (`2`) |
| `-o <path>` | (none = stdout) | File to write. Parent directories are created |

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

With `-o`, the CLI reports the path it wrote (`…에 ddl을 썼습니다`, "wrote ddl to …").

⚠️ **Only the output body goes to stdout.** Export warnings and dialect notices all go to **stderr**, because
`erdd export > schema.sql` is the main use of this command, and a single stray line would break the file.

```bash
$ erdd export --dialect postgresql > schema.sql
알림: postgresql는 erdd.config.yaml의 dialects에 없습니다(mysql). 그대로 내보냅니다
#  ↑ stderr; schema.sql gets only the DDL
```

The notice says postgresql is not in the config's dialects (mysql), and that it exports anyway.

- ⚠️ **The DBML `Project` name is the working directory name** (`my-project` in the example above). The name itself is
  for display, but **that block carries the dialect**. `database_type` is the dialect `erdd import` reads (the detection
  table in [6.10](#610-erdd-import-file)), so without this block, the dialect falls back to the receiving side's
  `config.dialects[0]` when it is read back. Exporting from the filesystem root leaves the name empty and drops the
  block.
- **A dialect not in `config.dialects` is still exported if it is valid.** Needing DDL for another DB as a one-off is a
  normal use, so it is not blocked. Instead, one line goes to stderr, as above.
- Export warnings (tables without columns or with an empty physical name are excluded) also go to stderr as
  `경고: …` ("warning: …"). With `--json`, they are also included in the `warnings` array.
- If the local files have parse errors, it exits with `1` **in the same envelope as `validate`**.

### 6.10 `erdd import <file>`

Imports a DDL or DBML file into the local file tree. **It takes the same path as DDL·DBML 가져오기 (Import DDL/DBML) in
the web editor**, so the behavior is the same.

| Option | Default | Meaning |
|---|---|---|
| `--format <ddl\|dbml>` | Decided by extension | `.sql`, `.ddl` → ddl; `.dbml` → dbml |
| `--dialect <dialect>` | The detection order below | Values outside `DIALECTS` are a usage error (`2`) |
| `--dry-run` | — | Shows only the plan and **touches no files at all** |
| `--yes` | — | Skips the confirmation before writing |

**Format detection**: `--format` > extension > **otherwise a usage error (`2`)**. It does not guess from the content,
because reading with the wrong parser would catch no tables and end quietly with "imported 0".

```bash
$ erdd import dump.txt
오류: dump.txt의 형식을 확장자로 정할 수 없습니다 — --format ddl 또는 --format dbml을 주세요(확장자는 .sql·.ddl이면 ddl, .dbml이면 dbml입니다)
$ echo $?
2
```

The error says the format of `dump.txt` cannot be decided from its extension, and asks for `--format ddl` or
`--format dbml`.

**Dialect detection differs by format.**

| Format | Order |
|---|---|
| DDL | `--dialect` > detecting characteristic tokens in the body (`detectDialect`) > `config.dialects[0]` |
| DBML | `--dialect` > `Project { database_type }` > `config.dialects[0]` |

⚠️ **Body token detection is not used for DBML.** DBML's attribute syntax (`[pk, increment, …]`) **always** hits the
detector's mssql bracketed-identifier signature, so running it would read any DBML as mssql (measured on 2026-09-03).
What was chosen and why appears in the first line of the output and in `dialectSource` in `--json`.

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

The first line gives the format, the dialect and where it came from (detected in the body, or the `Project`'s
`database_type`), and what will be added. `--dry-run` reports that it wrote no files. `--yes` reports how many files it
wrote and suggests `erdd push`.

⚠️ **It merges. It does not overwrite.**

- **Tables whose resulting name already exists are skipped.** The existing table's `id` and content stay as they are.
  **It does not update them.** Skipped names appear in the `table-conflict` warning and in `skipped` in `--json`.
- Existing tables that are not in the imported file are **not deleted.**
- `id`s for new entities are issued as `uuidv7` on the spot and **written into the files right away** (the same
  convention as `push`).

**It also looks at table options.** From the trailing clause, it extracts only `ENGINE`, `DEFAULT CHARSET`
(`CHARACTER SET`), and `COLLATE` and normalizes them into one line. If tables differ, **the most frequently used value
is adopted** (on a tie, the one that appears first in the DDL). The `AUTO_INCREMENT=` start value, `ROW_FORMAT`, and
partitions are per-table or out of scope, so they are discarded. Tables without options do not vote, so that a dump in
which half the tables omit them does not lose the value that is there.

There are three rules for applying it to that dialect's field in `erdd.config.yaml`.

| Current value of that dialect's field | Behavior |
|---|---|
| Empty | **Applies it** |
| Same as the adopted value | Nothing happens |
| Has a different value | **Does not apply it, and reports it** (a value you set is not overwritten silently) |

To change the value, edit `erdd.config.yaml` directly. There is no overwrite flag. The adopted value and whether it was
applied appear in the human-readable output and in `tableOptions` and `tableOptionsApplied` in `--json`.

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

The warnings report that unsigned was dropped from `DECIMAL(10,2)`, and that `ORD_LOG`'s table options differ from the
adopted value, which is used instead. The next line reports that the adopted value is applied to the mysql field of
`erdd.config.yaml`.

⚠️ **In a connected project, it does not reach the server.** In that case the output mentions it in one line
(`(서버 프로젝트 설정에는 반영되지 않습니다 — 다음 erdd pull 이 이 값을 덮어씁니다)`, "This is not applied to the server
project settings. The next erdd pull overwrites this value"). Change the server value on the project settings screen on
the web.

⚠️ **Unsigned attached to anything other than the three integer types is dropped with an `unsigned-dropped` warning.**
Only `SMALLINT`, `INT`, and `BIGINT` can be unsigned (MySQL 8.0.17 deprecated `UNSIGNED` for `DECIMAL`, `FLOAT`, and
`DOUBLE`, and its own documentation recommends `CHECK` instead).

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

**It sends nothing to the server.** It does not touch `.erdd/base.json` or `sync.json`, so the imported result appears
as **local changes** in `erdd status`. Applying it is `erdd diff` → `erdd push`, as usual.

⚠️ **Table file names are rewritten based on physical names.** This is the same behavior as `pull` (`writeTree`
normalizes them to `<physical name>.yaml`). File names a person chose by hand are changed after this command.

**Confirmation prompt.** Unless it is `--dry-run` or `--yes` is given, it asks before writing. Non-interactively
(`--json`), it cannot ask, so it says what to do and stops ("Files will be overwritten. In non-interactive mode
(--json), pass --yes as well").

```bash
$ erdd import ../a/schema.sql --json
ddl · 방언 mysql(본문에서 감지) · 추가 2개 테이블(컬럼 5 · 인덱스 1 · 관계 1)
{"error":{"code":"CANCELLED","message":"파일을 덮어씁니다 — 비대화형(--json)에서는 --yes를 함께 주세요"}}
$ echo $?
1
```

**Unsigned and table options survive the round trip.** MySQL's `INT UNSIGNED` is a first-class property of the
logical type, so it stays in the model as is, and the table options (`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`) go into
`tableOptions` in `erdd.config.yaml` (→ [5.2](#52-erddconfigyaml)). An actual round trip:

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

The integer display width (`int(11)`, `smallint(5)`) is read and **discarded**. It is a display-only value, deprecated
since MySQL 8.0.17, so there is no reason to restore it. The same goes for `ZEROFILL`.

Exporting to another dialect turns unsigned into `CHECK` (that dialect has no unsigned type). The warning says
postgresql has no unsigned type, so `CHECK (column >= 0)` is used instead, and notes that the upper bound
4,294,967,295 exceeds integer (2,147,483,647):

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

⚠️ **That `CHECK` is not read back.** The parser does not look at inline column `CHECK`s, so importing the PostgreSQL
dump again gives a plain `INT`. Unsigned round-trips through the text **only in MySQL DDL**.

### 6.11 `erdd dict` — shared dictionaries

Exchanges organization and global **shared dictionary libraries** (words, terms, domains, custom fields) with local
files. Creating libraries, managing their items, and approving promotion requests happen on the web
([user guide section 13](user-guide.md#13-shared-resources)).

```bash
erdd dict list                                        # libraries visible to this project
erdd dict pull --library "플랫폼팀 표준 사전"          # first receive; adds a subscription
erdd dict pull                                        # from then on, all subscriptions
erdd push -m "…"                                      # push new words to the storage (server project) first, then
erdd dict push --library "플랫폼팀 표준 사전" -m "…"   # push them to the shared library (a promotion request without permission)
erdd dict requests                                    # this project's promotion requests and their results
```

**It works only in projects connected to a server.** In a local-only project, it stops like this (`1`). The message says
the project is not connected to a server and suggests connecting with `erdd init --server <url> --create`.

```text
오류: 서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 (erdd.config.yaml)
```

| Command | Server calls | Files written |
|---|---|---|
| `dict list` | `resource.library.listForProject` | None |
| `dict pull` | `resource.library.listForProject`, `resource.items.list` | The four dictionary files (`words`, `terms`, `domains`, `custom-fields`), `origins.yaml`, `erdd.config.yaml` (subscriptions) |
| `dict push` | The two above + `model.get`, `resource.promote` or `promotion.create` | For a direct promotion, the same as `pull` (implicit pull) |
| `dict requests` | `resource.library.listForProject`, `promotion.listForProject` | None |

#### `erdd dict list`

```bash
$ erdd dict list
  표준 사전(예시) — 전역 · 항목 14 · 쓰기 가능 · 01a0cc5e-c4a0-7402-b99c-fd41fb2cb350
* 플랫폼팀 표준 사전 — 조직 · 항목 5 · 쓰기 가능 · 01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341
```

Each line gives the library name, its tier (전역 global / 조직 organization), the item count (항목), whether you can write
to it (쓰기 가능), and its id.

- A leading `*` marks a subscription (`dictionaries` in `erdd.config.yaml`).
- **With 쓰기 가능 (writable), `dict push` promotes directly; without it, it becomes a promotion request.** Organization
  libraries can be written only by organization Owners/Admins, and global libraries only by service admins.
- With no visible libraries, it prints `이 프로젝트에서 보이는 라이브러리가 없습니다` ("No libraries are visible to this
  project").

#### `erdd dict pull`

Receives library items into **local files**. The first time it copies everything, and from then on it is a **resync**
(3-way). It runs the same calculation as **가져오기** (Import) on the web, against the local files. **It does not touch
the server project.** What you receive goes up to the storage at the next `erdd push`.

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

The summary line counts added (추가), auto-updated (자동 갱신), linked (연결), and kept (유지) items. The last line lists
the files it applied (반영했습니다), or reports that no file changed (바뀐 파일이 없습니다).

- **`--library <name|id>`** — Receives only that library, and adds it to the subscriptions if it is not there. If the
  name matches several, it shows the candidates and stops (`2`): `이름이 <이름>인 라이브러리가 여럿입니다 — id로
  지정하세요` ("Several libraries are named <name>. Specify an id"). If none matches:
  `라이브러리 <이름>을(를) 찾지 못했습니다 — erdd dict list 로 확인하세요` ("Library <name> not found. Check with erdd
  dict list") (`1`).
- **Without arguments, it processes all subscriptions in the order written.** Without subscriptions:
  `구독한 라이브러리가 없습니다 — --library <이름|id> 로 지정하세요 (목록: erdd dict list)` ("No subscribed libraries.
  Specify one with --library <name|id> (list: erdd dict list)") (`2`).
- If a subscribed library disappeared or you lost permission, it **skips only that one** and receives the rest (stderr:
  `경고: 라이브러리 <이름>(<id>)을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`, "warning: library … cannot
  be found and is skipped; it was deleted or you lack permission"; the report says `<이름> — 찾을 수 없어
  건너뛰었습니다`). The subscription is not removed.
- **`--dry-run`** — Shows only the plan and writes neither files nor the config. The last line is `미리보기입니다 — 파일을
  쓰지 않았습니다` ("This is a preview. No files were written").
- **If nothing changed when you run it again, it writes no files at all** (`바뀐 파일이 없습니다`).
- Table and group files unrelated to the dictionaries are not touched. Dictionary items a person wrote without an `id`
  get one from this command (the same as `push` fills them in).
- If the local files are broken, it refuses (`1`, with a message telling you to check with `erdd validate`).
- It is fine if `erdd serve` is running; the file watcher picks it up. If there are unsaved edits, the
  **파일이 밖에서 바뀌었습니다** (The files changed from outside) banner appears on screen.
- **The resync is based on the files (saved values).** If `erdd serve` has unsaved edits, `⚠️ 저장하지 않은 편집이
  있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다` ("⚠️ There are unsaved edits. Save on the erdd serve screen to
  write them to the files") appears on stderr first. It is only a notice, so the decisions, exit code, and `--json`
  envelope stay the same.

**What happens to each item: the defaults match the default selection of 가져오기 (Import) on the web.**

| State | Meaning | Default | Option that changes it |
|---|---|---|---|
| 추가 (Add) | A source item that is not local | Receives it | — |
| 자동 갱신 (Auto update) | Not changed locally since it was received, but the source changed | Changes it to the source value | — |
| 충돌 (Conflict) | Changed locally, and the source changed too | **Defer** (the file is not changed, and it is reported again next time) | `--conflicts theirs` (apply source) · `--conflicts ours` (keep local; records that you reviewed this change so it does not appear again) |
| 이름 중복 (Duplicate name) | A local item with the same name as the source already exists (no source) | **Skipped** | `--adopt`: links the source to that local item if the content is the same. If the content differs, it links only with `--adopt --conflicts ours` (below) |
| 유지 (Keep) | Already up to date, or a project-only item | Unchanged | — |
| 원본에서 사라짐 (Gone from source) | The source item was deleted | Left in place locally | — |

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

A conflict line has the form `kind name  (changed field keys)`. The fields are the file's key names as is, and the
before and after values are not shown. The header reads `충돌 N — 보류` (deferred) by default, `충돌 N — 원본 반영` (source
applied) with `--conflicts theirs`, and `충돌 N — 로컬 유지:` (local kept) with `--conflicts ours`.

**`--adopt` — when a project that started locally and already has its own words joins a dictionary.**

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

The first run reports 1 duplicate name, skipped, that `--adopt` would link. The second run links it.

- **Linking does not change content; it only attaches the source.** The link targets are local items of the same kind
  and the same name (ignoring leading and trailing spaces) that **have no source yet**. Custom fields must also have the
  same target (`target`). Duplicate names that cannot be linked are counted separately: `이름 중복 N — 연결할 수 없음 (같은
  이름 항목을 다른 원본이 차지했거나 커스텀 항목의 적용 대상이 다릅니다)` ("N duplicate names cannot be linked; another
  source already holds the item with that name, or the custom field's target differs").
- **Only items with the same content are linked.** If an item were linked with different content, it would become "a
  linked item that differs from the library value", and the next `dict push` would **select it as a source update by
  default**. That would overwrite a library value nobody ever looked at with this project's value. So duplicate names
  with different content are not linked even with `--adopt`, and are shown with the differing fields.

  ```bash
  $ erdd dict pull --adopt
  플랫폼팀 표준 사전 (조직)
    추가 0 · 자동 갱신 0 · 연결 0 · 유지 5
    이름 중복 1 — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)
      단어 고객  (abbreviation)
  바뀐 파일이 없습니다
  ```

  The line says 1 duplicate name was not linked because the content differs, and that `--adopt --conflicts ours` links
  it while keeping the local value. Item lines have the same `kind name  (differing field keys)` form as conflict lines.
  This line also appears when you run without `--adopt`. **`건너뜀 (--adopt 로 연결)` (skipped, link with --adopt)
  counts only the items that `--adopt` would actually link.** The line order is `충돌` (conflict) → `건너뜀` (skipped) →
  `내용이 달라 연결하지 않음` (not linked, content differs) → `연결할 수 없음` (cannot link) → `원본에서 사라짐` (gone
  from source).
- A term is treated as having different content if the domain it points to is neither linked nor added this time (for
  example, that domain was not linked because its content differs). The field shows as `domainId`. Sort out the domain
  first, and the term links along with it.
- **When the content differs, choose which value to align to.**

  | What you want | How |
  |---|---|
  | Link while keeping the local value | `erdd dict pull --adopt --conflicts ours`. This counts as agreeing to keep the local value, and links the item. Afterward, `push` → `dict push` sends this value up as a source update (you overwrite the source value **after seeing it**) |
  | Change to the source value | Delete the local item and run `erdd dict pull` again. The duplicate name disappears, and the item comes in as an addition. For items that other files reference by name, such as domains, deleting them breaks the files and `dict pull` refuses, so change the fields in parentheses to the source values and run `--adopt` (the content becomes the same and it links) |

  `--conflicts theirs` does nothing in this case. It neither links nor changes the value to the source value.
- An item linked with `--adopt --conflicts ours` is a "locally changed item" whose local value differs from the source,
  so when the source changes later, it is reported as a **conflict**, not an auto update (the local value is not
  overwritten silently).

**`--file <path>` — receive from a file the server exported. No server connection is needed.**

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

- **It works even in projects not connected to a server (local-only).** `--library` needs a connection because you
  choose from the server's list, but `--file` only reads that file as is and does not call the server
  (→ [local mode manual 7.3](local-guide.md#73-use-shared-dictionaries--erdd-dict)).
- **The file must be a distribution file.** Like a file the server exported, it must have `library.id`, item `id`s, and
  `version`s. A source file written by a person, or the Excel that `library import` and web import accept, cannot be
  used here (`1`). The error says only files exported by the server can be received, and lists what is missing.

  ```text
  오류: <경로>: 서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) — 오류 N건
    library.id — 배포 파일에는 필수입니다 — 서버에서 내보낸 파일만 받을 수 있습니다
    …
  ```

- **The first time you receive it, the library is recorded in the config as a file subscription**
  (`dictionaries[].file` in `erdd.config.yaml`, → [5.2](#52-erddconfigyaml)). `erdd dict pull` without arguments reads
  that path again. If you get a new version of the distribution file and overwrite it in place, the next `dict pull`
  sees the change. **Passing `--file` again with the same library id turns that subscription line into a file
  subscription** (even if it was a server subscription).
- **A file for a different library than the subscription points to is refused** (`1`). The error says the file for the
  subscription is a different library, and to remove the subscription line and receive again with `--file` to switch.

  ```text
  오류: 구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<다른 id>)입니다 — 다른 라이브러리로
  바꾸려면 구독 줄을 지우고 --file 로 다시 받으세요
  ```

  To switch to another library, delete that subscription line from `erdd.config.yaml` and receive again with `--file`.
- **Every other decision (add, auto update, conflict, duplicate name, `--adopt`) is exactly the same as for a server
  subscription.** Follow the table and rules above as is. `--library` and `--file` cannot be given together
  (`--file 과 --library 는 함께 쓸 수 없습니다`, "--file and --library cannot be used together", `2`).

#### `erdd dict push`

Pushes dictionary items created locally to a shared library. The decisions and writes are made by **the server's
promotion engine**, using **the values in the server project (storage)**. It is the same calculation as **조직으로 승격**
(Promote to organization) on the web.

**Prerequisite: bring the storage up to date with `erdd push` before pushing.** What gets promoted is the value on the
server, so if a value you changed locally is not on the server, **the storage's old value goes up, not the value you
were looking at.** So it checks two things and stops (`1`).

| Situation | Message | What to do |
|---|---|---|
| There are local changes you have not pushed | `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` ("There are local changes you have not pushed. Update the storage with erdd push first") | `erdd push` |
| The server changed after the last pull | `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` ("The server moved ahead after the last pull. Receive with erdd pull and run again") | `erdd pull` (there are no local changes, so nothing is lost) |
| There is no baseline | `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` ("There is no baseline. Run erdd pull first") | `erdd pull` |

**Unsaved edits in `erdd serve` do not go up.** If there are any, `⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서
저장해야 파일에 반영됩니다` appears on stderr first (it is only a notice and does not stop). To push those edits too, save
them on screen, then run `erdd push` → `dict push`.

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

The plan list (`+` new, `~` source update, `=` same name found; the parentheses list the fields that differ from the
library value) and the confirmation question go to stderr, and the one-line result (승격했습니다, promoted) goes to stdout.

**If a term's domain is not in the library and is not pushed along with it, the library term's domain link is left
empty.** A mark is added at the end of that term's line. The decision is based on **the final selection** after filters
that make it easy to leave out the domain, such as `--kind term`, `--name`, and the exclusion of items where the source
is ahead (below) (the same decision as the **도메인 연결 비움** (Domain link cleared) badge in **조직으로 승격** on the
web).

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --kind term
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 용어 주문금액  (도메인 연결 비움 — 금액을(를) 함께 올리면 연결됩니다)
계속할까요? [y/N]
```

The mark says the domain link will be empty, and that pushing the domain 금액 along with it keeps the link. To keep the
link, decline and push the domain along with it (`--kind domain,term`, or add the domain name to `--name`).

| Area | Meaning | Default |
|---|---|---|
| 신규 추가 (New) | Items the library does not have | Sent |
| 원본 갱신 (Source update) | Pushes this project's values to library items it is already linked to | Sent, **except items whose library source changed after the last `dict pull`** (below) |
| 동명 발견 (Same name found) | The library has a different item with the same name | **Not sent**. Include them with `--include-name-match` (that item is updated with this project's value and linked) |

- Narrow the items to push with **`--kind <kind,…>`** (`domain`, `word`, `term`, `customField`) and **`--name <name>`**
  (repeatable). `동명 발견 N` in the summary is counted after these filters.
- If there is nothing to push, it prints `올릴 항목이 없습니다` ("Nothing to push") (`0`). If no item matched `--name`,
  or same-name items were excluded, stderr also shows `--name 에 맞는 항목이 없습니다: <이름, …>` ("No item matches
  --name: …") / `동명 발견 N건은 제외했습니다 — 올리려면 --include-name-match` ("Excluded N same-name items. To push them,
  use --include-name-match").
- Skip the confirmation with `--yes`. Non-interactively (`--json`), `--yes` is required:
  `확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요` (`1`).
- `--library` is required (`--library <이름|id> 가 필요합니다`, "--library <name|id> is required", `2`).

**Items whose library source changed after the last `dict pull` are not pushed.** If someone else edited that library
item after you received it (the library version is greater than the `version` in `origins.yaml`), this project's value
is **older than that person's new value**. Even if you did not touch it locally, the values differ, so it counts as a
source update, and pushing it as is would revert the edited source to the old value. So such items are left out of the
selection **even if you name them with `--name`**, and are reported separately after the plan list (before the
confirmation question).

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --yes
신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
  + 단어 결제
라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 2건은 제외했습니다 — erdd dict pull 로 먼저 받으세요
  ~ 단어 고객  (abbreviation)
  ~ 단어 번호  (abbreviation)
승격했습니다 — 신규 1 · 갱신 0
```

The notice says 2 items whose library source changed after the last `dict pull` were excluded, and to receive them with
`erdd dict pull` first.

**To push such items, receive them with `erdd dict pull` first.** Items not touched locally become the source value
through auto update, so there is nothing left to push, and items also changed locally are deferred as conflicts. If
pushing the local value to the shared library is what you intend, sort it out with `--conflicts ours` and then run
`push` → `dict push`. It then goes up as a source update (because you overwrite the source's latest value **after seeing
it**).

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

If the exclusions leave nothing to push, it prints `올릴 항목이 없습니다` (`0`), and the two exclusion notice lines still
appear on stderr.

⚠️ **Exit code `0` does not mean "it went up".** If the CLI-side selection (excluding items where the source is ahead,
excluding same-name items, `--name` not matching) leaves nothing to push, it ends with `0` without calling the server.
"Everything skipped" ending with exit code `1` happens only when **the server** skipped everything after confirmation
(below). For scripts and agents to decide whether anything went up, look at `selected: 0` (there was nothing to push)
and `behind` (items excluded because the source was ahead) in `--json` (→ [10.1](#101---json-conventions)).

**The result depends on your permission**: 쓰기 가능 (writable) in `erdd dict list`.

- **Writable → it promotes directly.** The server recalculates after confirmation and skips only the items that drifted
  in the meantime. On success, it automatically runs `pull` and receives `erdd/origins.yaml` (newly pushed items get a
  source).
  - Skipped items are listed as `  건너뜀 단어 주문 (그 사이 계획이 바뀜)` ("skipped word 주문 (the plan changed in the
    meantime)") (or `(대상이 사라짐)`, "the target disappeared"), and the exit code is `0`. **If everything was skipped**,
    it prints `승격된 항목이 없습니다 — 전부 건너뛰었습니다` ("No items were promoted. Everything was skipped") with `1`.
  - If the promotion succeeded but the automatic `pull` failed, it prints `승격했습니다 — 신규 N · 갱신 M. 파일 갱신에
    실패했습니다 — erdd pull을 실행하세요 (<사유>)` ("Promoted: N new · M updated. Updating the files failed. Run erdd pull
    (<reason>)") (`1`). **Do not run `dict push` again; run `erdd pull`.** If you edited local files while it was
    waiting for confirmation, the reason is `확인하는 사이 로컬 파일이 바뀌어 덮어쓰지 않았습니다` ("Local files changed
    during confirmation, so they were not overwritten").
- **Not writable + organization library → it creates a promotion request.** `-m` is the request note. Local files do
  not change.

  ```bash
  $ erdd dict push --library "플랫폼팀 표준 사전" -m "스모크 요청" --yes
  신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)
    + 단어 주문
  승격 요청을 만들었습니다 (1건). 조직 관리자가 웹에서 승인하면 반영됩니다
  ```

  The last line says a promotion request was created (1 item), and that it takes effect when an organization admin
  approves it on the web. If items were deleted in the meantime, the second line gets `(N건은 그 사이 사라져
  빠졌습니다)` ("N items disappeared in the meantime and were left out"). **When it is approved, the server items get
  sources, and the next `erdd pull` brings them into `origins.yaml`.** Only the server changed, so there is no conflict.
- **Not writable + global library → it refuses before calling the server** (`1`):
  `전역 라이브러리로는 승격을 요청할 수 없습니다 — 서비스 관리자만 전역 라이브러리에 올릴 수 있습니다` ("You cannot request
  promotion to a global library. Only service admins can push to global libraries").

#### `erdd dict requests`

Shows this project's promotion requests, oldest first. Dates are local dates.

```bash
$ erdd dict requests
[승인] 2026-09-23 플랫폼팀 표준 사전 — 1건 · 멤버
  메모: 스모크 요청
  처리 메모: 승인 — 스모크
```

- The status is `[대기]` (pending), `[승인]` (approved), `[반려]` (rejected), or `[취소]` (cancelled). The **processing
  note** (처리 메모; the approver's reason, including rejection reasons) is not on the web project screen, but you can see
  it here. 메모 is the request note.
- Filter with `--status pending|resolved|rejected|cancelled`. With no requests, it prints `승격 요청이 없습니다` ("No
  promotion requests").
- Cancelling and approving requests happen on the web. The names of the requested items are not shown (only the count).

### 6.12 `erdd library` — library management

Exports and imports shared libraries **as files** (`.erdd-lib.yaml`, `format: erdd-library`). Only people with write
permission on the library (organization Owners/Admins; for global libraries, service admins) can import, and anyone who
can read a library can export it. The decision rules for import are in 「파일 내보내기·가져오기」 (File export and import)
in [../../guides/shared-resources.md](../../guides/shared-resources.md).

**It runs without a project.** It is a command admins call from an empty directory or CI. The server address is
`--server <url>`, or, without it (when run inside a server-connected project), `serverUrl` in `erdd.config.yaml`. If
neither is available, it stops (`2`). The message says a server address is needed, and to pass `--server <url>` or run
it in a server-connected project.

```text
오류: 서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요
```

The token is looked up in the same order as the other commands (`ERDD_TOKEN` → `.erdd/credentials.json`).

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

It goes through every organization the token belongs to and collects the global and organization libraries. Without
쓰기 가능 (writable), `library import` refuses that library. With no visible libraries, it prints
`볼 수 있는 라이브러리가 없습니다` ("No libraries are visible").

#### `erdd library export <name|id> [-o file]`

```bash
$ erdd library export "표준 사전(예시)" -o standard.erdd-lib.yaml --server http://127.0.0.1:3001
내보냈습니다 — standard.erdd-lib.yaml
```

The output reports the file it exported to.

- Without `-o`, it writes to stdout (one JSON envelope with `--json`).
- If there were terms pointing to a deleted domain (they are exported without a domain), stderr shows
  `삭제된 도메인을 가리키던 용어 N건은 도메인 없이 내보냈습니다` ("N terms that pointed to a deleted domain were exported
  without a domain").
- If the name matches several or the library cannot be found, the error text is the same as `dict pull`
  (→ [6.11](#611-erdd-dict--shared-dictionaries)), except that the suggested command is `erdd library list`. For example:
  `라이브러리 없는사전을(를) 찾지 못했습니다 — erdd library list 로 확인하세요` (`1`).
- Calling it without `<name|id>` gives `사용법: erdd library export <이름|id> [-o 파일]` ("usage: …") (`2`).

#### `erdd library import <file> (--library <name|id> | --create <name> --scope <global|org>)`

Reads a library file, a source file written by hand, or Excel (`.xlsx`; the headers are the same as
[Excel dictionary import in user guide section 16](user-guide.md#excel-dictionary-import)), and applies it to an existing
library or to a new library it creates. **Exactly one of `--library` and `--create`** is required. With neither or both,
it prints `--library 와 --create 중 정확히 하나를 주세요` ("Pass exactly one of --library and --create") (`2`).

| State | Meaning | Default | Option that changes it |
|---|---|---|---|
| 추가 (Add) | Items the library does not have | Applied | — |
| 갱신 (Update) | Changes already-matched items to the file's values | Applied | — |
| 그대로 (Unchanged) | The file and library values are the same | Not touched | — |
| 오래된 파일 (Stale file) | Matched by item id, and the file's `version` is lower than the server's (the server moved ahead after it was exported from this library) | **Skipped** | `--include-stale`: overwrites the server's new value with the file's old value |
| 파일에 없음 (Not in file) | An existing item missing from a kind the file mentions (even as an empty list). If the kind itself is not in the file, it is not a target | **Kept** | `--prune`: deletes it (domains that remaining items point to are not deleted; a warning appears) |

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

The summary counts added, updated, unchanged, and deleted items. The first run keeps 1 item not in the file because
there is no `--prune`, and skips 1 stale item (server v2, file v1). The second run, with `--prune --include-stale`,
deletes it and overwrites the stale item. Both are previews that apply nothing.

- **`--dry-run`** — Shows only the plan and writes nothing.
- **`--yes`** — Applies right away without a preview. The result line does not get 「반영했습니다」 (applied) (the path
  that goes through confirmation does). Judge whether it applied from the exit code (`0`) and the summary numbers above.
- **Without `--yes` or `--dry-run`**, it shows the plan, asks once with `가져올까요? [y/N]` ("Import? [y/N]"), and on
  yes, prints the same summary followed by `반영했습니다`.

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

  **If someone else applied first while it was waiting for this confirmation**, it is refused with `CONFLICT`
  (`미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요 — 아무것도 반영하지 않았습니다`, "The library changed
  after the preview. Preview again. Nothing was applied", `1`). Run it again and start from the new preview. The `--yes`
  path, which applies right away without a preview, has no such check.
- **`--create <name> --scope <global|org>`** — Creates a new library and applies the whole file as additions (this is a
  different command from `init --create`). `--create` without `--scope` is refused
  (`--create 에는 --scope <global|org> 가 필요합니다`, "--create needs --scope <global|org>", `2`). With `--scope org`,
  `--org <name|id>` is required (`--scope org 에는 --org <이름|id> 가 필요합니다`, "--scope org needs --org <name|id>",
  `2`).

  ```bash
  $ erdd library import standard.erdd-lib.yaml --create "데모 사전" --scope global --server http://127.0.0.1:3001 --yes
  데모 사전 (전역, 새로 만듦)
    추가 14 · 갱신 0 · 그대로 0 · 삭제 0
  ```

- **`--prune`** — Deletes existing items of the kinds the file mentions that are not in the file. Without it, those
  items stay, and the summary line gets `(--prune 이 없어 파일에 없는 N건은 남김)` ("N items not in the file are kept
  because there is no --prune"). Domains that remaining terms point to are not deleted even with `--prune`, and a warning
  appears.
- **`--include-stale`** — Overwrites stale file items with the file's values too. This reverts values the server moved
  ahead with, so it is off by default.
- **A bad file is refused** (`1`). File checks finish inside the CLI, so the import itself
  (`resource.library.import`) is not called. **However, `--library` checks the file after it has already fetched the
  library list.** It does not mean "it never calls the server at all" (only `--create --scope global` checks right away
  without fetching). For a library file, the problem lines follow `라이브러리 파일 오류 N건 — 아무것도 반영하지 않았습니다`
  ("N library file errors. Nothing was applied"). For Excel, the sheet and row follow `Excel 오류 N건 — 아무것도 반영하지
  않았습니다` ("N Excel errors. Nothing was applied").
- If you lack permission to write to the library named with `--library`, it is refused (`1`,
  `<이름> 에 쓸 권한이 없습니다`, "You do not have permission to write to <name>"). This decision is also made locally
  **after** fetching the library list (calling the server), and the import itself is not called.

**Limits** — Applying is one transaction (all or nothing). Each update is one `UPDATE` per item, so large updates can be
slow. The detailed list is under 「파일 내보내기·가져오기」 (File export and import) in 「알려진 한계」 (Known limitations)
of [../../guides/shared-resources.md](../../guides/shared-resources.md).

### 6.13 `erdd changes`

Local mode only. Records schema edit history (change records) in `erdd/changes/`. What they are and how to use them is
in [local mode manual 5.6](local-guide.md#56-change-records--the-edit-history-for-writing-migrations), and the syntax is
in the [change record syntax](../../guides/changeset-format.md).

```text
erdd changes [--check] [--json]
erdd changes new <name> [--baseline] [--json]
```

| Form | What it does | Exit code |
|---|---|---|
| `erdd changes` | Record count, conflict warnings, preview of unrecorded changes | `0`; `1` if records are broken or a record cannot be created in the current state |
| `erdd changes --check` | Same as above, and fails if there are unrecorded changes | `1` if there are unrecorded changes |
| `erdd changes new <name>` | Records unrecorded changes as `erdd/changes/<time>_<name>.erddc` | `0`; `1` if refused |
| `… --baseline` | Marks the first record as "already in the DB" | `1` if records already exist |

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

The status lines give the number of change records and the number of unrecorded statements, with a hint to record them
with `erdd changes new <name>`. `new` reports the file it recorded and its statement count.

- It looks at **`erdd/` on disk**. Unsaved edits are not included, and if there are any, `new` refuses.
- `--json` is `{ records, pending, warnings, error, unsaved }` (status) / `{ ok, file, statementCount }` (creation).
  A refusal carries `reason` (`name`, `empty`, `baseline`, `invalid`, `unsaved`, `local-only`) in the error envelope.
- In a server-connected project, it stops with `변경 기록은 로컬 모드 전용입니다 …` ("Change records are only for local
  mode …") (`1`).

---

## 7. Synchronization and conflicts

### 7.1 3-way merge

`push` and `diff` compare three models.

| Name | What | Where |
|---|---|---|
| **Base** | The model at the last `pull` | `.erdd/base.json` |
| **Local** | The current content of the `erdd/` files | Working directory |
| **Server** | The server's current model | `model.get` |

**The comparison is per field.**

- A field changed on **only one side** relative to the base → that value is adopted and **merged automatically**.
- Only a field that both sides changed **to different values** is a **conflict**.
- Fields that are arrays or objects (column mappings, index column lists, and so on) are treated as one value as a whole.

So even if you and someone else edit the same table at the same time, there is no conflict as long as you edited
different fields.

### 7.2 When there is a conflict

**`push` stops and the server is not changed.** It groups the conflicts by file and shows the three values side by side
(기준 base, 로컬 local, 서버 server).

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

The last line asks you to receive the server changes with `erdd pull`, sort them out, and push again.

- `(없음)` (none) — There was no value at that point. `(삭제됨)` (deleted) — That side deleted the item itself.
- When a whole item diverged, a reason such as `로컬에서 삭제, 서버에서 수정` ("deleted locally, modified on the server")
  appears instead of a field name.
- In `--json` (`push`, `diff`), the `reason` in `conflicts[]` gives the case: `field` (field value) · `both-added` ·
  `local-delete` · `server-delete` · `duplicate-origin` (below).

**How to resolve it.**

1. Receive the server changes with `erdd pull` (local changes are overwritten, so copy what you want to keep beforehand).
2. Sort out the values you want in the files.
3. Check with `erdd diff`, then run `erdd push`.

**When the same shared dictionary item came in twice (`duplicate-origin`).** If the server side received a library item
first (someone else's `dict pull` + `push`, or **가져오기** (Import) on the web), and this side also received it with
`dict pull` and pushes it, the two items have different ids, so it is not caught as a field conflict. Pushing it as is
would make later resyncs update only one of them and leave the other with the old value, so `push` is blocked. **Only
duplicates created by this push are blocked.** Duplicates already on the server cannot be fixed by this push, so they
are not blocked. What to delete splits into two cases.

```text
충돌 1건 — push를 중단했습니다.

erdd/words.yaml
  단어 고객 · 같은 공용 사전 항목이 두 번 들어왔습니다 — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요
    기준  (없음)
    로컬  고객 (id 018f6b0e-0000-7000-8000-0000000000b2) · v1 · 항목 item-1
    서버  고객 (id 018f6b0e-0000-7000-8000-0000000000a1) · v1 · 항목 item-1

erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.
```

The conflict line says the same shared dictionary item came in twice, and to delete the item you added locally and push
again.

| Path · message | What happened | What to do |
|---|---|---|
| A dictionary file (`erdd/words.yaml` and so on) · `… — 로컬에서 추가한 이 항목을 지우고 다시 push 하세요` ("delete the item you added locally and push again") | An item **newly added** locally points to the same source as a server item | Delete only that item from the dictionary file and `push` again. The server's item comes down with `pull` |
| `erdd/origins.yaml` · `… — 이 항목의 출처 줄을 지워 연결을 풀고 다시 push 하세요` ("delete this item's source line to unlink it and push again") | Locally, a **source was attached to an existing item** (`--adopt` and the like), but the server has a separate item from the same source | Delete only that item's line in `erdd/origins.yaml` and `push` again. Deleting the item would delete the server's existing data |

⚠️ **Do not use the resolution steps above (`erdd pull` first) for this conflict.** `pull` overwrites local changes with
the server state, so the item to delete would disappear **together with your other local work**. Delete only the one
line from the table and push again. Value lines have the form `name (id …) · source`. The two items easily share a name,
so the id tells you which one to delete. In the "added locally" case, the base is `(없음)` (none), not `(삭제됨)`
(deleted).

### 7.3 Races — when the server has moved ahead

If someone else commits after the plan is made but before it is applied, the server refuses. **The CLI recalculates and
retries once automatically** (`서버가 앞서 있어 다시 계산합니다`, "The server is ahead, recalculating"). If the second
attempt is also refused, it ends with the error.

### 7.4 Three ways push does not end normally

| Outcome | What happened | What to do |
|---|---|---|
| **Conflict** (`ok:false`, `conflicts`) | The server is unchanged | The steps in 7.2 |
| **Unknown whether applied** (`outcomeUnknown:true`) | The connection dropped, so it is unknown whether the request reached the server | **Run `push` again as is**, and it converges without duplicates. If you want to look first, use **`erdd diff`** |
| **Applied + file update failed** (`committed:true`, `syncError`) | The server apply finished, and the automatic pull afterward failed | `erdd pull` |

⚠️ **For "unknown whether applied", do not use `erdd pull` first.** If the push was not applied, pull would overwrite
and erase your local changes with the server state, and the property that pushing again converges would be lost. `erdd
diff` only reads, so it is safe.

**Why pushing again does not create copies** — `push` writes the new `id`s it issued this time into the local files
**just before** sending to the server (including a disk sync). So even if the response is lost and the same content is
sent again, the server sees the same `id`s as "already existing" and treats them as edits. `reservedFiles` in the
`--json` response is the list of files it actually rewrote at that point.

---

## 8. What the files do not hold

**The files that travel to and from the server** (`erdd/tables/*.yaml` and the five top-level files) hold **only the
semantic information** of the schema, to keep the diff clean. The following are not in those files, and `pull` and
`push` do not touch them either (values on the server are preserved as is).

| Not in the schema files | Where it is handled |
|---|---|
| Table layout coordinates (canvas positions, group view coordinates) | On the server DB side, the web editor. Moves made with `erdd serve` go to **`erdd/layout.yaml`, regardless of the mode** (→ [5.7](#57-erddlayoutyaml--layout-coordinates-and-notes)) |
| Notes | Same as above |

**Shared dictionary sources do not belong here.** They are in `erdd/origins.yaml` next to the dictionary files, and
`pull` and `push` exchange them with the server (→ [5.8](#58-erddoriginsyaml--shared-dictionary-sources)).

⚠️ **`erdd/layout.yaml` does not travel to or from the server either.** Coordinates moved with `erdd serve` are not
applied to the server even if you `push`, and `pull` does not overwrite that file. **This is also true in server mode.**
To adjust the server-side layout, use the web editor.

An agent must not try to handle requests such as "move the coordinates" or "leave a note" in the **schema files**
(`erdd/tables/*.yaml` and the five top-level files). That information is not in them. Its place is `erdd/layout.yaml`,
**regardless of the mode**, and it accumulates there when a person moves things on the `erdd serve` screen. **Do not
delete that file as a leftover.** It also contains the text of notes.

---

## 9. Using it with AI agents

### 9.1 Installing the skill

```bash
erdd skill install                 # .claude/skills/erdd/SKILL.md
erdd skill install --dir .agent/skills/erdd --force
```

**The document covers both modes.** At the very start, it has the agent determine the mode from `serverUrl` in
`erdd.config.yaml` (server mode if it has a value together with `projectId`; local mode if both are `null` or the keys
are missing; a configuration error if only one is present → [3.4](#34-local-mode--using-it-without-a-server)), and it
splits the workflows and prohibitions that differ by mode. Even when installed in a local-only project, the agent does
not try `pull` or `push` and get blocked with exit code `1`.

The installed document instructs the agent as follows.

- **When it needs to know the schema, read the `erdd/` files instead of digging through migrations or ORM code.**
- **Determine the mode first.** The source of truth is the server in server mode, and the `erdd/` files themselves in
  local mode.
- The editing workflow: in server mode, `pull` → edit → `validate` → `diff` → `push`; in local mode, edit → `validate` →
  **git commit** (it also tells the agent that `pull`, `push`, and `diff` stop with exit code `1`).
- **Do not check changes with `status` in local mode.** There is no baseline, so it always reports 「로컬 변경 없음」 (no
  local changes) (→ [6.3](#63-erdd-status)). Compare with `git status` and `git diff`.
- **Do not make up physical names.** ① Use the physical name of the term in `terms.yaml` with the same logical name as
  is. ② If there is none, combine words from `words.yaml` (회원 `MBR` + 번호 `NO` → `MBR_NO`). ③ If a word needed for the
  combination is not in the dictionary, register it in `words.yaml` as well.
- Set column types with `domain` where possible (the per-dialect types, defaults, and allowed values come with it).
- If `custom-fields.yaml` has an item with `required: true`, fill a value into the target's `custom`.
- **Do not (both modes)** — change or delete existing `id`s, leave `id`s in a copied file (`validate` blocks it with exit
  code `1`), rename table files directly, edit `.erdd/`, or **edit coordinates by hand** (move them on the `erdd serve`
  screen; coordinates are not in the schema files).
- **`erdd/layout.yaml` is a committed file that appears, regardless of the mode, when you edit with `erdd serve`**, and
  it contains the text of notes. Do not delete it as a leftover. However, it does not travel to or from the server.
- **In both modes, the CLI issues `id`s.** The server does not.
- **What differs by mode** — Shared dictionary sources (`erdd/origins.yaml`) and `erdd dict` apply only to server mode.
  It tells the agent **not to edit the source file by hand** (if you delete a dictionary item, its line is cleaned up at
  the next save).

### 9.2 Tips for handing it to an agent

- **Give the token through `ERDD_TOKEN`.** If it is in a file, the agent may read it and leak it into logs.
- **Non-interactively, pass `--json --yes` together.** With only `--json`, a push that includes deletions cannot show a
  confirmation prompt and stops.
- **Have it always run `validate` before push.** It does not call the server, so it costs nothing, and it catches naming
  rule violations in advance.
- Permissions follow the role of the token's issuer. To have an agent only read, give it **a token issued from a Viewer
  account**. **Do not give an agent an organization admin's token.** With that token, `erdd dict push` changes
  organization libraries without approval, and `erdd init --create` creates projects
  (→ [3.1](#31-issue-a-personal-access-token)).

---

## 10. Automation and CI

### 10.1 `--json` conventions

- **stdout is always one parsable JSON block.** Progress messages, prompts, and confirmation questions all go to stderr,
  so `command --json 2>/dev/null | jq` is safe.
- Failures follow the same convention: an error envelope appears on stdout.

```bash
$ erdd status --json          # in a directory without erdd.config.yaml
{"error":{"code":"NO_CONFIG","message":"erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요"}}
$ echo $?
1
```

**Error codes.**

| `code` | Meaning | Exit code |
|---|---|---|
| `USAGE` | Command or argument usage error | `2` |
| `NO_CONFIG` | There is no `erdd.config.yaml` | `1` |
| `UNAUTHORIZED` | The token is missing or does not work | `1` |
| `FORBIDDEN` | No permission | `1` |
| `NOT_FOUND` | The organization, project, or library was not found | `1` |
| `VALIDATION` | A file or input is invalid | `1` |
| `CONFLICT` | The server moved ahead (even after a retry) | `1` |
| `CANCELLED` | The user cancelled, or confirmation is needed | `1` |
| `NETWORK` | Connection or response parsing failure, and other errors | `1` |

⚠️ **If an agent or script branches on `code` to decide whether to retry**, treat only `NETWORK` as retryable.
`VALIDATION` and `FORBIDDEN` fail forever no matter how many times you run the same command.

**`export` JSON.** `content` and `path` are **mutually exclusive**. The same body is never put in both. With `-o`, the
body is in that file, so `content` is `null`; without it, `path` is `null`.

```bash
$ erdd export --json
{"format":"ddl","dialect":"mysql","path":null,
 "content":"CREATE TABLE mbr (\n  mbr_no BIGINT AUTO_INCREMENT NOT NULL COMMENT '회원번호',\n …",
 "warnings":[]}

$ erdd export --json -o out.sql
{"format":"ddl","dialect":"mysql",
 "path":"/path/to/my-project/out.sql","content":null,"warnings":[]}
```

| Key | Meaning |
|---|---|
| `format` | `"ddl"` or `"dbml"` |
| `dialect` | The dialect actually used |
| `path` | The **absolute path** written with `-o`. `null` without `-o` |
| `content` | The output body. `null` with `-o` |
| `warnings` | An array of export warning strings (in human-readable output, they also go to stderr) |

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

| Key | Meaning |
|---|---|
| `format`, `dialect` | The format and dialect actually used |
| `dialectSource` | Why the dialect was chosen: `"--dialect"` · `"본문에서 감지"` (detected in the body) · `"Project의 database_type"` (the Project's database_type) · `"erdd.config.yaml의 dialects[0]"` (dialects[0] of erdd.config.yaml) |
| `dryRun` | Whether it was `--dry-run`. If `true`, `written` and `deleted` are always `[]` |
| `added` | The number of tables **newly created** (skipped ones are not counted) |
| `columns`, `indexes`, `relationships`, `groups` | The numbers created along with the new tables |
| `skipped` | The names of tables **skipped** because of duplicate names (the original names in the imported file) |
| `warnings` | An array of `{kind, target, message}`: `table-conflict`, `unknown-type`, `unknown-word`, `unresolved-fk`, `unresolved-index`, and so on |
| `written`, `deleted` | File paths actually written or deleted (relative to the repository) |

**`dict pull` JSON.** One report per library. Even with deferred conflicts, the exit code is `0`, because a conflict is a
plan result, not an error.

```bash
$ erdd dict pull --json
{"libraries":[{"id":"01a0cc5e-eeb8-7f2e-b3d5-eff88cffe341","name":"플랫폼팀 표준 사전","scope":"org",
  "missing":false,"added":0,"autoUpdated":0,"adopted":0,"nameClashSkipped":[],"adoptDiffers":[],
  "unlinkable":[],"conflicts":[{"kind":"단어","name":"고객","fields":["abbreviation"],"decision":"defer"}],
  "kept":5,"detached":0}],
 "written":[],"deleted":[],"dryRun":false}
```

| Key | Meaning |
|---|---|
| `libraries[].missing` | Subscribed, but skipped because it could not be found (`scope` is `null`) |
| `added`, `autoUpdated`, `adopted`, `kept`, `detached` | Counts of added, auto-updated, linked, kept, and gone-from-source items |
| `nameClashSkipped`, `unlinkable` | Names skipped because of duplicate names (they link with `--adopt`) / names that cannot be linked: `[{ kind, name }]` |
| `adoptDiffers` | Duplicate names not linked because the content differs: `[{ kind, name, fields }]` (`fields` are the differing field keys). They link only with `--adopt --conflicts ours` |
| `conflicts[].decision` | `defer` (deferred) · `apply` (`--conflicts theirs`) · `keep` (`--conflicts ours`) |
| `written`, `deleted` | Files actually written or deleted. Always `[]` with `dryRun` |

**`dict push` JSON.** It splits by `mode`.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --json --yes
{"mode":"promote","ok":true,"seq":3,"inserted":1,"updated":0,"skipped":[],
 "behind":[{"kind":"word","name":"고객","entityId":"01a0cc74-e6c9-7367-a79d-81162824677e"}],
 "danglingDomain":[]}
```

| Case | Envelope |
|---|---|
| Direct promotion succeeded | `{ mode: "promote", ok: true, seq, inserted, updated, skipped, behind, danglingDomain }` |
| Everything skipped (exit `1`) | `{ mode: "promote", ok: false, … }` |
| Promoted + automatic pull failed (exit `1`) | `{ mode: "promote", ok: false, committed: true, syncError, … }`. **Do not push again; run `erdd pull`** |
| Promotion request | `{ mode: "request", id, requested, dropped, behind, danglingDomain }` |
| Nothing to push (exit `0`) | `{ libraryId, selected: 0, behind }` |

Every envelope carries **`behind`**: `[{ kind, name, entityId }]` of items left out because the library source was ahead
(`[]` if none). **`danglingDomain`** is `[{ name, domain }]` of terms whose domain link would be empty (term name and
domain name; `[]` if none). It is not in the nothing-to-push envelope, because with no selection there is no link to
leave empty.

```bash
$ erdd dict push --library "플랫폼팀 표준 사전" --name 고객 --json --yes
{"libraryId":"01a0cc72-fdd9-7a07-8d16-75937f36cd3d","selected":0,
 "behind":[{"kind":"word","name":"고객","entityId":"01a0cc73-5ea4-7256-94f1-4864bf41a9c9"}]}
```

`dict list --json` is an array of libraries (including `canWrite` and `subscribed`; server library rows also carry the
per-kind item counts `countsByKind`), and `dict requests --json` is an array of requests (including `status`, `note`,
`resolutionNote`, and `approvedEntityIds`). The JSON of `init --create` is in [6.1](#61-erdd-init), and `push`'s
`detachedOrigins` is in [6.6](#66-erdd-push).

⚠️ On file parse errors, both `export` and `import` print **the same envelope as `validate`**
(`{ok:false, parseErrors, integrityIssues, warnings}`) with exit code `1`. It is not the error envelope
(`{error:{code,…}}`).

### 10.2 CI example

This keeps schema files from being merged while out of step with the server.

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

**If you automate applying too**, you need `--yes` (it cannot show the deletion confirmation prompt).

```bash
erdd push --json --yes -m "CI: ${GIT_COMMIT:0:8}"
```

⚠️ **Decide carefully before putting `push` in CI.** The server is the source of truth, so if it races with edits in
progress on the web, CI can revert people's work. Usually, put only `validate` and `diff` in CI, and leave `push` to
people.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `sh: tsx: command not found` (exit code 127) | The project has no `tsx`. **The symptom of leaving it out differs by package manager.** With pnpm, `npx` fetches it on demand, so **it usually runs**, but it fails without a network. The flat npm layout fails with `ENOTCACHED` when there is no cache | `pnpm add -D tsx` (→ [2.1](#21-requirements)) |
| `pnpm exec erdd …` fails with `ERR_PNPM_IGNORED_BUILDS` (`esbuild`) | **This is pnpm 11's behavior.** `pnpm exec` first checks the dependency state by running `pnpm install`, and that install fails when there is a package whose build script is not approved (`esbuild`, which `tsx` pulls in). It is unrelated to `@erdd/cli` and does not happen with pnpm 10 | Approve `esbuild` with `pnpm approve-builds`, as pnpm suggests. Even before that, **calling `./node_modules/.bin/erdd` directly works** (verified) |
| In the ERDD repository, `packages/cli/src/main.ts` shows as `old mode 100644 / new mode 100755` | The method C installation added the execute bit to the bin entry point | `chmod 644 packages/cli/src/main.ts`. Do not commit it |
| `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요` ("erdd.config.yaml not found. Run erdd init first") | You ran it outside the project root, or have not connected yet | Move to the project root, or run `erdd init` |
| `토큰이 없습니다. ERDD_TOKEN을 설정하거나 erdd init을 실행하세요` ("No token. Set ERDD_TOKEN or run erdd init") | Neither the environment variable nor `.erdd/credentials.json` exists | Fill in one of them |
| `code: "UNAUTHORIZED"` | The token was revoked, or there is a typo | Reissue it on the web under **설정 → 액세스 토큰** (Settings → Access tokens) |
| `code: "FORBIDDEN"` | The issuer has no permission on that project | Check the project members and roles. Changing the token does not broaden permissions |
| `서버 응답에 result가 없습니다 … serverUrl이 ERDD 서버를 가리키는지 확인하세요` ("The server response has no result … check that serverUrl points to an ERDD server") | `serverUrl` points to another server or a proxy | Fix `serverUrl` in `erdd.config.yaml` |
| `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` ("There is no baseline. Run erdd pull first") | `.erdd/base.json` is missing (right after cloning and the like) | `erdd pull` |
| `.erdd/base.json이 손상됐습니다. erdd pull로 다시 받으세요` (".erdd/base.json is corrupted. Receive it again with erdd pull") | The baseline file is damaged | `erdd pull` |
| Untouched files show as local changes in `status` | `pull` was interrupted partway | Receive again with `erdd pull --yes` |
| `id …가 …에도 있습니다` ("id … is also in …") | You copied a file and did not delete the `id`s | Delete every `id` in the copy (→ [5.6](#56-handling-id--the-most-common-accident)) |
| `… 항목 하나가 두 번 나타납니다 — YAML anchor/alias …` ("… one item appears twice: YAML anchor/alias …") | You used an anchor or alias | Expand the alias and write it out |
| `erdd/ 아래에 파일이 없습니다 …` ("There are no files under erdd/ …") | You deleted `erdd/` entirely | If it was a mistake, `erdd pull`. If intended, delete the files individually |
| `변경이 N건으로 … 5000건을 넘습니다` ("N changes … exceed 5000") | Too many at once | Push in parts |
| After push, `반영은 성공했습니다 … 파일 갱신에 실패했습니다` ("The apply succeeded … updating the files failed") | The apply finished, and only the automatic pull failed | `erdd pull` |
| Push reports `반영 여부를 확인할 수 없습니다` ("Cannot confirm whether it was applied") | Transport layer failure | Check with `erdd diff`, then `push` again as is. **Do not use `pull` first** |
| You changed the dialects or naming rules on the web, but `validate` gives a different result | The local `erdd.config.yaml` is stale | `erdd pull` |
| A file name got a suffix, as in `MBR.1a2b3c4d.yaml` | There are tables whose physical names differ only in case | This is normal behavior. Make the names distinct, and the suffix disappears |
| `erdd.config.yaml에 연결 설정이 없습니다 …` ("erdd.config.yaml has no connection settings …") | You ran `pull`, `push`, or `diff` in a local-only project | To connect to a server, `erdd init`. To work locally, `erdd serve` (→ [3.4](#34-local-mode--using-it-without-a-server)) |
| `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다 …` ("serverUrl and projectId must both be in erdd.config.yaml …") | Only one of the two is written | Write both, or remove both (with neither, the project is local-only) |
| `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` ("erdd.config.yaml already exists. Delete it and run again") | You ran `init --local`, but a config already exists | Delete the existing file and run again. `--yes` does not overwrite it |
| `erdd serve` started, but the browser shows only `{"message":"Route GET:/p/… not found"…}` | The web bundle is missing (this happens only when you use the repository layout; registry installs have the bundle included) | In the ERDD checkout, `pnpm -C apps/web build` |
| You changed and rebuilt the web app, but the screen does not change | The browser or vite cache, or you did not restart `erdd serve`. **It is not because of leftovers in `packages/cli/web`.** In the repository, `apps/web/dist` always wins | Restart `erdd serve` and reload |
| `포트 4300이 이미 사용 중입니다 …` ("Port 4300 is already in use …") | Another `erdd serve` or another program holds that port | Pass a different port with `--port` |
| The **파일을 읽을 수 없어 편집이 잠겼습니다** (Editing is locked because a file cannot be read) banner appears at the top of the browser, and you cannot edit | YAML in `erdd/` is broken | Fix the file the banner points to. Fixing it unlocks automatically |
| Tables sit side by side in a grid on the `erdd serve` screen (in any mode) | `erdd/layout.yaml` is missing, or has no entry for that table | This is normal. Moving the tables or running **자동 정렬** (Auto layout) saves coordinates to that file |
| `변경 기록은 로컬 모드 전용입니다 …` ("Change records are only for local mode …") | You ran `erdd changes` in a server-connected project | Server mode has no change records |
| `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요` ("The server does not support this feature. Upgrade the server") | The server is older than the CLI and does not open the features that `erdd dict` and `init --create` call to tokens | Ask the server admin to upgrade the server. Reissuing the token does not help |
| `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 …` ("The project is not connected to a server …") | You ran `erdd dict` in a local-only project | `erdd init --server … --create` (→ [6.1](#61-erdd-init)) |
| `서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요` ("A server address is needed …") | An `erdd library` command has no `--server` and is not inside a connected project | Pass `--server <url>`, or run it in a server-connected project directory (→ [6.12](#612-erdd-library--library-management)) |
| `push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요` ("There are local changes you have not pushed …") | Before `dict push`, local changes are not on the server | `erdd push`, then `dict push` again |
| `서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요` ("The server moved ahead after the last pull …") | The server changed before `dict push` (someone else's edits, an approved promotion, and so on) | `erdd pull`, then `dict push` again |
| `파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤 구독의 file 을 지우세요` ("A dictionary received from a file cannot be pushed. Once connected to a server, remove the subscription's file") | The target library of `dict push` is a file subscription (`dictionaries[].file`) | Delete that subscription's `file` line in `erdd.config.yaml`, receive it again as a server subscription with `erdd dict pull --library`, then `dict push` (→ [5.2](#52-erddconfigyaml)) |
| `구독한 라이브러리가 없습니다 …` ("No subscribed libraries …") | `dict pull` without arguments, but there are no subscriptions | `erdd dict pull --library <name\|id>` |
| `dict pull` keeps showing conflicts as deferred | Changed locally, and the source changed too | `--conflicts theirs` (to the source value) or `--conflicts ours` (keep the local value) |
| `dict pull --adopt` shows `이름 중복 N — 내용이 달라 연결하지 않음 …` and does not link | A local item with the same name has different content from the source | To keep the local value, `--adopt --conflicts ours`. To change to the source value, delete the local item and run `dict pull` again (→ [6.11](#611-erdd-dict--shared-dictionaries)) |
| `dict pull --file` refuses with `서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) …` ("Only files exported by the server can be received …") | You gave a source file written by a person, or a file converted from Excel | Use a distribution file made by `library export` or **내보내기** (Export) on the web (→ [6.12](#612-erdd-library--library-management)) |
| `dict pull` refuses with `구독 <이름>(<id>) 의 파일 <경로> 은 다른 라이브러리(<id>)입니다 …` ("The file for subscription … is a different library …") | You overwrote the file subscription's path with a file exported from a different library | Delete that subscription line in `erdd.config.yaml` and receive again with `erdd dict pull --file <path>` |
| Push or diff stops with `같은 공용 사전 항목이 두 번 들어왔습니다 — …` ("The same shared dictionary item came in twice …") | The local side separately received a library item the server already received | Delete only that item (or that line in `origins.yaml`) as the message says, and `push` again. **Do not `pull` first** (→ [7.2](#72-when-there-is-a-conflict)) |
| `프로젝트 생성 권한이 없습니다 — …` ("No project creation permission …") | `init --create` works only for organization Owners/Admins | As the message says, ask an admin to create the project (→ [6.1](#61-erdd-init)) |
| `이미 서버 프로젝트에 연결돼 있습니다 …` ("Already connected to a server project …") | You ran `init --create` in a connected project | To switch to another project, `erdd init --project <id> --yes` |
| `확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요` ("Confirmation is required …") | `pull` or `init --create` (migration) needed confirmation, but could not ask because of `--json` | Look at the stderr list of what will be overwritten, then pass `--yes` |
| `origins[N]의 형식이 올바르지 않습니다 …` ("origins[N] has an invalid format …") and similar | You edited `erdd/origins.yaml` by hand | Receive it again with `erdd pull` (→ [5.8](#58-erddoriginsyaml--shared-dictionary-sources)) |

---

## Appendix: Verification status (2026-08-14)

**This contains verifications from several points in time.** The server connection workflow is from 2026-08-14, local
mode from 2026-08-20, and the published package form from 2026-08-29, and the `tsx` item below has a re-measurement from
2026-09-03 added.

**Verified with real commands.** An isolated temporary project was created, `@erdd/cli` was installed as a file
dependency, and the commands were run.

- That `pnpm add <path>/packages/cli` creates the `node_modules/.bin/erdd` link, and that **without `tsx` it fails with
  `sh: tsx: command not found` (exit code 127) and works after `pnpm add -D tsx`**.
  ⚠️ **In the 2026-09-03 re-measurement, `npx` fetched `tsx` on demand and it worked** (exit code `0`). However, **the
  installation form differed.** The re-measurement used a temporary directory where a packed tarball was installed with
  `npm install <tarball>`, while the line above is `pnpm add <path>/packages/cli`. Neither is wrong. **It depends on the
  network, cache, and package manager.** The line above is the 2026-08-14 environment as it was, and the current
  accurate description is in [2.1](#21-requirements).
- That this installation **changes the mode of `packages/cli/src/main.ts` in the ERDD repository from 100644 to 100755**
  (it shows up in `git status`; it was reverted after the verification).
- The full `--help` output (section 2.5 is the actual output as is).
- In a directory without settings, the human-readable and `--json` output of `status` with exit code `1`, and the error
  envelope `{"error":{"code":"NO_CONFIG",…}}`.
- In a minimal tree (`erdd.config.yaml` + 1 table + the 5 top-level files), the human-readable and `--json` output of
  `validate`, 3 unregistered word warnings, **`--strict` changing the exit code to `1`**, and the human-readable output
  of `status`.
- That `diff` stops before calling the server with `기준 시점이 없습니다…` when there is no baseline (exit code `1`).
- `skill install` installing, refusing a rerun (`1`), and overwriting with `--force`; the usage error for a missing
  `skill` subcommand (`2`); and the missing-argument error of `init --json --yes` (`2`).

**Not verified with a server attached.** Choosing an organization and project in `init`, the actual server round trips
of `pull`, `push`, and `diff`, conflict output, race retries, and the three abnormal endings of push were **carried over
from reading the source and unit tests**, and still need verification in a real environment. The quoted output was taken
verbatim from the implementation and the expected values in the tests.

### Local mode (2026-08-20)

**Verified with real commands.** A local-only project was created in a scratch directory and the commands were run.

- The output of `erdd init --local`, that **it creates only `erdd.config.yaml` and `.gitignore`** (`erdd/` is not
  created), the initial config content (section 3.4 is the actual file as is), and that a rerun stops with
  `erdd.config.yaml이 이미 있습니다…` (`1`).
- In a local-only project, the human-readable and `--json` output of `status` (as in section 6.3), that `pull`, `push`,
  and `diff` stop with `erdd.config.yaml에 연결 설정이 없습니다…` (`1`), and that `validate` works as is.
- The two stderr lines of `erdd serve --no-open --port 4399` (as in sections 3.4 and 6.8), that `/` returns 302 to
  `/p/00000000-0000-7000-8000-000000000000`, `포트 4399이 이미 사용 중입니다…` (`1`) when rerunning on the same port, the
  usage error for `--port abc` (`2`), and the full `--help` (section 2.5).
- That even with connection settings, `push` stops with `기준 시점이 없습니다…` (`1`) when `.erdd/base.json` is missing
  (the caution about migration in section 3.4).

**Verified in the browser** (the 11 smoke-test items of the local mode cycle) — that `/` goes to the editor and no login
screen appears, that creating tables and columns creates `erdd/tables/*.yaml` and the 5 top-level files, **that dragging
changes only `erdd/layout.yaml` and leaves the table YAML as is**, that notes go into `notes` in `layout.yaml`, that
**공용 리소스** (Shared resources), participants, and the user menu are absent, that **버전** (Versions) has only
**스냅샷** (Snapshots) and **비교** (Compare) and no **이력** (History), creating and restoring snapshots and
`erdd/snapshots/`, that editing a file in the terminal changes the screen **without a reload**, that breaking a file
switches to the banner + **읽기 전용** (Read-only) and reverting it unlocks, and that coordinates and notes remain after
`Ctrl+C` and restarting `serve`.

**Basis** — `packages/cli` (`main.ts`, `commands/*`, `local/*`, `plan.ts`, `tree.ts`, `client.ts`, `config.ts`,
`output.ts`), `packages/core/src/{file-format,layout,local}.ts`, `apps/server/src/routers/*` (procedures allowed for
tokens), and the local mode branches in `apps/web`.
When features change, this document must change with them.

### Registry publishing (2026-08-29)

**Verified in package form.** A tarball made with `pnpm pack` was installed into a separate consumer project and run.

- That the tarball **contains both the original TypeScript and the web bundle**: 127 files in `@erdd/cli` (101 of them
  in `web/`, 0 `*.test.ts`), and 39 files in `@erdd/core`. That `workspace:^` is replaced with the actual version
  (`^0.1.0`), and that `engines.node` is included as `>=22`.
- That `erdd --help`, `erdd init --local`, and `erdd validate` work normally from the installed copy (exit code `0`).
- That `erdd serve` starts from the installed copy, and **`/p/<id>` returns 200 + HTML**, `/assets/index-*.js` returns
  200 + 1,162,100 bytes, and `/trpc/model.get` returns 200, **in a project that never built the web app separately.**
- **That in the repository layout, the freshly built `apps/web/dist` wins.** Different marker files were placed in the
  two candidates to tell them apart. `/p/<id>` in the repository layout also returns 200.
- **That consumers must declare `tsx` themselves** (2.1). The path this document describes (pnpm + declaring `tsx`)
  exits with `0` even with a clean cache and offline. An attempt to solve this by putting `tsx` in `@erdd/cli`'s
  `dependencies` **made pnpm consumers regress instead** (what worked became `127`), so it was reverted.
- **That packing without the web bundle is blocked by the `prepack` guard with exit code `1`** (both `pnpm pack` and
  `npm pack`).

**Verified by installing from the public npm.** Unlike the item above (a tarball made with `pnpm pack`), the published
versions (`@erdd/cli@0.4.0`, `@erdd/core@0.3.0`) were installed into an empty directory exactly as in 2.2, with
`pnpm add -D @erdd/cli tsx` (pnpm 10.33.0). They install without registry settings or a token.

- `pnpm exec erdd --help` prints the command list (section [2.5](#25-check-that-it-runs)).
- `erdd init --local` prints `로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요` and exits with `0`.
- `erdd validate` prints `정합성 문제 없음` and `명명 경고 없음` (no consistency problems, no naming warnings) and exits
  with `0`.
- `erdd serve --port 4391 --no-open` prints the two lines below, `/` returns **302** to
  `/p/00000000-0000-7000-8000-000000000000`, and that address returns **200 + HTML** (`<!doctype html>`,
  `<html lang="ko">`). The web bundle bundled in the installed copy is served in a project that never built the web app.

  ```text
  http://127.0.0.1:4391 에서 실행 중 (프로젝트: …)
  중지하려면 Ctrl+C
  ```

**Combinations not verified** — installing with npm (`npm install -D @erdd/cli tsx` + `npx erdd`), a global install,
`npx @erdd/cli` without installing, and Windows.

### Shared dictionaries and server project creation — real server

**Verified against a real server.** This repository's server was started with an isolated DB, an organization, an
organization library (1 domain, 2 words, 1 term), an admin token, and an editor token were created through tRPC, and the
CLI was run from a scratch directory outside the repository (`npx tsx <ERDD>/packages/cli/src/main.ts …`). The output
quoted in sections 3.2, 6.1, 6.2, 6.11, 6.12, and 10.1 is that real output.

- The two messages of `init --create` (empty directory / migration), the five empty dictionary files created in an empty
  directory, the creation permission message for an editor token, and the refusal of an already connected config.
- The subscription and writable marks of `dict list`; the first receive, rerun (writes no files), and `--dry-run` of
  `dict pull`; and that subscriptions remain in the config and survive `push` and `pull`.
- That words written without an id in a dictionary file get an id through `push`, and that items received from a
  library and their sources go up to the server through `push` and come down to `origins.yaml` in another user's `pull`.
- That an editor token's `dict push` becomes a promotion request, that after web approval (`promotion.resolve`) the
  editor's `pull` writes the promoted items' sources to `origins.yaml`, and pending, approved, and processing notes in
  `dict requests`.
- `library list`, `export`, and `import` (`--library`, `--create`, `--dry-run`, `--yes`, the confirmation prompt,
  `--prune`, `--include-stale`); that importing an exported file again as is reports everything as unchanged; that
  editing an item on the server makes it count as a stale file; `dict pull --file` (first receive, rerun, refusing a
  different library, refusing a source file); and that `dict push` of a file subscription in a connected project is
  refused.
- That an admin token's `dict push` promotes directly and updates `origins.yaml` through the implicit pull, and the
  refusals for its two prerequisites (local changes present / the server moved ahead).
- Migration: `init --local` → add a word → `init --create` → `diff` shows everything as additions → `push`. Then
  skipping a duplicate name in `dict pull` → linking with `--adopt`, auto update, deferred conflicts, and
  `--conflicts theirs` after a library edit, and the `dict pull --json` envelope.
- That `pull` in a directory connected without a baseline (with files in `erdd/`) asks interactively, stops with
  `CANCELLED` under `--json`, and receives with `--yes`.
- That an editor's `dict push` to a global library is refused before calling the server.
- **Excluding items where the library source is ahead** — With two words edited in the library after receiving them,
  `dict push` leaves out those two items with the exclusion notice and pushes only the new word, and the library values
  and versions in the DB stay as they are. That even when named with `--name`, they drop out with `selected: 0` and
  `behind`. That after `dict pull` (auto update / `--conflicts ours`), the locally edited value goes up as a source
  update. And, as a control, that a CLI without the exclusion reverts the library value to the old value in the same
  state.

**Not verified.** 「서버가 이 기능을 지원하지 않습니다」 (the server does not support this feature) when attaching a new
CLI to an old server (confirmed only by unit tests for both `dict` and `init --create`), editing dictionaries on the
`erdd serve` screen (direct file edits were used instead), and choosing an organization interactively in
`init --create`. The following quoted output was taken from **the expected values in unit tests**, not a real server:
the `내용이 달라 연결하지 않음` (not linked, content differs) line and `adoptDiffers` of `dict pull`, the
`(도메인 연결 비움 — …)` (domain link cleared) line and `danglingDomain` of `dict push`, the source duplicate
(`duplicate-origin`) conflict report of push and diff, and the unsaved edit notice of `dict pull` and `dict push`.

---

**Next** — To run your own ERDD server so a team can share projects, read the
[installation and operations manual](install.md). For the editor screens, read the [user guide](user-guide.md).
