import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { hashToken } from '../auth/token.js'
import { invitations, members, organizations, users } from '../db/schema.js'

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
/** 세션 쿠키 없이 호출한다 — 공개 프로시저(peek·accept)가 정말 공개인지 보려면 이것을 써야 한다. */
function postPublic(app: FastifyInstance, path: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

describe.skipIf(!url)('invitation', () => {
  let app: FastifyInstance
  let ownerToken: string
  let ownerId: string
  let orgId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const owner = await createAccount(app.db!, {
      email: 'owner@test.dev', name: '오너', password: 'password-o', role: 'user',
    })
    ownerId = owner.id
    ownerToken = await loginAs(app, 'owner@test.dev', 'password-o')
    const res = await post(app, 'org.create', ownerToken, { name: '팀A' })
    expect(res.statusCode).toBe(200)
    orgId = res.json().result.data.id as string
  })

  /** 초대를 만들고 평문 토큰과 id를 돌려준다(정상 경로). */
  async function invite(email: string, orgRole: 'admin' | 'member' = 'member') {
    const res = await post(app, 'invitation.create', ownerToken, { orgId, email, orgRole })
    expect(res.statusCode).toBe(200)
    return res.json().result.data as { id: string; token: string }
  }

  /**
   * API로는 만들 수 없는 초대(조직 없음·userRole=admin·만료됨)를 DB에 직접 심는다.
   * 반환값은 평문 토큰이다 — DB에는 해시만 들어간다.
   */
  async function seedInvitation(over: Partial<typeof invitations.$inferInsert> = {}) {
    const plain = `erdd_inv_seed_${uuidv7()}`
    await app.db!.insert(invitations).values({
      id: uuidv7(), email: 'seed@test.dev', orgId: null, orgRole: null, userRole: 'user',
      tokenHash: hashToken(plain), expiresAt: new Date(Date.now() + 60_000), createdBy: ownerId,
      ...over,
    })
    return plain
  }

  it('create가 초대를 만들고 평문 토큰을 한 번만 반환한다', async () => {
    const created = await invite('New@Test.dev')
    expect(created.token.startsWith('erdd_inv_')).toBe(true)

    const list = (await get(app, 'invitation.listForOrg', ownerToken, { orgId }))
      .json().result.data as Array<{ email: string }>
    expect(list).toHaveLength(1)
    expect(list[0]!.email).toBe('new@test.dev') // 정규화되어 저장된다
    // 평문도 해시도 목록으로 새지 않는다. 링크를 잃으면 조회가 아니라 재발급이다.
    expect(JSON.stringify(list)).not.toContain(created.token)
    expect(JSON.stringify(list)).not.toContain(hashToken(created.token))
  })

  /**
   * 만료 시각이 발급 응답에 실린다 — 발급 상자가 "…까지 유효합니다"를 말할 수 있어야 한다.
   * 관리자 초대(`admin.users.invite`)와 재설정은 이미 주므로, 없으면 같은 7일 성질을 화면
   * 두 곳이 다르게 말한다.
   */
  it('create가 만료 시각을 함께 준다 — 저장된 값과 같다', async () => {
    const before = Date.now()
    const res = await post(app, 'invitation.create', ownerToken, {
      orgId, email: 'exp@test.dev', orgRole: 'member',
    })
    const created = res.json().result.data as { id: string; token: string; expiresAt: string }
    const returned = new Date(created.expiresAt).getTime()
    // 초대 TTL은 7일이다(one-time-token.ts). 응답이 만들어 낸 값이 아니라 행에 저장된 값이어야
    // 한다 — 갈리면 화면이 실제와 다른 기한을 말한다.
    expect(returned).toBeGreaterThanOrEqual(before + 6.9 * 24 * 60 * 60 * 1000)
    const row = (await app.db!.select().from(invitations).where(eq(invitations.id, created.id)))[0]!
    expect(row.expiresAt.getTime()).toBe(returned)
  })

  it('create가 이미 가입한 이메일을 거부한다', async () => {
    await createAccount(app.db!, {
      email: 'dup@test.dev', name: '기존', password: 'password-d', role: 'user',
    })
    const res = await post(app, 'invitation.create', ownerToken, {
      orgId, email: 'DUP@test.dev', orgRole: 'member',
    })
    expect(res.statusCode).toBe(409)
    // 활성 계정에는 멤버 추가가 실제로 되는 경로다 — 그렇게 안내한다.
    expect(res.json().error.message).toContain('멤버 추가')
  })

  /**
   * **비활성 계정에 "멤버 추가를 쓰세요"는 막다른 길이다.** `org.members.add`는 `isActive = true`인
   * 사용자만 찾으므로 그 이메일에 404("해당 이메일의 사용자가 없습니다")를 낸다(실측 2026-08-08).
   * 초대가 가리킨 경로가 그 사용자에 대해서만 닫혀 있는 것이고, 조직 매니저에게는 활성화 권한도
   * 없으며 화면 어디에도 "비활성 계정"이 나오지 않는다. `add`의 필터는 기존 동작이라 그대로 두고,
   * 갈 수 있는 유일한 다음 행동(서비스 관리자에게 활성화 요청)을 문구로 낸다.
   */
  it('create가 비활성 계정 이메일에는 다른 안내를 낸다 — 멤버 추가는 그 계정에 닫혀 있다', async () => {
    const off = await createAccount(app.db!, {
      email: 'off@test.dev', name: '비활성', password: 'password-x', role: 'user',
    })
    await app.db!.update(users).set({ isActive: false }).where(eq(users.id, off.id))

    const res = await post(app, 'invitation.create', ownerToken, {
      orgId, email: 'off@test.dev', orgRole: 'member',
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toContain('비활성 계정입니다')
    expect(res.json().error.message).toContain('활성화')
    // 초대가 "멤버 추가"를 가리키지 않아야 한다 — 그 경로가 이 사용자에게 닫혀 있음을 여기서
    // 함께 실증한다. 안내만 단언하면 add가 나중에 필터를 풀어도 문구가 낡은 채 남는다.
    expect(res.json().error.message).not.toContain('멤버 추가')
    const add = await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'off@test.dev', role: 'member',
    })
    expect(add.statusCode).toBe(404)
  })

  it('create가 개인 조직을 거부한다', async () => {
    const personal = (
      await app.db!.select().from(organizations).where(eq(organizations.kind, 'personal'))
    )[0]!
    const res = await post(app, 'invitation.create', ownerToken, {
      orgId: personal.id, email: 'x@test.dev', orgRole: 'member',
    })
    expect(res.statusCode).toBe(403)
  })

  it('조직 매니저가 아닌 멤버는 create·revoke를 못 한다', async () => {
    const created = await invite('later@test.dev')
    await createAccount(app.db!, {
      email: 'plain@test.dev', name: '일반', password: 'password-p', role: 'user',
    })
    expect((await post(app, 'org.members.add', ownerToken, {
      orgId, email: 'plain@test.dev', role: 'member',
    })).statusCode).toBe(200)
    const plainToken = await loginAs(app, 'plain@test.dev', 'password-p')

    expect((await post(app, 'invitation.create', plainToken, {
      orgId, email: 'y@test.dev', orgRole: 'member',
    })).statusCode).toBe(403)
    expect((await post(app, 'invitation.revoke', plainToken, {
      orgId, id: created.id,
    })).statusCode).toBe(403)
  })

  it('다른 조직의 초대는 listForOrg에 안 나온다', async () => {
    const mine = await invite('mine@test.dev')
    await createAccount(app.db!, {
      email: 'outsider@test.dev', name: '외부', password: 'password-x', role: 'user',
    })
    const outsiderToken = await loginAs(app, 'outsider@test.dev', 'password-x')
    const otherOrgId = (await post(app, 'org.create', outsiderToken, { name: '팀B' }))
      .json().result.data.id as string
    expect((await post(app, 'invitation.create', outsiderToken, {
      orgId: otherOrgId, email: 'theirs@test.dev', orgRole: 'member',
    })).statusCode).toBe(200)

    const list = (await get(app, 'invitation.listForOrg', ownerToken, { orgId }))
      .json().result.data as Array<{ email: string }>
    expect(list.map((i) => i.email)).toEqual(['mine@test.dev'])

    // 남의 조직 id를 그냥 넣어서는 목록을 못 본다. 이 단언이 없으면 로그인한 아무나 임의 orgId로
    // 남의 조직 초대 이메일을 전부 읽는다.
    expect((await get(app, 'invitation.listForOrg', outsiderToken, { orgId })).statusCode).toBe(403)

    // 자기 조직의 매니저라는 자격으로 남의 조직 초대를 취소하지도 못한다. requireOrgManager는
    // 팀B에 대해서만 통과시키므로, 크로스-테넌트를 막는 것은 revoke의 orgId 조건뿐이다.
    expect((await post(app, 'invitation.revoke', outsiderToken, {
      orgId: otherOrgId, id: mine.id,
    })).statusCode).toBe(409)
    // 실제로 살아 있어야 한다 — 상태코드만 보고 만족하면 "만료시켜 놓고 409"를 놓친다.
    expect((await postPublic(app, 'invitation.peek', { token: mine.token })).statusCode).toBe(200)
  })

  it('재발급이 이전 초대를 죽인다 — 두 링크가 동시에 살아 있지 않다', async () => {
    const first = await invite('again@test.dev')
    const second = await invite('again@test.dev')
    expect(second.token).not.toBe(first.token)

    expect((await postPublic(app, 'invitation.peek', { token: first.token })).statusCode).toBe(400)
    expect((await postPublic(app, 'invitation.peek', { token: second.token })).statusCode).toBe(200)
  })

  it('revoke가 초대를 죽인다', async () => {
    const created = await invite('revoked@test.dev')
    expect((await post(app, 'invitation.revoke', ownerToken, {
      orgId, id: created.id,
    })).statusCode).toBe(200)
    expect((await postPublic(app, 'invitation.peek', { token: created.token })).statusCode).toBe(400)
  })

  it('peek이 세션 없이 이메일·조직명을 준다', async () => {
    const created = await invite('peeker@test.dev', 'admin')
    const res = await postPublic(app, 'invitation.peek', { token: created.token })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      email: 'peeker@test.dev', orgName: '팀A', orgRole: 'admin',
    })
  })

  it('peek이 userRole을 내보내지 않는다', async () => {
    // 조직 역할은 member인데 서비스 역할이 admin인 초대 — userRole이 새면 'admin'이 응답에 보인다.
    const token = await seedInvitation({
      email: 'boss@test.dev', orgId, orgRole: 'member', userRole: 'admin',
    })
    const res = await postPublic(app, 'invitation.peek', { token })
    expect(res.statusCode).toBe(200)
    const body = res.json().result.data as Record<string, unknown>
    expect(Object.keys(body)).not.toContain('userRole')
    expect(JSON.stringify(body)).not.toContain('admin')
  })

  it('조직 없는 초대의 peek은 orgName·orgRole이 null이다', async () => {
    const token = await seedInvitation({ email: 'solo@test.dev' })
    const res = await postPublic(app, 'invitation.peek', { token })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      email: 'solo@test.dev', orgName: null, orgRole: null,
    })
  })

  it('accept가 세션 없이 계정과 조직 멤버를 만든다', async () => {
    const created = await invite('joiner@test.dev')
    const res = await postPublic(app, 'invitation.accept', {
      token: created.token, name: '조이너', password: 'password-j',
    })
    expect(res.statusCode).toBe(200)

    await loginAs(app, 'joiner@test.dev', 'password-j')
    const user = (await app.db!.select().from(users).where(eq(users.email, 'joiner@test.dev')))[0]!
    const mine = await app.db!.select().from(members).where(eq(members.userId, user.id))
    // 개인 조직 owner + 초대 조직 member — 둘 다 있어야 한다.
    expect(mine.map((m) => m.role).sort()).toEqual(['member', 'owner'])
    expect(mine.some((m) => m.orgId === orgId && m.role === 'member')).toBe(true)
  })

  it('accept가 초대의 userRole을 쓴다 — 입력으로 역할을 올릴 수 없다', async () => {
    const bossToken = await seedInvitation({
      email: 'boss@test.dev', orgId, orgRole: 'member', userRole: 'admin',
    })
    expect((await postPublic(app, 'invitation.accept', {
      token: bossToken, name: '보스', password: 'password-b',
    })).statusCode).toBe(200)
    const boss = (await app.db!.select().from(users).where(eq(users.email, 'boss@test.dev')))[0]!
    expect(boss.role).toBe('admin')

    // 초대가 user인데 클라이언트가 admin을 실어 보내도 무시된다.
    const created = await invite('climber@test.dev')
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '등반', password: 'password-c', userRole: 'admin', role: 'admin',
    })).statusCode).toBe(200)
    const climber = (
      await app.db!.select().from(users).where(eq(users.email, 'climber@test.dev'))
    )[0]!
    expect(climber.role).toBe('user')
  })

  it('accept 후 같은 토큰이 재사용되지 않는다', async () => {
    const created = await invite('once@test.dev')
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '한번', password: 'password-1',
    })).statusCode).toBe(200)
    const again = await postPublic(app, 'invitation.accept', {
      token: created.token, name: '두번', password: 'password-2',
    })
    expect(again.statusCode).toBe(400)
    expect(await app.db!.select().from(users).where(eq(users.email, 'once@test.dev')))
      .toHaveLength(1)
  })

  it('만료된 초대는 peek·accept 둘 다 거부한다', async () => {
    const created = await invite('stale@test.dev')
    await app.db!.update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, created.id))

    expect((await postPublic(app, 'invitation.peek', { token: created.token })).statusCode).toBe(400)
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '늦음', password: 'password-s',
    })).statusCode).toBe(400)
    expect(await app.db!.select().from(users).where(eq(users.email, 'stale@test.dev')))
      .toHaveLength(0)
  })

  /**
   * **zod 입력 검증 실패는 링크를 죽이지 않는다.** 그 실패도 `BAD_REQUEST`로 오므로 코드만으로는
   * "링크가 죽었다"와 갈릴 수 없다 — 화면이 코드로 판정하면 살아 있는 초대가 죽은 것으로
   * 표시되고 입력한 이름까지 사라지며 zod issue JSON이 사유로 노출된다(설계 §6.1).
   * 종료성은 응답의 `data.linkDead`로만 말한다.
   */
  it('짧은 비밀번호는 입력 검증으로 거절되고 그 초대는 살아 있다', async () => {
    const created = await invite('short@test.dev')
    const short = await postPublic(app, 'invitation.accept', {
      token: created.token, name: '신규', password: '1234567',
    })
    expect(short.statusCode).toBe(400)
    expect(short.json().error.data.code).toBe('BAD_REQUEST')
    expect(short.json().error.data.linkDead).toBe(false)
    // 거절이 초대를 소비하지도 않았다.
    expect((await app.db!.select().from(invitations).where(eq(invitations.id, created.id)))[0]!.usedAt)
      .toBeNull()

    // 같은 토큰이 곧바로 200이다 — 위 거절은 링크가 아니라 입력에 대한 것이었다.
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '신규', password: 'password-s',
    })).statusCode).toBe(200)
  })

  /** 반대 방향 — 죽은 링크와 "이미 가입한 이메일"은 표식을 달고 나가야 한다. */
  it('죽은 초대와 이미 가입한 이메일은 linkDead 표식을 달고 거절된다', async () => {
    const stale = await invite('dead@test.dev')
    await app.db!.update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, stale.id))
    const peeked = await postPublic(app, 'invitation.peek', { token: stale.token })
    expect(peeked.json().error.data.linkDead).toBe(true)

    const none = await postPublic(app, 'invitation.peek', { token: 'erdd_inv_nope' })
    expect(none.json().error.data.linkDead).toBe(true)

    // "이미 가입한 이메일"은 CONFLICT다. 화면이 이 갈래에는 로그인을 안내하므로 코드도 함께
    // 잠근다 — 표식만 맞고 코드가 바뀌면 안내가 "새 링크를 받으세요"로 되돌아간다.
    const taken = await invite('taken@test.dev')
    await createAccount(app.db!, {
      email: 'taken@test.dev', name: '먼저', password: 'password-f', role: 'user',
    })
    const conflict = await postPublic(app, 'invitation.accept', {
      token: taken.token, name: '나중', password: 'password-l',
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.data.code).toBe('CONFLICT')
    expect(conflict.json().error.data.linkDead).toBe(true)
  })

  it('초대 생성 후 그 이메일이 먼저 가입하면 accept가 CONFLICT이고 초대가 소비되지 않는다', async () => {
    const created = await invite('race@test.dev')
    // 초대를 만든 뒤 수락 전에 그 이메일이 가입했다.
    await createAccount(app.db!, {
      email: 'race@test.dev', name: '먼저', password: 'password-f', role: 'user',
    })
    const res = await postPublic(app, 'invitation.accept', {
      token: created.token, name: '나중', password: 'password-l',
    })
    expect(res.statusCode).toBe(409)
    // 초대는 소비되지 않고 남는다 — 관리자가 취소하거나 멤버 추가로 처리한다.
    const row = (await app.db!.select().from(invitations).where(eq(invitations.id, created.id)))[0]!
    expect(row.usedAt).toBeNull()
  })

  it('재검사와 INSERT 사이에 그 이메일이 가입하면 accept가 500이 아니라 409다', async () => {
    const created = await invite('racer@test.dev')
    const pool = app.pgPool!
    // 재검사(select)는 통과시키고 users INSERT만 unique 위반으로 터뜨린다 — 재검사와 INSERT
    // 사이에 남이 먼저 가입한 상황과 DB가 내는 오류가 같다. 트랜잭션 안이라 실제 동시 커밋을
    // 밖에서 끼워 넣을 수 없어 SQLSTATE를 직접 낸다.
    await pool.query(`
      CREATE OR REPLACE FUNCTION erdd_probe_dup() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'probe: 동시 가입' USING ERRCODE = '23505';
      END $$`)
    await pool.query('DROP TRIGGER IF EXISTS erdd_probe_users ON users')
    await pool.query(`
      CREATE TRIGGER erdd_probe_users BEFORE INSERT ON users FOR EACH ROW
      WHEN (NEW.email = 'racer@test.dev') EXECUTE FUNCTION erdd_probe_dup()`)
    try {
      const res = await postPublic(app, 'invitation.accept', {
        token: created.token, name: '경합', password: 'password-r',
      })
      // 500이면 클라이언트는 재시도할지 포기할지 구분하지 못한다. 재검사가 잡았을 때와 같은 409다.
      expect(res.statusCode).toBe(409)
      // 초대는 소비되지 않고 남는다(전체 롤백).
      const row = (
        await app.db!.select().from(invitations).where(eq(invitations.id, created.id))
      )[0]!
      expect(row.usedAt).toBeNull()
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS erdd_probe_users ON users')
      await pool.query('DROP FUNCTION IF EXISTS erdd_probe_dup()')
    }
  })

  it('accept가 원자적이다 — 조직 멤버 insert가 실패하면 계정도 남지 않는다', async () => {
    const created = await invite('atomic@test.dev')
    const pool = app.pgPool!
    // 실패 주입: 초대 조직에 대한 members insert만 터뜨린다. 조직을 삭제하는 방법은
    // invitations.org_id가 cascade라 초대까지 지워져 "초대 없음"을 보게 되므로 쓸 수 없다.
    await pool.query(`
      CREATE OR REPLACE FUNCTION erdd_probe_fail() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'probe: members insert 실패'; END $$`)
    await pool.query('DROP TRIGGER IF EXISTS erdd_probe_members ON members')
    await pool.query(`
      CREATE TRIGGER erdd_probe_members BEFORE INSERT ON members FOR EACH ROW
      WHEN (NEW.org_id = '${orgId}') EXECUTE FUNCTION erdd_probe_fail()`)
    try {
      const res = await postPublic(app, 'invitation.accept', {
        token: created.token, name: '원자', password: 'password-a',
      })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      // 계정도, 개인 조직도, 초대 소비도 남지 않아야 한다.
      expect(await app.db!.select().from(users).where(eq(users.email, 'atomic@test.dev')))
        .toHaveLength(0)
      expect(await app.db!.select().from(organizations)
        .where(eq(organizations.name, '원자의 공간'))).toHaveLength(0)
      const row = (
        await app.db!.select().from(invitations).where(eq(invitations.id, created.id))
      )[0]!
      expect(row.usedAt).toBeNull()
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS erdd_probe_members ON members')
      await pool.query('DROP FUNCTION IF EXISTS erdd_probe_fail()')
    }
  })
})
