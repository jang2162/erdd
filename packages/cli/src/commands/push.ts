import {
  COLLECTION_BY_KIND, DIFF_KIND_LABEL, MAX_OPS_PER_MUTATION, entityDisplayName,
  type EntityKind, type Op, type ProjectModel,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { buildPlan, type PushPlan } from '../plan.js'
import { CliError, emit, note, type CliErrorCode } from '../output.js'
import { renderConflicts } from './conflict-report.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { syncDown } from './sync-down.js'

export type PushCtx = CommandCtx & { message?: string }

/** 서버 스키마의 summary 상한(z.string().min(1).max(200))과 맞춘다 — 자동/수동 요약 둘 다. */
const MAX_SUMMARY_LENGTH = 200

/**
 * client.ts의 CODE_MAP이 서버 *응답*에서 붙이는 코드. 살아있는 연결로 왕복해 서버가 직접
 * 거절한 것이라 반영 여부가 분명하다(아무것도 커밋되지 않았다) — outcome-unknown이 아니라
 * 평범한 오류로 run()까지 그대로 올려보낸다.
 */
const SERVER_REJECTION_CODES: ReadonlySet<CliErrorCode> = new Set(
  ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION'] satisfies CliErrorCode[],
)

/**
 * 삭제 확인 프롬프트의 한 줄. 되돌릴 수 없는 반영 직전 화면이라 "어느 것인지"가 남으면 안 된다 —
 * core의 표시 규칙(entityDisplayName)을 그대로 쓴다. 컬럼은 `MBR.MBR_NO`처럼 테이블로
 * 한정되고(픽스처만 해도 MBR_NO가 세 테이블에 있다) 이름 없는 관계는 `자식→부모`가 된다.
 * pruned 목록도 같은 규칙으로 만들어지므로 한 프롬프트 안에서 표기가 갈리지 않는다.
 */
function opLabel(server: ProjectModel, op: Op): string {
  const entity = (server[COLLECTION_BY_KIND[op.entity]] as Record<string, Record<string, unknown>>)[op.entityId]
  // note는 파일에 담기지 않아 push 계획에 나올 수 없다 — 그래도 타입이 허용하므로 id로 떨어뜨린다.
  if (op.entity === 'note' || entity === undefined) return `${DIFF_KIND_LABEL[op.entity]} ${op.entityId}`
  return `${DIFF_KIND_LABEL[op.entity]} ${entityDisplayName(op.entity, entity, [server])}`
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
  return `CLI push (${parts.join(' · ')})`.slice(0, MAX_SUMMARY_LENGTH)
}

async function confirmDeletes(ctx: PushCtx, plan: PushPlan): Promise<void> {
  const deletes = plan.ops.filter((op) => op.action === 'delete')
  if (deletes.length === 0 && plan.pruned.length === 0) return
  if (ctx.yes) return
  // 삭제(diff에 나오는 op)와 정리(pruned — 참조가 끊겨 병합이 대신 지운 것)는 근거가 달라
  // 각자 자기 개수만큼만 나열한다. 합쳐서 하나의 머릿수로 세면 목록과 숫자가 어긋난다.
  if (deletes.length > 0) {
    note(`삭제 ${deletes.length}건이 서버에 반영됩니다:`)
    for (const op of deletes) note(`  - ${opLabel(plan.server, op)}`)
  }
  if (plan.pruned.length > 0) {
    note(`참조가 끊겨 함께 정리되는 항목 ${plan.pruned.length}건:`)
    for (const p of plan.pruned) note(`  - ${p.label} (${p.reason})`)
  }
  // 비대화형(--json)에서는 confirm이 없다. 아무도 취소하지 않았는데 "취소했습니다"라고 하면
  // 이 CLI의 주 소비자인 에이전트가 원인도 해결책도 알 수 없다 — 무엇을 하면 되는지 말한다.
  if (ctx.confirm === undefined) {
    throw new CliError('CANCELLED', '확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요')
  }
  if (!await ctx.confirm('계속할까요?')) throw new CliError('CANCELLED', '사용자가 취소했습니다')
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
        // pruned는 diff에 안 잡히지만(merge가 참조 끊긴 것을 조용히 지웠으므로) 사용자가
        // 로컬에서 한 작업이 반영되지 않고 사라진 것이니 "변경 없음"이라도 알려야 한다.
        const message = plan.pruned.length > 0
          ? `변경 없음 (참조가 끊겨 정리된 항목 ${plan.pruned.length}건은 반영되지 않았습니다 — erdd pull로 확인하세요)`
          : '변경 없음'
        emit(ctx.json, message, {
          ok: true, revisionSeq: plan.seq, ops: 0,
          created: {}, updated: {}, deleted: {}, pruned: plan.pruned, retried,
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

      // model.push(mutate) 하나만 CONFLICT 재시도 대상이다. 이 아래(syncDown)에서 실패하면
      // 서버는 이미 커밋을 마쳤으므로, 같은 try에 묶어 두면 "재시도해야 할 실패"로
      // 잘못 분류돼 두 번째 model.push가 나가 중복 op가 생긴다(신규 id도 아직 파일에
      // 못 채워졌으니 base와 로컬이 서버가 이미 아는 엔티티를 다시 create로 잡는다).
      let seq: number
      try {
        const result = await client.mutate<{ seq: number }>('model.push', {
          projectId: config.projectId,
          expectedSeq: plan.seq,
          ops: plan.ops,
          // 빈 요약(`-m ""`)은 서버의 z.string().min(1)에 걸려 zod BAD_REQUEST가 된다.
          // 값을 안 준 것과 같이 보고 자동 요약으로 떨어뜨린다.
          summary: (ctx.message !== undefined && ctx.message !== ''
            ? ctx.message : autoSummary(plan.ops)).slice(0, MAX_SUMMARY_LENGTH),
        })
        seq = result.seq
      } catch (err) {
        const isConflict = err instanceof CliError && err.code === 'CONFLICT'
        if (isConflict) {
          if (attempt >= 1) throw err
          note('서버가 앞서 있어 다시 계산합니다')
          retried = true
          continue
        }
        // UNAUTHORIZED·FORBIDDEN·NOT_FOUND·VALIDATION은 서버가 요청을 받아 직접 거절한
        // 응답이다(client.ts의 CODE_MAP) — 전송 실패와 달리 반영 여부가 불분명하지 않다.
        // outcome-unknown으로 뭉뚱그리지 않고 평범한 오류로 그대로 올려보내 run()이
        // 처리하게 한다(호출자가 code로 분기할 수 있도록 이전과 동일하게 동작한다).
        if (err instanceof CliError && SERVER_REJECTION_CODES.has(err.code)) throw err
        // 그 외 실패(연결 끊김·프록시 타임아웃·커밋 직후 서버 재시작 등 전송 계층 실패)는
        // 요청이 서버에 닿았는지조차 알 수 없다. 그냥 실패로 보고하면 다음 push가 같은 것을
        // 새 uuid로 다시 만들어(filesToModel이 매번 새 id를 발급한다) 조용히 중복이 생긴다.
        // 여기서 재전송도 하지 않는다 — 커밋된 경우 그쪽이 바로 중복이다.
        const detail = err instanceof CliError ? err.message : (err as Error).message
        emit(
          ctx.json,
          `반영 여부를 확인할 수 없습니다 (변경 ${plan.ops.length}건) — 다시 push하기 전에 `
            + `erdd pull 또는 erdd diff로 서버 상태를 확인하세요 (${detail})`,
          {
            ok: false, outcomeUnknown: true, revisionSeq: null, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, pushError: detail,
            pushErrorCode: err instanceof CliError ? err.code : null,
          },
        )
        return 1
      }

      // 여기부터는 서버가 이미 커밋한 뒤다 — 실패해도 재시도하지 않고, "반영은 됐다"를
      // 분명히 구분해 알린다(재전송하면 중복 생성, 성공으로 보고하면 파일이 낡은 채 남는다).
      try {
        // 암묵적 pull — 신규 id가 파일에 채워지고 다음 status가 깨끗해진다.
        await syncDown(ctx.cwd, config, client)
      } catch (err) {
        const detail = err instanceof CliError ? err.message : (err as Error).message
        emit(
          ctx.json,
          `반영은 성공했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건). `
            + `파일 갱신에 실패했습니다 — erdd pull을 실행하세요 (${detail})`,
          {
            ok: false, committed: true, revisionSeq: seq, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, syncError: detail,
          },
        )
        return 1
      }

      emit(ctx.json, `반영했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건)`, {
        ok: true, revisionSeq: seq, ops: plan.ops.length,
        ...countByAction(plan.ops), pruned: plan.pruned, retried,
      })
      return 0
    }
  })
}
