import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { members, projectMembers, projects } from '../db/schema.js'

export type OrgRole = 'owner' | 'admin' | 'member'
export type ProjectRole = 'admin' | 'editor' | 'viewer'

export async function getOrgMember(
  db: Db, orgId: string, userId: string,
): Promise<{ id: string; role: OrgRole } | undefined> {
  const rows = await db
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.userId, userId)))
  return rows[0]
}

/** Org Owner/Admin만 통과시킨다. 조직 멤버 관리·초대가 같은 기준을 쓴다. */
export async function requireOrgManager(
  db: Db, orgId: string, userId: string,
): Promise<{ id: string; role: OrgRole }> {
  const me = await getOrgMember(db, orgId, userId)
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 관리 권한이 없습니다' })
  }
  return me
}

export type ProjectAccess = {
  project: typeof projects.$inferSelect
  orgRole: OrgRole | undefined
  projectRole: ProjectRole | undefined
  /** Org Owner/Admin 또는 Project Admin */
  canManage: boolean
  /** 조회 가능 여부 */
  canView: boolean
  /** 스키마 편집 가능(Org Owner/Admin ∨ Project Admin/Editor) */
  canEdit: boolean
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
    canEdit: isOrgManager || projectRole === 'admin' || projectRole === 'editor',
  }
}

export async function requireProjectAccess(
  db: Db, projectId: string, userId: string, level: 'view' | 'edit' | 'manage',
): Promise<ProjectAccess> {
  const access = await getProjectAccess(db, projectId, userId)
  if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  const allowed =
    level === 'view' ? access.canView : level === 'edit' ? access.canEdit : access.canManage
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: '프로젝트 접근 권한이 없습니다' })
  return access
}
