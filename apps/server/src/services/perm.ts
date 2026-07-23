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
