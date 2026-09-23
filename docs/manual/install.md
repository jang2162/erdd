# ERDD 설치·운영 매뉴얼

자체 서버에 ERDD 를 올리고 운영하는 담당자를 위한 문서다. 화면 사용법은
[사용자 가이드](user-guide.md), 명령줄 도구는 [CLI 매뉴얼](cli-guide.md), 개발 기여자용 워크플로는
[개발 환경 가이드](../guides/setup.md) 에 있다.

> ⚠️ **혼자 쓸 것이라면 이 문서는 읽지 않아도 된다.** ERDD 에는 서버도 계정도 데이터베이스도 없이
> 저장소 안의 YAML 파일만으로 같은 웹 에디터를 여는 **로컬 모드**가 있다 — `erdd serve` 한 줄이다.
> 이 문서(Docker·PostgreSQL·리버스 프록시·계정 관리)가 필요한 것은 **여러 사람이 한 프로젝트를
> 동시에 편집하고 계정·권한·조직을 나눠야 할 때**다. 판단 기준과 사용법은
> [로컬 모드 매뉴얼](local-guide.md) 에 있다.

## 1. 개요

설치할 것은 **두 개**뿐이다.

```
  브라우저 ──HTTPS──▶ [ 리버스 프록시 ] ──HTTP :3000──▶ ┌─────────────────────────┐
                       TLS 종단(9.6)                   │ ERDD 서버 (Node 22)      │
                                                       │  /        정적 웹(SPA)   │
                                                       │  /trpc/*  API           │
                                                       │  /ws      실시간 협업     │
                                                       └───────────┬─────────────┘
                                                         TCP :5432 ▼
                                                       [ PostgreSQL 17 ]
```

- **서버 프로세스는 하나다.** API·웹 정적 파일·WebSocket 을 한 프로세스가 전부 서빙한다.
  `apps/web/dist` 가 있으면 그 디렉터리를 정적 루트로 등록하고, `/trpc` 로 시작하지 않는
  미매칭 경로는 `index.html` 로 보낸다(SPA fallback). 웹 서버를 따로 둘 필요가 없다.
- **상태는 전부 PostgreSQL 에 있다.** 파일 업로드 저장소가 없고 디스크에 쓰는 것도 없다 —
  백업 대상은 DB 하나뿐이다(8.2).
- **서버는 TLS 를 하지 않는다.** HTTPS 가 필요하면 앞에 리버스 프록시를 둔다(7절).

설치 경로는 **방법 A(Docker Compose)** 와 **방법 B(소스에서 직접 실행)** 둘이다. 이미 Postgres 를
운영 중이거나 Docker 를 못 쓰는 환경이 아니면 방법 A 를 쓴다.

## 2. 요구 사항

| 항목 | 방법 A | 방법 B | 근거 |
|---|---|---|---|
| Docker | Engine + Compose v2 | — | |
| Node.js | (이미지가 포함) | 22 | `.nvmrc` |
| pnpm | (이미지가 포함) | 10.4.1 — `corepack enable` 로 맞춘다 | `package.json` 의 `packageManager` |
| PostgreSQL | (compose 의 `db`) | 17 | `docker-compose.yml` |
| 열려야 할 포트 | `3000`(앱, 호스트 쪽은 `ERDD_PORT` 로 변경). DB 는 호스트 루프백에만 붙으므로 열지 않는다 | `3000`(앱, `PORT` 로 변경) · `5432`(DB) | |

아키텍처는 베이스 이미지 `node:22-slim` 이 지원하는 범위(x86_64 / arm64)다. 빌드에는 npm
레지스트리 접근이 필요하다 — 폐쇄망이면 다른 곳에서 이미지를 만들어 `docker save`/`load` 로 옮긴다.

## 3. 방법 A: Docker Compose (권장)

### 3.1 소스 받기 · `.env` 작성

```bash
git clone <저장소 주소> erdd
cd erdd
cp .env.example .env
```

`.env` 를 열어 최소 다음 셋을 채운다. **이 파일은 저장소에 커밋되지 않는다.**

```dotenv
POSTGRES_PASSWORD=<DB 비밀번호>
ADMIN_EMAIL=admin@your-domain.example
ADMIN_PASSWORD=<충분히 긴 임시 비밀번호>
```

- **`POSTGRES_PASSWORD` 는 지금, 첫 기동 전에 정한다.** 이 값은 Postgres 가 **데이터 디렉터리를
  처음 초기화할 때만** 반영된다. `pgdata` 볼륨이 이미 있는 설치에서 값을 바꾸면 compose 는
  새 값으로 접속하려 하고 DB 는 옛 비밀번호를 그대로 들고 있어 **인증 실패로 앱이 뜨지 않는다**
  (실측 확인). 나중에 바꾸려면 `ALTER USER postgres PASSWORD …` 를 DB 안에서 직접 실행하고
  `.env` 를 함께 고쳐야 한다. 생략하면 기본값 `erdd` 가 쓰인다 — 운영에서는 반드시 바꾼다.
- 비밀번호에 `@ : / # ?` 가 들어가면 접속 URL 이 깨진다. 퍼센트 인코딩하거나 그런 문자를 피한다.
- `docker compose` 는 **같은 디렉터리의 `.env` 를 자동으로 읽어** compose 파일의 `${...}` 를
  치환한다. 앱 컨테이너에 넘어가는 것은 `ADMIN_EMAIL`·`ADMIN_PASSWORD`·`NODE_ENV`(→ 5절의
  `ERDD_NODE_ENV`)와 `POSTGRES_PASSWORD` 가 조립된 `DATABASE_URL` 이다.
- `.env` 의 `DATABASE_URL` 은 **컨테이너가 쓰지 않는다.** 컨테이너의 DB 주소는 `docker-compose.yml`
  의 `migrate`·`app` 서비스에서 똑같이 `postgres://postgres:${POSTGRES_PASSWORD}@db:5432/erdd` 로
  조립된다(compose 네트워크에서 호스트명이 `db` 다). `.env` 쪽 값은 호스트에서 `psql` 등을 붙일 때
  쓴다.
- compose 프로젝트 이름은 **디렉터리 이름**에서 오고 볼륨 이름(`<프로젝트>_pgdata`)이 거기 딸려
  있다. 디렉터리를 옮기거나 이름을 바꾸면 DB 를 잃어버린 것처럼 보인다 — 옮길 거면
  `COMPOSE_PROJECT_NAME` 을 `.env` 에 고정한다. compose 관리 도구로 배포하면 스택 이름이 곧 프로젝트
  이름이다(3.5).

### 3.2 빌드 · 마이그레이션 · 기동 — 한 번에

```bash
docker compose up -d --build
docker compose ps -a
```

이 명령 하나가 순서대로 다음을 한다.

1. **이미지 빌드.** `migrate` 와 `app` 이 같은 `Dockerfile` 로 빌드한다. 빌드는 두 번 돌지만 두
   번째는 첫 빌드의 캐시에 전 단계가 적중해 곧바로 끝난다. 첫 빌드는 의존성 설치와 웹 빌드 때문에
   오래 걸린다.
2. **`db` 기동.** `pg_isready` healthcheck 가 통과해 healthy 가 될 때까지 기다린다.
3. **`migrate`.** `pnpm --filter @erdd/server db:migrate`(drizzle-kit)를 한 번 돌고 끝난다. 적용할
   것이 없으면 아무것도 하지 않고 0 으로 끝나므로 `up` 할 때마다 다시 돌아도 무해하다.
4. **`app` 기동.** `migrate` 가 **0 으로 끝난 뒤에만** 뜬다
   (`depends_on: {migrate: {condition: service_completed_successfully}}`).

기대(`docker compose ps -a`, 필요한 열만):

```
SERVICE   STATUS
app       Up … (healthy)
db        Up … (healthy)
migrate   Exited (0) …
```

`migrate` 가 `Exited (0)` 으로 남아 있는 것이 정상이다 — 한 번 돌고 끝나는 서비스다
(`restart: "no"`). `app` 이 `(healthy)` 가 되기까지는 healthcheck 주기 때문에 수십 초 걸릴 수 있다.

**마이그레이션을 별도 서비스로 두는 이유는 스키마다.** 서버는 마이그레이션을 스스로 적용하지 않고,
기동할 때 DB 를 조회한다(관리자 부트스트랩, 전역 공용 리소스 시드). 연결이 되어도 **테이블이
없으면** 그 시점에 실패하고 프로세스가 종료된다(9.3). `db` 의 healthcheck 는 연결 가능 여부만 보지
스키마는 보지 않으므로, 스키마를 보장하는 것은 `migrate` 다.

**`migrate` 가 실패하면 앱이 뜨지 않는다.** `up` 이 다음 줄로 끝나고 종료코드 1 을 돌려주며,
`docker compose ps -a` 에서 `migrate` 는 `Exited (1)`, `app` 은 `Created` 로 남는다.

```
service "migrate" didn't complete successfully: exit 1
```

원인은 두 로그에서 찾는다.

```bash
docker compose logs migrate
docker compose logs db | grep FATAL
```

⚠️ **`migrate` 로그에는 원인이 나오지 않을 수 있다.** DB 비밀번호가 맞지 않아 실패하면 `migrate`
로그에는 `applying migrations...` 뒤에 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … Exit status 1` 만 남고,
원인인 `FATAL:  password authentication failed for user "postgres"` 는 **`db` 로그에만** 찍힌다.
이 오류는 `POSTGRES_PASSWORD` 를 **기존 `pgdata` 볼륨이 있는 상태에서 바꿨을 때** 나온다(9.8).
원인을 고친 뒤 같은 `docker compose up -d --build` 를 다시 돌리면 된다.

> ⚠️ `db` 는 호스트의 **루프백(`127.0.0.1`)에만** 붙는다(포트는 기본 `5432`, `ERDD_DB_PORT` 로
> 옮긴다). 그 서버에서 `psql` 을 붙일 수는 있고 다른 기계에서는 닿지 않는다. 앱과 `migrate` 는 compose
> 네트워크로 붙으므로 이 포트와 무관하다. 외부에 열어야 하면 `docker-compose.yml` 의 `db.ports`
> 를 직접 고친다 — 그때 **Docker 가 공개한 포트는 호스트 방화벽(ufw 등)을 우회한다**는 점을 알고
> 연다.

### 3.3 기동 로그 · 관리자 부트스트랩

```bash
docker compose logs app
```

첫 기동의 기대 출력(둘째 줄의 식별자는 매번 다르다):

```
부트스트랩 관리자 계정 생성: admin@your-domain.example
예시 전역 공용 리소스 라이브러리 생성: <식별자>
ERDD server listening on :3000
```

- 첫 줄은 **관리자 계정을 실제로 만들었을 때만** 나온다. 그 이메일의 계정이 이미 있으면 서버는
  아무것도 하지 않는다 — **기존 비밀번호를 덮어쓰지 않는다.** 즉 `ADMIN_PASSWORD` 를 바꾸고
  재시작해도 비밀번호는 바뀌지 않는다(잊었다면 다른 관리자가 재설정 링크를 발급해야 한다).
- `ADMIN_EMAIL` 과 `ADMIN_PASSWORD` 중 하나라도 비어 있으면 부트스트랩은 통째로 건너뛴다.
- 둘째 줄은 전역 공용 리소스 예시("표준 사전(예시)")를 시드했을 때 나온다. 이미 전역 라이브러리가
  있으면 건너뛰므로 두 번째 기동부터는 listen 줄만 남는다.

첫 관리자를 만든 뒤에는 `.env` 에서 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 를 지워도 된다.

### 3.4 접속 확인

```bash
curl -s http://127.0.0.1:3000/trpc/health.ping
```

기대:

```json
{"result":{"data":{"ok":true,"version":"0.1.0"}}}
```

`health.ping` 은 DB 없이도 200 을 준다 — **살아 있음(liveness)만 확인**한다. DB 까지 확인하려면
8.3 을 본다.

이제 브라우저로 `http://<서버>:3000` 을 연다. 로그인 화면이 떠야 한다. 다만 **평문 HTTP 로는
로그인이 완료되지 않는다**(9.6) — 7절의 리버스 프록시를 먼저 붙이는 것을 권한다.

### 3.5 compose 관리 도구로 배포할 때 (Komodo 등)

Git 저장소의 compose 파일을 서버에서 빌드·배포해 주는 도구를 쓸 때도 절차는 3.1~3.4 와 같다.
도구가 대신 해 주는 것과 도구 때문에 달라지는 것만 적는다.

- **저장소의 `docker-compose.yml` 을 그대로 쓰고, 배포할 때 빌드가 돌게 켠다.** 이 compose 는
  레지스트리 이미지가 아니라 소스에서 이미지를 빌드한다. 배포 한 번이 3.2 의
  `docker compose up -d --build` 와 같으면 빌드 → 마이그레이션 → 기동이 거기서 다 끝난다.
- **배포 전 명령(훅)으로 마이그레이션을 따로 걸지 않는다.** `migrate` 서비스가 그 몫을 한다. 훅으로
  돌리면 compose 프로젝트 이름(`-p`)을 도구와 정확히 맞춰야 하고, 틀리면 **별도의 빈 DB 에
  마이그레이션하고 끝난다.**
- **도구가 배포 전에 `docker compose pull` 을 불러도 된다.** `migrate`·`app` 은 이미지 이름이 없어
  `Skipped No image to be pulled` 로 건너뛰고 `postgres:17` 만 받는다.
- **환경 변수는 도구에 넣는다.** 도구가 그 값을 compose 파일 옆의 `.env` 로 써 주면 3.1 과 똑같이
  치환된다. 넣을 값은 3.1 의 셋과 5절의 compose 변수 표다.
- **`POSTGRES_PASSWORD` 는 첫 배포 전에 정한다**(3.1). 첫 배포가 기본값 `erdd` 로 DB 를 초기화하면
  나중에 도구에서 값을 바꿔도 `migrate` 가 인증 실패로 멈춘다(9.8).
- ⚠️ **스택 이름이 compose 프로젝트 이름이고, 볼륨 이름(`<스택 이름>_pgdata`)이 거기 딸린다.**
  스택 이름을 바꾸거나 같은 저장소로 스택을 새로 만들면 **빈 DB 가 새로 생긴다** — 옛 볼륨은 남아
  있지만 붙지 않는다. 3.1 의 프로젝트 이름 항목과 같은 함정이다.
- **HTTPS 와 `/ws`** 는 7절대로 앞에 프록시를 둔다. 프록시가 같은 서버에 있으면 `ERDD_PORT` 를
  `127.0.0.1:3000` 으로 준다(7절).
- **백업·`exec` 명령에는 `-p <스택 이름>` 을 붙인다.** 도구가 compose 파일을 둔 디렉터리 밖에서
  `docker compose` 를 부르면 프로젝트를 찾지 못한다. `-p` 를 주면 compose 파일이 없는 디렉터리에서도
  `exec`·`logs` 가 동작한다.

  ```bash
  docker compose -p <스택 이름> exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql
  docker compose -p <스택 이름> logs migrate
  ```

## 4. 방법 B: 소스에서 직접 실행

PostgreSQL 17 이 이미 준비돼 있고 빈 DB 와 접속 정보가 있다고 가정한다.

### 4.1 빌드

```bash
git clone <저장소 주소> /opt/erdd
cd /opt/erdd
corepack enable                 # pnpm 10.4.1 이 붙는다
pnpm install --frozen-lockfile
pnpm --filter @erdd/web build   # apps/web/dist 생성 — 이게 있어야 서버가 웹을 서빙한다
```

`apps/web/dist/index.html` 이 생겼는지 확인한다. 없으면 서버는 API 만 서빙하고 브라우저로 열면
404 가 난다.

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
ADMIN_PASSWORD='<임시 비밀번호>' \
pnpm --filter @erdd/server start
```

기대: `ERDD server listening on :3000`.

### 4.4 systemd 유닛 예시

경로(`/opt/erdd`)와 `User` 는 환경에 맞게 바꾼다. `ExecStart` 는 pnpm·corepack 을 거치지 않고
`tsx` 를 직접 부른다 — Docker 이미지가 쓰는 것과 같은 실행 형태다.

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
# 서버는 SIGTERM 을 받으면 연결을 닫고 스스로 종료한다.
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

`/etc/erdd/erdd.env` (권한 `0600`, 소유자 `erdd`):

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://erdd:<pass>@127.0.0.1:5432/erdd
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now erdd
journalctl -u erdd -f      # ERDD server listening on :3000 이 보여야 한다
```

## 5. 환경 변수

서버 코드에서 `process.env` 를 읽는 자리는 아래가 전부다.

| 이름 | 필수 | 기본값 | 설명 | 읽는 위치 |
|---|---|---|---|---|
| `DATABASE_URL` | **예** | 없음 | PostgreSQL 접속 문자열. 없으면 서버는 뜨지만 모든 API 가 412 다(9.1). | `apps/server/src/main.ts`, `apps/server/drizzle.config.ts` |
| `PORT` | 아니오 | `3000` | listen 포트. 바인드 주소는 항상 `0.0.0.0` 이다. **compose 는 이 값을 앱 컨테이너에 넘기지 않는다** — 방법 A 에서 포트를 옮기려면 아래 `ERDD_PORT` 를 쓴다. | `apps/server/src/main.ts` |
| `NODE_ENV` | 아니오 | 없음 | `production` 일 때만 세션 쿠키에 `Secure` 가 붙는다. **서버 코드에서 이 변수가 바꾸는 동작은 이것 하나뿐이고**, 읽는 자리도 `auth.login` 한 곳뿐이다(로그인 요청마다 읽는다). Docker 이미지에 `production` 이 박혀 있고, compose 는 `ERDD_NODE_ENV` 로 이 값을 채운다. | `apps/server/src/routers/auth.ts` |
| `ADMIN_EMAIL` | 아니오 | 없음 | 최초 관리자 부트스트랩. `ADMIN_PASSWORD` 와 **둘 다** 있어야 동작한다. | `apps/server/src/services/accounts.ts` |
| `ADMIN_PASSWORD` | 아니오 | 없음 | 위와 같음. 해당 이메일의 계정이 없을 때만 쓰인다. | 〃 |

**서버는 `.env` 파일을 스스로 읽지 않는다.** dotenv 류를 쓰지 않으므로 값은 셸 환경·systemd
`EnvironmentFile`·compose 를 통해 들어와야 한다.

앱이 아니라 **compose 가 읽는** 변수 — `.env` 에 두면 compose 가 치환한다:

| 이름 | 기본값 | 무엇을 정하나 |
|---|---|---|
| `POSTGRES_PASSWORD` | `erdd` | `db` 의 비밀번호이자 `migrate`·`app` 의 `DATABASE_URL` 에 조립되는 값. **데이터 디렉터리 초기화 시점에만 반영된다**(3.1 의 함정). |
| `ERDD_PORT` | `3000` | 앱 컨테이너를 호스트 어느 포트에 붙일지. 포트만 주면 모든 인터페이스에 붙고, **`127.0.0.1:3000` 처럼 호스트 주소를 앞에 붙이면 그 주소에만 붙는다**(리버스 프록시 뒤에 둘 때 — 7절). 컨테이너 안쪽은 `3000` 으로 고정이다(포트 매핑과 healthcheck 가 그 값을 쓴다). |
| `ERDD_DB_PORT` | `5432` | `db` 컨테이너를 호스트 **루프백(`127.0.0.1`)** 의 어느 포트에 붙일지. 호스트에서 `psql` 등을 붙이는 용도이고 앱·`migrate` 는 이 값과 무관하다. 루프백 밖으로 여는 설정은 변수로 할 수 없다 — `docker-compose.yml` 의 `db.ports` 를 고친다(3.2). |
| `ERDD_NODE_ENV` | `production` | 앱 컨테이너의 `NODE_ENV`. **이름이 `NODE_ENV` 가 아닌 것은 의도다** — 그러면 운영자 셸에 우연히 남은 `NODE_ENV` 가 흘러들어 쿠키의 `Secure` 가 조용히 꺼진다. |

그 밖에 운영과 무관한 변수:

| 이름 | 어디에 쓰이나 |
|---|---|
| `ERDD_SERVER_PORT` | **개발 전용.** vite dev 서버의 프록시 대상 포트(`apps/web/vite.config.ts`). 운영 빌드에는 관여하지 않는다. |
| `ERDD_WEB_PORT` | **개발 전용.** vite dev 서버가 listen 할 포트(`apps/web/vite.config.ts`). 설정하지 않거나 빈 값이면 기본 `5173` 이고, 값이 있는데 포트로 읽히지 않으면 조용히 기본값으로 떨어지지 않고 에러로 죽는다. 운영 빌드에는 관여하지 않는다. |
| `ERDD_WEB_HOST` | **개발 전용.** vite dev 서버의 바인딩 주소(`apps/web/vite.config.ts`). 설정하지 않거나 빈 값이면 기본 `127.0.0.1` 이다 — vite 가 IPv6 `[::1]` 에만 붙으면 브라우저가 접속하지 못하므로 빈 값도 기본값으로 돌린다. 운영 빌드에는 관여하지 않는다. |
| `ERDD_TOKEN` | `erdd` CLI 가 쓰는 액세스 토큰(`packages/cli`). 서버 동작에 영향 없다(→ [CLI 매뉴얼](cli-guide.md)). |

## 6. 최초 기동 후 할 일

계정은 **셀프 가입이 없다.** 관리자가 일회용 초대 링크를 발급해 전달하는 폐쇄형이고,
**메일 발송 기능이 없다** — 링크는 화면에 뜨고 관리자가 직접 전달한다.

1. **관리자로 로그인** — 3.3 에서 만든 `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **관리자 비밀번호 변경** — 부트스트랩 비밀번호는 환경 변수·배포 이력에 평문으로 남아 있다.
3. **사용자 초대** — 관리자 페이지에서 이메일과 서비스 역할을 정해 초대 링크를 발급하고 전달한다.
   수락자가 링크를 열어 이름과 비밀번호를 정할 때 계정과 개인 조직이 함께 만들어진다.
4. **팀 조직 생성 · 멤버 추가** — 조직을 만들고, 이미 가입한 사용자는 이메일로 찾아 추가하고,
   미가입자에게는 조직 초대 링크를 발급한다.

화면 조작은 [사용자 가이드](user-guide.md)로 넘긴다.

> ⚠️ **초대·재설정 링크의 주소는 "관리자가 보고 있는 주소" 기준으로 만들어진다.** 링크 URL 은
> 브라우저에서 현재 접속 중인 origin 에 경로를 붙여 조립된다. 관리자가
> `http://10.0.0.5:3000` 으로 접속해 링크를 만들면 그 주소가 그대로 박히고, 사외에서는 열리지
> 않는다. **관리자도 사용자와 같은 공개 주소로 접속해서** 링크를 발급해야 한다.

## 7. 리버스 프록시

**서버는 TLS 를 종단하지 않는다.** HTTPS 가 필요하면 프록시를 앞에 둔다. 세션 쿠키에
`Secure` 가 붙기 때문에 사실상 필수다(9.6).

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

    # 서버의 본문 한도가 16 MiB 다(대량 일괄 편집 배치가 통과해야 한다).
    # 여기가 더 작으면 큰 편집이 nginx 단계에서 413 으로 잘린다.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 실시간 협업. 업그레이드를 넘기지 않으면 편집은 되는데 남의 변경이 안 보인다(9.4).
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 서버는 30초마다 ping 을 보낸다. 유휴 타임아웃이 그보다 짧으면 연결이 계속 끊긴다.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

알아 둘 것:

- **`X-Forwarded-*` 는 현재 서버가 읽지 않는다**(Fastify 에 `trustProxy` 를 켜 두지 않았다).
  넣어 두는 것은 관례이자 앞으로의 대비이고, 쿠키의 `Secure` 여부는 이 헤더가 아니라
  `NODE_ENV` 로만 결정된다.
- 앱을 프록시 전용으로 가두려면 `.env` 에 `ERDD_PORT=127.0.0.1:3000` 을 둔다. compose 가 포트
  매핑을 `"127.0.0.1:3000:3000"` 으로 펼쳐 루프백에만 붙는다 — compose 파일을 고칠 필요가 없다.
  적용은 `docker compose up -d`(앱 컨테이너가 다시 만들어진다).
- 서브패스(`/erdd/` 같은 경로) 배치는 검증된 구성이 아니다. 서브도메인이나 전용 호스트를 쓴다.

## 8. 운영

### 8.1 업그레이드

**순서가 중요하다: 코드 갱신 → 빌드 → 마이그레이션 → 재시작.** 새 스키마를 요구하는 코드를
먼저 띄우면 서버가 기동 중 DB 를 조회하다 실패해 재시작 루프에 빠진다. 방법 A 에서는 이 순서를
compose 가 지킨다.

```bash
cd /opt/erdd
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql   # 백업(8.2)
git pull
docker compose up -d --build
docker compose ps -a
docker compose logs app | tail -3
```

`up -d --build` 는 새 이미지를 빌드한 뒤 **옛 `app` 컨테이너를 멈춰 지우고**, `migrate` 를 돌리고,
그것이 0 으로 끝나면 새 `app` 을 띄운다. **옛 `app` 은 `migrate` 가 시작되기 전에 이미 멈춰
있으므로** 옛 코드가 새 스키마 위에서 도는 구간이 없다 — `docker compose stop app` 을 먼저 할
필요가 없다. 이 순서는 `docker events --filter label=com.docker.compose.project=<프로젝트>` 로
컨테이너 이벤트를 기록하면서 이미지가 바뀐 상태에서 `up -d --build` 를 돌려 확인했다 — 옛 `app` 의
`stop`·`destroy` 가 `migrate` 의 `start` 보다 먼저 온다(Docker Compose v5.1.4). 다른 판의 compose 에서
순서를 확신할 수 없으면 `docker compose stop app` 을 먼저 해도 해가 없다.

- **`migrate` 가 실패하면 서비스가 멈춘 채로 남는다.** 옛 `app` 은 이미 내려갔고 새 `app` 은 뜨지
  않는다(3.2 의 실패 모습). 원인을 고치고 같은 명령을 다시 돌린다. 되돌려야 하면 위에서 받은
  백업으로 복구한다(8.2).
- **이미지가 그대로면**(코드가 바뀌지 않았으면) `app` 컨테이너는 건드리지 않고 `migrate` 만 다시
  돌고 끝난다.

방법 B 는 순서를 손으로 지킨다: `systemctl stop erdd` → `git pull` → `pnpm install --frozen-lockfile` →
`pnpm --filter @erdd/web build` → `db:migrate` → `systemctl start erdd`.

- **업그레이드 중에는 서비스가 멈춘다.** 프로세스가 하나뿐이라 무중단 롤링 교체를 지원하지 않는다.
- **업그레이드 전에 백업한다**(8.2). 마이그레이션에는 되돌리기 스크립트가 없다.

### 8.2 백업과 복구

상태는 전부 PostgreSQL 에 있다. 파일 업로드 저장소가 없으므로 **DB 덤프 하나가 전체 백업**이다.

```bash
# 백업
docker compose exec -T db pg_dump -U postgres erdd > erdd-$(date +%F).sql

# 복구 — 비어 있는 DB 로 되돌린다
docker compose stop app                      # 쓰기를 멈춘다
docker compose exec -T db psql -U postgres -d erdd < erdd-2026-08-10.sql
docker compose up -d app
```

- 위 명령에 비밀번호가 없는 것이 맞다. `docker compose exec` 는 컨테이너 **안에서** 부르는
  것이고, Postgres 기본 `pg_hba.conf` 는 로컬·루프백 접속을 `trust` 로 둔다(실측 확인).
  `POSTGRES_PASSWORD` 를 바꿔도 이 명령은 그대로 동작한다.
- 복구 대상 DB 는 비어 있어야 한다. 기존 DB 위에 덮으려면 DB 를 지우고 다시 만들거나
  `pg_dump -Fc` + `pg_restore --clean --if-exists` 를 쓴다.
- compose 볼륨(`<프로젝트>_pgdata`)을 통째로 스냅샷해도 되지만, 그때는 컨테이너를 **정지한
  상태**에서 복사해야 한다.

### 8.3 헬스체크

| 목적 | 명령 | 정상 |
|---|---|---|
| 프로세스가 살아 있는가 | `curl -s http://127.0.0.1:3000/trpc/health.ping` | `{"result":{"data":{"ok":true,"version":"0.1.0"}}}` |
| DB 까지 붙어 있는가 | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/trpc/auth.me` | **412 가 아니면** 정상. 로그인하지 않은 상태면 401 이 온다. |

`health.ping` 은 인증이 필요 없는 공개 프로시저이고 **DB 가 없어도 200 을 준다.** 로드밸런서에
DB 상태까지 반영하고 싶으면 두 번째 줄을 쓴다.

`docker compose ps -a` 로 세 서비스의 상태를 한 번에 본다. `db`·`app` 에는 healthcheck 가 붙어
있고, `migrate` 는 한 번 돌고 끝나는 서비스라 `Exited (0)` 이 정상이다(`-a` 가 없으면 목록에서
빠진다).

| 서비스 | 검사 | 비고 |
|---|---|---|
| `db` | `pg_isready -U postgres -d erdd -h 127.0.0.1` | `-h 127.0.0.1` 이 필수다. 초기화 중에는 임시 서버가 `listen_addresses=''` 로 떠 TCP 를 열지 않으므로, 유닉스 소켓으로 검사하면 DB 가 만들어지기 전에 "준비됨" 으로 보고한다. |
| `app` | 위 표 첫 줄과 같은 `health.ping` 호출 | 이미지에 curl·wget 이 없어 Node 의 `fetch` 로 호출한다. |

`app` 의 healthcheck 는 `health.ping` 을 보므로 **DB 상태를 반영하지 않는다.** DB 까지 묶어
판정하려면 위 표 두 번째 줄을 외부 모니터링에서 쓴다.

### 8.4 로그

```bash
docker compose logs -f app     # 방법 A
docker compose logs migrate    # 방법 A — 마지막 마이그레이션 실행
journalctl -u erdd -f          # 방법 B
```

**서버는 HTTP 접근 로그를 남기지 않는다**(Fastify 로거를 꺼 두었다). 표준 출력에 나오는 것은
사실상 다음뿐이다.

- `ERDD server listening on :<포트>` — 기동 성공
- `부트스트랩 관리자 계정 생성: <이메일>` — 관리자를 실제로 만들었을 때
- `예시 전역 공용 리소스 라이브러리 생성: <식별자>` — 전역 공용 리소스 예시를 시드했을 때
- 기동 실패 시의 스택 트레이스(그 뒤 프로세스 종료)

요청별 접근 기록·응답 시간·상태 코드가 필요하면 **리버스 프록시의 액세스 로그**를 본다.

## 9. 문제 해결

### 9.1 화면에 "연결에 문제가 있습니다" 가 뜬다 (가장 흔하다)

**원인:** `DATABASE_URL` 이 서버 프로세스에 전달되지 않았다. 이때 서버는 **정상적으로 뜬다** —
로그에 `ERDD server listening on :3000` 만 찍히고 오류가 없어서 헷갈린다. DB 없이 뜬 서버는
DB 를 쓰는 모든 프로시저를 412 로 거절한다.

```bash
curl -s http://127.0.0.1:3000/trpc/auth.me
# {"error":{"message":"DB가 구성되지 않았습니다", ... "httpStatus":412 ...}}
```

이 메시지가 보이면 확정이다. **해결:** 값이 실제로 프로세스에 들어갔는지 본다.

```bash
docker compose exec app printenv DATABASE_URL     # 방법 A
sudo systemctl show erdd -p Environment           # 방법 B (EnvironmentFile 내용은 안 보인다)
```

흔한 실수 셋 — `.env` 에만 적고 셸에 export 하지 않았다(서버는 `.env` 를 읽지 않는다), systemd 의
`EnvironmentFile` 경로 오타, compose 에서 `app` 서비스가 아니라 `.env` 쪽 `DATABASE_URL` 을
고쳤다(컨테이너는 그 값을 쓰지 않는다).

### 9.2 포트가 이미 쓰이고 있다

**증상:** 방법 A 는 `docker compose up` 이 `port is already allocated` 로 실패한다. 방법 B 는
기동 직후 `listen EADDRINUSE` 계열 오류를 찍고 프로세스가 종료된다. compose 의 앱은
`restart: unless-stopped` 때문에 재시작을 반복한다.

```bash
ss -lntp | grep -E ':(3000|5432)\b'        # 누가 물고 있는지
echo 'ERDD_PORT=3100' >> .env              # 방법 A: 호스트 쪽 포트만 옮긴다
docker compose up -d app
PORT=3100 ... pnpm --filter @erdd/server start   # 방법 B
```

5432 가 겹치면(같은 서버에 Postgres 가 이미 떠 있는 경우 등) `.env` 에 `ERDD_DB_PORT=5433` 처럼
호스트 쪽 포트만 옮긴다. 서버에서 DB 에 직접 붙을 일이 없으면 `docker-compose.yml` 의 `db.ports` 를
지워도 된다 — 앱과 `migrate` 는 compose 네트워크로 붙으므로 호스트 포트가 필요 없다.

### 9.3 마이그레이션을 적용하지 않았다

**방법 A** 에서는 `migrate` 가 `app` 보다 먼저 돌고 `app` 은 그것이 0 으로 끝나야 뜨므로, 스키마
없이 앱이 뜨는 일은 없다. 대신 **`migrate` 가 실패하면 앱이 아예 뜨지 않는다** — `up` 이
`service "migrate" didn't complete successfully: exit 1` 로 끝나고, `docker compose ps -a` 에서
`migrate` 는 `Exited (1)`, `app` 은 `Created` 다. 원인 찾는 법과 해결은 3.2 의 실패 항목이다.
원인을 고친 뒤 같은 명령을 다시 돌린다.

```bash
docker compose up -d --build
```

**방법 B**(또는 스키마 없는 DB 에 서버를 붙였을 때)의 증상: 서버가 기동 도중 종료된다. 로그에
`relation "users" does not exist` 류의 Postgres 오류와 스택 트레이스가 찍히고 프로세스가 끝난다.
`ERDD server listening on` 은 **찍히지 않는다.** systemd 라면 `Restart=on-failure` 로 재시작을
반복한다.

기동 시퀀스가 `관리자 부트스트랩 → 전역 리소스 시드 → listen` 순서라, 스키마가 없으면 listen
전에 걸린다. 3.1 대로 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 를 채웠으면 부트스트랩이 `users` 를 먼저
조회하므로 그 테이블이 먼저 걸리고, 둘을 비워 두면 부트스트랩이 조회 없이 건너뛰어
`relation "resource_libraries" does not exist` 가 먼저 뜬다. 어느 쪽이든 원인은 같다.

**해결:** 4.2 를 실행한 뒤 서버를 다시 띄운다.

### 9.4 실시간 협업이 동작하지 않는다

**증상:** 내 편집은 저장되는데(새로 고치면 남아 있다) 다른 사람의 변경과 커서가 보이지 않는다.
또는 잠시 되다가 주기적으로 끊긴다.

편집 저장은 `/trpc` 로, 남의 변경 수신은 `/ws` 로 간다. 그래서 **저장은 되는데 협업만 안 되는**
모습이 나온다 — 원인은 거의 항상 프록시다.

확인: 브라우저 개발자 도구 → Network → WS 탭에서 `/ws?projectId=…` 요청을 본다.

| 관찰 | 원인 |
|---|---|
| 요청이 `101 Switching Protocols` 가 아니다 | 프록시가 `Upgrade`/`Connection` 헤더를 넘기지 않는다 → 7절의 `location /ws` 블록. |
| 101 은 되는데 몇십 초마다 끊긴다 | 프록시의 유휴 타임아웃이 짧다. 서버 ping 주기가 30초이므로 `proxy_read_timeout` 을 넉넉히(예: 300s). |
| 곧바로 닫힌다 | 로그인 세션이 없거나 그 프로젝트를 볼 권한이 없다. 소켓 인증은 tRPC 와 같은 세션 쿠키를 쓴다. |

### 9.5 초대·비밀번호 재설정 링크가 열리지 않는다

만료 시간은 다음과 같다.

| 링크 | 유효 기간 | 재사용 |
|---|---|---|
| 초대 | **7일** | 1회용 |
| 비밀번호 재설정 | **24시간** | 1회용 |
| 로그인 세션 | 14일 | — |

- 화면 문구가 **"기한이 지난 링크입니다"** 면 만료·취소다 → 관리자가 재발급한다.
- **"이미 사용된 링크입니다"** 면 누군가 이미 썼다.
  - **초대**는 재발급할 수 없다. 사용됐다는 것은 그 이메일의 계정이 이미 만들어졌다는 뜻이다 —
    본인이 로그인하거나, 비밀번호를 모르면 관리자가 **재설정 링크**를 발급한다.
  - **재설정**은 다시 발급할 수 있다.
- **재발급하면 이전 미사용 링크가 함께 죽는다.** 두 링크를 동시에 살려 둘 수 없으니, 오래된
  링크를 들고 있는 사람에게는 새 링크를 다시 전달해야 한다.
- 링크는 발급 시점에 한 번만 보이고 다시 조회할 수 없다. 잃으면 재발급이다.

### 9.6 로그인을 눌러도 다시 로그인 화면으로 돌아온다

**원인:** 세션 쿠키에 `Secure` 가 붙어 있는데 접속이 평문 HTTP 다. 브라우저가 쿠키를 저장하지
않으니 다음 요청에서 다시 미인증이 된다.

`Secure` 를 결정하는 자리는 **코드 전체에서 한 곳뿐이다** — `apps/server/src/routers/auth.ts` 의
`auth.login` 이 쿠키를 심을 때 `secure: process.env.NODE_ENV === 'production'` 을 평가한다.
로그인 요청마다 읽으므로 프로세스의 현재 환경 변수가 그대로 반영된다. 쿠키 미들웨어
(`@fastify/cookie`)는 옵션 없이 등록돼 있어 전역 기본값이 따로 없고, 프록시 헤더
(`X-Forwarded-Proto`)나 요청 스킴은 판정에 **관여하지 않는다.** Docker 이미지에는
`NODE_ENV=production` 이 박혀 있다. 쿠키의 나머지 속성은 `httpOnly`, `SameSite=Lax`, `Path=/`,
만료 14일이고 이름은 `erdd_session` 이다.

**해결:** 7절대로 HTTPS 를 붙인다. TLS 없이 잠깐 시험만 할 목적이라면 `.env` 에 한 줄 넣고
앱을 다시 만든다 — **운영에서는 쓰지 않는다.**

```bash
echo 'ERDD_NODE_ENV=development' >> .env
docker compose up -d --force-recreate app
docker compose exec app printenv NODE_ENV     # development 가 나와야 한다
```

방법 B 는 `NODE_ENV` 를 직접 내린다(systemd 라면 `EnvironmentFile` 의 값을 고치고
`systemctl restart erdd`).

### 9.7 브라우저로 열면 404 만 나온다

**원인:** `apps/web/dist` 가 없다. 서버는 그 디렉터리가 있을 때만 정적 파일과 SPA fallback 을
등록하고, 없으면 `/trpc` 만 응답한다.

- 방법 A: 이미지 빌드가 웹 빌드를 포함한다. 빌드가 실패했는지 `docker compose build app` 출력을
  다시 본다.
- 방법 B: `pnpm --filter @erdd/web build` 를 빠뜨렸다(4.1).

### 9.8 `POSTGRES_PASSWORD` 를 바꿨더니 앱이 뜨지 않는다

**증상:** 방법 A 의 `up` 이 `service "migrate" didn't complete successfully: exit 1` 로 끝나고
`app` 이 뜨지 않는다. `docker compose logs db` 에
`FATAL:  password authentication failed for user "postgres"` 가 찍혀 있다(`migrate` 로그에는 이
문구가 나오지 않을 수 있다 — 3.2).

**원인:** `POSTGRES_PASSWORD` 는 Postgres 가 **데이터 디렉터리를 처음 초기화할 때만** 반영된다
(실측 확인). `pgdata` 볼륨이 이미 있는 설치에서 값을 바꾸면 `migrate`·`app` 의 `DATABASE_URL` 만 새
값이 되고 DB 는 옛 비밀번호를 그대로 들고 있다. `migrate` 가 먼저 인증에 실패하므로 `app` 은
시작되지도 않는다.

**해결 — 둘 중 하나.**

```bash
# (A) DB 안에서 실제 비밀번호를 바꾼다(데이터 보존). exec 는 로컬 접속이라 비밀번호를 묻지 않는다.
docker compose exec db psql -U postgres -c "ALTER USER postgres PASSWORD '<새 비밀번호>';"
docker compose up -d

# (B) .env 를 옛 비밀번호로 되돌리고 다시 띄운다
docker compose up -d
```

데이터를 버려도 되는 설치 직후라면 `docker compose down -v` 로 볼륨까지 지우고 다시 시작해도
된다 — **`-v` 는 DB 를 통째로 삭제한다.** 운영 데이터가 있으면 쓰지 마라.

---

## 부록: 검증 상태

**실제 명령으로 확인한 것.** 이미지 빌드와 이미지 안의 Node 22 · pnpm 10.4.1 · `apps/web/dist` ·
`apps/server/drizzle/`, `db:migrate` 실행 경로, `health.ping` 응답, `DATABASE_URL` 없을 때의 412,
정적 서빙과 SPA fallback, `app` healthcheck 명령, compose 문법과 변수 치환 결과. 여기에:

- **방법 A 를 처음부터 끝까지** — 격리 프로젝트(`docker compose -p <이름>`, 비어 있는 호스트
  포트를 `ERDD_PORT`·`ERDD_DB_PORT` 로, `POSTGRES_PASSWORD`·`ADMIN_EMAIL`·`ADMIN_PASSWORD` 는 명령줄
  환경으로)에서 빈 볼륨으로 `docker compose up -d --build` 한 번을 돌렸다. `migrate` 가
  `Exited (0)`, `app` 이 `(healthy)`, `app` 로그에 3.3 의 세 줄, `health.ping` 200, `auth.me` 401.
  같은 명령을 다시 돌리면 `migrate` 가 다시 돌아 0 으로 끝나고 `app` 컨테이너는 그대로이며 데이터가
  남는다.
- **빌드 횟수** — 위 환경은 classic builder(buildx 미설치)였다. `migrate`·`app` 두 번 빌드하고, 두
  번째 빌드는 `FROM` 뒤 전 단계가 `Using cache` 로 끝나 두 태그가 같은 이미지 ID 를 가리켰다.
- **업그레이드 순서** — 8.1 의 `docker events` 관찰(Docker Compose v5.1.4).
- **`migrate` 실패** — 기존 볼륨에 다른 `POSTGRES_PASSWORD` 로 `up -d --build` 를 돌려
  `migrate` 만 실패시켰다. `up` 이 종료코드 1 과 `service "migrate" didn't complete successfully:
  exit 1`, `app` 은 `Created` 로 남아 뜨지 않았고, 인증 실패 문구는 `db` 로그에만 있었다(3.2).
  원래 비밀번호로 되돌려 다시 돌리면 복구되고 데이터가 남는다.
- **DB 포트** — `docker port <프로젝트>-db-1` 이 `5432/tcp -> 127.0.0.1:<포트>` 하나뿐이다. 호스트에서
  `pg` 로 `localhost`·`127.0.0.1` 둘 다 접속된다(`localhost` 가 `::1` 로 먼저 풀려도 IPv4 로 넘어간다).
- **`ERDD_PORT=127.0.0.1:3000`** — `docker compose config` 에서 앱 포트가 `host_ip: 127.0.0.1` 로
  펼쳐지는 것까지 확인했다. 이 값으로 앱을 띄워 보지는 않았다.
- **`docker compose pull`** — 빌드 전·후 모두 0 으로 끝나고 `migrate`·`app` 을
  `No image to be pulled` 로 건너뛴다. 대조로 두 서비스에 `image:` 이름을 붙이면 빌드 전 `pull` 이
  `pull access denied` 로 종료코드 1 이다.
- **`-p` 만으로 `exec`·`logs`** — compose 파일이 없는 디렉터리에서 `docker compose -p <프로젝트>
  exec`·`logs` 가 동작한다(3.5).
- **`db` healthcheck** — `docker compose up -d db` 로 격리 프로젝트를 띄워 약 6초 만에
  `Up (healthy)` 로 전이하는 것을 확인했다.
- **`POSTGRES_PASSWORD` 는 초기화 시점에만 반영된다** — 같은 볼륨에 비밀번호를 바꿔 재기동한 뒤
  네트워크 경유로 접속해, 새 비밀번호는 `password authentication failed`, 옛 비밀번호는 성공하는
  것을 확인했다.
- **`pg_hba.conf` 의 로컬·루프백은 `trust`** — 그래서 `docker compose exec db psql` 이 비밀번호
  없이 동작한다(8.2).
- **초기화 중 임시 서버는 `listen_addresses=''`** — 이미지의 `docker-entrypoint.sh` 에서 확인했다.
  healthcheck 에 `-h 127.0.0.1` 을 준 근거다.

**확인하지 않은 것.** 로그인 완료(HTTPS 필요), 백업·복구, nginx, systemd, 방법 B 전체, 실제
compose 관리 도구(Komodo 등)를 통한 배포, BuildKit(buildx) 환경에서의 빌드 횟수와 캐시 동작은
코드와 설정을 읽고 쓴 것이며 실환경 검증이 남아 있다.
