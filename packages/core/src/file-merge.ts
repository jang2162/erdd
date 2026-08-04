import { deepEqual } from './equal.js'
import { TREE_ROOT, tableFileName } from './file-format.js'
import { DIFF_KIND_LABEL } from './model-diff.js'
import type { Origin, ProjectModel } from './model.js'
import { COLLECTION_BY_KIND, ENTITY_KINDS, type EntityKind } from './op.js'

/**
 * 병합 대상 종류. note는 파일에 담기지 않으므로 타입 수준에서 제외한다 —
 * "메모를 병합 대상에 넣어 지워 버리는" 실수가 컴파일되지 않는다.
 */
export type MergeKind = Exclude<EntityKind, 'note'>

export const MERGE_KINDS: readonly MergeKind[] =
  ENTITY_KINDS.filter((k): k is MergeKind => k !== 'note')

/**
 * 모델 필드 → 파일(YAML) 키. 이 표 하나가 셋을 한다:
 *   1) 3-way 병합이 비교할 필드 목록
 *   2) 충돌 출력에 보여줄 필드 이름(사용자가 파일에서 실제로 보는 이름)
 *   3) FILE_INVISIBLE_FIELDS와 짝을 이뤄 "새 엔티티 필드를 분류하지 않으면 테스트가 깨지는" 게이트
 * 괄호 표기는 파일에 전용 키가 없고 배열 위치·파일 소속으로 표현되는 것들이다.
 */
export const FILE_FIELDS: Record<MergeKind, Record<string, string>> = {
  tableGroup: { name: 'name', color: 'color', comment: 'comment' },
  domain: {
    name: 'name', category: 'category', logicalType: 'logicalType',
    dialectTypes: 'dialectTypes', defaultValue: 'defaultValue',
    allowedValues: 'allowedValues', description: 'description',
  },
  word: {
    logicalName: 'logicalName', abbreviation: 'abbreviation',
    englishName: 'englishName', description: 'description',
  },
  term: {
    logicalName: 'logicalName', physicalName: 'physicalName',
    domainId: 'domain', description: 'description',
  },
  customField: {
    name: 'name', target: 'target', type: 'type', options: 'options',
    required: 'required', defaultValue: 'defaultValue', order: 'order',
  },
  table: {
    physicalName: 'name', logicalName: 'logicalName', comment: 'comment',
    groupId: 'group', custom: 'custom',
  },
  column: {
    tableId: '(소속 테이블)', physicalName: 'name', logicalName: 'logicalName',
    type: 'type', domainId: 'domain', isPk: 'pk', autoIncrement: 'autoIncrement',
    nullable: 'nullable', defaultValue: 'default', comment: 'comment',
    custom: 'custom', order: '(순서)',
  },
  relationship: {
    parentTableId: 'to', childTableId: '(소속 테이블)', columnMappings: 'columns',
    cardinality: 'cardinality', identifying: 'identifying', name: 'name',
  },
  index: { tableId: '(소속 테이블)', name: 'name', columns: 'columns', unique: 'unique' },
}

/** 파일에 담기지 않는 필드. 병합 대상이 아니고 push가 절대 건드리지 않는다. */
export const FILE_INVISIBLE_FIELDS: Record<MergeKind, readonly string[]> = {
  tableGroup: [],
  domain: ['origin'], word: ['origin'], term: ['origin'], customField: ['origin'],
  table: ['position', 'groupPosition'],
  column: [], relationship: [], index: [],
}

function clearOrigin<T extends { origin: Origin | null }>(
  collection: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(collection).map(([id, v]) => [id, { ...v, origin: null }]),
  ) as Record<string, T>
}

/**
 * 서버 모델을 filesToModel이 만드는 값으로 정규화한다.
 * base·local·server 셋을 같은 공간에 놓아야 3-way 비교가 성립한다.
 * 모든 컬렉션을 새 객체로 만든다 — 병합이 결과에서 delete를 하므로 서버 모델과
 * 컬렉션을 공유하면 서버 모델이 오염된다.
 */
export function fileVisibleModel(model: ProjectModel): ProjectModel {
  return {
    tables: Object.fromEntries(
      Object.entries(model.tables).map(([id, t]) => [
        id, { ...t, position: { x: 0, y: 0 }, groupPosition: null },
      ]),
    ) as ProjectModel['tables'],
    columns: { ...model.columns },
    relationships: { ...model.relationships },
    indexes: { ...model.indexes },
    notes: {},
    tableGroups: { ...model.tableGroups },
    domains: clearOrigin(model.domains),
    words: clearOrigin(model.words),
    terms: clearOrigin(model.terms),
    customFields: clearOrigin(model.customFields),
  }
}

export type ConflictReason = 'field' | 'local-delete' | 'server-delete' | 'both-added'

export type MergeConflict = {
  /** 사용자가 열어야 할 파일. */
  path: string
  kind: MergeKind
  entityId: string
  /** '컬럼 MBR.MBR_NM' */
  label: string
  /** FILE_FIELDS의 값(사용자가 파일에서 보는 키) 또는 엔티티 통째면 '*'. */
  field: string
  reason: ConflictReason
  base: string | null
  local: string | null
  server: string | null
  /** field === '*'일 때 상대편이 바꾼 파일 키 목록. 그 외엔 []. */
  changedFields: string[]
}

export type MergeResult = { merged: ProjectModel; conflicts: MergeConflict[] }

type Entity = Record<string, unknown> & { id: string }

function collectionOf(model: ProjectModel, kind: MergeKind): Record<string, Entity> {
  return model[COLLECTION_BY_KIND[kind]] as unknown as Record<string, Entity>
}

const TOP_LEVEL_PATH: Partial<Record<MergeKind, string>> = {
  tableGroup: `${TREE_ROOT}/groups.yaml`,
  word: `${TREE_ROOT}/words.yaml`,
  term: `${TREE_ROOT}/terms.yaml`,
  domain: `${TREE_ROOT}/domains.yaml`,
  customField: `${TREE_ROOT}/custom-fields.yaml`,
}

/** 관계는 자식 테이블 파일에만 적힌다. */
function ownerTableId(kind: MergeKind, e: Entity): string {
  if (kind === 'table') return e.id
  if (kind === 'relationship') return e['childTableId'] as string
  return e['tableId'] as string
}

function pathOf(kind: MergeKind, e: Entity, models: readonly ProjectModel[]): string {
  const top = TOP_LEVEL_PATH[kind]
  if (top !== undefined) return top
  const tableId = ownerTableId(kind, e)
  for (const m of models) {
    if (m.tables[tableId] !== undefined) return `${TREE_ROOT}/tables/${tableFileName(m, tableId)}`
  }
  return `${TREE_ROOT}/tables`
}

function nameOf(kind: MergeKind, e: Entity, models: readonly ProjectModel[]): string {
  const table = (id: string): string => {
    for (const m of models) {
      const t = m.tables[id]
      if (t !== undefined) return t.physicalName
    }
    return id
  }
  switch (kind) {
    case 'table': return e['physicalName'] as string
    case 'column': return `${table(e['tableId'] as string)}.${e['physicalName'] as string}`
    case 'index': return `${table(e['tableId'] as string)}.${e['name'] as string}`
    case 'relationship':
      return (e['name'] as string | null)
        ?? `${table(e['childTableId'] as string)}→${table(e['parentTableId'] as string)}`
    case 'word': case 'term': return e['logicalName'] as string
    default: return e['name'] as string
  }
}

const REF_FIELDS = new Set(['groupId', 'domainId', 'tableId', 'parentTableId', 'childTableId'])

/** 표시용 문자열. 참조형 스칼라만 이름으로 풀고, 구조형은 JSON 그대로 보여준다. */
function displayValue(model: ProjectModel, field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (REF_FIELDS.has(field) && typeof value === 'string') {
    if (field === 'groupId') return model.tableGroups[value]?.name ?? value
    if (field === 'domainId') return model.domains[value]?.name ?? value
    return model.tables[value]?.physicalName ?? value
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function changedKeys(
  fields: Record<string, string>, from: Entity | undefined, to: Entity | undefined,
): string[] {
  if (from === undefined || to === undefined) return []
  return Object.entries(fields).filter(([f]) => !deepEqual(from[f], to[f])).map(([, key]) => key)
}

function sameVisible(a: Entity, b: Entity, fields: Record<string, string>): boolean {
  return Object.keys(fields).every((f) => deepEqual(a[f], b[f]))
}

/**
 * base·local·server 3-way 병합. 세 인자 모두 파일 가시 공간이어야 한다.
 * merged는 server에서 출발해 로컬 변경만 얹은 것이고, 충돌 필드에는 서버 값이 남는다
 * (충돌이 있으면 호출자가 merged를 쓰지 않는다).
 */
export function mergeModels(
  base: ProjectModel, local: ProjectModel, server: ProjectModel,
): MergeResult {
  const merged = fileVisibleModel(server)
  const conflicts: MergeConflict[] = []
  const models = [local, server, base] as const

  for (const kind of MERGE_KINDS) {
    const fields = FILE_FIELDS[kind]
    const bCol = collectionOf(base, kind)
    const lCol = collectionOf(local, kind)
    const sCol = collectionOf(server, kind)
    const out = collectionOf(merged, kind)

    const ids = [...new Set([...Object.keys(bCol), ...Object.keys(lCol), ...Object.keys(sCol)])].sort()
    for (const id of ids) {
      const b = bCol[id]
      const l = lCol[id]
      const s = sCol[id]
      const any = l ?? s ?? b!

      const conflict = (
        field: string, reason: ConflictReason, modelField: string | null, changed: string[],
      ): void => {
        conflicts.push({
          path: pathOf(kind, any, models),
          kind, entityId: id, label: `${DIFF_KIND_LABEL[kind]} ${nameOf(kind, any, models)}`,
          field, reason, changedFields: changed,
          base: modelField === null
            ? (b === undefined ? null : nameOf(kind, b, models))
            : displayValue(base, modelField, b?.[modelField]),
          local: modelField === null
            ? (l === undefined ? null : nameOf(kind, l, models))
            : displayValue(local, modelField, l?.[modelField]),
          server: modelField === null
            ? (s === undefined ? null : nameOf(kind, s, models))
            : displayValue(server, modelField, s?.[modelField]),
        })
      }

      if (l === undefined && b === undefined) continue          // 서버 전용 → 유지
      if (l === undefined) {
        if (s === undefined) { delete out[id]; continue }        // 양쪽 삭제
        if (sameVisible(b!, s, fields)) { delete out[id]; continue }   // 로컬 삭제
        conflict('*', 'local-delete', null, changedKeys(fields, b, s))
        continue
      }
      if (b === undefined) {
        if (s === undefined) { out[id] = { ...l }; continue }    // 생성
        // 양쪽이 같은 id로 추가 — base가 없어 필드마다 비교한다.
        for (const [f, key] of Object.entries(fields)) {
          if (deepEqual(l[f], s[f])) continue
          conflict(key, 'both-added', f, [])
        }
        continue
      }
      if (s === undefined) {
        if (sameVisible(b, l, fields)) continue                  // 서버 삭제 수용(out에 이미 없다)
        conflict('*', 'server-delete', null, changedKeys(fields, b, l))
        continue
      }

      const next: Entity = { ...(out[id] ?? s) }
      for (const [f, key] of Object.entries(fields)) {
        const bv = b[f], lv = l[f], sv = s[f]
        if (deepEqual(lv, bv)) { next[f] = sv; continue }
        if (deepEqual(sv, bv)) { next[f] = lv; continue }
        if (deepEqual(lv, sv)) { next[f] = lv; continue }
        conflict(key, 'field', f, [])
      }
      out[id] = next
    }
  }

  return { merged, conflicts }
}
