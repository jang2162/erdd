# 초대 링크·비밀번호 재설정 링크 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**설계:** [2026-08-06-invite-and-reset-links-design.md](../specs/2026-08-06-invite-and-reset-links-design.md)

**Goal:** 관리자가 초기 비밀번호를 정해 전달하던 두 경로(계정 생성·비밀번호 재설정)를 일회용 링크로 바꿔, 평문 비밀번호가 관리자 손을 거치지 않게 한다.

**Architecture:** 일회용 토큰 테이블 2개(`invitations`·`password_reset_tokens`, 마이그 0012)를 두고, 만료·1회용 판정은 서비스 함수 하나(`assertLive`)로 모은다. 초대 수락은 계정·개인조직·조직합류·초대소비를 한 트랜잭션으로 처리하므로 `createAccount`가 트랜잭션을 받도록 넓힌다. 토큰을 유일한 자격으로 삼는 공개 프로시저는 정확히 3개다.

**Tech Stack:** TypeScript · Fastify · tRPC · drizzle(Postgres) · vitest · React(react-router, TanStack Query) · testing-library

## Global Constraints

- 응답·커밋 메시지·주석·문서는 **한국어**로 쓴다.
- **core 변경 없음. CLI 변경 없음. 새 op 엔티티 없음.** 마이그레이션은 **0012 하나**.
- **공개(비인증) 프로시저는 정확히 셋이다** — `invitation.peek` · `invitation.accept` · `auth.resetPassword`. 그 외 새 프로시저는 전부 `authedProcedure` 이상이다(`trpc.ts:16`의 fail-closed 규칙).
- **평문 토큰은 발급 응답에서만 나간다.** 목록·조회 프로시저는 절대 평문을 반환하지 않는다(`auth.tokens.create`의 기존 관례).
- `git add -A` 금지. 커밋할 경로를 명시한다. 커밋 메시지 말미에 트레일러 2줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
  ```
- **typecheck는 종료코드로 판정한다.** `pnpm -s -r typecheck`는 자식 출력을 삼켜 오류가 있어도 0바이트 출력 + 종료코드 1이다. 파이프를 붙이면 `$?`가 파이프 끝의 것이 된다.
  ```bash
  pnpm -r typecheck; echo "EXIT=$?"      # EXIT=0이어야 통과
  ```
- **server 스위트는 DB가 필요하다.** 워크트리에서는 격리 DB를 쓴다(브리프가 값을 준다).

## 구현자·리뷰어 공통 지시 (모든 태스크)

1. **브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크 산출물도 고치지 마라 — 단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가 한다.**
2. **수정 건마다 구분력을 확인하라** — 프로덕션 변경을 되돌려 테스트가 실제로 실패하는지 보고 복구하라. **실패하지 않으면 덮지 말고 그렇다고 보고하라.** 복구 후 `git status`로 워킹트리가 깨끗한지 확인한다.
3. **리뷰 보고서의 제안도 검증되지 않은 주장이다.** 그대로 통과한다고 가정하지 마라.

## 기준선

```
core 463 · cli 138 · web 382 · server 143 · typecheck EXIT=0
```
(2026-08-06 실측, main `f6543b2`)

**core·cli는 이 사이클에서 변하지 않아야 한다.** 변하면 범위를 넘은 것이다.

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `apps/server/src/db/schema.ts` | 테이블 2개 | 1 |
| `apps/server/drizzle/0012_*.sql` | 마이그레이션 | 1 |
| `apps/server/src/auth/token.ts` | `generateToken`이 접두를 받는다 | 1 |
| `apps/server/src/services/one-time-token.ts` | **신규** — 발급·만료·`assertLive` | 1 |
| `apps/server/src/testing/db.ts` | `TEST_TABLES` +2 | 1 |
| `apps/server/src/services/accounts.ts` | `createAccount`가 tx 수용 | 2 |
| `apps/server/src/routers/invitation.ts` | **신규** — 5개 프로시저 | 2 |
| `apps/server/src/router.ts` | `invitation` 등록 | 2 |
| `apps/server/src/routers/admin.ts` | `invite`·`resetLink`로 교체 | 3 |
| `apps/server/src/routers/auth.ts` | `resetPassword` 추가(공개) | 3 |
| `apps/web/src/pages/invite-accept.tsx` · `reset-password.tsx` | **신규** | 4 |
| `apps/web/src/routes.tsx` | 비보호 라우트 2개 | 4 |
| `apps/web/src/pages/org-detail.tsx` | 초대 섹션 | 5 |
| `apps/web/src/pages/admin.tsx` | 폼 교체 | 5 |
| `docs/18-account.md` · `docs/91-checklist.md` · `docs/superpowers/HANDOFF.md` | 사양·인계 갱신 | 6 |

---

## Task 1: 데이터 계층 — 테이블 2개 · 토큰 서비스

**Files:**
- Modify: `apps/server/src/db/schema.ts` · `apps/server/src/auth/token.ts` · `apps/server/src/testing/db.ts`
- Create: `apps/server/src/services/one-time-token.ts` · `apps/server/src/services/one-time-token.test.ts`
- Create: `apps/server/drizzle/0012_*.sql` (drizzle-kit generate가 이름을 정한다)

**Interfaces:**
- Consumes: 기존 `generateToken()`/`hashToken()`(`auth/token.ts`), `organizations`·`users` 테이블
- Produces: `invitations`·`passwordResetTokens` 테이블, `issueToken(kind)`, `tokenExpiry(kind)`, `assertLive(row)`. Task 2·3이 전부 사용한다.

- [ ] **Step 1: `generateToken`이 접두를 받게 한다**

`auth/token.ts`. 기존 `TOKEN_PREFIX = 'erdd_pat_'`는 그대로 두고 인자를 더한다 — 기존 호출자
(`auth.tokens.create`)가 인자 없이 부르므로 무영향이다.

```ts
export const TOKEN_PREFIX = 'erdd_pat_'
export const INVITE_PREFIX = 'erdd_inv_'
export const RESET_PREFIX = 'erdd_rst_'

export function generateToken(prefix: string = TOKEN_PREFIX): string {
  return prefix + randomBytes(32).toString('base64url')
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/server/src/services/one-time-token.test.ts` (신규). **DB가 필요 없다** — 순수 함수 테스트이므로
`describe.skipIf`를 쓰지 않는다.

```ts
import { describe, expect, it } from 'vitest'
import { assertLive, issueToken, tokenExpiry } from './one-time-token.js'

describe('one-time-token', () => {
  it('종류별 접두가 다르고 평문과 해시가 함께 나온다', () => {
    const inv = issueToken('invitation')
    const rst = issueToken('reset')
    expect(inv.plain.startsWith('erdd_inv_')).toBe(true)
    expect(rst.plain.startsWith('erdd_rst_')).toBe(true)
    // 해시는 평문과 달라야 하고, 같은 평문은 같은 해시가 나와야 조회가 성립한다.
    expect(inv.hash).not.toBe(inv.plain)
    expect(issueToken('invitation').plain).not.toBe(inv.plain)
  })

  it('만료는 초대 7일 · 재설정 24시간이다', () => {
    const now = Date.now()
    const inv = tokenExpiry('invitation').getTime() - now
    const rst = tokenExpiry('reset').getTime() - now
    // 초 단위 오차를 허용한다(호출 시각 차이).
    expect(Math.round(inv / 3_600_000)).toBe(24 * 7)
    expect(Math.round(rst / 3_600_000)).toBe(24)
  })

  it('살아 있는 토큰은 통과한다', () => {
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 60_000), usedAt: null })).not.toThrow()
  })

  it('만료된 토큰과 사용된 토큰을 구분해 거부한다', () => {
    // 사유가 갈려야 화면이 다른 문구를 낼 수 있다. 둘 다 같은 코드로 뭉뚱그리면
    // "이미 쓴 링크"와 "기한이 지난 링크"를 사용자가 구별하지 못한다.
    // toThrow에 문자열을 주면 메시지 부분 일치를 본다 — try/catch로 쓰면 예외가
    // 안 났을 때 catch가 실행되지 않아 단언이 통째로 건너뛰어진다(조용한 통과).
    expect(() => assertLive({ expiresAt: new Date(Date.now() - 1), usedAt: null }))
      .toThrow('기한')
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() }))
      .toThrow('사용')
  })

  it('사용된 토큰은 만료 전이어도 거부된다', () => {
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 86_400_000), usedAt: new Date() }))
      .toThrow()
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
pnpm --filter @erdd/server exec vitest run src/services/one-time-token.test.ts
```
Expected: FAIL — `Cannot find module './one-time-token.js'`.

- [ ] **Step 4: 토큰 서비스를 구현한다**

`apps/server/src/services/one-time-token.ts` (신규):

```ts
import { TRPCError } from '@trpc/server'
import { INVITE_PREFIX, RESET_PREFIX, generateToken, hashToken } from '../auth/token.js'

export type TokenKind = 'invitation' | 'reset'

const PREFIX: Record<TokenKind, string> = {
  invitation: INVITE_PREFIX,
  reset: RESET_PREFIX,
}

/** 만료: 초대는 사람이 며칠 뒤 열어도 되게 넉넉히, 재설정은 짧게. */
const TTL_MS: Record<TokenKind, number> = {
  invitation: 7 * 24 * 60 * 60 * 1000,
  reset: 24 * 60 * 60 * 1000,
}

/** 평문은 호출자가 한 번 쓰고 버린다 — DB에는 hash만 저장한다. */
export function issueToken(kind: TokenKind): { plain: string; hash: string } {
  const plain = generateToken(PREFIX[kind])
  return { plain, hash: hashToken(plain) }
}

export function tokenExpiry(kind: TokenKind): Date {
  return new Date(Date.now() + TTL_MS[kind])
}

/**
 * 만료·1회용 판정을 한 곳에 모은다. 초대와 재설정이 각자 판정하면 한쪽만 고쳐질 수 있고,
 * 그 순간 죽은 링크가 살아난다.
 */
export function assertLive(row: { expiresAt: Date; usedAt: Date | null }): void {
  if (row.usedAt !== null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 사용된 링크입니다' })
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '기한이 지난 링크입니다' })
  }
}
```

**순서가 중요하다** — 사용됨을 먼저 본다. 사용된 뒤 만료까지 된 토큰은 "이미 사용"이 더 정확한 안내다.

- [ ] **Step 5: 스키마에 테이블 2개를 더한다**

`apps/server/src/db/schema.ts`. `accessTokens` 아래에 둔다.

```ts
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  // null이면 "조직 합류 없는 초대"다 — 관리자 페이지가 만드는 계정 전용 초대.
  // 수락하면 개인 조직만 생기고 어느 팀에도 들어가지 않는다.
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  orgRole: text('org_role', { enum: ['admin', 'member'] }),
  // 서비스 역할은 초대 행이 들고 있다 — 수락자가 스스로 admin이 될 수 있으면 안 된다.
  userRole: text('user_role', { enum: ['admin', 'user'] }).notNull().default('user'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 6: `TEST_TABLES`에 추가한다**

`apps/server/src/testing/db.ts`. **맨 앞에 둔다**(TRUNCATE CASCADE라 순서는 무해하지만, 목록이
의존 역순이라는 기존 관례를 지킨다):

```ts
export const TEST_TABLES = [
  'invitations', 'password_reset_tokens',
  'promotion_requests',
  // ↓ 기존 그대로
```

**빠뜨리면 이 테이블만 테스트 간에 남아 다음 스위트를 오염시킨다.**

- [ ] **Step 7: 마이그레이션을 생성하고 적용한다**

```bash
pnpm --filter @erdd/server exec drizzle-kit generate
# 브리프가 준 격리 DB 두 개(dev·test)에 적용한다
DATABASE_URL='<격리 dev>'  pnpm --filter @erdd/server exec drizzle-kit migrate
DATABASE_URL='<격리 test>' pnpm --filter @erdd/server exec drizzle-kit migrate
```

생성된 파일이 `0012_`로 시작하는지 확인한다. 다른 번호면 보고하라.

- [ ] **Step 8: 테스트와 typecheck**

```bash
pnpm --filter @erdd/server exec vitest run src/services/one-time-token.test.ts
DATABASE_URL='<격리 test>' pnpm --filter @erdd/server exec vitest run
pnpm -s -C apps/server typecheck; echo "EXIT=$?"
```
Expected: 새 5건 PASS · server 전체 **148 passed**(143 + 5) · EXIT=0.

- [ ] **Step 9: 구분력을 확인한다**

`assertLive`의 `usedAt` 검사를 지우고 `one-time-token.test.ts`를 돌린다.
Expected: `만료된 토큰과 사용된 토큰을 구분해 거부한다`와 `사용된 토큰은 만료 전이어도 거부된다`가 FAIL.
확인 후 되돌린다.

- [ ] **Step 10: 커밋**

```bash
git add apps/server/src/db/schema.ts apps/server/src/auth/token.ts apps/server/src/testing/db.ts \
        apps/server/src/services/one-time-token.ts apps/server/src/services/one-time-token.test.ts \
        apps/server/drizzle && \
git commit -m "$(cat <<'EOF'
feat(server): 일회용 토큰 테이블 2개와 공용 판정 함수

초대(erdd_inv_)와 비밀번호 재설정(erdd_rst_)이 쓸 토큰을 마련한다. 액세스 토큰과 같은
규칙이다 — 평문 접두 + 랜덤, DB에는 SHA-256만, 평문은 발급 응답에서만.

만료·1회용 판정은 assertLive 하나로 모은다. 두 곳에서 각자 판정하면 한쪽만 고쳐질 수
있고 그 순간 죽은 링크가 살아난다. 사용됨을 만료보다 먼저 보는 것도 의도다 — 사용된 뒤
기한까지 지난 토큰은 "이미 사용"이 더 정확한 안내다.

테이블을 둘로 나눈 이유는 초대에 아직 user가 없고 재설정에는 email이 필요 없기 때문이다.
합치면 두 필드가 모두 nullable이 되어 불가능한 상태가 타입에 표현된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- apps/server/src/db/schema.ts apps/server/src/auth/token.ts apps/server/src/testing/db.ts \
      apps/server/src/services/one-time-token.ts apps/server/src/services/one-time-token.test.ts \
      apps/server/drizzle
```

---

## Task 2: `createAccount` 트랜잭션 수용 · `invitation` 라우터

**Files:**
- Modify: `apps/server/src/services/accounts.ts` · `apps/server/src/router.ts`
- Create: `apps/server/src/routers/invitation.ts` · `apps/server/src/routers/invitation.test.ts`

**Interfaces:**
- Consumes: Task 1의 `issueToken`·`tokenExpiry`·`assertLive`, `invitations` 테이블, 기존 `requireOrgManager`(`services/perm.ts`), `normalizeEmail`·`createAccount`
- Produces: `invitationRouter`(`create`·`listForOrg`·`revoke`·`peek`·`accept`). Task 4·5의 웹이 호출한다.

- [ ] **Step 1: `createAccount`가 트랜잭션 위에서 돌 수 있게 한다**

`services/accounts.ts`. **drizzle이 tx를 그대로 받아 중첩을 savepoint로 처리하는지 먼저 실측하라.**
그렇다면 타입만 넓히면 되고 `opts`가 필요 없다. 안 되면 "이미 트랜잭션 안"임을 알리는 인자를 더한다.
**어느 쪽을 골랐는지와 근거를 보고하라.**

지켜야 할 불변식 둘:
- **개인 조직 생성이 계정 생성과 갈라지지 않는다** — 두 경로 모두 사용자·개인조직·owner 멤버 셋을 함께 만든다.
- **이메일 정규화가 이 함수 안에서만 일어난다** — 호출자가 각자 `normalizeEmail`을 부르면 한 곳이 빠진다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/server/src/routers/invitation.test.ts` (신규). 파일 상단은 `admin.test.ts:1-16`의 형태를 그대로
따르되 **공개 프로시저용 헬퍼를 하나 더 둔다**(쿠키 없이 호출한다):

```ts
/** 세션 쿠키 없이 호출한다 — 공개 프로시저(peek·accept)가 정말 공개인지 보려면 이것을 써야 한다. */
function postPublic(app: FastifyInstance, path: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
```

테스트 목록(각각 `it` 하나):

1. **`create`가 초대를 만들고 평문 토큰을 한 번 반환한다** — 응답에 `erdd_inv_`로 시작하는 토큰이 있고, `listForOrg`에는 평문이 없다.
2. **`create`가 이미 가입한 이메일을 거부한다**(409) — §3.3 앞쪽.
3. **`create`가 개인 조직을 거부한다**(403).
4. **조직 매니저가 아닌 멤버는 `create`·`revoke`를 못 한다**(403).
5. **다른 조직의 초대는 `listForOrg`에 안 나온다** — 외부인 조직에 초대를 심어 두고 목록에 없음을 단언(테넌트 격리).
6. **재발급이 이전 초대를 죽인다** — 같은 (email, org)로 두 번 `create` → 첫 토큰으로 `peek` 하면 실패, 두 번째는 성공. **두 링크가 동시에 살아 있지 않다.**
7. **`revoke`가 초대를 죽인다** — 이후 `peek` 실패.
8. **`peek`이 세션 없이 이메일·조직명을 준다**(`postPublic`).
9. **`peek`이 `userRole`을 내보내지 않는다** — 응답 키에 `userRole`이 없다.
10. **조직 없는 초대의 `peek`은 `orgName`·`orgRole`이 null이다.**
11. **`accept`가 세션 없이 계정과 조직 멤버를 만든다** — 이후 `loginAs`로 로그인되고, 개인 조직 + 초대 조직 둘 다 멤버다.
12. **`accept`가 초대의 `userRole`을 쓴다 — 입력으로 역할을 올릴 수 없다** — `userRole:'admin'`인 초대는 admin을 만들고, 클라이언트가 보낸 여분 필드는 무시된다.
13. **`accept` 후 같은 토큰이 재사용되지 않는다**(400).
14. **만료된 초대는 `peek`·`accept` 둘 다 거부한다** — `expiresAt`을 과거로 직접 UPDATE해 만든다.
15. **초대 생성 후 그 이메일이 먼저 가입하면 `accept`가 CONFLICT이고 초대가 소비되지 않는다** — §3.3 뒤쪽. `usedAt`이 여전히 null임을 DB에서 확인한다.
16. **`accept`가 원자적이다** — 조직 멤버 insert가 실패하도록 만들고(예: 초대 조직을 미리 삭제) 계정도 생기지 않았음을 확인한다.

> ⚠️ 16번은 조직을 지우면 `invitations.orgId`가 cascade로 함께 사라져 초대 자체가 없어질 수 있다.
> 그 경우 이 테스트는 원자성이 아니라 "초대 없음"을 보게 되어 **가짜 통과**가 된다. 실제로 어떤지
> 확인하고, cascade로 사라진다면 다른 실패 주입(예: 같은 (org,user) 멤버를 미리 넣어 unique 위반)을
> 쓰거나 **이 테스트를 빼고 그 사실을 보고하라.** 무엇을 골랐는지 근거와 함께 보고한다.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
DATABASE_URL='<격리 test>' pnpm --filter @erdd/server exec vitest run src/routers/invitation.test.ts
```
Expected: 전부 FAIL(라우터 없음).

- [ ] **Step 4: 라우터를 구현한다**

`apps/server/src/routers/invitation.ts` (신규). 요지:

- `create`: `requireOrgManager` → 조직이 `personal`이면 FORBIDDEN → `normalizeEmail` 후 기존 사용자
  검사(409) → **같은 (email, orgId)의 미사용 초대를 만료 처리**(`expiresAt`을 현재로) → `issueToken` →
  insert → `{ token: plain, id }` 반환.
- `listForOrg`: `requireOrgManager` → 그 조직 행만. **`tokenHash`를 select에 넣지 않는다.**
- `revoke`: `requireOrgManager` → 조건부 UPDATE(`and(eq(id), isNull(usedAt))`) → `rowCount === 0`이면
  CONFLICT. **이미 사용된 초대를 되살리거나 덮어쓰지 않는다.**
- `peek`(`dbProcedure`): `hashToken(input.token)`으로 조회 → 없으면 BAD_REQUEST(만료와 같은 문구로
  존재 오라클을 만들지 않는다) → `assertLive` → `{ email, orgName, orgRole }`.
- `accept`(`dbProcedure`): 한 트랜잭션으로 — 조회 → `assertLive` → 이메일 재검사(409) →
  `createAccount`(tx 위) → `orgId`가 있으면 멤버 insert → `usedAt` 기록.

`router.ts`에 `invitation: invitationRouter`를 등록한다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
DATABASE_URL='<격리 test>' pnpm --filter @erdd/server exec vitest run
pnpm -s -C apps/server typecheck; echo "EXIT=$?"
```
Expected: server **164 passed**(148 + 16, 16번을 뺐다면 163) · EXIT=0. **기존 143건은 하나도 깨지지 않아야 한다.**

- [ ] **Step 6: 구분력을 확인한다**

세 가지를 각각 되돌려 확인하고 복구한다.
- `create`의 "기존 미사용 초대 만료" 줄 제거 → 6번 FAIL
- `accept`의 이메일 재검사 제거 → 15번 FAIL
- `peek`의 `assertLive` 제거 → 14번 FAIL

**실패하지 않는 것이 있으면 어느 것인지 보고하라.**

- [ ] **Step 7: 커밋**

```bash
# db/client.ts(Tx·DbOrTx의 자리는 accounts.ts가 아니라 여기다) · routers/org.ts ·
# services/perm.ts(requireOrgManager 이동 — Interfaces가 이미 perm.ts라고 적어 둔 것)까지 포함한다.
git add apps/server/src/services/accounts.ts apps/server/src/routers/invitation.ts \
        apps/server/src/routers/invitation.test.ts apps/server/src/router.ts \
        apps/server/src/db/client.ts apps/server/src/routers/org.ts \
        apps/server/src/services/perm.ts && \
git commit -m "$(cat <<'EOF'
feat(server): 초대 생성·수락 경로

createAccount가 호출자의 트랜잭션 위에서 돌 수 있게 넓혔다. 초대 수락은 계정·개인조직·
조직합류·초대소비가 한 트랜잭션이어야 하기 때문이다 — 중간에 끊기면 계정은 생겼는데
조직에 못 들어간 상태가 되고, 초대가 소비됐다면 복구 경로가 없다.

재발급이 이전 초대를 만료시킨다. 두 번 발급했는데 첫 링크가 살아 있으면 그것이 어디로
갔는지 아무도 모른다.

이미 가입한 이메일은 생성 시점과 수락 시점 양쪽에서 거부한다. 그 사이에 가입할 수 있고,
그때 초대는 소비되지 않고 남아야 한다.

peek·accept는 세션 없이 호출되지만 유효한 토큰을 유일한 자격으로 삼고, 토큰은 해시로만
조회되어 열거할 수 없다. peek은 userRole을 내보내지 않는다 - 수락자가 알 이유가 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JWohC7dLRgZQ4oFZBJdBsC
EOF
)" -- apps/server/src/services/accounts.ts apps/server/src/routers/invitation.ts \
      apps/server/src/routers/invitation.test.ts apps/server/src/router.ts \
      apps/server/src/db/client.ts apps/server/src/routers/org.ts \
      apps/server/src/services/perm.ts
```

---

## Task 3: `admin` 교체 · `auth.resetPassword`

**Files:**
- Modify: `apps/server/src/routers/admin.ts` · `apps/server/src/routers/admin.test.ts` · `apps/server/src/routers/auth.ts` · `apps/server/src/routers/auth.test.ts`

**Interfaces:**
- Consumes: Task 1의 토큰 서비스, `passwordResetTokens`·`invitations` 테이블
- Produces: `admin.users.invite`·`admin.users.resetLink`·`auth.resetPassword`. Task 5의 관리자 화면이 호출한다.

> ⚠️ **기존 테스트 2건이 반드시 깨진다.** `admin.test.ts:31`(`create makes a user with a personal org;
> duplicate email conflicts`)과 `:57`(`resetPassword replaces the password and kills sessions`)이
> 사라질 프로시저를 호출한다. **이 둘은 새 동작에 맞게 고쳐 쓴다** — 지우지 말고, 무엇을 검증하던
> 테스트였는지 유지한 채 링크 발급 형태로 옮긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`admin.test.ts`의 기존 2건을 고치고 새 것을 더한다.

- `invite`가 계정을 만들지 않고 초대만 만든다 — 응답에 `erdd_inv_` 토큰, `users` 행은 늘지 않는다.
- **`invite`로 만든 초대를 수락하면 개인 조직만 생기고 팀 조직에는 안 들어간다**(`orgId`가 null).
- `invite`가 중복 이메일을 거부한다(409) — 기존 `create` 테스트가 보던 성질.
- `invite`가 재발급 시 이전 초대를 죽인다.
- `resetLink`가 링크를 내지만 **비밀번호를 바꾸지 않고 세션도 안 죽인다** — 발급 후에도 기존 세션으로 호출이 되고 옛 비밀번호로 로그인된다. ← §5.4의 구분.
- `auth.resetPassword`(공개)가 비밀번호를 바꾸고 **세션을 전부 죽인다** — 기존 세션 쿠키로 호출하면 401.
- 재설정 재발급이 이전 토큰을 죽인다.
- 만료된 재설정 토큰이 거부된다.
- 비관리자가 `invite`·`resetLink`를 못 부른다(403).
- **라우터 표면 단언: `admin.users.create`와 `admin.users.resetPassword`가 더 이상 없다.** 존재하지 않는 경로 호출이 404를 내는 것으로 확인한다. ← §2.4가 절반만 이뤄지는 것을 막는 유일한 테스트다.

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인**

```bash
DATABASE_URL='<격리 test>' pnpm --filter @erdd/server exec vitest run
pnpm -s -C apps/server typecheck; echo "EXIT=$?"
```
Expected: server **174 내외**(정확한 수는 실측해 보고). EXIT=0.

- [ ] **Step 5: 구분력 확인**

- `auth.resetPassword`의 세션 삭제를 지운다 → 해당 테스트 FAIL
- `resetLink`에 세션 삭제를 **넣어 본다**(잘못된 구현) → "발급만으로는 세션이 살아 있다" FAIL
확인 후 복구.

- [ ] **Step 6: 커밋** (메시지는 위 형식을 따라 한국어로, 트레일러 2줄 포함)

---

## Task 4: 웹 — 비보호 페이지 2개

**Files:**
- Create: `apps/web/src/pages/invite-accept.tsx` · `invite-accept.test.tsx` · `reset-password.tsx` · `reset-password.test.tsx`
- Modify: `apps/web/src/routes.tsx`

**Interfaces:**
- Consumes: Task 2·3의 `invitation.peek`·`invitation.accept`·`auth.resetPassword`
- Produces: `/invite/:token` · `/reset/:token` 라우트

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`admin.test.tsx:1-33`의 `renderAdmin` 패턴을 그대로 쓴다(`createRoutesStub` + `mockTrpcFetch`).
`initialEntries`에 토큰이 든 경로를 준다.

⚠️ **`invitation.peek`은 query가 아니라 mutation이다**(설계 §3.5 — query면 토큰이 GET URL에 실린다).
`useQuery`로는 부를 수 없으므로 **`useMutation`으로 부르고, 마운트 시 `useEffect`에서 한 번 호출한다.**
로딩·에러 상태도 `useQuery`가 주는 것이 아니라 mutation의 `isPending`/`error`로 다룬다.

**초대 수락**(각각 `it`): peek 결과(이메일·조직명)가 보인다 · 이름·비밀번호를 넣고 제출하면 `accept`가
그 값으로 불린다 · 죽은 토큰이면 사유가 보이고 폼이 없다 · 성공하면 `/login`으로 간다 ·
**조직 없는 초대면 조직 문구가 안 나온다**.

**재설정**: 폼이 보인다 · 제출이 `auth.resetPassword`를 부른다 · 죽은 토큰 안내 · 성공 후 `/login`.

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인**

`routes.tsx`에 `Protected` **없이** 추가한다(`/login`과 같은 급):

```tsx
{ path: '/invite/:token', element: <InviteAcceptPage /> },
{ path: '/reset/:token', element: <ResetPasswordPage /> },
```

```bash
pnpm --filter @erdd/web exec vitest run
pnpm -s -C apps/web typecheck; echo "EXIT=$?"
```
Expected: web **392 내외**(382 + 10, 실측해 보고) · EXIT=0.

- [ ] **Step 5: 구분력 확인** — `routes.tsx`의 두 라우트를 `Protected`로 감싸 본다 → 해당 테스트가
FAIL해야 한다(로그인 리다이렉트). 확인 후 복구. **FAIL하지 않으면 그 테스트는 비보호를 검증하지
않는 것이므로 보고하라.**

- [ ] **Step 6: 커밋**

---

## Task 5: 웹 — 조직 초대 섹션 · 관리자 화면 교체

**Files:**
- Modify: `apps/web/src/pages/org-detail.tsx` · `apps/web/src/pages/admin.tsx` · `apps/web/src/pages/admin.test.tsx`
- Create: `apps/web/src/pages/org-detail.test.tsx`(없으면 신규)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

**조직 초대 섹션**: 이메일·역할을 넣고 생성하면 링크가 뜬다 · "지금만 볼 수 있다" 문구가 있다 ·
대기 목록과 만료 시각 · 취소 · **매니저가 아니면 섹션이 안 보인다**.

**관리자 화면**: 계정 생성이 링크를 낸다 · **비밀번호 입력란이 하나도 없다**(§3.1을 UI에서 고정) ·
재설정이 링크를 낸다.

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인**

Expected: web **402 내외**(실측해 보고) · EXIT=0.

- [ ] **Step 5: 구분력 확인** — 관리자 화면에 비밀번호 입력란을 되살려 본다 → "입력란이 없다" 테스트가 FAIL. 복구.

- [ ] **Step 6: 커밋**

---

## Task 6: 문서

**Files:** `docs/18-account.md` · `docs/91-checklist.md` · `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 전체 스위트로 최종 수치를 확정한다**

```bash
set -a && . <격리 env> && set +a && pnpm verify 2>&1 | grep -E "Test Files|Tests  "
```
**수가 계획의 예상과 다르면 그대로 기록하고 왜 다른지 보고한다.**

- [ ] **Step 2: `18-account.md`** — "셀프 가입, 이메일 인증, 비밀번호 재설정 메일은 비범위" 문단과
"관리자 페이지: 계정 생성(초기 비밀번호 지정)"·"비밀번호 재설정(새 초기 비밀번호 지정)"을 새 동작으로
고친다. "초대 링크(미가입자 포함)는 메일 인프라와 함께 추후 검토"도 해소로 바꾼다. **메일은 여전히
비범위임을 분명히 남긴다.**

- [ ] **Step 3: `91-checklist.md`** — 계정·온보딩 항목을 갱신한다.

- [ ] **Step 4: `HANDOFF.md`** — 1절 기준선(Step 1 실측값) · 완료 표에 이번 사이클 행 · "다음 작업"에서
1번(셀프 가입·초대 메일·비밀번호 재설정) 제거 후 나머지 승격 · 3절에 불변식 추가(공개 프로시저 3개
목록, `createAccount`의 트랜잭션 계약, 재발급이 이전 토큰을 죽인다) · 6절에 설계 §9의 이월 항목.

- [ ] **Step 5: 커밋**

---

## 최종 리뷰 (컨트롤러가 태스크 6개 뒤에 디스패치)

필수 질문을 그대로 넣는다: **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽
호출자 기준으로 그 함수의 불변식을 재유도하라."**

이번 브랜치의 후보(리뷰어가 스스로 찾아야 하므로 프롬프트에는 넣지 않는다): `createAccount`
(`ensureBootstrapAdmin`·`admin.users.invite` 수락 경로 vs `invitation.accept`의 tx 경로),
`generateToken`(접두 인자 추가), `hashToken`(액세스 토큰 vs 두 새 토큰), `normalizeEmail`.

추가로 확인할 것:
- **공개 프로시저가 정확히 셋인가.** 라우터 전체를 훑어 `dbProcedure`/`publicProcedure`를 쓰는 것을
  나열하고 설계 §3.5 표와 대조한다.
- **평문 토큰이 발급 응답 외의 경로로 새는가.** 목록·조회·에러 메시지·로그를 본다.
- **평문 비밀번호를 받는 표면이 남았는가**(`auth.login`·`changePassword`·`accept`·`resetPassword`·
  부트스트랩 외에 없어야 한다).
- typecheck를 종료코드로 판정했는지.

이후 컨트롤러가 **CLI가 아닌 브라우저 스모크**를 한다(확장이 한 프로필에만 있어 워커가 못 한다).
대조군을 함께 돌린다 — 초대 링크로 가입 → 로그인 → 재설정 링크로 비밀번호 변경 → 옛 비밀번호로
로그인 실패 확인.

## 자체 리뷰 결과

**1. 설계 커버리지**

| 설계 절 | 태스크 |
|---|---|
| §2.1 초대 기반 | 2(create/accept) · 4(수락 화면) |
| §2.2 메일 없음 | 전 태스크(발송 코드 없음) · 5(링크 노출 UI) |
| §2.3 관리자 발급 | 3(resetLink) · 5(관리자 화면) |
| §2.4 기존 경로 교체 | 3 — **라우터 표면 단언**이 이것을 잠근다 |
| §3.2 토큰 규칙·재발급 | 1(만료·1회용) · 2·3(재발급이 이전 것을 죽인다) |
| §3.3 이미 가입한 이메일 | 2(양쪽 시점) |
| §3.4 원자성 | 2(Step 2의 16번, 실패 주입 가능 여부 확인 조건부) |
| §3.5 공개 3개 | 2·3 구현 · 최종 리뷰가 표와 대조 |
| §4 스키마 | 1 |
| §5·§6 | 2·3(서버) · 4·5(웹) |
| §9 이월 | 6 |

**2. 플레이스홀더** — Task 3·4·5의 Step 2~4를 "실패 확인 → 구현 → 통과 확인"으로 묶었다. Task 1·2에
전체 형태(테스트 코드·구현·구분력·커밋)를 상세히 적었고 나머지는 같은 구조를 반복하므로, 각 태스크의
**테스트 목록과 구분력 확인 대상은 빠짐없이 명시**했다. 구현 코드를 전부 적지 않은 것은 기존 파일의
패턴(`admin.test.tsx`의 `renderAdmin`, `org.ts`의 `requireOrgManager`)을 그대로 따르기 때문이고,
브리프가 그 파일:줄을 지목한다.

**3. 타입 일관성** — `issueToken(kind)`의 `TokenKind`는 `'invitation'|'reset'`이고 `tokenExpiry`도 같은
타입을 받는다. `assertLive`는 `{expiresAt: Date; usedAt: Date|null}`만 요구하므로 두 테이블 행이 모두
맞는다. `invitations.orgRole`은 `'admin'|'member'`(owner 없음), `userRole`은 `'admin'|'user'`로 서로
다른 축이다 — 구현에서 섞이지 않게 이름을 다르게 뒀다.

**4. 미확정 1건** — Task 2 Step 2의 16번(원자성 테스트)은 조직 cascade 때문에 가짜 통과가 될 수
있어 **구현자가 실측해 판단하고 보고**하도록 남겼다. 계획이 답을 정하지 못한 유일한 지점이고, 그
이유(cascade 동작을 문서로만 보고 단정할 수 없다)를 브리프에 적었다.
