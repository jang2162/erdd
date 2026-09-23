import { deepEqual } from './equal.js'
import type { Origin, ProjectModel } from './model.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, resourceDisplayName, resourceEntitiesOf,
  resourcePayloadOf, type ResourceKind,
} from './resource.js'

/** 라이브러리 항목(서버 resource_items 한 행). payload는 라이브러리 공간이다. */
export type LibraryItem = {
  id: string
  kind: ResourceKind
  payload: Record<string, unknown>
  version: number
}

export type ResyncStatus = 'added' | 'auto-update' | 'conflict'
export type ResyncDecision = 'apply' | 'keep' | 'defer' | 'adopt'

export type ResyncEntry = {
  kind: ResourceKind
  sourceId: string
  name: string
  status: ResyncStatus
  version: number
  /** 프로젝트가 들고 있던 버전. added면 null. */
  fromVersion: number | null
  /** 대응하는 프로젝트 엔티티 id. added면 null. */
  projectEntityId: string | null
  /** 라이브러리 공간 payload — 적용 시점에 다시 투영하기 위해 원본 그대로 싣는다. */
  sourcePayload: Record<string, unknown>
  /** 계획 시점 색인으로 투영한 프로젝트 공간 payload(표시·changedFields용). */
  nextPayload: Record<string, unknown>
  /** origin.base 대비 원본이 바꾼 필드. added면 []. */
  changedFields: string[]
  /** added인데 같은 종류에 같은 표시 이름이 이미 있음. */
  nameClash: boolean
}

export type ResyncPlan = {
  libraryId: string
  entries: ResyncEntry[]
  /** origin이 없는(프로젝트 자체 추가) 항목 수. */
  keptLocal: number
  /** 이 라이브러리에서 왔고 버전이 같은 항목 수. */
  keptSynced: number
  /** 이 라이브러리에서 왔으나 원본 항목이 사라진 항목 수. */
  keptDetached: number
}

function keyOf(kind: ResourceKind, sourceId: string): string {
  return `${kind}:${sourceId}`
}

/**
 * 라이브러리 공간 payload를 프로젝트 공간으로 투영한다.
 * 지금 참조를 갖는 종류는 term(domainId)뿐이다. 색인에 없으면 null —
 * 도메인을 함께 가져오지 않아도 용어가 유효하게 들어간다.
 */
function projectPayload(
  kind: ResourceKind, payload: Record<string, unknown>, idBySource: Map<string, string>,
): Record<string, unknown> {
  if (kind !== 'term') return { ...payload }
  const sourceDomainId = payload.domainId
  const mapped = typeof sourceDomainId === 'string'
    ? idBySource.get(keyOf('domain', sourceDomainId)) ?? null
    : null
  return { ...payload, domainId: mapped }
}

/**
 * 라이브러리 항목 목록과 프로젝트 모델을 3-way 비교해 재동기화 계획을 만든다.
 * "원본이 바뀌었다"의 판정은 오직 버전 비교다 — payload 비교로 하면 참조 투영 결과가
 * 나중에 달라졌을 때(예: 도메인을 나중에 추가로 가져옴) 원본이 그대로인데도 변경으로 잡힌다.
 */
export function planResync(
  model: ProjectModel, libraryId: string, items: readonly LibraryItem[],
): ResyncPlan {
  const linked = new Map<
    string, { entity: { id: string; origin: Origin | null }; payload: Record<string, unknown> }
  >()
  const idBySource = new Map<string, string>()
  const namesByKind = new Map<ResourceKind, Set<string>>()
  let keptLocal = 0

  for (const kind of RESOURCE_KINDS) {
    const names = new Set<string>()
    for (const entity of resourceEntitiesOf(model, kind)) {
      const payload = resourcePayloadOf(kind, entity as unknown as Record<string, unknown>)
      names.add(resourceDisplayName(kind, payload).trim())
      if (!entity.origin) { keptLocal += 1; continue }
      idBySource.set(keyOf(kind, entity.origin.sourceId), entity.id)
      if (entity.origin.libraryId !== libraryId) continue
      linked.set(keyOf(kind, entity.origin.sourceId), { entity, payload })
    }
    namesByKind.set(kind, names)
  }

  const entries: ResyncEntry[] = []
  const seen = new Set<string>()
  let keptSynced = 0

  for (const item of items) {
    const key = keyOf(item.kind, item.id)
    seen.add(key)
    const name = resourceDisplayName(item.kind, item.payload)
    const nextPayload = projectPayload(item.kind, item.payload, idBySource)
    const link = linked.get(key)

    if (!link) {
      entries.push({
        kind: item.kind, sourceId: item.id, name, status: 'added',
        version: item.version, fromVersion: null, projectEntityId: null,
        sourcePayload: item.payload, nextPayload, changedFields: [],
        nameClash: namesByKind.get(item.kind)!.has(name.trim()),
      })
      continue
    }

    const origin = link.entity.origin!
    if (origin.sourceVersion === item.version) { keptSynced += 1; continue }

    const modified = !deepEqual(link.payload, origin.base)
    const changedFields = Object.keys(nextPayload)
      .filter((prop) => !deepEqual(nextPayload[prop], origin.base[prop]))
    entries.push({
      kind: item.kind, sourceId: item.id, name,
      status: modified ? 'conflict' : 'auto-update',
      version: item.version, fromVersion: origin.sourceVersion,
      projectEntityId: link.entity.id,
      sourcePayload: item.payload, nextPayload, changedFields, nameClash: false,
    })
  }

  let keptDetached = 0
  for (const key of linked.keys()) if (!seen.has(key)) keptDetached += 1

  const kindOrder = new Map(RESOURCE_KINDS.map((k, i) => [k, i]))
  entries.sort((a, b) =>
    kindOrder.get(a.kind)! - kindOrder.get(b.kind)! || a.name.localeCompare(b.name))

  return { libraryId, entries, keptLocal, keptSynced, keptDetached }
}

/**
 * `adopt` 의 대상 — 같은 종류·같은 표시 이름(trim)·**출처가 없는** 프로젝트 엔티티 중 id 오름차순
 * 첫 것. 이미 출처가 붙은 항목을 빼는 이유: 다른 라이브러리와의 링크를 조용히 갈아치우면 그쪽
 * 재동기화가 영영 「원본에서 사라짐」으로 보인다. 정렬은 planPromote 와 같은 결정성 규칙이다.
 */
export function adoptTargetOf(model: ProjectModel, entry: ResyncEntry): string | null {
  if (entry.status !== 'added') return null
  const hit = resourceEntitiesOf(model, entry.kind)
    .filter((e) => e.origin === null)
    .filter((e) => resourceDisplayName(entry.kind,
      resourcePayloadOf(entry.kind, e as unknown as Record<string, unknown>)).trim() === entry.name.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  return hit?.id ?? null
}

function maxCustomFieldOrder(model: ProjectModel, target: string): number {
  let max = -1
  for (const field of Object.values(model.customFields)) {
    if (field.target === target && field.order > max) max = field.order
  }
  return max
}

/**
 * 계획과 항목별 결정을 적용한 새 모델을 반환한다(입력 모델 불변).
 * 결정이 없는 항목은 'defer'로 본다. 처리할 것이 없으면 입력 모델을 그대로 돌려준다
 * (diffModels가 빈 배열을 내 뮤테이션 자체가 일어나지 않는다).
 */
export function applyResyncPlan(
  model: ProjectModel,
  plan: ResyncPlan,
  decisions: Readonly<Record<string, ResyncDecision>>,
  newId: () => string,
): ProjectModel {
  const selected = plan.entries.filter((e) => (decisions[e.sourceId] ?? 'defer') !== 'defer')
  if (selected.length === 0) return model

  // 1) 추가 항목 id를 먼저 전부 발급해 색인을 완성한다 — 같은 배치에서 추가되는
  //    도메인을 용어가 참조할 수 있어야 한다.
  const idBySource = new Map<string, string>()
  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      if (entity.origin) idBySource.set(keyOf(kind, entity.origin.sourceId), entity.id)
    }
  }
  // adopt 대상도 색인에 먼저 넣는다 — 같은 배치의 용어가 연결된 도메인을 참조할 수 있어야 한다.
  // 두 원본이 같은 엔티티를 고르면 먼저 온 쪽만 인정한다.
  const adopted = new Map<string, string>()
  const claimed = new Set<string>()
  for (const entry of selected) {
    if (decisions[entry.sourceId] !== 'adopt') continue
    const target = adoptTargetOf(model, entry)
    if (target === null || claimed.has(target)) continue
    claimed.add(target)
    adopted.set(entry.sourceId, target)
    idBySource.set(keyOf(entry.kind, entry.sourceId), target)
  }
  const allocated = new Map<string, string>()
  for (const entry of selected) {
    if (entry.status !== 'added' || decisions[entry.sourceId] !== 'apply') continue
    const id = newId()
    allocated.set(entry.sourceId, id)
    idBySource.set(keyOf(entry.kind, entry.sourceId), id)
  }

  const next: ProjectModel = {
    ...model,
    domains: { ...model.domains },
    words: { ...model.words },
    terms: { ...model.terms },
    customFields: { ...model.customFields },
  }
  const nextOrder: Record<string, number> = {
    table: maxCustomFieldOrder(model, 'table') + 1,
    column: maxCustomFieldOrder(model, 'column') + 1,
  }

  for (const entry of selected) {
    const decision = decisions[entry.sourceId]!
    const payload = projectPayload(entry.kind, entry.sourcePayload, idBySource)
    const origin: Origin = {
      libraryId: plan.libraryId,
      sourceId: entry.sourceId,
      sourceVersion: entry.version,
      base: payload,
    }
    const collection = next[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
      Record<string, Record<string, unknown>>

    if (entry.status === 'added') {
      if (decision === 'adopt') {
        const target = adopted.get(entry.sourceId)
        if (target === undefined) continue
        collection[target] = { ...collection[target]!, origin }   // 내용은 그대로, 출처만
        continue
      }
      if (decision !== 'apply') continue
      const id = allocated.get(entry.sourceId)!
      const extra = entry.kind === 'customField'
        ? { order: nextOrder[String(payload.target)]!++ }
        : {}
      collection[id] = { ...payload, ...extra, id, origin }
      continue
    }

    if (decision === 'adopt') continue   // added 가 아니면 의미가 없다 — keep 으로 새면 안 된다
    const id = entry.projectEntityId!
    const current = collection[id]
    if (!current) continue   // 계획 계산 후 삭제된 경우 방어
    if (decision === 'apply') {
      // customField의 order는 프로젝트 표시 관심사라 원본 반영에서도 보존한다.
      const keepOrder = entry.kind === 'customField' ? { order: current.order } : {}
      collection[id] = { ...payload, ...keepOrder, id, origin }
    } else {
      // 'keep' — 내용은 그대로, origin만 갱신해 "검토했고 거절했다"를 기록한다.
      collection[id] = { ...current, origin }
    }
  }

  return next
}
