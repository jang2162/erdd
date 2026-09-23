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
  kind: ResourceKind, payload: Record<string, unknown>, idBySource: ReadonlyMap<string, string>,
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

  // 동률은 sourceId(코드 단위 비교)로 깬다 — 동명 원본의 adopt 선착이 라이브러리 항목의 입력
  // 순서(서버 행 순서)에 의존하지 않게 한다. 이름 비교는 표시 순서라 localeCompare 로 둔다 —
  // 로케일에 따라 순서가 흔들려도 같은 대상을 다투는 것은 trim 한 이름이 같은 항목뿐이고, 그들은
  // 이름 비교가 0 이라 sourceId 가 정한다. 그래서 이름도 trim 해 비교한다.
  const kindOrder = new Map(RESOURCE_KINDS.map((k, i) => [k, i]))
  entries.sort((a, b) =>
    kindOrder.get(a.kind)! - kindOrder.get(b.kind)! || a.name.trim().localeCompare(b.name.trim())
    || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))

  return { libraryId, entries, keptLocal, keptSynced, keptDetached }
}

/**
 * `adopt` 의 대상 — 같은 종류·같은 표시 이름(trim)·**출처가 없는** 프로젝트 엔티티 중 id 오름차순
 * 첫 것. 이미 출처가 붙은 항목을 빼는 이유: 다른 라이브러리와의 링크를 조용히 갈아치우면 그쪽
 * 재동기화가 영영 「원본에서 사라짐」으로 보인다. 정렬은 planPromote 와 같은 결정성 규칙이다.
 * 커스텀 항목은 `target` 도 같아야 한다 — 다르면 원본 반영(theirs)이 필드의 대상을 뒤집는다.
 * 단건 후보다 — 여러 원본이 같은 대상을 고를 수 있으므로 배치 배정은 `adoptAssignments` 가 한다.
 */
export function adoptTargetOf(model: ProjectModel, entry: ResyncEntry): string | null {
  if (entry.status !== 'added') return null
  const hit = resourceEntitiesOf(model, entry.kind)
    .filter((e) => e.origin === null)
    .filter((e) => entry.kind !== 'customField'
      || (e as { target?: unknown }).target === entry.sourcePayload.target)
    .filter((e) => resourceDisplayName(entry.kind,
      resourcePayloadOf(entry.kind, e as unknown as Record<string, unknown>)).trim() === entry.name.trim())
    // 코드 단위 비교다 — localeCompare 는 환경 로케일에 따라 대소문자 혼용 id 의 순서가 갈린다.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  return hit?.id ?? null
}

/**
 * 배치 단위 `adopt` 배정(sourceId → 연결할 엔티티 id). `planAdoption` 에서 내용 비교를 뺀 것이다.
 * `applyResyncPlan` 이 이 함수로 색인을 채우므로, 연결 건수를 보고하는 쪽도 이 배정을 써야 실제
 * 적용과 갈라지지 않는다. Map 에 없는 adopt 항목은 적용되지 않는다(대상 없음 또는 선착 패배).
 */
export function adoptAssignments(
  model: ProjectModel, plan: ResyncPlan, decisions: Readonly<Record<string, ResyncDecision>>,
): Map<string, string> {
  return planAdoption(model, plan, decisions, { sameContentOnly: false }).assigned
}

export type AdoptionPlan = {
  /** sourceId → 연결할 엔티티 id. */
  assigned: Map<string, string>
  /** 대상은 있으나 내용이 달라 배정하지 않은 항목 — sourceId → 다른 필드(payload 키). `sameContentOnly` 일 때만 찬다. */
  differs: Map<string, string[]>
}

/** 투영이 끝나지 않은 참조의 자리표시 — 어떤 프로젝트 엔티티 id 와도 같지 않다. */
const UNRESOLVED = Symbol('unresolved')

/**
 * 연결 후보의 현재 payload 와 원본 payload 의 투영값이 다른 필드. 빈 배열이면 내용이 같다.
 * 투영은 `applyResyncPlan` 과 같은 색인으로 한다. 단, **원본 용어가 가리키는 도메인이 색인에 없으면**
 * (연결도 추가도 안 됨) 적용은 null 로 투영하지만 여기서는 다름으로 본다 — 로컬 용어가 도메인 없음일 때
 * 같다고 보면, 연결 뒤 승격 계획(`planPromote`, 라이브러리 공간 비교)이 원본 용어의 도메인 참조를
 * null 로 덮는 update 를 낸다.
 */
function adoptDifferingFields(
  kind: ResourceKind, current: Record<string, unknown>, sourcePayload: Record<string, unknown>,
  idBySource: ReadonlyMap<string, string>,
): string[] {
  const projected: Record<string, unknown> = projectPayload(kind, sourcePayload, idBySource)
  if (kind === 'term' && typeof sourcePayload.domainId === 'string'
    && !idBySource.has(keyOf('domain', sourcePayload.domainId))) projected.domainId = UNRESOLVED
  const keys = [...new Set([...Object.keys(projected), ...Object.keys(current)])]
  return keys.filter((k) => !deepEqual(current[k], projected[k]))
}

/**
 * 배치 단위 `adopt` 배정. adopt 결정 항목을 `plan.entries` 순서로 돌며 대상이 이미 앞선 원본에
 * 배정됐으면 건너뛴다 — 한 엔티티에 출처는 하나다.
 *
 * `sameContentOnly` 면 **대상의 현재 내용이 원본의 투영값과 같을 때만** 배정한다. 내용이 다른 채
 * 연결하면 출처의 base 는 원본 값·내용은 로컬 값이라, 다음 승격 계획이 그 항목을 「프로젝트가 고친
 * 원본 갱신」으로 기본 선택해 사용자가 본 적 없는 라이브러리 값을 로컬 값으로 덮는다
 * (shared-resources 「승격」의 「보고 나서 덮어쓴다」). 내용이 달라 배정되지 않은 원본은 대상을
 * **차지하지 않는다** — 뒤의 같은 이름·같은 내용 원본이 그 대상에 연결될 수 있다.
 *
 * 색인은 `applyResyncPlan` 과 같게 채운다 — 기존 출처, 추가(apply)될 항목(새 id 자리표시),
 * 앞서 배정한 adopt. 참조를 갖는 종류는 term(→ domain)뿐이고 `plan.entries` 는 종류 순
 * (`RESOURCE_KINDS`: domain 이 term 앞)이라, 용어를 볼 때 도메인 배정은 이미 끝나 있다.
 *
 * 배정되지 않은 adopt 를 defer 로 내린 결정으로 `applyResyncPlan` 을 부르면 같은 배정이 나온다 —
 * 남은 adopt 들의 대상은 서로 다르고, 각 대상은 여전히 `adoptTargetOf` 의 첫 후보다.
 */
export function planAdoption(
  model: ProjectModel, plan: ResyncPlan, decisions: Readonly<Record<string, ResyncDecision>>,
  opts: { sameContentOnly: boolean },
): AdoptionPlan {
  const assigned = new Map<string, string>()
  const differs = new Map<string, string[]>()
  const claimed = new Set<string>()
  const idBySource = opts.sameContentOnly ? existingSourceIndex(model) : new Map<string, string>()
  if (opts.sameContentOnly) {
    for (const entry of plan.entries) {
      if (entry.status !== 'added' || decisions[entry.sourceId] !== 'apply') continue
      idBySource.set(keyOf(entry.kind, entry.sourceId), `\0new:${entry.sourceId}`)
    }
  }
  for (const entry of plan.entries) {
    if (decisions[entry.sourceId] !== 'adopt') continue
    const target = adoptTargetOf(model, entry)
    if (target === null || claimed.has(target)) continue
    if (opts.sameContentOnly) {
      const collection = model[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as unknown as
        Record<string, Record<string, unknown>>
      const current = resourcePayloadOf(entry.kind, collection[target]!)
      const fields = adoptDifferingFields(entry.kind, current, entry.sourcePayload, idBySource)
      if (fields.length > 0) { differs.set(entry.sourceId, fields); continue }
      idBySource.set(keyOf(entry.kind, entry.sourceId), target)
    }
    claimed.add(target)
    assigned.set(entry.sourceId, target)
  }
  return { assigned, differs }
}

/** 기존 출처로 채운 원본 → 프로젝트 엔티티 색인(모든 라이브러리). */
function existingSourceIndex(model: ProjectModel): Map<string, string> {
  const idBySource = new Map<string, string>()
  for (const kind of RESOURCE_KINDS) {
    for (const entity of resourceEntitiesOf(model, kind)) {
      if (entity.origin) idBySource.set(keyOf(kind, entity.origin.sourceId), entity.id)
    }
  }
  return idBySource
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
 * 결정이 없는 항목은 'defer'로 본다. 실제로 바뀐 엔티티가 없으면(전부 defer, 대상 없는 adopt 등)
 * 입력 모델을 그대로(`===`) 돌려준다 — 호출자가 참조 비교로 「바뀐 것 없음」을 판정할 수 있다.
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
  const idBySource = existingSourceIndex(model)
  // adopt 대상도 색인에 먼저 넣는다 — 같은 배치의 용어가 연결된 도메인을 참조할 수 있어야 한다.
  const adopted = adoptAssignments(model, plan, decisions)
  for (const entry of selected) {
    const target = adopted.get(entry.sourceId)
    if (target !== undefined) idBySource.set(keyOf(entry.kind, entry.sourceId), target)
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
  let changed = false
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
        changed = true
        continue
      }
      if (decision !== 'apply') continue
      const id = allocated.get(entry.sourceId)!
      const extra = entry.kind === 'customField'
        ? { order: nextOrder[String(payload.target)]!++ }
        : {}
      collection[id] = { ...payload, ...extra, id, origin }
      changed = true
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
    changed = true
  }

  return changed ? next : model
}
