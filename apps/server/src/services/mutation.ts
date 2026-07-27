import { desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { applyOps, COLLECTION_BY_KIND, type EntityKind, type Op, type ProjectModel } from '@erdd/core'
import { revisions } from '../db/schema.js'
import { loadProjectModel, persistOps } from './model-store.js'

type MutationTx = Parameters<typeof loadProjectModel>[0]

const KIND_LABEL: Record<EntityKind, string> = {
  table: '테이블', column: '컬럼', relationship: '관계',
  index: '인덱스', note: '메모', tableGroup: '그룹', domain: '도메인',
  word: '단어', term: '용어', customField: '커스텀 항목',
}
const ACTION_LABEL = { create: '생성', update: '수정', delete: '삭제' } as const

export function summarizeOps(ops: readonly Op[]): string {
  const first = ops[0]!
  const head = `${KIND_LABEL[first.entity]} ${ACTION_LABEL[first.action]}`
  return ops.length === 1 ? head : `${head} 외 ${ops.length - 1}건`
}

/** update.from / delete.before를 서버의 현재 값으로 재기록한다(Revision 로그의 정확성 보장). */
function withAuthoritativeHistory(model: ProjectModel, ops: readonly Op[]): Op[] {
  return ops.map((op) => {
    const collection = model[COLLECTION_BY_KIND[op.entity]] as Record<string, Record<string, unknown>>
    const current = Object.hasOwn(collection, op.entityId) ? collection[op.entityId] : undefined
    if (op.action === 'update' && current) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const [prop, change] of Object.entries(op.changes)) {
        changes[prop] = { from: current[prop], to: change.to }
      }
      return { ...op, changes }
    }
    if (op.action === 'delete' && current) return { ...op, before: current }
    return op
  })
}

export async function currentSeq(tx: MutationTx, projectId: string): Promise<number> {
  const rows = await tx.select({ seq: revisions.seq }).from(revisions)
    .where(eq(revisions.projectId, projectId)).orderBy(desc(revisions.seq)).limit(1)
  return rows[0]?.seq ?? 0
}

/**
 * 단일 변경 경로. 트랜잭션 콜백 안에서 호출한다.
 * deriveOps가 빈 배열을 반환하면(변경 없음) Revision 없이 현재 seq를 반환한다.
 * applyOps의 OpApplyError는 그대로 throw하므로 호출부가 BAD_REQUEST로 매핑한다.
 */
export async function runMutation(
  tx: MutationTx,
  args: {
    projectId: string
    actorUserId: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]
    summary?: string
  },
): Promise<{ seq: number }> {
  const locked = await tx.execute(sql`SELECT id FROM projects WHERE id = ${args.projectId} FOR UPDATE`)
  if (locked.rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다' })
  }
  const model = await loadProjectModel(tx, args.projectId)
  const ops = args.deriveOps(model)
  const seqNow = await currentSeq(tx, args.projectId)
  if (ops.length === 0) return { seq: seqNow }
  const authoritative = withAuthoritativeHistory(model, ops)
  applyOps(model, authoritative) // OpApplyError → 호출부가 매핑
  await persistOps(tx, args.projectId, authoritative)
  const seq = seqNow + 1
  await tx.insert(revisions).values({
    id: uuidv7(),
    projectId: args.projectId,
    seq,
    actorUserId: args.actorUserId,
    source: args.source,
    ops: authoritative,
    summary: args.summary ?? summarizeOps(authoritative),
  })
  return { seq }
}
