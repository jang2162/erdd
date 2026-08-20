import { deepEqual } from './equal.js'
import { TOP_LEVEL_FILES, TREE_ROOT, tableFileName } from './file-format.js'
import { DIFF_KIND_LABEL } from './model-diff.js'
import { createEmptyModel, type Origin, type Position, type ProjectModel } from './model.js'
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
  tableGroup: { name: 'name', color: 'color', comment: 'comment', alias: 'alias' },
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

/**
 * 최상위 파일 엔티티 → 경로. 리터럴을 여기 또 적지 않고 TOP_LEVEL_FILES(file-format.ts)에서
 * 위치로 뽑아 쓴다 — 그쪽 배열 하나만 고치면 이쪽도 따라오므로, 파일명을 한쪽만 바꿔
 * 존재하지 않는 파일을 가리키는 사고가 구조적으로 나지 않는다. 순서는
 * TOP_LEVEL_FILES 정의 순서(groups·words·terms·domains·custom-fields)와 같다.
 */
const [GROUPS_PATH, WORDS_PATH, TERMS_PATH, DOMAINS_PATH, CUSTOM_FIELDS_PATH] = TOP_LEVEL_FILES

const TOP_LEVEL_PATH: Partial<Record<MergeKind, string>> = {
  tableGroup: GROUPS_PATH,
  word: WORDS_PATH,
  term: TERMS_PATH,
  domain: DOMAINS_PATH,
  customField: CUSTOM_FIELDS_PATH,
}

/** 관계는 자식 테이블 파일에만 적힌다. */
function ownerTableId(kind: MergeKind, e: Entity): string {
  if (kind === 'table') return e.id
  if (kind === 'relationship') return e['childTableId'] as string
  return e['tableId'] as string
}

/**
 * 충돌이 실린 파일. **실제 경로를 알면 그것을 쓰고, 모르면 물리명에서 재조립한다.**
 *
 * ⚠️ 재조립(`erdd/tables/<물리명>.yaml`)이 뒤로 밀린 이유: 파일명과 물리명은 정규 동선에서
 * 어긋난다. SKILL.md 가 "테이블 파일 이름을 직접 바꾸지 않는다 … 이름을 바꾸려면 파일 안의
 * `name`을 고친다"고 시키고 파일명은 다음 `pull`이 따라오기 때문이다. 개명 직후 local 의
 * 물리명은 `MEMBER`인데 디스크의 파일은 `MBR.yaml`이라, 재조립한 경로는 **없는 파일**이 된다.
 * 충돌 리포트는 사용자가 파일을 열어야 하는 바로 그 화면이라(conflict-report.ts가 이 경로를
 * 그룹 헤더로 찍고 "pull 뒤 다시 정리해 push하세요"로 끝난다) 거짓 좌표의 값이 특히 비싸다.
 *
 * ⚠️ **폴백은 지워지지 않는다 — 여기서는 실제로 도달한다.** validate 쪽 좌표는 모든 테이블이
 * 방금 읽은 파일에서 오므로 못 구할 수가 없지만(cli/commands/validate.ts 주석 참조), 병합은
 * base·server 에만 있는 테이블도 다룬다. 로컬이 파일을 지웠고 서버가 그 테이블을 고친
 * `local-delete` 충돌이 그 자리다 — 그때는 「pull 하면 생길 경로」를 내는 것이 리포트의
 * 안내와 앞뒤가 맞는다.
 */
function pathOf(
  kind: MergeKind, e: Entity, models: readonly ProjectModel[],
  tableFiles: Record<string, string>,
): string {
  const top = TOP_LEVEL_PATH[kind]
  if (top !== undefined) return top
  const tableId = ownerTableId(kind, e)
  const real = tableFiles[tableId]
  if (real !== undefined) return real
  for (const m of models) {
    if (m.tables[tableId] !== undefined) return `${TREE_ROOT}/tables/${tableFileName(m, tableId)}`
  }
  return `${TREE_ROOT}/tables`
}

/**
 * 사람이 읽을 이름. 이름만으로는 어느 것인지 알 수 없는 종류에 맥락을 붙인다 —
 * 컬럼·인덱스는 소속 테이블로 한정하고(`MBR.MBR_NO`), 이름 없는 관계는 `자식→부모`로 푼다.
 * (같은 물리명의 컬럼은 테이블마다 있는 게 정상이라, 한정 없이 보여 주면 삭제 확인 프롬프트
 * 같은 곳에서 어느 것을 지우는지 구분할 수 없다.)
 *
 * `models`는 테이블 이름을 찾을 순서다 — 먼저 찾은 모델의 물리명을 쓰고, 어디에도 없으면
 * id를 그대로 보여 준다.
 */
export function entityDisplayName(
  kind: MergeKind, e: Record<string, unknown>, models: readonly ProjectModel[],
): string {
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

export type MergeOptions = {
  /**
   * 테이블 id → **로컬 디스크의 실제 파일 경로**(`filesToModel`의 `tableFiles`).
   * 충돌 좌표를 물리명에서 재조립하지 않기 위한 것이다 — 없는 id는 재조립으로 떨어진다.
   * 생략하면 전부 재조립이라 이 인자를 주기 전과 동작이 같다.
   */
  tableFiles?: Record<string, string>
}

/**
 * base·local·server 3-way 병합. 세 인자 모두 파일 가시 공간이어야 한다.
 * merged는 server에서 출발해 로컬 변경만 얹은 것이고, 충돌 필드에는 서버 값이 남는다
 * (충돌이 있으면 호출자가 merged를 쓰지 않는다).
 */
export function mergeModels(
  base: ProjectModel, local: ProjectModel, server: ProjectModel, opts?: MergeOptions,
): MergeResult {
  const merged = fileVisibleModel(server)
  const conflicts: MergeConflict[] = []
  const models = [local, server, base] as const
  // ⚠️ 프로토타입 오염을 막는 하드닝(`Object.create(null)`·`hasOwn`)을 **일부러 넣지 않는다.**
  // 이 조회의 키는 테이블 id인데, id는 op-guard.ts의 UUID_RE(:10)가 `parseOps`(:42)에서
  // 강제하므로 `__proto__`·`constructor` 같은 키가 모델에 들어올 수 없다. 도달할 수 없는
  // 갈래에 방어를 넣으면 **어떤 테스트로도 빨갛게 만들 수 없는 코드**가 늘 뿐이다.
  const tableFiles = opts?.tableFiles ?? {}

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
          path: pathOf(kind, any, models, tableFiles),
          kind, entityId: id, label: `${DIFF_KIND_LABEL[kind]} ${entityDisplayName(kind, any, models)}`,
          field, reason, changedFields: changed,
          base: modelField === null
            ? (b === undefined ? null : entityDisplayName(kind, b, models))
            : displayValue(base, modelField, b?.[modelField]),
          local: modelField === null
            ? (l === undefined ? null : entityDisplayName(kind, l, models))
            : displayValue(local, modelField, l?.[modelField]),
          server: modelField === null
            ? (s === undefined ? null : entityDisplayName(kind, s, models))
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

export type PrunedRef = { kind: MergeKind; entityId: string; label: string; reason: string }

const GRID_COLS = 4
const GRID_DX = 320
const GRID_DY = 240
const GRID_GAP = 240

/** 기존 테이블 bbox 아래에 격자로 놓는다. 순수 함수 — 같은 입력이면 같은 좌표다. */
export function gridPositions(server: ProjectModel, count: number): Position[] {
  const existing = Object.values(server.tables)
  const originX = existing.length === 0 ? 0 : Math.min(...existing.map((t) => t.position.x))
  const originY = existing.length === 0 ? 0 : Math.max(...existing.map((t) => t.position.y)) + GRID_GAP
  return Array.from({ length: count }, (_, i) => ({
    x: originX + (i % GRID_COLS) * GRID_DX,
    y: originY + Math.floor(i / GRID_COLS) * GRID_DY,
  }))
}

/**
 * 매달린 참조를 정리하고 무엇을 어떻게 했는지 돌려준다. **model을 제자리에서 고친다** —
 * applyMerge가 자기가 만든 새 모델에만 쓴다.
 *
 * 필요한 이유: 3-way 병합은 엔티티 단위라 "담는 것"과 "담기는 것"의 관계를 모른다. 서버가
 * pull 이후 추가한 관계가 로컬에서 지운 테이블을 가리킬 수 있고, 로컬이 테이블을 옮겨 넣은
 * 그룹을 서버가 지웠을 수도 있다. 그대로 두면 FK가 NOT DEFERRABLE이라 반영이 500으로 터진다
 * (`tables.group_id`는 실제 FK다 — apps/server/src/db/schema.ts:92).
 *
 * 처리 방식이 둘로 갈린다:
 * - **소속이 사라진 엔티티는 지운다**(컬럼·인덱스·관계) — 부모 없이 존재할 수 없다.
 *   컬럼이 살아 있어도 다른 테이블로 옮겨갔으면(예: 파일을 옮기며 id를 유지) 인덱스·관계
 *   입장에서는 "소속이 다른" 것과 같다 — integrity.ts(84-114)가 요구하는 소유권 불변식이라
 *   같은 정책으로 지운다.
 * - **매달린 스칼라 참조는 null로 끊는다**(table.groupId·column.domainId·term.domainId) —
 *   엔티티 자체는 멀쩡하고 참조만 무효다. 지우면 사용자 데이터를 잃는다.
 *
 * 순서가 중요하다: 컬럼을 먼저 정리해야 인덱스·관계 검사가 정리된 결과를 본다.
 */
export function pruneDangling(model: ProjectModel): PrunedRef[] {
  const pruned: PrunedRef[] = []
  const reason = '참조 대상이 삭제됨'

  // 존재 판정은 반드시 Object.hasOwn이다 — 이 함수의 존재 이유가 validateModelIntegrity를
  // 만족시키는 것이고(integrity.ts:41 이하) 그쪽이 같은 판정을 쓴다. `col[id] !== undefined`는
  // constructor·toString처럼 Object.prototype에 있는 이름에 대해 참이 되어, 무결성 검사는
  // "없는 참조"라 하는데 정리는 건너뛰는 어긋남이 생긴다.
  const has = (col: Record<string, unknown>, id: string): boolean => Object.hasOwn(col, id)
  const columnIn = (id: string) => (has(model.columns, id) ? model.columns[id] : undefined)

  // entityDisplayName(kind, e, [model])은 e['tableId']로 model.tables를 찾는다 — pruneDangling은
  // model.tables를 지우지 않으므로(스칼라 groupId만 null로 바꾼다) 아래 모든 호출 시점에
  // 테이블은 여전히 조회 가능하다. 유일한 예외는 컬럼·관계 자신의 소속 테이블이 바로 이 함수가
  // 지우는 이유인 경우(테이블 자체가 model에 없음) — 그때는 entityDisplayName도 동일하게
  // id로 떨어진다(그 이상 보여줄 정보가 없다).
  for (const [id, c] of Object.entries(model.columns)) {
    if (has(model.tables, c.tableId)) continue
    delete model.columns[id]
    pruned.push({ kind: 'column', entityId: id, label: `컬럼 ${entityDisplayName('column', c, [model])}`, reason })
  }
  for (const [id, ix] of Object.entries(model.indexes)) {
    const bad = !has(model.tables, ix.tableId)
      || ix.columns.some((c) => {
        const col = columnIn(c.columnId)
        return col === undefined || col.tableId !== ix.tableId
      })
    if (!bad) continue
    delete model.indexes[id]
    pruned.push({ kind: 'index', entityId: id, label: `인덱스 ${entityDisplayName('index', ix, [model])}`, reason })
  }
  for (const [id, r] of Object.entries(model.relationships)) {
    const bad = !has(model.tables, r.parentTableId)
      || !has(model.tables, r.childTableId)
      || r.columnMappings.some((m) => {
        const child = columnIn(m.childColumnId)
        const parent = columnIn(m.parentColumnId)
        return child === undefined || child.tableId !== r.childTableId
          || parent === undefined || parent.tableId !== r.parentTableId
      })
    if (!bad) continue
    delete model.relationships[id]
    pruned.push({
      kind: 'relationship', entityId: id, label: `관계 ${entityDisplayName('relationship', r, [model])}`, reason,
    })
  }

  // 스칼라 참조는 끊기만 한다 — 엔티티는 살린다.
  for (const t of Object.values(model.tables)) {
    if (t.groupId === null || has(model.tableGroups, t.groupId)) continue
    t.groupId = null
    pruned.push({
      kind: 'table', entityId: t.id, label: `테이블 ${entityDisplayName('table', t, [model])}`,
      reason: '그룹이 삭제되어 참조를 해제함',
    })
  }
  for (const c of Object.values(model.columns)) {
    if (c.domainId === null || has(model.domains, c.domainId)) continue
    c.domainId = null
    pruned.push({
      kind: 'column', entityId: c.id, label: `컬럼 ${entityDisplayName('column', c, [model])}`,
      reason: '도메인이 삭제되어 참조를 해제함',
    })
  }
  for (const t of Object.values(model.terms)) {
    if (t.domainId === null || has(model.domains, t.domainId)) continue
    t.domainId = null
    pruned.push({
      kind: 'term', entityId: t.id, label: `용어 ${entityDisplayName('term', t, [model])}`,
      reason: '도메인이 삭제되어 참조를 해제함',
    })
  }
  return pruned
}

/**
 * 병합 결과를 서버 모델 위에 얹는다.
 *
 * merged는 파일 가시 공간이라 좌표·origin이 비어 있고 notes가 없다. 그대로 diffModels에
 * 넣으면 메모가 전멸하고 좌표가 0으로 초기화되며 fork 출처가 지워진다. 살아남은 엔티티는
 * **서버 엔티티에서 출발해 가시 필드만 덮어쓰고**, notes는 서버 것을 그대로 통과시킨다.
 *
 * `out`의 각 엔티티·`notes`는 `server`를 얕게 복사한 것이라 position·columnMappings·
 * index.columns 같은 중첩 값은 여전히 server와 참조를 공유한다. pruneDangling이 스칼라
 * 필드만 고치거나 엔티티를 통째로 지우기만 해서 지금은 안전하다 — 중첩 값을 제자리에서
 * 고치는 정리 로직이 생기면 server를 오염시키므로 그때는 깊은 복사가 필요하다.
 */
export function applyMerge(
  server: ProjectModel, merged: ProjectModel,
): { model: ProjectModel; pruned: PrunedRef[] } {
  const out: ProjectModel = { ...createEmptyModel(), notes: { ...server.notes } }

  // 신규 테이블 좌표는 id 오름차순으로 배정한다 — 같은 입력이면 같은 결과다.
  const newTableIds = Object.keys(merged.tables)
    .filter((id) => server.tables[id] === undefined).sort()
  const positions = gridPositions(server, newTableIds.length)
  const posById = new Map(newTableIds.map((id, i) => [id, positions[i]!]))

  for (const kind of MERGE_KINDS) {
    const sCol = collectionOf(server, kind)
    const mCol = collectionOf(merged, kind)
    const target = collectionOf(out, kind)
    for (const [id, m] of Object.entries(mCol)) {
      const s = sCol[id]
      if (s !== undefined) {
        const next: Entity = { ...s }
        for (const f of Object.keys(FILE_FIELDS[kind])) next[f] = m[f]
        target[id] = next
      } else {
        const next: Entity = { ...m }
        if (kind === 'table') next['position'] = posById.get(id) ?? { x: 0, y: 0 }
        target[id] = next
      }
    }
  }

  return { model: out, pruned: pruneDangling(out) }
}
