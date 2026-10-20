<p><b>English</b> | <a href="README.ko.md">한국어</a></p>

# @erdd/cli

ERDD **keeps your ER model as YAML files inside your repository and lets you edit them in a browser GUI.**
Each table is one file, so schema changes read directly in a PR diff. AI agents read those files too,
without digging through migrations or ORM code. This package is the `erdd` command-line tool. It covers
both **local mode**, where you work alone without a server, and **server mode**, where a team shares an
ERDD server. The browser editor is bundled inside the package, so `erdd serve` works without a separate
build.

## Installation

`@erdd/cli` and `@erdd/core` are on the **public npm registry** (registry.npmjs.org). No registry
configuration is needed. **Node.js 22 or later** is required. Both packages declare
`engines.node: ">=22"`, so your package manager warns or refuses on an older Node.

```bash
# Declare tsx alongside (see the warning below)
pnpm add -D @erdd/cli tsx
# with npm
npm install -D @erdd/cli tsx
```

Installing creates `node_modules/.bin/erdd`. Run it with `pnpm exec erdd …` (or `npx erdd …` with npm).
`@erdd/core` comes in as a dependency.

> [!WARNING]
> **Your tsconfig `target` must be `ES2022` or later if you import `@erdd/core`.** `@erdd/core` also
> ships its original TypeScript. When you `import` it, your project type-checks that `.ts` source with
> your own tsconfig. With a lower `target`, the errors appear **in `node_modules/@erdd/core/src/**`, not
> in your code** (25 errors measured with `ES2020`). Neither `skipLibCheck` nor `exclude` avoids this. The
> reasons and measurements are in the [`@erdd/core` README](../core/README.md). If you only use the CLI
> and never `import` `@erdd/core`, this does not apply.

> [!WARNING]
> **Do not leave out `tsx`.** This package contains **the original TypeScript, not build output**, and the
> binary's shebang is `#!/usr/bin/env -S npx tsx`. **`@erdd/cli` does not pull in `tsx` for you**, so you
> must declare it in your own project.
>
> **The symptom of leaving it out depends on the package manager.** Because the shebang goes through
> `npx`, **`npx` usually fetches `tsx` on the fly and the command runs anyway.** The first run is slower
> and depends on registry access. Without a network it fails, and with npm's flat layout and no cache it
> fails with `ENOTCACHED`. **An explicit declaration is the only path that works with every package
> manager.**

## Two ways to use it

|                  | **Local mode**                                                      | **Server mode**                                                                                      |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| When             | You design alone. There is no server, or you do not want to run one | Several people edit the same project at the same time                                                |
| Source of truth  | The `erdd/` files                                                   | The server database (local files are a working copy)                                                 |
| What you need    | This package only. No account, no database                          | An ERDD server and an access token on top                                                            |
| Edit history     | **git commits**                                                     | Server revisions (+ git)                                                                             |
| Layout and memos | `erdd/layout.yaml` (commit it)                                      | The server database. Moves made in `erdd serve` still land in `erdd/layout.yaml` (see warning below) |

**The two are not exclusive.** You can open a server-connected project with `erdd serve` to tidy up the
diagram.

> [!WARNING]
> **Whether `erdd/layout.yaml` exists depends on using `erdd serve`, not on the mode.** If you move tables
> or write memos in the `serve` screen of a server-connected project, that file is created and updated.
> It holds **memo text** as well as coordinates, so do not delete it as leftover. **Commit it.** It does
> **not travel to or from the server**: `push` does not send it and `pull` does not overwrite it. Layout on
> the server side is handled in the web editor.

### Local mode: no server, account, or database

```bash
erdd init --local          # creates erdd.config.yaml (serverUrl and projectId are null)
erdd serve                 # opens the editor at http://127.0.0.1:4300 with no login screen
                           # edits become erdd/ files only when you press Save (Cmd+S)
# ... edit in the browser and save with Cmd+S ...
erdd validate              # checks referential integrity and naming rules
git add erdd erdd.config.yaml && git commit -m "schema: add member grade column"
```

That commit is **the whole history** in local mode. Undo with `git revert` and compare with `git diff`.

### Server mode: working as a team

```bash
erdd init                  # asks for the server URL, token, and project
erdd pull                  # writes the server schema to files (overwrites local changes)
# ... edit files under erdd/ ...
erdd validate              # pre-check without calling the server
erdd diff                  # previews outgoing changes, incoming changes, and conflicts
erdd push -m "add member grade column"
```

## Commands

| Command                             | What it does                                                                                                                                                                     | Mode            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `erdd init`                         | Connects to a server (URL, token, project). Non-interactive: `--server` · `--token` · `--project`. Overwrite an existing config with `--yes`                                     | Server          |
| `erdd init --create`                | Creates a project on the server and connects to it (`--org` · `--name`). A local-only project keeps its `erdd/` and migrates. Follow with `diff` → `push`                        | Server          |
| `erdd init --local`                 | Creates a local-only project with no server (`--dialect` · `--case`)                                                                                                             | Local           |
| `erdd serve`                        | Starts a local server for editing in the browser (`--port` · `--no-open`)                                                                                                        | Both            |
| `erdd validate`                     | Checks referential integrity and naming rules without a server (`--strict`)                                                                                                      | Both            |
| `erdd export`                       | Exports local files as DDL or DBML (`--format` · `--dialect` · `-o`). Only the body goes to stdout; warnings go to stderr                                                        | Both            |
| `erdd import <file>`                | **Merges** a DDL or DBML file into local files (`--format` · `--dialect` · `--dry-run`). Use `push` to send it to the server                                                     | Both            |
| `erdd status`                       | Shows connection info and local changes without calling the server                                                                                                               | Both            |
| `erdd pull`                         | Writes the server schema to files                                                                                                                                                | **Server only** |
| `erdd diff`                         | Previews outgoing changes, incoming changes, and conflicts (`--strict`)                                                                                                          | **Server only** |
| `erdd push`                         | Applies changes to the server (three-way merge; stops on conflict)                                                                                                               | **Server only** |
| `erdd dict list·pull·push·requests` | Fetches organization and global shared dictionaries (`pull` records origins in `erdd/origins.yaml`) and uploads them (`push` sends a promotion request when you lack permission) | **Server only** |
| `erdd skill install`                | Installs the agent skill document into the project (`--dir` · `--force`)                                                                                                         | Both            |

> [!WARNING]
> **In a local-only project, `pull`, `push`, and `diff` stop with exit code `1`.** There is no server to
> call (`erdd.config.yaml에 연결 설정이 없습니다 …`). In local mode, git takes the place of those three.
> `status` runs in local mode, but it has no baseline (the last pull), so it always reports no local
> changes.

Run `erdd --help` (`-h`) for full usage and the flag list.

## Using it with AI agents

```bash
erdd skill install                 # → .claude/skills/erdd/SKILL.md
```

This installs the bundled skill document. **It covers both modes.** The agent first checks `serverUrl` in
`erdd.config.yaml` to detect the mode. It then follows the matching workflow (`pull` → `push` in server
mode, file edits plus git commits in local mode) and its prohibitions. Change the install location with
`--dir`.

**There is no MCP server.** Agent integration is this CLI plus the skill document.

## Documentation

The four manuals ship inside this package, in English (original) and Korean (translation). The links
below open **only in the installed file tree (`node_modules/@erdd/cli/docs/`)**. On the npmjs.com package
page or in the GitHub repository, that path is empty by design. The manuals are copied from the
repository's `docs/manual/en/` and `docs/manual/ko/` when the package is packed.

- [Local mode manual](./docs/en/local-guide.md): the serverless path from start to finish. **If you only
  use local mode, this one document is enough**
- [CLI manual](./docs/en/cli-guide.md): reference for every command, the file format, conflict handling,
  and CI
- [User guide](./docs/en/user-guide.md): how to use the browser editor (both modes share the same screen)
- [Installation and operations manual](./docs/en/install.md): running an ERDD **server**. Not needed for
  local mode

## Automation

Every command supports `--json`. stdout is always parseable JSON and progress messages go to stderr. Skip
confirmation prompts with `--yes`. Exit codes are `0` for success, `1` for failure (validation failure,
conflict, server error, cancellation), and `2` for usage errors.

## License

MIT License. See [LICENSE](LICENSE) for details.
