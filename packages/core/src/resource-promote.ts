import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, resourceDisplayName, resourceEntitiesOf,
  resourcePayloadOf, type ResourceKind,
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
  raw: Record<string, unknown>,
  model: ProjectModel,
  linkedItemId: ReadonlyMap<string, string>,
): { entityId: string; targetItemId: string | null } | null {
  if (kind !== 'term') return null
  const domainId = raw.domainId
  if (typeof domainId !== 'string') return null
  if (!Object.hasOwn(model.domains, domainId)) return null   // dangling — 참조 없음으로 본다
  return { entityId: domainId, targetItemId: linkedItemId.get(domainId) ?? null }
}

export type PromoteWrite = {
  mode: 'insert' | 'update'
  itemId: string
  kind: ResourceKind
  payload: Record<string, unknown>
  /** 저장할 버전 — insert면 1, update면 targetVersion + 1. */
  version: number
}

/**
 * 라이브러리 공간 payload를 프로젝트 공간으로 되투영한다(origin.base 계산용).
 * base는 "가져오기 직후"와 같아야 하므로 import 경로와 같은 규칙을 한 번 더 통과시킨다 —
 * 도메인을 함께 올리지 않은 용어는 base.domainId가 null이 되어 "프로젝트가 고침"으로 잡히고,
 * 나중에 auto-update가 조용히 도메인 연결을 지우는 사고를 막는다.
 */
function projectSpace(
  kind: ResourceKind,
  payload: Record<string, unknown>,
  entityByItemId: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const itemId = payload.domainId
  const mapped = typeof itemId === 'string' ? entityByItemId.get(itemId) ?? null : null
  return { ...payload, domainId: mapped }
}

/**
 * 선택된 항목에 대해 라이브러리 write 목록과 origin이 갱신된 다음 모델을 함께 낸다(입력 모델 불변).
 * 선택이 비면 입력 모델을 그대로 돌려준다(diffModels가 빈 배열을 내 뮤테이션이 일어나지 않는다).
 */
export function applyPromotePlan(
  model: ProjectModel,
  plan: PromotePlan,
  selected: ReadonlySet<string>,
  newId: () => string,
): { writes: PromoteWrite[]; nextModel: ProjectModel } {
  const chosen = plan.entries.filter((entry) => selected.has(entry.entityId))
  if (chosen.length === 0) return { writes: [], nextModel: model }

  // 1) 색인 완성 — 이미 링크된 것 + 이번 배치에서 대상이 정해지는 것.
  //    같은 배치의 도메인을 용어가 참조할 수 있어야 하므로 id를 먼저 전부 발급한다.
  //    계획을 세운 뒤 삭제된 엔티티는 여기서부터 제외한다 — id를 미리 발급해버리면
  //    형제 항목(예: 함께 선택된 용어)의 참조가 실제로 쓰이지 않는 유령 id를 가리키게 된다.
  const itemIdByEntity = new Map(Object.entries(plan.linkedItemIds))
  for (const entry of chosen) {
    const collection = model[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
      Record<string, unknown>
    if (!Object.hasOwn(collection, entry.entityId)) continue
    itemIdByEntity.set(entry.entityId, entry.targetItemId ?? newId())
  }
  const entityByItemId = new Map<string, string>()
  for (const [entityId, itemId] of itemIdByEntity) entityByItemId.set(itemId, entityId)

  const next: ProjectModel = {
    ...model,
    domains: { ...model.domains },
    words: { ...model.words },
    terms: { ...model.terms },
    customFields: { ...model.customFields },
  }

  const writes: PromoteWrite[] = []
  for (const entry of chosen) {
    const collection = next[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
      Record<string, Record<string, unknown>>
    const entity = collection[entry.entityId]
    if (!entity) continue   // 위 존재 확인과 같은 조건 — id 발급 단계에서 이미 걸러졌다
    const itemId = itemIdByEntity.get(entry.entityId)!
    const payload = libraryPayload(
      entry.kind, resourcePayloadOf(entry.kind, entity), itemIdByEntity)
    const version = entry.targetVersion === null ? 1 : entry.targetVersion + 1
    writes.push({
      mode: entry.targetItemId === null ? 'insert' : 'update',
      itemId, kind: entry.kind, payload, version,
    })
    const origin: Origin = {
      libraryId: plan.libraryId,
      sourceId: itemId,
      sourceVersion: version,
      base: projectSpace(entry.kind, payload, entityByItemId),
    }
    collection[entry.entityId] = { ...entity, origin }
  }

  return { writes, nextModel: next }
}
