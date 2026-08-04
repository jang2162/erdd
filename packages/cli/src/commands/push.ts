import {
  COLLECTION_BY_KIND, DIFF_KIND_LABEL, MAX_OPS_PER_MUTATION,
  type EntityKind, type Op, type ProjectModel,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { buildPlan, type PushPlan } from '../plan.js'
import { CliError, emit, note } from '../output.js'
import { renderConflicts } from './conflict-report.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { syncDown } from './sync-down.js'

export type PushCtx = CommandCtx & { message?: string }

function opLabel(server: ProjectModel, op: Op): string {
  const entity = (server[COLLECTION_BY_KIND[op.entity]] as Record<string, Record<string, unknown>>)[op.entityId]
  const name = entity === undefined
    ? op.entityId
    : entity['physicalName'] ?? entity['name'] ?? entity['logicalName'] ?? op.entityId
  return `${DIFF_KIND_LABEL[op.entity]} ${String(name)}`
}

function countByAction(ops: readonly Op[]): {
  created: Record<string, number>; updated: Record<string, number>; deleted: Record<string, number>
} {
  const out = { created: {}, updated: {}, deleted: {} } as {
    created: Record<string, number>; updated: Record<string, number>; deleted: Record<string, number>
  }
  const bucket = { create: 'created', update: 'updated', delete: 'deleted' } as const
  for (const op of ops) {
    const target = out[bucket[op.action]]
    target[op.entity] = (target[op.entity] ?? 0) + 1
  }
  return out
}

function autoSummary(ops: readonly Op[]): string {
  const counts = new Map<EntityKind, number>()
  for (const op of ops) counts.set(op.entity, (counts.get(op.entity) ?? 0) + 1)
  const parts = [...counts.entries()].map(([kind, n]) => `${DIFF_KIND_LABEL[kind]} ${n}건`)
  return `CLI push (${parts.join(' · ')})`.slice(0, 200)
}

async function confirmDeletes(ctx: PushCtx, plan: PushPlan): Promise<void> {
  const deletes = plan.ops.filter((op) => op.action === 'delete')
  if (deletes.length === 0 && plan.pruned.length === 0) return
  if (ctx.yes) return
  note(`삭제 ${deletes.length}건이 서버에 반영됩니다:`)
  for (const op of deletes) note(`  - ${opLabel(plan.server, op)}`)
  for (const p of plan.pruned) note(`  - ${p.label} (${p.reason})`)
  const ok = ctx.confirm === undefined ? false : await ctx.confirm('계속할까요?')
  if (!ok) throw new CliError('CANCELLED', '사용자가 취소했습니다')
}

export function push(ctx: PushCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const client = await clientFor(ctx)
    let retried = false

    // 최대 2회. 계산과 반영 사이에 남이 커밋하면(CONFLICT) 한 번만 다시 계산한다.
    for (let attempt = 0; ; attempt++) {
      const plan = await buildPlan(ctx.cwd, config, client)

      if (plan.conflicts.length > 0) {
        emit(ctx.json, renderConflicts(plan.conflicts), { ok: false, conflicts: plan.conflicts })
        return 1
      }
      if (plan.ops.length === 0) {
        emit(ctx.json, '변경 없음', {
          ok: true, revisionSeq: plan.seq, ops: 0,
          created: {}, updated: {}, deleted: {}, pruned: [], retried,
        })
        return 0
      }
      if (plan.ops.length > MAX_OPS_PER_MUTATION) {
        // 서버가 거절하기 전에 막는다 — "단일 Revision = undo 1회" 계약 때문에 청크로 못 쪼갠다.
        throw new CliError(
          'VALIDATION',
          `변경이 ${plan.ops.length}건으로 한 번에 반영할 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다. 나눠서 반영하세요`,
        )
      }
      await confirmDeletes(ctx, plan)

      try {
        const { seq } = await client.mutate<{ seq: number }>('model.push', {
          projectId: config.projectId,
          expectedSeq: plan.seq,
          ops: plan.ops,
          summary: ctx.message ?? autoSummary(plan.ops),
        })
        // 암묵적 pull — 신규 id가 파일에 채워지고 다음 status가 깨끗해진다.
        await syncDown(ctx.cwd, config, client)
        emit(ctx.json, `반영했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건)`, {
          ok: true, revisionSeq: seq, ops: plan.ops.length,
          ...countByAction(plan.ops), pruned: plan.pruned, retried,
        })
        return 0
      } catch (err) {
        const isConflict = err instanceof CliError && err.code === 'CONFLICT'
        if (!isConflict || attempt >= 1) throw err
        note('서버가 앞서 있어 다시 계산합니다')
        retried = true
      }
    }
  })
}
