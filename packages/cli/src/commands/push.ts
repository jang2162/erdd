import {
  COLLECTION_BY_KIND, DIFF_KIND_LABEL, MAX_OPS_PER_MUTATION, entityDisplayName,
  type EntityKind, type Op, type ProjectModel,
} from '@erdd/core'
import { readConfig, requireConnection } from '../config.js'
import { buildPlan, type PushPlan } from '../plan.js'
import { CliError, emit, note, type CliErrorCode } from '../output.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
import { renderConflicts } from './conflict-report.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { reserveIds } from './reserve-ids.js'
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
    const connection = requireConnection(config)
    // 미저장 편집이 **실제로 서버로 새어 나가는 유일한 자리**가 push 다 — 알림만 낸다.
    // stderr 라 `--json` 봉투를 건드리지 않고, 판정·종료 코드도 그대로다(설계 D3).
    if (await hasDraft(ctx.cwd)) note(UNSAVED_NOTICE)
    const client = await clientFor(ctx)
    let retried = false
    // 시도를 가로질러 누적한다. CONFLICT로 다시 계산하면 두 번째 reserveIds는 아무것도 쓸
    // 것이 없어(첫 시도가 이미 박아 뒀다) 빈 배열을 돌려주는데, 시도마다 덮어쓰면 그 빈
    // 배열이 첫 시도의 결과를 지운다 — 파일은 실제로 바뀌었는데 봉투는 "그대로"라고 말하고,
    // 같은 봉투의 사람용 문구("id를 파일에 기록해 두었으므로")와 정면으로 어긋난다.
    const reserved = new Set<string>()
    /**
     * 지금까지 실제로 기록한 파일들(정렬). 재시도로 다시 도는 갈래도 이 값을 봉투에 실어야
     * 한다 — 첫 시도가 파일을 이미 바꿔 놓았는데 두 번째 계산에서 끝나면, --json 소비자는
     * 워킹트리가 재작성된 사실을 알 길이 없다. 첫 시도에서는 아직 빈 배열이다.
     */
    let reservedFiles: string[] = []

    // 최대 2회. 계산과 반영 사이에 남이 커밋하면(CONFLICT) 한 번만 다시 계산한다.
    for (let attempt = 0; ; attempt++) {
      const plan = await buildPlan(ctx.cwd, connection, client)

      if (plan.conflicts.length > 0) {
        emit(ctx.json, renderConflicts(plan.conflicts), {
          ok: false, conflicts: plan.conflicts, reservedFiles,
        })
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
          { reservedFiles },
        )
      }
      await confirmDeletes(ctx, plan)

      // 서버로 보내기 직전에 신규 id를 파일에 박는다. 이 뒤로 무슨 일이 있어도 파일이 id를
      // 쥐고 있으므로, 응답이 유실돼 사용자가 다시 push해도 서버는 "이미 있는 것"으로 본다.
      // 여기서 실패하면 전송하지 않고 그대로 던진다 — id를 못 남긴 채 보내면 바로 그 사본
      // 문제가 남는다. 실패해도 기록한 id를 되돌리지 않는다(되돌리는 순간 문제가 부활한다).
      for (const rel of await reserveIds(ctx.cwd, plan.localTree, plan.assignedTree)) reserved.add(rel)
      reservedFiles = [...reserved].sort()

      // model.push(mutate) 하나만 CONFLICT 재시도 대상이다. 이 아래(syncDown)에서 실패하면
      // 서버는 이미 커밋을 마쳤으므로, 같은 try에 묶어 두면 "재시도해야 할 실패"로 잘못
      // 분류돼 재계산 루프로 돌아간다. 그 재계산은 이미 커밋된 서버 상태를 다시 읽으므로
      // ops가 0건이 되고("변경 없음"), push는 exit 0으로 끝난다 — syncDown이 죽어 파일이
      // 낡은 채 남았다는 사실이 성공 보고 뒤에 숨는다. 문제는 중복 리비전이 아니라 실패의
      // 은폐다(신규 id는 위에서 이미 파일에 박았으므로 create가 중복되지는 않는다).
      let seq: number
      try {
        const result = await client.mutate<{ seq: number }>('model.push', {
          projectId: connection.projectId,
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
        // 요청이 서버에 닿았는지조차 알 수 없다. 신규 id는 위에서 파일에 박아 두었으므로
        // 사용자가 그대로 다시 push해도 사본은 생기지 않지만, 반영 여부 자체는 여전히
        // 알 수 없으니 성공으로 뭉뚱그리지 않고 그 사실을 그대로 알린다.
        // 여기서 자동 재전송은 하지 않는다 — 이미 커밋된 경우 리비전이 하나 더 생긴다.
        const detail = err instanceof CliError ? err.message : (err as Error).message
        // 신규 항목이 없는 push(update만 있는 경우)에서는 기록한 파일도 없다. 그때도
        // "id를 파일에 기록해 두었으므로"라고 말하면 근거가 거짓이라, 사용자·에이전트가
        // 바뀌지도 않은 파일을 확인하러 간다. 결론(다시 push해도 수렴한다)만 남긴다.
        //
        // 확인 수단으로 erdd pull을 권하지 않는다. 반영되지 않았다면 pull은 서버 상태로
        // 트리를 다시 쓰면서(writeTree의 삭제 패스) 방금 기록한 id째로 로컬 변경을 지운다 —
        // 바로 앞 문장의 "그대로 다시 push하면 수렴한다"를 스스로 무효화한다. erdd diff는
        // 읽기만 하므로 안전하다. pull도 알려는 주되 그 대가를 함께 말한다.
        const resumeHint = reservedFiles.length > 0
          ? '신규 항목의 id를 파일에 기록해 두었으므로 그대로 다시 push하면 중복 없이 수렴합니다. '
            + '먼저 확인하려면 erdd diff를 실행하세요 — erdd pull은 반영되지 않았을 경우 '
            + '그 id까지 서버 상태로 덮어써 지웁니다. '
          : '그대로 다시 push하면 중복 없이 수렴합니다. '
            + '먼저 확인하려면 erdd diff를 실행하세요 — erdd pull은 반영되지 않았을 경우 '
            + '이번 로컬 변경을 서버 상태로 덮어써 지웁니다. '
        emit(
          ctx.json,
          `반영 여부를 확인할 수 없습니다 (변경 ${plan.ops.length}건) — ${resumeHint}(${detail})`,
          {
            ok: false, outcomeUnknown: true, revisionSeq: null, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
            pushError: detail,
            pushErrorCode: err instanceof CliError ? err.code : null,
          },
        )
        return 1
      }

      // 여기부터는 서버가 이미 커밋한 뒤다 — 실패해도 재시도하지 않고, "반영은 됐다"를
      // 분명히 구분해 알린다(재전송하면 중복 생성, 성공으로 보고하면 파일이 낡은 채 남는다).
      try {
        // 암묵적 pull — 신규 id가 파일에 채워지고 다음 status가 깨끗해진다.
        await syncDown(ctx.cwd, connection, client)
      } catch (err) {
        const detail = err instanceof CliError ? err.message : (err as Error).message
        emit(
          ctx.json,
          `반영은 성공했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건). `
            + `파일 갱신에 실패했습니다 — erdd pull을 실행하세요 (${detail})`,
          {
            ok: false, committed: true, revisionSeq: seq, ops: plan.ops.length,
            ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
            syncError: detail,
          },
        )
        return 1
      }

      emit(ctx.json, `반영했습니다 (리비전 ${seq}, 변경 ${plan.ops.length}건)`, {
        ok: true, revisionSeq: seq, ops: plan.ops.length,
        ...countByAction(plan.ops), pruned: plan.pruned, retried, reservedFiles,
      })
      return 0
    }
  })
}
