# 개발 환경 — DB·서버·테스트·스모크

이 문서는 **개발자·에이전트가 이 저장소를 돌릴 때** 필요한 것을 갖는다.
제품을 자체 서버에 올리는 절차는 [../manual/install.md](../manual/install.md) 다.

---

## DB

```bash
docker ps --filter name=erdd-db      # erdd-db-1, postgres:17, :5432
```

- **dev DB 는 `erdd`, test DB 는 `erdd_test`** 다. 둘 다 마이그레이션이 적용돼 있어야 한다.
- 관리자 계정은 `admin@erdd.local` / `Passw0rd!erdd`.
  `ADMIN_EMAIL`·`ADMIN_PASSWORD` 를 export 하고 서버를 띄우면 계정이 없을 때
  `ensureBootstrapAdmin` 이 자동으로 만든다.

## 서버·웹 띄우기

```bash
pnpm dev            # web :5173(127.0.0.1), server :3000
```

⚠️ **서버 프로세스 자체는 `.env` 를 읽지 않는다**(dotenv 를 쓰지 않는다). 루트 `dev` 스크립트가
`.env` 를 셸에 로드해 넘긴다. **`.env` 가 없으면 아무 말 없이 그대로 뜨는데**, 그때는
`DATABASE_URL` 이 없어 `ctx.db = null` → 모든 tRPC 가 412 → 화면에 「연결에 문제가 있습니다」가 뜬다.

### 워크트리에서는 포트·DB 를 트랙별로 가른다

| 트랙 | server | web | dev DB | test DB |
|---|---|---|---|---|
| 최상위 | 3000 | 5173 | `erdd` | `erdd_test` |
| 워크트리 A | 3001 | 5174 | `erdd_dev_a` | `erdd_test_a` |
| 워크트리 B | 3002 | 5175 | `erdd_dev_b` | `erdd_test_b` |

서버 포트는 `PORT`, vite 프록시 타깃은 `ERDD_SERVER_PORT`(**같은 값을 준다**), vite 포트는
`ERDD_WEB_PORT` 다. 셋을 함께 주면 루트 `pnpm dev` 하나로 그 트랙이 통째로 뜬다.

```bash
PORT=3001 ERDD_SERVER_PORT=3001 ERDD_WEB_PORT=5174 pnpm dev
```

- ⚠️ **`ERDD_SERVER_PORT` 를 안 주면 워크트리의 web 이 조용히 최상위 서버 3000 에 붙는다.**
  vite 프록시 타깃이 그 변수로 파라미터화돼 있다.
- ⚠️ **`.env` 에 포트를 적지 마라.** 스크립트는 `.env` 를 셸에 로드할 뿐 우선순위를 따지지 않으므로
  **`.env` 의 키가 인라인으로 준 값을 이긴다.** 위 셋은 기본 `.env` 에 없어서 인라인이 그대로 먹는다.
- `DATABASE_URL` 은 그 워크트리의 `.env` 로 준다. 격리 DB 는 미리 만들고 마이그레이션을 적용해 둔다.
- 워크트리 생성·정리 절차는 [worktree-workflow.md](worktree-workflow.md).

## 마이그레이션

```bash
pnpm db:generate    # 스키마 → 새 마이그레이션 파일 (.env 없어도 돈다)
pnpm db:migrate     # .env 의 DATABASE_URL(= dev DB)에 적용
pnpm db studio      # 임의 drizzle-kit 서브커맨드도 같은 .env 로딩으로 통과한다
```

🔥 **`.env` 가 아닌 DB(test DB·격리 DB)를 가리킬 때 `pnpm db:*` 를 쓰지 마라.** 그 스크립트는
`dev` 와 같은 관용구로 `.env` 를 셸에 로드하고 **그 값이 인라인으로 준 값을 이긴다** —
`DATABASE_URL=…erdd_test pnpm db:migrate` 는 조용히 `.env` 의 **dev** DB 에 적용된다
(존재하지 않는 DB 명을 인라인으로 줘도 성공한다). **인라인 + 원시 호출**을 쓴다.

```bash
docker exec -i erdd-db-1 createdb -U postgres erdd_test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm -C apps/server exec drizzle-kit migrate
```

---

## 테스트

가장 확실한 것은 루트 `pnpm verify` 하나다 — typecheck + 네 스위트(`packages/core`·`packages/cli`·
`apps/web`·`apps/server`)를 `&&` 로 묶어 어느 하나라도 실패하면 비정상 종료한다.

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm verify

pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web  exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck; echo "EXIT=$?"
```

### 🔥 `. ./.env` 로 verify 를 돌리지 마라 — 개발 DB 가 통째로 날아간다

`set -a && . ./.env && set +a && pnpm verify` 는 **개발 데이터를 파괴하는 명령이다.**
루트 `.env` 의 `DATABASE_URL` 은 개발 DB(`erdd`)를 가리키고, 서버 테스트는 그 값을 **그대로** 쓰며
(`apps/server/src/testing/helpers.ts` 가 `buildServer({ databaseUrl: process.env.DATABASE_URL })`),
각 테스트가 **전 테이블을 `TRUNCATE … CASCADE`** 한다(`apps/server/src/testing/db.ts` 의 `resetDb`).
**테스트는 전건 통과하므로 아무 경고도 뜨지 않는다.**

워크트리의 `.env` 를 로드해 verify 를 돌리는 것도 같은 사고다 — 그 `.env` 의 `DATABASE_URL` 은
그 트랙의 **개발** DB 다.

⚠️ **`erdd_test` DB 가 없으면 만들어 두고 마이그레이션을 적용해라.** 없는 상태로 위 명령을 돌리면
연결이 실패하고, 그때 `.env` 로 되돌리고 싶어지는 것이 바로 이 사고의 경로다.

### `apps/server` 스위트는 `DATABASE_URL` 이 없으면 조용히 건너뛴다

없으면 대부분의 케이스가 skip 되고 **초록색으로 끝난다.** 실패로 보이지 않으니
**출력의 `skipped` 수를 확인해라** — skip 이 0 이어야 실제로 돈 것이다.

### CI 의 서버 테스트

`.github/workflows/ci.yml` 의 `server` 잡이 `apps/server` 스위트를 돈다. 잡마다 새로 뜨는
`postgres:17` 서비스에 test DB `erdd_test` 를 만들고, 잡 환경의 `DATABASE_URL` 로 **원시 호출**
`pnpm -C apps/server exec drizzle-kit migrate` 를 적용한 뒤 테스트를 돌린다(`pnpm db:migrate` 를 쓰지
않는 이유는 위 「마이그레이션」의 🔥 항목이다).

- **통과만으로 판정하지 않는다.** vitest 의 JSON 리포트에서 skip·todo 수를 읽어 **0 이 아니면 잡을
  떨어뜨린다** — 위 「`DATABASE_URL` 이 없으면 조용히 건너뛴다」 때문이다. DB 배선이 끊기면 전건
  skip 인 초록 대신 빨강이 된다.
- ⚠️ **서버 스위트에 의도된 skip 을 새로 넣으면 이 판정에 걸린다.** 넣어야 한다면 판정 조건을 함께
  고쳐라 — skip 을 허용하는 쪽으로 무르면 DB 배선이 끊긴 상태를 다시 구분하지 못한다.
- 이 잡은 `release.yml` 이 `ci.yml` 을 부를 때도 돈다 — 게시 전 검증에 들어간다
  ([release.md](release.md) 「CI — 검증과 게시」).

### ⚠️ `pnpm -s -r typecheck` 의 출력만 보고 판정하지 마라

`-s` 가 자식 출력을 삼켜서 **타입 오류가 있어도 출력이 0바이트이고 종료코드만 1** 이다.
이 함정 때문에 구현자·리뷰어가 전원 「typecheck clean」으로 오판하고 암묵적 `any` 가 그대로
머지된 적이 있다. **종료코드로 판정하거나 패키지별로 돌린다.**

```bash
pnpm -r typecheck; echo "EXIT=$?"      # EXIT=0 이어야 통과
pnpm -s -C apps/server typecheck        # 또는 패키지별 — 오류가 그대로 보인다
```

⚠️ **파이프(`| tail`)를 붙이면 `$?` 가 tail 의 종료코드가 되어 또 오판한다.**
리뷰어에게 typecheck 를 시킬 때도 이 주의를 프롬프트에 넣어라.

---

## 브라우저 스모크

브라우저는 항상 **`127.0.0.1` 로 접속**한다(`localhost` 는 IPv6 로 풀릴 수 있다).
**SPA 라우트는 `/p/<projectId>`(프로젝트 에디터)와 `/org/<orgId>`** 다 — `/projects/<id>` 로 가면
「페이지를 찾을 수 없습니다」가 뜬다. 배선 확인은 `/trpc/auth.me?batch=1&input=%7B%7D` 로 프로브한다
(**401 = DB 정상 + 로그아웃 상태, 412 = DB 미배선**). 서버 `/` 와 맨 `/trpc` 는 설계상 404 다.

### 매번 물리는 것들

- **좀비 dev 프로세스가 구 코드를 조용히 서빙한다.** `tsx watch` 부모는 세션을 넘어 살아남고,
  반대로 `pkill -f "tsx src/main.ts"` / `pkill -f vite` 는 **부모만** 죽여 `node` 자식이 포트를 쥔 채
  남는다. 어느 쪽이든 새로 띄운 서버가 `EADDRINUSE` 로 죽고 몇 시간 전 코드와 계속 대화하게 된다 —
  증상은 API 의 「No procedure found on path …」와 최신 변경이 빠진 UI 다.
  **띄우기 전에 항상 확인하고 나온 PID 를 `kill -9` 한다.**
  ```bash
  lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN
  ```
  새 서버가 최신인지는 **이번에 추가한 프로시저**가 404 가 아니라 401 을 주는 것으로 확증한다.
  vite 는 `rm -rf apps/web/node_modules/.vite` 후 캐시버스팅 쿼리를 붙여 로드한다.
  스모크 중에는 watch 없이 `./node_modules/.bin/tsx src/main.ts` 로 띄우는 편이 안정적이다.
- **vite 의 바인딩 주소는 설정으로 고정돼 있다.** `apps/web/vite.config.ts` 의 `server.host` 가
  `127.0.0.1` 이다. 바꿔야 하면 CLI 인자 말고 **환경 변수**(`ERDD_WEB_HOST`·`ERDD_WEB_PORT`)를 쓴다 —
  **`pnpm … dev -- --host 127.0.0.1` 은 인자가 전달되지 않는다.** `strictPort` 라 포트가 물려 있으면
  옆 포트로 도망가지 않고 죽는다.
- **테스트가 DB 를 TRUNCATE 한다.** 테스트를 돌린 뒤 스모크하려면 계정·조직·프로젝트를 다시
  시드해야 한다. 부트스트랩 관리자는 위의 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 로 자동 생성되고,
  나머지는 node 스크립트에서 `fetch` 로 tRPC 를 때리는 게 빠르다:
  `auth.login` → `org.create` → `admin.users.invite` → `org.members.add`(`memberId` 를 반환한다) →
  `project.create`(`dialects` 필요) → Viewer 용 `project.members.add`.
  **호출 사이에 `getSetCookie()` 의 `erdd_session` 쿠키를 이어서 넘겨야 한다.**
- **React 제어 인풋에 브라우저 도구로 타이핑하지 마라.** 느리고 한글에서 불안정하다.
  네이티브 setter 를 쓴다 —
  `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta, text)` 후
  `ta.dispatchEvent(new Event('input',{bubbles:true}))`. 미리보기가 갱신되면 React 가 받은 것이다.
  다이얼로그를 먼저 열어 엘리먼트 존재를 확인한다 — 페이지 이동 후 stale 해진 엘리먼트 참조는
  클릭이 조용히 no-op 이 된다.
- **React 가 그린 노드를 DOM 에서 직접 떼지 마라** — 클릭을 가리는 토스트(`[data-sonner-toast]`)도
  마찬가지다. 뗀 뒤 다음 토스트가 뜨는 순간 React 가 `NotFoundError: Failed to execute 'insertBefore'
  on 'Node'` 로 트리를 통째로 내려 화면이 빈다 — 어느 기능의 결함처럼 보이지만 계측이 만든 것이다.
  가려진 버튼은 `click({ force: true })` 로 누르거나 토스트가 사라지기를 기다린다.
- **`psql` 이 PATH 에 없다.** DB 를 직접 봐야 하면 `apps/server` 에서 `node` 스크립트로 `pg` 를
  import 한다(pnpm 엄격 모드라 리포 루트에서는 `pg`·`ws` 가 해석되지 않는다).

### 다중 사용자 스모크(실시간 등)

브라우저 2개보다 **브라우저 1개(A) + 헤드리스 WS 클라이언트(B)** 조합이 낫다. 무엇보다
**경합 조건은 손으로 재현이 안 된다** — 실시간 회귀 검증은 `SELECT … FOR UPDATE` 로 프로젝트 행
락을 십수 초 잡아 「B 먼저 커밋 / A 는 대기 중」 순서를 강제해 결정적으로 재현했다.
헤드리스 B 는 `ws` 를 pnpm 스토어 경로(`node_modules/.pnpm/ws@*/node_modules/ws`)에서 직접
import 하면 된다.

### ⚠️ 브라우저 확장으로 렌더 결함을 계측하려 들지 마라

확장의 MCP 탭은 **활성 탭이 아니라서** `document.visibilityState === 'hidden'` 이고
`document.hasFocus() === false` 다. 그러면 `requestAnimationFrame` 이 아예 돌지 않고
(rAF 대기가 45초 CDP 타임아웃으로 끝난다 — 렌더러가 멈춘 것으로 오인하기 쉽다)
**ResizeObserver 도 돌지 않는다.** 그 결과 캔버스 노드 대부분이 `visibility: hidden` 인 채로
남는데, 이것은 **고치려는 렌더 버그의 증상과 구분되지 않는다.** 탭을 앞으로 가져오려는 우회는
전부 막힌다. **워커 + Playwright MCP 가 답이다** — Playwright 브라우저는 headless 여도 `visible`
이라 rAF·ResizeObserver 가 정상이다([worktree-workflow.md](worktree-workflow.md) 「스모크는
누가 하나」 절).

---

## 알려진 한계

- **`pnpm verify` 는 `.env` 의 DB 를 비운다.** 위 🔥 항목의 사고 경로가 구조적으로 열려 있다 —
  서버 테스트가 `DATABASE_URL` 을 그대로 쓰고 전 테이블을 TRUNCATE 하기 때문이다. 막으려면
  테스트 하니스가 DB 이름을 검사해 dev DB 를 거절해야 하는데, 격리 DB 이름이 트랙마다 자유롭게
  붙는 지금 구조에서는 화이트리스트를 세울 자리가 없다.
- **저장소에 eslint 설정이 아예 없다.** `react-hooks/exhaustive-deps` 가 안 돌고,
  `apps/web/src/editor/canvas.tsx` 의 `eslint-disable` 주석도 실효가 없다.
- **`apps/server` 에 `@types/ws` 가 없다.** `ws.ts` 의 핸들러 인자를 손으로 주석했다 —
  devDependency 로 넣으면 `RawData` 로 추론된다(현재 깨진 것은 없다).
