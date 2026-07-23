# Phase 1 / M2a — 계정·조직·프로젝트 서버 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개정된 [18-account](../../18-account.md) 스펙의 서버 측 전부 — DB 스키마(사용자/조직/멤버/프로젝트/세션), scrypt 비밀번호, 쿠키 세션 인증, 관리자 계정 관리 API, 조직·프로젝트·멤버 API와 권한 검사. 웹 UI는 M2b(별도 계획).

**Architecture:** tRPC 라우터를 `dbProcedure → authedProcedure → adminProcedure` 미들웨어 체인으로 계층화. 세션은 PG 테이블 + httpOnly 쿠키. 계정 생성(관리자·부트스트랩 공용)은 서비스 함수로 분리해 트랜잭션(사용자+개인 조직+owner 멤버)을 한곳에서 관리. id는 앱 생성 UUIDv7(docs/02-architecture.md).

**Tech Stack:** 기존 스택 + `@fastify/cookie`, `uuidv7`. 비밀번호는 node:crypto scrypt(외부 의존성 없음).

## Global Constraints

- 수정 범위: `apps/server`, `packages/core`(Dialect 상수 소폭), `.env.example`, `pnpm-lock.yaml`.
- 통합 테스트는 `DATABASE_URL` 필수(`describe.skipIf(!url)` 가드). 로컬 PG는 `docker compose up -d db`. **구현자는 반드시 `DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd`를 설정한 실행으로 GREEN을 확인**하고, 미설정 실행(스킵 동작)도 한 번 확인한다.
- 테스트 파일들이 같은 DB를 공유하므로 `apps/server/vitest.config.ts`에 `fileParallelism: false`가 필요하다(Task 1에서 설정).
- 각 통합 테스트는 `beforeEach`에서 `resetDb`(전체 TRUNCATE)로 시작한다.
- tRPC 검증은 zod. 비밀번호 최소 8자. 오류 메시지는 한국어.
- ESM, TypeScript strict. 커밋 메시지는 한국어. `git add .`/`-A` 금지(작업 트리에 무관한 .idea 변경·.env 존재) — 명시 경로만.
- 기존 테스트(health/logicalType, core 38개)는 계속 통과해야 한다. `buildServer()`는 인자 없이도(=DB 없이) 동작해 public 라우트만 제공한다.

---

### Task 1: DB 스키마 확장과 마이그레이션

**Files:**
- Modify: `apps/server/src/db/schema.ts`(전면 교체), `apps/server/vitest.config.ts`
- Create: `packages/core/src/dialect.ts`, `apps/server/src/testing/db.ts`
- Modify: `packages/core/src/index.ts`(Dialect export)
- Test: `apps/server/src/db/schema.test.ts`
- 생성됨: `apps/server/drizzle/0001_*.sql`(커밋 대상)

**Interfaces:**
- Produces: 테이블 `users`(role/isActive 추가, email_verified_at 제거), `organizations`, `members`, `projects`, `project_members`, `sessions`; `@erdd/core`의 `DIALECTS`/`Dialect`; 테스트 헬퍼 `resetDb(pool)`. Task 2~6이 이 스키마 위에 선다.

- [ ] **Step 1: core에 Dialect 상수 추가**

`packages/core/src/dialect.ts`:
```ts
export const DIALECTS = ['postgresql', 'mysql', 'oracle', 'mssql'] as const
export type Dialect = (typeof DIALECTS)[number]
```

`packages/core/src/index.ts`에 추가:
```ts
export { DIALECTS } from './dialect.js'
export type { Dialect } from './dialect.js'
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/server/src/testing/db.ts`:
```ts
import pg from 'pg'

export const TEST_TABLES = [
  'project_members', 'projects', 'members', 'organizations', 'sessions', 'users',
] as const

/** 통합 테스트용 초기화 — 전 테이블 TRUNCATE. */
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${TEST_TABLES.join(', ')} CASCADE`)
}
```

`apps/server/src/db/schema.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client.js'
import { resetDb, TEST_TABLES } from '../testing/db.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('schema', () => {
  it('has all six tables migrated', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const names = res.rows.map((r) => r.table_name)
    for (const t of TEST_TABLES) expect(names).toContain(t)
    await pool.end()
  })

  it('users has role/is_active and no email_verified_at', async () => {
    const { pool } = createDb(url!)
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    )
    const cols = res.rows.map((r) => r.column_name)
    expect(cols).toContain('role')
    expect(cols).toContain('is_active')
    expect(cols).not.toContain('email_verified_at')
    await pool.end()
  })
})
```

`apps/server/vitest.config.ts`를 다음으로 교체:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', fileParallelism: false } })
```

Run: `DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test`
Expected: FAIL — 신규 테이블 없음(스키마 테스트 2건 실패).

- [ ] **Step 3: 스키마 구현**

`apps/server/src/db/schema.ts` 전체 교체:
```ts
import {
  boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import type { Dialect } from '@erdd/core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'team'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_members_org_user').on(t.orgId, t.userId)],
)

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  dialects: jsonb('dialects').$type<Dialect[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_project_members_project_member').on(t.projectId, t.memberId)],
)

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`apps/server/src/db/client.ts`에 타입 별칭 추가:
```ts
export type Db = NodePgDatabase<typeof schema>
```
(기존 `createDb`는 유지 — 반환 타입에 `Db` 사용)

- [ ] **Step 4: 마이그레이션 생성·적용·테스트**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server db:generate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server db:migrate
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server typecheck && pnpm --filter @erdd/core test
```
Expected: `drizzle/0001_*.sql` 생성(users ALTER + 신규 테이블 5), 마이그레이션 성공, 테스트 전부 통과(core 38 유지).

- [ ] **Step 5: Commit**

```bash
git add apps/server packages/core
git commit -m "feat(server): 계정·조직·프로젝트 스키마 확장 — users 개정, 조직/멤버/프로젝트/세션 테이블"
```

---

### Task 2: 비밀번호 해시 (scrypt)

**Files:**
- Create: `apps/server/src/auth/password.ts`
- Test: `apps/server/src/auth/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`(형식 `scrypt:<salt b64url>:<hash b64url>`), `verifyPassword(password, stored): Promise<boolean>`. Task 3~4가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/auth/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password', () => {
  it('hashes with a random salt (two hashes differ) and verifies correctly', async () => {
    const a = await hashPassword('secret-123')
    const b = await hashPassword('secret-123')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt:')).toBe(true)
    expect(await verifyPassword('secret-123', a)).toBe(true)
    expect(await verifyPassword('wrong', a)).toBe(false)
  })

  it('rejects malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt:only-salt')).toBe(false)
  })
})
```

Run: `pnpm --filter @erdd/server test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`apps/server/src/auth/password.ts`:
```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split(':')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64url')
  const expected = Buffer.from(hashB64, 'base64url')
  if (expected.length === 0) return false
  const actual = await scryptAsync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}
```

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/server test && pnpm --filter @erdd/server typecheck` → PASS.
```bash
git add apps/server/src/auth
git commit -m "feat(server): scrypt 비밀번호 해시"
```

---

### Task 3: 세션 인증 기반과 auth 라우터, 관리자 부트스트랩

**Files:**
- Create: `apps/server/src/context.ts`, `apps/server/src/trpc.ts`, `apps/server/src/routers/auth.ts`, `apps/server/src/services/accounts.ts`, `apps/server/src/testing/helpers.ts`
- Modify: `apps/server/src/server.ts`, `apps/server/src/main.ts`, `apps/server/src/router.ts`, `.env.example`
- Test: `apps/server/src/routers/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 스키마·`Db`, Task 2 password.
- Produces:
  - `buildServer({ databaseUrl }?: { databaseUrl?: string })` — DB 없으면 public 라우트만. fastify 인스턴스에 `app.db: Db | null` decorate.
  - tRPC 빌딩블록: `router`, `publicProcedure`, `dbProcedure`, `authedProcedure`, `adminProcedure` (`apps/server/src/trpc.ts`) — Task 4~6이 사용.
  - `createAccount(db, { email, name, password, role }): Promise<{ id: string; email: string }>` — 사용자+개인 조직+owner 멤버 트랜잭션. Task 4가 재사용.
  - `ensureBootstrapAdmin(db)` — env `ADMIN_EMAIL`/`ADMIN_PASSWORD` 기반, 이미 있으면 no-op.
  - 라우트 `auth.login/logout/me/changePassword`.
  - 테스트 헬퍼(`testing/helpers.ts`): `createTestApp()`, `loginAs(app, email, password)`(세션 쿠키 문자열 반환) — Task 4~6 테스트가 사용.

- [ ] **Step 1: 의존성 설치**

Run: `pnpm --filter @erdd/server add @fastify/cookie uuidv7`

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/server/src/testing/helpers.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildServer({ databaseUrl: process.env.DATABASE_URL })
  await app.ready()
  return app
}

/** 로그인해 세션 쿠키 값을 반환한다. */
export async function loginAs(
  app: FastifyInstance, email: string, password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/trpc/auth.login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  const cookie = res.cookies.find((c) => c.name === 'erdd_session')
  if (!cookie) throw new Error('세션 쿠키 없음')
  return cookie.value
}
```

`apps/server/src/routers/auth.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount, ensureBootstrapAdmin } from '../services/accounts.js'
import { organizations } from '../db/schema.js'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('auth', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'u1@test.dev', name: '사용자1', password: 'password-1', role: 'user',
    })
  })

  it('login sets a session cookie and me returns the user', async () => {
    const token = await loginAs(app, 'u1@test.dev', 'password-1')
    const res = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toMatchObject({ email: 'u1@test.dev', role: 'user' })
  })

  it('rejects a wrong password with 401 and me without session with 401', async () => {
    const bad = await app.inject({
      method: 'POST', url: '/trpc/auth.login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'u1@test.dev', password: 'nope' }),
    })
    expect(bad.statusCode).toBe(401)
    const me = await app.inject({ method: 'GET', url: '/trpc/auth.me' })
    expect(me.statusCode).toBe(401)
  })

  it('changePassword invalidates the old password', async () => {
    const token = await loginAs(app, 'u1@test.dev', 'password-1')
    const res = await app.inject({
      method: 'POST', url: '/trpc/auth.changePassword',
      cookies: { erdd_session: token },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: 'password-1', newPassword: 'password-2' }),
    })
    expect(res.statusCode).toBe(200)
    await expect(loginAs(app, 'u1@test.dev', 'password-1')).rejects.toThrow()
    await loginAs(app, 'u1@test.dev', 'password-2')
  })

  it('createAccount creates a personal org; bootstrap admin is idempotent', async () => {
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(1)
    expect(orgs[0]).toMatchObject({ kind: 'personal' })

    process.env.ADMIN_EMAIL = 'admin@test.dev'
    process.env.ADMIN_PASSWORD = 'admin-pass-1'
    await ensureBootstrapAdmin(app.db!)
    await ensureBootstrapAdmin(app.db!)
    const token = await loginAs(app, 'admin@test.dev', 'admin-pass-1')
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: token },
    })
    expect(me.json().result.data).toMatchObject({ role: 'admin' })
    delete process.env.ADMIN_EMAIL
    delete process.env.ADMIN_PASSWORD
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

`apps/server/src/context.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { sessions, users } from './db/schema.js'

export const SESSION_COOKIE = 'erdd_session'

export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'user' }

export async function createContext({
  req, res, db,
}: {
  req: FastifyRequest
  res: FastifyReply
  db: Db | null
}) {
  let user: SessionUser | null = null
  const token = req.cookies[SESSION_COOKIE]
  if (db && token) {
    const rows = await db
      .select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, token))
    const row = rows[0]
    if (row && row.isActive && row.expiresAt > new Date()) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role }
    }
  }
  return { db, user, req, res }
}
export type Context = Awaited<ReturnType<typeof createContext>>
```

`apps/server/src/trpc.ts`:
```ts
import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const dbProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.db) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DB가 구성되지 않았습니다' })
  return next({ ctx: { ...ctx, db: ctx.db } })
})

export const authedProcedure = dbProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '관리자 권한이 필요합니다' })
  return next()
})
```

`apps/server/src/services/accounts.ts`:
```ts
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { Db } from '../db/client.js'
import { members, organizations, users } from '../db/schema.js'
import { hashPassword } from '../auth/password.js'

/** 사용자 + 개인 조직 + owner 멤버를 한 트랜잭션으로 생성한다(관리자 페이지·부트스트랩 공용). */
export async function createAccount(
  db: Db,
  input: { email: string; name: string; password: string; role: 'admin' | 'user' },
): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(input.password)
  return db.transaction(async (tx) => {
    const user = (
      await tx.insert(users).values({
        id: uuidv7(), email: input.email, name: input.name, passwordHash, role: input.role,
      }).returning({ id: users.id, email: users.email })
    )[0]!
    const org = (
      await tx.insert(organizations).values({
        id: uuidv7(), name: `${input.name}의 공간`, kind: 'personal',
      }).returning({ id: organizations.id })
    )[0]!
    await tx.insert(members).values({ id: uuidv7(), orgId: org.id, userId: user.id, role: 'owner' })
    return user
  })
}

/** env ADMIN_EMAIL/ADMIN_PASSWORD가 있고 해당 이메일 계정이 없으면 admin 계정을 만든다. */
export async function ensureBootstrapAdmin(db: Db): Promise<void> {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  const existing = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]
  if (existing) return
  await createAccount(db, { email, name: '관리자', password, role: 'admin' })
  console.log(`부트스트랩 관리자 계정 생성: ${email}`)
}
```

`apps/server/src/routers/auth.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { sessions, users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { SESSION_COOKIE } from '../context.js'
import { authedProcedure, dbProcedure, router } from '../trpc.js'

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export const authRouter = router({
  login: dbProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = (await ctx.db.select().from(users).where(eq(users.email, input.email)))[0]
      const ok = user && user.isActive && (await verifyPassword(input.password, user.passwordHash))
      if (!ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await ctx.db.insert(sessions).values({ id: token, userId: user.id, expiresAt })
      ctx.res.setCookie(SESSION_COOKIE, token, {
        path: '/', httpOnly: true, sameSite: 'lax', expires: expiresAt,
        secure: process.env.NODE_ENV === 'production',
      })
      return { id: user.id, email: user.email, name: user.name, role: user.role }
    }),

  logout: dbProcedure.mutation(async ({ ctx }) => {
    const token = ctx.req.cookies[SESSION_COOKIE]
    if (token) await ctx.db.delete(sessions).where(eq(sessions.id, token))
    ctx.res.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true as const }
  }),

  me: authedProcedure.query(({ ctx }) => ctx.user),

  changePassword: authedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const user = (await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)))[0]
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '현재 비밀번호가 올바르지 않습니다' })
      }
      await ctx.db.update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, user.id))
      const token = ctx.req.cookies[SESSION_COOKIE]
      if (token) {
        await ctx.db.delete(sessions)
          .where(and(eq(sessions.userId, user.id), ne(sessions.id, token)))
      }
      return { ok: true as const }
    }),
})
```

`apps/server/src/router.ts` 교체(AppRouter export 경로 유지 — web이 사용):
```ts
import { z } from 'zod'
import { parseLogicalType } from '@erdd/core'
import { authRouter } from './routers/auth.js'
import { publicProcedure, router } from './trpc.js'

export const appRouter = router({
  health: router({
    ping: publicProcedure.query(() => ({ ok: true as const, version: '0.1.0' })),
  }),
  logicalType: router({
    parse: publicProcedure.input(z.string()).query(({ input }) => parseLogicalType(input)),
  }),
  auth: authRouter,
})

export type AppRouter = typeof appRouter
```

`apps/server/src/server.ts` 교체:
```ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './router.js'
import { createContext } from './context.js'
import { createDb, type Db } from './db/client.js'
import type pg from 'pg'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db | null
    pgPool: pg.Pool | null
  }
}

const webDist = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')

export function buildServer({ databaseUrl }: { databaseUrl?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: false })

  let db: Db | null = null
  let pool: pg.Pool | null = null
  if (databaseUrl) {
    const created = createDb(databaseUrl)
    db = created.db
    pool = created.pool
    app.addHook('onClose', async () => { await pool!.end() })
  }
  app.decorate('db', db)
  app.decorate('pgPool', pool)

  app.register(fastifyCookie)
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: ({ req, res }: { req: any; res: any }) => createContext({ req, res, db }),
    },
  })

  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url === '/trpc' || req.url.startsWith('/trpc/')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }
  return app
}
```
(주: `createContext`의 req/res 파라미터 타입은 tRPC fastify 어댑터의 `CreateFastifyContextOptions`를 쓸 수 있으면 그것을 사용하고, 타입 마찰이 있으면 위처럼 최소화한다 — 구현 시 실제 어댑터 시그니처에 맞춰 조정하고 보고서에 기록.)

`apps/server/src/main.ts` 교체:
```ts
import { buildServer } from './server.js'
import { ensureBootstrapAdmin } from './services/accounts.js'

const app = buildServer({ databaseUrl: process.env.DATABASE_URL })
const port = Number(process.env.PORT ?? 3000)

async function start() {
  if (app.db) await ensureBootstrapAdmin(app.db)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`ERDD server listening on :${port}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0))
  })
}
```

`.env.example`에 추가:
```
# 최초 기동 시 관리자 계정 부트스트랩(선택)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-now
```

- [ ] **Step 4: 테스트 통과 확인 후 Commit**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server test        # DATABASE_URL 없이 — 통합 스킵, health/logicalType 통과
pnpm --filter @erdd/server typecheck && pnpm --filter @erdd/web typecheck
```
Expected: 전부 통과(web typecheck는 AppRouter 경로 유지 확인).

```bash
git add apps/server .env.example pnpm-lock.yaml
git commit -m "feat(server): 세션 인증 기반 — 쿠키 세션, auth 라우터, 관리자 부트스트랩"
```

---

### Task 4: 관리자 계정 관리 라우터

**Files:**
- Create: `apps/server/src/routers/admin.ts`
- Modify: `apps/server/src/router.ts`(admin 라우터 연결)
- Test: `apps/server/src/routers/admin.test.ts`

**Interfaces:**
- Consumes: `adminProcedure`, `createAccount`, Task 1 스키마.
- Produces: `admin.users.list / create / resetPassword / setActive`.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/routers/admin.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { organizations, users } from '../db/schema.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

describe.skipIf(!url)('admin.users', () => {
  let app: FastifyInstance
  let adminToken: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, {
      email: 'admin@test.dev', name: '관리자', password: 'admin-pass-1', role: 'admin',
    })
    adminToken = await loginAs(app, 'admin@test.dev', 'admin-pass-1')
  })

  it('create makes a user with a personal org; duplicate email conflicts', async () => {
    const res = await post(app, 'admin.users.create', adminToken, {
      email: 'u1@test.dev', name: '사용자1', initialPassword: 'password-1',
    })
    expect(res.statusCode).toBe(200)
    await loginAs(app, 'u1@test.dev', 'password-1')
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(2) // 관리자 개인 조직 + 신규 개인 조직

    const dup = await post(app, 'admin.users.create', adminToken, {
      email: 'u1@test.dev', name: '중복', initialPassword: 'password-1',
    })
    expect(dup.statusCode).toBe(409)
  })

  it('rejects non-admin callers with 403', async () => {
    await createAccount(app.db!, {
      email: 'u2@test.dev', name: '일반', password: 'password-2', role: 'user',
    })
    const token = await loginAs(app, 'u2@test.dev', 'password-2')
    const res = await app.inject({
      method: 'GET', url: '/trpc/admin.users.list', cookies: { erdd_session: token },
    })
    expect(res.statusCode).toBe(403)
  })

  it('resetPassword replaces the password and kills sessions', async () => {
    await createAccount(app.db!, {
      email: 'u3@test.dev', name: '사용자3', password: 'password-3', role: 'user',
    })
    const userToken = await loginAs(app, 'u3@test.dev', 'password-3')
    const target = (await app.db!.select().from(users).where(eq(users.email, 'u3@test.dev')))[0]!
    const res = await post(app, 'admin.users.resetPassword', adminToken, {
      userId: target.id, newPassword: 'password-x',
    })
    expect(res.statusCode).toBe(200)
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: userToken },
    })
    expect(me.statusCode).toBe(401) // 세션 무효화됨
    await loginAs(app, 'u3@test.dev', 'password-x')
  })

  it('setActive(false) blocks login and self-deactivation is rejected', async () => {
    await createAccount(app.db!, {
      email: 'u4@test.dev', name: '사용자4', password: 'password-4', role: 'user',
    })
    const target = (await app.db!.select().from(users).where(eq(users.email, 'u4@test.dev')))[0]!
    const res = await post(app, 'admin.users.setActive', adminToken, {
      userId: target.id, isActive: false,
    })
    expect(res.statusCode).toBe(200)
    await expect(loginAs(app, 'u4@test.dev', 'password-4')).rejects.toThrow()

    const admin = (await app.db!.select().from(users).where(eq(users.email, 'admin@test.dev')))[0]!
    const self = await post(app, 'admin.users.setActive', adminToken, {
      userId: admin.id, isActive: false,
    })
    expect(self.statusCode).toBe(400)
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL(admin 라우터 없음 → 404).

- [ ] **Step 2: 구현**

`apps/server/src/routers/admin.ts`:
```ts
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../auth/password.js'
import { createAccount } from '../services/accounts.js'
import { adminProcedure, router } from '../trpc.js'

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err &&
    (err as { code?: unknown }).code === '23505'
}

export const adminRouter = router({
  users: router({
    list: adminProcedure.query(({ ctx }) =>
      ctx.db.select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, isActive: users.isActive, createdAt: users.createdAt,
      }).from(users).orderBy(users.createdAt),
    ),

    create: adminProcedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(1),
        initialPassword: z.string().min(8),
        role: z.enum(['admin', 'user']).default('user'),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createAccount(ctx.db, {
            email: input.email, name: input.name,
            password: input.initialPassword, role: input.role,
          })
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new TRPCError({ code: 'CONFLICT', message: '이미 등록된 이메일입니다' })
          }
          throw err
        }
      }),

    resetPassword: adminProcedure
      .input(z.object({ userId: z.string().uuid(), newPassword: z.string().min(8) }))
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.db.update(users)
          .set({ passwordHash: await hashPassword(input.newPassword) })
          .where(eq(users.id, input.userId))
          .returning({ id: users.id })
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId))
        return { ok: true as const }
      }),

    setActive: adminProcedure
      .input(z.object({ userId: z.string().uuid(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id && !input.isActive) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '자기 자신은 비활성화할 수 없습니다' })
        }
        const updated = await ctx.db.update(users)
          .set({ isActive: input.isActive })
          .where(eq(users.id, input.userId))
          .returning({ id: users.id })
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' })
        }
        if (!input.isActive) {
          await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId))
        }
        return { ok: true as const }
      }),
  }),
})
```

`apps/server/src/router.ts`: `import { adminRouter } from './routers/admin.js'` 후 appRouter에 `admin: adminRouter` 추가.

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run: `DATABASE_URL=... pnpm --filter @erdd/server test && pnpm --filter @erdd/server typecheck` → PASS.
```bash
git add apps/server/src/routers apps/server/src/router.ts
git commit -m "feat(server): 관리자 계정 관리 API — 목록/생성/비밀번호 재설정/비활성화"
```

---

### Task 5: 조직·멤버 라우터

**Files:**
- Create: `apps/server/src/services/perm.ts`, `apps/server/src/routers/org.ts`
- Modify: `apps/server/src/router.ts`(org 연결)
- Test: `apps/server/src/routers/org.test.ts`

**Interfaces:**
- Consumes: `authedProcedure`, Task 1 스키마.
- Produces:
  - `getOrgMember(db, orgId, userId): Promise<Member | undefined>`(perm.ts — Task 6도 사용)
  - 라우트 `org.create / list / members.list / members.add / members.setRole / members.remove`
- 규칙: 개인 조직 멤버 추가 금지, 멤버 추가·관리는 Owner/Admin, Owner 역할 부여/회수는 Owner만, 마지막 Owner 제거·강등 금지.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/routers/org.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: token } })
}

describe.skipIf(!url)('org', () => {
  let app: FastifyInstance
  let ownerToken: string
  let plainToken: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@test.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'p@test.dev', name: '일반', password: 'password-p', role: 'user' })
    ownerToken = await loginAs(app, 'o@test.dev', 'password-o')
    plainToken = await loginAs(app, 'p@test.dev', 'password-p')
  })

  async function createTeam(): Promise<string> {
    const res = await post(app, 'org.create', ownerToken, { name: '팀A' })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.id as string
  }

  it('create team org and list shows personal + team with roles', async () => {
    await createTeam()
    const res = await get(app, 'org.list', ownerToken)
    const orgs = res.json().result.data as Array<{ kind: string; role: string }>
    expect(orgs).toHaveLength(2)
    expect(orgs.map((o) => o.kind).sort()).toEqual(['personal', 'team'])
    expect(orgs.every((o) => o.role === 'owner')).toBe(true)
  })

  it('adds a member by email; personal org rejects member add', async () => {
    const orgId = await createTeam()
    const add = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'p@test.dev', role: 'member',
    })
    expect(add.statusCode).toBe(200)

    const list = await get(app, 'org.list', plainToken)
    expect((list.json().result.data as unknown[]).length).toBe(2) // 개인 + 팀A

    const personal = (await get(app, 'org.list', ownerToken)).json().result.data
      .find((o: { kind: string }) => o.kind === 'personal')
    const bad = await post(app, 'org.members.add', ownerToken, {
      orgId: personal.id, email: 'p@test.dev', role: 'member',
    })
    expect(bad.statusCode).toBe(403)
  })

  it('plain member cannot add members; unknown email is 404; duplicate is 409', async () => {
    const orgId = await createTeam()
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'p@test.dev', role: 'member' })

    const forbidden = await post(app, 'org.members.add', plainToken, {
      orgId, email: 'o@test.dev', role: 'member',
    })
    expect(forbidden.statusCode).toBe(403)

    const notFound = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'ghost@test.dev', role: 'member',
    })
    expect(notFound.statusCode).toBe(404)

    const dup = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'p@test.dev', role: 'member',
    })
    expect(dup.statusCode).toBe(409)
  })

  it('protects the last owner from demotion and removal', async () => {
    const orgId = await createTeam()
    const membersRes = await get(app, 'org.members.list', ownerToken, { orgId })
    const ownerMember = (membersRes.json().result.data as Array<{ id: string; role: string }>)
      .find((m) => m.role === 'owner')!

    const demote = await post(app, 'org.members.setRole', ownerToken, {
      orgId, memberId: ownerMember.id, role: 'member',
    })
    expect(demote.statusCode).toBe(400)

    const remove = await post(app, 'org.members.remove', ownerToken, {
      orgId, memberId: ownerMember.id,
    })
    expect(remove.statusCode).toBe(400)
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL.

- [ ] **Step 2: 구현**

`apps/server/src/services/perm.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { members } from '../db/schema.js'

export type OrgRole = 'owner' | 'admin' | 'member'

export async function getOrgMember(
  db: Db, orgId: string, userId: string,
): Promise<{ id: string; role: OrgRole } | undefined> {
  const rows = await db
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.userId, userId)))
  return rows[0]
}
```

`apps/server/src/routers/org.ts`:
```ts
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { members, organizations, users } from '../db/schema.js'
import { getOrgMember } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

async function requireOrgManager(
  db: Parameters<typeof getOrgMember>[0], orgId: string, userId: string,
) {
  const me = await getOrgMember(db, orgId, userId)
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 관리 권한이 없습니다' })
  }
  return me
}

async function countOwners(db: Parameters<typeof getOrgMember>[0], orgId: string) {
  const rows = await db.select({ id: members.id })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.role, 'owner')))
  return rows.length
}

export const orgRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const org = (
          await tx.insert(organizations)
            .values({ id: uuidv7(), name: input.name, kind: 'team' })
            .returning()
        )[0]!
        await tx.insert(members)
          .values({ id: uuidv7(), orgId: org.id, userId: ctx.user.id, role: 'owner' })
        return org
      }),
    ),

  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: organizations.id, name: organizations.name,
        kind: organizations.kind, role: members.role,
      })
      .from(members)
      .innerJoin(organizations, eq(members.orgId, organizations.id))
      .where(eq(members.userId, ctx.user.id))
      .orderBy(organizations.createdAt),
  ),

  members: router({
    list: authedProcedure
      .input(z.object({ orgId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
        if (!me) throw new TRPCError({ code: 'FORBIDDEN', message: '조직 멤버가 아닙니다' })
        return ctx.db
          .select({
            id: members.id, role: members.role,
            userId: users.id, email: users.email, name: users.name,
          })
          .from(members)
          .innerJoin(users, eq(members.userId, users.id))
          .where(eq(members.orgId, input.orgId))
          .orderBy(members.createdAt)
      }),

    add: authedProcedure
      .input(z.object({
        orgId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['admin', 'member']),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const org = (
          await ctx.db.select().from(organizations).where(eq(organizations.id, input.orgId))
        )[0]
        if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: '조직을 찾을 수 없습니다' })
        if (org.kind === 'personal') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '개인 조직에는 멤버를 추가할 수 없습니다' })
        }
        const user = (
          await ctx.db.select().from(users)
            .where(and(eq(users.email, input.email), eq(users.isActive, true)))
        )[0]
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '해당 이메일의 사용자가 없습니다' })
        const existing = await getOrgMember(ctx.db, input.orgId, user.id)
        if (existing) throw new TRPCError({ code: 'CONFLICT', message: '이미 조직 멤버입니다' })
        const created = (
          await ctx.db.insert(members)
            .values({ id: uuidv7(), orgId: input.orgId, userId: user.id, role: input.role })
            .returning()
        )[0]!
        return created
      }),

    setRole: authedProcedure
      .input(z.object({
        orgId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(['owner', 'admin', 'member']),
      }))
      .mutation(async ({ ctx, input }) => {
        const me = await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const target = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, input.orgId)))
        )[0]
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '멤버를 찾을 수 없습니다' })
        if ((target.role === 'owner' || input.role === 'owner') && me.role !== 'owner') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner 역할 변경은 Owner만 가능합니다' })
        }
        if (target.role === 'owner' && input.role !== 'owner' &&
            (await countOwners(ctx.db, input.orgId)) <= 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '마지막 Owner는 강등할 수 없습니다' })
        }
        await ctx.db.update(members).set({ role: input.role }).where(eq(members.id, target.id))
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ orgId: z.string().uuid(), memberId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const me = await requireOrgManager(ctx.db, input.orgId, ctx.user.id)
        const target = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, input.orgId)))
        )[0]
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '멤버를 찾을 수 없습니다' })
        if (target.role === 'owner') {
          if (me.role !== 'owner') {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner 제거는 Owner만 가능합니다' })
          }
          if ((await countOwners(ctx.db, input.orgId)) <= 1) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '마지막 Owner는 제거할 수 없습니다' })
          }
        }
        await ctx.db.delete(members).where(eq(members.id, target.id))
        return { ok: true as const }
      }),
  }),
})
```

`apps/server/src/router.ts`: appRouter에 `org: orgRouter` 추가.

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run: `DATABASE_URL=... pnpm --filter @erdd/server test && pnpm --filter @erdd/server typecheck` → PASS.
```bash
git add apps/server/src/routers apps/server/src/services apps/server/src/router.ts
git commit -m "feat(server): 조직·멤버 API — 팀 생성, 이메일 직접 추가, Owner 보호 규칙"
```

---

### Task 6: 프로젝트 라우터

**Files:**
- Create: `apps/server/src/routers/project.ts`
- Modify: `apps/server/src/router.ts`(project 연결), `apps/server/src/services/perm.ts`(프로젝트 접근 헬퍼 추가)
- Test: `apps/server/src/routers/project.test.ts`

**Interfaces:**
- Consumes: Task 5의 `getOrgMember`, Task 1 스키마, `DIALECTS`.
- Produces:
  - perm.ts 추가: `getProjectAccess(db, projectId, userId): Promise<{ project, orgRole?, projectRole? } | undefined>` — 프로젝트 존재+요청자의 조직/프로젝트 역할 통합 조회
  - 라우트 `project.create / list / get / update / delete / members.list / members.add / members.remove`
- 규칙([01-concepts](../../01-concepts.md) 권한 모델): Org Owner/Admin은 조직 내 전체 프로젝트 접근(관리 포함). Org Member는 참여 프로젝트만. 생성은 Org Owner/Admin(생성자가 Project Admin으로 등록). 설정 변경·멤버 관리·삭제는 Project Admin 또는 Org Owner/Admin.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/routers/project.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
function get(app: FastifyInstance, path: string, token: string, input?: unknown) {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${path}${qs}`, cookies: { erdd_session: token } })
}

describe.skipIf(!url)('project', () => {
  let app: FastifyInstance
  let ownerToken: string
  let memberToken: string
  let orgId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'o@test.dev', name: '오너', password: 'password-o', role: 'user' })
    await createAccount(app.db!, { email: 'm@test.dev', name: '멤버', password: 'password-m', role: 'user' })
    ownerToken = await loginAs(app, 'o@test.dev', 'password-o')
    memberToken = await loginAs(app, 'm@test.dev', 'password-m')
    orgId = (await post(app, 'org.create', ownerToken, { name: '팀A' })).json().result.data.id
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'm@test.dev', role: 'member' })
  })

  async function createProject(): Promise<string> {
    const res = await post(app, 'project.create', ownerToken, {
      orgId, name: '주문시스템', dialects: ['postgresql'],
    })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.id as string
  }

  it('org owner creates a project and sees it; plain member sees none until added', async () => {
    const projectId = await createProject()
    const ownerList = (await get(app, 'project.list', ownerToken, { orgId })).json().result.data
    expect(ownerList).toHaveLength(1)

    const memberList = (await get(app, 'project.list', memberToken, { orgId })).json().result.data
    expect(memberList).toHaveLength(0)

    const denied = await get(app, 'project.get', memberToken, { projectId })
    expect(denied.statusCode).toBe(403)
  })

  it('plain org member cannot create a project', async () => {
    const res = await post(app, 'project.create', memberToken, {
      orgId, name: 'X', dialects: ['mysql'],
    })
    expect(res.statusCode).toBe(403)
  })

  it('project member with viewer role can read but not update', async () => {
    const projectId = await createProject()
    const orgMembers = (await get(app, 'org.members.list', ownerToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const m = orgMembers.find((x) => x.email === 'm@test.dev')!

    await post(app, 'project.members.add', ownerToken, {
      projectId, memberId: m.id, role: 'viewer',
    })
    const got = await get(app, 'project.get', memberToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.myRole).toBe('viewer')

    const upd = await post(app, 'project.update', memberToken, { projectId, name: '변경' })
    expect(upd.statusCode).toBe(403)
  })

  it('update validates dialects and delete removes the project', async () => {
    const projectId = await createProject()
    const badDialect = await post(app, 'project.update', ownerToken, {
      projectId, dialects: ['nosql'],
    })
    expect(badDialect.statusCode).toBe(400)

    const upd = await post(app, 'project.update', ownerToken, {
      projectId, name: '주문시스템v2', dialects: ['postgresql', 'oracle'],
    })
    expect(upd.statusCode).toBe(200)

    const del = await post(app, 'project.delete', ownerToken, { projectId })
    expect(del.statusCode).toBe(200)
    const list = (await get(app, 'project.list', ownerToken, { orgId })).json().result.data
    expect(list).toHaveLength(0)
  })
})
```

Run: `DATABASE_URL=... pnpm --filter @erdd/server test` → FAIL.

- [ ] **Step 2: 구현**

`apps/server/src/services/perm.ts`에 추가:
```ts
import { projects, projectMembers } from '../db/schema.js'

export type ProjectRole = 'admin' | 'editor' | 'viewer'

export type ProjectAccess = {
  project: typeof projects.$inferSelect
  orgRole: OrgRole | undefined
  projectRole: ProjectRole | undefined
  /** Org Owner/Admin 또는 Project Admin */
  canManage: boolean
  /** 조회 가능 여부 */
  canView: boolean
}

export async function getProjectAccess(
  db: Db, projectId: string, userId: string,
): Promise<ProjectAccess | undefined> {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]
  if (!project) return undefined
  const orgMember = await getOrgMember(db, project.orgId, userId)
  let projectRole: ProjectRole | undefined
  if (orgMember) {
    const pm = (
      await db.select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberId, orgMember.id),
        ))
    )[0]
    projectRole = pm?.role
  }
  const isOrgManager = orgMember?.role === 'owner' || orgMember?.role === 'admin'
  return {
    project,
    orgRole: orgMember?.role,
    projectRole,
    canManage: isOrgManager || projectRole === 'admin',
    canView: isOrgManager || projectRole !== undefined,
  }
}
```

`apps/server/src/routers/project.ts`:
```ts
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { DIALECTS } from '@erdd/core'
import { members, projectMembers, projects, users } from '../db/schema.js'
import { getOrgMember, getProjectAccess } from '../services/perm.js'
import { authedProcedure, router } from '../trpc.js'

const dialectSchema = z.array(z.enum(DIALECTS)).min(1)

async function requireAccess(
  db: Parameters<typeof getProjectAccess>[0], projectId: string, userId: string,
  level: 'view' | 'manage',
) {
  const access = await getProjectAccess(db, projectId, userId)
  if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  const allowed = level === 'view' ? access.canView : access.canManage
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 접근 권한이 없습니다' })
  return access
}

export const projectRouter = router({
  create: authedProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().default(''),
      dialects: dialectSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
      if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 생성 권한이 없습니다' })
      }
      return ctx.db.transaction(async (tx) => {
        const project = (
          await tx.insert(projects).values({
            id: uuidv7(), orgId: input.orgId, name: input.name,
            description: input.description, dialects: input.dialects,
          }).returning()
        )[0]!
        await tx.insert(projectMembers).values({
          id: uuidv7(), projectId: project.id, memberId: me.id, role: 'admin',
        })
        return project
      })
    }),

  list: authedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const me = await getOrgMember(ctx.db, input.orgId, ctx.user.id)
      if (!me) throw new TRPCError({ code: 'FORBIDDEN', message: '조직 멤버가 아닙니다' })
      if (me.role === 'owner' || me.role === 'admin') {
        return ctx.db.select().from(projects)
          .where(eq(projects.orgId, input.orgId)).orderBy(projects.createdAt)
      }
      return ctx.db.select({
        id: projects.id, orgId: projects.orgId, name: projects.name,
        description: projects.description, dialects: projects.dialects,
        createdAt: projects.createdAt,
      })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projectMembers.memberId, me.id), eq(projects.orgId, input.orgId)))
        .orderBy(projects.createdAt)
    }),

  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = await requireAccess(ctx.db, input.projectId, ctx.user.id, 'view')
      return {
        ...access.project,
        myRole: access.projectRole ?? null,
        myOrgRole: access.orgRole ?? null,
      }
    }),

  update: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      dialects: dialectSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      const { projectId, ...patch } = input
      if (Object.keys(patch).length === 0) return { ok: true as const }
      await ctx.db.update(projects).set(patch).where(eq(projects.id, projectId))
      return { ok: true as const }
    }),

  delete: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
      await ctx.db.delete(projects).where(eq(projects.id, input.projectId))
      return { ok: true as const }
    }),

  members: router({
    list: authedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireAccess(ctx.db, input.projectId, ctx.user.id, 'view')
        return ctx.db.select({
          id: projectMembers.id, role: projectMembers.role,
          memberId: members.id, email: users.email, name: users.name,
        })
          .from(projectMembers)
          .innerJoin(members, eq(projectMembers.memberId, members.id))
          .innerJoin(users, eq(members.userId, users.id))
          .where(eq(projectMembers.projectId, input.projectId))
          .orderBy(projectMembers.createdAt)
      }),

    add: authedProcedure
      .input(z.object({
        projectId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(['admin', 'editor', 'viewer']),
      }))
      .mutation(async ({ ctx, input }) => {
        const access = await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
        const orgMember = (
          await ctx.db.select().from(members)
            .where(and(eq(members.id, input.memberId), eq(members.orgId, access.project.orgId)))
        )[0]
        if (!orgMember) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '조직 멤버를 찾을 수 없습니다' })
        }
        const existing = (
          await ctx.db.select().from(projectMembers)
            .where(and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.memberId, input.memberId),
            ))
        )[0]
        if (existing) throw new TRPCError({ code: 'CONFLICT', message: '이미 프로젝트 멤버입니다' })
        await ctx.db.insert(projectMembers).values({
          id: uuidv7(), projectId: input.projectId, memberId: input.memberId, role: input.role,
        })
        return { ok: true as const }
      }),

    remove: authedProcedure
      .input(z.object({ projectId: z.string().uuid(), projectMemberId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireAccess(ctx.db, input.projectId, ctx.user.id, 'manage')
        await ctx.db.delete(projectMembers).where(and(
          eq(projectMembers.id, input.projectMemberId),
          eq(projectMembers.projectId, input.projectId),
        ))
        return { ok: true as const }
      }),
  }),
})
```

`apps/server/src/router.ts`: appRouter에 `project: projectRouter` 추가.

- [ ] **Step 3: 테스트 통과 확인 후 Commit**

Run:
```bash
DATABASE_URL=postgres://postgres:erdd@localhost:5432/erdd pnpm --filter @erdd/server test
pnpm --filter @erdd/server test   # 미설정 — 통합 스킵 확인
pnpm typecheck && pnpm test       # 루트 전체
```
Expected: 전부 통과.

```bash
git add apps/server/src/routers apps/server/src/services apps/server/src/router.ts
git commit -m "feat(server): 프로젝트 API — 생성/조회/수정/삭제와 멤버 관리, 권한 검사"
```

---

## 완료 기준 (M2a Definition of Done)

- `DATABASE_URL` 설정 시 서버 통합 테스트 전부 통과, 미설정 시 통합 테스트는 스킵되고 나머지 통과.
- 루트 `pnpm test`/`pnpm typecheck` 통과(core 38 유지, web 영향 없음).
- `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 기동하면 관리자 계정+개인 조직이 1회 생성된다(멱등).
- 권한 규칙이 테스트로 고정됨: 관리자 전용 라우트 403, 개인 조직 멤버 추가 금지, 마지막 Owner 보호, Org Member의 프로젝트 가시성 제한.
