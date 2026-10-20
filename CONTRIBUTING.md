# Contributing to ERDD

This page shows you how to set up a development environment, make a change, and send it back. It is for
anyone who wants to fix a bug, improve the documentation, or add a feature to ERDD.

Issues and pull requests are welcome. If you plan a large change, open an issue first so we can agree on
the direction before you write code.

> [!NOTE]
> The developer guides and commit messages in this repository are written in Korean. This page is a
> short map in English. The rules themselves live in the Korean guides it links to.

## Where the rules live

This page does not repeat the project rules. It points to the documents that own them.

| Document                           | What it owns                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)             | The working rules for people and AI agents. It also maps each kind of change to the guide that covers it.             |
| [docs/guides/](docs/guides/)       | The rules for each area of the code: data layer, naming, DDL parser, export format, realtime, CLI, release, and more. |
| [docs/manual/en/](docs/manual/en/) | The user manuals. Update them when you change product behavior or on-screen text.                                     |

`AGENTS.md` is generated. Edit its sources under `.ruler/` and run `pnpm exec ruler apply` instead of
editing `AGENTS.md` directly.

## Set up the development environment

Requirements: Node.js 22 and pnpm 10.4.1, as pinned in `mise.toml`, and Docker for the PostgreSQL
database.

1. Install the pinned runtimes with [mise](https://mise.jdx.dev/).

   ```bash
   mise install
   ```

2. Install the dependencies. Use pnpm only, not npm or yarn. This also installs the Git hooks.

   ```bash
   pnpm install
   ```

3. Copy the environment file and start only the database service. The service creates the
   development database `erdd`.

   ```bash
   cp .env.example .env
   docker compose up -d db
   ```

4. Apply the migrations to the development database. `pnpm db:migrate` reads `DATABASE_URL` from `.env`.

   ```bash
   pnpm db:migrate
   ```

5. Create the test database `erdd_test` and apply the migrations to it. Pass `DATABASE_URL` inline and
   call `drizzle-kit` directly, because `pnpm db:*` always uses the value in `.env`.

   ```bash
   docker compose exec -T db createdb -U postgres erdd_test
   DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm -C apps/server exec drizzle-kit migrate
   ```

6. Start the server on port 3000 and the web editor on port 5173.

   ```bash
   pnpm dev
   ```

The database names, the migration commands, and the ports are in
[docs/guides/setup.md](docs/guides/setup.md), sections 「DB」 and 「마이그레이션」.

## Make a change in a worktree

Make every code change in its own Git worktree under `.worktrees/`, branched from your local `main`.
Do not switch branches in the top-level checkout.

```bash
git worktree add -b feat/<name> .worktrees/feat-<name> main
```

Each worktree needs its own ports and databases. The full flow, including setup and cleanup, is in
[docs/guides/worktree-workflow.md](docs/guides/worktree-workflow.md).

## Run the tests

Run the tests against the test database `erdd_test`, never against the development database.

> [!WARNING]
> Do not load `.env` before you run the tests. The server tests truncate every table in the database that
> `DATABASE_URL` points to, and `.env` points to your development database.

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm verify
```

`pnpm verify` runs the type check and all four test suites. Check the number of tests that ran, not only
the exit code. The server suite skips most tests when `DATABASE_URL` is missing. The details are in
[docs/guides/setup.md](docs/guides/setup.md), section 「테스트」.

Format and lint your change before you commit it.

```bash
pnpm fmt
pnpm lint
```

## Commit your change

- Stage files by path. Do not use `git add -A` or `git commit -a`.
- Write the commit message in Korean, following the existing history (for example,
  `docs(manual): …`).
- Do not commit `.env` or `.idea/`.

The commit rules and their reasons are in [docs/guides/worktree-workflow.md](docs/guides/worktree-workflow.md),
section 「커밋」.

## Update the documentation with the code

- **Product behavior or on-screen text:** update the English manual in `docs/manual/en/` and the Korean
  translation in `docs/manual/ko/` in the same pull request.
- **Anything a release ships:** add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- **A rule for contributors:** add it to the guide in `docs/guides/` that owns that area.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
