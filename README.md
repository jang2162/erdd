<p align="center"><b>English</b> | <a href="README.ko.md">한국어</a></p>

<h1 align="center">ERDD</h1>

<p align="center">An open-source ERD tool for real-time collaborative design, Korean naming dictionaries, and schemas your code and AI agents can read.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@erdd/cli"><img src="https://img.shields.io/npm/v/@erdd/cli" alt="npm version of @erdd/cli"></a>
  <a href="https://github.com/jang2162/erdd/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jang2162/erdd/ci.yml?branch=main" alt="CI build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jang2162/erdd" alt="License"></a>
</p>

<p align="center">
  <img src="docs/manual/images/editor-overview.png" width="800" alt="The ERDD editor showing four related tables on the canvas, with the selected table's columns open for editing in the right panel">
</p>

## Overview

Database design in Korean teams usually depends on naming standards: approved word, term, and domain
dictionaries, plus table definition documents. Most ERD tools ignore those standards or keep the diagram
far from the code. ERDD lets you design an ERD together in the browser while checking every name against
your dictionaries. Its CLI stores the schema as YAML files in your repository, so pull requests and AI
agents read the same model. ERDD is for teams and individual developers who design relational schemas
and follow a naming standard.

> [!NOTE]
> The editor UI and CLI messages are currently in Korean.

ERDD runs in two modes. In **server mode**, you host a server and several people edit together. In
**local mode**, you open the same editor on YAML files in your repository without any server.

## Features

- Edit the same ERD with your team in real time, with version history, snapshots, and comparison.
- Check physical and logical names against word, term, and domain dictionaries as you type.
- Keep the schema as one YAML file per table, so changes show up as readable PR diffs.
- Import DDL, DBML, and Excel dictionaries, and export DDL, DBML, images, and Excel definition documents.
- Give AI agents a skill document so they edit the schema through the `erdd` CLI.
- Work alone in local mode with no account and no database, using git as the history.

## Installation

Requirements: Node.js 22 or later, and pnpm or npm.

Install the CLI in the project where you want to keep the schema. Declare `tsx` too, because the package
ships its original TypeScript.

```bash
pnpm add -D @erdd/cli tsx
```

Verify the installation:

```bash
pnpm exec erdd --version
```

```text
0.6.0
```

To host a server for your team, see the [installation and operations manual](docs/manual/en/install.md).
The recommended path uses Docker Compose and PostgreSQL 17.

## Quick Start

This example uses local mode, so you need no server.

1. Create a local-only project.

   ```bash
   pnpm exec erdd init --local
   ```

   ```text
   로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요
   ```

2. Open the editor.

   ```bash
   pnpm exec erdd serve
   ```

   ```text
   http://127.0.0.1:4300 에서 실행 중 (프로젝트: /path/to/your-project)
   중지하려면 Ctrl+C
   ```

   The browser opens the editor. Edits become files under `erdd/` when you press **저장** (Save) or
   Cmd+S.

3. After you save, check the model and commit it.

   ```bash
   pnpm exec erdd validate
   git add erdd erdd.config.yaml && git commit -m "Add schema"
   ```

   ```text
   정합성 문제 없음
   명명 경고 없음
   ```

## Documentation

- [Local mode manual](docs/manual/en/local-guide.md): using ERDD alone without a server, from start to
  finish
- [User guide](docs/manual/en/user-guide.md): how to use the browser editor
- [CLI manual](docs/manual/en/cli-guide.md): reference for every command and the file format
- [Installation and operations manual](docs/manual/en/install.md): hosting and running an ERDD server

The CLI packages are [`@erdd/cli`](https://www.npmjs.com/package/@erdd/cli) and
[`@erdd/core`](https://www.npmjs.com/package/@erdd/core) on the public npm registry.

## Contributing

Issues and pull requests are welcome. Developer documentation is written in Korean. Start with
[AGENTS.md](AGENTS.md), which maps each kind of change to the guide in [docs/guides/](docs/guides/) that
covers it.

## License

MIT License. See [LICENSE](LICENSE) for details.
