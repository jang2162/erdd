# Phase 1 / M0 — 모노레포 기반 구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ERDD 모노레포의 "걸어다니는 뼈대" — core의 첫 실제 함수(논리 타입 파서 최소본)가 server의 tRPC 라우트를 거쳐 web 화면까지 흐르고, PostgreSQL 마이그레이션과 Docker 배포 이미지까지 동작하는 상태.

**Architecture:** pnpm workspace 모노레포. 도메인 로직은 `packages/core`(순수 TS, IO 없음), 서버는 Fastify+tRPC+Drizzle, 웹은 React+Vite. 서버가 web 빌드 정적 파일을 서빙하는 단일 Docker 이미지로 배포한다. 상세는 `docs/02-architecture.md`.

**Tech Stack:** Node 22, pnpm 10(corepack), TypeScript(strict, ESM), Fastify ^5, @trpc/server ^11, zod, Drizzle ORM + pg, React ^19, Vite, vitest.

## Phase 1 마일스톤 로드맵 (참고)

M0(본 계획) → M1 core 모델·op 엔진 → M2 계정·조직(18-account) → M3 mutation 파이프라인·Revision → M4 에디터 기본(10-editor) → M5 그룹핑(12-grouping) → M6 논리 타입 완성·DDL 내보내기(14-domain, 17-import-export) → M7 스냅샷(11-collaboration) → M8 이미지 내보내기·이력 화면. 각 마일스톤 계획은 착수 시점에 작성한다.

## Global Constraints

- Node >= 22 (`.nvmrc`), pnpm via corepack (`packageManager` 필드 기준).
- 모든 패키지 `"type": "module"`(ESM), TypeScript `strict: true`.
- 서버는 dev/prod 모두 `tsx`로 실행한다(별도 번들 빌드 없음 — 1인 운영 단순화).
- 코드 식별자·파일명은 영어, 문서·커밋 메시지는 한국어.
- 비밀값은 `.env`(커밋 금지). `.env.example`만 커밋한다.
- dev 포트: server 3000, web(Vite) 5173. Vite가 `/trpc`를 3000으로 프록시.
- 패키지 설치는 버전 미지정(`pnpm add <pkg>`)으로 최신을 받되, 아래 명시된 메이저와 다르면 중단하고 보고: fastify 5.x, @trpc/* 11.x, react 19.x.
- 커밋은 태스크 단위로. 테스트가 통과한 상태에서만 커밋한다.

---

### Task 1: pnpm workspace 루트

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.env.example`

**Interfaces:**
- Produces: 워크스페이스 루트. 이후 모든 태스크가 `pnpm --filter <pkg>`로 패키지를 조작하고, 각 패키지 tsconfig가 `tsconfig.base.json`을 extends 한다.

- [ ] **Step 1: 루트 파일 작성**

`package.json`:
```json
{
  "name": "erdd",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.4.1",
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.local
```

`.nvmrc`:
```
22
```

`.env.example`:
```
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd
```

- [ ] **Step 2: 설치 확인**

Run: `corepack enable && pnpm install`
Expected: 에러 없이 완료(설치할 패키지가 아직 없어도 정상). `pnpm -v` → 10.x

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .nvmrc .env.example
git commit -m "chore: pnpm 모노레포 루트 구성"
```

---

### Task 2: packages/core — 논리 타입 파서 최소본

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`, `packages/core/src/logical-type.ts`
- Test: `packages/core/src/logical-type.test.ts`

**Interfaces:**
- Produces: `@erdd/core`가 export 하는 `parseLogicalType(input: string): ParseResult`, 타입 `LogicalType`, `ParseResult`. Task 3의 서버 라우트가 이를 호출한다. M0에서는 `INT`/`VARCHAR(n)`/`DECIMAL(p,s)` 3종+별칭만 지원하고, 17종 전체는 M6에서 완성한다(docs/14-domain.md의 문법을 따름).

- [ ] **Step 1: 패키지 스캐폴드**

`packages/core/package.json`:
```json
{
  "name": "@erdd/core",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

Run: `pnpm --filter @erdd/core add -D typescript vitest`
Expected: devDependencies 추가 완료.

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/core/src/logical-type.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseLogicalType } from './logical-type.js'

describe('parseLogicalType', () => {
  it('parses INT and canonicalizes case', () => {
    expect(parseLogicalType('int')).toEqual({ ok: true, type: { kind: 'INT' }, canonical: 'INT' })
  })

  it('accepts INTEGER as alias of INT', () => {
    expect(parseLogicalType('INTEGER')).toMatchObject({ ok: true, canonical: 'INT' })
  })

  it('parses VARCHAR(n) and VARCHAR2 alias', () => {
    expect(parseLogicalType('varchar2(100)')).toEqual({
      ok: true,
      type: { kind: 'VARCHAR', length: 100 },
      canonical: 'VARCHAR(100)',
    })
  })

  it('rejects VARCHAR without length (length is required)', () => {
    expect(parseLogicalType('VARCHAR')).toEqual({ ok: false, raw: 'VARCHAR' })
  })

  it('parses DECIMAL(p,s) with scale defaulting to 0, NUMBER/NUMERIC aliases', () => {
    expect(parseLogicalType('NUMBER(15)')).toEqual({
      ok: true,
      type: { kind: 'DECIMAL', precision: 15, scale: 0 },
      canonical: 'DECIMAL(15,0)',
    })
  })

  it('returns ok:false with raw text for unknown types', () => {
    expect(parseLogicalType('geometry(Point,4326)')).toEqual({
      ok: false,
      raw: 'geometry(Point,4326)',
    })
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @erdd/core test`
Expected: FAIL — `logical-type.js` 모듈 없음.

- [ ] **Step 4: 최소 구현**

`packages/core/src/logical-type.ts`:
```ts
export type LogicalType =
  | { kind: 'INT' }
  | { kind: 'VARCHAR'; length: number }
  | { kind: 'DECIMAL'; precision: number; scale: number }

export type ParseResult =
  | { ok: true; type: LogicalType; canonical: string }
  | { ok: false; raw: string }

const ALIASES: Record<string, string> = {
  INTEGER: 'INT',
  VARCHAR2: 'VARCHAR',
  NUMERIC: 'DECIMAL',
  NUMBER: 'DECIMAL',
}

export function parseLogicalType(input: string): ParseResult {
  const raw = input.trim()
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(raw)
  if (!m) return { ok: false, raw }
  const name = m[1]!.toUpperCase().replace(/\s+/g, ' ')
  const kind = ALIASES[name] ?? name
  const p1 = m[2] === undefined ? undefined : Number(m[2])
  const p2 = m[3] === undefined ? undefined : Number(m[3])

  switch (kind) {
    case 'INT':
      if (p1 !== undefined) return { ok: false, raw }
      return { ok: true, type: { kind: 'INT' }, canonical: 'INT' }
    case 'VARCHAR':
      if (p1 === undefined) return { ok: false, raw }
      return { ok: true, type: { kind: 'VARCHAR', length: p1 }, canonical: `VARCHAR(${p1})` }
    case 'DECIMAL': {
      if (p1 === undefined) return { ok: false, raw }
      const scale = p2 ?? 0
      return {
        ok: true,
        type: { kind: 'DECIMAL', precision: p1, scale },
        canonical: `DECIMAL(${p1},${scale})`,
      }
    }
    default:
      return { ok: false, raw }
  }
}
```

`packages/core/src/index.ts`:
```ts
export { parseLogicalType } from './logical-type.js'
export type { LogicalType, ParseResult } from './logical-type.js'
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @erdd/core test`
Expected: PASS (6 tests). `pnpm --filter @erdd/core typecheck`도 통과.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): 논리 타입 파서 최소본 (INT/VARCHAR/DECIMAL + 별칭)"
```

---

### Task 3: apps/server — Fastify + tRPC

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`
- Create: `apps/server/src/router.ts`, `apps/server/src/server.ts`, `apps/server/src/main.ts`
- Test: `apps/server/src/server.test.ts`

**Interfaces:**
- Consumes: `@erdd/core`의 `parseLogicalType`.
- Produces: `AppRouter` 타입(export from `apps/server/src/router.ts`) — 라우트 `health.ping`(query, 입력 없음 → `{ ok: true, version: string }`)과 `logicalType.parse`(query, 입력 `string` → `ParseResult`). `buildServer(): FastifyInstance`는 테스트와 Task 6에서 재사용.

- [ ] **Step 1: 패키지 스캐폴드**

`apps/server/package.json`:
```json
{
  "name": "@erdd/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

Run:
```bash
pnpm --filter @erdd/server add fastify @trpc/server zod "@erdd/core@workspace:*"
pnpm --filter @erdd/server add -D typescript tsx vitest @types/node
```
Expected: 설치 완료. fastify 5.x, @trpc/server 11.x인지 확인.

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/server/src/server.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from './server.js'

describe('server', () => {
  it('health.ping returns ok', async () => {
    const app = buildServer()
    const res = await app.inject({ method: 'GET', url: '/trpc/health.ping' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ ok: true })
    await app.close()
  })

  it('logicalType.parse canonicalizes input via core', async () => {
    const app = buildServer()
    const input = encodeURIComponent(JSON.stringify('varchar2(100)'))
    const res = await app.inject({ method: 'GET', url: `/trpc/logicalType.parse?input=${input}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ ok: true, canonical: 'VARCHAR(100)' })
    await app.close()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @erdd/server test`
Expected: FAIL — `server.js` 모듈 없음.

- [ ] **Step 4: 구현**

`apps/server/src/router.ts`:
```ts
import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { parseLogicalType } from '@erdd/core'

const t = initTRPC.create()

export const appRouter = t.router({
  health: t.router({
    ping: t.procedure.query(() => ({ ok: true as const, version: '0.1.0' })),
  }),
  logicalType: t.router({
    parse: t.procedure.input(z.string()).query(({ input }) => parseLogicalType(input)),
  }),
})

export type AppRouter = typeof appRouter
```

`apps/server/src/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './router.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter },
  })
  return app
}
```

`apps/server/src/main.ts`:
```ts
import { buildServer } from './server.js'

const app = buildServer()
const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`ERDD server listening on :${port}`)
})
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @erdd/server test`
Expected: PASS (2 tests). `pnpm --filter @erdd/server typecheck` 통과.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): Fastify+tRPC 서버 골격 — health, logicalType.parse"
```

---

### Task 4: PostgreSQL + Drizzle 마이그레이션

**Files:**
- Create: `docker-compose.yml`(루트), `apps/server/drizzle.config.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts`
- Test: `apps/server/src/db/client.test.ts`
- Modify: `apps/server/package.json`(scripts에 `db:generate`, `db:migrate` 추가)

**Interfaces:**
- Produces: `createDb(url: string): { db: NodePgDatabase<typeof schema>, pool: pg.Pool }`, Drizzle 스키마 모듈(`schema.ts` — M0에서는 `users` 테이블 1개, M2에서 확장). 마이그레이션 파일은 `apps/server/drizzle/`에 생성·커밋된다.
- id는 앱에서 UUIDv7로 생성해 넣는다(DB default 없음 — docs/02-architecture.md의 identity 규칙). M0에서는 테이블 정의만 하고 insert는 M2에서.

- [ ] **Step 1: docker-compose와 의존성**

`docker-compose.yml`(루트):
```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: erdd
      POSTGRES_DB: erdd
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Run:
```bash
pnpm --filter @erdd/server add drizzle-orm pg
pnpm --filter @erdd/server add -D drizzle-kit @types/pg
```

`apps/server/package.json` scripts에 추가:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 2: 실패하는 테스트 작성 (DATABASE_URL 있을 때만 실행)**

`apps/server/src/db/client.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createDb } from './client.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('db client', () => {
  it('connects and runs a query', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query('select 1 as one')
    expect(res.rows[0].one).toBe(1)
    await pool.end()
  })
})
```

Run: `pnpm --filter @erdd/server test`
Expected: FAIL — `client.js` 모듈 없음(DATABASE_URL 미설정 시에도 import 단계에서 실패).

- [ ] **Step 3: 구현**

`apps/server/src/db/schema.ts`:
```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`apps/server/src/db/client.ts`:
```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export function createDb(url: string): { db: NodePgDatabase<typeof schema>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url })
  return { db: drizzle(pool, { schema }), pool }
}
```

`apps/server/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 4: 마이그레이션 생성·적용·테스트**

Run:
```bash
docker compose up -d db
cp .env.example .env   # 아직 없다면
pnpm --filter @erdd/server db:generate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server db:migrate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
```
Expected: `apps/server/drizzle/`에 SQL 파일 생성, 마이그레이션 성공, 테스트 PASS(3 tests — db 테스트 포함).
확인: `docker compose exec db psql -U postgres -d erdd -c '\d users'` → users 테이블 표시.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/server
git commit -m "feat(server): PostgreSQL docker-compose와 Drizzle 마이그레이션 기반 (users 테이블)"
```

---

### Task 5: apps/web — React + Vite + tRPC 클라이언트

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/trpc.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `AppRouter` 타입(`@erdd/server`에서 type-only import), dev에서 Vite 프록시로 `/trpc` 호출.
- Produces: `apps/web/dist`(빌드 산출물) — Task 6의 정적 서빙 대상.

- [ ] **Step 1: 패키지 스캐폴드**

`apps/web/package.json`:
```json
{
  "name": "@erdd/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/trpc': 'http://localhost:3000' } },
})
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()], test: { environment: 'jsdom' } })
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ERDD</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run:
```bash
pnpm --filter @erdd/web add react react-dom @trpc/client
pnpm --filter @erdd/web add -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @types/react @types/react-dom "@erdd/server@workspace:*"
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/web/src/App.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.js'

describe('App', () => {
  it('renders the ERDD heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ERDD' })).toBeDefined()
  })
})
```

Run: `pnpm --filter @erdd/web test`
Expected: FAIL — `App.js` 모듈 없음.

- [ ] **Step 3: 구현**

`apps/web/src/trpc.ts`:
```ts
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@erdd/server/src/router.js'

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/trpc' })],
})
```

`apps/web/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { trpc } from './trpc.js'

export function App() {
  const [status, setStatus] = useState('연결 확인 중…')

  useEffect(() => {
    trpc.health.ping
      .query()
      .then((r) => setStatus(`서버 연결됨 (v${r.version})`))
      .catch(() => setStatus('서버에 연결할 수 없음'))
  }, [])

  return (
    <main>
      <h1>ERDD</h1>
      <p>{status}</p>
    </main>
  )
}
```

`apps/web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: 테스트·수동 확인**

Run: `pnpm --filter @erdd/web test`
Expected: PASS (1 test).

Run(수동 확인): 터미널 2개로 `pnpm --filter @erdd/server dev`와 `pnpm --filter @erdd/web dev` 실행 후 브라우저에서 `http://localhost:5173`
Expected: "ERDD" 제목과 "서버 연결됨 (v0.1.0)" 표시.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): React+Vite 셸과 tRPC 클라이언트 — 서버 헬스 표시"
```

---

### Task 6: 정적 서빙 + Docker 이미지

**Files:**
- Modify: `apps/server/src/server.ts`(web dist 정적 서빙 추가)
- Create: `Dockerfile`, `.dockerignore`(루트)

**Interfaces:**
- Consumes: `apps/web/dist`(Task 5의 빌드 산출물), `buildServer()`(Task 3).
- Produces: 단일 Docker 이미지 — `/`는 web SPA, `/trpc/*`는 API. SPA 폴백은 `/trpc` 이외 경로에서 `index.html`.

- [ ] **Step 1: 정적 서빙 구현**

Run: `pnpm --filter @erdd/server add @fastify/static`

`apps/server/src/server.ts` 전체를 다음으로 교체:
```ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './router.js'

const webDist = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter },
  })
  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/trpc')) return reply.code(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  }
  return app
}
```

Run: `pnpm --filter @erdd/server test`
Expected: PASS — 기존 테스트가 그대로 통과(dist 없는 환경에서도 동작해야 한다는 회귀 확인).

- [ ] **Step 2: Dockerfile 작성**

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.git
.env
```

`Dockerfile`:
```dockerfile
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @erdd/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@erdd/server", "start"]
```

- [ ] **Step 3: 빌드·구동 검증**

Run:
```bash
docker build -t erdd .
docker run --rm -p 3000:3000 erdd &
sleep 3
curl -s http://localhost:3000/trpc/health.ping
curl -s http://localhost:3000/ | head -3
```
Expected: 첫 curl → `{"result":{"data":{"ok":true,"version":"0.1.0"}}}`, 둘째 curl → `<!doctype html>`로 시작하는 HTML. 확인 후 컨테이너 중지.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore apps/server
git commit -m "feat: 단일 Docker 이미지 — server가 web 정적 서빙"
```

---

## 완료 기준 (M0 Definition of Done)

- `pnpm test` 루트 실행 시 core/server/web 테스트 전부 통과.
- `pnpm typecheck` 통과.
- dev 모드: web(5173)에서 서버 헬스가 표시된다.
- `docker compose up -d db` + 마이그레이션으로 users 테이블이 생성된다.
- `docker build` 이미지가 단독으로 web+API를 서빙한다.
