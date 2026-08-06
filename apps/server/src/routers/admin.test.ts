import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { invitations, members, organizations, passwordResetTokens, users } from '../db/schema.js'

const url = process.env.DATABASE_URL

function post(app: FastifyInstance, path: string, token: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`, cookies: { erdd_session: token },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}
/** 세션 쿠키 없이 호출한다 — 초대 수락·비밀번호 재설정은 공개 프로시저다. */
function postPublic(app: FastifyInstance, path: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

describe.skipIf(!url)('admin.users', () => {
  let app: FastifyInstance
  let adminToken: string
  let adminId: string
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const admin = await createAccount(app.db!, {
      email: 'admin@test.dev', name: '관리자', password: 'admin-pass-1', role: 'admin',
    })
    adminId = admin.id
    adminToken = await loginAs(app, 'admin@test.dev', 'admin-pass-1')
  })

  /** 관리자 초대를 만들고 평문 토큰과 id를 돌려준다(정상 경로). */
  async function invite(email: string, role: 'admin' | 'user' = 'user') {
    const res = await post(app, 'admin.users.invite', adminToken, { email, role })
    expect(res.statusCode).toBe(200)
    return res.json().result.data as { id: string; token: string }
  }
  /** 재설정 링크를 발급한다(정상 경로). */
  async function resetLink(userId: string) {
    const res = await post(app, 'admin.users.resetLink', adminToken, { userId })
    expect(res.statusCode).toBe(200)
    return res.json().result.data as { id: string; token: string }
  }
  /** 비밀번호 재설정용 대상 계정 하나를 만들고 그 id를 준다. */
  async function makeTarget(email = 'u3@test.dev', password = 'password-3') {
    const user = await createAccount(app.db!, {
      email, name: '사용자3', password, role: 'user',
    })
    return user.id
  }

  it('invite가 계정을 만들지 않고 초대만 만든다', async () => {
    const created = await invite('U1@Test.dev')
    expect(created.token.startsWith('erdd_inv_')).toBe(true)

    // 계정은 아직 없다 — 관리자 하나뿐이다. 초대는 "계정을 만들 자격"이지 계정이 아니다.
    expect(await app.db!.select().from(users)).toHaveLength(1)

    const rows = await app.db!.select().from(invitations)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.email).toBe('u1@test.dev') // 정규화되어 저장된다
    // 관리자 초대의 orgId는 null이다 — 사람을 시스템에 넣는 것과 조직에 넣는 것은 별개 행위다.
    expect(rows[0]!.orgId).toBeNull()
    // 평문은 발급 응답에서만 나간다. DB에는 해시만 있다.
    expect(JSON.stringify(rows)).not.toContain(created.token)
  })

  it('invite로 만든 초대를 수락하면 개인 조직만 생기고 팀 조직에는 안 들어간다', async () => {
    const created = await invite('u1@test.dev')
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '사용자1', password: 'password-1',
    })).statusCode).toBe(200)

    // 옛 admin.users.create가 보장하던 것 — 계정과 개인 조직이 함께 생긴다.
    await loginAs(app, 'u1@test.dev', 'password-1')
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(2) // 관리자 개인 조직 + 신규 개인 조직

    const user = (await app.db!.select().from(users).where(eq(users.email, 'u1@test.dev')))[0]!
    const mine = await app.db!.select().from(members).where(eq(members.userId, user.id))
    // 개인 조직 owner 하나뿐이다. 팀 멤버가 하나라도 생기면 관리자 초대가 조직 초대를 겸하게 된다.
    expect(mine).toHaveLength(1)
    expect(mine[0]!.role).toBe('owner')
    expect(orgs.find((o) => o.id === mine[0]!.orgId)!.kind).toBe('personal')
  })

  it('invite의 서비스 역할이 수락한 계정에 그대로 적용된다', async () => {
    const boss = await invite('boss@test.dev', 'admin')
    expect((await postPublic(app, 'invitation.accept', {
      token: boss.token, name: '보스', password: 'password-b',
    })).statusCode).toBe(200)
    expect((await app.db!.select().from(users).where(eq(users.email, 'boss@test.dev')))[0]!.role)
      .toBe('admin')

    // 기본값은 user다 — 역할을 빠뜨린 초대가 관리자를 만들면 안 된다.
    const plain = await invite('plain@test.dev')
    expect((await postPublic(app, 'invitation.accept', {
      token: plain.token, name: '일반', password: 'password-p',
    })).statusCode).toBe(200)
    expect((await app.db!.select().from(users).where(eq(users.email, 'plain@test.dev')))[0]!.role)
      .toBe('user')
  })

  it('invite가 이미 가입한 이메일을 거부한다', async () => {
    await createAccount(app.db!, {
      email: 'dup@test.dev', name: '기존', password: 'password-d', role: 'user',
    })
    // 대소문자만 다른 것도 같은 계정이다 — 정규화 후에 검사해야 잡힌다.
    const res = await post(app, 'admin.users.invite', adminToken, { email: 'DUP@test.dev' })
    expect(res.statusCode).toBe(409)
  })

  it('invite 재발급이 이전 초대를 죽인다 — 두 링크가 동시에 살아 있지 않다', async () => {
    const first = await invite('again@test.dev')
    const second = await invite('again@test.dev')
    expect(second.token).not.toBe(first.token)

    expect((await postPublic(app, 'invitation.peek', { token: first.token })).statusCode).toBe(400)
    expect((await postPublic(app, 'invitation.peek', { token: second.token })).statusCode).toBe(200)
  })

  it('resetLink는 링크만 낸다 — 비밀번호도 세션도 그대로다', async () => {
    const targetId = await makeTarget()
    const userToken = await loginAs(app, 'u3@test.dev', 'password-3')

    const link = await resetLink(targetId)
    expect(link.token.startsWith('erdd_rst_')).toBe(true)

    // 링크를 만들었을 뿐 비밀번호는 아직 그대로다.
    await loginAs(app, 'u3@test.dev', 'password-3')
    // 세션도 살아 있다. 세션 삭제는 auth.resetPassword 성공 시점이지 발급 시점이 아니다 —
    // 여기서 죽이면 링크를 못 받은 사용자가 이유도 모른 채 로그아웃된다.
    const me = await app.inject({
      method: 'GET', url: '/trpc/auth.me', cookies: { erdd_session: userToken },
    })
    expect(me.statusCode).toBe(200)
  })

  it('재설정 재발급이 이전 토큰을 죽인다', async () => {
    const targetId = await makeTarget()
    const first = await resetLink(targetId)
    const second = await resetLink(targetId)
    expect(second.token).not.toBe(first.token)

    expect((await postPublic(app, 'auth.resetPassword', {
      token: first.token, newPassword: 'password-x',
    })).statusCode).toBe(400)
    // 상태코드만 보면 "거절했지만 바꿔 놨다"를 놓친다.
    await loginAs(app, 'u3@test.dev', 'password-3')

    expect((await postPublic(app, 'auth.resetPassword', {
      token: second.token, newPassword: 'password-y',
    })).statusCode).toBe(200)
    await loginAs(app, 'u3@test.dev', 'password-y')
  })

  it('resetLink가 없는 사용자를 거절한다', async () => {
    const res = await post(app, 'admin.users.resetLink', adminToken, { userId: uuidv7() })
    expect(res.statusCode).toBe(404)
    // 상태코드만 보면 구분이 안 된다 — 존재하지 않는 프로시저도 404다(아래 표면 단언 참고).
    // 이 프로시저가 살아 있고 "사용자가 없다"로 거절했음을 문구로 확인한다.
    expect(res.json().error.message).toBe('사용자를 찾을 수 없습니다')
    expect(await app.db!.select().from(passwordResetTokens)).toHaveLength(0)
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

  it('비관리자는 invite·resetLink를 못 부른다', async () => {
    await createAccount(app.db!, {
      email: 'u2@test.dev', name: '일반', password: 'password-2', role: 'user',
    })
    const token = await loginAs(app, 'u2@test.dev', 'password-2')
    expect((await post(app, 'admin.users.invite', token, { email: 'x@test.dev' })).statusCode)
      .toBe(403)
    expect((await post(app, 'admin.users.resetLink', token, { userId: adminId })).statusCode)
      .toBe(403)
    // 거절이 진짜인지 본다 — 403을 내면서 행을 남기면 아무도 모른다.
    expect(await app.db!.select().from(invitations)).toHaveLength(0)
  })

  it('admin.users.create와 admin.users.resetPassword가 더 이상 없다', async () => {
    // 평문 비밀번호를 받던 두 경로가 정말 사라졌는지 본다. 이 단언이 없으면 새 경로만 늘고
    // 옛 경로가 그대로 살아 "관리자가 남의 비밀번호를 모른다"가 절반만 성립한다.
    for (const path of ['admin.users.create', 'admin.users.resetPassword']) {
      const res = await post(app, path, adminToken, {
        email: 'ghost@test.dev', name: '유령', initialPassword: 'password-g',
        userId: adminId, newPassword: 'password-g',
      })
      expect(res.statusCode).toBe(404)
      // 404만으로는 부족하다 — 살아 있는 프로시저가 NOT_FOUND를 던져도 404다.
      // 라우터에 그 경로 자체가 없다는 것을 tRPC의 문구로 확인한다.
      expect(res.json().error.message).toBe(`No procedure found on path "${path}"`)
    }

    // 살아 있었다면 계정이 생기거나 관리자 비밀번호가 바뀌었을 것이다.
    expect(await app.db!.select().from(users)).toHaveLength(1)
    await loginAs(app, 'admin@test.dev', 'admin-pass-1')
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

    const self = await post(app, 'admin.users.setActive', adminToken, {
      userId: adminId, isActive: false,
    })
    expect(self.statusCode).toBe(400)
  })
})
