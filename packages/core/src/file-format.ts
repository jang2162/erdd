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

/**
 * 파일명으로 쓸 수 없는 물리명. 설계는 물리명이 [A-Za-z_][A-Za-z0-9_]* 범위라고 전제했지만
 * Table.physicalName은 z.string()이라 그 전제를 강제하는 코드가 없다. 경로 구분자나 ..가
 * 들어오면 erdd/tables/ 밖에 파일이 쓰인다.
 */
export function unsafeFileName(physicalName: string): boolean {
  if (physicalName === '' || physicalName === '.' || physicalName === '..') return true
  return /[/\\]/.test(physicalName)
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
    if (unsafeFileName(table.physicalName)) {
      issues.push({
        path: `${TREE_ROOT}/tables`,
        message: `물리명 ${table.physicalName}은 파일명으로 쓸 수 없어 이 테이블을 파일로 내보내지 않았습니다`,
      })
      continue
    }
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
  | { ok: true; model: ProjectModel; warnings: FileIssue[]; assignedTree?: FileTree }
  | { ok: false; issues: FileIssue[] }

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const asBool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt)

/** 이름으로 참조되는 것들은 이름이 유일해야 한다 — 겹치면 어디로 붙일지 정할 수 없다. */
function duplicates(names: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const n of names) {
    if (seen.has(n)) dup.add(n)
    else seen.add(n)
  }
  return [...dup]
}

/**
 * 파일에 id가 없는 객체 = 로컬에서 새로 만든 것(서버 발급 전).
 * 빈 문자열을 쓰면 같은 컬렉션의 새 객체끼리 키가 겹쳐 조용히 덮어써지므로,
 * 경로·종류·순번으로 결정적인 임시 id를 만든다. 접두사로 신규임을 구분한다.
 */
export const NEW_ID_PREFIX = 'new:'

export function isNewId(id: string): boolean {
  return id.startsWith(NEW_ID_PREFIX)
}

export type FilesToModelOptions = {
  /**
   * id가 없는 객체(로컬 신규)에 줄 id 생성기. push는 uuidv7을 넘겨 처음부터 최종 id로
   * 조립한다 — 나중에 리맵하면 참조 필드 하나만 빠뜨려도 조용히 깨진다.
   * 생략하면 경로·종류·순번으로 만든 결정적 임시 id를 쓴다(validate가 위치를 알려 주기 위함).
   */
  newId?: () => string
}

export function filesToModel(tree: FileTree, opts?: FilesToModelOptions): FilesToModelResult {
  const newId = opts?.newId
  // newId가 있으면(push 경로) 복사본에 발급 id를 되써 넣어 "id를 채운 트리"를 함께 낸다.
  // 입력은 절대 변형하지 않는다 — 호출자가 원본 트리를 계속 쓴다(reserveIds가 둘을 비교한다).
  // newId가 없으면(pull·validate·base) 되쓸 것이 없으므로 복사하지 않는다 — 큰 트리를 매번
  // 통째로 복사할 이유가 없다.
  // JSON 왕복이 아니라 structuredClone인 이유는 yaml이 JSON으로 표현되지 않는 값을 내기
  // 때문이다 — `.inf`/`.nan`은 Infinity/NaN이 되는데 JSON 왕복은 그것을 null로 뭉갠다.
  // anchor/alias가 만든 순환 참조에서는 JSON.stringify가 아예 던진다.
  // (Date는 이유가 아니다 — yaml@2.9.0의 기본 core 스키마는 타임스탬프를 문자열로 낸다.)
  const src = newId === undefined ? tree : structuredClone(tree)
  const issues: FileIssue[] = []
  const warnings: FileIssue[] = []
  const model = createEmptyModel()

  /**
   * 컬렉션별로 "그 id를 처음 쓴 파일"을 기억한다. 컬렉션 키가 곧 엔티티 id라(op.ts:90)
   * 같은 id가 두 번 나오면 뒤엣것이 앞엣것을 조용히 덮어쓴다. 파일을 복사해 새 테이블을
   * 만들면서 id를 지우지 않는 것은 흔한 사고인데, push에서는 그것이 "새로 만들기"가 아니라
   * "원본을 복사본 내용으로 개명"이 되어 복구 불가능한 반영이 나간다 — 계획을 세우기 전에
   * 오류로 세운다.
   */
  const firstUse = new Map<string, string>()
  /**
   * idOf가 이미 지나간 객체들. YAML anchor/alias(`&이름` … `*이름`)는 배열의 두 원소를
   * **같은 객체 하나**로 파싱하므로, 재방문은 곧 "두 항목이 실은 한 항목"이라는 뜻이다 —
   * 잡지 않으면 두 항목이 조용히 하나로 합쳐진 채 ok:true가 나간다.
   *
   * **참조 동일성으로 본다.** 발급한 id를 firstUse에 등록해 두 번째 방문이 explicit으로
   * 읽게 하는 방식은 되쓰기가 있는 push 갈래에서만 동작해서, 같은 파일을 `erdd validate`는
   * 통과시키고 `erdd push`는 거절하는 갈림을 만들었다(push의 오류 문구가 그 validate를
   * 가리킨다). 참조 동일성은 id와 무관하게 직접 보이므로 두 갈래가 같은 판정을 낸다.
   */
  const visited = new WeakSet<Rec>()
  const idOf = (r: Rec, path: string, kind: string, index: number): string => {
    if (visited.has(r)) {
      // 사용자 파일에 지울 id가 없을 수도 있으므로("id를 지우세요"가 실행 불가능한 지시가
      // 된다) 무엇이 문제이고 무엇을 하면 되는지 말한다.
      issues.push({
        path,
        message: `${kind} 항목 하나가 두 번 나타납니다 — YAML anchor/alias(\`&이름\` … \`*이름\`)로 같은 항목을 재사용한 것으로 보입니다. ERDD는 anchor/alias를 지원하지 않습니다(두 항목이 한 항목으로 합쳐집니다) — 별칭을 풀어 항목마다 내용을 그대로 적어 주세요`,
      })
      // 결과 모델은 ok:false와 함께 버려지지만, 두 방문이 한 키로 합쳐져 뒤따르는 순회가
      // 엉뚱한 것을 보지 않도록 자리로 만든 임시 id를 준다.
      return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
    }
    visited.add(r)
    const explicit = asStr(r['id'])
    if (explicit === null) {
      if (newId === undefined) return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
      // r은 src 안의 객체다(입력 tree는 그대로다). 발급 자리가 곧 기록 자리이므로 순회를
      // 복제할 필요가 없고, 나중에 자리가 늘어도 자동으로 따라간다 — 이것이 별도
      // assignMissingIds를 만들지 않은 이유다.
      const id = newId()
      r['id'] = id
      return id
    }
    const key = `${kind} ${explicit}`
    const first = firstUse.get(key)
    if (first === undefined) firstUse.set(key, path)
    else if (first === path) {
      issues.push({
        path,
        message: `id ${explicit}가 이 파일에서 두 번 쓰였습니다 — id는 서버가 발급한 identity라 하나만 가질 수 있습니다`,
      })
    } else {
      issues.push({
        path,
        message: `id ${explicit}가 ${first}에도 있습니다 — 복사해서 새로 만든 것이라면 id를 지우세요(그대로 두면 원본을 덮어씁니다)`,
      })
    }
    return explicit
  }

  const readList = (path: string, key: string): Rec[] => {
    const file = src[path]
    if (file === undefined) return []
    if (!isRec(file)) { issues.push({ path, message: '객체가 아닙니다' }); return [] }
    const list = file[key]
    if (list === undefined) return []
    if (!Array.isArray(list)) { issues.push({ path, message: `${key}는 배열이어야 합니다` }); return [] }
    return list.filter(isRec)
  }

  // 1) 이름으로 참조되는 것부터 — 그룹·도메인.
  readList(`${TREE_ROOT}/groups.yaml`, 'groups').forEach((g, i) => {
    const id = idOf(g, `${TREE_ROOT}/groups.yaml`, 'groups', i)
    model.tableGroups[id] = {
      id, name: asStr(g['name']) ?? '', color: asStr(g['color']) ?? '#ffffff',
      comment: asStr(g['comment']), alias: '',
    }
  })
  readList(`${TREE_ROOT}/domains.yaml`, 'domains').forEach((d, i) => {
    const id = idOf(d, `${TREE_ROOT}/domains.yaml`, 'domains', i)
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
  })

  for (const n of duplicates(Object.values(model.tableGroups).map((g) => g.name))) {
    issues.push({ path: `${TREE_ROOT}/groups.yaml`, message: `그룹 이름 ${n}이 중복됩니다 — 이름으로 참조되므로 유일해야 합니다` })
  }
  for (const n of duplicates(Object.values(model.domains).map((d) => d.name))) {
    issues.push({ path: `${TREE_ROOT}/domains.yaml`, message: `도메인 이름 ${n}이 중복됩니다 — 이름으로 참조되므로 유일해야 합니다` })
  }

  const groupIdByName = new Map(Object.values(model.tableGroups).map((g) => [g.name, g.id]))
  const domainIdByName = new Map(Object.values(model.domains).map((d) => [d.name, d.id]))

  readList(`${TREE_ROOT}/words.yaml`, 'words').forEach((w, i) => {
    const id = idOf(w, `${TREE_ROOT}/words.yaml`, 'words', i)
    model.words[id] = {
      id, logicalName: asStr(w['logicalName']) ?? '', abbreviation: asStr(w['abbreviation']) ?? '',
      englishName: asStr(w['englishName']), description: asStr(w['description']), origin: null,
    }
  })
  readList(`${TREE_ROOT}/terms.yaml`, 'terms').forEach((t, i) => {
    const id = idOf(t, `${TREE_ROOT}/terms.yaml`, 'terms', i)
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
  })
  readList(`${TREE_ROOT}/custom-fields.yaml`, 'customFields').forEach((f, i) => {
    const id = idOf(f, `${TREE_ROOT}/custom-fields.yaml`, 'customFields', i)
    const target = f['target'] === 'table' ? 'table' : 'column'
    const type = f['type'] === 'boolean' ? 'boolean' : f['type'] === 'select' ? 'select' : 'text'
    model.customFields[id] = {
      id, name: asStr(f['name']) ?? '', target, type,
      options: Array.isArray(f['options']) ? f['options'].filter((v): v is string => typeof v === 'string') : [],
      required: asBool(f['required'], false), defaultValue: asStr(f['defaultValue']),
      order: typeof f['order'] === 'number' ? f['order'] : 0, origin: null,
    }
  })

  // 2) 테이블 파일 — 두 번 훑는다. 관계가 다른 테이블의 컬럼을 참조하기 때문이다.
  const tablePaths = Object.keys(src).filter((p) => p.startsWith(`${TREE_ROOT}/tables/`))
  const pending: { path: string; file: Rec; tableId: string }[] = []

  for (const path of tablePaths.sort()) {
    const file = src[path]
    if (!isRec(file)) { issues.push({ path, message: '객체가 아닙니다' }); continue }
    const tableId = idOf(file, path, 'table', 0)
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
      const id = idOf(c, path, 'columns', order)
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

  for (const n of duplicates(Object.values(model.tables).map((t) => t.physicalName))) {
    issues.push({ path: `${TREE_ROOT}/tables`, message: `테이블 물리명 ${n}이 중복됩니다 — 관계가 이름으로 참조하므로 유일해야 합니다` })
  }

  const tableIdByName = new Map(Object.values(model.tables).map((t) => [t.physicalName, t.id]))
  const colIdIn = (tableId: string, physicalName: string): string | undefined =>
    Object.values(model.columns).find((c) => c.tableId === tableId && c.physicalName === physicalName)?.id

  for (const { path, file, tableId } of pending) {
    ;(Array.isArray(file['indexes']) ? file['indexes'].filter(isRec) : []).forEach((ix, i) => {
      const cols = (Array.isArray(ix['columns']) ? ix['columns'] : []).filter((v): v is string => typeof v === 'string')
      const parsed = cols.map((raw) => {
        const desc = /\s+DESC$/i.test(raw)
        const name = raw.replace(/\s+(ASC|DESC)$/i, '')
        const columnId = colIdIn(tableId, name)
        if (columnId === undefined) issues.push({ path, message: `인덱스 컬럼 ${name}을 찾지 못했습니다` })
        return { columnId: columnId ?? '', direction: (desc ? 'desc' : 'asc') as 'asc' | 'desc' }
      })
      const id = idOf(ix, path, 'indexes', i)
      model.indexes[id] = { id, tableId, name: asStr(ix['name']) ?? '', columns: parsed, unique: asBool(ix['unique'], false) }
    })

    ;(Array.isArray(file['relations']) ? file['relations'].filter(isRec) : []).forEach((r, i) => {
      const to = asStr(r['to']) ?? ''
      const parentTableId = tableIdByName.get(to)
      if (parentTableId === undefined) {
        issues.push({ path, message: `관계의 부모 테이블 ${to}을 찾지 못했습니다` })
        return
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
      const id = idOf(r, path, 'relations', i)
      model.relationships[id] = {
        id, parentTableId, childTableId: tableId, columnMappings: mappings,
        cardinality: r['cardinality'] === '1:1' ? '1:1' : '1:N',
        identifying: asBool(r['identifying'], false), name: asStr(r['name']),
      }
    })
  }

  if (issues.length > 0) return { ok: false, issues }
  // 파싱에 실패한 트리에 id를 기록할 이유가 없다 — ok:false에는 싣지 않는다.
  return { ok: true, model, warnings, ...(newId === undefined ? {} : { assignedTree: src }) }
}
