# 초대 링크·비밀번호 재설정 링크 설계 — 평문 비밀번호를 관리자 손에서 없앤다

**작성일:** 2026-08-06
**상태:** 승인됨 (brainstorming 4문항 모두 권장안 채택)
**관련 기획:** docs/18-account.md "추후 검토"의 셀프 가입·초대·비밀번호 재설정 메일

## 1. 목적과 범위

지금은 사람이 이 도구에 들어오는 길이 하나뿐이다 — **관리자가 계정을 만들고 초기 비밀번호를 정해
당사자에게 전달한다.** 비밀번호를 잊으면 관리자가 새 비밀번호를 정해 다시 전달한다. 실배포 마찰이
가장 큰 지점이고, 동시에 **관리자가 남의 평문 비밀번호를 아는 상태**가 구조적으로 만들어진다.

이 사이클은 그 두 경로를 **일회용 링크**로 바꾼다. 관리자는 링크를 만들어 전달할 뿐이고, 비밀번호는
본인만 정한다.

**범위:** 일회용 토큰 2종(초대·재설정, 마이그 0012) · 초대 생성/조회/취소 · 초대 수락(계정 생성 +
조직 합류) · 재설정 링크 발급과 재설정 · 관리자 화면과 조직 화면의 해당 동선 · 비보호 라우트 2개.

**범위 밖:** **메일 발송 일체**(§2.2) · 완전 개방 셀프 가입 · 도메인 허용목록 · 가입 요청 승인 큐 ·
소셜 로그인 · 승격 요청 큐의 알림(메일이 없으므로 이번에 얹을 것이 없다).

**core 변경 없음. CLI 변경 없음. 새 op 엔티티 없음. 마이그레이션 0012 하나.**

## 2. 확정된 결정 (사용자 확정)

### 2.1 가입은 초대 기반만이다

아무나 가입하지 못한다. 관리자 또는 Org Owner/Admin이 이메일로 초대를 만들면, 미가입자가 그 링크로
들어와 **이름과 비밀번호를 직접 정해** 계정을 만든다. 로드맵의 "셀프 가입(이메일 인증)"은 이 형태로
흡수된다 — 조직 내부 도구라는 성격을 유지하면서 관리자가 초기 비밀번호를 만들어 전달하는 마찰만
없앤다.

### 2.2 메일을 보내지 않는다. 링크만 만든다

발송 인프라를 붙이지 않는다. 초대·재설정 링크는 **화면에 뜨고 관리자가 복사해 전달**한다(슬랙·구두 등
이미 쓰는 경로). 메일 발송자 선택·도메인 인증·발송 실패 처리·개발 환경의 발송 차단이 전부 범위 밖이
되어 이 사이클이 작아지고, 나중에 메일을 붙일 때는 **이 설계의 토큰·화면을 그대로 두고 발송 한 겹만**
얹으면 된다.

**이 결정이 포기하는 것을 분명히 한다.** 비밀번호를 잊은 사용자가 스스로 복구할 수는 없다 — 관리자에게
알려야 한다(§2.3). 얻는 것은 마찰 감소가 아니라 **평문 비밀번호가 시스템에서 사라지는 것**이다(§3.1).

### 2.3 재설정은 관리자가 링크를 발급한다

사용자가 관리자에게 알리면 관리자가 계정 화면에서 재설정 링크를 만들어 전달한다. 로그인 화면에
"비밀번호 찾기"를 두지 않는다 — **미인증 공개 엔드포인트**가 생겨 계정 존재 여부 탐색과 스팸 표면이
되는데, 메일이 없어 어차피 관리자가 링크를 전달해야 하므로 그 대가를 치를 이유가 없다.

### 2.4 기존 "계정 생성(초기 비밀번호 지정)"을 링크 발급으로 교체한다

`admin.users.create`의 `initialPassword`와 `admin.users.resetPassword`의 `newPassword`를 없앤다.
남겨 두면 이 사이클이 없애려는 경로가 그대로 살아 **같은 일을 하는 경로가 둘**이 되고, "평문 비밀번호가
없다"는 성질이 절반만 성립한다.

**유일한 예외는 부트스트랩 관리자다.** `ADMIN_EMAIL`/`ADMIN_PASSWORD` 환경변수로 첫 계정을 만드는
경로는 유지한다 — 초대할 사람이 아직 없는 시점이라 구조적으로 필요하다.

## 3. 의미 모델

### 3.1 이 사이클의 성질은 "관리자가 남의 비밀번호를 모른다"이다

변경 후 평문 비밀번호가 존재하는 지점은 셋뿐이다: 본인이 로그인 폼에 입력할 때, 본인이 초대 수락·재설정
화면에서 정할 때, 부트스트랩 환경변수. **관리자 화면에는 비밀번호 입력란이 하나도 남지 않는다.**

마찰 감소는 부수 효과다 — 관리자가 여전히 링크를 전달해야 하므로 왕복 횟수는 크게 줄지 않는다.

### 3.2 토큰은 액세스 토큰과 같은 규칙을 따른다

`erdd_pat_`(기존)에 이어 **`erdd_inv_`**(초대) · **`erdd_rst_`**(재설정)를 쓴다. 평문 접두 + 랜덤
본문이고 **DB에는 SHA-256만 저장**하며 **평문은 발급 응답에서만 나간다**(`auth/token.ts`의
`generateToken`/`hashToken` 재사용). 링크를 잃으면 조회가 아니라 **재발급**이다.

| | 만료 | 1회용 | 취소 | 재발급 시 |
|---|---|---|---|---|
| 초대 | 7일 | `usedAt` | 가능 | 같은 (email, org)의 미사용 초대를 만료시킨다 |
| 재설정 | 24시간 | `usedAt` | 가능 | 같은 사용자의 미사용 토큰을 만료시킨다 |

**재발급이 기존 미사용 토큰을 무효화하는 것이 핵심이다.** 관리자가 두 번 발급하면 첫 링크가 살아 있고,
그것이 어디로 갔는지는 아무도 모른다.

**단, 동시 발급은 막지 않는다.** 위 무효화는 "이전 것을 만료시킨 뒤 새로 넣는다"이므로 **순차 재발급에만**
성립한다. 같은 (email, org)로 `create`가 동시에 두 번 들어오면 READ COMMITTED에서 서로의 미커밋
INSERT를 보지 못해 만료 UPDATE가 상대를 놓치고, **살아 있는 초대가 둘 남는다.** 이것을 감수하는 이유는
피해가 갇혀 있기 때문이다 — `accept`의 이메일 재검사(§3.3)와 유니크 제약이 두 번째 수락을 CONFLICT로
막으므로 **계정이 둘 생기지는 않는다.** 남는 것은 관리자 목록에 죽지 않은 링크가 둘 보이는 혼란뿐이고,
그 값이 `pg_advisory_xact_lock` 을 넣어 발급 경로를 직렬화하는 비용보다 작다.

**"취소: 가능"은 관리자 초대에도 성립한다.** 취소 경로가 두 개인 것은 **권한 축이 다르기** 때문이다 —
조직 초대(`orgId` 있음)는 그 조직의 매니저가 `invitation.revoke`로, 관리자 초대(`orgId`가 null)는
서비스 관리자가 `admin.invitations.revoke`로 취소한다. 한 프로시저로 합치면 `orgId` 유무에 따라 권한
판정이 갈라지고, 그 분기는 "orgId를 빼면 관리자 검사로 넘어간다"가 되어 조직 매니저가 관리자 초대에
닿을 틈이 된다. 조회도 같은 이유로 갈라져 있다(`invitation.listForOrg` / `admin.invitations.list`, §5.4).
**둘 다 자기 묶음 밖은 건드리지 못한다** — 관리자 경로는 `orgId IS NULL`을, 조직 경로는 그 `orgId`를
UPDATE 조건에 함께 넣는다.

**부분 유니크 인덱스는 답이 아니다.** "(email, org)에 `usedAt IS NULL`인 행은 하나"로 막으려 해도,
취소·재발급으로 **만료시킨 옛 행도 `usedAt`은 NULL**이다(만료는 `expiresAt`을 당길 뿐 `usedAt`을
채우지 않는다). 그 인덱스를 걸면 정상적인 재발급 자체가 막힌다.

### 3.3 이미 가입한 이메일은 초대 대상이 아니다

초대는 **계정을 만드는 것**이므로, 이미 가입한 이메일에는 만들 수 없다.

- `invitation.create` 시점에 검사해 CONFLICT로 거절하고 "이미 가입한 사용자입니다 — 멤버 추가를
  쓰세요"로 안내한다(기존 `org.members.add`가 그 일을 한다).
- `invitation.accept` 시점에 **다시 검사한다.** 초대를 만든 뒤 수락까지 사이에 그 이메일이 가입할 수
  있다. 이때도 CONFLICT다 — 초대는 소비되지 않고 남는다(관리자가 취소하거나 멤버 추가로 처리한다).

### 3.4 계정 생성과 조직 합류는 한 트랜잭션이다

`invitation.accept`는 사용자·개인 조직·owner 멤버(= `createAccount`가 하는 일) **더하기** 초대한
조직의 멤버 행 **더하기** 초대 소비(`usedAt`)를 한 트랜잭션으로 처리한다. 중간에 끊기면 "계정은
생겼는데 조직에 못 들어간" 상태가 되고, 초대가 소비됐다면 복구 경로가 없다.

**그래서 `createAccount`가 트랜잭션을 받을 수 있어야 한다.** 지금은 함수 안에서 `db.transaction`을
직접 연다(`services/accounts.ts:23`). 시그니처를 넓혀 **호출자가 연 트랜잭션 위에서 돌 수 있게** 한다 —
`runMutation`이 `MutationTx`를 받는 것과 같은 패턴이다.

> ⚠️ **이번 브랜치에서 두 번째 호출자가 생기는 기존 함수가 `createAccount`다.** 기존 호출자는
> `admin.users.create`(교체 후 `invite`)와 `ensureBootstrapAdmin`이고, 둘은 자체 트랜잭션을 기대한다.
> 새 호출자는 자기 트랜잭션 안에서 부른다. **최종 리뷰의 필수 질문 대상이다** — 양쪽 호출자 기준으로
> 불변식(개인 조직이 반드시 함께 생긴다, 이메일 정규화가 한 곳에서만 일어난다)을 재유도해야 한다.

### 3.5 공개 프로시저는 정확히 셋이고 토큰 없이는 아무것도 못 한다

`trpc.ts`의 주석이 정한 규칙("새 프로시저의 기본은 `authedProcedure` — fail-closed")에 대한 예외를
만드는 것이므로, **목록을 여기에 못 박는다.**

| 프로시저 | 무엇을 하나 | 토큰 없이 |
|---|---|---|
| `invitation.peek` | 초대의 이메일·조직명만 반환 | 아무것도 못 한다 |
| `invitation.accept` | 계정 생성 + 조직 합류 | 〃 |
| `auth.resetPassword` | 비밀번호 교체 + 세션 전부 삭제 | 〃 |

**셋 다 mutation(POST)으로 노출한다 — `peek`도 예외가 아니다.** 이 저장소의 tRPC query는 input을 GET
URL의 쿼리스트링에 싣는다(`?input=…`). `peek`을 query로 만들면 토큰이 요청 URL에 평문으로 실려
역방향 프록시·접근 로그에 남는다. `peek`은 읽기만 하므로 의미상 query가 자연스럽지만, 그 자연스러움보다
토큰을 URL 밖에 두는 것이 우선이다.

셋 다 `dbProcedure`(세션 불필요, DB 필요 — `auth.login`과 같은 급)를 쓴다. **셋 모두 유효한 토큰을
유일한 입력 자격으로 삼고, 토큰은 해시로만 조회되므로 열거할 수 없다.** `peek`이 초대 정보를 노출하지만
그 토큰을 이미 가진 사람에게만이다.

**네 번째를 추가하려면 이 표를 고쳐야 한다.** 표에 없는 공개 프로시저는 규칙 위반이다.

## 4. 데이터 (마이그 0012)

```ts
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),                    // normalizeEmail 적용 후 저장
  // null이면 "조직 합류 없는 초대"다 — 관리자 페이지가 만드는 계정 전용 초대(§5.4).
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

**한 테이블로 합치지 않는 이유:** 초대는 **아직 `user`가 없어** `email`이 식별자이고 `userId`를 가질
수 없다. 재설정은 반대로 `userId`가 필수이고 `email`을 따로 둘 이유가 없다. 합치면 두 필드가 모두
nullable이 되어 **"둘 다 null"과 "둘 다 채워진" 불가능한 상태가 타입에 표현되고**, 어느 쪽인지
판정하는 `kind` 컬럼과 그 분기가 조회마다 따라붙는다. cascade 대상도 다르고(조직 삭제 / 사용자 삭제)
조회 경로도 완전히 다르다(조직 화면 / 관리자 화면). 공유해야 할 것은 스키마가 아니라 **만료·1회용
판정 로직**이고, 그것은 §5.1이 함수 하나로 모은다.

**`orgRole`에 `owner`가 없는 것은 의도다** — 초대로 소유권을 넘기지 않는다(`org.members.setRole`의
기존 규칙과 같다).

## 5. 서버

### 5.1 `services/one-time-token.ts` (신규) — 두 토큰이 공유하는 것

```ts
export type TokenKind = 'invitation' | 'reset'

export function issueToken(kind: TokenKind): { plain: string; hash: string }
export function tokenExpiry(kind: TokenKind): Date                    // 7일 / 24시간
/** 만료·사용됨을 한 곳에서 판정한다. 살아 있지 않으면 사유를 담아 던진다. */
export function assertLive(row: { expiresAt: Date; usedAt: Date | null }): void
```

세 함수가 같은 `TokenKind`를 받는다 — 접두(`erdd_inv_`/`erdd_rst_`)는 이 함수 안에서 종류로부터
정해진다. 호출자가 접두 문자열을 직접 넘기면 `issueToken`과 `tokenExpiry`의 인자 어휘가 갈린다.

만료·1회용 판정이 두 곳에 흩어지면 한쪽만 고쳐질 수 있다. `assertLive` 하나만 쓴다.

### 5.2 `services/accounts.ts` — `createAccount`가 트랜잭션을 받는다

```ts
type AccountTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export async function createAccount(
  db: Db | AccountTx,
  input: { email: string; name: string; password: string; role: 'admin' | 'user' },
  opts?: { inTransaction?: boolean },   // true면 자체 transaction을 열지 않는다
): Promise<{ id: string; email: string }>
```

정확한 형태는 구현에서 정한다(drizzle이 tx를 그대로 받아 중첩을 savepoint로 처리하면 `opts` 없이도
된다 — **구현자가 실측해 더 단순한 쪽을 고르고 근거를 보고한다**). 지켜야 할 것은
**개인 조직 생성이 계정 생성과 갈라지지 않을 것**이다.

**이메일 정규화는 이 함수 안에서만 일어나지 않는다** — 초대가 들어오면서 갈라졌다. `normalizeEmail`은
한 곳에 있지만 **정규화된 값을 저장하는 자리는 셋이다**: `createAccount`(→ `users.email`),
`invitation.create`와 `admin.users.invite`(→ `invitations.email`). 초대 행은 계정보다 먼저 만들어지고
`accept`는 그 행의 이메일로 계정을 만들므로, 초대 쪽이 정규화를 빼먹으면 `users`와 `invitations`의
키가 갈린다.

- **규칙을 바꾸면 세 곳이 함께 바뀌어야 한다.** 함수는 하나여서 호출만 고치면 될 것처럼 보이지만,
  이미 저장된 값은 **그때의 규칙으로 정규화된 채 남아 있다** — 컬럼 둘에 대해 각각 마이그레이션이
  필요한지 따져야 한다.
- **`accept`의 재검사 키와 저장 키가 갈릴 수 있다.** `accept`는 `users.email = inv.email`로 기존 계정을
  재검사하는데(초대 행에 **저장된 값** 그대로), 계정은 `createAccount`가 `normalizeEmail(inv.email)`로
  만든다(**지금의 규칙**). 규칙이 바뀐 뒤 옛 초대가 수락되면 두 키가 달라져, 재검사는 통과했는데
  INSERT가 유니크 제약에 걸릴 수 있다(그 경우도 409로 떨어지도록 unique 위반을 잡아 두었다 — §9).

### 5.3 `routers/invitation.ts` (신규)

| 프로시저 | 권한 | 하는 일 |
|---|---|---|
| `create` | Org Owner/Admin (`requireOrgManager`) | §3.3 검사 → 같은 (email, org) 미사용 초대 만료 → 발급. **평문 토큰은 여기서만 반환**. **`userRole`은 항상 `'user'`** — 조직 관리자가 서비스 역할을 올릴 수 없다(서비스 admin을 만드는 것은 §5.4의 관리자 초대뿐이다) |
| `listForOrg` | Org Owner/Admin | 대기·만료·사용됨 목록(평문 토큰 없음) |
| `revoke` | Org Owner/Admin | `expiresAt`을 현재로 당긴다. 조건부 UPDATE로 이미 사용된 것은 못 건드린다 |
| `peek` | **공개** | 토큰 → `{ email, orgName, orgRole }`(조직 없는 초대면 둘 다 `null`). `assertLive`. **`userRole`은 내보내지 않는다** — 수락자가 알 이유가 없고 화면에도 쓰지 않는다. **query가 아니라 mutation(POST)으로 노출한다** — query면 토큰이 GET URL에 실려 프록시·접근 로그에 남는다(§3.5) |
| `accept` | **공개** | 토큰 + `name` + `password` → 계정 + 조직 합류 + 소비. §3.4 한 트랜잭션 |

`create`는 개인 조직을 거부한다(`org.members.add`와 같은 규칙 — `kind === 'personal'`이면 FORBIDDEN).

### 5.4 `routers/admin.ts` — 교체

- `users.create`(`initialPassword`) → **`users.invite`**: 이메일·서비스 역할을 받아 계정 없이
  **초대만** 만든다. **`orgId`는 `null`이다**(§4) — 관리자가 사람을 시스템에 넣는 것과 조직에 넣는
  것은 별개 행위이고, 조직을 필수로 하면 "아직 소속이 정해지지 않은 사람"을 표현할 수 없다. 기존
  `users.create`도 조직과 무관하게 계정만 만들었으므로 동선이 그대로 유지된다.
  - **이름은 수락자가 정한다. 초대 시점에 관리자가 적지 않는다.** 초대 행에 `name`을 두지 않고
    `accept`가 받는 이름을 쓴다 — 그래야 초대 행이 "누구에게 어떤 자격을 준다"만 담고 프로필 정보를
    들고 있지 않는다. 초대 행에 자리가 없으므로 **관리자가 적은 이름을 수락 화면까지 나를 매체도
    없다** — 프리필을 하려면 스키마부터 바꿔야 한다(§9 이월).
  - 서비스 역할(`admin`/`user`)은 **초대 행에 담는다.** 수락자가 정할 수 없어야 하기 때문이다.
    → `invitations.userRole`(`enum: ['admin','user']`, `notNull`, 기본 `'user'`)을 §4 스키마에 함께 둔다.
  - 응답은 `{ id, token, expiresAt }`이다. 만료 시각을 함께 주는 것은 링크를 전달하는 관리자가
    "언제까지 유효한지"를 말할 수 있어야 하기 때문이다.
- `users.resetPassword`(`newPassword`) → **`users.resetLink`**: 같은 사용자의 미사용 토큰을 만료시키고
  새 토큰을 발급해 평문을 반환한다. **세션 삭제는 여기서 하지 않는다** — 링크를 만들었을 뿐 아직
  비밀번호가 바뀌지 않았다. 세션 삭제는 `auth.resetPassword` 성공 시점이다.
  - **비활성 계정은 BAD_REQUEST로 거절한다**("비활성 계정입니다 — 먼저 활성화하세요"). 링크를 내주면
    비밀번호는 실제로 바뀌지만 로그인은 `auth.login`의 `isActive`에서 막히므로, 관리자가 "재설정해
    줬는데 왜 안 되지"를 겪고 원인이 어디에도 나오지 않는다. 발급 시점에 거절해야 다음 행동(활성화)이
    화면에 보인다.
- **`admin.invitations` 추가** — 관리자 초대(`orgId`가 null) 전용이다. 조직 초대의 것과 합치지 않는
  이유는 §3.2에 있다.

  | 프로시저 | 권한 | 하는 일 |
  |---|---|---|
  | `invitations.list` | 서비스 관리자 | `orgId IS NULL`인 초대 목록(`email`·`userRole`·`expiresAt`·`usedAt`). **평문 토큰도 해시도 나가지 않는다** |
  | `invitations.revoke` | 서비스 관리자 | `expiresAt`을 현재로 당긴다. 조건부 UPDATE(`orgId IS NULL AND usedAt IS NULL`)라 조직 초대도, 이미 사용된 초대도 못 건드린다 |

  이 둘이 없으면 §3.2 표의 초대 "취소: 가능"이 관리자 초대에만 성립하지 않고, 관리자 화면(§6.3)이
  자기가 낸 초대를 볼 방법이 없다.

### 5.5 `routers/auth.ts` — `resetPassword` 추가 (공개)

토큰 + 새 비밀번호 → `assertLive` → 비밀번호 교체 + `usedAt` 기록 + **그 사용자의 세션 전부 삭제**를
한 트랜잭션으로. 기존 `changePassword`(로그인 상태)는 그대로 둔다.

## 6. 웹

### 6.1 비보호 라우트 2개

`routes.tsx`에 `/login`과 같은 급으로 추가한다(`Protected` 감싸지 않음).

- **`/invite/:token`** — `peek`으로 이메일·조직을 보여주고 이름·비밀번호를 받아 `accept`. 성공하면
  로그인 화면으로 보낸다(자동 로그인하지 않는다 — 세션 발급 경로를 `auth.login` 하나로 유지한다).
- **`/reset/:token`** — 새 비밀번호를 받아 `auth.resetPassword`. 성공하면 로그인 화면으로.

둘 다 토큰이 죽었을 때(만료·사용됨·없음) **같은 화면에서 사유와 다음 행동을 보여준다.** 사유별로
다른 문구를 쓰되 "토큰이 존재하지 않음"과 "만료됨"을 구분하지 않는다(존재 오라클). 다음 행동은
갈래에 따라 갈린다 — 아래 표.

**오류에는 갈래가 둘이고, 폼을 지우는 것은 종료성 갈래뿐이다.** 판정 기준은 "오류가 있는가"가 아니라
**"다시 제출해도 결과가 같은가"**다.

| 갈래 | 무엇 | 화면 |
|---|---|---|
| 종료성 `dead` | 없는·기한이 지난·취소된 초대 토큰, 없는·기한이 지난·**이미 사용된 재설정 토큰** | 폼을 지우고 사유 + "관리자에게 문의해 새 링크를 받으세요" |
| 종료성 `registered` | **이미 사용된 초대 토큰**, 이미 가입한 이메일(`accept`의 `CONFLICT`) | 폼을 지우고 사유 + **로그인 안내**(아래) |
| 비종료성 | 그 밖 전부 — 네트워크 단절, 5xx, `PRECONDITION_FAILED`, **입력 검증(zod) 실패** | **폼을 유지**하고 인라인 오류 + 재시도 |

**두 종료성 갈래를 가르는 것은 "다시 받을 수 있는가"다**(`data.linkReissuable`, 기본 `true`).
`dead`는 관리자가 새 링크를 실제로 낼 수 있는 갈래이고, `registered`는 그 이메일에 이미 계정이 있어
**새 링크가 존재할 수 없는** 갈래다. 사유(`이미 사용됨`)가 아니라 종류가 기준인 것에 주의하라 —
같은 "이미 사용됨"이라도 초대와 재설정이 갈린다(바로 아래).

**판정 근거는 오류 코드가 아니라 서버가 명시한 표식이다.** `BAD_REQUEST`로는 갈릴 수 없다 —
zod 입력 검증 실패도 같은 코드로 오는데 그것은 링크가 아니라 입력이 틀렸다는 뜻이다(실측 2026-08-08:
`auth.resetPassword`에 7자 비밀번호를 보내면 `BAD_REQUEST` + zod issue JSON 배열 문자열이 오는데
**같은 토큰으로 곧바로 다시 보내면 200이다**; `invitation.accept`도 같다). 그래서 서버가
`services/one-time-token.ts`의 `LinkDeadError`로 던진 것만 응답 `data.linkDead: true`를 달고
(`trpc.ts`의 errorFormatter가 모든 오류에 이 필드를 싣는다) 화면은 그것만 본다.

**표식을 종료성 쪽에 다는 것이 허용 목록이다 — 모르는 오류는 비종료성으로 떨어진다.** 오분류의
대가가 한쪽으로만 크기 때문이다.
일시적 오류를 종료성으로 보면 **살아 있는 토큰이 죽은 것으로 표시되고** 폼과 입력이 사라져 회복
경로가 새로고침뿐이 된다(초대 화면은 입력한 이름까지 잃는다). 더 나쁘게는 `accept`가 서버에서 커밋된
뒤 응답만 유실되면 계정은 만들어졌는데 화면이 "링크가 죽었다"고 말한다. 반대 방향의 오분류는
사용자가 한 번 더 눌러 같은 사유를 다시 보는 것뿐이다.

**계정이 이미 있는 갈래에는 새 링크를 안내하지 않는다.** 그 이메일로는 초대를 다시 만들 수 없다 —
`admin.users.invite`와 `invitation.create`가 둘 다 409로 거절한다. 새 링크는 **존재할 수 없으므로**
그 갈래의 다음 행동은 로그인이다. 여기 오는 것은 둘이다.

- **소비된 초대 링크를 다시 연 경우**(실측 2026-08-09). 가입을 마친 사용자가 북마크·메일로 링크를
  다시 여는 **가장 흔한 경로**다. `peek`이 "이미 사용된 링크입니다"로 거절하는데, `accept`는
  계정 생성과 `usedAt` 설정이 **한 트랜잭션**이므로(§3.4) `usedAt`이 있으면 그 이메일의 계정이
  반드시 만들어졌다 — 그래서 재발급이 막힌다.
- **수락이 "이미 가입한 이메일"로 거절된 경우**(실측 2026-08-08: 같은 이메일의 관리자 초대와 조직
  초대가 함께 살아 있을 때 하나를 수락해 계정이 생기면, 남은 링크의 `peek`은 200인데 `accept`는
  409다).

**재설정 링크의 "이미 사용됨"은 이 갈래가 아니다.** 계정이 있으므로 관리자가
`admin.users.resetLink`로 새 링크를 낼 수 있다(실측 2026-08-09: 200). 여기까지 넓히면 실제로 가능한
회복 경로를 화면이 부정하게 되고, 비밀번호를 모르는 사람을 로그인 화면으로 보내게 된다.
**기한이 지난·취소된 초대도 이 갈래가 아니다** — 그 이메일에 계정이 아직 없을 수 있고, 없으면
관리자가 새 초대를 만든다(실측: 취소된 초대의 이메일로 재발급 200).

이 갈래도 **코드로도 message 문자열로도 갈릴 수 없다** — 소비된 초대와 기한이 지난 초대가 둘 다
`BAD_REQUEST` + `linkDead: true`로 오고 message만 다르다. 그래서 서버가 `LinkDeadError`의
`reissuable`로 명시하고, **기본값은 `true`(= 약한 주장인 "관리자에게 문의")**다. 표식은 "다시 받을 수
없다"는 **더 센 주장** 쪽에만 단다 — 새 사유가 추가되면 자동으로 늘 참인 안내로 떨어지고, 반대로
기본값을 뒤집으면 새 사유가 조용히 회복 경로를 부정한다.

판정은 `apps/web/src/lib/link-error.ts`의 `terminalLinkFailure` 한 곳에 있다. 초대 화면의 `peek`은
마운트 1회로 묶여 있으므로(설계 §3.5의 mutation 처리) **비종료성 실패에는 재시도 버튼을 따로 준다** —
없으면 그 화면이 영구히 멈춘다.

### 6.2 조직 상세 — 초대 섹션

멤버 섹션 아래에 둔다. 초대 생성(이메일 + 역할) → **링크가 뜨고 복사 버튼**, 대기 목록(만료 시각 표시)과
취소. 생성 직후 한 번만 보이는 것을 화면 문구로 알린다("이 링크는 지금만 볼 수 있습니다").

### 6.3 관리자 화면

계정 생성 폼에서 비밀번호 입력란을 없애고 링크 결과를 보여준다. 계정 목록의 "비밀번호 재설정"이 링크
발급으로 바뀐다.

## 7. 파일 구조

| 파일 | 변경 |
|---|---|
| `apps/server/src/db/schema.ts` | 테이블 2개 |
| `apps/server/drizzle/0012_*.sql` | 마이그레이션 |
| `apps/server/src/services/one-time-token.ts` | 신규 |
| `apps/server/src/services/accounts.ts` | `createAccount`가 tx 수용 |
| `apps/server/src/routers/invitation.ts` | 신규 |
| `apps/server/src/routers/admin.ts` | `invite`·`resetLink`로 교체 |
| `apps/server/src/routers/auth.ts` | `resetPassword` 추가 |
| `apps/server/src/router.ts` | `invitation` 라우터 등록 |
| `apps/server/src/testing/db.ts` | `TEST_TABLES`에 새 테이블 2개 |
| `apps/web/src/routes.tsx` | 비보호 라우트 2개 |
| `apps/web/src/pages/invite-accept.tsx` · `reset-password.tsx` | 신규 |
| `apps/web/src/pages/org-detail.tsx` | 초대 섹션 |
| `apps/web/src/pages/admin.tsx` | 폼 교체 |
| `docs/18-account.md` · `docs/91-checklist.md` | 사양 갱신 |

## 8. 테스트 전략

기준선: **core 463 · cli 138 · web 382 · server 143 · typecheck EXIT=0**

### 8.1 server

- **토큰 수명:** 만료된 초대·재설정이 거부된다 · 사용된 토큰이 재사용되지 않는다 · 취소된 초대가 거부된다.
- **재발급이 이전 토큰을 죽인다** — 초대·재설정 각각. 이것이 §3.2의 핵심이라 **두 링크가 동시에 살아
  있지 않다**를 직접 단언한다.
- **§3.3 양쪽 시점:** `create`가 기존 사용자를 거부한다 · **초대 생성 후 그 이메일이 가입하면
  `accept`가 CONFLICT이고 초대가 소비되지 않는다**(사이에 끼어드는 경우).
- **§3.4 원자성:** 조직 멤버 insert가 실패하면 계정도 생기지 않는다(실패 주입).
- **권한:** 조직 매니저가 아닌 멤버가 `create`/`revoke` 못 한다 · 다른 조직의 초대를 못 본다 ·
  개인 조직에 초대를 못 만든다.
- **§3.5 공개 표면:** 세 프로시저가 세션 없이 동작하고, **그 외 새 프로시저는 세션 없이 거부된다.**
- **재설정 성공이 세션을 전부 지운다** / **링크 발급만으로는 세션이 살아 있다**(§5.4의 구분).
- **평문 비밀번호 경로가 사라졌다:** `admin.users.create`/`resetPassword`가 더 이상 없다(라우터 표면
  단언). ← §2.4가 절반만 이뤄지는 것을 막는다.

### 8.2 web

- 초대 수락 화면: peek 결과 표시 · 제출 · 죽은 토큰의 안내 · 성공 후 이동.
- 재설정 화면: 같은 4가지.
- 조직 초대 섹션: 생성 후 링크 노출 · 목록 · 취소 · 권한 없는 사용자에게 섹션이 안 보인다.
- 관리자 화면: **비밀번호 입력란이 없다**는 단언(§3.1의 성질을 UI에서 고정).

### 8.3 마이그레이션

dev·test DB 양쪽에 0012 적용. `TEST_TABLES` 누락 시 다른 스위트가 오염되므로 함께 확인한다.

**예상 증가는 계획에서 확정한다**(server +25~30 · web +15~20 규모).

## 9. 알려진 한계 (이월 후보)

- **메일이 없다.** 비밀번호를 잊은 사용자는 관리자에게 알려야 하고, 초대도 관리자가 링크를 전달해야
  한다. 발송을 붙일 때 이 설계의 토큰·화면은 그대로 두고 한 겹만 얹으면 된다.
- **승격 요청 큐의 알림은 여전히 폴링 배지뿐이다.** 메일이 선행이라 이번에 얹을 것이 없다.
- **링크를 잃으면 재발급뿐이다**(평문 재조회 없음 — 액세스 토큰과 같은 성질).
- **초대에 만료 자동 정리가 없다.** 만료된 행이 쌓인다(조회는 인덱스로 처리되나 청소 작업은 없다).
- **초대 수락 후 자동 로그인하지 않는다** — 로그인 화면으로 보낸다. 세션 발급 경로를 하나로 유지하는
  대가로 사용자가 한 번 더 입력한다.
- **재설정 링크 발급이 감사 로그를 남기지 않는다**(`createdBy`는 행에 있으나 조회 화면이 없다).
- **로그인 화면에 "비밀번호 찾기"가 없다**(§2.3) — 메일을 붙일 때 함께 검토한다.
- **토큰이 페이지 URL 경로에 남는다 — Referer는 막았고 히스토리는 남았다.** `/invite/:token` ·
  `/reset/:token`(§6.1)의 경로 자체가 토큰이므로 **브라우저 히스토리**와 그 페이지가 보내는
  **같은 출처 Referer** 양쪽에 들어간다. `peek`을 mutation으로 둔 것(§3.5)은 API 요청 URL만 덮는
  별개 조치라 어느 쪽도 해결하지 않는다.
  - **Referer(닫힘)**: `apps/web/index.html`에 `<meta name="referrer" content="no-referrer">`를 넣었다.
    기본 정책 `strict-origin-when-cross-origin` 아래에서는 동일 출처 요청에 전체 URL이 붙어 nginx 표준
    combined 로그의 `$http_referer`에 `/trpc` 요청 한 줄마다 평문 토큰이 남았다. 링크 단위
    (`httpBatchLink`의 `referrerPolicy`)가 아니라 **문서 단위**로 끈 것은 토큰을 URL에 담은 것이 그
    문서이기 때문이다 — 이 문서에서 나가는 모든 요청·이동이 대상이고, 나중에 tRPC를 거치지 않는
    요청이 붙어도 자동으로 덮인다. 앱에 외부 서브리소스가 없고 서버가 `Referer`를 보지 않아 잃는
    것도 없다. **jsdom은 fetch에 `Referer`를 세팅하지 않아 헤더 자체는 테스트로 재현할 수 없다** —
    `src/index-html.test.ts`가 태그의 존재만 잠그고, 실제 헤더는 브라우저 스모크로 확인한다.
  - **히스토리(이월)**: 여전히 남는다. 다루려면 마운트 직후 `history.replaceState`로 경로에서 토큰을
    지운다(토큰은 이미 컴포넌트 상태에 들어와 있으므로 동작에는 지장이 없다). 지금은 링크 자체가
    관리자→본인 직접 전달이라 위험이 낮다고 보고 이월한다.
- **관리자가 적은 이름을 수락 화면에 프리필하지 않는다.** 이름은 수락자가 백지에서 정한다(§5.4).
  하려면 스키마부터 열어야 한다 — `invitations.name` 컬럼(nullable) + `admin.users.invite`의 optional
  입력 + `invitation.peek` 반환에 `name` 추가 + 수락 화면의 `defaultValue`. **마이그레이션 0012를 다시
  여는 일**이라 값에 비해 비용이 크다고 보고 이월한다. 얻는 것은 수락자가 자기 이름을 한 번 덜 치는
  것뿐이고, 대신 초대 행이 "누구에게 어떤 자격을 준다" 밖의 프로필 정보를 들게 된다.
- **동시 소비 가드에 테스트가 없다.** `invitation.accept`와 `auth.resetPassword`의 소비는 둘 다
  `usedAt IS NULL` 조건부 UPDATE라 같은 토큰으로 동시에 들어온 두 요청 중 하나만 통과한다 — 이 성질은
  **코드 검토로만 확인됐다.** 조건절을 지워도 순차 테스트는 전부 통과한다(순차로는 첫 요청이 이미
  `usedAt`을 채운 뒤라 두 번째가 `assertLive`에서 걸린다). 실증하려면 두 요청을 실제로 겹쳐야 하는데,
  트랜잭션 두 개를 원하는 지점에서 교차시키는 장치가 이 스위트에 없다. 조건절을 지우는 변형이
  잡히지 않는다는 것까지가 확인된 사실이다.
- **`auth.resetPassword`가 `users.isActive`를 보지 않는다.** `admin.users.resetLink`는 비활성 계정을
  거절하지만(§5.4), 그것은 **발급 시점**만 막는다. 비활성화 **이전에** 발급된 링크는 그대로 살아 있고,
  `admin.users.setActive(false)`는 그 사용자의 **세션만** 지울 뿐 미사용 재설정 토큰을 만료시키지
  않는다. 그래서 비활성화된 계정의 비밀번호가 옛 링크로 바뀔 수 있다. **계정 접근으로는 이어지지
  않는다** — `auth.login`이 `isActive`에서 막고, 세션도 이미 지워져 있다. 남는 것은 "비활성 계정의
  해시가 바뀐다"뿐이다. 다루려면 결정이 하나 필요하다: **비활성화가 그 사용자의 미사용 초대·재설정
  토큰까지 함께 만료시켜야 하는가**(세션을 지우는 것과 같은 급으로 볼 것인가). 그렇다고 정하면
  `setActive(false)`에 UPDATE 한 건이 붙고, `auth.resetPassword`의 `isActive` 검사는 필요 없어진다.
- **관리자 초대의 발급자가 권한을 잃어도 그 초대는 7일간 유효하다.** `admin.users.invite`가 낸
  `userRole: 'admin'` 초대는 **발급 시점의 권한**으로 만들어지고, 이후 그 발급자가
  `admin.users.setActive(false)`로 막히거나 역할을 잃어도 그 초대 행은 그대로 살아 있다. 수락되면
  **새 관리자가 생긴다.** 이 절의 다른 항목은 이 축을 **대상자** 기준으로만 다뤘고(비활성화된
  대상의 옛 재설정 링크) 발급자 기준은 없었다. 완화 수단은 있다 — 그 초대는 `orgId`가 null이므로
  다른 관리자가 `admin.invitations.list`에서 보고 `admin.invitations.revoke`로 취소할 수 있다.
  다루려면 결정이 필요하다: **권한을 잃은 사람이 발급한 미사용 초대를 함께 만료시킬 것인가**(위
  "비활성화가 미사용 토큰까지 만료시켜야 하는가"와 같은 결정의 일부다), 또는 수락 시점에 발급자의
  권한을 재확인할 것인가(그러면 발급자가 정당히 퇴사한 경우에도 초대가 죽는다).
- **`generateToken`의 인자 타입이 `string`이라 임의 접두를 받고, 접두를 검증하는 코드가 없다.**
  `generateToken(prefix: string = TOKEN_PREFIX)`는 무엇이든 접두로 붙인다 — 오타(`erdd_ivn_`)나
  종류를 뒤바꾼 접두(`RESET_PREFIX`를 초대에)도 그대로 토큰이 된다. **조회는 전부 해시 기반이라
  런타임에서는 아무것도 걸리지 않는다**(`hashToken(plain)`으로만 찾는다) — 잘못된 접두를 단 토큰도
  정상 동작하고, 사람이 로그·화면에서 종류를 잘못 읽는 것만 남는다. 지금 이것을 잡는 것은
  테스트의 `startsWith` 단언뿐이다(`one-time-token.test.ts`, `invitation.test.ts`,
  `admin.test.ts`, `token.test.ts`). 다루려면 인자를 `TokenKind`/리터럴 유니온으로 좁혀 타입이
  거부하게 한다 — 접두 상수를 쓰는 자리가 셋(PAT·초대·재설정)이라 비용은 작다.
- **`requireOrgManager`의 첫 인자 타입이 `Db`로 좁아져 트랜잭션 안에서는 권한 검사를 할 수 없다.**
  `services/perm.ts`의 `getOrgMember`·`requireOrgManager`는 `db: Db`를 받는다(`DbOrTx`가 아니다).
  그래서 트랜잭션 안에서 부르면 타입이 거부하고, 부르려면 **트랜잭션 밖에서** 먼저 검사해야 한다.
  지금은 무해하다 — `invitation.accept`는 공개 프로시저라 권한 검사가 없고, 다른 호출자는 전부
  트랜잭션 밖이다. 그러나 **수락에 조직 상태 재확인을 넣는 후속 변경**(예: 수락 시점에 조직이
  아직 살아 있는지·초대자가 아직 매니저인지 보기)이 오면 그 검사가 트랜잭션 밖으로 새고, 검사와
  INSERT 사이가 벌어진다. 다루려면 `perm.ts`의 두 함수 인자를 `DbOrTx`로 넓힌다(읽기 전용
  select뿐이라 의미상 걸리는 것은 없다).
- **`accept` 경로에서는 scrypt 해싱이 열린 트랜잭션 안에서 돈다.** `createAccount`는 `hashPassword`를
  자기 `db.transaction` **전에** await하지만, `accept`는 이미 트랜잭션을 열어 두고 부르므로
  scrypt(N=16384, 수십~수백 ms) 동안 트랜잭션과 풀 커넥션을 잡고 있다. 기존 두 호출자에는 없던
  성질이다. 초대 수락은 드문 경로라 지금 규모에서는 감당 가능하지만, **같은 패턴을 로그인·재설정처럼
  빈번한 경로로 복사하면 커넥션 고갈이 된다.** 해시를 미리 계산해 넘기려면 `createAccount`가
  `passwordHash`를 받아야 하는데, 그것은 "정규화·개인 조직이 갈라지지 않는다"는 이 함수의 존재
  이유(§5.2)와 상충한다.
