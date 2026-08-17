import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_NAMING_RULES } from '@erdd/core'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { createAccount } from '../services/accounts.js'
import { eq } from 'drizzle-orm'
import { projects } from '../db/schema.js'

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
    expect(got.json().result.data.canEdit).toBe(false)
    expect(got.json().result.data.canManage).toBe(false)

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

  it('project member with editor role can read but not change settings', async () => {
    const projectId = await createProject()
    const orgMembers = (await get(app, 'org.members.list', ownerToken, { orgId }))
      .json().result.data as Array<{ id: string; email: string }>
    const m = orgMembers.find((x) => x.email === 'm@test.dev')!

    await post(app, 'project.members.add', ownerToken, {
      projectId, memberId: m.id, role: 'editor',
    })
    const got = await get(app, 'project.get', memberToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.myRole).toBe('editor')
    expect(got.json().result.data.canEdit).toBe(true)
    expect(got.json().result.data.canManage).toBe(false)

    const upd = await post(app, 'project.update', memberToken, { projectId, name: '변경' })
    expect(upd.statusCode).toBe(403)
  })

  it('project.get grants canEdit and canManage to the org owner (also auto-added as project admin)', async () => {
    // project.create가 생성자를 projectMembers role='admin'으로 자동 삽입하므로(project.ts:36-40),
    // 여기서 owner는 isOrgManager이면서 동시에 projectRole==='admin'이다 — 이 테스트는
    // canManage = isOrgManager || projectRole === 'admin'의 어느 가지가 true를 만드는지
    // 구분하지 못한다. 라우터 배선 회귀(전혀 허용 안 하는 경우)는 여전히 잡는다.
    // isOrgManager 단독 경로는 아래 '프로젝트 멤버가 아닌 org admin' 테스트가 검증한다.
    const projectId = await createProject()
    const got = await get(app, 'project.get', ownerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.canEdit).toBe(true)
    expect(got.json().result.data.canManage).toBe(true)
  })

  it('org admin who is not a project member still gets canEdit/canManage via isOrgManager alone', async () => {
    // project.create가 생성자만 project admin으로 넣으므로, org admin을 새로 만들어 프로젝트에는
    // 추가하지 않으면 projectRole은 undefined로 남는다. 이 상태에서 canEdit/canManage가 true라면
    // isOrgManager 가지 하나만으로 만들어진 것이다(projectRole===undefined이므로 다른 가지는
    // 전부 false).
    const projectId = await createProject()
    await createAccount(app.db!, { email: 'a@test.dev', name: '조직관리자', password: 'password-a', role: 'user' })
    const adminToken = await loginAs(app, 'a@test.dev', 'password-a')
    await post(app, 'org.members.add', ownerToken, { orgId, email: 'a@test.dev', role: 'admin' })

    const got = await get(app, 'project.get', adminToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.myRole).toBeNull()
    expect(got.json().result.data.myOrgRole).toBe('admin')
    expect(got.json().result.data.canEdit).toBe(true)
    expect(got.json().result.data.canManage).toBe(true)
  })

  it('project.get returns DEFAULT_NAMING_RULES when the project has no explicit override', async () => {
    const projectId = await createProject()
    const got = await get(app, 'project.get', ownerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.namingRules).toEqual(DEFAULT_NAMING_RULES)
  })

  it('logicalSeparator 키가 없는 기존 행에 기본값을 주입해 내려준다', async () => {
    const projectId = await createProject()
    // 마이그레이션 이전 모양으로 되돌린다(DB 컬럼 기본값은 여전히 이 3키다).
    await app.db!.update(projects)
      .set({ namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 } as never })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('_')
  })

  it('명시된 logicalSeparator 는 그대로 내려준다', async () => {
    const projectId = await createProject()
    await app.db!.update(projects)
      .set({ namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '',
      } })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('')
  })

  // ⚠️ 읽기 스키마의 `.default('_')` 가 쓰기 입력에도 걸리면 **부분 페이로드가 전체 덮어쓰기**가
  // 된다 — 3키만 보낸 클라이언트가 꺼 둔 프로젝트('')를 조용히 켠다. 읽기 기본값 주입과 쓰기
  // 검증은 목적이 반대라 스키마를 나눈다.
  it('logicalSeparator 가 빠진 namingRules 는 update 가 거절하고 꺼 둔 값을 지킨다', async () => {
    const projectId = await createProject()
    const off = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '',
      },
    })
    expect(off.statusCode).toBe(200)

    const partial = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 },
    })
    expect(partial.statusCode).toBe(400)

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('')
  })

  it('tablePhysicalTemplate 키가 없는 기존 행에 빈 문자열을 주입해 내려준다', async () => {
    const projectId = await createProject()
    await app.db!.update(projects)
      .set({ namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
      } as never })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.tablePhysicalTemplate).toBe('')
  })

  it('설정된 템플릿은 그대로 내려준다', async () => {
    const projectId = await createProject()
    await app.db!.update(projects)
      .set({ namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}',
      } })
      .where(eq(projects.id, projectId))

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
  })

  // ⚠️ 급소. strict 스키마가 .default('') 를 물려받으면 4키만 보낸 클라이언트가 설정해 둔
  // 템플릿을 조용히 지운다 — 부분 페이로드가 전체 덮어쓰기로 둔갑한다.
  it('tablePhysicalTemplate 가 빠진 namingRules 는 update 가 거절하고 설정값을 지킨다', async () => {
    const projectId = await createProject()
    const set = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'TB_{물리명}',
      },
    })
    expect(set.statusCode).toBe(200)

    const partial = await post(app, 'project.update', ownerToken, {
      projectId,
      // tablePhysicalTemplate 를 일부러 뺀 옛 클라이언트 페이로드
      namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 },
    })
    expect(partial.statusCode).toBe(400)

    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.tablePhysicalTemplate).toBe('TB_{물리명}')
  })

  it('update 로 템플릿을 바꿀 수 있다', async () => {
    const projectId = await createProject()
    const res = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: 'PRE_{논리명}',
      },
    })
    expect(res.statusCode).toBe(200)
    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.tablePhysicalTemplate).toBe('PRE_{논리명}')
  })

  it('update 로 logicalSeparator 를 바꿀 수 있다', async () => {
    const projectId = await createProject()
    const res = await post(app, 'project.update', ownerToken, {
      projectId,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '',
      },
    })
    expect(res.statusCode).toBe(200)
    const got = (await get(app, 'project.get', ownerToken, { projectId })).json().result.data
    expect(got.namingRules.logicalSeparator).toBe('')
  })

  it('project.update persists namingRules and project.get reflects the new value', async () => {
    const projectId = await createProject()
    const customRules = {
      case: 'lower_snake' as const, separator: '' as const, logicalSeparator: '_' as const, maxLengthBytes: 63,
      tablePhysicalTemplate: '' as const,
    }

    const upd = await post(app, 'project.update', ownerToken, {
      projectId, namingRules: customRules,
    })
    expect(upd.statusCode).toBe(200)

    const got = await get(app, 'project.get', ownerToken, { projectId })
    expect(got.statusCode).toBe(200)
    expect(got.json().result.data.namingRules).toEqual(customRules)
  })

  it('rejects a memberId that belongs to a different organization', async () => {
    const projectId = await createProject()
    const otherOrgId = (await post(app, 'org.create', ownerToken, { name: '팀B' }))
      .json().result.data.id as string
    const otherOrgMembers = (await get(app, 'org.members.list', ownerToken, { orgId: otherOrgId }))
      .json().result.data as Array<{ id: string }>
    const otherMemberId = otherOrgMembers[0]!.id

    const res = await post(app, 'project.members.add', ownerToken, {
      projectId, memberId: otherMemberId, role: 'viewer',
    })
    expect(res.statusCode).toBe(404)
  })
})
