import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { hashToken } from '../auth/token.js'
import { appRouter } from '../router.js'
import { invitations, members, organizations, passwordResetTokens, users } from '../db/schema.js'

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
/** 세션 쿠키 없이 호출한다 — 초대 수락·비밀번호 재설정은 공개 프로시저다. */
function postPublic(app: FastifyInstance, path: string, input: unknown) {
  return app.inject({
    method: 'POST', url: `/trpc/${path}`,
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
}

type ProcedureType = 'query' | 'mutation' | 'subscription'

/**
 * 라우터에 실제로 등록된 프로시저 전부를 `[점 표기 경로, 종류]`로 준다.
 * tRPC 11의 `_def.procedures`는 점 표기 경로를 키로 갖는 평평한 레코드다.
 *
 * 문자열 상수를 손으로 적어 호출해 보는 방식은 **오타가 통과한다** — 없는 경로를 부르면
 * 404가 나고, "없어야 한다"는 단언은 그대로 만족된다. 표면을 열거해 전수 비교해야 추가·삭제·
 * 오타가 모두 깨진다.
 */
function procedureEntries(): Array<[string, ProcedureType]> {
  const procedures = (appRouter as unknown as {
    _def: { procedures: Record<string, { _def: { type: ProcedureType } }> }
  })._def.procedures
  return Object.entries(procedures).map(([path, p]) => [path, p._def.type])
}

/** admin 라우터의 표면 전체. 이 배열과 실제가 한 글자라도 어긋나면 깨진다. */
const ADMIN_PATHS = [
  'admin.users.list',
  'admin.users.invite',
  'admin.users.resetLink',
  'admin.users.setActive',
  'admin.invitations.list',
  'admin.invitations.revoke',
]

/**
 * 세션 없이 부를 수 있는 프로시저 전부(설계 3.5). 앞의 넷은 이 사이클 이전부터 공개였고,
 * 뒤의 셋이 설계 3.5가 허용한 셋이다. **여기 없는 공개 프로시저는 규칙 위반이다.**
 */
const PUBLIC_PATHS = [
  'health.ping',
  'logicalType.parse',
  'auth.login',
  'auth.logout',
  'invitation.peek',
  'invitation.accept',
  'auth.resetPassword',
]

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
    return res.json().result.data as { id: string; token: string; expiresAt: string }
  }
  /** 팀 조직 하나를 만들고 그 id를 준다(관리자가 owner가 된다). */
  async function makeTeamOrg(name = '팀A') {
    const res = await post(app, 'org.create', adminToken, { name })
    expect(res.statusCode).toBe(200)
    return res.json().result.data.id as string
  }
  /** 그 조직의 조직 초대를 만든다 — 관리자 초대(orgId null)와 대비되는 별개 묶음이다. */
  async function orgInvite(orgId: string, email: string) {
    const res = await post(app, 'invitation.create', adminToken, {
      orgId, email, orgRole: 'member',
    })
    expect(res.statusCode).toBe(200)
    return res.json().result.data as { id: string; token: string }
  }
  /** 초대 링크가 아직 살아 있는지 공개 경로로 확인한다(200이면 살아 있다, 400이면 죽었다). */
  async function peekStatus(token: string) {
    return (await postPublic(app, 'invitation.peek', { token })).statusCode
  }
  /** 재설정 링크를 발급한다(정상 경로). */
  async function resetLink(userId: string) {
    const res = await post(app, 'admin.users.resetLink', adminToken, { userId })
    expect(res.statusCode).toBe(200)
    return res.json().result.data as { id: string; token: string; expiresAt: string }
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
    // 만료 시각도 함께 나간다 — 링크를 전달하는 관리자가 언제까지 유효한지 말할 수 있어야 한다.
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now())

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
    // 팀 조직이 하나도 없으면 "팀 조직에는 안 들어간다"는 검증되지 않는다 — 들어갈 팀이 없으니
    // 어떤 구현이어도 통과한다. 실제로 존재하는 팀을 두고 그 멤버 목록을 본다.
    const teamOrgId = await makeTeamOrg()
    const created = await invite('u1@test.dev')
    expect((await postPublic(app, 'invitation.accept', {
      token: created.token, name: '사용자1', password: 'password-1',
    })).statusCode).toBe(200)

    // 옛 admin.users.create가 보장하던 것 — 계정과 개인 조직이 함께 생긴다.
    await loginAs(app, 'u1@test.dev', 'password-1')
    const orgs = await app.db!.select().from(organizations)
    expect(orgs).toHaveLength(3) // 관리자 개인 조직 + 팀A + 신규 개인 조직

    const user = (await app.db!.select().from(users).where(eq(users.email, 'u1@test.dev')))[0]!
    const mine = await app.db!.select().from(members).where(eq(members.userId, user.id))
    // 개인 조직 owner 하나뿐이다. 팀 멤버가 하나라도 생기면 관리자 초대가 조직 초대를 겸하게 된다.
    expect(mine).toHaveLength(1)
    expect(mine[0]!.role).toBe('owner')
    expect(orgs.find((o) => o.id === mine[0]!.orgId)!.kind).toBe('personal')

    // 팀 쪽에서도 본다 — 팀A에는 만든 사람(관리자)뿐이고 수락자는 없다.
    const teamMembers = await app.db!.select().from(members).where(eq(members.orgId, teamOrgId))
    expect(teamMembers.map((m) => m.userId)).toEqual([adminId])
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

  it('invite 재발급이 같은 이메일의 조직 초대는 죽이지 않는다', async () => {
    // 관리자 재발급의 무효화 범위는 (email, orgId is null)이다. 조직 초대는 별개 묶음이라
    // 관리자가 계정 초대를 다시 내는 것만으로 팀 초대까지 쓸려 가면 안 된다.
    const orgId = await makeTeamOrg()
    const teamInv = await orgInvite(orgId, 'both@test.dev')
    const first = await invite('both@test.dev')
    const second = await invite('both@test.dev')

    expect(await peekStatus(first.token)).toBe(400)   // 관리자 초대끼리는 죽인다
    expect(await peekStatus(second.token)).toBe(200)
    expect(await peekStatus(teamInv.token)).toBe(200) // 조직 초대는 그대로 살아 있다
  })

  it('resetLink는 링크만 낸다 — 비밀번호도 세션도 그대로다', async () => {
    const targetId = await makeTarget()
    const userToken = await loginAs(app, 'u3@test.dev', 'password-3')

    const link = await resetLink(targetId)
    expect(link.token.startsWith('erdd_rst_')).toBe(true)
    // 만료 시각도 함께 나간다 — 재설정은 목록 화면이 없어서 발급 응답이 유효 기한을 말할 유일한
    // 자리다. 초대(7일)보다 훨씬 짧으므로(24시간) 값이 초대 것으로 바뀌어도 깨져야 한다.
    const validFor = new Date(link.expiresAt).getTime() - Date.now()
    expect(validFor).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(validFor).toBeLessThan(25 * 60 * 60 * 1000)
    // DB에 실제로 박힌 만료와 같은 값이다 — 화면이 말하는 기한과 서버 판정이 갈리면 안 된다.
    const row = (await app.db!.select().from(passwordResetTokens))[0]!
    expect(row.expiresAt.toISOString()).toBe(new Date(link.expiresAt).toISOString())

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

  it('resetLink가 비활성 계정을 거절한다', async () => {
    const targetId = await makeTarget()
    expect((await post(app, 'admin.users.setActive', adminToken, {
      userId: targetId, isActive: false,
    })).statusCode).toBe(200)

    // 링크를 내주면 비밀번호는 실제로 바뀌지만 로그인은 isActive에서 막힌다. 관리자는
    // "재설정해 줬는데 왜 안 되지"를 겪고 원인이 어디에도 나오지 않는다.
    const res = await post(app, 'admin.users.resetLink', adminToken, { userId: targetId })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('비활성 계정입니다 — 먼저 활성화하세요')
    // 거절이 진짜인지 본다 — 400을 내면서 토큰을 남기면 링크가 화면에 안 뜰 뿐 살아 있다.
    expect(await app.db!.select().from(passwordResetTokens)).toHaveLength(0)
  })

  it('관리자 초대를 취소하면 그 링크가 죽는다 — 조직 초대는 이 경로로 못 건드린다', async () => {
    const orgId = await makeTeamOrg()
    const teamInv = await orgInvite(orgId, 'team@test.dev')
    const created = await invite('gone@test.dev')
    expect(await peekStatus(created.token)).toBe(200)

    expect((await post(app, 'admin.invitations.revoke', adminToken, { id: created.id })).statusCode)
      .toBe(200)
    // 잘못된 주소로 나간 링크를 7일 내내 죽일 수 없으면 안 된다(설계 3.2 "취소: 가능").
    expect(await peekStatus(created.token)).toBe(400)

    // 조직 초대는 이 경로의 대상이 아니다 — 그 조직 매니저의 invitation.revoke 몫이다.
    const other = await post(app, 'admin.invitations.revoke', adminToken, { id: teamInv.id })
    expect(other.statusCode).toBe(409)
    expect(await peekStatus(teamInv.token)).toBe(200)
  })

  it('관리자 초대 목록에 평문 토큰이 없고 조직 초대가 섞이지 않는다', async () => {
    const orgId = await makeTeamOrg()
    const teamInv = await orgInvite(orgId, 'team@test.dev')
    const created = await invite('mine@test.dev', 'admin')

    const res = await get(app, 'admin.invitations.list', adminToken)
    expect(res.statusCode).toBe(200)
    const rows = res.json().result.data as Array<{
      id: string; email: string; userRole: string; expiresAt: string; usedAt: string | null
    }>
    // 관리자 초대(orgId null)만 나온다. 조직 초대는 invitation.listForOrg가 담당한다.
    expect(rows.map((r) => r.id)).toEqual([created.id])
    expect(rows[0]!.email).toBe('mine@test.dev')
    expect(rows[0]!.userRole).toBe('admin')
    expect(rows[0]!.usedAt).toBeNull()
    expect(new Date(rows[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // 평문도 해시도 목록으로 새지 않는다 — 링크를 잃으면 조회가 아니라 재발급이다.
    expect(res.body).not.toContain(created.token)
    expect(res.body).not.toContain(hashToken(created.token))
    expect(res.body).not.toContain(teamInv.token)
  })

  it('조직 매니저는 관리자 초대를 조회하지도 취소하지도 못한다', async () => {
    const created = await invite('gone@test.dev')
    // 자기 조직의 초대는 다루는 사람이다 — 그래도 권한 축이 달라 관리자 초대에는 닿지 않는다.
    await createAccount(app.db!, {
      email: 'mgr@test.dev', name: '매니저', password: 'password-m', role: 'user',
    })
    const mgrToken = await loginAs(app, 'mgr@test.dev', 'password-m')
    expect((await post(app, 'org.create', mgrToken, { name: '팀M' })).statusCode).toBe(200)

    expect((await get(app, 'admin.invitations.list', mgrToken)).statusCode).toBe(403)
    expect((await post(app, 'admin.invitations.revoke', mgrToken, { id: created.id })).statusCode)
      .toBe(403)
    // 거절이 진짜인지 본다 — 403을 내면서 만료시키면 아무도 모른다.
    expect(await peekStatus(created.token)).toBe(200)
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

  it('admin 라우터의 표면이 정확히 이 여섯이다', () => {
    // 위 404 단언은 "적어 둔 경로가 없다"만 본다 — 경로 상수에 오타가 나도 통과하고, 새 프로시저가
    // 하나 늘어도 아무도 모른다. 표면을 열거해 전수 비교하면 추가·삭제·오타가 전부 여기서 깨진다.
    const paths = procedureEntries().map(([p]) => p).filter((p) => p.startsWith('admin.'))
    expect([...paths].sort()).toEqual([...ADMIN_PATHS].sort())
  })

  it('세션 없이 부를 수 있는 프로시저가 설계 3.5의 목록과 정확히 같다', async () => {
    // 설계 3.5의 "새 프로시저의 기본은 authedProcedure(fail-closed)"를 라우터 전수로 잠근다.
    // 새 프로시저를 dbProcedure로 잘못 열면 목록에 없는 경로가 401을 피해 여기서 잡힌다.
    const reachable: string[] = []
    for (const [path, type] of procedureEntries()) {
      // 입력은 일부러 비운다. 인증 미들웨어가 입력 파싱보다 먼저 돌므로 보호된 경로는 401이고,
      // 공개 경로는 (입력이 필요하면) 400·(아니면) 200이 되어 401이 아닌 것으로 갈린다.
      const res = type === 'query'
        ? await app.inject({ method: 'GET', url: `/trpc/${path}` })
        : await postPublic(app, path, {})
      if (res.statusCode !== 401) reachable.push(path)
    }
    expect(reachable.sort()).toEqual([...PUBLIC_PATHS].sort())
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
