import type { Op, ProjectModel } from '@erdd/core'
import type { Db } from '../db/client.js'
import { runMutation } from './mutation.js'
import type { RealtimeHub } from './realtime.js'

/**
 * 모델 변경의 유일한 외부 진입점.
 *
 * 트랜잭션이 **커밋으로 resolve된 뒤에만** 브로드캐스트하므로 롤백된 op가 채널로 나가는 일이
 * 구조적으로 불가능하다. 새 변경 경로(예: Phase 4 CLI push)도 반드시 이 함수를 거쳐야 한다 —
 * 라우터마다 따로 발행하면 "새 호출처에서 브로드캐스트를 깜빡"이 필연이다.
 *
 * runMutation이 던지는 OpApplyError는 그대로 통과시킨다(호출부가 BAD_REQUEST로 매핑).
 */
export async function mutateAndPublish(
  db: Db,
  hub: RealtimeHub,
  args: {
    projectId: string
    actorUserId: string
    actorName: string
    source: 'web' | 'cli' | 'system'
    deriveOps: (model: ProjectModel) => Op[]
    summary?: string
  },
): Promise<{ seq: number }> {
  const { seq, ops } = await db.transaction((tx) => runMutation(tx, {
    projectId: args.projectId,
    actorUserId: args.actorUserId,
    source: args.source,
    deriveOps: args.deriveOps,
    summary: args.summary,
  }))
  if (ops.length > 0) {
    hub.publishOps(args.projectId, {
      seq, ops, actorUserId: args.actorUserId, actorName: args.actorName,
    })
  }
  return { seq }
}
