<!-- source: docs/manual/en/install.md @ v0.6.0 -->

# ERDD 설치·운영 매뉴얼

이 문서는 자체 서버에 ERDD 를 설치하고 운영하는 담당자를 위한 문서입니다. 에디터 사용법은
[사용자 가이드](user-guide.md)를, 명령줄 도구는 [CLI 매뉴얼](cli-guide.md)을 보세요.
기여자용 워크플로는 [개발 환경 가이드](../../guides/setup.md)에 있습니다.

> [!WARNING]
> **혼자 쓸 것이라면 이 문서는 필요하지 않습니다.** ERDD 에는 서버도 계정도 데이터베이스도 없이
> 저장소 안의 YAML 파일로 같은 웹 에디터를 여는 로컬 모드가 있습니다. 명령 하나면 됩니다:
> `erdd serve`. 이 문서(Docker, PostgreSQL, 리버스 프록시, 계정 관리)가 필요한 것은 여러 사람이
> 한 프로젝트를 동시에 편집하고 계정·권한·조직을 나눠야 할 때뿐입니다. 판단 기준과 사용법은
> [로컬 모드 매뉴얼](local-guide.md)에 있습니다.

## 1. 개요

설치할 것은 **두 가지**입니다.

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

- **서버는 프로세스 하나입니다.** 프로세스 하나가 API, 정적 웹 파일, WebSocket 을 모두 서빙합니다.
  `apps/web/dist` 가 있으면 서버가 그 디렉터리를 정적 루트로 등록하고, `/trpc` 로 시작하지 않는
  미매칭 경로는 모두 `index.html` 로 보냅니다(SPA fallback). 웹 서버를 따로 둘 필요가 없습니다.
- **상태는 모두 PostgreSQL 에 있습니다.** 파일 업로드 저장소가 없고 디스크에 쓰는 것도 없습니다.
  백업할 것은 데이터베이스 하나뿐입니다(8.2).
- **서버는 TLS 를 처리하지 않습니다.** HTTPS 가 필요하면 앞에 리버스 프록시를 두세요(7절).

설치 방법은 방법 A(Docker Compose)와 방법 B(소스에서 직접 실행) 두 가지입니다. 이미
Postgres 를 운영 중이거나 Docker 를 쓸 수 없는 환경이 아니면 방법 A 를 쓰세요.

## 2. 요구 사항

| 항목 | 방법 A | 방법 B | 근거 |
|---|---|---|---|
| Docker | Engine + Compose v2 | — | |
| Node.js | (이미지에 포함) | 22 | `mise.toml` |
| pnpm | (이미지에 포함) | 10.4.1 — `corepack enable` 로 맞춥니다 | `package.json` 의 `packageManager` |
| PostgreSQL | (compose 의 `db`) | 17 | `docker-compose.yml` |
| 열어야 할 포트 | `3000`(앱. 호스트 쪽은 `ERDD_PORT` 로 바꿉니다). DB 는 호스트 루프백에만 붙으므로 열지 않습니다 | `3000`(앱. `PORT` 로 바꿉니다) · `5432`(DB) | |

지원하는 아키텍처는 베이스 이미지 `node:22-slim` 이 지원하는 범위(x86_64 / arm64)입니다. 빌드에는
npm 레지스트리 접근이 필요합니다. 폐쇄망이면 다른 곳에서 이미지를 빌드해 `docker save`/`load` 로
옮기세요.

## 3. 방법 A: Docker Compose (권장)

### 3.1 소스 받기 · `.env` 작성

```bash
git clone <repository URL> erdd
cd erdd
cp .env.example .env
```

`.env` 를 열어 최소한 다음 세 값을 채우세요. **이 파일은 저장소에 커밋되지 않습니다.**

```dotenv
POSTGRES_PASSWORD=<DB password>
ADMIN_EMAIL=admin@your-domain.example
ADMIN_PASSWORD=<a long temporary password>
```

- **`POSTGRES_PASSWORD` 는 첫 기동 전인 지금 정하세요.** Postgres 는 이 값을 데이터 디렉터리를
  처음 초기화할 때만 반영합니다. `pgdata` 볼륨이 이미 있는 설치에서 값을 바꾸면 compose 는 새
  값으로 접속하는데 DB 는 옛 비밀번호를 그대로 갖고 있어 인증 오류로 앱이 뜨지 않습니다(실측
  확인). 나중에 바꾸려면 DB 안에서 `ALTER USER postgres PASSWORD …` 를 실행하고 `.env` 도 함께
  고치세요. 생략하면 기본값 `erdd` 가 쓰입니다. 운영 환경에서는 반드시 바꾸세요.
- 비밀번호에 `@ : / # ?` 가 들어 있으면 접속 URL 이 깨집니다. 퍼센트 인코딩하거나 그런 문자를
  피하세요.
- `docker compose` 는 **같은 디렉터리의 `.env` 를 자동으로 읽어** compose 파일의 `${...}` 참조를
  치환합니다. 앱 컨테이너가 받는 값은 `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NODE_ENV`(→ 5절의
  `ERDD_NODE_ENV`), 그리고 `POSTGRES_PASSWORD` 로 조립한 `DATABASE_URL` 입니다.
- **컨테이너는 `.env` 의 `DATABASE_URL` 을 쓰지 않습니다.** `docker-compose.yml` 에서 `migrate` 와
  `app` 서비스는 둘 다 DB 주소를 `postgres://postgres:${POSTGRES_PASSWORD}@db:5432/erdd` 로
  조립합니다(compose 네트워크에서 호스트 이름이 `db` 입니다). `.env` 의 값은 호스트에서 실행하는
  `psql` 같은 도구용입니다.
- compose 프로젝트 이름은 **디렉터리 이름**에서 오고, 볼륨 이름(`<project>_pgdata`)이 그 이름에
  딸려 있습니다. 디렉터리를 옮기거나 이름을 바꾸면 DB 를 잃은 것처럼 보입니다. 옮길 계획이면
  `.env` 에 `COMPOSE_PROJECT_NAME` 을 고정하세요. compose 관리 도구로 배포하면 스택 이름이 프로젝트
  이름입니다(3.5).

### 3.2 빌드 · 마이그레이션 · 기동 — 한 번에

```bash
docker compose up -d --build
docker compose ps -a
```

이 명령 하나가 다음을 순서대로 합니다.

1. **이미지를 빌드합니다.** `migrate` 와 `app` 이 같은 `Dockerfile` 과 컨텍스트로 각자 빌드합니다. 두
   빌드는 같은 단계를 공유합니다. classic builder 에서는 두 번째 빌드가 첫 빌드의 캐시로 곧바로
   끝납니다(실측 확인. BuildKit 은 부록을 보세요). 첫 빌드는 의존성 설치와 웹 앱 빌드 때문에 오래
   걸립니다.

   ⚠️ **한쪽만 빌드하지 마세요**(`docker compose build app` 처럼 서비스를 지정해서). `migrate` 가 옛
   이미지로 남아 새 마이그레이션을 모른 채 0 으로 끝나고, 새 `app` 이 새 스키마 없이 떠서 9.3 의
   증상이 납니다. 빌드는 늘 서비스를 지정하지 않고 실행하세요(`up -d --build`, `docker compose build`).
2. **`db` 를 기동합니다.** compose 는 `pg_isready` healthcheck 가 통과해 서비스가 healthy 가 될 때까지
   기다립니다.
3. **`migrate` 를 실행합니다.** `pnpm --filter @erdd/server db:migrate`(drizzle-kit)를 한 번 실행하고
   끝납니다. 적용할 것이 없으면 아무것도 하지 않고 0 으로 끝나므로 `up` 할 때마다 다시 실행돼도
   무해합니다.
4. **`app` 을 기동합니다.** `migrate` 가 0 으로 끝난 뒤에만 뜹니다
   (`depends_on: {migrate: {condition: service_completed_successfully}}`).

기대 결과(`docker compose ps -a`, 필요한 열만):

```text
SERVICE   STATUS
app       Up … (healthy)
db        Up … (healthy)
migrate   Exited (0) …
```

`migrate` 가 `Exited (0)` 으로 남아 있는 것이 정상입니다. 한 번 실행하고 끝나는 서비스입니다
(`restart: "no"`). healthcheck 주기 때문에 `app` 이 `(healthy)` 가 되기까지 수십 초 걸릴 수
있습니다.

**마이그레이션을 별도 서비스로 돌리는 것은 스키마 때문입니다.** 서버는 마이그레이션을 직접 적용하지
않습니다. 서버는 기동할 때 DB 를 조회합니다(관리자 부트스트랩, 전역 공용 리소스 시드). 접속이
되더라도 테이블이 없으면 그 지점에서 실패하고 프로세스가 끝납니다(9.3). `db` healthcheck 는 접속
가능 여부만 보고 스키마는 보지 않으므로, 스키마를 보장하는 것은 `migrate` 입니다.

**`migrate` 가 실패하면 앱이 뜨지 않습니다.** `up` 은 다음 줄로 끝나고 종료 코드 1 을 돌려줍니다.
`docker compose ps -a` 에서 `migrate` 는 `Exited (1)`, `app` 은 `Created` 에 머뭅니다.

```text
service "migrate" didn't complete successfully: exit 1
```

원인은 두 로그에서 찾으세요.

```bash
docker compose logs migrate
docker compose logs db | grep FATAL
```

> [!WARNING]
> **`migrate` 로그에는 원인이 안 보일 수 있습니다.** DB 비밀번호가 맞지 않아 실패하면 `migrate`
> 로그에는 `applying migrations...` 뒤에 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … Exit status 1` 만 보입니다.
> 실제 원인인 `FATAL:  password authentication failed for user "postgres"` 는 `db` 로그에만
> 나옵니다. 이 오류는 기존 `pgdata` 볼륨이 있는 상태에서 `POSTGRES_PASSWORD` 를 바꿨을 때
> 나타납니다(9.8). 원인을 고친 뒤 같은 `docker compose up -d --build` 를 다시 실행하세요.

> [!WARNING]
> `db` 는 호스트 루프백(`127.0.0.1`)에만 붙습니다(포트 기본값은 `5432`, `ERDD_DB_PORT` 로
> 옮깁니다). 그 서버에서는 `psql` 을 붙일 수 있지만 다른 머신에서는 닿지 않습니다. 앱과 `migrate` 는
> compose 네트워크로 접속하므로 이 포트의 영향을 받지 않습니다. 외부에 열어야 하면
> `docker-compose.yml` 의 `db.ports` 를 직접 고치세요. 그때는 **Docker 가 연 포트는 호스트
> 방화벽(ufw 등)을 우회한다**는 점을 기억하세요.

### 3.3 기동 로그 · 관리자 부트스트랩

```bash
docker compose logs app
```

첫 기동의 기대 출력(둘째 줄의 식별자는 매번 다릅니다):

```text
부트스트랩 관리자 계정 생성: admin@your-domain.example
예시 전역 공용 리소스 라이브러리 생성: <식별자>
ERDD server listening on :3000
```

- 첫 줄은 서버가 관리자 계정을 실제로 만들었을 때만 나옵니다. 그 이메일의 계정이 이미 있으면
  서버는 아무것도 하지 않습니다. **기존 비밀번호를 덮어쓰지 않습니다.** 그래서 `ADMIN_PASSWORD` 를
  바꾸고 재시작해도 비밀번호는 바뀌지 않습니다. 잊었다면 다른 관리자가 재설정 링크를 발급해야
  합니다.
- `ADMIN_EMAIL` 이나 `ADMIN_PASSWORD` 중 하나라도 비어 있으면 서버는 부트스트랩을 통째로
  건너뜁니다.
- 둘째 줄은 서버가 예시 전역 공용 리소스(「표준 사전(예시)」)를 시드할 때 나옵니다. 전역
  라이브러리가 이미 있으면 서버가 이 단계를 건너뛰므로, 두 번째 기동부터는 listen 줄만 남습니다.

첫 관리자를 만든 뒤에는 `.env` 에서 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 를 지워도 됩니다.

### 3.4 접속 확인

```bash
curl -s http://127.0.0.1:3000/trpc/health.ping
```

기대 결과:

```json
{"result":{"data":{"ok":true,"version":"0.1.0"}}}
```

`health.ping` 은 DB 가 없어도 200 을 돌려줍니다. **살아 있는지만 확인합니다.** DB 까지 확인하려면
8.3 을 보세요.

이제 브라우저로 `http://<server>:3000` 을 여세요. 로그인 화면이 떠야 합니다. 다만 **평문 HTTP
에서는 로그인이 완료되지 않습니다**(9.6). 먼저 7절의 리버스 프록시를 설정하세요.

### 3.5 compose 관리 도구로 배포할 때 (Komodo 등)

서버에서 Git 저장소의 compose 파일을 빌드·배포하는 도구를 쓴다면 절차는 3.1–3.4 와 같습니다. 이
절은 도구가 대신 해 주는 것과 도구 때문에 달라지는 것만 다룹니다.

- **저장소의 `docker-compose.yml` 을 그대로 쓰고, 배포할 때 빌드하도록 켜세요.** 이 compose 파일은
  레지스트리에서 이미지를 받지 않고 소스에서 빌드합니다. 배포 한 번이 3.2 의
  `docker compose up -d --build` 와 같다면 빌드·마이그레이션·기동이 모두 그 안에서 일어납니다.
- **마이그레이션용 배포 전 명령(훅)을 따로 넣지 마세요.** 그 일은 `migrate` 서비스가 합니다. 훅에서
  실행하면 compose 프로젝트 이름(`-p`)을 도구와 정확히 맞춰야 합니다. 맞지 않으면 마이그레이션이
  비어 있는 별도 DB 에 적용되고 거기서 끝납니다.
- **도구가 배포 전에 `docker compose pull` 을 실행해도 괜찮습니다.** `migrate` 와 `app` 에는 이미지
  이름이 없어 `Skipped No image to be pulled` 로 건너뛰고, `postgres:17` 만 받습니다.
- **환경 변수는 도구에 넣으세요.** 도구가 compose 파일 옆 `.env` 에 써 준다면 치환은 3.1 과 똑같이
  동작합니다. 넣을 값은 3.1 의 세 값과 5절의 compose 변수 표입니다.
- **`POSTGRES_PASSWORD` 는 첫 배포 전에 정하세요**(3.1). 첫 배포가 기본값 `erdd` 로 DB 를
  초기화하면, 나중에 도구에서 값을 바꿨을 때 `migrate` 가 인증 실패로 멈춥니다(9.8).
- ⚠️ **스택 이름이 compose 프로젝트 이름이고, 볼륨 이름(`<stack name>_pgdata`)이 그 이름에 딸려
  있습니다.** 스택 이름을 바꾸거나 같은 저장소로 새 스택을 만들면 비어 있는 새 DB 가
  만들어집니다. 옛 볼륨은 남아 있지만 붙지 않습니다. 3.1 의 프로젝트 이름 항목과 같은 함정입니다.
- **HTTPS 와 `/ws`** 는 7절대로 앞에 프록시를 두세요. 프록시가 같은 서버에서 돈다면 `ERDD_PORT` 를
  `127.0.0.1:3000` 으로 정하세요(7절).
- **도구가 `migrate` 를 종료된 서비스로 표시하는 것은 정상입니다.** 한 번 실행하고 끝나므로
  `Exited (0)` 이 정상 상태입니다(3.2). `Exited (1)` 은 비정상이고, 그때는 `app` 이 떠 있지 않습니다.
- **서버 셸에서 백업이나 `exec` 명령을 실행할 때는 `-p <stack name>` 을 붙이세요.** 도구는 compose
  파일을 자기 작업 디렉터리에 두므로, 그 밖에서 `docker compose` 를 실행하면 compose 가 프로젝트를
  찾지 못합니다. `-p` 를 주면 compose 파일이 없는 디렉터리에서도 `exec` 와 `logs` 가 동작합니다.

  ```bash
  docker compose -p <stack name> exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql
  docker compose -p <stack name> logs migrate
  ```

#### Komodo Stack 설정

| 항목 | 값 |
| --- | --- |
| Source | Git Repo — `github.com` / `jang2162/erdd` / 브랜치 `main` |
| File Paths | `docker-compose.yml` |
| Environment | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `ERDD_PORT`. 비밀 값은 Komodo Variables(Secret)로 참조합니다. 예: `[[ERDD_POSTGRES_PASSWORD]]` |
| Webhook | 끔 — 재배포하면 `app` 이 다시 만들어져 실시간 편집 연결(`/ws`)이 끊깁니다 |

Stack Environment 는 compose 가 `${VAR}` 치환에 쓰는 `.env` 가 됩니다. 새 변수를 더하려면 compose
파일의 `environment:` 에 먼저 적고, 그다음 Environment 에 더하세요.

## 4. 방법 B: 소스에서 직접 실행

이 방법은 PostgreSQL 17 이 이미 돌고 있고, 빈 DB 와 그 접속 정보가 있다고 가정합니다.

### 4.1 빌드

```bash
git clone <repository URL> /opt/erdd
cd /opt/erdd
corepack enable                 # activates pnpm 10.4.1
pnpm install --frozen-lockfile
pnpm --filter @erdd/web build   # creates apps/web/dist; the server needs it to serve the web app
```

`apps/web/dist/index.html` 이 있는지 확인하세요. 없으면 서버가 API 만 서빙하고 브라우저는 404 를
받습니다.

### 4.2 마이그레이션

```bash
export DATABASE_URL='postgres://<user>:<pass>@<host>:5432/<db>'
pnpm --filter @erdd/server db:migrate
```

### 4.3 실행

```bash
NODE_ENV=production \
DATABASE_URL='postgres://<user>:<pass>@<host>:5432/<db>' \
ADMIN_EMAIL='admin@your-domain.example' \
ADMIN_PASSWORD='<temporary password>' \
pnpm --filter @erdd/server start
```

기대 결과: `ERDD server listening on :3000`.

### 4.4 systemd 유닛 예시

경로(`/opt/erdd`)와 `User` 는 환경에 맞게 바꾸세요. `ExecStart` 는 pnpm 이나 corepack 을 거치지 않고
`tsx` 를 직접 부릅니다. Docker 이미지와 같은 호출 방식입니다.

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

`/etc/erdd/erdd.env`(모드 `0600`, 소유자 `erdd`):

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://erdd:<pass>@127.0.0.1:5432/erdd
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now erdd
journalctl -u erdd -f      # you should see: ERDD server listening on :3000
```

## 5. 환경 변수

아래 표는 서버 코드가 `process.env` 를 읽는 곳을 모두 담았습니다.

| 이름 | 필수 | 기본값 | 설명 | 읽는 곳 |
|---|---|---|---|---|
| `DATABASE_URL` | **예** | 없음 | PostgreSQL 접속 문자열입니다. 없으면 서버는 뜨지만 모든 API 가 412 를 돌려줍니다(9.1). | `apps/server/src/main.ts`, `apps/server/drizzle.config.ts` |
| `PORT` | 아니요 | `3000` | listen 포트입니다. 바인드 주소는 늘 `0.0.0.0` 입니다. **compose 는 이 값을 앱 컨테이너에 넘기지 않습니다.** 방법 A 에서 포트를 옮기려면 아래 `ERDD_PORT` 를 쓰세요. | `apps/server/src/main.ts` |
| `NODE_ENV` | 아니요 | 없음 | `production` 일 때만 세션 쿠키에 `Secure` 가 붙습니다. **서버 코드에서 이 변수가 바꾸는 동작은 이것 하나뿐이고**, 읽는 곳도 `auth.login` 하나입니다(로그인 요청마다 읽습니다). Docker 이미지는 `production` 을 박아 두고, compose 는 이 값을 `ERDD_NODE_ENV` 로 채웁니다. | `apps/server/src/routers/auth.ts` |
| `ADMIN_EMAIL` | 아니요 | 없음 | 첫 관리자 부트스트랩입니다. 이 값과 `ADMIN_PASSWORD` 가 **둘 다** 있을 때만 동작합니다. | `apps/server/src/services/accounts.ts` |
| `ADMIN_PASSWORD` | 아니요 | 없음 | 위와 같습니다. 그 이메일의 계정이 없을 때만 쓰입니다. | 〃 |

**서버는 `.env` 파일을 직접 읽지 않습니다.** dotenv 같은 것을 쓰지 않으므로 값은 셸 환경, systemd
`EnvironmentFile`, compose 중 하나로 들어와야 합니다.

앱이 아니라 **compose 가 읽는** 변수입니다. `.env` 에 넣으면 compose 가 치환합니다:

| 이름 | 기본값 | 정하는 것 |
|---|---|---|
| `POSTGRES_PASSWORD` | `erdd` | `db` 의 비밀번호이자, `migrate` 와 `app` 의 `DATABASE_URL` 에 조립되는 값입니다. **데이터 디렉터리를 초기화할 때만 반영됩니다**(3.1 의 함정). |
| `ERDD_PORT` | `3000` | 앱 컨테이너가 붙을 호스트 포트입니다. 포트만 적으면 모든 인터페이스에 붙습니다. **`127.0.0.1:3000` 처럼 호스트 주소를 앞에 붙이면 그 주소에만 붙습니다**(리버스 프록시 뒤에 둘 때. 7절). 컨테이너 쪽은 `3000` 으로 고정입니다(포트 매핑과 healthcheck 가 그 값을 씁니다). |
| `ERDD_DB_PORT` | `5432` | `db` 컨테이너가 호스트 **루프백(`127.0.0.1`)** 의 어느 포트에 붙을지입니다. 호스트에서 `psql` 같은 도구를 붙이기 위한 것입니다. 앱과 `migrate` 는 이 값에 의존하지 않습니다. 외부에 여는 방법은 3.2 를 보세요. |
| `ERDD_NODE_ENV` | `production` | 앱 컨테이너의 `NODE_ENV` 입니다. **이름을 일부러 `NODE_ENV` 로 하지 않았습니다.** 그렇게 하면 운영자 셸에 남아 있던 `NODE_ENV` 가 새어 들어가 쿠키의 `Secure` 를 조용히 끌 수 있습니다. |

운영에 영향을 주지 않는 나머지 변수입니다:

| 이름 | 쓰임 |
|---|---|
| `ERDD_SERVER_PORT` | **개발 전용.** vite 개발 서버의 프록시 대상 포트입니다(`apps/web/vite.config.ts`). 운영 빌드에는 영향이 없습니다. |
| `ERDD_WEB_PORT` | **개발 전용.** vite 개발 서버가 listen 하는 포트입니다(`apps/web/vite.config.ts`). 설정하지 않거나 비우면 기본값 `5173` 입니다. 포트로 읽히지 않는 값은 조용히 기본값으로 돌아가지 않고 오류로 실패합니다. 운영 빌드에는 영향이 없습니다. |
| `ERDD_WEB_HOST` | **개발 전용.** vite 개발 서버의 바인드 주소입니다(`apps/web/vite.config.ts`). 설정하지 않거나 비우면 기본값 `127.0.0.1` 입니다. vite 가 IPv6 `[::1]` 에만 붙으면 브라우저가 접속하지 못하므로 빈 값도 기본값으로 돌아갑니다. 운영 빌드에는 영향이 없습니다. |
| `ERDD_TOKEN` | `erdd` CLI 가 쓰는 액세스 토큰입니다(`packages/cli`). 서버에는 영향이 없습니다(→ [CLI 매뉴얼](cli-guide.md)). |

## 6. 최초 기동 후 할 일

스스로 가입하는 기능은 없습니다. 계정은 초대로만 만듭니다. 관리자가 일회용 초대 링크를 발급해
전달합니다. **ERDD 는 이메일을 보내지 않습니다.** 링크는 화면에 나타나고, 관리자가 전달합니다.

1. 3.3 의 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 **관리자로 로그인하세요.**
2. **관리자 비밀번호를 바꾸세요.** 부트스트랩 비밀번호는 환경 변수와 배포 이력에 평문으로 남아
   있습니다.
3. **사용자를 초대하세요.** 관리자 페이지에서 이메일과 서비스 역할을 입력해 초대 링크를 발급하고
   보내세요. 초대받은 사람이 링크를 열어 이름과 비밀번호를 정하면 ERDD 가 계정과 개인 조직을 함께
   만듭니다.
4. **팀 조직을 만들고 멤버를 추가하세요.** 조직을 만드세요. 이미 계정이 있는 사용자는 이메일로 찾아
   추가하세요. 계정이 없는 사람에게는 조직 초대 링크를 발급하세요.

화면 자체는 [사용자 가이드](user-guide.md)를 보세요.

> [!WARNING]
> 초대·재설정 링크는 「관리자가 쓰고 있는 주소」로 만들어집니다. 링크 URL 은 브라우저가 지금
> 접속한 origin 뒤에 경로를 붙여 조립합니다. 관리자가 `http://10.0.0.5:3000` 으로 접속해 링크를
> 만들면 그 주소가 링크에 박혀 사무실 밖에서는 열리지 않습니다. 링크를 발급할 때 **관리자는
> 사용자와 같은 공개 주소로 접속해야 합니다.**

## 7. 리버스 프록시

**서버는 TLS 를 종단하지 않습니다.** HTTPS 가 필요하면 앞에 프록시를 두세요. 세션 쿠키에 `Secure` 가
붙으므로 사실상 필수입니다(9.6).

nginx 예시:

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

기억할 것:

- **서버는 지금 `X-Forwarded-*` 를 읽지 않습니다**(Fastify 의 `trustProxy` 를 켜지 않았습니다).
  관례와 앞으로를 위해 넣어 두는 것입니다. 쿠키의 `Secure` 여부는 이 헤더가 아니라 `NODE_ENV` 만으로
  정해집니다.
- 앱을 프록시에서만 닿게 하려면 `.env` 에 `ERDD_PORT=127.0.0.1:3000` 을 넣으세요. compose 가 포트
  매핑을 `"127.0.0.1:3000:3000"` 으로 펼쳐 루프백에만 붙입니다. compose 파일은 고칠 필요가 없습니다.
  `docker compose up -d` 로 반영하세요(앱 컨테이너가 다시 만들어집니다).
- 하위 경로(`/erdd/` 등) 아래에서 서빙하는 것은 검증한 구성이 아닙니다. 서브도메인이나 전용 호스트를
  쓰세요.

## 8. 운영

### 8.1 업그레이드

**순서가 중요합니다: 코드 갱신 → 빌드 → 마이그레이션 → 재시작.** 새 스키마가 필요한 코드를 먼저
띄우면 서버가 기동 중 DB 를 조회하다 실패해 재시작을 반복합니다. 방법 A 에서는 compose 가 이 순서를
지켜 줍니다.

```bash
cd /opt/erdd
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql   # back up (8.2)
git pull
docker compose up -d --build
docker compose ps -a
docker compose logs app | tail -3
```

`up -d --build` 는 새 이미지를 빌드한 뒤 옛 `app` 컨테이너를 멈추고 지우고, `migrate` 를 실행하고,
`migrate` 가 0 으로 끝나면 새 `app` 을 띄웁니다. **옛 `app` 은 `migrate` 가 시작하기 전에 이미 멈춰
있으므로** 옛 코드가 새 스키마 위에서 도는 일은 없습니다. 먼저 `docker compose stop app` 을 실행할
필요가 없습니다. 이 순서는 이미지를 바꾼 채 `up -d --build` 를 실행하면서
`docker events --filter label=com.docker.compose.project=<project>` 로 컨테이너 이벤트를 기록해
확인했습니다. 옛 `app` 의 `stop` 과 `destroy` 가 `migrate` 의 `start` 보다 앞섭니다
(Docker Compose v5.1.4). 다른 compose 버전에서 순서가 미덥지 않으면 먼저 `docker compose stop app` 을
실행해도 손해가 없습니다.

- **`migrate` 가 실패하면 서비스는 내려간 채로 남습니다.** 옛 `app` 은 이미 내려갔고 새 `app` 은 뜨지
  않습니다(3.2 의 실패). 원인을 고치고 같은 명령을 다시 실행하세요. 되돌려야 하면 위에서 받아 둔
  백업으로 복구하세요(8.2).
- **이미지가 그대로면**(코드가 바뀌지 않았으면) compose 는 `app` 컨테이너를 그대로 두고 `migrate` 만
  다시 실행합니다.

방법 B 에서는 순서를 손으로 지키세요: `systemctl stop erdd` → `git pull` →
`pnpm install --frozen-lockfile` → `pnpm --filter @erdd/web build` → `db:migrate` →
`systemctl start erdd`.

- **업그레이드 중에는 서비스가 내려갑니다.** 프로세스가 하나뿐이라 무중단 롤링 교체는 지원하지
  않습니다.
- **업그레이드 전에 백업하세요**(8.2). 마이그레이션에는 롤백 스크립트가 없습니다.
- **서버를 3000 이 아닌 `PORT` 로 띄운다면**, 늘 세션 쿠키 이름 `erdd_session` 을 쓰던 버전에서 올린 뒤
  사용자가 한 번 다시 로그인해야 합니다(9.6).

### 8.2 백업과 복구

상태는 모두 PostgreSQL 에 있습니다. 파일 업로드 저장소가 없으므로 **DB 덤프 하나가 전체
백업입니다.**

```bash
# Back up
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql

# Restore into an empty DB
docker compose stop app                      # stop writes
docker compose exec -T db psql -U postgres -d erdd < erdd-2026-08-10.sql
docker compose up -d app
```

- 위 명령에 비밀번호가 없는 것이 맞습니다. `docker compose exec` 는 컨테이너 **안에서** 실행되고,
  Postgres 기본 `pg_hba.conf` 는 로컬·루프백 접속을 `trust` 로 둡니다(실측 확인). `POSTGRES_PASSWORD`
  를 바꾼 뒤에도 이 명령은 계속 동작합니다.
- 대상 DB 는 비어 있어야 합니다. 기존 DB 위에 복구하려면 지우고 다시 만들거나
  `pg_dump -Fc` + `pg_restore --clean --if-exists` 를 쓰세요.
- compose 볼륨(`<project>_pgdata`) 전체를 스냅숏으로 떠도 되지만, 반드시 **컨테이너를 멈춘 상태에서**
  복사해야 합니다.

### 8.3 헬스체크

| 목적 | 명령 | 정상 |
|---|---|---|
| 프로세스가 살아 있는가 | `curl -s http://127.0.0.1:3000/trpc/health.ping` | `{"result":{"data":{"ok":true,"version":"0.1.0"}}}` |
| DB 까지 연결됐는가 | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/trpc/auth.me` | **412 가 아니면** 정상입니다. 로그인하지 않았으면 401 이 나옵니다. |

`health.ping` 은 인증이 필요 없는 공개 프로시저이고, **DB 가 없어도 200 을 돌려줍니다.** 로드
밸런서에 DB 상태까지 반영하려면 둘째 행을 쓰세요.

`docker compose ps -a` 는 세 서비스의 상태를 한 번에 보여 줍니다. `db` 와 `app` 에는 healthcheck 가
있습니다. `migrate` 는 한 번 실행하고 끝나므로 `Exited (0)` 이 정상입니다(`-a` 가 없으면 목록에서
빠집니다).

| 서비스 | 검사 | 참고 |
|---|---|---|
| `db` | `pg_isready -U postgres -d erdd -h 127.0.0.1` | `-h 127.0.0.1` 이 꼭 있어야 합니다. 초기화 중에는 임시 서버가 `listen_addresses=''` 로 떠서 TCP 를 열지 않으므로, Unix 소켓으로 검사하면 DB 가 생기기 전에 「준비됨」 으로 나옵니다. |
| `app` | 위 표 첫 행과 같은 `health.ping` 호출 | 이미지에 curl 이나 wget 이 없어 Node 의 `fetch` 로 엔드포인트를 부릅니다. |

`app` healthcheck 는 `health.ping` 을 쓰므로 **DB 상태를 반영하지 않습니다.** DB 까지 넣으려면 외부
모니터링에서 첫 표의 둘째 행을 쓰세요.

### 8.4 로그

```bash
docker compose logs -f app     # Method A
docker compose logs migrate    # Method A, last migration run
journalctl -u erdd -f          # Method B
```

**서버는 HTTP 접근 로그를 쓰지 않습니다**(Fastify 로거가 꺼져 있습니다). 표준 출력에는 사실상 다음만
나옵니다.

- `ERDD server listening on :<port>` — 서버가 기동했습니다
- `부트스트랩 관리자 계정 생성: <이메일>` — 서버가 관리자를 실제로 만들었습니다
- `예시 전역 공용 리소스 라이브러리 생성: <식별자>` — 서버가 예시 전역 공용 리소스를 시드했습니다
- 기동 실패 시 스택 트레이스(그 뒤 프로세스가 끝납니다)

요청별 접근 기록, 응답 시간, 상태 코드는 **리버스 프록시의 접근 로그**를 쓰세요.

## 9. 문제 해결

### 9.1 화면에 "연결에 문제가 있습니다" 가 뜬다 (가장 흔하다)

**원인:** `DATABASE_URL` 이 서버 프로세스에 닿지 않았습니다. 이 경우 서버는 **정상적으로 뜹니다.**
로그에는 오류 없이 `ERDD server listening on :3000` 만 보여서 헷갈립니다. DB 없이 뜬 서버는 DB 를
쓰는 프로시저를 모두 412 로 거절합니다.

```bash
curl -s http://127.0.0.1:3000/trpc/auth.me
# {"error":{"message":"DB가 구성되지 않았습니다", ... "httpStatus":412 ...}}
```

이 메시지가 보이면 확정입니다. **해결:** 값이 실제로 프로세스에 닿았는지 확인하세요.

```bash
docker compose exec app printenv DATABASE_URL     # Method A
sudo systemctl show erdd -p Environment           # Method B (does not show EnvironmentFile contents)
```

흔한 실수는 셋입니다. `.env` 에만 적고 셸에서 export 하지 않은 경우(서버는 `.env` 를 읽지 않습니다),
systemd `EnvironmentFile` 경로의 오타, compose 에서 `app` 서비스가 아니라 `.env` 의 `DATABASE_URL` 을
고친 경우(컨테이너는 그 값을 쓰지 않습니다)입니다.

### 9.2 포트가 이미 쓰이고 있다

**증상:** 방법 A 에서는 `docker compose up` 이 `port is already allocated` 로 실패합니다. 방법 B
에서는 기동 직후 프로세스가 `listen EADDRINUSE` 오류를 내고 끝납니다. compose 의 앱은
`restart: unless-stopped` 때문에 재시작을 반복합니다.

```bash
ss -lntp | grep -E ':(3000|5432)\b'        # who holds the port
echo 'ERDD_PORT=3100' >> .env              # Method A: move only the host-side port
docker compose up -d app
PORT=3100 ... pnpm --filter @erdd/server start   # Method B
```

5432 가 충돌하면(같은 서버에서 이미 Postgres 가 돌고 있는 경우 등) `.env` 에
`ERDD_DB_PORT=5433` 처럼 호스트 쪽 포트만 옮기세요. 서버에서 DB 에 직접 접속할 일이 없다면
`docker-compose.yml` 에서 `db.ports` 를 지워도 됩니다. 앱과 `migrate` 는 compose 네트워크로 접속하므로
호스트 포트가 필요 없습니다.

### 9.3 마이그레이션을 적용하지 않았다

방법 A 에서는 `migrate` 가 `app` 보다 먼저 돌고, `app` 은 `migrate` 가 0 으로 끝났을 때만 뜹니다.
두 서비스를 함께 빌드하는 한(3.2) 앱이 스키마 없이 뜨는 일은 없습니다. 예외는 `app` 만 빌드했을
때입니다. `docker compose up -d --build` 로 둘 다 다시 빌드하세요. 반대로 **`migrate` 가 실패하면
앱은 아예 뜨지 않습니다.** `up` 은 `service "migrate" didn't complete successfully: exit 1` 로
끝나고, `docker compose ps -a` 에서 `migrate` 는 `Exited (1)`, `app` 은 `Created` 입니다. 원인을 찾고
고치는 법은 3.2 의 실패 항목을 보세요. 원인을 고친 뒤 같은 명령을 다시 실행하세요.

```bash
docker compose up -d --build
```

방법 B 의 증상(또는 스키마가 없는 DB 를 서버에 가리킨 경우): 서버가 기동 중에 끝납니다. 로그에
`relation "users" does not exist` 같은 Postgres 오류와 스택 트레이스가 나오고 프로세스가 끝납니다.
`ERDD server listening on` 은 **나오지 않습니다.** systemd 아래에서는 `Restart=on-failure` 가 재시작을
반복합니다.

기동 순서는 `관리자 부트스트랩 → 전역 리소스 시드 → listen` 이라, 스키마가 없으면 listen 전에
실패합니다. 3.1 처럼 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 를 채웠다면 부트스트랩이 `users` 를 먼저 조회하므로
그 테이블이 먼저 실패합니다. 둘 다 비웠다면 부트스트랩이 조회 없이 건너뛰어
`relation "resource_libraries" does not exist` 가 먼저 나옵니다. 어느 쪽이든 원인은 같습니다.

**해결:** 4.2 를 실행한 뒤 서버를 다시 띄우세요.

### 9.4 실시간 협업이 동작하지 않는다

**증상:** 내 편집은 저장되는데(새로 고쳐도 남아 있습니다) 다른 사람의 변경과 커서가 보이지 않습니다.
또는 한동안 되다가 주기적으로 끊깁니다.

편집 저장은 `/trpc` 로, 다른 사람의 변경 수신은 `/ws` 로 갑니다. 그래서 **저장은 되는데 협업은 안
되는** 것입니다. 원인은 거의 늘 프록시입니다.

확인 방법: 브라우저 개발자 도구 → Network → WS 탭을 열고 `/ws?projectId=…` 요청을 보세요.

| 관찰 | 원인 |
|---|---|
| 요청이 `101 Switching Protocols` 가 아님 | 프록시가 `Upgrade`/`Connection` 헤더를 넘기지 않습니다 → 7절의 `location /ws` 블록. |
| 101 은 되지만 수십 초마다 끊김 | 프록시의 유휴 타임아웃이 짧습니다. 서버는 30초마다 ping 을 보내므로 `proxy_read_timeout` 을 넉넉히 주세요(예: 300s). |
| 바로 닫힘 | 로그인 세션이 없거나 그 프로젝트를 볼 권한이 없습니다. 소켓 인증은 tRPC 와 같은 세션 쿠키를 씁니다. |

### 9.5 초대·비밀번호 재설정 링크가 열리지 않는다

만료 시간은 다음과 같습니다.

| 링크 | 유효 기간 | 재사용 |
|---|---|---|
| 초대 | **7일** | 1회용 |
| 비밀번호 재설정 | **24시간** | 1회용 |
| 로그인 세션 | 14일 | — |

- 화면에 **「기한이 지난 링크입니다」** 가 뜨면 링크가 만료됐거나 회수된 것입니다 → 관리자가 새로
  발급합니다.
- **「이미 사용된 링크입니다」** 가 뜨면 누군가 이미 쓴 것입니다.
  - **초대**는 다시 발급할 수 없습니다. 쓰였다는 것은 그 이메일의 계정이 이미 있다는 뜻입니다. 그
    사람은 로그인하거나, 비밀번호를 모르면 관리자가 재설정 링크를 발급합니다.
  - **재설정 링크**는 다시 발급할 수 있습니다.
- **링크를 다시 발급하면 쓰지 않은 이전 링크가 죽습니다.** 두 링크가 동시에 살아 있을 수 없으므로,
  옛 링크를 가진 사람에게는 새 링크가 필요합니다.
- 링크는 발급하는 순간 한 번만 보이고 다시 조회할 수 없습니다. 잃어버렸으면 다시 발급하세요.

### 9.6 로그인을 눌러도 다시 로그인 화면으로 돌아온다

**원인:** 세션 쿠키에 `Secure` 가 붙었는데 접속이 평문 HTTP 입니다. 브라우저가 쿠키를 저장하지 않아
다음 요청이 다시 미인증이 됩니다.

`Secure` 를 정하는 곳은 코드 전체에서 정확히 한 곳입니다. `apps/server/src/routers/auth.ts` 의
`auth.login` 이 쿠키를 설정할 때 `secure: process.env.NODE_ENV === 'production'` 을 평가합니다.
로그인 요청마다 읽으므로 프로세스의 지금 환경 변수가 그대로 반영됩니다. 쿠키 미들웨어
(`@fastify/cookie`)는 옵션 없이 등록돼 있어 따로 전역 기본값이 없습니다. 프록시 헤더
(`X-Forwarded-Proto`)와 요청 스킴은 판정에 **관여하지 않습니다.** Docker 이미지는
`NODE_ENV=production` 을 박아 둡니다. 쿠키의 나머지 속성은 `httpOnly`, `SameSite=Lax`, `Path=/`,
14일 만료이고, 이름은 `erdd_session` 입니다. 서버를 `PORT` 로 3000 이 아닌 포트에 띄우면 이름이
`erdd_session_<port>` 가 됩니다. 같은 호스트에서 포트만 다른 두 서버가 서로의 로그인을 끊지 않게
하려는 것입니다. 늘 `erdd_session` 을 쓰던 버전에서 그런 설치를 올리면 사용자가 한 번 다시
로그인해야 합니다. compose 배포는 컨테이너 안에서 서버가 늘 3000 으로 뜨므로 해당하지 않습니다.

**해결:** 7절대로 HTTPS 를 붙이세요. TLS 없이 잠깐 시험만 하려면 `.env` 에 한 줄을 더하고 앱을 다시
만드세요. **운영에서는 쓰지 마세요.**

```bash
echo 'ERDD_NODE_ENV=development' >> .env
docker compose up -d --force-recreate app
docker compose exec app printenv NODE_ENV     # should print development
```

방법 B 에서는 `NODE_ENV` 를 직접 내리세요(systemd 라면 `EnvironmentFile` 의 값을 바꾸고
`systemctl restart erdd` 를 실행합니다).

### 9.7 브라우저로 열면 404 만 나온다

**원인:** `apps/web/dist` 가 없습니다. 서버는 그 디렉터리가 있을 때만 정적 파일과 SPA fallback 을
등록합니다. 없으면 `/trpc` 에만 응답합니다.

- 방법 A: 이미지 빌드에 웹 빌드가 들어 있습니다. `docker compose build` 출력을 다시 보고 빌드가
  실패했는지 확인하세요(서비스를 지정하지 마세요. 3.2 참고).
- 방법 B: `pnpm --filter @erdd/web build` 를 건너뛰었습니다(4.1).

### 9.8 `POSTGRES_PASSWORD` 를 바꿨더니 앱이 뜨지 않는다

**증상:** 방법 A 에서 `up` 이 `service "migrate" didn't complete successfully: exit 1` 로 끝나고 `app`
이 뜨지 않습니다. `docker compose logs db` 에
`FATAL:  password authentication failed for user "postgres"` 가 보입니다(`migrate` 로그에는 이
메시지가 안 보일 수 있습니다. 3.2 참고).

**원인:** Postgres 는 `POSTGRES_PASSWORD` 를 **데이터 디렉터리를 처음 초기화할 때만** 반영합니다
(실측 확인). `pgdata` 볼륨이 이미 있는 설치에서 값을 바꾸면 `migrate` 와 `app` 의 `DATABASE_URL` 만
새 값을 받고, DB 는 옛 비밀번호를 그대로 갖고 있습니다. `migrate` 가 먼저 인증에 실패하므로 `app` 은
끝내 뜨지 않습니다.

**해결: 다음 중 하나를 고르세요.**

```bash
# (A) Change the actual password inside the DB (keeps data). exec connects locally, so no password prompt.
docker compose exec db psql -U postgres -c "ALTER USER postgres PASSWORD '<new password>';"
docker compose up -d

# (B) Revert .env to the old password and start again
docker compose up -d
```

설치 직후라 데이터를 버려도 된다면 `docker compose down -v` 로 볼륨을 지우고 처음부터 다시 시작해도
됩니다. **`-v` 는 DB 전체를 지웁니다.** 운영 데이터가 있으면 쓰지 마세요.

---

## 부록: 검증 상태

**실제 명령으로 확인한 것.** 이미지 빌드와 이미지 안의 Node 22 · pnpm 10.4.1 · `apps/web/dist` ·
`apps/server/drizzle/`, `db:migrate` 실행 경로, `health.ping` 응답, `DATABASE_URL` 이 없을 때의 412,
정적 서빙과 SPA fallback, `app` healthcheck 명령, compose 문법과 변수 치환 결과. 그 밖에:

- **방법 A 처음부터 끝까지.** 격리 프로젝트(`docker compose -p <name>`, `ERDD_PORT`·`ERDD_DB_PORT` 로
  비어 있는 호스트 포트, 명령줄 환경에서 준 `POSTGRES_PASSWORD`·`ADMIN_EMAIL`·`ADMIN_PASSWORD`)에서 빈
  볼륨에 `docker compose up -d --build` 를 한 번 실행했습니다. 결과: `migrate` 는 `Exited (0)`, `app`
  은 `(healthy)`, `app` 로그에 3.3 의 세 줄, `health.ping` 200, `auth.me` 401. 같은 명령을 다시
  실행하면 `migrate` 가 다시 돌아 0 으로 끝나고, `app` 컨테이너는 그대로 두며, 데이터도 남습니다.
- **빌드 횟수.** 위 환경은 classic builder 였습니다(buildx 미설치). `migrate` 와 `app` 을 두 번
  빌드했고, 두 번째 빌드에서 `FROM` 뒤의 모든 단계가 `Using cache` 로 끝나 두 태그가 같은 이미지
  ID 를 가리켰습니다.
- **업그레이드 순서.** 8.1 의 `docker events` 관찰(Docker Compose v5.1.4).
- **`migrate` 실패.** 기존 볼륨에 다른 `POSTGRES_PASSWORD` 로 `up -d --build` 를 실행하자 `migrate` 만
  실패했습니다. `up` 은 종료 코드 1 과 `service "migrate" didn't complete successfully: exit 1` 을
  돌려줬고, `app` 은 `Created` 에 머물러 뜨지 않았으며, 인증 실패 메시지는 `db` 로그에만
  나왔습니다(3.2). 원래 비밀번호로 되돌려 다시 실행하면 복구되고 데이터도 남습니다.
- **DB 포트.** `docker port <project>-db-1` 은 `5432/tcp -> 127.0.0.1:<port>` 만 보여 줍니다. 호스트에서
  `pg` 는 `localhost` 와 `127.0.0.1` 둘 다로 접속됩니다(`localhost` 가 `::1` 로 먼저 풀려도 IPv4 로
  넘어갑니다).
- **`ERDD_PORT=127.0.0.1:3000`.** `docker compose config` 가 앱 포트를 `host_ip: 127.0.0.1` 로 펼쳐
  보여 줍니다. 이 값으로 앱을 띄워 보지는 않았습니다.
- **`docker compose pull`.** 빌드 전후 모두 0 으로 끝나고 `migrate` 와 `app` 은 `No image to be pulled`
  로 건너뜁니다. 대조로 두 서비스에 `image:` 이름을 주면 빌드 전 `pull` 이 `pull access denied` 와
  종료 코드 1 로 실패합니다.
- **`-p` 만으로 `exec` 와 `logs`.** compose 파일이 없는 디렉터리에서도
  `docker compose -p <project> exec` 와 `logs` 가 동작합니다(3.5).
- **`db` healthcheck.** 격리 프로젝트를 `docker compose up -d db` 로 띄우자 약 6초 만에
  `Up (healthy)` 가 됐습니다.
- **`POSTGRES_PASSWORD` 는 초기화할 때만 반영됩니다.** 같은 볼륨을 바꾼 비밀번호로 다시 띄우고
  네트워크로 접속하자 새 비밀번호는 `password authentication failed` 였고 옛 비밀번호는
  성공했습니다.
- **`pg_hba.conf` 에서 로컬·루프백은 `trust` 입니다.** 그래서 `docker compose exec db psql` 이
  비밀번호 없이 동작합니다(8.2).
- **초기화 중 임시 서버는 `listen_addresses=''` 를 씁니다.** 이미지의 `docker-entrypoint.sh` 에서
  확인했습니다. healthcheck 가 `-h 127.0.0.1` 을 주는 이유입니다.

**확인하지 못한 것.** 로그인 완료(HTTPS 필요), 백업과 복구, nginx, systemd, 방법 B 전체, 실제 compose
관리 도구(Komodo 등)를 통한 배포, BuildKit(buildx)에서의 빌드 횟수와 캐시 동작은 코드와 설정을 읽고
썼습니다. 실제 환경에서 확인이 더 필요합니다.

---

**다음 문서** — 첫 기동 뒤 여러분과 사용자가 일할 화면은 [사용자 가이드](user-guide.md)가 다룹니다.
저장소의 파일과 스키마를 동기화하려면 [CLI 매뉴얼](cli-guide.md)을 읽으세요.
