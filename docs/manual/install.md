# ERDD 설치·운영 매뉴얼

사내 서버에 ERDD 를 올리고 운영하는 담당자를 위한 문서다. 화면 사용법은
[사용자 가이드](user-guide.md), 개발 기여자용 워크플로는
[HANDOFF](../superpowers/HANDOFF.md) 에 있다.

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
| 열려야 할 포트 | `3000`(앱, `PORT` 로 변경) · `5432`(DB) | 좌동 | |

아키텍처는 베이스 이미지 `node:22-slim` 이 지원하는 범위(x86_64 / arm64)다. 빌드에는 npm
레지스트리 접근이 필요하다 — 폐쇄망이면 다른 곳에서 이미지를 만들어 `docker save`/`load` 로 옮긴다.

## 3. 방법 A: Docker Compose (권장)

### 3.1 소스 받기 · `.env` 작성

```bash
git clone <저장소 주소> erdd
cd erdd
cp .env.example .env
```

`.env` 를 열어 최소 다음 둘을 채운다. **이 파일은 저장소에 커밋되지 않는다.**

```dotenv
ADMIN_EMAIL=admin@사내도메인
ADMIN_PASSWORD=<충분히 긴 임시 비밀번호>
```

- `docker compose` 는 **같은 디렉터리의 `.env` 를 자동으로 읽어** compose 파일의 `${...}` 를
  치환한다. 앱 컨테이너에 넘어가는 것은 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 뿐이다.
- `.env` 의 `DATABASE_URL` 은 **컨테이너가 쓰지 않는다.** 앱의 DB 주소는 `docker-compose.yml` 의
  `app` 서비스에 `postgres://postgres:erdd@db:5432/erdd` 로 박혀 있다(compose 네트워크에서
  호스트명이 `db` 다). `.env` 쪽 값은 호스트에서 `psql`·마이그레이션을 돌릴 때 쓴다.
- compose 프로젝트 이름은 **디렉터리 이름**에서 오고 볼륨 이름(`<프로젝트>_pgdata`)이 거기 딸려
  있다. 디렉터리를 옮기거나 이름을 바꾸면 DB 를 잃어버린 것처럼 보인다 — 옮길 거면
  `COMPOSE_PROJECT_NAME` 을 `.env` 에 고정한다.

### 3.2 DB 먼저 띄우기

```bash
docker compose up -d db
docker compose logs db | tail -3
```

기대: `database system is ready to accept connections`.

**앱보다 DB 를 먼저 띄우는 데는 이유가 있다.** 서버는 기동할 때 DB 를 조회한다(관리자 부트스트랩,
전역 공용 리소스 시드). 스키마가 아직 없으면 그 시점에 실패하고 프로세스가 종료된다. 그래서
순서가 **DB → 마이그레이션 → 앱**이다. (`docker compose up -d` 는 앱까지 띄운다. 개발 중에
DB 만 필요하면 위처럼 `db` 를 지정한다.)

> ⚠️ `db` 서비스는 호스트의 `5432` 를 그대로 연다. 운영 서버에서는 방화벽으로 막거나
> `docker-compose.yml` 의 `db.ports` 줄을 지운다(같은 compose 네트워크 안의 앱은 포트를
> 공개하지 않아도 붙는다).

### 3.3 마이그레이션 적용

**서버는 마이그레이션을 자동으로 적용하지 않는다.** 별도 단계다.

```bash
docker compose build app
docker compose run --rm app pnpm --filter @erdd/server db:migrate
```

기대: `Reading config file '/app/apps/server/drizzle.config.ts'` 에 이어 오류 없이 끝난다(적용할
것이 없으면 조용히 끝난다). 마이그레이션 파일은 `apps/server/drizzle/` 에 `0000`~`0012` 가 있고
이미지 안에도 그대로 들어 있다.

실패 신호 — `ECONNREFUSED`/`getaddrinfo` 는 DB 가 아직 안 떴거나 주소가 틀린 것(3.2 를 먼저),
`password authentication failed` 는 외부 DB 를 쓰면서 `app` 서비스의 `DATABASE_URL` 을 안 고친 것.

### 3.4 앱 기동 · 관리자 부트스트랩

```bash
docker compose up -d app
docker compose logs app
```

기대 출력 두 줄:

```
부트스트랩 관리자 계정 생성: admin@사내도메인
ERDD server listening on :3000
```

- 첫 줄은 **관리자 계정을 실제로 만들었을 때만** 나온다. 그 이메일의 계정이 이미 있으면 서버는
  아무것도 하지 않는다 — **기존 비밀번호를 덮어쓰지 않는다.** 즉 `ADMIN_PASSWORD` 를 바꾸고
  재시작해도 비밀번호는 바뀌지 않는다(잊었다면 다른 관리자가 재설정 링크를 발급해야 한다).
- `ADMIN_EMAIL` 과 `ADMIN_PASSWORD` 중 하나라도 비어 있으면 부트스트랩은 통째로 건너뛴다.
- 같은 기동에서 전역 공용 리소스 예시("표준 사전(예시)")도 한 번 시드된다. 이미 전역 라이브러리가
  있으면 건너뛴다.

첫 관리자를 만든 뒤에는 `.env` 에서 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 를 지워도 된다.

### 3.5 접속 확인

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
ADMIN_EMAIL='admin@사내도메인' \
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
| `PORT` | 아니오 | `3000` | listen 포트. 바인드 주소는 항상 `0.0.0.0` 이다. | `apps/server/src/main.ts` |
| `NODE_ENV` | 아니오 | 없음 | `production` 일 때만 세션 쿠키에 `Secure` 가 붙는다. **서버 코드에서 이 변수가 바꾸는 동작은 이것 하나뿐이다.** Docker 이미지에는 `production` 이 박혀 있다. | `apps/server/src/routers/auth.ts` |
| `ADMIN_EMAIL` | 아니오 | 없음 | 최초 관리자 부트스트랩. `ADMIN_PASSWORD` 와 **둘 다** 있어야 동작한다. | `apps/server/src/services/accounts.ts` |
| `ADMIN_PASSWORD` | 아니오 | 없음 | 위와 같음. 해당 이메일의 계정이 없을 때만 쓰인다. | 〃 |

**서버는 `.env` 파일을 스스로 읽지 않는다.** dotenv 류를 쓰지 않으므로 값은 셸 환경·systemd
`EnvironmentFile`·compose 를 통해 들어와야 한다.

운영과 무관한 변수:

| 이름 | 어디에 쓰이나 |
|---|---|
| `ERDD_SERVER_PORT` | **개발 전용.** vite dev 서버의 프록시 대상 포트(`apps/web/vite.config.ts`). 운영 빌드에는 관여하지 않는다. |
| `ERDD_TOKEN` | `erdd` CLI 가 쓰는 액세스 토큰(`packages/cli`). 서버 동작에 영향 없다(→ [16-cli](../16-cli.md)). |
| `ERDD_PORT` | 이 저장소의 `docker-compose.yml` 이 앱 컨테이너를 호스트 어느 포트에 붙일지 정할 때만 쓴다. 앱은 이 이름을 모른다. |

## 6. 최초 기동 후 할 일

계정은 **셀프 가입이 없다.** 관리자가 일회용 초대 링크를 발급해 전달하는 폐쇄형이고,
**메일 발송 기능이 없다** — 링크는 화면에 뜨고 관리자가 직접 전달한다(→ [18-account](../18-account.md)).

1. **관리자로 로그인** — 3.4 에서 만든 `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
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
- 앱을 프록시 전용으로 가두려면 compose 의 포트 매핑을 `"127.0.0.1:3000:3000"` 으로 바꾼다.
- 서브패스(`/erdd/` 같은 경로) 배치는 검증된 구성이 아니다. 서브도메인이나 전용 호스트를 쓴다.

## 8. 운영

### 8.1 업그레이드

**순서가 중요하다: 코드 갱신 → 빌드 → 마이그레이션 → 재시작.** 새 스키마를 요구하는 코드를
먼저 띄우면 서버가 기동 중 DB 를 조회하다 실패해 재시작 루프에 빠진다.

```bash
cd /opt/erdd
docker compose stop app          # 앱만 멈춘다(DB 는 계속 떠 있어야 마이그레이션이 돈다)
git pull
docker compose build app
docker compose run --rm app pnpm --filter @erdd/server db:migrate
docker compose up -d app
docker compose logs app | tail -3
```

방법 B 도 순서는 같다: `systemctl stop erdd` → `git pull` → `pnpm install --frozen-lockfile` →
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

`docker-compose.yml` 의 `app` 에는 첫 번째와 같은 검사를 하는 healthcheck 가 이미 붙어 있다
(이미지에 curl·wget 이 없어 Node 의 `fetch` 로 호출한다). 상태는 `docker compose ps` 에 보인다.

### 8.4 로그

```bash
docker compose logs -f app     # 방법 A
journalctl -u erdd -f          # 방법 B
```

**서버는 HTTP 접근 로그를 남기지 않는다**(Fastify 로거를 꺼 두었다). 표준 출력에 나오는 것은
사실상 다음뿐이다.

- `ERDD server listening on :<포트>` — 기동 성공
- `부트스트랩 관리자 계정 생성: <이메일>` — 관리자를 실제로 만들었을 때
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

5432 가 겹치면 `docker-compose.yml` 의 `db.ports` 를 지우는 것이 낫다 — 앱은 compose 네트워크로
붙으므로 호스트에 공개할 이유가 없다.

### 9.3 마이그레이션을 적용하지 않았다

**증상:** 서버가 기동 도중 종료된다. 로그에 `relation "resource_libraries" does not exist`
(또는 `"users" does not exist`) 류의 Postgres 오류와 스택 트레이스가 찍히고 프로세스가 끝난다.
`ERDD server listening on` 은 **찍히지 않는다.** compose 라면 재시작 루프가 된다.

기동 시퀀스가 `관리자 부트스트랩 → 전역 리소스 시드 → listen` 순서라, 스키마가 없으면 listen
전에 걸린다.

**해결:** 3.3 을 실행한다.

```bash
docker compose run --rm app pnpm --filter @erdd/server db:migrate
docker compose up -d app
```

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

`Secure` 는 `NODE_ENV=production` 일 때만 붙는다. **Docker 이미지에는 `production` 이 박혀
있다.** 쿠키의 나머지 속성은 `httpOnly`, `SameSite=Lax`, `Path=/` 이고 이름은 `erdd_session` 이다.

**해결:** 7절대로 HTTPS 를 붙인다. TLS 없이 잠깐 시험만 할 목적이라면 compose 의 `app` 서비스
`environment` 에 `NODE_ENV: development` 를 추가해 내린다 — **운영에서는 쓰지 않는다.**

### 9.7 브라우저로 열면 404 만 나온다

**원인:** `apps/web/dist` 가 없다. 서버는 그 디렉터리가 있을 때만 정적 파일과 SPA fallback 을
등록하고, 없으면 `/trpc` 만 응답한다.

- 방법 A: 이미지 빌드가 웹 빌드를 포함한다. 빌드가 실패했는지 `docker compose build app` 출력을
  다시 본다.
- 방법 B: `pnpm --filter @erdd/web build` 를 빠뜨렸다(4.1).

---

## 부록: 검증 상태 (2026-08-10)

이미지 빌드, 이미지 안의 Node 22 · pnpm 10.4.1 · `apps/web/dist` · `apps/server/drizzle/`,
`db:migrate` 실행 경로, `health.ping` 응답, `DATABASE_URL` 없을 때의 412, 정적 서빙과 SPA
fallback, compose 문법과 healthcheck 명령은 **실제 명령으로 확인**했다.

**설치 절차를 처음부터 끝까지 돌려 본 것은 아니다.** 실제 PostgreSQL 을 붙인 마이그레이션 적용,
관리자 부트스트랩, 로그인, 백업·복구, nginx, systemd 는 코드와 설정을 읽고 쓴 것이며 실환경
검증이 남아 있다.
