# ERDD installation and operations manual

This document is for the person who installs and runs ERDD on their own server. For using the editor,
see the [user guide](user-guide.md). For the command-line tool, see the [CLI manual](cli-guide.md).
For the contributor workflow, see the [development environment guide](../../guides/setup.md).

> ⚠️ **If you work alone, you do not need this document.** ERDD has a **local mode** that opens the same
> web editor from the YAML files in your repository, with no server, account, or database. It takes one
> command: `erdd serve`. You need this document (Docker, PostgreSQL, a reverse proxy, account management)
> only **when several people edit one project at the same time and you need separate accounts,
> permissions, and organizations**. The [local mode manual](local-guide.md) explains how to decide and how
> to use it.

## 1. Overview

You install **two things**.

```text
  Browser ──HTTPS──▶ [ Reverse proxy ] ──HTTP :3000──▶ ┌─────────────────────────┐
                      TLS termination (9.6)            │ ERDD server (Node 22)    │
                                                       │  /        static web(SPA)│
                                                       │  /trpc/*  API            │
                                                       │  /ws      real-time      │
                                                       └───────────┬─────────────┘
                                                         TCP :5432 ▼
                                                       [ PostgreSQL 17 ]
```

- **The server is a single process.** One process serves the API, the static web files, and the
  WebSocket. When `apps/web/dist` exists, the server registers it as the static root and sends every
  unmatched path that does not start with `/trpc` to `index.html` (SPA fallback). You do not need a
  separate web server.
- **All state lives in PostgreSQL.** There is no file upload storage and nothing is written to disk.
  The database is the only thing you back up (8.2).
- **The server does not do TLS.** If you need HTTPS, put a reverse proxy in front of it (section 7).

There are two ways to install: **Method A (Docker Compose)** and **Method B (run from source)**. Use
Method A unless you already run Postgres or cannot use Docker.

## 2. Requirements

| Item | Method A | Method B | Source |
|---|---|---|---|
| Docker | Engine + Compose v2 | — | |
| Node.js | (included in the image) | 22 | `mise.toml` |
| pnpm | (included in the image) | 10.4.1 — set it with `corepack enable` | `packageManager` in `package.json` |
| PostgreSQL | (`db` in compose) | 17 | `docker-compose.yml` |
| Ports to open | `3000` (app; change the host side with `ERDD_PORT`). The DB binds only to the host loopback, so do not open it | `3000` (app; change with `PORT`) · `5432` (DB) | |

Supported architectures are those of the base image `node:22-slim` (x86_64 / arm64). The build needs
access to the npm registry. On an air-gapped network, build the image elsewhere and move it with
`docker save`/`load`.

## 3. Method A: Docker Compose (recommended)

### 3.1 Get the source and write `.env`

```bash
git clone <repository URL> erdd
cd erdd
cp .env.example .env
```

Open `.env` and fill in at least these three values. **This file is not committed to the repository.**

```dotenv
POSTGRES_PASSWORD=<DB password>
ADMIN_EMAIL=admin@your-domain.example
ADMIN_PASSWORD=<a long temporary password>
```

- **Set `POSTGRES_PASSWORD` now, before the first start.** Postgres applies this value **only when it
  first initializes the data directory**. If you change it on an installation that already has a
  `pgdata` volume, compose connects with the new value while the DB keeps the old password, so **the app
  fails to start with an authentication error** (verified). To change it later, run
  `ALTER USER postgres PASSWORD …` inside the DB and update `.env` at the same time. If you leave it out,
  the default `erdd` is used. Always change it in production.
- A password that contains `@ : / # ?` breaks the connection URL. Percent-encode it or avoid those
  characters.
- `docker compose` **reads `.env` in the same directory automatically** and substitutes the `${...}`
  references in the compose file. The app container receives `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
  `NODE_ENV` (→ `ERDD_NODE_ENV` in section 5), and a `DATABASE_URL` assembled from `POSTGRES_PASSWORD`.
- **The containers do not use `DATABASE_URL` from `.env`.** In `docker-compose.yml`, the `migrate` and
  `app` services both assemble the DB address as `postgres://postgres:${POSTGRES_PASSWORD}@db:5432/erdd`
  (on the compose network the host name is `db`). The value in `.env` is for tools such as `psql` that
  you run on the host.
- The compose project name comes from the **directory name**, and the volume name
  (`<project>_pgdata`) depends on it. If you move or rename the directory, the DB appears to be lost. If
  you plan to move it, pin `COMPOSE_PROJECT_NAME` in `.env`. When you deploy with a compose management
  tool, the stack name is the project name (3.5).

### 3.2 Build, migrate, and start in one step

```bash
docker compose up -d --build
docker compose ps -a
```

This one command does the following, in order.

1. **Build the images.** `migrate` and `app` each build from the same `Dockerfile` and context. The two
   builds share the same stages. With the classic builder, the second build finishes immediately from
   the first build's cache (verified; see the appendix for BuildKit). The first build takes a long time
   because it installs dependencies and builds the web app.
   ⚠️ **Do not build only one of them** (by naming a service, as in `docker compose build app`).
   `migrate` stays on the old image, exits with 0 without knowing about the new migration, and the new
   `app` starts without the new schema, which causes the symptom in 9.3. Always build without naming a
   service (`up -d --build`, `docker compose build`).
2. **Start `db`.** Compose waits until the `pg_isready` healthcheck passes and the service is healthy.
3. **Run `migrate`.** It runs `pnpm --filter @erdd/server db:migrate` (drizzle-kit) once and exits. If
   there is nothing to apply, it does nothing and exits with 0, so running it again on every `up` is
   harmless.
4. **Start `app`.** It starts **only after `migrate` exits with 0**
   (`depends_on: {migrate: {condition: service_completed_successfully}}`).

Expected result (`docker compose ps -a`, relevant columns only):

```text
SERVICE   STATUS
app       Up … (healthy)
db        Up … (healthy)
migrate   Exited (0) …
```

`migrate` staying at `Exited (0)` is normal. It is a service that runs once and exits
(`restart: "no"`). Because of the healthcheck interval, `app` can take tens of seconds to become
`(healthy)`.

**Migrations run as a separate service because of the schema.** The server does not apply migrations
itself. It queries the DB at startup (admin bootstrap, global shared resource seed). Even when the
connection works, **if the tables are missing** it fails at that point and the process exits (9.3). The
`db` healthcheck checks only whether a connection is possible, not the schema, so `migrate` is what
guarantees the schema.

**If `migrate` fails, the app does not start.** `up` ends with the following line and returns exit code
1. In `docker compose ps -a`, `migrate` shows `Exited (1)` and `app` stays at `Created`.

```text
service "migrate" didn't complete successfully: exit 1
```

Look for the cause in two logs.

```bash
docker compose logs migrate
docker compose logs db | grep FATAL
```

⚠️ **The `migrate` log may not show the cause.** When it fails because the DB password does not match,
the `migrate` log shows only `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … Exit status 1` after
`applying migrations...`. The actual cause, `FATAL:  password authentication failed for user "postgres"`,
appears **only in the `db` log**. This error appears when you **change `POSTGRES_PASSWORD` while an
existing `pgdata` volume is present** (9.8). After you fix the cause, run the same
`docker compose up -d --build` again.

> ⚠️ `db` binds **only to the host loopback (`127.0.0.1`)** (the port defaults to `5432`; move it with
> `ERDD_DB_PORT`). You can attach `psql` from that server, but other machines cannot reach it. The app and
> `migrate` connect over the compose network, so this port does not affect them. If you need to expose
> it, edit `db.ports` in `docker-compose.yml` directly. When you do, keep in mind that **ports published
> by Docker bypass the host firewall (ufw and others)**.

### 3.3 Startup log and admin bootstrap

```bash
docker compose logs app
```

Expected output on the first start (the identifier on the second line differs every time):

```text
부트스트랩 관리자 계정 생성: admin@your-domain.example
예시 전역 공용 리소스 라이브러리 생성: <식별자>
ERDD server listening on :3000
```

- The first line (bootstrap admin account created) appears **only when the server actually creates the
  admin account**. If an account with that email already exists, the server does nothing. **It does not
  overwrite the existing password.** Changing `ADMIN_PASSWORD` and restarting therefore does not change
  the password. If you forgot it, another admin has to issue a reset link.
- If either `ADMIN_EMAIL` or `ADMIN_PASSWORD` is empty, the server skips the bootstrap entirely.
- The second line (example global shared resource library created) appears when the server seeds the
  example global shared resource ("표준 사전(예시)", the example standard dictionary). If a global
  library already exists, the server skips this step, so from the second start on only the listen line
  remains.

After you create the first admin, you can remove `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.

### 3.4 Check the connection

```bash
curl -s http://127.0.0.1:3000/trpc/health.ping
```

Expected result:

```json
{"result":{"data":{"ok":true,"version":"0.1.0"}}}
```

`health.ping` returns 200 even without a DB. **It checks liveness only.** To check the DB as well, see
8.3.

Now open `http://<server>:3000` in a browser. The login screen should appear. However, **login does not
complete over plain HTTP** (9.6). Set up the reverse proxy in section 7 first.

### 3.5 Deploying with a compose management tool (Komodo and others)

If you use a tool that builds and deploys a compose file from a Git repository on your server, the
procedure is the same as 3.1–3.4. This section covers only what the tool does for you and what changes
because of the tool.

- **Use the repository's `docker-compose.yml` as is, and enable builds on deploy.** This compose file
  builds images from source rather than pulling them from a registry. If one deploy is equivalent to
  `docker compose up -d --build` in 3.2, the build, migration, and start all happen there.
- **Do not add a separate pre-deploy command (hook) for migrations.** The `migrate` service does that.
  If you run it from a hook, you must match the compose project name (`-p`) to the tool exactly. If it
  does not match, **the migration runs against a separate, empty DB and stops there.**
- **It is fine if the tool runs `docker compose pull` before deploying.** `migrate` and `app` have no
  image name, so they are skipped with `Skipped No image to be pulled`, and only `postgres:17` is pulled.
- **Put environment variables into the tool.** If the tool writes them to a `.env` next to the compose
  file, substitution works exactly as in 3.1. The values to set are the three from 3.1 and the compose
  variable table in section 5.
- **Set `POSTGRES_PASSWORD` before the first deploy** (3.1). If the first deploy initializes the DB with
  the default `erdd`, changing the value in the tool later makes `migrate` stop with an authentication
  failure (9.8).
- ⚠️ **The stack name is the compose project name, and the volume name (`<stack name>_pgdata`) depends
  on it.** If you rename the stack or create a new stack from the same repository, **a new, empty DB is
  created**. The old volume remains but is not attached. This is the same trap as the project name item
  in 3.1.
- **For HTTPS and `/ws`**, put a proxy in front as described in section 7. If the proxy runs on the same
  server, set `ERDD_PORT` to `127.0.0.1:3000` (section 7).
- **It is normal for the tool to show `migrate` as an exited service.** It runs once and exits, so
  `Exited (0)` is its normal state (3.2). `Exited (1)` is abnormal, and in that case `app` is not
  running.
- **When you run backup or `exec` commands from the server shell, add `-p <stack name>`.** The tool
  keeps the compose file in its own working directory, so if you run `docker compose` outside it, compose
  cannot find the project. With `-p`, `exec` and `logs` work even from a directory without a compose
  file.

  ```bash
  docker compose -p <stack name> exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql
  docker compose -p <stack name> logs migrate
  ```

#### Komodo Stack settings

| Item | Value |
| --- | --- |
| Source | Git Repo — `github.com` / `jang2162/erdd` / branch `main` |
| File Paths | `docker-compose.yml` |
| Environment | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `ERDD_PORT`. Reference secrets as Komodo Variables (Secret), for example `[[ERDD_POSTGRES_PASSWORD]]` |
| Webhook | Off — a redeploy recreates `app` and drops the real-time editing connections (`/ws`) |

The Stack Environment becomes the `.env` that compose uses for `${VAR}` substitution. To add a new
variable, write it in the compose file's `environment:` first, then add it to Environment.

## 4. Method B: Run from source

This method assumes PostgreSQL 17 is already running and you have an empty DB and its connection
details.

### 4.1 Build

```bash
git clone <repository URL> /opt/erdd
cd /opt/erdd
corepack enable                 # activates pnpm 10.4.1
pnpm install --frozen-lockfile
pnpm --filter @erdd/web build   # creates apps/web/dist; the server needs it to serve the web app
```

Check that `apps/web/dist/index.html` exists. Without it, the server serves only the API and a browser
gets 404.

### 4.2 Migrate

```bash
export DATABASE_URL='postgres://<user>:<pass>@<host>:5432/<db>'
pnpm --filter @erdd/server db:migrate
```

### 4.3 Run

```bash
NODE_ENV=production \
DATABASE_URL='postgres://<user>:<pass>@<host>:5432/<db>' \
ADMIN_EMAIL='admin@your-domain.example' \
ADMIN_PASSWORD='<temporary password>' \
pnpm --filter @erdd/server start
```

Expected result: `ERDD server listening on :3000`.

### 4.4 Example systemd unit

Change the path (`/opt/erdd`) and `User` to match your environment. `ExecStart` calls `tsx` directly
instead of going through pnpm or corepack. This is the same invocation the Docker image uses.

`/etc/systemd/system/erdd.service`:

```ini
[Unit]
Description=ERDD server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=erdd
Group=erdd
WorkingDirectory=/opt/erdd
EnvironmentFile=/etc/erdd/erdd.env
ExecStart=/opt/erdd/apps/server/node_modules/.bin/tsx /opt/erdd/apps/server/src/main.ts
Restart=on-failure
RestartSec=5
# On SIGTERM the server closes its connections and exits on its own.
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

`/etc/erdd/erdd.env` (mode `0600`, owner `erdd`):

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://erdd:<pass>@127.0.0.1:5432/erdd
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now erdd
journalctl -u erdd -f      # you should see: ERDD server listening on :3000
```

## 5. Environment variables

The table below lists every place where the server code reads `process.env`.

| Name | Required | Default | Description | Read in |
|---|---|---|---|---|
| `DATABASE_URL` | **Yes** | None | PostgreSQL connection string. Without it, the server starts but every API returns 412 (9.1). | `apps/server/src/main.ts`, `apps/server/drizzle.config.ts` |
| `PORT` | No | `3000` | Listen port. The bind address is always `0.0.0.0`. **Compose does not pass this value to the app container.** To move the port in Method A, use `ERDD_PORT` below. | `apps/server/src/main.ts` |
| `NODE_ENV` | No | None | Only when it is `production` does the session cookie get `Secure`. **This is the only behavior this variable changes in the server code**, and the only place that reads it is `auth.login` (read on every login request). The Docker image hardcodes `production`, and compose fills this value from `ERDD_NODE_ENV`. | `apps/server/src/routers/auth.ts` |
| `ADMIN_EMAIL` | No | None | Initial admin bootstrap. It works only when **both** this and `ADMIN_PASSWORD` are set. | `apps/server/src/services/accounts.ts` |
| `ADMIN_PASSWORD` | No | None | Same as above. Used only when no account exists for that email. | 〃 |

**The server does not read `.env` files itself.** It does not use dotenv or similar, so values must come
in through the shell environment, systemd `EnvironmentFile`, or compose.

Variables that **compose reads**, not the app. Put them in `.env` and compose substitutes them:

| Name | Default | What it controls |
|---|---|---|
| `POSTGRES_PASSWORD` | `erdd` | The password of `db`, and the value assembled into the `DATABASE_URL` of `migrate` and `app`. **Applied only when the data directory is initialized** (the trap in 3.1). |
| `ERDD_PORT` | `3000` | Which host port the app container binds to. A port alone binds to all interfaces. **Prefix a host address, as in `127.0.0.1:3000`, to bind only to that address** (when it sits behind a reverse proxy; see section 7). The container side is fixed at `3000` (the port mapping and healthcheck use that value). |
| `ERDD_DB_PORT` | `5432` | Which port on the host **loopback (`127.0.0.1`)** the `db` container binds to. This is for attaching tools such as `psql` from the host. The app and `migrate` do not depend on it. For external exposure, see 3.2. |
| `ERDD_NODE_ENV` | `production` | The app container's `NODE_ENV`. **The name is intentionally not `NODE_ENV`.** Otherwise a `NODE_ENV` left over in the operator's shell could leak in and silently turn off the cookie's `Secure`. |

Other variables that do not affect operations:

| Name | Used for |
|---|---|
| `ERDD_SERVER_PORT` | **Development only.** The proxy target port of the vite dev server (`apps/web/vite.config.ts`). It does not affect production builds. |
| `ERDD_WEB_PORT` | **Development only.** The port the vite dev server listens on (`apps/web/vite.config.ts`). Unset or empty means the default `5173`. A value that does not parse as a port does not silently fall back to the default; it fails with an error. It does not affect production builds. |
| `ERDD_WEB_HOST` | **Development only.** The bind address of the vite dev server (`apps/web/vite.config.ts`). Unset or empty means the default `127.0.0.1`. An empty value also falls back to the default because a browser cannot connect when vite binds only to IPv6 `[::1]`. It does not affect production builds. |
| `ERDD_TOKEN` | The access token the `erdd` CLI uses (`packages/cli`). It does not affect the server (→ [CLI manual](cli-guide.md)). |

## 6. After the first start

**There is no self sign-up.** Accounts are invite-only: an admin issues a one-time invite link and
hands it over. **ERDD does not send email.** The link appears on screen, and the admin delivers it.

1. **Log in as the admin** with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from 3.3.
2. **Change the admin password.** The bootstrap password remains in plain text in environment variables
   and deploy history.
3. **Invite users.** On the admin page, enter an email and a service role, issue an invite link, and
   send it. When the invitee opens the link and sets a name and password, ERDD creates the account and a
   personal organization together.
4. **Create team organizations and add members.** Create an organization. Find users who already have an
   account by email and add them. For people without an account, issue an organization invite link.

For the screens themselves, see the [user guide](user-guide.md).

> ⚠️ **Invite and reset links are built from "the address the admin is using".** The link URL is
> assembled by appending a path to the origin the browser is currently connected to. If an admin
> connects through `http://10.0.0.5:3000` and creates a link, that address is baked into the link and it
> does not open from outside the office. **Admins must connect through the same public address as users**
> when they issue links.

## 7. Reverse proxy

**The server does not terminate TLS.** If you need HTTPS, put a proxy in front of it. Because the session
cookie gets `Secure`, this is effectively required (9.6).

nginx example:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name erdd.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name erdd.example.com;

    ssl_certificate     /etc/ssl/certs/erdd.crt;
    ssl_certificate_key /etc/ssl/private/erdd.key;

    # The server's body limit is 16 MiB (large bulk-edit batches must pass).
    # If this is smaller, nginx cuts large edits off with 413.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Real-time collaboration. Without the upgrade, edits save but others' changes do not appear (9.4).
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # The server sends a ping every 30 seconds. A shorter idle timeout keeps dropping the connection.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Keep in mind:

- **The server does not currently read `X-Forwarded-*`** (`trustProxy` is not enabled in Fastify). You
  set them by convention and for the future. Whether the cookie is `Secure` is decided only by
  `NODE_ENV`, not by these headers.
- To restrict the app to the proxy, put `ERDD_PORT=127.0.0.1:3000` in `.env`. Compose expands the port
  mapping to `"127.0.0.1:3000:3000"` and binds only to the loopback. You do not need to edit the compose
  file. Apply it with `docker compose up -d` (the app container is recreated).
- Serving under a subpath (such as `/erdd/`) is not a verified setup. Use a subdomain or a dedicated host.

## 8. Operations

### 8.1 Upgrade

**Order matters: update the code → build → migrate → restart.** If you start code that needs a new schema
first, the server fails while querying the DB at startup and enters a restart loop. In Method A, compose
keeps this order for you.

```bash
cd /opt/erdd
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql   # back up (8.2)
git pull
docker compose up -d --build
docker compose ps -a
docker compose logs app | tail -3
```

`up -d --build` builds the new images, then **stops and removes the old `app` container**, runs
`migrate`, and starts the new `app` when `migrate` exits with 0. **The old `app` is already stopped
before `migrate` starts**, so the old code never runs on the new schema. You do not need to run
`docker compose stop app` first. This order was verified by recording container events with
`docker events --filter label=com.docker.compose.project=<project>` while running `up -d --build` with
changed images. The old `app`'s `stop` and `destroy` come before `migrate`'s `start`
(Docker Compose v5.1.4). If you are unsure about the order on another compose version, running
`docker compose stop app` first does no harm.

- **If `migrate` fails, the service stays down.** The old `app` is already down and the new `app` does
  not start (the failure in 3.2). Fix the cause and run the same command again. If you need to roll
  back, restore from the backup you took above (8.2).
- **If the images are unchanged** (the code did not change), compose leaves the `app` container alone
  and only runs `migrate` again.

In Method B, keep the order by hand: `systemctl stop erdd` → `git pull` →
`pnpm install --frozen-lockfile` → `pnpm --filter @erdd/web build` → `db:migrate` →
`systemctl start erdd`.

- **The service is down during an upgrade.** There is only one process, so zero-downtime rolling
  replacement is not supported.
- **Back up before you upgrade** (8.2). Migrations have no rollback scripts.

### 8.2 Back up and restore

All state lives in PostgreSQL. There is no file upload storage, so **one DB dump is a full backup**.

```bash
# Back up
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql

# Restore into an empty DB
docker compose stop app                      # stop writes
docker compose exec -T db psql -U postgres -d erdd < erdd-2026-08-10.sql
docker compose up -d app
```

- The commands above correctly have no password. `docker compose exec` runs **inside** the container,
  and the default Postgres `pg_hba.conf` sets local and loopback connections to `trust` (verified). These
  commands keep working after you change `POSTGRES_PASSWORD`.
- The target DB must be empty. To restore over an existing DB, drop and recreate it, or use
  `pg_dump -Fc` + `pg_restore --clean --if-exists`.
- You can also snapshot the whole compose volume (`<project>_pgdata`), but you must copy it **with the
  containers stopped**.

### 8.3 Health checks

| Purpose | Command | Healthy |
|---|---|---|
| Is the process alive? | `curl -s http://127.0.0.1:3000/trpc/health.ping` | `{"result":{"data":{"ok":true,"version":"0.1.0"}}}` |
| Is the DB connected too? | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/trpc/auth.me` | Healthy **if it is not 412**. Without a login you get 401. |

`health.ping` is a public procedure that needs no authentication, and **it returns 200 even without a
DB.** If you want your load balancer to reflect DB status, use the second row.

`docker compose ps -a` shows the status of all three services at once. `db` and `app` have healthchecks.
`migrate` runs once and exits, so `Exited (0)` is normal (without `-a` it drops out of the list).

| Service | Check | Notes |
|---|---|---|
| `db` | `pg_isready -U postgres -d erdd -h 127.0.0.1` | `-h 127.0.0.1` is required. During initialization a temporary server runs with `listen_addresses=''` and does not open TCP, so a check over the Unix socket reports "ready" before the DB exists. |
| `app` | The same `health.ping` call as the first row of the table above | The image has no curl or wget, so it calls the endpoint with Node's `fetch`. |

Because the `app` healthcheck uses `health.ping`, **it does not reflect DB status.** To include the DB,
use the second row of the first table from external monitoring.

### 8.4 Logs

```bash
docker compose logs -f app     # Method A
docker compose logs migrate    # Method A, last migration run
journalctl -u erdd -f          # Method B
```

**The server does not write HTTP access logs** (the Fastify logger is turned off). Standard output
contains essentially only the following.

- `ERDD server listening on :<port>` — the server started
- `부트스트랩 관리자 계정 생성: <이메일>` — the server actually created the admin
- `예시 전역 공용 리소스 라이브러리 생성: <식별자>` — the server seeded the example global shared resource
- A stack trace on startup failure (the process exits after it)

For per-request access records, response times, and status codes, use the **reverse proxy's access
log**.

## 9. Troubleshooting

### 9.1 The screen shows "연결에 문제가 있습니다" (the most common case)

The message means "there is a problem with the connection".

**Cause:** `DATABASE_URL` did not reach the server process. In this case the server **starts normally**.
The log shows only `ERDD server listening on :3000` with no error, which makes it confusing. A server
started without a DB rejects every procedure that uses the DB with 412.

```bash
curl -s http://127.0.0.1:3000/trpc/auth.me
# {"error":{"message":"DB가 구성되지 않았습니다", ... "httpStatus":412 ...}}
```

If you see this message ("the DB is not configured"), that confirms it. **Fix:** check whether the value
actually reached the process.

```bash
docker compose exec app printenv DATABASE_URL     # Method A
sudo systemctl show erdd -p Environment           # Method B (does not show EnvironmentFile contents)
```

Three common mistakes: you wrote it only in `.env` and did not export it in the shell (the server does
not read `.env`); a typo in the systemd `EnvironmentFile` path; in compose, you edited `DATABASE_URL` in
`.env` instead of the `app` service (the container does not use that value).

### 9.2 The port is already in use

**Symptom:** In Method A, `docker compose up` fails with `port is already allocated`. In Method B, the
process prints a `listen EADDRINUSE` error right after startup and exits. The compose app keeps
restarting because of `restart: unless-stopped`.

```bash
ss -lntp | grep -E ':(3000|5432)\b'        # who holds the port
echo 'ERDD_PORT=3100' >> .env              # Method A: move only the host-side port
docker compose up -d app
PORT=3100 ... pnpm --filter @erdd/server start   # Method B
```

If 5432 conflicts (for example, Postgres already runs on the same server), move only the host-side port
in `.env`, as in `ERDD_DB_PORT=5433`. If you never connect to the DB directly from the server, you can
remove `db.ports` from `docker-compose.yml`. The app and `migrate` connect over the compose network, so
they do not need a host port.

### 9.3 Migrations were not applied

In **Method A**, `migrate` runs before `app`, and `app` starts only when `migrate` exits with 0. As long
as you build both services together (3.2), the app never starts without the schema. Building only `app`
is the exception. Rebuild both with `docker compose up -d --build`. On the other hand, **if `migrate`
fails, the app does not start at all.** `up` ends with
`service "migrate" didn't complete successfully: exit 1`, and in `docker compose ps -a`, `migrate` is
`Exited (1)` and `app` is `Created`. See the failure item in 3.2 for how to find the cause and fix it.
After you fix the cause, run the same command again.

```bash
docker compose up -d --build
```

Symptom in **Method B** (or when you point the server at a DB without the schema): the server exits
during startup. The log shows a Postgres error such as `relation "users" does not exist` and a stack
trace, and the process ends. `ERDD server listening on` **does not appear.** Under systemd,
`Restart=on-failure` keeps restarting it.

The startup sequence is `admin bootstrap → global resource seed → listen`, so a missing schema fails
before listen. If you filled in `ADMIN_EMAIL`/`ADMIN_PASSWORD` as in 3.1, the bootstrap queries `users`
first, so that table fails first. If you left both empty, the bootstrap skips without a query and
`relation "resource_libraries" does not exist` appears first. Either way, the cause is the same.

**Fix:** run 4.2, then start the server again.

### 9.4 Real-time collaboration does not work

**Symptom:** Your edits are saved (they remain after a reload), but you cannot see other people's
changes and cursors. Or it works for a while and then drops periodically.

Saving edits goes through `/trpc`, and receiving others' changes goes through `/ws`. That is why
**saving works but collaboration does not**. The cause is almost always the proxy.

To check: open the browser developer tools → Network → WS tab and look at the `/ws?projectId=…`
request.

| Observation | Cause |
|---|---|
| The request is not `101 Switching Protocols` | The proxy does not forward the `Upgrade`/`Connection` headers → the `location /ws` block in section 7. |
| 101 works, but it drops every few tens of seconds | The proxy's idle timeout is short. The server pings every 30 seconds, so give `proxy_read_timeout` plenty of room (for example, 300s). |
| It closes immediately | There is no login session, or you lack permission to view that project. Socket authentication uses the same session cookie as tRPC. |

### 9.5 Invite or password reset links do not open

The expiry times are as follows.

| Link | Valid for | Reuse |
|---|---|---|
| Invite | **7 days** | Single use |
| Password reset | **24 hours** | Single use |
| Login session | 14 days | — |

- If the screen says **"기한이 지난 링크입니다"** (the link has expired), the link expired or was
  revoked → an admin issues a new one.
- If it says **"이미 사용된 링크입니다"** (the link has already been used), someone already used it.
  - **An invite** cannot be reissued. Being used means an account for that email already exists. The
    person logs in, or if they do not know the password, an admin issues a **reset link**.
  - **A reset link** can be issued again.
- **Reissuing a link kills the previous unused link.** Two links cannot be alive at once, so anyone
  holding an old link needs the new one.
- A link is shown only once, at the time it is issued, and cannot be looked up again. If you lose it,
  reissue it.

### 9.6 Clicking log in returns you to the login screen

**Cause:** The session cookie has `Secure`, but the connection is plain HTTP. The browser does not store
the cookie, so the next request is unauthenticated again.

There is **exactly one place in the whole codebase** that decides `Secure`. When `auth.login` in
`apps/server/src/routers/auth.ts` sets the cookie, it evaluates
`secure: process.env.NODE_ENV === 'production'`. It reads this on every login request, so the process's
current environment variable takes effect as is. The cookie middleware (`@fastify/cookie`) is registered
without options, so there is no separate global default. Proxy headers (`X-Forwarded-Proto`) and the
request scheme **play no part** in the decision. The Docker image hardcodes `NODE_ENV=production`. The
cookie's other attributes are `httpOnly`, `SameSite=Lax`, `Path=/`, and a 14-day expiry, and its name is
`erdd_session`.

**Fix:** Add HTTPS as described in section 7. If you only want a quick test without TLS, add one line to
`.env` and recreate the app. **Do not use this in production.**

```bash
echo 'ERDD_NODE_ENV=development' >> .env
docker compose up -d --force-recreate app
docker compose exec app printenv NODE_ENV     # should print development
```

In Method B, lower `NODE_ENV` directly (under systemd, change the value in `EnvironmentFile` and run
`systemctl restart erdd`).

### 9.7 The browser shows only 404

**Cause:** `apps/web/dist` is missing. The server registers static files and the SPA fallback only when
that directory exists. Otherwise it answers only `/trpc`.

- Method A: the image build includes the web build. Check the `docker compose build` output again to
  see whether the build failed (do not name a service; see 3.2).
- Method B: you skipped `pnpm --filter @erdd/web build` (4.1).

### 9.8 The app does not start after changing `POSTGRES_PASSWORD`

**Symptom:** In Method A, `up` ends with `service "migrate" didn't complete successfully: exit 1` and
`app` does not start. `docker compose logs db` shows
`FATAL:  password authentication failed for user "postgres"` (the `migrate` log may not show this
message; see 3.2).

**Cause:** Postgres applies `POSTGRES_PASSWORD` **only when it first initializes the data directory**
(verified). If you change the value on an installation that already has a `pgdata` volume, only the
`DATABASE_URL` of `migrate` and `app` gets the new value, while the DB keeps the old password. `migrate`
fails authentication first, so `app` never starts.

**Fix: choose one of the following.**

```bash
# (A) Change the actual password inside the DB (keeps data). exec connects locally, so no password prompt.
docker compose exec db psql -U postgres -c "ALTER USER postgres PASSWORD '<new password>';"
docker compose up -d

# (B) Revert .env to the old password and start again
docker compose up -d
```

If you are right after installation and can discard the data, you can also remove the volume with
`docker compose down -v` and start over. **`-v` deletes the entire DB.** Do not use it if you have
production data.

---

## Appendix: Verification status

**Verified with real commands.** The image build and, inside the image, Node 22 · pnpm 10.4.1 ·
`apps/web/dist` · `apps/server/drizzle/`; the `db:migrate` execution path; the `health.ping` response;
412 without `DATABASE_URL`; static serving and the SPA fallback; the `app` healthcheck command; compose
syntax and the variable substitution result. In addition:

- **Method A from start to finish.** In an isolated project (`docker compose -p <name>`, free host ports
  through `ERDD_PORT` and `ERDD_DB_PORT`, and `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from
  the command-line environment), one `docker compose up -d --build` ran against an empty volume. Result:
  `migrate` at `Exited (0)`, `app` at `(healthy)`, the three lines from 3.3 in the `app` log,
  `health.ping` 200, `auth.me` 401. Running the same command again reruns `migrate`, which exits with 0,
  leaves the `app` container as is, and keeps the data.
- **Number of builds.** The environment above used the classic builder (buildx not installed). It built
  `migrate` and `app` twice, and in the second build every stage after `FROM` finished with
  `Using cache`, so both tags pointed to the same image ID.
- **Upgrade order.** The `docker events` observation in 8.1 (Docker Compose v5.1.4).
- **`migrate` failure.** Running `up -d --build` on an existing volume with a different
  `POSTGRES_PASSWORD` made only `migrate` fail. `up` returned exit code 1 and
  `service "migrate" didn't complete successfully: exit 1`, `app` stayed at `Created` and did not start,
  and the authentication failure message appeared only in the `db` log (3.2). Reverting to the original
  password and running again recovers, and the data remains.
- **DB port.** `docker port <project>-db-1` shows only `5432/tcp -> 127.0.0.1:<port>`. From the host,
  `pg` connects through both `localhost` and `127.0.0.1` (even when `localhost` resolves to `::1` first,
  it falls back to IPv4).
- **`ERDD_PORT=127.0.0.1:3000`.** `docker compose config` shows the app port expanded with
  `host_ip: 127.0.0.1`. The app was not started with this value.
- **`docker compose pull`.** Before and after the build, it exits with 0 and skips `migrate` and `app`
  with `No image to be pulled`. As a control, giving both services an `image:` name makes a pre-build
  `pull` fail with `pull access denied` and exit code 1.
- **`exec` and `logs` with `-p` only.** `docker compose -p <project> exec` and `logs` work from a
  directory without a compose file (3.5).
- **`db` healthcheck.** Starting an isolated project with `docker compose up -d db` moved it to
  `Up (healthy)` in about 6 seconds.
- **`POSTGRES_PASSWORD` is applied only at initialization.** After restarting the same volume with a
  changed password and connecting over the network, the new password gave
  `password authentication failed` and the old password succeeded.
- **Local and loopback are `trust` in `pg_hba.conf`.** That is why `docker compose exec db psql` works
  without a password (8.2).
- **The temporary server during initialization uses `listen_addresses=''`.** Confirmed in the image's
  `docker-entrypoint.sh`. This is why the healthcheck passes `-h 127.0.0.1`.

**Not verified.** Login completion (needs HTTPS), backup and restore, nginx, systemd, all of Method B,
deployment through a real compose management tool (Komodo and others), and the build count and cache
behavior under BuildKit (buildx) were written from reading the code and configuration. They still need
verification in a real environment.

---

**Next** — After the first start, the [user guide](user-guide.md) covers the screens you and your users work in. To
sync the schema with files in a repository, read the [CLI manual](cli-guide.md).
