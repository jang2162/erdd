import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import { OpApplyError } from './op.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName,
  resourceEntitiesOf, resourcePayloadOf, type ResourceKind,
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
  /**
   * 원본이 프로젝트가 마지막으로 받은 버전보다 앞섰다 — 이 라이브러리에 링크된 엔티티이고
   * `origin.sourceVersion < targetVersion` 일 때만 true다(new·링크 없는 name-match는 false).
   * status는 payload 비교라 「프로젝트가 고쳤다」와 「남이 원본을 고쳤다」를 둘 다 update로 낸다.
   * 뒤쪽을 그대로 올리면 남이 고친 값이 프로젝트의 옛 값으로 조용히 되돌아가고, 서버의
   * expectedTargetVersion은 계획 **이후**의 변경만 막아 이 경우를 잡지 못한다 — 그래서 호출자가
   * 기본 선택에서 빼고 재동기화(충돌 정리)를 먼저 하게 하는 신호로 쓴다.
   */
  sourceBehind: boolean
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
 * resourceEntitiesOf는 Object.values 순서(= 모델에 쓰인 삽입 순서)를 낸다. 그 순서는
 * DB에서 다시 읽을 때(SELECT에 ORDER BY 없음) 보장되지 않으므로, "먼저 나온 항목이
 * 선점한다"는 승격 판정이 흔들리지 않도록 id(uuidv7 — 생성 순서) 오름차순으로 고정한다.
 * 클라와 서버가 같은 모델 내용에서 같은 순서로 이 함수를 부르면 항상 같은 결과를 낸다.
 */
function sortedResourceEntities(
  model: ProjectModel, kind: ResourceKind,
): { id: string; origin: Origin | null }[] {
  return [...resourceEntitiesOf(model, kind)].sort((a, b) => a.id.localeCompare(b.id))
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
    for (const entity of sortedResourceEntities(model, kind)) {
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
    for (const entity of sortedResourceEntities(model, kind)) {
      const raw = resourcePayloadOf(kind, entity as unknown as Record<string, unknown>)
      const payload = libraryPayload(kind, raw, linkedItemId)
      const name = resourceDisplayName(kind, raw)

      const linked = linkedItemId.get(entity.id)
      let target: LibraryItem | undefined
      let status: PromoteStatus
      let sourceBehind = false
      if (linked !== undefined) {
        target = itemById.get(linked)!
        if (deepEqual(payload, target.payload)) { syncedCount += 1; continue }
        status = 'update'
        // 링크가 있으면 origin은 이 라이브러리의 이 항목을 가리킨다(1단계의 조건).
        sourceBehind = entity.origin!.sourceVersion < target.version
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
        sourceBehind,
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

/**
 * 이 용어를 지금 올리면 라이브러리 용어의 도메인 연결이 비는가.
 * 도메인이 이미 라이브러리에 있거나(`targetItemId`) 같은 배치에서 함께 올라가면 연결된다.
 * 웹 승격 화면과 CLI `dict push` 가 같은 판정으로 알린다 — 한쪽만 알리면 다른 쪽에서 조용히 빈다.
 */
export function danglingDomain(entry: PromoteEntry, selected: ReadonlySet<string>): boolean {
  const ref = entry.domainRef
  if (!ref || ref.targetItemId !== null) return false
  return !selected.has(ref.entityId)
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
    const projected = libraryPayload(
      entry.kind, resourcePayloadOf(entry.kind, entity), itemIdByEntity)
    // 저장될 값(라이브러리 payload 스키마 파싱 결과)과 origin.base가 서로 다른 값에서
    // 파생되지 않도록, 여기서 한 번 파싱해 그 결과를 write.payload와 base 계산 모두에 쓴다 —
    // 스키마가 나중에 기본값·변환을 갖게 되어도 두 값이 갈라지지 않는다.
    const parsed = RESOURCE_PAYLOAD_SCHEMAS[entry.kind].safeParse(projected)
    if (!parsed.success) {
      throw new OpApplyError(
        `승격 payload 형식 오류(${entry.kind} ${entry.entityId}) — ${parsed.error.message}`)
    }
    const payload = parsed.data as Record<string, unknown>
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
