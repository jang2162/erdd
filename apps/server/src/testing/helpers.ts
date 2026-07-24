import { uuidv7 } from 'uuidv7'
import type { FastifyInstance } from 'fastify'
import type { ProjectModel } from '@erdd/core'
import { buildServer } from '../server.js'

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildServer({ databaseUrl: process.env.DATABASE_URL })
  await app.ready()
  return app
}

/** 로그인해 세션 쿠키 값을 반환한다. */
export async function loginAs(
  app: FastifyInstance, email: string, password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/trpc/auth.login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  const cookie = res.cookies.find((c) => c.name === 'erdd_session')
  if (!cookie) throw new Error('세션 쿠키 없음')
  return cookie.value
}

/** core 픽스처의 짧은 id를 UUID로 재매핑한다(DB uuid 컬럼용). 참조 필드도 함께 치환. */
export function withUuidIds(model: ProjectModel): ProjectModel {
  const map = new Map<string, string>()
  const nid = (old: string): string => {
    if (!map.has(old)) map.set(old, uuidv7())
    return map.get(old)!
  }
  const remapRecord = <T extends { id: string }>(
    rec: Record<string, T>, fix: (e: T) => T,
  ): Record<string, T> =>
    Object.fromEntries(Object.values(rec).map((e) => {
      const next = fix({ ...e, id: nid(e.id) })
      return [next.id, next]
    }))

  return {
    tableGroups: remapRecord(model.tableGroups, (g) => g),
    tables: remapRecord(model.tables, (t) => ({
      ...t, groupId: t.groupId === null ? null : nid(t.groupId),
    })),
    columns: remapRecord(model.columns, (c) => ({ ...c, tableId: nid(c.tableId) })),
    relationships: remapRecord(model.relationships, (r) => ({
      ...r,
      parentTableId: nid(r.parentTableId),
      childTableId: nid(r.childTableId),
      columnMappings: r.columnMappings.map((m) => ({
        childColumnId: nid(m.childColumnId),
        parentColumnId: nid(m.parentColumnId),
      })),
    })),
    indexes: remapRecord(model.indexes, (ix) => ({
      ...ix,
      tableId: nid(ix.tableId),
      columns: ix.columns.map((c) => ({ ...c, columnId: nid(c.columnId) })),
    })),
    notes: remapRecord(model.notes, (n) => n),
  }
}
