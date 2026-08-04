import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import {
  RESOURCE_KINDS, resourceDisplayName, resourceEntitiesOf, resourcePayloadOf,
  type ResourceKind,
} from './resource.js'
import type { LibraryItem } from './resource-sync.js'

export type PromoteStatus = 'new' | 'update' | 'name-match'

export type PromoteEntry = {
  kind: ResourceKind
  /** 프로젝트 엔티티 id — 선택·요청의 키다. */
  entityId: string
  name: string
  status: PromoteStatus
  /** update/name-match면 갱신할 원본 항목 id. new면 null. */
  targetItemId: string | null
  /** 그 원본 항목의 현재 버전. new면 null. */
  targetVersion: number | null
  /**
   * 라이브러리 공간으로 역투영한 **잠정** payload. 이미 링크된 도메인만 해석하며,
   * 같은 배치에서 함께 승격되는 도메인은 applyPromotePlan이 최종 해석한다.
   */
  payload: Record<string, unknown>
  /** 원본 항목 payload 대비 바뀐 필드. new면 []. */
  changedFields: string[]
  /** term의 도메인 참조. targetItemId가 null이면 "함께 승격해야 연결된다"는 뜻이다. */
  domainRef: { entityId: string; targetItemId: string | null } | null
}

export type PromotePlan = {
  libraryId: string
  entries: PromoteEntry[]
  /** 대상에서 왔고 값이 같아 목록에서 제외된 항목 수. */
  syncedCount: number
  /** 프로젝트 엔티티 id → 대상 라이브러리 항목 id. 살아 있는 링크만 담는다(역투영 색인의 기반). */
  linkedItemIds: Record<string, string>
}

/**
 * 프로젝트 공간 payload를 라이브러리 공간으로 역투영한다(resource-sync의 projectPayload 반대).
 * 참조를 갖는 종류는 term(domainId)뿐이다. 색인에 없으면 null — 도메인을 함께 올리지 않아도
 * 용어 자체는 유효하게 올라간다.
 */
export function libraryPayload(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  itemIdByEntity: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const projectDomainId = payload.domainId
  const mapped = typeof projectDomainId === 'string'
    ? itemIdByEntity.get(projectDomainId) ?? null
    : null
  return { ...payload, domainId: mapped }
}

function nameKey(kind: ResourceKind, name: string): string {
  return `${kind}:${name.trim()}`
}

/**
 * 프로젝트 모델과 대상 라이브러리 항목을 비교해 승격 계획을 만든다.
 * "이미 올라가 있다"의 판정은 payload 비교다 — 재동기화와 달리 버전으로는 판정할 수 없다
 * (프로젝트가 원본을 마지막으로 본 시점이 아니라 지금 값이 같은지가 관심사다).
 */
export function planPromote(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): PromotePlan {
  const itemById = new Map(items.map((item) => [item.id, item]))

  // 1) 살아 있는 링크. 두 엔티티가 같은 원본을 가리키면 먼저 나온 쪽만 인정한다.
  const linkedItemId = new Map<string, string>()
  const claimed = new Set<string>()
  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      const origin = entity.origin
      if (!origin || origin.libraryId !== libraryId) continue
      if (!itemById.has(origin.sourceId) || claimed.has(origin.sourceId)) continue
      linkedItemId.set(entity.id, origin.sourceId)
      claimed.add(origin.sourceId)
    }
  }

  // 2) 동명 색인 — 이미 누군가 링크한 항목은 대상에서 뺀다.
  const itemByName = new Map<string, LibraryItem>()
  for (const item of items) {
    if (claimed.has(item.id)) continue
    const key = nameKey(item.kind, resourceDisplayName(item.kind, item.payload))
    if (!itemByName.has(key)) itemByName.set(key, item)
  }

  const entries: PromoteEntry[] = []
  let syncedCount = 0

  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      const raw = resourcePayloadOf(kind, entity as unknown as Record<string, unknown>)
      const payload = libraryPayload(kind, raw, linkedItemId)
      const name = resourceDisplayName(kind, raw)

      const linked = linkedItemId.get(entity.id)
      let target: LibraryItem | undefined
      let status: PromoteStatus
      if (linked !== undefined) {
        target = itemById.get(linked)!
        if (deepEqual(payload, target.payload)) { syncedCount += 1; continue }
        status = 'update'
      } else {
        target = itemByName.get(nameKey(kind, name))
        if (target && claimed.has(target.id)) target = undefined
        status = target ? 'name-match' : 'new'
        if (target) claimed.add(target.id)
      }

      entries.push({
        kind,
        entityId: entity.id,
        name,
        status,
        targetItemId: target?.id ?? null,
        targetVersion: target?.version ?? null,
        payload,
        changedFields: target
          ? Object.keys(payload).filter((prop) => !deepEqual(payload[prop], target!.payload[prop]))
          : [],
        domainRef: domainRefOf(kind, raw, model, linkedItemId),
      })
    }
  }

  const kindOrder = new Map(RESOURCE_KINDS.map((k, i) => [k, i]))
  entries.sort((a, b) =>
    kindOrder.get(a.kind)! - kindOrder.get(b.kind)! || a.name.localeCompare(b.name))

  return { libraryId, entries, syncedCount, linkedItemIds: Object.fromEntries(linkedItemId) }
}

function domainRefOf(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  model: ProjectModel,
  linkedItemId: ReadonlyMap<string, string>,
): { entityId: string; targetItemId: string | null } | null {
  if (kind !== 'term') return null
  const domainId = payload.domainId
  if (typeof domainId !== 'string') return null
  if (!Object.hasOwn(model.domains, domainId)) return null   // dangling — 참조 없음으로 본다
  return { entityId: domainId, targetItemId: linkedItemId.get(domainId) ?? null }
}
