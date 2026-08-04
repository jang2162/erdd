import {
  diffModelsForDisplay, DIFF_KIND_LABEL,
  type DiffChangeKind, type DiffEntry,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { buildPlan } from '../plan.js'
import { emit } from '../output.js'
import { renderConflicts } from './conflict-report.js'
import { clientFor, run, type CommandCtx } from './context.js'

const MARK: Record<DiffChangeKind, string> = { added: '+', removed: '-', changed: 'M' }

function section(title: string, entries: readonly DiffEntry[]): string {
  if (entries.length === 0) return `${title} 없음`
  return [
    `${title} ${entries.length}건`,
    ...entries.map((e) => {
      const head = `  ${MARK[e.changeKind]} ${DIFF_KIND_LABEL[e.kind]} ${e.label}`
      if (e.fields.length === 0) return head
      return `${head}  ${e.fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join(', ')}`
    }),
  ].join('\n')
}

export function diff(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const client = await clientFor(ctx)
    const plan = await buildPlan(ctx.cwd, config, client)

    // push와 같은 엔진을 쓴다 — 여기서 본 것과 실제 반영이 갈라질 수 없다.
    const up = diffModelsForDisplay(plan.base, plan.local)
    const down = diffModelsForDisplay(plan.base, plan.serverVisible)

    const human = [
      section('올릴 변경', up.entries),
      '',
      section('내려올 변경', down.entries),
      '',
      plan.conflicts.length === 0 ? '충돌 없음' : renderConflicts(plan.conflicts),
    ].join('\n')

    emit(ctx.json, human, {
      ok: plan.conflicts.length === 0,
      up: up.entries, down: down.entries, conflicts: plan.conflicts,
    })
    // 기본은 정보 제공이므로 0. --strict일 때만 충돌을 실패로 본다(validate의 선례).
    return plan.conflicts.length > 0 && ctx.strict ? 1 : 0
  })
}
