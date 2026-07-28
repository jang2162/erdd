import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { resourceLibraries } from '../db/schema.js'
import { getOrgMember } from './perm.js'

export type LibraryRow = typeof resourceLibraries.$inferSelect
type Actor = { id: string; role: 'admin' | 'user' }

async function loadLibrary(db: Db, libraryId: string): Promise<LibraryRow> {
  const row = (
    await db.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId))
  )[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
  return row
}

/** 전역은 인증 사용자 전체, 조직은 해당 조직 멤버만 읽는다. */
export async function requireScopeRead(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') return
  if (!orgId || !(await getOrgMember(db, orgId, actor.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 접근 권한이 없습니다' })
  }
}

/** 전역은 서비스 관리자, 조직은 Org Owner/Admin만 쓴다. */
export async function requireScopeWrite(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') {
    if (actor.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '전역 리소스는 서비스 관리자만 관리할 수 있습니다' })
    }
    return
  }
  const me = orgId ? await getOrgMember(db, orgId, actor.id) : undefined
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 관리 권한이 없습니다' })
  }
}

export async function requireLibraryRead(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeRead(db, library.scope, library.orgId, actor)
  return library
}

export async function requireLibraryWrite(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeWrite(db, library.scope, library.orgId, actor)
  return library
}
