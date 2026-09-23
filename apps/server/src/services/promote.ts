import { asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import {
  applyPromotePlan, planPromote,
  type ProjectModel, type PromoteStatus,
} from '@erdd/core'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { parsePayload } from './resource-library.js'
import type { Db } from '../db/client.js'
import type { runMutation } from './mutation.js'

type MutationTx = Parameters<typeof runMutation>[0]

/** 클라(또는 승인자)가 화면에서 본 계획. 서버는 락 안에서 재계산해 이 기대치와 대조한다. */
export type PromoteRequestEntry = {
  entityId: string
  expectedStatus: PromoteStatus
  expectedTargetItemId: string | null
  expectedTargetVersion: number | null
}

export type PromoteOutcome = {
  inserted: number
  updated: number
  skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[]
}

export function emptyOutcome(): PromoteOutcome {
  return { inserted: 0, updated: 0, skipped: [] }
}

/**
 * planPromote의 입력이 되는 라이브러리 항목을 읽는다.
 *
 * 요청 시점(promotion.create)과 승인 시점(runPromoteInTx), 그리고 CLI 가 계획을 세우는 데 읽는
 * resource.items.list 가 **같은 값**을 계산해야 하므로 조회를 한 곳에 둔다. orderBy는 장식이 아니라 planPromote의 동명 선점 순서를 정한다 — 한쪽만 바뀌면
 * 두 시점의 판정이 갈린다. 트랜잭션 안에서 잠글 때는 반환값에 .for('update')를 이어 붙인다.
 */
export function loadLibraryItems(dbOrTx: Db | MutationTx, libraryId: string) {
  return dbOrTx
    .select({
      id: resourceItems.id, kind: resourceItems.kind,
      payload: resourceItems.payload, version: resourceItems.version,
    })
    .from(resourceItems)
    .where(eq(resourceItems.libraryId, libraryId))
    // 동률은 id 로 깬다 — 한 트랜잭션의 승격이 넣은 행은 createdAt(트랜잭션 시작 시각)이 전부 같아
    // 순서가 비결정적이면 두 시점의 동명 선점이 갈린다.
    .orderBy(asc(resourceItems.createdAt), asc(resourceItems.id))
}

/**
 * 승격의 트랜잭션 본문 — runMutation의 prepare 훅 안에서 돈다.
 *
 * 라이브러리 항목을 FOR UPDATE로 잠그고 그 값으로 계획을 재계산해, 기대치와 일치하는 항목만
 * 쓴다. 이 락이 보장하는 것은 "이미 존재하는 항목에 대한 갱신을 직렬화하고, 계획이 잠근 행의
 * 값과 항상 일치한다"까지다(동시 INSERT는 막지 않는다 — 승격 설계 §9).
 *
 * 호출자는 두 곳이다: resource.promote(직접 승격)와 promotion.resolve(요청 승인).
 * 반환한 nextModel을 호출부의 deriveOps가 diffModels에 넣는다.
 */
export async function runPromoteInTx(
  tx: MutationTx,
  args: {
    libraryId: string
    model: ProjectModel
    entries: readonly PromoteRequestEntry[]
    /** 호출부가 소유하는 집계 객체 — 여기에 채운다. */
    outcome: PromoteOutcome
  },
): Promise<ProjectModel> {
  const items = await loadLibraryItems(tx, args.libraryId).for('update')
  const plan = planPromote(args.model, args.libraryId, items)
  const byEntity = new Map(plan.entries.map((entry) => [entry.entityId, entry]))

  const selected = new Set<string>()
  for (const req of args.entries) {
    const entry = byEntity.get(req.entityId)
    if (!entry) {
      args.outcome.skipped.push({ entityId: req.entityId, reason: 'missing' })
      continue
    }
    if (entry.status !== req.expectedStatus
      || entry.targetItemId !== req.expectedTargetItemId
      || entry.targetVersion !== req.expectedTargetVersion) {
      // targetVersion까지 대조해야 한다 — 상태·대상 id가 같아도 그 사이 다른 사람이 대상
      // 항목을 고쳤으면(버전만 바뀜) 화면의 미리보기가 이미 낡은 것이라 최신 편집을 덮어쓴다.
      args.outcome.skipped.push({ entityId: req.entityId, reason: 'plan-changed' })
      continue
    }
    selected.add(req.entityId)
  }

  const applied = applyPromotePlan(args.model, plan, selected, uuidv7)
  for (const write of applied.writes) {
    const payload = parsePayload(write.kind, write.payload)
    if (write.mode === 'insert') {
      await tx.insert(resourceItems).values({
        id: write.itemId, libraryId: args.libraryId,
        kind: write.kind, payload, version: write.version,
      })
      args.outcome.inserted += 1
    } else {
      await tx.update(resourceItems)
        .set({ payload, version: write.version, updatedAt: new Date() })
        .where(eq(resourceItems.id, write.itemId))
      args.outcome.updated += 1
    }
  }
  if (applied.writes.length > 0) {
    await tx.update(resourceLibraries).set({ updatedAt: new Date() })
      .where(eq(resourceLibraries.id, args.libraryId))
  }
  return applied.nextModel
}
