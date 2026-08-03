import { createEmptyModel, type ProjectModel } from './model.js'

/** 상대 경로 → 파일 내용(plain object). YAML 인코딩은 이 파일의 책임이 아니다. */
export type FileTree = Record<string, unknown>
export type FileIssue = { path: string; message: string }

export const TREE_ROOT = 'erdd'
export const TOP_LEVEL_FILES = [
  `${TREE_ROOT}/groups.yaml`,
  `${TREE_ROOT}/words.yaml`,
  `${TREE_ROOT}/terms.yaml`,
  `${TREE_ROOT}/domains.yaml`,
  `${TREE_ROOT}/custom-fields.yaml`,
] as const

/**
 * 테이블 파일명. 물리명이 대소문자만 다른 테이블이 있으면(macOS·Windows에서 충돌)
 * 그 테이블들에만 id 접미사를 붙인다.
 *
 * 접미사는 id의 **뒤** 8자다. uuidv7의 앞 12자는 48비트 밀리초 타임스탬프라,
 * 같은 65초 창에서 만들어진 두 id는 앞 8자가 완전히 같아져 충돌 회피가 무력해진다.
 * 뒤쪽은 난수 비트다. 그마저 겹치면 id 전체를 써서 결정적으로 갈라 준다.
 */
export function tableFileName(model: ProjectModel, tableId: string): string {
  const table = model.tables[tableId]!
  const clashing = Object.values(model.tables).filter(
    (t) => t.physicalName.toUpperCase() === table.physicalName.toUpperCase(),
  )
  if (clashing.length === 1) return `${table.physicalName}.yaml`
  const shorts = clashing.map((t) => t.id.slice(-8))
  const distinct = new Set(shorts).size === clashing.length
  const suffix = distinct ? table.id.slice(-8) : table.id
  return `${table.physicalName}.${suffix}.yaml`
}

/** 값이 기본값이면 키를 아예 넣지 않는다 — diff를 조용하게 유지한다. */
function omitDefaults<T extends Record<string, unknown>>(
  obj: T, defaults: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if (k in defaults && v === defaults[k as keyof T]) continue
    out[k] = v
  }
  return out as Partial<T>
}

export function modelToFiles(model: ProjectModel): { tree: FileTree; issues: FileIssue[] } {
  const issues: FileIssue[] = []
  const tree: FileTree = {}

  const groupName = (id: string | null) => (id === null ? undefined : model.tableGroups[id]?.name)
  const domainName = (id: string | null) => (id === null ? undefined : model.domains[id]?.name)

  // 테이블별 컬럼을 order로 정렬해 둔다.
  const colsByTable = new Map<string, typeof model.columns[string][]>()
  for (const c of Object.values(model.columns)) {
    const list = colsByTable.get(c.tableId) ?? []
    list.push(c)
    colsByTable.set(c.tableId, list)
  }
  for (const list of colsByTable.values()) list.sort((a, b) => a.order - b.order)

  for (const table of Object.values(model.tables)) {
    const cols = colsByTable.get(table.id) ?? []
    const colById = new Map(cols.map((c) => [c.id, c]))

    const columns = cols.map((c) => omitDefaults({
      id: c.id,
      name: c.physicalName,
      logicalName: c.logicalName,
      // type과 domain을 둘 다 쓴다. setColumnDomain(apps/web/src/editor/column-edits.ts:36)이
      // 도메인 지정 시 기존 type 문자열을 지우지 않으므로, 하나만 쓰면 왕복에서 다른 하나가 소실된다.
      domain: domainName(c.domainId),
      type: c.type,
      pk: c.isPk,
      autoIncrement: c.autoIncrement,
      nullable: c.nullable,
      default: c.defaultValue ?? undefined,
      comment: c.comment ?? undefined,
      custom: Object.keys(c.custom).length > 0 ? c.custom : undefined,
    }, { pk: false, autoIncrement: false, nullable: true }))

    const indexes = Object.values(model.indexes)
      .filter((ix) => ix.tableId === table.id)
      .map((ix) => omitDefaults({
        id: ix.id,
        name: ix.name,
        // "MBR_NM" 또는 "MBR_NM DESC" — 오름차순은 방향을 생략한다.
        columns: ix.columns.map((c) => {
          const name = colById.get(c.columnId)?.physicalName
          if (name === undefined) {
            issues.push({
              path: `${TREE_ROOT}/tables/${tableFileName(model, table.id)}`,
              message: `인덱스 ${ix.name}이 이 테이블에 없는 컬럼을 가리킵니다`,
            })
            return c.columnId
          }
          return c.direction === 'desc' ? `${name} DESC` : name
        }),
        unique: ix.unique,
      }, { unique: false }))

    // 관계는 자식 테이블 파일에만 적는다.
    const relations = Object.values(model.relationships)
      .filter((r) => r.childTableId === table.id)
      .map((r) => {
        const parent = model.tables[r.parentTableId]
        const columns: Record<string, string> = {}
        for (const m2 of r.columnMappings) {
          const child = model.columns[m2.childColumnId]?.physicalName ?? m2.childColumnId
          const parentCol = model.columns[m2.parentColumnId]?.physicalName ?? m2.parentColumnId
          columns[child] = parentCol
        }
        return omitDefaults({
          id: r.id,
          name: r.name ?? undefined,
          to: parent?.physicalName ?? r.parentTableId,
          columns,
          identifying: r.identifying,
          cardinality: r.cardinality,
        }, { identifying: false, cardinality: '1:N' })
      })

    tree[`${TREE_ROOT}/tables/${tableFileName(model, table.id)}`] = omitDefaults({
      id: table.id,
      name: table.physicalName,
      logicalName: table.logicalName,
      group: groupName(table.groupId),
      comment: table.comment ?? undefined,
      custom: Object.keys(table.custom).length > 0 ? table.custom : undefined,
      columns,
      indexes: indexes.length > 0 ? indexes : undefined,
      relations: relations.length > 0 ? relations : undefined,
    }, {})
  }

  // 물리명 대소문자 충돌 경고 — 파일명은 tableFileName이 이미 갈랐다.
  const byUpper = new Map<string, string[]>()
  for (const t of Object.values(model.tables)) {
    const key = t.physicalName.toUpperCase()
    byUpper.set(key, [...(byUpper.get(key) ?? []), t.physicalName])
  }
  for (const [, names] of byUpper) {
    if (names.length > 1) {
      issues.push({
        path: `${TREE_ROOT}/tables`,
        message: `물리명이 대소문자만 다른 테이블이 있어 파일명에 id를 붙였습니다: ${names.join(', ')}`,
      })
    }
  }

  tree[`${TREE_ROOT}/groups.yaml`] = {
    groups: Object.values(model.tableGroups).map((g) => omitDefaults({
      id: g.id, name: g.name, color: g.color, comment: g.comment ?? undefined,
    }, {})),
  }
  tree[`${TREE_ROOT}/words.yaml`] = {
    words: Object.values(model.words).map((w) => omitDefaults({
      id: w.id, logicalName: w.logicalName, abbreviation: w.abbreviation,
      englishName: w.englishName ?? undefined, description: w.description ?? undefined,
    }, {})),
  }
  tree[`${TREE_ROOT}/terms.yaml`] = {
    terms: Object.values(model.terms).map((t) => omitDefaults({
      id: t.id, logicalName: t.logicalName, physicalName: t.physicalName,
      domain: domainName(t.domainId), description: t.description ?? undefined,
    }, {})),
  }
  tree[`${TREE_ROOT}/domains.yaml`] = {
    domains: Object.values(model.domains).map((d) => omitDefaults({
      id: d.id, name: d.name, category: d.category ?? undefined, logicalType: d.logicalType,
      dialectTypes: d.dialectTypes, defaultValue: d.defaultValue ?? undefined,
      allowedValues: d.allowedValues.length > 0 ? d.allowedValues : undefined,
      description: d.description ?? undefined,
    }, {})),
  }
  tree[`${TREE_ROOT}/custom-fields.yaml`] = {
    customFields: Object.values(model.customFields).map((f) => omitDefaults({
      id: f.id, name: f.name, target: f.target, type: f.type,
      options: f.options.length > 0 ? f.options : undefined,
      required: f.required, defaultValue: f.defaultValue ?? undefined, order: f.order,
    }, { required: false })),
  }

  return { tree, issues }
}

export type FilesToModelResult =
  | { ok: true; model: ProjectModel; warnings: FileIssue[] }
  | { ok: false; issues: FileIssue[] }

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const asBool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt)

/** 새로 만든 객체는 파일에 id가 없다. 서버 발급 전이므로 빈 문자열로 둔다. */
const idOf = (r: Rec): string => asStr(r['id']) ?? ''

export function filesToModel(tree: FileTree): FilesToModelResult {
  const issues: FileIssue[] = []
  const warnings: FileIssue[] = []
  const model = createEmptyModel()

  const readList = (path: string, key: string): Rec[] => {
    const file = tree[path]
    if (file === undefined) return []
    if (!isRec(file)) { issues.push({ path, message: '객체가 아닙니다' }); return [] }
    const list = file[key]
    if (list === undefined) return []
    if (!Array.isArray(list)) { issues.push({ path, message: `${key}는 배열이어야 합니다` }); return [] }
    return list.filter(isRec)
  }

  // 1) 이름으로 참조되는 것부터 — 그룹·도메인.
  for (const g of readList(`${TREE_ROOT}/groups.yaml`, 'groups')) {
    const id = idOf(g)
    model.tableGroups[id] = {
      id, name: asStr(g['name']) ?? '', color: asStr(g['color']) ?? '#ffffff',
      comment: asStr(g['comment']),
    }
  }
  for (const d of readList(`${TREE_ROOT}/domains.yaml`, 'domains')) {
    const id = idOf(d)
    const dt = isRec(d['dialectTypes']) ? d['dialectTypes'] : {}
    model.domains[id] = {
      id, name: asStr(d['name']) ?? '', category: asStr(d['category']),
      logicalType: asStr(d['logicalType']) ?? '',
      dialectTypes: {
        postgresql: asStr(dt['postgresql']), mysql: asStr(dt['mysql']),
        oracle: asStr(dt['oracle']), mssql: asStr(dt['mssql']),
      },
      defaultValue: asStr(d['defaultValue']),
      allowedValues: Array.isArray(d['allowedValues']) ? d['allowedValues'].filter((v): v is string => typeof v === 'string') : [],
      description: asStr(d['description']), origin: null,
    }
  }
  const groupIdByName = new Map(Object.values(model.tableGroups).map((g) => [g.name, g.id]))
  const domainIdByName = new Map(Object.values(model.domains).map((d) => [d.name, d.id]))

  for (const w of readList(`${TREE_ROOT}/words.yaml`, 'words')) {
    const id = idOf(w)
    model.words[id] = {
      id, logicalName: asStr(w['logicalName']) ?? '', abbreviation: asStr(w['abbreviation']) ?? '',
      englishName: asStr(w['englishName']), description: asStr(w['description']), origin: null,
    }
  }
  for (const t of readList(`${TREE_ROOT}/terms.yaml`, 'terms')) {
    const id = idOf(t)
    const domainName = asStr(t['domain'])
    let domainId: string | null = null
    if (domainName !== null) {
      const hit = domainIdByName.get(domainName)
      if (hit === undefined) {
        issues.push({ path: `${TREE_ROOT}/terms.yaml`, message: `도메인 ${domainName}을 찾지 못했습니다` })
      } else domainId = hit
    }
    model.terms[id] = {
      id, logicalName: asStr(t['logicalName']) ?? '', physicalName: asStr(t['physicalName']) ?? '',
      domainId, description: asStr(t['description']), origin: null,
    }
  }
  for (const f of readList(`${TREE_ROOT}/custom-fields.yaml`, 'customFields')) {
    const id = idOf(f)
    const target = f['target'] === 'table' ? 'table' : 'column'
    const type = f['type'] === 'boolean' ? 'boolean' : f['type'] === 'select' ? 'select' : 'text'
    model.customFields[id] = {
      id, name: asStr(f['name']) ?? '', target, type,
      options: Array.isArray(f['options']) ? f['options'].filter((v): v is string => typeof v === 'string') : [],
      required: asBool(f['required'], false), defaultValue: asStr(f['defaultValue']),
      order: typeof f['order'] === 'number' ? f['order'] : 0, origin: null,
    }
  }

  // 2) 테이블 파일 — 두 번 훑는다. 관계가 다른 테이블의 컬럼을 참조하기 때문이다.
  const tablePaths = Object.keys(tree).filter((p) => p.startsWith(`${TREE_ROOT}/tables/`))
  const pending: { path: string; file: Rec; tableId: string }[] = []

  for (const path of tablePaths.sort()) {
    const file = tree[path]
    if (!isRec(file)) { issues.push({ path, message: '객체가 아닙니다' }); continue }
    const tableId = idOf(file)
    const groupName = asStr(file['group'])
    let groupId: string | null = null
    if (groupName !== null) {
      const hit = groupIdByName.get(groupName)
      if (hit === undefined) issues.push({ path, message: `그룹 ${groupName}을 찾지 못했습니다` })
      else groupId = hit
    }
    model.tables[tableId] = {
      id: tableId, physicalName: asStr(file['name']) ?? '', logicalName: asStr(file['logicalName']) ?? '',
      comment: asStr(file['comment']), groupId,
      position: { x: 0, y: 0 }, groupPosition: null,
      custom: isRec(file['custom']) ? Object.fromEntries(
        Object.entries(file['custom']).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ) : {},
    }

    const rawCols = Array.isArray(file['columns']) ? file['columns'].filter(isRec) : []
    rawCols.forEach((c, order) => {
      const id = idOf(c)
      const domainName = asStr(c['domain'])
      let domainId: string | null = null
      if (domainName !== null) {
        const hit = domainIdByName.get(domainName)
        if (hit === undefined) issues.push({ path, message: `도메인 ${domainName}을 찾지 못했습니다` })
        else domainId = hit
      }
      model.columns[id] = {
        id, tableId, physicalName: asStr(c['name']) ?? '', logicalName: asStr(c['logicalName']) ?? '',
        type: asStr(c['type']) ?? '',
        isPk: asBool(c['pk'], false), autoIncrement: asBool(c['autoIncrement'], false),
        nullable: asBool(c['nullable'], true), defaultValue: asStr(c['default']),
        order, comment: asStr(c['comment']), domainId,
        custom: isRec(c['custom']) ? Object.fromEntries(
          Object.entries(c['custom']).filter((e): e is [string, string] => typeof e[1] === 'string'),
        ) : {},
      }
    })

    pending.push({ path, file, tableId })
  }

  const tableIdByName = new Map(Object.values(model.tables).map((t) => [t.physicalName, t.id]))
  const colIdIn = (tableId: string, physicalName: string): string | undefined =>
    Object.values(model.columns).find((c) => c.tableId === tableId && c.physicalName === physicalName)?.id

  for (const { path, file, tableId } of pending) {
    for (const ix of (Array.isArray(file['indexes']) ? file['indexes'].filter(isRec) : [])) {
      const cols = (Array.isArray(ix['columns']) ? ix['columns'] : []).filter((v): v is string => typeof v === 'string')
      const parsed = cols.map((raw) => {
        const desc = /\s+DESC$/i.test(raw)
        const name = raw.replace(/\s+(ASC|DESC)$/i, '')
        const columnId = colIdIn(tableId, name)
        if (columnId === undefined) issues.push({ path, message: `인덱스 컬럼 ${name}을 찾지 못했습니다` })
        return { columnId: columnId ?? '', direction: (desc ? 'desc' : 'asc') as 'asc' | 'desc' }
      })
      const id = idOf(ix)
      model.indexes[id] = { id, tableId, name: asStr(ix['name']) ?? '', columns: parsed, unique: asBool(ix['unique'], false) }
    }

    for (const r of (Array.isArray(file['relations']) ? file['relations'].filter(isRec) : [])) {
      const to = asStr(r['to']) ?? ''
      const parentTableId = tableIdByName.get(to)
      if (parentTableId === undefined) {
        issues.push({ path, message: `관계의 부모 테이블 ${to}을 찾지 못했습니다` })
        continue
      }
      const mappings: { childColumnId: string; parentColumnId: string }[] = []
      for (const [childName, parentName] of Object.entries(isRec(r['columns']) ? r['columns'] : {})) {
        if (typeof parentName !== 'string') continue
        const childColumnId = colIdIn(tableId, childName)
        const parentColumnId = colIdIn(parentTableId, parentName)
        if (childColumnId === undefined) issues.push({ path, message: `관계의 자식 컬럼 ${childName}을 찾지 못했습니다` })
        if (parentColumnId === undefined) issues.push({ path, message: `관계의 부모 컬럼 ${to}.${parentName}을 찾지 못했습니다` })
        mappings.push({ childColumnId: childColumnId ?? '', parentColumnId: parentColumnId ?? '' })
      }
      const id = idOf(r)
      model.relationships[id] = {
        id, parentTableId, childTableId: tableId, columnMappings: mappings,
        cardinality: r['cardinality'] === '1:1' ? '1:1' : '1:N',
        identifying: asBool(r['identifying'], false), name: asStr(r['name']),
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, model, warnings }
}
