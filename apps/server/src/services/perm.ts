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
