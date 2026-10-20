# ERDD local mode manual

This document covers, from start to finish, how to draw ERDs **without a server, account, or database**, using
only YAML files in your repository. One `erdd serve` command opens the same web editor as server mode in your
browser, and what you change on screen becomes the `erdd/` files. History is kept by git commits, not by a
server. It is for people who design alone and keep the schema in their own repository.

**This document is all you need.** You do not need to read about server installation and operations
([install.md](install.md)). Open the [user guide](user-guide.md) for the details of each screen, and the
[CLI manual](cli-guide.md) for the reference of each command, only when you need them.

**Contents** — [1. Who this document is for](#1-who-this-document-is-for) · [2. Preparation](#2-preparation) · [3. Getting started](#3-getting-started) · [4. What works in the browser and what does not](#4-what-works-in-the-browser-and-what-does-not) · [5. Files and git](#5-files-and-git) · [6. Snapshots](#6-snapshots) · [7. Working with a server](#7-working-with-a-server) · [8. Troubleshooting](#8-troubleshooting) · [Appendix: Verification status](#appendix-verification-status)

---

## 1. Who this document is for

**When local mode fits** — You design alone. There is no ERDD server to connect to, or you do not want to set one
up. You want to keep the schema inside your code repository and manage it with git. Sharing with your team through
PRs is enough.

**When you need server mode** — Several people edit the same project at the same time. You need accounts,
permissions, and organizations. The server must record who changed what and when. Several projects share
organization shared resources (standard domains and words). → [install.md](install.md)

| | **Local mode** | Server mode |
|---|---|---|
| Source of truth | `erdd/` files | Server DB |
| How to open it | `erdd serve` | Install and run the server |
| What you need | Node 22 + `@erdd/cli` (installed from npm) | On top of that, PostgreSQL, deployment, accounts |
| Accounts and login | **None.** The editor opens right away | Yes |
| Edit history | **git commits** | Server revisions (+ git) |
| Writing to files | **You must click 저장 (Save) (`Cmd+S`)** | Immediate (server DB) |
| Concurrent editing | None. It assumes one person | Real time |
| Layout coordinates and notes | `erdd/layout.yaml` (committed) | Server DB. However, if you move a project to `erdd serve`, its coordinates and notes accumulate in `erdd/layout.yaml` (→ [7.1](#71-open-a-server-project-in-the-local-editor)) |
| Snapshots | `erdd/snapshots/` (**committed**, so they stay in git history) | Server DB |
| Organization shared resources (standard words, terms, domains) | No screen. Receive them with `erdd dict pull --file` (without a server connection) | **공용 리소스** (Shared resources) on the web. A project connected to a server can also receive them into local files and push them with `erdd dict` (→ [7.3](#73-use-shared-dictionaries--erdd-dict)) |

**The two are not mutually exclusive.** You can open a server-connected project with `erdd serve` to refine it
visually, and you can move a project you started locally to a server later (one `erdd init --create` command)
→ [section 7](#7-working-with-a-server).

---

## 2. Preparation

### 2.1 What you need — there are two paths

**Either way, the result is the same.** The editor you open with `erdd serve` and the files it creates do not
differ. The only difference is what you must have in place beforehand.

| | **[Path A: install from npm](#22-path-a-install-from-npm-recommended)** | [Path B: repository checkout](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once) |
|---|---|---|
| When | **This is the usual one** | You cannot reach npm (offline), or you are changing ERDD itself |
| Node.js | **22 or later** (enforced by the package's `engines`) | **22 or later** (the ERDD repository's `mise.toml` is also `22`) |
| ERDD repository checkout | **Not needed** | Needed |
| `tsx` | Needed (`pnpm add -D tsx`). **`@erdd/cli` does not pull it in for you** | Needed |
| **Web bundle** | **Not needed. It is bundled in the package** | **Build it yourself** → [2.3](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once) |

You need no DB, no Docker, and no account. This is true for both.

### 2.2 Path A: install from npm (recommended)

One command inside **your own project**, where the schema will live, is all it takes. The package is on the
public npm, so you need no registry configuration and no token.

```bash
pnpm add -D @erdd/cli tsx
# with npm
npm install -D @erdd/cli tsx
```

- ⚠️ **Do not leave out `tsx`.** The package contains the original TypeScript, not build output, and
  `@erdd/cli` does not pull in `tsx` for you. Whatever your package manager, you must declare it directly in
  your project. If you leave it out, `npx` fetches it on demand and it often runs, but that depends on the
  network and cache, so the symptoms differ by package manager (the table in [section 8](#8-troubleshooting)).
  An explicit declaration is the only guaranteed path (→ [CLI manual 2.1](cli-guide.md#21-requirements)).
- **You do not need to build the web bundle.** The editor ships whole inside the package, so
  [2.3](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once) does not apply to this path. An installed
  copy cannot have a repository layout, so the bundled copy is always used.
- **This manual is inside the installed package too.** The four manuals are bundled per language, in
  `node_modules/@erdd/cli/docs/en/` (English) and `node_modules/@erdd/cli/docs/ko/` (Korean), together with the
  `README.md` at the package root. This document is `docs/en/local-guide.md` among them, and the relative links
  between documents still work. You can read it without cloning the ERDD repository.

### 2.3 Path B: ERDD repository checkout — build the web bundle once

> [!WARNING]
> **This section applies only when you use a repository checkout.** If you installed from npm
> ([2.2](#22-path-a-install-from-npm-recommended)), the bundle is already in the package, so skip this.

`erdd serve` **serves a prebuilt web bundle as static files.** A freshly cloned repository does not have that
bundle, so build it once.

```bash
cd /path/to/ERDD
pnpm install
pnpm -C apps/web build      # creates apps/web/dist
```

> [!WARNING]
> **If you skip it, the symptom is not "the server does not start" but "only the screen does not appear", which
> makes the cause hard to find.** `erdd serve` starts as usual with the same terminal output, but the browser shows
> JSON instead of the editor.

```json
{"message":"Route GET:/p/00000000-0000-7000-8000-000000000000 not found","error":"Not Found","statusCode":404}
```

If you updated the ERDD repository with `git pull`, rebuild the bundle too. Otherwise the old bundle is served as is.

**In the repository, the `apps/web/dist` you built most recently always wins.** Even if you once made a copy in
`packages/cli/web` (`bundle:web`) to prepare a release, `erdd serve` keeps looking at the latest build. If the screen
does not change, you do not need to suspect that copy.

### 2.4 Make `erdd` callable

**If you installed from npm** ([2.2](#22-path-a-install-from-npm-recommended)), this is already done. Call it with
`pnpm exec erdd …` (`npx erdd …` with npm). The rest of this section is about using a repository checkout
([2.3](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once)).

**The simplest way** — Add a shell alias.

```bash
# ~/.zshrc or similar
alias erdd='npx tsx /path/to/ERDD/packages/cli/src/main.ts'
```

You can also link the checkout into your project as a file dependency (`pnpm exec erdd …`). The caveats of that
approach (you must add `tsx` as well, and the file permissions of the ERDD checkout change) are in
[CLI manual 2.4](cli-guide.md#24-method-c-link-as-a-project-dependency).

> [!WARNING]
> **Commands always treat "the current directory" as the project.** The CLI looks for `erdd.config.yaml`, `erdd/`,
> and `.erdd/` all in `process.cwd()`. If you run it inside the ERDD repository, it looks in the wrong place. Run it in
> your own project directory, where the schema will live.

**From here on, this document writes commands as `erdd …`.** If you installed from npm, read it as
`pnpm exec erdd …` (`npx erdd …` with npm). The options and output are the same.

---

## 3. Getting started

### 3.1 `erdd init --local` — create a project

```bash
$ cd /path/to/my-project
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
```

The output means "Created a local-only project. Open it with erdd serve". **Exactly two things are created.**

| File | Content |
|---|---|
| `erdd.config.yaml` | Dialects, naming rules, table options. `serverUrl` and `projectId` are `null` |
| `.gitignore` | One `.erdd/` line is added (left alone if it is already there) |

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

At this point there is no token, no server round trip, and no `erdd/` directory (→ [3.3](#33-the-first-save-creates-erdd)).

**Choose the dialect and the case rule here.** The defaults are `postgresql` · `UPPER_SNAKE` above.

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

**The other naming rules have no options.** Change `separator`, `logicalSeparator`, `maxLengthBytes`, and the name
templates by editing `erdd.config.yaml` directly (the format is in [CLI manual 5.2](cli-guide.md#52-erddconfigyaml)).
An invalid value stops with a usage error (`2`):
`--case 값이 올바르지 않습니다: Camel — UPPER_SNAKE | lower_snake` ("invalid --case value").

> [!WARNING]
> **These two are only for `--local`.** Passing them to an `erdd init` that connects to a server is a usage error
> (`2`), because the server project's settings are the source of truth and the first `pull` would overwrite them at once.

> [!WARNING]
> **`--local` does not overwrite, even with `--yes`.** If `erdd.config.yaml` already exists, it stops with
> `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` ("erdd.config.yaml already exists. Delete it and run again")
> (exit code `1`). There is no server project to fall back on, so overwriting would silently lose the dialects and
> naming rules you carefully set.

### 3.2 `erdd serve` — open the editor

```bash
$ erdd serve
http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/my-project)
중지하려면 Ctrl+C
```

The output means "Running at http://127.0.0.1:4300 (project: …). Press Ctrl+C to stop". Your default browser opens
automatically (if it cannot, only `브라우저를 열지 못했습니다. 직접 … 을 여세요`, "Could not open the browser. Open …
yourself", is printed and the server keeps running). Go to the address and you are in the editor right away.
**There is no login screen.**

| Option | |
|---|---|
| `--port <number>` | Default `4300`. If the port is already in use, it **stops** (exit code `1`) instead of picking the next port automatically |
| `--no-open` | Does not open the browser automatically |

`serve` holds the terminal until `Ctrl+C`. **To open several projects at once**, use separate terminals and give
each a different port.

```bash
# terminal 1
cd ~/work/shop  && erdd serve --port 4300
# terminal 2
cd ~/work/admin && erdd serve --port 4301
```

**The address is the same every time you run it.** A local-only project's id is a fixed value
(`00000000-0000-7000-8000-000000000000`), so you can bookmark it. Going to `/` takes you to that project's screen
(when you open a server-connected project, that project's id is used → [7.1](#71-open-a-server-project-in-the-local-editor)).

> [!WARNING]
> **It binds only to `127.0.0.1`, and no option exposes it to the LAN**, because it is a server without
> authentication. If the `Host` header is not of the `127.0.0.1:<port>` or `localhost:<port>` kind, the response is
> 403. A private DNS name or a reverse proxy in front does not reach it. This also blocks DNS rebinding (a
> malicious page reading and writing this server through your browser), which binding alone cannot prevent.

### 3.3 The first **save** creates `erdd/`

Right after `init --local`, there is no `erdd/`. Creating a table in the browser does not create it yet. It is
created **when you click 저장 (Save) (`Cmd+S`)** (→ [4.4](#44-edits-stay-in-a-draft-until-you-save)). Opening the
editor alone adds no files to your repository.

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

If you cloned a repository that already has `erdd/` (you received a teammate's work), `erdd serve` reads those files
and opens them as is. You do not need to run `init` again, because `erdd.config.yaml` is committed along with them.

### 3.4 Stopping

Stop with **`Ctrl+C`**. If there are unsaved edits, the terminal prints this ("There are unsaved edits. They continue
in the next erdd serve").

```text
미저장 편집이 있습니다 — 다음 erdd serve 에서 이어집니다
```

**You do not lose them.** Unsaved edits are in `.erdd/draft.json`, and the next `serve` opens with them applied
(→ [4.4](#44-edits-stay-in-a-draft-until-you-save)). To keep them in the files, save before you stop.

---

## 4. What works in the browser and what does not

### 4.1 There are only two screens

| Path | Screen | |
|---|---|---|
| `/p/<id>` | ERD editor | Canvas, tree, edit panel. The same as server mode |
| `/p/<id>/settings` | Project settings | **설정** (Settings) in the editor header → [4.3](#43-project-settings) |

The login, home, organization, and admin screens do not exist at all. Clicking the logo at the left of the header
does not go home; it **returns to the editor**, because local mode has no home to go to.

### 4.2 Which chapters of the user guide apply

The editor works on **the same screen** as server mode, so follow the [user guide](user-guide.md) as is. However, 6
of its 20 chapters do not apply to local mode at all, and 2 differ in content.

| User guide | In local mode |
|---|---|
| [1. Accounts and login](user-guide.md#1-accounts-and-login) | **None.** No login screen appears |
| [2. Screen map](user-guide.md#2-screen-map) | **Different** → [4.1](#41-there-are-only-two-screens) |
| [3. Organizations, projects, and permissions](user-guide.md#3-organizations-projects-and-permissions) | **None.** There are no organizations, members, or roles. You always have manage permission |
| [4. Editor basics](user-guide.md#4-editor-basics) | Unchanged (including undo, redo, auto layout, and shortcuts) |
| [5. Tables and columns](user-guide.md#5-tables-and-columns) · [6. Relationships](user-guide.md#6-relationships) · [7. Indexes and notes](user-guide.md#7-indexes-and-notes) | Unchanged |
| [8. Groups and group views](user-guide.md#8-groups-and-group-views) · [9. Domains](user-guide.md#9-domains) · [10. Naming system](user-guide.md#10-naming-system-word-and-term-dictionary) · [11. Custom fields](user-guide.md#11-custom-fields) | Unchanged (including the Excel dictionary upload) |
| [12. Model check](user-guide.md#12-model-check) | Unchanged, with every warning |
| [13. Shared resources](user-guide.md#13-shared-resources) | No screen. There are no library, promotion, or promotion request screens. If the project is connected to a server, exchange items with `erdd dict`. Even without a connection, receive them with `erdd dict pull --file` (→ [7.3](#73-use-shared-dictionaries--erdd-dict)) |
| [14. Versions](user-guide.md#14-versions-history-snapshots-comparison) | **스냅샷** (Snapshots) and **비교** (Compare) are unchanged. There is no **이력** (History) tab → [section 6](#6-snapshots). The **변경 기록** (Change records) tab exists **only in local mode** → [5.6](#56-change-records--the-edit-history-for-writing-migrations) |
| [15. Export](user-guide.md#15-export) · [16. Import](user-guide.md#16-import) | Unchanged (DDL, DBML, image, Excel specification) |
| [17. Real-time co-editing](user-guide.md#17-real-time-co-editing) | **None.** There are no participant indicators or cursors |
| [18. Access tokens](user-guide.md#18-access-tokens) | **None.** There is no server to call |
| [19. Admin tasks](user-guide.md#19-admin-tasks) | **None** |
| [20. Selection and copy](user-guide.md#20-selection-and-copy) | Unchanged |

Having no edit history may look like a loss, but in local mode **git** takes that role. One commit is one revision,
and `git log`, `git diff`, and PR review are better than a history screen.

### 4.3 Project settings

Click **설정** (Settings) in the editor header.

| Item | In local mode |
|---|---|
| Project name | **Fixed to 로컬 프로젝트 (Local project).** It cannot be changed, because `erdd.config.yaml` has no place for a name |
| Naming rules | **Edit them here.** Saving writes them back to `erdd.config.yaml` |
| Table options | **Edit them here.** The four dialect fields appear as is, and saving writes them back to `tableOptions` in `erdd.config.yaml`. The screen and behavior are the same as server mode |
| Dialects (`dialects`) | The screen has no place to edit them (the same in server mode; they are set when the project is created). If you edit `dialects` in `erdd.config.yaml` directly, the file watcher picks it up |
| Project members | None |

### 4.4 Edits stay in a draft until you save

**Screen → files goes through 저장 (Save).** It works like a text editor. While you edit, the files stay as they are,
and they are written to `erdd/` only when you press `Cmd+S` (or **저장** in the header). If the cursor is in an
input field, the value typed in that field is applied first, then saved. You do not need to move focus away, and
the cursor stays in the field after saving. If the edit being applied is rejected (an error toast appears first),
**반영되지 않은 편집이 있어 저장하지 않았습니다** ("Not saved because there is an edit that was not applied") appears
and nothing is written to the files.

| Header | |
|---|---|
| **● 미저장** (Unsaved) | There is something left to save. If you revert your edits back to the original, it disappears on its own |
| **저장** (Save) | Writes to the files. Disabled when there is nothing to write. After a save, **it is still disabled while you type the first edit into an input field** (that value applies only when focus leaves), so use `Cmd+S` then |
| **⌄ → 변경 버리기** (Discard changes) | Discards your edits and returns to the file contents (asks for confirmation once) |

You do not lose unsaved edits. Anything not saved is recorded automatically in `.erdd/draft.json`, so even if you
close the browser or stop with `Ctrl+C`, it continues in the next `erdd serve`. That is why no warning appears when
you close the tab: there is nothing to lose. **The only exception is the one field you were typing in.** That value
becomes an edit only when focus leaves or you save, so if you close the tab as is, only that field is lost.

**Why it works this way** — If every discarded attempt and intermediate state became files, `git diff` would get
messy. The draft lives in `.erdd/` (gitignored), so it never appears as a commit candidate.

**Files → screen** — When a terminal, text editor, AI agent, or `git pull` changes `erdd/` or `erdd.config.yaml`, the
screen follows without a reload. The same is true when you switch branches.

```bash
# in another terminal
$EDITOR erdd/tables/MBR.yaml     # the browser changes the moment you save
git checkout feature/orders      # the screen switches to the branch's schema
```

> [!WARNING]
> **If the files change from outside while you have unsaved edits**, the screen is not replaced automatically.
> A banner asks you instead.

```text
파일이 밖에서 바뀌었습니다. 내 편집을 유지하면 저장할 때 화면의 내용이 파일을 덮어씁니다.
                                            [내 편집 유지]  [파일 다시 읽기]
```

The banner says "The files changed from outside. If you keep your edits, saving overwrites the files with what is on
screen."

- **내 편집 유지** (Keep my edits) — Closes the banner and lets you keep editing. From then on, **저장** writes the
  files exactly as the screen shows. Files newly created from outside are **deleted.** Nothing is merged
  automatically.
- **파일 다시 읽기** (Reload files) — Discards your unsaved edits and returns to the file contents (asks for
  confirmation once).

> [!WARNING]
> **Saving never overwrites changes you have not seen.** Even if the banner has not appeared yet, **저장** rereads
> the files the moment you click it, and if they differ, it writes nothing and shows the banner above.

### 4.5 A broken file locks editing

If YAML in `erdd/` fails parsing, schema, or integrity checks, the screen keeps the last valid model and only editing
is locked.

- A red banner at the top: `파일을 읽을 수 없어 편집이 잠겼습니다 — <경로>: <사유>` ("Editing is locked because a file
  cannot be read: <path>: <reason>")
- The bottom bar changes to **읽기 전용** (Read-only), and the import items disappear from the **파일** (File) menu
- **Fixing the file unlocks it automatically.** You do not need to restart the server

> [!WARNING]
> **This lock protects your data.** If edits kept being accepted, the healthy screen state would overwrite the broken
> file entirely, and what you were fixing by hand would be lost. `layout.yaml` is no exception. It holds not only
> coordinates but also the text of notes, so allowing edits while it is broken would make the next save erase the
> notes with `notes: []`. **저장** (Save) is also blocked while a file is broken.

Naming warnings and missing required custom fields are not errors. They do not lock anything and appear in
**모델 검사** (Model check).

### 4.6 Opening several tabs

> [!WARNING]
> **An edit made in the browser shows only in the tab that made it.** All tabs receive changes made to the files
> from outside, but a tab's own edits are filtered out when they come back, because otherwise the tab you are
> dragging in would keep jumping. Other tabs catch up at the next external change. To catch up before that, reload.
> Local mode assumes one person working on one screen.

However, **all tabs share the 미저장 (Unsaved) indicator.** The server holds a single draft, so whichever tab you save
from, the indicator in the other tabs clears as well.

---

## 5. Files and git

### 5.1 What is where

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

The details of the file formats (each key in a table file, the shape of the dictionary files, how to handle `id`) are
in [CLI manual section 5](cli-guide.md#5-file-structure-and-format).

### 5.2 Commit

```bash
git add erdd erdd.config.yaml
git commit -m "스키마: 회원 등급 컬럼 추가"
```

- ⚠️ **Check that you saved before you commit.** Unsaved edits are not in `erdd/`, so they are not committed. You can
  also check from the terminal: `erdd status` reports **저장하지 않은 편집이 있습니다** ("There are unsaved edits").
- **`erdd/snapshots/` is committed too.** Snapshots are shared with your team and stay in history (→ [section 6](#6-snapshots)).
- **Do not commit `.erdd/`.** `init --local` adds a line for it to `.gitignore`.
- **Commit `erdd.config.yaml` along with it.** A teammate who clones the repository and runs `erdd serve` sees the same
  diagram with the same dialects, naming rules, and table options. They do not need to run `init` again.
- These commits are **the entire history** of local mode. Revert with `git revert`, and compare with `git diff`.

### 5.3 `erdd/layout.yaml` — layout coordinates and notes

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

- **Moving a table changes only this file.** Not a single character of `erdd/tables/*.yaml` changes. The files are
  split so that moving things around does not produce a schema diff.
- **It is committed.** The layout is part of the diagram your team looks at together.
- **Tables are identified by `id`.** The layout follows even if you change the physical name. Leftovers of deleted
  tables are discarded silently.
- **Without it, tables fall into a grid sorted by physical name.** If one entry is broken, only that entry is
  filtered out and the rest open as is (a whole broken file is different → [4.5](#45-a-broken-file-locks-editing)).

### 5.4 Checking without a server — `erdd validate`

Checks referential integrity and naming rules using only the `erdd/` files. It works in local mode as is.

```bash
erdd validate            # consistency and naming warnings
erdd validate --strict   # treats warnings as failures too (exit code 1), for commit hooks and CI
```

The `--json` output conventions and CI examples are in [CLI manual section 10](cli-guide.md#10-automation-and-ci).

> [!WARNING]
> **`pull`, `push`, and `diff` stop in a local-only project** (exit code `1`). There is no server, so this is expected.
> The message says that `erdd.config.yaml` has no connection settings and suggests connecting with `erdd init` or opening
> locally with `erdd serve`.

```text
오류: erdd.config.yaml에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요
```

### 5.5 Exchanging DDL and DBML — `erdd export` · `erdd import`

Neither **calls the server, so both work in local mode as is.**

```bash
erdd export > schema.sql             # safe in a pipe; warnings go to stderr
erdd export --format dbml -o s.dbml
erdd import legacy.sql --dry-run     # look at the plan first
erdd import legacy.sql --yes         # apply; it merges (existing tables are skipped)
```

Starting a project from an existing DB dump is where `import` fits. After applying, use `erdd validate` to clean up
the dictionaries (`words.yaml`, `terms.yaml`) and make a **git commit**. In local mode, that is the entire history.

Options, detection order, and the `--json` shape are in [CLI manual 6.9 and 6.10](cli-guide.md#69-erdd-export).

### 5.6 Change records — the edit history for writing migrations

**What** — Records the changes you made to tables, columns, relationships, and indexes in `erdd/changes/`, as text that
is not tied to any DB or tool. ERDD does not generate SQL. Each project reads these records and writes migrations
with its own tool (Flyway, Liquibase, ORM migrations, and so on) in its own DB syntax. One record is one migration.

**Where** — The **버전 (Versions) → 변경 기록 (Change records)** tab in the editor header, or `erdd changes` in the
terminal.

**How**

1. Edit and **저장 (Save)** (you cannot create a record while there are unsaved edits).
2. **미기록 변경** (Unrecorded changes) at the top of the **변경 기록** tab previews the record that will be created.
3. Enter **이름** (Name) (for example, 「회원 등급 추가」, "add member grade") and click **변경 기록 만들기** (Create change
   record). `erdd/changes/<time>_<name>.erddc` is created.
4. Commit the record file, and write the migration from it. Putting the record file name in the migration file name or
   a comment shows how far you have carried things over.

From the terminal:

```bash
erdd changes                       # preview unrecorded changes
erdd changes new "회원 등급 추가"   # create a record
erdd changes --check               # exit code 1 if there are unrecorded changes (CI)
```

A record looks like this. Carrying it over from top to bottom gives an order that satisfies SQL dependencies. The
`@…` at the end of a line is a tag ERDD uses to find the target, so do not carry it over.

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

The full syntax and rules are in the [change record syntax](../../guides/changeset-format.md).

**When you adopt it for a DB already in production** — The first record becomes a `create` of the whole schema. If you
create it from the terminal with `erdd changes new "운영 DB" --baseline`, it gets a mark meaning "already in the DB, no
migration needed" (`baseline: true`).

**Branches** — Even if two branches each create records, the file names differ, so they merge without git conflicts.
After merging, if `erdd changes` reports no unrecorded changes, everything is fine. If two records changed the same
property of the same column differently, a **⚠️ 기록 간 경합** (conflict between records) warning appears. It means the
migrations on each branch were written on different assumptions, so check them and turn the remaining difference into
a new record. If two branches deleted the same thing, or one branch references a name the other renamed, the same ⚠️
warning appears and recording does not stop. Again, turn the remaining difference into a new record.

> [!WARNING]
> **Do not edit record files.** If you created one wrong and have not shared it yet, delete the file and create it
> again. The reason is in 「기록 파일은 고치지 않는다」 (Do not edit record files) in the
> [change record syntax](../../guides/changeset-format.md).

**When a record cannot be created** — Most often when there are unsaved edits, or when there is no change to record.
The full list is in 「기록을 만들 수 없는 경우」 (When a record cannot be created) in the
[change record syntax](../../guides/changeset-format.md).

---

## 6. Snapshots

**What** — Stores the whole current model under a name, so that you can later return to that point or compare it with
now.

**Where** — **버전** (Versions) in the editor header → the **스냅샷** (Snapshots) and **비교** (Compare) tabs. (The
**이력** (History) tab of server mode does not exist in local mode.)

**How** — Enter **이름** (Name) and click **스냅샷 만들기** (Create snapshot). Click an item in the list to expand the
table count and the first 5 physical names. **복원** (Restore) returns to that point after a confirmation, and **삭제**
(Delete) also asks for confirmation once. On the **비교** tab, choose a snapshot and **현재** (Current) in **기준** (Base)
and **비교** (Compare) to see the differences, and download them as an Excel **변경분 정의서** (Change specification).
The details of the screen are the same as [user guide section 14](user-guide.md#14-versions-history-snapshots-comparison).

> [!WARNING]
> **You cannot create a snapshot while there are unsaved edits.** It is rejected with
> **저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 스냅샷을 만드세요** ("There are unsaved edits. Save first, then create the
> snapshot"). A snapshot names a saved state, so there must not be a version that points to a state that exists
> nowhere in the files.

> [!WARNING]
> **복원 (Restore) does not change the files right away.** Restoring returns the screen to that point and marks it
> **미저장** (Unsaved). `erdd/` is rewritten with that content only when you click **저장** (Save)
> (→ [4.4](#44-edits-stay-in-a-draft-until-you-save)).

**Where they are stored** — In `erdd/snapshots/`, one file per snapshot (gzip). The names, descriptions, and times
in the list are in a plain-text `index.yaml` in the same directory.

```text
erdd/snapshots/
├─ index.yaml                              # name, description, time, revision
├─ 018f6b0e-1111-7000-8000-….json.gz       # full copy of the model (compressed)
└─ 018f6b12-2222-7000-8000-….json.gz
```

✅ **Snapshots are stored in git.** They are under `erdd/`, so they are committed and travel to your teammates and to
your other computers. Because there is one file per snapshot, creating a new one adds only that one file to the
commit. What was added can be read from the diff of `index.yaml`.

```bash
git add erdd/snapshots
git commit -m "스냅샷: 회원 도메인 정리 전"
```

- **File names are only the id.** The snapshot name is not put in the file name, because macOS and git normalize Korean
  names differently and they would look like different files on different platforms. Ids sort by time, so `ls` is
  already in time order.
- **A restore cannot be undone.** The undo history is cleared right after a restore. To go back, restore another
  snapshot (if you have not saved, **변경 버리기** (Discard changes) is enough), or recover `erdd/` from git.
- Do not edit `erdd/snapshots/` by hand. If the content is broken, that snapshot is rejected with
  **스냅샷이 손상됐습니다** ("The snapshot is corrupted"). Reporting that it is broken, rather than that it does not
  exist, is intentional.
- **Even if `index.yaml` is broken, listing and restoring still work.** Only the names temporarily show as
  `(이름 없음) …` ("(no name) …"). If you create or delete a snapshot in that state, the broken file is not
  overwritten but moved to `index.corrupt-<time>.yaml`. The old names are still there, so you can restore them by
  hand. (An `index.yaml` with leftover merge conflict markers is the most common cause of this state.)

**Old snapshots are moved automatically.** If an older `.erdd/snapshots.json` exists, `erdd serve` moves it to the new
location once, the first time it starts, and reports it like this ("Moved 3 snapshots to erdd/snapshots/. They are now
committed. git add erdd/snapshots").

```text
스냅샷 3개를 erdd/snapshots/ 로 옮겼습니다 — 이제 커밋 대상입니다. git add erdd/snapshots
```

The old file is not deleted. It is only renamed to `.erdd/snapshots.json.migrated`. Entries with broken content **are
not moved**, and their names are reported, so that corruption is not promoted into something you commit.

---

## 7. Working with a server

Local mode and a server connection **are not mutually exclusive.** If `erdd.config.yaml` has `serverUrl` and
`projectId`, the project is connected; otherwise it is local-only. Either way, `erdd serve` starts and always looks
only at the files.

### 7.1 Open a server project in the local editor

This is the flow for checking and refining a pulled schema **visually**, then pushing it back. You can edit even where
you cannot reach the server (on a plane, outside the network where the server is).

```bash
erdd pull                      # receive the server schema as files
erdd serve                     # view and edit it visually in the browser (stop with Ctrl+C)
erdd validate                  # check without a server
erdd diff                      # preview changes to push, changes to pull, and conflicts
erdd push -m "회원 등급 컬럼 추가"
```

- The project that opens is the config's `projectId`. The address becomes `/p/<the server's project id>`.
- **You can run `erdd pull` in another terminal while `serve` is running.** The file watcher picks it up and the screen
  follows.
- ⚠️ **`pull` overwrites local changes.** If you have touched files, it lists them and asks once with
  `계속할까요?` ("Continue?"). If you were editing in the browser, stop here and `push` first. Without a last-pull
  baseline (right after cloning and the like), it shows every file in `erdd/` in the overwrite list and asks.
- ⚠️ **Coordinates and notes do not go to the server.** `push` does not send `erdd/layout.yaml`, and `pull` does not
  overwrite it. Server mode's coordinates and notes live separately in the server DB, and the two do not know about
  each other.

### 7.2 Move a project started locally to a server

**It takes one `erdd init --create` command.** It creates an empty project on the server and connects this directory
to it. It does not touch a single byte of `erdd/`, and it sets the "last pull point" to an empty server, so your
entire schema counts as changes to push (additions).

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

In this output, `init` asks to connect the local project to the new server project "이관" and confirms that it created
and connected it. `diff` shows 2 changes to push (two words added), no changes to pull, and no conflicts. `push`
reports that it applied the changes as revision 1.

- **Only organization Owners/Admins can do this** (project creation permission). Without permission, it creates nothing
  on the server and stops like this. In that case, go to "Without create permission" below.

  ```text
  오류: 프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요
  ```

  The message says you have no project creation permission, and asks you to have an organization admin create an
  empty project, commit `erdd/` to git, and follow the manual procedure of this section.

- **The server project is created from this directory's settings.** The dialects, naming rules, and table options in
  `erdd.config.yaml` go up as is, and `serverUrl` and `projectId` are filled into the config. That is why you cannot
  pass `--dialect` or `--case`.
- `--yes` skips the confirmation. **If `erdd serve` has unsaved edits**, `⚠️ 저장하지 않은 편집이 있습니다 …`
  ("⚠️ There are unsaved edits …") appears before the prompt. Only saved files go into the move, so save first.
- Right after connecting, `erdd status` may show empty dictionary files that were not in `erdd/` as `-`. `diff` is the
  reference, and one `push` makes them disappear.
- **`layout.yaml` does not go up.** Leave the file as it is. From then on, it is used only when you open the project
  with `erdd serve`.
- **Lay out the server side anew with 자동 정렬 (Auto layout) in the web editor.**

#### Without create permission — the manual procedure

Ask an admin to create an empty project, and connect to its id.

> [!WARNING]
> This connection has no "last pull point", so `push` stops with `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요`
> ("There is no baseline. Run erdd pull first") (exit code `1`), and `pull` overwrites `erdd/` with the empty server
> state. That is why **committing first, so you can recover, is the key.**

```bash
git add erdd erdd.config.yaml && git commit -m "스키마: 서버 이관 전 상태"

erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --project <new-project-id> --yes
erdd pull --yes                  # ⚠️ the empty server state overwrites erdd/ (the list it asks about is all your files)
git checkout HEAD -- erdd        # put back the schema you committed a moment ago
erdd diff                        # everything showing as additions is expected
erdd push -m "로컬에서 설계한 스키마 이관"
```

- `--yes` skips 「`erdd.config.yaml` 이 이미 있습니다. 덮어쓸까요?」 ("`erdd.config.yaml` already exists. Overwrite
  it?"). Turning a local-only config into a server-connected config is the intended behavior here (unlike `--local`,
  this one is overwritten).
- `init` overwrites `erdd.config.yaml` with the server's values (dialects, naming rules). If they differ from the rules
  you set locally, align them in the project settings on the web.
- `layout.yaml` does not go up, and you lay out the server side anew with **자동 정렬** (Auto layout) in the web editor
  (the same as above).

### 7.3 Use shared dictionaries — `erdd dict`

**A project connected to a server** can receive organization and global shared dictionaries (standard words, terms,
domains, custom fields) into local files, and push new words up to the shared library. Editing happens locally
(`erdd serve` + git), and the server serves as storage.

```bash
erdd dict pull --library "플랫폼팀 표준 사전"   # receive; erdd/words.yaml etc. and erdd/origins.yaml change
erdd serve                                      # edit as usual → save → git commit
erdd push -m "…"                                # bring the storage (server project) up to date first
erdd dict push --library "플랫폼팀 표준 사전"   # push to the shared library; a promotion request without permission
```

- **This flow (receive by server subscription, push by promotion) exists only for connected projects.** Connect to a
  server first with [7.2](#72-move-a-project-started-locally-to-a-server). If you only receive, local-only projects
  work too. See "Local-only projects can also receive distribution files" below.
  For a project that already has its own words, `erdd dict pull --adopt` links only the source of words whose name and
  content are the same (sort out words with different content as described in the `--adopt` part of
  [CLI manual 6.11](cli-guide.md#611-erdd-dict--shared-dictionaries)).
- **`erdd/origins.yaml` records where received items came from. Do not edit it by hand.** It is committed.
- Details of the commands, options, and output are in [CLI manual 6.11](cli-guide.md#611-erdd-dict--shared-dictionaries).

#### Local-only projects can also receive distribution files

**Even with no server connection at all**, if you have a distribution file (`.erdd-lib.yaml`) that an admin made with
`erdd library export` or with **내보내기** (Export) in **공용 리소스** (Shared resources) on the web, you can receive it
with `erdd dict pull --file`. That command only reads the file and does not call the server.

```bash
$ erdd init --local
로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
$ erdd dict pull --file standard.erdd-lib.yaml
데모 사전 (파일 standard.erdd-lib.yaml)
  추가 14 · 자동 갱신 0 · 연결 0 · 유지 0
반영했습니다 — erdd/custom-fields.yaml, erdd/domains.yaml, erdd/origins.yaml, erdd/terms.yaml, erdd/words.yaml
```

The output names the library ("데모 사전", from the file), counts 14 added, 0 auto-updated, 0 linked, and 0 kept, and
lists the files it applied.

- The first time you receive it, the file path is recorded as a subscription in `dictionaries[].file` of
  `erdd.config.yaml`. From then on, `erdd dict pull` without arguments also receives from this file again (overwrite it
  with a new distribution file to pick up the changes).
- **You can only receive.** Local-only projects do not have `erdd dict push` in the first place (it needs a server
  connection). To push items you made locally to the shared library, connect to a server with
  [7.2](#72-move-a-project-started-locally-to-a-server). (If a server-connected project tries to push a library it
  received through a file subscription, it is blocked separately with `파일에서 받은 사전은 올릴 수 없습니다`
  ("A dictionary received from a file cannot be pushed") → [CLI manual 6.11](cli-guide.md#611-erdd-dict--shared-dictionaries).)
- The options and decision rules are the same as `dict pull` for a server subscription (add, auto update, conflict,
  duplicate name). For details, see
  [`--file` in CLI manual 6.11](cli-guide.md#611-erdd-dict--shared-dictionaries).

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `erdd serve` started, but the browser shows only `{"message":"Route GET:/p/… not found"…}` | The web bundle (`apps/web/dist`) is missing. **This happens only when you use a repository checkout.** Registry installs have the bundle included | In the ERDD checkout, run `pnpm -C apps/web build` (→ [2.3](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once)) |
| `sh: tsx: command not found` (exit code 127) | The project has no `tsx`. **The symptom of leaving it out differs by package manager.** With pnpm, `npx` fetches it on demand, so it usually runs, but it fails without a network. The flat npm layout fails with `ENOTCACHED` when there is no cache | `pnpm add -D tsx` (→ [2.1](#21-what-you-need--there-are-two-paths)) |
| `pnpm exec erdd …` fails with `ERR_PNPM_IGNORED_BUILDS` (`esbuild`) | **This is pnpm 11's behavior.** `pnpm exec` first checks the dependency state by running `pnpm install`, and that install fails when there is a package whose build script is not approved (`esbuild`, which `tsx` pulls in). It is unrelated to `@erdd/cli` and does not happen with pnpm 10 | Approve `esbuild` with `pnpm approve-builds`, as pnpm suggests. Even before that, **calling `./node_modules/.bin/erdd` directly works** (verified) |
| `erdd.config.yaml이 없습니다. erdd init을 먼저 실행하세요` ("erdd.config.yaml not found. Run erdd init first") | You ran it outside the project root | Move to the project root, or run `erdd init --local` |
| `erdd.config.yaml이 이미 있습니다. 지우고 다시 실행하세요` ("erdd.config.yaml already exists. Delete it and run again") | You ran `init --local`, but a config already exists | Delete the existing file and run again. `--yes` does not overwrite it either |
| `포트 4300이 이미 사용 중입니다 …` ("Port 4300 is already in use …") | Another `erdd serve` or another program holds that port | Pass a different port with `--port`. Not picking the next port automatically is intentional |
| `--port abc` fails with a usage error (`2`) | It is not an integer | Pass a port number |
| The browser shows the **파일을 읽을 수 없어 편집이 잠겼습니다** (Editing is locked because a file cannot be read) banner, and you cannot edit | YAML in `erdd/` is broken | Fix the file the banner points to. Fixing it unlocks automatically (→ [4.5](#45-a-broken-file-locks-editing)) |
| Tables sit side by side in a grid | `erdd/layout.yaml` is missing, or has no entry for that table | This is normal. Moving the tables or running **자동 정렬** (Auto layout) saves coordinates |
| Another tab does not follow the edit you made | An edit shows only in the tab that made it | Reload (→ [4.6](#46-opening-several-tabs)) |
| You edited on screen, but `git status` shows nothing | **You did not save.** The edits are only in `.erdd/draft.json` (gitignored) | **저장** (Save) in the header, or `Cmd+S`. From the terminal, `erdd status` tells you (→ [4.4](#44-edits-stay-in-a-draft-until-you-save)) |
| The **파일이 밖에서 바뀌었습니다** (The files changed from outside) banner appears | You have unsaved edits, and `git pull`, an agent, or something else changed `erdd/` | **내 편집 유지** (Keep my edits; saving overwrites the files with the screen) or **파일 다시 읽기** (Reload files; discards your edits) (→ [4.4](#44-edits-stay-in-a-draft-until-you-save)) |
| **저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 스냅샷을 만드세요** (There are unsaved edits. Save first, then create the snapshot) | A snapshot holds only the saved state | Save first (→ [section 6](#6-snapshots)) |
| After stopping and restarting `erdd serve`, your edits are still there | This is normal. Unsaved edits remain in the draft | Keep working, or discard them with **변경 버리기** (Discard changes) (→ [4.4](#44-edits-stay-in-a-draft-until-you-save)) |
| You edited a file in the terminal, but the screen does not change | Registering the file watcher failed (platform, permissions, `EMFILE`) | Reload. The terminal running `serve` shows a `[watchProject] …` warning |
| `erdd.config.yaml에 연결 설정이 없습니다 …` ("erdd.config.yaml has no connection settings …") | You ran `pull`, `push`, or `diff` in a local-only project | To work locally, use `erdd serve`. To connect to a server, use `erdd init --server … --create` (→ [7.2](#72-move-a-project-started-locally-to-a-server)) |
| `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 …` ("The project is not connected to a server. Connect it with erdd init --server <url> --create …") | You ran `erdd dict pull --library`, `dict push`, or `dict requests` in a local-only project | Pushing and viewing requests need a server connection (→ [7.2](#72-move-a-project-started-locally-to-a-server)). If you **only receive**, and you have a distribution file, you can receive it without a connection with `erdd dict pull --file <path>` (→ [7.3](#73-use-shared-dictionaries--erdd-dict)) |
| `erdd.config.yaml에 serverUrl과 projectId는 함께 있어야 합니다 …` ("serverUrl and projectId must both be in erdd.config.yaml …") | Only one of the two is written | Write both, or remove both (with neither, the project is local-only) |
| `기준 시점이 없습니다. 먼저 erdd pull을 실행하세요` ("There is no baseline. Run erdd pull first") | You wrote only the connection settings, or connected with `--project`, and then ran `push` | **Before you `pull`**, read [7.2](#72-move-a-project-started-locally-to-a-server). A plain `pull` overwrites `erdd/` with the server state |
| Connecting through a private domain or reverse proxy gives **403** | The `Host` check | Open it at a loopback address. LAN and proxy exposure are blocked on purpose (→ [3.2](#32-erdd-serve--open-the-editor)) |
| **공용 리소스** (Shared resources), **이력** (History), or the user menu is missing | These features do not exist in local mode | This is normal (→ [4.2](#42-which-chapters-of-the-user-guide-apply)) |
| `변경 기록은 로컬 모드 전용입니다 …` ("Change records are only for local mode …") | You ran `erdd changes` in a server-connected project | Server mode has no change records |

Troubleshooting for the CLI in general (server connection, tokens, conflicts) is in
[CLI manual section 11](cli-guide.md#11-troubleshooting).

---

## Appendix: Verification status

**Local mode behavior was verified by actually running it.** The command output, exit codes, and the list of 11 browser
smoke-test items are in the [CLI manual appendix](cli-guide.md#local-mode).

**Additionally verified while writing this document.**

- **The symptom without the web bundle** — `apps/web/dist` was moved away and `erdd serve` was run. The terminal output
  was the same as usual, and `/` returned 302 to `/p/<id>`, but that address returned the JSON 404 quoted in
  [2.3](#23-path-b-erdd-repository-checkout--build-the-web-bundle-once).
- That `init --local` in a local-only project creates only `erdd.config.yaml` and `.gitignore` (one `.erdd/` line), the
  human-readable and `--json` output of `status`, and that `validate` works as is.

**Verified with a package install.**

- **`erdd serve` starts as is from a registry install.** A tarball made with `pnpm pack` was installed into a separate
  consumer project (a project that never built the web app), and `erdd serve --no-open` was run. `/p/<id>` returned
  200 + HTML, `/assets/index-*.js` returned 200 + 1,162,100 bytes, and `/trpc/model.get` returned 200. The installed
  `node_modules/@erdd/cli/web` had 101 files, and `engines` was `{"node":">=22"}`. In that project, `erdd --help`,
  `init --local`, and `validate` also exited with `0`.
- **In the repository layout, the freshly built `apps/web/dist` wins.** Different marker files were placed in the two
  candidates (`apps/web/dist` and `packages/cli/web`) to tell which one was served. `/p/<id>` in the repository layout
  also returned 200. A copy made to prepare a release does not hide the latest build.
- **Consumers must declare `tsx` themselves.** The `pnpm add -D @erdd/cli tsx` path in
  [2.2](#22-path-a-install-from-npm-recommended) exits with `0` even with a clean cache and offline. An attempt to solve
  this by putting `tsx` in `@erdd/cli`'s `dependencies` made pnpm consumers regress instead (what worked became
  `127`), so it was reverted.

**Verified by installing from the public npm.** Unlike the item above (a tarball made with `pnpm pack`), this installed
the version published on npm. In an empty directory, installing exactly as in
[2.2](#22-path-a-install-from-npm-recommended) with `pnpm add -D @erdd/cli tsx`, `erdd init --local` and `validate`
exited with `0`, and in `erdd serve --no-open`, `/` returned 302 to `/p/<id>` and that address returned
200 + HTML. That is, the bundled web app is served in a project that never built the web app. The raw output and
the combinations not verified (npm install, global install, `npx @erdd/cli`, Windows) are in the
[CLI manual appendix](cli-guide.md#registry-publishing).

**Verified against a real server** — The `init --create` move in [7.2](#72-move-a-project-started-locally-to-a-server)
(`init --local` → add a word → `init --create` → `diff` shows everything as additions → `push`), `dict pull`,
`--adopt`, and `dict push` in [7.3](#73-use-shared-dictionaries--erdd-dict), and that `pull` in a directory connected
without a baseline lists every file and asks. The list is in the
[CLI manual appendix](cli-guide.md#shared-dictionaries-and-server-project-creation--real-server).

**Not verified with a server attached** — The manual procedure "Without create permission" in 7.2 was carried over from
reading the source and unit tests. The quoted messages were taken verbatim from the implementation and the expected
values in the tests.

**Basis** — `packages/cli/src/{commands/{init,serve}.ts,local/*,config.ts}`,
`packages/core/src/{layout,local}.ts`, and the local mode branches in `apps/web/src`.
When features change, this document must change with them.

---

**Next** — For the details of each editor screen, read the [user guide](user-guide.md). For every command, the file
formats, and CI, read the [CLI manual](cli-guide.md). When your team needs a shared server, read the
[installation and operations manual](install.md).
