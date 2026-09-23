import { deepEqual } from './equal.js'
import type { LibraryFileDoc, LibraryFileEntry } from './library-file.js'
import { RESOURCE_KINDS, RESOURCE_KIND_LABEL, RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName, type ResourceKind } from './resource.js'
import type { LibraryItem } from './resource-sync.js'

/**
 * 파일 → 서버 라이브러리 갱신 병합의 판정. 서버 적용·웹 미리보기·CLI --dry-run 이 모두 이것을 부른다
 * (guides/shared-resources.md 「파일 내보내기·가져오기」). 소비처가 판정을 다시 구현하면 갈라진다.
 */
export type LibraryImportStatus = 'add' | 'update' | 'unchanged' | 'stale' | 'remove'
export type LibraryImportEntry = {
  status: LibraryImportStatus
  kind: ResourceKind
  name: string
  targetId: string | null
  fileRef: string | null
  currentVersion: number | null
  fileVersion: number | null
  currentPayload: Record<string, unknown> | null
  payload: Record<string, unknown>
  changedFields: string[]
  referencedBy: number
}
export type LibraryImportPlan = { entries: LibraryImportEntry[]; warnings: string[] }
export type LibraryImportWrites = {
  inserts: { id: string; kind: ResourceKind; payload: Record<string, unknown> }[]
  updates: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]
  removes: string[]
}

/** 이번에 새로 만들 항목의 자리표시 — 어떤 실제 id 와도 같지 않다. materialize 가 발급 id 로 푼다. */
const NEW_REF = '\0new:'
const newRef = (fileRef: string): string => `${NEW_REF}${fileRef}`

const DEFAULTS: Record<ResourceKind, Record<string, unknown>> = {
  domain: {
    category: null, dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  },
  word: { abbreviation: '', englishName: null, description: null },
  term: { domainId: null, description: null },
  customField: { options: [], required: false, defaultValue: null },
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 적힌 키만 덮는다. 도메인 dialectTypes 는 한 단계 병합 — 원천 파일은 방언 일부만 적을 수 있다. */
function merge(kind: ResourceKind, base: Record<string, unknown>, fields: Record<string, unknown>) {
  const out = { ...base, ...fields }
  if (kind === 'domain' && isRec(fields.dialectTypes)) {
    out.dialectTypes = { ...(isRec(base.dialectTypes) ? base.dialectTypes : {}), ...fields.dialectTypes }
  }
  return out
}

function matchKey(kind: ResourceKind, payload: Record<string, unknown>): string {
  const name = resourceDisplayName(kind, payload).trim()
  return kind === 'customField' ? `${kind}\0${name}\0${String(payload.target)}` : `${kind}\0${name}`
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !deepEqual(before[k], after[k]))
}

/**
 * 옛 행(키 누락)을 종류별 스키마로 완전값 정규화한다 — exportLibraryFile 이 파일에 쓰는 것과 같은 기준.
 * 정규화 없이 비교하면 파일의 완전값(예: englishName: null)과 옛 행의 누락 키가 달라 보여 unchanged 가 update 로 잘못 판정된다.
 */
function normalizedPayload(kind: ResourceKind, payload: Record<string, unknown>): Record<string, unknown> {
  const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(payload)
  return parsed.success ? parsed.data as Record<string, unknown> : payload
}

export function planLibraryImport(
  existing: readonly LibraryItem[], doc: LibraryFileDoc, targetLibraryId: string | null,
): LibraryImportPlan {
  const warnings: string[] = []
  const files: { ref: string; kind: ResourceKind; entry: LibraryFileEntry }[] = []
  for (const kind of RESOURCE_KINDS) {
    (doc.kinds[kind] ?? []).forEach((entry, i) => files.push({ ref: `${kind}:${i}`, kind, entry }))
  }

  const claimed = new Set<string>()
  const matchOf = new Map<string, LibraryItem>()
  const matchedById = new Set<string>()

  // ① 같은 라이브러리에서 내보낸 파일이면 항목 id 로 — 이름이 바뀐 항목도 따라간다.
  if (doc.library.id !== undefined && doc.library.id === targetLibraryId) {
    const byId = new Map(existing.map((e) => [e.id, e]))
    for (const f of files) {
      const hit = f.entry.id === undefined ? undefined : byId.get(f.entry.id)
      if (hit === undefined || hit.kind !== f.kind || claimed.has(hit.id)) continue
      claimed.add(hit.id); matchOf.set(f.ref, hit); matchedById.add(f.ref)
    }
  }
  // ② 나머지는 (종류, 표시 이름[, target]) — 후보는 existing 순서(= loadLibraryItems 의 createdAt, id).
  const byName = new Map<string, LibraryItem[]>()
  for (const e of existing) {
    const key = matchKey(e.kind, e.payload)
    const list = byName.get(key)
    if (list === undefined) byName.set(key, [e]); else list.push(e)
  }
  for (const f of files) {
    if (matchOf.has(f.ref)) continue
    const candidates = (byName.get(matchKey(f.kind, f.entry.fields)) ?? []).filter((e) => !claimed.has(e.id))
    if (candidates.length === 0) continue
    if (candidates.length > 1) {
      warnings.push(`${RESOURCE_KIND_LABEL[f.kind]} 「${resourceDisplayName(f.kind, f.entry.fields).trim()}」: 라이브러리에 같은 이름이 ${candidates.length}개 있어 먼저 만든 항목과 맞춥니다`)
    }
    const hit = candidates[0]!
    claimed.add(hit.id); matchOf.set(f.ref, hit)
  }

  // 도메인 참조 해석표 — 파일 도메인 id·이름 → 대상 id(또는 새 항목 자리표시).
  const domainByFileId = new Map<string, string>()
  const domainByFileName = new Map<string, string>()
  for (const f of files) {
    if (f.kind !== 'domain') continue
    const target = matchOf.get(f.ref)?.id ?? newRef(f.ref)
    if (f.entry.id !== undefined) domainByFileId.set(f.entry.id, target)
    domainByFileName.set(resourceDisplayName('domain', f.entry.fields).trim(), target)
  }
  const domainByExistingName = new Map<string, string>()
  for (const e of existing) {
    if (e.kind !== 'domain') continue
    const name = resourceDisplayName('domain', e.payload).trim()
    if (!domainByExistingName.has(name)) domainByExistingName.set(name, e.id)
  }
  const resolveFields = (f: { kind: ResourceKind; entry: LibraryFileEntry }): Record<string, unknown> => {
    const fields = { ...f.entry.fields }
    if (f.kind !== 'term') return fields
    if (typeof fields.domainId === 'string') fields.domainId = domainByFileId.get(fields.domainId) ?? null
    if (f.entry.domainName !== undefined) {
      const wanted = f.entry.domainName.trim()
      const hit = wanted === '' ? null : domainByFileName.get(wanted) ?? domainByExistingName.get(wanted) ?? null
      if (wanted !== '' && hit === null) {
        warnings.push(`용어 「${resourceDisplayName('term', fields).trim()}」: 도메인 「${wanted}」을(를) 찾지 못해 비웁니다`)
      }
      fields.domainId = hit
    }
    return fields
  }

  const entries: LibraryImportEntry[] = []
  for (const f of files) {
    const fields = resolveFields(f)
    const hit = matchOf.get(f.ref)
    const fileVersion = f.entry.version ?? null
    if (hit === undefined) {
      const payload = merge(f.kind, DEFAULTS[f.kind], fields)
      entries.push({
        status: 'add', kind: f.kind, name: resourceDisplayName(f.kind, payload), targetId: null, fileRef: f.ref,
        currentVersion: null, fileVersion, currentPayload: null, payload, changedFields: [], referencedBy: 0,
      })
      continue
    }
    const currentPayload = normalizedPayload(f.kind, hit.payload)
    const payload = merge(f.kind, currentPayload, fields)
    const changedFields = changedKeys(currentPayload, payload)
    const status: LibraryImportStatus = changedFields.length === 0 ? 'unchanged'
      : matchedById.has(f.ref) && fileVersion !== null && fileVersion < hit.version ? 'stale' : 'update'
    entries.push({
      status, kind: f.kind, name: resourceDisplayName(f.kind, payload), targetId: hit.id, fileRef: f.ref,
      currentVersion: hit.version, fileVersion, currentPayload, payload, changedFields, referencedBy: 0,
    })
  }

  const present = new Set(RESOURCE_KINDS.filter((k) => doc.kinds[k] !== undefined))
  for (const e of existing) {
    if (claimed.has(e.id) || !present.has(e.kind)) continue
    entries.push({
      status: 'remove', kind: e.kind, name: resourceDisplayName(e.kind, e.payload), targetId: e.id, fileRef: null,
      currentVersion: e.version, fileVersion: null, currentPayload: e.payload, payload: e.payload,
      changedFields: [], referencedBy: 0,
    })
  }

  // 남는 용어가 가리키는 도메인은 지우지 않는다 — 지우면 참조가 끊긴 용어가 라이브러리에 남는다.
  // 남는 용어 = 파일의 용어(stale 은 적용 여부가 플래그에 달려 있어 전후 값 모두) + 파일이 말하지 않은 기존 용어.
  const refs = new Map<string, number>()
  const count = (id: unknown) => { if (typeof id === 'string') refs.set(id, (refs.get(id) ?? 0) + 1) }
  for (const e of entries) {
    if (e.kind !== 'term' || e.status === 'remove') continue
    count(e.payload.domainId)
    if (e.status === 'stale') count(e.currentPayload?.domainId)
  }
  if (!present.has('term')) for (const e of existing) if (e.kind === 'term') count(e.payload.domainId)
  for (const e of entries) {
    if (e.status !== 'remove' || e.kind !== 'domain') continue
    e.referencedBy = refs.get(e.targetId!) ?? 0
    if (e.referencedBy > 0) {
      warnings.push(`도메인 「${e.name}」: 파일에 없지만 남는 용어 ${e.referencedBy}건이 가리키고 있어 삭제 대상에서 뺍니다`)
    }
  }
  return { entries, warnings }
}

export function materializeLibraryImport(
  plan: LibraryImportPlan, opts: { prune: boolean; includeStale: boolean }, newId: () => string,
): LibraryImportWrites {
  const idOf = new Map<string, string>()
  for (const e of plan.entries) if (e.status === 'add') idOf.set(newRef(e.fileRef!), newId())
  const resolve = (payload: Record<string, unknown>): Record<string, unknown> =>
    typeof payload.domainId === 'string' && payload.domainId.startsWith(NEW_REF)
      ? { ...payload, domainId: idOf.get(payload.domainId)! }
      : { ...payload }
  const writes: LibraryImportWrites = { inserts: [], updates: [], removes: [] }
  for (const e of plan.entries) {
    if (e.status === 'add') writes.inserts.push({ id: idOf.get(newRef(e.fileRef!))!, kind: e.kind, payload: resolve(e.payload) })
    else if (e.status === 'update' || (e.status === 'stale' && opts.includeStale)) {
      writes.updates.push({ id: e.targetId!, kind: e.kind, payload: resolve(e.payload), version: e.currentVersion! + 1 })
    } else if (e.status === 'remove' && opts.prune && e.referencedBy === 0) writes.removes.push(e.targetId!)
  }
  return writes
}

export type LibraryImportSummary = {
  counts: Record<LibraryImportStatus, number> & { removeBlocked: number }
  warnings: string[]
  entries: {
    status: Exclude<LibraryImportStatus, 'unchanged'>
    kind: ResourceKind
    name: string
    currentVersion: number | null
    fileVersion: number | null
    referencedBy: number
    changes: { field: string; from: unknown; to: unknown }[]
  }[]
}

/** 화면·CLI 표시용 요약. 용어의 domainId 는 사람이 읽을 수 있게 도메인 이름으로 바꾼다. */
export function summarizeLibraryImport(plan: LibraryImportPlan, existing: readonly LibraryItem[]): LibraryImportSummary {
  const domainName = new Map<string, string>()
  for (const e of existing) if (e.kind === 'domain') domainName.set(e.id, resourceDisplayName('domain', e.payload))
  for (const e of plan.entries) if (e.status === 'add' && e.kind === 'domain') domainName.set(newRef(e.fileRef!), e.name)
  const show = (field: string, value: unknown): unknown =>
    field === 'domainId' && typeof value === 'string' ? domainName.get(value) ?? value : value

  const counts = { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0 }
  const entries: LibraryImportSummary['entries'] = []
  for (const e of plan.entries) {
    counts[e.status] += 1
    if (e.status === 'remove' && e.referencedBy > 0) counts.removeBlocked += 1
    if (e.status === 'unchanged') continue
    entries.push({
      status: e.status, kind: e.kind, name: e.name, currentVersion: e.currentVersion,
      fileVersion: e.fileVersion, referencedBy: e.referencedBy,
      changes: e.changedFields.map((field) => ({
        field, from: show(field, e.currentPayload?.[field] ?? null), to: show(field, e.payload[field] ?? null),
      })),
    })
  }
  return { counts, warnings: plan.warnings, entries }
}
